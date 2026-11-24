const { parentPort } = require("worker_threads");
const { axios } = require("../classes/axios");
const { getIntegrations, saveIntegrationData } = require("../classes/integration-store");
const WebhookManager = require("../classes/webhook-manager");
const audiobookshelf = require("../classes/audiobookshelf");
const { safeHttpGet, stripTrailingSlashes } = require("../utils/security");

function cleanUrl(url = "") {
  return String(url).trim().replace(/\/+$/, "");
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

// Several episodes of one series share the same details, so fetch each one once per sync.
const mediaDetailsCache = new Map();

async function fetchMediaDetails(app, item) {
  const service = String(app.name || "").toLowerCase();
  const baseUrl = cleanUrl(app.values?.url);
  const apiKey = app.values?.secret;

  if (!baseUrl || !apiKey) {
    return null;
  }

  let apiPath = null;
  if (service === "radarr" && (item.movieId || item.movie?.id)) {
    apiPath = `/api/v3/movie/${item.movieId || item.movie.id}`;
  } else if (service === "sonarr" && (item.seriesId || item.series?.id)) {
    apiPath = `/api/v3/series/${item.seriesId || item.series.id}`;
  } else if (service === "lidarr" && (item.artistId || item.artist?.id)) {
    apiPath = `/api/v1/artist/${item.artistId || item.artist.id}`;
  } else if (service === "readarr" && (item.bookId || item.book?.id)) {
    apiPath = `/api/v1/book/${item.bookId || item.book.id}`;
  } else if (service === "readarr" && (item.authorId || item.author?.id)) {
    apiPath = `/api/v1/author/${item.authorId || item.author.id}`;
  }

  if (!apiPath) {
    return null;
  }

  const cacheKey = `${app.instanceId || app.name}${apiPath}`;
  if (!mediaDetailsCache.has(cacheKey)) {
    mediaDetailsCache.set(
      cacheKey,
      axios
        .get(`${baseUrl}${apiPath}`, { timeout: 15000, headers: { "X-Api-Key": apiKey } })
        .then((response) => response.data)
        .catch((error) => {
          console.log(`[CalendarSync] Unable to fetch media details from ${app.name}: ${error.message}`);
          return null;
        })
    );
  }
  return mediaDetailsCache.get(cacheKey);
}

async function normalizeRelease(app, item) {
  const service = String(app.name || app.slug || "").toLowerCase();
  const isMovie = Boolean(item.movie || item.movieId || item.tmdbId);
  const baseMedia = item.movie || item.series || item.artist || item.book || item.author || item;
  const mediaDetails = Array.isArray(baseMedia?.images) && baseMedia.images.length ? null : await fetchMediaDetails(app, item);
  const media = mediaDetails || baseMedia;
  const title = media?.title || item.artist?.artistName || item.book?.title || item.author?.authorName || item.title || "Untitled release";
  const episode = item.episodeNumber || item.absoluteEpisodeNumber;
  const season = item.seasonNumber;
  const episodeTitle = !isMovie && season && episode ? item.title || item.episode?.title || "" : "";
  const imageSource = Array.isArray(media?.images) ? media.images : [];
  const posterImage = imageSource.find((image) => image.coverType === "poster") || imageSource[0];
  const backdropImage = imageSource.find((image) => image.coverType === "fanart" || image.coverType === "banner") || posterImage;
  const baseUrl = cleanUrl(app.values?.url);
  const toImageUrl = (image) => {
    // Prefer the public artwork URL (TMDB/TVDB/Fanart) so the Arr API key never reaches the browser.
    if (image?.remoteUrl && /^https?:\/\//i.test(image.remoteUrl)) return image.remoteUrl;
    const imageUrl = image?.url;
    if (!imageUrl) return null;
    if (imageUrl.startsWith("http") && !imageUrl.startsWith(baseUrl)) {
      return imageUrl;
    }
    // Local Arr images need the API key, so they go through JellyGlance's image proxy instead.
    const localPath = imageUrl.startsWith("http") ? new URL(imageUrl).pathname : imageUrl.split("?")[0];
    if (!/\/MediaCover\//i.test(localPath) || !app.instanceId) return null;
    return `/proxy/Arr/Images/${encodeURIComponent(app.instanceId)}?path=${encodeURIComponent(localPath.startsWith("/") ? localPath : `/${localPath}`)}`;
  };
  const subtitle =
    season && episode
      ? `S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}${episodeTitle ? ` - ${episodeTitle}` : ""}`
      : isMovie
        ? "Movie release"
        : item.album?.title || item.overview || "Upcoming release";
  const overview = !isMovie && item.overview ? item.overview : media?.overview || item.overview || "";

  return {
    id: `${app.instanceId || app.name}-${item.id || item.episodeId || item.movieId || item.airDateUtc || item.releaseDate}`,
    type: service === "lidarr" ? "music" : service === "readarr" ? "book" : isMovie ? "movie" : "tv",
    title,
    episodeTitle,
    subtitle,
    date: item.airDateUtc || item.releaseDate || item.inCinemas || item.digitalRelease || new Date().toISOString(),
    service: app.name,
    seriesTitle: !isMovie ? media?.title || "" : "",
    network: media?.network || media?.studio || "",
    runtime: Number(item.runtime || media?.runtime) || null,
    finale: item.finaleType || "",
    premiere: !isMovie && Number(episode) === 1,
    monitored: item.monitored !== false,
    hasFile: Boolean(item.hasFile || item.episodeFileId || item.movieFile),
    posterUrl: toImageUrl(posterImage),
    backdropUrl: toImageUrl(backdropImage),
    overview,
  };
}

const MOVIE_RELEASE_KINDS = [
  { key: "inCinemas", label: "In cinemas" },
  { key: "digitalRelease", label: "Digital release" },
  { key: "physicalRelease", label: "Physical release" },
];

async function fetchArrCalendar(app) {
  const url = cleanUrl(app.values?.url);
  const apiKey = app.values?.secret;

  if (!url || !apiKey) {
    return [];
  }

  const isV1Calendar = ["lidarr", "readarr"].includes(String(app.name).toLowerCase());
  const apiPath = isV1Calendar ? "/api/v1/calendar" : "/api/v3/calendar";
  // Include the last month so the current month view also shows what already aired or released.
  const start = addDays(new Date(), -35);
  const end = addDays(new Date(), 120);
  const response = await axios.get(`${url}${apiPath}`, {
    timeout: 15000,
    headers: { "X-Api-Key": apiKey },
    params: {
      start: start.toISOString(),
      end: end.toISOString(),
      includeSeries: true,
      includeEpisode: true,
      includeMovie: true,
    },
  });

  if (!Array.isArray(response.data)) return [];
  const normalized = await Promise.all(response.data.map((item) => normalizeRelease(app, item)));
  // Radarr returns a movie when any of its release dates falls in the window; place it on those dates
  // (cinema, digital, physical) instead of a single date that may be years outside the window.
  return normalized.flatMap((release, index) => {
    if (release.type !== "movie") return [release];
    const item = response.data[index];
    const dated = MOVIE_RELEASE_KINDS.map(({ key, label }) => ({ label, date: item[key] ? new Date(item[key]) : null }))
      .filter(({ date }) => date && !Number.isNaN(date.getTime()) && date >= start && date <= end);
    if (!dated.length) return [release];
    return dated.map(({ label, date }, kindIndex) => ({
      ...release,
      id: `${release.id}-${kindIndex}`,
      subtitle: label,
      releaseKind: label,
      date: date.toISOString(),
    }));
  });
}

// Audiobookshelf has no release schedule, so the calendar shows what arrived: books added and podcast episodes published.
async function fetchAudiobookshelfCalendar(integration, start, end) {
  const base = stripTrailingSlashes(String(integration.values?.url || "").trim());
  const token = String(integration.values?.secret || "").trim().replace(/^bearer\s+/i, "");
  const get = async (path) =>
    (await safeHttpGet(base, path, { timeout: 15000, headers: { Accept: "application/json", Authorization: `Bearer ${token}` } })).data;
  const inRange = (ms) => Number(ms) >= start.getTime() && Number(ms) <= end.getTime();
  const libraries = (await get("/api/libraries"))?.libraries || [];
  const releases = [];
  for (const library of libraries) {
    if (library.mediaType === "podcast") {
      const data = await get(`/api/libraries/${encodeURIComponent(library.id)}/recent-episodes?limit=100`).catch(() => null);
      for (const episode of data?.episodes || []) {
        const published = Number(episode.publishedAt || 0);
        if (!inRange(published)) continue;
        const podcast = episode.podcast?.metadata || episode.podcastMetadata || {};
        const itemId = episode.libraryItemId || episode.podcast?.libraryItemId;
        releases.push({
          id: `${integration.instanceId || "abs"}-ep-${episode.id}`,
          type: "audiobook",
          kind: "podcast",
          title: podcast.title || episode.podcastTitle || "Podcast",
          subtitle: episode.title || "New episode",
          date: new Date(published).toISOString(),
          service: "Audiobookshelf",
          monitored: true,
          hasFile: Boolean(episode.audioFile || episode.audioTrack),
          posterUrl: itemId ? `/proxy/Audiobookshelf/Images/${encodeURIComponent(itemId)}?width=300` : null,
          backdropUrl: null,
          overview: String(episode.description || episode.subtitle || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 600),
          network: podcast.author || "",
          runtime: episode.duration ? Math.round(Number(episode.duration) / 60) : null,
        });
      }
    } else {
      const data = await get(`/api/libraries/${encodeURIComponent(library.id)}/items?sort=addedAt&desc=1&limit=200&minified=1`).catch(() => null);
      for (const item of data?.results || []) {
        if (!inRange(item.addedAt)) continue;
        const metadata = item.media?.metadata || {};
        const author = metadata.authorName || (Array.isArray(metadata.authors) ? metadata.authors.map((row) => row?.name).filter(Boolean).join(", ") : "");
        releases.push({
          id: `${integration.instanceId || "abs"}-item-${item.id}`,
          type: "audiobook",
          kind: "book",
          title: metadata.title || "Untitled",
          subtitle: author ? `Added · ${author}` : "Added to Audiobookshelf",
          date: new Date(Number(item.addedAt)).toISOString(),
          service: "Audiobookshelf",
          monitored: true,
          hasFile: true,
          posterUrl: `/proxy/Audiobookshelf/Images/${encodeURIComponent(item.id)}?width=300`,
          backdropUrl: null,
          overview: String(metadata.description || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 600),
          network: metadata.narratorName ? `Narrated by ${metadata.narratorName}` : "",
          runtime: item.media?.duration ? Math.round(Number(item.media.duration) / 60) : null,
        });
      }
    }
  }
  return releases;
}

async function runArrCalendarSyncTask() {
  try {
    const integrations = await getIntegrations();
    const sources = (integrations.arrApps || []).filter((app) => {
      const name = String(app.name || app.slug || "").toLowerCase();
      return app.connected && (name.includes("sonarr") || name.includes("radarr") || name.includes("lidarr") || name.includes("readarr"));
    });
    const abs = await audiobookshelf.getConnectedAudiobookshelf().catch(() => null);
    if (abs) sources.push({ ...abs, name: "Audiobookshelf", slug: "audiobookshelf" });
    const results = await Promise.allSettled(
      sources.map((app) =>
        app.slug === "audiobookshelf" ? fetchAudiobookshelfCalendar(app, addDays(new Date(), -35), addDays(new Date(), 120)) : fetchArrCalendar(app)
      )
    );
    const errorFor = (index) => {
      const reason = results[index]?.reason;
      return reason ? String(reason.response?.status ? `HTTP ${reason.response.status}` : reason.message || reason).slice(0, 160) : "";
    };
    const releases = results
      .flatMap((result) => (result.status === "fulfilled" ? result.value : []))
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    const failedSources = results
      .map((result, index) => (result.status === "rejected" ? sources[index]?.name : null))
      .filter(Boolean);

    await saveIntegrationData({
      calendar: {
        releases,
        sources: sources.map((source, index) => ({
          name: source.name,
          slug: source.slug,
          instanceId: source.instanceId,
          connected: results[index]?.status === "fulfilled",
          count: results[index]?.status === "fulfilled" ? results[index].value.length : 0,
          error: errorFor(index),
        })),
        rangeStart: addDays(new Date(), -35).toISOString(),
        rangeEnd: addDays(new Date(), 120).toISOString(),
        syncedAt: new Date().toISOString(),
        errors: failedSources,
      },
    });

    const webhookManager = new WebhookManager();
    await webhookManager.triggerEventWebhooks("calendar_refreshed", {
      taskKey: "ArrCalendarSync",
      taskName: "Arr Calendar Sync",
      integrationEvent: "Calendar synced",
      source: "Arr apps",
      releaseCount: releases.length,
      sourceCount: sources.length,
      failedSources,
      message: `Calendar synced · ${releases.length} release${releases.length === 1 ? "" : "s"}.`,
    });
    await webhookManager.flushCoalescedWebhooks();
    parentPort.postMessage({ status: "complete" });
  } catch (error) {
    parentPort.postMessage({ status: "error", message: error.message });
  }
}

parentPort.on("message", async (message) => {
  if (message.command === "start") {
    await runArrCalendarSyncTask(message.triggertype);
    process.exit(0);
  }
});

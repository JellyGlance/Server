// Requested titles arriving in a date window (default: the next 7 days) for the Requests
// calendar. Dates come from three places, merged and de-duplicated per title and day:
//   - Seerr: a movie's release date, a series premiere, or the next episode to air
//   - the Sonarr and Radarr calendar data JellyGlance already synced (stored)
//   - a live read of the Sonarr and Radarr calendar endpoints when they are connected
// Only titles somebody has requested are listed. Everything here is read-only.
const { axios } = require("./axios");
const { getIntegrations, getIntegrationData } = require("./integration-store");

const MAX_DAYS = 31;
const DAY_MS = 86400000;

const norm = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const isTv = (request) => String(request?.mediaType || "").toLowerCase().startsWith("tv");

function dateKey(value) {
  const text = String(value || "");
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

function addDays(key, days) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function todayKey(now = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

// { from, days, to } with sane bounds; a bad `from` means today.
function resolveWindow({ from, days } = {}, now = new Date()) {
  const start = dateKey(from) && !Number.isNaN(Date.parse(`${dateKey(from)}T00:00:00Z`)) ? dateKey(from) : todayKey(now);
  const count = Math.min(MAX_DAYS, Math.max(1, Math.round(Number(days)) || 7));
  return { from: start, days: count, to: addDays(start, count - 1) };
}

function inWindow(key, window) {
  return Boolean(key) && key >= window.from && key <= window.to;
}

function episodeLabel(season, episode) {
  if (season == null || episode == null) return "";
  return `S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}`;
}

function itemFor(request, date, kind, label, source, extra = {}) {
  return {
    id: `${request.id}:${date}:${label || kind}`,
    requestId: request.id,
    title: request.title,
    mediaType: isTv(request) ? "tv" : "movie",
    date,
    kind,
    label,
    source,
    status: request.status,
    availability: request.availability?.status || "",
    hasFile: Boolean(extra.hasFile),
    ...extra,
  };
}

// Seerr dates carried on the request itself.
function seerrItems(requests, window) {
  const items = [];
  for (const request of requests) {
    const release = dateKey(request.releaseDate);
    if (isTv(request)) {
      const next = request.nextEpisode;
      const nextDate = dateKey(next?.airDate);
      if (inWindow(nextDate, window)) {
        items.push(itemFor(request, nextDate, "Episode", episodeLabel(next.season, next.episode), "Seerr", { episodeTitle: next.name || "" }));
      } else if (inWindow(release, window)) {
        items.push(itemFor(request, release, "Premiere", "", "Seerr"));
      }
    } else if (inWindow(release, window)) {
      items.push(itemFor(request, release, "Release", "", "Seerr"));
    }
  }
  return items;
}

function findRequest(requests, release) {
  const tmdb = release.tmdbId ? Number(release.tmdbId) : null;
  const tvdb = release.tvdbId ? Number(release.tvdbId) : null;
  const kind = release.type === "movie" || release.mediaType === "movie" ? "movie" : "tv";
  return requests.find((request) => {
    if ((isTv(request) ? "tv" : "movie") !== kind) return false;
    if (tmdb && Number(request.externalIds?.tmdbId) === tmdb) return true;
    if (tvdb && Number(request.externalIds?.tvdbId) === tvdb) return true;
    return norm(request.title) === norm(release.title);
  });
}

// Releases as the sync task stores them: { date, type, title, service, subtitle, hasFile, ... }.
function arrItems(requests, releases, window) {
  const items = [];
  for (const release of releases || []) {
    const date = dateKey(release.date);
    if (!inWindow(date, window)) continue;
    const request = findRequest(requests, release);
    if (!request) continue;
    const movie = release.type === "movie" || release.mediaType === "movie";
    const label = movie ? "" : String(release.subtitle || "").match(/S\d+E\d+/i)?.[0]?.toUpperCase() || "";
    items.push(itemFor(request, date, movie ? "Release" : label ? "Episode" : "Premiere", label, release.service || "Arr", { hasFile: release.hasFile, episodeTitle: movie ? "" : release.episodeTitle || "" }));
  }
  return items;
}

// One entry per request, day and episode; the *arr data wins over Seerr's guess.
function mergeItems(...lists) {
  const byKey = new Map();
  for (const list of lists) {
    for (const item of list) byKey.set(`${item.requestId}|${item.date}|${item.label}`, item);
  }
  return [...byKey.values()];
}

// Pure: group the merged items per day (every day of the window is present, in order).
function buildCalendar(requests, { window, arrReleases = [], liveReleases = [] }) {
  const visible = (requests || []).filter((request) => String(request.status || "").toLowerCase() !== "declined" && String(request.status || "").toLowerCase() !== "error");
  const items = mergeItems(seerrItems(visible, window), arrItems(visible, arrReleases, window), arrItems(visible, liveReleases, window));
  const days = Array.from({ length: window.days }, (_, offset) => {
    const date = addDays(window.from, offset);
    const dayItems = items
      .filter((item) => item.date === date)
      .sort((a, b) => a.title.localeCompare(b.title) || a.label.localeCompare(b.label));
    return { date, items: dayItems };
  });
  return { from: window.from, to: window.to, days, total: items.length };
}

// ---- live reads -----------------------------------------------------------------------

function arrService(app) {
  const name = String(app?.name || app?.slug || "").toLowerCase();
  if (name.includes("sonarr")) return "Sonarr";
  if (name.includes("radarr")) return "Radarr";
  return null;
}

async function fetchArrCalendar(app, window) {
  const service = arrService(app);
  const url = String(app.values?.url || "").trim().replace(/\/+$/, "");
  const apiKey = app.values?.secret;
  if (!service || !url || !apiKey) return { service, ok: false, releases: [], error: "Needs a URL and API key" };
  try {
    const response = await axios.get(`${url}/api/v3/calendar`, {
      timeout: 8000,
      headers: { "X-Api-Key": apiKey },
      params: {
        start: `${window.from}T00:00:00Z`,
        end: `${addDays(window.to, 1)}T00:00:00Z`,
        unmonitored: false,
        includeSeries: service === "Sonarr",
        includeEpisodeFile: false,
      },
    });
    const rows = Array.isArray(response.data) ? response.data : [];
    return {
      service,
      ok: true,
      releases: rows.map((row) =>
        service === "Radarr"
          ? {
              type: "movie",
              service,
              title: row.title,
              tmdbId: row.tmdbId,
              date: row.digitalRelease || row.physicalRelease || row.inCinemas,
              hasFile: row.hasFile,
            }
          : {
              type: "episode",
              service,
              title: row.series?.title || row.title,
              tvdbId: row.series?.tvdbId,
              tmdbId: row.series?.tmdbId,
              date: row.airDateUtc || row.airDate,
              subtitle: episodeLabel(row.seasonNumber, row.episodeNumber),
              episodeTitle: row.title || "",
              hasFile: row.hasFile,
            }
      ),
    };
  } catch (error) {
    return { service, ok: false, releases: [], error: error.response?.status ? `HTTP ${error.response.status}` : error.code || "Unreachable" };
  }
}

async function getCalendar(requests, query = {}) {
  const window = resolveWindow(query);
  let stored = [];
  const sources = [{ name: "Seerr", ok: true, error: "" }];
  try {
    stored = (await getIntegrationData()).calendar?.releases || [];
    if (stored.length) sources.push({ name: "Synced calendar", ok: true, error: "" });
  } catch (error) {
    sources.push({ name: "Synced calendar", ok: false, error: error.message || "Unavailable" });
  }
  let live = [];
  try {
    const integrations = await getIntegrations();
    const apps = (integrations.arrApps || []).filter((app) => app.connected && arrService(app));
    const results = await Promise.all(apps.map((app) => fetchArrCalendar(app, window)));
    live = results.flatMap((result) => result.releases);
    sources.push(...results.map((result) => ({ name: result.service, ok: result.ok, error: result.ok ? "" : result.error })));
  } catch (error) {
    sources.push({ name: "Sonarr / Radarr", ok: false, error: error.message || "Unavailable" });
  }
  return { ...buildCalendar(requests, { window, arrReleases: stored, liveReleases: live }), sources };
}

module.exports = { dateKey, addDays, todayKey, resolveWindow, buildCalendar, getCalendar, MAX_DAYS, DAY_MS };

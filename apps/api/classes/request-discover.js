// Seerr discovery rows (trending, popular, upcoming, recommended, ...) for the
// Requests page. Everything here is a GET against Seerr; nothing writes.
const db = require("../db");
const { axios } = require("./axios");
const { getIntegrations } = require("./integration-store");
const { stripTrailingSlashes } = require("../utils/security");

const ROW_CACHE_TTL_MS = 60 * 1000;
const SEEDS_CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_ROW_ITEMS = 20;
const cache = new Map();

// Seerr's own slider ids (settings/discover) that map to a row here.
const SLIDER_ROWS = {
  1: "recently-added",
  2: "recent-requests",
  4: "trending",
  5: "popular-movies",
  6: "movie-genres",
  7: "upcoming-movies",
  8: "studios",
  9: "popular-tv",
  10: "tv-genres",
  11: "upcoming-tv",
  12: "networks",
};

// Seerr hardcodes these in its UI; the ids are TMDB company / network ids.
const STUDIOS = [
  { id: 2, name: "Disney" },
  { id: 3, name: "Pixar" },
  { id: 420, name: "Marvel Studios" },
  { id: 1, name: "Lucasfilm" },
  { id: 33, name: "Universal" },
  { id: 4, name: "Paramount" },
  { id: 174, name: "Warner Bros." },
  { id: 5, name: "Columbia" },
  { id: 25, name: "20th Century" },
  { id: 521, name: "DreamWorks" },
  { id: 41077, name: "A24" },
  { id: 923, name: "Legendary" },
];
const NETWORKS = [
  { id: 213, name: "Netflix" },
  { id: 49, name: "HBO" },
  { id: 2739, name: "Disney+" },
  { id: 1024, name: "Prime Video" },
  { id: 2552, name: "Apple TV+" },
  { id: 453, name: "Hulu" },
  { id: 4353, name: "Discovery+" },
  { id: 4330, name: "Paramount+" },
  { id: 3186, name: "HBO Max" },
  { id: 4, name: "BBC One" },
  { id: 332, name: "BBC Two" },
  { id: 26, name: "ITV" },
  { id: 1, name: "Fox" },
  { id: 6, name: "NBC" },
  { id: 2, name: "ABC" },
  { id: 16, name: "CBS" },
];

const ROWS = {
  recommended: { title: "Recommended for you", kind: "items", mediaType: "mixed" },
  "just-released-movies": { title: "Just released movies", kind: "items", mediaType: "movie" },
  "just-released-tv": { title: "Just released TV", kind: "items", mediaType: "tv" },
  "recently-added": { title: "Recently added", kind: "items", mediaType: "mixed" },
  "recent-requests": { title: "Recent requests", kind: "items", mediaType: "mixed" },
  trending: { title: "Trending", kind: "items", mediaType: "mixed" },
  "popular-movies": { title: "Popular movies", kind: "items", mediaType: "movie" },
  "movie-genres": { title: "Movie genres", kind: "chips", mediaType: "movie" },
  "upcoming-movies": { title: "Upcoming movies", kind: "items", mediaType: "movie" },
  studios: { title: "Studios", kind: "chips", mediaType: "movie" },
  "popular-tv": { title: "Popular TV", kind: "items", mediaType: "tv" },
  "tv-genres": { title: "TV genres", kind: "chips", mediaType: "tv" },
  "upcoming-tv": { title: "Upcoming TV", kind: "items", mediaType: "tv" },
  networks: { title: "Networks", kind: "chips", mediaType: "tv" },
};

// What shows when Seerr's slider settings cannot be read.
const DEFAULT_ORDER = [
  "recently-added",
  "recent-requests",
  "trending",
  "popular-movies",
  "movie-genres",
  "upcoming-movies",
  "studios",
  "popular-tv",
  "tv-genres",
  "upcoming-tv",
  "networks",
];

// Recommended and Just released are not Seerr sliders; they lead the page.
const LEADING_ROWS = ["recommended", "just-released-movies", "just-released-tv"];

function isReadOnlySeerr() {
  return ["1", "true", "yes"].includes(String(process.env.JG_READONLY_SEERR || "").toLowerCase());
}

function isSeerrIntegration(integration) {
  const name = String(integration?.name || integration?.slug || "").toLowerCase();
  return name === "seerr" || name.includes("jellyseerr") || name.includes("overseerr");
}

async function getSeerrSource(sourceId) {
  const integrations = await getIntegrations();
  const apps = (integrations.arrApps || []).filter((app) => app.connected && isSeerrIntegration(app));
  const app = sourceId ? apps.find((item) => item.instanceId === sourceId) : apps[0];
  if (!app) {
    const error = new Error("No connected Jellyseerr or Overseerr source found");
    error.statusCode = 404;
    throw error;
  }
  return app;
}

function tmdbImage(path, size) {
  if (!path) return null;
  return `https://image.tmdb.org/t/p/${size}${String(path).startsWith("/") ? path : `/${path}`}`;
}

function mediaStatus(mediaInfo) {
  const status = mediaInfo?.status;
  return { 2: "Pending", 3: "Processing", 4: "Partially available", 5: "Available", 6: "Blocklisted" }[status] || null;
}

// Seerr mediaInfo -> one status the badges use. "requested" means somebody asked for it
// and it is not (fully) in the library yet.
function describeAvailability(mediaInfo, inLibrary = false) {
  const label = mediaStatus(mediaInfo);
  if (label === "Available" || (inLibrary && !label)) return { availability: "Available", state: "available", requested: false };
  if (label === "Partially available") return { availability: label, state: "partial", requested: true };
  if (label === "Pending") return { availability: label, state: "pending", requested: true };
  if (label === "Processing") return { availability: label, state: "processing", requested: true };
  if (label === "Blocklisted") return { availability: label, state: "blocked", requested: false };
  return { availability: "Unknown", state: "none", requested: false };
}

function normalizeDiscoverItem(item, source, forcedType) {
  const mediaType = String(forcedType || item?.mediaType || item?.media_type || "").toLowerCase();
  if (!["movie", "tv"].includes(mediaType)) return null;
  const tmdbId = Number(item.id ?? item.tmdbId);
  if (!Number.isFinite(tmdbId)) return null;
  const posterPath = item.posterPath || item.poster_path || null;
  const backdropPath = item.backdropPath || item.backdrop_path || null;
  if (!posterPath && !backdropPath) return null;
  const releaseDate = item.releaseDate || item.firstAirDate || "";
  const info = describeAvailability(item.mediaInfo);
  return {
    id: `${source.instanceId}-${mediaType}-${tmdbId}`,
    sourceId: source.instanceId,
    source: source.name,
    mediaId: tmdbId,
    mediaType,
    title: item.title || item.name || item.originalTitle || item.originalName || "Untitled",
    year: releaseDate ? String(releaseDate).slice(0, 4) : "",
    releaseDate,
    overview: item.overview || "",
    rating: item.voteAverage || null,
    posterPath,
    posterUrl: tmdbImage(posterPath, "w342"),
    posterUrls: [tmdbImage(posterPath, "w342"), tmdbImage(posterPath, "w500")].filter(Boolean),
    backdropUrl: tmdbImage(backdropPath, "w780"),
    availability: info.availability,
    state: info.state,
    requested: info.requested,
    jellyfinItemId: item.mediaInfo?.jellyfinMediaId || null,
    inLibrary: info.state === "available" || info.state === "partial",
    isSearchResult: true,
  };
}

// Library match for titles Seerr has no media entry for (or has not synced yet).
async function markLibraryMatches(items) {
  const wanted = items.filter((item) => !item.jellyfinItemId);
  if (!wanted.length) return items;
  const names = [...new Set(wanted.map((item) => item.title.toLowerCase()))];
  const rows = await db
    .query(
      `SELECT "Id", "Name", "Type", "ProductionYear" FROM jf_library_items
       WHERE archived=false AND "Type" IN ('Movie','Series') AND lower("Name") = ANY($1::text[])`,
      [names]
    )
    .then((result) => result.rows || [])
    .catch(() => []);
  if (!rows.length) return items;
  for (const item of wanted) {
    const type = item.mediaType === "tv" ? "Series" : "Movie";
    const year = Number(item.year);
    const match = rows.find(
      (row) =>
        row.Type === type &&
        String(row.Name).toLowerCase() === item.title.toLowerCase() &&
        (!Number.isFinite(year) || !row.ProductionYear || Math.abs(Number(row.ProductionYear) - year) <= 1)
    );
    if (match) {
      item.jellyfinItemId = match.Id;
      item.inLibrary = true;
      if (item.state === "none") {
        item.state = "available";
        item.availability = "Available";
        item.requested = false;
      }
    }
  }
  return items;
}

function cached(key, ttl, load) {
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.promise;
  const promise = load().catch((error) => {
    cache.delete(key);
    throw error;
  });
  cache.set(key, { promise, expiresAt: Date.now() + ttl });
  if (cache.size > 300) {
    for (const [cacheKey, value] of cache) if (value.expiresAt <= Date.now()) cache.delete(cacheKey);
  }
  return promise;
}

function seerrGet(source, path, params) {
  return axios
    .get(`${stripTrailingSlashes(source.values?.url || "")}/api/v1${path}`, {
      timeout: 15000,
      headers: { "X-Api-Key": source.values?.secret },
      params,
    })
    .then((response) => response.data);
}

function isoDay(offsetDays = 0) {
  return new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);
}

// Seerr discover query for a plain row. Chips rows resolve through `chipId`.
function buildRowQuery(key, chipId) {
  const id = Number(chipId);
  switch (key) {
    case "trending":
      return { path: "/discover/trending", params: {} };
    case "popular-movies":
      return { path: "/discover/movies", params: {}, forcedType: "movie" };
    case "upcoming-movies":
      return { path: "/discover/movies/upcoming", params: {}, forcedType: "movie" };
    case "popular-tv":
      return { path: "/discover/tv", params: {}, forcedType: "tv" };
    case "upcoming-tv":
      return { path: "/discover/tv/upcoming", params: {}, forcedType: "tv" };
    case "just-released-movies":
      return {
        path: "/discover/movies",
        params: { sortBy: "popularity.desc", primaryReleaseDateGte: isoDay(-60), primaryReleaseDateLte: isoDay(0) },
        forcedType: "movie",
      };
    case "just-released-tv":
      return {
        path: "/discover/tv",
        params: { sortBy: "popularity.desc", firstAirDateGte: isoDay(-60), firstAirDateLte: isoDay(0) },
        forcedType: "tv",
      };
    case "movie-genres":
      return Number.isFinite(id) ? { path: `/discover/movies/genre/${id}`, params: {}, forcedType: "movie" } : null;
    case "tv-genres":
      return Number.isFinite(id) ? { path: `/discover/tv/genre/${id}`, params: {}, forcedType: "tv" } : null;
    case "studios":
      return Number.isFinite(id) ? { path: `/discover/movies/studio/${id}`, params: {}, forcedType: "movie" } : null;
    case "networks":
      return Number.isFinite(id) ? { path: `/discover/tv/network/${id}`, params: {}, forcedType: "tv" } : null;
    default:
      return null;
  }
}

async function loadDetailItem(source, mediaType, tmdbId) {
  const detail = await seerrGet(source, `/${mediaType}/${tmdbId}`);
  return normalizeDiscoverItem({ ...detail, id: tmdbId }, source, mediaType);
}

async function mapLimit(values, limit, worker) {
  const results = new Array(values.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, values.length) }, async () => {
      while (next < values.length) {
        const index = next++;
        results[index] = await worker(values[index]).catch(() => null);
      }
    })
  );
  return results;
}

// Seerr's own request/media lists only carry ids; fetch the title and art for each.
async function loadMediaRefs(source, refs) {
  const unique = [];
  const seen = new Set();
  for (const ref of refs) {
    const tmdbId = Number(ref.tmdbId);
    const type = String(ref.mediaType || "").toLowerCase();
    if (!Number.isFinite(tmdbId) || !["movie", "tv"].includes(type) || seen.has(`${type}-${tmdbId}`)) continue;
    seen.add(`${type}-${tmdbId}`);
    unique.push({ tmdbId, mediaType: type });
  }
  const items = await mapLimit(unique, 4, (ref) => loadDetailItem(source, ref.mediaType, ref.tmdbId));
  return items.filter(Boolean);
}

async function loadRecommendedSeeds(source) {
  return cached(`seeds:${source.instanceId}`, SEEDS_CACHE_TTL_MS, async () => {
    const data = await seerrGet(source, "/request", { take: 12, skip: 0, sort: "added", filter: "all" });
    const refs = (data.results || []).map((request) => ({ tmdbId: request.media?.tmdbId, mediaType: request.media?.mediaType }));
    const seeds = await loadMediaRefs(source, refs);
    return seeds.slice(0, 3);
  });
}

// Titles related to what people asked for lately: Seerr's own recommendations for the
// three most recent requests, interleaved so no single title dominates.
async function loadRecommended(source) {
  const seeds = await loadRecommendedSeeds(source);
  const lists = await Promise.all(
    seeds.map((seed) =>
      seerrGet(source, `/${seed.mediaType}/${seed.mediaId}/recommendations`, { page: 1 })
        .then((data) => (data.results || []).map((item) => normalizeDiscoverItem(item, source, seed.mediaType)).filter(Boolean))
        .catch(() => [])
    )
  );
  const seedIds = new Set(seeds.map((seed) => seed.id));
  const merged = [];
  const used = new Set();
  for (let index = 0; merged.length < MAX_ROW_ITEMS && lists.some((list) => index < list.length); index++) {
    for (const list of lists) {
      const item = list[index];
      if (!item || used.has(item.id) || seedIds.has(item.id)) continue;
      used.add(item.id);
      merged.push(item);
    }
  }
  return { items: merged.slice(0, MAX_ROW_ITEMS), totalPages: 1, because: seeds.map((seed) => seed.title) };
}

async function loadRowItems(source, key, { page, chipId }) {
  if (key === "recommended") return loadRecommended(source);
  if (key === "recently-added") {
    const data = await seerrGet(source, "/media", { take: 12, skip: 0, sort: "mediaAdded", filter: "allavailable" });
    return { items: await loadMediaRefs(source, data.results || []), totalPages: 1 };
  }
  if (key === "recent-requests") {
    const data = await seerrGet(source, "/request", { take: 12, skip: 0, sort: "added", filter: "all" });
    const refs = (data.results || []).map((request) => ({ tmdbId: request.media?.tmdbId, mediaType: request.media?.mediaType }));
    return { items: await loadMediaRefs(source, refs), totalPages: 1 };
  }
  const query = buildRowQuery(key, chipId);
  if (!query) {
    const error = new Error("Unknown discover row");
    error.statusCode = 400;
    throw error;
  }
  const data = await seerrGet(source, query.path, { ...query.params, page });
  const items = (data.results || []).map((item) => normalizeDiscoverItem(item, source, query.forcedType)).filter(Boolean);
  return { items: items.slice(0, MAX_ROW_ITEMS), totalPages: Math.min(Number(data.totalPages) || 1, 500) };
}

async function getDiscoverRows(source) {
  let order = DEFAULT_ORDER;
  let sliderSource = "default";
  try {
    const sliders = await cached(`sliders:${source.instanceId}`, ROW_CACHE_TTL_MS, () => seerrGet(source, "/settings/discover"));
    const mapped = (Array.isArray(sliders) ? sliders : [])
      .filter((slider) => slider.enabled !== false)
      .sort((a, b) => Number(a.order) - Number(b.order))
      .map((slider) => SLIDER_ROWS[slider.type])
      .filter(Boolean);
    if (mapped.length) {
      order = mapped;
      sliderSource = "seerr";
    }
  } catch {
    // Seerr only shares slider settings with an admin key; the default order is fine.
  }
  const keys = [...LEADING_ROWS, ...order.filter((key) => !LEADING_ROWS.includes(key))];
  return {
    sourceId: source.instanceId,
    source: source.name,
    readOnly: isReadOnlySeerr(),
    sliderSource,
    rows: keys.map((key) => ({ key, ...ROWS[key] })),
  };
}

async function getDiscoverRow(source, key, { page = 1, chipId } = {}) {
  const row = ROWS[key];
  if (!row) {
    const error = new Error("Unknown discover row");
    error.statusCode = 400;
    throw error;
  }
  const pageNumber = Math.min(Math.max(Number(page) || 1, 1), 500);
  if (row.kind === "chips" && (chipId === undefined || chipId === "")) {
    let chips;
    if (key === "studios") chips = STUDIOS;
    else if (key === "networks") chips = NETWORKS;
    else {
      const genres = await cached(`genres:${source.instanceId}:${row.mediaType}`, SEEDS_CACHE_TTL_MS, () => seerrGet(source, `/genres/${row.mediaType}`));
      chips = (Array.isArray(genres) ? genres : []).map((genre) => ({ id: genre.id, name: genre.name }));
    }
    return { key, title: row.title, kind: "chips", mediaType: row.mediaType, chips };
  }
  const result = await cached(`row:${source.instanceId}:${key}:${chipId ?? ""}:${pageNumber}`, ROW_CACHE_TTL_MS, async () => {
    const loaded = await loadRowItems(source, key, { page: pageNumber, chipId });
    // Copy so the per-call library marks never leak back into the cached rows.
    const items = await markLibraryMatches(loaded.items.map((item) => ({ ...item })));
    return { ...loaded, items };
  });
  return {
    key,
    title: row.title,
    kind: "items",
    mediaType: row.mediaType,
    chipId: chipId ?? null,
    page: pageNumber,
    totalPages: result.totalPages,
    hasMore: pageNumber < result.totalPages,
    because: result.because || undefined,
    items: result.items,
  };
}

module.exports = {
  ROWS,
  STUDIOS,
  NETWORKS,
  isReadOnlySeerr,
  describeAvailability,
  normalizeDiscoverItem,
  buildRowQuery,
  getSeerrSource,
  getDiscoverRows,
  getDiscoverRow,
};

// Live download progress for requests. Reads the Sonarr and Radarr queue endpoints (and
// qBittorrent through the existing download client integration) and lines each queue
// entry up with the request it belongs to. Seerr's own download status is the fallback,
// for setups where the *arr apps aren't connected to JellyGlance. Everything here is
// read-only.
//
// Demo only: when JG_DEMO_SESSIONS=1 and nothing live is downloading (the demo has no
// working route to the *arr apps or qBittorrent), a few approved requests get clearly
// labelled simulated progress, so the bars can be seen. Real data always wins.
const { axios } = require("./axios");
const { getIntegrations } = require("./integration-store");

const ARR_TIMEOUT_MS = 8000;
const CACHE_TTL_MS = 5000;
// Requests that can still be downloading.
const ACTIVE_STATUSES = new Set(["approved", "processing", "partial", "partially available"]);

const norm = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");

// "00:12:34", "1.02:03:04" (days.hours:minutes:seconds) -> seconds.
function parseTimeLeft(value) {
  const text = String(value || "").trim();
  const match = text.match(/^(?:(\d+)\.)?(\d{1,2}):(\d{2}):(\d{2})(?:\.\d+)?$/);
  if (!match) return null;
  return Number(match[1] || 0) * 86400 + Number(match[2]) * 3600 + Number(match[3]) * 60 + Number(match[4]);
}

function etaLabel(seconds) {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return "";
  if (seconds < 60) return "< 1 min";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h${minutes % 60 ? ` ${minutes % 60} min` : ""}`;
  const days = Math.floor(hours / 24);
  return `${days} d${hours % 24 ? ` ${hours % 24} h` : ""}`;
}

function formatSpeed(bytesPerSecond) {
  const value = Number(bytesPerSecond || 0);
  if (!(value > 0)) return "";
  const units = ["B/s", "KB/s", "MB/s", "GB/s"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)));
  const scaled = value / 1024 ** index;
  return `${scaled >= 100 || index === 0 ? Math.round(scaled) : scaled.toFixed(1)} ${units[index]}`;
}

function percent(size, left) {
  const total = Number(size || 0);
  if (!(total > 0)) return 0;
  return Math.min(100, Math.max(0, Math.round(((total - Math.min(total, Math.max(0, Number(left || 0)))) / total) * 100)));
}

// One state vocabulary for the UI: downloading, queued, paused, stalled, importing, failed.
function arrState(record) {
  const status = String(record.status || "").toLowerCase();
  const tracked = String(record.trackedDownloadState || "").toLowerCase();
  const trackedStatus = String(record.trackedDownloadStatus || "").toLowerCase();
  if (status === "failed" || tracked === "failed" || tracked === "failedpending") return "failed";
  if (tracked === "importblocked") return "failed";
  if (tracked === "importpending" || tracked === "importing" || tracked === "imported") return "importing";
  if (status === "paused") return "paused";
  if (status === "queued" || status === "delay" || status === "downloadclientunavailable") return "queued";
  if (trackedStatus === "warning" && /stall|no connection|not seeding/i.test(JSON.stringify(record.statusMessages || []))) return "stalled";
  return "downloading";
}

function qbitState(state, progress) {
  const text = String(state || "").toLowerCase();
  if (text.includes("error") || text.includes("missing")) return "failed";
  if (text.includes("stalled") && !text.includes("up")) return "stalled";
  if (text.includes("paus") || text.includes("stopp")) return "paused";
  if (text.includes("queue") || text.includes("check") || text.includes("meta")) return "queued";
  if (Number(progress) >= 100 || text.includes("up")) return "importing";
  return "downloading";
}

function episodeLabel(record) {
  const season = record.episode?.seasonNumber ?? record.seasonNumber;
  const episode = record.episode?.episodeNumber ?? record.episodeNumber;
  if (season == null || episode == null) return "";
  return `S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}`;
}

// A Sonarr or Radarr queue record, trimmed to what the rows show. `service` is "Sonarr" or "Radarr".
function normalizeArrQueueRecord(service, record = {}) {
  const size = Number(record.size || 0);
  const left = Number(record.sizeleft ?? record.sizeLeft ?? 0);
  const etaSeconds = parseTimeLeft(record.timeleft ?? record.timeLeft);
  return {
    source: service,
    mediaType: service === "Radarr" ? "movie" : "tv",
    title: record.movie?.title || record.series?.title || record.title || "",
    tmdbId: record.movie?.tmdbId || record.series?.tmdbId || null,
    tvdbId: record.series?.tvdbId || null,
    episode: episodeLabel(record),
    size,
    sizeLeft: left,
    progress: percent(size, left),
    etaSeconds,
    state: arrState(record),
    client: record.downloadClient || "",
    hash: record.downloadId ? String(record.downloadId).toLowerCase() : null,
    error: record.errorMessage || "",
  };
}

// Seerr's media.downloadStatus entries (it reads the same queues itself).
function normalizeSeerrDownloadStatus(list = []) {
  return (Array.isArray(list) ? list : []).map((entry) => {
    const size = Number(entry.size || 0);
    const left = Number(entry.sizeLeft || 0);
    const etaMs = entry.estimatedCompletionTime ? new Date(entry.estimatedCompletionTime).getTime() - Date.now() : NaN;
    return {
      source: "Seerr",
      title: entry.title || "",
      episode: entry.episode ? episodeLabel({ episode: { seasonNumber: entry.episode.seasonNumber, episodeNumber: entry.episode.episodeNumber } }) : "",
      size,
      sizeLeft: left,
      progress: percent(size, left),
      etaSeconds: parseTimeLeft(entry.timeLeft) ?? (Number.isFinite(etaMs) ? Math.max(0, Math.round(etaMs / 1000)) : null),
      state: String(entry.status || "").toLowerCase().includes("paus") ? "paused" : "downloading",
    };
  });
}

function isActiveRequest(request) {
  return ACTIVE_STATUSES.has(String(request?.status || "").toLowerCase());
}

// Which queue records belong to a request: same TMDB or TVDB id, else the same title.
function recordMatchesRequest(request, record) {
  const kind = String(request.mediaType || "").toLowerCase().startsWith("tv") ? "tv" : "movie";
  if (record.mediaType && record.mediaType !== kind) return false;
  const tmdb = request.externalIds?.tmdbId;
  const tvdb = request.externalIds?.tvdbId;
  if (tmdb && record.tmdbId && Number(tmdb) === Number(record.tmdbId)) return true;
  if (tvdb && record.tvdbId && Number(tvdb) === Number(record.tvdbId)) return true;
  if (record.tmdbId || record.tvdbId) return false;
  return Boolean(record.title) && norm(record.title) === norm(request.title);
}

const STATE_RANK = { failed: 5, stalled: 4, paused: 3, queued: 2, importing: 1, downloading: 0 };

// Several records (a season's episodes) become one entry: total size done, longest wait,
// and the most worrying state.
function aggregate(records) {
  const rows = records.filter(Boolean);
  if (!rows.length) return null;
  const size = rows.reduce((sum, row) => sum + Number(row.size || 0), 0);
  const left = rows.reduce((sum, row) => sum + Number(row.sizeLeft || 0), 0);
  const known = rows.filter((row) => row.etaSeconds != null);
  const worst = [...rows].sort((a, b) => (STATE_RANK[b.state] || 0) - (STATE_RANK[a.state] || 0))[0];
  const etaSeconds = known.length ? Math.max(...known.map((row) => row.etaSeconds)) : null;
  const episodes = rows.map((row) => row.episode).filter(Boolean);
  const speedBytes = rows.reduce((sum, row) => sum + Number(row.speedBytes || 0), 0);
  return {
    state: worst.state,
    progress: size > 0 ? percent(size, left) : Math.round(rows.reduce((sum, row) => sum + Number(row.progress || 0), 0) / rows.length),
    etaSeconds: worst.state === "downloading" || worst.state === "importing" ? etaSeconds : null,
    etaLabel: worst.state === "downloading" ? etaLabel(etaSeconds) : "",
    speed: formatSpeed(speedBytes),
    client: rows.find((row) => row.client)?.client || "",
    source: rows[0].source,
    count: rows.length,
    episodes: episodes.slice(0, 4),
    error: rows.find((row) => row.error)?.error || "",
    simulated: false,
  };
}

// Pure: line the sources up with the requests. `torrents` are download client items
// ({ hash, state, progress, speedBytes, eta }); they refine an *arr record they match.
function buildProgress(requests, { arrRecords = [], torrents = [] } = {}) {
  const byHash = new Map(torrents.filter((item) => item.hash).map((item) => [String(item.hash).toLowerCase(), item]));
  const items = {};
  for (const request of requests || []) {
    if (!isActiveRequest(request)) continue;
    let records = arrRecords.filter((record) => recordMatchesRequest(request, record)).map((record) => {
      const torrent = record.hash ? byHash.get(record.hash) : null;
      if (!torrent) return record;
      const state = qbitState(torrent.state, torrent.progress);
      return {
        ...record,
        state: STATE_RANK[state] > STATE_RANK[record.state] ? state : record.state,
        speedBytes: torrent.speedBytes || 0,
        etaSeconds: record.etaSeconds ?? torrent.eta ?? null,
        client: record.client || torrent.client || "qBittorrent",
      };
    });
    if (!records.length && Array.isArray(request.downloadStatus) && request.downloadStatus.length) records = request.downloadStatus;
    const entry = aggregate(records);
    if (entry) items[request.id] = entry;
  }
  return items;
}

// ---- demo simulation ----------------------------------------------------------------

const STARTED_AT = Date.now();

function hashNumber(text) {
  let h = 2166136261;
  for (const ch of String(text)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return h;
}

// Deterministic per request, moving with the clock: ~one percent every 10-40 seconds.
function simulateProgress(requests, now = Date.now(), startedAt = STARTED_AT, limit = 7) {
  const candidates = (requests || []).filter(isActiveRequest).filter((request) => request.availability?.status !== "Available");
  const items = {};
  candidates.slice(0, limit).forEach((request, index) => {
    const seed = hashNumber(request.id);
    const state = index === limit - 1 ? "queued" : index === limit - 2 ? "stalled" : "downloading";
    const sizeBytes = (1.2 + (seed % 90) / 10) * 1024 ** 3 * (String(request.mediaType).startsWith("tv") ? 3 : 1);
    const ratePerSecond = (0.025 + (seed % 7) * 0.012);
    const offset = 6 + (seed % 55);
    const raw = offset + ((now - startedAt) / 1000) * ratePerSecond;
    const progress = state === "queued" ? 0 : state === "stalled" ? 20 + (seed % 40) : Math.min(99, Math.floor(raw % 100));
    const etaSeconds = state === "downloading" ? Math.round(((100 - progress) / ratePerSecond) * 1) : null;
    const speedBytes = state === "downloading" ? (sizeBytes * ratePerSecond) / 100 : 0;
    items[request.id] = {
      state,
      progress,
      etaSeconds,
      etaLabel: state === "downloading" ? etaLabel(etaSeconds) : "",
      speed: formatSpeed(speedBytes),
      client: "qBittorrent",
      source: String(request.mediaType).startsWith("tv") ? "Sonarr" : "Radarr",
      count: 1,
      episodes: [],
      error: "",
      simulated: true,
    };
  });
  return items;
}

function demoSimulationEnabled() {
  return process.env.JG_DEMO_SESSIONS === "1" && process.env.JG_DEMO_DOWNLOADS !== "0";
}

// ---- live reads ---------------------------------------------------------------------

function cleanUrl(url) {
  return String(url || "").trim().replace(/\/+$/, "");
}

function arrService(app) {
  const name = String(app?.name || app?.slug || "").toLowerCase();
  if (name.includes("sonarr")) return "Sonarr";
  if (name.includes("radarr")) return "Radarr";
  return null;
}

async function fetchArrQueue(app) {
  const service = arrService(app);
  const url = cleanUrl(app.values?.url);
  const apiKey = app.values?.secret;
  if (!service || !url || !apiKey) return { service, ok: false, records: [], error: "Needs a URL and API key" };
  try {
    const response = await axios.get(`${url}/api/v3/queue`, {
      timeout: ARR_TIMEOUT_MS,
      headers: { "X-Api-Key": apiKey },
      params: { page: 1, pageSize: 200, includeMovie: service === "Radarr", includeSeries: service === "Sonarr", includeEpisode: service === "Sonarr" },
    });
    const records = Array.isArray(response.data?.records) ? response.data.records : Array.isArray(response.data) ? response.data : [];
    return { service, ok: true, records: records.map((record) => normalizeArrQueueRecord(service, record)) };
  } catch (error) {
    return { service, ok: false, records: [], error: error.response?.status ? `HTTP ${error.response.status}` : error.code || "Unreachable" };
  }
}

function speedBytesOf(item) {
  const text = String(item.down || "");
  const match = text.match(/([\d.]+)\s*([KMGT]?B)/i);
  if (!match) return 0;
  return Number(match[1]) * ({ B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3, TB: 1024 ** 4 }[match[2].toUpperCase()] || 1);
}

async function fetchTorrents(client) {
  try {
    const { fetchClientQueue, clientKind } = require("./download-client");
    if (clientKind(client) !== "qbittorrent") return { ok: false, items: [] };
    const result = await fetchClientQueue(client);
    if (result.error) return { ok: false, items: [], error: result.error };
    return {
      ok: true,
      items: (result.items || []).map((item) => ({
        hash: item.hash ? String(item.hash).toLowerCase() : null,
        state: item.state,
        progress: item.progress,
        speedBytes: speedBytesOf(item),
        eta: item.eta ?? null,
        client: item.client,
      })),
    };
  } catch (error) {
    return { ok: false, items: [], error: error.message || "Unreachable" };
  }
}

let cache = { at: 0, value: null, promise: null };

// One read of every connected source, cached for a few seconds so several open tabs
// don't each hit the *arr apps.
async function readSources() {
  if (cache.value && Date.now() - cache.at < CACHE_TTL_MS) return cache.value;
  if (cache.promise) return cache.promise;
  cache.promise = (async () => {
    const integrations = await getIntegrations();
    const apps = (integrations.arrApps || []).filter((app) => app.connected && arrService(app));
    const clients = (integrations.clients || []).filter((client) => client.connected);
    const [queues, torrentResults] = await Promise.all([
      Promise.all(apps.map(fetchArrQueue)),
      Promise.all(clients.map(fetchTorrents)),
    ]);
    const value = {
      arrRecords: queues.flatMap((queue) => queue.records),
      torrents: torrentResults.flatMap((result) => result.items),
      sources: [
        ...queues.map((queue) => ({ name: queue.service, ok: queue.ok, error: queue.ok ? "" : queue.error })),
        ...clients.map((client, index) => ({ name: client.name, ok: torrentResults[index].ok, error: torrentResults[index].ok ? "" : torrentResults[index].error || "" })),
      ],
    };
    cache = { at: Date.now(), value, promise: null };
    return value;
  })().catch((error) => {
    cache = { at: 0, value: null, promise: null };
    throw error;
  });
  return cache.promise;
}

async function getProgress(requests) {
  let sources = { arrRecords: [], torrents: [], sources: [] };
  try {
    sources = await readSources();
  } catch (error) {
    console.log("[REQUESTS] Download progress sources unavailable:", error.message || error);
  }
  let items = buildProgress(requests, sources);
  let simulated = false;
  if (!Object.keys(items).length && demoSimulationEnabled()) {
    items = simulateProgress(requests);
    simulated = Object.keys(items).length > 0;
  }
  return {
    items,
    simulated,
    sources: sources.sources,
    updatedAt: new Date().toISOString(),
  };
}

module.exports = {
  parseTimeLeft,
  etaLabel,
  formatSpeed,
  normalizeArrQueueRecord,
  normalizeSeerrDownloadStatus,
  recordMatchesRequest,
  aggregate,
  buildProgress,
  simulateProgress,
  demoSimulationEnabled,
  getProgress,
};

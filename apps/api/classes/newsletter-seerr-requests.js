// Read-only Seerr request list for newsletter blocks. GET only; never approve,
// decline, retry or submit a request.
const db = require("../db");
const { axios } = require("./axios");
const { getIntegrations } = require("./integration-store");

const STATUS_MAP = { 1: "Pending", 2: "Approved", 3: "Declined", 4: "Failed", 5: "Available" };
const DAY_MS = 86400000;

function cleanUrl(url = "") {
  return String(url || "").trim().replace(/\/+$/, "");
}

function isSeerrApp(app) {
  const name = String(app?.name || app?.slug || "").toLowerCase();
  return Boolean(app?.connected) && (name.includes("jellyseerr") || name.includes("overseerr") || name === "seerr");
}

function stamp(value) {
  const time = Date.parse(value || "");
  return Number.isFinite(time) ? time : null;
}

function normalizeLite(item, app) {
  const media = item.media || item.mediaInfo || {};
  const requester = item.requestedBy || item.requestedByUser || {};
  const requestedBy = requester.displayName || requester.jellyfinUsername || requester.username || requester.email || "";
  const status = STATUS_MAP[item.status] || item.statusLabel || item.status || "Unknown";
  const mediaStatus = STATUS_MAP[media.status] || media.statusLabel || media.status || "";
  const title = media.title || media.name || item.title || item.name || "Request";
  const jellyfinId = media.jellyfinMediaId || media.jellyfinId || media.jellyfinItemId || media.ratingKey || "";
  return {
    id: item.id,
    requestId: item.id,
    source: app.name || "Seerr",
    Name: title,
    title,
    Type: media.mediaType || item.type || item.mediaType || "Request",
    mediaType: media.mediaType || item.type || item.mediaType || "media",
    status: status === "Available" || mediaStatus === "Available" ? "Available" : status,
    requestedBy,
    createdAt: item.createdAt || item.updatedAt || null,
    mediaAddedAt: media.mediaAddedAt || null,
    mediaUpdatedAt: media.mediaAddedAt || media.updatedAt || media.mediaUpdatedAt || null,
    Id: jellyfinId,
    mediaId: jellyfinId || media.id || "",
    PrimaryImageHash: "",
    releaseDate: media.releaseDate || media.airDate || media.firstAirDate || "",
    externalIds: { tmdbId: media.tmdbId || null, tvdbId: media.tvdbId || null, imdbId: media.imdbId || null },
    availability: { status: mediaStatus || status },
    nextEpisode: null,
  };
}

async function fetchLiteSeerrRequests({ userName = "", take = 100, fetchJson } = {}) {
  const integrations = await getIntegrations().catch(() => ({ arrApps: [] }));
  const apps = (integrations.arrApps || []).filter(isSeerrApp);
  if (!apps.length) return [];
  const needle = String(userName || "").toLowerCase();
  const requests = [];
  for (const app of apps) {
    const url = cleanUrl(app.values?.url);
    if (!url) continue;
    try {
      const get = fetchJson || (async (path, params) => {
        const response = await axios.get(`${url}${path}`, {
          timeout: 8000,
          headers: { "X-Api-Key": app.values.secret, Accept: "application/json" },
          params,
        });
        return response.data;
      });
      const data = await get("/api/v1/request", { take, skip: 0, sort: "added" });
      const rows = data?.results || data || [];
      for (const row of Array.isArray(rows) ? rows : []) {
        const item = normalizeLite(row, app);
        if (needle && !String(item.requestedBy).toLowerCase().includes(needle)) continue;
        requests.push(item);
      }
    } catch {
      // Skip this Seerr instance and keep building the digest.
    }
  }
  return requests;
}

function fulfilledAt(request) {
  if (request?.status !== "Available") return null;
  return stamp(request.mediaAddedAt) ?? stamp(request.mediaUpdatedAt);
}

function listFulfilledFrom(requests, { lastSentAt = null, days = 7, limit = 12, now = new Date() } = {}) {
  const until = now instanceof Date ? now.getTime() : Date.parse(now);
  const since = lastSentAt && Number.isFinite(Date.parse(lastSentAt))
    ? Date.parse(lastSentAt)
    : until - Math.max(1, Number(days) || 7) * DAY_MS;
  return (requests || [])
    .map((request) => {
      const at = fulfilledAt(request);
      return at != null && at >= since && at <= until ? { ...request, fulfilledAt: new Date(at).toISOString() } : null;
    })
    .filter(Boolean)
    .sort((a, b) => Date.parse(b.fulfilledAt) - Date.parse(a.fulfilledAt))
    .slice(0, limit);
}


async function enrichFromLibrary(requests) {
  const ids = [...new Set((requests || []).map((item) => String(item.Id || item.mediaId || "")).filter(Boolean))];
  if (!ids.length) return requests || [];
  const { rows } = await db.query(
    `SELECT i."Id" AS id, i."Name" AS name, i."Type" AS type, i."PrimaryImageHash" AS primary_image_hash, i."ProductionYear" AS year
       FROM jf_library_items i
      WHERE i."Id" = ANY($1)`,
    [ids]
  ).catch(() => ({ rows: [] }));
  const byId = new Map(rows.map((row) => [String(row.id), row]));
  return (requests || []).map((item) => {
    const row = byId.get(String(item.Id || item.mediaId || ""));
    if (!row) return item;
    return {
      ...item,
      Name: row.name || item.Name,
      title: row.name || item.title,
      Type: row.type || item.Type,
      PrimaryImageHash: row.primary_image_hash || item.PrimaryImageHash || "",
      ProductionYear: row.year || "",
    };
  });
}

async function listFulfilledRequests({ lastSentAt = null, days = 7, limit = 12, userName = "", now = new Date(), fetchJson } = {}) {
  const requests = await enrichFromLibrary(await fetchLiteSeerrRequests({ userName, take: 100, fetchJson }));
  return listFulfilledFrom(requests, { lastSentAt, days, limit, now });
}

module.exports = {
  fetchLiteSeerrRequests,
  listFulfilledRequests,
  listFulfilledFrom,
  fulfilledAt,
  normalizeLite,
  enrichFromLibrary,
};

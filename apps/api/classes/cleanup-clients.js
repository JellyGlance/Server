// Clients used by live cleanup runs: the media server (tags, Leaving soon) and Sonarr/Radarr
// (unmonitor, delete). Items are matched to the Arr by TMDB/TVDB/IMDb id from the media server.
const mediaServer = require("./media-server-collections");
const { getIntegrations } = require("./integration-store");
const { safeHttpGet, joinSafeHttpUrl } = require("../utils/security");
const { axios } = require("./axios");

function cleanUrl(url = "") {
  return String(url).trim().replace(/\/+$/, "");
}

function findApp(apps, kind) {
  return apps.find((app) => app.connected && String(app.slug || app.name || "").toLowerCase().includes(kind) && cleanUrl(app.values?.url) && app.values?.secret);
}

function providerIds(item) {
  const ids = item?.ProviderIds || {};
  const pick = (key) => ids[key] || ids[key.toLowerCase()] || ids[key.toUpperCase()] || null;
  return { tmdb: pick("Tmdb"), tvdb: pick("Tvdb"), imdb: pick("Imdb") };
}

function normalizeTitle(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

async function arrRequest(app, method, path, { params, data } = {}) {
  const response = await axios.request({
    method,
    url: joinSafeHttpUrl(cleanUrl(app.values.url), path),
    params,
    data,
    timeout: 20000,
    headers: { "X-Api-Key": app.values.secret, "Content-Type": "application/json" },
  });
  return response.data;
}

async function arrGet(app, path, params) {
  const response = await safeHttpGet(cleanUrl(app.values.url), path, { timeout: 20000, params, headers: { "X-Api-Key": app.values.secret } });
  return response.data;
}

function httpError(message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode });
}

async function createArrCleanupClient() {
  const integrations = await getIntegrations();
  const apps = integrations.arrApps || [];
  const radarr = findApp(apps, "radarr");
  const sonarr = findApp(apps, "sonarr");
  const cache = new Map();

  // Find the Radarr movie or Sonarr series for a media server item.
  async function resolve(item) {
    if (cache.has(item.id)) return cache.get(item.id);
    const full = await mediaServer.getFullItem(item.id).catch(() => null);
    const ids = providerIds(full);
    const isSeries = String(item.type || full?.Type || "").toLowerCase() === "series";
    let result = null;
    if (isSeries) {
      if (!sonarr) throw httpError("Connect Sonarr to unmonitor or delete TV shows", 503);
      let rows = ids.tvdb ? await arrGet(sonarr, "/api/v3/series", { tvdbId: ids.tvdb }).catch(() => []) : [];
      if (!Array.isArray(rows) || !rows.length) {
        const all = await arrGet(sonarr, "/api/v3/series");
        rows = (all || []).filter((row) => (ids.imdb && row.imdbId === ids.imdb) || (normalizeTitle(row.title) === normalizeTitle(item.name) && (!item.year || Number(row.year) === Number(item.year))));
      }
      if (rows?.[0]) result = { app: sonarr, kind: "series", id: rows[0].id, title: rows[0].title };
    } else {
      if (!radarr) throw httpError("Connect Radarr to unmonitor or delete movies", 503);
      let rows = ids.tmdb ? await arrGet(radarr, "/api/v3/movie", { tmdbId: ids.tmdb }).catch(() => []) : [];
      if (!Array.isArray(rows) || !rows.length) {
        const all = await arrGet(radarr, "/api/v3/movie");
        rows = (all || []).filter((row) => (ids.imdb && row.imdbId === ids.imdb) || (normalizeTitle(row.title) === normalizeTitle(item.name) && (!item.year || Number(row.year) === Number(item.year))));
      }
      if (rows?.[0]) result = { app: radarr, kind: "movie", id: rows[0].id, title: rows[0].title };
    }
    if (!result) throw httpError(`“${item.name}” was not found in ${isSeries ? "Sonarr" : "Radarr"}`, 404);
    cache.set(item.id, result);
    return result;
  }

  return {
    async unmonitor(item) {
      const target = await resolve(item);
      if (target.kind === "movie") await arrRequest(target.app, "put", "/api/v3/movie/editor", { data: { movieIds: [target.id], monitored: false } });
      else await arrRequest(target.app, "put", "/api/v3/series/editor", { data: { seriesIds: [target.id], monitored: false } });
      return true;
    },
    // Ask Radarr/Sonarr to look for a better release (quality upgrade finder).
    async search(item) {
      const target = await resolve(item);
      if (target.kind === "movie") await arrRequest(target.app, "post", "/api/v3/command", { data: { name: "MoviesSearch", movieIds: [target.id] } });
      else await arrRequest(target.app, "post", "/api/v3/command", { data: { name: "SeriesSearch", seriesId: target.id } });
      return { app: target.kind === "movie" ? "Radarr" : "Sonarr", title: target.title };
    },
    async delete(item, { deleteFiles = true } = {}) {
      const target = await resolve(item);
      const path = target.kind === "movie" ? `/api/v3/movie/${target.id}` : `/api/v3/series/${target.id}`;
      await arrRequest(target.app, "delete", path, { params: { deleteFiles: Boolean(deleteFiles), addImportExclusion: false, addImportListExclusion: false } });
      return true;
    },
  };
}

function createMediaServerCleanupClient() {
  return {
    addTag: (itemId, tag) => mediaServer.addTag(itemId, tag),
    addToCollection: (itemId, collection) => mediaServer.addToCollection(itemId, collection),
  };
}

module.exports = { createArrCleanupClient, createMediaServerCleanupClient };

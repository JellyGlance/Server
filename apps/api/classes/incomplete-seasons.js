const axios = require("axios");
const db = require("../db");
const API = require("./api-loader");
const { getIntegrations } = require("./integration-store");
const { stripTrailingSlashes, toSafeHttpUrl } = require("../utils/security");

const TVDB_KEYS = ["Tvdb", "TVDB", "TheTVDB", "tvdb"];

function firstProviderId(ids, keys = TVDB_KEYS) {
  if (!ids || typeof ids !== "object") return null;
  for (const key of keys) {
    const value = ids[key];
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return null;
}

function normTitle(value) {
  return String(value || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/\(\d{4}\)/g, "").replace(/&/g, "and").replace(/[^a-z0-9]+/g, "");
}

function parseIndexes(value) {
  const list = Array.isArray(value) ? value : String(value || "").replace(/[{}]/g, "").split(",");
  return [...new Set(list.map(Number).filter((n) => Number.isInteger(n) && n > 0))].sort((a, b) => a - b);
}

// Pure: work out whether one season is incomplete.
// - With a Sonarr expected count, the season is short when we hold fewer episodes than Sonarr says have aired.
// - Without Sonarr, gaps in the episode numbering (e.g. 1,2,4,5 → 3 missing) mark it incomplete.
function detectSeason({ episodes, indexes, expected }) {
  const have = parseIndexes(indexes);
  const count = Math.max(Number(episodes) || 0, have.length);
  const maxIndex = have.length ? have[have.length - 1] : 0;
  const target = Number(expected) > 0 ? Number(expected) : 0;
  const upper = target || maxIndex;
  const owned = new Set(have);
  const missingNumbers = [];
  for (let n = 1; n <= upper && missingNumbers.length < 200; n += 1) if (!owned.has(n)) missingNumbers.push(n);
  const missing = target ? Math.max(0, target - count) : missingNumbers.length;
  return {
    have: count,
    expected: target || null,
    missing,
    missingNumbers: missing ? missingNumbers.slice(0, 50) : [],
    source: target ? "sonarr" : "numbering",
    incomplete: missing > 0,
  };
}

// Pure: the Sonarr series that matches a Jellyfin series (TVDB id first, then title + year).
function matchSonarr(series, sonarrSeries) {
  const list = sonarrSeries || [];
  if (series.tvdbId) {
    const byId = list.find((s) => String(s.tvdbId) === String(series.tvdbId));
    if (byId) return byId;
  }
  const want = normTitle(series.title);
  const candidates = list.filter((s) => normTitle(s.title) === want);
  if (candidates.length <= 1 || !series.year) return candidates[0] || null;
  return candidates.find((s) => Number(s.year) === Number(series.year)) || candidates[0];
}

function tvdbUrl(tvdbId) {
  return tvdbId && /^\d+$/.test(String(tvdbId)) ? `https://thetvdb.com/dereferrer/series/${tvdbId}` : null;
}

function sonarrUrl(sonarr, match) {
  if (!sonarr?.url) return null;
  if (match?.titleSlug) return `${sonarr.url}/series/${encodeURIComponent(match.titleSlug)}`;
  return null;
}

// Pure: roll season rows into one report row per incomplete series.
function buildReport(seasonRows, { sonarr = null, sonarrSeries = [], providerIds = {} } = {}) {
  const bySeries = new Map();
  for (const row of seasonRows) {
    const key = row.series_id || row.series_name;
    if (!key) continue;
    const entry = bySeries.get(key) || { id: row.series_id, title: row.series_name, year: row.year || null, library: row.library || null, seasons: [] };
    entry.seasons.push(row);
    bySeries.set(key, entry);
  }
  const items = [];
  for (const series of bySeries.values()) {
    const tvdbId = firstProviderId(providerIds[series.id]);
    const match = sonarr ? matchSonarr({ ...series, tvdbId }, sonarrSeries) : null;
    const sonarrSeasons = new Map((match?.seasons || []).map((s) => [Number(s.seasonNumber), s]));
    const seasons = series.seasons
      .map((row) => {
        const number = Number(row.season);
        const stats = sonarrSeasons.get(number)?.statistics;
        const result = detectSeason({ episodes: row.episodes, indexes: row.indexes, expected: stats?.episodeCount });
        return { season: number, name: row.season_name || `Season ${number}`, ...result };
      })
      .filter((s) => s.incomplete)
      .sort((a, b) => a.season - b.season);
    if (!seasons.length) continue;
    const finalTvdb = tvdbId || (match?.tvdbId ? String(match.tvdbId) : null);
    items.push({
      key: `series:${series.id || series.title}`,
      id: series.id,
      title: series.title,
      year: series.year,
      library: series.library,
      missing: seasons.reduce((sum, s) => sum + s.missing, 0),
      seasons,
      tvdbId: finalTvdb,
      links: {
        sonarr: sonarrUrl(sonarr, match),
        sonarrSearch: sonarr?.url && !match ? `${sonarr.url}/add/new?term=${encodeURIComponent(finalTvdb ? `tvdb:${finalTvdb}` : series.title || "")}` : null,
        tvdb: tvdbUrl(finalTvdb),
      },
      sonarrMatched: Boolean(match),
    });
  }
  return items.sort((a, b) => b.missing - a.missing || String(a.title).localeCompare(String(b.title)));
}

async function getSonarr() {
  const integrations = await getIntegrations().catch(() => ({ arrApps: [] }));
  const app = (integrations.arrApps || []).find(
    (integration) => integration?.connected && /sonarr/i.test(String(integration.slug || integration.name || "")) && integration.values?.url && integration.values?.secret
  );
  if (!app) return null;
  try {
    const url = stripTrailingSlashes(toSafeHttpUrl(stripTrailingSlashes(app.values.url)));
    return url ? { url, key: app.values.secret, name: app.name || "Sonarr" } : null;
  } catch {
    return null;
  }
}

async function fetchSonarrSeries(sonarr, http = axios) {
  if (!sonarr) return [];
  const response = await http.get(`${sonarr.url}/api/v3/series`, { timeout: 20000, headers: { "X-Api-Key": sonarr.key, Accept: "application/json" } });
  return Array.isArray(response.data) ? response.data : [];
}

async function fetchProviderIds(seriesIds) {
  const out = {};
  const ids = [...new Set(seriesIds.filter(Boolean))];
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const items = await API.getItemsByID({ ids: chunk.join(","), params: { limit: chunk.length, increment: chunk.length } }).catch(() => []);
    for (const item of items || []) if (item?.Id) out[item.Id] = item.ProviderIds || {};
  }
  return out;
}

async function loadSeasons() {
  const result = await db.query(`
    SELECT e."SeriesId" AS series_id, e."SeriesName" AS series_name, COALESCE(e."ParentIndexNumber", s."IndexNumber") AS season,
           MAX(s."Name") AS season_name, COUNT(DISTINCT e."EpisodeId")::int AS episodes,
           array_agg(DISTINCT e."IndexNumber") FILTER (WHERE e."IndexNumber" IS NOT NULL) AS indexes,
           MAX(i."ProductionYear") AS year, MAX(l."Name") AS library
      FROM jf_library_episodes e
      LEFT JOIN jf_library_seasons s ON s."Id" = e."SeasonId"
      LEFT JOIN jf_library_items i ON i."Id" = e."SeriesId"
      LEFT JOIN jf_libraries l ON l."Id" = i."ParentId"
     WHERE COALESCE(e.archived, false) = false
       AND COALESCE(i.archived, false) = false
       AND COALESCE(e."ParentIndexNumber", s."IndexNumber") > 0
     GROUP BY e."SeriesId", e."SeriesName", COALESCE(e."ParentIndexNumber", s."IndexNumber")`);
  return result.rows;
}

async function getReport() {
  const [rows, sonarr] = await Promise.all([loadSeasons(), getSonarr()]);
  let sonarrSeries = [];
  let sonarrError = null;
  if (sonarr) {
    sonarrSeries = await fetchSonarrSeries(sonarr).catch((error) => {
      sonarrError = error.response?.status ? `Sonarr returned ${error.response.status}` : "Sonarr did not respond";
      return [];
    });
  }
  const providerIds = await fetchProviderIds(rows.map((r) => r.series_id)).catch(() => ({}));
  const items = buildReport(rows, { sonarr: sonarrError ? null : sonarr, sonarrSeries, providerIds });
  return {
    sonarr: sonarr ? { configured: true, name: sonarr.name, error: sonarrError } : { configured: false },
    scannedSeries: new Set(rows.map((r) => r.series_id)).size,
    scannedSeasons: rows.length,
    summary: {
      series: items.length,
      seasons: items.reduce((sum, i) => sum + i.seasons.length, 0),
      missingEpisodes: items.reduce((sum, i) => sum + i.missing, 0),
    },
    items: items.slice(0, 500),
  };
}

module.exports = { firstProviderId, normTitle, parseIndexes, detectSeason, matchSonarr, tvdbUrl, buildReport, fetchSonarrSeries, getReport };

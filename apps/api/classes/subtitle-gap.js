const axios = require("axios");
const db = require("../db");
const { getSettings, mergeSettings } = require("./admin-history");
const { getIntegrations } = require("./integration-store");
const { stripTrailingSlashes, toSafeHttpUrl } = require("../utils/security");

const SETTINGS_KEY = "SubtitleGap";
const DEFAULTS = { subtitleLanguages: ["eng"], audioLanguages: ["eng"] };

// Jellyfin reports ISO 639-2 codes (sometimes the B and T variants differ).
// Map common two-letter codes, names and alternates onto one canonical code.
const LANGS = {
  eng: ["en", "english"], spa: ["es", "spanish", "espanol", "español"], fre: ["fr", "fra", "french", "francais", "français"],
  ger: ["de", "deu", "german", "deutsch"], ita: ["it", "italian"], por: ["pt", "portuguese"], dut: ["nl", "nld", "dutch"],
  swe: ["sv", "swedish"], nor: ["no", "nob", "nno", "norwegian"], dan: ["da", "danish"], fin: ["fi", "finnish"],
  pol: ["pl", "polish"], rus: ["ru", "russian"], ukr: ["uk", "ukrainian"], jpn: ["ja", "japanese"], kor: ["ko", "korean"],
  chi: ["zh", "zho", "chinese"], ara: ["ar", "arabic"], hin: ["hi", "hindi"], tur: ["tr", "turkish"], gre: ["el", "ell", "greek"],
  heb: ["he", "hebrew"], cze: ["cs", "ces", "czech"], hun: ["hu", "hungarian"], rum: ["ro", "ron", "romanian"],
  tha: ["th", "thai"], vie: ["vi", "vietnamese"], ind: ["id", "indonesian"], may: ["ms", "msa", "malay"],
  wel: ["cy", "cym", "welsh"], gle: ["ga", "irish"],
};
const ALIASES = Object.entries(LANGS).reduce((map, [code, aliases]) => {
  map[code] = code;
  aliases.forEach((alias) => (map[alias] = code));
  return map;
}, {});

function normalizeLang(value) {
  const raw = String(value || "").trim().toLowerCase().split(/[-_]/)[0];
  if (!raw || raw === "und" || raw === "unknown") return "";
  return ALIASES[raw] || raw;
}

function normalizeLangList(list) {
  const items = Array.isArray(list) ? list : String(list || "").split(/[,\s]+/);
  return [...new Set(items.map(normalizeLang).filter(Boolean))].slice(0, 12);
}

function parseStreams(streams) {
  if (!streams) return [];
  if (typeof streams === "string") {
    try {
      return JSON.parse(streams) || [];
    } catch {
      return [];
    }
  }
  return Array.isArray(streams) ? streams : [];
}

// Pure: which preferred languages are missing from one file's streams.
function detectGaps(streams, prefs) {
  const list = parseStreams(streams);
  const subs = new Set(list.filter((s) => s?.Type === "Subtitle").map((s) => normalizeLang(s.Language)).filter(Boolean));
  const audio = new Set(list.filter((s) => s?.Type === "Audio").map((s) => normalizeLang(s.Language)).filter(Boolean));
  const missingSubtitles = normalizeLangList(prefs?.subtitleLanguages).filter((code) => !subs.has(code));
  const missingAudio = normalizeLangList(prefs?.audioLanguages).filter((code) => !audio.has(code));
  return { missingSubtitles, missingAudio, subtitles: [...subs], audio: [...audio] };
}

// Pure: roll file rows up into report rows. Episodes collapse to one row per series.
function buildReport(rows, prefs) {
  const out = new Map();
  for (const row of rows) {
    const gaps = detectGaps(row.streams, prefs);
    if (!gaps.missingSubtitles.length && !gaps.missingAudio.length) continue;
    const isEpisode = row.type === "Episode";
    const key = isEpisode ? `series:${row.series_id || row.series_name}` : `movie:${row.id}`;
    const entry = out.get(key) || {
      key,
      kind: isEpisode ? "series" : "movie",
      id: isEpisode ? row.series_id : row.id,
      title: isEpisode ? row.series_name || row.name : row.name,
      year: row.year || null,
      files: 0,
      missingSubtitles: {},
      missingAudio: {},
      examples: [],
    };
    entry.files += 1;
    gaps.missingSubtitles.forEach((c) => (entry.missingSubtitles[c] = (entry.missingSubtitles[c] || 0) + 1));
    gaps.missingAudio.forEach((c) => (entry.missingAudio[c] = (entry.missingAudio[c] || 0) + 1));
    if (isEpisode && entry.examples.length < 3) entry.examples.push(row.name);
    out.set(key, entry);
  }
  return [...out.values()].sort((a, b) => b.files - a.files || String(a.title).localeCompare(String(b.title)));
}

function normTitle(value) {
  return String(value || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/&/g, "and").replace(/[^a-z0-9]+/g, "");
}

// Pure: find the Bazarr record for a report row by title (+ year when known).
function matchBazarr(row, bazarrItems) {
  const want = normTitle(row.title);
  const candidates = (bazarrItems || []).filter((item) => normTitle(item.title) === want);
  if (candidates.length <= 1 || !row.year) return candidates[0] || null;
  return candidates.find((item) => Number(item.year) === Number(row.year)) || candidates[0];
}

async function getPrefs() {
  const settings = await getSettings();
  const saved = settings[SETTINGS_KEY] || {};
  return {
    subtitleLanguages: normalizeLangList(saved.subtitleLanguages || DEFAULTS.subtitleLanguages),
    audioLanguages: normalizeLangList(saved.audioLanguages || DEFAULTS.audioLanguages),
  };
}

async function savePrefs(body) {
  const prefs = { subtitleLanguages: normalizeLangList(body?.subtitleLanguages), audioLanguages: normalizeLangList(body?.audioLanguages) };
  await mergeSettings({ [SETTINGS_KEY]: prefs });
  return prefs;
}

async function getBazarr() {
  const integrations = await getIntegrations().catch(() => ({ arrApps: [] }));
  const app = (integrations.arrApps || []).find((integration) => {
    const name = String(integration?.name || integration?.slug || "").toLowerCase();
    return integration.connected && name.includes("bazarr") && integration.values?.url && integration.values?.secret;
  });
  if (!app) return null;
  let url = "";
  try {
    url = stripTrailingSlashes(toSafeHttpUrl(stripTrailingSlashes(app.values.url)));
  } catch {
    return null;
  }
  return url ? { url, key: app.values.secret, name: app.name || "Bazarr" } : null;
}

async function loadRows() {
  const result = await db.query(`
    SELECT f."Id" AS id, f."Name" AS name, f."Type" AS type, f."MediaStreams" AS streams,
           COALESCE(i."ProductionYear", s."ProductionYear") AS year, e."SeriesId" AS series_id, e."SeriesName" AS series_name
      FROM jf_item_info f
      LEFT JOIN jf_library_items i ON i."Id" = f."Id" AND f."Type" <> 'Episode'
      LEFT JOIN jf_library_episodes e ON e."EpisodeId" = f."Id" AND f."Type" = 'Episode'
      LEFT JOIN jf_library_items s ON s."Id" = e."SeriesId"
     WHERE f."Type" IN ('Item','Movie','Episode')
       AND COALESCE(i.archived, e.archived, false) = false
       AND (i."Id" IS NULL OR i."Type" = 'Movie')`);
  return result.rows.map((row) => ({ ...row, type: row.type === "Episode" ? "Episode" : "Movie" }));
}

async function getReport() {
  const [prefs, bazarr, rows] = await Promise.all([getPrefs(), getBazarr(), loadRows()]);
  const items = buildReport(rows, prefs);
  return {
    prefs,
    bazarr: bazarr ? { configured: true, name: bazarr.name } : { configured: false },
    scannedFiles: rows.length,
    summary: {
      titles: items.length,
      movies: items.filter((i) => i.kind === "movie").length,
      series: items.filter((i) => i.kind === "series").length,
      filesMissingSubtitles: rows.filter((r) => detectGaps(r.streams, prefs).missingSubtitles.length).length,
      filesMissingAudio: rows.filter((r) => detectGaps(r.streams, prefs).missingAudio.length).length,
    },
    items: items.slice(0, 500),
  };
}

function bazarrList(data) {
  return Array.isArray(data) ? data : data?.data || [];
}

async function searchInBazarr(targets, deps = {}) {
  const bazarr = deps.bazarr !== undefined ? deps.bazarr : await getBazarr();
  if (!bazarr) {
    const error = new Error("Bazarr is not connected. Add it under Settings → Integrations.");
    error.statusCode = 409;
    throw error;
  }
  const http = deps.http || axios;
  const options = { timeout: 15000, headers: { "X-API-KEY": bazarr.key, Accept: "application/json" } };
  const list = (targets || []).slice(0, 50);
  const needMovies = list.some((t) => t.kind === "movie");
  const needSeries = list.some((t) => t.kind === "series");
  const [movies, series] = await Promise.all([
    needMovies ? http.get(`${bazarr.url}/api/movies`, options).then((r) => bazarrList(r.data)) : [],
    needSeries ? http.get(`${bazarr.url}/api/series`, options).then((r) => bazarrList(r.data)) : [],
  ]);
  const results = [];
  for (const target of list) {
    const match = matchBazarr(target, target.kind === "movie" ? movies : series);
    if (!match) {
      results.push({ key: target.key, status: "not-found", message: "Not found in Bazarr" });
      continue;
    }
    const params = target.kind === "movie" ? { radarrid: match.radarrId, action: "search-missing" } : { seriesid: match.sonarrSeriesId, action: "search-missing" };
    try {
      await http.patch(`${bazarr.url}/api/${target.kind === "movie" ? "movies" : "series"}`, null, { ...options, params });
      results.push({ key: target.key, status: "queued", message: `Search started in ${bazarr.name}` });
    } catch (error) {
      results.push({ key: target.key, status: "error", message: error.response?.status ? `Bazarr returned ${error.response.status}` : "Bazarr did not respond" });
    }
  }
  return { results };
}

module.exports = { normalizeLang, normalizeLangList, detectGaps, buildReport, matchBazarr, getPrefs, savePrefs, getReport, searchInBazarr };

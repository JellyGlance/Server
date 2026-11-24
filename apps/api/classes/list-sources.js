// External list sources for collection builders: Trakt lists (API, needs a Trakt Client ID)
// and public Letterboxd lists (read from the public list pages).
const { getSettings, saveSettings } = require("./integration-store");

const TRAKT_API = "https://api.trakt.tv";
const MAX_LIST_ITEMS = 1000;

function httpError(message, statusCode = 400, code) {
  return Object.assign(new Error(message), { statusCode, code });
}

// The Trakt Client ID is shared with the Trakt history import (Settings > Imports).
async function getTraktClientId() {
  const settings = await getSettings().catch(() => ({}));
  return String(settings?.ExternalImports?.trakt?.clientId || process.env.TRAKT_CLIENT_ID || "").trim();
}

function traktHeaders(clientId) {
  return { "Content-Type": "application/json", "trakt-api-version": "2", "trakt-api-key": clientId, "User-Agent": "JellyGlance" };
}

async function traktGet(path, clientId, params) {
  const axios = require("axios");
  return axios.get(`${TRAKT_API}${path}`, { headers: traktHeaders(clientId), params, timeout: 20000 });
}

async function traktStatus() {
  const clientId = await getTraktClientId();
  return { configured: Boolean(clientId), hint: clientId ? `••••${clientId.slice(-4)}` : "" };
}

async function saveTraktClientId(value) {
  const clientId = String(value || "").trim();
  if (clientId) {
    try {
      await traktGet("/movies/trending", clientId, { limit: 1 });
    } catch (error) {
      const status = error.response?.status;
      throw httpError(status === 403 || status === 401 ? "Trakt rejected that Client ID" : `Could not reach Trakt (${error.message})`, 400, "TRAKT_INVALID");
    }
  }
  const settings = await getSettings();
  const imports = settings.ExternalImports || {};
  await saveSettings({ ExternalImports: { ...imports, trakt: { ...(imports.trakt || {}), clientId } } });
  return traktStatus();
}

function parseUrl(value) {
  try {
    return new URL(String(value || "").trim());
  } catch {
    return null;
  }
}

// trakt.tv/users/<user>/lists/<list>, trakt.tv/users/<user>/watchlist, trakt.tv/lists/<id>
function parseTraktListUrl(value) {
  const url = parseUrl(value);
  if (!url || !/(^|\.)trakt\.tv$/i.test(url.hostname)) return null;
  const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  if (parts[0] === "users" && parts[1] && parts[2] === "lists" && parts[3]) return { path: `/users/${encodeURIComponent(parts[1])}/lists/${encodeURIComponent(parts[3])}/items` };
  if (parts[0] === "users" && parts[1] && parts[2] === "watchlist") return { path: `/users/${encodeURIComponent(parts[1])}/watchlist` };
  if (parts[0] === "lists" && parts[1]) return { path: `/lists/${encodeURIComponent(parts[1])}/items` };
  return null;
}

async function fetchTraktList(listUrl) {
  const parsed = parseTraktListUrl(listUrl);
  if (!parsed) throw httpError("Use a Trakt list link like https://trakt.tv/users/name/lists/list-name", 400, "BAD_URL");
  const clientId = await getTraktClientId();
  if (!clientId) throw httpError("Add a Trakt Client ID in Settings → Integrations → Metadata", 503, "TRAKT_MISSING");
  const rows = [];
  for (let page = 1; page <= 10 && rows.length < MAX_LIST_ITEMS; page += 1) {
    let response;
    try {
      response = await traktGet(parsed.path, clientId, { page, limit: 100 });
    } catch (error) {
      const status = error.response?.status;
      if (status === 404) throw httpError("That Trakt list was not found or is private", 404, "LIST_NOT_FOUND");
      throw httpError(`Trakt request failed (${status || error.message})`, 502);
    }
    const items = Array.isArray(response.data) ? response.data : [];
    for (const row of items) {
      const media = row.movie || row.show;
      if (!media) continue;
      rows.push({ title: media.title, year: media.year || null, tmdbId: media.ids?.tmdb || null, imdbId: media.ids?.imdb || null, mediaType: row.movie ? "movie" : "tv" });
    }
    const pageCount = Number(response.headers?.["x-pagination-page-count"] || 1);
    if (page >= pageCount || !items.length) break;
  }
  return rows;
}

// letterboxd.com/<user>/list/<slug>/ or letterboxd.com/<user>/watchlist/
function parseLetterboxdUrl(value) {
  const url = parseUrl(value);
  if (!url || !/(^|\.)letterboxd\.com$/i.test(url.hostname)) return null;
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts[0] && parts[1] === "list" && parts[2]) return `/${parts[0]}/list/${parts[2]}/`;
  if (parts[0] && parts[1] === "watchlist") return `/${parts[0]}/watchlist/`;
  return null;
}

function decodeEntities(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function parseLetterboxdPage(html) {
  const films = [];
  const seen = new Set();
  const add = (title, year) => {
    const clean = decodeEntities(title).trim();
    if (!clean) return;
    const key = `${clean.toLowerCase()}|${year || ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    films.push({ title: clean, year: year ? Number(year) : null });
  };
  // Current markup: data-item-name="Title (1999)"; older markup: data-film-name + data-film-release-year.
  for (const match of html.matchAll(/data-item-name="([^"]+)"/g)) {
    const name = decodeEntities(match[1]);
    const withYear = name.match(/^(.*)\s\((\d{4})\)$/);
    add(withYear ? withYear[1] : name, withYear ? withYear[2] : null);
  }
  if (!films.length) {
    for (const match of html.matchAll(/data-film-name="([^"]+)"[^>]*?(?:data-film-release-year="(\d{4})")?/g)) add(match[1], match[2]);
  }
  if (!films.length) {
    for (const match of html.matchAll(/<img[^>]+class="image"[^>]+alt="([^"]+)"/g)) add(match[1], null);
  }
  return films;
}

async function fetchLetterboxdList(listUrl) {
  const path = parseLetterboxdUrl(listUrl);
  if (!path) throw httpError("Use a public Letterboxd list link like https://letterboxd.com/name/list/list-name/", 400, "BAD_URL");
  const axios = require("axios");
  const films = [];
  for (let page = 1; page <= 20 && films.length < MAX_LIST_ITEMS; page += 1) {
    let html;
    try {
      const response = await axios.get(`https://letterboxd.com${path}${page > 1 ? `page/${page}/` : ""}`, {
        timeout: 20000,
        headers: { "User-Agent": "Mozilla/5.0 (compatible; JellyGlance list import)", Accept: "text/html" },
      });
      html = String(response.data || "");
    } catch (error) {
      const status = error.response?.status;
      if (page > 1 && status === 404) break;
      if (status === 404) throw httpError("That Letterboxd list was not found or is private", 404, "LIST_NOT_FOUND");
      throw httpError(`Letterboxd request failed (${status || error.message})`, 502);
    }
    const pageFilms = parseLetterboxdPage(html);
    if (!pageFilms.length) break;
    films.push(...pageFilms);
    if (!/class="next"/.test(html)) break;
  }
  return films;
}

module.exports = {
  getTraktClientId,
  traktStatus,
  saveTraktClientId,
  parseTraktListUrl,
  fetchTraktList,
  parseLetterboxdUrl,
  parseLetterboxdPage,
  fetchLetterboxdList,
};

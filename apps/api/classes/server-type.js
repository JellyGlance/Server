// Which media server JellyGlance talks to: "jellyfin" (default) or "emby".
// IS_EMBY_API in the environment wins; otherwise settings.ServerType from setup decides.
const SERVER_TYPES = ["jellyfin", "emby"];

function envServerType() {
  const value = String(process.env.IS_EMBY_API ?? "").trim().toLowerCase();
  if (!value) return null;
  return value === "true" ? "emby" : "jellyfin";
}

function normalizeServerType(value) {
  return SERVER_TYPES.includes(String(value || "").toLowerCase()) ? String(value).toLowerCase() : "jellyfin";
}

function resolveServerType(settings = {}) {
  return envServerType() || normalizeServerType(settings?.ServerType);
}

let active = envServerType() || "jellyfin";

function setActiveServerType(type) {
  active = normalizeServerType(type);
}

function getActiveServerType() {
  return active;
}

function serverLabel(type = active) {
  return type === "emby" ? "Emby" : "Jellyfin";
}

// Ask the server what it is. Jellyfin always reports ProductName "Jellyfin Server";
// Emby reports "Emby Server" or, on older builds, no ProductName at all.
async function detectServerType(url, requestOptions = {}) {
  const { axios } = require("./axios");
  const { stripTrailingSlashes, toSafeHttpUrl } = require("../utils/security");
  const raw = String(url || "");
  const webIndex = raw.indexOf("/web/index.html");
  let base = stripTrailingSlashes(webIndex === -1 ? raw : raw.slice(0, webIndex));
  if (!base) return null;
  if (!/^https?:\/\//i.test(base)) base = `http://${base}`;
  for (const path of ["/System/Info/Public", "/emby/System/Info/Public"]) {
    try {
      const { data } = await axios.get(toSafeHttpUrl(`${base}${path}`), { timeout: 5000, ...requestOptions });
      if (!data || typeof data !== "object") continue;
      const product = String(data.ProductName || "");
      if (/jellyfin/i.test(product)) return "jellyfin";
      if (/emby/i.test(product) || (data.Id && data.Version)) return "emby";
    } catch {
      // try the next path
    }
  }
  return null;
}

// Pick the server type for a setup/settings request: env override, then what the
// user chose, then what the server says it is, then whatever is active now.
async function chooseServerType(requested, url, requestOptions = {}) {
  const forced = envServerType();
  if (forced) return forced;
  if (SERVER_TYPES.includes(String(requested || "").toLowerCase())) return String(requested).toLowerCase();
  return (await detectServerType(url, requestOptions)) || active;
}

async function saveServerType(type) {
  const db = require("../db");
  const configClass = require("./config");
  const { rows } = await db.query('SELECT settings FROM app_config where "ID"=1');
  if (!rows.length) return;
  const settings = rows[0].settings || {};
  settings.ServerType = normalizeServerType(type);
  await db.query('UPDATE app_config SET settings=$1 where "ID"=1', [settings]);
  setActiveServerType(settings.ServerType);
  new configClass().clearCache();
}

// Run fn with the API loader pointed at `type`, then switch back. Setup uses this to
// validate against the right client before anything is saved (see saveServerType).
async function withServerType(type, fn) {
  const previous = active;
  setActiveServerType(type);
  try {
    return await fn();
  } finally {
    setActiveServerType(previous);
  }
}

// Jellyfin reads the MediaBrowser Authorization header; Emby reads X-Emby-Token. Send both.
function mediaServerAuthHeaders(apiKey) {
  return { Authorization: `MediaBrowser Token="${apiKey}"`, "X-Emby-Token": String(apiKey || "") };
}

module.exports = {
  SERVER_TYPES,
  envServerType,
  normalizeServerType,
  resolveServerType,
  setActiveServerType,
  getActiveServerType,
  serverLabel,
  mediaServerAuthHeaders,
  detectServerType,
  chooseServerType,
  saveServerType,
  withServerType,
};

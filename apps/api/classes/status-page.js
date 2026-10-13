// Public status page: layout config, a 5-minute uptime checker and the public payload builder.
// Nothing here ever exposes usernames, devices, IPs or service URLs.
const axios = require("axios");
const timers = require("./timers");
const db = require("../db");
const configClass = require("./config");
const API = require("./api-loader");
const { getIntegrations } = require("./integration-store");

const CHECK_INTERVAL_MS = 5 * 60 * 1000;
const KEEP_DAYS = 90;
const BLOCK_TYPES = ["banner", "metrics", "uptime", "services", "recent", "text", "links"];
const METRIC_ITEMS = ["server", "latency", "streams", "uptime24h", "uptime7d", "uptime30d", "checked"];
const BACKGROUNDS = ["aurora", "midnight", "solid"];

let blockSeq = 0;
function blockId() {
  blockSeq += 1;
  return `b${Date.now().toString(36)}${blockSeq}`;
}

const DEFAULT_BLOCKS = () => [
  { id: "banner", type: "banner", enabled: true, upText: "", downText: "" },
  { id: "metrics", type: "metrics", enabled: true, items: ["server", "latency", "streams", "uptime30d"] },
  { id: "uptime", type: "uptime", enabled: true, heading: "Uptime", days: 30 },
  { id: "services", type: "services", enabled: false, heading: "Services", services: [] },
  { id: "recent", type: "recent", enabled: true, heading: "Recently added", count: 18, layout: "grid", filter: "all" },
];

function str(value, max) {
  return String(value ?? "").slice(0, max);
}

function clampInt(value, min, max, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

function safeUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

function normalizeBlock(block = {}) {
  const type = BLOCK_TYPES.includes(block.type) ? block.type : null;
  if (!type) return null;
  const base = { id: str(block.id, 40) || blockId(), type, enabled: block.enabled !== false };
  switch (type) {
    case "banner":
      return { ...base, upText: str(block.upText, 160), downText: str(block.downText, 160) };
    case "metrics": {
      const items = (Array.isArray(block.items) ? block.items : []).filter((item) => METRIC_ITEMS.includes(item));
      return { ...base, items: [...new Set(items)] };
    }
    case "uptime":
      return { ...base, heading: str(block.heading, 80), days: [7, 30, 90].includes(Number(block.days)) ? Number(block.days) : 30 };
    case "services":
      return { ...base, heading: str(block.heading, 80), services: (Array.isArray(block.services) ? block.services : []).map((id) => str(id, 80)).slice(0, 40) };
    case "recent":
      return {
        ...base,
        heading: str(block.heading, 80),
        count: clampInt(block.count, 4, 30, 18),
        layout: block.layout === "row" ? "row" : "grid",
        filter: ["movies", "tv"].includes(block.filter) ? block.filter : "all",
      };
    case "text":
      return { ...base, heading: str(block.heading, 80), body: str(block.body, 2000) };
    case "links":
      return {
        ...base,
        heading: str(block.heading, 80),
        items: (Array.isArray(block.items) ? block.items : [])
          .map((item) => ({ label: str(item?.label, 40), url: safeUrl(item?.url) }))
          .filter((item) => item.label && item.url)
          .slice(0, 8),
      };
    default:
      return null;
  }
}

function normalizeConfig(value = {}) {
  const hasBlocks = Array.isArray(value.blocks);
  const blocks = (hasBlocks ? value.blocks : DEFAULT_BLOCKS()).map(normalizeBlock).filter(Boolean).slice(0, 20);
  const accent = /^#[0-9a-f]{6}$/i.test(String(value.accent || "")) ? value.accent : "#8b5cf6";
  return {
    enabled: value.enabled === true,
    title: str(value.title, 80),
    subtitle: str(value.subtitle, 160),
    showLogo: value.showLogo !== false,
    accent,
    background: BACKGROUNDS.includes(value.background) ? value.background : "aurora",
    width: value.width === "narrow" ? "narrow" : "wide",
    footerText: str(value.footerText, 200),
    refreshSeconds: clampInt(value.refreshSeconds, 30, 600, 60),
    maintenanceActive: value.maintenanceActive === true,
    maintenanceMessage: str(value.maintenanceMessage, 500),
    maintenanceSince: value.maintenanceActive === true && value.maintenanceSince ? str(value.maintenanceSince, 40) : null,
    blocks,
  };
}

async function readSettings() {
  const { rows } = await db.query('SELECT settings FROM app_config where "ID"=1');
  return rows[0]?.settings || {};
}

async function getStatusConfig() {
  return normalizeConfig((await readSettings()).PublicStatus || {});
}

async function saveStatusConfig(next = {}) {
  const settings = await readSettings();
  const current = normalizeConfig(settings.PublicStatus || {});
  const merged = normalizeConfig({ ...current, ...next });
  merged.maintenanceSince = merged.maintenanceActive ? (current.maintenanceActive && current.maintenanceSince) || new Date().toISOString() : null;
  settings.PublicStatus = merged;
  await db.query('UPDATE app_config SET settings=$1 where "ID"=1', [settings]);
  return merged;
}

// ---- uptime checks ----
let tableReady = null;
function ensureTable() {
  if (!tableReady) {
    tableReady = db
      .query(
        `CREATE TABLE IF NOT EXISTS jg_status_checks (
           id bigserial PRIMARY KEY,
           target text NOT NULL,
           online boolean NOT NULL,
           latency_ms integer,
           checked_at timestamptz NOT NULL DEFAULT NOW()
         );
         CREATE INDEX IF NOT EXISTS jg_status_checks_target_idx ON jg_status_checks (target, checked_at);`
      )
      .catch((error) => {
        tableReady = null;
        throw error;
      });
  }
  return tableReady;
}

async function configuredServices() {
  const integrations = await getIntegrations();
  const out = [];
  for (const group of ["arrApps", "clients", "thirdParty"]) {
    for (const item of integrations?.[group] || []) {
      const url = safeUrl(item?.values?.url || item?.values?.host);
      if (!url || !item.instanceId) continue;
      out.push({ id: `svc:${item.instanceId}`, name: item.name || item.slug || "Service", url });
    }
  }
  return out;
}

async function probe(url, headers = {}, retry = true) {
  const first = await probeOnce(url, headers);
  if (first.online || !retry) return first;
  // One quick retry so a single slow response isn't recorded as an outage.
  await new Promise((resolve) => setTimeout(resolve, 2000));
  return probeOnce(url, headers);
}

async function probeOnce(url, headers = {}) {
  const started = Date.now();
  try {
    await axios.get(url, { timeout: 6000, maxRedirects: 0, validateStatus: (status) => status < 500, headers: { "User-Agent": "JellyGlance", ...headers }, responseType: "text" });
    return { online: true, latency: Date.now() - started };
  } catch {
    return { online: false, latency: null };
  }
}

async function runStatusChecks() {
  await ensureTable();
  const rows = [];
  const config = await new configClass().getConfig();
  if (!config.error && config.JF_HOST) {
    const result = await probe(`${config.JF_HOST}/System/Info/Public`);
    rows.push(["jellyfin", result.online, result.latency]);
  }
  const services = await configuredServices().catch(() => []);
  const results = await Promise.all(services.map((service) => probe(service.url)));
  services.forEach((service, index) => rows.push([service.id, results[index].online, results[index].latency]));
  for (const [target, online, latency] of rows) {
    await db.query("INSERT INTO jg_status_checks (target, online, latency_ms) VALUES ($1, $2, $3)", [target, online, latency]);
  }
  await db.query(`DELETE FROM jg_status_checks WHERE checked_at < NOW() - INTERVAL '${KEEP_DAYS} days'`);
  return rows.length;
}

let timer = null;
function startStatusChecks() {
  if (timer) return;
  const run = () => runStatusChecks().catch((error) => console.error("[STATUS] Check failed:", error.message));
  timers.after(run, 30 * 1000);
  timer = timers.every(run, CHECK_INTERVAL_MS);
}

function stopStatusChecks() {
  timers.clear(timer);
  timer = null;
}

async function uptimeSummary(target, days) {
  await ensureTable();
  const { rows } = await db.query(
    `SELECT to_char(date_trunc('day', checked_at), 'YYYY-MM-DD') AS day, COUNT(*)::int AS total, SUM(CASE WHEN online THEN 1 ELSE 0 END)::int AS up
       FROM jg_status_checks WHERE target=$1 AND checked_at >= date_trunc('day', NOW()) - ($2::int - 1) * INTERVAL '1 day'
       GROUP BY 1 ORDER BY 1`,
    [target, days]
  );
  const byDay = Object.fromEntries(rows.map((row) => [row.day, row]));
  const list = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = new Date(Date.now() - offset * 86400000).toISOString().slice(0, 10);
    const row = byDay[date];
    list.push({ date, pct: row && row.total ? Math.round((row.up / row.total) * 1000) / 10 : null });
  }
  return list;
}

async function uptimePercent(target, hours) {
  await ensureTable();
  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS total, SUM(CASE WHEN online THEN 1 ELSE 0 END)::int AS up FROM jg_status_checks WHERE target=$1 AND checked_at >= NOW() - $2::int * INTERVAL '1 hour'`,
    [target, hours]
  );
  const row = rows[0];
  return row && row.total ? Math.round((row.up / row.total) * 1000) / 10 : null;
}

async function latestFor(targets) {
  if (!targets.length) return {};
  await ensureTable();
  const { rows } = await db.query(
    `SELECT DISTINCT ON (target) target, online, checked_at FROM jg_status_checks WHERE target = ANY($1) ORDER BY target, checked_at DESC`,
    [targets]
  );
  return Object.fromEntries(rows.map((row) => [row.target, row]));
}

// ---- payload ----
async function buildStatusPayload(config) {
  const blocks = config.blocks.filter((block) => block.enabled);
  const has = (type) => blocks.some((block) => block.type === type);
  const metricItems = new Set(blocks.filter((block) => block.type === "metrics").flatMap((block) => block.items));
  const jf = await new configClass().getConfig();

  const server = { online: false, latencyMs: null, name: "" };
  if (!jf.error && jf.JF_HOST) {
    const started = Date.now();
    try {
      const { data } = await axios.get(`${jf.JF_HOST}/System/Info/Public`, { timeout: 5000, headers: { "User-Agent": "JellyGlance" } });
      server.online = true;
      server.latencyMs = Date.now() - started;
      server.name = data?.ServerName || "";
    } catch {
      server.online = false;
    }
  }

  const data = { server: { online: server.online, latencyMs: server.latencyMs }, checkedAt: new Date().toISOString() };

  if (metricItems.has("streams") && server.online) {
    try {
      const sessions = await API.getSessions();
      data.streams = (Array.isArray(sessions) ? sessions : []).filter((session) => session?.NowPlayingItem).length;
    } catch {
      data.streams = null;
    }
  }

  if (metricItems.has("uptime24h")) data.uptime24h = await uptimePercent("jellyfin", 24).catch(() => null);
  if (metricItems.has("uptime7d")) data.uptime7d = await uptimePercent("jellyfin", 24 * 7).catch(() => null);
  if (metricItems.has("uptime30d")) data.uptime30d = await uptimePercent("jellyfin", 24 * 30).catch(() => null);

  if (has("uptime")) {
    const days = Math.max(...blocks.filter((block) => block.type === "uptime").map((block) => block.days));
    data.uptimeDays = await uptimeSummary("jellyfin", days).catch(() => []);
  }

  if (has("services")) {
    const all = await configuredServices().catch(() => []);
    const wanted = new Set(blocks.filter((block) => block.type === "services").flatMap((block) => block.services));
    const chosen = wanted.size ? all.filter((service) => wanted.has(service.id)) : all;
    const latest = await latestFor(chosen.map((service) => service.id)).catch(() => ({}));
    data.services = await Promise.all(
      chosen.map(async (service) => ({
        id: service.id,
        name: service.name,
        online: latest[service.id] ? latest[service.id].online : null,
        uptime24h: await uptimePercent(service.id, 24).catch(() => null),
      }))
    );
  }

  const posterIds = new Set();
  if (has("recent") && server.online) {
    try {
      const want = Math.max(...blocks.filter((block) => block.type === "recent").map((block) => block.count));
      const items = (await API.getRecentlyAdded({ limit: 60 })) || [];
      data.recent = items
        .map((item) => {
          const posterId = String(item.Type === "Episode" ? item.SeriesId || item.Id : item.Id);
          const kind = item.Type === "Movie" ? "movies" : ["Episode", "Series", "Season"].includes(item.Type) ? "tv" : "other";
          return {
            id: String(item.Id),
            kind,
            title: item.Type === "Episode" ? item.SeriesName || item.Name : item.Name,
            subtitle:
              item.Type === "Episode"
                ? `${item.ParentIndexNumber != null ? `S${item.ParentIndexNumber}` : ""}${item.IndexNumber != null ? `E${item.IndexNumber}` : ""}` || item.Name
                : item.Type === "Series" && item.ChildCount
                  ? `${item.ChildCount} new`
                  : item.ProductionYear
                    ? String(item.ProductionYear)
                    : "",
            added: item.DateCreated || null,
            posterId,
          };
        })
        .slice(0, Math.max(want * 2, 30));
      data.recent.forEach((item) => {
        posterIds.add(item.posterId);
        item.poster = `status-data/poster/${encodeURIComponent(item.posterId)}`;
        delete item.posterId;
      });
    } catch {
      data.recent = [];
    }
  }

  if (config.maintenanceActive) data.maintenance = { message: config.maintenanceMessage, since: config.maintenanceSince };

  const { enabled, maintenanceActive, maintenanceMessage, maintenanceSince, ...layout } = config;
  layout.title = config.title || server.name || "Media server";
  return { payload: { enabled: true, config: layout, data }, posterIds };
}

module.exports = {
  stopStatusChecks,
  BLOCK_TYPES,
  METRIC_ITEMS,
  normalizeConfig,
  getStatusConfig,
  saveStatusConfig,
  configuredServices,
  buildStatusPayload,
  runStatusChecks,
  startStatusChecks,
};

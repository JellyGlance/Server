// Cleanuparr integration (#317).
// - Stats/health come from Cleanuparr's stats API (GET /api/v2/stats, X-Api-Key; /api/stats on versions without v2).
// - Connection tests use the light /api/health endpoint: the stats query can take well over 10s on a busy instance.
// - Events arrive through Cleanuparr's Gotify notification provider pointed at JellyGlance
//   (POST {base}/message?token=...). Discord-style embeds and plain JSON with an eventType are accepted too.
// - Downloads Cleanuparr is already striking or removing are tagged so JellyGlance does not double-alert,
//   while failed imports, errored downloads and repeated stalls are raised as alerts for a human.
const { randomBytes, timingSafeEqual } = require("crypto");
const { getIntegrations, getIntegrationData, saveIntegrationData, encryptSecret, decryptSecret } = require("./integration-store");
const { stripTrailingSlashes, safeHttpGet } = require("../utils/security");

const MAX_EVENTS = 50;
const HANDLED_TTL_MS = 3 * 24 * 60 * 60 * 1000;
const STALLED_INTERVENTION_STRIKES = 3;

const EVENT_TYPES = [
  "Test",
  "FailedImportStrike",
  "StalledStrike",
  "SlowStrike",
  "ErroredStrike",
  "QueueItemDeleted",
  "DownloadCleaned",
  "DownloadStopped",
  "CategoryChanged",
  "SearchTriggered",
  "SearchItemGrabbed",
  "ForceImported",
];

// Events that mean Cleanuparr has taken ownership of a download.
const HANDLING_EVENTS = new Set(["FailedImportStrike", "StalledStrike", "SlowStrike", "ErroredStrike", "QueueItemDeleted", "DownloadCleaned", "DownloadStopped", "ForceImported"]);

function isCleanuparr(integration) {
  return String(integration?.slug || integration?.name || "").toLowerCase().includes("cleanuparr");
}

async function getCleanuparrApps({ connectedOnly = true } = {}) {
  const integrations = await getIntegrations().catch(() => ({ thirdParty: [] }));
  return (integrations.thirdParty || []).filter((item) => isCleanuparr(item) && (!connectedOnly || item.connected));
}

function asNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function pick(object, ...keys) {
  if (!object || typeof object !== "object") return undefined;
  for (const key of keys) {
    if (object[key] !== undefined) return object[key];
    const lower = key.charAt(0).toLowerCase() + key.slice(1);
    if (object[lower] !== undefined) return object[lower];
  }
  return undefined;
}

function countMap(value) {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(Object.entries(value).map(([key, count]) => [key, asNumber(count)]));
}

function healthRows(rows) {
  return (Array.isArray(rows) ? rows : []).map((row) => ({
    name: pick(row, "Name") || "",
    type: pick(row, "Type") || "",
    healthy: pick(row, "IsHealthy") !== false,
    lastChecked: pick(row, "LastChecked") || null,
    responseTimeMs: pick(row, "ResponseTimeMs") ?? null,
    error: pick(row, "ErrorMessage") || "",
  }));
}

// Sum a per-job map ({ QueueCleaner: { totalRuns, completed, failed } }) from the documented /api/stats shape.
function sumJobs(byType) {
  return Object.values(byType && typeof byType === "object" ? byType : {}).reduce(
    (sum, job) => ({
      total: sum.total + asNumber(pick(job, "TotalRuns", "Total")),
      completed: sum.completed + asNumber(pick(job, "Completed")),
      failed: sum.failed + asNumber(pick(job, "Failed")),
    }),
    { total: 0, completed: 0, failed: 0 }
  );
}

// Normalise a Cleanuparr stats response into what the card and widgets need.
// Accepts the documented /api/stats shape (TotalCount, ItemsRemoved, Jobs.ByType) and the older flat shape.
function summarizeStats(raw = {}) {
  const events = pick(raw, "Events") || {};
  const strikes = pick(raw, "Strikes") || {};
  const removals = pick(raw, "Removals") || {};
  const cleaned = pick(raw, "Cleaned") || {};
  const searches = pick(raw, "Searches") || {};
  const jobs = pick(raw, "Jobs") || {};
  const health = pick(raw, "Health") || {};
  const bySeverity = countMap(pick(events, "BySeverity"));
  const downloadClients = healthRows(pick(health, "DownloadClients"));
  const arrInstances = healthRows(pick(health, "ArrInstances"));
  // v2 has flat totals plus a per-type breakdown; the documented /api/stats only has the breakdown.
  const byTypeJobs = pick(jobs, "ByType");
  const hasFlatJobTotals = pick(jobs, "Total") !== undefined || pick(jobs, "Failed") !== undefined;
  const jobTotals = !hasFlatJobTotals && byTypeJobs && Object.keys(byTypeJobs).length ? sumJobs(byTypeJobs) : null;
  // Which Cleanuparr jobs failed in the window (v2 stats give per-job-type counts).
  const failingJobs = Object.entries(byTypeJobs || {})
    .map(([name, job]) => ({
      name,
      failed: asNumber(pick(job, "Failed")),
      total: asNumber(pick(job, "TotalRuns", "Total")),
      lastRunAt: pick(job, "LastRunAt", "LastRun") || null,
    }))
    .filter((job) => job.failed > 0)
    .sort((a, b) => b.failed - a.failed);
  const failedJobs = jobTotals ? jobTotals.failed : asNumber(pick(jobs, "Failed"));
  const errorEvents = asNumber(bySeverity.Error ?? bySeverity.error);
  const unhealthy = [...downloadClients, ...arrInstances].filter((row) => !row.healthy);
  return {
    timeframeHours: asNumber(pick(raw, "TimeframeHours") ?? pick(events, "TimeframeHours") ?? pick(strikes, "TimeframeHours")) || 168,
    generatedAt: pick(raw, "GeneratedAt") || null,
    events: { total: asNumber(pick(events, "TotalCount", "Total")), byType: countMap(pick(events, "ByType")), bySeverity },
    strikes: { total: asNumber(pick(strikes, "TotalCount", "Total")), byType: countMap(pick(strikes, "ByType")), recovered: asNumber(pick(strikes, "Recovered")) },
    removals: { total: asNumber(pick(removals, "Total") ?? pick(strikes, "ItemsRemoved")), byReason: countMap(pick(removals, "ByReason")) },
    cleaned: { total: asNumber(pick(cleaned, "Total")), byReason: countMap(pick(cleaned, "ByReason")) },
    searches: {
      total: asNumber(pick(searches, "Total")),
      grabbed: asNumber(pick(searches, "Grabbed")),
      failed: asNumber(pick(searches, "Failed")),
    },
    jobs: { ...(jobTotals || { total: asNumber(pick(jobs, "Total")), completed: asNumber(pick(jobs, "Completed")), failed: failedJobs }), failing: failingJobs },
    health: {
      downloadClients,
      arrInstances,
      unhealthy: unhealthy.map((row) => ({ name: row.name, type: row.type, error: row.error })),
      healthy: unhealthy.length === 0,
    },
    // Only count what a person has to fix. Strikes and removals are Cleanuparr doing its job, and
    // failed imports that need a human arrive separately as inbound events (interventions). A job
    // that runs every few seconds fails now and then, so each job failing at least 1 run in 10
    // counts once; without a per-job breakdown, any failed run counts once. Plus unhealthy apps.
    needsAttention:
      (failingJobs.length ? failingJobs.filter((job) => job.total && job.failed / job.total >= 0.1).length : failedJobs > 0 ? 1 : 0) + unhealthy.length,
    errorEvents,
  };
}

function apiHeaders(app) {
  return { "X-Api-Key": app.values?.secret || "", Accept: "application/json" };
}

// Linear-time slash trimming (avoids regex backtracking on user-supplied paths).
function trimSlashes(value = "") {
  const text = String(value);
  let start = 0;
  let end = text.length;
  while (start < end && text[start] === "/") start += 1;
  while (end > start && text[end - 1] === "/") end -= 1;
  return text.slice(start, end);
}

function baseUrl(app) {
  const url = stripTrailingSlashes(String(app.values?.url || "").trim());
  const basePath = trimSlashes(String(app.values?.basePath || "").trim());
  if (!url || !basePath || url.endsWith(`/${basePath}`)) return url;
  return `${url}/${basePath}`;
}

const STATS_TIMEOUT_MS = 45000;
const STATS_CACHE_TTL_MS = 5 * 60 * 1000;
const statsCache = new Map();

function statsCacheKey(app, hours) {
  return `${app.instanceId || baseUrl(app)}|${hours}`;
}

// Serve recent stats from memory, and fall back to the last good result when Cleanuparr is slow.
async function fetchStats(app, { hours = 168, timeout = STATS_TIMEOUT_MS, maxAgeMs = STATS_CACHE_TTL_MS } = {}) {
  const key = statsCacheKey(app, hours);
  const cached = statsCache.get(key);
  if (cached && Date.now() - cached.at < maxAgeMs) return cached.stats;
  try {
    const stats = await fetchStatsLive(app, { hours, timeout });
    statsCache.set(key, { at: Date.now(), stats });
    return stats;
  } catch (error) {
    if (cached && /timeout/i.test(error.message)) return { ...cached.stats, stale: true, cachedAt: new Date(cached.at).toISOString() };
    throw error;
  }
}

async function fetchStatsLive(app, { hours = 168, timeout = STATS_TIMEOUT_MS } = {}) {
  const url = baseUrl(app);
  if (!url || !app.values?.secret) throw new Error("URL and API key required");
  const request = (path) =>
    safeHttpGet(url, path, {
      timeout,
      headers: apiHeaders(app),
      // v2 accepts 1–8760 hours and an includeDryRun flag; the older /api/stats accepts 1–720 hours.
      params:
        path === "/api/v2/stats"
          ? { hours: Math.min(8760, Math.max(1, Number(hours) || 168)), includeDryRun: false }
          : { hours: Math.min(720, Math.max(1, Number(hours) || 168)) },
      validateStatus: () => true,
    });
  let response = await request("/api/v2/stats");
  if (response.status === 404) response = await request("/api/stats");
  if (response.status === 401 || response.status === 403) throw new Error("Cleanuparr rejected the API key");
  if (response.status >= 400) throw new Error(`HTTP ${response.status}`);
  if (!response.data || typeof response.data !== "object") throw new Error("Unexpected response from Cleanuparr");
  return summarizeStats(response.data);
}

async function pingCleanuparr(integration) {
  const url = baseUrl(integration);
  if (!url || !integration.values?.secret) return { ok: false, error: "URL and API key required" };
  try {
    const response = await safeHttpGet(url, "/api/health", { timeout: 10000, headers: apiHeaders(integration), validateStatus: () => true });
    if (response.status === 401 || response.status === 403) return { ok: false, error: "Cleanuparr rejected the API key" };
    if (response.status >= 400) return { ok: false, error: `Cleanuparr health check failed (HTTP ${response.status})` };
  } catch (error) {
    return { ok: false, error: error.message };
  }
  // Stats only enrich the message; a slow stats query must not fail the connection test.
  try {
    const stats = await fetchStats(integration, { hours: 24, timeout: 8000 });
    const { downloadClients, arrInstances, unhealthy } = stats.health;
    const parts = [`${downloadClients.length} client${downloadClients.length === 1 ? "" : "s"}`, `${arrInstances.length} arr`];
    return {
      ok: true,
      version: "Cleanuparr",
      message: [
        unhealthy.length ? `Reachable · ${unhealthy.length} unhealthy (${unhealthy.map((row) => row.name).join(", ")})` : `Reachable · ${parts.join(", ")} healthy`,
        ...(stats.jobs.failing || []).map(
          (job) => `${job.name}: ${job.failed} of ${job.total || "?"} runs failed in 24h${job.total ? ` (${Math.max(1, Math.round((job.failed / job.total) * 100))}%)` : ""} — see Cleanuparr → Logs`
        ),
      ].join(" · "),
      failingJobs: stats.jobs.failing || [],
      health: stats.health,
    };
  } catch (error) {
    return {
      ok: true,
      version: "Cleanuparr",
      message: /timeout/i.test(error.message) ? "Reachable · stats are slow to load" : `Reachable · stats unavailable (${error.message})`,
    };
  }
}

async function fetchCleanuparrSnapshot({ hours = 168 } = {}) {
  const apps = await getCleanuparrApps();
  const instances = await Promise.all(
    apps.map(async (app) => {
      try {
        return { name: app.name, instanceId: app.instanceId, ok: true, stats: await fetchStats(app, { hours }) };
      } catch (error) {
        return { name: app.name, instanceId: app.instanceId, ok: false, error: error.message };
      }
    })
  );
  const data = (await getIntegrationData()).cleanuparr || {};
  const events = Array.isArray(data.events) ? data.events : [];
  const interventions = events.filter((event) => event.needsIntervention);
  const totals = instances.reduce(
    (sum, instance) => {
      if (!instance.ok) return { ...sum, unreachable: sum.unreachable + 1 };
      const stats = instance.stats;
      return {
        ...sum,
        events: sum.events + stats.events.total,
        strikes: sum.strikes + stats.strikes.total,
        removals: sum.removals + stats.removals.total,
        cleaned: sum.cleaned + stats.cleaned.total,
        unhealthy: sum.unhealthy + stats.health.unhealthy.length,
        needsAttention: sum.needsAttention + stats.needsAttention,
        failedJobs: sum.failedJobs + stats.jobs.failed,
        failingJobs: [...sum.failingJobs, ...(stats.jobs.failing || []).map((job) => ({ ...job, instance: instance.name }))],
      };
    },
    { events: 0, strikes: 0, removals: 0, cleaned: 0, unhealthy: 0, needsAttention: 0, failedJobs: 0, failingJobs: [], unreachable: 0 }
  );
  return {
    configured: apps.length > 0,
    hours,
    totals: { ...totals, interventions: interventions.length },
    instances,
    recentEvents: events.slice(0, 15),
    lastEventAt: data.lastEventAt || null,
  };
}

// ---- inbound notifications -----------------------------------------------

const MAX_INBOUND_TEXT = 20000;
const MAX_DATA_FIELDS = 50;
const MAX_FIELD_NAME = 100;
const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function safeFieldName(value) {
  const name = String(value ?? "").trim().slice(0, MAX_FIELD_NAME);
  if (!name || UNSAFE_KEYS.has(name)) return "";
  return name;
}

// Build a plain data object from untrusted name/value pairs without allowing
// prototype keys to be written.
function toSafeData(entries) {
  const fields = new Map();
  for (const [rawName, rawValue] of entries) {
    if (fields.size >= MAX_DATA_FIELDS) break;
    const name = safeFieldName(rawName);
    if (name) fields.set(name, String(rawValue ?? "").slice(0, 1000));
  }
  return Object.fromEntries(fields);
}

// Parses "**Name:** value" lines with plain string operations (no backtracking regex).
function parseDataLines(message = "") {
  const entries = [];
  const description = [];
  for (const rawLine of String(message).slice(0, MAX_INBOUND_TEXT).split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith("**")) {
      const end = line.indexOf(":**", 2);
      if (end > 2) {
        entries.push([line.slice(2, end), line.slice(end + 3).trim()]);
        continue;
      }
    }
    description.push(line);
  }
  return { data: toSafeData(entries), description: description.join(" ") };
}

// Case-insensitive "prefix: rest" match using string operations.
function afterPrefix(text, prefix) {
  if (text.length <= prefix.length || text.slice(0, prefix.length).toLowerCase() !== prefix.toLowerCase()) return null;
  const rest = text.slice(prefix.length).trim();
  return rest || null;
}

function strikeEventFromReason(reason = "") {
  const value = String(reason).toLowerCase();
  if (value.includes("failedimport")) return "FailedImportStrike";
  if (value.includes("errored")) return "ErroredStrike";
  if (value.includes("slow")) return "SlowStrike";
  return "StalledStrike"; // Stalled, DownloadingMetadata, DeadTorrent
}

// Maps Cleanuparr notification titles (NotificationPublisher.cs) to event types.
function classifyTitle(title = "") {
  const text = String(title).slice(0, 500).trim();
  const strike = afterPrefix(text, "Strike received with reason:");
  if (strike) {
    const reason = strike.split(/\s/)[0];
    return { eventType: strikeEventFromReason(reason), reason };
  }
  const deleted = afterPrefix(text, "Deleting item from queue with reason:");
  if (deleted) return { eventType: "QueueItemDeleted", reason: deleted };
  const cleaned = afterPrefix(text, "Cleaned item from download client with reason:");
  if (cleaned) return { eventType: "DownloadCleaned", reason: cleaned };
  const stopped = afterPrefix(text, "Stopped item in download client with reason:");
  if (stopped) return { eventType: "DownloadStopped", reason: stopped };
  if (/^(Category changed|Tag added)$/i.test(text)) return { eventType: "CategoryChanged" };
  if (/^Search triggered$/i.test(text)) return { eventType: "SearchTriggered" };
  if (/^Download grabbed$/i.test(text)) return { eventType: "SearchItemGrabbed" };
  if (/^Imported a download the arr had blocked$/i.test(text)) return { eventType: "ForceImported" };
  if (/test/i.test(text)) return { eventType: "Test" };
  return { eventType: "Unknown" };
}

function normalizeEventType(value) {
  const raw = String(value || "").replace(/[\s_-]+/g, "").toLowerCase();
  if (!raw) return "";
  if (raw === "slowspeedstrike" || raw === "slowtimestrike") return "SlowStrike";
  return EVENT_TYPES.find((type) => type.toLowerCase() === raw) || "";
}

// Accepts the Gotify payload Cleanuparr sends ({ title, message, priority }), a Discord-style
// payload ({ embeds: [{ title, description, fields }] }), or JSON with an explicit eventType.
function parseInboundPayload(body = {}) {
  const payload = body && typeof body === "object" ? body : {};
  let title = pick(payload, "Title") || "";
  let message = pick(payload, "Message", "Body") || "";
  let data = {};
  let description = "";
  const embed = Array.isArray(payload.embeds) ? payload.embeds[0] : null;
  if (embed) {
    title = title || embed.title || "";
    description = embed.description || "";
    const fields = Array.isArray(embed.fields) ? embed.fields : [];
    data = toSafeData(fields.filter((field) => field?.name).map((field) => [field.name, field.value]));
  } else {
    const parsed = parseDataLines(message);
    data = parsed.data;
    description = parsed.description;
  }
  if (payload.data && typeof payload.data === "object" && !Array.isArray(payload.data)) {
    data = toSafeData([...Object.entries(data), ...Object.entries(payload.data)]);
  }
  if (!payload.data && !embed && pick(payload, "Description")) description = pick(payload, "Description");
  const classified = classifyTitle(title);
  const eventType = normalizeEventType(pick(payload, "EventType", "Event", "Type")) || classified.eventType;
  const strikeCount = asNumber(data["Strike count"] ?? payload.strikeCount);
  const severity = String(pick(payload, "Severity") || "").trim() || severityFor(eventType);
  const event = {
    eventType,
    title: String(title || eventType).slice(0, 200),
    item: String(description || data.Item || "").slice(0, 300),
    reason: classified.reason || data.Reason || data["Strike type"] || "",
    hash: String(data.Hash || data.hash || "").toLowerCase(),
    strikeCount,
    instanceType: data["Instance type"] || "",
    severity,
    priority: asNumber(payload.priority),
    data,
  };
  event.needsIntervention = needsIntervention(event);
  return event;
}

function severityFor(eventType) {
  if (["FailedImportStrike", "ErroredStrike", "StalledStrike", "SlowStrike"].includes(eventType)) return "Warning";
  if (["QueueItemDeleted", "DownloadCleaned", "DownloadStopped", "ForceImported"].includes(eventType)) return "Important";
  return "Information";
}

// Cleanuparr handles slow/stalled downloads itself; failed imports, errored downloads and
// downloads that keep stalling usually mean something a person needs to look at.
function needsIntervention(event) {
  if (event.eventType === "FailedImportStrike" || event.eventType === "ErroredStrike") return true;
  if (event.eventType === "StalledStrike" && event.strikeCount >= STALLED_INTERVENTION_STRIKES) return true;
  return /^error$/i.test(event.severity || "");
}

// Notifications can arrive in bursts; serialise the read-modify-write on IntegrationData.
let recordQueue = Promise.resolve();

function recordInboundEvent(event) {
  const run = recordQueue.then(() => writeInboundEvent(event));
  recordQueue = run.catch(() => {});
  return run;
}

async function writeInboundEvent(event) {
  const now = Date.now();
  const stored = { ...event, id: `${now}-${randomBytes(3).toString("hex")}`, receivedAt: new Date(now).toISOString() };
  const current = (await getIntegrationData()).cleanuparr || {};
  const handled = { ...(current.handled || {}) };
  for (const [hash, entry] of Object.entries(handled)) {
    if (now - new Date(entry.at).getTime() > HANDLED_TTL_MS) delete handled[hash];
  }
  if (stored.hash && HANDLING_EVENTS.has(stored.eventType)) {
    handled[stored.hash] = {
      eventType: stored.eventType,
      reason: stored.reason,
      strikeCount: stored.strikeCount,
      needsIntervention: stored.needsIntervention,
      at: stored.receivedAt,
    };
  }
  const events = [stored, ...(Array.isArray(current.events) ? current.events : [])].slice(0, MAX_EVENTS);
  await saveIntegrationData({ cleanuparr: { ...current, events, handled, lastEventAt: stored.receivedAt } });
  return stored;
}

function alertFromEvent(event) {
  const what = event.item || "A download";
  const labels = {
    FailedImportStrike: "failed to import",
    ErroredStrike: "errored in the download client",
    StalledStrike: `has stalled ${event.strikeCount} times`,
  };
  return {
    alertType: "cleanuparr_intervention",
    severity: event.eventType === "ErroredStrike" || /^error$/i.test(event.severity) ? "critical" : "warning",
    title: "Cleanuparr: needs attention",
    message: `${what} ${labels[event.eventType] || `reported ${event.title}`}${event.instanceType ? ` (${event.instanceType})` : ""}.`,
  };
}

async function handleInbound(body, { deliverAlerts } = {}) {
  const event = parseInboundPayload(body);
  const stored = await recordInboundEvent(event);
  if (stored.needsIntervention && typeof deliverAlerts === "function") {
    await deliverAlerts([alertFromEvent(stored)]).catch((error) => console.error("[CLEANUPARR] Alert delivery failed:", error.message));
  }
  return stored;
}

// Tag cached download rows Cleanuparr is already dealing with.
function annotateDownloads(items = [], cleanuparrData = {}) {
  const handled = cleanuparrData?.handled || {};
  if (!Object.keys(handled).length) return items;
  return items.map((item) => {
    const entry = item?.hash ? handled[String(item.hash).toLowerCase()] : null;
    return entry ? { ...item, cleanuparr: entry } : item;
  });
}

// ---- inbound token ------------------------------------------------------

async function getWebhookToken({ create = true } = {}) {
  const data = (await getIntegrationData()).cleanuparr || {};
  const existing = data.webhookToken ? decryptSecret(data.webhookToken) : "";
  if (existing || !create) return existing;
  return rotateWebhookToken();
}

async function rotateWebhookToken() {
  const token = randomBytes(24).toString("base64url");
  const current = (await getIntegrationData()).cleanuparr || {};
  await saveIntegrationData({ cleanuparr: { ...current, webhookToken: encryptSecret(token) } });
  return token;
}

function tokensMatch(expected, provided) {
  if (!expected || !provided) return false;
  const left = Buffer.from(String(expected));
  const right = Buffer.from(String(provided));
  return left.length === right.length && timingSafeEqual(left, right);
}

module.exports = {
  EVENT_TYPES,
  STALLED_INTERVENTION_STRIKES,
  isCleanuparr,
  summarizeStats,
  fetchStats,
  pingCleanuparr,
  fetchCleanuparrSnapshot,
  classifyTitle,
  parseInboundPayload,
  needsIntervention,
  handleInbound,
  annotateDownloads,
  alertFromEvent,
  getWebhookToken,
  rotateWebhookToken,
  tokensMatch,
};

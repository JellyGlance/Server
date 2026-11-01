// Cleanuparr integration (#317).
// - Stats/health come from Cleanuparr's v2 stats API (GET /api/v2/stats, X-Api-Key).
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

// Normalise a /api/v2/stats response into what the card and widgets need.
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
  const failedJobs = asNumber(pick(jobs, "Failed"));
  const errorEvents = asNumber(bySeverity.Error ?? bySeverity.error);
  const unhealthy = [...downloadClients, ...arrInstances].filter((row) => !row.healthy);
  return {
    timeframeHours: asNumber(pick(raw, "TimeframeHours")) || 168,
    generatedAt: pick(raw, "GeneratedAt") || null,
    events: { total: asNumber(pick(events, "Total")), byType: countMap(pick(events, "ByType")), bySeverity },
    strikes: { total: asNumber(pick(strikes, "Total")), byType: countMap(pick(strikes, "ByType")), recovered: asNumber(pick(strikes, "Recovered")) },
    removals: { total: asNumber(pick(removals, "Total")), byReason: countMap(pick(removals, "ByReason")) },
    cleaned: { total: asNumber(pick(cleaned, "Total")), byReason: countMap(pick(cleaned, "ByReason")) },
    searches: {
      total: asNumber(pick(searches, "Total")),
      grabbed: asNumber(pick(searches, "Grabbed")),
      failed: asNumber(pick(searches, "Failed")),
    },
    jobs: { total: asNumber(pick(jobs, "Total")), completed: asNumber(pick(jobs, "Completed")), failed: failedJobs },
    health: {
      downloadClients,
      arrInstances,
      unhealthy: unhealthy.map((row) => ({ name: row.name, type: row.type, error: row.error })),
      healthy: unhealthy.length === 0,
    },
    needsAttention: errorEvents + failedJobs + unhealthy.length,
  };
}

function apiHeaders(app) {
  return { "X-Api-Key": app.values?.secret || "", Accept: "application/json" };
}

function baseUrl(app) {
  const url = stripTrailingSlashes(String(app.values?.url || "").trim());
  const basePath = String(app.values?.basePath || "").trim().replace(/^\/+|\/+$/g, "");
  if (!url || !basePath || url.endsWith(`/${basePath}`)) return url;
  return `${url}/${basePath}`;
}

async function fetchStats(app, { hours = 168 } = {}) {
  const url = baseUrl(app);
  if (!url || !app.values?.secret) throw new Error("URL and API key required");
  const response = await safeHttpGet(url, "/api/v2/stats", {
    timeout: 12000,
    headers: apiHeaders(app),
    params: { hours: Math.min(8760, Math.max(1, Number(hours) || 168)), includeDryRun: false },
    validateStatus: () => true,
  });
  if (response.status === 401 || response.status === 403) throw new Error("Cleanuparr rejected the API key");
  if (response.status >= 400) throw new Error(`HTTP ${response.status}`);
  if (!response.data || typeof response.data !== "object") throw new Error("Unexpected response from Cleanuparr");
  return summarizeStats(response.data);
}

async function pingCleanuparr(integration) {
  try {
    const stats = await fetchStats(integration, { hours: 24 });
    const { downloadClients, arrInstances, unhealthy } = stats.health;
    const parts = [`${downloadClients.length} client${downloadClients.length === 1 ? "" : "s"}`, `${arrInstances.length} arr`];
    return {
      ok: true,
      version: "Cleanuparr",
      message: unhealthy.length
        ? `Reachable · ${unhealthy.length} unhealthy (${unhealthy.map((row) => row.name).join(", ")})`
        : `Reachable · ${parts.join(", ")} healthy`,
      health: stats.health,
    };
  } catch (error) {
    return { ok: false, error: error.message };
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
      };
    },
    { events: 0, strikes: 0, removals: 0, cleaned: 0, unhealthy: 0, needsAttention: 0, unreachable: 0 }
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

function parseDataLines(message = "") {
  const data = {};
  const description = [];
  for (const line of String(message).split(/\n+/)) {
    const match = line.match(/^\s*\*\*(.+?):\*\*\s*(.*)$/);
    if (match) data[match[1].trim()] = match[2].trim();
    else if (line.trim()) description.push(line.trim());
  }
  return { data, description: description.join(" ") };
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
  const text = String(title).trim();
  const strike = text.match(/^Strike received with reason:\s*(\S+)/i);
  if (strike) return { eventType: strikeEventFromReason(strike[1]), reason: strike[1] };
  const deleted = text.match(/^Deleting item from queue with reason:\s*(.+)$/i);
  if (deleted) return { eventType: "QueueItemDeleted", reason: deleted[1] };
  const cleaned = text.match(/^Cleaned item from download client with reason:\s*(.+)$/i);
  if (cleaned) return { eventType: "DownloadCleaned", reason: cleaned[1] };
  const stopped = text.match(/^Stopped item in download client with reason:\s*(.+)$/i);
  if (stopped) return { eventType: "DownloadStopped", reason: stopped[1] };
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
    for (const field of Array.isArray(embed.fields) ? embed.fields : []) {
      if (field?.name) data[String(field.name)] = String(field.value ?? "");
    }
  } else {
    const parsed = parseDataLines(message);
    data = parsed.data;
    description = parsed.description;
  }
  if (payload.data && typeof payload.data === "object") data = { ...data, ...payload.data };
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

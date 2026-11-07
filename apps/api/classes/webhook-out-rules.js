// Outbound webhook rules: "when <trigger> [and <field> contains <text>] then POST to <url>".
// Pure helpers only (matching, templating, payload shapes); webhook-out.js stores rules,
// listens to the app's event bus and delivers.

// Each trigger maps one or more internal events (the same ones the Webhooks page uses) and,
// for threshold alerts, the alert type that raised them.
const TRIGGERS = {
  download_stuck: { label: "Download stuck", event: "threshold_alert", alertType: "stuck_download" },
  download_failed: { label: "Download failed", event: "download_failed" },
  download_completed: { label: "Download completed", event: "download_completed" },
  cleanuparr_intervention: { label: "Cleanuparr needs attention", event: "threshold_alert", alertType: "cleanuparr_intervention" },
  disk_low: { label: "Low disk space", event: "threshold_alert", alertType: "low_disk" },
  any_alert: { label: "Any threshold alert", event: "threshold_alert" },
  playback_started: { label: "Playback started", event: "playback_started" },
  playback_stopped: { label: "Playback stopped", event: "playback_ended" },
  media_added: { label: "New media added", event: "media_recently_added" },
  integration_warning: { label: "Integration health warning", event: "integration_health_warning" },
  task_failed: { label: "Task failed", event: "task_failed" },
};

const FORMATS = {
  json: { label: "Generic JSON" },
  homeassistant: { label: "Home Assistant webhook" },
  ntfy: { label: "ntfy (JSON publish)" },
  discord: { label: "Discord webhook" },
};

const MAX_RULES = 25;
const MAX_LOG = 50;

function str(value, max) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function normalizeHeaders(headers) {
  const out = {};
  const entries = Array.isArray(headers)
    ? headers.map((row) => [row?.name, row?.value])
    : Object.entries(headers && typeof headers === "object" ? headers : {});
  for (const [name, value] of entries.slice(0, 10)) {
    const key = str(String(name || ""), 100);
    if (!key || !/^[A-Za-z0-9-]+$/.test(key)) continue;
    out[key] = str(String(value ?? ""), 1000);
  }
  return out;
}

function normalizeRule(rule = {}, index = 0) {
  const cooldown = Number.parseInt(rule.cooldownMinutes, 10);
  return {
    id: str(String(rule.id || ""), 64) || `hook-${Date.now().toString(36)}-${index}`,
    name: str(rule.name, 80) || TRIGGERS[rule.trigger]?.label || "Webhook rule",
    enabled: rule.enabled !== false,
    trigger: TRIGGERS[rule.trigger] ? rule.trigger : "download_stuck",
    format: FORMATS[rule.format] ? rule.format : "json",
    url: str(rule.url, 2048),
    headers: normalizeHeaders(rule.headers),
    bodyTemplate: str(rule.bodyTemplate, 8000),
    filterField: str(rule.filterField, 64),
    filterText: str(rule.filterText, 200),
    cooldownMinutes: Number.isInteger(cooldown) ? Math.min(1440, Math.max(0, cooldown)) : 0,
  };
}

function normalizeRules(rules) {
  return (Array.isArray(rules) ? rules : []).slice(0, MAX_RULES).map(normalizeRule);
}

function getPath(data, path) {
  return String(path || "")
    .split(".")
    .filter(Boolean)
    .reduce((value, key) => (value == null || !Object.prototype.hasOwnProperty.call(Object(value), key) ? undefined : value[key]), data);
}

// Turns any internal event into the flat shape rules and templates work with.
function buildContext(eventType, data = {}, triggerId = null) {
  const user = data.UserName || data.userData?.username || data.user || "";
  const item = data.ItemName || data.mediaInfo?.mediaName || data.item || data.name || data.title || "";
  const title = data.title || (TRIGGERS[triggerId]?.label ?? eventType);
  const message = data.message || [user, item].filter(Boolean).join(" · ") || title;
  return {
    trigger: triggerId,
    event: eventType,
    title: String(title),
    message: String(message),
    severity: data.severity || (/fail|error/i.test(eventType) ? "critical" : "info"),
    alertType: data.alertType || "",
    user,
    item,
    series: data.SeriesName || data.mediaInfo?.seriesName || "",
    device: data.DeviceName || data.sessionInfo?.deviceName || "",
    at: data.triggeredAt || new Date().toISOString(),
    data,
  };
}

function matchesTrigger(triggerId, eventType, data = {}) {
  const trigger = TRIGGERS[triggerId];
  if (!trigger || trigger.event !== eventType) return false;
  return !trigger.alertType || data.alertType === trigger.alertType;
}

function matchesRule(rule, eventType, data = {}) {
  if (!rule.enabled || !rule.url || !matchesTrigger(rule.trigger, eventType, data)) return false;
  if (!rule.filterText) return true;
  const context = buildContext(eventType, data, rule.trigger);
  const field = rule.filterField || "message";
  const value = getPath(context, field) ?? getPath(data, field);
  return String(value ?? "").toLowerCase().includes(rule.filterText.toLowerCase());
}

function rulesFor(rules, eventType, data = {}) {
  return normalizeRules(rules).filter((rule) => matchesRule(rule, eventType, data));
}

// {{title}}, {{data.alertType}} ... Values are JSON-escaped so templates stay valid JSON.
function renderTemplate(template, context) {
  return String(template).replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, path) => {
    const value = getPath(context, path);
    if (value == null) return "";
    const text = typeof value === "object" ? JSON.stringify(value) : String(value);
    return JSON.stringify(text).slice(1, -1);
  });
}

const SEVERITY_COLOUR = { info: 0x3b82f6, warning: 0xe3a008, critical: 0xc90000 };
const NTFY_PRIORITY = { info: 3, warning: 4, critical: 5 };

function defaultBody(format, context, url = "") {
  if (format === "discord") {
    return {
      username: "JellyGlance",
      embeds: [{
        title: context.title.slice(0, 256),
        description: context.message.slice(0, 4000),
        color: SEVERITY_COLOUR[context.severity] || SEVERITY_COLOUR.info,
        timestamp: context.at,
        footer: { text: `JellyGlance · ${context.trigger || context.event}` },
      }],
    };
  }
  if (format === "ntfy") {
    // ntfy JSON publishing posts to the server root with the topic in the body.
    let topic = "";
    try {
      topic = new URL(url).pathname.replace(/^\/+|\/+$/g, "");
    } catch {
      topic = "";
    }
    return {
      topic: topic || "jellyglance",
      title: context.title.slice(0, 120),
      message: context.message,
      priority: NTFY_PRIORITY[context.severity] || 3,
      tags: ["jellyglance", context.trigger || context.event],
    };
  }
  const { data, ...flat } = context;
  if (format === "homeassistant") return { ...flat, source: "jellyglance" };
  return { ...flat, source: "jellyglance", data };
}

function ntfyTarget(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}/`;
  } catch {
    return url;
  }
}

// Returns { url, headers, body } for a rule and context, or throws if a custom template is not JSON.
function buildRequest(rule, context) {
  let body;
  if (rule.bodyTemplate) {
    const rendered = renderTemplate(rule.bodyTemplate, context);
    try {
      body = JSON.parse(rendered);
    } catch (error) {
      throw Object.assign(new Error(`Body template is not valid JSON after filling in values: ${error.message}`), { code: "bad_template" });
    }
  } else {
    body = defaultBody(rule.format, context, rule.url);
  }
  const url = rule.format === "ntfy" && !rule.bodyTemplate ? ntfyTarget(rule.url) : rule.url;
  const headers = { "Content-Type": "application/json" };
  for (const [name, value] of Object.entries(rule.headers || {})) headers[name] = renderTemplate(value, context);
  return { url, headers, body };
}

function sampleData(triggerId) {
  const trigger = TRIGGERS[triggerId] || TRIGGERS.download_stuck;
  const samples = {
    download_stuck: { title: "Download stuck", message: "Example.Show.S01E01 has made no progress for 75 minutes.", alertType: "stuck_download", severity: "warning" },
    cleanuparr_intervention: { title: "Cleanuparr: needs attention", message: "Example.Movie.2024 failed to import (radarr).", alertType: "cleanuparr_intervention", severity: "warning" },
    disk_low: { title: "Low disk space", message: "/data has 4% free (120 GB).", alertType: "low_disk", severity: "critical" },
    any_alert: { title: "Test alert", message: "This is a sample JellyGlance alert.", alertType: "test", severity: "info" },
    download_failed: { name: "Example.Show.S01E02", message: "Example.Show.S01E02 failed in qBittorrent.", client: "qBittorrent" },
    download_completed: { name: "Example.Show.S01E03", message: "Example.Show.S01E03 finished downloading.", client: "qBittorrent" },
    playback_started: { UserName: "alice", ItemName: "Example Movie", DeviceName: "Living Room TV" },
    playback_stopped: { UserName: "alice", ItemName: "Example Movie", DeviceName: "Living Room TV" },
    media_added: { title: "New media added", message: "3 new items in Movies." },
    integration_warning: { title: "Integration health warning", message: "Sonarr did not respond." },
    task_failed: { title: "Task failed", message: "Full Jellyfin sync failed.", taskName: "Full Sync" },
  };
  return { ...(samples[triggerId] || {}), test: true, event: trigger.event, triggeredAt: new Date().toISOString() };
}

// Discord/Slack/ntfy/HA webhook URLs carry their token in the path or query: only show the host.
function maskUrl(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}/…`;
  } catch {
    return url ? "(saved)" : "";
  }
}

const CATALOG = {
  triggers: Object.entries(TRIGGERS).map(([id, trigger]) => ({ id, label: trigger.label, event: trigger.event })),
  formats: Object.entries(FORMATS).map(([id, format]) => ({ id, label: format.label })),
  fields: ["title", "message", "severity", "alertType", "user", "item", "series", "device"],
  maxRules: MAX_RULES,
};

module.exports = {
  CATALOG,
  FORMATS,
  MAX_LOG,
  MAX_RULES,
  TRIGGERS,
  buildContext,
  buildRequest,
  defaultBody,
  maskUrl,
  matchesRule,
  matchesTrigger,
  normalizeRule,
  normalizeRules,
  renderTemplate,
  rulesFor,
  sampleData,
};

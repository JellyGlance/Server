const timers = require("./timers");
// Threshold alerts: stuck downloads, low disk space, failed Jellyfin scheduled tasks, new playback devices
// and user-defined rules (see alert-rules.js).
// Alerts go out as the "threshold_alert" webhook event and as an admin-only in-app notification.
const axios = require("axios");
const { mediaServerAuthHeaders } = require("./server-type");
const db = require("../db");
const configClass = require("./config");
const { getIntegrations, getIntegrationData } = require("./integration-store");
const { sendUpdate } = require("../ws");
const alertRules = require("./alert-rules");
const alertActions = require("./alert-actions");
const { encryptSecret, decryptSecret } = require("./integration-store");

const USER_AGENT = "JellyGlance";
const CHECK_INTERVAL_MS = 5 * 60 * 1000;
const REPEAT_AFTER_MS = 24 * 60 * 60 * 1000;
const DEFAULTS = {
  enabled: true,
  stuckDownloads: true,
  stuckMinutes: 60,
  lowDisk: true,
  lowDiskPercent: 10,
  failedJobs: true,
  newDevices: true,
  customRules: [],
};

let timer = null;
let running = false;

async function readSettings() {
  const { rows } = await db.query('SELECT settings FROM app_config where "ID"=1');
  return rows[0]?.settings || {};
}

async function writeSettingsKey(key, value) {
  const settings = await readSettings();
  settings[key] = value;
  await db.query('UPDATE app_config SET settings=$1 where "ID"=1', [settings]);
}

function normalize(rules = {}) {
  const merged = { ...DEFAULTS, ...rules };
  return {
    enabled: merged.enabled !== false,
    stuckDownloads: merged.stuckDownloads !== false,
    stuckMinutes: Math.min(1440, Math.max(10, Number(merged.stuckMinutes) || DEFAULTS.stuckMinutes)),
    lowDisk: merged.lowDisk !== false,
    lowDiskPercent: Math.min(50, Math.max(1, Number(merged.lowDiskPercent) || DEFAULTS.lowDiskPercent)),
    failedJobs: merged.failedJobs !== false,
    newDevices: merged.newDevices !== false,
    customRules: alertRules.normalizeRules(merged.customRules),
  };
}

async function getAlertSettings() {
  const settings = await readSettings();
  return normalize(settings.ThresholdAlerts);
}

// Settings as the browser sees them: action URLs and tokens are replaced by hints.
function maskSettings(rules) {
  return {
    ...rules,
    customRules: rules.customRules.map((rule) => ({ ...rule, actions: alertActions.maskActions(rule.actions, decryptSecret) })),
  };
}

// Keeps saved action secrets when the form sends them back blank, and encrypts new ones.
function withActionSecrets(nextRules = [], savedRules = []) {
  const saved = new Map(savedRules.map((rule) => [rule.id, rule]));
  return alertRules.normalizeRules(nextRules).map((rule) => ({
    ...rule,
    actions: alertActions.mergeActionSecrets(rule.actions, saved.get(rule.id)?.actions || [], encryptSecret),
  }));
}

async function saveAlertSettings(next = {}) {
  const current = await getAlertSettings();
  const merged = { ...current, ...next };
  if (next.customRules) merged.customRules = withActionSecrets(next.customRules, current.customRules);
  const saved = normalize(merged);
  await writeSettingsKey("ThresholdAlerts", saved);
  return saved;
}

async function getAlertState() {
  const settings = await readSettings();
  return settings.ThresholdAlertState || { seen: {} };
}

async function getAlertLog() {
  const settings = await readSettings();
  return Array.isArray(settings.ThresholdAlertLog) ? settings.ThresholdAlertLog : [];
}

function formatBytes(bytes = 0) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  const value = Number(bytes) || 0;
  if (value <= 0) return "0 B";
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${(value / 1024 ** index).toFixed(index < 3 ? 0 : 1)} ${units[index]}`;
}

async function deliver(alerts, { rules = [] } = {}) {
  if (!alerts.length) return;
  const WebhookManager = require("./webhook-manager");
  const manager = new WebhookManager();
  const log = await getAlertLog();
  const rulesById = new Map(rules.map((rule) => [rule.id, rule]));
  for (const alert of alerts) {
    const entry = { ...alert, at: new Date().toISOString() };
    const actions = alert.ruleId ? rulesById.get(alert.ruleId)?.actions || [] : [];
    if (actions.length) {
      entry.delivery = await Promise.all(actions.map((action) => alertActions.sendAction(action, entry, { decrypt: decryptSecret })));
    }
    log.unshift(entry);
    sendUpdate("ThresholdAlert", { type: alert.severity === "critical" ? "Error" : "Warning", title: alert.title, message: alert.message, alertType: alert.alertType });
    await manager
      .triggerEventWebhooks("threshold_alert", { title: alert.title, message: alert.message, alertType: alert.alertType, severity: alert.severity })
      .catch((error) => console.error("[ALERTS] Webhook delivery failed:", error.message));
    console.log(`[ALERTS] ${alert.title}: ${alert.message}`);
  }
  await writeSettingsKey("ThresholdAlertLog", log.slice(0, 60));
}

// ---- checks -------------------------------------------------------------

async function checkStuckDownloads(rules) {
  const data = await getIntegrationData();
  const items = data.downloads?.items || [];
  const handled = data.cleanuparr?.handled || {};
  return items
    .filter((item) => item.stalled && Number(item.stalledMinutes || 0) >= rules.stuckMinutes)
    // Cleanuparr is already striking or removing these; it raises its own alert if a person is needed.
    .filter((item) => !(item.hash && handled[String(item.hash).toLowerCase()]))
    .map((item) => {
      const name = item.name || item.title || "A download";
      const minutes = Number(item.stalledMinutes || 0);
      const duration = minutes >= 120 ? `${Math.round(minutes / 60)} hours` : `${minutes} minutes`;
      return {
        key: `download:${item.id || name}`,
        alertType: "stuck_download",
        severity: "warning",
        title: "Download stuck",
        message: `${name} has been stuck for ${duration}${item.stalledReason ? ` (${item.stalledReason})` : ""}${item.client ? ` in ${item.client}` : ""}.`,
      };
    });
}

async function arrApps() {
  const integrations = await getIntegrations().catch(() => ({ arrApps: [] }));
  return (integrations.arrApps || [])
    .filter((app) => app.connected && app.values?.url && app.values?.secret && /sonarr|radarr|lidarr|readarr/i.test(String(app.slug || app.name || "")))
    .map((app) => ({ name: app.name || app.slug, url: String(app.values.url).replace(/\/+$/, ""), secret: app.values.secret, lidarr: /lidarr|readarr/i.test(String(app.slug || app.name)) }));
}

async function fetchDisks() {
  const seen = new Map();
  for (const app of await arrApps()) {
    const path = app.lidarr ? "/api/v1/diskspace" : "/api/v3/diskspace";
    const disks = await axios
      .get(`${app.url}${path}`, { timeout: 15000, headers: { "X-Api-Key": app.secret, "User-Agent": USER_AGENT } })
      .then((response) => (Array.isArray(response.data) ? response.data : []))
      .catch(() => []);
    for (const disk of disks) {
      const total = Number(disk.totalSpace || 0);
      // eslint-disable-next-line no-unused-vars -- existing code, kept unchanged
      const free = Number(disk.freeSpace || 0);
      if (!total || total < 5 * 1024 ** 3) continue; // skip tiny system mounts
      const key = `${total}:${disk.path}`;
      if (!seen.has(key)) seen.set(key, { ...disk, source: app.name });
    }
  }
  return [...seen.values()];
}

async function checkLowDisk(rules) {
  const alerts = [];
  for (const disk of await fetchDisks()) {
    const percent = (Number(disk.freeSpace) / Number(disk.totalSpace)) * 100;
    if (percent > rules.lowDiskPercent) continue;
    alerts.push({
      key: `disk:${disk.path}`,
      alertType: "low_disk",
      severity: percent <= rules.lowDiskPercent / 2 ? "critical" : "warning",
      title: "Low disk space",
      message: `${disk.label || disk.path} has ${formatBytes(disk.freeSpace)} free of ${formatBytes(disk.totalSpace)} (${percent.toFixed(1)}%), reported by ${disk.source}.`,
    });
  }
  return alerts;
}

async function checkFailedJobs() {
  const config = await new configClass().getConfig();
  if (!config?.JF_HOST || !config?.JF_API_KEY) return [];
  const tasks = await axios
    .get(`${String(config.JF_HOST).replace(/\/+$/, "")}/ScheduledTasks`, {
      timeout: 20000,
      headers: { ...mediaServerAuthHeaders(config.JF_API_KEY), "User-Agent": USER_AGENT },
    })
    .then((response) => (Array.isArray(response.data) ? response.data : []))
    .catch(() => []);
  const since = Date.now() - 6 * 60 * 60 * 1000;
  return tasks
    .filter((task) => {
      const result = task.LastExecutionResult;
      return result && /fail|abort/i.test(String(result.Status || "")) && new Date(result.EndTimeUtc || 0).getTime() > since;
    })
    .map((task) => ({
      key: `job:${task.Id}:${task.LastExecutionResult.EndTimeUtc}`,
      once: true,
      alertType: "failed_job",
      severity: "warning",
      title: "Server job failed",
      message: `${task.Name} ${String(task.LastExecutionResult.Status).toLowerCase() === "aborted" ? "was aborted" : "failed"}${task.LastExecutionResult.ErrorMessage ? `: ${String(task.LastExecutionResult.ErrorMessage).slice(0, 200)}` : "."}`,
    }));
}

async function queryNewDevices(state) {
  const since = state.lastDeviceCheck ? new Date(state.lastDeviceCheck) : new Date();
  const { rows } = await db.query(
    `SELECT "DeviceId" AS device_id, MAX("DeviceName") AS device, MAX("Client") AS client, MAX("UserName") AS user_name, MIN("ActivityDateInserted") AS first_seen
       FROM jf_playback_activity
      WHERE "DeviceId" IS NOT NULL AND COALESCE(imported, false) = false
      GROUP BY "DeviceId"
     HAVING MIN("ActivityDateInserted") > $1`,
    [since]
  );
  return rows;
}

async function checkNewDevices(state) {
  const rows = await queryNewDevices(state);
  return rows.map((row) => ({
    key: `device:${row.device_id}`,
    once: true,
    alertType: "new_device",
    severity: "info",
    title: "New device",
    message: `${row.user_name || "Someone"} played something on a new device: ${[row.device, row.client].filter(Boolean).join(" · ") || "unknown device"}.`,
  }));
}

// Event inputs for rule triggers. The first run only records what exists, so installing or
// enabling a rule never fires for users, items or server state that were already there.
async function collectEvents(needs, state) {
  const API = require("./api-loader");
  const events = {};
  if (needs.has("users")) {
    const users = await API.getUsers(true).catch(() => null);
    if (Array.isArray(users)) {
      const known = new Set(state.knownUserIds || []);
      if (state.knownUserIds) events.newUsers = users.filter((user) => !known.has(user.Id)).map((user) => user.Name || user.Id);
      state.knownUserIds = users.map((user) => user.Id);
    }
  }
  if (needs.has("server")) {
    let up = true;
    let error = "";
    try {
      const info = await API.systemInfo();
      if (!info) up = false;
    } catch (requestError) {
      up = false;
      error = requestError?.response ? `HTTP ${requestError.response.status}` : requestError?.code || "no response";
    }
    if (typeof state.serverUp === "boolean") {
      events.serverWentDown = state.serverUp && !up;
      events.serverCameUp = !state.serverUp && up;
      events.serverError = error;
    }
    state.serverUp = up;
  }
  if (needs.has("items")) {
    const since = state.lastItemCheck;
    state.lastItemCheck = new Date().toISOString();
    if (since) {
      const { rows } = await db.query(
        `SELECT count(*) OVER ()::int AS total, "Name" FROM jf_library_items
          WHERE archived = false AND "DateCreated" > $1 ORDER BY "DateCreated" DESC LIMIT 5`,
        [since]
      );
      events.newItems = { count: rows[0]?.total || 0, names: rows.map((row) => row.Name).filter(Boolean) };
    }
  }
  if (needs.has("devices")) {
    const rows = await queryNewDevices(state).catch(() => []);
    events.newDevices = rows.map((row) => [row.user_name, row.device || row.client].filter(Boolean).join(" on ") || "unknown device");
  }
  return events;
}

async function checkCustomRules(rules, state) {
  const needs = alertRules.neededInputs(rules.customRules);
  if (!needs.size) return [];
  const API = require("./api-loader");
  const [sessions, disks, downloads, events] = await Promise.all([
    needs.has("sessions") ? API.getSessions().catch(() => undefined) : undefined,
    needs.has("disks") ? fetchDisks().catch(() => undefined) : undefined,
    needs.has("downloads") ? getIntegrationData().then((data) => data.downloads?.items).catch(() => undefined) : undefined,
    collectEvents(needs, state).catch(() => ({})),
  ]);
  return alertRules.evaluateRules(rules.customRules, alertRules.collectMetrics({ sessions, disks, downloads }), new Date(), events);
}

// ---- runner -------------------------------------------------------------

async function runChecks({ force = false } = {}) {
  if (running) return { skipped: true };
  running = true;
  try {
    const rules = await getAlertSettings();
    if (!rules.enabled && !force) return { disabled: true };
    const settings = await readSettings();
    const state = settings.ThresholdAlertState || { seen: {} };
    state.seen = state.seen || {};
    const startedAt = new Date().toISOString();

    const results = await Promise.all([
      rules.stuckDownloads ? checkStuckDownloads(rules).catch(() => []) : [],
      rules.lowDisk ? checkLowDisk(rules).catch(() => []) : [],
      rules.failedJobs ? checkFailedJobs().catch(() => []) : [],
      rules.newDevices ? checkNewDevices(state).catch(() => []) : [],
      rules.customRules.length ? checkCustomRules(rules, state).catch(() => []) : [],
    ]);
    const found = results.flat();
    const now = Date.now();
    const activeKeys = new Set(found.map((alert) => alert.key));
    state.ruleLastFired = state.ruleLastFired || {};
    const toSend = found.filter((alert) => {
      // Custom rules follow their own cooldown, whether the condition flaps or persists.
      if (alert.ruleId) return alertRules.cooledDown(alert, state.ruleLastFired[alert.ruleId], now);
      const last = state.seen[alert.key];
      if (!last) return true;
      return !alert.once && now - last > REPEAT_AFTER_MS;
    });
    toSend.forEach((alert) => {
      if (alert.ruleId) state.ruleLastFired[alert.ruleId] = now;
      else state.seen[alert.key] = now;
    });
    const ruleIds = new Set(rules.customRules.map((rule) => rule.id));
    for (const id of Object.keys(state.ruleLastFired)) if (!ruleIds.has(id)) delete state.ruleLastFired[id];
    // Forget cleared conditions (so they alert again if they come back), and old one-off keys.
    for (const [key, at] of Object.entries(state.seen)) {
      const oneOff = key.startsWith("job:") || key.startsWith("device:");
      if (oneOff ? now - at > 30 * 86400000 : !activeKeys.has(key)) delete state.seen[key];
    }
    state.lastDeviceCheck = startedAt;
    state.lastRunAt = startedAt;
    await writeSettingsKey("ThresholdAlertState", state);
    await deliver(
      // eslint-disable-next-line no-unused-vars -- strip internal fields before logging
      toSend.map(({ key, once, cooldownMs, ...alert }) => alert),
      { rules: rules.customRules }
    );
    return { checked: found.length, sent: toSend.length };
  } finally {
    running = false;
  }
}

async function sendTestAlert() {
  await deliver([
    { alertType: "test", severity: "info", title: "Test alert", message: "Threshold alerts are working. You'll get messages like this for stuck downloads, low disk space, failed jobs and new devices." },
  ]);
}

// Sends a test through one rule's actions. The rule may be unsaved; blank action fields reuse
// the saved secrets for the same rule and action ids. Returns one result per action.
async function sendRuleTest(draft = {}) {
  const current = await getAlertSettings();
  const [rule] = withActionSecrets([draft], current.customRules);
  const alert = {
    ruleId: rule.id,
    trigger: rule.trigger,
    alertType: "test",
    severity: rule.severity,
    title: `Test: ${rule.name || "alert rule"}`,
    message: `This is a test of the rule "${alertRules.describe(rule)}".`,
    at: new Date().toISOString(),
  };
  const results = rule.actions.length ? await Promise.all(rule.actions.map((action) => alertActions.sendAction(action, alert, { decrypt: decryptSecret }))) : [];
  const log = await getAlertLog();
  log.unshift({ ...alert, delivery: results });
  await writeSettingsKey("ThresholdAlertLog", log.slice(0, 60));
  sendUpdate("ThresholdAlert", { type: "Warning", title: alert.title, message: alert.message, alertType: "test" });
  return results;
}

function start() {
  if (timer) return;
  timers.after(() => runChecks().catch((error) => console.error("[ALERTS] Check failed:", error.message)), 60 * 1000);
  timer = timers.every(() => runChecks().catch((error) => console.error("[ALERTS] Check failed:", error.message)), CHECK_INTERVAL_MS);
}

function stop() {
  timers.clear(timer);
  timer = null;
}

module.exports = { fetchDisks, deliver, start, stop, runChecks, sendTestAlert, sendRuleTest, getAlertSettings, saveAlertSettings, getAlertLog, getAlertState, maskSettings };

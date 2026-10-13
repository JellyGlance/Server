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

async function saveAlertSettings(next = {}) {
  const current = await getAlertSettings();
  const saved = normalize({ ...current, ...next });
  await writeSettingsKey("ThresholdAlerts", saved);
  return saved;
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

async function deliver(alerts) {
  if (!alerts.length) return;
  const WebhookManager = require("./webhook-manager");
  const manager = new WebhookManager();
  const log = await getAlertLog();
  for (const alert of alerts) {
    const entry = { ...alert, at: new Date().toISOString() };
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
  return items
    .filter((item) => item.stalled && Number(item.stalledMinutes || 0) >= rules.stuckMinutes)
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

async function checkNewDevices(state) {
  const since = state.lastDeviceCheck ? new Date(state.lastDeviceCheck) : new Date();
  const { rows } = await db.query(
    `SELECT "DeviceId" AS device_id, MAX("DeviceName") AS device, MAX("Client") AS client, MAX("UserName") AS user_name, MIN("ActivityDateInserted") AS first_seen
       FROM jf_playback_activity
      WHERE "DeviceId" IS NOT NULL AND COALESCE(imported, false) = false
      GROUP BY "DeviceId"
     HAVING MIN("ActivityDateInserted") > $1`,
    [since]
  );
  return rows.map((row) => ({
    key: `device:${row.device_id}`,
    once: true,
    alertType: "new_device",
    severity: "info",
    title: "New device",
    message: `${row.user_name || "Someone"} played something on a new device: ${[row.device, row.client].filter(Boolean).join(" · ") || "unknown device"}.`,
  }));
}

async function checkCustomRules(rules) {
  const needs = alertRules.neededInputs(rules.customRules);
  if (!needs.size) return [];
  const API = require("./api-loader");
  const [sessions, disks, downloads] = await Promise.all([
    needs.has("sessions") ? API.getSessions().catch(() => undefined) : undefined,
    needs.has("disks") ? fetchDisks().catch(() => undefined) : undefined,
    needs.has("downloads") ? getIntegrationData().then((data) => data.downloads?.items).catch(() => undefined) : undefined,
  ]);
  return alertRules.evaluateRules(rules.customRules, alertRules.collectMetrics({ sessions, disks, downloads }));
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
      rules.customRules.length ? checkCustomRules(rules).catch(() => []) : [],
    ]);
    const found = results.flat();
    const now = Date.now();
    const activeKeys = new Set(found.map((alert) => alert.key));
    const toSend = found.filter((alert) => {
      const last = state.seen[alert.key];
      if (!last) return true;
      return !alert.once && now - last > REPEAT_AFTER_MS;
    });
    toSend.forEach((alert) => {
      state.seen[alert.key] = now;
    });
    // Forget cleared conditions (so they alert again if they come back), and old one-off keys.
    for (const [key, at] of Object.entries(state.seen)) {
      const oneOff = key.startsWith("job:") || key.startsWith("device:");
      if (oneOff ? now - at > 30 * 86400000 : !activeKeys.has(key)) delete state.seen[key];
    }
    state.lastDeviceCheck = startedAt;
    state.lastRunAt = startedAt;
    await writeSettingsKey("ThresholdAlertState", state);
    await deliver(toSend.map(({ key, once, ...alert }) => alert));
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

function start() {
  if (timer) return;
  timers.after(() => runChecks().catch((error) => console.error("[ALERTS] Check failed:", error.message)), 60 * 1000);
  timer = timers.every(() => runChecks().catch((error) => console.error("[ALERTS] Check failed:", error.message)), CHECK_INTERVAL_MS);
}

function stop() {
  timers.clear(timer);
  timer = null;
}

module.exports = { start, stop, runChecks, sendTestAlert, getAlertSettings, saveAlertSettings, getAlertLog };

// api.js
const express = require("express");
const { mediaServerAuthHeaders, chooseServerType, withServerType, saveServerType, envServerType } = require("../classes/server-type");
const { clientSettings } = require("../classes/client-config");
const audiobookshelf = require("../classes/audiobookshelf");
const fs = require("fs");
const path = require("path");

const db = require("../db");
const dbHelper = require("../classes/db-helper");

const { randomUUID } = require("crypto");

const configClass = require("../classes/config");
const { checkForUpdates, fetchGithubContributors, fetchGithubStars, fetchReleaseNotes } = require("../version-control");
const API = require("../classes/api-loader");
const { sendUpdate } = require("../ws");
const { tables } = require("../global/backup_tables");
const TaskScheduler = require("../classes/task-scheduler-singleton");
const TaskManager = require("../classes/task-manager-singleton.js");
const WebhookManager = require("../classes/webhook-manager");
const { axios } = require("../classes/axios");
const triggertype = require("../logging/triggertype");
const { addAuditEntry, getAuditLog, getWebhookDeliveryHistory } = require("../classes/admin-history");
const { getUserPreferences } = require("../classes/user-preferences");
const { buildOpsDigest, buildLibraryStorage, rememberDevices, pingThirdParty } = require("../classes/command-center");
const { sendConfiguredMail, validateEmail } = require("../classes/smtp-mailer");
const { getBackupDir } = require("../utils/storage-paths");
const {
  getIntegrations,
  saveIntegrations,
  getIntegrationData,
  // eslint-disable-next-line no-unused-vars -- existing code, kept unchanged
  saveIntegrationData,
  getIntegrationHealthHistory,
  saveIntegrationHealthResults,
} = require("../classes/integration-store");

const dayjs = require("dayjs");
const {
  router: requestsExtrasRouter,
  enrichRequest,
  enrichRequestPayload,
} = require("./requests");
const { fetchSeerrIssues, runSeerrIssueAction } = require("../classes/seerr-issues");
const { addDownload, deleteDownload, setDownloadPaused, testDownloadClient } = require("../classes/download-client");
const {
  DEFAULT_ACCESS_ROLES,
  DEFAULT_ROLE_PERMISSIONS,
  normalizeAccessRoles,
  persistRolePermissions,
  mergeRolePermissionMap,
} = require("../classes/role-permissions");
const { normalizeApiKeyScope } = require("../classes/api-key-scope");
const {
  assertSafeObjectKey,
  hashPassword,
  isHttpTorrentUrl,
  isSafeObjectKey,
  joinSafeHttpUrl,
  mutateSafeRecord,
  safeAssign,
  safeDelete,
  safeHttpGet,
  safeHttpPost,
  sanitizeForLog,
  sendSafeError,
  stripTrailingSlashes,
  toSafeHttpUrl,
  verifyPassword
} = require("../utils/security");

const router = express.Router();
router.use(requestsExtrasRouter);
const REQUEST_CACHE_TTL_MS = 45000;
const SEERR_MEDIA_DETAIL_CACHE_TTL_MS = 10 * 60 * 1000;
const TDARR_TRANSCODE_CACHE_TTL_MS = 15000;
const requestCache = new Map();
const seerrMediaDetailCache = new Map();
const tdarrTranscodeCache = new Map();
function roleExists(settings = {}, role) {
  return normalizeAccessRoles(settings).includes(role);
}
const NOTIFICATION_CATEGORY_DEFAULTS = {
  librarySync: true,
  playbackSync: true,
  backups: true,
  tasks: true,
  downloads: true,
  errors: true,
  playback: false,
};

const DEFAULT_NOTIFICATION_SETTINGS = {
  mode: "all",
  manualTaskToasts: true,
  position: "bottom-right",
  durationSeconds: 8,
  inApp: true,
  desktop: false,
  mobile: false,
  systemOnlyWhenHidden: true,
  categories: NOTIFICATION_CATEGORY_DEFAULTS,
};

function normalizeNotificationSettings(value = {}) {
  const settings = { ...DEFAULT_NOTIFICATION_SETTINGS, ...(value || {}) };
  if (!["all", "important", "errors", "off"].includes(settings.mode)) {
    settings.mode = DEFAULT_NOTIFICATION_SETTINGS.mode;
  }
  if (!["top-right", "top-center", "bottom-right", "bottom-center"].includes(settings.position)) {
    settings.position = DEFAULT_NOTIFICATION_SETTINGS.position;
  }
  const durationSeconds = Number(settings.durationSeconds);
  settings.durationSeconds = Number.isFinite(durationSeconds) ? Math.min(Math.max(durationSeconds, 3), 30) : DEFAULT_NOTIFICATION_SETTINGS.durationSeconds;
  settings.manualTaskToasts = settings.manualTaskToasts !== false;
  settings.inApp = settings.inApp !== false;
  settings.desktop = settings.desktop === true;
  settings.mobile = settings.mobile === true;
  settings.systemOnlyWhenHidden = settings.systemOnlyWhenHidden !== false;
  const categories = value?.categories && typeof value.categories === "object" ? value.categories : {};
  settings.categories = Object.fromEntries(
    Object.entries(NOTIFICATION_CATEGORY_DEFAULTS).map(([key, fallback]) => [key, typeof categories[key] === "boolean" ? categories[key] : fallback])
  );
  return settings;
}

function queueFirstRunJellyfinTasks() {
  const taskManager = new TaskManager().getInstance();
  const taskQueue = ["JellyfinSync", "PartialJellyfinSync", "JellyfinPlaybackReportingPluginSync", "RefreshDashboardStats"];
  let index = 0;

  const startNextTask = () => {
    const taskKey = taskQueue[index];
    index += 1;

    if (!taskKey) {
      return;
    }

    const task = taskManager.taskList[taskKey];
    if (!task || taskManager.isTaskRunning(task.name)) {
      startNextTask();
      return;
    }

    const added = taskManager.addTask({
      task,
      onComplete: startNextTask,
      onError: (error) => {
        console.log(`[FIRST-RUN] ${task.name} failed: ${error.message}`);
        startNextTask();
      },
      onExit: startNextTask,
    });

    if (!added) {
      startNextTask();
      return;
    }

    taskManager.startTask(task, triggertype.Automatic);
  };

  startNextTask();
}

function normalizeIssuerUrl(url) {
  try {
    const trimmed = stripTrailingSlashes(url);
    return trimmed ? stripTrailingSlashes(toSafeHttpUrl(trimmed)) : "";
  } catch {
    return "";
  }
}

function cleanIntegrationUrl(url = "") {
  try {
    const trimmed = stripTrailingSlashes(url);
    return trimmed ? stripTrailingSlashes(toSafeHttpUrl(trimmed)) : "";
  } catch {
    return "";
  }
}

function getAxiosErrorMessage(error) {
  if (error?.response?.status) {
    const responseData = error.response.data;
    const detail =
      responseData?.message ||
      responseData?.error ||
      responseData?.errors?.[0]?.message ||
      (typeof responseData === "string" ? responseData : "");
    return detail ? `Request failed with status ${error.response.status}: ${detail}` : `Request failed with status ${error.response.status}`;
  }
  return error?.message || "Connection test failed";
}

function extractIntegrationVersion(data) {
  if (typeof data === "string") {
    return data.trim();
  }

  return (
    data?.version ||
    data?.appVersion ||
    data?.bazarr_version ||
    data?.package_version ||
    data?.data?.version ||
    data?.data?.appVersion ||
    data?.data?.bazarr_version ||
    data?.data?.package_version ||
    ""
  );
}

function getBackupSummary() {
  const directoryPath = getBackupDir();
  if (!fs.existsSync(directoryPath)) {
    fs.mkdirSync(directoryPath, { recursive: true });
  }

  const backupFiles = fs
    .readdirSync(directoryPath)
    .filter((file) => file.endsWith(".json"))
    .map((file) => {
      const filePath = path.join(directoryPath, file);
      const stats = fs.statSync(filePath);
      return {
        name: file,
        size: stats.size,
        datecreated: stats.birthtime && stats.birthtime.getTime() > 0 ? stats.birthtime : stats.mtime,
      };
    })
    .sort((a, b) => new Date(b.datecreated) - new Date(a.datecreated));

  return {
    count: backupFiles.length,
    latestBackup: backupFiles[0] || null,
    writable: (() => {
      try {
        const testFile = path.join(directoryPath, ".healthcheck");
        fs.writeFileSync(testFile, "");
        fs.unlinkSync(testFile);
        return true;
      } catch {
        return false;
      }
    })(),
  };
}

async function buildHealthStatus() {
  const checkedAt = new Date().toISOString();
  const checks = [];

  try {
    await db.query("SELECT 1");
    checks.push({ key: "database", label: "Database", ok: true, message: "Connected" });
  } catch (error) {
    checks.push({ key: "database", label: "Database", ok: false, message: error.message });
  }

  try {
    const config = await new configClass().getConfig();
    if (config.error) {
      checks.push({ key: "jellyfin", label: "Media server", ok: false, message: config.error });
    } else {
      const systemInfo = await API.systemInfo();
      const version = systemInfo?.Version ? ` · ${systemInfo.Version}` : "";
      checks.push({
        key: "jellyfin",
        label: "Media server",
        ok: Boolean(systemInfo),
        message: `${systemInfo?.ServerName || "Connected"}${version}`,
      });
    }
  } catch (error) {
    checks.push({ key: "jellyfin", label: "Media server", ok: false, message: error.message });
  }

  const integrations = await getIntegrations().catch(() => ({ arrApps: [], clients: [], thirdParty: [] }));
  const allIntegrations = [...(integrations.arrApps || []), ...(integrations.clients || []), ...(integrations.thirdParty || [])].filter((integration) => integration.connected);
  const integrationHealth = await getIntegrationHealthHistory().catch(() => []);
  const latestFailures = allIntegrations.filter((integration) => {
    const latest = integrationHealth.find((entry) => entry.instanceId === integration.instanceId);
    return latest && !latest.ok;
  });
  checks.push({
    key: "integrations",
    label: "Integrations",
    ok: latestFailures.length === 0,
    message: `${allIntegrations.length} configured${latestFailures.length ? `, ${latestFailures.length} failing` : ""}`,
  });

  const webhookDeliveries = await getWebhookDeliveryHistory().catch(() => []);
  const recentWebhookFailures = webhookDeliveries.slice(0, 20).filter((entry) => !entry.ok);
  checks.push({
    key: "webhooks",
    label: "Webhooks",
    ok: recentWebhookFailures.length === 0,
    message: `${webhookDeliveries.length} recent deliveries${recentWebhookFailures.length ? `, ${recentWebhookFailures.length} failed` : ""}`,
  });

  const backup = getBackupSummary();
  checks.push({
    key: "backups",
    label: "Backups",
    ok: backup.writable && Boolean(backup.latestBackup),
    message: backup.latestBackup ? `Latest ${new Date(backup.latestBackup.datecreated).toISOString()}` : "No backups found",
  });

  const taskScheduler = new TaskScheduler().getInstance();
  const runningTasks = Object.keys(new TaskManager().getInstance().tasks || {});
  checks.push({
    key: "tasks",
    label: "Tasks",
    ok: true,
    message: `${taskScheduler.taskHistory?.length || 0} task histories, ${runningTasks.length} running`,
  });

  return {
    checkedAt,
    ok: checks.every((check) => check.ok),
    checks,
    backup,
    integrations: {
      count: allIntegrations.length,
      failures: latestFailures.map((item) => item.name),
    },
    webhooks: {
      recentDeliveries: webhookDeliveries.length,
      recentFailures: recentWebhookFailures.length,
    },
    tasks: {
      running: runningTasks,
      history: taskScheduler.taskHistory || [],
    },
  };
}

async function testArrIntegration(integration) {
  const url = cleanIntegrationUrl(integration.values?.url);
  const apiKey = integration.values?.secret;
  const name = String(integration.name).toLowerCase();
  if (isTdarrIntegration(integration)) {
    return testTdarrIntegration(integration);
  }
  const isSeerr = name.includes("jellyseerr") || name.includes("overseerr");
  const isBazarr = name === "bazarr";
  const isLidarr = name === "lidarr" || name === "readarr";
  const isProwlarr = name === "prowlarr";
  const isSickChill = name === "sickchill";
  const apiPaths = isSeerr
    ? ["/api/v1/status"]
    : isBazarr
    ? ["/api/system/status", "/api/system/status?apikey=:apiKey"]
    : isProwlarr
    ? ["/api/v1/system/status"]
    : isSickChill
    ? ["/api/:apiKey/?cmd=sb.ping"]
    : [isLidarr ? "/api/v1/system/status" : "/api/v3/system/status"];

  if (!url || !apiKey) {
    return { ok: false, error: "URL and API key are required" };
  }

  let lastError = null;
  for (const path of apiPaths) {
    try {
      const apiPath = path.replace(":apiKey", encodeURIComponent(apiKey));
      const response = await safeHttpGet(url, apiPath, {
        timeout: 10000,
        headers: { "X-Api-Key": apiKey },
      });
      if (isSickChill && String(response.data?.result || "").toLowerCase() === "success") {
        return {
          ok: true,
          version: "SickChill API",
          message: response.data.message || "Connected to SickChill",
        };
      }
      const version = extractIntegrationVersion(response.data);

      if (version) {
        return {
          ok: true,
          version,
          message: `Connected to ${version}`,
        };
      }

      lastError = new Error("Connected, but no version was returned by the service");
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("Connection test failed");
}

async function testDownloadIntegration(integration) {
  return testDownloadClient(integration);
}

function isWizarrIntegration(integration) {
  const name = String(integration?.name || integration?.slug || "").toLowerCase();
  return name === "wizarr" || name.includes("wizarr");
}

function isTdarrIntegration(integration) {
  const name = String(integration?.name || integration?.slug || "").toLowerCase();
  return name === "tdarr" || name.includes("tdarr");
}

function isMaintainerrIntegration(integration) {
  const name = String(integration?.name || integration?.slug || "").toLowerCase();
  return name === "maintainerr" || name.includes("maintainerr");
}

function getWizarrHeaders(integration) {
  const apiKey = integration?.values?.secret;
  return {
    Accept: "application/json",
    ...(apiKey ? { "X-API-Key": apiKey } : {}),
  };
}

function getMaintainerrHeaders(integration) {
  const apiKey = String(integration?.values?.secret || "").trim();
  if (!apiKey) {
    return {
      Accept: "application/json",
    };
  }

  const hasBearerPrefix = /^bearer\s+/i.test(apiKey);
  return {
    Accept: "application/json",
    "X-Api-Key": apiKey,
    "x-api-key": apiKey,
    ...(hasBearerPrefix ? {} : { Authorization: `Bearer ${apiKey}` }),
    ...(hasBearerPrefix ? { Authorization: apiKey } : {}),
  };
}

function getTdarrHeaders(integration) {
  const apiKey = integration?.values?.secret;
  return {
    Accept: "application/json",
    ...(apiKey ? { "x-api-key": apiKey } : {}),
  };
}

async function testWizarrIntegration(integration) {
  const url = cleanIntegrationUrl(integration.values?.url);
  const apiKey = integration.values?.secret;

  if (!url || !apiKey) {
    return { ok: false, error: "URL and API key are required" };
  }

  const response = await safeHttpGet(url, "/api/status", {
    timeout: 10000,
    headers: getWizarrHeaders(integration),
  });
  const data = response.data || {};
  return {
    ok: true,
    version: "Wizarr API",
    message: `${Number(data.invites || 0)} invites · ${Number(data.users || 0)} users`,
  };
}

async function testTdarrIntegration(integration) {
  const url = cleanIntegrationUrl(integration.values?.url);

  if (!url) {
    return { ok: false, error: "URL is required" };
  }

  const [statusResponse, statistics] = await Promise.all([
    safeHttpGet(url, "/api/v2/status", {
      timeout: 10000,
      headers: getTdarrHeaders(integration),
    }),
    fetchTdarrStatistics(integration),
  ]);
  const data = statusResponse.data || {};
  const stats = normalizeTdarrStatistics(statistics);
  const version = extractIntegrationVersion(data) || data?.serverVersion || data?.tdarrVersion || "Tdarr API";
  return {
    ok: true,
    version,
    message: `${stats.queue} queued · ${stats.processed} processed · ${stats.errored} errored`,
  };
}

async function testThirdPartyIntegration(integration) {
  if (isWizarrIntegration(integration)) {
    return testWizarrIntegration(integration);
  }
  if (isTdarrIntegration(integration)) {
    return testTdarrIntegration(integration);
  }
  if (isMaintainerrIntegration(integration)) {
    return testMaintainerrIntegration(integration);
  }
  if (audiobookshelf.isAudiobookshelfIntegration(integration)) {
    return audiobookshelf.testAudiobookshelf(integration);
  }
  return pingThirdParty(integration);
}

async function testMaintainerrIntegration(integration) {
  const url = cleanIntegrationUrl(integration.values?.url);
  if (!url) {
    return { ok: false, error: "URL is required" };
  }

  const response = await safeHttpGet(url, "/api/health", {
    timeout: 10000,
    headers: getMaintainerrHeaders(integration),
  });
  const health = response.data || {};
  const healthy = getMaintainerrHealthStatus(health);
  const version = extractIntegrationVersion(health) || health?.version || "Maintainerr API";
  return {
    ok: healthy,
    version,
    message: healthy ? "Connected to Maintainerr" : "Maintainerr health reports degraded",
  };
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== "");
}

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function pickArray(root, names) {
  if (!root || typeof root !== "object") return [];
  for (const name of names) {
    const value = root[name];
    if (Array.isArray(value)) return value;
    if (value && typeof value === "object") {
      const nested = Object.values(value).find(Array.isArray);
      if (nested) return nested;
    }
  }
  return [];
}

function flattenRecordCollections(root, names) {
  const direct = pickArray(root, names);
  if (direct.length) return direct;
  const results = [];
  for (const value of Object.values(root || {})) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const nested = pickArray(value, names);
      if (nested.length) results.push(...nested);
    }
  }
  return results;
}

function recursivelyFindArrays(root, predicate, maxDepth = 4) {
  const results = [];
  const seen = new WeakSet();

  function visit(value, depth) {
    if (!value || typeof value !== "object" || depth > maxDepth || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      if (!predicate || value.some((item) => item && typeof item === "object" && predicate(item))) {
        results.push(value);
      }
      value.forEach((item) => visit(item, depth + 1));
      return;
    }
    Object.values(value).forEach((item) => visit(item, depth + 1));
  }

  visit(root, 0);
  return results.flat();
}

function extractTdarrTitle(record = {}) {
  const sourceRecord = record.originalLibraryFile || record.libraryFile || record.file || record;
  const rawPath = firstDefined(sourceRecord.filePath, sourceRecord.file, sourceRecord.path, record.filePath, record.file, record.path, record.inputFile, record.originalPath, record._id, "");
  const rawTitle = firstDefined(
    sourceRecord.fileNameWithoutExtension,
    sourceRecord.title,
    sourceRecord.name,
    record.title,
    record.name,
    record.fileName,
    record.originalFileName,
    record.meta?.Title,
    record.DB?.Title,
    record._source?.fileName,
    ""
  );
  const fromPath = String(rawPath || "")
    .split(/[\\/]/)
    .pop()
    ?.replace(/\.[^.]+$/, "");
  return String(rawTitle || fromPath || "Unknown media");
}

function normalizeTdarrDisplayStatus(value) {
  if (value == null || value === "") return "";
  if (typeof value === "object") {
    if (Array.isArray(value)) {
      return value.map(normalizeTdarrDisplayStatus).filter(Boolean).join(" · ");
    }
    return normalizeTdarrDisplayStatus(
      value.Name || value.name || value.pluginName || value.message || value.reason || value.text || value.Number || value.number
    );
  }
  const text = String(value).trim();
  if (!text || text.toLowerCase() === "none" || text === "[object Object]") return "";
  return text;
}

function parseTdarrTargetFromText(value) {
  const text = String(value || "").toLowerCase();
  if (!text || text === "none") return "";

  const codec = text.match(/\b(hevc|h265|h\.265|x265|av1|h264|h\.264|x264|vp9)\b/)?.[1];
  const container = text.match(/\b(mkv|mp4|mov|avi|webm)\b/)?.[1];
  const resolution = text.match(/\b(2160p|4k|1440p|1080p|720p|576p|480p)\b/)?.[1];
  const parts = [
    codec?.replace("h.265", "h265").replace("x265", "h265").replace("h.264", "h264").replace("x264", "h264"),
    container,
    resolution === "4k" ? "2160p" : resolution,
  ].filter(Boolean);

  return parts.length ? [...new Set(parts)].join(" / ") : "";
}

function getTdarrFormatLabel(record = {}) {
  return [
    firstDefined(record.video_codec_name, record.videoCodec, record.codec),
    firstDefined(record.container, record.format),
    firstDefined(record.video_resolution, record.resolution),
  ]
    .map(normalizeTdarrDisplayStatus)
    .filter(Boolean)
    .join(" / ");
}

function tdarrSizeToBytes(value, unit = "gb") {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return 0;
  if (unit === "mb") return number * 1000000;
  if (unit === "bytes") return number;
  return number * 1000000000;
}

function getTdarrTargetLabel(record = {}, status = "queued") {
  const base = record.originalLibraryFile || record.libraryFile || record;
  const output = record.output || record.target || record.result || {};
  const directParts = [
    firstDefined(record.targetCodec, record.outputCodec, output.videoCodec, output.video_codec_name),
    firstDefined(record.targetContainer, record.outputContainer, output.container),
    firstDefined(record.targetResolution, record.outputResolution, output.video_resolution),
  ].map(normalizeTdarrDisplayStatus).filter(Boolean);

  if (directParts.length) {
    return [...new Set(directParts)].join(" / ");
  }

  const descriptiveTarget = firstDefined(record.pluginName, record.flowName, record.lastPluginDetails, base.lastPluginDetails);
  const parsedTarget = parseTdarrTargetFromText(descriptiveTarget);
  if (parsedTarget) return parsedTarget;

  if (status === "queued") {
    const isHealthCheck = String(firstDefined(record.HealthCheck, base.HealthCheck, "")).toLowerCase() === "queued";
    return isHealthCheck ? "Health check" : "Queued target";
  }

  return status === "active" ? "Processing" : "";
}

function extractTdarrCodec(record = {}, side = "from") {
  const base = record.originalLibraryFile || record.libraryFile || record;
  const source = side === "from" ? record.input || record.source || record.original || base.mediaInfo || base : record.output || record.target || record.result || record.mediaInfo || record;
  return firstDefined(
    source.videoCodec,
    source.video_codec_name,
    source.codec,
    source.container,
    source.format,
    record[side === "from" ? "originalCodec" : "targetCodec"],
    record[side === "from" ? "sourceCodec" : "outputCodec"],
    side === "from" ? record.video_codec_name : record.output_codec_name,
    ""
  );
}

function normalizeTdarrProgress(value) {
  if (typeof value === "string") {
    const text = value.trim();
    const percentMatch = text.match(/^(-?\d+(?:\.\d+)?)\s*%$/);
    if (percentMatch) return Math.max(0, Math.min(100, Number(percentMatch[1])));
    value = text;
  }
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(100, number > 1 ? number : number * 100));
}

function getTdarrExplicitProgress(record = {}) {
  const candidates = [
    record.progress,
    record.progressPercent,
    record.percentageComplete,
    record.percentComplete,
    record.transcodeProgress,
    record.percent,
    record.percentage,
    record.transcodePercent,
    record.TranscodeProgress,
    record.TranscodePercent,
    record.Progress,
    record.Percent,
    record.Percentage,
    record.worker?.progress,
    record.worker?.percent,
    record.worker?.percentage,
    record.job?.progress,
    record.job?.percent,
    record.job?.percentage,
    record.process?.progress,
    record.process?.percent,
    record.process?.percentage,
    record.ffmpeg?.progress,
    record.ffmpeg?.percent,
    record.ffmpeg?.percentage,
    record.workerItem?.progress,
    record.workerItem?.percent,
    record.workerItem?.percentage,
    record.workerItem?.percentageComplete,
    record.processData?.progress,
    record.processData?.percent,
    record.processData?.percentage,
  ];

  const value = candidates.find((candidate) => candidate !== undefined && candidate !== null && candidate !== "");
  const directProgress = value === undefined ? undefined : normalizeTdarrProgress(value);
  if (directProgress > 0) return directProgress;

  const ratioProgress = getTdarrRatioProgress(record);
  if (ratioProgress !== undefined) return ratioProgress;

  const nestedProgress = findTdarrProgressValue(record);
  if (nestedProgress !== undefined) {
    const nestedValue = normalizeTdarrProgress(nestedProgress);
    if (nestedValue > 0 || directProgress === undefined) return nestedValue;
  }
  return directProgress || 0;
}

function getTdarrRatioProgress(record = {}) {
  const pairs = [
    [record.currentFrame, record.totalFrames],
    [record.frames?.current, record.frames?.total],
    [record.frame, record.frames],
    [record.ffmpeg?.out_time_ms, record.ffmpeg?.duration_ms],
    [record.ffmpegData?.out_time_ms, record.ffmpegData?.duration_ms],
    [record.process?.out_time_ms, record.process?.duration_ms],
    [record.currentTime, record.totalTime],
  ];
  for (const [current, total] of pairs) {
    const currentNumber = Number(current);
    const totalNumber = Number(total);
    if (Number.isFinite(currentNumber) && Number.isFinite(totalNumber) && totalNumber > 0) {
      return normalizeTdarrProgress(currentNumber / totalNumber);
    }
  }
  return undefined;
}

function findTdarrProgressValue(value, depth = 0) {
  if (!value || typeof value !== "object" || depth > 4) return undefined;
  for (const [key, nestedValue] of Object.entries(value)) {
    if (/(progress|percent|percentage)/i.test(key)) {
      if (nestedValue !== undefined && nestedValue !== null && nestedValue !== "") return nestedValue;
    }
    const result = findTdarrProgressValue(nestedValue, depth + 1);
    if (result !== undefined) return result;
  }
  return undefined;
}

function looksLikeTdarrSessionId(value) {
  return /^[A-Za-z0-9]{8,12}$/.test(String(value || ""));
}

function tdarrDisplayName(...values) {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const text = value.trim();
    if (!text || text === "[object Object]") continue;
    if (/^(\/|[A-Za-z]:[\\/]|\\\\)/.test(text)) continue;
    if (looksLikeTdarrSessionId(text)) continue;
    return text;
  }
  return "";
}

function getTdarrNodeId(source = {}) {
  if (!source || typeof source !== "object") return looksLikeTdarrSessionId(source) ? String(source) : "";
  const candidates = [
    source.nodeSessionId,
    source.nodeSessionID,
    source.sessionID,
    source.sessionId,
    source.nodeID,
    source.nodeId,
    source.config?.nodeID,
    source.config?.nodeId,
    looksLikeTdarrSessionId(source._id) ? source._id : "",
  ];
  return String(candidates.find((value) => typeof value === "string" && looksLikeTdarrSessionId(value)) || "");
}

function getTdarrNodeDisplayName(source = {}, depth = 0) {
  if (typeof source === "string") return tdarrDisplayName(source);
  if (!source || typeof source !== "object" || depth > 3) return "";
  const skip = /^(workers|Workers|workerList|job|fullWorker|originalLibraryFile|libraryFile|ffProbe|mediainfo|history|logs)$/;
  const direct = tdarrDisplayName(
    source.nodeName,
    source.config?.nodeName,
    source.node?.nodeName,
    typeof source.node === "string" ? source.node : "",
    source.NodeName,
    source.node_name,
    source.hostname,
    source.hostName,
    looksLikeTdarrSessionId(source._id) ? "" : source._id,
    source.workerType || source.file || source.filePath ? "" : source.name
  );
  if (direct) return direct;
  for (const [key, value] of Object.entries(source)) {
    if (skip.test(key)) continue;
    if (/nodename/i.test(key) && typeof value === "string") {
      const name = tdarrDisplayName(value);
      if (name) return name;
    }
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const nested = getTdarrNodeDisplayName(value, depth + 1);
      if (nested) return nested;
    }
  }
  return "";
}

function unwrapTdarrNodesPayload(nodesData) {
  if (!nodesData || typeof nodesData !== "object") return {};
  if (Array.isArray(nodesData)) return nodesData;
  if (nodesData.nodes && typeof nodesData.nodes === "object") return nodesData.nodes;
  if (nodesData.data?.nodes && typeof nodesData.data.nodes === "object") return nodesData.data.nodes;
  if (nodesData.data && typeof nodesData.data === "object" && !nodesData.workers && !nodesData.nodeName) {
    return nodesData.data;
  }
  return nodesData;
}

function isTdarrNodeLike(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Boolean(
    value.workers ||
      value.Workers ||
      value.workerLimits ||
      value.nodeName ||
      value.config?.nodeName ||
      value.nodeSessionId ||
      (value.nodeID && (value.gpuSelect !== undefined || value.queue !== undefined || value.workers))
  );
}

function listTdarrNodes(nodesData) {
  const root = unwrapTdarrNodesPayload(nodesData);
  const nodes = [];
  const add = (value, sessionId = "") => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    const nodeSessionId = looksLikeTdarrSessionId(sessionId) ? sessionId : getTdarrNodeId(value) || sessionId;
    nodes.push({
      ...value,
      nodeSessionId,
      nodeID: value.nodeID || value.nodeId || nodeSessionId,
    });
  };
  if (Array.isArray(root)) {
    root.forEach((value) => add(value, getTdarrNodeId(value)));
    return nodes;
  }
  const childNodes = Object.entries(root || {}).filter(([key, value]) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    return looksLikeTdarrSessionId(key) || isTdarrNodeLike(value) || value.workers || value.Workers;
  });
  if (childNodes.length) {
    childNodes.forEach(([sessionId, value]) => add(value, sessionId));
    return nodes;
  }
  if (isTdarrNodeLike(root)) add(root, getTdarrNodeId(root));
  return nodes;
}

function tdarrNodeRowsFromDb(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.docs)) return data.docs;
  if (Array.isArray(data?.data)) return data.data;
  if (data && typeof data === "object") {
    return Object.entries(data)
      .filter(([, value]) => value && typeof value === "object" && !Array.isArray(value))
      .map(([key, value]) => ({ ...value, _id: value._id || key }));
  }
  return [];
}

function buildTdarrNodeNameIndex(nodesData, nodeDirectory = []) {
  const nameById = new Map();
  const remember = (id, name) => {
    if (!id || !name || looksLikeTdarrSessionId(name)) return;
    nameById.set(String(id), name);
  };
  for (const node of listTdarrNodes(nodesData)) {
    const name = getTdarrNodeDisplayName(node);
    remember(node.nodeSessionId, name);
    remember(node.nodeID, name);
    remember(getTdarrNodeId(node), name);
  }
  for (const row of nodeDirectory) {
    const name = getTdarrNodeDisplayName(row) || tdarrDisplayName(row._id, row.id);
    remember(row.nodeID, name);
    remember(row.nodeId, name);
    remember(row.nodeSessionId, name);
    remember(getTdarrNodeId(row), name);
  }
  const directoryNames = [...new Set(nodeDirectory.map((row) => getTdarrNodeDisplayName(row) || tdarrDisplayName(row._id, row.id)).filter(Boolean))];
  const liveNodes = listTdarrNodes(nodesData);
  if (directoryNames.length === 1) {
    for (const node of liveNodes) {
      remember(node.nodeSessionId, directoryNames[0]);
      remember(node.nodeID, directoryNames[0]);
    }
  }

  return nameById;
}

async function fetchTdarrNodeDirectory(integration) {
  try {
    const data = await fetchTdarrCrudDb(integration, {
      data: {
        collection: "NodeJSONDB",
        mode: "getAll",
      },
    });
    return tdarrNodeRowsFromDb(data);
  } catch (error) {
    console.log("Tdarr node directory load failed:", getAxiosErrorMessage(error));
    return [];
  }
}

async function fetchTdarrGlobalSettings(integration) {
  try {
    return await fetchTdarrCrudDb(integration, {
      data: {
        collection: "SettingsGlobalJSONDB",
        mode: "getById",
        docID: "globalsettings",
      },
    });
  } catch (error) {
    console.log("Tdarr global settings load failed:", getAxiosErrorMessage(error));
    return {};
  }
}

function normalizeTdarrControlNodes(nodesData, nodeDirectory = []) {
  const nameById = buildTdarrNodeNameIndex(nodesData, nodeDirectory);
  return listTdarrNodes(nodesData)
    .map((node) => {
      const id = String(node.nodeSessionId || node.nodeID || getTdarrNodeId(node) || "");
      const name = getTdarrNodeDisplayName(node) || nameById.get(id) || id;
      return {
        id,
        name,
        paused: Boolean(firstDefined(node.nodePaused, node.paused, node.queuePaused, false)),
      };
    })
    .filter((node) => node.id);
}

function clearTdarrTranscodeCache() {
  tdarrTranscodeCache.clear();
}

function postTdarrApi(integration, path, data) {
  const url = cleanIntegrationUrl(integration.values?.url);
  return axios.post(`${url}/api/v2/${path.replace(/^\/+/, "")}`, { data }, {
    timeout: 12000,
    headers: {
      ...getTdarrHeaders(integration),
      "Content-Type": "application/json",
    },
  });
}

async function skipTdarrQueuedFile(integration, fileId, workKind = "") {
  const obj = workKind === "healthcheck" ? { HealthCheck: "Not required" } : { TranscodeDecisionMaker: "Not required" };
  const attempts = [
    () => postTdarrApi(integration, "client/bulk-update-files", { files: [fileId], obj }),
    () => postTdarrApi(integration, "client/bulk-update-files", { files: [{ _id: fileId, file: fileId }], obj }),
    () =>
      fetchTdarrCrudDb(integration, {
        data: {
          collection: "FileJSONDB",
          mode: "update",
          docID: fileId,
          obj,
        },
      }),
  ];

  let lastError;
  for (const attempt of attempts) {
    try {
      await attempt();
      return;
    } catch (error) {
      lastError = error;
      if (error.response?.status && error.response.status >= 500) {
        continue;
      }
    }
  }
  throw lastError || new Error("Unable to skip Tdarr file");
}

async function runTdarrAction(integration, payload = {}) {
  const action = String(payload.action || "").trim().toLowerCase();
  const nodeId = String(payload.nodeId || payload.nodeID || "").trim();
  const workerId = String(payload.workerId || payload.workerID || "").trim();
  const fileId = String(payload.fileId || payload.id || payload.file || "").trim();
  const workKind = String(payload.workKind || "").trim().toLowerCase();

  if (action === "skip" || action === "cancel") {
    if (nodeId && (workerId || fileId)) {
      try {
        await postTdarrApi(integration, "cancel-worker-item", {
          nodeID: nodeId,
          workerID: workerId || fileId,
          cause: "Cancelled from JellyGlance",
        });
        return { ok: true, action: "skip", message: "Tdarr job cancelled." };
      } catch (error) {
        if (!fileId) throw error;
      }
    }
    if (!fileId || /^(active|queued|history)-\d+$/i.test(fileId)) {
      const error = new Error("Missing Tdarr file or worker id");
      error.statusCode = 400;
      throw error;
    }
    await skipTdarrQueuedFile(integration, fileId, workKind);
    return { ok: true, action: "skip", message: "Tdarr job skipped." };
  }

  if (action === "pause" || action === "resume") {
    const paused = action === "pause";
    if (nodeId) {
      await postTdarrApi(integration, "update-node", {
        nodeID: nodeId,
        nodeUpdates: { nodePaused: paused },
      });
      return { ok: true, action, nodeId, message: paused ? "Tdarr node paused." : "Tdarr node resumed." };
    }
    await fetchTdarrCrudDb(integration, {
      data: {
        collection: "SettingsGlobalJSONDB",
        mode: "update",
        docID: "globalsettings",
        obj: { pauseAllNodes: paused },
      },
    });
    return { ok: true, action, message: paused ? "All Tdarr nodes paused." : "All Tdarr nodes resumed." };
  }

  const error = new Error(`Unsupported Tdarr action: ${action}`);
  error.statusCode = 400;
  throw error;
}

function parseTdarrWorkMeta(record = {}) {
  const workerType = String(
    firstDefined(record.workerType, record.worker?.workerType, record.job?.workerType, record.process, record.type, "")
  )
    .toLowerCase()
    .replace(/[\s_-]/g, "");
  let workKind = "";
  let hardware = "";
  if (workerType.includes("health")) workKind = "healthcheck";
  else if (workerType.includes("transcode")) workKind = "transcode";
  if (workerType.includes("gpu")) hardware = "gpu";
  else if (workerType.includes("cpu")) hardware = "cpu";

  if (!workKind) {
    const health = String(firstDefined(record.HealthCheck, record.originalLibraryFile?.HealthCheck, record.libraryFile?.HealthCheck, "")).toLowerCase();
    const transcode = String(firstDefined(record.TranscodeDecisionMaker, record.originalLibraryFile?.TranscodeDecisionMaker, record.libraryFile?.TranscodeDecisionMaker, "")).toLowerCase();
    const healthBusy = /queued|searching|in.?progress|working|hold/.test(health);
    const transcodeBusy = /queued|transcod|searching|in.?progress|working|hold/.test(transcode);
    if (healthBusy && !transcodeBusy) workKind = "healthcheck";
    else if (transcodeBusy) workKind = "transcode";
    else {
      const healthDate = toNumber(record.lastHealthCheckDate || record.originalLibraryFile?.lastHealthCheckDate);
      const transcodeDate = toNumber(record.lastTranscodeDate || record.originalLibraryFile?.lastTranscodeDate);
      if (healthDate && healthDate >= transcodeDate && /success|error|cancel/.test(health)) workKind = "healthcheck";
      else if (transcodeDate || /success|error|cancel|not required/.test(transcode)) workKind = "transcode";
      else if (/success|error|cancel/.test(health)) workKind = "healthcheck";
    }
  }

  const nodeName =
    getTdarrNodeDisplayName(record) ||
    getTdarrNodeDisplayName(record.node) ||
    getTdarrNodeDisplayName(record.config) ||
    getTdarrNodeDisplayName(record.job);

  return {
    nodeName,
    workerType,
    workKind,
    hardware,
  };
}

function normalizeTdarrRecord(record = {}, status = "queued", index = 0) {
  const id = String(firstDefined(record.id, record._id, record.fileId, record.jobId, record.jobID, record.file, record.path, `${status}-${index}`));
  const progress = getTdarrExplicitProgress(record);
  const itemId = firstDefined(record.jellyfinId, record.jellyfinItemId, record.itemId, record.mediaId, record.embyId, record.meta?.Id, record.jellyglanceItemId, "");
  const imageId = firstDefined(record.jellyglanceImageId, itemId);
  const posterId = firstDefined(record.jellyglancePosterId, imageId, itemId);
  const base = record.originalLibraryFile || record.libraryFile || record;
  const sourceCodec = getTdarrFormatLabel(base);
  const workMeta = parseTdarrWorkMeta(record);
  const activeStatus = status === "active" ? firstDefined(record.status, record.handling, record.job?.type) : "";
  const decision = normalizeTdarrDisplayStatus(firstDefined(activeStatus, record.TranscodeDecisionMaker, base.TranscodeDecisionMaker, record.HealthCheck, base.HealthCheck, status));
  const targetLabel = workMeta.workKind === "healthcheck" ? (status === "history" ? "Checked" : "Health check") : getTdarrTargetLabel(record, status);
  const reasonLabel = normalizeTdarrDisplayStatus(firstDefined(record.reason, record.error, record.message, record.pluginName, record.lastPluginDetails, base.lastPluginDetails));
  const oldSizeBytes = tdarrSizeToBytes(firstDefined(record.oldSize, base.oldSize, record.originalSizeGb, base.originalSizeGb));
  const newSizeBytes = tdarrSizeToBytes(firstDefined(record.newSize, base.newSize, record.outputSizeGb, base.outputSizeGb));
  const fileSizeBytes = tdarrSizeToBytes(firstDefined(base.file_size, record.file_size), "mb");
  const sizeBefore = firstDefined(record.sizeBefore, record.originalSize, record.input?.size, oldSizeBytes);
  const sizeAfter = firstDefined(record.outputSize, record.sizeAfter, record.output?.size, newSizeBytes, fileSizeBytes);
  const savedBytes = oldSizeBytes && newSizeBytes ? Math.max(0, oldSizeBytes - newSizeBytes) : 0;
  const savedPercent = oldSizeBytes && savedBytes ? Math.round((savedBytes / oldSizeBytes) * 100) : 0;
  const historyFrom = normalizeTdarrDisplayStatus(firstDefined(record.originalFormat, record.sourceFormat, record.previousFormat, ""));
  const historyTo = sourceCodec || targetLabel;

  const nodeId = String(firstDefined(record.nodeID, record.nodeId, record.nodeSessionId, getTdarrNodeId(record), getTdarrNodeId(record.job), ""));
  const fileId = String(firstDefined(getTdarrRecordPath(record), record._id, record.file, record.fileId, ""));
  const workerId = String(firstDefined(record.workerID, record.workerId, record.workerKey, ""));

  return {
    id,
    fileId,
    nodeId,
    workerId,
    title: extractTdarrTitle(record),
    library: firstDefined(record.libraryName, record.library, base.DB, record.DB?.libraryName, record.meta?.LibraryName, ""),
    worker: workMeta.nodeName || firstDefined(record.workerName, record.workerType, ""),
    nodeName: workMeta.nodeName,
    workKind: workMeta.workKind,
    hardware: workMeta.hardware,
    workerType: workMeta.workerType,
    status: decision || status,
    from: status === "history" ? firstDefined(historyFrom, "Previous version") : firstDefined(sourceCodec, extractTdarrCodec(record, "from"), "Source"),
    to: status === "history" ? firstDefined(historyTo, targetLabel, "After") : targetLabel,
    progress,
    sizeBefore,
    sizeAfter,
    savedBytes,
    savedPercent,
    updatedAt: firstDefined(record.updatedAt, record.lastUpdated, record.date, record.time, record.finishedAt, record.createdAt, base.lastTranscodeDate, base.lastHealthCheckDate, ""),
    reason: reasonLabel,
    itemId,
    imageId,
    bannerUrl: imageId ? `/proxy/Items/Images/Backdrop?id=${encodeURIComponent(imageId)}&fillWidth=1200&quality=64` : "",
    thumbnailUrl: posterId ? `/proxy/Items/Images/Primary?id=${encodeURIComponent(posterId)}&fillWidth=480&fillHeight=720&quality=96` : "",
  };
}

function getTdarrRecordPath(record = {}) {
  return firstDefined(
    record.filename,
    record.fileName,
    record.filePath,
    record.file,
    record.path,
    record.originalPath,
    record.inputFile,
    record.job?.filePath,
    record.job?.file,
    record.job?.path,
    record.job?.inputFile,
    record.fileDetails?.filePath,
    record.fileDetails?.file,
    record.fileDetails?.path,
    record.originalLibraryFile?.filePath,
    record.originalLibraryFile?.file,
    record.originalLibraryFile?.path,
    record.libraryFile?.filePath,
    record.libraryFile?.file,
    record.libraryFile?.path,
    record._id,
    ""
  );
}

function getTdarrPathSuffix(pathValue = "") {
  const parts = String(pathValue).split(/[\\/]+/).filter(Boolean);
  if (parts.length <= 3) return parts.join("/");
  return parts.slice(-4).join("/");
}

function getTdarrEpisodeKey(pathValue = "") {
  const text = String(pathValue);
  const episodeMatch = text.match(/S(\d{1,2})E(\d{1,3})/i);
  if (!episodeMatch) return null;
  const parts = text.split(/[\\/]+/).filter(Boolean);
  const seriesFolder = parts.find((part) => /\(\d{4}\)/.test(part)) || parts[Math.max(0, parts.length - 3)] || "";
  return {
    series: seriesFolder.toLowerCase(),
    episode: `s${episodeMatch[1].padStart(2, "0")}e${episodeMatch[2].padStart(2, "0")}`,
  };
}

async function attachJellyfinIdsToTdarrRecords(records = []) {
  const recordsToMatch = records.slice(0, 40);
  const paths = [...new Set(recordsToMatch.map(getTdarrRecordPath).filter(Boolean))];
  if (!paths.length) return records;

  try {
    const suffixes = [...new Set(paths.map(getTdarrPathSuffix).filter(Boolean))];
    const episodeKeys = new Map(paths.map((pathValue) => [pathValue, getTdarrEpisodeKey(pathValue)]).filter(([, key]) => key));
    const episodeSeriesPatterns = [...new Set([...episodeKeys.values()].map((key) => `%${key.series}%`))];
    const episodePatterns = [...new Set([...episodeKeys.values()].map((key) => key.episode.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))];
    const { rows } = await db.query(
      `
        SELECT "Id", "Path", "Name"
        FROM jf_item_info
        WHERE "Path" = ANY($1)
           OR "Path" LIKE ANY($2)
           OR ("Path" ILIKE ANY($3) AND "Path" ~* ANY($4))
      `,
      [paths, suffixes.map((suffix) => `%${suffix}`), episodeSeriesPatterns.length ? episodeSeriesPatterns : ["__jg_no_series_match__"], episodePatterns.length ? episodePatterns : ["__jg_no_episode_match__"]]
    );
    const idByPath = new Map(rows.map((row) => [row.Path, row.Id]));
    const idBySuffix = new Map(rows.map((row) => [getTdarrPathSuffix(row.Path), row.Id]));
    const idByEpisode = new Map(
      rows
        .map((row) => {
          const key = getTdarrEpisodeKey(row.Path || row.Name);
          return key ? [`${key.series}::${key.episode}`, row.Id] : null;
        })
        .filter(Boolean)
    );
    const matchedItemIds = [...new Set(
      records
        .map((record) => {
          const pathValue = getTdarrRecordPath(record);
          const episodeKey = episodeKeys.get(pathValue);
          return (
            idByPath.get(pathValue) ||
            idBySuffix.get(getTdarrPathSuffix(pathValue)) ||
            (episodeKey ? idByEpisode.get(`${episodeKey.series}::${episodeKey.episode}`) : null)
          );
        })
        .filter(Boolean)
    )];
    const imageIdByItemId = new Map();
    const posterIdByItemId = new Map();
    if (matchedItemIds.length) {
      const episodeRows = await db.query(
        'SELECT "EpisodeId", "SeriesId", "ParentBackdropItemId" FROM jf_library_episodes WHERE "EpisodeId" = ANY($1)',
        [matchedItemIds]
      );
      episodeRows.rows.forEach((row) => {
        imageIdByItemId.set(row.EpisodeId, row.ParentBackdropItemId || row.SeriesId);
        posterIdByItemId.set(row.EpisodeId, row.SeriesId);
      });
    }

    return records.map((record) => {
      const pathValue = getTdarrRecordPath(record);
      const episodeKey = episodeKeys.get(pathValue);
      const itemId =
        idByPath.get(pathValue) ||
        idBySuffix.get(getTdarrPathSuffix(pathValue)) ||
        (episodeKey ? idByEpisode.get(`${episodeKey.series}::${episodeKey.episode}`) : null);
      return itemId
        ? {
            ...record,
            jellyglanceItemId: itemId,
            jellyglanceImageId: imageIdByItemId.get(itemId) || itemId,
            jellyglancePosterId: posterIdByItemId.get(itemId) || itemId,
          }
        : record;
    });
  } catch (error) {
    console.log("Tdarr Jellyfin path lookup failed:", error.message);
    return records;
  }
}

function normalizeTdarrStatistics(statistics = {}) {
  const table1 = toNumber(statistics.table1ViewableCount ?? statistics.table1Count);
  const table2 = toNumber(statistics.table2ViewableCount ?? statistics.table2Count);
  const table3 = toNumber(statistics.table3ViewableCount ?? statistics.table3Count);
  const table4 = toNumber(statistics.table4ViewableCount ?? statistics.table4Count);
  const table5 = toNumber(statistics.table5ViewableCount ?? statistics.table5Count);
  const table6 = toNumber(statistics.table6ViewableCount ?? statistics.table6Count);
  return {
    transcodeQueue: table1,
    transcodeProcessed: table2,
    transcodeErrored: table3,
    healthQueue: table4,
    healthProcessed: table5,
    healthErrored: table6,
    queue: table1 + table4,
    processed: table2 + table5,
    errored: table3 + table6,
    saved: toNumber(statistics.sizeDiff) * 1000000000,
  };
}

function looksLikeTdarrActiveRecord(record = {}) {
  const text = [
    record.status,
    record.state,
    record.stage,
    record.type,
    record.workerType,
    record.process,
    record.file,
    record.filePath,
    record.originalPath,
    record.healthCheck,
    record.transcode,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return /transcod|health|worker|process|ffmpeg|handbrake|active|running|current|file/.test(text);
}

function isTdarrQueuedFile(file = {}) {
  return [file.TranscodeDecisionMaker, file.HealthCheck].some((value) => String(value || "").toLowerCase() === "queued");
}

function isTdarrHistoryFile(file = {}) {
  return [file.TranscodeDecisionMaker, file.HealthCheck].some((value) => /success|error|cancel|not required|complete/i.test(String(value || "")));
}

function sortTdarrFilesByDate(files = []) {
  return [...files].sort((first, second) => {
    const firstDate = toNumber(first.lastTranscodeDate || first.lastHealthCheckDate || first.createdAt);
    const secondDate = toNumber(second.lastTranscodeDate || second.lastHealthCheckDate || second.createdAt);
    return secondDate - firstDate;
  });
}

function uniqueTdarrRows(rows = []) {
  const seen = new Set();
  return asArray(rows).filter((record) => {
    if (!record || typeof record !== "object") return false;
    const key = String(
      firstDefined(
        record._id,
        record.id,
        record.file,
        record.fileId,
        record.filePath,
        record.path,
        record.originalPath,
        JSON.stringify(record).slice(0, 160)
      )
    );
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function extractTdarrActiveRows(root = {}) {
  const namedRows = flattenRecordCollections(root, [
    "active",
    "activeTranscodes",
    "activeWorkers",
    "workers",
    "currentTranscodes",
    "running",
    "inProgress",
    "transcodeWorkers",
    "nodeStatus",
    "nodes",
  ]);
  const recursiveRows = recursivelyFindArrays(root, looksLikeTdarrActiveRecord, 4);
  const rows = [...namedRows, ...recursiveRows].filter((record) => record && typeof record === "object" && looksLikeTdarrActiveRecord(record));
  const seen = new Set();
  return rows.filter((record) => {
    const key = String(firstDefined(record.id, record._id, record.file, record.filePath, record.workerName, record.nodeName, JSON.stringify(record).slice(0, 160)));
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeTdarrBundle(data = {}, statistics = {}, stagedRows = [], fileRows = [], queuedRows = [], historyRows = []) {
  const root = data.data && typeof data.data === "object" ? data.data : data;
  const queuedNames = ["queued", "queue", "transcodeQueue", "transcodeQueueItems", "staged", "pending", "waiting"];
  const historyNames = ["history", "recent", "recentlyFinished", "finished", "success", "completed", "transcodeHistory"];
  const normalizedStats = normalizeTdarrStatistics(statistics);
  const staged = Array.isArray(stagedRows) ? stagedRows : [];
  const files = Array.isArray(fileRows) ? fileRows : [];
  const explicitQueued = uniqueTdarrRows(queuedRows).slice(0, 80);
  const explicitHistory = sortTdarrFilesByDate(uniqueTdarrRows(historyRows)).slice(0, 80);
  const activeSource = staged.length ? staged : extractTdarrActiveRows(root);
  const queuedSource = explicitQueued.length
    ? explicitQueued
    : files.length
      ? files.filter(isTdarrQueuedFile).slice(0, 80)
      : flattenRecordCollections(root, queuedNames);
  const historySource = explicitHistory.length
    ? explicitHistory
    : files.length
      ? sortTdarrFilesByDate(files.filter(isTdarrHistoryFile)).slice(0, 80)
      : flattenRecordCollections(root, historyNames);
  const active = activeSource.map((record, index) => normalizeTdarrRecord(record, "active", index));
  const queued = queuedSource.map((record, index) => normalizeTdarrRecord(record, "queued", index));
  const history = historySource.map((record, index) => normalizeTdarrRecord(record, "history", index));

  return {
    source: {
      name: "Tdarr",
      version: extractIntegrationVersion(data) || root.serverVersion || root.tdarrVersion || "",
    },
    active,
    queued,
    history,
    stats: {
      active: staged.length || getTdarrActiveCount(active, root),
      queued: normalizedStats.queue || queued.length || toNumber(root.totalQueued || root.queueCount || root.transcodeQueueCount),
      queue: normalizedStats.queue || queued.length || toNumber(root.totalQueued || root.queueCount || root.transcodeQueueCount),
      processed: normalizedStats.processed,
      errored: normalizedStats.errored,
      saved: normalizedStats.saved,
      transcodeQueue: normalizedStats.transcodeQueue,
      healthQueue: normalizedStats.healthQueue,
      history: history.length || normalizedStats.processed + normalizedStats.errored,
      nodes: asArray(root.nodes || root.nodeStatus || root.clients).length,
    },
    raw: root,
    statistics,
    syncedAt: new Date().toISOString(),
  };
}

function getTdarrActiveCount(active = [], data = {}) {
  const explicit = firstDefined(data.activeCount, data.activeTranscodeCount, data.transcodeCount, data.stats?.active, data.workerStats?.active);
  const number = Number(explicit);
  return Number.isFinite(number) ? number : active.length;
}

async function getConnectedTdarrIntegration() {
  const integrations = await getIntegrations();
  return [...(integrations.thirdParty || []), ...(integrations.arrApps || [])].find(
    (integration) => isTdarrIntegration(integration) && cleanIntegrationUrl(integration.values?.url)
  );
}

async function fetchTdarrCrudDb(integration, payload) {
  const url = cleanIntegrationUrl(integration.values?.url);
  const response = await safeHttpPost(url, "/api/v2/cruddb", payload, {
    timeout: 12000,
    headers: {
      ...getTdarrHeaders(integration),
      "Content-Type": "application/json",
    },
  });
  return response.data || {};
}

async function fetchTdarrStatistics(integration) {
  try {
    return await fetchTdarrCrudDb(integration, {
      data: {
        collection: "StatisticsJSONDB",
        mode: "getById",
        docID: "statistics",
      },
    });
  } catch (error) {
    console.log("Tdarr statistics load failed:", getAxiosErrorMessage(error));
    return {};
  }
}

// eslint-disable-next-line no-unused-vars -- existing code, kept unchanged
async function fetchTdarrCollection(integration, collection) {
  try {
    const data = await fetchTdarrCrudDb(integration, {
      data: {
        collection,
        mode: "getAll",
      },
    });
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.docs)) return data.docs;
    if (Array.isArray(data?.data)) return data.data;
    if (Array.isArray(data?.records)) return data.records;
    if (Array.isArray(data?.rows)) return data.rows;
    if (data && typeof data === "object") {
      const objectRows = Object.values(data).filter((item) => item && typeof item === "object" && !Array.isArray(item));
      return objectRows.length ? objectRows : [];
    }
    return [];
  } catch (error) {
    console.log(`Tdarr ${collection} load failed:`, getAxiosErrorMessage(error));
    return [];
  }
}

async function fetchTdarrClientRows(integration, clientType, { start = 0, pageSize = 40, filters = [], sorts = [], table = clientType } = {}) {
  try {
    const url = cleanIntegrationUrl(integration.values?.url);
    const response = await axios.post(
      `${url}/api/v2/client/${encodeURIComponent(clientType)}`,
      {
        data: {
          start,
          pageSize,
          filters,
          sorts,
          opts: { table },
        },
      },
      {
        timeout: 12000,
        headers: {
          ...getTdarrHeaders(integration),
          "Content-Type": "application/json",
        },
      }
    );
    return Array.isArray(response.data?.array) ? response.data.array : [];
  } catch (error) {
    console.log(`Tdarr client ${clientType} load failed:`, getAxiosErrorMessage(error));
    return [];
  }
}

async function fetchTdarrJobReports(integration, searchTerms) {
  const terms = String(searchTerms || "").trim();
  if (!terms) return [];

  try {
    const url = cleanIntegrationUrl(integration.values?.url);
    const response = await axios.post(
      `${url}/api/v2/search-job-reports`,
      { data: { searchTerms: terms } },
      {
        timeout: 12000,
        headers: {
          ...getTdarrHeaders(integration),
          "Content-Type": "application/json",
        },
      }
    );
    return Array.isArray(response.data?.jobReports) ? response.data.jobReports : [];
  } catch (error) {
    console.log("Tdarr job report search failed:", getAxiosErrorMessage(error));
    return [];
  }
}

// eslint-disable-next-line no-unused-vars -- existing code, kept unchanged
async function enrichTdarrHistoryRows(integration, rows = []) {
  const reportCache = new Map();
  const sourceRows = uniqueTdarrRows(rows);
  const rowsToEnrich = sourceRows.slice(0, 12);
  const enriched = await Promise.all(
    rowsToEnrich.map(async (record) => {
      const path = String(getTdarrRecordPath(record) || "");
      const searchTerms = path.split(/[\\/]/).pop() || "";
      if (!searchTerms) return record;

      if (!reportCache.has(searchTerms)) {
        reportCache.set(searchTerms, fetchTdarrJobReports(integration, searchTerms));
      }
      const reports = await reportCache.get(searchTerms);
      const report = reports[0];
      if (!report) return record;

      return {
        ...record,
        ...(report.jobRecord && typeof report.jobRecord === "object" ? report.jobRecord : {}),
        filename: report.filename || record.filename,
        lastModifiedMs: report.lastModifiedMs || record.lastModifiedMs,
        jobReport: report,
      };
    })
  );
  return [...enriched, ...sourceRows.slice(12)];
}

// Build a map from staged-file ID to live worker progress pulled from /api/v2/get-nodes.
function mergeNodeProgressIntoStaged(staged, nodesData) {
  if (!nodesData || typeof nodesData !== "object" || !staged.length) return staged;

  const progressByFileId = new Map();
  const workers = [];
  function collectWorkers(value, depth = 0) {
    if (!value || typeof value !== "object" || depth > 6) return;
    if (Array.isArray(value)) {
      value.forEach((item) => collectWorkers(item, depth + 1));
      return;
    }
    const progress = value.percentage ?? value.transcodePercent ?? value.TranscodePercent ?? value.Progress ?? value.progress ?? value.percent;
    const fileId = value.file || value.fileId || value.filePath || value.path || value._id || value.workerItemId;
    if (fileId != null && progress != null) workers.push({ fileId: String(fileId), progress });
    Object.values(value).forEach((child) => collectWorkers(child, depth + 1));
  }
  collectWorkers(nodesData);

  for (const worker of workers) {
    const num = Number(String(worker.progress).replace(/%/, ""));
    if (Number.isFinite(num)) {
      progressByFileId.set(worker.fileId, num);
    }
  }

  if (!progressByFileId.size) return staged;

  return staged.map((record) => {
    const ids = [record._id, record.id, record.fileId, record.file, record.filePath, record.path].filter(Boolean).map(String);
    for (const id of ids) {
      if (progressByFileId.has(id)) {
        return { ...record, progress: progressByFileId.get(id) };
      }
    }
    const suffixes = ids.map((id) => id.split(/[\\/]+/).slice(-2).join("/"));
    const matchingWorker = workers.find((worker) => suffixes.includes(worker.fileId.split(/[\\/]+/).slice(-2).join("/")));
    if (matchingWorker) return { ...record, progress: matchingWorker.progress };
    return record;
  });
}

function extractTdarrWorkersFromNodes(nodesData, nodeDirectory = []) {
  if (!nodesData || typeof nodesData !== "object") return [];
  const workers = [];
  const nodes = listTdarrNodes(nodesData);
  const nameById = buildTdarrNodeNameIndex(nodesData, nodeDirectory);

  function resolveNodeName(node, worker) {
    const ids = [
      node?.nodeSessionId,
      node?.nodeID,
      getTdarrNodeId(node),
      getTdarrNodeId(worker),
      getTdarrNodeId(worker?.job),
      worker?.nodeID,
      worker?.nodeId,
    ].filter(Boolean).map(String);
    return (
      getTdarrNodeDisplayName(node) ||
      getTdarrNodeDisplayName(worker) ||
      ids.map((id) => nameById.get(id)).find(Boolean) ||
      ""
    );
  }

  function pushWorker(worker, node, workerKey = "") {
    if (!worker || typeof worker !== "object") return;
    const file = worker.file || worker.fileId || worker.filePath || worker.path || worker.originalfile || worker.originalFile || worker.source || worker.sourceFile || worker.job?.file || worker.job?.filePath || worker.job?._id;
    const progress = worker.percentage ?? worker.transcodePercent ?? worker.TranscodePercent ?? worker.Progress ?? worker.progress ?? worker.percent;
    const workerType = worker.workerType || worker.type || worker.job?.workerType || "";
    if (!file || (progress == null && !worker.status && !worker.job && !workerType)) return;
    const nodeId = node?.nodeSessionId || getTdarrNodeId(node) || getTdarrNodeId(worker) || getTdarrNodeId(worker.job);
    workers.push({
      ...worker,
      file,
      nodeName: resolveNodeName(node, worker),
      nodeID: nodeId,
      nodeSessionId: nodeId,
      workerType,
      workerID: firstDefined(worker.workerID, worker.workerId, worker.id, workerKey),
      workerKey,
    });
  }

  function walkWorkers(value, node, depth = 0, workerKey = "") {
    if (!value || typeof value !== "object" || depth > 5) return;
    if (Array.isArray(value)) {
      value.forEach((item, index) => walkWorkers(item, node, depth + 1, workerKey || String(index)));
      return;
    }
    pushWorker(value, node, workerKey);
    ["fullWorker", "workerItem", "current", "job"].forEach((key) => {
      if (value[key] && typeof value[key] === "object" && !Array.isArray(value[key])) {
        walkWorkers(value[key], node, depth + 1, workerKey || key);
      }
    });
    const looksLikeBucket = !value.workerType && !value.file && !value.filePath && progressIsMissing(value);
    if (looksLikeBucket || value.workers || value.Workers) {
      Object.entries(value).forEach(([key, child]) => {
        if (child && typeof child === "object") walkWorkers(child, node, depth + 1, key);
      });
    }
  }

  function progressIsMissing(value) {
    return value.percentage == null && value.progress == null && value.percent == null;
  }

  for (const node of nodes) {
    const workerRoots = [node.workers, node.Workers, node.workerList, typeof node.queue === "object" ? node.queue : null].filter(Boolean);
    if (workerRoots.length) {
      workerRoots.forEach((root) => {
        if (Array.isArray(root)) {
          root.forEach((item, index) => walkWorkers(item, node, 0, String(index)));
          return;
        }
        Object.entries(root).forEach(([key, value]) => {
          if (value && typeof value === "object") walkWorkers(value, node, 0, key);
        });
      });
      continue;
    }
    Object.entries(node).forEach(([key, value]) => {
      if (/^(nodeName|nodeID|nodeId|nodeSessionId|config|_id)$/.test(key)) return;
      if (value && typeof value === "object") walkWorkers(value, node, 0, key);
    });
  }

  if (!workers.length) {
    function walk(value, depth = 0, node = null) {
      if (!value || typeof value !== "object" || depth > 6) return;
      if (Array.isArray(value)) {
        value.forEach((item) => walk(item, depth + 1, node));
        return;
      }
      const nextNode = isTdarrNodeLike(value) ? value : node;
      if (value.workers || value.Workers) {
        Object.entries(value.workers || value.Workers).forEach(([key, child]) => {
          if (child && typeof child === "object") walkWorkers(child, nextNode, 0, key);
        });
      }
      const progress = value.percentage ?? value.transcodePercent ?? value.TranscodePercent ?? value.Progress ?? value.progress ?? value.percent;
      const file = value.file || value.fileId || value.filePath || value.path || value.source || value.sourceFile;
      if (file != null && progress != null) pushWorker(value, nextNode, value.workerID || value.workerId || value.id);
      Object.values(value).forEach((child) => walk(child, depth + 1, nextNode));
    }
    walk(unwrapTdarrNodesPayload(nodesData));
  }

  return uniqueTdarrRows(workers).slice(0, 40);
}

async function fetchTdarrBundle(integration, { activeOnly = false } = {}) {
  const url = cleanIntegrationUrl(integration.values?.url);
  const [statusResponse, statistics, queuedSearchRows, healthQueuedRows, historySuccessRows, historyErrorRows, nodesData, nodeDirectory, globalSettings] = await Promise.all([
    axios
      .get(`${url}/api/v2/status`, {
        timeout: 8000,
        headers: getTdarrHeaders(integration),
      })
      .catch((error) => {
        console.log("Tdarr status load failed:", getAxiosErrorMessage(error));
        return { data: {} };
      }),
    fetchTdarrStatistics(integration),
    activeOnly ? Promise.resolve([]) : fetchTdarrClientRows(integration, "search", { pageSize: 40, table: "search", filters: [{ id: "TranscodeDecisionMaker", value: "Queued" }] }),
    activeOnly ? Promise.resolve([]) : fetchTdarrClientRows(integration, "search", { pageSize: 40, table: "search", filters: [{ id: "HealthCheck", value: "Queued" }] }),
    activeOnly
      ? Promise.resolve([])
      : fetchTdarrClientRows(integration, "search", { pageSize: 40, table: "search", filters: [{ id: "TranscodeDecisionMaker", value: "success" }], sorts: [{ id: "lastTranscodeDate", desc: true }] }),
    activeOnly
      ? Promise.resolve([])
      : fetchTdarrClientRows(integration, "search", { pageSize: 40, table: "search", filters: [{ id: "TranscodeDecisionMaker", value: "error" }], sorts: [{ id: "lastTranscodeDate", desc: true }] }),
    axios
      .get(`${url}/api/v2/get-nodes`, {
        timeout: 8000,
        headers: getTdarrHeaders(integration),
      })
      .then((response) => response.data || {})
      .catch(() => ({})),
    fetchTdarrNodeDirectory(integration),
    fetchTdarrGlobalSettings(integration),
  ]);

  const workerRows = extractTdarrWorkersFromNodes(nodesData, nodeDirectory);
  const stagedWithProgress = mergeNodeProgressIntoStaged(workerRows, nodesData);
  const queuedFiles = uniqueTdarrRows([...queuedSearchRows, ...healthQueuedRows]).slice(0, 40);
  const historyFiles = sortTdarrFilesByDate(uniqueTdarrRows([...historySuccessRows, ...historyErrorRows])).slice(0, 40);
  const [activeWithImages, queuedWithImages, historyWithImages] = await Promise.all([
    attachJellyfinIdsToTdarrRecords(stagedWithProgress),
    activeOnly ? Promise.resolve([]) : attachJellyfinIdsToTdarrRecords(queuedFiles),
    activeOnly ? Promise.resolve([]) : attachJellyfinIdsToTdarrRecords(historyFiles),
  ]);
  const bundle = normalizeTdarrBundle(statusResponse.data || {}, statistics, activeWithImages, [], queuedWithImages, historyWithImages);
  const nodes = normalizeTdarrControlNodes(nodesData, nodeDirectory);
  return {
    ...bundle,
    connected: true,
    nodes,
    pauseAll: Boolean(globalSettings?.pauseAllNodes),
    source: {
      ...bundle.source,
      name: integration.name || "Tdarr",
      url,
      instanceId: integration.instanceId,
    },
  };
}

function normalizeWizarrInvite(invitation, sourceUrl) {
  const code = invitation.code || invitation.token || invitation.invite_code || "";
  const rawUrl = invitation.url || invitation.invite_url || invitation.link || (code ? `/j/${encodeURIComponent(code)}` : "");
  const url = normalizeWizarrInviteUrl(rawUrl, sourceUrl);
  const usedBy = normalizeWizarrUsedBy(invitation.used_by || invitation.usedBy || invitation.user || invitation.used_by_user || "");
  return {
    id: invitation.id,
    code,
    url,
    status: invitation.status || (invitation.used_at || invitation.used ? "used" : "pending"),
    created: invitation.created || invitation.created_at || null,
    expires: invitation.expires || invitation.expires_at || null,
    usedAt: invitation.used_at || null,
    usedBy,
    duration: invitation.duration || (invitation.unlimited ? "unlimited" : ""),
    unlimited: invitation.unlimited !== false,
    libraries: invitation.specific_libraries || invitation.library_ids || [],
    displayName: invitation.display_name || "",
    serverNames: invitation.server_names || [],
  };
}

function normalizeWizarrInviteUrl(value, sourceUrl) {
  if (!value) return "";
  const baseUrl = cleanIntegrationUrl(sourceUrl);
  const text = String(value).trim();
  if (/^https?:\/\//i.test(text)) return text;
  if (!baseUrl) return text;

  try {
    return new URL(text.startsWith("/") ? text : `/${text}`, `${baseUrl}/`).toString();
  } catch {
    return `${baseUrl}/${text.replace(/^\/+/, "")}`;
  }
}

function normalizeWizarrUsedBy(value) {
  if (!value) return "";
  if (typeof value === "object") {
    return value.username || value.name || value.display_name || value.email || "";
  }
  const text = String(value).trim();
  if (/^<User\s+\d+>$/.test(text)) return "";
  return text;
}

function escapeWizarrHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function buildWizarrInviteEmail(invite, integration) {
  const sourceName = integration.name || "Wizarr";
  const inviteUrl = invite.url || "";
  const code = invite.code || invite.id || "Invite";
  const subject = `Your ${sourceName} invite is ready`;
  const text = [
    `Your ${sourceName} invite is ready.`,
    "",
    inviteUrl ? `Open invite: ${inviteUrl}` : `Invite code: ${code}`,
    "",
    "This invite was sent from JellyGlance.",
  ].join("\n");
  const html = `
    <!doctype html>
    <html>
      <body style="margin:0;background:#090d13;color:#edf2f7;font-family:Arial,Helvetica,sans-serif;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#090d13;">
          <tr>
            <td align="center" style="padding:28px 12px;">
              <table role="presentation" width="620" cellspacing="0" cellpadding="0" style="width:100%;max-width:620px;">
                <tr>
                  <td style="border-radius:20px;overflow:hidden;background:#101722;border:1px solid #26364a;">
                    <div style="background:linear-gradient(135deg,#111827 0%,#132436 52%,#351b44 100%);padding:28px;">
                      <div style="color:#9ee8ff;font-size:12px;font-weight:900;text-transform:uppercase;">JellyGlance Invite</div>
                      <h1 style="margin:8px 0 10px;color:#ffffff;font-size:32px;line-height:1.05;">Your server invite is ready</h1>
                      <p style="margin:0;color:#c7d4e6;font-size:14px;line-height:1.5;">Use the link below to accept your ${escapeWizarrHtml(sourceName)} invitation.</p>
                    </div>
                    <div style="padding:26px;background:#101722;">
                      ${
                        inviteUrl
                          ? `<a href="${escapeWizarrHtml(inviteUrl)}" style="display:block;background:#8b5cf6;color:#ffffff;text-decoration:none;text-align:center;border-radius:12px;padding:14px 18px;font-size:16px;font-weight:900;">Open invite</a>
                             <p style="margin:16px 0 0;color:#8fa3bd;font-size:12px;line-height:1.5;word-break:break-all;">${escapeWizarrHtml(inviteUrl)}</p>`
                          : `<p style="margin:0;color:#ffffff;font-size:18px;font-weight:900;">Invite code: ${escapeWizarrHtml(code)}</p>`
                      }
                    </div>
                  </td>
                </tr>
                <tr>
                  <td align="center" style="padding:16px;color:#72839a;font-size:12px;">Sent by JellyGlance</td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
  `;

  return { subject, text, html };
}

function normalizeWizarrServer(server) {
  return {
    id: server.id,
    name: server.name || "Unnamed server",
    type: server.server_type || server.type || "",
    verified: server.verified !== false,
    allowDownloads: Boolean(server.allow_downloads),
    allowLiveTv: Boolean(server.allow_live_tv),
    allowMobileUploads: Boolean(server.allow_mobile_uploads),
  };
}

function normalizeWizarrLibrary(library) {
  return {
    id: library.id,
    name: library.name || "Unnamed library",
    externalId: library.external_id || "",
    serverId: library.server_id,
    serverName: library.server_name || "",
    enabled: library.enabled !== false,
  };
}

function getMaintainerrStatusValue(raw = {}) {
  const candidate = String(firstDefined(raw?.status, raw?.State, raw?.state, raw?.result, raw?.message, "") || "").toLowerCase();
  if (!candidate) return null;
  if (["ok", "healthy", "up", "true", "connected", "ready"].includes(candidate)) return true;
  if (["degraded", "error", "down", "unavailable", "false", "failed"].includes(candidate)) return false;
  return null;
}

function getMaintainerrHealthStatus(health) {
  const raw = health || {};
  const values = [raw?.status, raw?.State, raw?.state, raw?.result, raw?.resultCode, raw?.message, raw?.details?.status, raw?.details?.state]
    .map((item) => firstDefined(item))
    .filter(Boolean)
    .map((item) => String(item).toLowerCase());
  if (!values.length) return Boolean(raw?.ok) && raw !== undefined;
  if (values.some((value) => ["error", "failed", "degraded", "unhealthy", "down", "not ready", "unavailable"].includes(value))) return false;
  if (values.some((value) => ["ok", "healthy", "ready", "up", "alive", "connected"].includes(value))) return true;
  return Boolean(raw?.ok);
}

function toMaintainerrNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toMaintainerrTimestamp(value) {
  const date = new Date(firstDefined(value, ""));
  return Number.isFinite(date.getTime()) ? date.toISOString() : "";
}

function parseMaintainerrDueSeconds(value, fallback = 0) {
  const scheduledAt = firstDefined(value?.scheduledFor, value?.runAt, value?.executeAt, value?.nextRunAt, value?.applyAt, value?.timestamp, value?.when);
  const date = scheduledAt ? new Date(scheduledAt) : null;
  if (!date || !Number.isFinite(date.getTime())) return fallback;
  return Math.max(0, Math.floor((date.getTime() - Date.now()) / 1000));
}

function normalizeMaintainerrCollection(collection = {}, index = 0) {
  const id = firstDefined(collection?.id, collection?.collectionId, collection?._id, index);
  const reclaimable = toMaintainerrNumber(
    firstDefined(
      collection?.reclaimable_bytes,
      collection?.reclaimableBytes,
      collection?.reclaimable_size,
      collection?.bytesToReclaim,
      collection?.totalReclaimable,
      0
    ),
    0
  );
  return {
    id: `${id || index + 1}`,
    name: collection?.name || collection?.title || collection?.collectionName || `Collection ${id || index + 1}`,
    enabled: collection?.enabled !== false,
    itemCount: toMaintainerrNumber(collection?.items || collection?.itemCount || collection?.pending || collection?.pendingItems, 0),
    reclaimableBytes: reclaimable,
    nextRunAt: toMaintainerrTimestamp(collection?.nextRunAt || collection?.nextRun || collection?.nextRunDate),
    lastRunAt: toMaintainerrTimestamp(collection?.lastRunAt || collection?.lastRun || collection?.lastRunDate),
    status: collection?.status || collection?.state || "unknown",
    rule: firstDefined(collection?.rule, collection?.rules?.[0], collection?.automationRule, "default"),
  };
}

function normalizeMaintainerrItem(item = {}, index = 0) {
  const action = firstDefined(item?.action, item?.pendingAction, item?.nextAction, item?.operation, item?.statusAction, "cleanup");
  const id = firstDefined(item?.id, item?.itemId, item?.mediaId, item?.mediaItemId, item?._id, index);
  const dueInSeconds = parseMaintainerrDueSeconds(item, 0);
  return {
    id: `${id || index + 1}`,
    mediaId: firstDefined(item?.mediaId, item?.tmdbId, item?.jellyfinItemId, item?.itemId, id),
    title: item?.title || item?.name || item?.mediaTitle || item?.filename || item?.path || "Unknown media",
    collection: firstDefined(item?.collection, item?.collectionName, item?.collection_id, ""),
    collectionId: firstDefined(item?.collectionId, item?.collection_id, item?.collectionUuid, ""),
    action,
    dueAt: toMaintainerrTimestamp(item?.scheduledFor || item?.runAt || item?.executeAt || item?.nextRunAt),
    dueInSeconds,
    isExclusion: Boolean(item?.excluded || item?.isExcluded || item?.manualRetention || item?.keepForever),
    storageBytes: toMaintainerrNumber(item?.size || item?.sizeBytes || item?.bytes || item?.fileSize, 0),
    status: item?.status || item?.state || "scheduled",
  };
}

function extractMaintainerrArray(root, keys = []) {
  const direct = pickArray(root, keys);
  if (direct.length) return direct;
  const nested = flattenRecordCollections(root, keys);
  if (nested.length) return nested;
  return recursivelyFindArrays(root, (item) =>
    Boolean(
      item &&
        (item.title || item.name || item.mediaId || item.itemId || item.id || item.media || item.collection || item.collectionId || item.action || item.actionName)
    )
  );
}

function normalizeMaintainerrBundle(raw = {}) {
  const collections = extractMaintainerrArray(raw, ["collections", "activeCollections", "collectionStats"])
    .map((collection, index) => normalizeMaintainerrCollection(collection, index))
    .filter((collection) => collection.name || collection.itemCount || collection.id)
    .slice(0, 50);
  const allItems = extractMaintainerrArray(raw, ["items", "media", "queue", "pending", "schedules", "schedule", "actions", "records"])
    .map((item, index) => normalizeMaintainerrItem(item, index))
    .filter((item) => item.id || item.mediaId || item.title)
    .slice(0, 250);

  const storage = raw?.storage || raw?.storageMetrics || {};
  const excludedItems = allItems.filter((item) => item.isExclusion);
  const scheduledItems = allItems.filter((item) => item.status === "scheduled" || item.action);
  const now = Date.now();
  const upcomingActions = [...scheduledItems]
    .filter((item) => !item.dueAt || new Date(item.dueAt).getTime() <= now + 7 * 24 * 60 * 60 * 1000)
    .sort((first, second) => {
      if (!first.dueAt && !second.dueAt) return 0;
      if (!first.dueAt) return 1;
      if (!second.dueAt) return -1;
      return new Date(first.dueAt) - new Date(second.dueAt);
    })
    .slice(0, 20);
  const recentActions = [...scheduledItems].filter((item) => Boolean(item.dueAt)).sort((first, second) => new Date(second.dueAt || 0) - new Date(first.dueAt || 0)).slice(0, 20);

  const totalPendingBytes = toMaintainerrNumber(
    firstDefined(storage?.reclaimableBytes, storage?.reclaimable_bytes, storage?.bytesToReclaim, raw?.reclaimableBytes, raw?.reclaimable_bytes, 0),
    0
  );
  const totalItems = toMaintainerrNumber(raw?.scheduledCount || raw?.itemsCount || raw?.queuedCount, scheduledItems.length);
  const collectionFailures = collections.filter((collection) => String(collection.status || "").toLowerCase().includes("fail")).length;

  return {
    collections,
    scheduledItems,
    excludedItems,
    upcomingActions,
    recentActions,
    storage: {
      reclaimableBytes: totalPendingBytes,
      totalBytes: toMaintainerrNumber(storage?.totalBytes || storage?.total_bytes, 0),
      usedBytes: toMaintainerrNumber(storage?.usedBytes || storage?.used_bytes, 0),
      freeBytes: toMaintainerrNumber(storage?.freeBytes || storage?.free_bytes, 0),
    },
    stats: {
      collections: collections.length,
      scheduledItems: totalItems,
      excludedItems: excludedItems.length,
      collectionFailures,
      upcomingWeek: upcomingActions.length,
    },
  };
}

async function getConnectedMaintainerrIntegration() {
  const integrations = await getIntegrations();
  return (integrations.thirdParty || []).find(
    (integration) => integration.connected && isMaintainerrIntegration(integration) && cleanIntegrationUrl(integration.values?.url)
  );
}

async function fetchMaintainerrBundle(integration) {
  const url = cleanIntegrationUrl(integration.values?.url);
  const headers = getMaintainerrHeaders(integration);
  const [healthResponse, liveResponse, readyResponse, storageResponse, overlayResponse] = await Promise.all([
    fetchOptionalJson(`${url}/api/health`, { timeout: 12000, headers }),
    fetchOptionalJson(`${url}/api/health/live`, { timeout: 12000, headers }),
    fetchOptionalJson(`${url}/api/health/ready`, { timeout: 12000, headers }),
    fetchOptionalJson(`${url}/api/storage-metrics`, { timeout: 12000, headers }),
    fetchOptionalJson(`${url}/api/collections/overlay-data`, { timeout: 16000, headers }),
  ]);

  const healthBase = healthResponse || {};
  const live = liveResponse || {};
  const ready = readyResponse || {};
  const normalized = normalizeMaintainerrBundle({ ...(overlayResponse || {}), storage: storageResponse || {} });
  const liveStatus = getMaintainerrStatusValue(live);
  const readyStatus = getMaintainerrStatusValue(ready);
  const healthy = getMaintainerrHealthStatus(healthBase);

  return {
    source: {
      name: integration.name || "Maintainerr",
      url,
      instanceId: integration.instanceId,
    },
    health: {
      ok: healthy === null ? true : healthy,
      status: String(firstDefined(healthBase?.status, healthBase?.state, healthBase?.message, healthBase?.result, "")),
      live: liveStatus === null ? Boolean(live) : Boolean(liveStatus),
      ready: readyStatus === null ? Boolean(ready) : Boolean(readyStatus),
      checkedAt: new Date().toISOString(),
      details: firstDefined(healthBase, {}),
    },
    ...normalized,
    syncedAt: new Date().toISOString(),
  };
}

async function runMaintainerrAction(integration, payload = {}) {
  const url = cleanIntegrationUrl(integration.values?.url);
  const headers = { ...getMaintainerrHeaders(integration), "Content-Type": "application/json" };
  const action = String(payload.action || "").trim().toLowerCase();
  const collectionId = String(payload.collectionId || payload.collection || "").trim();
  const itemId = String(payload.itemId || payload.mediaId || payload.id || "").trim();
  const rawAction = String(payload.rawAction || payload.actionName || payload.actionType || "").trim();
  const postponeHours = Number(payload.postponeHours || 24);

  const postJson = (path, body = {}) =>
    axios.post(`${url}${path}`, { ...body, ...(payload?.extra || {}) }, { timeout: 12000, headers });

  if (action === "refresh" || action === "refresh-collections" || action === "refresh-rules" || action === "refresh-rules-and-collections") {
    const attempts = [
      `/api/collections/refresh`,
      `/api/media-server/collections/refresh`,
      collectionId ? `/api/collections/${encodeURIComponent(collectionId)}/refresh` : null,
      `/api/rules/refresh`,
      `/api/media-server/rules/refresh`,
    ];
    for (const path of attempts) {
      if (!path) continue;
      try {
        const response = await postJson(path, { collectionId, reason: "manual_refresh", ...payload });
        return { action, ok: true, result: response.data || { status: "ok", message: "Refresh triggered." }, message: "Refresh triggered." };
      } catch (error) {
        if (error.response?.status && error.response.status < 500 && error.response.status !== 404) {
          continue;
        }
      }
    }
  }

  if (action === "postpone-item" || action === "postpone") {
    const body = {
      itemId,
      action: "postpone",
      collectionId,
      postponeHours: Number.isFinite(postponeHours) && postponeHours > 0 ? postponeHours : 24,
      ...payload,
    };
    const attempts = [
      "/api/collections/media/handle",
      "/api/media-server/collections/media/handle",
      itemId ? `/api/collections/media/${encodeURIComponent(itemId)}/postpone` : null,
      itemId ? `/api/media-server/collections/media/${encodeURIComponent(itemId)}/postpone` : null,
    ];
    for (const path of attempts) {
      if (!path) continue;
      try {
        const response = await postJson(path, body);
        return { action, ok: true, result: response.data || { status: "ok", message: "Item postponed." }, message: "Item postponed." };
      } catch (error) {
        if (error.response?.status && error.response.status < 500 && error.response.status !== 404) {
          continue;
        }
      }
    }
  }

  if (action === "run-item-action" || action === "run-item" || action === "trigger-item" || action === "run") {
    const body = {
      itemId,
      collectionId,
      action: rawAction || "run",
      ...payload,
    };
    const attempts = [
      "/api/collections/media/handle",
      "/api/media-server/collections/media/handle",
      itemId ? `/api/collections/media/${encodeURIComponent(itemId)}/run` : null,
      itemId ? `/api/collections/media/${encodeURIComponent(itemId)}/action` : null,
      itemId ? `/api/media-server/collections/media/${encodeURIComponent(itemId)}/run` : null,
    ];
    for (const path of attempts) {
      if (!path) continue;
      try {
        const response = await postJson(path, body);
        return { action, ok: true, result: response.data || { status: "ok", message: "Cleanup action triggered." }, message: "Item action triggered." };
      } catch (error) {
        if (error.response?.status && error.response.status < 500 && error.response.status !== 404) {
          continue;
        }
      }
    }
  }

  throw new Error(`Unsupported Maintainerr action: ${action}`);
}

async function getConnectedWizarrIntegration() {
  const integrations = await getIntegrations();
  return (integrations.thirdParty || []).find((integration) => integration.connected && isWizarrIntegration(integration));
}

async function fetchWizarrBundle(integration) {
  const url = cleanIntegrationUrl(integration.values?.url);
  const headers = getWizarrHeaders(integration);
  const [statusResponse, invitesResponse, serversResponse, librariesResponse] = await Promise.all([
    axios.get(`${url}/api/status`, { timeout: 10000, headers }),
    axios.get(`${url}/api/invitations`, { timeout: 10000, headers }),
    axios.get(`${url}/api/servers`, { timeout: 10000, headers }).catch(() => ({ data: { servers: [] } })),
    axios.get(`${url}/api/libraries`, { timeout: 12000, headers }).catch(() => ({ data: { libraries: [] } })),
  ]);

  const invites = Array.isArray(invitesResponse.data?.invitations)
    ? invitesResponse.data.invitations
    : Array.isArray(invitesResponse.data)
      ? invitesResponse.data
      : [];
  const servers = Array.isArray(serversResponse.data?.servers) ? serversResponse.data.servers : Array.isArray(serversResponse.data) ? serversResponse.data : [];
  const libraries = Array.isArray(librariesResponse.data?.libraries)
    ? librariesResponse.data.libraries
    : Array.isArray(librariesResponse.data)
      ? librariesResponse.data
      : [];
  return {
    source: {
      name: integration.name || "Wizarr",
      url,
      instanceId: integration.instanceId,
    },
    status: statusResponse.data || {},
    invites: invites.map((invite) => normalizeWizarrInvite(invite, url)),
    servers: servers.map(normalizeWizarrServer),
    libraries: libraries.map(normalizeWizarrLibrary),
    bundles: [],
    syncedAt: new Date().toISOString(),
  };
}

function isSeerrIntegration(integration) {
  const name = String(integration?.name || integration?.slug || "").toLowerCase();
  return name === "seerr" || name.includes("jellyseerr") || name.includes("overseerr");
}

function isBazarrIntegration(integration) {
  const name = String(integration?.name || integration?.slug || "").toLowerCase();
  return name === "bazarr" || name.includes("bazarr");
}

function isProwlarrIntegration(integration) {
  const name = String(integration?.name || integration?.slug || "").toLowerCase();
  return name === "prowlarr" || name.includes("prowlarr");
}

function getArrHeaders(integration) {
  return {
    Accept: "application/json",
    "X-Api-Key": integration?.values?.secret || "",
  };
}

function asCount(value) {
  if (Array.isArray(value)) return value.length;
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function toStatusText(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return value.message || value.errorMessage || value.error || JSON.stringify(value);
}

async function fetchOptionalJson(url, options) {
  try {
    const response = await axios.get(url, options);
    return response.data;
  } catch {
    return null;
  }
}

function normalizeBazarrHistory(items = []) {
  return (Array.isArray(items) ? items : items?.data || [])
    .map((item, index) => ({
      id: item.id || item.history_id || `${item.title || item.path || "subtitle"}-${index}`,
      title: item.title || item.seriesTitle || item.movieTitle || item.sonarrSeriesTitle || item.radarrMovieTitle || item.path || "Subtitle event",
      language: item.language || item.languageName || item.subtitle_language || "",
      action: item.action || item.event || (item.upgrade ? "Upgraded" : item.message || "Subtitle update"),
      provider: item.provider || item.score_provider || "",
      createdAt: item.timestamp || item.date || item.createdAt || "",
    }))
    .slice(0, 20);
}

async function fetchBazarrHealth(integration) {
  const url = cleanIntegrationUrl(integration.values?.url);
  const headers = getArrHeaders(integration);
  const options = { timeout: 12000, headers, params: { apikey: integration.values?.secret } };
  const [status, health, episodesWanted, moviesWanted, history] = await Promise.all([
    fetchOptionalJson(`${url}/api/system/status`, options),
    fetchOptionalJson(`${url}/api/system/health`, options),
    fetchOptionalJson(`${url}/api/episodes/wanted`, options),
    fetchOptionalJson(`${url}/api/movies/wanted`, options),
    fetchOptionalJson(`${url}/api/history`, options),
  ]);
  const episodeItems = Array.isArray(episodesWanted) ? episodesWanted : episodesWanted?.data || episodesWanted?.results || [];
  const movieItems = Array.isArray(moviesWanted) ? moviesWanted : moviesWanted?.data || moviesWanted?.results || [];
  const issues = Array.isArray(health) ? health : health?.issues || health?.data || [];

  return {
    id: integration.instanceId,
    name: integration.name || "Bazarr",
    type: "bazarr",
    version: extractIntegrationVersion(status) || status?.version || "",
    ok: issues.length === 0,
    stats: {
      missingEpisodes: asCount(episodeItems),
      missingMovies: asCount(movieItems),
      issues: issues.length,
      recentDownloads: normalizeBazarrHistory(history).length,
    },
    issues: issues.map((issue, index) => ({
      id: issue.id || index,
      source: issue.source || issue.type || "Bazarr",
      message: toStatusText(issue.message || issue.error || issue.warning || issue),
      level: issue.type || issue.level || "warning",
    })),
    wanted: [...episodeItems, ...movieItems].slice(0, 20).map((item, index) => ({
      id: item.id || item.sonarrEpisodeId || item.radarrId || index,
      title: item.title || item.seriesTitle || item.movieTitle || item.path || "Missing subtitle",
      language: item.language || item.languageName || item.missing_language || "",
      type: item.episodeTitle || item.seriesTitle ? "Episode" : "Movie",
    })),
    history: normalizeBazarrHistory(history),
  };
}

async function fetchProwlarrHealth(integration) {
  const url = cleanIntegrationUrl(integration.values?.url);
  const headers = getArrHeaders(integration);
  const options = { timeout: 12000, headers };
  const [status, health, indexers, indexerStatus, applications] = await Promise.all([
    fetchOptionalJson(`${url}/api/v1/system/status`, options),
    fetchOptionalJson(`${url}/api/v1/health`, options),
    fetchOptionalJson(`${url}/api/v1/indexer`, options),
    fetchOptionalJson(`${url}/api/v1/indexerstatus`, options),
    fetchOptionalJson(`${url}/api/v1/applications`, options),
  ]);
  const indexerRows = Array.isArray(indexers) ? indexers : [];
  const statusRows = Array.isArray(indexerStatus) ? indexerStatus : [];
  const issueRows = Array.isArray(health) ? health : [];
  const statusByIndexerId = new Map(statusRows.map((item) => [String(item.indexerId || item.id), item]));
  const failedIndexers = indexerRows.filter((indexer) => {
    const row = statusByIndexerId.get(String(indexer.id));
    return indexer.enable === false || row?.disabledTill || row?.mostRecentFailure || row?.initialFailure;
  });

  return {
    id: integration.instanceId,
    name: integration.name || "Prowlarr",
    type: "prowlarr",
    version: extractIntegrationVersion(status) || status?.version || "",
    ok: issueRows.length === 0 && failedIndexers.length === 0,
    stats: {
      indexers: indexerRows.length,
      failedIndexers: failedIndexers.length,
      applications: Array.isArray(applications) ? applications.length : 0,
      issues: issueRows.length,
    },
    issues: [
      ...issueRows.map((issue, index) => ({
        id: issue.id || index,
        source: issue.source || "Prowlarr",
        message: toStatusText(issue.message || issue.error || issue),
        level: issue.type || issue.level || "warning",
      })),
      ...failedIndexers.map((indexer) => {
        const row = statusByIndexerId.get(String(indexer.id)) || {};
        return {
          id: `indexer-${indexer.id}`,
          source: indexer.name || "Indexer",
          message: toStatusText(row.mostRecentFailure || row.initialFailure || row.disabledTill || "Indexer disabled"),
          level: "error",
        };
      }),
    ],
    indexers: indexerRows.slice(0, 40).map((indexer) => {
      const row = statusByIndexerId.get(String(indexer.id)) || {};
      return {
        id: indexer.id,
        name: indexer.name || `Indexer ${indexer.id}`,
        protocol: indexer.protocol || "",
        enabled: indexer.enable !== false,
        failure: toStatusText(row.mostRecentFailure || row.initialFailure),
        disabledTill: toStatusText(row.disabledTill),
      };
    }),
    applications: (Array.isArray(applications) ? applications : []).map((app) => ({
      id: app.id,
      name: app.name || app.implementationName || "Application",
      syncLevel: app.syncLevel || "",
      tags: app.tags || [],
    })),
  };
}

async function fetchAutomationHealth() {
  const integrations = await getIntegrations();
  const apps = (integrations.arrApps || []).filter((integration) => integration.connected && (isBazarrIntegration(integration) || isProwlarrIntegration(integration)));
  const results = await Promise.allSettled(
    apps.map((integration) => (isBazarrIntegration(integration) ? fetchBazarrHealth(integration) : fetchProwlarrHealth(integration)))
  );

  const services = results.map((result, index) => {
    if (result.status === "fulfilled") return result.value;
    const integration = apps[index];
    return {
      id: integration.instanceId,
      name: integration.name,
      type: isBazarrIntegration(integration) ? "bazarr" : "prowlarr",
      ok: false,
      stats: {},
      issues: [{ id: "load-error", source: integration.name, message: getAxiosErrorMessage(result.reason), level: "error" }],
    };
  });

  return {
    services,
    stats: {
      services: services.length,
      healthy: services.filter((service) => service.ok).length,
      issues: services.reduce((count, service) => count + (service.issues?.length || 0), 0),
      missingSubtitles: services.reduce((count, service) => count + Number(service.stats?.missingEpisodes || 0) + Number(service.stats?.missingMovies || 0), 0),
      failedIndexers: services.reduce((count, service) => count + Number(service.stats?.failedIndexers || 0), 0),
    },
    syncedAt: new Date().toISOString(),
  };
}

function cloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function clearRequestCache() {
  requestCache.clear();
}

async function getConnectedSeerrApps() {
  const integrations = await getIntegrations();
  return (integrations.arrApps || []).filter((integration) => integration.connected && isSeerrIntegration(integration));
}

function getSeerrAppById(seerrApps, sourceId) {
  return seerrApps.find((integration) => integration.instanceId === sourceId && isSeerrIntegration(integration));
}

async function fetchSeerrMediaDetails(app, media) {
  const url = cleanIntegrationUrl(app.values?.url);
  const apiKey = app.values?.secret;
  const mediaType = String(media?.mediaType || "").toLowerCase();
  const tmdbId = media?.tmdbId || media?.externalServiceSlug;

  if (!url || !apiKey || !tmdbId || !["movie", "tv"].includes(mediaType)) {
    return {};
  }

  const cacheKey = `${app.instanceId || app.name}:${mediaType}:${tmdbId}`;
  const cached = seerrMediaDetailCache.get(cacheKey);
  if (cached?.expiresAt > Date.now()) {
    return cached.data;
  }

  try {
    const response = await axios.get(`${url}/api/v1/${mediaType}/${encodeURIComponent(tmdbId)}`, {
      timeout: 10000,
      headers: { "X-Api-Key": apiKey },
    });
    const data = response.data || {};
    seerrMediaDetailCache.set(cacheKey, { data, expiresAt: Date.now() + SEERR_MEDIA_DETAIL_CACHE_TTL_MS });
    return data;
  } catch (error) {
    console.log(`[REQUESTS] ${app.name} metadata lookup failed for ${mediaType}:${tmdbId}:`, getAxiosErrorMessage(error));
    return {};
  }
}

function buildSeerrImageUrl(imagePath, size = "w342") {
  if (!imagePath) return null;
  const normalizedPath = String(imagePath).startsWith("/") ? imagePath : `/${imagePath}`;
  return `https://image.tmdb.org/t/p/${size}${normalizedPath}`;
}

function buildSeerrImageUrls(imagePath) {
  return ["w342", "w500", "original"].map((size) => buildSeerrImageUrl(imagePath, size)).filter(Boolean);
}

function buildSeerrOpenUrl(app, request) {
  const url = cleanIntegrationUrl(app.values?.url);
  const mediaType = String(request.mediaType || "").toLowerCase();
  const tmdbId = request.externalIds?.tmdbId;
  if (!url || !tmdbId || !["movie", "tv"].includes(mediaType)) return url || null;
  return `${url}/${mediaType}/${encodeURIComponent(tmdbId)}`;
}

async function fetchOmdbRatings(request) {
  const apiKey = process.env.OMDB_API_KEY || process.env.OMDB_KEY;
  if (!apiKey) return {};

  const imdbId = request.externalIds?.imdbId;
  const title = String(request.title || "").trim();
  if (!imdbId && !title) return {};

  try {
    const response = await axios.get("https://www.omdbapi.com/", {
      timeout: 8000,
      params: {
        apikey: apiKey,
        ...(imdbId ? { i: imdbId } : { t: title }),
        ...(request.year ? { y: request.year } : {}),
      },
    });
    const data = response.data || {};
    if (data.Response === "False") return {};

    const rotten = (data.Ratings || []).find((rating) => String(rating.Source || "").toLowerCase() === "rotten tomatoes")?.Value;
    const ratings = {};
    if (data.imdbRating && data.imdbRating !== "N/A") ratings.imdb = Number(data.imdbRating);
    if (rotten && rotten !== "N/A") ratings.rottenTomatoes = Number(String(rotten).replace("%", ""));
    return ratings;
  } catch (error) {
    console.log(`[REQUESTS] OMDb ratings lookup failed for ${imdbId || title}:`, error?.message || error);
    return {};
  }
}

function normalizeExternalRating(value) {
  const raw = typeof value === "object" && value !== null ? value.value ?? value.score ?? value.rating ?? value.percent : value;
  if (raw === undefined || raw === null || raw === "") return null;
  const parsed = Number(String(raw).replace("%", ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function getObjectValueCaseInsensitive(source = {}, keys = []) {
  const entries = Object.entries(source || {});
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(source, key)) return source[key];
    const match = entries.find(([entryKey]) => entryKey.toLowerCase() === key.toLowerCase());
    if (match) return match[1];
  }
  return null;
}

function normalizeArrRatings(ratings = {}) {
  return {
    imdb: normalizeExternalRating(getObjectValueCaseInsensitive(ratings, ["imdb"])),
    rottenTomatoes: normalizeExternalRating(getObjectValueCaseInsensitive(ratings, ["rottenTomatoes", "rotten", "tomatometer"])),
    tmdb: normalizeExternalRating(getObjectValueCaseInsensitive(ratings, ["tmdb"])),
    metacritic: normalizeExternalRating(getObjectValueCaseInsensitive(ratings, ["metacritic"])),
  };
}

function normalizeSeerrRatingsPayload(payload = {}) {
  const ratings = {};
  const sourceRatings = Array.isArray(payload.Ratings) ? payload.Ratings : Array.isArray(payload.ratings) ? payload.ratings : [];

  sourceRatings.forEach((entry) => {
    const sourceName = String(entry.Source || entry.source || entry.name || "").toLowerCase();
    const value = entry.Value || entry.value || entry.rating || entry.score;
    if (sourceName.includes("internet movie database") || sourceName.includes("imdb")) ratings.imdb = normalizeExternalRating(value);
    if (sourceName.includes("rotten")) ratings.rottenTomatoes = normalizeExternalRating(value);
    if (sourceName.includes("metacritic")) ratings.metacritic = normalizeExternalRating(value);
    if (sourceName.includes("tmdb") || sourceName.includes("themoviedb")) ratings.tmdb = normalizeExternalRating(value);
  });

  return {
    imdb:
      ratings.imdb ||
      normalizeExternalRating(getNestedValue(payload, ["imdb.rating", "imdb.score", "imdb.value", "imdb", "imdbRating", "imdbScore"])),
    rottenTomatoes:
      ratings.rottenTomatoes ||
      normalizeExternalRating(
        getNestedValue(payload, [
          "rottenTomatoes.rating",
          "rottenTomatoes.score",
          "rottenTomatoes.value",
          "rottenTomatoes.criticsScore",
          "rottenTomatoes.tomatoMeter",
          "rt.rating",
          "rt.score",
          "rt.value",
          "rt.criticsScore",
          "tomatometer",
          "tomatoMeter",
          "rtScore",
        ])
      ),
    tmdb:
      ratings.tmdb ||
      normalizeExternalRating(getNestedValue(payload, ["tmdb.rating", "tmdb.score", "tmdb.value", "tmdb", "tmdbRating", "tmdbScore"])),
    metacritic:
      ratings.metacritic ||
      normalizeExternalRating(
        getNestedValue(payload, ["metacritic.rating", "metacritic.score", "metacritic.value", "metacritic", "metascore", "metaScore"])
      ),
  };
}

async function fetchSeerrRatings(app, request) {
  const url = cleanIntegrationUrl(app.values?.url);
  const apiKey = app.values?.secret;
  const mediaType = String(request.mediaType || "").toLowerCase();
  const tmdbId = request.externalIds?.tmdbId;
  if (!url || !apiKey || !tmdbId || !["movie", "tv"].includes(mediaType)) return {};

  const paths =
    mediaType === "movie"
      ? [`/api/v1/movie/${encodeURIComponent(tmdbId)}/ratingscombined`, `/api/v1/movie/${encodeURIComponent(tmdbId)}/ratings`]
      : [`/api/v1/tv/${encodeURIComponent(tmdbId)}/ratings`];

  for (const path of paths) {
    try {
      const response = await axios.get(`${url}${path}`, {
        timeout: 10000,
        headers: { "X-Api-Key": apiKey },
      });
      const ratings = normalizeSeerrRatingsPayload(response.data || {});
      if (Object.values(ratings).some(Boolean)) return ratings;
    } catch (error) {
      if (error.response?.status !== 404) {
        console.log(`[REQUESTS] ${app.name} ratings lookup failed for ${request.title}:`, error.response?.status || error.message);
      }
    }
  }

  return {};
}

function findArrMediaMatch(items, request) {
  const list = Array.isArray(items) ? items : items ? [items] : [];
  const tmdbId = String(request.externalIds?.tmdbId || "");
  const tvdbId = String(request.externalIds?.tvdbId || "");
  const imdbId = String(request.externalIds?.imdbId || "");
  const title = String(request.title || "").trim().toLowerCase();

  return (
    list.find((item) => tmdbId && String(item.tmdbId || item.tmdbId === 0 ? item.tmdbId : "") === tmdbId) ||
    list.find((item) => tvdbId && String(item.tvdbId || item.tvdbId === 0 ? item.tvdbId : "") === tvdbId) ||
    list.find((item) => imdbId && String(item.imdbId || "") === imdbId) ||
    list.find((item) => title && String(item.title || item.sortTitle || "").trim().toLowerCase() === title) ||
    list[0] ||
    null
  );
}

async function fetchArrRatings(request) {
  const integrations = await getIntegrations().catch(() => ({ arrApps: [] }));
  const apps = (integrations.arrApps || []).filter((app) => app.connected && app.values?.url && app.values?.secret);
  const mediaType = String(request.mediaType || "").toLowerCase();
  const app =
    mediaType === "movie"
      ? apps.find((entry) => String(entry.slug || entry.name || "").toLowerCase().includes("radarr"))
      : apps.find((entry) => String(entry.slug || entry.name || "").toLowerCase().includes("sonarr"));

  if (!app) return {};

  const url = cleanIntegrationUrl(app.values?.url);
  const apiKey = app.values?.secret;
  const headers = { "X-Api-Key": apiKey };

  const attempts =
    mediaType === "movie"
      ? [
          request.externalIds?.tmdbId && { path: `/api/v3/movie/lookup/tmdb?tmdbId=${encodeURIComponent(request.externalIds.tmdbId)}` },
          request.externalIds?.tmdbId && { path: `/api/v3/movie/lookup?term=${encodeURIComponent(`tmdb:${request.externalIds.tmdbId}`)}` },
          { path: "/api/v3/movie", find: true },
        ].filter(Boolean)
      : [
          request.externalIds?.tvdbId && { path: `/api/v3/series/lookup?term=${encodeURIComponent(`tvdb:${request.externalIds.tvdbId}`)}` },
          request.externalIds?.imdbId && { path: `/api/v3/series/lookup?term=${encodeURIComponent(`imdb:${request.externalIds.imdbId}`)}` },
          { path: "/api/v3/series", find: true },
        ].filter(Boolean);

  for (const attempt of attempts) {
    try {
      const response = await axios.get(`${url}${attempt.path}`, { timeout: 10000, headers });
      const match = attempt.find ? findArrMediaMatch(response.data, request) : findArrMediaMatch(response.data, request);
      const ratings = normalizeArrRatings(match?.ratings || {});
      if (Object.values(ratings).some(Boolean)) return ratings;
    } catch (error) {
      console.log(`[REQUESTS] ${app.name} ratings lookup failed for ${request.title}:`, error.response?.status || error.message);
    }
  }

  return {};
}

function getNestedValue(source, paths = []) {
  for (const path of paths) {
    const value = path.split(".").reduce((current, key) => (current == null ? undefined : current[key]), source);
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return null;
}

function normalizeSeerrMediaStatus(mediaInfo = {}) {
  const status = mediaInfo.status ?? mediaInfo.status4k;
  const statusMap = {
    1: "Unknown",
    2: "Pending",
    3: "Processing",
    4: "Partially available",
    5: "Available",
  };

  return statusMap[status] || mediaInfo.statusLabel || mediaInfo.status || "Unknown";
}

function normalizeSeerrSeason(season = {}) {
  const seasonNumber = season.seasonNumber ?? season.season_number ?? season.season;
  if (!Number.isFinite(Number(seasonNumber)) || Number(seasonNumber) <= 0) {
    return null;
  }

  return {
    seasonNumber: Number(seasonNumber),
    title: season.name || season.title || `Season ${seasonNumber}`,
    episodeCount: season.episodeCount ?? season.episode_count ?? season.episodes?.length ?? null,
    airDate: season.airDate || season.air_date || null,
  };
}

function normalizeSeerrSearchResult(item, source) {
  const mediaType = String(item.mediaType || item.media_type || "").toLowerCase();
  if (!["movie", "tv"].includes(mediaType)) {
    return null;
  }

  const tmdbId = Number(item.id || item.tmdbId || item.tmdb_id);
  if (!Number.isFinite(tmdbId)) {
    return null;
  }

  const releaseDate = item.releaseDate || item.firstAirDate || item.release_date || item.first_air_date || "";
  const posterPath = item.posterPath || item.poster_path || null;
  const backdropPath = item.backdropPath || item.backdrop_path || null;
  const title = item.title || item.name || item.originalTitle || item.originalName || "Untitled media";

  return {
    id: `${source.instanceId}-${mediaType}-${tmdbId}`,
    sourceId: source.instanceId,
    source: source.name,
    mediaId: tmdbId,
    mediaType,
    title,
    year: releaseDate ? String(releaseDate).slice(0, 4) : "",
    releaseDate,
    overview: item.overview || "",
    posterPath,
    posterUrl: buildSeerrImageUrl(posterPath, "w342"),
    posterUrls: buildSeerrImageUrls(posterPath),
    backdropUrl: buildSeerrImageUrl(backdropPath, "w780"),
    rating: item.voteAverage || item.vote_average || item.rating || null,
    popularity: item.popularity || 0,
    availability: normalizeSeerrMediaStatus(item.mediaInfo),
    requested: Boolean(item.mediaInfo?.requests?.length) || ["Pending", "Processing", "Partially available", "Available"].includes(normalizeSeerrMediaStatus(item.mediaInfo)),
    openUrl: buildSeerrOpenUrl(source, {
      mediaType,
      externalIds: { tmdbId },
    }),
  };
}

async function hydrateSeerrSearchResult(source, result) {
  if (result.mediaType !== "tv") {
    return result;
  }

  const details = await fetchSeerrMediaDetails(source, { mediaType: "tv", tmdbId: result.mediaId });
  const seasons = (details.seasons || []).map(normalizeSeerrSeason).filter(Boolean);

  return {
    ...result,
    seasons,
    tvdbId: details.tvdbId || details.externalIds?.tvdbId || null,
    overview: result.overview || details.overview || "",
    posterUrl: result.posterUrl || buildSeerrImageUrl(details.posterPath || details.poster_path, "w342"),
    posterUrls: result.posterUrls?.length ? result.posterUrls : buildSeerrImageUrls(details.posterPath || details.poster_path),
  };
}

async function searchSeerrMedia({ query, sourceId }) {
  const searchQuery = String(query || "").trim();
  if (searchQuery.length < 2) {
    const error = new Error("Search needs at least 2 characters");
    error.statusCode = 400;
    throw error;
  }

  const seerrApps = await getConnectedSeerrApps();
  const apps = sourceId ? [getSeerrAppById(seerrApps, sourceId)].filter(Boolean) : seerrApps;
  if (!apps.length) {
    const error = new Error("No connected Jellyseerr or Overseerr source found");
    error.statusCode = 404;
    throw error;
  }

  const results = [];
  const errors = [];

  await Promise.all(
    apps.map(async (app) => {
      const url = cleanIntegrationUrl(app.values?.url);
      const apiKey = app.values?.secret;
      if (!url || !apiKey) return;

      try {
        const response = await axios.get(`${url}/api/v1/search`, {
          timeout: 10000,
          headers: { "X-Api-Key": apiKey },
          params: { query: searchQuery, page: 1 },
        });
        const items = Array.isArray(response.data?.results) ? response.data.results : Array.isArray(response.data) ? response.data : [];
        const normalized = await Promise.all(
          items
            .map((item) => normalizeSeerrSearchResult(item, app))
            .filter(Boolean)
            .slice(0, 12)
            .map((item) => hydrateSeerrSearchResult(app, item))
        );
        results.push(...normalized);
      } catch (error) {
        errors.push({ source: app.name, message: getAxiosErrorMessage(error) });
      }
    })
  );

  return {
    query: searchQuery,
    sources: apps.map((app) => ({ name: app.name, instanceId: app.instanceId, connected: app.connected })),
    results: results.sort((a, b) => Number(b.popularity || 0) - Number(a.popularity || 0)).slice(0, 24),
    errors,
  };
}

async function fetchSeerrMediaResultDetail({ sourceId, mediaType, mediaId }) {
  const seerrApps = await getConnectedSeerrApps();
  const app = getSeerrAppById(seerrApps, sourceId);
  if (!app) {
    const error = new Error("Seerr source not found");
    error.statusCode = 404;
    throw error;
  }

  const normalizedType = String(mediaType || "").toLowerCase();
  const normalizedMediaId = Number(mediaId);
  if (!["movie", "tv"].includes(normalizedType) || !Number.isFinite(normalizedMediaId)) {
    const error = new Error("A valid movie or TV result is required");
    error.statusCode = 400;
    throw error;
  }

  const mediaDetails = await fetchSeerrMediaDetails(app, { mediaType: normalizedType, tmdbId: normalizedMediaId });
  const base = normalizeSeerrSearchResult({ ...mediaDetails, id: normalizedMediaId, mediaType: normalizedType }, app) || {};
  const seasons = normalizedType === "tv" ? (mediaDetails.seasons || []).map(normalizeSeerrSeason).filter(Boolean) : [];
  const releaseDate = mediaDetails.releaseDate || mediaDetails.firstAirDate || mediaDetails.release_date || mediaDetails.first_air_date || base.releaseDate || "";
  const detail = {
    ...base,
    sourceId: app.instanceId,
    source: app.name,
    mediaId: normalizedMediaId,
    mediaType: normalizedType,
    title: base.title || mediaDetails.title || mediaDetails.name || mediaDetails.originalTitle || mediaDetails.originalName || "Untitled media",
    overview: mediaDetails.overview || mediaDetails.summary || base.overview || "",
    genres: (mediaDetails.genres || []).map((genre) => genre.name || genre).filter(Boolean),
    cast: normalizeCastList(mediaDetails),
    seasons,
    runtime: mediaDetails.runtime || mediaDetails.episodeRunTime?.[0] || mediaDetails.episode_run_time?.[0] || null,
    rating: mediaDetails.voteAverage || mediaDetails.vote_average || mediaDetails.rating || base.rating || null,
    ratings: {
      tmdb: mediaDetails.voteAverage || mediaDetails.vote_average || mediaDetails.rating || base.rating || null,
      rottenTomatoes:
        getNestedValue(mediaDetails, [
          "ratings.rottenTomatoes",
          "ratings.rottenTomatoesScore",
          "ratings.criticsScore",
          "rottenTomatoesScore",
          "criticRating",
          "criticScore",
        ]) || null,
    },
    year: releaseDate ? String(releaseDate).slice(0, 4) : base.year || "",
    releaseDate,
    externalIds: {
      tmdbId: normalizedMediaId,
      tvdbId: mediaDetails.tvdbId || mediaDetails.externalIds?.tvdbId || null,
      imdbId: mediaDetails.imdbId || mediaDetails.imdb_id || mediaDetails.externalIds?.imdbId || null,
    },
  };

  detail.availability = await getRequestAvailability(detail, { includeRatings: true });
  const [seerrRatings, omdbRatings, arrRatings] = await Promise.all([
    fetchSeerrRatings(app, detail),
    fetchOmdbRatings(detail),
    fetchArrRatings(detail),
  ]);
  detail.ratings = {
    ...detail.ratings,
    ...(detail.availability?.ratings || {}),
    ...omdbRatings,
    ...arrRatings,
    ...seerrRatings,
  };

  return detail;
}

function formatBytes(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size >= 10 || unitIndex === 0 ? size.toFixed(0) : size.toFixed(1)} ${units[unitIndex]}`;
}

function normalizeServiceServer(server = {}) {
  return {
    id: server.id,
    name: server.name || `Server ${server.id}`,
    is4k: Boolean(server.is4k),
    isDefault: Boolean(server.isDefault),
    activeDirectory: server.activeDirectory || "",
    activeProfileId: server.activeProfileId ?? server.activeAnimeProfileId ?? null,
    activeLanguageProfileId: server.activeLanguageProfileId ?? server.activeAnimeLanguageProfileId ?? null,
    activeTags: server.activeTags || server.tags || [],
  };
}

function normalizeServiceDetails(details = {}) {
  const server = normalizeServiceServer(details.server || {});

  return {
    server,
    profiles: (details.profiles || []).map((profile) => ({ id: profile.id, name: profile.name || `Profile ${profile.id}` })),
    rootFolders: (details.rootFolders || []).map((folder) => ({
      id: folder.id,
      path: folder.path,
      freeSpace: folder.freeSpace,
      totalSpace: folder.totalSpace,
      freeSpaceLabel: formatBytes(folder.freeSpace),
    })),
    languageProfiles: (details.languageProfiles || []).map((profile) => ({ id: profile.id, name: profile.name || `Language ${profile.id}` })),
    tags: (details.tags || []).map((tag) => ({ id: tag.id, label: tag.label || tag.name || `Tag ${tag.id}` })),
  };
}

async function fetchSeerrRequestOptions({ sourceId, mediaType }) {
  const seerrApps = await getConnectedSeerrApps();
  const app = getSeerrAppById(seerrApps, sourceId);
  if (!app) {
    const error = new Error("Seerr source not found");
    error.statusCode = 404;
    throw error;
  }

  const normalizedType = String(mediaType || "").toLowerCase();
  const serviceType = normalizedType === "movie" ? "radarr" : normalizedType === "tv" ? "sonarr" : "";
  if (!serviceType) {
    const error = new Error("A valid movie or TV type is required");
    error.statusCode = 400;
    throw error;
  }

  const url = cleanIntegrationUrl(app.values?.url);
  const apiKey = app.values?.secret;

  try {
    const listResponse = await axios.get(`${url}/api/v1/service/${serviceType}`, {
      timeout: 10000,
      headers: { "X-Api-Key": apiKey },
    });
    const servers = Array.isArray(listResponse.data) ? listResponse.data.map(normalizeServiceServer) : [];
    const detailedServers = await Promise.all(
      servers.map(async (server) => {
        try {
          const detailResponse = await axios.get(`${url}/api/v1/service/${serviceType}/${encodeURIComponent(server.id)}`, {
            timeout: 10000,
            headers: { "X-Api-Key": apiKey },
          });
          return normalizeServiceDetails(detailResponse.data || { server });
        } catch (error) {
          return { server, profiles: [], rootFolders: [], languageProfiles: [], tags: [], error: getAxiosErrorMessage(error) };
        }
      })
    );

    return {
      sourceId: app.instanceId,
      source: app.name,
      mediaType: normalizedType,
      serviceType,
      servers: detailedServers,
    };
  } catch (error) {
    const optionsError = new Error(getAxiosErrorMessage(error));
    optionsError.statusCode = error.response?.status || 503;
    throw optionsError;
  }
}

const seerrUserCache = new Map();
// Finds the Seerr user linked to this JellyGlance user's Jellyfin account (cached for 10 minutes).
async function findSeerrUserId(sourceId, user) {
  const jellyfinId = String(user?.jellyfinUser?.id || user?.jellyfinUser?.Id || (user?.authMode === "quick-connect" ? user?.id : "") || "").replace(/-/g, "");
  if (!jellyfinId) return null;
  const seerrApps = await getConnectedSeerrApps();
  const app = getSeerrAppById(seerrApps, sourceId);
  if (!app) return null;
  const cacheKey = app.instanceId || sourceId || "default";
  let cached = seerrUserCache.get(cacheKey);
  if (!cached || Date.now() - cached.at > 10 * 60 * 1000) {
    const response = await axios.get(`${cleanIntegrationUrl(app.values?.url)}/api/v1/user`, {
      timeout: 10000,
      params: { take: 1000 },
      headers: { "X-Api-Key": app.values?.secret },
    });
    cached = { at: Date.now(), users: response.data?.results || [] };
    seerrUserCache.set(cacheKey, cached);
  }
  const match = cached.users.find((entry) => String(entry.jellyfinUserId || "").replace(/-/g, "") === jellyfinId);
  return match?.id ?? null;
}

async function createSeerrMediaRequest({ sourceId, mediaType, mediaId, seasons, serverId, profileId, rootFolder, languageProfileId, tags, is4k, userId }) {
  const seerrApps = await getConnectedSeerrApps();
  const app = getSeerrAppById(seerrApps, sourceId);
  if (!app) {
    const error = new Error("Seerr source not found");
    error.statusCode = 404;
    throw error;
  }

  const normalizedType = String(mediaType || "").toLowerCase();
  const normalizedMediaId = Number(mediaId);
  if (!["movie", "tv"].includes(normalizedType) || !Number.isFinite(normalizedMediaId)) {
    const error = new Error("A valid movie or TV result is required");
    error.statusCode = 400;
    throw error;
  }

  const url = cleanIntegrationUrl(app.values?.url);
  const apiKey = app.values?.secret;
  const payload = {
    mediaType: normalizedType,
    mediaId: normalizedMediaId,
  };

  if (serverId !== undefined && serverId !== "") payload.serverId = Number(serverId);
  if (profileId !== undefined && profileId !== "") payload.profileId = Number(profileId);
  if (rootFolder) payload.rootFolder = rootFolder;
  if (languageProfileId !== undefined && languageProfileId !== "") payload.languageProfileId = Number(languageProfileId);
  if (Array.isArray(tags) && tags.length) payload.tags = tags.map(Number).filter((tag) => Number.isFinite(tag));
  if (is4k !== undefined) payload.is4k = Boolean(is4k);
  if (userId != null) payload.userId = Number(userId);

  if (normalizedType === "tv") {
    const requestedSeasons = Array.isArray(seasons) ? seasons.map(Number).filter((season) => Number.isFinite(season) && season > 0) : [];
    if (!requestedSeasons.length) {
      const error = new Error("Select at least one season to request");
      error.statusCode = 400;
      throw error;
    }
    payload.seasons = requestedSeasons;
  }

  try {
    const response = await axios.post(`${url}/api/v1/request`, payload, {
      timeout: 10000,
      headers: { "X-Api-Key": apiKey },
    });
    clearRequestCache();
    return { ok: true, source: app.name, request: response.data };
  } catch (error) {
    const requestError = new Error(getAxiosErrorMessage(error));
    requestError.statusCode = error.response?.status || 503;
    throw requestError;
  }
}

function normalizeRequestedSeasons(seasons = []) {
  return seasons.map((season) => ({
    seasonNumber: season.seasonNumber ?? season.season_number ?? season.season,
    status: season.status,
    episodes: Array.isArray(season.episodes)
      ? season.episodes.map((episode) => ({
          episodeNumber: episode.episodeNumber ?? episode.episode_number ?? episode.episode,
          title: episode.title || episode.name || `Episode ${episode.episodeNumber ?? episode.episode_number ?? ""}`.trim(),
          airDate: episode.airDate || episode.air_date || null,
        }))
      : [],
  }));
}

function normalizeCastList(mediaDetails = {}) {
  const cast =
    mediaDetails.credits?.cast ||
    mediaDetails.cast ||
    mediaDetails.actors ||
    mediaDetails.people?.cast ||
    [];

  return (Array.isArray(cast) ? cast : [])
    .map((person) => {
      const name = person.name || person.personName || person.actorName || person.originalName || "";
      const character = person.character || person.role || person.job || "";
      const profilePath = person.profilePath || person.profile_path || person.imagePath || person.avatarPath || "";
      return {
        id: person.id || person.personId || person.creditId || `${name}-${character}`,
        name,
        character,
        imageUrl: buildSeerrImageUrl(profilePath, "w185"),
      };
    })
    .filter((person) => person.name)
    .slice(0, 10);
}

async function getRequestAvailability(request, options = {}) {
  const title = String(request.title || "").trim();
  const mediaType = String(request.mediaType || "").toLowerCase();
  const year = Number(request.year);

  if (!title) {
    return { status: "Unknown", matchedItems: 0, message: "No title to compare" };
  }

  const typeFilter = mediaType === "tv" ? "Series" : mediaType === "movie" ? "Movie" : null;
  const values = [title.toLowerCase()];
  let query = `SELECT "Id", "Name", "Type", "ProductionYear", "CommunityRating" FROM jf_library_items WHERE archived=false AND lower("Name")=$1`;

  if (typeFilter) {
    values.push(typeFilter);
    query += ` AND "Type"=$${values.length}`;
  }

  if (Number.isFinite(year) && year > 0) {
    values.push(year);
    query += ` AND ("ProductionYear"=$${values.length} OR "ProductionYear" IS NULL)`;
  }

  const matches = await db.query(query, values).then((result) => result.rows || []).catch(() => []);
  if (!matches.length) {
    return { status: "Missing", matchedItems: 0, message: "No Jellyfin match" };
  }

  const ratings = options.includeRatings
    ? await getLiveItem(matches[0].Id)
        .then((liveItem) => ({
          imdb: liveItem?.CommunityRating ?? matches[0].CommunityRating ?? null,
          rottenTomatoes: liveItem?.CriticRating ?? null,
          community: liveItem?.CommunityRating ?? matches[0].CommunityRating ?? null,
          critic: liveItem?.CriticRating ?? null,
        }))
        .catch(() => ({
          imdb: matches[0].CommunityRating ?? null,
          rottenTomatoes: null,
          community: matches[0].CommunityRating ?? null,
          critic: null,
        }))
    : undefined;

  if (mediaType !== "tv" || !request.requestedSeasons?.length) {
    return { status: "Available", matchedItems: matches.length, jellyfinItemId: matches[0].Id, ...(ratings ? { ratings } : {}) };
  }

  const seriesIds = matches.map((item) => item.Id);
  const requestedEpisodes = request.requestedSeasons.reduce((count, season) => count + (season.episodes?.length || 0), 0);
  if (!requestedEpisodes) {
    return { status: "Available", matchedItems: matches.length, jellyfinItemId: matches[0].Id, ...(ratings ? { ratings } : {}) };
  }

  const conditions = [];
  const params = [];
  request.requestedSeasons.forEach((season) => {
    (season.episodes || []).forEach((episode) => {
      params.push(Number(season.seasonNumber), Number(episode.episodeNumber));
      conditions.push(`("ParentIndexNumber"=$${params.length - 1} AND "IndexNumber"=$${params.length})`);
    });
  });

  const count = conditions.length
    ? await db
        .query(
          `SELECT COUNT(*)::int AS count
           FROM jf_library_episodes
           WHERE archived=false AND "SeriesId" = ANY($${params.length + 1}::text[]) AND (${conditions.join(" OR ")})`,
          [...params, seriesIds]
        )
        .then((result) => Number(result.rows?.[0]?.count || 0))
        .catch(() => 0)
    : 0;

  if (count >= requestedEpisodes) {
    return { status: "Available", matchedItems: matches.length, availableEpisodes: count, requestedEpisodes, jellyfinItemId: matches[0].Id, ...(ratings ? { ratings } : {}) };
  }

  if (count > 0) {
    return { status: "Partially available", matchedItems: matches.length, availableEpisodes: count, requestedEpisodes, jellyfinItemId: matches[0].Id, ...(ratings ? { ratings } : {}) };
  }

  return { status: "Missing", matchedItems: matches.length, availableEpisodes: 0, requestedEpisodes, jellyfinItemId: matches[0].Id, ...(ratings ? { ratings } : {}) };
}

async function normalizeSeerrRequest(item, source, options = {}) {
  const media = item.media || item.mediaInfo || {};
  const requester = item.requestedBy || item.requestedByUser || {};
  const seerrJellyfinUserId = getNestedValue(requester, [
    "jellyfinUserId",
    "jellyfinUserID",
    "jellyfinId",
    "jellyfinID",
    "jellyfinUser.id",
    "jellyfinUser.Id",
    "jellyfinUser.userId",
    "jellyfinUser.UserId",
    "settings.jellyfinUserId",
    "settings.jellyfinUserID",
    "settings.jellyfinId",
  ]);
  const requesterName = requester.displayName || requester.username || requester.jellyfinUsername || requester.email || "Unknown user";
  const requesterCandidates = [
    seerrJellyfinUserId,
    requester.jellyfinUsername,
    requester.displayName,
    requester.username,
    requester.email,
  ]
    .filter(Boolean)
    .map((value) => String(value).trim())
    .filter(Boolean);
  const jellyfinRequester = requesterCandidates.length
    ? await db
        .query(
          `SELECT "Id", "Name", "PrimaryImageTag"
           FROM jf_users
           WHERE "Id" = ANY($1)
              OR lower("Name") = ANY($2)
           LIMIT 1`,
          [requesterCandidates, requesterCandidates.map((value) => value.toLowerCase())]
        )
        .then((result) => result.rows?.[0] || null)
        .catch(() => null)
    : null;
  const mediaDetails = options.lightweight ? {} : await fetchSeerrMediaDetails(source, media);
  const posterPath = mediaDetails.posterPath || mediaDetails.poster_path || media.posterPath || media.poster_path || null;
  const backdropPath = mediaDetails.backdropPath || mediaDetails.backdrop_path || media.backdropPath || media.backdrop_path || null;
  const releaseDate = mediaDetails.releaseDate || mediaDetails.firstAirDate || mediaDetails.release_date || mediaDetails.first_air_date || "";
  const runtime = mediaDetails.runtime || mediaDetails.episodeRunTime?.[0] || mediaDetails.episode_run_time?.[0] || null;
  const statusMap = {
    1: "Pending",
    2: "Approved",
    3: "Declined",
    4: "Failed",
    5: "Available",
  };

  const normalized = {
    id: `${source.instanceId}-${item.id}`,
    requestId: item.id,
    sourceId: source.instanceId,
    source: source.name,
    title:
      media.title ||
      media.name ||
      mediaDetails.title ||
      mediaDetails.name ||
      mediaDetails.originalTitle ||
      mediaDetails.originalName ||
      item.title ||
      item.name ||
      "Unknown request",
    mediaType: media.mediaType || item.type || item.mediaType || "media",
    status: statusMap[item.status] || item.statusLabel || item.status || "Unknown",
    requestedBy: jellyfinRequester?.Name || requesterName,
    requester: {
      id: requester.id || requester.userId || requester.jellyfinUserId || requester.jellyfinUser?.id || null,
      jellyfinUserId: jellyfinRequester?.Id || seerrJellyfinUserId || null,
      name: jellyfinRequester?.Name || requesterName,
      username: requester.username || requester.jellyfinUsername || "",
      email: requester.email || "",
      avatar: requester.avatar || requester.avatarUrl || requester.profilePicture || requester.profileImage || "",
      primaryImageTag: jellyfinRequester?.PrimaryImageTag || "",
    },
    createdAt: item.createdAt || item.updatedAt || null,
    seasons: Array.isArray(item.seasons) ? item.seasons.length : 0,
    requestedSeasons: normalizeRequestedSeasons(item.seasons || []),
    posterPath,
    posterUrl: buildSeerrImageUrl(posterPath, "w342"),
    posterUrls: buildSeerrImageUrls(posterPath),
    backdropUrl: buildSeerrImageUrl(backdropPath, "w780"),
    overview: mediaDetails.overview || mediaDetails.summary || "",
    genres: (mediaDetails.genres || []).map((genre) => genre.name || genre).filter(Boolean),
    cast: normalizeCastList(mediaDetails),
    runtime,
    rating: mediaDetails.voteAverage || mediaDetails.vote_average || mediaDetails.rating || null,
    ratings: {
      tmdb: mediaDetails.voteAverage || mediaDetails.vote_average || mediaDetails.rating || null,
      rottenTomatoes:
        getNestedValue(mediaDetails, [
          "ratings.rottenTomatoes",
          "ratings.rottenTomatoesScore",
          "ratings.criticsScore",
          "rottenTomatoesScore",
          "criticRating",
          "criticScore",
        ]) || null,
    },
    year: releaseDate.slice(0, 4),
    releaseDate,
    externalIds: {
      tmdbId: media.tmdbId || mediaDetails.id || null,
      tvdbId: media.tvdbId || mediaDetails.tvdbId || null,
      imdbId: media.imdbId || mediaDetails.imdbId || mediaDetails.imdb_id || null,
    },
    mediaId: media.id || media.mediaId || item.mediaId || null,
    serverId: item.serverId ?? null,
    profileId: item.profileId ?? null,
    rootFolder: item.rootFolder || "",
    languageProfileId: item.languageProfileId ?? null,
    is4k: Boolean(item.is4k),
    tags: Array.isArray(item.tags) ? item.tags : [],
  };

  normalized.openUrl = buildSeerrOpenUrl(source, normalized);
  normalized.availability = options.lightweight
    ? { status: "Unknown", matchedItems: 0 }
    : await getRequestAvailability(normalized, { includeRatings: options.includeRatings });

  if (options.includeRatings) {
    const [seerrRatings, omdbRatings, arrRatings] = await Promise.all([
      fetchSeerrRatings(source, normalized),
      fetchOmdbRatings(normalized),
      fetchArrRatings(normalized),
    ]);
    normalized.ratings = {
      ...normalized.ratings,
      ...(normalized.availability?.ratings || {}),
      ...omdbRatings,
      ...arrRatings,
      ...seerrRatings,
    };
  }
  return normalized;
}

function buildRequestStats(requests = []) {
  const realRequests = requests.filter((request) => request.status !== "Error");
  const now = Date.now();
  const statusCounts = realRequests.reduce((counts, request) => {
    const status = request.status || "Unknown";
    counts[status] = (counts[status] || 0) + 1;
    return counts;
  }, {});
  const requesterCounts = realRequests.reduce((counts, request) => {
    const requester = request.requestedBy || "Unknown user";
    counts[requester] = (counts[requester] || 0) + 1;
    return counts;
  }, {});
  const mediaTypeCounts = realRequests.reduce((counts, request) => {
    const mediaType = request.mediaType || "media";
    counts[mediaType] = (counts[mediaType] || 0) + 1;
    return counts;
  }, {});

  const topRequesters = Object.entries(requesterCounts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, 5);
  const mostRequestedMediaType = Object.entries(mediaTypeCounts)
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type))[0] || { type: "none", count: 0 };
  const failed = (statusCounts.Failed || 0) + requests.filter((request) => request.status === "Error").length;
  const pending = statusCounts.Pending || 0;
  const approvalQueue = realRequests
    .filter((request) => request.status === "Pending")
    .sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0))
    .slice(0, 8)
    .map((request) => ({
      id: request.id,
      title: request.title,
      requester: request.requestedBy,
      source: request.source,
      createdAt: request.createdAt,
    }));
  const perUserPending = Object.entries(
    realRequests
      .filter((request) => request.status === "Pending")
      .reduce((counts, request) => {
        const requester = request.requestedBy || "Unknown user";
        counts[requester] = (counts[requester] || 0) + 1;
        return counts;
      }, {})
  )
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, 5);
  const mediaIssues = realRequests
    .filter((request) => ["Failed", "Missing", "Partially available"].includes(request.status) || ["Missing", "Partially available"].includes(request.availability?.status))
    .slice(0, 8)
    .map((request) => ({
      id: request.id,
      title: request.title,
      status: request.status,
      availability: request.availability?.status || "Unknown",
      source: request.source,
    }));
  const trends = Array.from({ length: 7 }).map((_, offset) => {
    const date = new Date(now - (6 - offset) * 24 * 60 * 60 * 1000);
    const key = date.toISOString().slice(0, 10);
    const count = realRequests.filter((request) => String(request.createdAt || "").slice(0, 10) === key).length;
    return { date: key, count };
  });

  return {
    total: realRequests.length,
    pending,
    approved: statusCounts.Approved || 0,
    available: statusCounts.Available || 0,
    partial: statusCounts.Partial || 0,
    failed,
    badgeCount: pending + failed,
    topRequesters,
    perUserPending,
    approvalQueue,
    mediaIssues,
    trends,
    mediaTypeCounts,
    mostRequestedMediaType,
  };
}

async function buildSeerrRequests(options = {}) {
  const integrations = await getIntegrations();
  const seerrApps = (integrations.arrApps || []).filter((integration) => integration.connected && isSeerrIntegration(integration));
  const results = [];
  const { repairSeerrRequestFolders } = require("../classes/request-provider");

  for (const app of seerrApps) {
    const url = cleanIntegrationUrl(app.values?.url);
    const apiKey = app.values?.secret;
    if (!url || !apiKey) continue;

    try {
      const response = await axios.get(`${url}/api/v1/request`, {
        timeout: 15000,
        headers: { "X-Api-Key": apiKey },
        params: { take: 100, skip: 0, filter: "all", sort: "added" },
      });
      const requests = Array.isArray(response.data?.results) ? response.data.results : Array.isArray(response.data) ? response.data : [];
      if (!options.skipFolderRepair && !options.lightweight) {
        try {
          await repairSeerrRequestFolders(app, requests);
        } catch (error) {
          console.log(`[REQUESTS] Folder repair skipped for ${app.name}:`, error.message || error);
        }
      }
      results.push(...(await Promise.all(requests.map((item) => normalizeSeerrRequest(item, app, options)))));
    } catch (error) {
      results.push({
        id: `${app.instanceId}-error`,
        source: app.name,
        title: "Unable to load requests",
        mediaType: "error",
        status: "Error",
        requestedBy: getAxiosErrorMessage(error),
        createdAt: new Date().toISOString(),
      });
    }
  }

  let sortedRequests = results.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  if (options.includeInterest && !options.lightweight) {
    sortedRequests = await annotateRequestUserInterest(sortedRequests);
  }

  return {
    sources: seerrApps.map((app) => ({ name: app.name, instanceId: app.instanceId, connected: app.connected })),
    requests: sortedRequests,
    stats: buildRequestStats(sortedRequests),
    syncedAt: new Date().toISOString(),
  };
}

async function fetchSeerrRequests(options = {}) {
  const cacheKey = `${options.lightweight ? "lightweight" : "full"}:${options.includeInterest ? "interest" : "plain"}:${options.includeRatings ? "ratings" : "fast"}`;
  const existing = requestCache.get(cacheKey);
  const now = Date.now();

  if (!options.force && existing?.data && existing.expiresAt > now) {
    return cloneJson(existing.data);
  }

  if (!options.force && existing?.promise) {
    return cloneJson(await existing.promise);
  }

  const promise = buildSeerrRequests(options);
  requestCache.set(cacheKey, { ...existing, promise });

  try {
    const data = await promise;
    requestCache.set(cacheKey, { data, expiresAt: Date.now() + REQUEST_CACHE_TTL_MS });
    return cloneJson(data);
  } catch (error) {
    requestCache.delete(cacheKey);
    throw error;
  }
}

function normalizeRequestOwnerValue(value) {
  return String(value || "").trim().toLowerCase();
}

function getRequestOwnerCandidates(user = {}) {
  if (!user || user === "internal") return [];
  return [
    user.id,
    user.username,
    user.email,
    user.name,
    user.jellyfinUser?.id,
    user.jellyfinUser?.Id,
    user.jellyfinUser?.name,
    user.jellyfinUser?.Name,
    user.jellyfinUser?.username,
    user.jellyfinUser?.UserName,
  ]
    .map(normalizeRequestOwnerValue)
    .filter(Boolean);
}

function isUserRequestOwner(request, ownerCandidates = []) {
  if (!ownerCandidates.length) return false;
  const requester = request?.requester || {};
  const requestCandidates = [
    request?.requestedBy,
    requester.id,
    requester.userId,
    requester.jellyfinUserId,
    requester.name,
    requester.username,
    requester.email,
  ]
    .map(normalizeRequestOwnerValue)
    .filter(Boolean);

  return requestCandidates.some((candidate) => ownerCandidates.includes(candidate));
}

function canViewAllRequests(user) {
  return user === "internal" || ["Owner", "Admin"].includes(user?.role);
}

function filterSeerrRequestsForUser(data, user) {
  if (canViewAllRequests(user)) {
    return data;
  }

  const ownerCandidates = getRequestOwnerCandidates(user);
  const requests = (data.requests || []).filter((request) => isUserRequestOwner(request, ownerCandidates));
  return {
    ...data,
    requests,
    stats: buildRequestStats(requests),
  };
}

async function fetchSeerrRequestDetail({ sourceId, requestId }) {
  const seerrApps = await getConnectedSeerrApps();
  const app = getSeerrAppById(seerrApps, sourceId);
  if (!app) {
    const error = new Error("Seerr source not found");
    error.statusCode = 404;
    throw error;
  }

  const url = cleanIntegrationUrl(app.values?.url);
  const apiKey = app.values?.secret;
  const headers = { "X-Api-Key": apiKey };
  let item = null;

  try {
    const response = await axios.get(`${url}/api/v1/request/${encodeURIComponent(requestId)}`, {
      timeout: 10000,
      headers,
    });
    item = response.data;
  } catch (error) {
    if (![404, 405].includes(error.response?.status)) {
      const detailError = new Error(getAxiosErrorMessage(error));
      detailError.statusCode = error.response?.status || 503;
      throw detailError;
    }
  }

  if (!item) {
    const response = await axios.get(`${url}/api/v1/request`, {
      timeout: 10000,
      headers,
      params: { take: 100, skip: 0 },
    });
    const requests = Array.isArray(response.data?.results) ? response.data.results : Array.isArray(response.data) ? response.data : [];
    item = requests.find((entry) => String(entry.id) === String(requestId));
  }

  if (!item) {
    const error = new Error("Request not found");
    error.statusCode = 404;
    throw error;
  }

  return normalizeSeerrRequest(item, app, { includeRatings: true });
}

async function annotateRequestUserInterest(requests = []) {
  const jellyfinIds = [
    ...new Set(requests.map((request) => request.availability?.jellyfinItemId).filter(Boolean)),
  ];
  if (!jellyfinIds.length) return requests;

  const users = await API.getUsers(true).catch(() => []);
  const interests = new Map(jellyfinIds.map((id) => [id, { favouritedBy: [], watchlistedBy: [] }]));

  await Promise.all(
    users.map(async (user) => {
      const [favourites, watchlist] = await Promise.all([
        fetchJellyfinUserItems(user.Id, { Filters: "IsFavorite", IncludeItemTypes: "Movie,Series", Limit: 300 }).catch(() => []),
        fetchJellyfinUserItems(user.Id, { Filters: "Likes", IncludeItemTypes: "Movie,Series", Limit: 300 }).catch(() => []),
      ]);

      favourites.forEach((item) => {
        if (interests.has(item.Id)) interests.get(item.Id).favouritedBy.push(user.Name);
      });
      watchlist.forEach((item) => {
        if (interests.has(item.Id)) interests.get(item.Id).watchlistedBy.push(user.Name);
      });
    })
  );

  return requests.map((request) => ({
    ...request,
    userInterest: interests.get(request.availability?.jellyfinItemId) || { favouritedBy: [], watchlistedBy: [] },
  }));
}

async function runSeerrRequestAction({ requestId, sourceId, action }) {
  const integrations = await getIntegrations();
  const app = (integrations.arrApps || []).find((integration) => integration.instanceId === sourceId && isSeerrIntegration(integration));
  if (!app) {
    const error = new Error("Seerr source not found");
    error.statusCode = 404;
    throw error;
  }

  if (action === "approve" || action === "retry") {
    try {
      const { applyStoredFolderOverrideToRequest } = require("../classes/request-provider");
      await applyStoredFolderOverrideToRequest({
        requestId,
        sourceId,
        updateRequest: updateSeerrRequest,
        fetchRequest: fetchSeerrRequestDetail,
      });
    } catch (error) {
      console.log(`[REQUESTS] Folder override before ${action} failed:`, error.message || error);
    }
  }

  const url = cleanIntegrationUrl(app.values?.url);
  const apiKey = app.values?.secret;
  const actionPaths = {
    approve: [`/api/v1/request/${encodeURIComponent(requestId)}/approve`],
    decline: [`/api/v1/request/${encodeURIComponent(requestId)}/decline`],
    retry: [`/api/v1/request/${encodeURIComponent(requestId)}/retry`],
  };

  if (!actionPaths[action]) {
    const error = new Error("Unsupported request action");
    error.statusCode = 400;
    throw error;
  }

  let lastError;
  for (const path of actionPaths[action]) {
    try {
      const response = await axios.post(`${url}${path}`, {}, { timeout: 10000, headers: { "X-Api-Key": apiKey } });
      return { ok: true, source: app.name, action, status: response.status, data: response.data };
    } catch (error) {
      lastError = error;
    }
  }

  const error = new Error(getAxiosErrorMessage(lastError));
  error.statusCode = lastError?.response?.status || 503;
  throw error;
}

async function updateSeerrRequest({ requestId, sourceId, serverId, profileId, rootFolder, languageProfileId, tags, is4k, mediaType, seasons }) {
  const integrations = await getIntegrations();
  const app = (integrations.arrApps || []).find((integration) => integration.instanceId === sourceId && isSeerrIntegration(integration));
  if (!app) {
    const error = new Error("Seerr source not found");
    error.statusCode = 404;
    throw error;
  }

  const url = cleanIntegrationUrl(app.values?.url);
  const apiKey = app.values?.secret;
  const payload = {};
  const normalizedType = String(mediaType || "").toLowerCase();

  if (normalizedType) payload.mediaType = normalizedType;
  if (serverId !== undefined && serverId !== "") payload.serverId = Number(serverId);
  if (profileId !== undefined && profileId !== "") payload.profileId = Number(profileId);
  if (rootFolder) payload.rootFolder = rootFolder;
  if (languageProfileId !== undefined && languageProfileId !== "") payload.languageProfileId = Number(languageProfileId);
  if (Array.isArray(tags)) payload.tags = tags.map(Number).filter((tag) => Number.isFinite(tag));
  if (is4k !== undefined) payload.is4k = Boolean(is4k);
  if (normalizedType === "tv") {
    const seasonNumbers = Array.isArray(seasons)
      ? seasons.map((season) => (typeof season === "number" ? season : Number(season?.seasonNumber))).filter((season) => Number.isFinite(season) && season > 0)
      : [];
    if (!seasonNumbers.length) {
      const error = new Error("TV request updates require seasons");
      error.statusCode = 400;
      throw error;
    }
    payload.seasons = seasonNumbers;
  }

  if (!Object.keys(payload).length || (Object.keys(payload).length === 1 && payload.mediaType)) {
    const error = new Error("No request changes were provided");
    error.statusCode = 400;
    throw error;
  }

  let lastError;
  for (const path of [`/api/v1/request/${encodeURIComponent(requestId)}`, `/api/v1/request/${encodeURIComponent(requestId)}/edit`]) {
    try {
      const response = await axios.put(`${url}${path}`, payload, {
        timeout: 10000,
        headers: { "X-Api-Key": apiKey },
      });
      return { ok: true, source: app.name, status: response.status, data: response.data };
    } catch (error) {
      lastError = error;
      if (![404, 405].includes(error.response?.status)) break;
    }
  }

  const error = new Error(getAxiosErrorMessage(lastError));
  error.statusCode = lastError?.response?.status || 503;
  throw error;
}

function normalizeJellyfinMediaItem(item) {
  const mediaType = item.Type === "Series" ? "Series" : item.Type === "Episode" ? "Episode" : item.Type === "Movie" ? "Movie" : item.Type || "Media";
  const playbackTicks = Number(item.UserData?.PlaybackPositionTicks || 0);
  const runtimeTicks = Number(item.RunTimeTicks || 0);
  const progress = runtimeTicks > 0 ? Math.min(100, Math.round((playbackTicks / runtimeTicks) * 100)) : Number(item.UserData?.PlayedPercentage || 0);
  const imageId = mediaType === "Episode" && item.SeriesId ? item.SeriesId : item.Id;
  return {
    id: item.Id,
    name: item.Name || item.SeriesName || "Untitled",
    type: mediaType,
    year: item.ProductionYear || (item.PremiereDate ? String(item.PremiereDate).slice(0, 4) : null),
    overview: item.Overview || "",
    seriesName: item.SeriesName || null,
    seriesId: item.SeriesId || null,
    seasonId: item.SeasonId || null,
    seasonNumber: item.ParentIndexNumber ?? null,
    episodeNumber: item.IndexNumber ?? null,
    communityRating: item.CommunityRating || null,
    dateCreated: item.DateCreated || null,
    datePlayed: item.UserData?.LastPlayedDate || null,
    genres: Array.isArray(item.Genres) ? item.Genres : [],
    studios: Array.isArray(item.Studios) ? item.Studios.map((studio) => studio.Name || studio).filter(Boolean) : [],
    people: Array.isArray(item.People) ? item.People.slice(0, 8).map((person) => person.Name || person).filter(Boolean) : [],
    progress,
    played: Boolean(item.UserData?.Played),
    favourite: Boolean(item.UserData?.IsFavorite),
    liked: item.UserData?.Likes === true,
    imageId,
    hasPrimaryImage: Boolean(item.ImageTags?.Primary || item.PrimaryImageTag || item.SeriesPrimaryImageTag),
  };
}

async function fetchJellyfinUserItems(userId, params = {}) {
  const config = await new configClass().getConfig();
  if (config.error) {
    throw new Error(config.error);
  }

  const response = await axios.get(`${cleanIntegrationUrl(config.JF_HOST)}/Users/${encodeURIComponent(userId)}/Items`, {
    timeout: 12000,
    headers: {
      ...mediaServerAuthHeaders(config.JF_API_KEY),
      "User-Agent": "JellyGlance/1.0.6",
    },
    params: {
      Recursive: true,
      Limit: 24,
      Fields: "DateCreated,Genres,ProductionYear,SeriesName,ParentIndexNumber,IndexNumber,ImageTags,PrimaryImageTag,SeriesPrimaryImageTag,RunTimeTicks,UserData",
      ExcludeLocationTypes: "Virtual",
      ...params,
    },
  });

  return Array.isArray(response.data?.Items) ? response.data.Items : [];
}

async function jellyfinRequest(path, options = {}) {
  const config = await new configClass().getConfig();
  if (config.error) {
    throw new Error(config.error);
  }

  const jellyfinBase = cleanIntegrationUrl(config.JF_HOST);
  if (!jellyfinBase) {
    throw new Error("Jellyfin host is not configured");
  }
  return axios({
    timeout: 12000,
    method: options.method || "get",
    url: joinSafeHttpUrl(jellyfinBase, path),
    headers: {
      ...mediaServerAuthHeaders(config.JF_API_KEY),
      "User-Agent": "JellyGlance/1.0.6",
      ...(options.headers || {}),
    },
    params: options.params,
    data: options.data,
  });
}

const JELLYFIN_TRIGGER_TYPES = new Set(["DailyTrigger", "WeeklyTrigger", "IntervalTrigger", "StartupTrigger"]);
const JELLYFIN_WEEKDAYS = new Set(["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]);
const JELLYFIN_TICKS_PER_SECOND = 10000000;
const JELLYFIN_TICKS_PER_MINUTE = JELLYFIN_TICKS_PER_SECOND * 60;
const JELLYFIN_TICKS_PER_DAY = JELLYFIN_TICKS_PER_MINUTE * 60 * 24;

function jellyfinTriggerKind(type) {
  const value = String(type || "").split(".").pop();
  if (/WeeklyTrigger/i.test(value)) return "WeeklyTrigger";
  if (/IntervalTrigger/i.test(value)) return "IntervalTrigger";
  if (/StartupTrigger/i.test(value)) return "StartupTrigger";
  if (/DailyTrigger/i.test(value)) return "DailyTrigger";
  return "";
}

function jellyfinWeekday(value) {
  const asString = String(value ?? "");
  if (JELLYFIN_WEEKDAYS.has(asString)) return asString;
  const index = Number(value);
  if (Number.isInteger(index) && index >= 0 && index <= 6) {
    return ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][index];
  }
  return "";
}

function normalizeJellyfinTrigger(trigger = {}) {
  return {
    Type: trigger.Type || trigger.type || "",
    TimeOfDayTicks: trigger.TimeOfDayTicks ?? trigger.timeOfDayTicks ?? null,
    DayOfWeek: jellyfinWeekday(trigger.DayOfWeek ?? trigger.dayOfWeek) || null,
    IntervalTicks: trigger.IntervalTicks ?? trigger.intervalTicks ?? null,
    MaxRuntimeTicks: trigger.MaxRuntimeTicks ?? trigger.maxRuntimeTicks ?? null,
  };
}

function normalizeTriggerForJellyfin(trigger = {}) {
  const type = jellyfinTriggerKind(trigger.Type || trigger.type);
  if (!JELLYFIN_TRIGGER_TYPES.has(type)) return null;

  const payload = { Type: type };
  const maxRuntime = Number(trigger.MaxRuntimeTicks ?? trigger.maxRuntimeTicks);
  if (Number.isFinite(maxRuntime) && maxRuntime > 0) {
    payload.MaxRuntimeTicks = Math.round(maxRuntime);
  }

  if (type === "StartupTrigger") {
    return payload;
  }

  if (type === "IntervalTrigger") {
    const interval = Number(trigger.IntervalTicks ?? trigger.intervalTicks);
    if (!Number.isFinite(interval) || interval < JELLYFIN_TICKS_PER_MINUTE) return null;
    payload.IntervalTicks = Math.round(interval);
    return payload;
  }

  const timeOfDay = Number(trigger.TimeOfDayTicks ?? trigger.timeOfDayTicks ?? 0);
  if (!Number.isFinite(timeOfDay) || timeOfDay < 0 || timeOfDay >= JELLYFIN_TICKS_PER_DAY) return null;
  payload.TimeOfDayTicks = Math.round(timeOfDay);

  if (type === "WeeklyTrigger") {
    const day = jellyfinWeekday(trigger.DayOfWeek ?? trigger.dayOfWeek);
    if (!day) return null;
    payload.DayOfWeek = day;
  }

  return payload;
}

function normalizeJellyfinTask(task = {}) {
  const triggers = task.Triggers || task.triggers || [];
  return {
    id: task.Id || task.Key || task.Name,
    key: task.Key || task.Id || task.Name,
    name: task.Name || task.Key || "Scheduled task",
    description: task.Description || "",
    category: task.Category || "Jellyfin",
    state: task.State || "Idle",
    lastExecutionResult: task.LastExecutionResult || null,
    triggers: Array.isArray(triggers) ? triggers.map(normalizeJellyfinTrigger) : [],
  };
}

function normalizeJellyfinDevice(device = {}) {
  return {
    id: device.Id || device.DeviceId || device.AccessToken || device.Name,
    name: device.Name || device.DeviceName || "Unknown device",
    appName: device.AppName || device.Client || "Unknown app",
    appVersion: device.AppVersion || "",
    lastUserName: device.LastUserName || device.UserName || "",
    lastUserId: device.LastUserId || device.UserId || "",
    dateLastActivity: device.DateLastActivity || device.LastActivityDate || null,
    capabilities: device.Capabilities || null,
  };
}

function normalizeJellyfinPlugin(plugin = {}) {
  const status = plugin.Status || plugin.State || (plugin.Enabled === false ? "Disabled" : "Enabled");
  const id = plugin.Id || plugin.Guid || plugin.Name;
  return {
    id,
    name: plugin.Name || plugin.AssemblyFileName || "Unknown plugin",
    version: plugin.Version || plugin.Versions?.[0]?.version || "",
    description: plugin.Description || plugin.Overview || "",
    category: plugin.Category || "",
    status,
    enabled: plugin.Enabled !== false && !String(status).toLowerCase().includes("disabled"),
    canUninstall: plugin.CanUninstall === true,
    configurationFileName: plugin.ConfigurationFileName || "",
    imageUrl: plugin.imageUrl || plugin.ImageUrl || "",
  };
}

function matchJellyfinPluginPackage(plugin, packages = []) {
  const pluginId = String(plugin.Id || plugin.Guid || plugin.id || "").toLowerCase();
  const pluginName = String(plugin.Name || plugin.name || "").trim().toLowerCase();
  return packages.find((entry) => {
    const packageId = String(entry.guid || entry.Guid || entry.id || "").toLowerCase();
    const packageName = String(entry.name || entry.Name || "").trim().toLowerCase();
    return (pluginId && packageId && pluginId === packageId) || (pluginName && packageName && pluginName === packageName);
  });
}

function buildPluginImageProxyUrl(imageUrl) {
  return imageUrl ? `/proxy/Plugins/Images/?url=${encodeURIComponent(imageUrl)}` : "";
}

async function buildServerManagementStatus() {
  const [systemInfoResponse, tasksResponse] = await Promise.all([
    jellyfinRequest("/System/Info").catch((error) => ({ error })),
    jellyfinRequest("/ScheduledTasks").catch((error) => ({ error })),
  ]);

  const systemInfo = systemInfoResponse.error ? null : systemInfoResponse.data;
  const jellyfinTasks = Array.isArray(tasksResponse.data) ? tasksResponse.data.map(normalizeJellyfinTask) : [];

  return {
    checkedAt: new Date().toISOString(),
    jellyfin: {
      ok: Boolean(systemInfo),
      name: systemInfo?.ServerName || "Jellyfin",
      version: systemInfo?.Version || "",
      id: systemInfo?.Id || "",
      operatingSystem: systemInfo?.OperatingSystem || "",
      startupWizardCompleted: systemInfo?.StartupWizardCompleted ?? null,
      error: systemInfoResponse.error ? getAxiosErrorMessage(systemInfoResponse.error) : "",
    },
    jellyfinTasks,
  };
}

function dedupeMediaItems(items = []) {
  const seen = new Set();
  return items.filter((item) => {
    if (!item?.Id || seen.has(item.Id)) return false;
    seen.add(item.Id);
    return true;
  });
}

function splitMediaTypes(items = []) {
  return {
    movies: items.filter((item) => item.type === "Movie"),
    shows: items.filter((item) => item.type === "Series"),
    episodes: items.filter((item) => item.type === "Episode"),
  };
}

function tallyValues(items = [], getter, limit = 8) {
  const counts = new Map();
  items.forEach((item) => {
    const values = getter(item);
    (Array.isArray(values) ? values : [values]).filter(Boolean).forEach((value) => {
      counts.set(value, (counts.get(value) || 0) + 1);
    });
  });
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, limit);
}

async function queryRecentlyWatchedRows(userId, { includeEpisodeMetadata = true } = {}) {
  const tableName = includeEpisodeMetadata ? "jf_playback_activity_with_metadata" : "jf_playback_activity";
  const episodeColumns = includeEpisodeMetadata
    ? `a."SeasonNumber", a."EpisodeNumber",`
    : `NULL::integer AS "SeasonNumber", NULL::integer AS "EpisodeNumber",`;

  const result = await db.query(
    `
      SELECT DISTINCT ON (COALESCE(a."EpisodeId", a."NowPlayingItemId"))
        COALESCE(a."EpisodeId", a."NowPlayingItemId") AS "Id",
        a."NowPlayingItemId",
        a."NowPlayingItemName",
        a."EpisodeId",
        CASE WHEN a."EpisodeId" IS NOT NULL THEN a."NowPlayingItemId" ELSE NULL END AS "SeriesId",
        a."SeriesName",
        ${episodeColumns}
        a."ActivityDateInserted",
        i."Type",
        i."ProductionYear",
        i."Genres"
      FROM ${tableName} a
      LEFT JOIN jf_library_items i ON i."Id" = a."NowPlayingItemId"
      WHERE a."UserId" = $1
      ORDER BY COALESCE(a."EpisodeId", a."NowPlayingItemId"), a."ActivityDateInserted" DESC
    `,
    [userId]
  );

  return result.rows || [];
}

async function fetchRecentlyWatched(userId) {
  let rows = [];

  try {
    rows = await queryRecentlyWatchedRows(userId, { includeEpisodeMetadata: true });
    if (!rows.length) {
      rows = await queryRecentlyWatchedRows(userId, { includeEpisodeMetadata: false });
    }
  } catch (error) {
    console.warn("Fetch recently watched metadata failed, falling back to playback table:", error.message);
    rows = await queryRecentlyWatchedRows(userId, { includeEpisodeMetadata: false }).catch((fallbackError) => {
      console.error("Fetch recently watched failed:", fallbackError);
      return [];
    });
  }

  return rows
    .sort((a, b) => new Date(b.ActivityDateInserted || 0) - new Date(a.ActivityDateInserted || 0))
    .slice(0, 10)
    .map((item) => ({
      id: item.Id,
      name: item.NowPlayingItemName || item.SeriesName || "Untitled",
      type: item.EpisodeId ? "Episode" : item.Type || "Media",
      seriesName: item.SeriesName || null,
      seriesId: item.SeriesId || null,
      seasonNumber: item.SeasonNumber ?? null,
      episodeNumber: item.EpisodeNumber ?? null,
      year: item.ProductionYear || null,
      datePlayed: item.ActivityDateInserted || null,
      genres: (() => {
        try {
          return Array.isArray(item.Genres) ? item.Genres : JSON.parse(item.Genres || "[]");
        } catch {
          return [];
        }
      })(),
      imageId: item.NowPlayingItemId,
      hasPrimaryImage: true,
    }));
}

async function fetchNextEpisodes(userId, seriesIds = []) {
  const uniqueSeriesIds = [...new Set(seriesIds.filter(Boolean))];
  const baseParams = {
    UserId: userId,
    Limit: 24,
    Fields: "DateCreated,Genres,Overview,CommunityRating,PremiereDate,ProductionYear,SeriesName,SeriesId,SeasonId,ParentIndexNumber,IndexNumber,ImageTags,PrimaryImageTag,SeriesPrimaryImageTag,RunTimeTicks,UserData",
  };

  const scopedResponse = uniqueSeriesIds.length
    ? await jellyfinRequest("/Shows/NextUp", {
        params: {
          ...baseParams,
          SeriesId: uniqueSeriesIds.join(","),
        },
      }).catch(() => null)
    : null;

  let items = Array.isArray(scopedResponse?.data?.Items) ? scopedResponse.data.Items : [];

  if (!items.length) {
    const fallbackResponse = await jellyfinRequest("/Shows/NextUp", {
      params: baseParams,
    }).catch(() => null);
    items = Array.isArray(fallbackResponse?.data?.Items) ? fallbackResponse.data.Items : [];
  }

  return dedupeMediaItems(items).slice(0, 18).map(normalizeJellyfinMediaItem);
}

async function buildRecommendations(userId, seedItems = []) {
  const topGenres = tallyValues(seedItems, (item) => item.genres, 4).map((genre) => genre.name);
  if (!topGenres.length) return [];

  const rows = await db
    .query(
      `SELECT "Id", "Name", "Type", "ProductionYear", "Genres", "DateCreated"
       FROM jf_library_items
       WHERE archived=false AND "Type" IN ('Movie', 'Series')
       ORDER BY "DateCreated" DESC
       LIMIT 500`
    )
    .then((result) => result.rows || [])
    .catch(() => []);

  const watchedIds = new Set(
    await db
      .query(`SELECT DISTINCT "NowPlayingItemId" FROM jf_playback_activity WHERE "UserId"=$1`, [userId])
      .then((result) => (result.rows || []).map((row) => row.NowPlayingItemId))
      .catch(() => [])
  );
  const seedIds = new Set(seedItems.map((item) => item.id));

  return rows
    .map((row) => {
      let genres = [];
      try {
        genres = Array.isArray(row.Genres) ? row.Genres : JSON.parse(row.Genres || "[]");
      } catch {
        genres = [];
      }
      const score = genres.filter((genre) => topGenres.includes(genre)).length;
      return { row, genres, score };
    })
    .filter(({ row, score }) => score > 0 && !watchedIds.has(row.Id) && !seedIds.has(row.Id))
    .sort((a, b) => b.score - a.score || new Date(b.row.DateCreated || 0) - new Date(a.row.DateCreated || 0))
    .slice(0, 12)
    .map(({ row, genres }) => ({
      id: row.Id,
      name: row.Name,
      type: row.Type,
      year: row.ProductionYear,
      genres,
      imageId: row.Id,
      hasPrimaryImage: true,
      reason: genres.find((genre) => topGenres.includes(genre)) || topGenres[0],
    }));
}

async function fetchUserMediaNetwork(userId, favourites = [], watchlist = []) {
  const users = await API.getUsers(true).catch(() => []);
  const otherUsers = users.filter((user) => user.Id && user.Id !== userId);

  const familyResults = await Promise.all(
    otherUsers.map((user) =>
      fetchJellyfinUserItems(user.Id, {
        Filters: "Likes",
        IncludeItemTypes: "Movie,Series",
        SortBy: "DateCreated,SortName",
        SortOrder: "Descending",
        Limit: 48,
      })
        .then((items) => ({ user, items: items.map(normalizeJellyfinMediaItem) }))
        .catch(() => ({ user, items: [] }))
    )
  );

  const sharedLookup = new Map();
  [...favourites, ...watchlist].forEach((item) => {
    familyResults.forEach(({ user, items }) => {
      if (items.some((candidate) => candidate.id === item.id)) {
        const current = sharedLookup.get(item.id) || { ...item, users: [] };
        current.users.push(user.Name);
        sharedLookup.set(item.id, current);
      }
    });
  });

  const familyLookup = new Map();
  familyResults.forEach(({ user, items }) => {
    items.forEach((item) => {
      const current = familyLookup.get(item.id) || { ...item, users: [] };
      current.users.push(user.Name);
      familyLookup.set(item.id, current);
    });
  });

  return {
    sharedFavourites: [...sharedLookup.values()].sort((a, b) => b.users.length - a.users.length).slice(0, 12),
    familyWatchlist: splitMediaTypes([...familyLookup.values()].sort((a, b) => b.users.length - a.users.length).slice(0, 24)),
  };
}

const USER_MEDIA_LISTS_CACHE_TTL_MS = 2 * 60 * 1000;
const userMediaListsCache = new Map();
const userMediaListsInflight = new Map();

function clearUserMediaListsCache(userId) {
  if (!userId) return;
  for (const key of [...userMediaListsCache.keys()]) {
    if (key === userId || key.startsWith(`${userId}:`)) userMediaListsCache.delete(key);
  }
  for (const key of [...userMediaListsInflight.keys()]) {
    if (key === userId || key.startsWith(`${userId}:`)) userMediaListsInflight.delete(key);
  }
}

async function fetchUserMediaLists(userId, options = {}) {
  const includeNetwork = options.includeNetwork === true;
  const includeRecommendations = options.includeRecommendations === true;
  const includeItemTypes = "Movie,Series,Episode";
  const [favourites, jellyfinWatchlist, taggedWatchlist, watchlistContainers, continueWatching, recentlyWatched] = await Promise.all([
    fetchJellyfinUserItems(userId, {
      Filters: "IsFavorite",
      IncludeItemTypes: includeItemTypes,
      SortBy: "DateCreated,SortName",
      SortOrder: "Descending",
      Limit: 24,
    }).catch(() => []),
    fetchJellyfinUserItems(userId, {
      Filters: "Likes",
      IncludeItemTypes: "Movie,Series",
      SortBy: "DateCreated,SortName",
      SortOrder: "Descending",
      Limit: 48,
    }).catch(() => []),
    fetchJellyfinUserItems(userId, {
      Tags: "watchlist,Watchlist",
      IncludeItemTypes: includeItemTypes,
      SortBy: "DateCreated,SortName",
      SortOrder: "Descending",
      Limit: 24,
    }).catch(() => []),
    fetchJellyfinUserItems(userId, {
      SearchTerm: "Watchlist",
      IncludeItemTypes: "Playlist,BoxSet",
      SortBy: "SortName",
      SortOrder: "Ascending",
      Limit: 10,
    }).catch(() => []),
    fetchJellyfinUserItems(userId, {
      Filters: "IsResumable",
      IncludeItemTypes: "Movie,Episode",
      SortBy: "DatePlayed",
      SortOrder: "Descending",
      Limit: 24,
    })
      .then((items) => items.map(normalizeJellyfinMediaItem))
      .catch(() => []),
    fetchRecentlyWatched(userId),
  ]);

  const containerItems = watchlistContainers.length
    ? (
        await Promise.all(
          watchlistContainers.map((container) =>
            fetchJellyfinUserItems(userId, {
              ParentId: container.Id,
              IncludeItemTypes: includeItemTypes,
              SortBy: "DateCreated,SortName",
              SortOrder: "Descending",
              Limit: 24,
            }).catch(() => [])
          )
        )
      ).flat()
    : [];

  const watchlist = dedupeMediaItems([...jellyfinWatchlist, ...taggedWatchlist, ...containerItems]).slice(0, 48).map(normalizeJellyfinMediaItem);
  const normalizedFavourites = dedupeMediaItems(favourites).slice(0, 24).map(normalizeJellyfinMediaItem);
  const watchlistedSeriesIds = watchlist
    .map((item) => (item.type === "Series" ? item.id : item.seriesId))
    .filter(Boolean);
  const contextualSeriesIds = [...watchlist, ...continueWatching, ...recentlyWatched]
    .map((item) => (item.type === "Series" ? item.id : item.type === "Episode" ? item.seriesId || item.imageId : null))
    .filter(Boolean);
  const [nextEpisodes, recommendations, mediaNetwork] = await Promise.all([
    fetchNextEpisodes(userId, watchlistedSeriesIds.length ? watchlistedSeriesIds : contextualSeriesIds),
    includeRecommendations ? buildRecommendations(userId, watchlist) : Promise.resolve([]),
    includeNetwork ? fetchUserMediaNetwork(userId, normalizedFavourites, watchlist) : Promise.resolve({ sharedFavourites: [], familyWatchlist: splitMediaTypes([]) }),
  ]);
  const allTasteItems = [...normalizedFavourites, ...watchlist, ...recentlyWatched];
  const staleThreshold = Date.now() - 30 * 24 * 60 * 60 * 1000;

  return {
    userId,
    favourites: normalizedFavourites,
    watchlist,
    watchlistByType: splitMediaTypes(watchlist),
    continueWatching,
    recentlyWatched,
    nextEpisodes,
    recommendations,
    staleWatchlist: watchlist.filter((item) => item.dateCreated && new Date(item.dateCreated).getTime() < staleThreshold),
    libraryGaps: nextEpisodes.filter((item) => item.type === "Episode"),
    taste: {
      genres: tallyValues(allTasteItems, (item) => item.genres),
      actors: tallyValues(allTasteItems, (item) => item.people),
      studios: tallyValues(allTasteItems, (item) => item.studios),
    },
    ...mediaNetwork,
    syncedAt: new Date().toISOString(),
  };
}

async function runJellyfinUserMediaAction(userId, itemId, action) {
  const encodedUserId = encodeURIComponent(userId);
  const encodedItemId = encodeURIComponent(itemId);
  const actionMap = {
    addWatchlist: { method: "post", path: `/Users/${encodedUserId}/Items/${encodedItemId}/Rating`, params: { likes: true } },
    removeWatchlist: { method: "delete", path: `/Users/${encodedUserId}/Items/${encodedItemId}/Rating` },
    favourite: { method: "post", path: `/Users/${encodedUserId}/FavoriteItems/${encodedItemId}` },
    unfavourite: { method: "delete", path: `/Users/${encodedUserId}/FavoriteItems/${encodedItemId}` },
    markWatched: { method: "post", path: `/Users/${encodedUserId}/PlayedItems/${encodedItemId}` },
    markUnwatched: { method: "delete", path: `/Users/${encodedUserId}/PlayedItems/${encodedItemId}` },
  };

  const request = actionMap[action];
  if (!request) {
    const error = new Error("Unsupported media action");
    error.statusCode = 400;
    throw error;
  }

  await jellyfinRequest(request.path, { method: request.method, params: request.params });
  return { ok: true, action, userId, itemId };
}

async function testOidcDiscovery(issuerUrl) {
  const normalizedIssuer = normalizeIssuerUrl(issuerUrl);
  if (!normalizedIssuer) {
    return { isValid: false, errorMessage: "OIDC issuer URL is required" };
  }

  try {
    const response = await safeHttpGet(normalizedIssuer, "/.well-known/openid-configuration", { timeout: 8000 });
    const discovery = response?.data || {};
    const hasRequiredEndpoints = discovery.authorization_endpoint && discovery.token_endpoint && discovery.issuer;

    if (!hasRequiredEndpoints) {
      return { isValid: false, errorMessage: "OIDC discovery document is missing required endpoints" };
    }

    return {
      isValid: true,
      issuerUrl: normalizedIssuer,
      discovery: {
        issuer: discovery.issuer,
        authorization_endpoint: discovery.authorization_endpoint,
        token_endpoint: discovery.token_endpoint,
        userinfo_endpoint: discovery.userinfo_endpoint,
        jwks_uri: discovery.jwks_uri,
      },
    };
  } catch (error) {
    return {
      isValid: false,
      errorMessage: `Unable to reach OIDC discovery: ${error?.response?.status || error.message}`,
    };
  }
}

function firstProviderId(providerIds, names) {
  const normalized = providerIds || {};
  const entries = Object.entries(normalized);
  for (const name of names) {
    const direct = normalized[name];
    if (direct) return direct;
    const match = entries.find(([key]) => key.toLowerCase() === name.toLowerCase());
    if (match?.[1]) return match[1];
  }
  return null;
}

async function getLiveItem(itemId) {
  if (!itemId) return null;
  try {
    const items = await API.getItemsByID({ ids: itemId, params: { limit: 1, recursive: true } });
    return Array.isArray(items) ? items[0] || null : null;
  } catch (error) {
    console.log("[ITEM-DETAILS] Jellyfin enrichment failed:", error?.message || error);
    return null;
  }
}

async function getArrItemByProvider(app, providerType, providerId) {
  const url = cleanIntegrationUrl(app?.values?.url);
  const apiKey = app?.values?.secret;
  if (!url || !apiKey || !providerId) return null;

  const apiPath = providerType === "movie" ? "/api/v3/movie" : "/api/v3/series";
  const providerKey = providerType === "movie" ? "tmdbId" : "tvdbId";

  try {
    const direct = await safeHttpGet(url, apiPath, {
      timeout: 10000,
      headers: { "X-Api-Key": apiKey },
      params: { [providerKey]: providerId },
    });
    const directData = Array.isArray(direct.data) ? direct.data[0] : direct.data;
    if (directData?.titleSlug || directData?.id) return directData;
  } catch (error) {
    if (!error?.response || error.response.status >= 500) {
      console.log(`[ITEM-DETAILS] ${app.name} direct lookup failed:`, error?.message || error);
    }
  }

  try {
    const response = await safeHttpGet(url, apiPath, { // codeql[js/request-forgery]
      timeout: 10000,
      headers: { "X-Api-Key": apiKey },
    });
    const allItems = Array.isArray(response.data) ? response.data : [];
    return allItems.find((item) => String(item?.[providerKey]) === String(providerId)) || null;
  } catch (error) {
    console.log(`[ITEM-DETAILS] ${app.name} library lookup failed:`, error?.message || error);
    return null;
  }
}

async function getArrLinks(item, liveItem, seriesLiveItem) {
  const integrations = await getIntegrations();
  const apps = integrations.arrApps?.filter((app) => app.connected) || [];
  const links = [];

  const radarr = apps.find((app) => String(app.slug || app.name).toLowerCase().includes("radarr"));
  const sonarr = apps.find((app) => String(app.slug || app.name).toLowerCase().includes("sonarr"));

  if (radarr && item.Type === "Movie") {
    const tmdbId = firstProviderId(liveItem?.ProviderIds, ["Tmdb", "TMDb", "TheMovieDb"]);
    const match = await getArrItemByProvider(radarr, "movie", tmdbId);
    const base = cleanIntegrationUrl(radarr.values?.url);
    links.push({
      name: "Radarr",
      type: "movie",
      url: match?.titleSlug ? `${base}/movie/${match.titleSlug}` : `${base}/add/new?term=${encodeURIComponent(tmdbId ? `tmdb:${tmdbId}` : item.Name || "")}`,
      matched: Boolean(match),
    });
  }

  if (sonarr && ["Series", "Season", "Episode"].includes(item.Type)) {
    const providerIds = seriesLiveItem?.ProviderIds || liveItem?.ProviderIds;
    const tvdbId = firstProviderId(providerIds, ["Tvdb", "TVDB", "TheTVDB"]);
    const match = await getArrItemByProvider(sonarr, "series", tvdbId);
    const base = cleanIntegrationUrl(sonarr.values?.url);
    links.push({
      name: "Sonarr",
      type: "series",
      url: match?.titleSlug ? `${base}/series/${match.titleSlug}` : `${base}/add/new?term=${encodeURIComponent(tvdbId ? `tvdb:${tvdbId}` : item.SeriesName || item.Name || "")}`,
      matched: Boolean(match),
    });
  }

  return links;
}

function buildJellyfinItemUrl(config, itemId) {
  const host = cleanIntegrationUrl(config?.settings?.EXTERNAL_URL || config?.JF_HOST || "");
  if (!host || !itemId) return null;
  const serverId = config?.settings?.ServerID ? `&serverId=${encodeURIComponent(config.settings.ServerID)}` : "";
  return `${host}/web/index.html#!/${config.IS_JELLYFIN ? "details" : "item"}?id=${encodeURIComponent(itemId)}${serverId}`;
}

async function enrichItemDetails(rows) {
  const config = await new configClass().getConfig();
  return Promise.all(
    rows.map(async (item) => {
      const itemId = item.EpisodeId || item.Id;
      const liveItem = await getLiveItem(itemId);
      const seriesLiveItem =
        item.SeriesId && item.SeriesId !== itemId && ["Episode", "Season"].includes(item.Type) ? await getLiveItem(item.SeriesId) : null;
      const providerIds = liveItem?.ProviderIds || {};
      const seriesProviderIds = seriesLiveItem?.ProviderIds || null;
      const arrLinks = await getArrLinks(item, liveItem, seriesLiveItem);

      return {
        ...item,
        Overview: liveItem?.Overview || seriesLiveItem?.Overview || item.Overview || null,
        ProviderIds: providerIds,
        SeriesProviderIds: seriesProviderIds,
        ExternalUrls: liveItem?.ExternalUrls || [],
        CriticRating: liveItem?.CriticRating ?? item.CriticRating ?? null,
        CommunityRating: liveItem?.CommunityRating ?? item.CommunityRating ?? null,
        OfficialRating: liveItem?.OfficialRating ?? item.OfficialRating ?? null,
        Studios: liveItem?.Studios || seriesLiveItem?.Studios || [],
        Tags: liveItem?.Tags || [],
        ArrLinks: arrLinks,
        JellyfinUrl: buildJellyfinItemUrl(config, itemId),
      };
    })
  );
}

//consts
const groupedSortMap = [
  { field: "UserName", column: "a.UserName" },
  { field: "RemoteEndPoint", column: "a.RemoteEndPoint" },
  { field: "NowPlayingItemName", column: "FullName" },
  { field: "Client", column: "a.Client" },
  { field: "DeviceName", column: "a.DeviceName" },
  { field: "ActivityDateInserted", column: "a.ActivityDateInserted" },
  { field: "PlaybackDuration", column: `COALESCE(ar."TotalDuration", a."PlaybackDuration")` },
  { field: "TotalPlays", column: `COALESCE("TotalPlays",1)` },
  { field: "PlayMethod", column: "a.PlayMethod" },
];

const unGroupedSortMap = [
  { field: "UserName", column: "a.UserName" },
  { field: "RemoteEndPoint", column: "a.RemoteEndPoint" },
  { field: "NowPlayingItemName", column: "FullName" },
  { field: "Client", column: "a.Client" },
  { field: "DeviceName", column: "a.DeviceName" },
  { field: "ActivityDateInserted", column: "a.ActivityDateInserted" },
  { field: "PlaybackDuration", column: "a.PlaybackDuration" },
  { field: "PlayMethod", column: "a.PlayMethod" },
];

const filterFields = [
  { field: "UserName", column: `LOWER(a."UserName")` },
  { field: "RemoteEndPoint", column: `LOWER(a."RemoteEndPoint")` },
  {
    field: "NowPlayingItemName",
    column: `LOWER(
          CASE 
            WHEN a."SeriesName" is null THEN a."NowPlayingItemName"
            ELSE CONCAT(a."SeriesName" , ' : S' , a."SeasonNumber" , 'E' , a."EpisodeNumber" , ' - ' , a."NowPlayingItemName")
          END 
          )`,
  },
  { field: "Client", column: `LOWER(a."Client")` },
  { field: "DeviceName", column: `LOWER(a."DeviceName")` },
  { field: "ActivityDateInserted", column: "a.ActivityDateInserted", isColumn: true },
  { field: "PlaybackDuration", column: `a.PlaybackDuration`, isColumn: true, applyToCTE: true },
  { field: "TotalPlays", column: `COALESCE("TotalPlays",1)` },
  { field: "PlayMethod", column: `LOWER(a."PlayMethod")` },
  { field: "ParentId", column: "a.ParentId", isColumn: true },
];

//Functions
function groupRecentlyAdded(rows) {
  const groupedResults = {};
  rows.forEach((row) => {
    if (row.Type != "Movie") {
      const key = row.SeriesId + row.SeasonId;
      if (groupedResults[key]) {
        groupedResults[key].NewEpisodeCount++;
      } else {
        groupedResults[key] = { ...row };
        if (row.Type != "Series" && row.Type != "Movie") {
          groupedResults[key].NewEpisodeCount = 1;
        }
      }
    } else {
      groupedResults[row.Id] = {
        ...row,
      };
    }
  });

  return Object.values(groupedResults);
}

async function purgeLibraryItems(id, withActivity, purgeAll = false) {
  let items_query = `select * from jf_library_items where "ParentId"=$1`;

  const { rows: items } = await db.query(items_query, [id]);
  let seasonIds = [];
  let episodeIds = [];

  for (const item of items) {
    let season_query = `select * from jf_library_seasons where "SeriesId"=$1`;
    if (!item.archived && !purgeAll) {
      season_query += " and archived=true";
    }
    const { rows: seasons } = await db.query(season_query, [item.Id]);
    seasonIds.push(...seasons.map((item) => item.Id));
    if (seasons.length > 0) {
      for (const season of seasons) {
        let episode_query = `select * from jf_library_episodes where "SeasonId"=$1`;
        if (!item.archived && !season.archived && !purgeAll) {
          episode_query += " and archived=true";
        }
        const { rows: episodes } = await db.query(episode_query, [season.Id]);
        episodeIds.push(...episodes.map((item) => item.Id));
      }
    } else {
      let episode_query = `select * from jf_library_episodes where "SeriesId"=$1`;
      if (!item.archived && !purgeAll) {
        episode_query += " and archived=true";
      }
      const { rows: episodes } = await db.query(episode_query, [item.Id]);
      episodeIds.push(...episodes.map((item) => item.Id));
    }
  }

  if (episodeIds.length > 0) {
    await db.deleteBulk("jf_library_episodes", episodeIds);
  }

  if (seasonIds.length > 0) {
    await db.deleteBulk("jf_library_seasons", seasonIds);
  }

  items_query = items_query.replace("select *", "delete");
  if (!purgeAll) {
    items_query += ` and archived=true`;
  }
  await db.query(items_query, [id]);

  if (withActivity) {
    const params = [];
    const clauses = [];
    if (episodeIds.length > 0) {
      params.push(episodeIds);
      clauses.push(`"EpisodeId" = ANY($${params.length}::text[])`);
    }
    if (seasonIds.length > 0) {
      params.push(seasonIds);
      clauses.push(`"SeasonId" = ANY($${params.length}::text[])`);
    }
    params.push(id);
    clauses.push(`"NowPlayingItemId" = $${params.length}`);
    await db.query(`DELETE FROM jf_playback_activity WHERE ${clauses.join(" OR ")}`, params);
  }
  await db.flushMaterializedViewRefreshes();
}

//////////////////////////////
router.get("/health", async (req, res) => {
  try {
    res.send(await buildHealthStatus());
  } catch (error) {
    console.error("Health check failed:", error);
    res.status(503).send({ error: "Unable to build health dashboard" });
  }
});

router.get("/home/operations", async (req, res) => {
  try {
    const [requestsResult, healthResult, maintainerrResult, digestResult, storageResult, jobsResult] = await Promise.allSettled([
      fetchSeerrRequests({ force: req.query?.forceRequests === "true" }),
      buildHealthStatus(),
      (async () => {
        const integration = await getConnectedMaintainerrIntegration();
        if (!integration) return null;
        return fetchMaintainerrBundle(integration);
      })(),
      buildOpsDigest(),
      buildLibraryStorage(),
      buildServerManagementStatus(),
    ]);

    const jellyfinTasks = jobsResult.status === "fulfilled" ? jobsResult.value?.jellyfinTasks || [] : [];
    const runningJobs = jellyfinTasks.filter((task) => String(task.state || "").toLowerCase().includes("run"));

    res.send({
      requests:
        requestsResult.status === "fulfilled"
          ? enrichRequestPayload(filterSeerrRequestsForUser(requestsResult.value, req.user))
          : null,
      health: healthResult.status === "fulfilled" ? healthResult.value : null,
      maintainerr: maintainerrResult.status === "fulfilled" ? maintainerrResult.value : null,
      digest: digestResult.status === "fulfilled" ? digestResult.value : null,
      storage: storageResult.status === "fulfilled" ? storageResult.value : null,
      jobs: {
        running: runningJobs.slice(0, 6),
        count: runningJobs.length,
      },
    });
  } catch (error) {
    console.error("Home operations failed:", error);
    res.status(503).send({ error: "Unable to load home operations" });
  }
});

router.get("/admin-audit", async (req, res) => {
  try {
    res.send(await getAuditLog());
  } catch (error) {
    console.error("Audit log failed:", error);
    res.status(503).send({ error: "Unable to load admin audit log" });
  }
});

router.get("/requests", async (req, res) => {
  try {
    const data = await fetchSeerrRequests({
      force: req.query?.force === "true",
      includeInterest: req.query?.includeInterest === "true",
    });
    res.send(enrichRequestPayload(filterSeerrRequestsForUser(data, req.user)));
  } catch (error) {
    console.error("Get Seerr requests failed:", error);
    res.status(503).send({ error: "Unable to load requests" });
  }
});

router.get("/requests/home", async (req, res) => {
  try {
    const data = await fetchSeerrRequests({ lightweight: true, force: req.query?.force === "true" });
    const filtered = enrichRequestPayload(filterSeerrRequestsForUser(data, req.user));
    res.send({
      stats: filtered.stats,
      pipeline: filtered.pipeline,
      recent: (filtered.requests || []).slice(0, 8),
      syncedAt: filtered.syncedAt,
      sources: filtered.sources,
    });
  } catch (error) {
    console.error("Get request home summary failed:", error);
    res.status(503).send({ error: "Unable to load request home summary" });
  }
});

router.get("/requests/summary", async (req, res) => {
  try {
    const data = await fetchSeerrRequests({ lightweight: true, force: req.query?.force === "true" });
    const filtered = filterSeerrRequestsForUser(data, req.user);
    res.send({ stats: filtered.stats, sources: filtered.sources, syncedAt: filtered.syncedAt });
  } catch (error) {
    console.error("Get Seerr request summary failed:", error);
    res.status(503).send({ error: "Unable to load request summary" });
  }
});

router.get("/requests/search", async (req, res) => {
  try {
    res.send(await searchSeerrMedia({ query: req.query?.query, sourceId: req.query?.sourceId }));
  } catch (error) {
    console.error("Seerr media search failed:", error);
    res.status(error.statusCode || 503).send({ error: error.message || "Unable to search Seerr media" });
  }
});

router.get("/requests/media-detail", async (req, res) => {
  try {
    res.send(
      await fetchSeerrMediaResultDetail({
        sourceId: req.query?.sourceId,
        mediaType: req.query?.mediaType,
        mediaId: req.query?.mediaId,
      })
    );
  } catch (error) {
    console.error("Seerr media detail failed:", error);
    res.status(error.statusCode || 503).send({ error: error.message || "Unable to load media detail" });
  }
});

router.get("/requests/options", async (req, res) => {
  try {
    res.send(await fetchSeerrRequestOptions({ sourceId: req.query?.sourceId, mediaType: req.query?.mediaType }));
  } catch (error) {
    console.error("Seerr request options failed:", error);
    res.status(error.statusCode || 503).send({ error: error.message || "Unable to load request options" });
  }
});

router.get("/automation-health", async (req, res) => {
  try {
    res.send(await fetchAutomationHealth());
  } catch (error) {
    console.error("Automation health failed:", error);
    res.status(error.statusCode || 503).send({ error: error.message || "Unable to load automation health" });
  }
});

router.get("/requests/issues", async (req, res) => {
  try {
    res.send(await fetchSeerrIssues());
  } catch (error) {
    console.error("Get Seerr issues failed:", error);
    res.status(error.statusCode || 503).send({ error: error.message || "Unable to load issues" });
  }
});

router.post("/requests/issues/:issueId/actions", async (req, res) => {
  try {
    const result = await runSeerrIssueAction({
      issueId: req.params.issueId,
      sourceId: req.body?.sourceId,
      action: req.body?.action,
      comment: req.body?.comment,
    });
    res.send(result);
  } catch (error) {
    console.error("Seerr issue action failed:", error);
    res.status(error.statusCode || error.response?.status || 503).send({
      error: getAxiosErrorMessage(error) || error.message || "Unable to update issue",
    });
  }
});

router.get("/requests/:requestId/detail", async (req, res) => {
  try {
    const request = await fetchSeerrRequestDetail({ requestId: req.params.requestId, sourceId: req.query?.sourceId });
    if (!canViewAllRequests(req.user) && !isUserRequestOwner(request, getRequestOwnerCandidates(req.user))) {
      return res.status(404).send({ error: "Request not found" });
    }
    res.send(enrichRequest(request));
  } catch (error) {
    console.error("Seerr request detail failed:", error);
    res.status(error.statusCode || 503).send({ error: error.message || "Unable to load request detail" });
  }
});

router.post("/requests/media", async (req, res) => {
  try {
    const { getRequestPreferences, getUserRequestFolders, applyUserFolderOverride } = require("../classes/request-provider");
    const preferences = await getRequestPreferences();
    const userFolders = await getUserRequestFolders(req.user);
    const override = applyUserFolderOverride(userFolders, req.body?.mediaType, {
      sourceId: req.body?.sourceId,
      serverId: req.body?.serverId ?? preferences.defaultServerId,
      rootFolder: req.body?.rootFolder ?? preferences.defaultRootFolder,
    });
    const requestRules = require("../classes/request-rules");
    const mediaType = String(req.body?.mediaType || "").toLowerCase();
    const quota = await requestRules.checkQuota(req.user, mediaType);
    if (!quota.allowed) {
      res.status(429).send({ error: quota.message, quota: quota.usage });
      return;
    }
    let seerrUserId = null;
    if (quota.rules.requestAsSeerrUser && !requestRules.isAdmin(req.user)) {
      seerrUserId = await findSeerrUserId(override.sourceId, req.user).catch((error) => {
        console.log("[REQUESTS] Seerr user lookup failed:", error.message);
        return null;
      });
    }
    const created = await createSeerrMediaRequest({
        userId: seerrUserId,
        sourceId: override.sourceId,
        mediaType: req.body?.mediaType,
        mediaId: req.body?.mediaId,
        seasons: req.body?.seasons,
        serverId: override.serverId,
        profileId: req.body?.profileId ?? preferences.defaultProfileId,
        rootFolder: override.rootFolder,
        languageProfileId: req.body?.languageProfileId ?? preferences.defaultLanguageProfileId,
        tags: req.body?.tags ?? preferences.defaultTags,
        is4k: req.body?.is4k ?? preferences.is4k,
      });
    const seerrRequest = created?.request || {};
    let status = seerrRequest.status === 1 ? "pending" : seerrRequest.status === 2 ? "approved" : null;
    if (status === "pending" && requestRules.shouldAutoApprove(quota.rules, req.user) && seerrRequest.id) {
      try {
        await runSeerrRequestAction({ requestId: seerrRequest.id, sourceId: override.sourceId, action: "approve" });
        status = "approved";
        created.autoApproved = true;
      } catch (error) {
        console.log("[REQUESTS] Auto-approve failed:", error.message);
      }
    }
    await requestRules.logRequest(req.user, mediaType, req.body?.mediaId, { seerrRequestId: seerrRequest.id, status }).catch((error) => {
      console.log("[REQUESTS] Could not log request for quotas:", error.message);
    });
    res.send({ ...created, quota: await requestRules.usage(req.user, quota.rules).catch(() => null) });
  } catch (error) {
    console.error("Seerr media request failed:", error);
    res.status(error.statusCode || 503).send({ error: error.message || "Unable to request media" });
  }
});

router.post("/requests/:requestId/actions", async (req, res) => {
  try {
    const result = await runSeerrRequestAction({
      requestId: req.params.requestId,
      sourceId: req.body?.sourceId,
      action: req.body?.action,
    });
    clearRequestCache();
    res.send(result);
  } catch (error) {
    console.error("Seerr request action failed:", error);
    res.status(error.statusCode || 503).send({ error: error.message || "Unable to update request" });
  }
});

router.put("/requests/:requestId/edit", async (req, res) => {
  try {
    const result = await updateSeerrRequest({
      requestId: req.params.requestId,
      sourceId: req.body?.sourceId,
      serverId: req.body?.serverId,
      profileId: req.body?.profileId,
      rootFolder: req.body?.rootFolder,
      languageProfileId: req.body?.languageProfileId,
      tags: req.body?.tags,
      is4k: req.body?.is4k,
      mediaType: req.body?.mediaType,
      seasons: req.body?.seasons,
    });
    clearRequestCache();
    res.send(result);
  } catch (error) {
    console.error("Seerr request edit failed:", error);
    res.status(error.statusCode || 503).send({ error: error.message || "Unable to edit request" });
  }
});

router.get("/users/:userId/media-lists", async (req, res) => {
  try {
    const { userId } = req.params;
    const full = req.query?.full === "true";
    const cacheKey = `${userId}:${full ? "full" : "lite"}`;
    const cached = userMediaListsCache.get(cacheKey);
    if (cached && Date.now() - cached.createdAt < USER_MEDIA_LISTS_CACHE_TTL_MS) {
      return res.send(cached.data);
    }

    let request = userMediaListsInflight.get(cacheKey);
    if (!request) {
      request = fetchUserMediaLists(userId, { includeNetwork: full, includeRecommendations: full })
        .then((data) => {
          userMediaListsCache.set(cacheKey, { createdAt: Date.now(), data });
          return data;
        })
        .finally(() => {
          userMediaListsInflight.delete(cacheKey);
        });
      userMediaListsInflight.set(cacheKey, request);
    }

    res.send(await request);
  } catch (error) {
    console.error("Get user media lists failed:", error);
    res.status(503).send({ error: error.message || "Unable to load user media lists" });
  }
});

router.post("/users/:userId/media/:itemId/actions", async (req, res) => {
  try {
    const result = await runJellyfinUserMediaAction(req.params.userId, req.params.itemId, req.body?.action);
    clearUserMediaListsCache(req.params.userId);
    res.send(result);
  } catch (error) {
    console.error("User media action failed:", error);
    res.status(error.statusCode || error.response?.status || 503).send({ error: getAxiosErrorMessage(error) || "Unable to update media item" });
  }
});

router.get("/getconfig", async (req, res) => {
  try {
    const config = await new configClass().getConfig();
    if (config.error) {
      res.status(503);
      res.send({ error: config.error });
      return;
    }

    // getconfig goes to every signed-in user, so server-only settings and secrets are removed.
    const settings = clientSettings(config.settings);
    const auth = { ...(settings.auth || {}) };
    if (req.user?.authMode === "quick-connect" && req.user?.jellyfinUser) {
      auth.mode = "quick-connect";
      auth.label = auth.label || "Jellyfin Quick Connect";
      auth.jellyfinUser = req.user.jellyfinUser;
      auth.role = req.user.role || "Viewer";
      auth.permissions = req.user.permissions || DEFAULT_ROLE_PERMISSIONS.Viewer;
      settings.auth = auth;
    } else if (req.user?.authMode === "oidc" && req.user?.jellyfinUser) {
      auth.mode = "oidc";
      auth.label = auth.label || "OIDC / Authentik";
      auth.jellyfinUser = req.user.jellyfinUser;
      auth.oidcUser = req.user.oidcUser;
      auth.role = req.user.role || "Viewer";
      auth.permissions = req.user.permissions || DEFAULT_ROLE_PERMISSIONS.Viewer;
      settings.auth = auth;
    } else if (req.user?.authMode) {
      auth.mode = req.user.authMode;
      auth.role = req.user.role;
      auth.permissions = req.user.permissions;
    }
    if (settings.auth) settings.auth = auth;

    const preferences = await getUserPreferences(req.user).catch(() => ({ theme: null }));
    settings.preferences = preferences;

    const payload = {
      JF_HOST: config.JF_HOST,
      APP_USER: req.user?.username || config.APP_USER,
      settings,
      REQUIRE_LOGIN: config.REQUIRE_LOGIN,
      IS_JELLYFIN: config.IS_JELLYFIN,
      SERVER_TYPE: config.SERVER_TYPE,
      SERVER_TYPE_LOCKED: Boolean(envServerType()),
    };

    res.send(payload);
  } catch (error) {
    console.log(error);
  }
});

router.get("/notification-settings", async (req, res) => {
  try {
    const { rows } = await db.query('SELECT settings FROM app_config where "ID"=1');
    res.send(normalizeNotificationSettings(rows[0]?.settings?.notifications));
  } catch (error) {
    console.error("Get notification settings failed:", error);
    res.status(503).send({ error: "Unable to load notification settings" });
  }
});

router.post("/notification-settings", async (req, res) => {
  try {
    const nextSettings = normalizeNotificationSettings(req.body || {});
    await db.query(
      `
        UPDATE app_config
        SET settings = (COALESCE(settings, '{}'::json)::jsonb || $1::jsonb)::json
        WHERE "ID" = 1
      `,
      [{ notifications: nextSettings }]
    );
    await addAuditEntry(req, "notifications.settings.updated", nextSettings);
    res.json(nextSettings);
  } catch (error) {
    console.error("Save notification settings failed:", error);
    res.status(503).send({ error: "Unable to save notification settings" });
  }
});

router.get("/getLibraries", async (req, res) => {
  try {
    const libraries = await db.query("SELECT * FROM jf_libraries").then((res) => res.rows);
    res.send(libraries);
  } catch (error) {
    res.status(503);
    sendSafeError(res, error);
  }
});

router.get("/getRecentlyAdded", async (req, res) => {
  try {
    const { libraryid, limit = 50, GroupResults = true } = req.query;

    const config = await new configClass().getConfig();
    const excluded_libraries = config.settings.ExcludedLibraries || [];

    let recentlyAddedFromJellyfin = await API.getRecentlyAdded({ libraryid: libraryid });

    let recentlyAddedFromJellyfinMapped = recentlyAddedFromJellyfin.map((item) => {
      return {
        Name: item.Name,
        SeriesName: item.SeriesName,
        Id: item.Id,
        SeriesId: item.SeriesId || null,
        SeasonId: item.SeasonId || null,
        EpisodeId: item.Type === "Episode" ? item.Id : null,

        SeasonNumber: item.ParentIndexNumber ?? null,
        EpisodeNumber: item.IndexNumber ?? null,
        PrimaryImageHash:
          item.ImageTags &&
          item.ImageTags.Primary &&
          item.ImageBlurHashes &&
          item.ImageBlurHashes.Primary &&
          item.ImageBlurHashes.Primary[item.ImageTags["Primary"]]
            ? item.ImageBlurHashes.Primary[item.ImageTags["Primary"]]
            : null,

        DateCreated: item.DateCreated ?? null,
        Type: item.Type,
      };
    });

    if (libraryid !== undefined) {
      const { rows: items } = await db.query(
        `SELECT i."Name", null "SeriesName", "Id", null "SeriesId", null "SeasonId", null "EpisodeId", null "SeasonNumber", null "EpisodeNumber",  "PrimaryImageHash",i."DateCreated", "Type", i."ParentId"
        FROM public.jf_library_items i
        where i.archived=false
          and i."Type" != 'Series'
          and i."ParentId"=$1
        order by "DateCreated" desc
        limit $2`,
        [libraryid, limit],
      );

      const { rows: episodes } = await db.query(
        `
        SELECT e."Name",  e."SeriesName",e."Id" , e."SeriesId", e."SeasonId", e."EpisodeId",  e."ParentIndexNumber"  "SeasonNumber",  e."IndexNumber" "EpisodeNumber", e."PrimaryImageHash", e."DateCreated", e."Type", i."ParentId"    
        FROM public.jf_library_episodes e
        JOIN public.jf_library_items i
              on i."Id"=e."SeriesId"
        where e."DateCreated" is not null
              and e.archived=false
               and i."ParentId"=$1
        order by e."DateCreated" desc
        limit $2`,
        [libraryid, limit],
      );

      let lastSynctedItemDate;
      if (items.length > 0 && items[0].DateCreated !== undefined && items[0].DateCreated !== null) {
        lastSynctedItemDate = dayjs(items[0].DateCreated, "YYYY-MM-DD HH:mm:ss.SSSZ");
      }

      if (episodes.length > 0 && episodes[0].DateCreated !== undefined && episodes[0].DateCreated !== null) {
        const newLastSynctedItemDate = dayjs(episodes[0].DateCreated, "YYYY-MM-DD HH:mm:ss.SSSZ");

        if (lastSynctedItemDate === undefined || newLastSynctedItemDate.isAfter(lastSynctedItemDate)) {
          lastSynctedItemDate = newLastSynctedItemDate;
        }
      }

      if (lastSynctedItemDate !== undefined) {
        recentlyAddedFromJellyfinMapped = recentlyAddedFromJellyfinMapped.filter((item) =>
          dayjs(item.DateCreated, "YYYY-MM-DD HH:mm:ss.SSSZ").isAfter(lastSynctedItemDate),
        );
      }

      const filteredDbRows = [
        ...items.filter((item) => !excluded_libraries.includes(item.ParentId)),
        ...episodes.filter((item) => !excluded_libraries.includes(item.ParentId)),
      ];

      const recentlyAdded = [...recentlyAddedFromJellyfinMapped, ...filteredDbRows];
      // Sort recentlyAdded by DateCreated in descending order
      recentlyAdded.sort(
        (a, b) => dayjs(b.DateCreated, "YYYY-MM-DD HH:mm:ss.SSSZ") - dayjs(a.DateCreated, "YYYY-MM-DD HH:mm:ss.SSSZ"),
      );

      res.send(recentlyAdded);
      return;
    }
    const { rows: items } = await db.query(
      `SELECT i."Name", null "SeriesName", "Id", null "SeriesId", null "SeasonId", null "EpisodeId", null "SeasonNumber" , null "EpisodeNumber" ,  "PrimaryImageHash",i."DateCreated", "Type", i."ParentId"
      FROM public.jf_library_items i
      where i.archived=false
      order by "DateCreated" desc
      limit $1`,
      [limit],
    );

    const { rows: episodes } = await db.query(
      `
      SELECT e."Name",  e."SeriesName",e."Id" , e."SeriesId", e."SeasonId", e."EpisodeId",  e."ParentIndexNumber"  "SeasonNumber",  e."IndexNumber" "EpisodeNumber", e."PrimaryImageHash", e."DateCreated", e."Type", i."ParentId"    
	    FROM public.jf_library_episodes e
	    JOIN public.jf_library_items i
            on i."Id"=e."SeriesId"
	    where e."DateCreated" is not null
	          and e.archived=false
      order by e."DateCreated" desc
      limit $1`,
      [limit],
    );
    let lastSynctedItemDate;
    if (items.length > 0 && items[0].DateCreated !== undefined && items[0].DateCreated !== null) {
      lastSynctedItemDate = dayjs(items[0].DateCreated, "YYYY-MM-DD HH:mm:ss.SSSZ");
    }

    if (episodes.length > 0 && episodes[0].DateCreated !== undefined && episodes[0].DateCreated !== null) {
      const newLastSynctedItemDate = dayjs(episodes[0].DateCreated, "YYYY-MM-DD HH:mm:ss.SSSZ");

      if (lastSynctedItemDate === undefined || newLastSynctedItemDate.isAfter(lastSynctedItemDate)) {
        lastSynctedItemDate = newLastSynctedItemDate;
      }
    }

    if (lastSynctedItemDate !== undefined) {
      recentlyAddedFromJellyfinMapped = recentlyAddedFromJellyfinMapped.filter((item) =>
        dayjs(item.DateCreated, "YYYY-MM-DD HH:mm:ss.SSSZ").isAfter(lastSynctedItemDate),
      );
    }

    const filteredDbRows = [
      ...items.filter((item) => !excluded_libraries.includes(item.ParentId)),
      ...episodes.filter((item) => !excluded_libraries.includes(item.ParentId)),
    ];

    let recentlyAdded = [...recentlyAddedFromJellyfinMapped, ...filteredDbRows];
    recentlyAdded = recentlyAdded.filter((item) => item.Type !== "Series");

    if (GroupResults == true) {
      recentlyAdded = groupRecentlyAdded(recentlyAdded);
    }

    // Sort recentlyAdded by DateCreated in descending order
    recentlyAdded.sort(
      (a, b) => dayjs(b.DateCreated, "YYYY-MM-DD HH:mm:ss.SSSZ") - dayjs(a.DateCreated, "YYYY-MM-DD HH:mm:ss.SSSZ"),
    );

    res.send(recentlyAdded);
    return;
  } catch (error) {
    res.status(503);
    sendSafeError(res, error);
  }
});

router.get("/getRecentlyAddedShelves", async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 24, 1), 60);
    const config = await new configClass().getConfig();
    const excludedLibraries = config.settings.ExcludedLibraries || [];

    const { rows } = await db.query(
      `
      WITH active_libraries AS (
        SELECT "Id", "Name", "CollectionType"
        FROM public.jf_libraries
        WHERE archived=false
          AND NOT ("Id" = ANY($2::text[]))
      ),
      recent_media AS (
        SELECT
          i."Name",
          NULL::text "SeriesName",
          i."Id",
          NULL::text "SeriesId",
          NULL::text "SeasonId",
          NULL::text "EpisodeId",
          NULL::integer "SeasonNumber",
          NULL::integer "EpisodeNumber",
          i."PrimaryImageHash",
          i."DateCreated",
          i."Type",
          i."ParentId"
        FROM public.jf_library_items i
        JOIN active_libraries l ON l."Id"=i."ParentId"
        WHERE i.archived=false
          AND i."Type" != 'Series'
          AND i."DateCreated" IS NOT NULL

        UNION ALL

        SELECT
          e."Name",
          e."SeriesName",
          e."EpisodeId" "Id",
          e."SeriesId",
          e."SeasonId",
          e."EpisodeId",
          e."ParentIndexNumber" "SeasonNumber",
          e."IndexNumber" "EpisodeNumber",
          e."PrimaryImageHash",
          e."DateCreated",
          e."Type",
          i."ParentId"
        FROM public.jf_library_episodes e
        JOIN public.jf_library_items i ON i."Id"=e."SeriesId"
        JOIN active_libraries l ON l."Id"=i."ParentId"
        WHERE e.archived=false
          AND e."DateCreated" IS NOT NULL
      ),
      ranked_media AS (
        SELECT recent_media.*,
          ROW_NUMBER() OVER (PARTITION BY "ParentId" ORDER BY "DateCreated" DESC) row_number
        FROM recent_media
      )
      SELECT
        l."Id" id,
        l."Name" name,
        l."CollectionType" type,
        COALESCE(
          JSON_AGG(
            JSON_BUILD_OBJECT(
              'Name', r."Name",
              'SeriesName', r."SeriesName",
              'Id', r."Id",
              'SeriesId', r."SeriesId",
              'SeasonId', r."SeasonId",
              'EpisodeId', r."EpisodeId",
              'SeasonNumber', r."SeasonNumber",
              'EpisodeNumber', r."EpisodeNumber",
              'PrimaryImageHash', r."PrimaryImageHash",
              'DateCreated', r."DateCreated",
              'Type', r."Type",
              'ParentId', r."ParentId"
            )
            ORDER BY r."DateCreated" DESC
          ) FILTER (WHERE r."Id" IS NOT NULL),
          '[]'::json
        ) items
      FROM active_libraries l
      LEFT JOIN ranked_media r ON r."ParentId"=l."Id" AND r.row_number <= $1
      GROUP BY l."Id", l."Name", l."CollectionType"
      ORDER BY l."Name" ASC
      `,
      [limit, excludedLibraries],
    );

    res.set("Cache-Control", "private, max-age=30");
    res.send(
      rows.map((shelf) => ({
        ...shelf,
        count: shelf.items.length,
      })),
    );
  } catch (error) {
    console.error("Failed to load recently added shelves:", error);
    res.status(503).send({ error: "Unable to load recently added shelves" });
  }
});

router.post("/setconfig", async (req, res) => {
  try {
    const { JF_HOST, JF_API_KEY, SERVER_TYPE } = req.body;

    if (JF_HOST === undefined && JF_API_KEY === undefined) {
      res.status(400);
      res.send("JF_HOST and JF_API_KEY are required for configuration");
      return;
    }

    var url = JF_HOST;

    const serverType = await chooseServerType(SERVER_TYPE, url);
    const validation = await withServerType(serverType, () => API.validateSettings(url, JF_API_KEY));
    if (validation.isValid === false) {
      res.status(validation.status);
      res.send(validation);
      return;
    }

    const { rows: getConfig } = await db.query('SELECT * FROM app_config where "ID"=1');

    let query = 'UPDATE app_config SET "JF_HOST"=$1, "JF_API_KEY"=$2 where "ID"=1';
    if (getConfig.length === 0) {
      query = 'INSERT INTO app_config ("ID","JF_HOST","JF_API_KEY","APP_USER","APP_PASSWORD") VALUES (1,$1,$2,null,null)';
    }

    const { rows } = await db.query(query, [validation.cleanedUrl, JF_API_KEY]);
    await saveServerType(serverType);

    const systemInfo = await API.systemInfo();

    if (systemInfo && systemInfo != {}) {
      const settingsjson = await db.query('SELECT settings FROM app_config where "ID"=1').then((res) => res.rows);

      if (settingsjson.length > 0) {
        const settings = settingsjson[0].settings || {};

        settings.ServerID = systemInfo?.Id || null;

        const query = 'UPDATE app_config SET settings=$1 where "ID"=1';

        await db.query(query, [settings]);
      }
    }

    const admins = await API.getAdmins(true);
    const preferredAdmin = await new configClass().getPreferedAdmin();
    if (admins && admins.length > 0 && preferredAdmin && !admins.map((item) => item.Id).includes(preferredAdmin)) {
      const newAdmin = admins[0];
      const settingsjson = await db.query('SELECT settings FROM app_config where "ID"=1').then((res) => res.rows);

      if (settingsjson.length > 0) {
        const settings = settingsjson[0].settings || {};

        settings.preferred_admin = { userid: newAdmin.Id, username: newAdmin.Name };

        const query = 'UPDATE app_config SET settings=$1 where "ID"=1';

        await db.query(query, [settings]);
      }
    }
    res.send(rows);
  } catch (error) {
    console.log(error);
  }
});

router.post("/setExternalUrl", async (req, res) => {
  try {
    if (!Object.prototype.hasOwnProperty.call(req.body || {}, "ExternalUrl")) {
      res.status(400);
      res.send({ errorMessage: "ExternalUrl is required for configuration" });
      return;
    }

    const ExternalUrl = typeof req.body.ExternalUrl === "string" ? req.body.ExternalUrl.trim() : "";
    const config = await new configClass().getConfig();
    const settings = config.settings || {};

    if (ExternalUrl) {
      const validation = await API.validateSettings(ExternalUrl, config.JF_API_KEY);
      if (validation.isValid === false) {
        res.status(validation.status || 400);
        res.send({
          errorMessage: validation.errorMessage || "Unable to validate the external URL",
          ...validation,
        });
        return;
      }
      settings.EXTERNAL_URL = validation.cleanedUrl || ExternalUrl;
    } else {
      delete settings.EXTERNAL_URL;
    }

    try {
      const query = 'UPDATE app_config SET settings=$1 where "ID"=1';

      await db.query(query, [settings]);
      config.settings = settings;
      res.send(config);
    } catch (error) {
      res.status(503);
      res.send({ errorMessage: "Error: " + error });
    }
  } catch (error) {
    console.log(error);
    res.status(503);
    res.send({ errorMessage: "Error: " + error });
  }
});

router.post("/setPreferredAdmin", async (req, res) => {
  try {
    const { userid, username } = req.body;

    if (userid === undefined && username === undefined) {
      res.status(400);
      res.send("A valid userid and username is required for preferred admin");
      return;
    }

    const settingsjson = await db.query('SELECT settings FROM app_config where "ID"=1').then((res) => res.rows);

    if (settingsjson.length > 0) {
      const settings = settingsjson[0].settings || {};

      settings.preferred_admin = { userid: userid, username: username };

      let query = 'UPDATE app_config SET settings=$1 where "ID"=1';

      await db.query(query, [settings]);

      res.send("Settings updated succesfully");
    } else {
      res.status(404);
      res.send("Settings not found");
    }
  } catch (error) {
    console.log(error);
  }

  console.log(`ENDPOINT CALLED: /setconfig: `);
});

router.post("/setRequireLogin", async (req, res) => {
  try {
    const { REQUIRE_LOGIN } = req.body;

    if (REQUIRE_LOGIN === undefined || typeof REQUIRE_LOGIN !== "boolean") {
      res.status(400);
      res.send("A valid value(true/false) is required for REQUIRE_LOGIN");
      return;
    }

    let query = 'UPDATE app_config SET "REQUIRE_LOGIN"=$1 where "ID"=1';

    const { rows } = await db.query(query, [REQUIRE_LOGIN]);
    res.send(rows);
  } catch (error) {
    console.log(error);
  }
});

router.post("/setAuthMode", async (req, res) => {
  try {
    // eslint-disable-next-line no-unused-vars -- existing code, kept unchanged
    const { mode, username, password, issuerUrl, clientId, clientSecret, redirectUri } = req.body;
    const config = await new configClass().getConfig();

    if (config.error) {
      res.status(503).json({ errorMessage: config.error });
      return;
    }

    const settings = config.settings || {};
    const primaryLocalUser = ["jellyfin-quick-connect", "oidc", "local-auth"].includes(config.APP_USER) ? null : config.APP_USER;
    let query = "";
    let params = [];

    if (mode === "quick-connect") {
      settings.auth = {
        ...(settings.auth || {}),
        mode: "quick-connect",
        label: "Jellyfin Login / Quick Connect",
      };

      query = 'UPDATE app_config SET "APP_USER"=$1, "APP_PASSWORD"=$2, "REQUIRE_LOGIN"=$3, settings=$4 where "ID"=1';
      params = ["jellyfin-quick-connect", null, true, settings];
    } else if (mode === "local") {
      if (!(settings.localUsers || []).length && !primaryLocalUser) {
        res.status(400).json({ errorMessage: "Create a local admin user on the Users page before enabling local login" });
        return;
      }

      settings.auth = {
        mode: "local",
        label: "Local JellyGlance login",
      };

      query = 'UPDATE app_config SET "APP_USER"=$1, "REQUIRE_LOGIN"=$2, settings=$3 where "ID"=1';
      params = [primaryLocalUser || "local-auth", true, settings];
    } else if (mode === "oidc") {
      if (!clientId) {
        res.status(400).json({ errorMessage: "OIDC client ID is required" });
        return;
      }

      const oidcTest = await testOidcDiscovery(issuerUrl);
      if (!oidcTest.isValid) {
        res.status(400).json(oidcTest);
        return;
      }

      // The saved secret is never sent to the browser, so a blank field means "keep it".
      const keptSecret = settings.auth?.mode === "oidc" && settings.auth?.clientId === clientId ? settings.auth.clientSecret : null;
      settings.auth = {
        mode: "oidc",
        label: "OIDC / Authentik",
        issuerUrl: oidcTest.issuerUrl,
        clientId,
        clientSecret: clientSecret || keptSecret || null,
        redirectUri: redirectUri || null,
        discovery: oidcTest.discovery,
      };

      query = 'UPDATE app_config SET "APP_USER"=$1, "APP_PASSWORD"=$2, "REQUIRE_LOGIN"=$3, settings=$4 where "ID"=1';
      params = ["oidc", null, true, settings];
    } else {
      res.status(400).json({ errorMessage: "Invalid authentication mode" });
      return;
    }

    await db.query(query, params);
    await addAuditEntry(req, "auth.mode.updated", { mode });
    res.json({ isValid: true, mode, settings });
  } catch (error) {
    console.log(error);
    res.status(500).json({ errorMessage: "Unable to update authentication mode" });
  }
});

router.post("/updateCredentials", async (req, res) => {
  const { username, current_password, new_password } = req.body;
  const config = await new configClass().getConfig();

  let result = { isValid: true, errorMessage: "" };

  if (config.error) {
    result = { isValid: false, errorMessage: config.error };
    res.status(503);
    res.send(result);
    return;
  }
  if (username === undefined && current_password === undefined && new_password === undefined) {
    result.isValid = false;
    result.errorMessage = "Invalid Parameters";
    res.status(400);
    res.send(result);
    return;
  }

  if (username !== undefined && username === "") {
    result.isValid = false;
    result.errorMessage = "Username cannot be empty";
    res.status(400);
    res.send(result);
    return;
  }

  try {
    if (username !== undefined && config.APP_USER !== username) {
      await db.query(`UPDATE app_config SET "APP_USER"=$1 where "ID"=1`, [username]);
    }

    if (current_password === undefined && new_password === undefined) {
      res.send(result);
      return;
    }

    if (verifyPassword(current_password, config.APP_PASSWORD)) {
      if (verifyPassword(new_password, config.APP_PASSWORD)) {
        result.isValid = false;
        result.errorMessage = "New Password cannot be the same as Old Password";
      } else {
        await db.query(`UPDATE app_config SET "APP_PASSWORD"=$1 where "ID"=1`, [
          hashPassword(new_password),
        ]);
      }
    } else {
      result.isValid = false;
      result.errorMessage = "Old Password is Invalid";
    }
  } catch (error) {
    console.log(error);
    result.errorMessage = error;
  }
  if (!result.isValid) {
    res.status(400);
  }
  res.send(result);
});

router.get("/userAccess", async (req, res) => {
  try {
    const config = await new configClass().getConfig();
    if (config.error) {
      res.status(503).json({ errorMessage: config.error });
      return;
    }

    const settings = config.settings || {};
    const localUsers = (settings.localUsers || []).map(({ password, ...user }) => user);
    const primaryLocalUser = ["jellyfin-quick-connect", "oidc", "local-auth"].includes(config.APP_USER) ? null : config.APP_USER;
    const roles = normalizeAccessRoles(settings);
    if (JSON.stringify(roles) !== JSON.stringify(settings.roles || [])) {
      settings.roles = roles;
      await db.query('UPDATE app_config SET settings=$1 where "ID"=1', [settings]);
    }
    res.json({
      roles,
      rolePermissions: mergeRolePermissionMap(settings.rolePermissions),
      jellyfinRoles: settings.userRoles || {},
      localUsers,
      primaryLocalUser,
      authMode: settings.auth?.mode || (config.REQUIRE_LOGIN ? "local" : "quick-connect"),
      oidcLabel: settings.auth?.label,
    });
  } catch (error) {
    console.log(error);
    res.status(500).json({ errorMessage: "Unable to load user access settings" });
  }
});

router.post("/roles", async (req, res) => {
  try {
    const { role } = req.body;
    const cleanRole = role?.toString().trim();

    if (!cleanRole) {
      res.status(400).json({ errorMessage: "Role name is required" });
      return;
    }

    const config = await new configClass().getConfig();
    const settings = config.settings || {};
    const roles = normalizeAccessRoles(settings);

    if (roles.some((existingRole) => existingRole.toLowerCase() === cleanRole.toLowerCase())) {
      res.status(409).json({ errorMessage: "That role already exists" });
      return;
    }

    assertSafeObjectKey(cleanRole);
    settings.roles = [...roles, cleanRole];
    settings.rolePermissions = mutateSafeRecord(settings.rolePermissions, (map) => {
      safeAssign(map, cleanRole, { ...DEFAULT_ROLE_PERMISSIONS.Viewer });
    });
    await db.query('UPDATE app_config SET settings=$1 where "ID"=1', [settings]);
    await addAuditEntry(req, "role.created", { role: cleanRole });
    res.status(201).json({ roles: settings.roles, rolePermissions: mergeRolePermissionMap(settings.rolePermissions) });
  } catch (error) {
    console.log(error);
    res.status(500).json({ errorMessage: "Unable to add role" });
  }
});

router.delete("/roles/:role", async (req, res) => {
  try {
    const role = decodeURIComponent(req.params.role);

    if (DEFAULT_ACCESS_ROLES.includes(role)) {
      res.status(400).json({ errorMessage: "Built-in roles cannot be removed" });
      return;
    }

    const config = await new configClass().getConfig();
    const settings = config.settings || {};
    const roles = normalizeAccessRoles(settings);
    settings.roles = roles.filter((existingRole) => existingRole !== role);
    if (isSafeObjectKey(role)) {
      settings.rolePermissions = mutateSafeRecord(settings.rolePermissions, (map) => {
        safeDelete(map, role);
      });
    } else {
      settings.rolePermissions = { ...(settings.rolePermissions || {}) };
    }

    settings.userRoles = Object.fromEntries(
      Object.entries(settings.userRoles || {}).map(([userid, assignedRole]) => [userid, assignedRole === role ? "Viewer" : assignedRole])
    );
    settings.localUsers = (settings.localUsers || []).map((user) => ({
      ...user,
      role: user.role === role ? "Viewer" : user.role,
      updatedAt: user.role === role ? new Date().toISOString() : user.updatedAt,
    }));

    await db.query('UPDATE app_config SET settings=$1 where "ID"=1', [settings]);
    await addAuditEntry(req, "role.deleted", { role });
    res.json({ roles: settings.roles, rolePermissions: mergeRolePermissionMap(settings.rolePermissions) });
  } catch (error) {
    console.log(error);
    res.status(500).json({ errorMessage: "Unable to remove role" });
  }
});

router.patch("/roles/:role/permissions", async (req, res) => {
  try {
    const role = decodeURIComponent(req.params.role);
    const { permissions } = req.body;

    if (!role || !permissions || typeof permissions !== "object") {
      res.status(400).json({ errorMessage: "Role and permissions are required" });
      return;
    }

    const config = await new configClass().getConfig();
    const settings = config.settings || {};
    const roles = normalizeAccessRoles(settings);

    if (!roles.includes(role)) {
      res.status(404).json({ errorMessage: "Role not found" });
      return;
    }

    if (role === "Owner") {
      res.json({ role, permissions: DEFAULT_ROLE_PERMISSIONS.Owner });
      return;
    }

    if (role === "Disabled") {
      res.json({ role, permissions: DEFAULT_ROLE_PERMISSIONS.Disabled });
      return;
    }

    assertSafeObjectKey(role);
    settings.roles = roles;
    settings.rolePermissions = mutateSafeRecord(settings.rolePermissions, (map) => {
      safeAssign(map, role, persistRolePermissions(role, permissions, map.get(role)));
    });

    await db.query('UPDATE app_config SET settings=$1 where "ID"=1', [settings]);
    await addAuditEntry(req, "role.permissions.updated", { role, permissions: settings.rolePermissions[role] });
    res.json({ role, permissions: settings.rolePermissions[role] });
  } catch (error) {
    console.log(error);
    res.status(500).json({ errorMessage: "Unable to update role permissions" });
  }
});

router.post("/localUsers", async (req, res) => {
  try {
    const { username, password, role } = req.body;
    if (!username || !password) {
      res.status(400).json({ errorMessage: "Username and password are required" });
      return;
    }

    const config = await new configClass().getConfig();
    const settings = config.settings || {};
    const localUsers = settings.localUsers || [];
    const cleanRole = role || "Viewer";

    if (!roleExists(settings, cleanRole)) {
      res.status(400).json({ errorMessage: "Role not found" });
      return;
    }

    if (config.APP_USER === username || localUsers.some((user) => user.username === username)) {
      res.status(409).json({ errorMessage: "A local user with that username already exists" });
      return;
    }

    const nextUser = {
      id: randomUUID(),
      username,
      password: hashPassword(password),
      role: cleanRole,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    settings.localUsers = [...localUsers, nextUser];
    await db.query('UPDATE app_config SET settings=$1 where "ID"=1', [settings]);
    await addAuditEntry(req, "local_user.created", { username, role: nextUser.role });
    res.status(201).json({ ...nextUser, password: undefined });
  } catch (error) {
    console.log(error);
    res.status(500).json({ errorMessage: "Unable to add local user" });
  }
});

router.patch("/localUsers/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { role, password } = req.body;
    const config = await new configClass().getConfig();
    const settings = config.settings || {};
    const localUsers = settings.localUsers || [];
    const userIndex = localUsers.findIndex((user) => user.id === id);

    if (userIndex === -1) {
      res.status(404).json({ errorMessage: "Local user not found" });
      return;
    }

    if (role && !roleExists(settings, role)) {
      res.status(400).json({ errorMessage: "Role not found" });
      return;
    }

    localUsers[userIndex] = {
      ...localUsers[userIndex],
      role: role || localUsers[userIndex].role,
      password: password ? hashPassword(password) : localUsers[userIndex].password,
      updatedAt: new Date().toISOString(),
    };

    settings.localUsers = localUsers;
    await db.query('UPDATE app_config SET settings=$1 where "ID"=1', [settings]);
    await addAuditEntry(req, "local_user.updated", { username: localUsers[userIndex].username, role: localUsers[userIndex].role, passwordChanged: Boolean(password) });
    res.json({ ...localUsers[userIndex], password: undefined });
  } catch (error) {
    console.log(error);
    res.status(500).json({ errorMessage: "Unable to update local user" });
  }
});

router.patch("/primaryLocalPassword", async (req, res) => {
  try {
    const { password } = req.body;
    if (!password) {
      res.status(400).json({ errorMessage: "Password is required" });
      return;
    }

    await db.query('UPDATE app_config SET "APP_PASSWORD"=$1 where "ID"=1', [hashPassword(password)]);
    await addAuditEntry(req, "local_user.primary_password_reset", {});
    res.json({ isValid: true });
  } catch (error) {
    console.log(error);
    res.status(500).json({ errorMessage: "Unable to reset primary local password" });
  }
});

router.delete("/localUsers/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const config = await new configClass().getConfig();
    const settings = config.settings || {};
    const localUsers = settings.localUsers || [];
    settings.localUsers = localUsers.filter((user) => user.id !== id);

    await db.query('UPDATE app_config SET settings=$1 where "ID"=1', [settings]);
    await addAuditEntry(req, "local_user.deleted", { id });
    res.json({ isValid: true });
  } catch (error) {
    console.log(error);
    res.status(500).json({ errorMessage: "Unable to delete local user" });
  }
});

router.patch("/userRoles/:userid", async (req, res) => {
  try {
    const { userid } = req.params;
    const { role } = req.body;

    if (!userid || !role) {
      res.status(400).json({ errorMessage: "User ID and role are required" });
      return;
    }

    const config = await new configClass().getConfig();
    const settings = config.settings || {};

    if (!roleExists(settings, role)) {
      res.status(400).json({ errorMessage: "Role not found" });
      return;
    }

    assertSafeObjectKey(userid);
    settings.userRoles = mutateSafeRecord(settings.userRoles, (map) => {
      safeAssign(map, userid, role);
    });

    await db.query('UPDATE app_config SET settings=$1 where "ID"=1', [settings]);
    await addAuditEntry(req, "jellyfin_user.role.updated", { userid, role });
    res.json({ userid, role });
  } catch (error) {
    console.log(error);
    res.status(500).json({ errorMessage: "Unable to update role" });
  }
});

router.post("/updatePassword", async (req, res) => {
  const { current_password, new_password } = req.body;

  let result = { isValid: true, errorMessage: "" };

  try {
    const { rows } = await db.query(`SELECT "JF_HOST","JF_API_KEY","APP_USER","APP_PASSWORD" FROM app_config where "ID"=1`);

    if (rows && rows.length > 0 && verifyPassword(current_password, rows[0].APP_PASSWORD)) {
      if (verifyPassword(new_password, rows[0].APP_PASSWORD)) {
        result.isValid = false;
        result.errorMessage = "New Password cannot be the same as Old Password";
      } else {
        await db.query(`UPDATE app_config SET "APP_PASSWORD"=$1 where "ID"=1`, [
          hashPassword(new_password),
        ]);
      }
    } else {
      result.isValid = false;
      result.errorMessage = "Old Password is Invalid";
    }
  } catch (error) {
    console.log(error);
    result.errorMessage = error;
  }

  res.send(result);
});

router.get("/TrackedLibraries", async (req, res) => {
  const config = await new configClass().getConfig();

  if (config.error) {
    res.send({ error: config.error });
    return;
  }

  try {
    const libraries = await API.getLibraries();

    const ExcludedLibraries = config.settings?.ExcludedLibraries || [];

    const librariesWithTrackedStatus = libraries.map((items) => ({
      ...items,
      ...{ Tracked: !ExcludedLibraries.includes(items.Id) },
    }));
    res.send(librariesWithTrackedStatus);
  } catch (error) {
    res.status(503);
    res.send({ error: "Error: " + error });
  }
});

router.post("/setExcludedLibraries", async (req, res) => {
  const { libraryID } = req.body;

  if (libraryID === undefined) {
    res.status(400);
    res.send("No Library Id provided");
    return;
  }

  const settingsjson = await db.query('SELECT settings FROM app_config where "ID"=1').then((res) => res.rows);

  if (settingsjson.length > 0) {
    const settings = settingsjson[0].settings || {};

    let libraries = settings.ExcludedLibraries || [];
    if (libraries.includes(libraryID)) {
      libraries = libraries.filter((item) => item !== libraryID);
    } else {
      libraries.push(libraryID);
    }
    settings.ExcludedLibraries = libraries;

    let query = 'UPDATE app_config SET settings=$1 where "ID"=1';

    await db.query(query, [settings]);

    res.send("Settings updated succesfully");
  } else {
    res.status(404);
    res.send("Settings not found");
  }
});

router.post("/library-display-settings", async (req, res) => {
  const { showLibraryCardNames } = req.body || {};
  const settingsjson = await db.query('SELECT settings FROM app_config where "ID"=1').then((res) => res.rows);

  if (settingsjson.length > 0) {
    const settings = settingsjson[0].settings || {};
    settings.ShowLibraryCardNames = showLibraryCardNames !== false;

    await db.query('UPDATE app_config SET settings=$1 where "ID"=1', [settings]);
    await addAuditEntry(req, "library.display_settings.updated", { showLibraryCardNames: settings.ShowLibraryCardNames });

    res.send({ showLibraryCardNames: settings.ShowLibraryCardNames });
  } else {
    res.status(404);
    res.send({ error: "Settings not found" });
  }
});

router.get("/UntrackedUsers", async (req, res) => {
  const config = await new configClass().getConfig();

  if (config.error) {
    res.send({ error: config.error });
    return;
  }

  try {
    const ExcludedUsers = config.settings?.ExcludedUsers || [];

    res.send(ExcludedUsers);
  } catch (error) {
    res.status(503);
    res.send({ error: "Error: " + error });
  }
});

router.post("/setUntrackedUsers", async (req, res) => {
  const { userId } = req.body;
  if (Array.isArray(userId) || userId === undefined) {
    res.status(400);
    return res.send("No Valid User ID provided");
  }

  const settingsjson = await db.query('SELECT settings FROM app_config where "ID"=1').then((res) => res.rows);

  if (settingsjson.length > 0) {
    const settings = settingsjson[0].settings || {};

    let excludedUsers = settings.ExcludedUsers || [];
    if (excludedUsers.includes(userId)) {
      excludedUsers = excludedUsers.filter((item) => item !== userId);
    } else {
      excludedUsers.push(userId);
    }
    settings.ExcludedUsers = excludedUsers;

    let query = 'UPDATE app_config SET settings=$1 where "ID"=1';

    await db.query(query, [settings]);

    res.json(excludedUsers);
  } else {
    res.status(404);
    res.send("Settings not found");
  }
});

router.get("/keys", async (req, res) => {
  const config = await new configClass().getConfig();
  res.send(
    (config.api_keys || []).map((item) => ({
      ...item,
      scope: normalizeApiKeyScope(item.scope, { fallback: "full" }),
      lastUsed: item.lastUsed || null,
    }))
  );
});

router.delete("/keys", async (req, res) => {
  const { key } = req.body;
  const config = await new configClass().getConfig();

  if (!key) {
    res.status(400);
    res.send({ error: "No API key provided to remove" });
    return;
  }

  const keys = config.api_keys || [];
  const keyExists = keys.some((obj) => obj.key === key);
  if (keyExists) {
    const new_keys_array = keys.filter((obj) => obj.key !== key);
    let query = 'UPDATE app_config SET api_keys=$1 where "ID"=1';

    await db.query(query, [JSON.stringify(new_keys_array)]);
    return res.json({ message: "Key removed" });
  } else {
    res.status(404);
    return res.send("API key does not exist");
  }
});

router.post("/keys", async (req, res) => {
  const { name } = req.body;

  if (name === undefined) {
    res.status(400);
    res.send("Key Name is required to generate a key");
    return;
  }

  const config = await new configClass().getConfig();

  if (!name) {
    res.status(400);
    res.send({ error: "A Name is required to generate a key" });
    return;
  }

  let keys = config.api_keys || [];

  const uuid = randomUUID();
  const scope = normalizeApiKeyScope(req.body?.scope, { fallback: "widgets" });
  const new_key = { name: name, key: uuid, scope, lastUsed: null };

  keys.push(new_key);

  let query = 'UPDATE app_config SET api_keys=$1 where "ID"=1';

  await db.query(query, [JSON.stringify(keys)]);
  res.send(keys);
});

router.patch("/keys", async (req, res) => {
  const { key, scope } = req.body || {};
  if (!key) {
    res.status(400);
    res.send({ error: "No API key provided" });
    return;
  }
  const nextScope = normalizeApiKeyScope(scope, { fallback: "" });
  if (!nextScope) {
    res.status(400);
    res.send({ error: "Scope must be widgets, widgets-write, or full" });
    return;
  }
  const config = await new configClass().getConfig();
  const keys = config.api_keys || [];
  if (!keys.some((obj) => obj.key === key)) {
    res.status(404);
    res.send({ error: "API key does not exist" });
    return;
  }
  const next = keys.map((obj) => (obj.key === key ? { ...obj, scope: nextScope } : obj));
  await db.query('UPDATE app_config SET api_keys=$1 where "ID"=1', [JSON.stringify(next)]);
  res.send(next);
});

router.get("/getTaskSettings", async (req, res) => {
  try {
    const settingsjson = await db.query('SELECT settings FROM app_config where "ID"=1').then((res) => res.rows);

    if (settingsjson.length > 0) {
      const settings = settingsjson[0].settings || {};

      let tasksettings = settings.Tasks || {};
      res.send(tasksettings);
    } else {
      res.status(404);
      res.send({ error: "Task Settings Not Found" });
    }
  } catch (error) {
    res.status(503);
    res.send({ error: "Error: " + error });
  }
});

router.post("/setTaskSettings", async (req, res) => {
  const { taskname, Interval } = req.body;

  if (taskname === undefined || Interval === undefined) {
    res.status(400);
    res.send("Task Name and Interval are required");
    return;
  }

  if (!Number.isInteger(Interval) && Interval <= 0) {
    res.status(400);
    res.send("A valid Interval(int) which is > 0 minutes is required");
    return;
  }

  try {
    const settingsjson = await db.query('SELECT settings FROM app_config where "ID"=1').then((res) => res.rows);

    if (settingsjson.length > 0) {
      const settings = settingsjson[0].settings || {};
      if (!settings.Tasks) {
        settings.Tasks = {};
      }

      assertSafeObjectKey(taskname);
      settings.Tasks = mutateSafeRecord(settings.Tasks, (map) => {
        const current = map.get(taskname) && typeof map.get(taskname) === "object" ? { ...map.get(taskname) } : {};
        current.Interval = Interval;
        safeAssign(map, taskname, current);
      });

      let query = 'UPDATE app_config SET settings=$1 where "ID"=1';

      await db.query(query, [settings]);
      const taskScheduler = new TaskScheduler().getInstance();
      await taskScheduler.updateIntervalsFromDB();
      await taskScheduler.getTaskHistory();
      res.status(200);
      // Same shape as /getTaskSettings: the Tasks page replaces its whole list with this.
      res.send(settings.Tasks);
    } else {
      res.status(404);
      res.send({ error: "Task Settings Not Found" });
    }
  } catch (error) {
    res.status(503);
    res.send({ error: "Error: " + error });
  }
});

// Get Activity Monitor Polling Settings
router.get("/getActivityMonitorSettings", async (req, res) => {
  try {
    const settingsjson = await db.query('SELECT settings FROM app_config where "ID"=1').then((res) => res.rows);

    if (settingsjson.length > 0) {
      const settings = settingsjson[0].settings || {};
      const pollingSettings = settings.ActivityMonitorPolling || {
        activeSessionsInterval: 1000,
        idleInterval: 5000,
      };
      res.send(pollingSettings);
    } else {
      res.status(404);
      res.send({ error: "Settings Not Found" });
    }
  } catch (error) {
    res.status(503);
    res.send({ error: "Error: " + error });
  }
});

// Set Activity Monitor Polling Settings
router.post("/setActivityMonitorSettings", async (req, res) => {
  const { activeSessionsInterval, idleInterval } = req.body;

  if (activeSessionsInterval === undefined || idleInterval === undefined) {
    res.status(400);
    res.send("activeSessionsInterval and idleInterval are required");
    return;
  }

  if (!Number.isInteger(activeSessionsInterval) || activeSessionsInterval <= 0) {
    res.status(400);
    res.send("A valid activeSessionsInterval(int) which is > 0 milliseconds is required");
    return;
  }

  if (!Number.isInteger(idleInterval) || idleInterval <= 0) {
    res.status(400);
    res.send("A valid idleInterval(int) which is > 0 milliseconds is required");
    return;
  }

  if (activeSessionsInterval > idleInterval) {
    res.status(400);
    res.send("activeSessionsInterval should be <= idleInterval for optimal performance");
    return;
  }

  try {
    const settingsjson = await db.query('SELECT settings FROM app_config where "ID"=1').then((res) => res.rows);

    if (settingsjson.length > 0) {
      const settings = settingsjson[0].settings || {};

      settings.ActivityMonitorPolling = {
        activeSessionsInterval: activeSessionsInterval,
        idleInterval: idleInterval,
      };

      let query = 'UPDATE app_config SET settings=$1 where "ID"=1';
      await db.query(query, [settings]);

      res.status(200);
      res.send(settings.ActivityMonitorPolling);
    } else {
      res.status(404);
      res.send({ error: "Settings Not Found" });
    }
  } catch (error) {
    res.status(503);
    res.send({ error: "Error: " + error });
  }
});

//JellyGlance app functions
router.get("/CheckForUpdates", async (req, res) => {
  try {
    let result = await checkForUpdates();
    res.send(result);
  } catch (error) {
    console.log(error);
  }
});

router.get("/CheckForUpdates/releases", async (req, res) => {
  try {
    const result = await fetchReleaseNotes();
    res.send(result);
  } catch (error) {
    console.log(error);
    res.status(503).send({ error: "Unable to load release notes" });
  }
});

router.get("/github/contributors", async (req, res) => {
  try {
    const result = await fetchGithubContributors();
    res.send(result);
  } catch (error) {
    console.log(error);
    res.status(503).send({ error: "Unable to load GitHub contributors" });
  }
});

router.get("/github/stars", async (req, res) => {
  try {
    const result = await fetchGithubStars();
    res.send(result);
  } catch (error) {
    console.log(error);
    res.status(503).send({ error: "Unable to load GitHub stars" });
  }
});

//DB Queries
router.post("/getUserDetails", async (req, res) => {
  try {
    const { userid } = req.body;

    if (userid === undefined) {
      res.status(400);
      res.send("No User Id provided");
      return;
    }

    const { rows } = await db.query(`select * from jf_users where "Id"=$1`, [userid]);
    res.send(rows[0]);
  } catch (error) {
    console.log(error);
    res.status(503);
    sendSafeError(res, error);
  }
});

router.get("/getLibraries", async (req, res) => {
  try {
    const { rows } = await db.query(`SELECT * FROM jf_libraries`);
    res.send(rows);
  } catch (error) {
    console.log(error);
  }
});

router.post("/getLibrary", async (req, res) => {
  try {
    const { libraryid } = req.body;

    if (libraryid === undefined) {
      res.status(400);
      res.send("No Library Id provided");
      return;
    }

    const { rows } = await db.query(`select * from jf_libraries where "Id"=$1`, [libraryid]);
    res.send(rows[0]);
  } catch (error) {
    console.log(error);
    res.status(503);
    sendSafeError(res, error);
  }
});

router.post("/getLibraryItems", async (req, res) => {
  try {
    const { libraryid } = req.body;

    if (libraryid === undefined) {
      res.status(400);
      res.send("No Library Id provided");
      return;
    }

    const { rows } = await db.query(`SELECT * FROM jf_library_items where "ParentId"=$1`, [libraryid]);
    res.send(rows);
  } catch (error) {
    console.log(error);
  }
});

router.post("/getSeasons", async (req, res) => {
  try {
    const { Id } = req.body;

    if (Id === undefined) {
      res.status(400);
      res.send("No Season Id provided");
      return;
    }

    const { rows } = await db.query(
      `SELECT s.*, i."PrimaryImageHash", (select count(e.*) "Episodes" from jf_library_episodes e  where e."SeasonId"=s."Id") ,(select sum(ii."Size") "Size" from jf_library_episodes e join jf_item_info ii on ii."Id"=e."EpisodeId" where e."SeasonId"=s."Id") FROM jf_library_seasons s left join jf_library_items i on i."Id"=s."SeriesId" where "SeriesId"=$1`,
      [Id],
    );
    res.send(rows);
  } catch (error) {
    console.log(error);
  }
});

router.post("/getEpisodes", async (req, res) => {
  try {
    const { Id } = req.body;

    if (Id === undefined) {
      res.status(400);
      res.send("No Episode Id provided");
      return;
    }

    const { rows } = await db.query(
      `SELECT e.*, i."PrimaryImageHash", ii."Size" FROM jf_library_episodes e left join jf_library_items i on i."Id"=e."SeriesId" join jf_item_info ii on ii."Id"=e."EpisodeId" where "SeasonId"=$1`,
      [Id],
    );
    res.send(rows);
  } catch (error) {
    console.log(error);
  }
});

router.post("/getItemDetails", async (req, res) => {
  try {
    const { Id } = req.body;
    if (Id === undefined) {
      res.status(400);
      res.send("No ID provided");
      return;
    }
    // let query = `SELECT im."Name" "FileName",im.*,i.* FROM jf_library_items i left join jf_item_info im on i."Id" = im."Id" where i."Id"=$1`;
    let query = `SELECT im."Name" "FileName",im."Id",im."Path",im."Name",im."Bitrate",im."MediaStreams",im."Type",  COALESCE(im."Size" ,(SELECT SUM(im."Size") FROM jf_library_seasons s JOIN jf_library_episodes e on s."Id"=e."SeasonId" JOIN jf_item_info im ON im."Id" = e."EpisodeId" WHERE s."SeriesId" = i."Id")) "Size",i.*, (select "Name" from jf_libraries l where l."Id"=i."ParentId") "LibraryName" FROM jf_library_items i left join jf_item_info im on i."Id" = im."Id" where i."Id"=$1`;
    let maxActivityQuery = `SELECT  MAX("ActivityDateInserted") "LastActivityDate" FROM public.jf_playback_activity`;
    let activityCountQuery = `SELECT  Count("ActivityDateInserted") "times_played",  SUM("PlaybackDuration") "total_play_time" FROM public.jf_playback_activity`;

    const { rows: items } = await db.query(query, [Id]);

    if (items.length === 0) {
      // query = `SELECT im."Name" "FileName",im.*,s.*, s.archived, i."PrimaryImageHash"  FROM jf_library_seasons s left join jf_item_info im on s."Id" = im."Id" left join jf_library_items i on i."Id"=s."SeriesId"  where s."Id"=$1`;
      query = `SELECT s."Name", (SELECT SUM(im."Size") FROM jf_library_episodes e JOIN jf_item_info im ON im."Id" = e."EpisodeId" WHERE s."Id" = e."SeasonId") AS "Size", s.*, i."PrimaryImageHash", i."ParentId",(select "Name" from jf_libraries l where l."Id"=i."ParentId") "LibraryName" FROM jf_library_seasons s LEFT JOIN jf_library_items i ON i."Id"=s."SeriesId" WHERE s."Id"=$1`;
      const { rows: seasons } = await db.query(query, [Id]);

      if (seasons.length === 0) {
        query = `SELECT im."Name" "FileName",im.*,e.*, e.archived , i."PrimaryImageHash", i."ParentId",(select "Name" from jf_libraries l where l."Id"=i."ParentId") "LibraryName"  FROM jf_library_episodes e join jf_item_info im on e."EpisodeId" = im."Id" left join jf_library_items i on i."Id"=e."SeriesId" where e."EpisodeId"=$1`;
        const { rows: episodes } = await db.query(query, [Id]);

        if (episodes.length !== 0) {
          maxActivityQuery = `${maxActivityQuery} where "EpisodeId"=$1`;
          activityCountQuery = `${activityCountQuery} where "EpisodeId"=$1`;
          const LastActivityDate = await db.querySingle(maxActivityQuery, [Id]);
          const TimesPlayed = await db.querySingle(activityCountQuery, [Id]);

          episodes.forEach((episode) => {
            episode.LastActivityDate = LastActivityDate.LastActivityDate ?? null;
            episode.times_played = TimesPlayed.times_played ?? null;
            episode.total_play_time = TimesPlayed.total_play_time ?? null;
          });
          res.send(await enrichItemDetails(episodes));
        } else {
          res.status(404).send("Item not found");
        }
      } else {
        maxActivityQuery = `${maxActivityQuery} where "SeasonId"=$1`;
        activityCountQuery = `${activityCountQuery} where "SeasonId"=$1`;
        const LastActivityDate = await db.querySingle(maxActivityQuery, [Id]);
        const TimesPlayed = await db.querySingle(activityCountQuery, [Id]);
        seasons.forEach((season) => {
          season.LastActivityDate = LastActivityDate.LastActivityDate ?? null;
          season.times_played = TimesPlayed.times_played ?? null;
          season.total_play_time = TimesPlayed.total_play_time ?? null;
        });
        res.send(await enrichItemDetails(seasons));
      }
    } else {
      maxActivityQuery = `${maxActivityQuery} where "NowPlayingItemId"=$1`;
      activityCountQuery = `${activityCountQuery} where "NowPlayingItemId"=$1`;
      const LastActivityDate = await db.querySingle(maxActivityQuery, [Id]);
      const TimesPlayed = await db.querySingle(activityCountQuery, [Id]);

      items.forEach((item) => {
        item.LastActivityDate = LastActivityDate.LastActivityDate ?? null;
        item.times_played = TimesPlayed.times_played ?? null;
        item.total_play_time = TimesPlayed.total_play_time ?? null;
      });

      res.send(await enrichItemDetails(items));
    }
  } catch (error) {
    console.log(error);
  }
});

router.delete("/item/purge", async (req, res) => {
  try {
    const { id, withActivity } = req.body;

    if (id === undefined) {
      res.status(400);
      res.send("No Item ID provided");
      return;
    }
    const { rows: items } = await db.query(`select * from jf_library_items where "Id"=$1`, [id]);
    const { rows: seasons } = await db.query(`select * from jf_library_seasons where "SeriesId"=$1 or "Id"=$1`, [id]);
    if (seasons.length > 0) {
      for (const season of seasons) {
        let delete_season_episodes_query = 'delete from jf_library_episodes where "SeasonId"=$1';
        if (!season.archived && (items.length > 0 ? !items[0].archived : true)) {
          delete_season_episodes_query += " and archived=true";
        }
        await db.query(delete_season_episodes_query, [season.Id]);
        if (season.archived || (items.length > 0 && items[0].archived)) {
          await db.query(`delete from jf_library_seasons where "Id"=$1`, [season.Id]);
        }
      }
    } else {
      const { rows: episodes } = await db.query(`select * from jf_library_episodes where "EpisodeId"=$1 and archived=true`, [id]);
      if (episodes.length > 0) {
        await db.query(`delete from jf_library_episodes where "EpisodeId"=$1 and archived=true`, [id]);
      }
      if (items.length > 0 && items[0].archived) {
        await db.query(`delete from jf_library_episodes where "SeriesId"=$1`, [id]);
        await db.query(`delete from jf_library_seasons where "SeriesId"=$1`, [id]);
        await db.query(`delete from jf_library_items where "Id"=$1`, [id]);
      }
      if (withActivity) {
        const episodeIds = episodes.map((item) => item.EpisodeId).filter(Boolean);
        const seasonIds = seasons.map((item) => item.SeasonId).filter(Boolean);
        const params = [];
        const clauses = [];
        if (episodeIds.length > 0) {
          params.push(episodeIds);
          clauses.push(`"EpisodeId" = ANY($${params.length}::text[])`);
        }
        if (seasonIds.length > 0) {
          params.push(seasonIds);
          clauses.push(`"SeasonId" = ANY($${params.length}::text[])`);
        }
        params.push(id);
        clauses.push(`"NowPlayingItemId" = $${params.length}`);
        await db.query(`DELETE FROM jf_playback_activity WHERE ${clauses.join(" OR ")}`, params);
      }
    }

    await db.flushMaterializedViewRefreshes();

    sendUpdate("GeneralAlert", {
      type: "Success",
      message: `Item ${withActivity ? "with Playback Activity" : ""} has been Purged`,
    });
    res.send("Item purged succesfully");
  } catch (error) {
    console.log(error);
    sendUpdate("GeneralAlert", { type: "Error", message: `There was an error Purging the Data` });

    res.status(503);
    sendSafeError(res, error);
  }
});

router.delete("/library/purge", async (req, res) => {
  try {
    const { id, withActivity } = req.body;

    if (id === undefined) {
      res.status(400);
      res.send("No Library ID provided");
      return;
    }

    await purgeLibraryItems(id, withActivity, true);

    await db.query(`delete from jf_libraries where "Id"=$1`, [id]);

    sendUpdate("GeneralAlert", {
      type: "Success",
      message: `Library ${withActivity ? "with Playback Activity" : ""} has been Purged`,
    });
    res.send("Item purged succesfully");
  } catch (error) {
    console.log(error);
    sendUpdate("GeneralAlert", { type: "Error", message: `There was an error Purging the Data` });

    res.status(503);
    sendSafeError(res, error);
  }
});

router.delete("/libraryItems/purge", async (req, res) => {
  try {
    const { id, withActivity } = req.body;
    if (id === undefined) {
      res.status(400);
      res.send("No Library ID provided");
      return;
    }

    await purgeLibraryItems(id, withActivity);

    sendUpdate("GeneralAlert", {
      type: "Success",
      message: `Library Items ${withActivity ? "with Playback Activity" : ""} has been Purged`,
    });
    res.send("Item purged succesfully");
  } catch (error) {
    console.log(error);
    sendUpdate("GeneralAlert", { type: "Error", message: `There was an error Purging the Data` });

    res.status(503);
    sendSafeError(res, error);
  }
});

router.get("/getBackupTables", async (req, res) => {
  try {
    const config = await new configClass().getConfig();
    const excluded_tables = config.settings.ExcludedTables || [];

    let backupTables = tables.map((table) => {
      return {
        ...table,
        Excluded: excluded_tables.includes(table.value),
      };
    });

    res.send(backupTables);
    return;
  } catch (error) {
    res.status(503);
    sendSafeError(res, error);
  }
});

router.post("/setExcludedBackupTable", async (req, res) => {
  const { table } = req.body;
  if (table === undefined || tables.map((item) => item.value).indexOf(table) === -1) {
    res.status(400);
    res.send("Invalid table provided");
    return;
  }

  if (table === "app_config") {
    res.status(400);
    res.send("App Config must stay included so auth settings are backed up");
    return;
  }

  const settingsjson = await db.query('SELECT settings FROM app_config where "ID"=1').then((res) => res.rows);

  if (settingsjson.length > 0) {
    const settings = settingsjson[0].settings || {};

    let excludedTables = settings.ExcludedTables || [];
    if (excludedTables.includes(table)) {
      excludedTables = excludedTables.filter((item) => item !== table);
    } else {
      excludedTables.push(table);
    }
    settings.ExcludedTables = excludedTables;

    let query = 'UPDATE app_config SET settings=$1 where "ID"=1';

    await db.query(query, [settings]);

    let backupTables = tables.map((table) => {
      return {
        ...table,
        Excluded: settings.ExcludedTables.includes(table.value),
      };
    });

    res.send(backupTables);
  } else {
    res.status(404);
    res.send("Settings not found");
  }
});

//DB Queries - History
router.get("/getHistory", async (req, res) => {
  const { size = 50, page = 1, search, sort = "ActivityDateInserted", desc = true, filters } = req.query;

  let filtersArray = [];
  if (filters) {
    try {
      filtersArray = JSON.parse(filters);
    } catch (error) {
      return res.status(400).json({
        error: "Invalid filters parameter",
        example: [
          {
            field: "ActivityDateInserted",
            min: "2024-12-31T22:00:00.000Z",
            max: "2024-12-31T22:00:00.000Z",
          },
          {
            field: "PlaybackDuration",
            min: "1",
            max: "10",
          },
          {
            field: "TotalPlays",
            min: "1",
            max: "10",
          },
          {
            field: "DeviceName",
            value: "test",
          },
          {
            field: "Client",
            value: "test",
          },
          {
            field: "NowPlayingItemName",
            value: "test",
          },
          {
            field: "RemoteEndPoint",
            value: "127.0.0.1",
          },
          {
            field: "UserName",
            value: "test",
          },
        ],
      });
    }
  }

  const sortField = groupedSortMap.find((item) => item.field === sort)?.column || "a.ActivityDateInserted";

  const values = [];
  const settingsResult = await db.query('SELECT settings FROM app_config where "ID"=1').catch(() => ({ rows: [] }));
  const excludedUsers = Array.isArray(settingsResult.rows?.[0]?.settings?.ExcludedUsers) ? settingsResult.rows[0].settings.ExcludedUsers : [];

  try {
    const cte = {
      cteAlias: "activity_results",
      select: [
        "a.NowPlayingItemId",
        `COALESCE(a."EpisodeId", '1') as "EpisodeId"`,
        "a.UserId",
        `json_agg(row_to_json(a) ORDER BY "ActivityDateInserted" DESC) as results`,
        `COUNT(a.*) as "TotalPlays"`,
        `SUM(a."PlaybackDuration") as "TotalDuration"`,
      ],
      table: "jf_playback_activity_with_metadata",
      alias: "a",
      group_by: ["a.NowPlayingItemId", `COALESCE(a."EpisodeId", '1')`, "a.UserId"],
    };

    const query = {
      cte: cte,
      select: [
        "a.*",
        "a.EpisodeNumber",
        "a.SeasonNumber",
        "a.ParentId",
        "li.ImageTagsPrimary as ActivityPosterTag",
        "li.PrimaryImageHash as ActivityPosterBlurHash",
        "ar.results",
        "ar.TotalPlays",
        "ar.TotalDuration",
        `
        CASE 
          WHEN a."SeriesName" is null THEN a."NowPlayingItemName"
          ELSE CONCAT(a."SeriesName" , ' : S' , a."SeasonNumber" , 'E' , a."EpisodeNumber" , ' - ' , a."NowPlayingItemName")
        END AS "FullName"
        `,
      ],
      table: "js_latest_playback_activity",
      alias: "a",
      joins: [
        {
          type: "left",
          table: "activity_results",
          alias: "ar",
          conditions: [
            { first: "a.NowPlayingItemId", operator: "=", second: "ar.NowPlayingItemId" },
            { first: "a.EpisodeId", operator: "=", second: "ar.EpisodeId", type: "and" },
            { first: "a.UserId", operator: "=", second: "ar.UserId", type: "and" },
          ],
        },
        {
          type: "left",
          table: "jf_library_items",
          alias: "li",
          conditions: [{ first: "a.NowPlayingItemId", operator: "=", second: "li.Id" }],
        },
      ],

      order_by: sortField,
      sort_order: desc ? "desc" : "asc",
      pageNumber: page,
      pageSize: size,
    };

    if (search && search.length > 0) {
      query.where = [
        {
          field: `LOWER(
          CASE 
            WHEN a."SeriesName" is null THEN a."NowPlayingItemName"
            ELSE CONCAT(a."SeriesName" , ' : S' , a."SeasonNumber" , 'E' , a."EpisodeNumber" , ' - ' , a."NowPlayingItemName")
          END 
          )`,
          operator: "LIKE",
          value: `$${values.length + 1}`,
        },
      ];

      values.push(`%${search.toLowerCase()}%`);
    }

    query.values = values;

    if (excludedUsers.length) {
      query.where = query.where || [];
      query.where.push({
        column: "a.UserId",
        operator: "<> ALL",
        value: `($${query.values.length + 1}::text[])`,
      });
      query.values.push(excludedUsers);
    }

    dbHelper.buildFilterList(query, filtersArray, filterFields);
    const result = await dbHelper.query(query);

    result.results = result.results.map((item) => ({
      ...item,
      PlaybackDuration: item.TotalDuration ? item.TotalDuration : item.PlaybackDuration,
    }));
    const response = { current_page: page, pages: result.pages, size: size, sort: sort, desc: desc, results: result.results };
    if (search && search.length > 0) {
      response.search = search;
    }

    if (filtersArray.length > 0) {
      response.filters = filtersArray;
    }

    res.send(response);
  } catch (error) {
    console.log(error);
  }
});

router.post("/getLibraryHistory", async (req, res) => {
  try {
    const { size = 50, page = 1, search, sort = "ActivityDateInserted", desc = true, filters } = req.query;

    let filtersArray = [];
    if (filters) {
      try {
        filtersArray = JSON.parse(filters);
      } catch (error) {
        return res.status(400).json({
          error: "Invalid filters parameter",
          example: [
            {
              field: "ActivityDateInserted",
              min: "2024-12-31T22:00:00.000Z",
              max: "2024-12-31T22:00:00.000Z",
            },
            {
              field: "PlaybackDuration",
              min: "1",
              max: "10",
            },
            {
              field: "TotalPlays",
              min: "1",
              max: "10",
            },
            {
              field: "DeviceName",
              value: "test",
            },
            {
              field: "Client",
              value: "test",
            },
            {
              field: "NowPlayingItemName",
              value: "test",
            },
            {
              field: "RemoteEndPoint",
              value: "127.0.0.1",
            },
            {
              field: "UserName",
              value: "test",
            },
          ],
        });
      }
    }
    const { libraryid } = req.body;

    if (libraryid === undefined) {
      res.status(400);
      res.send("No Library ID provided");
      return;
    }

    const sortField = groupedSortMap.find((item) => item.field === sort)?.column || "a.ActivityDateInserted";
    const values = [];

    const cte = {
      cteAlias: "activity_results",
      select: [
        "a.NowPlayingItemId",
        `COALESCE(a."EpisodeId", '1') as "EpisodeId"`,
        "a.UserId",
        `json_agg(row_to_json(a) ORDER BY "ActivityDateInserted" DESC) as results`,
        `COUNT(a.*) as "TotalPlays"`,
        `SUM(a."PlaybackDuration") as "TotalDuration"`,
      ],
      table: "jf_playback_activity_with_metadata",
      alias: "a",
      group_by: ["a.NowPlayingItemId", `COALESCE(a."EpisodeId", '1')`, "a.UserId"],
    };

    const query = {
      cte: cte,
      select: [
        "a.*",
        "a.EpisodeNumber",
        "a.SeasonNumber",
        "a.ParentId",
        "ar.results",
        "ar.TotalPlays",
        "ar.TotalDuration",
        `
        CASE 
          WHEN a."SeriesName" is null THEN a."NowPlayingItemName"
          ELSE CONCAT(a."SeriesName" , ' : S' , a."SeasonNumber" , 'E' , a."EpisodeNumber" , ' - ' , a."NowPlayingItemName")
        END AS "FullName"
        `,
      ],
      table: "js_latest_playback_activity",
      alias: "a",
      joins: [
        {
          type: "inner",
          table: "jf_library_items",
          alias: "i",
          conditions: [
            { first: "i.Id", operator: "=", second: "a.NowPlayingItemId" },
            { first: "i.ParentId", operator: "=", value: `$${values.length + 1}` },
          ],
        },
        {
          type: "left",
          table: "activity_results",
          alias: "ar",
          conditions: [
            { first: "a.NowPlayingItemId", operator: "=", second: "ar.NowPlayingItemId" },
            { first: "a.EpisodeId", operator: "=", second: "ar.EpisodeId", type: "and" },
            { first: "a.UserId", operator: "=", second: "ar.UserId", type: "and" },
          ],
        },
      ],

      order_by: sortField,
      sort_order: desc ? "desc" : "asc",
      pageNumber: page,
      pageSize: size,
    };

    values.push(libraryid);

    if (search && search.length > 0) {
      query.where = [
        {
          field: `LOWER(
          CASE 
            WHEN a."SeriesName" is null THEN a."NowPlayingItemName"
            ELSE CONCAT(a."SeriesName" , ' : S' , a."SeasonNumber" , 'E' , a."EpisodeNumber" , ' - ' , a."NowPlayingItemName")
          END 
          )`,
          operator: "LIKE",
          value: `$${values.length + 1}`,
        },
      ];

      values.push(`%${search.toLowerCase()}%`);
    }

    query.values = values;

    dbHelper.buildFilterList(query, filtersArray, filterFields);

    const result = await dbHelper.query(query);

    result.results = result.results.map((item) => ({
      ...item,
      PlaybackDuration: item.TotalDuration ? item.TotalDuration : item.PlaybackDuration,
    }));

    const response = { current_page: page, pages: result.pages, size: size, sort: sort, desc: desc, results: result.results };
    if (search && search.length > 0) {
      response.search = search;
    }
    if (filtersArray.length > 0) {
      response.filters = filtersArray;
    }
    res.send(response);
  } catch (error) {
    console.log(error);
    res.status(503);
    sendSafeError(res, error);
  }
});

router.post("/getItemHistory", async (req, res) => {
  try {
    const { size = 50, page = 1, search, sort = "ActivityDateInserted", desc = true, filters } = req.query;
    const { itemid } = req.body;

    if (itemid === undefined) {
      res.status(400);
      res.send("No Item ID provided");
      return;
    }

    let filtersArray = [];
    if (filters) {
      try {
        filtersArray = JSON.parse(filters);
        filtersArray = filtersArray.filter((filter) => filter.field !== "TotalPlays");
      } catch (error) {
        return res.status(400).json({
          error: "Invalid filters parameter",
          example: [
            {
              field: "ActivityDateInserted",
              min: "2024-12-31T22:00:00.000Z",
              max: "2024-12-31T22:00:00.000Z",
            },
            {
              field: "PlaybackDuration",
              min: "1",
              max: "10",
            },
            {
              field: "TotalPlays",
              min: "1",
              max: "10",
            },
            {
              field: "DeviceName",
              value: "test",
            },
            {
              field: "Client",
              value: "test",
            },
            {
              field: "NowPlayingItemName",
              value: "test",
            },
            {
              field: "RemoteEndPoint",
              value: "127.0.0.1",
            },
            {
              field: "UserName",
              value: "test",
            },
          ],
        });
      }
    }

    const sortField = unGroupedSortMap.find((item) => item.field === sort)?.column || "a.ActivityDateInserted";
    const values = [];
    const query = {
      select: [
        "a.*",
        "a.EpisodeNumber",
        "a.SeasonNumber",
        "a.ParentId",
        `
        CASE 
          WHEN a."SeriesName" is null THEN a."NowPlayingItemName"
          ELSE CONCAT(a."SeriesName" , ' : S' , a."SeasonNumber" , 'E' , a."EpisodeNumber" , ' - ' , a."NowPlayingItemName")
        END AS "FullName"
        `,
      ],
      table: "jf_playback_activity_with_metadata",
      alias: "a",
      where: [
        [
          { column: "a.EpisodeId", operator: "=", value: `$${values.length + 1}` },
          { column: "a.SeasonId", operator: "=", value: `$${values.length + 2}`, type: "or" },
          { column: "a.NowPlayingItemId", operator: "=", value: `$${values.length + 3}`, type: "or" },
        ],
      ],
      order_by: sortField,
      sort_order: desc ? "desc" : "asc",
      pageNumber: page,
      pageSize: size,
    };

    values.push(itemid);
    values.push(itemid);
    values.push(itemid);

    if (search && search.length > 0) {
      query.where = [
        {
          field: `LOWER(
          CASE 
            WHEN a."SeriesName" is null THEN a."NowPlayingItemName"
            ELSE CONCAT(a."SeriesName" , ' : S' , a."SeasonNumber" , 'E' , a."EpisodeNumber" , ' - ' , a."NowPlayingItemName")
          END 
          )`,
          operator: "LIKE",
          value: `$${values.length + 1}`,
        },
      ];
      values.push(`%${search.toLowerCase()}%`);
    }

    query.values = values;
    dbHelper.buildFilterList(query, filtersArray, filterFields);
    const result = await dbHelper.query(query);

    const response = { current_page: page, pages: result.pages, size: size, sort: sort, desc: desc, results: result.results };
    if (search && search.length > 0) {
      response.search = search;
    }

    if (filters) {
      response.filters = JSON.parse(filters);
    }

    res.send(response);
  } catch (error) {
    console.log(error);
    res.status(503);
    sendSafeError(res, error);
  }
});

router.post("/getUserHistory", async (req, res) => {
  try {
    const { size = 50, page = 1, search, sort = "ActivityDateInserted", desc = true, filters } = req.query;

    let filtersArray = [];
    if (filters) {
      try {
        filtersArray = JSON.parse(filters);
        filtersArray = filtersArray.filter((filter) => filter.field !== "TotalPlays");
      } catch (error) {
        return res.status(400).json({
          error: "Invalid filters parameter",
          example: [
            {
              field: "ActivityDateInserted",
              min: "2024-12-31T22:00:00.000Z",
              max: "2024-12-31T22:00:00.000Z",
            },
            {
              field: "PlaybackDuration",
              min: "1",
              max: "10",
            },
            {
              field: "TotalPlays",
              min: "1",
              max: "10",
            },
            {
              field: "DeviceName",
              value: "test",
            },
            {
              field: "Client",
              value: "test",
            },
            {
              field: "NowPlayingItemName",
              value: "test",
            },
            {
              field: "RemoteEndPoint",
              value: "127.0.0.1",
            },
            {
              field: "UserName",
              value: "test",
            },
          ],
        });
      }
    }
    const { userid } = req.body;

    if (userid === undefined) {
      res.status(400);
      res.send("No User ID provided");
      return;
    }

    const sortField = unGroupedSortMap.find((item) => item.field === sort)?.column || "a.ActivityDateInserted";

    const values = [];
    const query = {
      select: [
        "a.*",
        "a.EpisodeNumber",
        "a.SeasonNumber",
        "a.ParentId",
        `
        CASE 
          WHEN a."SeriesName" is null THEN a."NowPlayingItemName"
          ELSE CONCAT(a."SeriesName" , ' : S' , a."SeasonNumber" , 'E' , a."EpisodeNumber" , ' - ' , a."NowPlayingItemName")
        END AS "FullName"
        `,
      ],
      table: "jf_playback_activity_with_metadata",
      alias: "a",
      where: [[{ column: "a.UserId", operator: "=", value: `$${values.length + 1}` }]],
      order_by: sortField,
      sort_order: desc ? "desc" : "asc",
      pageNumber: page,
      pageSize: size,
    };

    values.push(userid);

    if (search && search.length > 0) {
      query.where = [
        {
          field: `LOWER(
          CASE 
            WHEN a."SeriesName" is null THEN a."NowPlayingItemName"
            ELSE CONCAT(a."SeriesName" , ' : S' , a."SeasonNumber" , 'E' , a."EpisodeNumber" , ' - ' , a."NowPlayingItemName")
          END 
          )`,
          operator: "LIKE",
          value: `$${values.length + 1}`,
        },
      ];
      values.push(`%${search.toLowerCase()}%`);
    }

    query.values = values;

    dbHelper.buildFilterList(query, filtersArray, filterFields);

    const result = await dbHelper.query(query);

    const response = { current_page: page, pages: result.pages, size: size, sort: sort, desc: desc, results: result.results };

    if (search && search.length > 0) {
      response.search = search;
    }

    if (filters) {
      response.filters = JSON.parse(filters);
    }

    res.send(response);
  } catch (error) {
    console.log(error);
    res.status(503);
    sendSafeError(res, error);
  }
});

router.post("/deletePlaybackActivity", async (req, res) => {
  try {
    const { ids } = req.body;

    if (ids === undefined || !Array.isArray(ids)) {
      res.status(400);
      res.send("A list of IDs is required. EG: [1,2,3]");
      return;
    }

    await db.query(`DELETE from jf_playback_activity where "Id" = ANY($1)`, [ids], true);
    res.json({ deleted: ids.length });
  } catch (error) {
    console.log(error);
    res.status(503);
    sendSafeError(res, error);
  }
});

router.get("/getTimelineUsers", async (req, res) => {
  try {
    const { rows } = await db.query(`SELECT "Id" AS "UserId", "Name" AS "UserName" FROM jf_users ORDER BY "Name"`);
    res.send(rows);
  } catch (error) {
    console.log(error);
    res.status(503);
    sendSafeError(res, error);
  }
});

router.post("/getActivityTimeLine", async (req, res) => {
  try {
    const { userId, libraries } = req.body;

    if (libraries !== undefined && !Array.isArray(libraries)) {
      res.status(400);
      res.send("A list of IDs is required. EG: [1,2,3]");
      return;
    }

    if (userId === undefined) {
      res.status(400);
      res.send("A userId is required.");
      return;
    }

    const libraryIds = Array.isArray(libraries) ? libraries : [];
    const limit = Math.min(Math.max(Number(req.body.limit) || 40, 1), 100);
    const offset = Math.max(Number(req.body.offset) || 0, 0);

    const { rows } = await db.query(`SELECT * FROM fs_get_user_activity($1, $2::text[]) LIMIT $3 OFFSET $4`, [
      userId,
      libraryIds,
      limit + 1,
      offset,
    ]);
    const hasMore = rows.length > limit;
    res.send({ results: rows.slice(0, limit), hasMore });
  } catch (error) {
    console.log(error);
    res.status(503);
    sendSafeError(res, error);
  }
});

// Downloads

router.get("/integrations", async (req, res) => {
  try {
    res.send(await getIntegrations());
  } catch (error) {
    console.error("Get integrations failed:", error);
    res.status(503).send({ error: "Unable to load integrations" });
  }
});

router.post("/integrations", async (req, res) => {
  try {
    const saved = await saveIntegrations(req.body || {});
    await addAuditEntry(req, "integrations.updated", {
      arrApps: saved.arrApps?.length || 0,
      clients: saved.clients?.length || 0,
      thirdParty: saved.thirdParty?.length || 0,
    });
    res.json(saved);
  } catch (error) {
    console.error("Save integrations failed:", error);
    res.status(503).send({ error: "Unable to save integrations" });
  }
});

router.post("/first-run/extras-complete", async (req, res) => {
  try {
    const completedAt = new Date().toISOString();
    await db.query(
      `
        UPDATE app_config
        SET settings = (COALESCE(settings, '{}'::json)::jsonb || $1::jsonb)::json
        WHERE "ID" = 1
      `,
      [{ firstRunExtrasPending: false, firstRunExtrasCompleted: true, firstRunExtrasCompletedAt: completedAt }]
    );
    await addAuditEntry(req, "first_run.extras_completed", { completedAt });
    res.send({ firstRunExtrasCompleted: true, firstRunExtrasCompletedAt: completedAt });
  } catch (error) {
    console.error("Complete first-run extras failed:", error);
    res.status(503).send({ error: "Unable to complete first-run setup" });
  }
});

router.post("/first-run/start-sync", async (req, res) => {
  try {
    const completedAt = new Date().toISOString();
    await db.query(
      `
        UPDATE app_config
        SET settings = (COALESCE(settings, '{}'::json)::jsonb || $1::jsonb)::json
        WHERE "ID" = 1
      `,
      [{ firstRunExtrasPending: false, firstRunExtrasCompleted: true, firstRunExtrasCompletedAt: completedAt, firstRunSyncStartedAt: completedAt }]
    );
    queueFirstRunJellyfinTasks();
    await addAuditEntry(req, "first_run.sync_started", { completedAt });
    res.send({ firstRunExtrasCompleted: true, firstRunSyncStartedAt: completedAt });
  } catch (error) {
    console.error("Start first-run sync failed:", error);
    res.status(503).send({ error: "Unable to start first sync" });
  }
});

router.get("/integrations/health-history", async (req, res) => {
  try {
    res.send(await getIntegrationHealthHistory());
  } catch (error) {
    console.error("Get integration health history failed:", error);
    res.status(503).send({ error: "Unable to load integration health history" });
  }
});

router.post("/integrations/test-all", async (req, res) => {
  try {
    const integrations = await getIntegrations();
    const arrApps = (integrations.arrApps || []).filter((integration) => integration.connected);
    const clients = (integrations.clients || []).filter((integration) => integration.connected);
    const thirdParty = (integrations.thirdParty || []).filter((integration) => integration.connected);
    const allIntegrations = [
      ...arrApps.map((integration) => ({ integration, type: "automation" })),
      ...clients.map((integration) => ({ integration, type: "download" })),
      ...thirdParty.map((integration) => ({ integration, type: "thirdParty" })),
    ];

    const checkedAt = new Date().toISOString();
    const results = await Promise.all(
      allIntegrations.map(async ({ integration, type }) => {
        try {
          const result =
            type === "download" ? await testDownloadIntegration(integration) : type === "thirdParty" ? await testThirdPartyIntegration(integration) : await testArrIntegration(integration);
          return {
            instanceId: integration.instanceId,
            name: integration.name,
            type,
            ok: Boolean(result.ok),
            version: result.version || "",
            message: result.message || (result.ok ? "Connected" : "Connection failed"),
            checkedAt,
          };
        } catch (error) {
          return {
            instanceId: integration.instanceId,
            name: integration.name,
            type,
            ok: false,
            version: "",
            message: getAxiosErrorMessage(error),
            checkedAt,
          };
        }
      })
    );

    const history = await saveIntegrationHealthResults(results);
    res.send({ results, history });
  } catch (error) {
    console.error("Test all integrations failed:", error);
    res.status(503).send({ error: "Unable to test integrations" });
  }
});

async function hydrateIntegrationForTest(integration, type) {
  const integrations = await getIntegrations();
  const list =
    type === "download" ? integrations.clients : type === "thirdParty" ? integrations.thirdParty : integrations.arrApps;
  const current = (list || []).find(
    (item) => item.instanceId === integration.instanceId || (integration.slug && item.slug === integration.slug)
  );
  if (!current?.values?.secret || integration.values?.secret) return integration;
  return {
    ...integration,
    values: {
      ...(integration.values || {}),
      secret: current.values.secret,
      username: integration.values?.username || current.values.username,
    },
  };
}

router.post("/integrations/test", async (req, res) => {
  const { integration, type } = req.body || {};

  if (!integration) {
    return res.status(400).send({ ok: false, error: "Integration is required" });
  }

  try {
    const hydrated = await hydrateIntegrationForTest(integration, type);
    const result = type === "download" ? await testDownloadIntegration(hydrated) : type === "thirdParty" ? await testThirdPartyIntegration(hydrated) : await testArrIntegration(hydrated);
    if (!result.ok) {
      return res.status(400).send(result);
    }
    return res.send(result);
  } catch (error) {
    return res.status(503).send({
      ok: false,
      error: getAxiosErrorMessage(error),
    });
  }
});

router.get("/audiobookshelf", async (req, res) => {
  try {
    const integration = await audiobookshelf.getConnectedAudiobookshelf();
    if (!integration) {
      return res.status(404).send({ error: "Connect Audiobookshelf in Settings > Integrations > 3rd party apps first." });
    }
    res.send(await audiobookshelf.fetchAudiobookshelfBundle(integration));
  } catch (error) {
    console.error("Audiobookshelf summary failed:", getAxiosErrorMessage(error));
    res.status(error.response?.status || 503).send({ error: getAxiosErrorMessage(error) || "Unable to load Audiobookshelf data" });
  }
});

router.get("/maintainerr", async (req, res) => {
  try {
    const integration = await getConnectedMaintainerrIntegration();
    if (!integration) {
      return res.status(404).send({ error: "Connect Maintainerr in Settings > Integrations first." });
    }
    const bundle = await fetchMaintainerrBundle(integration);
    res.send(bundle);
  } catch (error) {
    console.error("Maintainerr summary failed:", getAxiosErrorMessage(error));
    res.status(error.response?.status || 503).send({ error: getAxiosErrorMessage(error) || "Unable to load Maintainerr data" });
  }
});

router.post("/maintainerr/actions", async (req, res) => {
  try {
    const integration = await getConnectedMaintainerrIntegration();
    if (!integration) {
      return res.status(404).send({ error: "Connect Maintainerr in Settings > Integrations first." });
    }
    const payload = req.body || {};
    const result = await runMaintainerrAction(integration, payload);
    const webhookManager = new WebhookManager();
    await webhookManager.triggerEventWebhooks("maintainerr.action", {
      integrationEvent: "maintainerr action",
      source: integration.name || "Maintainerr",
      action: payload.action,
      collectionId: payload.collectionId,
      itemId: payload.itemId,
      message: `${payload.action} triggered from JellyGlance`,
    });
    res.send(result);
  } catch (error) {
    console.error("Maintainerr action failed:", sanitizeForLog(getAxiosErrorMessage(error)));
    res.status(error.response?.status || 503).send({ error: getAxiosErrorMessage(error) || "Unable to run Maintainerr action" });
  }
});

router.get("/wizarr/summary", async (req, res) => {
  try {
    const integration = await getConnectedWizarrIntegration();
    if (!integration) {
      return res.status(404).send({ error: "Connect Wizarr in Settings > Integrations first." });
    }
    res.send(await fetchWizarrBundle(integration));
  } catch (error) {
    console.error("Wizarr summary failed:", getAxiosErrorMessage(error));
    res.status(error.response?.status || 503).send({ error: getAxiosErrorMessage(error) || "Unable to load Wizarr invites" });
  }
});

router.post("/wizarr/invitations", async (req, res) => {
  try {
    const integration = await getConnectedWizarrIntegration();
    if (!integration) {
      return res.status(404).send({ error: "Connect Wizarr in Settings > Integrations first." });
    }

    const body = req.body || {};
    const serverIds = Array.isArray(body.serverIds) ? body.serverIds.map(Number).filter(Number.isFinite) : [];
    const libraryIds = Array.isArray(body.libraryIds) ? body.libraryIds.map(Number).filter(Number.isFinite) : [];
    const expiresInDays = body.expiresInDays === "" || body.expiresInDays == null ? null : Number(body.expiresInDays);
    const duration = body.duration === "" || body.duration == null ? "unlimited" : String(body.duration);
    const wizardBundleId = body.wizardBundleId === "" || body.wizardBundleId == null ? null : Number(body.wizardBundleId);
    const customCode = String(body.customCode || "").trim().toUpperCase();
    const sendInviteEmail = Boolean(body.sendEmail);
    const emailRecipient = String(body.emailRecipient || "").trim();

    if (!serverIds.length) {
      return res.status(400).send({ error: "Choose at least one Wizarr server." });
    }
    if (sendInviteEmail && !validateEmail(emailRecipient)) {
      return res.status(400).send({ error: "Enter a valid email recipient for the invite." });
    }

    const url = cleanIntegrationUrl(integration.values?.url);
    const response = await axios.post(
      `${url}/api/invitations`,
      {
        server_ids: serverIds,
        library_ids: libraryIds,
        ...(Number.isFinite(expiresInDays) ? { expires_in_days: expiresInDays } : {}),
        duration,
        unlimited: body.unlimited !== false,
        allow_downloads: Boolean(body.allowDownloads),
        allow_live_tv: Boolean(body.allowLiveTv),
        allow_mobile_uploads: Boolean(body.allowMobileUploads),
        ...(Number.isFinite(wizardBundleId) ? { wizard_bundle_id: wizardBundleId } : {}),
        ...(customCode ? { code: customCode, invite_code: customCode } : {}),
      },
      {
        timeout: 12000,
        headers: {
          ...getWizarrHeaders(integration),
          "Content-Type": "application/json",
        },
      }
    );

    const normalizedInvite = normalizeWizarrInvite(response.data?.invitation || response.data, url);
    let emailResult = null;
    if (sendInviteEmail) {
      const email = buildWizarrInviteEmail(normalizedInvite, integration);
      emailResult = await sendConfiguredMail({
        to: emailRecipient,
        subject: email.subject,
        text: email.text,
        html: email.html,
      });
      await addAuditEntry(req, "wizarr.invitation.emailed", {
        source: integration.name,
        code: normalizedInvite.code,
        recipient: emailRecipient,
        messageId: emailResult.messageId,
      });
    }

    const webhookManager = new WebhookManager();
    await webhookManager.triggerEventWebhooks("invite_created", {
      integrationEvent: "invite created",
      source: integration.name || "Wizarr",
      code: normalizedInvite.code,
      url: normalizedInvite.url,
      serverIds,
      libraryIds,
      emailRecipient: sendInviteEmail ? emailRecipient : "",
      message: `Invite ${normalizedInvite.code || normalizedInvite.id || "link"} created from JellyGlance.`,
    });

    await addAuditEntry(req, "wizarr.invitation.created", { source: integration.name, serverIds, libraryIds });
    res.status(response.status === 201 ? 201 : 200).send({
      message: emailResult ? "Invitation created and emailed" : response.data?.message || "Invitation created",
      invitation: normalizedInvite,
      email: emailResult,
    });
  } catch (error) {
    console.error("Wizarr invitation create failed:", getAxiosErrorMessage(error));
    res.status(error.response?.status || 503).send({ error: getAxiosErrorMessage(error) || "Unable to create Wizarr invitation" });
  }
});

router.delete("/wizarr/invitations/:id", async (req, res) => {
  try {
    const integration = await getConnectedWizarrIntegration();
    if (!integration) {
      return res.status(404).send({ error: "Connect Wizarr in Settings > Integrations first." });
    }
    const url = cleanIntegrationUrl(integration.values?.url);
    const response = await axios.delete(`${url}/api/invitations/${encodeURIComponent(req.params.id)}`, {
      timeout: 10000,
      headers: getWizarrHeaders(integration),
    });
    const webhookManager = new WebhookManager();
    await webhookManager.triggerEventWebhooks("invite_deleted", {
      integrationEvent: "invite deleted",
      source: integration.name || "Wizarr",
      id: req.params.id,
      message: `Invite ${req.params.id} deleted from JellyGlance.`,
    });
    await addAuditEntry(req, "wizarr.invitation.deleted", { source: integration.name, id: req.params.id });
    res.send(response.data || { message: "Invitation deleted" });
  } catch (error) {
    console.error("Wizarr invitation delete failed:", getAxiosErrorMessage(error));
    res.status(error.response?.status || 503).send({ error: getAxiosErrorMessage(error) || "Unable to delete Wizarr invitation" });
  }
});

router.get("/tdarr/transcodes", async (req, res) => {
  try {
    const integration = await getConnectedTdarrIntegration();
    if (!integration) {
      return res.status(404).send({ error: "Connect Tdarr in Settings > Integrations first." });
    }
    const activeOnly = req.query?.activeOnly === "true";
    const cacheKey = `${integration.instanceId || integration.name || cleanIntegrationUrl(integration.values?.url) || "tdarr"}:${activeOnly ? "active" : "full"}`;
    const cached = tdarrTranscodeCache.get(cacheKey);
    if (req.query?.force !== "true" && cached && Date.now() - cached.cachedAt < TDARR_TRANSCODE_CACHE_TTL_MS) {
      return res.send(cached.data);
    }

    const bundle = await fetchTdarrBundle(integration, { activeOnly });
    tdarrTranscodeCache.set(cacheKey, { cachedAt: Date.now(), data: bundle });
    res.send(bundle);
  } catch (error) {
    console.error("Tdarr transcodes load failed:", getAxiosErrorMessage(error));
    res.status(error.response?.status || 503).send({ error: getAxiosErrorMessage(error) || "Unable to load Tdarr transcodes" });
  }
});

router.post("/tdarr/actions", async (req, res) => {
  try {
    const integration = await getConnectedTdarrIntegration();
    if (!integration) {
      return res.status(404).send({ error: "Connect Tdarr in Settings > Integrations first." });
    }
    const result = await runTdarrAction(integration, req.body || {});
    clearTdarrTranscodeCache();
    await addAuditEntry(req, "tdarr.action", {
      source: integration.name || "Tdarr",
      action: result.action,
      nodeId: req.body?.nodeId || req.body?.nodeID || result.nodeId || "",
      workerId: req.body?.workerId || req.body?.workerID || "",
      fileId: req.body?.fileId || req.body?.id || "",
    });
    res.send(result);
  } catch (error) {
    console.error("Tdarr action failed:", sanitizeForLog(getAxiosErrorMessage(error)));
    res.status(error.statusCode || error.response?.status || 503).send({ error: getAxiosErrorMessage(error) || "Unable to run Tdarr action" });
  }
});

router.get("/integrations/calendar", async (req, res) => {
  try {
    const data = await getIntegrationData();
    res.send(data.calendar);
  } catch (error) {
    console.error("Get calendar integration data failed:", error);
    res.status(503).send({ error: "Unable to load calendar data" });
  }
});

router.get("/integrations/downloads", async (req, res) => {
  try {
    const data = await getIntegrationData();
    res.send(data.downloads);
  } catch (error) {
    console.error("Get download integration data failed:", error);
    res.status(503).send({ error: "Unable to load download data" });
  }
});

router.post("/downloads/add", async (req, res) => {
  const { client, instanceId, value, fileName } = req.body || {};
  const downloadName = fileName || value?.trim();

  if (!client && !instanceId) {
    return res.status(400).send({ error: "Download client is required" });
  }

  if (!downloadName) {
    return res.status(400).send({ error: "Torrent URL, magnet link, or torrent file is required" });
  }

  const isMagnet = typeof value === "string" && value.trim().startsWith("magnet:");
  const isTorrentUrl = typeof value === "string" && isHttpTorrentUrl(value);

  if (!isMagnet && !isTorrentUrl) {
    return res.status(400).send({ error: "Use a magnet link or a .torrent URL. File upload is not sent to the client yet." });
  }

  try {
    await addDownload({ instanceId, client, value });

    const webhookManager = new WebhookManager();
    await webhookManager.triggerEventWebhooks("download_added", {
      integrationEvent: "download added",
      client,
      downloadName,
      sourceType: isMagnet ? "magnet" : "torrent_url",
      message: `${downloadName} queued for ${client}.`,
    });

    sendUpdate("GeneralAlert", { type: "Success", message: `${downloadName} queued for ${client}` });
    return res.send({ ok: true, downloadName });
  } catch (error) {
    console.error("Download add event failed:", error);
    return res.status(error.statusCode || 500).send({ error: error.message || "Unable to queue download" });
  }
});

router.post("/downloads/remove", async (req, res) => {
  try {
    res.send(await deleteDownload(req.body?.id, { deleteFiles: Boolean(req.body?.deleteFiles) }));
  } catch (error) {
    console.error("Download remove failed:", error);
    res.status(error.statusCode || 500).send({ error: error.message || "Unable to remove download" });
  }
});

router.post("/downloads/pause", async (req, res) => {
  try {
    res.send(await setDownloadPaused(req.body?.id, Boolean(req.body?.paused)));
  } catch (error) {
    console.error("Download pause failed:", error);
    res.status(error.statusCode || 500).send({ error: error.message || "Unable to update download" });
  }
});

router.post("/sessions/stop", async (req, res) => {
  try {
    const sessionId = String(req.body?.sessionId || "").trim();
    if (!sessionId) {
      return res.status(400).send({ error: "Missing sessionId" });
    }
    await API.stopSession(sessionId);
    await addAuditEntry(req, "session.stopped", { sessionId });
    res.send({ ok: true });
  } catch (error) {
    console.error("Session stop failed:", error);
    res.status(error.statusCode || error.response?.status || 500).send({ error: error.message || "Unable to stop session" });
  }
});

router.post("/sessions/message", async (req, res) => {
  try {
    const sessionId = String(req.body?.sessionId || "").trim();
    const text = String(req.body?.text || "").trim();
    if (!sessionId || !text) {
      return res.status(400).send({ error: "Missing sessionId or message text" });
    }
    await API.sendSessionMessage(sessionId, {
      header: req.body?.header || "JellyGlance",
      text,
      timeoutMs: req.body?.timeoutMs,
    });
    await addAuditEntry(req, "session.messaged", { sessionId });
    res.send({ ok: true });
  } catch (error) {
    console.error("Session message failed:", error);
    res.status(error.statusCode || error.response?.status || 500).send({ error: error.message || "Unable to send session message" });
  }
});

//Tasks

router.get("/stopTask", async (req, res) => {
  const { task } = req.query;

  if (task === undefined) {
    res.status(400);
    res.send("No Task provided");
    return;
  }
  const taskManager = new TaskManager().getInstance();
  if (taskManager.taskList[task] === undefined) {
    res.status(404);
    res.send("Task not found");
    return;
  }

  const _task = taskManager.taskList[task];

  if (taskManager.isTaskRunning(_task.name)) {
    taskManager.stopTask(_task);
    res.send("Task Stopped");
    return;
  } else {
    res.status(400);
    res.send("Task is not running");
    return;
  }
});

router.get("/server-management/status", async (req, res) => {
  try {
    res.send(await buildServerManagementStatus());
  } catch (error) {
    console.error("Server management status failed:", error);
    res.status(503).send({ error: "Unable to load server management status" });
  }
});

router.post("/server-management/action", async (req, res) => {
  const { action, taskId } = req.body || {};

  if (!action) {
    res.status(400).send({ error: "No action provided" });
    return;
  }

  if (action !== "runJellyfinTask" && action !== "updateJellyfinTaskTriggers") {
    res.status(400).send({ error: "Unsupported Jellyfin job action" });
    return;
  }

  try {
    if (!taskId) {
      res.status(400).send({ error: "No Jellyfin task id provided" });
      return;
    }

    if (action === "updateJellyfinTaskTriggers") {
      if (!Array.isArray(req.body.triggers)) {
        res.status(400).send({ error: "No schedule list provided" });
        return;
      }

      const triggers = req.body.triggers.map((trigger) => normalizeTriggerForJellyfin(trigger));
      if (triggers.some((trigger) => !trigger)) {
        res.status(400).send({ error: "One or more schedules are invalid" });
        return;
      }

      await jellyfinRequest(`/ScheduledTasks/${encodeURIComponent(taskId)}/Triggers`, {
        method: "post",
        data: triggers,
      });
      await addAuditEntry(req, "server-management.action", {
        action,
        taskId,
        triggerCount: triggers.length,
      });
      sendUpdate("GeneralAlert", { type: "Success", message: "Jellyfin job schedule saved" });
      res.send({ ok: true, action, taskId, triggers });
      return;
    }

    await jellyfinRequest(`/ScheduledTasks/Running/${encodeURIComponent(taskId)}`, { method: "post" });
    await addAuditEntry(req, "server-management.action", {
      action,
      taskId,
    });
    sendUpdate("GeneralAlert", { type: "Success", message: "Jellyfin job started" });
    res.send({ ok: true, action, taskId });
  } catch (error) {
    const statusCode = error.statusCode || error.response?.status || 503;
    const message = getAxiosErrorMessage(error);
    const failMessage = action === "updateJellyfinTaskTriggers" ? "Jellyfin job schedule failed to save" : "Jellyfin job failed to start";
    console.error("Jellyfin job action failed:", message);
    sendUpdate("TaskError", { type: "Error", message: failMessage });
    res.status(statusCode).send({ error: message });
  }
});

router.get("/jellyfin/devices", async (req, res) => {
  try {
    const response = await jellyfinRequest("/Devices");
    const devices = Array.isArray(response.data?.Items) ? response.data.Items : Array.isArray(response.data) ? response.data : [];
    const normalized = devices.map(normalizeJellyfinDevice).sort((a, b) => new Date(b.dateLastActivity || 0) - new Date(a.dateLastActivity || 0));
    const seen = await rememberDevices(normalized).catch(() => ({ fresh: [] }));
    res.send({
      devices: normalized,
      total: Number(response.data?.TotalRecordCount ?? devices.length),
      newDevices: seen.fresh || [],
      syncedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Jellyfin devices load failed:", getAxiosErrorMessage(error));
    res.status(error.response?.status || 503).send({ error: getAxiosErrorMessage(error) || "Unable to load Jellyfin devices" });
  }
});

router.get("/jellyfin/plugins", async (req, res) => {
  try {
    const [response, packagesResponse] = await Promise.all([
      jellyfinRequest("/Plugins"),
      jellyfinRequest("/Packages").catch(() => ({ data: [] })),
    ]);
    const plugins = Array.isArray(response.data) ? response.data : Array.isArray(response.data?.Items) ? response.data.Items : [];
    const packages = Array.isArray(packagesResponse.data)
      ? packagesResponse.data
      : Array.isArray(packagesResponse.data?.Items)
        ? packagesResponse.data.Items
        : [];
    const normalizedPlugins = plugins.map((plugin) => {
      const packageInfo = matchJellyfinPluginPackage(plugin, packages);
      return normalizeJellyfinPlugin({
        ...plugin,
        imageUrl: buildPluginImageProxyUrl(packageInfo?.imageUrl || packageInfo?.ImageUrl || plugin.ImageUrl || plugin.imageUrl),
      });
    });
    res.send({
      plugins: normalizedPlugins.sort((a, b) => a.name.localeCompare(b.name)),
      total: plugins.length,
      enabled: normalizedPlugins.filter((plugin) => plugin.enabled).length,
      syncedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Jellyfin plugins load failed:", getAxiosErrorMessage(error));
    res.status(error.response?.status || 503).send({ error: getAxiosErrorMessage(error) || "Unable to load Jellyfin plugins" });
  }
});

router.get("/startTask", async (req, res) => {
  const { task } = req.query;

  if (task === undefined) {
    res.status(400).send("No Task provided");
    return;
  }

  const taskManager = new TaskManager().getInstance();
  const taskScheduler = new TaskScheduler().getInstance();
  const taskConfig = taskManager.taskList[task];

  if (taskConfig === undefined) {
    res.status(404).send("Task not found");
    return;
  }

  const success = taskManager.addTask({
    task: taskConfig,
    onComplete: async () => {
      await taskScheduler.getTaskHistory();
      sendUpdate("GeneralAlert", { type: "Success", message: `${taskConfig.name} completed`, triggerType: triggertype.Manual, taskName: taskConfig.name });
    },
    onSkip: async () => {
      await taskScheduler.getTaskHistory();
    },
    onError: async (error) => {
      await taskScheduler.getTaskHistory();
      console.error(error);
      sendUpdate("TaskError", { type: "Error", message: `${taskConfig.name} failed`, triggerType: triggertype.Manual, taskName: taskConfig.name });
    },
    onExit: async () => {
      await taskScheduler.getTaskHistory();
      sendUpdate("TaskError", { type: "Error", message: `${taskConfig.name} stopped`, triggerType: triggertype.Manual, taskName: taskConfig.name });
    },
  });

  if (!success) {
    res.status(409).send(`${taskConfig.name} is already running`);
    sendUpdate("TaskError", { type: "Error", message: `${taskConfig.name} is already running`, triggerType: triggertype.Manual, taskName: taskConfig.name });
    return;
  }

  taskManager.startTask(taskConfig, triggertype.Manual);
  sendUpdate("GeneralAlert", { type: "Start", message: `${taskConfig.name} started`, triggerType: triggertype.Manual, taskName: taskConfig.name });
  res.send(`${taskConfig.name} started`);
});

router.get("/newsletter/my-subscriptions", async (req, res) => {
  try {
    const newsletterCampaigns = require("../classes/newsletter-campaigns");
    const userId = req.user?.jellyfinUser?.id || req.user?.id || req.user?.username || req.user?.email;
    if (!userId) return res.status(401).send({ error: "Unauthorized" });
    const [subscribable, subscriptions] = await Promise.all([
      newsletterCampaigns.listCampaigns({ includePersonal: true }),
      newsletterCampaigns.getSubscriptionsForUser(String(userId)),
    ]);
    res.send({
      campaigns: subscribable.filter(
        (campaign) => campaign.type === "global" || campaign.type === "personal" || campaign.type === "per-user" || campaign.enabled
      ),
      subscriptions,
    });
  } catch (error) {
    console.error("Load newsletter subscriptions failed:", error);
    res.status(503).send({ error: "Unable to load newsletter subscriptions" });
  }
});

router.put("/newsletter/my-subscriptions", async (req, res) => {
  try {
    const newsletterCampaigns = require("../classes/newsletter-campaigns");
    const userId = req.user?.jellyfinUser?.id || req.user?.id || req.user?.username || req.user?.email;
    if (!userId) return res.status(401).send({ error: "Unauthorized" });
    const subscriptions = await newsletterCampaigns.upsertSubscription({
      userId: String(userId),
      campaignId: req.body?.campaignId,
      optedIn: req.body?.optedIn !== false,
      extraRecipients: Array.isArray(req.body?.extraRecipients) ? req.body.extraRecipients : [],
    });
    res.send({ subscriptions });
  } catch (error) {
    console.error("Save newsletter subscription failed:", error);
    res.status(503).send({ error: "Unable to save newsletter subscription" });
  }
});

// Handle other routes
router.use((req, res) => {
  res.status(404).send({ error: "Not Found" });
});

module.exports = router;

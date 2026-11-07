const express = require("express");
const { mediaServerAuthHeaders } = require("../classes/server-type");
const axios = require("axios");

const db = require("../db");
const configClass = require("../classes/config");
const { getIntegrations } = require("../classes/integration-store");
const quietHours = require("../classes/quiet-hours");

const router = express.Router();
const USER_AGENT = "JellyGlance";
const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const ARR_APPS = {
  sonarr: { api: "v3", label: "Sonarr" },
  radarr: { api: "v3", label: "Radarr" },
  whisparr: { api: "v3", label: "Whisparr" },
  lidarr: { api: "v1", label: "Lidarr" },
  readarr: { api: "v1", label: "Readarr" },
  prowlarr: { api: "v1", label: "Prowlarr" },
  bazarr: { api: "bazarr", label: "Bazarr" },
};
const autoRunning = new Set();

router.use((req, res, next) => {
  if (!["Owner", "Admin"].includes(req.user?.role)) {
    res.status(403).json({ message: "Admin role required" });
    return;
  }
  next();
});

// ---------------------------------------------------------------------------
// Active-times storage. Each schedule holds 7 strings of 24 "0"/"1" chars, Monday first,
// in the server's local time.

function emptyWeek(fill = "1") {
  return DAY_KEYS.map(() => fill.repeat(24));
}

function normalizeWeek(days) {
  if (!Array.isArray(days) || days.length !== 7) return emptyWeek();
  return days.map((day) => {
    const value = Array.isArray(day) ? day.map((hour) => (hour ? "1" : "0")).join("") : String(day || "");
    return /^[01]{24}$/.test(value) ? value : "1".repeat(24);
  });
}

function normalizeSchedule(input = {}, previous = {}) {
  const interval = Number(input.intervalHours ?? previous.intervalHours ?? 24);
  return {
    days: normalizeWeek(input.days ?? previous.days),
    autoRun: Boolean(input.autoRun ?? previous.autoRun ?? false),
    intervalHours: Number.isFinite(interval) ? Math.min(Math.max(Math.round(interval), 1), 24 * 7) : 24,
    enforce: Boolean(input.enforce ?? previous.enforce ?? false),
    useGlobal: Boolean(input.useGlobal ?? previous.useGlobal ?? false),
    lastAutoRunAt: previous.lastAutoRunAt || null,
    updatedAt: new Date().toISOString(),
  };
}

async function readSchedules() {
  const { rows } = await db.query('SELECT settings FROM app_config WHERE "ID" = 1');
  return rows[0]?.settings?.TaskActiveTimes || {};
}

async function writeSchedules(schedules) {
  await db.query(
    `
      UPDATE app_config
      SET settings = (COALESCE(settings, '{}'::json)::jsonb || jsonb_build_object('TaskActiveTimes', $1::jsonb))::json
      WHERE "ID" = 1
    `,
    [JSON.stringify(schedules)]
  );
  new configClass().clearCache();
}

function localSlot(date = new Date()) {
  return { day: (date.getDay() + 6) % 7, hour: date.getHours() };
}

function isAllowedNow(schedule, date = new Date()) {
  if (!schedule?.days) return true;
  const { day, hour } = localSlot(date);
  return schedule.days[day]?.[hour] === "1";
}

function nextAllowedStart(schedule, from = new Date()) {
  if (!schedule?.days) return null;
  const probe = new Date(from);
  probe.setMinutes(0, 0, 0);
  for (let step = 0; step < 24 * 7; step += 1) {
    probe.setHours(probe.getHours() + 1);
    if (isAllowedNow(schedule, probe)) return probe.toISOString();
  }
  return null;
}

const GLOBAL_KEY = "global";

// A task follows the global active times when it has no schedule of its own, or when it
// opted in with useGlobal (it can still keep its own auto-run interval).
function effectiveSchedule(schedules, key) {
  const own = schedules[key];
  const global = schedules[GLOBAL_KEY];
  if (own && !own.useGlobal) return { ...own, source: "task" };
  if (own && own.useGlobal) return { ...own, days: global?.days || emptyWeek(), source: "global" };
  if (global) return { days: global.days, autoRun: false, enforce: false, source: "global" };
  return null;
}

function scheduleView(key, schedule) {
  if (!schedule) return null;
  return {
    key,
    ...schedule,
    allowedHours: schedule.days.reduce((sum, day) => sum + day.split("").filter((hour) => hour === "1").length, 0),
    allowedNow: isAllowedNow(schedule),
    nextAllowedAt: isAllowedNow(schedule) ? null : nextAllowedStart(schedule),
  };
}

// ---------------------------------------------------------------------------
// Jellyfin

async function jellyfinRequest(path, method = "get") {
  const config = await new configClass().getConfig();
  if (!config?.JF_HOST || !config?.JF_API_KEY) throw new Error("Jellyfin is not configured yet.");
  const response = await axios({
    method,
    url: `${String(config.JF_HOST).replace(/\/+$/, "")}${path}`,
    timeout: 30000,
    headers: { ...mediaServerAuthHeaders(config.JF_API_KEY), "User-Agent": USER_AGENT },
  });
  return response.data;
}

// ---------------------------------------------------------------------------
// ARR apps

function arrKind(integration) {
  const name = String(integration?.slug || integration?.name || "").toLowerCase();
  return Object.keys(ARR_APPS).find((kind) => name.includes(kind)) || null;
}

async function connectedArrApps() {
  const integrations = await getIntegrations().catch(() => ({ arrApps: [] }));
  return (integrations.arrApps || [])
    .filter((app) => app.connected && app.values?.url && app.values?.secret && arrKind(app))
    .map((app) => ({
      instanceId: app.instanceId || app.slug,
      name: app.name || ARR_APPS[arrKind(app)].label,
      kind: arrKind(app),
      url: String(app.values.url).replace(/\/+$/, ""),
      secret: app.values.secret,
    }));
}

function arrClient(app) {
  const headers = { "X-Api-Key": app.secret, "User-Agent": USER_AGENT };
  return axios.create({ baseURL: app.url, timeout: 20000, headers });
}

async function listArrTasks(app) {
  const client = arrClient(app);
  if (app.kind === "bazarr") {
    const response = await client.get("/api/system/tasks", { headers: { "X-API-KEY": app.secret } });
    const tasks = response.data?.data || [];
    return tasks.map((task) => ({
      id: task.job_id,
      name: task.name,
      command: task.job_id,
      interval: task.interval || "",
      lastExecution: null,
      nextExecution: task.next_run_time || null,
      nextRunIn: task.next_run_in || "",
      running: Boolean(task.job_running),
    }));
  }

  const version = ARR_APPS[app.kind].api;
  const [tasksResponse, commandsResponse] = await Promise.all([
    client.get(`/api/${version}/system/task`),
    client.get(`/api/${version}/command`).catch(() => ({ data: [] })),
  ]);
  const active = new Set(
    (Array.isArray(commandsResponse.data) ? commandsResponse.data : [])
      .filter((command) => ["queued", "started"].includes(String(command.status || "").toLowerCase()))
      .map((command) => command.name)
  );
  return (Array.isArray(tasksResponse.data) ? tasksResponse.data : []).map((task) => ({
    id: task.taskName || task.name,
    name: task.name,
    command: task.taskName,
    interval: task.interval ? `${task.interval} min` : "",
    intervalMinutes: task.interval || null,
    lastExecution: task.lastExecution || null,
    lastDuration: task.lastDuration || null,
    nextExecution: task.nextExecution || null,
    running: active.has(task.taskName),
  }));
}

async function runArrTask(app, command) {
  const client = arrClient(app);
  if (app.kind === "bazarr") {
    const body = new URLSearchParams({ taskid: command });
    await client.post(`/api/system/tasks?taskid=${encodeURIComponent(command)}`, body, {
      headers: { "X-API-KEY": app.secret, "Content-Type": "application/x-www-form-urlencoded" },
    });
    return;
  }
  await client.post(`/api/${ARR_APPS[app.kind].api}/command`, { name: command });
}

function errorMessage(error, fallback) {
  const status = error.response?.status;
  if (status === 401 || status === 403) return "The app rejected the API key.";
  return error.response?.data?.message || error.message || fallback;
}

// ---------------------------------------------------------------------------
// Routes

router.get("/active-times", async (req, res) => {
  try {
    const schedules = await readSchedules();
    const views = Object.fromEntries(Object.entries(schedules).map(([key, schedule]) => [key, scheduleView(key, schedule)]));
    res.json({ timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, now: new Date().toISOString(), schedules: views });
  } catch (error) {
    res.status(503).json({ error: error.message || "Unable to load active times" });
  }
});

router.put("/active-times", async (req, res) => {
  const key = String(req.body?.key || "").trim();
  if (key !== GLOBAL_KEY && !/^(jellyfin|arr):/.test(key)) {
    res.status(400).json({ error: "Unknown task" });
    return;
  }
  try {
    // Use a Map so the user-supplied key can never write onto an object prototype.
    const schedules = new Map(Object.entries(await readSchedules()));
    if (req.body?.clear) {
      schedules.delete(key);
    } else if (key === GLOBAL_KEY) {
      const next = normalizeSchedule(req.body, schedules.get(key));
      schedules.set(key, { ...next, autoRun: false, useGlobal: false });
    } else {
      schedules.set(key, normalizeSchedule(req.body, schedules.get(key)));
    }
    await writeSchedules(Object.fromEntries(schedules));
    res.json({ key, schedule: scheduleView(key, schedules.get(key)) });
  } catch (error) {
    res.status(503).json({ error: error.message || "Unable to save active times" });
  }
});

router.get("/arr", async (req, res) => {
  try {
    const apps = await connectedArrApps();
    const results = await Promise.all(
      apps.map(async (app) => {
        try {
          return { instanceId: app.instanceId, name: app.name, kind: app.kind, url: app.url, ok: true, tasks: await listArrTasks(app) };
        } catch (error) {
          return { instanceId: app.instanceId, name: app.name, kind: app.kind, url: app.url, ok: false, error: errorMessage(error, "Unable to reach app"), tasks: [] };
        }
      })
    );
    res.json({ apps: results });
  } catch (error) {
    res.status(503).json({ error: error.message || "Unable to load ARR tasks" });
  }
});

router.post("/arr/run", async (req, res) => {
  try {
    const apps = await connectedArrApps();
    const app = apps.find((entry) => entry.instanceId === req.body?.instanceId);
    if (!app || !req.body?.command) {
      res.status(400).json({ error: "Unknown app or task" });
      return;
    }
    await runArrTask(app, String(req.body.command));
    res.json({ ok: true });
  } catch (error) {
    res.status(503).json({ error: errorMessage(error, "Task failed to start") });
  }
});


// ---------------------------------------------------------------------------
// Quiet hours: hold library scans and intro/credits detection during a nightly (or peak) window.
// Jobs that start inside the window are stopped and recorded as deferred; once the window ends each
// deferred job runs once (or, with runDeferred off, simply waits for its next Jellyfin schedule).
// Jobs started by hand from JellyGlance are never stopped.

async function readQuietHours() {
  const { rows } = await db.query('SELECT settings FROM app_config WHERE "ID" = 1');
  const stored = rows[0]?.settings?.QuietHours || {};
  return { config: quietHours.normalizeQuietHours(stored), deferred: Array.isArray(stored.deferred) ? stored.deferred : [], lastDeferredRunAt: stored.lastDeferredRunAt || null };
}

async function writeQuietHours(state) {
  const value = { ...state.config, deferred: state.deferred || [], lastDeferredRunAt: state.lastDeferredRunAt || null };
  await db.query(
    `
      UPDATE app_config
      SET settings = (COALESCE(settings, '{}'::json)::jsonb || jsonb_build_object('QuietHours', $1::jsonb))::json
      WHERE "ID" = 1
    `,
    [JSON.stringify(value)]
  );
  new configClass().clearCache();
}

function quietHoursView(state, now = new Date()) {
  const active = quietHours.isInQuietHours(state.config, now);
  return {
    ...state.config,
    effectiveTimeZone: state.config.timeZone || quietHours.serverTimeZone(),
    serverTimeZone: quietHours.serverTimeZone(),
    active,
    nextChangeAt: quietHours.nextChange(state.config, now),
    deferred: state.deferred,
    lastDeferredRunAt: state.lastDeferredRunAt,
    now: now.toISOString(),
  };
}

let quietTickRunning = false;

async function quietHoursTick() {
  if (quietTickRunning) return;
  quietTickRunning = true;
  try {
    const state = await readQuietHours();
    const { config } = state;
    if (!config.enabled && !state.deferred.length) return;
    const active = quietHours.isInQuietHours(config);
    let changed = false;

    if (config.enabled && active) {
      const tasks = await jellyfinRequest("/ScheduledTasks").catch(() => []);
      for (const task of tasks || []) {
        if (String(task.State || "").toLowerCase() !== "running") continue;
        if (!quietHours.isHeld(config, task) || quietHours.isManualRun(task.Id)) continue;
        try {
          await jellyfinRequest(`/ScheduledTasks/Running/${encodeURIComponent(task.Id)}`, "delete");
          console.log(`[QUIET HOURS] Deferred Jellyfin job "${task.Name}" until quiet hours end`);
          if (!state.deferred.some((entry) => entry.id === task.Id)) {
            state.deferred.push({ id: task.Id, name: task.Name, kind: quietHours.classifyTask(task), deferredAt: new Date().toISOString() });
          }
          changed = true;
        } catch (error) {
          console.error(`[QUIET HOURS] Could not stop Jellyfin job "${task.Name}":`, error.message);
        }
      }
    } else if (state.deferred.length) {
      if (config.runDeferred) {
        for (const entry of state.deferred) {
          try {
            await jellyfinRequest(`/ScheduledTasks/Running/${encodeURIComponent(entry.id)}`, "post");
            console.log(`[QUIET HOURS] Ran deferred Jellyfin job "${entry.name}"`);
          } catch (error) {
            console.error(`[QUIET HOURS] Deferred Jellyfin job "${entry.name}" failed to start:`, error.message);
          }
        }
        state.lastDeferredRunAt = new Date().toISOString();
      }
      state.deferred = [];
      changed = true;
    }
    if (changed) await writeQuietHours(state);
  } catch (error) {
    console.error("[QUIET HOURS] Tick failed:", error.message);
  } finally {
    quietTickRunning = false;
  }
}

router.get("/quiet-hours", async (req, res) => {
  try {
    res.json(quietHoursView(await readQuietHours()));
  } catch (error) {
    res.status(503).json({ error: error.message || "Unable to load quiet hours" });
  }
});

router.put("/quiet-hours", async (req, res) => {
  try {
    const state = await readQuietHours();
    state.config = quietHours.normalizeQuietHours(req.body || {}, state.config);
    if (req.body?.clearDeferred) state.deferred = [];
    await writeQuietHours(state);
    res.json(quietHoursView(state));
  } catch (error) {
    res.status(503).json({ error: error.message || "Unable to save quiet hours" });
  }
});

// ---------------------------------------------------------------------------
// Scheduler: runs tasks inside their active times and (for Jellyfin) stops runs outside them.

async function schedulerTick() {
  let schedules;
  try {
    schedules = await readSchedules();
  } catch {
    return;
  }
  const global = schedules[GLOBAL_KEY];
  const entries = Object.keys(schedules)
    .filter((key) => key !== GLOBAL_KEY)
    .map((key) => [key, effectiveSchedule(schedules, key)])
    .filter(([, schedule]) => schedule?.autoRun || schedule?.enforce);

  let jellyfinTasks = null;
  let arrApps = null;
  let changed = false;

  // Global enforce: stop Jellyfin jobs that follow the global times and are running outside them.
  if (global?.enforce && !isAllowedNow(global)) {
    jellyfinTasks = await jellyfinRequest("/ScheduledTasks").catch(() => []);
    for (const task of jellyfinTasks || []) {
      const key = `jellyfin:${task.Id}`;
      if (effectiveSchedule(schedules, key)?.source !== "global") continue;
      if (String(task.State || "").toLowerCase() !== "running") continue;
      try {
        await jellyfinRequest(`/ScheduledTasks/Running/${encodeURIComponent(task.Id)}`, "delete");
        console.log(`[TASKS] Stopped Jellyfin job "${task.Name}" outside the global active times`);
      } catch (error) {
        console.error(`[TASKS] Could not stop Jellyfin job "${task.Name}":`, error.message);
      }
    }
  }
  if (!entries.length) return;

  for (const [key, schedule] of entries) {
    if (autoRunning.has(key)) continue;
    autoRunning.add(key);
    try {
      const allowed = isAllowedNow(schedule);
      const [source, ...rest] = key.split(":");

      if (source === "jellyfin") {
        const taskId = rest.join(":");
        if (!jellyfinTasks) jellyfinTasks = await jellyfinRequest("/ScheduledTasks").catch(() => []);
        const task = (jellyfinTasks || []).find((entry) => entry.Id === taskId);
        if (!task) continue;
        const running = String(task.State || "").toLowerCase() === "running";
        if (!allowed && running && schedule.enforce) {
          await jellyfinRequest(`/ScheduledTasks/Running/${encodeURIComponent(taskId)}`, "delete");
          console.log(`[TASKS] Stopped Jellyfin job "${task.Name}" outside its active times`);
          continue;
        }
        if (allowed && schedule.autoRun && !running) {
          const last = new Date(task.LastExecutionResult?.EndTimeUtc || schedule.lastAutoRunAt || 0).getTime();
          if (Date.now() - last >= schedule.intervalHours * 3600000) {
            await jellyfinRequest(`/ScheduledTasks/Running/${encodeURIComponent(taskId)}`, "post");
            schedules[key].lastAutoRunAt = new Date().toISOString();
            changed = true;
            console.log(`[TASKS] Ran Jellyfin job "${task.Name}" inside its active times`);
          }
        }
        continue;
      }

      if (source === "arr" && schedule.autoRun && allowed) {
        const [instanceId, ...commandParts] = rest;
        const command = commandParts.join(":");
        const last = new Date(schedule.lastAutoRunAt || 0).getTime();
        if (Date.now() - last < schedule.intervalHours * 3600000) continue;
        if (!arrApps) arrApps = await connectedArrApps().catch(() => []);
        const app = arrApps.find((entry) => entry.instanceId === instanceId);
        if (!app) continue;
        await runArrTask(app, command);
        schedules[key].lastAutoRunAt = new Date().toISOString();
        changed = true;
        console.log(`[TASKS] Ran ${app.name} task "${command}" inside its active times`);
      }
    } catch (error) {
      console.error(`[TASKS] Scheduled task ${key} failed:`, error.message);
    } finally {
      autoRunning.delete(key);
    }
  }

  if (changed) {
    const latest = await readSchedules().catch(() => null);
    if (latest) {
      Object.keys(schedules).forEach((key) => {
        if (latest[key] && schedules[key]?.lastAutoRunAt) latest[key].lastAutoRunAt = schedules[key].lastAutoRunAt;
      });
      await writeSchedules(latest).catch(() => {});
    }
  }
}

if (process.env.NODE_ENV !== "test") {
  const interval = setInterval(schedulerTick, 5 * 60 * 1000);
  interval.unref?.();
  const quietInterval = setInterval(quietHoursTick, 60 * 1000);
  quietInterval.unref?.();
}

module.exports = router;
module.exports._internal = { quietHoursTick, isAllowedNow, normalizeWeek, nextAllowedStart, effectiveSchedule };

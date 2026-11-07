// Quiet hours: a daily window (optionally limited to some weekdays) in which JellyGlance holds back
// heavy Jellyfin jobs - library scans and intro/credits detection - so evening or overnight playback
// is not slowed down. Jobs that start inside the window are stopped and remembered as deferred, then
// run once as soon as the window ends. Starting a job by hand is always allowed.

const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const WEEKDAY_INDEX = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const MANUAL_GRACE_MS = 6 * 60 * 60 * 1000;

const SCAN_KEYS = new Set(["RefreshLibrary"]);
const INTRO_PATTERN = /(intro|credit|outro|media ?segment|skip ?detect)/i;

function validTimeZone(timeZone) {
  if (!timeZone) return false;
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function serverTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

function normalizeQuietHours(input = {}, previous = {}) {
  const pick = (key, fallback) => (input[key] !== undefined ? input[key] : previous[key] !== undefined ? previous[key] : fallback);
  const start = String(pick("start", "00:00"));
  const end = String(pick("end", "07:00"));
  const tz = String(pick("timeZone", "") || "");
  const rawDays = pick("days", DAY_KEYS);
  const days = Array.isArray(rawDays) ? DAY_KEYS.filter((day) => rawDays.includes(day)) : DAY_KEYS;
  return {
    enabled: Boolean(pick("enabled", false)),
    start: TIME_RE.test(start) ? start : "00:00",
    end: TIME_RE.test(end) ? end : "07:00",
    timeZone: validTimeZone(tz) ? tz : "",
    days: days.length ? days : [...DAY_KEYS],
    scans: Boolean(pick("scans", true)),
    intros: Boolean(pick("intros", true)),
    runDeferred: Boolean(pick("runDeferred", true)),
  };
}

function toMinutes(value) {
  const [hours, minutes] = String(value).split(":").map(Number);
  return hours * 60 + minutes;
}

// Day index (Monday = 0) and minute of day for `date` in `timeZone`.
function zonedSlot(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timeZone || serverTimeZone(),
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value;
  return { day: WEEKDAY_INDEX[get("weekday")] ?? 0, minute: Number(get("hour")) * 60 + Number(get("minute")) };
}

// True when `date` falls inside the window. A window that crosses midnight (22:00-07:00) belongs to
// the day it starts on, so "Fri and Sat" covers Friday night into Saturday morning.
function isInQuietHours(config, date = new Date()) {
  if (!config?.enabled) return false;
  const start = toMinutes(config.start);
  const end = toMinutes(config.end);
  if (start === end) return false;
  const { day, minute } = zonedSlot(date, config.timeZone);
  const days = new Set((config.days || DAY_KEYS).map((key) => DAY_KEYS.indexOf(key)));
  if (start < end) return days.has(day) && minute >= start && minute < end;
  if (minute >= start) return days.has(day);
  if (minute < end) return days.has((day + 6) % 7);
  return false;
}

// Next minute boundary at which the in/out state flips, searched a minute at a time for up to 8 days.
function nextChange(config, from = new Date()) {
  if (!config?.enabled) return null;
  const current = isInQuietHours(config, from);
  const probe = new Date(from);
  probe.setSeconds(0, 0);
  for (let step = 0; step < 8 * 24 * 60; step += 1) {
    probe.setTime(probe.getTime() + 60000);
    if (isInQuietHours(config, probe) !== current) return probe.toISOString();
  }
  return null;
}

// "scan", "intro" or null for a Jellyfin scheduled task.
function classifyTask(task = {}) {
  const key = String(task.Key || task.key || "");
  const name = `${task.Name || task.name || ""} ${task.Category || task.category || ""}`;
  if (SCAN_KEYS.has(key) || /scan (media )?librar/i.test(name)) return "scan";
  if (INTRO_PATTERN.test(key) || INTRO_PATTERN.test(name)) return "intro";
  return null;
}

function isHeld(config, task) {
  const kind = classifyTask(task);
  if (kind === "scan") return Boolean(config?.scans);
  if (kind === "intro") return Boolean(config?.intros);
  return false;
}

// Jobs an admin started by hand are left alone for a while, even inside quiet hours.
const manualRuns = new Map();

function markManualRun(taskId, now = Date.now()) {
  if (taskId) manualRuns.set(String(taskId), now);
}

function isManualRun(taskId, now = Date.now()) {
  const at = manualRuns.get(String(taskId));
  if (!at) return false;
  if (now - at > MANUAL_GRACE_MS) {
    manualRuns.delete(String(taskId));
    return false;
  }
  return true;
}

module.exports = {
  DAY_KEYS,
  normalizeQuietHours,
  isInQuietHours,
  nextChange,
  classifyTask,
  isHeld,
  markManualRun,
  isManualRun,
  serverTimeZone,
  validTimeZone,
};

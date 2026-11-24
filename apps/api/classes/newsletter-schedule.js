// Newsletter schedule helpers: 5-field cron, server-timezone due checks, and
// form <-> cron conversion. Campaigns are due on a matching slot that starts
// after the campaign was created and that has not already been sent.

const DEFAULT_TIME_ZONE = process.env.TZ || "UTC";

const WEEKDAY_NAMES = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};

function clamp(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(number)));
}

function expandField(field, min, max) {
  const raw = String(field ?? "*").trim();
  if (!raw) return [];
  const values = new Set();
  for (const part of raw.split(",")) {
    const token = part.trim().toLowerCase();
    if (!token) continue;
    if (token === "*") {
      for (let value = min; value <= max; value += 1) values.add(value);
      continue;
    }
    const [rangePart, stepPart] = token.split("/");
    const step = stepPart ? Number(stepPart) : 1;
    if (!Number.isFinite(step) || step < 1) continue;
    let start;
    let end;
    if (rangePart === "*") {
      start = min;
      end = max;
    } else if (rangePart.includes("-")) {
      const [from, to] = rangePart.split("-");
      start = Number(from);
      end = Number(to);
    } else {
      start = Number(rangePart);
      end = stepPart ? max : start;
    }
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    if (start > end) [start, end] = [end, start];
    start = Math.max(min, Math.trunc(start));
    end = Math.min(max, Math.trunc(end));
    for (let value = start; value <= end; value += step) values.add(value);
  }
  return [...values].sort((a, b) => a - b);
}

function parseWeekdayToken(token) {
  const named = WEEKDAY_NAMES[token];
  if (named != null) return named;
  const number = Number(token);
  if (!Number.isFinite(number)) return NaN;
  if (number === 7) return 0;
  return number;
}

function expandWeekdayField(field) {
  const raw = String(field ?? "*").trim();
  if (!raw) return [];
  const values = new Set();
  for (const part of raw.split(",")) {
    const token = part.trim().toLowerCase();
    if (!token) continue;
    if (token === "*") {
      for (let value = 0; value <= 6; value += 1) values.add(value);
      continue;
    }
    const [rangePart, stepPart] = token.split("/");
    const step = stepPart ? Number(stepPart) : 1;
    if (!Number.isFinite(step) || step < 1) continue;
    let start;
    let end;
    if (rangePart === "*") {
      start = 0;
      end = 6;
    } else if (rangePart.includes("-")) {
      const [from, to] = rangePart.split("-");
      start = parseWeekdayToken(from);
      end = parseWeekdayToken(to);
    } else {
      start = parseWeekdayToken(rangePart);
      end = stepPart ? 6 : start;
    }
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    start = start === 7 ? 0 : start;
    end = end === 7 ? 0 : end;
    if (start <= end) {
      for (let value = start; value <= end; value += step) values.add(value % 7);
    } else {
      for (let value = start; value <= 6; value += step) values.add(value % 7);
      for (let value = 0; value <= end; value += step) values.add(value % 7);
    }
  }
  return [...values].sort((a, b) => a - b);
}

function parseCron(expression) {
  const parts = String(expression || "").trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
  return {
    minute: expandField(minute, 0, 59),
    hour: expandField(hour, 0, 23),
    dayOfMonth: expandField(dayOfMonth, 1, 31),
    month: expandField(month, 1, 12),
    dayOfWeek: expandWeekdayField(dayOfWeek),
    dayOfMonthAny: dayOfMonth === "*" || dayOfMonth === "?",
    dayOfWeekAny: dayOfWeek === "*" || dayOfWeek === "?",
  };
}

function fieldMatches(values, actual) {
  return values.includes(actual);
}

function cronMatches(parsed, parts) {
  if (!parsed) return false;
  if (!fieldMatches(parsed.minute, parts.minute)) return false;
  if (!fieldMatches(parsed.hour, parts.hour)) return false;
  if (!fieldMatches(parsed.month, parts.month)) return false;
  const domMatch = fieldMatches(parsed.dayOfMonth, parts.day);
  const dowMatch = fieldMatches(parsed.dayOfWeek, parts.weekday);
  // Vixie cron: when both day-of-month and day-of-week are restricted, match either.
  if (!parsed.dayOfMonthAny && !parsed.dayOfWeekAny) return domMatch || dowMatch;
  if (!parsed.dayOfMonthAny && !domMatch) return false;
  if (!parsed.dayOfWeekAny && !dowMatch) return false;
  return true;
}

function partsInTimeZone(date, timeZone = DEFAULT_TIME_ZONE) {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: timeZone || "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  });
  const named = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  const weekdayMap = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
  return {
    year: Number(named.year),
    month: Number(named.month),
    day: Number(named.day),
    hour: Number(named.hour),
    minute: Number(named.minute),
    weekday: weekdayMap[String(named.weekday || "").toLowerCase()] ?? 0,
  };
}

function zonedTimeToUtc({ year, month, day, hour, minute }, timeZone = DEFAULT_TIME_ZONE) {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  const first = partsInTimeZone(new Date(utcGuess), timeZone);
  const firstAsUtc = Date.UTC(first.year, first.month - 1, first.day, first.hour, first.minute, 0, 0);
  const adjusted = new Date(utcGuess - (firstAsUtc - utcGuess));
  const second = partsInTimeZone(adjusted, timeZone);
  const secondAsUtc = Date.UTC(second.year, second.month - 1, second.day, second.hour, second.minute, 0, 0);
  return new Date(adjusted.getTime() - (secondAsUtc - Date.UTC(year, month - 1, day, hour, minute, 0, 0)));
}

function addCalendarDays(year, month, day, amount) {
  const utc = new Date(Date.UTC(year, month - 1, day + amount));
  return { year: utc.getUTCFullYear(), month: utc.getUTCMonth() + 1, day: utc.getUTCDate() };
}

function mostRecentOccurrence(expression, now = new Date(), timeZone = DEFAULT_TIME_ZONE) {
  const parsed = parseCron(expression);
  if (!parsed || !parsed.minute.length || !parsed.hour.length) return null;
  const nowMs = now.getTime();
  const today = partsInTimeZone(now, timeZone);
  let year = today.year;
  let month = today.month;
  let day = today.day;
  const hours = [...parsed.hour].sort((a, b) => b - a);
  const minutes = [...parsed.minute].sort((a, b) => b - a);

  for (let offset = 0; offset <= 400; offset += 1) {
    const noon = zonedTimeToUtc({ year, month, day, hour: 12, minute: 0 }, timeZone);
    const parts = partsInTimeZone(noon, timeZone);
    const dayCandidate = { ...parts, day, month, year };
    for (const hour of hours) {
      for (const minute of minutes) {
        const instant = zonedTimeToUtc({ year, month, day, hour, minute }, timeZone);
        if (instant.getTime() > nowMs) continue;
        const instantParts = partsInTimeZone(instant, timeZone);
        if (cronMatches(parsed, instantParts) || cronMatches(parsed, { ...dayCandidate, hour, minute })) {
          // Re-check with the actual zoned parts of the instant.
          if (cronMatches(parsed, instantParts)) return instant;
        }
      }
    }
    ({ year, month, day } = addCalendarDays(year, month, day, -1));
  }
  return null;
}

function nextOccurrence(expression, now = new Date(), timeZone = DEFAULT_TIME_ZONE) {
  const parsed = parseCron(expression);
  if (!parsed || !parsed.minute.length || !parsed.hour.length) return null;
  const nowMs = now.getTime();
  const today = partsInTimeZone(now, timeZone);
  let year = today.year;
  let month = today.month;
  let day = today.day;
  const hours = [...parsed.hour].sort((a, b) => a - b);
  const minutes = [...parsed.minute].sort((a, b) => a - b);

  for (let offset = 0; offset <= 400; offset += 1) {
    for (const hour of hours) {
      for (const minute of minutes) {
        const instant = zonedTimeToUtc({ year, month, day, hour, minute }, timeZone);
        if (instant.getTime() <= nowMs) continue;
        const instantParts = partsInTimeZone(instant, timeZone);
        if (cronMatches(parsed, instantParts)) return instant;
      }
    }
    ({ year, month, day } = addCalendarDays(year, month, day, 1));
  }
  return null;
}

function normalizeWeekdays(weekdays) {
  if (!Array.isArray(weekdays)) return [];
  const values = new Set();
  for (const value of weekdays) {
    if (typeof value === "string" && WEEKDAY_NAMES[value.toLowerCase()] != null) {
      values.add(WEEKDAY_NAMES[value.toLowerCase()]);
      continue;
    }
    const number = Number(value);
    if (!Number.isFinite(number)) continue;
    if (number === 7) values.add(0);
    else if (number >= 0 && number <= 6) values.add(Math.trunc(number));
  }
  return [...values].sort((a, b) => a - b);
}

function buildScheduleCron(schedule = {}) {
  const minute = clamp(schedule.minute, 0, 59, 0);
  const hour = clamp(schedule.hour, 0, 23, 9);
  const weekdays = normalizeWeekdays(schedule.weekdays);
  const hasDay = schedule.dayOfMonth != null && schedule.dayOfMonth !== "" && Number.isFinite(Number(schedule.dayOfMonth));
  const dayOfMonth = hasDay ? clamp(schedule.dayOfMonth, 1, 31, 1) : null;
  if (!weekdays.length && dayOfMonth == null) return null;
  const dow = weekdays.length ? weekdays.join(",") : "*";
  const dom = dayOfMonth == null ? "*" : String(dayOfMonth);
  return `${minute} ${hour} ${dom} * ${dow}`;
}

function parseScheduleCron(expression) {
  const parsed = parseCron(expression);
  if (!parsed) return { weekdays: [], dayOfMonth: "", hour: 9, minute: 0 };
  return {
    weekdays: parsed.dayOfWeekAny ? [] : parsed.dayOfWeek,
    dayOfMonth: parsed.dayOfMonthAny ? "" : parsed.dayOfMonth.length === 1 ? parsed.dayOfMonth[0] : parsed.dayOfMonth[0] || "",
    hour: parsed.hour[0] ?? 9,
    minute: parsed.minute[0] ?? 0,
  };
}

function campaignDue(campaign, now = new Date(), options = {}) {
  if (!campaign || !campaign.enabled || campaign.frequency === "manual") return false;
  const cron = campaign.scheduleCron || campaign.schedule_cron;
  if (!cron) return false;
  const timeZone = options.timeZone || DEFAULT_TIME_ZONE;
  const occurrence = mostRecentOccurrence(cron, now, timeZone);
  if (!occurrence) return false;
  const created = campaign.createdAt || campaign.created_at;
  if (created && occurrence.getTime() < new Date(created).getTime()) return false;
  const last = campaign.lastSentAt || campaign.last_sent_at;
  if (last && new Date(last).getTime() >= occurrence.getTime()) return false;
  return true;
}

function resolveScheduleFields(input = {}, current = {}) {
  const allowed = ["manual", "weekly", "monthly", "scheduled"];
  const frequency = allowed.includes(input.frequency) ? input.frequency : current.frequency || "manual";
  let scheduleCron = input.scheduleCron !== undefined ? input.scheduleCron : current.scheduleCron;
  if (input.schedule) {
    scheduleCron = buildScheduleCron(input.schedule) || scheduleCron || null;
  }
  if (frequency === "manual") scheduleCron = null;
  else if (!scheduleCron && frequency === "weekly") scheduleCron = "0 9 * * 1";
  else if (!scheduleCron && frequency === "monthly") scheduleCron = "0 9 1 * *";
  return { frequency: frequency === "scheduled" ? "scheduled" : frequency, scheduleCron: scheduleCron || null };
}

module.exports = {
  DEFAULT_TIME_ZONE,
  parseCron,
  cronMatches,
  partsInTimeZone,
  zonedTimeToUtc,
  mostRecentOccurrence,
  nextOccurrence,
  buildScheduleCron,
  parseScheduleCron,
  campaignDue,
  resolveScheduleFields,
  normalizeWeekdays,
};

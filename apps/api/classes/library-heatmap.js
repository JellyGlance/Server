// Day-of-week x hour-of-day heat map of playback, bucketed in the server time zone.
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MAX_WINDOW_DAYS = 3650;

function clampDays(value, fallback = 30) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(n, MAX_WINDOW_DAYS);
}

function validTimeZone(tz) {
  if (!tz || typeof tz !== "string") return "UTC";
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: tz });
    return tz;
  } catch {
    return "UTC";
  }
}

// Monday = 0 ... Sunday = 6, from JS getDay-style (Sunday = 0) or Postgres DOW.
function mondayIndex(dow) {
  const n = Number(dow);
  return (((n + 6) % 7) + 7) % 7;
}

// Returns { day, hour } for a timestamp in the given time zone.
function bucketOf(timestamp, timeZone = "UTC") {
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: validTimeZone(timeZone),
    weekday: "short",
    hour: "numeric",
    hourCycle: "h23",
  }).formatToParts(date);
  const weekday = parts.find((p) => p.type === "weekday")?.value;
  const hour = parseInt(parts.find((p) => p.type === "hour")?.value, 10) % 24;
  const js = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekday);
  if (js < 0 || !Number.isFinite(hour)) return null;
  return { day: mondayIndex(js), hour };
}

function emptyGrid() {
  return Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => ({ plays: 0, seconds: 0 })));
}

// Raw activity rows ({ ActivityDateInserted, PlaybackDuration }) -> 7x24 grid.
function bucketActivity(rows, timeZone = "UTC") {
  const grid = emptyGrid();
  for (const row of rows || []) {
    const b = bucketOf(row.ActivityDateInserted, timeZone);
    if (!b) continue;
    grid[b.day][b.hour].plays += 1;
    grid[b.day][b.hour].seconds += Math.max(0, Number(row.PlaybackDuration) || 0);
  }
  return grid;
}

// Pre-aggregated rows ({ Dow (pg, Sun=0), Hour, Plays, Seconds }) -> 7x24 grid.
function gridFromAggregates(rows) {
  const grid = emptyGrid();
  for (const row of rows || []) {
    const hour = Number(row.Hour);
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) continue;
    const day = mondayIndex(row.Dow);
    grid[day][hour].plays += Number(row.Plays) || 0;
    grid[day][hour].seconds += Number(row.Seconds) || 0;
  }
  return grid;
}

// 0 = none, 1..4 = quartiles of the busiest cell.
function intensity(value, max) {
  if (!value || !max) return 0;
  return Math.min(4, Math.max(1, Math.ceil((value / max) * 4)));
}

function summarise(grid, metric = "seconds") {
  const key = metric === "plays" ? "plays" : "seconds";
  let max = 0;
  let total = 0;
  let peak = null;
  const dayTotals = Array(7).fill(0);
  const hourTotals = Array(24).fill(0);
  grid.forEach((row, day) =>
    row.forEach((cell, hour) => {
      const v = cell[key];
      total += v;
      dayTotals[day] += v;
      hourTotals[hour] += v;
      if (v > max) {
        max = v;
        peak = { day, dayName: DAYS[day], hour, value: v };
      }
    })
  );
  const cells = grid.map((row) => row.map((cell) => ({ ...cell, level: intensity(cell[key], max) })));
  const busiestDay = total ? dayTotals.indexOf(Math.max(...dayTotals)) : null;
  const busiestHour = total ? hourTotals.indexOf(Math.max(...hourTotals)) : null;
  return {
    metric: key,
    days: DAYS,
    cells,
    max,
    total,
    peak,
    dayTotals,
    hourTotals,
    busiestDay: busiestDay === null ? null : DAYS[busiestDay],
    busiestHour,
  };
}

async function getLibraryHeatmap({ db, days, userId, libraryId, timeZone, metric }) {
  const tz = validTimeZone(timeZone);
  const windowDays = clampDays(days);
  const values = [tz, windowDays];
  const where = [`a."ActivityDateInserted" >= NOW() - ($2::int * INTERVAL '1 day')`];
  if (userId) {
    values.push(String(userId).toLowerCase().replace(/-/g, ""));
    where.push(`replace(lower(a."UserId"), '-', '') = $${values.length}`);
  }
  if (libraryId) {
    values.push(String(libraryId));
    where.push(`COALESCE(i."ParentId", series."ParentId") = $${values.length}`);
  }
  const { rows } = await db.query(
    `SELECT
       EXTRACT(DOW FROM (a."ActivityDateInserted" AT TIME ZONE $1))::int AS "Dow",
       EXTRACT(HOUR FROM (a."ActivityDateInserted" AT TIME ZONE $1))::int AS "Hour",
       count(a."Id")::int AS "Plays",
       COALESCE(sum(a."PlaybackDuration"), 0)::bigint AS "Seconds"
     FROM jf_playback_activity a
     LEFT JOIN jf_library_items i ON i."Id" = a."NowPlayingItemId"
     LEFT JOIN jf_library_episodes e ON e."EpisodeId" = a."EpisodeId"
     LEFT JOIN jf_library_items series ON series."Id" = e."SeriesId"
     WHERE ${where.join(" AND ")}
     GROUP BY 1, 2`,
    values
  );
  return { timeZone: tz, windowDays, ...summarise(gridFromAggregates(rows), metric) };
}

module.exports = { DAYS, clampDays, validTimeZone, mondayIndex, bucketOf, bucketActivity, gridFromAggregates, intensity, summarise, getLibraryHeatmap };

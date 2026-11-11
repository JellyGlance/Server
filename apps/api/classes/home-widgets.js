// Data for the Home widgets: Peak hours, Up next tonight, Disk runway and the
// "All quiet" idle slot. Everything here reads the JellyGlance database only.

const { buildForecast } = require("./disk-forecast");
const { getStorageReport } = require("./storage-library");

const DAY_MS = 24 * 60 * 60 * 1000;

function homeTimeZone() {
  return process.env.TZ || "Europe/London";
}

// 7 x 24 grid of plays, Monday first. Also picks the busiest hour and the
// quietest three-hour window (wrapping across midnight and the week).
function buildPeakGrid(rows) {
  const grid = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
  let total = 0;
  for (const row of rows || []) {
    const day = Number(row.dow) - 1;
    const hour = Number(row.hour);
    if (day < 0 || day > 6 || hour < 0 || hour > 23) continue;
    const plays = Number(row.plays) || 0;
    grid[day][hour] += plays;
    total += plays;
  }

  let busiest = null;
  grid.forEach((hours, day) =>
    hours.forEach((plays, hour) => {
      if (plays > 0 && (!busiest || plays > busiest.plays)) busiest = { day, hour, plays };
    })
  );

  const flat = grid.flat();
  let quietest = null;
  for (let start = 0; start < flat.length; start += 1) {
    const plays = flat[start] + flat[(start + 1) % flat.length] + flat[(start + 2) % flat.length];
    if (!quietest || plays < quietest.plays) quietest = { day: Math.floor(start / 24), hour: start % 24, plays };
  }

  const max = flat.reduce((m, value) => Math.max(m, value), 0);
  return { grid, max, total, busiest, quietest: total > 0 ? quietest : null };
}

async function getPeakHours({ db, days = 30 }) {
  const span = Math.min(Math.max(Number(days) || 30, 7), 365);
  const tz = homeTimeZone();
  const { rows } = await db.query(
    `SELECT extract(isodow FROM "ActivityDateInserted" AT TIME ZONE $2)::int AS dow,
            extract(hour FROM "ActivityDateInserted" AT TIME ZONE $2)::int AS hour,
            count(*)::int AS plays
       FROM jf_playback_activity
      WHERE "ActivityDateInserted" > now() - make_interval(days => $1)
      GROUP BY 1, 2`,
    [span, tz]
  );
  return { days: span, timeZone: tz, ...buildPeakGrid(rows) };
}

function calendarItemsInWindow(calendar, { now = new Date(), hours = 24 } = {}) {
  const start = new Date(now).getTime();
  const end = start + hours * 60 * 60 * 1000;
  return (calendar?.releases || [])
    .map((item) => ({ ...item, ms: new Date(item.date).getTime() }))
    .filter((item) => Number.isFinite(item.ms) && item.ms >= start && item.ms <= end)
    .sort((a, b) => a.ms - b.ms)
    .slice(0, 8)
    .map((item) => ({
      id: String(item.id ?? `${item.title}-${item.ms}`),
      title: item.title,
      subtitle: item.subtitle || "",
      episodeTitle: item.episodeTitle || "",
      at: new Date(item.ms).toISOString(),
      monitored: item.monitored !== false,
      hasFile: Boolean(item.hasFile),
      service: item.service || "",
    }));
}

const NEXT_EPISODES_SQL = `
  WITH last AS (
    SELECT DISTINCT ON (e."SeriesId")
           e."SeriesId", e."ParentIndexNumber" AS season, e."IndexNumber" AS episode,
           a."UserName" AS "userName", a."ActivityDateInserted" AS "watchedAt"
      FROM jf_playback_activity a
      JOIN jf_library_episodes e ON e."EpisodeId" = a."EpisodeId"
     WHERE a."ActivityDateInserted" > now() - interval '30 days'
       AND e."IndexNumber" IS NOT NULL AND e."ParentIndexNumber" IS NOT NULL
     ORDER BY e."SeriesId", a."ActivityDateInserted" DESC
  )
  SELECT l."SeriesId" AS "seriesId", l."userName", l."watchedAt",
         nx."EpisodeId" AS "episodeId", nx."Name" AS "episodeTitle", nx."SeriesName" AS "seriesName",
         nx."ParentIndexNumber" AS season, nx."IndexNumber" AS episode, nx."PrimaryImageHash" AS "imageHash"
    FROM last l
    CROSS JOIN LATERAL (
      SELECT x.* FROM jf_library_episodes x
       WHERE x."SeriesId" = l."SeriesId" AND x.archived IS NOT TRUE AND x."ParentIndexNumber" > 0
         AND (x."ParentIndexNumber", x."IndexNumber") > (l.season, l.episode)
       ORDER BY x."ParentIndexNumber", x."IndexNumber"
       LIMIT 1
    ) nx
   ORDER BY l."watchedAt" DESC
   LIMIT 6`;

async function getUpNext({ db, now = new Date() }) {
  const { rows } = await db.query(`SELECT settings->'IntegrationData'->'calendar' AS calendar FROM app_config WHERE "ID"=1`);
  const calendar = rows[0]?.calendar || null;
  const syncedAt = calendar?.syncedAt || null;
  const items = calendarItemsInWindow(calendar, { now });
  if (items.length) return { source: "calendar", calendarSyncedAt: syncedAt, items };

  // No airings in the next 24 hours (or the calendar cache is stale): fall back
  // to the next unwatched episode of each series the household is watching.
  const { rows: next } = await db.query(NEXT_EPISODES_SQL);
  return {
    source: "next-episodes",
    calendarSyncedAt: syncedAt,
    calendarStale: !syncedAt || new Date(now).getTime() - new Date(syncedAt).getTime() > 2 * DAY_MS,
    items: next.map((row) => ({
      id: row.episodeId,
      title: row.seriesName,
      subtitle: `S${String(row.season).padStart(2, "0")}E${String(row.episode).padStart(2, "0")}`,
      episodeTitle: row.episodeTitle || "",
      lastWatchedBy: row.userName || "",
      lastWatchedAt: row.watchedAt,
      imageHash: row.imageHash || null,
    })),
  };
}

// A clearly labelled stand-in disk for demo copies that have no *arr disk report.
function demoDisks() {
  const totalGb = Number(process.env.JG_DEMO_DISK_TOTAL_GB || 0);
  const freeGb = Number(process.env.JG_DEMO_DISK_FREE_GB || 0);
  if (!totalGb || !freeGb) return [];
  return [{ path: "/media (demo figures)", label: "demo", source: "demo", totalSpace: totalGb * 1024 ** 3, freeSpace: freeGb * 1024 ** 3 }];
}

async function getDiskRunway({ db, fetchDisks, now = new Date() }) {
  const { additions, oldest } = await getDiskForecastInputs({ db });
  // Demo copies set JG_DEMO_DISK_* and never ask the *arr apps for disk space.
  let disks = demoDisks();
  const demoDisk = disks.length > 0;
  if (!demoDisk) disks = await fetchDisks().catch(() => []);
  const forecast = buildForecast({ additions, oldest, disks, now });
  const storage = await getStorageReport({ db });
  return {
    demoDisk,
    forecast,
    libraries: (storage.libraries || []).slice(0, 6).map(({ id, name, bytes, items, share }) => ({ id, name, bytes, items, share })),
    libraryBytes: storage.totalBytes || 0,
  };
}

async function getDiskForecastInputs({ db }) {
  const { ADDITIONS_SQL, OLDEST_SQL } = require("./disk-forecast");
  const [additionsResult, oldestResult] = await Promise.all([db.query(ADDITIONS_SQL), db.query(OLDEST_SQL)]);
  if (!additionsResult?.rows || !oldestResult?.rows) throw new Error("Disk forecast queries failed");
  return { additions: additionsResult.rows, oldest: oldestResult.rows[0]?.oldest || null };
}

async function getLastPlayback({ db }) {
  const { rows } = await db.query(
    `SELECT "UserName" AS "userName", "DeviceName" AS "deviceName", "Client" AS client,
            "NowPlayingItemName" AS title, "SeriesName" AS "seriesName", "ActivityDateInserted" AS "endedAt"
       FROM jf_playback_activity ORDER BY "ActivityDateInserted" DESC LIMIT 1`
  );
  return rows[0] || null;
}

module.exports = {
  buildPeakGrid,
  getPeakHours,
  calendarItemsInWindow,
  getUpNext,
  getDiskRunway,
  getDiskForecastInputs,
  getLastPlayback,
  demoDisks,
};

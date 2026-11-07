// Week, month and year in review for one user (or the whole server): top shows, hours watched,
// busiest day and friends. Shared by the Recap page, the PNG card and scheduled deliveries.
const db = require("../db");

const TZ = process.env.TZ || "UTC";

function q(sql, params = []) {
  return db.pool.query(sql, params).then((result) => result.rows);
}

function clampInt(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

const WRAPPED_PERIODS = new Set(["week", "month", "year"]);

// Resolve the requested period to a local-time anchor date. `year` keeps the
// original year-in-review links working; `date` is any day inside the period.
function wrappedPeriod(query = {}) {
  const period = WRAPPED_PERIODS.has(String(query.period)) ? String(query.period) : "year";
  let anchor = /^\d{4}-\d{2}-\d{2}$/.test(String(query.date || "")) ? String(query.date) : null;
  if (!anchor) {
    const year = clampInt(query.year, new Date().getFullYear(), 2000, 2100);
    anchor = year === new Date().getFullYear() || period !== "year" ? new Date().toISOString().slice(0, 10) : `${year}-01-01`;
  }
  return { period, anchor };
}

async function buildWrapped(query = {}) {
  const { period, anchor } = wrappedPeriod(query);
  const userId = query.userId ? String(query.userId) : null;
  // Period bounds as local calendar dates; the queries below convert them with the server time zone.
  const range = await q(
    `SELECT to_char(date_trunc($1::text, $2::timestamp), 'YYYY-MM-DD') AS start,
            to_char(date_trunc($1::text, $2::timestamp) + ('1 ' || $1::text)::interval - interval '1 day', 'YYYY-MM-DD') AS end,
            to_char(date_trunc($1::text, $2::timestamp) + ('1 ' || $1::text)::interval, 'YYYY-MM-DD') AS next_start`,
    [period, anchor]
  );
  const { start, end, next_start: nextStart } = range[0];
  const base = `FROM jf_playback_activity a
      WHERE a."ActivityDateInserted" >= ($2::timestamp AT TIME ZONE $1::text)
        AND a."ActivityDateInserted" < ($3::timestamp AT TIME ZONE $1::text)
        AND ($4::text IS NULL OR a."UserId" = $4)`;
  const params = [TZ, start, nextStart, userId];

  const [totals, topShows, topMovies, busiestDay, weekdays, hours, months, days, binge, genres, topUsers, topClients] = await Promise.all([
    q(`SELECT COUNT(*)::int AS plays, COALESCE(SUM(a."PlaybackDuration"),0)::bigint AS seconds,
              COUNT(DISTINCT a."UserId")::int AS users,
              COUNT(DISTINCT COALESCE(a."EpisodeId", a."NowPlayingItemId"))::int AS titles,
              MIN(a."ActivityDateInserted") AS first_play, MAX(a."ActivityDateInserted") AS last_play,
              COUNT(DISTINCT (a."ActivityDateInserted" AT TIME ZONE $1)::date)::int AS active_days ${base}`, params),
    q(`SELECT a."SeriesName" AS name, MAX(a."NowPlayingItemId") AS item_id, COUNT(*)::int AS plays,
              SUM(a."PlaybackDuration")::bigint AS seconds ${base} AND a."SeriesName" IS NOT NULL
       GROUP BY a."SeriesName" ORDER BY seconds DESC LIMIT 5`, params),
    q(`SELECT a."NowPlayingItemName" AS name, a."NowPlayingItemId" AS item_id, COUNT(*)::int AS plays,
              SUM(a."PlaybackDuration")::bigint AS seconds ${base} AND a."SeriesName" IS NULL
       GROUP BY a."NowPlayingItemName", a."NowPlayingItemId" ORDER BY seconds DESC LIMIT 5`, params),
    q(`SELECT (a."ActivityDateInserted" AT TIME ZONE $1)::date AS day, COUNT(*)::int AS plays,
              SUM(a."PlaybackDuration")::bigint AS seconds ${base}
       GROUP BY day ORDER BY seconds DESC LIMIT 1`, params),
    q(`SELECT EXTRACT(ISODOW FROM a."ActivityDateInserted" AT TIME ZONE $1)::int AS dow,
              SUM(a."PlaybackDuration")::bigint AS seconds ${base} GROUP BY dow ORDER BY dow`, params),
    q(`SELECT EXTRACT(HOUR FROM a."ActivityDateInserted" AT TIME ZONE $1)::int AS hour,
              SUM(a."PlaybackDuration")::bigint AS seconds ${base} GROUP BY hour ORDER BY hour`, params),
    q(`SELECT EXTRACT(MONTH FROM a."ActivityDateInserted" AT TIME ZONE $1)::int AS month,
              COUNT(*)::int AS plays, SUM(a."PlaybackDuration")::bigint AS seconds ${base} GROUP BY month ORDER BY month`, params),
    q(`SELECT to_char((a."ActivityDateInserted" AT TIME ZONE $1)::date, 'YYYY-MM-DD') AS day,
              COUNT(*)::int AS plays, SUM(a."PlaybackDuration")::bigint AS seconds ${base} GROUP BY day ORDER BY day`, params),
    q(`SELECT a."SeriesName" AS name, (a."ActivityDateInserted" AT TIME ZONE $1)::date AS day,
              COUNT(DISTINCT a."EpisodeId")::int AS episodes, SUM(a."PlaybackDuration")::bigint AS seconds
         ${base} AND a."SeriesName" IS NOT NULL AND a."EpisodeId" IS NOT NULL
       GROUP BY a."SeriesName", day ORDER BY episodes DESC, seconds DESC LIMIT 1`, params),
    q(`SELECT g.genre AS name, SUM(a."PlaybackDuration")::bigint AS seconds ${base.replace("WHERE", `
         JOIN jf_library_items i ON i."Id" = a."NowPlayingItemId"
         CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(i."Genres", '[]'::jsonb)) AS g(genre)
       WHERE`)}
       GROUP BY g.genre ORDER BY seconds DESC LIMIT 5`, params),
    q(`SELECT a."UserName" AS name, a."UserId" AS id, COUNT(*)::int AS plays, SUM(a."PlaybackDuration")::bigint AS seconds
         ${base} GROUP BY a."UserName", a."UserId" ORDER BY seconds DESC LIMIT 5`, params),
    q(`SELECT a."Client" AS name, COUNT(*)::int AS plays ${base} AND a."Client" IS NOT NULL
       GROUP BY a."Client" ORDER BY plays DESC LIMIT 3`, params),
  ]);

  let userName = null;
  if (userId) {
    const rows = await q(`SELECT "Name" AS name FROM jf_users WHERE "Id" = $1`, [userId]);
    userName = rows[0]?.name || null;
  }

  return {
    period,
    year: Number(start.slice(0, 4)),
    start,
    end,
    userId,
    userName,
    totals: totals[0],
    topShows,
    topMovies,
    busiestDay: busiestDay[0] || null,
    weekdays,
    hours,
    months,
    days,
    longestBinge: binge[0] || null,
    genres,
    topUsers: userId ? [] : topUsers,
    topClients,
  };
}

module.exports = { buildWrapped, wrappedPeriod };

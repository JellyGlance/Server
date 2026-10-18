// Daily and monthly pre-aggregated playback stats, plus the state used by the
// rollup job and the optional raw playback retention.
//
// Every row in jf_playback_activity is one play. Concurrent streams of the same
// item by the same user are separate rows, so the rollups count rows and never
// collapse plays by user and item.
//
// The rollup tables start empty. The RefreshDashboardStats task backfills them
// in month-sized chunks, and until it has run the stats functions read the raw
// table exactly as before. The index on jf_playback_activity is built
// CONCURRENTLY so playback inserts keep flowing on big databases, which is why
// this migration doesn't run in a transaction.
exports.config = { transaction: false };

const role = () => `"${process.env.POSTGRES_ROLE}"`;

// Plays and seconds per day and library name for the last N days, matching the
// windows the raw-table versions used (NOW() - N days up to NOW()):
// - whole days before "RolledUpThrough" come from js_playback_daily, apart from
//   the first, partial day of the window, which is still read from raw rows;
// - anything newer, and that first day, comes from jf_playback_activity;
// - days before "PrunedBefore" only exist in the rollups, so there the rollup
//   is used even for the first day of the window.
// Durations are summed in seconds and only turned into minutes once per day
// and library, the same rounding the raw versions did.
const statsByDayFunction = `
CREATE OR REPLACE FUNCTION public.js_playback_stats_by_day(days integer, include_archived boolean)
  RETURNS TABLE("Date" date, "Library" text, "Count" bigint, "Duration" bigint)
  LANGUAGE sql STABLE
AS $BODY$
  WITH bounds AS (
    SELECT NOW() - CAST(days || ' days' AS INTERVAL) AS low_ts,
           DATE_TRUNC('day', NOW() - CAST(days || ' days' AS INTERVAL))::date AS low_day,
           COALESCE(s."RolledUpThrough", '-infinity'::date) AS rolled,
           COALESCE(s."PrunedBefore", '-infinity'::date) AS pruned
      FROM (SELECT 1) one
      LEFT JOIN public.js_stats_rollup_state s ON s."ID" = 1
  ),
  parts AS (
    SELECT r."Date", l."Name" AS "Library", r."Plays" AS plays, r."DurationSeconds" AS seconds
      FROM bounds b
      JOIN public.js_playback_daily r
        ON r."Date" >= b.low_day AND r."Date" < b.rolled
       AND (r."Date" > b.low_day OR b.low_day < b.pruned)
      JOIN public.jf_libraries l ON l."Id" = r."LibraryId" AND (include_archived OR l.archived = false)
    UNION ALL
    -- Raw rows newer than the rollups.
    SELECT DATE_TRUNC('day', a."ActivityDateInserted")::date, l."Name", 1, a."PlaybackDuration"
      FROM bounds b
      JOIN public.jf_playback_activity a
        ON a."ActivityDateInserted" >= GREATEST(b.low_ts, b.rolled::timestamptz) AND a."ActivityDateInserted" <= NOW()
      JOIN public.jf_library_items i ON i."Id" = a."NowPlayingItemId"
      JOIN public.jf_libraries l ON i."ParentId" = l."Id" AND (include_archived OR l.archived = false)
    UNION ALL
    -- Raw rows for the first, partial day of the window when that day is rolled up.
    SELECT DATE_TRUNC('day', a."ActivityDateInserted")::date, l."Name", 1, a."PlaybackDuration"
      FROM bounds b
      JOIN public.jf_playback_activity a
        ON a."ActivityDateInserted" >= b.low_ts
       AND a."ActivityDateInserted" < LEAST((b.low_day + 1)::timestamptz, b.rolled::timestamptz)
       AND b.low_day >= b.pruned
      JOIN public.jf_library_items i ON i."Id" = a."NowPlayingItemId"
      JOIN public.jf_libraries l ON i."ParentId" = l."Id" AND (include_archived OR l.archived = false)
  )
  SELECT "Date", "Library", SUM(plays)::bigint, (SUM(seconds) / 60)::bigint
    FROM parts
   GROUP BY "Date", "Library";
$BODY$;`;

const overTimeFunction = `
CREATE OR REPLACE FUNCTION public.fs_watch_stats_over_time(days integer)
  RETURNS TABLE("Date" date, "Count" bigint, "Duration" bigint, "Library" text, "LibraryID" text)
  LANGUAGE plpgsql
  COST 100
  VOLATILE PARALLEL UNSAFE
  ROWS 1000
AS $BODY$
BEGIN
  RETURN QUERY
  SELECT
    dates."Date",
    COALESCE(counts."Count", 0) AS "Count",
    COALESCE(counts."Duration", 0) AS "Duration",
    l."Name" AS "Library",
    l."Id" AS "LibraryID"
  FROM
    (SELECT generate_series(
      DATE_TRUNC('day', NOW() - CAST(days || ' days' AS INTERVAL)),
      DATE_TRUNC('day', NOW()),
      '1 day')::DATE AS "Date") dates
    CROSS JOIN jf_libraries l
    LEFT JOIN js_playback_stats_by_day(days, true) counts
      ON counts."Date" = dates."Date" AND counts."Library" = l."Name"
  WHERE l.archived = false
  ORDER BY "Date", "Library";
END;
$BODY$;`;

const daysOfWeekFunction = `
CREATE OR REPLACE FUNCTION public.fs_watch_stats_popular_days_of_week(days integer)
  RETURNS TABLE("Day" text, "Count" bigint, "Duration" bigint, "Library" text)
  LANGUAGE plpgsql
  COST 100
  VOLATILE PARALLEL UNSAFE
  ROWS 1000
AS $BODY$
BEGIN
  RETURN QUERY
  WITH library_days AS (
    SELECT l."Name" AS "Library", d.day_of_week, d.day_name
      FROM jf_libraries l,
        (VALUES (0, 'Sunday'), (1, 'Monday'), (2, 'Tuesday'), (3, 'Wednesday'),
                (4, 'Thursday'), (5, 'Friday'), (6, 'Saturday')) AS d(day_of_week, day_name)
     WHERE l.archived = false
  )
  SELECT
    library_days.day_name AS "Day",
    COALESCE(SUM(counts."Count"), 0)::bigint AS "Count",
    COALESCE(SUM(counts."Duration"), 0)::bigint AS "Duration",
    library_days."Library" AS "Library"
  FROM library_days
    LEFT JOIN js_playback_stats_by_day(days, false) counts
      ON EXTRACT(DOW FROM counts."Date") = library_days.day_of_week AND counts."Library" = library_days."Library"
  GROUP BY library_days.day_name, library_days.day_of_week, library_days."Library"
  ORDER BY library_days.day_of_week, library_days."Library";
END;
$BODY$;`;

exports.up = async function (knex) {
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS public.js_playback_daily (
      "Date" date NOT NULL,
      "LibraryId" text NOT NULL DEFAULT '',
      "UserId" text NOT NULL DEFAULT '',
      "Plays" bigint NOT NULL DEFAULT 0,
      "DurationSeconds" bigint NOT NULL DEFAULT 0,
      PRIMARY KEY ("Date", "LibraryId", "UserId")
    );
    CREATE TABLE IF NOT EXISTS public.js_playback_monthly (
      "Month" date NOT NULL,
      "LibraryId" text NOT NULL DEFAULT '',
      "UserId" text NOT NULL DEFAULT '',
      "Plays" bigint NOT NULL DEFAULT 0,
      "DurationSeconds" bigint NOT NULL DEFAULT 0,
      PRIMARY KEY ("Month", "LibraryId", "UserId")
    );
    CREATE TABLE IF NOT EXISTS public.js_stats_rollup_state (
      "ID" integer PRIMARY KEY CHECK ("ID" = 1),
      "RolledUpThrough" date,
      "PrunedBefore" date,
      "UpdatedAt" timestamptz NOT NULL DEFAULT NOW()
    );
    INSERT INTO public.js_stats_rollup_state ("ID") VALUES (1) ON CONFLICT DO NOTHING;
  `);
  await knex.raw(`CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_jf_playback_activity_date ON public.jf_playback_activity ("ActivityDateInserted");`);
  await knex.raw(statsByDayFunction);
  await knex.raw(`ALTER FUNCTION public.js_playback_stats_by_day(integer, boolean) OWNER TO ${role()};`);
  await knex.raw(overTimeFunction);
  await knex.raw(`ALTER FUNCTION public.fs_watch_stats_over_time(integer) OWNER TO ${role()};`);
  await knex.raw(daysOfWeekFunction);
  await knex.raw(`ALTER FUNCTION public.fs_watch_stats_popular_days_of_week(integer) OWNER TO ${role()};`);
};

exports.down = async function (knex) {
  // Put the raw-table versions of the stats functions back first.
  await require("./095_fs_watch_stats_over_time_include_duration").up(knex);
  await require("./096_fs_watch_stats_popular_days_of_week_include_duration").up(knex);
  await knex.raw(`DROP FUNCTION IF EXISTS public.js_playback_stats_by_day(integer, boolean);`);
  await knex.raw(`DROP INDEX CONCURRENTLY IF EXISTS public.idx_jf_playback_activity_date;`);
  await knex.raw(`
    DROP TABLE IF EXISTS public.js_stats_rollup_state;
    DROP TABLE IF EXISTS public.js_playback_monthly;
    DROP TABLE IF EXISTS public.js_playback_daily;
  `);
};

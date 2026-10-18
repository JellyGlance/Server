// Daily and monthly playback rollups, and the optional raw playback retention.
//
// Counting: every jf_playback_activity row is one play. Concurrent streams of
// the same item by the same user are separate rows, so plays are always counted
// per row and never collapsed by user and item.
//
// Rolling up: every run recomputes whole days from the raw table, from a few
// days before the last run up to yesterday, plus any older day whose raw play
// count or duration no longer matches its rollup (after an import or a
// restore). Today always stays raw. The first run backfills everything.
// Work is done in CHUNK_DAYS chunks, each in its own transaction, so a big
// backfill or prune never holds one long transaction and can resume.
//
// Retention (off by default): raw rows older than N days are deleted, but
// never past "RolledUpThrough", so only data already in the rollups is
// pruned. Each pruned chunk is recomputed from raw right before its rows are
// deleted. Days before "PrunedBefore" are frozen in the rollups: rows that turn
// up for them later (re-importing an old backup, say) are never added to the
// rollups, because they are usually plays that were already counted, and they
// are never pruned either, because they were never rolled up.
const CHUNK_DAYS = 31;
const RECHECK_DAYS = 3;
const MIN_RETENTION_DAYS = 30;
const MAX_RETENTION_DAYS = 36500;
const LOCK_KEY = 74_210_105; // pg_advisory_xact_lock key shared by rollup and prune

function parseDays(value) {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  const days = Number(value);
  if (!Number.isFinite(days) || days < 0) return null;
  return Math.floor(days);
}

// 0 keeps raw playback forever. Anything else is clamped to the allowed range.
function clampRetentionDays(value) {
  const days = parseDays(value) ?? 0;
  if (days <= 0) return 0;
  return Math.min(MAX_RETENTION_DAYS, Math.max(MIN_RETENTION_DAYS, days));
}

// JS_PLAYBACK_RETENTION_DAYS wins over the Settings value. Nothing set means off.
function resolveRetention(settings = {}, env = process.env) {
  const fromEnv = parseDays(env.JS_PLAYBACK_RETENTION_DAYS);
  const days = fromEnv ?? parseDays(settings?.PlaybackRetentionDays) ?? 0;
  return {
    days: clampRetentionDays(days),
    source: fromEnv !== null ? "env" : "settings",
  };
}

function addDays(dateString, days) {
  const date = new Date(`${dateString}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function toDateString(value) {
  if (!value) return null;
  if (typeof value === "string") return value.slice(0, 10);
  // pg returns DATE columns as local-midnight Dates; format in local time.
  const pad = (n) => String(n).padStart(2, "0");
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}

async function inTransaction(pool, work) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [LOCK_KEY]);
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function readState(client) {
  const { rows } = await client.query(
    `SELECT "RolledUpThrough"::text AS rolled, "PrunedBefore"::text AS pruned, CURRENT_DATE::text AS today,
            (SELECT MIN("ActivityDateInserted")::date::text FROM jf_playback_activity) AS first_day
       FROM js_stats_rollup_state WHERE "ID" = 1`
  );
  const row = rows[0] || {};
  return {
    rolled: toDateString(row.rolled),
    pruned: toDateString(row.pruned),
    today: toDateString(row.today),
    firstDay: toDateString(row.first_day),
  };
}

// One rollup row per day, library and user. COUNT(*) on purpose: one row is one play.
const RAW_DAY_AGGREGATE = `
  SELECT DATE_TRUNC('day', a."ActivityDateInserted")::date AS "Date",
         COALESCE(i."ParentId", '') AS "LibraryId",
         COALESCE(a."UserId", '') AS "UserId",
         COUNT(*) AS "Plays",
         COALESCE(SUM(a."PlaybackDuration"), 0) AS "DurationSeconds"
    FROM jf_playback_activity a
    LEFT JOIN jf_library_items i ON i."Id" = a."NowPlayingItemId"
   WHERE a."ActivityDateInserted" >= $1::date::timestamptz AND a."ActivityDateInserted" < $2::date::timestamptz
   GROUP BY 1, 2, 3`;

// Rebuild every month that overlaps [fromDay, toDay) from the daily table.
async function rebuildMonths(client, fromDay, toDay) {
  const { rows } = await client.query(
    `SELECT DATE_TRUNC('month', $1::date)::date::text AS first, (DATE_TRUNC('month', ($2::date - 1)) + INTERVAL '1 month')::date::text AS last`,
    [fromDay, toDay]
  );
  const { first, last } = rows[0];
  await client.query(`DELETE FROM js_playback_monthly WHERE "Month" >= $1::date AND "Month" < $2::date`, [first, last]);
  await client.query(
    `INSERT INTO js_playback_monthly ("Month", "LibraryId", "UserId", "Plays", "DurationSeconds")
     SELECT DATE_TRUNC('month', "Date")::date, "LibraryId", "UserId", SUM("Plays"), SUM("DurationSeconds")
       FROM js_playback_daily
      WHERE "Date" >= $1::date AND "Date" < $2::date
      GROUP BY 1, 2, 3`,
    [first, last]
  );
}

// Recompute whole days [from, to) from raw.
async function rollupChunk(client, from, to) {
  await client.query(`DELETE FROM js_playback_daily WHERE "Date" >= $1::date AND "Date" < $2::date`, [from, to]);
  await client.query(`INSERT INTO js_playback_daily ("Date", "LibraryId", "UserId", "Plays", "DurationSeconds") ${RAW_DAY_AGGREGATE}`, [from, to]);
  await rebuildMonths(client, from, to);
}

async function setRolledUpThrough(client, day) {
  await client.query(`UPDATE js_stats_rollup_state SET "RolledUpThrough" = $1::date, "UpdatedAt" = NOW() WHERE "ID" = 1`, [day]);
}

// Already rolled days whose raw plays or duration no longer match the rollup.
async function findChangedDays(client, from, to) {
  const { rows } = await client.query(
    `SELECT COALESCE(raw.d, r.d)::text AS day
       FROM (SELECT DATE_TRUNC('day', "ActivityDateInserted")::date AS d, COUNT(*) AS n,
                    COALESCE(SUM("PlaybackDuration"), 0) AS s
               FROM jf_playback_activity
              WHERE "ActivityDateInserted" >= $1::date::timestamptz AND "ActivityDateInserted" < $2::date::timestamptz
              GROUP BY 1) raw
       FULL JOIN (SELECT "Date" AS d, SUM("Plays") AS n, SUM("DurationSeconds") AS s FROM js_playback_daily
                   WHERE "Date" >= $1::date AND "Date" < $2::date GROUP BY 1) r ON r.d = raw.d
      WHERE COALESCE(raw.n, 0) <> COALESCE(r.n, 0) OR COALESCE(raw.s, 0) <> COALESCE(r.s, 0)
      ORDER BY 1`,
    [from, to]
  );
  return rows.map((row) => toDateString(row.day));
}

// Incremental and idempotent: running it twice in a row changes nothing.
async function rollupPlayback(pool) {
  const state = await inTransaction(pool, readState);
  const end = state.today;
  const floor = state.pruned || state.firstDay;
  let start = state.rolled ? addDays(state.rolled, -RECHECK_DAYS) : state.firstDay;
  if (state.pruned && start && start < state.pruned) start = state.pruned;
  let days = 0;

  if (state.rolled && floor && start && floor < start) {
    const changed = await inTransaction(pool, (client) => findChangedDays(client, floor, start));
    for (const day of changed) {
      await inTransaction(pool, (client) => rollupChunk(client, day, addDays(day, 1)));
      days += 1;
    }
  }

  if (start && start < end) {
    for (let from = start; from < end; from = addDays(from, CHUNK_DAYS)) {
      const to = addDays(from, CHUNK_DAYS) < end ? addDays(from, CHUNK_DAYS) : end;
      await inTransaction(pool, async (client) => {
        await rollupChunk(client, from, to);
        await setRolledUpThrough(client, to);
      });
      days += Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
    }
  } else if (end && state.rolled !== end) {
    await inTransaction(pool, (client) => setRolledUpThrough(client, end));
  }
  return { days, rolledUpThrough: end };
}

// Deletes raw rows older than retentionDays, limited to days already rolled up.
async function prunePlayback(pool, retentionDays) {
  if (!(retentionDays > 0)) return { deleted: 0, prunedBefore: null, skipped: "disabled" };
  const state = await inTransaction(pool, readState);
  if (!state.rolled) return { deleted: 0, prunedBefore: state.pruned, skipped: "not rolled up yet" };
  const wanted = addDays(state.today, -retentionDays);
  const cutoff = wanted < state.rolled ? wanted : state.rolled;
  const start = state.pruned || state.firstDay;
  if (!start || start >= cutoff) return { deleted: 0, prunedBefore: state.pruned, skipped: "nothing to prune" };

  let deleted = 0;
  for (let from = start; from < cutoff; from = addDays(from, CHUNK_DAYS)) {
    const to = addDays(from, CHUNK_DAYS) < cutoff ? addDays(from, CHUNK_DAYS) : cutoff;
    deleted += await inTransaction(pool, async (client) => {
      // Raw is still complete for these days, so make the rollup exact first.
      await rollupChunk(client, from, to);
      const result = await client.query(
        `DELETE FROM jf_playback_activity WHERE "ActivityDateInserted" >= $1::date::timestamptz AND "ActivityDateInserted" < $2::date::timestamptz`,
        [from, to]
      );
      await client.query(`UPDATE js_stats_rollup_state SET "PrunedBefore" = $1::date, "UpdatedAt" = NOW() WHERE "ID" = 1`, [to]);
      return result.rowCount || 0;
    });
  }
  return { deleted, prunedBefore: cutoff };
}

async function rollupStatus(pool) {
  const { rows } = await pool.query(
    `SELECT "RolledUpThrough"::text AS rolled_up_through, "PrunedBefore"::text AS pruned_before, "UpdatedAt" AS updated_at,
            (SELECT COUNT(*) FROM js_playback_daily)::int AS daily_rows,
            (SELECT COUNT(*) FROM js_playback_monthly)::int AS monthly_rows,
            (SELECT MIN("Month")::text FROM js_playback_monthly) AS first_month
       FROM js_stats_rollup_state WHERE "ID" = 1`
  );
  return rows[0] || null;
}

module.exports = {
  CHUNK_DAYS,
  MIN_RETENTION_DAYS,
  MAX_RETENTION_DAYS,
  addDays,
  clampRetentionDays,
  prunePlayback,
  resolveRetention,
  rollupPlayback,
  rollupStatus,
};

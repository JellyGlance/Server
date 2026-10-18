// Playback rollups and raw playback retention.
//
// The unit tests always run. The database tests need a Postgres server they can
// create a throwaway database on, for example:
//   JG_TEST_DATABASE_URL=postgres://postgres:secret@127.0.0.1:5432/postgres npm test -w @jellyglance/api
// They run every migration into a fresh database, seed a few months of plays and
// compare the rollup-backed stats functions with the raw-table versions they
// replace (taken straight from migrations 095 and 096).
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const rollups = require("../classes/playback-rollups");

const { resolveRetention, clampRetentionDays, prunePlayback, rollupPlayback, addDays, MIN_RETENTION_DAYS } = rollups;

test("retention is off when nothing is configured", () => {
  assert.deepEqual(resolveRetention({}, {}), { days: 0, source: "settings" });
  assert.deepEqual(resolveRetention(undefined, {}), { days: 0, source: "settings" });
  assert.equal(resolveRetention({ PlaybackRetentionDays: "" }, {}).days, 0);
  assert.equal(resolveRetention({ PlaybackRetentionDays: "nonsense" }, {}).days, 0);
  assert.equal(resolveRetention({ PlaybackRetentionDays: -5 }, {}).days, 0);
});

test("retention is clamped and the environment wins over Settings", () => {
  assert.equal(clampRetentionDays(7), MIN_RETENTION_DAYS);
  assert.equal(clampRetentionDays(400.9), 400);
  assert.equal(clampRetentionDays(10_000_000), rollups.MAX_RETENTION_DAYS);
  assert.deepEqual(resolveRetention({ PlaybackRetentionDays: 90 }, {}), { days: 90, source: "settings" });
  assert.deepEqual(resolveRetention({ PlaybackRetentionDays: 90 }, { JS_PLAYBACK_RETENTION_DAYS: "0" }), { days: 0, source: "env" });
  assert.deepEqual(resolveRetention({}, { JS_PLAYBACK_RETENTION_DAYS: "120" }), { days: 120, source: "env" });
});

test("pruning with retention off never touches the database", async () => {
  const pool = {
    connect() {
      throw new Error("must not connect");
    },
    query() {
      throw new Error("must not query");
    },
  };
  assert.deepEqual(await prunePlayback(pool, 0), { deleted: 0, prunedBefore: null, skipped: "disabled" });
  assert.deepEqual(await prunePlayback(pool, resolveRetention({}, {}).days), { deleted: 0, prunedBefore: null, skipped: "disabled" });
});

test("addDays works on calendar days across month and year ends", () => {
  assert.equal(addDays("2026-01-31", 1), "2026-02-01");
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
  assert.equal(addDays("2026-12-31", 31), "2027-01-31");
});

const DATABASE_URL = process.env.JG_TEST_DATABASE_URL;
const skip = DATABASE_URL ? false : "set JG_TEST_DATABASE_URL to run the Postgres rollup tests";

// Pull the SQL out of an old migration so the reference functions are exactly the
// raw-table versions, just renamed.
async function referenceSql(file, from, to) {
  const statements = [];
  const fakeKnex = { raw: async (sql) => statements.push(sql), schema: { raw: async (sql) => statements.push(sql) } };
  await require(path.join(__dirname, "..", "migrations", file)).up(fakeKnex);
  return statements.map((sql) => sql.split(from).join(to)).join(";\n");
}

// Small deterministic random generator so failures are reproducible.
function seeded(seed) {
  let value = seed;
  return () => {
    value = (value * 1103515245 + 12345) % 2147483648;
    return value / 2147483648;
  };
}

test("rollups against a real Postgres database", { skip }, async (t) => {
  const { Pool } = require("pg");
  const knex = require("knex");
  const admin = new Pool({ connectionString: DATABASE_URL, max: 1 });
  const dbName = `jg_rollups_test_${process.pid}_${Date.now()}`;
  await admin.query(`CREATE DATABASE ${dbName}`);
  const url = new URL(DATABASE_URL);
  url.pathname = `/${dbName}`;
  process.env.POSTGRES_ROLE = process.env.POSTGRES_ROLE || decodeURIComponent(url.username);
  const pool = new Pool({ connectionString: url.toString(), max: 4 });

  t.after(async () => {
    await pool.end();
    await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin.end();
  });

  const migrator = knex({
    client: "pg",
    connection: url.toString(),
    migrations: { directory: path.join(__dirname, "..", "migrations"), loadExtensions: [".js"] },
  });
  const originalLog = console.log;
  console.log = () => {};
  try {
    await migrator.migrate.latest();
  } finally {
    console.log = originalLog;
    await migrator.destroy();
  }

  await pool.query(await referenceSql("095_fs_watch_stats_over_time_include_duration.js", "fs_watch_stats_over_time", "ref_watch_stats_over_time"));
  await pool.query(
    await referenceSql("096_fs_watch_stats_popular_days_of_week_include_duration.js", "fs_watch_stats_popular_days_of_week", "ref_watch_stats_popular_days_of_week")
  );

  // Libraries: two active, one archived that shares a name with an active one,
  // like a library that was removed and added again.
  await pool.query(`
    INSERT INTO jf_libraries ("Id", "Name", "CollectionType", archived) VALUES
      ('lib-movies', 'Movies', 'movies', false),
      ('lib-shows', 'Shows', 'tvshows', false),
      ('lib-old-movies', 'Movies', 'movies', true)`);
  await pool.query(`
    INSERT INTO jf_library_items ("Id", "Name", "Type", "ParentId") VALUES
      ('m1', 'Arrival', 'Movie', 'lib-movies'), ('m2', 'Heat', 'Movie', 'lib-movies'),
      ('s1', 'Severance', 'Series', 'lib-shows'), ('s2', 'Andor', 'Series', 'lib-shows'),
      ('o1', 'Old film', 'Movie', 'lib-old-movies')`);

  const random = seeded(42);
  const items = ["m1", "m2", "s1", "s2", "o1", "missing-item"];
  const users = ["u1", "u2", "u3"];
  const rows = [];
  for (let n = 0; n < 2500; n += 1) {
    rows.push({
      id: `p${n}`,
      user: users[Math.floor(random() * users.length)],
      item: items[Math.floor(random() * items.length)],
      minutesAgo: Math.floor(random() * 200 * 24 * 60),
      duration: random() < 0.02 ? null : Math.floor(random() * 7200),
    });
  }
  async function insertPlays(list) {
    await pool.query(
      `INSERT INTO jf_playback_activity ("Id", "UserId", "UserName", "NowPlayingItemId", "NowPlayingItemName", "PlaybackDuration", "ActivityDateInserted")
       SELECT r.id, r.user_id, r.user_id, r.item, r.item, r.duration, NOW() - make_interval(mins => r.minutes_ago)
         FROM json_to_recordset($1::json) AS r(id text, user_id text, item text, duration bigint, minutes_ago int)`,
      [JSON.stringify(list.map((row) => ({ id: row.id, user_id: row.user, item: row.item, duration: row.duration, minutes_ago: row.minutesAgo })))]
    );
  }
  await insertPlays(rows);

  // Same NOW() for the reference and the rollup-backed function.
  async function compare(days) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = {};
      for (const [name, ref] of [
        ["fs_watch_stats_over_time", "ref_watch_stats_over_time"],
        ["fs_watch_stats_popular_days_of_week", "ref_watch_stats_popular_days_of_week"],
      ]) {
        const actual = (await client.query(`SELECT * FROM ${name}($1)`, [days])).rows;
        const expected = (await client.query(`SELECT * FROM ${ref}($1)`, [days])).rows;
        result[name] = { actual, expected };
      }
      await client.query("COMMIT");
      return result;
    } finally {
      client.release();
    }
  }
  async function assertSameAsRaw(label) {
    for (const days of [1, 7, 30, 90, 365]) {
      const result = await compare(days);
      for (const [name, { actual, expected }] of Object.entries(result)) {
        assert.ok(expected.length > 0, `${name}(${days}) returned rows`);
        assert.deepEqual(actual, expected, `${label}: ${name}(${days}) matches the raw-table version`);
      }
    }
  }
  const snapshot = async () =>
    (
      await pool.query(`SELECT json_build_object(
        'daily', (SELECT json_agg(d ORDER BY "Date", "LibraryId", "UserId") FROM js_playback_daily d),
        'monthly', (SELECT json_agg(m ORDER BY "Month", "LibraryId", "UserId") FROM js_playback_monthly m)) AS s`)
    ).rows[0].s;
  async function assertRollupsMatchRaw(label) {
    const { rows: diff } = await pool.query(`
      WITH state AS (
        SELECT "RolledUpThrough" AS rolled, COALESCE("PrunedBefore", '-infinity'::date) AS pruned FROM js_stats_rollup_state
      ), raw AS (
        SELECT DATE_TRUNC('day', a."ActivityDateInserted")::date AS d, COALESCE(i."ParentId", '') AS l, a."UserId" AS u,
               COUNT(*) AS n, COALESCE(SUM(a."PlaybackDuration"), 0) AS s
          FROM jf_playback_activity a LEFT JOIN jf_library_items i ON i."Id" = a."NowPlayingItemId", state
         WHERE a."ActivityDateInserted" < state.rolled::timestamptz AND a."ActivityDateInserted" >= state.pruned::timestamptz
         GROUP BY 1, 2, 3
      ), rolled AS (
        SELECT r.* FROM js_playback_daily r, state WHERE r."Date" >= state.pruned
      )
      SELECT * FROM raw FULL JOIN rolled r ON r."Date" = raw.d AND r."LibraryId" = raw.l AND r."UserId" = raw.u
       WHERE raw.n IS DISTINCT FROM r."Plays" OR raw.s IS DISTINCT FROM r."DurationSeconds"`);
    assert.deepEqual(diff, [], `${label}: daily rollups equal the raw totals`);
    const { rows: monthDiff } = await pool.query(`
      SELECT * FROM (SELECT DATE_TRUNC('month', "Date")::date AS m, "LibraryId", "UserId", SUM("Plays") AS n, SUM("DurationSeconds") AS s
                       FROM js_playback_daily GROUP BY 1, 2, 3) d
      FULL JOIN js_playback_monthly mo ON mo."Month" = d.m AND mo."LibraryId" = d."LibraryId" AND mo."UserId" = d."UserId"
      WHERE d.n IS DISTINCT FROM mo."Plays" OR d.s IS DISTINCT FROM mo."DurationSeconds"`);
    assert.deepEqual(monthDiff, [], `${label}: monthly rollups equal the sum of the daily rollups`);
  }
  const totals = async () =>
    (await pool.query(`SELECT COUNT(*)::int AS plays, COALESCE(SUM("PlaybackDuration"), 0)::bigint::text AS seconds FROM jf_playback_activity`)).rows[0];

  await t.test("before the first rollup the stats read raw rows and match exactly", async () => {
    await assertSameAsRaw("no rollups yet");
  });

  await t.test("the first run backfills every finished day and matches raw totals", async () => {
    const result = await rollupPlayback(pool);
    assert.ok(result.days >= 190, `backfilled ${result.days} days`);
    const { rows } = await pool.query(`SELECT "RolledUpThrough"::text AS r, CURRENT_DATE::text AS today FROM js_stats_rollup_state`);
    assert.equal(rows[0].r, rows[0].today, "everything before today is rolled up");
    await assertRollupsMatchRaw("after backfill");
    await assertSameAsRaw("after backfill");
  });

  await t.test("running the rollup again changes nothing", async () => {
    const before = await snapshot();
    await rollupPlayback(pool);
    await rollupPlayback(pool);
    assert.deepEqual(await snapshot(), before);
    await assertSameAsRaw("after repeat runs");
  });

  await t.test("concurrent streams of the same item by the same user count as separate plays", async () => {
    const day = (await pool.query(`SELECT (CURRENT_DATE - 20)::text AS d`)).rows[0].d;
    // Two devices playing Arrival at the same moment, plus a later rewatch.
    for (const [id, at] of [
      ["multi-a", "20:00"],
      ["multi-b", "20:00"],
      ["multi-c", "22:30"],
    ]) {
      await pool.query(
        `INSERT INTO jf_playback_activity ("Id", "UserId", "UserName", "NowPlayingItemId", "NowPlayingItemName", "PlaybackDuration", "ActivityDateInserted")
         VALUES ($1, 'u-multi', 'u-multi', 'm1', 'Arrival', 3600, ($2::date + $3::time)::timestamptz)`,
        [id, day, at]
      );
    }
    await rollupPlayback(pool);
    const { rows } = await pool.query(
      `SELECT "Plays"::int AS plays, "DurationSeconds"::int AS seconds FROM js_playback_daily WHERE "Date" = $1 AND "UserId" = 'u-multi' AND "LibraryId" = 'lib-movies'`,
      [day]
    );
    assert.deepEqual(rows, [{ plays: 3, seconds: 10800 }]);
    await assertRollupsMatchRaw("after concurrent streams");
    await assertSameAsRaw("after concurrent streams");
  });

  await t.test("late rows for an old, already rolled day are picked up by the next run", async () => {
    await insertPlays([
      { id: "late-1", user: "u2", item: "s1", minutesAgo: 150 * 24 * 60, duration: 1500 },
      { id: "late-2", user: "u2", item: "s1", minutesAgo: 150 * 24 * 60, duration: 1500 },
    ]);
    await pool.query(`UPDATE jf_playback_activity SET "PlaybackDuration" = COALESCE("PlaybackDuration", 0) + 60 WHERE "Id" = 'p10'`);
    await rollupPlayback(pool);
    await assertRollupsMatchRaw("after a late import");
    await assertSameAsRaw("after a late import");
  });

  await t.test("retention is off by default, so the stats task keeps every raw row", async () => {
    const before = await totals();
    const retention = resolveRetention({}, {});
    assert.equal(retention.days, 0);
    const result = await prunePlayback(pool, retention.days);
    assert.equal(result.deleted, 0);
    assert.deepEqual(await totals(), before);
    const { rows } = await pool.query(`SELECT "PrunedBefore" FROM js_stats_rollup_state`);
    assert.equal(rows[0].PrunedBefore, null);
  });

  await t.test("retention only prunes days that are already rolled up", async () => {
    const before = await totals();
    // Pretend the rollup is behind: only days before today - 120 are rolled up.
    await pool.query(`UPDATE js_stats_rollup_state SET "RolledUpThrough" = CURRENT_DATE - 120`);
    const result = await prunePlayback(pool, 30);
    const { rows } = await pool.query(`
      SELECT (SELECT COUNT(*)::int FROM jf_playback_activity WHERE "ActivityDateInserted" < (CURRENT_DATE - 120)::timestamptz) AS old_left,
             (SELECT COUNT(*)::int FROM jf_playback_activity WHERE "ActivityDateInserted" >= (CURRENT_DATE - 120)::timestamptz) AS kept,
             "PrunedBefore"::text AS pruned, (CURRENT_DATE - 120)::text AS expected
        FROM js_stats_rollup_state`);
    assert.ok(result.deleted > 0);
    assert.equal(rows[0].old_left, 0);
    assert.equal(rows[0].pruned, rows[0].expected);
    assert.equal(rows[0].kept + result.deleted, before.plays, "nothing newer than the rolled-up days was deleted");
    await rollupPlayback(pool);
    await assertRollupsMatchRaw("after a partial prune");
  });

  await t.test("retention prunes rows older than N days and the charts keep their totals", async () => {
    const expected = {};
    for (const days of [90, 180]) expected[days] = await compare(days);
    const result = await prunePlayback(pool, 30);
    assert.ok(result.deleted > 0);
    const { rows } = await pool.query(`
      SELECT (SELECT COUNT(*)::int FROM jf_playback_activity WHERE "ActivityDateInserted" < (CURRENT_DATE - 30)::timestamptz) AS too_old,
             "PrunedBefore"::text AS pruned, (CURRENT_DATE - 30)::text AS cutoff
        FROM js_stats_rollup_state`);
    assert.equal(rows[0].too_old, 0);
    assert.equal(rows[0].pruned, rows[0].cutoff);
    for (const days of [90, 180]) {
      const after = await compare(days);
      // Only the first, partial day of each window may differ: its raw rows are
      // gone, so the whole day now comes from the rollup.
      const firstDay = String(expected[days].fs_watch_stats_over_time.expected[0].Date);
      const strip = (list) => list.filter((row) => String(row.Date) !== firstDay);
      assert.deepEqual(
        strip(after.fs_watch_stats_over_time.actual),
        strip(expected[days].fs_watch_stats_over_time.actual),
        `fs_watch_stats_over_time(${days}) keeps its totals after pruning`
      );
      const sum = (list) => list.reduce((total, row) => total + Number(row.Count), 0);
      assert.ok(
        sum(after.fs_watch_stats_popular_days_of_week.actual) >= sum(expected[days].fs_watch_stats_popular_days_of_week.actual),
        `fs_watch_stats_popular_days_of_week(${days}) keeps every pruned play`
      );
    }
    await assertRollupsMatchRaw("after pruning");
  });

  await t.test("rows that turn up for already pruned days are neither double counted nor deleted", async () => {
    const before = await snapshot();
    await insertPlays([{ id: "reimport-1", user: "u1", item: "m1", minutesAgo: 100 * 24 * 60, duration: 600 }]);
    await rollupPlayback(pool);
    await prunePlayback(pool, 30);
    assert.deepEqual(await snapshot(), before, "frozen days keep their rollups");
    const { rows } = await pool.query(`SELECT COUNT(*)::int AS n FROM jf_playback_activity WHERE "Id" = 'reimport-1'`);
    assert.equal(rows[0].n, 1, "a row that was never rolled up is never pruned");
  });

  await t.test("the migration rolls back and applies again", async () => {
    const migration = require("../migrations/105_playback_rollups");
    const db = knex({ client: "pg", connection: url.toString() });
    try {
      await migration.down(db);
      const gone = await pool.query(`SELECT to_regclass('public.js_playback_daily') AS t`);
      assert.equal(gone.rows[0].t, null);
      const raw = await pool.query(`SELECT COUNT(*)::int AS n FROM fs_watch_stats_over_time(30)`);
      assert.ok(raw.rows[0].n > 0, "the raw-table stats function is back");
      await migration.up(db);
      const back = await pool.query(`SELECT to_regclass('public.js_playback_daily') AS t`);
      assert.equal(back.rows[0].t, "js_playback_daily");
    } finally {
      await db.destroy();
    }
  });
});

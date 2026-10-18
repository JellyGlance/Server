#!/usr/bin/env node
// Times the stats chart queries on a big seeded database, before and after the
// playback rollups. It creates its own throwaway database and drops it again.
//
//   JG_BENCH_DATABASE_URL=postgres://postgres:secret@127.0.0.1:5432/postgres \
//     node scripts/benchmark-stats-rollups.js [plays=2000000] [runs=5] [users=25]
//
// "before" is the raw-table SQL from migrations 095 and 096 without the new
// date index, which is what main runs today.
const path = require("node:path");
const { Pool } = require("pg");
const knex = require("knex");
const { rollupPlayback } = require("../classes/playback-rollups");

const DATABASE_URL = process.env.JG_BENCH_DATABASE_URL;
const PLAYS = Number(process.argv[2] || 2_000_000);
const RUNS = Number(process.argv[3] || 5);
const USERS = Number(process.argv[4] || 25);

async function referenceSql(file, from, to) {
  const statements = [];
  const fakeKnex = { raw: async (sql) => statements.push(sql), schema: { raw: async (sql) => statements.push(sql) } };
  await require(path.join(__dirname, "..", "migrations", file)).up(fakeKnex);
  return statements.map((sql) => sql.split(from).join(to)).join(";\n");
}

async function median(pool, sql, params) {
  const times = [];
  await pool.query(sql, params); // warm-up
  for (let run = 0; run < RUNS; run += 1) {
    const start = process.hrtime.bigint();
    await pool.query(sql, params);
    times.push(Number(process.hrtime.bigint() - start) / 1e6);
  }
  times.sort((a, b) => a - b);
  return times[Math.floor(times.length / 2)];
}

async function main() {
  if (!DATABASE_URL) throw new Error("Set JG_BENCH_DATABASE_URL to a Postgres server this script can create a database on.");
  const admin = new Pool({ connectionString: DATABASE_URL, max: 1 });
  const dbName = `jg_rollups_bench_${process.pid}`;
  await admin.query(`CREATE DATABASE ${dbName}`);
  const url = new URL(DATABASE_URL);
  url.pathname = `/${dbName}`;
  process.env.POSTGRES_ROLE = process.env.POSTGRES_ROLE || decodeURIComponent(url.username);
  const pool = new Pool({ connectionString: url.toString(), max: 2 });
  pool.on("error", () => {});
  try {
    const migrator = knex({ client: "pg", connection: url.toString(), migrations: { directory: path.join(__dirname, "..", "migrations"), loadExtensions: [".js"] } });
    const log = console.log;
    console.log = () => {};
    await migrator.migrate.latest().finally(() => {
      console.log = log;
      return migrator.destroy();
    });
    await pool.query(await referenceSql("095_fs_watch_stats_over_time_include_duration.js", "fs_watch_stats_over_time", "ref_watch_stats_over_time"));
    await pool.query(await referenceSql("096_fs_watch_stats_popular_days_of_week_include_duration.js", "fs_watch_stats_popular_days_of_week", "ref_watch_stats_popular_days_of_week"));

    // 12 libraries, 40,000 items and USERS users, plays spread over three years.
    let seconds = Date.now();
    await pool.query(`INSERT INTO jf_libraries ("Id", "Name", "CollectionType", archived)
                      SELECT 'lib-' || n, 'Library ' || n, 'movies', false FROM generate_series(1, 12) n`);
    await pool.query(`INSERT INTO jf_library_items ("Id", "Name", "Type", "ParentId")
                      SELECT 'item-' || n, 'Item ' || n, 'Movie', 'lib-' || (1 + n % 12) FROM generate_series(1, 40000) n`);
    await pool.query(
      `INSERT INTO jf_playback_activity ("Id", "UserId", "UserName", "NowPlayingItemId", "NowPlayingItemName", "PlaybackDuration", "ActivityDateInserted")
       SELECT 'play-' || n, 'user-' || (n % $2), 'user-' || (n % $2), 'item-' || (1 + (n::bigint * 7919) % 40000), 'Item',
              (n::bigint * 37) % 7200, NOW() - make_interval(secs => ((n::bigint * 2654435761) % (3 * 365 * 86400))::double precision)
         FROM generate_series(1, $1) n`,
      [PLAYS, USERS]
    );
    await pool.query("ANALYZE");
    const seedSeconds = (Date.now() - seconds) / 1000;

    const queries = [
      ["Views over time, 30 days", "fs_watch_stats_over_time", "ref_watch_stats_over_time", 30],
      ["Views over time, 90 days", "fs_watch_stats_over_time", "ref_watch_stats_over_time", 90],
      ["Views over time, 365 days", "fs_watch_stats_over_time", "ref_watch_stats_over_time", 365],
      ["Days of week, 30 days", "fs_watch_stats_popular_days_of_week", "ref_watch_stats_popular_days_of_week", 30],
      ["Days of week, 365 days", "fs_watch_stats_popular_days_of_week", "ref_watch_stats_popular_days_of_week", 365],
    ];

    await pool.query(`DROP INDEX IF EXISTS idx_jf_playback_activity_date`);
    const before = {};
    for (const [label, , ref, days] of queries) before[label] = await median(pool, `SELECT * FROM ${ref}($1)`, [days]);
    await pool.query(`CREATE INDEX idx_jf_playback_activity_date ON jf_playback_activity ("ActivityDateInserted")`);

    seconds = Date.now();
    const rollup = await rollupPlayback(pool);
    const backfillSeconds = (Date.now() - seconds) / 1000;
    seconds = Date.now();
    await rollupPlayback(pool);
    const incrementalSeconds = (Date.now() - seconds) / 1000;
    await pool.query("ANALYZE");

    const results = [];
    for (const [label, fn, , days] of queries) {
      const after = await median(pool, `SELECT * FROM ${fn}($1)`, [days]);
      results.push({ label, before: before[label], after });
    }
    const daily = (await pool.query(`SELECT COUNT(*)::int AS n FROM js_playback_daily`)).rows[0].n;

    const report = {
      plays: PLAYS,
      users: USERS,
      runs: RUNS,
      postgres: (await pool.query("SHOW server_version")).rows[0].server_version,
      seedSeconds,
      backfillDays: rollup.days,
      backfillSeconds,
      incrementalSeconds,
      dailyRows: daily,
      results,
    };
    console.log(JSON.stringify(report, null, 2));
    console.log("");
    console.log(`${PLAYS.toLocaleString("en-GB")} plays by ${USERS} users over 3 years, 12 libraries, median of ${RUNS} runs`);
    for (const row of results) {
      console.log(`${row.label.padEnd(28)} before ${row.before.toFixed(1).padStart(8)} ms   after ${row.after.toFixed(1).padStart(7)} ms   ${(row.before / row.after).toFixed(0)}x`);
    }
    console.log(`Backfill: ${rollup.days} days in ${backfillSeconds.toFixed(1)} s, next run ${incrementalSeconds.toFixed(2)} s, ${daily.toLocaleString("en-GB")} daily rollup rows`);
  } finally {
    await pool.end();
    if (process.env.JG_BENCH_KEEP === "1") console.log(`Kept database ${dbName}`);
    else await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

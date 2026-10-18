const { parentPort } = require("worker_threads");
const db = require("../db");
const { resolveRetention, rollupPlayback, prunePlayback } = require("../classes/playback-rollups");

// Roll up finished days and, only if retention is turned on, prune old raw rows.
async function runPlaybackRollups() {
  const rollup = await rollupPlayback(db.pool);
  const { rows } = await db.pool.query('SELECT settings FROM app_config WHERE "ID" = 1');
  const retention = resolveRetention(rows[0]?.settings || {});
  const prune = await prunePlayback(db.pool, retention.days);
  console.log(
    `[ROLLUPS] Rolled up ${rollup.days} day(s) through ${rollup.rolledUpThrough || "-"}` +
      (retention.days ? `; pruned ${prune.deleted} raw playback row(s) before ${prune.prunedBefore || "-"}` : "")
  );
}

async function runRefreshDashboardStatsTask() {
  try {
    // Rollups (and any pruning) run first so the materialized views below are
    // refreshed from the same raw rows. A rollup failure doesn't stop them.
    let rollupError = null;
    try {
      await runPlaybackRollups();
    } catch (error) {
      rollupError = error;
      console.error("[ROLLUPS] Playback rollup failed:", error.message);
    }

    for (const view of db.materializedViews) {
      await db.refreshMaterializedView(view);
    }

    if (rollupError) {
      parentPort.postMessage({ status: "error", message: rollupError.message });
      return;
    }
    parentPort.postMessage({ status: "complete" });
  } catch (error) {
    parentPort.postMessage({ status: "error", message: error.message });
  }
}

parentPort.on("message", async (message) => {
  if (message.command === "start") {
    await runRefreshDashboardStatsTask();
    process.exit(0);
  }
});

// Scheduled refreshes run at most once per window, and steady activity cannot postpone them.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const state = { batches: 0, refreshes: 0 };

class FakePool {
  on() {}
  async query() {
    return { rows: [] };
  }
  async connect() {
    return {
      async query(sql) {
        const text = typeof sql === "string" ? sql : sql.text;
        if (text.startsWith("REFRESH")) {
          state.refreshes += 1;
          if (text.includes("js_latest_playback_activity")) state.batches += 1;
        }
        return { rows: [] };
      },
      release() {},
    };
  }
}

const WINDOW_MS = 60;
process.env.MATERIALIZED_VIEW_REFRESH_DEBOUNCE_MS = String(WINDOW_MS);
process.env.POSTGRES_USER = "test";
process.env.POSTGRES_PASSWORD = "test";
process.env.POSTGRES_IP = "127.0.0.1";
process.env.POSTGRES_PORT = "5432";
require("pg").Pool = FakePool; // db.js destructures Pool at load time
const db = require(path.join(__dirname, "..", "db"));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("many schedule calls inside one window run a single refresh batch", async () => {
  Object.assign(state, { batches: 0, refreshes: 0 });
  for (let i = 0; i < 50; i += 1) db.scheduleMaterializedViewRefreshes();
  await sleep(WINDOW_MS * 2);
  assert.equal(state.batches, 1);
  assert.equal(state.refreshes, db.materializedViews.length);
});

test("continuous activity still refreshes once per window instead of postponing forever", async () => {
  Object.assign(state, { batches: 0, refreshes: 0 });
  const until = Date.now() + WINDOW_MS * 5;
  while (Date.now() < until) {
    db.scheduleMaterializedViewRefreshes(); // a write every 10ms, never quiet for a full window
    await sleep(10);
  }
  await sleep(WINDOW_MS * 2);
  assert.ok(state.batches >= 3, `expected refreshes during the activity, got ${state.batches}`);
  assert.ok(state.batches <= 7, `expected about one refresh per window, got ${state.batches}`);
});

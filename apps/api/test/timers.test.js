const test = require("node:test");
const assert = require("node:assert/strict");
const timers = require("../classes/timers");
const configReady = require("../classes/config-ready");
const JellyfinAPI = require("../classes/jellyfin-api");
const EmbyAPI = require("../classes/emby-api");

test("API instances share one config-ready poll instead of a timer each", () => {
  const before = timers.activeCount();
  const apis = [new JellyfinAPI(), new JellyfinAPI(), new EmbyAPI()];
  assert.equal(configReady.pendingCount() >= apis.length, true);
  assert.equal(timers.activeCount() - before <= 1, true);
  for (const api of apis) api.stopReadyCheck();
});

test("a subscriber that reports ready is dropped and the poll stops", async () => {
  let calls = 0;
  configReady.whenReady(async () => {
    calls += 1;
    return true;
  });
  await configReady._tick();
  assert.equal(calls, 1);
  assert.equal(configReady.pendingCount(), 0);
});

test("a subscriber keeps being called until it's ready", async () => {
  let calls = 0;
  configReady.whenReady(async () => ++calls >= 2);
  await configReady._tick();
  assert.equal(configReady.pendingCount(), 1);
  await configReady._tick();
  assert.equal(configReady.pendingCount(), 0);
  assert.equal(calls, 2);
});

test("tracked timers are unref'd and stopAll clears them", () => {
  const handle = timers.every(() => {}, 60000);
  assert.equal(handle.hasRef(), false);
  timers.stopAll();
  assert.equal(timers.activeCount(), 0);
});

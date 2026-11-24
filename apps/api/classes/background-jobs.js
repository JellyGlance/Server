// Light in-process jobs that run every few minutes: the daily calendar digest and
// scheduled collection builders. Each job decides for itself whether it is due.
const CHECK_EVERY_MS = 10 * 60 * 1000;
let timer = null;
let running = false;

async function tick() {
  if (running) return;
  running = true;
  try {
    const feed = require("./calendar-feed");
    await feed.maybeSendDigest().catch((error) => console.error("[BACKGROUND] Calendar digest failed:", error.message));
    const libraryTools = require("./library-tools");
    await libraryTools.maybeRunUpgradeBatch().catch((error) => console.error("[BACKGROUND] Upgrade searches failed:", error.message));
    const collections = require("./auto-collections");
    if (typeof collections.runScheduledBuilders === "function") {
      await collections.runScheduledBuilders().catch((error) => console.error("[BACKGROUND] Scheduled collections failed:", error.message));
    }
  } finally {
    running = false;
  }
}

function start() {
  // Off in tests and when scheduled tasks are disabled; each job also checks its own switches
  // (digest: enabled + JG_DISABLE_NOTIFICATIONS, upgrades/collections: JG_DISABLE_SERVER_AUTOMATION).
  if (timer || process.env.NODE_ENV === "test" || process.env.JG_DISABLE_SCHEDULED_TASKS === "1") return;
  // First check a minute after start, so a restart does not delay a due digest by ten minutes.
  setTimeout(tick, 60 * 1000).unref?.();
  timer = setInterval(tick, CHECK_EVERY_MS);
  timer.unref?.();
}

module.exports = { start, tick };

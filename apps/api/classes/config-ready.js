// One shared poll for "is JellyGlance configured yet?".
//
// The Jellyfin and Emby API classes used to start their own 5 second
// setInterval in every constructor. They now subscribe here instead: a single
// timer calls each subscriber every POLL_MS until the subscriber reports it has
// loaded its config (returns true), then drops it. The timer stops when nobody
// is waiting.
const timers = require("./timers");

const POLL_MS = 5000;
const subscribers = new Set();
let timer = null;
let running = false;

async function tick() {
  if (running) return;
  running = true;
  try {
    for (const subscriber of [...subscribers]) {
      try {
        if (await subscriber()) subscribers.delete(subscriber);
      } catch (error) {
        console.warn("[CONFIG] Ready check failed:", error.message);
      }
    }
  } finally {
    running = false;
    if (!subscribers.size) stop();
  }
}

// Calls `check` every POLL_MS until it resolves true. Returns an unsubscribe function.
function whenReady(check) {
  subscribers.add(check);
  if (!timer) timer = timers.every(tick, POLL_MS);
  return () => {
    subscribers.delete(check);
    if (!subscribers.size) stop();
  };
}

function stop() {
  timers.clear(timer);
  timer = null;
}

function pendingCount() {
  return subscribers.size;
}

module.exports = { whenReady, stop, pendingCount, POLL_MS, _tick: tick };

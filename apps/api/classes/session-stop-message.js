const DEFAULT_DELAY_MS = 5000;
const MIN_DELAY_MS = 1000;
const MAX_DELAY_MS = 30000;

function httpError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeDelayMs(value, { allowZero = false } = {}) {
  if (value === undefined || value === null || value === "") return DEFAULT_DELAY_MS;
  const delay = Number(value);
  if (!Number.isFinite(delay)) return DEFAULT_DELAY_MS;
  if (allowZero && delay === 0) return 0;
  return Math.min(MAX_DELAY_MS, Math.max(MIN_DELAY_MS, Math.round(delay)));
}

async function stopSessionWithMessage(
  { sessionId, text, header = "JellyGlance", delayMs, timeoutMs } = {},
  { jellyfin, sleep = defaultSleep, allowZeroDelay = false } = {}
) {
  const id = String(sessionId || "").trim();
  const message = String(text || "").trim();
  if (!id) throw httpError("Missing sessionId");
  if (!message) throw httpError("Missing message text");
  if (!jellyfin?.sendSessionMessage || !jellyfin?.stopSession) {
    throw httpError("Jellyfin client is not ready", 500);
  }

  const delayedMs = normalizeDelayMs(delayMs, { allowZero: allowZeroDelay });
  const displayTimeout = Number(timeoutMs) || Math.max(8000, delayedMs + 2000);

  await jellyfin.sendSessionMessage(id, { header, text: message, timeoutMs: displayTimeout });
  if (delayedMs > 0) await sleep(delayedMs);
  await jellyfin.stopSession(id);
  return { ok: true, delayedMs };
}

module.exports = {
  DEFAULT_DELAY_MS,
  MIN_DELAY_MS,
  MAX_DELAY_MS,
  normalizeDelayMs,
  stopSessionWithMessage,
};

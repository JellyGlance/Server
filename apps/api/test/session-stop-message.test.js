const test = require("node:test");
const assert = require("node:assert/strict");
const { stopSessionWithMessage, DEFAULT_DELAY_MS, normalizeDelayMs } = require("../classes/session-stop-message");

function mockJellyfin() {
  const calls = [];
  return {
    calls,
    async sendSessionMessage(sessionId, payload) {
      calls.push(["message", sessionId, payload]);
    },
    async stopSession(sessionId) {
      calls.push(["stop", sessionId]);
    },
  };
}

test("sends the on-screen message, waits, then stops the session, using the injected client", async () => {
  const jellyfin = mockJellyfin();
  const slept = [];
  const result = await stopSessionWithMessage(
    { sessionId: "s1", text: "Server maintenance", delayMs: 2500 },
    { jellyfin, sleep: async (ms) => slept.push(ms), allowZeroDelay: true }
  );
  assert.deepEqual(result, { ok: true, delayedMs: 2500 });
  assert.deepEqual(slept, [2500]);
  assert.equal(jellyfin.calls[0][0], "message");
  assert.equal(jellyfin.calls[0][1], "s1");
  assert.equal(jellyfin.calls[0][2].text, "Server maintenance");
  assert.equal(jellyfin.calls[1][0], "stop");
  assert.equal(jellyfin.calls[1][1], "s1");
});

test("does not stop a session when the message call fails", async () => {
  const calls = [];
  const jellyfin = {
    async sendSessionMessage() {
      calls.push("message");
      throw Object.assign(new Error("Jellyfin rejected the message"), { statusCode: 502 });
    },
    async stopSession() {
      calls.push("stop");
    },
  };
  await assert.rejects(
    () => stopSessionWithMessage({ sessionId: "s1", text: "Stop" }, { jellyfin, sleep: async () => {}, allowZeroDelay: true }),
    /rejected the message/
  );
  assert.deepEqual(calls, ["message"]);
});

test("requires a session id and message text", async () => {
  const jellyfin = mockJellyfin();
  await assert.rejects(() => stopSessionWithMessage({ sessionId: "", text: "Hi" }, { jellyfin, allowZeroDelay: true }), /sessionId/);
  await assert.rejects(() => stopSessionWithMessage({ sessionId: "s1", text: "  " }, { jellyfin, allowZeroDelay: true }), /message text/);
  assert.deepEqual(jellyfin.calls, []);
});

test("defaults to a short delay and clamps live request values", () => {
  assert.equal(normalizeDelayMs(undefined), DEFAULT_DELAY_MS);
  assert.equal(normalizeDelayMs(0), 1000);
  assert.equal(normalizeDelayMs(0, { allowZero: true }), 0);
  assert.equal(normalizeDelayMs(120000), 30000);
});

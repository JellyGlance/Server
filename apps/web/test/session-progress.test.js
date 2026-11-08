import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { formatTicks, getSessionProgress, TICKS_PER_SECOND as T } from "../src/lib/session-progress.js";

const episode = { RunTimeTicks: (42 * 60 + 22) * T };
const now = Date.UTC(2026, 10, 8, 0, 36, 0);

describe("session progress", () => {
  test("paused at the very start: zero position, full runtime left, no end clock, empty bar", () => {
    const p = getSessionProgress(episode, { IsPaused: true, PositionTicks: 0 }, now);
    assert.equal(formatTicks(p.positionTicks), "00:00:00");
    assert.equal(formatTicks(p.runtimeTicks), "00:42:22");
    assert.equal(formatTicks(p.remainingTicks), "00:42:22");
    assert.equal(p.percent, 0);
    assert.equal(p.endsAt, null);
  });

  test("time left is always runtime minus position", () => {
    const p = getSessionProgress(episode, { IsPaused: false, PositionTicks: (20 * 60 + 3) * T }, now);
    assert.equal(formatTicks(p.positionTicks), "00:20:03");
    assert.equal(formatTicks(p.remainingTicks), "00:22:19");
    assert.equal(p.endsAt.getTime() - now, (22 * 60 + 19) * 1000);
    assert.ok(Math.abs(p.percent - 47.3) < 0.1);
  });

  test("missing position is unknown, not NaN and not a fake end time", () => {
    const p = getSessionProgress(episode, { IsPaused: false }, now);
    assert.equal(formatTicks(p.positionTicks), "--:--:--");
    assert.equal(p.remainingTicks, null);
    assert.equal(p.endsAt, null);
    assert.equal(p.percent, 0);
  });

  test("position past the runtime is clamped", () => {
    const p = getSessionProgress(episode, { PositionTicks: episode.RunTimeTicks * 2 }, now);
    assert.equal(p.percent, 100);
    assert.equal(p.remainingTicks, 0);
  });

  test("no runtime (live TV) gives no remaining time", () => {
    const p = getSessionProgress({}, { PositionTicks: 5 * T }, now);
    assert.equal(p.remainingTicks, null);
    assert.equal(formatTicks(p.positionTicks), "00:00:05");
  });
});

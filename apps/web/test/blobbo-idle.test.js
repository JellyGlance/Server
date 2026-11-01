import test from "node:test";
import assert from "node:assert/strict";
import { idleFrame, idleTransforms, IDLE_FRAMES } from "../src/lib/blobbo-idle.js";

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} vs ${b}`);

test("mild idle params", () => {
  assert.equal(IDLE_FRAMES, 60);
  close(idleFrame(0).dy, -2);
  close(idleFrame(15).dy, -8);
  close(idleFrame(15).k, 0.035 - 0.01);
  close(idleFrame(0).k, 0.01);
  close(idleFrame(15).sway, 5 - 1.8);
  assert.equal(idleFrame(60).frame, 0);
});

test("blink only on frames 36-41", () => {
  for (let f = 0; f < 60; f++) assert.equal(idleFrame(f).blink < 1, f >= 36 && f <= 41);
});

test("squash pivots about 100,104", () => {
  assert.match(idleTransforms(15).squash, /^translate\(100 104\) scale\(1\.0250 0\.9750\) translate\(-100 -104\)$/);
  assert.equal(idleTransforms(15).root, "translate(0 -8.00)");
});

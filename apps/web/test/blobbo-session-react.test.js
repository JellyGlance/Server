import test from "node:test";
import assert from "node:assert/strict";
import { decideSessionReaction, sessionKeys } from "../src/lib/blobbo-session-react.js";

test("first snapshot only sets the baseline", () => {
  assert.equal(decideSessionReaction(null, ["a"], 0, 1000), null);
});

test("idle to playing waves", () => {
  assert.equal(decideSessionReaction([], ["a"], 0, 1000), "wave");
});

test("another stream joining looks over", () => {
  assert.equal(decideSessionReaction(["a"], ["a", "b"], 0, 1000), "look");
});

test("no new sessions, no reaction", () => {
  assert.equal(decideSessionReaction(["a", "b"], ["a"], 0, 1000), null);
});

test("cool-down stops churn from looping", () => {
  assert.equal(decideSessionReaction([], ["a"], 1000, 30000), null);
  assert.equal(decideSessionReaction([], ["a"], 1000, 1000 + 91000), "wave");
});

test("sessionKeys ignores sessions without playback", () => {
  assert.deepEqual(sessionKeys([{ Id: "x", NowPlayingItem: {} }, { Id: "y" }, null]), ["x"]);
  assert.deepEqual(sessionKeys(undefined), []);
});

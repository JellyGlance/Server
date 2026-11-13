import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { orderSessions } from "../src/lib/session-order.js";

const a = { Id: "0a1f9c", UserName: "alice" };
const b = { Id: "5b22d0", UserName: "bob" };
const c = { Id: "e9c104", UserName: "carol" };

describe("active session order", () => {
  test("keeps the same order however Jellyfin sorts the poll", () => {
    const polls = [
      [c, a, b],
      [b, c, a],
      [a, b, c],
      [c, b, a],
    ];
    for (const poll of polls) {
      assert.deepEqual(
        orderSessions(poll).map((s) => s.UserName),
        ["alice", "bob", "carol"]
      );
    }
  });

  test("does not mutate the cached session list", () => {
    const poll = [c, a, b];
    orderSessions(poll);
    assert.deepEqual(poll.map((s) => s.UserName), ["carol", "alice", "bob"]);
  });

  test("handles empty, missing and id-less input", () => {
    assert.deepEqual(orderSessions(null), []);
    assert.deepEqual(orderSessions(undefined), []);
    assert.equal(orderSessions([{ UserName: "x" }, a]).length, 2);
  });
});

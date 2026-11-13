import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LEGACY_VIEW_KEY, VIEW_KEY, readQueueView, saveQueueView } from "../src/pages/requests/view.js";

const memory = (initial = {}) => {
  const data = { ...initial };
  return { data, getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); }, removeItem: (k) => { delete data[k]; } };
};

describe("queue view", () => {
  it("opens in cards on a fresh profile", () => {
    assert.equal(readQueueView(memory()), "cards");
  });

  it("resets an old saved rows value to cards once, and drops it", () => {
    const storage = memory({ [LEGACY_VIEW_KEY]: "rows" });
    assert.equal(readQueueView(storage), "cards");
    assert.equal(LEGACY_VIEW_KEY in storage.data, false);
  });

  it("remembers a later switch to rows, and back", () => {
    const storage = memory({ [LEGACY_VIEW_KEY]: "list" });
    assert.equal(readQueueView(storage), "cards");
    saveQueueView(storage, "list");
    assert.equal(readQueueView(storage), "list");
    saveQueueView(storage, "cards");
    assert.equal(readQueueView(storage), "cards");
  });

  it("ignores junk and never throws", () => {
    assert.equal(readQueueView(memory({ [VIEW_KEY]: "grid" })), "cards");
    const broken = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); }, removeItem() { throw new Error("blocked"); } };
    assert.equal(readQueueView(broken), "cards");
    assert.doesNotThrow(() => saveQueueView(broken, "list"));
    const storage = memory();
    saveQueueView(storage, "weird");
    assert.equal(VIEW_KEY in storage.data, false);
  });
});

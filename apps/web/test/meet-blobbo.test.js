import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { MEET_BLOBBO_SEEN_KEY, MEET_BLOBBO_VERSION_LINE, OPEN_BLOBBO_CHAT_EVENT, WHATS_NEW_SEEN_VERSION_KEY } from "../src/lib/events.js";
import { hasSeenMeetBlobbo, markMeetBlobboSeen, shouldOfferMeetBlobbo, shouldWaitForWhatsNew } from "../src/lib/meet-blobbo.js";

const store = new Map();
globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => { store.set(key, String(value)); },
  removeItem: (key) => { store.delete(key); },
  clear: () => { store.clear(); },
};

describe("meet Blobbo intro gating", () => {
  beforeEach(() => {
    store.clear();
  });

  test("offers the intro on the 1.4.2 line including stamped betas", () => {
    for (const version of ["1.4.2", "1.4.2-beta", "1.4.2-beta.4", "v1.4.2-beta.2"]) {
      assert.equal(shouldOfferMeetBlobbo(version), true, version);
    }
  });

  test("does not offer the intro on later or earlier versions", () => {
    for (const version of ["1.4.3", "1.5.0", "1.4.1", "1.4.3-beta.1", ""]) {
      assert.equal(shouldOfferMeetBlobbo(version), false, version);
    }
  });

  test("does not offer the intro when Blobbo is hidden", () => {
    assert.equal(shouldOfferMeetBlobbo("1.4.2-beta.4", { hidden: true }), false);
  });

  test("persists dismiss so it does not return", () => {
    assert.equal(hasSeenMeetBlobbo(), false);
    markMeetBlobboSeen();
    assert.equal(localStorage.getItem(MEET_BLOBBO_SEEN_KEY), MEET_BLOBBO_VERSION_LINE);
    assert.equal(hasSeenMeetBlobbo(), true);
    assert.equal(shouldOfferMeetBlobbo("1.4.2-beta.4"), false);
    assert.equal(shouldOfferMeetBlobbo("1.4.2"), false);
  });

  test("waits for What's New when that dialog has not been seen this version", () => {
    assert.equal(shouldWaitForWhatsNew("1.4.2-beta"), true);
    localStorage.setItem(WHATS_NEW_SEEN_VERSION_KEY, "1.4.2-beta");
    assert.equal(shouldWaitForWhatsNew("1.4.2-beta"), false);
    assert.equal(shouldWaitForWhatsNew("1.4.2-beta.4"), true);
  });

  test("chat open hook stays a window event name", () => {
    assert.equal(OPEN_BLOBBO_CHAT_EVENT, "jellyglance-open-blobbo-chat");
  });
});

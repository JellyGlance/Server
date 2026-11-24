import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeLibraryTab } from "../src/pages/libraries-tabs.js";

describe("normalizeLibraryTab", () => {
  it("reads storage and forecast from the query string", () => {
    assert.equal(normalizeLibraryTab("?tab=storage"), "storage");
    assert.equal(normalizeLibraryTab("?tab=forecast"), "forecast");
    assert.equal(normalizeLibraryTab("?tab=overview"), "overview");
  });

  it("falls back to overview when the tab is missing or unknown", () => {
    assert.equal(normalizeLibraryTab(""), "overview");
    assert.equal(normalizeLibraryTab("?"), "overview");
    assert.equal(normalizeLibraryTab("?tab="), "overview");
    assert.equal(normalizeLibraryTab("?tab=queue"), "overview");
    assert.equal(normalizeLibraryTab("?tab=STORAGE"), "storage");
    assert.equal(normalizeLibraryTab("?other=1"), "overview");
  });
});

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const seerr = require("../classes/newsletter-seerr-requests");

describe("newsletter fulfilled request filter", () => {
  it("keeps Available titles whose media date is after lastSentAt", () => {
    const items = seerr.listFulfilledFrom([
      { Name: "New", status: "Available", mediaAddedAt: "2026-11-10T12:00:00Z", requestId: 1 },
      { Name: "Old", status: "Available", mediaAddedAt: "2026-10-01T12:00:00Z", requestId: 2 },
      { Name: "Pending", status: "Pending", mediaAddedAt: "2026-11-10T12:00:00Z", requestId: 3 },
    ], { lastSentAt: "2026-11-05T00:00:00Z", now: new Date("2026-11-12T00:00:00Z"), limit: 8 });
    assert.deepEqual(items.map((item) => item.Name), ["New"]);
  });

  it("falls back to the last N days when the campaign has never been sent", () => {
    const items = seerr.listFulfilledFrom([
      { Name: "Recent", status: "Available", mediaAddedAt: "2026-11-10T12:00:00Z", requestId: 1 },
      { Name: "Older", status: "Available", mediaAddedAt: "2026-10-01T12:00:00Z", requestId: 2 },
    ], { lastSentAt: null, days: 7, now: new Date("2026-11-12T00:00:00Z") });
    assert.deepEqual(items.map((item) => item.Name), ["Recent"]);
  });
});

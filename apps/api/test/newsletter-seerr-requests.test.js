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

describe("newsletter open request count", () => {
  it("counts pending and approved requests and ignores closed ones", () => {
    assert.equal(seerr.countOpenRequests([
      { Name: "One", status: "Pending" },
      { Name: "Two", status: "Approved" },
      { Name: "Three", status: "Available" },
      { Name: "Four", status: "Declined" },
      { Name: "Five", status: "Failed" },
    ]), 2);
  });

  it("counts open requests from a GET-only Seerr read", async () => {
    let method;
    let path;
    const count = await seerr.countOpenSeerrRequests({
      take: 20,
      fetchJson: async (url) => {
        method = "GET";
        path = String(url);
        return {
          results: [
            { id: 1, status: 1, media: { status: 3 } },
            { id: 2, status: 2, media: { status: 3 } },
            { id: 3, status: 5, media: { status: 5 } },
          ],
        };
      },
    });
    assert.equal(method, "GET");
    assert.match(path, /\/api\/v1\/request/);
    assert.equal(count, 2);
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { matchesRequestFilter, normalizeRequestTab, requestStatusChip, REQUEST_FILTERS } from "../src/pages/requests/status.js";
import { isPosterRatio, posterChain } from "../src/pages/requests/poster.js";
import { countColumns, visibleTiles } from "../src/pages/requests/discover-grid.js";

describe("requestStatusChip", () => {
  it("maps each state to its chip", () => {
    assert.equal(requestStatusChip({ status: "Pending" }).key, "pending");
    assert.equal(requestStatusChip({ status: "Approved" }).key, "approved");
    assert.equal(requestStatusChip({ status: "Approved", pipelineStatus: "grabbed" }).key, "processing");
    assert.equal(requestStatusChip({ status: "Processing" }).key, "processing");
    assert.equal(requestStatusChip({ status: "Partially Available" }).key, "partial");
    assert.equal(requestStatusChip({ status: "Available" }).key, "available");
    assert.equal(requestStatusChip({ status: "Declined" }).key, "declined");
    assert.equal(requestStatusChip({ status: "Failed" }).key, "failed");
    assert.equal(requestStatusChip({ status: "Error" }).key, "failed");
  });

  it("falls back to pending and gives every chip a label", () => {
    assert.equal(requestStatusChip({}).key, "pending");
    for (const key of ["pending", "approved", "processing", "partial", "available", "declined", "failed"]) {
      assert.ok(requestStatusChip({ status: key }).label);
    }
  });
});

describe("matchesRequestFilter", () => {
  const rows = [
    { status: "Pending" },
    { status: "Approved" },
    { status: "Approved", pipelineStatus: "grabbed" },
    { status: "Partially Available" },
    { status: "Available" },
    { status: "Declined" },
    { status: "Failed" },
  ];
  const count = (filter) => rows.filter((row) => matchesRequestFilter(row, filter)).length;

  it("has one filter row with All first", () => {
    assert.deepEqual(REQUEST_FILTERS.map((filter) => filter.id), ["all", "pending", "approved", "processing", "available", "declined", "failed"]);
  });

  it("counts each filter", () => {
    assert.equal(count("all"), 7);
    assert.equal(count("pending"), 1);
    assert.equal(count("approved"), 1);
    assert.equal(count("processing"), 2); // grabbed plus partial
    assert.equal(count("progress"), 3); // approved + processing + partial
    assert.equal(count("available"), 1);
    assert.equal(count("declined"), 1);
    assert.equal(count("failed"), 1);
  });
});

describe("Discover grid", () => {
  it("counts columns the way the CSS grid does", () => {
    assert.equal(countColumns(1051, 148, 12), 6);
    assert.equal(countColumns(351, 148, 10), 2);
    assert.equal(countColumns(351, 132, 8), 2);
    assert.equal(countColumns(0, 148, 12), 2);
    assert.equal(countColumns(100, 148, 12), 1);
  });

  const items = (n) => Array.from({ length: n }, (_, i) => ({ id: i }));

  it("shows two rows with More as the last cell", () => {
    const { shown, more } = visibleTiles(items(20), 6, 2, false);
    assert.equal(shown.length, 11);
    assert.equal(more, true);
  });

  it("never leaves a short last row once everything is shown", () => {
    assert.equal(visibleTiles(items(20), 6, 4, false).shown.length, 18);
    assert.equal(visibleTiles(items(13), 6, 4, false).shown.length, 12);
    assert.equal(visibleTiles(items(12), 6, 2, false).shown.length, 12);
    assert.equal(visibleTiles(items(4), 6, 2, false).shown.length, 4);
  });

  it("keeps More while the server has another page", () => {
    const { shown, more } = visibleTiles(items(8), 6, 2, true);
    assert.equal(more, true);
    assert.equal(shown.length, 8);
  });
});

describe("normalizeRequestTab", () => {
  it("maps the new and older tab keys", () => {
    assert.equal(normalizeRequestTab("?tab=queue"), "queue");
    assert.equal(normalizeRequestTab("?tab=discover"), "discover");
    assert.equal(normalizeRequestTab("?tab=issues"), "issues");
    assert.equal(normalizeRequestTab("?tab=calendar"), "calendar");
    assert.equal(normalizeRequestTab("?tab=upcoming"), "calendar");
    assert.equal(normalizeRequestTab("?tab=stats"), "stats");
    assert.equal(normalizeRequestTab("?tab=insights"), "stats");
    assert.equal(normalizeRequestTab("?tab=ask"), "ask");
    assert.equal(normalizeRequestTab("?tab=blobbo"), "ask");
    assert.equal(normalizeRequestTab("?tab=Requests"), "queue");
    assert.equal(normalizeRequestTab("?tab=browse"), "discover");
    assert.equal(normalizeRequestTab("?tab=issue"), "issues");
  });

  it("reads section, view and hash too, and falls back to the queue", () => {
    assert.equal(normalizeRequestTab("?section=issues"), "issues");
    assert.equal(normalizeRequestTab("?view=discover"), "discover");
    assert.equal(normalizeRequestTab("", "#issues"), "issues");
    assert.equal(normalizeRequestTab("?tab=nonsense"), "queue");
    assert.equal(normalizeRequestTab(""), "queue");
  });
});

describe("poster art", () => {
  const item = { posterUrls: ["https://image.tmdb.org/t/p/w342/a.jpg", "https://image.tmdb.org/t/p/w500/a.jpg"], availability: { jellyfinItemId: "abc123" } };

  it("puts the TMDB poster first and the library Primary image last", () => {
    const chain = posterChain(item, "/base");
    assert.equal(chain[0], "https://image.tmdb.org/t/p/w342/a.jpg");
    assert.match(chain[chain.length - 1], /^\/base\/proxy\/Items\/Images\/Primary\?id=abc123/);
    assert.ok(chain.every((url) => !/Logo|Thumb|Backdrop/i.test(url)));
  });

  it("has no library entry without a matched item", () => {
    assert.equal(posterChain({ posterUrl: "https://x/p.jpg" }).length, 1);
    assert.deepEqual(posterChain({}), []);
  });

  it("accepts portrait posters and rejects logos, thumbs and backdrops", () => {
    assert.equal(isPosterRatio(342, 513), true);
    assert.equal(isPosterRatio(300, 442), true);
    assert.equal(isPosterRatio(500, 281), false);
    assert.equal(isPosterRatio(600, 200), false);
    assert.equal(isPosterRatio(0, 0), false);
  });
});

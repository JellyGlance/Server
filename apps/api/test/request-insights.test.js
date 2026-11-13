const test = require("node:test");
const assert = require("node:assert/strict");
const { buildRequestInsights, fulfilMs, resolveWindow } = require("../classes/request-insights");

const NOW = Date.parse("2026-11-12T12:00:00Z");
const H = 3600000;
const iso = (offsetHours) => new Date(NOW - offsetHours * H).toISOString();
const req = (over = {}) => ({ status: "Available", mediaType: "movie", genres: ["Drama"], requestedBy: "Ann", createdAt: iso(10), mediaAddedAt: iso(8), ...over });

test("average and median time to fulfil use Available requests only", () => {
  const out = buildRequestInsights(
    [req(), req({ createdAt: iso(10), mediaAddedAt: iso(4) }), req({ status: "Approved", mediaAddedAt: iso(1) }), req({ createdAt: iso(5), mediaAddedAt: iso(9) })],
    { days: 0, now: NOW }
  );
  assert.equal(out.fulfil.samples, 2);
  assert.equal(out.fulfil.averageMs, 4 * H);
  assert.equal(out.fulfil.medianMs, 4 * H);
});

test("falls back to the media update time and ignores impossible gaps", () => {
  assert.equal(fulfilMs(req({ mediaAddedAt: null, mediaUpdatedAt: iso(9) })), H);
  assert.equal(fulfilMs(req({ mediaAddedAt: iso(11) })), null);
  assert.equal(fulfilMs(req({ mediaAddedAt: "nope", mediaUpdatedAt: undefined })), null);
  assert.equal(fulfilMs(req({ status: "Failed" })), null);
});

test("success rate is available over available plus failed", () => {
  const out = buildRequestInsights([req(), req(), req(), req({ status: "Failed" }), req({ status: "Declined" }), req({ status: "Approved" }), req({ status: "Pending" })], { days: 0, now: NOW });
  assert.equal(out.success.rate, 75);
  assert.deepEqual(out.counts, { available: 3, failed: 1, declined: 1, waiting: 1, pending: 1 });
  assert.equal(buildRequestInsights([req({ status: "Pending" })], { days: 0, now: NOW }).success.rate, null);
});

test("most-requested genres count each request once per genre", () => {
  const out = buildRequestInsights(
    [req({ genres: ["Drama", "Drama", "Crime"] }), req({ genres: ["Drama"] }), req({ genres: ["Comedy"] }), req({ genres: [] })],
    { days: 0, now: NOW }
  );
  assert.deepEqual(out.topGenres.map((g) => [g.name, g.count]), [["Drama", 2], ["Comedy", 1], ["Crime", 1]]);
  assert.equal(out.topGenres[0].share, 50);
});

test("busiest requester, with ties broken by name", () => {
  const out = buildRequestInsights([req({ requestedBy: "Zed" }), req({ requestedBy: "Ann" }), req({ requestedBy: "Zed" }), req({ requestedBy: "Ann" }), req({ requestedBy: "Bob" })], { days: 0, now: NOW });
  assert.equal(out.busiest.name, "Ann");
  assert.equal(out.busiest.count, 2);
  assert.deepEqual(out.requesters.map((r) => r.name), ["Ann", "Zed", "Bob"]);
});

test("the window drops older requests; bad windows fall back to 30 days", () => {
  const list = [req({ createdAt: iso(24), mediaAddedAt: iso(20) }), req({ createdAt: iso(24 * 20), mediaAddedAt: iso(24 * 19) }), req({ createdAt: iso(24 * 60), mediaAddedAt: iso(24 * 59) })];
  assert.equal(buildRequestInsights(list, { days: 7, now: NOW }).total, 1);
  assert.equal(buildRequestInsights(list, { days: 30, now: NOW }).total, 2);
  assert.equal(buildRequestInsights(list, { days: 0, now: NOW }).total, 3);
  assert.equal(buildRequestInsights(list, { days: 13, now: NOW }).windowDays, 30);
  assert.equal(resolveWindow(undefined), 30);
});

test("an empty list gives empty, not NaN, results", () => {
  const out = buildRequestInsights([], { days: 0, now: NOW });
  assert.equal(out.total, 0);
  assert.equal(out.fulfil.averageMs, null);
  assert.equal(out.success.rate, null);
  assert.equal(out.busiest, null);
  assert.deepEqual(out.topGenres, []);
  assert.equal(buildRequestInsights(undefined, { now: NOW }).total, 0);
});

test("splits movies and TV", () => {
  const out = buildRequestInsights([req(), req({ mediaType: "tv" }), req({ mediaType: "tvshow" })], { days: 0, now: NOW });
  assert.deepEqual(out.types, { movie: 1, tv: 2 });
});

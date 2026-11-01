const test = require("node:test");
const assert = require("node:assert/strict");

const originalLog = console.log;
console.log = () => {}; // db.js logs a warning when Postgres env vars are absent
const delivery = require("../classes/wrapped-delivery");
console.log = originalLog;

test("last finished week starts on the previous Monday", () => {
  // Sunday 1 Nov 2026 -> the week of Mon 19 Oct is the last full one
  assert.equal(delivery.lastFinishedPeriodStart("week", new Date(2026, 10, 1, 9)), "2026-10-19");
  // Monday 2 Nov 2026 -> the week of Mon 26 Oct has just finished
  assert.equal(delivery.lastFinishedPeriodStart("week", new Date(2026, 10, 2, 0, 30)), "2026-10-26");
});

test("last finished month crosses the year boundary", () => {
  assert.equal(delivery.lastFinishedPeriodStart("month", new Date(2026, 10, 1)), "2026-10-01");
  assert.equal(delivery.lastFinishedPeriodStart("month", new Date(2027, 0, 15)), "2026-12-01");
});

const sample = {
  period: "week",
  start: "2026-10-19",
  end: "2026-10-25",
  userId: "u1",
  userName: "Sam <b>",
  totals: { plays: 6, seconds: 5 * 3600, titles: 4 },
  busiestDay: { day: "2026-10-24", seconds: 3 * 3600 },
  topShows: [{ name: "Tom & Jerry", seconds: 7200 }],
  topMovies: [],
};

test("recap summary names hours, busiest day and top shows and escapes HTML", () => {
  const summary = delivery.formatRecap(sample);
  assert.equal(summary.title, "Sam <b>'s Wrapped: week of Monday 19 October");
  assert.match(summary.message, /5\.0 hours watched across 6 plays and 4 titles/);
  assert.match(summary.message, /Busiest day: Saturday 24 October \(3\.0 h\)/);
  assert.match(summary.message, /1\. Tom & Jerry \(2\.0 h\)/);
  assert.ok(summary.html.includes("Sam &lt;b&gt;"));
  assert.ok(summary.html.includes("Tom &amp; Jerry"));
  assert.ok(!summary.html.includes("<b>'s"));
});

test("empty periods say so", () => {
  const summary = delivery.formatRecap({ ...sample, period: "month", start: "2026-10-01", end: "2026-10-31", totals: { plays: 0 }, busiestDay: null, topShows: [] });
  assert.equal(summary.title, "Sam <b>'s Wrapped: October 2026");
  assert.equal(summary.message, "Nothing was watched in this period.");
});

test("subscriptions need a user and a destination", () => {
  const base = delivery.normalizeSubscription({ userId: "u1", period: "month" });
  assert.equal(base.period, "month");
  assert.equal(delivery.validateSubscription(base), "Add an email address or pick a webhook");
  assert.equal(delivery.validateSubscription({ ...base, email: "nope" }), "Enter a valid email address");
  assert.equal(delivery.validateSubscription({ ...base, email: "sam@example.com" }), "");
  assert.equal(delivery.validateSubscription(delivery.normalizeSubscription({ userId: "u1", webhookId: "3" })), "");
  assert.equal(delivery.normalizeSubscription({ userId: "u1", period: "year" }).period, "week");
});

test("editing keeps id and send history", () => {
  const first = delivery.normalizeSubscription({ userId: "u1", email: "a@example.com" });
  const edited = delivery.normalizeSubscription({ period: "month" }, { ...first, lastSentPeriod: "2026-10-19" });
  assert.equal(edited.id, first.id);
  assert.equal(edited.email, "a@example.com");
  assert.equal(edited.lastSentPeriod, "2026-10-19");
});

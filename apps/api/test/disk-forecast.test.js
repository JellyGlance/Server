const test = require("node:test");
const assert = require("node:assert/strict");
const { growthFromAdditions, forecastFill, summariseDisks, roundDays, buildForecast } = require("../classes/disk-forecast");

const GB = 1024 ** 3;
const now = new Date("2026-11-01T12:00:00Z");
const daysAgo = (n) => new Date(now.getTime() - n * 86400000).toISOString();
const steady = (perDay, days = 90) => Array.from({ length: days }, (_, i) => ({ day: daysAgo(i + 0.5), bytes: perDay, items: 1 }));

test("growth averages bytes per day over each window", () => {
  const g = growthFromAdditions(steady(10 * GB), { now, historyDays: 90 });
  assert.equal(g.windows[0].days, 30);
  assert.equal(Math.round(g.windows[0].bytesPerDay / GB), 10);
  assert.equal(Math.round(g.windows[1].bytesPerDay / GB), 10);
});

test("growth does not divide by more days than the library has existed", () => {
  const g = growthFromAdditions(steady(5 * GB, 20), { now, historyDays: 20 });
  assert.equal(Math.round(g.windows[0].bytesPerDay / GB), 5);
});

test("days until full uses free space over recent growth", () => {
  const growth = growthFromAdditions(steady(10 * GB), { now, historyDays: 90 });
  const f = forecastFill({ freeBytes: 1000 * GB, totalBytes: 8000 * GB, growth });
  assert.equal(f.status, "filling");
  assert.equal(f.daysUntilFull, 100);
  assert.equal(f.confidence, "medium");
});

test("too little history asks for more data instead of guessing", () => {
  const growth = growthFromAdditions(steady(10 * GB, 5), { now, historyDays: 5 });
  assert.equal(forecastFill({ freeBytes: 100 * GB, totalBytes: 500 * GB, growth }).status, "need_more_data");
});

test("tiny or no growth reads as stable", () => {
  const quiet = growthFromAdditions(steady(10 * 1024 ** 2), { now, historyDays: 90 });
  assert.equal(forecastFill({ freeBytes: 100 * GB, totalBytes: 500 * GB, growth: quiet }).status, "stable");
  const none = growthFromAdditions([], { now, historyDays: 90 });
  assert.equal(forecastFill({ freeBytes: 100 * GB, totalBytes: 500 * GB, growth: none }).status, "stable");
});

test("no disk report still gives a growth rate", () => {
  const growth = growthFromAdditions(steady(10 * GB), { now, historyDays: 90 });
  const f = forecastFill({ freeBytes: 0, totalBytes: 0, growth });
  assert.equal(f.status, "no_disk");
  assert.ok(f.bytesPerDay > 9 * GB);
});

test("range covers the faster and slower windows", () => {
  const rows = [...steady(2 * GB, 90), ...steady(8 * GB, 30)];
  const growth = growthFromAdditions(rows, { now, historyDays: 90 });
  const f = forecastFill({ freeBytes: 1000 * GB, totalBytes: 4000 * GB, growth });
  assert.ok(f.rangeDays[0] <= f.daysUntilFull);
  assert.ok(f.rangeDays[1] >= f.daysUntilFull);
});

test("rounding never claims more precision than the data has", () => {
  assert.equal(roundDays(3.4), 3);
  assert.equal(roundDays(47), 45);
  assert.equal(roundDays(183), 180);
  assert.equal(roundDays(400), 390);
});

test("disks reported by several apps are only counted once", () => {
  const s = summariseDisks([
    { path: "/tv", totalSpace: 4000 * GB, freeSpace: 500 * GB },
    { path: "/movies", totalSpace: 4000 * GB, freeSpace: 500 * GB },
    { path: "/music", totalSpace: 1000 * GB, freeSpace: 100 * GB },
  ]);
  assert.equal(s.disks.length, 2);
  assert.equal(s.freeBytes, 600 * GB);
  assert.equal(s.usedBytes, 4400 * GB);
});

test("buildForecast breaks growth down per library", () => {
  const additions = [
    ...steady(6 * GB, 60).map((r) => ({ ...r, libraryId: "tv", libraryName: "TV" })),
    ...steady(2 * GB, 60).map((r) => ({ ...r, libraryId: "mv", libraryName: "Movies" })),
  ];
  const out = buildForecast({ additions, oldest: daysAgo(400), disks: [{ path: "/data", totalSpace: 10000 * GB, freeSpace: 800 * GB }], now });
  assert.equal(out.perLibrary[0].name, "TV");
  assert.equal(out.forecast.status, "filling");
  assert.equal(out.forecast.daysUntilFull, 100);
});

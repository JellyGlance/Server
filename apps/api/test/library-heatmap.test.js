const test = require("node:test");
const assert = require("node:assert/strict");
const h = require("../classes/library-heatmap");

test("monday-first day index from Sunday-first numbers", () => {
  assert.equal(h.mondayIndex(0), 6);
  assert.equal(h.mondayIndex(1), 0);
  assert.equal(h.mondayIndex(6), 5);
});

test("timestamps bucket in the server time zone", () => {
  // Sunday 1 Nov 2026 23:30 UTC is Monday 00:30 in Berlin (UTC+1)
  assert.deepEqual(h.bucketOf("2026-11-01T23:30:00Z", "UTC"), { day: 6, hour: 23 });
  assert.deepEqual(h.bucketOf("2026-11-01T23:30:00Z", "Europe/Berlin"), { day: 0, hour: 0 });
  assert.deepEqual(h.bucketOf("2026-11-02T05:00:00Z", "America/New_York"), { day: 0, hour: 0 });
});

test("bad time zones and dates are handled", () => {
  assert.equal(h.validTimeZone("Not/AZone"), "UTC");
  assert.equal(h.bucketOf("nope"), null);
});

test("bucketActivity counts plays and watch seconds", () => {
  const grid = h.bucketActivity(
    [
      { ActivityDateInserted: "2026-10-30T20:10:00Z", PlaybackDuration: 1800 },
      { ActivityDateInserted: "2026-10-30T20:50:00Z", PlaybackDuration: 600 },
      { ActivityDateInserted: "2026-10-31T09:00:00Z", PlaybackDuration: -5 },
    ],
    "UTC"
  );
  assert.deepEqual(grid[4][20], { plays: 2, seconds: 2400 });
  assert.deepEqual(grid[5][9], { plays: 1, seconds: 0 });
});

test("aggregate rows map Postgres DOW onto the grid and ignore junk", () => {
  const grid = h.gridFromAggregates([
    { Dow: 0, Hour: 21, Plays: 3, Seconds: "5400" },
    { Dow: 3, Hour: 99, Plays: 9, Seconds: 1 },
  ]);
  assert.deepEqual(grid[6][21], { plays: 3, seconds: 5400 });
  assert.equal(grid.flat().reduce((t, c) => t + c.plays, 0), 3);
});

test("intensity is quartiles of the busiest cell", () => {
  assert.equal(h.intensity(0, 10), 0);
  assert.equal(h.intensity(1, 10), 1);
  assert.equal(h.intensity(5, 10), 2);
  assert.equal(h.intensity(10, 10), 4);
  assert.equal(h.intensity(3, 0), 0);
});

test("summarise finds the peak, busiest day and hour per metric", () => {
  const grid = h.gridFromAggregates([
    { Dow: 5, Hour: 20, Plays: 2, Seconds: 9000 },
    { Dow: 6, Hour: 20, Plays: 5, Seconds: 3000 },
  ]);
  const byTime = h.summarise(grid, "seconds");
  assert.equal(byTime.peak.dayName, "Fri");
  assert.equal(byTime.busiestHour, 20);
  assert.equal(byTime.cells[4][20].level, 4);
  const byPlays = h.summarise(grid, "plays");
  assert.equal(byPlays.peak.dayName, "Sat");
  assert.equal(byPlays.total, 7);
});

test("empty data gives an empty summary", () => {
  const s = h.summarise(h.gridFromAggregates([]));
  assert.equal(s.total, 0);
  assert.equal(s.peak, null);
  assert.equal(s.busiestDay, null);
});

test("window days are clamped", () => {
  assert.equal(h.clampDays("abc"), 30);
  assert.equal(h.clampDays(0), 30);
  assert.equal(h.clampDays(99999), 3650);
});

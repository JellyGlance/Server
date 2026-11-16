import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { barShare, durationLabel, headlineTiles, percentLabel } from "../src/pages/requests/stats.js";

describe("stats formatting", () => {
  it("formats durations", () => {
    assert.equal(durationLabel(20000), "under a minute");
    assert.equal(durationLabel(12 * 60000), "12 min");
    assert.equal(durationLabel(3 * 3600000 + 5 * 60000), "3h 05m");
    assert.equal(durationLabel(50 * 3600000), "2d 2h");
    assert.equal(durationLabel(null), "\u2014");
    assert.equal(durationLabel(-5), "\u2014");
  });

  it("formats percentages", () => {
    assert.equal(percentLabel(75), "75%");
    assert.equal(percentLabel(93.4), "93.4%");
    assert.equal(percentLabel(null), "\u2014");
  });

  it("sizes bars against the biggest row", () => {
    assert.equal(barShare(10, 10), 100);
    assert.equal(barShare(5, 10), 50);
    assert.equal(barShare(1, 1000), 4);
    assert.equal(barShare(0, 10), 0);
    assert.equal(barShare(3, 0), 0);
  });
});

describe("headlineTiles", () => {
  it("builds four tiles from the stats", () => {
    const tiles = headlineTiles({
      total: 95,
      types: { movie: 60, tv: 35 },
      fulfil: { averageMs: 3600000, medianMs: 1800000, samples: 61 },
      success: { rate: 92.4, available: 61, failed: 5 },
      busiest: { name: "Roffo", count: 56, share: 58.9 },
    });
    assert.deepEqual(tiles.map((t) => t.key), ["fulfil", "success", "busiest", "total"]);
    assert.equal(tiles[0].value, "1h 00m");
    assert.equal(tiles[0].hint, "Median 30 min");
    assert.equal(tiles[0].title, "Median 30 min, from 61 fulfilled requests");
    assert.equal(tiles[1].value, "92.4%");
    assert.equal(tiles[2].hint, "56 requests \u00b7 58.9%");
    assert.equal(tiles[3].hint, "60 movies \u00b7 35 TV");
  });

  it("copes with no data", () => {
    const tiles = headlineTiles({ total: 0, types: {}, fulfil: {}, success: {}, busiest: null });
    assert.equal(tiles[0].hint, "Nothing fulfilled yet");
    assert.equal(tiles[1].value, "\u2014");
    assert.equal(tiles[2].value, "\u2014");
    assert.deepEqual(headlineTiles(null), []);
  });
});

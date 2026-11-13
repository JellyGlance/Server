import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BAR_WIDTH, fillWidth, hasActiveProgress, progressPercent, progressView } from "../src/pages/requests/progress.js";

describe("progressView", () => {
  it("shows percent and ETA while downloading", () => {
    const view = progressView({ state: "downloading", progress: 63, etaLabel: "12 min", source: "Radarr", client: "qBittorrent", speed: "2.3 MB/s" });
    assert.equal(view.label, "63% \u00b7 12 min");
    assert.equal(view.tone, "downloading");
    assert.match(view.title, /Radarr via qBittorrent/);
    assert.match(view.title, /12 min left/);
    assert.match(view.title, /2\.3 MB\/s/);
  });

  it("names the other states plainly", () => {
    assert.equal(progressView({ state: "queued", progress: 0 }).label, "Queued");
    assert.equal(progressView({ state: "queued", progress: 0 }).indeterminate, true);
    assert.equal(progressView({ state: "stalled", progress: 41 }).label, "Stalled \u00b7 41%");
    assert.equal(progressView({ state: "paused", progress: 10 }).label, "Paused \u00b7 10%");
    assert.equal(progressView({ state: "importing", progress: 100 }).label, "Importing");
    assert.equal(progressView({ state: "failed", progress: 5 }).tone, "failed");
  });

  it("labels simulated data and multi-episode entries in the tooltip", () => {
    const view = progressView({ state: "downloading", progress: 50, etaLabel: "5 min", simulated: true, count: 3, episodes: ["S01E01", "S01E02", "S01E03"], source: "Sonarr" });
    assert.match(view.title, /Demo data/);
    assert.match(view.title, /3 items \(S01E01, S01E02, S01E03\)/);
  });

  it("clamps the percentage and keeps the fill in whole pixels", () => {
    assert.equal(progressPercent({ progress: 140 }), 100);
    assert.equal(progressPercent({ progress: -5 }), 0);
    assert.equal(progressPercent({ progress: "x" }), 0);
    for (let pct = 0; pct <= 100; pct += 1) assert.ok(Number.isInteger(fillWidth({ progress: pct })));
    assert.equal(fillWidth({ progress: 100 }), BAR_WIDTH);
    assert.equal(fillWidth({ progress: 50 }, 160), 80);
  });

  it("knows when anything is downloading", () => {
    assert.equal(hasActiveProgress({}), false);
    assert.equal(hasActiveProgress({ a: {} }), true);
    assert.equal(hasActiveProgress(undefined), false);
  });
});

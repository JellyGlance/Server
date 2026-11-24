const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const extra = require("../classes/newsletter-extra-blocks");

describe("newsletter extra block helpers", () => {
  it("counts down to a date without touching any integrations", () => {
    const now = new Date("2026-11-12T12:00:00Z");
    assert.equal(extra.countdownFrom("2026-11-12", now).days, 0);
    assert.equal(extra.countdownFrom("2026-11-13", now).days, 1);
    assert.equal(extra.countdownFrom("2026-11-16", now).days, 4);
    assert.equal(extra.countdownFrom("", now).hasDate, false);
  });

  it("labels 4K and HDR streams from media metadata", () => {
    assert.deepEqual(extra.qualityLabels({ Height: 2160, VideoRange: "SDR", DisplayTitle: "4K" }), ["4K"]);
    assert.deepEqual(extra.qualityLabels({ Height: 1080, VideoRange: "HDR10" }), ["HDR"]);
    assert.deepEqual(extra.qualityLabels({ Height: 2160, VideoRangeType: "DolbyVision" }), ["4K", "Dolby Vision"]);
  });
});

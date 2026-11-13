const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const archive = require("../classes/newsletter-archive");

describe("newsletter archive", () => {
  it("is disabled by default", () => {
    assert.equal(archive.defaultArchive().enabled, false);
    assert.equal(archive.normalizeArchive({}, { enabled: false }).enabled, false);
    assert.equal(archive.normalizeArchive({}, { enabled: true }).enabled, true);
    assert.equal(archive.normalizeArchive({ enabled: true }).enabled, true);
  });

  it("builds a public archive payload and a preview-only virtual entry", () => {
    const preview = archive.virtualEntry({
      subject: "Global digest - 12 Nov 2026",
      html: "<p>Preview</p>",
      text: "Preview body",
      audienceLabel: "Global digest",
    });
    assert.equal(preview.id, "preview");
    assert.equal(preview.preview, true);
    const payload = archive.buildArchivePayload({
      enabled: false,
      preview,
      entries: [],
      locale: "en-GB",
    });
    assert.equal(payload.enabled, false);
    assert.equal(payload.entries[0].subject, "Global digest - 12 Nov 2026");
    assert.ok(!Object.prototype.hasOwnProperty.call(payload.entries[0], "html"));
    assert.match(payload.entries[0].excerpt, /Preview body/);
  });
});

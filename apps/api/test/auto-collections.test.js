const test = require("node:test");
const assert = require("node:assert/strict");
const sharp = require("sharp");
const collections = require("../classes/auto-collections");

const library = [
  { id: "m1", name: "Dune", year: 2021, tmdbId: "438631", added: "2026-10-01T00:00:00Z" },
  { id: "m2", name: "Dune Part Two", year: 2024, tmdbId: "693134", added: "2026-11-01T00:00:00Z" },
  { id: "m3", name: "Local Only", year: 1999, added: "2020-01-01T00:00:00Z" },
];

test("new builders stay preview-only with apply disabled", () => {
  const builder = collections.normalizeBuilderInput({ name: "Trending movies", type: "trending", applyEnabled: true, previewOnly: false }, { isCreate: true });
  assert.equal(builder.preview_only, true);
  assert.equal(builder.apply_enabled, false);
});

test("recently added uses local library dates and does not need TMDB", () => {
  const preview = collections.buildCollectionPreview({ type: "recently_added", options: { limit: 2 }, libraryItems: library });
  assert.deepEqual(preview.items.map((item) => item.id), ["m2", "m1"]);
  assert.equal(preview.unmatched.length, 0);
});

test("trending matches library items by TMDB id or title and year", () => {
  const preview = collections.buildCollectionPreview({
    type: "trending",
    tmdbResults: [
      { id: "438631", title: "Dune", release_date: "2021-10-01" },
      { id: "99", title: "Missing Film", release_date: "2024-01-01" },
    ],
    libraryItems: library,
  });
  assert.equal(preview.items.length, 1);
  assert.equal(preview.items[0].id, "m1");
  assert.equal(preview.unmatched.length, 1);
  assert.equal(preview.unmatched[0].title, "Missing Film");
});

test("franchise groups matched movies by collection name", () => {
  const preview = collections.buildCollectionPreview({
    type: "franchise",
    tmdbResults: [
      { id: "438631", title: "Dune", year: 2021, franchise: "Dune Collection" },
      { id: "693134", title: "Dune Part Two", year: 2024, franchise: "Dune Collection" },
    ],
    libraryItems: library,
  });
  assert.equal(preview.groups.length, 1);
  assert.equal(preview.groups[0].name, "Dune Collection");
  assert.equal(preview.groups[0].items.length, 2);
});

test("overlay badges detect resolution, HDR, Atmos and a rating", () => {
  const badges = collections.detectOverlayBadges({
    video: { height: 2160, range: "DolbyVision", codec: "hevc" },
    audio: { codec: "truehd", profile: "Atmos", channels: 8 },
  }, 8.4);
  assert.deepEqual(badges.filter((badge) => typeof badge === "string"), ["4K", "Dolby Vision", "Atmos"]);
  assert.deepEqual(badges.find((badge) => badge.kind === "rating"), { kind: "rating", text: "8.4" });
});

test("renders a preview poster overlay without writing to Jellyfin", async () => {
  const poster = await sharp({ create: { width: 400, height: 600, channels: 3, background: { r: 40, g: 12, b: 12 } } }).jpeg().toBuffer();
  const rendered = await collections.renderPosterOverlay(poster, ["4K", "HDR", { kind: "rating", text: "7.8" }]);
  assert.equal(rendered.contentType, "image/png");
  assert.match(rendered.dataUrl, /^data:image\/png;base64,/);
  const meta = await sharp(rendered.buffer).metadata();
  assert.equal(meta.width, 300);
  assert.equal(meta.height, 450);
});

test("apply is refused while the builder is preview-only, apply is off, or automation is disabled", () => {
  assert.throws(() => collections.assertApplyAllowed({ previewOnly: true, applyEnabled: true }), /preview only/);
  assert.throws(() => collections.assertApplyAllowed({ previewOnly: false, applyEnabled: false }), /Apply is disabled/);
  const previous = process.env.JG_DISABLE_SERVER_AUTOMATION;
  process.env.JG_DISABLE_SERVER_AUTOMATION = "1";
  assert.throws(() => collections.assertApplyAllowed({ previewOnly: false, applyEnabled: true }), /automation is disabled/);
  if (previous === undefined) delete process.env.JG_DISABLE_SERVER_AUTOMATION;
  else process.env.JG_DISABLE_SERVER_AUTOMATION = previous;
});

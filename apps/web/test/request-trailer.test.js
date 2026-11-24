import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { safeEmbedUrl, trailerTarget } from "../src/pages/requests/trailer.js";

describe("trailerTarget", () => {
  it("uses mediaId for Discover results", () => {
    assert.deepEqual(trailerTarget({ state: "none", sourceId: "s1", mediaType: "movie", mediaId: 603, title: "The Matrix" }), { sourceId: "s1", mediaType: "movie", tmdbId: 603, title: "The Matrix" });
  });

  it("uses the TMDB id for queued requests, not Seerr's media id", () => {
    const target = trailerTarget({ sourceId: "s1", mediaType: "tv", mediaId: 9, externalIds: { tmdbId: 1399 }, title: "GoT" });
    assert.equal(target.tmdbId, 1399);
  });

  it("returns null without a usable id or type", () => {
    assert.equal(trailerTarget(null), null);
    assert.equal(trailerTarget({ mediaType: "media", externalIds: { tmdbId: 5 } }), null);
    assert.equal(trailerTarget({ mediaType: "movie", externalIds: {} }), null);
    assert.equal(trailerTarget({ isSearchResult: true, mediaType: "movie", mediaId: "x" }), null);
  });
});

describe("safeEmbedUrl", () => {
  it("accepts only the nocookie embed host over https", () => {
    assert.ok(safeEmbedUrl("https://www.youtube-nocookie.com/embed/abc123DEF45?rel=0"));
    assert.equal(safeEmbedUrl("https://www.youtube.com/embed/abc123DEF45"), "");
    assert.equal(safeEmbedUrl("http://www.youtube-nocookie.com/embed/abc123DEF45"), "");
    assert.equal(safeEmbedUrl("https://www.youtube-nocookie.com/watch?v=abc"), "");
    assert.equal(safeEmbedUrl("javascript:alert(1)"), "");
    assert.equal(safeEmbedUrl(undefined), "");
  });
});

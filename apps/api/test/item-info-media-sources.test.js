const test = require("node:test");
const assert = require("node:assert/strict");
const { jf_item_info_rows, mediaSourcesOf } = require("../models/jf_item_info");

test("items without MediaSources produce no item info rows instead of throwing", () => {
  for (const item of [{ Id: "live-tv", Type: "TvChannel" }, { Id: "x", MediaSources: null }, { Id: "y", MediaSources: {} }, null, undefined]) {
    assert.deepEqual(jf_item_info_rows(item, "Item"), []);
    assert.deepEqual(mediaSourcesOf(item), []);
  }
});

test("items with MediaSources still map one row per source", () => {
  const rows = jf_item_info_rows(
    {
      Id: "movie-1",
      MediaSources: [
        { Id: "src-1", ItemId: "movie-1", Path: "/m/a.mkv", Name: "a", Size: 10, Bitrate: 5, MediaStreams: [{ Type: "Video" }] },
        { Id: "src-2", Path: "/m/b.mkv", Name: "b", Size: 20, Bitrate: 6, MediaStreams: [] },
      ],
    },
    "Episode"
  );
  assert.equal(rows.length, 2);
  assert.equal(rows[0].Id, "movie-1");
  assert.equal(rows[1].Id, "src-2");
  assert.ok(rows.every((r) => r.Type === "Episode"));
  assert.equal(rows[0].MediaStreams, JSON.stringify([{ Type: "Video" }]));
});

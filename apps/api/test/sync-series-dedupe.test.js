// A full sync writes each season and episode once, however many rows a series has.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const api = path.join(__dirname, "..");
const written = { jf_library_seasons: 0, jf_library_episodes: 0 };

const file = require.resolve(path.join(api, "db.js"));
require.cache[file] = {
  id: file,
  filename: file,
  loaded: true,
  exports: {
    query: async () => ({ rows: [] }),
    insertBulk: async (table, rows) => {
      written[table] += rows.length;
      return { Result: "SUCCESS", message: "" };
    },
  },
};

const { syncSeasons, syncEpisodes } = require("../routes/sync");

function series(id, count) {
  return Array.from({ length: count }, (_, i) => ({ Id: `${id}-${i}`, SeriesId: id, SeasonId: `${id}-s1` }));
}

test("episodes are upserted once each, not once per episode in the series", async () => {
  await syncEpisodes([...series("a", 50), ...series("b", 3)]);
  assert.equal(written.jf_library_episodes, 53);
});

test("seasons are upserted once each, not once per season in the series", async () => {
  await syncSeasons([...series("a", 10), ...series("b", 2)]);
  assert.equal(written.jf_library_seasons, 12);
});

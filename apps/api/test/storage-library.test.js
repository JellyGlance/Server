const test = require("node:test");
const assert = require("node:assert/strict");
const { hintsFor, findDuplicateKeys, summariseLibraries, rankLargest, buildStorageReport } = require("../classes/storage-library");

const GB = 1024 ** 3;
const now = new Date("2026-11-01T12:00:00Z");
const daysAgo = (n) => new Date(now.getTime() - n * 86400000).toISOString();
const codes = (hints) => hints.map((h) => h.code);

test("libraries are sorted by size with their share of the total", () => {
  const out = summariseLibraries([
    { id: "tv", name: "TV", bytes: 3 * GB, items: 10 },
    { id: "mv", name: "Movies", bytes: 9 * GB, items: 40 },
    { id: "empty", name: "Books", bytes: null, items: 0 },
  ]);
  assert.equal(out.totalBytes, 12 * GB);
  assert.deepEqual(out.libraries.map((l) => l.id), ["mv", "tv", "empty"]);
  assert.equal(out.libraries[0].share, 0.75);
  assert.equal(out.libraries[2].bytes, 0);
});

test("largest titles are capped at 20 and skip unknown sizes", () => {
  const items = Array.from({ length: 30 }, (_, i) => ({ id: `i${i}`, name: `T${i}`, type: "Movie", bytes: (i + 1) * GB, added: daysAgo(10) }));
  items.push({ id: "nosize", name: "No size", type: "Movie", bytes: null });
  const top = rankLargest(items, { now });
  assert.equal(top.length, 20);
  assert.equal(top[0].id, "i29");
  assert.equal(top[0].rank, 1);
  assert.ok(!top.some((t) => t.id === "nosize"));
});

test("never played only shows once the grace period has passed", () => {
  assert.deepEqual(codes(hintsFor({ type: "Movie", added: daysAgo(400), plays: 0 }, { now })), ["never_played"]);
  assert.deepEqual(codes(hintsFor({ type: "Movie", added: daysAgo(30), plays: 0 }, { now })), []);
});

test("not played in two years is flagged, recent plays are not", () => {
  const old = hintsFor({ type: "Series", added: daysAgo(1500), plays: 4, lastPlayed: daysAgo(800) }, { now });
  assert.deepEqual(codes(old), ["stale"]);
  assert.match(old[0].label, /2\+ years/);
  assert.deepEqual(codes(hintsFor({ type: "Series", added: daysAgo(1500), plays: 4, lastPlayed: daysAgo(100) }, { now })), []);
});

test("duplicates match movie name and year, never series", () => {
  const items = [
    { type: "Movie", name: "Dune", year: 2021 },
    { type: "Movie", name: "dune ", year: 2021 },
    { type: "Movie", name: "Dune", year: 1984 },
    { type: "Series", name: "Lost", year: 2004 },
    { type: "Series", name: "Lost", year: 2004 },
  ];
  const keys = findDuplicateKeys(items);
  assert.equal(keys.size, 1);
  assert.deepEqual(codes(hintsFor({ ...items[0], added: daysAgo(10) }, { now, duplicates: keys })), ["duplicate"]);
  assert.deepEqual(codes(hintsFor({ ...items[2], added: daysAgo(10) }, { now, duplicates: keys })), []);
});

test("report totals the hinted titles", () => {
  const out = buildStorageReport({
    now,
    libraryRows: [{ id: "mv", name: "Movies", bytes: 100 * GB, items: 3 }],
    itemRows: [
      { id: "a", name: "A", type: "Movie", bytes: 60 * GB, added: daysAgo(500), plays: 0 },
      { id: "b", name: "B", type: "Movie", bytes: 30 * GB, added: daysAgo(500), plays: 2, lastPlayed: daysAgo(5) },
    ],
  });
  assert.equal(out.largest.length, 2);
  assert.equal(out.hintedCount, 1);
  assert.equal(out.hintedBytes, 60 * GB);
  assert.equal(out.rules.staleDays, 730);
});

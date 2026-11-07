const test = require("node:test");
const assert = require("node:assert/strict");

const originalLog = console.log;
console.log = () => {}; // db.js logs a warning when Postgres env vars are absent
const taste = require("../classes/taste-map");
console.log = originalLog;

const rows = [
  { user_id: "u1", user_name: "Ana", title_id: "s1", title: "The Expanse", seconds: 7200, plays: 3, genres: '["Sci-Fi","Drama"]', year: 2015 },
  { user_id: "u1", user_name: "Ana", title_id: "m1", title: "Alien", seconds: 3600, plays: 1, genres: ["Sci-Fi", "Horror"], year: 1979 },
  { user_id: "u2", user_name: "Ben", title_id: "s1", title: "The Expanse", seconds: 3600, plays: 2, genres: '["Sci-Fi","Drama"]', year: 2015 },
  { user_id: "u2", user_name: "Ben", title_id: "m2", title: "Paddington", seconds: 3600, plays: 1, genres: ["Comedy"], year: 2014 },
  { user_id: "u3", user_name: "Cy", title_id: "m3", title: "Bluey", seconds: 1800, plays: 4, genres: null, year: null },
];

test("decade buckets and genre parsing", () => {
  assert.equal(taste.decadeOf(1979), "1970s");
  assert.equal(taste.decadeOf("2015"), "2010s");
  assert.equal(taste.decadeOf(null), null);
  assert.equal(taste.decadeOf(0), null);
  assert.deepEqual(taste.parseGenres('["A"," B "]'), ["A", "B"]);
  assert.deepEqual(taste.parseGenres("not json"), []);
});

test("clusters split a title across its genres and bucket decades", () => {
  const [ana] = taste.buildClusters(rows);
  assert.equal(ana.name, "Ana");
  assert.equal(ana.seconds, 10800);
  assert.equal(ana.genres[0].name, "Sci-Fi");
  assert.equal(ana.genres[0].seconds, 5400);
  assert.equal(ana.genres[0].share, 0.5);
  assert.deepEqual(ana.decades.map((d) => d.name), ["1970s", "2010s"]);
  assert.equal(ana.topTitles[0].name, "The Expanse");
});

test("household overlaps rank the closest pair first and list shared titles", () => {
  const out = taste.summarise(rows);
  assert.equal(out.users.length, 3);
  assert.ok(!("genreVector" in out.users[0]));
  const top = out.overlaps[0];
  assert.deepEqual([top.a.name, top.b.name].sort(), ["Ana", "Ben"]);
  assert.ok(top.similarity > 0.5 && top.similarity <= 1);
  assert.deepEqual(top.sharedTitles.map((t) => t.name), ["The Expanse"]);
  assert.ok(top.sharedGenres.includes("Sci-Fi"));
  const withCy = out.overlaps.find((p) => p.a.name === "Cy" || p.b.name === "Cy");
  assert.equal(withCy.similarity, 0);
  assert.equal(out.sharedGenres[0].users.length, 2);
});

test("self-only view leaves the household out", () => {
  const out = taste.summarise(rows.filter((r) => r.user_id === "u1"), { household: false });
  assert.equal(out.users.length, 1);
  assert.deepEqual(out.overlaps, []);
  assert.deepEqual(out.sharedGenres, []);
});

test("genre similarity is symmetric and bounded", () => {
  assert.equal(taste.genreSimilarity({ a: 1 }, { a: 1 }), 1);
  assert.equal(taste.genreSimilarity({ a: 1 }, { b: 1 }), 0);
  assert.equal(taste.genreSimilarity({}, { b: 1 }), 0);
  const x = { a: 0.7, b: 0.3 };
  const y = { a: 0.2, c: 0.8 };
  assert.equal(taste.genreSimilarity(x, y), taste.genreSimilarity(y, x));
});

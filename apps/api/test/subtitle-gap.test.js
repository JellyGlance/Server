const test = require("node:test");
const assert = require("node:assert/strict");

const originalLog = console.log;
console.log = () => {};
const gap = require("../classes/subtitle-gap");
console.log = originalLog;

const streams = (subs, audio) => [
  { Type: "Video", Codec: "h264" },
  ...audio.map((Language) => ({ Type: "Audio", Language })),
  ...subs.map((Language) => ({ Type: "Subtitle", Language })),
];

test("normalises codes, names and B/T variants", () => {
  assert.equal(gap.normalizeLang("en"), "eng");
  assert.equal(gap.normalizeLang("English"), "eng");
  assert.equal(gap.normalizeLang("fra"), "fre");
  assert.equal(gap.normalizeLang("de-DE"), "ger");
  assert.equal(gap.normalizeLang("und"), "");
  assert.deepEqual(gap.normalizeLangList("en, fr eng"), ["eng", "fre"]);
});

test("detects missing subtitle and audio languages", () => {
  const prefs = { subtitleLanguages: ["en", "fr"], audioLanguages: ["en"] };
  const result = gap.detectGaps(streams(["eng"], ["jpn"]), prefs);
  assert.deepEqual(result.missingSubtitles, ["fre"]);
  assert.deepEqual(result.missingAudio, ["eng"]);
  assert.deepEqual(gap.detectGaps(JSON.stringify(streams(["eng", "fre"], ["eng"])), prefs).missingSubtitles, []);
  assert.deepEqual(gap.detectGaps(null, prefs).missingSubtitles, ["eng", "fre"]);
});

test("rolls episodes up to one row per series", () => {
  const prefs = { subtitleLanguages: ["en"], audioLanguages: [] };
  const rows = [
    { id: "e1", name: "Pilot", type: "Episode", series_id: "s1", series_name: "Show", streams: streams([], ["eng"]) },
    { id: "e2", name: "Two", type: "Episode", series_id: "s1", series_name: "Show", streams: streams([], ["eng"]) },
    { id: "e3", name: "Fine", type: "Episode", series_id: "s1", series_name: "Show", streams: streams(["eng"], ["eng"]) },
    { id: "m1", name: "Film", type: "Movie", year: 2020, streams: streams([], ["eng"]) },
  ];
  const report = gap.buildReport(rows, prefs);
  assert.equal(report.length, 2);
  assert.equal(report[0].kind, "series");
  assert.equal(report[0].files, 2);
  assert.deepEqual(report[0].missingSubtitles, { eng: 2 });
  assert.deepEqual(report[0].examples, ["Pilot", "Two"]);
});

test("matches Bazarr titles loosely and prefers the right year", () => {
  const items = [{ title: "Dune", year: 1984, radarrId: 1 }, { title: "Dune", year: 2021, radarrId: 2 }];
  assert.equal(gap.matchBazarr({ title: "dune", year: 2021 }, items).radarrId, 2);
  assert.equal(gap.matchBazarr({ title: "Amélie & Co" }, [{ title: "Amelie and Co", radarrId: 9 }]).radarrId, 9);
  assert.equal(gap.matchBazarr({ title: "Nope" }, items), null);
});

test("queues Bazarr searches and reports misses", async () => {
  const calls = [];
  const http = {
    get: async (url) => ({ data: { data: url.endsWith("/movies") ? [{ title: "Film", radarrId: 7 }] : [{ title: "Show", sonarrSeriesId: 3 }] } }),
    patch: async (url, body, options) => calls.push([url, options.params, options.headers["X-API-KEY"]]),
  };
  const { results } = await gap.searchInBazarr(
    [{ key: "a", kind: "movie", title: "Film" }, { key: "b", kind: "series", title: "Show" }, { key: "c", kind: "movie", title: "Missing" }],
    { bazarr: { url: "http://bazarr:6767", key: "k", name: "Bazarr" }, http }
  );
  assert.deepEqual(results.map((r) => r.status), ["queued", "queued", "not-found"]);
  assert.deepEqual(calls[0], ["http://bazarr:6767/api/movies", { radarrid: 7, action: "search-missing" }, "k"]);
  assert.deepEqual(calls[1][1], { seriesid: 3, action: "search-missing" });
  await assert.rejects(gap.searchInBazarr([{ kind: "movie", title: "x" }], { bazarr: null }), /not connected/);
});

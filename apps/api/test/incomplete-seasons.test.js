const test = require("node:test");
const assert = require("node:assert/strict");

const originalLog = console.log;
console.log = () => {};
const inc = require("../classes/incomplete-seasons");
console.log = originalLog;

test("reads TVDB ids from provider id maps", () => {
  assert.equal(inc.firstProviderId({ Tvdb: "81189", Imdb: "tt1" }), "81189");
  assert.equal(inc.firstProviderId({ Imdb: "tt1" }), null);
  assert.equal(inc.firstProviderId(null), null);
});

test("parses Postgres arrays of episode numbers", () => {
  assert.deepEqual(inc.parseIndexes("{3,1,2,2}"), [1, 2, 3]);
  assert.deepEqual(inc.parseIndexes([5, null, 0, 4]), [4, 5]);
});

test("uses the Sonarr aired count when known", () => {
  const r = inc.detectSeason({ episodes: 8, indexes: [1, 2, 3, 4, 5, 6, 7, 8], expected: 10 });
  assert.equal(r.incomplete, true);
  assert.equal(r.missing, 2);
  assert.deepEqual(r.missingNumbers, [9, 10]);
  assert.equal(r.source, "sonarr");
  assert.equal(inc.detectSeason({ episodes: 10, indexes: [], expected: 10 }).incomplete, false);
});

test("falls back to gaps in episode numbering without Sonarr", () => {
  const r = inc.detectSeason({ episodes: 4, indexes: "{1,2,4,6}" });
  assert.equal(r.missing, 2);
  assert.deepEqual(r.missingNumbers, [3, 5]);
  assert.equal(r.source, "numbering");
  assert.equal(inc.detectSeason({ episodes: 3, indexes: [1, 2, 3] }).incomplete, false);
});

test("matches Sonarr by TVDB id, then title and year", () => {
  const list = [{ title: "Dark", year: 2017, tvdbId: 334824 }, { title: "The Office", year: 2001, tvdbId: 78107 }, { title: "The Office (US)", year: 2005, tvdbId: 73244 }];
  assert.equal(inc.matchSonarr({ title: "Whatever", tvdbId: "334824" }, list).title, "Dark");
  assert.equal(inc.matchSonarr({ title: "dark" }, list).tvdbId, 334824);
  assert.equal(inc.matchSonarr({ title: "Nope" }, list), null);
});

test("builds report rows with Sonarr and TVDB deep links", () => {
  const rows = [
    { series_id: "s1", series_name: "Dark", season: 1, episodes: 10, indexes: "{1,2,3,4,5,6,7,8,9,10}" },
    { series_id: "s1", series_name: "Dark", season: 2, episodes: 6, indexes: "{1,2,3,4,5,6}" },
    { series_id: "s2", series_name: "Bluey", season: 1, episodes: 3, indexes: "{1,2,5}" },
    { series_id: "s3", series_name: "Complete", season: 1, episodes: 2, indexes: "{1,2}" },
  ];
  const sonarr = { url: "http://sonarr:8989", name: "Sonarr" };
  const sonarrSeries = [{ title: "Dark", tvdbId: 334824, titleSlug: "dark", seasons: [{ seasonNumber: 1, statistics: { episodeCount: 10 } }, { seasonNumber: 2, statistics: { episodeCount: 8 } }] }];
  const items = inc.buildReport(rows, { sonarr, sonarrSeries, providerIds: { s1: { Tvdb: "334824" }, s2: { Tvdb: "353546" } } });
  assert.equal(items.length, 2);
  const [bluey, dark] = items.sort((a, b) => a.title.localeCompare(b.title));
  assert.equal(dark.missing, 2);
  assert.deepEqual(dark.seasons.map((s) => s.season), [2]);
  assert.equal(dark.links.sonarr, "http://sonarr:8989/series/dark");
  assert.equal(dark.links.tvdb, "https://thetvdb.com/dereferrer/series/334824");
  assert.equal(bluey.sonarrMatched, false);
  assert.equal(bluey.links.sonarrSearch, "http://sonarr:8989/add/new?term=tvdb%3A353546");
  assert.deepEqual(bluey.seasons[0].missingNumbers, [3, 4]);
  assert.equal(inc.buildReport(rows, {}).find((i) => i.title === "Dark"), undefined);
});

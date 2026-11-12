const test = require("node:test");
const assert = require("node:assert/strict");

const originalLog = console.log;
console.log = () => {};
const calendar = require("../classes/request-calendar");
console.log = originalLog;

const window = calendar.resolveWindow({ from: "2026-11-12", days: 7 });
const movie = { id: "S-1", title: "Heat", mediaType: "movie", status: "Approved", releaseDate: "2026-11-14", externalIds: { tmdbId: 949 }, availability: { status: "Missing" } };
const show = { id: "S-2", title: "The Crown", mediaType: "tv", status: "Available", releaseDate: "2016-11-04", nextEpisode: { airDate: "2026-11-16", season: 6, episode: 3, name: "Pilot" }, externalIds: { tmdbId: 65494, tvdbId: 305574 }, availability: { status: "Available" } };

test("resolves the window: today by default, bounded length", () => {
  assert.deepEqual(window, { from: "2026-11-12", days: 7, to: "2026-11-18" });
  assert.equal(calendar.resolveWindow({ from: "nonsense", days: 3 }, new Date(2026, 10, 12)).from, "2026-11-12");
  assert.equal(calendar.resolveWindow({ days: 500 }).days, calendar.MAX_DAYS);
  assert.equal(calendar.resolveWindow({ days: 0 }).days, 7);
  assert.equal(calendar.resolveWindow({ from: "2026-12-30", days: 4 }).to, "2027-01-02");
});

test("every day of the window is present, in order, with its titles", () => {
  const result = calendar.buildCalendar([movie, show], { window });
  assert.equal(result.days.length, 7);
  assert.deepEqual(result.days.map((day) => day.date), ["2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15", "2026-11-16", "2026-11-17", "2026-11-18"]);
  assert.equal(result.total, 2);
  assert.equal(result.days[2].items[0].title, "Heat");
  assert.equal(result.days[2].items[0].kind, "Release");
  assert.equal(result.days[4].items[0].label, "S06E03");
  assert.equal(result.days[4].items[0].kind, "Episode");
});

test("titles outside the window, declined and failed requests are left out", () => {
  const outside = { ...movie, id: "S-3", releaseDate: "2026-11-19" };
  const declined = { ...movie, id: "S-4", status: "Declined" };
  const failed = { ...movie, id: "S-5", status: "Error" };
  assert.equal(calendar.buildCalendar([outside, declined, failed], { window }).total, 0);
});

test("a series premiering in the window shows as a premiere when no episode date is known", () => {
  const premiere = { id: "S-6", title: "New Show", mediaType: "tv", status: "Approved", releaseDate: "2026-11-13", externalIds: {}, availability: {} };
  const day = calendar.buildCalendar([premiere], { window }).days[1];
  assert.equal(day.items[0].kind, "Premiere");
});

test("synced *arr releases for requested titles are merged and win over Seerr's date", () => {
  const releases = [
    { type: "movie", title: "Heat", date: "2026-11-14T00:00:00Z", service: "Radarr", hasFile: false },
    { type: "movie", title: "Not Requested", date: "2026-11-14T00:00:00Z", service: "Radarr" },
    { type: "episode", title: "The Crown", date: "2026-11-16T21:00:00Z", service: "Sonarr", subtitle: "S06E03 - Pilot", episodeTitle: "Pilot" },
  ];
  const result = calendar.buildCalendar([movie, show], { window, arrReleases: releases });
  assert.equal(result.total, 2);
  assert.equal(result.days[2].items.length, 1);
  assert.equal(result.days[2].items[0].source, "Radarr");
  assert.equal(result.days[4].items[0].source, "Sonarr");
});

test("live *arr releases match by id before title", () => {
  const live = [{ type: "movie", title: "Something Else", tmdbId: 949, date: "2026-11-15", service: "Radarr" }];
  const result = calendar.buildCalendar([movie], { window, liveReleases: live });
  assert.equal(result.days[3].items[0].requestId, "S-1");
});

test("items on one day are sorted by title", () => {
  const a = { ...movie, id: "A", title: "Zulu", releaseDate: "2026-11-13" };
  const b = { ...movie, id: "B", title: "Alpha", releaseDate: "2026-11-13" };
  assert.deepEqual(calendar.buildCalendar([a, b], { window }).days[1].items.map((item) => item.title), ["Alpha", "Zulu"]);
});

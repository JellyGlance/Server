import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { describeWatcher, findWatchingSessions, isBeingWatched, normalizeTitle } from "../src/lib/watching-lock.js";

const episode = {
  UserName: "Mum",
  Client: "Jellyfin Android TV",
  DeviceName: "Lounge TV",
  NowPlayingItem: { Id: "ep1", SeriesId: "series1", SeasonId: "season1", Type: "Episode", Name: "Pilot", SeriesName: "The Bear", ParentIndexNumber: 1, IndexNumber: 1 },
};
const movie = {
  UserName: "Sam",
  PlayState: { IsPaused: true },
  NowPlayingItem: { Id: "mov1", Type: "Movie", Name: "Dune: Part Two", ProviderIds: { Tmdb: "693134" } },
};
const sessions = [episode, movie];

describe("normalizeTitle", () => {
  test("strips release noise", () => {
    assert.equal(normalizeTitle("Dune.Part.Two.2024.2160p.WEB-DL.x265.mkv"), "dune part two");
    assert.equal(normalizeTitle("The.Bear.S03E02.1080p.WEB.h264"), "the bear");
    assert.equal(normalizeTitle("Dune: Part Two"), "dune part two");
  });
});

describe("findWatchingSessions", () => {
  test("matches by item, series and season id", () => {
    assert.deepEqual(findWatchingSessions(sessions, { itemId: "ep1" }), [episode]);
    assert.deepEqual(findWatchingSessions(sessions, { itemId: "series1" }), [episode]);
    assert.deepEqual(findWatchingSessions(sessions, { ids: ["season1"] }), [episode]);
  });
  test("matches by provider id", () => {
    assert.deepEqual(findWatchingSessions(sessions, { tmdb: 693134 }), [movie]);
  });
  test("matches download names against titles", () => {
    assert.deepEqual(findWatchingSessions(sessions, { title: "The.Bear.S03E02.1080p.WEB.h264-GRP" }), [episode]);
    assert.deepEqual(findWatchingSessions(sessions, { title: "Dune.Part.Two.2024.2160p.REMUX" }), [movie]);
  });
  test("does not match unrelated or empty targets", () => {
    assert.equal(isBeingWatched(sessions, { itemId: "other", title: "Oppenheimer.2023.1080p" }), false);
    assert.equal(isBeingWatched(sessions, {}), false);
    assert.equal(isBeingWatched(null, { itemId: "ep1" }), false);
    assert.equal(isBeingWatched(sessions, { title: "Du" }), false);
  });
});

describe("describeWatcher", () => {
  test("describes episodes and paused movies", () => {
    assert.equal(describeWatcher(episode).text, "Mum is watching The Bear S01E01 · Pilot");
    assert.equal(describeWatcher(episode).device, "Jellyfin Android TV on Lounge TV");
    assert.equal(describeWatcher(movie).text, "Sam is watching Dune: Part Two (paused)");
  });
});

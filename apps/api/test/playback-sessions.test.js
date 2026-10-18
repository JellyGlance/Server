const test = require("node:test");
const assert = require("node:assert/strict");
const {
  liveSessionKey,
  matchRecentPlayback,
  sessionMatchesWatchdog,
} = require("../utils/playback-sessions");

const session = (overrides = {}) => ({
  Id: "s-1",
  UserId: "user-nt",
  DeviceId: "living-room-shield",
  Client: "Jellyfin Android TV",
  NowPlayingItem: { Id: "movie-a" },
  PlayState: { PlaySessionId: "p-1" },
  ...overrides,
});

test("live sessions are keyed by session Id, never by device or user", () => {
  assert.notEqual(liveSessionKey(session()), liveSessionKey(session({ Id: "s-2" })));
  assert.equal(liveSessionKey(session()), liveSessionKey(session({ DeviceId: "another-device", UserId: "someone-else" })));
});

test("a session with no Id still gets a key of its own", () => {
  const key = liveSessionKey(session({ Id: undefined }));
  assert.ok(key);
  assert.notEqual(key, liveSessionKey(session({ Id: undefined, Client: "Jellyfin Web" })));
});

test("a stored row matches only its own session and item", () => {
  const row = { Id: "s-1", NowPlayingItemId: "movie-a", EpisodeId: null, PlayState: JSON.stringify({ PlaySessionId: "p-1" }) };
  assert.equal(sessionMatchesWatchdog(session(), row), true);
  assert.equal(sessionMatchesWatchdog(session({ Id: "s-2" }), row), false, "another stream from the same device and user");
  assert.equal(sessionMatchesWatchdog(session({ NowPlayingItem: { Id: "movie-b" } }), row), false, "the session moved on");
  assert.equal(
    sessionMatchesWatchdog(session({ PlayState: { PlaySessionId: "p-2" } }), row),
    true,
    "a new PlaySessionId mid-film (transcode restart) is still the same viewing"
  );
});

test("rows saved before the upgrade, or by Emby, still match without a PlaySessionId", () => {
  const legacy = { Id: "s-1", NowPlayingItemId: "movie-a", EpisodeId: null, PlayState: null };
  assert.equal(sessionMatchesWatchdog(session(), legacy), true);
  assert.equal(sessionMatchesWatchdog(session({ PlayState: {} }), { ...legacy, PlayState: { IsPaused: false } }), true);
});

test("episodes compare the series and the episode", () => {
  const episode = session({ NowPlayingItem: { Id: "ep-2", SeriesId: "series-1" } });
  assert.equal(sessionMatchesWatchdog(episode, { Id: "s-1", NowPlayingItemId: "series-1", EpisodeId: "ep-2" }), true);
  assert.equal(sessionMatchesWatchdog(episode, { Id: "s-1", NowPlayingItemId: "series-1", EpisodeId: "ep-1" }), false);
});

test("each earlier history row takes one finished playback at most, and never a parallel one", () => {
  const now = Date.parse("2026-10-18T12:00:00Z");
  const row = { Id: "h-1", UserId: "user-nt", NowPlayingItemId: "movie-a", EpisodeId: null, ActivityDateInserted: new Date(now - 30 * 60 * 1000) };
  const finished = (duration) => ({ UserId: "user-nt", NowPlayingItemId: "movie-a", EpisodeId: null, PlaybackDuration: duration });

  const resume = finished(600);
  const parallel = finished(600);
  const merges = matchRecentPlayback([resume, parallel], [row], { now });
  assert.equal(merges.get(resume), row);
  assert.equal(merges.has(parallel), false);

  const overlapping = finished(45 * 60);
  assert.equal(matchRecentPlayback([overlapping], [row], { now }).size, 0);
});

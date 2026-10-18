// Identity helpers for live playback sessions from Jellyfin and Emby.
//
// One user can have several streams at once, and one device can hold several sessions,
// so nothing here is keyed by user or device. A live stream is identified by its server
// session Id, and a single playback (one row in history) is that session plus the item it
// is playing, because a session can play several items one after another.
//
// PlaySessionId is passed along in webhooks but is deliberately not part of the match:
// Jellyfin hands out a new one mid-film when a transcode restarts (changing audio track or
// quality), and Emby leaves it out of the session list, so keying on it would split one
// viewing into several rows.

function text(value) {
  return value === undefined || value === null ? "" : String(value);
}

function playSessionIdOf(session) {
  return text(session?.PlayState?.PlaySessionId || session?.PlaySessionId || session?.NowPlayingItem?.PlaySessionId);
}

function playingItemKey(session) {
  const item = session?.NowPlayingItem;
  if (item?.SeriesId) return text(item.Id || session.EpisodeId);
  return text(item?.Id || session?.EpisodeId || session?.NowPlayingItemId);
}

function liveSessionKey(session) {
  const id = text(session?.Id);
  if (id) return `session:${id}`;
  // Every Jellyfin and Emby session carries an Id. This is only a last resort so a
  // malformed entry still gets a stable key instead of merging with someone else's.
  const parts = [session?.UserId, session?.DeviceId, session?.Client].map(text);
  return parts.some(Boolean) ? `device:${parts.join("|")}` : "";
}

function watchdogItemIds(row) {
  return { itemId: text(row?.NowPlayingItemId), episodeId: text(row?.EpisodeId) };
}

function sessionItemIds(session) {
  const item = session?.NowPlayingItem || {};
  return {
    itemId: text(item.SeriesId || item.Id),
    episodeId: item.SeriesId ? text(item.Id) : "",
  };
}

// Does a stored watchdog row describe the same playback as this live session?
function sessionMatchesWatchdog(session, row) {
  if (!session || !row) return false;
  if (text(row.Id) !== text(session.Id) || !text(session.Id)) return false;

  const live = sessionItemIds(session);
  const stored = watchdogItemIds(row);
  return live.itemId === stored.itemId && live.episodeId === stored.episodeId;
}

// Approximate start of a finished playback, used to tell a resume from a parallel stream.
// Paused time is not in PlaybackDuration, so this is never earlier than the real start.
function estimatedStart(playback, now) {
  return now - Math.max(0, Number(playback?.PlaybackDuration) || 0) * 1000;
}

// Pick the recent history rows that finished playbacks should be merged into.
// Each history row can take at most one playback per pass, and a row that was still being
// written while this playback was running belongs to a parallel stream, not a resume.
function matchRecentPlayback(finished, recentRows, { now = Date.now(), withinRuntime = () => true } = {}) {
  const claimed = new Set();
  const merges = new Map();
  for (const playback of finished) {
    const start = estimatedStart(playback, now);
    const match = (recentRows || []).find((row) => {
      if (claimed.has(row.Id)) return false;
      if (row.NowPlayingItemId !== playback.NowPlayingItemId) return false;
      if (row.EpisodeId !== playback.EpisodeId) return false;
      if (row.UserId !== playback.UserId) return false;
      const rowEnd = row.ActivityDateInserted ? new Date(row.ActivityDateInserted).getTime() : NaN;
      if (Number.isFinite(rowEnd) && rowEnd > start) return false;
      return withinRuntime(row, playback);
    });
    if (match) {
      claimed.add(match.Id);
      merges.set(playback, match);
    }
  }
  return merges;
}

module.exports = {
  liveSessionKey,
  matchRecentPlayback,
  playSessionIdOf,
  playingItemKey,
  sessionMatchesWatchdog,
};

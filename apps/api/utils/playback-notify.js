// Start and stop notifications for live playback, tracked per stream.
//
// Each server session gets its own state, so a second stream on the same device or for the
// same user gets its own "started", and ending one stream never ends another.

const { liveSessionKey, playingItemKey } = require("./playback-sessions");

function sessionIsPaused(session) {
  return Boolean(session?.PlayState?.IsPaused ?? session?.IsPaused);
}

function createPlaybackNotifier({
  firstStartStableMs = 2500,
  itemChangeStableMs = 8000,
  endGraceMs = 90_000,
  pausedGraceMs = 30 * 60 * 1000,
} = {}) {
  const state = new Map();

  function collect(SessionData, now = Date.now()) {
    const live = new Map();
    for (const session of SessionData || []) {
      if (!session?.UserId) continue;
      const key = liveSessionKey(session);
      if (key && !live.has(key)) live.set(key, session);
    }

    const started = [];

    for (const [key, session] of live) {
      const itemKey = playingItemKey(session);
      const paused = sessionIsPaused(session);
      const prev = state.get(key) || {};

      if (!itemKey) {
        state.set(key, { ...prev, lastSeen: now, session, isPaused: paused, notified: Boolean(prev.notified) });
        continue;
      }

      if (paused) {
        state.set(key, { ...prev, lastSeen: now, session, itemKey, isPaused: true, pendingItemKey: null, pendingSince: null });
        continue;
      }

      if (!prev.notified) {
        const pendingSince = prev.pendingItemKey === itemKey ? prev.pendingSince : now;
        const stable = now - pendingSince >= firstStartStableMs;
        state.set(key, {
          ...prev,
          lastSeen: now,
          session,
          itemKey,
          isPaused: false,
          pendingItemKey: itemKey,
          pendingSince,
          notified: stable,
          lastNotifiedItemKey: stable ? itemKey : prev.lastNotifiedItemKey,
          lastItemNotifyAt: stable ? now : prev.lastItemNotifyAt,
        });
        if (stable) started.push(session);
        continue;
      }

      if (itemKey === prev.lastNotifiedItemKey) {
        state.set(key, { ...prev, lastSeen: now, session, itemKey, isPaused: false, pendingItemKey: null, pendingSince: null });
        continue;
      }

      const pendingSince = prev.pendingItemKey === itemKey ? prev.pendingSince : now;
      const stable = now - pendingSince >= itemChangeStableMs;
      state.set(key, {
        ...prev,
        lastSeen: now,
        session,
        itemKey,
        isPaused: false,
        pendingItemKey: itemKey,
        pendingSince,
        lastNotifiedItemKey: stable ? itemKey : prev.lastNotifiedItemKey,
        lastItemNotifyAt: stable ? now : prev.lastItemNotifyAt,
      });
      if (stable) started.push(session);
    }

    const ended = [];
    for (const [key, entry] of state) {
      if (live.has(key)) continue;
      if (!entry.notified) {
        state.delete(key);
        continue;
      }
      const grace = entry.isPaused ? pausedGraceMs : endGraceMs;
      if (now - entry.lastSeen < grace) continue;
      ended.push(entry.session);
      state.delete(key);
    }

    return { started, ended };
  }

  return { collect, state };
}

// Last line of defence against duplicate playback webhooks. Repeats are judged per stream,
// so two streams at once each get their start and their stop.
const RESUME_WINDOW_MS = 4 * 60 * 60 * 1000;
const STALE_MS = 12 * 60 * 60 * 1000;

function createPlaybackEventGate() {
  const streams = new Map();
  const recentItems = new Map();

  function streamKey(data) {
    const sessionId = data.sessionInfo?.sessionId || data.SessionId;
    if (sessionId) return `session:${sessionId}`;
    return `user:${String(data.userData?.userId || data.UserId || data.userData?.username || data.UserName || "unknown")}`;
  }

  function userKey(data) {
    return String(data.userData?.userId || data.UserId || data.userData?.username || data.UserName || "unknown");
  }

  function prune(now) {
    for (const [key, entry] of streams) {
      const limit = entry.state === "playing" ? 4 * STALE_MS : STALE_MS;
      if (now - (entry.lastEventAt || 0) > limit) streams.delete(key);
    }
    for (const [key, at] of recentItems) {
      if (now - at > RESUME_WINDOW_MS) recentItems.delete(key);
    }
  }

  function shouldEmit(eventType, data = {}, now = Date.now()) {
    if (eventType !== "playback_started" && eventType !== "playback_ended") return true;
    prune(now);

    const key = streamKey(data);
    const previous = streams.get(key) || {};
    const itemId = String(data.mediaInfo?.episodeId || data.mediaInfo?.itemId || data.ItemId || "");
    const samePlay = Boolean(previous.itemId && itemId && previous.itemId === itemId);

    if (eventType === "playback_started") {
      if (data.sessionInfo?.isPaused || data.IsPaused) return false;
      if (previous.state === "playing" && samePlay) return false;
      if (previous.lastStart && now - previous.lastStart < 45000) return false;

      // Picking the same item back up later, after it stopped, is not a new start.
      const itemKey = `${userKey(data)}|${itemId}`;
      const recent = itemId ? recentItems.get(itemKey) : null;
      const stillPlayingElsewhere = recent && [...streams.values()].some(
        (entry) => entry.state === "playing" && entry.itemKey === itemKey
      );
      if (recent && !stillPlayingElsewhere && now - recent < RESUME_WINDOW_MS) return false;

      streams.set(key, { state: "playing", itemId, itemKey, lastEventAt: now, lastStart: now });
      if (itemId) recentItems.set(itemKey, now);
      return true;
    }

    if (previous.state !== "playing") return false;
    if (previous.lastStart && now - previous.lastStart < 20000) return false;
    streams.set(key, { ...previous, state: "idle", lastEventAt: now, lastEnd: now });
    return true;
  }

  return { shouldEmit, streams };
}

module.exports = {
  createPlaybackEventGate,
  createPlaybackNotifier,
  sessionIsPaused,
};

// Decides when Blobbo should react to playback starting.
// Pure so it can be unit tested without React or a browser.

export const BLOBBO_REACT_COOLDOWN_MS = 90 * 1000;
export const BLOBBO_REACT_DURATION_MS = 2400;

export function sessionKeys(sessions) {
  if (!Array.isArray(sessions)) return [];
  return sessions
    .filter((s) => s && s.NowPlayingItem)
    .map((s) => String(s.Id || `${s.UserId || ""}:${s.DeviceId || ""}`))
    .filter(Boolean);
}

/**
 * @param {string[]|null} prevKeys keys from the previous snapshot (null = first snapshot)
 * @param {string[]} nextKeys keys from the latest snapshot
 * @param {number} lastReactAt timestamp of the last reaction (0 = never)
 * @param {number} now current timestamp
 * @returns {null|"wave"|"look"} wave when playback starts from idle, look when another stream joins
 */
export function decideSessionReaction(prevKeys, nextKeys, lastReactAt = 0, now = Date.now(), cooldownMs = BLOBBO_REACT_COOLDOWN_MS) {
  // First snapshot after load just sets the baseline; streams already playing are not "new".
  if (prevKeys == null) return null;
  const prev = new Set(prevKeys);
  const added = (nextKeys || []).filter((k) => !prev.has(k));
  if (!added.length) return null;
  if (lastReactAt && now - lastReactAt < cooldownMs) return null;
  return prev.size === 0 ? "wave" : "look";
}

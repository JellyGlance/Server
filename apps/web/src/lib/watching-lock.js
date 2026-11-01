// Watching soft lock: find active sessions that touch an item before a
// destructive action (purge, download removal, re-grab) so the admin can be
// warned first. Pure helpers here; the modal lives in WatchingLockModal.jsx.

const TOKEN_NOISE = /\b(2160p|1080p|720p|480p|4k|uhd|hdr10?|dv|web[- ]?dl|webrip|bluray|brrip|remux|x26[45]|h\.?26[45]|hevc|aac|ddp?5\.1|atmos|proper|repack)\b.*$/i;

export function normalizeTitle(value = "") {
  return String(value)
    .toLowerCase()
    .replace(/\.[a-z0-9]{2,4}$/i, "")
    .replace(/[._]+/g, " ")
    .replace(/\[[^\]]*\]|\([^)]*\)/g, " ")
    .replace(/\bs\d{1,2}(e\d{1,3})?\b.*$/i, "")
    .replace(/\b(19|20)\d{2}\b.*$/, "")
    .replace(TOKEN_NOISE, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function sessionIds(item = {}) {
  return [item.Id, item.SeriesId, item.SeasonId, item.ParentId, item.AlbumId].filter(Boolean).map(String);
}

function providerIds(item = {}) {
  const ids = item.ProviderIds || {};
  return {
    tmdb: ids.Tmdb || ids.tmdb,
    tvdb: ids.Tvdb || ids.tvdb,
    seriesTmdb: item.SeriesProviderIds?.Tmdb,
    seriesTvdb: item.SeriesProviderIds?.Tvdb,
  };
}

function sessionTitles(item = {}) {
  return [item.SeriesName, item.Album, item.OriginalTitle, item.Type === "Episode" ? null : item.Name]
    .filter(Boolean)
    .map(normalizeTitle)
    .filter((title) => title.length >= 2);
}

/**
 * Return the sessions currently playing something covered by `target`.
 * target: { itemId?, ids?: string[], tmdb?, tvdb?, title? }
 */
export function findWatchingSessions(sessions, target = {}) {
  if (!Array.isArray(sessions) || !target) return [];
  const ids = new Set([target.itemId, ...(target.ids || [])].filter(Boolean).map(String));
  const tmdb = target.tmdb ? String(target.tmdb) : "";
  const tvdb = target.tvdb ? String(target.tvdb) : "";
  const title = target.title ? normalizeTitle(target.title) : "";

  return sessions.filter((session) => {
    const item = session?.NowPlayingItem;
    if (!item) return false;
    if (ids.size && sessionIds(item).some((id) => ids.has(id))) return true;
    const providers = providerIds(item);
    if (tmdb && [providers.tmdb, providers.seriesTmdb].some((id) => id && String(id) === tmdb)) return true;
    if (tvdb && [providers.tvdb, providers.seriesTvdb].some((id) => id && String(id) === tvdb)) return true;
    if (title && title.length >= 3) {
      return sessionTitles(item).some((candidate) => candidate === title || (candidate.length >= 4 && title.startsWith(`${candidate} `)) || title === candidate);
    }
    return false;
  });
}

export function isBeingWatched(sessions, target) {
  return findWatchingSessions(sessions, target).length > 0;
}

export function describeWatcher(session) {
  const item = session?.NowPlayingItem || {};
  const who = session?.UserName || "Someone";
  let what = item.Name || "this title";
  if (item.Type === "Episode" && item.SeriesName) {
    const se = item.ParentIndexNumber != null && item.IndexNumber != null
      ? ` S${String(item.ParentIndexNumber).padStart(2, "0")}E${String(item.IndexNumber).padStart(2, "0")}`
      : "";
    what = `${item.SeriesName}${se} · ${item.Name}`;
  }
  const device = [session?.Client, session?.DeviceName].filter(Boolean).join(" on ");
  const paused = session?.PlayState?.IsPaused ? " (paused)" : "";
  return { who, what, device, text: `${who} is watching ${what}${paused}` };
}

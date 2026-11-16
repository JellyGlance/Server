// What the trailer dialog needs to look a title up. Discover results carry the TMDB id as
// `mediaId`; queued requests carry it under `externalIds.tmdbId` (their own `mediaId` is
// Seerr's internal media id, which is not a TMDB id).
export function trailerTarget(item) {
  if (!item) return null;
  const mediaType = String(item.mediaType || "").toLowerCase();
  if (mediaType !== "movie" && mediaType !== "tv") return null;
  const tmdbId = Number(item.isSearchResult || item.state !== undefined ? item.mediaId : item.externalIds?.tmdbId || item.tmdbId);
  if (!Number.isInteger(tmdbId) || tmdbId <= 0) return null;
  return { sourceId: item.sourceId, mediaType, tmdbId, title: item.title || "" };
}

// Only ever embed from the privacy-friendly YouTube host, whatever the API sent back.
export function safeEmbedUrl(url) {
  try {
    const parsed = new URL(String(url || ""));
    if (parsed.protocol !== "https:" || parsed.hostname !== "www.youtube-nocookie.com" || !parsed.pathname.startsWith("/embed/")) return "";
    return parsed.toString();
  } catch {
    return "";
  }
}

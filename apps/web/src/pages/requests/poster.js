// Poster art for a request or a Discover title. The Seerr/TMDB poster comes first (always a
// true 2:3 poster); the library's Primary image is only the fallback, and any image that is
// not portrait (a logo, title card or thumb) is skipped. Never Logo, Thumb or Backdrop.
export function posterChain(item, baseUrl = "") {
  const remote = item?.posterUrls?.length ? item.posterUrls : item?.posterUrl ? [item.posterUrl] : [];
  const libraryId = item?.availability?.jellyfinItemId || item?.jellyfinItemId;
  const library = libraryId ? `${baseUrl}/proxy/Items/Images/Primary?id=${encodeURIComponent(libraryId)}&fillWidth=300&quality=80` : null;
  return [...remote, library].filter(Boolean);
}

// Portrait enough to be a poster (2:3 is 0.667).
export function isPosterRatio(width, height) {
  if (!(width > 0) || !(height > 0)) return false;
  const ratio = width / height;
  return ratio >= 0.55 && ratio <= 0.8;
}

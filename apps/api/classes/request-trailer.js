// Picks the trailer to play for a title from Seerr's `relatedVideos`.
// Only YouTube keys of the usual shape are accepted; the web app plays them in a
// youtube-nocookie embed, so nothing else from the video list ever reaches the page.
const KEY_PATTERN = /^[A-Za-z0-9_-]{6,20}$/;
const TYPE_RANK = { Trailer: 0, Teaser: 1, Clip: 2 };

function videoKey(video) {
  if (typeof video?.key === "string" && KEY_PATTERN.test(video.key)) return video.key;
  // Seerr also sends the watch URL; recover the key from it when `key` is missing.
  try {
    const url = new URL(String(video?.url || ""));
    const host = url.hostname.replace(/^www\./, "");
    const key = host === "youtu.be" ? url.pathname.slice(1) : host.endsWith("youtube.com") ? url.searchParams.get("v") : "";
    return KEY_PATTERN.test(key || "") ? key : "";
  } catch {
    return "";
  }
}

function pickTrailer(relatedVideos) {
  const candidates = (Array.isArray(relatedVideos) ? relatedVideos : [])
    .filter((video) => video && (!video.site || String(video.site).toLowerCase() === "youtube"))
    .map((video, index) => ({ video, index, key: videoKey(video), rank: TYPE_RANK[video.type] ?? 9 }))
    .filter((entry) => entry.key && entry.rank < 9);
  if (!candidates.length) return null;
  candidates.sort((a, b) => a.rank - b.rank || Number(b.video.size || 0) - Number(a.video.size || 0) || a.index - b.index);
  const best = candidates[0];
  return {
    key: best.key,
    name: String(best.video.name || "").slice(0, 120) || "Trailer",
    type: best.video.type,
    embedUrl: embedUrl(best.key),
  };
}

function embedUrl(key) {
  return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(key)}?rel=0&modestbranding=1&autoplay=1`;
}

module.exports = { pickTrailer, embedUrl, videoKey, KEY_PATTERN };

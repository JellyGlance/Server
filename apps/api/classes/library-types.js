// Which media server item types JellyGlance stores, and how libraries and plays are grouped.
// Jellyfin and Emby use the same type names, so both servers share this list.

// Item types stored in jf_library_items.
// - MusicVideo: everything in a "musicvideos" library.
// - Video: home videos and loose files in "mixed" libraries.
// - Book / AudioBook: "books" libraries hold both (there is no separate audiobooks collection type).
// - Photo: "photos" and "homevideos" libraries. PhotoAlbum is a folder, like BoxSet and Playlist,
//   so it is left out; the photos inside it are fetched recursively and stored on their own.
// - Trailer: local trailer libraries.
// BoxSet, Playlist, Folder and Live TV items stay excluded on purpose.
const LIBRARY_ITEM_TYPES = Object.freeze(["Movie", "Audio", "Series", "MusicVideo", "Video", "Book", "AudioBook", "Photo", "Trailer"]);

const LIBRARY_ITEM_TYPE_SET = new Set(LIBRARY_ITEM_TYPES);

function isLibraryItemType(type) {
  return LIBRARY_ITEM_TYPE_SET.has(type);
}

function filterLibraryItems(items = []) {
  return items.filter((item) => item && isLibraryItemType(item.Type));
}

// Library collection types the dashboards know about. Anything else (null, "folders", unknown)
// is shown as mixed.
const COLLECTION_TYPES = Object.freeze(["movies", "tvshows", "music", "musicvideos", "homevideos", "books", "photos", "trailers", "mixed"]);

function collectionGroup(collectionType) {
  const value = String(collectionType || "").toLowerCase();
  return COLLECTION_TYPES.includes(value) ? value : "mixed";
}

// SQL columns that sum item counts per collection type from js_library_stats_overview.
// quoted=true gives "Movies", "MusicVideos"...; false gives movies, music_videos... for snake_case consumers.
const CATALOG_COUNT_COLUMNS = [
  ["MusicVideos", "music_videos", "musicvideos"],
  ["HomeVideos", "home_videos", "homevideos"],
  ["Books", "books", "books"],
  ["Photos", "photos", "photos"],
  ["Trailers", "trailers", "trailers"],
];

function catalogCountSql({ quoted = true } = {}) {
  return CATALOG_COUNT_COLUMNS.map(
    ([pascal, snake, collection]) =>
      `COALESCE(sum(CASE WHEN "CollectionType" = '${collection}' THEN "Library_Count" ELSE 0 END), 0)::int AS ${quoted ? `"${pascal}"` : snake}`
  ).join(",\n          ");
}

function catalogCounts(row = {}, { quoted = true } = {}) {
  return Object.fromEntries(
    CATALOG_COUNT_COLUMNS.map(([pascal, snake]) => {
      const key = snake.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
      return [key, Number((quoted ? row[pascal] : row[snake]) || 0)];
    })
  );
}

// Play buckets for /stats/getViewsByLibraryType. Every play counts once, whatever the type.
// Audiobook plays carry the listening time the server reports, like music. Book plays count as
// plays only: reading is not a playback session, so there is no runtime to add to watch time.
const PLAY_TYPE_BUCKETS = Object.freeze({
  Audio: "Audio",
  Movie: "Movie",
  Series: "Series",
  MusicVideo: "MusicVideo",
  Video: "Video",
  Book: "Book",
  AudioBook: "AudioBook",
  Photo: "Photo",
  Trailer: "Trailer",
});
const PLAY_BUCKET_ORDER = ["Audio", "Movie", "Series", "MusicVideo", "Video", "Book", "AudioBook", "Photo", "Trailer", "Other"];

function groupPlaysByType(rows = []) {
  const totals = Object.fromEntries(PLAY_BUCKET_ORDER.map((bucket) => [bucket, 0]));
  for (const row of rows) {
    const bucket = PLAY_TYPE_BUCKETS[row?.type] || "Other";
    totals[bucket] += Number(row?.count || 0);
  }
  return totals;
}

module.exports = {
  LIBRARY_ITEM_TYPES,
  COLLECTION_TYPES,
  isLibraryItemType,
  filterLibraryItems,
  collectionGroup,
  catalogCountSql,
  catalogCounts,
  groupPlaysByType,
};

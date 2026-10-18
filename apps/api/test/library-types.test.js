const test = require("node:test");
const assert = require("node:assert/strict");
const {
  LIBRARY_ITEM_TYPES,
  isLibraryItemType,
  filterLibraryItems,
  collectionGroup,
  catalogCountSql,
  catalogCounts,
  groupPlaysByType,
} = require("../classes/library-types");

test("sync keeps every playable item type, including books, audiobooks, photos and trailers", () => {
  for (const type of ["Movie", "Audio", "Series", "MusicVideo", "Video", "Book", "AudioBook", "Photo", "Trailer"]) {
    assert.ok(isLibraryItemType(type), `${type} should be stored`);
  }
});

test("sync still leaves out containers, seasons, episodes and live TV", () => {
  for (const type of ["BoxSet", "Playlist", "Folder", "CollectionFolder", "PhotoAlbum", "MusicAlbum", "Season", "Episode", "TvChannel", "Program", undefined]) {
    assert.equal(isLibraryItemType(type), false, `${type} should be skipped`);
  }
});

test("a mixed library page keeps only the stored types, in order", () => {
  const page = [
    { Id: "1", Type: "Book" },
    { Id: "2", Type: "PhotoAlbum" },
    { Id: "3", Type: "Photo" },
    { Id: "4", Type: "AudioBook" },
    { Id: "5", Type: "BoxSet" },
    { Id: "6", Type: "Trailer" },
    null,
    { Id: "7", Type: "Movie" },
  ];
  assert.deepEqual(
    filterLibraryItems(page).map((item) => item.Id),
    ["1", "3", "4", "6", "7"]
  );
});

test("the type list is frozen so routes cannot change it by accident", () => {
  assert.ok(Object.isFrozen(LIBRARY_ITEM_TYPES));
});

test("collection types group into known buckets, with anything else as mixed", () => {
  assert.equal(collectionGroup("books"), "books");
  assert.equal(collectionGroup("Photos"), "photos");
  assert.equal(collectionGroup("musicvideos"), "musicvideos");
  assert.equal(collectionGroup("homevideos"), "homevideos");
  assert.equal(collectionGroup("trailers"), "trailers");
  assert.equal(collectionGroup(null), "mixed");
  assert.equal(collectionGroup("folders"), "mixed");
});

test("catalog SQL adds a count per new collection type in both naming styles", () => {
  const quoted = catalogCountSql();
  const snake = catalogCountSql({ quoted: false });
  for (const [collection, quotedName, snakeName] of [
    ["books", '"Books"', "books"],
    ["photos", '"Photos"', "photos"],
    ["musicvideos", '"MusicVideos"', "music_videos"],
    ["homevideos", '"HomeVideos"', "home_videos"],
    ["trailers", '"Trailers"', "trailers"],
  ]) {
    assert.match(quoted, new RegExp(`'${collection}' THEN "Library_Count" ELSE 0 END\\), 0\\)::int AS ${quotedName}`));
    assert.match(snake, new RegExp(`'${collection}' THEN "Library_Count" ELSE 0 END\\), 0\\)::int AS ${snakeName}\\b`));
  }
});

test("catalog counts read either naming style and default to zero", () => {
  assert.deepEqual(catalogCounts({ Books: 12, Photos: "40", MusicVideos: 3 }), {
    musicVideos: 3,
    homeVideos: 0,
    books: 12,
    photos: 40,
    trailers: 0,
  });
  assert.deepEqual(catalogCounts({ music_videos: 2, home_videos: 5, trailers: 1 }, { quoted: false }), {
    musicVideos: 2,
    homeVideos: 5,
    books: 0,
    photos: 0,
    trailers: 1,
  });
});

test("plays group per item type, so book, audiobook and photo plays are no longer dropped", () => {
  const totals = groupPlaysByType([
    { type: "Movie", count: "4" },
    { type: "AudioBook", count: 3 },
    { type: "Book", count: 2 },
    { type: "Photo", count: 1 },
    { type: "MusicVideo", count: 5 },
    { type: "Other", count: 7 },
    { type: "SomethingNew", count: 1 },
  ]);
  assert.deepEqual(totals, {
    Audio: 0,
    Movie: 4,
    Series: 0,
    MusicVideo: 5,
    Video: 0,
    Book: 2,
    AudioBook: 3,
    Photo: 1,
    Trailer: 0,
    Other: 8,
  });
});

test("an empty period still returns every bucket at zero", () => {
  const totals = groupPlaysByType([]);
  assert.equal(Object.values(totals).every((value) => value === 0), true);
  assert.deepEqual(Object.keys(totals).slice(0, 3), ["Audio", "Movie", "Series"]);
});

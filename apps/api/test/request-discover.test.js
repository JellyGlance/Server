const assert = require("node:assert/strict");
const test = require("node:test");

const {
  describeAvailability,
  normalizeDiscoverItem,
  buildRowQuery,
  getDiscoverRows,
  getDiscoverRow,
  isReadOnlySeerr,
  ROWS,
} = require("../classes/request-discover");

const source = { instanceId: "Seerr-1", name: "Seerr", values: { url: "http://127.0.0.1:1", secret: "x" } };

test("describeAvailability maps Seerr media status to one badge state", () => {
  assert.equal(describeAvailability({ status: 5 }).state, "available");
  assert.equal(describeAvailability({ status: 4 }).state, "partial");
  assert.equal(describeAvailability({ status: 2 }).state, "pending");
  assert.equal(describeAvailability({ status: 3 }).state, "processing");
  assert.equal(describeAvailability({ status: 6 }).state, "blocked");
  assert.equal(describeAvailability({ status: 1 }).state, "none");
  assert.equal(describeAvailability(undefined).state, "none");
  assert.equal(describeAvailability(undefined, true).state, "available");
  assert.equal(describeAvailability({ status: 3 }).requested, true);
  assert.equal(describeAvailability({ status: 5 }).requested, false);
});

test("normalizeDiscoverItem keeps ids, art and status; drops people and artless titles", () => {
  const movie = normalizeDiscoverItem(
    { id: 7, mediaType: "movie", title: "Heat", releaseDate: "1995-12-15", posterPath: "/p.jpg", backdropPath: "/b.jpg", voteAverage: 8.2, mediaInfo: { status: 5, jellyfinMediaId: "abc" } },
    source
  );
  assert.equal(movie.id, "Seerr-1-movie-7");
  assert.equal(movie.year, "1995");
  assert.equal(movie.state, "available");
  assert.equal(movie.jellyfinItemId, "abc");
  assert.equal(movie.posterUrl, "https://image.tmdb.org/t/p/w342/p.jpg");
  assert.equal(movie.backdropUrl, "https://image.tmdb.org/t/p/w780/b.jpg");
  assert.equal(normalizeDiscoverItem({ id: 1, mediaType: "person", name: "X", posterPath: "/p.jpg" }, source), null);
  assert.equal(normalizeDiscoverItem({ id: 2, mediaType: "tv", name: "No art" }, source), null);
  const tv = normalizeDiscoverItem({ id: 3, name: "Show", firstAirDate: "2020-01-01", posterPath: "/s.jpg" }, source, "tv");
  assert.equal(tv.mediaType, "tv");
  assert.equal(tv.state, "none");
});

test("buildRowQuery only builds GET discover paths", () => {
  assert.equal(buildRowQuery("trending").path, "/discover/trending");
  assert.equal(buildRowQuery("upcoming-tv").path, "/discover/tv/upcoming");
  assert.equal(buildRowQuery("movie-genres", "28").path, "/discover/movies/genre/28");
  assert.equal(buildRowQuery("networks", "213").path, "/discover/tv/network/213");
  assert.equal(buildRowQuery("studios", "abc"), null);
  assert.equal(buildRowQuery("nope"), null);
  const released = buildRowQuery("just-released-movies");
  assert.ok(released.params.primaryReleaseDateLte >= released.params.primaryReleaseDateGte);
});

test("rows lead with Recommended and Just released, then follow Seerr order", async () => {
  // Seerr is unreachable here, so the slider read fails and the default order is used.
  const rows = await getDiscoverRows(source);
  assert.deepEqual(rows.rows.slice(0, 3).map((row) => row.key), ["recommended", "just-released-movies", "just-released-tv"]);
  assert.ok(rows.rows.some((row) => row.key === "upcoming-movies"));
  assert.ok(rows.rows.some((row) => row.key === "upcoming-tv"));
  assert.ok(rows.rows.every((row) => ROWS[row.key]));
});

test("chip rows return their chips without calling Seerr; unknown rows are rejected", async () => {
  const studios = await getDiscoverRow(source, "studios");
  assert.equal(studios.kind, "chips");
  assert.ok(studios.chips.length > 5);
  await assert.rejects(() => getDiscoverRow(source, "nope"), /Unknown discover row/);
});

test("JG_READONLY_SEERR switches the read-only flag", () => {
  const previous = process.env.JG_READONLY_SEERR;
  process.env.JG_READONLY_SEERR = "1";
  assert.equal(isReadOnlySeerr(), true);
  delete process.env.JG_READONLY_SEERR;
  assert.equal(isReadOnlySeerr(), false);
  if (previous !== undefined) process.env.JG_READONLY_SEERR = previous;
});

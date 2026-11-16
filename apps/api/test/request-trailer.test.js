const test = require("node:test");
const assert = require("node:assert/strict");
const { pickTrailer, videoKey } = require("../classes/request-trailer");

test("prefers a trailer over a teaser and a clip", () => {
  const picked = pickTrailer([
    { site: "YouTube", key: "clipClip123", type: "Clip", name: "Clip" },
    { site: "YouTube", key: "teaserTe123", type: "Teaser", name: "Teaser" },
    { site: "YouTube", key: "trailerTr12", type: "Trailer", name: "Official Trailer" },
  ]);
  assert.equal(picked.key, "trailerTr12");
  assert.equal(picked.name, "Official Trailer");
  assert.equal(picked.embedUrl, "https://www.youtube-nocookie.com/embed/trailerTr12?rel=0&modestbranding=1&autoplay=1");
});

test("breaks ties on size, then on order", () => {
  const picked = pickTrailer([
    { site: "YouTube", key: "small123456", type: "Trailer", size: 720 },
    { site: "YouTube", key: "large123456", type: "Trailer", size: 1080 },
  ]);
  assert.equal(picked.key, "large123456");
  assert.equal(pickTrailer([{ key: "first123456", type: "Trailer" }, { key: "second12345", type: "Trailer" }]).key, "first123456");
});

test("reads the key from the watch url when the key is missing", () => {
  assert.equal(videoKey({ url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" }), "dQw4w9WgXcQ");
  assert.equal(videoKey({ url: "https://youtu.be/dQw4w9WgXcQ" }), "dQw4w9WgXcQ");
  assert.equal(videoKey({ url: "https://evil.example/watch?v=dQw4w9WgXcQ" }), "");
});

test("ignores other sites, odd keys and unknown types", () => {
  assert.equal(pickTrailer([{ site: "Vimeo", key: "abcdefghijk", type: "Trailer" }]), null);
  assert.equal(pickTrailer([{ site: "YouTube", key: "bad key!<script>", type: "Trailer" }]), null);
  assert.equal(pickTrailer([{ site: "YouTube", key: "abcdefghijk", type: "Featurette" }]), null);
  assert.equal(pickTrailer(undefined), null);
  assert.equal(pickTrailer([]), null);
});

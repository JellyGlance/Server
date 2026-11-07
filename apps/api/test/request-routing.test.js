const test = require("node:test");
const assert = require("node:assert/strict");
const routing = require("../classes/request-routing");

const routes = routing.normalizeRoutes([
  { id: "kids", name: "Kids animation", users: ["kid1"], genres: ["Animation"], action: "approve" },
  { id: "horror", name: "Hold horror", genres: ["horror"], action: "hold" },
  { id: "mum-tv", name: "Mum TV", users: ["mum"], mediaType: "tv", action: "approve" },
  { id: "off", name: "Disabled", enabled: false, action: "approve" },
]);

test("matches user and genre together, case-insensitively", () => {
  const r = routing.decide(routes, { userKey: "kid1", mediaType: "movie", genres: ["animation", "Family"] });
  assert.equal(r.action, "approve");
  assert.equal(r.route.id, "kids");
});

test("first matching rule wins", () => {
  const r = routing.decide(routes, { userKey: "kid1", mediaType: "movie", genres: ["Animation", "Horror"] });
  assert.equal(r.route.id, "kids");
});

test("genre-only rule holds for anyone", () => {
  assert.equal(routing.decide(routes, { userKey: "dad", mediaType: "movie", genres: ["Horror"] }).action, "hold");
});

test("media type limits a rule", () => {
  assert.equal(routing.decide(routes, { userKey: "mum", mediaType: "tv", genres: [] }).route.id, "mum-tv");
  assert.equal(routing.decide(routes, { userKey: "mum", mediaType: "movie", genres: [] }).action, null);
});

test("disabled rules and unmatched requests return no decision", () => {
  assert.equal(routing.decide(routes, { userKey: "stranger", mediaType: "movie", genres: ["Drama"] }).action, null);
});

test("missing genres never satisfy a genre rule", () => {
  assert.equal(routing.decide(routes, { userKey: "kid1", mediaType: "movie" }).action, null);
});

test("normalises bad input safely", () => {
  const [route] = routing.normalizeRoutes([{ id: "<x>", action: "delete", mediaType: "music", users: "a, b ,a", genres: null }]);
  assert.equal(route.id, "x");
  assert.equal(route.action, "hold");
  assert.equal(route.mediaType, "any");
  assert.deepEqual(route.users, ["a", "b"]);
  assert.deepEqual(route.genres, []);
  assert.deepEqual(routing.normalizeRoutes("nope"), []);
  assert.equal(routing.normalizeRoutes(Array.from({ length: 80 }, () => ({}))).length, routing.MAX_ROUTES);
});

test("duplicate ids are made unique", () => {
  const list = routing.normalizeRoutes([{ id: "a" }, { id: "a" }]);
  assert.notEqual(list[0].id, list[1].id);
});

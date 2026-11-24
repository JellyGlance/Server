const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// The request write routes must refuse before they build a Seerr call when the
// connection is read-only (the demo), so a stray click can never reach Seerr.
const source = fs.readFileSync(path.join(__dirname, "../routes/api.js"), "utf8");

for (const route of [
  'router.post("/requests/issues/:issueId/actions"',
  'router.post("/requests/:requestId/actions"',
  'router.put("/requests/:requestId/edit"',
]) {
  test(`${route} is guarded by the read-only flag`, () => {
    const start = source.indexOf(route);
    assert.notEqual(start, -1, "route not found");
    const head = source.slice(start, start + 900);
    assert.match(head, /isReadOnlySeerr\(\)/);
    assert.match(head, /403/);
    assert.match(head, /readOnly: true/);
  });
}

test("GET /requests reports the read-only flag", () => {
  const start = source.indexOf('router.get("/requests"');
  assert.notEqual(start, -1);
  assert.match(source.slice(start, start + 1600), /readOnly: requestDiscover\.isReadOnlySeerr\(\)/);
});

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { normalizeBulkInput, runBulk, MAX_ITEMS } = require("../classes/request-bulk");

const item = (id, extra = {}) => ({ requestId: id, sourceId: "Overseerr-5", title: `T${id}`, ...extra });

test("normalizes the action and the items", () => {
  const out = normalizeBulkInput({ action: "Approve", items: [item(1), item("2", { mediaType: "TV", tmdb: 99, tvdb: "x" })] });
  assert.equal(out.action, "approve");
  assert.equal(out.items.length, 2);
  assert.equal(out.items[1].mediaType, "tv");
  assert.equal(out.items[1].tmdb, "99");
  assert.equal(out.items[1].tvdb, undefined);
});

test("drops duplicates and rejects bad input with a 400", () => {
  assert.equal(normalizeBulkInput({ action: "decline", items: [item(1), item(1)] }).items.length, 1);
  for (const body of [
    { action: "delete", items: [item(1)] },
    { action: "approve", items: [] },
    { action: "approve" },
    { action: "approve", items: [{ requestId: "1; drop", sourceId: "s" }] },
    { action: "approve", items: [{ requestId: "1" }] },
    { action: "approve", items: Array.from({ length: MAX_ITEMS + 1 }, (_, i) => item(i + 1)) },
  ]) {
    assert.throws(() => normalizeBulkInput(body), (error) => error.statusCode === 400);
  }
});

test("runs one by one, keeps going after a failure, and reports each item", async () => {
  const order = [];
  const summary = await runBulk({
    action: "approve",
    items: [item("1"), item("2"), item("3")],
    runOne: async (it, action) => {
      order.push(`${it.requestId}:${action}`);
      if (it.requestId === "2") {
        const error = new Error("Seerr said no");
        error.statusCode = 409;
        throw error;
      }
    },
  });
  assert.deepEqual(order, ["1:approve", "2:approve", "3:approve"]);
  assert.equal(summary.total, 3);
  assert.equal(summary.succeeded, 2);
  assert.equal(summary.failed, 1);
  assert.deepEqual(summary.results.map((r) => r.ok), [true, false, true]);
  assert.equal(summary.results[1].status, 409);
  assert.equal(summary.results[1].error, "Seerr said no");
});

// The read-only guard has to come before anything that could reach Seerr.
const apiSource = fs.readFileSync(path.join(__dirname, "../routes/api.js"), "utf8");
const centerSource = fs.readFileSync(path.join(__dirname, "../routes/command-center.js"), "utf8");

test("POST /requests/bulk refuses in read-only mode before any Seerr call, then checks admin", () => {
  const start = apiSource.indexOf('router.post("/requests/bulk"');
  assert.notEqual(start, -1);
  const body = apiSource.slice(start, apiSource.indexOf("\nrouter.put(\"/requests/:requestId/edit\"", start));
  const guard = body.indexOf("isReadOnlySeerr()");
  assert.ok(guard > -1 && body.indexOf("403") > guard && body.indexOf("readOnly: true") > guard);
  for (const call of ["normalizeBulkInput", "runBulk", "runSeerrRequestAction", "retryFailedGrab"]) {
    assert.ok(body.indexOf(call) > guard, `${call} must come after the read-only guard`);
  }
  assert.ok(body.indexOf("isAdmin(req.user)") > guard && body.indexOf("isAdmin(req.user)") < body.indexOf("normalizeBulkInput"));
});

test("POST /retry-grab refuses in read-only mode before retrying", () => {
  const start = centerSource.indexOf('router.post("/retry-grab"');
  assert.notEqual(start, -1);
  const body = centerSource.slice(start, start + 900);
  const guard = body.indexOf("isReadOnlySeerr()");
  assert.ok(guard > -1);
  assert.ok(body.indexOf("403") > guard && body.indexOf("readOnly: true") > guard);
  assert.ok(body.indexOf("retryFailedGrab(") > guard);
});

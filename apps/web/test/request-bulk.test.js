import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { actionPlan, appliesTo, bulkPayload, isSelectable, pruneSelection, resultSummary } from "../src/pages/requests/bulk.js";

const req = (id, status, extra = {}) => ({ id: `S-${id}`, requestId: id, sourceId: "S", title: `Title ${id}`, mediaType: "movie", status, ...extra });

describe("selection rules", () => {
  it("only pending and failed requests with ids can be picked", () => {
    assert.equal(isSelectable(req(1, "Pending")), true);
    assert.equal(isSelectable(req(2, "Failed")), true);
    assert.equal(isSelectable(req(3, "Available")), false);
    assert.equal(isSelectable(req(4, "Declined")), false);
    assert.equal(isSelectable({ ...req(5, "Pending"), requestId: null }), false);
  });

  it("approve and decline apply to pending, retry to failed", () => {
    assert.equal(appliesTo("approve", req(1, "Pending")), true);
    assert.equal(appliesTo("decline", req(2, "Failed")), false);
    assert.equal(appliesTo("retry", req(2, "Failed")), true);
    assert.equal(appliesTo("retry", req(1, "Pending")), false);
  });

  it("builds a plan with only the actions that change something", () => {
    const plan = actionPlan([req(1, "Pending"), req(2, "Pending"), req(3, "Failed")]);
    assert.deepEqual(Object.keys(plan).sort(), ["approve", "decline", "retry"]);
    assert.equal(plan.approve.length, 2);
    assert.equal(plan.retry.length, 1);
    assert.deepEqual(actionPlan([req(3, "Failed")]), { retry: [req(3, "Failed")] });
    assert.deepEqual(actionPlan([]), {});
  });
});

describe("payload and results", () => {
  it("sends ids as strings with what retry needs", () => {
    const payload = bulkPayload("retry", [req(7, "Failed", { externalIds: { tmdbId: 11, tvdbId: 22 } })]);
    assert.deepEqual(payload, { action: "retry", items: [{ requestId: "7", sourceId: "S", title: "Title 7", mediaType: "movie", tmdb: 11, tvdb: 22 }] });
  });

  it("summarises per-item results", () => {
    assert.equal(resultSummary({ action: "approve", succeeded: 3, failed: 0 }), "3 approved");
    assert.equal(resultSummary({ action: "decline", succeeded: 2, failed: 1 }), "2 declined, 1 failed");
    assert.equal(resultSummary({ action: "retry", succeeded: 0, failed: 2 }), "Nothing changed (2 failed)");
    assert.equal(resultSummary(null), "");
  });

  it("drops picks that are no longer selectable after a refresh", () => {
    const next = pruneSelection(new Set(["S-1", "S-2", "S-9"]), [req(1, "Pending"), req(2, "Available")]);
    assert.deepEqual([...next], ["S-1"]);
  });
});

import test from "node:test";
import assert from "node:assert/strict";
import { reorderBlocks, moveBlockBy } from "../src/lib/newsletter-report-blocks.js";

test("reorderBlocks moves a section to a new index", () => {
  const blocks = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
  assert.deepEqual(reorderBlocks(blocks, 0, 2).map((block) => block.id), ["b", "c", "a", "d"]);
  assert.deepEqual(reorderBlocks(blocks, 3, 1).map((block) => block.id), ["a", "d", "b", "c"]);
  assert.deepEqual(reorderBlocks(blocks, 1, 1).map((block) => block.id), ["a", "b", "c", "d"]);
  assert.deepEqual(reorderBlocks(blocks, -1, 2), blocks);
});

test("moveBlockBy keeps keyboard reordering within bounds", () => {
  const blocks = [{ id: "a" }, { id: "b" }, { id: "c" }];
  assert.deepEqual(moveBlockBy(blocks, 1, -1).map((block) => block.id), ["b", "a", "c"]);
  assert.deepEqual(moveBlockBy(blocks, 0, -1).map((block) => block.id), ["a", "b", "c"]);
  assert.deepEqual(moveBlockBy(blocks, 2, 1).map((block) => block.id), ["a", "b", "c"]);
});

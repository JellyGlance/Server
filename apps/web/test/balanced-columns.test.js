import test from "node:test";
import assert from "node:assert/strict";
import { balancedColumns } from "../src/lib/balanced-columns.js";

const tile = 260;
const gap = 12;
const widthFor = (cols) => cols * tile + (cols - 1) * gap;

test("everything fits on one row", () => {
  assert.deepEqual(balancedColumns(6, widthFor(6), tile, gap), { columns: 6, scroll: false });
});

test("rows balance instead of leaving one tile behind", () => {
  assert.deepEqual(balancedColumns(6, widthFor(5), tile, gap), { columns: 3, scroll: false });
  assert.deepEqual(balancedColumns(7, widthFor(6), tile, gap), { columns: 4, scroll: false });
  assert.deepEqual(balancedColumns(7, widthFor(4), tile, gap), { columns: 4, scroll: false });
  assert.deepEqual(balancedColumns(5, widthFor(3), tile, gap), { columns: 3, scroll: false });
});

test("scrolls when every grid would orphan a tile", () => {
  assert.deepEqual(balancedColumns(7, widthFor(3), tile, gap), { columns: 3, scroll: true });
});

test("narrow screens stack in one column", () => {
  assert.deepEqual(balancedColumns(7, 320, tile, gap), { columns: 1, scroll: false });
  assert.deepEqual(balancedColumns(0, 1000, tile, gap), { columns: 1, scroll: false });
});

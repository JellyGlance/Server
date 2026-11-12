import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { discoverSectionFromSearch, scrollEdges, scrollStep } from "../src/pages/requests/discover-grid.js";

describe("scrollEdges", () => {
  it("shows no arrows when everything fits", () => {
    assert.deepEqual(scrollEdges(0, 800, 800), { canPrev: false, canNext: false });
    assert.deepEqual(scrollEdges(0, 800, 800.8), { canPrev: false, canNext: false });
  });

  it("hides previous at the start and next at the end", () => {
    assert.deepEqual(scrollEdges(0, 800, 2000), { canPrev: false, canNext: true });
    assert.deepEqual(scrollEdges(500, 800, 2000), { canPrev: true, canNext: true });
    assert.deepEqual(scrollEdges(1200, 800, 2000), { canPrev: true, canNext: false });
    assert.deepEqual(scrollEdges(1199.5, 800, 2000), { canPrev: true, canNext: false });
  });
});

describe("scrollStep", () => {
  it("moves a whole number of tiles", () => {
    assert.equal(scrollStep(1000, 160, 12), 5 * 172);
    assert.equal(scrollStep(331, 140, 10), 2 * 150);
  });

  it("moves at least one tile and never NaN", () => {
    assert.equal(scrollStep(100, 160, 12), 172);
    assert.equal(scrollStep(0, 160, 12), 0);
    assert.equal(scrollStep(800, 0, 0), 0);
  });
});

describe("discoverSectionFromSearch", () => {
  it("reads the section and chip", () => {
    assert.deepEqual(discoverSectionFromSearch("?tab=discover&section=trending"), { section: "trending", chip: "" });
    assert.deepEqual(discoverSectionFromSearch("?tab=discover&section=movie-genres&chip=28"), { section: "movie-genres", chip: "28" });
  });

  it("drops anything that isn't a plain slug or number", () => {
    assert.deepEqual(discoverSectionFromSearch("?section=%3Cscript%3E&chip=abc"), { section: "", chip: "" });
    assert.deepEqual(discoverSectionFromSearch(""), { section: "", chip: "" });
  });
});

import test from "node:test";
import assert from "node:assert/strict";
import { autoLook, easterSunday, resolveLook, BLOBBO_LOOKS, lookAssets } from "../src/lib/blobbo-looks.js";

const at = (y, m, d) => new Date(y, m - 1, d, 12);

test("roster is the locked 20 looks, no rainy", () => {
  assert.equal(BLOBBO_LOOKS.length, 20);
  assert.ok(!BLOBBO_LOOKS.some((l) => l.id === "rainy"));
});

test("calendar picks seasonal looks", () => {
  assert.equal(autoLook(at(2026, 10, 31)), "halloween");
  assert.equal(autoLook(at(2026, 10, 5)), "harvest");
  assert.equal(autoLook(at(2026, 12, 10)), "winter");
  assert.equal(autoLook(at(2026, 12, 31)), "newyear");
  assert.equal(autoLook(at(2027, 1, 1)), "newyear");
  assert.equal(autoLook(at(2027, 1, 15)), "cozy");
  assert.equal(autoLook(at(2027, 2, 14)), "hearts");
  assert.equal(autoLook(at(2027, 3, 17)), "stpatricks");
  assert.equal(autoLook(at(2027, 6, 26)), "pride");
  assert.equal(autoLook(at(2027, 7, 20)), "summer");
  assert.equal(autoLook(at(2026, 11, 1)), "base");
});

test("easter window follows Easter Sunday", () => {
  assert.deepEqual(easterSunday(2027), [3, 28]);
  assert.equal(autoLook(at(2027, 3, 28)), "easter");
  assert.equal(autoLook(at(2027, 3, 21)), "easter");
  assert.equal(autoLook(at(2027, 3, 30)), "base");
});

test("a picked look wins; clearing returns to auto; seasonal off means classic", () => {
  assert.deepEqual(resolveLook({ look: "wizard" }, at(2026, 10, 31)), { id: "wizard", source: "picked" });
  assert.deepEqual(resolveLook({ look: null }, at(2026, 10, 31)), { id: "halloween", source: "auto" });
  assert.deepEqual(resolveLook({ look: "rainy" }, at(2026, 10, 31)), { id: "halloween", source: "auto" });
  assert.deepEqual(resolveLook({ seasonal: false }, at(2026, 10, 31)), { id: "base", source: "auto" });
});

test("assets point at looks folder", () => {
  assert.equal(lookAssets("chef").idle, "/blobbo/looks/chef-idle.webp");
  assert.equal(lookAssets("chef").svg, "/blobbo/looks/chef.svg");
});

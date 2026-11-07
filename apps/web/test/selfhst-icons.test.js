import test from "node:test";
import assert from "node:assert/strict";
import { selfhstIconUrl } from "../src/lib/selfhst-icons.js";

test("cleanuparr and unpackerr use the webp logos", () => {
  assert.equal(selfhstIconUrl("cleanuparr"), "https://cdn.jsdelivr.net/gh/selfhst/icons/webp/cleanuparr.webp");
  assert.equal(selfhstIconUrl("unpackerr"), "https://cdn.jsdelivr.net/gh/selfhst/icons/webp/unpackerr.webp");
});

test("other apps keep the svg logos", () => {
  assert.equal(selfhstIconUrl("sonarr"), "https://cdn.jsdelivr.net/gh/selfhst/icons/svg/sonarr.svg");
});

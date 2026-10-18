const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { buildAppManifest } = require("../utils/app-manifest");

const WEB_PUBLIC = path.join(__dirname, "../../web/public");

function loadWorker(scope = "https://glance.example.test/") {
  const listeners = {};
  const sandbox = {
    self: { registration: { scope }, addEventListener: (name, fn) => (listeners[name] = fn) },
    URL,
    module: { exports: {} },
    caches: {},
  };
  vm.runInNewContext(fs.readFileSync(path.join(WEB_PUBLIC, "sw.js"), "utf8"), sandbox);
  return { ...sandbox.module.exports, listeners };
}

const request = (url, init = {}) => ({ url, method: init.method || "GET", mode: init.mode || "cors", headers: new Headers(init.headers || {}) });

test("manifest keeps one id for every start page and lists separate maskable icons", () => {
  for (const base of ["", "/glance"]) {
    const ops = buildAppManifest("/", base);
    const viewer = buildAppManifest("/me", base);
    assert.equal(ops.id, `${base}/`);
    assert.equal(viewer.id, `${base}/`);
    assert.equal(ops.start_url, `${base}/`);
    assert.equal(viewer.start_url, `${base}/me`);
    assert.equal(ops.theme_color, "#0b0d12");
    assert.equal(ops.background_color, "#0b0d12");
    const maskable = ops.icons.filter((icon) => icon.purpose === "maskable").map((icon) => icon.src);
    assert.deepEqual(maskable, [`${base}/maskable-192.png`, `${base}/maskable-512.png`]);
    assert.ok(ops.icons.every((icon) => !/ /.test(icon.purpose)), "no combined 'any maskable' purpose");
  }
  assert.equal(buildAppManifest("/anything-else").start_url, "/");
});

test("every manifest icon exists in public/, and the stale manifest.json is gone", () => {
  for (const icon of buildAppManifest("/").icons) assert.ok(fs.existsSync(path.join(WEB_PUBLIC, icon.src)), icon.src);
  assert.equal(fs.existsSync(path.join(WEB_PUBLIC, "manifest.json")), false);
});

test("service worker caches hashed build assets and icons only", () => {
  const { isCacheableAsset } = loadWorker();
  for (const url of [
    "https://glance.example.test/assets/index-3f9a1c.js",
    "https://glance.example.test/assets/index-3f9a1c.css",
    "https://glance.example.test/assets/Raleway-a1b2.woff2",
    "https://glance.example.test/icon-192.png",
    "https://glance.example.test/maskable-512.png",
    "https://glance.example.test/favicon.svg",
    "https://glance.example.test/brand/project-logo.png",
  ]) {
    assert.equal(isCacheableAsset(request(url)), true, url);
  }
});

test("service worker never caches API, auth or other dynamic responses", () => {
  const { isCacheableAsset } = loadWorker();
  for (const url of [
    "https://glance.example.test/api/getconfig",
    "https://glance.example.test/api/assets/logo.png",
    "https://glance.example.test/auth/login",
    "https://glance.example.test/auth/oidc/callback?code=abc",
    "https://glance.example.test/proxy/Items/Images/Primary?id=1",
    "https://glance.example.test/proxy/Items/Images/Primary.png",
    "https://glance.example.test/stats/getLibraryOverview",
    "https://glance.example.test/socket.io/?EIO=4",
    "https://glance.example.test/alerts-data/settings",
    "https://glance.example.test/env.js",
    "https://glance.example.test/app.webmanifest",
    "https://glance.example.test/sw.js",
    "https://glance.example.test/",
    "https://glance.example.test/settings",
    "https://glance.example.test/locales/en-GB/translation.json",
    "https://glance.example.test/assets/index.js?token=1",
    "https://other.example.test/assets/index-3f9a1c.js",
  ]) {
    assert.equal(isCacheableAsset(request(url)), false, url);
  }
  assert.equal(isCacheableAsset(request("https://glance.example.test/assets/a.js", { method: "POST" })), false);
  assert.equal(isCacheableAsset(request("https://glance.example.test/assets/a.js", { headers: { Authorization: "Bearer x" } })), false);
});

test("service worker respects a base path", () => {
  const { isCacheableAsset } = loadWorker("https://home.example.test/glance/");
  assert.equal(isCacheableAsset(request("https://home.example.test/glance/assets/app-1.js")), true);
  assert.equal(isCacheableAsset(request("https://home.example.test/glance/api/getconfig")), false);
  assert.equal(isCacheableAsset(request("https://home.example.test/glance/auth/login")), false);
});

test("only plain static responses are stored", () => {
  const { isStorableResponse } = loadWorker();
  const response = (headers, init = {}) => ({ ok: init.ok ?? true, type: init.type || "basic", headers: new Headers(headers) });
  assert.equal(isStorableResponse(response({ "content-type": "text/javascript" })), true);
  assert.equal(isStorableResponse(response({ "content-type": "text/javascript", "cache-control": "no-store" })), false);
  assert.equal(isStorableResponse(response({ "content-type": "application/json" })), false);
  assert.equal(isStorableResponse(response({ "content-type": "text/html" })), false);
  assert.equal(isStorableResponse(response({ "content-type": "image/png", "set-cookie": "a=b" })), false);
  assert.equal(isStorableResponse(response({ "content-type": "image/png" }, { type: "opaque" })), false);
  assert.equal(isStorableResponse(response({ "content-type": "image/png" }, { ok: false })), false);
});

test("navigation requests bypass the asset cache", () => {
  const { listeners } = loadWorker();
  let responded = false;
  listeners.fetch({ request: request("https://glance.example.test/api/getconfig"), respondWith: () => (responded = true) });
  assert.equal(responded, false);
});

const test = require("node:test");
const assert = require("node:assert/strict");
const { axios } = require("../classes/axios");
const db = require("../db");
const JellyfinAPI = require("../classes/jellyfin-api");
const EmbyAPI = require("../classes/emby-api");
const { stripTrailingSlashes } = require("../utils/security");

// The API classes poll for config on a 5s interval from their constructor;
// unref that timer so the test process can exit.
function make(Cls) {
  const original = global.setInterval;
  global.setInterval = (...args) => original(...args).unref();
  try {
    return new Cls();
  } finally {
    global.setInterval = original;
  }
}

async function withAxiosGet(fn) {
  const seen = [];
  const original = axios.get;
  axios.get = async (url) => {
    seen.push(url);
    return { status: 200, data: [] };
  };
  try {
    await fn();
  } finally {
    axios.get = original;
  }
  return seen;
}

test("stripTrailingSlashes removes only trailing slashes", () => {
  assert.equal(stripTrailingSlashes("http://h:8096/"), "http://h:8096");
  assert.equal(stripTrailingSlashes("http://h:8096/jellyfin//"), "http://h:8096/jellyfin");
  assert.equal(stripTrailingSlashes("http://h:8096/jellyfin"), "http://h:8096/jellyfin");
});

test("Jellyfin validateSettings saves a bare address without a trailing slash", async () => {
  let result;
  const seen = await withAxiosGet(async () => {
    result = await make(JellyfinAPI).validateSettings("192.168.1.10:8096", "key");
  });
  assert.equal(result.cleanedUrl, "http://192.168.1.10:8096");
  assert.deepEqual(seen, ["http://192.168.1.10:8096/system/configuration"]);
});

test("Jellyfin validateSettings keeps subpaths and drops their trailing slash", async () => {
  let result;
  await withAxiosGet(async () => {
    result = await make(JellyfinAPI).validateSettings("http://h:8096/jellyfin/", "key");
  });
  assert.equal(result.cleanedUrl, "http://h:8096/jellyfin");
});

test("Emby validateSettings saves the address without a trailing slash", async () => {
  let result;
  await withAxiosGet(async () => {
    result = await make(EmbyAPI).validateSettings("http://h:8096/", "key");
  });
  assert.equal(result.cleanedUrl, "http://h:8096/emby");
});

async function loadConfigWithHost(host, envHost) {
  const originalQuery = db.query;
  const originalEnv = process.env.JF_HOST;
  delete require.cache[require.resolve("../classes/config")];
  const Config = require("../classes/config");
  db.query = async () => ({
    rows: [{ ID: 1, JF_HOST: host, JF_API_KEY: "key", APP_USER: "u", APP_PASSWORD: "p", REQUIRE_LOGIN: true, settings: {} }],
  });
  if (envHost === undefined) delete process.env.JF_HOST;
  else process.env.JF_HOST = envHost;
  try {
    return await new Config().getConfig();
  } finally {
    db.query = originalQuery;
    if (originalEnv === undefined) delete process.env.JF_HOST;
    else process.env.JF_HOST = originalEnv;
  }
}

test("config read repairs a saved host with a trailing slash", async () => {
  const config = await loadConfigWithHost("http://h:8096/");
  assert.equal(config.JF_HOST, "http://h:8096");
});

test("config read repairs a JF_HOST env var with a trailing slash and keeps subpaths", async () => {
  const config = await loadConfigWithHost("http://ignored:8096", "http://h:8096/jellyfin/");
  assert.equal(config.JF_HOST, "http://h:8096/jellyfin");
});

test("getUsers calls /Users without a double slash", async () => {
  for (const [host, expected] of [
    ["http://h:8096", "http://h:8096/Users"],
    ["http://h:8096/jellyfin", "http://h:8096/jellyfin/Users"],
  ]) {
    const api = make(JellyfinAPI);
    api.config = { JF_HOST: host, JF_API_KEY: "key" };
    api.configReady = true;
    const seen = await withAxiosGet(() => api.getUsers());
    assert.deepEqual(seen, [expected]);
  }
});

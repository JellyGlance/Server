const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

// Stub the shared axios client before server-type lazily requires it.
const responses = new Map();
const axiosPath = require.resolve(path.join(__dirname, "..", "classes", "axios"));
require.cache[axiosPath] = {
  id: axiosPath,
  filename: axiosPath,
  loaded: true,
  exports: {
    axios: {
      async get(url) {
        for (const [suffix, data] of responses) if (url.endsWith(suffix)) return { data };
        throw new Error(`no stub for ${url}`);
      },
      // safeHttpGet (used by detectServerType) calls axios.request with baseURL + path.
      async request(config) {
        return this.get(`${config.baseURL || ""}${config.url}`);
      },
    },
  },
};

const serverType = require("../classes/server-type");

function withEnv(value, fn) {
  const previous = process.env.IS_EMBY_API;
  if (value === undefined) delete process.env.IS_EMBY_API;
  else process.env.IS_EMBY_API = value;
  try {
    return fn();
  } finally {
    if (previous === undefined) delete process.env.IS_EMBY_API;
    else process.env.IS_EMBY_API = previous;
  }
}

test("IS_EMBY_API overrides the saved setting", () => {
  withEnv("true", () => assert.equal(serverType.resolveServerType({ ServerType: "jellyfin" }), "emby"));
  withEnv("false", () => assert.equal(serverType.resolveServerType({ ServerType: "emby" }), "jellyfin"));
  withEnv(undefined, () => {
    assert.equal(serverType.resolveServerType({ ServerType: "emby" }), "emby");
    assert.equal(serverType.resolveServerType({ ServerType: "plex" }), "jellyfin");
    assert.equal(serverType.resolveServerType(undefined), "jellyfin");
  });
});

test("auth headers work for both servers", () => {
  const headers = serverType.mediaServerAuthHeaders("abc");
  assert.equal(headers.Authorization, 'MediaBrowser Token="abc"');
  assert.equal(headers["X-Emby-Token"], "abc");
});

test("detectServerType reads the product name", async () => {
  responses.clear();
  responses.set("/System/Info/Public", { ProductName: "Jellyfin Server", Version: "10.11.0", Id: "x" });
  assert.equal(await serverType.detectServerType("http://media.local:8096/"), "jellyfin");

  responses.clear();
  responses.set("/System/Info/Public", { ProductName: "Emby Server", Version: "4.9.0", Id: "y" });
  assert.equal(await serverType.detectServerType("media.local:8096"), "emby");
});

test("detectServerType falls back to the /emby prefix and old Emby builds", async () => {
  responses.clear();
  responses.set("/emby/System/Info/Public", { Version: "4.7.0", Id: "z" });
  assert.equal(await serverType.detectServerType("http://media.local:8096"), "emby");

  responses.clear();
  assert.equal(await serverType.detectServerType("http://nothing.local"), null);
  assert.equal(await serverType.detectServerType(""), null);
});

test("chooseServerType prefers env, then the request, then detection", async () => {
  responses.clear();
  responses.set("/System/Info/Public", { ProductName: "Emby Server", Version: "4.9.0", Id: "y" });
  await withEnv(undefined, async () => {
    assert.equal(await serverType.chooseServerType("jellyfin", "http://media.local"), "jellyfin");
    assert.equal(await serverType.chooseServerType(undefined, "http://media.local"), "emby");
  });
  await withEnv("false", async () => {
    assert.equal(await serverType.chooseServerType("emby", "http://media.local"), "jellyfin");
  });
});

test("withServerType restores the active type even when validation throws", async () => {
  serverType.setActiveServerType("jellyfin");
  const seen = await serverType.withServerType("emby", () => serverType.getActiveServerType());
  assert.equal(seen, "emby");
  assert.equal(serverType.getActiveServerType(), "jellyfin");
  await assert.rejects(serverType.withServerType("emby", async () => {
    throw new Error("bad key");
  }));
  assert.equal(serverType.getActiveServerType(), "jellyfin");
});

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const path = require("node:path");
const { axios } = require("../classes/axios");
const { classifyAddress, isAddressAllowed, assertSafeDestination, guardedLookup } = require("../utils/outbound-guard");

test("classifyAddress sorts addresses into ranges", () => {
  assert.equal(classifyAddress("169.254.169.254"), "blocked");
  assert.equal(classifyAddress("0.0.0.0"), "blocked");
  assert.equal(classifyAddress("224.0.0.1"), "blocked");
  assert.equal(classifyAddress("127.0.0.1"), "loopback");
  assert.equal(classifyAddress("::1"), "loopback");
  assert.equal(classifyAddress("::ffff:169.254.169.254"), "blocked");
  assert.equal(classifyAddress("::ffff:a9fe:a9fe"), "blocked");
  assert.equal(classifyAddress("fe80::1"), "blocked");
  assert.equal(classifyAddress("192.168.1.10"), "private");
  assert.equal(classifyAddress("10.0.0.5"), "private");
  assert.equal(classifyAddress("172.20.0.3"), "private");
  assert.equal(classifyAddress("100.100.1.1"), "private");
  assert.equal(classifyAddress("fd12:3456::1"), "private");
  assert.equal(classifyAddress("8.8.8.8"), "public");
  assert.equal(classifyAddress("not-an-ip"), "blocked");
});

test("private LAN is only allowed when the caller opts in; loopback needs the env flag", () => {
  delete process.env.JS_ALLOW_LOOPBACK_MEDIA_SERVER;
  assert.equal(isAddressAllowed("192.168.1.10"), false);
  assert.equal(isAddressAllowed("192.168.1.10", { allowPrivate: true }), true);
  assert.equal(isAddressAllowed("127.0.0.1", { allowPrivate: true }), false);
  assert.equal(isAddressAllowed("169.254.169.254", { allowPrivate: true }), false);
  process.env.JS_ALLOW_LOOPBACK_MEDIA_SERVER = "true";
  try {
    assert.equal(isAddressAllowed("127.0.0.1", { allowPrivate: true }), true);
    assert.equal(isAddressAllowed("127.0.0.1"), false);
  } finally {
    delete process.env.JS_ALLOW_LOOPBACK_MEDIA_SERVER;
  }
});

test("assertSafeDestination checks resolved addresses, not just the hostname", async () => {
  await assert.rejects(assertSafeDestination("http://169.254.169.254/latest/meta-data", { allowPrivate: true }), {
    code: "EBLOCKEDDESTINATION",
  });
  await assert.rejects(assertSafeDestination("http://[::ffff:a9fe:a9fe]/", { allowPrivate: true }), {
    code: "EBLOCKEDDESTINATION",
  });
  await assert.rejects(assertSafeDestination("http://localhost:8096", { allowPrivate: true }), {
    code: "EBLOCKEDDESTINATION",
  });
  await assert.rejects(assertSafeDestination("file:///etc/passwd"), { code: "EBLOCKEDDESTINATION" });
  assert.deepEqual(await assertSafeDestination("http://192.168.1.10:8096", { allowPrivate: true }), ["192.168.1.10"]);
});

test("guardedLookup refuses the connection when the name resolves to a blocked address", async () => {
  const server = http.createServer((req, res) => res.end("{}"));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address();
    await assert.rejects(
      axios.get(`http://localhost:${port}/`, { lookup: guardedLookup({ allowPrivate: true }), proxy: false }),
      (error) => error.code === "EBLOCKEDDESTINATION"
    );
  } finally {
    server.close();
  }
});

// Route-level checks with the real proxy router and a stubbed media server client.
function loadProxyRouter(calls) {
  const loaderPath = require.resolve(path.join(__dirname, "..", "classes", "api-loader"));
  const configPath = require.resolve(path.join(__dirname, "..", "classes", "config"));
  require.cache[loaderPath] = {
    id: loaderPath,
    filename: loaderPath,
    loaded: true,
    exports: {
      validateSettings: async (url, apikey, options) => {
        calls.push({ url, apikey, options });
        return { isValid: true, status: 200, cleanedUrl: url };
      },
    },
  };
  require.cache[configPath] = {
    id: configPath,
    filename: configPath,
    loaded: true,
    exports: class {
      async getConfig() {
        return {};
      }
    },
  };
  delete require.cache[require.resolve("../routes/proxy")];
  return require("../routes/proxy");
}

async function post(user, body, calls) {
  const express = require("express");
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = user;
    req.permissions = user?.permissions;
    next();
  });
  app.use("/proxy", loadProxyRouter(calls));
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/proxy/validateSettings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: response.status, text: await response.text() };
  } finally {
    server.close();
  }
}

const admin = { role: "Admin", permissions: { dashboard: true, settings: true } };
const viewer = { role: "Viewer", permissions: { dashboard: true } };

test("/proxy/validateSettings refuses dashboard-only users", async () => {
  const calls = [];
  const result = await post(viewer, { url: "http://192.168.1.10:8096", apikey: "k", serverType: "jellyfin" }, calls);
  assert.equal(result.status, 403);
  assert.equal(calls.length, 0);
});

test("/proxy/validateSettings refuses metadata and loopback targets for admins", async () => {
  delete process.env.JS_ALLOW_LOOPBACK_MEDIA_SERVER;
  for (const url of ["http://169.254.169.254", "127.0.0.1:5432", "http://localhost:3000"]) {
    const calls = [];
    const result = await post(admin, { url, apikey: "k", serverType: "jellyfin" }, calls);
    assert.equal(result.status, 400, url);
    assert.equal(calls.length, 0, url);
  }
});

test("/proxy/validateSettings allows a LAN media server and disables redirects", async () => {
  const calls = [];
  const result = await post(admin, { url: "192.168.1.10:8096", apikey: "k", serverType: "jellyfin" }, calls);
  assert.equal(result.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "http://192.168.1.10:8096");
  assert.equal(calls[0].options.maxRedirects, 0);
  assert.equal(typeof calls[0].options.lookup, "function");
});

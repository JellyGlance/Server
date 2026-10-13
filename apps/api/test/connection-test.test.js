const test = require("node:test");
const assert = require("node:assert/strict");
const { axios } = require("../classes/axios");
const { runConnectionTest, describeError } = require("../classes/connection-test");

// Fake media server: map of "path" -> response or error, recorded per call.
async function withServer(routes, fn) {
  const seen = [];
  const original = axios.request;
  axios.request = async (config) => {
    const full = `${config.baseURL}${config.url}`;
    seen.push({ url: full, headers: config.headers || {} });
    const path = config.url.split("?")[0];
    const entry = routes[path];
    if (entry instanceof Error) throw entry;
    if (!entry) {
      const error = new Error("Request failed with status code 404");
      error.response = { status: 404 };
      throw error;
    }
    return { status: 200, headers: entry.headers || { "content-type": "application/json" }, data: entry.data };
  };
  try {
    return { result: await fn(), seen };
  } finally {
    axios.request = original;
  }
}

function httpError(status) {
  const error = new Error(`Request failed with status code ${status}`);
  error.response = { status };
  return error;
}

function netError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

const healthy = {
  "/jellyfin/System/Info/Public": { data: { ProductName: "Jellyfin Server", Version: "10.10.7", ServerName: "den" } },
  "/jellyfin/Users": { data: [{ Name: "a", Policy: { IsAdministrator: true } }, { Name: "b", Policy: {} }] },
  "/jellyfin/Library/VirtualFolders": { data: [{ Name: "Movies", ItemId: "lib1" }] },
  "/jellyfin/Items/lib1/Images/Primary": { headers: { "content-type": "image/jpeg" }, data: Buffer.from([1]) },
};

test("a healthy server passes every check and keeps the subpath", async () => {
  const { result, seen } = await withServer(healthy, () =>
    runConnectionTest({ host: "http://media.lan:8096/jellyfin", apiKey: "secret-key", serverType: "jellyfin" })
  );
  assert.equal(result.overall, "pass");
  assert.equal(result.ok, true);
  assert.deepEqual(
    result.checks.map((c) => [c.id, c.status]),
    [["url", "pass"], ["server", "pass"], ["apiKey", "pass"], ["libraries", "pass"], ["image", "pass"]]
  );
  assert.deepEqual(result.checks.find((c) => c.id === "apiKey").details, { users: 2, admins: 1 });
  assert.ok(seen.every((call) => call.url.startsWith("http://media.lan:8096/jellyfin/")));
  assert.ok(seen.every((call) => !call.url.includes("//", 7)));
  // The public info call goes out without the key; the others carry it.
  assert.equal(seen[0].headers.Authorization, undefined);
  assert.match(seen[1].headers.Authorization, /secret-key/);
  assert.equal(JSON.stringify(result).includes("secret-key"), false);
});

test("a wrong API key fails the key check and skips the rest", async () => {
  const routes = { ...healthy, "/jellyfin/Users": httpError(401) };
  const { result } = await withServer(routes, () =>
    runConnectionTest({ host: "http://media.lan:8096/jellyfin", apiKey: "bad", serverType: "jellyfin" })
  );
  assert.equal(result.overall, "fail");
  const byId = Object.fromEntries(result.checks.map((c) => [c.id, c]));
  assert.equal(byId.apiKey.code, "UNAUTHORISED");
  assert.equal(byId.libraries.status, "skip");
  assert.equal(byId.image.code, "NEEDS_KEY");
});

test("an unreachable server explains why and skips the other checks", async () => {
  for (const [code, expected] of [
    ["ECONNREFUSED", "REFUSED"],
    ["ENOTFOUND", "DNS_FAILED"],
    ["ECONNABORTED", "TIMEOUT"],
    ["DEPTH_ZERO_SELF_SIGNED_CERT", "TLS_CERT"],
  ]) {
    const { result } = await withServer({ "/System/Info/Public": netError(code) }, () =>
      runConnectionTest({ host: "https://media.lan", apiKey: "k" })
    );
    const server = result.checks.find((c) => c.id === "server");
    assert.equal(server.status, "fail", code);
    assert.equal(server.code, expected, code);
    assert.equal(result.checks.find((c) => c.id === "apiKey").code, "NEEDS_SERVER");
  }
});

test("server type mismatch, no libraries and a missing URL are reported", async () => {
  const emby = {
    "/System/Info/Public": { data: { ProductName: "Emby Server", Version: "4.8", Id: "x" } },
    "/Users": { data: [] },
    "/Library/VirtualFolders": { data: [] },
  };
  const { result } = await withServer(emby, () => runConnectionTest({ host: "http://h:8096", apiKey: "k", serverType: "jellyfin" }));
  const byId = Object.fromEntries(result.checks.map((c) => [c.id, c]));
  assert.equal(byId.server.code, "TYPE_MISMATCH");
  assert.equal(byId.server.details.detected, "Emby");
  assert.equal(byId.libraries.code, "NO_LIBRARIES");
  assert.equal(byId.image.status, "skip");
  assert.equal(result.overall, "warn");

  const empty = await runConnectionTest({ host: "", apiKey: "" });
  assert.equal(empty.checks[0].code, "NO_URL");
  assert.equal(empty.ok, false);
});

test("a library without artwork is a warning, not a failure", async () => {
  const routes = { ...healthy };
  delete routes["/jellyfin/Items/lib1/Images/Primary"];
  const { result } = await withServer(routes, () => runConnectionTest({ host: "http://media.lan:8096/jellyfin", apiKey: "k" }));
  const image = result.checks.find((c) => c.id === "image");
  assert.equal(image.status, "warn");
  assert.equal(image.code, "NO_ARTWORK");
});

test("describeError maps HTTP statuses", () => {
  assert.equal(describeError(httpError(403)).code, "UNAUTHORISED");
  assert.equal(describeError(httpError(404)).code, "NOT_FOUND");
  assert.deepEqual(describeError(httpError(502)), { code: "HTTP_ERROR", status: 502 });
});

test("POST /api/jellyfin/connection-test is admin-only and uses the saved connection", async () => {
  const express = require("express");
  const { createConnectionTestHandler } = require("../classes/connection-test");
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const role = req.headers["x-test-role"];
    req.user = { role };
    req.permissions = role === "Viewer" ? { dashboard: true } : { dashboard: true, settings: true };
    next();
  });
  app.post(
    "/api/jellyfin/connection-test",
    createConnectionTestHandler(async () => ({ JF_HOST: "http://media.lan:8096/jellyfin", JF_API_KEY: "saved-key", SERVER_TYPE: "jellyfin" }))
  );
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const { port } = server.address();
  const call = (role, body) =>
    fetch(`http://127.0.0.1:${port}/api/jellyfin/connection-test`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-test-role": role },
      body: JSON.stringify(body || {}),
    });
  const originalRequest = axios.request;
  const seen = [];
  try {
    assert.equal((await call("Viewer")).status, 403);
    axios.request = async (config) => {
      seen.push(`${config.baseURL}${config.url}`);
      const entry = healthy[config.url.split("?")[0]];
      return { status: 200, headers: entry.headers || { "content-type": "application/json" }, data: entry.data };
    };
    // A URL in the body is ignored: only the saved connection is tested.
    const response = await call("Admin", { url: "http://169.254.169.254/" });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.overall, "pass");
    assert.equal(body.url, "http://media.lan:8096/jellyfin");
    assert.ok(seen.length > 0 && seen.every((url) => url.startsWith("http://media.lan:8096/jellyfin/")));
    assert.equal(JSON.stringify(body).includes("saved-key"), false);
  } finally {
    axios.request = originalRequest;
    server.close();
  }
});

const test = require("node:test");
const assert = require("node:assert/strict");
const dns = require("node:dns");
const { isBlockedProbeAddress, assertProbeUrlAllowed, probeRequestOptions, probeLookup } = require("../utils/probe-guard");
const { requireAdminSettings, isAdminSettingsPath } = require("../classes/route-guards");

test("probe guard blocks loopback, link-local, metadata and IPv4-mapped addresses", () => {
  for (const ip of ["127.0.0.1", "127.8.9.10", "0.0.0.0", "169.254.169.254", "169.254.1.1", "100.100.100.200", "::1", "::", "fe80::1", "fd00:ec2::254", "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:a9fe:a9fe", "::ffff:0.0.0.0", "192.0.0.8", "198.18.0.1", "198.19.255.1", "240.0.0.1"]) {
    assert.equal(isBlockedProbeAddress(ip), true, ip);
  }
});

test("probe guard keeps LAN private ranges and public hosts reachable", () => {
  for (const ip of ["192.168.1.20", "10.0.0.5", "172.16.4.2", "172.31.255.1", "100.64.0.1", "8.8.8.8", "fd12:3456::10", "2001:db8::1", "::ffff:10.0.0.5", "::ffff:c0a8:114"]) {
    assert.equal(isBlockedProbeAddress(ip), false, ip);
  }
});

test("assertProbeUrlAllowed rejects IP literals and names that resolve to blocked addresses", async () => {
  await assert.rejects(assertProbeUrlAllowed("http://127.0.0.1:8096/System/Info/Public"), { code: "EPROBEBLOCKED" });
  await assert.rejects(assertProbeUrlAllowed("http://[::ffff:169.254.169.254]/"), { code: "EPROBEBLOCKED" });
  await assert.rejects(assertProbeUrlAllowed("http://localhost:8096/"), { code: "EPROBEBLOCKED" });
  await assert.doesNotReject(assertProbeUrlAllowed("http://192.168.1.20:8096/"));
});

test("probeLookup refuses when any resolved address is blocked", async () => {
  const original = dns.lookup;
  dns.lookup = (host, opts, cb) => cb(null, [{ address: "192.168.1.2", family: 4 }, { address: "127.0.0.1", family: 4 }]);
  try {
    const err = await new Promise((resolve) => probeLookup("rebind.example", {}, (e) => resolve(e)));
    assert.equal(err?.code, "EPROBEBLOCKED");
    dns.lookup = (host, opts, cb) => cb(null, [{ address: "192.168.1.2", family: 4 }]);
    const addr = await new Promise((resolve) => probeLookup("lan.example", {}, (e, a) => resolve(a)));
    assert.equal(addr, "192.168.1.2");
  } finally {
    dns.lookup = original;
  }
});

test("probe requests never follow redirects and use the guarded agents", () => {
  const options = probeRequestOptions({ timeout: 5000, maxRedirects: 5 });
  assert.equal(options.maxRedirects, 0);
  assert.equal(options.timeout, 5000);
  assert.equal(typeof options.httpAgent.options.lookup, "function");
  assert.equal(typeof options.httpsAgent.options.lookup, "function");
});

function runGuard(req) {
  let status = 200;
  let nextCalled = false;
  const res = { status(code) { status = code; return this; }, json() { return this; } };
  requireAdminSettings(req, res, () => { nextCalled = true; });
  return { status, nextCalled };
}

test("/validateSettings requires the settings permission and an admin role", () => {
  assert.equal(isAdminSettingsPath("/validateSettings"), true);
  assert.equal(isAdminSettingsPath("/validatesettings"), true);
  assert.equal(isAdminSettingsPath("/setconfig"), true);
  assert.equal(isAdminSettingsPath("/setExternalUrl"), true);
  assert.equal(isAdminSettingsPath("/getconfig"), false);
  assert.deepEqual(runGuard({ user: { role: "Viewer" }, permissions: { dashboard: true } }), { status: 403, nextCalled: false });
  assert.deepEqual(runGuard({ user: { role: "Viewer" }, permissions: { dashboard: true, settings: true } }), { status: 403, nextCalled: false });
  assert.deepEqual(runGuard({ user: { role: "Admin", apiKeyScope: "widgets" }, permissions: { dashboard: true } }), { status: 403, nextCalled: false });
  assert.deepEqual(runGuard({ user: { role: "Admin" }, permissions: { settings: true } }), { status: 200, nextCalled: true });
  assert.deepEqual(runGuard({ user: { role: "Owner" }, permissions: { settings: true } }), { status: 200, nextCalled: true });
});

// detectServerType sends its requests through safeHttpGet (axios.request with a rebuilt
// baseURL + path); capture what would have been requested.
async function withCapturedRequests(reply, fn) {
  const { axios } = require("../classes/axios");
  const original = axios.request;
  const seen = [];
  axios.request = async (config) => {
    seen.push({ url: `${config.baseURL}${config.url}`, maxRedirects: config.maxRedirects, method: config.method });
    return { data: reply };
  };
  try {
    await fn(seen);
  } finally {
    axios.request = original;
  }
}

async function withLookup(addresses, fn) {
  const original = dns.promises.lookup;
  dns.promises.lookup = async () => addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));
  try {
    await fn();
  } finally {
    dns.promises.lookup = original;
  }
}

test("detectServerType in probe mode refuses loopback and sends LAN probes without redirects", async () => {
  const { detectServerType } = require("../classes/server-type");
  await withCapturedRequests({ ProductName: "Jellyfin Server" }, async (seen) => {
    assert.equal(await detectServerType("http://127.0.0.1:8096", { probe: true }), null);
    assert.equal(seen.length, 0);
    assert.equal(await detectServerType("http://192.168.1.20:8096", { probe: true }), "jellyfin");
    assert.deepEqual(seen, [{ url: "http://192.168.1.20:8096/System/Info/Public", maxRedirects: 0, method: "get" }]);
  });
});

test("detectServerType rebuilds the URL from validated parts and rejects bad input", async () => {
  const { detectServerType } = require("../classes/server-type");
  await withCapturedRequests({ ProductName: "Emby Server" }, async (seen) => {
    assert.equal(await detectServerType("ftp://192.168.1.20", { probe: true }), null);
    assert.equal(await detectServerType("file:///etc/passwd", { probe: false }), null);
    assert.equal(await detectServerType("http://user:pass@192.168.1.20:8096", { probe: true }), null);
    assert.equal(await detectServerType("http://[::ffff:127.0.0.1]:8096", { probe: true }), null);
    assert.equal(await detectServerType("http://[::ffff:7f00:1]:8096", { probe: true }), null);
    assert.equal(await detectServerType("http://169.254.169.254/latest", { probe: true }), null);
    assert.equal(await detectServerType("http://169.254.169.254/latest", { probe: false }), null);
    assert.equal(await detectServerType("http://metadata.google.internal/", { probe: false }), null);
    assert.equal(seen.length, 0);
    assert.equal(await detectServerType("HTTP://Media.LAN?x=1#frag", { probe: false }), "emby");
    assert.equal(await detectServerType("https://10.0.0.5:8920/jf/web/index.html#!/home.html", { probe: true }), "emby");
    assert.deepEqual(
      seen.map((entry) => entry.url),
      ["http://media.lan/System/Info/Public", "https://10.0.0.5:8920/jf/System/Info/Public"]
    );
  });
});

test("detectServerType in probe mode refuses names that resolve to a blocked address (rebinding)", async () => {
  const { detectServerType } = require("../classes/server-type");
  await withCapturedRequests({ ProductName: "Jellyfin Server" }, async (seen) => {
    await withLookup(["192.168.1.20", "127.0.0.1"], async () => {
      assert.equal(await detectServerType("http://rebind.example:8096", { probe: true }), null);
    });
    await withLookup(["::ffff:169.254.169.254"], async () => {
      assert.equal(await detectServerType("http://mapped.example", { probe: true }), null);
    });
    assert.equal(seen.length, 0);
    await withLookup(["203.0.113.10"], async () => {
      assert.equal(await detectServerType("https://jellyfin.example.com", { probe: true }), "jellyfin");
    });
    assert.deepEqual(seen, [{ url: "https://jellyfin.example.com/System/Info/Public", maxRedirects: 0, method: "get" }]);
  });
});

test("detectServerType allows a public media server and falls back to the /emby path", async () => {
  const { detectServerType } = require("../classes/server-type");
  const { axios } = require("../classes/axios");
  const original = axios.request;
  const seen = [];
  axios.request = async (config) => {
    seen.push(`${config.baseURL}${config.url}`);
    if (!config.url.startsWith("/emby/")) throw Object.assign(new Error("Not Found"), { response: { status: 404 } });
    return { data: { Id: "abc", Version: "4.8.0.0" } };
  };
  try {
    assert.equal(await detectServerType("http://8.8.8.8:8096", { probe: true }), "emby");
    assert.deepEqual(seen, ["http://8.8.8.8:8096/System/Info/Public", "http://8.8.8.8:8096/emby/System/Info/Public"]);
  } finally {
    axios.request = original;
  }
});

test("detectServerType probes loopback only with JS_ALLOW_LOOPBACK_MEDIA_SERVER=true", async () => {
  const { detectServerType } = require("../classes/server-type");
  const previous = process.env.JS_ALLOW_LOOPBACK_MEDIA_SERVER;
  try {
    await withCapturedRequests({ ProductName: "Jellyfin Server" }, async (seen) => {
      delete process.env.JS_ALLOW_LOOPBACK_MEDIA_SERVER;
      assert.equal(await detectServerType("http://127.0.0.1:8096", { probe: true }), null);
      assert.equal(await detectServerType("http://[::1]:8096", { probe: true }), null);
      assert.equal(seen.length, 0);
      process.env.JS_ALLOW_LOOPBACK_MEDIA_SERVER = "true";
      assert.equal(await detectServerType("http://127.0.0.1:8096", { probe: true }), "jellyfin");
      assert.equal(await detectServerType("http://[::1]:8096", { probe: true }), "jellyfin");
      assert.equal(await detectServerType("http://169.254.169.254", { probe: true }), null);
      assert.deepEqual(
        seen.map((entry) => entry.url),
        ["http://127.0.0.1:8096/System/Info/Public", "http://[::1]:8096/System/Info/Public"]
      );
    });
  } finally {
    if (previous === undefined) delete process.env.JS_ALLOW_LOOPBACK_MEDIA_SERVER;
    else process.env.JS_ALLOW_LOOPBACK_MEDIA_SERVER = previous;
  }
});

test("loopback stays blocked unless JS_ALLOW_LOOPBACK_MEDIA_SERVER=true", () => {
  const previous = process.env.JS_ALLOW_LOOPBACK_MEDIA_SERVER;
  try {
    delete process.env.JS_ALLOW_LOOPBACK_MEDIA_SERVER;
    for (const ip of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) assert.equal(isBlockedProbeAddress(ip), true, ip);
    process.env.JS_ALLOW_LOOPBACK_MEDIA_SERVER = "true";
    for (const ip of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) assert.equal(isBlockedProbeAddress(ip), false, ip);
    // The opt-in never opens metadata or link-local.
    for (const ip of ["169.254.169.254", "::ffff:169.254.169.254", "fe80::1", "0.0.0.0"]) assert.equal(isBlockedProbeAddress(ip), true, ip);
  } finally {
    if (previous === undefined) delete process.env.JS_ALLOW_LOOPBACK_MEDIA_SERVER;
    else process.env.JS_ALLOW_LOOPBACK_MEDIA_SERVER = previous;
  }
});

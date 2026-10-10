const test = require("node:test");
const assert = require("node:assert/strict");
const dns = require("node:dns");
const { isBlockedProbeAddress, assertProbeUrlAllowed, probeRequestOptions, probeLookup } = require("../utils/probe-guard");
const { requireAdminSettings, isAdminSettingsPath } = require("../classes/route-guards");

test("probe guard blocks loopback, link-local, metadata and IPv4-mapped addresses", () => {
  for (const ip of ["127.0.0.1", "127.8.9.10", "0.0.0.0", "169.254.169.254", "169.254.1.1", "100.100.100.200", "::1", "::", "fe80::1", "fd00:ec2::254", "::ffff:127.0.0.1", "::ffff:10.0.0.5", "::ffff:7f00:1"]) {
    assert.equal(isBlockedProbeAddress(ip), true, ip);
  }
});

test("probe guard keeps LAN private ranges and public hosts reachable", () => {
  for (const ip of ["192.168.1.20", "10.0.0.5", "172.16.4.2", "172.31.255.1", "100.64.0.1", "8.8.8.8", "fd12:3456::10", "2001:db8::1"]) {
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
  assert.equal(isAdminSettingsPath("/getconfig"), false);
  assert.deepEqual(runGuard({ user: { role: "Viewer" }, permissions: { dashboard: true } }), { status: 403, nextCalled: false });
  assert.deepEqual(runGuard({ user: { role: "Viewer" }, permissions: { dashboard: true, settings: true } }), { status: 403, nextCalled: false });
  assert.deepEqual(runGuard({ user: { role: "Admin", apiKeyScope: "widgets" }, permissions: { dashboard: true } }), { status: 403, nextCalled: false });
  assert.deepEqual(runGuard({ user: { role: "Admin" }, permissions: { settings: true } }), { status: 200, nextCalled: true });
  assert.deepEqual(runGuard({ user: { role: "Owner" }, permissions: { settings: true } }), { status: 200, nextCalled: true });
});

test("detectServerType in probe mode refuses loopback and sends LAN probes without redirects", async () => {
  const { detectServerType } = require("../classes/server-type");
  const { axios } = require("../classes/axios");
  const original = axios.get;
  const seen = [];
  axios.get = async (url, options) => {
    seen.push({ url, maxRedirects: options?.maxRedirects });
    return { data: { ProductName: "Jellyfin Server" } };
  };
  try {
    assert.equal(await detectServerType("http://127.0.0.1:8096", { probe: true }), null);
    assert.equal(seen.length, 0);
    assert.equal(await detectServerType("http://192.168.1.20:8096", { probe: true }), "jellyfin");
    assert.deepEqual(seen, [{ url: "http://192.168.1.20:8096/System/Info/Public", maxRedirects: 0 }]);
  } finally {
    axios.get = original;
  }
});

const test = require("node:test");
const assert = require("node:assert/strict");
const { axios } = require("../classes/axios");
const { testDownloadClient } = require("../classes/download-client");

const client = { name: "Deluge", kind: "deluge", values: { url: "http://deluge.local:8112", secret: "deluge" } };

// Fake Deluge Web UI JSON-RPC: auth.login succeeds, `methods` maps RPC method to result.
async function withDeluge(methods, fn) {
  const calls = [];
  const original = axios.request;
  axios.request = async (config) => {
    calls.push(config.data.method);
    if (config.data.method === "auth.login") return { status: 200, headers: {}, data: { result: true, error: null } };
    if (config.data.method in methods) return { status: 200, headers: {}, data: { result: methods[config.data.method], error: null } };
    return { status: 200, headers: {}, data: { result: null, error: { message: `Unknown method`, code: 2 } } };
  };
  try {
    return { result: await fn(), calls };
  } finally {
    axios.request = original;
  }
}

test("Deluge 2.x connection test uses daemon.get_version", async () => {
  const { result, calls } = await withDeluge({ "daemon.get_version": "2.2.0" }, () => testDownloadClient(client));
  assert.deepEqual(result, { ok: true, version: "2.2.0", message: "Connected to 2.2.0" });
  assert.ok(calls.includes("daemon.get_version"));
  assert.ok(!calls.includes("daemon.info"));
});

test("Deluge falls back to daemon.info when get_version is unknown", async () => {
  const { result, calls } = await withDeluge({ "daemon.info": "1.3.15" }, () => testDownloadClient(client));
  assert.equal(result.ok, true);
  assert.equal(result.version, "1.3.15");
  assert.deepEqual(calls.filter((m) => m.startsWith("daemon.")), ["daemon.get_version", "daemon.info"]);
});

test("Deluge errors other than an unknown method are reported", async () => {
  const original = axios.request;
  axios.request = async (config) =>
    config.data.method === "auth.login"
      ? { status: 200, headers: {}, data: { result: false, error: null } }
      : { status: 200, headers: {}, data: { result: "x", error: null } };
  try {
    const result = await testDownloadClient(client);
    assert.equal(result.ok, false);
  } finally {
    axios.request = original;
  }
});

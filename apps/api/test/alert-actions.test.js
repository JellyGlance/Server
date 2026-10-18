const test = require("node:test");
const assert = require("node:assert/strict");
const actions = require("../classes/alert-actions");

const alert = { ruleId: "r1", trigger: "server_down", title: "Jellyfin down", message: "No answer.", severity: "critical", at: "2026-10-18T12:00:00.000Z" };
const lan = async () => [{ address: "192.168.1.10" }];

function fakeHttp(status = 200) {
  const calls = [];
  return {
    calls,
    request: async (config) => {
      calls.push(config);
      if (status >= 400) throw Object.assign(new Error("failed"), { response: { status } });
      return { status };
    },
  };
}

test("Discord gets an embed coloured by severity", async () => {
  const http = fakeHttp(204);
  const result = await actions.sendAction({ id: "a", type: "discord", url: "https://discord.com/api/webhooks/1/abc" }, alert, { http, lookup: async () => [{ address: "162.159.135.232" }] });
  assert.deepEqual(result, { id: "a", type: "discord", ok: true, status: 204 });
  const [call] = http.calls;
  assert.equal(call.maxRedirects, 0);
  assert.equal(call.data.embeds[0].title, "Jellyfin down");
  assert.equal(call.data.embeds[0].color, 0xc90000);
});

test("Gotify posts to /message with the app token header and a priority", async () => {
  const http = fakeHttp();
  await actions.sendAction({ id: "g", type: "gotify", url: "https://gotify.lan/", token: "AppToken" }, alert, { http, lookup: lan });
  const [call] = http.calls;
  assert.equal(call.url, "https://gotify.lan/message");
  assert.equal(call.headers["X-Gotify-Key"], "AppToken");
  assert.equal(call.data.priority, 9);
});

test("generic webhooks get JSON with an optional bearer token", async () => {
  const http = fakeHttp();
  await actions.sendAction({ id: "w", type: "webhook", url: "http://hooks.lan:8080/in", token: "t0k" }, alert, { http, lookup: lan });
  const [call] = http.calls;
  assert.equal(call.headers.Authorization, "Bearer t0k");
  assert.deepEqual(Object.keys(call.data).sort(), ["at", "event", "message", "ruleId", "severity", "title", "trigger"]);
  assert.equal(call.data.event, "alert_rule");
});

test("blocked targets are refused before any request, and failures never echo the URL", async () => {
  const http = fakeHttp();
  for (const [url, lookup] of [
    ["http://127.0.0.1:9000/x", undefined],
    ["http://169.254.169.254/latest/meta-data", undefined],
    ["http://localhost/x", undefined],
    ["http://rebind.example.test/x", async () => [{ address: "10.0.0.2" }, { address: "127.0.0.1" }]],
    ["http://[::1]/x", undefined],
    ["file:///etc/passwd", undefined],
    ["https://user:pass@hooks.example.test/x", lan],
  ]) {
    const result = await actions.sendAction({ id: "x", type: "webhook", url }, alert, { http, lookup });
    assert.equal(result.ok, false, url);
    assert.ok(!String(result.error).includes("meta-data") && !String(result.error).includes("pass"), result.error);
  }
  assert.equal(http.calls.length, 0);
  const failed = await actions.sendAction({ id: "d", type: "discord", url: "https://discord.com/api/webhooks/1/SECRET" }, alert, { http: fakeHttp(404), lookup: lan });
  assert.deepEqual(failed, { id: "d", type: "discord", ok: false, error: "HTTP 404" });
});

test("missing URL or Gotify token fails cleanly", async () => {
  assert.equal((await actions.sendAction({ id: "a", type: "webhook", url: "" }, alert)).error, "No URL saved for this action");
  assert.equal((await actions.sendAction({ id: "a", type: "gotify", url: "https://g.lan" }, alert, { lookup: lan })).error, "No token saved for this action");
});

test("secrets: masked for the browser, kept when blank, encrypted when new", () => {
  const encrypt = (value) => `enc(${value})`;
  const decrypt = (value) => String(value).replace(/^enc\((.*)\)$/, "$1");
  const saved = actions.mergeActionSecrets([{ id: "a", type: "gotify", url: "https://gotify.lan", token: "tok" }], [], encrypt);
  assert.deepEqual(saved[0], { id: "a", type: "gotify", url: "enc(https://gotify.lan)", token: "enc(tok)" });

  const masked = actions.maskActions(saved, decrypt);
  assert.deepEqual(masked[0], { id: "a", type: "gotify", url: "", token: "", urlHint: "https://gotify.lan/…", hasUrl: true, hasToken: true });
  assert.ok(!JSON.stringify(masked).includes("enc(") && !JSON.stringify(masked).includes("\"tok\""));

  const kept = actions.mergeActionSecrets([{ id: "a", type: "gotify", url: "", token: "" }], saved, encrypt);
  assert.deepEqual(kept, saved);
  const replaced = actions.mergeActionSecrets([{ id: "a", type: "gotify", url: "https://new.lan", token: "" }], saved, encrypt);
  assert.equal(replaced[0].url, "enc(https://new.lan)");
  assert.equal(replaced[0].token, "enc(tok)");
  // A different action id never inherits another action's secrets.
  assert.equal(actions.mergeActionSecrets([{ id: "b", type: "gotify" }], saved, encrypt)[0].token, "");
  assert.equal(actions.normalizeActions(Array.from({ length: 9 }, () => ({}))).length, actions.MAX_ACTIONS);
});

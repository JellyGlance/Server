const test = require("node:test");
const assert = require("node:assert/strict");
const rules = require("../classes/webhook-out-rules");

const stuck = { title: "Download stuck", message: "Show.S01E01 has made no progress", alertType: "stuck_download", severity: "warning" };

test("normalizeRule fills defaults and drops bad headers", () => {
  const rule = rules.normalizeRule({ trigger: "nope", format: "??", headers: { "X-Ok": "1", "bad header": "x" }, cooldownMinutes: "9999" });
  assert.equal(rule.trigger, "download_stuck");
  assert.equal(rule.format, "json");
  assert.deepEqual(rule.headers, { "X-Ok": "1" });
  assert.equal(rule.cooldownMinutes, 1440);
  assert.equal(rule.enabled, true);
});

test("threshold alert triggers match on alert type", () => {
  assert.ok(rules.matchesTrigger("download_stuck", "threshold_alert", stuck));
  assert.ok(!rules.matchesTrigger("disk_low", "threshold_alert", stuck));
  assert.ok(rules.matchesTrigger("any_alert", "threshold_alert", stuck));
  assert.ok(rules.matchesTrigger("cleanuparr_intervention", "threshold_alert", { alertType: "cleanuparr_intervention" }));
  assert.ok(rules.matchesTrigger("playback_stopped", "playback_ended", {}));
  assert.ok(!rules.matchesTrigger("playback_started", "playback_ended", {}));
});

test("rules need a URL, must be enabled and respect the text filter", () => {
  const base = { trigger: "download_stuck", url: "https://ha.local/api/webhook/abc" };
  assert.equal(rules.rulesFor([base], "threshold_alert", stuck).length, 1);
  assert.equal(rules.rulesFor([{ ...base, url: "" }], "threshold_alert", stuck).length, 0);
  assert.equal(rules.rulesFor([{ ...base, enabled: false }], "threshold_alert", stuck).length, 0);
  assert.equal(rules.rulesFor([{ ...base, filterField: "message", filterText: "show.s01" }], "threshold_alert", stuck).length, 1);
  assert.equal(rules.rulesFor([{ ...base, filterField: "message", filterText: "movie" }], "threshold_alert", stuck).length, 0);
  const playback = { UserName: "alice", ItemName: "Dune" };
  assert.equal(rules.rulesFor([{ trigger: "playback_started", url: "https://x.test", filterField: "user", filterText: "ALICE" }], "playback_started", playback).length, 1);
});

test("renderTemplate escapes values so JSON stays valid", () => {
  const out = rules.renderTemplate('{"text":"{{title}} {{missing}}"}', { title: 'say "hi"\n' });
  assert.deepEqual(JSON.parse(out), { text: 'say "hi"\n ' });
});

test("buildRequest shapes Discord, ntfy, Home Assistant and custom bodies", () => {
  const context = rules.buildContext("threshold_alert", stuck, "download_stuck");
  const discord = rules.buildRequest(rules.normalizeRule({ format: "discord", url: "https://discord.com/api/webhooks/1/t" }), context);
  assert.equal(discord.body.embeds[0].title, "Download stuck");
  assert.equal(discord.url, "https://discord.com/api/webhooks/1/t");

  const ntfy = rules.buildRequest(rules.normalizeRule({ format: "ntfy", url: "https://ntfy.sh/my-topic" }), context);
  assert.equal(ntfy.url, "https://ntfy.sh/");
  assert.equal(ntfy.body.topic, "my-topic");
  assert.equal(ntfy.body.priority, 4);

  const ha = rules.buildRequest(rules.normalizeRule({ format: "homeassistant", url: "https://ha.local/api/webhook/x" }), context);
  assert.equal(ha.body.trigger, "download_stuck");
  assert.equal(ha.body.data, undefined);

  const custom = rules.buildRequest(rules.normalizeRule({ url: "https://x.test", bodyTemplate: '{"msg":"{{message}}","type":"{{alertType}}"}', headers: { "X-Event": "{{trigger}}" } }), context);
  assert.deepEqual(custom.body, { msg: stuck.message, type: "stuck_download" });
  assert.equal(custom.headers["X-Event"], "download_stuck");

  assert.throws(() => rules.buildRequest(rules.normalizeRule({ url: "https://x.test", bodyTemplate: "{nope" }), context), /valid JSON/);
});

test("maskUrl hides tokens in the path", () => {
  assert.equal(rules.maskUrl("https://discord.com/api/webhooks/123/secret"), "https://discord.com/…");
});

test("every trigger has a sample payload that matches it", () => {
  for (const trigger of rules.CATALOG.triggers) {
    const data = rules.sampleData(trigger.id);
    assert.ok(rules.matchesTrigger(trigger.id, data.event, data), trigger.id);
  }
});

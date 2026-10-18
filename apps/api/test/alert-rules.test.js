const test = require("node:test");
const assert = require("node:assert/strict");
const rules = require("../classes/alert-rules");

const at = (hour) => new Date(2026, 8, 30, hour, 15);

test("normalizeRules fills defaults and clamps bad input", () => {
  const [rule] = rules.normalizeRules([{ metric: "nope", op: "??", value: "-5", from: 3, to: 3, severity: "loud" }]);
  assert.equal(rule.metric, "active_streams");
  assert.equal(rule.op, "gt");
  assert.equal(rule.value, 0);
  assert.equal(rule.from, null, "a zero-length window means any time");
  assert.equal(rule.severity, "warning");
  assert.equal(rule.enabled, true);
  assert.ok(rule.id);
});

test("normalizeRules caps the number of rules", () => {
  const many = Array.from({ length: 40 }, (_, i) => ({ id: `r${i}` }));
  assert.equal(rules.normalizeRules(many).length, rules.CATALOG.maxRules);
  assert.deepEqual(rules.normalizeRules("junk"), []);
});

test("inWindow handles same-day and overnight windows", () => {
  const day = { from: 9, to: 17 };
  assert.equal(rules.inWindow(day, at(9)), true);
  assert.equal(rules.inWindow(day, at(17)), false);
  const night = { from: 23, to: 5 };
  assert.equal(rules.inWindow(night, at(23)), true);
  assert.equal(rules.inWindow(night, at(2)), true);
  assert.equal(rules.inWindow(night, at(5)), false);
  assert.equal(rules.inWindow(night, at(12)), false);
  assert.equal(rules.inWindow({ from: null, to: null }, at(12)), true);
});

test("collectMetrics reduces sessions, disks and downloads", () => {
  const sessions = [
    { UserName: "sam", NowPlayingItem: {}, PlayState: { PlayMethod: "Transcode" }, TranscodingInfo: { Bitrate: 8_000_000 } },
    { UserName: "sam", NowPlayingItem: { MediaStreams: [{ Type: "Video", BitRate: 20_000_000 }, { Type: "Audio", BitRate: 640_000 }, { Type: "Subtitle", BitRate: 99 }] }, PlayState: { PlayMethod: "DirectPlay" } },
    { UserName: "alex", NowPlayingItem: {}, PlayState: { PlayMethod: "DirectStream" } },
    { UserName: "idle" },
  ];
  const disks = [
    { path: "/media", totalSpace: 1000, freeSpace: 300 },
    { path: "/downloads", label: "Downloads", totalSpace: 1000, freeSpace: 45 },
    { path: "/broken", totalSpace: 0, freeSpace: 0 },
  ];
  const metrics = rules.collectMetrics({ sessions, disks, downloads: [1, 2, 3] });
  assert.equal(metrics.active_streams, 3);
  assert.equal(metrics.transcodes, 1);
  assert.equal(metrics.user_streams, 2);
  assert.equal(metrics.user_streams_who, "sam");
  assert.equal(metrics.bandwidth_mbps, 28.6);
  assert.equal(metrics.disk_free_percent, 4.5);
  assert.equal(metrics.disk_free_percent_who, "Downloads");
  assert.equal(metrics.download_queue, 3);
});

test("collectMetrics leaves metrics undefined when an input is missing", () => {
  const metrics = rules.collectMetrics({ sessions: undefined, disks: [], downloads: undefined });
  assert.equal(metrics.active_streams, undefined);
  assert.equal(metrics.disk_free_percent, undefined);
  assert.equal(metrics.download_queue, undefined);
});

test("evaluateRules fires only matching, enabled, in-window rules", () => {
  const list = [
    { id: "late", name: "Late-night streaming", metric: "active_streams", op: "gt", value: 0, from: 1, to: 5, severity: "info" },
    { id: "tx", metric: "transcodes", op: "gte", value: 3 },
    { id: "share", metric: "user_streams", op: "gte", value: 2 },
    { id: "off", metric: "active_streams", op: "gt", value: 0, enabled: false },
    { id: "disk", metric: "disk_free_percent", op: "lt", value: 10 },
  ];
  const metrics = { active_streams: 2, transcodes: 1, user_streams: 2, user_streams_who: "sam" };

  const night = rules.evaluateRules(list, metrics, at(2));
  assert.deepEqual(night.map((alert) => alert.key).sort(), ["rule:late", "rule:share"]);
  const late = night.find((alert) => alert.key === "rule:late");
  assert.equal(late.title, "Late-night streaming");
  assert.equal(late.severity, "info");
  assert.equal(late.alertType, "custom_rule");

  const noon = rules.evaluateRules(list, metrics, at(12));
  assert.deepEqual(noon.map((alert) => alert.key), ["rule:share"]);
  assert.match(noon[0].message, /\(sam\)/);
});

test("neededInputs only asks for what enabled rules use", () => {
  const needs = rules.neededInputs([
    { metric: "transcodes" },
    { metric: "download_queue", enabled: false },
    { metric: "disk_free_percent" },
  ]);
  assert.deepEqual([...needs].sort(), ["disks", "sessions"]);
});

test("event triggers normalise with cooldowns and keep legacy rules on a daily repeat", () => {
  const [legacy, eventRule, bad] = rules.normalizeRules([
    { id: "old", metric: "transcodes", op: "gt", value: 2 },
    { id: "new", trigger: "new_items", value: 3, cooldownMinutes: "30" },
    { id: "bad", trigger: "nope", cooldownMinutes: 999999 },
  ]);
  assert.equal(legacy.trigger, "metric");
  assert.equal(legacy.cooldownMinutes, 1440);
  assert.equal(eventRule.trigger, "new_items");
  assert.equal(eventRule.cooldownMinutes, 30);
  assert.equal(bad.trigger, "metric");
  assert.equal(bad.cooldownMinutes, 10080);
  assert.deepEqual(legacy.actions, []);
});

test("event rules fire only when their event happened", () => {
  const list = [
    { id: "u", trigger: "new_user", severity: "info" },
    { id: "d", trigger: "server_down", severity: "critical" },
    { id: "up", trigger: "server_up" },
    { id: "i", trigger: "new_items", value: 3 },
    { id: "dev", trigger: "new_device" },
  ];
  assert.deepEqual(rules.evaluateRules(list, {}, at(12), {}), []);
  const alerts = rules.evaluateRules(list, {}, at(12), {
    newUsers: ["alice", "bob"],
    serverWentDown: true,
    serverError: "ECONNREFUSED",
    newItems: { count: 4, names: ["Dune", "Alien"] },
    newDevices: ["alice on Roku"],
  });
  assert.deepEqual(alerts.map((alert) => alert.ruleId), ["u", "d", "i", "dev"]);
  assert.match(alerts[0].message, /alice, bob/);
  assert.match(alerts[1].message, /ECONNREFUSED/);
  assert.equal(alerts[1].severity, "critical");
  assert.match(alerts[2].message, /4 new library items: Dune, Alien/);
  assert.equal(rules.evaluateRules([{ id: "i", trigger: "new_items", value: 5 }], {}, at(12), { newItems: { count: 4 } }).length, 0);
  assert.equal(rules.evaluateRules([{ id: "up", trigger: "server_up" }], {}, at(12), { serverCameUp: true }).length, 1);
});

test("event rules respect enable and time windows", () => {
  const events = { newUsers: ["carol"] };
  assert.equal(rules.evaluateRules([{ trigger: "new_user", enabled: false }], {}, at(12), events).length, 0);
  assert.equal(rules.evaluateRules([{ trigger: "new_user", from: 1, to: 5 }], {}, at(12), events).length, 0);
  assert.equal(rules.evaluateRules([{ trigger: "new_user", from: 1, to: 5 }], {}, at(2), events).length, 1);
});

test("cooldown blocks a rule until it has elapsed", () => {
  const [alert] = rules.evaluateRules([{ id: "t", metric: "transcodes", op: "gt", value: 1, cooldownMinutes: 30 }], { transcodes: 3 }, at(12));
  assert.equal(alert.cooldownMs, 30 * 60000);
  const now = Date.now();
  assert.equal(rules.cooledDown(alert, undefined, now), true);
  assert.equal(rules.cooledDown(alert, now - 10 * 60000, now), false);
  assert.equal(rules.cooledDown(alert, now - 31 * 60000, now), true);
  assert.equal(rules.cooledDown({ cooldownMs: 0 }, now, now), true);
});

test("neededInputs covers event triggers", () => {
  const needs = rules.neededInputs([{ trigger: "server_down" }, { trigger: "new_user" }, { trigger: "new_items" }, { metric: "transcodes" }, { trigger: "new_device", enabled: false }]);
  assert.deepEqual([...needs].sort(), ["items", "server", "sessions", "users"]);
});

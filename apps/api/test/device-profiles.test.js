const test = require("node:test");
const assert = require("node:assert/strict");

const originalLog = console.log;
console.log = () => {}; // db.js logs a warning when Postgres env vars are absent
const dp = require("../classes/device-profiles");
console.log = originalLog;

const tv = { device_id: "tv1", device_name: "Living Room TV", client: "Jellyfin Android TV" };
const rows = [
  { ...tv, app_version: "0.17.1", user_id: "u1", user_name: "Ana", play_method: "DirectPlay", duration: 3600, at: "2026-10-01T20:00:00Z", transcoding_info: null },
  { ...tv, app_version: "0.17.2", user_id: "u2", user_name: "Ben", play_method: "DirectStream", duration: 1800, at: "2026-10-03T20:00:00Z", transcoding_info: '{"Bitrate":8000000}' },
  { ...tv, app_version: "0.17.2", user_id: "u1", user_name: "Ana", play_method: "Transcode (v:direct a:aac)", duration: 1800, at: "2026-10-02T20:00:00Z", transcoding_info: { Bitrate: 4000000, TranscodeReasons: ["AudioCodecNotSupported"], HardwareAccelerationType: "vaapi" } },
  { device_id: "ph1", device_name: "Pixel 8", client: "Jellyfin Mobile", app_version: "2.6", user_id: "u2", user_name: "Ben", play_method: "Transcode", duration: 600, at: "2026-10-05T08:00:00Z", transcoding_info: { Bitrate: 2000000, TranscodeReasons: ["ContainerBitrateExceedsLimit", "SubtitleCodecNotSupported"] } },
  { device_id: null, device_name: "Chrome", client: "Jellyfin Web", app_version: null, user_id: "u3", user_name: "Cy", play_method: null, duration: 0, at: "2026-09-01T08:00:00Z", transcoding_info: "not json" },
];

test("play method buckets", () => {
  assert.equal(dp.playKind("DirectPlay"), "directPlay");
  assert.equal(dp.playKind("DirectStream"), "directStream");
  assert.equal(dp.playKind("Transcode (v:h264)"), "transcode");
  assert.equal(dp.playKind(null), "unknown");
});

test("device key prefers DeviceId and falls back to client + name", () => {
  assert.equal(dp.deviceKey({ device_id: "x" }), "id:x");
  assert.equal(dp.deviceKey({ client: "Web", device_name: "Chrome" }), "name:Web|Chrome");
});

test("profiles aggregate rates, weighted bitrate, apps, users and reasons", () => {
  const out = dp.summarise(rows, { sort: "plays" });
  assert.equal(out.summary.devices, 3);
  assert.equal(out.summary.plays, 5);
  const t = out.devices[0];
  assert.equal(t.name, "Living Room TV");
  assert.equal(t.plays, 3);
  assert.equal(t.directRate, 0.667);
  assert.equal(t.transcodeRate, 0.333);
  assert.equal(t.hardwareRate, 1);
  assert.equal(t.avgBitrate, 6000000); // equal-length plays at 8 and 4 Mbps
  assert.equal(t.lastSeen, "2026-10-03T20:00:00.000Z");
  assert.equal(t.apps[0].name, "Jellyfin Android TV 0.17.2");
  assert.equal(t.apps[0].plays, 2);
  assert.deepEqual(t.users.map((u) => u.name), ["Ana", "Ben"]);
  assert.equal(t.reasons[0].label, "Audio codec not supported");
  assert.ok(t.reasons[0].hint);
  assert.equal(t.verdict, "mixed");
});

test("verdicts, missing data and sorting", () => {
  const out = dp.summarise(rows, { sort: "transcode" });
  assert.equal(out.devices[0].name, "Pixel 8");
  assert.equal(out.devices[0].verdict, "struggles");
  assert.equal(out.summary.struggling, 1);
  const web = out.devices.find((d) => d.client === "Jellyfin Web");
  assert.equal(web.avgBitrate, null);
  assert.equal(web.methods.unknown, 1);
  assert.equal(web.verdict, "healthy");
  assert.equal(dp.verdictOf(0, 0), "idle");
  const recent = dp.summarise(rows);
  assert.equal(recent.devices[0].name, "Pixel 8");
  assert.deepEqual(dp.summarise([]).devices, []);
});

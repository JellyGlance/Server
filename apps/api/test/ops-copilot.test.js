const test = require("node:test");
const assert = require("node:assert/strict");

const originalLog = console.log;
console.log = () => {};
const copilot = require("../classes/ops-copilot");
console.log = originalLog;

test("routes buffering questions and pulls out title and user", () => {
  const r = copilot.routeIntent("Why is Dune buffering for Mum?");
  assert.equal(r.intent, "playback");
  assert.deepEqual(r.subjects, { user: "Mum", title: "Dune" });
});

test("routes disk questions with a size target and favourites guard", () => {
  const r = copilot.routeIntent("Free 500 GB without touching favourites");
  assert.equal(r.intent, "disk");
  assert.equal(r.targetBytes, 500 * 1024 ** 3);
  assert.equal(r.protectFavourites, true);
});

test("routes download questions and falls back to unknown", () => {
  assert.equal(copilot.routeIntent("anything stuck in qbittorrent?").intent, "downloads");
  assert.equal(copilot.routeIntent("hello there").intent, "unknown");
});

test("explains a live transcode and offers an executable message step", () => {
  const sessions = [
    {
      Id: "s1",
      UserName: "Mum",
      Client: "Android TV",
      NowPlayingItem: { Name: "Dune" },
      PlayState: { PlayMethod: "Transcode" },
      TranscodingInfo: { TranscodeReasons: ["ContainerBitrateExceedsLimit"], Framerate: 18, IsVideoDirect: false },
    },
  ];
  const out = copilot.diagnosePlayback(sessions, [], { user: "Mum", title: "Dune" });
  assert.match(out.findings[0], /bitrate/);
  assert.match(out.findings[0], /below real time/);
  assert.ok(out.plans[0].steps.some((s) => s.executable && s.action.type === "session.message"));
});

test("disk plan only picks never-played titles and stays propose-only", () => {
  const GB = 1024 ** 3;
  const out = copilot.diagnoseDisk(
    [
      { Name: "Loved", Type: "Movie", Size: 80 * GB, times_played: 9 },
      { Name: "Unwatched A", Type: "Series", Size: 300 * GB, times_played: 0 },
      { Name: "Unwatched B", Type: "Movie", Size: 250 * GB, times_played: 0 },
    ],
    { targetBytes: 500 * GB, protectFavourites: true }
  );
  const steps = out.plans[0].steps;
  assert.ok(steps.every((s) => !s.executable));
  assert.ok(!steps.some((s) => /Loved/.test(s.text)));
});

test("stalled downloads get a reversible pause plan", () => {
  const out = copilot.diagnoseDownloads({ items: [{ id: "q-1", name: "Show S01", state: "stalledDL", progress: 40, down: "0 B/s", client: "qBit" }], clients: [] }, []);
  assert.match(out.findings[0], /1 stalled/);
  assert.equal(out.plans[0].steps[0].action.type, "download.pause");
});

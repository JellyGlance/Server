const test = require("node:test");
const assert = require("node:assert/strict");

const originalLog = console.log;
console.log = () => {};
const progress = require("../classes/request-progress");
console.log = originalLog;

const movieRequest = { id: "S-1", status: "Approved", mediaType: "movie", title: "Heat", externalIds: { tmdbId: 949 }, availability: { status: "Missing" } };
const tvRequest = { id: "S-2", status: "Approved", mediaType: "tv", title: "The Crown", externalIds: { tmdbId: 65494, tvdbId: 305574 }, availability: { status: "Missing" } };

test("parses *arr time left, with and without days", () => {
  assert.equal(progress.parseTimeLeft("00:12:34"), 754);
  assert.equal(progress.parseTimeLeft("1.02:03:04"), 86400 + 7384);
  assert.equal(progress.parseTimeLeft(""), null);
  assert.equal(progress.parseTimeLeft("soon"), null);
});

test("labels an ETA in minutes, hours and days", () => {
  assert.equal(progress.etaLabel(30), "< 1 min");
  assert.equal(progress.etaLabel(12 * 60), "12 min");
  assert.equal(progress.etaLabel(3600 + 5 * 60), "1 h 5 min");
  assert.equal(progress.etaLabel(2 * 86400 + 3600), "2 d 1 h");
  assert.equal(progress.etaLabel(null), "");
});

test("normalizes a Radarr queue record", () => {
  const record = progress.normalizeArrQueueRecord("Radarr", {
    size: 1000, sizeleft: 250, timeleft: "00:10:00", status: "downloading", trackedDownloadState: "downloading",
    movie: { tmdbId: 949, title: "Heat" }, downloadId: "ABCDEF", downloadClient: "qBittorrent",
  });
  assert.equal(record.progress, 75);
  assert.equal(record.etaSeconds, 600);
  assert.equal(record.state, "downloading");
  assert.equal(record.hash, "abcdef");
  assert.equal(record.mediaType, "movie");
});

test("maps *arr states to the UI vocabulary", () => {
  const state = (extra) => progress.normalizeArrQueueRecord("Sonarr", { size: 10, sizeleft: 5, ...extra }).state;
  assert.equal(state({ status: "paused" }), "paused");
  assert.equal(state({ status: "queued" }), "queued");
  assert.equal(state({ status: "completed", trackedDownloadState: "importPending" }), "importing");
  assert.equal(state({ status: "failed" }), "failed");
  assert.equal(state({ trackedDownloadState: "importBlocked" }), "failed");
  assert.equal(state({ status: "downloading", trackedDownloadStatus: "warning", statusMessages: [{ messages: ["The download is stalled with no connections"] }] }), "stalled");
});

test("matches queue records to requests by id, then by title only without ids", () => {
  assert.equal(progress.recordMatchesRequest(movieRequest, { mediaType: "movie", tmdbId: 949 }), true);
  assert.equal(progress.recordMatchesRequest(movieRequest, { mediaType: "movie", tmdbId: 1 }), false);
  assert.equal(progress.recordMatchesRequest(tvRequest, { mediaType: "tv", tvdbId: 305574 }), true);
  assert.equal(progress.recordMatchesRequest(movieRequest, { mediaType: "tv", tmdbId: 949 }), false);
  assert.equal(progress.recordMatchesRequest(movieRequest, { mediaType: "movie", title: "heat!" }), true);
  assert.equal(progress.recordMatchesRequest(movieRequest, { mediaType: "movie", title: "Heat", tmdbId: 5 }), false);
});

test("merges a season of episodes into one entry", () => {
  const entry = progress.aggregate([
    { source: "Sonarr", size: 100, sizeLeft: 50, etaSeconds: 600, state: "downloading", episode: "S01E01" },
    { source: "Sonarr", size: 100, sizeLeft: 0, etaSeconds: 1200, state: "downloading", episode: "S01E02" },
    { source: "Sonarr", size: 100, sizeLeft: 100, etaSeconds: null, state: "queued", episode: "S01E03" },
  ]);
  assert.equal(entry.progress, 50);
  assert.equal(entry.count, 3);
  assert.equal(entry.state, "queued");
  assert.deepEqual(entry.episodes, ["S01E01", "S01E02", "S01E03"]);
  assert.equal(entry.simulated, false);
  assert.equal(progress.aggregate([]), null);
});

test("builds progress for active requests only and lets qBittorrent refine state and speed", () => {
  const arrRecords = [{ source: "Radarr", mediaType: "movie", tmdbId: 949, size: 1000, sizeLeft: 500, progress: 50, etaSeconds: 300, state: "downloading", hash: "abc", client: "" }];
  const torrents = [{ hash: "abc", state: "stalledDL", progress: 50, speedBytes: 0, eta: null, client: "qBittorrent" }];
  const done = { ...movieRequest, id: "S-9", status: "Available" };
  const items = progress.buildProgress([movieRequest, done], { arrRecords, torrents });
  assert.deepEqual(Object.keys(items), ["S-1"]);
  assert.equal(items["S-1"].state, "stalled");
  assert.equal(items["S-1"].client, "qBittorrent");
  assert.equal(items["S-1"].etaLabel, "");
});

test("falls back to Seerr's own download status", () => {
  const withStatus = { ...tvRequest, downloadStatus: progress.normalizeSeerrDownloadStatus([{ size: 200, sizeLeft: 50, timeLeft: "00:05:00", status: "downloading", title: "The Crown" }]) };
  const items = progress.buildProgress([withStatus], {});
  assert.equal(items["S-2"].progress, 75);
  assert.equal(items["S-2"].etaLabel, "5 min");
  assert.equal(items["S-2"].source, "Seerr");
});

test("simulation is deterministic, labelled, bounded and moves with the clock", () => {
  const requests = Array.from({ length: 12 }, (_, i) => ({ id: `S-${i}`, status: "Approved", mediaType: i % 2 ? "tv" : "movie", availability: { status: "Missing" } }));
  const start = 1_000_000;
  const a = progress.simulateProgress(requests, start, start);
  const b = progress.simulateProgress(requests, start, start);
  const later = progress.simulateProgress(requests, start + 300_000, start);
  assert.deepEqual(a, b);
  assert.equal(Object.keys(a).length, 7);
  assert.ok(Object.values(a).every((item) => item.simulated === true));
  assert.ok(Object.values(a).every((item) => item.progress >= 0 && item.progress <= 99));
  assert.ok(Object.values(a).some((item) => item.state === "queued"));
  assert.ok(Object.values(a).some((item) => item.state === "stalled"));
  const moving = Object.keys(a).find((key) => a[key].state === "downloading");
  assert.ok(later[moving].progress !== a[moving].progress);
  const skipped = progress.simulateProgress([{ id: "x", status: "Approved", availability: { status: "Available" } }, { id: "y", status: "Pending" }], start, start);
  assert.deepEqual(skipped, {});
});

test("simulation only runs in the demo", () => {
  const before = { sessions: process.env.JG_DEMO_SESSIONS, downloads: process.env.JG_DEMO_DOWNLOADS };
  delete process.env.JG_DEMO_SESSIONS;
  assert.equal(progress.demoSimulationEnabled(), false);
  process.env.JG_DEMO_SESSIONS = "1";
  assert.equal(progress.demoSimulationEnabled(), true);
  process.env.JG_DEMO_DOWNLOADS = "0";
  assert.equal(progress.demoSimulationEnabled(), false);
  for (const [key, value] of [["JG_DEMO_SESSIONS", before.sessions], ["JG_DEMO_DOWNLOADS", before.downloads]]) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

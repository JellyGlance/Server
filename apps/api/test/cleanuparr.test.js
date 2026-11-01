const test = require("node:test");
const assert = require("node:assert/strict");
const cleanuparr = require("../classes/cleanuparr");

// Matches Cleanuparr's StatsV2Response (camelCase JSON).
const statsFixture = {
  events: { total: 42, byType: { StalledStrike: 10 }, bySeverity: { Information: 30, Warning: 9, Error: 3 } },
  strikes: { total: 17, byType: { Stalled: 9, FailedImport: 8 }, recovered: 4 },
  removals: { total: 6, byReason: { Stalled: 4, FailedImport: 2 } },
  cleaned: { total: 11, byReason: { MaxRatioReached: 11 } },
  searches: { total: 5, completed: 4, failed: 1, grabbed: 3, byReason: {} },
  jobs: { total: 20, completed: 19, failed: 1, byType: {} },
  health: {
    downloadClients: [{ id: "a", name: "qBittorrent", type: "qBittorrent", isHealthy: true, lastChecked: "2026-11-01T00:00:00Z" }],
    arrInstances: [{ id: "b", name: "Sonarr", type: "Sonarr", isHealthy: false, errorMessage: "Unauthorized" }],
  },
  timeframeHours: 168,
  generatedAt: "2026-11-01T00:00:00Z",
};

test("summarizeStats normalises the v2 stats response", () => {
  const summary = cleanuparr.summarizeStats(statsFixture);
  assert.equal(summary.strikes.total, 17);
  assert.equal(summary.removals.total, 6);
  assert.equal(summary.cleaned.total, 11);
  assert.equal(summary.events.total, 42);
  assert.equal(summary.health.healthy, false);
  assert.deepEqual(summary.health.unhealthy, [{ name: "Sonarr", type: "Sonarr", error: "Unauthorized" }]);
  // 3 Error events + 1 failed job + 1 unhealthy arr
  assert.equal(summary.needsAttention, 5);
});

test("summarizeStats tolerates PascalCase and missing sections", () => {
  const summary = cleanuparr.summarizeStats({ Strikes: { Total: 2 }, Health: { DownloadClients: [{ Name: "Deluge", IsHealthy: true }] } });
  assert.equal(summary.strikes.total, 2);
  assert.equal(summary.health.healthy, true);
  assert.equal(summary.needsAttention, 0);
});

test("classifyTitle maps Cleanuparr notification titles to event types", () => {
  const cases = [
    ["Strike received with reason: FailedImport", "FailedImportStrike"],
    ["Strike received with reason: Stalled", "StalledStrike"],
    ["Strike received with reason: DownloadingMetadata", "StalledStrike"],
    ["Strike received with reason: SlowSpeed", "SlowStrike"],
    ["Strike received with reason: SlowTime", "SlowStrike"],
    ["Strike received with reason: Errored", "ErroredStrike"],
    ["Deleting item from queue with reason: Stalled", "QueueItemDeleted"],
    ["Cleaned item from download client with reason: MaxRatioReached", "DownloadCleaned"],
    ["Stopped item in download client with reason: MaxSeedTimeReached", "DownloadStopped"],
    ["Category changed", "CategoryChanged"],
    ["Tag added", "CategoryChanged"],
    ["Search triggered", "SearchTriggered"],
    ["Download grabbed", "SearchItemGrabbed"],
    ["Imported a download the arr had blocked", "ForceImported"],
  ];
  for (const [title, expected] of cases) assert.equal(cleanuparr.classifyTitle(title).eventType, expected, title);
});

test("parseInboundPayload reads Cleanuparr's Gotify payload", () => {
  const event = cleanuparr.parseInboundPayload({
    title: "Strike received with reason: FailedImport",
    message: "Some.Show.S01E01.1080p\n\n**Strike type:** FailedImport\n\n**Strike count:** 1\n\n**Hash:** ABC123\n\n**Instance type:** Sonarr\n\n**Url:** http://sonarr:8989/",
    priority: 5,
    extras: { "client::display": { contentType: "text/markdown" } },
  });
  assert.equal(event.eventType, "FailedImportStrike");
  assert.equal(event.item, "Some.Show.S01E01.1080p");
  assert.equal(event.hash, "abc123");
  assert.equal(event.strikeCount, 1);
  assert.equal(event.instanceType, "Sonarr");
  assert.equal(event.needsIntervention, true);
});

test("parseInboundPayload reads Discord-style embeds", () => {
  const event = cleanuparr.parseInboundPayload({
    embeds: [{ title: "Strike received with reason: Stalled", description: "Movie.2024", fields: [{ name: "Strike count", value: "3" }, { name: "Hash", value: "DEF" }] }],
  });
  assert.equal(event.eventType, "StalledStrike");
  assert.equal(event.strikeCount, 3);
  assert.equal(event.needsIntervention, true);
});

test("only failed imports, errored downloads and repeated stalls need a person", () => {
  const strike = (eventType, strikeCount = 1) => cleanuparr.needsIntervention({ eventType, strikeCount, severity: "Warning" });
  assert.equal(strike("FailedImportStrike"), true);
  assert.equal(strike("ErroredStrike"), true);
  assert.equal(strike("StalledStrike", 1), false);
  assert.equal(strike("StalledStrike", cleanuparr.STALLED_INTERVENTION_STRIKES), true);
  assert.equal(strike("SlowStrike", 5), false);
  assert.equal(strike("DownloadCleaned"), false);
  assert.equal(strike("QueueItemDeleted"), false);
});

test("explicit eventType wins for custom JSON senders", () => {
  const event = cleanuparr.parseInboundPayload({ eventType: "Errored Strike", title: "Custom", data: { Hash: "X" } });
  assert.equal(event.eventType, "ErroredStrike");
  assert.equal(event.hash, "x");
});

test("annotateDownloads tags rows Cleanuparr is handling", () => {
  const items = [{ id: 1, hash: "ABC" }, { id: 2, hash: "zzz" }, { id: 3 }];
  const out = cleanuparr.annotateDownloads(items, { handled: { abc: { eventType: "StalledStrike", reason: "Stalled", at: "x" } } });
  assert.equal(out[0].cleanuparr.eventType, "StalledStrike");
  assert.equal(out[1].cleanuparr, undefined);
  assert.equal(out[2].cleanuparr, undefined);
});

test("alertFromEvent describes the problem", () => {
  const alert = cleanuparr.alertFromEvent({ eventType: "ErroredStrike", item: "Film.2025", instanceType: "Radarr", severity: "Warning" });
  assert.equal(alert.alertType, "cleanuparr_intervention");
  assert.equal(alert.severity, "critical");
  assert.match(alert.message, /Film\.2025 errored/);
});

test("tokensMatch is strict", () => {
  assert.equal(cleanuparr.tokensMatch("abc", "abc"), true);
  assert.equal(cleanuparr.tokensMatch("abc", "abd"), false);
  assert.equal(cleanuparr.tokensMatch("abc", ""), false);
  assert.equal(cleanuparr.tokensMatch("", ""), false);
});

test("fetchStats calls /api/v2/stats with X-Api-Key and respects a base path", async () => {
  const { axios } = require("../classes/axios");
  const original = axios.request;
  const seen = [];
  axios.request = async (config) => {
    seen.push(config);
    return { status: 200, data: statsFixture };
  };
  try {
    const stats = await cleanuparr.fetchStats({ values: { url: "http://cleanuparr.local:11011", basePath: "/cleanuparr/", secret: "k3y" } }, { hours: 24 });
    assert.equal(stats.strikes.total, 17);
    assert.equal(seen[0].baseURL + seen[0].url, "http://cleanuparr.local:11011/cleanuparr/api/v2/stats");
    assert.equal(seen[0].headers["X-Api-Key"], "k3y");
    assert.deepEqual(seen[0].params, { hours: 24, includeDryRun: false });
  } finally {
    axios.request = original;
  }
});

test("fetchStats reports a rejected API key", async () => {
  const { axios } = require("../classes/axios");
  const original = axios.request;
  axios.request = async () => ({ status: 401, data: {} });
  try {
    await assert.rejects(cleanuparr.fetchStats({ values: { url: "http://cleanuparr.local:11011", secret: "bad" } }), /rejected the API key/);
  } finally {
    axios.request = original;
  }
});

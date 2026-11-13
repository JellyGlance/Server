const test = require("node:test");
const assert = require("node:assert/strict");

const cleanup = require("../classes/cleanup-rules");

const now = new Date("2026-11-12T21:00:00Z");
const day = 24 * 60 * 60 * 1000;
const users = [
  { id: "u1", name: "Ada", lastActivity: "2026-11-10T00:00:00Z" },
  { id: "u2", name: "Bob", lastActivity: "2026-08-01T00:00:00Z" },
];

function movie(overrides = {}) {
  return {
    id: "m1",
    name: "Old Film",
    type: "Movie",
    size: 12 * cleanup.GB,
    rating: 5.4,
    added: "2025-01-01T00:00:00Z",
    lastPlayed: "2026-06-01T00:00:00Z",
    watchers: ["u1"],
    ...overrides,
  };
}

test("new rules are always disabled and dry-run, even if the request asks otherwise", () => {
  const rule = cleanup.normalizeRuleInput({ name: "Stale TV", libraryId: "lib1", enabled: true, dryRun: false, conditions: { unwatchedDays: 90 }, actions: { delete: true } }, { isCreate: true });
  assert.equal(rule.enabled, false);
  assert.equal(rule.dry_run, true);
  assert.equal(rule.conditions.unwatchedDays, 90);
  assert.equal(rule.actions.delete, true);
});

test("conditions are ANDed and unused checks are ignored", () => {
  const item = movie();
  const context = { now, users };
  assert.equal(cleanup.matchesConditions(item, cleanup.normalizeConditions({ unwatchedDays: 30 }), context), true);
  assert.equal(cleanup.matchesConditions(item, cleanup.normalizeConditions({ unwatchedDays: 200 }), context), false);
  assert.equal(cleanup.matchesConditions(item, cleanup.normalizeConditions({ addedDays: 30 }), context), true);
  assert.equal(cleanup.matchesConditions(item, cleanup.normalizeConditions({ sizeGb: 10 }), context), true);
  assert.equal(cleanup.matchesConditions(item, cleanup.normalizeConditions({ sizeGb: 20 }), context), false);
  assert.equal(cleanup.matchesConditions(item, cleanup.normalizeConditions({ ratingBelow: 6 }), context), true);
  assert.equal(cleanup.matchesConditions(item, cleanup.normalizeConditions({ ratingBelow: 5 }), context), false);
  assert.equal(cleanup.matchesConditions(item, cleanup.normalizeConditions({ unwatchedDays: 30, sizeGb: 20 }), context), false);
});

test("never-watched items match an unwatched-for-X-days condition", () => {
  assert.equal(
    cleanup.matchesConditions(movie({ lastPlayed: null }), cleanup.normalizeConditions({ unwatchedDays: 14 }), { now, users }),
    true
  );
});

test("watched by every user requires a play from each user", () => {
  const conditions = cleanup.normalizeConditions({ watchedBy: "all" });
  assert.equal(cleanup.matchesConditions(movie({ watchers: ["u1"] }), conditions, { now, users }), false);
  assert.equal(cleanup.matchesConditions(movie({ watchers: ["u1", "u2"] }), conditions, { now, users }), true);
});

test("watched by active users ignores accounts that have been quiet", () => {
  const conditions = cleanup.normalizeConditions({ watchedBy: "active", activeUserDays: 90 });
  assert.equal(cleanup.isActiveUser(users[0], now, 90), true);
  assert.equal(cleanup.isActiveUser(users[1], now, 90), false);
  assert.equal(cleanup.matchesConditions(movie({ watchers: ["u1"] }), conditions, { now, users }), true);
  assert.equal(cleanup.matchesConditions(movie({ watchers: [] }), conditions, { now, users }), false);
});

test("items without a rating do not match a rating-below condition", () => {
  assert.equal(cleanup.matchesConditions(movie({ rating: null }), cleanup.normalizeConditions({ ratingBelow: 6 }), { now, users }), false);
});

test("preview keeps a fixed action chain and drops excluded items", () => {
  const rule = {
    dry_run: true,
    enabled: false,
    conditions: cleanup.normalizeConditions({ unwatchedDays: 30, sizeGb: 10 }),
    actions: cleanup.normalizeActions({ tag: "leaving", leavingSoon: true, leavingSoonDays: 7, unmonitor: true, delete: true }),
  };
  const items = [
    movie({ id: "keep-me", lastPlayed: new Date(now.getTime() - 10 * day).toISOString() }),
    movie({ id: "exclude-me", name: "Skip" }),
    movie({ id: "match-me", name: "Clear this" }),
  ];
  const preview = cleanup.previewItems(items, rule, { now, users, exclusions: [{ item_id: "exclude-me" }] });
  assert.equal(preview.count, 1);
  assert.equal(preview.excludedCount, 1);
  assert.equal(preview.matches[0].id, "match-me");
  assert.equal(preview.bytes, 12 * cleanup.GB);
  assert.deepEqual(
    preview.matches[0].actions.map((step) => step.type),
    ["tag", "leavingSoon", "unmonitor", "delete"]
  );
  assert.equal(preview.matches[0].actions[1].days, 7);
  assert.equal(preview.matches[0].actions[1].collection, "Leaving soon");
});

test("a dry-run action step never calls Jellyfin or Arr clients", async () => {
  const calls = [];
  const jellyfin = { addTag: async () => calls.push("tag"), addToCollection: async () => calls.push("collection") };
  const arr = { unmonitor: async () => calls.push("unmonitor"), delete: async () => calls.push("delete") };
  const result = await cleanup.executeStep({ type: "delete", deleteFiles: true }, movie(), { jellyfin, arr, dryRun: true });
  assert.equal(result.status, "dry-run");
  assert.deepEqual(calls, []);
});

test("a live action step uses the injected clients, not a real Arr or Jellyfin", async () => {
  const calls = [];
  const item = movie();
  const jellyfin = {
    addTag: async (id, tag) => calls.push(["tag", id, tag]),
    addToCollection: async (id, name, opts) => calls.push(["collection", id, name, opts]),
  };
  const arr = {
    unmonitor: async (row) => calls.push(["unmonitor", row.id]),
    delete: async (row, opts) => calls.push(["delete", row.id, opts]),
  };
  await cleanup.executeStep({ type: "tag", tag: "leaving" }, item, { jellyfin, arr, dryRun: false });
  await cleanup.executeStep({ type: "leavingSoon", collection: "Leaving soon", days: 10 }, item, { jellyfin, arr, dryRun: false });
  await cleanup.executeStep({ type: "unmonitor", mediaType: "Movie" }, item, { jellyfin, arr, dryRun: false });
  await cleanup.executeStep({ type: "delete", deleteFiles: true }, item, { jellyfin, arr, dryRun: false });
  assert.deepEqual(calls, [
    ["tag", "m1", "leaving"],
    ["collection", "m1", "Leaving soon", { countdownDays: 10 }],
    ["unmonitor", "m1"],
    ["delete", "m1", { deleteFiles: true }],
  ]);
});

test("automationAllowed is off when JG_DISABLE_SERVER_AUTOMATION=1", () => {
  const previous = process.env.JG_DISABLE_SERVER_AUTOMATION;
  process.env.JG_DISABLE_SERVER_AUTOMATION = "1";
  assert.equal(cleanup.automationAllowed(), false);
  process.env.JG_DISABLE_SERVER_AUTOMATION = "0";
  assert.equal(cleanup.automationAllowed(), true);
  delete process.env.JG_DISABLE_SERVER_AUTOMATION;
  assert.equal(cleanup.automationAllowed(), true);
  if (previous === undefined) delete process.env.JG_DISABLE_SERVER_AUTOMATION;
  else process.env.JG_DISABLE_SERVER_AUTOMATION = previous;
});

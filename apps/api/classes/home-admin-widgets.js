// Data for the admin-only Home widgets "Collections" and "Space you could free".
// Both read from work JellyGlance already does elsewhere (auto collection
// builders, duplicate finder, cleanup rule previews) and cache the result,
// because the underlying scans are too heavy to repeat on every Home refresh.
const db = require("../db");

const COLLECTIONS_TTL_MS = 5 * 60 * 1000;
const SPACE_TTL_MS = 15 * 60 * 1000;
const caches = { collections: { at: 0, value: null, pending: null }, space: { at: 0, value: null, pending: null } };

async function cached(key, ttl, build, { force = false } = {}) {
  const entry = caches[key];
  if (entry.value && !force && Date.now() - entry.at < ttl) return entry.value;
  if (!entry.pending) {
    entry.pending = build()
      .then((value) => {
        entry.value = value;
        entry.at = Date.now();
        return value;
      })
      .finally(() => {
        entry.pending = null;
      });
  }
  return entry.pending;
}

async function latestRuns() {
  const { rows } = await db.query(
    `SELECT DISTINCT ON (builder_id) builder_id, status, item_count, message, created_at
       FROM jg_collection_runs
      WHERE preview IS NOT TRUE AND status IN ('applied', 'failed')
      ORDER BY builder_id, created_at DESC`
  );
  return new Map(rows.map((row) => [String(row.builder_id), row]));
}

async function listServerCollections() {
  const mediaServer = require("./media-server-collections");
  const data = await mediaServer.request("get", "/Items", {
    params: { IncludeItemTypes: "BoxSet", Recursive: true, Fields: "ChildCount", Limit: 1000 },
  });
  return new Map((data?.Items || []).map((item) => [String(item.Name || "").trim().toLowerCase(), item]));
}

async function buildCollections() {
  const { listBuilders } = require("./auto-collections");
  const [builders, runs] = await Promise.all([listBuilders(), latestRuns().catch(() => new Map())]);
  let serverCollections = new Map();
  let serverError = null;
  if (builders.length) {
    try {
      serverCollections = await listServerCollections();
    } catch (error) {
      serverError = `Could not read collections from the media server (${error.message})`;
    }
  }
  const collections = builders.map((builder) => {
    const run = runs.get(String(builder.id));
    const server = serverCollections.get(String(builder.name).trim().toLowerCase());
    const lastFailed = run?.status === "failed";
    return {
      id: builder.id,
      name: builder.name,
      type: builder.type,
      libraryName: builder.libraryName,
      schedule: builder.options?.schedule || "",
      applyEnabled: builder.applyEnabled && builder.previewOnly === false,
      collectionId: server?.Id || null,
      hasPoster: Boolean(server?.ImageTags?.Primary),
      size: Number.isFinite(Number(server?.ChildCount)) ? Number(server.ChildCount) : run && !lastFailed ? Number(run.item_count || 0) : null,
      lastRunAt: run?.created_at || null,
      lastStatus: run?.status || null,
      lastMessage: run?.message || "",
    };
  });
  collections.sort((a, b) => new Date(b.lastRunAt || 0) - new Date(a.lastRunAt || 0) || a.name.localeCompare(b.name));
  return { collections, serverError, checkedAt: new Date().toISOString() };
}

async function buildSpaceToFree() {
  const libraryTools = require("./library-tools");
  const cleanupRules = require("./cleanup-rules");
  const freeable = new Map();
  const add = (id, size) => {
    if (id && Number(size) > 0) freeable.set(String(id), Number(size));
  };

  let duplicates = { groups: 0, copies: 0, bytes: 0, top: [], error: null };
  try {
    const result = await libraryTools.findDuplicates();
    const extraCopies = result.groups.flatMap((group) => group.copies.filter((copy) => !copy.best));
    extraCopies.forEach((copy) => add(copy.id, copy.size));
    duplicates = {
      groups: result.totals.groups,
      copies: extraCopies.length,
      bytes: result.totals.reclaimableBytes,
      top: result.groups.slice(0, 3).map((group) => ({ name: group.name, year: group.year, copies: group.copies.length, bytes: group.reclaimableBytes })),
      error: null,
    };
  } catch (error) {
    duplicates.error = error.message;
  }

  const rules = [];
  let rulesError = null;
  try {
    for (const rule of await cleanupRules.listRules()) {
      try {
        const preview = await cleanupRules.previewRule(rule.id);
        preview.matches.forEach((item) => add(item.id, item.size));
        rules.push({ id: rule.id, name: rule.name, enabled: rule.enabled, dryRun: rule.dryRun, count: preview.count, bytes: preview.bytes, protectedCount: preview.protectedCount || 0 });
      } catch (error) {
        rules.push({ id: rule.id, name: rule.name, enabled: rule.enabled, dryRun: rule.dryRun, count: 0, bytes: 0, error: error.message });
      }
    }
  } catch (error) {
    rulesError = error.message;
  }
  rules.sort((a, b) => b.bytes - a.bytes);

  // An item can be both an extra copy and a rule match, or match several rules;
  // the total counts each file once.
  const totalBytes = [...freeable.values()].reduce((sum, size) => sum + size, 0);
  return { totalBytes, items: freeable.size, duplicates, rules, rulesError, checkedAt: new Date().toISOString() };
}

module.exports = {
  getCollectionsWidget: (options) => cached("collections", COLLECTIONS_TTL_MS, buildCollections, options),
  getSpaceToFreeWidget: (options) => cached("space", SPACE_TTL_MS, buildSpaceToFree, options),
};

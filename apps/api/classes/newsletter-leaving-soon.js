// Read-only leaving-soon digest: cleanup-rule matches plus Maintainerr
// collections when that integration is configured. Never writes to Jellyfin
// or Maintainerr, and never calls cleanup run/apply.
const db = require("../db");
const cleanup = require("./cleanup-rules");

const DAY_MS = 86400000;

function countdownDaysFrom(now, dueAt, fallbackDays) {
  if (dueAt) {
    const due = new Date(dueAt);
    if (Number.isFinite(due.getTime())) return Math.round((due.getTime() - now.getTime()) / DAY_MS);
  }
  const fallback = Number(fallbackDays);
  return Number.isFinite(fallback) ? fallback : 14;
}

function asItem(row) {
  return {
    Id: row.Id || row.id || row.mediaId || "",
    id: row.Id || row.id || row.mediaId || "",
    Name: row.Name || row.name || row.title || "",
    Type: row.Type || row.type || "",
    Library: row.Library || row.libraryName || "",
    PrimaryImageHash: row.PrimaryImageHash || row.primaryImageHash || "",
    countdownDays: row.countdownDays,
    leaveAt: row.leaveAt || null,
    source: row.source,
    ruleName: row.ruleName || row.collection || "",
  };
}

function withTimeout(promise, ms, fallback) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  return Promise.race([Promise.resolve(promise).finally(() => clearTimeout(timer)), timeout]);
}

async function loadLibraryItemsFast(libraryId) {
  const { rows } = await db.query(
    `WITH play AS (
        SELECT a."NowPlayingItemId" AS item_id,
               MAX(a."ActivityDateInserted") AS last_played,
               ARRAY_AGG(DISTINCT a."UserId") FILTER (WHERE a."UserId" IS NOT NULL) AS watchers
          FROM jf_playback_activity a
         WHERE a."NowPlayingItemId" IS NOT NULL
         GROUP BY a."NowPlayingItemId"
      )
      SELECT i."Id" AS id,
             i."Name" AS name,
             i."Type" AS type,
             i."ParentId" AS library_id,
             i."CommunityRating" AS rating,
             i."DateCreated" AS added,
             i."ProductionYear" AS year,
             i."PrimaryImageHash" AS primary_image_hash,
             COALESCE(ii."Size", ep.episode_size, 0) AS size,
             play.last_played,
             play.watchers
        FROM jf_library_items i
        LEFT JOIN jf_item_info ii ON ii."Id" = i."Id"
        LEFT JOIN play ON play.item_id = i."Id"
        LEFT JOIN LATERAL (
          SELECT SUM(im."Size") AS episode_size
            FROM jf_library_seasons s
            JOIN jf_library_episodes e ON e."SeasonId" = s."Id"
            JOIN jf_item_info im ON im."Id" = e."EpisodeId"
           WHERE i."Type" = 'Series' AND s."SeriesId" = i."Id"
        ) ep ON TRUE
       WHERE i."ParentId" = $1
         AND i.archived IS NOT TRUE
         AND i."Type" IN ('Movie', 'Series')
       ORDER BY i."Name"`,
    [libraryId]
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    type: row.type,
    libraryId: row.library_id,
    rating: row.rating,
    added: row.added,
    year: row.year,
    size: Number(row.size) || 0,
    lastPlayed: row.last_played,
    watchers: row.watchers || [],
    PrimaryImageHash: row.primary_image_hash || "",
  }));
}

async function loadUsers() {
  const { rows } = await db.query(`SELECT "Id" AS id, "Name" AS name, "LastActivityDate" AS last_activity FROM jf_users`);
  return rows.map((row) => ({ id: row.id, name: row.name, lastActivity: row.last_activity }));
}

async function listCleanupLeavingSoon({ limit = 25, now = new Date() } = {}) {
  const rules = (await cleanup.listRules().catch(() => [])).filter((rule) => rule.actions && rule.actions.leavingSoon);
  if (!rules.length) return [];
  const users = await loadUsers().catch(() => []);
  const seen = new Map();
  const libraries = new Map();
  for (const rule of rules) {
    if (!libraries.has(rule.libraryId)) {
      libraries.set(rule.libraryId, await withTimeout(loadLibraryItemsFast(rule.libraryId), 8000, []));
    }
    const items = libraries.get(rule.libraryId) || [];
    const exclusions = await cleanup.listExclusions(rule.id).catch(() => []);
    const preview = cleanup.previewItems(items, { conditions: rule.conditions, actions: rule.actions, dry_run: true, enabled: rule.enabled }, { now, users, exclusions });
    const days = rule.actions.leavingSoonDays || 14;
    for (const item of preview.matches || []) {
      const step = (item.actions || []).find((action) => action.type === "leavingSoon");
      const countdownDays = countdownDaysFrom(now, null, step?.days || days);
      const row = asItem({
        ...item,
        Id: item.id,
        Name: item.name,
        Type: item.type,
        Library: item.libraryName || rule.libraryName,
        PrimaryImageHash: item.PrimaryImageHash,
        countdownDays,
        leaveAt: new Date(now.getTime() + countdownDays * DAY_MS).toISOString(),
        source: "cleanup",
        ruleName: rule.name,
      });
      const prev = seen.get(String(row.Id));
      if (!prev || Number(row.countdownDays) < Number(prev.countdownDays)) seen.set(String(row.Id), row);
    }
  }
  return [...seen.values()].sort((a, b) => Number(a.countdownDays) - Number(b.countdownDays)).slice(0, limit);
}

function maintainerrHeaders(integration) {
  const apiKey = String(integration?.values?.secret || "").trim();
  if (!apiKey) return { Accept: "application/json" };
  const hasBearerPrefix = /^bearer\s+/i.test(apiKey);
  return {
    Accept: "application/json",
    "X-Api-Key": apiKey,
    ...(hasBearerPrefix ? { Authorization: apiKey } : { Authorization: `Bearer ${apiKey}` }),
  };
}

async function listMaintainerrLeaving({ limit = 25, now = new Date(), fetchJson } = {}) {
  const { getIntegrations } = require("./integration-store");
  const integrations = await getIntegrations().catch(() => ({ thirdParty: [] }));
  const app = (integrations.thirdParty || []).find((integration) => {
    const name = String(integration?.name || integration?.slug || "").toLowerCase();
    return integration.connected && (name === "maintainerr" || name.includes("maintainerr"));
  });
  if (!app) return { configured: false, items: [] };
  const url = String(app.values?.url || "").trim().replace(/\/+$/, "");
  if (!url) return { configured: false, items: [] };
  const get = fetchJson || (async (path) => {
    const axios = require("axios");
    const { data } = await axios.get(`${url}${path}`, { timeout: 5000, headers: maintainerrHeaders(app) });
    return data;
  });
  let payload = null;
  try {
    payload = await withTimeout(get("/api/collections/overlay-data"), 6000, null);
  } catch {
    payload = null;
  }
  if (!payload) return { configured: true, items: [] };
  const records = Array.isArray(payload) ? payload : payload.items || payload.media || payload.collections || [];
  const items = [];
  const walk = (entry, collectionName = "") => {
    if (!entry || typeof entry !== "object") return;
    const kids = entry.items || entry.media || entry.mediaItems;
    if (Array.isArray(kids)) {
      kids.forEach((child) => walk(child, entry.name || entry.title || collectionName));
      return;
    }
    const title = entry.title || entry.name || entry.mediaTitle;
    if (!title) return;
    const dueAt = entry.scheduledFor || entry.runAt || entry.executeAt || entry.nextRunAt || entry.dueAt || null;
    const countdownDays = countdownDaysFrom(now, dueAt, entry.days || entry.deleteAfterDays);
    items.push(asItem({
      id: entry.jellyfinItemId || entry.mediaId || entry.itemId || entry.id,
      Name: title,
      Type: entry.type || entry.mediaType || "",
      countdownDays,
      leaveAt: dueAt,
      source: "maintainerr",
      collection: collectionName || entry.collection || entry.collectionName || "Maintainerr",
    }));
  };
  (Array.isArray(records) ? records : []).forEach((entry) => walk(entry));
  items.sort((a, b) => Number(a.countdownDays) - Number(b.countdownDays));
  return { configured: true, items: items.slice(0, limit) };
}

async function listLeavingSoon({ limit = 25, now = new Date(), maintainerr } = {}) {
  const [cleanupItems, maintainerrResult] = await Promise.all([
    listCleanupLeavingSoon({ limit, now }),
    maintainerr && maintainerr.skip ? Promise.resolve({ configured: false, items: [] }) : listMaintainerrLeaving({ limit, now, fetchJson: maintainerr?.fetchJson }),
  ]);
  const seen = new Map();
  for (const item of [...cleanupItems, ...(maintainerrResult.items || [])]) {
    const key = String(item.Id || item.Name);
    const prev = seen.get(key);
    if (!prev || Number(item.countdownDays) < Number(prev.countdownDays)) seen.set(key, item);
  }
  return {
    items: [...seen.values()].sort((a, b) => Number(a.countdownDays) - Number(b.countdownDays)).slice(0, limit),
    maintainerrConfigured: Boolean(maintainerrResult.configured),
  };
}

module.exports = { listLeavingSoon, listCleanupLeavingSoon, listMaintainerrLeaving, countdownDaysFrom };

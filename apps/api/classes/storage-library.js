// Storage by library: how much space each library takes, the 20 largest titles, and soft
// "worth a look?" hints. Hints are only ever suggestions for a human to review; nothing here
// deletes, unmonitors or flags anything in Jellyfin or the *arr apps.

const DAY_MS = 24 * 60 * 60 * 1000;
const TOP_LIMIT = 20;
// Anything added in the last 90 days is too new to judge, so it never gets a hint.
const GRACE_DAYS = 90;
const STALE_DAYS = 730;

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function daysSince(value, nowMs) {
  if (!value) return null;
  const ms = new Date(value).getTime();
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, Math.floor((nowMs - ms) / DAY_MS));
}

function duplicateKey(item) {
  if (item.type !== "Movie" || !item.name) return null;
  return `${String(item.name).trim().toLowerCase()}|${item.year || ""}`;
}

// Same rule as the Library Health duplicates list: two or more movies with the same name and year.
function findDuplicateKeys(items) {
  const counts = new Map();
  for (const item of items || []) {
    const key = duplicateKey(item);
    if (key) counts.set(key, (counts.get(key) || 0) + 1);
  }
  return new Set([...counts].filter(([, count]) => count > 1).map(([key]) => key));
}

// Returns the hints for one title, most telling first. Each hint has a stable code plus a short label.
function hintsFor(item, { now = new Date(), duplicates = new Set() } = {}) {
  const nowMs = new Date(now).getTime();
  const addedDays = daysSince(item.added, nowMs);
  const lastDays = daysSince(item.lastPlayed, nowMs);
  const plays = toNumber(item.plays);
  const hints = [];
  const key = duplicateKey(item);
  if (key && duplicates.has(key)) hints.push({ code: "duplicate", label: "Duplicate candidate" });
  if (addedDays !== null && addedDays < GRACE_DAYS) return hints;
  if (plays === 0 && !item.lastPlayed) {
    hints.push({ code: "never_played", label: addedDays !== null ? `Never played (added ${Math.floor(addedDays / 30)} months ago)` : "Never played" });
  } else if (lastDays !== null && lastDays >= STALE_DAYS) {
    hints.push({ code: "stale", label: `Not played in ${Math.floor(lastDays / 365)}+ years` });
  }
  return hints;
}

function summariseLibraries(rows) {
  const libraries = (rows || [])
    .map((row) => ({ id: row.id, name: row.name || "Other", type: row.type || "", bytes: toNumber(row.bytes), items: toNumber(row.items), files: toNumber(row.files) }))
    .sort((a, b) => b.bytes - a.bytes || a.name.localeCompare(b.name));
  const totalBytes = libraries.reduce((sum, lib) => sum + lib.bytes, 0);
  return {
    totalBytes,
    libraries: libraries.map((lib) => ({ ...lib, share: totalBytes ? lib.bytes / totalBytes : 0 })),
  };
}

function rankLargest(items, { now = new Date(), limit = TOP_LIMIT } = {}) {
  const clean = (items || []).map((item) => ({ ...item, bytes: toNumber(item.bytes), plays: toNumber(item.plays) })).filter((item) => item.bytes > 0);
  const duplicates = findDuplicateKeys(clean);
  return clean
    .sort((a, b) => b.bytes - a.bytes || String(a.name).localeCompare(String(b.name)))
    .slice(0, limit)
    .map((item, index) => ({ rank: index + 1, ...item, hints: hintsFor(item, { now, duplicates }) }));
}

function buildStorageReport({ libraryRows, itemRows, now = new Date() }) {
  const summary = summariseLibraries(libraryRows);
  const largest = rankLargest(itemRows, { now });
  const hinted = largest.filter((item) => item.hints.length);
  return {
    generatedAt: new Date(now).toISOString(),
    ...summary,
    largest,
    hintedCount: hinted.length,
    hintedBytes: hinted.reduce((sum, item) => sum + item.bytes, 0),
    rules: { graceDays: GRACE_DAYS, staleDays: STALE_DAYS },
  };
}

// Per-title size: movies use their own file, series add up their episodes.
const TITLE_SIZES_SQL = `
  WITH sized AS (
    SELECT i."Id" AS id, COALESCE(ii."Size", 0)::bigint AS bytes, 1 AS files
      FROM jf_library_items i JOIN jf_item_info ii ON ii."Id" = i."Id"
     WHERE i."Type" <> 'Series' AND i.archived IS NOT TRUE
    UNION ALL
    SELECT e."SeriesId", COALESCE(ii."Size", 0)::bigint, 1
      FROM jf_library_episodes e
      JOIN jf_item_info ii ON ii."Id" = e."EpisodeId"
     WHERE e.archived IS NOT TRUE
  ),
  titles AS (SELECT id, SUM(bytes)::bigint AS bytes, SUM(files)::int AS files FROM sized GROUP BY id)
`;

const LIBRARY_SQL = `${TITLE_SIZES_SQL}
  SELECT l."Id" AS id, l."Name" AS name, l."CollectionType" AS type,
         COALESCE(SUM(t.bytes), 0)::bigint AS bytes, COUNT(i."Id")::int AS items, COALESCE(SUM(t.files), 0)::int AS files
    FROM jf_libraries l
    LEFT JOIN jf_library_items i ON i."ParentId" = l."Id" AND i.archived IS NOT TRUE
    LEFT JOIN titles t ON t.id = i."Id"
   WHERE l.archived IS NOT TRUE
   GROUP BY l."Id", l."Name", l."CollectionType"
`;

const LARGEST_SQL = `${TITLE_SIZES_SQL},
  top AS (
    SELECT i."Id" AS id, i."Name" AS name, i."Type" AS type, i."ProductionYear" AS year, i."DateCreated" AS added,
           i."ParentId" AS "libraryId", l."Name" AS "libraryName", t.bytes, t.files
      FROM titles t
      JOIN jf_library_items i ON i."Id" = t.id AND i.archived IS NOT TRUE
      LEFT JOIN jf_libraries l ON l."Id" = i."ParentId"
     ORDER BY t.bytes DESC LIMIT 200
  )
  SELECT top.*, COUNT(a."Id")::int AS plays, MAX(a."ActivityDateInserted") AS "lastPlayed"
    FROM top
    LEFT JOIN jf_playback_activity a ON a."NowPlayingItemId" = top.id
   GROUP BY top.id, top.name, top.type, top.year, top.added, top."libraryId", top."libraryName", top.bytes, top.files
`;

async function getStorageReport({ db, now = new Date() }) {
  const [libraryRows, itemRows] = await Promise.all([
    db.query(LIBRARY_SQL).then((r) => r.rows),
    db.query(LARGEST_SQL).then((r) => r.rows),
  ]);
  return buildStorageReport({ libraryRows, itemRows, now });
}

module.exports = { hintsFor, findDuplicateKeys, summariseLibraries, rankLargest, buildStorageReport, getStorageReport, GRACE_DAYS, STALE_DAYS, TOP_LIMIT };

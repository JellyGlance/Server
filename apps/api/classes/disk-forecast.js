// Disk-fill forecast: how fast the libraries are growing and roughly how long until the media disks fill.
// Growth comes from what was added recently (item DateCreated + file size). Free space comes from the
// Sonarr/Radarr/Lidarr disk reports. Deletions aren't visible in that history, so the growth rate is
// "added per day", which errs on the side of filling sooner.

const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOWS = [30, 90];
const MIN_HISTORY_DAYS = 14;
const MIN_ACTIVE_DAYS = 3;
// Under ~50 MB a day we call it stable rather than putting a number on it.
const STABLE_BYTES_PER_DAY = 50 * 1024 ** 2;

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

// rows: [{ day: Date|string, bytes, items, libraryId?, libraryName? }]
// Returns the bytes/day average over each window plus how much history there is.
function growthFromAdditions(rows, { now = new Date(), windows = WINDOWS, historyDays: knownHistory } = {}) {
  const nowMs = new Date(now).getTime();
  const clean = (rows || [])
    .map((row) => ({ ...row, ms: new Date(row.day).getTime(), bytes: toNumber(row.bytes), items: toNumber(row.items) }))
    .filter((row) => Number.isFinite(row.ms) && row.ms <= nowMs && row.bytes >= 0);
  const oldest = clean.reduce((min, row) => Math.min(min, row.ms), Infinity);
  const fromRows = Number.isFinite(oldest) ? Math.max(0, Math.floor((nowMs - oldest) / DAY_MS)) : 0;
  // Callers that know how old the library is pass it in; otherwise the oldest addition is all we have.
  const historyDays = knownHistory === undefined ? fromRows : Math.max(0, knownHistory);

  const byWindow = windows.map((days) => {
    const since = nowMs - days * DAY_MS;
    const inWindow = clean.filter((row) => row.ms > since);
    const bytes = inWindow.reduce((sum, row) => sum + row.bytes, 0);
    const items = inWindow.reduce((sum, row) => sum + row.items, 0);
    const activeDays = new Set(inWindow.map((row) => Math.floor(row.ms / DAY_MS))).size;
    // Don't divide by a window longer than the history we actually have.
    const span = Math.max(1, Math.min(days, historyDays));
    return { days, bytes, items, activeDays, bytesPerDay: bytes / span };
  });
  return { historyDays, windows: byWindow };
}

function roundDays(days) {
  if (days < 14) return Math.max(1, Math.round(days));
  if (days < 60) return Math.round(days / 5) * 5;
  if (days < 365) return Math.round(days / 10) * 10;
  return Math.round(days / 30) * 30;
}

// freeBytes: space left. growth: output of growthFromAdditions.
function forecastFill({ freeBytes, totalBytes, growth }) {
  const free = toNumber(freeBytes);
  const total = toNumber(totalBytes);
  const windows = growth?.windows || [];
  const usable = windows.filter((w) => w.activeDays >= MIN_ACTIVE_DAYS);
  const historyDays = growth?.historyDays || 0;

  if (historyDays >= MIN_HISTORY_DAYS && usable.length === 0 && (windows[0]?.bytesPerDay || 0) < STABLE_BYTES_PER_DAY) {
    return { status: "stable", historyDays, bytesPerDay: windows[0]?.bytesPerDay || 0, confidence: "low" };
  }
  if (historyDays < MIN_HISTORY_DAYS || usable.length === 0) {
    return { status: "need_more_data", historyDays, reason: `Needs at least ${MIN_HISTORY_DAYS} days of additions on at least ${MIN_ACTIVE_DAYS} different days.` };
  }

  // Prefer the recent window but show the spread between windows as the range.
  const rates = usable.map((w) => w.bytesPerDay);
  const rate = usable[0].bytesPerDay;
  const low = Math.min(...rates);
  const high = Math.max(...rates);
  const confidence = historyDays >= 60 && usable.length >= 2 && high <= low * 2.5 ? "medium" : "low";

  if (rate < STABLE_BYTES_PER_DAY) {
    return { status: "stable", historyDays, bytesPerDay: rate, confidence };
  }
  if (!total || free <= 0) {
    return { status: free <= 0 && total ? "full" : "no_disk", historyDays, bytesPerDay: rate, confidence };
  }

  const days = free / rate;
  const fastest = free / high;
  const slowest = low >= STABLE_BYTES_PER_DAY ? free / low : null;
  return {
    status: "filling",
    historyDays,
    bytesPerDay: rate,
    daysUntilFull: roundDays(days),
    rangeDays: [roundDays(fastest), slowest === null ? null : roundDays(slowest)],
    beyondYear: days > 365,
    confidence,
  };
}

// De-duplicate disks reported by several *arr apps and total them up.
function summariseDisks(disks) {
  const seen = new Map();
  for (const disk of disks || []) {
    const total = toNumber(disk.totalSpace);
    if (!total) continue;
    const key = `${total}:${toNumber(disk.freeSpace)}`;
    if (!seen.has(key)) seen.set(key, { path: disk.path, label: disk.label || "", source: disk.source || "", totalBytes: total, freeBytes: toNumber(disk.freeSpace) });
  }
  const list = [...seen.values()].sort((a, b) => b.totalBytes - a.totalBytes);
  const totalBytes = list.reduce((sum, d) => sum + d.totalBytes, 0);
  const freeBytes = list.reduce((sum, d) => sum + d.freeBytes, 0);
  return { disks: list, totalBytes, freeBytes, usedBytes: Math.max(0, totalBytes - freeBytes) };
}

const ADDITIONS_SQL = `
  WITH added AS (
    SELECT i."ParentId" AS "LibraryId", date_trunc('day', i."DateCreated") AS day, COALESCE(ii."Size", 0) AS size
      FROM jf_library_items i
      JOIN jf_item_info ii ON ii."Id" = i."Id"
     WHERE i."Type" <> 'Series' AND i.archived IS NOT TRUE AND i."DateCreated" > now() - interval '91 days'
    UNION ALL
    SELECT s."ParentId", date_trunc('day', e."DateCreated"), COALESCE(ii."Size", 0)
      FROM jf_library_episodes e
      JOIN jf_library_items s ON s."Id" = e."SeriesId"
      JOIN jf_item_info ii ON ii."Id" = e."EpisodeId"
     WHERE e.archived IS NOT TRUE AND s.archived IS NOT TRUE AND e."DateCreated" > now() - interval '91 days'
  )
  SELECT a."LibraryId" AS "libraryId", l."Name" AS "libraryName", a.day, SUM(a.size)::bigint AS bytes, COUNT(*)::int AS items
    FROM added a
    LEFT JOIN jf_libraries l ON l."Id" = a."LibraryId"
   GROUP BY a."LibraryId", l."Name", a.day
`;

const OLDEST_SQL = `
  SELECT LEAST(
    (SELECT MIN("DateCreated") FROM jf_library_items WHERE archived IS NOT TRUE),
    (SELECT MIN("DateCreated") FROM jf_library_episodes WHERE archived IS NOT TRUE)
  ) AS oldest
`;

function buildForecast({ additions, oldest, disks, now = new Date() }) {
  const nowMs = new Date(now).getTime();
  const libraryAge = oldest ? Math.floor((nowMs - new Date(oldest).getTime()) / DAY_MS) : 0;
  // The query only looks back 91 days, so history is the library's age capped at that.
  const historyDays = Math.min(Math.max(0, libraryAge), 91);
  const growth = growthFromAdditions(additions, { now, historyDays });
  const summary = summariseDisks(disks);
  const forecast = forecastFill({ freeBytes: summary.freeBytes, totalBytes: summary.totalBytes, growth });

  const libraries = new Map();
  for (const row of additions || []) {
    const id = row.libraryId || "unknown";
    if (!libraries.has(id)) libraries.set(id, { id, name: row.libraryName || "Other", rows: [] });
    libraries.get(id).rows.push(row);
  }
  const perLibrary = [...libraries.values()]
    .map((lib) => {
      const recent = growthFromAdditions(lib.rows, { now, historyDays }).windows[0];
      return { id: lib.id, name: lib.name, bytes30d: recent.bytes, items30d: recent.items, bytesPerDay: recent.bytesPerDay };
    })
    .filter((lib) => lib.bytes30d > 0)
    .sort((a, b) => b.bytesPerDay - a.bytesPerDay);

  return { generatedAt: new Date(nowMs).toISOString(), method: "additions", ...summary, growth, forecast, perLibrary };
}

async function getDiskForecast({ db, fetchDisks, now = new Date() }) {
  const [additions, oldest, disks] = await Promise.all([
    db.query(ADDITIONS_SQL).then((r) => r.rows),
    db.query(OLDEST_SQL).then((r) => r.rows[0]?.oldest || null),
    fetchDisks().catch(() => []),
  ]);
  return buildForecast({ additions, oldest, disks, now });
}

module.exports = { growthFromAdditions, forecastFill, summariseDisks, roundDays, buildForecast, getDiskForecast, STABLE_BYTES_PER_DAY, MIN_HISTORY_DAYS };

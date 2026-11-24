// Library tools: duplicate finder (same title stored more than once) and quality upgrade finder
// (titles below a resolution or without surround sound), both from the synced library tables.
const db = require("../db");
const { parseMediaStreams } = require("./auto-collections");

function normalizeTitle(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/^(the|a|an) /, "")
    .trim();
}

function describeVideo(video = {}) {
  // Judge by width too: a 2.39:1 film at 1920x800 is 1080p, not "800p".
  const height = Math.max(Number(video.height || 0), Math.round((Number(video.width || 0) * 9) / 16));
  const resolution = height >= 2000 ? "4K" : height >= 1000 ? "1080p" : height >= 700 ? "720p" : height ? "SD" : "Unknown";
  const hdrText = `${video.range || ""} ${video.codec || ""} ${video.displayTitle || ""} ${video.profile || ""}`;
  const hdr = /dolby.?vision|\bdovi\b|dvhe/i.test(hdrText) ? "Dolby Vision" : /hdr/i.test(hdrText) ? "HDR" : "";
  return { height, width: Number(video.width || 0), resolution, hdr, codec: String(video.codec || "").toUpperCase() };
}

function describeAudio(audio = {}) {
  const channels = Number(audio.channels || 0);
  const text = `${audio.codec || ""} ${audio.profile || ""} ${audio.displayTitle || ""}`;
  const format = /atmos/i.test(text) ? "Atmos" : /truehd/i.test(text) ? "TrueHD" : /\bdts\b/i.test(text) ? "DTS" : String(audio.codec || "").toUpperCase();
  const layout = channels >= 8 ? "7.1" : channels >= 6 ? "5.1" : channels === 2 ? "Stereo" : channels === 1 ? "Mono" : "";
  return { channels, format, layout };
}

// Score used to pick the best copy: resolution first, then HDR, then audio channels, then size.
function qualityScore(copy) {
  return copy.video.height * 1000 + (copy.video.hdr ? 500 : 0) + copy.audio.channels * 10 + Math.min(9, Math.floor((copy.size || 0) / 1e10));
}

async function loadMovies({ libraryId } = {}) {
  const params = [];
  let where = `i.archived IS NOT TRUE AND i."Type" = 'Movie'`;
  if (libraryId) {
    params.push(libraryId);
    where += ` AND i."ParentId" = $1`;
  }
  const { rows } = await db.query(
    `SELECT i."Id" AS id, i."Name" AS name, i."ProductionYear" AS year, i."ParentId" AS library_id,
            l."Name" AS library_name, i."DateCreated" AS added, COALESCE(ii."Size", 0) AS size, ii."MediaStreams" AS streams,
            i."RunTimeTicks" AS runtime_ticks
       FROM jf_library_items i
       LEFT JOIN jf_libraries l ON l."Id" = i."ParentId"
       LEFT JOIN jf_item_info ii ON ii."Id" = i."Id"
      WHERE ${where}`,
    params
  );
  return rows.map((row) => {
    const streams = parseMediaStreams(row.streams);
    return {
      id: row.id,
      name: row.name,
      year: row.year ? Number(row.year) : null,
      libraryId: row.library_id,
      libraryName: row.library_name || "",
      added: row.added,
      runtimeMinutes: row.runtime_ticks ? Math.round(Number(row.runtime_ticks) / 600000000) : null,
      size: Number(row.size) || 0,
      video: describeVideo(streams.video),
      audio: describeAudio(streams.audio),
      hasStreams: Boolean(streams.video?.height || streams.audio?.codec),
    };
  });
}

async function findDuplicates({ libraryId, crossLibraryOnly = false } = {}) {
  const movies = await loadMovies({ libraryId: libraryId || undefined });
  // A title used across several different years is almost always broken metadata (e.g. an encoder tag
  // read as the title), not one film. Report those separately instead of calling them duplicates.
  const yearsByTitle = new Map();
  for (const movie of movies) {
    const title = normalizeTitle(movie.name);
    if (!yearsByTitle.has(title)) yearsByTitle.set(title, new Set());
    if (movie.year) yearsByTitle.get(title).add(movie.year);
  }
  const suspectTitles = new Set([...yearsByTitle.entries()].filter(([, years]) => years.size >= 5).map(([title]) => title));
  const groups = new Map();
  for (const movie of movies) {
    if (suspectTitles.has(normalizeTitle(movie.name))) continue;
    // Items without a year or a file are usually extras/trailers mis-filed as movies; they would group wrongly.
    if (!movie.year || !movie.size) continue;
    const key = `${normalizeTitle(movie.name)}|${movie.year}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(movie);
  }
  // Same title and year but very different runtimes are different films (or badly named files), not copies.
  const clusters = [];
  for (const copies of groups.values()) {
    if (copies.length < 2) continue;
    const timed = copies.filter((copy) => copy.runtimeMinutes).sort((a, b) => a.runtimeMinutes - b.runtimeMinutes);
    const untimed = copies.filter((copy) => !copy.runtimeMinutes);
    const split = [];
    for (const copy of timed) {
      const last = split[split.length - 1];
      const first = last?.[0];
      // Compare with the cluster's first copy so 90, 93, 97, 100… minutes do not chain together.
      if (first && copy.runtimeMinutes - first.runtimeMinutes <= Math.max(5, first.runtimeMinutes * 0.06)) last.push(copy);
      else split.push([copy]);
    }
    if (!split.length) split.push([]);
    split[0].push(...untimed);
    clusters.push(...split.filter((cluster) => cluster.length > 1));
  }
  const results = [];
  for (const copies of clusters) {
    const libraries = new Set(copies.map((copy) => copy.libraryId));
    if (crossLibraryOnly && libraries.size < 2) continue;
    const ranked = [...copies].sort((a, b) => qualityScore(b) - qualityScore(a));
    const best = ranked[0];
    const total = copies.reduce((sum, copy) => sum + copy.size, 0);
    results.push({
      key: `${best.id}`,
      name: best.name,
      year: best.year,
      copies: ranked.map((copy) => ({ ...copy, best: copy.id === best.id })),
      libraries: libraries.size,
      totalBytes: total,
      reclaimableBytes: Math.max(0, total - best.size),
    });
  }
  results.sort((a, b) => b.reclaimableBytes - a.reclaimableBytes);
  const suspect = [...suspectTitles].map((title) => {
    const items = movies.filter((movie) => normalizeTitle(movie.name) === title);
    return { name: items[0]?.name || title, count: items.length, libraries: [...new Set(items.map((item) => item.libraryName))], items: items.slice(0, 50).map(({ id, name, year, libraryName, size }) => ({ id, name, year, libraryName, size })) };
  });
  return {
    groups: results,
    suspectTitles: suspect,
    totals: {
      groups: results.length,
      copies: results.reduce((sum, group) => sum + group.copies.length, 0),
      reclaimableBytes: results.reduce((sum, group) => sum + group.reclaimableBytes, 0),
    },
  };
}

async function findUpgrades({ libraryId, minResolution = "1080p", requireSurround = false, limit = 500 } = {}) {
  const minHeight = { "4K": 2000, "1080p": 1000, "720p": 700 }[minResolution] || 1000;
  const movies = await loadMovies({ libraryId: libraryId || undefined });
  const candidates = movies
    .filter((movie) => movie.hasStreams)
    .map((movie) => {
      const reasons = [];
      if (movie.video.height && movie.video.height < minHeight) reasons.push(`${movie.video.resolution} (below ${minResolution})`);
      if (requireSurround && movie.audio.channels && movie.audio.channels < 6) reasons.push(`${movie.audio.layout || `${movie.audio.channels}ch`} audio`);
      return { ...movie, reasons };
    })
    .filter((movie) => movie.reasons.length)
    .sort((a, b) => a.video.height - b.video.height || a.audio.channels - b.audio.channels || String(a.name).localeCompare(String(b.name)));
  const byResolution = candidates.reduce((map, movie) => ({ ...map, [movie.video.resolution]: (map[movie.video.resolution] || 0) + 1 }), {});
  return {
    items: candidates.slice(0, Math.min(2000, Number(limit) || 500)),
    total: candidates.length,
    scanned: movies.length,
    missingStreamInfo: movies.filter((movie) => !movie.hasStreams).length,
    byResolution,
  };
}

async function searchUpgrades(itemIds = []) {
  const ids = [...new Set((itemIds || []).filter(Boolean))].slice(0, 50);
  if (!ids.length) return { searched: [], failed: [] };
  const { rows } = await db.query(
    `SELECT "Id" AS id, "Name" AS name, "ProductionYear" AS year, "Type" AS type FROM jf_library_items WHERE "Id" = ANY($1::text[])`,
    [ids]
  );
  const { createArrCleanupClient } = require("./cleanup-clients");
  const arr = await createArrCleanupClient();
  const searched = [];
  const failed = [];
  for (const row of rows) {
    try {
      const result = await arr.search({ id: row.id, name: row.name, year: row.year, type: row.type });
      searched.push({ id: row.id, name: row.name, app: result.app });
    } catch (error) {
      failed.push({ id: row.id, name: row.name, error: error.message });
    }
  }
  return { searched, failed };
}

// Ask the media server to re-read metadata (titles, years, artwork ids) from scratch.
async function refreshMetadata(itemIds = []) {
  const mediaServer = require("./media-server-collections");
  const ids = [...new Set((itemIds || []).filter(Boolean))].slice(0, 300);
  const refreshed = [];
  const failed = [];
  for (const id of ids) {
    try {
      await mediaServer.request("post", `/Items/${encodeURIComponent(id)}/Refresh`, {
        params: { MetadataRefreshMode: "FullRefresh", ImageRefreshMode: "FullRefresh", ReplaceAllMetadata: true, ReplaceAllImages: false },
      });
      refreshed.push(id);
    } catch (error) {
      failed.push({ id, error: error.message });
    }
  }
  return { refreshed: refreshed.length, failed };
}

// Delete one copy of a duplicated movie from the media server (and its files).
// Only allowed while another copy of the same title stays, and never for the best copy.
async function deleteDuplicateCopy(itemId) {
  const { groups } = await findDuplicates();
  const group = groups.find((row) => row.copies.some((copy) => copy.id === itemId));
  if (!group) throw Object.assign(new Error("That item is no longer listed as a duplicate"), { statusCode: 409 });
  const copy = group.copies.find((row) => row.id === itemId);
  if (copy.best) throw Object.assign(new Error("The best copy is kept; delete one of the other copies instead"), { statusCode: 400 });
  if (group.copies.length < 2) throw Object.assign(new Error("This is the only copy left"), { statusCode: 400 });
  const mediaServer = require("./media-server-collections");
  await mediaServer.request("delete", `/Items/${encodeURIComponent(itemId)}`);
  // Hide it here straight away; the next library sync confirms the removal.
  await db.query(`UPDATE jf_library_items SET archived = true WHERE "Id" = $1`, [itemId]).catch(() => {});
  return { deleted: { id: copy.id, name: copy.name, libraryName: copy.libraryName, size: copy.size }, kept: group.copies.find((row) => row.best) };
}

// ---- Nightly upgrade searches -------------------------------------------------

const DEFAULT_UPGRADE_SCHEDULE = { enabled: false, perNight: 10, minResolution: "1080p", hour: 3, lastRunDate: null, lastResult: null };
const RESEARCH_AFTER_DAYS = 60;

function localDay(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

async function getUpgradeSchedule() {
  const { getSettings } = require("./integration-store");
  const settings = await getSettings();
  const { history, ...schedule } = { ...DEFAULT_UPGRADE_SCHEDULE, ...(settings.UpgradeSearchSchedule || {}) };
  return { ...schedule, searchedCount: Object.keys(history || {}).length };
}

async function saveUpgradeSchedule(input = {}) {
  const { getSettings, saveSettings } = require("./integration-store");
  const settings = await getSettings();
  const current = { ...DEFAULT_UPGRADE_SCHEDULE, ...(settings.UpgradeSearchSchedule || {}) };
  const perNight = Number.parseInt(input.perNight ?? current.perNight, 10);
  const hour = Number.parseInt(input.hour ?? current.hour, 10);
  const next = {
    ...current,
    enabled: input.enabled === undefined ? current.enabled : Boolean(input.enabled),
    perNight: Number.isFinite(perNight) ? Math.min(50, Math.max(1, perNight)) : current.perNight,
    minResolution: ["720p", "1080p", "4K"].includes(input.minResolution) ? input.minResolution : current.minResolution,
    hour: Number.isFinite(hour) ? Math.min(23, Math.max(0, hour)) : current.hour,
  };
  await saveSettings({ UpgradeSearchSchedule: next });
  return getUpgradeSchedule();
}

// Called by the background scheduler. Searches a few of the worst files each night,
// skipping anything searched in the last 60 days so the whole list is worked through over time.
async function maybeRunUpgradeBatch({ now = new Date(), force = false } = {}) {
  const { getSettings, saveSettings } = require("./integration-store");
  const settings = await getSettings();
  const schedule = { ...DEFAULT_UPGRADE_SCHEDULE, ...(settings.UpgradeSearchSchedule || {}) };
  if (!force && (!schedule.enabled || now.getHours() < schedule.hour || schedule.lastRunDate === localDay(now))) return null;
  // Automatic runs follow the same switch as other automatic Arr/Jellyfin jobs.
  if (!force && process.env.JG_DISABLE_SERVER_AUTOMATION === "1") return null;
  const history = { ...(schedule.history || {}) };
  const cutoff = now.getTime() - RESEARCH_AFTER_DAYS * 86400000;
  const { items } = await findUpgrades({ minResolution: schedule.minResolution, limit: 2000 });
  const due = items.filter((item) => !history[item.id] || new Date(history[item.id]).getTime() < cutoff).slice(0, schedule.perNight);
  const result = await searchUpgrades(due.map((item) => item.id));
  for (const row of [...result.searched, ...result.failed]) history[row.id] = now.toISOString();
  // Keep the history bounded: drop entries older than the re-search window.
  for (const [id, when] of Object.entries(history)) if (new Date(when).getTime() < cutoff) delete history[id];
  const lastResult = { at: now.toISOString(), searched: result.searched.length, failed: result.failed.length, titles: result.searched.slice(0, 10).map((row) => row.name) };
  await saveSettings({ UpgradeSearchSchedule: { ...schedule, history, lastRunDate: force ? schedule.lastRunDate : localDay(now), lastResult } });
  return lastResult;
}

async function listLibraries() {
  const { rows } = await db.query(
    `SELECT "Id" AS id, "Name" AS name, "CollectionType" AS collection_type FROM jf_libraries WHERE archived IS NOT TRUE AND "CollectionType" = 'movies' ORDER BY "Name"`
  );
  return rows;
}

module.exports = { normalizeTitle, describeVideo, describeAudio, findDuplicates, findUpgrades, searchUpgrades, refreshMetadata, deleteDuplicateCopy, getUpgradeSchedule, saveUpgradeSchedule, maybeRunUpgradeBatch, listLibraries };

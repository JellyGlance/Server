const crypto = require("crypto");
const { mediaServerAuthHeaders } = require("./server-type");
const fs = require("fs");
const path = require("path");
const db = require("../db");
const { axios } = require("./axios");
const { getIntegrations, getIntegrationData, getIntegrationHealthHistory } = require("./integration-store");
const configClass = require("./config");
const jellyfinApi = require("./api-loader");
const WebhookManager = require("./webhook-manager");
const { getAuditLog, getWebhookDeliveryHistory, mergeSettings, getSettings } = require("./admin-history");
const { fetchSeerrIssueSnapshot } = require("./seerr-issues");
const NewsletterCampaigns = require("./newsletter-campaigns");
const { setDownloadPaused } = require("./download-client");
// eslint-disable-next-line no-unused-vars -- existing code, kept unchanged
const { joinSafeHttpUrl, stripTrailingSlashes, toSafeHttpUrl, safeHttpGet, safeHttpPost} = require("../utils/security");

let lastJellyfinSeenWrite = 0;

function cleanUrl(url = "") {
  return stripTrailingSlashes(url);
}

function tokens(value = "") {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((part) => part.length > 2);
}

function scoreOverlap(left, right) {
  const a = new Set(tokens(left));
  const b = new Set(tokens(right));
  if (!a.size || !b.size) return 0;
  let hits = 0;
  for (const token of a) if (b.has(token)) hits += 1;
  return hits / Math.max(a.size, b.size);
}

function bestMatch(name, items, getName) {
  let winner = null;
  let best = 0.42;
  for (const item of items) {
    const score = scoreOverlap(name, getName(item));
    if (score > best) {
      best = score;
      winner = item;
    }
  }
  return winner;
}

function formatBytes(bytes = 0) {
  const value = Number(bytes || 0);
  if (!value) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${(value / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

async function loadItem(id) {
  const result = await db
    .query(
      `SELECT i.*, l."Name" AS "LibraryName"
       FROM jf_library_items i
       LEFT JOIN jf_libraries l ON l."Id" = i."ParentId"
       WHERE i."Id" = $1
       LIMIT 1`,
      [id]
    )
    .then((res) => res.rows[0]);
  if (result) return result;
  const episode = await db
    .query(
      `SELECT e.*, i."Name" AS "SeriesName", i."ParentId"
       FROM jf_library_episodes e
       LEFT JOIN jf_library_items i ON i."Id" = e."SeriesId"
       WHERE e."EpisodeId" = $1 OR e."Id" = $1
       LIMIT 1`,
      [id]
    )
    .then((res) => res.rows[0]);
  return episode || null;
}

async function fetchSeerrSnapshot() {
  const integrations = await getIntegrations();
  const seerrApps = (integrations.arrApps || []).filter((app) => {
    const name = String(app.name || app.slug || "").toLowerCase();
    return app.connected && (name.includes("jellyseerr") || name.includes("overseerr") || name === "seerr");
  });
  const requests = [];
  for (const app of seerrApps) {
    try {
      const response = await axios.get(`${cleanUrl(app.values.url)}/api/v1/request`, {
        timeout: 12000,
        headers: { "X-Api-Key": app.values.secret },
        params: { take: 100, skip: 0, sort: "added", skipCount: "false" },
      });
      const rows = response.data?.results || response.data || [];
      for (const row of Array.isArray(rows) ? rows : []) {
        const media = row.media || {};
        requests.push({
          id: row.id,
          title: media.title || media.name || row.title || "Request",
          status: row.status,
          mediaType: media.mediaType || row.type,
          tmdb: media.tmdbId,
          tvdb: media.tvdbId,
          requestedBy: row.requestedBy?.displayName || row.requestedBy?.jellyfinUsername || row.user?.jellyfinUsername || "",
          jellyfinItemId: media.jellyfinItemId || media.jellyfinMediaId,
          openUrl: `${cleanUrl(app.values.url)}/${media.mediaType === "tv" ? "tv" : "movie"}/${media.tmdbId || media.tvdbId || ""}`,
          source: app.name,
          sourceId: app.instanceId,
        });
      }
    } catch (error) {
      console.warn("[command-center] Seerr snapshot failed:", error.message);
    }
  }
  return requests;
}

function stitchName(item) {
  return item.Name || item.SeriesName || item.title || item.name || "";
}

async function buildItemGlance(itemId) {
  const item = await loadItem(itemId);
  if (!item) return null;
  const name = stitchName(item);
  const [requests, integrationData, integrations] = await Promise.all([
    fetchSeerrSnapshot(),
    getIntegrationData(),
    getIntegrations(),
  ]);
  const downloads = integrationData.downloads?.items || [];
  const request = requests.find((row) => String(row.jellyfinItemId || "") === String(itemId)) || bestMatch(name, requests, (row) => row.title);
  const download = bestMatch(name, downloads, (row) => row.name);
  const calendarHit = bestMatch(name, integrationData.calendar?.releases || [], (row) => row.title);
  const thirdParty = integrations.thirdParty || [];
  const tdarr = thirdParty.find((app) => String(app.name || "").toLowerCase().includes("tdarr"));
  const maintainerr = thirdParty.find((app) => String(app.name || "").toLowerCase().includes("maintainerr"));
  const kometa = thirdParty.find((app) => String(app.name || "").toLowerCase().includes("kometa"));
  const unpackerr = thirdParty.find((app) => String(app.name || "").toLowerCase().includes("unpackerr"));

  return {
    item: {
      id: item.Id || item.EpisodeId || itemId,
      name,
      type: item.Type,
      year: item.ProductionYear,
      library: item.LibraryName,
    },
    jellyfin: { available: true, id: item.Id || item.EpisodeId || itemId },
    request: request
      ? {
          id: request.id,
          title: request.title,
          status: request.status,
          source: request.source,
          openUrl: request.openUrl,
          mediaType: request.mediaType,
          tmdb: request.tmdb,
          tvdb: request.tvdb,
        }
      : null,
    download: download
      ? { id: download.id, name: download.name, client: download.client, state: download.state, progress: download.progress }
      : null,
    arr: calendarHit
      ? {
          title: calendarHit.title,
          service: calendarHit.service,
          date: calendarHit.date,
          hasFile: calendarHit.hasFile,
          tmdb: calendarHit.tmdbId || calendarHit.tmdb,
          tvdb: calendarHit.tvdbId || calendarHit.tvdb,
        }
      : null,
    tdarr: tdarr ? { connected: Boolean(tdarr.connected), name: tdarr.name } : null,
    maintainerr: maintainerr ? { connected: Boolean(maintainerr.connected), name: maintainerr.name } : null,
    kometa: kometa ? { connected: Boolean(kometa.connected), name: kometa.name } : null,
    unpackerr: unpackerr ? { connected: Boolean(unpackerr.connected), name: unpackerr.name } : null,
  };
}

async function stitchDownloads() {
  const [requests, integrationData] = await Promise.all([fetchSeerrSnapshot(), getIntegrationData()]);
  const downloads = integrationData.downloads?.items || [];
  return downloads.map((item) => {
    const request = bestMatch(item.name, requests, (row) => row.title);
    return {
      ...item,
      request: request
        ? {
            id: request.id,
            title: request.title,
            status: request.status,
            source: request.source,
            requestedBy: request.requestedBy,
            jellyfinItemId: request.jellyfinItemId,
          }
        : null,
    };
  });
}

async function buildLibraryStorage() {
  const libraries = await db
    .query(
      `SELECT l."Id", l."Name",
              COALESCE(SUM(info."Size"), 0)::bigint AS "Size",
              COUNT(i."Id")::int AS "Items"
       FROM jf_libraries l
       LEFT JOIN jf_library_items i ON i."ParentId" = l."Id" AND i.archived = false
       LEFT JOIN jf_item_info info ON info."Id" = i."Id"
       GROUP BY l."Id", l."Name"
       ORDER BY COALESCE(SUM(info."Size"), 0) DESC`
    )
    .then((res) => res.rows);
  const calendar = (await getIntegrationData()).calendar?.releases || [];
  const upcomingBytes = calendar.filter((row) => !row.hasFile).length * 1.4 * 1024 * 1024 * 1024;
  return {
    libraries: libraries.map((row) => ({
      id: row.Id,
      name: row.Name,
      bytes: Number(row.Size || 0),
      size: formatBytes(row.Size),
      items: row.Items,
    })),
    totalBytes: libraries.reduce((sum, row) => sum + Number(row.Size || 0), 0),
    totalLabel: formatBytes(libraries.reduce((sum, row) => sum + Number(row.Size || 0), 0)),
    upcomingEstimate: formatBytes(upcomingBytes),
    upcomingCount: calendar.filter((row) => !row.hasFile).length,
  };
}

async function buildOpsDigest() {
  const [healthRow, integrationData, deliveries, audit] = await Promise.all([
    db.query('SELECT settings FROM app_config WHERE "ID"=1').then((res) => res.rows[0]?.settings || {}),
    getIntegrationData(),
    getWebhookDeliveryHistory(),
    getAuditLog(),
  ]);
  const downloads = integrationData.downloads?.items || [];
  const stuck = downloads.filter((item) => {
    const state = String(item.state || "").toLowerCase();
    return item.stalled || state.includes("fail") || state.includes("error") || state.includes("stall") || (Number(item.progress) > 0 && Number(item.progress) < 100 && state.includes("paus"));
  });
  const webhookFails = (deliveries || []).filter((row) => !row.ok).slice(0, 8);
  const recentFails = (audit || []).filter((row) => String(row.action || "").includes("fail")).slice(0, 6);
  const items = [
    ...stuck.map((item) => ({ type: "download", label: item.stalledReason ? `${item.name}: ${item.stalledReason}` : `${item.name} is ${item.state}`, to: "/downloads" })),
    ...webhookFails.map((row) => ({ type: "webhook", label: `${row.name || "Webhook"} delivery failed`, to: "/settings/webhooks" })),
    ...recentFails.map((row) => ({ type: "audit", label: row.action, to: "/settings/health" })),
  ];
  return {
    ok: items.length === 0,
    count: items.length,
    items: items.slice(0, 12),
    generatedAt: new Date().toISOString(),
    backupAgeHint: healthRow?.lastBackup || null,
  };
}

function listWidgetCatalog() {
  return {
    jellyglance: true,
    auth: {
      header: "x-api-token",
      settings: "Settings → API Key",
    },
    snapshot: "/api/widgets/homepage",
    endpoints: [
      { path: "/api/widgets", method: "GET", summary: "Catalog of token-auth widget endpoints" },
      { path: "/api/widgets/homepage", method: "GET", summary: "Dashboard snapshot: sessions, catalog, downloads, digest, storage, invites, calendar" },
      { path: "/api/widgets/catalog", method: "GET", summary: "Movies, shows, episodes, and items added this week" },
      { path: "/api/widgets/storage", method: "GET", summary: "Library storage total and upcoming Arr estimate" },
      { path: "/api/widgets/sessions", method: "GET", summary: "Recent, today, and 24h playback counts" },
      { path: "/api/widgets/nowplaying", method: "GET", summary: "Live Jellyfin sessions playing right now" },
      { path: "/api/widgets/viewers", method: "GET", summary: "Distinct viewers today and synced user count" },
      { path: "/api/widgets/users", method: "GET", summary: "User roster with last activity" },
      { path: "/api/widgets/activity", method: "GET", summary: "Latest playback rows" },
      { path: "/api/widgets/watch", method: "GET", summary: "Watch-time totals for today, week, and all time" },
      { path: "/api/widgets/statistics", method: "GET", summary: "Top titles and users this week" },
      { path: "/api/widgets/recent", method: "GET", summary: "Recently added library titles" },
      { path: "/api/widgets/libraries", method: "GET", summary: "Per-library sizes and catalog totals" },
      { path: "/api/widgets/repair", method: "GET", summary: "Missing posters, runtime, and unmatched imports" },
      { path: "/api/widgets/downloads", method: "GET", summary: "Queue counts plus a compact item list" },
      { path: "/api/widgets/stalled", method: "GET", summary: "Stalled or failed download items" },
      { path: "/api/widgets/stitched", method: "GET", summary: "Cached download queue without a live Seerr call" },
      { path: "/api/widgets/calendar", method: "GET", summary: "Arr releases today and upcoming" },
      { path: "/api/widgets/today", method: "GET", summary: "Arr releases due today" },
      { path: "/api/widgets/requests", method: "GET", summary: "Seerr request counts by status" },
      { path: "/api/widgets/issues", method: "GET", summary: "Seerr issue counts by status" },
      { path: "/api/widgets/invites", method: "GET", summary: "Cached Wizarr invite links" },
      { path: "/api/widgets/autobrr", method: "GET", summary: "Cached autobrr release hits" },
      { path: "/api/widgets/transcodes", method: "GET", summary: "Tdarr active, queued, and error counts" },
      { path: "/api/widgets/maintainerr", method: "GET", summary: "Maintainerr cleanup counts and reclaimable size" },
      { path: "/api/widgets/automation", method: "GET", summary: "Latest integration health results" },
      { path: "/api/widgets/devices", method: "GET", summary: "Known Jellyfin client devices" },
      { path: "/api/widgets/health", method: "GET", summary: "Digest, live Jellyfin ping, and backup hint" },
      { path: "/api/widgets/digest", method: "GET", summary: "Ops digest items that need attention" },
      { path: "/api/widgets/backup", method: "GET", summary: "Last backup hint and destination kind" },
      { path: "/api/widgets/webhooks", method: "GET", summary: "Recent webhook deliveries" },
      { path: "/api/widgets/jobs", method: "GET", summary: "Latest Glance task runs" },
      { path: "/api/widgets/jellyfin-jobs", method: "GET", summary: "Live Jellyfin scheduled tasks" },
      { path: "/api/widgets/newsletter", method: "GET", summary: "Last newsletter send and next digest" },
      { path: "/api/widgets/sessions/stop", method: "POST", summary: "Stop a live Jellyfin session (widgets-write)" },
      { path: "/api/widgets/downloads/pause", method: "POST", summary: "Pause or resume a download (widgets-write)" },
      { path: "/api/widgets/requests/actions", method: "POST", summary: "Approve, decline, or retry a Seerr request (widgets-write)" },
      { path: "/api/widgets/repair/refresh", method: "POST", summary: "Refresh a Jellyfin item (widgets-write)" },
      { path: "/api/ops-digest", method: "GET", summary: "Ops items that need attention" },
      { path: "/api/library-storage", method: "GET", summary: "Per-library sizes and upcoming estimate" },
      { path: "/api/downloads/stitched", method: "GET", summary: "Download queue matched to Seerr requests" },
      { path: "/api/jellyfin/status", method: "GET", summary: "Live Jellyfin reachability and version" },
      { path: "/api/item-glance/:id", method: "GET", summary: "One title across Jellyfin, Seerr, Arr, and downloads" },
    ],
  };
}

function queryCount(sql) {
  return db
    .query(sql)
    .then((result) => Number(result.rows[0]?.count || 0))
    .catch(() => 0);
}

function isStalledDownload(item) {
  const state = String(item.state || "").toLowerCase();
  return Boolean(item.stalled || state.includes("fail") || state.includes("error") || state.includes("stall"));
}

function sameCalendarDay(value, now = new Date()) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
}

function compactDownload(item) {
  return {
    id: item.id || item.hash || item.nzoId || "",
    name: item.name || item.title || "Download",
    state: item.state || "",
    progress: Number(item.progress || 0),
    stalled: isStalledDownload(item),
  };
}

function compactRelease(row) {
  return {
    title: row.title || "Release",
    service: row.service || "",
    date: row.date || null,
    hasFile: Boolean(row.hasFile),
  };
}

async function loadPlaybackCounts() {
  const [sessionsRecent, sessionsToday, sessionsDay, viewersToday, users] = await Promise.all([
    queryCount(`SELECT count(*)::int AS count FROM jf_playback_activity WHERE "ActivityDateInserted" > NOW() - INTERVAL '15 minutes'`),
    queryCount(`SELECT count(*)::int AS count FROM jf_playback_activity WHERE "ActivityDateInserted" >= CURRENT_DATE`),
    queryCount(`SELECT count(*)::int AS count FROM jf_playback_activity WHERE "ActivityDateInserted" > NOW() - INTERVAL '24 hours'`),
    queryCount(`SELECT count(DISTINCT "UserId")::int AS count FROM jf_playback_activity WHERE "ActivityDateInserted" >= CURRENT_DATE`),
    queryCount(`SELECT count(*)::int AS count FROM jf_users`),
  ]);
  return { sessionsRecent, sessionsToday, sessionsDay, viewersToday, users };
}

async function buildHomepageWidgets() {
  const [playback, addedWeek, catalog, digest, storage, integrationData, settings] = await Promise.all([
    loadPlaybackCounts(),
    queryCount(`SELECT count(*)::int AS count FROM jf_library_items WHERE archived = false AND "DateCreated" > NOW() - INTERVAL '7 days'`),
    db
      .query(
        `SELECT
            COALESCE(sum(CASE WHEN "CollectionType" = 'movies' THEN "Library_Count" ELSE 0 END), 0)::int AS movies,
            COALESCE(sum(CASE WHEN "CollectionType" = 'tvshows' THEN "Library_Count" ELSE 0 END), 0)::int AS shows,
            COALESCE(sum(CASE WHEN "CollectionType" = 'tvshows' THEN "Episode_Count" ELSE 0 END), 0)::int AS episodes,
            COALESCE(count(*) FILTER (WHERE archived = false), 0)::int AS libraries
         FROM js_library_stats_overview`
      )
      .then((result) => result.rows[0] || {})
      .catch(() => ({})),
    buildOpsDigest(),
    buildLibraryStorage(),
    getIntegrationData(),
    getSettings().catch(() => ({})),
  ]);
  const downloads = integrationData.downloads?.items || [];
  const upcoming = (integrationData.calendar?.releases || []).filter((row) => !row.hasFile);
  const lastSeen = settings.JellyfinLastSeen || {};
  const seenAt = lastSeen.at ? new Date(lastSeen.at).getTime() : 0;
  const jellyfinOk = Boolean(lastSeen.version) && (Date.now() - seenAt < 36 * 60 * 60 * 1000 || !seenAt);
  return {
    jellyglance: true,
    sessionsRecent: playback.sessionsRecent,
    sessionsToday: playback.sessionsToday,
    sessionsDay: playback.sessionsDay,
    viewersToday: playback.viewersToday,
    users: playback.users,
    libraries: Number(catalog.libraries || storage.libraries?.length || 0),
    movies: Number(catalog.movies || 0),
    shows: Number(catalog.shows || 0),
    episodes: Number(catalog.episodes || 0),
    addedWeek,
    downloads: downloads.filter((item) => Number(item.progress || 0) < 100).length,
    downloadTotal: downloads.length,
    stalled: downloads.filter(isStalledDownload).length,
    digest: digest.count,
    digestOk: Boolean(digest.ok),
    storage: storage.totalLabel,
    storageBytes: Number(storage.totalBytes || 0),
    invites: (integrationData.invites?.items || []).length,
    calendarUpcoming: upcoming.length,
    calendarToday: upcoming.filter((row) => sameCalendarDay(row.date)).length,
    autobrr: (integrationData.autobrr?.hits || []).length,
    jellyfinOk,
    jellyfinName: lastSeen.name || "",
    jellyfinVersion: lastSeen.version || "",
    backupAt: digest.backupAgeHint || null,
    updatedAt: new Date().toISOString(),
  };
}

async function buildSessionWidgets() {
  const playback = await loadPlaybackCounts();
  return {
    jellyglance: true,
    recent: playback.sessionsRecent,
    today: playback.sessionsToday,
    last24h: playback.sessionsDay,
    viewersToday: playback.viewersToday,
    users: playback.users,
    updatedAt: new Date().toISOString(),
  };
}

async function buildDownloadWidgets() {
  const downloads = (await getIntegrationData()).downloads?.items || [];
  const active = downloads.filter((item) => Number(item.progress || 0) < 100);
  return {
    jellyglance: true,
    active: active.length,
    stalled: downloads.filter(isStalledDownload).length,
    total: downloads.length,
    items: active.slice(0, 8).map(compactDownload),
    updatedAt: new Date().toISOString(),
  };
}

async function buildCalendarWidgets() {
  const [integrationData, storage] = await Promise.all([getIntegrationData(), buildLibraryStorage()]);
  const upcoming = (integrationData.calendar?.releases || [])
    .filter((row) => !row.hasFile)
    .slice()
    .sort((left, right) => new Date(left.date || 0) - new Date(right.date || 0));
  return {
    jellyglance: true,
    upcoming: upcoming.length,
    today: upcoming.filter((row) => sameCalendarDay(row.date)).length,
    estimate: storage.upcomingEstimate || "",
    items: upcoming.slice(0, 8).map(compactRelease),
    updatedAt: new Date().toISOString(),
  };
}

async function buildLibraryWidgets() {
  const storage = await buildLibraryStorage();
  return {
    jellyglance: true,
    totalLabel: storage.totalLabel,
    totalBytes: Number(storage.totalBytes || 0),
    upcomingCount: Number(storage.upcomingCount || 0),
    upcomingEstimate: storage.upcomingEstimate || "",
    libraries: storage.libraries || [],
    updatedAt: new Date().toISOString(),
  };
}

async function buildHealthWidgets() {
  const [digest, status] = await Promise.all([buildOpsDigest(), getJellyfinStatus().catch(() => ({ ok: false }))]);
  return {
    jellyglance: true,
    digestOk: Boolean(digest.ok),
    digest: digest.count,
    items: (digest.items || []).slice(0, 8),
    jellyfinOk: Boolean(status.ok),
    jellyfinName: status.name || "",
    jellyfinVersion: status.version || "",
    backupAt: digest.backupAgeHint || null,
    updatedAt: new Date().toISOString(),
  };
}

async function buildRequestWidgets() {
  const rows = await fetchSeerrSnapshot().catch(() => []);
  const counts = { total: rows.length, pending: 0, approved: 0, available: 0, other: 0 };
  for (const row of rows) {
    const status = String(row.status ?? "").toLowerCase();
    if (status === "1" || status.includes("pend")) counts.pending += 1;
    else if (status === "3" || status.includes("avail") || status.includes("complete")) counts.available += 1;
    else if (status === "2" || status.includes("approv")) counts.approved += 1;
    else counts.other += 1;
  }
  return {
    jellyglance: true,
    ...counts,
    items: rows.slice(0, 8).map((row) => ({
      id: row.id,
      sourceId: row.sourceId || "",
      title: row.title,
      status: row.status,
      source: row.source || "",
      requestedBy: row.requestedBy || "",
    })),
    updatedAt: new Date().toISOString(),
  };
}

function widgetPayload(extra) {
  return { jellyglance: true, ...extra, updatedAt: new Date().toISOString() };
}

function hoursFromSeconds(seconds) {
  return Number((Number(seconds || 0) / 3600).toFixed(1));
}

function latestHealthById(history = []) {
  const latest = [];
  const seen = new Set();
  for (const row of history) {
    const id = row.instanceId || row.name;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    latest.push(row);
  }
  return latest;
}

function findThirdParty(integrations, needle) {
  return (integrations.thirdParty || []).find((app) => String(app.name || app.slug || "").toLowerCase().includes(needle));
}

// eslint-disable-next-line no-unused-vars -- existing code, kept unchanged
function compactHealth(app, history) {
  const latest = history.find((row) => row.instanceId && row.instanceId === app?.instanceId) || history.find((row) => row.name && app?.name && row.name === app.name);
  return {
    connected: Boolean(app?.connected),
    name: app?.name || "",
    ok: latest ? Boolean(latest.ok) : Boolean(app?.connected),
    message: latest?.message || (app?.connected ? "Connected" : "Not connected"),
    checkedAt: latest?.checkedAt || null,
  };
}

async function loadCatalogCounts() {
  const [addedWeek, catalog] = await Promise.all([
    queryCount(`SELECT count(*)::int AS count FROM jf_library_items WHERE archived = false AND "DateCreated" > NOW() - INTERVAL '7 days'`),
    db
      .query(
        `SELECT
            COALESCE(sum(CASE WHEN "CollectionType" = 'movies' THEN "Library_Count" ELSE 0 END), 0)::int AS movies,
            COALESCE(sum(CASE WHEN "CollectionType" = 'tvshows' THEN "Library_Count" ELSE 0 END), 0)::int AS shows,
            COALESCE(sum(CASE WHEN "CollectionType" = 'tvshows' THEN "Episode_Count" ELSE 0 END), 0)::int AS episodes,
            COALESCE(count(*) FILTER (WHERE archived = false), 0)::int AS libraries
         FROM js_library_stats_overview`
      )
      .then((result) => result.rows[0] || {})
      .catch(() => ({})),
  ]);
  return {
    movies: Number(catalog.movies || 0),
    shows: Number(catalog.shows || 0),
    episodes: Number(catalog.episodes || 0),
    libraries: Number(catalog.libraries || 0),
    addedWeek,
  };
}

async function buildCatalogWidgets() {
  return widgetPayload(await loadCatalogCounts());
}

async function buildStorageWidgets() {
  const storage = await buildLibraryStorage();
  return widgetPayload({
    totalLabel: storage.totalLabel,
    totalBytes: Number(storage.totalBytes || 0),
    upcomingCount: Number(storage.upcomingCount || 0),
    upcomingEstimate: storage.upcomingEstimate || "",
  });
}

async function buildViewerWidgets() {
  const playback = await loadPlaybackCounts();
  return widgetPayload({
    viewersToday: playback.viewersToday,
    users: playback.users,
    today: playback.sessionsToday,
  });
}

async function buildUserWidgets() {
  const [total, admins, activeToday, items] = await Promise.all([
    queryCount(`SELECT count(*)::int AS count FROM jf_users`),
    queryCount(`SELECT count(*)::int AS count FROM jf_users WHERE "IsAdministrator" = true`),
    queryCount(`SELECT count(*)::int AS count FROM jf_users WHERE "LastActivityDate" >= CURRENT_DATE`),
    db
      .query(
        `SELECT "Name" AS name, "LastActivityDate" AS "lastAt", "IsAdministrator" AS admin
         FROM jf_users
         ORDER BY "LastActivityDate" DESC NULLS LAST
         LIMIT 8`
      )
      .then((result) => result.rows)
      .catch(() => []),
  ]);
  return widgetPayload({
    users: total,
    admins,
    activeToday,
    items: items.map((row) => ({
      name: row.name || "User",
      lastAt: row.lastAt || null,
      admin: Boolean(row.admin),
    })),
  });
}

async function buildActivityWidgets() {
  const items = await db
    .query(
      `SELECT "UserName" AS viewer, "NowPlayingItemName" AS title, "PlayMethod" AS method, "Client" AS client, "ActivityDateInserted" AS "playedAt"
       FROM jf_playback_activity
       ORDER BY "ActivityDateInserted" DESC
       LIMIT 8`
    )
    .then((result) => result.rows)
    .catch(() => []);
  return widgetPayload({
    count: items.length,
    items: items.map((row) => ({
      viewer: row.viewer || "User",
      title: row.title || "Playback",
      method: row.method || "",
      client: row.client || "",
      playedAt: row.playedAt || null,
    })),
  });
}

async function buildWatchWidgets() {
  const [today, week, all] = await Promise.all([
    db
      .query(`SELECT COALESCE(sum("PlaybackDuration"), 0)::bigint AS seconds FROM jf_playback_activity WHERE "ActivityDateInserted" >= CURRENT_DATE`)
      .then((result) => Number(result.rows[0]?.seconds || 0))
      .catch(() => 0),
    db
      .query(`SELECT COALESCE(sum("PlaybackDuration"), 0)::bigint AS seconds FROM jf_playback_activity WHERE "ActivityDateInserted" > NOW() - INTERVAL '7 days'`)
      .then((result) => Number(result.rows[0]?.seconds || 0))
      .catch(() => 0),
    db
      .query(`SELECT COALESCE(sum("PlaybackDuration"), 0)::bigint AS seconds FROM jf_playback_activity`)
      .then((result) => Number(result.rows[0]?.seconds || 0))
      .catch(() => 0),
  ]);
  return widgetPayload({
    hoursToday: hoursFromSeconds(today),
    hoursWeek: hoursFromSeconds(week),
    hoursAll: hoursFromSeconds(all),
    secondsToday: today,
    secondsWeek: week,
    secondsAll: all,
  });
}

async function buildRecentWidgets() {
  const items = await db
    .query(
      `SELECT "Id" AS id, "Name" AS title, "Type" AS type, "ProductionYear" AS year, "DateCreated" AS added
       FROM jf_library_items
       WHERE archived = false
       ORDER BY "DateCreated" DESC NULLS LAST
       LIMIT 8`
    )
    .then((result) => result.rows)
    .catch(() => []);
  return widgetPayload({
    count: items.length,
    items: items.map((row) => ({
      id: row.id,
      title: row.title || "Title",
      type: row.type || "",
      year: row.year || null,
      added: row.added || null,
    })),
  });
}

async function buildStalledWidgets() {
  const downloads = (await getIntegrationData()).downloads?.items || [];
  const items = downloads.filter(isStalledDownload);
  return widgetPayload({
    stalled: items.length,
    items: items.slice(0, 8).map(compactDownload),
  });
}

async function buildStitchedWidgets() {
  const downloads = (await getIntegrationData()).downloads?.items || [];
  const active = downloads.filter((item) => Number(item.progress || 0) < 100);
  return widgetPayload({
    active: active.length,
    stalled: downloads.filter(isStalledDownload).length,
    total: downloads.length,
    items: downloads.slice(0, 8).map((item) => ({
      ...compactDownload(item),
      client: item.client || item.source || "",
    })),
  });
}

async function buildTodayWidgets() {
  const upcoming = ((await getIntegrationData()).calendar?.releases || [])
    .filter((row) => !row.hasFile && sameCalendarDay(row.date))
    .slice()
    .sort((left, right) => new Date(left.date || 0) - new Date(right.date || 0));
  return widgetPayload({
    today: upcoming.length,
    items: upcoming.slice(0, 8).map(compactRelease),
  });
}

async function buildInviteWidgets() {
  const invites = (await getIntegrationData()).invites || {};
  const items = invites.items || [];
  const active = items.filter((row) => {
    const status = String(row.status || "").toLowerCase();
    return status !== "used" && status !== "expired";
  });
  return widgetPayload({
    invites: items.length,
    active: active.length,
    items: items.slice(0, 8).map((row) => ({
      code: row.code || "",
      status: row.status || "",
      source: row.sourceName || "",
      expires: row.expires || null,
    })),
  });
}

async function buildAutobrrWidgets() {
  const hits = (await getIntegrationData()).autobrr?.hits || [];
  return widgetPayload({
    autobrr: hits.length,
    items: hits.slice(0, 8).map((row) => ({
      name: row.name || "Release",
      filter: row.filter || "",
      indexer: row.indexer || "",
      action: row.action || "",
    })),
  });
}

async function buildTranscodeWidgets() {
  const integrations = await getIntegrations().catch(() => ({}));
  const tdarr = findThirdParty(integrations, "tdarr");
  if (!tdarr?.connected || !cleanUrl(tdarr.values?.url)) {
    return widgetPayload({
      connected: false,
      status: "Offline",
      ok: false,
      name: tdarr?.name || "",
      active: 0,
      queued: 0,
      errored: 0,
      items: [],
    });
  }
  const url = cleanUrl(tdarr.values.url);
  const headers = {
    Accept: "application/json",
    "Content-Type": "application/json",
    ...(tdarr.values?.secret ? { "x-api-key": tdarr.values.secret } : {}),
  };
  const [statusResponse, statsResponse, nodesResponse] = await Promise.all([
    axios.get(`${url}/api/v2/status`, { timeout: 8000, headers }).catch(() => null),
    axios
      .post(`${url}/api/v2/cruddb`, { data: { collection: "StatisticsJSONDB", mode: "getById", docID: "statistics" } }, { timeout: 8000, headers })
      .catch(() => ({ data: {} })),
    axios.get(`${url}/api/v2/get-nodes`, { timeout: 8000, headers }).catch(() => ({ data: {} })),
  ]);
  const statistics = Array.isArray(statsResponse.data) ? statsResponse.data[0] || {} : statsResponse.data || {};
  const queued =
    Number(statistics.table1ViewableCount ?? statistics.table1Count ?? 0) + Number(statistics.table4ViewableCount ?? statistics.table4Count ?? 0);
  const errored =
    Number(statistics.table3ViewableCount ?? statistics.table3Count ?? 0) + Number(statistics.table6ViewableCount ?? statistics.table6Count ?? 0);
  const nodes = nodesResponse.data?.data && typeof nodesResponse.data.data === "object" ? nodesResponse.data.data : nodesResponse.data || {};
  const items = [];
  for (const node of Object.values(nodes || {})) {
    if (!node || typeof node !== "object") continue;
    const workers = node.workers || node.Workers || {};
    const list = Array.isArray(workers) ? workers : Object.values(workers);
    for (const worker of list) {
      const file = String(worker?.file || worker?.filePath || worker?.originalFile || "").trim();
      if (!file) continue;
      items.push({
        name: file.split(/[\\/]/).pop(),
        node: node.nodeName || node.name || "",
      });
    }
  }
  const statusOk = Boolean(statusResponse?.data);
  return widgetPayload({
    connected: true,
    status: statusOk ? "Online" : "Down",
    ok: statusOk,
    name: tdarr.name || "Tdarr",
    active: items.length,
    queued,
    errored,
    items: items.slice(0, 8),
  });
}

async function buildMaintainerrWidgets() {
  const integrations = await getIntegrations().catch(() => ({}));
  const app = findThirdParty(integrations, "maintainerr");
  if (!app?.connected || !cleanUrl(app.values?.url)) {
    return widgetPayload({
      connected: false,
      ok: false,
      name: app?.name || "",
      scheduled: 0,
      collections: 0,
      reclaimable: "0 B",
      items: [],
    });
  }
  const url = cleanUrl(app.values.url);
  const secret = String(app.values?.secret || "").trim();
  const headers = {
    Accept: "application/json",
    ...(secret
      ? {
          "X-Api-Key": secret,
          "x-api-key": secret,
          Authorization: /^bearer\s+/i.test(secret) ? secret : `Bearer ${secret}`,
        }
      : {}),
  };
  const fetchJson = (pathName) =>
    axios
      .get(`${url}${pathName}`, { timeout: 12000, headers })
      .then((response) => response.data)
      .catch(() => null);
  const [health, overlay, storage] = await Promise.all([
    fetchJson("/api/health"),
    fetchJson("/api/collections/overlay-data"),
    fetchJson("/api/storage-metrics"),
  ]);
  const raw = overlay && typeof overlay === "object" ? overlay : {};
  const collections = Array.isArray(raw.collections) ? raw.collections : Array.isArray(raw.activeCollections) ? raw.activeCollections : [];
  const nestedItems = collections.flatMap((collection) =>
    Array.isArray(collection?.items) ? collection.items : Array.isArray(collection?.media) ? collection.media : []
  );
  const allItems = Array.isArray(raw.items)
    ? raw.items
    : Array.isArray(raw.media)
      ? raw.media
      : Array.isArray(raw.queue)
        ? raw.queue
        : Array.isArray(raw.scheduledItems)
          ? raw.scheduledItems
          : nestedItems;
  const scheduled = allItems.filter((item) => {
    const status = String(item?.status || item?.state || item?.action || item?.pendingAction || "").toLowerCase();
    return status.includes("schedul") || status.includes("delet") || Boolean(item?.action || item?.pendingAction);
  });
  const reclaimable = Number(storage?.reclaimableBytes || storage?.reclaimable_bytes || raw.reclaimableBytes || 0);
  const items = (scheduled.length ? scheduled : allItems).slice(0, 8).map((item) => ({
    title: item.title || item.name || item.mediaTitle || "Title",
    status: item.status || item.state || item.action || "",
  }));
  return widgetPayload({
    connected: true,
    ok: health ? health.status !== "error" : true,
    name: app.name || "Maintainerr",
    scheduled: scheduled.length || Number(raw.scheduledCount || raw.itemsCount || 0),
    collections: collections.length,
    reclaimable: formatBytes(reclaimable),
    items,
  });
}

async function buildAutomationWidgets() {
  const [integrations, history] = await Promise.all([getIntegrations().catch(() => ({})), getIntegrationHealthHistory().catch(() => [])]);
  const connected = [...(integrations.arrApps || []), ...(integrations.clients || []), ...(integrations.thirdParty || [])].filter((item) => item.connected);
  const latest = latestHealthById(history);
  const failing = latest.filter((row) => !row.ok);
  return widgetPayload({
    connected: connected.length,
    checked: latest.length,
    failing: failing.length,
    ok: failing.length === 0,
    items: latest.slice(0, 8).map((row) => ({
      name: row.name || "Integration",
      type: row.type || "",
      ok: Boolean(row.ok),
      message: row.message || "",
    })),
  });
}

async function buildDeviceWidgets() {
  const settings = await getSettings().catch(() => ({}));
  const known = Array.isArray(settings.KnownJellyfinDevices) ? settings.KnownJellyfinDevices : [];
  return widgetPayload({
    devices: known.length,
    items: known.slice(-8).reverse().map((id) => ({ id })),
  });
}

async function buildDigestWidgets() {
  const digest = await buildOpsDigest();
  return widgetPayload({
    digestOk: Boolean(digest.ok),
    digest: digest.count,
    backupAt: digest.backupAgeHint || null,
    items: (digest.items || []).slice(0, 8).map((row) => ({
      type: row.type || "",
      label: row.label || "",
    })),
  });
}

async function buildBackupWidgets() {
  const settings = await getSettings().catch(() => ({}));
  const dest = settings.BackupDestination || {};
  return widgetPayload({
    backupAt: settings.lastBackup || null,
    kind: String(dest.kind || "local").toLowerCase(),
    configured: Boolean(dest.url || dest.kind),
  });
}

async function buildWebhookWidgets() {
  const deliveries = await getWebhookDeliveryHistory().catch(() => []);
  const failed = deliveries.filter((row) => !row.ok);
  return widgetPayload({
    total: deliveries.length,
    failed: failed.length,
    ok: failed.length === 0,
    items: deliveries.slice(0, 8).map((row) => ({
      name: row.name || "Webhook",
      ok: Boolean(row.ok),
      at: row.timestamp || null,
    })),
  });
}

async function buildJobWidgets() {
  const items = await db
    .query(
      `WITH latest_tasks AS (
         SELECT DISTINCT ON ("Name")
           "Name" AS name,
           "Result" AS result,
           "Duration" AS duration,
           "TimeRun" AS "ranAt"
         FROM public.jf_logging
         ORDER BY "Name", "TimeRun" DESC
       )
       SELECT * FROM latest_tasks
       ORDER BY "ranAt" DESC
       LIMIT 8`
    )
    .then((result) => result.rows)
    .catch(() => []);
  const failed = items.filter((row) => String(row.result || "").toLowerCase().includes("fail")).length;
  return widgetPayload({
    jobs: items.length,
    failed,
    ok: failed === 0,
    items: items.map((row) => ({
      name: row.name || "Task",
      result: row.result || "",
      duration: row.duration || "",
      ranAt: row.ranAt || null,
    })),
  });
}

function playingTitle(session = {}) {
  const item = session.NowPlayingItem || {};
  if (item.Type === "Episode" && item.SeriesName) {
    return `${item.SeriesName} · ${item.Name || ""}`.trim();
  }
  return item.Name || session.NowPlayingItemName || "Playback";
}

async function buildNowPlayingWidgets() {
  const sessions = await jellyfinApi.getSessions().catch(() => []);
  const playing = (Array.isArray(sessions) ? sessions : []).filter((session) => session?.NowPlayingItem);
  return widgetPayload({
    playing: playing.length,
    transcoding: playing.filter((session) => {
      const method = String(session.PlayMethod || session.PlayState?.PlayMethod || "").toLowerCase();
      if (method.includes("transcode")) return true;
      if (method.includes("direct")) return false;
      return session.TranscodingInfo?.IsVideoDirect === false;
    }).length,
    items: playing.slice(0, 8).map((session) => ({
      sessionId: session.Id || "",
      viewer: session.UserName || session.LastUserName || "User",
      title: playingTitle(session),
      client: session.Client || session.ApplicationVersion || "",
      device: session.DeviceName || "",
      method: session.PlayMethod || session.PlayState?.PlayMethod || "",
    })),
  });
}

async function buildRepairWidgets() {
  const [counts, unmatched, orphaned, samples] = await Promise.all([
    db
      .query(
        `SELECT
            count(*) FILTER (WHERE COALESCE("PrimaryImageHash", '') = '')::int AS posters,
            count(*) FILTER (WHERE COALESCE("ImageTagsLogo", '') = '')::int AS logos,
            count(*) FILTER (WHERE COALESCE("RunTimeTicks", 0) = 0)::int AS runtime
         FROM jf_library_items
         WHERE archived = false`
      )
      .then((result) => result.rows[0] || {})
      .catch(() => ({})),
    queryCount(`SELECT count(*)::int AS count FROM jf_playback_activity WHERE imported = true AND "Id" LIKE 'tautulli:%' AND "NowPlayingItemId" LIKE 'tautulli:%'`),
    queryCount(
      `SELECT count(*)::int AS count
       FROM jf_playback_activity a
       LEFT JOIN jf_library_items i ON i."Id" = a."NowPlayingItemId"
       LEFT JOIN jf_library_episodes e ON e."EpisodeId" = a."EpisodeId"
       WHERE a."NowPlayingItemId" IS NOT NULL
         AND a."NowPlayingItemId" NOT LIKE 'tautulli:%'
         AND i."Id" IS NULL
         AND (a."EpisodeId" IS NULL OR e."EpisodeId" IS NULL)`
    ),
    db
      .query(
        `SELECT "Id" AS "itemId", "Name" AS title,
            CASE
              WHEN COALESCE("PrimaryImageHash", '') = '' THEN 'poster'
              WHEN COALESCE("RunTimeTicks", 0) = 0 THEN 'runtime'
              ELSE 'logo'
            END AS issue
         FROM jf_library_items
         WHERE archived = false
           AND (
             COALESCE("PrimaryImageHash", '') = ''
             OR COALESCE("RunTimeTicks", 0) = 0
             OR COALESCE("ImageTagsLogo", '') = ''
           )
         ORDER BY "Name"
         LIMIT 8`
      )
      .then((result) => result.rows)
      .catch(() => []),
  ]);
  const posters = Number(counts.posters || 0);
  const logos = Number(counts.logos || 0);
  const runtime = Number(counts.runtime || 0);
  const issues = posters + logos + runtime + unmatched + orphaned;
  return widgetPayload({
    posters,
    logos,
    runtime,
    unmatched,
    orphaned,
    issues,
    ok: issues === 0,
    items: Array.isArray(samples) ? samples : [],
  });
}

async function buildStatisticsWidgets() {
  const [movies, shows, users] = await Promise.all([
    db
      .query(`SELECT unique_viewers, "Name" AS title FROM fs_most_popular_items($1,$2) LIMIT 5`, [6, "Movie"])
      .then((result) => result.rows)
      .catch(() => []),
    db
      .query(`SELECT unique_viewers, "Name" AS title FROM fs_most_popular_items($1,$2) LIMIT 5`, [6, "Series"])
      .then((result) => result.rows)
      .catch(() => []),
    db
      .query(`SELECT "Name" AS name, "Plays" AS plays FROM fs_most_active_user($1) LIMIT 5`, [6])
      .then((result) => result.rows)
      .catch(() => []),
  ]);
  const items = [...movies, ...shows]
    .map((row) => ({
      title: row.title || "Title",
      viewers: Number(row.unique_viewers || 0),
    }))
    .sort((left, right) => right.viewers - left.viewers)
    .slice(0, 8);
  return widgetPayload({
    titles: items.length,
    users: users.length,
    topTitle: items[0]?.title || "",
    topUser: users[0]?.name || "",
    items,
    people: users.map((row) => ({ name: row.name || "User", plays: Number(row.plays || 0) })),
  });
}

async function buildIssueWidgets() {
  const snapshot = await fetchSeerrIssueSnapshot().catch(() => ({ total: 0, open: 0, resolved: 0, items: [] }));
  return widgetPayload({
    total: Number(snapshot.total || 0),
    open: Number(snapshot.open || 0),
    resolved: Number(snapshot.resolved || 0),
    ok: Number(snapshot.open || 0) === 0,
    items: snapshot.items || [],
  });
}

async function buildNewsletterWidgets() {
  const settings = await getSettings().catch(() => ({}));
  const newsletter = settings.Newsletter || {};
  const history = Array.isArray(newsletter.history) ? newsletter.history : [];
  const [campaigns, sent] = await Promise.all([
    NewsletterCampaigns.listCampaigns({ includePersonal: true }).catch(() => []),
    NewsletterCampaigns.listHistory({ limit: 1 }).catch(() => []),
  ]);
  const last = history[0] || sent[0] || null;
  const scheduled = campaigns.filter((campaign) => campaign.enabled && campaign.frequency && campaign.frequency !== "manual");
  const next = scheduled
    .map((campaign) => {
      const lastSent = campaign.lastSentAt ? new Date(campaign.lastSentAt).getTime() : 0;
      const wait = campaign.frequency === "monthly" ? 28 * 24 * 3600 * 1000 : 7 * 24 * 3600 * 1000;
      return {
        name: campaign.name || "Campaign",
        frequency: campaign.frequency,
        nextAt: new Date((lastSent || Date.now()) + wait).toISOString(),
      };
    })
    .sort((left, right) => new Date(left.nextAt) - new Date(right.nextAt))[0];
  return widgetPayload({
    enabled: Boolean(newsletter.enabled || scheduled.length),
    lastAt: last?.timestamp || last?.sentAt || null,
    lastOk: last ? last.ok !== false && last.status !== "failed" : true,
    frequency: newsletter.frequency || scheduled[0]?.frequency || "manual",
    nextAt: next?.nextAt || null,
    nextName: next?.name || "",
    campaigns: campaigns.length,
  });
}

async function buildJellyfinJobWidgets() {
  const config = await new configClass().getConfig();
  if (config.error || !config.JF_HOST) {
    return widgetPayload({ jobs: 0, running: 0, failed: 0, ok: false, items: [] });
  }
  try {
    const response = await axios.get(`${cleanUrl(config.JF_HOST)}/ScheduledTasks`, {
      timeout: 12000,
      headers: { ...mediaServerAuthHeaders(config.JF_API_KEY) },
    });
    const tasks = Array.isArray(response.data) ? response.data : [];
    const running = tasks.filter((task) => String(task.State || "").toLowerCase().includes("run"));
    const failed = tasks.filter((task) => String(task.LastExecutionResult?.Status || "").toLowerCase().includes("fail"));
    const items = [...running, ...tasks.filter((task) => !running.includes(task))].slice(0, 8).map((task) => ({
      name: task.Name || "Task",
      state: task.State || "",
      result: task.LastExecutionResult?.Status || "",
    }));
    return widgetPayload({
      jobs: tasks.length,
      running: running.length,
      failed: failed.length,
      ok: failed.length === 0,
      items,
    });
  } catch (error) {
    return widgetPayload({ jobs: 0, running: 0, failed: 0, ok: false, items: [], error: error.message });
  }
}

async function rememberDevices(devices = []) {
  const config = await new configClass().getConfig();
  const known = Array.isArray(config.settings?.KnownJellyfinDevices) ? config.settings.KnownJellyfinDevices : [];
  const knownSet = new Set(known);
  const fresh = devices.filter((device) => device.id && !knownSet.has(device.id));
  if (!fresh.length) return { fresh: [], known: known.length };
  const next = [...known, ...fresh.map((device) => device.id)].slice(-400);
  await mergeSettings({ KnownJellyfinDevices: next });
  const webhookManager = new WebhookManager();
  for (const device of fresh.slice(0, 8)) {
    await webhookManager.triggerEventWebhooks("device_authorized", {
      integrationEvent: "New Jellyfin client",
      deviceName: device.name,
      appName: device.appName,
      lastUserName: device.lastUserName,
      message: `${device.name || device.appName || "New device"} appeared on Jellyfin`,
    });
  }
  return { fresh, known: next.length };
}

async function getJellyfinStatus() {
  const lastSeen = (await getSettings().catch(() => ({}))).JellyfinLastSeen || {};
  const checkedAt = new Date().toISOString();
  try {
    const info = await jellyfinApi.systemInfo();
    const ok = Boolean(info && (info.Id || info.Version));
    if (!ok) {
      // Keep the last known name/version so status widgets still identify the server while it is down.
      return { ok: false, error: "Jellyfin did not return system info", name: lastSeen.name || "Jellyfin", version: lastSeen.version || "", lastSeen, checkedAt };
    }
    const seen = {
      name: info.ServerName || "Jellyfin",
      version: info.Version || "",
      at: checkedAt,
    };
    if (seen.version !== lastSeen.version || Date.now() - lastJellyfinSeenWrite > 60 * 60 * 1000) {
      await mergeSettings({ JellyfinLastSeen: seen });
      lastJellyfinSeenWrite = Date.now();
    }
    return { ok: true, name: seen.name, version: seen.version, lastSeen: seen, checkedAt };
  } catch (error) {
    return { ok: false, error: error.message || "Jellyfin unreachable", name: lastSeen.name || "Jellyfin", version: lastSeen.version || "", lastSeen, checkedAt };
  }
}

function hmacSha256(key, data) {
  return crypto.createHmac("sha256", key).update(data, "utf8").digest();
}

function sha256Hex(data) {
  return crypto.createHash("sha256").update(data).digest("hex");
}

async function putS3CompatibleObject(dest, filename, body) {
  const endpoint = cleanUrl(dest.url || dest.endpoint || "");
  const bucket = String(dest.bucket || "").trim();
  const region = String(dest.region || "us-east-1").trim() || "us-east-1";
  const accessKey = String(dest.username || dest.accessKey || "").trim();
  const secretKey = String(dest.secret || dest.secretKey || "").trim();
  const prefix = String(dest.prefix || "").replace(/^\/+|\/+$/g, "");
  const objectKey = [prefix, filename].filter(Boolean).join("/");
  if (!endpoint || !bucket || !accessKey || !secretKey) {
    throw new Error("S3 destination needs endpoint, bucket, access key, and secret");
  }

  const parsed = new URL(/^[a-z]+:\/\//i.test(endpoint) ? endpoint : `https://${endpoint}`);
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(body);
  const hostIsAws = /\.amazonaws\.com$/i.test(parsed.host);
  const usePathStyle = dest.pathStyle === true || dest.pathStyle === "true" || !hostIsAws;
  const host = usePathStyle ? parsed.host : `${bucket}.${parsed.host}`;
  const encodedKey = objectKey
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  const basePath = parsed.pathname.replace(/\/+$/, "") || "";
  const canonicalUri = usePathStyle ? `${basePath}/${encodeURIComponent(bucket)}/${encodedKey}` : `${basePath}/${encodedKey}`;
  const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  const canonicalRequest = ["PUT", canonicalUri || "/", "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const credentialScope = `${dateStamp}/${region}/s3/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, credentialScope, sha256Hex(canonicalRequest)].join("\n");
  const kDate = hmacSha256(`AWS4${secretKey}`, dateStamp);
  const kRegion = hmacSha256(kDate, region);
  const kService = hmacSha256(kRegion, "s3");
  const kSigning = hmacSha256(kService, "aws4_request");
  const signature = crypto.createHmac("sha256", kSigning).update(stringToSign, "utf8").digest("hex");
  const target = toSafeHttpUrl(`${parsed.protocol}//${host}${canonicalUri}`);
  await axios.put(target, body, {
    timeout: 120000,
    headers: {
      "Content-Type": "application/octet-stream",
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
      Authorization: `AWS4-HMAC-SHA256 Credential=${accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
  });
}

async function uploadBackupRemote(filePath, refLog) {
  const config = await new configClass().getConfig();
  const dest = config.settings?.BackupDestination || {};
  const kind = String(dest.kind || "local").toLowerCase();
  if (kind === "local" || !dest.url) return;
  const body = fs.readFileSync(filePath);
  const filename = path.basename(filePath);
  try {
    if (kind === "webdav" || kind === "http") {
      const target = joinSafeHttpUrl(cleanUrl(dest.url), encodeURIComponent(filename));
      await axios.put(target, body, {
        timeout: 120000,
        auth: dest.username ? { username: dest.username, password: dest.secret || "" } : undefined,
        headers: {
          "Content-Type": "application/json",
          ...(dest.secret && !dest.username ? { Authorization: dest.secret } : {}),
        },
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
      });
    } else if (kind === "s3") {
      await putS3CompatibleObject(dest, filename, body);
    }
    refLog?.logData?.push({ color: "lawngreen", Message: `Copied backup to ${kind}` });
  } catch (error) {
    refLog?.logData?.push({ color: "orange", Message: `Remote backup copy failed: ${error.message}` });
  }
}

function integrationSlug(integration) {
  return String(integration?.name || integration?.slug || "").toLowerCase();
}

async function pingNotifiarr(integration) {
  const url = cleanUrl(integration.values?.url) || "https://notifiarr.com";
  const secret = integration.values?.secret;
  if (!secret) return { ok: false, error: "API key required" };
  const paths = ["/api/v1/user/me", "/api/v1/user", "/api"];
  let lastError = "Unable to reach Notifiarr";
  for (const apiPath of paths) {
    try {
      const response = await safeHttpGet(url, apiPath, {
        timeout: 10000,
        headers: { "X-API-Key": secret, "X-Api-Key": secret },
        validateStatus: () => true,
      });
      if (response.status < 500) {
        const details = response.data?.details || response.data || {};
        return {
          ok: response.status < 400,
          version: details.username || details.user || "Notifiarr",
          message: response.status < 400 ? "Notifiarr API reachable" : `HTTP ${response.status}`,
        };
      }
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error.message;
    }
  }
  return { ok: false, error: lastError };
}

async function pingRecyclarr(integration) {
  const url = cleanUrl(integration.values?.url);
  if (!url) return { ok: false, error: "URL required" };
  try {
    const response = await safeHttpGet(url, "", {
      timeout: 10000,
      headers: integration.values?.secret
        ? { Authorization: `Bearer ${integration.values.secret}`, "X-Api-Key": integration.values.secret }
        : {},
      validateStatus: () => true,
    });
    return {
      ok: response.status < 500,
      version: "Recyclarr",
      message: response.status < 400 ? "Health ping succeeded" : `HTTP ${response.status}`,
    };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

async function pingAutobrr(integration) {
  const url = cleanUrl(integration.values?.url);
  const secret = integration.values?.secret;
  if (!url || !secret) return { ok: false, error: "URL and API token required" };
  try {
    const response = await safeHttpGet(url, "/api/healthz/liveness", {
      timeout: 10000,
      headers: { "X-API-Token": secret },
      validateStatus: () => true,
    });
    if (response.status < 400) {
      return { ok: true, version: "autobrr", message: "autobrr is live" };
    }
    const fallback = await safeHttpGet(url, "/api/config", {
      timeout: 10000,
      headers: { "X-API-Token": secret },
      validateStatus: () => true,
    });
    return {
      ok: fallback.status < 400,
      version: "autobrr",
      message: fallback.status < 400 ? "autobrr API reachable" : `HTTP ${fallback.status}`,
    };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

async function fetchAutobrrHits() {
  const integrations = await getIntegrations();
  const apps = (integrations.thirdParty || []).filter((item) => item.connected && integrationSlug(item).includes("autobrr"));
  const hits = [];
  for (const app of apps) {
    const url = cleanUrl(app.values?.url);
    const secret = app.values?.secret;
    if (!url || !secret) continue;
    try {
      const response = await safeHttpGet(url, "/api/release", {
        timeout: 12000,
        headers: { "X-API-Token": secret },
        params: { limit: 25, offset: 0 },
      });
      const rows = response.data?.data || response.data || [];
      for (const row of Array.isArray(rows) ? rows : []) {
        hits.push({
          id: `${app.instanceId}-${row.ID || row.id || row.Name}`,
          name: row.Name || row.name || row.TorrentName || "Release",
          filter: row.FilterName || row.filter || row.Filter || "",
          indexer: row.Indexer || row.indexer || "",
          action: row.ActionStatus || row.action || row.Status || "",
          size: row.Size || row.size || "",
          timestamp: row.Timestamp || row.timestamp || row.CreatedAt || null,
          source: app.name,
        });
      }
    } catch (error) {
      console.warn("[command-center] autobrr hits failed:", error.message);
    }
  }
  hits.sort((left, right) => new Date(right.timestamp || 0) - new Date(left.timestamp || 0));
  return hits.slice(0, 40);
}

async function pingThirdParty(integration) {
  const slug = integrationSlug(integration);
  if (slug.includes("notifiarr")) return pingNotifiarr(integration);
  if (slug.includes("recyclarr")) return pingRecyclarr(integration);
  if (slug.includes("autobrr")) return pingAutobrr(integration);
  const url = cleanUrl(integration.values?.url);
  if (!url) return { ok: false, error: "URL required" };
  try {
    const response = await safeHttpGet(url, "", {
      timeout: 10000,
      headers: integration.values?.secret ? { "X-Api-Key": integration.values.secret, Authorization: `Bearer ${integration.values.secret}` } : {},
      validateStatus: () => true,
    });
    return { ok: response.status < 500, version: String(response.status), message: `HTTP ${response.status}` };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function arrHeaders(app) {
  return { "X-Api-Key": app.values?.secret };
}

async function findArrMovie(app, { title, tmdb }) {
  const url = cleanUrl(app.values?.url);
  if (!url) return null;
  try {
    if (tmdb) {
      const response = await axios.get(`${url}/api/v3/movie`, { timeout: 12000, headers: arrHeaders(app), params: { tmdbId: tmdb } });
      const rows = Array.isArray(response.data) ? response.data : [];
      if (rows[0]) return rows[0];
    }
    const response = await axios.get(`${url}/api/v3/movie`, { timeout: 15000, headers: arrHeaders(app) });
    const rows = Array.isArray(response.data) ? response.data : [];
    return bestMatch(title, rows, (row) => row.title);
  } catch (error) {
    console.warn("[command-center] Radarr lookup failed:", error.message);
    return null;
  }
}

async function findArrSeries(app, { title, tvdb }) {
  const url = cleanUrl(app.values?.url);
  if (!url) return null;
  try {
    if (tvdb) {
      const response = await axios.get(`${url}/api/v3/series`, { timeout: 12000, headers: arrHeaders(app), params: { tvdbId: tvdb } });
      const rows = Array.isArray(response.data) ? response.data : [];
      if (rows[0]) return rows[0];
    }
    const response = await axios.get(`${url}/api/v3/series`, { timeout: 15000, headers: arrHeaders(app) });
    const rows = Array.isArray(response.data) ? response.data : [];
    return bestMatch(title, rows, (row) => row.title);
  } catch (error) {
    console.warn("[command-center] Sonarr lookup failed:", error.message);
    return null;
  }
}

async function resolveRetryItem(payload = {}) {
  const itemId = payload.itemId || payload.Id;
  let title = payload.title || payload.name || "";
  let mediaType = String(payload.mediaType || payload.type || "").toLowerCase();
  let tmdb = payload.tmdb || payload.tmdbId;
  let tvdb = payload.tvdb || payload.tvdbId;
  if (!itemId) return { title, mediaType, tmdb, tvdb, itemId: "" };

  const item = await loadItem(itemId).catch(() => null);
  if (item) {
    title = title || item.Name || item.SeriesName || "";
    const itemType = String(item.Type || "").toLowerCase();
    if (!mediaType && (itemType.includes("series") || item.SeriesName || item.EpisodeId)) mediaType = "series";
    if (!mediaType && itemType.includes("movie")) mediaType = "movie";
  }

  try {
    const live = await jellyfinApi.getItemsByID({ ids: [itemId] });
    const jfItem = Array.isArray(live) ? live[0] : null;
    const providers = jfItem?.ProviderIds || {};
    tvdb = tvdb || providers.Tvdb || providers.TVDB || providers.tvdb;
    tmdb = tmdb || providers.Tmdb || providers.TMDB || providers.tmdb;
    title = title || jfItem?.Name || "";
    if (!mediaType && String(jfItem?.Type || "").toLowerCase() === "series") mediaType = "series";
    if (!mediaType && String(jfItem?.Type || "").toLowerCase() === "movie") mediaType = "movie";
  } catch {
    /* keep local title */
  }

  return { title, mediaType, tmdb, tvdb, itemId };
}

async function retryFailedGrab(payload = {}) {
  const resolved = await resolveRetryItem(payload);
  const title = resolved.title;
  const mediaType = resolved.mediaType;
  const tmdb = resolved.tmdb;
  const tvdb = resolved.tvdb;
  const requestId = payload.requestId || payload.request?.id;
  const sourceId = payload.sourceId || payload.request?.sourceId;
  const steps = [];
  const integrations = await getIntegrations();
  const arrApps = (integrations.arrApps || []).filter((app) => app.connected);

  if (requestId) {
    const seerrApps = arrApps.filter((app) => {
      const name = integrationSlug(app);
      return name.includes("jellyseerr") || name.includes("overseerr") || name === "seerr";
    });
    const seerr = sourceId ? seerrApps.find((app) => app.instanceId === sourceId) : seerrApps[0];
    if (seerr) {
      try {
        await axios.post(
          `${cleanUrl(seerr.values.url)}/api/v1/request/${encodeURIComponent(requestId)}/retry`,
          {},
          { timeout: 15000, headers: { "X-Api-Key": seerr.values.secret } }
        );
        steps.push({ ok: true, service: seerr.name, action: "seerr-retry" });
      } catch (error) {
        steps.push({ ok: false, service: seerr.name, action: "seerr-retry", error: error.message });
      }
    }
  }

  const explicitSeries = mediaType.includes("tv") || mediaType.includes("series") || mediaType.includes("show");
  const explicitMovie = mediaType.includes("movie");
  const wantMovie = explicitSeries && !explicitMovie ? false : explicitMovie && !explicitSeries ? true : Boolean(tmdb) || (!tvdb && !mediaType);
  const wantSeries = explicitSeries || Boolean(tvdb) || !wantMovie;

  for (const app of arrApps) {
    const slug = integrationSlug(app);
    if (wantMovie && slug.includes("radarr")) {
      const movie = await findArrMovie(app, { title, tmdb });
      if (movie?.id) {
        try {
          await axios.post(
            `${cleanUrl(app.values.url)}/api/v3/command`,
            { name: "MoviesSearch", movieIds: [movie.id] },
            { timeout: 15000, headers: arrHeaders(app) }
          );
          steps.push({ ok: true, service: app.name, action: "MoviesSearch", id: movie.id, title: movie.title });
        } catch (error) {
          steps.push({ ok: false, service: app.name, action: "MoviesSearch", error: error.message });
        }
      }
    }
    if (wantSeries && slug.includes("sonarr")) {
      const series = await findArrSeries(app, { title, tvdb });
      if (series?.id) {
        try {
          await axios.post(
            `${cleanUrl(app.values.url)}/api/v3/command`,
            { name: "MissingEpisodeSearch", seriesId: series.id },
            { timeout: 15000, headers: arrHeaders(app) }
          );
          steps.push({ ok: true, service: app.name, action: "MissingEpisodeSearch", id: series.id, title: series.title });
        } catch (error) {
          steps.push({ ok: false, service: app.name, action: "MissingEpisodeSearch", error: error.message });
        }
      }
    }
  }

  const ok = steps.some((step) => step.ok);
  if (!ok && wantSeries && !wantMovie) {
    const sonarrApps = arrApps.filter((app) => integrationSlug(app).includes("sonarr"));
    if (!sonarrApps.length) {
      return { ok: false, error: "Sonarr is not connected", steps, title };
    }
    if (!steps.some((step) => step.action === "MissingEpisodeSearch")) {
      return { ok: false, error: "Series not found in Sonarr", steps, title };
    }
  }

  return { ok, steps, title };
}

async function stopWidgetSession(sessionId) {
  return jellyfinApi.stopSession(sessionId);
}

async function pauseWidgetDownload(id, paused) {
  return setDownloadPaused(id, paused);
}

async function runWidgetRequestAction({ requestId, sourceId, action }) {
  const integrations = await getIntegrations();
  const seerrApps = (integrations.arrApps || []).filter((app) => {
    const name = integrationSlug(app);
    return name.includes("jellyseerr") || name.includes("overseerr") || name === "seerr";
  });
  const app = sourceId ? seerrApps.find((row) => row.instanceId === sourceId) : seerrApps[0];
  if (!app) {
    const error = new Error("Seerr source not found");
    error.statusCode = 404;
    throw error;
  }
  if (!["approve", "decline", "retry"].includes(action)) {
    const error = new Error("Unsupported request action");
    error.statusCode = 400;
    throw error;
  }
  const response = await axios.post(
    `${cleanUrl(app.values.url)}/api/v1/request/${encodeURIComponent(requestId)}/${action}`,
    {},
    { timeout: 10000, headers: { "X-Api-Key": app.values.secret } }
  );
  return { ok: true, source: app.name, action, status: response.status, data: response.data };
}

async function refreshWidgetItem(itemId, recursive = true) {
  return jellyfinApi.refreshItem(itemId, { recursive });
}

module.exports = {
  buildItemGlance,
  stitchDownloads,
  buildLibraryStorage,
  buildOpsDigest,
  listWidgetCatalog,
  buildHomepageWidgets,
  buildSessionWidgets,
  buildDownloadWidgets,
  buildCalendarWidgets,
  buildLibraryWidgets,
  buildHealthWidgets,
  buildRequestWidgets,
  buildCatalogWidgets,
  buildStorageWidgets,
  buildViewerWidgets,
  buildUserWidgets,
  buildActivityWidgets,
  buildWatchWidgets,
  buildRecentWidgets,
  buildStalledWidgets,
  buildStitchedWidgets,
  buildTodayWidgets,
  buildInviteWidgets,
  buildAutobrrWidgets,
  buildTranscodeWidgets,
  buildMaintainerrWidgets,
  buildAutomationWidgets,
  buildDeviceWidgets,
  buildDigestWidgets,
  buildBackupWidgets,
  buildWebhookWidgets,
  buildJobWidgets,
  buildNowPlayingWidgets,
  buildRepairWidgets,
  buildStatisticsWidgets,
  buildIssueWidgets,
  buildNewsletterWidgets,
  buildJellyfinJobWidgets,
  rememberDevices,
  uploadBackupRemote,
  pingThirdParty,
  fetchAutobrrHits,
  retryFailedGrab,
  stopWidgetSession,
  pauseWidgetDownload,
  runWidgetRequestAction,
  refreshWidgetItem,
  getJellyfinStatus,
  formatBytes,
};

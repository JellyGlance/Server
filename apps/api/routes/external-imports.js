const express = require("express");
const { mediaServerAuthHeaders } = require("../classes/server-type");
const multer = require("multer");
const { randomUUID } = require("crypto");
const axios = require("axios");

const db = require("../db");
const configClass = require("../classes/config");
const { encryptSecret, decryptSecret } = require("../classes/integration-store");

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 60 * 1024 * 1024 } });

const TRAKT_API = "https://api.trakt.tv";
const TRAKT_DUPLICATE_WINDOW_SECONDS = 3 * 60 * 60;
const USER_AGENT = "JellyGlance";
const IMPORT_COLUMNS = [
  "Id",
  "IsPaused",
  "UserId",
  "UserName",
  "Client",
  "DeviceName",
  "DeviceId",
  "ApplicationVersion",
  "NowPlayingItemId",
  "NowPlayingItemName",
  "EpisodeId",
  "SeasonId",
  "SeriesName",
  "PlaybackDuration",
  "PlayMethod",
  "ActivityDateInserted",
  "imported",
];

// Device-code sessions waiting for the user to approve on trakt.tv (in memory only).
const pendingDeviceCodes = new Map();
let syncRunning = { jellyfin: false, trakt: false };

// Background import jobs: the latest job per source, kept in memory so the UI can poll progress.
const importJobs = { jellyfin: null, trakt: null };

function startJob(source, label) {
  const job = {
    id: `${source}-${Date.now()}`,
    source,
    label,
    status: "running",
    stage: "Starting",
    done: 0,
    total: 0,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    result: null,
    error: null,
  };
  importJobs[source] = job;
  return job;
}

function jobProgress(job, patch) {
  if (job) Object.assign(job, patch);
}

function finishJob(job, { result = null, error = null } = {}) {
  if (!job) return;
  job.status = error ? "failed" : "completed";
  job.stage = error ? "Failed" : "Finished";
  job.result = result;
  job.error = error;
  job.finishedAt = new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Settings

async function readSettings() {
  const { rows } = await db.query('SELECT settings FROM app_config WHERE "ID" = 1');
  const settings = rows[0]?.settings || {};
  const imports = settings.ExternalImports || {};
  return {
    jellyfin: {
      autoSync: false,
      intervalHours: 24,
      includeInProgress: true,
      lastSyncAt: null,
      lastResult: null,
      ...(imports.jellyfin || {}),
    },
    trakt: {
      clientId: "",
      clientSecret: "",
      autoSync: false,
      intervalHours: 24,
      includeUnmatched: false,
      accounts: [],
      lastSyncAt: null,
      lastResult: null,
      ...(imports.trakt || {}),
    },
  };
}

async function writeSettings(next) {
  await db.query(
    `
      UPDATE app_config
      SET settings = (COALESCE(settings, '{}'::json)::jsonb || jsonb_build_object('ExternalImports', $1::jsonb))::json
      WHERE "ID" = 1
    `,
    [JSON.stringify(next)]
  );
  new configClass().clearCache();
}

async function updateSettings(mutator) {
  const current = await readSettings();
  const next = (await mutator(current)) || current;
  await writeSettings(next);
  return next;
}

function publicSettings(settings) {
  return {
    jellyfin: settings.jellyfin,
    trakt: {
      clientId: settings.trakt.clientId || "",
      hasClientSecret: Boolean(settings.trakt.clientSecret),
      autoSync: Boolean(settings.trakt.autoSync),
      intervalHours: Number(settings.trakt.intervalHours) || 24,
      includeUnmatched: Boolean(settings.trakt.includeUnmatched),
      lastSyncAt: settings.trakt.lastSyncAt,
      lastResult: settings.trakt.lastResult,
      accounts: (settings.trakt.accounts || []).map((account) => ({
        id: account.id,
        username: account.username,
        jellyfinUserId: account.jellyfinUserId,
        jellyfinUserName: account.jellyfinUserName,
        connectedAt: account.connectedAt,
        lastSyncAt: account.lastSyncAt || null,
      })),
    },
  };
}

function clampInterval(value) {
  const hours = Number(value);
  if (!Number.isFinite(hours)) return 24;
  return Math.min(Math.max(Math.round(hours), 1), 24 * 14);
}

// ---------------------------------------------------------------------------
// Shared helpers

function normalizeTitle(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function addLookup(map, key, value) {
  if (key && !map.has(key)) map.set(key, value);
}

function providerValue(providerIds = {}, names = []) {
  const entries = Object.entries(providerIds || {});
  for (const name of names) {
    const found = entries.find(([key]) => key.toLowerCase() === name.toLowerCase());
    if (found && found[1]) return String(found[1]).trim().toLowerCase();
  }
  return "";
}

async function jellyfinRequest(path, params = {}) {
  const config = await new configClass().getConfig();
  if (!config?.JF_HOST || !config?.JF_API_KEY) {
    throw new Error("Jellyfin is not configured yet.");
  }
  const response = await axios.get(`${String(config.JF_HOST).replace(/\/+$/, "")}${path}`, {
    params,
    timeout: 120000,
    headers: {
      ...mediaServerAuthHeaders(config.JF_API_KEY),
      "User-Agent": USER_AGENT,
    },
  });
  return response.data;
}

async function fetchJellyfinUsers() {
  const users = await jellyfinRequest("/Users");
  return Array.isArray(users) ? users : [];
}

async function getKnownUsers() {
  const { rows } = await db.query('SELECT "Id", "Name" FROM jf_users ORDER BY "Name"');
  return rows || [];
}

// Rows that would double count: same Id, or the same user already has a play of the same item
// (within windowSeconds of this one, or at any time when windowSeconds is null).
async function findDuplicateIds(rows, windowSeconds) {
  const duplicates = new Set();
  const batchSize = 1000;
  for (let index = 0; index < rows.length; index += batchSize) {
    const payload = JSON.stringify(
      rows.slice(index, index + batchSize).map((row) => ({
        Id: row.Id,
        UserId: row.UserId,
        ItemKey: row.EpisodeId || row.NowPlayingItemId,
        At: row.ActivityDateInserted,
      }))
    );
    const { rows: found } = await db.pool.query(
      `
        WITH payload AS (
          SELECT * FROM jsonb_to_recordset($1::jsonb) AS x("Id" text, "UserId" text, "ItemKey" text, "At" timestamptz)
        )
        SELECT p."Id"
        FROM payload p
        WHERE EXISTS (
          SELECT 1 FROM jf_playback_activity a
          WHERE a."Id" = p."Id"
          OR (
            a."UserId" = p."UserId"
            AND COALESCE(NULLIF(a."EpisodeId", ''), a."NowPlayingItemId") = p."ItemKey"
            AND ($2::int IS NULL OR ABS(EXTRACT(EPOCH FROM (a."ActivityDateInserted" - p."At"))) < $2::int)
          )
        )
      `,
      [payload, windowSeconds]
    );
    found.forEach((row) => duplicates.add(row.Id));
  }
  return duplicates;
}

async function insertRows(rows, job = null) {
  if (!rows.length) return 0;
  const columns = IMPORT_COLUMNS.map((column) => `"${column}"`).join(", ");
  const recordColumns = IMPORT_COLUMNS.map((column) => {
    if (["IsPaused", "imported"].includes(column)) return `"${column}" boolean`;
    if (column === "PlaybackDuration") return `"${column}" bigint`;
    if (column === "ActivityDateInserted") return `"${column}" timestamptz`;
    return `"${column}" text`;
  }).join(", ");

  let inserted = 0;
  const batchSize = 500;
  for (let index = 0; index < rows.length; index += batchSize) {
    const payload = JSON.stringify(
      rows.slice(index, index + batchSize).map((row) =>
        IMPORT_COLUMNS.reduce((record, column) => {
          record[column] = row[column] ?? null;
          return record;
        }, {})
      )
    );
    const result = await db.pool.query(
      `
        WITH payload AS (SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(${recordColumns}))
        INSERT INTO jf_playback_activity (${columns})
        SELECT ${columns} FROM payload
        ON CONFLICT ("Id") DO NOTHING
        RETURNING "Id"
      `,
      [payload]
    );
    inserted += result.rowCount;
    jobProgress(job, { stage: "Saving plays", done: Math.min(rows.length, index + batchSize), total: rows.length });
  }
  if (inserted > 0) {
    jobProgress(job, { stage: "Refreshing statistics" });
    await Promise.all(db.materializedViews.map((view) => db.refreshMaterializedView(view)));
  }
  return inserted;
}

function dateRange(rows) {
  const times = rows.map((row) => new Date(row.ActivityDateInserted).getTime()).filter(Number.isFinite);
  if (!times.length) return { firstActivityDate: null, lastActivityDate: null };
  return {
    firstActivityDate: new Date(Math.min(...times)).toISOString(),
    lastActivityDate: new Date(Math.max(...times)).toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Jellyfin watch data sync

async function fetchUserPlayedItems(user, includeInProgress) {
  const base = {
    Recursive: true,
    IncludeItemTypes: "Movie,Episode",
    Fields: "ProviderIds,RunTimeTicks",
    EnableUserData: true,
    EnableImages: false,
  };
  const played = await jellyfinRequest(`/Users/${user.Id}/Items`, { ...base, IsPlayed: true });
  let items = played?.Items || [];
  if (includeInProgress) {
    const resumable = await jellyfinRequest(`/Users/${user.Id}/Items`, { ...base, Filters: "IsResumable" });
    const seen = new Set(items.map((item) => item.Id));
    items = items.concat((resumable?.Items || []).filter((item) => !seen.has(item.Id)));
  }
  return items;
}

function jellyfinItemToRow(user, item) {
  const data = item.UserData || {};
  if (!data.LastPlayedDate) return null;
  const runtimeSeconds = Math.round(Number(item.RunTimeTicks || 0) / 10000000);
  const positionSeconds = Math.round(Number(data.PlaybackPositionTicks || 0) / 10000000);
  const duration = data.Played ? runtimeSeconds : positionSeconds || runtimeSeconds;
  const isEpisode = item.Type === "Episode";
  return {
    Id: `jellyfin-sync:${user.Id}:${item.Id}`,
    IsPaused: false,
    UserId: user.Id,
    UserName: user.Name,
    Client: "Jellyfin watch data",
    DeviceName: "Jellyfin sync",
    DeviceId: "jellyfin-sync",
    ApplicationVersion: null,
    NowPlayingItemId: isEpisode ? item.SeriesId || item.Id : item.Id,
    NowPlayingItemName: item.Name,
    EpisodeId: isEpisode ? item.Id : null,
    SeasonId: isEpisode ? item.SeasonId || null : null,
    SeriesName: isEpisode ? item.SeriesName || null : null,
    PlaybackDuration: Math.max(0, duration),
    PlayMethod: "DirectPlay",
    ActivityDateInserted: new Date(data.LastPlayedDate).toISOString(),
    imported: true,
  };
}

async function buildJellyfinSync({ userIds = [], includeInProgress = true, job = null } = {}) {
  const allUsers = await fetchJellyfinUsers();
  const users = userIds.length ? allUsers.filter((user) => userIds.includes(user.Id)) : allUsers;

  const rows = [];
  const perUser = [];
  let noDate = 0;
  for (const [userIndex, user] of users.entries()) {
    jobProgress(job, { stage: `Reading ${user.Name}'s watch data`, done: userIndex, total: users.length });
    const items = await fetchUserPlayedItems(user, includeInProgress);
    let userRows = 0;
    for (const item of items) {
      const row = jellyfinItemToRow(user, item);
      if (!row) {
        noDate += 1;
        continue;
      }
      rows.push(row);
      userRows += 1;
    }
    perUser.push({ userId: user.Id, userName: user.Name, items: items.length, candidates: userRows });
  }

  jobProgress(job, { stage: "Checking for plays already tracked", done: users.length, total: users.length });
  const duplicates = await findDuplicateIds(rows, null);
  const newRows = rows.filter((row) => !duplicates.has(row.Id));
  const newByUser = new Map();
  newRows.forEach((row) => newByUser.set(row.UserId, (newByUser.get(row.UserId) || 0) + 1));

  return {
    rows: newRows,
    summary: {
      users: perUser.map((entry) => ({ ...entry, newPlays: newByUser.get(entry.userId) || 0 })),
      totalItems: rows.length + noDate,
      candidates: rows.length,
      newPlays: newRows.length,
      alreadyTracked: duplicates.size,
      noPlayDate: noDate,
      ...dateRange(newRows),
    },
  };
}

async function runJellyfinSync(options = {}) {
  if (syncRunning.jellyfin) throw new Error("A Jellyfin sync is already running.");
  syncRunning.jellyfin = true;
  try {
    const settings = await readSettings();
    const includeInProgress = options.includeInProgress ?? settings.jellyfin.includeInProgress;
    const { rows, summary } = await buildJellyfinSync({ ...options, includeInProgress });
    const insertedRows = await insertRows(rows, options.job);
    const result = { ...summary, insertedRows, finishedAt: new Date().toISOString() };
    await updateSettings((current) => {
      current.jellyfin.lastSyncAt = result.finishedAt;
      current.jellyfin.lastResult = { insertedRows, newPlays: summary.newPlays, alreadyTracked: summary.alreadyTracked };
      return current;
    });
    return result;
  } finally {
    syncRunning.jellyfin = false;
  }
}

// ---------------------------------------------------------------------------
// Trakt

function traktHeaders(clientId, accessToken) {
  const headers = {
    "Content-Type": "application/json",
    "trakt-api-version": "2",
    "trakt-api-key": clientId,
    "User-Agent": USER_AGENT,
  };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  return headers;
}

function traktCredentials(settings) {
  const clientId = String(settings.trakt.clientId || "").trim();
  const clientSecret = decryptSecret(settings.trakt.clientSecret || "");
  if (!clientId || !clientSecret) {
    throw new Error("Add your Trakt app Client ID and Client Secret first.");
  }
  return { clientId, clientSecret };
}

async function refreshTraktToken(settings, account) {
  const { clientId, clientSecret } = traktCredentials(settings);
  const response = await axios.post(
    `${TRAKT_API}/oauth/token`,
    {
      refresh_token: decryptSecret(account.refreshToken),
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: "urn:ietf:wg:oauth:2.0:oob",
      grant_type: "refresh_token",
    },
    { headers: traktHeaders(clientId), timeout: 30000 }
  );
  const token = response.data;
  const updated = {
    ...account,
    accessToken: encryptSecret(token.access_token),
    refreshToken: encryptSecret(token.refresh_token),
    expiresAt: new Date((Number(token.created_at) + Number(token.expires_in)) * 1000).toISOString(),
  };
  await updateSettings((current) => {
    current.trakt.accounts = (current.trakt.accounts || []).map((entry) => (entry.id === account.id ? updated : entry));
    return current;
  });
  return updated;
}

async function accountAccessToken(settings, account) {
  const expiresAt = new Date(account.expiresAt || 0).getTime();
  if (account.refreshToken && Number.isFinite(expiresAt) && expiresAt - Date.now() < 24 * 60 * 60 * 1000) {
    const refreshed = await refreshTraktToken(settings, account);
    return decryptSecret(refreshed.accessToken);
  }
  return decryptSecret(account.accessToken);
}

async function fetchTraktHistory(settings, account, { startAt } = {}) {
  const { clientId } = traktCredentials(settings);
  const accessToken = await accountAccessToken(settings, account);
  const items = [];
  let page = 1;
  let pageCount = 1;
  do {
    const response = await axios.get(`${TRAKT_API}/sync/history`, {
      params: { page, limit: 1000, ...(startAt ? { start_at: startAt } : {}) },
      headers: traktHeaders(clientId, accessToken),
      timeout: 60000,
    });
    items.push(...(Array.isArray(response.data) ? response.data : []));
    pageCount = Number(response.headers["x-pagination-page-count"] || 1);
    page += 1;
  } while (page <= pageCount && page <= 500);
  return items;
}

// Accepts Trakt history items, or "watched" style exports (watched-movies / watched-shows).
function flattenTraktEntries(data) {
  const list = Array.isArray(data) ? data : Array.isArray(data?.history) ? data.history : [];
  const entries = [];
  list.forEach((entry, index) => {
    if (!entry || typeof entry !== "object") return;
    if (entry.watched_at && (entry.movie || entry.episode)) {
      entries.push({
        key: entry.id ? String(entry.id) : null,
        type: entry.movie ? "movie" : "episode",
        watchedAt: entry.watched_at,
        movie: entry.movie,
        show: entry.show,
        episode: entry.episode,
      });
      return;
    }
    if (entry.movie && entry.last_watched_at) {
      entries.push({ key: null, type: "movie", watchedAt: entry.last_watched_at, movie: entry.movie });
      return;
    }
    if (entry.show && Array.isArray(entry.seasons)) {
      entry.seasons.forEach((season) =>
        (season.episodes || []).forEach((episode) => {
          if (!episode.last_watched_at) return;
          entries.push({
            key: null,
            type: "episode",
            watchedAt: episode.last_watched_at,
            show: entry.show,
            episode: { season: season.number, number: episode.number, title: episode.title },
          });
        })
      );
    }
    void index;
  });
  return entries.filter((entry) => !Number.isNaN(new Date(entry.watchedAt).getTime()));
}

async function buildLibraryMatcher() {
  const [live, episodesResult, itemsResult] = await Promise.all([
    jellyfinRequest("/Items", {
      Recursive: true,
      IncludeItemTypes: "Movie,Series",
      Fields: "ProviderIds,ProductionYear,RunTimeTicks",
      EnableImages: false,
      EnableUserData: false,
    }).catch(() => ({ Items: [] })),
    db.query(`
      SELECT "EpisodeId", "SeasonId", "SeriesId", "Name", "SeriesName", "IndexNumber", "ParentIndexNumber", "RunTimeTicks"
      FROM jf_library_episodes WHERE COALESCE(archived, false) = false
    `),
    db.query(`
      SELECT "Id", "Name", "Type", "ProductionYear", "RunTimeTicks"
      FROM jf_library_items WHERE COALESCE(archived, false) = false AND "Type" IN ('Movie', 'Series')
    `),
  ]);

  const byProvider = new Map();
  (live?.Items || []).forEach((item) => {
    const ids = item.ProviderIds || {};
    const imdb = providerValue(ids, ["Imdb"]);
    const tmdb = providerValue(ids, ["Tmdb", "TheMovieDb"]);
    const tvdb = providerValue(ids, ["Tvdb", "TheTvdb"]);
    if (imdb) addLookup(byProvider, `${item.Type}|imdb|${imdb}`, item);
    if (tmdb) addLookup(byProvider, `${item.Type}|tmdb|${tmdb}`, item);
    if (tvdb) addLookup(byProvider, `${item.Type}|tvdb|${tvdb}`, item);
  });

  const byTitle = new Map();
  const itemsById = new Map();
  (itemsResult.rows || []).forEach((item) => {
    itemsById.set(item.Id, item);
    const title = normalizeTitle(item.Name);
    addLookup(byTitle, `${item.Type}|${title}|${Number(item.ProductionYear) || ""}`, item);
    addLookup(byTitle, `${item.Type}|${title}`, item);
  });

  const episodes = new Map();
  (episodesResult.rows || []).forEach((episode) => {
    addLookup(episodes, `${episode.SeriesId}|${Number(episode.ParentIndexNumber)}|${Number(episode.IndexNumber)}`, episode);
  });

  function findItem(type, media) {
    const ids = media?.ids || {};
    for (const provider of ["imdb", "tmdb", "tvdb"]) {
      const value = ids[provider] ? String(ids[provider]).toLowerCase() : "";
      const hit = value && byProvider.get(`${type}|${provider}|${value}`);
      if (hit) return { item: itemsById.get(hit.Id) || hit, via: provider };
    }
    const title = normalizeTitle(media?.title);
    const hit = byTitle.get(`${type}|${title}|${Number(media?.year) || ""}`) || (media?.year ? null : byTitle.get(`${type}|${title}`));
    return hit ? { item: hit, via: "title" } : null;
  }

  return {
    match(entry) {
      if (entry.type === "movie") {
        const found = findItem("Movie", entry.movie);
        return found ? { movie: found.item, via: found.via } : null;
      }
      const series = findItem("Series", entry.show);
      if (!series) return null;
      const episode = episodes.get(`${series.item.Id}|${Number(entry.episode?.season)}|${Number(entry.episode?.number)}`);
      return episode ? { series: series.item, episode, via: series.via } : { series: series.item, episode: null, via: series.via };
    },
  };
}

function traktEntryToRow(entry, match, jellyfinUser, source) {
  const watchedAt = new Date(entry.watchedAt).toISOString();
  const fallbackKey = `${entry.type}:${entry.movie?.ids?.trakt || entry.show?.ids?.trakt || normalizeTitle(entry.movie?.title || entry.show?.title)}:${entry.episode?.season ?? ""}x${entry.episode?.number ?? ""}:${watchedAt}`;
  const id = `trakt:${jellyfinUser.Id}:${entry.key || fallbackKey}`;
  const base = {
    Id: id,
    IsPaused: false,
    UserId: jellyfinUser.Id,
    UserName: jellyfinUser.Name,
    Client: "Trakt",
    DeviceName: source === "upload" ? "Trakt export" : "Trakt sync",
    DeviceId: "trakt",
    ApplicationVersion: null,
    PlayMethod: "DirectPlay",
    ActivityDateInserted: watchedAt,
    imported: true,
  };

  if (entry.type === "movie") {
    const runtime = match?.movie ? Math.round(Number(match.movie.RunTimeTicks || 0) / 10000000) : Number(entry.movie?.runtime || 0) * 60;
    return {
      ...base,
      NowPlayingItemId: match?.movie?.Id || `trakt:movie:${entry.movie?.ids?.trakt || normalizeTitle(entry.movie?.title)}`,
      NowPlayingItemName: match?.movie?.Name || entry.movie?.title || "Unknown movie",
      EpisodeId: null,
      SeasonId: null,
      SeriesName: null,
      PlaybackDuration: runtime,
    };
  }

  const episode = match?.episode;
  const runtime = episode ? Math.round(Number(episode.RunTimeTicks || 0) / 10000000) : Number(entry.episode?.runtime || 0) * 60;
  const showKey = entry.show?.ids?.trakt || normalizeTitle(entry.show?.title);
  return {
    ...base,
    NowPlayingItemId: match?.series?.Id || `trakt:show:${showKey}`,
    NowPlayingItemName: episode?.Name || entry.episode?.title || `S${entry.episode?.season}E${entry.episode?.number}`,
    EpisodeId: episode?.EpisodeId || `trakt:episode:${showKey}:${entry.episode?.season}x${entry.episode?.number}`,
    SeasonId: episode?.SeasonId || null,
    SeriesName: match?.series?.Name || entry.show?.title || null,
    PlaybackDuration: runtime,
  };
}

async function buildTraktImport({ entries, jellyfinUser, includeUnmatched, source }) {
  const matcher = await buildLibraryMatcher();
  const rows = [];
  const unmatched = new Map();
  let matched = 0;
  const via = { imdb: 0, tmdb: 0, tvdb: 0, title: 0 };

  entries.forEach((entry) => {
    const match = matcher.match(entry);
    const fullMatch = entry.type === "movie" ? Boolean(match?.movie) : Boolean(match?.episode);
    if (fullMatch) {
      matched += 1;
      via[match.via] = (via[match.via] || 0) + 1;
    } else {
      const label =
        entry.type === "movie"
          ? `${entry.movie?.title || "Unknown"}${entry.movie?.year ? ` (${entry.movie.year})` : ""}`
          : `${entry.show?.title || "Unknown"} S${String(entry.episode?.season ?? "?").padStart(2, "0")}E${String(entry.episode?.number ?? "?").padStart(2, "0")}`;
      const current = unmatched.get(label) || { title: label, type: entry.type, plays: 0, reason: match?.series ? "Episode not in library" : "Not in library" };
      current.plays += 1;
      unmatched.set(label, current);
      if (!includeUnmatched) return;
    }
    rows.push(traktEntryToRow(entry, fullMatch ? match : null, jellyfinUser, source));
  });

  const uniqueRows = Array.from(new Map(rows.map((row) => [row.Id, row])).values());
  const duplicates = await findDuplicateIds(uniqueRows, TRAKT_DUPLICATE_WINDOW_SECONDS);
  const newRows = uniqueRows.filter((row) => !duplicates.has(row.Id));

  return {
    rows: newRows,
    summary: {
      jellyfinUserId: jellyfinUser.Id,
      jellyfinUserName: jellyfinUser.Name,
      totalEntries: entries.length,
      matched,
      matchedBy: via,
      unmatched: entries.length - matched,
      duplicates: duplicates.size + (rows.length - uniqueRows.length),
      newPlays: newRows.length,
      includeUnmatched: Boolean(includeUnmatched),
      unmatchedItems: Array.from(unmatched.values()).sort((a, b) => b.plays - a.plays).slice(0, 50),
      ...dateRange(newRows),
    },
  };
}

async function resolveJellyfinUser(userId) {
  const users = await getKnownUsers();
  const user = users.find((entry) => entry.Id === userId);
  if (!user) throw new Error("Choose the Jellyfin user these plays belong to.");
  return user;
}

async function runTraktAccountSync(accountId, { preview = false, full = false, job = null } = {}) {
  const settings = await readSettings();
  const account = (settings.trakt.accounts || []).find((entry) => entry.id === accountId);
  if (!account) throw new Error("That Trakt account is no longer connected.");
  const jellyfinUser = await resolveJellyfinUser(account.jellyfinUserId);
  const startAt = !full && account.lastSyncAt ? new Date(new Date(account.lastSyncAt).getTime() - 24 * 60 * 60 * 1000).toISOString() : null;
  jobProgress(job, { stage: `Downloading ${account.username}'s Trakt history` });
  const history = await fetchTraktHistory(settings, account, { startAt });
  jobProgress(job, { stage: "Matching titles to your library" });
  const built = await buildTraktImport({
    entries: flattenTraktEntries(history),
    jellyfinUser,
    includeUnmatched: settings.trakt.includeUnmatched,
    source: "api",
  });
  if (preview) return { ...built.summary, username: account.username };

  const insertedRows = await insertRows(built.rows, job);
  const finishedAt = new Date().toISOString();
  await updateSettings((current) => {
    current.trakt.accounts = (current.trakt.accounts || []).map((entry) => (entry.id === accountId ? { ...entry, lastSyncAt: finishedAt } : entry));
    current.trakt.lastSyncAt = finishedAt;
    current.trakt.lastResult = { insertedRows, username: account.username };
    return current;
  });
  return { ...built.summary, username: account.username, insertedRows, finishedAt };
}

// ---------------------------------------------------------------------------
// Routes

router.get("/settings", async (req, res) => {
  try {
    const [settings, users] = await Promise.all([readSettings(), getKnownUsers()]);
    res.json({ ...publicSettings(settings), users, running: syncRunning, jobs: importJobs });
  } catch (error) {
    res.status(503).json({ error: error.message || "Unable to load import settings" });
  }
});

router.post("/jellyfin/settings", async (req, res) => {
  try {
    const next = await updateSettings((current) => {
      if (req.body?.autoSync !== undefined) current.jellyfin.autoSync = Boolean(req.body.autoSync);
      if (req.body?.intervalHours !== undefined) current.jellyfin.intervalHours = clampInterval(req.body.intervalHours);
      if (req.body?.includeInProgress !== undefined) current.jellyfin.includeInProgress = Boolean(req.body.includeInProgress);
      return current;
    });
    res.json(publicSettings(next));
  } catch (error) {
    res.status(503).json({ error: error.message || "Unable to save Jellyfin sync settings" });
  }
});

router.post("/jellyfin/preview", async (req, res) => {
  try {
    const settings = await readSettings();
    const { summary } = await buildJellyfinSync({
      userIds: Array.isArray(req.body?.userIds) ? req.body.userIds : [],
      includeInProgress: req.body?.includeInProgress ?? settings.jellyfin.includeInProgress,
    });
    res.json(summary);
  } catch (error) {
    res.status(503).json({ error: error.message || "Unable to preview Jellyfin watch data" });
  }
});

router.get("/jobs", (req, res) => {
  res.json({ jobs: importJobs, running: syncRunning });
});

router.post("/jellyfin/sync", async (req, res) => {
  if (req.body?.background) {
    if (syncRunning.jellyfin) {
      res.status(409).json({ error: "A Jellyfin sync is already running.", job: importJobs.jellyfin });
      return;
    }
    const job = startJob("jellyfin", "Jellyfin watch data sync");
    runJellyfinSync({ userIds: Array.isArray(req.body?.userIds) ? req.body.userIds : [], job })
      .then((result) => finishJob(job, { result }))
      .catch((error) => {
        console.error("Jellyfin watch data sync failed:", error.message);
        finishJob(job, { error: error.message || "Unable to sync Jellyfin watch data" });
      });
    res.status(202).json({ job });
    return;
  }
  try {
    const result = await runJellyfinSync({ userIds: Array.isArray(req.body?.userIds) ? req.body.userIds : [] });
    res.json(result);
  } catch (error) {
    console.error("Jellyfin watch data sync failed:", error.message);
    res.status(503).json({ error: error.message || "Unable to sync Jellyfin watch data" });
  }
});

router.post("/trakt/settings", async (req, res) => {
  try {
    const next = await updateSettings((current) => {
      if (req.body?.clientId !== undefined) current.trakt.clientId = String(req.body.clientId || "").trim();
      if (req.body?.clientSecret) current.trakt.clientSecret = encryptSecret(String(req.body.clientSecret).trim());
      if (req.body?.autoSync !== undefined) current.trakt.autoSync = Boolean(req.body.autoSync);
      if (req.body?.intervalHours !== undefined) current.trakt.intervalHours = clampInterval(req.body.intervalHours);
      if (req.body?.includeUnmatched !== undefined) current.trakt.includeUnmatched = Boolean(req.body.includeUnmatched);
      return current;
    });
    res.json(publicSettings(next));
  } catch (error) {
    res.status(503).json({ error: error.message || "Unable to save Trakt settings" });
  }
});

router.post("/trakt/device/start", async (req, res) => {
  try {
    const jellyfinUser = await resolveJellyfinUser(req.body?.jellyfinUserId);
    const settings = await readSettings();
    const { clientId } = traktCredentials(settings);
    const response = await axios.post(`${TRAKT_API}/oauth/device/code`, { client_id: clientId }, { headers: traktHeaders(clientId), timeout: 30000 });
    const sessionId = randomUUID();
    pendingDeviceCodes.set(sessionId, {
      deviceCode: response.data.device_code,
      jellyfinUser,
      expiresAt: Date.now() + Number(response.data.expires_in || 600) * 1000,
    });
    res.json({
      sessionId,
      userCode: response.data.user_code,
      verificationUrl: response.data.verification_url,
      interval: Number(response.data.interval || 5),
      expiresIn: Number(response.data.expires_in || 600),
    });
  } catch (error) {
    const status = error.response?.status;
    res.status(503).json({ error: status === 401 || status === 403 ? "Trakt rejected the Client ID. Check your Trakt app settings." : error.message || "Unable to start Trakt sign-in" });
  }
});

router.post("/trakt/device/poll", async (req, res) => {
  const session = pendingDeviceCodes.get(req.body?.sessionId);
  if (!session) {
    res.status(404).json({ error: "This Trakt sign-in has expired. Start again." });
    return;
  }
  if (Date.now() > session.expiresAt) {
    pendingDeviceCodes.delete(req.body.sessionId);
    res.json({ status: "expired" });
    return;
  }
  try {
    const settings = await readSettings();
    const { clientId, clientSecret } = traktCredentials(settings);
    const response = await axios.post(
      `${TRAKT_API}/oauth/device/token`,
      { code: session.deviceCode, client_id: clientId, client_secret: clientSecret },
      { headers: traktHeaders(clientId), timeout: 30000, validateStatus: () => true }
    );
    if (response.status === 400) {
      res.json({ status: "pending" });
      return;
    }
    if (response.status === 429) {
      res.json({ status: "slow_down" });
      return;
    }
    if (response.status !== 200) {
      pendingDeviceCodes.delete(req.body.sessionId);
      const reasons = { 404: "invalid", 409: "used", 410: "expired", 418: "denied" };
      res.json({ status: reasons[response.status] || "failed" });
      return;
    }

    pendingDeviceCodes.delete(req.body.sessionId);
    const token = response.data;
    const profile = await axios
      .get(`${TRAKT_API}/users/settings`, { headers: traktHeaders(clientId, token.access_token), timeout: 30000 })
      .then((result) => result.data)
      .catch(() => null);
    const username = profile?.user?.username || profile?.user?.name || "Trakt user";
    const account = {
      id: randomUUID(),
      username,
      jellyfinUserId: session.jellyfinUser.Id,
      jellyfinUserName: session.jellyfinUser.Name,
      accessToken: encryptSecret(token.access_token),
      refreshToken: encryptSecret(token.refresh_token),
      expiresAt: new Date((Number(token.created_at) + Number(token.expires_in)) * 1000).toISOString(),
      connectedAt: new Date().toISOString(),
      lastSyncAt: null,
    };
    const next = await updateSettings((current) => {
      current.trakt.accounts = [...(current.trakt.accounts || []).filter((entry) => !(entry.username === username && entry.jellyfinUserId === account.jellyfinUserId)), account];
      return current;
    });
    res.json({ status: "connected", settings: publicSettings(next) });
  } catch (error) {
    res.status(503).json({ error: error.message || "Unable to finish Trakt sign-in" });
  }
});

router.delete("/trakt/accounts/:id", async (req, res) => {
  try {
    const next = await updateSettings((current) => {
      current.trakt.accounts = (current.trakt.accounts || []).filter((entry) => entry.id !== req.params.id);
      return current;
    });
    res.json(publicSettings(next));
  } catch (error) {
    res.status(503).json({ error: error.message || "Unable to disconnect Trakt account" });
  }
});

router.post("/trakt/accounts/:id/preview", async (req, res) => {
  try {
    res.json(await runTraktAccountSync(req.params.id, { preview: true, full: true }));
  } catch (error) {
    res.status(503).json({ error: error.response?.status === 401 ? "Trakt sign-in expired. Reconnect this account." : error.message || "Unable to preview Trakt history" });
  }
});

router.post("/trakt/accounts/:id/import", async (req, res) => {
  if (syncRunning.trakt) {
    res.status(409).json({ error: "A Trakt import is already running." });
    return;
  }
  syncRunning.trakt = true;
  if (req.body?.background) {
    const job = startJob("trakt", "Trakt history import");
    runTraktAccountSync(req.params.id, { full: Boolean(req.body?.full ?? true), job })
      .then((result) => finishJob(job, { result }))
      .catch((error) => {
        console.error("Trakt import failed:", error.message);
        finishJob(job, { error: error.response?.status === 401 ? "Trakt sign-in expired. Reconnect this account." : error.message || "Unable to import Trakt history" });
      })
      .finally(() => {
        syncRunning.trakt = false;
      });
    res.status(202).json({ job });
    return;
  }
  try {
    res.json(await runTraktAccountSync(req.params.id, { full: Boolean(req.body?.full ?? true) }));
  } catch (error) {
    console.error("Trakt import failed:", error.message);
    res.status(503).json({ error: error.response?.status === 401 ? "Trakt sign-in expired. Reconnect this account." : error.message || "Unable to import Trakt history" });
  } finally {
    syncRunning.trakt = false;
  }
});

function parseUploadedJson(req) {
  if (!req.file) throw new Error("No Trakt export uploaded.");
  try {
    return JSON.parse(req.file.buffer.toString("utf8"));
  } catch {
    throw new Error("That file isn't valid JSON. Upload a Trakt watched-history .json export.");
  }
}

function uploadHandler(commit) {
  return (req, res) => {
    upload.single("file")(req, res, async (uploadError) => {
      if (uploadError) {
        res.status(400).json({ error: uploadError.message || "Unable to upload Trakt export" });
        return;
      }
      try {
        const entries = flattenTraktEntries(parseUploadedJson(req));
        if (!entries.length) throw new Error("No watch history found in that file. Use watched-history.json (or watched-movies / watched-shows).");
        const jellyfinUser = await resolveJellyfinUser(req.body?.jellyfinUserId);
        const settings = await readSettings();
        const includeUnmatched = req.body?.includeUnmatched !== undefined ? req.body.includeUnmatched === "true" : settings.trakt.includeUnmatched;
        const built = await buildTraktImport({ entries, jellyfinUser, includeUnmatched, source: "upload" });
        if (!commit) {
          res.json({ ...built.summary, originalName: req.file.originalname, size: req.file.size });
          return;
        }
        const insertedRows = await insertRows(built.rows);
        res.json({ ...built.summary, originalName: req.file.originalname, insertedRows });
      } catch (error) {
        res.status(400).json({ error: error.message || "Unable to read Trakt export" });
      }
    });
  };
}

router.post("/trakt/upload/preview", uploadHandler(false));
router.post("/trakt/upload/import", uploadHandler(true));

// ---------------------------------------------------------------------------
// Scheduled syncs (checked hourly, run when the configured interval has passed)

function isDue(lastSyncAt, intervalHours) {
  if (!lastSyncAt) return true;
  return Date.now() - new Date(lastSyncAt).getTime() >= clampInterval(intervalHours) * 60 * 60 * 1000;
}

async function scheduledTick() {
  try {
    const settings = await readSettings();
    if (settings.jellyfin.autoSync && !syncRunning.jellyfin && isDue(settings.jellyfin.lastSyncAt, settings.jellyfin.intervalHours)) {
      const job = startJob("jellyfin", "Scheduled Jellyfin watch data sync");
      const result = await runJellyfinSync({ job }).catch((error) => {
        finishJob(job, { error: error.message });
        throw error;
      });
      finishJob(job, { result });
      console.log(`[IMPORTS] Jellyfin watch data sync added ${result.insertedRows} plays`);
    }
    if (settings.trakt.autoSync && !syncRunning.trakt && isDue(settings.trakt.lastSyncAt, settings.trakt.intervalHours)) {
      syncRunning.trakt = true;
      try {
        for (const account of settings.trakt.accounts || []) {
          const result = await runTraktAccountSync(account.id).catch((error) => {
            console.error(`[IMPORTS] Trakt sync failed for ${account.username}:`, error.message);
            return null;
          });
          if (result) console.log(`[IMPORTS] Trakt sync for ${account.username} added ${result.insertedRows} plays`);
        }
      } finally {
        syncRunning.trakt = false;
      }
    }
  } catch (error) {
    console.error("[IMPORTS] Scheduled import check failed:", error.message);
  }
}

if (process.env.NODE_ENV !== "test" && process.env.JG_DISABLE_SERVER_AUTOMATION !== "1") {
  const firstRun = setTimeout(scheduledTick, 5 * 60 * 1000);
  const interval = setInterval(scheduledTick, 60 * 60 * 1000);
  firstRun.unref?.();
  interval.unref?.();
}

module.exports = router;
module.exports._internal = { flattenTraktEntries, jellyfinItemToRow, normalizeTitle };

// Read-only data for the extra newsletter report-builder blocks. Never
// writes to Jellyfin, Arr, Seerr or Wizarr, and never creates invites.
const db = require("../db");
const autoCollections = require("./auto-collections");
const seerrRequests = require("./newsletter-seerr-requests");
const { getIntegrations, getIntegrationData } = require("./integration-store");
const publicUrl = require("./newsletter-public-url");

function asItem(row, extra = {}) {
  return {
    Id: row.Id || row.id || "",
    id: row.Id || row.id || "",
    Name: row.Name || row.name || "",
    Type: row.Type || row.type || "",
    Library: row.Library || row.library || "",
    PrimaryImageHash: row.PrimaryImageHash || row.primary_image_hash || "",
    ProductionYear: row.ProductionYear || row.year || row.production_year || "",
    CommunityRating: row.CommunityRating || row.rating || null,
    BackdropImageTags: row.BackdropImageTags || row.backdrop_image_tags || "",
    HasBackdrop: Boolean(row.HasBackdrop || (row.BackdropImageTags && row.BackdropImageTags !== "[]") || row.backdrop_image_tags),
    Plays: row.Plays != null ? Number(row.Plays) : row.plays != null ? Number(row.plays) : undefined,
    ...extra,
  };
}

function libraryClause(alias, libraryId, params) {
  if (!libraryId) return "";
  params.push(libraryId);
  return ` AND ${alias}."ParentId" = $${params.length}`;
}

async function listHero({ itemId = "", libraryId = "", now } = {}) {
  const params = [];
  let where = `i.archived IS NOT TRUE AND i."Type" IN ('Movie', 'Series') AND COALESCE(i."BackdropImageTags", '') <> '' AND i."BackdropImageTags" <> '[]'`;
  if (itemId) {
    params.push(itemId);
    const { rows } = await db.query(
      `SELECT i."Id", i."Name", i."Type", i."PrimaryImageHash", i."ProductionYear", i."CommunityRating",
              i."BackdropImageTags", i."Genres", l."Name" AS "Library"
         FROM jf_library_items i
         LEFT JOIN jf_libraries l ON l."Id" = i."ParentId"
        WHERE i."Id" = $1 AND i.archived IS NOT TRUE`,
      params
    );
    if (rows[0]) return asItem(rows[0], { Genres: rows[0].Genres || [], HasBackdrop: true });
  }
  const lib = libraryClause("i", libraryId, params);
  const { rows } = await db.query(
    `WITH week AS (
        SELECT COALESCE(e."SeriesId", a."NowPlayingItemId") AS item_id, COUNT(*)::int AS plays
          FROM jf_playback_activity a
          LEFT JOIN jf_library_episodes e ON e."EpisodeId" = COALESCE(a."EpisodeId", a."NowPlayingItemId")
         WHERE a."ActivityDateInserted" >= now() - interval '7 days'
         GROUP BY 1
      )
      SELECT i."Id", i."Name", i."Type", i."PrimaryImageHash", i."ProductionYear", i."CommunityRating",
             i."BackdropImageTags", i."Genres", l."Name" AS "Library", COALESCE(week.plays, 0) AS plays
        FROM jf_library_items i
        LEFT JOIN week ON week.item_id = i."Id"
        LEFT JOIN jf_libraries l ON l."Id" = i."ParentId"
       WHERE ${where}${lib}
       ORDER BY COALESCE(week.plays, 0) DESC, i."CommunityRating" DESC NULLS LAST, i."DateCreated" DESC
       LIMIT 1`,
    params
  );
  const row = rows[0];
  if (!row) return null;
  return asItem(row, { Genres: row.Genres || [], HasBackdrop: true, Plays: row.plays });
}

async function listNewEpisodes({ userId = "", days = 14, limit = 8 } = {}) {
  if (!userId) return [];
  const { rows } = await db.query(
    `WITH watched AS (
        SELECT DISTINCT e."SeriesId" AS series_id
          FROM jf_playback_activity a
          JOIN jf_library_episodes e ON e."EpisodeId" = COALESCE(a."EpisodeId", a."NowPlayingItemId")
         WHERE a."UserId" = $1
           AND e."SeriesId" IS NOT NULL
      )
      SELECT e."EpisodeId" AS id, e."Name" AS name, e."SeriesName" AS series_name,
             e."SeasonName" AS season_name, e."ParentIndexNumber" AS season,
             e."IndexNumber" AS episode, e."DateCreated" AS added, e."PremiereDate" AS premiered,
             e."PrimaryImageHash" AS primary_image_hash, e."SeriesId" AS series_id,
             e."ParentBackdropItemId" AS backdrop_id, e."Type" AS type
        FROM jf_library_episodes e
        JOIN watched w ON w.series_id = e."SeriesId"
       WHERE e.archived IS NOT TRUE
         AND e."DateCreated" >= now() - make_interval(days => $2)
       ORDER BY e."DateCreated" DESC NULLS LAST
       LIMIT $3`,
    [userId, Number(days) || 14, Number(limit) || 8]
  );
  return rows.map((row) =>
    asItem({
      Id: row.id,
      Name: row.series_name ? `${row.series_name} — ${row.name}` : row.name,
      Type: "Episode",
      PrimaryImageHash: row.primary_image_hash,
    }, {
      SeriesName: row.series_name,
      EpisodeName: row.name,
      Season: row.season,
      Episode: row.episode,
      SeriesId: row.series_id,
    })
  );
}

async function listTrendingWeek({ limit = 8, libraryId = "", days = 7 } = {}) {
  const params = [Number(days) || 7, Number(limit) || 8];
  const lib = libraryClause("i", libraryId, params);
  const { rows } = await db.query(
    `SELECT i."Id", i."Name", i."Type", i."PrimaryImageHash", i."ProductionYear",
            l."Name" AS "Library", COUNT(a."Id")::int AS "Plays",
            COALESCE(SUM(a."PlaybackDuration"), 0)::bigint AS "WatchSeconds"
       FROM jf_playback_activity a
       LEFT JOIN jf_library_episodes e ON e."EpisodeId" = COALESCE(a."EpisodeId", a."NowPlayingItemId")
       JOIN jf_library_items i ON i."Id" = COALESCE(e."SeriesId", a."NowPlayingItemId")
       LEFT JOIN jf_libraries l ON l."Id" = i."ParentId"
      WHERE a."ActivityDateInserted" >= now() - make_interval(days => $1)
        AND i.archived IS NOT TRUE
        AND i."Type" IN ('Movie', 'Series')${lib}
      GROUP BY i."Id", l."Name"
      ORDER BY COUNT(a."Id") DESC, COALESCE(SUM(a."PlaybackDuration"), 0) DESC
      LIMIT $2`,
    params
  );
  return rows.map((row) => asItem(row));
}

async function listTopRequesters({ limit = 8, userName = "" } = {}) {
  const requests = await seerrRequests.fetchLiteSeerrRequests({ userName: "", take: 100 }).catch(() => []);
  const counts = new Map();
  for (const request of requests) {
    const name = String(request.requestedBy || "").trim();
    if (!name) continue;
    if (userName && !name.toLowerCase().includes(String(userName).toLowerCase())) continue;
    counts.set(name, (counts.get(name) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, Number(limit) || 8)
    .map(([Name, Plays]) => ({ Name, Plays, Type: "Requester" }));
}

async function listCollectionSpotlight({ limit = 6, libraryId = "" } = {}) {
  const builders = await autoCollections.listBuilders().catch(() => []);
  const scoped = libraryId ? builders.filter((builder) => builder.libraryId === libraryId) : builders;
  const ids = scoped.map((builder) => builder.id);
  const counts = new Map();
  if (ids.length) {
    const { rows } = await db.query(
      `SELECT DISTINCT ON (builder_id) builder_id, item_count
         FROM jg_collection_runs
        WHERE builder_id = ANY($1)
        ORDER BY builder_id, created_at DESC`,
      [ids]
    ).catch(() => ({ rows: [] }));
    rows.forEach((row) => counts.set(String(row.builder_id), Number(row.item_count) || 0));
  }
  const collections = [];
  for (const builder of scoped.slice(0, 6)) {
    let items = [];
    if (builder.type === "recently_added") {
      items = await listRecentInLibrary(builder.libraryId, Math.min(6, Number(limit) || 6));
    } else if (builder.type === "trending") {
      items = await listTrendingWeek({ limit: Math.min(6, Number(limit) || 6), libraryId: builder.libraryId, days: 7 });
    }
    collections.push({
      id: builder.id,
      name: builder.name,
      type: builder.type,
      libraryName: builder.libraryName || "",
      count: counts.get(String(builder.id)) || items.length,
      items,
    });
  }
  return collections;
}

async function listRecentInLibrary(libraryId, limit = 6) {
  if (!libraryId) return [];
  const { rows } = await db.query(
    `SELECT i."Id", i."Name", i."Type", i."PrimaryImageHash", i."ProductionYear", l."Name" AS "Library"
       FROM jf_library_items i
       LEFT JOIN jf_libraries l ON l."Id" = i."ParentId"
      WHERE i."ParentId" = $1 AND i.archived IS NOT TRUE AND i."Type" IN ('Movie', 'Series')
      ORDER BY i."DateCreated" DESC NULLS LAST
      LIMIT $2`,
    [libraryId, Number(limit) || 6]
  );
  return rows.map((row) => asItem(row));
}

function qualityLabels(stream) {
  const height = Number(stream.height || stream.Height || 0);
  const width = Number(stream.width || stream.Width || 0);
  const text = `${stream.VideoRange || ""} ${stream.VideoRangeType || ""} ${stream.DisplayTitle || ""} ${stream.Profile || ""}`;
  const labels = [];
  if (height >= 2000 || width >= 3000 || /2160|4k|\buhd\b/i.test(text)) labels.push("4K");
  if (/dolby.?vision|\bdovi\b|dvhe/i.test(text)) labels.push("Dolby Vision");
  else if (/\bhdr/i.test(text)) labels.push("HDR");
  return labels;
}

function videoStream(mediaStreams) {
  const list = Array.isArray(mediaStreams) ? mediaStreams : [];
  return list.find((stream) => String(stream.Type || stream.type) === "Video") || null;
}

async function listQualityUpgrades({ limit = 8, libraryId = "" } = {}) {
  const params = [];
  const lib = libraryClause("i", libraryId, params);
  params.push(Number(limit) || 8);
  const { rows } = await db.query(
    `SELECT i."Id", i."Name", i."Type", i."PrimaryImageHash", i."ProductionYear",
            l."Name" AS "Library", ii."MediaStreams"
       FROM jf_library_items i
       JOIN jf_item_info ii ON ii."Id" = i."Id"
       LEFT JOIN jf_libraries l ON l."Id" = i."ParentId"
      WHERE i.archived IS NOT TRUE AND i."Type" IN ('Movie', 'Video')${lib}
        AND ii."MediaStreams"::text ~* '2160|4k|uhd|hdr|dovi|dolby.?vision'
      ORDER BY i."DateCreated" DESC NULLS LAST
      LIMIT 80`,
    params.slice(0, -1)
  );
  const items = [];
  for (const row of rows) {
    const stream = videoStream(row.MediaStreams);
    if (!stream) continue;
    const labels = qualityLabels(stream);
    if (!labels.length) continue;
    items.push(asItem(row, { quality: labels }));
    if (items.length >= (Number(limit) || 8)) break;
  }
  return items;
}

function formatBytes(bytes = 0) {
  const value = Number(bytes || 0);
  if (!value) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${(value / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

async function listServerStats() {
  const { rows: libraries } = await db.query(
    `SELECT l."Id" AS id, l."Name" AS name,
            COALESCE(SUM(info."Size"), 0)::bigint AS bytes,
            COUNT(i."Id")::int AS items
       FROM jf_libraries l
       LEFT JOIN jf_library_items i ON i."ParentId" = l."Id" AND i.archived = false
       LEFT JOIN jf_item_info info ON info."Id" = i."Id"
      GROUP BY l."Id", l."Name"
      ORDER BY COALESCE(SUM(info."Size"), 0) DESC`
  );
  const totalBytes = libraries.reduce((sum, row) => sum + Number(row.bytes || 0), 0);
  const calendar = (await getIntegrationData().catch(() => ({ calendar: { releases: [] } }))).calendar?.releases || [];
  const upcoming = calendar.filter((row) => !row.hasFile);
  const upcomingBytes = upcoming.length * 1.4 * 1024 * 1024 * 1024;
  const [counts] = await db.query(
    `SELECT
        (SELECT count(*)::int FROM jf_libraries) AS libraries,
        (SELECT count(*)::int FROM jf_library_items WHERE archived IS NOT TRUE) AS items,
        (SELECT count(*)::int FROM jf_users) AS users`
  ).then((res) => res.rows);
  return {
    totalLabel: formatBytes(totalBytes),
    totalBytes,
    upcomingEstimate: formatBytes(upcomingBytes),
    upcomingCount: upcoming.length,
    libraries: Number(counts?.libraries || libraries.length || 0),
    items: Number(counts?.items || 0),
    users: Number(counts?.users || 0),
    librarySizes: libraries.slice(0, 6).map((row) => ({ name: row.name, size: formatBytes(row.bytes), items: row.items, bytes: Number(row.bytes || 0) })),
  };
}

async function listGenreChart({ days = 7, limit = 8, libraryId = "" } = {}) {
  const params = [Number(days) || 7, Number(limit) || 8];
  const lib = libraryClause("i", libraryId, params);
  let rows = [];
  try {
  const result = await db.query(
    `SELECT g.genre AS "Name", COUNT(*)::int AS "Plays"
       FROM jf_playback_activity a
       LEFT JOIN jf_library_episodes e ON e."EpisodeId" = COALESCE(a."EpisodeId", a."NowPlayingItemId")
       JOIN jf_library_items i ON i."Id" = COALESCE(e."SeriesId", a."NowPlayingItemId")
       CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(i."Genres", '[]'::jsonb)) AS g(genre)
      WHERE a."ActivityDateInserted" >= now() - make_interval(days => $1)
        AND i.archived IS NOT TRUE${lib}
        AND g.genre <> ''
      GROUP BY g.genre
      ORDER BY COUNT(*) DESC, g.genre
      LIMIT $2`,
    params
  );
  rows = result.rows;
  } catch {
    rows = [];
  }
  return rows;
}

async function listHiddenGem({ libraryId = "", limit = 1 } = {}) {
  const params = [Number(limit) || 1];
  const lib = libraryClause("i", libraryId, params);
  const { rows } = await db.query(
    `WITH play AS (
        SELECT COALESCE(e."SeriesId", a."NowPlayingItemId") AS item_id, COUNT(*)::int AS plays
          FROM jf_playback_activity a
          LEFT JOIN jf_library_episodes e ON e."EpisodeId" = COALESCE(a."EpisodeId", a."NowPlayingItemId")
         GROUP BY 1
      )
      SELECT i."Id", i."Name", i."Type", i."PrimaryImageHash", i."ProductionYear",
             i."CommunityRating", l."Name" AS "Library", COALESCE(play.plays, 0)::int AS "Plays"
        FROM jf_library_items i
        LEFT JOIN play ON play.item_id = i."Id"
        LEFT JOIN jf_libraries l ON l."Id" = i."ParentId"
       WHERE i.archived IS NOT TRUE
         AND i."Type" IN ('Movie', 'Series')
         AND i."CommunityRating" >= 7.5
         AND i."DateCreated" < now() - interval '90 days'${lib}
         AND COALESCE(play.plays, 0) <= 3
       ORDER BY i."CommunityRating" DESC, COALESCE(play.plays, 0) ASC, i."Name"
       LIMIT $1`,
    params
  );
  return rows.map((row) => asItem(row, { CommunityRating: row.CommunityRating, Plays: row.Plays }));
}

async function listOnThisDay({ now = new Date(), libraryId = "", limit = 8 } = {}) {
  const month = now.getMonth() + 1;
  const day = now.getDate();
  const year = now.getFullYear();
  const params = [month, day, year, Number(limit) || 8];
  const lib = libraryClause("i", libraryId, params);
  const { rows } = await db.query(
    `SELECT i."Id", i."Name", i."Type", i."PrimaryImageHash", i."ProductionYear",
            l."Name" AS "Library", i."PremiereDate", i."CommunityRating"
       FROM jf_library_items i
       LEFT JOIN jf_libraries l ON l."Id" = i."ParentId"
      WHERE i.archived IS NOT TRUE
        AND i."Type" IN ('Movie', 'Series')
        AND i."PremiereDate" IS NOT NULL
        AND EXTRACT(MONTH FROM i."PremiereDate") = $1
        AND EXTRACT(DAY FROM i."PremiereDate") = $2
        AND EXTRACT(YEAR FROM i."PremiereDate") <> $3${lib}
      ORDER BY i."CommunityRating" DESC NULLS LAST, i."PremiereDate" DESC
      LIMIT $4`,
    params
  );
  return rows.map((row) =>
    asItem(row, { year: row.PremiereDate ? new Date(row.PremiereDate).getUTCFullYear() : row.ProductionYear })
  );
}

async function resolveWizarrInviteUrl(override) {
  const direct = publicUrl.safeHttpUrl(override);
  if (direct) return direct;
  const integrations = await getIntegrations().catch(() => ({ thirdParty: [] }));
  const app = (integrations.thirdParty || []).find((integration) => {
    const name = String(integration?.name || integration?.slug || "").toLowerCase();
    return integration.connected && (name === "wizarr" || name.includes("wizarr"));
  });
  if (!app) return "";
  return publicUrl.safeHttpUrl(String(app.values?.url || "").trim().replace(/\/+$/, ""));
}

function countdownFrom(dateValue, now = new Date()) {
  if (!dateValue) return { days: null, hasDate: false };
  const raw = String(dateValue).length === 10 ? `${dateValue}T00:00:00` : dateValue;
  const at = new Date(raw);
  if (!Number.isFinite(at.getTime())) return { days: null, hasDate: false };
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(at.getFullYear(), at.getMonth(), at.getDate());
  const days = Math.round((target.getTime() - start.getTime()) / 86400000);
  return { days, hasDate: true, at: at.toISOString() };
}

module.exports = {
  listHero,
  listNewEpisodes,
  listTrendingWeek,
  listTopRequesters,
  listCollectionSpotlight,
  listQualityUpgrades,
  listServerStats,
  listGenreChart,
  listHiddenGem,
  listOnThisDay,
  resolveWizarrInviteUrl,
  countdownFrom,
  qualityLabels,
};

// api.js
const express = require("express");
const db = require("../db");
const dbHelper = require("../classes/db-helper");

const dayjs = require("dayjs");
const { getIntegrations } = require("../classes/integration-store");
const { fetchHouseholdWatchTonight } = require("../classes/watch-tonight");
const { sendSafeError } = require("../utils/security");
const { catalogCountSql, catalogCounts, groupPlaysByType } = require("../classes/library-types");
const {
  canViewAllUsers,
  normalizeUserId,
  ownMediaUserId,
  resolveActivityScope,
  resolveStatsUser,
  restrictQueryToUser,
  sameUserId,
  sendForbidden,
} = require("../classes/stats-access");

const router = express.Router();

router.use((req, res, next) => {
  const pathName = String(req.path || "").toLowerCase();
  if (pathName === "/gethomedashboard") {
    if (req.permissions?.home === false) {
      return res.status(403).json({ message: "Permission required: home" });
    }
    return next();
  }
  if (pathName === "/repair-hub") {
    if (req.permissions?.repair || req.permissions?.settings) return next();
    return res.status(403).json({ message: "Permission required: repair" });
  }
  next();
});

//functions
function countOverlapsPerHour(records) {
  const hourCounts = {};

  records.forEach((record) => {
    const start = dayjs(record.StartTime).subtract(1, "hour");
    const end = dayjs(record.EndTime).add(1, "hour");

    // Iterate through each hour from start to end
    for (let hour = start.clone().startOf("hour"); hour.isBefore(end); hour.add(1, "hour")) {
      const hourKey = hour.format("MMM DD, YY HH:00");
      if (!hourCounts[hourKey]) {
        hourCounts[hourKey] = { Transcodes: 0, DirectPlays: 0 };
      }
      if (record.PlayMethod === "Transcode") {
        hourCounts[hourKey].Transcodes++;
      } else {
        hourCounts[hourKey].DirectPlays++;
      }
    }
  });

  // Convert the hourCounts object to an array of key-value pairs, sort it, and convert it back to an object
  const sortedHourCounts = Object.fromEntries(Object.entries(hourCounts).sort(([keyA], [keyB]) => keyA.localeCompare(keyB)));

  return sortedHourCounts;
}

const sortMap = [
  { field: "UserName", column: "UserName" },
  { field: "RemoteEndPoint", column: "RemoteEndPoint" },
  { field: "NowPlayingItemName", column: "NowPlayingItemName" },
  { field: "Client", column: "Client" },
  { field: "DeviceName", column: "DeviceName" },
  { field: "ActivityDateInserted", column: "ActivityDateInserted" },
  { field: "PlaybackDuration", column: "PlaybackDuration" },
  { field: "PlayMethod", column: "PlayMethod" },
];

const filterFields = [
  { field: "Id", column: "Id", isColumn: true },
  { field: "IsPaused", column: "IsPaused", isColumn: true },
  { field: "UserId", column: "UserId", isColumn: true },
  { field: "UserName", column: `LOWER(a."UserName")` },
  { field: "Client", column: `LOWER(a."Client")` },
  { field: "DeviceName", column: `LOWER(a."DeviceName")` },
  { field: "DeviceId", column: "DeviceId", isColumn: true },
  { field: "ApplicationVersion", column: "ApplicationVersion", isColumn: true },
  { field: "NowPlayingItemId", column: "NowPlayingItemId", isColumn: true },
  { field: "NowPlayingItemName", column: `LOWER(a."NowPlayingItemName")` },
  { field: "SeasonId", column: "SeasonId", isColumn: true },
  { field: "SeriesName", column: `LOWER(a."SeriesName")` },
  { field: "EpisodeId", column: "EpisodeId", isColumn: true },
  { field: "PlaybackDuration", column: "PlaybackDuration", isColumn: true },
  { field: "ActivityDateInserted", column: "ActivityDateInserted", isColumn: true },
  { field: "PlayMethod", column: `LOWER(a."PlayMethod")` },
  { field: "OriginalContainer", column: "OriginalContainer", isColumn: true },
  { field: "RemoteEndPoint", column: "RemoteEndPoint", isColumn: true },
  { field: "ServerId", column: "ServerId", isColumn: true },
  { field: "imported", column: "imported", isColumn: true },
];

//endpoints

router.get("/repair-hub", async (req, res) => {
  try {
    const [
      issueCounts,
      missingPosters,
      missingLogos,
      missingRuntime,
      emptySeries,
      orphanedActivity,
      importedUnmatched,
      recentTaskFailures,
      transcodeClients,
      failedStarts,
    ] = await Promise.all([
      db.query(`
        SELECT
          count(*) FILTER (WHERE COALESCE("PrimaryImageHash", '') = '')::int AS "MissingPosters",
          count(*) FILTER (WHERE COALESCE("ImageTagsLogo", '') = '')::int AS "MissingLogos",
          count(*) FILTER (WHERE COALESCE("RunTimeTicks", 0) = 0)::int AS "MissingRuntime"
        FROM jf_library_items
        WHERE archived = false
      `),
      db.query(`
        SELECT "Id", "Name", "Type", "ProductionYear", "ParentId"
        FROM jf_library_items
        WHERE archived = false
          AND COALESCE("PrimaryImageHash", '') = ''
        ORDER BY "Name" ASC
        LIMIT 8
      `),
      db.query(`
        SELECT "Id", "Name", "Type", "ProductionYear", "ParentId"
        FROM jf_library_items
        WHERE archived = false
          AND COALESCE("ImageTagsLogo", '') = ''
        ORDER BY "Name" ASC
        LIMIT 8
      `),
      db.query(`
        SELECT "Id", "Name", "Type", "ProductionYear", "ParentId"
        FROM jf_library_items
        WHERE archived = false
          AND COALESCE("RunTimeTicks", 0) = 0
        ORDER BY "Name" ASC
        LIMIT 8
      `),
      db.query(`
        SELECT i."Id", i."Name", i."Type", i."ProductionYear", i."ParentId", count(e."EpisodeId")::int AS "EpisodeCount"
        FROM jf_library_items i
        LEFT JOIN jf_library_episodes e ON e."SeriesId" = i."Id" AND COALESCE(e.archived, false) = false
        WHERE i.archived = false
          AND i."Type" = 'Series'
        GROUP BY i."Id", i."Name", i."Type", i."ProductionYear", i."ParentId"
        HAVING count(e."EpisodeId") = 0
        ORDER BY i."Name" ASC
        LIMIT 8
      `),
      db.query(`
        SELECT
          count(*)::int AS "Count",
          max(a."ActivityDateInserted") AS "LastSeen"
        FROM jf_playback_activity a
        LEFT JOIN jf_library_items i ON i."Id" = a."NowPlayingItemId"
        LEFT JOIN jf_library_episodes e ON e."EpisodeId" = a."EpisodeId"
        WHERE a."NowPlayingItemId" IS NOT NULL
          AND a."NowPlayingItemId" NOT LIKE 'tautulli:%'
          AND i."Id" IS NULL
          AND (a."EpisodeId" IS NULL OR e."EpisodeId" IS NULL)
      `),
      db.query(`
        SELECT count(*)::int AS "Count", max("ActivityDateInserted") AS "LastSeen"
        FROM jf_playback_activity
        WHERE imported = true
          AND "Id" LIKE 'tautulli:%'
          AND "NowPlayingItemId" LIKE 'tautulli:%'
      `),
      db.query(`
        SELECT "Id", "Name", "Result", "TimeRun", "Duration"
        FROM jf_logging
        WHERE lower(COALESCE("Result", '')) NOT IN ('success', 'completed', 'ok', 'skipped')
        ORDER BY "TimeRun" DESC
        LIMIT 6
      `),
      db.query(`
        SELECT
          COALESCE(NULLIF("Client", ''), 'Unknown') AS "Client",
          COALESCE(NULLIF("DeviceName", ''), 'Unknown') AS "DeviceName",
          count(*)::int AS "Plays",
          count(*) FILTER (WHERE lower(COALESCE("PlayMethod", '')) LIKE '%transcode%')::int AS "Transcodes"
        FROM jf_playback_activity
        WHERE "ActivityDateInserted" > NOW() - INTERVAL '30 days'
        GROUP BY 1, 2
        HAVING count(*) FILTER (WHERE lower(COALESCE("PlayMethod", '')) LIKE '%transcode%') >= 3
        ORDER BY "Transcodes" DESC, "Plays" DESC
        LIMIT 8
      `).catch(() => ({ rows: [] })),
      db.query(`
        SELECT
          COALESCE("NowPlayingItemId", '') AS "Id",
          COALESCE(NULLIF("SeriesName", ''), "NowPlayingItemName") AS "Name",
          count(*)::int AS "Fails",
          max("ActivityDateInserted") AS "LastSeen"
        FROM jf_playback_activity
        WHERE "ActivityDateInserted" > NOW() - INTERVAL '30 days'
          AND COALESCE("PlaybackDuration", 0) < 20
          AND COALESCE("NowPlayingItemId", '') <> ''
        GROUP BY 1, 2
        HAVING count(*) >= 3
        ORDER BY "Fails" DESC, max("ActivityDateInserted") DESC
        LIMIT 8
      `).catch(() => ({ rows: [] })),
    ]);

    const counts = issueCounts.rows[0] || {};
    const orphaned = orphanedActivity.rows[0] || {};
    const unmatched = importedUnmatched.rows[0] || {};

    res.send({
      checkedAt: new Date().toISOString(),
      counts: {
        missingPosters: Number(counts.MissingPosters || 0),
        missingLogos: Number(counts.MissingLogos || 0),
        missingRuntime: Number(counts.MissingRuntime || 0),
        emptySeries: emptySeries.rowCount,
        orphanedActivity: Number(orphaned.Count || 0),
        unmatchedImports: Number(unmatched.Count || 0),
        taskFailures: recentTaskFailures.rowCount,
        transcodeClients: (transcodeClients.rows || []).length,
        failedStarts: (failedStarts.rows || []).length,
      },
      samples: {
        missingPosters: missingPosters.rows,
        missingLogos: missingLogos.rows,
        missingRuntime: missingRuntime.rows,
        emptySeries: emptySeries.rows,
        taskFailures: recentTaskFailures.rows,
        transcodeClients: transcodeClients.rows,
        failedStarts: failedStarts.rows,
      },
      activityLinks: {
        orphanedLastSeen: orphaned.LastSeen || null,
        unmatchedLastSeen: unmatched.LastSeen || null,
      },
    });
  } catch (error) {
    console.log(error);
    res.status(503).send({ error: "Unable to build repair hub" });
  }
});

router.get("/getLibraryOverview", async (req, res) => {
  try {
    const { rows } = await db.query("SELECT * FROM jf_library_count_view");
    res.send(rows);
  } catch (error) {
    res.status(503);
    sendSafeError(res, error);
  }
});

router.get("/getHomeDashboard", async (req, res) => {
  try {
    // Non-admins don't get the per-user leaderboards (Hall of Fame, quiet users). "Most active" becomes
    // their own week instead. Server-wide totals without names stay as they are.
    const scope = resolveActivityScope(req);
    const ownWeekId = scope.admin ? null : scope.userId ? normalizeUserId(scope.userId) : null;
    const settingsResult = await db.query('SELECT settings FROM app_config where "ID"=1').catch(() => ({ rows: [] }));
    const excludedUsers = Array.isArray(settingsResult.rows?.[0]?.settings?.ExcludedUsers) ? settingsResult.rows[0].settings.ExcludedUsers : [];
    const [
      playbackTotals,
      peakHours,
      libraryCounts,
      catalogSize,
      activeLibraries,
      topUsers,
      libraryBalance,
      topItemThisWeek,
      mostActiveViewerThisWeek,
      quietUsers,
      todayTrend,
      lastWeekTrend,
      libraryIssues,
      missingEpisodeSeries,
      watchPartySuggestions,
      seasonGaps,
      automationFeed,
      integrations,
      watchTonight,
    ] = await Promise.all([
      db.query(`
        SELECT
          count(*)::int AS "TotalPlaybacks",
          count(DISTINCT "UserId")::int AS "UniqueViewers",
          COALESCE(sum("PlaybackDuration"), 0)::bigint AS "TotalWatchSeconds"
        FROM jf_playback_activity
      `),
      db.query(`
        SELECT
          EXTRACT(HOUR FROM "ActivityDateInserted")::int AS "Hour",
          count(*)::int AS "Count"
        FROM jf_playback_activity
        GROUP BY EXTRACT(HOUR FROM "ActivityDateInserted")
        ORDER BY "Hour"
      `),
      db.query(`
        SELECT
          COALESCE(sum(CASE WHEN "CollectionType" = 'movies' THEN "Library_Count" ELSE 0 END), 0)::int AS "Movies",
          COALESCE(sum(CASE WHEN "CollectionType" = 'tvshows' THEN "Library_Count" ELSE 0 END), 0)::int AS "Shows",
          COALESCE(sum(CASE WHEN "CollectionType" = 'tvshows' THEN "Episode_Count" ELSE 0 END), 0)::int AS "Episodes",
          COALESCE(sum(CASE WHEN "CollectionType" = 'music' THEN "Library_Count" ELSE 0 END), 0)::int AS "Artists",
          ${catalogCountSql()},
          COALESCE(count(*) FILTER (WHERE archived = false), 0)::int AS "ActiveLibraries"
        FROM js_library_stats_overview
      `),
      db.query(`
        SELECT COALESCE(sum("Size"), 0)::bigint AS "Size"
        FROM js_library_metadata
      `),
      db.query(`
        SELECT count(*)::int AS "Count"
        FROM js_library_stats_overview
        WHERE archived = false
      `),
      scope.admin
        ? db.query(`
        SELECT
          u."Id" AS "UserId",
          u."Name" AS "UserName",
          u."PrimaryImageTag",
          count(a."Id")::int AS "Plays",
          COALESCE(sum(a."PlaybackDuration"), 0)::bigint AS "WatchSeconds"
        FROM jf_users u
        LEFT JOIN jf_playback_activity a ON a."UserId" = u."Id"
        WHERE array_length($1::text[], 1) IS NULL OR u."Id" <> ALL($1::text[])
        GROUP BY u."Id", u."Name", u."PrimaryImageTag"
        ORDER BY count(a."Id") DESC, COALESCE(sum(a."PlaybackDuration"), 0) DESC, u."Name" ASC
        LIMIT 5
      `, [excludedUsers])
        : { rows: [] },
      db.query(`
        WITH library_plays AS (
          SELECT
            COALESCE(i."ParentId", series."ParentId") AS "LibraryId",
            count(a."Id")::int AS "Plays"
          FROM jf_playback_activity a
          LEFT JOIN jf_library_items i ON i."Id" = a."NowPlayingItemId"
          LEFT JOIN jf_library_episodes e ON e."EpisodeId" = a."EpisodeId"
          LEFT JOIN jf_library_items series ON series."Id" = e."SeriesId"
          GROUP BY COALESCE(i."ParentId", series."ParentId")
        )
        SELECT
          COALESCE(max("Plays"), 0)::int AS "TopLibraryPlays",
          COALESCE(sum("Plays"), 0)::int AS "TotalLibraryPlays"
        FROM library_plays
      `),
      db.query(`
        SELECT
          COALESCE(NULLIF("SeriesName", ''), NULLIF("NowPlayingItemName", ''), 'Unknown item') AS "Name",
          count(*)::int AS "Plays",
          COALESCE(sum("PlaybackDuration"), 0)::bigint AS "WatchSeconds",
          max("ActivityDateInserted") AS "LastPlayed"
        FROM jf_playback_activity
        WHERE "ActivityDateInserted" >= now() - interval '7 days'
        GROUP BY COALESCE(NULLIF("SeriesName", ''), NULLIF("NowPlayingItemName", ''), 'Unknown item')
        ORDER BY count(*) DESC, COALESCE(sum("PlaybackDuration"), 0) DESC
        LIMIT 1
      `),
      !scope.admin && !ownWeekId
        ? { rows: [] }
        : db.query(`
        SELECT
          "UserId",
          COALESCE(NULLIF("UserName", ''), 'Unknown user') AS "UserName",
          count(*)::int AS "Plays",
          COALESCE(sum("PlaybackDuration"), 0)::bigint AS "WatchSeconds"
        FROM jf_playback_activity
        WHERE "ActivityDateInserted" >= now() - interval '7 days'
          ${scope.admin ? "" : `AND replace(lower("UserId"), '-', '') = $1`}
        GROUP BY "UserId", COALESCE(NULLIF("UserName", ''), 'Unknown user')
        ORDER BY count(*) DESC, COALESCE(sum("PlaybackDuration"), 0) DESC, COALESCE(NULLIF("UserName", ''), 'Unknown user') ASC
        LIMIT 1
      `, scope.admin ? [] : [ownWeekId]),
      scope.admin
        ? db.query(`
        SELECT
          u."Id" AS "UserId",
          u."Name" AS "UserName",
          u."PrimaryImageTag",
          max(a."ActivityDateInserted") AS "LastPlayed"
        FROM jf_users u
        LEFT JOIN jf_playback_activity a ON a."UserId" = u."Id"
        GROUP BY u."Id", u."Name", u."PrimaryImageTag"
        HAVING max(a."ActivityDateInserted") IS NULL OR max(a."ActivityDateInserted") < now() - interval '14 days'
        ORDER BY max(a."ActivityDateInserted") ASC NULLS FIRST, u."Name" ASC
        LIMIT 3
      `)
        : { rows: [] },
      db.query(`
        SELECT
          count(*)::int AS "Plays",
          count(DISTINCT "UserId")::int AS "ActiveUsers",
          COALESCE(sum("PlaybackDuration"), 0)::bigint AS "WatchSeconds"
        FROM jf_playback_activity
        WHERE "ActivityDateInserted" >= date_trunc('day', now())
      `),
      db.query(`
        SELECT
          count(*)::int AS "Plays",
          count(DISTINCT "UserId")::int AS "ActiveUsers",
          COALESCE(sum("PlaybackDuration"), 0)::bigint AS "WatchSeconds"
        FROM jf_playback_activity
        WHERE "ActivityDateInserted" >= date_trunc('day', now()) - interval '7 days'
          AND "ActivityDateInserted" < date_trunc('day', now()) - interval '6 days'
      `),
      db.query(`
        SELECT
          count(*) FILTER (WHERE COALESCE("PrimaryImageHash", '') = '')::int AS "MissingPosters",
          count(*) FILTER (WHERE COALESCE("ImageTagsLogo", '') = '')::int AS "MissingLogos",
          count(*) FILTER (WHERE COALESCE("RunTimeTicks", 0) = 0)::int AS "MissingRuntime"
        FROM jf_library_items
        WHERE archived = false
      `),
      db.query(`
        SELECT count(*)::int AS "MissingEpisodeSeries"
        FROM jf_library_items i
        LEFT JOIN jf_library_episodes e ON e."SeriesId" = i."Id" AND COALESCE(e.archived, false) = false
        WHERE i.archived = false AND i."Type" = 'Series'
        GROUP BY i."Id"
        HAVING count(e."EpisodeId") = 0
      `),
      db.query(`
        SELECT
          COALESCE(NULLIF(a."SeriesName", ''), NULLIF(a."NowPlayingItemName", ''), 'Unknown item') AS "Name",
          COALESCE(a."NowPlayingItemId", a."EpisodeId") AS "ItemId",
          count(DISTINCT a."UserId")::int AS "Users",
          count(*)::int AS "Plays",
          max(i."PrimaryImageHash") AS "PrimaryImageHash"
        FROM jf_playback_activity a
        LEFT JOIN jf_library_items i ON i."Id" = a."NowPlayingItemId"
        WHERE a."ActivityDateInserted" >= now() - interval '30 days'
        GROUP BY COALESCE(NULLIF(a."SeriesName", ''), NULLIF(a."NowPlayingItemName", ''), 'Unknown item'), COALESCE(a."NowPlayingItemId", a."EpisodeId")
        HAVING count(DISTINCT a."UserId") > 1
        ORDER BY count(DISTINCT a."UserId") DESC, count(*) DESC
        LIMIT 4
      `),
      db.query(`
        SELECT
          i."Id",
          i."Name",
          i."PrimaryImageHash",
          count(e."EpisodeId")::int AS "Episodes"
        FROM jf_library_items i
        LEFT JOIN jf_library_episodes e ON e."SeriesId" = i."Id" AND COALESCE(e.archived, false) = false
        WHERE i.archived = false AND i."Type" = 'Series'
        GROUP BY i."Id", i."Name", i."PrimaryImageHash"
        HAVING count(e."EpisodeId") = 0
        ORDER BY i."Name" ASC
        LIMIT 8
      `),
      db.query(`
        SELECT "Id", "Name", "Result", "TimeRun", "Duration"
        FROM jf_logging
        ORDER BY "TimeRun" DESC
        LIMIT 8
      `),
      getIntegrations().catch(() => ({ arrApps: [] })),
      fetchHouseholdWatchTonight(excludedUsers).catch(() => []),
    ]);

    const totals = playbackTotals.rows[0] || {};
    const counts = libraryCounts.rows[0] || {};
    const balance = libraryBalance.rows[0] || {};
    const topItem = topItemThisWeek.rows[0] || null;
    const activeViewer = mostActiveViewerThisWeek.rows[0] || null;
    const today = todayTrend.rows[0] || {};
    const lastWeek = lastWeekTrend.rows[0] || {};
    const issueCounts = libraryIssues.rows[0] || {};
    const totalLibraryPlays = Number(balance.TotalLibraryPlays || 0);
    const topLibraryPlays = Number(balance.TopLibraryPlays || 0);
    const concentration = totalLibraryPlays ? (topLibraryPlays / totalLibraryPlays) * 100 : 0;
    const trendDelta = (current, previous) => Number(current || 0) - Number(previous || 0);

    res.send({
      scope: scope.admin ? "all" : "self",
      totals: {
        totalPlaybacks: Number(totals.TotalPlaybacks || 0),
        uniqueViewers: Number(totals.UniqueViewers || 0),
        totalWatchSeconds: Number(totals.TotalWatchSeconds || 0),
      },
      peakHours: Array.from({ length: 24 }, (_, hour) => {
        const row = peakHours.rows.find((item) => Number(item.Hour) === hour);
        return { hour, count: Number(row?.Count || 0) };
      }),
      catalog: {
        movies: Number(counts.Movies || 0),
        shows: Number(counts.Shows || 0),
        episodes: Number(counts.Episodes || 0),
        artists: Number(counts.Artists || 0),
        ...catalogCounts(counts),
        activeLibraries: Number(activeLibraries.rows[0]?.Count || counts.ActiveLibraries || 0),
        size: Number(catalogSize.rows[0]?.Size || 0),
      },
      libraryBalance: {
        label: concentration >= 65 ? "Concentrated" : concentration >= 35 ? "Balanced" : "Broad",
        concentration,
      },
      hallOfFame: topUsers.rows.map((user) => ({
        userId: user.UserId,
        userName: user.UserName,
        primaryImageTag: user.PrimaryImageTag,
        plays: Number(user.Plays || 0),
        watchSeconds: Number(user.WatchSeconds || 0),
      })),
      weekPulse: {
        topItem: topItem
          ? {
              name: topItem.Name,
              plays: Number(topItem.Plays || 0),
              watchSeconds: Number(topItem.WatchSeconds || 0),
              lastPlayed: topItem.LastPlayed,
            }
          : null,
        mostActiveViewer: activeViewer
          ? {
              userId: activeViewer.UserId,
              userName: activeViewer.UserName,
              plays: Number(activeViewer.Plays || 0),
              watchSeconds: Number(activeViewer.WatchSeconds || 0),
            }
          : null,
        quietUsers: quietUsers.rows.map((user) => ({
          userId: user.UserId,
          userName: user.UserName,
          primaryImageTag: user.PrimaryImageTag,
          lastPlayed: user.LastPlayed,
        })),
      },
      trends: {
        today: {
          plays: Number(today.Plays || 0),
          activeUsers: Number(today.ActiveUsers || 0),
          watchSeconds: Number(today.WatchSeconds || 0),
        },
        lastWeek: {
          plays: Number(lastWeek.Plays || 0),
          activeUsers: Number(lastWeek.ActiveUsers || 0),
          watchSeconds: Number(lastWeek.WatchSeconds || 0),
        },
        delta: {
          plays: trendDelta(today.Plays, lastWeek.Plays),
          activeUsers: trendDelta(today.ActiveUsers, lastWeek.ActiveUsers),
          watchSeconds: trendDelta(today.WatchSeconds, lastWeek.WatchSeconds),
        },
      },
      libraryIssues: {
        missingPosters: Number(issueCounts.MissingPosters || 0),
        missingLogos: Number(issueCounts.MissingLogos || 0),
        missingRuntime: Number(issueCounts.MissingRuntime || 0),
        missingEpisodeSeries: Number(missingEpisodeSeries.rowCount || 0),
      },
      watchParty: watchPartySuggestions.rows.map((item) => ({
        itemId: item.ItemId,
        name: item.Name,
        users: Number(item.Users || 0),
        plays: Number(item.Plays || 0),
        primaryImageHash: item.PrimaryImageHash,
      })),
      watchTonight: Array.isArray(watchTonight) ? watchTonight : [],
      seasonGaps: seasonGaps.rows.map((item) => ({
        itemId: item.Id,
        name: item.Name,
        episodes: Number(item.Episodes || 0),
        primaryImageHash: item.PrimaryImageHash,
      })),
      sonarrConnected: (integrations.arrApps || []).some((app) => {
        const name = String(app.name || app.slug || "").toLowerCase();
        return Boolean(app.connected && name.includes("sonarr"));
      }),
      automationFeed: automationFeed.rows.map((item) => ({
        id: item.Id,
        name: item.Name,
        result: item.Result,
        timeRun: item.TimeRun,
        duration: item.Duration,
      })),
    });
  } catch (error) {
    console.log(error);
    sendSafeError(res, error);
  }
});

router.post("/getMostViewedByType", async (req, res) => {
  try {
    const { days, type } = req.body;

    const valid_types = ["Audio", "Movie", "Series"];

    let _days = days;
    if (days === undefined) {
      _days = 30;
    }

    if (!valid_types.includes(type)) {
      res.status(503);
      return res.send(`Invalid Type Value.\nValid Types: ${JSON.stringify(valid_types)}`);
    }
    if (isNaN(parseFloat(days))) {
      res.status(503);
      return res.send(`Days needs to be a number.`);
    }
    if (Number(days) < 0) {
      res.status(503);
      return res.send(`Days cannot be less than 0`);
    }

    const { rows } = await db.query(`select * from fs_most_played_items($1,'${type}') limit 5`, [_days - 1]);
    res.send(rows);
  } catch (error) {
    res.status(503);
    sendSafeError(res, error);
  }
});

router.post("/getMostPopularByType", async (req, res) => {
  try {
    const { days, type } = req.body;

    const valid_types = ["Audio", "Movie", "Series"];

    let _days = days;
    if (days === undefined) {
      _days = 30;
    }

    if (!valid_types.includes(type)) {
      res.status(503);
      return res.send("Invalid Type Value");
    }

    const { rows } = await db.query(`select * from fs_most_popular_items($1,$2) limit 5`, [_days - 1, type]);
    res.send(rows);
  } catch (error) {
    res.status(503);
    sendSafeError(res, error);
  }
});

router.post("/getMostViewedLibraries", async (req, res) => {
  try {
    const { days } = req.body;
    let _days = days;
    if (days === undefined) {
      _days = 30;
    }
    const { rows } = await db.query(`select * from fs_most_viewed_libraries($1)`, [_days - 1]);
    res.send(rows);
  } catch (error) {
    res.status(503);
    sendSafeError(res, error);
  }
});

router.post("/getMostUsedClient", async (req, res) => {
  try {
    const { days } = req.body;
    let _days = days;
    if (days === undefined) {
      _days = 30;
    }
    const { rows } = await db.query(`select * from fs_most_used_clients($1) limit 5`, [_days - 1]);
    res.send(rows);
  } catch (error) {
    res.status(503);
    sendSafeError(res, error);
  }
});

router.post("/getMostActiveUsers", async (req, res) => {
  try {
    const { days } = req.body;
    let _days = days;
    if (days === undefined) {
      _days = 30;
    }
    const scope = resolveActivityScope(req);
    if (scope.admin) {
      const { rows } = await db.query(`select * from fs_most_active_user($1) limit 5`, [_days - 1]);
      return res.send(rows);
    }
    // Non-admins only get their own entry (or nothing), never the ranking of other users.
    if (!scope.userId) return res.send([]);
    const { rows } = await db.query(
      `select * from fs_most_active_user($1) where replace(lower("UserId"), '-', '') = $2 limit 5`,
      [_days - 1, normalizeUserId(scope.userId)]
    );
    res.send(rows);
  } catch (error) {
    res.status(503);
    sendSafeError(res, error);
  }
});

router.get("/getPlaybackActivity", async (req, res) => {
  const { size = 50, page = 1, search, sort = "ActivityDateInserted", desc = true, filters } = req.query;
  let filtersArray = [];
  if (filters) {
    try {
      filtersArray = JSON.parse(filters);
    } catch (error) {
      return res.status(400).json({
        error: "Invalid filters parameter",
        example: [
          { field: "UserName", value: "User" },
          { field: "Client", in: "Android TV,Web" },
          { field: "PlaybackDuration", min: 1000, max: 5000 },
          { field: "PlayMethod", value: "DirectPlay" },
          { field: "ActivityDateInserted", min: "2025-01-01", max: "2025-12-31" },
          { field: "IsPaused", value: false },
        ],
        allowed_fields: [
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
          "SeasonId",
          "SeriesName",
          "EpisodeId",
          "PlaybackDuration",
          "ActivityDateInserted",
          "PlayMethod",
          "OriginalContainer",
          "RemoteEndPoint",
          "ServerId",
          "imported",
        ],
      });
    }
  }

  const scope = resolveActivityScope(req, { filters: filtersArray });
  if (scope.forbidden) return sendForbidden(res);
  if (!scope.admin && !scope.userId) {
    return res.send({ current_page: page, pages: 0, size: size, sort: sort, desc: desc, results: [], scope: "self" });
  }

  const sortField = sortMap.find((item) => item.field === sort)?.column || "ActivityDateInserted";
  const values = [];
  try {
    const query = {
      select: ["*"],
      table: "jf_playback_activity",
      alias: "a",
      order_by: sortField,
      sort_order: desc ? "desc" : "asc",
      pageNumber: page,
      pageSize: size,
    };

    if (search && search.length > 0) {
      query.where = [
        {
          field: `LOWER(
          CASE 
            WHEN a."SeriesName" is null THEN a."NowPlayingItemName"
            ELSE a."SeriesName"
          END 
          )`,
          operator: "LIKE",
          value: `$${values.length + 1}`,
        },
      ];

      values.push(`%${search.toLowerCase()}%`);
    }

    query.values = values;
    dbHelper.buildFilterList(query, filtersArray, filterFields);
    if (!scope.admin) restrictQueryToUser(query, scope.userId);

    const result = await dbHelper.query(query);
    const response = {
      current_page: page,
      pages: result.pages,
      size: size,
      sort: sort,
      desc: desc,
      results: result.results,
      scope: scope.admin ? "all" : "self",
    };
    if (search && search.length > 0) {
      response.search = search;
    }

    if (filtersArray.length > 0) {
      response.filters = filtersArray;
    }
    res.send(response);
  } catch (error) {
    res.status(503);
    sendSafeError(res, error);
  }
});

router.get("/getAllUserActivity", async (req, res) => {
  try {
    res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.set("Pragma", "no-cache");
    res.set("Expires", "0");
    res.set("Surrogate-Control", "no-store");
    const admin = canViewAllUsers(req);
    const ownId = admin ? null : ownMediaUserId(req.user);
    if (!admin && !ownId) {
      return res.send([]);
    }
    const { rows } = await db.query(
      `
      SELECT
        a.*,
        COALESCE(u."IsAdministrator", false) AS "IsAdministrator"
      FROM jf_all_user_activity a
      LEFT JOIN jf_users u ON u."Id" = a."UserId"
      ${admin ? "" : `WHERE replace(lower(a."UserId"), '-', '') = $1`}
    `,
      admin ? [] : [normalizeUserId(ownId)]
    );
    res.send(rows);
  } catch (error) {
    res.send([]);
  }
});

async function enrichUserWrapUp(user) {
  const params = [user.UserId];
  const [topTitle, topMovie, topSeries, topClient, topLibrary, topDay, topHour, dailyActivity] = await Promise.all([
    db.query(
      `
        SELECT
          COALESCE("SeriesName", "NowPlayingItemName") AS "Name",
          (array_agg("NowPlayingItemId" ORDER BY "ActivityDateInserted" DESC))[1] AS "ItemId",
          count(*)::int AS "Count",
          COALESCE(sum("PlaybackDuration"), 0)::bigint AS "Duration"
        FROM jf_playback_activity
        WHERE "UserId" = $1
        GROUP BY COALESCE("SeriesName", "NowPlayingItemName")
        ORDER BY count(*) DESC, COALESCE(sum("PlaybackDuration"), 0) DESC
        LIMIT 1
      `,
      params
    ),
    db.query(
      `
        SELECT "NowPlayingItemName" AS "Name", "NowPlayingItemId" AS "ItemId", count(*)::int AS "Count"
        FROM jf_playback_activity
        WHERE "UserId" = $1 AND "SeriesName" IS NULL
        GROUP BY "NowPlayingItemName", "NowPlayingItemId"
        ORDER BY count(*) DESC
        LIMIT 1
      `,
      params
    ),
    db.query(
      `
        SELECT "SeriesName" AS "Name", "NowPlayingItemId" AS "ItemId", count(*)::int AS "Count"
        FROM jf_playback_activity
        WHERE "UserId" = $1 AND "SeriesName" IS NOT NULL
        GROUP BY "SeriesName", "NowPlayingItemId"
        ORDER BY count(*) DESC
        LIMIT 1
      `,
      params
    ),
    db.query(
      `
        SELECT COALESCE("Client", 'Unknown') AS "Name", count(*)::int AS "Count"
        FROM jf_playback_activity
        WHERE "UserId" = $1
        GROUP BY COALESCE("Client", 'Unknown')
        ORDER BY count(*) DESC
        LIMIT 1
      `,
      params
    ),
    db.query(
      `
        SELECT COALESCE(l."Name", 'Unknown library') AS "Name", count(*)::int AS "Count"
        FROM jf_playback_activity a
        LEFT JOIN jf_library_items i ON i."Id" = a."NowPlayingItemId"
        LEFT JOIN jf_libraries l ON l."Id" = i."ParentId"
        WHERE a."UserId" = $1
        GROUP BY COALESCE(l."Name", 'Unknown library')
        ORDER BY count(*) DESC
        LIMIT 1
      `,
      params
    ),
    db.query(
      `
        SELECT trim(to_char("ActivityDateInserted", 'Day')) AS "Name", count(*)::int AS "Count"
        FROM jf_playback_activity
        WHERE "UserId" = $1
        GROUP BY trim(to_char("ActivityDateInserted", 'Day')), extract(dow from "ActivityDateInserted")
        ORDER BY count(*) DESC
        LIMIT 1
      `,
      params
    ),
    db.query(
      `
        SELECT extract(hour from "ActivityDateInserted")::int AS "Hour", count(*)::int AS "Count"
        FROM jf_playback_activity
        WHERE "UserId" = $1
        GROUP BY extract(hour from "ActivityDateInserted")
        ORDER BY count(*) DESC
        LIMIT 1
      `,
      params
    ),
    db.query(
      `
        SELECT
          "ActivityDateInserted"::date AS "Date",
          count(*)::int AS "Streams",
          COALESCE(sum("PlaybackDuration"), 0)::bigint AS "Duration"
        FROM jf_playback_activity
        WHERE "UserId" = $1
        GROUP BY "ActivityDateInserted"::date
        ORDER BY "ActivityDateInserted"::date ASC
      `,
      params
    ),
  ]);

  return {
    ...user,
    TopTitle: topTitle.rows[0] || null,
    TopMovie: topMovie.rows[0] || null,
    TopSeries: topSeries.rows[0] || null,
    TopClient: topClient.rows[0] || null,
    TopLibrary: topLibrary.rows[0] || null,
    TopDay: topDay.rows[0] || null,
    TopHour: topHour.rows[0] || null,
    DailyActivity: dailyActivity.rows,
  };
}

router.get("/getUserWrapUp", async (req, res) => {
  try {
    res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    const admin = canViewAllUsers(req);
    const ownId = admin ? null : ownMediaUserId(req.user);
    if (!admin && !ownId) {
      return res.json([]);
    }
    const { rows: users } = await db.query(
      `
      SELECT
        u."Id" AS "UserId",
        u."Name" AS "UserName",
        u."PrimaryImageTag",
        u."IsAdministrator",
        COALESCE(count(a."Id"), 0)::int AS "TotalStreams",
        COALESCE(sum(a."PlaybackDuration"), 0)::bigint AS "TotalWatchTime",
        min(a."ActivityDateInserted") AS "FirstActivityDate",
        max(a."ActivityDateInserted") AS "LastActivityDate",
        count(DISTINCT COALESCE(a."SeriesName", a."NowPlayingItemName"))::int AS "UniqueTitles",
        count(DISTINCT a."Client")::int AS "UniqueClients"
      FROM jf_users u
      LEFT JOIN jf_playback_activity a ON a."UserId" = u."Id"
      ${admin ? "" : `WHERE replace(lower(u."Id"), '-', '') = $1`}
      GROUP BY u."Id", u."Name", u."PrimaryImageTag", u."IsAdministrator"
      ORDER BY COALESCE(sum(a."PlaybackDuration"), 0) DESC, u."Name" ASC
    `,
      admin ? [] : [normalizeUserId(ownId)]
    );

    const enrichedUsers = await Promise.all(users.map(enrichUserWrapUp));

    res.json(enrichedUsers);
  } catch (error) {
    console.log(error);
    sendSafeError(res, error);
  }
});

router.get("/getUserProfileWrapUp", async (req, res) => {
  try {
    res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    const userKey = String(req.query.user || "").trim().toLowerCase();
    if (!userKey) {
      return res.status(400).json({ error: "Missing user query parameter" });
    }
    const admin = canViewAllUsers(req);
    const ownId = admin ? null : ownMediaUserId(req.user);
    if (!admin && !ownId) {
      return sendForbidden(res);
    }

    const { rows } = await db.query(
      `
        WITH user_totals AS (
          SELECT
            u."Id" AS "UserId",
            u."Name" AS "UserName",
            u."PrimaryImageTag",
            u."IsAdministrator",
            COALESCE(count(a."Id"), 0)::int AS "TotalStreams",
            COALESCE(sum(a."PlaybackDuration"), 0)::bigint AS "TotalWatchTime",
            min(a."ActivityDateInserted") AS "FirstActivityDate",
            max(a."ActivityDateInserted") AS "LastActivityDate",
            count(DISTINCT COALESCE(a."SeriesName", a."NowPlayingItemName"))::int AS "UniqueTitles",
            count(DISTINCT a."Client")::int AS "UniqueClients"
          FROM jf_users u
          LEFT JOIN jf_playback_activity a ON a."UserId" = u."Id"
          GROUP BY u."Id", u."Name", u."PrimaryImageTag", u."IsAdministrator"
        ),
        ranked_users AS (
          SELECT
            *,
            row_number() OVER (ORDER BY "TotalWatchTime" DESC, "UserName" ASC) AS "Rank",
            regexp_replace(regexp_replace(lower("UserName"), '[^a-z0-9]+', '-', 'g'), '(^-|-$)', '', 'g') AS "Slug"
          FROM user_totals
        )
        SELECT *
        FROM ranked_users
        WHERE lower("UserId") = $1 OR lower("UserName") = $1 OR "Slug" = $1
        LIMIT 1
      `,
      [userKey]
    );

    // Non-admins can only open their own profile. Unknown users get the same 403 so the
    // response doesn't reveal who else exists.
    if (!admin && (!rows.length || !sameUserId(rows[0].UserId, ownId))) {
      return sendForbidden(res);
    }

    if (!rows.length) {
      return res.status(404).json({ error: "User not found" });
    }

    if (admin) {
      const user = await enrichUserWrapUp(rows[0]);
      return res.json({ user, rank: Number(rows[0].Rank || 1) });
    }

    // The rank compares against everyone else's watch time, so only admins get it.
    const { Rank: _rank, ...ownRow } = rows[0];
    const user = await enrichUserWrapUp(ownRow);
    return res.json({ user, rank: null });
  } catch (error) {
    console.log(error);
    sendSafeError(res, error);
  }
});

router.post("/getUserLastPlayed", async (req, res) => {
  try {
    const scope = resolveStatsUser(req, req.body?.userid);
    if (scope.forbidden) return sendForbidden(res);
    if (!scope.admin && !scope.userId) return res.send([]);
    const { rows } = await db.query(`select * from fs_last_user_activity($1) limit 15`, [scope.userId]);
    res.send(rows);
  } catch (error) {
    console.log(error);
    res.status(503);
    sendSafeError(res, error);
  }
});

//Global Stats
router.post("/getGlobalUserStats", async (req, res) => {
  try {
    const { hours } = req.body;
    const scope = resolveStatsUser(req, req.body?.userid);
    if (scope.forbidden) return sendForbidden(res);
    if (!scope.admin && !scope.userId) return res.send({});
    let _hours = hours;
    if (hours === undefined) {
      _hours = 24;
    }
    const { rows } = await db.query(`select * from fs_user_stats($1,$2)`, [_hours, scope.userId]);
    res.send(rows[0]);
  } catch (error) {
    console.log(error);
    res.status(503);
    sendSafeError(res, error);
  }
});

router.post("/getGlobalItemStats", async (req, res) => {
  try {
    const { hours, itemid } = req.body;
    let _hours = hours;
    if (hours === undefined) {
      _hours = 24;
    }
    const { rows } = await db.query(
      `select count(*)"Plays",
      sum("PlaybackDuration") total_playback_duration
      from jf_playback_activity jf_playback_activity
      where 
      ("EpisodeId"=$1 OR "SeasonId"=$1 OR "NowPlayingItemId"=$1)
      AND jf_playback_activity."ActivityDateInserted" BETWEEN CURRENT_DATE - INTERVAL '1 hour' * $2 AND NOW();`,
      [itemid, _hours]
    );
    res.send(rows[0]);
  } catch (error) {
    console.log(error);
    res.status(503);
    sendSafeError(res, error);
  }
});

router.post("/getGlobalLibraryStats", async (req, res) => {
  try {
    const { hours, libraryid } = req.body;
    let _hours = hours;
    if (hours === undefined) {
      _hours = 24;
    }
    const { rows } = await db.query(`select * from fs_library_stats($1,$2)`, [_hours, libraryid]);
    res.send(rows[0]);
  } catch (error) {
    console.log(error);
    res.status(503);
    sendSafeError(res, error);
  }
});

router.get("/getDiskForecast", async (req, res) => {
  try {
    if (!canViewAllUsers(req)) {
      return res.status(403).send({ error: "Only admins can see the disk forecast" });
    }
    const { getDiskForecast } = require("../classes/disk-forecast");
    const { fetchDisks } = require("../classes/threshold-alerts");
    res.send(await getDiskForecast({ db, fetchDisks }));
  } catch (error) {
    res.status(503);
    sendSafeError(res, error);
  }
});

router.get("/getLibraryCardStats", async (req, res) => {
  try {
    const { rows } = await db.query(
      `select *, now() - js_library_stats_overview."ActivityDateInserted" AS "LastActivity" from js_library_stats_overview`
    );
    res.send(rows);
  } catch (error) {
    res.status(503);
    sendSafeError(res, error);
  }
});

router.post("/getLibraryCardStats", async (req, res) => {
  try {
    const { libraryid } = req.body;
    if (libraryid === undefined) {
      res.status(503);
      return res.send("Invalid Library Id");
    }

    const { rows } = await db.query(
      `select *, now() - js_library_stats_overview."ActivityDateInserted" AS "LastActivity" from js_library_stats_overview where "Id"=$1`,
      [libraryid]
    );
    res.send(rows[0]);
  } catch (error) {
    console.log(error);
    res.status(503);
    sendSafeError(res, error);
  }
});

router.get("/getLibraryMetadata", async (req, res) => {
  try {
    const { rows } = await db.query("select * from js_library_metadata");
    res.send(rows);
  } catch (error) {
    res.status(503);
    sendSafeError(res, error);
  }
});

router.post("/getLibraryItemsWithStats", async (req, res) => {
  const { size = 999999999, page = 1, search, sort = "Date", desc = true } = req.query;
  const { libraryid } = req.body;
  if (libraryid === undefined) {
    res.status(400).send({ error: "Invalid Library Id" });
  }

  const sortMap = [
    { field: "Date", column: "DateCreated" },
    { field: "Views", column: "times_played" },
    { field: "Size", column: "Size" },
    { field: "WatchTime", column: "total_play_time" },
    { field: "Title", column: `REGEXP_REPLACE(a."Name", '^(A |An |The )', '', 'i')` },
  ];

  const sortField = sortMap.find((item) => item.field === sort)?.column || "DateCreated";
  const values = [];
  try {
    const query = {
      select: ["*"],
      table: "js_library_items_with_playcount_playtime",
      alias: "a",
      order_by: sortField,
      sort_order: desc ? "desc" : "asc",
      pageNumber: page,
      pageSize: size,
      where: [
        {
          field: `a."ParentId"`,
          operator: "=",
          value: `$${values.length + 1}`,
        },
      ],
    };

    values.push(libraryid);

    if (search && search.length > 0) {
      query.where.push({
        field: `LOWER(a."Name")`,
        operator: "LIKE",
        value: `$${values.length + 1}`,
      });

      values.push(`%${search.toLowerCase()}%`);
    }

    query.values = values;

    // const { rows } = await db.query(`SELECT * FROM jf_library_items_with_playcount_playtime where "ParentId"=$1`, [libraryid]);
    // res.send(rows);
    const result = await dbHelper.query(query);
    const response = { current_page: page, pages: result.pages, size: size, sort: sort, desc: desc, results: result.results };
    if (search && search.length > 0) {
      response.search = search;
    }

    res.send(response);
  } catch (error) {
    console.log(error);
  }
});

router.post("/getLibraryItemsPlayMethodStats", async (req, res) => {
  try {
    let { libraryid, startDate, endDate = dayjs(), hours = 24 } = req.body;

    // Validate startDate and endDate using dayjs
    if (
      startDate !== undefined &&
      (!dayjs(startDate, "YYYY-MM-DDTHH:mm:ss.SSSZ", true).isValid() ||
        !dayjs(endDate, "YYYY-MM-DDTHH:mm:ss.SSSZ", true).isValid())
    ) {
      return res.status(400).send({ error: "Invalid date format" });
    }

    if (hours < 1) {
      return res.status(400).send({ error: "Hours cannot be less than 1" });
    }

    if (libraryid === undefined) {
      return res.status(400).send({ error: "Invalid Library Id" });
    }

    if (startDate === undefined) {
      startDate = dayjs(endDate).subtract(hours, "hour").format("YYYY-MM-DD HH:mm:ss");
    }

    const { rows } = await db.query(
      `select a.*,i."ParentId"
      from jf_playback_activity a
	    left
	    join jf_library_episodes e
	    on a."EpisodeId"=e."EpisodeId"
	    join jf_library_items i
	    on i."Id"=a."NowPlayingItemId" or e."SeriesId"=i."Id"
      where i."ParentId"=$1
      and a."ActivityDateInserted" BETWEEN $2 AND $3
      order by a."ActivityDateInserted" desc;
      `,
      [libraryid, startDate, endDate]
    );

    const stats = rows.map((item) => {
      return {
        Id: item.NowPlayingItemId,
        UserId: item.UserId,
        UserName: item.UserName,
        Client: item.Client,
        DeviceName: item.DeviceName,
        NowPlayingItemName: item.NowPlayingItemName,
        EpisodeId: item.EpisodeId || null,
        SeasonId: item.SeasonId || null,
        StartTime: dayjs(item.ActivityDateInserted).subtract(item.PlaybackDuration, "seconds").format("YYYY-MM-DD HH:mm:ss"),
        EndTime: dayjs(item.ActivityDateInserted).format("YYYY-MM-DD HH:mm:ss"),
        PlaybackDuration: item.PlaybackDuration,
        PlayMethod: item.PlayMethod,
        TranscodedVideo: item.TranscodingInfo?.IsVideoDirect || false,
        TranscodedAudio: item.TranscodingInfo?.IsAudioDirect || false,
        ParentId: item.ParentId,
      };
    });

    let countedstats = countOverlapsPerHour(stats);

    let hoursRes = {
      types: [
        { Id: "Transcodes", Name: "Transcodes" },
        { Id: "DirectPlays", Name: "DirectPlays" },
      ],

      stats: Object.keys(countedstats).map((key) => {
        return {
          Key: key,
          Transcodes: countedstats[key].Transcodes,
          DirectPlays: countedstats[key].DirectPlays,
        };
      }),
    };
    res.send(hoursRes);
  } catch (error) {
    console.log(error);
    sendSafeError(res, error);
  }
});

router.post("/getPlaybackMethodStats", async (req, res) => {
  try {
    const { days = 30 } = req.body;

    if (days < 0) {
      res.status(503);
      return res.send("Days cannot be less than 0");
    }

    const { rows } = await db.query(
      `select a."PlayMethod" "Name",count(a."PlayMethod") "Count"
      from jf_playback_activity a
      WHERE a."ActivityDateInserted" BETWEEN CURRENT_DATE - MAKE_INTERVAL(days => $1) AND NOW()
		  Group by a."PlayMethod"
      ORDER BY (count(*)) DESC;
      `,
      [days - 1]
    );

    res.send(rows);
  } catch (error) {
    console.log(error);
    sendSafeError(res, error);
  }
});

router.post("/getLibraryLastPlayed", async (req, res) => {
  try {
    const { libraryid } = req.body;
    const scope = resolveActivityScope(req);
    if (scope.admin) {
      const { rows } = await db.query(`select * from fs_last_library_activity($1) limit 15`, [libraryid]);
      return res.send(rows);
    }
    if (!scope.userId) return res.send([]);
    // Same shape as fs_last_library_activity, limited to the caller's own plays.
    const { rows } = await db.query(
      `
      SELECT *
      FROM (
        SELECT DISTINCT ON (i."Name", e."Name")
          i."Id",
          a."EpisodeId",
          i."Name",
          e."Name" AS "EpisodeName",
          CASE WHEN a."SeasonId" IS NOT NULL THEN s."IndexNumber" ELSE NULL END AS "SeasonNumber",
          CASE WHEN a."SeasonId" IS NOT NULL THEN e."IndexNumber" ELSE NULL END AS "EpisodeNumber",
          i."PrimaryImageHash",
          a."UserId",
          a."UserName",
          i.archived,
          (NOW() - a."ActivityDateInserted") AS "LastPlayed"
        FROM jf_playback_activity a
        JOIN jf_library_items i ON i."Id" = a."NowPlayingItemId"
        JOIN jf_libraries l ON i."ParentId" = l."Id"
        LEFT JOIN jf_library_seasons s ON s."Id" = a."SeasonId"
        LEFT JOIN jf_library_episodes e ON e."EpisodeId" = a."EpisodeId"
        WHERE l."Id" = $1 AND replace(lower(a."UserId"), '-', '') = $2
        ORDER BY i."Name", e."Name", a."ActivityDateInserted" DESC
      ) AS latest_distinct_rows
      ORDER BY "LastPlayed"
      LIMIT 15
      `,
      [libraryid, normalizeUserId(scope.userId)]
    );
    res.send(rows);
  } catch (error) {
    console.log(error);
    res.status(503);
    sendSafeError(res, error);
  }
});

router.get("/getViewsOverTime", async (req, res) => {
  try {
    const { days } = req.query;
    let _days = days;
    if (days === undefined) {
      _days = 30;
    }
    const { rows: stats } = await db.query(`select * from fs_watch_stats_over_time($1)`, [_days]);

    const { rows: libraries } = await db.query(`select distinct "Id","Name" from jf_libraries where archived=false`);

    const reorganizedData = {};

    stats.forEach((item) => {
      const library = item.Library;
      const count = item.Count;
      const duration = item.Duration;
      const date = new Date(item.Date).toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "2-digit",
      });

      if (!reorganizedData[date]) {
        reorganizedData[date] = {
          Key: date,
        };
      }

      reorganizedData[date] = { ...reorganizedData[date], [library]: { count, duration } };
    });
    const finalData = { libraries: libraries, stats: Object.values(reorganizedData) };
    res.send(finalData);
  } catch (error) {
    console.log(error);
    res.status(503);
    sendSafeError(res, error);
  }
});

router.get("/getViewsByDays", async (req, res) => {
  try {
    const { days } = req.query;
    let _days = days;
    if (days === undefined) {
      _days = 30;
    }
    const { rows: stats } = await db.query(`select * from fs_watch_stats_popular_days_of_week($1)`, [_days]);

    const { rows: libraries } = await db.query(`select distinct "Id","Name" from jf_libraries where archived=false`);

    const reorganizedData = {};

    stats.forEach((item) => {
      const library = item.Library;
      const count = item.Count;
      const duration = item.Duration;
      const day = item.Day;

      if (!reorganizedData[day]) {
        reorganizedData[day] = {
          Key: day,
        };
      }

      reorganizedData[day] = { ...reorganizedData[day], [library]: { count, duration } };
    });
    const finalData = { libraries: libraries, stats: Object.values(reorganizedData) };
    res.send(finalData);
  } catch (error) {
    console.log(error);
    res.status(503);
    sendSafeError(res, error);
  }
});

router.get("/getViewsByHour", async (req, res) => {
  try {
    const { days } = req.query;
    let _days = days;
    if (days === undefined) {
      _days = 30;
    }
    const { rows: stats } = await db.query(`select * from fs_watch_stats_popular_hour_of_day($1)`, [_days]);

    const { rows: libraries } = await db.query(`select distinct "Id","Name" from jf_libraries where archived=false`);

    const reorganizedData = {};

    stats.forEach((item) => {
      const library = item.Library;
      const count = item.Count;
      const duration = item.Duration;
      const hour = item.Hour;

      if (!reorganizedData[hour]) {
        reorganizedData[hour] = {
          Key: hour,
        };
      }

      reorganizedData[hour] = { ...reorganizedData[hour], [library]: { count, duration } };
    });
    const finalData = { libraries: libraries, stats: Object.values(reorganizedData) };
    res.send(finalData);
  } catch (error) {
    console.log(error);
    res.status(503);
    sendSafeError(res, error);
  }
});

router.get("/getViewsByLibraryType", async (req, res) => {
  try {
    const { days = 30 } = req.query;

    const { rows } = await db.query(
      `
      SELECT COALESCE(i."Type", 'Other') AS type, COUNT(a."NowPlayingItemId") AS count
      FROM jf_playback_activity a LEFT JOIN jf_library_items i ON i."Id" = a."NowPlayingItemId"
      WHERE a."ActivityDateInserted" BETWEEN NOW() - CAST($1 || ' days' as INTERVAL) AND NOW()
      GROUP BY i."Type"
    `,
      [days]
    );

    res.send(groupPlaysByType(rows));
  } catch (error) {
    console.log(error);
    res.status(503);
    sendSafeError(res, error);
  }
});

router.get("/getGenreUserStats", async (req, res) => {
  try {
    const { size = 50, page = 1 } = req.query;
    const scope = resolveStatsUser(req, req.query.userid);
    if (scope.forbidden) return sendForbidden(res);
    const userid = scope.userId;

    if (!userid) {
      if (!scope.admin) {
        return res.send({ current_page: page, pages: 0, size: size, results: [] });
      }
      res.status(400);
      res.send("No User ID provided");
      return;
    }

    const values = [];
    const query = {
      select: ["COALESCE(g.genre, 'No Genre') AS genre", `SUM(a."PlaybackDuration") AS duration`, "COUNT(*) AS plays"],
      table: "jf_playback_activity_with_metadata",
      alias: "a",
      joins: [
        {
          type: "inner",
          table: "jf_library_items",
          alias: "i",
          conditions: [{ first: "a.NowPlayingItemId", operator: "=", second: "i.Id" }],
        },
        {
          type: "left",
          table: `
                  LATERAL (
                    SELECT 
                      jsonb_array_elements_text(
                        CASE 
                          WHEN jsonb_array_length(COALESCE(i."Genres", '[]'::jsonb)) = 0 THEN '["No Genre"]'::jsonb
                          ELSE i."Genres"
                        END
                      ) AS genre
                )
                 `,
          alias: "g",
          conditions: [{ first: 1, operator: "=", value: 1, wrap: false }],
        },
      ],

      where: [[{ column: "a.UserId", operator: "=", value: `$${values.length + 1}` }]],
      group_by: [`COALESCE(g.genre, 'No Genre')`],
      order_by: "genre",
      sort_order: "asc",
      pageNumber: page,
      pageSize: size,
    };

    values.push(userid);

    query.values = values;

    const result = await dbHelper.query(query);

    const response = { current_page: page, pages: result.pages, size: size, results: result.results };

    res.send(response);
  } catch (error) {
    console.log(error);
    res.status(503);
    sendSafeError(res, error);
  }
});

router.get("/getGenreLibraryStats", async (req, res) => {
  try {
    const { size = 50, page = 1, libraryid } = req.query;

    if (libraryid === undefined) {
      res.status(400);
      res.send("No Library ID provided");
      return;
    }

    const values = [];
    const query = {
      select: ["COALESCE(g.genre, 'No Genre') AS genre", `SUM(a."PlaybackDuration") AS duration`, "COUNT(*) AS plays"],
      table: "jf_playback_activity_with_metadata",
      alias: "a",
      joins: [
        {
          type: "inner",
          table: "jf_library_items",
          alias: "i",
          conditions: [{ first: "a.NowPlayingItemId", operator: "=", second: "i.Id" }],
        },
        {
          type: "left",
          table: `
                  LATERAL (
                    SELECT 
                      jsonb_array_elements_text(
                        CASE 
                          WHEN jsonb_array_length(COALESCE(i."Genres", '[]'::jsonb)) = 0 THEN '["No Genre"]'::jsonb
                          ELSE i."Genres"
                        END
                      ) AS genre
                )
                 `,
          alias: "g",
          conditions: [{ first: 1, operator: "=", value: 1, wrap: false }],
        },
      ],

      where: [[{ column: "a.ParentId", operator: "=", value: `$${values.length + 1}` }]],
      group_by: [`COALESCE(g.genre, 'No Genre')`],
      order_by: "genre",
      sort_order: "asc",
      pageNumber: page,
      pageSize: size,
    };

    values.push(libraryid);

    query.values = values;

    const result = await dbHelper.query(query);

    const response = { current_page: page, pages: result.pages, size: size, results: result.results };

    res.send(response);
  } catch (error) {
    console.log(error);
    res.status(503);
    sendSafeError(res, error);
  }
});

// Handle other routes
router.use((req, res) => {
  res.status(404).send({ error: "Not Found" });
});

module.exports = router;

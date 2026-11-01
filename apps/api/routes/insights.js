const express = require("express");
const db = require("../db");

const router = express.Router();
const TZ = process.env.TZ || "UTC";

function q(sql, params = []) {
  return db.pool.query(sql, params).then((result) => result.rows);
}

function clampInt(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}


// Non-admins only ever see their own history, whatever userId they ask for.
function scopedUserId(req) {
  const requestRules = require("../classes/request-rules");
  const requested = req.query.userId ? String(req.query.userId) : null;
  if (requestRules.isAdmin(req.user)) return { userId: requested, admin: true };
  return { userId: requestRules.userKey(req.user) || "__none__", admin: false };
}

// ---------------------------------------------------------------------------
// Year in review

router.get("/wrapped/years", async (req, res) => {
  try {
    const rows = await q(
      `SELECT DISTINCT EXTRACT(YEAR FROM "ActivityDateInserted" AT TIME ZONE $1)::int AS year
         FROM jf_playback_activity ORDER BY year DESC`,
      [TZ]
    );
    const { userId, admin } = scopedUserId(req);
    const users = await q(
      `SELECT "Id" AS id, "Name" AS name FROM jf_users WHERE $1::text IS NULL OR "Id" = $1 ORDER BY lower("Name")`,
      [admin ? null : userId]
    );
    res.json({ years: rows.map((row) => row.year), users, scoped: !admin });
  } catch (error) {
    res.status(503).json({ error: error.message });
  }
});

const { buildWrapped: buildWrappedRecap } = require("../classes/wrapped-recap");

function buildWrapped(req) {
  return buildWrappedRecap({ ...req.query, userId: scopedUserId(req).userId });
}

router.get("/wrapped", async (req, res) => {
  try {
    res.json(await buildWrapped(req));
  } catch (error) {
    res.status(503).json({ error: error.message || "Unable to build the recap" });
  }
});

router.get("/wrapped/card", async (req, res) => {
  try {
    const { renderWrappedCard } = require("../classes/wrapped-card");
    const png = await renderWrappedCard(await buildWrapped(req));
    res.set("Content-Type", "image/png");
    res.set("Cache-Control", "private, max-age=300");
    res.send(png);
  } catch (error) {
    res.status(503).json({ error: error.message || "Unable to render the recap card" });
  }
});

// Scheduled recap delivery (email and/or webhook). Admins manage anyone's; everyone else only
// their own linked media-server user, and only by email.
function deliveryScope(req) {
  const { canViewAllUsers, ownMediaUserId } = require("../classes/stats-access");
  return { admin: canViewAllUsers(req), userId: ownMediaUserId(req.user) };
}

function deliveryError(res, error) {
  res.status(error.statusCode || 503).json({ error: error.message || "Recap delivery failed" });
}

router.get("/wrapped/delivery", async (req, res) => {
  try {
    const delivery = require("../classes/wrapped-delivery");
    const { getAppSettings, getNewsletterSettings, validateSmtpSettings } = require("../classes/smtp-mailer");
    const scope = deliveryScope(req);
    const subscriptions = await delivery.listSubscriptions(scope);
    const webhooks = scope.admin ? await q(`SELECT id, name, webhook_type AS type, enabled FROM webhooks ORDER BY lower(name)`) : [];
    const smtpReady = !validateSmtpSettings(getNewsletterSettings(await getAppSettings()));
    res.json({ subscriptions, webhooks, smtpReady, admin: scope.admin, ownUserId: scope.userId });
  } catch (error) {
    deliveryError(res, error);
  }
});

router.post("/wrapped/delivery", async (req, res) => {
  try {
    const { saveSubscription } = require("../classes/wrapped-delivery");
    res.json(await saveSubscription(req.body || {}, deliveryScope(req)));
  } catch (error) {
    deliveryError(res, error);
  }
});

router.delete("/wrapped/delivery/:id", async (req, res) => {
  try {
    const { deleteSubscription } = require("../classes/wrapped-delivery");
    await deleteSubscription(String(req.params.id), deliveryScope(req));
    res.json({ ok: true });
  } catch (error) {
    deliveryError(res, error);
  }
});

router.post("/wrapped/delivery/:id/send", async (req, res) => {
  try {
    const { sendNow } = require("../classes/wrapped-delivery");
    res.json(await sendNow(String(req.params.id), deliveryScope(req)));
  } catch (error) {
    deliveryError(res, error);
  }
});

// ---------------------------------------------------------------------------
// Library health

router.get("/library-health", async (req, res) => {
  try {
    const staleDays = clampInt(req.query.staleDays, 365, 30, 3650);
    const [stale, transcoded, noSubs, duplicates, largest, summary] = await Promise.all([
      q(`SELECT i."Id" AS id, i."Name" AS name, i."Type" AS type, i."ProductionYear" AS year, i."DateCreated" AS added,
                MAX(a."ActivityDateInserted") AS last_played, COUNT(a."Id")::int AS plays, MAX(f."Size") AS size
           FROM jf_library_items i
           LEFT JOIN jf_playback_activity a ON a."NowPlayingItemId" = i."Id"
           LEFT JOIN jf_item_info f ON f."Id" = i."Id"
          WHERE i."Type" IN ('Movie','Series') AND COALESCE(i.archived,false) = false
            AND i."DateCreated" < NOW() - ($1 || ' days')::interval
          GROUP BY i."Id"
         HAVING MAX(a."ActivityDateInserted") IS NULL OR MAX(a."ActivityDateInserted") < NOW() - ($1 || ' days')::interval
          ORDER BY MAX(f."Size") DESC NULLS LAST, i."DateCreated" ASC LIMIT 100`, [String(staleDays)]),
      q(`SELECT COALESCE(a."SeriesName", a."NowPlayingItemName") AS name, a."NowPlayingItemId" AS id,
                COUNT(*)::int AS transcodes,
                COUNT(*) FILTER (WHERE a."PlayMethod" ILIKE 'Direct%')::int AS direct,
                MODE() WITHIN GROUP (ORDER BY a."TranscodingInfo"->>'VideoCodec') AS to_codec,
                MODE() WITHIN GROUP (ORDER BY (a."TranscodingInfo"->'TranscodeReasons')::text) AS reasons
           FROM jf_playback_activity a
          WHERE a."PlayMethod" ILIKE 'Transcode%' AND a."ActivityDateInserted" > NOW() - interval '180 days'
          GROUP BY COALESCE(a."SeriesName", a."NowPlayingItemName"), a."NowPlayingItemId"
         HAVING COUNT(*) >= 2 ORDER BY transcodes DESC LIMIT 50`),
      q(`SELECT f."Id" AS id, f."Name" AS name, f."Type" AS type, f."Size" AS size
           FROM jf_item_info f
          WHERE f."Type" IN ('Movie','Episode')
            AND NOT EXISTS (SELECT 1 FROM json_array_elements(COALESCE(f."MediaStreams",'[]'::json)) s WHERE s->>'Type' = 'Subtitle')
          ORDER BY f."Size" DESC NULLS LAST LIMIT 100`),
      q(`SELECT i."Name" AS name, i."ProductionYear" AS year, COUNT(*)::int AS copies,
                json_agg(json_build_object('id', i."Id", 'size', f."Size", 'path', f."Path")) AS items
           FROM jf_library_items i LEFT JOIN jf_item_info f ON f."Id" = i."Id"
          WHERE i."Type" = 'Movie' AND COALESCE(i.archived,false) = false
          GROUP BY i."Name", i."ProductionYear" HAVING COUNT(*) > 1 ORDER BY copies DESC, i."Name" LIMIT 50`),
      q(`SELECT f."Id" AS id, f."Name" AS name, f."Type" AS type, f."Size" AS size, f."Bitrate" AS bitrate
           FROM jf_item_info f WHERE f."Size" IS NOT NULL ORDER BY f."Size" DESC LIMIT 20`),
      q(`SELECT
           (SELECT COUNT(*)::int FROM jf_item_info WHERE "Type" IN ('Movie','Episode')) AS files,
           (SELECT COALESCE(SUM("Size"),0)::bigint FROM jf_item_info) AS total_size`),
    ]);
    const staleSize = stale.reduce((sum, row) => sum + Number(row.size || 0), 0);
    res.json({ staleDays, summary: { ...summary[0], staleSize }, stale, transcoded, noSubs, duplicates, largest });
  } catch (error) {
    res.status(503).json({ error: error.message || "Unable to build the library health report" });
  }
});

// ---------------------------------------------------------------------------
// Stream and transcode insights

router.get("/streams", async (req, res) => {
  try {
    const days = clampInt(req.query.days, 30, 1, 3650);
    const since = `a."ActivityDateInserted" > NOW() - ($1 || ' days')::interval AND COALESCE(a.imported,false) = false`;
    const params = [String(days)];
    const [methods, reasons, codecs, clients, daily, concurrency] = await Promise.all([
      q(`SELECT COALESCE(a."PlayMethod",'Unknown') AS name, COUNT(*)::int AS plays FROM jf_playback_activity a
          WHERE ${since} GROUP BY 1 ORDER BY plays DESC`, params),
      q(`SELECT r.reason AS name, COUNT(*)::int AS plays FROM jf_playback_activity a
          CROSS JOIN LATERAL json_array_elements_text(
            CASE WHEN json_typeof(a."TranscodingInfo"->'TranscodeReasons') = 'array' THEN a."TranscodingInfo"->'TranscodeReasons' ELSE '[]'::json END
          ) AS r(reason)
          WHERE ${since} GROUP BY 1 ORDER BY plays DESC LIMIT 12`, params),
      q(`SELECT COALESCE(s->>'Codec','unknown') AS name, COUNT(*)::int AS plays FROM jf_playback_activity a
          CROSS JOIN LATERAL json_array_elements(COALESCE(a."MediaStreams",'[]'::json)) s
          WHERE ${since} AND s->>'Type' = 'Video' GROUP BY 1 ORDER BY plays DESC LIMIT 8`, params),
      q(`SELECT COALESCE(a."Client",'Unknown') AS name, COUNT(*)::int AS plays,
                COUNT(*) FILTER (WHERE a."PlayMethod" ILIKE 'Transcode%')::int AS transcodes
           FROM jf_playback_activity a WHERE ${since} GROUP BY 1 ORDER BY transcodes DESC, plays DESC LIMIT 10`, params),
      q(`SELECT (a."ActivityDateInserted" AT TIME ZONE $2)::date AS day, COUNT(*)::int AS plays,
                COUNT(*) FILTER (WHERE a."PlayMethod" ILIKE 'Transcode%')::int AS transcodes,
                COALESCE(SUM(a."PlaybackDuration"),0)::bigint AS seconds,
                COALESCE(SUM(a."PlaybackDuration" * NULLIF(a."TranscodingInfo"->>'Bitrate','')::bigint),0)::numeric AS bits
           FROM jf_playback_activity a WHERE ${since} GROUP BY day ORDER BY day`, [String(days), TZ]),
      // Each play covers [start, start + duration]. Walk the start/end events to find the most at once.
      q(`WITH spans AS (
           SELECT a."ActivityDateInserted" - make_interval(secs => a."PlaybackDuration") AS s, a."ActivityDateInserted" AS e
             FROM jf_playback_activity a WHERE ${since} AND a."PlaybackDuration" > 0
         ), ev AS (
           SELECT s AS t, 1 AS d FROM spans UNION ALL SELECT e AS t, -1 AS d FROM spans
         ), run AS (
           SELECT t, SUM(d) OVER (ORDER BY t, d) AS n FROM ev
         )
         SELECT n::int AS peak, t AS at FROM run ORDER BY n DESC, t DESC LIMIT 1`, params),
    ]);
    const total = methods.reduce((sum, row) => sum + row.plays, 0);
    const transcodes = methods.filter((row) => /transcode/i.test(row.name)).reduce((sum, row) => sum + row.plays, 0);
    res.json({
      days,
      summary: { plays: total, transcodes, transcodeRate: total ? transcodes / total : 0, peak: concurrency[0] || null },
      methods,
      reasons,
      codecs,
      clients,
      daily: daily.map((row) => ({ ...row, avgMbps: row.seconds > 0 ? Number(row.bits) / Number(row.seconds) / 1e6 : 0 })),
    });
  } catch (error) {
    res.status(503).json({ error: error.message || "Unable to build stream insights" });
  }
});

// Device profiles: one card per playback device. Device-level history spans every user, so this
// follows the stats-access rule and is only for people who can view all users.
router.get("/devices", async (req, res) => {
  try {
    const { canViewAllUsers } = require("../classes/stats-access");
    if (!canViewAllUsers(req)) return res.status(403).json({ error: "Only server admins can see this." });
    const { buildDeviceProfiles } = require("../classes/device-profiles");
    const days = clampInt(req.query.days, 90, 1, 3650);
    const sort = ["recent", "plays", "transcode"].includes(req.query.sort) ? req.query.sort : "recent";
    res.json(await buildDeviceProfiles({ days, sort }));
  } catch (error) {
    res.status(503).json({ error: error.message || "Unable to build device profiles" });
  }
});

// ---------------------------------------------------------------------------
// Up next and abandoned shows

router.get("/up-next", async (req, res) => {
  try {
    const { userId } = scopedUserId(req);
    const abandonDays = clampInt(req.query.abandonDays, 30, 7, 730);
    const rows = await q(
      `WITH watched AS (
         SELECT a."UserId" AS user_id, MAX(a."UserName") AS user_name, e."SeriesId" AS series_id,
                MAX(e."SeriesName") AS series_name, COUNT(DISTINCT e."EpisodeId")::int AS watched,
                MAX(a."ActivityDateInserted") AS last_watched,
                MAX(e."ParentIndexNumber" * 10000 + e."IndexNumber") AS furthest
           FROM jf_playback_activity a
           JOIN jf_library_episodes e ON e."EpisodeId" = a."EpisodeId"
          WHERE ($1::text IS NULL OR a."UserId" = $1) AND e."ParentIndexNumber" > 0
          GROUP BY a."UserId", e."SeriesId"
       ), totals AS (
         SELECT "SeriesId" AS series_id, COUNT(*)::int AS total FROM jf_library_episodes
          WHERE COALESCE(archived,false) = false AND "ParentIndexNumber" > 0 GROUP BY "SeriesId"
       )
       SELECT w.*, t.total, nx.next_id, nx.next_name, nx.next_season, nx.next_episode, i."Status" AS series_status
         FROM watched w
         JOIN totals t ON t.series_id = w.series_id
         LEFT JOIN jf_library_items i ON i."Id" = w.series_id
         LEFT JOIN LATERAL (
           SELECT e."EpisodeId" AS next_id, e."Name" AS next_name, e."ParentIndexNumber" AS next_season, e."IndexNumber" AS next_episode
             FROM jf_library_episodes e
            WHERE e."SeriesId" = w.series_id AND COALESCE(e.archived,false) = false AND e."ParentIndexNumber" > 0
              AND e."ParentIndexNumber" * 10000 + e."IndexNumber" > w.furthest
            ORDER BY e."ParentIndexNumber", e."IndexNumber" LIMIT 1
         ) nx ON true
        WHERE nx.next_id IS NOT NULL
        ORDER BY w.last_watched DESC
        LIMIT 300`,
      [userId]
    );
    const cutoff = Date.now() - abandonDays * 86400000;
    const upNext = [];
    const abandoned = [];
    rows.forEach((row) => {
      const entry = { ...row, progress: row.total ? Math.min(1, row.watched / row.total) : 0 };
      if (new Date(row.last_watched).getTime() < cutoff) abandoned.push(entry);
      else upNext.push(entry);
    });
    res.json({ abandonDays, upNext, abandoned: abandoned.slice(0, 100) });
  } catch (error) {
    res.status(503).json({ error: error.message || "Unable to build up next" });
  }
});


// Achievements and yearly watch goals. People see their own; admins can look at anyone's.
router.get("/achievements", async (req, res) => {
  try {
    const requestRules = require("../classes/request-rules");
    const achievements = require("../classes/achievements");
    const self = requestRules.userKey(req.user);
    const requested = req.query.userId ? String(req.query.userId) : self;
    const userId = requestRules.isAdmin(req.user) ? requested : self;
    if (!userId) {
      res.json({ empty: true });
      return;
    }
    const year = clampInt(req.query.year, new Date().getFullYear(), 2000, 2100);
    const result = await achievements.buildAchievements(userId, userId, year);
    res.json({ ...result, userId, canEditGoals: userId === self });
  } catch (error) {
    res.status(503).json({ error: error.message || "Unable to load achievements" });
  }
});

router.put("/achievements/goals", async (req, res) => {
  try {
    const requestRules = require("../classes/request-rules");
    const achievements = require("../classes/achievements");
    const self = requestRules.userKey(req.user);
    if (!self) {
      res.status(400).json({ error: "Goals need a signed-in Jellyfin user" });
      return;
    }
    const year = clampInt(req.body?.year, new Date().getFullYear(), 2000, 2100);
    const goals = await achievements.saveGoals(self, year, req.body || {});
    res.json({ year, goals });
  } catch (error) {
    res.status(503).json({ error: error.message || "Unable to save goals" });
  }
});

// "Because you watched" suggestions: genre overlap with a user's own history, limited to titles they haven't played.
router.get("/for-you", async (req, res) => {
  try {
    const requestRules = require("../classes/request-rules");
    const self = requestRules.userKey(req.user);
    const requested = req.query.userId ? String(req.query.userId) : self;
    const userId = requestRules.isAdmin(req.user) ? requested : self;
    if (!userId) {
      res.json({ topGenres: [], picks: [], because: [] });
      return;
    }
    const history = await q(
      `WITH watched AS (
         SELECT COALESCE(e."SeriesId", a."NowPlayingItemId") AS item_id,
                SUM(COALESCE(a."PlaybackDuration", 0))::bigint AS seconds,
                MAX(a."ActivityDateInserted") AS last_watched
           FROM jf_playback_activity a
           LEFT JOIN jf_library_episodes e ON e."EpisodeId" = a."EpisodeId"
          WHERE a."UserId" = $1
          GROUP BY 1
       )
       SELECT w.item_id AS id, w.seconds, w.last_watched, i."Name" AS name, i."Type" AS type, i."Genres" AS genres
         FROM watched w JOIN jf_library_items i ON i."Id" = w.item_id
        WHERE i."Type" IN ('Movie', 'Series')`,
      [userId]
    );
    if (!history.length) {
      res.json({ topGenres: [], picks: [], because: [] });
      return;
    }
    const genreList = (value) => (Array.isArray(value) ? value.map((genre) => String(genre)).filter(Boolean) : []);
    const watchedIds = new Set(history.map((row) => row.id));
    const weights = new Map();
    for (const row of history) {
      const genres = genreList(row.genres);
      const weight = Math.max(1, Math.log10(Number(row.seconds || 0) + 10));
      for (const genre of genres) weights.set(genre, (weights.get(genre) || 0) + weight / genres.length);
    }
    const totalWeight = [...weights.values()].reduce((sum, value) => sum + value, 0) || 1;
    const topGenres = [...weights.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([name, value]) => ({ name, share: Math.round((value / totalWeight) * 100) }));

    const candidates = (
      await q(
        `SELECT "Id" AS id, "Name" AS name, "Type" AS type, "ProductionYear" AS year, "CommunityRating" AS rating,
                "Genres" AS genres, "DateCreated" AS added
           FROM jf_library_items
          WHERE "Type" IN ('Movie', 'Series') AND COALESCE(archived, false) = false AND jsonb_typeof("Genres") = 'array'`
      )
    ).filter((item) => !watchedIds.has(item.id));

    const shape = (item, reason) => ({
      id: item.id,
      name: item.name,
      type: item.type,
      year: item.year,
      rating: item.rating ? Math.round(item.rating * 10) / 10 : null,
      when: reason,
    });
    const recentCutoff = Date.now() - 45 * 86400000;
    const picks = candidates
      .map((item) => {
        const genres = genreList(item.genres);
        if (!genres.length) return null;
        const affinity = genres.reduce((sum, genre) => sum + (weights.get(genre) || 0), 0) / Math.sqrt(genres.length);
        if (!affinity) return null;
        const rating = Number(item.rating || 6);
        const fresh = item.added && new Date(item.added).getTime() > recentCutoff ? 1.15 : 1;
        const best = genres.filter((genre) => weights.has(genre)).sort((a, b) => weights.get(b) - weights.get(a)).slice(0, 2);
        return { item, score: affinity * (0.55 + rating / 20) * fresh, reason: best.length ? `You watch a lot of ${best.join(" & ")}` : null };
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score)
      .slice(0, 24)
      .map(({ item, reason }) => shape(item, reason));

    const pickIds = new Set(picks.slice(0, 12).map((item) => item.id));
    const seeds = history
      .filter((row) => genreList(row.genres).length)
      .sort((a, b) => new Date(b.last_watched) - new Date(a.last_watched))
      .slice(0, 3);
    const because = seeds
      .map((seed) => {
        const seedGenres = new Set(genreList(seed.genres));
        const items = candidates
          .map((item) => {
            const genres = genreList(item.genres);
            const shared = genres.filter((genre) => seedGenres.has(genre)).length;
            if (!shared) return null;
            const overlap = shared / new Set([...genres, ...seedGenres]).size;
            const sameType = item.type === seed.type ? 1.1 : 1;
            return { item, score: overlap * sameType * (0.6 + Number(item.rating || 6) / 20) };
          })
          .filter((entry) => entry && !pickIds.has(entry.item.id))
          .sort((a, b) => b.score - a.score)
          .slice(0, 18)
          .map(({ item }) => shape(item, null));
        return { seed: { id: seed.id, name: seed.name, type: seed.type }, items };
      })
      .filter((row) => row.items.length);

    res.json({ topGenres, picks, because });
  } catch (error) {
    res.status(503).json({ error: error.message || "Unable to build suggestions" });
  }
});

module.exports = router;

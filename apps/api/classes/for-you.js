// Shared "picked for you" and "because you watched" suggestions.
// Used by /insights-data/for-you (My Glance) and the newsletter for-you block.
const db = require("../db");

function q(sql, params = []) {
  return db.pool.query(sql, params).then((result) => result.rows);
}

function genreList(value) {
  return Array.isArray(value) ? value.map((genre) => String(genre)).filter(Boolean) : [];
}

function emptyForYou() {
  return { topGenres: [], picks: [], because: [] };
}

function shape(item, reason, reasonGenres = []) {
  return {
    id: item.id,
    Id: item.id,
    name: item.name,
    Name: item.name,
    type: item.type,
    Type: item.type,
    year: item.year,
    ProductionYear: item.year,
    rating: item.rating ? Math.round(item.rating * 10) / 10 : null,
    PrimaryImageHash: item.primaryImageHash || item.PrimaryImageHash || "",
    when: reason,
    reason,
    reasonGenres,
  };
}

async function buildForYou(userId, { pickLimit = 24, becauseLimit = 18 } = {}) {
  if (!userId) return emptyForYou();
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
  if (!history.length) return emptyForYou();

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
              "Genres" AS genres, "DateCreated" AS added, "PrimaryImageHash" AS "primaryImageHash"
         FROM jf_library_items
        WHERE "Type" IN ('Movie', 'Series') AND COALESCE(archived, false) = false AND jsonb_typeof("Genres") = 'array'`
    )
  ).filter((item) => !watchedIds.has(item.id));

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
      return { item, score: affinity * (0.55 + rating / 20) * fresh, reason: best.length ? `You watch a lot of ${best.join(" & ")}` : null, reasonGenres: best };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score)
    .slice(0, pickLimit)
    .map(({ item, reason, reasonGenres }) => shape(item, reason, reasonGenres));

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
        .slice(0, becauseLimit)
        .map(({ item }) => shape(item, null, []));
      return { seed: { id: seed.id, Id: seed.id, name: seed.name, Name: seed.name, type: seed.type }, items };
    })
    .filter((row) => row.items.length);

  return { topGenres, picks, because };
}

module.exports = { buildForYou, emptyForYou };

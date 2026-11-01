// Taste Map: what each user watches by genre and decade, and where household tastes overlap.
// The query pulls one row per user and title (episodes roll up to their series); everything after
// that is plain aggregation so it can be tested without a database.
const db = require("../db");

const TOP_GENRES = 8;
const TOP_TITLES = 5;

function q(sql, params = []) {
  return db.pool.query(sql, params).then((result) => result.rows);
}

function parseGenres(value) {
  if (Array.isArray(value)) return value.filter((g) => typeof g === "string" && g.trim()).map((g) => g.trim());
  if (typeof value === "string" && value.trim()) {
    try {
      return parseGenres(JSON.parse(value));
    } catch {
      return [];
    }
  }
  return [];
}

function decadeOf(year) {
  const n = Number.parseInt(year, 10);
  if (!Number.isFinite(n) || n < 1880 || n > 2200) return null;
  return `${Math.floor(n / 10) * 10}s`;
}

function round(value, places = 3) {
  const f = 10 ** places;
  return Math.round(value * f) / f;
}

function ranked(map, total, limit) {
  return [...map.entries()]
    .map(([name, seconds]) => ({ name, seconds, share: total > 0 ? round(seconds / total) : 0 }))
    .sort((a, b) => b.seconds - a.seconds || a.name.localeCompare(b.name))
    .slice(0, limit);
}

// rows: [{ user_id, user_name, title_id, title, seconds, plays, genres, year }]
function buildClusters(rows) {
  const users = new Map();
  for (const row of rows || []) {
    if (!row || !row.user_id) continue;
    const seconds = Math.max(0, Number(row.seconds) || 0);
    let user = users.get(row.user_id);
    if (!user) {
      user = { id: String(row.user_id), name: row.user_name || "Unknown", seconds: 0, plays: 0, genres: new Map(), decades: new Map(), titles: new Map() };
      users.set(row.user_id, user);
    }
    user.seconds += seconds;
    user.plays += Number(row.plays) || 0;
    // A title's watch time is split evenly across its genres so multi-genre titles don't count double.
    const genres = parseGenres(row.genres);
    for (const genre of genres) user.genres.set(genre, (user.genres.get(genre) || 0) + seconds / genres.length);
    const decade = decadeOf(row.year);
    if (decade) user.decades.set(decade, (user.decades.get(decade) || 0) + seconds);
    if (row.title_id) {
      const prev = user.titles.get(row.title_id);
      user.titles.set(row.title_id, { id: String(row.title_id), name: row.title || prev?.name || "Unknown", seconds: (prev?.seconds || 0) + seconds });
    }
  }
  return [...users.values()]
    .map((user) => {
      const genreTotal = [...user.genres.values()].reduce((a, b) => a + b, 0);
      const decadeTotal = [...user.decades.values()].reduce((a, b) => a + b, 0);
      return {
        id: user.id,
        name: user.name,
        seconds: Math.round(user.seconds),
        plays: user.plays,
        genres: ranked(user.genres, genreTotal, TOP_GENRES).map((g) => ({ ...g, seconds: Math.round(g.seconds) })),
        decades: ranked(user.decades, decadeTotal, 20).sort((a, b) => a.name.localeCompare(b.name)),
        topTitles: [...user.titles.values()].sort((a, b) => b.seconds - a.seconds).slice(0, TOP_TITLES),
        genreVector: Object.fromEntries([...user.genres.entries()].map(([k, v]) => [k, genreTotal ? v / genreTotal : 0])),
        titleIds: [...user.titles.keys()],
        titleNames: Object.fromEntries([...user.titles.values()].map((t) => [t.id, t.name])),
      };
    })
    .sort((a, b) => b.seconds - a.seconds);
}

// Cosine similarity of two genre-share vectors, 0..1.
function genreSimilarity(a = {}, b = {}) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const [k, v] of Object.entries(a)) {
    na += v * v;
    if (b[k]) dot += v * b[k];
  }
  for (const v of Object.values(b)) nb += v * v;
  if (!na || !nb) return 0;
  return round(dot / Math.sqrt(na * nb));
}

function overlapPair(a, b) {
  const topA = new Set(a.genres.slice(0, 5).map((g) => g.name));
  const sharedGenres = b.genres.slice(0, 5).map((g) => g.name).filter((name) => topA.has(name));
  const bIds = new Set(b.titleIds);
  const sharedTitles = a.titleIds.filter((id) => bIds.has(id)).map((id) => ({ id, name: a.titleNames[id] }));
  const union = new Set([...a.titleIds, ...b.titleIds]).size;
  return {
    a: { id: a.id, name: a.name },
    b: { id: b.id, name: b.name },
    similarity: genreSimilarity(a.genreVector, b.genreVector),
    titleOverlap: union ? round(sharedTitles.length / union) : 0,
    sharedGenres,
    sharedTitles: sharedTitles.slice(0, 8),
    sharedTitleCount: sharedTitles.length,
  };
}

function householdOverlaps(clusters) {
  const pairs = [];
  for (let i = 0; i < clusters.length; i += 1) {
    for (let j = i + 1; j < clusters.length; j += 1) pairs.push(overlapPair(clusters[i], clusters[j]));
  }
  return pairs.sort((x, y) => y.similarity - x.similarity || y.sharedTitleCount - x.sharedTitleCount);
}

// Genres that the most household members have in their own top five.
function householdGenres(clusters) {
  const counts = new Map();
  for (const user of clusters) {
    for (const g of user.genres.slice(0, 5)) {
      const entry = counts.get(g.name) || { name: g.name, users: [], seconds: 0 };
      entry.users.push(user.name);
      entry.seconds += g.seconds;
      counts.set(g.name, entry);
    }
  }
  return [...counts.values()].sort((a, b) => b.users.length - a.users.length || b.seconds - a.seconds).slice(0, 10);
}

function publicCluster({ genreVector, titleIds, titleNames, ...rest }) {
  return rest;
}

function summarise(rows, { household = true } = {}) {
  const clusters = buildClusters(rows);
  return {
    users: clusters.map(publicCluster),
    overlaps: household ? householdOverlaps(clusters) : [],
    sharedGenres: household ? householdGenres(clusters) : [],
  };
}

async function loadRows({ userId = null, days = 365 } = {}) {
  return q(
    `SELECT a."UserId" AS user_id, MAX(a."UserName") AS user_name,
            COALESCE(ep.series_id, a."NowPlayingItemId") AS title_id,
            MAX(COALESCE(a."SeriesName", a."NowPlayingItemName")) AS title,
            SUM(COALESCE(a."PlaybackDuration", 0))::bigint AS seconds, COUNT(*)::int AS plays,
            MAX(i."Genres"::text) AS genres, MAX(i."ProductionYear") AS year
       FROM jf_playback_activity a
       LEFT JOIN LATERAL (
         SELECT e."SeriesId" AS series_id FROM jf_library_episodes e WHERE e."EpisodeId" = a."EpisodeId" LIMIT 1
       ) ep ON a."EpisodeId" IS NOT NULL
       LEFT JOIN jf_library_items i ON i."Id" = COALESCE(ep.series_id, a."NowPlayingItemId")
      WHERE a."ActivityDateInserted" >= now() - ($1::int * interval '1 day')
        AND ($2::text IS NULL OR a."UserId" = $2)
      GROUP BY a."UserId", COALESCE(ep.series_id, a."NowPlayingItemId")`,
    [days, userId]
  );
}

async function buildTasteMap({ userId = null, admin = false, days = 365 } = {}) {
  // Admins see the whole household; everyone else only their own map.
  const rows = await loadRows({ userId: admin ? null : userId, days });
  const result = summarise(rows, { household: admin });
  return { days, scoped: !admin, focusUserId: userId, ...result };
}

module.exports = { buildTasteMap, buildClusters, summarise, householdOverlaps, householdGenres, genreSimilarity, decadeOf, parseGenres };

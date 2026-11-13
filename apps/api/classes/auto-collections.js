const sharp = require("sharp");
const db = require("../db");

const BUILDER_TYPES = ["trending", "recently_added", "oscar_winners", "imdb_top_250", "franchise"];
const DEFAULT_LIMIT = 20;
const TMDB_LISTS = {
  oscar_winners: process.env.TMDB_OSCAR_LIST_ID || "28",
  imdb_top_250: process.env.TMDB_IMDB_TOP250_LIST_ID || "10",
};

function automationAllowed() {
  return process.env.JG_DISABLE_SERVER_AUTOMATION !== "1";
}

function httpError(message, statusCode = 400, code) {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (code) error.code = code;
  return error;
}

function normalizeTitle(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function createTmdbClient({ apiKey = process.env.TMDB_API_KEY, http } = {}) {
  const key = String(apiKey || "").trim();
  if (!key) return null;
  const get = http || (async (path) => {
    const url = new URL(`https://api.themoviedb.org/3/${path.replace(/^\//, "")}`);
    url.searchParams.set("api_key", key);
    const axios = require("axios");
    const { data } = await axios.get(url.toString(), { timeout: 15000 });
    return data;
  });
  return {
    configured: true,
    async trending(media = "movie", window = "week") {
      const data = await get(`/trending/${media}/${window}`);
      return data.results || [];
    },
    async topRated(media = "movie") {
      const pages = [];
      for (let page = 1; page <= 13; page += 1) {
        const data = await get(`/${media}/top_rated?page=${page}`);
        pages.push(...(data.results || []));
        if (!(data.results || []).length) break;
      }
      return pages.slice(0, 250);
    },
    async list(listId) {
      const data = await get(`/list/${listId}`);
      return data.items || data.results || [];
    },
    async collection(collectionId) {
      return get(`/collection/${collectionId}`);
    },
  };
}

function matchLibraryItem(entry, libraryItems) {
  const tmdbId = String(entry.tmdbId || entry.id || "").trim();
  const year = Number(entry.year || (entry.release_date || entry.first_air_date || "").slice(0, 4)) || null;
  const title = normalizeTitle(entry.title || entry.name);
  if (tmdbId) {
    const byId = libraryItems.find((item) => String(item.tmdbId || "") === tmdbId);
    if (byId) return byId;
  }
  return libraryItems.find((item) => {
    if (normalizeTitle(item.name) !== title) return false;
    if (year && item.year && Number(item.year) !== year) return false;
    return true;
  }) || null;
}

function buildCollectionPreview({ type, options = {}, tmdbResults = [], libraryItems = [] }) {
  if (type === "recently_added") {
    const limit = Number(options.limit) > 0 ? Math.min(100, Number(options.limit)) : DEFAULT_LIMIT;
    const items = [...libraryItems]
      .sort((a, b) => new Date(b.added || 0) - new Date(a.added || 0))
      .slice(0, limit)
      .map((item) => ({ ...item, source: "recently_added" }));
    return { type, items, unmatched: [], sourceCount: libraryItems.length };
  }

  const unmatched = [];
  const items = [];
  for (const entry of tmdbResults) {
    const match = matchLibraryItem(entry, libraryItems);
    if (match) {
      items.push({
        ...match,
        source: type,
        tmdbId: entry.tmdbId || entry.id || match.tmdbId,
        franchise: entry.franchise || entry.collectionName || match.franchise,
        collectionName: entry.collectionName || entry.franchise || match.collectionName,
      });
    }
    else unmatched.push({ title: entry.title || entry.name, year: entry.year || null, tmdbId: entry.tmdbId || entry.id || null });
  }
  if (type === "franchise") {
    const groups = new Map();
    for (const item of items) {
      const key = item.franchise || item.collectionName || "Franchise";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    }
    return { type, items, groups: [...groups.entries()].map(([name, rows]) => ({ name, items: rows })), unmatched, sourceCount: tmdbResults.length };
  }
  return { type, items, unmatched, sourceCount: tmdbResults.length };
}

function detectOverlayBadges(streams = {}, rating) {
  const video = streams.video || {};
  const audio = streams.audio || {};
  const height = Number(video.height || 0);
  const labels = [];
  if (height >= 2160 || /2160|4k|uhd/i.test(String(video.displayTitle || video.codec || ""))) labels.push("4K");
  else if (height >= 1080) labels.push("1080p");
  const hdrText = `${video.range || ""} ${video.codec || ""} ${video.displayTitle || ""} ${video.profile || ""}`;
  if (/dolby.?vision|\bdovi\b|dvhe/i.test(hdrText)) labels.push("Dolby Vision");
  else if (/hdr/i.test(hdrText)) labels.push("HDR");
  const audioText = `${audio.codec || ""} ${audio.profile || ""} ${audio.displayTitle || ""} ${audio.channels || ""}`;
  if (/truehd|atmos/i.test(audioText)) labels.push("Atmos");
  else if (/\bdts\b/i.test(audioText)) labels.push("DTS");
  else if (/\b5\.1\b|6ch|channels"?\s*:\s*6/i.test(audioText) || Number(audio.channels) >= 6) labels.push("5.1");
  const ratingLabel = rating !== null && rating !== undefined && String(rating).trim() ? String(rating) : null;
  if (ratingLabel) labels.push({ kind: "rating", text: ratingLabel });
  return labels;
}

function badgeSvg(text, { rating = false } = {}) {
  const width = Math.max(46, 14 + String(text).length * 8);
  const fill = rating ? "#f5c518" : "rgba(8,10,16,0.86)";
  const color = rating ? "#111" : "#f8fafc";
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="22"><rect width="${width}" height="22" rx="4" fill="${fill}"/><text x="7" y="16" font-family="Arial, sans-serif" font-size="11" font-weight="700" fill="${color}">${String(text).replace(/[<>&]/g, "")}</text></svg>`
  );
}

async function renderPosterOverlay(posterBuffer, badges = []) {
  if (!posterBuffer) throw httpError("A poster image is required");
  const base = sharp(posterBuffer).resize(300, 450, { fit: "cover" });
  const composites = [];
  let left = 10;
  let top = 412;
  for (const badge of badges) {
    const isRating = typeof badge === "object" && badge.kind === "rating";
    const text = isRating ? badge.text : badge;
    const input = badgeSvg(text, { rating: isRating });
    const meta = await sharp(input).metadata();
    const width = meta.width || 46;
    if (isRating) {
      composites.push({ input, top: 10, left: Math.max(10, 300 - width - 10) });
    } else {
      if (left + width > 290) {
        left = 10;
        top -= 26;
      }
      composites.push({ input, top, left });
      left += width + 6;
    }
  }
  const buffer = await base.composite(composites).png().toBuffer();
  return { contentType: "image/png", buffer, dataUrl: `data:image/png;base64,${buffer.toString("base64")}` };
}

function normalizeBuilderInput(input = {}, { isCreate = false } = {}) {
  const name = String(input.name || "").trim();
  const type = String(input.type || "").trim();
  if (!name) throw httpError("A builder name is required");
  if (!BUILDER_TYPES.includes(type)) throw httpError("Unknown collection builder type");
  return {
    name,
    type,
    library_id: String(input.libraryId || input.library_id || "").trim() || null,
    options: input.options && typeof input.options === "object" ? input.options : {},
    preview_only: isCreate ? true : input.preview_only === undefined && input.previewOnly === undefined ? true : Boolean(input.preview_only ?? input.previewOnly),
    apply_enabled: isCreate ? false : Boolean(input.apply_enabled ?? input.applyEnabled),
  };
}

function formatBuilder(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    libraryId: row.library_id,
    libraryName: row.library_name || null,
    options: row.options || {},
    previewOnly: row.preview_only !== false,
    applyEnabled: Boolean(row.apply_enabled),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function listLibraries() {
  const { rows } = await db.query(
    `SELECT "Id" AS id, "Name" AS name, "CollectionType" AS collection_type
       FROM jf_libraries
      WHERE archived IS NOT TRUE
      ORDER BY "Name"`
  );
  return rows;
}

async function loadLibraryItems(libraryId) {
  const params = [];
  let where = `i.archived IS NOT TRUE AND i."Type" IN ('Movie', 'Series')`;
  if (libraryId) {
    params.push(libraryId);
    where += ` AND i."ParentId" = $1`;
  }
  const { rows } = await db.query(
    `SELECT i."Id" AS id, i."Name" AS name, i."Type" AS type, i."ParentId" AS library_id,
            i."ProductionYear" AS year, i."DateCreated" AS added, i."CommunityRating" AS rating,
            i."ImageTagsPrimary" AS image_tag
       FROM jf_library_items i
      WHERE ${where}
      ORDER BY i."DateCreated" DESC NULLS LAST, i."Name"`,
    params
  );
  return rows;
}

async function listBuilders() {
  const { rows } = await db.query(
    `SELECT b.*, l."Name" AS library_name
       FROM jg_collection_builders b
       LEFT JOIN jf_libraries l ON l."Id" = b.library_id
      ORDER BY b.created_at`
  );
  return rows.map(formatBuilder);
}

async function getBuilder(id) {
  const { rows } = await db.query(
    `SELECT b.*, l."Name" AS library_name
       FROM jg_collection_builders b
       LEFT JOIN jf_libraries l ON l."Id" = b.library_id
      WHERE b.id = $1`,
    [id]
  );
  const builder = formatBuilder(rows[0]);
  if (!builder) throw httpError("Builder not found", 404);
  return builder;
}

async function createBuilder(input) {
  const builder = normalizeBuilderInput(input, { isCreate: true });
  const { rows } = await db.query(
    `INSERT INTO jg_collection_builders (name, type, library_id, options, preview_only, apply_enabled)
     VALUES ($1, $2, $3, $4::jsonb, true, false)
     RETURNING *`,
    [builder.name, builder.type, builder.library_id, JSON.stringify(builder.options)]
  );
  return formatBuilder(rows[0]);
}

async function updateBuilder(id, input) {
  const existing = await getBuilder(id);
  const builder = normalizeBuilderInput({ ...existing, ...input, libraryId: input.libraryId || input.library_id || existing.libraryId, type: input.type || existing.type }, { isCreate: false });
  const { rows } = await db.query(
    `UPDATE jg_collection_builders
        SET name = $2, type = $3, library_id = $4, options = $5::jsonb,
            preview_only = $6, apply_enabled = $7, updated_at = NOW()
      WHERE id = $1
      RETURNING *`,
    [id, builder.name, builder.type, builder.library_id, JSON.stringify(builder.options), builder.preview_only, builder.apply_enabled]
  );
  return formatBuilder(rows[0]);
}

async function deleteBuilder(id) {
  await getBuilder(id);
  await db.query(`DELETE FROM jg_collection_builders WHERE id = $1`, [id]);
  return { ok: true };
}

async function fetchTmdbResults(type, options, tmdb) {
  if (type === "recently_added") return [];
  if (!tmdb) throw httpError("TMDB is not configured. Set TMDB_API_KEY to preview Trending, Oscars, IMDb Top 250 or Franchise lists.", 503, "TMDB_MISSING");
  if (type === "trending") return tmdb.trending(options.media || "movie", options.window || "week");
  if (type === "oscar_winners") {
    try {
      return await tmdb.list(options.listId || TMDB_LISTS.oscar_winners);
    } catch {
      return tmdb.topRated("movie");
    }
  }
  if (type === "imdb_top_250") {
    try {
      const items = await tmdb.list(options.listId || TMDB_LISTS.imdb_top_250);
      if (items.length) return items;
    } catch {
      /* fall through */
    }
    return tmdb.topRated("movie");
  }
  if (type === "franchise") {
    const collectionIds = options.collectionIds || [];
    const rows = [];
    for (const collectionId of collectionIds) {
      const collection = await tmdb.collection(collectionId);
      for (const part of collection.parts || []) {
        rows.push({ ...part, franchise: collection.name, collectionName: collection.name });
      }
    }
    return rows;
  }
  return [];
}

async function previewBuilder(id, { tmdb = createTmdbClient(), now } = {}) {
  const builder = await getBuilder(id);
  const libraryItems = await loadLibraryItems(builder.libraryId);
  let tmdbResults = [];
  let tmdbError = null;
  try {
    tmdbResults = await fetchTmdbResults(builder.type, builder.options, tmdb);
  } catch (error) {
    if (error.code === "TMDB_MISSING") tmdbError = error.message;
    else throw error;
  }
  const preview = buildCollectionPreview({ type: builder.type, options: builder.options, tmdbResults, libraryItems });
  return {
    builder,
    ...preview,
    tmdbError,
    automationAllowed: automationAllowed(),
    now: now || undefined,
  };
}

function assertApplyAllowed(builder) {
  if (builder.previewOnly !== false || builder.preview_only === true) {
    throw httpError("This builder is preview only. Turn off preview and enable apply before writing to Jellyfin.", 403, "PREVIEW_ONLY");
  }
  if (!builder.applyEnabled && !builder.apply_enabled) {
    throw httpError("Apply is disabled until you enable it on this builder.", 403, "APPLY_DISABLED");
  }
  if (!automationAllowed()) {
    throw httpError("Server automation is disabled. Collection and poster writes stay blocked.", 403, "AUTOMATION_DISABLED");
  }
}

async function applyBuilder(id, { confirm = false, jellyfin, tmdb = createTmdbClient() } = {}) {
  const preview = await previewBuilder(id, { tmdb });
  if (!confirm) return { needsConfirm: true, ...preview };
  assertApplyAllowed(preview.builder);
  if (!jellyfin?.createCollection) throw httpError("Jellyfin client is missing createCollection", 500);
  const result = await jellyfin.createCollection({
    name: preview.builder.name,
    ids: preview.items.map((item) => item.id),
  });
  await db.query(
    `INSERT INTO jg_collection_runs (builder_id, preview, status, item_count, message)
     VALUES ($1, false, 'applied', $2, $3)`,
    [id, preview.items.length, "Created collection in Jellyfin"]
  );
  return { needsConfirm: false, applied: true, result, ...preview };
}

function parseMediaStreams(raw) {
  if (!raw) return {};
  let streams = raw;
  if (typeof raw === "string") {
    try { streams = JSON.parse(raw); } catch { streams = []; }
  }
  const list = Array.isArray(streams) ? streams : streams.MediaStreams || [];
  const video = list.find((stream) => String(stream.Type || stream.type).toLowerCase() === "video") || {};
  const audio = list.find((stream) => String(stream.Type || stream.type).toLowerCase() === "audio") || {};
  return {
    video: { height: video.Height || video.height, codec: video.Codec || video.codec, range: video.VideoRange || video.videoRange, profile: video.Profile || video.profile, displayTitle: video.DisplayTitle || video.displayTitle },
    audio: { codec: audio.Codec || audio.codec, profile: audio.Profile || audio.profile, channels: audio.Channels || audio.channels, displayTitle: audio.DisplayTitle || audio.displayTitle },
  };
}

async function previewOverlays({ libraryId, limit = 8, jellyfin, posters } = {}) {
  const items = (await loadLibraryItems(libraryId)).slice(0, Math.min(20, Number(limit) || 8));
  const previews = [];
  for (const item of items) {
    const info = await db.query(`SELECT "MediaStreams" FROM jf_item_info WHERE "Id" = $1`, [item.id]).catch(() => ({ rows: [] }));
    const streams = parseMediaStreams(info.rows?.[0]?.MediaStreams);
    const badges = detectOverlayBadges(streams, item.rating);
    let posterBuffer = posters?.[item.id];
    if (!posterBuffer && jellyfin?.getPoster) {
      posterBuffer = await jellyfin.getPoster(item.id).catch(() => null);
    }
    if (!posterBuffer) {
      posterBuffer = await sharp({ create: { width: 300, height: 450, channels: 3, background: { r: 28, g: 36, b: 52 } } }).png().toBuffer();
    }
    const rendered = await renderPosterOverlay(posterBuffer, badges);
    previews.push({ id: item.id, name: item.name, year: item.year, badges: badges.map((badge) => (typeof badge === "object" ? badge.text : badge)), preview: rendered.dataUrl });
  }
  return { previewOnly: true, applyEnabled: false, automationAllowed: automationAllowed(), items: previews };
}

async function applyOverlays({ itemIds = [], confirm = false, jellyfin, posters } = {}) {
  if (!confirm) return { needsConfirm: true, count: itemIds.length };
  if (!automationAllowed()) throw httpError("Server automation is disabled. Poster writes stay blocked.", 403, "AUTOMATION_DISABLED");
  if (!jellyfin?.setPoster || !jellyfin?.getPoster) throw httpError("Jellyfin client is missing poster methods", 500);
  const applied = [];
  for (const itemId of itemIds) {
    const existing = await db.query(`SELECT item_id FROM jg_poster_originals WHERE item_id = $1`, [itemId]);
    if (!existing.rows.length) {
      const original = posters?.[itemId] || (await jellyfin.getPoster(itemId));
      if (!original) throw httpError(`No original poster for ${itemId}`, 400);
      await db.query(
        `INSERT INTO jg_poster_originals (item_id, image_bytes, content_type) VALUES ($1, $2, 'image/jpeg')`,
        [itemId, original]
      );
    }
    await jellyfin.setPoster(itemId, posters?.[`${itemId}-overlay`] || posters?.[itemId]);
    applied.push(itemId);
  }
  return { applied, storedOriginals: true };
}

async function revertOverlays({ itemIds, jellyfin } = {}) {
  if (!automationAllowed()) throw httpError("Server automation is disabled. Reverts stay blocked on this build.", 403, "AUTOMATION_DISABLED");
  if (!jellyfin?.setPoster) throw httpError("Jellyfin client is missing setPoster", 500);
  const ids = itemIds?.length ? itemIds : (await db.query(`SELECT item_id FROM jg_poster_originals`)).rows.map((row) => row.item_id);
  const restored = [];
  for (const itemId of ids) {
    const { rows } = await db.query(`SELECT image_bytes, content_type FROM jg_poster_originals WHERE item_id = $1`, [itemId]);
    if (!rows[0]) continue;
    await jellyfin.setPoster(itemId, rows[0].image_bytes, rows[0].content_type);
    restored.push(itemId);
  }
  return { restored };
}

async function listOriginals() {
  const { rows } = await db.query(`SELECT item_id, item_name, content_type, saved_at FROM jg_poster_originals ORDER BY saved_at DESC`);
  return rows.map((row) => ({ itemId: row.item_id, itemName: row.item_name, contentType: row.content_type, savedAt: row.saved_at }));
}

module.exports = {
  BUILDER_TYPES,
  automationAllowed,
  createTmdbClient,
  matchLibraryItem,
  buildCollectionPreview,
  detectOverlayBadges,
  renderPosterOverlay,
  normalizeBuilderInput,
  listLibraries,
  listBuilders,
  getBuilder,
  createBuilder,
  updateBuilder,
  deleteBuilder,
  previewBuilder,
  applyBuilder,
  previewOverlays,
  applyOverlays,
  revertOverlays,
  listOriginals,
  assertApplyAllowed,
};

// Demo Active Sessions for local copies of a production database.
//
// Turned on with JG_DEMO_SESSIONS=1. Instead of asking the media server, the
// API builds a handful of sessions from real playback history in the local
// database, so Home can be tried without a live server connection. Every
// session carries IsDemo: true and an Id starting with "demo-".

const TICKS_PER_SECOND = 10_000_000;
const MODES = ["idle", "1", "3", "5"];

let mode = MODES.includes(process.env.JG_DEMO_SESSIONS_MODE) ? process.env.JG_DEMO_SESSIONS_MODE : "5";
let cache = null;
let cacheAt = 0;
const startedAt = Date.now();

function isDemoSessionsEnabled() {
  return process.env.JG_DEMO_SESSIONS === "1";
}

function getDemoSessionsMode() {
  return { enabled: isDemoSessionsEnabled(), mode, modes: MODES };
}

function setDemoSessionsMode(next) {
  if (!MODES.includes(String(next))) return false;
  mode = String(next);
  return true;
}

const HISTORY_SQL = `
  SELECT DISTINCT ON (a."UserId")
         a."Id", a."UserId", a."UserName", a."Client", a."DeviceName", a."DeviceId", a."ApplicationVersion",
         a."NowPlayingItemId", a."NowPlayingItemName", a."EpisodeId", a."SeasonId", a."SeriesName",
         a."PlayMethod", a."MediaStreams", a."TranscodingInfo", a."OriginalContainer", a."ActivityDateInserted",
         COALESCE(e."RunTimeTicks", i."RunTimeTicks") AS "RunTimeTicks",
         e."Name" AS "EpisodeName", e."IndexNumber", e."ParentIndexNumber", e."SeriesId",
         i."ProductionYear", i."Type" AS "ItemType",
         COALESCE(e."PrimaryImageHash", i."PrimaryImageHash") AS "PrimaryImageHash"
    FROM jf_playback_activity a
    LEFT JOIN jf_library_episodes e ON e."EpisodeId" = a."EpisodeId"
    LEFT JOIN jf_library_items i ON i."Id" = a."NowPlayingItemId"
   WHERE a."UserId" IS NOT NULL AND a."NowPlayingItemName" IS NOT NULL
     AND COALESCE(e."RunTimeTicks", i."RunTimeTicks", 0) > 0
   ORDER BY a."UserId", a."ActivityDateInserted" DESC`;

function hashFraction(text) {
  let hash = 0;
  for (const char of String(text)) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return (hash % 1000) / 1000;
}

function asObject(value) {
  if (!value) return null;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function buildTranscodingInfo(row) {
  if (String(row.PlayMethod).toLowerCase() !== "transcode") return null;
  const saved = asObject(row.TranscodingInfo) || {};
  return {
    Container: "ts",
    VideoCodec: "h264",
    AudioCodec: "aac",
    AudioChannels: 2,
    Height: 1080,
    IsVideoDirect: false,
    IsAudioDirect: false,
    ...saved,
  };
}

function toSession(row, index, now) {
  const runtime = Number(row.RunTimeTicks) || 0;
  const offset = 0.12 + hashFraction(row.Id) * 0.6;
  const paused = index === 3;
  const elapsedTicks = paused ? 0 : ((now - startedAt) / 1000) * TICKS_PER_SECOND;
  const position = Math.min(runtime - TICKS_PER_SECOND, runtime * offset + elapsedTicks);
  const isEpisode = Boolean(row.EpisodeId);
  const mediaStreams = Array.isArray(asObject(row.MediaStreams)) ? asObject(row.MediaStreams) : [];
  const audioIndex = mediaStreams.findIndex((stream) => stream?.Type === "Audio");
  return {
    Id: `demo-${row.Id}`,
    IsDemo: true,
    UserId: row.UserId,
    UserName: row.UserName,
    Client: row.Client,
    DeviceName: row.DeviceName,
    DeviceId: `demo-${row.DeviceId || index}`,
    ApplicationVersion: row.ApplicationVersion,
    RemoteEndPoint: "demo",
    PlayState: {
      PositionTicks: Math.max(0, Math.round(position)),
      IsPaused: paused,
      PlayMethod: row.PlayMethod || "DirectPlay",
      AudioStreamIndex: audioIndex >= 0 ? audioIndex : undefined,
    },
    NowPlayingItem: {
      Id: isEpisode ? row.EpisodeId : row.NowPlayingItemId,
      Name: isEpisode ? row.EpisodeName || row.NowPlayingItemName : row.NowPlayingItemName,
      SeriesName: isEpisode ? row.SeriesName : undefined,
      SeriesId: isEpisode ? row.SeriesId : undefined,
      ParentIndexNumber: isEpisode ? row.ParentIndexNumber : undefined,
      IndexNumber: isEpisode ? row.IndexNumber : undefined,
      Type: isEpisode ? "Episode" : row.ItemType || "Movie",
      ProductionYear: row.ProductionYear || undefined,
      RunTimeTicks: runtime,
      Container: row.OriginalContainer || "mkv",
      MediaStreams: mediaStreams,
      PrimaryImageHash: row.PrimaryImageHash || null,
    },
    TranscodingInfo: buildTranscodingInfo(row),
  };
}

async function getDemoSessions(db, now = Date.now()) {
  if (mode === "idle") return [];
  if (!cache || now - cacheAt > 10 * 60 * 1000) {
    const { rows } = await db.query(HISTORY_SQL);
    cache = rows.sort((a, b) => new Date(b.ActivityDateInserted) - new Date(a.ActivityDateInserted)).slice(0, 5);
    cacheAt = now;
  }
  return cache.slice(0, Number(mode)).map((row, index) => toSession(row, index, now));
}

module.exports = { isDemoSessionsEnabled, getDemoSessionsMode, setDemoSessionsMode, getDemoSessions, toSession, MODES };

// Device profiles: one card per playback device (DeviceId, falling back to client + device name)
// summarising how it plays: direct vs transcode, typical bitrate, apps used, who uses it and when
// it was last seen. The query returns one row per play; the aggregation is plain JS so it can be
// tested without a database.
const db = require("../db");

const TOP_USERS = 3;
const TOP_REASONS = 3;

// Short, device-oriented hints for the most common transcode reasons.
const REASON_HINTS = {
  ContainerNotSupported: { label: "Container not supported", hint: "Remux to MP4/MKV or use a client that supports the container." },
  VideoCodecNotSupported: { label: "Video codec not supported", hint: "Check the client's HEVC/AV1 support or keep an H.264 version." },
  AudioCodecNotSupported: { label: "Audio codec not supported", hint: "Enable passthrough or pick a stereo/AAC track on this device." },
  SubtitleCodecNotSupported: { label: "Subtitles burned in", hint: "Prefer SRT over PGS/ASS, or turn subtitles off on this device." },
  ContainerBitrateExceedsLimit: { label: "Bitrate over limit", hint: "Raise the client's quality/bitrate setting or the user's remote limit." },
  VideoBitrateNotSupported: { label: "Video bitrate too high", hint: "Raise the client's max bitrate setting." },
  AudioChannelsNotSupported: { label: "Too many audio channels", hint: "Allow surround on the client or pick a stereo track." },
  VideoLevelNotSupported: { label: "Video profile level not supported", hint: "The device can't decode this level; a lower-level encode helps." },
  VideoRangeTypeNotSupported: { label: "HDR type not supported", hint: "Enable tone mapping or use an HDR-capable client." },
  DirectPlayError: { label: "Direct play failed", hint: "Retry; if it repeats, update the client app." },
};

function q(sql, params = []) {
  return db.pool.query(sql, params).then((result) => result.rows);
}

function parseJson(value) {
  if (value && typeof value === "object") return value;
  if (typeof value === "string" && value.trim()) {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  return null;
}

function playKind(method) {
  const m = String(method || "").toLowerCase();
  if (m.startsWith("transcode")) return "transcode";
  if (m === "directstream") return "directStream";
  if (m === "directplay") return "directPlay";
  return "unknown";
}

function deviceKey(row) {
  if (row.device_id) return `id:${row.device_id}`;
  return `name:${row.client || "Unknown"}|${row.device_name || "Unknown"}`;
}

function rateOf(part, whole) {
  return whole > 0 ? Math.round((part / whole) * 1000) / 1000 : 0;
}

function ranked(map, limit) {
  return [...map.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, limit);
}

function tsOf(value) {
  const t = value ? new Date(value).getTime() : NaN;
  return Number.isFinite(t) ? t : 0;
}

// rows: [{ device_id, device_name, client, app_version, user_id, user_name, play_method,
//          duration, at, transcoding_info }]
function buildProfiles(rows) {
  const devices = new Map();
  for (const row of rows || []) {
    if (!row) continue;
    const key = deviceKey(row);
    let d = devices.get(key);
    if (!d) {
      d = {
        key,
        deviceId: row.device_id || null,
        name: row.device_name || "Unknown device",
        client: row.client || "Unknown",
        plays: 0,
        seconds: 0,
        methods: { directPlay: 0, directStream: 0, transcode: 0, unknown: 0 },
        bitrateSeconds: 0,
        bitrateWeight: 0,
        lastSeen: 0,
        firstSeen: 0,
        apps: new Map(),
        users: new Map(),
        reasons: new Map(),
        hw: 0,
      };
      devices.set(key, d);
    }
    const seconds = Math.max(0, Number(row.duration) || 0);
    const at = tsOf(row.at);
    d.plays += 1;
    d.seconds += seconds;
    d.methods[playKind(row.play_method)] += 1;
    if (at >= d.lastSeen) {
      d.lastSeen = at;
      if (row.device_name) d.name = row.device_name;
      if (row.client) d.client = row.client;
    }
    if (!d.firstSeen || (at && at < d.firstSeen)) d.firstSeen = at;
    const app = `${row.client || "Unknown"}${row.app_version ? ` ${row.app_version}` : ""}`;
    const appEntry = d.apps.get(app) || { name: app, plays: 0, lastSeen: 0 };
    appEntry.plays += 1;
    appEntry.lastSeen = Math.max(appEntry.lastSeen, at);
    d.apps.set(app, appEntry);
    if (row.user_id || row.user_name) {
      const uk = row.user_id || row.user_name;
      const u = d.users.get(uk) || { id: row.user_id || null, name: row.user_name || "Unknown", plays: 0, seconds: 0 };
      u.plays += 1;
      u.seconds += seconds;
      d.users.set(uk, u);
    }
    const info = parseJson(row.transcoding_info);
    const bitrate = Number(info?.Bitrate) || 0;
    if (bitrate > 0) {
      // Weight by watch time so a 2-hour film counts more than a 30-second skip; fall back to 1.
      const w = seconds || 1;
      d.bitrateSeconds += bitrate * w;
      d.bitrateWeight += w;
    }
    if (playKind(row.play_method) === "transcode") {
      if (info?.HardwareAccelerationType && info.HardwareAccelerationType !== "none") d.hw += 1;
      const reasons = Array.isArray(info?.TranscodeReasons) ? info.TranscodeReasons : [];
      for (const r of reasons) d.reasons.set(r, (d.reasons.get(r) || 0) + 1);
    }
  }
  return [...devices.values()];
}

function publicProfile(d) {
  const direct = d.methods.directPlay + d.methods.directStream;
  const reasons = ranked(d.reasons, TOP_REASONS).map((r) => ({
    code: r.name,
    count: r.count,
    label: REASON_HINTS[r.name]?.label || r.name,
    hint: REASON_HINTS[r.name]?.hint || null,
  }));
  return {
    key: d.key,
    deviceId: d.deviceId,
    name: d.name,
    client: d.client,
    plays: d.plays,
    seconds: d.seconds,
    methods: d.methods,
    directRate: rateOf(direct, d.plays),
    directPlayRate: rateOf(d.methods.directPlay, d.plays),
    transcodeRate: rateOf(d.methods.transcode, d.plays),
    hardwareRate: rateOf(d.hw, d.methods.transcode),
    avgBitrate: d.bitrateWeight > 0 ? Math.round(d.bitrateSeconds / d.bitrateWeight) : null,
    lastSeen: d.lastSeen ? new Date(d.lastSeen).toISOString() : null,
    firstSeen: d.firstSeen ? new Date(d.firstSeen).toISOString() : null,
    apps: [...d.apps.values()].sort((a, b) => b.lastSeen - a.lastSeen || b.plays - a.plays).map((a) => ({ name: a.name, plays: a.plays, lastSeen: a.lastSeen ? new Date(a.lastSeen).toISOString() : null })),
    users: [...d.users.values()].sort((a, b) => b.plays - a.plays || a.name.localeCompare(b.name)).slice(0, TOP_USERS),
    userCount: d.users.size,
    reasons,
    verdict: verdictOf(d.plays, rateOf(d.methods.transcode, d.plays)),
  };
}

function verdictOf(plays, transcodeRate) {
  if (!plays) return "idle";
  if (transcodeRate >= 0.5) return "struggles";
  if (transcodeRate >= 0.15) return "mixed";
  return "healthy";
}

const SORTS = {
  recent: (a, b) => tsOf(b.lastSeen) - tsOf(a.lastSeen),
  plays: (a, b) => b.plays - a.plays,
  transcode: (a, b) => b.transcodeRate - a.transcodeRate || b.plays - a.plays,
};

function summarise(rows, { sort = "recent" } = {}) {
  const profiles = buildProfiles(rows).map(publicProfile);
  profiles.sort((a, b) => (SORTS[sort] || SORTS.recent)(a, b) || a.name.localeCompare(b.name));
  const plays = profiles.reduce((s, p) => s + p.plays, 0);
  const transcodes = profiles.reduce((s, p) => s + p.methods.transcode, 0);
  return {
    summary: {
      devices: profiles.length,
      plays,
      transcodeRate: rateOf(transcodes, plays),
      struggling: profiles.filter((p) => p.verdict === "struggles").length,
    },
    devices: profiles,
  };
}

async function loadRows({ days = 90 } = {}) {
  return q(
    `SELECT a."DeviceId" AS device_id, a."DeviceName" AS device_name, a."Client" AS client,
            a."ApplicationVersion" AS app_version, a."UserId" AS user_id, a."UserName" AS user_name,
            a."PlayMethod" AS play_method, a."PlaybackDuration" AS duration, a."ActivityDateInserted" AS at,
            a."TranscodingInfo" AS transcoding_info
       FROM jf_playback_activity a
      WHERE a."ActivityDateInserted" >= now() - ($1::int * interval '1 day')
        AND COALESCE(a.imported, false) = false`,
    [days]
  );
}

async function buildDeviceProfiles({ days = 90, sort = "recent" } = {}) {
  return { days, ...summarise(await loadRows({ days }), { sort }) };
}

module.exports = { buildDeviceProfiles, buildProfiles, summarise, playKind, deviceKey, verdictOf, REASON_HINTS };

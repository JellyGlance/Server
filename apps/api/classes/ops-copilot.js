// Ops Copilot: an admin-only "ask the server" surface. A small rules-based intent router reads
// data JellyGlance already has (live sessions, playback history, library sizes, download
// queues) and answers with a diagnosis. Anything that would change state comes back as a plan
// with dry-run steps; only the steps marked executable can run, and only after an explicit
// approve. Every question, plan, approval, cancel and undo is appended to OpsCopilotAudit.
const { randomUUID } = require("crypto");
const db = require("../db");
const { getSettings, mergeSettings } = require("./admin-history");

const AUDIT_KEY = "OpsCopilotAudit";
const PLANS_KEY = "OpsCopilotPlans";
const MAX_AUDIT = 1000;
const MAX_PLANS = 50;
const PLAN_TTL_MS = 60 * 60 * 1000;

const INTENTS = [
  {
    id: "playback",
    label: "Playback / buffering",
    patterns: [/buffer/, /stutter/, /lag/, /transcod/, /playback/, /freez/, /slow/, /keeps? (stopping|pausing)/, /direct ?play/],
  },
  {
    id: "disk",
    label: "Disk / library pressure",
    patterns: [/disk/, /space/, /storage/, /\bfree\b.*\b(gb|tb|space)\b/, /\bfree up\b/, /largest/, /biggest/, /cleanup|clean up/, /unwatched/, /\d+\s?(gb|tb)\b/],
  },
  {
    id: "downloads",
    label: "Downloads / *arr health",
    patterns: [/download/, /torrent/, /queue/, /stalled|stuck/, /\b(sonarr|radarr|lidarr|qbit|qbittorrent|sabnzbd|nzbget|deluge|transmission|arr)\b/, /grab/],
  },
];

const EXAMPLES = [
  "Why is Dune buffering for Mum?",
  "Who is transcoding right now?",
  "Free 500 GB without touching favourites",
  "Anything stuck in downloads?",
];

function parseSize(text) {
  const match = String(text).match(/(\d+(?:\.\d+)?)\s?(tb|gb)\b/i);
  if (!match) return null;
  const value = Number(match[1]);
  return Math.round(value * (match[2].toLowerCase() === "tb" ? 1024 ** 4 : 1024 ** 3));
}

// "why is Dune buffering for Mum" -> { title: "Dune", user: "Mum" }
function parseSubjects(text) {
  const raw = String(text || "").trim();
  const user = raw.match(/\bfor\s+([\p{L}\d][\p{L}\d ._'-]{0,40}?)(?:[?.!,]|\s+(?:on|when|while|today|tonight|right now|now)\b|$)/iu)?.[1]?.trim() || null;
  const title =
    raw.match(/\bis\s+["“]?(.+?)["”]?\s+(?:buffering|stuttering|lagging|transcoding|freezing|slow)\b/i)?.[1]?.trim() ||
    raw.match(/["“](.+?)["”]/)?.[1]?.trim() ||
    null;
  return { user, title: title && !/^(it|this|that|playback|everything|something)$/i.test(title) ? title : null };
}

function routeIntent(question) {
  const text = String(question || "").toLowerCase();
  const scored = INTENTS.map((intent) => ({ intent, score: intent.patterns.filter((p) => p.test(text)).length })).filter((row) => row.score > 0);
  scored.sort((a, b) => b.score - a.score);
  const best = scored[0]?.intent || null;
  return {
    intent: best ? best.id : "unknown",
    label: best ? best.label : "Not sure",
    subjects: parseSubjects(question),
    targetBytes: parseSize(question),
    protectFavourites: /favou?rite/i.test(text),
  };
}

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (!value) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)));
  return `${(value / 1024 ** i).toFixed(i >= 3 ? 1 : 0)} ${units[i]}`;
}

const REASON_TEXT = {
  ContainerNotSupported: "the container isn't supported by the client",
  VideoCodecNotSupported: "the video codec isn't supported by the client",
  AudioCodecNotSupported: "the audio codec isn't supported by the client",
  SubtitleCodecNotSupported: "subtitles have to be burned in",
  VideoResolutionNotSupported: "the resolution is too high for the client",
  VideoBitrateNotSupported: "the bitrate is above the client's limit",
  ContainerBitrateExceedsLimit: "the bitrate is above the client's/remote limit",
  AudioChannelsNotSupported: "the audio channel layout isn't supported",
  VideoRangeTypeNotSupported: "HDR has to be tone-mapped",
  DirectPlayError: "direct play failed on the client",
};

function explainReasons(reasons) {
  const list = Array.isArray(reasons) ? reasons : [];
  return list.map((reason) => REASON_TEXT[reason] || reason);
}

function matches(value, needle) {
  if (!needle) return true;
  return String(value || "").toLowerCase().includes(String(needle).toLowerCase());
}

function sessionTitle(session) {
  const item = session.NowPlayingItem || {};
  return item.SeriesName ? `${item.SeriesName} – ${item.Name}` : item.Name || "Unknown";
}

// Pure diagnosis so it can be tested without Jellyfin.
function diagnosePlayback(sessions, history, subjects = {}) {
  const live = (Array.isArray(sessions) ? sessions : [])
    .filter((s) => s.NowPlayingItem)
    .filter((s) => matches(s.UserName, subjects.user) && (matches(s.NowPlayingItem?.Name, subjects.title) || matches(s.NowPlayingItem?.SeriesName, subjects.title)));
  const findings = [];
  const plans = [];
  for (const session of live) {
    const t = session.TranscodingInfo || null;
    const method = session.PlayState?.PlayMethod || (t ? "Transcode" : "DirectPlay");
    const reasons = explainReasons(t?.TranscodeReasons);
    const lines = [`${session.UserName || "Someone"} is watching ${sessionTitle(session)} on ${session.Client || "a client"}${session.DeviceName ? ` (${session.DeviceName})` : ""} via ${method}.`];
    if (method === "Transcode" && t) {
      lines.push(reasons.length ? `It is transcoding because ${reasons.join(", ")}.` : "It is transcoding (no reason reported).");
      if (t.Framerate && Number(t.Framerate) < 24) lines.push(`Transcoder is only managing ${Number(t.Framerate).toFixed(0)} fps, which is below real time, so buffering is expected.`);
      if (t.IsVideoDirect === false && !t.HardwareAccelerationType) lines.push("Video is being re-encoded in software (no hardware acceleration reported).");
      const tips = [];
      if ((t.TranscodeReasons || []).some((r) => /Bitrate/.test(r))) tips.push(`Raise the remote/client bitrate limit for ${session.UserName || "this user"}`);
      if ((t.TranscodeReasons || []).includes("SubtitleCodecNotSupported")) tips.push("Switch to a text subtitle (SRT) or turn subtitles off");
      if ((t.TranscodeReasons || []).some((r) => /Codec|Container|Range/.test(r))) tips.push("Use a client that supports the source format, or add an optimised version");
      if (!tips.length) tips.push("Ask the user to pick a lower quality in the client");
      plans.push({
        kind: "playback-fix",
        title: `Fix transcoding for ${session.UserName || "this session"}`,
        steps: [
          ...tips.map((tip) => ({ text: tip, executable: false })),
          { text: `Send ${session.UserName || "the user"} a message suggesting a lower quality`, executable: true, action: { type: "session.message", sessionId: session.Id, text: "Playback is transcoding on the server. Picking a lower quality in the player should stop the buffering." } },
        ],
      });
    } else {
      lines.push("Nothing is being transcoded, so the server isn't the bottleneck; check the client's network or Wi-Fi.");
    }
    findings.push(lines.join(" "));
  }
  const recent = (Array.isArray(history) ? history : []).filter((row) => matches(row.UserName, subjects.user) && (matches(row.NowPlayingItemName, subjects.title) || matches(row.SeriesName, subjects.title)));
  if (!live.length) {
    if (recent.length) {
      const transcoded = recent.filter((row) => row.PlayMethod === "Transcode");
      const reasonCounts = {};
      for (const row of transcoded) for (const reason of row.reasons || []) reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
      const top = Object.entries(reasonCounts).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([r]) => REASON_TEXT[r] || r);
      findings.push(
        `Not playing right now. In the last 14 days ${transcoded.length} of ${recent.length} matching plays transcoded${top.length ? `, mostly because ${top.join(", ")}` : ""}.`
      );
    } else {
      findings.push(`No live or recent playback matched${subjects.user ? ` user “${subjects.user}”` : ""}${subjects.title ? ` and title “${subjects.title}”` : ""}.`);
    }
  }
  return { findings, plans };
}

function diagnoseDisk(items, { targetBytes = null, protectFavourites = false } = {}) {
  const rows = (Array.isArray(items) ? items : []).map((row) => ({ ...row, Size: Number(row.Size || 0), times_played: Number(row.times_played || 0) })).filter((row) => row.Size > 0);
  const total = rows.reduce((sum, row) => sum + row.Size, 0);
  const unwatched = rows.filter((row) => row.times_played === 0).sort((a, b) => b.Size - a.Size);
  const largest = [...rows].sort((a, b) => b.Size - a.Size).slice(0, 5);
  const findings = [
    `Libraries hold ${formatBytes(total)} across ${rows.length} sized titles. ${unwatched.length} never played (${formatBytes(unwatched.reduce((s, r) => s + r.Size, 0))}).`,
    `Largest: ${largest.map((r) => `${r.Name} (${formatBytes(r.Size)})`).join(", ") || "none"}.`,
  ];
  const target = targetBytes || 100 * 1024 ** 3;
  const picks = [];
  let freed = 0;
  for (const row of unwatched) {
    if (freed >= target) break;
    picks.push(row);
    freed += row.Size;
  }
  const plans = picks.length
    ? [
        {
          kind: "disk-cleanup",
          title: `Free ${formatBytes(freed)}${targetBytes ? ` of ${formatBytes(targetBytes)} requested` : ""} from never-played titles`,
          steps: [
            ...(protectFavourites ? [{ text: "Skip anything any user has favourited (favourites check runs at execution time)", executable: false }] : []),
            ...picks.map((row) => ({ text: `Delete ${row.Type || "item"} “${row.Name}” (${formatBytes(row.Size)}) via Sonarr/Radarr`, executable: false })),
          ],
        },
      ]
    : [];
  if (targetBytes && freed < targetBytes) findings.push(`Never-played titles only cover ${formatBytes(freed)} of the ${formatBytes(targetBytes)} asked for.`);
  return { findings, plans };
}

function diagnoseDownloads(data, integrations = []) {
  const items = Array.isArray(data?.items) ? data.items : [];
  const findings = [];
  const plans = [];
  const errored = items.filter((d) => d.error || /error|missing|failed/i.test(d.state || ""));
  const stalled = items.filter((d) => /stalled|stuck/i.test(d.state || "") || (/download/i.test(d.state || "") && /^0(\.0)? ?B\/s$|^0$/i.test(String(d.down || "").trim()) && Number(d.progress) < 100));
  const active = items.filter((d) => /download/i.test(d.state || "") && !stalled.includes(d));
  findings.push(`${items.length} item${items.length === 1 ? "" : "s"} in the queue: ${active.length} downloading, ${stalled.length} stalled, ${errored.length} with errors.${data?.syncedAt ? ` Last synced ${new Date(data.syncedAt).toLocaleString("en-GB")}.` : ""}`);
  const clients = Array.isArray(data?.clients) ? data.clients : [];
  const unhealthy = clients.filter((c) => c.error || c.ok === false || c.status === "error");
  if (clients.length) findings.push(`${clients.length} download client${clients.length === 1 ? "" : "s"}${unhealthy.length ? `, ${unhealthy.length} reporting errors (${unhealthy.map((c) => c.name).join(", ")})` : ", all reachable at last sync"}.`);
  const arrs = (Array.isArray(integrations) ? integrations : []).filter((i) => /sonarr|radarr|lidarr|readarr|prowlarr/i.test(i.type || i.id || i.name || ""));
  const arrEnabled = arrs.filter((i) => i.enabled !== false);
  if (arrs.length) findings.push(`${arrEnabled.length} *arr integration${arrEnabled.length === 1 ? "" : "s"} enabled: ${arrEnabled.map((i) => i.name || i.type).join(", ") || "none"}.`);
  for (const d of stalled.slice(0, 5)) {
    plans.push({
      kind: "download-pause",
      title: `Pause stalled download “${d.name}”`,
      steps: [
        { text: `Pause “${d.name}” on ${d.client || "its client"} so it stops holding a slot (undo resumes it)`, executable: true, action: { type: "download.pause", id: d.id, name: d.name } },
        { text: "Blocklist the release and search for another in Sonarr/Radarr", executable: false },
      ],
    });
  }
  for (const d of errored.slice(0, 3)) {
    plans.push({ kind: "download-error", title: `Clear failed download “${d.name}”`, steps: [{ text: `Remove “${d.name}” and trigger a re-grab (${d.error || d.state})`, executable: false }] });
  }
  return { findings, plans };
}

// ---- data access -------------------------------------------------------------------

async function loadSessions() {
  const API = require("./api-loader");
  try {
    return await API.getSessions();
  } catch {
    return [];
  }
}

async function loadRecentPlayback(subjects) {
  const params = [];
  const where = [`a."ActivityDateInserted" > NOW() - INTERVAL '14 days'`];
  if (subjects.user) {
    params.push(`%${subjects.user}%`);
    where.push(`a."UserName" ILIKE $${params.length}`);
  }
  if (subjects.title) {
    params.push(`%${subjects.title}%`);
    where.push(`(a."NowPlayingItemName" ILIKE $${params.length} OR a."SeriesName" ILIKE $${params.length})`);
  }
  const { rows } = await db.query(
    `SELECT a."UserName", a."NowPlayingItemName", a."SeriesName", a."PlayMethod",
            CASE WHEN json_typeof(a."TranscodingInfo"->'TranscodeReasons') = 'array' THEN a."TranscodingInfo"->'TranscodeReasons' ELSE '[]'::json END AS reasons
       FROM jf_playback_activity a WHERE ${where.join(" AND ")} ORDER BY a."ActivityDateInserted" DESC LIMIT 200`,
    params
  );
  return rows;
}

async function loadLibrarySizes() {
  const { rows } = await db.query(
    `SELECT "Id", "Name", "Type", "Size", times_played FROM jf_library_items_with_playcount_playtime
      WHERE COALESCE(archived, false) = false AND "Type" IN ('Movie','Series') AND "Size" IS NOT NULL
      ORDER BY "Size" DESC LIMIT 400`
  );
  return rows;
}

async function loadDownloads() {
  const { getIntegrationData, getIntegrations } = require("./integration-store");
  const [data, integrations] = await Promise.all([getIntegrationData(), getIntegrations().catch(() => [])]);
  return { downloads: data.downloads, integrations: Array.isArray(integrations) ? integrations : Object.values(integrations || {}) };
}

// ---- audit + plans -----------------------------------------------------------------

async function appendAudit(actor, type, details = {}) {
  const settings = await getSettings();
  const current = Array.isArray(settings[AUDIT_KEY]) ? settings[AUDIT_KEY] : [];
  const entry = { id: randomUUID(), type, actor, details, timestamp: new Date().toISOString() };
  await mergeSettings({ [AUDIT_KEY]: [entry, ...current].slice(0, MAX_AUDIT) });
  return entry;
}

async function getAudit(limit = 100) {
  const settings = await getSettings();
  return (Array.isArray(settings[AUDIT_KEY]) ? settings[AUDIT_KEY] : []).slice(0, limit);
}

async function savePlans(plans) {
  const settings = await getSettings();
  const now = Date.now();
  const current = (Array.isArray(settings[PLANS_KEY]) ? settings[PLANS_KEY] : []).filter((p) => now - new Date(p.createdAt).getTime() < PLAN_TTL_MS || p.status === "executed");
  await mergeSettings({ [PLANS_KEY]: [...plans, ...current].slice(0, MAX_PLANS) });
}

async function findPlan(id) {
  const settings = await getSettings();
  return (Array.isArray(settings[PLANS_KEY]) ? settings[PLANS_KEY] : []).find((p) => p.id === id) || null;
}

async function updatePlan(id, patch) {
  const settings = await getSettings();
  const plans = (Array.isArray(settings[PLANS_KEY]) ? settings[PLANS_KEY] : []).map((p) => (p.id === id ? { ...p, ...patch } : p));
  await mergeSettings({ [PLANS_KEY]: plans });
  return plans.find((p) => p.id === id);
}

// ---- public API ----------------------------------------------------------------------

async function ask(question, actor) {
  const routed = routeIntent(question);
  let result = { findings: [], plans: [] };
  if (routed.intent === "playback") {
    const [sessions, history] = await Promise.all([loadSessions(), loadRecentPlayback(routed.subjects).catch(() => [])]);
    result = diagnosePlayback(sessions, history, routed.subjects);
  } else if (routed.intent === "disk") {
    result = diagnoseDisk(await loadLibrarySizes(), routed);
  } else if (routed.intent === "downloads") {
    const { downloads, integrations } = await loadDownloads();
    result = diagnoseDownloads(downloads, integrations);
  } else {
    result.findings.push("I can help with playback/buffering, disk space, and download health. Try one of the examples.");
  }
  const createdAt = new Date().toISOString();
  const plans = result.plans.map((plan) => ({
    ...plan,
    id: randomUUID(),
    question,
    createdAt,
    status: plan.steps.some((s) => s.executable) ? "pending" : "propose-only",
  }));
  if (plans.length) await savePlans(plans);
  await appendAudit(actor, "question", { question, intent: routed.intent, subjects: routed.subjects, findings: result.findings, planIds: plans.map((p) => p.id) });
  return { intent: routed.intent, label: routed.label, subjects: routed.subjects, findings: result.findings, plans };
}

async function runAction(action, undo = false) {
  if (action.type === "download.pause") {
    const { setDownloadPaused } = require("./download-client");
    await setDownloadPaused(action.id, !undo);
    return undo ? `Resumed “${action.name}”` : `Paused “${action.name}”`;
  }
  if (action.type === "session.message") {
    if (undo) return "Messages can't be unsent";
    const API = require("./api-loader");
    await API.sendSessionMessage(action.sessionId, { header: "JellyGlance", text: action.text, timeoutMs: 15000 });
    return "Message sent";
  }
  throw Object.assign(new Error(`Unsupported action ${action.type}`), { statusCode: 400 });
}

async function decide(planId, decision, actor) {
  const plan = await findPlan(planId);
  if (!plan) throw Object.assign(new Error("Plan not found or expired"), { statusCode: 404 });
  if (decision === "cancel") {
    if (plan.status !== "pending" && plan.status !== "propose-only") throw Object.assign(new Error(`Plan is already ${plan.status}`), { statusCode: 409 });
    await appendAudit(actor, "cancel", { planId, title: plan.title });
    return updatePlan(planId, { status: "cancelled", decidedAt: new Date().toISOString(), decidedBy: actor });
  }
  if (decision === "approve") {
    if (plan.status !== "pending") throw Object.assign(new Error(plan.status === "propose-only" ? "This plan is propose-only and can't be executed" : `Plan is already ${plan.status}`), { statusCode: 409 });
    await appendAudit(actor, "approve", { planId, title: plan.title });
    const results = [];
    for (const step of plan.steps) {
      if (!step.executable) {
        results.push({ text: step.text, status: "not executed (propose-only)" });
        continue;
      }
      try {
        results.push({ text: step.text, status: "done", output: await runAction(step.action) });
      } catch (error) {
        results.push({ text: step.text, status: "failed", output: error.message });
      }
    }
    await appendAudit(actor, "execute", { planId, title: plan.title, results });
    return updatePlan(planId, { status: "executed", decidedAt: new Date().toISOString(), decidedBy: actor, results });
  }
  if (decision === "undo") {
    if (plan.status !== "executed") throw Object.assign(new Error("Only executed plans can be undone"), { statusCode: 409 });
    const results = [];
    for (const step of plan.steps.filter((s) => s.executable)) {
      try {
        results.push({ text: step.text, status: "undone", output: await runAction(step.action, true) });
      } catch (error) {
        results.push({ text: step.text, status: "failed", output: error.message });
      }
    }
    await appendAudit(actor, "undo", { planId, title: plan.title, results });
    return updatePlan(planId, { status: "undone", undoResults: results });
  }
  throw Object.assign(new Error("Unknown decision"), { statusCode: 400 });
}

module.exports = { ask, decide, getAudit, routeIntent, parseSubjects, diagnosePlayback, diagnoseDisk, diagnoseDownloads, formatBytes, EXAMPLES };

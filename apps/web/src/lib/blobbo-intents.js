// Blobbo Q&A: keyword -> existing read-only endpoint -> template answer.
// Answers only use fields returned by the server. No writes, no guessing.
import axios from "./axios_instance";

const n = (v) => (v === undefined || v === null || v === "" ? null : Number(v));
const fmt = (v) => (n(v) === null || Number.isNaN(n(v)) ? null : n(v).toLocaleString());
const list = (rows, pick, max = 5) => (Array.isArray(rows) ? rows : []).slice(0, max).map(pick).filter(Boolean);
const join = (parts) => parts.filter(Boolean).join(" · ");
const get = (url, params) => axios.get(url, { params }).then((r) => r.data);
const post = (url, body) => axios.post(url, body).then((r) => r.data);

const sessionTitle = (s) => {
  const item = s?.NowPlayingItem;
  if (!item) return null;
  const title = item.SeriesName ? `${item.SeriesName} – ${item.Name}` : item.Name;
  const method = s.PlayState?.PlayMethod ? ` (${s.PlayState.PlayMethod.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase()})` : "";
  return `${s.UserName || "Someone"}: ${title}${method}`;
};

export const INTENTS = [
  {
    id: "sessions",
    chip: "Who's watching now?",
    keywords: ["watching", "now playing", "playing", "stream", "session", "transcod", "live"],
    link: { to: "/", label: "Go to Home" },
    async answer() {
      const data = await get("/proxy/getSessions");
      const active = (Array.isArray(data) ? data : []).filter((s) => s?.NowPlayingItem);
      if (!active.length) return "Nobody is watching right now. The stage is all yours.";
      const lines = list(active, sessionTitle, 6);
      return { text: `${active.length} ${active.length === 1 ? "stream" : "streams"} right now:`, lines };
    },
  },
  {
    id: "devices",
    chip: "Which devices are streaming?",
    keywords: ["device", "client app", "which app", "tv", "phone"],
    link: { to: "/", label: "Go to Home" },
    async answer() {
      const data = await get("/proxy/getSessions");
      const active = (Array.isArray(data) ? data : []).filter((s) => s?.NowPlayingItem);
      if (!active.length) return "No devices are streaming right now.";
      return { text: "Streaming from:", lines: list(active, (s) => join([s.UserName, s.Client, s.DeviceName]), 8) };
    },
  },
  {
    id: "today",
    chip: "How busy was today?",
    keywords: ["today", "busy", "24h", "24 hours", "viewers"],
    link: { to: "/activity", label: "Open Activity" },
    async answer() {
      const d = await get("/api/widgets/sessions");
      return join([
        fmt(d.recent) !== null && `${fmt(d.recent)} active now`,
        fmt(d.today) !== null && `${fmt(d.today)} plays today`,
        fmt(d.last24h) !== null && `${fmt(d.last24h)} in the last 24h`,
        fmt(d.viewersToday) !== null && `${fmt(d.viewersToday)} viewers today`,
      ]) || "I couldn't find today's playback numbers.";
    },
  },
  {
    id: "libraries",
    chip: "How are my libraries?",
    keywords: ["librar", "collection", "how many movies", "how many shows", "episodes", "catalog"],
    link: { to: "/libraries", label: "Open Libraries" },
    async answer() {
      const [libs, home] = await Promise.all([get("/api/getLibraries"), get("/api/widgets/homepage").catch(() => null)]);
      const rows = Array.isArray(libs) ? libs : [];
      const head = join([
        `${rows.length} ${rows.length === 1 ? "library" : "libraries"}`,
        home && fmt(home.movies) && `${fmt(home.movies)} movies`,
        home && fmt(home.shows) && `${fmt(home.shows)} shows`,
        home && fmt(home.episodes) && `${fmt(home.episodes)} episodes`,
      ]);
      return { text: head, lines: list(rows, (l) => join([l.Name, l.CollectionType]), 10) };
    },
  },
  {
    id: "storage",
    chip: "How much disk is used?",
    keywords: ["disk", "storage", "space", "size", "terabyte", "tb", "gb", "drive"],
    link: { to: "/libraries", label: "Open Libraries" },
    async answer() {
      const d = await get("/api/library-storage");
      const rows = (d.libraries || []).slice().sort((a, b) => (b.bytes || 0) - (a.bytes || 0));
      return {
        text: `Your media takes up ${d.totalLabel || "an unknown amount"} across ${rows.length} libraries.`,
        lines: [
          ...list(rows, (l) => `${l.name}: ${l.size} (${fmt(l.items) ?? "?"} items)`, 6),
          d.upcomingCount ? `About ${d.upcomingEstimate} more for ${fmt(d.upcomingCount)} upcoming releases.` : null,
        ].filter(Boolean),
        note: "This is what your libraries use. Free disk space isn't reported yet.",
      };
    },
  },
  {
    id: "recent",
    chip: "What's new?",
    keywords: ["new", "recent", "added", "latest", "arriv", "fresh"],
    link: { to: "/recently-added", label: "See what is new" },
    async answer() {
      const [rows, home] = await Promise.all([get("/api/getRecentlyAdded", { limit: 6 }), get("/api/widgets/homepage").catch(() => null)]);
      const items = list(rows, (i) => (i.SeriesName ? `${i.SeriesName} – ${i.Name}` : i.Name), 6);
      if (!items.length) return "Nothing new has landed lately.";
      return { text: home && fmt(home.addedWeek) !== null ? `${fmt(home.addedWeek)} added this week. Newest:` : "Newest arrivals:", lines: items };
    },
  },
  {
    id: "users",
    chip: "Top users this month?",
    keywords: ["top user", "active user", "most active", "who watches", "users", "people", "leaderboard"],
    link: { to: "/users", label: "Open Users" },
    async answer() {
      const rows = await post("/stats/getMostActiveUsers", { days: 30 });
      const items = list(rows, (r) => `${r.Name}: ${fmt(r.Plays)} plays`);
      return items.length ? { text: "Most active in the last 30 days:", lines: items } : "No activity in the last 30 days.";
    },
  },
  {
    id: "topLibraries",
    chip: "Most watched library?",
    keywords: ["most watched librar", "most viewed librar", "popular librar", "top librar"],
    link: { to: "/statistics", label: "Open Statistics" },
    async answer() {
      const rows = await post("/stats/getMostViewedLibraries", { days: 30 });
      const items = list(rows, (r) => `${r.Name}: ${fmt(r.Plays)} plays`);
      return items.length ? { text: "Most watched libraries (30 days):", lines: items } : "No library plays in the last 30 days.";
    },
  },
  {
    id: "topContent",
    chip: "Most watched movies?",
    keywords: ["most watched", "most viewed", "popular", "top movie", "top show", "top film", "top series", "top song", "top music"],
    link: { to: "/statistics", label: "Open Statistics" },
    async answer(q) {
      const type = /show|series|tv|episode/.test(q) ? "Series" : /music|song|audio|album/.test(q) ? "Audio" : "Movie";
      const rows = await post("/stats/getMostViewedByType", { days: 30, type });
      const items = list(rows, (r) => `${r.Name}: ${fmt(r.Plays)} plays`);
      const label = { Movie: "movies", Series: "shows", Audio: "music" }[type];
      return items.length ? { text: `Most watched ${label} (30 days):`, lines: items } : `No ${label} plays in the last 30 days.`;
    },
  },
  {
    id: "clients",
    chip: "Which apps are used most?",
    keywords: ["client", "app used", "apps", "most used"],
    link: { to: "/statistics", label: "Open Statistics" },
    async answer() {
      const rows = await post("/stats/getMostUsedClient", { days: 30 });
      const items = list(rows, (r) => `${r.Client || r.Name}: ${fmt(r.Plays ?? r.Count)} plays`);
      return items.length ? { text: "Most used apps (30 days):", lines: items } : "No client data for the last 30 days.";
    },
  },
  {
    id: "playMethod",
    chip: "Direct play or transcode?",
    keywords: ["direct play", "play method", "transcode", "direct stream", "playback method"],
    link: { to: "/statistics", label: "Open Statistics" },
    async answer() {
      const rows = await post("/stats/getPlaybackMethodStats", { days: 30 });
      const data = Array.isArray(rows) ? rows : [];
      const total = data.reduce((s, r) => s + Number(r.Count || 0), 0);
      if (!total) return "No playback in the last 30 days.";
      return { text: "Playback methods (30 days):", lines: data.map((r) => `${r.Name}: ${Math.round((Number(r.Count) / total) * 100)}% (${fmt(r.Count)})`) };
    },
  },
  {
    id: "history",
    chip: "What was watched lately?",
    keywords: ["history", "watched", "last played", "lately", "recently watched", "activity"],
    link: { to: "/activity", label: "Open Activity" },
    async answer() {
      const d = await get("/api/getHistory", { size: 6, page: 1 });
      const items = list(d?.results, (r) => join([r.UserName, r.SeriesName ? `${r.SeriesName} – ${r.NowPlayingItemName}` : r.NowPlayingItemName]), 6);
      return items.length ? { text: "Latest plays:", lines: items } : "No playback history yet.";
    },
  },
  {
    id: "health",
    chip: "Is the server healthy?",
    keywords: ["health", "healthy", "ok", "problem", "issue", "broken", "status", "working", "backup", "webhook"],
    link: { to: "/settings/health", label: "Open Health" },
    async answer() {
      const [h, jf] = await Promise.all([get("/api/health"), get("/api/jellyfin/status").catch(() => null)]);
      const lines = [
        jf && `${jf.name || "Media server"}${jf.version ? ` ${jf.version}` : ""}: ${jf.ok ? "reachable" : `not reachable${jf.error ? ` (${jf.error})` : ""}`}`,
        ...list(h.checks, (c) => `${c.ok ? "✓" : "✗"} ${c.label}: ${c.message}`, 10),
      ].filter(Boolean);
      return { text: h.ok ? "All checks look good." : "Some checks need a look:", lines };
    },
  },
  {
    id: "automation",
    chip: "Are my integrations OK?",
    keywords: ["integration", "automation", "prowlarr", "bazarr", "sonarr", "radarr", "indexer"],
    link: { to: "/automation-health", label: "Open Automation health" },
    async answer() {
      const d = await get("/api/automation-health");
      const services = d.services || d.items || [];
      const issues = d.issues || [];
      return {
        text: join([fmt(d.stats?.services ?? services.length) !== null && `${fmt(d.stats?.services ?? services.length)} services checked`, `${issues.length} issues`]),
        lines: [...list(services, (s) => `${s.ok ? "✓" : "✗"} ${s.name}`, 8), ...list(issues, (i) => `${i.source}: ${i.message}`, 4)],
      };
    },
  },
  {
    id: "downloads",
    chip: "Any downloads stuck?",
    keywords: ["download", "queue", "stuck", "stalled", "grab", "torrent"],
    link: { to: "/downloads", label: "Open Downloads" },
    async answer() {
      const d = await get("/api/widgets/downloads");
      return {
        text: `${fmt(d.active) ?? 0} active, ${fmt(d.stalled) ?? 0} stalled, ${fmt(d.total) ?? 0} total.`,
        lines: list(d.items, (i) => join([i.name || i.title, i.progress !== undefined && `${Math.round(i.progress)}%`]), 5),
      };
    },
  },
  {
    id: "requests",
    chip: "Any pending requests?",
    keywords: ["request", "seerr", "overseerr", "jellyseerr", "pending"],
    link: { to: "/requests", label: "Open Requests" },
    async answer() {
      const d = await get("/api/widgets/requests");
      const counts = Object.entries(d).filter(([k, v]) => typeof v === "number" && k !== "updatedAt").map(([k, v]) => `${v} ${k}`);
      return { text: counts.length ? counts.join(" · ") : "Request counts:", lines: list(d.items, (r) => join([r.title, r.status, r.requestedBy]), 5) };
    },
  },
  {
    id: "calendar",
    chip: "What's coming up?",
    keywords: ["upcoming", "calendar", "coming", "release", "schedule", "airing"],
    link: { to: "/calendar", label: "Open Calendar" },
    async answer() {
      const d = await get("/api/widgets/calendar");
      return {
        text: `${fmt(d.upcoming) ?? 0} upcoming, ${fmt(d.today) ?? 0} today${d.estimate ? ` (about ${d.estimate})` : ""}.`,
        lines: list(d.items, (i) => join([i.title || i.name, i.date && new Date(i.date).toLocaleDateString()]), 5),
      };
    },
  },
  {
    id: "version",
    chip: "Am I up to date?",
    keywords: ["version", "update", "upgrade", "release notes", "up to date"],
    link: { to: "/settings", label: "Open Settings" },
    async answer() {
      const d = await get("/api/CheckForUpdates");
      return join([d.current_version && `You're on ${d.current_version}`, d.latest_version && d.latest_version !== "N/A" && `latest is ${d.latest_version}`]) + (d.message ? `. ${d.message}.` : ".");
    },
  },
  {
    id: "digest",
    chip: "How's my server?",
    keywords: ["summary", "overview", "dashboard", "how is", "how's", "digest", "everything"],
    link: { to: "/", label: "Go to Home" },
    async answer() {
      const d = await get("/api/widgets/homepage");
      return {
        text: d.jellyfinName ? `${d.jellyfinName}${d.jellyfinVersion ? ` ${d.jellyfinVersion}` : ""} is ${d.jellyfinOk ? "up" : "not checking in"}.` : "Here's the snapshot:",
        lines: [
          fmt(d.sessionsRecent) !== null && `${fmt(d.sessionsRecent)} streams now, ${fmt(d.sessionsToday) ?? 0} plays today`,
          fmt(d.libraries) !== null && `${fmt(d.libraries)} libraries · ${fmt(d.movies) ?? 0} movies · ${fmt(d.shows) ?? 0} shows`,
          fmt(d.addedWeek) !== null && `${fmt(d.addedWeek)} added this week`,
          d.storage && `${d.storage} of media`,
          fmt(d.downloadTotal) && `${fmt(d.downloads)} downloading, ${fmt(d.stalled) ?? 0} stalled`,
          fmt(d.calendarUpcoming) && `${fmt(d.calendarUpcoming)} upcoming releases`,
        ].filter(Boolean),
      };
    },
  },
];

export const STARTER_CHIPS = INTENTS.map((i) => ({ id: i.id, label: i.chip }));

export function matchIntent(question) {
  const q = String(question || "").toLowerCase();
  let best = null;
  let bestScore = 0;
  for (const intent of INTENTS) {
    const score = intent.keywords.reduce((s, k) => (q.includes(k) ? s + k.length : s), 0);
    if (score > bestScore) {
      best = intent;
      bestScore = score;
    }
  }
  return best;
}

export function helpReply() {
  return {
    text: "I'm only a small jellyfish, but I can tell you about:",
    lines: ["What's playing and on which devices", "Libraries, storage and what's new", "Top users, shows, apps and playback methods", "Health, integrations, downloads, requests and updates"],
  };
}

export async function askBlobbo(question, intentId) {
  const intent = intentId ? INTENTS.find((i) => i.id === intentId) : matchIntent(question);
  if (!intent) return { ...helpReply(), chips: true };
  try {
    const result = await intent.answer(String(question || "").toLowerCase());
    const reply = typeof result === "string" ? { text: result } : result;
    return { ...reply, link: intent.link };
  } catch (error) {
    const status = error?.response?.status;
    if (status === 401 || status === 403) return { text: "That one needs admin access, so I can't peek at it for you." };
    return { text: "I couldn't reach that part of the server just now. Try again in a moment." };
  }
}

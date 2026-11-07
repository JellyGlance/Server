// More Blobbo topics for the expanded 1.4.2-beta.2 cut. Same rules as the core
// intents: existing read-only endpoints only, template answers, no guessing.
// Helpers are passed in by blobbo-intents.js to avoid a circular import.

const DAY = 86400000;
const ago = (date) => {
  const t = new Date(date).getTime();
  if (!t) return null;
  const days = Math.floor((Date.now() - t) / DAY);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 60) return `${days} days ago`;
  return `${Math.round(days / 30)} months ago`;
};
const titleOf = (r) => (r.SeriesName ? `${r.SeriesName} – ${r.NowPlayingItemName || r.Name}` : r.NowPlayingItemName || r.Name);

// Plain-English meanings for download client states.
const DOWNLOAD_STATES = [
  [/missing ?files?/i, "the files were moved or deleted outside the download client"],
  [/error|fail/i, "the client hit an error, often a full disk, a permissions problem or a bad release"],
  [/stalled/i, "there are no peers or servers sending data, so it is waiting"],
  [/paused|stopped/i, "it has been paused, so it won't move until it is resumed"],
  [/queued|waiting/i, "it is waiting its turn behind other downloads"],
  [/meta|fetching/i, "it is still fetching details about the release"],
  [/check|verif|repair|extract/i, "the client is checking, repairing or unpacking the files"],
];
export const explainDownloadState = (state, stalled) => {
  const hit = DOWNLOAD_STATES.find(([re]) => re.test(String(state || "")));
  if (hit) return hit[1];
  return stalled ? "it hasn't moved for a while, so it is probably waiting on peers or a server" : null;
};

// Plain-English meanings for Jellyfin transcode reasons.
const REASONS = {
  ContainerNotSupported: "the app can't open this file type",
  VideoCodecNotSupported: "the app can't play this video format",
  AudioCodecNotSupported: "the app can't play this audio format",
  SubtitleCodecNotSupported: "the subtitles have to be burned in",
  ContainerBitrateExceedsLimit: "the file is bigger than the app's quality limit",
  VideoBitrateNotSupported: "the video bitrate is above the app's limit",
  AudioChannelsNotSupported: "the app can't handle this many audio channels",
  VideoResolutionNotSupported: "the resolution is too high for the app",
  VideoLevelNotSupported: "the video profile level is too high for the app",
  VideoRangeTypeNotSupported: "HDR has to be converted for this screen",
  DirectPlayError: "direct play failed, so the server stepped in",
};
export const explainReason = (r) => REASONS[r] || String(r).replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();

// What each page is for, matched on the start of the current route.
export const PAGE_GUIDE = [
  ["/settings/health", "Health runs checks on JellyGlance, Jellyfin, backups and webhooks, and shows what needs a look."],
  ["/settings", "Settings is where you change themes, notifications, integrations, users and what JellyGlance shows."],
  ["/libraries/item", "This is a title's page: details, who has watched it, play history and links to open it in Jellyfin."],
  ["/libraries", "Libraries lists every library on your server with counts, sizes and recent additions."],
  ["/recently-added", "Recently added shows the newest films, shows and episodes as they land."],
  ["/activity", "Activity is the full playback log: who watched what, when, on which device and how it played."],
  ["/statistics", "Statistics charts plays over time, by hour, by library, by app and by play method."],
  ["/users", "Users lists everyone on the server with their last activity, plays and watch time."],
  ["/downloads", "Downloads shows your download clients' queues, progress and anything stalled."],
  ["/requests", "Requests shows what people have asked for through Seerr and where each request is up to."],
  ["/calendar", "Calendar shows upcoming episodes and films from your Sonarr and Radarr."],
  ["/integrations", "3rd party apps is where you connect Wizarr, Tdarr, Maintainerr and friends."],
  ["/automation-health", "Automation health checks your *arr apps, indexers and other integrations."],
  ["/me", "My Glance is your personal page: your history, stats, up next, badges and picks for you."],
  ["/insights", "Insights digs deeper: library health, duplicates, stream and transcode trends, and more."],
  ["/server-management", "Server management shows Jellyfin's scheduled tasks, devices and plugins."],
  ["/active-transcodes", "Active transcodes shows every stream the server is converting right now, and why."],
  ["/timeline", "Timeline lays out viewing activity over time, person by person."],
  ["/", "Home is the dashboard: live sessions, today's numbers and widgets for everything at a glance."],
];
export function explainPath(path) {
  const p = String(path || "/");
  const hit = PAGE_GUIDE.find(([prefix]) => (prefix === "/" ? p === "/" : p === prefix || p.startsWith(`${prefix}/`)));
  return hit ? hit[1] : null;
}

export function buildMoreIntents({ get, post, fmt, list, join, withLinks, jellyfinBase }) {
  return [
    {
      id: "explainPage",
      chip: "Explain this page",
      keywords: ["explain this page", "explain the page", "this page", "what is this page", "whats this page", "where am i", "what am i looking at", "what does this page do", "explain"],
      async answer(q, { path } = {}) {
        const text = explainPath(path);
        return text ? { text, note: `You're on ${path || "/"}.` } : "I don't know this page well yet. Try Home or Settings and I'll explain those.";
      },
    },
    {
      id: "sinceYesterday",
      chip: "What changed since yesterday?",
      keywords: ["since yesterday", "what changed", "whats changed", "changes", "what happened", "overnight", "last night", "since last time", "catch me up", "catch up"],
      link: { to: "/activity", label: "Open Activity" },
      async answer() {
        const since = Date.now() - DAY;
        const [added, hist, health] = await Promise.all([
          get("/api/getRecentlyAdded", { limit: 40 }).catch(() => []),
          get("/api/getHistory", { size: 100, page: 1 }).catch(() => null),
          get("/api/health").catch(() => null),
        ]);
        const fresh = (Array.isArray(added) ? added : []).filter((i) => new Date(i.DateCreated).getTime() > since);
        const plays = (hist?.results || []).filter((r) => new Date(r.ActivityDateInserted).getTime() > since);
        const viewers = new Set(plays.map((r) => r.UserName).filter(Boolean));
        return {
          text: "In the last 24 hours:",
          lines: [
            `${fresh.length} new ${fresh.length === 1 ? "item" : "items"} added${fresh.length ? `, including ${fresh.slice(0, 3).map(titleOf).join(", ")}` : ""}`,
            `${plays.length}${plays.length >= 100 ? "+" : ""} plays by ${viewers.size} ${viewers.size === 1 ? "person" : "people"}`,
            health && (health.ok ? "All health checks are passing" : `${(health.checks || []).filter((c) => !c.ok).length} health checks need a look`),
          ].filter(Boolean),
        };
      },
    },
    {
      id: "weekend",
      chip: "Weekend digest",
      keywords: ["weekend", "weekend digest", "saturday", "sunday", "over the weekend", "this weekend", "last weekend"],
      link: { to: "/activity", label: "Open Activity" },
      async answer() {
        const now = new Date();
        const start = new Date(now);
        const back = now.getDay() === 6 ? 0 : now.getDay() === 0 ? 1 : now.getDay() + 1;
        start.setDate(now.getDate() - back);
        start.setHours(0, 0, 0, 0);
        const end = new Date(start.getTime() + 2 * DAY);
        const hist = await get("/api/getHistory", { size: 300, page: 1 });
        const plays = (hist?.results || []).filter((r) => {
          const t = new Date(r.ActivityDateInserted).getTime();
          return t >= start.getTime() && t < end.getTime();
        });
        if (!plays.length) return "Nothing was played over the weekend. A quiet one!";
        const tally = new Map();
        plays.forEach((r) => {
          const k = r.SeriesName || r.NowPlayingItemName;
          if (k) tally.set(k, (tally.get(k) || 0) + 1);
        });
        const top = [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
        const viewers = new Set(plays.map((r) => r.UserName).filter(Boolean));
        return {
          text: `Weekend of ${start.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}: ${plays.length}${plays.length >= 300 ? "+" : ""} plays by ${viewers.size} ${viewers.size === 1 ? "person" : "people"}.`,
          lines: top.map(([name, c]) => `${name}: ${c} ${c === 1 ? "play" : "plays"}`),
        };
      },
    },
    {
      id: "offline",
      chip: "Who's been offline?",
      keywords: ["offline users", "been offline", "who hasnt", "who has not", "inactive", "not been on", "not watched", "been away", "absent", "dormant", "lapsed", "who is missing", "havent watched"],
      link: { to: "/users", label: "Open Users" },
      async answer() {
        const rows = await get("/stats/getAllUserActivity");
        const cutoff = Date.now() - 14 * DAY;
        const quiet = (Array.isArray(rows) ? rows : [])
          .filter((u) => !u.LastActivityDate || new Date(u.LastActivityDate).getTime() < cutoff)
          .sort((a, b) => new Date(a.LastActivityDate || 0) - new Date(b.LastActivityDate || 0));
        if (!quiet.length) return "Everyone has watched something in the last two weeks.";
        return { text: `${quiet.length} ${quiet.length === 1 ? "person hasn't" : "people haven't"} watched anything for 14 days or more:`, lines: list(quiet, (u) => `${u.UserName || u.Name}: ${u.LastActivityDate ? `last seen ${ago(u.LastActivityDate)}` : "never watched"}`, 8) };
      },
    },
    {
      id: "recommend",
      chip: "Recommend something",
      keywords: ["recommend*", "suggest*", "what should i watch", "something to watch", "anything good", "bored", "pick something", "what to watch", "watch tonight", "movie night", "film night"],
      link: { to: "/recently-added", label: "See what is new" },
      async answer() {
        const [rows, base] = await Promise.all([get("/api/getRecentlyAdded", { limit: 30 }), jellyfinBase()]);
        const picks = (Array.isArray(rows) ? rows : []).filter((i) => i.Type === "Movie" || i.Type === "Series" || (!i.SeriesName && i.Type !== "Episode")).slice(0, 3);
        if (!picks.length) return "Nothing new to suggest just yet. Ask me again when something lands.";
        return { text: "Fresh on your server and worth a look:", lines: picks.map((i) => withLinks(join([i.Name, i.Type === "Series" ? "Series" : "Film"]), i.Id, base)), note: "Picked from what was added most recently." };
      },
    },
    {
      id: "mood",
      chip: "How are you feeling?",
      keywords: ["mood", "how are you", "how do you feel", "feeling", "are you ok", "are you happy", "you alright"],
      link: { to: "/settings/health", label: "Open Health" },
      async answer() {
        const h = await get("/api/health");
        const bad = (h.checks || []).filter((c) => !c.ok);
        if (h.ok) return { text: "I'm feeling bouncy! Every health check is passing.", mood: "happy" };
        return { text: `I'm a bit wobbly. ${bad.length} ${bad.length === 1 ? "check needs" : "checks need"} a look:`, lines: list(bad, (c) => `${c.label}: ${c.message}`, 5), mood: "worried" };
      },
    },
    {
      id: "duplicates",
      chip: "Any duplicate films?",
      keywords: ["duplicate*", "dupe*", "dupes", "copies", "twice", "same film twice", "double up*", "doubled"],
      link: { to: "/insights", label: "Open Library health" },
      async answer() {
        const d = await get("/insights-data/library-health");
        const dups = d.duplicates || [];
        if (!dups.length) return "No duplicate films found. Tidy!";
        return { text: `${dups.length} ${dups.length === 1 ? "film has" : "films have"} more than one copy:`, lines: list(dups, (r) => `${r.name}${r.year ? ` (${r.year})` : ""}: ${r.copies} copies`, 8) };
      },
    },
    {
      id: "missingEpisodes",
      chip: "Missing episodes?",
      keywords: ["missing episode*", "missing", "gaps", "gap", "incomplete", "episodes missing", "empty series", "empty shows"],
      link: { to: "/libraries", label: "Open Libraries" },
      async answer() {
        const d = await get("/stats/getHomeDashboard");
        const empty = Number(d?.libraryIssues?.missingEpisodeSeries || 0);
        return {
          text: empty ? `${empty} ${empty === 1 ? "series has" : "series have"} no episodes on disk at all.` : "Every series has at least one episode on disk.",
          note: "Finding gaps inside a season (say, episode 4 of 10 missing) needs a new server check. That part is coming in a later beta.",
        };
      },
    },
    {
      id: "heatmap",
      chip: "Transcode heat map",
      keywords: ["heat map", "heatmap", "transcode heat", "transcodes per day", "transcoding trend", "transcode chart", "how much transcoding"],
      link: { to: "/insights", label: "Open Stream insights" },
      async answer() {
        const d = await get("/insights-data/streams", { days: 28 });
        const days = (d.daily || []).slice(-28);
        if (!days.length) return "No plays in the last four weeks, so there's nothing to map.";
        const rate = Math.round((d.summary?.transcodeRate || 0) * 100);
        return {
          text: `${rate}% of plays transcoded in the last 28 days. Darker squares mean more transcodes that day:`,
          viz: { type: "heat", cells: days.map((r) => ({ label: `${new Date(r.day).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}: ${r.transcodes} of ${r.plays} plays transcoded`, value: Number(r.transcodes || 0) })) },
        };
      },
    },
    {
      id: "tasks",
      chip: "Scheduled tasks status",
      keywords: ["scheduled task*", "task*", "task status", "library scan*", "scan*", "jobs", "cron", "running tasks"],
      link: { to: "/server-management", label: "Open Server management" },
      async answer() {
        const d = await get("/api/server-management/status");
        const tasks = d.jellyfinTasks || [];
        if (!tasks.length) return "I couldn't see any Jellyfin scheduled tasks.";
        const running = tasks.filter((t) => t.state && t.state !== "Idle");
        const failed = tasks.filter((t) => t.lastExecutionResult?.Status && t.lastExecutionResult.Status !== "Completed");
        return {
          text: `${tasks.length} scheduled tasks · ${running.length} running · ${failed.length} didn't finish cleanly last time.`,
          lines: [
            ...list(running, (t) => `▶ ${t.name}: ${t.state}`, 4),
            ...list(failed, (t) => `✗ ${t.name}: ${t.lastExecutionResult.Status}${t.lastExecutionResult.EndTimeUtc ? ` (${ago(t.lastExecutionResult.EndTimeUtc)})` : ""}`, 5),
          ],
        };
      },
    },
    {
      id: "failedDownloads",
      chip: "Why did a download fail?",
      keywords: ["failed download*", "download failed", "download fail*", "download error*", "why did * fail", "explain download*", "download problem*", "why is my download"],
      link: { to: "/downloads", label: "Open Downloads" },
      async answer() {
        const d = await get("/api/widgets/downloads");
        const items = (d.items || []).map((i) => ({ ...i, why: explainDownloadState(i.state, i.stalled) })).filter((i) => i.why);
        if (!items.length) return `Nothing looks stuck or failed right now. ${fmt(d.active) ?? 0} active downloads.`;
        return { text: "Here's what's holding things up:", lines: list(items, (i) => `${i.name}: ${i.state ? `${i.state} – ` : ""}${i.why}`, 6) };
      },
    },
    {
      id: "remote",
      chip: "Remote access OK?",
      keywords: ["remote access", "remote", "outside", "away from home", "external url", "external", "reverse proxy", "from outside", "access from anywhere", "public url"],
      link: { to: "/settings", label: "Open Settings" },
      async answer() {
        const [base, jf] = await Promise.all([jellyfinBase(), get("/api/jellyfin/status").catch(() => null)]);
        const https = base && /^https:/i.test(base);
        return {
          text: base ? `People outside your home are sent to ${base}.` : "No external address is set, so Open in Jellyfin links and remote viewers use the local address.",
          lines: [
            jf && `${jf.name || "Jellyfin"} answers JellyGlance: ${jf.ok ? "yes" : "no"}`,
            base && (https ? "✓ Uses HTTPS" : "✗ Not using HTTPS, so logins travel unencrypted"),
          ].filter(Boolean),
          note: "Testing the address from outside your network needs a new server check. That's coming in a later beta.",
        };
      },
    },
    {
      id: "newDevices",
      chip: "Any new devices?",
      keywords: ["new device*", "device joined", "devices joined", "unknown device*", "new login*", "new app*", "who logged in", "strange device*"],
      link: { to: "/settings", label: "Open Settings" },
      async answer() {
        const d = await get("/api/jellyfin/devices");
        const week = Date.now() - 7 * DAY;
        const fresh = d.newDevices?.length ? d.newDevices : [];
        const recent = (d.devices || []).filter((x) => new Date(x.dateLastActivity).getTime() > week);
        return {
          text: fresh.length ? `${fresh.length} new ${fresh.length === 1 ? "device has" : "devices have"} joined since I last looked:` : `No new devices since I last looked. ${recent.length} active in the last week:`,
          lines: list(fresh.length ? fresh : recent, (x) => join([x.name, x.appName, x.lastUserName, x.dateLastActivity && ago(x.dateLastActivity)]), 6),
        };
      },
    },
    {
      id: "storagePie",
      chip: "Storage per library",
      keywords: ["storage pie", "pie", "pie chart", "storage chart", "breakdown", "per library", "storage per library", "storage by library"],
      link: { to: "/libraries", label: "Open Libraries" },
      async answer() {
        const d = await get("/api/library-storage");
        const rows = (d.libraries || []).filter((l) => Number(l.bytes) > 0).sort((a, b) => b.bytes - a.bytes);
        if (!rows.length) return "I couldn't read library sizes yet.";
        const top = rows.slice(0, 5);
        const rest = rows.slice(5).reduce((s, l) => s + Number(l.bytes), 0);
        const slices = [...top.map((l) => ({ label: `${l.name} · ${l.size}`, value: Number(l.bytes) })), ...(rest ? [{ label: "Everything else", value: rest }] : [])];
        return { text: `${d.totalLabel || "Your media"} across ${rows.length} libraries:`, viz: { type: "pie", slices } };
      },
    },
    {
      id: "buffering",
      chip: "Why is this buffering?",
      keywords: ["buffering", "buffer*", "stutter*", "lag*", "laggy", "slow", "freez*", "choppy", "spinning", "keeps stopping", "why is it buffering"],
      link: { to: "/insights", label: "Open Stream insights" },
      async answer() {
        const [sessions, streams] = await Promise.all([get("/proxy/getSessions").catch(() => []), get("/insights-data/streams", { days: 7 }).catch(() => null)]);
        const active = (Array.isArray(sessions) ? sessions : []).filter((s) => s?.NowPlayingItem);
        const tx = active.filter((s) => s.TranscodingInfo || /transcode/i.test(s.PlayState?.PlayMethod || ""));
        const lines = tx.map((s) => {
          const reasons = s.TranscodingInfo?.TranscodeReasons || [];
          return `${s.UserName}: transcoding${reasons.length ? ` because ${reasons.map(explainReason).join(", ")}` : ""}${s.TranscodingInfo?.Framerate ? ` at ${Math.round(s.TranscodingInfo.Framerate)} fps` : ""}`;
        });
        const top = (streams?.reasons || []).slice(0, 3).map((r) => `This week: ${explainReason(r.name)} (${r.plays} plays)`);
        return {
          text: active.length
            ? `${active.length} playing, ${tx.length} transcoding. Transcoding is the usual cause of buffering:`
            : "Nothing is playing right now. The most common transcode causes this week were:",
          lines: [...lines, ...top],
          note: tx.length ? "Lowering the app's quality setting, or using an app that plays the file directly, usually fixes it." : undefined,
        };
      },
    },
    {
      id: "trending",
      chip: "What's trending?",
      keywords: ["trending", "whats trending", "hot", "whats hot", "popular this week", "buzz", "everyone watching", "what is everyone watching"],
      link: { to: "/statistics", label: "Open Statistics" },
      async answer() {
        const [films, shows, base] = await Promise.all([post("/stats/getMostViewedByType", { days: 7, type: "Movie" }), post("/stats/getMostViewedByType", { days: 7, type: "Series" }), jellyfinBase()]);
        const rows = [...(films || []).slice(0, 3), ...(shows || []).slice(0, 3)].sort((a, b) => b.Plays - a.Plays);
        if (!rows.length) return "Nothing has been played this week yet.";
        return { text: "Trending on your server this week:", lines: rows.map((r) => withLinks(`${r.Name}: ${fmt(r.Plays)} plays`, r.Id, base)) };
      },
    },
    {
      id: "similar",
      chip: "Find something similar",
      keywords: ["similar", "like this", "more like", "find similar", "something like", "same as", "because i watched", "similar to"],
      link: { to: "/me", label: "Open My Glance" },
      async answer() {
        const [d, base] = await Promise.all([get("/insights-data/for-you"), jellyfinBase()]);
        const picks = d.picks || [];
        if (!picks.length) return "I need a bit more watch history before I can find similar titles for you.";
        return {
          text: d.topGenres?.length ? `You lean towards ${d.topGenres.slice(0, 3).map((g) => g.name).join(", ")}. Unwatched titles that match:` : "Unwatched titles that match your taste:",
          lines: list(picks, (p) => withLinks(join([p.name, p.year, p.rating && `★ ${p.rating}`]), p.id, base), 5),
        };
      },
    },
    {
      id: "achievements",
      chip: "My achievement badges",
      keywords: ["achievement*", "badge*", "trophy", "trophies", "goals", "my progress", "level", "unlocked"],
      link: { to: "/me", label: "Open My Glance" },
      async answer() {
        const d = await get("/insights-data/achievements");
        if (d.empty || !d.badges) return "Badges need a signed-in Jellyfin user.";
        const earned = d.badges.filter((b) => b.tier);
        return { text: `${d.earned} of ${d.total} badges earned in ${d.year}.`, lines: list(earned.length ? earned : d.badges, (b) => `${b.tier ? "🏅" : "○"} ${b.name}${b.tier ? ` (${b.tier})` : ""}: ${fmt(b.value)} ${b.unit || ""}`.trim(), 6) };
      },
    },
    // Local helpers: handled in the chat itself, no server calls.
    { id: "tour", chip: "Show me around", keywords: ["tour", "show me around", "guide me", "walkthrough", "walk through", "new here", "getting started", "first time"], local: true, async answer() { return { action: "tour" }; } },
    { id: "quiz", chip: "Quick setup quiz", keywords: ["quiz", "onboarding", "set me up", "personalise", "personalize"], local: true, async answer() { return { action: "quiz" }; } },
    { id: "options", chip: "Blobbo options", keywords: ["kids", "kids safe", "child*", "family mode", "voice", "read aloud", "speak", "talk to me", "skin*", "season*", "costume", "outfit", "language", "options", "preferences"], local: true, async answer() { return { action: "options" }; } },
  ];
}

const newsletterTheme = require("./newsletter-theme");
/* Newsletter report builder: renders an ordered list of configurable blocks into email-safe HTML and plain text. */
const db = require("../db");

const REPORT_BLOCK_TYPES = [
  "intro",
  "stats",
  "recentlyAdded",
  "topWatched",
  "activeUsers",
  "topClients",
  "playMethods",
  "activityByDay",
  "libraryOverview",
  "repairSummary",
  "continueWatching",
  "myRequests",
  "text",
  "customHtml",
  "divider",
];

const PER_USER_BLOCKS = new Set(["continueWatching", "myRequests"]);

const BLOCK_DEFAULT_TITLES = {
  intro: "",
  stats: "At a glance",
  recentlyAdded: "Recently added",
  topWatched: "Most watched",
  activeUsers: "Top viewers",
  topClients: "Top apps and devices",
  playMethods: "How people played",
  activityByDay: "Plays per day",
  libraryOverview: "Library overview",
  repairSummary: "Repair snapshot",
  continueWatching: "Continue watching",
  myRequests: "My requests",
  text: "",
  customHtml: "",
  divider: "",
};

const DEFAULT_REPORT = {
  enabled: false,
  periodDays: 7,
  accentColor: "#6ee7f9",
  subject: "{campaign} - {date}",
  showLogo: true,
  footer: "",
  blocks: [],
};

const clampInt = (value, min, max, fallback) => {
  const number = Math.round(Number(value));
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
};

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatDate(value) {
  if (!value) return "Unknown";
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(value));
}

function formatWatchTime(seconds) {
  const total = Number(seconds || 0);
  const hours = Math.floor(total / 3600);
  if (hours >= 1) return `${hours.toLocaleString("en-GB")}h ${Math.round((total % 3600) / 60)}m`;
  return `${Math.round(total / 60).toLocaleString("en-GB")}m`;
}

function safeColor(value, fallback = DEFAULT_REPORT.accentColor) {
  return /^#[0-9a-f]{6}$/i.test(String(value || "")) ? value : fallback;
}

function normalizeBlock(block = {}, index = 0) {
  const type = REPORT_BLOCK_TYPES.includes(block.type) ? block.type : null;
  if (!type) return null;
  const options = block.options && typeof block.options === "object" ? block.options : {};
  return {
    id: String(block.id || `${type}-${index}`).slice(0, 64),
    type,
    enabled: block.enabled !== false,
    title: String(block.title ?? "").slice(0, 160),
    options: {
      limit: clampInt(options.limit, 1, 25, 8),
      periodDays: options.periodDays === "" || options.periodDays == null ? null : clampInt(options.periodDays, 1, 365, 7),
      mediaType: ["all", "movies", "shows"].includes(options.mediaType) ? options.mediaType : "all",
      libraryId: String(options.libraryId || "").slice(0, 128),
      text: String(options.text || "").slice(0, 8000),
      html: String(options.html || "").slice(0, 20000),
      style: ["list", "cards"].includes(options.style) ? options.style : "list",
    },
  };
}

function normalizeReport(report = {}) {
  const source = report && typeof report === "object" ? report : {};
  return {
    enabled: source.enabled === true,
    periodDays: clampInt(source.periodDays, 1, 365, DEFAULT_REPORT.periodDays),
    accentColor: safeColor(source.accentColor),
    subject: String(source.subject || DEFAULT_REPORT.subject).slice(0, 200),
    showLogo: source.showLogo !== false,
    footer: String(source.footer || "").slice(0, 2000),
    blocks: (Array.isArray(source.blocks) ? source.blocks : [])
      .slice(0, 40)
      .map(normalizeBlock)
      .filter(Boolean),
  };
}

function reportSubject(report, { campaignName, periodDays }) {
  return String(report.subject || DEFAULT_REPORT.subject)
    .replace(/\{campaign\}/g, campaignName || "JellyGlance")
    .replace(/\{date\}/g, formatDate(new Date()))
    .replace(/\{period\}/g, `${periodDays} days`)
    .trim();
}

async function queryRows(sql, params) {
  try {
    const { rows } = await db.query(sql, params);
    return rows;
  } catch (error) {
    console.error("Newsletter report query failed:", error.message);
    return [];
  }
}

const MEDIA_FILTER = {
  all: "",
  movies: `AND COALESCE("SeriesName", '') = ''`,
  shows: `AND COALESCE("SeriesName", '') <> ''`,
};

async function blockData(block, period, context) {
  const days = block.options.periodDays || period;
  const limit = block.options.limit;
  switch (block.type) {
    case "stats": {
      const [plays] = await queryRows(
        `SELECT count(*)::int AS plays, COALESCE(sum("PlaybackDuration"), 0)::bigint AS seconds,
                count(DISTINCT NULLIF("UserName", ''))::int AS viewers,
                count(DISTINCT COALESCE(NULLIF("SeriesName", ''), "NowPlayingItemName"))::int AS titles
         FROM jf_playback_activity WHERE "ActivityDateInserted" >= now() - make_interval(days => $1)`,
        [days]
      );
      const [added] = await queryRows(
        `SELECT count(*)::int AS added FROM jf_library_items
         WHERE archived = false AND "DateCreated" >= now() - make_interval(days => $1)`,
        [days]
      );
      return { days, ...(plays || {}), added: added?.added || 0 };
    }
    case "recentlyAdded": {
      if (context.personData && !block.options.libraryId) return { days, items: (context.personData.recentlyAdded || []).slice(0, limit) };
      const params = [limit];
      let where = "WHERE i.archived = false";
      if (block.options.libraryId) {
        params.push(block.options.libraryId);
        where += ` AND i."ParentId" = $${params.length}`;
      }
      if (block.options.mediaType === "movies") where += ` AND i."Type" = 'Movie'`;
      if (block.options.mediaType === "shows") where += ` AND i."Type" = 'Series'`;
      const items = await queryRows(
        `SELECT i."Name", i."Type", i."ProductionYear", i."DateCreated", l."Name" AS "Library"
         FROM jf_library_items i LEFT JOIN jf_libraries l ON l."Id" = i."ParentId"
         ${where} ORDER BY i."DateCreated" DESC NULLS LAST LIMIT $1`,
        params
      );
      return { days, items };
    }
    case "topWatched": {
      const items = await queryRows(
        `SELECT COALESCE(NULLIF("SeriesName", ''), NULLIF("NowPlayingItemName", ''), 'Unknown item') AS "Name",
                count(*)::int AS "Plays", COALESCE(sum("PlaybackDuration"), 0)::bigint AS "WatchSeconds",
                count(DISTINCT NULLIF("UserName", ''))::int AS "Viewers"
         FROM jf_playback_activity
         WHERE "ActivityDateInserted" >= now() - make_interval(days => $1) ${MEDIA_FILTER[block.options.mediaType]}
         GROUP BY 1 ORDER BY 2 DESC, 3 DESC LIMIT $2`,
        [days, limit]
      );
      return { days, items };
    }
    case "activeUsers": {
      const items = await queryRows(
        `SELECT COALESCE(NULLIF("UserName", ''), 'Unknown user') AS "Name", count(*)::int AS "Plays",
                COALESCE(sum("PlaybackDuration"), 0)::bigint AS "WatchSeconds"
         FROM jf_playback_activity WHERE "ActivityDateInserted" >= now() - make_interval(days => $1)
         GROUP BY 1 ORDER BY 2 DESC, 3 DESC LIMIT $2`,
        [days, limit]
      );
      return { days, items };
    }
    case "topClients": {
      const items = await queryRows(
        `SELECT COALESCE(NULLIF("Client", ''), 'Unknown app') AS "Name", count(*)::int AS "Plays",
                count(DISTINCT NULLIF("DeviceName", ''))::int AS "Devices"
         FROM jf_playback_activity WHERE "ActivityDateInserted" >= now() - make_interval(days => $1)
         GROUP BY 1 ORDER BY 2 DESC LIMIT $2`,
        [days, limit]
      );
      return { days, items };
    }
    case "playMethods": {
      const items = await queryRows(
        `SELECT CASE
                  WHEN "PlayMethod" ILIKE 'Transcode%' THEN 'Transcode'
                  WHEN "PlayMethod" ILIKE 'DirectStream%' THEN 'Direct stream'
                  WHEN "PlayMethod" ILIKE 'DirectPlay%' THEN 'Direct play'
                  ELSE 'Unknown' END AS "Name",
                count(*)::int AS "Plays"
         FROM jf_playback_activity WHERE "ActivityDateInserted" >= now() - make_interval(days => $1)
         GROUP BY 1 ORDER BY 2 DESC`,
        [days]
      );
      return { days, items };
    }
    case "activityByDay": {
      const span = Math.min(days, 31);
      const items = await queryRows(
        `SELECT to_char(d.day, 'Dy DD') AS "Name", count(a."Id")::int AS "Plays"
         FROM generate_series(date_trunc('day', now()) - make_interval(days => $1 - 1), date_trunc('day', now()), interval '1 day') AS d(day)
         LEFT JOIN jf_playback_activity a ON date_trunc('day', a."ActivityDateInserted") = d.day
         GROUP BY d.day ORDER BY d.day`,
        [span]
      );
      return { days: span, items };
    }
    case "libraryOverview": {
      const items = await queryRows(
        `SELECT l."Name", l."CollectionType",
                count(i."Id") FILTER (WHERE i.archived = false)::int AS "Items",
                count(i."Id") FILTER (WHERE i.archived = false AND i."DateCreated" >= now() - make_interval(days => $1))::int AS "New"
         FROM jf_libraries l LEFT JOIN jf_library_items i ON i."ParentId" = l."Id"
         GROUP BY l."Id", l."Name", l."CollectionType" ORDER BY 3 DESC LIMIT $2`,
        [days, limit]
      );
      return { days, items };
    }
    case "repairSummary": {
      const [issues] = await queryRows(
        `SELECT count(*) FILTER (WHERE COALESCE("PrimaryImageHash", '') = '')::int AS "missingPosters",
                count(*) FILTER (WHERE COALESCE("ImageTagsLogo", '') = '')::int AS "missingLogos",
                count(*) FILTER (WHERE COALESCE("RunTimeTicks", 0) = 0)::int AS "missingRuntime"
         FROM jf_library_items WHERE archived = false`,
        []
      );
      return { days, ...(issues || {}) };
    }
    case "continueWatching":
      return { days, items: (context.personData?.continueWatching || []).slice(0, limit) };
    case "myRequests":
      return { days, items: (context.personData?.myRequests || []).slice(0, limit) };
    default:
      return { days };
  }
}

function periodLabel(days) {
  if (days === 1) return "last 24 hours";
  if (days === 7) return "last week";
  if (days === 30) return "last 30 days";
  return `last ${days} days`;
}

function textToHtml(text) {
  return escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .split(/\n{2,}/)
    .map((paragraph) => `<p style="margin:0 0 10px;color:#c9d6e8;font-size:14px;line-height:1.6;">${paragraph.replace(/\n/g, "<br/>")}</p>`)
    .join("");
}

function titleHtml(title, accent, subtitle = "") {
  if (!title) return "";
  return `<h2 style="margin:26px 0 10px;color:#f4f8ff;font-size:17px;border-left:3px solid ${accent};padding-left:10px;">${escapeHtml(title)}${
    subtitle ? ` <span style="color:#7f93ad;font-size:12px;font-weight:600;">${escapeHtml(subtitle)}</span>` : ""
  }</h2>`;
}

function emptyHtml(text) {
  return `<p style="color:#8fa3bd;margin:0;font-size:14px;">${escapeHtml(text)}</p>`;
}

function rowsHtml(items, render) {
  return items
    .map(
      (item, index) =>
        `<tr><td style="padding:9px 0;border-bottom:1px solid #243246;color:#7f93ad;font-size:13px;width:26px;vertical-align:top;">${index + 1}</td><td style="padding:9px 0;border-bottom:1px solid #243246;color:#d7e2f2;font-size:14px;">${render(item)}</td></tr>`
    )
    .join("");
}

function listTable(items, render, empty) {
  if (!items?.length) return emptyHtml(empty);
  return `<table width="100%" cellpadding="0" cellspacing="0">${rowsHtml(items, render)}</table>`;
}

function barsHtml(items, accent, { valueKey = "Plays", suffix = "plays" } = {}) {
  if (!items?.length) return emptyHtml("No activity in this period.");
  const max = Math.max(...items.map((item) => Number(item[valueKey] || 0)), 1);
  return `<table width="100%" cellpadding="0" cellspacing="0">${items
    .map((item) => {
      const value = Number(item[valueKey] || 0);
      const width = Math.max(2, Math.round((value / max) * 100));
      return `<tr>
        <td style="padding:5px 10px 5px 0;color:#c9d6e8;font-size:13px;white-space:nowrap;width:110px;">${escapeHtml(item.Name)}</td>
        <td style="padding:5px 0;"><table width="100%" cellpadding="0" cellspacing="0"><tr>
          <td style="width:${width}%;background:${accent};height:12px;border-radius:6px;font-size:0;line-height:0;">&nbsp;</td>
          <td style="width:${100 - width}%;font-size:0;line-height:0;">&nbsp;</td>
        </tr></table></td>
        <td style="padding:5px 0 5px 10px;color:#9fb0c7;font-size:12px;white-space:nowrap;text-align:right;width:70px;">${value.toLocaleString("en-GB")} ${value === 1 ? suffix.replace(/s$/, "") : suffix}</td>
      </tr>`;
    })
    .join("")}</table>`;
}

function statTiles(tiles, accent) {
  const cells = tiles
    .map(
      ([label, value, detail], index) => `<td style="width:25%;padding:5px;vertical-align:top;">
        <div style="background:#121a24;border:1px solid #27364a;border-radius:14px;padding:13px;">
          <div style="color:#8fa3bd;font-size:11px;font-weight:800;text-transform:uppercase;">${escapeHtml(label)}</div>
          <div style="color:${index === 0 ? accent : ["#a78bfa", "#34d399", "#fbbf24"][index - 1] || accent};font-size:24px;font-weight:900;line-height:1.1;margin:6px 0 3px;">${escapeHtml(value)}</div>
          <div style="color:#9fb0c7;font-size:12px;">${escapeHtml(detail)}</div>
        </div></td>`
    )
    .join("");
  return `<table width="100%" cellpadding="0" cellspacing="0"><tr>${cells}</tr></table>`;
}

function meta(parts) {
  const text = parts.filter((part) => part !== null && part !== undefined && part !== "").join(" · ");
  return text ? ` <span style="color:#8fa3bd;">${escapeHtml(text)}</span>` : "";
}

function renderBlock(block, data, accent) {
  const title = block.title || BLOCK_DEFAULT_TITLES[block.type];
  const sub = data.days ? periodLabel(data.days) : "";
  switch (block.type) {
    case "intro":
      return `${block.title ? `<h2 style="margin:18px 0 8px;color:#f4f8ff;font-size:20px;">${escapeHtml(block.title)}</h2>` : ""}${textToHtml(block.options.text)}`;
    case "text":
      return `${titleHtml(block.title, accent)}${textToHtml(block.options.text)}`;
    case "customHtml":
      return `${titleHtml(block.title, accent)}<div>${block.options.html}</div>`;
    case "divider":
      return `<div style="border-top:1px solid #27364a;margin:22px 0;"></div>`;
    case "stats":
      return `${titleHtml(title, accent, sub)}${statTiles(
        [
          ["Plays", Number(data.plays || 0).toLocaleString("en-GB"), `${Number(data.titles || 0)} titles`],
          ["Watch time", formatWatchTime(data.seconds), "Total played"],
          ["Viewers", String(Number(data.viewers || 0)), "Watched something"],
          ["New", String(Number(data.added || 0)), "Items added"],
        ],
        accent
      )}`;
    case "recentlyAdded":
      return `${titleHtml(title, accent)}${listTable(
        data.items,
        (item) => `<strong>${escapeHtml(item.Name)}</strong>${meta([item.Type, item.ProductionYear, item.Library])}`,
        "No new media this period."
      )}`;
    case "topWatched":
      return `${titleHtml(title, accent, sub)}${listTable(
        data.items,
        (item) => `<strong>${escapeHtml(item.Name)}</strong>${meta([`${item.Plays} plays`, formatWatchTime(item.WatchSeconds), item.Viewers ? `${item.Viewers} viewer${item.Viewers === 1 ? "" : "s"}` : ""])}`,
        "No watch activity in this period."
      )}`;
    case "activeUsers":
      return `${titleHtml(title, accent, sub)}${listTable(
        data.items,
        (item) => `<strong>${escapeHtml(item.Name)}</strong>${meta([`${item.Plays} plays`, formatWatchTime(item.WatchSeconds)])}`,
        "No viewers in this period."
      )}`;
    case "topClients":
      return `${titleHtml(title, accent, sub)}${barsHtml(data.items, accent)}`;
    case "playMethods":
      return `${titleHtml(title, accent, sub)}${barsHtml(data.items, accent)}`;
    case "activityByDay":
      return `${titleHtml(title, accent, sub)}${barsHtml(data.items, accent)}`;
    case "libraryOverview":
      return `${titleHtml(title, accent)}${listTable(
        data.items,
        (item) => `<strong>${escapeHtml(item.Name)}</strong>${meta([`${Number(item.Items || 0).toLocaleString("en-GB")} items`, item.New ? `${item.New} new` : ""])}`,
        "No libraries synced yet."
      )}`;
    case "repairSummary":
      return `${titleHtml(title, accent)}${statTiles(
        [
          ["Posters", String(Number(data.missingPosters || 0)), "Missing"],
          ["Logos", String(Number(data.missingLogos || 0)), "Missing"],
          ["Runtime", String(Number(data.missingRuntime || 0)), "Missing"],
        ],
        accent
      )}`;
    case "continueWatching":
      return `${titleHtml(title, accent)}${listTable(data.items, (item) => `<strong>${escapeHtml(item.Name)}</strong>${meta([item.Type])}`, "Nothing in progress.")}`;
    case "myRequests":
      return `${titleHtml(title, accent)}${listTable(data.items, (item) => `<strong>${escapeHtml(item.Name)}</strong>${meta([item.Type, item.status])}`, "No requests.")}`;
    default:
      return "";
  }
}

function renderBlockText(block, data) {
  const title = block.title || BLOCK_DEFAULT_TITLES[block.type];
  const lines = title ? ["", title.toUpperCase()] : [""];
  switch (block.type) {
    case "intro":
    case "text":
      return [...lines, block.options.text];
    case "stats":
      return [...lines, `Plays: ${data.plays || 0}`, `Watch time: ${formatWatchTime(data.seconds)}`, `Viewers: ${data.viewers || 0}`, `New items: ${data.added || 0}`];
    case "repairSummary":
      return [...lines, `Missing posters: ${data.missingPosters || 0}`, `Missing logos: ${data.missingLogos || 0}`, `Missing runtime: ${data.missingRuntime || 0}`];
    case "customHtml":
    case "divider":
      return [];
    default:
      return [
        ...lines,
        ...(data.items || []).map((item) =>
          `- ${item.Name}${item.Plays != null ? `: ${item.Plays} play${item.Plays === 1 ? "" : "s"}` : ""}${item.Items != null ? `: ${item.Items} items` : ""}${item.Type ? ` (${item.Type})` : ""}`
        ),
      ];
  }
}

async function renderReport(input, { campaignName, logoSrc = "", personData = null, perUser = false, branding = {}, htmlBody = "", date, assetBase = "" } = {}) {
  const report = normalizeReport(input);
  const theme = newsletterTheme.normalizeBranding({
    ...branding,
    accent: branding.accent || branding.accentColor || report.accentColor,
    footer: branding.footer || report.footer || "",
  });
  const accent = theme.accent;
  const context = { personData };
  const blocks = report.blocks.filter((block) => block.enabled && (perUser || !PER_USER_BLOCKS.has(block.type)));
  const rendered = await Promise.all(
    blocks.map(async (block) => {
      const data = await blockData(block, report.periodDays, context);
      return { html: renderBlock(block, data, accent), text: renderBlockText(block, data) };
    })
  );
  const subject = reportSubject(report, { campaignName, periodDays: report.periodDays });
  const greeting = personData?.personName ? `Hi ${personData.personName},` : "";
  const inner = `${greeting ? `<p style="margin:14px 0 10px;color:${theme.text};font-size:15px;">${escapeHtml(greeting)}</p>` : ""}
            ${rendered.map((block) => block.html).join("\n") || emptyHtml("This report has no blocks yet. Add some in the report builder.")}`;
  const html = newsletterTheme.wrapEmailDocument({
    bodyHtml: inner,
    subject: escapeHtml(subject),
    campaignName: escapeHtml(campaignName || "JellyGlance report"),
    generatedAt: `Covering the ${escapeHtml(periodLabel(report.periodDays))} · generated ${escapeHtml(formatDate(new Date()))}`,
    logoSrc: report.showLogo ? (theme.logoUrl || logoSrc) : "",
    branding: theme,
    htmlBody,
    kickerColor: accent,
    date,
    assetBase,
  });
  const text = [subject, `Covering the ${periodLabel(report.periodDays)}`, greeting, ...rendered.flatMap((block) => block.text), "", report.footer]
    .filter((line) => line !== undefined)
    .join("\n")
    .trim();
  return { subject, html, text, generatedAt: new Date().toISOString() };
}

async function listReportLibraries() {
  return queryRows(`SELECT "Id" AS id, "Name" AS name, "CollectionType" AS type FROM jf_libraries ORDER BY "Name" ASC`, []);
}

module.exports = {
  REPORT_BLOCK_TYPES,
  PER_USER_BLOCKS,
  DEFAULT_REPORT,
  normalizeReport,
  renderReport,
  listReportLibraries,
};

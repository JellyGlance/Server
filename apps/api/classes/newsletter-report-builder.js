const newsletterTheme = require("./newsletter-theme");
const newsletterI18n = require("./newsletter-i18n");
const publicUrl = require("./newsletter-public-url");
const { buildForYou } = require("./for-you");
const { buildWrapped } = require("./wrapped-recap");
const wrappedCard = require("./wrapped-card");
const leavingSoon = require("./newsletter-leaving-soon");
const seerrRequests = require("./newsletter-seerr-requests");
const statusPage = require("./status-page");
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
  "forYou",
  "wrappedRecap",
  "leavingSoon",
  "fulfilledRequests",
  "serverNews",
  "text",
  "customHtml",
  "divider",
];

const PER_USER_BLOCKS = new Set(["continueWatching", "myRequests", "forYou"]);

const BLOCK_DEFAULT_TITLE_KEYS = {
  intro: "",
  stats: "AT_A_GLANCE",
  recentlyAdded: "RECENTLY_ADDED",
  topWatched: "MOST_WATCHED",
  activeUsers: "TOP_VIEWERS",
  topClients: "TOP_APPS",
  playMethods: "HOW_PLAYED",
  activityByDay: "PLAYS_PER_DAY",
  libraryOverview: "LIBRARY_OVERVIEW",
  repairSummary: "REPAIR",
  continueWatching: "CONTINUE_WATCHING",
  myRequests: "MY_REQUESTS",
  forYou: "FOR_YOU",
  wrappedRecap: "WRAPPED",
  leavingSoon: "LEAVING_SOON",
  fulfilledRequests: "FULFILLED",
  serverNews: "SERVER_NEWS",
  text: "",
  customHtml: "",
  divider: "",
};

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
  forYou: "Picked for you",
  wrappedRecap: "Your recap",
  leavingSoon: "Leaving soon",
  fulfilledRequests: "Newly available requests",
  serverNews: "Server news",
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

function formatDate(value, locale = "en-GB") {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return new Intl.DateTimeFormat(locale || "en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(date);
}

function formatWatchTime(seconds, locale = "en-GB") {
  const total = Number(seconds || 0);
  const hours = Math.floor(total / 3600);
  if (hours >= 1) return `${hours.toLocaleString(locale || "en-GB")}h ${Math.round((total % 3600) / 60)}m`;
  return `${Math.round(total / 60).toLocaleString(locale || "en-GB")}m`;
}

function safeColor(value, fallback = DEFAULT_REPORT.accentColor) {
  return /^#[0-9a-f]{6}$/i.test(String(value || "")) ? value : fallback;
}

function identityT(key, vars = {}) {
  if (key === "PERIOD_1") return "last 24 hours";
  if (key === "PERIOD_WEEK") return "last week";
  if (key === "PERIOD_30") return "last 30 days";
  if (key === "PERIOD_DAYS") return `last ${vars.count} days`;
  if (key === "TITLES_COUNT") return `${vars.count} titles`;
  if (key === "PLAYS_COUNT") return `${vars.count} plays`;
  if (key === "PLAYS_COUNT_ONE") return `${vars.count} play`;
  if (key === "VIEWER_COUNT") return `${vars.count} viewers`;
  if (key === "VIEWER_COUNT_ONE") return `${vars.count} viewer`;
  if (key === "ITEMS_COUNT") return `${vars.count} items`;
  if (key === "NEW_COUNT") return `${vars.count} new`;
  if (key === "COVERING") return `Covering the ${vars.period} · generated ${vars.date}`;
  if (key === "HI") return `Hi ${vars.name},`;
  return BLOCK_DEFAULT_TITLES[key] || key;
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
      wrappedPeriod: ["week", "month", "year"].includes(options.wrappedPeriod) ? options.wrappedPeriod : "week",
      kind: ["maintenance", "feature"].includes(options.kind) ? options.kind : "feature",
      startAt: String(options.startAt || "").slice(0, 32),
      endAt: String(options.endAt || "").slice(0, 32),
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

function reportSubject(report, { campaignName, periodDays, locale }) {
  return String(report.subject || DEFAULT_REPORT.subject)
    .replace(/\{campaign\}/g, campaignName || "JellyGlance")
    .replace(/\{date\}/g, formatDate(new Date(), locale))
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
        `SELECT i."Id", i."Name", i."Type", i."ProductionYear", i."DateCreated", i."PrimaryImageHash", l."Name" AS "Library"
         FROM jf_library_items i LEFT JOIN jf_libraries l ON l."Id" = i."ParentId"
         ${where} ORDER BY i."DateCreated" DESC NULLS LAST LIMIT $1`,
        params
      );
      return { days, items };
    }
    case "topWatched": {
      const items = await queryRows(
        `SELECT ranked."Name", ranked."Id", ranked."Plays", ranked."WatchSeconds", ranked."Viewers",
                i."PrimaryImageHash", i."Type"
           FROM (
             SELECT COALESCE(NULLIF(a."SeriesName", ''), NULLIF(a."NowPlayingItemName", ''), 'Unknown item') AS "Name",
                    MAX(COALESCE(e."SeriesId", a."NowPlayingItemId")) AS "Id",
                    count(*)::int AS "Plays",
                    COALESCE(sum(a."PlaybackDuration"), 0)::bigint AS "WatchSeconds",
                    count(DISTINCT NULLIF(a."UserName", ''))::int AS "Viewers"
               FROM jf_playback_activity a
               LEFT JOIN jf_library_episodes e ON e."EpisodeId" = a."EpisodeId"
              WHERE a."ActivityDateInserted" >= now() - make_interval(days => $1) ${MEDIA_FILTER[block.options.mediaType]}
              GROUP BY 1
              ORDER BY 3 DESC, 4 DESC
              LIMIT $2
           ) ranked
           LEFT JOIN jf_library_items i ON i."Id" = ranked."Id"`,
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
    case "forYou": {
      const userId = context.personData?.userId || context.personData?.UserId || "";
      const data = await buildForYou(userId, { pickLimit: limit, becauseLimit: Math.max(6, limit) });
      return { days, picks: (data.picks || []).slice(0, limit), because: data.because || [], topGenres: data.topGenres || [] };
    }
    case "wrappedRecap": {
      const period = block.options.wrappedPeriod || "week";
      const userId = context.personData?.userId || context.personData?.UserId || null;
      const data = await buildWrapped({ period, userId });
      return {
        ...data,
        topShows: (data.topShows || []).slice(0, limit).map((row) => ({ ...row, Name: row.name, Id: row.item_id || row.itemId, Plays: row.plays, WatchSeconds: row.seconds })),
        topMovies: (data.topMovies || []).slice(0, limit).map((row) => ({ ...row, Name: row.name, Id: row.item_id || row.itemId, Plays: row.plays, WatchSeconds: row.seconds })),
      };
    }
    case "leavingSoon": {
      const data = await leavingSoon.listLeavingSoon({ limit, now: context.now });
      return { days, items: data.items, maintainerrConfigured: data.maintainerrConfigured };
    }
    case "fulfilledRequests": {
      const userName = context.perUser ? (context.personData?.personName || context.personData?.name || "") : "";
      const items = await seerrRequests.listFulfilledRequests({
        lastSentAt: context.lastSentAt,
        days: days || 7,
        limit,
        userName,
        now: context.now || new Date(),
      });
      return { days: days || 7, items };
    }
    case "serverNews": {
      const now = context.now || new Date();
      const startAt = block.options.startAt || "";
      const endAt = block.options.endAt || "";
      const startMs = startAt ? Date.parse(startAt) : null;
      const endMs = endAt ? Date.parse(endAt.length === 10 ? `${endAt}T23:59:59` : endAt) : null;
      const nowMs = now.getTime();
      const inWindow = (startMs == null || !Number.isFinite(startMs) || nowMs >= startMs) && (endMs == null || !Number.isFinite(endMs) || nowMs <= endMs);
      const config = await statusPage.getStatusConfig().catch(() => ({ enabled: false }));
      return {
        kind: block.options.kind || "feature",
        text: inWindow ? (block.options.text || "") : "",
        startAt,
        endAt,
        visible: inWindow,
        statusEnabled: Boolean(config && config.enabled),
      };
    }
    default:
      return { days };
  }
}

function periodLabel(days, t = identityT) {
  if (Number(days) === 1) return t("PERIOD_1");
  if (Number(days) === 7) return t("PERIOD_WEEK");
  if (Number(days) === 30) return t("PERIOD_30");
  return t("PERIOD_DAYS", { count: Number(days) || 0 });
}

function newsKindLabel(kind, t) {
  if (kind === "maintenance") return t("NEWS_MAINTENANCE");
  if (kind === "feature") return t("NEWS_FEATURE");
  return "";
}

function newsDates(data, locale) {
  const start = data.startAt ? formatDate(data.startAt, locale) : "";
  const end = data.endAt ? formatDate(data.endAt, locale) : "";
  if (start && end) return `${start} – ${end}`;
  return start || end || "";
}

function leavingLabel(item, t) {
  const days = Number(item.countdownDays);
  if (!Number.isFinite(days) || days <= 0) return t("LEAVING_TODAY");
  if (days === 1) return t("LEAVING_TOMORROW");
  return t("LEAVING_IN_DAYS", { count: days });
}

function wrappedHeading(data, t, locale) {
  if (data.period === "week") return t("WRAPPED_PERIOD_WEEK", { date: formatDate(data.start, locale) });
  if (data.period === "month") {
    const date = data.start ? new Date(data.start) : new Date();
    const month = Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat(locale || "en-GB", { month: "long" }).format(date) : "";
    return t("WRAPPED_PERIOD_MONTH", { month, year: data.year || date.getFullYear() });
  }
  return t("WRAPPED_PERIOD_YEAR", { year: data.year || new Date().getFullYear() });
}

function defaultTitle(block, t = identityT) {
  if (block.title) return block.title;
  const key = BLOCK_DEFAULT_TITLE_KEYS[block.type];
  if (key) {
    const translated = t(key);
    if (translated && translated !== key) return translated;
  }
  return BLOCK_DEFAULT_TITLES[block.type] || "";
}

function themeOf(ctx) {
  return ctx.theme || newsletterTheme.normalizeBranding({ accent: ctx.accent });
}

function titleHtml(title, ctx, subtitle = "") {
  if (!title) return "";
  const theme = themeOf(ctx);
  const accent = ctx.accent || theme.accent;
  return `<h2 style="margin:26px 0 10px;color:${theme.heading};font-size:17px;border-left:3px solid ${accent};padding-left:10px;">${escapeHtml(title)}${
    subtitle ? ` <span style="color:${theme.muted};font-size:12px;font-weight:600;">${escapeHtml(subtitle)}</span>` : ""
  }</h2>`;
}

function emptyHtml(text, ctx = {}) {
  const theme = themeOf(ctx);
  return `<p style="color:${theme.muted};margin:0;font-size:14px;">${escapeHtml(text)}</p>`;
}

function itemIdOf(item) {
  return item?.Id || item?.id || item?.itemId || item?.item_id || item?.imageId || item?.SeriesId || item?.seriesId || "";
}

function requestIdOf(item) {
  return item?.requestId || item?.RequestId || item?.id || item?.Id || "";
}

function hasPosterHint(item) {
  const hash = item?.PrimaryImageHash ?? item?.primaryImageHash ?? item?.ImageTagsPrimary;
  if (hash === "") return false;
  return Boolean(itemIdOf(item));
}

function hrefFor(item, ctx, kind) {
  if (kind === "request") return publicUrl.requestsHref(ctx.publicBase, requestIdOf(item)) || publicUrl.requestsHref(ctx.publicBase);
  return publicUrl.itemHref(ctx.publicBase, itemIdOf(item));
}

function wrapLink(inner, href, color) {
  if (!href) return inner;
  return `<a href="${escapeHtml(href)}" style="color:${color || "inherit"};text-decoration:none;">${inner}</a>`;
}

function rowsHtml(items, render, ctx) {
  const theme = themeOf(ctx);
  return items
    .map(
      (item, index) =>
        `<tr><td style="padding:9px 0;border-bottom:1px solid ${theme.border};color:${theme.muted};font-size:13px;width:26px;vertical-align:top;">${index + 1}</td><td style="padding:9px 0;border-bottom:1px solid ${theme.border};color:${theme.text};font-size:14px;">${render(item)}</td></tr>`
    )
    .join("");
}

function listTable(items, render, empty, ctx) {
  if (!items?.length) return emptyHtml(empty, ctx);
  return `<table width="100%" cellpadding="0" cellspacing="0" role="presentation">${rowsHtml(items, render, ctx)}</table>`;
}

function fallbackPoster(item, ctx) {
  const theme = themeOf(ctx);
  const letter = String(item?.Name || "?").trim().slice(0, 1).toUpperCase() || "?";
  return `<table width="160" cellpadding="0" cellspacing="0" role="presentation" style="width:160px;max-width:100%;"><tr><td align="center" valign="middle" style="height:240px;background:${theme.card};border:1px solid ${theme.border};border-radius:10px;color:${theme.muted};font-size:28px;font-weight:800;">${escapeHtml(letter)}<div style="font-size:11px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;margin-top:8px;">${escapeHtml(ctx.t ? ctx.t("NO_ARTWORK") : "No artwork")}</div></td></tr></table>`;
}

function posterImage(item, ctx, href) {
  const theme = themeOf(ctx);
  const src = hasPosterHint(item) ? publicUrl.posterSrc(ctx.publicBase, itemIdOf(item), { width: 240, quality: 80 }) : "";
  const alt = item?.Name || "";
  const img = src
    ? `<img src="${escapeHtml(src)}" width="160" alt="${escapeHtml(alt)}" style="display:block;width:160px;max-width:100%;height:auto;border:1px solid ${theme.border};border-radius:10px;background:${theme.card};" />`
    : fallbackPoster(item, ctx);
  return wrapLink(img, href);
}

function cardsHtml(items, ctx, { kind = "item", metaFor } = {}) {
  const theme = themeOf(ctx);
  if (!items?.length) return emptyHtml(ctx.empty || "", ctx);
  const cells = items.map((item) => {
    const href = hrefFor(item, ctx, kind);
    const title = wrapLink(`<strong style="color:${theme.heading};">${escapeHtml(item.Name || "")}</strong>`, href, theme.heading);
    const metaText = metaFor ? metaFor(item) : "";
    return `<td width="33%" valign="top" style="padding:0 8px 16px 0;width:33%;">
      ${posterImage(item, ctx, href)}
      <p style="margin:8px 0 0;font-size:14px;line-height:1.35;color:${theme.text};">${title}${metaText ? `<br /><span style="color:${theme.muted};font-size:12px;">${escapeHtml(metaText)}</span>` : ""}</p>
    </td>`;
  });
  const rows = [];
  for (let index = 0; index < cells.length; index += 3) {
    const row = cells.slice(index, index + 3);
    while (row.length < 3) row.push(`<td width="33%" style="padding:0 8px 16px 0;width:33%;font-size:0;line-height:0;">&nbsp;</td>`);
    rows.push(`<tr>${row.join("")}</tr>`);
  }
  return `<table width="100%" cellpadding="0" cellspacing="0" role="presentation">${rows.join("")}</table>`;
}

function itemListOrCards(items, ctx, { kind = "item", render, empty, metaFor }) {
  if (ctx.style === "cards") {
    return cardsHtml(items, { ...ctx, empty }, { kind, metaFor });
  }
  return listTable(items, render, empty, ctx);
}

function barsHtml(items, ctx, { valueKey = "Plays", suffix = "plays" } = {}) {
  const theme = themeOf(ctx);
  const t = ctx.t || identityT;
  if (!items?.length) return emptyHtml(t("NO_ACTIVITY_PERIOD"), ctx);
  const max = Math.max(...items.map((item) => Number(item[valueKey] || 0)), 1);
  const accent = ctx.accent || theme.accent;
  return `<table width="100%" cellpadding="0" cellspacing="0" role="presentation">${items
    .map((item) => {
      const value = Number(item[valueKey] || 0);
      const width = Math.max(2, Math.round((value / max) * 100));
      const label = value === 1 ? suffix.replace(/s$/, "") : suffix;
      return `<tr>
        <td style="padding:5px 10px 5px 0;color:${theme.text};font-size:13px;white-space:nowrap;width:110px;">${escapeHtml(item.Name)}</td>
        <td style="padding:5px 0;"><table width="100%" cellpadding="0" cellspacing="0" role="presentation"><tr>
          <td style="width:${width}%;background:${accent};height:12px;border-radius:6px;font-size:0;line-height:0;">&nbsp;</td>
          <td style="width:${100 - width}%;font-size:0;line-height:0;">&nbsp;</td>
        </tr></table></td>
        <td style="padding:5px 0 5px 10px;color:${theme.muted};font-size:12px;white-space:nowrap;text-align:right;width:70px;">${value.toLocaleString(ctx.locale || "en-GB")} ${escapeHtml(label)}</td>
      </tr>`;
    })
    .join("")}</table>`;
}

function statTiles(tiles, ctx) {
  const theme = themeOf(ctx);
  const accent = ctx.accent || theme.accent;
  const cells = tiles
    .map(
      ([label, value, detail], index) => `<td style="width:25%;padding:5px;vertical-align:top;">
        <div style="background:${theme.card};border:1px solid ${theme.border};border-radius:14px;padding:13px;">
          <div style="color:${theme.muted};font-size:11px;font-weight:800;text-transform:uppercase;">${escapeHtml(label)}</div>
          <div style="color:${index === 0 ? accent : ["#a78bfa", "#34d399", "#fbbf24"][index - 1] || accent};font-size:24px;font-weight:900;line-height:1.1;margin:6px 0 3px;">${escapeHtml(value)}</div>
          <div style="color:${theme.muted};font-size:12px;">${escapeHtml(detail)}</div>
        </div></td>`
    )
    .join("");
  return `<table width="100%" cellpadding="0" cellspacing="0" role="presentation"><tr>${cells}</tr></table>`;
}

function meta(parts, ctx) {
  const theme = themeOf(ctx);
  const text = parts.filter((part) => part !== null && part !== undefined && part !== "").join(" · ");
  return text ? ` <span style="color:${theme.muted};">${escapeHtml(text)}</span>` : "";
}

function playsLabel(count, t) {
  return Number(count) === 1 ? t("PLAYS_COUNT_ONE", { count }) : t("PLAYS_COUNT", { count });
}

function viewersLabel(count, t) {
  return Number(count) === 1 ? t("VIEWER_COUNT_ONE", { count }) : t("VIEWER_COUNT", { count });
}

function renderBlock(block, data, ctx = {}) {
  const t = ctx.t || identityT;
  const locale = ctx.locale || "en-GB";
  const title = defaultTitle(block, t);
  const sub = data.days ? periodLabel(data.days, t) : "";
  const style = block.options?.style || "list";
  const env = { ...ctx, t, locale, style, accent: ctx.accent };
  switch (block.type) {
    case "intro":
      return `${block.title ? `<h2 style="margin:18px 0 8px;color:${themeOf(env).heading};font-size:20px;">${escapeHtml(block.title)}</h2>` : ""}${textToHtml(block.options.text, env)}`;
    case "text":
      return `${titleHtml(block.title, env)}${textToHtml(block.options.text, env)}`;
    case "customHtml":
      return `${titleHtml(block.title, env)}<div>${block.options.html}</div>`;
    case "divider":
      return `<div style="border-top:1px solid ${themeOf(env).border};margin:22px 0;"></div>`;
    case "stats":
      return `${titleHtml(title, env, sub)}${statTiles(
        [
          [t("PLAYS"), Number(data.plays || 0).toLocaleString(locale), t("TITLES_COUNT", { count: Number(data.titles || 0) })],
          [t("WATCH_TIME"), formatWatchTime(data.seconds, locale), t("TOTAL_PLAYED")],
          [t("VIEWERS"), String(Number(data.viewers || 0)), t("WATCHED_SOMETHING")],
          [t("NEW"), String(Number(data.added || 0)), t("ITEMS_ADDED")],
        ],
        env
      )}`;
    case "recentlyAdded":
      return `${titleHtml(title, env)}${itemListOrCards(data.items, env, {
        kind: "item",
        empty: t("NO_NEW_MEDIA"),
        metaFor: (item) => [item.Type, item.ProductionYear, item.Library].filter(Boolean).join(" · "),
        render: (item) => `${wrapLink(`<strong>${escapeHtml(item.Name)}</strong>`, hrefFor(item, env, "item"), themeOf(env).heading)}${meta([item.Type, item.ProductionYear, item.Library], env)}`,
      })}`;
    case "topWatched":
      return `${titleHtml(title, env, sub)}${itemListOrCards(data.items, env, {
        kind: "item",
        empty: t("NO_WATCH_ACTIVITY_PERIOD"),
        metaFor: (item) => [playsLabel(item.Plays, t), formatWatchTime(item.WatchSeconds, locale), item.Viewers ? viewersLabel(item.Viewers, t) : ""].filter(Boolean).join(" · "),
        render: (item) =>
          `${wrapLink(`<strong>${escapeHtml(item.Name)}</strong>`, hrefFor(item, env, "item"), themeOf(env).heading)}${meta([playsLabel(item.Plays, t), formatWatchTime(item.WatchSeconds, locale), item.Viewers ? viewersLabel(item.Viewers, t) : ""], env)}`,
      })}`;
    case "activeUsers":
      return `${titleHtml(title, env, sub)}${listTable(
        data.items,
        (item) => `<strong>${escapeHtml(item.Name)}</strong>${meta([playsLabel(item.Plays, t), formatWatchTime(item.WatchSeconds, locale)], env)}`,
        t("NO_VIEWERS_PERIOD"),
        env
      )}`;
    case "topClients":
      return `${titleHtml(title, env, sub)}${barsHtml(data.items, env, { suffix: t("PLAYS_WORD") || "plays" })}`;
    case "playMethods":
      return `${titleHtml(title, env, sub)}${barsHtml(data.items, env, { suffix: t("PLAYS_WORD") || "plays" })}`;
    case "activityByDay":
      return `${titleHtml(title, env, sub)}${barsHtml(data.items, env, { suffix: t("PLAYS_WORD") || "plays" })}`;
    case "libraryOverview":
      return `${titleHtml(title, env)}${listTable(
        data.items,
        (item) => `<strong>${escapeHtml(item.Name)}</strong>${meta([t("ITEMS_COUNT", { count: Number(item.Items || 0).toLocaleString(locale) }), item.New ? t("NEW_COUNT", { count: item.New }) : ""], env)}`,
        t("NO_LIBRARIES"),
        env
      )}`;
    case "repairSummary":
      return `${titleHtml(title, env)}${statTiles(
        [
          [t("POSTERS"), String(Number(data.missingPosters || 0)), t("MISSING")],
          [t("LOGOS"), String(Number(data.missingLogos || 0)), t("MISSING")],
          [t("RUNTIME"), String(Number(data.missingRuntime || 0)), t("MISSING")],
        ],
        env
      )}`;
    case "continueWatching":
      return `${titleHtml(title, env)}${itemListOrCards(data.items, env, {
        kind: "item",
        empty: t("NOTHING_IN_PROGRESS"),
        metaFor: (item) => item.Type || "",
        render: (item) => `${wrapLink(`<strong>${escapeHtml(item.Name)}</strong>`, hrefFor(item, env, "item"), themeOf(env).heading)}${meta([item.Type], env)}`,
      })}`;
    case "myRequests":
      return `${titleHtml(title, env)}${itemListOrCards(data.items, env, {
        kind: "request",
        empty: t("NO_REQUESTS_GENERIC"),
        metaFor: (item) => [item.Type, item.status].filter(Boolean).join(" · "),
        render: (item) => `${wrapLink(`<strong>${escapeHtml(item.Name)}</strong>`, hrefFor(item, env, "request"), themeOf(env).heading)}${meta([item.Type, item.status], env)}`,
      })}`;
    case "forYou": {
      const pickMeta = (item) => {
        const genres = item.reasonGenres || [];
        const reason = genres.length ? t("YOU_WATCH_A_LOT", { genres: genres.join(" & ") }) : item.reason || item.when || "";
        return [item.Type || item.type, item.ProductionYear || item.year, reason].filter(Boolean).join(" · ");
      };
      const picks = `${titleHtml(title, env)}${itemListOrCards(data.picks || [], env, {
        kind: "item",
        empty: t("FOR_YOU_EMPTY"),
        metaFor: pickMeta,
        render: (item) => `${wrapLink(`<strong>${escapeHtml(item.Name || item.name)}</strong>`, hrefFor(item, env, "item"), themeOf(env).heading)}${meta([pickMeta(item)], env)}`,
      })}`;
      const because = (data.because || [])
        .map((row) => {
          const heading = t("BECAUSE_YOU_WATCHED", { title: row.seed?.name || row.seed?.Name || "" });
          return `${titleHtml(heading, env, t("BECAUSE_YOU_WATCHED_SUB"))}${itemListOrCards(row.items || [], env, {
            kind: "item",
            empty: t("FOR_YOU_EMPTY"),
            metaFor: (item) => [item.Type || item.type, item.ProductionYear || item.year].filter(Boolean).join(" · "),
            render: (item) => `${wrapLink(`<strong>${escapeHtml(item.Name || item.name)}</strong>`, hrefFor(item, env, "item"), themeOf(env).heading)}${meta([item.Type || item.type, item.ProductionYear || item.year], env)}`,
          })}`;
        })
        .join("");
      return `${picks}${because}`;
    }
    case "wrappedRecap": {
      const heading = title || t("WRAPPED");
      const periodText = wrappedHeading(data, t, locale) || wrappedCard.periodTitle(data);
      const busiest = data.busiestDay?.day ? formatDate(data.busiestDay.day, locale) : t("WRAPPED_EMPTY");
      const hoursValue = wrappedCard.hours(data.totals?.seconds);
      const hasActivity = Number(data.totals?.seconds || 0) > 0 || Number(data.totals?.plays || 0) > 0;
      if (!hasActivity) return `${titleHtml(heading, env, periodText)}${emptyHtml(t("WRAPPED_EMPTY"), env)}`;
      const tiles = statTiles(
        [
          [t("WRAPPED_HOURS"), String(hoursValue), t("TOTAL_PLAYED")],
          [t("PLAYS"), Number(data.totals?.plays || 0).toLocaleString(locale), t("WATCHED_SOMETHING")],
          [t("WRAPPED_BUSIEST"), busiest, data.busiestDay ? playsLabel(data.busiestDay.plays || 0, t) : ""],
        ],
        env
      );
      const shows = `${titleHtml(t("WRAPPED_TOP_SHOWS"), env)}${itemListOrCards(data.topShows || [], env, {
        kind: "item",
        empty: t("WRAPPED_EMPTY"),
        metaFor: (item) => [playsLabel(item.Plays || item.plays, t), formatWatchTime(item.WatchSeconds || item.seconds, locale)].filter(Boolean).join(" · "),
        render: (item) => `${wrapLink(`<strong>${escapeHtml(item.Name || item.name)}</strong>`, hrefFor(item, env, "item"), themeOf(env).heading)}${meta([playsLabel(item.Plays || item.plays, t), formatWatchTime(item.WatchSeconds || item.seconds, locale)], env)}`,
      })}`;
      const films = `${titleHtml(t("WRAPPED_TOP_FILMS"), env)}${itemListOrCards(data.topMovies || [], env, {
        kind: "item",
        empty: t("WRAPPED_EMPTY"),
        metaFor: (item) => [playsLabel(item.Plays || item.plays, t), formatWatchTime(item.WatchSeconds || item.seconds, locale)].filter(Boolean).join(" · "),
        render: (item) => `${wrapLink(`<strong>${escapeHtml(item.Name || item.name)}</strong>`, hrefFor(item, env, "item"), themeOf(env).heading)}${meta([playsLabel(item.Plays || item.plays, t), formatWatchTime(item.WatchSeconds || item.seconds, locale)], env)}`,
      })}`;
      return `${titleHtml(heading, env, periodText)}${tiles}${shows}${films}`;
    }
    case "leavingSoon":
      return `${titleHtml(title, env)}${itemListOrCards(data.items, env, {
        kind: "item",
        empty: t("LEAVING_EMPTY"),
        metaFor: (item) => [leavingLabel(item, t), item.source === "maintainerr" ? t("MAINTAINERR") : item.ruleName, item.Type, item.Library].filter(Boolean).join(" · "),
        render: (item) => `${wrapLink(`<strong>${escapeHtml(item.Name)}</strong>`, hrefFor(item, env, "item"), themeOf(env).heading)}${meta([leavingLabel(item, t), item.source === "maintainerr" ? t("MAINTAINERR") : item.ruleName, item.Type, item.Library], env)}`,
      })}`;
    case "fulfilledRequests":
      return `${titleHtml(title, env)}${itemListOrCards(data.items, env, {
        kind: "request",
        empty: t("FULFILLED_EMPTY"),
        metaFor: (item) => [item.Type, item.requestedBy, t("AVAILABLE")].filter(Boolean).join(" · "),
        render: (item) => `${wrapLink(`<strong>${escapeHtml(item.Name)}</strong>`, hrefFor(item, env, "request"), themeOf(env).heading)}${meta([item.Type, item.requestedBy, t("AVAILABLE")], env)}`,
      })}`;
    case "serverNews": {
      const kind = newsKindLabel(data.kind, t);
      const dates = newsDates(data, env.locale);
      const body = data.visible === false ? "" : textToHtml(data.text, env);
      const statusHref = data.statusEnabled ? publicUrl.statusPageHref(env.publicBase) : "";
      const statusLink = statusHref
        ? `<p style="margin:12px 0 0;font-size:14px;">${wrapLink(escapeHtml(t("STATUS_PAGE_LINK")), statusHref, themeOf(env).accent)}</p>`
        : "";
      if (!body && !statusLink) return `${titleHtml(title, env, kind)}${emptyHtml(t("NEWS_EMPTY"), env)}`;
      return `${titleHtml(title, env, kind)}${dates ? meta([dates], env) : ""}${body}${statusLink}`;
    }
    default:
      return "";
  }
}

function renderBlockText(block, data, ctx = {}) {
  const t = ctx.t || identityT;
  const locale = ctx.locale || "en-GB";
  const title = defaultTitle(block, t);
  const lines = title ? ["", title.toUpperCase()] : [""];
  switch (block.type) {
    case "intro":
    case "text":
      return [...lines, block.options.text];
    case "stats":
      return [...lines, `${t("PLAYS")}: ${data.plays || 0}`, `${t("WATCH_TIME")}: ${formatWatchTime(data.seconds, locale)}`, `${t("VIEWERS")}: ${data.viewers || 0}`, `${t("NEW")}: ${data.added || 0}`];
    case "repairSummary":
      return [...lines, `${t("POSTERS")}: ${data.missingPosters || 0}`, `${t("LOGOS")}: ${data.missingLogos || 0}`, `${t("RUNTIME")}: ${data.missingRuntime || 0}`];
    case "customHtml":
    case "divider":
      return [];
    case "wrappedRecap":
      return [
        ...lines,
        wrappedHeading(data, t, locale),
        `${t("WRAPPED_HOURS")}: ${wrappedCard.hours(data.totals?.seconds)}`,
        `${t("WRAPPED_BUSIEST")}: ${data.busiestDay?.day ? formatDate(data.busiestDay.day, locale) : t("WRAPPED_EMPTY")}`,
        t("WRAPPED_TOP_SHOWS"),
        ...((data.topShows || []).map((item) => `- ${item.Name || item.name}`)),
        t("WRAPPED_TOP_FILMS"),
        ...((data.topMovies || []).map((item) => `- ${item.Name || item.name}`)),
      ];
    case "forYou":
      return [
        ...lines,
        ...((data.picks || []).map((item) => `- ${item.Name || item.name}`)),
        ...((data.because || []).flatMap((row) => [`${t("BECAUSE_YOU_WATCHED", { title: row.seed?.name || "" })}`, ...(row.items || []).map((item) => `- ${item.Name || item.name}`)])),
      ];
    default:
      return [
        ...lines,
        ...(data.items || []).map((item) => {
          const href = block.type === "myRequests" ? hrefFor(item, ctx, "request") : hrefFor(item, ctx, "item");
          return `- ${item.Name}${item.Plays != null ? `: ${playsLabel(item.Plays, t)}` : ""}${item.Items != null ? `: ${t("ITEMS_COUNT", { count: item.Items })}` : ""}${item.Type ? ` (${item.Type})` : ""}${href ? ` ${href}` : ""}`;
        }),
      ];
  }
}

function textToHtml(value, ctx = {}) {
  const theme = themeOf(ctx);
  const text = String(value || "");
  if (!text.trim()) return "";
  return escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .split(/\n{2,}/)
    .map((paragraph) => `<p style="margin:0 0 10px;color:${theme.text};font-size:14px;line-height:1.6;">${paragraph.replace(/\n/g, "<br/>")}</p>`)
    .join("");
}

async function renderReport(input, { campaignName, logoSrc = "", personData = null, perUser = false, branding = {}, htmlBody = "", date, assetBase = "", publicBase = "", settings = {}, locale, lastSentAt = null } = {}) {
  const report = normalizeReport(input);
  const theme = newsletterTheme.normalizeBranding({
    ...branding,
    accent: branding.accent || branding.accentColor || report.accentColor,
    footer: branding.footer || report.footer || "",
  });
  const { t, locale: resolvedLocale } = newsletterI18n.translator(locale);
  const resolvedBase = publicUrl.resolvePublicBase({ assetBase, publicBase, settings });
  const accent = theme.accent;
  const context = { personData, lastSentAt, publicBase: resolvedBase, perUser, now: date || new Date() };
  const blocks = report.blocks.filter((block) => block.enabled && (perUser || !PER_USER_BLOCKS.has(block.type)));
  const renderCtx = { accent, theme, t, locale: resolvedLocale, publicBase: resolvedBase };
  const rendered = await Promise.all(
    blocks.map(async (block) => {
      const data = await blockData(block, report.periodDays, context);
      return { html: renderBlock(block, data, renderCtx), text: renderBlockText(block, data, renderCtx) };
    })
  );
  const subject = reportSubject(report, { campaignName, periodDays: report.periodDays, locale: resolvedLocale });
  const greeting = personData?.personName ? t("HI", { name: personData.personName }) : "";
  const covering = t("COVERING", { period: periodLabel(report.periodDays, t), date: formatDate(new Date(), resolvedLocale) });
  const inner = `${greeting ? `<p style="margin:14px 0 10px;color:${theme.text};font-size:15px;">${escapeHtml(greeting)}</p>` : ""}
            ${rendered.map((block) => block.html).join("\n") || emptyHtml(t("NO_BLOCKS"), { theme, accent })}`;
  const html = newsletterTheme.wrapEmailDocument({
    bodyHtml: inner,
    subject: escapeHtml(subject),
    campaignName: escapeHtml(campaignName || "JellyGlance report"),
    generatedAt: covering,
    logoSrc: report.showLogo ? (theme.logoUrl || logoSrc) : "",
    branding: theme,
    htmlBody,
    kickerColor: accent,
    date,
    assetBase: resolvedBase || assetBase,
  });
  const text = [subject, covering, greeting, ...rendered.flatMap((block) => block.text), "", report.footer]
    .filter((line) => line !== undefined)
    .join("\n")
    .trim();
  return { subject, html, text, generatedAt: new Date().toISOString(), publicBase: resolvedBase };
}

async function listReportLibraries() {
  return queryRows(`SELECT "Id" AS id, "Name" AS name, "CollectionType" AS type FROM jf_libraries ORDER BY "Name" ASC`, []);
}

module.exports = {
  REPORT_BLOCK_TYPES,
  PER_USER_BLOCKS,
  DEFAULT_REPORT,
  BLOCK_DEFAULT_TITLES,
  BLOCK_DEFAULT_TITLE_KEYS,
  normalizeReport,
  normalizeBlock,
  renderReport,
  renderBlock,
  renderBlockText,
  cardsHtml,
  listReportLibraries,
  periodLabel,
  formatDate,
  formatWatchTime,
};

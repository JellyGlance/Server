// Welcome, milestone, weekly admin, and 30-day re-engagement emails.
// Every send path is off by default and hard-stopped by JG_DISABLE_NOTIFICATIONS=1.
const { randomUUID } = require("crypto");
const db = require("../db");
const { sendConfiguredMail } = require("./smtp-mailer");
const newsletterI18n = require("./newsletter-i18n");
const newsletterTheme = require("./newsletter-theme");
const publicUrl = require("./newsletter-public-url");
const { notificationsDisabled } = require("./newsletter-channels");

const PLAY_MILESTONES = [100, 500, 1000];
const YEAR_MS = 365.25 * 24 * 60 * 60 * 1000;
const DEFAULT_INACTIVE_DAYS = 30;

function defaultAutomations() {
  return {
    welcome: { enabled: false },
    milestone: { enabled: false, playMarks: PLAY_MILESTONES.slice(), yearMarks: [1] },
    adminDigest: { enabled: false, weekday: 1, hour: 9 },
    reengagement: { enabled: false, inactiveDays: DEFAULT_INACTIVE_DAYS },
  };
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function asIntArray(value, fallback) {
  const list = Array.isArray(value) ? value : fallback;
  return [...new Set(list.map((item) => Number(item)).filter((item) => Number.isFinite(item) && item > 0))].sort((a, b) => a - b);
}

function normalizeAutomations(input = {}, current = {}) {
  const incoming = asObject(input);
  const previous = { ...defaultAutomations(), ...asObject(current) };
  const merge = (key, extra) => {
    const hasKey = Object.prototype.hasOwnProperty.call(incoming, key);
    const next = hasKey ? { ...asObject(previous[key]), ...asObject(incoming[key]) } : { ...asObject(previous[key]) };
    return { ...next, enabled: hasKey ? Boolean(asObject(incoming[key]).enabled) : Boolean(next.enabled), ...extra(next) };
  };
  return {
    welcome: merge("welcome", () => ({})),
    milestone: merge("milestone", (next) => ({
      playMarks: asIntArray(next.playMarks, PLAY_MILESTONES),
      yearMarks: asIntArray(next.yearMarks, [1]),
    })),
    adminDigest: merge("adminDigest", (next) => ({
      weekday: Math.min(6, Math.max(0, Number(next.weekday ?? 1))),
      hour: Math.min(23, Math.max(0, Number(next.hour ?? 9))),
    })),
    reengagement: merge("reengagement", (next) => ({
      inactiveDays: Math.min(365, Math.max(7, Number(next.inactiveDays || DEFAULT_INACTIVE_DAYS))),
    })),
  };
}

function publicAutomations(value = {}) {
  return normalizeAutomations(value, value);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatDate(value, locale = "en-GB") {
  if (!value) return "";
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric" }).format(new Date(value));
}

function ctaButton(label, href, theme) {
  const url = publicUrl.safeHttpUrl(href);
  if (!url || !label) return "";
  return `<p style="margin:22px 0 0;"><a href="${escapeHtml(url)}" style="display:inline-block;background:${theme.accent};color:#041016;text-decoration:none;font-weight:800;border-radius:12px;padding:12px 18px;">${escapeHtml(label)}</a></p>`;
}

function itemListHtml(items, env, theme) {
  if (!items.length) return "";
  const rows = items
    .map((item) => {
      const href = publicUrl.itemHref(env.base, item.Id || item.id);
      const name = escapeHtml(item.Name || item.name);
      const meta = escapeHtml([item.ProductionYear || item.year, item.Type || item.type].filter(Boolean).join(" · "));
      const title = href ? `<a href="${escapeHtml(href)}" style="color:${theme.heading};text-decoration:none;font-weight:700;">${name}</a>` : `<strong>${name}</strong>`;
      return `<tr><td style="padding:6px 0;border-bottom:1px solid ${theme.border};">${title}${meta ? ` <span style="color:${theme.muted};font-size:13px;">${meta}</span>` : ""}</td></tr>`;
    })
    .join("");
  return `<table width="100%" cellpadding="0" cellspacing="0" role="presentation">${rows}</table>`;
}

function wrapEmail({ subject, campaignName, kicker, heading, bodyHtml, locale, assetBase, generatedAt }) {
  const { t } = newsletterI18n.translator(locale);
  const theme = newsletterTheme.applySeasonalBranding({}, generatedAt || new Date(), { assetBase });
  const inner = `
    <div style="color:${theme.muted};font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:0.06em;">${escapeHtml(kicker)}</div>
    <h1 style="margin:8px 0 16px;color:${theme.heading};font-size:28px;line-height:1.15;">${escapeHtml(heading)}</h1>
    ${bodyHtml}
  `;
  return {
    subject,
    html: newsletterTheme.wrapEmailDocument({
      bodyHtml: inner,
      subject,
      campaignName,
      generatedAt: generatedAt || new Date().toISOString(),
      branding: {},
      assetBase,
    }),
    text: `${kicker}\n${heading}\n\n${String(bodyHtml || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()}`,
    t,
    theme,
  };
}

function yearsBetween(from, now = new Date()) {
  if (!from) return 0;
  return (new Date(now).getTime() - new Date(from).getTime()) / YEAR_MS;
}

function crossedPlayMilestone(previousPlays, currentPlays, marks = PLAY_MILESTONES) {
  return marks.filter((mark) => Number(previousPlays || 0) < mark && Number(currentPlays || 0) >= mark);
}

function crossedYearMilestone(firstPlay, marks = [1], now = new Date()) {
  const years = yearsBetween(firstPlay, now);
  return marks.filter((mark) => years >= mark);
}

function buildWelcomeEmail({ person = {}, items = [], locale, assetBase, base } = {}) {
  const { t, locale: resolved } = newsletterI18n.translator(locale);
  const theme = newsletterTheme.applySeasonalBranding({}, new Date(), { assetBase });
  const name = person.name || person.Name || t("FRIEND");
  const heading = t("WELCOME_TITLE", { name });
  const recentHeading = items.length ? `<h2 style="margin:22px 0 8px;color:${theme.heading};font-size:18px;">${escapeHtml(t("WELCOME_RECENT"))}</h2>${itemListHtml(items, { base }, theme)}` : "";
  const bodyHtml = `<p style="margin:0 0 12px;color:${theme.text};line-height:1.55;">${escapeHtml(t("WELCOME_BODY", { name }))}</p>${recentHeading}${ctaButton(t("WELCOME_CTA"), base, theme)}`;
  return wrapEmail({
    subject: t("WELCOME_SUBJECT", { name }),
    campaignName: t("WELCOME_KICKER"),
    kicker: t("WELCOME_KICKER"),
    heading,
    bodyHtml,
    locale: resolved,
    assetBase,
  });
}

function buildMilestoneEmail({ person = {}, kind = "plays", mark = 100, favourite = "", locale, assetBase, base } = {}) {
  const { t, locale: resolved } = newsletterI18n.translator(locale);
  const theme = newsletterTheme.applySeasonalBranding({}, new Date(), { assetBase });
  const name = person.name || person.Name || t("FRIEND");
  const isYear = kind === "year";
  const heading = isYear ? t("MILESTONE_YEAR_TITLE", { name, count: mark }) : t("MILESTONE_PLAYS_TITLE", { name, count: mark });
  const body = isYear ? t("MILESTONE_BODY_YEAR", { name, count: mark }) : t("MILESTONE_BODY_PLAYS", { name, count: mark, title: favourite || t("SOMETHING_NEW") });
  const bodyHtml = `<p style="margin:0 0 12px;color:${theme.text};line-height:1.55;">${escapeHtml(body)}</p>${ctaButton(t("MILESTONE_CTA"), base, theme)}`;
  return wrapEmail({
    subject: heading,
    campaignName: t("MILESTONE_KICKER"),
    kicker: t("MILESTONE_KICKER"),
    heading,
    bodyHtml,
    locale: resolved,
    assetBase,
  });
}

function buildReengagementEmail({ person = {}, items = [], inactiveDays = DEFAULT_INACTIVE_DAYS, lastWatched = "", locale, assetBase, base } = {}) {
  const { t, locale: resolved } = newsletterI18n.translator(locale);
  const theme = newsletterTheme.applySeasonalBranding({}, new Date(), { assetBase });
  const name = person.name || person.Name || t("FRIEND");
  const heading = t("REENGAGE_TITLE", { name });
  const recentHeading = items.length ? `<h2 style="margin:22px 0 8px;color:${theme.heading};font-size:18px;">${escapeHtml(t("REENGAGE_RECENT"))}</h2>${itemListHtml(items, { base }, theme)}` : "";
  const bodyHtml = `<p style="margin:0 0 12px;color:${theme.text};line-height:1.55;">${escapeHtml(t("REENGAGE_BODY", { name, days: inactiveDays, last: lastWatched || t("A_WHILE_AGO") }))}</p>${recentHeading}${ctaButton(t("REENGAGE_CTA"), base, theme)}`;
  return wrapEmail({
    subject: t("REENGAGE_SUBJECT", { name }),
    campaignName: t("REENGAGE_KICKER"),
    kicker: t("REENGAGE_KICKER"),
    heading,
    bodyHtml,
    locale: resolved,
    assetBase,
  });
}

function statRow(label, value, theme) {
  return `<tr><td style="padding:8px 0;color:${theme.muted};">${escapeHtml(label)}</td><td style="padding:8px 0;text-align:right;color:${theme.heading};font-weight:800;">${escapeHtml(value)}</td></tr>`;
}

function buildAdminDigestEmail({ stats = {}, items = [], locale, assetBase, base, periodLabel = "" } = {}) {
  const { t, locale: resolved } = newsletterI18n.translator(locale);
  const theme = newsletterTheme.applySeasonalBranding({}, new Date(), { assetBase });
  const heading = t("ADMIN_DIGEST_TITLE");
  const rows = [
    statRow(t("ADMIN_STORAGE"), stats.storageLabel || "—", theme),
    statRow(t("ADMIN_NEW_ITEMS"), String(stats.newItems ?? 0), theme),
    statRow(t("ADMIN_NEW_USERS"), String(stats.newUsers ?? 0), theme),
    statRow(t("ADMIN_REQUESTS"), String(stats.openRequests ?? 0), theme),
    statRow(t("ADMIN_REPAIR"), String(stats.missingPosters ?? 0), theme),
  ].join("");
  const recent = items.length ? `<h2 style="margin:22px 0 8px;color:${theme.heading};font-size:18px;">${escapeHtml(t("ADMIN_TOP_TITLES"))}</h2>${itemListHtml(items, { base }, theme)}` : "";
  const bodyHtml = `<p style="margin:0 0 12px;color:${theme.text};line-height:1.55;">${escapeHtml(t("ADMIN_DIGEST_BODY", { period: periodLabel || t("LAST_WEEK") }))}</p><table width="100%" cellpadding="0" cellspacing="0" role="presentation">${rows}</table>${recent}${ctaButton(t("ADMIN_DIGEST_CTA"), `${String(base || "").replace(/\/+$/, "")}/settings/newsletter`, theme)}`;
  return wrapEmail({
    subject: t("ADMIN_DIGEST_SUBJECT"),
    campaignName: t("ADMIN_DIGEST_KICKER"),
    kicker: t("ADMIN_DIGEST_KICKER"),
    heading,
    bodyHtml,
    locale: resolved,
    assetBase,
  });
}

async function query(sql, params = []) {
  try {
    const result = await db.query(sql, params);
    return result.rows || [];
  } catch {
    return [];
  }
}

async function recentlyAdded(limit = 6) {
  return query(
    `SELECT "Id", "Name", "Type", "ProductionYear", "PrimaryImageHash"
       FROM jf_library_items
      WHERE "Type" IN ('Movie', 'Series')
      ORDER BY "DateCreated" DESC NULLS LAST
      LIMIT $1`,
    [limit]
  );
}

async function userActivityRows() {
  return query(
    `SELECT u."Id" AS id, u."Name" AS name, u."IsAdministrator" AS is_admin,
            u."LastLoginDate" AS last_login, u."LastActivityDate" AS last_activity,
            COALESCE(stats.plays, 0)::int AS plays,
            stats.first_play, stats.last_play
       FROM jf_users u
  LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS plays,
               MIN(a."ActivityDateInserted") AS first_play,
               MAX(a."ActivityDateInserted") AS last_play
          FROM jf_playback_activity a
         WHERE a."UserId" = u."Id"
       ) stats ON true
   ORDER BY u."Name"`
  );
}

function formatBytes(bytes = 0) {
  const value = Number(bytes || 0);
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)));
  const sized = value / 1024 ** index;
  return `${sized >= 10 || index === 0 ? sized.toFixed(0) : sized.toFixed(1)} ${units[index]}`;
}

async function loadAdminStats(days = 7) {
  let storageLabel = "0 B";
  try {
    const extraBlocks = require("./newsletter-extra-blocks");
    const storage = await extraBlocks.listServerStats();
    storageLabel = storage.totalLabel || formatBytes(storage.totalBytes || 0);
  } catch {
    const [storage] = await query(
      `SELECT COALESCE(SUM(info."Size"), 0)::bigint AS bytes
         FROM jf_library_items i
         LEFT JOIN jf_item_info info ON info."Id" = i."Id"
        WHERE i.archived IS NOT TRUE`
    );
    storageLabel = formatBytes(storage?.bytes || 0);
  }
  const [added] = await query(
    `SELECT count(*)::int AS count FROM jf_library_items WHERE "DateCreated" >= now() - make_interval(days => $1)`,
    [days]
  );
  const [newUsers] = await query(
    `SELECT count(*)::int AS count
       FROM (
         SELECT a."UserId", MIN(a."ActivityDateInserted") AS first_play
           FROM jf_playback_activity a
          GROUP BY a."UserId"
       ) firsts
      WHERE firsts.first_play >= now() - make_interval(days => $1)`,
    [days]
  );
  const [repair] = await query(
    `SELECT count(*) FILTER (WHERE COALESCE("PrimaryImageHash", '') = '')::int AS missing
       FROM jf_library_items
      WHERE "Type" IN ('Movie', 'Series')`
  );
  const items = await query(
    `SELECT i."Id", i."Name", i."Type", i."ProductionYear", COUNT(*)::int AS plays
       FROM jf_playback_activity a
       JOIN jf_library_items i ON i."Id" = a."NowPlayingItemId"
      WHERE a."ActivityDateInserted" >= now() - make_interval(days => $1)
      GROUP BY i."Id", i."Name", i."Type", i."ProductionYear"
      ORDER BY COUNT(*) DESC
      LIMIT 6`,
    [days]
  );
  return {
    storageLabel,
    newItems: added?.count || 0,
    newUsers: newUsers?.count || 0,
    openRequests: 0,
    missingPosters: repair?.missing || 0,
    items,
  };
}

async function hasBeenSent(kind, userId, dedupeKey) {
  const rows = await query(
    `SELECT 1 FROM newsletter_automation_log WHERE kind=$1 AND COALESCE(user_id, '')=$2 AND dedupe_key=$3 LIMIT 1`,
    [kind, String(userId || ""), String(dedupeKey || "")]
  );
  return rows.length > 0;
}

async function recordSent(kind, userId, dedupeKey) {
  await query(
    `INSERT INTO newsletter_automation_log (id, kind, user_id, dedupe_key)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (kind, user_id, dedupe_key) DO NOTHING`,
    [randomUUID(), kind, String(userId || ""), String(dedupeKey || "")]
  );
}

function isoWeekKey(date = new Date()) {
  const stamp = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = stamp.getUTCDay() || 7;
  stamp.setUTCDate(stamp.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(stamp.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((stamp - yearStart) / 86400000 + 1) / 7);
  return `${stamp.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

async function previewAutomation(kind, options = {}) {
  const locale = options.locale;
  const assetBase = options.assetBase || options.base || "";
  const base = options.base || assetBase;
  const items = Array.isArray(options.items) ? options.items : await recentlyAdded(6);
  const users = Array.isArray(options.users) ? options.users : await userActivityRows();
  if (kind === "welcome") {
    const person = options.person || users[0] || { name: "Alex" };
    return { kind, person, ...buildWelcomeEmail({ person, items, locale, assetBase, base }) };
  }
  if (kind === "milestone") {
    const marks = asIntArray(options.playMarks, PLAY_MILESTONES);
    const person =
      options.person ||
      users.find((user) => marks.some((mark) => Number(user.plays || 0) >= mark)) ||
      users.find((user) => yearsBetween(user.first_play) >= 1) ||
      users[0] || { name: "Alex", plays: 100 };
    const playMark = marks.find((mark) => Number(person.plays || 0) >= mark) || marks[0] || 100;
    const yearDue = yearsBetween(person.first_play) >= 1;
    const useYear = options.forceYear || (!marks.some((mark) => Number(person.plays || 0) >= mark) && yearDue);
    const favourite = options.favourite || items[0]?.Name || "";
    return {
      kind: useYear ? "milestone-year" : "milestone-plays",
      person,
      mark: useYear ? 1 : playMark,
      ...buildMilestoneEmail({
        person,
        kind: useYear ? "year" : "plays",
        mark: useYear ? 1 : playMark,
        favourite,
        locale,
        assetBase,
        base,
      }),
    };
  }
  if (kind === "reengagement" || kind === "reengage") {
    const inactiveDays = Math.min(365, Math.max(7, Number(options.inactiveDays || DEFAULT_INACTIVE_DAYS)));
    const cutoff = Date.now() - inactiveDays * 24 * 60 * 60 * 1000;
    const person =
      options.person ||
      users.find((user) => {
        const last = user.last_play || user.last_activity;
        return last && new Date(last).getTime() < cutoff;
      }) ||
      users[0] || { name: "Alex" };
    const last = person.last_play || person.last_activity;
    return {
      kind: "reengagement",
      person,
      ...buildReengagementEmail({
        person,
        items,
        inactiveDays,
        lastWatched: last ? formatDate(last, options.locale) : "",
        locale,
        assetBase,
        base,
      }),
    };
  }
  const stats = options.stats || (await loadAdminStats(7));
  return {
    kind: "adminDigest",
    stats,
    ...buildAdminDigestEmail({
      stats,
      items: stats.items || items,
      locale,
      assetBase,
      base,
      periodLabel: options.periodLabel,
    }),
  };
}

async function deliverIfAllowed({ enabled, to, email, kind, userId, dedupeKey }) {
  if (notificationsDisabled()) return { skipped: "notifications-disabled" };
  if (!enabled) return { skipped: "automation-disabled" };
  if (!to) return { skipped: "no-recipient" };
  if (await hasBeenSent(kind, userId, dedupeKey)) return { skipped: "already-sent" };
  await sendConfiguredMail({ to, subject: email.subject, text: email.text, html: email.html });
  await recordSent(kind, userId, dedupeKey);
  return { ok: true, kind, userId };
}

async function runDueAutomations({ automations, directory = [], base, assetBase, locale, now = new Date() } = {}) {
  if (notificationsDisabled()) return { skipped: "notifications-disabled", results: [] };
  const settings = normalizeAutomations(automations);
  const emailById = new Map((directory || []).map((person) => [String(person.id || person.Id || ""), person]));
  const results = [];
  const users = await userActivityRows();
  const items = await recentlyAdded(6);

  if (settings.welcome.enabled) {
    const cutoff = now.getTime() - 14 * 24 * 60 * 60 * 1000;
    for (const user of users) {
      const first = user.first_play || user.last_login;
      if (!first || new Date(first).getTime() < cutoff) continue;
      const person = { ...user, ...(emailById.get(String(user.id)) || {}) };
      const email = buildWelcomeEmail({ person, items, locale: person.language || locale, assetBase, base });
      results.push(
        await deliverIfAllowed({
          enabled: true,
          to: person.email,
          email,
          kind: "welcome",
          userId: user.id,
          dedupeKey: "welcome",
        })
      );
    }
  }

  if (settings.milestone.enabled) {
    for (const user of users) {
      const person = { ...user, ...(emailById.get(String(user.id)) || {}) };
      const playHits = crossedPlayMilestone(0, user.plays, settings.milestone.playMarks);
      // Without a previous snapshot we only send a mark that is newly crossed
      // after we have a log row; first run records the current mark so we do
      // not backfill a flood of old milestones when the feature is turned on.
      for (const mark of playHits) {
        const already = await hasBeenSent("milestone", user.id, `plays:${mark}`);
        if (already) continue;
        if (Number(user.plays) === mark || optionsSendNow(user.plays, mark)) {
          const email = buildMilestoneEmail({
            person,
            kind: "plays",
            mark,
            favourite: items[0]?.Name || "",
            locale: person.language || locale,
            assetBase,
            base,
          });
          results.push(
            await deliverIfAllowed({
              enabled: true,
              to: person.email,
              email,
              kind: "milestone",
              userId: user.id,
              dedupeKey: `plays:${mark}`,
            })
          );
        } else {
          await recordSent("milestone", user.id, `plays:${mark}`);
        }
      }
      for (const mark of crossedYearMilestone(user.first_play, settings.milestone.yearMarks, now)) {
        const already = await hasBeenSent("milestone", user.id, `year:${mark}`);
        if (already) continue;
        const years = yearsBetween(user.first_play, now);
        if (years >= mark && years < mark + 14 / 365) {
          const email = buildMilestoneEmail({
            person,
            kind: "year",
            mark,
            locale: person.language || locale,
            assetBase,
            base,
          });
          results.push(
            await deliverIfAllowed({
              enabled: true,
              to: person.email,
              email,
              kind: "milestone",
              userId: user.id,
              dedupeKey: `year:${mark}`,
            })
          );
        } else {
          await recordSent("milestone", user.id, `year:${mark}`);
        }
      }
    }
  }

  if (settings.reengagement.enabled) {
    const inactiveDays = settings.reengagement.inactiveDays;
    const cutoff = now.getTime() - inactiveDays * 24 * 60 * 60 * 1000;
    const weekKey = isoWeekKey(now);
    for (const user of users) {
      const last = user.last_play || user.last_activity;
      if (!last || new Date(last).getTime() >= cutoff) continue;
      const person = { ...user, ...(emailById.get(String(user.id)) || {}) };
      const email = buildReengagementEmail({
        person,
        items,
        inactiveDays,
        lastWatched: formatDate(last, person.language || locale),
        locale: person.language || locale,
        assetBase,
        base,
      });
      results.push(
        await deliverIfAllowed({
          enabled: true,
          to: person.email,
          email,
          kind: "reengagement",
          userId: user.id,
          dedupeKey: `inactive:${weekKey}`,
        })
      );
    }
  }

  if (settings.adminDigest.enabled) {
    const weekday = Number(settings.adminDigest.weekday);
    const hour = Number(settings.adminDigest.hour);
    if (now.getDay() === weekday && now.getHours() >= hour) {
      const key = `week:${isoWeekKey(now)}`;
      const already = await hasBeenSent("admin-digest", "admins", key);
      if (!already) {
        const stats = await loadAdminStats(7);
        const email = buildAdminDigestEmail({ stats, items: stats.items, locale, assetBase, base });
        const admins = (directory || []).filter((person) => ["Admin", "Owner"].includes(person.role) && person.email);
        if (!admins.length) {
          results.push({ skipped: "no-recipient", kind: "admin-digest" });
        } else {
          results.push(
            await deliverIfAllowed({
              enabled: true,
              to: admins.map((person) => person.email),
              email,
              kind: "admin-digest",
              userId: "admins",
              dedupeKey: key,
            })
          );
        }
      }
    }
  }

  return { ok: true, results };
}

function optionsSendNow(plays, mark) {
  return Number(plays) >= mark && Number(plays) <= mark + 2;
}

module.exports = {
  PLAY_MILESTONES,
  DEFAULT_INACTIVE_DAYS,
  defaultAutomations,
  normalizeAutomations,
  publicAutomations,
  yearsBetween,
  crossedPlayMilestone,
  crossedYearMilestone,
  buildWelcomeEmail,
  buildMilestoneEmail,
  buildReengagementEmail,
  buildAdminDigestEmail,
  previewAutomation,
  runDueAutomations,
  isoWeekKey,
};

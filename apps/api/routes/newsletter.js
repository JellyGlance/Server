const express = require("express");
const nodemailer = require("nodemailer");
const fs = require("fs");
const path = require("path");
const db = require("../db");
const { axios } = require("../classes/axios");
const { addAuditEntry } = require("../classes/admin-history");
const campaigns = require("../classes/newsletter-campaigns");
const newsletterTheme = require("../classes/newsletter-theme");
const audience = require("../classes/newsletter-audience");
const newsletterI18n = require("../classes/newsletter-i18n");
const reportBuilder = require("../classes/newsletter-report-builder");
const { encryptSecret, getIntegrations } = require("../classes/integration-store");
const { isValidEmail } = require("../utils/security");
const { decryptPassword, upgradeLegacyPassword } = require("../classes/smtp-mailer");
const { fetchJellyfinUserItems, normalizeJellyfinMediaItem } = require("../classes/watch-tonight");
const newsletterChannels = require("../classes/newsletter-channels");
const newsletterAutomations = require("../classes/newsletter-automations");
const newsletterArchive = require("../classes/newsletter-archive");
const publicUrl = require("../classes/newsletter-public-url");
const extraBlocks = require("../classes/newsletter-extra-blocks");

const router = express.Router();
const HISTORY_LIMIT = 50;
const SETTINGS_KEY = "Newsletter";
const logoPath = path.join(__dirname, "..", "..", "web", "src", "pages", "images", "icon-b-512.png");


async function getSettings() {
  const { rows } = await db.query('SELECT settings FROM app_config where "ID"=1');
  return rows[0]?.settings || {};
}

async function saveSettings(settings) {
  await db.query('UPDATE app_config SET settings=$1 where "ID"=1', [settings]);
}

function defaultNewsletterSettings() {
  return {
    enabled: false,
    senderName: "JellyGlance",
    senderEmail: "",
    recipients: [],
    frequency: "manual",
    smtp: {
      host: "",
      port: 587,
      secure: false,
      username: "",
      password: "",
      rejectUnauthorized: true,
    },
    history: [],
    channels: newsletterChannels.defaultChannels(),
    automations: newsletterAutomations.defaultAutomations(),
    archive: newsletterArchive.defaultArchive(),
  };
}

function publicSettings(settings) {
  const newsletter = {
    ...defaultNewsletterSettings(),
    ...(settings[SETTINGS_KEY] || {}),
    smtp: {
      ...defaultNewsletterSettings().smtp,
      ...((settings[SETTINGS_KEY] || {}).smtp || {}),
    },
  };

  return {
    ...newsletter,
    smtp: {
      ...newsletter.smtp,
      password: "",
      hasPassword: Boolean(newsletter.smtp.password),
    },
    channels: newsletterChannels.publicChannels(newsletter.channels),
    automations: newsletterAutomations.publicAutomations(newsletter.automations),
    archive: newsletterArchive.publicArchive(newsletter.archive),
  };
}

function normalizeRecipients(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || "").trim()).filter(Boolean);
  }
  return String(value || "")
    .split(/[\n,;]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function validateEmail(value) {
  return isValidEmail(value);
}

function mergeNewsletterSettings(existingSettings, incoming) {
  const current = {
    ...defaultNewsletterSettings(),
    ...(existingSettings[SETTINGS_KEY] || {}),
    smtp: {
      ...defaultNewsletterSettings().smtp,
      ...((existingSettings[SETTINGS_KEY] || {}).smtp || {}),
    },
  };

  const nextPassword =
    incoming.smtp?.password && String(incoming.smtp.password).trim()
      ? encryptSecret(String(incoming.smtp.password))
      : upgradeLegacyPassword(current.smtp.password);

  return {
    ...current,
    enabled: Boolean(incoming.enabled),
    senderName: String(incoming.senderName || "JellyGlance").trim(),
    senderEmail: String(incoming.senderEmail || "").trim(),
    recipients: normalizeRecipients(incoming.recipients),
    frequency: ["manual", "weekly", "monthly"].includes(incoming.frequency) ? incoming.frequency : "manual",
    smtp: {
      host: String(incoming.smtp?.host || "").trim(),
      port: Number(incoming.smtp?.port || 587),
      secure: Boolean(incoming.smtp?.secure),
      username: String(incoming.smtp?.username || "").trim(),
      password: nextPassword,
      rejectUnauthorized: incoming.smtp?.rejectUnauthorized !== false,
    },
    history: Array.isArray(current.history) ? current.history.slice(0, HISTORY_LIMIT) : [],
    channels: newsletterChannels.normalizeChannels(
      incoming.channels !== undefined ? incoming.channels : current.channels,
      current.channels
    ),
    automations: newsletterAutomations.normalizeAutomations(
      incoming.automations !== undefined ? incoming.automations : current.automations,
      current.automations
    ),
    archive: newsletterArchive.normalizeArchive(
      incoming.archive !== undefined ? incoming.archive : current.archive,
      current.archive
    ),
  };
}

function validateSmtpSettings(newsletter) {
  if (!newsletter.smtp.host) return "SMTP host is required";
  if (!newsletter.smtp.port || Number(newsletter.smtp.port) <= 0) return "SMTP port is required";
  if (!newsletter.senderEmail || !validateEmail(newsletter.senderEmail)) return "A valid sender email is required";
  if (!decryptPassword(newsletter.smtp.password) && newsletter.smtp.username) return "SMTP password is required when a username is set";
  return "";
}

function createTransport(newsletter) {
  // JG_DISABLE_NOTIFICATIONS=1 turns every outgoing email off (scheduled and manual).
  if (process.env.JG_DISABLE_NOTIFICATIONS === "1") throw new Error("Email is turned off on this server (JG_DISABLE_NOTIFICATIONS=1)");
  return nodemailer.createTransport({
    host: newsletter.smtp.host,
    port: Number(newsletter.smtp.port || 587),
    secure: Boolean(newsletter.smtp.secure),
    auth: newsletter.smtp.username
      ? {
          user: newsletter.smtp.username,
          pass: decryptPassword(newsletter.smtp.password),
        }
      : undefined,
    tls: {
      rejectUnauthorized: newsletter.smtp.rejectUnauthorized !== false,
    },
  });
}

function formatDate(value) {
  if (!value) return "Unknown";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function cleanUrl(url = "") {
  return String(url || "").trim().replace(/\/+$/, "");
}

function formatWatchTime(seconds) {
  const hours = Math.round(Number(seconds || 0) / 3600);
  if (hours >= 1) return `${hours.toLocaleString()}h`;
  const minutes = Math.round(Number(seconds || 0) / 60);
  return `${minutes.toLocaleString()}m`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function getLogoDataUri() {
  try {
    const logo = fs.readFileSync(logoPath);
    return `data:image/png;base64,${logo.toString("base64")}`;
  } catch {
    return "";
  }
}

async function buildNewsletterData() {
  const [recentlyAdded, topWatched, activeUsers, libraryIssues, repairHub] = await Promise.all([
    db.query(`
      SELECT "Id", "Name", "Type", "ProductionYear", "DateCreated"
      FROM jf_library_items
      WHERE archived = false
      ORDER BY "DateCreated" DESC NULLS LAST
      LIMIT 8
    `),
    db.query(`
      SELECT
        COALESCE(NULLIF("SeriesName", ''), NULLIF("NowPlayingItemName", ''), 'Unknown item') AS "Name",
        count(*)::int AS "Plays",
        COALESCE(sum("PlaybackDuration"), 0)::bigint AS "WatchSeconds"
      FROM jf_playback_activity
      WHERE "ActivityDateInserted" >= now() - interval '7 days'
      GROUP BY COALESCE(NULLIF("SeriesName", ''), NULLIF("NowPlayingItemName", ''), 'Unknown item')
      ORDER BY count(*) DESC, COALESCE(sum("PlaybackDuration"), 0) DESC
      LIMIT 6
    `),
    db.query(`
      SELECT
        COALESCE(NULLIF("UserName", ''), 'Unknown user') AS "Name",
        count(*)::int AS "Plays",
        COALESCE(sum("PlaybackDuration"), 0)::bigint AS "WatchSeconds"
      FROM jf_playback_activity
      WHERE "ActivityDateInserted" >= now() - interval '7 days'
      GROUP BY COALESCE(NULLIF("UserName", ''), 'Unknown user')
      ORDER BY count(*) DESC, COALESCE(sum("PlaybackDuration"), 0) DESC
      LIMIT 5
    `),
    db.query(`
      SELECT
        count(*) FILTER (WHERE COALESCE("PrimaryImageHash", '') = '')::int AS "MissingPosters",
        count(*) FILTER (WHERE COALESCE("ImageTagsLogo", '') = '')::int AS "MissingLogos",
        count(*) FILTER (WHERE COALESCE("RunTimeTicks", 0) = 0)::int AS "MissingRuntime"
      FROM jf_library_items
      WHERE archived = false
    `),
    db.query(`
      SELECT count(*)::int AS "UnmatchedImports"
      FROM jf_playback_activity
      WHERE imported = true
        AND "Id" LIKE 'tautulli:%'
        AND "NowPlayingItemId" LIKE 'tautulli:%'
    `),
  ]);

  const issues = libraryIssues.rows[0] || {};
  const repair = repairHub.rows[0] || {};
  return {
    generatedAt: new Date().toISOString(),
    subject: `JellyGlance weekly digest - ${formatDate(new Date())}`,
    recentlyAdded: recentlyAdded.rows,
    topWatched: topWatched.rows,
    activeUsers: activeUsers.rows,
    repairSummary: {
      missingPosters: Number(issues.MissingPosters || 0),
      missingLogos: Number(issues.MissingLogos || 0),
      missingRuntime: Number(issues.MissingRuntime || 0),
      unmatchedImports: Number(repair.UnmatchedImports || 0),
    },
  };
}

async function fetchUserSeerrRequests(userName) {
  const integrations = await getIntegrations().catch(() => ({ arrApps: [] }));
  const seerrApps = (integrations.arrApps || []).filter((app) => {
    const name = String(app.name || app.slug || "").toLowerCase();
    return app.connected && (name.includes("jellyseerr") || name.includes("overseerr") || name === "seerr");
  });
  const needle = String(userName || "").toLowerCase();
  const requests = [];
  for (const app of seerrApps) {
    try {
      const response = await axios.get(`${cleanUrl(app.values.url)}/api/v1/request`, {
        timeout: 12000,
        headers: { "X-Api-Key": app.values.secret },
        params: { take: 40, skip: 0, sort: "added" },
      });
      const rows = response.data?.results || response.data || [];
      for (const row of Array.isArray(rows) ? rows : []) {
        const requestedBy = row.requestedBy?.displayName || row.requestedBy?.jellyfinUsername || row.user?.jellyfinUsername || "";
        if (needle && !String(requestedBy).toLowerCase().includes(needle)) continue;
        const media = row.media || {};
        requests.push({
          Name: media.title || media.name || row.title || "Request",
          Type: media.mediaType || row.type || "Request",
          status: row.status,
          Id: row.id || media.jellyfinId || media.tmdbId || "",
          requestId: row.id,
          mediaId: media.jellyfinId || media.mediaId || "",
        });
      }
    } catch {
      // Skip this Seerr instance and keep building the digest.
    }
  }
  return requests.slice(0, 8);
}

async function buildUserNewsletterData(person) {
  const [continueItems, recentItems, requests] = await Promise.all([
    fetchJellyfinUserItems(person.userId, {
      Filters: "IsResumable",
      IncludeItemTypes: "Movie,Episode",
      SortBy: "DatePlayed",
      SortOrder: "Descending",
      Limit: 8,
    }).catch(() => []),
    fetchJellyfinUserItems(person.userId, {
      SortBy: "DateCreated",
      SortOrder: "Descending",
      IncludeItemTypes: "Movie,Series,Episode",
      Limit: 8,
    }).catch(() => []),
    fetchUserSeerrRequests(person.name).catch(() => []),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    subject: `Your JellyGlance digest - ${formatDate(new Date())}`,
    perUser: true,
    personName: person.name,
    userId: person.userId || "",
    continueWatching: continueItems.map(normalizeJellyfinMediaItem).map((item) => ({
      Name: item.seriesName || item.name,
      Type: item.type,
      Id: item.imageId || item.seriesId || item.id,
      ItemId: item.id,
      PrimaryImageHash: item.primaryImageHash || "",
    })),
    myRequests: requests,
    recentlyAdded: recentItems.map(normalizeJellyfinMediaItem).map((item) => ({
      Name: item.seriesName || item.name,
      Type: item.type,
      Id: item.imageId || item.seriesId || item.id,
      ItemId: item.id,
      PrimaryImageHash: item.primaryImageHash || "",
    })),
    topWatched: [],
    activeUsers: [],
    repairSummary: { missingPosters: 0, missingLogos: 0, missingRuntime: 0, unmatchedImports: 0 },
  };
}

function listHtml(items, rowBuilder, emptyText) {
  if (!items.length) return `<p style="color:#8fa3bd;margin:0;font-size:14px;">${emptyText}</p>`;
  return `<div>${items.map(rowBuilder).join("")}</div>`;
}

function publicAssetBase(req) {
  const host = req?.get?.("x-forwarded-host") || req?.get?.("host") || req?.headers?.host;
  if (!host) return "";
  const proto = req?.get?.("x-forwarded-proto") || req?.protocol || "http";
  return `${proto}://${host}`;
}

function templateRenderOptions(campaign, extras = {}) {
  const template = extras.template || campaign?.template || {};
  return {
    branding: extras.branding || template.branding || {},
    htmlBody: extras.htmlBody != null ? extras.htmlBody : template.htmlBody || "",
    lastSentAt: extras.lastSentAt != null ? extras.lastSentAt : campaign?.lastSentAt || campaign?.last_sent_at || null,
    settings: extras.settings,
    publicBase: extras.publicBase,
    ...extras,
  };
}

function buildNewsletterHtml(data, options = {}) {
  const perUser = Boolean(data.perUser || options.perUser);
  const sections = perUser
    ? { continueWatching: true, myRequests: true, recentlyAdded: true, ...(options.sections || {}) }
    : { recentlyAdded: true, topWatched: true, activeUsers: true, repairSummary: true, ...(options.sections || {}) };
  const branding = newsletterTheme.normalizeBranding(options.branding || {});
  const logoSrc = branding.logoUrl || options.logoSrc || getLogoDataUri();
  const { t, locale } = newsletterI18n.translator(options.locale);
  data.locale = locale;
  const repairSummary = data.repairSummary || {};
  const totalRepairIssues =
    Number(repairSummary.missingPosters || 0) +
    Number(repairSummary.missingLogos || 0) +
    Number(repairSummary.missingRuntime || 0) +
    Number(repairSummary.unmatchedImports || 0);
  const topWatched = data.topWatched || [];
  const totalPlays = topWatched.reduce((total, item) => total + Number(item.Plays || 0), 0);
  const totalWatchSeconds = topWatched.reduce((total, item) => total + Number(item.WatchSeconds || 0), 0);
  const metricBox = (label, value, detail, color = branding.accent) => `
    <td style="width:25%;padding:6px;">
      <div style="background:${branding.card};border:1px solid ${branding.border};border-radius:14px;padding:14px;min-height:86px;">
        <div style="color:${branding.muted};font-size:11px;font-weight:800;text-transform:uppercase;">${label}</div>
        <div style="color:${color};font-size:26px;font-weight:900;line-height:1.1;margin:6px 0 3px;">${value}</div>
        <div style="color:${branding.muted};font-size:12px;">${detail}</div>
      </div>
    </td>
  `;
  const sectionTitle = (title) => `<h2 style="color:${branding.heading};font-size:16px;margin:24px 0 10px;font-family:${branding.font};">${title}</h2>`;
  const recentlyAddedHtml = sections.recentlyAdded
    ? `${sectionTitle(t("RECENTLY_ADDED"))}${listHtml(
        data.recentlyAdded || [],
        (item) =>
          `<div style="padding:8px 0;border-bottom:1px solid #243246;color:#d7e2f2;font-size:14px;"><strong>${escapeHtml(item.Name)}</strong> <span style="color:#8fa3bd;">${escapeHtml([item.Type, item.ProductionYear, item.status].filter(Boolean).join(" · "))}</span></div>`,
        t("NO_NEW_MEDIA")
      )}`
    : "";
  const continueWatchingHtml =
    perUser && sections.continueWatching
      ? `${sectionTitle(t("CONTINUE_WATCHING"))}${listHtml(
          data.continueWatching || [],
          (item) =>
            `<div style="padding:8px 0;border-bottom:1px solid #243246;color:#d7e2f2;font-size:14px;"><strong>${escapeHtml(item.Name)}</strong> <span style="color:#8fa3bd;">${escapeHtml(item.Type || "")}</span></div>`,
          t("NOTHING_IN_PROGRESS")
        )}`
      : "";
  const myRequestsHtml =
    perUser && sections.myRequests
      ? `${sectionTitle(t("MY_REQUESTS"))}${listHtml(
          data.myRequests || [],
          (item) =>
            `<div style="padding:8px 0;border-bottom:1px solid #243246;color:#d7e2f2;font-size:14px;"><strong>${escapeHtml(item.Name)}</strong> <span style="color:#8fa3bd;">${escapeHtml([item.Type, item.status].filter(Boolean).join(" · "))}</span></div>`,
          t("NO_REQUESTS")
        )}`
      : "";
  const topWatchedHtml =
    !perUser && sections.topWatched
      ? `${sectionTitle(t("TOP_WATCHED"))}${listHtml(
          topWatched,
          (item) =>
            `<div style="padding:8px 0;border-bottom:1px solid #243246;color:#d7e2f2;font-size:14px;"><strong>${escapeHtml(item.Name)}</strong> <span style="color:#8fa3bd;">${item.Plays} plays · ${formatWatchTime(item.WatchSeconds)}</span></div>`,
          t("NO_WATCH_ACTIVITY")
        )}`
      : "";
  const activeUsersHtml =
    !perUser && sections.activeUsers
      ? `${sectionTitle(t("ACTIVE_VIEWERS"))}${listHtml(
          data.activeUsers || [],
          (item) =>
            `<div style="padding:8px 0;border-bottom:1px solid #243246;color:#d7e2f2;font-size:14px;"><strong>${escapeHtml(item.Name)}</strong> <span style="color:#8fa3bd;">${item.Plays} plays · ${formatWatchTime(item.WatchSeconds)}</span></div>`,
          t("NO_ACTIVE_VIEWERS")
        )}`
      : "";
  const repairHtml =
    !perUser && sections.repairSummary
      ? `${sectionTitle(t("REPAIR"))}<p style="color:#9fb0c7;font-size:14px;margin:0;">${t("MISSING_LINE", { posters: repairSummary.missingPosters || 0, logos: repairSummary.missingLogos || 0, runtime: repairSummary.missingRuntime || 0, unmatched: repairSummary.unmatchedImports || 0 })}</p>`
      : "";
  const customHtml = sections.customHtml ? `<div style="margin-top:20px;">${sections.customHtml}</div>` : "";
  const metricRow = perUser
    ? `${metricBox(t("CONTINUE"), String((data.continueWatching || []).length), t("IN_PROGRESS"))}
       ${metricBox(t("REQUESTS"), String((data.myRequests || []).length), t("SEERR_QUEUE"), "#a78bfa")}
       ${metricBox(t("NEW"), String((data.recentlyAdded || []).length), t("RECENTLY_ADDED_SHORT"), "#34d399")}
       ${metricBox(t("FOR"), escapeHtml(data.personName || t("YOU")), t("PERSONAL_DIGEST"), "#fbbf24")}`
    : `${metricBox(t("PLAYS"), totalPlays.toLocaleString(), t("TOP_TITLES"))}
       ${metricBox(t("WATCH"), formatWatchTime(totalWatchSeconds), t("ACROSS_TITLES"), "#a78bfa")}
       ${metricBox(t("NEW"), String((data.recentlyAdded || []).length), t("RECENTLY_ADDED_ITEMS"), "#34d399")}
       ${metricBox(t("REPAIR_METRIC"), String(totalRepairIssues), t("OPEN_ISSUES"), "#fbbf24")}`;
  const bodyHtml = perUser
    ? `${continueWatchingHtml}${myRequestsHtml}${recentlyAddedHtml}${customHtml}`
    : `${recentlyAddedHtml}${topWatchedHtml}${activeUsersHtml}${repairHtml}${customHtml}`;

  return newsletterTheme.wrapEmailDocument({
    bodyHtml,
    metricHtml: `<table width="100%" cellpadding="0" cellspacing="0"><tr>${metricRow}</tr></table>`,
    subject: escapeHtml(data.subject),
    campaignName: escapeHtml(options.campaignName || t("DEFAULT_CAMPAIGN")),
    generatedAt: t("GENERATED", { date: escapeHtml(formatDate(data.generatedAt)) }),
    logoSrc,
    branding,
    htmlBody: options.htmlBody || "",
    date: options.date,
    assetBase: options.assetBase || "",
  });
}

function buildNewsletterText(data) {
  if (data.perUser) {
    return [
      `JellyGlance digest for ${data.personName || "you"}`,
      `Generated ${formatDate(data.generatedAt)}`,
      "",
      "Continue Watching",
      ...((data.continueWatching || []).map((item) => `- ${item.Name} (${item.Type || "Media"})`) || ["- Nothing in progress."]),
      "",
      "My Requests",
      ...((data.myRequests || []).map((item) => `- ${item.Name} (${[item.Type, item.status].filter(Boolean).join(", ") || "Request"})`) || ["- No requests."]),
      "",
      "Recently Added",
      ...((data.recentlyAdded || []).map((item) => `- ${item.Name} (${item.Type || "Media"})`) || ["- No new media."]),
    ].join("\n");
  }
  const lines = [
    "JellyGlance Newsletter",
    `Generated ${formatDate(data.generatedAt)}`,
    "",
    "Recently Added",
    ...(data.recentlyAdded || []).map((item) => `- ${item.Name} (${[item.Type, item.ProductionYear].filter(Boolean).join(", ") || "Media"})`),
    "",
    "Most Watched This Week",
    ...(data.topWatched || []).map((item) => `- ${item.Name}: ${item.Plays} plays, ${formatWatchTime(item.WatchSeconds)}`),
    "",
    "Active Viewers",
    ...(data.activeUsers || []).map((item) => `- ${item.Name}: ${item.Plays} plays, ${formatWatchTime(item.WatchSeconds)}`),
    "",
    "Repair Snapshot",
    `Missing posters: ${data.repairSummary?.missingPosters || 0}`,
    `Missing logos: ${data.repairSummary?.missingLogos || 0}`,
    `Runtime gaps: ${data.repairSummary?.missingRuntime || 0}`,
    `Unmatched imports: ${data.repairSummary?.unmatchedImports || 0}`,
  ];
  return lines.join("\n");
}

async function addNewsletterHistory(req, entry) {
  const settings = await getSettings();
  const newsletter = settings[SETTINGS_KEY] || defaultNewsletterSettings();
  const history = Array.isArray(newsletter.history) ? newsletter.history : [];
  settings[SETTINGS_KEY] = {
    ...newsletter,
    history: [{ ...entry, timestamp: new Date().toISOString() }, ...history].slice(0, HISTORY_LIMIT),
  };
  await saveSettings(settings);
  await addAuditEntry(req, entry.ok ? "newsletter.sent" : "newsletter.failed", {
    recipients: entry.recipientCount,
    mode: entry.mode,
    error: entry.error || null,
  });
}

async function sendNewsletter(req, recipients, mode, options = {}) {
  const settings = await getSettings();
  const newsletter = {
    ...defaultNewsletterSettings(),
    ...(settings[SETTINGS_KEY] || {}),
    smtp: {
      ...defaultNewsletterSettings().smtp,
      ...((settings[SETTINGS_KEY] || {}).smtp || {}),
    },
  };
  const validationError = validateSmtpSettings(newsletter);
  if (validationError) {
    const error = new Error(validationError);
    error.statusCode = 400;
    throw error;
  }

  let campaign = null;
  if (options.campaignId) {
    campaign = await campaigns.getCampaign(options.campaignId);
    if (!campaign) {
      const error = new Error("Campaign not found");
      error.statusCode = 404;
      throw error;
    }
  }

  const overrideRecipients = normalizeRecipients(recipients);
  const isPerUser = campaign?.type === "per-user";
  const attachments = fs.existsSync(logoPath)
    ? [
        {
          filename: "jellyglance-logo.png",
          path: logoPath,
          cid: "jellyglance-logo",
        },
      ]
    : [];
  const transporter = createTransport(newsletter);
  const from = `"${newsletter.senderName || "JellyGlance"}" <${newsletter.senderEmail}>`;

  if (isPerUser) {
    const people = await campaigns.resolvePerUserCampaignRecipients(campaign);
    const deliveries = overrideRecipients.length
      ? [{ person: people[0] || { userId: "", name: "Viewer" }, emails: overrideRecipients }]
      : people.map((person) => ({ person, emails: [person.email] }));
    if (!deliveries.length) {
      const error = new Error("No opted-in per-user recipients with an email address");
      error.statusCode = 400;
      throw error;
    }

    const sections = {
      ...campaigns.PER_USER_SECTIONS,
      ...(campaign.sections || {}),
      ...(campaign.template?.blocks || {}),
    };
    let sent = 0;
    let lastMessageId = null;
    let lastHtml = "";
    let lastText = "";
    let lastSubject = campaign.name ? `${campaign.name} - ${formatDate(new Date())}` : "";
    const errors = [];
    for (const delivery of deliveries) {
      try {
        const data = delivery.person.userId
          ? await buildUserNewsletterData(delivery.person)
          : {
              generatedAt: new Date().toISOString(),
              subject: lastSubject || `Your JellyGlance digest - ${formatDate(new Date())}`,
              perUser: true,
              personName: delivery.person.name,
              userId: delivery.person.userId || "",
              continueWatching: [],
              myRequests: [],
              recentlyAdded: [],
              topWatched: [],
              activeUsers: [],
              repairSummary: { missingPosters: 0, missingLogos: 0, missingRuntime: 0, unmatchedImports: 0 },
            };
        if (campaign.name) data.subject = `${campaign.name} - ${formatDate(new Date())}`;
        const built = reportEnabled(campaign)
          ? await reportBuilder.renderReport(campaign.sections.report, {
              campaignName: campaign.name,
              logoSrc: "cid:jellyglance-logo",
              personData: data,
              perUser: true,
              ...templateRenderOptions(campaign, { assetBase: publicAssetBase(req), settings: await getSettings().catch(() => ({})) }),
              locale: newsletterI18n.localeForRecipient(delivery.person),
            })
          : null;
        if (built) data.subject = built.subject;
        lastSubject = data.subject;
        const result = await transporter.sendMail({
          from,
          to: delivery.emails,
          subject: data.subject,
          text: built ? built.text : buildNewsletterText(data),
          html: built
            ? built.html
            : buildNewsletterHtml(data, {
                logoSrc: "cid:jellyglance-logo",
                campaignName: campaign.name,
                sections,
                perUser: true,
                ...templateRenderOptions(campaign),
                locale: newsletterI18n.localeForRecipient(delivery.person),
              }),
          attachments,
        });
        lastMessageId = result.messageId;
        lastHtml = built ? built.html : "";
        lastText = built ? built.text : buildNewsletterText(data);
        sent += delivery.emails.length;
      } catch (error) {
        errors.push(error.message);
      }
    }
    if (!sent) {
      const error = new Error(errors[0] || "Unable to send per-user newsletter");
      error.statusCode = 503;
      throw error;
    }
    await addNewsletterHistory(req, {
      ok: true,
      mode,
      subject: lastSubject,
      recipientCount: sent,
      messageId: lastMessageId,
    });
    await campaigns.addHistoryEntry({
      campaignId: campaign.id,
      recipientCount: sent,
      status: "ok",
      mode,
      subject: lastSubject,
      meta: { messageId: lastMessageId, perUser: true, errors },
    });
    await afterSuccessfulSend({ req, campaign, subject: lastSubject, html: lastHtml, text: lastText, newsletter });
    return { ok: true, messageId: lastMessageId, recipientCount: sent, subject: lastSubject, campaignId: campaign.id };
  }

  const targets = overrideRecipients.length
    ? overrideRecipients
    : campaign
      ? await campaigns.resolveCampaignRecipients(campaign)
      : newsletter.recipients;
  if (!targets.length || targets.some((email) => !validateEmail(email))) {
    const error = new Error("At least one valid recipient is required");
    error.statusCode = 400;
    throw error;
  }

  const data = await buildNewsletterData();
  if (campaign?.name) {
    data.subject = `${campaign.name} - ${formatDate(new Date())}`;
  }
  const sections = {
    ...campaigns.DEFAULT_SECTIONS,
    ...(campaign?.sections || {}),
    ...(campaign?.template?.blocks || {}),
  };
  const reportOptions = templateRenderOptions(campaign, { assetBase: publicAssetBase(req), settings: await getSettings().catch(() => ({})) });
  const builtDefault = reportEnabled(campaign)
    ? await reportBuilder.renderReport(campaign.sections.report, { campaignName: campaign.name, logoSrc: "cid:jellyglance-logo", ...reportOptions, locale: newsletterI18n.FALLBACK_LOCALE })
    : null;
  if (builtDefault) data.subject = builtDefault.subject;
  const directory = await campaigns.listAudienceDirectory().catch(() => []);
  const directoryByEmail = new Map(directory.filter((user) => user.email).map((user) => [user.email, user]));
  let result = { messageId: null };
  let lastHtml = "";
  let lastText = "";
  for (const email of targets) {
    const locale = newsletterI18n.localeForRecipient(directoryByEmail.get(email) || { email });
    const built = reportEnabled(campaign)
      ? await reportBuilder.renderReport(campaign.sections.report, {
          campaignName: campaign.name,
          logoSrc: "cid:jellyglance-logo",
          ...reportOptions,
          locale,
        })
      : null;
    if (built) data.subject = built.subject;
    const html = built
      ? built.html
      : buildNewsletterHtml(data, {
          logoSrc: "cid:jellyglance-logo",
          campaignName: campaign?.name,
          sections,
          ...reportOptions,
          locale,
        });
    result = await transporter.sendMail({
      from,
      to: [email],
      subject: data.subject,
      text: built ? built.text : buildNewsletterText(data),
      html,
      attachments,
    });
    lastHtml = html;
    lastText = built ? built.text : buildNewsletterText(data);
  }

  await addNewsletterHistory(req, {
    ok: true,
    mode,
    subject: data.subject,
    recipientCount: targets.length,
    messageId: result.messageId,
  });
  await campaigns.addHistoryEntry({
    campaignId: campaign?.id || null,
    recipientCount: targets.length,
    status: "ok",
    mode,
    subject: data.subject,
    meta: { messageId: result.messageId },
  });
  await afterSuccessfulSend({ req, campaign, subject: data.subject, html: lastHtml, text: lastText, newsletter });
  return { ok: true, messageId: result.messageId, recipientCount: targets.length, subject: data.subject, campaignId: campaign?.id || null };
}

function reportEnabled(campaign) {
  return Boolean(campaign?.sections?.report?.enabled && campaign.sections.report.blocks?.length);
}

async function resolvePreviewPerson(campaign, userId) {
  const people = await campaigns.resolvePerUserCampaignRecipients(campaign || { id: null }).catch(() => []);
  const match = people.find((row) => String(row.userId) === String(userId || ""));
  if (match?.userId) return match;
  if (!userId && people[0]?.userId) return people[0];
  const { rows } = await db
    .query(
      `SELECT a."UserId" AS "userId", COALESCE(NULLIF(MAX(a."UserName"), ''), MAX(u."Name"), a."UserId") AS name
         FROM jf_playback_activity a
         LEFT JOIN jf_users u ON u."Id" = a."UserId"
        GROUP BY a."UserId"
        ORDER BY SUM(a."PlaybackDuration") DESC
        LIMIT 20`
    )
    .catch(() => ({ rows: [] }));
  const fallback = rows.find((row) => String(row.userId) === String(userId || "")) || (!userId ? rows[0] : null);
  return fallback || people[0] || { userId: userId || "", name: "Viewer" };
}

async function previewPersonData(campaign, userId) {
  return buildUserNewsletterData(await resolvePreviewPerson(campaign, userId));
}

async function sendDueCampaigns(req = null) {
  const due = await campaigns.listDueCampaigns();
  const results = [];
  for (const campaign of due) {
    try {
      results.push(await sendNewsletter(req, [], "scheduled", { campaignId: campaign.id }));
    } catch (error) {
      await campaigns.addHistoryEntry({
        campaignId: campaign.id,
        recipientCount: 0,
        status: "failed",
        mode: "scheduled",
        error: error.message,
      });
      results.push({ ok: false, campaignId: campaign.id, error: error.message });
    }
  }
  return results;
}

router.get("/settings", async (req, res) => {
  try {
    res.json(publicSettings(await getSettings()));
  } catch (error) {
    res.status(503).json({ error: "Unable to load newsletter settings" });
  }
});

router.post("/settings", async (req, res) => {
  try {
    const settings = await getSettings();
    const next = mergeNewsletterSettings(settings, req.body || {});
    const validationError = next.enabled ? validateSmtpSettings(next) : "";
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }
    settings[SETTINGS_KEY] = next;
    await saveSettings(settings);
    await addAuditEntry(req, "newsletter.settings.updated", { enabled: next.enabled, recipients: next.recipients.length });
    res.json(publicSettings(settings));
  } catch (error) {
    res.status(503).json({ error: "Unable to save newsletter settings" });
  }
});

router.get("/preview", async (req, res) => {
  try {
    let data = await buildNewsletterData();
    let sections = { ...campaigns.DEFAULT_SECTIONS };
    let campaignName = "JellyGlance Newsletter";
    let campaign = null;
    if (req.query?.campaignId) {
      campaign = await campaigns.getCampaign(req.query.campaignId);
      if (campaign) {
        campaignName = campaign.name;
        if (campaign.type === "per-user") {
          const person = await resolvePreviewPerson(campaign, req.query.userId);
          data = await buildUserNewsletterData(person.userId ? person : { userId: "", name: person.name || "Viewer" });
          sections = { ...campaigns.PER_USER_SECTIONS, ...(campaign.sections || {}), ...(campaign.template?.blocks || {}) };
        } else {
          sections = { ...sections, ...(campaign.sections || {}), ...(campaign.template?.blocks || {}) };
        }
        data.subject = `${campaign.name} - ${formatDate(new Date())}`;
        if (reportEnabled(campaign)) {
          const built = await reportBuilder.renderReport(campaign.sections.report, {
            campaignName: campaign.name,
            logoSrc: getLogoDataUri(),
            personData: campaign.type === "per-user" ? data : null,
            perUser: campaign.type === "per-user",
            ...templateRenderOptions(campaign, { assetBase: publicAssetBase(req), settings: await getSettings().catch(() => ({})) }),
            locale: req.query?.locale || req.body?.locale,
          });
          return res.json({ ...built, report: true });
        }
      }
    }
    const previewTemplate = req.query?.templateId ? await campaigns.getTemplate(req.query.templateId) : campaign?.template;
    res.json({
      ...data,
      html: buildNewsletterHtml(data, {
        sections,
        campaignName,
        perUser: data.perUser,
        ...templateRenderOptions(campaign, { template: previewTemplate, assetBase: publicAssetBase(req), locale: req.query?.locale || req.body?.locale }),
      }),
      text: buildNewsletterText(data),
    });
  } catch (error) {
    console.error("Newsletter preview failed:", error);
    res.status(503).json({ error: "Unable to generate newsletter preview" });
  }
});

router.get("/report/libraries", async (_req, res) => {
  try {
    res.json({ libraries: await reportBuilder.listReportLibraries(), blockTypes: reportBuilder.REPORT_BLOCK_TYPES });
  } catch (error) {
    res.status(503).json({ error: "Unable to load report libraries" });
  }
});

router.post("/report/preview", async (req, res) => {
  try {
    const type = req.body?.type === "per-user" ? "per-user" : "global";
    const campaign = req.body?.campaignId ? await campaigns.getCampaign(req.body.campaignId) : null;
    const personData = type === "per-user" ? await previewPersonData(campaign, req.body?.userId).catch(() => null) : null;
    const built = await reportBuilder.renderReport(req.body?.report || {}, {
      campaignName: String(req.body?.campaignName || campaign?.name || "JellyGlance report"),
      logoSrc: getLogoDataUri(),
      personData,
      perUser: type === "per-user",
      isAdmin: true,
      ...templateRenderOptions(campaign, {
        branding: req.body?.branding,
        htmlBody: req.body?.htmlBody,
        assetBase: publicAssetBase(req),
        settings: await getSettings().catch(() => ({})),
      }),
      locale: req.body?.locale || req.query?.locale,
    });
    res.json({ ...built, report: true });
  } catch (error) {
    console.error("Newsletter report preview failed:", error);
    res.status(503).json({ error: "Unable to build report preview" });
  }
});

router.post("/test", async (req, res) => {
  try {
    const email = await campaigns.resolveSelfEmail(req.user);
    if (!email) {
      const error = new Error(audience.NO_SELF_EMAIL_MESSAGE);
      error.statusCode = 400;
      throw error;
    }
    res.json(await sendNewsletter(req, [email], "test", { campaignId: req.body?.campaignId }));
  } catch (error) {
    await addNewsletterHistory(req, {
      ok: false,
      mode: "test",
      recipientCount: 0,
      error: error.message,
    }).catch(() => {});
    res.status(error.statusCode || 503).json({ error: error.message || "Unable to send test newsletter" });
  }
});

router.post("/send", async (req, res) => {
  try {
    res.json(
      await sendNewsletter(req, normalizeRecipients(req.body?.recipients), "manual", {
        campaignId: req.body?.campaignId,
      })
    );
  } catch (error) {
    await addNewsletterHistory(req, {
      ok: false,
      mode: "manual",
      recipientCount: normalizeRecipients(req.body?.recipients).length,
      error: error.message,
    }).catch(() => {});
    res.status(error.statusCode || 503).json({ error: error.message || "Unable to send newsletter" });
  }
});

router.get("/campaigns", async (req, res) => {
  try {
    const schemaReady = await campaigns.isCampaignSchemaReady();
    const audienceOptions = await campaigns.listAudienceOptions().catch(() => ({
      roles: [],
      users: [],
      timeZone: process.env.TZ || "UTC",
    }));
    const selfEmail = await campaigns.resolveSelfEmail(req.user).catch(() => "");
    res.json({
      schemaReady,
      campaigns: schemaReady ? await campaigns.listCampaigns() : [],
      templates: schemaReady ? await campaigns.listTemplates() : [],
      history: schemaReady ? await campaigns.listHistory({ limit: 30 }) : [],
      legacyFallback: !schemaReady,
      roles: audienceOptions.roles,
      users: audienceOptions.users,
      timeZone: audienceOptions.timeZone,
      fonts: audienceOptions.fonts || [],
      selfEmail: selfEmail || "",
      locales: newsletterI18n.listLocales(),
      selfEmailMessage: selfEmail ? "" : audience.NO_SELF_EMAIL_MESSAGE,
    });
  } catch (error) {
    console.error("List newsletter campaigns failed:", error);
    res.status(503).json({ error: "Unable to load newsletter campaigns" });
  }
});

router.post("/campaigns", async (req, res) => {
  try {
    const campaign = await campaigns.createCampaign(req.body || {});
    await addAuditEntry(req, "newsletter.campaign.created", { campaignId: campaign.id, name: campaign.name });
    res.json(campaign);
  } catch (error) {
    console.error("Create newsletter campaign failed:", error);
    res.status(503).json({ error: "Unable to create newsletter campaign" });
  }
});

router.put("/campaigns/:id", async (req, res) => {
  try {
    const campaign = await campaigns.updateCampaign(req.params.id, req.body || {});
    if (!campaign) return res.status(404).json({ error: "Campaign not found" });
    await addAuditEntry(req, "newsletter.campaign.updated", { campaignId: campaign.id });
    res.json(campaign);
  } catch (error) {
    console.error("Update newsletter campaign failed:", error);
    res.status(503).json({ error: "Unable to update newsletter campaign" });
  }
});

router.delete("/campaigns/:id", async (req, res) => {
  try {
    await campaigns.deleteCampaign(req.params.id);
    await addAuditEntry(req, "newsletter.campaign.deleted", { campaignId: req.params.id });
    res.json({ ok: true });
  } catch (error) {
    console.error("Delete newsletter campaign failed:", error);
    res.status(503).json({ error: "Unable to delete newsletter campaign" });
  }
});

router.post("/campaigns/:id/send", async (req, res) => {
  try {
    res.json(
      await sendNewsletter(req, normalizeRecipients(req.body?.recipients), "manual", {
        campaignId: req.params.id,
      })
    );
  } catch (error) {
    await campaigns
      .addHistoryEntry({
        campaignId: req.params.id,
        recipientCount: 0,
        status: "failed",
        mode: "manual",
        error: error.message,
      })
      .catch(() => {});
    res.status(error.statusCode || 503).json({ error: error.message || "Unable to send campaign" });
  }
});

router.post("/templates", async (req, res) => {
  try {
    res.json(await campaigns.upsertTemplate(req.body || {}));
  } catch (error) {
    console.error("Save newsletter template failed:", error);
    res.status(503).json({ error: "Unable to save newsletter template" });
  }
});

router.post("/templates/preview", async (req, res) => {
  try {
    const data = await buildNewsletterData();
    if (req.body?.subject) data.subject = String(req.body.subject);
    const html = buildNewsletterHtml(data, {
      campaignName: String(req.body?.name || "Template preview"),
      branding: req.body?.branding || {},
      htmlBody: req.body?.htmlBody || "",
      assetBase: publicAssetBase(req),
      locale: req.body?.locale || req.query?.locale,
    });
    res.json({ html, subject: data.subject, generatedAt: data.generatedAt, preview: true });
  } catch (error) {
    console.error("Newsletter template preview failed:", error);
    res.status(503).json({ error: "Unable to preview newsletter template" });
  }
});

router.post("/templates/:id/duplicate", async (req, res) => {
  try {
    const template = await campaigns.duplicateTemplate(req.params.id);
    if (!template) return res.status(404).json({ error: "Template not found" });
    res.json(template);
  } catch (error) {
    console.error("Duplicate newsletter template failed:", error);
    res.status(503).json({ error: "Unable to duplicate newsletter template" });
  }
});

router.delete("/templates/:id", async (req, res) => {
  try {
    const removed = await campaigns.deleteTemplate(req.params.id);
    if (!removed) return res.status(404).json({ error: "Template not found" });
    res.json({ ok: true, id: req.params.id });
  } catch (error) {
    console.error("Delete newsletter template failed:", error);
    res.status(503).json({ error: "Unable to delete newsletter template" });
  }
});


function digestLinks(base, t) {
  const root = String(base || "").replace(/\/+$/, "");
  return [
    { label: t("CHANNEL_OPEN"), url: root },
    { label: t("CHANNEL_REQUESTS"), url: root ? `${root}/requests` : "" },
    { label: t("CHANNEL_STATUS"), url: root ? `${root}/status` : "" },
  ];
}

async function buildChannelPreview({ req, campaign, locale, periodDays = 7 }) {
  const { t, locale: resolved } = newsletterI18n.translator(locale);
  const base = publicAssetBase(req);
  const items = (await extraBlocks.listTrendingWeek({ limit: 6, days: periodDays }).catch(() => [])) || [];
  const mapped = items.map((item) => ({
    name: item.Name || item.name,
    meta: [item.Type, item.Library || item.library].filter(Boolean).join(" · "),
    plays: item.Plays || item.plays,
    id: item.Id || item.id,
  }));
  const firstId = mapped[0]?.id;
  const posterUrl = firstId ? publicUrl.posterSrc(base, firstId) : "";
  const subject = campaign?.name ? `${campaign.name} - ${formatDate(new Date())}` : t("CHANNELS_TITLE");
  const summary = mapped.length
    ? `${mapped.length} ${mapped.length === 1 ? "title" : "titles"} from the last ${periodDays} days`
    : "";
  const links = digestLinks(base, t);
  const discord = newsletterChannels.buildDiscordDigest({
    campaignName: campaign?.name || t("CHANNELS_TITLE"),
    subject,
    generatedAt: new Date().toISOString(),
    summary,
    items: mapped,
    links,
    posterUrl,
    footer: t("DISCORD_DIGEST_FOOTER"),
  });
  const telegram = newsletterChannels.buildTelegramDigest({
    campaignName: campaign?.name || t("CHANNELS_TITLE"),
    subject,
    summary,
    items: mapped,
    links,
    posterUrl,
  });
  return { locale: resolved, subject, items: mapped, posterUrl, discord, telegram };
}

async function afterSuccessfulSend({ req, campaign, subject, html, text, newsletter }) {
  try {
    await newsletterArchive.addEntry({
      campaignId: campaign?.id,
      subject,
      html,
      text,
      audienceLabel: campaign?.name || "Digest",
      kind: "campaign",
    });
  } catch (error) {
    console.warn("Newsletter archive snapshot skipped:", error.message);
  }
  try {
    const preview = await buildChannelPreview({ req, campaign, locale: "en-GB" });
    await newsletterChannels.deliverDigestChannels({
      channels: newsletter?.channels,
      discordPayload: preview.discord,
      telegramPayload: preview.telegram,
    });
  } catch (error) {
    console.warn("Newsletter channel delivery skipped:", error.message);
  }
}

async function runDueNewsletterAutomations(req = null) {
  if (newsletterChannels.notificationsDisabled()) {
    return { skipped: "notifications-disabled", results: [] };
  }
  const settings = await getSettings();
  const newsletter = {
    ...defaultNewsletterSettings(),
    ...(settings[SETTINGS_KEY] || {}),
  };
  const directory = await campaigns.listAudienceDirectory().catch(() => []);
  const base = publicAssetBase(req) || publicUrl.configuredPublicBase(settings);
  return newsletterAutomations.runDueAutomations({
    automations: newsletter.automations,
    directory,
    base,
    assetBase: base,
  });
}

router.post("/channels/preview", async (req, res) => {
  try {
    const campaign = req.body?.campaignId ? await campaigns.getCampaign(req.body.campaignId) : null;
    res.json({ preview: true, ...(await buildChannelPreview({ req, campaign, locale: req.body?.locale })) });
  } catch (error) {
    console.error("Newsletter channel preview failed:", error);
    res.status(503).json({ error: "Unable to preview digest channels" });
  }
});

router.post("/automations/preview", async (req, res) => {
  try {
    const kind = String(req.body?.kind || req.query?.kind || "welcome");
    const base = publicAssetBase(req);
    const preview = await newsletterAutomations.previewAutomation(kind, {
      locale: req.body?.locale || req.query?.locale,
      assetBase: base,
      base,
    });
    res.json({ preview: true, kind: preview.kind, subject: preview.subject, html: preview.html, text: preview.text, person: preview.person ? { name: preview.person.name || preview.person.Name } : null });
  } catch (error) {
    console.error("Newsletter automation preview failed:", error);
    res.status(503).json({ error: "Unable to preview this automatic email" });
  }
});

router.get("/archive", async (req, res) => {
  try {
    const entries = await newsletterArchive.listEntries({ includeHtml: false });
    res.json({ entries: entries.map(newsletterArchive.summaryOf), publicPath: "/newsletter-archive" });
  } catch (error) {
    res.status(503).json({ error: "Unable to load the newsletter archive" });
  }
});

router.post("/archive/preview", async (req, res) => {
  try {
    const settings = await getSettings();
    const newsletter = { ...defaultNewsletterSettings(), ...(settings[SETTINGS_KEY] || {}) };
    const archive = newsletterArchive.publicArchive(newsletter.archive);
    const entries = await newsletterArchive.listEntries({ includeHtml: false });
    const campaign = req.body?.campaignId ? await campaigns.getCampaign(req.body.campaignId) : (await campaigns.listCampaigns({ includePersonal: false }))[0];
    let preview = null;
    if (campaign) {
      const report = campaign.sections?.report;
      let built = report
        ? await reportBuilder.renderReport(report, {
            campaignName: campaign.name,
            isAdmin: true,
            assetBase: publicAssetBase(req),
            locale: req.body?.locale,
          }).catch(() => null)
        : null;
      if (!built?.html) {
        const data = await buildNewsletterData();
        built = {
          subject: `${campaign.name} - ${formatDate(new Date())}`,
          html: buildNewsletterHtml(data, {
            campaignName: campaign.name,
            sections: campaign.sections,
            assetBase: publicAssetBase(req),
            locale: req.body?.locale,
          }),
          text: buildNewsletterText(data),
        };
      }
      preview = newsletterArchive.virtualEntry({
        subject: built?.subject || `${campaign.name} - ${formatDate(new Date())}`,
        html: built?.html || "",
        text: built?.text || "",
        audienceLabel: campaign.name,
        kind: "preview",
      });
    }
    const payload = newsletterArchive.buildArchivePayload({
      enabled: archive.enabled,
      entries,
      preview,
      locale: req.body?.locale,
    });
    res.json({ ...payload, previewHtml: preview?.html || "", previewSubject: preview?.subject || "" });
  } catch (error) {
    console.error("Newsletter archive preview failed:", error);
    res.status(503).json({ error: "Unable to preview the newsletter archive" });
  }
});

module.exports = router;
module.exports.sendDueCampaigns = sendDueCampaigns;
module.exports.sendNewsletter = sendNewsletter;
module.exports.runDueNewsletterAutomations = runDueNewsletterAutomations;

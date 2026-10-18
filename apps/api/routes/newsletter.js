const express = require("express");
const nodemailer = require("nodemailer");
const fs = require("fs");
const path = require("path");
const db = require("../db");
const { axios } = require("../classes/axios");
const { addAuditEntry } = require("../classes/admin-history");
const campaigns = require("../classes/newsletter-campaigns");
const reportBuilder = require("../classes/newsletter-report-builder");
const { encryptSecret, getIntegrations } = require("../classes/integration-store");
const { isValidEmail } = require("../utils/security");
const { decryptPassword, upgradeLegacyPassword } = require("../classes/smtp-mailer");
const { fetchJellyfinUserItems, normalizeJellyfinMediaItem } = require("../classes/watch-tonight");

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
        params: { take: 40, skip: 0, sort: "added", skipCount: "false" },
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
    continueWatching: continueItems.map(normalizeJellyfinMediaItem).map((item) => ({
      Name: item.seriesName || item.name,
      Type: item.type,
    })),
    myRequests: requests,
    recentlyAdded: recentItems.map(normalizeJellyfinMediaItem).map((item) => ({
      Name: item.seriesName || item.name,
      Type: item.type,
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

function buildNewsletterHtml(data, options = {}) {
  const perUser = Boolean(data.perUser || options.perUser);
  const sections = perUser
    ? { continueWatching: true, myRequests: true, recentlyAdded: true, ...(options.sections || {}) }
    : { recentlyAdded: true, topWatched: true, activeUsers: true, repairSummary: true, ...(options.sections || {}) };
  const logoSrc = options.logoSrc || getLogoDataUri();
  const repairSummary = data.repairSummary || {};
  const totalRepairIssues =
    Number(repairSummary.missingPosters || 0) +
    Number(repairSummary.missingLogos || 0) +
    Number(repairSummary.missingRuntime || 0) +
    Number(repairSummary.unmatchedImports || 0);
  const topWatched = data.topWatched || [];
  const totalPlays = topWatched.reduce((total, item) => total + Number(item.Plays || 0), 0);
  const totalWatchSeconds = topWatched.reduce((total, item) => total + Number(item.WatchSeconds || 0), 0);
  const metricBox = (label, value, detail, color = "#6ee7f9") => `
    <td style="width:25%;padding:6px;">
      <div style="background:#121a24;border:1px solid #27364a;border-radius:14px;padding:14px;min-height:86px;">
        <div style="color:#8fa3bd;font-size:11px;font-weight:800;text-transform:uppercase;">${label}</div>
        <div style="color:${color};font-size:26px;font-weight:900;line-height:1.1;margin:6px 0 3px;">${value}</div>
        <div style="color:#9fb0c7;font-size:12px;">${detail}</div>
      </div>
    </td>
  `;
  const sectionTitle = (title) => `<h2 style="color:#e8eef8;font-size:16px;margin:24px 0 10px;">${title}</h2>`;
  const recentlyAddedHtml = sections.recentlyAdded
    ? `${sectionTitle("Recently Added")}${listHtml(
        data.recentlyAdded || [],
        (item) =>
          `<div style="padding:8px 0;border-bottom:1px solid #243246;color:#d7e2f2;font-size:14px;"><strong>${escapeHtml(item.Name)}</strong> <span style="color:#8fa3bd;">${escapeHtml([item.Type, item.ProductionYear, item.status].filter(Boolean).join(" · "))}</span></div>`,
        "No new media this period."
      )}`
    : "";
  const continueWatchingHtml =
    perUser && sections.continueWatching
      ? `${sectionTitle("Continue Watching")}${listHtml(
          data.continueWatching || [],
          (item) =>
            `<div style="padding:8px 0;border-bottom:1px solid #243246;color:#d7e2f2;font-size:14px;"><strong>${escapeHtml(item.Name)}</strong> <span style="color:#8fa3bd;">${escapeHtml(item.Type || "")}</span></div>`,
          "Nothing in progress."
        )}`
      : "";
  const myRequestsHtml =
    perUser && sections.myRequests
      ? `${sectionTitle("My Requests")}${listHtml(
          data.myRequests || [],
          (item) =>
            `<div style="padding:8px 0;border-bottom:1px solid #243246;color:#d7e2f2;font-size:14px;"><strong>${escapeHtml(item.Name)}</strong> <span style="color:#8fa3bd;">${escapeHtml([item.Type, item.status].filter(Boolean).join(" · "))}</span></div>`,
          "No requests for this account."
        )}`
      : "";
  const topWatchedHtml =
    !perUser && sections.topWatched
      ? `${sectionTitle("Most Watched")}${listHtml(
          topWatched,
          (item) =>
            `<div style="padding:8px 0;border-bottom:1px solid #243246;color:#d7e2f2;font-size:14px;"><strong>${escapeHtml(item.Name)}</strong> <span style="color:#8fa3bd;">${item.Plays} plays · ${formatWatchTime(item.WatchSeconds)}</span></div>`,
          "No watch activity yet."
        )}`
      : "";
  const activeUsersHtml =
    !perUser && sections.activeUsers
      ? `${sectionTitle("Active Viewers")}${listHtml(
          data.activeUsers || [],
          (item) =>
            `<div style="padding:8px 0;border-bottom:1px solid #243246;color:#d7e2f2;font-size:14px;"><strong>${escapeHtml(item.Name)}</strong> <span style="color:#8fa3bd;">${item.Plays} plays · ${formatWatchTime(item.WatchSeconds)}</span></div>`,
          "No active viewers this period."
        )}`
      : "";
  const repairHtml =
    !perUser && sections.repairSummary
      ? `${sectionTitle("Repair Snapshot")}<p style="color:#9fb0c7;font-size:14px;margin:0;">Missing posters ${repairSummary.missingPosters || 0} · logos ${repairSummary.missingLogos || 0} · runtime ${repairSummary.missingRuntime || 0} · unmatched imports ${repairSummary.unmatchedImports || 0}</p>`
      : "";
  const customHtml = sections.customHtml ? `<div style="margin-top:20px;">${sections.customHtml}</div>` : "";
  const metricRow = perUser
    ? `${metricBox("Continue", String((data.continueWatching || []).length), "In progress")}
       ${metricBox("Requests", String((data.myRequests || []).length), "Your Seerr queue", "#a78bfa")}
       ${metricBox("New", String((data.recentlyAdded || []).length), "Recently added", "#34d399")}
       ${metricBox("For", escapeHtml(data.personName || "You"), "Personal digest", "#fbbf24")}`
    : `${metricBox("Plays", totalPlays.toLocaleString(), "Top titles this week")}
       ${metricBox("Watch", formatWatchTime(totalWatchSeconds), "Across top titles", "#a78bfa")}
       ${metricBox("New", String((data.recentlyAdded || []).length), "Recently added items", "#34d399")}
       ${metricBox("Repair", String(totalRepairIssues), "Open metadata issues", "#fbbf24")}`;
  const bodyHtml = perUser
    ? `${continueWatchingHtml}${myRequestsHtml}${recentlyAddedHtml}${customHtml}`
    : `${recentlyAddedHtml}${topWatchedHtml}${activeUsersHtml}${repairHtml}${customHtml}`;

  return `
    <!doctype html>
    <html>
      <body style="margin:0;background:#0b111a;font-family:Arial,sans-serif;color:#d7e2f2;">
        <table width="100%" cellpadding="0" cellspacing="0" style="background:#0b111a;padding:24px 12px;">
          <tr>
            <td align="center">
              <table width="640" cellpadding="0" cellspacing="0" style="background:#151d29;border:1px solid #27364a;border-radius:18px;overflow:hidden;">
                <tr>
                  <td style="padding:28px 28px 12px;">
                    ${logoSrc ? `<img src="${logoSrc}" alt="JellyGlance" width="48" height="48" style="display:block;margin-bottom:14px;" />` : ""}
                    <div style="color:#8fa3bd;font-size:12px;font-weight:800;text-transform:uppercase;">${escapeHtml(options.campaignName || "JellyGlance Newsletter")}</div>
                    <h1 style="margin:8px 0 6px;color:#f4f8ff;font-size:28px;">${escapeHtml(data.subject)}</h1>
                    <p style="margin:0;color:#9fb0c7;font-size:14px;">Generated ${escapeHtml(formatDate(data.generatedAt))}</p>
                  </td>
                </tr>
                <tr>
                  <td style="padding:8px 22px 8px;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        ${metricRow}
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="padding:8px 28px 32px;">
                    ${bodyHtml}
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
  `;
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
              }),
          attachments,
        });
        lastMessageId = result.messageId;
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
  const built = reportEnabled(campaign)
    ? await reportBuilder.renderReport(campaign.sections.report, { campaignName: campaign.name, logoSrc: "cid:jellyglance-logo" })
    : null;
  if (built) data.subject = built.subject;
  const result = await transporter.sendMail({
    from,
    to: targets,
    subject: data.subject,
    text: built ? built.text : buildNewsletterText(data),
    html: built
      ? built.html
      : buildNewsletterHtml(data, {
          logoSrc: "cid:jellyglance-logo",
          campaignName: campaign?.name,
          sections,
        }),
    attachments,
  });

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

  return { ok: true, messageId: result.messageId, recipientCount: targets.length, subject: data.subject, campaignId: campaign?.id || null };
}

function reportEnabled(campaign) {
  return Boolean(campaign?.sections?.report?.enabled && campaign.sections.report.blocks?.length);
}

async function previewPersonData(campaign, userId) {
  const people = await campaigns.resolvePerUserCampaignRecipients(campaign || { id: null });
  const person = people.find((row) => String(row.userId) === String(userId || "")) || people[0] || { userId: "", name: "Viewer" };
  return buildUserNewsletterData(person);
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
    if (req.query?.campaignId) {
      const campaign = await campaigns.getCampaign(req.query.campaignId);
      if (campaign) {
        campaignName = campaign.name;
        if (campaign.type === "per-user") {
          const people = await campaigns.resolvePerUserCampaignRecipients(campaign);
          const person = people.find((row) => String(row.userId) === String(req.query.userId || "")) || people[0] || { userId: "", name: "Viewer" };
          data = person.userId ? await buildUserNewsletterData(person) : await buildUserNewsletterData({ userId: "", name: person.name });
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
          });
          return res.json({ ...built, report: true });
        }
      }
    }
    res.json({ ...data, html: buildNewsletterHtml(data, { sections, campaignName, perUser: data.perUser }), text: buildNewsletterText(data) });
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
    });
    res.json({ ...built, report: true });
  } catch (error) {
    console.error("Newsletter report preview failed:", error);
    res.status(503).json({ error: "Unable to build report preview" });
  }
});

router.post("/test", async (req, res) => {
  try {
    res.json(await sendNewsletter(req, normalizeRecipients(req.body?.recipients), "test", { campaignId: req.body?.campaignId }));
  } catch (error) {
    await addNewsletterHistory(req, {
      ok: false,
      mode: "test",
      recipientCount: normalizeRecipients(req.body?.recipients).length,
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

router.get("/campaigns", async (_req, res) => {
  try {
    const schemaReady = await campaigns.isCampaignSchemaReady();
    res.json({
      schemaReady,
      campaigns: schemaReady ? await campaigns.listCampaigns() : [],
      templates: schemaReady ? await campaigns.listTemplates() : [],
      history: schemaReady ? await campaigns.listHistory({ limit: 30 }) : [],
      legacyFallback: !schemaReady,
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

module.exports = router;
module.exports.sendDueCampaigns = sendDueCampaigns;
module.exports.sendNewsletter = sendNewsletter;

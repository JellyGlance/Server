const { randomUUID } = require("crypto");
const { getSettings } = require("./admin-history");
const { normalizeAccessRoles } = require("./role-permissions");
const schedule = require("./newsletter-schedule");
const audience = require("./newsletter-audience");
const db = require("../db");
const { normalizeReport } = require("./newsletter-report-builder");

const CAMPAIGN_TYPES = ["global", "role", "personal", "per-user"];

const DEFAULT_SECTIONS = {
  recentlyAdded: true,
  topWatched: true,
  activeUsers: true,
  repairSummary: true,
  customHtml: "",
};

const PER_USER_SECTIONS = {
  continueWatching: true,
  myRequests: true,
  recentlyAdded: true,
  customHtml: "",
};

function isCampaignType(type) {
  return CAMPAIGN_TYPES.includes(type);
}

function sectionsForType(type, sections = {}) {
  const report = sections.report ? { report: normalizeReport(sections.report) } : {};
  if (type === "per-user") {
    return {
      continueWatching: sections.continueWatching !== false,
      myRequests: sections.myRequests !== false,
      recentlyAdded: sections.recentlyAdded !== false,
      customHtml: sections.customHtml || "",
      ...report,
    };
  }
  return { ...DEFAULT_SECTIONS, ...sections, ...report };
}

let campaignSchemaReady = null;

async function isCampaignSchemaReady() {
  if (campaignSchemaReady !== null) return campaignSchemaReady;
  try {
    const { rows } = await db.query(
      `SELECT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'newsletter_campaigns'
      ) AS ready`
    );
    campaignSchemaReady = Boolean(rows[0]?.ready);
  } catch {
    campaignSchemaReady = false;
  }
  return campaignSchemaReady;
}

function resetCampaignSchemaCache() {
  campaignSchemaReady = null;
}

function mapTemplate(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    htmlBody: row.html_body,
    blocks: typeof row.blocks === "string" ? JSON.parse(row.blocks) : row.blocks || {},
    branding: typeof row.branding === "string" ? JSON.parse(row.branding) : row.branding || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapCampaign(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    ownerUserId: row.owner_user_id,
    templateId: row.template_id,
    scheduleCron: row.schedule_cron,
    frequency: row.frequency,
    enabled: row.enabled,
    audience: typeof row.audience === "string" ? JSON.parse(row.audience) : row.audience || {},
    sections: typeof row.sections === "string" ? JSON.parse(row.sections) : row.sections || { ...DEFAULT_SECTIONS },
    lastSentAt: row.last_sent_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    template: row.template_name
      ? {
          id: row.template_id,
          name: row.template_name,
          blocks: typeof row.template_blocks === "string" ? JSON.parse(row.template_blocks) : row.template_blocks || {},
        }
      : undefined,
  };
}

function mapHistory(row) {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    campaignName: row.campaign_name || null,
    sentAt: row.sent_at,
    recipientCount: row.recipient_count,
    status: row.status,
    mode: row.mode,
    subject: row.subject,
    error: row.error,
    meta: typeof row.meta === "string" ? JSON.parse(row.meta) : row.meta || {},
  };
}

async function listTemplates() {
  if (!(await isCampaignSchemaReady())) return [];
  const { rows } = await db.query(`SELECT * FROM newsletter_templates ORDER BY name ASC`);
  return rows.map(mapTemplate);
}

async function listCampaigns({ includePersonal = true, ownerUserId = null } = {}) {
  if (!(await isCampaignSchemaReady())) return [];
  const params = [];
  let where = "WHERE 1=1";
  if (!includePersonal) {
    where += ` AND c.type <> 'personal'`;
  }
  if (ownerUserId) {
    params.push(ownerUserId);
    where += ` AND (c.type <> 'personal' OR c.owner_user_id = $${params.length})`;
  }

  const { rows } = await db.query(
    `
    SELECT c.*, t.name AS template_name, t.blocks AS template_blocks
    FROM newsletter_campaigns c
    LEFT JOIN newsletter_templates t ON t.id = c.template_id
    ${where}
    ORDER BY
      CASE c.type WHEN 'global' THEN 0 WHEN 'role' THEN 1 WHEN 'personal' THEN 2 WHEN 'per-user' THEN 3 ELSE 4 END,
      c.name ASC
    `,
    params
  );
  return rows.map(mapCampaign);
}

async function getCampaign(id) {
  if (!(await isCampaignSchemaReady())) return null;
  const { rows } = await db.query(
    `
    SELECT c.*, t.name AS template_name, t.blocks AS template_blocks, t.html_body
    FROM newsletter_campaigns c
    LEFT JOIN newsletter_templates t ON t.id = c.template_id
    WHERE c.id = $1
    `,
    [id]
  );
  return mapCampaign(rows[0]);
}

async function createCampaign(input = {}) {
  if (!(await isCampaignSchemaReady())) {
    throw new Error("Newsletter campaign tables are not ready yet. Restart JellyGlance to apply pending database migrations.");
  }
  const id = randomUUID();
  const type = isCampaignType(input.type) ? input.type : "global";
  const sections = sectionsForType(type, input.sections || {});
  await db.query(
    `
    INSERT INTO newsletter_campaigns
      (id, name, type, owner_user_id, template_id, schedule_cron, frequency, enabled, audience, sections)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb)
    `,
    [
      id,
      String(input.name || "Untitled campaign").trim(),
      type,
      input.ownerUserId || null,
      input.templateId || null,
      schedule.resolveScheduleFields(input).scheduleCron,
      schedule.resolveScheduleFields(input).frequency,
      Boolean(input.enabled),
      JSON.stringify(input.audience || { recipients: [], roles: [] }),
      JSON.stringify(sections),
    ]
  );
  return getCampaign(id);
}

async function updateCampaign(id, input = {}) {
  const current = await getCampaign(id);
  if (!current) return null;

  const next = {
    name: input.name != null ? String(input.name).trim() : current.name,
    type: isCampaignType(input.type) ? input.type : current.type,
    ownerUserId: input.ownerUserId !== undefined ? input.ownerUserId : current.ownerUserId,
    templateId: input.templateId !== undefined ? input.templateId : current.templateId,
    ...(() => {
      const resolved = schedule.resolveScheduleFields(input, current);
      return { scheduleCron: resolved.scheduleCron, frequency: resolved.frequency };
    })(),
    enabled: input.enabled !== undefined ? Boolean(input.enabled) : current.enabled,
    audience: input.audience !== undefined ? input.audience : current.audience,
    sections:
      input.sections !== undefined
        ? sectionsForType(isCampaignType(input.type) ? input.type : current.type, input.sections)
        : current.sections,
  };


  await db.query(
    `
    UPDATE newsletter_campaigns
    SET name=$2, type=$3, owner_user_id=$4, template_id=$5, schedule_cron=$6, frequency=$7,
        enabled=$8, audience=$9::jsonb, sections=$10::jsonb, updated_at=NOW()
    WHERE id=$1
    `,
    [
      id,
      next.name,
      next.type,
      next.ownerUserId,
      next.templateId,
      next.scheduleCron,
      next.frequency,
      next.enabled,
      JSON.stringify(next.audience || {}),
      JSON.stringify(next.sections || {}),
    ]
  );
  return getCampaign(id);
}

async function deleteCampaign(id) {
  await db.query(`DELETE FROM newsletter_campaigns WHERE id=$1`, [id]);
}

async function upsertTemplate(input = {}) {
  const id = input.id || randomUUID();
  if (input.id) {
    await db.query(
      `
      UPDATE newsletter_templates
      SET name=$2, html_body=$3, blocks=$4::jsonb, branding=$5::jsonb, updated_at=NOW()
      WHERE id=$1
      `,
      [
        id,
        String(input.name || "Template").trim(),
        input.htmlBody || null,
        JSON.stringify(input.blocks || { ...DEFAULT_SECTIONS }),
        JSON.stringify(input.branding || {}),
      ]
    );
  } else {
    await db.query(
      `
      INSERT INTO newsletter_templates (id, name, html_body, blocks, branding)
      VALUES ($1,$2,$3,$4::jsonb,$5::jsonb)
      `,
      [
        id,
        String(input.name || "Template").trim(),
        input.htmlBody || null,
        JSON.stringify(input.blocks || { ...DEFAULT_SECTIONS }),
        JSON.stringify(input.branding || {}),
      ]
    );
  }
  const { rows } = await db.query(`SELECT * FROM newsletter_templates WHERE id=$1`, [id]);
  return mapTemplate(rows[0]);
}

async function listHistory({ campaignId = null, limit = 50 } = {}) {
  if (!(await isCampaignSchemaReady())) return [];
  const params = [Math.min(Number(limit) || 50, 100)];
  let where = "";
  if (campaignId) {
    params.push(campaignId);
    where = `WHERE h.campaign_id = $${params.length}`;
  }
  const { rows } = await db.query(
    `
    SELECT h.*, c.name AS campaign_name
    FROM newsletter_send_history h
    LEFT JOIN newsletter_campaigns c ON c.id = h.campaign_id
    ${where}
    ORDER BY h.sent_at DESC
    LIMIT $1
    `,
    params
  );
  return rows.map(mapHistory);
}

async function addHistoryEntry({ campaignId, recipientCount, status, mode, subject, error, meta }) {
  await db.query(
    `
    INSERT INTO newsletter_send_history
      (id, campaign_id, recipient_count, status, mode, subject, error, meta)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
    `,
    [
      randomUUID(),
      campaignId || null,
      Number(recipientCount || 0),
      status || "ok",
      mode || "manual",
      subject || null,
      error || null,
      JSON.stringify(meta || {}),
    ]
  );
  if (campaignId && status === "ok") {
    await db.query(`UPDATE newsletter_campaigns SET last_sent_at=NOW(), updated_at=NOW() WHERE id=$1`, [campaignId]);
  }
}

async function getSubscriptionsForUser(userId) {
  if (!(await isCampaignSchemaReady())) return [];
  const { rows } = await db.query(
    `
    SELECT s.*, c.name AS campaign_name, c.type AS campaign_type, c.enabled AS campaign_enabled
    FROM newsletter_subscriptions s
    JOIN newsletter_campaigns c ON c.id = s.campaign_id
    WHERE s.user_id = $1
    ORDER BY c.name ASC
    `,
    [userId]
  );
  return rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    campaignId: row.campaign_id,
    campaignName: row.campaign_name,
    campaignType: row.campaign_type,
    campaignEnabled: row.campaign_enabled,
    optedIn: row.opted_in,
    extraRecipients: typeof row.extra_recipients === "string" ? JSON.parse(row.extra_recipients) : row.extra_recipients || [],
    updatedAt: row.updated_at,
  }));
}

async function upsertSubscription({ userId, campaignId, optedIn = true, extraRecipients = [] }) {
  const existing = await db.query(
    `SELECT id FROM newsletter_subscriptions WHERE user_id=$1 AND campaign_id=$2`,
    [userId, campaignId]
  );
  if (existing.rows[0]) {
    await db.query(
      `
      UPDATE newsletter_subscriptions
      SET opted_in=$3, extra_recipients=$4::jsonb, updated_at=NOW()
      WHERE user_id=$1 AND campaign_id=$2
      `,
      [userId, campaignId, Boolean(optedIn), JSON.stringify(extraRecipients || [])]
    );
  } else {
    await db.query(
      `
      INSERT INTO newsletter_subscriptions (id, user_id, campaign_id, opted_in, extra_recipients)
      VALUES ($1,$2,$3,$4,$5::jsonb)
      `,
      [randomUUID(), userId, campaignId, Boolean(optedIn), JSON.stringify(extraRecipients || [])]
    );
  }
  return getSubscriptionsForUser(userId);
}

async function listAudienceDirectory() {
  const settings = await getSettings().catch(() => ({}));
  let jellyfinUsers = [];
  try {
    const API = require("./api-loader");
    jellyfinUsers = await API.getUsers(false).catch(() => []);
  } catch {
    jellyfinUsers = [];
  }
  return audience.buildDirectoryUsers({
    jellyfinUsers,
    localUsers: settings.localUsers || [],
    userRoles: settings.userRoles || {},
    excludedUsers: settings.ExcludedUsers || [],
  });
}

async function listAudienceOptions() {
  const settings = await getSettings().catch(() => ({}));
  const directory = await listAudienceDirectory();
  return {
    roles: (normalizeAccessRoles(settings) || audience.PICKABLE_ROLES).filter((role) => role !== "Disabled"),
    users: audience.summariseDirectory(directory),
    timeZone: schedule.DEFAULT_TIME_ZONE,
  };
}

async function resolveCampaignRecipients(campaign, options = {}) {
  const directory = options.directory || (await listAudienceDirectory());
  let subscriptions = options.subscriptions;
  if (!subscriptions) {
    const { rows: subs } = await db
      .query(
        `
        SELECT extra_recipients, opted_in, user_id
        FROM newsletter_subscriptions
        WHERE campaign_id=$1
        `,
        [campaign.id]
      )
      .catch(() => ({ rows: [] }));
    subscriptions = subs;
  }
  return audience.resolveAudienceRecipients({ campaign, directory, subscriptions });
}

function userEmail(user, extras = []) {
  return String(user?.Email || user?.email || user?.Configuration?.Email || extras[0] || "")
    .trim()
    .toLowerCase();
}

async function resolvePerUserCampaignRecipients(campaign) {
  const settingsResult = await db.query('SELECT settings FROM app_config where "ID"=1').catch(() => ({ rows: [] }));
  const excluded = new Set((settingsResult.rows?.[0]?.settings?.ExcludedUsers || []).map(String));
  const API = require("./api-loader");
  const users = (await API.getUsers(true).catch(() => [])).filter((user) => user?.Id && !excluded.has(String(user.Id)));
  const { rows: subs } = await db
    .query(`SELECT user_id, opted_in, extra_recipients FROM newsletter_subscriptions WHERE campaign_id=$1`, [campaign.id])
    .catch(() => ({ rows: [] }));
  const subByUser = new Map(subs.map((row) => [String(row.user_id), row]));

  const people = [];
  for (const user of users) {
    const sub = subByUser.get(String(user.Id));
    if (sub && sub.opted_in === false) continue;
    const extras = sub
      ? typeof sub.extra_recipients === "string"
        ? JSON.parse(sub.extra_recipients)
        : sub.extra_recipients || []
      : [];
    const email = userEmail(user, extras);
    if (!email) continue;
    people.push({
      userId: user.Id,
      name: user.Name || user.Id,
      email,
    });
  }
  return people;
}

function campaignDue(campaign, now = new Date(), options = {}) {
  return schedule.campaignDue(campaign, now, options);
}

async function listDueCampaigns(now = new Date(), options = {}) {
  const campaigns = await listCampaigns({ includePersonal: true });
  return campaigns.filter((item) => campaignDue(item, now, options));
}

module.exports = {
  DEFAULT_SECTIONS,
  PER_USER_SECTIONS,
  isCampaignSchemaReady,
  resetCampaignSchemaCache,
  listTemplates,
  listCampaigns,
  getCampaign,
  createCampaign,
  updateCampaign,
  deleteCampaign,
  upsertTemplate,
  listHistory,
  addHistoryEntry,
  getSubscriptionsForUser,
  upsertSubscription,
  resolveCampaignRecipients,
  resolvePerUserCampaignRecipients,
  listDueCampaigns,
  campaignDue,
  listAudienceDirectory,
  listAudienceOptions,
};

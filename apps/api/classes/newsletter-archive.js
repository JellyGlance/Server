// Public newsletter archive. Off by default. Stores HTML snapshots after a
// successful send (which is itself gated by JG_DISABLE_NOTIFICATIONS).
const { randomUUID } = require("crypto");
const db = require("../db");
const newsletterI18n = require("./newsletter-i18n");

function defaultArchive() {
  return { enabled: false };
}

function normalizeArchive(input = {}, current = {}) {
  const previous = { ...defaultArchive(), ...(current && typeof current === "object" ? current : {}) };
  const incoming = input && typeof input === "object" ? input : {};
  const source = Object.prototype.hasOwnProperty.call(incoming, "enabled") ? incoming : previous;
  return { enabled: Boolean(source.enabled) };
}

function publicArchive(value = {}) {
  return normalizeArchive(value, value);
}

function mapEntry(row) {
  if (!row) return null;
  return {
    id: row.id,
    campaignId: row.campaign_id || null,
    subject: row.subject || "",
    publishedAt: row.published_at,
    html: row.html || "",
    text: row.text_body || "",
    audienceLabel: row.audience_label || "",
    kind: row.kind || "campaign",
  };
}

function summaryOf(entry) {
  if (!entry) return null;
  const { html, text, ...rest } = entry;
  return {
    ...rest,
    excerpt: String(text || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 220),
  };
}

async function schemaReady() {
  try {
    const { rows } = await db.query(
      `SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'newsletter_archive'
      ) AS ready`
    );
    return Boolean(rows[0]?.ready);
  } catch {
    return false;
  }
}

async function listEntries({ limit = 50, includeHtml = false } = {}) {
  if (!(await schemaReady())) return [];
  const { rows } = await db.query(
    `SELECT id, campaign_id, subject, published_at, audience_label, kind,
            text_body${includeHtml ? ", html" : ", NULL AS html"}
       FROM newsletter_archive
      ORDER BY published_at DESC
      LIMIT $1`,
    [Math.min(100, Math.max(1, Number(limit) || 50))]
  );
  return rows.map(mapEntry);
}

async function getEntry(id) {
  if (!(await schemaReady()) || !id) return null;
  const { rows } = await db.query(`SELECT * FROM newsletter_archive WHERE id=$1`, [String(id)]);
  return mapEntry(rows[0]);
}

async function addEntry({ campaignId, subject, html, text, audienceLabel, kind, publishedAt } = {}) {
  if (!(await schemaReady())) return null;
  const id = randomUUID();
  await db.query(
    `INSERT INTO newsletter_archive
      (id, campaign_id, subject, published_at, html, text_body, audience_label, kind)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      id,
      campaignId || null,
      String(subject || "").slice(0, 255),
      publishedAt ? new Date(publishedAt) : new Date(),
      String(html || ""),
      String(text || "").slice(0, 20000),
      String(audienceLabel || "").slice(0, 160),
      String(kind || "campaign").slice(0, 40),
    ]
  );
  return getEntry(id);
}

function virtualEntry({ subject, html, text, audienceLabel, kind, publishedAt } = {}) {
  return {
    id: "preview",
    campaignId: null,
    subject: subject || "",
    publishedAt: publishedAt || new Date().toISOString(),
    html: html || "",
    text: text || "",
    audienceLabel: audienceLabel || "",
    kind: kind || "preview",
    preview: true,
  };
}

function buildArchivePayload({ enabled, entries = [], preview = null, locale } = {}) {
  const { t } = newsletterI18n.translator(locale);
  const list = [...(preview ? [preview] : []), ...entries];
  return {
    enabled: Boolean(enabled),
    title: t("ARCHIVE_PAGE_TITLE"),
    kicker: t("ARCHIVE_KICKER"),
    empty: t("ARCHIVE_EMPTY"),
    entries: list.map((entry) => summaryOf(entry)),
  };
}

module.exports = {
  defaultArchive,
  normalizeArchive,
  publicArchive,
  schemaReady,
  listEntries,
  getEntry,
  addEntry,
  virtualEntry,
  summaryOf,
  buildArchivePayload,
};

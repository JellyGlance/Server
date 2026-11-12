const db = require("../db");
const { getIntegrations } = require("./integration-store");

const GB = 1024 * 1024 * 1024;
const DEFAULT_ACTIVE_USER_DAYS = 90;
const LEAVING_SOON_COLLECTION = "Leaving soon";

function automationAllowed() {
  return process.env.JG_DISABLE_SERVER_AUTOMATION !== "1";
}

function httpError(message, statusCode = 400, code) {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (code) error.code = code;
  return error;
}

function asNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function asInteger(value) {
  const number = asNumber(value);
  return number === null ? null : Math.trunc(number);
}

function asBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return value === true || value === "true" || value === 1 || value === "1";
}

function normalizeConditions(input = {}) {
  const watchedBy = input.watchedBy === "all" || input.watchedBy === "active" ? input.watchedBy : null;
  return {
    unwatchedDays: asInteger(input.unwatchedDays) !== null && asInteger(input.unwatchedDays) >= 0 ? asInteger(input.unwatchedDays) : null,
    watchedBy,
    addedDays: asInteger(input.addedDays) !== null && asInteger(input.addedDays) >= 0 ? asInteger(input.addedDays) : null,
    sizeGb: asNumber(input.sizeGb) !== null && asNumber(input.sizeGb) >= 0 ? asNumber(input.sizeGb) : null,
    ratingBelow: asNumber(input.ratingBelow) !== null && asNumber(input.ratingBelow) >= 0 ? asNumber(input.ratingBelow) : null,
    activeUserDays:
      asInteger(input.activeUserDays) !== null && asInteger(input.activeUserDays) > 0
        ? asInteger(input.activeUserDays)
        : DEFAULT_ACTIVE_USER_DAYS,
  };
}

function normalizeActions(input = {}) {
  const tag = String(input.tag || "").trim() || null;
  const leavingSoonDays = asInteger(input.leavingSoonDays);
  return {
    tag,
    leavingSoon: asBoolean(input.leavingSoon, false),
    leavingSoonDays: leavingSoonDays !== null && leavingSoonDays > 0 ? leavingSoonDays : 14,
    leavingSoonCollection: String(input.leavingSoonCollection || "").trim() || LEAVING_SOON_COLLECTION,
    unmonitor: asBoolean(input.unmonitor, false),
    delete: asBoolean(input.delete, false),
  };
}

function normalizeRuleInput(input = {}, { isCreate = false } = {}) {
  const name = String(input.name || "").trim();
  const libraryId = String(input.libraryId || input.library_id || "").trim();
  if (!name) throw httpError("A rule name is required");
  if (!libraryId) throw httpError("A library is required");
  const rule = {
    name,
    library_id: libraryId,
    conditions: normalizeConditions(input.conditions || {}),
    actions: normalizeActions(input.actions || {}),
    enabled: isCreate ? false : asBoolean(input.enabled, false),
    dry_run: isCreate ? true : input.dry_run === undefined && input.dryRun === undefined ? true : asBoolean(input.dry_run ?? input.dryRun, true),
  };
  return rule;
}

function daysAgo(now, days) {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

function parseDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isActiveUser(user, now, activeUserDays) {
  const last = parseDate(user.lastActivity || user.LastActivityDate);
  if (!last) return false;
  return last >= daysAgo(now, activeUserDays);
}

function matchesConditions(item, conditions, context) {
  const now = context.now || new Date();
  const unwatchedDays = conditions.unwatchedDays;
  if (unwatchedDays !== null) {
    const lastPlayed = parseDate(item.lastPlayed);
    if (lastPlayed && lastPlayed >= daysAgo(now, unwatchedDays)) return false;
  }

  if (conditions.watchedBy === "all" || conditions.watchedBy === "active") {
    const users = conditions.watchedBy === "active"
      ? (context.users || []).filter((user) => isActiveUser(user, now, conditions.activeUserDays))
      : context.users || [];
    if (!users.length) return false;
    const watchers = new Set((item.watchers || []).map((id) => String(id)));
    if (users.some((user) => !watchers.has(String(user.id || user.Id)))) return false;
  }

  if (conditions.addedDays !== null) {
    const added = parseDate(item.added);
    if (!added || added >= daysAgo(now, conditions.addedDays)) return false;
  }

  if (conditions.sizeGb !== null) {
    const size = Number(item.size || 0);
    if (!(size > conditions.sizeGb * GB)) return false;
  }

  if (conditions.ratingBelow !== null) {
    const rating = asNumber(item.rating);
    if (rating === null || !(rating < conditions.ratingBelow)) return false;
  }

  return true;
}

function planActions(item, actions) {
  const steps = [];
  if (actions.tag) steps.push({ type: "tag", tag: actions.tag });
  if (actions.leavingSoon) {
    steps.push({
      type: "leavingSoon",
      collection: actions.leavingSoonCollection,
      days: actions.leavingSoonDays,
    });
  }
  if (actions.unmonitor) steps.push({ type: "unmonitor", mediaType: item.type });
  if (actions.delete) steps.push({ type: "delete", mediaType: item.type, deleteFiles: true });
  return steps;
}

function previewItems(items, rule, context = {}) {
  const excludedIds = new Set((context.exclusions || []).map((row) => String(row.item_id || row.itemId)));
  const matches = [];
  let excludedCount = 0;
  for (const item of items || []) {
    if (excludedIds.has(String(item.id))) {
      excludedCount += 1;
      continue;
    }
    if (!matchesConditions(item, rule.conditions, context)) continue;
    matches.push({
      ...item,
      actions: planActions(item, rule.actions),
    });
  }
  const bytes = matches.reduce((sum, item) => sum + (Number(item.size) || 0), 0);
  return {
    matches,
    count: matches.length,
    bytes,
    excludedCount,
    dryRun: rule.dry_run !== false,
    enabled: Boolean(rule.enabled),
    automationAllowed: automationAllowed(),
  };
}

function formatRuleRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    libraryId: row.library_id,
    libraryName: row.library_name || null,
    enabled: Boolean(row.enabled),
    dryRun: row.dry_run !== false,
    conditions: normalizeConditions(row.conditions || {}),
    actions: normalizeActions(row.actions || {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function listLibraries() {
  const { rows } = await db.query(
    `SELECT l."Id" AS id, l."Name" AS name, l."CollectionType" AS collection_type
       FROM jf_libraries l
      WHERE l.archived IS NOT TRUE
      ORDER BY l."Name"`
  );
  return rows;
}

async function listRules() {
  const { rows } = await db.query(
    `SELECT r.*, l."Name" AS library_name
       FROM jg_cleanup_rules r
       LEFT JOIN jf_libraries l ON l."Id" = r.library_id
      ORDER BY r.created_at ASC`
  );
  return rows.map(formatRuleRow);
}

async function getRule(id) {
  const { rows } = await db.query(
    `SELECT r.*, l."Name" AS library_name
       FROM jg_cleanup_rules r
       LEFT JOIN jf_libraries l ON l."Id" = r.library_id
      WHERE r.id = $1`,
    [id]
  );
  const rule = formatRuleRow(rows[0]);
  if (!rule) throw httpError("Rule not found", 404);
  return rule;
}

async function createRule(input) {
  const rule = normalizeRuleInput(input, { isCreate: true });
  const { rows } = await db.query(
    `INSERT INTO jg_cleanup_rules (name, library_id, enabled, dry_run, conditions, actions)
     VALUES ($1, $2, false, true, $3::jsonb, $4::jsonb)
     RETURNING *`,
    [rule.name, rule.library_id, JSON.stringify(rule.conditions), JSON.stringify(rule.actions)]
  );
  return formatRuleRow(rows[0]);
}

async function updateRule(id, input) {
  const existing = await getRule(id);
  const rule = normalizeRuleInput({ ...existing, ...input, libraryId: input.libraryId || input.library_id || existing.libraryId }, { isCreate: false });
  const { rows } = await db.query(
    `UPDATE jg_cleanup_rules
        SET name = $2,
            library_id = $3,
            enabled = $4,
            dry_run = $5,
            conditions = $6::jsonb,
            actions = $7::jsonb,
            updated_at = NOW()
      WHERE id = $1
      RETURNING *`,
    [id, rule.name, rule.library_id, rule.enabled, rule.dry_run, JSON.stringify(rule.conditions), JSON.stringify(rule.actions)]
  );
  return formatRuleRow(rows[0]);
}

async function deleteRule(id) {
  await getRule(id);
  await db.query(`DELETE FROM jg_cleanup_rules WHERE id = $1`, [id]);
  return { ok: true };
}

async function listExclusions(ruleId) {
  const { rows } = await db.query(
    `SELECT id, rule_id, item_id, item_name, reason, created_at
       FROM jg_cleanup_exclusions
      WHERE rule_id = $1
      ORDER BY created_at DESC`,
    [ruleId]
  );
  return rows.map((row) => ({
    id: row.id,
    ruleId: row.rule_id,
    itemId: row.item_id,
    itemName: row.item_name,
    reason: row.reason,
    createdAt: row.created_at,
  }));
}

async function addExclusion({ ruleId, itemId, itemName, reason }) {
  await getRule(ruleId);
  const id = String(itemId || "").trim();
  if (!id) throw httpError("An item is required");
  const { rows } = await db.query(
    `INSERT INTO jg_cleanup_exclusions (rule_id, item_id, item_name, reason)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (rule_id, item_id) DO UPDATE SET item_name = EXCLUDED.item_name, reason = EXCLUDED.reason
     RETURNING *`,
    [ruleId, id, String(itemName || "").trim() || null, String(reason || "").trim() || null]
  );
  const row = rows[0];
  return { id: row.id, ruleId: row.rule_id, itemId: row.item_id, itemName: row.item_name, reason: row.reason, createdAt: row.created_at };
}

async function removeExclusion(id) {
  const { rowCount } = await db.query(`DELETE FROM jg_cleanup_exclusions WHERE id = $1`, [id]);
  if (!rowCount) throw httpError("Exclusion not found", 404);
  return { ok: true };
}

async function loadUsers() {
  const { rows } = await db.query(
    `SELECT "Id" AS id, "Name" AS name, "LastActivityDate" AS last_activity
       FROM jf_users`
  );
  return rows.map((row) => ({ id: row.id, name: row.name, lastActivity: row.last_activity }));
}

async function loadLibraryItems(libraryId) {
  const { rows } = await db.query(
    `SELECT i."Id" AS id,
            i."Name" AS name,
            i."Type" AS type,
            i."ParentId" AS library_id,
            i."CommunityRating" AS rating,
            i."DateCreated" AS added,
            i."ProductionYear" AS year,
            COALESCE(ii."Size", ep.episode_size, 0) AS size,
            act.last_played,
            act.watchers
       FROM jf_library_items i
       LEFT JOIN jf_item_info ii ON ii."Id" = i."Id"
       LEFT JOIN LATERAL (
         SELECT SUM(im."Size") AS episode_size
           FROM jf_library_seasons s
           JOIN jf_library_episodes e ON e."SeasonId" = s."Id"
           JOIN jf_item_info im ON im."Id" = e."EpisodeId"
          WHERE s."SeriesId" = i."Id"
       ) ep ON TRUE
       LEFT JOIN LATERAL (
         SELECT MAX(a."ActivityDateInserted") AS last_played,
                ARRAY_AGG(DISTINCT a."UserId") FILTER (WHERE a."UserId" IS NOT NULL) AS watchers
           FROM jf_playback_activity a
          WHERE a."NowPlayingItemId" = i."Id"
             OR a."SeasonId" IN (SELECT s."Id" FROM jf_library_seasons s WHERE s."SeriesId" = i."Id")
             OR a."EpisodeId" IN (
                  SELECT e."EpisodeId"
                    FROM jf_library_episodes e
                    JOIN jf_library_seasons s ON s."Id" = e."SeasonId"
                   WHERE s."SeriesId" = i."Id"
                )
       ) act ON TRUE
      WHERE i."ParentId" = $1
        AND i.archived IS NOT TRUE
        AND i."Type" IN ('Movie', 'Series')
      ORDER BY i."Name"`,
    [libraryId]
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    type: row.type,
    libraryId: row.library_id,
    rating: row.rating,
    added: row.added,
    year: row.year,
    size: Number(row.size) || 0,
    lastPlayed: row.last_played,
    watchers: row.watchers || [],
  }));
}

async function previewRule(id, { now } = {}) {
  const rule = await getRule(id);
  const [items, users, exclusions] = await Promise.all([loadLibraryItems(rule.libraryId), loadUsers(), listExclusions(id)]);
  const preview = previewItems(items, { ...rule, conditions: rule.conditions, actions: rule.actions, dry_run: rule.dryRun, enabled: rule.enabled }, { now: now || new Date(), users, exclusions });
  return { rule, ...preview };
}

function defaultArrClients() {
  return {
    async unmonitor() {
      throw httpError("Arr client is not configured", 503);
    },
    async delete() {
      throw httpError("Arr client is not configured", 503);
    },
  };
}

async function builtInArrClients() {
  const integrations = await getIntegrations().catch(() => ({ arrApps: [] }));
  const apps = integrations.arrApps || [];
  return {
    apps,
    async unmonitor() {
      throw httpError("Live Arr changes are only made through an injected client during a confirmed run", 503);
    },
    async delete() {
      throw httpError("Live Arr changes are only made through an injected client during a confirmed run", 503);
    },
  };
}

async function executeStep(step, item, { jellyfin, arr, dryRun }) {
  if (dryRun) return { ...step, status: "dry-run" };
  if (step.type === "tag") {
    if (!jellyfin?.addTag) throw httpError("Jellyfin client is missing addTag", 500);
    await jellyfin.addTag(item.id, step.tag);
    return { ...step, status: "done" };
  }
  if (step.type === "leavingSoon") {
    if (!jellyfin?.addToCollection) throw httpError("Jellyfin client is missing addToCollection", 500);
    await jellyfin.addToCollection(item.id, step.collection, { countdownDays: step.days });
    return { ...step, status: "done" };
  }
  if (step.type === "unmonitor") {
    if (!arr?.unmonitor) throw httpError("Arr client is missing unmonitor", 500);
    await arr.unmonitor(item);
    return { ...step, status: "done" };
  }
  if (step.type === "delete") {
    if (!arr?.delete) throw httpError("Arr client is missing delete", 500);
    await arr.delete(item, { deleteFiles: true });
    return { ...step, status: "done" };
  }
  return { ...step, status: "skipped" };
}

async function recordRun({ rule, preview, dryRun, status, message, createdBy, items }) {
  const { rows } = await db.query(
    `INSERT INTO jg_cleanup_runs (rule_id, dry_run, status, match_count, bytes, message, created_by, finished_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
     RETURNING *`,
    [rule.id, dryRun, status, preview.count, preview.bytes, message || null, createdBy || null]
  );
  const run = rows[0];
  for (const item of items || []) {
    await db.query(
      `INSERT INTO jg_cleanup_run_items (run_id, item_id, item_name, bytes, actions)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [run.id, item.id, item.name, item.size || 0, JSON.stringify(item.actions || [])]
    );
  }
  return formatRun(run, items);
}

function formatRun(row, items) {
  return {
    id: row.id,
    ruleId: row.rule_id,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    dryRun: row.dry_run !== false,
    status: row.status,
    matchCount: Number(row.match_count) || 0,
    bytes: Number(row.bytes) || 0,
    message: row.message,
    createdBy: row.created_by,
    items: items || undefined,
  };
}

async function listRuns(ruleId) {
  const { rows } = await db.query(
    `SELECT * FROM jg_cleanup_runs WHERE rule_id = $1 ORDER BY started_at DESC LIMIT 50`,
    [ruleId]
  );
  const runs = [];
  for (const row of rows) {
    const items = await db.query(`SELECT item_id, item_name, bytes, actions FROM jg_cleanup_run_items WHERE run_id = $1 ORDER BY item_name`, [row.id]);
    runs.push(
      formatRun(
        row,
        items.rows.map((item) => ({
          id: item.item_id,
          name: item.item_name,
          size: Number(item.bytes) || 0,
          actions: item.actions || [],
        }))
      )
    );
  }
  return runs;
}

async function runRule(id, { confirm = false, createdBy } = {}, { jellyfin, arr, now } = {}) {
  const preview = await previewRule(id, { now });
  const rule = preview.rule;
  if (!confirm) {
    return { needsConfirm: true, ...preview };
  }
  if (!rule.enabled) {
    throw httpError("Enable the rule before running it", 400, "RULE_DISABLED");
  }

  const wantsLive = rule.dryRun === false;
  if (wantsLive && !automationAllowed()) {
    const run = await recordRun({
      rule,
      preview,
      dryRun: true,
      status: "blocked",
      message: "Server automation is disabled, so live cleanup actions were not run",
      createdBy,
      items: preview.matches.map((item) => ({ ...item, actions: item.actions.map((step) => ({ ...step, status: "blocked" })) })),
    });
    throw Object.assign(httpError("Server automation is disabled. Live cleanup actions are blocked.", 403, "AUTOMATION_DISABLED"), { run, preview });
  }

  const dryRun = !wantsLive || !automationAllowed();
  const results = [];
  if (!dryRun) {
    if (!jellyfin || !arr) {
      throw httpError("Live cleanup needs Jellyfin and Arr clients", 500);
    }
  }
  for (const item of preview.matches) {
    const actions = [];
    for (const step of item.actions) {
      actions.push(await executeStep(step, item, { jellyfin, arr: arr || defaultArrClients(), dryRun }));
    }
    results.push({ ...item, actions });
  }

  const run = await recordRun({
    rule,
    preview,
    dryRun,
    status: dryRun ? "dry-run" : "completed",
    message: dryRun ? "Dry run only. No library, tag, collection or Arr changes were made." : "Cleanup actions were applied.",
    createdBy,
    items: results,
  });
  return { needsConfirm: false, dryRun, ...preview, matches: results, run };
}

module.exports = {
  GB,
  DEFAULT_ACTIVE_USER_DAYS,
  LEAVING_SOON_COLLECTION,
  automationAllowed,
  normalizeConditions,
  normalizeActions,
  normalizeRuleInput,
  matchesConditions,
  planActions,
  previewItems,
  isActiveUser,
  listLibraries,
  listRules,
  getRule,
  createRule,
  updateRule,
  deleteRule,
  listExclusions,
  addExclusion,
  removeExclusion,
  previewRule,
  runRule,
  listRuns,
  executeStep,
  builtInArrClients,
};

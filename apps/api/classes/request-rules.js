const db = require("../db");

// Request quotas and auto-approve rules for requests made through JellyGlance.
// Seerr requests made with the JellyGlance API key count as the Seerr admin, so these rules are
// enforced here, and optionally the request is filed as the matching Seerr user instead.

const DEFAULT_RULES = {
  enabled: false,
  movieLimit: 5,
  movieDays: 7,
  tvLimit: 3,
  tvDays: 7,
  exemptAdmins: true,
  requestAsSeerrUser: false,
  autoApproveAll: false,
  users: {},
  routes: [],
};

const routing = require("./request-routing");

let tableReady = null;
function ensureTable() {
  if (!tableReady) {
    tableReady = db
      .query(
        `CREATE TABLE IF NOT EXISTS jg_request_log (
           id bigserial PRIMARY KEY,
           user_key text NOT NULL,
           user_name text,
           media_type text NOT NULL,
           media_id text,
           seerr_request_id text,
           status text,
           created_at timestamptz NOT NULL DEFAULT NOW()
         );
         CREATE INDEX IF NOT EXISTS jg_request_log_user_idx ON jg_request_log (user_key, media_type, created_at);
         CREATE TABLE IF NOT EXISTS jg_request_routing_log (
           id bigserial PRIMARY KEY,
           user_key text,
           user_name text,
           media_type text,
           media_id text,
           title text,
           genres jsonb,
           route_id text,
           route_name text,
           decision text NOT NULL,
           outcome text,
           seerr_request_id text,
           created_at timestamptz NOT NULL DEFAULT NOW()
         );
         CREATE INDEX IF NOT EXISTS jg_request_routing_log_created_idx ON jg_request_routing_log (created_at DESC);`
      )
      .catch((error) => {
        tableReady = null;
        throw error;
      });
  }
  return tableReady;
}

function isAdmin(user) {
  return ["Owner", "Admin"].includes(user?.role);
}

function userKey(user = {}) {
  if (!user || user === "internal") return "";
  const value =
    user.jellyfinUser?.id || user.jellyfinUser?.Id || (user.authMode === "quick-connect" ? user.id : null) || (user.id != null ? `local-${user.id}` : null) || user.username;
  return value == null ? "" : String(value);
}

function userName(user = {}) {
  return user.jellyfinUser?.name || user.jellyfinUser?.Name || user.name || user.username || "Unknown";
}

function clamp(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function userRuleFor(rules, key) {
  return Object.hasOwn(rules.users || {}, key) ? rules.users[key] : {};
}

function normalizeUserRule(rule = {}) {
  const mode = ["default", "unlimited", "custom"].includes(rule.mode) ? rule.mode : "default";
  return {
    mode,
    movieLimit: clamp(rule.movieLimit, DEFAULT_RULES.movieLimit, 0, 999),
    tvLimit: clamp(rule.tvLimit, DEFAULT_RULES.tvLimit, 0, 999),
    autoApprove: ["default", "always", "never"].includes(rule.autoApprove) ? rule.autoApprove : "default",
  };
}

function normalizeRules(input = {}) {
  // Build from entries so user-supplied keys can never write onto an object prototype.
  const users = Object.fromEntries(
    Object.entries(input.users || {})
      .filter(([key]) => key && !UNSAFE_KEYS.has(key))
      .map(([key, rule]) => [String(key), normalizeUserRule(rule)])
  );
  return {
    enabled: Boolean(input.enabled ?? DEFAULT_RULES.enabled),
    movieLimit: clamp(input.movieLimit, DEFAULT_RULES.movieLimit, 0, 999),
    movieDays: clamp(input.movieDays, DEFAULT_RULES.movieDays, 1, 365),
    tvLimit: clamp(input.tvLimit, DEFAULT_RULES.tvLimit, 0, 999),
    tvDays: clamp(input.tvDays, DEFAULT_RULES.tvDays, 1, 365),
    exemptAdmins: Boolean(input.exemptAdmins ?? DEFAULT_RULES.exemptAdmins),
    requestAsSeerrUser: Boolean(input.requestAsSeerrUser ?? DEFAULT_RULES.requestAsSeerrUser),
    autoApproveAll: Boolean(input.autoApproveAll ?? DEFAULT_RULES.autoApproveAll),
    users,
    routes: routing.normalizeRoutes(input.routes),
  };
}

async function getRules() {
  const { rows } = await db.query('SELECT settings FROM app_config where "ID"=1');
  return normalizeRules({ ...DEFAULT_RULES, ...(rows[0]?.settings?.RequestRules || {}) });
}

async function saveRules(next = {}) {
  const { rows } = await db.query('SELECT settings FROM app_config where "ID"=1');
  const settings = rows[0]?.settings || {};
  settings.RequestRules = normalizeRules({ ...DEFAULT_RULES, ...(settings.RequestRules || {}), ...next });
  await db.query('UPDATE app_config SET settings=$1 where "ID"=1', [settings]);
  return settings.RequestRules;
}

function effectiveLimits(rules, user) {
  const key = userKey(user);
  const rule = normalizeUserRule(userRuleFor(rules, key));
  if (!rules.enabled || (rules.exemptAdmins && isAdmin(user)) || rule.mode === "unlimited") return { unlimited: true, rule };
  return {
    unlimited: false,
    rule,
    movie: { limit: rule.mode === "custom" ? rule.movieLimit : rules.movieLimit, days: rules.movieDays },
    tv: { limit: rule.mode === "custom" ? rule.tvLimit : rules.tvLimit, days: rules.tvDays },
  };
}

async function usage(user, rules) {
  await ensureTable();
  const key = userKey(user);
  const limits = effectiveLimits(rules, user);
  const result = { unlimited: limits.unlimited, enabled: rules.enabled };
  for (const type of ["movie", "tv"]) {
    const days = limits[type]?.days || (type === "movie" ? rules.movieDays : rules.tvDays);
    const { rows } = await db.query(
      `SELECT COUNT(*)::int AS used, MIN(created_at) AS oldest FROM jg_request_log
        WHERE user_key = $1 AND media_type = $2 AND created_at > NOW() - ($3 || ' days')::interval AND COALESCE(status,'') <> 'failed'`,
      [key, type, String(days)]
    );
    const oldest = rows[0]?.oldest;
    result[type] = {
      used: rows[0]?.used || 0,
      limit: limits.unlimited ? null : limits[type].limit,
      days,
      nextSlotAt: oldest ? new Date(new Date(oldest).getTime() + days * 86400000).toISOString() : null,
    };
  }
  return result;
}

async function checkQuota(user, mediaType) {
  const rules = await getRules();
  const type = mediaType === "tv" ? "tv" : "movie";
  const current = await usage(user, rules);
  if (current.unlimited) return { allowed: true, rules, usage: current };
  const entry = current[type];
  if (entry.used >= entry.limit) {
    const when = entry.nextSlotAt ? new Date(entry.nextSlotAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "later";
    return {
      allowed: false,
      rules,
      usage: current,
      message:
        entry.limit === 0
          ? `Your account can't request ${type === "tv" ? "TV shows" : "movies"}. Ask a server admin.`
          : `You've used all ${entry.limit} ${type === "tv" ? "TV" : "movie"} requests for the last ${entry.days} days. Your next one frees up on ${when}.`,
    };
  }
  return { allowed: true, rules, usage: current };
}

function shouldAutoApprove(rules, user) {
  const rule = normalizeUserRule(userRuleFor(rules, userKey(user)));
  if (rule.autoApprove === "always") return true;
  if (rule.autoApprove === "never") return false;
  return rules.autoApproveAll || isAdmin(user);
}

async function logRequest(user, mediaType, mediaId, { seerrRequestId = null, status = null } = {}) {
  await ensureTable();
  await db.query(
    `INSERT INTO jg_request_log (user_key, user_name, media_type, media_id, seerr_request_id, status) VALUES ($1,$2,$3,$4,$5,$6)`,
    [userKey(user), userName(user), mediaType === "tv" ? "tv" : "movie", mediaId == null ? null : String(mediaId), seerrRequestId == null ? null : String(seerrRequestId), status]
  );
}

async function allUsage(rules) {
  await ensureTable();
  const { rows } = await db.query(
    `SELECT user_key, MAX(user_name) AS user_name,
            COUNT(*) FILTER (WHERE media_type='movie' AND created_at > NOW() - ($1 || ' days')::interval)::int AS movies,
            COUNT(*) FILTER (WHERE media_type='tv' AND created_at > NOW() - ($2 || ' days')::interval)::int AS tv,
            MAX(created_at) AS last_request
       FROM jg_request_log WHERE COALESCE(status,'') <> 'failed' GROUP BY user_key`,
    [String(rules.movieDays), String(rules.tvDays)]
  );
  return rows;
}

// Combine smart routing rules with the older per-person / everyone switches.
// Returns { approve: bool, decision: "approve"|"hold", route, source }.
function routeRequest(rules, user, { mediaType, genres = [] } = {}) {
  const match = routing.decide(rules.routes || [], { userKey: userKey(user), mediaType: mediaType === "tv" ? "tv" : "movie", genres });
  if (match.action) return { approve: match.action === "approve", decision: match.action, route: match.route, source: "rule" };
  const approve = shouldAutoApprove(rules, user);
  return { approve, decision: approve ? "approve" : "hold", route: null, source: "default" };
}

async function logRouting(user, entry = {}) {
  await ensureTable();
  await db.query(
    `INSERT INTO jg_request_routing_log (user_key, user_name, media_type, media_id, title, genres, route_id, route_name, decision, outcome, seerr_request_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      userKey(user),
      userName(user),
      entry.mediaType === "tv" ? "tv" : "movie",
      entry.mediaId == null ? null : String(entry.mediaId),
      entry.title || null,
      JSON.stringify(entry.genres || []),
      entry.route?.id || null,
      entry.route?.name || null,
      entry.decision,
      entry.outcome || null,
      entry.seerrRequestId == null ? null : String(entry.seerrRequestId),
    ]
  );
}

async function routingLog(limit = 100) {
  await ensureTable();
  const { rows } = await db.query(`SELECT * FROM jg_request_routing_log ORDER BY created_at DESC LIMIT $1`, [Math.min(500, Math.max(1, Number(limit) || 100))]);
  return rows;
}

module.exports = { routeRequest, logRouting, routingLog, getRules, saveRules, checkQuota, usage, logRequest, shouldAutoApprove, allUsage, userKey, isAdmin };

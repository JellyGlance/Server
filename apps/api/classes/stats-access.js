const { isAdmin } = require("./request-rules");

// Who may read whose playback stats and activity on the /stats and /api routes.
// Owners, admins and roles with the Users permission (which is also what full API keys and the
// internal user get from the auth middleware) can read any user. Everyone else only gets their
// own linked media-server user.

// The auth middleware puts the signed-in user on req.user, but a raw sign-in token payload keeps the
// same details under `user`, so accept either shape.
function unwrapTokenUser(user) {
  if (user && typeof user === "object" && !user.authMode && user.user && typeof user.user === "object") {
    return user.user;
  }
  return user;
}

function normalizeUserId(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim().toLowerCase().replace(/-/g, "");
}

// The caller's own Jellyfin/Emby user id, or null for accounts with no linked media-server user
// (local accounts, OIDC logins that didn't match a user, API keys).
function ownMediaUserId(rawUser) {
  const user = unwrapTokenUser(rawUser);
  if (!user || typeof user !== "object") return null;
  const linked = user.jellyfinUser?.id || user.jellyfinUser?.Id;
  if (linked) return String(linked);
  if (user.authMode === "quick-connect" && user.id) return String(user.id);
  return null;
}

function canViewAllUsers(req) {
  const user = unwrapTokenUser(req.user);
  if (user === "internal") return true;
  if (isAdmin(user)) return true;
  return Boolean(req.permissions?.users);
}

function sameUserId(a, b) {
  const left = normalizeUserId(a);
  return Boolean(left) && left === normalizeUserId(b);
}

// Works out which user a stats request is about.
// - admin: whatever was asked for (may be empty)
// - non-admin asking for nothing: their own id (null when the account isn't linked)
// - non-admin asking for their own id: allowed
// - non-admin asking for anyone else: forbidden
function resolveStatsUser(req, requestedUserId) {
  const requested = requestedUserId === undefined || requestedUserId === null || requestedUserId === "" ? null : String(requestedUserId);
  if (canViewAllUsers(req)) {
    return { admin: true, userId: requested, forbidden: false };
  }
  const own = ownMediaUserId(req.user);
  if (requested === null) {
    return { admin: false, userId: own, forbidden: false };
  }
  if (own && sameUserId(requested, own)) {
    return { admin: false, userId: requested, forbidden: false };
  }
  return { admin: false, userId: null, forbidden: true };
}

// The same rules for the server-wide activity lists (history, timelines, "most active"), which can
// also carry a UserId filter. A non-admin may only filter on their own id; anything else is forbidden.
function resolveActivityScope(req, { userId, filters } = {}) {
  const scope = resolveStatsUser(req, userId);
  if (scope.admin || scope.forbidden) return scope;
  const own = scope.userId;
  for (const filter of Array.isArray(filters) ? filters : []) {
    if (!filter || filter.field !== "UserId") continue;
    const asked = [filter.value, ...(typeof filter.in === "string" ? filter.in.split(",") : [])].filter(
      (value) => value !== undefined && value !== null && String(value).trim() !== ""
    );
    if (asked.some((value) => !own || !sameUserId(value, own))) {
      return { admin: false, userId: null, forbidden: true };
    }
  }
  return scope;
}

// Adds "only this user's rows" to a db-helper query. Call it after any search or filters have been
// applied, so nothing later replaces the where list.
function restrictQueryToUser(query, userId, column = 'a."UserId"') {
  query.values = query.values || [];
  query.where = query.where || [];
  query.values.push(normalizeUserId(userId));
  query.where.push({ field: `replace(lower(${column}), '-', '')`, operator: "=", value: `$${query.values.length}` });
  return query;
}

function sendForbidden(res) {
  return res.status(403).json({ error: "You can only view your own activity" });
}

module.exports = {
  canViewAllUsers,
  normalizeUserId,
  ownMediaUserId,
  resolveActivityScope,
  resolveStatsUser,
  restrictQueryToUser,
  sameUserId,
  sendForbidden,
  unwrapTokenUser,
};

// Resolve newsletter campaign recipients from explicit addresses, JellyGlance
// roles, local user groups, and the campaign owner. Pure helpers take a
// directory so tests can run without the database or a live mailer.

const { DEFAULT_ACCESS_ROLES } = require("./role-permissions");

const PICKABLE_ROLES = DEFAULT_ACCESS_ROLES.filter((role) => role !== "Disabled");

function normalizeEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  if (!email || !email.includes("@")) return "";
  return email;
}

function roleForUser(user, userRoles = {}) {
  if (user?.role && typeof user.role === "string") return user.role;
  const id = String(user?.Id || user?.id || "");
  if (id && userRoles[id]) return userRoles[id];
  if (user?.IsAdministrator || user?.Policy?.IsAdministrator || user?.isAdministrator) return "Admin";
  return "Viewer";
}

function userLanguage(user) {
  return (
    user?.language ||
    user?.preferredLanguage ||
    user?.Configuration?.UICulture ||
    user?.Configuration?.SubtitleLanguagePreference ||
    ""
  );
}

function buildDirectoryUsers({
  jellyfinUsers = [],
  localUsers = [],
  userRoles = {},
  excludedUsers = [],
} = {}) {
  const excluded = new Set((excludedUsers || []).map(String));
  const directory = [];
  const seenEmails = new Set();
  const seenIds = new Set();

  for (const user of jellyfinUsers) {
    const id = String(user?.Id || user?.id || "");
    if (!id || excluded.has(id)) continue;
    const email = normalizeEmail(user?.Email || user?.email || user?.Configuration?.Email);
    const entry = {
      id,
      name: user?.Name || user?.name || id,
      email,
      role: roleForUser(user, userRoles),
      source: "jellyfin",
      language: userLanguage(user),
    };
    directory.push(entry);
    seenIds.add(id);
    if (email) seenEmails.add(email);
  }

  for (const user of localUsers) {
    const id = String(user?.id || user?.username || "");
    if (!id || seenIds.has(id)) continue;
    const role = user?.role || "Viewer";
    if (role === "Disabled") continue;
    const email = normalizeEmail(user?.email || user?.Email);
    directory.push({
      id,
      name: user?.username || user?.name || id,
      email,
      role,
      source: "local",
      language: userLanguage(user),
    });
    seenIds.add(id);
    if (email) seenEmails.add(email);
  }

  return directory;
}

function subscriptionMap(subscriptions = []) {
  const map = new Map();
  for (const sub of subscriptions) {
    if (!sub) continue;
    map.set(String(sub.user_id || sub.userId || ""), sub);
  }
  return map;
}

function isOptedOut(sub) {
  return Boolean(sub && sub.opted_in === false);
}

function extrasFrom(sub) {
  if (!sub) return [];
  const extras = typeof sub.extra_recipients === "string" ? JSON.parse(sub.extra_recipients) : sub.extra_recipients || [];
  return extras.map(normalizeEmail).filter(Boolean);
}

function resolveAudienceRecipients({ campaign, directory = [], subscriptions = [] } = {}) {
  const recipients = new Set();
  const audience = campaign?.audience || {};
  const subs = subscriptionMap(subscriptions);
  const type = campaign?.type || "global";
  const roles = Array.isArray(audience.roles) ? audience.roles.filter(Boolean) : [];
  const groups = Array.isArray(audience.groups) ? audience.groups.filter(Boolean) : [];
  const wantedRoles = new Set([...roles, ...groups]);
  const ownerId = String(campaign?.ownerUserId || campaign?.owner_user_id || audience.ownerUserId || "");

  function includeEmail(email) {
    const value = normalizeEmail(email);
    if (value) recipients.add(value);
  }

  (audience.recipients || []).forEach(includeEmail);

  for (const sub of subscriptions) {
    if (sub?.opted_in) extrasFrom(sub).forEach(includeEmail);
  }

  const honourRoles = type === "role" || wantedRoles.size > 0;
  const honourPersonal = type === "personal" || audience.personal === true;
  const honourOwner = Boolean(ownerId);

  for (const user of directory) {
    const sub = subs.get(String(user.id));
    if (isOptedOut(sub)) continue;
    const matchesRole = honourRoles && wantedRoles.size > 0 && wantedRoles.has(user.role);
    const isOwner = honourOwner && String(user.id) === ownerId;
    const isPersonal = honourPersonal && String(user.id) === ownerId;
    if (matchesRole || isOwner || isPersonal) includeEmail(user.email);
  }

  if (honourPersonal && ownerId && !directory.some((user) => String(user.id) === ownerId)) {
    // Owner may only be an email stored on the campaign.
    includeEmail(audience.ownerEmail);
  }

  return [...recipients];
}

function summariseDirectory(directory = []) {
  return directory.map((user) => ({
    id: user.id,
    name: user.name,
    role: user.role,
    source: user.source,
    hasEmail: Boolean(user.email),
    email: user.email || "",
  }));
}

function resolveSelfEmail({ user, directory = [], requestedRecipients } = {}) {
  // requestedRecipients is ignored on purpose: test sends only go to the
  // signed-in admin, never to a free-text address from the request body.
  void requestedRecipients;
  const direct = normalizeEmail(user?.email || user?.Email || user?.oidcUser?.email);
  if (direct) return direct;
  const ids = [user?.id, user?.jellyfinUser?.id, user?.jellyfinUser?.Id].filter(Boolean).map(String);
  const names = [user?.username, user?.name, user?.jellyfinUser?.name, user?.jellyfinUser?.Name]
    .filter(Boolean)
    .map((value) => String(value).trim().toLowerCase());
  const match = directory.find((entry) => ids.includes(String(entry.id)) || names.includes(String(entry.name || "").trim().toLowerCase()));
  return match?.email || "";
}

const NO_SELF_EMAIL_MESSAGE = "Your account has no email address, so a test newsletter cannot be sent. Add an email to your user and try again.";

module.exports = {
  PICKABLE_ROLES,
  normalizeEmail,
  roleForUser,
  buildDirectoryUsers,
  resolveAudienceRecipients,
  summariseDirectory,
  resolveSelfEmail,
  NO_SELF_EMAIL_MESSAGE,
};

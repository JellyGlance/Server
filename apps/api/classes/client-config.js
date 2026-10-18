// What the browser is allowed to see of app_config. /api/getconfig goes to every
// signed-in user and /auth/isConfigured is public, so both go through here.

// Server-only settings. Each has its own admin-only endpoint.
const CLIENT_HIDDEN_SETTINGS = [
  "oidcLinks",
  "UserPreferences",
  "Integrations",
  "IntegrationData",
  "IntegrationHealthHistory",
  "Newsletter",
  "localUsers",
  "AdminAuditLog",
  "ExternalImports",
  "WebhookDeliveryHistory",
  "WebhookCardSettings",
  "KnownJellyfinDevices",
  "JellyfinLastSeen",
  "ThresholdAlerts",
  "ThresholdAlertState",
  "ThresholdAlertLog",
];

const SECRET_KEY = /secret|password|token/i;

function stripSecrets(value) {
  if (Array.isArray(value)) return value.map(stripSecrets);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !SECRET_KEY.test(key)).map(([key, item]) => [key, stripSecrets(item)]));
}

// settings as sent by /api/getconfig (before per-user auth fields are added).
function clientSettings(settings = {}) {
  const next = { ...(settings || {}) };
  for (const key of CLIENT_HIDDEN_SETTINGS) delete next[key];
  if (next.auth) next.auth = stripSecrets(next.auth);
  return next;
}

// The unauthenticated login-page view of the auth mode.
function publicAuth(auth) {
  if (!auth?.mode) return null;
  return { mode: auth.mode, ...(auth.label ? { label: auth.label } : {}) };
}

module.exports = { CLIENT_HIDDEN_SETTINGS, clientSettings, publicAuth, stripSecrets };

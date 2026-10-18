// Small route guards shared by the API and proxy routers (kept here so they're testable).
const ADMIN_ROLES = ["Owner", "Admin"];

// Routes that make the server contact a user-supplied URL need the settings permission
// AND an admin role, so Viewers and dashboard/widget API keys can't use them to probe hosts.
function requireAdminSettings(req, res, next) {
  if (!req.permissions?.settings || !ADMIN_ROLES.includes(req.user?.role)) {
    return res.status(403).json({ message: "Admin role required" });
  }
  return next();
}

// /setconfig and /setexternalurl save and probe the media server address.
const ADMIN_SETTINGS_PATHS = new Set(["/validatesettings", "/setconfig", "/setexternalurl"]);

function isAdminSettingsPath(pathName) {
  return ADMIN_SETTINGS_PATHS.has(String(pathName || "").toLowerCase());
}

module.exports = { requireAdminSettings, isAdminSettingsPath };

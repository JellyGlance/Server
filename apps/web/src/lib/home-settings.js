export const HOME_SETTINGS_STORAGE_PREFIX = "jellyglance_home_settings";
export const LEGACY_HOME_ORDER_STORAGE_KEY = "jellyglance_home_section_order";
export const HOME_LAYOUT_VERSION = 5;

const DEFAULT_HIDDEN_SECTION_IDS = ["seasonGaps", "tdarr", "wizarr", "maintainerr", "bazarr", "prowlarr"];
const INTEGRATION_WIDGET_SECTION_IDS = ["tdarr", "wizarr", "maintainerr", "bazarr", "prowlarr"];

export const HOME_SECTION_DEFINITIONS = [
  { id: "sessions", label: "Active sessions" },
  { id: "streamCapacity", label: "Stream capacity" },
  { id: "overview", label: "Overview" },
  { id: "hall", label: "Hall of Fame" },
  { id: "library", label: "Library health" },
  { id: "catalog", label: "Catalog totals" },
  { id: "milestones", label: "Milestones" },
  { id: "week", label: "This week" },
  { id: "attention", label: "Needs attention" },
  { id: "trends", label: "Today vs last week" },
  { id: "issues", label: "Library issues" },
  { id: "watchParty", label: "Watch party" },
  { id: "watchTonight", label: "Watch tonight" },
  { id: "seasonGaps", label: "Season gaps" },
  { id: "tdarr", label: "Tdarr transcodes" },
  { id: "wizarr", label: "Wizarr invites" },
  { id: "maintainerr", label: "Maintainerr cleanup" },
  { id: "bazarr", label: "Bazarr subtitles" },
  { id: "prowlarr", label: "Prowlarr indexers" },
  { id: "automation", label: "Automation feed" },
  { id: "quickActions", label: "Quick actions" },
  { id: "operations", label: "Operations" },
];

export const DEFAULT_HOME_ORDER = HOME_SECTION_DEFINITIONS.map((section) => section.id);
const KIOSK_DEFAULT_HIDDEN = DEFAULT_HOME_ORDER.filter((sectionId) => sectionId !== "sessions");
export const CURATED_DEFAULT_HOME_ORDER = [
  "sessions",
  "streamCapacity",
  "attention",
  "overview",
  "operations",
  "milestones",
  "week",
  "hall",
  "trends",
  "watchParty",
  "watchTonight",
  "quickActions",
  "library",
  "catalog",
  "issues",
  "seasonGaps",
  "tdarr",
  "wizarr",
  "maintainerr",
  "bazarr",
  "prowlarr",
  "automation",
];

export const DEFAULT_HOME_SETTINGS = {
  order: CURATED_DEFAULT_HOME_ORDER,
  hidden: DEFAULT_HIDDEN_SECTION_IDS,
  pinned: "",
  density: "comfortable",
  autoRotate: false,
  preset: "default",
  title: "",
  theme: "default",
  alertRules: { backupDays: 7, requestThreshold: 1, missingPosterThreshold: 1, streamCap: 0, transcodeCap: 0 },
  dismissedAlerts: {},
  sizes: {
    sessions: "large",
    streamCapacity: "small",
    overview: "large",
    hall: "large",
    operations: "large",
    catalog: "large",
    library: "large",
    milestones: "large",
    week: "large",
    watchTonight: "large",
    tdarr: "small",
    wizarr: "small",
    maintainerr: "small",
    bazarr: "small",
    prowlarr: "small",
  },
  version: HOME_LAYOUT_VERSION,
};

export const HOME_PRESETS = {
  default: {
    label: "Default",
    order: CURATED_DEFAULT_HOME_ORDER,
    hidden: DEFAULT_HIDDEN_SECTION_IDS,
    density: "comfortable",
    sizes: {
      sessions: "large",
      overview: "large",
      attention: "small",
      quickActions: "small",
    },
  },
  admin: {
    label: "Admin",
    order: ["attention", "operations", "quickActions", "automation", "tdarr", "maintainerr", "bazarr", "prowlarr", "wizarr", "sessions", "streamCapacity", "overview", "milestones", "trends", "issues", "week", "hall", "library", "catalog", "seasonGaps", "watchParty", "watchTonight"],
    hidden: ["watchParty", ...INTEGRATION_WIDGET_SECTION_IDS],
    density: "compact",
    sizes: {
      attention: "small",
      operations: "large",
      quickActions: "small",
      automation: "small",
      tdarr: "small",
      maintainerr: "small",
      bazarr: "small",
      prowlarr: "small",
      wizarr: "small",
    },
  },
  family: {
    label: "Family",
    order: ["sessions", "watchTonight", "week", "milestones", "hall", "overview", "trends", "catalog", "operations", "quickActions", "library", "attention", "issues", "seasonGaps", "watchParty", "automation", "tdarr", "wizarr", "maintainerr", "bazarr", "prowlarr"],
    hidden: ["watchParty", "issues", "seasonGaps", "automation", "streamCapacity", ...INTEGRATION_WIDGET_SECTION_IDS],
    density: "comfortable",
    sizes: {
      sessions: "large",
      watchTonight: "large",
      week: "medium",
      hall: "large",
    },
  },
  media: {
    label: "Media Stats",
    order: ["overview", "milestones", "trends", "catalog", "library", "issues", "seasonGaps", "week", "watchParty", "watchTonight", "hall", "sessions", "operations", "quickActions", "attention", "automation", "tdarr", "wizarr", "maintainerr", "bazarr", "prowlarr"],
    hidden: ["automation", ...INTEGRATION_WIDGET_SECTION_IDS],
    density: "comfortable",
    sizes: {
      overview: "large",
      trends: "large",
      catalog: "medium",
      issues: "medium",
    },
  },
  requests: {
    label: "Requests First",
    order: ["attention", "operations", "quickActions", "automation", "wizarr", "maintainerr", "sessions", "week", "milestones", "overview", "hall", "trends", "library", "catalog", "issues", "seasonGaps", "watchParty", "watchTonight", "tdarr", "bazarr", "prowlarr"],
    hidden: DEFAULT_HIDDEN_SECTION_IDS,
    density: "compact",
    sizes: {
      attention: "small",
      operations: "large",
      quickActions: "small",
      maintainerr: "small",
    },
  },
  kiosk: {
    label: "Kiosk",
    order: ["sessions", "overview", "hall", "week", "trends", "watchParty", "watchTonight", "catalog", "library", "milestones", "operations", "attention", "issues", "seasonGaps", "tdarr", "wizarr", "maintainerr", "bazarr", "prowlarr", "automation", "quickActions"],
    hidden: KIOSK_DEFAULT_HIDDEN,
    density: "comfortable",
    sizes: {
      sessions: "large",
      overview: "large",
      hall: "large",
      week: "large",
      trends: "large",
      maintainerr: "small",
    },
  },
};

export const HOME_WIDGET_SIZE_LABELS = {
  small: "Compact",
  medium: "Half width",
  large: "Full width",
};

function insertAtDefaultPosition(order, sectionId) {
  const curatedIndex = CURATED_DEFAULT_HOME_ORDER.indexOf(sectionId);
  for (let index = curatedIndex - 1; index >= 0; index -= 1) {
    const position = order.indexOf(CURATED_DEFAULT_HOME_ORDER[index]);
    if (position >= 0) {
      order.splice(position + 1, 0, sectionId);
      return;
    }
  }
  for (let index = curatedIndex + 1; index < CURATED_DEFAULT_HOME_ORDER.length; index += 1) {
    const position = order.indexOf(CURATED_DEFAULT_HOME_ORDER[index]);
    if (position >= 0) {
      order.splice(position, 0, sectionId);
      return;
    }
  }
  order.push(sectionId);
}

function savedSectionIds(order) {
  const knownSections = new Set(DEFAULT_HOME_ORDER);
  return Array.isArray(order) ? [...new Set(order.filter((sectionId) => knownSections.has(sectionId)))] : [];
}

// Keeps the saved order as-is and slots any widget the layout has never seen
// (one added in a newer release) next to its neighbour in the default layout.
export function normalizeHomeOrder(order) {
  const savedOrder = savedSectionIds(order);
  if (!savedOrder.length) return [...DEFAULT_HOME_ORDER];
  const nextOrder = [...savedOrder];
  CURATED_DEFAULT_HOME_ORDER.filter((sectionId) => !nextOrder.includes(sectionId)).forEach((sectionId) => insertAtDefaultPosition(nextOrder, sectionId));
  return nextOrder;
}

export function getHomeTokenPayload() {
  const token = localStorage.getItem("token");
  if (!token) return null;
  try {
    return JSON.parse(window.atob(token.split(".")[1]?.replace(/-/g, "+").replace(/_/g, "/") || ""));
  } catch {
    return null;
  }
}

export function getHomeSettingsStorageKey(scope = "user") {
  if (scope === "kiosk") return `${HOME_SETTINGS_STORAGE_PREFIX}:kiosk`;
  const payload = getHomeTokenPayload();
  if (!payload) return `${HOME_SETTINGS_STORAGE_PREFIX}:browser`;
  return `${HOME_SETTINGS_STORAGE_PREFIX}:${payload.sub || payload.userid || payload.username || payload.name || "user"}`;
}

function isUntouchedDefinitionOrder(order) {
  const savedOrder = savedSectionIds(order);
  if (!savedOrder.length) return false;
  const savedSet = new Set(savedOrder);
  return JSON.stringify(savedOrder) === JSON.stringify(DEFAULT_HOME_ORDER.filter((sectionId) => savedSet.has(sectionId)));
}

export function normalizeHomeSettings(settings) {
  const source = settings || {};
  const normalized = { ...DEFAULT_HOME_SETTINGS, ...source };
  const knownSections = new Set(DEFAULT_HOME_ORDER);
  const savedVersion = Number(normalized.version || 0);
  const savedOrder = savedSectionIds(source.order);
  const newSectionIds = savedOrder.length ? DEFAULT_HOME_ORDER.filter((sectionId) => !savedOrder.includes(sectionId)) : [];

  // Layouts from before the curated default still carry the old definition
  // order. Move those onto the curated order once, but keep everything else
  // the user picked (pin, visibility, sizes, theme and so on).
  const upgradeOrder = savedVersion < HOME_LAYOUT_VERSION && (!source.preset || source.preset === "custom") && isUntouchedDefinitionOrder(source.order);
  normalized.order = upgradeOrder ? [...CURATED_DEFAULT_HOME_ORDER] : normalizeHomeOrder(normalized.order);
  normalized.hidden = Array.isArray(normalized.hidden) ? [...new Set(normalized.hidden.filter((sectionId) => knownSections.has(sectionId)))] : [];
  // Only widgets this layout has never seen pick up their default visibility;
  // anything the user already showed or hid stays that way.
  normalized.hidden = [...new Set([...normalized.hidden, ...newSectionIds.filter((sectionId) => DEFAULT_HIDDEN_SECTION_IDS.includes(sectionId))])];
  normalized.pinned = knownSections.has(normalized.pinned) ? normalized.pinned : "";
  normalized.density = normalized.density === "compact" ? "compact" : "comfortable";
  normalized.autoRotate = Boolean(normalized.autoRotate);
  normalized.preset = normalized.preset || "custom";
  normalized.title = typeof normalized.title === "string" ? normalized.title : "";
  normalized.theme = ["default", "darker", "neon", "highContrast", "wall"].includes(normalized.theme) ? normalized.theme : "default";
  normalized.alertRules = {
    ...DEFAULT_HOME_SETTINGS.alertRules,
    ...(normalized.alertRules || {}),
  };
  normalized.dismissedAlerts = normalized.dismissedAlerts && typeof normalized.dismissedAlerts === "object" ? normalized.dismissedAlerts : {};
  normalized.sizes = normalized.sizes && typeof normalized.sizes === "object" ? { ...DEFAULT_HOME_SETTINGS.sizes, ...normalized.sizes } : DEFAULT_HOME_SETTINGS.sizes;
  normalized.version = Math.max(savedVersion, HOME_LAYOUT_VERSION);
  return normalized;
}

// True for a layout still on a built-in preset that leads with Active sessions
// (the default layout, Family and Kiosk). Any edit in the widget editor marks a
// layout as custom, so a saved custom order never matches.
function keepsSessionsOnTop(settings, ordered) {
  const preset = settings?.preset && settings.preset !== "custom" ? HOME_PRESETS[settings.preset] : null;
  return Boolean(preset) && preset.order[0] === "sessions" && ordered[0] === "sessions";
}

// The order Home renders in. The pinned widget always leads; Operations is
// lifted while requests need attention, but only for display. On the default
// layout it lands just under Active sessions, which stays on top. The saved
// order is never rewritten by this.
export function getHomeDisplayOrder(settings, { promoteOperations = false } = {}) {
  const hidden = new Set(settings?.hidden || []);
  const pinned = settings?.pinned || "";
  let ordered = normalizeHomeOrder(settings?.order).filter((sectionId) => !hidden.has(sectionId));
  const lift = (sectionId, position = 0) => {
    if (!sectionId || !ordered.includes(sectionId)) return;
    const rest = ordered.filter((id) => id !== sectionId);
    ordered = [...rest.slice(0, position), sectionId, ...rest.slice(position)];
  };
  if (promoteOperations && pinned !== "operations") lift("operations", !pinned && keepsSessionsOnTop(settings, ordered) ? 1 : 0);
  lift(pinned);
  return ordered;
}

export function getRoleDefaultHomeSettings() {
  const payload = getHomeTokenPayload();
  const role = String(payload?.role || payload?.Role || payload?.roles?.[0] || "").toLowerCase();
  if (role.includes("admin") || role.includes("owner") || role.includes("manager")) {
    return normalizeHomeSettings({ ...DEFAULT_HOME_SETTINGS, ...HOME_PRESETS.admin, sizes: HOME_PRESETS.admin.sizes, preset: "admin" });
  }
  return normalizeHomeSettings({ ...DEFAULT_HOME_SETTINGS, ...HOME_PRESETS.family, sizes: HOME_PRESETS.family.sizes, preset: "family" });
}

export function loadHomeSettings(scope = "user") {
  const storageKey = getHomeSettingsStorageKey(scope);
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved) {
      const parsed = JSON.parse(saved);
      const normalized = normalizeHomeSettings(parsed);
      if (scope === "kiosk" && normalized.preset === "kiosk") {
        return normalizeHomeSettings({ ...DEFAULT_HOME_SETTINGS, ...HOME_PRESETS.kiosk, sizes: HOME_PRESETS.kiosk.sizes, preset: "kiosk", autoRotate: false, title: normalized.title || "JellyGlance Kiosk", theme: normalized.theme });
      }
      return normalized;
    }

    if (scope !== "kiosk") {
      const legacyOrder = localStorage.getItem(LEGACY_HOME_ORDER_STORAGE_KEY);
      if (legacyOrder) return normalizeHomeSettings({ order: JSON.parse(legacyOrder) });
      return getRoleDefaultHomeSettings();
    }
  } catch {
    return normalizeHomeSettings(DEFAULT_HOME_SETTINGS);
  }

  return normalizeHomeSettings({ ...DEFAULT_HOME_SETTINGS, ...HOME_PRESETS.kiosk, sizes: HOME_PRESETS.kiosk.sizes, preset: "kiosk", autoRotate: false, title: "JellyGlance Kiosk" });
}

export function saveHomeSettings(settings, scope = "user") {
  const normalized = normalizeHomeSettings(settings);
  localStorage.setItem(getHomeSettingsStorageKey(scope), JSON.stringify(normalized));
  window.dispatchEvent(new CustomEvent("jellyglance-home-settings-updated", { detail: { scope, settings: normalized } }));
  return normalized;
}

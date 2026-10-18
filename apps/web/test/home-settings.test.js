import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";

class MemoryStorage {
  constructor() {
    this.map = new Map();
  }
  get length() {
    return this.map.size;
  }
  key(index) {
    return [...this.map.keys()][index] ?? null;
  }
  getItem(key) {
    return this.map.has(key) ? this.map.get(key) : null;
  }
  setItem(key, value) {
    this.map.set(key, String(value));
  }
  removeItem(key) {
    this.map.delete(key);
  }
  clear() {
    this.map.clear();
  }
}

globalThis.localStorage = new MemoryStorage();
globalThis.window = { atob: (value) => Buffer.from(value, "base64").toString("binary"), dispatchEvent() {} };

const {
  CURATED_DEFAULT_HOME_ORDER,
  DEFAULT_HOME_ORDER,
  DEFAULT_HOME_SETTINGS,
  HOME_LAYOUT_VERSION,
  HOME_PRESETS,
  LEGACY_HOME_ORDER_STORAGE_KEY,
  getHomeDisplayOrder,
  getHomeSettingsStorageKey,
  loadHomeSettings,
  normalizeHomeOrder,
  normalizeHomeSettings,
} = await import("../src/lib/home-settings.js");
const { clearSessionStorage } = await import("../src/lib/auth-storage.js");

const token = `x.${Buffer.from(JSON.stringify({ user: { id: 1, username: "owner", authMode: "quick-connect" }, exp: 1 })).toString("base64url")}.y`;
const userKey = () => getHomeSettingsStorageKey("user");
const saveRaw = (settings) => localStorage.setItem(userKey(), JSON.stringify(settings));

// Order and visibility a v1.2.9 (layout version 4) browser saved, before Watch tonight existed.
const v4Order = CURATED_DEFAULT_HOME_ORDER.filter((sectionId) => sectionId !== "watchTonight");
const v4Layout = {
  order: ["operations", ...v4Order.filter((sectionId) => sectionId !== "operations")],
  hidden: ["seasonGaps", "wizarr", "maintainerr", "bazarr", "prowlarr"],
  pinned: "sessions",
  preset: "custom",
  density: "compact",
  sizes: { sessions: "medium", tdarr: "large" },
  version: 4,
};

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("token", token);
});

describe("home layout across updates", () => {
  test("default orders cover every widget", () => {
    assert.deepEqual([...CURATED_DEFAULT_HOME_ORDER].sort(), [...DEFAULT_HOME_ORDER].sort());
  });

  test("an older saved layout keeps its order, pin, visibility and sizes", () => {
    saveRaw(v4Layout);
    const settings = loadHomeSettings("user");
    assert.equal(settings.pinned, "sessions");
    assert.equal(settings.density, "compact");
    assert.equal(settings.sizes.sessions, "medium");
    assert.equal(settings.sizes.tdarr, "large");
    assert.equal(settings.hidden.includes("tdarr"), false, "Tdarr was visible and should stay visible");
    assert.deepEqual(settings.order.filter((sectionId) => sectionId !== "watchTonight"), v4Layout.order);
    assert.equal(settings.version, HOME_LAYOUT_VERSION);
  });

  test("a widget added in a newer release goes next to its default neighbour", () => {
    saveRaw(v4Layout);
    const { order } = loadHomeSettings("user");
    assert.equal(order.indexOf("watchTonight"), order.indexOf("watchParty") + 1);
  });

  test("new widgets that are hidden by default stay hidden, existing choices don't change", () => {
    saveRaw({ ...v4Layout, order: v4Layout.order.filter((sectionId) => sectionId !== "bazarr"), hidden: [] });
    const settings = loadHomeSettings("user");
    assert.deepEqual(settings.hidden, ["bazarr"]);
  });

  test("showing a widget again sticks after the upgrade", () => {
    saveRaw(v4Layout);
    const loaded = loadHomeSettings("user");
    const shown = normalizeHomeSettings({ ...loaded, hidden: loaded.hidden.filter((sectionId) => sectionId !== "wizarr") });
    assert.equal(shown.hidden.includes("wizarr"), false);
    saveRaw(shown);
    assert.equal(loadHomeSettings("user").hidden.includes("wizarr"), false);
  });

  test("a pre-curated layout moves to the curated order but keeps the pin and sizes", () => {
    saveRaw({ order: DEFAULT_HOME_ORDER, pinned: "sessions", preset: "custom", sizes: { sessions: "medium" }, version: 2 });
    const settings = loadHomeSettings("user");
    assert.deepEqual(settings.order, CURATED_DEFAULT_HOME_ORDER);
    assert.equal(settings.pinned, "sessions");
    assert.equal(settings.sizes.sessions, "medium");
  });

  test("loading is stable once migrated", () => {
    saveRaw(v4Layout);
    const first = loadHomeSettings("user");
    saveRaw(first);
    assert.deepEqual(loadHomeSettings("user"), first);
  });

  test("normalizeHomeOrder leaves a full saved order alone", () => {
    const custom = [...DEFAULT_HOME_ORDER].reverse();
    assert.deepEqual(normalizeHomeOrder(custom), custom);
  });
});

describe("home display order", () => {
  test("Operations moves up while requests need attention, under the pinned widget", () => {
    const settings = normalizeHomeSettings({ ...v4Layout, version: HOME_LAYOUT_VERSION, order: CURATED_DEFAULT_HOME_ORDER });
    const promoted = getHomeDisplayOrder(settings, { promoteOperations: true });
    assert.deepEqual(promoted.slice(0, 2), ["sessions", "operations"]);
    assert.deepEqual(settings.order, CURATED_DEFAULT_HOME_ORDER, "the saved order is not rewritten");
    assert.equal(getHomeDisplayOrder(settings).indexOf("operations"), CURATED_DEFAULT_HOME_ORDER.filter((id) => !settings.hidden.includes(id)).indexOf("operations"));
  });

  test("hidden widgets are not shown even when pinned or promoted", () => {
    const settings = normalizeHomeSettings({ pinned: "sessions", hidden: ["sessions", "operations"] });
    const order = getHomeDisplayOrder(settings, { promoteOperations: true });
    assert.equal(order.includes("sessions"), false);
    assert.equal(order.includes("operations"), false);
  });
});

describe("Active sessions first by default", () => {
  const customOrder = ["overview", "hall", "sessions", ...CURATED_DEFAULT_HOME_ORDER.filter((id) => !["overview", "hall", "sessions"].includes(id))];
  const savedCustom = () => normalizeHomeSettings({ order: customOrder, hidden: [], preset: "custom", density: "compact", sizes: { sessions: "small" } });

  test("a fresh layout starts with Active sessions", () => {
    const settings = loadHomeSettings("user");
    assert.equal(settings.order[0], "sessions");
    assert.equal(getHomeDisplayOrder(settings)[0], "sessions");
    assert.equal(DEFAULT_HOME_SETTINGS.order[0], "sessions");
  });

  test("Active sessions stays on top of the default layout while requests need attention", () => {
    for (const settings of [loadHomeSettings("user"), normalizeHomeSettings(DEFAULT_HOME_SETTINGS)]) {
      assert.deepEqual(getHomeDisplayOrder(settings, { promoteOperations: true }).slice(0, 2), ["sessions", "operations"]);
    }
  });

  test("Reset goes back to the default layout with Active sessions first", () => {
    const reset = normalizeHomeSettings(DEFAULT_HOME_SETTINGS);
    assert.equal(reset.preset, "default");
    assert.deepEqual(reset.order, CURATED_DEFAULT_HOME_ORDER);
    assert.equal(getHomeDisplayOrder(reset, { promoteOperations: true })[0], "sessions");
  });

  test("loading a fresh layout writes nothing to storage", () => {
    const keysBefore = localStorage.length;
    loadHomeSettings("user");
    assert.equal(localStorage.length, keysBefore);
    assert.equal(localStorage.getItem(userKey()), null);
  });

  test("a saved custom order is returned unchanged", () => {
    const stored = JSON.stringify(savedCustom());
    localStorage.setItem(userKey(), stored);
    const settings = loadHomeSettings("user");
    assert.deepEqual(settings.order, customOrder);
    assert.equal(JSON.stringify(settings), stored, "writing the loaded layout back changes nothing");
    assert.equal(localStorage.getItem(userKey()), stored);
  });

  test("a saved custom order renders as before, with or without the Operations lift", () => {
    localStorage.setItem(userKey(), JSON.stringify(savedCustom()));
    const settings = loadHomeSettings("user");
    assert.deepEqual(getHomeDisplayOrder(settings), customOrder);
    assert.deepEqual(getHomeDisplayOrder(settings, { promoteOperations: true }), ["operations", ...customOrder.filter((id) => id !== "operations")]);
  });

  test("a custom order that starts with Active sessions still lets Operations move to the top", () => {
    const settings = normalizeHomeSettings({ order: CURATED_DEFAULT_HOME_ORDER, hidden: [], preset: "custom" });
    assert.equal(getHomeDisplayOrder(settings, { promoteOperations: true })[0], "operations");
  });

  test("a saved custom order missing newer widgets keeps its own order", () => {
    const older = customOrder.filter((id) => !["watchTonight", "prowlarr"].includes(id));
    saveRaw({ order: older, hidden: [], preset: "custom", version: HOME_LAYOUT_VERSION });
    const { order } = loadHomeSettings("user");
    assert.deepEqual(order.filter((id) => older.includes(id)), older);
    assert.equal(order.length, CURATED_DEFAULT_HOME_ORDER.length);
    assert.equal(order[0], "overview");
  });

  test("the legacy saved order is kept as it was", () => {
    localStorage.setItem(LEGACY_HOME_ORDER_STORAGE_KEY, JSON.stringify(customOrder));
    assert.deepEqual(loadHomeSettings("user").order, customOrder);
  });

  test("presets that don't lead with Active sessions behave as before", () => {
    const settings = normalizeHomeSettings({ ...DEFAULT_HOME_SETTINGS, ...HOME_PRESETS.media, preset: "media" });
    assert.equal(getHomeDisplayOrder(settings, { promoteOperations: true })[0], "operations");
  });
});

describe("expired sign-in", () => {
  test("clearing the session keeps the Home layout and drops the token", () => {
    saveRaw({ ...v4Layout, version: HOME_LAYOUT_VERSION });
    localStorage.setItem(getHomeSettingsStorageKey("kiosk"), "{}");
    localStorage.setItem("jellyglance_nav_order", "[]");
    localStorage.setItem("JELLYGLANCE_INTEGRATIONS", "{}");
    localStorage.setItem("config", "{}");
    clearSessionStorage(localStorage);
    assert.equal(localStorage.getItem("token"), null);
    assert.equal(localStorage.getItem("config"), null);
    assert.notEqual(localStorage.getItem("jellyglance_home_settings:user"), null);
    assert.notEqual(localStorage.getItem("jellyglance_home_settings:kiosk"), null);
    assert.equal(localStorage.getItem("jellyglance_nav_order"), "[]");
    assert.equal(localStorage.getItem("JELLYGLANCE_INTEGRATIONS"), "{}");

    localStorage.setItem("token", token);
    assert.equal(loadHomeSettings("user").pinned, "sessions");
  });
});

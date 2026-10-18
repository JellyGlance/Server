import { FIRST_RUN_EXTRAS_KEY } from "./first-run.js";
import { HOME_SETTINGS_STORAGE_PREFIX, LEGACY_HOME_ORDER_STORAGE_KEY } from "./home-settings.js";
import { INTEGRATIONS_STORAGE_KEY } from "./integrations-storage.js";
import { NAV_HIDDEN_STORAGE_KEY, NAV_ORDER_STORAGE_KEY } from "./nav-order.js";

const KEPT_STORAGE_KEYS = new Set([INTEGRATIONS_STORAGE_KEY, FIRST_RUN_EXTRAS_KEY, LEGACY_HOME_ORDER_STORAGE_KEY, NAV_ORDER_STORAGE_KEY, NAV_HIDDEN_STORAGE_KEY]);

export function isKeptAcrossSignOut(key) {
  return KEPT_STORAGE_KEYS.has(key) || String(key).startsWith(`${HOME_SETTINGS_STORAGE_PREFIX}:`);
}

// Drops the session (token, cached config, API caches) when the server rejects
// it, but keeps layout choices so an expired sign-in doesn't reset Home.
export function clearSessionStorage(storage = localStorage) {
  const kept = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key !== null && isKeptAcrossSignOut(key)) kept.push([key, storage.getItem(key)]);
  }
  storage.clear();
  kept.forEach(([key, value]) => {
    if (value !== null) storage.setItem(key, value);
  });
}

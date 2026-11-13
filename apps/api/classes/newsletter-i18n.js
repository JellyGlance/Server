const fs = require("fs");
const path = require("path");

const FALLBACK_LOCALE = "en-GB";
const LOCALES_ROOT = path.resolve(__dirname, "../../web/public/locales");

const cache = new Map();

function listLocales() {
  try {
    return fs
      .readdirSync(LOCALES_ROOT, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [FALLBACK_LOCALE];
  }
}

function readBundle(locale) {
  if (cache.has(locale)) return cache.get(locale);
  const filePath = path.join(LOCALES_ROOT, locale, "translation.json");
  try {
    const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const bundle = {
      ...((data.FEATURES && data.FEATURES.NEWSLETTER) || {}),
      ...((data.FEATURES && data.FEATURES.NEWSLETTER_EMAIL) || {}),
    };
    cache.set(locale, bundle);
    return bundle;
  } catch {
    cache.set(locale, {});
    return {};
  }
}

function resolveLocale(preferred, fallback = FALLBACK_LOCALE) {
  const available = listLocales();
  const requested = String(preferred || "").trim();
  if (!requested) return available.includes(fallback) ? fallback : available[0] || FALLBACK_LOCALE;
  const candidates = [requested];
  if (requested.includes("-")) candidates.push(requested.split("-")[0]);
  if (requested.toLowerCase() === "en" || requested.toLowerCase().startsWith("en-")) {
    candidates.push("en-GB", "en-US");
  }
  for (const candidate of candidates) {
    const exact = available.find((locale) => locale.toLowerCase() === candidate.toLowerCase());
    if (exact) return exact;
    const prefix = available.find((locale) => locale.toLowerCase().startsWith(`${candidate.toLowerCase()}-`));
    if (prefix) return prefix;
  }
  return available.includes(fallback) ? fallback : available[0] || FALLBACK_LOCALE;
}

function interpolate(text, vars = {}) {
  return String(text || "").replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (match, key) => {
    return vars[key] != null ? String(vars[key]) : match;
  });
}

function translate(locale, key, vars = {}) {
  const resolved = resolveLocale(locale);
  const primary = readBundle(resolved);
  const fallback = resolved === FALLBACK_LOCALE ? {} : readBundle(FALLBACK_LOCALE);
  const text = primary[key] || fallback[key] || key;
  return interpolate(text, vars);
}

function translator(locale) {
  const resolved = resolveLocale(locale);
  return {
    locale: resolved,
    t: (key, vars) => translate(resolved, key, vars),
  };
}

function localeForRecipient(recipient = {}, fallback = FALLBACK_LOCALE) {
  return resolveLocale(recipient.language || recipient.preferredLanguage || recipient.locale, fallback);
}

function clearLocaleCache() {
  cache.clear();
}

module.exports = {
  FALLBACK_LOCALE,
  LOCALES_ROOT,
  listLocales,
  resolveLocale,
  translate,
  translator,
  localeForRecipient,
  clearLocaleCache,
};

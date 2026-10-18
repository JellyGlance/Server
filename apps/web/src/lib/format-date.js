import i18n from "i18next";

// Shared locale-aware date and number formatting. Follows the current i18next
// language and falls back to en-GB when the language is missing or unusable.
export const FALLBACK_LOCALE = "en-GB";

const dateFormatters = new Map();
const numberFormatters = new Map();

function currentLanguage() {
  return i18n.resolvedLanguage || i18n.language;
}

export function resolveLocale(language = currentLanguage()) {
  if (typeof language !== "string" || !language || language === "cimode") return FALLBACK_LOCALE;
  try {
    const [supported] = Intl.DateTimeFormat.supportedLocalesOf(language);
    return supported || FALLBACK_LOCALE;
  } catch {
    // Malformed language tag.
    return FALLBACK_LOCALE;
  }
}

function cached(cache, Formatter, locale, options) {
  const key = `${locale}|${JSON.stringify(options || {})}`;
  let formatter = cache.get(key);
  if (!formatter) {
    formatter = new Formatter(locale, options);
    cache.set(key, formatter);
  }
  return formatter;
}

export function formatDate(value, options, { locale, fallback = "" } = {}) {
  if (!value) return fallback;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return cached(dateFormatters, Intl.DateTimeFormat, resolveLocale(locale), options).format(date);
}

export function formatNumber(value, options, { locale } = {}) {
  const number = Number(value || 0);
  return cached(numberFormatters, Intl.NumberFormat, resolveLocale(locale), options).format(Number.isFinite(number) ? number : 0);
}

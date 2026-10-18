import { afterEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import i18n from "i18next";
import { FALLBACK_LOCALE, formatDate, formatNumber, resolveLocale } from "../src/lib/format-date.js";

const SAMPLE = "2026-03-07T09:05:00Z";
const PAGE_OPTIONS = [
  { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" },
  { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" },
  { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" },
  { day: "numeric", month: "short", year: "numeric" },
];

await i18n.init({ lng: "en-GB", fallbackLng: "en-GB", resources: {}, initAsync: false });

afterEach(async () => {
  await i18n.changeLanguage("en-GB");
});

describe("resolveLocale", () => {
  test("uses the current i18next language", async () => {
    await i18n.changeLanguage("de-DE");
    assert.equal(resolveLocale(), "de-DE");
  });

  test("falls back to en-GB for missing, malformed or unsupported languages", () => {
    assert.equal(FALLBACK_LOCALE, "en-GB");
    assert.equal(resolveLocale(""), "en-GB");
    assert.equal(resolveLocale(null), "en-GB");
    assert.equal(resolveLocale("cimode"), "en-GB");
    assert.equal(resolveLocale("not_a locale!"), "en-GB");
  });
});

describe("formatDate", () => {
  test("en-GB output matches the old hard-coded formatters", () => {
    for (const options of PAGE_OPTIONS) {
      assert.equal(formatDate(SAMPLE, options), new Intl.DateTimeFormat("en-GB", options).format(new Date(SAMPLE)));
    }
  });

  test("follows the i18next language and updates when it changes", async () => {
    const options = PAGE_OPTIONS[3];
    const english = formatDate(SAMPLE, options);
    await i18n.changeLanguage("de-DE");
    const german = formatDate(SAMPLE, options);
    assert.equal(german, new Intl.DateTimeFormat("de-DE", options).format(new Date(SAMPLE)));
    assert.notEqual(german, english);
    await i18n.changeLanguage("en-US");
    assert.equal(formatDate(SAMPLE, options), new Intl.DateTimeFormat("en-US", options).format(new Date(SAMPLE)));
  });

  test("an explicit locale wins over the i18next language", () => {
    assert.equal(formatDate(SAMPLE, PAGE_OPTIONS[0], { locale: "fr-FR" }), new Intl.DateTimeFormat("fr-FR", PAGE_OPTIONS[0]).format(new Date(SAMPLE)));
  });

  test("returns the fallback for empty or invalid dates instead of throwing", () => {
    assert.equal(formatDate(null, PAGE_OPTIONS[0], { fallback: "Never" }), "Never");
    assert.equal(formatDate("", PAGE_OPTIONS[0], { fallback: "Never" }), "Never");
    assert.equal(formatDate("not a date", PAGE_OPTIONS[0], { fallback: "Unknown" }), "Unknown");
    assert.equal(formatDate(new Date(Number.NaN), PAGE_OPTIONS[0]), "");
  });

  test("a malformed locale falls back to en-GB", () => {
    assert.equal(formatDate(SAMPLE, PAGE_OPTIONS[1], { locale: "@@" }), new Intl.DateTimeFormat("en-GB", PAGE_OPTIONS[1]).format(new Date(SAMPLE)));
  });
});

describe("formatNumber", () => {
  test("matches en-GB by default and follows the language", async () => {
    assert.equal(formatNumber(1234567), "1,234,567");
    await i18n.changeLanguage("de-DE");
    assert.equal(formatNumber(1234567), "1.234.567");
  });

  test("treats empty and non-numeric values as zero", () => {
    assert.equal(formatNumber(undefined), "0");
    assert.equal(formatNumber("abc"), "0");
  });
});

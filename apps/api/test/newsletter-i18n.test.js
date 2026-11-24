const test = require("node:test");
const assert = require("node:assert/strict");

const i18n = require("../classes/newsletter-i18n");

test("preferred language falls back to English when the locale is missing", () => {
  assert.equal(i18n.resolveLocale("de"), "de-DE");
  assert.equal(i18n.resolveLocale("de-DE"), "de-DE");
  assert.equal(i18n.resolveLocale("fr-CA"), "fr-FR");
  assert.equal(i18n.resolveLocale("xx-ZZ"), "en-GB");
  assert.equal(i18n.resolveLocale(""), "en-GB");
  assert.equal(i18n.resolveLocale("en-US"), "en-US");
});

test("newsletter strings use the recipient language and fall back to English", () => {
  assert.equal(i18n.translate("en-GB", "RECENTLY_ADDED"), "Recently Added");
  assert.equal(i18n.translate("de", "RECENTLY_ADDED"), "Kürzlich hinzugefügt");
  assert.equal(i18n.translate("de", "GENERATED", { date: "12/11/2026" }), "Erstellt 12/11/2026");
  assert.equal(i18n.localeForRecipient({ language: "es-MX" }), "es-ES");
  assert.equal(i18n.translate("de", "NOT_A_REAL_KEY"), "NOT_A_REAL_KEY");
});

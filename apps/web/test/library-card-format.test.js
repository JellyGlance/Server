import { afterEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import i18n from "i18next";
import {
  UNKNOWN_LIBRARY_SIZE,
  formatFileSize,
  formatLastPlayedLabel,
  formatLibrarySize,
  optionalTranslation,
} from "../src/pages/components/library/library-card-format.js";

const resources = {
  "en-GB": {
    translation: {
      "USERS_PAGE": { AGO_ALT: "", AGO: "Ago" },
      "UNITS": { DAY: "Day", DAYS: "Days", HOUR: "Hour", HOURS: "Hours", MINUTE: "Minute", MINUTES: "Minutes" },
      "ERROR_MESSAGES": { NEVER: "Never" },
    },
  },
  "fr-FR": {
    translation: {
      "USERS_PAGE": { AGO_ALT: "Il y a", AGO: "" },
      "UNITS": { DAY: "Jour", DAYS: "Jours", HOUR: "Heure", HOURS: "Heures", MINUTE: "Minute", MINUTES: "Minutes" },
      "ERROR_MESSAGES": { NEVER: "Jamais" },
    },
  },
  "de-DE": {
    translation: {
      "USERS_PAGE": { AGO_ALT: "", AGO: "vor" },
      "UNITS": { DAY: "Tag", DAYS: "Tage", HOUR: "Stunde", HOURS: "Stunden", MINUTE: "Minute", MINUTES: "Minuten" },
      "ERROR_MESSAGES": { NEVER: "Nie" },
    },
  },
};

await i18n.init({
  lng: "en-GB",
  fallbackLng: "en-GB",
  resources,
  initAsync: false,
  interpolation: { escapeValue: false },
});

afterEach(async () => {
  await i18n.changeLanguage("en-GB");
});

describe("formatLibrarySize", () => {
  test("formats a real byte size", () => {
    assert.equal(formatLibrarySize(21 * 1024), "21.00 KB");
    assert.equal(formatLibrarySize(1024 * 1024), "1.00 MB");
    assert.equal(formatLibrarySize("99689420109"), formatFileSize(99689420109));
  });

  test("shows an em dash when the size is missing, empty or unknown", () => {
    assert.equal(UNKNOWN_LIBRARY_SIZE, "—");
    assert.equal(formatLibrarySize(undefined), "—");
    assert.equal(formatLibrarySize(null), "—");
    assert.equal(formatLibrarySize(""), "—");
    assert.equal(formatLibrarySize(0), "—");
    assert.equal(formatLibrarySize("0"), "—");
    assert.equal(formatLibrarySize(-12), "—");
    assert.equal(formatLibrarySize(Number.NaN), "—");
    assert.equal(formatLibrarySize("not-a-size"), "—");
  });

  test("never returns 0.00 KB", () => {
    const samples = [undefined, null, "", 0, "0", 0.0, "0.0", -1, Number.NaN, "abc"];
    for (const sample of samples) {
      assert.notEqual(formatLibrarySize(sample), "0.00 KB");
    }
  });
});

describe("formatLastPlayedLabel", () => {
  test("English uses the duration and suffix, not the empty AGO_ALT key", () => {
    assert.equal(i18n.t("USERS_PAGE.AGO_ALT"), "USERS_PAGE.AGO_ALT");
    assert.equal(optionalTranslation("USERS_PAGE.AGO_ALT"), "");
    assert.equal(formatLastPlayedLabel({ days: 64 }), "64 Days ago");
    assert.equal(formatLastPlayedLabel({ days: 1, hours: 2 }), "1 Day 2 Hours ago");
    assert.doesNotMatch(formatLastPlayedLabel({ days: 64 }), /USERS_PAGE\.AGO/);
  });

  test("French uses the prefix and omits the empty suffix", async () => {
    await i18n.changeLanguage("fr-FR");
    assert.equal(formatLastPlayedLabel({ days: 64 }), "Il y a 64 Jours");
    assert.doesNotMatch(formatLastPlayedLabel({ days: 64 }), /USERS_PAGE\.AGO/);
  });

  test("German uses the suffix and omits the empty prefix", async () => {
    await i18n.changeLanguage("de-DE");
    assert.equal(formatLastPlayedLabel({ days: 64 }), "64 Tage vor");
    assert.doesNotMatch(formatLastPlayedLabel({ days: 64 }), /USERS_PAGE\.AGO/);
  });

  test("falls back to Never when there is no last activity", async () => {
    assert.equal(formatLastPlayedLabel(null), "Never");
    assert.equal(formatLastPlayedLabel(undefined), "Never");
    assert.equal(formatLastPlayedLabel({}), "Never");
    await i18n.changeLanguage("fr-FR");
    assert.equal(formatLastPlayedLabel(null), "Jamais");
  });
});

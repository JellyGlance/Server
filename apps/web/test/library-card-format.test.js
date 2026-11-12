import { afterEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import i18n from "i18next";
import {
  UNKNOWN_LIBRARY_SIZE,
  formatCompactDurationFromSeconds,
  formatCompactDurationFromTicks,
  formatCompactLibrarySize,
  formatFileSize,
  formatLastPlayedLabel,
  formatLibrarySize,
  libraryCardStatTiles,
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

describe("formatCompactDuration", () => {
  test("shortens long durations to days and hours", () => {
    assert.equal(formatCompactDurationFromSeconds((17 * 86400) + (4 * 3600) + (48 * 60)), "17d 4h");
    assert.equal(formatCompactDurationFromSeconds(3 * 86400), "3d");
  });

  test("uses hours and minutes when shorter than a day", () => {
    assert.equal(formatCompactDurationFromSeconds((3 * 3600) + (12 * 60)), "3h 12m");
    assert.equal(formatCompactDurationFromSeconds(2 * 3600), "2h");
    assert.equal(formatCompactDurationFromSeconds(45 * 60), "45m");
    assert.equal(formatCompactDurationFromSeconds(0), "0m");
  });

  test("converts ticks the same way", () => {
    const ticks = ((17 * 86400) + (4 * 3600)) * 10000000;
    assert.equal(formatCompactDurationFromTicks(ticks), "17d 4h");
    assert.equal(formatCompactDurationFromTicks("6000000000"), "10m");
    assert.equal(formatCompactDurationFromTicks(0), "0m");
    assert.equal(formatCompactDurationFromTicks(null), "0m");
  });
});

describe("libraryCardStatTiles", () => {
  const base = {
    plays: 148,
    episodeCount: 450,
    librarySize: 288034549755,
    files: 458,
    seasonCount: 68,
    totalTimeTicks: ((17 * 86400) + (4 * 3600)) * 10000000,
    playbackSeconds: (2 * 86400) + (11 * 3600),
  };

  test("TV libraries include episodes and seasons", () => {
    const keys = libraryCardStatTiles({ ...base, collectionType: "tvshows" }).map((tile) => tile.key);
    assert.deepEqual(keys, ["plays", "episodes", "size", "files", "seasons", "totalTime", "playback"]);
    const tiles = Object.fromEntries(libraryCardStatTiles({ ...base, collectionType: "tvshows" }).map((tile) => [tile.key, tile.value]));
    assert.equal(tiles.episodes, "450");
    assert.equal(tiles.seasons, "68");
    assert.equal(tiles.size, "268 GB");
    assert.equal(tiles.totalTime, "17d 4h");
    assert.equal(tiles.playback, "2d 11h");
  });

  test("movies, music and books omit episodes and seasons", () => {
    for (const type of ["movies", "music", "books"]) {
      const keys = libraryCardStatTiles({ ...base, collectionType: type }).map((tile) => tile.key);
      assert.deepEqual(keys, ["plays", "size", "files", "totalTime", "playback"], type);
    }
  });

  test("keeps an em dash for an unknown size", () => {
    const tiles = libraryCardStatTiles({ ...base, collectionType: "books", librarySize: null });
    assert.equal(tiles.find((tile) => tile.key === "size").value, "—");
  });
});

describe("formatCompactLibrarySize", () => {
  test("uses a short form that fits overview tiles", () => {
    assert.equal(formatCompactLibrarySize(288034549755), "268 GB");
    assert.equal(formatCompactLibrarySize(9824432898), "9.1 GB");
    assert.equal(formatCompactLibrarySize(3378005553021), "3.1 TB");
    assert.equal(formatCompactLibrarySize(null), "—");
  });
});

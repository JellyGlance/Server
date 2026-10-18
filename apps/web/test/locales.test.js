import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { languages } from "../src/lib/languages.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const localesRoot = path.resolve(here, "../public/locales");
const sourceLocale = "en-GB";
const pluralSuffix = /_(zero|one|two|few|many|other)$/;
// {{name}} interpolation, legacy {NAME} tokens, $t() nesting and markup tags.
const placeholderPattern = /\{\{\s*[^{}]+?\s*\}\}|\{[A-Z_]+\}|\$t\([^)]*\)|<\/?[a-zA-Z][^>]*>/g;

function readLocale(locale) {
  return JSON.parse(fs.readFileSync(path.join(localesRoot, locale, "translation.json"), "utf8"));
}

function flatten(value, prefix = "", out = new Map()) {
  for (const [key, child] of Object.entries(value)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (child && typeof child === "object" && !Array.isArray(child)) {
      flatten(child, fullKey, out);
    } else {
      out.set(fullKey, child);
    }
  }
  return out;
}

function placeholders(text) {
  return (String(text).match(placeholderPattern) || []).map((token) => token.replace(/\s+/g, "")).sort();
}

// A plural form such as KEY_few is fine when the base locale has KEY, KEY_one or KEY_other.
function sourceKeyFor(key, source) {
  if (source.has(key)) return key;
  const base = key.replace(pluralSuffix, "");
  if (base === key) return null;
  for (const candidate of [`${base}_other`, `${base}_one`, base]) {
    if (source.has(candidate)) return candidate;
  }
  return null;
}

const source = flatten(readLocale(sourceLocale));
const localeDirs = fs
  .readdirSync(localesRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
  .map((entry) => entry.name)
  .sort();

describe("translation files", () => {
  test("every language in the picker has a translation file and vice versa", () => {
    const pickerIds = languages.map((language) => language.id).sort();
    assert.deepEqual(pickerIds, localeDirs);
    assert.equal(new Set(pickerIds).size, pickerIds.length, "duplicate language ids in the picker");
  });

  test("every language has a native name and a valid text direction", () => {
    for (const language of languages) {
      assert.ok(language.description && language.description.trim(), `${language.id} has no name`);
      assert.ok(["ltr", "rtl"].includes(language.dir ?? "ltr"), `${language.id} has an invalid dir`);
      assert.doesNotThrow(() => new Intl.Locale(language.id), `${language.id} is not a valid locale tag`);
    }
  });

  for (const locale of localeDirs) {
    if (locale === sourceLocale) continue;

    test(`${locale} has the same keys and placeholders as ${sourceLocale}`, () => {
      const target = flatten(readLocale(locale));
      const missing = [...source.keys()].filter((key) => !target.has(key));
      const extra = [...target.keys()].filter((key) => !sourceKeyFor(key, source));
      const notStrings = [...target.entries()].filter(([, value]) => typeof value !== "string").map(([key]) => key);
      const mismatched = [];

      for (const [key, value] of target) {
        const sourceKey = sourceKeyFor(key, source);
        if (!sourceKey || typeof value !== "string") continue;
        const expected = placeholders(source.get(sourceKey));
        const actual = placeholders(value);
        if (expected.join("|") !== actual.join("|")) {
          mismatched.push(`${key}: expected [${expected.join(", ")}] got [${actual.join(", ")}]`);
        }
      }

      assert.deepEqual(missing, [], `${locale} is missing keys`);
      assert.deepEqual(extra, [], `${locale} has keys that are not in ${sourceLocale}`);
      assert.deepEqual(notStrings, [], `${locale} has values that are not strings`);
      assert.deepEqual(mismatched, [], `${locale} has placeholders that do not match ${sourceLocale}`);
    });
  }
});

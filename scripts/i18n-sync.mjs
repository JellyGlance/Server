import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const localesRoot = path.resolve("apps/web/public/locales");
const sourceLocale = "en-GB";
const sourceFile = path.join(localesRoot, sourceLocale, "translation.json");
const checkOnly = process.argv.includes("--check");
const pluralSuffix = /_(zero|one|two|few|many|other)$/;

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function syncShape(source, target = {}, stats) {
  const next = {};

  for (const [key, sourceValue] of Object.entries(source)) {
    const targetValue = target[key];
    if (sourceValue && typeof sourceValue === "object" && !Array.isArray(sourceValue)) {
      next[key] = syncShape(sourceValue, targetValue && typeof targetValue === "object" ? targetValue : {}, stats);
      continue;
    }

    if (Object.prototype.hasOwnProperty.call(target, key)) {
      next[key] = targetValue;
    } else {
      next[key] = sourceValue;
      stats.missing += 1;
    }
  }

  // Keep plural forms that only some languages need (e.g. Czech/Polish _few), as long as the base key exists in the source.
  for (const [key, targetValue] of Object.entries(target)) {
    if (key in next || typeof targetValue !== "string") continue;
    const baseKey = key.replace(pluralSuffix, "");
    if (baseKey === key) continue;
    if (baseKey in source || `${baseKey}_one` in source || `${baseKey}_other` in source) {
      next[key] = targetValue;
    }
  }

  return next;
}

const source = readJson(sourceFile);
const localeNames = fs
  .readdirSync(localesRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
  .map((entry) => entry.name)
  .sort();

let totalMissing = 0;

for (const locale of localeNames) {
  if (locale === sourceLocale) continue;

  const localeFile = path.join(localesRoot, locale, "translation.json");
  const existing = fs.existsSync(localeFile) ? readJson(localeFile) : {};
  const stats = { missing: 0 };
  const synced = syncShape(source, existing, stats);
  totalMissing += stats.missing;

  if (!checkOnly && stats.missing > 0) {
    writeJson(localeFile, synced);
  }

  console.log(`${locale}: ${stats.missing} missing key${stats.missing === 1 ? "" : "s"}`);
}

if (checkOnly && totalMissing > 0) {
  console.error(`Translation files are missing ${totalMissing} key${totalMissing === 1 ? "" : "s"}. Run npm run i18n:sync.`);
  process.exit(1);
}

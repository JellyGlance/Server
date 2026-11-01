// Release builds stamp the full tag into package.json (e.g. 1.4.2-beta.2),
// while bundled What's New notes are keyed by the beta line (1.4.2-beta).
const PRERELEASE_PATTERN = /-(alpha|beta|rc|pre|preview)(?:[.-]?\d+)?$/i;

export function normalizeVersion(version) {
  return String(version || "")
    .trim()
    .replace(/^v/i, "")
    .replace(/\.(alpha|beta|rc|pre|preview)\.(\d+)$/i, "-$1.$2");
}

export function getReleaseChannel(version) {
  return /-(alpha|beta|rc|pre|preview)\b/i.test(normalizeVersion(version)) ? "beta" : "stable";
}

export function isBetaVersion(version) {
  return getReleaseChannel(version) === "beta";
}

export function formatDisplayVersion(version) {
  const normalized = normalizeVersion(version);
  if (!normalized) return "";
  return `v${normalized}`;
}

export function findReleaseNotes(notesByVersion, version) {
  const notes = notesByVersion || {};
  const normalized = normalizeVersion(version);
  if (!normalized) return null;

  const candidates = [version, normalized, `v${normalized}`];
  const match = normalized.match(/^(\d+\.\d+\.\d+)-(alpha|beta|rc|pre|preview)(?:[.-]?\d+)?$/i);
  if (match) {
    candidates.push(`${match[1]}-${match[2].toLowerCase()}`);
  }

  for (const key of candidates) {
    if (key && Array.isArray(notes[key])) return notes[key];
  }

  // Fall back to the stable notes for the same base version on beta builds.
  const base = normalized.replace(PRERELEASE_PATTERN, "");
  return Array.isArray(notes[base]) ? notes[base] : null;
}

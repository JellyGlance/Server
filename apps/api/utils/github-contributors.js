// Human contributors for the About page.
//
// GitHub's contributors API includes automation accounts (Dependabot, Renovate,
// GitHub Actions, the project's own GitHub App) and AI coding agents. Those are
// filtered out here so About only lists people.
//
// Lookups are cached in memory and in a file in the config dir for CACHE_TTL_MS
// (24h by default). When GitHub is rate-limited or unreachable, the last good
// list is used however old it is, and if there has never been one, a snapshot
// bundled with the app.
const fs = require("fs");
const path = require("path");

const CACHE_TTL_MS = Number(process.env.JS_GITHUB_CONTRIBUTORS_CACHE_TTL_MS || 24 * 60 * 60 * 1000);
const SNAPSHOT_FILE = path.join(__dirname, "../assets/contributors-snapshot.json");

// Lower-case logins (without a "[bot]" suffix) that are never shown.
const EXCLUDED_LOGINS = new Set([
  "dependabot",
  "dependabot-preview",
  "renovate",
  "renovate-bot",
  "renovatebot",
  "github-actions",
  "actions-user",
  "web-flow",
  "copilot",
  "copilot-swe-agent",
  "github-copilot",
  "cursor",
  "cursoragent",
  "cursor-agent",
  "claude",
  "claude-code",
  "anthropic-claude",
  "codex",
  "chatgpt-codex-connector",
  "openai-codex",
  "devin",
  "devin-ai-integration",
  "jellyglance-bot",
  "jellyglance-security-bot",
  "imgbot",
  "allcontributors",
  "snyk-bot",
  "pre-commit-ci",
]);

function extraExcludedLogins() {
  return String(process.env.JS_CONTRIBUTORS_EXCLUDE || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

function isBotContributor(contributor) {
  if (!contributor || typeof contributor !== "object") return true;
  if (String(contributor.type || "").toLowerCase() === "bot") return true;
  const login = String(contributor.login || "").trim().toLowerCase();
  if (!login) return true;
  if (login.endsWith("[bot]") || login.endsWith("-bot") || login.endsWith("_bot")) return true;
  const base = login.replace(/\[bot\]$/, "");
  return EXCLUDED_LOGINS.has(base) || extraExcludedLogins().includes(base);
}

function normalizeContributor(contributor) {
  const login = String(contributor?.login || "");
  return {
    id: contributor?.id || login,
    login,
    avatar_url: contributor?.avatar_url || (login ? `https://github.com/${login}.png?size=160` : ""),
    profile_url: contributor?.html_url || contributor?.profile_url || `https://github.com/${login}`,
    contributions: Number(contributor?.contributions || 0),
  };
}

function humanContributors(list) {
  return (Array.isArray(list) ? list : []).filter((contributor) => !isBotContributor(contributor)).map(normalizeContributor);
}

function readJson(file) {
  try {
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    console.warn(`Unable to read ${path.basename(file)}: ${error.message}`);
    return null;
  }
}

function createContributorsSource({ fetchList, cacheFile, snapshotFile = SNAPSHOT_FILE, repositoryUrl, ttlMs = CACHE_TTL_MS, now = () => Date.now() }) {
  let memory = null;

  function load() {
    if (memory) return memory;
    const cached = readJson(cacheFile);
    if (cached?.cached_at && cached?.data?.contributors?.length) {
      memory = { cached_at: cached.cached_at, contributors: humanContributors(cached.data.contributors) };
    }
    return memory;
  }

  function save(contributors) {
    memory = { cached_at: new Date(now()).toISOString(), contributors };
    try {
      fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
      fs.writeFileSync(cacheFile, JSON.stringify({ cached_at: memory.cached_at, data: { contributors } }, null, 2));
    } catch (error) {
      console.warn(`Unable to write GitHub contributors cache: ${error.message}`);
    }
  }

  function result(entry, extra) {
    return { repository_url: repositoryUrl, contributors: entry.contributors, cached_at: entry.cached_at, ...extra };
  }

  return async function getContributors() {
    const cached = load();
    const age = cached ? now() - new Date(cached.cached_at).getTime() : Infinity;
    if (cached?.contributors.length && Number.isFinite(age) && age >= 0 && age < ttlMs) {
      return result(cached, { cached: true, stale: false });
    }

    try {
      const contributors = humanContributors(await fetchList());
      if (!contributors.length) throw new Error("GitHub returned no human contributors");
      save(contributors);
      return result(memory, { cached: false, stale: false });
    } catch (error) {
      if (cached?.contributors.length) {
        console.warn(`Using cached GitHub contributors after fetch failed: ${error.message}`);
        return result(cached, { cached: true, stale: true });
      }
      const snapshot = readJson(snapshotFile);
      const contributors = humanContributors(snapshot?.contributors);
      if (contributors.length) {
        console.warn(`Using bundled contributors snapshot after fetch failed: ${error.message}`);
        return result({ contributors, cached_at: snapshot.generated_at || null }, { cached: true, stale: true, snapshot: true });
      }
      throw error;
    }
  };
}

module.exports = { EXCLUDED_LOGINS, CACHE_TTL_MS, isBotContributor, humanContributors, normalizeContributor, createContributorsSource };

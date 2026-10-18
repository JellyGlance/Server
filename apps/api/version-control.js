const axios = require("axios");
const fs = require("fs");
const path = require("path");
const packageJson = require("./package.json");
const { compareVersions } = require("compare-versions");
const memoizee = require("memoizee");
const { getConfigDir } = require("./utils/storage-paths");
const { createContributorsSource, mergeContributors } = require("./utils/github-contributors");

const REPO_OWNER = process.env.JS_REPO_OWNER || "JellyGlance";
const REPO_NAME = process.env.JS_REPO_NAME || "Server";
const RELEASES_URL = `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases`;
const RELEASES_ATOM_URL = `${RELEASES_URL}.atom`;
const RELEASE_CACHE_TTL_MS = Number(process.env.JS_RELEASE_CACHE_TTL_MS || 6 * 60 * 60 * 1000);
const RELEASE_CACHE_MAX_STALE_MS = Number(process.env.JS_RELEASE_CACHE_MAX_STALE_MS || 14 * 24 * 60 * 60 * 1000);
const RELEASE_CACHE_FILE = path.join(getConfigDir(), "release-notes-cache.json");
const CONTRIBUTORS_CACHE_FILE = path.join(getConfigDir(), "github-contributors-cache.json");
const STARS_CACHE_FILE = path.join(getConfigDir(), "github-stars-cache.json");
const STARS_CACHE_TTL_MS = Number(process.env.JS_GITHUB_STARS_CACHE_TTL_MS || 7 * 24 * 60 * 60 * 1000);
const REPOSITORY_URL = `https://github.com/${REPO_OWNER}/${REPO_NAME}`;
const BUNDLED_RELEASE_NOTES_FILE = path.join(__dirname, "../web/src/whats-new.json");

function normalizeVersion(version) {
  return String(version || "")
    .trim()
    .replace(/^v/i, "")
    // Older bundled notes used 1.2.3.beta.1; normalize it for semver sorting.
    .replace(/\.(alpha|beta|rc|pre|preview)\.(\d+)$/i, "-$1.$2");
}

function releaseChannel(currentVersion = packageJson.version) {
  const explicitChannel = String(process.env.JS_RELEASE_CHANNEL || process.env.RELEASE_CHANNEL || "").trim().toLowerCase();
  const normalizedVersion = normalizeVersion(currentVersion).toLowerCase();

  if (explicitChannel === "stable" || explicitChannel === "release") {
    return "stable";
  }

  if (explicitChannel === "beta" || normalizedVersion.includes("beta")) {
    return "beta";
  }

  return "stable";
}

function releaseMatchesChannel(release, channel) {
  const prerelease = Boolean(release?.prerelease) || isPrereleaseVersion(release?.version || release?.tag_name || release?.name);
  return channel === "beta" ? prerelease : !prerelease;
}

async function fetchLatestReleaseVersion(currentVersion, channel = releaseChannel(currentVersion)) {
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": `JellyGlance/${currentVersion}`,
    ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
  };

  try {
    const response = await axios.get(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases`, {
      headers,
      params: {
        per_page: 20,
      },
      timeout: 10000,
    });

    const latestRelease = (response.data || [])
      .filter((release) => !release.draft)
      .map(normalizeRelease)
      .filter((release) => releaseMatchesChannel(release, channel))
      .sort((a, b) => compareVersions(b.version, a.version))[0];

    if (!latestRelease?.version) {
      throw new Error(`GitHub did not return any ${channel} releases`);
    }

    return latestRelease.version;
  } catch (apiError) {
    const response = await axios.get(RELEASES_ATOM_URL, {
      headers: {
        Accept: "application/atom+xml",
        "User-Agent": `JellyGlance/${currentVersion}`,
      },
      timeout: 10000,
    });
    const latestVersion = [...String(response.data || "").matchAll(/\/releases\/tag\/([^"<\s]+)/g)]
      .map((match) => normalizeVersion(match[1]))
      .filter(Boolean)
      .filter((version) => releaseMatchesChannel({ version }, channel))
      .sort((a, b) => compareVersions(b, a))[0];

    if (!latestVersion) {
      throw apiError;
    }

    return latestVersion;
  }
}

function normalizeRelease(release) {
  const tagName = release?.tag_name || release?.name || "";

  return {
    id: release?.id || tagName,
    version: normalizeVersion(tagName),
    name: release?.name || tagName,
    date: release?.published_at || release?.created_at || null,
    prerelease: Boolean(release?.prerelease),
    draft: Boolean(release?.draft),
    url: release?.html_url || RELEASES_URL,
    body: release?.body || "",
  };
}

function readBundledReleaseNotes() {
  try {
    if (!fs.existsSync(BUNDLED_RELEASE_NOTES_FILE)) {
      return null;
    }

    return JSON.parse(fs.readFileSync(BUNDLED_RELEASE_NOTES_FILE, "utf8"));
  } catch (error) {
    console.warn(`Unable to read bundled release notes: ${error.message}`);
    return null;
  }
}

function readStarsCache() {
  try {
    if (!fs.existsSync(STARS_CACHE_FILE)) {
      return null;
    }

    return JSON.parse(fs.readFileSync(STARS_CACHE_FILE, "utf8"));
  } catch (error) {
    console.warn(`Unable to read GitHub stars cache: ${error.message}`);
    return null;
  }
}

function writeStarsCache(data) {
  try {
    fs.mkdirSync(path.dirname(STARS_CACHE_FILE), { recursive: true });
    fs.writeFileSync(
      STARS_CACHE_FILE,
      JSON.stringify(
        {
          cached_at: new Date().toISOString(),
          data,
        },
        null,
        2
      )
    );
  } catch (error) {
    console.warn(`Unable to write GitHub stars cache: ${error.message}`);
  }
}

function getCachedStars({ allowStale = false } = {}) {
  const cache = readStarsCache();
  if (!cache?.cached_at || !Number.isFinite(cache.data?.stars)) {
    return null;
  }

  const age = Date.now() - new Date(cache.cached_at).getTime();
  const maxAge = allowStale ? RELEASE_CACHE_MAX_STALE_MS : STARS_CACHE_TTL_MS;
  if (!Number.isFinite(age) || age < 0 || age > maxAge) {
    return null;
  }

  return {
    ...cache.data,
    cached: true,
    cached_at: cache.cached_at,
    stale: age > STARS_CACHE_TTL_MS,
  };
}

function parseStarCount(value) {
  const text = String(value || "").trim().toLowerCase().replace(/,/g, "");
  const match = text.match(/^([\d.]+)\s*([kmb])?$/);
  if (!match) return Number.NaN;
  const amount = Number(match[1]);
  const suffix = { k: 1_000, m: 1_000_000, b: 1_000_000_000 }[match[2]] || 1;
  return Number.isFinite(amount) ? Math.round(amount * suffix) : Number.NaN;
}

function githubRequestHeaders() {
  return {
    Accept: "application/vnd.github+json",
    "User-Agent": `JellyGlance/${packageJson.version}`,
    ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
  };
}

async function fetchStarsFromGithubApi() {
  const response = await axios.get(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}`, {
    headers: githubRequestHeaders(),
    timeout: 10000,
  });
  const stars = Number(response.data?.stargazers_count);
  if (!Number.isFinite(stars) || stars < 0) {
    throw new Error("GitHub did not return a star count");
  }
  return {
    stars,
    repository_url: response.data?.html_url || REPOSITORY_URL,
  };
}

async function fetchStarsFromShields() {
  const response = await axios.get(`https://img.shields.io/github/stars/${REPO_OWNER}/${REPO_NAME}.json`, {
    headers: { "User-Agent": `JellyGlance/${packageJson.version}` },
    timeout: 10000,
  });
  const stars = parseStarCount(response.data?.message);
  if (!Number.isFinite(stars) || stars < 0) {
    throw new Error("Shields did not return a star count");
  }
  return { stars, repository_url: REPOSITORY_URL };
}

async function fetchStarsFromGithubPage() {
  const response = await axios.get(REPOSITORY_URL, {
    headers: {
      Accept: "text/html",
      "User-Agent": `JellyGlance/${packageJson.version}`,
    },
    timeout: 10000,
  });
  const html = String(response.data || "");
  const labeled = html.match(/([\d,.]+[kmb]?)\s+users?\s+starred this repository/i);
  const counter = html.match(/id="repo-stars-counter-star"[^>]*>\s*([\d,.]+[kmb]?)/i);
  const stars = parseStarCount(labeled?.[1] || counter?.[1]);
  if (!Number.isFinite(stars) || stars < 0) {
    throw new Error("GitHub page did not include a star count");
  }
  return { stars, repository_url: REPOSITORY_URL };
}

async function fetchGithubStars() {
  const cached = getCachedStars();
  if (cached) {
    return cached;
  }

  const sources = [fetchStarsFromGithubApi, fetchStarsFromShields, fetchStarsFromGithubPage];
  let lastError = null;

  for (const source of sources) {
    try {
      const data = await source();
      writeStarsCache(data);
      return data;
    } catch (error) {
      lastError = error;
    }
  }

  const staleCache = getCachedStars({ allowStale: true });
  if (staleCache) {
    console.warn(`Using cached GitHub stars after fetch failed: ${lastError?.message}`);
    return staleCache;
  }

  console.warn(`Unable to fetch GitHub stars: ${lastError?.message}`);
  return {
    stars: null,
    repository_url: REPOSITORY_URL,
  };
}

function isPrereleaseVersion(version) {
  return /-(alpha|beta|rc|pre|preview)\b/i.test(normalizeVersion(version));
}

function bundledNotesToRelease(version, notes) {
  const normalizedVersion = normalizeVersion(version);
  const noteItems = Array.isArray(notes) ? notes : [];

  return {
    id: `bundled-${normalizedVersion}`,
    version: normalizedVersion,
    name: `JellyGlance v${normalizedVersion}`,
    date: null,
    prerelease: isPrereleaseVersion(normalizedVersion),
    draft: false,
    url: `${RELEASES_URL}/tag/v${normalizedVersion}`,
    body: noteItems.length
      ? noteItems.map((item) => `## ${item.title || "Changes"}\n\n- ${item.body || "No release notes were provided for this version."}`).join("\n\n")
      : "No release notes were provided for this version.",
  };
}

function getBundledReleaseNotes(currentVersion, channel) {
  const bundledNotes = readBundledReleaseNotes();
  if (!bundledNotes || typeof bundledNotes !== "object") {
    return null;
  }

  const releases = Object.entries(bundledNotes)
    .map(([version, notes]) => bundledNotesToRelease(version, notes))
    .filter((release) => releaseMatchesChannel(release, channel))
    .sort((a, b) => compareVersions(b.version, a.version));

  if (!releases.length) {
    return null;
  }

  return {
    current_version: currentVersion,
    channel,
    releases_url: RELEASES_URL,
    cached: false,
    bundled: true,
    releases,
  };
}

function readReleaseCache() {
  try {
    if (!fs.existsSync(RELEASE_CACHE_FILE)) {
      return null;
    }

    return JSON.parse(fs.readFileSync(RELEASE_CACHE_FILE, "utf8"));
  } catch (error) {
    console.warn(`Unable to read release notes cache: ${error.message}`);
    return null;
  }
}

function writeReleaseCache(data) {
  try {
    fs.mkdirSync(path.dirname(RELEASE_CACHE_FILE), { recursive: true });
    fs.writeFileSync(
      RELEASE_CACHE_FILE,
      JSON.stringify(
        {
          cached_at: new Date().toISOString(),
          data,
        },
        null,
        2
      )
    );
  } catch (error) {
    console.warn(`Unable to write release notes cache: ${error.message}`);
  }
}

function getCachedReleaseNotes({ allowStale = false } = {}) {
  const cache = readReleaseCache();
  if (!cache?.cached_at || !cache?.data?.releases?.length) {
    return null;
  }

  const age = Date.now() - new Date(cache.cached_at).getTime();
  const maxAge = allowStale ? RELEASE_CACHE_MAX_STALE_MS : RELEASE_CACHE_TTL_MS;
  if (!Number.isFinite(age) || age < 0 || age > maxAge) {
    return null;
  }

  return {
    ...cache.data,
    cached: true,
    cached_at: cache.cached_at,
    stale: age > RELEASE_CACHE_TTL_MS,
  };
}

function getFallbackReleaseNotes(currentVersion, channel) {
  const bundled = getBundledReleaseNotes(currentVersion, channel);
  if (bundled) {
    return bundled;
  }

  const version = normalizeVersion(currentVersion);

  return {
    current_version: currentVersion,
    channel,
    releases_url: RELEASES_URL,
    cached: false,
    fallback: true,
    releases: [
      {
        id: `fallback-${version}`,
        version,
        name: `JellyGlance v${version}`,
        date: null,
        prerelease: channel === "beta",
        draft: false,
        url: `${RELEASES_URL}/tag/v${version}`,
        body: `Release notes are temporarily unavailable because GitHub could not be reached. View JellyGlance v${version} on GitHub for the full notes.`,
      },
    ],
  };
}

async function fetchReleaseNotes() {
  const currentVersion = packageJson.version;
  const channel = releaseChannel(currentVersion);
  const cached = getCachedReleaseNotes();
  if (cached?.current_version === currentVersion && cached?.channel === channel) {
    return cached;
  }

  try {
    const response = await axios.get(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases`, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": `JellyGlance/${currentVersion}`,
        ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
      },
      params: {
        per_page: 20,
      },
      timeout: 10000,
    });

    const data = {
      current_version: currentVersion,
      channel,
      releases_url: RELEASES_URL,
      releases: (response.data || [])
        .filter((release) => !release.draft)
        .map(normalizeRelease)
        .filter((release) => releaseMatchesChannel(release, channel)),
    };

    if (data.releases.length) {
      writeReleaseCache(data);
      return data;
    }

    return getFallbackReleaseNotes(currentVersion, channel);
  } catch (error) {
    const staleCache = getCachedReleaseNotes({ allowStale: true });
    if (staleCache?.current_version === currentVersion && staleCache?.channel === channel) {
      console.warn(`Using cached release notes after GitHub fetch failed: ${error.message}`);
      return staleCache;
    }

    console.warn(`Using fallback release notes after GitHub fetch failed: ${error.message}`);
    return getFallbackReleaseNotes(currentVersion, channel);
  }
}

const GITHUB_HEADERS = () => ({
  Accept: "application/vnd.github+json",
  "User-Agent": `JellyGlance/${packageJson.version}`,
  ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
});
const CONTRIBUTOR_MAX_PAGES = 10;

async function fetchAllPages(url, params, pick = (data) => data) {
  const items = [];
  for (let page = 1; page <= CONTRIBUTOR_MAX_PAGES; page++) {
    const response = await axios.get(url, { headers: GITHUB_HEADERS(), params: { ...params, per_page: 100, page }, timeout: 10000 });
    const batch = pick(response.data) || [];
    items.push(...batch);
    if (batch.length < 100) break;
  }
  return items;
}

async function fetchContributorList() {
  const commitContributors = await fetchAllPages(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contributors`, { anon: "false" });
  let pullRequestAuthors = [];
  try {
    const pulls = await fetchAllPages(
      "https://api.github.com/search/issues",
      { q: `repo:${REPO_OWNER}/${REPO_NAME} is:pr is:merged` },
      (data) => data?.items
    );
    pullRequestAuthors = pulls.map((pull) => pull.user).filter(Boolean);
  } catch (error) {
    console.warn(`Unable to load merged pull request authors: ${error.message}`);
  }
  return mergeContributors(commitContributors, pullRequestAuthors);
}

const fetchGithubContributors = createContributorsSource({
  fetchList: fetchContributorList,
  cacheFile: CONTRIBUTORS_CACHE_FILE,
  repositoryUrl: REPOSITORY_URL,
});

async function checkForUpdates() {
  const currentVersion = packageJson.version;
  let result = {
    current_version: currentVersion,
    latest_version: "",
    message: "",
    update_available: false,
    releases_url: RELEASES_URL,
  };

  try {
    const channel = releaseChannel(currentVersion);
    const latestVersion = await fetchLatestReleaseVersion(currentVersion, channel);

    if (!latestVersion) {
      throw new Error("GitHub release did not include a version tag");
    }

    if (compareVersions(latestVersion, currentVersion) > 0) {
      result = {
        current_version: currentVersion,
        latest_version: latestVersion,
        message: `Update ${latestVersion} is available`,
        update_available: true,
        releases_url: RELEASES_URL,
      };
    } else if (compareVersions(latestVersion, currentVersion) < 0) {
      result = {
        current_version: currentVersion,
        latest_version: latestVersion,
        message: `${REPO_NAME} is using a beta version`,
        update_available: false,
        releases_url: RELEASES_URL,
      };
    } else {
      result = {
        current_version: currentVersion,
        latest_version: latestVersion,
        message: `${REPO_NAME} is up to date`,
        update_available: false,
        releases_url: RELEASES_URL,
      };
    }
  } catch (error) {
    console.error(`Failed to fetch releases for ${REPO_NAME}: ${error.message}`);
    result = {
      current_version: currentVersion,
      latest_version: "N/A",
      message: `Unable to check releases. View releases at ${RELEASES_URL}`,
      update_available: false,
      releases_url: RELEASES_URL,
    };
  }

  const starsInfo = await fetchGithubStars();
  return {
    ...result,
    stars: Number.isFinite(starsInfo?.stars) ? starsInfo.stars : null,
    repository_url: starsInfo?.repository_url || REPOSITORY_URL,
  };
}

module.exports = {
  checkForUpdates: memoizee(checkForUpdates, { maxAge: 300000, promise: true }),
  fetchReleaseNotes: memoizee(fetchReleaseNotes, { maxAge: 300000, promise: true }),
  fetchGithubContributors: memoizee(fetchGithubContributors, { maxAge: 300000, promise: true }),
  fetchGithubStars: memoizee(fetchGithubStars, { maxAge: 300000, promise: true }),
};

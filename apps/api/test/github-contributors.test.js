const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { isBotContributor, humanContributors, createContributorsSource } = require("../utils/github-contributors");

const API_LIST = [
  { login: "Nerdy-Technician", type: "User", contributions: 330 },
  { login: "dependabot[bot]", type: "Bot", contributions: 38 },
  { login: "jellyglance-security-bot[bot]", type: "Bot", contributions: 35 },
  { login: "github-actions[bot]", type: "Bot", contributions: 22 },
  { login: "renovate", type: "User", contributions: 9 },
  { login: "Copilot", type: "User", contributions: 4 },
  { login: "cursoragent", type: "User", contributions: 3 },
  { login: "claude", type: "User", contributions: 2 },
  { login: "devin-ai-integration[bot]", type: "Bot", contributions: 2 },
  { login: "Gdanycz", type: "User", contributions: 1 },
  { login: "mcgarrah", type: "User", contributions: 1 },
];

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "jg-contrib-"));
}

test("only human contributors are kept", () => {
  assert.deepEqual(
    humanContributors(API_LIST).map((c) => c.login),
    ["Nerdy-Technician", "Gdanycz", "mcgarrah"]
  );
  assert.equal(isBotContributor({ login: "someone", type: "Bot" }), true);
  assert.equal(isBotContributor({ login: "CodeX", type: "User" }), true);
  assert.equal(isBotContributor({ login: "robotics-fan", type: "User" }), false);
});

test("JS_CONTRIBUTORS_EXCLUDE adds extra logins", () => {
  process.env.JS_CONTRIBUTORS_EXCLUDE = "Gdanycz";
  try {
    assert.equal(isBotContributor({ login: "gdanycz", type: "User" }), true);
  } finally {
    delete process.env.JS_CONTRIBUTORS_EXCLUDE;
  }
});

test("fresh results are cached in memory and on disk for the TTL", async () => {
  const dir = tmpDir();
  let now = 0;
  let calls = 0;
  const source = createContributorsSource({
    fetchList: async () => (calls++, API_LIST),
    cacheFile: path.join(dir, "cache.json"),
    repositoryUrl: "https://github.com/JellyGlance/Server",
    ttlMs: 1000,
    now: () => now,
  });
  const first = await source();
  assert.equal(first.cached, false);
  now = 500;
  const second = await source();
  assert.equal(second.cached, true);
  assert.equal(calls, 1);
  assert.ok(fs.existsSync(path.join(dir, "cache.json")));
});

test("a failed or rate-limited fetch falls back to the last good list, however old", async () => {
  const dir = tmpDir();
  const cacheFile = path.join(dir, "cache.json");
  fs.writeFileSync(cacheFile, JSON.stringify({ cached_at: "2020-01-01T00:00:00.000Z", data: { contributors: API_LIST } }));
  const source = createContributorsSource({
    fetchList: async () => {
      throw new Error("Request failed with status code 403");
    },
    cacheFile,
    repositoryUrl: "x",
  });
  const result = await source();
  assert.equal(result.stale, true);
  assert.deepEqual(result.contributors.map((c) => c.login), ["Nerdy-Technician", "Gdanycz", "mcgarrah"]);
});

test("with no cache and GitHub offline the bundled snapshot is used", async () => {
  const dir = tmpDir();
  const source = createContributorsSource({
    fetchList: async () => {
      throw new Error("getaddrinfo ENOTFOUND api.github.com");
    },
    cacheFile: path.join(dir, "missing.json"),
    repositoryUrl: "x",
  });
  const result = await source();
  assert.equal(result.snapshot, true);
  assert.ok(result.contributors.some((c) => c.login === "Nerdy-Technician"));
  assert.ok(result.contributors.every((c) => !isBotContributor(c)));
});

test("a list with only automation accounts never replaces the good cache", async () => {
  const dir = tmpDir();
  const cacheFile = path.join(dir, "cache.json");
  fs.writeFileSync(cacheFile, JSON.stringify({ cached_at: "2020-01-01T00:00:00.000Z", data: { contributors: API_LIST } }));
  const source = createContributorsSource({
    fetchList: async () => [{ login: "dependabot[bot]", type: "Bot" }],
    cacheFile,
    repositoryUrl: "x",
  });
  const result = await source();
  assert.equal(result.contributors.length, 3);
  assert.equal(JSON.parse(fs.readFileSync(cacheFile, "utf8")).data.contributors.length, API_LIST.length);
});

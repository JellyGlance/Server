// Per-user scoping on the /stats user endpoints, using the real router against an in-memory database.
const test = require("node:test");
const assert = require("node:assert/strict");

const ALICE = "a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1";
const BOB = "b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2";
const USERS = [
  { UserId: ALICE, UserName: "Alice", IsAdministrator: true, TotalStreams: 12, TotalWatchTime: 9000 },
  { UserId: BOB, UserName: "Bob", IsAdministrator: false, TotalStreams: 4, TotalWatchTime: 3000 },
];
const norm = (value) => String(value || "").toLowerCase().replace(/-/g, "");
const slug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

const calls = [];
function fakeQuery(sql, params = []) {
  calls.push({ sql, params });
  if (sql.includes("ranked_users")) {
    const key = params[0];
    const ranked = USERS.map((user, index) => ({ ...user, Rank: index + 1, Slug: slug(user.UserName) }));
    return { rows: ranked.filter((user) => norm(user.UserId) === key || user.UserName.toLowerCase() === key || user.Slug === key).slice(0, 1) };
  }
  if (sql.includes("FROM jf_users u") && sql.includes("TotalStreams")) {
    return { rows: params.length ? USERS.filter((user) => norm(user.UserId) === params[0]) : USERS };
  }
  if (sql.includes("jf_all_user_activity")) {
    return { rows: params.length ? USERS.filter((user) => norm(user.UserId) === params[0]) : USERS };
  }
  if (sql.includes("fs_last_user_activity")) {
    return { rows: [{ UserId: params[0], NowPlayingItemName: "Something" }] };
  }
  if (sql.includes("fs_user_stats")) {
    return { rows: [{ UserId: params[1], Plays: 3 }] };
  }
  return { rows: [] };
}

const dbPath = require.resolve("../db");
require.cache[dbPath] = {
  id: dbPath,
  filename: dbPath,
  loaded: true,
  exports: {
    query: async (sql, params) => fakeQuery(sql, params),
    pool: {
      query: async (sql, params) => fakeQuery(sql, params),
      connect: async () => ({
        query: async (sql, params) => {
          calls.push({ sql, params });
          return sql.includes("count(") || sql.includes("COUNT(*) as count") ? { rows: [{ count: 1 }] } : { rows: [{ genre: "Drama", plays: 2 }] };
        },
        release() {},
      }),
    },
  },
};

const express = require("express");
const statsRouter = require("../routes/stats");
const { DEFAULT_ROLE_PERMISSIONS } = require("../classes/role-permissions");
const { ownMediaUserId, resolveStatsUser, canViewAllUsers } = require("../classes/stats-access");

// What the auth middleware leaves on req for each kind of caller.
const CALLERS = {
  admin: {
    user: { id: ALICE, authMode: "quick-connect", role: "Admin", jellyfinUser: { id: ALICE, isAdministrator: true } },
    permissions: DEFAULT_ROLE_PERMISSIONS.Admin,
  },
  viewer: {
    user: { id: BOB, authMode: "quick-connect", role: "Viewer", jellyfinUser: { id: BOB, isAdministrator: false } },
    permissions: DEFAULT_ROLE_PERMISSIONS.Viewer,
  },
  oidcViewer: {
    user: { id: "oidc-subject", authMode: "oidc", role: "Viewer", jellyfinUser: { id: BOB } },
    permissions: DEFAULT_ROLE_PERMISSIONS.Viewer,
  },
  localViewer: {
    user: { id: 7, username: "kid", authMode: "local", role: "Viewer" },
    permissions: DEFAULT_ROLE_PERMISSIONS.Viewer,
  },
  apiKey: { user: undefined, permissions: DEFAULT_ROLE_PERMISSIONS.Owner, apiKeyScope: "full" },
};

async function withServer(caller, fn) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = caller.user;
    req.permissions = caller.permissions;
    req.apiKeyScope = caller.apiKeyScope;
    next();
  });
  app.use("/stats", statsRouter);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const call = async (method, path, body) => {
      const response = await fetch(`http://127.0.0.1:${port}/stats${path}`, {
        method,
        headers: body ? { "Content-Type": "application/json" } : {},
        body: body ? JSON.stringify(body) : undefined,
      });
      const text = await response.text();
      let json = null;
      try {
        json = JSON.parse(text);
      } catch {}
      return { status: response.status, json };
    };
    await fn(call);
  } finally {
    server.close();
  }
}

const quiet = console.log;
test.before(() => {
  console.log = () => {};
});
test.after(() => {
  console.log = quiet;
});

test("admin sees every user's wrap-up", async () => {
  await withServer(CALLERS.admin, async (call) => {
    const { status, json } = await call("GET", "/getUserWrapUp");
    assert.equal(status, 200);
    assert.deepEqual(json.map((user) => user.UserId), [ALICE, BOB]);
  });
});

test("full API key keeps admin behaviour", async () => {
  await withServer(CALLERS.apiKey, async (call) => {
    const { status, json } = await call("GET", "/getUserWrapUp");
    assert.equal(status, 200);
    assert.equal(json.length, 2);
    const other = await call("POST", "/getUserLastPlayed", { userid: BOB });
    assert.equal(other.status, 200);
  });
});

test("non-admin only gets their own wrap-up row", async () => {
  await withServer(CALLERS.viewer, async (call) => {
    const { status, json } = await call("GET", "/getUserWrapUp");
    assert.equal(status, 200);
    assert.deepEqual(json.map((user) => user.UserId), [BOB]);
    const activity = await call("GET", "/getAllUserActivity");
    assert.deepEqual(activity.json.map((user) => user.UserId), [BOB]);
  });
});

test("non-admin can open their own profile wrap-up without a rank", async () => {
  await withServer(CALLERS.viewer, async (call) => {
    const { status, json } = await call("GET", "/getUserProfileWrapUp?user=bob");
    assert.equal(status, 200);
    assert.equal(json.user.UserId, BOB);
    assert.equal(json.rank, null);
  });
});

test("admin can open any profile wrap-up with its rank", async () => {
  await withServer(CALLERS.admin, async (call) => {
    const { status, json } = await call("GET", `/getUserProfileWrapUp?user=${BOB}`);
    assert.equal(status, 200);
    assert.equal(json.user.UserId, BOB);
    assert.equal(json.rank, 2);
    const missing = await call("GET", "/getUserProfileWrapUp?user=nobody");
    assert.equal(missing.status, 404);
  });
});

test("non-admin gets 403 for another user's id on every user endpoint", async () => {
  await withServer(CALLERS.viewer, async (call) => {
    calls.length = 0;
    const responses = [
      await call("GET", `/getUserProfileWrapUp?user=${ALICE}`),
      await call("GET", "/getUserProfileWrapUp?user=alice"),
      await call("GET", "/getUserProfileWrapUp?user=nobody"),
      await call("POST", "/getUserLastPlayed", { userid: ALICE }),
      await call("POST", "/getGlobalUserStats", { userid: ALICE, hours: 24 }),
      await call("GET", `/getGenreUserStats?userid=${ALICE}`),
    ];
    assert.deepEqual(
      responses.map((response) => response.status),
      [403, 403, 403, 403, 403, 403]
    );
    for (const response of responses) assert.equal(response.json?.error, "You can only view your own activity");
    // Only the profile lookup itself sees the other id; none of their stats are queried.
    const statsCalls = calls.filter((entry) => !entry.sql.includes("ranked_users"));
    assert.equal(statsCalls.some((entry) => (entry.params || []).includes(ALICE)), false, "no stats query ran for the other user");
  });
});

test("non-admin can read their own per-user stats, and an omitted id means their own", async () => {
  await withServer(CALLERS.viewer, async (call) => {
    const lastPlayed = await call("POST", "/getUserLastPlayed", { userid: BOB });
    assert.equal(lastPlayed.status, 200);
    assert.equal(lastPlayed.json[0].UserId, BOB);
    const stats = await call("POST", "/getGlobalUserStats", { hours: 24 });
    assert.equal(stats.status, 200);
    assert.equal(stats.json.UserId, BOB);
    const genres = await call("GET", "/getGenreUserStats");
    assert.equal(genres.status, 200);
    assert.equal(genres.json.results.length, 1);
  });
});

test("admin can read another user's per-user stats", async () => {
  await withServer(CALLERS.admin, async (call) => {
    const lastPlayed = await call("POST", "/getUserLastPlayed", { userid: BOB });
    assert.equal(lastPlayed.status, 200);
    assert.equal(lastPlayed.json[0].UserId, BOB);
    const genres = await call("GET", "/getGenreUserStats");
    assert.equal(genres.status, 400, "admins still have to say which user");
  });
});

test("OIDC viewer is scoped to their linked media-server user", async () => {
  await withServer(CALLERS.oidcViewer, async (call) => {
    const { json } = await call("GET", "/getUserWrapUp");
    assert.deepEqual(json.map((user) => user.UserId), [BOB]);
    const other = await call("POST", "/getUserLastPlayed", { userid: ALICE });
    assert.equal(other.status, 403);
    assert.equal(other.json.error, "You can only view your own activity");
  });
});

test("unlinked local viewer gets empty results or 403, never other users", async () => {
  await withServer(CALLERS.localViewer, async (call) => {
    assert.deepEqual((await call("GET", "/getUserWrapUp")).json, []);
    assert.deepEqual((await call("GET", "/getAllUserActivity")).json, []);
    assert.deepEqual((await call("POST", "/getUserLastPlayed", {})).json, []);
    assert.equal((await call("GET", "/getUserProfileWrapUp?user=bob")).status, 403);
    assert.equal((await call("POST", "/getUserLastPlayed", { userid: BOB })).status, 403);
    assert.equal((await call("GET", "/getGenreUserStats?userid=7")).status, 403);
  });
});

test("own id is read from the signed-in user, inside or outside the token's `user` wrapper", () => {
  const inner = { id: BOB, authMode: "quick-connect", jellyfinUser: { id: BOB } };
  assert.equal(ownMediaUserId(inner), BOB);
  assert.equal(ownMediaUserId({ user: inner, iat: 1 }), BOB);
  assert.equal(ownMediaUserId({ user: { id: "sub", authMode: "oidc", jellyfinUser: { Id: ALICE } } }), ALICE);
  assert.equal(ownMediaUserId({ id: BOB, authMode: "quick-connect" }), BOB);
  assert.equal(ownMediaUserId({ id: 7, username: "kid", authMode: "local" }), null);
  assert.equal(ownMediaUserId({ user: { id: 7, username: "kid", authMode: "local" } }), null);
  assert.equal(ownMediaUserId(undefined), null);
  assert.equal(ownMediaUserId("internal"), null);
});

test("ids are compared without case or dashes, and admin rights come from the role or Users permission", () => {
  const dashed = "B2B2B2B2-B2B2-B2B2-B2B2-B2B2B2B2B2B2";
  const req = { user: CALLERS.viewer.user, permissions: CALLERS.viewer.permissions };
  assert.equal(resolveStatsUser(req, dashed).forbidden, false);
  assert.equal(resolveStatsUser(req, ALICE).forbidden, true);
  assert.equal(canViewAllUsers({ user: { user: { role: "Owner" } }, permissions: {} }), true);
  assert.equal(canViewAllUsers({ user: { role: "Manager" }, permissions: DEFAULT_ROLE_PERMISSIONS.Manager }), true);
  assert.equal(canViewAllUsers({ user: "internal" }), true);
  assert.equal(canViewAllUsers({ user: { role: "Household" }, permissions: DEFAULT_ROLE_PERMISSIONS.Household }), false);
});

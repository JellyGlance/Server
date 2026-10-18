// Viewers only see their own activity on the server-wide activity endpoints. Runs the real /stats,
// /api and widget routers against an in-memory database.
const test = require("node:test");
const assert = require("node:assert/strict");

// api.js now loads the auth routes, which need a signing secret at require time.
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";

const ALICE = "a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1";
const BOB = "b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2";
const USERS = [
  { Id: ALICE, Name: "Alice", IsAdministrator: true },
  { Id: BOB, Name: "Bob", IsAdministrator: false },
];
const PLAYS = [
  { Id: "p1", UserId: ALICE, UserName: "Alice", NowPlayingItemName: "Slow Horses", Plays: 9 },
  { Id: "p2", UserId: BOB, UserName: "Bob", NowPlayingItemName: "Dune: Part Two", Plays: 4 },
];
const norm = (value) => String(value || "").toLowerCase().replace(/-/g, "");

const calls = [];

// Which user a query has been limited to, if any.
function restrictedUser(sql, params = []) {
  const match = sql.match(/replace\(lower\((?:a\.)?"(?:UserId|Id)"\), '-', ''\) = \$(\d+)/);
  return match ? params[Number(match[1]) - 1] : null;
}

function byUser(rows, sql, params, key = "UserId") {
  const only = restrictedUser(sql, params);
  return only ? rows.filter((row) => norm(row[key]) === only) : rows;
}

function fakeQuery(sql, params = []) {
  calls.push({ sql, params });
  if (sql.includes("fs_most_active_user")) {
    return { rows: byUser(PLAYS.map((p) => ({ Plays: p.Plays, UserId: p.UserId, Name: p.UserName })), sql, params) };
  }
  if (sql.includes("fs_last_library_activity") || sql.includes("latest_distinct_rows")) {
    return { rows: byUser(PLAYS.map((p) => ({ Id: p.Id, Name: p.NowPlayingItemName, UserId: p.UserId, UserName: p.UserName })), sql, params) };
  }
  if (sql.includes("fs_get_user_activity")) {
    return { rows: PLAYS.filter((p) => p.UserId === params[0]) };
  }
  if (sql.includes(`FROM jf_users WHERE "Id"=$1`) || sql.includes(`from jf_users where "Id"=$1`)) {
    return { rows: USERS.filter((u) => u.Id === params[0]) };
  }
  if (sql.includes(`AS "UserId", "Name" AS "UserName" FROM jf_users`)) {
    return { rows: byUser(USERS.map((u) => ({ UserId: u.Id, UserName: u.Name })), sql, params) };
  }
  // Home dashboard: Hall of Fame, most active this week, quiet users.
  if (sql.includes("FROM jf_users u") && sql.includes(`"WatchSeconds"`)) {
    return { rows: PLAYS.map((p) => ({ UserId: p.UserId, UserName: p.UserName, Plays: p.Plays, WatchSeconds: p.Plays * 600 })) };
  }
  if (sql.includes("'Unknown user'")) {
    return { rows: byUser(PLAYS.map((p) => ({ UserId: p.UserId, UserName: p.UserName, Plays: p.Plays, WatchSeconds: 600 })), sql, params).slice(0, 1) };
  }
  if (sql.includes(`max(a."ActivityDateInserted") AS "LastPlayed"`)) {
    return { rows: USERS.map((u) => ({ UserId: u.Id, UserName: u.Name, LastPlayed: null })) };
  }
  return { rows: [], rowCount: 0 };
}

// The paged history queries go through db-helper, which uses a pooled client.
function fakeClientQuery(sql, params = []) {
  calls.push({ sql, params });
  const rows = byUser(PLAYS, sql, params);
  if (/^\s*(WITH .*\))?\s*SELECT COUNT\(\*\)/is.test(sql)) return { rows: [{ count: rows.length }] };
  return { rows };
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
      connect: async () => ({ query: async (sql, params) => fakeClientQuery(sql, params), release() {} }),
    },
  },
};

const express = require("express");
const statsRouter = require("../routes/stats");
const apiRouter = require("../routes/api");
const commandCenterRouter = require("../routes/command-center");
const { DEFAULT_ROLE_PERMISSIONS } = require("../classes/role-permissions");
const { resolveActivityScope, restrictQueryToUser } = require("../classes/stats-access");

const CALLERS = {
  admin: {
    user: { id: ALICE, authMode: "quick-connect", role: "Admin", jellyfinUser: { id: ALICE, isAdministrator: true } },
    permissions: DEFAULT_ROLE_PERMISSIONS.Admin,
  },
  manager: {
    user: { id: "c3c3", authMode: "quick-connect", role: "Manager", jellyfinUser: { id: "c3c3" } },
    permissions: DEFAULT_ROLE_PERMISSIONS.Manager,
  },
  viewer: {
    user: { id: BOB, authMode: "quick-connect", role: "Viewer", jellyfinUser: { id: BOB, isAdministrator: false } },
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
  app.use("/api", commandCenterRouter, apiRouter);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const call = async (method, path, body) => {
      const response = await fetch(`http://127.0.0.1:${port}${path}`, {
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

const filters = (list) => encodeURIComponent(JSON.stringify(list));
const userIds = (rows) => (rows || []).map((row) => row.UserId);

const quiet = { log: console.log, error: console.error };
test.before(() => {
  console.log = () => {};
  console.error = () => {};
});
test.after(() => {
  console.log = quiet.log;
  console.error = quiet.error;
});

test("admin still sees everyone's activity", async () => {
  await withServer(CALLERS.admin, async (call) => {
    const history = await call("GET", "/api/getHistory");
    assert.equal(history.status, 200);
    assert.deepEqual(userIds(history.json.results), [ALICE, BOB]);
    assert.equal(history.json.scope, "all");

    const playback = await call("GET", "/stats/getPlaybackActivity");
    assert.deepEqual(userIds(playback.json.results), [ALICE, BOB]);

    const mostActive = await call("POST", "/stats/getMostActiveUsers", { days: 30 });
    assert.deepEqual(userIds(mostActive.json), [ALICE, BOB]);

    const timelineUsers = await call("GET", "/api/getTimelineUsers");
    assert.deepEqual(userIds(timelineUsers.json), [ALICE, BOB]);

    const otherTimeline = await call("POST", "/api/getActivityTimeLine", { userId: BOB, libraries: [] });
    assert.equal(otherTimeline.status, 200);

    const otherHistory = await call("POST", "/api/getUserHistory", { userid: BOB });
    assert.equal(otherHistory.status, 200);

    const home = await call("GET", "/stats/getHomeDashboard");
    assert.equal(home.json.scope, "all");
    assert.equal(home.json.hallOfFame.length, 2);
    assert.equal(home.json.weekPulse.mostActiveViewer.userId, ALICE);
    assert.equal(home.json.weekPulse.quietUsers.length, 2);
  });
});

test("roles with the Users permission and full API keys count as admin", async () => {
  for (const caller of [CALLERS.manager, CALLERS.apiKey]) {
    await withServer(caller, async (call) => {
      const history = await call("GET", "/api/getHistory");
      assert.deepEqual(userIds(history.json.results), [ALICE, BOB]);
      const details = await call("POST", "/api/getUserDetails", { userid: ALICE });
      assert.equal(details.status, 200);
      assert.equal(details.json.Name, "Alice");
    });
  }
});

test("viewer only sees their own rows on the activity lists", async () => {
  await withServer(CALLERS.viewer, async (call) => {
    const history = await call("GET", "/api/getHistory");
    assert.equal(history.status, 200);
    assert.deepEqual(userIds(history.json.results), [BOB]);
    assert.equal(history.json.scope, "self");

    // A search or other filters can't widen it.
    const searched = await call("GET", `/api/getHistory?search=slow&filters=${filters([{ field: "UserName", value: "alice" }])}`);
    assert.deepEqual(userIds(searched.json.results), [BOB]);

    const library = await call("POST", "/api/getLibraryHistory", { libraryid: "lib1" });
    assert.deepEqual(userIds(library.json.results), [BOB]);

    const item = await call("POST", "/api/getItemHistory?search=dune", { itemid: "item1" });
    assert.deepEqual(userIds(item.json.results), [BOB]);

    const playback = await call("GET", "/stats/getPlaybackActivity");
    assert.deepEqual(userIds(playback.json.results), [BOB]);

    const ownFilter = await call("GET", `/stats/getPlaybackActivity?filters=${filters([{ field: "UserId", value: BOB }])}`);
    assert.equal(ownFilter.status, 200);
    assert.deepEqual(userIds(ownFilter.json.results), [BOB]);

    const mostActive = await call("POST", "/stats/getMostActiveUsers", { days: 30 });
    assert.deepEqual(userIds(mostActive.json), [BOB]);

    const lastPlayed = await call("POST", "/stats/getLibraryLastPlayed", { libraryid: "lib1" });
    assert.deepEqual(userIds(lastPlayed.json), [BOB]);

    const timelineUsers = await call("GET", "/api/getTimelineUsers");
    assert.deepEqual(userIds(timelineUsers.json), [BOB]);

    const timeline = await call("POST", "/api/getActivityTimeLine", { userId: BOB, libraries: [] });
    assert.equal(timeline.status, 200);
    assert.deepEqual(userIds(timeline.json.results), [BOB]);
    const timelineQuery = calls.filter((entry) => entry.sql.includes("fs_get_user_activity")).pop();
    assert.equal(norm(timelineQuery.params[0]), BOB, "the timeline is queried with the viewer's own id");

    const own = await call("POST", "/api/getUserHistory?search=dune", { userid: BOB });
    assert.equal(own.status, 200);
    assert.deepEqual(userIds(own.json.results), [BOB]);
  });
});

test("viewer gets their own week on Home and no leaderboards", async () => {
  await withServer(CALLERS.viewer, async (call) => {
    const home = await call("GET", "/stats/getHomeDashboard");
    assert.equal(home.status, 200);
    assert.equal(home.json.scope, "self");
    assert.deepEqual(home.json.hallOfFame, []);
    assert.deepEqual(home.json.weekPulse.quietUsers, []);
    assert.equal(home.json.weekPulse.mostActiveViewer.userId, BOB);
  });
});

test("viewer gets 403 for another user's id, and nothing is queried for them", async () => {
  await withServer(CALLERS.viewer, async (call) => {
    calls.length = 0;
    const responses = [
      await call("GET", `/api/getHistory?filters=${filters([{ field: "UserId", value: ALICE }])}`),
      await call("POST", `/api/getLibraryHistory?filters=${filters([{ field: "UserId", in: `${BOB},${ALICE}` }])}`, { libraryid: "lib1" }),
      await call("GET", `/stats/getPlaybackActivity?filters=${filters([{ field: "UserId", value: ALICE }])}`),
      await call("POST", "/api/getUserHistory", { userid: ALICE }),
      await call("POST", "/api/getActivityTimeLine", { userId: ALICE, libraries: [] }),
      await call("POST", "/api/getUserDetails", { userid: ALICE }),
    ];
    assert.deepEqual(
      responses.map((response) => response.status),
      [403, 403, 403, 403, 403, 403]
    );
    for (const response of responses) assert.equal(response.json?.error, "You can only view your own activity");
    const touchedAlice = calls.some((entry) => (entry.params || []).some((param) => norm(param) === ALICE));
    assert.equal(touchedAlice, false, "no query ran with the other user's id");
  });
});

test("getUserDetails only returns the viewer's own user", async () => {
  await withServer(CALLERS.viewer, async (call) => {
    const own = await call("POST", "/api/getUserDetails", { userid: BOB });
    assert.equal(own.status, 200);
    assert.equal(own.json.Name, "Bob");
    const other = await call("POST", "/api/getUserDetails", { userid: ALICE });
    assert.equal(other.status, 403);
    assert.equal(other.json.error, "You can only view your own activity");
    assert.equal(other.json.Name, undefined);
  });
  await withServer(CALLERS.admin, async (call) => {
    const other = await call("POST", "/api/getUserDetails", { userid: BOB });
    assert.equal(other.status, 200);
    assert.equal(other.json.Name, "Bob");
  });
});

test("an account with no linked media-server user gets empty lists or 403", async () => {
  await withServer(CALLERS.localViewer, async (call) => {
    const history = await call("GET", "/api/getHistory");
    assert.equal(history.status, 200);
    assert.deepEqual(history.json.results, []);
    const playback = await call("GET", "/stats/getPlaybackActivity");
    assert.deepEqual(playback.json.results, []);
    const mostActive = await call("POST", "/stats/getMostActiveUsers", { days: 30 });
    assert.deepEqual(mostActive.json, []);
    const timelineUsers = await call("GET", "/api/getTimelineUsers");
    assert.deepEqual(timelineUsers.json, []);
    const details = await call("POST", "/api/getUserDetails", { userid: BOB });
    assert.equal(details.status, 403);
    assert.equal(details.json.error, "You can only view your own activity");
    const home = await call("GET", "/stats/getHomeDashboard");
    assert.equal(home.json.weekPulse.mostActiveViewer, null);
  });
});

test("search no longer drops the user and item condition on the history lists", async () => {
  await withServer(CALLERS.admin, async (call) => {
    calls.length = 0;
    await call("POST", "/api/getUserHistory?search=dune", { userid: BOB });
    const userQuery = calls.find((entry) => entry.sql.includes("jf_playback_activity_with_metadata") && !/COUNT\(\*\)/.test(entry.sql));
    assert.match(userQuery.sql, /"a"\."UserId" = \$1/);
    assert.match(userQuery.sql, /LIKE \$2/);

    calls.length = 0;
    await call("POST", "/api/getItemHistory?search=dune", { itemid: "item1" });
    const itemQuery = calls.find((entry) => entry.sql.includes("jf_playback_activity_with_metadata") && !/COUNT\(\*\)/.test(entry.sql));
    assert.match(itemQuery.sql, /"a"\."NowPlayingItemId" = \$3/);
    assert.match(itemQuery.sql, /LIKE \$4/);
  });
});

test("per-user widgets are admin-only for signed-in accounts but still work with API keys", async () => {
  await withServer(CALLERS.viewer, async (call) => {
    for (const slug of ["activity", "users", "statistics"]) {
      const response = await call("GET", `/api/widgets/${slug}`);
      assert.equal(response.status, 403, slug);
    }
  });
  await withServer(CALLERS.apiKey, async (call) => {
    const response = await call("GET", "/api/widgets/activity");
    assert.equal(response.status, 200);
  });
});

test("resolveActivityScope checks UserId filters", () => {
  const viewerReq = { user: CALLERS.viewer.user, permissions: CALLERS.viewer.permissions };
  assert.deepEqual(resolveActivityScope(viewerReq), { admin: false, userId: BOB, forbidden: false });
  assert.equal(resolveActivityScope(viewerReq, { filters: [{ field: "UserId", value: BOB.toUpperCase() }] }).forbidden, false);
  assert.equal(resolveActivityScope(viewerReq, { filters: [{ field: "UserId", value: ALICE }] }).forbidden, true);
  assert.equal(resolveActivityScope(viewerReq, { filters: [{ field: "UserId", in: `${BOB},${ALICE}` }] }).forbidden, true);
  assert.equal(resolveActivityScope(viewerReq, { userId: ALICE }).forbidden, true);
  const adminReq = { user: CALLERS.admin.user, permissions: CALLERS.admin.permissions };
  assert.deepEqual(resolveActivityScope(adminReq, { filters: [{ field: "UserId", value: BOB }] }), { admin: true, userId: null, forbidden: false });

  const query = { where: [{ column: "a.Id", operator: "=", value: "$1" }], values: ["x"] };
  restrictQueryToUser(query, "B2B2-B2B2");
  assert.deepEqual(query.values, ["x", "b2b2b2b2"]);
  assert.deepEqual(query.where[1], { field: `replace(lower(a."UserId"), '-', '')`, operator: "=", value: "$2" });
});

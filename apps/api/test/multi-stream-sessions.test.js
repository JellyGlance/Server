// Several streams at once from one device (or one user) must each show up as their own
// live session, history row and start/stop notification, on Jellyfin and on Emby.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const api = path.join(__dirname, "..");
const RealDate = Date;

function stubModule(relative, exports) {
  const file = require.resolve(path.join(api, relative));
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
}

function clearModule(relative) {
  delete require.cache[require.resolve(path.join(api, relative))];
}

const WATCHDOG_UPSERT = ["TranscodingInfo", "MediaStreams", "PlayMethod", "ActivityDateInserted", "PlaybackDuration", "IsPaused"];
const PLAYBACK_UPSERT = ["PlaybackDuration", "ActivityDateInserted"];

function columnNames(columns) {
  return columns.map((column) => (typeof column === "string" ? column : column.name));
}

function asStored(row, columns) {
  const stored = {};
  for (const name of columnNames(columns)) {
    let value = row[name] === undefined ? null : row[name];
    if (name === "ActivityDateInserted" && value) value = new RealDate(new Date(value).getTime());
    if (value && typeof value === "object" && !(value instanceof RealDate)) value = JSON.stringify(value);
    stored[name] = value;
  }
  return stored;
}

function fakeDb(tables) {
  const upsertColumns = { jf_activity_watchdog: WATCHDOG_UPSERT, jf_playback_activity: PLAYBACK_UPSERT };
  return {
    async query(sql) {
      if (sql.includes("FROM jf_activity_watchdog")) {
        return { rows: tables.jf_activity_watchdog.map((row) => ({ ...row })) };
      }
      if (sql.includes("jf_recent_playback_activity")) {
        // Latest row per user and item, as the SQL function returns it.
        const latest = new Map();
        for (const row of tables.jf_playback_activity) {
          const key = `${row.NowPlayingItemId}|${row.EpisodeId}|${row.UserId}`;
          const current = latest.get(key);
          if (!current || current.ActivityDateInserted < row.ActivityDateInserted) latest.set(key, row);
        }
        return { rows: [...latest.values()].map((row) => ({ ...row, Progress: 10, RunTimeTicks: 72_000_000_000 })) };
      }
      return { rows: [] };
    },
    async insertBulk(table, data, columns) {
      const seen = new Set();
      for (const row of data) {
        if (seen.has(row.Id)) continue; // db.insertBulk drops repeated Ids in one batch
        seen.add(row.Id);
        const stored = asStored(row, columns);
        const existing = tables[table].find((entry) => entry.Id === stored.Id);
        if (existing) {
          for (const name of upsertColumns[table]) existing[name] = stored[name];
        } else {
          tables[table].push(stored);
        }
      }
      return { Result: "SUCCESS" };
    },
    async deleteBulk(table, ids, pk = "Id") {
      tables[table] = tables[table].filter((row) => !ids.includes(row[pk]));
      return { Result: "SUCCESS" };
    },
  };
}

async function startMonitor(t) {
  let offset = 0;
  class FakeDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(RealDate.now() + offset);
      else super(...args);
    }
    static now() {
      return RealDate.now() + offset;
    }
  }

  const tables = { jf_activity_watchdog: [], jf_playback_activity: [] };
  const events = [];
  const state = { sessions: [] };
  let poll = null;

  const realSetInterval = global.setInterval;
  const realClearInterval = global.clearInterval;
  global.Date = FakeDate;
  global.setInterval = (fn) => {
    poll = fn;
    return { unref() {} };
  };
  global.clearInterval = () => {};
  t.after(() => {
    global.Date = RealDate;
    global.setInterval = realSetInterval;
    global.clearInterval = realClearInterval;
  });

  stubModule("db.js", fakeDb(tables));
  stubModule("classes/config.js", class {
    async getConfig() {
      return { state: 2, settings: {} };
    }
  });
  stubModule("classes/api-loader.js", { getSessions: async () => state.sessions.map((session) => structuredClone(session)) });
  stubModule("ws.js", { sendUpdate() {} });
  stubModule("classes/webhook-manager.js", class {
    async triggerEventWebhooks(event, data) {
      events.push({ event, data });
    }
    async flushQuietHoursDigest() {}
  });
  for (const relative of ["tasks/ActivityMonitor.js", "utils/playback-sessions.js", "utils/playback-notify.js"]) {
    try {
      clearModule(relative);
    } catch {
      // Not every module exists on every branch.
    }
  }

  const { ActivityMonitor } = require(path.join(api, "tasks/ActivityMonitor.js"));
  await ActivityMonitor(1000);

  return {
    tables,
    events,
    get watchdog() {
      return tables.jf_activity_watchdog;
    },
    get history() {
      return tables.jf_playback_activity;
    },
    setSessions(sessions) {
      state.sessions = sessions;
    },
    async tick(seconds = 1) {
      offset += seconds * 1000;
      await poll();
    },
    async run(seconds, step = 1) {
      for (let elapsed = 0; elapsed < seconds; elapsed += step) await this.tick(step);
    },
  };
}

function jellyfinSession({ id, playSessionId, itemId, name, deviceId = "living-room-shield", userId = "user-nt" }) {
  return {
    Id: id,
    UserId: userId,
    UserName: "NT",
    Client: "Jellyfin Android TV",
    DeviceName: "Living Room Shield",
    DeviceId: deviceId,
    ApplicationVersion: "0.18.4",
    NowPlayingItem: { Id: itemId, Name: name, Type: "Movie", RunTimeTicks: 72_000_000_000, MediaStreams: [] },
    PlayState: { IsPaused: false, PlayMethod: "DirectPlay", PositionTicks: 0, PlaySessionId: playSessionId },
  };
}

// Emby's session list has no PlaySessionId in PlayState.
function embySession({ id, itemId, name, deviceId = "bedroom-roku", userId = "user-nt" }) {
  const session = jellyfinSession({ id, itemId, name, deviceId, userId });
  session.Client = "Emby for Roku";
  delete session.PlayState.PlaySessionId;
  return session;
}

const started = (monitor) => monitor.events.filter((entry) => entry.event === "playback_started");
const ended = (monitor) => monitor.events.filter((entry) => entry.event === "playback_ended");

test("two Jellyfin streams on one device are two live sessions, two history rows and two notifications", async (t) => {
  const monitor = await startMonitor(t);
  monitor.setSessions([
    jellyfinSession({ id: "s-1", playSessionId: "p-1", itemId: "movie-a", name: "Arrival" }),
    jellyfinSession({ id: "s-2", playSessionId: "p-2", itemId: "movie-b", name: "Heat" }),
  ]);
  await monitor.run(10);

  assert.deepEqual(monitor.watchdog.map((row) => row.Id).sort(), ["s-1", "s-2"]);
  assert.deepEqual(monitor.watchdog.map((row) => row.NowPlayingItemId).sort(), ["movie-a", "movie-b"]);
  assert.deepEqual(started(monitor).map((entry) => entry.data.mediaInfo.itemId).sort(), ["movie-a", "movie-b"]);

  monitor.setSessions([]);
  await monitor.run(120, 5);

  assert.deepEqual(monitor.history.map((row) => row.NowPlayingItemId).sort(), ["movie-a", "movie-b"]);
  assert.equal(new Set(monitor.history.map((row) => row.Id)).size, 2);
  assert.deepEqual(ended(monitor).map((entry) => entry.data.mediaInfo.itemId).sort(), ["movie-a", "movie-b"]);
});

test("ending one stream on a device leaves the other one playing", async (t) => {
  const monitor = await startMonitor(t);
  const first = jellyfinSession({ id: "s-1", playSessionId: "p-1", itemId: "movie-a", name: "Arrival" });
  const second = jellyfinSession({ id: "s-2", playSessionId: "p-2", itemId: "movie-b", name: "Heat" });
  monitor.setSessions([first, second]);
  await monitor.run(30);

  monitor.setSessions([second]);
  await monitor.run(120, 5);

  assert.deepEqual(monitor.history.map((row) => row.NowPlayingItemId), ["movie-a"]);
  assert.deepEqual(monitor.watchdog.map((row) => row.Id), ["s-2"]);
  assert.equal(monitor.watchdog[0].NowPlayingItemId, "movie-b");
  assert.deepEqual(ended(monitor).map((entry) => entry.data.mediaInfo.itemId), ["movie-a"]);
  assert.ok(Number(monitor.history[0].PlaybackDuration) >= 25, "the first stream keeps its own watch time");
});

test("two Emby streams on one device without a PlaySessionId are still tracked apart", async (t) => {
  const monitor = await startMonitor(t);
  monitor.setSessions([
    embySession({ id: "e-1", itemId: "movie-a", name: "Arrival" }),
    embySession({ id: "e-2", itemId: "movie-b", name: "Heat" }),
  ]);
  await monitor.run(10);
  assert.equal(monitor.watchdog.length, 2);
  assert.equal(started(monitor).length, 2);

  monitor.setSessions([]);
  await monitor.run(120, 5);
  assert.deepEqual(monitor.history.map((row) => row.NowPlayingItemId).sort(), ["movie-a", "movie-b"]);
  assert.equal(ended(monitor).length, 2);
});

test("the same film playing twice at once is two history rows, not one merged row", async (t) => {
  const monitor = await startMonitor(t);
  const first = jellyfinSession({ id: "s-1", playSessionId: "p-1", itemId: "movie-a", name: "Arrival" });
  const second = jellyfinSession({ id: "s-2", playSessionId: "p-2", itemId: "movie-a", name: "Arrival" });
  monitor.setSessions([first, second]);
  await monitor.run(30);

  monitor.setSessions([second]);
  await monitor.run(20);
  monitor.setSessions([]);
  await monitor.run(120, 5);

  assert.equal(monitor.history.length, 2);
  assert.equal(started(monitor).length, 2);
  assert.equal(ended(monitor).length, 2);
});

test("one session playing two films in a row records both", async (t) => {
  const monitor = await startMonitor(t);
  monitor.setSessions([jellyfinSession({ id: "s-1", playSessionId: "p-1", itemId: "movie-a", name: "Arrival" })]);
  await monitor.run(30);
  monitor.setSessions([jellyfinSession({ id: "s-1", playSessionId: "p-2", itemId: "movie-b", name: "Heat" })]);
  await monitor.run(30);
  monitor.setSessions([]);
  await monitor.run(120, 5);

  assert.deepEqual(monitor.history.map((row) => row.NowPlayingItemId).sort(), ["movie-a", "movie-b"]);
});

test("a new PlaySessionId mid-film, as after a transcode restart, stays one viewing", async (t) => {
  const monitor = await startMonitor(t);
  monitor.setSessions([jellyfinSession({ id: "s-1", playSessionId: "p-1", itemId: "movie-a", name: "Arrival" })]);
  await monitor.run(30);
  monitor.setSessions([jellyfinSession({ id: "s-1", playSessionId: "p-1b", itemId: "movie-a", name: "Arrival" })]);
  await monitor.run(30);
  monitor.setSessions([]);
  await monitor.run(120, 5);

  assert.equal(monitor.history.length, 1);
  assert.ok(Number(monitor.history[0].PlaybackDuration) >= 55);
  assert.equal(started(monitor).length, 1);
  assert.equal(ended(monitor).length, 1);
});

test("two players sharing one Jellyfin session do not flood history or notifications", async (t) => {
  // Jellyfin keeps one session per app, device and user, so two tabs of the same browser
  // report into a single session and its now playing item flips between them.
  const monitor = await startMonitor(t);
  const first = jellyfinSession({ id: "s-1", itemId: "movie-a", name: "Arrival" });
  const second = jellyfinSession({ id: "s-1", itemId: "movie-b", name: "Heat" });
  for (let flip = 0; flip < 24; flip += 1) {
    monitor.setSessions([flip % 2 ? second : first]);
    await monitor.run(5);
  }
  monitor.setSessions([]);
  await monitor.run(120, 5);

  assert.deepEqual(monitor.history.map((row) => row.NowPlayingItemId).sort(), ["movie-a", "movie-b"]);
  assert.ok(started(monitor).length <= 2);
});

test("picking a film back up after stopping still adds to the same history row", async (t) => {
  const monitor = await startMonitor(t);
  monitor.setSessions([jellyfinSession({ id: "s-1", playSessionId: "p-1", itemId: "movie-a", name: "Arrival" })]);
  await monitor.run(30);
  monitor.setSessions([]);
  await monitor.run(60, 5);
  assert.equal(monitor.history.length, 1);

  monitor.setSessions([jellyfinSession({ id: "s-9", playSessionId: "p-9", itemId: "movie-a", name: "Arrival" })]);
  await monitor.run(30);
  monitor.setSessions([]);
  await monitor.run(60, 5);

  assert.equal(monitor.history.length, 1);
  assert.ok(Number(monitor.history[0].PlaybackDuration) >= 55);
});

function webhookGate(t) {
  let offset = 0;
  class FakeDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(RealDate.now() + offset);
      else super(...args);
    }
    static now() {
      return RealDate.now() + offset;
    }
  }
  global.Date = FakeDate;
  for (const [relative, exports] of [
    ["db.js", {}],
    ["classes/config.js", class {}],
    ["classes/admin-history.js", {}],
    ["classes/discord-webhook-media.js", {}],
  ]) stubModule(relative, exports);
  clearModule("classes/webhook-manager.js");
  const WebhookManager = require(path.join(api, "classes/webhook-manager.js"));
  const manager = Object.create(WebhookManager.prototype);
  t.after(() => {
    global.Date = RealDate;
    clearModule("classes/webhook-manager.js");
  });
  return {
    at(seconds) {
      offset = seconds * 1000;
      return this;
    },
    emit(event, data) {
      return manager.shouldEmitPlaybackWebhook(event, data);
    },
  };
}

function webhookPayload(sessionId, playSessionId, itemId) {
  return {
    sessionInfo: { sessionId, playSessionId, deviceId: "living-room-shield", isPaused: false },
    userData: { userId: "user-nt", username: "NT" },
    mediaInfo: { itemId },
  };
}

test("playback webhooks go out for each stream's start and stop", (t) => {
  const gate = webhookGate(t);
  assert.equal(gate.at(0).emit("playback_started", webhookPayload("s-1", "p-1", "movie-a")), true);
  assert.equal(gate.at(5).emit("playback_started", webhookPayload("s-2", "p-2", "movie-b")), true);
  assert.equal(gate.at(10).emit("playback_started", webhookPayload("s-1", "p-1", "movie-a")), false, "a repeat of the same stream");
  assert.equal(gate.at(60).emit("playback_ended", webhookPayload("s-1", "p-1", "movie-a")), true);
  assert.equal(gate.at(65).emit("playback_ended", webhookPayload("s-2", "p-2", "movie-b")), true);
  assert.equal(gate.at(70).emit("playback_ended", webhookPayload("s-2", "p-2", "movie-b")), false, "a repeat stop");
});

test("the same film started on two screens at once sends two starts", (t) => {
  const gate = webhookGate(t);
  assert.equal(gate.at(0).emit("playback_started", webhookPayload("s-1", "p-1", "movie-a")), true);
  assert.equal(gate.at(3).emit("playback_started", webhookPayload("s-2", "p-2", "movie-a")), true);
});

test("picking a film back up later still does not send a second start", (t) => {
  const gate = webhookGate(t);
  assert.equal(gate.at(0).emit("playback_started", webhookPayload("s-1", "p-1", "movie-a")), true);
  assert.equal(gate.at(600).emit("playback_ended", webhookPayload("s-1", "p-1", "movie-a")), true);
  assert.equal(gate.at(1200).emit("playback_started", webhookPayload("s-7", "p-7", "movie-a")), false);
});

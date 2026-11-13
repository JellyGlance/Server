const test = require("node:test");
const assert = require("node:assert/strict");
const { buildPeakGrid, calendarItemsInWindow } = require("../classes/home-widgets");
const { toSession, setDemoSessionsMode } = require("../classes/demo-sessions");

test("peak grid finds the busiest hour and the quietest three-hour window", () => {
  const rows = [];
  for (let dow = 1; dow <= 7; dow += 1) for (let hour = 0; hour < 24; hour += 1) rows.push({ dow, hour, plays: 2 });
  rows.push({ dow: 5, hour: 21, plays: 10 });
  rows.find((r) => r.dow === 2 && r.hour === 3).plays = 0;
  rows.find((r) => r.dow === 2 && r.hour === 4).plays = 0;
  const result = buildPeakGrid(rows);
  assert.deepEqual(result.busiest, { day: 4, hour: 21, plays: 12 });
  assert.equal(result.quietest.day, 1);
  assert.ok([2, 3].includes(result.quietest.hour));
  assert.equal(result.max, 12);
});

test("peak grid with no plays has no quietest window", () => {
  const result = buildPeakGrid([]);
  assert.equal(result.total, 0);
  assert.equal(result.busiest, null);
  assert.equal(result.quietest, null);
});

test("calendar window keeps only the next 24 hours in order", () => {
  const now = new Date("2026-11-11T18:00:00Z");
  const items = calendarItemsInWindow(
    {
      releases: [
        { id: 1, title: "Later", date: "2026-11-12T20:00:00Z" },
        { id: 2, title: "Tonight", date: "2026-11-11T21:00:00Z" },
        { id: 3, title: "Earlier", date: "2026-11-11T19:00:00Z" },
        { id: 4, title: "Gone", date: "2026-11-11T10:00:00Z" },
      ],
    },
    { now }
  );
  assert.deepEqual(items.map((item) => item.title), ["Earlier", "Tonight"]);
});

test("demo sessions are marked and transcode details are filled in", () => {
  const session = toSession(
    { Id: "abc", UserId: "u", UserName: "Ana", PlayMethod: "Transcode", TranscodingInfo: { Bitrate: 8000000 }, RunTimeTicks: 36000000000, NowPlayingItemName: "Film" },
    0,
    Date.now()
  );
  assert.equal(session.IsDemo, true);
  assert.match(session.Id, /^demo-/);
  assert.equal(session.TranscodingInfo.Bitrate, 8000000);
  assert.equal(session.TranscodingInfo.VideoCodec, "h264");
  assert.ok(session.PlayState.PositionTicks < 36000000000);
  assert.equal(setDemoSessionsMode("nope"), false);
  assert.equal(setDemoSessionsMode("3"), true);
});

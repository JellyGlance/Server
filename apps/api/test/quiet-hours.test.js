const test = require("node:test");
const assert = require("node:assert/strict");
const qh = require("../classes/quiet-hours");

const base = { enabled: true, start: "22:00", end: "07:00", timeZone: "UTC", days: qh.DAY_KEYS, scans: true, intros: true };
const at = (iso) => new Date(iso);

test("overnight window matches either side of midnight", () => {
  assert.equal(qh.isInQuietHours(base, at("2026-11-02T23:30:00Z")), true);
  assert.equal(qh.isInQuietHours(base, at("2026-11-03T06:59:00Z")), true);
  assert.equal(qh.isInQuietHours(base, at("2026-11-03T07:00:00Z")), false);
  assert.equal(qh.isInQuietHours(base, at("2026-11-02T21:59:00Z")), false);
});

test("same-day window and disabled / empty windows", () => {
  const day = { ...base, start: "18:00", end: "23:00" };
  assert.equal(qh.isInQuietHours(day, at("2026-11-02T18:00:00Z")), true);
  assert.equal(qh.isInQuietHours(day, at("2026-11-02T23:00:00Z")), false);
  assert.equal(qh.isInQuietHours({ ...day, enabled: false }, at("2026-11-02T19:00:00Z")), false);
  assert.equal(qh.isInQuietHours({ ...day, end: "18:00" }, at("2026-11-02T18:00:00Z")), false);
});

test("weekday filter uses the day the window starts", () => {
  const fri = { ...base, days: ["fri"] };
  assert.equal(qh.isInQuietHours(fri, at("2026-11-06T23:00:00Z")), true); // Friday night
  assert.equal(qh.isInQuietHours(fri, at("2026-11-07T05:00:00Z")), true); // Saturday morning, Friday's window
  assert.equal(qh.isInQuietHours(fri, at("2026-11-07T23:00:00Z")), false); // Saturday night
  assert.equal(qh.isInQuietHours(fri, at("2026-11-06T05:00:00Z")), false); // Friday morning, Thursday's window
});

test("time zone shifts the window", () => {
  const ny = { ...base, start: "01:00", end: "02:00", timeZone: "America/New_York" };
  assert.equal(qh.isInQuietHours(ny, at("2026-11-02T06:30:00Z")), true);
  assert.equal(qh.isInQuietHours(ny, at("2026-11-02T01:30:00Z")), false);
});

test("nextChange finds the end of the window", () => {
  assert.equal(qh.nextChange(base, at("2026-11-02T23:30:20Z")), "2026-11-03T07:00:00.000Z");
  assert.equal(qh.nextChange({ ...base, enabled: false }), null);
});

test("normalize rejects bad input", () => {
  const value = qh.normalizeQuietHours({ enabled: 1, start: "25:00", end: "7", timeZone: "Mars/Base", days: ["mon", "x"] });
  assert.deepEqual(value, { enabled: true, start: "00:00", end: "07:00", timeZone: "", days: ["mon"], scans: true, intros: true, runDeferred: true });
  assert.equal(qh.normalizeQuietHours({ start: "21:30" }, { enabled: true, end: "06:15" }).end, "06:15");
});

test("classifyTask spots scans and intro/credits jobs", () => {
  assert.equal(qh.classifyTask({ Key: "RefreshLibrary", Name: "Scan Media Library" }), "scan");
  assert.equal(qh.classifyTask({ Key: "IntroSkipperDetectIntros", Name: "Detect Intros" }), "intro");
  assert.equal(qh.classifyTask({ Name: "Detect Credits", Category: "Intro Skipper" }), "intro");
  assert.equal(qh.classifyTask({ Key: "MediaSegmentExtract", Name: "Media Segment Scan" }), "intro");
  assert.equal(qh.classifyTask({ Key: "CleanActivityLog", Name: "Clean Activity Log" }), null);
  assert.equal(qh.isHeld({ scans: false, intros: true }, { Key: "RefreshLibrary" }), false);
});

test("manual runs are exempt for a grace period", () => {
  qh.markManualRun("abc", 1000);
  assert.equal(qh.isManualRun("abc", 2000), true);
  assert.equal(qh.isManualRun("abc", 1000 + 7 * 3600000), false);
  assert.equal(qh.isManualRun("other"), false);
});

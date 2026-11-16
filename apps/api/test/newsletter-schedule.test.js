const test = require("node:test");
const assert = require("node:assert/strict");

const schedule = require("../classes/newsletter-schedule");

test("buildScheduleCron stores weekdays, day of month and time", () => {
  assert.equal(schedule.buildScheduleCron({ weekdays: [1, 4], hour: 9, minute: 30 }), "30 9 * * 1,4");
  assert.equal(schedule.buildScheduleCron({ dayOfMonth: 15, hour: 18, minute: 0 }), "0 18 15 * *");
  assert.equal(schedule.buildScheduleCron({ weekdays: [1], dayOfMonth: 1, hour: 8, minute: 5 }), "5 8 1 * 1");
  assert.equal(schedule.buildScheduleCron({ weekdays: [], dayOfMonth: "", hour: 9, minute: 0 }), null);
});

test("parseScheduleCron round-trips a weekly and monthly expression", () => {
  assert.deepEqual(schedule.parseScheduleCron("30 9 * * 1,4"), { weekdays: [1, 4], dayOfMonth: "", hour: 9, minute: 30 });
  assert.deepEqual(schedule.parseScheduleCron("0 18 15 * *"), { weekdays: [], dayOfMonth: 15, hour: 18, minute: 0 });
});

test("campaignDue uses cron in the server timezone instead of a 6.5 or 28 day gap", () => {
  const campaign = {
    enabled: true,
    frequency: "weekly",
    scheduleCron: "0 9 * * 1",
    createdAt: "2026-10-01T00:00:00Z",
    lastSentAt: "2026-11-02T09:01:00Z",
  };

  // Monday 9 Nov 2026 09:00 in Europe/London (UTC+0 in November).
  const mondayNine = new Date("2026-11-09T09:00:00Z");
  assert.equal(schedule.campaignDue(campaign, mondayNine, { timeZone: "Europe/London" }), true);
  assert.equal(schedule.campaignDue({ ...campaign, lastSentAt: "2026-11-09T09:01:00Z" }, mondayNine, { timeZone: "Europe/London" }), false);

  // Tuesday is not a Monday slot.
  const tuesday = new Date("2026-11-10T09:00:00Z");
  assert.equal(schedule.campaignDue({ ...campaign, lastSentAt: "2026-11-09T09:01:00Z" }, tuesday, { timeZone: "Europe/London" }), false);

  // Manual never fires.
  assert.equal(schedule.campaignDue({ ...campaign, frequency: "manual" }, mondayNine, { timeZone: "Europe/London" }), false);

  // A campaign created after the last slot is not back-filled.
  const brandNew = { ...campaign, createdAt: "2026-11-09T12:00:00Z", lastSentAt: null };
  assert.equal(schedule.campaignDue(brandNew, new Date("2026-11-09T15:00:00Z"), { timeZone: "Europe/London" }), false);
});

test("campaignDue honours a timezone that is not UTC", () => {
  const campaign = {
    enabled: true,
    frequency: "weekly",
    scheduleCron: "0 9 * * 1",
    createdAt: "2026-10-01T00:00:00Z",
    lastSentAt: "2026-11-02T14:01:00Z",
  };
  // Monday 9 Nov 2026 09:00 America/New_York is 14:00 UTC.
  const before = new Date("2026-11-09T13:59:00Z");
  const atSlot = new Date("2026-11-09T14:00:00Z");
  assert.equal(schedule.campaignDue(campaign, before, { timeZone: "America/New_York" }), false);
  assert.equal(schedule.campaignDue(campaign, atSlot, { timeZone: "America/New_York" }), true);
});

test("a missed slot is still due later the same day, but only once", () => {
  const campaign = {
    enabled: true,
    frequency: "weekly",
    scheduleCron: "0 9 * * 1",
    createdAt: "2026-10-01T00:00:00Z",
    lastSentAt: "2026-11-02T09:01:00Z",
  };
  const later = new Date("2026-11-09T11:30:00Z");
  assert.equal(schedule.campaignDue(campaign, later, { timeZone: "Europe/London" }), true);
  assert.equal(
    schedule.campaignDue({ ...campaign, lastSentAt: "2026-11-09T11:31:00Z" }, later, { timeZone: "Europe/London" }),
    false
  );
});

test("weekday or day-of-month schedules both match when both fields are set", () => {
  const campaign = {
    enabled: true,
    frequency: "scheduled",
    scheduleCron: "0 9 15 * 1",
    createdAt: "2026-10-01T00:00:00Z",
    lastSentAt: null,
  };
  // Monday 9 Nov 2026 (weekday match, not the 15th).
  assert.equal(schedule.campaignDue(campaign, new Date("2026-11-09T09:00:00Z"), { timeZone: "Europe/London" }), true);
  // Sunday 15 Nov 2026 (day-of-month match, not Monday).
  assert.equal(schedule.campaignDue(campaign, new Date("2026-11-15T09:00:00Z"), { timeZone: "Europe/London" }), true);
});

test("nextOccurrence looks ahead in the given timezone", () => {
  const next = schedule.nextOccurrence("0 9 * * 1", new Date("2026-11-10T10:00:00Z"), "Europe/London");
  assert.equal(next.toISOString(), "2026-11-16T09:00:00.000Z");
});

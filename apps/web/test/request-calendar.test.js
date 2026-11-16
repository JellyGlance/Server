import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { dayHeading, dayNumber, itemKindLabel, rangeLabel, shiftDays, todayKey, visibleDays, weekdayLabel } from "../src/pages/requests/calendar.js";

describe("calendar dates", () => {
  it("shifts across month and year ends", () => {
    assert.equal(shiftDays("2026-11-28", 7), "2026-12-05");
    assert.equal(shiftDays("2026-12-30", 3), "2027-01-02");
    assert.equal(shiftDays("2026-03-01", -1), "2026-02-28");
  });

  it("labels days and ranges", () => {
    assert.equal(weekdayLabel("2026-11-12"), "Thu");
    assert.equal(dayNumber("2026-11-02"), 2);
    assert.equal(rangeLabel("2026-11-12", "2026-11-18"), "12 \u2013 18 Nov");
    assert.equal(rangeLabel("2026-11-28", "2026-12-04"), "28 Nov \u2013 4 Dec");
    assert.equal(rangeLabel("2026-11-12", "2026-11-12"), "12 Nov");
  });

  it("marks today and tomorrow in the heading", () => {
    assert.equal(dayHeading("2026-11-12", "2026-11-12"), "Today \u00b7 Thu 12 Nov");
    assert.equal(dayHeading("2026-11-13", "2026-11-12"), "Tomorrow \u00b7 Fri 13 Nov");
    assert.equal(dayHeading("2026-11-16", "2026-11-12"), "Mon 16 Nov");
  });

  it("builds a local date key", () => {
    assert.equal(todayKey(new Date(2026, 0, 5, 23, 59)), "2026-01-05");
  });
});

describe("calendar items", () => {
  it("uses the episode label for episodes and the kind otherwise", () => {
    assert.equal(itemKindLabel({ kind: "Episode", label: "S02E07" }), "S02E07");
    assert.equal(itemKindLabel({ kind: "Premiere" }), "Premiere");
    assert.equal(itemKindLabel({}), "Release");
  });

  it("filters to the picked day", () => {
    const days = [{ date: "2026-11-12", items: [1] }, { date: "2026-11-13", items: [] }];
    assert.equal(visibleDays(days, null).length, 2);
    assert.deepEqual(visibleDays(days, "2026-11-13").map((d) => d.date), ["2026-11-13"]);
    assert.deepEqual(visibleDays(undefined, null), []);
  });
});

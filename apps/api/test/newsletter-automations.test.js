const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const automations = require("../classes/newsletter-automations");

describe("newsletter automations", () => {
  it("keeps welcome, milestone, admin digest and re-engagement off by default", () => {
    const defaults = automations.defaultAutomations();
    assert.equal(defaults.welcome.enabled, false);
    assert.equal(defaults.milestone.enabled, false);
    assert.equal(defaults.adminDigest.enabled, false);
    assert.equal(defaults.reengagement.enabled, false);
    const kept = automations.normalizeAutomations({}, { welcome: { enabled: true } });
    assert.equal(kept.welcome.enabled, true);
  });

  it("detects play and year milestones without backfilling lower marks as 'just hit'", () => {
    assert.deepEqual(automations.crossedPlayMilestone(99, 100, [100, 500]), [100]);
    assert.deepEqual(automations.crossedPlayMilestone(100, 100, [100, 500]), []);
    assert.ok(automations.yearsBetween(new Date(Date.now() - 366 * 24 * 60 * 60 * 1000)) >= 1);
    assert.deepEqual(automations.crossedYearMilestone(new Date(Date.now() - 366 * 24 * 60 * 60 * 1000), [1]), [1]);
  });

  it("renders welcome, milestone, re-engagement and admin digest emails", () => {
    const welcome = automations.buildWelcomeEmail({
      person: { name: "Alex" },
      items: [{ Id: "1", Name: "Gnomes", Type: "Series", ProductionYear: 2026 }],
      locale: "en-GB",
      base: "http://127.0.0.1:3410",
    });
    assert.match(welcome.subject, /welcome/i);
    assert.match(welcome.html, /Alex/);
    assert.match(welcome.html, /Gnomes/);

    const milestone = automations.buildMilestoneEmail({
      person: { name: "Alex" },
      kind: "plays",
      mark: 100,
      favourite: "Gnomes",
      locale: "en-GB",
      base: "http://127.0.0.1:3410",
    });
    assert.match(milestone.subject, /100/);
    assert.match(milestone.html, /Gnomes/);

    const year = automations.buildMilestoneEmail({
      person: { name: "Alex" },
      kind: "year",
      mark: 1,
      locale: "en-GB",
      base: "http://127.0.0.1:3410",
    });
    assert.match(year.html, /year/i);

    const reengage = automations.buildReengagementEmail({
      person: { name: "Alex" },
      items: [{ Id: "1", Name: "The Rookie", Type: "Series" }],
      inactiveDays: 30,
      lastWatched: "1 Oct 2026",
      locale: "en-GB",
      base: "http://127.0.0.1:3410",
    });
    assert.match(reengage.subject, /welcome back/i);
    assert.match(reengage.html, /The Rookie/);

    const admin = automations.buildAdminDigestEmail({
      stats: { storageLabel: "3.9 TB", newItems: 12, newUsers: 1, openRequests: 4, missingPosters: 3 },
      items: [{ Id: "1", Name: "Gnomes", Type: "Series" }],
      locale: "en-GB",
      base: "http://127.0.0.1:3410",
    });
    assert.match(admin.html, /3\.9 TB/);
    assert.match(admin.html, /Gnomes/);
  });

  it("does not send automations when notifications are disabled", async () => {
    const previous = process.env.JG_DISABLE_NOTIFICATIONS;
    process.env.JG_DISABLE_NOTIFICATIONS = "1";
    try {
      const result = await automations.runDueAutomations({
        automations: {
          welcome: { enabled: true },
          milestone: { enabled: true },
          adminDigest: { enabled: true },
          reengagement: { enabled: true },
        },
        directory: [{ id: "1", email: "someone@example.com", role: "Admin" }],
      });
      assert.equal(result.skipped, "notifications-disabled");
      assert.deepEqual(result.results, []);
    } finally {
      if (previous == null) delete process.env.JG_DISABLE_NOTIFICATIONS;
      else process.env.JG_DISABLE_NOTIFICATIONS = previous;
    }
  });

  it("shows the kicker once and a Europe/London timestamp instead of a raw ISO date", () => {
    const generatedAt = new Date("2026-11-13T00:07:39.088Z");
    const welcome = automations.buildWelcomeEmail({
      person: { name: "Alex" },
      items: [{ Id: "1", Name: "A Very Long Title That Should Wrap Without Clipping", Type: "Movie" }],
      locale: "en-GB",
      base: "http://127.0.0.1:3410",
      generatedAt,
    });
    const kickers = welcome.html.match(/text-transform:uppercase;">Welcome<\/div>/g) || [];
    assert.equal(kickers.length, 1);
    assert.doesNotMatch(welcome.html, /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
    assert.match(welcome.html, /13 Nov 2026, 00:07 GMT/);
    assert.match(welcome.html, /Welcome, Alex/);
    assert.match(welcome.html, /overflow-wrap:anywhere/);
    assert.equal(welcome.generatedAt, "13 Nov 2026, 00:07 GMT");
    assert.equal(automations.formatLondonTime(generatedAt), "13 Nov 2026, 00:07 GMT");
  });

  it("prefers a recent used Wizarr invitee and falls back to a labelled sample user", () => {
    const users = [
      { name: "Ben", email: "ben@example.com" },
      { name: "Sam", email: "sam@example.com" },
    ];
    const invitee = automations.pickWelcomePerson({
      users,
      invitees: [
        { displayName: "Pending Pat", status: "pending", created: "2026-11-12T12:00:00Z" },
        { usedBy: "Sam", status: "used", usedAt: "2026-11-10T10:00:00Z" },
        { usedBy: "Casey", status: "used", usedAt: "2026-11-11T09:00:00Z" },
      ],
    });
    assert.equal(invitee.name, "Casey");
    assert.equal(invitee.invitee, true);
    assert.equal(invitee.sample, false);

    const matched = automations.pickWelcomePerson({
      users,
      invitees: [{ usedBy: { username: "Sam" }, status: "used", usedAt: "2026-11-10T10:00:00Z" }],
    });
    assert.equal(matched.name, "Sam");
    assert.equal(matched.email, "sam@example.com");

    const sample = automations.pickWelcomePerson({ users, invitees: [], sampleName: "Sample viewer" });
    assert.equal(sample.name, "Sample viewer");
    assert.equal(sample.sample, true);

    const preview = automations.buildWelcomeEmail({
      person: sample,
      items: [],
      locale: "en-GB",
      generatedAt: new Date("2026-11-13T00:07:39.088Z"),
    });
    assert.match(preview.html, /Sample viewer/);
    assert.match(preview.html, /This is a sample preview\. No recent Wizarr invitee was found\./);
  });
});

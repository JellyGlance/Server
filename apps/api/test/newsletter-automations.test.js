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
      base: "http://192.168.0.200:3410",
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
      base: "http://192.168.0.200:3410",
    });
    assert.match(milestone.subject, /100/);
    assert.match(milestone.html, /Gnomes/);

    const year = automations.buildMilestoneEmail({
      person: { name: "Alex" },
      kind: "year",
      mark: 1,
      locale: "en-GB",
      base: "http://192.168.0.200:3410",
    });
    assert.match(year.html, /year/i);

    const reengage = automations.buildReengagementEmail({
      person: { name: "Alex" },
      items: [{ Id: "1", Name: "The Rookie", Type: "Series" }],
      inactiveDays: 30,
      lastWatched: "1 Oct 2026",
      locale: "en-GB",
      base: "http://192.168.0.200:3410",
    });
    assert.match(reengage.subject, /welcome back/i);
    assert.match(reengage.html, /The Rookie/);

    const admin = automations.buildAdminDigestEmail({
      stats: { storageLabel: "3.9 TB", newItems: 12, newUsers: 1, openRequests: 4, missingPosters: 3 },
      items: [{ Id: "1", Name: "Gnomes", Type: "Series" }],
      locale: "en-GB",
      base: "http://192.168.0.200:3410",
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
});

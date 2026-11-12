const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const reportBuilder = require("../classes/newsletter-report-builder");
const newsletterI18n = require("../classes/newsletter-i18n");
const newsletterTheme = require("../classes/newsletter-theme");

const items = [
  { Id: "movie-1", Name: "Arrival", Type: "Movie", ProductionYear: 2016, Library: "Films", PrimaryImageHash: "abc" },
  { Id: "show-2", Name: "Severance", Type: "Series", ProductionYear: 2022, Library: "TV", PrimaryImageHash: "def" },
];

function ctx(overrides = {}) {
  const theme = newsletterTheme.normalizeBranding({ mode: "light", accent: "#2255aa" });
  const { t, locale } = newsletterI18n.translator(overrides.locale || "en-GB");
  return { theme, accent: theme.accent, t, locale, publicBase: "https://jellyglance.example", ...overrides };
}

describe("newsletter report poster cards", () => {
  it("stores the cards style and renders absolute poster URLs with item deep links", () => {
    const block = reportBuilder.normalizeBlock({ type: "recentlyAdded", options: { style: "cards", limit: 8 } });
    assert.equal(block.options.style, "cards");
    const html = reportBuilder.renderBlock(block, { items }, ctx());
    assert.match(html, /proxy\/Items\/Images\/Primary\/\?id=movie-1&amp;fillWidth=240&amp;quality=80/);
    assert.match(html, /https:\/\/jellyglance\.example\/libraries\/item\/movie-1/);
    assert.match(html, /https:\/\/jellyglance\.example\/libraries\/item\/show-2/);
    assert.match(html, /src="https:\/\/jellyglance\.example\/proxy\//);
    assert.match(html, /Arrival/);
    assert.doesNotMatch(html, /<script/i);
  });

  it("falls back to a letter tile when no public URL is configured", () => {
    const block = reportBuilder.normalizeBlock({ type: "recentlyAdded", options: { style: "cards" } });
    const html = reportBuilder.renderBlock(block, { items }, ctx({ publicBase: "" }));
    assert.match(html, /No artwork/);
    assert.doesNotMatch(html, /proxy\/Items\/Images/);
    assert.doesNotMatch(html, /href="https?:\/\/[^"]*\/libraries\/item\//);
    assert.match(html, /Arrival/);
  });

  it("keeps the list layout as the default and still deep-links titles", () => {
    const block = reportBuilder.normalizeBlock({ type: "recentlyAdded", options: {} });
    assert.equal(block.options.style, "list");
    const html = reportBuilder.renderBlock(block, { items }, ctx());
    assert.doesNotMatch(html, /<img /);
    assert.match(html, /href="https:\/\/jellyglance\.example\/libraries\/item\/movie-1"/);
  });

  it("links request cards into /requests", () => {
    const block = reportBuilder.normalizeBlock({ type: "myRequests", options: { style: "cards" } });
    const html = reportBuilder.renderBlock(block, { items: [{ Name: "Dune", Type: "movie", status: "Available", requestId: 17, Id: 17 }] }, ctx());
    assert.match(html, /https:\/\/jellyglance\.example\/requests\?request=17/);
  });

  it("translates leftover English headings and empty copy for the recipient", () => {
    const block = reportBuilder.normalizeBlock({ type: "recentlyAdded", title: "", options: { style: "list" } });
    const html = reportBuilder.renderBlock(block, { items: [] }, ctx({ locale: "de-DE" }));
    assert.match(html, /K\u00fcrzlich hinzugef\u00fcgt/);
    assert.match(html, /kein neuer Inhalt|kein neuer/i);
    const stats = reportBuilder.renderBlock(reportBuilder.normalizeBlock({ type: "stats" }), { days: 7, plays: 0, seconds: 0, viewers: 0, added: 0, titles: 0 }, ctx({ locale: "de-DE" }));
    assert.match(stats, /Auf einen Blick|Wiedergaben/);
  });

  it("uses the template theme colours instead of hardcoded dark hex", () => {
    const block = reportBuilder.normalizeBlock({ type: "recentlyAdded", title: "New", options: { style: "list" } });
    const html = reportBuilder.renderBlock(block, { items }, ctx());
    assert.match(html, /color:#101828/);
    assert.doesNotMatch(html, /color:#f4f8ff/);
  });
});

describe("newsletter for-you block", () => {
  it("is a per-user block and renders picks plus because-you-watched rows", () => {
    assert.equal(reportBuilder.PER_USER_BLOCKS.has("forYou"), true);
    assert.ok(reportBuilder.REPORT_BLOCK_TYPES.includes("forYou"));
    const block = reportBuilder.normalizeBlock({ type: "forYou", options: { style: "cards", limit: 4 } });
    const data = {
      picks: [
        { Id: "p1", Name: "Arrival", Type: "Movie", ProductionYear: 2016, PrimaryImageHash: "h", reasonGenres: ["Science Fiction", "Drama"] },
      ],
      because: [
        { seed: { id: "s1", name: "Dune" }, items: [{ Id: "p2", Name: "Interstellar", Type: "Movie", ProductionYear: 2014, PrimaryImageHash: "i" }] },
      ],
    };
    const html = reportBuilder.renderBlock(block, data, ctx({ locale: "en-GB" }));
    assert.match(html, /Picked for you/);
    assert.match(html, /Arrival/);
    assert.match(html, /You watch a lot of Science Fiction &amp; Drama/);
    assert.match(html, /Because you watched Dune/);
    assert.match(html, /Interstellar/);
    assert.match(html, /libraries\/item\/p1/);
    assert.match(html, /proxy\/Items\/Images\/Primary/);
    const de = reportBuilder.renderBlock(reportBuilder.normalizeBlock({ type: "forYou" }), { picks: [], because: [] }, ctx({ locale: "de-DE" }));
    assert.match(de, /F\u00fcr dich ausgew\u00e4hlt|Noch keine Vorschl/);
  });
});

describe("newsletter wrapped recap block", () => {
  it("renders hours, top shows and films, and the busiest day for a chosen period", () => {
    const block = reportBuilder.normalizeBlock({ type: "wrappedRecap", options: { wrappedPeriod: "month", style: "list" } });
    assert.equal(block.options.wrappedPeriod, "month");
    const html = reportBuilder.renderBlock(block, {
      period: "month",
      start: "2026-11-01",
      year: 2026,
      totals: { plays: 12, seconds: 3600 * 8 },
      busiestDay: { day: "2026-11-08", plays: 5, seconds: 7200 },
      topShows: [{ Name: "The Crown", Id: "s1", Plays: 4, WatchSeconds: 3600 }],
      topMovies: [{ Name: "Arrival", Id: "m1", Plays: 2, WatchSeconds: 1800 }],
    }, ctx());
    assert.match(html, /Your recap|November 2026|Nov 2026/);
    assert.match(html, /Hours watched/);
    assert.match(html, /Busiest day/);
    assert.match(html, /width:33%/);
    assert.doesNotMatch(html, /width:25%/);
    assert.match(html, /The Crown/);
    assert.match(html, /Arrival/);
    assert.match(html, /Top shows/);
    assert.match(html, /Top films/);
    const empty = reportBuilder.renderBlock(block, { period: "week", start: "2026-11-09", totals: { plays: 0, seconds: 0 }, topShows: [], topMovies: [] }, ctx({ locale: "de-DE" }));
    assert.match(empty, /Dein R\u00fcckblick|Keine Wiedergaben/);
  });
});

describe("newsletter leaving-soon block", () => {
  it("renders cleanup and Maintainerr matches with a countdown, read-only", () => {
    const block = reportBuilder.normalizeBlock({ type: "leavingSoon", options: { style: "list", limit: 8 } });
    const html = reportBuilder.renderBlock(block, {
      items: [
        { Id: "m1", Name: "Arrival", Type: "Movie", Library: "Movies", countdownDays: 3, source: "cleanup", ruleName: "Stale large movies" },
        { Id: "m2", Name: "Dune", Type: "Movie", countdownDays: 1, source: "maintainerr", ruleName: "4K harvest" },
        { Id: "m3", Name: "Leave today", Type: "Movie", countdownDays: 0, source: "cleanup" },
      ],
      maintainerrConfigured: true,
    }, ctx());
    assert.match(html, /Leaving soon/);
    assert.match(html, /Arrival/);
    assert.match(html, /Leaves in 3 days/);
    assert.match(html, /Leaves tomorrow/);
    assert.match(html, /Leaves today/);
    assert.match(html, /Maintainerr/);
    assert.match(html, /libraries\/item\/m1/);
    const empty = reportBuilder.renderBlock(block, { items: [] }, ctx({ locale: "de-DE" }));
    assert.match(empty, /Bald nicht mehr verf\u00fcgbar|Aktuell ist nichts/);
  });
});

describe("newsletter fulfilled-requests block", () => {
  it("renders newly available Seerr requests with request deep links", () => {
    const block = reportBuilder.normalizeBlock({ type: "fulfilledRequests", options: { style: "list", limit: 8 } });
    const html = reportBuilder.renderBlock(block, {
      items: [
        { Name: "The Diplomat", Type: "tv", requestId: 41, requestedBy: "Roffo", status: "Available" },
        { Name: "Arrival", Type: "movie", requestId: 42, requestedBy: "Ada", status: "Available", Id: "jf-1" },
      ],
    }, ctx());
    assert.match(html, /Newly available requests/);
    assert.match(html, /The Diplomat/);
    assert.match(html, /Arrival/);
    assert.match(html, /requests\?request=41/);
    assert.match(html, /Available/);
    const empty = reportBuilder.renderBlock(block, { items: [] }, ctx({ locale: "de-DE" }));
    assert.match(empty, /Keine|keine|verfügbar|letzten Versand/i);
  });
});

describe("newsletter server-news block", () => {
  it("renders admin copy, optional dates, a kind label, and a status-page link when enabled", () => {
    const block = reportBuilder.normalizeBlock({
      type: "serverNews",
      options: { kind: "maintenance", text: "The library will be offline on Sunday.", startAt: "2026-11-15", endAt: "2026-11-16" },
    });
    const html = reportBuilder.renderBlock(block, {
      kind: "maintenance",
      text: "The library will be offline on Sunday.",
      startAt: "2026-11-15",
      endAt: "2026-11-16",
      visible: true,
      statusEnabled: true,
    }, ctx());
    assert.match(html, /Server news/);
    assert.match(html, /Maintenance/);
    assert.match(html, /The library will be offline on Sunday/);
    assert.match(html, /\/status/);
    assert.match(html, /Check the public status page/);
    const empty = reportBuilder.renderBlock(block, { visible: true, text: "", statusEnabled: false }, ctx({ locale: "de-DE" }));
    assert.match(empty, /Keine Neuigkeiten|nichts/i);
  });
});

describe("newsletter coming-soon block", () => {
  it("renders upcoming titles with a date, source, and request links", () => {
    const block = reportBuilder.normalizeBlock({ type: "comingSoon", options: { style: "list", limit: 8, comingDays: 7 } });
    const html = reportBuilder.renderBlock(block, {
      days: 7,
      today: "2026-11-12",
      items: [
        { Name: "Arrival", Type: "Movie", date: "2026-11-12", kind: "Release", source: "Radarr", requestId: 9 },
        { Name: "The Crown", Type: "Series", date: "2026-11-13", kind: "Episode", label: "S06E03", source: "Sonarr" },
      ],
    }, ctx());
    assert.match(html, /Coming soon/);
    assert.match(html, /Arrival/);
    assert.match(html, /Today/);
    assert.match(html, /Tomorrow/);
    assert.match(html, /Radarr/);
    assert.match(html, /requests\?request=9/);
    const empty = reportBuilder.renderBlock(block, { days: 7, items: [] }, ctx({ locale: "de-DE" }));
    assert.match(empty, /Nichts|nächsten|Tage/i);
  });
});

describe("newsletter extra blocks", () => {
  it("renders a featured hero with a backdrop and a watch CTA", () => {
    const block = reportBuilder.normalizeBlock({ type: "heroFeatured", options: { ctaLabel: "Watch now" } });
    const html = reportBuilder.renderBlock(block, {
      item: { Id: "m1", Name: "Arrival", Type: "Movie", ProductionYear: 2016, HasBackdrop: true, CommunityRating: 8.1, Genres: ["Drama", "Sci-Fi"] },
    }, ctx());
    assert.match(html, /Featured/);
    assert.match(html, /Arrival/);
    assert.match(html, /Images\/Backdrop/);
    assert.match(html, /Watch now/);
    assert.match(html, /libraries\/item\/m1/);
  });

  it("hides storage stats from non-admin recipients and shows them to admins", async () => {
    const report = { enabled: true, blocks: [{ type: "serverStats", enabled: true, title: "", options: {} }] };
    const hidden = await reportBuilder.renderReport(report, { campaignName: "Digest", isAdmin: false, publicBase: "http://example.com", locale: "en-GB" });
    assert.doesNotMatch(hidden.html, /Storage and server stats/);
    const shown = reportBuilder.renderBlock(reportBuilder.normalizeBlock({ type: "serverStats" }), {
      totalLabel: "12 TB", libraries: 6, items: 100, upcomingEstimate: "20 GB", upcomingCount: 4, librarySizes: [{ name: "Movies", size: "8 TB", items: 80 }],
    }, ctx());
    assert.match(shown, /12 TB/);
    assert.match(shown, /Visible to admins only/);
  });

  it("renders layout blocks, a countdown and an invite button", () => {
    const quote = reportBuilder.renderBlock(reportBuilder.normalizeBlock({ type: "quote", options: { quote: "Ask if you cannot find it.", attribution: "NT" } }), {}, ctx());
    assert.match(quote, /Ask if you cannot find it/);
    assert.match(quote, /NT/);
    const button = reportBuilder.renderBlock(reportBuilder.normalizeBlock({ type: "buttonCta", options: { buttonLabel: "Open requests", buttonHref: "http://example.com/requests" } }), {}, ctx());
    assert.match(button, /Open requests/);
    assert.match(button, /href="http:\/\/example.com\/requests"/);
    const bad = reportBuilder.renderBlock(reportBuilder.normalizeBlock({ type: "image", options: { imageUrl: "javascript:alert(1)" } }), {}, ctx());
    assert.match(bad, /Add an image URL/);
    assert.doesNotMatch(bad, /javascript:/);
    const count = reportBuilder.renderBlock(reportBuilder.normalizeBlock({ type: "countdown", options: { countdownAt: "2026-11-16", countdownLabel: "Premiere" } }), { hasDate: true, days: 4 }, ctx());
    assert.match(count, /Premiere/);
    assert.match(count, /4 days to go/);
    const invite = reportBuilder.renderBlock(reportBuilder.normalizeBlock({ type: "inviteFriend" }), { url: "https://invite.example" }, ctx());
    assert.match(invite, /Invite a friend/);
    assert.match(invite, /https:\/\/invite.example/);
    const columns = reportBuilder.renderBlock(reportBuilder.normalizeBlock({ type: "twoColumn", options: { leftTitle: "Left", leftText: "A", rightTitle: "Right", rightText: "B" } }), {}, ctx());
    assert.match(columns, /Left/);
    assert.match(columns, /Right/);
    const divider = reportBuilder.renderBlock(reportBuilder.normalizeBlock({ type: "divider", options: { dividerStyle: "spacer", space: 40 } }), {}, ctx());
    assert.match(divider, /height:40px/);
  });

  it("is a per-user block for new episodes and translates empty copy", () => {
    assert.ok(reportBuilder.PER_USER_BLOCKS.has("newEpisodes"));
    assert.ok(reportBuilder.ADMIN_ONLY_BLOCKS.has("serverStats"));
    const empty = reportBuilder.renderBlock(reportBuilder.normalizeBlock({ type: "newEpisodes" }), { items: [] }, ctx({ locale: "de-DE" }));
    assert.match(empty, /Neue Folgen|keine neuen Folgen/i);
  });
});

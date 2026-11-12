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

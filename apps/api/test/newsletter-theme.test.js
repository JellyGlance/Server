const test = require("node:test");
const assert = require("node:assert/strict");

const theme = require("../classes/newsletter-theme");

test("normalizeBranding uses email-safe fonts and light or dark palettes", () => {
  const dark = theme.normalizeBranding({ fontId: "georgia", accent: "#ff8800" });
  assert.equal(dark.mode, "dark");
  assert.equal(dark.fontId, "georgia");
  assert.match(dark.font, /Georgia/);
  assert.equal(dark.accent, "#ff8800");
  assert.equal(dark.background, "#0b111a");

  const light = theme.normalizeBranding({ mode: "light", font: "Verdana", background: "not-a-color" });
  assert.equal(light.mode, "light");
  assert.equal(light.fontId, "verdana");
  assert.equal(light.background, theme.MODE_PALETTES.light.background);
  assert.equal(theme.normalizeBranding({ font: "Comic Sans" }).fontId, "arial");
});

test("wrapEmailDocument applies branding colours, logo, font and footer", () => {
  const html = theme.wrapEmailDocument({
    bodyHtml: "<p>Hello body</p>",
    subject: "Weekly digest",
    campaignName: "House news",
    generatedAt: "Generated today",
    logoSrc: "data:image/png;base64,aaa",
    branding: { mode: "light", accent: "#1155aa", fontId: "verdana", footer: "Sent by JellyGlance" },
  });
  assert.match(html, /background:#eef2f7/);
  assert.match(html, /#1155aa/);
  assert.match(html, /Verdana/);
  assert.match(html, /Hello body/);
  assert.match(html, /Sent by JellyGlance/);
  assert.match(html, /data:image\/png;base64,aaa/);
  assert.match(html, /Weekly digest/);
});

test("stored html_body placeholders and fallback injection are used when rendering", () => {
  const withPlaceholder = theme.applyHtmlTemplate("<html><body><h1>{{subject}}</h1>{{body}}</body></html>", {
    subject: "Hello",
    body: "<p>Inner</p>",
  });
  assert.equal(withPlaceholder, "<html><body><h1>Hello</h1><p>Inner</p></body></html>");

  const withoutPlaceholder = theme.applyHtmlTemplate("<html><body><p>Header only</p></body></html>", {
    body: "<p>Injected</p>",
  });
  assert.match(withoutPlaceholder, /Header only/);
  assert.match(withoutPlaceholder, /Injected/);
  assert.match(withoutPlaceholder, /<\/body>/);

  const wrapped = theme.wrapEmailDocument({
    bodyHtml: "<p>Live content</p>",
    subject: "Subject line",
    htmlBody: "<div style=\"background:{{background}}\">{{subject}} {{body}}</div>",
    branding: { background: "#112233" },
  });
  assert.match(wrapped, /#112233/);
  assert.match(wrapped, /Subject line/);
  assert.match(wrapped, /Live content/);
  assert.ok(!wrapped.includes("{{body}}"));
});

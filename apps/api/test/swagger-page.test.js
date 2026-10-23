const test = require("node:test");
const assert = require("node:assert/strict");
const {
  schemaDownloadHref,
  injectSchemaDownload,
  sendSwaggerJson,
} = require("../swagger-page");

test("schema download link stays on the same base path as /swagger-ui/", () => {
  assert.equal(schemaDownloadHref("/swagger-ui/"), "/swagger.json?download=1");
  assert.equal(schemaDownloadHref("/swagger-ui"), "/swagger.json?download=1");
  assert.equal(schemaDownloadHref("/glance/swagger-ui/"), "/glance/swagger.json?download=1");
  assert.equal(schemaDownloadHref("/glance/swagger-ui/index.html?x=1"), "/glance/swagger.json?download=1");
});

test("swagger-ui HTML includes a download link for the API schema", () => {
  const html = injectSchemaDownload('<div id="swagger-ui"></div>', "/glance/swagger.json?download=1");
  assert.match(html, /<a href="\/glance\/swagger\.json\?download=1"[^>]*>Download API schema<\/a>/);
  assert.match(html, /download="jellyglance-api\.json"/);
  assert.equal(html.includes('<div id="swagger-ui"></div>'), true);
});

test("download=1 sends the schema as a file", () => {
  const headers = {};
  const res = {
    set(name, value) {
      headers[name] = value;
      return this;
    },
    json(body) {
      this.body = body;
    },
  };
  sendSwaggerJson({ swagger: "2.0", info: { title: "JellyGlance API" } }, { query: { download: "1" } }, res);
  assert.equal(headers["Cache-Control"], "no-store");
  assert.equal(headers["Content-Disposition"], 'attachment; filename="jellyglance-api.json"');
  assert.equal(res.body.info.title, "JellyGlance API");
});

test("opening the schema without download stays inline", () => {
  const headers = {};
  const res = {
    set(name, value) {
      headers[name] = value;
      return this;
    },
    json(body) {
      this.body = body;
    },
  };
  sendSwaggerJson({ swagger: "2.0" }, { query: {} }, res);
  assert.equal(headers["Content-Disposition"], undefined);
  assert.equal(res.body.swagger, "2.0");
});

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const publicUrl = require("../classes/newsletter-public-url");

describe("newsletter public URL helpers", () => {
  it("prefers JS_PUBLIC_URL, then settings, then the request host", () => {
    const previous = process.env.JS_PUBLIC_URL;
    delete process.env.JS_PUBLIC_URL;
    delete process.env.JS_EXTERNAL_URL;
    try {
      assert.equal(publicUrl.configuredPublicBase({ EXTERNAL_URL: "https://glance.example" }), "https://glance.example");
      process.env.JS_PUBLIC_URL = "https://mail.example/";
      assert.equal(publicUrl.resolvePublicBase({ assetBase: "http://192.168.0.200:3410", settings: { EXTERNAL_URL: "https://glance.example" } }), "https://mail.example");
    } finally {
      if (previous == null) delete process.env.JS_PUBLIC_URL;
      else process.env.JS_PUBLIC_URL = previous;
    }
    delete process.env.JS_PUBLIC_URL;
    assert.equal(
      publicUrl.resolvePublicBase({ assetBase: "http://192.168.0.200:3410", settings: {} }),
      "http://192.168.0.200:3410"
    );
    assert.equal(publicUrl.resolvePublicBase({}), "");
  });

  it("builds email-safe poster and deep-link URLs, and stays empty without a base", () => {
    const base = "https://jellyglance.example";
    assert.equal(publicUrl.itemHref(base, "abc 1"), "https://jellyglance.example/libraries/item/abc%201");
    assert.equal(publicUrl.requestsHref(base, "42"), "https://jellyglance.example/requests?request=42");
    assert.equal(publicUrl.requestsHref(base), "https://jellyglance.example/requests");
    assert.equal(
      publicUrl.posterSrc(base, "item-9", { width: 200, quality: 80 }),
      "https://jellyglance.example/proxy/Items/Images/Primary/?id=item-9&fillWidth=200&quality=80"
    );
    assert.equal(publicUrl.posterSrc("", "item-9"), "");
    assert.equal(publicUrl.itemHref("", "item-9"), "");
    assert.equal(publicUrl.statusPageHref(base), "https://jellyglance.example/status");
  });
});

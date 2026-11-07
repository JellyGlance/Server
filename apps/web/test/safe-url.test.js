import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { toSafeHttpUrl } from "../src/lib/safe-url.js";

describe("toSafeHttpUrl", () => {
  it("allows http and https URLs", () => {
    assert.equal(toSafeHttpUrl("https://jellyfin.example/web/#/details?id=1"), "https://jellyfin.example/web/#/details?id=1");
    assert.equal(toSafeHttpUrl("http://192.168.0.10:8096/web/index.html#!/details?id=1"), "http://192.168.0.10:8096/web/index.html#!/details?id=1");
  });

  it("allows same-origin relative paths", () => {
    assert.equal(
      toSafeHttpUrl("/proxy/Users/Images/Primary/?id=abc&tag=def&fillWidth=160"),
      "/proxy/Users/Images/Primary/?id=abc&tag=def&fillWidth=160"
    );
  });

  it("drops javascript and other dangerous schemes", () => {
    assert.equal(toSafeHttpUrl("javascript:alert(1)"), "");
    assert.equal(toSafeHttpUrl("JAVASCRIPT:alert(1)"), "");
    assert.equal(toSafeHttpUrl("data:text/html,<script>alert(1)</script>"), "");
    assert.equal(toSafeHttpUrl("vbscript:msgbox(1)"), "");
    assert.equal(toSafeHttpUrl(""), "");
    assert.equal(toSafeHttpUrl(undefined), "");
  });

  it("allows raster image data URLs only when requested", () => {
    const png = "data:image/png;base64,iVBORw0KGgo=";
    assert.equal(toSafeHttpUrl(png), "");
    assert.equal(toSafeHttpUrl(png, { allowDataImage: true }), png);
    assert.equal(toSafeHttpUrl("data:image/svg+xml;base64,PHN2Zy4=", { allowDataImage: true }), "");
  });
});

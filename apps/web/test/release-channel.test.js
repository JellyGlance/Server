import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { findReleaseNotes, formatDisplayVersion, getReleaseChannel, isBetaVersion } from "../src/lib/release-channel.js";

const NOTES = {
  "1.4.2-beta": [{ title: "Beta notes" }],
  "1.4.0": [{ title: "Stable notes" }],
};

describe("release channel", () => {
  test("detects beta for stamped image versions", () => {
    for (const version of ["1.4.2-beta", "1.4.2-beta.2", "v1.4.2-beta.2", "1.4.2.beta.1"]) {
      assert.equal(getReleaseChannel(version), "beta", version);
      assert.equal(isBetaVersion(version), true, version);
    }
  });

  test("stable versions stay stable", () => {
    assert.equal(getReleaseChannel("1.4.0"), "stable");
    assert.equal(getReleaseChannel("v1.4.0"), "stable");
    assert.equal(getReleaseChannel(""), "stable");
  });

  test("display keeps the beta suffix", () => {
    assert.equal(formatDisplayVersion("1.4.2-beta.2"), "v1.4.2-beta.2");
    assert.equal(formatDisplayVersion("v1.4.0"), "v1.4.0");
  });

  test("beta builds resolve the beta What's New entry", () => {
    assert.equal(findReleaseNotes(NOTES, "1.4.2-beta.2")[0].title, "Beta notes");
    assert.equal(findReleaseNotes(NOTES, "v1.4.2-beta.1")[0].title, "Beta notes");
    assert.equal(findReleaseNotes(NOTES, "1.4.2-beta")[0].title, "Beta notes");
    assert.equal(findReleaseNotes(NOTES, "1.4.0")[0].title, "Stable notes");
    assert.equal(findReleaseNotes(NOTES, "9.9.9"), null);
  });
});

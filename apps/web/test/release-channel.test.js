import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { findReleaseNotes, formatDisplayVersion, getReleaseChannel, getVersionLine, isBetaVersion, isVersionLine } from "../src/lib/release-channel.js";

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

  test("version line strips beta stamps the same way What's New does", () => {
    assert.equal(getVersionLine("1.4.2-beta.4"), "1.4.2");
    assert.equal(getVersionLine("v1.4.2-beta"), "1.4.2");
    assert.equal(getVersionLine("1.4.2"), "1.4.2");
    assert.equal(getVersionLine(""), "");
  });

  test("1.4.2 line matches stamped betas but not later versions", () => {
    for (const version of ["1.4.2", "1.4.2-beta", "1.4.2-beta.2", "v1.4.2-beta.4", "1.4.2.beta.1"]) {
      assert.equal(isVersionLine(version, "1.4.2"), true, version);
    }
    for (const version of ["1.4.3", "1.5.0", "1.4.1", "1.4.3-beta", "2.0.0", ""]) {
      assert.equal(isVersionLine(version, "1.4.2"), false, version);
    }
  });
});

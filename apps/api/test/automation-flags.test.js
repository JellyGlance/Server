const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");

// These switches are all off unless set, so a normal install is unchanged.
test("newsletter email is gated by JG_DISABLE_NOTIFICATIONS before a transport is built", () => {
  const source = read("routes/newsletter.js");
  const start = source.indexOf("function createTransport");
  const body = source.slice(start, source.indexOf("nodemailer.createTransport", start));
  assert.match(body, /process\.env\.JG_DISABLE_NOTIFICATIONS === "1"/);
});

test("Seerr folder repair only skips when a switch is set", () => {
  const source = read("routes/api.js");
  assert.match(source, /process\.env\.JG_READONLY_SEERR !== "1" && process\.env\.JG_SKIP_FOLDER_REPAIR !== "1"/);
});

test("automatic Jellyfin/Arr job runs and imports stop only when JG_DISABLE_SERVER_AUTOMATION=1", () => {
  for (const file of ["routes/server-tasks.js", "routes/external-imports.js"]) {
    assert.match(read(file), /process\.env\.NODE_ENV !== "test" && process\.env\.JG_DISABLE_SERVER_AUTOMATION !== "1"/, file);
  }
});

test("digest channel posts and automatic newsletter emails are gated by JG_DISABLE_NOTIFICATIONS", () => {
  const channels = read("classes/newsletter-channels.js");
  const automations = read("classes/newsletter-automations.js");
  const body = channels + "\n" + automations;
  assert.match(body, /process\.env\.JG_DISABLE_NOTIFICATIONS === "1"/);
  assert.match(channels, /async function postDiscordWebhook/);
  assert.match(channels, /async function postTelegramMessage/);
  assert.match(channels, /if \(notificationsDisabled\(\)\) return \{ skipped: "notifications-disabled" \}/);
  assert.match(automations, /if \(notificationsDisabled\(\)\) return \{ skipped: "notifications-disabled"/);
});

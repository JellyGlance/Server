const test = require("node:test");
const assert = require("node:assert/strict");

const audience = require("../classes/newsletter-audience");

const directory = audience.buildDirectoryUsers({
  jellyfinUsers: [
    { Id: "ada", Name: "Ada", Email: "ada@example.com", Policy: { IsAdministrator: true } },
    { Id: "bob", Name: "Bob", email: "bob@example.com" },
    { Id: "cara", Name: "Cara", Email: "cara@example.com" },
    { Id: "no-mail", Name: "No Mail" },
  ],
  localUsers: [{ id: "house-1", username: "Household", role: "Household", email: "house@example.com" }],
  userRoles: { ada: "Admin", bob: "Viewer", cara: "Manager", "no-mail": "Viewer" },
  excludedUsers: [],
});

test("directory users pick up JellyGlance roles and local groups", () => {
  const byId = Object.fromEntries(directory.map((user) => [user.id, user]));
  assert.equal(byId.ada.role, "Admin");
  assert.equal(byId.bob.role, "Viewer");
  assert.equal(byId.cara.role, "Manager");
  assert.equal(byId["house-1"].role, "Household");
  assert.equal(byId["house-1"].source, "local");
});

test("role audiences include matching users and keep explicit recipients", () => {
  const emails = audience.resolveAudienceRecipients({
    campaign: {
      type: "role",
      audience: { recipients: ["extra@example.com"], roles: ["Admin", "Household"] },
    },
    directory,
  });
  assert.deepEqual(emails.sort(), ["ada@example.com", "extra@example.com", "house@example.com"]);
});

test("personal campaigns and owner_user_id resolve to that user's email", () => {
  const personal = audience.resolveAudienceRecipients({
    campaign: { type: "personal", ownerUserId: "cara", audience: { recipients: [] } },
    directory,
  });
  assert.deepEqual(personal, ["cara@example.com"]);

  const withOwner = audience.resolveAudienceRecipients({
    campaign: { type: "global", ownerUserId: "bob", audience: { recipients: ["family@example.com"] } },
    directory,
  });
  assert.ok(withOwner.includes("bob@example.com"));
  assert.ok(withOwner.includes("family@example.com"));
});

test("opted-out users are skipped for role and owner audiences", () => {
  const emails = audience.resolveAudienceRecipients({
    campaign: { type: "role", ownerUserId: "bob", audience: { roles: ["Viewer", "Admin"] } },
    directory,
    subscriptions: [
      { user_id: "bob", opted_in: false },
      { user_id: "ada", opted_in: true, extra_recipients: ["plus@example.com"] },
    ],
  });
  assert.ok(emails.includes("ada@example.com"));
  assert.ok(emails.includes("plus@example.com"));
  assert.ok(!emails.includes("bob@example.com"));
});

test("users without an email cannot be added from a role match", () => {
  const emails = audience.resolveAudienceRecipients({
    campaign: { type: "role", audience: { roles: ["Viewer"] } },
    directory,
  });
  assert.deepEqual(emails, ["bob@example.com"]);
});

test("test sends resolve only to the signed-in admin email and ignore free-text recipients", () => {
  const email = audience.resolveSelfEmail({
    user: { id: "ada", username: "demo-admin" },
    directory,
    requestedRecipients: ["attacker@example.com", "other@example.com"],
  });
  assert.equal(email, "ada@example.com");

  const fromUser = audience.resolveSelfEmail({
    user: { email: "me@example.com" },
    directory,
    requestedRecipients: ["attacker@example.com"],
  });
  assert.equal(fromUser, "me@example.com");

  const missing = audience.resolveSelfEmail({
    user: { id: "no-mail", username: "nomail" },
    directory,
    requestedRecipients: ["attacker@example.com"],
  });
  assert.equal(missing, "");
});

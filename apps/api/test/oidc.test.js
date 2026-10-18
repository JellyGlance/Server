const test = require("node:test");
const assert = require("node:assert/strict");
const { generateKeyPairSync, randomUUID } = require("crypto");
const jwt = require("jsonwebtoken");
const oidc = require("../classes/oidc");

const ISSUER = "https://idp.example.test/application/o/jellyglance";
const CLIENT_ID = "jellyglance";

// A tiny in-memory OIDC provider: discovery, JWKS, token and userinfo endpoints.
function createProvider({ issuer = ISSUER, alg = "RS256", discoveryOverrides = {}, tokenClaims = {}, userinfo } = {}) {
  const { publicKey, privateKey } =
    alg === "ES256" ? generateKeyPairSync("ec", { namedCurve: "P-256" }) : generateKeyPairSync("rsa", { modulusLength: 2048 });
  const kid = randomUUID();
  const jwk = { ...publicKey.export({ format: "jwk" }), kid, use: "sig", alg };
  const calls = [];
  const codes = new Map();
  const discovery = {
    issuer,
    authorization_endpoint: `${issuer}/authorize`,
    token_endpoint: `${issuer}/token`,
    jwks_uri: `${issuer}/jwks`,
    userinfo_endpoint: `${issuer}/userinfo`,
    ...discoveryOverrides,
  };
  const sign = (claims, options = {}) =>
    jwt.sign({ sub: "user-123", ...claims }, options.key || privateKey, {
      algorithm: options.alg || alg,
      keyid: options.kid ?? kid,
      issuer: options.issuer ?? issuer,
      audience: options.audience ?? CLIENT_ID,
      expiresIn: options.expiresIn ?? "5m",
    });
  const http = {
    async get(url, opts = {}) {
      calls.push({ method: "GET", url, headers: opts.headers || {} });
      if (url === `${issuer}/.well-known/openid-configuration`) return discovery;
      if (url === discovery.jwks_uri) return { keys: [jwk] };
      if (url === discovery.userinfo_endpoint) return userinfo ?? { sub: "user-123", email: "alice@example.test" };
      throw Object.assign(new Error("not found"), { response: { status: 404 } });
    },
    async postForm(url, body, headers = {}) {
      calls.push({ method: "POST", url, body, headers });
      const entry = codes.get(body.code);
      if (!entry) throw Object.assign(new Error("invalid_grant"), { response: { status: 400 } });
      if (oidc.createChallenge(body.code_verifier) !== entry.challenge) {
        throw Object.assign(new Error("invalid_grant"), { response: { status: 400 } });
      }
      return { access_token: "access", id_token: sign({ nonce: entry.nonce, ...tokenClaims }) };
    },
  };
  return {
    http,
    calls,
    sign,
    discovery,
    authorize(authorizationUrl) {
      const url = new URL(authorizationUrl);
      const code = randomUUID();
      codes.set(code, { challenge: url.searchParams.get("code_challenge"), nonce: url.searchParams.get("nonce") });
      return code;
    },
  };
}

test.beforeEach(() => oidc.clearJwksCache());

test("full authorization code + PKCE flow verifies the ID token", async () => {
  const provider = createProvider({ tokenClaims: { email: "alice@example.test", email_verified: true, groups: ["jg-admins"] } });
  const discovery = await oidc.discover(ISSUER, { http: provider.http });
  const verifier = oidc.createVerifier();
  const nonce = oidc.createNonce();
  const authorizationUrl = oidc.buildAuthorizationUrl(discovery, {
    clientId: CLIENT_ID,
    redirectUri: "https://glance.example.test/auth/oidc/callback",
    scopes: "profile email groups",
    state: "state-1",
    nonce,
    verifier,
  });
  const url = new URL(authorizationUrl);
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("nonce"), nonce);
  assert.deepEqual(url.searchParams.get("scope").split(" ").sort(), ["email", "groups", "openid", "profile"]);

  const code = provider.authorize(authorizationUrl);
  const tokens = await oidc.exchangeCode(discovery, { code, redirectUri: "x", clientId: CLIENT_ID, verifier, http: provider.http });
  const claims = await oidc.verifyIdToken(tokens.id_token, { discovery, clientId: CLIENT_ID, nonce, http: provider.http });
  assert.equal(claims.sub, "user-123");
  assert.deepEqual(oidc.claimGroups(claims), ["jg-admins"]);
});

test("public clients send no secret; confidential clients use basic then post", async () => {
  const provider = createProvider();
  const discovery = await oidc.discover(ISSUER, { http: provider.http });
  const verifier = oidc.createVerifier();
  const code = provider.authorize(oidc.buildAuthorizationUrl(discovery, { clientId: CLIENT_ID, redirectUri: "x", state: "s", nonce: "n", verifier }));
  await oidc.exchangeCode(discovery, { code, redirectUri: "x", clientId: CLIENT_ID, verifier, http: provider.http });
  const publicCall = provider.calls.find((call) => call.method === "POST");
  assert.equal(publicCall.headers.Authorization, undefined);
  assert.equal(publicCall.body.client_secret, undefined);

  const rejectingHttp = {
    ...provider.http,
    async postForm(url, body, headers) {
      provider.calls.push({ method: "POST", url, body, headers });
      if (headers?.Authorization) throw Object.assign(new Error("unauthorised"), { response: { status: 401 } });
      return { ok: true };
    },
  };
  await oidc.exchangeCode(discovery, { code: "c", redirectUri: "x", clientId: CLIENT_ID, clientSecret: "s3cret", verifier, http: rejectingHttp });
  const posts = provider.calls.filter((call) => call.method === "POST").slice(-2);
  assert.match(posts[0].headers.Authorization, /^Basic /);
  assert.equal(posts[1].body.client_secret, "s3cret");
});

test("ID tokens with the wrong nonce, issuer, audience, key or algorithm are rejected", async () => {
  const provider = createProvider();
  const discovery = await oidc.discover(ISSUER, { http: provider.http });
  const verify = (token, nonce = "n1") => oidc.verifyIdToken(token, { discovery, clientId: CLIENT_ID, nonce, http: provider.http });

  await verify(provider.sign({ nonce: "n1" }));
  await assert.rejects(verify(provider.sign({ nonce: "other" })), { code: "bad_nonce" });
  await assert.rejects(verify(provider.sign({})), { code: "bad_nonce" });
  await assert.rejects(verify(provider.sign({ nonce: "n1" }, { issuer: "https://evil.test" })), { code: "bad_token" });
  await assert.rejects(verify(provider.sign({ nonce: "n1" }, { audience: "someone-else" })), { code: "bad_token" });
  await assert.rejects(verify(provider.sign({ nonce: "n1" }, { expiresIn: "-10m" })), { code: "bad_token" });
  await assert.rejects(verify(provider.sign({ nonce: "n1", azp: "other-client" }, { audience: [CLIENT_ID, "other-client"] })), { code: "bad_token" });

  const { privateKey: otherKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  await assert.rejects(verify(provider.sign({ nonce: "n1" }, { key: otherKey })), { code: "bad_token" });
  await assert.rejects(verify(provider.sign({ nonce: "n1" }, { kid: "unknown" })), { code: "unknown_key" });
  await assert.rejects(verify(jwt.sign({ sub: "x", nonce: "n1", iss: ISSUER, aud: CLIENT_ID }, "shared", { algorithm: "HS256" })), { code: "bad_alg" });
  const unsigned = `${Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url")}.${Buffer.from(JSON.stringify({ sub: "x", nonce: "n1" })).toString("base64url")}.`;
  await assert.rejects(verify(unsigned), { code: "bad_alg" });
});

test("EC keys work too", async () => {
  const provider = createProvider({ alg: "ES256" });
  const discovery = await oidc.discover(ISSUER, { http: provider.http });
  const claims = await oidc.verifyIdToken(provider.sign({ nonce: "n" }), { discovery, clientId: CLIENT_ID, nonce: "n", http: provider.http });
  assert.equal(claims.sub, "user-123");
});

test("discovery rejects a mismatched issuer and endpoints on other hosts", async () => {
  await assert.rejects(oidc.discover(ISSUER, { http: createProvider({ discoveryOverrides: { issuer: "https://other.test" } }).http }), {
    code: "issuer_mismatch",
  });
  await assert.rejects(
    oidc.discover(ISSUER, { http: createProvider({ discoveryOverrides: { token_endpoint: "http://169.254.169.254/latest" } }).http }),
    { code: "endpoint_host" }
  );
  await assert.rejects(oidc.discover(ISSUER, { http: createProvider({ discoveryOverrides: { jwks_uri: undefined } }).http }), {
    code: "bad_discovery",
  });
});

test("userinfo for a different subject is ignored", async () => {
  const provider = createProvider({ userinfo: { sub: "someone-else", email: "boss@example.test", email_verified: true } });
  const discovery = await oidc.discover(ISSUER, { http: provider.http });
  assert.deepEqual(await oidc.fetchUserInfo(discovery, "access", "user-123", { http: provider.http }), {});
});

test("the address guard blocks loopback, link-local and metadata hosts but allows the LAN", async () => {
  const lookupTo = (address) => async () => [{ address }];
  for (const address of ["127.0.0.1", "169.254.169.254", "0.0.0.0", "::1", "fe80::1", "::ffff:127.0.0.1"]) {
    await assert.rejects(oidc.assertSafeUrl("https://idp.example.test/x", { lookup: lookupTo(address) }), { code: "blocked_host" }, address);
  }
  await assert.rejects(oidc.assertSafeUrl("http://localhost:9000/"), { code: "blocked_host" });
  await assert.rejects(oidc.assertSafeUrl("http://metadata.google.internal/"), { code: "blocked_host" });
  await assert.rejects(oidc.assertSafeUrl("ftp://idp.example.test/"), { code: "invalid_url" });
  await assert.rejects(oidc.assertSafeUrl("https://user:pass@idp.example.test/"), { code: "invalid_url" });
  await oidc.assertSafeUrl("https://auth.lan/x", { lookup: lookupTo("192.168.1.20") });
  await oidc.assertSafeUrl("https://auth.example.test/x", { lookup: async () => [{ address: "10.0.0.5" }, { address: "2001:db8::5" }] });
  await assert.rejects(
    oidc.assertSafeUrl("https://rebind.example.test/x", { lookup: async () => [{ address: "10.0.0.5" }, { address: "127.0.0.1" }] }),
    { code: "blocked_host" }
  );
});

test("the default transport never follows redirects", async () => {
  let seen;
  const http = oidc.createHttp({
    lookup: async () => [{ address: "192.168.1.2" }],
    axios: { request: async (config) => ((seen = config), { data: { ok: true } }) },
  });
  await http.get("https://auth.lan/.well-known/openid-configuration");
  assert.equal(seen.maxRedirects, 0);
});

test("groups map to the highest matching role; Disabled always wins", () => {
  const mapping = oidc.parseRoleMapping("jg-users=Viewer, jg-admins=Admin\njg-family=Household");
  assert.equal(oidc.mapGroupsToRole(["jg-users", "jg-admins"], mapping), "Admin");
  assert.equal(oidc.mapGroupsToRole(["nobody"], mapping), null);
  assert.equal(oidc.mapGroupsToRole(["x"], { x: "SuperUser" }), null);
  assert.deepEqual(oidc.parseRoleMapping('{"a":"Owner"}'), { a: "Owner" });
  assert.deepEqual(oidc.claimGroups({ realm_access: { roles: ["a", "b"] } }, "realm_access.roles"), ["a", "b"]);

  assert.equal(oidc.resolveRole({ groups: ["jg-admins"], roleMapping: mapping, assignedRole: "Disabled" }), "Disabled");
  assert.equal(oidc.resolveRole({ groups: ["jg-admins"], roleMapping: mapping, assignedRole: "Viewer" }), "Admin");
  assert.equal(oidc.resolveRole({ groups: [], roleMapping: mapping, assignedRole: "Manager" }), "Manager");
  assert.equal(oidc.resolveRole({ groups: [], roleMapping: {}, isMediaAdmin: true }), "Admin");
  assert.equal(oidc.resolveRole({ groups: [], roleMapping: {}, defaultRole: "Household" }), "Household");
});

test("linking: verified email only by default, never by an unverified email or a chosen username", () => {
  const mediaUsers = [
    { id: "u-admin", name: "admin" },
    { id: "u-alice", name: "alice@example.test" },
    { id: "u-bob", name: "bob", email: "bob@example.test" },
  ];
  const resolve = (claims, extra = {}) => oidc.resolveLinkedUser({ claims, issuer: ISSUER, mediaUsers, ...extra });

  assert.equal(resolve({ sub: "1", preferred_username: "admin" }).mediaUser, null);
  assert.equal(resolve({ sub: "1", email: "alice@example.test", email_verified: false }).mediaUser, null);
  assert.equal(resolve({ sub: "1", email: "alice@example.test", email_verified: true }).mediaUser.id, "u-alice");
  assert.equal(resolve({ sub: "1", email: "BOB@example.test", email_verified: true }).mediaUser.id, "u-bob");

  assert.equal(resolve({ sub: "1", preferred_username: "admin" }, { linkPolicy: "username" }).mediaUser.id, "u-admin");
  assert.equal(resolve({ sub: "1", email: "alice@example.test", email_verified: true }, { linkPolicy: "manual" }).mediaUser, null);

  const links = { [oidc.linkKey(ISSUER, "1")]: { mediaUserId: "u-bob" } };
  assert.deepEqual(resolve({ sub: "1" }, { links, linkPolicy: "manual" }), { mediaUser: mediaUsers[2], linkedBy: "link", staleLink: false });
  // A user already linked to one identity cannot be claimed by another through email matching.
  assert.equal(resolve({ sub: "2", email: "bob@example.test", email_verified: true }, { links }).mediaUser, null);
  // The same subject from a different issuer is a different identity.
  assert.equal(oidc.resolveLinkedUser({ claims: { sub: "1" }, issuer: "https://other.test", links, mediaUsers, linkPolicy: "manual" }).mediaUser, null);
});

test("settings: env vars override the UI, secrets are decrypted, unsafe values fall back", () => {
  const options = oidc.resolveSettings(
    { issuerUrl: "https://ui.test/", clientId: "ui", clientSecret: "jgenc:v1:abc", linkPolicy: "bogus", defaultRole: "Nope", roleMapping: { a: "Admin" } },
    { OIDC_CLIENT_ID: "env-client", OIDC_SCOPES: "openid groups" },
    (value) => (value === "jgenc:v1:abc" ? "decrypted" : value)
  );
  assert.equal(options.issuerUrl, "https://ui.test");
  assert.equal(options.clientId, "env-client");
  assert.equal(options.clientSecret, "decrypted");
  assert.equal(options.scopes, "openid groups");
  assert.equal(options.linkPolicy, "verified_email");
  assert.equal(options.defaultRole, "Viewer");
  assert.equal(options.autoProvision, false);
  assert.deepEqual(options.roleMapping, { a: "Admin" });
});

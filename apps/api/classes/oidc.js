// Generic OpenID Connect client (authorization code flow with PKCE) for Authentik, Authelia,
// Keycloak and other standards-compliant providers.
//
// Security model:
// - Discovery, token, JWKS and userinfo requests never follow redirects and refuse loopback,
//   link-local, unspecified and cloud metadata addresses after DNS resolution. Private LAN
//   addresses are allowed because self-hosted providers usually live there.
// - Every endpoint must be on the issuer's own host, so a tampered discovery document cannot
//   point JellyGlance at another machine.
// - ID tokens are verified against the provider's JWKS (asymmetric algorithms only), with the
//   issuer, audience, authorized party, expiry and nonce all checked.
// - Accounts are linked by the provider's issuer + subject. A new login is only linked to an
//   existing media server user on a verified email, or by username when an admin opts in.
const { createHash, createPublicKey, randomBytes, timingSafeEqual } = require("crypto");
const dnsCallback = require("dns");
const dns = dnsCallback.promises;
const http = require("http");
const https = require("https");
const net = require("net");
const jwt = require("jsonwebtoken");

const ALLOWED_ALGORITHMS = ["RS256", "RS384", "RS512", "PS256", "PS384", "PS512", "ES256", "ES384", "ES512", "EdDSA"];
const DEFAULT_SCOPES = "openid profile email";
const DEFAULT_GROUPS_CLAIM = "groups";
const LINK_POLICIES = ["verified_email", "username", "manual"];
const ROLE_RANK = ["Disabled", "Household", "Viewer", "Manager", "Admin", "Owner"];
const JWKS_TTL_MS = 10 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 10000;
const BLOCKED_HOSTNAMES = new Set(["localhost", "metadata.google.internal", "metadata.goog", "metadata"]);

function base64Url(value) {
  return Buffer.from(value).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function createVerifier() {
  return base64Url(randomBytes(32));
}

function createChallenge(verifier) {
  return base64Url(createHash("sha256").update(verifier).digest());
}

function createNonce() {
  return base64Url(randomBytes(16));
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a ?? ""));
  const right = Buffer.from(String(b ?? ""));
  return left.length === right.length && timingSafeEqual(left, right);
}

function stripTrailingSlashes(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function ipv4ToInt(ip) {
  return ip.split(".").reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
}

function inV4Range(ip, base, bits) {
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(base) & mask);
}

function isBlockedV4(ip) {
  return (
    inV4Range(ip, "0.0.0.0", 8) ||
    inV4Range(ip, "127.0.0.0", 8) ||
    inV4Range(ip, "169.254.0.0", 16) ||
    inV4Range(ip, "224.0.0.0", 4) ||
    inV4Range(ip, "240.0.0.0", 4) ||
    ip === "100.100.100.200" // Alibaba Cloud metadata
  );
}

// Parses any IPv6 text form (compressed, dotted tail, zone id) into 16 bytes, or null.
function ipv6ToBytes(address) {
  let ip = String(address || "").toLowerCase().replace(/%.*$/, "");
  if (!net.isIPv6(ip)) return null;
  let tail = [];
  const dotted = ip.match(/:(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    tail = dotted[1].split(".").map(Number);
    ip = `${ip.slice(0, -dotted[1].length)}0:0`;
  }
  const [head, rest] = ip.includes("::") ? ip.split("::") : [ip, null];
  const left = head ? head.split(":") : [];
  const right = rest ? rest.split(":") : [];
  const groups = rest === null ? left : [...left, ...Array(8 - left.length - right.length).fill("0"), ...right];
  if (groups.length !== 8) return null;
  const bytes = [];
  for (const group of groups) {
    const value = parseInt(group || "0", 16);
    bytes.push(value >> 8, value & 0xff);
  }
  if (tail.length) bytes.splice(12, 4, ...tail);
  return bytes;
}

const startsWith = (bytes, prefix) => prefix.every((value, index) => bytes[index] === value);
const ZERO_10 = Array(10).fill(0);

// Addresses an identity provider can never legitimately live on.
function isBlockedAddress(address) {
  const ip = String(address || "").toLowerCase();
  if (net.isIPv4(ip)) return isBlockedV4(ip);
  const bytes = ipv6ToBytes(ip);
  if (!bytes) return true;
  const embeddedV4 = bytes.slice(12).join(".");
  // IPv4-mapped ::ffff:0:0/96, in any text form: judge the IPv4 address it carries.
  if (startsWith(bytes, [...ZERO_10, 0xff, 0xff])) return isBlockedV4(embeddedV4);
  // ::/96 covers ::, ::1 and the deprecated IPv4-compatible form; none is a real provider.
  if (startsWith(bytes, [...ZERO_10, 0, 0])) return true;
  // SIIT ::ffff:0:0/96 (RFC 2765) is a translation form no provider should use: block it outright.
  if (startsWith(bytes, [0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xff, 0, 0])) return true;
  // NAT64 64:ff9b::/96 reaches the embedded IPv4 address.
  if (startsWith(bytes, [0x00, 0x64, 0xff, 0x9b, 0, 0, 0, 0, 0, 0, 0, 0])) return isBlockedV4(embeddedV4);
  if (bytes[0] === 0xff) return true; // multicast ff00::/8
  if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80) return true; // link-local fe80::/10
  if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0xc0) return true; // site-local fec0::/10
  // Unique local fc00::/7 stays allowed on purpose: it is IPv6's RFC 1918, and self-hosted
  // identity providers on the LAN are supported, just like 10/8, 172.16/12 and 192.168/16.
  return startsWith(bytes, [0xfd, 0x00, 0x0e, 0xc2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x02, 0x54]); // AWS metadata
}

async function assertSafeUrl(rawUrl, { lookup = dns.lookup } = {}) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new OidcError("invalid_url", "The OIDC URL is not valid");
  }
  if (!["http:", "https:"].includes(url.protocol)) throw new OidcError("invalid_url", "OIDC URLs must use http or https");
  if (url.username || url.password) throw new OidcError("invalid_url", "OIDC URLs must not contain credentials");
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase().replace(/\.+$/, "");
  if (BLOCKED_HOSTNAMES.has(hostname) || hostname.endsWith(".localhost")) {
    throw new OidcError("blocked_host", "The OIDC provider address is not allowed");
  }
  const addresses = net.isIP(hostname) ? [{ address: hostname }] : await lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((entry) => isBlockedAddress(entry.address))) {
    throw new OidcError("blocked_host", "The OIDC provider address is not allowed");
  }
  return url;
}

class OidcError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// A dns.lookup replacement for the HTTP agents: the address actually connected to is checked
// too, so a hostname that re-resolves to a blocked address between checks is refused.
function createGuardedLookup(baseLookup = dnsCallback.lookup) {
  return function guardedLookup(hostname, options, callback) {
    if (typeof options === "function") [callback, options] = [options, {}];
    if (typeof options === "number") options = { family: options };
    const opts = options || {};
    baseLookup(hostname, { ...opts, all: true }, (error, addresses) => {
      if (error) return callback(error);
      const list = Array.isArray(addresses) ? addresses : [{ address: addresses, family: net.isIP(addresses) }];
      if (!list.length || list.some((entry) => isBlockedAddress(entry.address))) {
        return callback(new OidcError("blocked_host", "The OIDC provider address is not allowed"));
      }
      if (opts.all) return callback(null, list);
      return callback(null, list[0].address, list[0].family);
    });
  };
}

let guardedAgents;
function getGuardedAgents() {
  if (!guardedAgents) {
    const lookup = createGuardedLookup();
    const preferIpv4 = String(process.env.JS_PREFER_IPV4 || "true").toLowerCase() !== "false";
    const family = preferIpv4 ? { family: 4 } : {};
    guardedAgents = {
      httpAgent: new http.Agent({ keepAlive: true, lookup, ...family }),
      httpsAgent: new https.Agent({
        keepAlive: true,
        lookup,
        rejectUnauthorized: (process.env.REJECT_SELF_SIGNED_CERTIFICATES || "true").toLowerCase() === "true",
        ...family,
      }),
    };
  }
  return guardedAgents;
}

// Default transport: axios with redirects disabled, the address guard applied first and
// again on the address each connection actually uses.
function createHttp({ axios, lookup } = {}) {
  const client = axios || require("./axios").axios;
  async function request(method, url, { data, headers } = {}) {
    await assertSafeUrl(url, { lookup });
    const response = await client.request({
      method,
      url,
      data,
      headers,
      timeout: REQUEST_TIMEOUT_MS,
      maxRedirects: 0,
      ...getGuardedAgents(),
      // An HTTP(S)_PROXY from the environment would connect on our behalf and skip the
      // agents' address check, so OIDC requests always connect directly.
      proxy: false,
      validateStatus: (status) => status >= 200 && status < 300,
    });
    return response.data;
  }
  return {
    get: (url, options) => request("get", url, options),
    postForm: (url, body, headers = {}) =>
      request("post", url, { data: new URLSearchParams(body).toString(), headers: { ...headers, "Content-Type": "application/x-www-form-urlencoded" } }),
  };
}

function sameHost(a, b) {
  try {
    return new URL(a).host.toLowerCase() === new URL(b).host.toLowerCase();
  } catch {
    return false;
  }
}

async function discover(issuerUrl, { http = createHttp() } = {}) {
  const issuer = stripTrailingSlashes(issuerUrl);
  if (!issuer) throw new OidcError("missing_issuer", "OIDC issuer URL is required");
  const document = await http.get(`${issuer}/.well-known/openid-configuration`);
  if (!document || typeof document !== "object") throw new OidcError("bad_discovery", "The discovery document is not JSON");
  if (stripTrailingSlashes(document.issuer) !== issuer) {
    throw new OidcError("issuer_mismatch", `The provider says its issuer is ${document.issuer}, not ${issuer}`);
  }
  for (const key of ["authorization_endpoint", "token_endpoint", "jwks_uri"]) {
    if (!document[key]) throw new OidcError("bad_discovery", `The discovery document has no ${key}`);
  }
  for (const key of ["authorization_endpoint", "token_endpoint", "jwks_uri", "userinfo_endpoint", "end_session_endpoint"]) {
    if (document[key] && !sameHost(document[key], issuer)) {
      throw new OidcError("endpoint_host", `${key} is not on the issuer's host`);
    }
  }
  return {
    issuer: document.issuer,
    authorization_endpoint: document.authorization_endpoint,
    token_endpoint: document.token_endpoint,
    jwks_uri: document.jwks_uri,
    userinfo_endpoint: document.userinfo_endpoint || null,
    end_session_endpoint: document.end_session_endpoint || null,
    id_token_signing_alg_values_supported: document.id_token_signing_alg_values_supported || null,
  };
}

const jwksCache = new Map();

async function getSigningKey(jwksUri, kid, alg, { http = createHttp(), now = Date.now() } = {}) {
  const pick = (keys) =>
    keys.find((key) => (!kid || key.kid === kid) && (!key.use || key.use === "sig") && (!key.alg || key.alg === alg) && key.kty !== "oct");
  let cached = jwksCache.get(jwksUri);
  let key = cached && now - cached.at < JWKS_TTL_MS ? pick(cached.keys) : null;
  if (!key) {
    // Unknown kid: the provider may have rotated keys, so refetch once.
    const document = await http.get(jwksUri);
    const keys = Array.isArray(document?.keys) ? document.keys : [];
    jwksCache.set(jwksUri, { at: now, keys });
    key = pick(keys);
  }
  if (!key) throw new OidcError("unknown_key", "No matching signing key in the provider's JWKS");
  return createPublicKey({ key, format: "jwk" });
}

async function verifyIdToken(idToken, { discovery, clientId, nonce, http, clockTolerance = 60 }) {
  const decoded = jwt.decode(idToken, { complete: true });
  if (!decoded?.header || !decoded.payload) throw new OidcError("bad_token", "The ID token is malformed");
  const { alg, kid } = decoded.header;
  if (!ALLOWED_ALGORITHMS.includes(alg)) throw new OidcError("bad_alg", `ID token algorithm ${alg} is not allowed`);
  const publicKey = await getSigningKey(discovery.jwks_uri, kid, alg, { http });
  let claims;
  try {
    claims = jwt.verify(idToken, publicKey, {
      algorithms: [alg],
      issuer: discovery.issuer,
      audience: clientId,
      clockTolerance,
    });
  } catch (error) {
    throw new OidcError("bad_token", `ID token rejected: ${error.message}`);
  }
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (audiences.length > 1 && claims.azp !== clientId) throw new OidcError("bad_token", "ID token azp does not match the client");
  if (claims.azp && claims.azp !== clientId) throw new OidcError("bad_token", "ID token azp does not match the client");
  if (!claims.sub) throw new OidcError("bad_token", "ID token has no subject");
  if (!nonce || !safeEqual(claims.nonce, nonce)) throw new OidcError("bad_nonce", "ID token nonce does not match");
  return claims;
}

function parseRoleMapping(value) {
  if (!value) return {};
  if (typeof value === "object") return { ...value };
  const text = String(value).trim();
  if (text.startsWith("{")) {
    try {
      return JSON.parse(text);
    } catch {
      return {};
    }
  }
  // "group=Role, other-group=Role"
  return Object.fromEntries(
    text
      .split(/[,\n;]/)
      .map((pair) => pair.split("=").map((part) => part.trim()))
      .filter(([group, role]) => group && role)
  );
}

function readClaim(claims, path) {
  return String(path || "")
    .split(".")
    .reduce((value, key) => (value && typeof value === "object" ? value[key] : undefined), claims);
}

function claimGroups(claims, groupsClaim = DEFAULT_GROUPS_CLAIM) {
  const value = readClaim(claims, groupsClaim);
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string") return value.split(/[,\s]+/).filter(Boolean);
  return [];
}

// Highest-ranked role any of the user's groups maps to, or null when none match.
function mapGroupsToRole(groups, mapping, validRoles = ROLE_RANK) {
  let best = null;
  for (const group of groups) {
    const role = mapping[group];
    if (!role || !validRoles.includes(role)) continue;
    const rank = ROLE_RANK.indexOf(role);
    if (best === null || rank > ROLE_RANK.indexOf(best)) best = role;
  }
  return best;
}

// Settings saved in the UI, with environment variables taking precedence when set.
function resolveSettings(auth = {}, env = process.env, decrypt = (value) => value) {
  const pick = (envKey, value) => (env[envKey] !== undefined && env[envKey] !== "" ? env[envKey] : value);
  const linkPolicy = pick("OIDC_LINK_POLICY", auth.linkPolicy);
  const toBool = (value) => value === true || /^(1|true|yes|on)$/i.test(String(value ?? ""));
  return {
    issuerUrl: stripTrailingSlashes(pick("OIDC_ISSUER_URL", auth.issuerUrl)),
    clientId: pick("OIDC_CLIENT_ID", auth.clientId) || "",
    clientSecret: env.OIDC_CLIENT_SECRET || decrypt(auth.clientSecret || "") || "",
    redirectUri: pick("OIDC_REDIRECT_URI", auth.redirectUri) || "",
    scopes: pick("OIDC_SCOPES", auth.scopes) || DEFAULT_SCOPES,
    groupsClaim: pick("OIDC_GROUPS_CLAIM", auth.groupsClaim) || DEFAULT_GROUPS_CLAIM,
    roleMapping: parseRoleMapping(pick("OIDC_ROLE_MAPPING", auth.roleMapping)),
    linkPolicy: LINK_POLICIES.includes(linkPolicy) ? linkPolicy : "verified_email",
    autoProvision: toBool(pick("OIDC_AUTO_PROVISION", auth.autoProvision)),
    defaultRole: ROLE_RANK.includes(pick("OIDC_DEFAULT_ROLE", auth.defaultRole)) ? pick("OIDC_DEFAULT_ROLE", auth.defaultRole) : "Viewer",
    label: pick("OIDC_LABEL", auth.label) || "Single sign-on",
  };
}

function buildAuthorizationUrl(discovery, { clientId, redirectUri, scopes, state, nonce, verifier }) {
  const scopeList = new Set(String(scopes || DEFAULT_SCOPES).split(/[\s,]+/).filter(Boolean));
  scopeList.add("openid");
  const url = new URL(discovery.authorization_endpoint);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", [...scopeList].join(" "));
  url.searchParams.set("state", state);
  url.searchParams.set("nonce", nonce);
  url.searchParams.set("code_challenge", createChallenge(verifier));
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

// Exchanges the code. Confidential clients use client_secret_basic, then client_secret_post;
// public clients (no secret) rely on PKCE alone.
async function exchangeCode(discovery, { code, redirectUri, clientId, clientSecret, verifier, http = createHttp() }) {
  const body = { grant_type: "authorization_code", code, redirect_uri: redirectUri, client_id: clientId, code_verifier: verifier };
  if (!clientSecret) return http.postForm(discovery.token_endpoint, body);
  const basic = Buffer.from(`${encodeURIComponent(clientId)}:${encodeURIComponent(clientSecret)}`).toString("base64");
  try {
    return await http.postForm(discovery.token_endpoint, body, { Authorization: `Basic ${basic}` });
  } catch (error) {
    if (![400, 401].includes(error?.response?.status)) throw error;
    return http.postForm(discovery.token_endpoint, { ...body, client_secret: clientSecret });
  }
}

async function fetchUserInfo(discovery, accessToken, subject, { http = createHttp() } = {}) {
  if (!discovery.userinfo_endpoint || !accessToken) return {};
  const info = await http.get(discovery.userinfo_endpoint, { headers: { Authorization: `Bearer ${accessToken}` } });
  // OIDC Core 5.3.2: userinfo must be about the same subject, or it is ignored.
  return info && info.sub === subject ? info : {};
}

function linkKey(issuer, subject) {
  return `${stripTrailingSlashes(issuer)}#${subject}`;
}

function normalise(value) {
  return String(value || "").trim().toLowerCase();
}

// Decides which media server user (if any) an OIDC identity belongs to.
// Returns { mediaUser, linkedBy } where linkedBy is "link", "verified_email", "username" or null.
function resolveLinkedUser({ claims, issuer, links = {}, mediaUsers = [], linkPolicy = "verified_email" }) {
  const key = linkKey(issuer, claims.sub);
  const existing = links[key];
  let staleLink = null;
  if (existing) {
    if (existing.provisioned && !existing.mediaUserId) return { mediaUser: null, linkedBy: "provisioned" };
    const mediaUser = mediaUsers.find((user) => user.id === existing.mediaUserId) || null;
    if (mediaUser) return { mediaUser, linkedBy: "link", staleLink: false };
    // The linked media user is gone: match afresh, and let the caller replace the stale link.
    staleLink = existing;
  }
  const result = matchFreeUser({ claims, key, links, mediaUsers, linkPolicy });
  return staleLink ? { ...result, staleLink } : result;
}

function matchFreeUser({ claims, key, links, mediaUsers, linkPolicy }) {
  const alreadyLinked = new Set(
    Object.entries(links)
      .filter(([otherKey, link]) => otherKey !== key && link?.mediaUserId)
      .map(([, link]) => link.mediaUserId)
  );
  const free = mediaUsers.filter((user) => !alreadyLinked.has(user.id));
  if (linkPolicy === "verified_email") {
    const verified = claims.email_verified === true || claims.email_verified === "true";
    if (!verified || !claims.email) return { mediaUser: null, linkedBy: null };
    const email = normalise(claims.email);
    const match = free.filter((user) => normalise(user.email) === email || normalise(user.name) === email);
    return match.length === 1 ? { mediaUser: match[0], linkedBy: "verified_email" } : { mediaUser: null, linkedBy: null };
  }
  if (linkPolicy === "username") {
    const names = [claims.preferred_username, claims.username, claims.nickname].map(normalise).filter(Boolean);
    const match = free.filter((user) => names.includes(normalise(user.name)));
    return match.length === 1 ? { mediaUser: match[0], linkedBy: "username" } : { mediaUser: null, linkedBy: null };
  }
  return { mediaUser: null, linkedBy: null };
}

// Final role: an admin's explicit Disabled always wins, then the group mapping, then the
// role already assigned to the media server user, then the default.
function resolveRole({ groups, roleMapping, assignedRole, isMediaAdmin, defaultRole = "Viewer", validRoles = ROLE_RANK }) {
  if (assignedRole === "Disabled") return "Disabled";
  const mapped = Object.keys(roleMapping || {}).length ? mapGroupsToRole(groups, roleMapping, validRoles) : null;
  if (mapped) return mapped;
  if (assignedRole) return assignedRole;
  if (isMediaAdmin) return "Admin";
  return defaultRole;
}

class OidcLinkConflict extends OidcError {
  constructor() {
    super("link_conflict", "This sign-in conflicts with an existing account link");
  }
}

// Saves one identity link inside a transaction holding the app_config row lock, so two
// callbacks at once can't link two identities to one media user or provision twice.
// `expected` is the link the caller saw for this key (undefined when there was none).
async function saveLinkAtomically(pool, key, link, { expected } = {}) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query('SELECT settings FROM app_config WHERE "ID" = 1 FOR UPDATE');
    const settings = typeof rows[0]?.settings === "string" ? JSON.parse(rows[0].settings) : rows[0]?.settings || {};
    const links = settings.oidcLinks || {};
    const current = links[key];
    if (current && !(expected && current.mediaUserId === expected.mediaUserId && current.linkedAt === expected.linkedAt)) {
      await client.query("ROLLBACK");
      // Another callback for the same identity got there first with the same result.
      if ((link.mediaUserId || null) === (current.mediaUserId || null)) return current;
      throw new OidcLinkConflict();
    }
    if (link.mediaUserId && Object.entries(links).some(([otherKey, other]) => otherKey !== key && other?.mediaUserId === link.mediaUserId)) {
      await client.query("ROLLBACK");
      throw new OidcLinkConflict();
    }
    await client.query(
      `UPDATE app_config
          SET settings = jsonb_set(COALESCE(settings::jsonb, '{}'::jsonb), '{oidcLinks}',
                                   COALESCE(settings::jsonb -> 'oidcLinks', '{}'::jsonb) || $1::jsonb, true)::json
        WHERE "ID" = 1`,
      [JSON.stringify({ [key]: link })]
    );
    await client.query("COMMIT");
    return link;
  } catch (error) {
    if (!(error instanceof OidcLinkConflict)) await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

function clearJwksCache() {
  jwksCache.clear();
}

module.exports = {
  ALLOWED_ALGORITHMS,
  DEFAULT_SCOPES,
  LINK_POLICIES,
  OidcError,
  OidcLinkConflict,
  createGuardedLookup,
  ipv6ToBytes,
  saveLinkAtomically,
  assertSafeUrl,
  buildAuthorizationUrl,
  claimGroups,
  clearJwksCache,
  createHttp,
  createNonce,
  createVerifier,
  createChallenge,
  discover,
  exchangeCode,
  fetchUserInfo,
  isBlockedAddress,
  linkKey,
  mapGroupsToRole,
  parseRoleMapping,
  resolveLinkedUser,
  resolveRole,
  resolveSettings,
  safeEqual,
  verifyIdToken,
};

// Guards for user-supplied "probe" URLs (e.g. POST /proxy/validateSettings), where a
// signed-in user asks the server to contact an arbitrary host. Media servers on LAN
// private ranges (RFC1918, ULA) stay reachable; loopback, link-local, cloud metadata,
// unspecified and IPv4-mapped IPv6 addresses are refused after DNS resolution.
const dns = require("dns");
const net = require("net");
const http = require("http");
const https = require("https");

const METADATA_ADDRESSES = new Set(["169.254.169.254", "100.100.100.200", "fd00:ec2::254"]);

// Media server on the same host with host networking: loopback stays refused unless
// the admin opts in with JS_ALLOW_LOOPBACK_MEDIA_SERVER=true.
function loopbackAllowed() {
  return String(process.env.JS_ALLOW_LOOPBACK_MEDIA_SERVER || "").trim().toLowerCase() === "true";
}

function isBlockedIPv4(ip) {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return true;
  const [a, b] = parts;
  if (a === 0) return true; // "this" network / unspecified
  if (a === 127) return !loopbackAllowed(); // loopback, opt-in via JS_ALLOW_LOOPBACK_MEDIA_SERVER
  if (a === 169 && b === 254) return true; // link-local (incl. 169.254.169.254 metadata)
  if (a === 192 && b === 0 && parts[2] === 0) return true; // 192.0.0.0/24 IETF protocol assignments
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 benchmarking
  if (a >= 224) return true; // multicast / reserved / broadcast
  return METADATA_ADDRESSES.has(ip);
}

// Returns the embedded IPv4 address of an IPv4-mapped IPv6 address (caller has
// already matched the ::ffff: prefix), or null.
function mappedIPv4(lower) {
  const tail = lower.slice(lower.lastIndexOf("ffff:") + 5);
  if (net.isIPv4(tail)) return tail;
  const hex = tail.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (!hex) return null;
  const hi = parseInt(hex[1], 16);
  const lo = parseInt(hex[2], 16);
  return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
}

function isBlockedIPv6(ip) {
  const lower = ip.toLowerCase().split("%")[0];
  if (lower === "::") return true; // unspecified
  if (lower === "::1") return !loopbackAllowed(); // loopback
  if (/^::ffff:/i.test(lower) || /^0{0,4}(:0{0,4}){4}:ffff:/i.test(lower)) {
    // IPv4-mapped: judge the embedded IPv4 address, refuse anything we can't decode.
    const v4 = mappedIPv4(lower);
    return v4 ? isBlockedIPv4(v4) : true;
  }
  if (/^fe[89ab][0-9a-f]?:/i.test(lower)) return true; // fe80::/10 link-local
  if (/^ff/i.test(lower)) return true; // multicast
  return METADATA_ADDRESSES.has(lower);
}

function isBlockedProbeAddress(address) {
  const family = net.isIP(String(address || ""));
  if (family === 4) return isBlockedIPv4(address);
  if (family === 6) return isBlockedIPv6(address);
  return true;
}

function blockedError(host) {
  const error = new Error(`Blocked probe destination: ${host}`);
  error.code = "EPROBEBLOCKED";
  error.statusCode = 400;
  return error;
}

// dns.lookup-compatible function that refuses blocked addresses. Used by the probe
// agents so the check applies to the address actually connected to (no rebinding gap).
function probeLookup(hostname, options, callback) {
  if (typeof options === "function") {
    callback = options;
    options = {};
  }
  const opts = typeof options === "number" ? { family: options } : { ...(options || {}) };
  dns.lookup(hostname, { ...opts, all: true }, (error, addresses) => {
    if (error) return callback(error);
    const list = Array.isArray(addresses) ? addresses : [];
    if (!list.length || list.some((entry) => isBlockedProbeAddress(entry.address))) {
      return callback(blockedError(hostname));
    }
    if (opts.all) return callback(null, list);
    return callback(null, list[0].address, list[0].family);
  });
}

// Resolves a hostname (or checks an IP literal) and throws if any address is blocked.
async function resolveProbeHost(host) {
  if (net.isIP(host)) {
    if (isBlockedProbeAddress(host)) throw blockedError(host);
    return [host];
  }
  const addresses = await dns.promises.lookup(host, { all: true });
  if (!addresses.length || addresses.some((entry) => isBlockedProbeAddress(entry.address))) {
    throw blockedError(host);
  }
  return addresses.map((entry) => entry.address);
}

// Checks a URL up front. IP literals skip lookup() inside net.connect, so they are
// checked here; hostnames are resolved and every returned address must be allowed.
async function assertProbeUrlAllowed(rawUrl) {
  const parsed = new URL(String(rawUrl || ""));
  const host = parsed.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host)) {
    if (isBlockedProbeAddress(host)) throw blockedError(host);
    return;
  }
  const addresses = await dns.promises.lookup(host, { all: true });
  if (!addresses.length || addresses.some((entry) => isBlockedProbeAddress(entry.address))) {
    throw blockedError(host);
  }
}

const rejectUnauthorized = (process.env.REJECT_SELF_SIGNED_CERTIFICATES || "true").toLowerCase() === "true";
const probeHttpAgent = new http.Agent({ lookup: probeLookup });
const probeHttpsAgent = new https.Agent({ lookup: probeLookup, rejectUnauthorized });

// Axios options for probe requests: guarded agents and no redirects.
function probeRequestOptions(extra = {}) {
  return { ...extra, httpAgent: probeHttpAgent, httpsAgent: probeHttpsAgent, maxRedirects: 0 };
}

module.exports = {
  isBlockedProbeAddress,
  probeLookup,
  assertProbeUrlAllowed,
  resolveProbeHost,
  probeRequestOptions,
};

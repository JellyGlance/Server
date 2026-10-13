// Checks where an admin-supplied URL actually points before JellyGlance calls it.
//
// The hostname is resolved first and every address it resolves to is checked, so a
// friendly-looking name cannot be used to reach the cloud metadata service or the
// container itself. Private LAN ranges stay allowed when the caller opts in, because
// most media servers live on the local network.
const dns = require("dns");
const net = require("net");

function ipv4ToInt(ip) {
  return ip.split(".").reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
}

function inV4Range(ip, base, bits) {
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(base) & mask);
}

// Always refused: nothing legitimate lives here for a media server.
const ALWAYS_BLOCKED_V4 = [
  ["0.0.0.0", 8], // "this network"
  ["169.254.0.0", 16], // link-local, includes cloud metadata 169.254.169.254
  ["192.0.0.0", 24], // IETF protocol assignments
  ["198.18.0.0", 15], // benchmarking
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved + broadcast
];
const LOOPBACK_V4 = [["127.0.0.0", 8]];
// Allowed only when the caller passes allowPrivate (admin setting up a LAN server).
const PRIVATE_V4 = [
  ["10.0.0.0", 8],
  ["172.16.0.0", 12],
  ["192.168.0.0", 16],
  ["100.64.0.0", 10], // CGNAT, used by Tailscale and similar
];

function classifyIPv4(ip) {
  if (ALWAYS_BLOCKED_V4.some(([b, n]) => inV4Range(ip, b, n))) return "blocked";
  if (LOOPBACK_V4.some(([b, n]) => inV4Range(ip, b, n))) return "loopback";
  if (PRIVATE_V4.some(([b, n]) => inV4Range(ip, b, n))) return "private";
  return "public";
}

function classifyIPv6(ip) {
  const lower = ip.toLowerCase().split("%")[0];
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return classifyIPv4(mapped[1]);
  const mappedHex = lower.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mappedHex) {
    const hi = parseInt(mappedHex[1], 16);
    const lo = parseInt(mappedHex[2], 16);
    return classifyIPv4(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  }
  if (lower === "::") return "blocked";
  if (lower === "::1") return "loopback";
  const first = parseInt(lower.split(":")[0] || "0", 16);
  if ((first & 0xffc0) === 0xfe80) return "blocked"; // link-local
  if ((first & 0xff00) === 0xff00) return "blocked"; // multicast
  if ((first & 0xfe00) === 0xfc00) return "private"; // unique local
  if (lower.startsWith("fd00:ec2::254")) return "blocked"; // AWS IPv6 metadata
  return "public";
}

function classifyAddress(ip) {
  const family = net.isIP(String(ip || ""));
  if (family === 4) return classifyIPv4(ip);
  if (family === 6) return classifyIPv6(ip);
  return "blocked";
}

function loopbackAllowed() {
  return String(process.env.JS_ALLOW_LOOPBACK_MEDIA_SERVER || "").trim().toLowerCase() === "true";
}

function isAddressAllowed(ip, { allowPrivate = false } = {}) {
  const kind = classifyAddress(ip);
  if (kind === "public") return true;
  if (kind === "private") return allowPrivate;
  if (kind === "loopback") return allowPrivate && loopbackAllowed();
  return false;
}

class BlockedDestinationError extends Error {
  constructor(message) {
    super(message);
    this.name = "BlockedDestinationError";
    this.code = "EBLOCKEDDESTINATION";
  }
}

function blockedMessage(ip) {
  const kind = classifyAddress(ip);
  if (kind === "loopback") {
    return "This address points back at the JellyGlance server itself. Set JS_ALLOW_LOOPBACK_MEDIA_SERVER=true if your media server really runs there.";
  }
  if (kind === "private") return "Private network addresses are not allowed here.";
  return "This address is not allowed (link-local, metadata or reserved range).";
}

async function resolveAll(hostname) {
  const bare = String(hostname || "").replace(/^\[|\]$/g, "");
  if (net.isIP(bare)) return [bare];
  const results = await dns.promises.lookup(bare, { all: true, verbatim: true });
  return results.map((entry) => entry.address);
}

// Throws BlockedDestinationError if any address behind the URL's host is not allowed.
async function assertSafeDestination(rawUrl, options = {}) {
  const parsed = new URL(String(rawUrl || ""));
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new BlockedDestinationError("Only http and https URLs are allowed");
  }
  const addresses = await resolveAll(parsed.hostname);
  if (!addresses.length) throw new BlockedDestinationError("The hostname did not resolve to any address");
  const bad = addresses.find((ip) => !isAddressAllowed(ip, options));
  if (bad) throw new BlockedDestinationError(blockedMessage(bad));
  return addresses;
}

// A dns.lookup replacement for outbound requests: re-checks the address that is
// actually used for the connection, so DNS rebinding between the check above
// and the request cannot slip through.
function guardedLookup(options = {}) {
  return (hostname, lookupOptions, callback) => {
    const opts = typeof lookupOptions === "function" ? {} : lookupOptions || {};
    const cb = typeof lookupOptions === "function" ? lookupOptions : callback;
    dns.lookup(hostname, { ...opts, all: true }, (error, addresses) => {
      if (error) return cb(error);
      const bad = addresses.find((entry) => !isAddressAllowed(entry.address, options));
      if (bad) return cb(new BlockedDestinationError(blockedMessage(bad.address)));
      if (opts.all) return cb(null, addresses);
      return cb(null, addresses[0].address, addresses[0].family);
    });
  };
}

module.exports = {
  BlockedDestinationError,
  classifyAddress,
  isAddressAllowed,
  assertSafeDestination,
  guardedLookup,
};

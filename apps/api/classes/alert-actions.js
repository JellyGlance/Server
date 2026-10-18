// Per-rule alert actions: Discord webhook, Gotify and generic JSON webhook.
// URLs and tokens are secrets (a Discord webhook URL is its own credential), so they are
// encrypted at rest and never sent back to the browser in full.
const dns = require("dns").promises;
const net = require("net");

const ACTION_TYPES = {
  discord: { label: "Discord webhook", needsToken: false },
  gotify: { label: "Gotify", needsToken: true },
  webhook: { label: "Webhook (JSON POST)", needsToken: false },
};
const MAX_ACTIONS = 5;
const TIMEOUT_MS = 8000;
const SEVERITY_COLOUR = { info: 0x3b82f6, warning: 0xe3a008, critical: 0xc90000 };
const GOTIFY_PRIORITY = { info: 3, warning: 6, critical: 9 };
const BLOCKED_HOSTNAMES = new Set(["localhost", "metadata", "metadata.google.internal", "metadata.goog"]);

function inV4(ip, base, bits) {
  const toInt = (value) => value.split(".").reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (toInt(ip) & mask) === (toInt(base) & mask);
}

// Loopback, link-local (cloud metadata), unspecified and multicast are never valid targets.
// LAN addresses are allowed because Gotify and home webhooks usually live there.
function isBlockedAddress(address) {
  let ip = String(address || "").toLowerCase();
  if (ip.startsWith("::ffff:") && net.isIPv4(ip.slice(7))) ip = ip.slice(7);
  if (net.isIPv4(ip)) {
    return ["0.0.0.0/8", "127.0.0.0/8", "169.254.0.0/16", "224.0.0.0/4", "240.0.0.0/4"].some((range) => {
      const [base, bits] = range.split("/");
      return inV4(ip, base, Number(bits));
    }) || ip === "100.100.100.200";
  }
  if (net.isIPv6(ip)) return ip === "::" || ip === "::1" || /^fe[89ab]/.test(ip) || /^ff/.test(ip) || ip.startsWith("fd00:ec2::254");
  return true;
}

async function assertDeliverableUrl(rawUrl, { lookup = dns.lookup } = {}) {
  let url;
  try {
    url = new URL(String(rawUrl || ""));
  } catch {
    throw Object.assign(new Error("The action URL is not valid"), { code: "invalid_url" });
  }
  if (!["http:", "https:"].includes(url.protocol)) throw Object.assign(new Error("Action URLs must use http or https"), { code: "invalid_url" });
  if (url.username || url.password) throw Object.assign(new Error("Put credentials in the token field, not the URL"), { code: "invalid_url" });
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (BLOCKED_HOSTNAMES.has(hostname) || hostname.endsWith(".localhost")) {
    throw Object.assign(new Error("That address is not allowed"), { code: "blocked_host" });
  }
  const addresses = net.isIP(hostname) ? [{ address: hostname }] : await lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((entry) => isBlockedAddress(entry.address))) {
    throw Object.assign(new Error("That address is not allowed"), { code: "blocked_host" });
  }
  return url;
}

function normalizeAction(action = {}, index = 0) {
  const type = ACTION_TYPES[action.type] ? action.type : "webhook";
  return {
    id: String(action.id || `action-${Date.now().toString(36)}-${index}`).slice(0, 64),
    type,
    url: typeof action.url === "string" ? action.url.trim().slice(0, 2048) : "",
    token: typeof action.token === "string" ? action.token.trim().slice(0, 512) : "",
  };
}

function normalizeActions(actions) {
  return (Array.isArray(actions) ? actions : []).slice(0, MAX_ACTIONS).map(normalizeAction);
}

function urlHint(url, decrypt) {
  try {
    const parsed = new URL(decrypt(url));
    return `${parsed.protocol}//${parsed.host}/…`;
  } catch {
    return "";
  }
}

// What the browser sees: no URL or token, just enough to recognise the action.
function maskActions(actions, decrypt = (value) => value) {
  return normalizeActions(actions).map((action) => ({
    id: action.id,
    type: action.type,
    url: "",
    token: "",
    urlHint: action.url ? urlHint(action.url, decrypt) : "",
    hasUrl: Boolean(action.url),
    hasToken: Boolean(action.token),
  }));
}

// Blank URL/token fields mean "keep what is saved for this action id". New values are encrypted.
function mergeActionSecrets(nextActions, savedActions, encrypt = (value) => value) {
  const saved = new Map(normalizeActions(savedActions).map((action) => [action.id, action]));
  return normalizeActions(nextActions).map((action) => {
    const previous = saved.get(action.id);
    return {
      ...action,
      url: action.url ? encrypt(action.url) : previous?.url || "",
      token: action.token ? encrypt(action.token) : previous?.token || "",
    };
  });
}

function buildRequest(action, alert, decrypt = (value) => value) {
  const url = decrypt(action.url);
  const token = decrypt(action.token);
  const severity = alert.severity || "warning";
  if (action.type === "discord") {
    return {
      url,
      headers: { "Content-Type": "application/json" },
      body: {
        username: "JellyGlance",
        embeds: [{ title: String(alert.title).slice(0, 256), description: String(alert.message).slice(0, 4000), color: SEVERITY_COLOUR[severity], timestamp: alert.at || new Date().toISOString() }],
      },
    };
  }
  if (action.type === "gotify") {
    const target = new URL(url);
    target.pathname = `${target.pathname.replace(/\/+$/, "")}/message`;
    return {
      url: target.toString(),
      headers: { "Content-Type": "application/json", "X-Gotify-Key": token },
      body: { title: alert.title, message: alert.message, priority: GOTIFY_PRIORITY[severity] },
    };
  }
  return {
    url,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: {
      event: "alert_rule",
      ruleId: alert.ruleId || null,
      trigger: alert.trigger || null,
      title: alert.title,
      message: alert.message,
      severity,
      at: alert.at || new Date().toISOString(),
    },
  };
}

async function sendAction(action, alert, { decrypt = (value) => value, http, lookup } = {}) {
  try {
    if (!action.url) throw new Error("No URL saved for this action");
    if (ACTION_TYPES[action.type].needsToken && !action.token) throw new Error("No token saved for this action");
    const request = buildRequest(action, alert, decrypt);
    await assertDeliverableUrl(request.url, { lookup });
    const client = http || require("./axios").axios;
    const response = await client.request({
      method: "post",
      url: request.url,
      data: request.body,
      headers: request.headers,
      timeout: TIMEOUT_MS,
      maxRedirects: 0,
    });
    return { id: action.id, type: action.type, ok: true, status: response?.status || 200 };
  } catch (error) {
    // Never echo the URL: it may contain a webhook token.
    return { id: action.id, type: action.type, ok: false, error: error.response ? `HTTP ${error.response.status}` : error.message };
  }
}

const ACTION_CATALOG = Object.entries(ACTION_TYPES).map(([id, type]) => ({ id, label: type.label, needsToken: type.needsToken }));

module.exports = {
  ACTION_CATALOG,
  MAX_ACTIONS,
  assertDeliverableUrl,
  buildRequest,
  isBlockedAddress,
  maskActions,
  mergeActionSecrets,
  normalizeActions,
  sendAction,
};

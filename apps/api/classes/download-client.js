// eslint-disable-next-line no-unused-vars -- existing code, kept unchanged
const { axios } = require("./axios");
const { getIntegrations, getIntegrationData, saveIntegrationData } = require("./integration-store");
const { joinSafeHttpUrl, safeHttpGet, safeHttpPost, stripTrailingSlashes, toSafeHttpUrl } = require("../utils/security");

function cleanUrl(url = "") {
  const trimmed = stripTrailingSlashes(url);
  if (!trimmed) return "";
  return stripTrailingSlashes(toSafeHttpUrl(trimmed));
}

function normalizeName(value = "") {
  return String(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function clientKind(client) {
  const name = normalizeName(client?.name || client?.slug || "");
  if (name.includes("qbittorrent") || name === "bittorrent") return "qbittorrent";
  if (name.includes("transmission")) return "transmission";
  if (name.includes("deluge")) return "deluge";
  if (name.includes("sabnzbd")) return "sabnzbd";
  if (name.includes("nzbget")) return "nzbget";
  if (name.includes("rtorrent")) return "rtorrent";
  return "unknown";
}

function formatBytes(bytes = 0) {
  const value = Number(bytes || 0);
  if (!value) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${(value / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function formatSpeed(bytes = 0) {
  return `${formatBytes(bytes)}/s`;
}

const stalledSince = new Map();

function speedToBytes(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const match = String(value || "").match(/([\d.]+)\s*([KMGT]?B)/i);
  if (!match) return 0;
  const mul = { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3, TB: 1024 ** 4 }[match[2].toUpperCase()] || 1;
  return Number(match[1]) * mul;
}

function withStallInfo(item = {}) {
  const state = String(item.state || "").toLowerCase();
  const progress = Number(item.progress || 0);
  const downBytes = speedToBytes(item.down);
  const peers = Number(item.peers || 0);
  const seeds = Number(item.seeds || 0);
  const error = String(item.error || "").trim();
  const paused = state.includes("paus") || state.includes("stopp");
  const queued = state.includes("queue") || state.includes("check") || state.includes("meta");
  const seeding = progress >= 100 || state.includes("seed") || state.includes("upload");
  const failed = Boolean(error) || state.includes("fail") || state.includes("error") || state.includes("missing");
  const stalledState = state.includes("stall");
  const noPeers = item.peers != null && item.seeds != null && peers + seeds === 0 && progress < 100 && !paused && !queued && !seeding;
  const noSpeed = downBytes <= 1 && progress > 0 && progress < 100 && !paused && !queued && !seeding;
  const stalled = failed || stalledState || noPeers || noSpeed;
  if (stalled) {
    if (!stalledSince.has(item.id)) stalledSince.set(item.id, Date.now());
  } else if (item.id) {
    stalledSince.delete(item.id);
  }
  const minutes = item.stalledMinutes
    || (stalled && stalledSince.has(item.id) ? Math.max(1, Math.round((Date.now() - stalledSince.get(item.id)) / 60000)) : 0);
  let stalledReason = "";
  if (failed && error) stalledReason = error;
  else if (failed) stalledReason = "Failed";
  else if (noPeers) stalledReason = "No peers";
  else if (stalled) stalledReason = minutes > 1 ? `Stalled ${minutes}m` : "Stalled";
  return {
    ...item,
    peers: item.peers == null ? null : peers,
    seeds: item.seeds == null ? null : seeds,
    stalled,
    stalledMinutes: minutes || 0,
    stalledReason,
  };
}

function sourceFromCategory(category = "") {
  const normalized = normalizeName(category);
  if (normalized.includes("sonarr") || normalized.includes("tv")) return "Sonarr";
  if (normalized.includes("radarr") || normalized.includes("movie")) return "Radarr";
  if (normalized.includes("lidarr") || normalized.includes("music")) return "Lidarr";
  return "Other";
}

function torrentHash(item) {
  if (item?.hash) return item.hash;
  const match = String(item?.id || "").match(/([a-f0-9]{40})$/i);
  return match ? match[1] : null;
}

function nzoId(item) {
  if (item?.nzoId) return item.nzoId;
  const match = String(item?.id || "").match(/(SABnzbd_nzo_[A-Za-z0-9]+)$/i);
  return match ? match[1] : null;
}

function transmissionId(item) {
  if (item?.torrentId != null) return item.torrentId;
  const match = String(item?.id || "").match(/-(\d+)$/);
  return match ? Number(match[1]) : null;
}

function nzbgetId(item) {
  if (item?.nzbId != null) return item.nzbId;
  const match = String(item?.id || "").match(/-(\d+)$/);
  return match ? Number(match[1]) : null;
}

function findClient(integrations, item) {
  const clients = integrations.clients || [];
  return (
    clients.find((client) => client.instanceId && String(item.id || "").startsWith(`${client.instanceId}-`)) ||
    clients.find((client) => client.name === item.client) ||
    clients.find((client) => normalizeName(client.name) === normalizeName(item.client))
  );
}

function basicAuth(client) {
  const username = client.values?.username;
  const password = client.values?.secret;
  if (!username && !password) return undefined;
  return { username: username || "", password: password || "" };
}

async function qbittorrentCookie(client) {
  const url = cleanUrl(client.values?.url);
  const username = client.values?.username;
  const password = client.values?.secret;
  if (!url || !username || !password) {
    throw Object.assign(new Error("Missing qBittorrent URL, username, or password"), { statusCode: 400 });
  }

  const login = await safeHttpPost(url, "/api/v2/auth/login", new URLSearchParams({ username, password }), {
    timeout: 15000,
    headers: { "Content-Type": "application/x-www-form-urlencoded", Referer: joinSafeHttpUrl(url, "/") },
    validateStatus: () => true,
  });

  if (login.status >= 400 || String(login.data).toLowerCase().includes("fails")) {
    throw Object.assign(new Error("qBittorrent login failed"), { statusCode: 502 });
  }

  return { url, cookie: login.headers["set-cookie"]?.join("; ") || "" };
}

async function qbittorrentPost(client, path, params) {
  const { url, cookie } = await qbittorrentCookie(client);
  const response = await safeHttpPost(url, path, new URLSearchParams(params), { // codeql[js/request-forgery]
    timeout: 15000,
    headers: { Cookie: cookie, "Content-Type": "application/x-www-form-urlencoded", Referer: joinSafeHttpUrl(url, "/") },
    validateStatus: () => true,
  });
  if (response.status >= 400 || String(response.data || "").toLowerCase().includes("fails.")) {
    throw Object.assign(new Error(`qBittorrent request failed (${response.status})`), { statusCode: 502 });
  }
  return response;
}

async function transmissionRpc(client, method, args = {}) {
  const url = cleanUrl(client.values?.url);
  const username = client.values?.username;
  const password = client.values?.secret;
  if (!url || !password) {
    throw Object.assign(new Error("Missing Transmission URL or password"), { statusCode: 400 });
  }

  const endpoints = [joinSafeHttpUrl(url, "/transmission/rpc"), joinSafeHttpUrl(url, "/rpc")];
  let lastError;
  for (const endpoint of endpoints) {
    try {
      let sessionId = "";
      const post = () =>
        safeHttpPost(
          endpoint,
          "",
          { method, arguments: args },
          {
            timeout: 15000,
            auth: username ? { username, password } : { username: "", password },
            headers: {
              "Content-Type": "application/json",
              ...(sessionId ? { "X-Transmission-Session-Id": sessionId } : {}),
            },
            validateStatus: () => true,
          }
        );

      let response = await post();
      if (response.status === 409) {
        sessionId = response.headers["x-transmission-session-id"] || "";
        response = await post();
      }
      if (response.status >= 400) {
        lastError = new Error(`Transmission request failed (${response.status})`);
        continue;
      }
      if (response.data?.result && response.data.result !== "success") {
        throw Object.assign(new Error(response.data.result || "Transmission RPC failed"), { statusCode: 502 });
      }
      return response.data?.arguments || {};
    } catch (error) {
      lastError = error;
    }
  }
  throw Object.assign(lastError || new Error("Transmission RPC failed"), { statusCode: 502 });
}

async function delugeRpc(client, method, params = []) {
  const url = cleanUrl(client.values?.url);
  const password = client.values?.secret;
  if (!url || !password) {
    throw Object.assign(new Error("Missing Deluge URL or password"), { statusCode: 400 });
  }

  const cookieJar = { cookie: "" };
  const call = async (rpcMethod, rpcParams) => {
    const response = await safeHttpPost(
      url,
      "/json",
      { method: rpcMethod, params: rpcParams, id: Date.now() },
      {
        timeout: 15000,
        headers: {
          "Content-Type": "application/json",
          ...(cookieJar.cookie ? { Cookie: cookieJar.cookie } : {}),
        },
        validateStatus: () => true,
      }
    );
    const setCookie = response.headers["set-cookie"]?.join("; ");
    if (setCookie) cookieJar.cookie = setCookie;
    if (response.status >= 400) {
      throw Object.assign(new Error(`Deluge request failed (${response.status})`), { statusCode: 502 });
    }
    if (response.data?.error) {
      throw Object.assign(new Error(response.data.error.message || "Deluge RPC failed"), { statusCode: 502 });
    }
    return response.data?.result;
  };

  const loggedIn = await call("auth.login", [password]);
  if (!loggedIn) {
    throw Object.assign(new Error("Deluge login failed"), { statusCode: 502 });
  }
  return call(method, params);
}

// daemon.get_version works on Deluge 1.3 and 2.x. Deluge 2 dropped daemon.info
// ("Unknown method"), so that's only tried as a fallback for very old setups.
async function delugeVersion(client) {
  try {
    return await delugeRpc(client, "daemon.get_version", []);
  } catch (error) {
    if (!/unknown method/i.test(String(error?.message || ""))) throw error;
    return delugeRpc(client, "daemon.info", []);
  }
}

async function nzbgetRpc(client, method, params = []) {
  const url = cleanUrl(client.values?.url);
  // NZBGet's default control user is "nzbget"; older setups saved only a password.
  const username = client.values?.username || "nzbget";
  const password = client.values?.secret;
  if (!url || !password) {
    throw Object.assign(new Error("Missing NZBGet URL or password"), { statusCode: 400 });
  }
  const response = await safeHttpPost(
    url,
    "/jsonrpc",
    { method, params, id: 1 },
    {
      timeout: 15000,
      auth: { username, password },
      headers: { "Content-Type": "application/json" },
      validateStatus: () => true,
    }
  );
  if (response.status >= 400) {
    const hint = response.status === 401 ? ": check the username and password" : "";
    throw Object.assign(new Error(`NZBGet request failed (${response.status})${hint}`), { statusCode: 502 });
  }
  if (response.data?.error) {
    throw Object.assign(new Error(response.data.error.message || "NZBGet RPC failed"), { statusCode: 502 });
  }
  return response.data?.result;
}

function xmlEscape(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function xmlValue(value) {
  if (typeof value === "number") return `<value><i8>${value}</i8></value>`;
  return `<value><string>${xmlEscape(value)}</string></value>`;
}

async function rtorrentXml(client, method, params = []) {
  const url = cleanUrl(client.values?.url);
  if (!url) {
    throw Object.assign(new Error("Missing rTorrent URL"), { statusCode: 400 });
  }
  const body = `<?xml version="1.0"?><methodCall><methodName>${xmlEscape(method)}</methodName><params>${params
    .map((param) => `<param>${xmlValue(param)}</param>`)
    .join("")}</params></methodCall>`;
  const endpoints = [
    { base: url, path: "/RPC2" },
    { base: url, path: "" },
  ];
  let lastError;
  for (const endpoint of endpoints) {
    try {
      const response = await safeHttpPost(endpoint.base, endpoint.path, body, {
        timeout: 15000,
        auth: basicAuth(client),
        headers: { "Content-Type": "text/xml" },
        validateStatus: () => true,
      });
      if (response.status >= 400) {
        lastError = new Error(`rTorrent request failed (${response.status})`);
        continue;
      }
      const text = String(response.data || "");
      if (text.includes("<fault>")) {
        throw Object.assign(new Error("rTorrent XML-RPC fault"), { statusCode: 502 });
      }
      return text;
    } catch (error) {
      lastError = error;
    }
  }
  throw Object.assign(lastError || new Error("rTorrent XML-RPC failed"), { statusCode: 502 });
}

function parseRtorrentMulticall(xml = "") {
  const rows = [];
  const dataBlocks = String(xml).split(/<data>/i).slice(1);
  for (const block of dataBlocks) {
    const values = [...block.matchAll(/<(string|i[48]|i4|int)>([\s\S]*?)<\/\1>/gi)].map((match) => match[2].trim());
    if (values.length >= 8) rows.push(values);
  }
  return rows;
}

function normalizeQbittorrentTorrent(client, torrent) {
  const downloaded = Number(torrent.downloaded || torrent.completed || 0);
  const size = Number(torrent.size || torrent.total_size || 0);
  const progress = Math.round(Number(torrent.progress || 0) * 100);
  return {
    id: `${client.instanceId || client.name}-${torrent.hash || torrent.name}`,
    name: torrent.name || "qBittorrent download",
    client: client.name,
    source: sourceFromCategory(torrent.category),
    state: torrent.state || "unknown",
    progress: Number.isFinite(progress) ? Math.min(Math.max(progress, 0), 100) : 0,
    size: `${formatBytes(downloaded)} / ${formatBytes(size)}`,
    down: formatSpeed(torrent.dlspeed),
    up: formatSpeed(torrent.upspeed),
    addedAt: torrent.added_on ? new Date(Number(torrent.added_on) * 1000).toISOString() : new Date().toISOString(),
    hash: torrent.hash || null,
    peers: Number(torrent.num_leechs || 0),
    seeds: Number(torrent.num_seeds || 0),
    error: torrent.state === "missingFiles" ? "Missing files" : torrent.state === "error" ? "Client error" : "",
    stalledMinutes: torrent.last_activity ? Math.max(0, Math.round((Date.now() - Number(torrent.last_activity) * 1000) / 60000)) : 0,
  };
}

function normalizeSabnzbdJob(client, slot) {
  const size = Number(slot.mbleft || 0) * 1024 * 1024;
  const total = Number(slot.mb || 0) * 1024 * 1024;
  const progress = total > 0 ? Math.round(((total - size) / total) * 100) : 0;
  const status = String(slot.status || "unknown").toLowerCase();
  return {
    id: `${client.instanceId || client.name}-${slot.nzo_id || slot.filename || slot.title}`,
    name: slot.filename || slot.alt_filename || slot.title || "SABnzbd download",
    client: client.name,
    source: "Other",
    state: status,
    progress: Math.min(Math.max(progress, 0), 100),
    size: `${formatBytes(total - size)} / ${formatBytes(total)}`,
    down: formatSpeed(slot.kbpersec ? Number(slot.kbpersec) * 1024 : 0),
    up: "0 B/s",
    addedAt: slot.time_added || new Date().toISOString(),
    nzoId: slot.nzo_id || null,
    error: slot.fail_message || slot.error || (String(slot.status || "").toLowerCase().includes("fail") ? slot.status : ""),
  };
}

function normalizeTransmissionTorrent(client, torrent) {
  const downloaded = Number(torrent.downloadedEver || 0);
  const size = Number(torrent.sizeWhenDone || torrent.totalSize || 0);
  const progress = Math.round(Number(torrent.percentDone || 0) * 100);
  const statusMap = { 0: "stopped", 1: "queued", 2: "checking", 3: "queued", 4: "downloading", 5: "queued", 6: "seeding" };
  return {
    id: `${client.instanceId || client.name}-${torrent.hashString || torrent.id}`,
    name: torrent.name || "Transmission download",
    client: client.name,
    source: sourceFromCategory((torrent.labels || []).join(" ")),
    state: statusMap[torrent.status] || "unknown",
    progress: Number.isFinite(progress) ? Math.min(Math.max(progress, 0), 100) : 0,
    size: `${formatBytes(downloaded)} / ${formatBytes(size)}`,
    down: formatSpeed(torrent.rateDownload),
    up: formatSpeed(torrent.rateUpload),
    addedAt: torrent.addedDate ? new Date(Number(torrent.addedDate) * 1000).toISOString() : new Date().toISOString(),
    hash: torrent.hashString || null,
    torrentId: torrent.id,
    peers: Number(torrent.peersSendingToUs || 0),
    seeds: Number(torrent.peersGettingFromUs || 0),
    error: torrent.errorString || "",
  };
}

function normalizeDelugeTorrent(client, hash, torrent) {
  const progress = Math.round(Number(torrent.progress || 0));
  const total = Number(torrent.total_wanted || torrent.total_size || 0);
  const done = Number(torrent.total_done || 0);
  const paused = Boolean(torrent.paused);
  return {
    id: `${client.instanceId || client.name}-${hash}`,
    name: torrent.name || "Deluge download",
    client: client.name,
    source: sourceFromCategory(torrent.label || torrent.tracker_host || ""),
    state: paused ? "paused" : String(torrent.state || "unknown").toLowerCase(),
    progress: Number.isFinite(progress) ? Math.min(Math.max(progress, 0), 100) : 0,
    size: `${formatBytes(done)} / ${formatBytes(total)}`,
    down: formatSpeed(torrent.download_payload_rate),
    up: formatSpeed(torrent.upload_payload_rate),
    addedAt: torrent.time_added ? new Date(Number(torrent.time_added) * 1000).toISOString() : new Date().toISOString(),
    hash,
    peers: Number(torrent.num_peers || 0),
    seeds: Number(torrent.num_seeds || 0),
    error: String(torrent.tracker_status || "").toLowerCase().includes("error") ? torrent.tracker_status : "",
  };
}

function normalizeNzbgetGroup(client, group) {
  const remaining = Number(group.RemainingSizeMB || 0) * 1024 * 1024;
  const total = Number(group.FileSizeMB || 0) * 1024 * 1024;
  const progress = total > 0 ? Math.round(((total - remaining) / total) * 100) : 0;
  return {
    id: `${client.instanceId || client.name}-${group.NZBID}`,
    name: group.NZBName || group.NZBNicename || "NZBGet download",
    client: client.name,
    source: sourceFromCategory(group.Category || ""),
    state: String(group.Status || "unknown").toLowerCase(),
    progress: Math.min(Math.max(progress, 0), 100),
    size: `${formatBytes(total - remaining)} / ${formatBytes(total)}`,
    down: formatSpeed(group.DownloadRate || 0),
    up: "0 B/s",
    addedAt: new Date().toISOString(),
    nzbId: group.NZBID,
    error: Number(group.Health) >= 0 && Number(group.Health) < 1000 ? `Health ${group.Health}` : String(group.Status || "").toLowerCase().includes("fail") ? group.Status : "",
  };
}

function normalizeRtorrentRow(client, values) {
  const [hash, name, done, size, down, up, state, complete, active] = values;
  const total = Number(size || 0);
  const downloaded = Number(done || 0);
  const progress = total > 0 ? Math.round((downloaded / total) * 100) : Number(complete) ? 100 : 0;
  const paused = Number(active) === 0 || Number(state) === 0;
  return {
    id: `${client.instanceId || client.name}-${hash}`,
    name: name || "rTorrent download",
    client: client.name,
    source: "Other",
    state: paused ? "paused" : progress >= 100 ? "seeding" : "downloading",
    progress: Math.min(Math.max(progress, 0), 100),
    size: `${formatBytes(downloaded)} / ${formatBytes(total)}`,
    down: formatSpeed(down),
    up: formatSpeed(up),
    addedAt: new Date().toISOString(),
    hash,
  };
}

async function fetchQbittorrentQueue(client) {
  const url = cleanUrl(client.values?.url);
  const username = client.values?.username;
  const password = client.values?.secret;
  if (!url || !username || !password) {
    return { items: [], error: "Missing qBittorrent URL, username, or password" };
  }
  try {
    const { cookie } = await qbittorrentCookie(client);
    const response = await safeHttpGet(url, "/api/v2/torrents/info", { // codeql[js/request-forgery]
      timeout: 15000,
      headers: { Cookie: cookie },
      params: { filter: "all" },
    });
    const torrents = Array.isArray(response.data) ? response.data : [];
    return { items: torrents.map((torrent) => normalizeQbittorrentTorrent(client, torrent)) };
  } catch (error) {
    return { items: [], error: error.message || "qBittorrent queue failed" };
  }
}

async function fetchSabnzbdQueue(client) {
  const url = cleanUrl(client.values?.url);
  const apiKey = client.values?.secret;
  if (!url || !apiKey) return { items: [], error: "Missing SABnzbd URL or API key" };
  try {
    const response = await safeHttpGet(url, "/api", { // codeql[js/request-forgery]
      timeout: 15000,
      params: { mode: "queue", output: "json", apikey: apiKey },
    });
    const slots = Array.isArray(response.data?.queue?.slots) ? response.data.queue.slots : [];
    return { items: slots.map((slot) => normalizeSabnzbdJob(client, slot)) };
  } catch (error) {
    return { items: [], error: error.message || "SABnzbd queue failed" };
  }
}

async function fetchTransmissionQueue(client) {
  try {
    const data = await transmissionRpc(client, "torrent-get", {
      fields: [
        "id",
        "hashString",
        "name",
        "status",
        "percentDone",
        "downloadedEver",
        "sizeWhenDone",
        "rateDownload",
        "rateUpload",
        "addedDate",
        "labels",
        "errorString",
        "peersSendingToUs",
        "peersGettingFromUs",
      ],
    });
    const torrents = Array.isArray(data.torrents) ? data.torrents : [];
    return { items: torrents.map((torrent) => normalizeTransmissionTorrent(client, torrent)) };
  } catch (error) {
    return { items: [], error: error.message || "Transmission queue failed" };
  }
}

async function fetchDelugeQueue(client) {
  try {
    const keys = [
      "name",
      "progress",
      "total_wanted",
      "total_done",
      "download_payload_rate",
      "upload_payload_rate",
      "paused",
      "state",
      "time_added",
      "label",
      "num_peers",
      "num_seeds",
      "tracker_status",
    ];
    let torrents = await delugeRpc(client, "web.update_ui", [keys, {}]);
    if (torrents?.torrents) torrents = torrents.torrents;
    if (!torrents || typeof torrents !== "object") {
      torrents = await delugeRpc(client, "core.get_torrents_status", [{}, keys]);
    }
    return {
      items: Object.entries(torrents || {}).map(([hash, torrent]) => normalizeDelugeTorrent(client, hash, torrent || {})),
    };
  } catch (error) {
    return { items: [], error: error.message || "Deluge queue failed" };
  }
}

async function fetchNzbgetQueue(client) {
  try {
    const groups = (await nzbgetRpc(client, "listgroups", [0])) || [];
    return { items: (Array.isArray(groups) ? groups : []).map((group) => normalizeNzbgetGroup(client, group)) };
  } catch (error) {
    return { items: [], error: error.message || "NZBGet queue failed" };
  }
}

async function fetchRtorrentQueue(client) {
  try {
    const xml = await rtorrentXml(client, "d.multicall2", [
      "",
      "main",
      "d.hash=",
      "d.name=",
      "d.bytes_done=",
      "d.size_bytes=",
      "d.down.rate=",
      "d.up.rate=",
      "d.state=",
      "d.complete=",
      "d.is_active=",
    ]);
    return { items: parseRtorrentMulticall(xml).map((row) => normalizeRtorrentRow(client, row)) };
  } catch (error) {
    return { items: [], error: error.message || "rTorrent queue failed" };
  }
}

async function fetchClientQueue(client) {
  const kind = clientKind(client);
  let result = { items: [], error: client.connected ? "Queue polling not implemented for this client yet" : "Needs setup" };
  if (kind === "qbittorrent") result = await fetchQbittorrentQueue(client);
  else if (kind === "sabnzbd") result = await fetchSabnzbdQueue(client);
  else if (kind === "transmission") result = await fetchTransmissionQueue(client);
  else if (kind === "deluge") result = await fetchDelugeQueue(client);
  else if (kind === "nzbget") result = await fetchNzbgetQueue(client);
  else if (kind === "rtorrent") result = await fetchRtorrentQueue(client);
  return { ...result, items: (result.items || []).map(withStallInfo) };
}

async function testDownloadClient(client) {
  const kind = clientKind(client);
  const url = cleanUrl(client.values?.url);
  const secret = client.values?.secret;
  if (!url || !secret) return { ok: false, error: "URL and password/API key are required" };

  try {
    if (kind === "qbittorrent") {
      const { cookie } = await qbittorrentCookie(client);
      const response = await safeHttpGet(url, "/api/v2/app/version", { timeout: 10000, headers: { Cookie: cookie } }); // codeql[js/request-forgery]
      return { ok: true, version: response.data, message: `Connected to ${response.data}` };
    }
    if (kind === "sabnzbd") {
      const response = await safeHttpGet(url, "/api", { // codeql[js/request-forgery]
        timeout: 10000,
        params: { mode: "version", apikey: secret, output: "json" },
      });
      const version = response.data?.version || "SABnzbd";
      return { ok: true, version, message: `Connected to ${version}` };
    }
    if (kind === "transmission") {
      const data = await transmissionRpc(client, "session-get", { fields: ["version"] });
      const version = data.version || "Transmission";
      return { ok: true, version, message: `Connected to ${version}` };
    }
    if (kind === "deluge") {
      const version = (await delugeVersion(client)) || "Deluge";
      return { ok: true, version: String(version), message: `Connected to ${version}` };
    }
    if (kind === "nzbget") {
      const version = (await nzbgetRpc(client, "version", [])) || "NZBGet";
      return { ok: true, version: String(version), message: `Connected to ${version}` };
    }
    if (kind === "rtorrent") {
      const xml = await rtorrentXml(client, "system.client_version", []);
      const version = xml.match(/<string>([^<]+)<\/string>/)?.[1] || "rTorrent";
      return { ok: true, version, message: `Connected to ${version}` };
    }
    return { ok: true, version: "saved credentials", message: "Connected to saved credentials" };
  } catch (error) {
    return { ok: false, error: error.message || "Connection test failed" };
  }
}

async function getDownloadItem(id) {
  const integrations = await getIntegrations();
  const data = await getIntegrationData();
  const item = (data.downloads?.items || []).find((row) => row.id === id);
  if (!item) {
    throw Object.assign(new Error("Download not found"), { statusCode: 404 });
  }
  const client = findClient(integrations, item);
  if (!client) {
    throw Object.assign(new Error("Download client not found"), { statusCode: 404 });
  }
  return { item, client, data };
}

async function removeStoredItem(data, id) {
  await saveIntegrationData({
    downloads: {
      ...data.downloads,
      items: (data.downloads?.items || []).filter((row) => row.id !== id),
      syncedAt: new Date().toISOString(),
    },
  });
}

async function addDownload({ instanceId, client: clientName, value }) {
  const integrations = await getIntegrations();
  const clients = integrations.clients || [];
  const client =
    clients.find((item) => item.instanceId && item.instanceId === instanceId) ||
    clients.find((item) => item.name === clientName) ||
    clients.find((item) => normalizeName(item.name) === normalizeName(clientName));

  if (!client) {
    throw Object.assign(new Error("Download client not found"), { statusCode: 404 });
  }

  const source = String(value || "").trim();
  if (!source) {
    throw Object.assign(new Error("Use a magnet link or a .torrent URL"), { statusCode: 400 });
  }

  const kind = clientKind(client);
  if (kind === "qbittorrent") {
    await qbittorrentPost(client, "/api/v2/torrents/add", { urls: source });
    return { ok: true, client: client.name };
  }
  if (kind === "sabnzbd") {
    const url = cleanUrl(client.values?.url);
    const apiKey = client.values?.secret;
    if (!url || !apiKey) {
      throw Object.assign(new Error("Missing SABnzbd URL or API key"), { statusCode: 400 });
    }
    await safeHttpGet(url, "/api", { // codeql[js/request-forgery]
      timeout: 15000,
      params: { mode: "addurl", name: source, output: "json", apikey: apiKey },
    });
    return { ok: true, client: client.name };
  }
  if (kind === "transmission") {
    await transmissionRpc(client, "torrent-add", { filename: source });
    return { ok: true, client: client.name };
  }
  if (kind === "deluge") {
    if (source.startsWith("magnet:")) {
      await delugeRpc(client, "core.add_torrent_magnet", [source, {}]);
    } else {
      await delugeRpc(client, "core.add_torrent_url", [source, {}]);
    }
    return { ok: true, client: client.name };
  }
  if (kind === "nzbget") {
    await nzbgetRpc(client, "append", ["", source, "", 0, false, false, "", 0, "SCORE"]);
    return { ok: true, client: client.name };
  }
  if (kind === "rtorrent") {
    await rtorrentXml(client, source.startsWith("magnet:") ? "load.start" : "load.start", ["", source]);
    return { ok: true, client: client.name };
  }

  throw Object.assign(new Error("Add is not supported for this client yet"), { statusCode: 400 });
}

async function deleteDownload(id, { deleteFiles = false } = {}) {
  const { item, client, data } = await getDownloadItem(id);
  const kind = clientKind(client);

  if (kind === "qbittorrent") {
    const hash = torrentHash(item);
    if (!hash) {
      await removeStoredItem(data, id);
      return { ok: true, item, localOnly: true };
    }
    await qbittorrentPost(client, "/api/v2/torrents/delete", {
      hashes: hash,
      deleteFiles: deleteFiles ? "true" : "false",
    });
  } else if (kind === "sabnzbd") {
    const idValue = nzoId(item);
    if (!idValue) {
      await removeStoredItem(data, id);
      return { ok: true, item, localOnly: true };
    }
    await safeHttpGet(cleanUrl(client.values.url), "/api", { // codeql[js/request-forgery]
      timeout: 15000,
      params: { mode: "queue", name: "delete", value: idValue, del_files: deleteFiles ? 1 : 0, apikey: client.values.secret },
    });
  } else if (kind === "transmission") {
    const ids = [transmissionId(item) || torrentHash(item)].filter(Boolean);
    if (!ids.length) {
      await removeStoredItem(data, id);
      return { ok: true, item, localOnly: true };
    }
    await transmissionRpc(client, "torrent-remove", { ids, "delete-local-data": Boolean(deleteFiles) });
  } else if (kind === "deluge") {
    const hash = torrentHash(item);
    if (!hash) {
      await removeStoredItem(data, id);
      return { ok: true, item, localOnly: true };
    }
    await delugeRpc(client, "core.remove_torrent", [hash, Boolean(deleteFiles)]);
  } else if (kind === "nzbget") {
    const idValue = nzbgetId(item);
    if (!idValue) {
      await removeStoredItem(data, id);
      return { ok: true, item, localOnly: true };
    }
    await nzbgetRpc(client, "editqueue", [deleteFiles ? "GroupFinalDelete" : "GroupDelete", 0, "", [idValue]]);
  } else if (kind === "rtorrent") {
    const hash = torrentHash(item);
    if (!hash) {
      await removeStoredItem(data, id);
      return { ok: true, item, localOnly: true };
    }
    await rtorrentXml(client, "d.erase", [hash]);
  } else {
    await removeStoredItem(data, id);
    return { ok: true, item, localOnly: true };
  }

  await removeStoredItem(data, id);
  return { ok: true, item };
}

async function setDownloadPaused(id, paused) {
  const { item, client } = await getDownloadItem(id);
  const kind = clientKind(client);

  if (kind === "qbittorrent") {
    const hash = torrentHash(item);
    if (!hash) throw Object.assign(new Error("Missing torrent hash"), { statusCode: 400 });
    const paths = paused
      ? ["/api/v2/torrents/pause", "/api/v2/torrents/stop"]
      : ["/api/v2/torrents/resume", "/api/v2/torrents/start"];
    let lastError;
    for (const path of paths) {
      try {
        await qbittorrentPost(client, path, { hashes: hash });
        return { ok: true, item, paused };
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  }

  if (kind === "sabnzbd") {
    const idValue = nzoId(item);
    if (!idValue) throw Object.assign(new Error("Missing SABnzbd job id"), { statusCode: 400 });
    await safeHttpGet(cleanUrl(client.values.url), "/api", { // codeql[js/request-forgery]
      timeout: 15000,
      params: { mode: "queue", name: paused ? "pause" : "resume", value: idValue, apikey: client.values.secret },
    });
    return { ok: true, item, paused };
  }

  if (kind === "transmission") {
    const ids = [transmissionId(item) || torrentHash(item)].filter(Boolean);
    if (!ids.length) throw Object.assign(new Error("Missing torrent id"), { statusCode: 400 });
    await transmissionRpc(client, paused ? "torrent-stop" : "torrent-start", { ids });
    return { ok: true, item, paused };
  }

  if (kind === "deluge") {
    const hash = torrentHash(item);
    if (!hash) throw Object.assign(new Error("Missing torrent hash"), { statusCode: 400 });
    await delugeRpc(client, paused ? "core.pause_torrent" : "core.resume_torrent", [[hash]]);
    return { ok: true, item, paused };
  }

  if (kind === "nzbget") {
    const idValue = nzbgetId(item);
    if (!idValue) throw Object.assign(new Error("Missing NZBGet job id"), { statusCode: 400 });
    await nzbgetRpc(client, "editqueue", [paused ? "GroupPause" : "GroupResume", 0, "", [idValue]]);
    return { ok: true, item, paused };
  }

  if (kind === "rtorrent") {
    const hash = torrentHash(item);
    if (!hash) throw Object.assign(new Error("Missing torrent hash"), { statusCode: 400 });
    await rtorrentXml(client, paused ? "d.pause" : "d.resume", [hash]);
    return { ok: true, item, paused };
  }

  throw Object.assign(new Error("Pause is not supported for this client yet"), { statusCode: 400 });
}

module.exports = {
  addDownload,
  deleteDownload,
  setDownloadPaused,
  fetchClientQueue,
  testDownloadClient,
  clientKind,
};

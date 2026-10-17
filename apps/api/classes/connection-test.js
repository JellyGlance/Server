// Live checks for the saved media server connection, shown under
// Settings > Media server > Test connection. Every check returns a status
// (pass / warn / fail / skip), a code the web UI turns into a plain-language
// message, and a few safe details. API keys are never echoed back.
const { safeHttpGet } = require("../utils/security");
const { mediaServerAuthHeaders, serverLabel } = require("./server-type");

const TIMEOUT_MS = 8000;

const CERT_ERRORS = new Set([
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "CERT_HAS_EXPIRED",
  "ERR_TLS_CERT_ALTNAME_INVALID",
]);

// Turn a network/HTTP error into a code the UI can explain.
function describeError(error) {
  const status = error?.response?.status;
  if (status === 401 || status === 403) return { code: "UNAUTHORISED", status };
  if (status === 404) return { code: "NOT_FOUND", status };
  if (status) return { code: "HTTP_ERROR", status };
  const code = String(error?.code || "");
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return { code: "DNS_FAILED" };
  if (code === "ECONNREFUSED") return { code: "REFUSED" };
  if (code === "ECONNABORTED" || code === "ETIMEDOUT" || /timeout/i.test(String(error?.message || ""))) return { code: "TIMEOUT" };
  if (CERT_ERRORS.has(code)) return { code: "TLS_CERT" };
  if (code === "EPROTO" || /wrong version number/i.test(String(error?.message || ""))) return { code: "TLS_PROTOCOL" };
  return { code: "NETWORK_ERROR" };
}

async function get(host, path, apiKey, extra = {}) {
  return safeHttpGet(host, path, {
    timeout: TIMEOUT_MS,
    headers: apiKey ? mediaServerAuthHeaders(apiKey) : {},
    ...extra,
  });
}

async function runConnectionTest({ host, apiKey, serverType = "jellyfin" }) {
  const expected = serverType === "emby" ? "emby" : "jellyfin";
  const result = {
    url: host || "",
    serverType: expected,
    serverLabel: serverLabel(expected),
    checks: [],
  };
  const add = (id, status, code, details = {}) => result.checks.push({ id, status, code, details });

  if (!host) {
    add("url", "fail", "NO_URL");
    return finish(result);
  }
  add("url", host.endsWith("/") ? "warn" : "pass", host.endsWith("/") ? "TRAILING_SLASH" : "OK");

  // 1. Reachable, and is it the server type we think it is?
  let reachable = false;
  try {
    const { data } = await get(host, "/System/Info/Public");
    reachable = true;
    const product = String(data?.ProductName || "");
    const looksLike = /jellyfin/i.test(product) ? "jellyfin" : /emby/i.test(product) || data?.Id ? "emby" : null;
    const details = { product: product || null, version: data?.Version || null, serverName: data?.ServerName || null };
    if (looksLike && looksLike !== expected) {
      add("server", "warn", "TYPE_MISMATCH", { ...details, detected: serverLabel(looksLike) });
    } else if (!data || typeof data !== "object") {
      add("server", "fail", "NOT_A_MEDIA_SERVER", details);
      reachable = false;
    } else {
      add("server", "pass", "OK", details);
    }
  } catch (error) {
    add("server", "fail", describeError(error).code, describeError(error));
  }

  if (!reachable) {
    for (const id of ["apiKey", "libraries", "image"]) add(id, "skip", "NEEDS_SERVER");
    return finish(result);
  }

  // 2. API key: listing users needs a valid key.
  let keyOk = false;
  try {
    const { data } = await get(host, "/Users", apiKey);
    const users = Array.isArray(data) ? data : [];
    keyOk = true;
    add("apiKey", "pass", "OK", { users: users.length, admins: users.filter((u) => u?.Policy?.IsAdministrator).length });
  } catch (error) {
    add("apiKey", "fail", describeError(error).code, describeError(error));
  }

  if (!keyOk) {
    for (const id of ["libraries", "image"]) add(id, "skip", "NEEDS_KEY");
    return finish(result);
  }

  // 3. Libraries.
  let libraries = [];
  try {
    const { data } = await get(host, "/Library/VirtualFolders", apiKey);
    libraries = Array.isArray(data) ? data : [];
    add("libraries", libraries.length ? "pass" : "warn", libraries.length ? "OK" : "NO_LIBRARIES", { count: libraries.length });
  } catch (error) {
    add("libraries", "fail", describeError(error).code, describeError(error));
  }

  // 4. One image, fetched the same way the artwork proxy fetches it.
  const withImage = libraries.find((library) => library?.ItemId || library?.Id);
  if (!withImage) {
    add("image", "skip", "NO_LIBRARIES");
    return finish(result);
  }
  try {
    const id = encodeURIComponent(String(withImage.ItemId || withImage.Id));
    const response = await get(host, `/Items/${id}/Images/Primary?fillWidth=64&quality=60`, apiKey, {
      responseType: "arraybuffer",
    });
    const type = String(response?.headers?.["content-type"] || "");
    if (type.startsWith("image/")) {
      add("image", "pass", "OK", { library: withImage.Name || null, contentType: type });
    } else {
      add("image", "fail", "NOT_AN_IMAGE", { library: withImage.Name || null, contentType: type || null });
    }
  } catch (error) {
    // A library without artwork answers 404; that is not a connection problem.
    const described = describeError(error);
    add("image", described.code === "NOT_FOUND" ? "warn" : "fail", described.code === "NOT_FOUND" ? "NO_ARTWORK" : described.code, {
      library: withImage.Name || null,
      ...described,
    });
  }

  return finish(result);
}

function finish(result) {
  const statuses = result.checks.map((check) => check.status);
  result.ok = !statuses.includes("fail");
  result.overall = statuses.includes("fail") ? "fail" : statuses.includes("warn") ? "warn" : "pass";
  return result;
}

// Express handler for POST /api/jellyfin/connection-test. Admins only; it reads
// the saved connection, never a URL from the request.
function createConnectionTestHandler(loadConfig) {
  return async (req, res) => {
    if (!req.permissions?.settings || !["Owner", "Admin"].includes(req.user?.role)) {
      res.status(403).json({ message: "Admin role required" });
      return;
    }
    try {
      const config = (await loadConfig()) || {};
      const result = await runConnectionTest({
        host: config.JF_HOST,
        apiKey: config.JF_API_KEY,
        serverType: config.SERVER_TYPE || (config.IS_JELLYFIN === false ? "emby" : "jellyfin"),
      });
      res.json(result);
    } catch {
      res.status(500).json({ message: "Connection test could not run" });
    }
  };
}

module.exports = { runConnectionTest, describeError, createConnectionTestHandler };

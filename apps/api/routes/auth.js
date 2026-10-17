const express = require("express");
const { mediaServerAuthHeaders, chooseServerType, withServerType, saveServerType, serverLabel } = require("../classes/server-type");
const { publicAuth } = require("../classes/client-config");
const { createHash, randomBytes, randomUUID } = require("crypto");
const db = require("../db");
const jwt = require("jsonwebtoken");
const configClass = require("../classes/config");
const packageJson = require("../package.json");
const API = require("../classes/api-loader");
const { axios } = require("../classes/axios");
const TaskManager = require("../classes/task-manager-singleton");
const triggertype = require("../logging/triggertype");

const { getRolePermissions } = require("../classes/role-permissions");
const {
  authRateLimit,
  hashPassword,
  isEmptyPassword,
  isQuickConnectSecret,
  joinSafeHttpUrl,
  safeHttpGet,
  sanitizeForLog,
  stripTrailingSlashes,
  timingSafeEqualString,
  toSafeHttpUrl,
  verifyPassword,
} = require("../utils/security");

const router = express.Router();
router.use(authRateLimit);

const JWT_SECRET = process.env.JWT_SECRET;
const JS_USER = process.env.JS_USER;
const JS_PASSWORD = process.env.JS_PASSWORD;
if (JWT_SECRET === undefined) {
  console.log("JWT Secret cannot be undefined");
  process.exit(1); // end the program with error status code
}

function signSetupToken(username) {
  return new Promise((resolve, reject) => {
    const user = { id: 1, username };
    jwt.sign({ user }, JWT_SECRET, { algorithm: "HS256", expiresIn: "1h" }, (err, token) => {
      if (err) {
        reject(err);
      } else {
        resolve(token);
      }
    });
  });
}

function signAuthToken(user) {
  return new Promise((resolve, reject) => {
    jwt.sign({ user }, JWT_SECRET, { algorithm: "HS256", expiresIn: "12h" }, (err, token) => {
      if (err) {
        reject(err);
      } else {
        resolve(token);
      }
    });
  });
}

function base64Url(value) {
  return Buffer.from(value).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function createOidcVerifier() {
  return base64Url(randomBytes(32));
}

function createOidcChallenge(verifier) {
  return base64Url(createHash("sha256").update(verifier).digest());
}

function signOidcState(payload) {
  return new Promise((resolve, reject) => {
    jwt.sign(payload, JWT_SECRET, { algorithm: "HS256", expiresIn: "10m" }, (err, token) => {
      if (err) {
        reject(err);
      } else {
        resolve(token);
      }
    });
  });
}

function verifyOidcState(state) {
  return new Promise((resolve, reject) => {
    try {
      const decoded = jwt.verify(state, JWT_SECRET, { algorithms: ["HS256"] });
      resolve(decoded);
    } catch (err) {
      reject(err);
    }
  });
}

function getJellyfinAuthHeaders(deviceId = "jellyglance-web") {
  const authHeader = `MediaBrowser Client="JellyGlance", Device="JellyGlance Web", DeviceId="${deviceId}", Version="${packageJson.version}"`;

  return {
    Authorization: authHeader,
    "X-Emby-Authorization": authHeader,
    "User-Agent": `JellyGlance/${packageJson.version}`,
  };
}

function normalizeJellyfinUrl(url) {
  return stripTrailingSlashes(url);
}

// eslint-disable-next-line no-unused-vars -- existing code, kept unchanged
function queueSetupJellyfinTasks() {
  const taskManager = new TaskManager().getInstance();
  const taskQueue = ["JellyfinSync", "PartialJellyfinSync", "JellyfinPlaybackReportingPluginSync", "RefreshDashboardStats"];
  let index = 0;

  const startNextTask = () => {
    const taskKey = taskQueue[index];
    index += 1;

    if (!taskKey) {
      return;
    }

    const task = taskManager.taskList[taskKey];
    if (!task || taskManager.isTaskRunning(task.name)) {
      startNextTask();
      return;
    }

    const added = taskManager.addTask({
      task,
      onComplete: startNextTask,
      onError: (error) => {
        console.log(`[SETUP] ${task.name} failed: ${error.message}`);
        startNextTask();
      },
      onExit: startNextTask,
    });

    if (!added) {
      startNextTask();
      return;
    }

    taskManager.startTask(task, triggertype.Automatic);
  };

  startNextTask();
}

async function getQuickConnectConfig() {
  const config = await new configClass().getConfig();

  if (config.error || config.state < 1 || !config.JF_HOST) {
    return { errorMessage: "Jellyfin must be connected before Quick Connect can be used" };
  }

  return {
    host: normalizeJellyfinUrl(config.JF_HOST),
    settings: config.settings || {},
    state: config.state,
    serverType: config.SERVER_TYPE || "jellyfin",
  };
}

async function authenticateWithQuickConnect(host, secret) {
  const headers = getJellyfinAuthHeaders();
  const payloads = [{ Secret: secret }, { secret }];
  let lastError = null;

  for (const payload of payloads) {
    try {
      return await axios.post(joinSafeHttpUrl(host, "/Users/AuthenticateWithQuickConnect"), payload, {
        headers,
        timeout: 12000,
      });
    } catch (error) {
      lastError = error;
      if (error?.response?.status !== 400) {
        throw error;
      }
    }
  }

  throw lastError;
}

function normalizeIssuerUrl(url) {
  try {
    const trimmed = stripTrailingSlashes(url);
    return trimmed ? stripTrailingSlashes(toSafeHttpUrl(trimmed)) : "";
  } catch {
    return "";
  }
}

function getRequestOrigin(req) {
  return `${req.protocol}://${req.get("host")}`;
}

function getOidcRedirectUri(req, auth) {
  return auth.redirectUri || `${getRequestOrigin(req)}/auth/oidc/callback`;
}

function getOidcDisplayName(claims) {
  return claims?.username || claims?.preferred_username || claims?.name || claims?.email || claims?.sub || "oidc-user";
}

function getOidcSubject(claims) {
  return claims?.sub || claims?.email || claims?.preferred_username;
}

function normalizeAccountName(value) {
  return value?.toString().trim().toLowerCase();
}

function getOidcJellyfinMatchCandidates(claims) {
  const candidates = [
    claims?.jellyfin_username,
    claims?.jellyfin_user,
    claims?.username,
    claims?.preferred_username,
    claims?.nickname,
    claims?.name,
    claims?.email,
    claims?.email?.split("@")[0],
  ];

  return [...new Set(candidates.map(normalizeAccountName).filter(Boolean))];
}

async function findJellyfinUserForOidcClaims(claims) {
  const candidates = getOidcJellyfinMatchCandidates(claims);
  if (!candidates.length) {
    return null;
  }

  const { rows } = await db.query('SELECT "Id", "Name", "PrimaryImageTag", "IsAdministrator" FROM jf_users');
  const syncedUser = rows.find((user) => candidates.includes(normalizeAccountName(user.Name)));
  if (syncedUser) {
    return {
      id: syncedUser.Id,
      name: syncedUser.Name,
      primaryImageTag: syncedUser.PrimaryImageTag || null,
      isAdministrator: Boolean(syncedUser.IsAdministrator),
    };
  }

  const jellyfinUsers = await API.getUsers(true);
  const liveUser = jellyfinUsers.find((user) => candidates.includes(normalizeAccountName(user.Name)));
  if (!liveUser) {
    return null;
  }

  return {
    id: liveUser.Id,
    name: liveUser.Name,
    primaryImageTag: liveUser.PrimaryImageTag || null,
    isAdministrator: Boolean(liveUser?.Policy?.IsAdministrator),
  };
}

function getOidcAppPath(auth) {
  try {
    const redirectPath = new URL(auth.redirectUri).pathname;
    const authPathIndex = redirectPath.indexOf("/auth/oidc/callback");
    if (authPathIndex > 0) {
      return redirectPath.slice(0, authPathIndex);
    }
  } catch {
    // Relative or unset redirect URIs use the app root.
  }

  return "";
}

function renderOidcCallbackPage({ token, errorMessage, appPath = "" }) {
  const safeToken = JSON.stringify(token || "");
  const safeError = JSON.stringify(errorMessage || "");
  const safeSuccessPath = JSON.stringify(`${appPath || ""}/`.replace(/\/{2,}/g, "/"));
  const safeErrorPath = JSON.stringify(`${appPath || ""}/login`.replace(/\/{2,}/g, "/"));

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>JellyGlance OIDC</title>
  </head>
  <body>
    <script>
      const token = ${safeToken};
      const errorMessage = ${safeError};
      if (token) {
        localStorage.setItem("token", token);
        localStorage.removeItem("jellyglance_logged_out");
        window.location.replace(${safeSuccessPath});
      } else {
        sessionStorage.setItem("jellyglance_oidc_error", errorMessage || "OIDC login failed");
        window.location.replace(${safeErrorPath});
      }
    </script>
  </body>
</html>`;
}

// eslint-disable-next-line no-unused-vars -- existing code, kept unchanged
function getOidcErrorMessage(error, fallback = "Unable to complete OIDC login") {
  const data = error?.response?.data;
  if (typeof data === "string" && data.trim()) {
    return data;
  }

  return data?.error_description || data?.errorMessage || data?.error || error?.message || fallback;
}

async function testOidcDiscovery(issuerUrl) {
  const normalizedIssuer = normalizeIssuerUrl(issuerUrl);
  if (!normalizedIssuer) {
    return { isValid: false, errorMessage: "OIDC issuer URL is required" };
  }

  try {
    const response = await safeHttpGet(normalizedIssuer, "/.well-known/openid-configuration", { timeout: 8000 });
    const discovery = response?.data || {};
    const hasRequiredEndpoints = discovery.authorization_endpoint && discovery.token_endpoint && discovery.issuer;

    if (!hasRequiredEndpoints) {
      return { isValid: false, errorMessage: "OIDC discovery document is missing required endpoints" };
    }

    return {
      isValid: true,
      issuerUrl: normalizedIssuer,
      discovery: {
        issuer: discovery.issuer,
        authorization_endpoint: discovery.authorization_endpoint,
        token_endpoint: discovery.token_endpoint,
        userinfo_endpoint: discovery.userinfo_endpoint,
        jwks_uri: discovery.jwks_uri,
      },
    };
  } catch (error) {
    return {
      isValid: false,
      errorMessage: `Unable to reach OIDC discovery: ${error?.response?.status || error.message}`,
    };
  }
}

router.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;

    const query = "SELECT * FROM app_config";
    const { rows: login } = await db.query(query);

    const authMode = login[0]?.settings?.auth?.mode;
    const isEmptyLogin = !username || isEmptyPassword(password);

    if (isEmptyLogin && login.length > 0 && (login[0].REQUIRE_LOGIN == true || authMode === "quick-connect")) {
      res.sendStatus(401);
      return;
    }

    const configRow = login[0] || {};
    const settings = configRow.settings || {};
    const localUsers = settings.localUsers || [];
    const localUser = localUsers.find(
      (user) => user.role !== "Disabled" && user.username === username && verifyPassword(password, user.password)
    );
    const isPrimaryLocalUser = configRow.APP_USER === username && verifyPassword(password, configRow.APP_PASSWORD);
    const isFallbackEnvUser =
      Boolean(JS_USER) && Boolean(JS_PASSWORD) && username === JS_USER && timingSafeEqualString(password, JS_PASSWORD);
    const loginUser = login.filter((user) => isPrimaryLocalUser || localUser || user.REQUIRE_LOGIN == false);

    if (loginUser.length > 0 || isFallbackEnvUser) {
      const role = isFallbackEnvUser || isPrimaryLocalUser || configRow.REQUIRE_LOGIN == false ? "Owner" : localUser.role || "Viewer";
      const user = {
        id: isFallbackEnvUser || isPrimaryLocalUser ? 1 : localUser.id,
        username: username,
        authMode: "local",
        role,
        permissions: getRolePermissions(settings, role),
      };

      jwt.sign({ user }, JWT_SECRET, (err, token) => {
        if (err) {
          console.log(err);
          res.sendStatus(500);
        } else {
          res.json({ token });
        }
      });
    } else {
      res.sendStatus(401);
    }
  } catch (error) {
    console.log(error);
  }
});

router.post("/jellyfin-quick-connect/initiate", async (req, res) => {
  try {
    const config = await getQuickConnectConfig();

    if (config.errorMessage) {
      res.status(400).json({ errorMessage: config.errorMessage });
      return;
    }

    const response = await axios.post(joinSafeHttpUrl(config.host, "/QuickConnect/Initiate"), null, {
      headers: getJellyfinAuthHeaders(),
      timeout: 12000,
    });

    const data = response?.data || {};
    if (!data.Code || !data.Secret) {
      res.status(502).json({ errorMessage: "Jellyfin did not return a Quick Connect code" });
      return;
    }

    res.json({
      code: data.Code,
      secret: data.Secret,
      quickConnectUrl: `${config.host}/web/#/quickconnect`,
      authenticated: data.Authenticated === true,
      dateAdded: data.DateAdded || null,
    });
  } catch (error) {
    const status = error?.response?.status || 500;
    const errorMessage =
      status === 401 || status === 403
        ? "Quick Connect is disabled or blocked on Jellyfin"
        : `Unable to start Jellyfin Quick Connect: ${error?.response?.status || error.message}`;

    console.log("[QUICK-CONNECT] initiate failed", error?.response?.status || error.message);
    res.status(status === 404 ? 404 : status >= 500 ? 502 : status).json({ errorMessage });
  }
});

router.post("/jellyfin-quick-connect/status", async (req, res) => {
  try {
    const secret = req.body?.secret;
    const config = await getQuickConnectConfig();

    if (!isQuickConnectSecret(secret)) {
      res.status(400).json({ errorMessage: "Quick Connect secret is required" });
      return;
    }

    if (config.errorMessage) {
      res.status(400).json({ errorMessage: config.errorMessage });
      return;
    }

    const response = await axios.get(joinSafeHttpUrl(config.host, "/QuickConnect/Connect"), {
      headers: getJellyfinAuthHeaders(),
      params: { secret },
      timeout: 12000,
    });

    const data = response?.data || {};
    res.json({
      authenticated: data.Authenticated === true,
      code: data.Code || null,
    });
  } catch (error) {
    console.log("[QUICK-CONNECT] status failed", error?.response?.status || error.message);
    res.status(error?.response?.status || 502).json({
      errorMessage: `Unable to check Jellyfin Quick Connect: ${error?.response?.status || error.message}`,
    });
  }
});

// Shared by Quick Connect and username/password sign-in: checks the media server
// account against JellyGlance roles, records first-run auth and issues a token.
async function completeMediaServerLogin(res, config, jellyfinUser, method) {
  const serverName = serverLabel(config.serverType);
  const isFirstRunApproval = config.state < 2;
  console.log(`[SETUP-AUTH] ${method} complete. firstRun=${isFirstRunApproval} user=${sanitizeForLog(jellyfinUser.Name || jellyfinUser.Id)}`);

  if (isFirstRunApproval && !jellyfinUser?.Policy?.IsAdministrator) {
    res.status(403).json({ errorMessage: `Sign in with a ${serverName} administrator account` });
    return;
  }

  const settings = config.settings || {};
  const assignedRole = settings.userRoles?.[jellyfinUser.Id] || (jellyfinUser?.Policy?.IsAdministrator ? "Admin" : "Viewer");
  const permissions = getRolePermissions(settings, assignedRole);

  if (assignedRole === "Disabled" || !permissions.dashboard) {
    res.status(403).json({ errorMessage: `This ${serverName} account is disabled in JellyGlance` });
    return;
  }

  const defaultLabel = config.serverType === "emby" ? "Emby login" : "Jellyfin Quick Connect";
  settings.auth = {
    ...(settings.auth || {}),
    mode: isFirstRunApproval ? "quick-connect" : settings.auth?.mode || "quick-connect",
    label: isFirstRunApproval ? defaultLabel : settings.auth?.label || defaultLabel,
  };

  if (isFirstRunApproval) {
    settings.firstRunExtrasPending = true;
    await db.query('UPDATE app_config SET "APP_USER"=$1, "APP_PASSWORD"=$2, "REQUIRE_LOGIN"=$3, settings=$4 where "ID"=1', [
      "jellyfin-quick-connect",
      null,
      true,
      settings,
    ]);
    console.log(`[SETUP-AUTH] ${method} saved first-run admin auth`);
  }

  const mediaUser = {
    id: jellyfinUser.Id,
    name: jellyfinUser.Name,
    primaryImageTag: jellyfinUser.PrimaryImageTag || null,
    isAdministrator: Boolean(jellyfinUser?.Policy?.IsAdministrator),
  };
  const token = await signAuthToken({
    id: jellyfinUser.Id,
    username: jellyfinUser.Name || "jellyfin-quick-connect",
    authMode: "quick-connect",
    role: assignedRole,
    permissions,
    jellyfinUser: mediaUser,
  });
  res.json({
    token,
    mode: "quick-connect",
    auth: { ...publicAuth(settings.auth), jellyfinUser: mediaUser },
    user: { id: mediaUser.id, name: mediaUser.name, primaryImageTag: mediaUser.primaryImageTag, role: assignedRole, permissions },
  });
}

router.post("/jellyfin-quick-connect/complete", async (req, res) => {
  try {
    const { secret } = req.body;
    const config = await getQuickConnectConfig();

    if (!isQuickConnectSecret(secret)) {
      res.status(400).json({ errorMessage: "Quick Connect secret is required" });
      return;
    }

    if (config.errorMessage) {
      res.status(400).json({ errorMessage: config.errorMessage });
      return;
    }

    const response = await authenticateWithQuickConnect(config.host, secret);
    const jellyfinUser = response?.data?.User;
    if (!jellyfinUser?.Id) {
      res.status(502).json({ errorMessage: "Jellyfin did not return an authenticated user" });
      return;
    }

    await completeMediaServerLogin(res, config, jellyfinUser, "Quick Connect");
  } catch (error) {
    const status = error?.response?.status || 502;
    console.log("[QUICK-CONNECT] complete failed", error?.response?.status || error.message);
    res.status(status).json({
      errorMessage: `Unable to complete Jellyfin Quick Connect: ${error?.response?.status || error.message}`,
    });
  }
});

// Username/password sign-in against the media server. Emby has no Quick Connect, so this
// is how Emby installs sign in; it also works for Jellyfin. The password goes only to the
// media server and is never stored.
router.post("/media-server-login", async (req, res) => {
  try {
    const username = typeof req.body?.username === "string" ? req.body.username.trim() : "";
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    const config = await getQuickConnectConfig();

    if (!username || username.length > 128 || password.length > 1024) {
      res.status(400).json({ errorMessage: "Username and password are required" });
      return;
    }
    if (config.errorMessage) {
      res.status(400).json({ errorMessage: config.errorMessage });
      return;
    }

    const response = await axios.post(
      joinSafeHttpUrl(config.host, "/Users/AuthenticateByName"),
      { Username: username, Pw: password },
      { headers: { ...getJellyfinAuthHeaders(), "Content-Type": "application/json" }, timeout: 12000 }
    );
    const mediaUser = response?.data?.User;
    if (!mediaUser?.Id) {
      res.status(502).json({ errorMessage: `${serverLabel(config.serverType)} did not return an authenticated user` });
      return;
    }

    await completeMediaServerLogin(res, config, mediaUser, "Password sign-in");
  } catch (error) {
    const status = error?.response?.status;
    if (status === 401 || status === 403) {
      res.status(401).json({ errorMessage: "Wrong username or password" });
      return;
    }
    console.log("[MEDIA-LOGIN] sign-in failed", status || error.message);
    res.status(502).json({ errorMessage: "Unable to reach the media server to sign in" });
  }
});

router.get("/oidc/login", async (req, res) => {
  try {
    const config = await new configClass().getConfig();
    const auth = config.settings?.auth || {};

    if (auth.mode !== "oidc") {
      res.status(400).json({ errorMessage: "OIDC login is not enabled" });
      return;
    }

    if (!auth.clientId || !auth.discovery?.authorization_endpoint || !auth.discovery?.token_endpoint) {
      res.status(400).json({ errorMessage: "OIDC settings are incomplete" });
      return;
    }

    const verifier = createOidcVerifier();
    const state = await signOidcState({
      type: "oidc",
      nonce: base64Url(randomBytes(16)),
      verifier,
      returnTo: "/",
    });
    const authorizationUrl = new URL(auth.discovery.authorization_endpoint);
    authorizationUrl.searchParams.set("client_id", auth.clientId);
    authorizationUrl.searchParams.set("redirect_uri", getOidcRedirectUri(req, auth));
    authorizationUrl.searchParams.set("response_type", "code");
    authorizationUrl.searchParams.set("scope", "openid profile email");
    authorizationUrl.searchParams.set("state", state);
    authorizationUrl.searchParams.set("code_challenge", createOidcChallenge(verifier));
    authorizationUrl.searchParams.set("code_challenge_method", "S256");

    res.redirect(authorizationUrl.toString());
  } catch (error) {
    console.log("[OIDC] login start failed", error.message);
    res.status(500).json({ errorMessage: "Unable to start OIDC login" });
  }
});

router.get("/oidc/callback", async (req, res) => {
  try {
    const code = typeof req.query.code === "string" ? req.query.code : "";
    // Always verify JWT state first (algorithms pinned in verifyOidcState). Missing/invalid
    // state fails closed via jwt.verify throw — not a user-controlled security bypass.
    let statePayload;
    try {
      statePayload = await verifyOidcState(typeof req.query.state === "string" ? req.query.state : "");
    } catch {
      res.status(400).send(renderOidcCallbackPage({ errorMessage: "OIDC callback is missing or invalid state" }));
      return;
    }
    if (!statePayload || statePayload.type !== "oidc" || typeof statePayload.verifier !== "string" || !statePayload.verifier) {
      res.status(400).send(renderOidcCallbackPage({ errorMessage: "OIDC state is invalid" }));
      return;
    }

    if (!code) {
      res.status(400).send(renderOidcCallbackPage({ errorMessage: "OIDC login was denied or incomplete" }));
      return;
    }

    const config = await new configClass().getConfig();
    const settings = config.settings || {};
    const auth = settings.auth || {};
    const appPath = getOidcAppPath(auth);
    if (auth.mode !== "oidc" || !auth.discovery?.token_endpoint) {
      res.status(400).send(renderOidcCallbackPage({ errorMessage: "OIDC login is not enabled", appPath }));
      return;
    }

    const tokenParams = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: getOidcRedirectUri(req, auth),
      client_id: auth.clientId,
      code_verifier: statePayload.verifier,
    });

    const clientSecret = auth.clientSecret && auth.clientSecret !== auth.clientId ? auth.clientSecret : null;
    const headers = { "Content-Type": "application/x-www-form-urlencoded" };
    if (clientSecret) {
      const clientCredentials = Buffer.from(`${auth.clientId}:${clientSecret}`).toString("base64");
      headers.Authorization = `Basic ${clientCredentials}`;
    }

    let tokenResponse;
    try {
      tokenResponse = await axios.post(toSafeHttpUrl(auth.discovery.token_endpoint), tokenParams.toString(), {
        headers,
        timeout: 12000,
      });
    } catch (tokenError) {
      if (!clientSecret || ![400, 401].includes(tokenError?.response?.status)) {
        throw tokenError;
      }

      tokenParams.set("client_secret", clientSecret);
      try {
        tokenResponse = await axios.post(toSafeHttpUrl(auth.discovery.token_endpoint), tokenParams.toString(), {
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          timeout: 12000,
        });
      } catch (postSecretError) {
        if (![400, 401].includes(postSecretError?.response?.status)) {
          throw postSecretError;
        }

        tokenParams.delete("client_secret");
        tokenResponse = await axios.post(toSafeHttpUrl(auth.discovery.token_endpoint), tokenParams.toString(), {
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          timeout: 12000,
        });
      }
    }
    const tokenData = tokenResponse?.data || {};

    let claims = tokenData.id_token ? jwt.decode(tokenData.id_token) || {} : {};
    if (auth.discovery.userinfo_endpoint && tokenData.access_token) {
      try {
        const userInfoResponse = await axios.get(toSafeHttpUrl(auth.discovery.userinfo_endpoint), {
          headers: { Authorization: `Bearer ${tokenData.access_token}` },
          timeout: 12000,
        });
        claims = { ...claims, ...(userInfoResponse?.data || {}) };
      } catch (userinfoError) {
        console.log("[OIDC] userinfo failed", userinfoError?.response?.status || userinfoError.message);
      }
    }

    const subject = getOidcSubject(claims);
    if (!subject) {
      res.status(400).send(renderOidcCallbackPage({ errorMessage: "OIDC provider did not return a usable user identity", appPath }));
      return;
    }

    const jellyfinUser = await findJellyfinUserForOidcClaims(claims);
    if (!jellyfinUser?.id) {
      res.status(403).send(
        renderOidcCallbackPage({
          errorMessage: "No Jellyfin user matches this OIDC account",
          appPath,
        })
      );
      return;
    }

    const assignedRole = settings.userRoles?.[jellyfinUser.id] || (jellyfinUser.isAdministrator ? "Admin" : "Viewer");
    const permissions = getRolePermissions(settings, assignedRole);
    if (assignedRole === "Disabled" || !permissions.dashboard) {
      res.status(403).send(renderOidcCallbackPage({ errorMessage: "This OIDC account is disabled in JellyGlance", appPath }));
      return;
    }

    const token = await signAuthToken({
      id: subject,
      username: getOidcDisplayName(claims),
      authMode: "oidc",
      role: assignedRole,
      permissions,
      jellyfinUser,
      oidcUser: {
        subject,
        email: claims.email || null,
        name: claims.name || null,
        preferredUsername: claims.preferred_username || null,
      },
    });

    res.send(renderOidcCallbackPage({ token, appPath }));
  } catch (error) {
    console.log("[OIDC] callback failed", error?.response?.status || 500, sanitizeForLog(error?.message));
    res.status(error?.response?.status || 500).send(renderOidcCallbackPage({ errorMessage: "Unable to complete OIDC login" }));
  }
});

function resolveAuthSummary(config) {
  const auth = config.settings?.auth;
  if (auth?.mode) {
    return auth;
  }

  if (config.APP_USER === "jellyfin-quick-connect") {
    return { mode: "quick-connect", label: "Jellyfin Quick Connect" };
  }
  if (config.APP_USER === "oidc") {
    return { mode: "oidc", label: "OIDC / Authentik" };
  }
  if (config.APP_USER === "local-auth" || (config.APP_USER && config.APP_PASSWORD)) {
    return { mode: "local", username: config.APP_USER === "local-auth" ? config.settings?.auth?.username || undefined : config.APP_USER };
  }

  if (Array.isArray(config.settings?.localUsers) && config.settings.localUsers.some((user) => user?.username)) {
    return { mode: "local", username: config.settings.localUsers.find((user) => user?.username)?.username };
  }

  return auth || null;
}

router.get("/isConfigured", async (req, res) => {
  try {
    const config = await new configClass().getConfig();
    res.json({
      state: config.state,
      version: packageJson.version,
      auth: publicAuth(resolveAuthSummary(config)),
      serverType: config.SERVER_TYPE || "jellyfin",
      requireLogin: config.REQUIRE_LOGIN,
    });
  } catch (error) {
    console.log(error);
    res.sendStatus(500);
  }
});

router.get("/background-posters", async (req, res) => {
  try {
    const config = await new configClass().getConfig();
    const requestedLimit = Number(req.query.limit) || 24;
    const limit = Math.min(Math.max(requestedLimit, 18), 30);

    if (config.error || config.state < 1 || !config.JF_HOST || !config.JF_API_KEY) {
      res.set("Cache-Control", "no-store");
      res.json({ configured: false, posters: [] });
      return;
    }

    const headers = {
      ...mediaServerAuthHeaders(config.JF_API_KEY),
      "User-Agent": "JellyGlance/" + packageJson.version,
    };
    const itemTypes = ["Movie", "Series", "BoxSet"];
    const perTypeLimit = Math.ceil(limit / itemTypes.length) + 10;

    const posterGroups = await Promise.all(
      itemTypes.map(async (type) => {
        try {
          const response = await axios.get(joinSafeHttpUrl(config.JF_HOST, "/Items"), {
            headers,
            params: {
              Recursive: true,
              IncludeItemTypes: type,
              ImageTypes: "Primary,Backdrop",
              Fields: "ImageTags,BackdropImageTags",
              SortBy: "Random",
              Limit: perTypeLimit,
              EnableImages: true,
              ExcludeLocationTypes: "Virtual",
            },
          });

          return (response?.data?.Items || [])
            .filter((item) => item?.Id && (item?.BackdropImageTags?.length > 0 || item?.ImageTags?.Primary))
            .flatMap((item, index) => {
              const hasBackdrop = item?.BackdropImageTags?.length > 0;
              const hasPoster = Boolean(item?.ImageTags?.Primary);
              const artwork = [];

              if (hasBackdrop) {
                artwork.push({
                  id: item.Id,
                  type: item.Type,
                  imageType: "backdrop",
                  imageTag: item.BackdropImageTags[0],
                });
              }

              if (hasPoster && (!hasBackdrop || index % 4 === 0)) {
                artwork.push({
                  id: item.Id,
                  type: item.Type,
                  imageType: "poster",
                  imageTag: item.ImageTags.Primary,
                });
              }

              return artwork;
            });
        } catch (error) {
          console.log(`[AUTH-BACKGROUND] Unable to fetch ${type} artwork`, error?.response?.status || error.message);
          return [];
        }
      })
    );

    const artwork = posterGroups
      .flat()
      .sort(() => Math.random() - 0.5)
      .slice(0, limit);

    res.set("Cache-Control", "private, max-age=300");
    res.json({ configured: true, artwork, posters: artwork });
  } catch (error) {
    console.log(error);
    res.status(500).json({ configured: false, posters: [] });
  }
});

router.post("/createuser", async (req, res) => {
  try {
    const { username, password } = req.body;
    const config = await new configClass().getConfig();

    if (!username || isEmptyPassword(password)) {
      res.status(400).json({ errorMessage: "Username and password are required" });
      return;
    }

    if (config.settings?.auth?.mode === "quick-connect" || config.settings?.auth?.mode === "oidc") {
      res.status(403).json({ errorMessage: "Local setup is disabled for the selected authentication mode" });
      return;
    }

    if (config.state != null && config.state < 2) {
      const user = { id: 1, username: username };

      let query = 'INSERT INTO app_config ("ID","APP_USER","APP_PASSWORD") VALUES (1,$1,$2)';
      if (config.state > 0) {
        query = 'UPDATE app_config SET  "APP_USER"=$1, "APP_PASSWORD"=$2 where "ID"=1';
      }

      await db.query(query, [username, hashPassword(password)]);

      jwt.sign({ user }, JWT_SECRET, (err, token) => {
        if (err) {
          console.log(err);
          res.sendStatus(500);
        } else {
          res.json({ token });
        }
      });
    } else {
      res.sendStatus(403);
    }
  } catch (error) {
    console.log(error);
    res.status(500).json({ errorMessage: "Unable to create setup user" });
  }
});

router.post("/setup-auth", async (req, res) => {
  try {
    const { mode, username, password, issuerUrl, clientId, clientSecret, redirectUri } = req.body;
    const config = await new configClass().getConfig();
    console.log(`[SETUP-AUTH] setup-auth requested mode=${sanitizeForLog(mode)} state=${sanitizeForLog(config.state)}`);

    if (config.state == null || config.state >= 2) {
      res.sendStatus(403);
      return;
    }

    const settings = config.settings || {};
    let query = "";
    let params = [];
    let tokenUsername = username || mode;

    if (mode === "quick-connect") {
      settings.auth = {
        ...(settings.auth || {}),
        mode: "quick-connect",
        label: "Jellyfin Login / Quick Connect",
      };
      settings.firstRunExtrasPending = true;

      query =
        'UPDATE app_config SET "APP_USER"=$1, "APP_PASSWORD"=$2, "REQUIRE_LOGIN"=$3, settings=$4 where "ID"=1';
      params = ["jellyfin-quick-connect", null, true, settings];
      tokenUsername = "jellyfin-quick-connect";
    } else if (mode === "local") {
      if (!username || isEmptyPassword(password)) {
        res.status(400).json({ errorMessage: "Username and password are required for local login" });
        return;
      }

      settings.auth = {
        mode: "local",
        label: "Local JellyGlance login",
      };
      settings.firstRunExtrasPending = true;
      settings.localUsers = [
        ...(settings.localUsers || []).filter((user) => user.username !== username),
        {
          id: randomUUID(),
          username,
          password: hashPassword(password),
          role: "Admin",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ];

      query =
        'UPDATE app_config SET "APP_USER"=$1, "APP_PASSWORD"=$2, "REQUIRE_LOGIN"=$3, settings=$4 where "ID"=1';
      params = ["local-auth", null, true, settings];
    } else if (mode === "oidc") {
      if (!clientId) {
        res.status(400).json({ errorMessage: "OIDC client ID is required" });
        return;
      }

      const oidcTest = await testOidcDiscovery(issuerUrl);
      if (!oidcTest.isValid) {
        res.status(400).json(oidcTest);
        return;
      }

      settings.auth = {
        mode: "oidc",
        label: "OIDC / Authentik",
        issuerUrl: oidcTest.issuerUrl,
        clientId,
        clientSecret: clientSecret || null,
        redirectUri: redirectUri || null,
        discovery: oidcTest.discovery,
      };
      settings.firstRunExtrasPending = true;

      query =
        'UPDATE app_config SET "APP_USER"=$1, "APP_PASSWORD"=$2, "REQUIRE_LOGIN"=$3, settings=$4 where "ID"=1';
      params = ["oidc", null, true, settings];
      tokenUsername = "oidc";
    } else {
      res.status(400).json({ errorMessage: "Invalid authentication mode" });
      return;
    }

    await db.query(query, params);
    console.log(`[SETUP-AUTH] setup-auth saved mode=${mode}`);
    const token = await signSetupToken(tokenUsername);
    res.json({ token, mode });
  } catch (error) {
    console.log(error);
    res.status(500).json({ errorMessage: "Unable to save authentication setup" });
  }
});

async function setupComplete() {
  const config = await new configClass().getConfig();
  return config.state != null && config.state >= 2;
}

router.post("/test-jellyfin", async (req, res) => {
  try {
    const { JF_HOST, JF_API_KEY, SERVER_TYPE } = req.body;
    // Setup only: once JellyGlance is configured this would let anyone make the server
    // connect to an address of their choosing.
    if (await setupComplete()) {
      res.sendStatus(403);
      return;
    }

    if (!JF_HOST || !JF_API_KEY) {
      res.status(400).json({ isValid: false, errorMessage: "Server URL and API key are required" });
      return;
    }

    const serverType = await chooseServerType(SERVER_TYPE, JF_HOST);
    const validation = await withServerType(serverType, () => API.validateSettings(JF_HOST, JF_API_KEY));
    if (validation.isValid === false) {
      res.status(validation.status || 400).json({ ...validation, serverType });
      return;
    }

    res.json({ ...validation, serverType, serverLabel: serverLabel(serverType) });
  } catch (error) {
    console.log(error);
    res.status(500).json({ isValid: false, errorMessage: "Unable to test the media server connection" });
  }
});

router.post("/configSetup", async (req, res) => {
  try {
    const { JF_HOST, JF_API_KEY, SERVER_TYPE } = req.body;
    const config = await new configClass().getConfig();
    if (config.state != null && config.state >= 2) {
      res.sendStatus(403);
      return;
    }

    if (!JF_HOST || !JF_API_KEY) {
      res.status(400).json({ isValid: false, errorMessage: "JF_HOST and JF_API_KEY are required for configuration" });
      return;
    }

    var url = JF_HOST;

    const serverType = await chooseServerType(SERVER_TYPE, url);
    const validation = await withServerType(serverType, () => API.validateSettings(url, JF_API_KEY));
    if (validation.isValid === false) {
      res.status(validation.status);
      res.send(validation);
      return;
    }

    const { rows: getConfig } = await db.query('SELECT * FROM app_config where "ID"=1');

    if (config.state != null && config.state < 2) {
      let query = 'UPDATE app_config SET "JF_HOST"=$1, "JF_API_KEY"=$2 where "ID"=1';
      if (getConfig.length === 0) {
        query = 'INSERT INTO app_config ("ID","JF_HOST","JF_API_KEY","APP_USER","APP_PASSWORD") VALUES (1,$1,$2,null,null)';
      }

      const { rows } = await db.query(query, [validation.cleanedUrl, JF_API_KEY]);
      await saveServerType(serverType);

      const systemInfo = await API.systemInfo();

      if (systemInfo && systemInfo != {}) {
        const settingsjson = await db.query('SELECT settings FROM app_config where "ID"=1').then((res) => res.rows);

        if (settingsjson.length > 0) {
          const settings = settingsjson[0].settings || {};

          settings.Tasks = systemInfo?.Id || null;

          let query = 'UPDATE app_config SET settings=$1 where "ID"=1';

          await db.query(query, [settings]);
        }
      }

      res.send(rows);
    } else {
      res.sendStatus(500);
    }
  } catch (error) {
    console.log(error);
    res.status(500).json({ isValid: false, errorMessage: "Unable to save the media server configuration" });
  }
});

// Handle other routes
router.use((req, res) => {
  res.status(404).send({ error: "Not Found" });
});

module.exports = router;

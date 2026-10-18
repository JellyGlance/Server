// core
require("dotenv").config();
const http = require("http");
const fs = require("fs");
const path = require("path");
const express = require("express");
const compression = require("compression");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const swaggerUi = require("swagger-ui-express");
const swaggerDocument = require("./swagger.json");
const sanitizeFilename = require("./utils/sanitizer");
const { getBackupDir } = require("./utils/storage-paths");
const {
  apiRateLimit,
  assertPathInside,
  authRateLimit,
  fileRateLimit,
  staticRateLimit,
  taskRateLimit,
} = require("./utils/security");

// db
const dbInstance = require("./db");
const createdb = require("./create_database");

// routes
const authRouter = require("./routes/auth");
const apiRouter = require("./routes/api");
const commandCenterRouter = require("./routes/command-center");
const proxyRouter = require("./routes/proxy");
const { requireAdminSettings, isAdminSettingsPath } = require("./classes/route-guards");
const { router: syncRouter } = require("./routes/sync");
const statsRouter = require("./routes/stats");
const backupRouter = require("./routes/backup");
const { firstRunRestoreHandler, getFirstRunRestoreStatusHandler } = require("./routes/backup");
const tautulliRouter = require("./routes/tautulli");
const externalImportsRouter = require("./routes/external-imports");
const serverTasksRouter = require("./routes/server-tasks");
const jellystatRouter = require("./routes/jellystat");
const logRouter = require("./routes/logging");
const utilsRouter = require("./routes/utils");
const webhooksRouter = require("./routes/webhooks");
const newsletterRouter = require("./routes/newsletter");
const insightsRouter = require("./routes/insights");
const alertsRouter = require("./routes/alerts");
const { publicRouter: publicStatusRouter, adminRouter: publicStatusAdminRouter } = require("./routes/public-status");
const thresholdAlerts = require("./classes/threshold-alerts");

// tasks
const ActivityMonitor = require("./tasks/ActivityMonitor");
const TaskManager = require("./classes/task-manager-singleton");
const TaskScheduler = require("./classes/task-scheduler-singleton");
const { bootstrapFromEnv } = require("./classes/env-bootstrap");
const { runLatestMigrations } = require("./classes/run-migrations");
const { getWebhookCard } = require("./classes/discord-webhook-media");
const { DEFAULT_ROLE_PERMISSIONS, getRolePermissions } = require("./classes/role-permissions");
const { normalizeApiKeyScope } = require("./classes/api-key-scope");
// const WebhookScheduler = require("./classes/webhook-scheduler");
// const tasks = require("./tasks/tasks");

// websocket
const { setupWebSocketServer } = require("./ws");
const writeEnvVariables = require("./classes/env");
const { buildEnvContent } = require("./classes/env");
const { buildAppManifest } = require("./utils/app-manifest");

process.env.POSTGRES_USER = process.env.POSTGRES_USER ?? "postgres";
process.env.POSTGRES_ROLE = process.env.POSTGRES_ROLE ?? process.env.POSTGRES_USER;

const app = express();

const ensureSlashes = (url) => {
  if (!url.startsWith("/")) {
    url = "/" + url;
  }
  if (url.endsWith("/")) {
    url = url.slice(0, -1);
  }
  return url;
};

const PORT = Number(process.env.PORT || process.env.JS_PORT || 3000);
const LISTEN_IP = process.env.JS_LISTEN_IP || "0.0.0.0";
const JWT_SECRET = process.env.JWT_SECRET;
const BASE_NAME = process.env.JS_BASE_URL ? ensureSlashes(process.env.JS_BASE_URL) : "";

const DEFAULT_ALLOWED_ORIGINS = [
  `http://localhost:${PORT}`,
  `http://127.0.0.1:${PORT}`,
  "http://localhost:3001",
  "http://127.0.0.1:3001",
];
const configuredAllowedOrigins = (process.env.CORS_ORIGINS || process.env.JS_CORS_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const allowedOrigins = new Set([...DEFAULT_ALLOWED_ORIGINS, ...configuredAllowedOrigins]);

function normalizeOrigin(origin = "") {
  return String(origin).trim().replace(/\/+$/, "");
}

function getRequestOrigin(req) {
  const forwardedProto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  const forwardedHost = String(req.headers["x-forwarded-host"] || "").split(",")[0].trim();
  const protocol = forwardedProto || req.protocol;
  const host = forwardedHost || req.headers.host;

  return protocol && host ? `${protocol}://${host}` : "";
}

function isLocalOrigin(origin) {
  try {
    const { hostname } = new URL(origin);
    return ["localhost", "127.0.0.1", "::1"].includes(hostname) || /^10\./.test(hostname) || /^192\.168\./.test(hostname) || /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname);
  } catch {
    return false;
  }
}

function isAllowedCorsOrigin(origin, req) {
  if (!origin) return true;
  const normalizedOrigin = normalizeOrigin(origin);
  return (
    allowedOrigins.has(normalizedOrigin) ||
    normalizedOrigin === normalizeOrigin(getRequestOrigin(req)) ||
    isLocalOrigin(normalizedOrigin) ||
    process.env.CORS_ALLOW_ALL === "true"
  );
}

if (JWT_SECRET === undefined) {
  console.log("JWT Secret cannot be undefined");
  process.exit(1); // end the program with error status code
}

// middlewares
app.set("trust proxy", 1);
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || "1mb" })); // middleware to parse JSON request bodies
app.use((req, res, next) =>
  cors({
    origin(origin, callback) {
      callback(null, isAllowedCorsOrigin(origin, req));
    },
  })(req, res, next)
);
app.disable("x-powered-by");
app.use(compression());

app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' https://track.nerdytech.dev",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' data: https://fonts.gstatic.com",
      "img-src 'self' data: blob: https:",
      "connect-src 'self' ws: wss: http: https:",
      "frame-src 'self'",
      "frame-ancestors 'self'",
      "object-src 'none'",
      "base-uri 'self'",
    ].join("; ")
  );
  next();
});

function authRateLimitUnlessPublicStatus(req, res, next) {
  if (req.method === "GET" && req.path === "/isConfigured") {
    return next();
  }
  return authRateLimit(req, res, next);
}

function isSocketIoPath(pathnameOrUrl) {
  try {
    const pathname = String(pathnameOrUrl || "").includes("://")
      ? new URL(pathnameOrUrl, "http://jellyglance.local").pathname
      : String(pathnameOrUrl || "").split("?")[0];
    return pathname === "/socket.io" || pathname.startsWith("/socket.io/");
  } catch {
    return false;
  }
}

function typeInferenceMiddleware(req, res, next) {
  Object.keys(req.query).forEach((key) => {
    const value = req.query[key];

    if (typeof value === "string") {
      if (value.toLowerCase() === "true" || value.toLowerCase() === "false") {
        req.query[key] = value.toLowerCase() === "true";
      } else if (value.trim() !== "" && !Number.isNaN(Number(value))) {
        req.query[key] = +value;
      }
    }

    if (Array.isArray(value)) {
      req.query[key] = value.map((item) => {
        if (typeof item !== "string") {
          return item;
        }

        if (item.toLowerCase() === "true" || item.toLowerCase() === "false") {
          return item.toLowerCase() === "true";
        }

        return item.trim() !== "" && !Number.isNaN(Number(item)) ? +item : item;
      });
    }
  });
  next();
}

app.use(typeInferenceMiddleware);

const root = process.env.JS_CLIENT_DIST || path.join(__dirname, "..", "web", "dist");
const staticAssetIndex = new Map();
const STATIC_FILE_EXTENSION_REGEX = /\.(css|ico|js|json|png|jpg|jpeg|webp|svg|woff2?|ttf|map)$/i;

function indexStaticAssets(dir, baseDir = dir) {
  if (!fs.existsSync(dir)) {
    return;
  }

  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      indexStaticAssets(fullPath, baseDir);
    } else if (!staticAssetIndex.has(file)) {
      const relativePath = `/${path.relative(baseDir, fullPath).split(path.sep).join("/")}`;
      staticAssetIndex.set(relativePath, fullPath);
      staticAssetIndex.set(file, fullPath);
    }
  }
}

function getRequestPathname(req) {
  try {
    return decodeURIComponent(new URL(req.originalUrl || req.url, "http://jellyglance.local").pathname);
  } catch {
    return req.path || req.url.split("?")[0];
  }
}

function getStaticAssetPath(req) {
  let pathname = getRequestPathname(req);
  if (BASE_NAME && pathname.startsWith(BASE_NAME)) {
    pathname = pathname.slice(BASE_NAME.length) || "/";
  }

  const exactPath = staticAssetIndex.get(pathname);
  if (exactPath) {
    return exactPath;
  }

  const fileName = path.basename(pathname);
  if (fileName !== "translation.json") {
    return staticAssetIndex.get(fileName);
  }

  return null;
}

function getTranslationFilePath(req) {
  let pathname = getRequestPathname(req);
  if (BASE_NAME && pathname.startsWith(BASE_NAME)) {
    pathname = pathname.slice(BASE_NAME.length) || "/";
  }

  const match = pathname.match(/^\/locales\/([^/]+)\/translation\.json$/);
  if (!match) {
    return null;
  }

  const locale = sanitizeFilename(match[1]);
  const filePath = path.join(root, "locales", locale, "translation.json");
  const localesRoot = path.join(root, "locales");

  if (!filePath.startsWith(localesRoot) || !fs.existsSync(filePath)) {
    return null;
  }

  return filePath;
}

//hacky middleware to handle basename changes for UI

// Built JS/CSS chunks have content-hashed names and a full app load pulls ~200 of them,
// so counting them against the static limit blanks the page after a couple of reloads.
// Only files that exist in the build index are exempt; everything else is still limited.
const HASHED_ASSET_REGEX = /\/assets\/[^/]+-[A-Za-z0-9_-]{8,}\.(js|css)$/;
function isBuiltAsset(req) {
  if (req.method !== "GET" && req.method !== "HEAD") return false;
  const pathname = getRequestPathname(req);
  if (!HASHED_ASSET_REGEX.test(pathname)) return false;
  const filePath = getStaticAssetPath(req);
  return Boolean(filePath && filePath.startsWith(path.join(root, "assets") + path.sep));
}

app.use((req, res, next) => (isBuiltAsset(req) ? next() : staticRateLimit(req, res, next)));
app.use((req, res, next) => {
  if (BASE_NAME && BASE_NAME != "" && (req.url == "/" || req.url == "")) {
    return res.redirect(BASE_NAME);
  }
  const pathname = getRequestPathname(req);
  const isSwaggerAsset = pathname === "/swagger.json" || pathname === "/swagger-ui" || pathname.startsWith("/swagger-ui/");

  // Keep socket, backup, webhook cards, and swagger-ui assets off the SPA static rewrite.
  // /swagger is the SPA route that redirects to Settings → Swagger.
  if (isSocketIoPath(req.url) || req.url.startsWith("/backup") || req.url.includes("webhook-cards") || isSwaggerAsset) {
    if (isSwaggerAsset && BASE_NAME && req.url.startsWith(BASE_NAME) && req.url !== BASE_NAME) {
      req.url = req.url.slice(BASE_NAME.length);
    }
    return next();
  }
  if (pathname === "/env.js" || (BASE_NAME && pathname === `${BASE_NAME}/env.js`)) {
    res.set("Cache-Control", "no-store");
    return res.type("application/javascript").send(buildEnvContent());
  }
  if (pathname === "/app.webmanifest" || (BASE_NAME && pathname === `${BASE_NAME}/app.webmanifest`)) {
    const requested = new URL(req.url, "http://localhost").searchParams.get("start");
    res.set("Cache-Control", "no-store");
    return res.type("application/manifest+json").send(JSON.stringify(buildAppManifest(requested === "/me" ? "/me" : "/", BASE_NAME)));
  }

  const translationFilePath = getTranslationFilePath(req);
  if (translationFilePath) {
    res.set("Cache-Control", "no-store");
    return res.type("application/json").sendFile(translationFilePath);
  }

  if (STATIC_FILE_EXTENSION_REGEX.test(pathname)) {
    const filePath = getStaticAssetPath(req);
    if (filePath) {
      if ([".js", ".css", ".html"].includes(path.extname(filePath))) {
        res.set("Cache-Control", "no-store");
      }
      return res.sendFile(filePath);
    }

    return res.status(404).type("text/plain").send("Static asset not found");
  }

  if (BASE_NAME && req.url.startsWith(BASE_NAME) && req.url !== BASE_NAME) {
    req.url = req.url.slice(BASE_NAME.length);
    // console.log("URL: " + req.url);
  }
  next();
});

// initiate routes
app.use(`/auth`, authRateLimitUnlessPublicStatus, authRouter, () => {
  /*  #swagger.tags = ['Auth'] */
}); // mount the API router at /auth
app.use("/proxy", apiRateLimit, authenticateProxyAsset, restrictApiKeyScope, authorizeProxyRoute, proxyRouter, () => {
  /*  #swagger.tags = ['Proxy']*/
}); // mount the API router at /proxy
app.use("/api/startTask", taskRateLimit);
app.use("/api/server-management/action", taskRateLimit);
app.use("/sync", taskRateLimit);
app.use("/backup/beginBackup", taskRateLimit);
app.post("/backup/first-run/restore", taskRateLimit, firstRunRestoreHandler);
app.get("/backup/first-run/restore/status", getFirstRunRestoreStatusHandler);
app.get("/webhook-cards/:id.jpg", fileRateLimit, (req, res) => {
  const card = getWebhookCard(req.params.id);
  if (!card) {
    return res.status(404).type("text/plain").send("Not found");
  }
  res.setHeader("Content-Type", card.contentType || "image/jpeg");
  res.setHeader("Cache-Control", "public, max-age=600");
  return res.end(card.buffer);
});
app.use("/api", apiRateLimit, authenticate, restrictApiKeyScope, authorizeApiRoute, commandCenterRouter, apiRouter, () => {
  /*  #swagger.tags = ['API']*/
}); // mount the API router at /api, with JWT middleware
app.use("/sync", apiRateLimit, authenticate, restrictApiKeyScope, requirePermission("settings"), syncRouter, () => {
  /*  #swagger.tags = ['Sync']*/
}); // mount the API router at /sync, with JWT middleware
app.use("/insights-data/library-health", apiRateLimit, authenticate, restrictApiKeyScope, requirePermission("settings"));
app.use("/insights-data/streams", apiRateLimit, authenticate, restrictApiKeyScope, requirePermission("settings"));
app.use("/insights-data", apiRateLimit, authenticate, restrictApiKeyScope, insightsRouter);
app.use("/alerts-data", apiRateLimit, authenticate, restrictApiKeyScope, requirePermission("settings"), alertsRouter);
app.use("/status-data/admin", apiRateLimit, authenticate, restrictApiKeyScope, requirePermission("settings"), publicStatusAdminRouter);
app.use("/status-data", apiRateLimit, publicStatusRouter);
app.use("/stats", apiRateLimit, authenticate, restrictApiKeyScope, statsRouter, () => {
  /*  #swagger.tags = ['Stats']*/
}); // mount the API router at /stats, with JWT middleware
app.use("/backup", fileRateLimit, authenticate, restrictApiKeyScope, requirePermission("settings"), backupRouter, () => {
  /*  #swagger.tags = ['Backup']*/
}); // mount the API router at /backup, with JWT middleware
app.use("/tautulli", fileRateLimit, authenticate, restrictApiKeyScope, requirePermission("settings"), tautulliRouter, () => {
  /*  #swagger.tags = ['Tautulli']*/
}); // mount the Tautulli import router with settings permission
app.use("/jellystat", fileRateLimit, authenticate, restrictApiKeyScope, requirePermission("settings"), jellystatRouter, () => {
  /*  #swagger.tags = ['Jellystat']*/
}); // mount the Jellystat import router with settings permission
app.use("/external-imports", fileRateLimit, authenticate, restrictApiKeyScope, requirePermission("settings"), externalImportsRouter, () => {
  /*  #swagger.tags = ['Imports']*/
}); // mount the Jellyfin watch sync and Trakt import router with settings permission
app.use("/server-tasks", apiRateLimit, authenticate, restrictApiKeyScope, requirePermission("settings"), serverTasksRouter, () => {
  /*  #swagger.tags = ['Server tasks']*/
}); // mount ARR task running and task active times with settings permission
app.use("/logs", apiRateLimit, authenticate, restrictApiKeyScope, requirePermission("settings"), logRouter, () => {
  /*  #swagger.tags = ['Logs']*/
}); // mount the API router at /logs, with JWT middleware
app.use("/utils", apiRateLimit, authenticate, restrictApiKeyScope, requirePermission("settings"), utilsRouter, () => {
  /*  #swagger.tags = ['Utils']*/
}); // mount the API router at /utils, with JWT middleware
app.use("/webhooks", apiRateLimit, authenticate, restrictApiKeyScope, requirePermission("settings"), webhooksRouter, () => {
  /*  #swagger.tags = ['Webhooks']*/
}); // mount the API router at /webhooks, with JWT middleware
app.use("/newsletter", apiRateLimit, authenticate, restrictApiKeyScope, requirePermission("settings"), newsletterRouter, () => {
  /*  #swagger.tags = ['Newsletter']*/
}); // mount the newsletter router with settings permission

app.get("/backup-download/:filename", fileRateLimit, (req, res) => {
  try {
    const filename = sanitizeFilename(req.params.filename);
    const decoded = jwt.verify(String(req.query.ticket || ""), JWT_SECRET, { algorithms: ["HS256"] });
    if (decoded.purpose !== "backup-download" || decoded.filename !== filename) {
      res.status(403).send("Invalid download ticket");
      return;
    }

    const filePath = assertPathInside(getBackupDir(), path.join(getBackupDir(), filename));
    if (!fs.existsSync(filePath)) {
      res.status(404).send("Backup file not found");
      return;
    }

    res.download(filePath, filename, (error) => {
      if (error && !res.headersSent) {
        console.error(error);
        res.status(500).send("Unable to download backup file");
      }
    });
  } catch (error) {
    console.error(error);
    res.status(401).send("Invalid or expired download ticket");
  }
});

// Swagger spec + standalone UI. The Glance app owns GET /swagger.
app.get("/swagger.json", (_req, res) => {
  res.set("Cache-Control", "no-store");
  res.json(swaggerDocument);
});
app.use(
  "/swagger-ui",
  swaggerUi.serve,
  swaggerUi.setup(swaggerDocument, {
    customSiteTitle: "JellyGlance API",
    customCss: `
      .swagger-ui .topbar { display: none; }
      body { margin: 0; background: #0b1118; }
      .swagger-ui { background: transparent; }
      .swagger-ui .info .title { display: none; }
      .swagger-ui .info p, .swagger-ui .info li, .swagger-ui .info table { color: #9aa7bb; }
      .swagger-ui .scheme-container { background: #121821; box-shadow: none; }
      .swagger-ui .opblock-tag { color: #f8fafc; border-color: rgba(255,255,255,0.08); }
    `,
    swaggerOptions: {
      persistAuthorization: true,
      tagsSorter: "alpha",
      operationsSorter: "alpha",
    },
  })
);

// for deployment of static page
writeEnvVariables().then(() => {
  staticAssetIndex.clear();
  indexStaticAssets(root);
  // staticRateLimit already applied globally; attach again so CodeQL sees these
  // async-registered file handlers as rate-limited.
  app.use(
    staticRateLimit,
    express.static(root, {
      setHeaders: (res, filePath) => {
        if ([".js", ".css", ".html"].includes(path.extname(filePath))) {
          res.set("Cache-Control", "no-store");
        }
      },
    })
  );
  app.get("/{*splat}", staticRateLimit, (req, res, next) => {
    if (isSocketIoPath(req.url)) {
      return next();
    }
    if (STATIC_FILE_EXTENSION_REGEX.test(getRequestPathname(req))) {
      return res.status(404).type("text/plain").send("Static asset not found");
    }
    res.set("Cache-Control", "no-store");
    res.sendFile(path.join(root, "index.html"));
  });
});

// JWT middleware
const apiKeyTouchTimes = new Map();
const API_KEY_TOUCH_MS = 2 * 60 * 1000;
const WIDGET_API_PATHS = [
  "/api/widgets",
  "/api/ops-digest",
  "/api/library-storage",
  "/api/jellyfin/status",
  "/api/item-glance",
  "/api/downloads/stitched",
];

function requestPath(req) {
  return String(req.originalUrl || req.url || "").split("?")[0].toLowerCase();
}

function isWidgetsOnlyPath(req) {
  const full = requestPath(req);
  return WIDGET_API_PATHS.some((prefix) => full === prefix || full.startsWith(`${prefix}/`));
}

function restrictApiKeyScope(req, res, next) {
  if (!req.apiKeyScope || req.apiKeyScope === "full") {
    next();
    return;
  }
  const write = req.apiKeyScope === "widgets-write";
  const methodOk = req.method === "GET" || req.method === "HEAD" || (write && req.method === "POST");
  if (!methodOk) {
    return res.status(403).json({ message: write ? "This API key cannot use that method" : "This API key is widgets-only" });
  }
  if (!isWidgetsOnlyPath(req)) {
    return res.status(403).json({ message: write ? "This API key is widgets-write only" : "This API key is widgets-only" });
  }
  next();
}

async function touchApiKeyLastUsed(apiKey) {
  const now = Date.now();
  if (now - (apiKeyTouchTimes.get(apiKey) || 0) < API_KEY_TOUCH_MS) return;
  apiKeyTouchTimes.set(apiKey, now);
  try {
    const row = await dbInstance.query('SELECT api_keys FROM app_config where "ID"=1').then((result) => result.rows[0]);
    const keys = Array.isArray(row?.api_keys) ? row.api_keys : [];
    if (!keys.some((item) => item.key === apiKey)) return;
    const next = keys.map((item) => (item.key === apiKey ? { ...item, lastUsed: new Date().toISOString() } : item));
    await dbInstance.query('UPDATE app_config SET api_keys=$1 where "ID"=1', [JSON.stringify(next)]);
  } catch (error) {
    console.warn("[API-KEY] last-used update failed:", error.message);
  }
}

async function authenticate(req, res, next) {
  const authorization = req.headers.authorization;
  const apiKey = req.headers["x-api-token"];
  const extractedToken =
    typeof authorization === "string" && authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";

  if (extractedToken && extractedToken !== "null") {
    try {
      const decoded = jwt.verify(extractedToken, JWT_SECRET, { algorithms: ["HS256"] });
      if (!decoded || typeof decoded !== "object" || decoded.user == null) {
        return res.status(401).json({ message: "Invalid token" });
      }
      const access = await resolveTokenAccess(decoded.user);
      if (!access?.permissions?.dashboard) {
        return res.status(403).json({ message: "This account is disabled in JellyGlance" });
      }

      req.user = access.user;
      req.permissions = access.permissions;
      return next(); // codeql[js/user-controlled-bypass]
    } catch (error) {
      console.log("Invalid token");
      return res.status(401).json({ message: "Invalid token" });
    }
  }

  if (typeof apiKey === "string" && apiKey) {
    const keysjson = await dbInstance.query('SELECT api_keys FROM app_config where "ID"=1').then((res) => res.rows[0].api_keys);

    if (!keysjson || Object.keys(keysjson).length === 0) {
      return res.status(404).json({ message: "No API keys configured" });
    }
    const keys = keysjson || [];
    const match = keys.find((obj) => obj.key === apiKey);

    if (match) {
      req.permissions = DEFAULT_ROLE_PERMISSIONS.Owner;
      req.apiKeyScope = normalizeApiKeyScope(match.scope, { fallback: "full" });
      touchApiKeyLastUsed(apiKey);
      next();
      return;
    }
    return res.status(403).json({ message: "Invalid API key" });
  }

  return res.status(401).json({
    message: "Authentication failed. No token or API key provided.",
  });
}

function isPublicProxyAssetRequest(req) {
  if (req.method !== "GET") {
    return false;
  }

  const pathName = req.path.toLowerCase();
  return (
    pathName.startsWith("/items/images/") ||
    pathName.startsWith("/users/images/") ||
    pathName.startsWith("/plugins/images/") ||
    pathName.startsWith("/audiobookshelf/images/") ||
    pathName.startsWith("/web/assets/img/devices/")
  );
}

function authenticateProxyAsset(req, res, next) {
  if (isPublicProxyAssetRequest(req)) {
    next();
    return;
  }

  return authenticate(req, res, next);
}

function authorizeProxyRoute(req, res, next) {
  if (isPublicProxyAssetRequest(req)) {
    next();
    return;
  }

  return authorizeApiRoute(req, res, next);
}

function getTokenPermissions(user) {
  if (user === "internal") {
    return DEFAULT_ROLE_PERMISSIONS.Owner;
  }

  if (user?.permissions) {
    return user.permissions;
  }

  if (user?.role && DEFAULT_ROLE_PERMISSIONS[user.role]) {
    return DEFAULT_ROLE_PERMISSIONS[user.role];
  }

  return DEFAULT_ROLE_PERMISSIONS.Owner;
}

async function resolveTokenAccess(user) {
  if (user === "internal") {
    return { user, permissions: DEFAULT_ROLE_PERMISSIONS.Owner };
  }

  if (user?.authMode === "quick-connect" && user?.id) {
    const { rows } = await dbInstance.query('SELECT settings FROM app_config where "ID"=1');
    const settings = rows[0]?.settings || {};
    const role = settings.userRoles?.[user.id] || (user.jellyfinUser?.isAdministrator ? "Admin" : "Viewer");
    const permissions = getRolePermissions(settings, role);

    return {
      user: {
        ...user,
        role,
        permissions,
      },
      permissions,
    };
  }

  if (user?.authMode === "oidc" && user?.jellyfinUser?.id) {
    const { rows } = await dbInstance.query('SELECT settings FROM app_config where "ID"=1');
    const settings = rows[0]?.settings || {};
    const role = settings.userRoles?.[user.jellyfinUser.id] || (user.jellyfinUser?.isAdministrator ? "Admin" : "Viewer");
    const permissions = getRolePermissions(settings, role);

    return {
      user: {
        ...user,
        role,
        permissions,
      },
      permissions,
    };
  }

  if (user?.authMode === "local") {
    const { rows } = await dbInstance.query('SELECT "APP_USER", settings FROM app_config where "ID"=1');
    const config = rows[0] || {};
    const settings = config.settings || {};
    const localUser = (settings.localUsers || []).find((item) => item.id === user.id || item.username === user.username);
    const role = user.id === 1 || config.APP_USER === user.username ? "Owner" : localUser?.role || user.role || "Viewer";
    const permissions = getRolePermissions(settings, role);

    return {
      user: {
        ...user,
        role,
        permissions,
      },
      permissions,
    };
  }

  const permissions = getTokenPermissions(user);
  return { user, permissions };
}

function requirePermission(permission) {
  return (req, res, next) => {
    if (req.permissions?.[permission]) {
      next();
      return;
    }

    res.status(403).json({ message: `Permission required: ${permission}` });
  };
}

function authorizeApiRoute(req, res, next) {
  const pathName = req.path.toLowerCase();

  if (pathName === "/getconfig") {
    next();
    return;
  }

  if (pathName === "/sessions/stop" || pathName === "/sessions/message") {
    if (!["Owner", "Admin"].includes(req.user?.role)) {
      return res.status(403).json({ message: "Admin role required" });
    }
    next();
    return;
  }

  // Read-only server status is used by the Homarr/Homepage widget kit, so widget keys can read it.
  if (pathName === "/jellyfin/status" && (req.method === "GET" || req.method === "HEAD")) {
    return requirePermission("dashboard")(req, res, next);
  }

  if (pathName.startsWith("/jellyfin/refresh")) {
    if (!["Owner", "Admin"].includes(req.user?.role)) {
      return res.status(403).json({ message: "Admin role required" });
    }
    next();
    return;
  }

  if (pathName.startsWith("/downloads")) {
    if (req.permissions?.downloads || req.permissions?.settings) {
      next();
      return;
    }
    if (req.method === "GET" || req.method === "HEAD") {
      return requirePermission("dashboard")(req, res, next);
    }
    return requirePermission("settings")(req, res, next);
  }

  if (pathName.startsWith("/tdarr")) {
    if (req.method === "GET" || req.method === "HEAD") {
      return requirePermission("dashboard")(req, res, next);
    }
    return requirePermission("settings")(req, res, next);
  }

  // Probes arbitrary user-supplied URLs, so it's limited to admins with the settings permission.
  if (isAdminSettingsPath(pathName)) {
    return requireAdminSettings(req, res, next);
  }

  if (pathName.startsWith("/server-management")) {
    if (!req.permissions?.settings || !["Owner", "Admin"].includes(req.user?.role)) {
      return res.status(403).json({ message: "Admin role required" });
    }
    next();
    return;
  }

  if (
    (pathName.startsWith("/requests/") && (pathName.endsWith("/actions") || pathName.endsWith("/edit"))) ||
    pathName === "/requests/manage" ||
    pathName.startsWith("/requests/issues")
  ) {
    if (!["Owner", "Admin"].includes(req.user?.role)) {
      return res.status(403).json({ message: "Admin role required" });
    }
    next();
    return;
  }

  if (pathName.startsWith("/requests/user-folders") || pathName === "/requests/folder-options") {
    if (!req.permissions?.users && !["Owner", "Admin"].includes(req.user?.role)) {
      return res.status(403).json({ message: "Users permission required" });
    }
    next();
    return;
  }

  const permission =
    pathName.startsWith("/keys")
      ? "apiKeys"
      : pathName.startsWith("/useraccess") ||
          pathName.startsWith("/roles") ||
          pathName.startsWith("/localusers") ||
          pathName.startsWith("/primarylocalpassword") ||
          pathName.startsWith("/userroles") ||
          pathName.startsWith("/setpreferredadmin") ||
          pathName.startsWith("/untrackedusers") ||
          pathName.startsWith("/setuntrackedusers")
        ? "users"
        : pathName.startsWith("/set") ||
            pathName.includes("/purge") ||
            pathName.startsWith("/integrations") ||
            pathName.startsWith("/wizarr") ||
            pathName.startsWith("/jellyfin/") ||
            pathName.startsWith("/first-run") ||
            pathName.startsWith("/starttask") ||
            pathName.startsWith("/stoptask") ||
            pathName.startsWith("/gettasksettings") ||
            pathName.startsWith("/getactivitymonitorsettings") ||
            pathName.startsWith("/checkforupdates") ||
            pathName.startsWith("/admin-audit") ||
            pathName.startsWith("/deleteplaybackactivity") ||
            pathName.startsWith("/getbackuptables")
          ? "settings"
          : "dashboard";

  return requirePermission(permission)(req, res, next);
}

// Graceful shutdown: on SIGTERM/SIGINT (docker stop, Ctrl+C) stop the background
// timers, stop accepting connections, close the database pool and exit. A hard
// exit after SHUTDOWN_TIMEOUT_MS covers connections that never close.
const background = {};
const SHUTDOWN_TIMEOUT_MS = 10000;
function installShutdownHandlers(server) {
  let shuttingDown = false;
  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[JellyGlance] ${signal} received, shutting down`);
    setTimeout(() => process.exit(0), SHUTDOWN_TIMEOUT_MS).unref();
    try {
      background.taskScheduler?.stop?.();
      background.taskManager?.stop?.();
      thresholdAlerts.stop();
      require("./classes/status-page").stopStatusChecks();
      require("./classes/config-ready").stop();
      require("./classes/timers").stopAll();
    } catch (error) {
      console.warn("[JellyGlance] Error stopping background work:", error.message);
    }
    server.close(() => {
      dbInstance.pool
        .end()
        .catch(() => {})
        .finally(() => process.exit(0));
    });
    if (typeof server.closeIdleConnections === "function") server.closeIdleConnections();
  };
  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("SIGINT", () => shutdown("SIGINT"));
}

// start server
(async () => {
  try {
    const created = await createdb.createDatabase();
    console.log(created ? "[JellyGlance] Database created" : "[JellyGlance] Database exists. Skipping creation");

    await runLatestMigrations();

    try {
      await bootstrapFromEnv({ afterTaskManager: false });
    } catch (error) {
      console.error("[BOOTSTRAP] Env setup failed:", error.message);
    }

    const server = http.createServer(app);
    server.requestTimeout = 0;
    server.headersTimeout = 0;
    setupWebSocketServer(server, BASE_NAME);
    installShutdownHandlers(server);
    server.listen(PORT, LISTEN_IP, async () => {
      console.log(`[JellyGlance] Server listening on http://${LISTEN_IP}:${PORT}`);
      ActivityMonitor.ActivityMonitor(1000);
      background.taskManager = new TaskManager();
      background.taskScheduler = new TaskScheduler();
      thresholdAlerts.start();
      require("./classes/status-page").startStatusChecks();
      try {
        await bootstrapFromEnv({ afterTaskManager: true });
      } catch (error) {
        console.error("[BOOTSTRAP] Post-task env setup failed:", error.message);
      }
    });
  } catch (error) {
    console.error("[JellyGlance] Startup failed:", error.message || error);
    process.exit(1);
  }
})();

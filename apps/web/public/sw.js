/* JellyGlance service worker: installable app shell, offline page, static-asset cache and notification clicks.
 * Only same-origin static files (hashed build assets, icons, fonts, locales) are ever cached.
 * API, auth, proxy, websocket and every other dynamic response always goes to the network and is never stored. */
const VERSION = "v2";
const SHELL_CACHE = `jellyglance-shell-${VERSION}`;
const ASSET_CACHE = `jellyglance-assets-${VERSION}`;
const SCOPE = new URL(self.registration.scope);
const BASE = SCOPE.pathname.replace(/\/$/, "");
const OFFLINE_URL = new URL("offline.html", SCOPE).toString();
const PRECACHE = [OFFLINE_URL, new URL("icon-192.png", SCOPE).toString()];
const MAX_ASSETS = 120;

const DYNAMIC_PREFIXES = ["/api", "/auth", "/proxy", "/stats", "/sync", "/logs", "/backup", "/socket.io", "/alerts-data", "/webhooks", "/swagger", "/env.js", "/app.webmanifest"];
const STATIC_EXTENSIONS = /\.(?:js|css|woff2?|ttf|otf|png|jpe?g|gif|svg|webp|avif|ico)$/i;

function appPath(url) {
  return BASE && url.pathname.startsWith(BASE) ? url.pathname.slice(BASE.length) || "/" : url.pathname;
}

function isCacheableAsset(request) {
  if (request.method !== "GET") return false;
  const url = new URL(request.url);
  if (url.origin !== SCOPE.origin || url.search) return false;
  if (request.headers.has("authorization") || request.headers.has("range")) return false;
  const path = appPath(url);
  if (DYNAMIC_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`) || path.startsWith(`${prefix}?`))) return false;
  if (path === "/sw.js" || path === "/notification-sw.js") return false;
  // Vite build output is content-hashed, so it can be served cache-first safely.
  if (path.startsWith("/assets/")) return STATIC_EXTENSIONS.test(path);
  // Unhashed public files: icons and brand images only.
  return /^\/(?:icon-[^/]+\.png|maskable-[^/]+\.png|apple-touch-icon[^/]*\.png|favicon\.(?:ico|svg))$|^\/brand\/[^/]+\.(?:png|svg)$/i.test(path);
}

function isStorableResponse(response) {
  if (!response || !response.ok || response.type !== "basic") return false;
  const cacheControl = response.headers.get("cache-control") || "";
  if (/no-store|private/i.test(cacheControl)) return false;
  if (response.headers.has("set-cookie")) return false;
  const type = response.headers.get("content-type") || "";
  return !/json|html/i.test(type);
}

async function trimCache(cache) {
  const keys = await cache.keys();
  await Promise.all(keys.slice(0, Math.max(0, keys.length - MAX_ASSETS)).map((key) => cache.delete(key)));
}

async function cacheFirst(request) {
  const cache = await caches.open(ASSET_CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (isStorableResponse(response)) {
    await cache.put(request, response.clone()).catch(() => undefined);
    trimCache(cache).catch(() => undefined);
  }
  return response;
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .catch(() => undefined)
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  const keep = new Set([SHELL_CACHE, ASSET_CACHE]);
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith("jellyglance-") && !keep.has(key)).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  // Page loads always come from the network so builds and sign-in state are never stale.
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match(OFFLINE_URL)));
    return;
  }
  if (isCacheableAsset(request)) event.respondWith(cacheFirst(request));
  // Everything else (API, auth, websocket, uploads) is left to the browser untouched.
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = event.notification.data?.url || self.registration.scope;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) return client.focus();
      }
      return self.clients.openWindow ? self.clients.openWindow(target) : undefined;
    })
  );
});

if (typeof module !== "undefined") module.exports = { isCacheableAsset, isStorableResponse, appPath };

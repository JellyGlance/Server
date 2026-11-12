// Absolute links and poster URLs for newsletter emails. Email clients will not
// send a session cookie, so artwork goes through the already-public image proxy
// and every href is rooted at a configured public base (or the request host in
// previews). When no base is available, callers should render a text fallback.

function trimBase(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function looksLikeHttpUrl(value) {
  return /^https?:\/\//i.test(String(value || "").trim());
}

function configuredPublicBase(settings = {}) {
  const env = trimBase(process.env.JS_PUBLIC_URL || process.env.JS_EXTERNAL_URL);
  if (looksLikeHttpUrl(env)) return env;
  const setting = trimBase(settings.EXTERNAL_URL || settings.externalUrl || settings.publicUrl || settings.PublicUrl);
  if (looksLikeHttpUrl(setting)) return setting;
  return "";
}

function resolvePublicBase({ assetBase = "", publicBase = "", settings = {} } = {}) {
  const configured = trimBase(publicBase) || configuredPublicBase(settings);
  if (looksLikeHttpUrl(configured)) return configured;
  const requestBase = trimBase(assetBase);
  if (looksLikeHttpUrl(requestBase)) return requestBase;
  return "";
}

function absoluteUrl(base, path) {
  const root = trimBase(base);
  if (!root || path == null || path === "") return "";
  const suffix = String(path).startsWith("/") ? path : `/${path}`;
  return `${root}${suffix}`;
}

function itemHref(base, itemId) {
  const id = String(itemId || "").trim();
  return id ? absoluteUrl(base, `/libraries/item/${encodeURIComponent(id)}`) : "";
}

function requestsHref(base, requestId) {
  const id = String(requestId || "").trim();
  return absoluteUrl(base, id ? `/requests?request=${encodeURIComponent(id)}` : "/requests");
}

function statusPageHref(base) {
  return absoluteUrl(base, "/status");
}

function posterSrc(base, itemId, { width = 200, quality = 80 } = {}) {
  const root = trimBase(base);
  const id = String(itemId || "").trim();
  if (!root || !id) return "";
  const fillWidth = Number.isFinite(Number(width)) ? Math.max(40, Math.min(800, Math.round(Number(width)))) : 200;
  const imageQuality = Number.isFinite(Number(quality)) ? Math.max(10, Math.min(100, Math.round(Number(quality)))) : 80;
  return `${root}/proxy/Items/Images/Primary/?id=${encodeURIComponent(id)}&fillWidth=${fillWidth}&quality=${imageQuality}`;
}

module.exports = {
  trimBase,
  looksLikeHttpUrl,
  configuredPublicBase,
  resolvePublicBase,
  absoluteUrl,
  itemHref,
  requestsHref,
  statusPageHref,
  posterSrc,
};

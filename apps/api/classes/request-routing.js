// Smart request routing: ordered rules that decide whether a request made through JellyGlance
// is approved straight into Sonarr/Radarr (via Seerr) or held for manual review.
// The first enabled rule that matches wins. Unmatched requests keep the existing
// per-person / auto-approve-everyone behaviour, which holds by default.

const ACTIONS = new Set(["approve", "hold"]);
const MEDIA_TYPES = new Set(["any", "movie", "tv"]);
const MAX_ROUTES = 50;

function cleanList(value, max = 50) {
  const list = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  return [...new Set(list.map((item) => String(item ?? "").trim()).filter(Boolean))].slice(0, max);
}

function normalizeRoute(route = {}, index = 0) {
  const id = String(route.id || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40) || `route-${index + 1}`;
  return {
    id,
    name: String(route.name || "").trim().slice(0, 80) || `Rule ${index + 1}`,
    enabled: route.enabled !== false,
    users: cleanList(route.users),
    genres: cleanList(route.genres),
    mediaType: MEDIA_TYPES.has(route.mediaType) ? route.mediaType : "any",
    action: ACTIONS.has(route.action) ? route.action : "hold",
  };
}

function normalizeRoutes(routes) {
  if (!Array.isArray(routes)) return [];
  const seen = new Set();
  return routes.slice(0, MAX_ROUTES).map((route, index) => {
    const next = normalizeRoute(route, index);
    while (seen.has(next.id)) next.id = `${next.id}-${index}`;
    seen.add(next.id);
    return next;
  });
}

const lower = (value) => String(value || "").trim().toLowerCase();

// Pure: does this route match the request context?
// ctx = { userKey, mediaType: "movie"|"tv", genres: string[] }
function routeMatches(route, ctx = {}) {
  if (!route || route.enabled === false) return false;
  if (route.mediaType && route.mediaType !== "any" && route.mediaType !== ctx.mediaType) return false;
  if (route.users?.length && !route.users.includes(String(ctx.userKey || ""))) return false;
  if (route.genres?.length) {
    const wanted = new Set(route.genres.map(lower));
    if (!(ctx.genres || []).some((genre) => wanted.has(lower(genre)))) return false;
  }
  // A rule with no user, genre or type condition would match everything; treat it as a catch-all.
  return true;
}

// Pure: returns { action: "approve"|"hold"|null, route } — null means no rule matched.
function decide(routes, ctx) {
  for (const route of routes || []) {
    if (routeMatches(route, ctx)) return { action: route.action, route };
  }
  return { action: null, route: null };
}

module.exports = { normalizeRoute, normalizeRoutes, routeMatches, decide, MAX_ROUTES };

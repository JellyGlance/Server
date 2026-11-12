// Numbers for the Requests stats tab, computed from the normalized request list.
// Pure: no I/O, so the route only has to hand over the (already user-filtered) requests.
const DAY_MS = 86400000;
const WINDOWS = [7, 30, 90, 0]; // days; 0 = everything Seerr still holds

const stamp = (value) => {
  const time = Date.parse(value || "");
  return Number.isFinite(time) ? time : null;
};

function resolveWindow(days) {
  const value = Number(days);
  return WINDOWS.includes(value) ? value : 30;
}

function topN(counts, limit, total) {
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
    .slice(0, limit)
    .map(([name, count]) => ({ name, count, share: total ? Math.round((count / total) * 1000) / 10 : 0 }));
}

// When a request counts as fulfilled: the library picked it up (mediaAddedAt), else the
// last media update. Only Available requests with a sane, non-negative gap are used.
function fulfilMs(request) {
  if (request?.status !== "Available") return null;
  const asked = stamp(request.createdAt);
  const done = stamp(request.mediaAddedAt) ?? stamp(request.mediaUpdatedAt);
  if (asked == null || done == null || done < asked) return null;
  return done - asked;
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function buildRequestInsights(requests, { days = 30, now = Date.now() } = {}) {
  const window = resolveWindow(days);
  const since = window ? now - window * DAY_MS : null;
  const list = (Array.isArray(requests) ? requests : []).filter((request) => {
    if (since == null) return true;
    const asked = stamp(request?.createdAt);
    return asked != null && asked >= since;
  });

  const genres = new Map();
  const requesters = new Map();
  const types = { movie: 0, tv: 0 };
  const counts = { available: 0, failed: 0, declined: 0, waiting: 0, pending: 0 };
  const gaps = [];
  for (const request of list) {
    for (const genre of new Set((request.genres || []).filter(Boolean))) genres.set(genre, (genres.get(genre) || 0) + 1);
    const who = request.requestedBy || request.requester?.name || "Unknown";
    requesters.set(who, (requesters.get(who) || 0) + 1);
    const type = String(request.mediaType || "").toLowerCase().startsWith("tv") ? "tv" : "movie";
    types[type] += 1;
    if (request.status === "Available") counts.available += 1;
    else if (request.status === "Failed") counts.failed += 1;
    else if (request.status === "Declined") counts.declined += 1;
    else if (request.status === "Pending") counts.pending += 1;
    else counts.waiting += 1;
    const gap = fulfilMs(request);
    if (gap != null) gaps.push(gap);
  }

  // Success = how many of the requests that reached an outcome ended up in the library.
  // Declined is a decision, not a failure, and still-waiting requests have no outcome yet.
  const outcomes = counts.available + counts.failed;
  const busiest = topN(requesters, 5, list.length);
  return {
    windowDays: window,
    generatedAt: new Date(now).toISOString(),
    total: list.length,
    types,
    counts,
    topGenres: topN(genres, 6, list.length),
    fulfil: {
      samples: gaps.length,
      averageMs: gaps.length ? Math.round(gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length) : null,
      medianMs: median(gaps),
    },
    success: { rate: outcomes ? Math.round((counts.available / outcomes) * 1000) / 10 : null, available: counts.available, failed: counts.failed },
    busiest: busiest[0] || null,
    requesters: busiest,
  };
}

module.exports = { buildRequestInsights, resolveWindow, fulfilMs, WINDOWS };

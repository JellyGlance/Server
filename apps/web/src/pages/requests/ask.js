// Ask Blobbo, for requests. This is keyword matching, not a language model: there is no
// model in JellyGlance, so questions are sorted into a few intents (request, stuck, status,
// stats, pending) and answered from data the page already has or from read-only endpoints.
// Anything else goes to the regular Blobbo helper. Pure functions only; the component does the fetching.
import { requestStatusChip } from "./status.js";

export const ENGINE = {
  key: "keywords",
  label: "Keyword matching",
  note: "Blobbo matches keywords to read-only data. No language model is set up on this server, so it won\u2019t understand free-form questions.",
};

export const STARTERS = ["What\u2019s stuck?", "Any pending requests?", "Request stats", "Get me the new Dune film"];

const norm = (text) =>
  ` ${String(text || "")
    .toLowerCase()
    .replace(/[\u2019'`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()} `;

const has = (q, words) => words.some((word) => q.includes(` ${word} `) || (word.endsWith("*") && q.includes(` ${word.slice(0, -1)}`)));

const LEAD = /^ ?(?:(?:can|could|would) you |please |blobbo |hey |hi |i would like to |id like to |i want to |i wanna |lets )*(?:get me|grab me|find me|request|add|download|i want(?: to)?|id like(?: to)?|i need(?: to)?|queue up|fetch|put in a request for|ask for)( an?| the| some)? /;
const FILLER = /\b(?:new|latest|newest|recent|film|films|movie|movies|show|shows|series|tv|title|please|for me|by|from|directed|watch|see)\b/g;

// "get me the new Nolan film" -> { query: "nolan", preferNew: true }
export function extractRequestQuery(question) {
  let q = norm(question);
  const preferNew = / (new|latest|newest|recent) /.test(q);
  q = q.replace(LEAD, " ").replace(FILLER, " ").replace(/\s+/g, " ").trim();
  return { query: q, preferNew };
}

// Which question is it? stuck / status / stats / pending / request, or null for "not about requests".
export function parseIntent(question) {
  const q = norm(question);
  if (!q.trim()) return { intent: null };
  if (has(q, ["stuck", "stalled", "failing", "failed", "not downloading", "not working", "taking ages", "taking forever", "problem*", "broken", "wrong"]) && !has(q, ["request stats"])) return { intent: "stuck" };
  if (has(q, ["stats", "statistics", "busiest", "most requested", "average time", "success rate", "how fast", "how long do", "how many requests", "who requests", "insights"])) return { intent: "stats" };
  if (has(q, ["pending", "waiting for approval", "need approval", "needs approval", "awaiting", "to approve", "unapproved"])) return { intent: "pending" };
  const status = q.match(/ (?:status of|whats happening with|where is|wheres|how is|how are|is|are|has|have|did) (?:the )?(.+?)(?: (?:available|ready|downloaded|downloading|done|yet|requested|come in|arrived|here))* $/);
  if (status && has(q, ["status", "available", "ready", "downloaded", "downloading", "downloaded yet", "arrived", "come in", "whats happening", "where is", "wheres", "how is"])) {
    const query = status[1].replace(FILLER, " ").replace(/\s+/g, " ").trim();
    if (query.length >= 2) return { intent: "status", query };
  }
  if (LEAD.test(q) || has(q, ["request*", "get me", "grab me", "i want", "id like", "i need"])) {
    const { query, preferNew } = extractRequestQuery(question);
    return { intent: "request", query, preferNew };
  }
  return { intent: null };
}

const DAY = 86400000;

// Requests that look stuck: failed, waiting on a stalled or failed download, or approved a
// while ago and still not in the library.
export function stuckRequests(requests, progressItems = {}, now = Date.now(), staleDays = 2) {
  const out = [];
  for (const request of requests || []) {
    const chip = requestStatusChip(request);
    const entry = progressItems[request.id];
    let reason = "";
    let rank = 9;
    if (chip.key === "failed") {
      reason = "Failed";
      rank = 0;
    } else if (entry && (entry.state === "failed" || entry.state === "stalled")) {
      reason = entry.state === "failed" ? "Download failed" : "Download stalled";
      rank = 1;
    } else if ((chip.key === "approved" || chip.key === "processing" || chip.key === "partial") && request.status !== "Available") {
      const asked = Date.parse(request.createdAt || "");
      const days = Number.isFinite(asked) ? Math.floor((now - asked) / DAY) : 0;
      if (days >= staleDays) {
        reason = `Waiting ${days} days`;
        rank = 2;
      }
    }
    if (reason) out.push({ request, reason, rank });
  }
  return out.sort((a, b) => a.rank - b.rank || Date.parse(a.request.createdAt || 0) - Date.parse(b.request.createdAt || 0));
}

export function pendingRequests(requests) {
  return (requests || []).filter((request) => requestStatusChip(request).key === "pending");
}

// Queue titles matching what was asked about (all words must appear).
export function findRequests(requests, query) {
  const words = norm(query).trim().split(" ").filter(Boolean);
  if (!words.length) return [];
  return (requests || []).filter((request) => {
    const title = norm(request.title);
    return words.every((word) => title.includes(word));
  });
}

// One line on where a request is up to.
export function describeRequest(request, entry) {
  const chip = requestStatusChip(request);
  const parts = [chip.label];
  if (entry && chip.key !== "available") {
    if (entry.state === "downloading") parts.push(`downloading ${Math.round(entry.progress || 0)}%${entry.etaLabel ? `, ${entry.etaLabel} left` : ""}`);
    else if (entry.state === "queued") parts.push("queued to download");
    else if (entry.state === "stalled") parts.push("download stalled");
    else if (entry.state === "failed") parts.push("download failed");
    else if (entry.state === "paused") parts.push("download paused");
  }
  if (request.availability?.status === "Available" && chip.key !== "available") parts.push("in library");
  if (request.requestedBy) parts.push(`requested by ${request.requestedBy}`);
  return parts.join(" \u00b7 ");
}

// Search hits best first: newest release first when they said "new", otherwise by popularity.
export function rankSuggestions(results, { preferNew = false, max = 4 } = {}) {
  const list = (Array.isArray(results) ? results : []).filter((item) => item && item.title);
  const score = (item) => (preferNew ? Date.parse(item.releaseDate || "") || 0 : Number(item.popularity || 0));
  const released = preferNew ? list.filter((item) => (Date.parse(item.releaseDate || "") || 0) <= Date.now() + 90 * DAY) : list;
  return [...(released.length ? released : list)].sort((a, b) => score(b) - score(a)).slice(0, max);
}

// "In library", "Already requested" or "Not requested", from a search hit.
export function suggestionState(item) {
  if (item.availability === "Available") return { key: "available", label: "In library" };
  if (item.requested) return { key: "requested", label: "Already requested" };
  return { key: "open", label: "Not requested yet" };
}

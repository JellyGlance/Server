// Request status chips and the queue filter row. Pure, so it is easy to test.
export const REQUEST_CHIPS = {
  pending: "Pending",
  approved: "Approved",
  processing: "Processing",
  partial: "Partial",
  available: "Available",
  declined: "Declined",
  failed: "Failed",
};

export function requestStatusChip(request) {
  const status = String(request?.status || "").trim().toLowerCase();
  const stage = String(request?.pipelineStatus || "").trim().toLowerCase();
  let key = "pending";
  if (status === "failed" || status === "error") key = "failed";
  else if (status === "declined" || status === "rejected") key = "declined";
  else if (status === "available") key = "available";
  else if (status.includes("partial")) key = "partial";
  else if (status === "processing" || (status === "approved" && stage === "grabbed")) key = "processing";
  else if (status === "approved") key = "approved";
  return { key, label: REQUEST_CHIPS[key] };
}

// One filter row for the queue. "Processing" also covers partially available titles;
// "progress" (the summary tile) is Approved plus Processing.
export const REQUEST_FILTERS = [
  { id: "all", label: "All" },
  { id: "pending", label: "Pending" },
  { id: "approved", label: "Approved" },
  { id: "processing", label: "Processing" },
  { id: "available", label: "Available" },
  { id: "declined", label: "Declined" },
  { id: "failed", label: "Failed" },
];

export function matchesRequestFilter(request, filter) {
  if (!filter || filter === "all") return true;
  const key = requestStatusChip(request).key;
  if (filter === "processing") return key === "processing" || key === "partial";
  if (filter === "progress") return key === "approved" || key === "processing" || key === "partial";
  return key === filter;
}

// Tab keys the page understands, and older or alternative spellings that map onto them.
export const REQUEST_TABS = ["queue", "discover", "calendar", "stats", "ask", "issues"];
const TAB_ALIASES = {
  queue: "queue", requests: "queue", request: "queue", list: "queue", all: "queue", home: "queue", overview: "queue", pending: "queue",
  discover: "discover", discovery: "discover", browse: "discover", explore: "discover", search: "discover",
  calendar: "calendar", schedule: "calendar", upcoming: "calendar", week: "calendar", arriving: "calendar",
  stats: "stats", statistics: "stats", insights: "stats", numbers: "stats", analytics: "stats",
  ask: "ask", blobbo: "ask", assistant: "ask", help: "ask",
  issues: "issues", issue: "issues", problems: "issues", reports: "issues",
};

// Reads ?tab=, then ?section= / ?view=, then #hash. Anything unknown is the queue.
export function normalizeRequestTab(search = "", hash = "") {
  const params = new URLSearchParams(search);
  const candidates = [params.get("tab"), params.get("section"), params.get("view"), String(hash || "").replace(/^#\/?/, "")];
  for (const value of candidates) {
    const key = String(value || "").trim().toLowerCase();
    if (TAB_ALIASES[key]) return TAB_ALIASES[key];
  }
  return "queue";
}

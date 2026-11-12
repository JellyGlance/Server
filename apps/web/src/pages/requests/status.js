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

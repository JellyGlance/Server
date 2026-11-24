// Helpers for selecting several requests and acting on them together.
import { requestStatusChip } from "./status.js";

export const BULK_ACTIONS = [
  { key: "approve", label: "Approve", past: "approved" },
  { key: "decline", label: "Decline", past: "declined" },
  { key: "retry", label: "Retry", past: "retried" },
];

// Only requests waiting for a decision (approve or decline) or that failed (retry) can be picked.
export function isSelectable(request) {
  if (!request?.requestId || !request?.sourceId) return false;
  const key = requestStatusChip(request).key;
  return key === "pending" || key === "failed";
}

// Which requests an action applies to: approve and decline to pending ones, retry to failed ones.
export function appliesTo(action, request) {
  const key = requestStatusChip(request).key;
  return action === "retry" ? key === "failed" : key === "pending";
}

// Per action, the selected requests it would change. Actions with none are left out.
export function actionPlan(selected) {
  const plan = {};
  for (const { key } of BULK_ACTIONS) {
    const items = (selected || []).filter((request) => appliesTo(key, request));
    if (items.length) plan[key] = items;
  }
  return plan;
}

// What the API takes: id and source, plus what the retry needs to find the title in the *arr apps.
export function bulkPayload(action, requests) {
  return {
    action,
    items: requests.map((request) => ({
      requestId: String(request.requestId),
      sourceId: request.sourceId,
      title: request.title,
      mediaType: request.mediaType,
      tmdb: request.externalIds?.tmdbId || request.tmdbId || request.tmdb || undefined,
      tvdb: request.externalIds?.tvdbId || request.tvdbId || request.tvdb || undefined,
    })),
  };
}

// "3 approved" / "2 approved, 1 failed" / "Nothing changed (2 failed)".
export function resultSummary(result) {
  if (!result) return "";
  const meta = BULK_ACTIONS.find((entry) => entry.key === result.action);
  const past = meta?.past || result.action;
  if (!result.failed) return `${result.succeeded} ${past}`;
  if (!result.succeeded) return `Nothing changed (${result.failed} failed)`;
  return `${result.succeeded} ${past}, ${result.failed} failed`;
}

// Selection survives a refresh only for requests that are still selectable.
export function pruneSelection(selectedIds, requests) {
  const live = new Set((requests || []).filter(isSelectable).map((request) => request.id));
  return new Set([...selectedIds].filter((id) => live.has(id)));
}

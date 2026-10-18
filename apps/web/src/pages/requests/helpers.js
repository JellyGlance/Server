import i18n from "i18next";
import { formatDate as formatLocaleDate } from "../../lib/format-date";

export function formatDate(value) {
  return formatLocaleDate(value, {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }, { fallback: i18n.t("FEATURES.REQUESTS.UNKNOWN") });
}

export function getRequestAge(value) {
  const createdAt = value ? new Date(value).getTime() : 0;
  if (!createdAt) return { label: i18n.t("FEATURES.REQUESTS.UNKNOWN_AGE"), level: "unknown", hours: 0 };

  const hours = Math.max(0, Math.floor((Date.now() - createdAt) / 3600000));
  if (hours >= 168) return { label: i18n.t("FEATURES.REQUESTS.AGE_DAYS", { count: Math.floor(hours / 24) }), level: "week", hours };
  if (hours >= 24) return { label: i18n.t("FEATURES.REQUESTS.AGE_DAYS", { count: Math.floor(hours / 24) }), level: "day", hours };
  if (hours >= 1) return { label: i18n.t("FEATURES.REQUESTS.AGE_HOURS", { count: hours }), level: "fresh", hours };
  return { label: i18n.t("FEATURES.REQUESTS.NEW"), level: "fresh", hours };
}

export function formatPercentScore(value) {
  const score = Number(value);
  if (!Number.isFinite(score)) return "";
  return `${Math.round(score > 10 ? score : score * 10)}%`;
}

export function formatTenPointScore(value) {
  const score = Number(value);
  if (!Number.isFinite(score)) return "";
  return score > 10 ? (score / 10).toFixed(1) : score.toFixed(1);
}

export function hasRatingValue(value) {
  const score = Number(value);
  return Number.isFinite(score) && score > 0;
}

export function getRequesterName(request) {
  return request?.requester?.name || request?.requestedBy || i18n.t("FEATURES.REQUESTS.UNKNOWN_USER");
}

export function normalizeOwnerValue(value) {
  return String(value || "").trim().toLowerCase();
}

export function getCurrentRequestOwnerCandidates(config = {}) {
  const auth = config.settings?.auth || {};
  const jellyfinUser = auth.jellyfinUser || {};
  return [
    config.username,
    auth.username,
    auth.email,
    jellyfinUser.id,
    jellyfinUser.Id,
    jellyfinUser.name,
    jellyfinUser.Name,
    jellyfinUser.username,
    jellyfinUser.UserName,
  ]
    .map(normalizeOwnerValue)
    .filter(Boolean);
}

export function isOwnRequest(request, ownerCandidates = []) {
  if (!ownerCandidates.length) return false;
  const requester = request?.requester || {};
  return [
    request?.requestedBy,
    requester.id,
    requester.userId,
    requester.jellyfinUserId,
    requester.name,
    requester.username,
    requester.email,
  ]
    .map(normalizeOwnerValue)
    .filter(Boolean)
    .some((candidate) => ownerCandidates.includes(candidate));
}

export function getInitials(value) {
  return (
    String(value || "?")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "?"
  );
}

export function getRequesterAvatarUrl(request) {
  const requester = request?.requester || {};
  if (requester.jellyfinUserId) {
    return `/proxy/Users/Images/Primary?id=${encodeURIComponent(requester.jellyfinUserId)}&fillWidth=96&quality=80`;
  }
  return requester.avatar && /^https?:\/\//i.test(requester.avatar) ? requester.avatar : "";
}

export const PIPELINE_FILTERS = [
  { id: "all", label: "All stages" },
  { id: "requested", label: "Requested" },
  { id: "approved", label: "Approved" },
  { id: "grabbed", label: "Grabbed" },
  { id: "available", label: "Available" },
  { id: "declined", label: "Declined" },
];

export function matchesPipelineFilter(request, pipelineFilter) {
  if (!pipelineFilter || pipelineFilter === "all") return true;
  return String(request?.pipelineStatus || "").toLowerCase() === pipelineFilter;
}

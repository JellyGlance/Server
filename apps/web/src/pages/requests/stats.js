// Display helpers for the Requests stats tab.
export const STAT_WINDOWS = [
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
  { days: 0, label: "All time" },
];

// 45 s -> "under a minute", 12 min, 3h 12m, 2d 4h.
export function durationLabel(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "\u2014";
  const minutes = Math.round(ms / 60000);
  if (minutes < 1) return "under a minute";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

export function percentLabel(value) {
  return Number.isFinite(value) ? `${Number.isInteger(value) ? value : value.toFixed(1)}%` : "\u2014";
}

// Bar width for a row, as a share of the biggest one (never invisible when there is a count).
export function barShare(count, max) {
  if (!(count > 0) || !(max > 0)) return 0;
  return Math.max(4, Math.round((count / max) * 100));
}

// The four headline figures, ready to show.
export function headlineTiles(stats) {
  if (!stats) return [];
  const fulfil = stats.fulfil || {};
  const success = stats.success || {};
  return [
    {
      key: "fulfil",
      label: "Average time to fulfil",
      value: durationLabel(fulfil.averageMs),
      hint: fulfil.samples ? `Median ${durationLabel(fulfil.medianMs)}` : "Nothing fulfilled yet",
      title: fulfil.samples ? `Median ${durationLabel(fulfil.medianMs)}, from ${fulfil.samples} fulfilled request${fulfil.samples === 1 ? "" : "s"}` : "",
    },
    {
      key: "success",
      label: "Success rate",
      value: percentLabel(success.rate),
      hint: success.rate == null ? "No finished requests yet" : `${success.available} in library \u00b7 ${success.failed} failed`,
    },
    {
      key: "busiest",
      label: "Busiest requester",
      value: stats.busiest?.name || "\u2014",
      hint: stats.busiest ? `${stats.busiest.count} request${stats.busiest.count === 1 ? "" : "s"} \u00b7 ${percentLabel(stats.busiest.share)}` : "No requests yet",
    },
    {
      key: "total",
      label: "Requests",
      value: String(stats.total ?? 0),
      hint: `${stats.types?.movie ?? 0} movies \u00b7 ${stats.types?.tv ?? 0} TV`,
    },
  ];
}

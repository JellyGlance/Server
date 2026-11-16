// Download progress for a request row: the label, tone and bar width. Pure, so it is
// easy to test. `entry` is one item of GET /api/requests/progress.
export const BAR_WIDTH = 64;

const TONES = {
  downloading: "downloading",
  importing: "downloading",
  queued: "queued",
  paused: "paused",
  stalled: "stalled",
  failed: "failed",
};

export function progressPercent(entry) {
  const value = Math.round(Number(entry?.progress));
  return Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 0;
}

// Whole pixels, never a fractional fill.
export function fillWidth(entry, barWidth = BAR_WIDTH) {
  return Math.round((barWidth * progressPercent(entry)) / 100);
}

export function progressView(entry) {
  const pct = progressPercent(entry);
  const state = String(entry?.state || "downloading");
  const tone = TONES[state] || "downloading";
  let label;
  if (state === "queued") label = "Queued";
  else if (state === "importing") label = "Importing";
  else if (state === "failed") label = "Failed";
  else if (state === "paused") label = `Paused \u00b7 ${pct}%`;
  else if (state === "stalled") label = `Stalled \u00b7 ${pct}%`;
  else label = entry?.etaLabel ? `${pct}% \u00b7 ${entry.etaLabel}` : `${pct}%`;
  const via = [entry?.source, entry?.client && entry.client !== entry.source ? `via ${entry.client}` : ""].filter(Boolean).join(" ");
  const episodes = entry?.count > 1 ? `${entry.count} items${entry.episodes?.length ? ` (${entry.episodes.join(", ")}${entry.count > entry.episodes.length ? ", \u2026" : ""})` : ""}` : entry?.episodes?.[0] || "";
  const title = [
    via,
    state === "downloading" ? `${pct}% done` : label,
    state === "downloading" && entry?.etaLabel ? `${entry.etaLabel} left` : "",
    entry?.speed || "",
    episodes,
    entry?.error || "",
    entry?.simulated ? "Demo data (simulated)" : "",
  ]
    .filter(Boolean)
    .join(" \u00b7 ");
  return { pct, tone, label, title, indeterminate: state === "queued" };
}

export function hasActiveProgress(items) {
  return Object.keys(items || {}).length > 0;
}

// Read-only upcoming titles from the Arr calendar (Sonarr and Radarr) plus
// Seerr request dates, for the next N days. Never writes to Arr or Seerr.
const calendar = require("./request-calendar");
const seerr = require("./newsletter-seerr-requests");

function dateLabel(date, today, t) {
  if (date === today) return t ? t("TODAY") : "Today";
  const tomorrow = calendar.addDays(today, 1);
  if (date === tomorrow) return t ? t("TOMORROW") : "Tomorrow";
  return date;
}

function asItem(entry) {
  return {
    Id: entry.jellyfinId || "",
    id: entry.jellyfinId || entry.id || "",
    Name: entry.title || entry.Name || "",
    Type: entry.mediaType === "tv" || entry.Type === "Series" ? "Series" : "Movie",
    requestId: String(entry.requestId || "").startsWith("arr:") ? "" : entry.requestId || "",
    date: entry.date,
    kind: entry.kind || "",
    label: entry.label || "",
    source: entry.source || "",
    episodeTitle: entry.episodeTitle || "",
  };
}

async function listComingSoon({ days = 7, limit = 12, userName = "", now = new Date(), includeUnrequested = true } = {}) {
  const windowDays = Math.min(calendar.MAX_DAYS, Math.max(1, Number(days) || 7));
  const requests = await seerr.fetchLiteSeerrRequests({ userName, take: 100 }).catch(() => []);
  const result = await calendar.getCalendar(requests, { days: windowDays, includeUnrequested: includeUnrequested && !userName });
  const today = calendar.todayKey(now);
  const items = [];
  for (const day of result.days || []) {
    for (const entry of day.items || []) items.push(asItem(entry));
  }
  return { days: windowDays, from: result.from, to: result.to, items: items.slice(0, limit), today };
}

module.exports = { listComingSoon, dateLabel, asItem };

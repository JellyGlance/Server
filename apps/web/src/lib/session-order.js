// Jellyfin returns /Sessions ordered by last activity, so the order changes every
// time a client reports progress. Keep Active Sessions in a fixed order so cards
// and wall tiles stay where they are between updates.
function sessionSortKey(session) {
  return String(session?.Id ?? "").padStart(12, "0");
}

export function orderSessions(sessions) {
  if (!Array.isArray(sessions)) return [];
  return [...sessions].sort((a, b) => sessionSortKey(a).localeCompare(sessionSortKey(b)));
}

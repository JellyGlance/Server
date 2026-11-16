// Deep links for the Libraries page tabs. A missing or unknown ?tab= value
// falls back to the library list (overview), same idea as Requests.
export const LIBRARY_TABS = ["overview", "storage", "forecast"];

export function normalizeLibraryTab(search = "") {
  const key = String(new URLSearchParams(search).get("tab") || "")
    .trim()
    .toLowerCase();
  return LIBRARY_TABS.includes(key) ? key : "overview";
}

// Grouping, filtering and sorting for the Jellyfin Plugins settings page.
//
// Jellyfin keeps an older copy of a plugin's folder after an update and reports
// both copies under the same GUID (the newer one "Active", the older one
// "Superceded"), so the page shows one card per plugin with its other versions.

export const PLUGIN_STATUS = {
  Active: { label: "Enabled", cls: "is-active", rank: 6, hint: "Loaded and running." },
  Restart: { label: "Needs restart", cls: "is-restart", rank: 2, hint: "Installed or updated. Restart Jellyfin to load it." },
  Malfunctioned: { label: "Error", cls: "is-malfunctioned", rank: 0, hint: "Jellyfin failed to load this plugin. Check the server log." },
  NotSupported: { label: "Unsupported", cls: "is-notsupported", rank: 1, hint: "Built for a different Jellyfin version (targetAbi mismatch)." },
  // Jellyfin's enum is spelt "Superceded"; the UI uses the correct spelling.
  Superceded: { label: "Superseded", cls: "is-superceded", rank: 4, hint: "A newer copy of this plugin is loaded instead." },
  Disabled: { label: "Disabled", cls: "is-disabled", rank: 5, hint: "Turned off in the Jellyfin dashboard." },
  Deleted: { label: "Pending removal", cls: "is-deleted", rank: 3, hint: "Uninstalled. Removed on next Jellyfin restart." },
};

// Shown for a status this page doesn't know, so it isn't mistaken for Enabled.
export const UNKNOWN_PLUGIN_STATUS = {
  label: "Unknown",
  cls: "is-unknown",
  rank: 3,
  hint: "Jellyfin reported a status JellyGlance doesn't recognise.",
};

// A missing status means Active (older servers don't send one).
export function pluginStatus(status) {
  if (!status) return PLUGIN_STATUS.Active;
  return PLUGIN_STATUS[status] || UNKNOWN_PLUGIN_STATUS;
}

export function comparePluginVersions(a = "", b = "") {
  const left = String(a).split(/[.-]/).map((part) => parseInt(part, 10) || 0);
  const right = String(b).split(/[.-]/).map((part) => parseInt(part, 10) || 0);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] || 0) - (right[index] || 0);
    if (difference) return difference;
  }
  return 0;
}

// "Intro Skipper" -> IS, "JellyTag" -> JT, "TMDb" -> TM, "Trakt" -> Tr.
export function pluginInitials(name = "") {
  const words = String(name).replace(/[^A-Za-z0-9 ]+/g, " ").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "";
  if (words.length > 1) return (words[0][0] + words[1][0]).toUpperCase();
  const capitals = words[0].match(/[A-Z0-9]/g) || [];
  if (capitals.length >= 2) return (capitals[0] + capitals[1]).toUpperCase();
  return words[0].slice(0, 2).replace(/^./, (letter) => letter.toUpperCase());
}

function pluginGroupKey(plugin) {
  return String(plugin.id || plugin.name || "")
    .replace(/[{}-]/g, "")
    .toLowerCase();
}

export function groupJellyfinPlugins(plugins = []) {
  const groups = new Map();
  plugins.forEach((plugin) => {
    const key = pluginGroupKey(plugin);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(plugin);
  });
  return [...groups.entries()].map(([key, members]) => {
    const sorted = [...members].sort((a, b) => comparePluginVersions(b.version, a.version));
    const primary = sorted.find((member) => member.status === "Active") || sorted[0];
    const others = sorted.filter((member) => member !== primary);
    const describedBy = primary.description ? primary : others.find((member) => member.description);
    return {
      ...primary,
      description: describedBy?.description || "",
      descriptionSource: describedBy?.descriptionSource || "",
      owner: primary.owner || others.find((member) => member.owner)?.owner || "",
      key,
      others,
      members: sorted,
    };
  });
}

const hasMemberStatus = (group, statuses) => group.members.some((member) => statuses.includes(member.status));

export const PLUGIN_FILTERS = [
  { id: "all", label: "All", test: () => true },
  { id: "enabled", label: "Enabled", test: (group) => group.status === "Active" },
  { id: "disabled", label: "Disabled", test: (group) => group.status === "Disabled" },
  {
    id: "restart",
    label: "Needs restart",
    test: (group) => group.status === "Restart" || group.status === "Deleted" || hasMemberStatus(group, ["Restart"]),
  },
  { id: "issues", label: "Issues", test: (group) => hasMemberStatus(group, ["Malfunctioned", "NotSupported"]) },
  { id: "duplicates", label: "Duplicates", test: (group) => group.members.length > 1 },
];

const compareNames = (a, b) => String(a.name).localeCompare(String(b.name), undefined, { sensitivity: "base" });

export const PLUGIN_SORTS = [
  { id: "name", label: "Name A–Z", compare: compareNames },
  {
    id: "status",
    label: "Status (issues first)",
    compare: (a, b) => pluginStatus(a.status).rank - pluginStatus(b.status).rank || compareNames(a, b),
  },
  { id: "version", label: "Version (newest first)", compare: (a, b) => comparePluginVersions(b.version, a.version) || compareNames(a, b) },
];

export function findPluginFilter(id) {
  return PLUGIN_FILTERS.find((filter) => filter.id === id) || PLUGIN_FILTERS[0];
}

export function findPluginSort(id) {
  return PLUGIN_SORTS.find((sort) => sort.id === id) || PLUGIN_SORTS[0];
}

// Matches the name, description, owner and every member version.
export function searchPluginGroups(groups = [], query = "") {
  const needle = String(query).trim().toLowerCase();
  if (!needle) return groups;
  return groups.filter((group) =>
    [group.name, group.description, group.owner, ...group.members.map((member) => member.version)].join(" ").toLowerCase().includes(needle)
  );
}

export function countPluginFilters(groups = []) {
  return Object.fromEntries(PLUGIN_FILTERS.map((filter) => [filter.id, groups.filter(filter.test).length]));
}

export function visiblePluginGroups(groups = [], filterId = "all", sortId = "name") {
  return groups.filter(findPluginFilter(filterId).test).sort(findPluginSort(sortId).compare);
}

export function pluginVersionsLabel(group) {
  if (group.members.length < 2) return "";
  return `v${group.version} + ${group.others.map((other) => other.version).join(", ")} · ${group.members.length} versions`;
}

// Installed plugins for the Jellyfin Plugins settings page.
//
// Jellyfin's /Plugins list (PluginInfo) is joined with the repository manifests
// from /Packages (PackageInfo), which carry the description, overview, owner and
// category that PluginInfo usually leaves empty. Jellyfin's Status enum is the
// only source of truth for a plugin's state: PluginInfo has no Enabled field, so
// only "Active" counts as enabled.

function normalizeGuid(value) {
  return String(value || "")
    .replace(/[{}-]/g, "")
    .toLowerCase();
}

function matchJellyfinPluginPackage(plugin, packages = []) {
  const pluginId = normalizeGuid(plugin.Id || plugin.Guid || plugin.id);
  const pluginName = String(plugin.Name || plugin.name || "").trim().toLowerCase();
  return (
    packages.find((entry) => pluginId && pluginId === normalizeGuid(entry.guid || entry.Guid || entry.id)) ||
    packages.find((entry) => pluginName && pluginName === String(entry.name || entry.Name || "").trim().toLowerCase())
  );
}

function buildPluginImageProxyUrl(imageUrl) {
  return imageUrl ? `/proxy/Plugins/Images/?url=${encodeURIComponent(imageUrl)}` : "";
}

// Jellyfin serves a plugin's own image at /Plugins/{id}/{version}/Image. Repository
// image URLs are only a fallback, because the proxy only fetches same-origin URLs.
function buildJellyfinPluginImageUrl(plugin = {}, packageInfo = null) {
  if (plugin.HasImage === true && plugin.Id && plugin.Version) {
    return `/proxy/Plugins/Images/?id=${encodeURIComponent(plugin.Id)}&version=${encodeURIComponent(plugin.Version)}`;
  }
  return buildPluginImageProxyUrl(packageInfo?.imageUrl || packageInfo?.ImageUrl || plugin.ImageUrl || plugin.imageUrl);
}

// Jellyfin plugin versions are System.Version strings such as 10.8.4.0.
const PLUGIN_VERSION_PATTERN = /^\d+(?:\.\d+){0,3}$/;

// Candidate Jellyfin URLs for GET /proxy/Plugins/Images/?id=&version=. The
// versioned endpoint is tried first; the others are kept for older servers.
function pluginImageCandidates(jellyfinHost, id, version) {
  const encodedId = encodeURIComponent(id);
  const hasVersion = typeof version === "string" && PLUGIN_VERSION_PATTERN.test(version);
  return [
    ...(hasVersion ? [`${jellyfinHost}/Plugins/${encodedId}/${version}/Image`] : []),
    `${jellyfinHost}/Plugins/${encodedId}/Image`,
    `${jellyfinHost}/Plugins/${encodedId}/Images/Primary`,
    `${jellyfinHost}/Plugins/${encodedId}/Thumb`,
  ];
}

function normalizeJellyfinPlugin(plugin = {}, packageInfo = null) {
  const status = plugin.Status || plugin.State || (plugin.Enabled === false ? "Disabled" : "Active");
  const id = plugin.Id || plugin.Guid || plugin.Name;
  const jellyfinDescription = plugin.Description || plugin.Overview || "";
  const repositoryDescription = packageInfo?.description || packageInfo?.overview || "";
  return {
    id,
    name: plugin.Name || plugin.AssemblyFileName || "Unknown plugin",
    version: plugin.Version || plugin.Versions?.[0]?.version || "",
    description: jellyfinDescription || repositoryDescription,
    descriptionSource: jellyfinDescription ? "jellyfin" : repositoryDescription ? "repository" : "",
    owner: packageInfo?.owner || "",
    category: plugin.Category || packageInfo?.category || "",
    status,
    enabled: status === "Active",
    canUninstall: plugin.CanUninstall === true,
    hasImage: plugin.HasImage === true,
    configurationFileName: plugin.ConfigurationFileName || "",
    imageUrl: buildJellyfinPluginImageUrl(plugin, packageInfo),
  };
}

function buildJellyfinPluginsResponse(plugins = [], packages = []) {
  const normalizedPlugins = plugins.map((plugin) => normalizeJellyfinPlugin(plugin, matchJellyfinPluginPackage(plugin, packages)));
  return {
    plugins: normalizedPlugins.sort((a, b) => a.name.localeCompare(b.name)),
    total: plugins.length,
    enabled: normalizedPlugins.filter((plugin) => plugin.enabled).length,
  };
}

module.exports = {
  normalizeGuid,
  matchJellyfinPluginPackage,
  buildPluginImageProxyUrl,
  buildJellyfinPluginImageUrl,
  pluginImageCandidates,
  normalizeJellyfinPlugin,
  buildJellyfinPluginsResponse,
};

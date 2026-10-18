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

function getJellyfinOrigin(config) {
  if (!config?.JF_HOST) {
    return null;
  }

  try {
    const hostUrl = new URL(config.JF_HOST);
    return `${hostUrl.protocol}//${hostUrl.host}`;
  } catch {
    return null;
  }
}

function isAllowedPluginImageUrl(url, config) {
  try {
    const parsed = new URL(url);
    if (!/^https?:$/.test(parsed.protocol)) {
      return false;
    }

    const jellyfinOrigin = getJellyfinOrigin(config);
    if (!jellyfinOrigin) {
      return false;
    }

    if (parsed.origin === jellyfinOrigin) {
      return true;
    }

    if (config.IS_JELLYFIN == false && parsed.hostname === "raw.githubusercontent.com") {
      return parsed.pathname.startsWith("/MediaBrowser/Emby.Resources/");
    }

    return false;
  } catch {
    return false;
  }
}


function buildPluginImageProxyUrl(imageUrl) {
  return imageUrl ? `/proxy/Plugins/Images/?url=${encodeURIComponent(imageUrl)}` : "";
}

// Jellyfin plugin IDs are GUIDs, with or without dashes.
const PLUGIN_ID_PATTERN = /^(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
// Jellyfin plugin versions are System.Version strings such as 10.8.4.0.
const PLUGIN_VERSION_PATTERN = /^\d{1,9}(?:\.\d{1,9}){0,3}$/;

function isValidPluginId(id) {
  return typeof id === "string" && PLUGIN_ID_PATTERN.test(id);
}

// Jellyfin serves a plugin's own image at /Plugins/{id}/{version}/Image. A
// repository image URL is only used when the image proxy would fetch it (same
// origin as Jellyfin); anything else would just 404, so the card goes straight
// to its fallback tile.
function buildJellyfinPluginImageUrl(plugin = {}, packageInfo = null, config = null) {
  if (plugin.HasImage === true && isValidPluginId(plugin.Id) && plugin.Version) {
    return `/proxy/Plugins/Images/?id=${encodeURIComponent(plugin.Id)}&version=${encodeURIComponent(plugin.Version)}`;
  }
  const imageUrl = packageInfo?.imageUrl || packageInfo?.ImageUrl || plugin.ImageUrl || plugin.imageUrl;
  return imageUrl && isAllowedPluginImageUrl(imageUrl, config) ? buildPluginImageProxyUrl(imageUrl) : "";
}

// Candidate Jellyfin URLs for GET /proxy/Plugins/Images/?id=&version=. The
// versioned endpoint is tried first; the others are kept for older servers.
// An ID that isn't a GUID gets no candidates, so nothing like ".." reaches
// Jellyfin with the admin API key.
function pluginImageCandidates(jellyfinHost, id, version) {
  if (!isValidPluginId(id)) return [];
  const encodedId = encodeURIComponent(id);
  const hasVersion = typeof version === "string" && PLUGIN_VERSION_PATTERN.test(version);
  return [
    ...(hasVersion ? [`${jellyfinHost}/Plugins/${encodedId}/${version}/Image`] : []),
    `${jellyfinHost}/Plugins/${encodedId}/Image`,
    `${jellyfinHost}/Plugins/${encodedId}/Images/Primary`,
    `${jellyfinHost}/Plugins/${encodedId}/Thumb`,
  ];
}

// Move on to the next image endpoint only when Jellyfin answered with an HTTP
// error; a timeout or network error means it is unreachable.
function shouldTryNextPluginImage(error) {
  return Boolean(error?.response?.status);
}

function normalizeJellyfinPlugin(plugin = {}, packageInfo = null, config = null) {
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
    imageUrl: buildJellyfinPluginImageUrl(plugin, packageInfo, config),
  };
}

function buildJellyfinPluginsResponse(plugins = [], packages = [], config = null) {
  const normalizedPlugins = plugins.map((plugin) => normalizeJellyfinPlugin(plugin, matchJellyfinPluginPackage(plugin, packages), config));
  return {
    plugins: normalizedPlugins.sort((a, b) => a.name.localeCompare(b.name)),
    total: plugins.length,
    enabled: normalizedPlugins.filter((plugin) => plugin.enabled).length,
  };
}

module.exports = {
  normalizeGuid,
  isValidPluginId,
  getJellyfinOrigin,
  isAllowedPluginImageUrl,
  shouldTryNextPluginImage,
  matchJellyfinPluginPackage,
  buildPluginImageProxyUrl,
  buildJellyfinPluginImageUrl,
  pluginImageCandidates,
  normalizeJellyfinPlugin,
  buildJellyfinPluginsResponse,
};

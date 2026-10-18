const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { pathToFileURL } = require("url");
const {
  isValidPluginId,
  isAllowedPluginImageUrl,
  shouldTryNextPluginImage,
  matchJellyfinPluginPackage,
  buildJellyfinPluginImageUrl,
  pluginImageCandidates,
  normalizeJellyfinPlugin,
  buildJellyfinPluginsResponse,
} = require("../utils/jellyfin-plugins");

const NOTIFYSYNC_ID = "9a1b2c3d4e5f4a6b8c7d0e1f2a3b4c5d";
const PLUGINS = [
  { Name: "AudioDB", Version: "12.2.0.0", Id: "a629c0dafac54c7e931a7174223f14c8", CanUninstall: false, HasImage: false, Status: "Active" },
  { Name: "NotifySync", Version: "5.8.4.0", Id: NOTIFYSYNC_ID, CanUninstall: true, HasImage: false, Status: "Superceded" },
  { Name: "NotifySync", Version: "6.0.1.0", Id: NOTIFYSYNC_ID, CanUninstall: true, HasImage: true, Status: "Active", Description: "Synchronise les notifications." },
  { Name: "Trakt", Version: "33.0.0.0", Id: "4fe3201ed6ae4f2e8917e12bda571281", CanUninstall: true, HasImage: false, Status: "Restart" },
  { Name: "Webhook", Version: "22.0.0.0", Id: "71552a5a5c5c4350a2aeebe451a30173", CanUninstall: true, HasImage: false, Status: "Malfunctioned" },
  { Name: "Media Bar", Version: "3.0.1.0", Id: "5e0f7b4a1d2c4f6ee8b90a1b2c3d4e5a", CanUninstall: true, HasImage: false, Status: "Disabled" },
];
const PACKAGES = [
  { name: "AudioDB", guid: "a629c0da-fac5-4c7e-931a-7174223f14c8", description: "", overview: "Fetch artist metadata from TheAudioDB.", owner: "jellyfin", category: "Metadata", imageUrl: "https://repo.jellyfin.org/audiodb.png" },
  { name: "Trakt", guid: "4fe3201e-d6ae-4f2e-8917-e12bda571281", description: "Record your watched media with Trakt.tv.", owner: "jellyfin", category: "General" },
];

function loadWebHelpers() {
  return import(pathToFileURL(path.join(__dirname, "../../web/src/lib/jellyfin-plugins.js")).href);
}

test("packages match by GUID whatever the dashes, then by name", () => {
  assert.equal(matchJellyfinPluginPackage(PLUGINS[0], PACKAGES), PACKAGES[0]);
  assert.equal(matchJellyfinPluginPackage({ Name: "trakt", Id: "other" }, PACKAGES), PACKAGES[1]);
  assert.equal(matchJellyfinPluginPackage({ Name: "Missing", Id: "nope" }, PACKAGES), undefined);
});

test("only Active plugins count as enabled and a missing status means Active", () => {
  assert.deepEqual(
    PLUGINS.map((plugin) => normalizeJellyfinPlugin(plugin).enabled),
    [true, false, true, false, false, false]
  );
  assert.equal(normalizeJellyfinPlugin({ Name: "Old server" }).status, "Active");
  assert.equal(normalizeJellyfinPlugin({ Name: "Old server", Enabled: false }).status, "Disabled");
  const response = buildJellyfinPluginsResponse(PLUGINS, PACKAGES);
  assert.equal(response.total, 6);
  assert.equal(response.enabled, 2);
});

test("descriptions fall back to the repository manifest and carry their source", () => {
  const [audioDb, , notifySync, trakt, webhook] = PLUGINS.map((plugin) => normalizeJellyfinPlugin(plugin, matchJellyfinPluginPackage(plugin, PACKAGES)));
  assert.deepEqual([audioDb.description, audioDb.descriptionSource, audioDb.owner, audioDb.category], ["Fetch artist metadata from TheAudioDB.", "repository", "jellyfin", "Metadata"]);
  assert.deepEqual([notifySync.description, notifySync.descriptionSource], ["Synchronise les notifications.", "jellyfin"]);
  assert.equal(trakt.description, "Record your watched media with Trakt.tv.");
  assert.deepEqual([webhook.description, webhook.descriptionSource, webhook.owner], ["", "", ""]);
});

const JF_CONFIG = { JF_HOST: "http://jf:8096", IS_JELLYFIN: true };

test("plugin images use Jellyfin's versioned endpoint, then a same-origin repository URL", () => {
  assert.equal(buildJellyfinPluginImageUrl(PLUGINS[2]), `/proxy/Plugins/Images/?id=${NOTIFYSYNC_ID}&version=6.0.1.0`);
  assert.equal(
    buildJellyfinPluginImageUrl(PLUGINS[0], { imageUrl: "http://jf:8096/repo/audiodb.png" }, JF_CONFIG),
    "/proxy/Plugins/Images/?url=http%3A%2F%2Fjf%3A8096%2Frepo%2Faudiodb.png"
  );
  // The proxy refuses other origins, so the card shouldn't wait for that 404.
  assert.equal(buildJellyfinPluginImageUrl(PLUGINS[0], PACKAGES[0], JF_CONFIG), "");
  assert.equal(buildJellyfinPluginImageUrl(PLUGINS[0], PACKAGES[0]), "");
  assert.equal(buildJellyfinPluginImageUrl({ ...PLUGINS[2], Id: ".." }), "");
  assert.equal(buildJellyfinPluginImageUrl(PLUGINS[3]), "");
  assert.equal(isAllowedPluginImageUrl("https://raw.githubusercontent.com/MediaBrowser/Emby.Resources/x.png", { ...JF_CONFIG, IS_JELLYFIN: false }), true);
});

test("plugin ids must be GUIDs", () => {
  assert.equal(isValidPluginId(NOTIFYSYNC_ID), true);
  assert.equal(isValidPluginId("9A1B2C3D-4E5F-4A6B-8C7D-0E1F2A3B4C5D"), true);
  for (const id of ["..", "%2e%2e", "../System/Info", `${NOTIFYSYNC_ID}/..`, "", undefined, [NOTIFYSYNC_ID], { id: NOTIFYSYNC_ID }]) {
    assert.equal(isValidPluginId(id), false, String(id));
  }
});

test("the image proxy tries the versioned endpoint first and refuses odd ids and versions", () => {
  assert.deepEqual(pluginImageCandidates("http://jf:8096", NOTIFYSYNC_ID, "6.0.1.0"), [
    `http://jf:8096/Plugins/${NOTIFYSYNC_ID}/6.0.1.0/Image`,
    `http://jf:8096/Plugins/${NOTIFYSYNC_ID}/Image`,
    `http://jf:8096/Plugins/${NOTIFYSYNC_ID}/Images/Primary`,
    `http://jf:8096/Plugins/${NOTIFYSYNC_ID}/Thumb`,
  ]);
  assert.deepEqual(pluginImageCandidates("http://jf:8096", "..", "6.0.1.0"), []);
  assert.deepEqual(pluginImageCandidates("http://jf:8096", "%2e%2e", "6.0.1.0"), []);
  assert.deepEqual(pluginImageCandidates("http://jf:8096", [NOTIFYSYNC_ID, NOTIFYSYNC_ID], "6.0.1.0"), []);
  assert.equal(pluginImageCandidates("http://jf:8096", NOTIFYSYNC_ID, "../../System").length, 3);
  assert.equal(pluginImageCandidates("http://jf:8096", NOTIFYSYNC_ID, ["1.0", "2.0"]).length, 3);
  assert.equal(pluginImageCandidates("http://jf:8096", NOTIFYSYNC_ID, "1234567890.0").length, 3);
  assert.equal(pluginImageCandidates("http://jf:8096", NOTIFYSYNC_ID).length, 3);
});

test("only an HTTP error moves on to the next image endpoint", () => {
  assert.equal(shouldTryNextPluginImage({ response: { status: 404 } }), true);
  assert.equal(shouldTryNextPluginImage(Object.assign(new Error("timeout of 5000ms exceeded"), { code: "ECONNABORTED" })), false);
  assert.equal(shouldTryNextPluginImage(Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" })), false);
  assert.equal(shouldTryNextPluginImage(undefined), false);
});

test("duplicate copies of a plugin are grouped into one card", async () => {
  const { groupJellyfinPlugins, pluginVersionsLabel } = await loadWebHelpers();
  const groups = groupJellyfinPlugins(buildJellyfinPluginsResponse(PLUGINS, PACKAGES).plugins);
  assert.equal(groups.length, 5);
  assert.equal(new Set(groups.map((group) => group.key)).size, 5);
  const notifySync = groups.find((group) => group.name === "NotifySync");
  assert.equal(notifySync.version, "6.0.1.0");
  assert.equal(notifySync.status, "Active");
  assert.deepEqual(notifySync.others.map((other) => [other.version, other.status]), [["5.8.4.0", "Superceded"]]);
  assert.equal(pluginVersionsLabel(notifySync), "v6.0.1.0 + 5.8.4.0 · 2 versions");
  assert.equal(pluginVersionsLabel(groups[0]), "");
});

test("the newest copy leads a group when none is Active, and descriptions fall back to any copy", async () => {
  const { groupJellyfinPlugins } = await loadWebHelpers();
  const [group] = groupJellyfinPlugins([
    { id: "X", name: "Thing", version: "1.10.0.0", status: "Restart", description: "" },
    { id: "x", name: "Thing", version: "1.9.0.0", status: "Superceded", description: "Old words", descriptionSource: "jellyfin" },
  ]);
  assert.equal(group.version, "1.10.0.0");
  assert.equal(group.description, "Old words");
  assert.equal(group.members.length, 2);
});

test("filter counts follow the search and Needs restart / Issues look at every copy", async () => {
  const { groupJellyfinPlugins, countPluginFilters, searchPluginGroups } = await loadWebHelpers();
  const groups = groupJellyfinPlugins([
    ...buildJellyfinPluginsResponse(PLUGINS, PACKAGES).plugins,
    { id: "dup", name: "Twin", version: "2.0.0.0", status: "Active" },
    { id: "dup", name: "Twin", version: "1.0.0.0", status: "NotSupported" },
  ]);
  assert.deepEqual(countPluginFilters(groups), { all: 6, enabled: 3, disabled: 1, restart: 1, issues: 2, duplicates: 2 });
  assert.deepEqual(countPluginFilters(searchPluginGroups(groups, "trakt")), { all: 1, enabled: 0, disabled: 0, restart: 1, issues: 0, duplicates: 0 });
  assert.equal(searchPluginGroups(groups, "5.8.4").map((group) => group.name).join(), "NotifySync");
  assert.equal(searchPluginGroups(groups, "THEAUDIODB").map((group) => group.name).join(), "AudioDB");
  assert.equal(searchPluginGroups(groups, "jellyfin").length, 2);
});

test("sorting by name, status and version", async () => {
  const { groupJellyfinPlugins, visiblePluginGroups, comparePluginVersions, pluginInitials } = await loadWebHelpers();
  const groups = groupJellyfinPlugins(buildJellyfinPluginsResponse(PLUGINS, PACKAGES).plugins);
  const names = (filter, sort) => visiblePluginGroups(groups, filter, sort).map((group) => group.name);
  assert.deepEqual(names("all", "name"), ["AudioDB", "Media Bar", "NotifySync", "Trakt", "Webhook"]);
  assert.deepEqual(names("all", "status"), ["Webhook", "Trakt", "Media Bar", "AudioDB", "NotifySync"]);
  assert.deepEqual(names("all", "version"), ["Trakt", "Webhook", "AudioDB", "NotifySync", "Media Bar"]);
  assert.deepEqual(names("duplicates", "unknown"), ["NotifySync"]);
  assert.deepEqual(names("nonsense", "name"), names("all", "name"));
  assert.ok(comparePluginVersions("12.10.0.0", "12.9.0.0") > 0);
  assert.deepEqual(["Intro Skipper", "JellyTag", "TMDb", "NotifySync", "Trakt", "!!"].map(pluginInitials), ["IS", "JT", "TM", "NS", "Tr", ""]);
});

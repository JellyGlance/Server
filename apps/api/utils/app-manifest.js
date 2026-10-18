// Installable-app manifest, served from the real origin (Android won't install from a blob: manifest).
// `id` is fixed to the app root so the installed app keeps one identity whichever start page a role gets.
const THEME_BACKGROUND = "#0b0d12";

function buildAppManifest(start = "/", base = "") {
  const root = base || "";
  const startUrl = `${root}${start === "/me" ? "/me" : "/"}`;
  const icon = (src, sizes, purpose, type = "image/png") => ({ src: `${root}/${src}`, type, sizes, purpose });
  return {
    id: `${root}/`,
    short_name: "JellyGlance",
    name: "JellyGlance",
    description: "Jellyfin command center for sessions, requests, downloads, and ops.",
    icons: [
      icon("icon-192.png", "192x192", "any"),
      icon("icon-512.png", "512x512", "any"),
      icon("maskable-192.png", "192x192", "maskable"),
      icon("maskable-512.png", "512x512", "maskable"),
      icon("favicon.svg", "any", "any", "image/svg+xml"),
    ],
    start_url: startUrl,
    scope: `${root}/`,
    display: "standalone",
    display_override: ["standalone", "minimal-ui"],
    orientation: "any",
    theme_color: THEME_BACKGROUND,
    background_color: THEME_BACKGROUND,
    categories: ["entertainment", "utilities"],
    shortcuts: [
      { name: "My Glance", url: `${root}/me` },
      { name: "Requests", url: `${root}/requests` },
      { name: "Activity", url: `${root}/activity` },
    ],
  };
}

module.exports = { buildAppManifest, THEME_BACKGROUND };

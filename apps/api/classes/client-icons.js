const sharp = require("sharp");
const { axios } = require("./axios");

const SIMPLE_ICON_URL = (slug) => `https://cdn.jsdelivr.net/npm/simple-icons@11/icons/${slug}.svg`;
const SELFHST_URL = (slug) => `https://cdn.jsdelivr.net/gh/selfhst/icons/svg/${slug}.svg`;

const INLINE_SVGS = {
  infuse: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" rx="6" fill="#ff6a00"/><path fill="#fff" d="M9 7.2v9.6L18 12z"/></svg>`,
  swiftfin: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" rx="6" fill="#0ea5e9"/><path fill="#fff" d="M8.5 6.5h3.2c3.6 0 5.8 2 5.8 5.1 0 3.2-2.3 5.4-6 5.4H8.5zm2.2 8.4h1c2.2 0 3.5-1.2 3.5-3.3 0-2-1.3-3.1-3.5-3.1h-1z"/></svg>`,
};

const ICON_MAP = [
  { match: ["infuse"], slug: "infuse", source: "inline", color: "#FF6A00" },
  { match: ["swiftfin"], slug: "swiftfin", source: "inline", color: "#0EA5E9" },
  { match: ["qbittorrent", "qbit"], slug: "qbittorrent", source: "selfhst", color: "#2F67BA" },
  { match: ["transmission"], slug: "transmission", source: "selfhst", color: "#C70039" },
  { match: ["deluge"], slug: "deluge", source: "selfhst", color: "#4B79A1" },
  { match: ["sabnzbd"], slug: "sabnzbd", source: "selfhst", color: "#FFC107" },
  { match: ["nzbget"], slug: "nzbget", source: "selfhst", color: "#2E7D32" },
  { match: ["rtorrent"], slug: "rtorrent", source: "selfhst", color: "#0084C7" },
  { match: ["autobrr"], slug: "autobrr", source: "selfhst", color: "#F97316" },
  { match: ["cleanuparr"], slug: "cleanuparr", source: "selfhst", color: "#38BDF8" },
  { match: ["jellyseerr"], slug: "jellyseerr", source: "selfhst", color: "#FF7A59" },
  { match: ["overseerr"], slug: "overseerr", source: "selfhst", color: "#5A66F0" },
  { match: ["seerr"], slug: "seerr", source: "selfhst", color: "#6366F1" },
  { match: ["xbox", "jellyfin-uwp"], slug: "xbox", source: "selfhst", color: "#107C10" },
  { match: ["roku"], slug: "roku", source: "simple", color: "#6C3C97" },
  { match: ["android", "fire tv", "firetv", "findroid", "gelli", "finamp"], slug: "android", source: "simple", color: "#3DDC84" },
  { match: ["edge", "microsoft edge"], slug: "microsoft-edge", source: "selfhst", color: "#0078D7" },
  { match: ["apple tv", "tvos"], slug: "appletv", source: "simple", color: "#000000" },
  { match: ["iphone", "ipad", "ios", "swiftfin", "macos", "apple"], slug: "apple", source: "simple", color: "#000000" },
  { match: ["google tv", "googletv"], slug: "android", source: "simple", color: "#3DDC84" },
  { match: ["chromecast", "cast"], slug: "googlecast", source: "simple", color: "#4285F4" },
  { match: ["chrome"], slug: "google-chrome", source: "selfhst", color: "#4285F4" },
  { match: ["firefox"], slug: "firefox", source: "selfhst", color: "#FF7139" },
  { match: ["safari"], slug: "safari", source: "simple", color: "#006CFF" },
  { match: ["opera"], slug: "opera", source: "simple", color: "#FF1B2D" },
  { match: ["brave"], slug: "brave", source: "simple", color: "#FB542B" },
  { match: ["vivaldi"], slug: "vivaldi", source: "simple", color: "#EF3939" },
  { match: ["lg", "webos"], slug: "lg", source: "simple", color: "#A50034" },
  { match: ["samsung", "tizen"], slug: "samsung", source: "simple", color: "#1428A0" },
  { match: ["nvidia", "shield"], slug: "nvidia", source: "simple", color: "#76B900" },
  { match: ["kodi"], slug: "kodi", source: "simple", color: "#17B2E7" },
  { match: ["vlc"], slug: "vlcmediaplayer", source: "simple", color: "#FF8800" },
  { match: ["plex"], slug: "plex", source: "simple", color: "#E5A00D" },
  { match: ["emby"], slug: "emby", source: "simple", color: "#52B54B" },
  { match: ["ubuntu"], slug: "ubuntu", source: "simple", color: "#E95420" },
  { match: ["linux", "mpv"], slug: "linux", source: "simple", color: "#FCC624" },
  { match: ["jellyfin", "jmp", "jellyfin media player", "finamp"], slug: "jellyfin", source: "simple", color: "#AA5CC3" },
];

const svgCache = new Map();

function matchClientIcon(client = "", deviceName = "") {
  const haystack = `${client} ${deviceName}`.toLowerCase();
  if (!haystack.trim()) return { slug: "jellyfin", source: "simple", color: "#AA5CC3", title: "Jellyfin" };
  return ICON_MAP.find((entry) => entry.match.some((term) => haystack.includes(term))) || {
    slug: "jellyfin",
    source: "simple",
    color: "#AA5CC3",
    title: "Jellyfin",
  };
}

function colorizeSvg(svg, color) {
  let next = String(svg || "");
  if (!/fill=/i.test(next)) {
    next = next.replace(/<path\b/i, `<path fill="${color}"`);
  } else {
    next = next.replace(/fill="(?:#0{3,8}|black|currentColor)?"/gi, `fill="${color}"`);
  }
  return next;
}

async function fetchIconSvg(entry) {
  const key = `${entry.source}:${entry.slug}`;
  if (svgCache.has(key)) return svgCache.get(key);
  if (entry.source === "inline" || INLINE_SVGS[entry.slug]) {
    const svg = INLINE_SVGS[entry.slug];
    svgCache.set(key, svg);
    return svg;
  }
  const urls = entry.source === "selfhst" ? [SELFHST_URL(entry.slug), SIMPLE_ICON_URL(entry.slug)] : [SIMPLE_ICON_URL(entry.slug), SELFHST_URL(entry.slug)];
  let lastError = new Error("Icon download failed");
  for (const url of urls) {
    try {
      const response = await axios.get(url, { timeout: 6000, responseType: "text" });
      const svg = String(response.data || "");
      if (!svg.includes("<svg")) throw new Error("Icon was not SVG");
      svgCache.set(key, svg);
      return svg;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

async function renderClientIconBadge(client, deviceName, { size = 36, background = "#1f2937" } = {}) {
  const entry = matchClientIcon(client, deviceName);
  try {
    let svg = await fetchIconSvg(entry);
    if (entry.source === "simple") svg = colorizeSvg(svg, entry.color || "#AA5CC3");
    const inner = Math.max(16, Math.round(size * 0.62));
    const icon = await sharp(Buffer.from(svg))
      .resize(inner, inner, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
    const pad = Math.round((size - inner) / 2);
    const plate = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${Math.round(size * 0.22)}" fill="${background}"/></svg>`
    );
    const buffer = await sharp(plate)
      .composite([{ input: icon, left: pad, top: pad }])
      .png()
      .toBuffer();
    return { buffer, title: entry.title || entry.slug, color: entry.color };
  } catch {
    const letter = String(client || deviceName || "J")
      .replace(/[^a-z0-9]/gi, "")
      .slice(0, 1)
      .toUpperCase() || "J";
    const svg = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
        <rect width="${size}" height="${size}" rx="${Math.round(size * 0.22)}" fill="${background}"/>
        <text x="50%" y="54%" text-anchor="middle" dominant-baseline="middle" fill="#e9d5ff" font-size="${Math.round(size * 0.46)}" font-family="DejaVu Sans, sans-serif" font-weight="700">${letter}</text>
      </svg>`
    );
    return { buffer: await sharp(svg).png().toBuffer(), title: client || "Client", color: "#AA5CC3" };
  }
}

module.exports = {
  matchClientIcon,
  renderClientIconBadge,
};

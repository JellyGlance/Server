import axios from "./axios_instance";

export const THEME_STORAGE_KEY = "jellyglance_custom_theme";

export const DEFAULT_THEME = {
  primary: "#9b6ac8",
  secondary: "#4aa8bc",
  background: "#0b0d12",
  surface: "#131820",
};

export const THEME_GROUPS = [
  { id: "all", label: "All" },
  { id: "signature", label: "Signature" },
  { id: "cool", label: "Cool" },
  { id: "warm", label: "Warm" },
  { id: "neon", label: "Neon" },
  { id: "classic", label: "Classic" },
];

export const THEME_PRESETS = [
  { name: "JellyGlance", group: "signature", primary: "#9b6ac8", secondary: "#4aa8bc", background: "#0b0d12", surface: "#131820" },
  { name: "Jellyfin", group: "signature", primary: "#00a4dc", secondary: "#aa5cc3", background: "#0a0e14", surface: "#141b24" },
  { name: "OLED", group: "signature", primary: "#c4b5fd", secondary: "#67e8f9", background: "#000000", surface: "#0c0c0f" },
  { name: "Noir", group: "signature", primary: "#fafafa", secondary: "#f43f5e", background: "#050505", surface: "#111111" },
  { name: "Paper", group: "signature", primary: "#f8fafc", secondary: "#94a3b8", background: "#111318", surface: "#20242c" },
  { name: "Graphite", group: "signature", primary: "#cbd5e1", secondary: "#64748b", background: "#0a0c10", surface: "#161a21" },
  { name: "Slate", group: "signature", primary: "#94a3b8", secondary: "#38bdf8", background: "#080b10", surface: "#151b24" },
  { name: "Mono", group: "signature", primary: "#e5e7eb", secondary: "#94a3b8", background: "#07080a", surface: "#15171c" },
  { name: "Ocean", group: "cool", primary: "#2dd4bf", secondary: "#38bdf8", background: "#071015", surface: "#10212a" },
  { name: "Arctic", group: "cool", primary: "#93c5fd", secondary: "#67e8f9", background: "#06101a", surface: "#101d2b" },
  { name: "Lagoon", group: "cool", primary: "#06b6d4", secondary: "#14b8a6", background: "#041115", surface: "#0d2226" },
  { name: "Iceberg", group: "cool", primary: "#7dd3fc", secondary: "#c4b5fd", background: "#071018", surface: "#121d29" },
  { name: "Deep Sea", group: "cool", primary: "#38bdf8", secondary: "#2dd4bf", background: "#031018", surface: "#0b202b" },
  { name: "Electric Blue", group: "cool", primary: "#2563eb", secondary: "#67e8f9", background: "#050a18", surface: "#101b35" },
  { name: "Midnight", group: "cool", primary: "#60a5fa", secondary: "#f472b6", background: "#050816", surface: "#101827" },
  { name: "Peacock", group: "cool", primary: "#14b8a6", secondary: "#a3e635", background: "#031014", surface: "#0c2024" },
  { name: "Nord", group: "cool", primary: "#88c0d0", secondary: "#b48ead", background: "#0b1118", surface: "#17202b" },
  { name: "Ember", group: "warm", primary: "#f97316", secondary: "#f43f5e", background: "#120b08", surface: "#1f1512" },
  { name: "Forest", group: "warm", primary: "#22c55e", secondary: "#eab308", background: "#08110d", surface: "#111d17" },
  { name: "Solar", group: "warm", primary: "#facc15", secondary: "#fb923c", background: "#100d05", surface: "#201809" },
  { name: "Mint", group: "warm", primary: "#34d399", secondary: "#a3e635", background: "#06110c", surface: "#102017" },
  { name: "Copper", group: "warm", primary: "#d97706", secondary: "#f59e0b", background: "#110b05", surface: "#21160c" },
  { name: "Citrus", group: "warm", primary: "#84cc16", secondary: "#facc15", background: "#080f05", surface: "#14200d" },
  { name: "Crimson", group: "warm", primary: "#dc2626", secondary: "#fbbf24", background: "#100405", surface: "#1f0d0f" },
  { name: "Volcanic", group: "warm", primary: "#fb923c", secondary: "#fef08a", background: "#120805", surface: "#26150d" },
  { name: "Honey", group: "warm", primary: "#fbbf24", secondary: "#fef3c7", background: "#120d03", surface: "#251b08" },
  { name: "Moss", group: "warm", primary: "#a3e635", secondary: "#84cc16", background: "#091006", surface: "#17210d" },
  { name: "Tangerine", group: "warm", primary: "#fb923c", secondary: "#f472b6", background: "#130905", surface: "#26140f" },
  { name: "Sandstone", group: "warm", primary: "#d6a36a", secondary: "#e7c9a0", background: "#120e09", surface: "#221a12" },
  { name: "Ruby", group: "warm", primary: "#ef4444", secondary: "#f97316", background: "#120707", surface: "#211010" },
  { name: "Aurora", group: "neon", primary: "#a78bfa", secondary: "#22d3ee", background: "#090814", surface: "#17142a" },
  { name: "Synth", group: "neon", primary: "#ff2bd6", secondary: "#00e5ff", background: "#080510", surface: "#171024" },
  { name: "Terminal", group: "neon", primary: "#4ade80", secondary: "#f8fafc", background: "#030604", surface: "#0b120d" },
  { name: "Matrix", group: "neon", primary: "#22c55e", secondary: "#86efac", background: "#020806", surface: "#08140f" },
  { name: "Coral", group: "neon", primary: "#fb7185", secondary: "#2dd4bf", background: "#10090b", surface: "#201316" },
  { name: "Limewire", group: "neon", primary: "#bef264", secondary: "#22d3ee", background: "#050b08", surface: "#101a14" },
  { name: "Plasma", group: "neon", primary: "#e879f9", secondary: "#818cf8", background: "#0d0614", surface: "#1d1029" },
  { name: "Cyberpunk", group: "neon", primary: "#fcee0a", secondary: "#ff2a6d", background: "#0a0610", surface: "#1a1024" },
  { name: "Flamingo", group: "neon", primary: "#fb7185", secondary: "#f472b6", background: "#140810", surface: "#26141e" },
  { name: "Grape", group: "classic", primary: "#c084fc", secondary: "#818cf8", background: "#0d0718", surface: "#1b102c" },
  { name: "Rose", group: "classic", primary: "#fb7185", secondary: "#f9a8d4", background: "#130910", surface: "#23111c" },
  { name: "Sakura", group: "classic", primary: "#fda4af", secondary: "#f0abfc", background: "#120910", surface: "#24131f" },
  { name: "Violet Night", group: "classic", primary: "#8b5cf6", secondary: "#c4b5fd", background: "#090615", surface: "#17102a" },
  { name: "Dracula", group: "classic", primary: "#bd93f9", secondary: "#ff79c6", background: "#0d0f17", surface: "#1c1e2b" },
  { name: "Catppuccin", group: "classic", primary: "#cba6f7", secondary: "#89b4fa", background: "#0e0f16", surface: "#1a1b26" },
  { name: "Gruvbox", group: "classic", primary: "#fabd2f", secondary: "#fe8019", background: "#14120e", surface: "#221e16" },
  { name: "Tokyo Night", group: "classic", primary: "#7aa2f7", secondary: "#bb9af7", background: "#0d1017", surface: "#1a1b26" },
  { name: "One Dark", group: "classic", primary: "#61afef", secondary: "#c678dd", background: "#0f1218", surface: "#1c212b" },
  { name: "Solarized", group: "classic", primary: "#268bd2", secondary: "#2aa198", background: "#002b36", surface: "#073642" },
  { name: "Kanagawa", group: "classic", primary: "#7e9cd8", secondary: "#ffa066", background: "#12131a", surface: "#1f1f28" },
  { name: "Everforest", group: "classic", primary: "#a7c080", secondary: "#dbbc7f", background: "#121612", surface: "#1e2320" },
  { name: "Rose Pine", group: "classic", primary: "#c4a7e7", secondary: "#ebbcba", background: "#121018", surface: "#1f1d27" },
  { name: "Monokai", group: "classic", primary: "#a6e22e", secondary: "#f92672", background: "#14140f", surface: "#22221a" },
  { name: "Horizon", group: "classic", primary: "#e95678", secondary: "#25b2bc", background: "#120e12", surface: "#1f1a20" },
  { name: "Night Owl", group: "classic", primary: "#82aaff", secondary: "#c792ea", background: "#011627", surface: "#0d2237" },
];

export function themeColorFields(theme = {}) {
  return {
    primary: theme.primary,
    secondary: theme.secondary,
    background: theme.background,
    surface: theme.surface,
  };
}

export function findMatchingThemePreset(theme) {
  const current = themeColorFields(theme);
  return THEME_PRESETS.find(
    (preset) =>
      preset.primary === current.primary &&
      preset.secondary === current.secondary &&
      preset.background === current.background &&
      preset.surface === current.surface
  );
}

export function filterThemePresets(query = "", group = "all") {
  const needle = String(query || "").trim().toLowerCase();
  return THEME_PRESETS.filter((preset) => {
    if (group !== "all" && preset.group !== group) return false;
    if (!needle) return true;
    return preset.name.toLowerCase().includes(needle) || String(preset.group || "").includes(needle);
  });
}

const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

function normalizeHexColor(value, fallback) {
  if (typeof value !== "string") {
    return fallback;
  }

  const nextValue = value.trim();
  return HEX_COLOR_PATTERN.test(nextValue) ? nextValue : fallback;
}

function hexToRgb(hexColor) {
  const normalized = normalizeHexColor(hexColor, "#000000").slice(1);
  return {
    r: parseInt(normalized.slice(0, 2), 16),
    g: parseInt(normalized.slice(2, 4), 16),
    b: parseInt(normalized.slice(4, 6), 16),
  };
}

function darkenHex(hexColor, amount = 0.28) {
  const { r, g, b } = hexToRgb(hexColor);
  const channel = (value) => Math.max(0, Math.min(255, Math.round(value * (1 - amount))));
  return `#${[channel(r), channel(g), channel(b)].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

function mixHex(firstHexColor, secondHexColor, weight = 0.42) {
  const first = hexToRgb(firstHexColor);
  const second = hexToRgb(secondHexColor);
  const channel = (firstValue, secondValue) => Math.max(0, Math.min(255, Math.round(firstValue * (1 - weight) + secondValue * weight)));
  return `#${[channel(first.r, second.r), channel(first.g, second.g), channel(first.b, second.b)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("")}`;
}

function rgbString(hexColor) {
  const { r, g, b } = hexToRgb(hexColor);
  return `${r}, ${g}, ${b}`;
}

export function getStoredTheme() {
  try {
    const storedTheme = JSON.parse(localStorage.getItem(THEME_STORAGE_KEY) || "{}");
    return {
      primary: normalizeHexColor(storedTheme.primary, DEFAULT_THEME.primary),
      secondary: normalizeHexColor(storedTheme.secondary, DEFAULT_THEME.secondary),
      background: normalizeHexColor(storedTheme.background, DEFAULT_THEME.background),
      surface: normalizeHexColor(storedTheme.surface, DEFAULT_THEME.surface),
    };
  } catch {
    return DEFAULT_THEME;
  }
}

function themesMatch(left, right) {
  return (
    left?.primary === right?.primary &&
    left?.secondary === right?.secondary &&
    left?.background === right?.background &&
    left?.surface === right?.surface
  );
}

let persistThemeTimer = 0;

function persistThemeRemote(theme) {
  const token = localStorage.getItem("token");
  if (!token) return;
  window.clearTimeout(persistThemeTimer);
  persistThemeTimer = window.setTimeout(() => {
    axios
      .put(
        "/api/preferences",
        { theme },
        { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } }
      )
      .catch((error) => {
        console.log("Unable to sync theme", error);
      });
  }, 400);
}

export function saveTheme(theme, options = {}) {
  const nextTheme = {
    primary: normalizeHexColor(theme.primary, DEFAULT_THEME.primary),
    secondary: normalizeHexColor(theme.secondary, DEFAULT_THEME.secondary),
    background: normalizeHexColor(theme.background, DEFAULT_THEME.background),
    surface: normalizeHexColor(theme.surface, DEFAULT_THEME.surface),
  };

  localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(nextTheme));
  applyTheme(nextTheme);
  window.dispatchEvent(new CustomEvent("jellyglance-theme-updated", { detail: nextTheme }));
  if (options.sync !== false) persistThemeRemote(nextTheme);
  return nextTheme;
}

export function resetTheme(options = {}) {
  localStorage.removeItem(THEME_STORAGE_KEY);
  applyTheme(DEFAULT_THEME);
  window.dispatchEvent(new CustomEvent("jellyglance-theme-updated", { detail: DEFAULT_THEME }));
  if (options.sync !== false) persistThemeRemote(DEFAULT_THEME);
  return DEFAULT_THEME;
}

export function hydrateThemeFromPreferences(preferences) {
  const remoteTheme = preferences?.theme;
  if (remoteTheme?.primary) {
    return saveTheme(remoteTheme, { sync: false });
  }
  const localTheme = getStoredTheme();
  if (!themesMatch(localTheme, DEFAULT_THEME)) {
    persistThemeRemote(localTheme);
  }
  applyTheme(localTheme);
  return localTheme;
}

export function applyTheme(theme = getStoredTheme()) {
  const root = document.documentElement;
  const nextTheme = {
    primary: normalizeHexColor(theme.primary, DEFAULT_THEME.primary),
    secondary: normalizeHexColor(theme.secondary, DEFAULT_THEME.secondary),
    background: normalizeHexColor(theme.background, DEFAULT_THEME.background),
    surface: normalizeHexColor(theme.surface, DEFAULT_THEME.surface),
  };
  const { r, g, b } = hexToRgb(nextTheme.surface);
  const primaryLightColor = mixHex(nextTheme.primary, "#ffffff");

  root.style.colorScheme = "dark";
  root.style.setProperty("--primary-color", nextTheme.primary);
  root.style.setProperty("--primary-rgb", rgbString(nextTheme.primary));
  root.style.setProperty("--primary-light-color", primaryLightColor);
  root.style.setProperty("--primary-light-rgb", rgbString(primaryLightColor));
  root.style.setProperty("--primary-dark-color", darkenHex(nextTheme.primary));
  root.style.setProperty("--secondary-color", nextTheme.secondary);
  root.style.setProperty("--secondary-rgb", rgbString(nextTheme.secondary));
  root.style.setProperty("--background-color", nextTheme.background);
  root.style.setProperty("--secondary-background-color", nextTheme.surface);
  root.style.setProperty("--tertiary-background-color", darkenHex(nextTheme.surface, -0.18));
  root.style.setProperty("--surface-color", `rgba(${r}, ${g}, ${b}, 0.86)`);
  // Keep the browser / installed-app title bar in step with the user's theme background.
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", nextTheme.background);
}

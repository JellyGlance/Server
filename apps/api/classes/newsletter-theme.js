const HEX = /^#([0-9a-f]{6})$/i;

const EMAIL_SAFE_FONTS = [
  { id: "arial", label: "Arial", stack: "Arial, Helvetica, sans-serif" },
  { id: "helvetica", label: "Helvetica", stack: "Helvetica, Arial, sans-serif" },
  { id: "verdana", label: "Verdana", stack: "Verdana, Geneva, sans-serif" },
  { id: "tahoma", label: "Tahoma", stack: "Tahoma, Geneva, sans-serif" },
  { id: "trebuchet", label: "Trebuchet MS", stack: "'Trebuchet MS', Helvetica, sans-serif" },
  { id: "georgia", label: "Georgia", stack: "Georgia, 'Times New Roman', serif" },
  { id: "times", label: "Times New Roman", stack: "'Times New Roman', Times, serif" },
  { id: "courier", label: "Courier New", stack: "'Courier New', Courier, monospace" },
];

const FONTS_BY_ID = Object.fromEntries(EMAIL_SAFE_FONTS.map((font) => [font.id, font]));

const MODE_PALETTES = {
  dark: {
    background: "#0b111a",
    surface: "#151d29",
    text: "#d7e2f2",
    heading: "#f4f8ff",
    muted: "#9fb0c7",
    border: "#27364a",
    card: "#121a24",
    accent: "#6ee7f9",
  },
  light: {
    background: "#eef2f7",
    surface: "#ffffff",
    text: "#1f2a37",
    heading: "#101828",
    muted: "#5b6b80",
    border: "#d5dee8",
    card: "#f5f7fb",
    accent: "#0f766e",
  },
};


const SEASONAL_THEMES = {
  halloween: {
    id: "halloween",
    label: "Halloween",
    background: "#160b08",
    surface: "#24140f",
    text: "#fff7ed",
    heading: "#fff7ed",
    muted: "#fdba74",
    border: "#7c2d12",
    card: "#1c0f0b",
    accent: "#f97316",
    image: "/blobbo/looks/halloween-still.png",
  },
  winter: {
    id: "winter",
    label: "Winter",
    background: "#0b1520",
    surface: "#132233",
    text: "#e0f2fe",
    heading: "#f0f9ff",
    muted: "#7dd3fc",
    border: "#1e3a5f",
    card: "#0f1b2a",
    accent: "#38bdf8",
    image: "/blobbo/looks/winter-still.png",
  },
};

// Same windows as Blobbo's calendar: Halloween 20-31 Oct, winter 1-30 Dec
// (31 Dec is Blobbo's New Year look, so the newsletter stays on classic).
function autoSeasonalTheme(date = new Date()) {
  const month = date.getMonth() + 1;
  const day = date.getDate();
  if (month === 10 && day >= 20) return "halloween";
  if (month === 12 && day <= 30) return "winter";
  return "base";
}

function resolveSeasonalTheme(input = {}, date = new Date()) {
  const requested = String(input.theme || input.seasonalTheme || "auto").toLowerCase();
  let id = "base";
  let source = "manual";
  if (requested === "halloween" || requested === "winter") {
    id = requested;
  } else if (requested === "base" || requested === "classic" || requested === "none") {
    id = "base";
  } else {
    id = autoSeasonalTheme(date);
    source = "auto";
  }
  return { id, source, palette: SEASONAL_THEMES[id] || null };
}

function applySeasonalBranding(input = {}, date = new Date(), options = {}) {
  const branding = normalizeBranding(input);
  const seasonal = resolveSeasonalTheme(branding, date);
  const next = { ...branding, theme: String(input.theme || "auto"), resolvedTheme: seasonal.id, seasonalSource: seasonal.source };
  if (seasonal.palette) {
    next.background = seasonal.palette.background;
    next.surface = seasonal.palette.surface;
    next.text = seasonal.palette.text;
    next.heading = seasonal.palette.heading;
    next.muted = seasonal.palette.muted;
    next.border = seasonal.palette.border;
    next.card = seasonal.palette.card;
    next.accent = seasonal.palette.accent;
    const image = seasonal.palette.image;
    const base = String(options.assetBase || "").replace(/\/$/, "");
    next.seasonalImage = image ? `${base}${image}` : "";
  } else {
    next.seasonalImage = "";
  }
  return next;
}

function safeHex(value, fallback) {
  const raw = String(value || "").trim();
  if (HEX.test(raw)) return raw.toLowerCase();
  return fallback;
}

function resolveFont(value) {
  const raw = String(value || "").trim();
  if (FONTS_BY_ID[raw]) return FONTS_BY_ID[raw];
  const byStack = EMAIL_SAFE_FONTS.find((font) => font.stack === raw || font.label === raw);
  return byStack || FONTS_BY_ID.arial;
}

function normalizeBranding(input = {}) {
  const mode = input.mode === "light" ? "light" : "dark";
  const palette = MODE_PALETTES[mode];
  const font = resolveFont(input.fontId || input.font);
  return {
    logoUrl: String(input.logoUrl || input.logo || "").trim(),
    accent: safeHex(input.accent || input.accentColor, palette.accent),
    background: safeHex(input.background, palette.background),
    surface: safeHex(input.surface, palette.surface),
    text: safeHex(input.text, palette.text),
    heading: safeHex(input.heading, palette.heading),
    muted: safeHex(input.muted, palette.muted),
    border: safeHex(input.border, palette.border),
    card: safeHex(input.card, palette.card),
    mode,
    fontId: font.id,
    font: font.stack,
    footer: String(input.footer || "").slice(0, 4000),
    theme: String(input.theme || "base"),
  };
}

function replacePlaceholders(html, replacements = {}) {
  return String(html || "").replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (match, key) => {
    const value = replacements[key] ?? replacements[key.toLowerCase()];
    return value == null ? match : String(value);
  });
}

function applyHtmlTemplate(htmlBody, replacements = {}) {
  const source = String(htmlBody || "").trim();
  if (!source) return null;
  const hasBody = /\{\{\s*(body|content)\s*\}\}/i.test(source);
  let html = replacePlaceholders(source, {
    ...replacements,
    body: replacements.body || replacements.content || "",
    content: replacements.content || replacements.body || "",
  });
  if (!hasBody) {
    const body = replacements.body || replacements.content || "";
    if (/<\/body>/i.test(html)) html = html.replace(/<\/body>/i, `${body}\n</body>`);
    else html += body;
  }
  return html;
}

function footerHtml(branding) {
  const brandingNorm = normalizeBranding(branding);
  if (!brandingNorm.footer) return "";
  const escaped = String(brandingNorm.footer)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/\n/g, "<br/>");
  return `<tr><td style="padding:14px 28px 22px;border-top:1px solid ${brandingNorm.border};color:${brandingNorm.muted};font-size:12px;line-height:1.5;font-family:${brandingNorm.font};">${escaped}</td></tr>`;
}

function logoHtml(branding, fallbackSrc) {
  const brandingNorm = normalizeBranding(branding);
  const src = brandingNorm.logoUrl || fallbackSrc || "";
  if (!src) return "";
  return `<img src="${src}" alt="JellyGlance" width="48" height="48" style="display:block;margin-bottom:14px;" />`;
}

function wrapEmailDocument({
  bodyHtml,
  metricHtml = "",
  subject = "JellyGlance newsletter",
  campaignName = "JellyGlance Newsletter",
  generatedAt = "",
  logoSrc = "",
  branding = {},
  htmlBody = "",
  kickerColor,
  date,
  assetBase = "",
} = {}) {
  const theme = applySeasonalBranding(branding, date, { assetBase });
  const logo = logoHtml(theme, logoSrc);
  const footer = footerHtml(theme);
  const defaultDocument = `<!doctype html>
<html>
  <body style="margin:0;background:${theme.background};font-family:${theme.font};color:${theme.text};">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:${theme.background};padding:24px 12px;">
      <tr>
        <td align="center">
          <table width="640" cellpadding="0" cellspacing="0" style="background:${theme.surface};border:1px solid ${theme.border};border-radius:18px;overflow:hidden;">
            <tr><td style="height:4px;background:${kickerColor || theme.accent};font-size:0;line-height:0;">&nbsp;</td></tr>
            <tr>
              <td style="padding:28px 28px 12px;">
                ${theme.seasonalImage ? `<img src="${theme.seasonalImage}" alt="${theme.resolvedTheme}" width="640" height="180" style="display:block;width:100%;max-width:640px;height:180px;object-fit:cover;object-position:center;margin:0 0 16px;border-radius:12px;" />` : ""}
                ${logo}
                <div style="color:${theme.muted};font-size:12px;font-weight:800;text-transform:uppercase;">${campaignName}</div>
                <h1 style="margin:8px 0 6px;color:${theme.heading};font-size:28px;font-family:${theme.font};">${subject}</h1>
                ${generatedAt ? `<p style="margin:0;color:${theme.muted};font-size:14px;">${generatedAt}</p>` : ""}
              </td>
            </tr>
            ${metricHtml ? `<tr><td style="padding:8px 22px 8px;">${metricHtml}</td></tr>` : ""}
            <tr>
              <td style="padding:8px 28px 32px;">
                ${bodyHtml || ""}
              </td>
            </tr>
            ${footer}
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return (
    applyHtmlTemplate(htmlBody, {
      body: `${metricHtml || ""}${bodyHtml || ""}`,
      content: `${metricHtml || ""}${bodyHtml || ""}`,
      subject,
      campaignName,
      generatedAt,
      logo,
      footer: theme.footer,
      accent: theme.accent,
      background: theme.background,
      surface: theme.surface,
      text: theme.text,
      font: theme.font,
    }) || defaultDocument
  );
}

module.exports = {
  EMAIL_SAFE_FONTS,
  MODE_PALETTES,
  safeHex,
  resolveFont,
  normalizeBranding,
  applyHtmlTemplate,
  wrapEmailDocument,
  footerHtml,
  logoHtml,
  SEASONAL_THEMES,
  autoSeasonalTheme,
  resolveSeasonalTheme,
  applySeasonalBranding,
};

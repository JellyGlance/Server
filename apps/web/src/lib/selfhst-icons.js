// selfh.st icon URLs. Most apps use the SVG set; a few look better from the
// WebP set, so they are pinned here and used everywhere the logo appears.
const SELFHST = "https://cdn.jsdelivr.net/gh/selfhst/icons";

export const SELFHST_ICON_OVERRIDES = {
  cleanuparr: `${SELFHST}/webp/cleanuparr.webp`,
  unpackerr: `${SELFHST}/webp/unpackerr.webp`,
};

export const selfhstIconUrl = (slug) => SELFHST_ICON_OVERRIDES[slug] || `${SELFHST}/svg/${slug}.svg`;

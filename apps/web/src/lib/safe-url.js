/**
 * Return a URL that is safe to assign to href or img src.
 * Allows http(s), same-origin relative paths, and optionally raster image data URLs.
 * javascript:, data: (except allowed images), and other schemes are dropped.
 */
const DATA_IMAGE = /^data:image\/(?:png|jpe?g|gif|webp);base64,[a-z0-9+/=\s]+$/i;

function encodeSafeUrl(value) {
  return encodeURI(value);
}

export function toSafeHttpUrl(raw, options = {}) {
  if (typeof raw !== "string") {
    return "";
  }

  const value = raw.trim();
  if (!value || value.includes("\\")) {
    return "";
  }

  const allowDataImage = options.allowDataImage === true;
  if (allowDataImage && value.toLowerCase().startsWith("data:image/")) {
    try {
      const parsedData = new URL(value);
      if (parsedData.protocol === "data:" && DATA_IMAGE.test(value)) {
        return encodeSafeUrl(value);
      }
    } catch {
      return "";
    }
    return "";
  }

  try {
    const parsed = new URL(value, "https://localhost");
    if (parsed.protocol === "https:" || parsed.protocol === "http:") {
      if (value.startsWith("/") && !value.startsWith("//")) {
        return encodeSafeUrl(`${parsed.pathname}${parsed.search}${parsed.hash}`);
      }
      return encodeSafeUrl(parsed.href);
    }
  } catch {
    return "";
  }
  return "";
}

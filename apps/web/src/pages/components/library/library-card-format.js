import i18next from "i18next";

export const UNKNOWN_LIBRARY_SIZE = "—";

export function formatFileSize(sizeInBytes) {
  const sizeInKB = sizeInBytes / 1024; // 1 KB = 1024 bytes
  if (sizeInKB < 1024) {
    return `${sizeInKB.toFixed(2)} KB`;
  }

  const sizeInMB = sizeInKB / 1024; // 1 MB = 1024 KB
  if (sizeInMB < 1024) {
    return `${sizeInMB.toFixed(2)} MB`;
  }

  const sizeInGB = sizeInMB / 1024; // 1 GB = 1024 MB
  if (sizeInGB < 1024) {
    return `${sizeInGB.toFixed(2)} GB`;
  }

  const sizeInTB = sizeInGB / 1024; // 1 TB = 1024 GB
  if (sizeInTB < 1024) {
    return `${sizeInTB.toFixed(2)} TB`;
  }

  const sizeInPB = sizeInTB / 1024; // 1 PB = 1024 TB
  return `${sizeInPB.toFixed(2)} PB`;
}

// A missing, non-numeric, zero or negative size is unknown or empty — never "0.00 KB".
export function formatLibrarySize(size) {
  if (size == null || size === "") {
    return UNKNOWN_LIBRARY_SIZE;
  }
  const bytes = typeof size === "number" ? size : Number(size);
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return UNKNOWN_LIBRARY_SIZE;
  }
  return formatFileSize(bytes);
}

// Empty translations such as USERS_PAGE.AGO_ALT in English are stored as "".
// i18next 27 returns the raw key for those, and with fallbackLng it would also
// fill an empty current-language value from English (wrong for prefix/suffix
// grammar). Read only the current language and treat empty or missing as "".
export function optionalTranslation(key) {
  const value = i18next.t(key, { defaultValue: "", fallbackLng: false });
  if (value == null || value === key) {
    return "";
  }
  return String(value).trim();
}

export function formatLastActivityTime(time) {
  if (!time || typeof time !== "object") {
    return "";
  }

  const units = {
    days: [i18next.t("UNITS.DAY"), i18next.t("UNITS.DAYS")],
    hours: [i18next.t("UNITS.HOUR"), i18next.t("UNITS.HOURS")],
    minutes: [i18next.t("UNITS.MINUTE"), i18next.t("UNITS.MINUTES")],
  };

  let formattedTime = "";

  for (const unit in units) {
    if (time[unit]) {
      const unitName = units[unit][time[unit] > 1 ? 1 : 0];
      formattedTime += `${time[unit]} ${unitName} `;
    }
  }

  return formattedTime.trim();
}

export function formatLastPlayedLabel(lastActivity) {
  if (!lastActivity) {
    return i18next.t("ERROR_MESSAGES.NEVER");
  }

  const duration = formatLastActivityTime(lastActivity);
  if (!duration) {
    return i18next.t("ERROR_MESSAGES.NEVER");
  }

  const prefix = optionalTranslation("USERS_PAGE.AGO_ALT");
  const suffix = optionalTranslation("USERS_PAGE.AGO").toLocaleLowerCase();
  return [prefix, duration, suffix].filter(Boolean).join(" ");
}

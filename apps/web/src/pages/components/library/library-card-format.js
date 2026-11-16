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

function formatCompactSizeValue(value, unit) {
  const formatted = value >= 10 ? value.toFixed(0) : value.toFixed(1);
  return `${formatted} ${unit}`;
}

// Shorter than formatFileSize so overview tiles do not clip values such as "268.25 GB".
export function formatCompactLibrarySize(size) {
  if (size == null || size === "") {
    return UNKNOWN_LIBRARY_SIZE;
  }
  const bytes = typeof size === "number" ? size : Number(size);
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return UNKNOWN_LIBRARY_SIZE;
  }
  const sizeInKB = bytes / 1024;
  if (sizeInKB < 1024) return formatCompactSizeValue(sizeInKB, "KB");
  const sizeInMB = sizeInKB / 1024;
  if (sizeInMB < 1024) return formatCompactSizeValue(sizeInMB, "MB");
  const sizeInGB = sizeInMB / 1024;
  if (sizeInGB < 1024) return formatCompactSizeValue(sizeInGB, "GB");
  const sizeInTB = sizeInGB / 1024;
  if (sizeInTB < 1024) return formatCompactSizeValue(sizeInTB, "TB");
  return formatCompactSizeValue(sizeInTB / 1024, "PB");
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

export function formatCompactDurationFromSeconds(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);

  if (days) {
    return hours ? `${days}d ${hours}h` : `${days}d`;
  }
  if (hours) {
    return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
  }
  return `${minutes}m`;
}

export function formatCompactDurationFromTicks(ticks) {
  if (ticks == null || ticks === "") {
    return "0m";
  }
  const value = typeof ticks === "number" ? ticks : Number(ticks);
  if (!Number.isFinite(value) || value <= 0) {
    return "0m";
  }
  return formatCompactDurationFromSeconds(Math.floor(value / 10000000));
}

function formatCount(value) {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) {
    return "0";
  }
  return number.toLocaleString();
}

// Tiles shown on overview cards. Episodes and Seasons only apply to TV libraries.
export function libraryCardStatTiles({ collectionType, plays, episodeCount, librarySize, files, seasonCount, totalTimeTicks, playbackSeconds }) {
  const type = String(collectionType || "").toLowerCase();
  const isTv = type === "tvshows";

  return [
    { key: "plays", labelKey: "LIBRARY_CARD.PLAYS", value: formatCount(plays) },
    isTv ? { key: "episodes", labelKey: "EPISODES", value: formatCount(episodeCount) } : null,
    { key: "size", labelKey: "LIBRARY_CARD.SIZE", value: formatCompactLibrarySize(librarySize) },
    { key: "files", labelKey: "LIBRARY_CARD.FILES", value: formatCount(files) },
    isTv ? { key: "seasons", labelKey: "SEASONS", value: formatCount(seasonCount) } : null,
    { key: "totalTime", labelKey: "LIBRARY_CARD.TIME", value: formatCompactDurationFromTicks(totalTimeTicks) },
    { key: "playback", labelKey: "LIBRARY_CARD.PLAYBACK", value: formatCompactDurationFromSeconds(playbackSeconds) },
  ].filter(Boolean);
}

// List view keeps a fixed column for every stat so rows line up. Inapplicable
// stats (Episodes and Seasons on movies, music and books) show an em dash.
export const LIBRARY_LIST_STAT_COLUMNS = [
  { key: "plays", labelKey: "LIBRARY_CARD.PLAYS" },
  { key: "episodes", labelKey: "EPISODES", optional: true },
  { key: "seasons", labelKey: "SEASONS", optional: true },
  { key: "size", labelKey: "LIBRARY_CARD.SIZE" },
  { key: "files", labelKey: "LIBRARY_CARD.FILES" },
  { key: "totalTime", labelKey: "LIBRARY_CARD.TIME" },
  { key: "playback", labelKey: "LIBRARY_CARD.PLAYBACK" },
];

export function libraryListStatColumns({ collectionType, plays, episodeCount, librarySize, files, seasonCount, totalTimeTicks, playbackSeconds }) {
  const type = String(collectionType || "").toLowerCase();
  const isTv = type === "tvshows";

  return [
    { key: "plays", labelKey: "LIBRARY_CARD.PLAYS", value: formatCount(plays) },
    { key: "episodes", labelKey: "EPISODES", value: isTv ? formatCount(episodeCount) : UNKNOWN_LIBRARY_SIZE, placeholder: !isTv },
    { key: "seasons", labelKey: "SEASONS", value: isTv ? formatCount(seasonCount) : UNKNOWN_LIBRARY_SIZE, placeholder: !isTv },
    { key: "size", labelKey: "LIBRARY_CARD.SIZE", value: formatCompactLibrarySize(librarySize) },
    { key: "files", labelKey: "LIBRARY_CARD.FILES", value: formatCount(files) },
    { key: "totalTime", labelKey: "LIBRARY_CARD.TIME", value: formatCompactDurationFromTicks(totalTimeTicks) },
    { key: "playback", labelKey: "LIBRARY_CARD.PLAYBACK", value: formatCompactDurationFromSeconds(playbackSeconds) },
  ];
}

export function formatLastPlayedLine(itemName, lastActivity, fallback = "N/A") {
  const title = String(itemName || "").trim() || fallback;
  const when = formatLastPlayedLabel(lastActivity);
  const text = String(itemName || "").trim() ? `${title} · ${when}` : when;
  return { title, when, text };
}


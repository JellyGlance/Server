// Calendar extras: a private iCal feed of synced releases, and a once-a-day "airing today" digest
// sent through the webhooks that subscribe to the calendar_digest event.
const { randomBytes } = require("crypto");
const { getSettings, saveSettings, getIntegrationData } = require("./integration-store");
const { timingSafeEqualString } = require("../utils/security");

const DEFAULT_DIGEST = { enabled: false, hour: 8, includeMissing: true, lastSentDate: null };

async function getFeedToken({ create = true } = {}) {
  const settings = await getSettings();
  if (settings.CalendarFeedToken) return settings.CalendarFeedToken;
  if (!create) return null;
  const token = randomBytes(24).toString("base64url");
  await saveSettings({ CalendarFeedToken: token });
  return token;
}

async function rotateFeedToken() {
  const token = randomBytes(24).toString("base64url");
  await saveSettings({ CalendarFeedToken: token });
  return token;
}

async function disableFeed() {
  await saveSettings({ CalendarFeedToken: null });
}

async function feedTokenMatches(candidate) {
  const token = await getFeedToken({ create: false });
  return Boolean(token) && timingSafeEqualString(String(candidate || ""), token);
}

function icsEscape(value) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, "\\n")
    .replace(/([,;])/g, "\\$1");
}

// RFC 5545 wants lines of at most 75 octets; continuation lines start with a space.
function fold(line) {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= 75) return line;
  const parts = [];
  let current = "";
  for (const char of line) {
    if (Buffer.byteLength(current + char, "utf8") > (parts.length ? 74 : 75)) {
      parts.push(current);
      current = "";
    }
    current += char;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

function utcStamp(date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function dateStamp(date) {
  return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, "0")}${String(date.getUTCDate()).padStart(2, "0")}`;
}

function releaseKind(release) {
  const type = String(release.type || "").toLowerCase();
  if (type) return type;
  return /radarr/i.test(release.service) ? "movie" : "tv";
}

function isDateOnly(release, date) {
  return !["tv", "audiobook"].includes(releaseKind(release)) && date.getUTCHours() === 0 && date.getUTCMinutes() === 0;
}

function buildIcs(releases = [], { name = "JellyGlance releases", now = new Date() } = {}) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//JellyGlance//Release Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${icsEscape(name)}`,
    "X-PUBLISHED-TTL:PT1H",
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
  ];
  for (const release of releases) {
    const start = new Date(release.date);
    if (Number.isNaN(start.getTime())) continue;
    const summary = release.subtitle && releaseKind(release) === "tv" ? `${release.title} · ${release.subtitle}` : release.title;
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${icsEscape(String(release.id || `${release.title}-${release.date}`))}@jellyglance`);
    lines.push(`DTSTAMP:${utcStamp(now)}`);
    if (isDateOnly(release, start)) {
      const end = new Date(start);
      end.setUTCDate(end.getUTCDate() + 1);
      lines.push(`DTSTART;VALUE=DATE:${dateStamp(start)}`);
      lines.push(`DTEND;VALUE=DATE:${dateStamp(end)}`);
    } else {
      const minutes = Math.max(15, Number(release.runtime) || 30);
      lines.push(`DTSTART:${utcStamp(start)}`);
      lines.push(`DTEND:${utcStamp(new Date(start.getTime() + minutes * 60000))}`);
    }
    lines.push(`SUMMARY:${icsEscape(summary)}`);
    const details = [
      release.subtitle && releaseKind(release) !== "tv" ? release.subtitle : "",
      release.network,
      release.service ? `From ${release.service}` : "",
      release.hasFile ? "Downloaded" : "",
      release.overview,
    ].filter(Boolean);
    if (details.length) lines.push(`DESCRIPTION:${icsEscape(details.join("\n"))}`);
    lines.push(`CATEGORIES:${icsEscape(release.service || "JellyGlance")}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return `${lines.map(fold).join("\r\n")}\r\n`;
}

async function getCalendarReleases() {
  const data = await getIntegrationData();
  return Array.isArray(data?.calendar?.releases) ? data.calendar.releases : [];
}

async function buildFeed() {
  return buildIcs(await getCalendarReleases());
}

// ---- Daily digest -------------------------------------------------------

async function getDigestSettings() {
  const settings = await getSettings();
  return { ...DEFAULT_DIGEST, ...(settings.CalendarDigest || {}) };
}

async function saveDigestSettings(input = {}) {
  const current = await getDigestSettings();
  const hour = Number.parseInt(input.hour ?? current.hour, 10);
  const next = {
    ...current,
    enabled: input.enabled === undefined ? current.enabled : Boolean(input.enabled),
    hour: Number.isFinite(hour) ? Math.min(23, Math.max(0, hour)) : current.hour,
    includeMissing: input.includeMissing === undefined ? current.includeMissing : Boolean(input.includeMissing),
  };
  await saveSettings({ CalendarDigest: next });
  return next;
}

function localDayKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function sameLocalDay(a, b) {
  return localDayKey(a) === localDayKey(b);
}

function releaseLine(release) {
  const date = new Date(release.date);
  const time = isDateOnly(release, date) ? "" : ` (${date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })})`;
  const subtitle = release.subtitle && !/^(Movie release|Upcoming release)$/i.test(release.subtitle) ? ` — ${release.subtitle}` : "";
  return `• ${release.title}${subtitle}${time}${release.hasFile ? " ✓" : ""}`;
}

async function buildDigest({ now = new Date(), includeMissing = true } = {}) {
  const releases = (await getCalendarReleases()).map((release) => ({ ...release, dateValue: new Date(release.date) }));
  const today = releases
    .filter((release) => {
      const date = release.dateValue;
      // Date-only releases are stored as midnight UTC; compare those on their UTC date.
      return isDateOnly(release, date) ? date.toISOString().slice(0, 10) === localDayKey(now) : sameLocalDay(date, now);
    })
    .sort((a, b) => a.dateValue - b.dateValue);
  const weekAgo = new Date(now.getTime() - 7 * 86400000);
  const missing = includeMissing
    ? releases.filter((release) => release.monitored && !release.hasFile && release.type !== "audiobook" && release.releaseKind !== "In cinemas" && release.dateValue < new Date(now.getTime() - 6 * 3600000) && release.dateValue > weekAgo)
    : [];
  const sections = [];
  if (today.length) sections.push(`Today (${today.length})\n${today.slice(0, 25).map(releaseLine).join("\n")}${today.length > 25 ? `\n…and ${today.length - 25} more` : ""}`);
  else sections.push("Nothing is due today.");
  if (missing.length) sections.push(`Missing from the last week (${missing.length})\n${missing.slice(0, 15).map(releaseLine).join("\n")}${missing.length > 15 ? `\n…and ${missing.length - 15} more` : ""}`);
  return {
    event: "calendar_digest",
    integrationEvent: "Airing today",
    source: "Calendar",
    title: `Airing today · ${now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}`,
    todayCount: today.length,
    missingCount: missing.length,
    releases: today.slice(0, 25).map(({ dateValue, ...release }) => release),
    message: sections.join("\n\n"),
  };
}

async function sendDigest({ now = new Date(), force = false } = {}) {
  const settings = await getDigestSettings();
  const payload = await buildDigest({ now, includeMissing: settings.includeMissing });
  const WebhookManager = require("./webhook-manager");
  const manager = new WebhookManager();
  await manager.triggerEventWebhooks("calendar_digest", payload);
  if (typeof manager.flushCoalescedWebhooks === "function") await manager.flushCoalescedWebhooks();
  if (!force) await saveSettings({ CalendarDigest: { ...settings, lastSentDate: localDayKey(now) } });
  return payload;
}

// Called every few minutes by the background scheduler; sends at most once a day.
async function maybeSendDigest(now = new Date()) {
  const settings = await getDigestSettings();
  if (!settings.enabled) return null;
  if (now.getHours() < settings.hour) return null;
  if (settings.lastSentDate === localDayKey(now)) return null;
  return sendDigest({ now });
}

module.exports = {
  getFeedToken,
  rotateFeedToken,
  disableFeed,
  feedTokenMatches,
  buildIcs,
  buildFeed,
  getDigestSettings,
  saveDigestSettings,
  buildDigest,
  sendDigest,
  maybeSendDigest,
};

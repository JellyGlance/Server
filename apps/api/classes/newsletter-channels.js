// Discord and Telegram as optional digest channels. Delivery is off by default
// and is also hard-stopped by JG_DISABLE_NOTIFICATIONS=1. These channels are
// stored on Newsletter settings; they never use the general webhook table.
const { axios } = require("./axios");
const { encryptSecret, decryptSecret } = require("./integration-store");
const publicUrl = require("./newsletter-public-url");

function notificationsDisabled() {
  return process.env.JG_DISABLE_NOTIFICATIONS === "1";
}

function defaultChannels() {
  return {
    discord: { enabled: false, webhookUrl: "" },
    telegram: { enabled: false, botToken: "", chatId: "" },
  };
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function keepSecret(incoming, current) {
  const next = String(incoming || "").trim();
  if (!next || next === "********") return current || "";
  if (typeof current === "string" && current.startsWith("jgenc:") && next === current) return current;
  const encrypted = encryptSecret(next);
  return typeof encrypted === "string" && encrypted.startsWith("jgenc:") ? encrypted : next;
}

function revealSecret(value) {
  if (!value) return "";
  const modern = decryptSecret(value);
  if (modern && modern !== value) return modern;
  return value;
}

function normalizeChannels(input = {}, current = {}) {
  const incoming = asObject(input);
  const previous = { ...defaultChannels(), ...asObject(current) };
  const previousDiscord = asObject(previous.discord);
  const previousTelegram = asObject(previous.telegram);
  const nextDiscord = asObject(incoming.discord);
  const nextTelegram = asObject(incoming.telegram);
  return {
    discord: {
      enabled: Boolean(nextDiscord.enabled),
      webhookUrl: keepSecret(nextDiscord.webhookUrl, previousDiscord.webhookUrl),
    },
    telegram: {
      enabled: Boolean(nextTelegram.enabled),
      botToken: keepSecret(nextTelegram.botToken, previousTelegram.botToken),
      chatId: String(nextTelegram.chatId != null ? nextTelegram.chatId : previousTelegram.chatId || "").trim(),
    },
  };
}

function publicChannels(channels = {}) {
  const normalized = { ...defaultChannels(), ...asObject(channels) };
  const discord = asObject(normalized.discord);
  const telegram = asObject(normalized.telegram);
  return {
    discord: {
      enabled: Boolean(discord.enabled),
      webhookUrl: "",
      hasWebhook: Boolean(discord.webhookUrl),
    },
    telegram: {
      enabled: Boolean(telegram.enabled),
      botToken: "",
      hasBotToken: Boolean(telegram.botToken),
      chatId: String(telegram.chatId || ""),
    },
  };
}

function accentToColor(value, fallback = 0x6ee7f9) {
  const text = String(value || "").trim();
  const hex = text.startsWith("#") ? text.slice(1) : text;
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return fallback;
  return Number.parseInt(hex, 16);
}

function linkButton(label, url) {
  const href = publicUrl.safeHttpUrl(url);
  const text = String(label || "").trim();
  if (!href || !text) return null;
  return { type: 2, style: 5, label: text.slice(0, 80), url: href };
}

function fieldValue(value) {
  const text = String(value || "").trim();
  return text ? text.slice(0, 1024) : "";
}

function buildLinkButtons(links = []) {
  return (Array.isArray(links) ? links : []).map((link) => linkButton(link.label, link.url)).filter(Boolean).slice(0, 5);
}

function buildDiscordDigest({
  campaignName = "JellyGlance digest",
  subject = "",
  generatedAt = "",
  summary = "",
  items = [],
  links = [],
  accent,
  footer = "JellyGlance",
  posterUrl = "",
} = {}) {
  const buttons = buildLinkButtons(links);
  const fields = (Array.isArray(items) ? items : [])
    .slice(0, 8)
    .map((item, index) => {
      const name = String(item.name || item.Name || `Title ${index + 1}`).slice(0, 256);
      const meta = [item.meta, item.library, item.plays != null ? `${item.plays} plays` : ""]
        .filter(Boolean)
        .join(" · ")
        .slice(0, 1024);
      return { name, value: fieldValue(meta || "—"), inline: false };
    })
    .filter((field) => field.name);
  const poster = publicUrl.safeHttpUrl(posterUrl);
  return {
    content: subject ? String(subject).slice(0, 2000) : "",
    embeds: [
      {
        title: String(campaignName || "JellyGlance digest").slice(0, 256),
        description: String(summary || "").slice(0, 4096),
        color: accentToColor(accent),
        timestamp: generatedAt || new Date().toISOString(),
        ...(poster ? { thumbnail: { url: poster } } : {}),
        fields,
        footer: { text: String(footer || "JellyGlance").slice(0, 64) },
      },
    ],
    components: buttons.length ? [{ type: 1, components: buttons }] : [],
  };
}

function escapeTelegram(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function buildTelegramDigest({
  campaignName = "JellyGlance digest",
  subject = "",
  summary = "",
  items = [],
  links = [],
  posterUrl = "",
  chatId = "",
} = {}) {
  const lines = [
    `<b>${escapeTelegram(campaignName)}</b>`,
    subject ? escapeTelegram(subject) : "",
    summary ? escapeTelegram(summary) : "",
  ].filter(Boolean);
  const titles = (Array.isArray(items) ? items : []).slice(0, 8);
  if (titles.length) {
    lines.push("");
    titles.forEach((item, index) => {
      const name = escapeTelegram(item.name || item.Name || `Title ${index + 1}`);
      const meta = [item.meta, item.library].filter(Boolean).join(" · ");
      lines.push(`${index + 1}. ${name}${meta ? ` — ${escapeTelegram(meta)}` : ""}`);
    });
  }
  const keyboard = buildLinkButtons(links).map((button) => [{ text: button.label, url: button.url }]);
  const photo = publicUrl.safeHttpUrl(posterUrl);
  const payload = {
    chat_id: String(chatId || ""),
    parse_mode: "HTML",
    disable_web_page_preview: false,
    reply_markup: keyboard.length ? { inline_keyboard: keyboard } : undefined,
  };
  if (photo) {
    return { method: "sendPhoto", ...payload, photo, caption: lines.join("\n").slice(0, 1024) };
  }
  return { method: "sendMessage", ...payload, text: lines.join("\n").slice(0, 4096) };
}

async function postDiscordWebhook(webhookUrl, payload) {
  if (notificationsDisabled()) return { skipped: "notifications-disabled" };
  const url = publicUrl.safeHttpUrl(webhookUrl);
  if (!url || !/discord(?:app)?\.com\/api\/webhooks\//i.test(url)) {
    return { skipped: "invalid-webhook" };
  }
  const response = await axios.post(url, payload, { timeout: 12000, validateStatus: () => true });
  return { ok: response.status >= 200 && response.status < 300, status: response.status };
}

async function postTelegramMessage({ botToken, payload }) {
  if (notificationsDisabled()) return { skipped: "notifications-disabled" };
  const token = String(botToken || "").trim();
  if (!token || !/^[0-9]+:[A-Za-z0-9_-]+$/.test(token)) return { skipped: "invalid-token" };
  const method = payload?.method === "sendPhoto" ? "sendPhoto" : "sendMessage";
  const body = { ...payload };
  delete body.method;
  if (!body.chat_id) return { skipped: "missing-chat" };
  const response = await axios.post(`https://api.telegram.org/bot${token}/${method}`, body, {
    timeout: 12000,
    validateStatus: () => true,
  });
  return { ok: response.status >= 200 && response.status < 300, status: response.status };
}

async function deliverDigestChannels({ channels = {}, discordPayload, telegramPayload } = {}) {
  const normalized = { ...defaultChannels(), ...asObject(channels) };
  const results = { discord: { skipped: "channel-disabled" }, telegram: { skipped: "channel-disabled" } };
  if (notificationsDisabled()) {
    return { skipped: "notifications-disabled", discord: { skipped: "notifications-disabled" }, telegram: { skipped: "notifications-disabled" } };
  }
  if (normalized.discord.enabled) {
    results.discord = await postDiscordWebhook(revealSecret(normalized.discord.webhookUrl), discordPayload);
  }
  if (normalized.telegram.enabled) {
    results.telegram = await postTelegramMessage({
      botToken: revealSecret(normalized.telegram.botToken),
      payload: { ...telegramPayload, chat_id: telegramPayload?.chat_id || normalized.telegram.chatId },
    });
  }
  return results;
}

module.exports = {
  notificationsDisabled,
  defaultChannels,
  normalizeChannels,
  publicChannels,
  accentToColor,
  linkButton,
  buildLinkButtons,
  buildDiscordDigest,
  buildTelegramDigest,
  postDiscordWebhook,
  postTelegramMessage,
  deliverDigestChannels,
  revealSecret,
};

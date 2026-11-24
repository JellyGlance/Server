const { describe, it, after } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("module");

const originalLoad = Module._load;
const posts = [];

Module._load = function mockLoad(request, parent, isMain) {
  if (request === "./axios" && parent?.filename?.endsWith("newsletter-channels.js")) {
    return {
      axios: {
        post: async (url, body) => {
          posts.push({ url, body });
          return { status: 204 };
        },
      },
    };
  }
  return originalLoad(request, parent, isMain);
};

const channels = require("../classes/newsletter-channels");

describe("newsletter digest channels", () => {
  after(() => {
    Module._load = originalLoad;
  });

  it("keeps Discord and Telegram disabled by default", () => {
    const defaults = channels.defaultChannels();
    assert.equal(defaults.discord.enabled, false);
    assert.equal(defaults.telegram.enabled, false);
    const publicView = channels.publicChannels({
      discord: { enabled: true, webhookUrl: "https://discord.com/api/webhooks/example/token" },
      telegram: { enabled: true, botToken: "123:abc", chatId: "-1001" },
    });
    assert.equal(publicView.discord.webhookUrl, "");
    assert.equal(publicView.discord.hasWebhook, true);
    assert.equal(publicView.telegram.botToken, "");
    assert.equal(publicView.telegram.hasBotToken, true);
    assert.equal(publicView.telegram.chatId, "-1001");
  });

  it("builds a Discord embed with a poster and link buttons, and rejects unsafe URLs", () => {
    const payload = channels.buildDiscordDigest({
      campaignName: "Weekly digest",
      subject: "Week to 12 Nov 2026",
      summary: "26 plays this week",
      accent: "#6ee7f9",
      posterUrl: "http://127.0.0.1:3410/items/images/abc?tag=Primary",
      items: [{ name: "Gnomes", meta: "7 plays", library: "TV Shows" }],
      links: [
        { label: "Open JellyGlance", url: "http://127.0.0.1:3410" },
        { label: "Requests", url: "http://127.0.0.1:3410/requests" },
        { label: "Bad", url: "javascript:alert(1)" },
      ],
    });
    assert.equal(payload.embeds[0].title, "Weekly digest");
    assert.equal(payload.embeds[0].thumbnail.url, "http://127.0.0.1:3410/items/images/abc?tag=Primary");
    assert.equal(payload.embeds[0].fields[0].name, "Gnomes");
    assert.equal(payload.components[0].components.length, 2);
    assert.equal(payload.components[0].components[0].style, 5);
    assert.equal(payload.components[0].components[0].type, 2);
    assert.ok(!JSON.stringify(payload).includes("javascript:"));
  });

  it("builds a Telegram photo caption with inline buttons", () => {
    const payload = channels.buildTelegramDigest({
      campaignName: "Weekly digest",
      summary: "26 plays this week",
      posterUrl: "http://127.0.0.1:3410/items/images/abc",
      items: [{ name: "Gnomes", meta: "7 plays" }],
      links: [{ label: "Open", url: "http://127.0.0.1:3410" }],
      chatId: "123",
    });
    assert.equal(payload.method, "sendPhoto");
    assert.match(payload.caption, /Weekly digest/);
    assert.equal(payload.reply_markup.inline_keyboard[0][0].url, "http://127.0.0.1:3410");
  });

  it("does not post to Discord or Telegram when notifications are disabled", async () => {
    posts.length = 0;
    const previous = process.env.JG_DISABLE_NOTIFICATIONS;
    process.env.JG_DISABLE_NOTIFICATIONS = "1";
    try {
      const discord = await channels.postDiscordWebhook("https://discord.com/api/webhooks/example/token", { content: "hi" });
      const telegram = await channels.postTelegramMessage({
        botToken: "123:abc",
        payload: { method: "sendMessage", chat_id: "1", text: "hi" },
      });
      const delivered = await channels.deliverDigestChannels({
        channels: {
          discord: { enabled: true, webhookUrl: "https://discord.com/api/webhooks/example/token" },
          telegram: { enabled: true, botToken: "123:abc", chatId: "1" },
        },
        discordPayload: { content: "hi" },
        telegramPayload: { method: "sendMessage", text: "hi" },
      });
      assert.equal(discord.skipped, "notifications-disabled");
      assert.equal(telegram.skipped, "notifications-disabled");
      assert.equal(delivered.skipped, "notifications-disabled");
      assert.equal(posts.length, 0);
    } finally {
      if (previous == null) delete process.env.JG_DISABLE_NOTIFICATIONS;
      else process.env.JG_DISABLE_NOTIFICATIONS = previous;
    }
  });

  it("does not post when a channel is enabled in the payload but notifications would otherwise be on and the channel is off", async () => {
    posts.length = 0;
    const previous = process.env.JG_DISABLE_NOTIFICATIONS;
    delete process.env.JG_DISABLE_NOTIFICATIONS;
    try {
      const delivered = await channels.deliverDigestChannels({
        channels: channels.defaultChannels(),
        discordPayload: { content: "hi" },
        telegramPayload: { method: "sendMessage", chat_id: "1", text: "hi" },
      });
      assert.equal(delivered.discord.skipped, "channel-disabled");
      assert.equal(delivered.telegram.skipped, "channel-disabled");
      assert.equal(posts.length, 0);
    } finally {
      if (previous == null) delete process.env.JG_DISABLE_NOTIFICATIONS;
      else process.env.JG_DISABLE_NOTIFICATIONS = previous;
    }
  });
});

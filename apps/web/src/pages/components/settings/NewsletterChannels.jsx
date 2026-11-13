import { useEffect, useState } from "react";
import { Button, Form } from "react-bootstrap";
import axios from "../../../lib/axios_instance";
import { useTranslation } from "react-i18next";

function headers() {
  return { Authorization: `Bearer ${localStorage.getItem("token") || ""}` };
}

function DiscordPreview({ payload }) {
  const embed = payload?.embeds?.[0];
  if (!embed) return <div className="newsletter-empty">Generate a preview to see the Discord card.</div>;
  return (
    <div className="discord-embed-preview">
      {embed.thumbnail?.url ? <img src={embed.thumbnail.url} alt="" /> : null}
      <div>
        <strong>{embed.title}</strong>
        {embed.description ? <p>{embed.description}</p> : null}
        {(embed.fields || []).map((field) => (
          <div key={field.name} className="discord-embed-field">
            <span>{field.name}</span>
            <em>{field.value}</em>
          </div>
        ))}
        <div className="discord-embed-buttons">
          {(payload.components?.[0]?.components || []).map((button) => (
            <a key={button.label} href={button.url} target="_blank" rel="noreferrer">
              {button.label}
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}

function TelegramPreview({ payload }) {
  if (!payload) return <div className="newsletter-empty">Generate a preview to see the Telegram message.</div>;
  return (
    <div className="telegram-preview">
      {payload.photo ? <img src={payload.photo} alt="" /> : null}
      <pre>{payload.caption || payload.text}</pre>
      <div className="discord-embed-buttons">
        {(payload.reply_markup?.inline_keyboard || []).flat().map((button) => (
          <a key={button.text} href={button.url} target="_blank" rel="noreferrer">
            {button.text}
          </a>
        ))}
      </div>
    </div>
  );
}

export default function NewsletterChannels({ campaignId, locale, settings, onSave, busy }) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(settings?.channels || { discord: { enabled: false }, telegram: { enabled: false, chatId: "" } });
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setDraft(settings?.channels || draft);
  }, [settings]);

  async function loadPreview() {
    setLoading(true);
    try {
      const response = await axios.post("/newsletter/channels/preview", { campaignId, locale }, { headers: headers() });
      setPreview(response.data);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadPreview();
  }, [campaignId, locale]);

  function update(channel, field, value) {
    setDraft((current) => ({
      ...current,
      [channel]: { ...current[channel], [field]: value },
    }));
  }

  return (
    <div className="newsletter-settings-grid">
      <section className="newsletter-panel">
        <div className="newsletter-panel-title">
          <h3>{t("FEATURES.NEWSLETTER.CHANNELS_TITLE")}</h3>
        </div>
        <p className="newsletter-help">{t("FEATURES.NEWSLETTER.CHANNELS_INTRO")}</p>
        <p className="newsletter-help">{t("FEATURES.NEWSLETTER.CHANNELS_DISABLED_HELP")}</p>
        <div className="newsletter-form-grid">
          <div>
            <Form.Check
              type="switch"
              id="channel-discord"
              label={t("FEATURES.NEWSLETTER.CHANNEL_ENABLED")}
              checked={Boolean(draft.discord?.enabled)}
              onChange={(event) => update("discord", "enabled", event.target.checked)}
            />
            <Form.Group>
              <Form.Label>{t("FEATURES.NEWSLETTER.DISCORD_WEBHOOK")}</Form.Label>
              <Form.Control
                type="password"
                autoComplete="off"
                placeholder={settings?.channels?.discord?.hasWebhook ? t("FEATURES.NEWSLETTER.WEBHOOK_STORED") : "https://discord.com/api/webhooks/…"}
                value={draft.discord?.webhookUrl || ""}
                onChange={(event) => update("discord", "webhookUrl", event.target.value)}
              />
            </Form.Group>
          </div>
          <div>
            <Form.Check
              type="switch"
              id="channel-telegram"
              label={t("FEATURES.NEWSLETTER.CHANNEL_ENABLED")}
              checked={Boolean(draft.telegram?.enabled)}
              onChange={(event) => update("telegram", "enabled", event.target.checked)}
            />
            <Form.Group>
              <Form.Label>{t("FEATURES.NEWSLETTER.TELEGRAM_BOT_TOKEN")}</Form.Label>
              <Form.Control
                type="password"
                autoComplete="off"
                placeholder={settings?.channels?.telegram?.hasBotToken ? t("FEATURES.NEWSLETTER.TOKEN_STORED") : ""}
                value={draft.telegram?.botToken || ""}
                onChange={(event) => update("telegram", "botToken", event.target.value)}
              />
            </Form.Group>
            <Form.Group>
              <Form.Label>{t("FEATURES.NEWSLETTER.TELEGRAM_CHAT_ID")}</Form.Label>
              <Form.Control value={draft.telegram?.chatId || ""} onChange={(event) => update("telegram", "chatId", event.target.value)} />
            </Form.Group>
          </div>
        </div>
        <div className="newsletter-actions">
          <Button type="button" variant="outline-primary" onClick={loadPreview} disabled={loading}>
            {t("FEATURES.NEWSLETTER.REFRESH")}
          </Button>
          <Button type="button" onClick={() => onSave?.({ channels: draft })} disabled={Boolean(busy)}>
            {t("FEATURES.NEWSLETTER.SAVE_CHANNELS")}
          </Button>
        </div>
      </section>
      <section className="newsletter-panel">
        <div className="newsletter-panel-title">
          <h3>{t("FEATURES.NEWSLETTER.DISCORD_PREVIEW")}</h3>
        </div>
        <DiscordPreview payload={preview?.discord} />
      </section>
      <section className="newsletter-panel">
        <div className="newsletter-panel-title">
          <h3>{t("FEATURES.NEWSLETTER.TELEGRAM_PREVIEW")}</h3>
        </div>
        <TelegramPreview payload={preview?.telegram} />
      </section>
    </div>
  );
}

import { useEffect, useState } from "react";
import { Button, Form } from "react-bootstrap";
import axios from "../../../lib/axios_instance";
import { useTranslation } from "react-i18next";

function headers() {
  return { Authorization: `Bearer ${localStorage.getItem("token") || ""}` };
}

function formatDate(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" }).format(new Date(value));
}

export default function NewsletterArchive({ campaignId, locale, settings, onSave, busy }) {
  const { t } = useTranslation();
  const [enabled, setEnabled] = useState(Boolean(settings?.archive?.enabled));
  const [payload, setPayload] = useState(null);

  useEffect(() => {
    setEnabled(Boolean(settings?.archive?.enabled));
  }, [settings]);

  async function loadPreview() {
    const response = await axios.post("/newsletter/archive/preview", { campaignId, locale }, { headers: headers() });
    setPayload(response.data);
  }

  useEffect(() => {
    loadPreview().catch(() => {});
  }, [campaignId, locale]);

  return (
    <div className="newsletter-settings-grid">
      <section className="newsletter-panel">
        <div className="newsletter-panel-title">
          <h3>{t("FEATURES.NEWSLETTER.ARCHIVE_TITLE")}</h3>
        </div>
        <p className="newsletter-help">{t("FEATURES.NEWSLETTER.ARCHIVE_INTRO")}</p>
        <Form.Check
          type="switch"
          id="archive-enabled"
          label={t("FEATURES.NEWSLETTER.ARCHIVE_PUBLIC")}
          checked={enabled}
          onChange={(event) => setEnabled(event.target.checked)}
        />
        <p className="newsletter-help">{t("FEATURES.NEWSLETTER.ARCHIVE_PUBLIC_HELP")}</p>
        <ul className="newsletter-archive-admin-list">
          {(payload?.entries || []).map((entry) => (
            <li key={entry.id}>
              <strong>{entry.subject}</strong>
              <span>
                {formatDate(entry.publishedAt)}
                {entry.preview ? " · preview" : ""}
              </span>
            </li>
          ))}
        </ul>
        {!payload?.entries?.length ? <div className="newsletter-empty">{t("FEATURES.NEWSLETTER.ARCHIVE_EMPTY_ADMIN")}</div> : null}
        <div className="newsletter-actions">
          <Button type="button" variant="outline-primary" onClick={() => window.open("/newsletter-archive", "_blank", "noopener")}>
            {t("FEATURES.NEWSLETTER.OPEN_ARCHIVE")}
          </Button>
          <Button type="button" onClick={() => onSave?.({ archive: { enabled } })} disabled={Boolean(busy)}>
            {t("FEATURES.NEWSLETTER.SAVE_ARCHIVE")}
          </Button>
        </div>
      </section>
      <section className="newsletter-panel newsletter-preview-panel">
        <div className="newsletter-panel-title">
          <h3>{t("FEATURES.NEWSLETTER.ARCHIVE_PREVIEW")}</h3>
        </div>
        <div className="newsletter-preview-frame">
          {payload?.previewHtml ? (
            <iframe title={payload.previewSubject || t("FEATURES.NEWSLETTER.ARCHIVE_PREVIEW")} srcDoc={payload.previewHtml} />
          ) : (
            <div className="newsletter-empty">{t("FEATURES.NEWSLETTER.PREVIEW_EMPTY")}</div>
          )}
        </div>
      </section>
    </div>
  );
}

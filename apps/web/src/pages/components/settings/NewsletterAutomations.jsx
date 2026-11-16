import { useEffect, useState } from "react";
import { Button, Form } from "react-bootstrap";
import axios from "../../../lib/axios_instance";
import { useTranslation } from "react-i18next";

function headers() {
  return { Authorization: `Bearer ${localStorage.getItem("token") || ""}` };
}

const KINDS = [
  { key: "welcome", titleKey: "WELCOME_EMAIL", helpKey: "WELCOME_HELP", setting: "welcome" },
  { key: "milestone", titleKey: "MILESTONE_EMAIL", helpKey: "MILESTONE_HELP", setting: "milestone" },
  { key: "adminDigest", titleKey: "ADMIN_DIGEST_EMAIL", helpKey: "ADMIN_DIGEST_HELP", setting: "adminDigest" },
  { key: "reengagement", titleKey: "REENGAGE_EMAIL", helpKey: "REENGAGE_HELP", setting: "reengagement" },
];

export default function NewsletterAutomations({ locale, settings, onSave, busy }) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(settings?.automations || {});
  const [previews, setPreviews] = useState({});
  const [active, setActive] = useState("welcome");

  useEffect(() => {
    setDraft(settings?.automations || draft);
  }, [settings]);

  async function loadPreview(kind) {
    const response = await axios.post("/newsletter/automations/preview", { kind, locale }, { headers: headers() });
    setPreviews((current) => ({ ...current, [kind]: response.data }));
  }

  useEffect(() => {
    KINDS.forEach((item) => {
      loadPreview(item.key).catch(() => {});
    });
  }, [locale]);

  function update(setting, field, value) {
    setDraft((current) => ({
      ...current,
      [setting]: { ...current[setting], [field]: value },
    }));
  }

  const preview = previews[active];

  return (
    <div className="newsletter-settings-grid">
      <section className="newsletter-panel">
        <div className="newsletter-panel-title">
          <h3>{t("FEATURES.NEWSLETTER.AUTOMATIONS_TITLE")}</h3>
        </div>
        <p className="newsletter-help">{t("FEATURES.NEWSLETTER.AUTOMATIONS_INTRO")}</p>
        {KINDS.map((item) => (
          <article key={item.key} className={`newsletter-automation-card${active === item.key ? " is-active" : ""}`}>
            <button type="button" className="newsletter-block-name" onClick={() => setActive(item.key)}>
              <strong>{t(`FEATURES.NEWSLETTER.${item.titleKey}`)}</strong>
              <small>{t(`FEATURES.NEWSLETTER.${item.helpKey}`)}</small>
            </button>
            <Form.Check
              type="switch"
              id={`automation-${item.key}`}
              label={t("FEATURES.NEWSLETTER.AUTOMATION_ENABLED")}
              checked={Boolean(draft[item.setting]?.enabled)}
              onChange={(event) => update(item.setting, "enabled", event.target.checked)}
            />
            {item.key === "reengagement" ? (
              <Form.Group>
                <Form.Label>{t("FEATURES.NEWSLETTER.INACTIVE_DAYS")}</Form.Label>
                <Form.Control
                  type="number"
                  min="7"
                  max="365"
                  value={draft.reengagement?.inactiveDays || 30}
                  onChange={(event) => update("reengagement", "inactiveDays", Number(event.target.value))}
                />
              </Form.Group>
            ) : null}
          </article>
        ))}
        <div className="newsletter-actions">
          <Button type="button" onClick={() => onSave?.({ automations: draft })} disabled={Boolean(busy)}>
            {t("FEATURES.NEWSLETTER.SAVE_AUTOMATIONS")}
          </Button>
        </div>
      </section>
      <section className="newsletter-panel newsletter-preview-panel">
        <div className="newsletter-panel-title">
          <h3>{preview?.subject || t("FEATURES.NEWSLETTER.PREVIEW")}</h3>
          <Button type="button" size="sm" variant="outline-primary" onClick={() => loadPreview(active)}>
            {t("FEATURES.NEWSLETTER.REFRESH")}
          </Button>
        </div>
        <div className="newsletter-preview-frame">
          {preview?.html ? <iframe title={preview.subject} srcDoc={preview.html} /> : <div className="newsletter-empty">{t("FEATURES.NEWSLETTER.PREVIEW_EMPTY")}</div>}
        </div>
      </section>
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Form, Spinner, Tab, Tabs } from "react-bootstrap";
import ArticleLineIcon from "remixicon-react/ArticleLineIcon";
import ExternalLinkLineIcon from "remixicon-react/ExternalLinkLineIcon";
import MailCheckLineIcon from "remixicon-react/MailCheckLineIcon";
import MailSettingsLineIcon from "remixicon-react/MailSettingsLineIcon";
import RefreshLineIcon from "remixicon-react/RefreshLineIcon";
import SendPlaneLineIcon from "remixicon-react/SendPlaneLineIcon";
import axios from "../../../lib/axios_instance";
import NewsletterReportBuilder from "./NewsletterReportBuilder";
import NewsletterTemplateManager from "./NewsletterTemplateManager";
import { useTranslation } from "react-i18next";
import { languages as languageOptions } from "../../../lib/languages";
import "../../css/settings/settings.css";

const emptySettings = {
  enabled: false,
  senderName: "JellyGlance",
  senderEmail: "",
  recipients: [],
  frequency: "manual",
  smtp: {
    host: "",
    port: 587,
    secure: false,
    username: "",
    password: "",
    rejectUnauthorized: true,
    hasPassword: false,
  },
  history: [],
};

const HOUSE_SECTIONS = {
  recentlyAdded: true,
  topWatched: true,
  activeUsers: true,
  repairSummary: true,
  customHtml: "",
};

const PER_USER_SECTIONS = {
  continueWatching: true,
  myRequests: true,
  recentlyAdded: true,
  customHtml: "",
};

const emptyCampaign = {
  name: "",
  type: "global",
  frequency: "manual",
  enabled: false,
  audience: { recipients: [], roles: [] },
  ownerUserId: "",
  templateId: "",
  schedule: { ...emptySchedule },
  scheduleCron: null,
  sections: { ...HOUSE_SECTIONS },
};

function sectionsForType(type, sections = {}) {
  if (type === "per-user") {
    return { ...PER_USER_SECTIONS, ...sections, customHtml: sections.customHtml || "" };
  }
  return { ...HOUSE_SECTIONS, ...sections };
}

function headers() {
  return {
    Authorization: `Bearer ${localStorage.getItem("token")}`,
    "Content-Type": "application/json",
  };
}

function formatDate(value) {
  if (!value) return "Never";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}


const WEEKDAY_OPTIONS = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 0, label: "Sun" },
];

const emptySchedule = { weekdays: [1], dayOfMonth: "", hour: 9, minute: 0 };

function clampScheduleNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(number)));
}

function buildScheduleCron(schedule = {}) {
  const minute = clampScheduleNumber(schedule.minute, 0, 59, 0);
  const hour = clampScheduleNumber(schedule.hour, 0, 23, 9);
  const weekdays = [...new Set((schedule.weekdays || []).map((day) => Number(day)).filter((day) => day >= 0 && day <= 6))].sort((a, b) => a - b);
  const hasDay = schedule.dayOfMonth !== "" && schedule.dayOfMonth != null && Number.isFinite(Number(schedule.dayOfMonth));
  const dayOfMonth = hasDay ? clampScheduleNumber(schedule.dayOfMonth, 1, 31, 1) : null;
  if (!weekdays.length && dayOfMonth == null) return null;
  return `${minute} ${hour} ${dayOfMonth == null ? "*" : dayOfMonth} * ${weekdays.length ? weekdays.join(",") : "*"}`;
}

function parseScheduleCron(expression) {
  const parts = String(expression || "").trim().split(/\s+/);
  if (parts.length !== 5) return { ...emptySchedule };
  const [minute, hour, dayOfMonth, , dayOfWeek] = parts;
  const weekdays = dayOfWeek === "*" || dayOfWeek === "?"
    ? []
    : dayOfWeek.split(",").map((day) => (Number(day) === 7 ? 0 : Number(day))).filter((day) => day >= 0 && day <= 6);
  return {
    weekdays,
    dayOfMonth: dayOfMonth === "*" || dayOfMonth === "?" ? "" : Number(dayOfMonth) || "",
    hour: Number(hour) || 0,
    minute: Number(minute) || 0,
  };
}

function scheduleFromCampaign(campaign = {}) {
  if (campaign.schedule && (campaign.schedule.weekdays || campaign.schedule.dayOfMonth || campaign.schedule.hour != null)) {
    return {
      weekdays: campaign.schedule.weekdays || [],
      dayOfMonth: campaign.schedule.dayOfMonth ?? "",
      hour: campaign.schedule.hour ?? 9,
      minute: campaign.schedule.minute ?? 0,
    };
  }
  return parseScheduleCron(campaign.scheduleCron);
}

function formatTimeZoneLabel(timeZone) {
  return timeZone || "UTC";
}

function recipientsToText(recipients) {
  return Array.isArray(recipients) ? recipients.join("\n") : "";
}

function textToRecipients(value) {
  return String(value || "")
    .split(/[\n,;]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizePreviewPayload(payload) {
  const data = payload?.data && typeof payload.data === "object" ? payload.data : payload;
  const html = typeof data === "string" ? data : data?.html;
  if (!html || typeof html !== "string") return null;
  return {
    ...(typeof data === "object" ? data : {}),
    html,
    generatedAt: data?.generatedAt || new Date().toISOString(),
    subject: data?.subject || "JellyGlance newsletter preview",
  };
}

export default function NewsletterSettings() {
  const { t } = useTranslation();
  const [settings, setSettings] = useState(emptySettings);
  const [recipientText, setRecipientText] = useState("");
  const [selfEmail, setSelfEmail] = useState("");
  const [selfEmailMessage, setSelfEmailMessage] = useState("");
  const [availableLocales, setAvailableLocales] = useState([]);
  const [previewLocale, setPreviewLocale] = useState("en-GB");
  const [preview, setPreview] = useState(null);
  const [activeTab, setActiveTab] = useState("campaigns");
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState("");
  const [message, setMessage] = useState(null);
  const [campaignList, setCampaignList] = useState([]);
  const [campaignHistory, setCampaignHistory] = useState([]);
  const [campaignSchemaReady, setCampaignSchemaReady] = useState(true);
  const [selectedCampaignId, setSelectedCampaignId] = useState("");
  const [campaignDraft, setCampaignDraft] = useState(emptyCampaign);
  const [campaignRecipients, setCampaignRecipients] = useState("");
  const [audienceRoles, setAudienceRoles] = useState([]);
  const [directoryUsers, setDirectoryUsers] = useState([]);
  const [serverTimeZone, setServerTimeZone] = useState("UTC");
  const [templates, setTemplates] = useState([]);
  const [emailFonts, setEmailFonts] = useState([]);

  const recipientCount = useMemo(() => textToRecipients(recipientText).length, [recipientText]);
  const previewHtml = preview?.html || "";
  const selectedCampaign = campaignList.find((campaign) => campaign.id === selectedCampaignId) || null;


  function draftFromCampaign(campaign) {
    return {
      ...emptyCampaign,
      ...campaign,
      ownerUserId: campaign.ownerUserId || "",
      sections: sectionsForType(campaign.type, campaign.sections || {}),
      audience: { recipients: [], roles: [], ...(campaign.audience || {}) },
      schedule: scheduleFromCampaign(campaign),
    };
  }

  async function loadCampaigns() {
    const response = await axios.get("/newsletter/campaigns", { headers: headers() });
    const nextCampaigns = response.data?.campaigns || [];
    setCampaignSchemaReady(response.data?.schemaReady !== false);
    setCampaignList(nextCampaigns);
    setCampaignHistory(response.data?.history || []);
    setAudienceRoles(response.data?.roles || []);
    setDirectoryUsers(response.data?.users || []);
    setServerTimeZone(response.data?.timeZone || "UTC");
    setTemplates(response.data?.templates || []);
    setEmailFonts(response.data?.fonts || []);
    setSelfEmail(response.data?.selfEmail || "");
    setSelfEmailMessage(response.data?.selfEmailMessage || "");
    setAvailableLocales(response.data?.locales || []);
    const nextId = selectedCampaignId && nextCampaigns.some((campaign) => campaign.id === selectedCampaignId)
      ? selectedCampaignId
      : nextCampaigns[0]?.id || "";
    setSelectedCampaignId(nextId);
    const current = nextCampaigns.find((campaign) => campaign.id === nextId);
    if (current) {
      setCampaignDraft(draftFromCampaign(current));
      setCampaignRecipients(recipientsToText(current.audience?.recipients || []));
    }
  }

  async function loadNewsletter() {
    try {
      setLoading(true);
      const settingsResponse = await axios.get("/newsletter/settings", { headers: headers() });
      setSettings({
        ...emptySettings,
        ...settingsResponse.data,
        smtp: { ...emptySettings.smtp, ...(settingsResponse.data?.smtp || {}) },
      });
      setRecipientText(recipientsToText(settingsResponse.data?.recipients || []));
      await loadCampaigns();
    } catch (error) {
      setMessage({ type: "danger", text: error.response?.data?.error || "Unable to load newsletter settings." });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadNewsletter();
  }, []);

  useEffect(() => {
    if (activeTab !== "preview") return undefined;
    const timer = setTimeout(() => {
      generatePreview();
    }, 200);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewLocale, activeTab]);

  function updateField(field, value) {
    setSettings((current) => ({ ...current, [field]: value }));
  }

  function updateSmtp(field, value) {
    setSettings((current) => ({ ...current, smtp: { ...current.smtp, [field]: value } }));
  }

  function selectCampaign(campaignId) {
    setSelectedCampaignId(campaignId);
    const current = campaignList.find((campaign) => campaign.id === campaignId);
    if (!current) return;
    setCampaignDraft(draftFromCampaign(current));
    setCampaignRecipients(recipientsToText(current.audience?.recipients || []));
  }

  async function saveSettings(event) {
    event?.preventDefault();
    try {
      setBusyAction("save");
      setMessage(null);
      const response = await axios.post(
        "/newsletter/settings",
        {
          ...settings,
          recipients: textToRecipients(recipientText),
        },
        { headers: headers() }
      );
      setSettings({
        ...emptySettings,
        ...response.data,
        smtp: { ...emptySettings.smtp, ...(response.data?.smtp || {}) },
      });
      setRecipientText(recipientsToText(response.data?.recipients || []));
      setMessage({ type: "success", text: "Shared SMTP settings saved." });
    } catch (error) {
      setMessage({ type: "danger", text: error.response?.data?.error || "Unable to save newsletter settings." });
    } finally {
      setBusyAction("");
    }
  }

  async function saveCampaign() {
    try {
      setBusyAction("campaign-save");
      setMessage(null);
      const scheduleCron = campaignDraft.frequency === "manual" ? null : buildScheduleCron(campaignDraft.schedule);
      const payload = {
        ...campaignDraft,
        ownerUserId: campaignDraft.type === "personal" ? campaignDraft.ownerUserId || null : campaignDraft.ownerUserId || null,
        scheduleCron,
        schedule: campaignDraft.schedule,
        sections: sectionsForType(campaignDraft.type, campaignDraft.sections || {}),
        audience: {
          ...(campaignDraft.audience || {}),
          recipients: campaignDraft.type === "per-user" || campaignDraft.type === "personal" ? [] : textToRecipients(campaignRecipients),
          roles: campaignDraft.audience?.roles || [],
        },
      };
      if (selectedCampaignId) {
        await axios.put(`/newsletter/campaigns/${encodeURIComponent(selectedCampaignId)}`, payload, { headers: headers() });
      } else {
        const created = await axios.post("/newsletter/campaigns", payload, { headers: headers() });
        setSelectedCampaignId(created.data.id);
      }
      await loadCampaigns();
      setMessage({ type: "success", text: "Campaign saved." });
    } catch (error) {
      setMessage({ type: "danger", text: error.response?.data?.error || "Unable to save campaign." });
    } finally {
      setBusyAction("");
    }
  }

  async function createCampaign() {
    setSelectedCampaignId("");
    setCampaignDraft({ ...emptyCampaign, name: "New campaign" });
    setCampaignRecipients("");
  }

  async function sendCampaign() {
    if (!selectedCampaignId) return;
    const count = campaignDraft.type === "per-user" ? "opted-in users" : textToRecipients(campaignRecipients).length;
    const confirmed = window.confirm(`Send “${campaignDraft.name}” to ${count || "configured"} recipients?`);
    if (!confirmed) return;
    try {
      setBusyAction("campaign-send");
      const response = await axios.post(
        `/newsletter/campaigns/${encodeURIComponent(selectedCampaignId)}/send`,
        { recipients: campaignDraft.type === "per-user" ? [] : textToRecipients(campaignRecipients) },
        { headers: headers() }
      );
      setMessage({ type: "success", text: `Campaign sent to ${response.data.recipientCount} recipient${response.data.recipientCount === 1 ? "" : "s"}.` });
      await loadCampaigns();
    } catch (error) {
      setMessage({ type: "danger", text: error.response?.data?.error || "Unable to send campaign." });
      await loadCampaigns();
    } finally {
      setBusyAction("");
    }
  }

  async function generatePreview() {
    try {
      setBusyAction("preview");
      const response = await axios.get("/newsletter/preview", {
        headers: headers(),
        params: {
          locale: previewLocale,
          ...(selectedCampaignId ? { campaignId: selectedCampaignId } : {}),
        },
      });
      const nextPreview = normalizePreviewPayload(response.data);
      if (!nextPreview) {
        throw new Error("Preview endpoint did not return newsletter HTML.");
      }
      setPreview(nextPreview);
      setActiveTab("preview");
      setMessage({ type: "success", text: "Newsletter preview refreshed." });
    } catch (error) {
      setMessage({ type: "danger", text: error.response?.data?.error || error.message || "Unable to generate newsletter preview." });
    } finally {
      setBusyAction("");
    }
  }

  async function sendTest() {
    if (!selfEmail) {
      setMessage({ type: "danger", text: selfEmailMessage || "Your account has no email address, so a test newsletter cannot be sent." });
      return;
    }
    try {
      setBusyAction("test");
      const response = await axios.post(
        "/newsletter/test",
        { campaignId: selectedCampaignId || undefined },
        { headers: headers() }
      );
      setMessage({ type: "success", text: `Test newsletter sent to ${selfEmail}.` });
      await loadNewsletter();
    } catch (error) {
      setMessage({ type: "danger", text: error.response?.data?.error || "Unable to send test newsletter." });
      await loadNewsletter();
    } finally {
      setBusyAction("");
    }
  }

  function openPreviewTab() {
    if (!previewHtml) return;
    const previewWindow = window.open("", "_blank");
    if (!previewWindow) {
      setMessage({ type: "warning", text: "Browser blocked the preview tab. Allow popups for JellyGlance and try again." });
      return;
    }
    previewWindow.opener = null;
    previewWindow.document.open();
    previewWindow.document.write(previewHtml);
    previewWindow.document.close();
  }

  if (loading) {
    return (
      <div className="newsletter-settings newsletter-loading">
        <Spinner animation="border" />
      </div>
    );
  }

  return (
    <div className="newsletter-settings">
      <header className="settings-section-header">
        <div>
          <span>{t("FEATURES.NEWSLETTER.KICKER")}</span>
          <h2>{t("FEATURES.NEWSLETTER.TITLE")}</h2>
          <p>{t("FEATURES.NEWSLETTER.INTRO")}</p>
        </div>
        <Button type="button" variant="outline-primary" onClick={generatePreview} disabled={Boolean(busyAction)}>
          {busyAction === "preview" ? <Spinner size="sm" animation="border" /> : <RefreshLineIcon size={17} />}
          {t("FEATURES.NEWSLETTER.PREVIEW")}
        </Button>
      </header>

      {message ? (
        <Alert variant={message.type} onClose={() => setMessage(null)} dismissible>
          {message.text}
        </Alert>
      ) : null}

      {!campaignSchemaReady ? (
        <Alert variant="info">
          {t("FEATURES.NEWSLETTER.SCHEMA_INIT")}
        </Alert>
      ) : null}

      <Tabs activeKey={activeTab} onSelect={(key) => setActiveTab(key || "campaigns")} variant="pills" className="newsletter-tabs" transition={false}>
        <Tab eventKey="campaigns" title={t("FEATURES.NEWSLETTER.TAB_CAMPAIGNS")} className="newsletter-tab-pane">
          <div className="newsletter-settings-grid">
            <div className="newsletter-campaign-sidebar">
              <section className="newsletter-panel">
                <div className="newsletter-panel-title">
                  <ArticleLineIcon size={19} />
                  <h3>{t("FEATURES.NEWSLETTER.CAMPAIGNS")}</h3>
                  <Button type="button" size="sm" variant="outline-primary" onClick={createCampaign}>
                    {t("FEATURES.NEWSLETTER.NEW")}
                  </Button>
                </div>
                <div className="newsletter-history">
                  {campaignList.map((campaign) => (
                    <article
                      key={campaign.id}
                      role="button"
                      tabIndex={0}
                      className={campaign.id === selectedCampaignId ? "is-ok" : ""}
                      onClick={() => selectCampaign(campaign.id)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") selectCampaign(campaign.id);
                      }}
                    >
                      <strong>{campaign.name}</strong>
                      <span>
                        {campaign.type} · {campaign.frequency}
                        {campaign.enabled ? " · enabled" : " · paused"}
                      </span>
                      <time>Last sent {formatDate(campaign.lastSentAt)}</time>
                    </article>
                  ))}
                  {!campaignList.length ? <div className="newsletter-empty">{t("FEATURES.NEWSLETTER.EMPTY")}</div> : null}
                </div>
              </section>

              <section className="newsletter-panel newsletter-history-panel">
                <div className="newsletter-panel-title">
                  <MailCheckLineIcon size={19} />
                  <h3>{t("FEATURES.NEWSLETTER.HISTORY")}</h3>
                </div>
                <div className="newsletter-history">
                  {campaignHistory.map((entry) => (
                    <article key={entry.id} className={entry.status === "ok" ? "is-ok" : "is-error"}>
                      <strong>{entry.campaignName || "Campaign"} · {entry.mode}</strong>
                      <span>{entry.status === "ok" ? `${entry.recipientCount || 0} recipients` : entry.error}</span>
                      <time>{formatDate(entry.sentAt)}</time>
                    </article>
                  ))}
                  {!campaignHistory.length ? <div className="newsletter-empty">No campaign sends yet.</div> : null}
                </div>
              </section>
            </div>

            <Form
              className="newsletter-form"
              onSubmit={(event) => {
                event.preventDefault();
                saveCampaign();
              }}
            >
              <section className="newsletter-panel">
                <div className="newsletter-panel-title">
                  <MailCheckLineIcon size={19} />
                  <h3>{selectedCampaign ? t("FEATURES.NEWSLETTER.EDIT_CAMPAIGN") : t("FEATURES.NEWSLETTER.NEW")}</h3>
                </div>
                <div className="newsletter-form-grid">
                  <Form.Group>
                    <Form.Label>{t("FEATURES.NEWSLETTER.NAME")}</Form.Label>
                    <Form.Control value={campaignDraft.name} onChange={(event) => setCampaignDraft((current) => ({ ...current, name: event.target.value }))} />
                  </Form.Group>
                  <Form.Group>
                    <Form.Label>{t("FEATURES.NEWSLETTER.TYPE")}</Form.Label>
                    <Form.Select
                      value={campaignDraft.type}
                      onChange={(event) => {
                        const type = event.target.value;
                        setCampaignDraft((current) => ({
                          ...current,
                          type,
                          sections: sectionsForType(type, {
                            customHtml: current.sections?.customHtml || "",
                            ...(current.sections?.report ? { report: current.sections.report } : {}),
                          }),
                        }));
                      }}
                    >
                      <option value="global">{t("FEATURES.NEWSLETTER.TYPE_GLOBAL")}</option>
                      <option value="role">{t("FEATURES.NEWSLETTER.TYPE_ROLE")}</option>
                      <option value="personal">{t("FEATURES.NEWSLETTER.TYPE_PERSONAL")}</option>
                      <option value="per-user">{t("FEATURES.NEWSLETTER.TYPE_PER_USER")}</option>
                    </Form.Select>
                  </Form.Group>
                  <Form.Group>
                    <Form.Label>Template</Form.Label>
                    <Form.Select
                      value={campaignDraft.templateId || ""}
                      onChange={(event) => setCampaignDraft((current) => ({ ...current, templateId: event.target.value || null }))}
                    >
                      <option value="">Default layout</option>
                      {templates.map((template) => (
                        <option key={template.id} value={template.id}>
                          {template.name}
                        </option>
                      ))}
                    </Form.Select>
                  </Form.Group>
                  <Form.Group>
                    <Form.Label>{t("FEATURES.NEWSLETTER.FREQUENCY")}</Form.Label>
                    <Form.Select
                      value={campaignDraft.frequency}
                      onChange={(event) => {
                        const frequency = event.target.value;
                        setCampaignDraft((current) => {
                          const schedule = { ...current.schedule };
                          if (frequency === "weekly" && !schedule.weekdays?.length) schedule.weekdays = [1];
                          if (frequency === "monthly" && (schedule.dayOfMonth === "" || schedule.dayOfMonth == null)) schedule.dayOfMonth = 1;
                          return { ...current, frequency, schedule, scheduleCron: frequency === "manual" ? null : buildScheduleCron(schedule) };
                        });
                      }}
                    >
                      <option value="manual">Manual only</option>
                      <option value="weekly">Weekly</option>
                      <option value="monthly">Monthly</option>
                      <option value="scheduled">Custom</option>
                    </Form.Select>
                  </Form.Group>
                </div>
                {campaignDraft.frequency !== "manual" ? (
                  <div className="newsletter-schedule">
                    {campaignDraft.frequency === "weekly" || campaignDraft.frequency === "scheduled" ? (
                      <fieldset className="newsletter-chip-fieldset newsletter-schedule-weekdays">
                        <legend>Weekdays</legend>
                        <div className="newsletter-chip-row">
                          {WEEKDAY_OPTIONS.map((day) => {
                            const checked = (campaignDraft.schedule?.weekdays || []).includes(day.value);
                            return (
                              <label key={day.value} className={checked ? "is-on" : ""}>
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() =>
                                    setCampaignDraft((current) => {
                                      const selected = new Set(current.schedule?.weekdays || []);
                                      if (selected.has(day.value)) selected.delete(day.value);
                                      else selected.add(day.value);
                                      const schedule = { ...current.schedule, weekdays: [...selected].sort((a, b) => a - b) };
                                      return { ...current, schedule, scheduleCron: buildScheduleCron(schedule) };
                                    })
                                  }
                                />
                                {day.label}
                              </label>
                            );
                          })}
                        </div>
                      </fieldset>
                    ) : null}
                    <div className="newsletter-schedule-fields">
                    {campaignDraft.frequency === "monthly" || campaignDraft.frequency === "scheduled" ? (
                      <Form.Group>
                        <Form.Label>Day of month</Form.Label>
                        <Form.Control
                          type="number"
                          min="1"
                          max="31"
                          value={campaignDraft.schedule?.dayOfMonth ?? ""}
                          onChange={(event) =>
                            setCampaignDraft((current) => {
                              const schedule = { ...current.schedule, dayOfMonth: event.target.value === "" ? "" : Number(event.target.value) };
                              return { ...current, schedule, scheduleCron: buildScheduleCron(schedule) };
                            })
                          }
                        />
                      </Form.Group>
                    ) : null}
                    <Form.Group>
                      <Form.Label>Time</Form.Label>
                      <Form.Control
                        type="time"
                        value={`${String(campaignDraft.schedule?.hour ?? 9).padStart(2, "0")}:${String(campaignDraft.schedule?.minute ?? 0).padStart(2, "0")}`}
                        onChange={(event) => {
                          const [hour, minute] = String(event.target.value || "09:00").split(":");
                          setCampaignDraft((current) => {
                            const schedule = { ...current.schedule, hour: Number(hour) || 0, minute: Number(minute) || 0 };
                            return { ...current, schedule, scheduleCron: buildScheduleCron(schedule) };
                          });
                        }}
                      />
                    </Form.Group>
                    </div>
                    <p className="newsletter-help">
                      Times use the server timezone ({formatTimeZoneLabel(serverTimeZone)}). The campaign is stored as a cron expression and is only sent when that slot is due.
                    </p>
                  </div>
                ) : null}
                {campaignDraft.type === "role" ? (
                  <fieldset className="newsletter-chip-fieldset">
                    <legend>Audience roles and groups</legend>
                    <div className="newsletter-chip-row">
                      {(audienceRoles.length ? audienceRoles : ["Owner", "Admin", "Manager", "Viewer", "Household"]).map((role) => {
                        const checked = (campaignDraft.audience?.roles || []).includes(role);
                        return (
                          <label key={role} className={checked ? "is-on" : ""}>
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() =>
                                setCampaignDraft((current) => {
                                  const selected = new Set(current.audience?.roles || []);
                                  if (selected.has(role)) selected.delete(role);
                                  else selected.add(role);
                                  return { ...current, audience: { ...current.audience, roles: [...selected] } };
                                })
                              }
                            />
                            {role}
                          </label>
                        );
                      })}
                    </div>
                    <p className="newsletter-help">Users with a matching JellyGlance role or local group are added automatically if they have an email address.</p>
                  </fieldset>
                ) : null}
                {campaignDraft.type === "personal" ? (
                  <Form.Group>
                    <Form.Label>Campaign owner</Form.Label>
                    <Form.Select
                      value={campaignDraft.ownerUserId || ""}
                      onChange={(event) => setCampaignDraft((current) => ({ ...current, ownerUserId: event.target.value }))}
                    >
                      <option value="">Select a user</option>
                      {directoryUsers.map((user) => (
                        <option key={user.id} value={user.id}>
                          {user.name} · {user.role}{user.hasEmail ? "" : " (no email)"}
                        </option>
                      ))}
                    </Form.Select>
                    <Form.Text>The newsletter is sent only to this user&apos;s email.</Form.Text>
                  </Form.Group>
                ) : null}
                {campaignDraft.type === "per-user" ? (
                  <p className="newsletter-help">{t("FEATURES.NEWSLETTER.PER_USER_HELP")}</p>
                ) : campaignDraft.type === "personal" ? null : (
                  <Form.Group className="newsletter-recipient-box">
                    <Form.Label>{t("FEATURES.NEWSLETTER.CAMPAIGN_RECIPIENTS")}</Form.Label>
                    <Form.Control as="textarea" rows={4} value={campaignRecipients} onChange={(event) => setCampaignRecipients(event.target.value)} placeholder={"one@example.com\nfamily@example.com"} />
                  </Form.Group>
                )}
                <div className="newsletter-toggle-row">
                  <Form.Check
                    type="switch"
                    id="campaign-enabled"
                    label="Enable campaign"
                    checked={Boolean(campaignDraft.enabled)}
                    onChange={(event) => setCampaignDraft((current) => ({ ...current, enabled: event.target.checked }))}
                  />
                  {(campaignDraft.type === "per-user" ? ["continueWatching", "myRequests", "recentlyAdded"] : ["recentlyAdded", "topWatched", "activeUsers", "repairSummary"]).map((section) => (
                    <Form.Check
                      key={section}
                      type="switch"
                      id={`campaign-section-${section}`}
                      label={t(`FEATURES.NEWSLETTER.SECTION_${section}`, { defaultValue: section.replace(/([A-Z])/g, " $1") })}
                      checked={Boolean(campaignDraft.sections?.[section])}
                      onChange={(event) =>
                        setCampaignDraft((current) => ({
                          ...current,
                          sections: { ...current.sections, [section]: event.target.checked },
                        }))
                      }
                    />
                  ))}
                </div>
                <Form.Group className="newsletter-recipient-box">
                  <Form.Label>{t("FEATURES.NEWSLETTER.CUSTOM_HTML")}</Form.Label>
                  <Form.Control
                    as="textarea"
                    rows={3}
                    value={campaignDraft.sections?.customHtml || ""}
                    onChange={(event) =>
                      setCampaignDraft((current) => ({
                        ...current,
                        sections: { ...current.sections, customHtml: event.target.value },
                      }))
                    }
                    placeholder="Optional custom HTML appended to the digest"
                  />
                </Form.Group>
                {selfEmail ? (
                  <p className="newsletter-help">Test newsletters are sent only to your address, {selfEmail}.</p>
                ) : (
                  <p className="newsletter-help">{selfEmailMessage || "Your account has no email address, so a test newsletter cannot be sent. Add an email to your user and try again."}</p>
                )}
                <div className="newsletter-actions">
                  <Button type="submit" disabled={Boolean(busyAction)}>
                    {busyAction === "campaign-save" ? <Spinner size="sm" animation="border" /> : <MailCheckLineIcon size={17} />}
                    {t("FEATURES.NEWSLETTER.SAVE_CAMPAIGN")}
                  </Button>
                  <Button type="button" variant="outline-primary" onClick={sendTest} disabled={!selfEmail || Boolean(busyAction)} title={selfEmail ? `Send a test to ${selfEmail}` : "Your account has no email address"}>
                    {busyAction === "test" ? <Spinner size="sm" animation="border" /> : <SendPlaneLineIcon size={17} />}
                    {selfEmail ? `Send test to ${selfEmail}` : t("FEATURES.NEWSLETTER.SEND_TEST")}
                  </Button>
                  <Button type="button" variant="primary" onClick={sendCampaign} disabled={!selectedCampaignId || Boolean(busyAction)}>
                    {busyAction === "campaign-send" ? <Spinner size="sm" animation="border" /> : <SendPlaneLineIcon size={17} />}
                    {t("FEATURES.NEWSLETTER.SEND_CAMPAIGN")}
                  </Button>
                </div>
              </section>
            </Form>
          </div>
        </Tab>

        <Tab eventKey="templates" title="Templates" className="newsletter-tab-pane">
          <NewsletterTemplateManager templates={templates} fonts={emailFonts} onChange={loadCampaigns} onError={(text) => setMessage({ type: "danger", text })} />
        </Tab>

        <Tab eventKey="builder" title="Report builder" className="newsletter-tab-pane">
          <div className="report-builder-campaign">
            <Form.Select value={selectedCampaignId} onChange={(event) => selectCampaign(event.target.value)} aria-label="Campaign">
              {!selectedCampaignId ? <option value="">{campaignDraft.name || "New campaign"} (unsaved)</option> : null}
              {campaignList.map((campaign) => (
                <option key={campaign.id} value={campaign.id}>
                  {campaign.name} · {campaign.type}
                </option>
              ))}
            </Form.Select>
            <Button type="button" onClick={saveCampaign} disabled={Boolean(busyAction)}>
              {busyAction === "campaign-save" ? <Spinner size="sm" animation="border" /> : <MailCheckLineIcon size={17} />}
              {t("FEATURES.NEWSLETTER.SAVE_CAMPAIGN")}
            </Button>
            <Button type="button" variant="outline-primary" onClick={sendTest} disabled={!selfEmail || !selectedCampaignId || Boolean(busyAction)} title={selfEmail ? `Send a test to ${selfEmail}` : "Your account has no email address"}>
              {busyAction === "test" ? <Spinner size="sm" animation="border" /> : <SendPlaneLineIcon size={17} />}
              {selfEmail ? `Send test to ${selfEmail}` : t("FEATURES.NEWSLETTER.SEND_TEST")}
            </Button>
          </div>
          <NewsletterReportBuilder
            report={campaignDraft.sections?.report}
            campaignType={campaignDraft.type}
            campaignName={campaignDraft.name}
            campaignId={selectedCampaignId}
            onChange={(report) => setCampaignDraft((current) => ({ ...current, sections: { ...current.sections, report } }))}
          />
        </Tab>

        <Tab eventKey="settings" title={t("FEATURES.NEWSLETTER.TAB_SMTP")} className="newsletter-tab-pane">
          <div className="newsletter-settings-grid">
            <Form className="newsletter-form" onSubmit={saveSettings}>
              <section className="newsletter-panel">
                <div className="newsletter-panel-title">
                  <MailSettingsLineIcon size={19} />
                  <h3>{t("FEATURES.NEWSLETTER.TAB_SMTP")}</h3>
                </div>
                <div className="newsletter-form-grid">
                  <Form.Group>
                    <Form.Label>SMTP host</Form.Label>
                    <Form.Control value={settings.smtp.host} onChange={(event) => updateSmtp("host", event.target.value)} placeholder="smtp.example.com" />
                  </Form.Group>
                  <Form.Group>
                    <Form.Label>Port</Form.Label>
                    <Form.Control type="number" min="1" value={settings.smtp.port} onChange={(event) => updateSmtp("port", Number(event.target.value))} />
                  </Form.Group>
                  <Form.Group>
                    <Form.Label>Username</Form.Label>
                    <Form.Control value={settings.smtp.username} onChange={(event) => updateSmtp("username", event.target.value)} autoComplete="username" />
                  </Form.Group>
                  <Form.Group>
                    <Form.Label>Password</Form.Label>
                    <Form.Control
                      type="password"
                      value={settings.smtp.password}
                      onChange={(event) => updateSmtp("password", event.target.value)}
                      placeholder={settings.smtp.hasPassword ? "Stored password unchanged" : "SMTP password"}
                      autoComplete="new-password"
                    />
                  </Form.Group>
                  <Form.Group>
                    <Form.Label>Sender name</Form.Label>
                    <Form.Control value={settings.senderName} onChange={(event) => updateField("senderName", event.target.value)} />
                  </Form.Group>
                  <Form.Group>
                    <Form.Label>Sender email</Form.Label>
                    <Form.Control type="email" value={settings.senderEmail} onChange={(event) => updateField("senderEmail", event.target.value)} placeholder="jellyglance@example.com" />
                  </Form.Group>
                </div>
                <div className="newsletter-toggle-row">
                  <Form.Check type="switch" id="newsletter-secure" label="Use implicit TLS" checked={settings.smtp.secure} onChange={(event) => updateSmtp("secure", event.target.checked)} />
                  <Form.Check type="switch" id="newsletter-tls-verify" label="Verify TLS certificates" checked={settings.smtp.rejectUnauthorized} onChange={(event) => updateSmtp("rejectUnauthorized", event.target.checked)} />
                  <Form.Check type="switch" id="newsletter-enabled" label="Enable shared SMTP config" checked={settings.enabled} onChange={(event) => updateField("enabled", event.target.checked)} />
                </div>
                <Form.Group className="newsletter-recipient-box">
                  <Form.Label>Legacy default recipients</Form.Label>
                  <Form.Control as="textarea" rows={4} value={recipientText} onChange={(event) => setRecipientText(event.target.value)} placeholder={"one@example.com\nfamily@example.com"} />
                  <Form.Text>{recipientCount} recipient{recipientCount === 1 ? "" : "s"} used when a campaign has none configured.</Form.Text>
                </Form.Group>
                <div className="newsletter-actions">
                  <Button type="submit" disabled={Boolean(busyAction)}>
                    {busyAction === "save" ? <Spinner size="sm" animation="border" /> : <MailCheckLineIcon size={17} />}
                    {t("FEATURES.NEWSLETTER.SAVE_SMTP")}
                  </Button>
                </div>
              </section>
            </Form>
          </div>
        </Tab>

        <Tab eventKey="preview" title={t("FEATURES.NEWSLETTER.TAB_PREVIEW")} className="newsletter-tab-pane">
          <section className="newsletter-panel newsletter-preview-panel">
            <div className="newsletter-panel-title">
              <div>
                <ArticleLineIcon size={19} />
                <h3>{t("FEATURES.NEWSLETTER.TAB_PREVIEW")}</h3>
              </div>
              <div className="newsletter-preview-actions">
                <Button type="button" variant="outline-primary" size="sm" onClick={generatePreview} disabled={Boolean(busyAction)}>
                  {busyAction === "preview" ? <Spinner size="sm" animation="border" /> : <RefreshLineIcon size={15} />}
                  Refresh
                </Button>
                <Button type="button" variant="outline-primary" size="sm" onClick={openPreviewTab} disabled={!previewHtml}>
                  <ExternalLinkLineIcon size={15} />
                  Open in tab
                </Button>
              </div>
            </div>
            <div className="newsletter-preview-meta">
              <strong>{preview?.subject || "Newsletter preview"}</strong>
              <span>Generated {formatDate(preview?.generatedAt)}</span>
              <Form.Group className="newsletter-preview-locale">
                <Form.Label>Preview language</Form.Label>
                <Form.Select
                  value={previewLocale}
                  onChange={(event) => {
                    setPreviewLocale(event.target.value);
                  }}
                >
                  {(availableLocales.length ? availableLocales : languageOptions.map((language) => language.id)).map((locale) => {
                    const language = languageOptions.find((item) => item.id === locale);
                    return (
                      <option key={locale} value={locale}>
                        {language?.description || locale}
                      </option>
                    );
                  })}
                </Form.Select>
              </Form.Group>
            </div>
            <div className="newsletter-preview-frame">
              {previewHtml ? <iframe title={t("FEATURES.NEWSLETTER.PREVIEW_SUBJECT")} srcDoc={previewHtml} /> : <div className="newsletter-empty">{t("FEATURES.NEWSLETTER.PREVIEW_EMPTY")}</div>}
            </div>
          </section>
        </Tab>
      </Tabs>
    </div>
  );
}

import React, { useEffect, useMemo, useState } from "react";
import axios from "../../../lib/axios_instance";
import { Alert, Button, Form, Spinner } from "react-bootstrap";
import InformationLineIcon from "remixicon-react/InformationLineIcon";
import LinksLineIcon from "remixicon-react/LinksLineIcon";
import Notification3LineIcon from "remixicon-react/Notification3LineIcon";
import PlayCircleLineIcon from "remixicon-react/PlayCircleLineIcon";
import StopCircleLineIcon from "remixicon-react/StopCircleLineIcon";
import Movie2LineIcon from "remixicon-react/Movie2LineIcon";
import TaskLineIcon from "remixicon-react/TaskLineIcon";
import CalendarEventLineIcon from "remixicon-react/CalendarEventLineIcon";
import DownloadCloud2LineIcon from "remixicon-react/DownloadCloud2LineIcon";
import HeartPulseLineIcon from "remixicon-react/HeartPulseLineIcon";
import UserAddLineIcon from "remixicon-react/UserAddLineIcon";
import CheckboxCircleLineIcon from "remixicon-react/CheckboxCircleLineIcon";
import ErrorWarningLineIcon from "remixicon-react/ErrorWarningLineIcon";
import Edit2LineIcon from "remixicon-react/Edit2LineIcon";
import DeleteBinLineIcon from "remixicon-react/DeleteBinLineIcon";
import AlarmWarningLineIcon from "remixicon-react/AlarmWarningLineIcon";
import { Tooltip } from "@mui/material";
import { Trans, useTranslation } from "react-i18next";
import Loading from "../general/loading";
import ErrorBoundary from "../general/ErrorBoundary";
import { taskList } from "../../../lib/tasklist.jsx";
import "../../css/settings/settings.css";

const token = localStorage.getItem("token");

const webhookTypeMeta = {
  discord: {
    label: "Discord",
    placeholder: "https://discord.com/api/webhooks/...",
  },
  gotify: {
    label: "Gotify",
    placeholder: "https://gotify.example.com/message?token=APP_TOKEN",
  },
  ntfy: {
    label: "ntfy",
    placeholder: "https://ntfy.sh/your-topic",
  },
  telegram: {
    label: "Telegram",
    placeholder: "https://api.telegram.org/bot<token>/sendMessage?chat_id=<chat-id>",
  },
  pushover: {
    label: "Pushover",
    placeholder: "https://api.pushover.net/1/messages.json?token=APP_TOKEN&user=USER_KEY",
  },
  generic: {
    label: "Generic",
    placeholder: "https://example.com/webhook",
  },
};

const eventCards = [
  {
    id: "playback_started",
    title: "Playback started",
    text: "When a Jellyfin user starts watching.",
    Icon: PlayCircleLineIcon,
  },
  {
    id: "playback_ended",
    title: "Playback ended",
    text: "When a Jellyfin user finishes playback.",
    Icon: StopCircleLineIcon,
  },
  {
    id: "media_recently_added",
    title: "New media synced",
    text: "When recently added media is pulled in.",
    Icon: Movie2LineIcon,
  },
  {
    id: "task_started",
    title: "Task started",
    text: "When a JellyGlance job begins.",
    Icon: TaskLineIcon,
  },
  {
    id: "task_completed",
    title: "Task completed",
    text: "When a JellyGlance job completes.",
    Icon: CheckboxCircleLineIcon,
  },
  {
    id: "task_failed",
    title: "Task failed",
    text: "When a job fails or is stopped.",
    Icon: ErrorWarningLineIcon,
  },
  {
    id: "calendar_refreshed",
    title: "Calendar refreshed",
    text: "When Arr release data is pulled into Calendar.",
    Icon: CalendarEventLineIcon,
  },
  {
    id: "calendar_digest",
    title: "Airing today digest",
    text: "Once a day: what is due today and what went missing this week (turn it on from Calendar → Subscribe).",
    Icon: CalendarEventLineIcon,
  },
  {
    id: "leaving_soon",
    title: "Leaving soon",
    text: "When a cleanup rule puts titles in Leaving soon, so people can watch them before they go.",
    Icon: CalendarEventLineIcon,
  },
  {
    id: "download_queue_refreshed",
    title: "Downloads refreshed",
    text: "When download clients are polled.",
    Icon: DownloadCloud2LineIcon,
  },
  {
    id: "download_added",
    title: "Download added",
    text: "When a magnet, torrent URL, or torrent file is queued.",
    Icon: DownloadCloud2LineIcon,
  },
  {
    id: "download_completed",
    title: "Download completed",
    text: "When a download finishes.",
    Icon: CheckboxCircleLineIcon,
  },
  {
    id: "download_failed",
    title: "Download failed",
    text: "When a download client reports a failed item.",
    Icon: ErrorWarningLineIcon,
  },
  {
    id: "invite_created",
    title: "Invite created",
    text: "When a Wizarr invite link is created.",
    Icon: UserAddLineIcon,
  },
  {
    id: "invite_deleted",
    title: "Invite deleted",
    text: "When a Wizarr invite link is removed.",
    Icon: DeleteBinLineIcon,
  },
  {
    id: "invite_links_refreshed",
    title: "Invites refreshed",
    text: "When Wizarr invite state is synced.",
    Icon: LinksLineIcon,
  },
  {
    id: "integration_health_warning",
    title: "Integration health warning",
    text: "When a connected client test fails.",
    Icon: HeartPulseLineIcon,
  },
  {
    id: "threshold_alert",
    title: "Threshold alert",
    text: "Stuck downloads, low disk space, failed server jobs and new devices.",
    Icon: AlarmWarningLineIcon,
  },
  {
    id: "device_authorized",
    title: "New Jellyfin client",
    text: "When a device appears on Jellyfin that Glance has not seen before.",
    Icon: UserAddLineIcon,
  },
    {
    id: "ops_digest",
    title: "Ops digest",
    text: "When failed jobs, stuck downloads, or webhook failures pile up.",
    Icon: ErrorWarningLineIcon,
  },
  {
    id: "playback_digest",
    title: "Overnight playback digest",
    text: "One summary after quiet hours instead of overnight start/stop pings.",
    Icon: PlayCircleLineIcon,
  },
];

const eventPlaceholderGroups = {
  playback_started: ["{{UserName}}", "{{ItemName}}", "{{MediaType}}", "{{SeriesName}}", "{{PlayMethod}}", "{{DeviceName}}", "{{ClientName}}"],
  playback_ended: ["{{UserName}}", "{{ItemName}}", "{{PlaybackDuration}}", "{{StartTime}}", "{{EndTime}}", "{{PlayMethod}}"],
  download_added: ["{{itemName}}", "{{item.client}}", "{{item.state}}", "{{item.progress}}", "{{item.size}}"],
  download_completed: ["{{itemName}}", "{{item.client}}", "{{item.size}}", "{{item.addedAt}}"],
  download_failed: ["{{itemName}}", "{{item.client}}", "{{item.state}}", "{{message}}"],
};

const defaultWebhook = {
  name: "",
  url: "",
  enabled: true,
  method: "POST",
  webhook_type: "discord",
  events: [],
  taskFilters: [],
  rows: [],
  groupKey: null,
};

const taskEventIds = ["task_started", "task_completed", "task_failed"];

const webhookTemplates = [
  {
    id: "discord-ops",
    name: "Discord Ops",
    type: "discord",
    events: ["task_failed", "integration_health_warning", "download_failed", "threshold_alert"],
    taskFilters: [],
  },
  {
    id: "gotify-health",
    name: "Gotify Health",
    type: "gotify",
    events: ["integration_health_warning", "task_failed", "threshold_alert"],
    taskFilters: [],
  },
  {
    id: "downloads",
    name: "Download Alerts",
    type: "generic",
    events: ["download_added", "download_completed", "download_failed", "download_queue_refreshed"],
    taskFilters: [],
  },
  {
    id: "invites",
    name: "Invite Alerts",
    type: "discord",
    events: ["invite_created", "invite_deleted", "invite_links_refreshed"],
    taskFilters: ["InviteSync"],
  },
  {
    id: "media",
    name: "New Media",
    type: "discord",
    events: ["media_recently_added", "calendar_refreshed"],
    taskFilters: [],
  },
  {
    id: "tasks",
    name: "Task Watch",
    type: "generic",
    events: ["task_started", "task_completed", "task_failed"],
    taskFilters: [],
  },
];

function parsePayload(payload) {
  if (!payload) return {};
  if (typeof payload === "string") {
    try {
      return JSON.parse(payload || "{}");
    } catch {
      return {};
    }
  }
  return payload;
}

function groupWebhookRows(rows) {
  const groups = new Map();

  rows
    .filter((webhook) => webhook.trigger_type === "event")
    .forEach((webhook) => {
      const payload = parsePayload(webhook.payload);
      const groupKey = [
        webhook.name,
        webhook.url,
        webhook.webhook_type || "generic",
        webhook.method || "POST",
        JSON.stringify(webhook.headers || {}),
        JSON.stringify(payload || {}),
      ].join("::");

      if (!groups.has(groupKey)) {
        groups.set(groupKey, {
          groupKey,
          name: webhook.name,
          url: webhook.url,
          enabled: false,
          method: webhook.method || "POST",
          webhook_type: webhook.webhook_type || "generic",
          headers: webhook.headers,
          payload,
          taskFilters: Array.isArray(payload.taskFilters) ? payload.taskFilters : [],
          events: [],
          rows: [],
        });
      }

      const group = groups.get(groupKey);
      group.rows.push(webhook);
      group.enabled = group.enabled || webhook.enabled;
      if (webhook.event_type && !group.events.includes(webhook.event_type)) {
        group.events.push(webhook.event_type);
      }
    });

  return Array.from(groups.values()).sort((a, b) => a.name.localeCompare(b.name));
}

const CARD_DETAIL_TOGGLES = ["showPlayMethod", "showMetaLine", "showGenres", "showProgress", "showOverview"];
const CARD_ARTWORK_TOGGLES = ["showPoster", "showAvatar"];
const CARD_TOGGLE_KEYS = ["showClientIcon", "showMediaDetails", ...CARD_DETAIL_TOGGLES, ...CARD_ARTWORK_TOGGLES];

function normalizeCardState(data = {}) {
  const next = {
    style: data.style === "text" ? "text" : "card",
    theme: data.theme || "glance",
    accentColor: /^#[0-9a-f]{6}$/i.test(data.accentColor || "") ? data.accentColor : "",
  };
  for (const key of CARD_TOGGLE_KEYS) next[key] = data[key] !== false;
  return next;
}

function TextWebhookPreview({ settings, t }) {
  const details = settings.showMediaDetails !== false;
  const fields = [
    [t("FEATURES.OPS.PREVIEW_FIELD_CLIENT"), "Infuse · Apple TV"],
  ];
  if (settings.showPlayMethod !== false) fields.push([t("FEATURES.OPS.PREVIEW_FIELD_PLAYBACK"), "Direct Play"]);
  if (details) {
    fields.push([t("FEATURES.OPS.PREVIEW_FIELD_QUALITY"), "4K HDR10 · HEVC · EAC3 5.1"]);
    if (settings.showProgress !== false) fields.push([t("FEATURES.OPS.PREVIEW_FIELD_PROGRESS"), "18:04 / 45:10 (40%)"]);
    if (settings.showGenres !== false) fields.push([t("FEATURES.OPS.PREVIEW_FIELD_GENRES"), "Drama, Thriller, Mystery"]);
  }
  return (
    <div
      className="webhook-text-preview"
      aria-label={t("FEATURES.OPS.CARD_STYLE_text")}
      style={settings.accentColor ? { borderLeftColor: settings.accentColor } : undefined}
    >
      <div className="webhook-text-preview-body">
        <div className="webhook-text-preview-author">
          {settings.showAvatar !== false ? <span className="webhook-text-preview-avatar">N</span> : null}
          <span>Nerdy · {t("FEATURES.OPS.PREVIEW_NOW_PLAYING")}</span>
        </div>
        <strong className="webhook-text-preview-title">Night Shift</strong>
        <p className="webhook-text-preview-desc">
          S01E04 · The Watcher
          {details && settings.showMetaLine !== false ? <><br />2024 · TV-14 · 45m · ★ 8.2</> : null}
        </p>
        {details && settings.showOverview !== false ? (
          <p className="webhook-text-preview-overview">A late shift at the station turns strange when an old case resurfaces.</p>
        ) : null}
        <div className="webhook-text-preview-fields">
          {fields.map(([name, value]) => (
            <div key={name}>
              <span>{name}</span>
              <b>{value}</b>
            </div>
          ))}
        </div>
      </div>
      {settings.showPoster !== false ? <div className="webhook-text-preview-poster" aria-hidden="true" /> : null}
    </div>
  );
}

export default function WebhooksSettings() {
  const { t } = useTranslation();
  const [webhooks, setWebhooks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testingId, setTestingId] = useState(null);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);
  const [currentWebhook, setCurrentWebhook] = useState(defaultWebhook);
  const [quietHours, setQuietHours] = useState({ enabled: false, start: "22:00", end: "08:00", digest: true });
  const [quietSaving, setQuietSaving] = useState(false);
  const [cardSettings, setCardSettings] = useState(() => normalizeCardState());
  const [cardSaving, setCardSaving] = useState(false);
  const [cardPreviewUrl, setCardPreviewUrl] = useState("");
  const [accentDraft, setAccentDraft] = useState("");
  const cardPreviewKey = JSON.stringify({ ...cardSettings, style: undefined });

  useEffect(() => {
    setAccentDraft(cardSettings.accentColor || "");
  }, [cardSettings.accentColor]);

  const groupedWebhooks = useMemo(() => groupWebhookRows(webhooks), [webhooks]);
  const activeEventCount = groupedWebhooks.reduce(
    (total, group) => total + group.rows.filter((webhook) => webhook.enabled).length,
    0
  );

  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };

  async function loadWebhooks() {
    try {
      setError(null);
      const response = await axios.get("/webhooks", { headers });
      setWebhooks(response.data);
      const quietResponse = await axios.get("/webhooks/quiet-hours", { headers }).catch(() => null);
      if (quietResponse?.data) {
        setQuietHours({
          enabled: Boolean(quietResponse.data.enabled),
          start: quietResponse.data.start || "22:00",
          end: quietResponse.data.end || "08:00",
          digest: quietResponse.data.digest !== false,
        });
      }
      const cardResponse = await axios.get("/webhooks/card-settings", { headers }).catch(() => null);
      if (cardResponse?.data) {
        setCardSettings(normalizeCardState(cardResponse.data));
      }
    } catch (err) {
      console.error("Error loading webhooks:", err);
      setError("Unable to load webhooks: " + (err.response?.data?.error || err.message));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadWebhooks();
    const intervalId = setInterval(loadWebhooks, 1000 * 10);
    return () => clearInterval(intervalId);
  }, []);

  useEffect(() => {
    let active = true;
    let objectUrl = "";
    axios
      .get("/webhooks/card-preview", {
        headers,
        params: { ...cardSettings, style: undefined },
        responseType: "blob",
      })
      .then((response) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(response.data);
        setCardPreviewUrl((current) => {
          if (current) URL.revokeObjectURL(current);
          return objectUrl;
        });
      })
      .catch(() => {
        if (active) setCardPreviewUrl("");
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [cardPreviewKey]);

  async function saveCardSettings(nextCard) {
    try {
      setCardSaving(true);
      setError(null);
      const response = await axios.post("/webhooks/card-settings", nextCard, { headers });
      setCardSettings(normalizeCardState(response.data));
      setSuccess(t("FEATURES.OPS.CARD_SAVED"));
    } catch (err) {
      setError(err.response?.data?.error || t("FEATURES.OPS.CARD_SAVE_FAIL"));
    } finally {
      setCardSaving(false);
    }
  }

  async function saveQuietHours(nextQuiet) {
    try {
      setQuietSaving(true);
      setError(null);
      const response = await axios.post("/webhooks/quiet-hours", nextQuiet, { headers });
      setQuietHours({
        enabled: Boolean(response.data.enabled),
        start: response.data.start || "22:00",
        end: response.data.end || "08:00",
      });
      setSuccess(t("FEATURES.OPS.QUIET_SAVED"));
    } catch (err) {
      setError(err.response?.data?.error || t("FEATURES.OPS.QUIET_SAVE_FAIL"));
    } finally {
      setQuietSaving(false);
    }
  }

  function resetForm() {
    setCurrentWebhook(defaultWebhook);
  }

  function applyTemplate(template) {
    setError(null);
    setSuccess(false);
    setCurrentWebhook({
      ...defaultWebhook,
      name: template.name,
      webhook_type: template.type,
      events: template.events,
      taskFilters: template.taskFilters,
    });
  }

  function handleInputChange(event) {
    const { name, value } = event.target;
    setCurrentWebhook((prev) => ({ ...prev, [name]: value }));
  }

  function toggleSelectedEvent(eventType) {
    setCurrentWebhook((prev) => {
      const hasEvent = prev.events.includes(eventType);
      const nextEvents = hasEvent ? prev.events.filter((event) => event !== eventType) : [...prev.events, eventType];
      return {
        ...prev,
        events: nextEvents,
        taskFilters: nextEvents.some((event) => taskEventIds.includes(event)) ? prev.taskFilters : [],
      };
    });
  }

  function toggleTaskFilter(taskName) {
    setCurrentWebhook((prev) => {
      const hasTask = prev.taskFilters.includes(taskName);
      return {
        ...prev,
        taskFilters: hasTask ? prev.taskFilters.filter((task) => task !== taskName) : [...prev.taskFilters, taskName],
      };
    });
  }

  function clearTaskFilters() {
    setCurrentWebhook((prev) => ({ ...prev, taskFilters: [] }));
  }

  function editWebhookGroup(group) {
    setError(null);
    setSuccess(false);
    setCurrentWebhook({
      ...group,
      events: [...group.events],
    });
  }

  async function deleteWebhookGroup(group) {
    try {
      setSaving(true);
      setError(null);
      await Promise.all(group.rows.map((webhook) => axios.delete(`/webhooks/${webhook.id}`, { headers })));
      await loadWebhooks();
      if (currentWebhook.groupKey === group.groupKey) {
        resetForm();
      }
      setSuccess(`${group.name} deleted.`);
    } catch (err) {
      setError("Error while deleting webhook: " + (err.response?.data?.error || err.message));
    } finally {
      setSaving(false);
    }
  }

  async function handleTest(group) {
    const webhook = group.rows.find((row) => row.enabled) || group.rows[0];
    if (!webhook?.id) {
      return;
    }

    try {
      setTestingId(group.groupKey);
      setError(null);
      await axios.post(`/webhooks/${webhook.id}/test`, {}, { headers });
      setSuccess(`${group.name} test notification sent.`);
    } catch (err) {
      setError("Error during webhook test: " + (err.response?.data?.error || err.response?.data?.message || err.message));
    } finally {
      setTestingId(null);
    }
  }

  async function handleFormSubmit(event) {
    event.preventDefault();

    if (!currentWebhook.name.trim()) {
      setError("Webhook name is required");
      return;
    }

    if (!currentWebhook.url.trim()) {
      setError("Webhook URL is required");
      return;
    }

    if (!currentWebhook.events.length) {
      setError("Tick at least one event for this webhook");
      return;
    }

    try {
      setSaving(true);
      setError(null);
      setSuccess(false);

      const existingRows = currentWebhook.rows || [];
      const selectedEvents = new Set(currentWebhook.events);
      const hasTaskEvents = currentWebhook.events.some((event) => taskEventIds.includes(event));
      const taskFilters = hasTaskEvents ? currentWebhook.taskFilters || [] : [];
      const payload = {
        ...(currentWebhook.payload || {}),
        taskFilters,
      };
      if (!taskFilters.length) {
        delete payload.taskFilters;
      }
      const commonPayload = {
        name: currentWebhook.name.trim(),
        url: currentWebhook.url.trim(),
        enabled: currentWebhook.enabled,
        method: currentWebhook.method || "POST",
        webhook_type: currentWebhook.webhook_type || "generic",
        trigger_type: "event",
        schedule: null,
        headers: currentWebhook.headers || {},
        payload,
      };

      await Promise.all(
        eventCards.map(async (eventCard) => {
          const existing = existingRows.find((webhook) => webhook.event_type === eventCard.id);
          const shouldExist = selectedEvents.has(eventCard.id);

          if (existing && shouldExist) {
            await axios.put(
              `/webhooks/${existing.id}`,
              {
                ...commonPayload,
                event_type: eventCard.id,
              },
              { headers }
            );
            return;
          }

          if (!existing && shouldExist) {
            await axios.post(
              "/webhooks",
              {
                ...commonPayload,
                event_type: eventCard.id,
              },
              { headers }
            );
            return;
          }

          if (existing && !shouldExist) {
            await axios.delete(`/webhooks/${existing.id}`, { headers });
          }
        })
      );

      await loadWebhooks();
      setSuccess(`${currentWebhook.name.trim()} saved with ${currentWebhook.events.length} event${currentWebhook.events.length === 1 ? "" : "s"}.`);
      resetForm();
    } catch (err) {
      setError("Error while saving webhook: " + (err.response?.data?.error || err.message));
    } finally {
      setSaving(false);
    }
  }

  if (loading && !webhooks.length) {
    return <Loading />;
  }

  return (
    <div className="webhooks-settings">
      <div className="webhooks-hero">
        <div>
          <span>Notification Center</span>
          <h1>
            Webhook Configuration{" "}
            <Tooltip title={<Trans i18nKey={"SETTINGS_PAGE.WEBHOOKS_TOOLTIP"} />}>
              <InformationLineIcon size={20} />
            </Tooltip>
          </h1>
          <p>Add one or many webhook destinations, then tick exactly which JellyGlance events should trigger each one.</p>
        </div>
        <div className="webhooks-hero-stats">
          <strong>{groupedWebhooks.length}</strong>
          <small>Destinations</small>
          <strong>{activeEventCount}</strong>
          <small>Active event links</small>
        </div>
      </div>

      <section className="webhook-quiet-hours">
        <div>
          <h2>{t("FEATURES.OPS.QUIET_HOURS")}</h2>
          <p>{t("FEATURES.OPS.QUIET_HOURS_INTRO")}</p>
        </div>
        <label className="webhook-quiet-toggle">
          <input
            type="checkbox"
            checked={Boolean(quietHours.enabled)}
            disabled={quietSaving}
            onChange={(event) => saveQuietHours({ ...quietHours, enabled: event.target.checked })}
          />
          {t("FEATURES.OPS.QUIET_ENABLED")}
        </label>
        <label className="webhook-quiet-toggle">
          <input
            type="checkbox"
            checked={quietHours.digest !== false}
            disabled={quietSaving}
            onChange={(event) => saveQuietHours({ ...quietHours, digest: event.target.checked })}
          />
          {t("FEATURES.OPS.QUIET_DIGEST")}
        </label>
        <label>
          {t("FEATURES.OPS.QUIET_START")}
          <input
            type="time"
            value={quietHours.start}
            disabled={quietSaving}
            onChange={(event) => setQuietHours((current) => ({ ...current, start: event.target.value }))}
            onBlur={(event) => saveQuietHours({ ...quietHours, start: event.target.value })}
          />
        </label>
        <label>
          {t("FEATURES.OPS.QUIET_END")}
          <input
            type="time"
            value={quietHours.end}
            disabled={quietSaving}
            onChange={(event) => setQuietHours((current) => ({ ...current, end: event.target.value }))}
            onBlur={(event) => saveQuietHours({ ...quietHours, end: event.target.value })}
          />
        </label>
      </section>

      <section className="webhook-card-theme">
        <div>
          <h2>{t("FEATURES.OPS.CARD_THEME")}</h2>
          <p>{t("FEATURES.OPS.CARD_THEME_INTRO")}</p>
        </div>
        <div className="webhook-card-theme-options">
          <div className="webhook-card-theme-group webhook-card-style-group" role="group" aria-label={t("FEATURES.OPS.CARD_STYLE")}>
            {["card", "text"].map((style) => (
              <button
                type="button"
                key={style}
                className={cardSettings.style === style ? "is-active" : ""}
                disabled={cardSaving}
                title={t(`FEATURES.OPS.CARD_STYLE_${style}_HINT`)}
                onClick={() => saveCardSettings({ ...cardSettings, style })}
              >
                {t(`FEATURES.OPS.CARD_STYLE_${style}`)}
              </button>
            ))}
          </div>
          <div className="webhook-card-theme-group">
            <button
              type="button"
              className={cardSettings.theme === "match" ? "is-active" : ""}
              disabled={cardSaving}
              onClick={() => saveCardSettings({ ...cardSettings, theme: "match" })}
            >
              {t("FEATURES.OPS.THEME_match")}
            </button>
          </div>
          <div className="webhook-card-theme-group">
            {["glance", "jellyfin", "midnight", "compact"].map((theme) => (
              <button
                type="button"
                key={theme}
                className={cardSettings.theme === theme ? "is-active" : ""}
                disabled={cardSaving}
                onClick={() => saveCardSettings({ ...cardSettings, theme })}
              >
                {t(`FEATURES.OPS.THEME_${theme}`)}
              </button>
            ))}
          </div>
          <label className="webhook-quiet-toggle">
            <input
              type="checkbox"
              checked={cardSettings.showClientIcon !== false}
              disabled={cardSaving}
              onChange={(event) => saveCardSettings({ ...cardSettings, showClientIcon: event.target.checked })}
            />
            {t("FEATURES.OPS.SHOW_CLIENT_ICON")}
          </label>
          <label className="webhook-quiet-toggle">
            <input
              type="checkbox"
              checked={cardSettings.showMediaDetails !== false}
              disabled={cardSaving}
              onChange={(event) => saveCardSettings({ ...cardSettings, showMediaDetails: event.target.checked })}
            />
            {t("FEATURES.OPS.SHOW_MEDIA_DETAILS")}
          </label>
        </div>
        <div className="webhook-card-customise">
          <div className="webhook-card-accent">
            <span>{t("FEATURES.OPS.CARD_ACCENT")}</span>
            <input
              type="color"
              aria-label={t("FEATURES.OPS.CARD_ACCENT")}
              value={accentDraft || "#7c3aed"}
              disabled={cardSaving}
              onChange={(event) => setAccentDraft(event.target.value)}
              onBlur={() => {
                if (accentDraft && accentDraft !== cardSettings.accentColor) saveCardSettings({ ...cardSettings, accentColor: accentDraft });
              }}
            />
            <button
              type="button"
              className={!cardSettings.accentColor ? "is-active" : ""}
              disabled={cardSaving || !cardSettings.accentColor}
              onClick={() => saveCardSettings({ ...cardSettings, accentColor: "" })}
            >
              {t("FEATURES.OPS.CARD_ACCENT_EVENT")}
            </button>
          </div>
          <fieldset className="webhook-card-toggle-group" disabled={cardSaving}>
            <legend>{t("FEATURES.OPS.CARD_ARTWORK")}</legend>
            {CARD_ARTWORK_TOGGLES.map((key) => (
              <label className="webhook-quiet-toggle" key={key}>
                <input
                  type="checkbox"
                  checked={cardSettings[key] !== false}
                  onChange={(event) => saveCardSettings({ ...cardSettings, [key]: event.target.checked })}
                />
                {t(`FEATURES.OPS.CARD_TOGGLE_${key}`)}
              </label>
            ))}
          </fieldset>
          {cardSettings.showMediaDetails !== false ? (
            <fieldset className="webhook-card-toggle-group" disabled={cardSaving}>
              <legend>{t("FEATURES.OPS.CARD_DETAILS")}</legend>
              {CARD_DETAIL_TOGGLES.map((key) => (
                <label className="webhook-quiet-toggle" key={key}>
                  <input
                    type="checkbox"
                    checked={cardSettings[key] !== false}
                    onChange={(event) => saveCardSettings({ ...cardSettings, [key]: event.target.checked })}
                  />
                  {t(`FEATURES.OPS.CARD_TOGGLE_${key}`)}
                </label>
              ))}
            </fieldset>
          ) : null}
        </div>
        {cardSettings.style === "text" ? (
          <TextWebhookPreview settings={cardSettings} t={t} />
        ) : cardPreviewUrl ? (
          <img className="webhook-card-preview" src={cardPreviewUrl} alt={t("FEATURES.OPS.CARD_THEME")} />
        ) : null}
      </section>

      <ErrorBoundary>
        {error && (
          <Alert variant="danger" onClose={() => setError(null)} dismissible>
            {error}
          </Alert>
        )}
        {success && (
          <Alert variant="success" onClose={() => setSuccess(false)} dismissible>
            {success}
          </Alert>
        )}

        <Form onSubmit={handleFormSubmit} className="settings-form webhook-builder">
          <div className="webhook-builder-header">
            <div>
              <Notification3LineIcon size={22} />
              <strong>{currentWebhook.groupKey ? "Edit webhook destination" : "Add webhook destination"}</strong>
            </div>
            {currentWebhook.groupKey ? (
              <Button type="button" variant="outline-secondary" onClick={resetForm}>
                New webhook
              </Button>
            ) : null}
          </div>

          <div className="webhook-template-strip">
            {webhookTemplates.map((template) => (
              <button type="button" key={template.id} onClick={() => applyTemplate(template)}>
                {template.name}
              </button>
            ))}
          </div>

          <div className="webhook-form-grid">
            <Form.Group>
              <Form.Label>Webhook Name</Form.Label>
              <Form.Control type="text" name="name" value={currentWebhook.name} onChange={handleInputChange} placeholder="Discord alerts" required />
            </Form.Group>

            <Form.Group>
              <Form.Label>Webhook Type</Form.Label>
              <Form.Select name="webhook_type" value={currentWebhook.webhook_type} onChange={handleInputChange}>
                {Object.entries(webhookTypeMeta).map(([value, meta]) => (
                  <option key={value} value={value}>
                    {meta.label}
                  </option>
                ))}
              </Form.Select>
            </Form.Group>
          </div>

          <Form.Group>
            <Form.Label>Webhook URL</Form.Label>
            <Form.Control
              type="text"
              name="url"
              value={currentWebhook.url}
              onChange={handleInputChange}
              placeholder={webhookTypeMeta[currentWebhook.webhook_type || "generic"]?.placeholder}
              required
            />
            {currentWebhook.webhook_type === "gotify" ? (
              <small className="text-secondary d-block mt-2">Use the Gotify message endpoint with an app token.</small>
            ) : currentWebhook.webhook_type === "ntfy" ? (
              <small className="text-secondary d-block mt-2">Use a topic URL. For private servers, put the access token in Headers as Authorization Bearer.</small>
            ) : currentWebhook.webhook_type === "telegram" ? (
              <small className="text-secondary d-block mt-2">Use the Bot API sendMessage URL and include chat_id as a query parameter.</small>
            ) : currentWebhook.webhook_type === "pushover" ? (
              <small className="text-secondary d-block mt-2">Use the Pushover messages endpoint with token and user query parameters.</small>
            ) : null}
          </Form.Group>

          <div className="webhook-event-picker">
            <div className="webhook-event-picker-title">
              <LinksLineIcon size={19} />
              <strong>Trigger this webhook for</strong>
            </div>
            <div className="webhook-event-check-grid">
              {eventCards.map(({ id, title, text, Icon }) => {
                const checked = currentWebhook.events.includes(id);
                return (
                  <button
                    type="button"
                    key={id}
                    className={`webhook-event-check ${checked ? "is-selected" : ""}`}
                    onClick={() => toggleSelectedEvent(id)}
                    aria-pressed={checked}
                  >
                    <span>
                      <Icon size={19} />
                    </span>
                    <strong>{title}</strong>
                    <small>{text}</small>
                  </button>
                );
              })}
            </div>
            {currentWebhook.events.some((event) => eventPlaceholderGroups[event]) ? (
              <div className="webhook-placeholder-hint">
                <strong>Available placeholders</strong>
                <span>
                  {[
                    ...new Set(currentWebhook.events.flatMap((event) => eventPlaceholderGroups[event] || [])),
                  ].join("  ")}
                </span>
              </div>
            ) : null}
          </div>

          {currentWebhook.events.some((event) => taskEventIds.includes(event)) ? (
            <div className="webhook-task-picker">
              <div className="webhook-event-picker-title">
                <TaskLineIcon size={19} />
                <strong>Optional task filter</strong>
              </div>
              <p>Leave as all tasks, or choose specific JellyGlance jobs for task started/completed/failed events.</p>
              <div className="webhook-task-check-grid">
                <button
                  type="button"
                  className={`webhook-task-check ${currentWebhook.taskFilters.length === 0 ? "is-selected" : ""}`}
                  onClick={clearTaskFilters}
                >
                  All tasks
                </button>
                {taskList.map((task) => {
                  const checked = currentWebhook.taskFilters.includes(task.name);
                  return (
                    <button
                      type="button"
                      key={task.name}
                      className={`webhook-task-check ${checked ? "is-selected" : ""}`}
                      onClick={() => toggleTaskFilter(task.name)}
                      aria-pressed={checked}
                    >
                      {task.title}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          <div className="webhook-builder-actions">
            <Form.Check
              type="switch"
              id="webhook-enabled"
              label="Enable webhook"
              checked={currentWebhook.enabled}
              onChange={() => setCurrentWebhook((prev) => ({ ...prev, enabled: !prev.enabled }))}
            />
            <Button variant="primary" type="submit" disabled={saving}>
              {saving ? <Spinner size="sm" animation="border" /> : currentWebhook.groupKey ? "Save Changes" : "Add Webhook"}
            </Button>
          </div>
        </Form>

        <div className="webhook-destination-grid">
          {groupedWebhooks.map((group) => (
            <article className="webhook-destination-card" key={group.groupKey}>
              <div className="webhook-destination-top">
                <div>
                  <span>{webhookTypeMeta[group.webhook_type]?.label || group.webhook_type}</span>
                  <h2>{group.name}</h2>
                  <p>{group.url}</p>
                </div>
                <strong className={group.enabled ? "is-on" : ""}>{group.enabled ? "Enabled" : "Disabled"}</strong>
              </div>

              <div className="webhook-destination-events">
                {eventCards.map(({ id, title, Icon }) => (
                  <span key={id} className={group.events.includes(id) ? "is-selected" : ""}>
                    <Icon size={15} />
                    {title}
                  </span>
                ))}
              </div>
              {group.events.some((event) => taskEventIds.includes(event)) ? (
                <div className="webhook-destination-tasks">
                  <strong>Tasks</strong>
                  <span>
                    {group.taskFilters?.length
                      ? group.taskFilters
                          .map((taskName) => taskList.find((task) => task.name === taskName)?.title || taskName)
                          .join(", ")
                      : "All tasks"}
                  </span>
                </div>
              ) : null}

              <div className="webhook-destination-actions">
                <Button variant="outline-secondary" onClick={() => handleTest(group)} disabled={testingId === group.groupKey}>
                  {testingId === group.groupKey ? <Spinner size="sm" animation="border" /> : "Test"}
                </Button>
                <Button variant="outline-primary" onClick={() => editWebhookGroup(group)}>
                  <Edit2LineIcon size={16} />
                  Edit
                </Button>
                <Button variant="outline-secondary" onClick={() => deleteWebhookGroup(group)} disabled={saving}>
                  <DeleteBinLineIcon size={16} />
                  Delete
                </Button>
              </div>
            </article>
          ))}

          {groupedWebhooks.length === 0 ? (
            <div className="webhook-empty-state">
              <LinksLineIcon size={28} />
              <strong>No webhooks yet</strong>
              <span>Add a destination above, tick the events, and JellyGlance will notify it automatically.</span>
            </div>
          ) : null}
        </div>
      </ErrorBoundary>
    </div>
  );
}

import { useEffect, useState } from "react";
import { Alert, Button, Form, Spinner } from "react-bootstrap";
import ComputerLineIcon from "remixicon-react/ComputerLineIcon";
import Filter3LineIcon from "remixicon-react/Filter3LineIcon";
import Notification3LineIcon from "remixicon-react/Notification3LineIcon";
import Save3LineIcon from "remixicon-react/Save3LineIcon";
import SendPlaneLineIcon from "remixicon-react/SendPlaneLineIcon";
import ShieldCheckLineIcon from "remixicon-react/ShieldCheckLineIcon";
import SmartphoneLineIcon from "remixicon-react/SmartphoneLineIcon";
import axios from "../../../lib/axios_instance";
import Config from "../../../lib/config";
import {
  NOTIFICATION_CATEGORIES,
  defaultNotificationSettings,
  normalizeNotificationSettings,
  storeNotificationSettings,
} from "../../../lib/notification-settings";
import { isMobileDevice, isStandaloneApp, requestSystemPermission, showSystemNotification, systemPermission } from "../../../lib/system-notifications";
import "../../css/settings/settings.css";
import ThresholdAlertsPanel from "./ThresholdAlertsPanel";
import WebhookOutPanel from "./WebhookOutPanel";

const modes = [
  { value: "all", title: "All notifications", text: "Show starts, updates, successes, warnings, and errors." },
  { value: "important", title: "Warnings and errors", text: "Hide automatic success and progress messages." },
  { value: "errors", title: "Errors only", text: "Only interrupt for failed or stopped work." },
  { value: "off", title: "Off", text: "Hide background notifications." },
];

const permissionLabels = {
  granted: { label: "Allowed", tone: "ok" },
  denied: { label: "Blocked in browser settings", tone: "bad" },
  default: { label: "Not asked yet", tone: "idle" },
  insecure: { label: "Needs HTTPS", tone: "bad" },
  unsupported: { label: "Not supported by this browser", tone: "bad" },
};

export default function NotificationSettings() {
  const [settings, setSettings] = useState(defaultNotificationSettings);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);
  const [permission, setPermission] = useState(() => systemPermission());
  const mobile = isMobileDevice();
  const deviceKey = mobile ? "mobile" : "desktop";
  const deviceName = mobile ? "Mobile" : "Desktop";
  const permissionInfo = permissionLabels[permission] || permissionLabels.unsupported;

  useEffect(() => {
    Config.getConfig(true)
      .then((config) => {
        const nextSettings = normalizeNotificationSettings(config?.settings?.notifications);
        setSettings(storeNotificationSettings(nextSettings));
      })
      .catch(() => {
        setMessage({ type: "warning", text: "Using browser notification preferences until the backend is reachable." });
      })
      .finally(() => setLoading(false));
  }, []);

  function updateSetting(key, value) {
    setSettings((current) => normalizeNotificationSettings({ ...current, [key]: value }));
  }

  function updateCategory(key, value) {
    setSettings((current) => normalizeNotificationSettings({ ...current, categories: { ...current.categories, [key]: value } }));
  }

  async function allowOnDevice() {
    const result = await requestSystemPermission();
    setPermission(systemPermission());
    if (result === "granted") {
      updateSetting(deviceKey, true);
      setMessage({ type: "success", text: `${deviceName} notifications are allowed on this device. Save to keep them switched on.` });
    } else if (result === "insecure") {
      setMessage({ type: "warning", text: "Browsers only allow system notifications over HTTPS (or localhost). Open JellyGlance through your HTTPS reverse proxy and allow them there." });
    } else if (result === "denied") {
      setMessage({ type: "warning", text: "Notifications are blocked for this site. Allow them in your browser's site settings, then try again." });
    }
  }

  async function sendTest() {
    const sent = await showSystemNotification("JellyGlance", "Test notification. System notifications are working on this device.", { tag: "jellyglance-test" });
    setMessage(sent ? { type: "success", text: "Test notification sent." } : { type: "warning", text: "The test couldn't be shown. Check that notifications are allowed for this site." });
  }

  function toggleDevice(key, value) {
    updateSetting(key, value);
    if (value && key === deviceKey && permission === "default") {
      allowOnDevice();
    }
  }

  async function saveSettings(event) {
    event.preventDefault();
    try {
      setSaving(true);
      setMessage(null);
      const response = await axios.post("/api/notification-settings", settings, {
        headers: {
          Authorization: `Bearer ${localStorage.getItem("token")}`,
          "Content-Type": "application/json",
        },
      });
      const saved = storeNotificationSettings(response.data);
      setSettings(saved);
      await Config.setConfig();
      setMessage({ type: "success", text: "Notification settings saved." });
    } catch (error) {
      storeNotificationSettings(settings);
      setMessage({ type: "danger", text: error.response?.data?.error || "Unable to save notification settings." });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="notification-settings notification-settings-loading">
        <Spinner animation="border" />
      </div>
    );
  }

  return (
    <Form className="notification-settings" onSubmit={saveSettings}>
      <header className="settings-section-header">
        <div>
          <span>Alerts</span>
          <h2>Notifications</h2>
          <p>Choose where JellyGlance tells you about syncs, backups, tasks, downloads and playback, and which of those you want to hear about.</p>
        </div>
      </header>

      {message ? (
        <Alert variant={message.type} onClose={() => setMessage(null)} dismissible>
          {message.text}
        </Alert>
      ) : null}

      <section className="notification-panel">
        <div className="notification-panel-title">
          <Notification3LineIcon size={20} />
          <h3>Delivery</h3>
        </div>
        <Form.Check
          type="switch"
          id="notify-in-app"
          className="notification-switch"
          label="In-app pop-ups (toasts inside JellyGlance)"
          checked={settings.inApp}
          onChange={(event) => updateSetting("inApp", event.target.checked)}
        />
        <Form.Check
          type="switch"
          id="notify-desktop"
          className="notification-switch"
          label={<span className="notification-switch-label"><ComputerLineIcon size={16} /> Desktop notifications</span>}
          checked={settings.desktop}
          onChange={(event) => toggleDevice("desktop", event.target.checked)}
        />
        <Form.Check
          type="switch"
          id="notify-mobile"
          className="notification-switch"
          label={<span className="notification-switch-label"><SmartphoneLineIcon size={16} /> Mobile notifications</span>}
          checked={settings.mobile}
          onChange={(event) => toggleDevice("mobile", event.target.checked)}
        />
        <Form.Check
          type="switch"
          id="notify-hidden-only"
          className="notification-switch"
          label="Only send desktop and mobile notifications when JellyGlance isn't in focus"
          checked={settings.systemOnlyWhenHidden}
          disabled={!settings.desktop && !settings.mobile}
          onChange={(event) => updateSetting("systemOnlyWhenHidden", event.target.checked)}
        />

        <div className="notification-device-row">
          <span>
            <strong>
              {mobile ? <SmartphoneLineIcon size={16} /> : <ComputerLineIcon size={16} />} This device: {deviceName}
              {isStandaloneApp() ? " (installed app)" : ""}
            </strong>
            <small className={`notification-permission is-${permissionInfo.tone}`}>
              <ShieldCheckLineIcon size={13} /> {permissionInfo.label}
              {settings[deviceKey] ? "" : ` · ${deviceName.toLowerCase()} notifications are switched off`}
            </small>
          </span>
          <div className="notification-device-actions">
            {permission !== "granted" ? (
              <Button type="button" variant="outline-light" size="sm" onClick={allowOnDevice} disabled={permission === "unsupported"}>
                <ShieldCheckLineIcon size={15} /> Allow on this device
              </Button>
            ) : null}
            <Button type="button" variant="outline-light" size="sm" onClick={sendTest} disabled={permission !== "granted"}>
              <SendPlaneLineIcon size={15} /> Send test
            </Button>
          </div>
        </div>
        <p className="notification-device-copy">
          {permission === "insecure"
            ? "Browsers only allow desktop and mobile notifications on HTTPS or localhost, so they can't be enabled on this plain-HTTP address. Open JellyGlance through your HTTPS domain to allow them. "
            : ""}
          Desktop and mobile notifications arrive while JellyGlance is open in a tab or as an installed app, and permission is granted per browser. On iPhone and iPad, add JellyGlance to your Home Screen first. For alerts when JellyGlance is closed, use a Discord or Gotify webhook.
        </p>
      </section>

      <section className="notification-panel">
        <div className="notification-panel-title">
          <Filter3LineIcon size={20} />
          <h3>What to notify about</h3>
        </div>
        <div className="notification-category-grid">
          {NOTIFICATION_CATEGORIES.map((category) => (
            <Form.Check
              key={category.key}
              type="switch"
              id={`notify-category-${category.key}`}
              className="notification-switch notification-category"
              checked={settings.categories?.[category.key] !== false}
              onChange={(event) => updateCategory(category.key, event.target.checked)}
              label={
                <span className="notification-category-copy">
                  <strong>{category.title}</strong>
                  <small>{category.text}</small>
                </span>
              }
            />
          ))}
        </div>
      </section>

      <section className="notification-panel">
        <div className="notification-panel-title">
          <Notification3LineIcon size={20} />
          <h3>How much to show</h3>
        </div>
        <div className="notification-mode-grid">
          {modes.map((mode) => (
            <button
              key={mode.value}
              type="button"
              className={settings.mode === mode.value ? "is-active" : ""}
              onClick={() => updateSetting("mode", mode.value)}
            >
              <strong>{mode.title}</strong>
              <span>{mode.text}</span>
            </button>
          ))}
        </div>
        <Form.Check
          type="switch"
          id="manual-task-notifications"
          className="notification-switch"
          label="Always show manually triggered task notifications"
          checked={settings.manualTaskToasts}
          onChange={(event) => updateSetting("manualTaskToasts", event.target.checked)}
        />
      </section>

      {settings.inApp ? (
        <section className="notification-panel">
          <div className="notification-panel-title">
            <Notification3LineIcon size={20} />
            <h3>In-app pop-ups</h3>
          </div>
          <div className="notification-field-grid">
            <Form.Group>
              <Form.Label>Screen position</Form.Label>
              <Form.Select value={settings.position} onChange={(event) => updateSetting("position", event.target.value)}>
                <option value="bottom-right">Bottom right</option>
                <option value="bottom-center">Bottom center</option>
                <option value="top-right">Top right</option>
                <option value="top-center">Top center</option>
              </Form.Select>
            </Form.Group>
            <Form.Group>
              <Form.Label>Display duration</Form.Label>
              <Form.Control
                type="number"
                min="3"
                max="30"
                value={settings.durationSeconds}
                onChange={(event) => updateSetting("durationSeconds", Number(event.target.value))}
              />
              <Form.Text>Seconds before a toast closes.</Form.Text>
            </Form.Group>
          </div>
        </section>
      ) : null}

      <div className="notification-actions">
        <Button type="submit" disabled={saving}>
          {saving ? <Spinner size="sm" animation="border" /> : <Save3LineIcon size={17} />}
          Save notifications
        </Button>
      </div>
      <ThresholdAlertsPanel />
      <WebhookOutPanel />
    </Form>
  );
}

import { useEffect, useMemo, useState } from "react";
import axios from "../../../lib/axios_instance";
import CheckboxCircleLineIcon from "remixicon-react/CheckboxCircleLineIcon";
import ErrorWarningLineIcon from "remixicon-react/ErrorWarningLineIcon";
import HeartPulseLineIcon from "remixicon-react/HeartPulseLineIcon";
import HistoryLineIcon from "remixicon-react/HistoryLineIcon";
import Notification3LineIcon from "remixicon-react/Notification3LineIcon";
import DatabaseLineIcon from "remixicon-react/Database2LineIcon";
import RefreshLineIcon from "remixicon-react/RefreshLineIcon";
import { Button, Spinner } from "react-bootstrap";
import { useTranslation } from "react-i18next";

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
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function detailText(details = {}) {
  const entries = Object.entries(details || {}).filter(([, value]) => value !== undefined && value !== null && value !== "");
  if (!entries.length) return "No details";
  return entries.map(([key, value]) => `${key}: ${typeof value === "object" ? JSON.stringify(value) : value}`).join(" · ");
}

export default function HealthSettings() {
  const { t } = useTranslation();
  const [health, setHealth] = useState(null);
  const [deliveries, setDeliveries] = useState([]);
  const [audit, setAudit] = useState([]);
  const [loading, setLoading] = useState(true);
  const [retention, setRetention] = useState(100);
  const [retryingId, setRetryingId] = useState("");
  const [playbackRetention, setPlaybackRetention] = useState(null);
  const [playbackEnabled, setPlaybackEnabled] = useState(false);
  const [playbackDays, setPlaybackDays] = useState(365);
  const [playbackConfirmed, setPlaybackConfirmed] = useState(false);
  const [playbackMessage, setPlaybackMessage] = useState("");

  const recentFailures = useMemo(() => deliveries.filter((delivery) => !delivery.ok).slice(0, 5), [deliveries]);

  async function loadHealth() {
    try {
      setLoading(true);
      const [healthResponse, deliveryResponse, auditResponse, configResponse] = await Promise.all([
        axios.get("/api/health", { headers: headers() }),
        axios.get("/webhooks/delivery-history", { headers: headers() }),
        axios.get("/api/admin-audit", { headers: headers() }),
        axios.get("/api/getconfig", { headers: headers() }).catch(() => ({ data: {} })),
      ]);
      setHealth(healthResponse.data);
      setDeliveries(deliveryResponse.data || []);
      setAudit(auditResponse.data || []);
      setRetention(Number(configResponse.data?.settings?.AdminAuditRetention || 100));
      await loadPlaybackRetention();
    } finally {
      setLoading(false);
    }
  }

  async function loadPlaybackRetention() {
    const response = await axios.get("/api/playback-retention", { headers: headers() }).catch(() => null);
    if (!response?.data) return;
    setPlaybackRetention(response.data);
    const days = Number(response.data.days || 0);
    setPlaybackEnabled(days > 0);
    if (days > 0) setPlaybackDays(days);
  }

  async function savePlaybackRetention() {
    setPlaybackMessage("");
    try {
      const days = playbackEnabled ? Number(playbackDays) : 0;
      await axios.post("/api/playback-retention", { days, confirm: playbackEnabled && playbackConfirmed }, { headers: headers() });
      setPlaybackConfirmed(false);
      setPlaybackMessage(days > 0 ? `Saved. Raw playback older than ${days} days will be pruned on the next stats refresh.` : "Saved. Raw playback history is kept forever.");
      await loadPlaybackRetention();
    } catch (error) {
      setPlaybackMessage(error?.response?.data?.error || "Unable to save playback retention.");
    }
  }

  useEffect(() => {
    loadHealth();
    const intervalId = setInterval(loadHealth, 60000);
    return () => clearInterval(intervalId);
  }, []);

  async function retryDelivery(delivery) {
    if (!delivery?.webhookId) return;
    setRetryingId(String(delivery.webhookId));
    try {
      await axios.post(`/webhooks/retry/${encodeURIComponent(delivery.webhookId)}`, {}, { headers: headers() });
      await loadHealth();
    } finally {
      setRetryingId("");
    }
  }

  return (
    <div className="health-settings">
      <header className="health-hero">
        <div>
          <span>Operations</span>
          <h1>Health</h1>
          <p>Backend reachability, task state, webhook deliveries, backup freshness, and admin changes.</p>
        </div>
        <Button type="button" onClick={loadHealth} disabled={loading}>
          {loading ? <Spinner size="sm" animation="border" /> : <RefreshLineIcon size={17} />}
          Refresh
        </Button>
      </header>

      <section className="health-check-grid">
        {(health?.checks || []).map((check) => (
          <article key={check.key} className={check.ok ? "is-ok" : "is-error"}>
            {check.ok ? <CheckboxCircleLineIcon /> : <ErrorWarningLineIcon />}
            <div>
              <strong>{check.label}</strong>
              <span>{check.message}</span>
            </div>
          </article>
        ))}
      </section>

      <section className="health-summary-grid">
        <article>
          <HeartPulseLineIcon />
          <div>
            <span>Overall</span>
            <strong>{health?.ok ? "Healthy" : "Needs attention"}</strong>
            <small>Checked {formatDate(health?.checkedAt)}</small>
          </div>
        </article>
        <article>
          <Notification3LineIcon />
          <div>
            <span>Webhook failures</span>
            <strong>{health?.webhooks?.recentFailures || 0}</strong>
            <small>{health?.webhooks?.recentDeliveries || 0} recent deliveries</small>
          </div>
        </article>
        <article>
          <HistoryLineIcon />
          <div>
            <span>Audit events</span>
            <strong>{audit.length}</strong>
            <small>{audit[0] ? formatDate(audit[0].timestamp) : "No admin changes yet"}</small>
          </div>
        </article>
      </section>

      <section className="health-panel">
        <div className="health-panel-title">
          <Notification3LineIcon size={20} />
          <h2>Webhook Delivery History</h2>
        </div>
        <div className="health-table">
          {deliveries.slice(0, 30).map((delivery) => (
            <article key={`${delivery.webhookId}-${delivery.timestamp}-${delivery.status}`} className={delivery.ok ? "is-ok" : "is-error"}>
              <strong>{delivery.name}</strong>
              <span>{delivery.eventType || "webhook"}</span>
              <span>{delivery.status || "No status"}</span>
              <span>{delivery.retryOnFailure ? `Retries ${delivery.maxRetries}` : "No retry"}</span>
              <small>{delivery.error || delivery.destination}</small>
              <time>{formatDate(delivery.timestamp)}</time>
              {!delivery.ok && delivery.webhookId ? (
                <button type="button" disabled={Boolean(retryingId)} onClick={() => retryDelivery(delivery)}>
                  {retryingId === String(delivery.webhookId) ? t("FEATURES.OPS.RETRYING") : t("FEATURES.OPS.RETRY")}
                </button>
              ) : (
                <span />
              )}
            </article>
          ))}
          {!deliveries.length ? <div className="health-empty">No webhook deliveries recorded yet.</div> : null}
        </div>
        {recentFailures.length ? <p className="health-warning">{recentFailures.length} recent webhook delivery failure{recentFailures.length === 1 ? "" : "s"}.</p> : null}
      </section>

      <section className="health-panel playback-retention-panel">
        <div className="health-panel-title">
          <DatabaseLineIcon size={20} />
          <h2>Playback History Retention</h2>
        </div>
        <p className="playback-retention-intro">
          Stats charts read from daily and monthly rollups, so they keep their totals even after old raw rows are gone. Pruning is off by default and
          JellyGlance keeps every play unless you turn it on.
        </p>
        <div className="playback-retention-warning" role="alert">
          <ErrorWarningLineIcon size={18} />
          <div>
            <strong>Pruning permanently deletes raw playback history.</strong>
            <span>
              Rows older than the limit are removed from the database and can&apos;t be brought back. Per-play detail is lost for those days: the
              History and Activity lists, per-item and per-user history, the hour-of-day chart, Wrapped and anything else that reads individual plays. Only
              days that are already in the rollups are pruned. Take a backup first (Settings &gt; Backup).
            </span>
          </div>
        </div>
        <div className="health-retention-row">
          <label className="playback-retention-toggle">
            <input
              type="checkbox"
              checked={playbackEnabled}
              disabled={playbackRetention?.source === "env"}
              onChange={(event) => {
                setPlaybackEnabled(event.target.checked);
                setPlaybackConfirmed(false);
              }}
            />
            Prune raw playback older than
          </label>
          <label>
            <input
              type="number"
              min={playbackRetention?.min_days || 30}
              max={playbackRetention?.max_days || 36500}
              value={playbackDays}
              disabled={!playbackEnabled || playbackRetention?.source === "env"}
              onChange={(event) => setPlaybackDays(Number(event.target.value))}
            />
            days
          </label>
          <Button
            type="button"
            size="sm"
            variant={playbackEnabled ? "danger" : "primary"}
            disabled={playbackRetention?.source === "env" || (playbackEnabled && !playbackConfirmed)}
            onClick={savePlaybackRetention}
          >
            Save retention
          </Button>
        </div>
        {playbackEnabled && playbackRetention?.source !== "env" ? (
          <label className="playback-retention-confirm">
            <input type="checkbox" checked={playbackConfirmed} onChange={(event) => setPlaybackConfirmed(event.target.checked)} />
            I have a backup and understand that raw playback older than {playbackDays || 0} days will be deleted for good.
          </label>
        ) : null}
        {playbackRetention?.source === "env" ? (
          <p className="health-warning">Set by JS_PLAYBACK_RETENTION_DAYS ({playbackRetention.days ? `${playbackRetention.days} days` : "off"}). Change it in the environment.</p>
        ) : null}
        <div className="playback-retention-status">
          <span>Status: {playbackRetention?.days ? `pruning after ${playbackRetention.days} days` : "off, keeping everything"}</span>
          <span>Rolled up until {playbackRetention?.rollups?.rolled_up_through || "not yet"}</span>
          <span>{playbackRetention?.rollups?.pruned_before ? `Raw rows pruned before ${playbackRetention.rollups.pruned_before}` : "Nothing pruned"}</span>
        </div>
        {playbackMessage ? <p className="playback-retention-message">{playbackMessage}</p> : null}
      </section>

      <section className="health-panel">
        <div className="health-panel-title">
          <HistoryLineIcon size={20} />
          <h2>Admin Audit Log</h2>
          <Button
            type="button"
            size="sm"
            variant="outline-light"
            onClick={async () => {
              const response = await axios.get("/api/admin-audit/export", { headers: headers(), responseType: "blob" });
              const url = URL.createObjectURL(response.data);
              const link = document.createElement("a");
              link.href = url;
              link.download = "jellyglance-audit.json";
              link.click();
              URL.revokeObjectURL(url);
            }}
          >
            Export JSON
          </Button>
        </div>
        <div className="health-retention-row">
          <label>
            Keep
            <input
              type="number"
              min="20"
              max="2000"
              value={retention}
              onChange={(event) => setRetention(Number(event.target.value))}
            />
            events
          </label>
          <Button
            type="button"
            size="sm"
            onClick={async () => {
              await axios.post("/api/admin-audit/retention", { retention }, { headers: headers() });
            }}
          >
            Save retention
          </Button>
        </div>
        <div className="health-table audit-table">
          {audit.slice(0, 40).map((entry) => (
            <article key={`${entry.action}-${entry.timestamp}-${entry.actor}`}>
              <strong>{entry.action}</strong>
              <span>{entry.actor}</span>
              <span>{entry.role || "Role unknown"}</span>
              <small>{detailText(entry.details)}</small>
              <time>{formatDate(entry.timestamp)}</time>
            </article>
          ))}
          {!audit.length ? <div className="health-empty">No admin audit events recorded yet.</div> : null}
        </div>
      </section>
    </div>
  );
}

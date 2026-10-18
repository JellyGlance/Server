import { useEffect, useMemo, useState } from "react";
import DeleteBinLineIcon from "remixicon-react/DeleteBinLineIcon";
import HistoryLineIcon from "remixicon-react/HistoryLineIcon";
import RefreshLineIcon from "remixicon-react/RefreshLineIcon";
import ArrowDownLineIcon from "remixicon-react/ArrowDownLineIcon";
import SearchLineIcon from "remixicon-react/SearchLineIcon";
import TimerLineIcon from "remixicon-react/TimerLineIcon";
import ArrowRightLineIcon from "remixicon-react/ArrowRightLineIcon";
import Database2LineIcon from "remixicon-react/Database2LineIcon";
import axios from "../lib/axios_instance";
import { useTranslation } from "react-i18next";
import { formatDate as formatLocaleDate, formatNumber as formatLocaleNumber } from "../lib/format-date";
import "./css/maintainerr.css";
import "./css/integrations.css";

const emptyBundle = {
  collections: [],
  scheduledItems: [],
  excludedItems: [],
  upcomingActions: [],
  recentActions: [],
  storage: {},
  health: {},
};

function formatDate(value) {
  return formatLocaleDate(value, {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }, { fallback: "Never" });
}

function formatBytes(bytes) {
  const size = Number(bytes || 0);
  if (!size) return "0 B";

  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  const index = Math.min(Math.floor(Math.log(size) / Math.log(1024)), units.length - 1);
  const value = size / 1024 ** index;

  return `${value >= 10 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
}

function formatDuration(seconds) {
  const total = Math.max(0, Number(seconds || 0));
  const mins = Math.floor(total / 60);
  const hrs = Math.floor(mins / 60);
  const days = Math.floor(hrs / 24);

  if (days > 0) return `${days}d ${hrs % 24}h`;
  if (hrs > 0) return `${hrs}h ${mins % 60}m`;
  if (mins > 0) return `${mins}m`;
  return "Due now";
}

function formatNumber(value) {
  return formatLocaleNumber(value);
}

function normalizeRows(rows = []) {
  const map = new Map();
  return rows
    .filter((row) => row && (row.collectionId || row.id || row.mediaId || row.title || row.id))
    .filter((row) => {
      const key = row.id || row.mediaId || row.collectionId || row.title || row.name;
      if (!key || map.has(key)) return false;
      map.set(key, true);
      return true;
    });
}

export default function Maintainerr() {
  // Re-render dates and numbers in the new locale when the language changes.
  useTranslation();
  const [bundle, setBundle] = useState(emptyBundle);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [busyAction, setBusyAction] = useState("");

  const collections = useMemo(
    () =>
      normalizeRows(bundle?.collections || [])
        .map((collection) => collection)
        .sort((first, second) => Number(second.reclaimableBytes || 0) - Number(first.reclaimableBytes || 0)),
    [bundle]
  );

  const scheduledItems = useMemo(
    () =>
      normalizeRows(bundle?.scheduledItems || [])
        .filter((item) => {
          const query = search.trim().toLowerCase();
          if (!query) return true;
          const haystack = [item.title, item.collection, item.status, item.action, item.mediaId, item.collectionId, item.id]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
          return haystack.includes(query);
        })
        .sort((first, second) => {
          if (first.dueInSeconds !== undefined && second.dueInSeconds !== undefined) {
            return Number(first.dueInSeconds) - Number(second.dueInSeconds);
          }
          return String(first.dueAt || "").localeCompare(String(second.dueAt || ""));
        }),
    [bundle, search]
  );

  const excludedItems = useMemo(() => normalizeRows(bundle?.excludedItems || []), [bundle]);
  const upcomingActions = useMemo(() => normalizeRows(bundle?.upcomingActions || []), [bundle]);
  const recentActions = useMemo(() => normalizeRows(bundle?.recentActions || []), [bundle]);

  const stats = bundle?.stats || {};
  const storage = bundle?.storage || {};
  const health = bundle?.health || {};

  const healthLabel = health.ok ? "Connected" : "Needs attention";
  const reclaimableBytes = Number(storage?.reclaimableBytes || 0);

  useEffect(() => {
    loadMaintainerr();
    const intervalId = window.setInterval(() => loadMaintainerr(true), 30000);
    return () => window.clearInterval(intervalId);
  }, []);

  async function loadMaintainerr(silent = false) {
    try {
      if (!silent) setLoading(true);
      if (!silent) setNotice("");
      const response = await axios.get("/api/maintainerr");
      setBundle(response.data || emptyBundle);
      setError("");
    } catch (requestError) {
      setError(requestError?.response?.data?.error || "Unable to load Maintainerr. Ensure it is connected in Settings > Integrations > 3rd party apps.");
    } finally {
      if (!silent) setLoading(false);
    }
  }

  async function runAction(event, action, payload) {
    event.preventDefault?.();
    if (!action || !payload) return;

    const key = `${action}:${payload.collectionId || payload.itemId || payload.collection || "global"}`;
    if (busyAction) return;

    try {
      setBusyAction(key);
      const response = await axios.post("/api/maintainerr/actions", {
        action,
        ...payload,
      });
      setNotice(response.data?.message || `Maintainerr action ${action} triggered.`);
      await loadMaintainerr();
    } catch (actionError) {
      setNotice(actionError?.response?.data?.error || `Unable to run ${action}.`);
    } finally {
      setBusyAction("");
    }
  }

  return (
    <div className="integrations-page maintainerr-page">
      <section className="integration-page-header">
        <div>
          <p>Cleanup automation</p>
          <h1>Maintainerr</h1>
          <span>Review scheduled cleanup collections, upcoming actions, and manage cleanup runs.</span>
        </div>
        <button type="button" onClick={loadMaintainerr} disabled={loading || Boolean(busyAction)}>
          <RefreshLineIcon size={18} />
          {loading ? "Refreshing" : "Refresh"}
        </button>
      </section>

      {notice ? <div className="integration-notice">{notice}</div> : null}
      {error ? <div className="integration-notice is-error">{error}</div> : null}

      <section className="maintainerr-summary-grid">
        <article>
          <span>Collections</span>
          <strong>{formatNumber(stats.collections || collections.length || 0)}</strong>
          <small>Configured cleanup rules</small>
        </article>
        <article>
          <span>Scheduled</span>
          <strong>{formatNumber(stats.scheduledItems || scheduledItems.length || 0)}</strong>
          <small>Pending cleanup items</small>
        </article>
        <article>
          <span>Reclaimable</span>
          <strong>{formatBytes(reclaimableBytes)}</strong>
          <small>Across configured libraries</small>
        </article>
        <article>
          <span>Excluded</span>
          <strong>{formatNumber(stats.excludedItems || excludedItems.length || 0)}</strong>
          <small>Protected from cleanup</small>
        </article>
        <article>
          <span>Health</span>
          <strong>{healthLabel}</strong>
          <small>{health.status || "Health check unknown"}</small>
        </article>
      </section>

      <section className="maintainerr-control-card integration-section">
        <div className="integration-section-title">
          <div>
            <h2>Actions</h2>
            <span>Refresh policies or queue immediate/short-term cleanup tasks.</span>
          </div>
          <button
            type="button"
            className="maintainerr-action-button"
            onClick={(event) => runAction(event, "refresh", {})}
            disabled={Boolean(busyAction)}
          >
            <Database2LineIcon size={17} />
            Refresh collections
          </button>
        </div>
      </section>

      <section className="maintainerr-layout-grid">
        <article className="maintainerr-panel">
          <div className="maintainerr-panel-head">
            <HistoryLineIcon size={17} />
            <div>
              <h2>Collections</h2>
              <span>{collections.length} collections detected</span>
            </div>
          </div>
          <div className="maintainerr-panel-body">
            {loading ? <span className="maintainerr-loading">Loading Maintainerr collections...</span> : collections.length ? collections.map((collection) => (
              <div key={collection.id} className="maintainerr-item-row">
                <div>
                  <strong>{collection.name || collection.id}</strong>
                  <small>
                    {collection.itemCount || 0} items · {collection.status || "active"} · {collection.rule || "default"}
                  </small>
                  <small>
                    Reclaimable {formatBytes(collection.reclaimableBytes || 0)} · Next run {formatDate(collection.nextRunAt)} · Last run {formatDate(collection.lastRunAt)}
                  </small>
                </div>
                <button
                  type="button"
                  className="maintainerr-run-button"
                  disabled={Boolean(busyAction)}
                  onClick={(event) => runAction(event, "refresh", { collectionId: collection.id })}
                >
                  <RefreshLineIcon size={15} />
                  Recheck
                </button>
              </div>
            )) : <span className="maintainerr-empty">No collections found.</span>}
          </div>
        </article>

        <article className="maintainerr-panel">
          <div className="maintainerr-panel-head">
            <TimerLineIcon size={17} />
            <div>
              <h2>Scheduled items</h2>
              <span>{scheduledItems.length} items in cleanup queue</span>
            </div>
          </div>
          <label className="maintainerr-search">
            <SearchLineIcon size={16} />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search title, collection, action" />
          </label>
          <div className="maintainerr-panel-body">
            {loading ? <span className="maintainerr-loading">Loading scheduled cleanup items...</span> : scheduledItems.length ? scheduledItems.map((item) => (
              <div key={item.id} className="maintainerr-item-row">
                <div>
                  <strong>{item.title || `Item ${item.id}`}</strong>
                  <small>{item.collection || "Collection"} · {item.status || "Scheduled"} · {item.action || item.id}</small>
                  <small>
                    {formatBytes(item.storageBytes || 0)} · Due {item.dueInSeconds !== undefined ? formatDuration(item.dueInSeconds) : "Unknown"} · {item.dueAt ? `at ${formatDate(item.dueAt)}` : ""}
                  </small>
                </div>
                <div className="maintainerr-item-actions">
                  <button
                    type="button"
                    className="maintainerr-run-button"
                    disabled={Boolean(busyAction)}
                    onClick={(event) => runAction(event, "run-item-action", { action: item.action, itemId: item.id, collectionId: item.collectionId, rawAction: item.action })}
                  >
                    <ArrowRightLineIcon size={14} />
                    Run
                  </button>
                  <button
                    type="button"
                    className="maintainerr-run-button"
                    disabled={Boolean(busyAction)}
                    onClick={(event) => runAction(event, "postpone-item", { itemId: item.id, collectionId: item.collectionId, postponeHours: 24 })}
                  >
                    <ArrowDownLineIcon size={14} />
                    Postpone
                  </button>
                  <button
                    type="button"
                    className="maintainerr-action-button is-danger"
                    disabled={Boolean(busyAction)}
                    title="Remove from this list"
                    onClick={(event) => runAction(event, "run", { action: "delete", itemId: item.id, collectionId: item.collectionId })}
                  >
                    <DeleteBinLineIcon size={14} />
                  </button>
                </div>
              </div>
            )) : <span className="maintainerr-empty">No scheduled cleanup items.</span>}
          </div>
        </article>

        <article className="maintainerr-panel">
          <div className="maintainerr-panel-head">
            <HistoryLineIcon size={17} />
            <div>
              <h2>Upcoming (7 days)</h2>
              <span>{upcomingActions.length} upcoming actions</span>
            </div>
          </div>
          <div className="maintainerr-panel-body">
            {upcomingActions.length ? upcomingActions.map((item) => (
              <div key={`${item.id}-upcoming`} className="maintainerr-item-row">
                <strong>{item.title || item.id}</strong>
                <small>{item.collection || "Collection"} · {formatDate(item.dueAt)}</small>
              </div>
            )) : <span className="maintainerr-empty">No upcoming actions in the next week.</span>}
          </div>
        </article>

        <article className="maintainerr-panel">
          <div className="maintainerr-panel-head">
            <HistoryLineIcon size={17} />
            <div>
              <h2>Recent actions</h2>
              <span>{recentActions.length} recent events</span>
            </div>
          </div>
          <div className="maintainerr-panel-body">
            {recentActions.length ? recentActions.map((item) => (
              <div key={`${item.id}-recent`} className="maintainerr-item-row">
                <ArrowRightLineIcon size={14} />
                <div>
                  <strong>{item.title || item.id || "Action item"}</strong>
                  <small>{item.status || "Completed"} · {formatDate(item.dueAt) }</small>
                </div>
              </div>
            )) : <span className="maintainerr-empty">No recent actions.</span>}
          </div>
        </article>
      </section>

      <section className="maintainerr-panel integration-section">
        <div className="maintainerr-panel-head">
          <Database2LineIcon size={18} />
          <div>
            <h2>Storage and health</h2>
            <span>
              Total {formatBytes(storage.totalBytes || 0)} · Used {formatBytes(storage.usedBytes || 0)} · Free {formatBytes(storage.freeBytes || 0)}
            </span>
          </div>
        </div>
        <div className="maintainerr-panel-body">
          <p>Last check: {formatDate(bundle.syncedAt || bundle.checkedAt)}</p>
          <p>Live: {health.live ? "ok" : "offline"} · Ready: {health.ready ? "ok" : "offline"}</p>
          {excludedItems.length ? <p>{formatNumber(excludedItems.length)} excluded item{excludedItems.length === 1 ? "" : "s"} are currently protected.</p> : null}
        </div>
      </section>
    </div>
  );
}

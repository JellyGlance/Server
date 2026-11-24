import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import axios from "../../../lib/axios_instance";
import Button from "react-bootstrap/Button";
import Alert from "react-bootstrap/Alert";
import Tab from "react-bootstrap/Tab";
import Tabs from "react-bootstrap/Tabs";
import TimerLineIcon from "remixicon-react/TimerLineIcon";
import ActiveTimesModal, { describeActiveTimes } from "./ActiveTimesModal";
import QuietHoursPanel, { isHeldByQuietHours } from "./QuietHoursPanel";
import ServerLineIcon from "remixicon-react/ServerLineIcon";
import PlayCircleLineIcon from "remixicon-react/PlayCircleLineIcon";
import RefreshLineIcon from "remixicon-react/RefreshLineIcon";
import SearchLineIcon from "remixicon-react/SearchLineIcon";
import MoonClearLineIcon from "remixicon-react/MoonClearLineIcon";
import ArrowDownSLineIcon from "remixicon-react/ArrowDownSLineIcon";
import { formatJellyfinSchedule } from "../../../lib/jellyfin-job-triggers";

import "../../css/settings/settings.css";
import "../../css/settings/server-jobs.css";
import { mediaServerName } from "../../../lib/media-server";

function errorText(error, fallback) {
  const data = error?.response?.data;
  if (typeof data === "string") return data;
  return data?.error || data?.message || fallback;
}

function formatTaskState(task) {
  const result = task.lastExecutionResult;
  if (!result) return task.state || "Idle";
  return result.Status || task.state || "Idle";
}

function formatLastRun(task) {
  const value =
    task.lastExecutionResult?.EndTimeUtc ||
    task.lastExecutionResult?.StartTimeUtc;
  if (!value) return "Never run";

  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  } catch {
    return "Last run unavailable";
  }
}

function relativeTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.getFullYear() < 2000) return "";
  const minutes = Math.round((Date.now() - date.getTime()) / 60000);
  const future = minutes < 0;
  const abs = Math.abs(minutes);
  const text = abs < 1 ? "now" : abs < 60 ? `${abs} min` : abs < 1440 ? `${Math.round(abs / 60)} hr` : `${Math.round(abs / 1440)} d`;
  if (text === "now") return "just now";
  return future ? `in ${text}` : `${text} ago`;
}

// Normalised status used for filtering, sorting and the coloured pill.
function jobStatus(task) {
  if (String(task.state || "").toLowerCase() === "running") return "running";
  const state = formatTaskState(task).toLowerCase();
  if (state.includes("fail") || state.includes("error") || state.includes("abort")) return "failed";
  if (state.includes("cancel")) return "cancelled";
  if (!task.lastExecutionResult) return "never";
  if (state.includes("completed") || state.includes("success")) return "ok";
  return "idle";
}

const STATUS_LABELS = { running: "Running", failed: "Failed", cancelled: "Cancelled", never: "Never run", ok: "Completed", idle: "Idle" };
const STATUS_ORDER = { running: 0, failed: 1, cancelled: 2, idle: 3, never: 4, ok: 5 };

function lastRunValue(task) {
  return task.lastExecutionResult?.EndTimeUtc || task.lastExecutionResult?.StartTimeUtc || null;
}

const APP_LOGOS = {
  jellyfin: "https://cdn.jsdelivr.net/gh/selfhst/icons/svg/jellyfin.svg",
  sonarr: "https://cdn.jsdelivr.net/gh/selfhst/icons/svg/sonarr.svg",
  radarr: "https://cdn.jsdelivr.net/gh/selfhst/icons/svg/radarr.svg",
  lidarr: "https://cdn.jsdelivr.net/gh/selfhst/icons/svg/lidarr.svg",
  readarr: "https://cdn.jsdelivr.net/gh/selfhst/icons/svg/readarr.svg",
  prowlarr: "https://cdn.jsdelivr.net/gh/selfhst/icons/svg/prowlarr.svg",
  bazarr: "https://cdn.jsdelivr.net/gh/selfhst/icons/svg/bazarr.svg",
  whisparr: "https://cdn.jsdelivr.net/gh/selfhst/icons/png/whisparr.png",
};

function AppLogo({ kind, size = 18 }) {
  const src = APP_LOGOS[kind];
  if (!src) return <ServerLineIcon size={size} />;
  return (
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      className="server-app-logo"
    />
  );
}

function TabLabel({ kind, label, count }) {
  return (
    <span className="server-tab-label">
      <AppLogo kind={kind} />
      {label}
      {count ? <em>{count}</em> : null}
    </span>
  );
}

function formatDateTime(value, fallback = "Unknown") {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.getFullYear() < 2000)
    return fallback;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatInterval(task) {
  const minutes = Number(task.intervalMinutes);
  if (!minutes) return task.interval || "Manual";
  if (minutes % 1440 === 0)
    return minutes === 1440 ? "Daily" : `Every ${minutes / 1440} days`;
  if (minutes % 60 === 0)
    return minutes === 60 ? "Hourly" : `Every ${minutes / 60} hours`;
  return `Every ${minutes} min`;
}

function ActiveTimesButton({ schedule, globalSchedule, onClick, disabled }) {
  const followsGlobal =
    Boolean(globalSchedule) && (!schedule || schedule.useGlobal);
  const custom = Boolean(schedule && !schedule.useGlobal);
  let label = "";
  if (custom) label = describeActiveTimes(schedule);
  else if (followsGlobal) label = `Global · ${describeActiveTimes(globalSchedule)}`;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`sj-times-btn${custom ? " is-custom" : followsGlobal ? " is-global" : ""}`}
      title={label ? `Active times: ${label}${schedule?.autoRun ? " (runs automatically)" : ""}` : "Set the days and hours this job may run"}
    >
      <TimerLineIcon size={15} />
      <span>{label || "Any time"}</span>
      {schedule?.autoRun ? <small>auto</small> : null}
    </button>
  );
}

function JobRow({ status, name, category, description, lastRun, schedule, held, timesButton, onRun, runDisabled, running }) {
  return (
    <article className={`sj-row is-${status}`}>
      <span className="sj-dot" aria-hidden="true" />
      <div className="sj-main">
        <strong title={name}>{name}</strong>
        <span className="sj-sub">
          {category ? <em>{category}</em> : null}
          {description ? <span title={description}>{description}</span> : null}
        </span>
      </div>
      <div className="sj-when">
        <span title={lastRun.title}>{lastRun.text}</span>
        <small title={schedule}>{schedule}</small>
      </div>
      <div className="sj-state">
        <span className={`sj-pill is-${status}`}>{STATUS_LABELS[status] || status}</span>
        {held ? (
          <span className="sj-pill is-quiet" title="Scheduled runs are held until quiet hours end. Run still starts it now.">
            <MoonClearLineIcon size={12} /> Quiet hours
          </span>
        ) : null}
      </div>
      <div className="sj-actions">
        {timesButton}
        <button type="button" className="sj-run-btn" onClick={onRun} disabled={runDisabled} title={running ? "Already running" : "Run now"}>
          <PlayCircleLineIcon size={16} />
          {running ? "Running" : "Run"}
        </button>
      </div>
    </article>
  );
}

function JobToolbar({ query, onQuery, statusFilter, onStatus, counts, sort, onSort, extra }) {
  const filters = [
    ["all", "All"],
    ["running", "Running"],
    ["failed", "Failed"],
    ["cancelled", "Cancelled"],
    ["never", "Never run"],
  ];
  return (
    <div className="sj-toolbar">
      <label className="sj-search">
        <SearchLineIcon size={16} />
        <input value={query} onChange={(event) => onQuery(event.target.value)} placeholder="Search jobs" aria-label="Search jobs" />
      </label>
      <div className="sj-chips" role="group" aria-label="Filter by status">
        {filters.map(([key, label]) =>
          key === "all" || counts[key] ? (
            <button key={key} type="button" className={statusFilter === key ? "is-active" : ""} onClick={() => onStatus(key)}>
              {label}
              {key !== "all" ? <em className={`is-${key}`}>{counts[key]}</em> : null}
            </button>
          ) : null
        )}
      </div>
      {extra}
      <label className="sj-select">
        <span>Sort</span>
        <select value={sort} onChange={(event) => onSort(event.target.value)}>
          <option value="status">Needs attention first</option>
          <option value="name">Name</option>
          <option value="recent">Last run</option>
        </select>
      </label>
    </div>
  );
}

export default function ServerManagement() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [arr, setArr] = useState({ apps: [], loading: true });
  const [activeTimes, setActiveTimes] = useState({
    schedules: {},
    timeZone: "",
  });
  const [quiet, setQuiet] = useState(null);
  const [editing, setEditing] = useState(null);
  const [busyAction, setBusyAction] = useState("");
  const [message, setMessage] = useState(null);
  const [categoryFilter, setCategoryFilter] = useState("All");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sort, setSort] = useState("status");
  const [showQuiet, setShowQuiet] = useState(false);

  const jellyfinTasks = status?.jellyfinTasks || [];
  const categories = useMemo(
    () => [
      "All",
      ...new Set(
        jellyfinTasks.map((task) => task.category || "Jellyfin").sort(),
      ),
    ],
    [jellyfinTasks],
  );
  const statusCounts = useMemo(() => {
    const counts = { running: 0, failed: 0, cancelled: 0, never: 0, ok: 0, idle: 0 };
    jellyfinTasks.forEach((task) => {
      counts[jobStatus(task)] += 1;
    });
    return counts;
  }, [jellyfinTasks]);
  const visibleTasks = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const rows = jellyfinTasks.filter(
      (task) =>
        (categoryFilter === "All" || (task.category || "Jellyfin") === categoryFilter) &&
        (statusFilter === "all" || jobStatus(task) === statusFilter) &&
        (!needle || `${task.name} ${task.category} ${task.description}`.toLowerCase().includes(needle))
    );
    const byName = (a, b) => String(a.name).localeCompare(String(b.name));
    if (sort === "name") return rows.sort(byName);
    if (sort === "recent") return rows.sort((a, b) => new Date(lastRunValue(b) || 0) - new Date(lastRunValue(a) || 0) || byName(a, b));
    return rows.sort((a, b) => STATUS_ORDER[jobStatus(a)] - STATUS_ORDER[jobStatus(b)] || byName(a, b));
  }, [categoryFilter, jellyfinTasks, query, statusFilter, sort]);
  const globalSchedule = activeTimes.schedules.global || null;
  const runningCount = jellyfinTasks.filter(
    (task) => String(task.state || "").toLowerCase() === "running",
  ).length;

  async function loadStatus() {
    setLoading(true);
    try {
      const response = await axios.get("/api/server-management/status");
      setStatus(response.data);
    } catch (error) {
      setMessage({
        type: "danger",
        text: errorText(error, "Unable to load server management status"),
      });
    } finally {
      setLoading(false);
    }
  }

  async function loadArr() {
    setArr((current) => ({ ...current, loading: true }));
    try {
      const response = await axios.get("/server-tasks/arr");
      setArr({ apps: response.data?.apps || [], loading: false });
    } catch (error) {
      setArr({
        apps: [],
        loading: false,
        error: errorText(error, "Unable to load ARR tasks"),
      });
    }
  }

  async function loadActiveTimes() {
    try {
      const response = await axios.get("/server-tasks/active-times");
      setActiveTimes({
        schedules: response.data?.schedules || {},
        timeZone: response.data?.timeZone || "",
      });
    } catch {
      setActiveTimes({ schedules: {}, timeZone: "" });
    }
  }

  async function loadQuietHours() {
    try {
      const response = await axios.get("/server-tasks/quiet-hours");
      setQuiet(response.data || null);
    } catch {
      setQuiet(null);
    }
  }

  function refreshAll() {
    loadQuietHours();
    loadStatus();
    loadArr();
    loadActiveTimes();
  }

  async function runAction(action, payload = {}) {
    setBusyAction(action + (payload.taskId || ""));
    setMessage(null);
    try {
      await axios.post("/api/server-management/action", {
        action,
        ...payload,
      });
      setMessage({ type: "success", text: `${mediaServerName()} job started.` });
      await loadStatus();
    } catch (error) {
      setMessage({
        type: "danger",
        text: errorText(error, `${mediaServerName()} job failed to start`),
      });
    } finally {
      setBusyAction("");
    }
  }

  async function runArrTask(app, task) {
    setBusyAction(`arr-${app.instanceId}-${task.command}`);
    setMessage(null);
    try {
      await axios.post("/server-tasks/arr/run", {
        instanceId: app.instanceId,
        command: task.command,
      });
      setMessage({
        type: "success",
        text: `${app.name}: ${task.name} started.`,
      });
      setTimeout(loadArr, 1500);
    } catch (error) {
      setMessage({
        type: "danger",
        text: errorText(error, `${app.name} task failed to start`),
      });
    } finally {
      setBusyAction("");
    }
  }

  async function saveActiveTimes(values) {
    try {
      const response = await axios.put("/server-tasks/active-times", {
        key: editing.key,
        ...values,
      });
      setActiveTimes((current) => ({
        ...current,
        schedules: {
          ...current.schedules,
          [editing.key]: response.data.schedule,
        },
      }));
      setMessage({
        type: "success",
        text:
          editing.key === "global"
            ? "Global active times saved."
            : `Active times saved for ${editing.task.name}.`,
      });
      setEditing(null);
    } catch (error) {
      setMessage({
        type: "danger",
        text: errorText(error, "Unable to save active times"),
      });
    }
  }

  async function clearActiveTimes() {
    try {
      await axios.put("/server-tasks/active-times", {
        key: editing.key,
        clear: true,
      });
      setActiveTimes((current) => {
        const schedules = { ...current.schedules };
        delete schedules[editing.key];
        return { ...current, schedules };
      });
      setEditing(null);
    } catch (error) {
      setMessage({
        type: "danger",
        text: errorText(error, "Unable to remove active times"),
      });
    }
  }

  useEffect(() => {
    refreshAll();
  }, []);

  return (
    <div className="server-management">
      <div className="server-management-header">
        <div>
          <p>Server admin</p>
          <h1>Server Jobs</h1>
          <span>
            Run Jellyfin and ARR scheduled tasks, and choose the days and hours
            each one is allowed to run.
          </span>
        </div>
        <div className="server-management-header-actions">
          <Button
            type="button"
            variant={globalSchedule ? "outline-info" : "outline-light"}
            onClick={() =>
              setEditing({
                key: "global",
                task: { name: "Global" },
                supportsEnforce: true,
                isGlobal: true,
              })
            }
          >
            <TimerLineIcon size={17} />
            Global active times
            {globalSchedule ? ` · ${describeActiveTimes(globalSchedule)}` : ""}
          </Button>
          <Button
            type="button"
            variant="outline-light"
            onClick={refreshAll}
            disabled={loading}
          >
            <RefreshLineIcon size={17} />
            Refresh
          </Button>
        </div>
      </div>

      {message ? (
        <Alert
          variant={message.type}
          onClose={() => setMessage(null)}
          dismissible
        >
          {message.text}
        </Alert>
      ) : null}

      <Tabs
        defaultActiveKey="jellyfin"
        variant="pills"
        className="server-management-tabs"
        transition={false}
        mountOnEnter
      >
        <Tab
          eventKey="jellyfin"
          title={
            <TabLabel
              kind="jellyfin"
              label={mediaServerName()}
              count={runningCount ? `${runningCount} running` : ""}
            />
          }
        >
          <section className="sj-overview">
            <div className="sj-server">
              <AppLogo kind="jellyfin" size={26} />
              <div>
                <strong>{status?.jellyfin?.name || mediaServerName()}</strong>
                <span className={status?.jellyfin?.ok ? "is-ok" : "is-error"}>
                  {status?.jellyfin?.ok ? `Connected · ${status?.jellyfin?.version || "unknown version"}` : status?.jellyfin?.error || "Status unavailable"}
                </span>
              </div>
            </div>
            <div className="sj-stat">
              <strong>{jellyfinTasks.length}</strong>
              <span>Jobs</span>
            </div>
            <button type="button" className={`sj-stat${statusCounts.running ? " is-running" : ""}`} onClick={() => setStatusFilter(statusCounts.running ? "running" : "all")}>
              <strong>{statusCounts.running}</strong>
              <span>Running</span>
            </button>
            <button type="button" className={`sj-stat${statusCounts.failed ? " is-failed" : ""}`} onClick={() => setStatusFilter(statusCounts.failed ? "failed" : "all")}>
              <strong>{statusCounts.failed}</strong>
              <span>Failed</span>
            </button>
            <button type="button" className={`sj-stat${statusCounts.cancelled ? " is-cancelled" : ""}`} onClick={() => setStatusFilter(statusCounts.cancelled ? "cancelled" : "all")}>
              <strong>{statusCounts.cancelled}</strong>
              <span>Cancelled</span>
            </button>
            <button type="button" className={`sj-quiet${quiet?.enabled ? " is-on" : ""}`} onClick={() => setShowQuiet(!showQuiet)} aria-expanded={showQuiet}>
              <MoonClearLineIcon size={18} />
              <span>
                <strong>Quiet hours</strong>
                <small>{quiet?.enabled ? `${quiet.active ? "Active now" : "On"} · ${quiet.start || ""}–${quiet.end || ""}` : "Off"}</small>
              </span>
              <ArrowDownSLineIcon size={18} className={showQuiet ? "is-flipped" : ""} />
            </button>
          </section>

          {showQuiet ? (
            <section className="sj-quiet-panel">
              <QuietHoursPanel quiet={quiet} onSaved={setQuiet} />
            </section>
          ) : null}

          <section className="server-management-section sj-section">
            <div className="sj-section-heading">
              <h2>Scheduled jobs</h2>
              <p>
                From {mediaServerName()}&apos;s scheduled task API.{" "}
                <Link to="/settings/jellyfin-jobs">Change {mediaServerName()}&apos;s own run times</Link>, or use Active times to limit when JellyGlance lets them run.
              </p>
            </div>
            <JobToolbar
              query={query}
              onQuery={setQuery}
              statusFilter={statusFilter}
              onStatus={setStatusFilter}
              counts={statusCounts}
              sort={sort}
              onSort={setSort}
              extra={
                categories.length > 2 ? (
                  <label className="sj-select">
                    <span>Category</span>
                    <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
                      {categories.map((category) => (
                        <option key={category} value={category}>
                          {category === "All" ? "All categories" : category}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null
              }
            />
            <div className="sj-list">
              {loading && !jellyfinTasks.length ? <div className="server-management-empty">Loading {mediaServerName()} jobs…</div> : null}
              {visibleTasks.map((task) => {
                const key = `jellyfin:${task.id}`;
                const held = quiet?.active && isHeldByQuietHours(quiet, task);
                const status = jobStatus(task);
                const last = lastRunValue(task);
                return (
                  <JobRow
                    key={task.id}
                    status={status}
                    name={task.name}
                    category={task.category}
                    description={task.description}
                    lastRun={{ text: last ? `Ran ${relativeTime(last)}` : "Never run", title: formatLastRun(task) }}
                    schedule={formatJellyfinSchedule(task.triggers)}
                    held={held}
                    running={status === "running"}
                    timesButton={
                      <ActiveTimesButton
                        schedule={activeTimes.schedules[key]}
                        globalSchedule={globalSchedule}
                        onClick={() => setEditing({ key, task, supportsEnforce: true })}
                      />
                    }
                    onRun={() => runAction("runJellyfinTask", { taskId: task.id })}
                    runDisabled={Boolean(busyAction) || status === "running"}
                  />
                );
              })}
              {!loading && !visibleTasks.length ? (
                <div className="server-management-empty">
                  No jobs match this view.{" "}
                  <button
                    type="button"
                    className="sj-link"
                    onClick={() => {
                      setQuery("");
                      setStatusFilter("all");
                      setCategoryFilter("All");
                    }}
                  >
                    Clear filters
                  </button>
                </div>
              ) : null}
            </div>
          </section>
        </Tab>

        {arr.apps.map((app) => {
          const running = app.tasks.filter((task) => task.running).length;
          return (
            <Tab
              key={app.instanceId}
              eventKey={app.instanceId}
              title={
                <TabLabel
                  kind={app.kind}
                  label={app.name}
                  count={running ? `${running} running` : ""}
                />
              }
            >
              <section className="sj-overview">
                <div className="sj-server">
                  <AppLogo kind={app.kind} size={26} />
                  <div>
                    <strong>{app.name}</strong>
                    <span className={app.ok ? "is-ok" : "is-error"}>{app.ok ? app.url : app.error}</span>
                  </div>
                </div>
                <div className="sj-stat">
                  <strong>{app.tasks.length}</strong>
                  <span>Tasks</span>
                </div>
                <div className={`sj-stat${running ? " is-running" : ""}`}>
                  <strong>{running}</strong>
                  <span>Running</span>
                </div>
                <div className="sj-stat">
                  <strong>{app.tasks.filter((task) => activeTimes.schedules[`arr:${app.instanceId}:${task.command}`]).length}</strong>
                  <span>With active times</span>
                </div>
              </section>
              <section className="server-management-section sj-section">
                <div className="sj-section-heading">
                  <h2>Scheduled tasks</h2>
                  <p>Tasks reported by {app.name}. Run one now, or set active times so JellyGlance runs it only on the days and hours you pick.</p>
                </div>
                <div className="sj-list">
                  {[...app.tasks]
                    .sort((a, b) => Number(Boolean(b.running)) - Number(Boolean(a.running)) || String(a.name).localeCompare(String(b.name)))
                    .map((task) => {
                      const key = `arr:${app.instanceId}:${task.command}`;
                      const next = task.nextExecution ? `Next ${relativeTime(task.nextExecution)}` : task.nextRunIn ? `Next in ${task.nextRunIn}` : "No next run";
                      return (
                        <JobRow
                          key={task.id}
                          status={task.running ? "running" : task.lastExecution ? "ok" : "never"}
                          name={task.name}
                          category={formatInterval(task)}
                          description=""
                          lastRun={{
                            text: task.lastExecution ? `Ran ${relativeTime(task.lastExecution)}` : "Last run unknown",
                            title: task.lastExecution ? formatDateTime(task.lastExecution) : "",
                          }}
                          schedule={next}
                          running={Boolean(task.running)}
                          timesButton={
                            <ActiveTimesButton
                              schedule={activeTimes.schedules[key]}
                              globalSchedule={globalSchedule}
                              onClick={() => setEditing({ key, task, supportsEnforce: false })}
                            />
                          }
                          onRun={() => runArrTask(app, task)}
                          runDisabled={Boolean(busyAction) || task.running}
                        />
                      );
                    })}
                  {!app.tasks.length ? <div className="server-management-empty">{app.ok ? "No tasks reported." : app.error}</div> : null}
                </div>
              </section>
            </Tab>
          );
        })}
      </Tabs>

      {!arr.loading && !arr.apps.length ? (
        <div className="server-management-empty server-arr-hint">
          Connect Sonarr, Radarr, Lidarr, Readarr, Prowlarr or Bazarr in{" "}
          <Link to="/settings/integrations">Integrations</Link> to manage their
          tasks here.
        </div>
      ) : null}

      <ActiveTimesModal
        show={Boolean(editing)}
        task={editing?.task}
        schedule={editing ? activeTimes.schedules[editing.key] : null}
        timeZone={activeTimes.timeZone}
        supportsEnforce={editing?.supportsEnforce}
        isGlobal={Boolean(editing?.isGlobal)}
        globalSchedule={globalSchedule}
        onHide={() => setEditing(null)}
        onSave={saveActiveTimes}
        onClear={clearActiveTimes}
      />
    </div>
  );
}

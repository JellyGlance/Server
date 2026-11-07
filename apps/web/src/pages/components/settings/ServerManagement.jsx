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
import TimeLineIcon from "remixicon-react/TimeLineIcon";
import { formatJellyfinSchedule } from "../../../lib/jellyfin-job-triggers";

import "../../css/settings/settings.css";
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

function taskStatusClass(task) {
  const state = formatTaskState(task).toLowerCase();
  if (state.includes("fail") || state.includes("error")) return "is-error";
  if (state.includes("running")) return "is-running";
  if (state.includes("completed") || state.includes("success"))
    return "is-success";
  return "";
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
  let label = "Active times";
  if (schedule && !schedule.useGlobal) label = describeActiveTimes(schedule);
  else if (followsGlobal)
    label = `Global · ${describeActiveTimes(globalSchedule)}`;
  return (
    <Button
      type="button"
      variant={
        schedule && !schedule.useGlobal ? "outline-info" : "outline-secondary"
      }
      onClick={onClick}
      disabled={disabled}
      className="server-active-times-btn"
      title={followsGlobal ? "Following the global active times" : undefined}
    >
      <TimerLineIcon size={17} />
      {label}
      {schedule?.autoRun ? <small>auto</small> : null}
    </Button>
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
  const visibleTasks = useMemo(
    () =>
      categoryFilter === "All"
        ? jellyfinTasks
        : jellyfinTasks.filter(
            (task) => (task.category || "Jellyfin") === categoryFilter,
          ),
    [categoryFilter, jellyfinTasks],
  );
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
          <section className="server-management-grid">
            <article className="server-management-panel server-status-panel">
              <div className="server-management-panel-heading">
                <AppLogo kind="jellyfin" size={22} />
                <div>
                  <h2>{status?.jellyfin?.name || mediaServerName()}</h2>
                  <p>
                    {status?.jellyfin?.ok
                      ? "Connected media server"
                      : status?.jellyfin?.error || "Status unavailable"}
                  </p>
                </div>
              </div>
              <div className="server-management-facts">
                <span>Version</span>
                <strong>{status?.jellyfin?.version || "Unknown"}</strong>
                <span>{mediaServerName()} jobs</span>
                <strong>{status?.jellyfinTasks?.length || 0} available</strong>
                <span>Running</span>
                <strong>{runningCount}</strong>
              </div>
            </article>
            <QuietHoursPanel quiet={quiet} onSaved={setQuiet} />
          </section>

          <section className="server-management-section">
            <div className="server-management-section-heading">
              <h2>Scheduled Jobs</h2>
              <p>
                These are Jellyfin jobs returned by the Jellyfin scheduled task
                API.{" "}
                <Link to="/settings/jellyfin-jobs">
                  Set Jellyfin&apos;s own run times in Settings
                </Link>
                , or use Active times to limit when they may run.
              </p>
            </div>
            {categories.length > 2 ? (
              <div
                className="server-job-filters"
                aria-label={`Filter ${mediaServerName()} jobs`}
              >
                {categories.map((category) => (
                  <button
                    key={category}
                    type="button"
                    className={categoryFilter === category ? "is-active" : ""}
                    onClick={() => setCategoryFilter(category)}
                  >
                    {category}
                  </button>
                ))}
              </div>
            ) : null}
            <div className="server-task-list">
              {loading ? (
                <div className="server-management-empty">
                  Loading Jellyfin jobs...
                </div>
              ) : null}
              {visibleTasks.map((task) => {
                const key = `jellyfin:${task.id}`;
                const held = quiet?.active && isHeldByQuietHours(quiet, task);
                return (
                  <article
                    key={task.id}
                    className={`server-task-row ${taskStatusClass(task)}`}
                  >
                    <div>
                      <span>{task.category}</span>
                      <strong>{task.name}</strong>
                      <p>{task.description || formatTaskState(task)}</p>
                      <small>
                        <TimeLineIcon size={15} />
                        {formatLastRun(task)} ·{" "}
                        {formatJellyfinSchedule(task.triggers)}
                      </small>
                    </div>
                    <div className="server-task-actions">
                      {held ? (
                        <em
                          className="quiet-hours-chip"
                          title="Scheduled runs are held until quiet hours end. Run still starts it now."
                        >
                          In quiet hours
                        </em>
                      ) : null}
                      <em>{formatTaskState(task)}</em>
                      <ActiveTimesButton
                        schedule={activeTimes.schedules[key]}
                        globalSchedule={globalSchedule}
                        onClick={() =>
                          setEditing({ key, task, supportsEnforce: true })
                        }
                      />
                      <Button
                        type="button"
                        variant="outline-primary"
                        onClick={() =>
                          runAction("runJellyfinTask", { taskId: task.id })
                        }
                        disabled={
                          Boolean(busyAction) || task.state === "Running"
                        }
                      >
                        <PlayCircleLineIcon size={17} />
                        Run
                      </Button>
                    </div>
                  </article>
                );
              })}
              {!loading && !visibleTasks.length ? (
                <div className="server-management-empty">
                  No Jellyfin jobs matched this view.
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
              <section className="server-management-grid">
                <article className="server-management-panel server-status-panel">
                  <div className="server-management-panel-heading">
                    <AppLogo kind={app.kind} size={22} />
                    <div>
                      <h2>{app.name}</h2>
                      <p>{app.ok ? app.url : app.error}</p>
                    </div>
                  </div>
                  <div className="server-management-facts">
                    <span>Tasks</span>
                    <strong>{app.tasks.length} available</strong>
                    <span>Running</span>
                    <strong>{running}</strong>
                    <span>With active times</span>
                    <strong>
                      {
                        app.tasks.filter(
                          (task) =>
                            activeTimes.schedules[
                              `arr:${app.instanceId}:${task.command}`
                            ],
                        ).length
                      }
                    </strong>
                  </div>
                </article>
              </section>
              <section className="server-management-section">
                <div className="server-management-section-heading">
                  <h2>Scheduled Tasks</h2>
                  <p>
                    Tasks reported by {app.name}. Run one now, or set active
                    times so JellyGlance runs it only on the days and hours you
                    pick.
                  </p>
                </div>
                <div className="server-task-list">
                  {app.tasks.map((task) => {
                    const key = `arr:${app.instanceId}:${task.command}`;
                    return (
                      <article
                        key={task.id}
                        className={`server-task-row ${task.running ? "is-running" : ""}`}
                      >
                        <div>
                          <span>{formatInterval(task)}</span>
                          <strong>{task.name}</strong>
                          <p>
                            {task.nextExecution
                              ? `Next run ${formatDateTime(task.nextExecution)}`
                              : task.nextRunIn
                                ? `Next run in ${task.nextRunIn}`
                                : "No next run scheduled"}
                          </p>
                          <small>
                            <TimeLineIcon size={15} />
                            {task.lastExecution
                              ? `Last run ${formatDateTime(task.lastExecution)}`
                              : "Last run unknown"}
                          </small>
                        </div>
                        <div className="server-task-actions">
                          <em>{task.running ? "Running" : "Idle"}</em>
                          <ActiveTimesButton
                            schedule={activeTimes.schedules[key]}
                            globalSchedule={globalSchedule}
                            onClick={() =>
                              setEditing({ key, task, supportsEnforce: false })
                            }
                          />
                          <Button
                            type="button"
                            variant="outline-primary"
                            onClick={() => runArrTask(app, task)}
                            disabled={Boolean(busyAction) || task.running}
                          >
                            <PlayCircleLineIcon size={17} />
                            Run
                          </Button>
                        </div>
                      </article>
                    );
                  })}
                  {!app.tasks.length ? (
                    <div className="server-management-empty">
                      {app.ok ? "No tasks reported." : app.error}
                    </div>
                  ) : null}
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

import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Modal } from "react-bootstrap";
import axios from "../lib/axios_instance";
import { cachedGet } from "../lib/api-cache";
import Config from "../lib/config";
import { useTranslation } from "react-i18next";

import ArrowDownSLineIcon from "remixicon-react/ArrowDownSLineIcon";
import ArrowUpSLineIcon from "remixicon-react/ArrowUpSLineIcon";
import BarChartGroupedLineIcon from "remixicon-react/BarChartGroupedLineIcon";
import ChatCheckLineIcon from "remixicon-react/ChatCheckLineIcon";
import CheckboxCircleLineIcon from "remixicon-react/CheckboxCircleLineIcon";
import Database2LineIcon from "remixicon-react/Database2LineIcon";
import DownloadCloud2LineIcon from "remixicon-react/DownloadCloud2LineIcon";
import EyeLineIcon from "remixicon-react/EyeLineIcon";
import EyeOffLineIcon from "remixicon-react/EyeOffLineIcon";
import ErrorWarningLineIcon from "remixicon-react/ErrorWarningLineIcon";
import FireLineIcon from "remixicon-react/FireLineIcon";
import FilmLineIcon from "remixicon-react/FilmLineIcon";
import GroupLineIcon from "remixicon-react/GroupLineIcon";
import HeartPulseLineIcon from "remixicon-react/HeartPulseLineIcon";
import MagicLineIcon from "remixicon-react/MagicLineIcon";
import MedalFillIcon from "remixicon-react/MedalFillIcon";
import Music2LineIcon from "remixicon-react/Music2LineIcon";
import PlayCircleLineIcon from "remixicon-react/PlayCircleLineIcon";
import RestartLineIcon from "remixicon-react/RestartLineIcon";
import RefreshLineIcon from "remixicon-react/RefreshLineIcon";
import ServerFillIcon from "remixicon-react/ServerFillIcon";
import Settings3LineIcon from "remixicon-react/Settings3LineIcon";
import StarSmileLineIcon from "remixicon-react/StarSmileLineIcon";
import TimeLineIcon from "remixicon-react/TimeLineIcon";
import TrophyLineIcon from "remixicon-react/TrophyLineIcon";
import Tv2LineIcon from "remixicon-react/Tv2LineIcon";
import User3LineIcon from "remixicon-react/User3LineIcon";
import MenuLineIcon from "remixicon-react/MenuLineIcon";

import Sessions from "./components/sessions/sessions";
import { fetchActiveSessions, getCachedActiveSessions, subscribeActiveSessions } from "../lib/session-cache";
import "./css/home.css";
import {
  DEFAULT_HOME_ORDER,
  DEFAULT_HOME_SETTINGS,
  HOME_PRESETS,
  HOME_SECTION_DEFINITIONS,
  HOME_WIDGET_SIZE_LABELS,
  getHomeDisplayOrder,
  getHomeSettingsStorageKey,
  loadHomeSettings,
  normalizeHomeOrder,
  normalizeHomeSettings,
} from "../lib/home-settings";
import { mediaServerName } from "../lib/media-server";

const numberFormat = new Intl.NumberFormat();
const HOME_DASHBOARD_CACHE_KEY = "jellyglance_home_dashboard_cache";
const HOME_OPERATIONS_CACHE_KEY = "jellyglance_home_operations_cache";
const HOME_CACHE_MAX_AGE_MS = 5 * 60 * 1000;

function loadHomeCache(key) {
  try {
    const cached = JSON.parse(localStorage.getItem(key) || "null");
    if (!cached?.data || Date.now() - Number(cached.cachedAt || 0) > HOME_CACHE_MAX_AGE_MS) return null;
    return cached.data;
  } catch {
    return null;
  }
}

function saveHomeCache(key, data) {
  try {
    localStorage.setItem(key, JSON.stringify({ cachedAt: Date.now(), data }));
  } catch {
    // Ignore quota/private-mode failures; fresh network data still renders.
  }
}

function formatNumber(value) {
  return numberFormat.format(Number(value || 0));
}

function formatDate(value) {
  if (!value) return "Unknown";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
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
  const total = Number(seconds || 0);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);

  if (hours >= 1000) return `${formatNumber(hours)} hours`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function getNextMilestone(value, steps) {
  const current = Number(value || 0);
  return steps.find((step) => current < step) || steps[steps.length - 1];
}

function getMilestoneProgress(value, target) {
  const nextTarget = Number(target || 1);
  return Math.max(0, Math.min(100, (Number(value || 0) / nextTarget) * 100));
}

function buildHomeMilestones(dashboard, operations) {
  if (!dashboard) return [];

  const totalPlaybacks = Number(dashboard?.totals?.totalPlaybacks || 0);
  const totalWatchSeconds = Number(dashboard?.totals?.totalWatchSeconds || 0);
  const totalWatchHours = totalWatchSeconds / 3600;
  const uniqueViewers = Number(dashboard?.totals?.uniqueViewers || 0);
  const catalogItems = Number(dashboard?.catalog?.movies || 0) + Number(dashboard?.catalog?.shows || 0) + Number(dashboard?.catalog?.artists || 0);
  const weeklyTopPlays = Number(dashboard?.weekPulse?.topItem?.plays || 0);
  const weeklyTopName = dashboard?.weekPulse?.topItem?.name || "No weekly top item yet";
  const healthOk = Boolean(operations?.health?.ok);
  const requestStats = operations?.requests?.stats || {};
  const requestWins = Number(requestStats.available || 0) + Number(requestStats.approved || 0);
  const issueCount = Object.values(dashboard?.libraryIssues || {}).reduce((total, value) => total + Number(value || 0), 0);

  const playbackTarget = getNextMilestone(totalPlaybacks, [10, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000]);
  const hoursTarget = getNextMilestone(totalWatchHours, [10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000]);
  const catalogTarget = getNextMilestone(catalogItems, [50, 100, 250, 500, 1000, 2500, 5000, 10000, 25000]);

  return [
    {
      id: "playback-count",
      title: totalPlaybacks >= 10000 ? "10K Play Club" : "Playback Climber",
      value: formatNumber(totalPlaybacks),
      detail: `${formatNumber(Math.max(playbackTarget - totalPlaybacks, 0))} plays to ${formatNumber(playbackTarget)}`,
      progress: getMilestoneProgress(totalPlaybacks, playbackTarget),
      icon: PlayCircleLineIcon,
      unlocked: totalPlaybacks >= 10,
    },
    {
      id: "watch-hours",
      title: totalWatchHours >= 1000 ? "Thousand-Hour Theatre" : "Time Collector",
      value: formatDuration(totalWatchSeconds),
      detail: `${formatDuration(Math.max(hoursTarget * 3600 - totalWatchSeconds, 0))} to ${formatNumber(hoursTarget)} hours`,
      progress: getMilestoneProgress(totalWatchHours, hoursTarget),
      icon: TimeLineIcon,
      unlocked: totalWatchHours >= 10,
    },
    {
      id: "household",
      title: uniqueViewers >= 5 ? "Full House" : "Household Spark",
      value: formatNumber(uniqueViewers),
      detail: uniqueViewers >= 5 ? "Five or more viewers have synced activity." : `${formatNumber(Math.max(5 - uniqueViewers, 0))} more viewers to Full House`,
      progress: getMilestoneProgress(uniqueViewers, 5),
      icon: GroupLineIcon,
      unlocked: uniqueViewers >= 5,
    },
    {
      id: "weekly-binge",
      title: weeklyTopPlays >= 10 ? "Binge Beacon" : "Weekly Favourite",
      value: formatNumber(weeklyTopPlays),
      detail: `${weeklyTopName} leads this week`,
      progress: getMilestoneProgress(weeklyTopPlays, 10),
      icon: FireLineIcon,
      unlocked: weeklyTopPlays >= 10,
    },
    {
      id: "catalog",
      title: catalogItems >= 1000 ? "Vault Builder" : "Catalog Builder",
      value: formatNumber(catalogItems),
      detail: `${formatNumber(Math.max(catalogTarget - catalogItems, 0))} items to ${formatNumber(catalogTarget)}`,
      progress: getMilestoneProgress(catalogItems, catalogTarget),
      icon: Database2LineIcon,
      unlocked: catalogItems >= 50,
    },
    {
      id: "ops-health",
      title: healthOk && issueCount === 0 ? "Clean Bill" : "Care Package",
      value: healthOk ? "Healthy" : "Watch",
      detail: issueCount === 0 ? "No library issues in the current dashboard." : `${formatNumber(issueCount)} library issues tracked`,
      progress: healthOk && issueCount === 0 ? 100 : healthOk ? 65 : 28,
      icon: healthOk ? CheckboxCircleLineIcon : ErrorWarningLineIcon,
      unlocked: healthOk && issueCount === 0,
    },
    {
      id: "requests",
      title: requestWins >= 25 ? "Request Hero" : "Request Ripple",
      value: formatNumber(requestWins),
      detail: `${formatNumber(requestWins)} requests approved or available`,
      progress: getMilestoneProgress(requestWins, 25),
      icon: ChatCheckLineIcon,
      unlocked: requestWins >= 25,
    },
  ];
}

function hourLabel(hour) {
  if (hour === 0) return "12am";
  if (hour === 12) return "12pm";
  if (hour === 23) return "11pm";
  return hour < 12 ? `${hour}am` : `${hour - 12}pm`;
}

function HomeAvatar({ user, size = 58 }) {
  const [failed, setFailed] = useState(!user?.primaryImageTag);

  if (failed) {
    return (
      <span className="home-avatar home-avatar-fallback" style={{ width: size, height: size }}>
        <User3LineIcon size={Math.round(size * 0.52)} />
      </span>
    );
  }

  return (
    <img
      className="home-avatar"
      src={`/proxy/Users/Images/Primary?id=${user.userId}&fillWidth=${Math.max(size * 2, 120)}&quality=80`}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

function MetricCard({ icon: Icon, label, value, detail, accent = "cyan" }) {
  const isLoading = value === undefined || value === null;

  return (
    <article className={`home-glass-card home-metric-card home-accent-${accent}`}>
      <span className="home-icon-bubble">
        <Icon size={24} />
      </span>
      <div>
        <p>{label}</p>
        <strong className={isLoading ? "home-value-skeleton" : ""}>{isLoading ? "" : value}</strong>
        {isLoading ? <small className="home-detail-skeleton" /> : detail ? <small>{detail}</small> : null}
      </div>
    </article>
  );
}

function CatalogCard({ icon: Icon, label, value, detail }) {
  const isLoading = value === undefined || value === null;

  return (
    <article className="home-glass-card home-catalog-card">
      <Icon size={24} />
      <div>
        <p>{label}</p>
        <strong className={isLoading ? "home-value-skeleton" : ""}>{isLoading ? "" : value}</strong>
        {isLoading ? <small className="home-detail-skeleton" /> : detail ? <small>{detail}</small> : null}
      </div>
    </article>
  );
}

function HomeOpsCard({ icon: Icon, label, value, detail, to, accent = "cyan" }) {
  const content = (
    <>
      <span className="home-icon-bubble">
        <Icon size={22} />
      </span>
      <div>
        <p>{label}</p>
        <strong>{value}</strong>
        <small>{detail}</small>
      </div>
    </>
  );

  if (to) {
    return (
      <Link className={`home-glass-card home-ops-card home-accent-${accent}`} to={to}>
        {content}
      </Link>
    );
  }

  return <article className={`home-glass-card home-ops-card home-accent-${accent}`}>{content}</article>;
}

function getServiceByType(automationData, type) {
  return (automationData?.services || []).find((service) => service.type === type);
}

function getTdarrWidget(bundle) {
  const stats = bundle?.stats || {};
  const firstJob = bundle?.active?.[0] || bundle?.queued?.[0];
  const active = Number(stats.active || bundle?.active?.length || 0);
  const queued = Number(stats.queue ?? stats.queued ?? bundle?.queued?.length ?? 0);

  return {
    status: active > 0 ? `${formatNumber(active)} active` : queued > 0 ? `${formatNumber(queued)} queued` : "Idle",
    detail: firstJob
      ? [firstJob.nodeName, firstJob.hardware === "gpu" ? "GPU" : firstJob.hardware === "cpu" ? "CPU" : "", firstJob.workKind === "healthcheck" ? "Health check" : firstJob.workKind === "transcode" ? "Transcode" : firstJob.title].filter(Boolean).join(" · ")
      : "No active workers right now",
    metrics: [
      { label: "Active", value: formatNumber(active) },
      { label: "Queue", value: formatNumber(queued) },
      { label: "Saved", value: formatBytes(stats.saved || 0) },
    ],
  };
}

function getWizarrWidget(data) {
  const invites = data?.invites || [];
  const active = invites.filter((invite) => String(invite.status || "").toLowerCase() !== "used" && String(invite.status || "").toLowerCase() !== "expired").length;
  const used = invites.filter((invite) => String(invite.status || "").toLowerCase() === "used").length;

  return {
    status: `${formatNumber(active)} active`,
    detail: data?.servers?.length ? `${formatNumber(data.servers.length)} server${data.servers.length === 1 ? "" : "s"} connected` : "Invite manager ready",
    metrics: [
      { label: "Invites", value: formatNumber(data?.status?.invites ?? invites.length) },
      { label: "Used", value: formatNumber(used) },
      { label: "Users", value: formatNumber(data?.status?.users || 0) },
    ],
  };
}

function getMaintainerrWidget(bundle) {
  const storage = bundle?.storage || {};
  const stats = bundle?.stats || {};
  const health = bundle?.health || {};
  const due = Number(stats.upcomingWeek || 0);
  const scheduled = Number(stats.scheduledItems || 0);
  return {
    status: health.ok ? "Healthy" : "Needs attention",
    detail: health.status ? `${health.status}${health.live ? ", live" : ""}${health.ready ? ", ready" : ""}`.replace(/^\s*,/g, "").trim() || "Monitor cleanup schedules" : "Monitor cleanup schedules",
    metrics: [
      { label: "Scheduled", value: formatNumber(scheduled) },
      { label: "Due in 7d", value: formatNumber(due) },
      { label: "Reclaimable", value: formatBytes(storage.reclaimableBytes || 0) },
    ],
  };
}

function getAutomationServiceWidget(service, type) {
  const isBazarr = type === "bazarr";
  if (!service) {
    return {
      status: "Not connected",
      detail: `Connect ${isBazarr ? "Bazarr" : "Prowlarr"} in Settings > Integrations.`,
      metrics: [
        { label: isBazarr ? "Missing" : "Indexers", value: "0" },
        { label: isBazarr ? "Grabbed" : "Failed", value: "0" },
        { label: "Issues", value: "0" },
      ],
    };
  }

  if (isBazarr) {
    const missing = Number(service.stats?.missingEpisodes || 0) + Number(service.stats?.missingMovies || 0);
    return {
      status: service.ok ? "Healthy" : `${formatNumber(service.issues?.length || 0)} issue${service.issues?.length === 1 ? "" : "s"}`,
      detail: service.version ? `Bazarr ${service.version}` : "Subtitle health",
      metrics: [
        { label: "Missing", value: formatNumber(missing) },
        { label: "Grabbed", value: formatNumber(service.history?.length || 0) },
        { label: "Issues", value: formatNumber(service.issues?.length || 0) },
      ],
    };
  }

  return {
    status: service.ok ? "Healthy" : `${formatNumber(service.stats?.failedIndexers || 0)} failed`,
    detail: service.version ? `Prowlarr ${service.version}` : "Indexer health",
    metrics: [
      { label: "Indexers", value: formatNumber(service.stats?.indexers || 0) },
      { label: "Failed", value: formatNumber(service.stats?.failedIndexers || 0) },
      { label: "Apps", value: formatNumber(service.stats?.applications || 0) },
    ],
  };
}

function HomeIntegrationWidget({ icon: Icon, title, eyebrow, widget, error, to }) {
  return (
    <>
      <div className="home-integration-widget-head">
        <span className="home-icon-bubble">
          <Icon size={22} />
        </span>
        <div>
          <p>{eyebrow}</p>
          <h2>{title}</h2>
        </div>
        <Link to={to}>Open</Link>
      </div>
      {error ? (
        <div className="home-integration-empty">{error}</div>
      ) : (
        <>
          <strong className="home-integration-status">{widget ? widget.status : "Loading"}</strong>
          <small className="home-integration-detail">{widget ? widget.detail : "Checking integration data"}</small>
          <div className="home-integration-stat-grid">
            {(widget?.metrics || Array.from({ length: 3 }, (_, index) => ({ label: ["One", "Two", "Three"][index], value: "" }))).map((metric) => (
              <span key={metric.label}>
                <b className={!widget ? "home-value-skeleton" : ""}>{metric.value}</b>
                <em>{metric.label}</em>
              </span>
            ))}
          </div>
        </>
      )}
    </>
  );
}

export default function Home({ kioskMode = false }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [dashboard, setDashboard] = useState(() => loadHomeCache(HOME_DASHBOARD_CACHE_KEY));
  const [operations, setOperations] = useState(() => loadHomeCache(HOME_OPERATIONS_CACHE_KEY) || { requests: null, health: null });
  const [integrationWidgets, setIntegrationWidgets] = useState({ tdarr: null, wizarr: null, maintainerr: null, automation: null });
  const [integrationWidgetErrors, setIntegrationWidgetErrors] = useState({});
  const [isOrderingHome, setIsOrderingHome] = useState(false);
  const [isHomeActionsOpen, setIsHomeActionsOpen] = useState(false);
  const [homeSettings, setHomeSettings] = useState(() => loadHomeSettings(kioskMode ? "kiosk" : "user"));
  const [rotateIndex, setRotateIndex] = useState(0);
  const [actionMessage, setActionMessage] = useState("");
  const [busyAction, setBusyAction] = useState("");
  const [draggedSection, setDraggedSection] = useState("");
  const [liveSessions, setLiveSessions] = useState(() => getCachedActiveSessions() || []);
  const [detailModal, setDetailModal] = useState(null);
  const [gapBusyId, setGapBusyId] = useState("");
  const [gapMessage, setGapMessage] = useState("");
  const [, setError] = useState("");

  useEffect(() => {
    if (kioskMode) return undefined;
    let active = true;
    Config.getConfig()
      .then((cfg) => {
        if (active && cfg?.settings?.auth?.permissions?.home === false) {
          navigate("/me", { replace: true });
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [kioskMode, navigate]);

  async function loadDashboardData() {
    try {
      const cachedToken = localStorage.getItem("token");
      const config = cachedToken ? { token: cachedToken } : await Config.getConfig();
      const response = await axios.get("/stats/getHomeDashboard", {
        headers: { Authorization: `Bearer ${config.token}` },
      });
      setDashboard(response.data);
      saveHomeCache(HOME_DASHBOARD_CACHE_KEY, response.data);
      setError("");
    } catch (err) {
      console.log(err);
      setError("Home dashboard data is unavailable.");
    }
  }

  async function loadOperationsData(forceRequests = false) {
    const token = localStorage.getItem("token");
    if (!token) return;

    try {
      const response = await cachedGet(
        axios,
        "/api/home/operations",
        {
          headers: { Authorization: `Bearer ${token}` },
          params: forceRequests ? { forceRequests: "true" } : undefined,
        },
        forceRequests ? 0 : 25000
      );
      const nextOperations = response.data || { requests: null, health: null };
      setOperations(nextOperations);
      saveHomeCache(HOME_OPERATIONS_CACHE_KEY, nextOperations);
    } catch (error) {
      console.log(error);
    }
  }

  useEffect(() => {
    let active = true;

    async function fetchDashboard() {
      await loadDashboardData();
    }

    fetchDashboard();
    const interval = setInterval(fetchDashboard, kioskMode ? 60000 * 5 : 60000 * 2);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [kioskMode]);

  useEffect(() => {
    let active = true;

    async function fetchOperations() {
      if (!active) return;
      await loadOperationsData();
    }

    fetchOperations();
    const interval = setInterval(fetchOperations, kioskMode ? 60000 * 5 : 60000);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [kioskMode]);

  useEffect(() => {
    const unsubscribe = subscribeActiveSessions((sessions) => setLiveSessions(Array.isArray(sessions) ? sessions : []));
    fetchActiveSessions().catch(() => {});
    return unsubscribe;
  }, []);

  const peakHours = dashboard?.peakHours || [];
  const maxPeak = useMemo(() => Math.max(...peakHours.map((hour) => Number(hour.count || 0)), 1), [peakHours]);
  const hallOfFame = dashboard?.hallOfFame || [];
  const podium = hallOfFame.slice(0, 3);
  const podiumSlots = dashboard
    ? [
        { user: podium[1], rank: 2, medal: "Silver", avatarSize: 62 },
        { user: podium[0], rank: 1, medal: "Gold", avatarSize: 78 },
        { user: podium[2], rank: 3, medal: "Bronze", avatarSize: 58 },
      ].filter((slot) => slot.user)
    : [
        { rank: 2, medal: "Silver", avatarSize: 62 },
        { rank: 1, medal: "Gold", avatarSize: 78 },
        { rank: 3, medal: "Bronze", avatarSize: 58 },
      ];
  const runners = hallOfFame.slice(3, 5);
  const concentration = Number(dashboard?.libraryBalance?.concentration || 0);
  const requestStats = operations.requests?.stats || {};
  const recentRequests = (operations.requests?.requests || []).slice(0, 4);
  const healthChecks = operations.health?.checks || [];
  const jellyfinCheck = healthChecks.find((check) => check.key === "jellyfin");
  const failingChecks = healthChecks.filter((check) => !check.ok);
  const healthLabel = operations.health ? (operations.health.ok ? "Healthy" : `${failingChecks.length} issue${failingChecks.length === 1 ? "" : "s"}`) : "Loading";
  const backupDate = operations.health?.backup?.latestBackup?.datecreated;
  const weekPulse = dashboard?.weekPulse || {};
  const topItem = weekPulse.topItem;
  const activeViewer = weekPulse.mostActiveViewer;
  const quietUsers = weekPulse.quietUsers || [];
  const trendDelta = dashboard?.trends?.delta || {};
  const todayTrend = dashboard?.trends?.today || {};
  const libraryIssues = dashboard?.libraryIssues || {};
  const watchParty = dashboard?.watchParty || [];
  const watchTonight = dashboard?.watchTonight || [];
  const watchTonightReasonLabel = {
    continue: t("FEATURES.WATCH_TONIGHT.CONTINUE"),
    "shared-watchlist": t("FEATURES.WATCH_TONIGHT.SHARED_WATCHLIST"),
    "shared-favourite": t("FEATURES.WATCH_TONIGHT.SHARED_FAVOURITE"),
    unfinished: t("FEATURES.WATCH_TONIGHT.UNFINISHED"),
  };
  const requestUrgency = Number(requestStats.pending || 0) + Number(requestStats.failed || 0);
  const maintainerrData = operations.maintainerr || null;
  const digestItems = operations.digest?.items || [];
  const storage = operations.storage || null;
  const runningJobs = operations.jobs?.running || [];
  const maintainerrScheduled = Number(maintainerrData?.stats?.scheduledItems || 0);
  const maintainerrUpcoming = Number(maintainerrData?.stats?.upcomingWeek || 0);
  const maintainerrFailures = Number(maintainerrData?.stats?.collectionFailures || 0);
  const maintainerrReclaimableBytes = Number(maintainerrData?.storage?.reclaimableBytes || 0);
  const backupAgeMs = backupDate ? Date.now() - new Date(backupDate).getTime() : Infinity;
  const backupAgeDays = Number.isFinite(backupAgeMs) ? Math.floor(backupAgeMs / (24 * 60 * 60 * 1000)) : Infinity;
  const activeSessionCount = Array.isArray(liveSessions) ? liveSessions.length : 0;
  const transcodingSessionCount = Array.isArray(liveSessions)
    ? liveSessions.filter((session) => session.TranscodingInfo || String(session.PlayState?.PlayMethod || "").toLowerCase() === "transcode").length
    : 0;
  const directPlayCount = Math.max(0, activeSessionCount - transcodingSessionCount);
  const streamCap = Number(homeSettings.alertRules.streamCap || 0);
  const transcodeCap = Number(homeSettings.alertRules.transcodeCap || 0);
  const attentionItems = [
    requestUrgency >= Number(homeSettings.alertRules.requestThreshold || 1)
      ? { key: `requests:${requestUrgency}`, label: `${formatNumber(requestUrgency)} request${requestUrgency === 1 ? "" : "s"} need attention`, type: "requests" }
      : null,
    failingChecks.length ? { key: `health:${failingChecks.map((check) => check.key).join(",")}`, label: `${failingChecks.length} health check${failingChecks.length === 1 ? "" : "s"} failing`, type: "health" } : null,
    backupAgeDays >= Number(homeSettings.alertRules.backupDays || 7) ? { key: `backup:${backupDate || "missing"}`, label: "Backup is stale or missing", type: "backup" } : null,
    Number(libraryIssues.missingPosters || 0) >= Number(homeSettings.alertRules.missingPosterThreshold || 1)
      ? { key: `posters:${libraryIssues.missingPosters}`, label: `${formatNumber(libraryIssues.missingPosters)} missing posters`, type: "posters" }
      : null,
    streamCap > 0 && activeSessionCount > streamCap
      ? { key: `streams:${activeSessionCount}:${streamCap}`, label: `${formatNumber(activeSessionCount)} streams over the cap of ${formatNumber(streamCap)}`, type: "streams" }
      : null,
    transcodeCap > 0 && transcodingSessionCount > transcodeCap
      ? { key: `transcodes:${transcodingSessionCount}:${transcodeCap}`, label: `${formatNumber(transcodingSessionCount)} transcodes over the cap of ${formatNumber(transcodeCap)}`, type: "transcodes" }
      : null,
    maintainerrData && maintainerrData.health && maintainerrData.health.ok === false
      ? {
          key: `maintainerr-health:${maintainerrData.health.status || "unknown"}`,
          label: maintainerrData.health.status ? `Maintainerr health: ${maintainerrData.health.status}` : "Maintainerr service degraded",
          type: "maintainerr",
        }
      : null,
    maintainerrScheduled > 0
      ? {
          key: `maintainerr-scheduled:${maintainerrScheduled}`,
          label: `${formatNumber(maintainerrScheduled)} media item${maintainerrScheduled === 1 ? "" : "s"} scheduled for cleanup`,
          type: "maintainerr",
        }
      : null,
    maintainerrUpcoming > 0
      ? {
          key: `maintainerr-upcoming:${maintainerrUpcoming}`,
          label: `${formatNumber(maintainerrUpcoming)} cleanup action${maintainerrUpcoming === 1 ? "" : "s"} in the next 7 days`,
          type: "maintainerr",
        }
      : null,
    maintainerrFailures > 0
      ? {
          key: `maintainerr-failures:${maintainerrFailures}`,
          label: `${formatNumber(maintainerrFailures)} cleanup collection${maintainerrFailures === 1 ? "" : "s"} failed`,
          type: "maintainerr",
        }
      : null,
    maintainerrReclaimableBytes >= 5 * 1024 * 1024 * 1024
      ? {
          key: `maintainerr-reclaimable:${maintainerrReclaimableBytes}`,
          label: `${formatBytes(maintainerrReclaimableBytes)} reclaimable storage available`,
          type: "maintainerr",
        }
      : null,
    ...digestItems.map((item) => ({
      key: `digest:${item.type}:${item.label}`,
      label: item.label,
      type: item.type || "digest",
    })),
  ].filter((item) => item && !homeSettings.dismissedAlerts?.[item.key]);
  const seasonGaps = dashboard?.seasonGaps || [];
  const sonarrConnected = Boolean(dashboard?.sonarrConnected);

  async function searchSeasonGap(item) {
    if (!sonarrConnected || !item?.itemId) return;
    setGapBusyId(item.itemId);
    setGapMessage("");
    try {
      const token = localStorage.getItem("token");
      const response = await axios.post(
        "/api/retry-grab",
        { itemId: item.itemId, title: item.name, mediaType: "series" },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setGapMessage(response.data?.ok ? t("FEATURES.SEASON_GAPS.SEARCH_OK") : response.data?.error || t("FEATURES.SEASON_GAPS.SEARCH_FAIL"));
    } catch (error) {
      const message = error?.response?.data?.error || t("FEATURES.SEASON_GAPS.SEARCH_FAIL");
      setGapMessage(message === "Series not found in Sonarr" ? t("FEATURES.SEASON_GAPS.NOT_IN_SONARR") : message);
    } finally {
      setGapBusyId("");
    }
  }
  const automationFeed = dashboard?.automationFeed || [];
  const milestones = useMemo(() => buildHomeMilestones(dashboard, operations), [dashboard, operations]);
  const visibleWidgetCount = HOME_SECTION_DEFINITIONS.length - homeSettings.hidden.length;
  const hiddenWidgetCount = homeSettings.hidden.length;

  useEffect(() => {
    localStorage.setItem(getHomeSettingsStorageKey(kioskMode ? "kiosk" : "user"), JSON.stringify(homeSettings));
  }, [homeSettings, kioskMode]);

  function updateHomeSettings(updater) {
    setHomeSettings((current) => normalizeHomeSettings(typeof updater === "function" ? updater(current) : { ...current, ...updater }));
  }

  function moveHomeSection(sectionId, direction) {
    updateHomeSettings((current) => {
      const nextOrder = normalizeHomeOrder(current.order);
      const currentIndex = nextOrder.indexOf(sectionId);
      const nextIndex = currentIndex + direction;

      if (currentIndex < 0 || nextIndex < 0 || nextIndex >= nextOrder.length) {
        return current;
      }

      [nextOrder[currentIndex], nextOrder[nextIndex]] = [nextOrder[nextIndex], nextOrder[currentIndex]];
      return { ...current, order: nextOrder, preset: "custom" };
    });
  }

  function resetHomeOrder() {
    updateHomeSettings(DEFAULT_HOME_SETTINGS);
  }

  function toggleHomeSection(sectionId) {
    updateHomeSettings((current) => {
      const hidden = new Set(current.hidden || []);
      if (hidden.has(sectionId)) {
        hidden.delete(sectionId);
      } else {
        hidden.add(sectionId);
      }
      return { ...current, hidden: [...hidden], preset: "custom" };
    });
  }

  function dismissHomeAlert(alertKey) {
    updateHomeSettings((current) => ({
      ...current,
      dismissedAlerts: { ...(current.dismissedAlerts || {}), [alertKey]: new Date().toISOString() },
      preset: "custom",
    }));
  }

  function updateWidgetSize(sectionId, size) {
    updateHomeSettings((current) => ({
      ...current,
      sizes: { ...(current.sizes || {}), [sectionId]: size },
      preset: "custom",
    }));
  }

  function moveSectionTo(sectionId, targetId) {
    if (!sectionId || !targetId || sectionId === targetId) return;
    updateHomeSettings((current) => {
      const withoutDragged = normalizeHomeOrder(current.order).filter((id) => id !== sectionId);
      const targetIndex = withoutDragged.indexOf(targetId);
      withoutDragged.splice(targetIndex < 0 ? withoutDragged.length : targetIndex, 0, sectionId);
      return { ...current, order: withoutDragged, preset: "custom" };
    });
  }

  function exportHomeLayout() {
    const payload = JSON.stringify(homeSettings, null, 2);
    navigator.clipboard?.writeText(payload).then(() => setActionMessage("Homepage layout copied as JSON."), () => setActionMessage(payload));
  }

  function applyHomePreset(presetId) {
    const preset = HOME_PRESETS[presetId];
    if (!preset) return;
    updateHomeSettings((current) => ({
      ...current,
      order: preset.order,
      hidden: preset.hidden,
      density: preset.density,
      sizes: preset.sizes || {},
      preset: presetId,
    }));
  }

  async function runQuickAction(action) {
    const token = localStorage.getItem("token");
    const headers = { Authorization: `Bearer ${token}` };
    const actions = {
      sync: { label: `${mediaServerName()} sync`, request: () => axios.get("/sync/beginSync", { headers }) },
      backup: { label: "Backup", request: () => axios.get("/backup/beginBackup", { headers }) },
      integrations: { label: "Integration test", request: () => axios.post("/api/integrations/test-all", {}, { headers }) },
    };
    const selected = actions[action];
    if (!selected) return;

    try {
      setBusyAction(action);
      setActionMessage("");
      await selected.request();
      setActionMessage(`${selected.label} started.`);
    } catch (error) {
      setActionMessage(error.response?.data?.error || error.message || `${selected.label} failed.`);
    } finally {
      setBusyAction("");
    }
  }

  const sectionLabels = HOME_SECTION_DEFINITIONS.reduce((labels, section) => ({ ...labels, [section.id]: t(`HOME_PAGE.SECTIONS.${section.id}`, { defaultValue: section.label }) }), {});
  const orderedSectionIds = useMemo(
    () => getHomeDisplayOrder(homeSettings, { promoteOperations: requestUrgency > 0 }),
    [homeSettings.hidden, homeSettings.order, homeSettings.pinned, requestUrgency]
  );
  useEffect(() => {
    if (!kioskMode) return undefined;
    const refreshSessions = () => {
      fetchActiveSessions().catch((error) => console.log(error));
    };
    refreshSessions();
    const interval = setInterval(refreshSessions, 60000 * 5);
    return () => clearInterval(interval);
  }, [kioskMode]);

  const effectiveAutoRotate = !kioskMode && homeSettings.autoRotate;
  const activeRotateSection = effectiveAutoRotate && orderedSectionIds.length ? orderedSectionIds[rotateIndex % orderedSectionIds.length] : null;
  const homeSectionOrder = useMemo(() => Object.fromEntries(orderedSectionIds.map((sectionId, index) => [sectionId, index])), [orderedSectionIds]);
  const getHomeSectionStyle = (sectionId) => ({ order: homeSectionOrder[sectionId] ?? DEFAULT_HOME_ORDER.indexOf(sectionId) });
  const getHomeSectionClass = (sectionId, className = "") => `${className} home-widget-size-${homeSettings.sizes?.[sectionId] || "medium"} ${isOrderingHome ? "is-home-widget-editing" : ""}`.trim();
  const shouldRenderSection = (sectionId) => orderedSectionIds.includes(sectionId) && (!activeRotateSection || activeRotateSection === sectionId);
  const visibleIntegrationWidgets = useMemo(
    () => ({
      tdarr: orderedSectionIds.includes("tdarr"),
      wizarr: orderedSectionIds.includes("wizarr"),
      maintainerr: orderedSectionIds.includes("maintainerr"),
      bazarr: orderedSectionIds.includes("bazarr"),
      prowlarr: orderedSectionIds.includes("prowlarr"),
    }),
    [orderedSectionIds]
  );

  useEffect(() => {
    const wantsTdarr = visibleIntegrationWidgets.tdarr;
    const wantsWizarr = visibleIntegrationWidgets.wizarr;
    const wantsMaintainerr = visibleIntegrationWidgets.maintainerr;
    const wantsAutomation = visibleIntegrationWidgets.bazarr || visibleIntegrationWidgets.prowlarr;
    if (!wantsTdarr && !wantsWizarr && !wantsMaintainerr && !wantsAutomation) return undefined;

    let cancelled = false;

    async function loadIntegrationWidgets() {
      const requests = [];

      if (wantsTdarr) {
        requests.push(
          axios.get("/api/tdarr/transcodes")
            .then((response) => {
              if (cancelled) return;
              setIntegrationWidgets((current) => ({ ...current, tdarr: response.data }));
              setIntegrationWidgetErrors((current) => ({ ...current, tdarr: "" }));
            })
            .catch((error) => {
              if (cancelled) return;
              setIntegrationWidgetErrors((current) => ({ ...current, tdarr: error.response?.data?.error || "Unable to load Tdarr." }));
            })
        );
      }

      if (wantsWizarr) {
        requests.push(
          axios.get("/api/wizarr/summary")
            .then((response) => {
              if (cancelled) return;
              setIntegrationWidgets((current) => ({ ...current, wizarr: response.data }));
              setIntegrationWidgetErrors((current) => ({ ...current, wizarr: "" }));
            })
            .catch((error) => {
              if (cancelled) return;
              setIntegrationWidgetErrors((current) => ({ ...current, wizarr: error.response?.data?.error || "Unable to load Wizarr." }));
            })
        );
      }

      if (wantsMaintainerr) {
        requests.push(
          axios
            .get("/api/maintainerr")
            .then((response) => {
              if (cancelled) return;
              setIntegrationWidgets((current) => ({ ...current, maintainerr: response.data }));
              setIntegrationWidgetErrors((current) => ({ ...current, maintainerr: "" }));
            })
            .catch((error) => {
              if (cancelled) return;
              setIntegrationWidgetErrors((current) => ({ ...current, maintainerr: error.response?.data?.error || "Unable to load Maintainerr." }));
            })
        );
      }

      if (wantsAutomation) {
        requests.push(
          axios.get("/api/automation-health")
            .then((response) => {
              if (cancelled) return;
              setIntegrationWidgets((current) => ({ ...current, automation: response.data }));
              setIntegrationWidgetErrors((current) => ({ ...current, bazarr: "", prowlarr: "" }));
            })
            .catch((error) => {
              if (cancelled) return;
              const message = error.response?.data?.error || "Unable to load automation health.";
              setIntegrationWidgetErrors((current) => ({ ...current, bazarr: message, prowlarr: message }));
            })
        );
      }

      await Promise.all(requests);
    }

    loadIntegrationWidgets();
    const interval = setInterval(loadIntegrationWidgets, kioskMode ? 60000 * 5 : 60000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [kioskMode, visibleIntegrationWidgets.tdarr, visibleIntegrationWidgets.wizarr, visibleIntegrationWidgets.maintainerr, visibleIntegrationWidgets.bazarr, visibleIntegrationWidgets.prowlarr]);

  useEffect(() => {
    setRotateIndex(0);
  }, [orderedSectionIds.join("|"), effectiveAutoRotate]);

  useEffect(() => {
    if (!effectiveAutoRotate || orderedSectionIds.length < 2) return undefined;
    const interval = setInterval(() => {
      setRotateIndex((current) => (current + 1) % orderedSectionIds.length);
    }, 20000);
    return () => clearInterval(interval);
  }, [effectiveAutoRotate, orderedSectionIds.length]);

  return (
    <div className={`Home home-dashboard home-density-${homeSettings.density} home-theme-${homeSettings.theme} ${effectiveAutoRotate ? "is-rotating-home" : ""} ${kioskMode ? "is-kiosk-home" : ""}`}>
      <div className="home-dashboard-backdrop" aria-hidden="true" />

      <div className="home-order-toolbar">
        <div>
          <strong>{homeSettings.title || (kioskMode ? "JellyGlance Kiosk" : "JellyGlance Home")}</strong>
        </div>
        <button
          type="button"
          className="home-action-menu-trigger"
          aria-expanded={isHomeActionsOpen}
          aria-controls="home-action-menu"
          onClick={() => setIsHomeActionsOpen((current) => !current)}
        >
          <MenuLineIcon size={18} />
          Menu
        </button>
        <div id="home-action-menu" className={`home-order-actions ${isHomeActionsOpen ? "is-open" : ""}`}>
          <button
            type="button"
            onClick={() => {
              loadDashboardData();
              setIsHomeActionsOpen(false);
            }}
          >
            <RefreshLineIcon size={17} />
            Dashboard
          </button>
          <button
            type="button"
            onClick={() => {
              loadOperationsData(true);
              setIsHomeActionsOpen(false);
            }}
          >
            <RefreshLineIcon size={17} />
            Ops
          </button>
          <button
            type="button"
            onClick={() => {
              setIsOrderingHome((current) => !current);
              setIsHomeActionsOpen(false);
            }}
            aria-pressed={isOrderingHome}
          >
            <Settings3LineIcon size={17} />
            Edit widgets
          </button>
        </div>
      </div>

      {jellyfinCheck && jellyfinCheck.ok === false ? (
        <div className="home-jellyfin-down" role="status">
          <ErrorWarningLineIcon size={18} />
          <div>
            <strong>{t("FEATURES.OPS.JELLYFIN_DOWN")}</strong>
            <span>{jellyfinCheck.message}</span>
          </div>
          {kioskMode ? null : <Link to="/settings/health">{t("FEATURES.OPS.OPEN_HEALTH")}</Link>}
        </div>
      ) : null}

      {isOrderingHome ? (
        <div className="home-order-panel home-glass-card">
          <div className="home-order-panel-heading">
            <div>
              <p>Widget editor</p>
              <strong>Choose, reorder, resize, and save your Home layout.</strong>
              <span>{visibleWidgetCount} visible · {hiddenWidgetCount} hidden · saved on this browser</span>
            </div>
            <button type="button" onClick={resetHomeOrder}>
              <RestartLineIcon size={16} />
              Reset
            </button>
            <button type="button" onClick={exportHomeLayout}>
              <DownloadCloud2LineIcon size={16} />
              Export
            </button>
          </div>
          <div className="home-order-options">
            <label>
              <span>Title</span>
              <input value={homeSettings.title} placeholder="JellyGlance Home" onChange={(event) => updateHomeSettings({ title: event.target.value, preset: "custom" })} />
            </label>
            <label>
              <span>Preset</span>
              <select value={homeSettings.preset} onChange={(event) => applyHomePreset(event.target.value)}>
                <option value="custom">Custom</option>
                {Object.entries(HOME_PRESETS).map(([presetId, preset]) => (
                  <option key={presetId} value={presetId}>{preset.label}</option>
                ))}
              </select>
            </label>
            <label>
              <span>Pin top</span>
              <select value={homeSettings.pinned} onChange={(event) => updateHomeSettings({ pinned: event.target.value, preset: "custom" })}>
                <option value="">None</option>
                {HOME_SECTION_DEFINITIONS.map((section) => (
                  <option key={section.id} value={section.id}>{section.label}</option>
                ))}
              </select>
            </label>
            <label>
              <span>Density</span>
              <select value={homeSettings.density} onChange={(event) => updateHomeSettings({ density: event.target.value, preset: "custom" })}>
                <option value="comfortable">Comfortable</option>
                <option value="compact">Compact</option>
              </select>
            </label>
            <label>
              <span>Theme</span>
              <select value={homeSettings.theme} onChange={(event) => updateHomeSettings({ theme: event.target.value, preset: "custom" })}>
                <option value="default">Default</option>
                <option value="darker">Darker</option>
                <option value="neon">Neon</option>
                <option value="highContrast">High contrast</option>
                <option value="wall">Wall display</option>
              </select>
            </label>
            <button type="button" className={homeSettings.autoRotate ? "is-enabled" : ""} onClick={() => updateHomeSettings((current) => ({ ...current, autoRotate: !current.autoRotate, preset: "custom" }))}>
              <PlayCircleLineIcon size={16} />
              Auto rotate
            </button>
          </div>
          <div className="home-order-options is-alert-rules">
            <label>
              <span>Backup days</span>
              <input type="number" min="1" value={homeSettings.alertRules.backupDays} onChange={(event) => updateHomeSettings((current) => ({ ...current, alertRules: { ...current.alertRules, backupDays: Number(event.target.value) || 1 }, preset: "custom" }))} />
            </label>
            <label>
              <span>Requests alert</span>
              <input type="number" min="1" value={homeSettings.alertRules.requestThreshold} onChange={(event) => updateHomeSettings((current) => ({ ...current, alertRules: { ...current.alertRules, requestThreshold: Number(event.target.value) || 1 }, preset: "custom" }))} />
            </label>
            <label>
              <span>Missing posters</span>
              <input type="number" min="1" value={homeSettings.alertRules.missingPosterThreshold} onChange={(event) => updateHomeSettings((current) => ({ ...current, alertRules: { ...current.alertRules, missingPosterThreshold: Number(event.target.value) || 1 }, preset: "custom" }))} />
            </label>
            <label>
              <span>Stream cap</span>
              <input type="number" min="0" value={homeSettings.alertRules.streamCap ?? 0} onChange={(event) => updateHomeSettings((current) => ({ ...current, alertRules: { ...current.alertRules, streamCap: Number(event.target.value) || 0 }, preset: "custom" }))} />
            </label>
            <label>
              <span>Transcode cap</span>
              <input type="number" min="0" value={homeSettings.alertRules.transcodeCap ?? 0} onChange={(event) => updateHomeSettings((current) => ({ ...current, alertRules: { ...current.alertRules, transcodeCap: Number(event.target.value) || 0 }, preset: "custom" }))} />
            </label>
            <button type="button" onClick={() => updateHomeSettings((current) => ({ ...current, dismissedAlerts: {}, preset: "custom" }))}>Restore alerts</button>
          </div>
          {requestUrgency > 0 ? <p className="home-order-note">{t("HOME_PAGE.OPERATIONS_MOVED_UP", { count: requestUrgency, section: sectionLabels.operations })}</p> : null}
          <div className="home-order-list">
            {normalizeHomeOrder(homeSettings.order).map((sectionId, index) => {
              const isHidden = homeSettings.hidden.includes(sectionId);
              return (
              <article
                key={sectionId}
                className={`${isHidden ? "is-hidden-widget" : ""} ${draggedSection === sectionId ? "is-dragging-widget" : ""}`.trim()}
                draggable
                onDragStart={() => setDraggedSection(sectionId)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => {
                  moveSectionTo(draggedSection, sectionId);
                  setDraggedSection("");
                }}
                onDragEnd={() => setDraggedSection("")}
              >
                <span>{index + 1}</span>
                <strong className={isHidden ? "is-hidden-section" : ""}>
                  {sectionLabels[sectionId]}
                  <small>{isHidden ? t("HOME_PAGE.HIDDEN") : t(`HOME_PAGE.SIZE_${String(homeSettings.sizes?.[sectionId] || "medium").toUpperCase()}`, { defaultValue: HOME_WIDGET_SIZE_LABELS[homeSettings.sizes?.[sectionId] || "medium"] })}</small>
                </strong>
                <div>
                  <select title={t("HOME_PAGE.WIDGET_SIZE")} value={homeSettings.sizes?.[sectionId] || "medium"} onChange={(event) => updateWidgetSize(sectionId, event.target.value)}>
                    <option value="small">{t("HOME_PAGE.SIZE_SMALL")}</option>
                    <option value="medium">{t("HOME_PAGE.SIZE_MEDIUM")}</option>
                    <option value="large">{t("HOME_PAGE.SIZE_LARGE")}</option>
                  </select>
                  <button type="button" title={isHidden ? t("HOME_PAGE.SHOW_SECTION") : t("HOME_PAGE.HIDE_SECTION")} onClick={() => toggleHomeSection(sectionId)}>
                    {isHidden ? <EyeOffLineIcon size={17} /> : <EyeLineIcon size={17} />}
                  </button>
                  <button type="button" title={t("HOME_PAGE.MOVE_UP")} disabled={index === 0} onClick={() => moveHomeSection(sectionId, -1)}>
                    <ArrowUpSLineIcon size={18} />
                  </button>
                  <button type="button" title={t("HOME_PAGE.MOVE_DOWN")} disabled={index === homeSettings.order.length - 1} onClick={() => moveHomeSection(sectionId, 1)}>
                    <ArrowDownSLineIcon size={18} />
                  </button>
                </div>
              </article>
            );
            })}
          </div>
        </div>
      ) : null}

      <div className="home-section-stack">
      {shouldRenderSection("sessions") ? <section className={getHomeSectionClass("sessions", "home-active-sessions home-glass-card")} style={getHomeSectionStyle("sessions")}>
        <Sessions surface={kioskMode ? "kiosk" : "home"} />
      </section> : null}

      {shouldRenderSection("streamCapacity") ? (
        <section className={getHomeSectionClass("streamCapacity", "home-stream-capacity home-glass-card")} aria-label="Stream capacity" style={getHomeSectionStyle("streamCapacity")}>
          <div className="home-section-title">
            <PlayCircleLineIcon size={20} />
            <h2>Stream capacity</h2>
          </div>
          <div className="home-stream-capacity-grid">
            <div>
              <span>Active</span>
              <strong>{formatNumber(activeSessionCount)}{streamCap > 0 ? ` / ${formatNumber(streamCap)}` : ""}</strong>
            </div>
            <div>
              <span>Transcoding</span>
              <strong>{formatNumber(transcodingSessionCount)}{transcodeCap > 0 ? ` / ${formatNumber(transcodeCap)}` : ""}</strong>
            </div>
            <div>
              <span>Direct play</span>
              <strong>{formatNumber(directPlayCount)}</strong>
            </div>
          </div>
          <small>Set stream and transcode caps in Home layout. 0 means no alert.</small>
        </section>
      ) : null}

      {shouldRenderSection("overview") ? <section className={getHomeSectionClass("overview", "home-hero-grid")} aria-label="JellyGlance overview" style={getHomeSectionStyle("overview")}>
        <MetricCard
          icon={PlayCircleLineIcon}
          label="Total playbacks"
          value={dashboard ? formatNumber(dashboard?.totals?.totalPlaybacks) : undefined}
          detail={dashboard ? `${formatDuration(dashboard?.totals?.totalWatchSeconds)} watched` : ""}
        />
        <MetricCard
          icon={GroupLineIcon}
          label="Unique viewers"
          value={dashboard ? formatNumber(dashboard?.totals?.uniqueViewers) : undefined}
          detail={dashboard ? "people with synced activity" : ""}
          accent="purple"
        />
        <article className="home-glass-card home-peak-card">
          <div className="home-card-label">
            <TimeLineIcon size={17} />
            <span>Peak viewing hours</span>
          </div>
          <div className="home-hour-bars" aria-label="Playback count by hour">
            {peakHours.map((hour) => (
              <span key={hour.hour} className="home-hour">
                <span style={{ height: `${Math.max(12, (Number(hour.count || 0) / maxPeak) * 100)}%` }} />
              </span>
            ))}
            {!dashboard
              ? Array.from({ length: 24 }, (_, index) => (
                  <span key={`loading-${index}`} className="home-hour is-loading">
                    <span style={{ height: `${18 + (index % 6) * 10}%` }} />
                  </span>
                ))
              : null}
          </div>
          <div className="home-hour-labels">
            <span>{hourLabel(0)}</span>
            <span>{hourLabel(6)}</span>
            <span>{hourLabel(12)}</span>
            <span>{hourLabel(18)}</span>
            <span>{hourLabel(23)}</span>
          </div>
        </article>
      </section> : null}

      {shouldRenderSection("hall") ? <section className={getHomeSectionClass("hall", "home-hall-section")} style={getHomeSectionStyle("hall")}>
        <div className="home-section-title">
          <TrophyLineIcon size={20} />
          <h2>Hall of Fame</h2>
        </div>

        <div className="home-hall-grid">
          <div className="home-podium">
            {podiumSlots.map(({ user, rank, medal, avatarSize }, index) => (
              <article
                key={dashboard ? user.userId || user.userName : `loading-${rank}`}
                className={`home-podium-card rank-${rank}`}
                style={dashboard && podium[0]?.plays ? { "--hall-share": `${Math.max(10, (Number(user.plays || 0) / Number(podium[0].plays || 1)) * 100)}%` } : undefined}
              >
                <span className="home-rank-medal">
                  <span>{medal}</span>
                  <MedalFillIcon size={18} aria-hidden="true" />
                </span>
                {dashboard ? <HomeAvatar user={user} size={avatarSize} /> : <span className="home-avatar home-avatar-skeleton" style={{ width: avatarSize, height: avatarSize }} />}
                <strong className={!dashboard ? "home-name-skeleton" : ""}>{dashboard ? user.userName || "Unknown" : ""}</strong>
                {dashboard ? <small>{formatNumber(user.plays)} plays</small> : <small className="home-detail-skeleton" />}
                <span className="home-podium-share" aria-hidden="true" />
              </article>
            ))}
          </div>

          <div className="home-runner-list">
            {runners.length > 0 ? (
              runners.map((user, index) => (
                <article key={user.userId || user.userName} className="home-runner-row">
                  <span>#{index + 4}</span>
                  <HomeAvatar user={user} size={38} />
                  <strong>{user.userName || "Unknown"}</strong>
                  <small>{formatNumber(user.plays)} plays</small>
                </article>
              ))
            ) : (
              <article className="home-runner-empty">More playback history will appear here as JellyGlance syncs.</article>
            )}
          </div>
        </div>
      </section> : null}

      {shouldRenderSection("library") ? <section className={getHomeSectionClass("library", "home-secondary-grid")} aria-label="Library health" style={getHomeSectionStyle("library")}>
        <article className="home-glass-card home-balance-card">
          <p>Library balance</p>
          <strong className={!dashboard ? "home-value-skeleton" : ""}>{dashboard?.libraryBalance?.label || ""}</strong>
          {dashboard ? <small>Top library represents {concentration.toFixed(1)}% of tracked plays.</small> : <small className="home-detail-skeleton" />}
        </article>
        <MetricCard
          icon={BarChartGroupedLineIcon}
          label="Active libraries"
          value={dashboard ? formatNumber(dashboard?.catalog?.activeLibraries) : undefined}
          detail={dashboard ? "Libraries with synced items" : ""}
          accent="purple"
        />
        <MetricCard
          icon={Database2LineIcon}
          label="Catalog size"
          value={dashboard ? formatNumber(dashboard?.catalog?.movies + dashboard?.catalog?.shows) : undefined}
          detail={dashboard ? formatBytes(dashboard?.catalog?.size) : ""}
        />
        <article className="home-glass-card home-balance-card">
          <p>On-disk libraries</p>
          <strong className={!storage ? "home-value-skeleton" : ""}>{storage?.totalLabel || ""}</strong>
          {storage ? (
            <small>
              Next {storage.upcomingCount} Arr releases ≈ {storage.upcomingEstimate}
            </small>
          ) : (
            <small className="home-detail-skeleton" />
          )}
        </article>
        <article className="home-glass-card home-balance-card">
          <p>Usage concentration</p>
          <strong className={!dashboard ? "home-value-skeleton" : ""}>{dashboard ? `${concentration.toFixed(1)}%` : ""}</strong>
          {dashboard ? <small>Watched share in the busiest library.</small> : <small className="home-detail-skeleton" />}
        </article>
      </section> : null}

      {shouldRenderSection("catalog") ? <section className={getHomeSectionClass("catalog", "home-catalog-grid")} aria-label="Catalog totals" style={getHomeSectionStyle("catalog")}>
        <CatalogCard
          icon={FilmLineIcon}
          label="Movies catalog"
          value={dashboard ? formatNumber(dashboard?.catalog?.movies) : undefined}
          detail={dashboard ? "Total movies in library" : ""}
        />
        <CatalogCard
          icon={Tv2LineIcon}
          label="TV shows catalog"
          value={dashboard ? formatNumber(dashboard?.catalog?.shows) : undefined}
          detail={dashboard ? `${formatNumber(dashboard?.catalog?.episodes)} episodes` : ""}
        />
        <CatalogCard
          icon={Music2LineIcon}
          label="Music catalog"
          value={dashboard ? formatNumber(dashboard?.catalog?.artists) : undefined}
          detail={dashboard ? "Artists tracked" : ""}
        />
      </section> : null}

      {shouldRenderSection("milestones") ? (
        <section className={getHomeSectionClass("milestones", "home-milestones home-glass-card")} aria-label="Achievements and media milestones" style={getHomeSectionStyle("milestones")}>
          <div className="home-section-title">
            <StarSmileLineIcon size={20} />
            <h2>Milestones</h2>
          </div>
          <div className="home-milestone-grid">
            {(dashboard ? milestones : Array.from({ length: 4 })).map((milestone, index) => {
              const Icon = milestone?.icon || TrophyLineIcon;
              return (
                <article
                  key={milestone?.id || `loading-${index}`}
                  className={`home-milestone-card ${milestone?.unlocked ? "is-unlocked" : ""}`}
                  role={milestone ? "button" : undefined}
                  tabIndex={milestone ? 0 : undefined}
                  onClick={() => milestone ? setDetailModal({ type: "milestone", title: milestone.title, milestone }) : null}
                >
                  <span className="home-milestone-icon">
                    <Icon size={22} />
                  </span>
                  <div>
                    <strong className={!dashboard ? "home-value-skeleton" : ""}>{milestone?.title || ""}</strong>
                    {dashboard ? <small>{milestone.detail}</small> : <small className="home-detail-skeleton" />}
                  </div>
                  <em className={!dashboard ? "home-value-skeleton" : ""}>{milestone?.value || ""}</em>
                  <span className="home-milestone-progress" aria-hidden="true">
                    <i style={{ width: `${milestone?.progress || 0}%` }} />
                  </span>
                </article>
              );
            })}
          </div>
        </section>
      ) : null}

      {shouldRenderSection("week") ? <section className={getHomeSectionClass("week", "home-week-pulse home-glass-card")} aria-label="This week pulse" style={getHomeSectionStyle("week")}>
        <div className="home-section-title">
          <FireLineIcon size={20} />
          <h2>This Week</h2>
        </div>
        <div className="home-week-grid">
          <article className="home-week-feature">
            <span>Top item</span>
            <strong className={!dashboard ? "home-value-skeleton" : ""}>{dashboard ? topItem?.name || "No plays yet" : ""}</strong>
            {dashboard ? <small>{topItem ? `${formatNumber(topItem.plays)} plays · ${formatDuration(topItem.watchSeconds)}` : "Waiting for this week's viewing history."}</small> : <small className="home-detail-skeleton" />}
          </article>
          <article>
            <span>Most active</span>
            <strong className={!dashboard ? "home-value-skeleton" : ""}>{dashboard ? activeViewer?.userName || "Nobody yet" : ""}</strong>
            {dashboard ? <small>{activeViewer ? `${formatNumber(activeViewer.plays)} plays this week` : "No weekly activity found."}</small> : <small className="home-detail-skeleton" />}
          </article>
          <article>
            <span>Quiet users</span>
            <strong className={!dashboard ? "home-value-skeleton" : ""}>{dashboard ? formatNumber(quietUsers.length) : ""}</strong>
            {dashboard ? <small>{quietUsers.length ? quietUsers.map((user) => user.userName).join(", ") : "Everyone has checked in recently."}</small> : <small className="home-detail-skeleton" />}
          </article>
        </div>
      </section> : null}

      {shouldRenderSection("attention") ? (
        <section className={getHomeSectionClass("attention", "home-attention-section home-glass-card")} aria-label="Needs attention" style={getHomeSectionStyle("attention")}>
          <div className="home-section-title">
            <ErrorWarningLineIcon size={20} />
            <h2>Needs Attention</h2>
          </div>
          <div className="home-attention-list">
            {attentionItems.length ? attentionItems.map((item) => (
              <span key={item.key}>
                {item.label}
                <button type="button" onClick={() => dismissHomeAlert(item.key)}>Dismiss</button>
              </span>
            )) : <span>Nothing urgent right now.</span>}
          </div>
        </section>
      ) : null}

      {shouldRenderSection("trends") ? (
        <section className={getHomeSectionClass("trends", "home-trend-grid")} aria-label="Today versus last week" style={getHomeSectionStyle("trends")}>
          <MetricCard icon={PlayCircleLineIcon} label="Plays today" value={dashboard ? formatNumber(todayTrend.plays) : undefined} detail={dashboard ? `${trendDelta.plays >= 0 ? "+" : ""}${formatNumber(trendDelta.plays)} vs last week` : ""} />
          <MetricCard icon={TimeLineIcon} label="Hours today" value={dashboard ? formatDuration(todayTrend.watchSeconds) : undefined} detail={dashboard ? `${trendDelta.watchSeconds >= 0 ? "+" : ""}${formatDuration(Math.abs(trendDelta.watchSeconds || 0))} vs last week` : ""} accent="purple" />
          <MetricCard icon={GroupLineIcon} label="Active today" value={dashboard ? formatNumber(todayTrend.activeUsers) : undefined} detail={dashboard ? `${trendDelta.activeUsers >= 0 ? "+" : ""}${formatNumber(trendDelta.activeUsers)} users vs last week` : ""} />
        </section>
      ) : null}

      {shouldRenderSection("issues") ? (
        <section className={getHomeSectionClass("issues", "home-issue-grid")} aria-label="Library issues" style={getHomeSectionStyle("issues")}>
          <button type="button" className="home-issue-button" onClick={() => setDetailModal({ type: "issues", title: "Missing Posters", body: `${formatNumber(libraryIssues.missingPosters)} items are missing primary artwork.` })}>
            <MetricCard icon={FilmLineIcon} label="Missing posters" value={dashboard ? formatNumber(libraryIssues.missingPosters) : undefined} detail={dashboard ? "Items without primary art" : ""} accent="purple" />
          </button>
          <button type="button" className="home-issue-button" onClick={() => setDetailModal({ type: "seasonGaps", title: "Season Gaps", items: seasonGaps })}>
            <MetricCard icon={Tv2LineIcon} label="Missing episodes" value={dashboard ? formatNumber(libraryIssues.missingEpisodeSeries) : undefined} detail={dashboard ? "Series with no synced episodes" : ""} />
          </button>
          <button type="button" className="home-issue-button" onClick={() => setDetailModal({ type: "issues", title: "Missing Runtime", body: `${formatNumber(libraryIssues.missingRuntime)} items are missing runtime data.` })}>
            <MetricCard icon={Database2LineIcon} label="Missing runtime" value={dashboard ? formatNumber(libraryIssues.missingRuntime) : undefined} detail={dashboard ? "Items without runtime data" : ""} accent="purple" />
          </button>
        </section>
      ) : null}

      {shouldRenderSection("watchParty") ? (
        <section className={getHomeSectionClass("watchParty", "home-watch-party home-glass-card")} aria-label="Watch party suggestions" style={getHomeSectionStyle("watchParty")}>
          <div className="home-section-title">
            <StarSmileLineIcon size={20} />
            <h2>Watch Party</h2>
          </div>
          <div className="home-watch-party-list">
            {watchParty.length ? watchParty.map((item) => (
              <article key={`${item.itemId}-${item.name}`} role="button" tabIndex={0} onClick={() => setDetailModal({ type: "watchParty", title: item.name, item })}>
                <strong>{item.name}</strong>
                <small>{formatNumber(item.users)} users · {formatNumber(item.plays)} plays in 30 days</small>
              </article>
            )) : <span>No shared viewing overlap yet.</span>}
          </div>
        </section>
      ) : null}

      {shouldRenderSection("watchTonight") ? (
        <section className={getHomeSectionClass("watchTonight", "home-watch-party home-glass-card")} aria-label={t("FEATURES.WATCH_TONIGHT.TITLE")} style={getHomeSectionStyle("watchTonight")}>
          <div className="home-section-title">
            <PlayCircleLineIcon size={20} />
            <h2>{t("FEATURES.WATCH_TONIGHT.TITLE")}</h2>
          </div>
          <div className="home-watch-party-list">
            {watchTonight.length ? watchTonight.map((item) => (
              <article key={`${item.itemId}-${item.name}`}>
                <Link to={`/libraries/item/${item.itemId}`} className="home-watch-tonight-card">
                  <strong>{item.name}</strong>
                  <small>{t("FEATURES.WATCH_TONIGHT.USERS", { count: (item.users || []).length })}</small>
                  {(item.users || []).length ? <span className="home-watch-tonight-users">{item.users.join(", ")}</span> : null}
                  {(item.reasons || []).length ? (
                    <span className="home-watch-tonight-reasons">
                      {item.reasons.map((reason) => (
                        <em key={`${item.itemId}-${reason}`}>{watchTonightReasonLabel[reason] || reason}</em>
                      ))}
                    </span>
                  ) : null}
                </Link>
              </article>
            )) : <span>{t("FEATURES.WATCH_TONIGHT.NO_PICKS")}</span>}
          </div>
        </section>
      ) : null}

      {shouldRenderSection("seasonGaps") ? (
        <section className={getHomeSectionClass("seasonGaps", "home-watch-party home-glass-card")} aria-label="Season gaps" style={getHomeSectionStyle("seasonGaps")}>
          <div className="home-section-title">
            <Tv2LineIcon size={20} />
            <h2>Season Gaps</h2>
          </div>
          <div className="home-watch-party-list">
            {seasonGaps.length ? seasonGaps.map((item) => (
              <article key={item.itemId} className="home-season-gap-row">
                <div>
                  <strong>{item.name}</strong>
                  <small>No synced episodes found</small>
                </div>
                {sonarrConnected ? (
                  <button type="button" disabled={Boolean(gapBusyId)} onClick={() => searchSeasonGap(item)}>
                    {gapBusyId === item.itemId ? t("FEATURES.SEASON_GAPS.SEARCHING") : t("FEATURES.SEASON_GAPS.SEARCH_SONARR")}
                  </button>
                ) : null}
              </article>
            )) : <span>No season gaps found.</span>}
          </div>
          {gapMessage ? <p className="home-season-gap-message">{gapMessage}</p> : null}
        </section>
      ) : null}

      {shouldRenderSection("automation") ? (
        <section className={getHomeSectionClass("automation", "home-watch-party home-glass-card")} aria-label="Automation activity feed" style={getHomeSectionStyle("automation")}>
          <div className="home-section-title">
            <RefreshLineIcon size={20} />
            <h2>Automation</h2>
          </div>
          <div className="home-watch-party-list">
            {automationFeed.length ? automationFeed.map((item) => (
              <article key={item.id}>
                <strong>{item.name}</strong>
                <small>{item.result} · {formatDate(item.timeRun)}</small>
              </article>
            )) : <span>No automation activity yet.</span>}
          </div>
        </section>
      ) : null}

      {shouldRenderSection("tdarr") ? (
        <section className={getHomeSectionClass("tdarr", "home-integration-widget home-glass-card")} aria-label="Tdarr transcode widget" style={getHomeSectionStyle("tdarr")}>
          <HomeIntegrationWidget
            icon={Tv2LineIcon}
            title="Tdarr"
            eyebrow="Active transcodes"
            widget={integrationWidgets.tdarr ? getTdarrWidget(integrationWidgets.tdarr) : null}
            error={integrationWidgetErrors.tdarr}
            to="/active-transcodes"
          />
        </section>
      ) : null}

      {shouldRenderSection("wizarr") ? (
        <section className={getHomeSectionClass("wizarr", "home-integration-widget home-glass-card")} aria-label="Wizarr invite widget" style={getHomeSectionStyle("wizarr")}>
          <HomeIntegrationWidget
            icon={GroupLineIcon}
            title="Wizarr"
            eyebrow="Invite manager"
            widget={integrationWidgets.wizarr ? getWizarrWidget(integrationWidgets.wizarr) : null}
            error={integrationWidgetErrors.wizarr}
            to="/wizarr"
          />
        </section>
      ) : null}

      {shouldRenderSection("maintainerr") ? (
        <section
          className={getHomeSectionClass("maintainerr", "home-integration-widget home-glass-card")}
          aria-label="Maintainerr cleanup widget"
          style={getHomeSectionStyle("maintainerr")}
        >
          <HomeIntegrationWidget
            icon={Database2LineIcon}
            title="Maintainerr"
            eyebrow="Cleanup schedule"
            widget={integrationWidgets.maintainerr ? getMaintainerrWidget(integrationWidgets.maintainerr) : null}
            error={integrationWidgetErrors.maintainerr}
            to="/maintainerr"
          />
        </section>
      ) : null}

      {shouldRenderSection("bazarr") ? (
        <section className={getHomeSectionClass("bazarr", "home-integration-widget home-glass-card")} aria-label="Bazarr subtitle widget" style={getHomeSectionStyle("bazarr")}>
          <HomeIntegrationWidget
            icon={ChatCheckLineIcon}
            title="Bazarr"
            eyebrow="Subtitle health"
            widget={integrationWidgets.automation ? getAutomationServiceWidget(getServiceByType(integrationWidgets.automation, "bazarr"), "bazarr") : null}
            error={integrationWidgetErrors.bazarr}
            to="/automation-health"
          />
        </section>
      ) : null}

      {shouldRenderSection("prowlarr") ? (
        <section className={getHomeSectionClass("prowlarr", "home-integration-widget home-glass-card")} aria-label="Prowlarr indexer widget" style={getHomeSectionStyle("prowlarr")}>
          <HomeIntegrationWidget
            icon={BarChartGroupedLineIcon}
            title="Prowlarr"
            eyebrow="Indexer health"
            widget={integrationWidgets.automation ? getAutomationServiceWidget(getServiceByType(integrationWidgets.automation, "prowlarr"), "prowlarr") : null}
            error={integrationWidgetErrors.prowlarr}
            to="/automation-health"
          />
        </section>
      ) : null}

      {shouldRenderSection("quickActions") ? (
        <section className={getHomeSectionClass("quickActions", "home-quick-actions home-glass-card")} aria-label="Homepage quick actions" style={getHomeSectionStyle("quickActions")}>
          <div className="home-section-title">
            <MagicLineIcon size={20} />
            <h2>Quick Actions</h2>
          </div>
          <div className="home-quick-action-grid">
            <button type="button" disabled={Boolean(busyAction)} onClick={() => runQuickAction("sync")}>Sync {mediaServerName()}</button>
            <button type="button" disabled={Boolean(busyAction)} onClick={() => runQuickAction("integrations")}>Test integrations</button>
            <button type="button" disabled={Boolean(busyAction)} onClick={() => runQuickAction("backup")}>Run backup</button>
            <Link to="/requests">Open Requests</Link>
          </div>
          {actionMessage ? <p>{actionMessage}</p> : null}
        </section>
      ) : null}

      {shouldRenderSection("operations") ? <section className={getHomeSectionClass("operations", "home-ops-section")} aria-label="Server operations" style={getHomeSectionStyle("operations")}>
        <div className="home-section-title">
          <HeartPulseLineIcon size={20} />
          <h2>Operations</h2>
        </div>

        <div className="home-ops-grid">
          <HomeOpsCard
            icon={ChatCheckLineIcon}
            label="Request queue"
            value={`${formatNumber(requestStats.pending)} pending`}
            detail={`${formatNumber(requestStats.failed)} failed · ${formatNumber(requestStats.available)} available`}
            to="/requests"
            accent="purple"
          />
          <HomeOpsCard
            icon={operations.health?.ok ? CheckboxCircleLineIcon : ErrorWarningLineIcon}
            label="System health"
            value={healthLabel}
            detail={operations.health ? healthChecks.map((check) => `${check.label}: ${check.ok ? "OK" : "Issue"}`).slice(0, 2).join(" · ") : "Checking services"}
            to="/settings"
          />
          <HomeOpsCard
            icon={Database2LineIcon}
            label="Backups"
            value={operations.health?.backup?.count ?? "Loading"}
            detail={backupDate ? `Latest ${formatDate(backupDate)}` : "No backup found"}
            to="/settings"
            accent="purple"
          />
          <HomeOpsCard
            icon={ServerFillIcon}
            label="Server jobs"
            value={runningJobs.length ? `${runningJobs.length} running` : "Idle"}
            detail={runningJobs[0]?.name || "No library scans in progress"}
            to="/server-management"
          />
        </div>

        <div className="home-request-preview home-glass-card">
          <div className="home-request-preview-heading">
            <div>
              <p>Recent requests</p>
              <strong>{formatNumber(operations.requests?.requests?.length || 0)} total</strong>
            </div>
            <Link to="/requests">Open Requests</Link>
          </div>
          <div className="home-request-list">
            {recentRequests.length ? (
              recentRequests.map((request) => (
                <article key={request.id}>
                  <span className={`home-request-status is-${String(request.pipelineStatus || request.status || "unknown").toLowerCase()}`}>{request.pipelineLabel || request.status}</span>
                  <div>
                    <strong>{request.title}{request.year ? ` (${request.year})` : ""}</strong>
                    <small>{request.requestedBy} · {request.source}</small>
                  </div>
                  <em>{request.availability?.status || "Unknown"}</em>
                </article>
              ))
            ) : (
              <span className="home-request-empty">No requests to show yet.</span>
            )}
          </div>
        </div>
      </section> : null}
      </div>
      <Modal show={Boolean(detailModal)} onHide={() => setDetailModal(null)} centered contentClassName="home-detail-modal">
        <Modal.Header closeButton>
          <Modal.Title>{detailModal?.title}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {detailModal?.body ? <p>{detailModal.body}</p> : null}
          {detailModal?.item ? <p>{detailModal.item.name} has overlap across {formatNumber(detailModal.item.users)} users and {formatNumber(detailModal.item.plays)} recent plays.</p> : null}
          {detailModal?.milestone ? (
            <p>
              {detailModal.milestone.unlocked ? "Unlocked." : "In progress."} {detailModal.milestone.detail}
            </p>
          ) : null}
          {detailModal?.items?.length ? detailModal.items.map((item) => (
            <article key={item.itemId} className="home-detail-row home-season-gap-row">
              <div>
                <strong>{item.name}</strong>
                <small>No synced episodes found</small>
              </div>
              {sonarrConnected ? (
                <button type="button" disabled={Boolean(gapBusyId)} onClick={() => searchSeasonGap(item)}>
                  {gapBusyId === item.itemId ? t("FEATURES.SEASON_GAPS.SEARCHING") : t("FEATURES.SEASON_GAPS.SEARCH_SONARR")}
                </button>
              ) : null}
            </article>
          )) : null}
          {detailModal?.type === "seasonGaps" && gapMessage ? <p className="home-season-gap-message">{gapMessage}</p> : null}
        </Modal.Body>
      </Modal>
    </div>
  );
}

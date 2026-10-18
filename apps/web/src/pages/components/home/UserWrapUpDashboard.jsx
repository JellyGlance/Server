import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import axios from "../../../lib/axios_instance";
import Config from "../../../lib/config";
import { slugifyUserName } from "../../../lib/userProfile";
import AccountCircleFillIcon from "remixicon-react/AccountCircleFillIcon";
import CalendarLineIcon from "remixicon-react/CalendarLineIcon";
import ComputerLineIcon from "remixicon-react/ComputerLineIcon";
import FilmLineIcon from "remixicon-react/FilmLineIcon";
import FireLineIcon from "remixicon-react/FireLineIcon";
import MoonLineIcon from "remixicon-react/MoonLineIcon";
import PlayCircleLineIcon from "remixicon-react/PlayCircleLineIcon";
import StarSmileLineIcon from "remixicon-react/StarSmileLineIcon";
import StackLineIcon from "remixicon-react/StackLineIcon";
import SunLineIcon from "remixicon-react/SunLineIcon";
import TimeLineIcon from "remixicon-react/TimeLineIcon";
import TrophyLineIcon from "remixicon-react/TrophyLineIcon";
import UserSettingsLineIcon from "remixicon-react/UserSettingsLineIcon";
import "../../css/home-user-wrap.css";
import { isEmby, mediaServerName } from "../../../lib/media-server";

function quickConnectLabel(t) {
  return isEmby() ? t("WRAP_UP.EMBY_LOGIN") : t("WRAP_UP.JELLYFIN_QUICK_CONNECT");
}

const token = localStorage.getItem("token");

function formatWatchTime(seconds = 0) {
  const totalMinutes = Math.round(Number(seconds || 0) / 60);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;

  if (days) {
    return `${days}d ${hours}h`;
  }

  if (hours) {
    return `${hours}h ${minutes}m`;
  }

  return `${minutes}m`;
}

function getNextTarget(value, targets) {
  const current = Number(value || 0);
  return targets.find((target) => current < target) || targets[targets.length - 1];
}

function progress(value, target) {
  return Math.max(0, Math.min(100, (Number(value || 0) / Number(target || 1)) * 100));
}

function daysSince(value) {
  if (!value) return Infinity;
  return Math.floor((Date.now() - new Date(value).getTime()) / (24 * 60 * 60 * 1000));
}

function buildUserAchievements(user, rank, t) {
  const streams = Number(user.TotalStreams || 0);
  const watchSeconds = Number(user.TotalWatchTime || 0);
  const watchHours = watchSeconds / 3600;
  const uniqueTitles = Number(user.UniqueTitles || 0);
  const uniqueClients = Number(user.UniqueClients || 0);
  const topHour = Number(user.TopHour?.Hour ?? -1);
  const topDayCount = Number(user.TopDay?.Count || 0);
  const topLibraryCount = Number(user.TopLibrary?.Count || 0);
  const recentDays = daysSince(user.LastActivityDate);
  const streamTarget = getNextTarget(streams, [10, 25, 50, 100, 250, 500, 1000, 2500, 5000]);
  const hourTarget = getNextTarget(watchHours, [10, 25, 50, 100, 250, 500, 1000, 2500]);
  const titleTarget = getNextTarget(uniqueTitles, [5, 10, 25, 50, 100, 250, 500]);
  const clientTarget = getNextTarget(uniqueClients, [2, 3, 5, 8, 12]);

  const achievements = [
    {
      id: "rank",
      title: rank === 1 ? t("WRAP_UP.ACHIEVEMENTS.HOUSEHOLD_CHAMPION") : t("WRAP_UP.ACHIEVEMENTS.LEADERBOARD_CLIMBER"),
      value: `#${rank}`,
      detail: rank === 1 ? t("WRAP_UP.ACHIEVEMENTS.HOUSEHOLD_CHAMPION_DETAIL") : t("WRAP_UP.ACHIEVEMENTS.LEADERBOARD_CLIMBER_DETAIL"),
      icon: TrophyLineIcon,
      unlocked: rank === 1,
      progress: rank === 1 ? 100 : Math.max(12, 100 - rank * 12),
    },
    {
      id: "streams",
      title: streams >= 1000 ? t("WRAP_UP.ACHIEVEMENTS.STREAM_MACHINE") : t("WRAP_UP.ACHIEVEMENTS.PLAY_COUNTER"),
      value: streams.toLocaleString(),
      detail: t("WRAP_UP.ACHIEVEMENTS.STREAMS_TO_TARGET", { remaining: Math.max(streamTarget - streams, 0).toLocaleString(), target: streamTarget.toLocaleString() }),
      icon: PlayCircleLineIcon,
      unlocked: streams >= 10,
      progress: progress(streams, streamTarget),
    },
    {
      id: "watch-time",
      title: watchHours >= 500 ? t("WRAP_UP.ACHIEVEMENTS.TIME_LORD") : t("WRAP_UP.ACHIEVEMENTS.TIME_COLLECTOR"),
      value: formatWatchTime(watchSeconds),
      detail: t("WRAP_UP.ACHIEVEMENTS.HOURS_TO_TARGET", { remaining: formatWatchTime(Math.max(hourTarget * 3600 - watchSeconds, 0)), target: hourTarget.toLocaleString() }),
      icon: TimeLineIcon,
      unlocked: watchHours >= 10,
      progress: progress(watchHours, hourTarget),
    },
    {
      id: "unique-titles",
      title: uniqueTitles >= 100 ? t("WRAP_UP.ACHIEVEMENTS.TASTE_EXPLORER") : t("WRAP_UP.ACHIEVEMENTS.SAMPLER"),
      value: uniqueTitles.toLocaleString(),
      detail: t("WRAP_UP.ACHIEVEMENTS.TITLES_TO_TARGET", { remaining: Math.max(titleTarget - uniqueTitles, 0).toLocaleString(), target: titleTarget.toLocaleString() }),
      icon: StarSmileLineIcon,
      unlocked: uniqueTitles >= 5,
      progress: progress(uniqueTitles, titleTarget),
    },
    {
      id: "clients",
      title: uniqueClients >= 5 ? t("WRAP_UP.ACHIEVEMENTS.DEVICE_HOPPER") : t("WRAP_UP.ACHIEVEMENTS.CLIENT_CURIOUS"),
      value: uniqueClients.toLocaleString(),
      detail: user.TopClient?.Name ? t("WRAP_UP.ACHIEVEMENTS.FAVOURITE_CLIENT", { client: user.TopClient.Name }) : t("WRAP_UP.ACHIEVEMENTS.NO_CLIENT_HISTORY"),
      icon: ComputerLineIcon,
      unlocked: uniqueClients >= 2,
      progress: progress(uniqueClients, clientTarget),
    },
    {
      id: "watch-window",
      title:
        topHour >= 22 || topHour <= 4
          ? t("WRAP_UP.ACHIEVEMENTS.NIGHT_OWL")
          : topHour >= 5 && topHour <= 11
            ? t("WRAP_UP.ACHIEVEMENTS.MORNING_WATCHER")
            : t("WRAP_UP.ACHIEVEMENTS.PRIME_TIME_REGULAR"),
      value: formatHour(user.TopHour?.Hour, t),
      detail: t("WRAP_UP.ACHIEVEMENTS.STREAMS_AROUND_TIME", { streams: user.TopHour?.Count || 0 }),
      icon: topHour >= 22 || topHour <= 4 ? MoonLineIcon : topHour >= 5 && topHour <= 11 ? SunLineIcon : FireLineIcon,
      unlocked: topHour >= 0,
      progress: progress(Number(user.TopHour?.Count || 0), 25),
    },
    {
      id: "favourite-day",
      title: t("WRAP_UP.ACHIEVEMENTS.RITUAL_DAY"),
      value: user.TopDay?.Name || t("WRAP_UP.NOT_AVAILABLE"),
      detail: t("WRAP_UP.ACHIEVEMENTS.STREAMS_ON_DAY", { streams: topDayCount.toLocaleString() }),
      icon: CalendarLineIcon,
      unlocked: topDayCount >= 3,
      progress: progress(topDayCount, 25),
    },
    {
      id: "library-loyalty",
      title: topLibraryCount >= 50 ? t("WRAP_UP.ACHIEVEMENTS.LIBRARY_LOYALIST") : t("WRAP_UP.ACHIEVEMENTS.LIBRARY_REGULAR"),
      value: user.TopLibrary?.Name || t("WRAP_UP.NOT_AVAILABLE"),
      detail: t("WRAP_UP.ACHIEVEMENTS.PLAYS_IN_LIBRARY", { plays: topLibraryCount.toLocaleString() }),
      icon: StackLineIcon,
      unlocked: topLibraryCount >= 10,
      progress: progress(topLibraryCount, 100),
    },
    {
      id: "recent",
      title: recentDays <= 7 ? t("WRAP_UP.ACHIEVEMENTS.RECENTLY_ACTIVE") : t("WRAP_UP.ACHIEVEMENTS.COMEBACK_PENDING"),
      value: recentDays === Infinity ? t("WRAP_UP.NEVER") : `${recentDays}d`,
      detail: recentDays <= 7 ? t("WRAP_UP.ACHIEVEMENTS.RECENTLY_ACTIVE_DETAIL") : t("WRAP_UP.ACHIEVEMENTS.COMEBACK_PENDING_DETAIL"),
      icon: FireLineIcon,
      unlocked: recentDays <= 7,
      progress: recentDays === Infinity ? 0 : Math.max(0, 100 - recentDays * 8),
    },
  ];
  // Only admins get a rank back from the API, so leave the badge out without one.
  return rank ? achievements : achievements.filter((achievement) => achievement.id !== "rank");
}

function greeting(t) {
  const hour = new Date().getHours();
  if (hour < 12) return t("WRAP_UP.GOOD_MORNING");
  if (hour < 18) return t("WRAP_UP.GOOD_AFTERNOON");
  return t("WRAP_UP.GOOD_EVENING");
}

function formatHour(hour, t) {
  if (hour === undefined || hour === null) {
    return t("WRAP_UP.NOT_AVAILABLE");
  }

  const date = new Date();
  date.setHours(Number(hour), 0, 0, 0);
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function avatar(user, size = 96) {
  if (user.PrimaryImageTag) {
    return <img src={`/proxy/Users/Images/Primary?id=${user.UserId}&fillWidth=${size * 2}&quality=90`} alt="" />;
  }

  return <AccountCircleFillIcon size={size} />;
}

function startOfDay(date) {
  const nextDate = new Date(date);
  nextDate.setHours(0, 0, 0, 0);
  return nextDate;
}

function addDays(date, days) {
  const nextDate = new Date(date);
  nextDate.setDate(nextDate.getDate() + days);
  return nextDate;
}

function getHeatmapYears(activity = []) {
  const years = Array.from(
    new Set(
      activity
        .map((day) => new Date(day.Date).getFullYear())
        .filter((year) => Number.isFinite(year))
    )
  );

  return years.sort((a, b) => b - a);
}

function getHeatmapRange(activity = [], selectedRange) {
  const today = startOfDay(new Date());
  const years = getHeatmapYears(activity);

  if (selectedRange && selectedRange !== "last-year") {
    const year = Number(selectedRange);
    const start = startOfDay(new Date(year, 0, 1));
    const end = year === today.getFullYear() ? today : startOfDay(new Date(year, 11, 31));
    return { start, end, label: String(year) };
  }

  return {
    start: addDays(today, -364),
    end: today,
    // The component fills in the translated "Last 12 months" label.
    label: null,
    years,
  };
}

function buildHeatmap(activity = [], selectedRange = "last-year") {
  const activityMap = new Map(activity.map((day) => [new Date(day.Date).toISOString().slice(0, 10), day]));
  const { start, end, label } = getHeatmapRange(activity, selectedRange);
  const alignedStart = addDays(start, -start.getDay());

  const cells = [];
  for (const current = new Date(alignedStart); current <= end; current.setDate(current.getDate() + 1)) {
    const key = current.toISOString().slice(0, 10);
    const item = activityMap.get(key);
    const isSpacer = current < start;
    cells.push({
      date: key,
      streams: isSpacer ? 0 : item?.Streams || 0,
      duration: isSpacer ? 0 : Number(item?.Duration || 0),
      day: current.getDay(),
      isSpacer,
    });
  }

  return { cells, label, start, end };
}

function intensity(streams) {
  if (!streams) return 0;
  if (streams >= 10) return 4;
  if (streams >= 6) return 3;
  if (streams >= 3) return 2;
  return 1;
}

function formatHeatmapRange(start, end) {
  return `${start.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })} - ${end.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
  })}`;
}

function WrapMetric({ icon: Icon, label, value, detail, imageId, imageType = "Backdrop" }) {
  const { t } = useTranslation();
  const backgroundStyle = imageId
    ? {
        "--metric-art": `url(/proxy/Items/Images/${imageType}?id=${imageId}&fillWidth=720&quality=44)`,
      }
    : undefined;

  return (
    <div className={`wrap-metric-card ${imageId ? "has-artwork" : ""}`} style={backgroundStyle}>
      <Icon size={30} />
      <span>{label}</span>
      <strong>{value || t("WRAP_UP.NOT_AVAILABLE")}</strong>
      <small>{detail || ""}</small>
    </div>
  );
}

const HEATMAP_DAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

function Heatmap({ user }) {
  const { t } = useTranslation();
  const years = getHeatmapYears(user.DailyActivity);
  const [selectedRange, setSelectedRange] = useState("last-year");
  const { cells, label, start, end } = buildHeatmap(user.DailyActivity, selectedRange);
  const monthLabels = [];
  let lastMonth = "";
  const weekCount = Math.max(1, Math.ceil(cells.length / 7));

  cells.forEach((cell, index) => {
    if (cell.isSpacer) return;
    const month = new Date(cell.date).toLocaleString([], { month: "short" });
    if (month !== lastMonth) {
      monthLabels.push({ month, index });
      lastMonth = month;
    }
  });

  return (
    <div className="wrap-heatmap">
      <div className="wrap-heatmap-header">
        <div>
          <span>{t("WRAP_UP.ACTIVITY")}</span>
          <strong>{user.FirstActivityDate ? `${label || t("WRAP_UP.LAST_12_MONTHS")} · ${formatHeatmapRange(start, end)}` : t("WRAP_UP.NO_PLAYBACK_YET")}</strong>
        </div>
        <select value={selectedRange} onChange={(event) => setSelectedRange(event.target.value)} aria-label={t("WRAP_UP.HEATMAP_RANGE")}>
          <option value="last-year">{t("WRAP_UP.LAST_12_MONTHS")}</option>
          {years.map((year) => (
            <option value={year} key={year}>
              {year}
            </option>
          ))}
        </select>
      </div>
      <div className="wrap-heatmap-scroll" style={{ "--heatmap-weeks": weekCount }}>
        <div className="wrap-heatmap-months">
          {monthLabels.map((monthLabel) => (
            <span key={`${monthLabel.month}-${monthLabel.index}`} style={{ gridColumnStart: Math.max(1, Math.floor(monthLabel.index / 7) + 1) }}>
              {monthLabel.month}
            </span>
          ))}
        </div>
        <div className="wrap-heatmap-body">
          <div className="wrap-heatmap-days" aria-hidden="true">
            {HEATMAP_DAYS.map((day) => (
              <span key={day}>{t(`WRAP_UP.DAYS.${day}`)}</span>
            ))}
          </div>
          <div className="wrap-heatmap-grid">
            {cells.map((cell) => (
              <span
                className={`heatmap-cell ${cell.isSpacer ? "is-spacer" : `heat-${intensity(cell.streams)}`}`}
                key={cell.date}
                title={cell.isSpacer ? "" : t("WRAP_UP.HEATMAP_CELL", { date: cell.date, streams: cell.streams, duration: formatWatchTime(cell.duration) })}
              />
            ))}
          </div>
        </div>
      </div>
      <div className="wrap-heatmap-legend">
        <span>{t("WRAP_UP.LESS")}</span>
        {[0, 1, 2, 3, 4].map((level) => (
          <i className={`heatmap-cell heat-${level}`} key={level} />
        ))}
        <span>{t("WRAP_UP.MORE")}</span>
      </div>
    </div>
  );
}

function UserAchievements({ user, rank }) {
  const { t } = useTranslation();
  const achievements = buildUserAchievements(user, rank, t);

  return (
    <section className="wrap-achievements" aria-label={t("WRAP_UP.USER_ACHIEVEMENTS", { user: user.UserName })}>
      <div className="wrap-achievements-header">
        <div>
          <span>{t("WRAP_UP.ACHIEVEMENTS_TITLE")}</span>
          <strong>{t("WRAP_UP.PERSONAL_BADGES")}</strong>
        </div>
        <em>{t("WRAP_UP.UNLOCKED", { unlocked: achievements.filter((achievement) => achievement.unlocked).length, total: achievements.length })}</em>
      </div>
      <div className="wrap-achievement-grid">
        {achievements.map((achievement) => {
          const Icon = achievement.icon;
          return (
            <article className={`wrap-achievement-card ${achievement.unlocked ? "is-unlocked" : ""}`} key={achievement.id}>
              <span className="wrap-achievement-icon">
                <Icon size={22} />
              </span>
              <div>
                <strong>{achievement.title}</strong>
                <small>{achievement.detail}</small>
              </div>
              <em>{achievement.value}</em>
              <span className="wrap-achievement-progress" aria-hidden="true">
                <i style={{ width: `${achievement.progress}%` }} />
              </span>
            </article>
          );
        })}
      </div>
    </section>
  );
}

export function QuickConnectUserWrap({ user, rank }) {
  const { t } = useTranslation();
  const heroImageId = user.TopMovie?.ItemId || user.TopSeries?.ItemId || user.TopTitle?.ItemId;
  const posterImageId = user.TopMovie?.ItemId || user.TopTitle?.ItemId || user.TopSeries?.ItemId;
  const seriesImageId = user.TopSeries?.ItemId || user.TopTitle?.ItemId || user.TopMovie?.ItemId;

  return (
    <article className="user-wrap-card">
      <div
        className="user-wrap-hero"
        style={{
          backgroundImage: heroImageId
            ? `linear-gradient(90deg, rgba(14, 20, 32, 0.98), rgba(14, 20, 32, 0.72)), url(/proxy/Items/Images/Backdrop?id=${heroImageId}&fillWidth=1800&quality=50)`
            : undefined,
        }}
      >
        <div className="user-wrap-avatar">{avatar(user, 106)}</div>
        <div>
          <p>{greeting(t)}</p>
          <h2>{user.UserName}</h2>
          <span>{user.IsAdministrator ? t("WRAP_UP.SERVER_ADMIN") : t("WRAP_UP.SIGN_IN_USER", { label: quickConnectLabel(t) })}</span>
        </div>
      </div>

      <div className="user-wrap-body">
        <div className="user-wrap-title-row">
          <h3>{t("WRAP_UP.PERSONAL_WRAP_UP")}</h3>
          {rank ? <span>{t("WRAP_UP.RANK", { rank })}</span> : null}
        </div>

        <div className="wrap-metric-grid">
          {rank ? (
            <WrapMetric icon={TrophyLineIcon} label={t("WRAP_UP.METRICS.SERVER_RANK")} value={`#${rank}`} detail={t("WRAP_UP.STREAMS", { streams: user.TotalStreams || 0 })} imageId={heroImageId} />
          ) : (
            <WrapMetric icon={TimeLineIcon} label={t("WRAP_UP.METRICS.WATCH_TIME")} value={formatWatchTime(user.TotalWatchTime)} detail={t("WRAP_UP.TITLES", { titles: user.UniqueTitles || 0 })} imageId={heroImageId} />
          )}
          <WrapMetric icon={PlayCircleLineIcon} label={t("WRAP_UP.METRICS.TOTAL_STREAMS")} value={user.TotalStreams || 0} detail={formatWatchTime(user.TotalWatchTime)} imageId={seriesImageId} />
          <WrapMetric icon={FilmLineIcon} label={t("WRAP_UP.METRICS.TOP_TITLE")} value={user.TopTitle?.Name} detail={t("WRAP_UP.PLAYS", { plays: user.TopTitle?.Count || 0 })} imageId={user.TopTitle?.ItemId || heroImageId} />
          <WrapMetric icon={StackLineIcon} label={t("WRAP_UP.METRICS.TOP_LIBRARY")} value={user.TopLibrary?.Name} detail={t("WRAP_UP.PLAYS", { plays: user.TopLibrary?.Count || 0 })} imageId={heroImageId} />
          <WrapMetric icon={CalendarLineIcon} label={t("WRAP_UP.METRICS.TOP_DAY")} value={user.TopDay?.Name} detail={t("WRAP_UP.STREAMS", { streams: user.TopDay?.Count || 0 })} imageId={heroImageId} />
          <WrapMetric icon={TimeLineIcon} label={t("WRAP_UP.METRICS.TIME_OF_DAY")} value={formatHour(user.TopHour?.Hour, t)} detail={t("WRAP_UP.STREAMS", { streams: user.TopHour?.Count || 0 })} imageId={seriesImageId} />
          <WrapMetric icon={FilmLineIcon} label={t("WRAP_UP.METRICS.TOP_MOVIE")} value={user.TopMovie?.Name} detail={t("WRAP_UP.PLAYS", { plays: user.TopMovie?.Count || 0 })} imageId={posterImageId} imageType="Primary" />
          <WrapMetric icon={UserSettingsLineIcon} label={t("WRAP_UP.METRICS.WATCH_STYLE")} value={user.TopClient?.Name} detail={t("WRAP_UP.CLIENTS", { clients: user.UniqueClients || 0 })} imageId={seriesImageId} />
        </div>

        <UserAchievements user={user} rank={rank} />

        <Heatmap user={user} />
      </div>
    </article>
  );
}

export function AccountDashboard({ access }) {
  const { t } = useTranslation();
  const localUsers = access?.localUsers || [];
  return (
    <section className="account-dashboard">
      <div>
        <p>{t("WRAP_UP.ACCOUNT_CENTER")}</p>
        <h2>{t("WRAP_UP.OIDC_AND_LOCAL_USERS")}</h2>
        <span>{t("WRAP_UP.ACCOUNT_CENTER_HINT", { server: mediaServerName(), label: quickConnectLabel(t) })}</span>
      </div>

      <div className="account-dashboard-grid">
        <div>
          <strong>
            {access?.authMode === "oidc" ? t("WRAP_UP.OIDC_AUTHENTIK") : access?.authMode === "local" ? t("WRAP_UP.LOCAL_LOGIN") : quickConnectLabel(t)}
          </strong>
          <span>{t("WRAP_UP.ACTIVE_SIGN_IN_MODE")}</span>
        </div>
        <div>
          <strong>{localUsers.length}</strong>
          <span>{t("WRAP_UP.LOCAL_USERS")}</span>
        </div>
        <div>
          <strong>{access?.roles?.length || 0}</strong>
          <span>{t("WRAP_UP.ROLES")}</span>
        </div>
      </div>

      {localUsers.length ? (
        <div className="account-user-strip">
          {localUsers.slice(0, 6).map((user) => (
            <span key={user.id}>
              <AccountCircleFillIcon size={22} />
              {user.username}
              <small>{user.role || t("WRAP_UP.VIEWER")}</small>
            </span>
          ))}
        </div>
      ) : null}
    </section>
  );
}

export default function UserWrapUpDashboard() {
  const { t } = useTranslation();
  const [users, setUsers] = useState([]);
  const [access, setAccess] = useState(null);
  const [authMode, setAuthMode] = useState("quick-connect");

  useEffect(() => {
    async function fetchData() {
      try {
        const [config, userResponse, accessResponse] = await Promise.all([
          Config.getConfig(),
          axios.get("/stats/getUserWrapUp", { headers: { Authorization: `Bearer ${token}` } }),
          axios.get("/api/userAccess", { headers: { Authorization: `Bearer ${token}` } }),
        ]);

        setAuthMode(config.settings?.auth?.mode || accessResponse.data.authMode || "quick-connect");
        setUsers(userResponse.data.filter((user) => Number(user.TotalStreams || 0) > 0));
        setAccess(accessResponse.data);
      } catch (error) {
        console.log(error);
      }
    }

    fetchData();
    const intervalId = setInterval(fetchData, 60000 * 5);
    return () => clearInterval(intervalId);
  }, []);

  const rankedUsers = useMemo(() => users.sort((a, b) => Number(b.TotalWatchTime || 0) - Number(a.TotalWatchTime || 0)), [users]);

  if (!rankedUsers.length && !access) {
    return null;
  }

  return (
    <section className="home-user-wrap">
      <div className="home-user-wrap-header">
        <div>
          <p>{t("WRAP_UP.PERSONAL_DASHBOARDS")}</p>
          <h1>{t("WRAP_UP.USER_WRAP_UPS")}</h1>
          <span>{t("WRAP_UP.USER_WRAP_UPS_HINT", { label: quickConnectLabel(t) })}</span>
        </div>
        <strong>{authMode === "quick-connect" ? quickConnectLabel(t) : authMode === "oidc" ? t("WRAP_UP.OIDC_AUTHENTIK") : t("WRAP_UP.LOCAL_LOGIN")}</strong>
      </div>

      <div className="home-user-wrap-list">
        {rankedUsers.slice(0, 6).map((user, index) => (
          <Link className="user-wrap-card-link" to={`/users/${slugifyUserName(user.UserName)}`} key={user.UserId}>
            <QuickConnectUserWrap user={user} rank={index + 1} />
          </Link>
        ))}
      </div>

      <AccountDashboard access={access} />
    </section>
  );
}

import { Component, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Blurhash } from "react-blurhash";
import axios from "../../../lib/axios_instance";
import { lookAssets } from "../../../lib/blobbo-looks";

import CalendarEventLineIcon from "remixicon-react/CalendarEventLineIcon";
import HardDrive2LineIcon from "remixicon-react/HardDrive2LineIcon";
import TimeLineIcon from "remixicon-react/TimeLineIcon";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function authHeaders() {
  const token = localStorage.getItem("token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// Loads one Home widget endpoint and refreshes it every few minutes.
export function useHomeWidgetData(url, { enabled = true, refreshMs = 5 * 60 * 1000 } = {}) {
  const [state, setState] = useState({ data: null, error: "" });
  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    const load = () =>
      axios
        .get(url, { headers: authHeaders() })
        .then((response) => !cancelled && setState({ data: response.data, error: "" }))
        .catch((error) => !cancelled && setState((current) => ({ ...current, error: error.response?.data?.error || "Unavailable right now." })));
    load();
    const interval = setInterval(load, refreshMs);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [url, enabled, refreshMs]);
  return state;
}

export function hourLabel(hour) {
  return `${String(hour).padStart(2, "0")}:00`;
}

export function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (value >= 1024 ** 4) return `${(value / 1024 ** 4).toFixed(1)} TB`;
  if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(0)} GB`;
  if (value >= 1024 ** 2) return `${(value / 1024 ** 2).toFixed(0)} MB`;
  return `${value} B`;
}

export function timeAgo(value, now = Date.now()) {
  const ms = now - new Date(value).getTime();
  if (!Number.isFinite(ms)) return "";
  const minutes = Math.round(ms / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}

// A bad hash makes Blurhash throw; fall back to a plain tile instead.
class HashBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? <span className="home-thumb-fallback" /> : this.props.children;
  }
}

function SafeBlurhash({ hash }) {
  if (!hash || String(hash).length < 6) return <span className="home-thumb-fallback" />;
  return (
    <HashBoundary>
      <Blurhash hash={hash} width="100%" height="100%" />
    </HashBoundary>
  );
}

function WidgetTitle({ icon: Icon, title, badge }) {
  return (
    <div className="home-section-title">
      <Icon size={20} />
      <h2>{title}</h2>
      {badge ? <span className="home-demo-badge">{badge}</span> : null}
    </div>
  );
}

export function PeakHoursWidget({ data, error }) {
  const grid = data?.grid || [];
  const max = data?.max || 1;
  const busiest = data?.busiest;
  const quietest = data?.quietest;
  return (
    <>
      <WidgetTitle icon={TimeLineIcon} title="Peak hours" />
      {error && !data ? <p className="home-widget-note">{error}</p> : null}
      <div className="home-heatmap" role="table" aria-label="Plays by weekday and hour">
        <div className="home-heatmap-row is-hours" role="row">
          <span />
          {Array.from({ length: 24 }, (_, hour) => (
            <span key={hour} className="home-heatmap-hour">{hour % 6 === 0 ? String(hour).padStart(2, "0") : ""}</span>
          ))}
        </div>
        {DAYS.map((day, dayIndex) => (
          <div key={day} className="home-heatmap-row" role="row">
            <span className="home-heatmap-day">{day}</span>
            {Array.from({ length: 24 }, (_, hour) => {
              const plays = grid[dayIndex]?.[hour] || 0;
              const isBusiest = busiest && busiest.day === dayIndex && busiest.hour === hour;
              return (
                <span
                  key={hour}
                  role="cell"
                  className={`home-heatmap-cell${isBusiest ? " is-busiest" : ""}${data ? "" : " is-loading"}`}
                  style={{ "--heat": plays ? 0.15 + (plays / max) * 0.85 : 0 }}
                  title={`${day} ${hourLabel(hour)} · ${plays} plays`}
                />
              );
            })}
          </div>
        ))}
      </div>
      {data ? (
        <div className="home-heatmap-summary">
          {busiest ? (
            <span>
              Busiest <strong>{DAYS[busiest.day]} {hourLabel(busiest.hour)}</strong> · {busiest.plays} plays
            </span>
          ) : (
            <span>No plays in this window yet.</span>
          )}
          {quietest ? (
            <span>
              Quietest 3 hours <strong>{DAYS[quietest.day]} {hourLabel(quietest.hour)}–{hourLabel((quietest.hour + 3) % 24)}</strong> · good for maintenance
            </span>
          ) : null}
          <small>
            Last {data.days} days · {data.total} plays · {data.timeZone}
          </small>
        </div>
      ) : null}
    </>
  );
}

function formatAiring(value) {
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function UpNextWidget({ data, error }) {
  const items = data?.items || [];
  const fromHistory = data?.source === "next-episodes";
  return (
    <>
      <WidgetTitle icon={CalendarEventLineIcon} title="Up next tonight" badge={fromHistory ? "From watch history" : null} />
      {error && !data ? <p className="home-widget-note">{error}</p> : null}
      {fromHistory ? (
        <p className="home-widget-note">
          {data.calendarSyncedAt
            ? `Nothing airs in the next 24 hours in the cached calendar (last synced ${new Date(data.calendarSyncedAt).toLocaleDateString()}).`
            : "No calendar connected."}{" "}
          Showing the next episode of shows watched recently.
        </p>
      ) : null}
      <div className="home-up-next-list">
        {items.length ? (
          items.map((item) => (
            <article key={item.id}>
              <span className="home-up-next-thumb">
                <SafeBlurhash hash={item.imageHash} />
              </span>
              <div>
                <strong title={item.title}>{item.title}</strong>
                <small>
                  {item.subtitle}
                  {item.episodeTitle ? ` · ${item.episodeTitle}` : ""}
                </small>
              </div>
              <em>{fromHistory ? (item.lastWatchedBy ? `${item.lastWatchedBy} · ${timeAgo(item.lastWatchedAt)}` : "") : formatAiring(item.at)}</em>
            </article>
          ))
        ) : data ? (
          <span className="home-widget-note">Nothing lined up.</span>
        ) : (
          Array.from({ length: 3 }, (_, index) => <article key={index} className="is-loading" />)
        )}
      </div>
    </>
  );
}

export function DiskRunwayWidget({ data, error }) {
  const forecast = data?.forecast?.forecast;
  const total = data?.forecast?.totalBytes || 0;
  const free = data?.forecast?.freeBytes || 0;
  const usedShare = total ? Math.round(((total - free) / total) * 100) : 0;
  let headline = "Working it out…";
  if (forecast?.status === "filling") headline = forecast.beyondYear ? "Over a year of space left" : `About ${forecast.daysUntilFull} days until full`;
  else if (forecast?.status === "stable") headline = "Growth is flat, no end in sight";
  else if (forecast?.status === "full") headline = "Disk is full";
  else if (forecast?.status === "no_disk") headline = "No disk report yet";
  else if (forecast?.status === "need_more_data") headline = "Needs more history";
  const perDay = forecast?.bytesPerDay ? `${formatBytes(forecast.bytesPerDay)} a day` : "";
  const libraries = data?.libraries || [];
  return (
    <>
      <WidgetTitle icon={HardDrive2LineIcon} title="Disk runway" badge={data?.demoDisk ? "Demo disk figures" : null} />
      {error && !data ? <p className="home-widget-note">{error}</p> : null}
      <div className="home-runway-headline">
        <strong>{headline}</strong>
        {forecast?.status === "filling" && forecast.rangeDays?.[0] ? (
          <small>
            Range {forecast.rangeDays[0]}–{forecast.rangeDays[1] ?? "∞"} days · {perDay} · {forecast.confidence} confidence
          </small>
        ) : perDay ? (
          <small>{perDay}</small>
        ) : null}
      </div>
      {total ? (
        <div className="home-runway-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={usedShare}>
          <span style={{ width: `${usedShare}%` }} />
          <em>
            {formatBytes(free)} free of {formatBytes(total)}
          </em>
        </div>
      ) : null}
      <div className="home-runway-libraries">
        {libraries.map((library) => (
          <div key={library.id}>
            <span title={library.name}>{library.name}</span>
            <i style={{ width: `${Math.max(2, Math.round((library.share || 0) * 100))}%` }} />
            <small>{formatBytes(library.bytes)}</small>
          </div>
        ))}
      </div>
    </>
  );
}

export function AllQuietSlot({ lastPlayback, peak }) {
  const busiest = peak?.busiest;
  return (
    <div className="home-all-quiet">
      <img src={lookAssets("cozy").still} alt="" width={72} height={72} />
      <div>
        <strong>All quiet</strong>
        <span>
          {lastPlayback?.endedAt
            ? `Last stream ${timeAgo(lastPlayback.endedAt)}: ${lastPlayback.userName || "someone"} watched ${lastPlayback.seriesName ? `${lastPlayback.seriesName} · ` : ""}${lastPlayback.title || "something"}${lastPlayback.deviceName ? ` on ${lastPlayback.deviceName}` : ""}.`
            : "Nobody is watching right now."}
        </span>
        {busiest ? <small>Usually busiest {DAYS[busiest.day]} around {hourLabel(busiest.hour)}.</small> : null}
      </div>
      <Link to="/activity">Activity</Link>
    </div>
  );
}

function ticksPercent(session) {
  const runtime = Number(session.NowPlayingItem?.RunTimeTicks || 0);
  const position = Number(session.PlayState?.PositionTicks || 0);
  return runtime > 0 ? Math.min(100, Math.max(0, (position / runtime) * 100)) : 0;
}

export function NowPlayingStrip({ sessions, onOpen }) {
  if (!sessions?.length) return null;
  const isDemo = sessions.some((session) => session.IsDemo);
  return (
    <div className="home-now-playing-strip" role="list" aria-label="Now playing">
      {isDemo ? <span className="home-demo-badge">Demo sessions</span> : null}
      {sessions.map((session) => {
        const item = session.NowPlayingItem || {};
        const transcoding = String(session.PlayState?.PlayMethod || "").toLowerCase() === "transcode";
        return (
          <button key={session.Id} type="button" role="listitem" className={`home-now-chip${session.PlayState?.IsPaused ? " is-paused" : ""}`} onClick={onOpen}>
            <span className="home-now-avatar">{String(session.UserName || "?").slice(0, 1).toUpperCase()}</span>
            <span className="home-now-text">
              <strong>{item.SeriesName || item.Name || "Unknown"}</strong>
              <small>
                {session.UserName}
                {session.PlayState?.IsPaused ? " · paused" : ""}
                {transcoding ? " · transcoding" : ""}
              </small>
            </span>
            <i style={{ width: `${ticksPercent(session)}%` }} />
          </button>
        );
      })}
    </div>
  );
}

import { Component, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Blurhash } from "react-blurhash";
import axios from "../../../lib/axios_instance";
import baseUrl from "../../../lib/baseurl";
import { balancedColumns } from "../../../lib/balanced-columns";
import { lookAssets } from "../../../lib/blobbo-looks";
import { formatDate } from "../../../lib/format-date";

import CalendarEventLineIcon from "remixicon-react/CalendarEventLineIcon";
import DownloadCloud2LineIcon from "remixicon-react/DownloadCloud2LineIcon";
import FilmLineIcon from "remixicon-react/FilmLineIcon";
import QuestionAnswerLineIcon from "remixicon-react/QuestionAnswerLineIcon";
import PlayCircleLineIcon from "remixicon-react/PlayCircleLineIcon";
import DeviceLineIcon from "remixicon-react/DeviceLineIcon";
import { posterChain } from "../../requests/poster";
import { requestStatusChip } from "../../requests/status";
import { downloadStateLabel } from "../../../lib/download-state";
import HardDrive2LineIcon from "remixicon-react/HardDrive2LineIcon";
import TimeLineIcon from "remixicon-react/TimeLineIcon";
import HeartPulseLineIcon from "remixicon-react/HeartPulseLineIcon";
import HeadphoneLineIcon from "remixicon-react/HeadphoneLineIcon";
import StackLineIcon from "remixicon-react/StackLineIcon";
import DeleteBin6LineIcon from "remixicon-react/DeleteBin6LineIcon";
import RefreshLineIcon from "remixicon-react/RefreshLineIcon";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function authHeaders() {
  const token = localStorage.getItem("token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// Loads one Home widget endpoint and refreshes it every few minutes. Pass a
// body to POST it instead (several stats endpoints take their options that way).
export function useHomeWidgetData(url, { enabled = true, refreshMs = 5 * 60 * 1000, body } = {}) {
  const [state, setState] = useState({ data: null, error: "" });
  const [reloadKey, setReloadKey] = useState(0);
  const bodyKey = body === undefined ? "" : JSON.stringify(body);
  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    // A manual refresh asks the endpoint to skip its cache once.
    const forced = reloadKey > 0;
    const requestUrl = forced && !bodyKey ? `${url}${url.includes("?") ? "&" : "?"}refresh=1` : url;
    let first = true;
    const request = () => {
      const target = first ? requestUrl : url;
      first = false;
      return bodyKey ? axios.post(url, JSON.parse(bodyKey), { headers: authHeaders() }) : axios.get(target, { headers: authHeaders() });
    };
    const load = () =>
      request()
        .then((response) => !cancelled && setState({ data: response.data, error: "" }))
        .catch((error) => !cancelled && setState((current) => ({ ...current, error: error.response?.data?.error || "Unavailable right now." })));
    load();
    const interval = setInterval(load, refreshMs);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [url, enabled, refreshMs, bodyKey, reloadKey]);
  const reload = useCallback(() => setReloadKey((value) => value + 1), []);
  return { ...state, reload };
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

// Up next thumbnail: the episode still, then the series backdrop, then the
// series poster, all through the image proxy. The blurhash only shows while
// the real image loads (or when there is no image at all).
function UpNextThumb({ item }) {
  const sources = [
    // Calendar items carry their own artwork; only site-relative proxy paths need the base URL.
    item.imageUrl ? (item.imageUrl.startsWith("/") ? `${baseUrl}${item.imageUrl}` : item.imageUrl) : null,
    item.id && item.seriesId ? `${baseUrl}/proxy/Items/Images/Primary?id=${item.id}&fillWidth=256&quality=70` : null,
    item.seriesId ? `${baseUrl}/proxy/Items/Images/Backdrop?id=${item.seriesId}&fillWidth=256&quality=70` : null,
    item.seriesId ? `${baseUrl}/proxy/Items/Images/Primary?id=${item.seriesId}&fillWidth=256&quality=70` : null,
  ].filter(Boolean);
  const [index, setIndex] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const src = sources[index];
  return (
    <span className="home-up-next-thumb">
      {!loaded ? <SafeBlurhash hash={item.imageHash} /> : null}
      {src ? (
        <img
          key={src}
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          className={loaded ? "is-loaded" : ""}
          onLoad={() => setLoaded(true)}
          onError={() => {
            setLoaded(false);
            setIndex((value) => value + 1);
          }}
        />
      ) : null}
    </span>
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
      {data && !data.total ? (
        <p className="home-widget-note home-heatmap-empty">
          No plays in the last {data.days || 30} days yet. This fills in as people watch.
        </p>
      ) : (
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
      )}
      {data && data.total ? (
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

// "21:00", or "Tomorrow 09:00" when the airing is past midnight.
function formatAiring(value, now = new Date(), allDay = false) {
  const date = new Date(value);
  // Movie and album release dates have no time of day; "00:00" would be misleading.
  if (allDay) {
    const dayKey = date.toISOString().slice(0, 10);
    const today = new Date(now);
    const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    return dayKey === todayKey ? "Today" : "Tomorrow";
  }
  const time = formatDate(date, { hour: "2-digit", minute: "2-digit" });
  return date.toDateString() === new Date(now).toDateString() ? time : `Tomorrow ${time}`;
}

// Up next columns: as many equal columns as fit, balanced so the last row
// never holds a single tile; if every grid would, one scrolling row instead.
const UP_NEXT_MIN_TILE = 260;
const UP_NEXT_GAP = 12;

function useBalancedGrid(ref) {
  useLayoutEffect(() => {
    const list = ref.current;
    if (!list || typeof ResizeObserver === "undefined") return undefined;
    const update = () => {
      const count = [...list.children].filter((child) => getComputedStyle(child).display !== "none").length;
      const { columns, scroll } = balancedColumns(count, list.clientWidth, UP_NEXT_MIN_TILE, UP_NEXT_GAP);
      list.style.setProperty("--up-next-cols", String(columns));
      list.classList.toggle("is-scroll", scroll);
    };
    const resize = new ResizeObserver(update);
    const mutation = new MutationObserver(update);
    resize.observe(list);
    mutation.observe(list, { childList: true });
    update();
    return () => {
      resize.disconnect();
      mutation.disconnect();
    };
  }, [ref]);
}

// One short status line under the title. Stale calendars get a warning with a
// link to Server Jobs, where the Arr Calendar Sync task lives.
function UpNextStatus({ data }) {
  if (data?.source !== "next-episodes") return null;
  const synced = data.calendarSyncedAt ? formatDate(data.calendarSyncedAt, { day: "numeric", month: "short", year: "numeric" }) : "";
  if (!data.calendarSyncedAt) return <p className="home-widget-note">No calendar connected, so this shows the next episode of shows watched recently.</p>;
  if (data.calendarSyncPaused) return <p className="home-widget-note">Calendar cached from {synced}; sync is paused in this demo.</p>;
  if (data.calendarStale) {
    return (
      <p className="home-widget-note is-warning">
        Calendar last synced {synced}. <Link to="/server-management?tab=jobs">Check the Arr Calendar Sync task</Link>
      </p>
    );
  }
  return <p className="home-widget-note">Nothing airs in the next 24 hours.</p>;
}

export function UpNextWidget({ data, error }) {
  const items = data?.items || [];
  const fromHistory = data?.source === "next-episodes";
  const listRef = useRef(null);
  useBalancedGrid(listRef);
  // With nothing airing, this is really a "continue watching" row, so say so.
  const title = fromHistory ? "Continue watching" : "Up next tonight";
  const badge = fromHistory ? "From watch history" : items.length ? `${items.length} airing` : null;
  return (
    <>
      <WidgetTitle icon={CalendarEventLineIcon} title={title} badge={badge} />
      {error && !data ? <p className="home-widget-note">{error}</p> : null}
      <UpNextStatus data={data} />
      <div className="home-up-next-list" ref={listRef}>
        {items.length ? (
          items.map((item) => {
            const when = fromHistory
              ? item.lastWatchedBy
                ? `${item.lastWatchedBy} watched ${timeAgo(item.lastWatchedAt)}`
                : ""
              : [formatAiring(item.at, new Date(), item.allDay), item.hasFile ? "Ready" : ""].filter(Boolean).join(" · ");
            const body = (
              <>
                <span className="home-up-next-media">
                  <UpNextThumb item={item} />
                  {item.subtitle ? <span className="home-up-next-code">{item.subtitle}</span> : null}
                </span>
                <div>
                  <strong title={item.title}>{item.title}</strong>
                  <small title={item.episodeTitle || item.subtitle}>{item.episodeTitle || item.subtitle}</small>
                  <em title={when}>{when}</em>
                </div>
              </>
            );
            return (
              <article key={item.id}>
                {item.seriesId ? (
                  <Link to={`/libraries/item/${item.seriesId}`} className="home-up-next-link" aria-label={`${item.title} ${item.subtitle}`}>
                    {body}
                  </Link>
                ) : (
                  <div className="home-up-next-link">{body}</div>
                )}
              </article>
            );
          })
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
      <Link to="/activity" className="home-all-quiet-link">
        Activity
      </Link>
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

// A widget's "see all" link, shown at the right of its title row.
function WidgetMore({ to, label = "See all" }) {
  return (
    <Link to={to} className="home-widget-more">
      {label}
    </Link>
  );
}

// Image that walks a list of URLs and falls back to an icon when they all fail.
function FallbackImage({ sources, alt = "", fallback = null, className = "" }) {
  const [index, setIndex] = useState(0);
  const src = sources[index];
  if (!src) return fallback;
  return <img className={className} src={src} alt={alt} loading="lazy" decoding="async" onError={() => setIndex((current) => current + 1)} />;
}

// Active downloads across every connected client (same data as the Downloads page).
export function DownloadQueueWidget({ data, error }) {
  const items = Array.isArray(data?.items) ? data.items : [];
  const active = items
    .filter((item) => Number(item.progress) < 100)
    .sort((a, b) => Number(b.progress || 0) - Number(a.progress || 0));
  const stalled = active.filter((item) => /fail|error|stall/i.test(String(item.state || "")) || item.stalledReason).length;
  return (
    <>
      <div className="home-widget-head">
        <WidgetTitle icon={DownloadCloud2LineIcon} title="Download queue" />
        <WidgetMore to="/downloads" />
      </div>
      {error && !data ? <p className="home-widget-note">{error}</p> : null}
      {data ? (
        <p className="home-widget-note">
          {active.length ? `${active.length} downloading` : "Nothing downloading right now."}
          {stalled ? <span className="home-widget-alert"> · {stalled} stalled</span> : null}
        </p>
      ) : null}
      <ul className="home-download-list">
        {(data ? active.slice(0, 5) : [0, 1, 2]).map((item, index) =>
          data ? (
            <li key={item.id || `${item.client}-${item.name}`}>
              <div className="home-download-row">
                <strong title={item.name}>{item.name}</strong>
                <span>{Math.round(Number(item.progress) || 0)}%</span>
              </div>
              <div className="home-download-track">
                <span style={{ width: `${Math.min(100, Math.max(0, Number(item.progress) || 0))}%` }} />
              </div>
              <small>
                {[item.client, item.down ? `${item.down} down` : null, item.stalledReason || downloadStateLabel(item.state)].filter(Boolean).join(" · ")}
              </small>
            </li>
          ) : (
            <li key={index} className="is-loading" />
          )
        )}
      </ul>
    </>
  );
}

// Latest Jellyseerr / Overseerr requests with status counts.
export function RequestsWidget({ data, error }) {
  const requests = Array.isArray(data?.requests) ? data.requests : [];
  const counts = requests.reduce((total, request) => {
    const key = requestStatusChip(request).key;
    total[key] = (total[key] || 0) + 1;
    return total;
  }, {});
  const latest = [...requests].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)).slice(0, 5);
  return (
    <>
      <div className="home-widget-head">
        <WidgetTitle icon={QuestionAnswerLineIcon} title="Requests" />
        <WidgetMore to="/requests" />
      </div>
      {error && !data ? <p className="home-widget-note">{error}</p> : null}
      {data && requests.length ? (
        <div className="home-request-counts">
          {[
            ["pending", "Pending"],
            ["processing", "Processing"],
            ["available", "Available"],
          ].map(([key, label]) => (
            <span key={key} className={`is-${key}`}>
              <strong>{(counts[key] || 0) + (key === "processing" ? counts.approved || 0 : 0)}</strong>
              {label}
            </span>
          ))}
        </div>
      ) : null}
      {data && !requests.length ? (
        <p className="home-widget-note">
          {Array.isArray(data.sources) && !data.sources.length ? (
            <>
              Connect Jellyseerr or Overseerr in <Link to="/integrations">Integrations</Link> to see requests here.
            </>
          ) : (
            "No requests yet."
          )}
        </p>
      ) : null}
      <ul className="home-request-list">
        {latest.map((request) => {
          const chip = requestStatusChip(request);
          return (
            <li key={request.requestId || `${request.source}-${request.title}`}>
              <FallbackImage
                className="home-request-poster"
                sources={posterChain(request, baseUrl)}
                fallback={<span className="home-request-poster is-empty" />}
              />
              <div>
                <strong title={request.title}>{request.title}</strong>
                <small>
                  {[request.requestedBy, request.createdAt ? timeAgo(request.createdAt) : null].filter(Boolean).join(" · ")}
                </small>
              </div>
              <em className={`home-request-chip is-${chip.key}`}>{chip.label}</em>
            </li>
          );
        })}
      </ul>
    </>
  );
}

// Newest items across every library, as a poster strip.
export function RecentlyAddedWidget({ data, error }) {
  const items = (Array.isArray(data) ? data : [])
    .flatMap((shelf) => (Array.isArray(shelf.items) ? shelf.items : []))
    .filter((item) => item && item.Id)
    .sort((a, b) => new Date(b.DateCreated || 0) - new Date(a.DateCreated || 0))
    .slice(0, 12);
  return (
    <>
      <div className="home-widget-head">
        <WidgetTitle icon={FilmLineIcon} title="Recently added" />
        <WidgetMore to="/recently-added" />
      </div>
      {error && !data ? <p className="home-widget-note">{error}</p> : null}
      {data && !items.length ? <p className="home-widget-note">Nothing new in the libraries yet.</p> : null}
      <div className="home-recent-strip">
        {(data ? items : Array.from({ length: 6 }, (_, index) => ({ placeholder: index }))).map((item) =>
          item.placeholder !== undefined ? (
            <span key={item.placeholder} className="home-recent-card is-loading" />
          ) : (
            <Link key={item.Id} to={`/libraries/item/${item.SeriesId || item.Id}`} className="home-recent-card" title={item.SeriesName || item.Name}>
              <FallbackImage
                sources={[item.SeriesId, item.Id]
                  .filter(Boolean)
                  .map((id) => `${baseUrl}/proxy/Items/Images/Primary?id=${encodeURIComponent(id)}&fillWidth=220&quality=70`)}
                fallback={<span className="home-recent-fallback" />}
              />
              <span className="home-recent-name">{item.SeriesName || item.Name}</span>
              {item.DateCreated ? <small>{timeAgo(item.DateCreated)}</small> : null}
            </Link>
          )
        )}
      </div>
    </>
  );
}

// Splits play methods into direct play, audio-only transcodes ("v:direct") and
// full video transcodes, and lists the most common transcode reasons.
export function PlaybackQualityWidget({ data, error }) {
  const rows = Array.isArray(data) ? data : [];
  const total = rows.reduce((sum, row) => sum + Number(row.Count || 0), 0);
  const groups = { direct: 0, stream: 0, audio: 0, video: 0 };
  const reasons = [];
  rows.forEach((row) => {
    const name = String(row.Name || "");
    const count = Number(row.Count || 0);
    if (name === "DirectPlay") groups.direct += count;
    else if (name === "DirectStream") groups.stream += count;
    else if (/v:direct/i.test(name)) groups.audio += count;
    else groups.video += count;
    const codecs = name.match(/\(([^)]+)\)/)?.[1];
    if (codecs) reasons.push({ codecs, count });
  });
  const share = (value) => (total ? Math.round((value / total) * 100) : 0);
  const parts = [
    { key: "direct", label: "Direct play", value: groups.direct + groups.stream },
    { key: "audio", label: "Audio transcode", value: groups.audio },
    { key: "video", label: "Video transcode", value: groups.video },
  ];
  return (
    <>
      <WidgetTitle icon={PlayCircleLineIcon} title="Playback quality" />
      {error && !data ? <p className="home-widget-note">{error}</p> : null}
      {data && !total ? <p className="home-widget-note">No plays in the last 30 days yet.</p> : null}
      {total ? (
        <>
          <p className="home-quality-headline">
            <strong>{share(groups.direct + groups.stream)}%</strong> played without a video transcode
          </p>
          <div className="home-quality-bar" role="img" aria-label={parts.map((part) => `${part.label} ${share(part.value)}%`).join(", ")}>
            {parts.map((part) => (part.value ? <span key={part.key} className={`is-${part.key}`} style={{ flexGrow: part.value }} /> : null))}
          </div>
          <ul className="home-quality-legend">
            {parts.map((part) => (
              <li key={part.key}>
                <i className={`is-${part.key}`} aria-hidden="true" />
                {part.label}
                <strong>{share(part.value)}%</strong>
              </li>
            ))}
          </ul>
          {reasons.length ? (
            <small className="home-quality-reasons">
              Top transcodes: {reasons.slice(0, 3).map((reason) => `${reason.codecs} (${reason.count})`).join(", ")} · last 30 days
            </small>
          ) : null}
        </>
      ) : null}
    </>
  );
}

// The apps people watch with over the last 30 days.
export function TopClientsWidget({ data, error }) {
  const rows = (Array.isArray(data) ? data : []).filter((row) => row.Client);
  const max = Math.max(1, ...rows.map((row) => Number(row.Plays || 0)));
  return (
    <>
      <WidgetTitle icon={DeviceLineIcon} title="Top clients" />
      {error && !data ? <p className="home-widget-note">{error}</p> : null}
      {data && !rows.length ? <p className="home-widget-note">No plays in the last 30 days yet.</p> : null}
      <ul className="home-bar-list">
        {rows.map((row) => (
          <li key={row.Client}>
            <span className="home-bar-label" title={row.Client}>
              {String(row.Client).replace(/^Jellyfin (for )?/i, "") || row.Client}
            </span>
            <span className="home-bar-track">
              <span style={{ width: `${(Number(row.Plays || 0) / max) * 100}%` }} />
            </span>
            <strong>{row.Plays}</strong>
          </li>
        ))}
      </ul>
      {rows.length ? <small className="home-widget-foot">Plays in the last 30 days</small> : null}
    </>
  );
}

// A large clock for wall and kiosk displays. Ticks every 15 seconds.
export function ClockWidget() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 15 * 1000);
    return () => clearInterval(timer);
  }, []);
  const locale = localStorage.getItem("i18nextLng") || undefined;
  let twelveHour;
  try {
    twelveHour = JSON.parse(localStorage.getItem("12hr"));
  } catch {
    twelveHour = undefined;
  }
  return (
    <div className="home-clock">
      <time dateTime={now.toISOString()}>
        {new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit", hour12: twelveHour ?? undefined }).format(now)}
      </time>
      <span>{new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long" }).format(now)}</span>
    </div>
  );
}

function formatDuration(seconds) {
  const value = Math.max(0, Math.round(Number(seconds || 0)));
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  return hours ? `${hours} h ${minutes} min` : `${minutes} min`;
}

function RefreshButton({ onClick, label = "Check again" }) {
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!busy) return undefined;
    const timer = setTimeout(() => setBusy(false), 4000);
    return () => clearTimeout(timer);
  }, [busy]);
  return (
    <button
      type="button"
      className={`home-widget-icon-button${busy ? " is-busy" : ""}`}
      title={label}
      aria-label={label}
      onClick={() => {
        setBusy(true);
        onClick?.();
      }}
    >
      <RefreshLineIcon size={16} />
    </button>
  );
}

// One light per app: Jellyfin first, then every connected integration.
// A red light shows the current error; a green one keeps the last failure as a hint.
export function AppHealthWidget({ data, error, onRefresh }) {
  const apps = data?.apps || [];
  const failing = apps.filter((app) => !app.ok);
  return (
    <>
      <div className="home-widget-head">
        <WidgetTitle icon={HeartPulseLineIcon} title="App health" />
        <div className="home-widget-head-actions">
          {data ? (
            <span className={`home-health-summary${failing.length ? " is-bad" : ""}`}>
              {failing.length ? `${failing.length} of ${apps.length} down` : `All ${apps.length} up`}
            </span>
          ) : null}
          <RefreshButton onClick={onRefresh} />
          <WidgetMore to="/integrations" label="Integrations" />
        </div>
      </div>
      {error && !data ? <p className="home-widget-note">{error}</p> : null}
      <ul className="home-health-lights">
        {(data ? apps : Array.from({ length: 5 }, (_, index) => ({ id: `loading-${index}`, loading: true }))).map((app) =>
          app.loading ? (
            <li key={app.id} className="home-health-light is-loading">
              <i aria-hidden="true" />
              <span />
            </li>
          ) : (
            <li
              key={app.id}
              className={`home-health-light ${app.ok ? "is-ok" : "is-bad"}`}
              title={[app.name, app.version, app.message, app.lastFailure ? `Last failure ${timeAgo(app.lastFailure.at)}: ${app.lastFailure.message}` : ""].filter(Boolean).join("\n")}
            >
              <i aria-hidden="true" />
              <span>{app.name}</span>
            </li>
          )
        )}
      </ul>
      {failing.length ? (
        <ul className="home-health-failures">
          {failing.map((app) => (
            <li key={app.id}>
              <strong>{app.name}</strong>
              <span>{app.message || "Not answering"}</span>
              {app.lastFailure?.at ? <small>since {timeAgo(app.lastFailure.at)}</small> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {data?.checkedAt ? <small className="home-widget-foot">Checked {timeAgo(data.checkedAt)} · rechecks every 5 minutes</small> : null}
    </>
  );
}

function AudiobookCover({ id, title }) {
  return (
    <FallbackImage
      className="home-listen-cover"
      sources={id ? [`${baseUrl}/proxy/Audiobookshelf/Images/${encodeURIComponent(id)}?width=160`] : []}
      alt={title || ""}
      fallback={<span className="home-listen-cover is-empty" />}
    />
  );
}

// Audiobookshelf: open listening sessions, then the newest books and podcasts.
export function NowListeningWidget({ data, error }) {
  const listening = data?.listeningNow || [];
  const added = (data?.recentlyAdded || []).slice(0, 6);
  const notConnected = !data && /connect audiobookshelf/i.test(error || "");
  return (
    <>
      <div className="home-widget-head">
        <WidgetTitle icon={HeadphoneLineIcon} title="Now listening" />
        <WidgetMore to="/audiobookshelf" label="Audiobookshelf" />
      </div>
      {notConnected ? (
        <p className="home-widget-note">
          Connect Audiobookshelf in <Link to="/integrations">Integrations</Link> to see listeners here.
        </p>
      ) : error && !data ? (
        <p className="home-widget-note">{error}</p>
      ) : null}
      {data ? (
        listening.length ? (
          <ul className="home-listen-now">
            {listening.map((session) => {
              const percent = session.duration ? Math.min(100, (session.currentTime / session.duration) * 100) : 0;
              return (
                <li key={session.id}>
                  <AudiobookCover id={session.itemId} title={session.title} />
                  <div>
                    <strong title={session.title}>{session.title}</strong>
                    <small>{[session.user, session.author, session.client || session.device].filter(Boolean).join(" · ")}</small>
                    <span className="home-listen-progress" aria-label={`${Math.round(percent)}% listened`}>
                      <span style={{ width: `${percent}%` }} />
                    </span>
                    {session.duration ? <small>{formatDuration(Math.max(0, session.duration - session.currentTime))} left</small> : null}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="home-widget-note">{data.admin === false ? "Use an admin API token to see who is listening." : "Nobody is listening right now."}</p>
        )
      ) : null}
      {added.length ? (
        <>
          <h3 className="home-widget-subhead">Newly added</h3>
          <div className="home-listen-added">
            {added.map((item) => (
              <div key={item.id} className="home-listen-added-item" title={[item.title, item.author].filter(Boolean).join(" · ")}>
                <AudiobookCover id={item.hasCover ? item.id : null} title={item.title} />
                <span>{item.title}</span>
                {item.addedAt ? <small>{timeAgo(item.addedAt)}</small> : null}
              </div>
            ))}
          </div>
        </>
      ) : null}
    </>
  );
}

const SCHEDULE_LABELS = { daily: "Daily", weekly: "Weekly" };

// Each auto collection builder with its Jellyfin poster, size and last refresh.
export function CollectionsWidget({ data, error }) {
  const collections = data?.collections || [];
  return (
    <>
      <div className="home-widget-head">
        <WidgetTitle icon={StackLineIcon} title="Collections" />
        <WidgetMore to="/server-management?tab=collections" label="Manage" />
      </div>
      {error && !data ? <p className="home-widget-note">{error}</p> : null}
      {data && !collections.length ? (
        <p className="home-widget-note">
          No auto collections yet. Set one up in <Link to="/server-management?tab=collections">Collections</Link>.
        </p>
      ) : null}
      {data?.serverError ? <p className="home-widget-note">{data.serverError}</p> : null}
      <ul className="home-collection-list">
        {collections.map((collection) => (
          <li key={collection.id} className={collection.lastStatus === "failed" ? "is-failed" : ""}>
            <FallbackImage
              className="home-collection-poster"
              sources={collection.collectionId && collection.hasPoster ? [`${baseUrl}/proxy/Items/Images/Primary?id=${encodeURIComponent(collection.collectionId)}&fillWidth=160&quality=70`] : []}
              alt=""
              fallback={
                <span className="home-collection-poster is-empty">
                  <StackLineIcon size={18} />
                </span>
              }
            />
            <div>
              <strong title={collection.name}>{collection.name}</strong>
              <small>
                {[
                  collection.size !== null ? `${collection.size} ${collection.size === 1 ? "title" : "titles"}` : "Not on the server yet",
                  collection.libraryName,
                  collection.applyEnabled ? SCHEDULE_LABELS[collection.schedule] || "Manual" : "Preview only",
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </small>
              <small className={collection.lastStatus === "failed" ? "is-bad" : ""} title={collection.lastMessage || ""}>
                {collection.lastRunAt
                  ? `${collection.lastStatus === "failed" ? "Last run failed" : "Refreshed"} ${timeAgo(collection.lastRunAt)}`
                  : "Never applied"}
              </small>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

// Space that duplicates and cleanup rules could give back. Totals count each file once.
export function SpaceToFreeWidget({ data, error, onRefresh }) {
  const rules = (data?.rules || []).filter((rule) => rule.bytes > 0 || rule.error);
  const duplicates = data?.duplicates;
  return (
    <>
      <div className="home-widget-head">
        <WidgetTitle icon={DeleteBin6LineIcon} title="Space you could free" />
        <RefreshButton onClick={onRefresh} label="Recount" />
      </div>
      {error && !data ? <p className="home-widget-note">{error}</p> : null}
      {!data && !error ? <p className="home-widget-note">Counting duplicates and rule matches…</p> : null}
      {data ? (
        <>
          <p className="home-space-total">
            <strong>{data.totalBytes ? formatBytes(data.totalBytes) : "0 GB"}</strong>
            <span>
              {data.items} {data.items === 1 ? "file" : "files"}
            </span>
          </p>
          <ul className="home-space-list">
            <li>
              <Link to="/server-management?tab=duplicates">Duplicate copies</Link>
              <span>{duplicates?.error ? "Unavailable" : `${duplicates?.copies || 0} extra · ${formatBytes(duplicates?.bytes || 0)}`}</span>
            </li>
            {rules.map((rule) => (
              <li key={rule.id}>
                <Link to="/server-management?tab=cleanup">
                  {rule.name}
                  {!rule.enabled ? <em> off</em> : rule.dryRun ? <em> dry run</em> : null}
                </Link>
                <span>{rule.error ? "Preview failed" : `${rule.count} · ${formatBytes(rule.bytes)}`}</span>
              </li>
            ))}
            {!rules.length && !data.rulesError ? (
              <li className="is-muted">
                <span>No cleanup rule matches anything right now.</span>
              </li>
            ) : null}
          </ul>
          <small className="home-widget-foot">Nothing is deleted from here · counted {timeAgo(data.checkedAt)}</small>
        </>
      ) : null}
    </>
  );
}

import { Link } from "react-router-dom";
import CalendarEventFillIcon from "remixicon-react/CalendarEventFillIcon";
import ArrowLeftSLineIcon from "remixicon-react/ArrowLeftSLineIcon";
import ArrowRightSLineIcon from "remixicon-react/ArrowRightSLineIcon";
import CloseLineIcon from "remixicon-react/CloseLineIcon";
import FilmLineIcon from "remixicon-react/FilmLineIcon";
import RefreshLineIcon from "remixicon-react/RefreshLineIcon";
import Settings3LineIcon from "remixicon-react/Settings3LineIcon";
import TvLineIcon from "remixicon-react/TvLineIcon";
import MusicLineIcon from "remixicon-react/MusicLineIcon";
import BookLineIcon from "remixicon-react/BookLineIcon";
import HeadphoneLineIcon from "remixicon-react/HeadphoneLineIcon";
import CheckboxCircleFillIcon from "remixicon-react/CheckboxCircleFillIcon";
import ErrorWarningLineIcon from "remixicon-react/ErrorWarningLineIcon";
import TimeLineIcon from "remixicon-react/TimeLineIcon";
import LayoutGridLineIcon from "remixicon-react/LayoutGridLineIcon";
import ListCheck2Icon from "remixicon-react/ListCheck2Icon";
import BookmarkLineIcon from "remixicon-react/BookmarkLineIcon";
import RssLineIcon from "remixicon-react/RssLineIcon";
import FileCopyLineIcon from "remixicon-react/FileCopyLineIcon";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import axios from "../lib/axios_instance";
import { loadSavedIntegrations } from "../lib/integrations-storage";
import "./css/integrations.css";
import "./css/calendar.css";
import { selfhstIconUrl } from "../lib/selfhst-icons";

const iconUrl = (slug) => {
  const safe = String(slug || "sonarr")
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "");
  const iconSlug = /^[a-z0-9][a-z0-9-]{0,63}$/.test(safe) ? safe : "sonarr";
  return selfhstIconUrl(iconSlug);
};

const calendarSourceDefaults = [
  { name: "Sonarr", slug: "sonarr", connected: false },
  { name: "Radarr", slug: "radarr", connected: false },
  { name: "Lidarr", slug: "lidarr", connected: false },
  { name: "Readarr", slug: "readarr", connected: false },
  { name: "Audiobookshelf", slug: "audiobookshelf", connected: false },
];

const TYPE_FILTERS = [
  { key: "all", label: "All" },
  { key: "tv", label: "TV", Icon: TvLineIcon },
  { key: "movie", label: "Movies", Icon: FilmLineIcon },
  { key: "music", label: "Music", Icon: MusicLineIcon },
  { key: "book", label: "Books", Icon: BookLineIcon },
  { key: "audiobook", label: "Audio", Icon: HeadphoneLineIcon },
];

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const VIEW_STORAGE_KEY = "jellyglance-calendar-view";
const DEFAULTS_STORAGE_KEY = "jellyglance-calendar-defaults";

function readDefaults() {
  try {
    const value = JSON.parse(window.localStorage.getItem(DEFAULTS_STORAGE_KEY) || "null");
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}

function writeDefaults(value) {
  try {
    if (value) window.localStorage.setItem(DEFAULTS_STORAGE_KEY, JSON.stringify(value));
    else window.localStorage.removeItem(DEFAULTS_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}
const AGENDA_DAYS = 45;
const CELL_EVENT_LIMIT = 3;

function readStoredView() {
  try {
    const value = window.localStorage.getItem(VIEW_STORAGE_KEY);
    return value === "agenda" || value === "month" ? value : null;
  } catch {
    return null;
  }
}

function storeView(value) {
  try {
    window.localStorage.setItem(VIEW_STORAGE_KEY, value);
  } catch {
    // Storage can be unavailable (private mode); the view still works for this visit.
  }
}

function appIcon(app) {
  const slug = String(app.slug || app.name || "sonarr").toLowerCase();
  return <img src={iconUrl(slug)} alt="" loading="lazy" decoding="async" />;
}

function startOfDay(date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function dayKey(date) {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function formatDate(date) {
  return date.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
}

function formatLongDate(date) {
  return date.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
}

function formatTime(date) {
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

// Date-only releases arrive as midnight UTC; keep them on that calendar day in every timezone.
function parseReleaseDate(release) {
  const date = new Date(release.date);
  if (!["tv", "audiobook"].includes(releaseType(release)) && !Number.isNaN(date.getTime()) && date.getUTCHours() === 0 && date.getUTCMinutes() === 0) {
    return new Date(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  }
  return date;
}

// Movie, album and book dates are date-only (midnight UTC), so a clock time would be misleading.
function releaseTime(release) {
  return ["tv", "audiobook"].includes(releaseType(release)) ? formatTime(release.date) : "All day";
}

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function monthLabel(date) {
  return date.toLocaleDateString([], { month: "long", year: "numeric" });
}

function relativeTime(value) {
  if (!value) return "";
  const diff = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(diff)) return "";
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function dayHeading(date, today) {
  if (sameDay(date, today)) return "Today";
  if (sameDay(date, addDays(today, 1))) return "Tomorrow";
  if (sameDay(date, addDays(today, -1))) return "Yesterday";
  return formatLongDate(date);
}

function buildMonthDays(activeMonth) {
  const first = new Date(activeMonth.getFullYear(), activeMonth.getMonth(), 1);
  const last = new Date(activeMonth.getFullYear(), activeMonth.getMonth() + 1, 0);
  const gridStart = addDays(first, -first.getDay());
  // Only render the weeks the month actually spans (4–6), not a fixed 42 cells.
  const weeks = Math.ceil((first.getDay() + last.getDate()) / 7);
  return Array.from({ length: weeks * 7 }, (_, index) => addDays(gridStart, index));
}

function releaseType(release) {
  const type = String(release?.type || "").toLowerCase();
  if (["tv", "movie", "music", "book", "audiobook"].includes(type)) return type;
  const service = String(release?.service || "").toLowerCase();
  if (service.includes("audiobookshelf")) return "audiobook";
  if (service.includes("lidarr")) return "music";
  if (service.includes("readarr")) return "book";
  return service.includes("radarr") ? "movie" : "tv";
}

function TypeIcon({ release, size = 16 }) {
  const type = releaseType(release);
  if (type === "movie") return <FilmLineIcon size={size} />;
  if (type === "music") return <MusicLineIcon size={size} />;
  if (type === "book") return <BookLineIcon size={size} />;
  if (type === "audiobook") return <HeadphoneLineIcon size={size} />;
  return <TvLineIcon size={size} />;
}

function ReleaseArtwork({ release, size = 18 }) {
  const [failed, setFailed] = useState(false);
  if (release?.posterUrl && !failed) {
    return <img src={release.posterUrl} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} />;
  }
  return <TypeIcon release={release} size={size} />;
}

function releaseStatus(release, now) {
  // Audiobookshelf entries are things that arrived, not things expected.
  if (releaseType(release) === "audiobook") return { key: "is-ready", label: release.kind === "podcast" ? "New episode" : "Added" };
  if (release.hasFile) return { key: "is-ready", label: "Downloaded" };
  // A cinema date passing without a file is expected; it only counts as missing once it is out on digital/physical.
  if (release.releaseKind === "In cinemas") return { key: "is-cinema", label: release.date < now ? "In cinemas" : "Cinema release" };
  if (release.date < now) return { key: "is-missing", label: release.monitored ? "Missing" : "Unmonitored" };
  return { key: "is-upcoming", label: release.monitored ? "Upcoming" : "Unmonitored" };
}

function releaseTag(release) {
  if (release.finale) return `${String(release.finale).replace(/^\w/, (c) => c.toUpperCase())} finale`;
  if (release.premiere) return "Premiere";
  return "";
}

function episodeCode(release) {
  const match = String(release.subtitle || "").match(/^S\d+E\d+/);
  return match ? match[0] : "";
}

function CalendarReleaseButton({ item, now, onClick }) {
  const status = releaseStatus(item, now);
  const code = episodeCode(item);
  return (
    <button
      type="button"
      className={`calendar-event-pill is-type-${releaseType(item)} ${status.key}`}
      title={`${item.title}${item.subtitle ? ` · ${item.subtitle}` : ""} · ${releaseTime(item)} · ${status.label}`}
      onClick={() => onClick(item)}
    >
      <span className="calendar-pill-art">
        <ReleaseArtwork release={item} size={12} />
      </span>
      <strong>{item.title}</strong>
      {code ? <em>{code}</em> : null}
      {status.key === "is-ready" ? <CheckboxCircleFillIcon className="calendar-pill-state" size={13} /> : null}
    </button>
  );
}

function AgendaRow({ item, now, onClick }) {
  const status = releaseStatus(item, now);
  const tag = releaseTag(item);
  return (
    <button type="button" className={`calendar-agenda-row is-type-${releaseType(item)} ${status.key}`} onClick={() => onClick(item)}>
      <span className="calendar-agenda-poster">
        <ReleaseArtwork release={item} size={22} />
      </span>
      <span className="calendar-agenda-copy">
        <strong>{item.title}</strong>
        <small>{item.subtitle}</small>
        <span className="calendar-agenda-meta">
          <span>
            <TimeLineIcon size={13} />
            {releaseTime(item)}
          </span>
          <span>{item.service}</span>
          {item.network ? <span>{item.network}</span> : null}
          {tag ? <span className="calendar-tag">{tag}</span> : null}
        </span>
      </span>
      <span className={`calendar-status-chip ${status.key}`}>{status.label}</span>
    </button>
  );
}

// iCal subscription link and the daily "airing today" digest (admins only).
function SubscribePanel({ onClose }) {
  const [token, setToken] = useState(null);
  const [digest, setDigest] = useState(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState({ text: "", error: false });
  const feedUrl = token ? `${window.location.origin}/calendar-feed/${token}.ics` : "";

  useEffect(() => {
    Promise.all([axios.get("/calendar-feed/admin"), axios.get("/calendar-feed/admin/digest")])
      .then(([feed, settings]) => {
        setToken(feed.data?.token || null);
        setDigest(settings.data || null);
      })
      .catch((error) => setNote({ text: error?.response?.status === 403 ? "Only admins can manage the calendar link and digest." : "Unable to load the calendar settings.", error: true }));
  }, []);

  async function run(action, success) {
    setBusy(true);
    setNote({ text: "", error: false });
    try {
      await action();
      if (success) setNote({ text: success, error: false });
    } catch (error) {
      setNote({ text: error?.response?.data?.error || "Something went wrong", error: true });
    } finally {
      setBusy(false);
    }
  }

  const saveDigest = (patch) =>
    run(async () => {
      const { data } = await axios.put("/calendar-feed/admin/digest", { ...digest, ...patch });
      setDigest(data);
    });

  return (
    <div className="calendar-preview-backdrop calendar-day-modal-backdrop" role="presentation" onClick={onClose}>
      <article className="calendar-day-modal calendar-subscribe" role="dialog" aria-modal="true" aria-label="Subscribe and digest" onClick={(event) => event.stopPropagation()}>
        <button type="button" className="calendar-preview-close" aria-label="Close" onClick={onClose}>
          <CloseLineIcon size={22} />
        </button>
        <div className="calendar-day-modal-header">
          <span>Calendar</span>
          <h2>Subscribe & daily digest</h2>
        </div>

        <section>
          <h3>Calendar app subscription</h3>
          <p>Add releases to Google Calendar, Apple Calendar or Outlook. They refresh about every hour. Anyone with the link can see the list, so keep it private.</p>
          {token ? (
            <>
              <div className="calendar-feed-url">
                <input readOnly value={feedUrl} onFocus={(event) => event.target.select()} />
                <button
                  type="button"
                  onClick={() =>
                    navigator.clipboard
                      ?.writeText(feedUrl)
                      .then(() => setNote({ text: "Link copied", error: false }))
                      .catch(() => setNote({ text: "Copy failed — select the link and copy it", error: true }))
                  }
                >
                  <FileCopyLineIcon size={16} /> Copy
                </button>
              </div>
              <p className="calendar-subscribe-hint">
                Google Calendar: Other calendars → From URL. Apple: File → New Calendar Subscription. Use your public JellyGlance address if you subscribe from outside your network.
              </p>
              <div className="calendar-subscribe-actions">
                <button type="button" disabled={busy} onClick={() => run(async () => setToken((await axios.post("/calendar-feed/admin/rotate")).data.token), "New link created; the old one stops working")}>
                  Reset link
                </button>
                <button type="button" disabled={busy} className="is-danger" onClick={() => run(async () => { await axios.delete("/calendar-feed/admin"); setToken(null); }, "Calendar link turned off")}>
                  Turn off
                </button>
              </div>
            </>
          ) : (
            <button type="button" className="is-primary" disabled={busy || note.error} onClick={() => run(async () => setToken((await axios.post("/calendar-feed/admin/enable")).data.token))}>
              <RssLineIcon size={16} /> Create calendar link
            </button>
          )}
        </section>

        {digest ? (
          <section>
            <h3>Daily “airing today” message</h3>
            <p>
              Once a day, sends what is due today{digest.includeMissing ? " and what went missing this week" : ""} to every webhook subscribed to <strong>Airing today digest</strong> (Settings → Webhooks).
            </p>
            <label className="calendar-switch">
              <input type="checkbox" checked={Boolean(digest.enabled)} disabled={busy} onChange={(event) => saveDigest({ enabled: event.target.checked })} />
              <span>Send the daily digest</span>
            </label>
            <div className="calendar-subscribe-row">
              <label>
                Send at
                <select value={digest.hour} disabled={busy} onChange={(event) => saveDigest({ hour: Number(event.target.value) })}>
                  {Array.from({ length: 24 }, (_, hour) => (
                    <option key={hour} value={hour}>
                      {String(hour).padStart(2, "0")}:00
                    </option>
                  ))}
                </select>
              </label>
              <label className="calendar-switch">
                <input type="checkbox" checked={Boolean(digest.includeMissing)} disabled={busy} onChange={(event) => saveDigest({ includeMissing: event.target.checked })} />
                <span>Include missing episodes and movies</span>
              </label>
            </div>
            <div className="calendar-subscribe-actions">
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    const { data } = await axios.post("/calendar-feed/admin/digest/send");
                    setNote({ text: `Sent: ${data.todayCount} today, ${data.missingCount} missing. No message? Subscribe a webhook to “Airing today digest”.`, error: false });
                  })
                }
              >
                Send one now
              </button>
              <Link to="/settings/webhooks">Open webhooks</Link>
            </div>
          </section>
        ) : null}

        {note.text ? <p className={`calendar-subscribe-note${note.error ? " is-error" : ""}`}>{note.text}</p> : null}
      </article>
    </div>
  );
}

export default function Calendar() {
  const [calendarData, setCalendarData] = useState({ releases: [], sources: [], syncedAt: null });
  const [loaded, setLoaded] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState("");
  const [visibleMonth, setVisibleMonth] = useState(new Date());
  const [selectedRelease, setSelectedRelease] = useState(null);
  const [selectedDay, setSelectedDay] = useState(null);
  // Saved defaults (this browser) decide how the page opens.
  const [savedDefaults, setSavedDefaults] = useState(readDefaults);
  const [activeSourceFilter, setActiveSourceFilter] = useState(() => savedDefaults?.source || "all");
  const [typeFilter, setTypeFilter] = useState(() => savedDefaults?.type || "all");
  const [hideDownloaded, setHideDownloaded] = useState(() => Boolean(savedDefaults?.hideDownloaded));
  const [view, setView] = useState(() => savedDefaults?.view || readStoredView() || (window.matchMedia?.("(max-width: 760px)").matches ? "agenda" : "month"));
  const [defaultsNote, setDefaultsNote] = useState("");
  const [showSubscribe, setShowSubscribe] = useState(false);
  const autoSyncStarted = useRef(false);
  const pollTimer = useRef(null);

  const integrations = loadSavedIntegrations({ arrApps: [], thirdParty: [] });
  const arrApps = [...(integrations.arrApps || []), ...(integrations.thirdParty || []).filter((app) => /audiobookshelf/i.test(String(app.slug || app.name || "")))];
  const syncedSources = Array.isArray(calendarData.sources) ? calendarData.sources : [];
  const activeSources = calendarSourceDefaults.map((source) => {
    const savedSource = arrApps.find((app) => sourceKey(app) === sourceKey(source));
    const syncedSource = syncedSources.find((app) => sourceKey(app) === sourceKey(source));
    const connected = Boolean(savedSource?.connected || syncedSource?.connected);
    return {
      ...source,
      instanceId: savedSource?.instanceId || syncedSource?.instanceId,
      connected,
      synced: Boolean(syncedSource),
      error: syncedSource?.error || "",
    };
  });
  const connectedArrApps = activeSources.filter((app) => app.connected);
  const failedSources = activeSources.filter((app) => app.error);

  const now = new Date();
  const today = startOfDay(now);

  const releases = useMemo(
    () =>
      (Array.isArray(calendarData.releases) ? calendarData.releases : [])
        .map((release) => ({ ...release, date: parseReleaseDate(release) }))
        .filter((release) => !Number.isNaN(release.date.getTime()))
        .sort((a, b) => a.date - b.date),
    [calendarData.releases]
  );
  const availableTypes = new Set(releases.map(releaseType));
  const filteredReleases = releases.filter(
    (release) =>
      (activeSourceFilter === "all" || sourceKey({ name: release.service }) === activeSourceFilter) &&
      (typeFilter === "all" || releaseType(release) === typeFilter) &&
      (!hideDownloaded || !release.hasFile)
  );
  const releasesByDay = useMemo(() => {
    const map = new Map();
    filteredReleases.forEach((release) => {
      const key = dayKey(release.date);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(release);
    });
    return map;
  }, [filteredReleases]);
  const releasesForDay = (date) => releasesByDay.get(dayKey(date)) || [];

  const monthDays = buildMonthDays(visibleMonth);
  const monthReleaseCount = filteredReleases.filter(
    (release) => release.date.getMonth() === visibleMonth.getMonth() && release.date.getFullYear() === visibleMonth.getFullYear()
  ).length;
  const agendaEnd = addDays(today, AGENDA_DAYS);
  const agendaDays = useMemo(() => {
    const groups = [];
    filteredReleases
      .filter((release) => release.date >= today && release.date < agendaEnd)
      .forEach((release) => {
        const last = groups[groups.length - 1];
        if (last && sameDay(last.date, release.date)) last.items.push(release);
        else groups.push({ date: startOfDay(release.date), items: [release] });
      });
    return groups;
  }, [filteredReleases, today.getTime()]);
  const thisWeek = filteredReleases.filter((release) => release.date >= today && release.date < addDays(today, 7));
  const missingCount = filteredReleases.filter((release) => releaseStatus(release, now).key === "is-missing" && release.monitored).length;
  const selectedDayReleases = selectedDay ? releasesForDay(selectedDay) : [];
  const isCurrentMonth = visibleMonth.getMonth() === today.getMonth() && visibleMonth.getFullYear() === today.getFullYear();

  async function loadCalendarData() {
    try {
      const response = await axios.get("/api/integrations/calendar", {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      });
      const data = response.data && typeof response.data === "object" ? response.data : {};
      setCalendarData({ releases: [], sources: [], syncedAt: null, ...data });
      return data;
    } catch (error) {
      console.log("Unable to load calendar sync data", error);
      return null;
    } finally {
      setLoaded(true);
    }
  }

  async function runCalendarSync() {
    if (syncing) return;
    setSyncing(true);
    setSyncError("");
    const previousSync = calendarData.syncedAt;
    try {
      await axios.get("/api/startTask?task=ArrCalendarSync", {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      });
    } catch (error) {
      setSyncing(false);
      setSyncError(error?.response?.data?.error || error?.response?.data || "Unable to start the calendar sync.");
      return;
    }
    // Poll until the task writes a new sync time, rather than guessing how long it takes.
    const startedAt = Date.now();
    const poll = async () => {
      const data = await loadCalendarData();
      if (data?.syncedAt && data.syncedAt !== previousSync) {
        setSyncing(false);
        return;
      }
      if (Date.now() - startedAt > 90000) {
        setSyncing(false);
        setSyncError("The sync is taking longer than expected. Check Settings → Tasks for its status.");
        return;
      }
      pollTimer.current = window.setTimeout(poll, 2000);
    };
    pollTimer.current = window.setTimeout(poll, 1500);
  }

  useEffect(() => {
    loadCalendarData();
    return () => window.clearTimeout(pollTimer.current);
  }, []);

  // First visit with connected apps but no sync yet: run one instead of showing an empty month.
  useEffect(() => {
    if (loaded && !calendarData.syncedAt && connectedArrApps.length && !autoSyncStarted.current) {
      autoSyncStarted.current = true;
      runCalendarSync();
    }
  }, [loaded, calendarData.syncedAt, connectedArrApps.length]);

  useEffect(() => {
    if (!selectedRelease && !selectedDay) return undefined;
    const onKey = (event) => {
      if (event.key === "Escape") {
        setSelectedRelease(null);
        setSelectedDay(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedRelease, selectedDay]);

  const currentDefaults = { view, type: typeFilter, source: activeSourceFilter, hideDownloaded };
  const matchesDefaults =
    savedDefaults &&
    savedDefaults.view === view &&
    savedDefaults.type === typeFilter &&
    savedDefaults.source === activeSourceFilter &&
    Boolean(savedDefaults.hideDownloaded) === hideDownloaded;

  function saveDefaults() {
    if (writeDefaults(currentDefaults)) {
      setSavedDefaults(currentDefaults);
      setDefaultsNote("Saved as your default view");
    } else {
      setDefaultsNote("Could not save in this browser");
    }
    window.setTimeout(() => setDefaultsNote(""), 2500);
  }

  function applyDefaults() {
    const next = savedDefaults || { view: "month", type: "all", source: "all", hideDownloaded: false };
    setView(next.view || "month");
    setTypeFilter(next.type || "all");
    setActiveSourceFilter(next.source || "all");
    setHideDownloaded(Boolean(next.hideDownloaded));
  }

  function clearDefaults() {
    writeDefaults(null);
    setSavedDefaults(null);
    setDefaultsNote("Defaults cleared");
    window.setTimeout(() => setDefaultsNote(""), 2500);
  }

  function changeView(next) {
    setView(next);
    storeView(next);
  }

  function shiftMonth(delta) {
    setVisibleMonth(new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + delta, 1));
  }

  const syncLabel = syncing
    ? "Syncing releases…"
    : calendarData.syncedAt
      ? `Synced ${relativeTime(calendarData.syncedAt)}`
      : "Not synced yet";
  const noApps = loaded && !connectedArrApps.length;
  const neverSynced = loaded && connectedArrApps.length > 0 && !calendarData.syncedAt;

  return (
    <div className="integrations-page is-compact-page calendar-dashboard">
      <section className="integration-page-header calendar-header">
        <div>
          <p>Release planning</p>
          <h1>Calendar</h1>
          <span>
            {connectedArrApps.length
              ? `${connectedArrApps.length} Arr app${connectedArrApps.length === 1 ? "" : "s"} connected · ${syncLabel}`
              : "Connect Sonarr, Radarr, Lidarr, Readarr or Audiobookshelf to see releases."}
          </span>
        </div>
        {releases.length ? (
          <div className="calendar-header-stats">
            <div>
              <strong>{thisWeek.length}</strong>
              <span>This week</span>
            </div>
            <div>
              <strong>{filteredReleases.filter((release) => release.date >= now).length}</strong>
              <span>Upcoming</span>
            </div>
            <div className={missingCount ? "is-warning" : ""}>
              <strong>{missingCount}</strong>
              <span>Missing</span>
            </div>
          </div>
        ) : null}
      </section>

      <section className="calendar-toolbar calendar-toolbar-v2">
        <div className="calendar-toolbar-group">
          <button type="button" aria-label="Previous month" onClick={() => shiftMonth(-1)} disabled={view === "agenda"}>
            <ArrowLeftSLineIcon size={18} />
          </button>
          <strong className="calendar-month-label">{view === "agenda" ? `Next ${AGENDA_DAYS} days` : monthLabel(visibleMonth)}</strong>
          <button type="button" aria-label="Next month" onClick={() => shiftMonth(1)} disabled={view === "agenda"}>
            <ArrowRightSLineIcon size={18} />
          </button>
          <button type="button" onClick={() => setVisibleMonth(new Date())} disabled={view === "agenda" || isCurrentMonth}>
            Today
          </button>
        </div>

        <div className="calendar-segmented" role="group" aria-label="Calendar view">
          <button type="button" className={view === "month" ? "is-active" : ""} aria-pressed={view === "month"} onClick={() => changeView("month")}>
            <LayoutGridLineIcon size={16} />
            Month
          </button>
          <button type="button" className={view === "agenda" ? "is-active" : ""} aria-pressed={view === "agenda"} onClick={() => changeView("agenda")}>
            <ListCheck2Icon size={16} />
            Agenda
          </button>
        </div>

        <div className="calendar-segmented calendar-type-filter" role="group" aria-label="Release type">
          {TYPE_FILTERS.filter((filter) => filter.key === "all" || availableTypes.has(filter.key)).map(({ key, label, Icon }) => (
            <button type="button" key={key} className={typeFilter === key ? "is-active" : ""} aria-pressed={typeFilter === key} onClick={() => setTypeFilter(key)}>
              {Icon ? <Icon size={15} /> : null}
              {label}
            </button>
          ))}
        </div>

        <label className="calendar-toggle">
          <input type="checkbox" checked={hideDownloaded} onChange={(event) => setHideDownloaded(event.target.checked)} />
          <span>Hide downloaded</span>
        </label>

        <div className="calendar-toolbar-group calendar-defaults">
          <button type="button" onClick={saveDefaults} disabled={Boolean(matchesDefaults)} title="Open the calendar with this view and these filters">
            <BookmarkLineIcon size={16} />
            {matchesDefaults ? "Default" : "Save as default"}
          </button>
          {savedDefaults && !matchesDefaults ? (
            <button type="button" onClick={applyDefaults} title="Go back to your saved view and filters">
              Reset
            </button>
          ) : null}
          {savedDefaults && matchesDefaults ? (
            <button type="button" className="calendar-link-button" onClick={clearDefaults}>
              Clear
            </button>
          ) : null}
          {defaultsNote ? <span className="calendar-defaults-note" role="status">{defaultsNote}</span> : null}
        </div>

        <div className="calendar-toolbar-group calendar-toolbar-end">
          <button type="button" className="is-primary" onClick={runCalendarSync} disabled={syncing || !connectedArrApps.length}>
            <RefreshLineIcon size={17} className={syncing ? "is-spinning" : ""} />
            {syncing ? "Syncing" : "Sync now"}
          </button>
          <button type="button" onClick={() => setShowSubscribe(true)}>
            <RssLineIcon size={17} />
            Subscribe
          </button>
          <Link to="/settings/integrations/automation">
            <Settings3LineIcon size={17} />
            Arr apps
          </Link>
        </div>
      </section>

      {syncError ? (
        <div className="calendar-alert is-error" role="alert">
          <ErrorWarningLineIcon size={18} />
          <span>{String(syncError)}</span>
        </div>
      ) : null}
      {failedSources.length ? (
        <div className="calendar-alert is-warning" role="status">
          <ErrorWarningLineIcon size={18} />
          <span>
            Last sync could not reach {failedSources.map((app) => `${app.name} (${app.error})`).join(", ")}. Their releases may be missing.
          </span>
        </div>
      ) : null}

      <section className="calendar-source-strip">
        {activeSources.map((app) => {
          const filterKey = sourceKey(app);
          const sourceReleaseCount = releases.filter((release) => sourceKey({ name: release.service }) === filterKey).length;
          const isSelected = activeSourceFilter === filterKey;
          const lightClass = app.error ? "is-disconnected" : app.connected ? "is-connected" : "is-unset";

          return (
            <button
              type="button"
              className={`${app.connected ? "is-active" : ""} ${isSelected ? "is-selected" : ""}`}
              key={app.name}
              aria-pressed={isSelected}
              disabled={!app.connected}
              title={app.error ? `Last sync failed: ${app.error}` : app.connected ? `Show only ${app.name}` : `${app.name} is not set up`}
              onClick={() => setActiveSourceFilter(isSelected ? "all" : filterKey)}
            >
              <span className="calendar-source-icon">{appIcon(app)}</span>
              <strong className="calendar-source-name">
                {app.name}
                <span className={`integration-status-light ${lightClass}`} />
              </strong>
              <small>{app.error ? "Sync failed" : app.connected ? `${sourceReleaseCount} release${sourceReleaseCount === 1 ? "" : "s"}` : "Not set up"}</small>
            </button>
          );
        })}
      </section>

      <section className="calendar-layout">
        {noApps ? (
          <div className="calendar-empty-state">
            <CalendarEventFillIcon />
            <strong>No Arr apps connected</strong>
            <span>Connect Sonarr, Radarr, Lidarr or Readarr and the calendar fills in automatically.</span>
            <Link className="calendar-empty-action" to="/settings/integrations/automation">
              <Settings3LineIcon size={17} />
              Set up Arr apps
            </Link>
          </div>
        ) : neverSynced && !releases.length ? (
          <div className="calendar-empty-state">
            <RefreshLineIcon className={syncing ? "is-spinning" : ""} />
            <strong>{syncing ? "Fetching releases from your Arr apps…" : "No releases synced yet"}</strong>
            <span>This usually takes a few seconds.</span>
            {!syncing ? (
              <button type="button" className="calendar-empty-action" onClick={runCalendarSync}>
                <RefreshLineIcon size={17} />
                Sync now
              </button>
            ) : null}
          </div>
        ) : view === "agenda" ? (
          <div className="calendar-agenda">
            {agendaDays.length ? (
              agendaDays.map((group) => (
                <section className={`calendar-agenda-day ${sameDay(group.date, today) ? "is-today" : ""}`} key={dayKey(group.date)}>
                  <header>
                    <strong>{dayHeading(group.date, today)}</strong>
                    <span>
                      {sameDay(group.date, today) || sameDay(group.date, addDays(today, 1)) ? `${formatDate(group.date)} · ` : ""}
                      {group.items.length} release{group.items.length === 1 ? "" : "s"}
                    </span>
                  </header>
                  <div className="calendar-agenda-list">
                    {group.items.map((item) => (
                      <AgendaRow item={item} now={now} key={item.id} onClick={setSelectedRelease} />
                    ))}
                  </div>
                </section>
              ))
            ) : (
              <div className="calendar-empty-state">
                <CalendarEventFillIcon />
                <strong>Nothing coming up</strong>
                <span>No releases match these filters in the next {AGENDA_DAYS} days.</span>
              </div>
            )}
          </div>
        ) : (
          <div className="calendar-month-panel">
            <div className="calendar-panel-heading">
              <h2>
                <CalendarEventFillIcon size={20} />
                {monthLabel(visibleMonth)}
              </h2>
              <span>
                {monthReleaseCount} release{monthReleaseCount === 1 ? "" : "s"} this month
              </span>
            </div>
            <div className="calendar-month-grid">
              {WEEKDAYS.map((day) => (
                <div className="calendar-weekday" key={day}>
                  {day}
                </div>
              ))}
              {monthDays.map((day) => {
                const dayReleases = releasesForDay(day);
                const isToday = sameDay(day, today);
                const isPast = day < today;
                const outside = day.getMonth() !== visibleMonth.getMonth();
                return (
                  <article
                    className={`calendar-month-cell ${outside ? "is-muted" : ""} ${isToday ? "is-today" : ""} ${isPast && !isToday ? "is-past" : ""} ${dayReleases.length ? "has-events" : ""}`}
                    key={day.toISOString()}
                  >
                    <div className="calendar-cell-date">
                      <button
                        type="button"
                        className="calendar-cell-day"
                        aria-label={`${formatLongDate(day)}, ${dayReleases.length} release${dayReleases.length === 1 ? "" : "s"}`}
                        onClick={() => (dayReleases.length ? setSelectedDay(day) : null)}
                        disabled={!dayReleases.length}
                      >
                        {day.getDate()}
                      </button>
                      {isToday ? <small>Today</small> : null}
                    </div>
                    <div className="calendar-cell-events">
                      {dayReleases.slice(0, CELL_EVENT_LIMIT).map((item) => (
                        <CalendarReleaseButton item={item} now={now} key={item.id} onClick={setSelectedRelease} />
                      ))}
                      {dayReleases.length > CELL_EVENT_LIMIT ? (
                        <button type="button" className="calendar-day-more-button" onClick={() => setSelectedDay(day)}>
                          +{dayReleases.length - CELL_EVENT_LIMIT} more
                        </button>
                      ) : null}
                    </div>
                  </article>
                );
              })}
            </div>
            <div className="calendar-legend" aria-label="Legend">
              <span className="is-upcoming">Upcoming</span>
              <span className="is-ready">Downloaded</span>
              <span className="is-missing">Missing</span>
            </div>
          </div>
        )}
      </section>

      {/* Modals render on <body>: the app shell is CSS-scaled, which would trap position:fixed inside the page. */}
      {showSubscribe ? createPortal(<div className="calendar-dashboard calendar-modal-root"><SubscribePanel onClose={() => setShowSubscribe(false)} /></div>, document.body) : null}

      {(selectedRelease || selectedDay) && typeof document !== "undefined"
        ? createPortal(
            <div className="calendar-dashboard calendar-modal-root">
      {selectedRelease ? (
        <div className={`calendar-preview-backdrop is-type-${releaseType(selectedRelease)}`} role="presentation" onClick={() => setSelectedRelease(null)}>
          <article
            className={`calendar-preview-modal calendar-preview-v2 is-type-${releaseType(selectedRelease)}`}
            role="dialog"
            aria-modal="true"
            aria-label={selectedRelease.title}
            onClick={(event) => event.stopPropagation()}
            style={selectedRelease.backdropUrl ? { "--calendar-backdrop": `url("${String(selectedRelease.backdropUrl).replace(/"/g, "%22")}")` } : undefined}
          >
            <button type="button" className="calendar-preview-close" aria-label="Close preview" onClick={() => setSelectedRelease(null)}>
              <CloseLineIcon size={22} />
            </button>
            <div className="calendar-preview-art">
              <ReleaseArtwork release={selectedRelease} size={64} />
            </div>
            <div className="calendar-preview-copy">
              <span>
                <TypeIcon release={selectedRelease} size={14} />
                {selectedRelease.kind === "podcast" ? "Podcast episode" : { movie: "Movie", music: "Album", book: "Book", tv: "Episode", audiobook: "Audiobook" }[releaseType(selectedRelease)]} · {selectedRelease.service}
              </span>
              <h2>{selectedRelease.title}</h2>
              {selectedRelease.subtitle ? <p className="calendar-preview-subtitle">{selectedRelease.subtitle}</p> : null}
              <dl>
                <div>
                  <dt>Date</dt>
                  <dd>{formatDate(selectedRelease.date)}</dd>
                </div>
                <div>
                  <dt>Time</dt>
                  <dd>{releaseTime(selectedRelease)}</dd>
                </div>
                <div>
                  <dt>Status</dt>
                  <dd className={`calendar-status-chip ${releaseStatus(selectedRelease, now).key}`}>{releaseStatus(selectedRelease, now).label}</dd>
                </div>
                {selectedRelease.network ? (
                  <div>
                    <dt>{releaseType(selectedRelease) === "movie" ? "Studio" : "Network"}</dt>
                    <dd>{selectedRelease.network}</dd>
                  </div>
                ) : null}
                {selectedRelease.runtime ? (
                  <div>
                    <dt>Runtime</dt>
                    <dd>{selectedRelease.runtime} min</dd>
                  </div>
                ) : null}
              </dl>
              {selectedRelease.overview ? <p className="calendar-preview-overview">{selectedRelease.overview}</p> : null}
            </div>
          </article>
        </div>
      ) : null}

      {selectedDay ? (
        <div className="calendar-preview-backdrop calendar-day-modal-backdrop" role="presentation" onClick={() => setSelectedDay(null)}>
          <article className="calendar-day-modal" role="dialog" aria-modal="true" aria-label={`Releases for ${formatDate(selectedDay)}`} onClick={(event) => event.stopPropagation()}>
            <button type="button" className="calendar-preview-close" aria-label="Close day" onClick={() => setSelectedDay(null)}>
              <CloseLineIcon size={22} />
            </button>
            <div className="calendar-day-modal-header">
              <span>{["Today", "Tomorrow", "Yesterday"].includes(dayHeading(selectedDay, today)) ? dayHeading(selectedDay, today) : "Release day"}</span>
              <h2>{formatLongDate(selectedDay)}</h2>
              <p>
                {selectedDayReleases.length} release{selectedDayReleases.length === 1 ? "" : "s"}
              </p>
            </div>
            <div className="calendar-day-modal-list calendar-agenda-list">
              {selectedDayReleases.map((item) => (
                <AgendaRow
                  item={item}
                  now={now}
                  key={item.id}
                  onClick={(release) => {
                    setSelectedDay(null);
                    setSelectedRelease(release);
                  }}
                />
              ))}
            </div>
          </article>
        </div>
      ) : null}
            </div>,
            document.body
          )
        : null}
    </div>
  );
}

function sourceKey(source) {
  return String(source?.name || source?.slug || "").toLowerCase();
}

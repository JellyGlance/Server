import { Link } from "react-router-dom";
import CalendarEventFillIcon from "remixicon-react/CalendarEventFillIcon";
import ArrowLeftSLineIcon from "remixicon-react/ArrowLeftSLineIcon";
import ArrowRightSLineIcon from "remixicon-react/ArrowRightSLineIcon";
import CloseLineIcon from "remixicon-react/CloseLineIcon";
import FilmLineIcon from "remixicon-react/FilmLineIcon";
import RefreshLineIcon from "remixicon-react/RefreshLineIcon";
import Settings3LineIcon from "remixicon-react/Settings3LineIcon";
import TvLineIcon from "remixicon-react/TvLineIcon";
import { useEffect, useState } from "react";
import axios from "../lib/axios_instance";
import { loadSavedIntegrations } from "../lib/integrations-storage";
import "./css/integrations.css";
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
];

function appIcon(app) {
  const slug = String(app.slug || app.name || "sonarr").toLowerCase();
  return <img src={iconUrl(slug)} alt="" loading="lazy" decoding="async" />;
}

function addDays(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date;
}

function formatDate(date) {
  return date.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
}

function formatTime(date) {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function monthLabel(date) {
  return date.toLocaleDateString([], { month: "long", year: "numeric" });
}

function buildMonthDays(activeMonth) {
  const first = new Date(activeMonth.getFullYear(), activeMonth.getMonth(), 1);
  const gridStart = new Date(first);
  gridStart.setDate(first.getDate() - first.getDay());

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + index);
    return date;
  });
}

const sampleReleases = [
  {
    id: "sample-tv-1",
    type: "tv",
    title: "Awaiting Sonarr sync",
    subtitle: "S01E01 - Upcoming episode",
    date: addDays(1),
    service: "Sonarr",
    monitored: true,
    hasFile: false,
  },
  {
    id: "sample-movie-1",
    type: "movie",
    title: "Awaiting Radarr sync",
    subtitle: "Movie release",
    date: addDays(3),
    service: "Radarr",
    monitored: true,
    hasFile: false,
  },
];

function ReleaseArtwork({ release, size = 18 }) {
  if (release?.posterUrl) {
    return <img src={release.posterUrl} alt="" loading="lazy" decoding="async" />;
  }
  return release?.type === "tv" ? <TvLineIcon size={size} /> : <FilmLineIcon size={size} />;
}

function releaseAccentClass(release) {
  return release?.type === "movie" ? "is-radarr-movie" : "is-sonarr-tv";
}

function sourceName(source) {
  return String(source?.name || source?.slug || "").toLowerCase();
}

function CalendarReleaseButton({ item, onClick }) {
  return (
    <button
      type="button"
      className={`calendar-event-pill ${item.hasFile ? "has-file" : "is-monitored"} ${releaseAccentClass(item)}`}
      onClick={() => onClick(item)}
    >
      <ReleaseArtwork release={item} size={13} />
      <span>{formatTime(item.date)}</span>
      <strong>{item.title}</strong>
    </button>
  );
}

export default function Calendar() {
  const [calendarData, setCalendarData] = useState({ releases: [], sources: [], syncedAt: null });
  const [syncing, setSyncing] = useState(false);
  const [visibleMonth, setVisibleMonth] = useState(new Date());
  const [selectedRelease, setSelectedRelease] = useState(null);
  const [selectedDay, setSelectedDay] = useState(null);
  const [activeSourceFilter, setActiveSourceFilter] = useState("all");
  const integrations = loadSavedIntegrations({ arrApps: [] });
  const arrApps = integrations.arrApps || [];
  const persistedSources = calendarData.sources?.length ? calendarData.sources : arrApps;
  const activeSources = calendarSourceDefaults.map((source) => {
    const savedSource = arrApps.find((app) => sourceName(app) === sourceName(source));
    const syncedSource = persistedSources.find((app) => sourceName(app) === sourceName(source));
    return {
      ...source,
      ...(savedSource || {}),
      ...(syncedSource || {}),
      name: source.name,
      slug: source.slug,
      connected: Boolean(syncedSource?.connected || savedSource?.connected),
    };
  });
  const connectedArrApps = activeSources.filter((app) => app.connected);
  const releases = calendarData.releases?.length
    ? calendarData.releases.map((release) => ({ ...release, date: new Date(release.date) }))
    : connectedArrApps.length
      ? sampleReleases
      : [];
  const filteredReleases =
    activeSourceFilter === "all"
      ? releases
      : releases.filter((release) => sourceName({ name: release.service }) === activeSourceFilter);
  const monthDays = buildMonthDays(visibleMonth);
  const today = new Date();
  const releasesForDay = (date) => filteredReleases.filter((release) => sameDay(release.date, date));
  const selectedDayReleases = selectedDay ? releasesForDay(selectedDay) : [];

  async function loadCalendarData() {
    try {
      const response = await axios.get("/api/integrations/calendar", {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      });
      setCalendarData(response.data || { releases: [], sources: [], syncedAt: null });
    } catch (error) {
      console.log("Unable to load calendar sync data", error);
    }
  }

  async function runCalendarSync() {
    setSyncing(true);
    try {
      await axios.get("/api/startTask?task=ArrCalendarSync", {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      });
      window.setTimeout(loadCalendarData, 2500);
    } catch (error) {
      console.log("Unable to start calendar sync", error);
    } finally {
      window.setTimeout(() => setSyncing(false), 2500);
    }
  }

  useEffect(() => {
    loadCalendarData();
  }, []);

  return (
    <div className="integrations-page is-compact-page calendar-dashboard">
      <section className="integration-page-header">
        <div>
          <p>Release planning</p>
          <h1>Calendar</h1>
          <span>{connectedArrApps.length ? `${connectedArrApps.length} Arr app${connectedArrApps.length === 1 ? "" : "s"} connected for release sync.` : "Connect Sonarr, Radarr, or Lidarr in Settings to populate releases."}</span>
        </div>
      </section>

      <section className="calendar-toolbar">
        <button type="button" onClick={() => setVisibleMonth(new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() - 1, 1))}>
          <ArrowLeftSLineIcon size={18} />
        </button>
        <button type="button" className="calendar-month-button" onClick={() => setVisibleMonth(new Date())}>
          {monthLabel(visibleMonth)}
        </button>
        <button type="button" onClick={() => setVisibleMonth(new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 1))}>
          <ArrowRightSLineIcon size={18} />
        </button>
        <button type="button" onClick={runCalendarSync} disabled={syncing}>
          <RefreshLineIcon size={18} />
          {syncing ? "Syncing" : "Sync Now"}
        </button>
        <Link to="/settings">
          <Settings3LineIcon size={18} />
          Integrations
        </Link>
      </section>

      <section className="calendar-source-strip">
        {activeSources.map((app) => {
          const filterKey = sourceName(app);
          const sourceReleaseCount = releases.filter((release) => sourceName({ name: release.service }) === filterKey).length;
          const isSelected = activeSourceFilter === filterKey;

          return (
          <button
            type="button"
            className={`${app.connected ? "is-active" : ""} ${isSelected ? "is-selected" : ""}`}
            key={app.instanceId || app.name}
            aria-pressed={isSelected}
            onClick={() => setActiveSourceFilter(isSelected ? "all" : filterKey)}
          >
            <span className="calendar-source-icon">{appIcon(app)}</span>
            <strong className="calendar-source-name">
              {app.name}
              <span className={`integration-status-light ${app.connected ? "is-connected" : "is-disconnected"}`} />
            </strong>
            <small>
              {app.connected ? `${sourceReleaseCount} planned` : "Needs setup"}
            </small>
          </button>
          );
        })}
      </section>

      <section className="calendar-layout">
        <div className="calendar-month-panel">
          <div className="calendar-panel-heading">
            <h2>
              <CalendarEventFillIcon size={20} />
              {monthLabel(visibleMonth)}
            </h2>
            <span>{filteredReleases.length} planned</span>
          </div>

          {filteredReleases.length ? (
            <div className="calendar-month-grid">
              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
                <div className="calendar-weekday" key={day}>{day}</div>
              ))}
              {monthDays.map((day) => {
                const dayReleases = releasesForDay(day);
                return (
                  <article
                    className={`calendar-month-cell ${day.getMonth() !== visibleMonth.getMonth() ? "is-muted" : ""} ${sameDay(day, today) ? "is-today" : ""}`}
                    key={day.toISOString()}
                  >
                    <div className="calendar-cell-date">
                      <strong>{day.getDate()}</strong>
                      {dayReleases.length ? <span>{dayReleases.length}</span> : null}
                    </div>
                    <div className="calendar-cell-events">
                      {dayReleases.slice(0, 4).map((item) => (
                        <CalendarReleaseButton item={item} key={item.id} onClick={setSelectedRelease} />
                      ))}
                      {dayReleases.length > 4 ? (
                        <button type="button" className="calendar-day-more-button" onClick={() => setSelectedDay(day)}>
                          +{dayReleases.length - 4} more
                        </button>
                      ) : null}
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="calendar-empty-state">
              <CalendarEventFillIcon />
              <strong>No release data yet</strong>
              <span>
                {activeSourceFilter === "all"
                  ? "Add and test Sonarr, Radarr, or Lidarr in Settings → Integrations, then run Sync Now."
                  : `No ${activeSourceFilter} releases found for this calendar window.`}
              </span>
            </div>
          )}
        </div>
      </section>

      {selectedRelease ? (
        <div className={`calendar-preview-backdrop ${releaseAccentClass(selectedRelease)}`} role="presentation" onClick={() => setSelectedRelease(null)}>
          <article className={`calendar-preview-modal ${releaseAccentClass(selectedRelease)}`} role="dialog" aria-modal="true" aria-label={selectedRelease.title} onClick={(event) => event.stopPropagation()}>
            <button type="button" className="calendar-preview-close" aria-label="Close preview" onClick={() => setSelectedRelease(null)}>
              <CloseLineIcon size={22} />
            </button>
            <div className="calendar-preview-art">
              <ReleaseArtwork release={selectedRelease} size={86} />
            </div>
            <div className="calendar-preview-copy">
              <span>{selectedRelease.type === "movie" ? "Movie" : "Episode"}</span>
              <h2>{selectedRelease.title}</h2>
              <p>{selectedRelease.subtitle}</p>
              <dl>
                <div>
                  <dt>Date</dt>
                  <dd>{formatDate(selectedRelease.date)}</dd>
                </div>
                <div>
                  <dt>Time</dt>
                  <dd>{formatTime(selectedRelease.date)}</dd>
                </div>
                <div>
                  <dt>Status</dt>
                  <dd>{selectedRelease.hasFile ? "Ready" : selectedRelease.monitored ? "Monitored" : "Unmonitored"}</dd>
                </div>
              </dl>
              {selectedRelease.overview ? <p>{selectedRelease.overview}</p> : null}
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
              <span>Release day</span>
              <h2>{formatDate(selectedDay)}</h2>
              <p>{selectedDayReleases.length} planned release{selectedDayReleases.length === 1 ? "" : "s"}</p>
            </div>
            <div className="calendar-day-modal-list">
              {selectedDayReleases.map((item) => (
                <CalendarReleaseButton
                  item={item}
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
    </div>
  );
}

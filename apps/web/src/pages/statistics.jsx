import { Tabs, Tab } from "react-bootstrap";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import axios from "../lib/axios_instance";
import BarChartFillIcon from "remixicon-react/BarChartFillIcon";
import CalendarLineIcon from "remixicon-react/CalendarLineIcon";
import ComputerLineIcon from "remixicon-react/ComputerLineIcon";
import FilmLineIcon from "remixicon-react/FilmLineIcon";
import PulseLineIcon from "remixicon-react/PulseLineIcon";
import TimeLineIcon from "remixicon-react/TimeLineIcon";
import TvLineIcon from "remixicon-react/TvLineIcon";
import UserStarLineIcon from "remixicon-react/UserStarLineIcon";

import "./css/stats.css";

import DailyPlayStats from "./components/statistics/daily-play-count";
import PlayStatsByDay from "./components/statistics/play-stats-by-day";
import PlayStatsByHour from "./components/statistics/play-stats-by-hour";
import LibraryHeatmap from "./components/statistics/library-heatmap";
import HomeStatisticCards from "./components/HomeStatisticCards";
import { Trans } from "react-i18next";
import { readAuth } from "./components/general/PageTabs";

function getStatValue(item = {}) {
  return Number(item.Plays ?? item.Count ?? item.unique_viewers ?? 0);
}

function getMediaItemId(item = {}) {
  return item.Id || item.ItemId || item.NowPlayingItemId || item.jellyglanceItemId || "";
}

function formatNumber(value) {
  return new Intl.NumberFormat().format(Number(value || 0));
}

function StatsRankList({ title, icon, items, emptyText }) {
  return (
    <article className="stats-rank-panel">
      <header>
        <div>{icon}</div>
        <span>{title}</span>
      </header>
      <div className="stats-rank-list">
        {items.length ? (
          items.slice(0, 5).map((item, index) => {
            const mediaItemId = getMediaItemId(item);
            const content = (
              <>
                <small>{index + 1}</small>
                <strong>{item.Name || item.Client || "Unknown"}</strong>
                <span>{formatNumber(getStatValue(item))}</span>
              </>
            );

            return mediaItemId ? (
              <Link key={mediaItemId} to={`/libraries/item/${mediaItemId}`} className="stats-rank-row">
                {content}
              </Link>
            ) : (
              <div key={item.Name || index} className="stats-rank-row">
                {content}
              </div>
            );
          })
        ) : (
          <p>{emptyText}</p>
        )}
      </div>
    </article>
  );
}

function StatsOverview({ days }) {
  const { isAdmin, permissions } = readAuth();
  const seesEveryone = isAdmin || Boolean(permissions.users);
  const [overview, setOverview] = useState({
    movies: [],
    series: [],
    libraries: [],
    users: [],
    clients: [],
    methods: [],
  });
  const [status, setStatus] = useState("loading");
  const token = localStorage.getItem("token");

  useEffect(() => {
    let ignore = false;

    async function fetchOverview() {
      setStatus("loading");

      try {
        const headers = {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        };
        const requests = [
          axios.post("/stats/getMostViewedByType", { days, type: "Movie" }, { headers }),
          axios.post("/stats/getMostViewedByType", { days, type: "Series" }, { headers }),
          axios.post("/stats/getMostViewedLibraries", { days }, { headers }),
          axios.post("/stats/getMostActiveUsers", { days }, { headers }),
          axios.post("/stats/getMostUsedClient", { days }, { headers }),
          axios.post("/stats/getPlaybackMethodStats", { days }, { headers }),
        ];

        const [movies, series, libraries, users, clients, methods] = await Promise.all(requests);

        if (!ignore) {
          setOverview({
            movies: movies.data || [],
            series: series.data || [],
            libraries: libraries.data || [],
            users: users.data || [],
            clients: clients.data || [],
            methods: methods.data || [],
          });
          setStatus("loaded");
        }
      } catch (error) {
        console.log(error);
        if (!ignore) setStatus("error");
      }
    }

    fetchOverview();
    const intervalId = setInterval(fetchOverview, 60000 * 5);

    return () => {
      ignore = true;
      clearInterval(intervalId);
    };
  }, [days, token]);

  const metrics = useMemo(() => {
    const totalMovies = overview.movies.reduce((sum, item) => sum + getStatValue(item), 0);
    const totalSeries = overview.series.reduce((sum, item) => sum + getStatValue(item), 0);
    const totalMethods = overview.methods.reduce((sum, item) => sum + getStatValue(item), 0);
    const directPlays = overview.methods
      .filter((item) => String(item.Name).toLowerCase() === "directplay")
      .reduce((sum, item) => sum + getStatValue(item), 0);
    const transcodes = overview.methods
      .filter((item) => String(item.Name).toLowerCase() === "transcode")
      .reduce((sum, item) => sum + getStatValue(item), 0);

    return {
      totalPlays: totalMovies + totalSeries,
      topLibrary: overview.libraries[0],
      topUser: overview.users[0],
      topClient: overview.clients[0],
      directPercent: totalMethods ? Math.round((directPlays / totalMethods) * 100) : 0,
      transcodePercent: totalMethods ? Math.round((transcodes / totalMethods) * 100) : 0,
    };
  }, [overview]);

  const methodTotal = overview.methods.reduce((sum, item) => sum + getStatValue(item), 0);
  const topCards = [
    { label: "Top library", value: metrics.topLibrary?.Name || "No data", detail: `${formatNumber(getStatValue(metrics.topLibrary))} plays`, icon: <BarChartFillIcon /> },
    {
      // Without the Users permission the API only returns the signed-in user's own entry.
      label: seesEveryone ? "Most active user" : "Your plays",
      value: metrics.topUser?.Name || "No data",
      detail: `${formatNumber(getStatValue(metrics.topUser))} plays`,
      icon: metrics.topUser?.UserId ? <img src={`/proxy/Users/Images/Primary?id=${metrics.topUser.UserId}&fillWidth=80&quality=80`} alt="" /> : <UserStarLineIcon />,
    },
    { label: "Top client", value: metrics.topClient?.Client || metrics.topClient?.Name || "No data", detail: `${formatNumber(getStatValue(metrics.topClient))} plays`, icon: <ComputerLineIcon /> },
  ];

  return (
    <section className="stats-overview">
      <div className="stats-overview-kpis" aria-label="Playback overview">
        <article>
          <FilmLineIcon />
          <span>Total plays</span>
          <strong>{status === "loading" ? "..." : formatNumber(metrics.totalPlays)}</strong>
        </article>
        <article>
          <TvLineIcon />
          <span>Direct play</span>
          <strong>{status === "loading" ? "..." : `${metrics.directPercent}%`}</strong>
        </article>
        <article>
          <PulseLineIcon />
          <span>Transcode</span>
          <strong>{status === "loading" ? "..." : `${metrics.transcodePercent}%`}</strong>
        </article>
        <article>
          <TimeLineIcon />
          <span>Window</span>
          <strong>{days} days</strong>
        </article>
      </div>

      {status === "error" ? <div className="stats-overview-error">Unable to load overview statistics.</div> : null}

      <div className="stats-overview-grid">
        <div className="stats-overview-panel stats-overview-panel-primary">
          <div className="stats-leader-grid">
            {topCards.map((card) => (
              <article key={card.label} className="stats-leader-card">
                <div>{card.icon}</div>
                <span>{card.label}</span>
                <strong>{card.value}</strong>
                <small>{card.detail}</small>
              </article>
            ))}
          </div>
          <div className="stats-rank-grid">
            <StatsRankList title="Movies" icon={<FilmLineIcon />} items={overview.movies} emptyText="No movie plays in this window." />
            <StatsRankList title="Shows" icon={<TvLineIcon />} items={overview.series} emptyText="No show plays in this window." />
          </div>
        </div>

        <div className="stats-overview-panel stats-method-panel">
          <div className="stats-section-heading">
            <p>Playback quality</p>
            <h2>Method split</h2>
          </div>
          <div className="stats-method-list">
            {overview.methods.length ? (
              overview.methods.map((method) => {
                const value = getStatValue(method);
                const percent = methodTotal ? Math.round((value / methodTotal) * 100) : 0;
                return (
                  <div key={method.Name} className="stats-method-row">
                    <span>{String(method.Name).replace("DirectPlay", "Direct Play").replace("DirectStream", "Direct Stream")}</span>
                    <strong>{formatNumber(value)}</strong>
                    <div>
                      <i style={{ width: `${percent}%` }} />
                    </div>
                    <small>{percent}%</small>
                  </div>
                );
              })
            ) : (
              <div className="stats-overview-empty">No playback method data for this window.</div>
            )}
          </div>
        </div>
      </div>

      <HomeStatisticCards days={days} variant="media-rankings" />
    </section>
  );
}

function Statistics() {
  const presets = [7, 30, 90];
  const [days, setDays] = useState(
    localStorage.getItem("PREF_STATISTICS_STAT_DAYS_INPUT") != undefined
      ? localStorage.getItem("PREF_STATISTICS_STAT_DAYS_INPUT")
      : localStorage.getItem("PREF_STATISTICS_STAT_DAYS") ?? 20
  );
  const [input, setInput] = useState(localStorage.getItem("PREF_STATISTICS_STAT_DAYS_INPUT") ?? 20);

  const handleOnChange = (event) => {
    setInput(event.target.value);
    localStorage.setItem("PREF_STATISTICS_STAT_DAYS_INPUT", event.target.value);
  };

  const storedTab = localStorage.getItem(`PREF_STATISTICS_LAST_SELECTED_TAB`);
  const [activeTab, setActiveTab] = useState(storedTab === "tabDuration" || storedTab === "tabCount" ? storedTab : "tabOverview");

  function setTab(tabName) {
    setActiveTab(tabName);
    localStorage.setItem(`PREF_STATISTICS_LAST_SELECTED_TAB`, tabName);
  }

  const applyDays = (value = input) => {
    const nextDays = Math.max(1, parseInt(value, 10) || 1);
    setInput(nextDays);
    setDays(nextDays);
    localStorage.setItem("PREF_STATISTICS_STAT_DAYS", nextDays);
    localStorage.setItem("PREF_STATISTICS_STAT_DAYS_INPUT", nextDays);
  };

  const handleKeyDown = (event) => {
    if (event.key === "Enter") {
      applyDays();
    }
  };

  const chartTitle = activeTab === "tabCount" ? "Playback counts" : "Watch duration";
  const chartDescription =
    activeTab === "tabCount"
      ? "Play count trends split by library, weekday, and hour."
      : "Watch-time trends split by library, weekday, and hour.";

  return (
    <div className="watch-stats">
      <div className="stats-page-header">
        <div className="stats-title-block">
          <div className="stats-title-icon">
            <BarChartFillIcon />
          </div>
          <div>
            <p className="stats-eyebrow">Playback analytics</p>
            <h1>
              <Trans i18nKey={"STAT_PAGE.STATISTICS"} />
            </h1>
            <p className="stats-subtitle">Library trends, daily activity, and watch-time patterns.</p>
          </div>
        </div>

        <div className="stats-controls">
          <div className="stats-tab-nav">
            <Tabs defaultActiveKey={activeTab} activeKey={activeTab} onSelect={setTab} variant="pills">
              <Tab eventKey="tabOverview" className="bg-transparent" title="Overview" />

              <Tab eventKey="tabCount" className="bg-transparent" title={<Trans i18nKey="STAT_PAGE.COUNT_VIEW" />} />

              <Tab eventKey="tabDuration" className="bg-transparent" title={<Trans i18nKey="STAT_PAGE.DURATION_VIEW" />} />
            </Tabs>
          </div>
          <div className="stats-range-panel">
            <div className="stats-range-label">
              <CalendarLineIcon size={17} />
              <span>
                <Trans i18nKey={"LAST"} />
              </span>
            </div>
            <div className="stats-presets">
              {presets.map((preset) => (
                <button
                  className={Number(days) === preset ? "active" : ""}
                  key={preset}
                  type="button"
                  onClick={() => applyDays(preset)}
                >
                  {preset}
                </button>
              ))}
            </div>
            <div className="stats-days-input">
              <input type="number" min={1} value={input} onChange={handleOnChange} onKeyDown={handleKeyDown} />
              <span>
                <Trans i18nKey={`UNITS.DAY${days > 1 ? "S" : ""}`} />
              </span>
            </div>
            <button className="stats-apply-button" type="button" onClick={() => applyDays()}>
              Apply
            </button>
          </div>
        </div>
      </div>

      <main className="stats-workbench">
        {activeTab === "tabOverview" && <StatsOverview days={days} />}

        {(activeTab === "tabCount" || activeTab === "tabDuration") && (
          <div className="statistics-dashboard">
            <div className="stats-chart-intro">
              <div>
                <p>Charts</p>
                <h2>{chartTitle}</h2>
                <span>{chartDescription}</span>
              </div>
              <strong>{days} day window</strong>
            </div>
            <DailyPlayStats days={days} viewName={activeTab === "tabCount" ? "count" : "duration"} />
            <LibraryHeatmap days={days} viewName={activeTab === "tabCount" ? "count" : "duration"} />
            <div className="statistics-graphs">
              <PlayStatsByDay days={days} viewName={activeTab === "tabCount" ? "count" : "duration"} />
              <PlayStatsByHour days={days} viewName={activeTab === "tabCount" ? "count" : "duration"} />
            </div>
            <HomeStatisticCards days={days} variant="media-rankings" />
          </div>
        )}
      </main>
    </div>
  );
}

export default Statistics;

import { useEffect, useState } from "react";
import axios from "../../../lib/axios_instance";
import { readAuth } from "../general/PageTabs";
import "../../css/statistics/library-heatmap.css";

const HOUR_LABELS = Array.from({ length: 24 }, (_, h) => (h % 3 === 0 ? String(h).padStart(2, "0") : ""));

function formatDuration(seconds) {
  const s = Number(seconds) || 0;
  if (s < 60) return `${s}s`;
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m`;
}

function formatValue(metric, value) {
  return metric === "plays" ? `${value} play${value === 1 ? "" : "s"}` : formatDuration(value);
}

function hourRange(hour) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(hour)}:00–${pad((hour + 1) % 24)}:00`;
}

export default function LibraryHeatmap({ days, viewName }) {
  const { isAdmin, permissions } = readAuth();
  const canPickUser = isAdmin || Boolean(permissions?.users);
  const metric = viewName === "count" ? "plays" : "seconds";
  const [userId, setUserId] = useState("");
  const [libraryId, setLibraryId] = useState("");
  const [users, setUsers] = useState([]);
  const [libraries, setLibraries] = useState([]);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [hover, setHover] = useState(null);

  useEffect(() => {
    axios
      .get("/api/getLibraries")
      .then((res) => setLibraries((res.data || []).filter((l) => !l.archived)))
      .catch(() => setLibraries([]));
    if (canPickUser) {
      axios
        .get("/stats/getAllUserActivity")
        .then((res) => setUsers((res.data || []).filter((u) => u.UserId)))
        .catch(() => setUsers([]));
    }
  }, [canPickUser]);

  useEffect(() => {
    const params = new URLSearchParams({ days: String(days), metric });
    if (userId) params.set("userId", userId);
    if (libraryId) params.set("libraryId", libraryId);
    let live = true;
    axios
      .get(`/stats/getLibraryHeatmap?${params}`)
      .then((res) => {
        if (!live) return;
        setData(res.data);
        setError(null);
      })
      .catch((err) => live && setError(err?.response?.data?.error || "Could not load the heat map"));
    return () => {
      live = false;
    };
  }, [days, metric, userId, libraryId]);

  const shown = hover || (data?.peak ? { day: data.peak.day, hour: data.peak.hour, peak: true } : null);
  const shownCell = shown && data ? data.cells[shown.day][shown.hour] : null;

  return (
    <section className="statistics-widget library-heatmap" aria-label="Watching heat map">
      <div className="library-heatmap-head">
        <h2 className="text-start my-2">When the household watches</h2>
        <div className="library-heatmap-filters">
          {canPickUser && (
            <select value={userId} onChange={(e) => setUserId(e.target.value)} aria-label="User">
              <option value="">Whole household</option>
              {users.map((u) => (
                <option key={u.UserId} value={u.UserId}>
                  {u.UserName}
                </option>
              ))}
            </select>
          )}
          <select value={libraryId} onChange={(e) => setLibraryId(e.target.value)} aria-label="Library">
            <option value="">All libraries</option>
            {libraries.map((l) => (
              <option key={l.Id} value={l.Id}>
                {l.Name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <p className="library-heatmap-sub">
        {metric === "plays" ? "Play count" : "Watch time"} by day and hour, last {days} day{days > 1 ? "s" : ""}
        {!canPickUser && " — just you"}
        {data?.timeZone ? ` · ${data.timeZone}` : ""}
      </p>

      {error && <div className="library-heatmap-empty">{error}</div>}
      {!error && !data && <div className="library-heatmap-empty">Loading…</div>}
      {!error && data && data.total === 0 && <div className="library-heatmap-empty">No playback in this window yet.</div>}

      {!error && data && data.total > 0 && (
        <>
          <div className="library-heatmap-scroll">
            <div className="library-heatmap-grid" role="grid" onMouseLeave={() => setHover(null)}>
              <span />
              {HOUR_LABELS.map((label, h) => (
                <span key={`h${h}`} className="library-heatmap-hour">
                  {label}
                </span>
              ))}
              {data.days.map((dayName, d) => (
                <div className="library-heatmap-row" role="row" key={dayName}>
                  <span className="library-heatmap-day">{dayName}</span>
                  {data.cells[d].map((cell, h) => (
                    <button
                      type="button"
                      key={h}
                      role="gridcell"
                      className={`library-heatmap-cell level-${cell.level}${shown && shown.day === d && shown.hour === h ? " active" : ""}`}
                      aria-label={`${dayName} ${hourRange(h)}: ${formatValue(metric, cell[metric])}`}
                      onMouseEnter={() => setHover({ day: d, hour: h })}
                      onFocus={() => setHover({ day: d, hour: h })}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>
          <div className="library-heatmap-foot">
            <div className="library-heatmap-detail">
              {shownCell && (
                <>
                  <strong>
                    {shown.peak ? "Busiest slot: " : ""}
                    {data.days[shown.day]} {hourRange(shown.hour)}
                  </strong>
                  <span>
                    {formatValue("plays", shownCell.plays)} · {formatDuration(shownCell.seconds)}
                  </span>
                </>
              )}
              {data.busiestDay && (
                <small>
                  Busiest day {data.busiestDay} · busiest hour {hourRange(data.busiestHour)}
                </small>
              )}
            </div>
            <div className="library-heatmap-legend" aria-hidden="true">
              <span>Less</span>
              {[0, 1, 2, 3, 4].map((l) => (
                <i key={l} className={`library-heatmap-cell level-${l}`} />
              ))}
              <span>More</span>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

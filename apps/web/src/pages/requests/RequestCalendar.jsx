/* eslint-disable react/prop-types */
// Calendar tab on the Requests page: requested titles arriving over seven days, with a
// day strip on top (counts per day, tap to filter) and the arrivals listed as rows.
// Dates come from Seerr and, when connected, the Sonarr and Radarr calendars.
import { useCallback, useEffect, useMemo, useState } from "react";
import ArrowLeftSLineIcon from "remixicon-react/ArrowLeftSLineIcon";
import ArrowRightSLineIcon from "remixicon-react/ArrowRightSLineIcon";
import ErrorWarningLineIcon from "remixicon-react/ErrorWarningLineIcon";
import RefreshLineIcon from "remixicon-react/RefreshLineIcon";
import axios from "../../lib/axios_instance";
import BlobboEmpty from "./BlobboEmpty";
import { CalendarCard, RequestSkeleton } from "./RequestCard";
import { dayHeading, dayNumber, rangeLabel, shiftDays, todayKey, visibleDays, weekdayLabel } from "./calendar";

const authHeaders = () => ({ Authorization: `Bearer ${localStorage.getItem("token")}` });

export default function RequestCalendar({ requests, onOpen }) {
  const today = useMemo(() => todayKey(), []);
  const [from, setFrom] = useState(today);
  const [picked, setPicked] = useState(null);
  const [state, setState] = useState({ loading: true, error: "", data: null });

  const load = useCallback(() => {
    setState((current) => ({ ...current, loading: true, error: "" }));
    axios
      .get("/api/requests/calendar", { headers: authHeaders(), params: { from, days: 7 } })
      .then((response) => setState({ loading: false, error: "", data: response.data }))
      .catch((error) => setState((current) => ({ ...current, loading: false, error: error.response?.data?.error || error.message || "Could not load the calendar" })));
  }, [from]);

  useEffect(() => {
    setPicked(null);
    load();
  }, [load]);

  const byId = useMemo(() => new Map((requests || []).map((request) => [request.id, request])), [requests]);
  const data = state.data;
  const days = data?.days || [];
  const shown = visibleDays(days, picked);
  const failedSources = (data?.sources || []).filter((source) => !source.ok);

  return (
    <section className="rq-cal" aria-busy={state.loading}>
      <div className="rq-cal-nav">
        <div className="rq-cal-step">
          <button type="button" className="rq-tool" onClick={() => setFrom(shiftDays(from, -7))} aria-label="Previous 7 days" title="Previous 7 days">
            <ArrowLeftSLineIcon size={18} />
          </button>
          <strong>{rangeLabel(from, shiftDays(from, 6))}</strong>
          <button type="button" className="rq-tool" onClick={() => setFrom(shiftDays(from, 7))} aria-label="Next 7 days" title="Next 7 days">
            <ArrowRightSLineIcon size={18} />
          </button>
        </div>
        <div className="rq-cal-step">
          <button type="button" className="rq-tool" onClick={() => setFrom(today)} disabled={from === today}>
            Today
          </button>
          <button type="button" className="rq-tool" onClick={load} disabled={state.loading} aria-label="Refresh" title="Refresh">
            <RefreshLineIcon size={16} className={state.loading ? "is-spinning" : ""} />
          </button>
        </div>
      </div>

      <div className="rq-cal-strip" role="group" aria-label="Days">
        {(days.length ? days : Array.from({ length: 7 }, (_, index) => ({ date: shiftDays(from, index), items: [] }))).map((day) => (
          <button
            key={day.date}
            type="button"
            className={`rq-cal-day${picked === day.date ? " is-active" : ""}${day.date === today ? " is-today" : ""}${day.items.length ? " has-items" : ""}`}
            aria-pressed={picked === day.date}
            onClick={() => setPicked((current) => (current === day.date ? null : day.date))}
          >
            <span>{weekdayLabel(day.date)}</span>
            <strong>{dayNumber(day.date)}</strong>
            <em>{day.items.length || "\u00a0"}</em>
          </button>
        ))}
      </div>

      {state.error && !data ? (
        <div className="rq-state is-error" role="alert">
          <ErrorWarningLineIcon size={32} />
          <strong>Couldn&rsquo;t load the calendar.</strong>
          <span>{state.error}</span>
          <button type="button" className="rq-btn is-primary" onClick={load}>
            <RefreshLineIcon size={16} />
            Try again
          </button>
        </div>
      ) : null}

      {state.loading && !data ? <RequestSkeleton view="list" count={3} /> : null}

      {data && !data.total ? (
        <BlobboEmpty title="Nothing arriving in this window.">Requested titles with a release or air date between {rangeLabel(from, shiftDays(from, 6))} will show up here.</BlobboEmpty>
      ) : null}

      {data && data.total
        ? shown.map((day) => (
            <div key={day.date} className="rq-cal-group">
              <h3>
                {dayHeading(day.date, today)}
                <em>{day.items.length}</em>
              </h3>
              {day.items.length ? (
                <div className="rq-board is-list">
                  {day.items.map((item) => (
                    <CalendarCard key={item.id} item={item} request={byId.get(item.requestId)} onOpen={onOpen} />
                  ))}
                </div>
              ) : (
                <p className="rq-cal-empty">Nothing arriving.</p>
              )}
            </div>
          ))
        : null}

      {data ? (
        <p className="rq-cal-sources">
          Dates from {(data.sources || []).filter((source) => source.ok).map((source) => source.name).join(", ") || "Seerr"}.
          {failedSources.length ? ` Not available: ${failedSources.map((source) => `${source.name} (${source.error || "unreachable"})`).join(", ")}.` : ""}
        </p>
      ) : null}
    </section>
  );
}

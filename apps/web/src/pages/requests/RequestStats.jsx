/* eslint-disable react/prop-types */
// Stats tab on the Requests page: headline numbers plus the most-requested genres and
// the busiest requesters, over a chosen window. Everything is computed by the API from
// the request list the page already shows.
import { useCallback, useEffect, useState } from "react";
import ErrorWarningLineIcon from "remixicon-react/ErrorWarningLineIcon";
import RefreshLineIcon from "remixicon-react/RefreshLineIcon";
import axios from "../../lib/axios_instance";
import BlobboEmpty from "./BlobboEmpty";
import { STAT_WINDOWS, barShare, headlineTiles } from "./stats";

function BarList({ title, rows, empty }) {
  const max = Math.max(0, ...rows.map((row) => row.count));
  return (
    <section className="rq-st-panel" aria-label={title}>
      <h3>{title}</h3>
      {rows.length ? (
        <ul>
          {rows.map((row) => (
            <li key={row.name}>
              <span className="rq-st-name" title={row.name}>{row.name}</span>
              <span className="rq-st-track" aria-hidden="true"><i style={{ width: `${barShare(row.count, max)}%` }} /></span>
              <b>{row.count}</b>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rq-st-empty">{empty}</p>
      )}
    </section>
  );
}

export default function RequestStats() {
  const [days, setDays] = useState(30);
  const [state, setState] = useState({ loading: true, error: "", data: null });

  const load = useCallback(() => {
    setState((current) => ({ ...current, loading: true, error: "" }));
    axios
      .get("/api/requests/stats", { headers: { Authorization: `Bearer ${localStorage.getItem("token")}` }, params: { days } })
      .then((response) => setState({ loading: false, error: "", data: response.data }))
      .catch((error) => setState((current) => ({ ...current, loading: false, error: error.response?.data?.error || error.message || "Could not load stats" })));
  }, [days]);

  useEffect(() => {
    load();
  }, [load]);

  const data = state.data;
  return (
    <section className="rq-st" aria-busy={state.loading}>
      <div className="rq-st-range" role="group" aria-label="Time window">
        {STAT_WINDOWS.map((window) => (
          <button key={window.days} type="button" className={days === window.days ? "is-active" : ""} aria-pressed={days === window.days} onClick={() => setDays(window.days)}>
            {window.label}
          </button>
        ))}
      </div>

      {state.error && !data ? (
        <div className="rq-state is-error" role="alert">
          <ErrorWarningLineIcon size={32} />
          <strong>Couldn&rsquo;t load stats.</strong>
          <span>{state.error}</span>
          <button type="button" className="rq-btn is-primary" onClick={load}>
            <RefreshLineIcon size={16} />
            Try again
          </button>
        </div>
      ) : null}

      {data && !data.total ? <BlobboEmpty title="No requests in this window.">Try a longer window to see the numbers.</BlobboEmpty> : null}

      {data && data.total ? (
        <>
          <div className="rq-st-tiles">
            {headlineTiles(data).map((tile) => (
              <div key={tile.key} className={`rq-st-tile is-${tile.key}`} title={tile.title || undefined}>
                <span>{tile.label}</span>
                <strong title={tile.value}>{tile.value}</strong>
                <small title={tile.hint}>{tile.hint}</small>
              </div>
            ))}
          </div>
          <div className="rq-st-panels">
            <BarList title="Most requested genres" rows={data.topGenres || []} empty="No genre data yet." />
            <BarList title="Who requests the most" rows={data.requesters || []} empty="No requests yet." />
          </div>
        </>
      ) : null}
    </section>
  );
}

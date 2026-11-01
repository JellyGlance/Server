import { useEffect, useMemo, useState } from "react";
import ClosedCaptioningLineIcon from "remixicon-react/ClosedCaptioningLineIcon";
import Search2LineIcon from "remixicon-react/Search2LineIcon";
import RefreshLineIcon from "remixicon-react/RefreshLineIcon";
import axios from "../lib/axios_instance";
import "./css/subtitle-gap.css";

const toText = (list) => (list || []).join(", ");
const langChips = (counts, files) =>
  Object.entries(counts || {}).map(([code, count]) => (
    <span key={code} className="sg-chip">
      {code.toUpperCase()}
      {files > 1 && <small>{count}/{files}</small>}
    </span>
  ));

export default function SubtitleGap() {
  const [subs, setSubs] = useState("");
  const [audio, setAudio] = useState("");
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("all");
  const [selected, setSelected] = useState({});
  const [status, setStatus] = useState({});

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const { data } = await axios.get("/subtitle-gap/report");
      setReport(data);
      setSubs(toText(data.prefs.subtitleLanguages));
      setAudio(toText(data.prefs.audioLanguages));
    } catch (err) {
      setError(err.response?.data?.error || "Unable to load the report");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const save = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      await axios.put("/subtitle-gap/settings", { subtitleLanguages: subs, audioLanguages: audio });
      setSelected({});
      setStatus({});
      await load();
    } catch (err) {
      setError(err.response?.data?.error || "Unable to save languages");
    } finally {
      setSaving(false);
    }
  };

  const rows = useMemo(() => {
    const items = report?.items || [];
    if (filter === "subs") return items.filter((i) => Object.keys(i.missingSubtitles).length);
    if (filter === "audio") return items.filter((i) => Object.keys(i.missingAudio).length);
    return items;
  }, [report, filter]);

  const search = async (items) => {
    if (!items.length) return;
    setStatus((current) => ({ ...current, ...Object.fromEntries(items.map((i) => [i.key, { status: "busy", message: "Searching…" }])) }));
    try {
      const { data } = await axios.post("/subtitle-gap/bazarr-search", { items: items.map(({ key, kind, title, year }) => ({ key, kind, title, year })) });
      setStatus((current) => ({ ...current, ...Object.fromEntries(data.results.map((r) => [r.key, r])) }));
      setSelected({});
    } catch (err) {
      const message = err.response?.data?.error || "Bazarr search failed";
      setStatus((current) => ({ ...current, ...Object.fromEntries(items.map((i) => [i.key, { status: "error", message }])) }));
    }
  };

  const bazarr = report?.bazarr?.configured;
  const chosen = rows.filter((r) => selected[r.key]);

  return (
    <div className="subtitle-gap">
      <section className="sg-hero">
        <ClosedCaptioningLineIcon />
        <div>
          <h1>Subtitle &amp; Audio Gaps</h1>
          <p>Titles missing your household&apos;s subtitle or audio languages, worked out from the tracks Jellyfin already knows about.</p>
        </div>
      </section>

      <form className="sg-settings" onSubmit={save}>
        <label>
          Preferred subtitle languages
          <input value={subs} onChange={(e) => setSubs(e.target.value)} placeholder="eng, fre" />
        </label>
        <label>
          Preferred audio languages
          <input value={audio} onChange={(e) => setAudio(e.target.value)} placeholder="eng" />
        </label>
        <button type="submit" className="sg-btn is-primary" disabled={saving}>{saving ? "Saving…" : "Save & rescan"}</button>
        <small>Use codes or names, e.g. en, eng, English, fr, deu. Separate with commas.</small>
      </form>

      {!loading && !bazarr && (
        <p className="sg-hint">
          Connect Bazarr under <a href="/integrations">Integrations</a> (URL and API key) to search for missing subtitles in one click.
        </p>
      )}
      {error && <p className="sg-error">{error}</p>}

      {report && (
        <div className="sg-summary">
          <div><strong>{report.summary.titles}</strong><span>titles with gaps</span></div>
          <div><strong>{report.summary.movies}</strong><span>movies</span></div>
          <div><strong>{report.summary.series}</strong><span>series</span></div>
          <div><strong>{report.summary.filesMissingSubtitles}</strong><span>files missing subtitles</span></div>
          <div><strong>{report.summary.filesMissingAudio}</strong><span>files missing audio</span></div>
          <div><strong>{report.scannedFiles}</strong><span>files scanned</span></div>
        </div>
      )}

      <div className="sg-toolbar">
        <div className="sg-filters">
          {[["all", "All"], ["subs", "Missing subtitles"], ["audio", "Missing audio"]].map(([id, label]) => (
            <button key={id} type="button" className={filter === id ? "is-active" : ""} onClick={() => setFilter(id)}>{label}</button>
          ))}
        </div>
        <div className="sg-actions">
          <button type="button" className="sg-btn" onClick={load} disabled={loading}><RefreshLineIcon /> Rescan</button>
          {bazarr && (
            <button type="button" className="sg-btn is-primary" disabled={!chosen.length} onClick={() => search(chosen)}>
              <Search2LineIcon /> Search selected in Bazarr{chosen.length ? ` (${chosen.length})` : ""}
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <p className="sg-empty">Scanning library…</p>
      ) : !rows.length ? (
        <p className="sg-empty">No gaps found. Every title has your preferred languages.</p>
      ) : (
        <table className="sg-table">
          <thead>
            <tr>
              {bazarr && (
                <th>
                  <input
                    type="checkbox"
                    aria-label="Select all"
                    checked={rows.slice(0, 50).every((r) => selected[r.key])}
                    onChange={(e) => setSelected(e.target.checked ? Object.fromEntries(rows.slice(0, 50).map((r) => [r.key, true])) : {})}
                  />
                </th>
              )}
              <th>Title</th>
              <th>Type</th>
              <th>Missing subtitles</th>
              <th>Missing audio</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const state = status[row.key];
              return (
                <tr key={row.key}>
                  {bazarr && (
                    <td><input type="checkbox" aria-label={`Select ${row.title}`} checked={!!selected[row.key]} onChange={(e) => setSelected((c) => ({ ...c, [row.key]: e.target.checked }))} /></td>
                  )}
                  <td>
                    <strong>{row.title}</strong>
                    {row.year && <span className="sg-year"> ({row.year})</span>}
                    {row.kind === "series" && <div className="sg-sub">{row.files} episode{row.files === 1 ? "" : "s"} · e.g. {row.examples.join(", ")}</div>}
                  </td>
                  <td>{row.kind === "series" ? "Series" : "Movie"}</td>
                  <td>{langChips(row.missingSubtitles, row.files)}</td>
                  <td>{langChips(row.missingAudio, row.files)}</td>
                  <td className="sg-row-action">
                    {bazarr ? (
                      <button type="button" className="sg-btn" disabled={state?.status === "busy"} onClick={() => search([row])}><Search2LineIcon /> Search in Bazarr</button>
                    ) : (
                      <span className="sg-sub">Bazarr not connected</span>
                    )}
                    {state && <div className={`sg-status is-${state.status}`}>{state.message}</div>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

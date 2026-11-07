import { useEffect, useMemo, useState } from "react";
import Tv2LineIcon from "remixicon-react/Tv2LineIcon";
import ExternalLinkLineIcon from "remixicon-react/ExternalLinkLineIcon";
import RefreshLineIcon from "remixicon-react/RefreshLineIcon";
import axios from "../lib/axios_instance";
import "./css/incomplete-seasons.css";

const episodeList = (numbers, missing) => {
  if (!numbers?.length) return `${missing} missing`;
  const shown = numbers.slice(0, 8).map((n) => `E${String(n).padStart(2, "0")}`).join(", ");
  return numbers.length > 8 ? `${shown} +${numbers.length - 8}` : shown;
};

export default function IncompleteSeasons() {
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const { data } = await axios.get("/incomplete-seasons/report");
      setReport(data);
    } catch (err) {
      setError(err.response?.data?.error || "Unable to load the report");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (report?.items || []).filter((item) => {
      if (q && !String(item.title).toLowerCase().includes(q)) return false;
      if (filter === "sonarr") return item.sonarrMatched;
      if (filter === "unmatched") return !item.sonarrMatched;
      return true;
    });
  }, [report, query, filter]);

  const sonarr = report?.sonarr;

  return (
    <div className="incomplete-seasons">
      <section className="is-hero">
        <Tv2LineIcon />
        <div>
          <h1>Incomplete Seasons</h1>
          <p>Series where a season holds fewer episodes than it should. Sonarr&apos;s aired episode counts are used when connected; otherwise gaps in episode numbering are flagged.</p>
        </div>
      </section>

      {!loading && sonarr && !sonarr.configured && (
        <p className="is-hint">
          Connect Sonarr under <a href="/integrations">Integrations</a> to compare against aired episode counts and open series straight in Sonarr. Until then only numbering gaps (e.g. E01, E02, E04) are detected.
        </p>
      )}
      {sonarr?.error && <p className="is-hint">{sonarr.error}. Showing numbering gaps only.</p>}
      {error && <p className="is-error">{error}</p>}

      {report && (
        <div className="is-summary">
          <div><strong>{report.summary.series}</strong><span>incomplete series</span></div>
          <div><strong>{report.summary.seasons}</strong><span>incomplete seasons</span></div>
          <div><strong>{report.summary.missingEpisodes}</strong><span>missing episodes</span></div>
          <div><strong>{report.scannedSeries}</strong><span>series scanned</span></div>
        </div>
      )}

      <div className="is-toolbar">
        <div className="is-filters">
          {[["all", "All"], ...(sonarr?.configured ? [["sonarr", "In Sonarr"], ["unmatched", "Not in Sonarr"]] : [])].map(([id, label]) => (
            <button key={id} type="button" className={filter === id ? "is-active" : ""} onClick={() => setFilter(id)}>{label}</button>
          ))}
          <input className="is-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter series…" aria-label="Filter series" />
        </div>
        <button type="button" className="is-btn" onClick={load} disabled={loading}><RefreshLineIcon /> Rescan</button>
      </div>

      {loading ? (
        <p className="is-empty">Checking seasons…</p>
      ) : !rows.length ? (
        <p className="is-empty">No incomplete seasons found.</p>
      ) : (
        <table className="is-table">
          <thead>
            <tr>
              <th>Series</th>
              <th>Incomplete seasons</th>
              <th>Missing</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key}>
                <td>
                  <strong>{row.title}</strong>
                  {row.year && <span className="is-sub"> ({row.year})</span>}
                  {row.library && <div className="is-sub">{row.library}</div>}
                </td>
                <td>
                  {row.seasons.map((s) => (
                    <div key={s.season} className="is-season">
                      <span className="is-chip">S{String(s.season).padStart(2, "0")}</span>
                      <span>{s.have}{s.expected ? ` / ${s.expected}` : ""} episodes</span>
                      <span className="is-sub">· missing {episodeList(s.missingNumbers, s.missing)}</span>
                      {s.source === "numbering" && <span className="is-tag" title="No Sonarr count; detected from gaps in episode numbers">gap</span>}
                    </div>
                  ))}
                </td>
                <td><span className="is-missing">{row.missing}</span></td>
                <td className="is-links">
                  {row.links.sonarr && <a className="is-btn is-primary" href={row.links.sonarr} target="_blank" rel="noopener noreferrer"><ExternalLinkLineIcon /> Open in {sonarr?.name || "Sonarr"}</a>}
                  {!row.links.sonarr && row.links.sonarrSearch && <a className="is-btn" href={row.links.sonarrSearch} target="_blank" rel="noopener noreferrer"><ExternalLinkLineIcon /> Add to {sonarr?.name || "Sonarr"}</a>}
                  {row.links.tvdb && <a className="is-btn" href={row.links.tvdb} target="_blank" rel="noopener noreferrer"><ExternalLinkLineIcon /> TVDB</a>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import FileCopy2LineIcon from "remixicon-react/FileCopy2LineIcon";
import ArrowUpCircleLineIcon from "remixicon-react/ArrowUpCircleLineIcon";
import RefreshLineIcon from "remixicon-react/RefreshLineIcon";
import SearchLineIcon from "remixicon-react/SearchLineIcon";
import StarFillIcon from "remixicon-react/StarFillIcon";
import ErrorWarningLineIcon from "remixicon-react/ErrorWarningLineIcon";
import DeleteBin6LineIcon from "remixicon-react/DeleteBin6LineIcon";
import TimeLineIcon from "remixicon-react/TimeLineIcon";
import axios from "../lib/axios_instance";
import "./css/library-tools.css";

const PAGE_SIZE = 50;

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value >= 1099511627776) return `${(value / 1099511627776).toFixed(1)} TB`;
  if (value >= 1073741824) return `${(value / 1073741824).toFixed(1)} GB`;
  if (value >= 1048576) return `${(value / 1048576).toFixed(0)} MB`;
  return value ? `${value} B` : "—";
}

function qualityLabel(copy) {
  return [copy.video?.resolution, copy.video?.hdr, copy.video?.codec, copy.audio?.format, copy.audio?.layout].filter(Boolean).join(" · ") || "No stream info";
}

function Poster({ id }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <span className="lt-poster is-empty" />;
  return <img className="lt-poster" alt="" loading="lazy" src={`/proxy/Items/Images/Primary?id=${id}&fillWidth=120&quality=60`} onError={() => setFailed(true)} />;
}

function LibrarySelect({ libraries, value, onChange }) {
  return (
    <label className="lt-field">
      <span>Library</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">All movie libraries</option>
        {libraries.map((library) => (
          <option key={library.id} value={library.id}>
            {library.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function Duplicates({ libraries }) {
  const [libraryId, setLibraryId] = useState("");
  const [crossOnly, setCrossOnly] = useState(false);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [showSuspect, setShowSuspect] = useState(false);
  const [notice, setNotice] = useState("");
  const [busyId, setBusyId] = useState("");

  const refreshSuspects = async () => {
    const ids = (data?.suspectTitles || []).flatMap((row) => row.items.map((item) => item.id));
    if (!ids.length) return;
    if (!window.confirm(`Ask your media server to re-read the metadata for ${ids.length} items? It replaces their current titles and details with what it finds online; artwork you set by hand is kept.`)) return;
    setBusyId("suspects");
    setError("");
    try {
      const { data: result } = await axios.post("/library-tools/refresh", { itemIds: ids });
      setNotice(`Refresh queued for ${result.refreshed} item${result.refreshed === 1 ? "" : "s"}${result.failed.length ? ` (${result.failed.length} failed)` : ""}. New titles show here after the next library sync.`);
    } catch (err) {
      setError(err.response?.data?.error || "Unable to refresh metadata");
    } finally {
      setBusyId("");
    }
  };

  const deleteCopy = async (group, copy) => {
    const kept = group.copies.find((row) => row.best);
    if (
      !window.confirm(
        `Delete this copy of “${group.name}” from ${copy.libraryName}?\n\n${qualityLabel(copy)} · ${formatBytes(copy.size)}\n\nThe file is deleted from disk. The ${kept?.libraryName || "best"} copy (${qualityLabel(kept || {})}) stays. If Radarr manages this copy it may download it again — unmonitor it there first.`
      )
    )
      return;
    setBusyId(copy.id);
    setError("");
    try {
      const { data: result } = await axios.post("/library-tools/duplicates/delete", { itemId: copy.id, confirm: true });
      setNotice(`Deleted the ${result.deleted.libraryName} copy of “${result.deleted.name}” (${formatBytes(result.deleted.size)} freed).`);
      await load();
    } catch (err) {
      setError(err.response?.data?.error || "Unable to delete that copy");
    } finally {
      setBusyId("");
    }
  };

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const { data: result } = await axios.get("/library-tools/duplicates", { params: { libraryId: libraryId || undefined, crossLibraryOnly: crossOnly ? 1 : undefined } });
      setData(result);
      setPage(0);
    } catch (err) {
      setError(err.response?.data?.error || "Unable to find duplicates");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [libraryId, crossOnly]);

  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (data?.groups || []).filter((group) => !needle || String(group.name).toLowerCase().includes(needle));
  }, [data, query]);
  const pageGroups = groups.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const pages = Math.max(1, Math.ceil(groups.length / PAGE_SIZE));

  return (
    <div className="lt-page">
      <section className="lt-hero">
        <FileCopy2LineIcon />
        <div>
          <h1>Duplicate finder</h1>
          <p>Movies stored more than once — same title, year and length — across or within your libraries. The best copy (resolution, HDR, audio, then size) is starred. Nothing is deleted from here.</p>
        </div>
      </section>

      <div className="lt-summary">
        <div>
          <strong>{data ? data.totals.groups : "—"}</strong>
          <span>titles with copies</span>
        </div>
        <div>
          <strong>{data ? data.totals.copies : "—"}</strong>
          <span>files involved</span>
        </div>
        <div className="is-accent">
          <strong>{data ? formatBytes(data.totals.reclaimableBytes) : "—"}</strong>
          <span>could be freed</span>
        </div>
      </div>

      <div className="lt-toolbar">
        <LibrarySelect libraries={libraries} value={libraryId} onChange={setLibraryId} />
        <label className="lt-field lt-grow">
          <span>Search</span>
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(0);
            }}
            placeholder="Filter by title"
          />
        </label>
        <label className="lt-check">
          <input type="checkbox" checked={crossOnly} onChange={(event) => setCrossOnly(event.target.checked)} />
          Only across different libraries
        </label>
        <button type="button" className="lt-btn" onClick={load} disabled={loading}>
          <RefreshLineIcon size={15} /> {loading ? "Scanning…" : "Rescan"}
        </button>
      </div>

      {error ? <p className="lt-banner is-error">{error}</p> : null}
      {notice ? <p className="lt-banner is-ok">{notice}</p> : null}

      {data?.suspectTitles?.length ? (
        <div className="lt-banner is-warn">
          <ErrorWarningLineIcon size={18} />
          <div>
            <strong>
              {data.suspectTitles.reduce((sum, row) => sum + row.count, 0)} movies have a title shared across many years, which usually means broken metadata:{" "}
              {data.suspectTitles.map((row) => `“${row.name}” (${row.count})`).join(", ")}.
            </strong>
            <button type="button" className="lt-link" onClick={() => setShowSuspect(!showSuspect)}>
              {showSuspect ? "Hide them" : "Show them"}
            </button>
            {showSuspect ? (
              <ul className="lt-suspect">
                {data.suspectTitles.flatMap((row) =>
                  row.items.map((item) => (
                    <li key={item.id}>
                      {item.name} ({item.year || "no year"}) · {item.libraryName} · {formatBytes(item.size)}
                    </li>
                  ))
                )}
              </ul>
            ) : null}
            <small>Refreshing makes your media server look them up again from their file and folder names.</small>
            <button type="button" className="lt-btn" disabled={busyId === "suspects"} onClick={refreshSuspects}>
              <RefreshLineIcon size={15} /> {busyId === "suspects" ? "Queuing…" : `Refresh metadata for these ${data.suspectTitles.reduce((sum, row) => sum + row.count, 0)}`}
            </button>
          </div>
        </div>
      ) : null}

      {data && !groups.length ? <p className="lt-muted">{query ? "No duplicates match that search." : "No duplicates found."}</p> : null}

      <div className="lt-groups">
        {pageGroups.map((group) => (
          <article className="lt-group" key={group.key}>
            <header>
              <div>
                <strong>
                  {group.name} {group.year ? <span>({group.year})</span> : null}
                </strong>
                <small>
                  {group.copies.length} copies · {group.libraries} {group.libraries === 1 ? "library" : "libraries"} · {formatBytes(group.totalBytes)} total
                </small>
              </div>
              <span className="lt-pill">{formatBytes(group.reclaimableBytes)} reclaimable</span>
            </header>
            <ul>
              {group.copies.map((copy) => (
                <li key={copy.id} className={copy.best ? "is-best" : ""}>
                  <Poster id={copy.id} />
                  <span className="lt-copy">
                    <strong>
                      {copy.best ? <StarFillIcon size={13} /> : null}
                      {copy.libraryName || "Unknown library"}
                    </strong>
                    <small>{qualityLabel(copy)}</small>
                  </span>
                  <span className="lt-copy-meta">
                    {copy.runtimeMinutes ? `${copy.runtimeMinutes} min · ` : ""}
                    {formatBytes(copy.size)}
                  </span>
                  {copy.best ? (
                    <span className="lt-keep">Keep</span>
                  ) : (
                    <button type="button" className="lt-icon-btn" title="Delete this copy" aria-label={`Delete the ${copy.libraryName} copy`} disabled={Boolean(busyId)} onClick={() => deleteCopy(group, copy)}>
                      <DeleteBin6LineIcon size={15} />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </article>
        ))}
      </div>

      {pages > 1 ? (
        <div className="lt-pager">
          <button type="button" className="lt-btn" disabled={page === 0} onClick={() => setPage(page - 1)}>
            Previous
          </button>
          <span>
            Page {page + 1} of {pages}
          </span>
          <button type="button" className="lt-btn" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>
            Next
          </button>
        </div>
      ) : null}
    </div>
  );
}

function Upgrades({ libraries }) {
  const [libraryId, setLibraryId] = useState("");
  const [minResolution, setMinResolution] = useState("1080p");
  const [requireSurround, setRequireSurround] = useState(false);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [picked, setPicked] = useState(() => new Set());
  const [searching, setSearching] = useState(false);
  const [schedule, setSchedule] = useState(null);

  useEffect(() => {
    axios
      .get("/library-tools/upgrades/schedule")
      .then(({ data: result }) => setSchedule(result))
      .catch(() => setSchedule(null));
  }, []);

  const saveSchedule = async (patch) => {
    try {
      const { data: result } = await axios.put("/library-tools/upgrades/schedule", { ...schedule, ...patch });
      setSchedule(result);
    } catch (err) {
      setError(err.response?.data?.error || "Unable to save the schedule");
    }
  };

  const runBatchNow = async () => {
    if (!window.confirm(`Ask Radarr to search for ${schedule.perNight} of the lowest-quality movies now?`)) return;
    try {
      const { data: result } = await axios.post("/library-tools/upgrades/schedule/run");
      setSchedule(result.schedule);
      setNotice(`Searched ${result.result?.searched || 0} movies${result.result?.failed ? `, ${result.result.failed} not found in Radarr` : ""}.`);
    } catch (err) {
      setError(err.response?.data?.error || "Unable to run the batch");
    }
  };

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const { data: result } = await axios.get("/library-tools/upgrades", {
        params: { libraryId: libraryId || undefined, minResolution, requireSurround: requireSurround ? 1 : undefined, limit: 2000 },
      });
      setData(result);
      setPage(0);
      setPicked(new Set());
    } catch (err) {
      setError(err.response?.data?.error || "Unable to find upgrade candidates");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [libraryId, minResolution, requireSurround]);

  const items = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (data?.items || []).filter((item) => !needle || String(item.name).toLowerCase().includes(needle));
  }, [data, query]);
  const pageItems = items.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const pages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));

  const toggle = (id) =>
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else if (next.size < 50) next.add(id);
      return next;
    });

  const search = async () => {
    if (!picked.size) return;
    if (!window.confirm(`Ask Radarr to search for better releases of ${picked.size} movie${picked.size === 1 ? "" : "s"}? Radarr only grabs one if it beats the current file under your quality profile.`)) return;
    setSearching(true);
    setError("");
    setNotice("");
    try {
      const { data: result } = await axios.post("/library-tools/upgrades/search", { itemIds: [...picked] });
      setNotice(`Search started for ${result.searched.length} movie${result.searched.length === 1 ? "" : "s"}.${result.failed.length ? ` ${result.failed.length} could not be matched in Radarr.` : ""}`);
      if (result.failed.length) setError(result.failed.slice(0, 5).map((row) => `${row.name}: ${row.error}`).join("; "));
      setPicked(new Set());
    } catch (err) {
      setError(err.response?.data?.error || "Unable to start the searches");
    } finally {
      setSearching(false);
    }
  };

  return (
    <div className="lt-page">
      <section className="lt-hero">
        <ArrowUpCircleLineIcon />
        <div>
          <h1>Quality upgrade finder</h1>
          <p>Movies below the resolution you choose, or without surround sound. Pick some and ask Radarr to search; it only replaces a file when it finds a release your quality profile prefers.</p>
        </div>
      </section>

      <div className="lt-summary">
        <div>
          <strong>{data ? data.total : "—"}</strong>
          <span>could be upgraded</span>
        </div>
        <div>
          <strong>{data ? data.scanned : "—"}</strong>
          <span>movies checked</span>
        </div>
        {data
          ? Object.entries(data.byResolution || {}).map(([label, count]) => (
              <div key={label}>
                <strong>{count}</strong>
                <span>{label}</span>
              </div>
            ))
          : null}
      </div>

      <div className="lt-toolbar">
        <LibrarySelect libraries={libraries} value={libraryId} onChange={setLibraryId} />
        <label className="lt-field">
          <span>At least</span>
          <select value={minResolution} onChange={(event) => setMinResolution(event.target.value)}>
            <option value="720p">720p</option>
            <option value="1080p">1080p</option>
            <option value="4K">4K</option>
          </select>
        </label>
        <label className="lt-check">
          <input type="checkbox" checked={requireSurround} onChange={(event) => setRequireSurround(event.target.checked)} />
          Also flag stereo / mono audio
        </label>
        <label className="lt-field lt-grow">
          <span>Search</span>
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(0);
            }}
            placeholder="Filter by title"
          />
        </label>
        <button type="button" className="lt-btn" onClick={load} disabled={loading}>
          <RefreshLineIcon size={15} /> {loading ? "Scanning…" : "Rescan"}
        </button>
        <button type="button" className="lt-btn is-primary" onClick={search} disabled={searching || !picked.size}>
          <SearchLineIcon size={15} /> {searching ? "Starting…" : `Search in Radarr (${picked.size})`}
        </button>
      </div>

      {schedule ? (
        <section className="lt-schedule">
          <TimeLineIcon size={20} />
          <div className="lt-schedule-body">
            <label className="lt-check">
              <input type="checkbox" checked={Boolean(schedule.enabled)} onChange={(event) => saveSchedule({ enabled: event.target.checked })} />
              <strong>Search a few every night</strong>
            </label>
            <span className="lt-schedule-row">
              Search
              <select value={schedule.perNight} onChange={(event) => saveSchedule({ perNight: Number(event.target.value) })}>
                {[5, 10, 20, 30, 50].map((count) => (
                  <option key={count} value={count}>
                    {count}
                  </option>
                ))}
              </select>
              movies below
              <select value={schedule.minResolution} onChange={(event) => saveSchedule({ minResolution: event.target.value })}>
                <option value="720p">720p</option>
                <option value="1080p">1080p</option>
                <option value="4K">4K</option>
              </select>
              at
              <select value={schedule.hour} onChange={(event) => saveSchedule({ hour: Number(event.target.value) })}>
                {Array.from({ length: 24 }, (_, hour) => (
                  <option key={hour} value={hour}>
                    {String(hour).padStart(2, "0")}:00
                  </option>
                ))}
              </select>
              , worst first. Each title is searched at most once every 60 days.
            </span>
            <small>
              {schedule.lastResult
                ? `Last run ${new Date(schedule.lastResult.at).toLocaleString()}: ${schedule.lastResult.searched} searched${schedule.lastResult.failed ? `, ${schedule.lastResult.failed} not in Radarr` : ""}.`
                : "Not run yet."}{" "}
              {schedule.searchedCount ? `${schedule.searchedCount} searched in the last 60 days.` : ""}
            </small>
          </div>
          <button type="button" className="lt-btn" onClick={runBatchNow}>
            Run a batch now
          </button>
        </section>
      ) : null}

      {error ? <p className="lt-banner is-error">{error}</p> : null}
      {notice ? <p className="lt-banner is-ok">{notice}</p> : null}
      {data?.missingStreamInfo ? <p className="lt-muted">{data.missingStreamInfo} movies have no stream information yet and were skipped.</p> : null}

      {data && !items.length ? <p className="lt-muted">Nothing to upgrade with these settings.</p> : null}

      {items.length ? (
        <div className="lt-table-wrap">
          <table className="lt-table">
            <thead>
              <tr>
                <th aria-label="Select" />
                <th>Movie</th>
                <th>Library</th>
                <th>Video</th>
                <th>Audio</th>
                <th>Size</th>
                <th>Why</th>
              </tr>
            </thead>
            <tbody>
              {pageItems.map((item) => (
                <tr key={item.id} className={picked.has(item.id) ? "is-picked" : ""} onClick={() => toggle(item.id)}>
                  <td>
                    <input type="checkbox" checked={picked.has(item.id)} onChange={() => toggle(item.id)} onClick={(event) => event.stopPropagation()} aria-label={`Select ${item.name}`} />
                  </td>
                  <td>
                    <span className="lt-title-cell">
                      <Poster id={item.id} />
                      <span>
                        {item.name}
                        {item.year ? <small> ({item.year})</small> : null}
                      </span>
                    </span>
                  </td>
                  <td>{item.libraryName}</td>
                  <td>
                    <span className={`lt-res is-${String(item.video.resolution).toLowerCase()}`}>{item.video.resolution}</span> {item.video.codec}
                  </td>
                  <td>{[item.audio.format, item.audio.layout].filter(Boolean).join(" ") || "—"}</td>
                  <td>{formatBytes(item.size)}</td>
                  <td className="lt-why">{item.reasons.join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {pages > 1 ? (
        <div className="lt-pager">
          <button type="button" className="lt-btn" disabled={page === 0} onClick={() => setPage(page - 1)}>
            Previous
          </button>
          <span>
            Page {page + 1} of {pages} · {items.length} movies
          </span>
          <button type="button" className="lt-btn" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>
            Next
          </button>
        </div>
      ) : null}
    </div>
  );
}

export default function LibraryTools({ mode = "duplicates" }) {
  const [libraries, setLibraries] = useState([]);
  useEffect(() => {
    axios
      .get("/library-tools/libraries")
      .then(({ data }) => setLibraries(data.libraries || []))
      .catch(() => setLibraries([]));
  }, []);
  return mode === "upgrades" ? <Upgrades libraries={libraries} /> : <Duplicates libraries={libraries} />;
}

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import axios from "../../../lib/axios_instance";
import Database2LineIcon from "remixicon-react/Database2LineIcon";
import "../../css/library/storage-by-library.css";

export function formatBytes(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  let size = bytes;
  let i = 0;
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024;
    i += 1;
  }
  return `${size >= 10 || i === 0 ? size.toFixed(0) : size.toFixed(1)} ${units[i]}`;
}

function lastPlayedLabel(item) {
  if (!item.lastPlayed) return "Never";
  const days = Math.floor((Date.now() - new Date(item.lastPlayed).getTime()) / 86400000);
  if (!Number.isFinite(days)) return "—";
  if (days < 1) return "Today";
  if (days < 60) return `${days}d ago`;
  if (days < 730) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

export function StorageByLibraryView({ data, defaultOpen = false }) {
  const { libraries = [], largest = [], totalBytes = 0, hintedCount = 0, hintedBytes = 0, rules = {} } = data;
  const [open, setOpen] = useState(defaultOpen);
  const max = Math.max(1, ...libraries.map((l) => l.bytes));
  if (!totalBytes) return null;

  return (
    <section className="storage-library" aria-label="Storage by library">
      <div className="storage-library-head">
        <Database2LineIcon size={18} />
        <span>Storage by library</span>
        <span className="storage-library-total">{formatBytes(totalBytes)} total</span>
      </div>
      <div className="storage-library-list">
        {libraries.map((lib) => (
          <div className="storage-library-row" key={lib.id}>
            <Link className="storage-library-name" to={`/libraries/${lib.id}`}>{lib.name}</Link>
            <span className="storage-library-bar"><span style={{ width: `${Math.max(lib.bytes ? 2 : 0, (lib.bytes / max) * 100)}%` }} /></span>
            <span className="storage-library-value">
              {formatBytes(lib.bytes)} · {Math.round((lib.share || 0) * 100)}% · {lib.items.toLocaleString()} titles
            </span>
          </div>
        ))}
      </div>

      {largest.length ? (
        <div className="storage-library-top">
          <button type="button" className="storage-library-toggle" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            {open ? "Hide" : "Show"} top {largest.length} largest titles
            {hintedCount ? <span className="storage-library-hinted">{hintedCount} worth a look · {formatBytes(hintedBytes)}</span> : null}
          </button>
          {open ? (
            <>
              <div className="storage-library-table" role="table" aria-label="Largest titles">
                <div className="storage-library-tr is-head" role="row">
                  <span role="columnheader">#</span>
                  <span role="columnheader">Title</span>
                  <span role="columnheader">Size</span>
                  <span role="columnheader">Plays</span>
                  <span role="columnheader">Last played</span>
                </div>
                {largest.map((item) => (
                  <div className="storage-library-tr" role="row" key={item.id}>
                    <span className="storage-library-rank" role="cell">{item.rank}</span>
                    <span className="storage-library-title" role="cell">
                      <Link to={`/libraries/item/${item.id}`}>{item.name}</Link>
                      {item.year ? <span className="storage-library-meta"> ({item.year})</span> : null}
                      <span className="storage-library-meta"> · {item.libraryName || item.type}{item.type === "Series" && item.files ? ` · ${item.files} episodes` : ""}</span>
                      {item.hints?.length ? (
                        <span className="storage-library-hints">
                          {item.hints.map((hint) => (
                            <span key={hint.code} className={`storage-library-hint hint-${hint.code}`}>{hint.label}</span>
                          ))}
                        </span>
                      ) : null}
                    </span>
                    <span className="storage-library-size" role="cell">{formatBytes(item.bytes)}</span>
                    <span role="cell">{Number(item.plays || 0).toLocaleString()}</span>
                    <span role="cell">{lastPlayedLabel(item)}</span>
                  </div>
                ))}
              </div>
              <p className="storage-library-note">
                Hints are only prompts to take a look: never played, not played in {Math.round((rules.staleDays || 730) / 365)}+ years, or a
                movie with the same name and year as another copy. Anything added in the last {rules.graceDays || 90} days is left alone. Nothing is
                deleted from here.
              </p>
            </>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

export default function StorageByLibrary({ token }) {
  const [data, setData] = useState(null);

  useEffect(() => {
    let cancelled = false;
    axios
      .get("/stats/getStorageByLibrary", { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => !cancelled && setData(res.data))
      .catch(() => !cancelled && setData(null));
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (!data) return null;
  return <StorageByLibraryView data={data} />;
}

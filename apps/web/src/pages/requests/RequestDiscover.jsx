/* eslint-disable react/prop-types */
// Discover tab on the Requests page: shelves of what Seerr suggests (recommended,
// just released, trending, popular, upcoming, genres, studios, networks). Each shelf
// is a wrapping grid of whole tiles, two full rows, and a "More" tile that opens two
// more. Shelves load as they scroll into view; a title opens the request dialog.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import CheckLineIcon from "remixicon-react/CheckLineIcon";
import ChatCheckFillIcon from "remixicon-react/ChatCheckFillIcon";
import EyeLineIcon from "remixicon-react/EyeLineIcon";
import ForbidLineIcon from "remixicon-react/ForbidLineIcon";
import MovieLineIcon from "remixicon-react/MovieLineIcon";
import StarFillIcon from "remixicon-react/StarFillIcon";
import Tv2LineIcon from "remixicon-react/Tv2LineIcon";
import axios from "../../lib/axios_instance";
import baseUrl from "../../lib/baseurl";
import BlobboEmpty from "./BlobboEmpty";
import { countColumns, visibleTiles } from "./discover-grid";
import { isPosterRatio, posterChain } from "./poster";
import { StatusChip } from "./RequestCard";
import "../css/request-discover.css";

const authHeaders = () => ({ Authorization: `Bearer ${localStorage.getItem("token")}` });

// Same chip names and colours as the request list.
const BADGES = {
  available: { label: "In library", tone: "available" },
  partial: { label: "Partial", tone: "partial" },
  pending: { label: "Pending", tone: "pending" },
  processing: { label: "Processing", tone: "processing" },
  blocked: { label: "Blocklisted", tone: "declined" },
};

// TMDB poster first, the library Primary image only as a fallback (see poster.js). The
// browser loads TMDB art itself, so it needs internet on the viewing device only.
export function posterSources(item) {
  return posterChain(item, baseUrl);
}

function useColumns(ref) {
  const [cols, setCols] = useState(0);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    const measure = () => {
      const style = getComputedStyle(node);
      const next = countColumns(node.clientWidth, parseFloat(style.getPropertyValue("--rd-min")) || 148, parseFloat(style.getPropertyValue("--rd-gap")) || 12);
      setCols((current) => (current === next ? current : next));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref]);
  return cols || 2;
}

function DiscoverPoster({ item }) {
  const sources = posterSources(item);
  const [index, setIndex] = useState(0);
  const src = sources[index];
  if (!src) {
    return <span className="rd-poster-empty">{item.mediaType === "tv" ? <Tv2LineIcon size={28} /> : <MovieLineIcon size={28} />}</span>;
  }
  return (
    <img
      key={src}
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      onLoad={(event) => {
        if (!isPosterRatio(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight)) setIndex((current) => current + 1);
      }}
      onError={() => setIndex((current) => current + 1)}
    />
  );
}

function RequestState({ item, blocked, readOnly, onOpen }) {
  if (blocked) {
    return (
      <button type="button" className="rd-request is-muted" disabled title="This Seerr connection is read-only in the demo">
        <ForbidLineIcon size={14} />
        Demo: request blocked
      </button>
    );
  }
  if (item.state === "available") {
    return (
      <button type="button" className="rd-request is-muted" disabled>
        <CheckLineIcon size={14} />
        In library
      </button>
    );
  }
  if (item.state === "partial" || item.state === "pending" || item.state === "processing") {
    return (
      <button type="button" className="rd-request is-muted" disabled>
        <CheckLineIcon size={14} />
        Requested
      </button>
    );
  }
  if (item.state === "blocked") {
    return (
      <button type="button" className="rd-request is-muted" disabled>
        <ForbidLineIcon size={14} />
        Unavailable
      </button>
    );
  }
  if (readOnly) {
    return (
      <button type="button" className="rd-request is-muted" disabled title="Requests are turned off in this read-only demo. Open the title to look at it.">
        <EyeLineIcon size={14} />
        View only
      </button>
    );
  }
  return (
    <button type="button" className="rd-request" onClick={(event) => onOpen(item, event)}>
      <ChatCheckFillIcon size={14} />
      Request
    </button>
  );
}

function DiscoverTile({ item, blocked, readOnly, onOpen }) {
  const badge = BADGES[item.state];
  const meta = [item.year, item.mediaType === "tv" ? "TV" : "Movie"].filter(Boolean).join(" \u00b7 ");
  return (
    <article
      className="rd-tile"
      role="button"
      tabIndex={0}
      onClick={(event) => onOpen(item, event)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen(item, event);
        }
      }}
    >
      <div className="rd-poster">
        <DiscoverPoster item={item} />
        {badge ? <StatusChip tone={badge.tone} label={badge.label} className="rd-badge" /> : null}
        {item.rating ? (
          <span className="rd-rating" title="TMDB rating">
            <StarFillIcon size={11} />
            {Number(item.rating).toFixed(1)}
          </span>
        ) : null}
      </div>
      <strong title={item.title}>{item.title}</strong>
      <small title={meta}>{meta}</small>
      <RequestState item={item} blocked={blocked} readOnly={readOnly} onOpen={onOpen} />
    </article>
  );
}

function SkeletonTiles({ count }) {
  return Array.from({ length: count }, (_, index) => (
    <div key={index} className="rd-tile is-loading" aria-hidden="true">
      <div className="rd-poster" />
      <span className="rd-line is-title" />
      <span className="rd-line is-meta" />
      <span className="rd-line is-button" />
    </div>
  ));
}

// Items of one shelf, paged from Seerr as the rows are opened.
function ItemTrack({ rowKey, chipId, sourceId, blockedIds, readOnly, onOpen, onSubtitle, nonce, cols }) {
  const [state, setState] = useState({ items: [], page: 0, hasMore: false, loading: true, error: "" });
  const [rows, setRows] = useState(2);

  const load = useCallback(
    async (page, append) => {
      setState((current) => ({ ...current, loading: true, error: "" }));
      try {
        const response = await axios.get("/api/requests/discover/row", {
          headers: authHeaders(),
          params: { key: rowKey, chipId: chipId ?? undefined, page, sourceId },
        });
        const data = response.data || {};
        if (data.because?.length) onSubtitle?.(`Because of ${data.because.join(", ")}`);
        setState((current) => {
          const known = new Set(append ? current.items.map((item) => item.id) : []);
          const fresh = (data.items || []).filter((item) => !known.has(item.id));
          return { items: append ? [...current.items, ...fresh] : fresh, page: data.page || page, hasMore: Boolean(data.hasMore), loading: false, error: "" };
        });
      } catch (error) {
        setState((current) => ({ ...current, loading: false, error: error.response?.data?.error || error.message || "Could not load this row" }));
      }
    },
    [rowKey, chipId, sourceId, onSubtitle]
  );

  useEffect(() => {
    setRows(2);
    load(1, false);
  }, [load, nonce]);

  // Opening more rows (or a wider screen) can need more titles than the page held.
  useEffect(() => {
    if (!state.loading && !state.error && state.hasMore && state.items.length < cols * rows) {
      load(state.page + 1, true);
    }
  }, [cols, rows, state.loading, state.error, state.hasMore, state.items.length, state.page, load]);

  if (state.error && !state.items.length) {
    return (
      <div className="rd-message is-error" role="alert">
        <span>{state.error}</span>
        <button type="button" className="rq-btn" onClick={() => load(1, false)}>
          Try again
        </button>
      </div>
    );
  }
  if (state.loading && !state.items.length) {
    return (
      <div className="rd-track" aria-busy="true">
        <SkeletonTiles count={cols * 2} />
      </div>
    );
  }
  if (!state.items.length) return <div className="rd-message">Nothing to show here right now.</div>;

  const { shown, more } = visibleTiles(state.items, cols, rows, state.hasMore);
  return (
    <div className="rd-track">
      {shown.map((item) => (
        <DiscoverTile key={item.id} item={item} blocked={blockedIds.has(item.id)} readOnly={readOnly} onOpen={onOpen} />
      ))}
      {more ? (
        <button type="button" className="rd-more" disabled={state.loading} onClick={() => setRows((current) => current + 2)}>
          {state.loading ? "Loading..." : "More"}
        </button>
      ) : null}
    </div>
  );
}

function DiscoverRow({ row, sourceId, blockedIds, readOnly, onOpen, nonce }) {
  const sectionRef = useRef(null);
  const gridRef = useRef(null);
  const cols = useColumns(gridRef);
  const [visible, setVisible] = useState(false);
  const [subtitle, setSubtitle] = useState("");
  const [chips, setChips] = useState(null);
  const [chipId, setChipId] = useState(null);
  const [chipError, setChipError] = useState("");

  useEffect(() => {
    const node = sectionRef.current;
    if (!node || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return undefined;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "300px 0px" }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || row.kind !== "chips") return;
    let cancelled = false;
    axios
      .get("/api/requests/discover/row", { headers: authHeaders(), params: { key: row.key, sourceId } })
      .then((response) => {
        if (cancelled) return;
        const list = response.data?.chips || [];
        setChips(list);
        setChipId((current) => current ?? list[0]?.id ?? null);
      })
      .catch((error) => !cancelled && setChipError(error.response?.data?.error || error.message || "Could not load this row"));
    return () => {
      cancelled = true;
    };
  }, [visible, row.kind, row.key, sourceId, nonce]);

  const trackProps = { sourceId, blockedIds, readOnly, onOpen, nonce, cols };
  return (
    <section className="rd-row" ref={sectionRef} aria-label={row.title}>
      <header>
        <h3>{row.title}</h3>
        {subtitle ? <span>{subtitle}</span> : null}
      </header>
      {row.kind === "chips" && chips ? (
        <div className="rd-chips" role="tablist" aria-label={row.title}>
          {chips.map((chip) => (
            <button key={chip.id} type="button" role="tab" aria-selected={chip.id === chipId} className={chip.id === chipId ? "is-active" : ""} onClick={() => setChipId(chip.id)}>
              {chip.name}
            </button>
          ))}
        </div>
      ) : null}
      <div ref={gridRef} className="rd-measure">
        {row.kind === "chips" ? (
          chipError ? (
            <div className="rd-message is-error" role="alert">{chipError}</div>
          ) : chipId != null ? (
            <ItemTrack key={`${row.key}-${chipId}`} rowKey={row.key} chipId={chipId} {...trackProps} />
          ) : (
            <div className="rd-track" aria-busy="true"><SkeletonTiles count={cols * 2} /></div>
          )
        ) : visible ? (
          <ItemTrack rowKey={row.key} onSubtitle={setSubtitle} {...trackProps} />
        ) : (
          <div className="rd-track" aria-busy="true"><SkeletonTiles count={cols * 2} /></div>
        )}
      </div>
    </section>
  );
}

export default function RequestDiscover({ blockedIds, onOpen, onReadOnly, readOnly = false, nonce = 0 }) {
  const [state, setState] = useState({ loading: true, error: "", rows: [], sourceId: undefined, readOnly: false });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState((current) => ({ ...current, loading: true, error: "" }));
    axios
      .get("/api/requests/discover", { headers: authHeaders() })
      .then((response) => {
        if (cancelled) return;
        const data = response.data || {};
        setState({ loading: false, error: "", rows: data.rows || [], sourceId: data.sourceId, readOnly: Boolean(data.readOnly) });
        onReadOnly?.(Boolean(data.readOnly));
      })
      .catch((error) => !cancelled && setState((current) => ({ ...current, loading: false, error: error.response?.data?.error || error.message || "Could not load Discover" })));
    return () => {
      cancelled = true;
    };
  }, [nonce, attempt, onReadOnly]);

  const viewOnly = readOnly || state.readOnly;

  if (state.loading) {
    return (
      <div className="rd-page" aria-busy="true">
        {[0, 1].map((index) => (
          <ShelfSkeleton key={index} />
        ))}
      </div>
    );
  }
  if (state.error) {
    return (
      <div className="rq-state is-error" role="alert">
        <ForbidLineIcon size={32} />
        <strong>Couldn&rsquo;t load Discover.</strong>
        <span>{state.error}</span>
        <button type="button" className="rq-btn is-primary" onClick={() => setAttempt((value) => value + 1)}>
          Try again
        </button>
      </div>
    );
  }
  if (!state.rows.length) {
    return <BlobboEmpty title="Nothing to browse yet.">Connect Seerr in Settings to see recommendations and new releases.</BlobboEmpty>;
  }

  return (
    <div className="rd-page">
      {state.rows.map((row) => (
        <DiscoverRow key={row.key} row={row} sourceId={state.sourceId} blockedIds={blockedIds} readOnly={viewOnly} onOpen={onOpen} nonce={nonce} />
      ))}
    </div>
  );
}

function ShelfSkeleton() {
  const ref = useRef(null);
  const cols = useColumns(ref);
  return (
    <section className="rd-row">
      <header>
        <span className="rd-line is-heading" />
      </header>
      <div ref={ref} className="rd-measure">
        <div className="rd-track">
          <SkeletonTiles count={cols * 2} />
        </div>
      </div>
    </section>
  );
}

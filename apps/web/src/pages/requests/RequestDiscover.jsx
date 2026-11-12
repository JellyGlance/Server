/* eslint-disable react/prop-types */
// Discover tab on the Requests page: separate shelves of what Seerr suggests (recommended,
// just released, trending, popular, upcoming, genres, studios, networks). Each shelf is one
// sideways row of 2:3 posters ending in a More tile; genres, studios and networks are chips
// that load a poster row. "See all" (or More) opens the section as a wrapping grid of whole
// rows with a Back control; the section is in the URL. Shelves load as they scroll into view;
// a title opens the request dialog.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import ArrowLeftSLineIcon from "remixicon-react/ArrowLeftSLineIcon";
import ArrowRightSLineIcon from "remixicon-react/ArrowRightSLineIcon";
import CheckLineIcon from "remixicon-react/CheckLineIcon";
import ChatCheckFillIcon from "remixicon-react/ChatCheckFillIcon";
import EyeLineIcon from "remixicon-react/EyeLineIcon";
import ForbidLineIcon from "remixicon-react/ForbidLineIcon";
import MovieLineIcon from "remixicon-react/MovieLineIcon";
import PlayFillIcon from "remixicon-react/PlayFillIcon";
import StarFillIcon from "remixicon-react/StarFillIcon";
import Tv2LineIcon from "remixicon-react/Tv2LineIcon";
import axios from "../../lib/axios_instance";
import baseUrl from "../../lib/baseurl";
import BlobboEmpty from "./BlobboEmpty";
import { countColumns, scrollEdges, scrollStep, visibleTiles } from "./discover-grid";
import { isPosterRatio, posterChain } from "./poster";
import { StatusChip } from "./RequestCard";
import { trailerTarget } from "./trailer";
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

function DiscoverTile({ item, blocked, readOnly, onOpen, onTrailer }) {
  const target = trailerTarget(item);
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
        {target && onTrailer ? (
          <button
            type="button"
            className="rd-play"
            aria-label={`Play trailer for ${item.title}`}
            title="Play trailer"
            onClick={(event) => {
              event.stopPropagation();
              onTrailer(target);
            }}
            onKeyDown={(event) => event.stopPropagation()}
          >
            <PlayFillIcon size={16} />
          </button>
        ) : null}
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
function ItemTrack({ rowKey, chipId, sourceId, blockedIds, readOnly, onOpen, onTrailer, onSubtitle, nonce, cols }) {
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
        <DiscoverTile key={item.id} item={item} blocked={blockedIds.has(item.id)} readOnly={readOnly} onOpen={onOpen} onTrailer={onTrailer} />
      ))}
      {more ? (
        <button type="button" className="rd-more" disabled={state.loading} onClick={() => setRows((current) => current + 2)}>
          {state.loading ? "Loading..." : "More"}
        </button>
      ) : null}
    </div>
  );
}

// Fires once, the first time the node is within 300px of the viewport.
function useVisibleOnce(ref) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const node = ref.current;
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
  }, [ref]);
  return visible;
}

// Genre, studio and network chips of a chip shelf. `preferred` is the chip a link asked for.
function useChips(row, enabled, sourceId, nonce, preferred) {
  const [state, setState] = useState({ chips: null, chipId: null, error: "" });
  useEffect(() => {
    if (!enabled || row.kind !== "chips") return undefined;
    let cancelled = false;
    axios
      .get("/api/requests/discover/row", { headers: authHeaders(), params: { key: row.key, sourceId } })
      .then((response) => {
        if (cancelled) return;
        const list = response.data?.chips || [];
        const wanted = list.find((chip) => String(chip.id) === String(preferred));
        setState((current) => ({ chips: list, chipId: current.chipId ?? wanted?.id ?? list[0]?.id ?? null, error: "" }));
      })
      .catch((error) => !cancelled && setState((current) => ({ ...current, error: error.response?.data?.error || error.message || "Could not load this row" })));
    return () => {
      cancelled = true;
    };
  }, [enabled, row.kind, row.key, sourceId, nonce, preferred]);
  return { ...state, setChipId: (chipId) => setState((current) => ({ ...current, chipId })) };
}

function ChipBar({ title, chips, chipId, onPick }) {
  return (
    <div className="rd-chips" role="tablist" aria-label={title}>
      {chips.map((chip) => (
        <button key={chip.id} type="button" role="tab" aria-selected={chip.id === chipId} className={chip.id === chipId ? "is-active" : ""} onClick={() => onPick(chip.id)}>
          {chip.name}
        </button>
      ))}
    </div>
  );
}

// One sideways row of tiles with snap points and, on desktop, arrows that hide at the ends.
function ShelfScroller({ children, itemsKey }) {
  const ref = useRef(null);
  const [edges, setEdges] = useState({ canPrev: false, canNext: false });

  const update = useCallback(() => {
    const node = ref.current;
    if (!node) return;
    const next = scrollEdges(node.scrollLeft, node.clientWidth, node.scrollWidth);
    setEdges((current) => (current.canPrev === next.canPrev && current.canNext === next.canNext ? current : next));
  }, []);

  useLayoutEffect(() => {
    update();
    const node = ref.current;
    if (!node || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, [update, itemsKey]);

  const move = (direction) => {
    const node = ref.current;
    const first = node?.firstElementChild;
    if (!node || !first) return;
    const gap = parseFloat(getComputedStyle(node).columnGap) || 0;
    node.scrollBy({ left: direction * scrollStep(node.clientWidth, first.offsetWidth, gap), behavior: "smooth" });
  };

  return (
    <div className="rd-shelf-wrap">
      <button type="button" className="rd-arrow is-prev" hidden={!edges.canPrev} aria-label="Scroll left" onClick={() => move(-1)}>
        <ArrowLeftSLineIcon size={22} />
      </button>
      <div ref={ref} className="rd-scroller" onScroll={update}>
        {children}
      </div>
      <button type="button" className="rd-arrow is-next" hidden={!edges.canNext} aria-label="Scroll right" onClick={() => move(1)}>
        <ArrowRightSLineIcon size={22} />
      </button>
    </div>
  );
}

// First page of a section as a single sideways row, ending in a More tile.
function ShelfTrack({ rowKey, chipId, sourceId, enabled, nonce, blockedIds, readOnly, onOpen, onTrailer, onSubtitle, onMore }) {
  const [state, setState] = useState({ items: [], hasMore: false, loading: true, error: "" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    setState((current) => ({ ...current, loading: true, error: "" }));
    axios
      .get("/api/requests/discover/row", { headers: authHeaders(), params: { key: rowKey, chipId: chipId ?? undefined, page: 1, sourceId } })
      .then((response) => {
        if (cancelled) return;
        const data = response.data || {};
        if (data.because?.length) onSubtitle?.(`Because of ${data.because.join(", ")}`);
        setState({ items: data.items || [], hasMore: Boolean(data.hasMore), loading: false, error: "" });
      })
      .catch((error) => !cancelled && setState((current) => ({ ...current, loading: false, error: error.response?.data?.error || error.message || "Could not load this row" })));
    return () => {
      cancelled = true;
    };
  }, [enabled, rowKey, chipId, sourceId, nonce, attempt, onSubtitle]);

  if (state.error && !state.items.length) {
    return (
      <div className="rd-message is-error" role="alert">
        <span>{state.error}</span>
        <button type="button" className="rq-btn" onClick={() => setAttempt((value) => value + 1)}>
          Try again
        </button>
      </div>
    );
  }
  if (!enabled || (state.loading && !state.items.length)) {
    return (
      <ShelfScroller itemsKey="loading">
        <SkeletonTiles count={8} />
      </ShelfScroller>
    );
  }
  if (!state.items.length) return <div className="rd-message">Nothing to show here right now.</div>;
  return (
    <ShelfScroller itemsKey={`${rowKey}-${chipId}-${state.items.length}`}>
      {state.items.map((item) => (
        <DiscoverTile key={item.id} item={item} blocked={blockedIds.has(item.id)} readOnly={readOnly} onOpen={onOpen} onTrailer={onTrailer} />
      ))}
      <button type="button" className="rd-more" onClick={onMore}>
        More
        <ArrowRightSLineIcon size={18} />
      </button>
    </ShelfScroller>
  );
}

function DiscoverShelf({ row, sourceId, blockedIds, readOnly, onOpen, onTrailer, onSection, nonce }) {
  const ref = useRef(null);
  const visible = useVisibleOnce(ref);
  const [subtitle, setSubtitle] = useState("");
  const chips = useChips(row, visible, sourceId, nonce);
  const isChips = row.kind === "chips";
  const ready = visible && (!isChips || chips.chipId != null);
  return (
    <section className="rd-row rd-shelf" ref={ref} aria-label={row.title}>
      <header>
        <div className="rd-head">
          <h3>{row.title}</h3>
          {subtitle ? <span>{subtitle}</span> : null}
        </div>
        <button type="button" className="rd-seeall" onClick={() => onSection(row.key, chips.chipId)} aria-label={`See all ${row.title}`}>
          See all
          <ArrowRightSLineIcon size={16} />
        </button>
      </header>
      {isChips && chips.chips ? <ChipBar title={row.title} chips={chips.chips} chipId={chips.chipId} onPick={chips.setChipId} /> : null}
      {chips.error ? (
        <div className="rd-message is-error" role="alert">{chips.error}</div>
      ) : (
        <ShelfTrack
          key={`${row.key}-${chips.chipId}`}
          rowKey={row.key}
          chipId={isChips ? chips.chipId : undefined}
          sourceId={sourceId}
          enabled={ready}
          nonce={nonce}
          blockedIds={blockedIds}
          readOnly={readOnly}
          onOpen={onOpen}
          onTrailer={onTrailer}
          onSubtitle={setSubtitle}
          onMore={() => onSection(row.key, chips.chipId)}
        />
      )}
    </section>
  );
}

// "See all": one section as the full wrapping grid, two whole rows at a time, with a Back control.
function DiscoverGrid({ row, sourceId, blockedIds, readOnly, onOpen, onTrailer, onBack, onChip, preferredChip, nonce }) {
  const gridRef = useRef(null);
  const cols = useColumns(gridRef);
  const [subtitle, setSubtitle] = useState("");
  const chips = useChips(row, true, sourceId, nonce, preferredChip);
  const isChips = row.kind === "chips";

  useEffect(() => {
    if (isChips && chips.chipId != null) onChip?.(chips.chipId);
  }, [isChips, chips.chipId, onChip]);

  const trackProps = { sourceId, blockedIds, readOnly, onOpen, onTrailer, nonce, cols };
  return (
    <section className="rd-row rd-full" aria-label={row.title}>
      <header>
        <button type="button" className="rd-back" onClick={onBack}>
          <ArrowLeftSLineIcon size={18} />
          Back
        </button>
        <div className="rd-head">
          <h3>{row.title}</h3>
          {subtitle ? <span>{subtitle}</span> : null}
        </div>
      </header>
      {isChips && chips.chips ? <ChipBar title={row.title} chips={chips.chips} chipId={chips.chipId} onPick={chips.setChipId} /> : null}
      <div ref={gridRef} className="rd-measure">
        {chips.error ? (
          <div className="rd-message is-error" role="alert">{chips.error}</div>
        ) : isChips && chips.chipId == null ? (
          <div className="rd-track" aria-busy="true"><SkeletonTiles count={cols * 2} /></div>
        ) : (
          <ItemTrack key={`${row.key}-${chips.chipId}`} rowKey={row.key} chipId={isChips ? chips.chipId : undefined} onSubtitle={setSubtitle} {...trackProps} />
        )}
      </div>
    </section>
  );
}

export default function RequestDiscover({ blockedIds, onOpen, onTrailer, onReadOnly, readOnly = false, nonce = 0, section = "", chip = "", onSection, onChip }) {
  const [state, setState] = useState({ loading: true, error: "", rows: [], sourceId: undefined, readOnly: false });
  const [attempt, setAttempt] = useState(0);
  const pageRef = useRef(null);
  const shownSection = useRef(section);

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
  const fullRow = section ? state.rows.find((row) => row.key === section) : null;

  // A link to a section that doesn't exist falls back to the shelves.
  useEffect(() => {
    if (!state.loading && !state.error && section && !fullRow) onSection?.("", "");
  }, [state.loading, state.error, section, fullRow, onSection]);

  // Opening or leaving a section starts at the top of Discover.
  useEffect(() => {
    if (shownSection.current === section) return;
    shownSection.current = section;
    pageRef.current?.scrollIntoView?.({ block: "start" });
  }, [section]);

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

  if (fullRow) {
    return (
      <div className="rd-page is-full" ref={pageRef}>
        <DiscoverGrid
          key={fullRow.key}
          row={fullRow}
          sourceId={state.sourceId}
          blockedIds={blockedIds}
          readOnly={viewOnly}
          onOpen={onOpen}
          onTrailer={onTrailer}
          onBack={() => onSection?.("", "")}
          onChip={onChip}
          preferredChip={chip}
          nonce={nonce}
        />
      </div>
    );
  }

  return (
    <div className="rd-page" ref={pageRef}>
      {state.rows.map((row) => (
        <DiscoverShelf key={row.key} row={row} sourceId={state.sourceId} blockedIds={blockedIds} readOnly={viewOnly} onOpen={onOpen} onTrailer={onTrailer} onSection={(key, chipId) => onSection?.(key, chipId)} nonce={nonce} />
      ))}
    </div>
  );
}

function ShelfSkeleton() {
  return (
    <section className="rd-row rd-shelf">
      <header>
        <div className="rd-head">
          <span className="rd-line is-heading" />
        </div>
      </header>
      <div className="rd-shelf-wrap">
        <div className="rd-scroller">
          <SkeletonTiles count={8} />
        </div>
      </div>
    </section>
  );
}

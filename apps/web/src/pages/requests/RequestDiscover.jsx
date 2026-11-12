/* eslint-disable react/prop-types */
// Discover tab on the Requests page: rows of what Seerr suggests (recommended,
// just released, trending, popular, upcoming, genres, studios, networks). Rows load
// as they scroll into view; a title opens the same request dialog the search uses.
import { useCallback, useEffect, useRef, useState } from "react";
import ArrowLeftSLineIcon from "remixicon-react/ArrowLeftSLineIcon";
import ArrowRightSLineIcon from "remixicon-react/ArrowRightSLineIcon";
import CheckLineIcon from "remixicon-react/CheckLineIcon";
import ChatCheckFillIcon from "remixicon-react/ChatCheckFillIcon";
import ForbidLineIcon from "remixicon-react/ForbidLineIcon";
import MovieLineIcon from "remixicon-react/MovieLineIcon";
import StarFillIcon from "remixicon-react/StarFillIcon";
import Tv2LineIcon from "remixicon-react/Tv2LineIcon";
import axios from "../../lib/axios_instance";
import baseUrl from "../../lib/baseurl";
import "../css/request-discover.css";

const authHeaders = () => ({ Authorization: `Bearer ${localStorage.getItem("token")}` });

const BADGES = {
  available: { label: "In library", tone: "is-available" },
  partial: { label: "Partial", tone: "is-partial" },
  pending: { label: "Pending", tone: "is-pending" },
  processing: { label: "Processing", tone: "is-processing" },
  blocked: { label: "Blocklisted", tone: "is-blocked" },
};

// Library art first (through the JellyGlance image route), then TMDB. The browser
// loads TMDB art itself, so it needs internet on the viewing device only.
export function posterSources(item) {
  const library = item.jellyfinItemId ? `${baseUrl}/proxy/Items/Images/Primary?id=${item.jellyfinItemId}&fillWidth=300&quality=80` : null;
  return [library, ...(item.posterUrls || [])].filter(Boolean);
}

function DiscoverPoster({ item }) {
  const sources = posterSources(item);
  const [index, setIndex] = useState(0);
  const src = sources[index];
  if (!src) {
    return <span className="rd-poster-empty">{item.mediaType === "tv" ? <Tv2LineIcon size={26} /> : <MovieLineIcon size={26} />}</span>;
  }
  return (
    <img
      key={src}
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      onError={() => setIndex((current) => (current < sources.length - 1 ? current + 1 : sources.length))}
    />
  );
}

function RequestState({ item, blocked, onOpen }) {
  if (blocked) {
    return (
      <button type="button" className="rd-request is-blocked" disabled title="This Seerr connection is read-only in the demo">
        <ForbidLineIcon size={14} />
        Demo: request blocked
      </button>
    );
  }
  if (item.state === "available") {
    return (
      <button type="button" className="rd-request is-done" disabled>
        <CheckLineIcon size={14} />
        In library
      </button>
    );
  }
  if (item.state === "partial" || item.state === "pending" || item.state === "processing") {
    return (
      <button type="button" className="rd-request is-done" disabled>
        <CheckLineIcon size={14} />
        Requested
      </button>
    );
  }
  if (item.state === "blocked") {
    return (
      <button type="button" className="rd-request is-done" disabled>
        <ForbidLineIcon size={14} />
        Unavailable
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

function DiscoverTile({ item, blocked, onOpen }) {
  const badge = BADGES[item.state];
  const meta = [item.year, item.mediaType === "tv" ? "TV" : "Movie"].filter(Boolean).join(" · ");
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
        {badge ? <span className={`rd-badge ${badge.tone}`}>{badge.label}</span> : null}
        {item.rating ? (
          <span className="rd-rating" title="TMDB rating">
            <StarFillIcon size={11} />
            {Number(item.rating).toFixed(1)}
          </span>
        ) : null}
      </div>
      <strong title={item.title}>{item.title}</strong>
      <small title={meta}>{meta}</small>
      <RequestState item={item} blocked={blocked} onOpen={onOpen} />
    </article>
  );
}

function RowSkeleton() {
  return (
    <div className="rd-track" aria-hidden="true">
      {Array.from({ length: 8 }, (_, index) => (
        <div key={index} className="rd-tile is-loading">
          <div className="rd-poster" />
        </div>
      ))}
    </div>
  );
}

// Items of one row; "More" at the end pulls the next Seerr page.
function ItemTrack({ rowKey, chipId, sourceId, blockedIds, onOpen, onSubtitle, nonce }) {
  const [state, setState] = useState({ items: [], page: 0, hasMore: false, loading: true, error: "" });
  const trackRef = useRef(null);

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
    load(1, false);
  }, [load, nonce]);

  function scrollBy(direction) {
    const track = trackRef.current;
    if (track) track.scrollBy({ left: direction * track.clientWidth * 0.85, behavior: "smooth" });
  }

  if (state.error && !state.items.length) return <div className="rd-message is-error">{state.error}</div>;
  if (state.loading && !state.items.length) return <RowSkeleton />;
  if (!state.items.length) return <div className="rd-message">Nothing to show here right now.</div>;

  return (
    <div className="rd-track-wrap">
      <button type="button" className="rd-arrow is-left" aria-label="Scroll left" onClick={() => scrollBy(-1)}>
        <ArrowLeftSLineIcon size={20} />
      </button>
      <div className="rd-track" ref={trackRef}>
        {state.items.map((item) => (
          <DiscoverTile key={item.id} item={item} blocked={blockedIds.has(item.id)} onOpen={onOpen} />
        ))}
        {state.hasMore ? (
          <button type="button" className="rd-more" disabled={state.loading} onClick={() => load(state.page + 1, true)}>
            {state.loading ? "Loading..." : "More"}
          </button>
        ) : null}
      </div>
      <button type="button" className="rd-arrow is-right" aria-label="Scroll right" onClick={() => scrollBy(1)}>
        <ArrowRightSLineIcon size={20} />
      </button>
    </div>
  );
}

function DiscoverRow({ row, sourceId, blockedIds, onOpen, nonce }) {
  const sectionRef = useRef(null);
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

  return (
    <section className="rd-row" ref={sectionRef} aria-label={row.title}>
      <header>
        <h3>{row.title}</h3>
        {subtitle ? <span>{subtitle}</span> : null}
      </header>
      {row.kind === "chips" ? (
        <>
          {chipError ? <div className="rd-message is-error">{chipError}</div> : null}
          {chips ? (
            <div className="rd-chips" role="tablist" aria-label={row.title}>
              {chips.map((chip) => (
                <button key={chip.id} type="button" role="tab" aria-selected={chip.id === chipId} className={chip.id === chipId ? "is-active" : ""} onClick={() => setChipId(chip.id)}>
                  {chip.name}
                </button>
              ))}
            </div>
          ) : null}
          {chipId != null ? <ItemTrack key={`${row.key}-${chipId}`} rowKey={row.key} chipId={chipId} sourceId={sourceId} blockedIds={blockedIds} onOpen={onOpen} nonce={nonce} /> : !chipError ? <RowSkeleton /> : null}
        </>
      ) : visible ? (
        <ItemTrack rowKey={row.key} sourceId={sourceId} blockedIds={blockedIds} onOpen={onOpen} onSubtitle={setSubtitle} nonce={nonce} />
      ) : (
        <RowSkeleton />
      )}
    </section>
  );
}

export default function RequestDiscover({ blockedIds, onOpen, onReadOnly, nonce = 0 }) {
  const [state, setState] = useState({ loading: true, error: "", rows: [], sourceId: undefined, readOnly: false, source: "" });

  useEffect(() => {
    let cancelled = false;
    setState((current) => ({ ...current, loading: true, error: "" }));
    axios
      .get("/api/requests/discover", { headers: authHeaders() })
      .then((response) => {
        if (cancelled) return;
        const data = response.data || {};
        setState({ loading: false, error: "", rows: data.rows || [], sourceId: data.sourceId, readOnly: Boolean(data.readOnly), source: data.source || "" });
        onReadOnly?.(Boolean(data.readOnly));
      })
      .catch((error) => !cancelled && setState((current) => ({ ...current, loading: false, error: error.response?.data?.error || error.message || "Could not load Discover" })));
    return () => {
      cancelled = true;
    };
  }, [nonce, onReadOnly]);

  if (state.loading) return <div className="rd-message">Loading Discover...</div>;
  if (state.error) return <div className="rd-message is-error">{state.error}</div>;

  return (
    <div className="rd-page">
      {state.readOnly ? (
        <div className="rd-banner">
          <ForbidLineIcon size={16} />
          Demo: {state.source || "Seerr"} is connected read-only. You can browse and open any title; requests are blocked.
        </div>
      ) : null}
      {state.rows.map((row) => (
        <DiscoverRow key={row.key} row={row} sourceId={state.sourceId} blockedIds={blockedIds} onOpen={onOpen} nonce={nonce} />
      ))}
    </div>
  );
}

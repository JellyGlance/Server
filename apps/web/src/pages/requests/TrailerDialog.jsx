/* eslint-disable react/prop-types */
// Plays a title's trailer in a youtube-nocookie embed. The video key comes from Seerr
// through our API; a title without one gets a plain "No trailer" message.
import { useEffect, useState } from "react";
import { Modal } from "react-bootstrap";
import CloseLineIcon from "remixicon-react/CloseLineIcon";
import FilmLineIcon from "remixicon-react/FilmLineIcon";
import axios from "../../lib/axios_instance";
import { safeEmbedUrl } from "./trailer";

export default function TrailerDialog({ target, onHide }) {
  const [state, setState] = useState({ loading: true, error: "", trailer: null });

  useEffect(() => {
    if (!target) return undefined;
    let cancelled = false;
    setState({ loading: true, error: "", trailer: null });
    axios
      .get("/api/requests/trailer", {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
        params: { sourceId: target.sourceId, mediaType: target.mediaType, mediaId: target.tmdbId },
      })
      .then((response) => !cancelled && setState({ loading: false, error: "", trailer: response.data?.trailer || null }))
      .catch((error) => !cancelled && setState({ loading: false, error: error.response?.data?.error || error.message || "Could not look up the trailer", trailer: null }));
    return () => {
      cancelled = true;
    };
  }, [target]);

  const embed = safeEmbedUrl(state.trailer?.embedUrl);
  return (
    <Modal show={Boolean(target)} onHide={onHide} centered size="lg" contentClassName="rq-trailer" aria-label="Trailer">
      <div className="rq-trailer-head">
        <strong title={target?.title}>{target?.title || "Trailer"}</strong>
        <button type="button" className="rq-tool" aria-label="Close" onClick={onHide}>
          <CloseLineIcon size={18} />
        </button>
      </div>
      <div className="rq-trailer-stage" aria-busy={state.loading}>
        {embed ? (
          <iframe
            title={state.trailer?.name || "Trailer"}
            src={embed}
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
            sandbox="allow-scripts allow-same-origin allow-presentation"
          />
        ) : (
          <div className={`rq-trailer-state${state.error ? " is-error" : ""}`} role={state.error ? "alert" : "status"}>
            <FilmLineIcon size={28} />
            <strong>{state.loading ? "Looking for a trailer\u2026" : state.error ? "Couldn\u2019t look up the trailer" : "No trailer"}</strong>
            <span>{state.loading ? "" : state.error || "Seerr doesn\u2019t have a trailer for this title."}</span>
          </div>
        )}
      </div>
      {embed && state.trailer?.name ? <p className="rq-trailer-name">{state.trailer.name}</p> : null}
    </Modal>
  );
}

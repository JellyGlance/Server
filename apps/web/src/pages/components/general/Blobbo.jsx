import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import "../../css/blobbo.css";

export const BLOBBO_HIDDEN_KEY = "jellyglance.blobbo.hidden";

const TIPS = [
  { text: "Active sessions live on Home. Peek there to see who is watching right now.", to: "/", label: "Go to Home" },
  { text: "Looking for a show or film? Libraries has everything grouped by type.", to: "/libraries", label: "Open Libraries" },
  { text: "Fresh arrivals land in Recently added.", to: "/recently-added", label: "See what is new" },
  { text: "Connect Wizarr, Tdarr or Maintainerr under 3rd party apps.", to: "/integrations", label: "Open 3rd party apps" },
  { text: "Tweak themes, notifications and more in Settings.", to: "/settings", label: "Open Settings" },
];

function usePrefersReducedMotion() {
  const query = "(prefers-reduced-motion: reduce)";
  const [reduced, setReduced] = useState(() => typeof window !== "undefined" && window.matchMedia?.(query).matches);
  useEffect(() => {
    const mql = window.matchMedia?.(query);
    if (!mql) return undefined;
    const onChange = (e) => setReduced(e.matches);
    mql.addEventListener?.("change", onChange);
    return () => mql.removeEventListener?.("change", onChange);
  }, []);
  return reduced;
}

export default function Blobbo({ enabled = true, defaultOpen = false }) {
  const navigate = useNavigate();
  const reducedMotion = usePrefersReducedMotion();
  const [hidden, setHidden] = useState(() => localStorage.getItem(BLOBBO_HIDDEN_KEY) === "true");
  const [open, setOpen] = useState(defaultOpen);
  const [tip, setTip] = useState(0);

  if (!enabled || hidden) return null;
  const current = TIPS[tip % TIPS.length];
  const src = reducedMotion ? "/blobbo/blobbo-still.png" : "/blobbo/blobbo-idle.gif";

  const hide = () => {
    localStorage.setItem(BLOBBO_HIDDEN_KEY, "true");
    setHidden(true);
  };

  return (
    <div className={`blobbo ${open ? "blobbo--open" : ""} ${reducedMotion ? "blobbo--still" : ""}`}>
      {open && (
        <div className="blobbo-bubble" role="dialog" aria-label="Blobbo tips">
          <div className="blobbo-bubble-title">Blobbo</div>
          <p className="blobbo-bubble-text">{current.text}</p>
          <div className="blobbo-bubble-actions">
            <button type="button" className="blobbo-btn blobbo-btn--primary" onClick={() => { navigate(current.to); setOpen(false); }}>
              {current.label}
            </button>
            <button type="button" className="blobbo-btn" onClick={() => setTip((t) => t + 1)}>Next tip</button>
            <button type="button" className="blobbo-btn blobbo-btn--ghost" onClick={hide}>Hide Blobbo</button>
          </div>
        </div>
      )}
      <button
        type="button"
        className="blobbo-avatar"
        aria-label={open ? "Close Blobbo" : "Open Blobbo tips"}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <img src={src} alt="" width="72" height="72" draggable="false" />
      </button>
    </div>
  );
}

import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { askBlobbo, STARTER_CHIPS } from "../../../lib/blobbo-intents";
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

const tipMessage = (i) => {
  const t = TIPS[i % TIPS.length];
  return { from: "blobbo", text: `Hi, I'm Blobbo! ${t.text} Ask me anything about your server, or pick a topic below.`, link: { to: t.to, label: t.label } };
};

export default function Blobbo({ enabled = true, defaultOpen = false }) {
  const navigate = useNavigate();
  const reducedMotion = usePrefersReducedMotion();
  const [hidden, setHidden] = useState(() => localStorage.getItem(BLOBBO_HIDDEN_KEY) === "true");
  const [open, setOpen] = useState(defaultOpen);
  const [tip, setTip] = useState(0);
  const [messages, setMessages] = useState(() => [tipMessage(0)]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, open]);

  if (!enabled || hidden) return null;
  const src = reducedMotion ? "/blobbo/blobbo-still.png" : "/blobbo/blobbo-idle.gif";

  const hide = () => {
    localStorage.setItem(BLOBBO_HIDDEN_KEY, "true");
    setHidden(true);
  };

  const ask = async (question, intentId) => {
    const q = String(question || "").trim();
    if (!q || busy) return;
    setInput("");
    setBusy(true);
    setMessages((m) => [...m, { from: "you", text: q }]);
    const reply = await askBlobbo(q, intentId);
    setMessages((m) => [...m, { from: "blobbo", ...reply }]);
    setBusy(false);
  };

  const nextTip = () => {
    const next = tip + 1;
    setTip(next);
    setMessages((m) => [...m, tipMessage(next)]);
  };

  return (
    <div className={`blobbo ${open ? "blobbo--open" : ""} ${reducedMotion ? "blobbo--still" : ""}`}>
      {open && (
        <div className="blobbo-bubble blobbo-chat" role="dialog" aria-label="Chat with Blobbo">
          <div className="blobbo-chat-header">
            <div className="blobbo-bubble-title">Blobbo</div>
            <div className="blobbo-chat-header-actions">
              <button type="button" className="blobbo-btn blobbo-btn--ghost" onClick={nextTip}>Tip</button>
              <button type="button" className="blobbo-btn blobbo-btn--ghost" onClick={hide}>Hide Blobbo</button>
              <button type="button" className="blobbo-icon-btn" aria-label="Close Blobbo" onClick={() => setOpen(false)}>×</button>
            </div>
          </div>
          <div className="blobbo-chat-messages" ref={scrollRef} aria-live="polite">
            {messages.map((m, i) => (
              <div key={i} className={`blobbo-msg blobbo-msg--${m.from}`}>
                {m.text && <p>{m.text}</p>}
                {m.lines?.length > 0 && (
                  <ul>{m.lines.map((l, j) => <li key={j}>{l}</li>)}</ul>
                )}
                {m.note && <p className="blobbo-msg-note">{m.note}</p>}
                {m.link && (
                  <button type="button" className="blobbo-btn blobbo-btn--primary" onClick={() => { navigate(m.link.to); setOpen(false); }}>
                    {m.link.label}
                  </button>
                )}
              </div>
            ))}
            {busy && <div className="blobbo-msg blobbo-msg--blobbo blobbo-typing">Blobbo is wobbling over to check…</div>}
          </div>
          <div className="blobbo-chips" role="list">
            {STARTER_CHIPS.map((c) => (
              <button key={c.id} type="button" role="listitem" className="blobbo-chip" disabled={busy} onClick={() => ask(c.label, c.id)}>
                {c.label}
              </button>
            ))}
          </div>
          <form className="blobbo-chat-input" onSubmit={(e) => { e.preventDefault(); ask(input); }}>
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about your server…"
              aria-label="Ask Blobbo a question"
              maxLength={200}
            />
            <button type="submit" className="blobbo-btn blobbo-btn--primary" disabled={busy || !input.trim()}>Send</button>
          </form>
        </div>
      )}
      <button
        type="button"
        className="blobbo-avatar"
        aria-label={open ? "Close Blobbo" : "Open Blobbo"}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <img src={src} alt="" width="72" height="72" draggable="false" />
      </button>
    </div>
  );
}

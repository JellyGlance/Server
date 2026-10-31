import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { askBlobbo, STARTER_CHIPS } from "../../../lib/blobbo-intents";
import { BLOBBO_HIDDEN_KEY, BLOBBO_SETTING_EVENT, isBlobboHidden } from "../../../lib/blobbo-settings";
import "../../css/blobbo.css";

const isTypingTarget = (el) => !!el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable);

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
  const [hidden, setHidden] = useState(isBlobboHidden);
  const [open, setOpen] = useState(defaultOpen);
  const [tip, setTip] = useState(0);
  const [messages, setMessages] = useState(() => [tipMessage(0)]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    const sync = () => setHidden(isBlobboHidden());
    const onStorage = (e) => { if (e.key === BLOBBO_HIDDEN_KEY) sync(); };
    window.addEventListener(BLOBBO_SETTING_EVENT, sync);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(BLOBBO_SETTING_EVENT, sync);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  // Shift+A says hello: opens Blobbo's chat and focuses the question box.
  // Ignored while typing in an input, textarea, select or editable area.
  useEffect(() => {
    if (!enabled || hidden) return undefined;
    const onKey = (e) => {
      if (!e.shiftKey || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      if (e.key !== "A" && e.key !== "a") return;
      if (isTypingTarget(e.target) || isTypingTarget(document.activeElement)) return;
      e.preventDefault();
      setOpen(true);
      setTimeout(() => inputRef.current?.focus(), 0);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled, hidden]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, open]);

  if (!enabled || hidden) return null;

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

  const renderLinks = (links, small) =>
    links?.length > 0 && (
      <div className={`blobbo-links${small ? " blobbo-links--line" : ""}`}>
        {links.map((l, k) =>
          l.href ? (
            <a key={k} className={`blobbo-btn ${small ? "blobbo-btn--ghost blobbo-btn--sm" : "blobbo-btn--primary"}`} href={l.href} target="_blank" rel="noopener noreferrer">
              {l.label} ↗
            </a>
          ) : (
            <button key={k} type="button" className={`blobbo-btn ${small ? "blobbo-btn--ghost blobbo-btn--sm" : "blobbo-btn--primary"}`} onClick={() => { navigate(l.to); setOpen(false); }}>
              {l.label}
            </button>
          ),
        )}
      </div>
    );

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
              <button type="button" className="blobbo-icon-btn" aria-label="Close Blobbo" onClick={() => setOpen(false)}>×</button>
            </div>
          </div>
          <div className="blobbo-chat-messages" ref={scrollRef} aria-live="polite">
            {messages.map((m, i) => (
              <div key={i} className={`blobbo-msg blobbo-msg--${m.from}`}>
                {m.text && <p>{m.text}</p>}
                {m.lines?.length > 0 && (
                  <ul>
                    {m.lines.map((l, j) =>
                      typeof l === "string" ? <li key={j}>{l}</li> : <li key={j}>{l.text}{renderLinks(l.links, true)}</li>,
                    )}
                  </ul>
                )}
                {m.note && <p className="blobbo-msg-note">{m.note}</p>}
                {renderLinks([...(m.links || []), ...(m.link ? [m.link] : [])])}
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
              ref={inputRef}
              placeholder="Ask about your server, or find a title…"
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
        aria-label={open ? "Close Blobbo" : "Open Blobbo (Shift+A)"}
        title={open ? "Close Blobbo" : "Say hello to Blobbo (Shift+A)"}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {reducedMotion ? (
          <img src="/blobbo/blobbo-still.png" alt="" width="72" height="72" draggable="false" />
        ) : (
          <picture>
            <source srcSet="/blobbo/blobbo-idle.webp" type="image/webp" />
            <img src="/blobbo/blobbo-idle.gif" alt="" width="72" height="72" draggable="false" />
          </picture>
        )}
      </button>
    </div>
  );
}

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import axios from "../../../lib/axios_instance";
import { askBlobbo, ALL_CHIPS, STARTER_CHIPS } from "../../../lib/blobbo-intents";
import { BLOBBO_HIDDEN_KEY, BLOBBO_SETTING_EVENT, isBlobboHidden } from "../../../lib/blobbo-settings";
import { BLOBBO_PREFS_EVENT, clearHistory, currentSeason, getFlag, getHistory, getPrefs, rememberQuestion, setFlag, setPref, speak } from "../../../lib/blobbo-prefs";
import { OPEN_WHATS_NEW_EVENT } from "../../../lib/events";
import { fetchActiveSessions, getCachedActiveSessions, subscribeActiveSessions } from "../../../lib/session-cache";
import { BLOBBO_REACT_DURATION_MS, decideSessionReaction, sessionKeys } from "../../../lib/blobbo-session-react";
import "../../css/blobbo.css";

const isTypingTarget = (el) => !!el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable);

// Tips go through i18n so translations can override them; English is the fallback.
const TIPS = [
  { key: "BLOBBO_TIPS.HOME", text: "Active sessions live on Home. Peek there to see who is watching right now.", to: "/", label: "Go to Home" },
  { key: "BLOBBO_TIPS.LIBRARIES", text: "Looking for a show or film? Libraries has everything grouped by type.", to: "/libraries", label: "Open Libraries" },
  { key: "BLOBBO_TIPS.RECENT", text: "Fresh arrivals land in Recently added.", to: "/recently-added", label: "See what is new" },
  { key: "BLOBBO_TIPS.INTEGRATIONS", text: "Connect Wizarr, Tdarr or Maintainerr under 3rd party apps.", to: "/integrations", label: "Open 3rd party apps" },
  { key: "BLOBBO_TIPS.SETTINGS", text: "Tweak themes, notifications and more in Settings.", to: "/settings", label: "Open Settings" },
  { key: "BLOBBO_TIPS.FIND", text: "Ask me \u201cfind Dune\u201d and I'll look through every library for you.", to: "/libraries", label: "Open Libraries" },
  { key: "BLOBBO_TIPS.BUFFERING", text: "If someone says it keeps buffering, ask me \u201cwhy is this buffering?\u201d", to: "/active-transcodes", label: "Open Active transcodes" },
  { key: "BLOBBO_TIPS.INSIGHTS", text: "Insights finds duplicates, unwatched giants and transcode trends.", to: "/insights", label: "Open Insights" },
];

const TOUR = [
  { to: "/", text: "This is Home. Live sessions, today's numbers and widgets for everything at a glance." },
  { to: "/libraries", text: "Libraries lists every library with counts and sizes. Click one to dig in." },
  { to: "/activity", text: "Activity is the full playback log: who watched what, when and how it played." },
  { to: "/statistics", text: "Statistics charts plays by day, hour, library, app and play method." },
  { to: "/insights", text: "Insights finds duplicates, unwatched giants and transcode trends." },
  { to: "/settings", text: "Settings is where you change themes, integrations and whether I'm shown. That's the tour!" },
];

const QUIZ = [
  { id: "focus", q: "What do you mostly use JellyGlance for?", options: [["server", "Keeping the server healthy"], ["people", "Seeing what people watch"], ["downloads", "Downloads and requests"]] },
  { id: "kidsSafe", q: "Do children use this dashboard? I can keep my answers family friendly.", options: [["yes", "Yes, keep it kids-safe"], ["no", "No, grown-ups only"]] },
  { id: "voice", q: "Shall I read my answers aloud?", options: [["yes", "Yes please"], ["no", "No thanks"]] },
];
const FOCUS_CHIPS = { server: ["health", "tasks", "mood"], people: ["sessions", "trending", "offline"], downloads: ["downloads", "failedDownloads", "requests"] };

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

const PIE_COLOURS = ["var(--primary-color, #9b6ac8)", "#5bc0be", "#f4a261", "#e76f51", "#8ab17d", "#8d99ae"];
function Pie({ slices }) {
  const total = slices.reduce((s, x) => s + x.value, 0) || 1;
  let acc = 0;
  const arcs = slices.map((s, i) => {
    const a0 = (acc / total) * Math.PI * 2;
    acc += s.value;
    const a1 = (acc / total) * Math.PI * 2;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const p = (a) => `${50 + 45 * Math.sin(a)} ${50 - 45 * Math.cos(a)}`;
    const d = slices.length === 1 ? "M 50 5 A 45 45 0 1 1 49.99 5 Z" : `M 50 50 L ${p(a0)} A 45 45 0 ${large} 1 ${p(a1)} Z`;
    return <path key={i} d={d} fill={PIE_COLOURS[i % PIE_COLOURS.length]}><title>{s.label}</title></path>;
  });
  return (
    <div className="blobbo-viz blobbo-pie">
      <svg viewBox="0 0 100 100" width="96" height="96" role="img" aria-label="Storage per library">{arcs}</svg>
      <ul>
        {slices.map((s, i) => (
          <li key={i}><span className="blobbo-swatch" style={{ background: PIE_COLOURS[i % PIE_COLOURS.length] }} />{s.label} ({Math.round((s.value / total) * 100)}%)</li>
        ))}
      </ul>
    </div>
  );
}
function Heat({ cells }) {
  const max = Math.max(1, ...cells.map((c) => c.value));
  return (
    <div className="blobbo-viz blobbo-heat" role="img" aria-label="Transcodes per day">
      {cells.map((c, i) => (
        <span key={i} title={c.label} style={{ opacity: c.value ? 0.25 + 0.75 * (c.value / max) : 0.08 }} />
      ))}
    </div>
  );
}

export default function Blobbo({ enabled = true, defaultOpen = false }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation();
  const reducedMotion = usePrefersReducedMotion();
  const [hidden, setHidden] = useState(isBlobboHidden);
  const [open, setOpen] = useState(defaultOpen);
  const [tip, setTip] = useState(() => Math.floor(Date.now() / 86400000) % TIPS.length);
  const [prefs, setPrefsState] = useState(getPrefs);
  const [history, setHistory] = useState(getHistory);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [moreTopics, setMoreTopics] = useState(false);
  const [showOptions, setShowOptions] = useState(false);
  const [teaser, setTeaser] = useState(null);
  const [mood, setMood] = useState(null);
  const [reaction, setReaction] = useState(null);
  const sessionKeysRef = useRef(null);
  const lastReactRef = useRef(0);
  const [tourStep, setTourStep] = useState(-1);
  const scrollRef = useRef(null);
  const inputRef = useRef(null);

  const tipText = useCallback((i) => {
    const tp = TIPS[i % TIPS.length];
    return { text: t(tp.key, { defaultValue: tp.text }), link: { to: tp.to, label: t(`${tp.key}_LINK`, { defaultValue: tp.label }) } };
  }, [t]);

  const pushBlobbo = (msg) => setMessages((m) => [...m, { from: "blobbo", ...msg }]);

  useEffect(() => {
    const sync = () => setHidden(isBlobboHidden());
    const onStorage = (e) => { if (e.key === BLOBBO_HIDDEN_KEY) sync(); };
    const onPrefs = () => { setPrefsState(getPrefs()); setHistory(getHistory()); };
    window.addEventListener(BLOBBO_SETTING_EVENT, sync);
    window.addEventListener(BLOBBO_PREFS_EVENT, onPrefs);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(BLOBBO_SETTING_EVENT, sync);
      window.removeEventListener(BLOBBO_PREFS_EVENT, onPrefs);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  // First greeting: welcome back after an upgrade, a tour for new installs, or the tip of the day.
  useEffect(() => {
    if (!enabled || hidden) return undefined;
    let cancelled = false;
    (async () => {
      let version = null;
      try {
        version = (await axios.get("/api/CheckForUpdates")).data?.current_version || null;
      } catch {
        /* version check is optional */
      }
      if (cancelled) return;
      const lastVersion = getFlag("lastVersion");
      if (version) setFlag("lastVersion", version);
      const today = new Date().toISOString().slice(0, 10);
      if (version && lastVersion && lastVersion !== version) {
        setTeaser({ kind: "welcome", text: `Welcome back! JellyGlance is now on ${version}. Fancy a look at what's new?` });
      } else if (!getFlag("tourDone") && !getHistory().length && !lastVersion) {
        setTeaser({ kind: "tour", text: "Hello, I'm Blobbo! New here? I can show you around in six quick stops." });
      } else if (getFlag("tipDay") !== today) {
        setFlag("tipDay", today);
        setTeaser({ kind: "tip", text: `Tip of the day: ${tipText(tip).text}` });
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, hidden]);

  // Idle reacts to live sessions: wave when playback starts, look over when another stream joins.
  useEffect(() => {
    if (!enabled || hidden) return undefined;
    let clearTimer = null;
    const onSessions = (sessions) => {
      const next = sessionKeys(sessions);
      const now = Date.now();
      const kind = decideSessionReaction(sessionKeysRef.current, next, lastReactRef.current, now);
      sessionKeysRef.current = next;
      if (!kind) return;
      lastReactRef.current = now;
      setReaction(kind);
      clearTimeout(clearTimer);
      clearTimer = setTimeout(() => setReaction(null), BLOBBO_REACT_DURATION_MS);
    };
    const cached = getCachedActiveSessions();
    if (cached) onSessions(cached);
    const unsubscribe = subscribeActiveSessions(onSessions);
    const poll = () => {
      if (document.hidden || !localStorage.getItem("token")) return;
      fetchActiveSessions().catch(() => {});
    };
    const id = setInterval(poll, 30000);
    return () => { unsubscribe(); clearInterval(id); clearTimeout(clearTimer); };
  }, [enabled, hidden]);

  // Mood follows server health, checked every five minutes.
  useEffect(() => {
    if (!enabled || hidden) return undefined;
    const check = () => axios.get("/api/health").then((r) => setMood(r.data?.ok ? "happy" : "worried")).catch(() => setMood(null));
    check();
    const id = setInterval(check, 300000);
    return () => clearInterval(id);
  }, [enabled, hidden]);

  useEffect(() => {
    if (!enabled || hidden) return undefined;
    const onKey = (e) => {
      if (!e.shiftKey || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      if (e.key !== "A" && e.key !== "a") return;
      if (isTypingTarget(e.target) || isTypingTarget(document.activeElement)) return;
      e.preventDefault();
      openChat();
      setTimeout(() => inputRef.current?.focus(), 0);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, hidden, messages.length]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, open, showOptions]);

  if (!enabled || hidden) return null;

  const greeting = () => {
    const tp = tipText(tip);
    return { text: `Hi, I'm Blobbo! ${tp.text} Ask me anything about your server, or pick a topic below.`, link: tp.link };
  };

  function openChat() {
    setOpen(true);
    setTeaser(null);
    setMessages((m) => (m.length ? m : [{ from: "blobbo", ...greeting() }]));
  }

  const startTour = (step = 0) => {
    setTourStep(step);
    if (step >= TOUR.length) {
      setFlag("tourDone", true);
      setTourStep(-1);
      pushBlobbo({ text: "Tour finished! Ask me anything, or press Shift+A whenever you need me." });
      return;
    }
    const s = TOUR[step];
    navigate(s.to);
    pushBlobbo({ text: `Stop ${step + 1} of ${TOUR.length}: ${s.text}`, tour: step });
  };

  const startQuiz = (step = 0, answers = {}) => {
    if (step >= QUIZ.length) {
      setFlag("quiz", answers);
      setPref("kidsSafe", answers.kidsSafe === "yes");
      setPref("voice", answers.voice === "yes");
      pushBlobbo({ text: "Thanks! I've set things up for you. You can change these any time under Options.", quizChips: FOCUS_CHIPS[answers.focus] || [] });
      return;
    }
    pushBlobbo({ text: `Question ${step + 1} of ${QUIZ.length}: ${QUIZ[step].q}`, quiz: { step, answers } });
  };

  const handleAction = (action) => {
    if (action === "tour") startTour(0);
    else if (action === "quiz") startQuiz(0);
    else if (action === "options") {
      setShowOptions(true);
      pushBlobbo({ text: "Here are my options. They're saved in this browser only." });
    }
  };

  const ask = async (question, intentId) => {
    const q = String(question || "").trim();
    if (!q || busy) return;
    setInput("");
    setBusy(true);
    setMessages((m) => [...m, { from: "you", text: q }]);
    setHistory(rememberQuestion(q, intentId));
    const reply = await askBlobbo(q, intentId, { path: location.pathname });
    setBusy(false);
    if (reply.action) {
      handleAction(reply.action);
      return;
    }
    if (reply.mood) setMood(reply.mood);
    pushBlobbo(reply);
    if (getPrefs().voice) speak([reply.text, ...(reply.lines || []).slice(0, 3).map((l) => (typeof l === "string" ? l : l.text))].filter(Boolean).join(". "));
  };

  const chipFor = (id) => ALL_CHIPS.find((c) => c.id === id);

  const renderLinks = (links, small) =>
    links?.length > 0 && (
      <div className={`blobbo-links${small ? " blobbo-links--line" : ""}`}>
        {links.map((l, k) =>
          l.href ? (
            <a key={k} className={`blobbo-btn ${small ? "blobbo-btn--ghost blobbo-btn--sm" : "blobbo-btn--primary"}`} href={l.href} target="_blank" rel="noopener noreferrer">
              {l.label} ↗
            </a>
          ) : (
            <button key={k} type="button" className={`blobbo-btn ${small ? "blobbo-btn--ghost blobbo-btn--sm" : "blobbo-btn--primary"}`} onClick={() => { navigate(l.to); if (tourStep < 0) setOpen(false); }}>
              {l.label}
            </button>
          ),
        )}
      </div>
    );

  const renderChips = (chips, className = "") => (
    <div className={`blobbo-chips ${className}`} role="list">
      {chips.map((c) => (
        <button key={c.id} type="button" role="listitem" className="blobbo-chip" disabled={busy} onClick={() => ask(c.label, c.id)}>
          {c.label}
        </button>
      ))}
    </div>
  );

  const season = prefs.seasonal ? currentSeason() : null;
  const lastIndex = messages.length - 1;
  const quizChips = (ids) => ids.map(chipFor).filter(Boolean);

  const toggle = (name) => setPref(name, !prefs[name]);

  return (
    <div className={`blobbo ${open ? "blobbo--open" : ""} ${reducedMotion ? "blobbo--still" : ""} ${mood ? `blobbo--mood-${mood}` : ""} ${season ? `blobbo--season-${season.id}` : ""} ${reaction ? `blobbo--react-${reaction}` : ""}`}>
      {!open && teaser && (
        <div className="blobbo-bubble blobbo-teaser" role="status">
          <div className="blobbo-bubble-title">Blobbo</div>
          <p className="blobbo-bubble-text">{teaser.text}</p>
          <div className="blobbo-bubble-actions">
            {teaser.kind === "welcome" && <button type="button" className="blobbo-btn blobbo-btn--primary" onClick={() => { window.dispatchEvent(new Event(OPEN_WHATS_NEW_EVENT)); setTeaser(null); }}>What&rsquo;s new</button>}
            {teaser.kind === "tour" && <button type="button" className="blobbo-btn blobbo-btn--primary" onClick={() => { openChat(); startTour(0); }}>Take the tour</button>}
            {teaser.kind === "tour" && <button type="button" className="blobbo-btn" onClick={() => { openChat(); startQuiz(0); }}>Quick quiz</button>}
            {teaser.kind === "tip" && <button type="button" className="blobbo-btn blobbo-btn--primary" onClick={openChat}>Ask Blobbo</button>}
            <button type="button" className="blobbo-btn blobbo-btn--ghost" onClick={() => { setTeaser(null); if (teaser.kind === "tour") setFlag("tourDone", true); }}>Not now</button>
          </div>
        </div>
      )}
      {open && (
        <div className="blobbo-bubble blobbo-chat" role="dialog" aria-label="Chat with Blobbo">
          <div className="blobbo-chat-header">
            <div className="blobbo-bubble-title">
              Blobbo{mood && <span className={`blobbo-mood-dot blobbo-mood-dot--${mood}`} title={mood === "happy" ? "Feeling bouncy: the server is healthy" : "A bit wobbly: some health checks need a look"} />}
            </div>
            <div className="blobbo-chat-header-actions">
              <button type="button" className="blobbo-btn blobbo-btn--ghost" onClick={() => { const n = tip + 1; setTip(n); pushBlobbo(tipText(n)); }}>Tip</button>
              <button type="button" className="blobbo-btn blobbo-btn--ghost" aria-pressed={showOptions} onClick={() => setShowOptions((s) => !s)}>Options</button>
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
                {m.viz?.type === "pie" && <Pie slices={m.viz.slices} />}
                {m.viz?.type === "heat" && <Heat cells={m.viz.cells} />}
                {m.note && <p className="blobbo-msg-note">{m.note}</p>}
                {renderLinks([...(m.links || []), ...(m.link ? [m.link] : [])])}
                {i === lastIndex && m.tour !== undefined && tourStep === m.tour && (
                  <div className="blobbo-bubble-actions">
                    <button type="button" className="blobbo-btn blobbo-btn--primary" onClick={() => startTour(m.tour + 1)}>{m.tour + 1 < TOUR.length ? "Next stop" : "Finish"}</button>
                    <button type="button" className="blobbo-btn blobbo-btn--ghost" onClick={() => { setTourStep(-1); setFlag("tourDone", true); pushBlobbo({ text: "No problem. Say \u201cshow me around\u201d whenever you fancy the tour." }); }}>End tour</button>
                  </div>
                )}
                {i === lastIndex && m.quiz && (
                  <div className="blobbo-bubble-actions">
                    {QUIZ[m.quiz.step].options.map(([value, label]) => (
                      <button key={value} type="button" className="blobbo-btn" onClick={() => { setMessages((x) => [...x, { from: "you", text: label }]); startQuiz(m.quiz.step + 1, { ...m.quiz.answers, [QUIZ[m.quiz.step].id]: value }); }}>{label}</button>
                    ))}
                  </div>
                )}
                {i === lastIndex && m.quizChips?.length > 0 && renderChips(quizChips(m.quizChips), "blobbo-chips--inline")}
                {i === lastIndex && m.followUps?.length > 0 && (
                  <div className="blobbo-followups">
                    <span className="blobbo-msg-note">Ask next:</span>
                    {renderChips(m.followUps, "blobbo-chips--inline")}
                  </div>
                )}
              </div>
            ))}
            {busy && <div className="blobbo-msg blobbo-msg--blobbo blobbo-typing">Blobbo is wobbling over to check…</div>}
            {showOptions && (
              <div className="blobbo-msg blobbo-msg--blobbo blobbo-options">
                <label><input type="checkbox" checked={prefs.kidsSafe} onChange={() => toggle("kidsSafe")} /> Kids-safe answers (hides grown-up titles and words)</label>
                <label><input type="checkbox" checked={prefs.voice} onChange={() => toggle("voice")} /> Read answers aloud (uses your browser&rsquo;s voice)</label>
                <label><input type="checkbox" checked={prefs.seasonal} onChange={() => toggle("seasonal")} /> Seasonal outfits{currentSeason() ? ` (now: ${currentSeason().label} ${currentSeason().badge})` : ""}</label>
                <p className="blobbo-msg-note">Blobbo&rsquo;s own voice pack and full seasonal costumes are on the way in a later beta. For now Blobbo borrows your browser&rsquo;s voice and wears a small seasonal badge.</p>
                <div className="blobbo-bubble-actions">
                  <button type="button" className="blobbo-btn" onClick={() => { setShowOptions(false); startTour(0); }}>Take the tour</button>
                  <button type="button" className="blobbo-btn" onClick={() => { setShowOptions(false); startQuiz(0); }}>Setup quiz</button>
                  <button type="button" className="blobbo-btn blobbo-btn--ghost" onClick={() => { clearHistory(); setHistory([]); }}>Forget my questions</button>
                </div>
              </div>
            )}
          </div>
          {history.length > 0 && (
            <div className="blobbo-history" aria-label="Your recent questions">
              <span className="blobbo-msg-note">Recent:</span>
              {history.map((h, k) => (
                <button key={k} type="button" className="blobbo-chip blobbo-chip--history" disabled={busy} onClick={() => ask(h.text, h.intentId || undefined)} title="Ask again">↺ {h.text}</button>
              ))}
            </div>
          )}
          {renderChips(moreTopics ? ALL_CHIPS : STARTER_CHIPS, moreTopics ? "blobbo-chips--all" : "")}
          <button type="button" className="blobbo-more" onClick={() => setMoreTopics((v) => !v)}>{moreTopics ? "Fewer topics" : `More topics (${ALL_CHIPS.length})`}</button>
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
      <div className="blobbo-fab-row">
        {!open && (
          <button type="button" className="blobbo-fab" onClick={openChat} aria-label="Ask Blobbo (Shift+A)">
            Ask Blobbo
          </button>
        )}
        <button
          type="button"
          className="blobbo-avatar"
          aria-label={open ? "Close Blobbo" : "Open Blobbo (Shift+A)"}
          title={open ? "Close Blobbo" : "Say hello to Blobbo (Shift+A)"}
          aria-expanded={open}
          onClick={() => (open ? setOpen(false) : openChat())}
        >
          {reducedMotion ? (
            <img src="/blobbo/blobbo-still.png" alt="" width="72" height="72" draggable="false" />
          ) : (
            <picture>
              <source srcSet="/blobbo/blobbo-idle.webp" type="image/webp" />
              <img src="/blobbo/blobbo-idle.gif" alt="" width="72" height="72" draggable="false" />
            </picture>
          )}
          {season && <span className="blobbo-season-badge" aria-hidden="true">{season.badge}</span>}
          {reaction && <span className="blobbo-react-badge" aria-hidden="true">{reaction === "wave" ? "\u{1F44B}" : "\u{1F440}"}</span>}
          {mood === "worried" && <span className="blobbo-worry" aria-label="Some health checks need a look">!</span>}
        </button>
      </div>
    </div>
  );
}

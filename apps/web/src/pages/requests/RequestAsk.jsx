/* eslint-disable react/prop-types */
// Ask tab on the Requests page: plain questions about requests ("what's stuck?",
// "get me the new Nolan film"). Answers come from keyword matching (see ask.js) over the
// request list and read-only endpoints; other questions go to the regular Blobbo helper.
// A title is only ever suggested here. Filing a request still happens in the title
// dialog, and is blocked when the Seerr connection is read-only (the demo).
import { useEffect, useRef, useState } from "react";
import ForbidLineIcon from "remixicon-react/ForbidLineIcon";
import SendPlaneLineIcon from "remixicon-react/SendPlaneLineIcon";
import axios from "../../lib/axios_instance";
import { askBlobbo } from "../../lib/blobbo-intents";
import { getPrefs } from "../../lib/blobbo-prefs";
import { lookAssets, resolveLook } from "../../lib/blobbo-looks";
import BlobboLook from "../components/general/BlobboLook";
import { ENGINE, STARTERS, describeRequest, findRequests, parseIntent, pendingRequests, rankSuggestions, stuckRequests, suggestionState } from "./ask";
import { StatusChip } from "./RequestCard";
import { headlineTiles } from "./stats";

const authHeaders = () => ({ Authorization: `Bearer ${localStorage.getItem("token")}` });
let nextId = 1;
const message = (role, body) => ({ id: nextId++, role, ...body });

function Row({ row, onPick }) {
  return (
    <li className="rq-ask-row">
      <span className="rq-ask-poster" aria-hidden="true">{row.poster ? <img src={row.poster} alt="" loading="lazy" onError={(event) => { event.currentTarget.remove(); }} /> : null}</span>
      <span className="rq-ask-main">
        <strong title={row.title}>{row.title}</strong>
        <small title={row.meta}>{row.meta}</small>
      </span>
      <span className="rq-ask-side">
        {row.chip ? <StatusChip tone={row.chip.tone} label={row.chip.label} /> : null}
        {row.blocked ? (
          <span className="rq-ask-blocked" title="This Seerr connection is read-only in the demo">
            <ForbidLineIcon size={14} />
            Demo: request blocked
          </span>
        ) : null}
        {row.action ? (
          <button type="button" className="rq-btn" onClick={() => onPick(row)}>
            {row.action}
          </button>
        ) : null}
      </span>
    </li>
  );
}

function BotMessage({ item, onPick }) {
  return (
    <div className="rq-ask-msg is-bot">
      <div className="rq-ask-bubble">
        <p>{item.text}</p>
        {item.rows?.length ? <ul className="rq-ask-rows">{item.rows.map((row) => <Row key={row.key} row={row} onPick={onPick} />)}</ul> : null}
        {item.lines?.length ? (
          <ul className="rq-ask-lines">
            {item.lines.map((line, index) => (
              <li key={index}>{typeof line === "string" ? line : line.text}</li>
            ))}
          </ul>
        ) : null}
        {item.note ? <small className="rq-ask-note">{item.note}</small> : null}
      </div>
    </div>
  );
}

export default function RequestAsk({ requests, progress, readOnly, onOpenRequest, onOpenResult }) {
  const [thread, setThread] = useState(() => [
    message("bot", { text: "Hi, I\u2019m Blobbo. Ask me about your requests: what\u2019s stuck, what\u2019s pending, how things are going, or name a title you\u2019d like." }),
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef(null);
  const art = lookAssets(resolveLook(getPrefs()).id);

  useEffect(() => {
    if (thread.length > 1) endRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [thread]);

  const requestRow = (request, extra = {}) => ({
    key: request.id,
    title: request.title,
    meta: extra.meta ?? describeRequest(request, progress?.items?.[request.id]),
    poster: request.posterUrl,
    action: "Open",
    request,
    ...extra,
  });

  async function answer(question) {
    const parsed = parseIntent(question);
    const items = requests || [];

    if (parsed.intent === "stuck") {
      const stuck = stuckRequests(items, progress?.items);
      if (!stuck.length) return { text: "Nothing looks stuck. No failed requests, no stalled downloads and nothing waiting more than two days." };
      return {
        text: `${stuck.length === 1 ? "One request needs" : `${stuck.length} requests need`} a look:`,
        rows: stuck.slice(0, 6).map(({ request, reason }) => requestRow(request, { meta: `${reason} \u00b7 ${describeRequest(request, progress?.items?.[request.id])}` })),
        note: stuck.length > 6 ? `Showing 6 of ${stuck.length}.` : undefined,
      };
    }

    if (parsed.intent === "pending") {
      const pending = pendingRequests(items);
      if (!pending.length) return { text: "Nothing is waiting for approval right now." };
      return { text: `${pending.length} waiting for approval:`, rows: pending.slice(0, 6).map((request) => requestRow(request)) };
    }

    if (parsed.intent === "stats") {
      const response = await axios.get("/api/requests/stats", { headers: authHeaders(), params: { days: 30 } });
      const stats = response.data;
      if (!stats?.total) return { text: "No requests in the last 30 days, so there\u2019s nothing to measure yet." };
      const lines = headlineTiles(stats).map((tile) => `${tile.label}: ${tile.value} (${tile.hint})`);
      if (stats.topGenres?.length) lines.push(`Most requested genres: ${stats.topGenres.slice(0, 3).map((genre) => `${genre.name} (${genre.count})`).join(", ")}`);
      return { text: "Over the last 30 days:", lines, note: "Open the Stats tab for the full picture." };
    }

    if (parsed.intent === "status") {
      const found = findRequests(items, parsed.query);
      if (found.length) return { text: `${found.length === 1 ? "Here it is" : `Found ${found.length} in the queue`}:`, rows: found.slice(0, 5).map((request) => requestRow(request)) };
      parsed.intent = "request";
      parsed.notInQueue = true;
    }

    if (parsed.intent === "request") {
      if (!parsed.query || parsed.query.length < 2) return { text: "Which title? Try \u201cget me Dune\u201d or \u201crequest the new Nolan film\u201d." };
      const response = await axios.get("/api/requests/search", { headers: authHeaders(), params: { query: parsed.query } });
      const picks = rankSuggestions(response.data?.results, { preferNew: parsed.preferNew });
      if (!picks.length) return { text: `I couldn\u2019t find anything for \u201c${parsed.query}\u201d.` };
      const rows = picks.map((result) => {
        const state = suggestionState(result);
        return {
          key: result.id,
          title: `${result.title}${result.year ? ` (${result.year})` : ""}`,
          meta: `${result.mediaType === "tv" ? "TV" : "Movie"}${result.rating ? ` \u00b7 TMDB ${Number(result.rating).toFixed(1)}` : ""}`,
          poster: result.posterUrl,
          chip: state.key === "available" ? { tone: "available", label: state.label } : state.key === "requested" ? { tone: "pending", label: state.label } : null,
          blocked: readOnly && state.key === "open",
          action: readOnly ? "View" : state.key === "open" ? "Request\u2026" : "View",
          result,
        };
      });
      return {
        text: `${parsed.notInQueue ? "That isn\u2019t in the queue. " : ""}Here\u2019s what I found for \u201c${parsed.query}\u201d${parsed.preferNew ? ", newest first" : ""}:`,
        rows,
        note: readOnly ? "Requests are blocked in this demo, so I can only suggest titles." : "I won\u2019t send anything on my own. Open a title to choose where it goes and confirm.",
      };
    }

    // Not about requests: the regular Blobbo helper (also keyword based) takes it.
    const reply = await askBlobbo(question);
    return { text: reply.text || "", lines: reply.lines, note: "Answered by Blobbo\u2019s regular helper." };
  }

  async function ask(question) {
    const text = String(question || "").trim();
    if (!text || busy) return;
    setInput("");
    setBusy(true);
    setThread((current) => [...current, message("user", { text })]);
    try {
      const reply = await answer(text);
      setThread((current) => [...current, message("bot", reply)]);
    } catch (error) {
      setThread((current) => [...current, message("bot", { text: "I couldn\u2019t get that just now.", note: error.response?.data?.error || error.message })]);
    } finally {
      setBusy(false);
    }
  }

  const pick = (row) => {
    if (row.request) onOpenRequest(row.request);
    else if (row.result) onOpenResult(row.result);
  };

  return (
    <section className="rq-ask" aria-label="Ask Blobbo">
      <div className="rq-ask-engine" role="note">
        <strong>{ENGINE.label}</strong>
        <span>{ENGINE.note}</span>
      </div>

      <div className="rq-ask-thread" role="log" aria-live="polite" aria-busy={busy}>
        {thread.map((item) =>
          item.role === "user" ? (
            <div key={item.id} className="rq-ask-msg is-user">
              <div className="rq-ask-bubble"><p>{item.text}</p></div>
            </div>
          ) : (
            <div key={item.id} className="rq-ask-line">
              <span className="rq-ask-avatar" aria-hidden="true"><BlobboLook svg={art.svg} still={art.still} size={32} animate={false} /></span>
              <BotMessage item={item} onPick={pick} />
            </div>
          )
        )}
        {busy ? <p className="rq-ask-typing">Blobbo is looking…</p> : null}
        <span ref={endRef} />
      </div>

      <div className="rq-ask-starters">
        {STARTERS.map((starter) => (
          <button key={starter} type="button" disabled={busy} onClick={() => ask(starter)}>
            {starter}
          </button>
        ))}
      </div>

      <form
        className="rq-ask-form"
        onSubmit={(event) => {
          event.preventDefault();
          ask(input);
        }}
      >
        <input type="text" value={input} onChange={(event) => setInput(event.target.value)} placeholder="Ask about your requests…" aria-label="Ask Blobbo about requests" maxLength={200} autoComplete="off" />
        <button type="submit" className="rq-btn is-primary" disabled={busy || !input.trim()} aria-label="Send">
          <SendPlaneLineIcon size={16} />
          <span>Ask</span>
        </button>
      </form>
    </section>
  );
}

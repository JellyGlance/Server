import { useEffect, useState } from "react";
import TerminalBoxLineIcon from "remixicon-react/TerminalBoxLineIcon";
import SendPlaneLineIcon from "remixicon-react/SendPlaneLineIcon";
import CheckLineIcon from "remixicon-react/CheckLineIcon";
import CloseLineIcon from "remixicon-react/CloseLineIcon";
import ArrowGoBackLineIcon from "remixicon-react/ArrowGoBackLineIcon";
import HistoryLineIcon from "remixicon-react/HistoryLineIcon";
import axios from "../lib/axios_instance";
import "./css/ops-copilot.css";

const STATUS_TEXT = {
  pending: "Waiting for approval",
  "propose-only": "Proposal only, nothing will run",
  executed: "Executed",
  cancelled: "Cancelled",
  undone: "Undone",
};

function PlanCard({ plan, onDecide, busy }) {
  return (
    <article className={`ops-plan is-${plan.status}`}>
      <header>
        <h3>{plan.title}</h3>
        <span className="ops-plan-status">{STATUS_TEXT[plan.status] || plan.status}</span>
      </header>
      {["pending", "propose-only"].includes(plan.status) && <p className="ops-plan-sub">Dry run. These steps have not been run.</p>}
      <ol>
        {plan.steps.map((step, index) => {
          const result = plan.results?.[index];
          return (
            <li key={index} className={step.executable ? "is-exec" : "is-propose"}>
              <span>{step.text}</span>
              <em>{result ? result.status + (result.output ? ` · ${result.output}` : "") : step.executable ? "runs on approve" : "propose-only"}</em>
            </li>
          );
        })}
      </ol>
      <footer>
        {plan.status === "pending" && (
          <>
            <button type="button" className="ops-btn is-primary" disabled={busy} onClick={() => onDecide(plan, "approve")}><CheckLineIcon /> Approve</button>
            <button type="button" className="ops-btn" disabled={busy} onClick={() => onDecide(plan, "cancel")}><CloseLineIcon /> Cancel</button>
          </>
        )}
        {plan.status === "propose-only" && (
          <button type="button" className="ops-btn" disabled={busy} onClick={() => onDecide(plan, "cancel")}><CloseLineIcon /> Dismiss</button>
        )}
        {plan.status === "executed" && plan.steps.some((s) => s.executable && s.action?.type === "download.pause") && (
          <button type="button" className="ops-btn" disabled={busy} onClick={() => onDecide(plan, "undo")}><ArrowGoBackLineIcon /> Undo</button>
        )}
      </footer>
    </article>
  );
}

export default function OpsCopilot() {
  const [question, setQuestion] = useState("");
  const [examples, setExamples] = useState([]);
  const [thread, setThread] = useState([]);
  const [audit, setAudit] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const loadAudit = () => axios.get("/ops-copilot/audit?limit=30").then((r) => setAudit(r.data || [])).catch(() => {});

  useEffect(() => {
    axios.get("/ops-copilot/examples").then((r) => setExamples(r.data?.examples || [])).catch(() => {});
    loadAudit();
  }, []);

  const ask = async (text) => {
    const value = String(text ?? question).trim();
    if (!value || busy) return;
    setBusy(true);
    setError("");
    try {
      const { data } = await axios.post("/ops-copilot/ask", { question: value });
      setThread((current) => [{ question: value, ...data }, ...current]);
      setQuestion("");
      loadAudit();
    } catch (err) {
      setError(err.response?.data?.error || "Unable to answer right now");
    } finally {
      setBusy(false);
    }
  };

  const decide = async (plan, decision) => {
    setBusy(true);
    setError("");
    try {
      const { data } = await axios.post(`/ops-copilot/plans/${plan.id}/${decision}`);
      setThread((current) => current.map((turn) => ({ ...turn, plans: turn.plans.map((p) => (p.id === plan.id ? data : p)) })));
      loadAudit();
    } catch (err) {
      setError(err.response?.data?.error || "Unable to update plan");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ops-copilot">
      <section className="ops-hero">
        <TerminalBoxLineIcon />
        <div>
          <h1>Ops Copilot</h1>
          <p>Ask about playback, disk space or downloads. Answers come from your server data. Anything that changes something is shown as a plan first and only runs when you approve it.</p>
        </div>
      </section>

      <form className="ops-ask" onSubmit={(e) => { e.preventDefault(); ask(); }}>
        <input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="e.g. Why is Dune buffering for Mum?" maxLength={500} />
        <button type="submit" className="ops-btn is-primary" disabled={busy || !question.trim()}><SendPlaneLineIcon /> Ask</button>
      </form>
      <div className="ops-examples">
        {examples.map((example) => (
          <button key={example} type="button" onClick={() => ask(example)} disabled={busy}>{example}</button>
        ))}
      </div>
      {error && <p className="ops-error">{error}</p>}

      <div className="ops-layout">
        <div className="ops-thread">
          {!thread.length && <p className="ops-empty">No questions yet.</p>}
          {thread.map((turn, index) => (
            <article key={index} className="ops-turn">
              <p className="ops-q">{turn.question}</p>
              <span className="ops-intent">{turn.label}{turn.subjects?.user ? ` · user: ${turn.subjects.user}` : ""}{turn.subjects?.title ? ` · title: ${turn.subjects.title}` : ""}</span>
              <ul className="ops-findings">
                {turn.findings.map((finding, i) => <li key={i}>{finding}</li>)}
              </ul>
              {turn.plans.map((plan) => <PlanCard key={plan.id} plan={plan} onDecide={decide} busy={busy} />)}
            </article>
          ))}
        </div>
        <aside className="ops-audit">
          <h2><HistoryLineIcon /> Audit log</h2>
          {!audit.length && <p className="ops-empty">Nothing logged yet.</p>}
          <ul>
            {audit.map((entry) => (
              <li key={entry.id}>
                <strong>{entry.type}</strong> · {entry.actor}
                <span>{entry.details?.question || entry.details?.title || ""}</span>
                <time>{new Date(entry.timestamp).toLocaleString("en-GB")}</time>
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </div>
  );
}

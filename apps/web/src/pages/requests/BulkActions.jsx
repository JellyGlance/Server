/* eslint-disable react/prop-types */
// Bulk bar and confirm dialog for the request list. The bar shows what the selection
// would do; the dialog lists the titles, asks for a confirmation and then shows one
// result per request.
import { useState } from "react";
import { Modal } from "react-bootstrap";
import CheckLineIcon from "remixicon-react/CheckLineIcon";
import CloseLineIcon from "remixicon-react/CloseLineIcon";
import ErrorWarningLineIcon from "remixicon-react/ErrorWarningLineIcon";
import axios from "../../lib/axios_instance";
import { BULK_ACTIONS, actionPlan, bulkPayload, resultSummary } from "./bulk";

export function BulkBar({ selected, total, onClear, onSelectAll, onRun }) {
  const plan = actionPlan(selected);
  return (
    <div className="rq-bulkbar" role="region" aria-label="Bulk actions">
      <strong>{selected.length ? `${selected.length} selected` : "Select requests"}</strong>
      <div className="rq-bulk-actions">
        {BULK_ACTIONS.map(({ key, label }) => (
          <button key={key} type="button" className={`rq-btn${key === "approve" ? " is-primary" : ""}`} disabled={!plan[key]} onClick={() => onRun(key, plan[key])}>
            {label}
            {plan[key] ? <em>{plan[key].length}</em> : null}
          </button>
        ))}
      </div>
      <div className="rq-bulk-tools">
        <button type="button" className="rq-btn" onClick={onSelectAll} disabled={!total || selected.length === total}>
          All ({total})
        </button>
        <button type="button" className="rq-btn" onClick={onClear}>
          Done
        </button>
      </div>
    </div>
  );
}

export function BulkDialog({ run, onHide, onFinished }) {
  const [state, setState] = useState({ busy: false, result: null, error: "" });
  const open = Boolean(run);
  const meta = BULK_ACTIONS.find((entry) => entry.key === run?.action);

  const close = () => {
    const finished = Boolean(state.result);
    setState({ busy: false, result: null, error: "" });
    onHide();
    if (finished) onFinished?.(state.result);
  };

  const confirm = async () => {
    setState({ busy: true, result: null, error: "" });
    try {
      const response = await axios.post("/api/requests/bulk", bulkPayload(run.action, run.requests), { headers: { Authorization: `Bearer ${localStorage.getItem("token")}` } });
      setState({ busy: false, result: response.data, error: "" });
    } catch (error) {
      const message = error.response?.data?.error || error.message || "Could not update the requests";
      setState({ busy: false, result: null, error: error.response?.status === 403 && error.response?.data?.readOnly ? `${message} Nothing was sent.` : message });
    }
  };

  const byId = new Map((state.result?.results || []).map((result) => [String(result.requestId), result]));
  return (
    <Modal show={open} onHide={state.busy ? undefined : close} centered contentClassName="rq-trailer rq-bulk-dialog" aria-label="Confirm bulk action">
      <div className="rq-trailer-head">
        <strong>{state.result ? resultSummary(state.result) : `${meta?.label || ""} ${run?.requests.length || 0} request${run?.requests.length === 1 ? "" : "s"}?`}</strong>
        <button type="button" className="rq-tool" aria-label="Close" onClick={close} disabled={state.busy}>
          <CloseLineIcon size={18} />
        </button>
      </div>
      <ul className="rq-bulk-list">
        {(run?.requests || []).map((request) => {
          const result = byId.get(String(request.requestId));
          return (
            <li key={request.id} className={result ? (result.ok ? "is-ok" : "is-failed") : ""}>
              <span className="rq-bulk-mark" aria-hidden="true">{result ? result.ok ? <CheckLineIcon size={16} /> : <ErrorWarningLineIcon size={16} /> : null}</span>
              <span className="rq-bulk-title" title={request.title}>{request.title}</span>
              {result && !result.ok ? <small title={result.error}>{result.error}</small> : null}
              {result?.ok ? <small>Done</small> : null}
            </li>
          );
        })}
      </ul>
      {state.error ? <p className="rq-bulk-error" role="alert">{state.error}</p> : null}
      <div className="rq-bulk-foot">
        {state.result ? (
          <button type="button" className="rq-btn is-primary" onClick={close}>Close</button>
        ) : (
          <>
            <button type="button" className="rq-btn" onClick={close} disabled={state.busy}>Cancel</button>
            <button type="button" className="rq-btn is-primary" onClick={confirm} disabled={state.busy}>
              {state.busy ? "Working\u2026" : `${meta?.label || "Confirm"} ${run?.requests.length || 0}`}
            </button>
          </>
        )}
      </div>
    </Modal>
  );
}

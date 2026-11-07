import React, { useState } from "react";
import ArrowDownSLineIcon from "remixicon-react/ArrowDownSLineIcon";
import Tooltip from "@mui/material/Tooltip";
import ClickAwayListener from "@mui/material/ClickAwayListener";
import { explainTranscode, summarizeTranscode } from "../../../lib/transcode-explainer";

function TranscodeExplainer({ session, compact = false, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  const explained = explainTranscode(session);
  if (!explained) return null;
  const summary = summarizeTranscode(explained);

  const detail = (
    <div className="transcode-explainer-detail">
      <p className="transcode-explainer-device">
        Fix hints for <strong>{explained.familyLabel}</strong>
        {explained.hardware ? <span> · HW: {explained.hardware}</span> : <span> · software encode</span>}
      </p>
      <ul>
        {explained.causes.map((cause) => (
          <li key={cause.id}>
            <strong>{cause.label}</strong>
            <span>{cause.explanation}</span>
            {cause.hint ? <em>Fix: {cause.hint}</em> : null}
          </li>
        ))}
      </ul>
    </div>
  );

  const chip = (
    <button
      type="button"
      className={`transcode-explainer-chip is-${explained.mode}`}
      aria-expanded={open}
      onClick={(event) => {
        event.stopPropagation();
        setOpen((value) => !value);
      }}
      title={compact ? undefined : "Why is this transcoding?"}
    >
      <span>{summary}</span>
      <ArrowDownSLineIcon size={14} aria-hidden="true" />
    </button>
  );

  if (compact) {
    return (
      <div className={`transcode-explainer is-compact${open ? " is-open" : ""}`} data-session-card-ignore>
        <ClickAwayListener onClickAway={() => setOpen(false)}>
          <span>
            <Tooltip
              open={open}
              disableHoverListener
              disableFocusListener
              disableTouchListener
              placement="bottom-start"
              title={detail}
              slotProps={{ tooltip: { className: "transcode-explainer-popper" } }}
            >
              {chip}
            </Tooltip>
          </span>
        </ClickAwayListener>
      </div>
    );
  }

  return (
    <div className={`transcode-explainer${open ? " is-open" : ""}`} data-session-card-ignore>
      {chip}
      {open ? detail : null}
    </div>
  );
}

export default TranscodeExplainer;

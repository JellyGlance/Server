/* eslint-disable react/prop-types */
// Playback info shared by the session Cards and the Wall: the playback-state
// chip (Direct play / Video ⟳ +N / Audio transcode, reasons in the tooltip),
// resolution + codec and bitrate pills, and the Device / Audio lines.
import React, { useLayoutEffect, useRef } from "react";
import Tooltip from "@mui/material/Tooltip";
import TranscodeExplainer from "./transcode-explainer";
import { explainTranscode, summarizeTranscode } from "../../../lib/transcode-explainer";

export function formatTranscodeReasons(session) {
  const reasons = session?.TranscodingInfo?.TranscodeReasons;
  if (Array.isArray(reasons) && reasons.length) {
    return reasons
      .map((reason) => String(reason).replace(/([a-z])([A-Z])/g, "$1 $2"))
      .join(", ");
  }
  const transcoding = session?.TranscodingInfo;
  if (!transcoding) return "";
  const parts = [];
  if (transcoding.IsVideoDirect === false) parts.push("Video remux/transcode");
  if (transcoding.IsAudioDirect === false) parts.push("Audio remux/transcode");
  return parts.join(", ");
}

export function lastStreamPart(value) {
  const parts = String(value || "").split("->");
  return parts[parts.length - 1].trim();
}

// Short, client-agnostic pills: playback method, resolution/codec and bitrate.
// Short transcode badge for the compact card: first reason + how many more,
// e.g. "Video ⟳ +1". The full reasons sit in the badge's tooltip.
const TRANSCODE_SHORT = {
  videoCodec: "Video",
  audioCodec: "Audio",
  audioChannels: "Channels",
  bitrate: "Bitrate",
  subtitles: "Subs",
  container: "Container",
  videoRange: "HDR",
  videoProfile: "Profile",
  resolution: "Res",
  directPlayDisabled: "DP off",
  error: "DP failed",
};

export function shortTranscodeLabel(explained) {
  if (!explained) return "";
  const first = explained.causes[0];
  const name = first ? TRANSCODE_SHORT[first.id] || first.label : explained.mode === "remux" ? "Remux" : "Transcode";
  const more = explained.causes.length > 1 ? ` +${explained.causes.length - 1}` : "";
  return `${name} ⟳${more}`;
}

export function getSessionPills(session) {
  const item = session.NowPlayingItem || {};
  const transcoding = session.TranscodingInfo;
  const pills = [];
  const videoTranscode = Boolean(transcoding) && transcoding.IsVideoDirect === false;
  const audioTranscode = Boolean(transcoding) && transcoding.IsAudioDirect === false;

  if (videoTranscode) {
    pills.push({ key: "method", label: "Video transcode", tone: "warn" });
  } else {
    pills.push({ key: "method", label: session.PlayState?.PlayMethod === "DirectStream" ? "Direct stream" : "Direct play", tone: "ok" });
  }
  if (audioTranscode) {
    pills.push({ key: "audio", label: "Audio transcode", tone: "warn" });
  }

  const videoMatch = /\(([^-\s)]+)-([^\s)]+)/.exec(item.VideoStream || "");
  if (videoMatch) {
    const target = /->\s*([^-\s)]+)-([^\s)]+)/.exec(item.VideoStream || "");
    const codec = target ? target[1] : videoMatch[1];
    const resolution = target ? target[2] : videoMatch[2];
    pills.push({ key: "video", label: `${resolution} · ${codec}` });
  }

  const bitrate = lastStreamPart(item.VideoBitrateStream);
  if (bitrate) {
    pills.push({ key: "bitrate", label: bitrate });
  }
  return pills;
}

export function formatStreamDetail(value) {
  const inner = /\((.*)\)/.exec(String(value || ""));
  return (inner ? inner[1] : String(value || ""))
    .replace(/->/g, "→")
    .replace(/-(\d+)Ch/gi, " $1ch")
    .trim();
}

export function SessionField({ label, value, title }) {
  if (value === undefined || value === null || value === "") return null;
  return (
    <div className="session-field">
      <span className="session-field-label">{label}</span>
      <Tooltip title={title || (typeof value === "string" ? value : "")}>
        <span className="session-field-value">{value}</span>
      </Tooltip>
    </div>
  );
}

// Badges stay on one row: the ones that don't fit are hidden and a "+N" chip
// lists them in its tooltip. Works on the DOM so a resize doesn't re-render.
export function useBadgeOverflow(rowRef, moreRef, contentKey) {
  useLayoutEffect(() => {
    const row = rowRef.current;
    const more = moreRef.current;
    if (!row || !more || typeof ResizeObserver === "undefined") return undefined;
    let frame = 0;
    const update = () => {
      frame = 0;
      const items = [...row.children].filter((child) => child !== more);
      items.forEach((item) => (item.style.display = ""));
      more.style.display = "none";
      if (row.scrollWidth <= row.clientWidth + 1) return;
      more.style.display = "";
      const limit = row.getBoundingClientRect().right - more.getBoundingClientRect().width - 6;
      const hidden = [];
      for (let i = items.length - 1; i >= 0; i -= 1) {
        const fits = items.slice(0, i + 1).every((item) => item.getBoundingClientRect().right <= limit + 0.5);
        if (fits) break;
        items[i].style.display = "none";
        hidden.unshift(items[i].textContent.trim());
      }
      more.textContent = `+${hidden.length}`;
      more.title = hidden.join(", ");
      more.setAttribute("aria-label", `${hidden.length} more: ${hidden.join(", ")}`);
    };
    const observer = new ResizeObserver(() => {
      if (!frame) frame = window.requestAnimationFrame(update);
    });
    observer.observe(row);
    update();
    return () => {
      observer.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [rowRef, moreRef, contentKey]);
}

function transcodeTooltip(session, explained) {
  const tip = explained
    ? [summarizeTranscode(explained), ...explained.causes.map((cause) => cause.label)].filter((v, i, all) => all.indexOf(v) === i).join(" · ")
    : "";
  return [tip, formatTranscodeReasons(session)].filter(Boolean).join(" — ");
}

// Simple: just the playback-state chip. Detailed: the transcode badge (or the
// method pill), resolution · codec and bitrate on one row; pills that don't
// fit fold into a "+N" chip.
export function SessionPlaybackPills({ session, simple = false, canManage = false }) {
  const rowRef = useRef(null);
  const moreRef = useRef(null);
  const isTranscoding = Boolean(session.TranscodingInfo);
  const explained = isTranscoding ? explainTranscode(session) : null;
  const showTranscodeBadge = canManage && isTranscoding && Boolean(explained);
  const pills = getSessionPills(session).filter(
    (pill) => !(showTranscodeBadge && ((pill.key === "method" && pill.tone === "warn") || pill.key === "audio")),
  );
  const contentKey = [showTranscodeBadge ? "explainer" : "", ...pills.map((pill) => pill.label)].join("|");
  useBadgeOverflow(rowRef, moreRef, simple ? "simple" : contentKey);

  if (simple) {
    return (
      <div className="session-pills">
        {isTranscoding ? (
          <Tooltip title={transcodeTooltip(session, explained) || "Transcoding"}>
            <span className="session-pill session-state-chip is-warn" tabIndex={0}>
              {session.TranscodingInfo.IsVideoDirect === false ? "Transcode" : "Audio transcode"}
            </span>
          </Tooltip>
        ) : (
          <span className="session-pill session-state-chip is-ok">
            {session.PlayState?.PlayMethod === "DirectStream" ? "Direct stream" : "Direct play"}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="session-pills" ref={rowRef}>
      {showTranscodeBadge ? (
        <Tooltip title={transcodeTooltip(session, explained)}>
          <span className="session-transcode-badge">
            <TranscodeExplainer session={session} compact label={shortTranscodeLabel(explained)} />
          </span>
        </Tooltip>
      ) : null}
      {pills.map((pill) => (
        <span key={pill.key} className={`session-pill${pill.tone ? ` is-${pill.tone}` : ""}`}>
          {pill.label}
        </span>
      ))}
      <span className="session-pill session-pill-more" ref={moreRef} style={{ display: "none" }} />
    </div>
  );
}

// Device and Audio lines (Detailed look).
export function SessionPlaybackFields({ session }) {
  const item = session.NowPlayingItem || {};
  return (
    <>
      <SessionField label="Device" value={session.DeviceName} />
      {item.AudioStream ? (
        <SessionField
          label="Audio"
          value={[formatStreamDetail(item.AudioStream), lastStreamPart(item.AudioBitrateStream)].filter(Boolean).join(" · ")}
          title={`${item.AudioStream} ${item.AudioBitrateStream || ""}`.trim()}
        />
      ) : null}
    </>
  );
}

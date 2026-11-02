/* eslint-disable react/prop-types */
import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import Card from "react-bootstrap/Card";
import Row from "react-bootstrap/Row";
import Col from "react-bootstrap/Col";
import Container from "react-bootstrap/Container";
import Modal from "react-bootstrap/Modal";
import Form from "react-bootstrap/Form";

import AccountCircleFillIcon from "remixicon-react/AccountCircleFillIcon";
import ChatSmile2LineIcon from "remixicon-react/ChatSmile2LineIcon";
import ArrowDownSLineIcon from "remixicon-react/ArrowDownSLineIcon";
import PlayFillIcon from "remixicon-react/PlayFillIcon";
import PauseFillIcon from "remixicon-react/PauseFillIcon";
import StopCircleLineIcon from "remixicon-react/StopCircleLineIcon";

import { PlatformIcon } from "../../../lib/platform-icons";
import Tooltip from "@mui/material/Tooltip";
import IpInfoModal from "../ip-info";
import { Trans } from "react-i18next";
import baseUrl from "../../../lib/baseurl";
import axios from "../../../lib/axios_instance";
import SessionGlanceStrip from "./session-glance-strip";
import TranscodeExplainer from "./transcode-explainer";

function formatTranscodeReasons(session) {
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

function lastStreamPart(value) {
  const parts = String(value || "").split("->");
  return parts[parts.length - 1].trim();
}

// Short, client-agnostic pills: playback method, resolution/codec and bitrate.
function getSessionPills(session) {
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

function formatStreamDetail(value) {
  const inner = /\((.*)\)/.exec(String(value || ""));
  return (inner ? inner[1] : String(value || ""))
    .replace(/->/g, "→")
    .replace(/-(\d+)Ch/gi, " $1ch")
    .trim();
}

function ticksToTimeString(ticks) {
  // Convert ticks to seconds
  const seconds = Math.floor(ticks / 10000000);
  // Calculate hours, minutes, and remaining seconds
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;
  // Format the time string as hh:MM:ss
  const timeString = `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${remainingSeconds
    .toString()
    .padStart(2, "0")}`;

  return timeString;
}

function getETA(NowPlayingItem, PlayState) {
  if (NowPlayingItem.ChannelType && NowPlayingItem.ChannelType === "TV") {
    return NowPlayingItem.CurrentProgram.EndDate
      ? new Date(NowPlayingItem.CurrentProgram.EndDate).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
          hour12: JSON.parse(localStorage.getItem("12hr")),
        })
      : "";
  }
  let ticks = NowPlayingItem.RunTimeTicks - PlayState.PositionTicks;
  return getETAFromTicks(ticks);
}

function getETAFromTicks(ticks) {
  // Get current date
  const currentDate = Date.now();

  // Calculate ETA
  const etaMillis = currentDate + ticks / 10000;
  const eta = new Date(etaMillis);
  const twelve_hr = JSON.parse(localStorage.getItem("12hr"));

  // Return formated string in user locale
  return eta.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: twelve_hr });
}

function SessionDetailItem({ label, value, wide = false }) {
  if (!value) return null;

  return (
    <div className={`session-popout-detail${wide ? " is-wide" : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function SessionField({ label, value, title }) {
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

function defaultMessageDateTime(minutesAhead = 15) {
  const date = new Date(Date.now() + minutesAhead * 60 * 1000);
  date.setSeconds(0, 0);
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function tonightMessageDateTime() {
  const date = new Date();
  date.setHours(22, 0, 0, 0);
  if (date.getTime() <= Date.now()) {
    date.setDate(date.getDate() + 1);
  }
  return defaultMessageDateTime(Math.max(1, Math.round((date.getTime() - Date.now()) / 60000)));
}

function formatMessageTime(value) {
  if (!value) return "the scheduled time";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  let twelveHour;
  try {
    twelveHour = JSON.parse(localStorage.getItem("12hr"));
  } catch {
    twelveHour = false;
  }
  return date.toLocaleString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: Boolean(twelveHour),
  });
}

function applySessionMessageTemplate(template, session, title, timeValue) {
  return String(template || "")
    .replaceAll("{user}", session.UserName || "there")
    .replaceAll("{device}", session.DeviceName || session.Client || "your device")
    .replaceAll("{title}", title || session.NowPlayingItem?.Name || "this")
    .replaceAll("{time}", formatMessageTime(timeValue));
}

const SESSION_MESSAGE_TEMPLATES = [
  { id: "custom", label: "Custom", emoji: "✏️", group: "Write your own", text: "" },
  { id: "pause", label: "Please pause", emoji: "⏸️", group: "Playback", text: "{user}, please pause when you can." },
  { id: "enjoy", label: "No rush", emoji: "🎬", group: "Playback", text: "No rush — enjoy {title}." },
  { id: "credits", label: "Skip credits", emoji: "⏭️", group: "Playback", text: "Skip the credits when you can so the next episode does not autoplay." },
  { id: "volume", label: "Volume down", emoji: "🔉", group: "Playback", text: "Please turn the volume down a bit." },
  { id: "buffer", label: "Buffering?", emoji: "🔄", group: "Playback", text: "If {title} is buffering, try pausing for a few seconds or dropping quality." },
  { id: "stopping", label: "Stopping soon", emoji: "⏹️", group: "Playback", text: "Playback may be stopped at {time}.", needsTime: true, defaultMinutes: 10 },
  { id: "dinner", label: "Dinner's ready", emoji: "🍽️", group: "Household", text: "Dinner's ready — pause {title} when you get to a good spot." },
  { id: "bedtime", label: "Bedtime", emoji: "🌙", group: "Household", text: "Heading to bed around {time}. Please wrap up {title} soon.", needsTime: true, defaultMinutes: 20 },
  { id: "downstairs", label: "Come downstairs", emoji: "🏠", group: "Household", text: "{user}, can you come downstairs when you hit a pause?" },
  { id: "phone", label: "Someone needs you", emoji: "📞", group: "Household", text: "{user}, someone needs you — pause when you can." },
  { id: "leaving", label: "Leaving soon", emoji: "🚗", group: "Household", text: "We are heading out at {time}. Please pause {title} and wrap up.", needsTime: true, defaultMinutes: 30 },
  { id: "checkin", label: "Check in", emoji: "👋", group: "Household", text: "Hi {user} on {device} — can you check in when you get a moment?" },
  { id: "quality", label: "Lower quality", emoji: "📉", group: "Server", text: "This stream is loading the server. Please drop quality or switch to direct play if you can." },
  { id: "busy", label: "Server is busy", emoji: "🔥", group: "Server", text: "The server is busy right now. Please pause or lower quality on {device}." },
  { id: "direct", label: "Direct play please", emoji: "📡", group: "Server", text: "Please switch to Direct Play if your client allows it — transcoding is heavy right now." },
  { id: "wifi", label: "Wi-Fi issue", emoji: "📶", group: "Server", text: "Wi-Fi looks unhappy. Pause {title}, move closer to the access point, then resume." },
  { id: "maintenance", label: "Maintenance soon", emoji: "🛠️", group: "Maintenance", text: "Server maintenance starts at {time}. Please pause {title} and save your place.", needsTime: true, defaultMinutes: 20 },
  { id: "restart", label: "Restarting Jellyfin", emoji: "🔁", group: "Maintenance", text: "Jellyfin is restarting at {time}. Playback on {device} will drop — pause before then.", needsTime: true, defaultMinutes: 10 },
  { id: "scheduled", label: "Scheduled restart", emoji: "🗓️", group: "Maintenance", text: "Scheduled server restart at {time}. Please pause {title} on {device} before it drops.", needsTime: true, defaultMinutes: 15 },
  { id: "scheduled-15", label: "Restart in 15 min", emoji: "⏰", group: "Maintenance", text: "Scheduled restart at {time} (about 15 minutes). Wrap up {title} soon.", needsTime: true, defaultMinutes: 15 },
  { id: "scheduled-tonight", label: "Restart tonight", emoji: "🌙", group: "Maintenance", text: "The server restarts tonight at {time}. Finish {title} before then if you can.", needsTime: true, defaultTonight: true },
  { id: "update", label: "Update in progress", emoji: "⬆️", group: "Maintenance", text: "The server is updating. {title} may stop. You can resume after maintenance." },
  { id: "downtime", label: "Short downtime", emoji: "⛔", group: "Maintenance", text: "Short downtime at {time}. Wrap up {title} when you hit a good stopping point.", needsTime: true, defaultMinutes: 15 },
  { id: "library-scan", label: "Library scan", emoji: "📚", group: "Maintenance", text: "A library scan is running, so streams may hitch. Pause if it gets choppy." },
  { id: "disk", label: "Storage work", emoji: "💾", group: "Maintenance", text: "Disk / storage work is in progress. Please pause playback until it finishes." },
  { id: "back-up", label: "We're back", emoji: "✅", group: "Maintenance", text: "Maintenance is done. You can start {title} again on {device}." },
];

const SESSION_MESSAGE_TEMPLATE_GROUPS = [...new Set(SESSION_MESSAGE_TEMPLATES.map((template) => template.group))];

function SessionCard(props) {
  const session = props.data.session;
  const hideIpAddress = Boolean(props.hideIpAddress);
  const canManage = Boolean(props.canManage) && !props.kiosk;
  const nowPlaying = session.NowPlayingItem;
  const playState = session.PlayState;
  const mediaItemId = props.data.session.NowPlayingItem.SeriesId
    ? props.data.session.NowPlayingItem.SeriesId
    : props.data.session.NowPlayingItem.Id;
  const [loadBackdrop, setLoadBackdrop] = useState(false);
  const [sessionModalVisible, setSessionModalVisible] = useState(false);
  const [messageOpen, setMessageOpen] = useState(false);
  const [messageText, setMessageText] = useState("");
  const [messageTemplateId, setMessageTemplateId] = useState("custom");
  const [templateMenuOpen, setTemplateMenuOpen] = useState(false);
  const [messageWhen, setMessageWhen] = useState(() => defaultMessageDateTime(15));
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState("");

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => setLoadBackdrop(true));
    return () => window.cancelAnimationFrame(frameId);
  }, [mediaItemId]);

  useEffect(() => {
    if (!messageOpen) setTemplateMenuOpen(false);
  }, [messageOpen]);

  const cardStyle = {
    backgroundImage: loadBackdrop
      ? `url(/proxy/Items/Images/Backdrop?id=${mediaItemId}&fillWidth=560&quality=38), linear-gradient(135deg, var(--primary-color), #0b1119)`
      : "linear-gradient(135deg, rgba(var(--primary-rgb), 0.28), #0b1119)",
    backgroundSize: "cover",
  };

  const cardBgStyle = {
    backdropFilter: "blur(8px)",
    backgroundColor: "rgb(0, 0, 0, 0.46)",
  };
  const progressPercent = nowPlaying.RunTimeTicks
    ? Math.min(
        100,
        Math.max(0, (playState.PositionTicks / nowPlaying.RunTimeTicks) * 100)
      )
    : 0;
  const rawTranscodePercent = Number(session.TranscodingInfo?.CompletionPercentage);
  const transcodePositionPercent = nowPlaying.RunTimeTicks
    ? Number(session.TranscodingInfo?.TranscodingPositionTicks) / nowPlaying.RunTimeTicks * 100
    : 0;
  const transcodePercent = Number.isFinite(rawTranscodePercent)
    ? Math.min(100, Math.max(0, rawTranscodePercent))
    : Number.isFinite(transcodePositionPercent)
      ? Math.min(100, Math.max(0, transcodePositionPercent))
      : null;
  const eta =
    nowPlaying.RunTimeTicks || nowPlaying.ChannelType === "TV"
      ? getETA(nowPlaying, playState)
      : "";
  const playbackMethod = playState.PlayMethod || "Unknown";
  const isTranscoding = Boolean(session.TranscodingInfo);
  const transcodeReason = formatTranscodeReasons(session);
  const title =
    nowPlaying.Type === "Episode" && nowPlaying.SeriesName
      ? nowPlaying.SeriesName
      : nowPlaying.Name;
  const subtitle =
    nowPlaying.Type === "Episode"
      ? `${nowPlaying.Name} · S${nowPlaying.ParentIndexNumber} E${nowPlaying.IndexNumber}`
      : nowPlaying.Type === "Audio" && nowPlaying.Artists?.length > 0
        ? nowPlaying.Artists[0]
        : nowPlaying.SeriesName || nowPlaying.Type;
  const timecode = `${ticksToTimeString(playState.PositionTicks)}${nowPlaying.RunTimeTicks ? `/${ticksToTimeString(nowPlaying.RunTimeTicks)}` : ""}`;
  const selectedMessageTemplate = SESSION_MESSAGE_TEMPLATES.find((item) => item.id === messageTemplateId) || SESSION_MESSAGE_TEMPLATES[0];

  function fillMessageTemplate(template, when = messageWhen) {
    return applySessionMessageTemplate(template?.text, session, title, when);
  }

  function timeForTemplate(template) {
    if (template?.defaultTonight) return tonightMessageDateTime();
    return defaultMessageDateTime(Number(template?.defaultMinutes || 15));
  }

  const ipv4Regex = new RegExp(
    /\b(?!(10\.|172\.(1[6-9]|2[0-9]|3[0-1])\.|192\.168))(?:(?:2(?:[0-4][0-9]|5[0-5])|[0-1]?[0-9]?[0-9])\.){3}(?:(?:2([0-4][0-9]|5[0-5])|[0-1]?[0-9]?[0-9]))\b/
  );

  const [ipModalVisible, setIPModalVisible] = React.useState(false);
  const [ipAddressLookup, setIPAddressLookup] = React.useState();

  const isRemoteSession = (ipAddress) => {
    ipv4Regex.lastIndex = 0;
    if (ipv4Regex.test(ipAddress ?? ipAddressLookup)) {
      return true;
    }
    return false;
  };

  function showIPDataModal(ipAddress) {
    ipv4Regex.lastIndex = 0;
    setIPAddressLookup(ipAddress);
    if (!isRemoteSession) {
      return;
    }

    setIPModalVisible(true);
  }

  function handleCardClick(event) {
    if (event.target.closest("a, button, [data-session-card-ignore]")) {
      return;
    }

    setSessionModalVisible(true);
  }

  function handleCardKeyDown(event) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setSessionModalVisible(true);
    }
  }

  return (
    <Card
      className="session-card"
      style={cardStyle}
      role="button"
      tabIndex={0}
      onClick={handleCardClick}
      onKeyDown={handleCardKeyDown}
      aria-label={`Open session details for ${title}`}
    >
      <div className="card-device-image-overlay">
        <PlatformIcon
          className="card-device-image"
          client={props.data.session.Client}
          deviceName={props.data.session.DeviceName}
        />
      </div>
      <IpInfoModal show={ipModalVisible} onHide={() => setIPModalVisible(false)} ipAddress={ipAddressLookup} />
      <Modal
        show={sessionModalVisible}
        onHide={() => setSessionModalVisible(false)}
        centered
        size="lg"
        dialogClassName="session-popout-modal"
      >
        <Modal.Body>
          <button
            type="button"
            className="session-popout-close"
            onClick={() => setSessionModalVisible(false)}
            aria-label="Close session details"
          >
            ×
          </button>
          <div
            className="session-popout-hero"
            style={{
              backgroundImage: `linear-gradient(90deg, rgba(7, 9, 13, 0.96), rgba(7, 9, 13, 0.68), rgba(7, 9, 13, 0.3)), url(/proxy/Items/Images/Backdrop?id=${mediaItemId}&fillWidth=1200&quality=58)`,
            }}
          >
            <img
              className="session-popout-poster"
              src={`${baseUrl}/proxy/Items/Images/Primary?id=${mediaItemId}&fillHeight=420&fillWidth=280&quality=68`}
              loading="lazy"
              decoding="async"
              alt=""
            />
            <div className="session-popout-copy">
              <div className="session-popout-status">
                <span className={playState.IsPaused ? "is-paused" : "is-playing"}>
                  {playState.IsPaused ? "Paused" : "Playing"}
                </span>
                <span>{playbackMethod}</span>
                {isTranscoding ? <span className="is-transcoding">Transcoding</span> : <span>Direct</span>}
              </div>
              {transcodeReason ? <p className="session-popout-reason">{transcodeReason}</p> : null}
              {canManage && isTranscoding ? <TranscodeExplainer session={session} defaultOpen /> : null}
              <h2>{title}</h2>
              <p>{subtitle}</p>
              <div className="session-popout-progress" aria-label={`Playback progress ${Math.round(progressPercent)} percent`}>
                <div className="session-playback-progress" style={{ width: `${progressPercent}%` }} />
                {isTranscoding && transcodePercent !== null ? (
                  <div
                    className="session-transcode-progress"
                    style={{ width: `${transcodePercent}%` }}
                    aria-label={`Transcode progress ${Math.round(transcodePercent)} percent`}
                  />
                ) : null}
              </div>
              <div className="session-popout-time">
                <strong>{timecode}</strong>
                <span>{eta ? `Ends ${eta}` : "Live or unknown runtime"}</span>
              </div>
            </div>
          </div>
          <div className="session-popout-grid">
            <div className="session-popout-detail">
              <span>Viewer</span>
              <div className="session-popout-viewer">
                {session.UserPrimaryImageTag !== undefined ? (
                  <img
                    src={`${baseUrl}/proxy/Users/Images/Primary?id=${session.UserId}&fillWidth=72&quality=55`}
                    loading="lazy"
                    decoding="async"
                    alt=""
                  />
                ) : (
                  <AccountCircleFillIcon aria-hidden="true" />
                )}
                <strong>{session.UserName}</strong>
              </div>
            </div>
            <SessionDetailItem label="Device" value={session.DeviceName} />
            <div className="session-popout-detail">
              <span>Client</span>
              <div className="session-popout-client">
                <PlatformIcon
                  client={session.Client}
                  deviceName={session.DeviceName}
                  className={`session-popout-client-icon${String(session.Client || "").toLowerCase().includes("roku") ? " is-roku" : ""}`}
                />
                <strong>{`${session.Client || "Unknown"} ${session.ApplicationVersion || ""}`.trim()}</strong>
              </div>
            </div>
            {!hideIpAddress ? <SessionDetailItem label="IP address" value={session.RemoteEndPoint} /> : null}
            <SessionDetailItem label="Container" value={nowPlaying.ContainerStream} />
            <SessionDetailItem label="Video" value={nowPlaying.VideoStream} wide />
            <SessionDetailItem label="Video bitrate" value={nowPlaying.VideoBitrateStream} />
            <SessionDetailItem label="Audio" value={nowPlaying.AudioStream} wide />
            <SessionDetailItem label="Audio bitrate" value={nowPlaying.AudioBitrateStream} />
            <SessionDetailItem label="Subtitles" value={nowPlaying.SubtitleStream} />
            {transcodeReason ? <SessionDetailItem label="Transcode reason" value={transcodeReason} wide /> : null}
          </div>
          {canManage ? (
            <div className="session-popout-actions" data-session-card-ignore>
              {actionError ? <p className="session-action-error">{actionError}</p> : null}
              <button
                type="button"
                className="session-command is-message"
                disabled={actionBusy}
                onClick={() => {
                  setActionError("");
                  setMessageTemplateId("custom");
                  setMessageWhen(defaultMessageDateTime(15));
                  setMessageOpen(true);
                }}
              >
                <ChatSmile2LineIcon size={17} />
                Message
              </button>
              <button
                type="button"
                className="session-command is-stop"
                disabled={actionBusy}
                onClick={async () => {
                  if (!window.confirm(`Stop playback for ${session.UserName}?`)) return;
                  setActionBusy(true);
                  setActionError("");
                  try {
                    await axios.post("/api/sessions/stop", { sessionId: session.Id }, { headers: { Authorization: `Bearer ${localStorage.getItem("token")}` } });
                    setSessionModalVisible(false);
                  } catch (error) {
                    setActionError(error?.response?.data?.error || "Unable to stop this session");
                  } finally {
                    setActionBusy(false);
                  }
                }}
              >
                <StopCircleLineIcon size={17} />
                Stop playback
              </button>
            </div>
          ) : null}
        </Modal.Body>
      </Modal>
      <Modal
        show={messageOpen}
        onHide={() => {
          setMessageOpen(false);
          setTemplateMenuOpen(false);
        }}
        centered
        contentClassName="session-message-modal"
      >
        <Modal.Header closeButton>
          <Modal.Title>Message {session.UserName}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <p className="session-message-hint">Choose a template from the menu, then edit before sending. It shows as an on-screen notice on their Jellyfin client.</p>
          <div className={`session-message-picker${templateMenuOpen ? " is-open" : ""}`}>
            <span className="session-message-select-label">Message template</span>
            <button
              type="button"
              className="session-message-trigger"
              aria-haspopup="listbox"
              aria-expanded={templateMenuOpen}
              onClick={() => setTemplateMenuOpen((open) => !open)}
            >
              <span className="session-message-trigger-emoji">{selectedMessageTemplate.emoji}</span>
              <span className="session-message-trigger-copy">
                <strong>{selectedMessageTemplate.label}</strong>
                <small>{selectedMessageTemplate.group}</small>
              </span>
              <ArrowDownSLineIcon size={20} />
            </button>
            {templateMenuOpen ? (
              <div className="session-message-menu" role="listbox">
                {SESSION_MESSAGE_TEMPLATE_GROUPS.map((group) => (
                  <div key={group} className="session-message-menu-group">
                    <span>{group}</span>
                    {SESSION_MESSAGE_TEMPLATES.filter((template) => template.group === group).map((template) => (
                      <button
                        type="button"
                        key={template.id}
                        role="option"
                        aria-selected={messageTemplateId === template.id}
                        className={messageTemplateId === template.id ? "is-selected" : ""}
                        onClick={() => {
                          const when = timeForTemplate(template);
                          setMessageTemplateId(template.id);
                          setMessageWhen(when);
                          setTemplateMenuOpen(false);
                          if (template.id !== "custom") {
                            setMessageText(fillMessageTemplate(template, when));
                          }
                        }}
                      >
                        <span className="session-message-trigger-emoji">{template.emoji}</span>
                        <span className="session-message-trigger-copy">
                          <strong>{template.label}</strong>
                          <small>{template.id === "custom" ? "Write your own message" : fillMessageTemplate(template, timeForTemplate(template))}</small>
                        </span>
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
          {selectedMessageTemplate.needsTime ? (
            <label className="session-message-time-label">
              <span>When</span>
              <input
                type="datetime-local"
                className="session-message-time"
                value={messageWhen}
                onChange={(event) => {
                  const when = event.target.value;
                  setMessageWhen(when);
                  if (selectedMessageTemplate.needsTime && messageTemplateId !== "custom") {
                    setMessageText(fillMessageTemplate(selectedMessageTemplate, when));
                  }
                }}
              />
              <small>Fills into the message as {formatMessageTime(messageWhen)}</small>
            </label>
          ) : null}
          <Form.Control
            as="textarea"
            rows={3}
            value={messageText}
            onChange={(event) => {
              setMessageTemplateId("custom");
              setMessageText(event.target.value);
            }}
            placeholder="Keep it short — this pops up over playback."
          />
        </Modal.Body>
        <Modal.Footer>
          <button type="button" className="session-command is-ghost" onClick={() => setMessageOpen(false)}>
            Cancel
          </button>
          <button
            type="button"
            className="session-command is-message"
            disabled={actionBusy || !messageText.trim()}
            onClick={async () => {
              setActionBusy(true);
              setActionError("");
              try {
                await axios.post(
                  "/api/sessions/message",
                  { sessionId: session.Id, header: "JellyGlance", text: messageText.trim() },
                  { headers: { Authorization: `Bearer ${localStorage.getItem("token")}` } }
                );
                setMessageOpen(false);
                setMessageText("");
                setMessageTemplateId("custom");
                setMessageWhen(defaultMessageDateTime(15));
                setTemplateMenuOpen(false);
              } catch (error) {
                setActionError(error?.response?.data?.error || "Unable to send message");
              } finally {
                setActionBusy(false);
              }
            }}
          >
            <ChatSmile2LineIcon size={17} />
            {actionBusy ? "Sending…" : "Send message"}
          </button>
        </Modal.Footer>
      </Modal>
      <div style={cardBgStyle} className="session-card-main rounded-top">
        <Row className="h-100 p-0 m-0">
          <Col className="session-card-banner-image">
            <Card.Img
              variant="top"
              className={
                props.data.session.NowPlayingItem.Type === "Audio"
                  ? "stat-card-image-audio rounded-0 rounded-start"
                  : "session-card-item-image"
              }
              src={
                baseUrl +
                "/proxy/Items/Images/Primary?id=" +
                mediaItemId +
                "&fillHeight=240&fillWidth=160&quality=45"
              }
              loading="lazy"
              decoding="async"
            />
          </Col>
          <Col className="w-100 h-100 m-0 px-0">
            <Card.Body className="session-card-body w-100 h-100">
              <Container className="h-100 d-flex flex-column justify-content-between g-0 session-card-layout">
                <div className="session-card-head">
                  <div className="session-title-copy">
                    <Card.Text className="session-title">
                      <span className="session-play-state">{playState.IsPaused ? <PauseFillIcon /> : <PlayFillIcon />}</span>
                      <Link to={`/libraries/item/${nowPlaying.Id}`} target="_blank" className="item-name">
                        {title}
                      </Link>
                    </Card.Text>
                    <Tooltip title={`${session.DeviceName} · ${session.Client} ${session.ApplicationVersion}`}>
                      <Card.Text className="session-subtitle">
                        {[subtitle, session.Client && `${session.Client} ${session.ApplicationVersion || ""}`.trim()].filter(Boolean).join(" · ")}
                      </Card.Text>
                    </Tooltip>
                  </div>
                  <Tooltip title={session.UserName}>
                    <Link to={`/users/${session.UserId}`} className="session-user-chip">
                      {session.UserPrimaryImageTag !== undefined ? (
                        <img
                          className="session-card-user-image"
                          src={baseUrl + "/proxy/Users/Images/Primary?id=" + session.UserId + "&fillWidth=72&quality=55"}
                          loading="lazy"
                          decoding="async"
                          alt=""
                        />
                      ) : (
                        <AccountCircleFillIcon className="session-card-user-image" />
                      )}
                      <span className="session-user-name">{session.UserName}</span>
                    </Link>
                  </Tooltip>
                </div>

                <div className="session-pills">
                  {getSessionPills(session).map((pill) => (
                    <span key={pill.key} className={`session-pill${pill.tone ? ` is-${pill.tone}` : ""}`}>
                      {pill.label}
                    </span>
                  ))}
                </div>

                <div className="session-fields">
                  <SessionField label="Device" value={session.DeviceName} />
                  <SessionField label="ETA" value={eta || <Trans i18nKey="ERROR_MESSAGES.N/A" />} />
                  {nowPlaying.AudioStream ? (
                    <SessionField
                      label="Audio"
                      value={[formatStreamDetail(nowPlaying.AudioStream), lastStreamPart(nowPlaying.AudioBitrateStream)].filter(Boolean).join(" · ")}
                      title={`${nowPlaying.AudioStream} ${nowPlaying.AudioBitrateStream || ""}`.trim()}
                    />
                  ) : null}
                  {nowPlaying.SubtitleStream ? <SessionField label="Subtitles" value={nowPlaying.SubtitleStream} /> : null}
                  {!hideIpAddress ? (
                    <SessionField
                      label="IP"
                      value={
                        isRemoteSession(session.RemoteEndPoint) &&
                        (window.env?.JS_GEOLITE_ACCOUNT_ID ?? import.meta.env.JS_GEOLITE_ACCOUNT_ID) ? (
                          <Link className="text-decoration-none text-white" onClick={() => showIPDataModal(session.RemoteEndPoint)}>
                            {session.RemoteEndPoint}
                          </Link>
                        ) : (
                          session.RemoteEndPoint
                        )
                      }
                    />
                  ) : null}
                </div>
                {canManage && isTranscoding ? <TranscodeExplainer session={session} compact /> : null}
                <SessionGlanceStrip stitch={props.stitch} />

                <div className="session-timecode">
                  <span className="session-timecode-value">{ticksToTimeString(playState.PositionTicks)}</span>
                  <span className="session-timecode-value">{nowPlaying.RunTimeTicks ? ticksToTimeString(nowPlaying.RunTimeTicks) : ""}</span>
                </div>
              </Container>
            </Card.Body>
          </Col>
        </Row>
      </div>
      <Row>
        <Col>
          <div className="progress-bar">
            <div
              className="progress-custom"
              style={{
                width: `${progressPercent}%`,
              }}
            ></div>
            {isTranscoding && transcodePercent !== null ? (
              <div
                className="progress-transcode"
                style={{ width: `${transcodePercent}%` }}
                aria-label={`Transcode progress ${Math.round(transcodePercent)} percent`}
              />
            ) : null}
          </div>
        </Col>
      </Row>
    </Card>
  );
}

export default SessionCard;

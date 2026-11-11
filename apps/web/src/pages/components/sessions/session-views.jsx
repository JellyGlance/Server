import { orderSessions } from "../../../lib/session-order";
import { isTranscodingSession } from "./session-wall";

function progressOf(session) {
  const runtime = Number(session.NowPlayingItem?.RunTimeTicks || 0);
  const position = Number(session.PlayState?.PositionTicks || 0);
  return runtime > 0 ? Math.min(100, Math.max(0, (position / runtime) * 100)) : 0;
}

function titleOf(item = {}) {
  if (item.SeriesName) {
    const code = item.ParentIndexNumber != null && item.IndexNumber != null ? ` S${String(item.ParentIndexNumber).padStart(2, "0")}E${String(item.IndexNumber).padStart(2, "0")}` : "";
    return `${item.SeriesName}${code}`;
  }
  return `${item.Name || "Unknown title"}${item.ProductionYear ? ` (${item.ProductionYear})` : ""}`;
}

// Bits per second for a session: the transcode target when transcoding,
// otherwise the source streams as reported by the server.
export function sessionBitrate(session) {
  const transcode = Number(session.TranscodingInfo?.Bitrate || 0);
  if (isTranscodingSession(session) && transcode) return transcode;
  const streams = Array.isArray(session.NowPlayingItem?.MediaStreams) ? session.NowPlayingItem.MediaStreams : [];
  const fromStreams = streams.filter((stream) => stream?.Type === "Video" || stream?.Type === "Audio").reduce((sum, stream) => sum + Number(stream.BitRate || 0), 0);
  return fromStreams || transcode || 0;
}

export function formatBitrate(bits) {
  const value = Number(bits || 0);
  if (!value) return "–";
  if (value >= 1e6) return `${(value / 1e6).toFixed(value >= 1e7 ? 0 : 1)} Mbps`;
  return `${Math.round(value / 1e3)} kbps`;
}

function transcodeReason(session) {
  const reasons = session.TranscodingInfo?.TranscodeReasons;
  const list = Array.isArray(reasons) ? reasons : typeof reasons === "string" ? reasons.split(",") : [];
  return list
    .map((reason) => String(reason).replace(/([a-z])([A-Z])/g, "$1 $2").replace(/Not Supported/i, "not supported"))
    .slice(0, 2)
    .join(", ");
}

export function SessionList({ sessions }) {
  const list = orderSessions(sessions).filter((session) => session?.NowPlayingItem);
  return (
    <div className="session-list" role="table" aria-label="Active sessions">
      {list.map((session) => {
        const transcoding = isTranscodingSession(session);
        const paused = Boolean(session.PlayState?.IsPaused);
        return (
          <div key={session.Id} className={`session-list-row${paused ? " is-paused" : ""}`} role="row">
            <span className="session-list-user" role="cell">{session.UserName || "Unknown"}</span>
            <span className="session-list-title" role="cell" title={session.NowPlayingItem?.Name || ""}>
              {titleOf(session.NowPlayingItem)}
            </span>
            <span className="session-list-device" role="cell">{session.DeviceName || session.Client || ""}</span>
            <span className={`session-list-method ${transcoding ? "is-transcode" : "is-direct"}`} role="cell">
              {paused ? "Paused" : transcoding ? "Transcode" : "Direct"}
            </span>
            <span className="session-list-progress" role="cell" aria-label={`${Math.round(progressOf(session))}% watched`}>
              <i style={{ width: `${progressOf(session)}%` }} />
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function SessionBandwidth({ sessions }) {
  const list = orderSessions(sessions).filter((session) => session?.NowPlayingItem);
  const rows = list.map((session) => ({ session, bits: sessionBitrate(session), transcoding: isTranscodingSession(session) }));
  const total = rows.reduce((sum, row) => sum + row.bits, 0);
  const transcodes = rows.filter((row) => row.transcoding);
  const max = Math.max(1, ...rows.map((row) => row.bits));
  const isDemo = list.some((session) => session.IsDemo);
  return (
    <div className="session-bandwidth">
      <div className="session-bandwidth-totals">
        <div>
          <span>Total out</span>
          <strong>{formatBitrate(total)}</strong>
        </div>
        <div>
          <span>Transcoding</span>
          <strong>
            {transcodes.length} of {rows.length}
          </strong>
        </div>
        <div>
          <span>Transcode load</span>
          <strong>{formatBitrate(transcodes.reduce((sum, row) => sum + row.bits, 0))}</strong>
        </div>
      </div>
      {isDemo ? <p className="session-bandwidth-note">Bitrates come from the saved stream details of past plays, not a live meter.</p> : null}
      <div className="session-bandwidth-rows">
        {rows.map(({ session, bits, transcoding }) => (
          <div key={session.Id} className="session-bandwidth-row">
            <div>
              <strong>{session.UserName}</strong>
              <small>
                {titleOf(session.NowPlayingItem)} · {session.DeviceName || session.Client}
              </small>
            </div>
            <span className={`session-bandwidth-bar ${transcoding ? "is-transcode" : "is-direct"}`}>
              <i style={{ width: `${Math.max(3, (bits / max) * 100)}%` }} />
            </span>
            <em>{formatBitrate(bits)}</em>
            <small className="session-bandwidth-reason">
              {transcoding
                ? `Transcode${session.TranscodingInfo?.VideoCodec ? ` to ${String(session.TranscodingInfo.VideoCodec).toUpperCase()}` : ""}${transcodeReason(session) ? ` · ${transcodeReason(session)}` : ""}`
                : String(session.PlayState?.PlayMethod || "Direct play").replace(/([a-z])([A-Z])/g, "$1 $2")}
            </small>
          </div>
        ))}
      </div>
    </div>
  );
}

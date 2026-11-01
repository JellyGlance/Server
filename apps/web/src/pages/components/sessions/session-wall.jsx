import baseUrl from "../../../lib/baseurl";

function ticksToClock(ticks) {
  const totalSeconds = Math.max(0, Math.floor(Number(ticks || 0) / 10000000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (value) => String(value).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

export function isTranscodingSession(session) {
  if (!session) return false;
  if (String(session.PlayState?.PlayMethod || "").toLowerCase() === "transcode") return true;
  return Boolean(session.TranscodingInfo && !session.TranscodingInfo.IsVideoDirect);
}

function getTitle(item) {
  if (!item) return "Unknown title";
  if (item.SeriesName) {
    const season = item.ParentIndexNumber != null ? `S${String(item.ParentIndexNumber).padStart(2, "0")}` : "";
    const episode = item.IndexNumber != null ? `E${String(item.IndexNumber).padStart(2, "0")}` : "";
    return { main: item.SeriesName, sub: `${season}${episode}${season || episode ? " · " : ""}${item.Name || ""}` };
  }
  return { main: item.Name || "Unknown title", sub: item.ProductionYear ? String(item.ProductionYear) : item.Type || "" };
}

function getArtId(item) {
  if (!item) return "";
  return item.SeriesId || item.ParentBackdropItemId || item.Id || "";
}

function SessionWallTile({ session }) {
  const item = session.NowPlayingItem || {};
  const playState = session.PlayState || {};
  const runtime = Number(item.RunTimeTicks || 0);
  const position = Number(playState.PositionTicks || 0);
  const progress = runtime > 0 ? Math.min(100, Math.max(0, (position / runtime) * 100)) : 0;
  const transcoding = isTranscodingSession(session);
  const paused = Boolean(playState.IsPaused);
  const title = getTitle(item);
  const artId = getArtId(item);

  return (
    <article className={`session-wall-tile${paused ? " is-paused" : ""}`} aria-label={`${session.UserName || "Someone"} watching ${title.main}`}>
      <div
        className="session-wall-art"
        style={artId ? { backgroundImage: `url(${baseUrl}/proxy/Items/Images/Primary?id=${artId}&fillHeight=420&fillWidth=280&quality=62)` } : undefined}
      />
      <div className="session-wall-body">
        <div className="session-wall-user">
          {session.UserId ? (
            <img
              src={`${baseUrl}/proxy/Users/Images/Primary?id=${session.UserId}&fillWidth=48&quality=55`}
              alt=""
              onError={(event) => {
                event.currentTarget.style.display = "none";
              }}
            />
          ) : null}
          <strong>{session.UserName || "Unknown user"}</strong>
          {paused ? <span className="session-wall-state">Paused</span> : null}
        </div>
        <div className="session-wall-title" title={title.main}>{title.main}</div>
        {title.sub ? <div className="session-wall-sub" title={title.sub}>{title.sub}</div> : null}
        <div className="session-wall-meta">
          <span className="session-wall-device" title={`${session.Client || ""} ${session.ApplicationVersion || ""}`.trim()}>
            {session.DeviceName || session.Client || "Unknown device"}
          </span>
          <span className={`session-wall-method ${transcoding ? "is-transcode" : "is-direct"}`}>
            {transcoding ? "Transcode" : "Direct"}
          </span>
        </div>
        <div className="session-wall-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)}>
          <span style={{ width: `${progress}%` }} />
        </div>
        <div className="session-wall-time">
          {ticksToClock(position)}
          {runtime > 0 ? ` / ${ticksToClock(runtime)}` : ""}
        </div>
      </div>
    </article>
  );
}

function SessionWall({ sessions }) {
  const list = Array.isArray(sessions) ? sessions.filter((session) => session?.NowPlayingItem) : [];
  if (list.length === 0) return null;
  return (
    <div className="session-wall-grid">
      {list.map((session) => (
        <SessionWallTile key={session.Id} session={session} />
      ))}
    </div>
  );
}

export default SessionWall;

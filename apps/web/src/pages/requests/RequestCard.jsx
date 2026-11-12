/* eslint-disable react/prop-types */
// Request and issue rows and cards for the Requests page. Rows (108px, 72x108 poster)
// are the default; cards use the Active Sessions Detailed geometry (190px, 127x190
// poster). Both share the surface, chips and avatars. The poster fills its own frame
// edge to edge; the backdrop and its shade sit only behind the text column.
import { useState } from "react";
import CheckboxCircleLineIcon from "remixicon-react/CheckboxCircleLineIcon";
import CloseCircleLineIcon from "remixicon-react/CloseCircleLineIcon";
import Edit2LineIcon from "remixicon-react/Edit2LineIcon";
import ExternalLinkLineIcon from "remixicon-react/ExternalLinkLineIcon";
import MovieLineIcon from "remixicon-react/MovieLineIcon";
import RefreshLineIcon from "remixicon-react/RefreshLineIcon";
import Tv2LineIcon from "remixicon-react/Tv2LineIcon";
import baseUrl from "../../lib/baseurl";
import { isPosterRatio, posterChain } from "./poster";
import { BAR_WIDTH, fillWidth, progressView } from "./progress";
import { itemKindLabel } from "./calendar";
import { formatDate, getInitials, getRequestAge, getRequesterAvatarUrl, getRequesterName, requestStatusChip } from "./helpers";

export function StatusChip({ tone, label, className = "" }) {
  return <span className={`rq-chip is-${tone} ${className}`.trim()}>{label}</span>;
}

// Art frame fallback: a quiet Movie or TV glyph, never the chat or error icon.
export function RequestPoster({ request, large = false }) {
  const urls = posterChain(request, baseUrl);
  const [posterIndex, setPosterIndex] = useState(0);
  const posterUrl = urls[posterIndex];
  const isTv = String(request.mediaType || "").toLowerCase().startsWith("tv");
  const next = () => setPosterIndex((current) => (current < urls.length ? current + 1 : current));

  if (posterUrl) {
    return (
      <img
        key={posterUrl}
        src={posterUrl}
        alt=""
        loading={large ? undefined : "lazy"}
        decoding="async"
        onLoad={(event) => {
          if (!isPosterRatio(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight)) next();
        }}
        onError={next}
      />
    );
  }

  return isTv ? <Tv2LineIcon size={28} /> : <MovieLineIcon size={28} />;
}

// Real Jellyfin avatar when there is one, initials underneath so a slow or missing
// image never leaves an empty circle. No person icon.
export function RequesterAvatar({ name, url, size = 24 }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className={`rq-avatar${size >= 32 ? " is-large" : ""}`} style={{ "--rq-avatar": `${size}px` }} aria-hidden="true">
      <span>{getInitials(name)}</span>
      {url && !failed ? <img src={url} alt="" decoding="async" onError={() => setFailed(true)} /> : null}
    </span>
  );
}

// Live download bar and ETA from the *arr and download client queues. The fill is a
// whole number of pixels. `Demo` marks simulated data in the demo.
export function DownloadProgress({ entry, barWidth = BAR_WIDTH, className = "" }) {
  const view = progressView(entry);
  return (
    <span
      className={`rq-dl is-${view.tone}${view.indeterminate ? " is-idle" : ""} ${className}`.trim()}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={view.pct}
      aria-valuetext={view.label}
      aria-label={view.title}
      title={view.title}
    >
      <i className="rq-dl-bar" style={{ width: `${barWidth}px` }}>
        <b style={{ width: `${fillWidth(entry, barWidth)}px` }} />
      </i>
      <span className="rq-dl-text">{view.label}</span>
      {entry.simulated ? <em className="rq-dl-demo">Demo</em> : null}
    </span>
  );
}

const DOT_LABELS = ["Requested", "Approved", "Grabbed", "Available"];

// Four 8px dots: complete, current, upcoming. The labelled timeline lives in the detail dialog.
function ProgressDots({ request }) {
  // Always four dots; a declined request shows that in its chip, not as a fifth step.
  const steps = (Array.isArray(request?.timeline) && request.timeline.length
    ? request.timeline.filter((step) => step.label !== "Declined").slice(0, 4)
    : DOT_LABELS.map((label, index) => ({ id: label, label, state: index === 0 ? "current" : "upcoming" })));
  const current = steps.find((step) => step.state === "current");
  const summary = `${steps.filter((step) => step.state === "complete").map((step) => step.label).join(", ") || "Nothing complete yet"}${current ? `; now ${current.label}` : ""}`;
  return (
    <span className="rq-dots" role="img" aria-label={`Progress: ${summary}`} title={summary}>
      {steps.map((step) => (
        <i key={step.id} className={`is-${step.state}`} />
      ))}
    </span>
  );
}

function Surface({ item, view, className = "", onOpen, children }) {
  return (
    <article
      className={`rq-card is-${view} ${className}`.trim()}
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => {
        if ((event.key === "Enter" || event.key === " ") && event.target === event.currentTarget) {
          event.preventDefault();
          onOpen();
        }
      }}
    >
      <div className="rq-poster">
        <RequestPoster request={item} />
      </div>
      <div className="rq-text">
        {item.backdropUrl ? <span className="rq-backdrop" style={{ backgroundImage: `url("${item.backdropUrl}")` }} aria-hidden="true" /> : null}
        <span className="rq-shade" aria-hidden="true" />
        {children}
      </div>
    </article>
  );
}

function Action({ title, icon: Icon, tone = "", showLabel = false, disabled, onClick }) {
  return (
    <button type="button" className={`rq-action ${tone}`.trim()} title={title} aria-label={title} disabled={disabled} onClick={onClick}>
      <Icon size={16} />
      {showLabel ? <span>{title}</span> : null}
    </button>
  );
}

export function RequestCard({ request, view = "list", canManage, readOnly, busy, progress, compact, onOpen, onAction, onEdit, onOpenSeerr }) {
  const chip = requestStatusChip(request);
  const age = getRequestAge(request.createdAt);
  const name = getRequesterName(request);
  const isTv = String(request.mediaType || "").toLowerCase().startsWith("tv");
  const TypeIcon = isTv ? Tv2LineIcon : MovieLineIcon;
  const inLibrary = request.availability?.status === "Available" && chip.key !== "available";
  const canWrite = canManage && !readOnly;
  const heading = `${request.title}${request.year ? ` (${request.year})` : ""}`;
  const isCard = view === "cards";

  return (
    <Surface item={request} view={isCard ? "cards" : "list"} className={chip.key === "failed" ? "is-failed" : ""} onOpen={() => onOpen(request)}>
      <div className="rq-body">
        <strong className="rq-title" title={heading}>{heading}</strong>
        <div className="rq-chips">
          <span className="rq-chip is-type"><TypeIcon size={12} /><span className="rq-chip-text">{isTv ? "TV" : "Movie"}</span></span>
          <StatusChip tone={chip.key} label={chip.label} />
          {inLibrary ? <StatusChip tone="available" label="In library" className="rq-chip-extra" /> : null}
          <StatusChip tone={age.level === "week" ? "failed" : "pending"} label={age.label} className="rq-age" />
          {progress ? <DownloadProgress entry={progress} barWidth={compact ? 48 : BAR_WIDTH} /> : <ProgressDots request={request} />}
        </div>
        <div className="rq-requester" title={`Requested by ${name}`}>
          <RequesterAvatar name={name} url={getRequesterAvatarUrl(request)} />
          <span className="rq-requester-name"><span>Requested by</span> <b>{name}</b></span>
          <time title={formatDate(request.createdAt)}>{formatDate(request.createdAt)}</time>
        </div>
      </div>
      <div className="rq-actions" onClick={(event) => event.stopPropagation()}>
        {canWrite && chip.key === "pending" ? (
          <>
            <Action title="Approve" icon={CheckboxCircleLineIcon} tone="is-primary" showLabel={isCard && !compact} disabled={busy} onClick={(event) => onAction(request, "approve", event)} />
            <Action title="Decline" icon={CloseCircleLineIcon} disabled={busy} onClick={(event) => onAction(request, "decline", event)} />
          </>
        ) : null}
        {canWrite && request.requestId && chip.key === "failed" ? (
          <Action title="Retry" icon={RefreshLineIcon} tone="is-primary" showLabel={isCard && !compact} disabled={busy} onClick={(event) => onAction(request, "retry", event)} />
        ) : null}
        {canWrite && request.requestId ? <Action title="Edit routing" icon={Edit2LineIcon} disabled={busy} onClick={(event) => onEdit(request, event)} /> : null}
        {canManage && request.openUrl ? <Action title={`Open in ${request.source}`} icon={ExternalLinkLineIcon} onClick={(event) => onOpenSeerr(request, event)} /> : null}
      </div>
    </Surface>
  );
}

// One title arriving on a given day. Same row as the queue, with the kind of arrival
// (Release, Premiere, S02E07) in place of the age and progress.
export function CalendarCard({ item, request, onOpen }) {
  const source = request || item;
  const chip = requestStatusChip(source);
  const name = getRequesterName(source);
  const isTv = item.mediaType === "tv";
  const TypeIcon = isTv ? Tv2LineIcon : MovieLineIcon;
  const heading = `${source.title}${source.year ? ` (${source.year})` : ""}`;
  return (
    <Surface item={source} view="list" onOpen={() => onOpen(request || item)}>
      <div className="rq-body">
        <strong className="rq-title" title={heading}>{heading}</strong>
        <div className="rq-chips">
          <span className="rq-chip is-type"><TypeIcon size={12} /><span className="rq-chip-text">{isTv ? "TV" : "Movie"}</span></span>
          <StatusChip tone="processing" label={itemKindLabel(item)} />
          <StatusChip tone={chip.key} label={chip.label} />
        </div>
        <div className="rq-requester" title={item.episodeTitle || `Requested by ${name}`}>
          <RequesterAvatar name={name} url={getRequesterAvatarUrl(source)} />
          <span className="rq-requester-name">{item.episodeTitle ? <b>{item.episodeTitle}</b> : <><span>Requested by</span> <b>{name}</b></>}</span>
          <time title={`From ${item.source}`}>{item.source}</time>
        </div>
      </div>
    </Surface>
  );
}

export function IssueCard({ issue, view = "list", readOnly, busy, episodeLabel, onOpen, onAction }) {
  const resolved = issue.status === "Resolved";
  const heading = issue.title || "Untitled media";
  const isCard = view === "cards";
  return (
    <Surface item={issue} view={isCard ? "cards" : "list"} className={resolved ? "is-resolved" : ""} onOpen={() => onOpen(issue)}>
      <div className="rq-body">
        <strong className="rq-title" title={heading}>{heading}</strong>
        <div className="rq-chips">
          <StatusChip tone={resolved ? "available" : "pending"} label={issue.status} />
          <span className="rq-chip is-type">{issue.issueType}</span>
          {episodeLabel ? <span className="rq-chip is-type">{episodeLabel}</span> : null}
        </div>
        <div className="rq-requester" title={`Reported by ${issue.createdBy}`}>
          <RequesterAvatar name={issue.createdBy} url="" />
          <span className="rq-requester-name"><span>Reported by</span> <b>{issue.createdBy}</b></span>
          <time>{formatDate(issue.createdAt)}</time>
        </div>
      </div>
      <div className="rq-actions" onClick={(event) => event.stopPropagation()}>
        {!readOnly ? (
          <>
            {issue.status === "Open" ? (
              <Action title="Resolve" icon={CheckboxCircleLineIcon} tone="is-primary" showLabel={isCard} disabled={busy} onClick={(event) => onAction(issue, "resolve", event)} />
            ) : (
              <Action title="Reopen" icon={RefreshLineIcon} showLabel={isCard} disabled={busy} onClick={(event) => onAction(issue, "reopen", event)} />
            )}
            <Action title="Delete" icon={CloseCircleLineIcon} disabled={busy} onClick={(event) => onAction(issue, "delete", event)} />
          </>
        ) : null}
      </div>
    </Surface>
  );
}

// Skeleton rows or cards at the exact size of the real ones.
export function RequestSkeleton({ view = "list", count }) {
  const total = count || (view === "cards" ? 6 : 8);
  return (
    <div className={`rq-board is-${view === "cards" ? "cards" : "list"} rq-skeleton-board`} aria-hidden="true">
      {Array.from({ length: total }, (_, index) => (
        <article key={index} className={`rq-card is-${view === "cards" ? "cards" : "list"} is-skeleton`}>
          <div className="rq-poster" />
          <div className="rq-text">
            <div className="rq-body">
              <span className="rq-skeleton-line is-title" />
              <span className="rq-skeleton-line is-chips" />
              <span className="rq-skeleton-line is-meta" />
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}

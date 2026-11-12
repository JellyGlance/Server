import { useEffect, useMemo, useRef, useState } from "react";
import ChatCheckFillIcon from "remixicon-react/ChatCheckFillIcon";
import CheckboxCircleLineIcon from "remixicon-react/CheckboxCircleLineIcon";
import CloseCircleLineIcon from "remixicon-react/CloseCircleLineIcon";
import ErrorWarningLineIcon from "remixicon-react/ErrorWarningLineIcon";
import ExternalLinkLineIcon from "remixicon-react/ExternalLinkLineIcon";
import Edit2LineIcon from "remixicon-react/Edit2LineIcon";
import FileList3LineIcon from "remixicon-react/FileList3LineIcon";
import GridLineIcon from "remixicon-react/GridLineIcon";
import AccountCircleFillIcon from "remixicon-react/AccountCircleFillIcon";
import RefreshLineIcon from "remixicon-react/RefreshLineIcon";
import SearchLineIcon from "remixicon-react/SearchLineIcon";
import MovieLineIcon from "remixicon-react/MovieLineIcon";
import Tv2LineIcon from "remixicon-react/Tv2LineIcon";
import TimeLineIcon from "remixicon-react/TimeLineIcon";
import DownloadCloud2LineIcon from "remixicon-react/DownloadCloud2LineIcon";
import CheckDoubleLineIcon from "remixicon-react/CheckDoubleLineIcon";
import AlertLineIcon from "remixicon-react/AlertLineIcon";
import FilterOffLineIcon from "remixicon-react/FilterOffLineIcon";
import InboxLineIcon from "remixicon-react/InboxLineIcon";
import BugLineIcon from "remixicon-react/BugLineIcon";
import StackLineIcon from "remixicon-react/StackLineIcon";
import CompassDiscoverLineIcon from "remixicon-react/CompassDiscoverLineIcon";
import { Modal } from "react-bootstrap";
import axios from "../lib/axios_instance";
import { cachedGet, clearApiCache } from "../lib/api-cache";
import "./css/integrations.css";
import RequestTimeline from "./requests/RequestTimeline";
import RequestSkeleton from "./requests/RequestSkeleton";
import RequestRulesModal from "./requests/RequestRulesModal";
import RequestDiscover from "./requests/RequestDiscover";
import ScalesLineIcon from "remixicon-react/Scales3LineIcon";
import { useTranslation } from "react-i18next";
import {
  formatDate,
  formatPercentScore,
  formatTenPointScore,
  getCurrentRequestOwnerCandidates,
  getInitials,
  getRequestAge,
  getRequesterAvatarUrl,
  getRequesterName,
  hasRatingValue,
  isOwnRequest,
  matchesPipelineFilter,
  PIPELINE_FILTERS,
} from "./requests/helpers";

function brandIconUrl(slug, color = "FFFFFF") {
  return `https://cdn.simpleicons.org/${slug}/${color}`;
}

function requestMediaKind(request) {
  const type = String(request?.mediaType || "").toLowerCase();
  if (type.startsWith("tv") || type.includes("show") || type.includes("series")) return "tv";
  if (type.startsWith("movie") || type.includes("film")) return "movie";
  return "other";
}

function isAttentionStatus(request) {
  const status = String(request?.status || "").toLowerCase();
  return status === "failed" || status === "error";
}

function formatSyncedAgo(value) {
  if (!value) return "";
  const minutes = Math.floor((Date.now() - new Date(value).getTime()) / 60000);
  if (!Number.isFinite(minutes) || minutes < 0) return "";
  if (minutes < 1) return "Synced just now";
  if (minutes < 60) return `Synced ${minutes} min ago`;
  return `Synced ${Math.floor(minutes / 60)} h ago`;
}

const PIPELINE_ICONS = {
  all: StackLineIcon,
  requested: TimeLineIcon,
  approved: CheckboxCircleLineIcon,
  grabbed: DownloadCloud2LineIcon,
  available: CheckDoubleLineIcon,
  declined: CloseCircleLineIcon,
};

function RequestFilterOptionAvatar({ option }) {
  if (!option?.avatarUrl && !option?.initials) return null;

  return (
    <span className="requests-filter-option-avatar">
      {option.avatarUrl ? (
        <img src={option.avatarUrl} alt="" loading="lazy" decoding="async" onError={(event) => { event.currentTarget.style.display = "none"; }} />
      ) : null}
      <span>{option.initials}</span>
    </span>
  );
}

function RequestFilterDropdown({ label, value, options, onChange }) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const selectedOption = options.find((option) => option.value === value) || options[0];

  return (
    <div
      className={`requests-filter-dropdown${isOpen ? " is-open" : ""}`}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setIsOpen(false);
        }
      }}
    >
      <span>{label}</span>
      <button type="button" aria-haspopup="listbox" aria-expanded={isOpen} onClick={() => setIsOpen((open) => !open)}>
        <RequestFilterOptionAvatar option={selectedOption} />
        <strong>{selectedOption?.label || t("FEATURES.REQUESTS.SELECT")}</strong>
      </button>
      {isOpen ? (
        <div className="requests-filter-dropdown-menu" role="listbox" tabIndex={-1}>
          {options.map((option) => (
            <button
              type="button"
              key={option.value}
              className={option.value === value ? "is-selected" : ""}
              role="option"
              aria-selected={option.value === value}
              onClick={() => {
                onChange(option.value);
                setIsOpen(false);
              }}
            >
              <RequestFilterOptionAvatar option={option} />
              <span>{option.label}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function RequesterIdentity({ request, compact = false }) {
  const { t } = useTranslation();
  const name = getRequesterName(request);
  const avatarUrl = getRequesterAvatarUrl(request);
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "?";

  return (
    <span className={`requests-user-chip${compact ? " is-compact" : ""}`}>
      <span className="requests-user-avatar">
        {avatarUrl ? (
          <img src={avatarUrl} alt="" loading="lazy" decoding="async" onError={(event) => { event.currentTarget.style.display = "none"; }} />
        ) : (
          <span>{initials}</span>
        )}
        <AccountCircleFillIcon />
      </span>
      <span>
        <small>{compact ? t("FEATURES.REQUESTS.REQUESTED_BY") : t("FEATURES.REQUESTS.REQUESTER")}</small>
        <strong>{name}</strong>
      </span>
    </span>
  );
}

function RequesterByline({ request }) {
  const { t } = useTranslation();
  const name = getRequesterName(request);
  const avatarUrl = getRequesterAvatarUrl(request);
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "?";

  return (
    <span className="requests-requester-byline">
      <span className="requests-requester-avatar">
        {avatarUrl ? (
          <img src={avatarUrl} alt="" loading="lazy" decoding="async" onError={(event) => { event.currentTarget.style.display = "none"; }} />
        ) : (
          <span>{initials}</span>
        )}
      </span>
      <span>{t("FEATURES.REQUESTS.REQUESTED_BY")} <strong>{name}</strong></span>
    </span>
  );
}

function RequestPoster({ request, large = false }) {
  const urls = request.posterUrls?.length ? request.posterUrls : request.posterUrl ? [request.posterUrl] : [];
  const [posterIndex, setPosterIndex] = useState(0);
  const posterUrl = urls[posterIndex];

  if (posterUrl) {
    return (
      <img
        src={posterUrl}
        alt=""
        loading={large ? undefined : "lazy"}
        decoding="async"
        onError={() => {
          if (posterIndex < urls.length - 1) {
            setPosterIndex((current) => current + 1);
          }
        }}
      />
    );
  }

  return String(request.status).toLowerCase() === "error" ? <ErrorWarningLineIcon /> : <ChatCheckFillIcon />;
}

export default function Requests() {
  const { t } = useTranslation();
  const [data, setData] = useState({ sources: [], requests: [], syncedAt: null });
  const [loading, setLoading] = useState(true);
  const [actionMessage, setActionMessage] = useState("");
  const [showRules, setShowRules] = useState(false);
  const [quota, setQuota] = useState(null);
  const [busyAction, setBusyAction] = useState("");
  const [mediaSearch, setMediaSearch] = useState("");
  const [mediaSourceId, setMediaSourceId] = useState("all");
  const [mediaResults, setMediaResults] = useState([]);
  const [mediaSearchLoading, setMediaSearchLoading] = useState(false);
  const [mediaSearchMessage, setMediaSearchMessage] = useState("");
  const [selectedSeasons, setSelectedSeasons] = useState({});
  const [advancedOpen, setAdvancedOpen] = useState({});
  const [requestOptions, setRequestOptions] = useState({});
  const [requestOptionForms, setRequestOptionForms] = useState({});
  const [requestOptionsLoading, setRequestOptionsLoading] = useState({});
  const [statusFilter, setStatusFilter] = useState("All");
  const [mediaTypeFilter, setMediaTypeFilter] = useState("all");
  const [attentionOnly, setAttentionOnly] = useState(false);
  const searchInputRef = useRef(null);
  const [pipelineFilter, setPipelineFilter] = useState("all");
  const [requesterFilter, setRequesterFilter] = useState("all");
  const [sortMode, setSortMode] = useState("newest");
  const [queueView, setQueueView] = useState("cards");
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [selectedRequestLoading, setSelectedRequestLoading] = useState(false);
  const [editingRequestId, setEditingRequestId] = useState("");
  const [requestPreferences, setRequestPreferences] = useState({ is4k: false });
  const [userRequestFolders, setUserRequestFolders] = useState({ movieRootFolder: "", tvRootFolder: "" });
  const [pageSection, setPageSection] = useState(() =>
    typeof window !== "undefined" && new URLSearchParams(window.location.search).get("tab") === "discover" ? "discover" : "queue"
  );
  const [discoverNonce, setDiscoverNonce] = useState(0);
  const [seerrReadOnly, setSeerrReadOnly] = useState(false);
  const [blockedIds, setBlockedIds] = useState(() => new Set());
  const [issues, setIssues] = useState([]);
  const [issuesLoading, setIssuesLoading] = useState(false);
  const [issueFilter, setIssueFilter] = useState("Open");
  const [issueSearch, setIssueSearch] = useState("");
  const [selectedIssue, setSelectedIssue] = useState(null);
  const [issueComment, setIssueComment] = useState("");
  const currentConfig = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem("config") || "{}");
    } catch {
      return {};
    }
  }, []);
  const currentRole = currentConfig?.settings?.auth?.role || "Viewer";
  const canManageRequests = currentRole === "Owner" || currentRole === "Admin";

  function loadQuota() {
    axios
      .get("/api/requests/quota", { headers: { Authorization: `Bearer ${localStorage.getItem("token")}` } })
      .then((response) => setQuota(response.data))
      .catch(() => setQuota(null));
  }

  useEffect(() => {
    loadQuota();
  }, []);
  const currentOwnerCandidates = useMemo(() => getCurrentRequestOwnerCandidates(currentConfig), [currentConfig]);

  const visibleRequests = useMemo(() => {
    const normalizedSearch = mediaSearch.trim().toLowerCase();
    const filtered = (data.requests || []).filter((request) => {
      if (!canManageRequests && !isOwnRequest(request, currentOwnerCandidates)) return false;
      if (canManageRequests && requesterFilter !== "all" && getRequesterName(request) !== requesterFilter) return false;
      const statusMatches = statusFilter === "All" || String(request.status).toLowerCase() === statusFilter.toLowerCase();
      if (!statusMatches) return false;
      if (!matchesPipelineFilter(request, pipelineFilter)) return false;
      if (mediaTypeFilter !== "all" && requestMediaKind(request) !== mediaTypeFilter) return false;
      if (attentionOnly && !isAttentionStatus(request)) return false;
      if (!normalizedSearch) return true;

      return [request.title, request.requestedBy, request.source, request.mediaType, request.status, request.pipelineLabel, request.availability?.status]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalizedSearch));
    });

    const sorted = [...filtered];
    sorted.sort((first, second) => {
      if (sortMode === "oldest") return new Date(first.createdAt || 0).getTime() - new Date(second.createdAt || 0).getTime();
      if (sortMode === "requester") return String(first.requestedBy || "").localeCompare(String(second.requestedBy || ""));
      if (sortMode === "status") return String(first.status || "").localeCompare(String(second.status || ""));
      if (sortMode === "pipeline") return String(first.pipelineStatus || "").localeCompare(String(second.pipelineStatus || ""));
      if (sortMode === "availability") {
        return String(first.availability?.status || "").localeCompare(String(second.availability?.status || ""));
      }
      return new Date(second.createdAt || 0).getTime() - new Date(first.createdAt || 0).getTime();
    });
    return sorted;
  }, [attentionOnly, canManageRequests, currentOwnerCandidates, data.requests, mediaSearch, mediaTypeFilter, pipelineFilter, requesterFilter, sortMode, statusFilter]);

  const scopedRequests = useMemo(
    () => (data.requests || []).filter((request) => canManageRequests || isOwnRequest(request, currentOwnerCandidates)),
    [canManageRequests, currentOwnerCandidates, data.requests]
  );
  const overview = useMemo(() => {
    const pending = scopedRequests.filter((request) => String(request.status).toLowerCase() === "pending");
    const oldestPending = pending.reduce((oldest, request) => {
      const time = new Date(request.createdAt || 0).getTime();
      return time && (!oldest || time < oldest) ? time : oldest;
    }, 0);
    return {
      pending,
      inProgress: scopedRequests.filter((request) => ["approved", "grabbed"].includes(String(request.pipelineStatus || "").toLowerCase())).length,
      available: scopedRequests.filter((request) => String(request.pipelineStatus || "").toLowerCase() === "available").length,
      attention: scopedRequests.filter(isAttentionStatus).length,
      oldestPending: oldestPending ? getRequestAge(new Date(oldestPending).toISOString()) : null,
      movies: scopedRequests.filter((request) => requestMediaKind(request) === "movie").length,
      tv: scopedRequests.filter((request) => requestMediaKind(request) === "tv").length,
    };
  }, [scopedRequests]);
  const filtersActive =
    statusFilter !== "All" || pipelineFilter !== "all" || requesterFilter !== "all" || mediaTypeFilter !== "all" || attentionOnly || Boolean(mediaSearch.trim());

  function clearFilters() {
    setStatusFilter("All");
    setPipelineFilter("all");
    setRequesterFilter("all");
    setMediaTypeFilter("all");
    setAttentionOnly(false);
    setMediaSearch("");
  }

  function focusTile(tile) {
    clearFilters();
    if (tile === "pending") setStatusFilter("Pending");
    if (tile === "progress") setPipelineFilter("grabbed");
    if (tile === "available") setPipelineFilter("available");
    if (tile === "attention") setAttentionOnly(true);
  }

  async function approveAllPending() {
    const targets = overview.pending.filter((request) => request.requestId && request.sourceId);
    if (!targets.length) return;
    if (!window.confirm(`Approve all ${targets.length} pending request${targets.length === 1 ? "" : "s"}?`)) return;
    setBusyAction("approve-all");
    setActionMessage("");
    let approved = 0;
    const failed = [];
    for (const request of targets) {
      try {
        await axios.post(
          `/api/requests/${encodeURIComponent(request.requestId)}/actions`,
          { sourceId: request.sourceId, action: "approve" },
          { headers: { Authorization: `Bearer ${localStorage.getItem("token")}` } }
        );
        approved += 1;
      } catch {
        failed.push(request.title);
      }
    }
    setActionMessage(
      failed.length ? `Approved ${approved} of ${targets.length}. Could not approve: ${failed.join(", ")}.` : `Approved ${approved} pending request${approved === 1 ? "" : "s"}.`
    );
    setBusyAction("");
    await loadRequests(true);
  }

  const statuses = useMemo(() => ["All", ...new Set((data.requests || []).map((request) => request.status).filter(Boolean))], [data.requests]);
  const sortOptions = useMemo(
    () => [
      { value: "newest", label: t("FEATURES.REQUESTS.SORT_NEWEST") },
      { value: "oldest", label: t("FEATURES.REQUESTS.SORT_OLDEST") },
      { value: "requester", label: t("FEATURES.REQUESTS.SORT_REQUESTER") },
      { value: "status", label: t("FEATURES.REQUESTS.SORT_STATUS") },
      { value: "pipeline", label: t("FEATURES.REQUESTS.SORT_PIPELINE") },
      { value: "availability", label: t("FEATURES.REQUESTS.SORT_AVAILABILITY") },
    ],
    [t]
  );
  const pipelineCounts = useMemo(() => {
    const counts = Object.fromEntries(PIPELINE_FILTERS.map((filter) => [filter.id, 0]));
    counts.all = (data.requests || []).length;
    (data.requests || []).forEach((request) => {
      const key = request.pipelineStatus || "requested";
      counts[key] = (counts[key] || 0) + 1;
    });
    return counts;
  }, [data.requests]);
  const requesterOptions = useMemo(
    () => {
      const requesters = new Map();
      (data.requests || []).forEach((request) => {
        const name = getRequesterName(request);
        if (!name || requesters.has(name)) return;
        requesters.set(name, {
          value: name,
          label: name,
          avatarUrl: getRequesterAvatarUrl(request),
          initials: getInitials(name),
        });
      });

      return [
        { value: "all", label: t("FEATURES.REQUESTS.ALL_USERS") },
        ...[...requesters.values()].sort((a, b) => a.label.localeCompare(b.label)),
      ];
    },
    [data.requests, t]
  );
  const seerrSources = data.sources || [];
  const visibleIssues = useMemo(() => {
    const normalizedSearch = issueSearch.trim().toLowerCase();
    return (issues || []).filter((issue) => {
      if (issueFilter !== "All" && String(issue.status) !== issueFilter) return false;
      if (!normalizedSearch) return true;
      return [issue.title, issue.createdBy, issue.issueType, issue.message, issue.source]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalizedSearch));
    });
  }, [issueFilter, issueSearch, issues]);

  function getDefaultOptionForm(options, mediaType) {
    const overrideFolder = String(mediaType || "").toLowerCase() === "tv" ? userRequestFolders.tvRootFolder : userRequestFolders.movieRootFolder;
    const overrideServerId = String(mediaType || "").toLowerCase() === "tv" ? userRequestFolders.tvServerId : userRequestFolders.movieServerId;
    const preferredServer =
      (overrideServerId != null &&
        options?.servers?.find((entry) => String(entry.server.id) === String(overrideServerId))) ||
      (requestPreferences.defaultServerId != null &&
        options?.servers?.find((entry) => String(entry.server.id) === String(requestPreferences.defaultServerId))) ||
      (requestPreferences.is4k
        ? options?.servers?.find((entry) => entry.server.is4k)
        : options?.servers?.find((entry) => entry.server.isDefault && !entry.server.is4k) || options?.servers?.find((entry) => !entry.server.is4k)) ||
      options?.servers?.[0];
    const preferredProfile =
      (requestPreferences.defaultProfileId != null &&
        preferredServer?.profiles?.find((profile) => String(profile.id) === String(requestPreferences.defaultProfileId))) ||
      preferredServer?.profiles?.find((profile) => profile.id === preferredServer.server.activeProfileId) ||
      preferredServer?.profiles?.[0];
    const preferredRoot =
      (overrideFolder && preferredServer?.rootFolders?.find((folder) => folder.path === overrideFolder)) ||
      (requestPreferences.defaultRootFolder &&
        preferredServer?.rootFolders?.find((folder) => folder.path === requestPreferences.defaultRootFolder)) ||
      preferredServer?.rootFolders?.find((folder) => folder.path === preferredServer.server.activeDirectory) ||
      preferredServer?.rootFolders?.[0];
    const preferredLanguage =
      (requestPreferences.defaultLanguageProfileId != null &&
        preferredServer?.languageProfiles?.find((profile) => String(profile.id) === String(requestPreferences.defaultLanguageProfileId))) ||
      preferredServer?.languageProfiles?.find((profile) => profile.id === preferredServer.server.activeLanguageProfileId) ||
      preferredServer?.languageProfiles?.[0];

    return {
      serverId: preferredServer?.server.id ?? "",
      profileId: preferredProfile?.id ?? "",
      rootFolder: preferredRoot?.path || preferredServer?.server.activeDirectory || "",
      languageProfileId: preferredLanguage?.id ?? "",
      tags: Array.isArray(requestPreferences.defaultTags) && requestPreferences.defaultTags.length
        ? requestPreferences.defaultTags
        : preferredServer?.server.activeTags || [],
      is4k: requestPreferences.is4k != null ? Boolean(requestPreferences.is4k) : Boolean(preferredServer?.server.is4k),
    };
  }

  async function loadRequestPreferences() {
    try {
      const response = await axios.get("/api/requests/preferences", {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      });
      setRequestPreferences(response.data?.preferences || { is4k: false });
      setUserRequestFolders(response.data?.userFolders || { movieRootFolder: "", tvRootFolder: "" });
    } catch (error) {
      console.log("Unable to load request preferences", error);
    }
  }

  async function persistRequestPreferences(updates) {
    try {
      const response = await axios.put(
        "/api/requests/preferences",
        { ...requestPreferences, ...updates },
        { headers: { Authorization: `Bearer ${localStorage.getItem("token")}` } }
      );
      setRequestPreferences(response.data?.preferences || { ...requestPreferences, ...updates });
    } catch (error) {
      console.log("Unable to save request preferences", error);
    }
  }

  function getSelectedServer(result) {
    const form = requestOptionForms[result.id] || {};
    return requestOptions[result.id]?.servers?.find((entry) => String(entry.server.id) === String(form.serverId));
  }

  function updateOptionForm(result, updates) {
    setRequestOptionForms((current) => ({
      ...current,
      [result.id]: {
        ...(current[result.id] || {}),
        ...updates,
      },
    }));
  }

  async function openRequestEditor(request, event) {
    event?.stopPropagation();
    if (!canManageRequests || !request?.requestId || !request?.sourceId) return;

    setSelectedRequest(request);
    const shouldOpen = editingRequestId !== request.id;
    setEditingRequestId(shouldOpen ? request.id : "");
    if (shouldOpen) {
      await loadRequestOptions(request);
    }
  }

  async function saveRequestEdit(request, event) {
    event?.stopPropagation();
    if (!canManageRequests || !request?.requestId || !request?.sourceId) return;

    const optionForm = requestOptionForms[request.id] || {};
    try {
      setBusyAction(`${request.id}-edit`);
      setActionMessage("");
      await axios.put(
        `/api/requests/${encodeURIComponent(request.requestId)}/edit`,
        {
          sourceId: request.sourceId,
          mediaType: request.mediaType,
          serverId: optionForm.serverId,
          profileId: optionForm.profileId,
          rootFolder: optionForm.rootFolder,
          languageProfileId: optionForm.languageProfileId,
          tags: optionForm.tags || [],
          is4k: optionForm.is4k,
          seasons: (request.requestedSeasons || []).map((season) => season.seasonNumber).filter((season) => Number.isFinite(Number(season)) && Number(season) > 0),
        },
        { headers: { Authorization: `Bearer ${localStorage.getItem("token")}` } }
      );
      setActionMessage(`Request updated in ${request.source}.`);
      setEditingRequestId("");
      await loadRequests(true);
    } catch (error) {
      setActionMessage(error.response?.data?.error || error.message || "Request edit failed");
    } finally {
      setBusyAction("");
    }
  }

  async function openRequestDetail(request) {
    setSelectedRequest(request);
    setEditingRequestId("");
    if (!request?.requestId || !request?.sourceId) return;

    try {
      setSelectedRequestLoading(true);
      const response = await axios.get(`/api/requests/${encodeURIComponent(request.requestId)}/detail`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
        params: { sourceId: request.sourceId },
      });
      setSelectedRequest((current) => (current?.id === request.id ? { ...current, ...(response.data || {}) } : current));
    } catch (error) {
      console.log("Unable to load request detail", error);
    } finally {
      setSelectedRequestLoading(false);
    }
  }

  async function openMediaResultDetail(result, event) {
    event?.stopPropagation();
    const baseResult = {
      ...result,
      isSearchResult: true,
      status: result.requested ? "Already requested" : result.availability || "Requestable",
      availability: { status: result.availability || "Unknown" },
    };

    setSelectedRequest(baseResult);
    setEditingRequestId("");
    setAdvancedOpen((current) => ({ ...current, [result.id]: true }));
    if (result.mediaType === "tv" && result.seasons?.length) {
      setSelectedSeasons((current) => ({
        ...current,
        [result.id]: current[result.id] || result.seasons.map((season) => season.seasonNumber),
      }));
    }
    setSelectedRequestLoading(true);
    loadRequestOptions(result);

    try {
      const response = await axios.get("/api/requests/media-detail", {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
        params: {
          sourceId: result.sourceId,
          mediaType: result.mediaType,
          mediaId: result.mediaId,
        },
      });
      const detail = response.data || {};
      setSelectedRequest((current) => (current?.id === result.id ? { ...current, ...detail, isSearchResult: true } : current));
      if (detail.mediaType === "tv" && detail.seasons?.length) {
        setSelectedSeasons((current) => ({
          ...current,
          [result.id]: current[result.id] || detail.seasons.map((season) => season.seasonNumber),
        }));
      }
    } catch (error) {
      console.log("Unable to load media detail", error);
      setActionMessage(error.response?.data?.error || error.message || "Unable to load media detail");
    } finally {
      setSelectedRequestLoading(false);
    }
  }

  async function loadRequests(force = false) {
    try {
      setLoading(true);
      const params = force ? { force: "true" } : undefined;
      if (force) clearApiCache("/api/requests");
      const response = await cachedGet(
        axios,
        "/api/requests",
        {
          headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
          params,
        },
        force ? 0 : 20000
      );
      setData(response.data || { sources: [], requests: [], syncedAt: null });
      const badgeCount = Number(response.data?.stats?.badgeCount || 0);
      localStorage.setItem("jellyglance_request_badge_count", String(badgeCount));
      window.dispatchEvent(new CustomEvent("jellyglance-request-count", { detail: badgeCount }));
    } finally {
      setLoading(false);
    }
  }

  async function loadIssues() {
    if (!canManageRequests) return [];
    try {
      setIssuesLoading(true);
      const response = await axios.get("/api/requests/issues", {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      });
      const nextIssues = response.data?.issues || [];
      setIssues(nextIssues);
      if (response.data?.errors?.length) {
        setActionMessage(response.data.errors.map((error) => `${error.source}: ${error.message}`).join(" · "));
      }
      return nextIssues;
    } catch (error) {
      setActionMessage(error.response?.data?.error || error.message || "Unable to load issues");
      return [];
    } finally {
      setIssuesLoading(false);
    }
  }

  function issueKey(issue) {
    return `${issue.sourceId}-${issue.id}`;
  }

  function issueEpisodeLabel(issue) {
    if (issue?.season == null || Number(issue.season) <= 0) return "";
    const season = `S${String(issue.season).padStart(2, "0")}`;
    if (issue.episode == null || Number(issue.episode) <= 0) return season;
    return `${season}E${String(issue.episode).padStart(2, "0")}`;
  }

  async function runIssueAction(issue, action, event) {
    event?.stopPropagation();
    if (!issue?.id || !issue?.sourceId) return;
    if (action === "delete" && !window.confirm(t("FEATURES.REQUESTS.DELETE_ISSUE"))) return;

    try {
      setBusyAction(`${issueKey(issue)}-${action}`);
      setActionMessage("");
      await axios.post(
        `/api/requests/issues/${encodeURIComponent(issue.id)}/actions`,
        { sourceId: issue.sourceId, action, comment: action === "comment" ? issueComment : undefined },
        { headers: { Authorization: `Bearer ${localStorage.getItem("token")}` } }
      );
      if (action === "comment") setIssueComment("");
      setActionMessage(`${action.charAt(0).toUpperCase()}${action.slice(1)} sent to ${issue.source}.`);
      const nextIssues = await loadIssues();
      if (action === "delete") {
        setSelectedIssue(null);
      } else {
        setSelectedIssue(nextIssues.find((item) => issueKey(item) === issueKey(issue)) || null);
      }
    } catch (error) {
      setActionMessage(error.response?.data?.error || error.message || "Issue action failed");
    } finally {
      setBusyAction("");
    }
  }

  async function runRequestAction(request, action, event) {
    event?.stopPropagation();
    if (!request?.requestId || !request?.sourceId) return;

    try {
      setBusyAction(`${request.id}-${action}`);
      setActionMessage("");
      if (action === "retry") {
        axios
          .post(
            "/api/retry-grab",
            {
              title: request.title,
              requestId: request.requestId,
              sourceId: request.sourceId,
              mediaType: request.mediaType,
              tmdb: request.tmdbId || request.tmdb,
              tvdb: request.tvdbId || request.tvdb,
            },
            { headers: { Authorization: `Bearer ${localStorage.getItem("token")}` } }
          )
          .catch(() => {});
      }
      await axios.post(
        `/api/requests/${encodeURIComponent(request.requestId)}/actions`,
        { sourceId: request.sourceId, action },
        { headers: { Authorization: `Bearer ${localStorage.getItem("token")}` } }
      );
      setActionMessage(`${action.charAt(0).toUpperCase()}${action.slice(1)} sent to ${request.source}.`);
      await loadRequests(true);
    } catch (error) {
      setActionMessage(error.response?.data?.error || error.message || "Action failed");
    } finally {
      setBusyAction("");
    }
  }

  async function requestMedia(result) {
    if (!result?.mediaId || !result?.sourceId) return;

    const resultKey = result.id;
    if (!result.isSearchResult && !advancedOpen[resultKey]) {
      setAdvancedOpen((current) => ({ ...current, [resultKey]: true }));
      setActionMessage(`Choose settings for ${result.title}, then confirm the request.`);
      await loadRequestOptions(result);
      return;
    }

    if (!requestOptions[resultKey] && requestOptionsLoading[resultKey]) {
      setActionMessage(`Loading settings for ${result.title}...`);
      return;
    }

    if (requestOptions[resultKey]?.error) {
      setActionMessage(requestOptions[resultKey].error);
      return;
    }

    const optionForm = requestOptionForms[resultKey] || {};
    const seasons =
      result.mediaType === "tv"
        ? selectedSeasons[resultKey]?.length
          ? selectedSeasons[resultKey]
          : (result.seasons || []).map((season) => season.seasonNumber)
        : undefined;

    try {
      setBusyAction(`media-${resultKey}`);
      setActionMessage("");
      const response = await axios.post(
        "/api/requests/media",
        {
          sourceId: result.sourceId,
          mediaType: result.mediaType,
          mediaId: result.mediaId,
          seasons,
          serverId: optionForm.serverId,
          profileId: optionForm.profileId,
          rootFolder: optionForm.rootFolder,
          languageProfileId: optionForm.languageProfileId,
          tags: optionForm.tags || [],
          is4k: optionForm.is4k,
        },
        { headers: { Authorization: `Bearer ${localStorage.getItem("token")}` } }
      );
      setActionMessage(`${result.title} sent to ${response.data?.source || result.source}${response.data?.autoApproved ? " and approved" : ""}.`);
      loadQuota();
      if (result.isSearchResult) {
        setSelectedRequest(null);
      }
      await loadRequests(true);
      runMediaSearch(true);
    } catch (error) {
      if (error.response?.data?.readOnly) {
        // The Seerr connection is read-only: remember it for this title and say so plainly.
        setBlockedIds((current) => new Set(current).add(result.id));
        setActionMessage(`Demo: request blocked. ${result.title} was not sent; this Seerr connection is read-only.`);
      } else {
        setActionMessage(error.response?.data?.error || error.message || "Media request failed");
      }
    } finally {
      setBusyAction("");
    }
  }

  async function loadRequestOptions(result) {
    if (!result?.sourceId || requestOptions[result.id] || requestOptionsLoading[result.id]) return;

    try {
      setRequestOptionsLoading((current) => ({ ...current, [result.id]: true }));
      const response = await axios.get("/api/requests/options", {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
        params: {
          sourceId: result.sourceId,
          mediaType: result.mediaType,
        },
      });
      const options = response.data || { servers: [] };
      setRequestOptions((current) => ({ ...current, [result.id]: options }));
      setRequestOptionForms((current) => ({
        ...current,
        [result.id]: current[result.id] || getDefaultOptionForm(options, result.mediaType),
      }));
    } catch (error) {
      setRequestOptions((current) => ({
        ...current,
        [result.id]: { servers: [], error: error.response?.data?.error || error.message || "Unable to load request options" },
      }));
    } finally {
      setRequestOptionsLoading((current) => ({ ...current, [result.id]: false }));
    }
  }

  function toggleAdvancedOptions(result) {
    setAdvancedOpen((current) => ({ ...current, [result.id]: !current[result.id] }));
    loadRequestOptions(result);
  }

  function handleServerChange(result, serverId) {
    const selected = requestOptions[result.id]?.servers?.find((entry) => String(entry.server.id) === String(serverId));
    const nextForm = getDefaultOptionForm({ servers: selected ? [selected] : [] }, result.mediaType);
    updateOptionForm(result, {
      ...nextForm,
      serverId,
    });
  }

  function toggleTag(result, tagId) {
    const form = requestOptionForms[result.id] || {};
    const selected = new Set((form.tags || []).map(Number));
    const numericTagId = Number(tagId);
    if (selected.has(numericTagId)) {
      selected.delete(numericTagId);
    } else {
      selected.add(numericTagId);
    }
    updateOptionForm(result, { tags: [...selected] });
  }

  function toggleSeason(result, seasonNumber) {
    setSelectedSeasons((current) => {
      const selected = new Set(current[result.id] || (result.seasons || []).map((season) => season.seasonNumber));
      if (selected.has(seasonNumber)) {
        selected.delete(seasonNumber);
      } else {
        selected.add(seasonNumber);
      }

      return {
        ...current,
        [result.id]: [...selected].sort((a, b) => a - b),
      };
    });
  }

  function selectAllSeasons(result) {
    setSelectedSeasons((current) => ({
      ...current,
      [result.id]: (result.seasons || []).map((season) => season.seasonNumber),
    }));
  }

  function clearAllSeasons(result) {
    setSelectedSeasons((current) => ({
      ...current,
      [result.id]: [],
    }));
  }

  async function runMediaSearch(force = false) {
    const query = mediaSearch.trim();
    if (pageSection !== "queue" || query.length < 2) {
      setMediaResults([]);
      setMediaSearchMessage("");
      return;
    }

    try {
      setMediaSearchLoading(true);
      setMediaSearchMessage("");
      const response = await axios.get("/api/requests/search", {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
        params: {
          query,
          ...(mediaSourceId !== "all" ? { sourceId: mediaSourceId } : {}),
          ...(force ? { t: Date.now() } : {}),
        },
      });
      setMediaResults(response.data?.results || []);
      setSelectedSeasons((current) => {
        const next = { ...current };
        (response.data?.results || []).forEach((result) => {
          if (result.mediaType === "tv" && !next[result.id]) {
            next[result.id] = (result.seasons || []).map((season) => season.seasonNumber);
          }
        });
        return next;
      });
      const errors = response.data?.errors || [];
      setMediaSearchMessage(errors.length ? errors.map((error) => `${error.source}: ${error.message}`).join(" · ") : "");
    } catch (error) {
      setMediaResults([]);
      setMediaSearchMessage(error.response?.data?.error || error.message || "Unable to search media");
    } finally {
      setMediaSearchLoading(false);
    }
  }

  function openSeerrRequest(request, event) {
    event?.stopPropagation();
    if (request?.openUrl) {
      window.open(request.openUrl, "_blank", "noopener,noreferrer");
    }
  }

  useEffect(() => {
    loadRequestPreferences();
    loadRequests();
    const intervalId = setInterval(loadRequests, 60000);
    return () => clearInterval(intervalId);
  }, []);

  useEffect(() => {
    if (pageSection !== "issues" || !canManageRequests) return;
    loadIssues();
    const intervalId = setInterval(loadIssues, 60000);
    return () => clearInterval(intervalId);
  }, [pageSection, canManageRequests]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key !== "/" || event.ctrlKey || event.metaKey || event.altKey) return;
      const tag = String(event.target?.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select" || event.target?.isContentEditable) return;
      event.preventDefault();
      searchInputRef.current?.focus();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (pageSection !== "queue") return;
    const searchTimer = setTimeout(runMediaSearch, 450);
    return () => clearTimeout(searchTimer);
  }, [mediaSearch, mediaSourceId, pageSection]);

  const selectedRequestOptions = selectedRequest ? requestOptions[selectedRequest.id] : null;
  const selectedRequestServer = selectedRequest ? getSelectedServer(selectedRequest) : null;
  const selectedRequestForm = selectedRequest ? requestOptionForms[selectedRequest.id] || {} : {};
  const selectedRequestRoot = selectedRequestServer?.rootFolders?.find((folder) => folder.path === selectedRequestForm.rootFolder);

  return (
    <div className="requests-page">
      {actionMessage ? <div className="requests-action-message">{actionMessage}</div> : null}

      <section className="requests-discovery">
        <div className="requests-discovery-head">
          <div>
            <h2>{pageSection === "issues" ? t("FEATURES.REQUESTS.ISSUES_TITLE") : pageSection === "discover" ? "Discover" : t("FEATURES.REQUESTS.TITLE")}</h2>
            <span>
              {pageSection === "issues" ? t("FEATURES.REQUESTS.ISSUES_INTRO") : pageSection === "discover" ? "Browse what Seerr suggests and request what is missing." : t("FEATURES.REQUESTS.INTRO")}
            </span>
          </div>
          <div className="requests-discovery-tools">
            <div className="requests-section-tabs" role="tablist" aria-label={t("FEATURES.REQUESTS.SECTIONS")}>
                <button type="button" role="tab" aria-selected={pageSection === "queue"} className={pageSection === "queue" ? "is-active" : ""} onClick={() => setPageSection("queue")}>
                  <InboxLineIcon size={16} />
                  {t("FEATURES.REQUESTS.QUEUE")}
                </button>
                <button type="button" role="tab" aria-selected={pageSection === "discover"} className={pageSection === "discover" ? "is-active" : ""} onClick={() => setPageSection("discover")}>
                  <CompassDiscoverLineIcon size={16} />
                  Discover
                </button>
                {canManageRequests ? (
                <button type="button" role="tab" aria-selected={pageSection === "issues"} className={pageSection === "issues" ? "is-active" : ""} onClick={() => setPageSection("issues")}>
                  <BugLineIcon size={16} />
                  {t("FEATURES.REQUESTS.ISSUES")}
                  {issues.filter((issue) => issue.status === "Open").length ? <em>{issues.filter((issue) => issue.status === "Open").length}</em> : null}
                </button>
                ) : null}
              </div>
            {quota?.enabled && quota.usage && !quota.usage.unlimited ? (
              <span className="requests-quota-chip" title="Your request allowance">
                <MovieLineIcon size={14} /> {quota.usage.movie.used}/{quota.usage.movie.limit}
                <Tv2LineIcon size={14} /> {quota.usage.tv.used}/{quota.usage.tv.limit}
              </span>
            ) : null}
            {canManageRequests ? (
              <button type="button" className="requests-refresh-button" onClick={() => setShowRules(true)} title="Request quotas and auto-approve rules">
                <ScalesLineIcon size={16} />
                <span>Rules</span>
              </button>
            ) : null}
            <button
              type="button"
              className="requests-refresh-button"
              onClick={() => (pageSection === "issues" ? loadIssues() : pageSection === "discover" ? setDiscoverNonce((value) => value + 1) : loadRequests(true))}
              disabled={loading || issuesLoading}
              title={formatSyncedAgo(data.syncedAt) || "Refresh"}
            >
              <RefreshLineIcon size={16} className={loading || issuesLoading ? "is-spinning" : ""} />
              <span>{pageSection === "queue" && data.syncedAt ? formatSyncedAgo(data.syncedAt) : "Refresh"}</span>
            </button>
            {pageSection === "queue" ? (
              <div className="requests-view-toggle" role="group" aria-label={t("FEATURES.REQUESTS.QUEUE_VIEW")}>
                <button type="button" className={queueView === "cards" ? "is-active" : ""} aria-pressed={queueView === "cards"} onClick={() => setQueueView("cards")} title={t("FEATURES.REQUESTS.CARD_VIEW")} aria-label={t("FEATURES.REQUESTS.CARD_VIEW")}>
                  <GridLineIcon size={18} />
                </button>
                <button type="button" className={queueView === "list" ? "is-active" : ""} aria-pressed={queueView === "list"} onClick={() => setQueueView("list")} title={t("FEATURES.REQUESTS.LIST_VIEW")} aria-label={t("FEATURES.REQUESTS.LIST_VIEW")}>
                  <FileList3LineIcon size={18} />
                </button>
              </div>
            ) : null}
          </div>
        </div>
        {pageSection === "queue" ? (
          <>
        <div className="requests-overview" aria-label="Request summary">
          <button type="button" className={`requests-overview-tile is-pending ${statusFilter === "Pending" ? "is-active" : ""}`} onClick={() => focusTile("pending")}>
            <TimeLineIcon size={20} />
            <strong>{overview.pending.length}</strong>
            <span>Pending approval</span>
            {overview.oldestPending ? <small>Oldest waiting {overview.oldestPending.label}</small> : <small>Nothing waiting</small>}
          </button>
          <button type="button" className={`requests-overview-tile is-progress ${pipelineFilter === "grabbed" ? "is-active" : ""}`} onClick={() => focusTile("progress")}>
            <DownloadCloud2LineIcon size={20} />
            <strong>{overview.inProgress}</strong>
            <span>In progress</span>
            <small>Approved or downloading</small>
          </button>
          <button type="button" className={`requests-overview-tile is-available ${pipelineFilter === "available" ? "is-active" : ""}`} onClick={() => focusTile("available")}>
            <CheckDoubleLineIcon size={20} />
            <strong>{overview.available}</strong>
            <span>Available</span>
            <small>Ready to watch</small>
          </button>
          <button type="button" className={`requests-overview-tile is-attention ${attentionOnly ? "is-active" : ""}`} onClick={() => focusTile("attention")}>
            <AlertLineIcon size={20} />
            <strong>{overview.attention}</strong>
            <span>Needs attention</span>
            <small>Failed or errored</small>
          </button>
          {canManageRequests && overview.pending.length ? (
            <button type="button" className="requests-approve-all" onClick={approveAllPending} disabled={Boolean(busyAction)}>
              <CheckboxCircleLineIcon size={18} />
              {busyAction === "approve-all" ? "Approving..." : `Approve all pending (${overview.pending.length})`}
            </button>
          ) : null}
        </div>
        <label className="requests-media-search">
          <SearchLineIcon size={18} />
          <input
            ref={searchInputRef}
            title="Press / to search"
            type="search"
            value={mediaSearch}
            onChange={(event) => setMediaSearch(event.target.value)}
            placeholder={t("FEATURES.REQUESTS.SEARCH_PLACEHOLDER")}
          />
          <button type="button" onClick={() => runMediaSearch(true)} disabled={mediaSearchLoading || mediaSearch.trim().length < 2}>
            {mediaSearchLoading ? t("FEATURES.REQUESTS.SEARCHING") : t("FEATURES.REQUESTS.SEARCH")}
          </button>
        </label>
        <section className={`requests-control-bar${canManageRequests ? " has-user-filter" : ""}`}>
          <RequestFilterDropdown label={t("FEATURES.REQUESTS.SORT_QUEUE")} value={sortMode} options={sortOptions} onChange={setSortMode} />
          {canManageRequests ? (
            <RequestFilterDropdown label={t("USER")} value={requesterFilter} options={requesterOptions} onChange={setRequesterFilter} />
          ) : null}
          <div className="requests-type-toggle" role="group" aria-label="Media type">
            {[
              { id: "all", label: "All", icon: StackLineIcon, count: scopedRequests.length },
              { id: "movie", label: "Movies", icon: MovieLineIcon, count: overview.movies },
              { id: "tv", label: "TV", icon: Tv2LineIcon, count: overview.tv },
            ].map((option) => {
              const Icon = option.icon;
              return (
                <button type="button" key={option.id} className={mediaTypeFilter === option.id ? "is-active" : ""} aria-pressed={mediaTypeFilter === option.id} onClick={() => setMediaTypeFilter(option.id)}>
                  <Icon size={15} />
                  {option.label}
                  <em>{option.count}</em>
                </button>
              );
            })}
          </div>
          <strong>
            {t("FEATURES.REQUESTS.SHOWN", { shown: visibleRequests.length, total: scopedRequests.length })}
            {filtersActive ? (
              <button type="button" className="requests-clear-filters" onClick={clearFilters}>
                <FilterOffLineIcon size={14} />
                Clear filters
              </button>
            ) : null}
          </strong>
        </section>
        <nav className="requests-filter-strip" aria-label={t("FEATURES.REQUESTS.STATUS_FILTERS")}>
          {statuses.map((status) => (
            <button type="button" key={status} className={statusFilter === status ? "is-active" : ""} onClick={() => setStatusFilter(status)}>
              {status === "All" ? t("FEATURES.REQUESTS.ALL") : status}
            </button>
          ))}
        </nav>
        <nav className="requests-pipeline-strip" aria-label={t("FEATURES.REQUESTS.PIPELINE_FILTERS")}>
          {PIPELINE_FILTERS.map((filter) => (
            <button
              type="button"
              key={filter.id}
              className={pipelineFilter === filter.id ? "is-active" : ""}
              onClick={() => setPipelineFilter(filter.id)}
            >
              {(() => {
                const Icon = PIPELINE_ICONS[filter.id];
                return Icon ? <Icon size={14} /> : null;
              })()}
              {t(`FEATURES.REQUESTS.PIPELINE_${filter.id}`)}
              <em>{pipelineCounts[filter.id] || 0}</em>
            </button>
          ))}
          <label className="requests-pref-4k">
            <input
              type="checkbox"
              checked={Boolean(requestPreferences.is4k)}
              onChange={(event) => {
                const is4k = event.target.checked;
                setRequestPreferences((current) => ({ ...current, is4k }));
                persistRequestPreferences({ is4k });
              }}
            />
            {t("FEATURES.REQUESTS.PREFER_4K")}
          </label>
        </nav>
        {mediaSearchMessage ? <div className="requests-discovery-message">{mediaSearchMessage}</div> : null}
        {mediaResults.length ? (
          <div className="requests-discovery-results">
            {mediaResults.map((result) => {
              const isAlreadyAvailable = result.availability === "Available";
              const isAlreadyRequested = result.requested && !isAlreadyAvailable;
              const requestDisabled = Boolean(busyAction) || isAlreadyAvailable || isAlreadyRequested;
              const requestLabel = isAlreadyAvailable
                ? t("FEATURES.REQUESTS.AVAILABLE")
                : isAlreadyRequested
                  ? t("FEATURES.REQUESTS.ALREADY_REQUESTED")
                  : t("FEATURES.REQUESTS.REQUEST_THIS");
              return (
                <article
                  key={result.id}
                  role="button"
                  tabIndex={0}
                  onClick={(event) => openMediaResultDetail(result, event)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      openMediaResultDetail(result, event);
                    }
                  }}
                >
                  <div className="requests-discovery-poster">
                    <RequestPoster request={result} />
                  </div>
                  <div className="requests-discovery-copy">
                    <strong>{result.title}{result.year ? ` (${result.year})` : ""}</strong>
                    <span>{result.mediaType === "tv" ? t("FEATURES.REQUESTS.TV") : t("FEATURES.REQUESTS.MOVIE")} · {result.source}</span>
                    <small>{result.availability || t("FEATURES.REQUESTS.UNKNOWN")}</small>
                    {result.overview ? <p>{result.overview}</p> : null}
                  </div>
                  <div className="requests-discovery-actions">
                    <button type="button" disabled={requestDisabled} onClick={(event) => openMediaResultDetail(result, event)}>
                      <ChatCheckFillIcon size={16} />
                      {requestLabel}
                    </button>
                    {canManageRequests && result.openUrl ? (
                      <button
                        type="button"
                        title={`Open in ${result.source}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          window.open(result.openUrl, "_blank", "noopener,noreferrer");
                        }}
                      >
                        <ExternalLinkLineIcon size={16} />
                      </button>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        ) : mediaSearch.trim().length >= 2 && !mediaSearchLoading ? (
          <div className="requests-discovery-empty">No Seerr results found.</div>
        ) : null}
          </>
        ) : pageSection === "issues" ? (
          <>
            <label className="requests-media-search">
              <SearchLineIcon size={18} />
              <input
                type="search"
                value={issueSearch}
                onChange={(event) => setIssueSearch(event.target.value)}
                placeholder={t("FEATURES.REQUESTS.SEARCH_ISSUES")}
              />
            </label>
            <nav className="requests-filter-strip" aria-label={t("FEATURES.REQUESTS.ISSUE_FILTERS")}>
              {["Open", "Resolved", "All"].map((status) => (
                <button type="button" key={status} className={issueFilter === status ? "is-active" : ""} onClick={() => setIssueFilter(status)}>
                  {status}
                </button>
              ))}
              <strong>{visibleIssues.length} shown from {issues.length}</strong>
            </nav>
          </>
        ) : null}
      </section>

      {pageSection === "discover" ? (
        <section className="requests-discover-board">
          <RequestDiscover blockedIds={blockedIds} onOpen={openMediaResultDetail} onReadOnly={setSeerrReadOnly} nonce={discoverNonce} />
        </section>
      ) : null}

      {pageSection === "queue" ? (
      <section className={`requests-board is-${queueView}`}>
        {loading && !(data.requests || []).length ? <RequestSkeleton /> : null}
        {visibleRequests.map((request) => {
          const age = getRequestAge(request.createdAt);
          return (
            <article
              key={request.id}
              className={String(request.status).toLowerCase() === "error" ? "is-error" : ""}
              style={{ "--request-backdrop": request.backdropUrl ? `url("${request.backdropUrl}")` : "none" }}
              role="button"
              tabIndex={0}
              onClick={() => openRequestDetail(request)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  openRequestDetail(request);
                }
              }}
            >
              <div className="requests-card-poster">
                <RequestPoster request={request} />
              </div>
              <div className="requests-card-title">
                <div>
                  <strong>{request.title}{request.year ? ` (${request.year})` : ""}</strong>
                  <span>{request.mediaType}</span>
                </div>
                <RequesterByline request={request} />
              </div>
              <div className="requests-card-meta">
                <div className="requests-card-status">
                  <b>{request.pipelineLabel || request.status}</b>
                </div>
                <div className={`requests-availability is-${String(request.availability?.status || "unknown").toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}>
                  <b>{request.availability?.status || t("FEATURES.REQUESTS.UNKNOWN")}</b>
                </div>
                <span className={`requests-age-badge is-${age.level}`}>{age.label}</span>
                {request.rootFolder ? <span className="requests-root-folder" title="Root folder">{request.rootFolder}</span> : null}
              </div>
              <RequestTimeline request={request} />
              {request.genres?.length ? (
                <div className="requests-card-tags">
                  {request.genres.slice(0, 4).map((genre) => (
                    <span key={`${request.id}-${genre}`}>{genre}</span>
                  ))}
                </div>
              ) : null}
              {request.overview ? <p className="requests-card-overview">{request.overview}</p> : null}
              <div className="requests-card-footer">
                <time>{formatDate(request.createdAt)}</time>
              </div>
              <div className="requests-card-actions">
                {canManageRequests && request.status === "Pending" ? (
                  <>
                    <button type="button" title={t("FEATURES.REQUESTS.APPROVE")} disabled={Boolean(busyAction)} onClick={(event) => runRequestAction(request, "approve", event)}>
                      <CheckboxCircleLineIcon size={16} />
                      <span>{t("FEATURES.REQUESTS.APPROVE")}</span>
                    </button>
                    <button type="button" title={t("FEATURES.REQUESTS.DECLINE")} disabled={Boolean(busyAction)} onClick={(event) => runRequestAction(request, "decline", event)}>
                      <CloseCircleLineIcon size={16} />
                      <span>{t("FEATURES.REQUESTS.DECLINE")}</span>
                    </button>
                  </>
                ) : null}
                {canManageRequests && request.requestId && request.status === "Failed" ? (
                  <button type="button" title={t("FEATURES.REQUESTS.RETRY")} disabled={Boolean(busyAction)} onClick={(event) => runRequestAction(request, "retry", event)}>
                    <RefreshLineIcon size={16} />
                    <span>{t("FEATURES.REQUESTS.RETRY")}</span>
                  </button>
                ) : null}
                {canManageRequests && request.requestId ? (
                  <button type="button" title={t("FEATURES.REQUESTS.EDIT_ROUTING")} disabled={Boolean(busyAction)} onClick={(event) => openRequestEditor(request, event)}>
                    <Edit2LineIcon size={16} />
                    <span>Edit</span>
                  </button>
                ) : null}
                {canManageRequests && request.openUrl ? (
                  <button type="button" title={`Open in ${request.source}`} onClick={(event) => openSeerrRequest(request, event)}>
                    <ExternalLinkLineIcon size={16} />
                    <span>Open</span>
                  </button>
                ) : null}
              </div>
            </article>
          );
        })}

        {!visibleRequests.length ? (
          <div className="requests-empty-state">
            <ChatCheckFillIcon size={30} />
            <strong>No requests found</strong>
            <span>{data.requests?.length ? t("FEATURES.REQUESTS.EMPTY_FILTER") : t("FEATURES.REQUESTS.EMPTY_SETUP")}</span>
          </div>
        ) : null}
      </section>
      ) : (
      <section className="requests-board is-cards requests-issues-board">
        {issuesLoading && !issues.length ? <RequestSkeleton /> : null}
        {visibleIssues.map((issue) => (
          <article
            key={issueKey(issue)}
            className={issue.status === "Resolved" ? "is-resolved" : ""}
            role="button"
            tabIndex={0}
            onClick={() => { setSelectedIssue(issue); setIssueComment(""); }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                setSelectedIssue(issue);
                setIssueComment("");
              }
            }}
          >
            <div className="requests-card-poster">
              <RequestPoster request={issue} />
            </div>
            <div className="requests-card-title">
              <div>
                <strong>{issue.title}</strong>
                <span>{issue.mediaType || t("FEATURES.REQUESTS.MEDIA")}{issueEpisodeLabel(issue) ? ` · ${issueEpisodeLabel(issue)}` : ""}</span>
              </div>
            </div>
            <div className="requests-card-meta">
              <div className="requests-card-status">
                <b>{issue.status}</b>
              </div>
              <div className="requests-availability">
                <b>{issue.issueType}</b>
              </div>
            </div>
            {issue.message ? <p className="requests-card-overview">{issue.message}</p> : null}
            <div className="requests-card-footer">
              <time>{formatDate(issue.createdAt)}</time>
              <span>Reported by {issue.createdBy}</span>
            </div>
            <div className="requests-card-actions">
              {issue.status === "Open" ? (
                <button type="button" title={t("FEATURES.REQUESTS.RESOLVE")} disabled={Boolean(busyAction)} onClick={(event) => runIssueAction(issue, "resolve", event)}>
                  <CheckboxCircleLineIcon size={16} />
                  <span>Resolve</span>
                </button>
              ) : (
                <button type="button" title={t("FEATURES.REQUESTS.REOPEN")} disabled={Boolean(busyAction)} onClick={(event) => runIssueAction(issue, "reopen", event)}>
                  <RefreshLineIcon size={16} />
                  <span>Reopen</span>
                </button>
              )}
              <button type="button" title={t("FEATURES.REQUESTS.DELETE")} disabled={Boolean(busyAction)} onClick={(event) => runIssueAction(issue, "delete", event)}>
                <CloseCircleLineIcon size={16} />
                <span>Delete</span>
              </button>
            </div>
          </article>
        ))}
        {!visibleIssues.length && !issuesLoading ? (
          <div className="requests-empty-state">
            <ErrorWarningLineIcon size={30} />
            <strong>No issues found</strong>
            <span>{issues.length ? t("FEATURES.REQUESTS.EMPTY_ISSUE_FILTER") : t("FEATURES.REQUESTS.EMPTY_ISSUES")}</span>
          </div>
        ) : null}
      </section>
      )}

      {canManageRequests ? <RequestRulesModal show={showRules} onHide={() => { setShowRules(false); loadQuota(); }} /> : null}
      <Modal show={Boolean(selectedRequest)} onHide={() => { setSelectedRequest(null); setEditingRequestId(""); }} centered size="xl" contentClassName="requests-modal">
        {selectedRequest ? (
          <>
            <Modal.Body>
              <button type="button" className="requests-modal-close" aria-label={t("CLOSE")} onClick={() => { setSelectedRequest(null); setEditingRequestId(""); }}>
                <CloseCircleLineIcon size={22} />
              </button>
              <div className="requests-detail">
                <div className="requests-detail-art">
                  <RequestPoster request={selectedRequest} large />
                </div>
                  <div className="requests-detail-copy">
                    <div className="requests-detail-heading">
                    <span>{selectedRequest.isSearchResult ? t("FEATURES.REQUESTS.NEW_REQUEST") : t("FEATURES.REQUESTS.TYPE_REQUEST", { type: selectedRequest.mediaType })}</span>
                    <div className="requests-detail-title-row">
                      <h3>{selectedRequest.title}{selectedRequest.year ? ` (${selectedRequest.year})` : ""}</h3>
                      {hasRatingValue(selectedRequest.ratings?.imdb) ||
                      hasRatingValue(selectedRequest.ratings?.rottenTomatoes) ||
                      hasRatingValue(selectedRequest.ratings?.metacritic) ||
                      hasRatingValue(selectedRequest.ratings?.tmdb || selectedRequest.rating) ? (
                        <div className="requests-rating-row requests-rating-row-title" aria-label="Ratings">
                          {hasRatingValue(selectedRequest.ratings?.imdb) ? (
                            <div className="requests-rating-card imdb">
                              <img src={brandIconUrl("imdb", "F5C518")} alt="" />
                              <strong>{formatTenPointScore(selectedRequest.ratings.imdb)}</strong>
                              <span>IMDb</span>
                            </div>
                          ) : null}
                          {hasRatingValue(selectedRequest.ratings?.rottenTomatoes) ? (
                            <div className="requests-rating-card rotten">
                              <img src={brandIconUrl("rottentomatoes", "FA320A")} alt="" />
                              <strong>{formatPercentScore(selectedRequest.ratings.rottenTomatoes)}</strong>
                              <span>Rotten Tomatoes</span>
                            </div>
                          ) : null}
                          {hasRatingValue(selectedRequest.ratings?.metacritic) ? (
                            <div className="requests-rating-card metacritic">
                              <img src={brandIconUrl("metacritic", "8054FF")} alt="" />
                              <strong>{formatPercentScore(selectedRequest.ratings.metacritic)}</strong>
                              <span>Metacritic</span>
                            </div>
                          ) : null}
                          {hasRatingValue(selectedRequest.ratings?.tmdb || selectedRequest.rating) ? (
                            <div className="requests-rating-card tmdb">
                              <img src={brandIconUrl("themoviedatabase", "01B4E4")} alt="" />
                              <strong>{formatPercentScore(selectedRequest.ratings?.tmdb || selectedRequest.rating)}</strong>
                              <span>TMDB</span>
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                    <p>{selectedRequest.overview || t("FEATURES.REQUESTS.NO_OVERVIEW")}</p>
                  </div>

                  <div className="requests-detail-meta">
                    <span className="is-type">{selectedRequest.mediaType}</span>
                    {selectedRequest.year ? <span className="is-fact">{selectedRequest.year}</span> : null}
                    {selectedRequest.runtime ? <span className="is-fact">{selectedRequest.runtime} min</span> : null}
                    <span className={`is-status is-${String(selectedRequest.status || "unknown").toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}>{selectedRequest.status}</span>
                    <span className={`is-availability is-${String(selectedRequest.availability?.status || "unknown").toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}>{t("FEATURES.REQUESTS.IN_JELLYFIN", { status: selectedRequest.availability?.status || t("FEATURES.REQUESTS.UNKNOWN") })}</span>
                    {selectedRequest.userInterest?.watchlistedBy?.length ? <span className="is-interest">Watchlisted by {selectedRequest.userInterest.watchlistedBy.join(", ")}</span> : null}
                    {selectedRequest.userInterest?.favouritedBy?.length ? <span className="is-interest">Favourited by {selectedRequest.userInterest.favouritedBy.join(", ")}</span> : null}
                  </div>

                  {!selectedRequest.isSearchResult ? <RequestTimeline request={selectedRequest} /> : null}

                  <div className="requests-detail-actions">
                    {!selectedRequest.isSearchResult && canManageRequests && selectedRequest.status === "Pending" ? (
                      <>
                        <button type="button" disabled={Boolean(busyAction)} onClick={(event) => runRequestAction(selectedRequest, "approve", event)}>
                          <CheckboxCircleLineIcon size={17} />
                          {t("FEATURES.REQUESTS.APPROVE")}
                        </button>
                        <button type="button" disabled={Boolean(busyAction)} onClick={(event) => runRequestAction(selectedRequest, "decline", event)}>
                          <CloseCircleLineIcon size={17} />
                          {t("FEATURES.REQUESTS.DECLINE")}
                        </button>
                      </>
                    ) : null}
                    {!selectedRequest.isSearchResult && canManageRequests && selectedRequest.requestId ? (
                      <button type="button" disabled={Boolean(busyAction)} onClick={(event) => openRequestEditor(selectedRequest, event)}>
                        <Edit2LineIcon size={17} />
                        {editingRequestId === selectedRequest.id ? t("FEATURES.REQUESTS.HIDE_EDIT") : t("FEATURES.REQUESTS.EDIT_REQUEST")}
                      </button>
                    ) : null}
                  </div>

                  {selectedRequest.isSearchResult ? (
                    <div className="requests-edit-panel requests-new-request-panel">
                      <div className="requests-edit-heading">
                        <div>
                          <span>Request settings</span>
                          <strong>Choose destination</strong>
                        </div>
                        {seerrSources.length > 1 ? <small>{selectedRequest.source}</small> : null}
                      </div>

                      {selectedRequest.mediaType === "tv" && selectedRequest.seasons?.length ? (
                        <div className="requests-season-picker requests-modal-season-picker">
                          <div className="requests-season-tools">
                            <span>{(selectedSeasons[selectedRequest.id] || []).length} season{(selectedSeasons[selectedRequest.id] || []).length === 1 ? "" : "s"} selected</span>
                            <button type="button" onClick={() => selectAllSeasons(selectedRequest)}>All</button>
                            <button type="button" onClick={() => clearAllSeasons(selectedRequest)}>None</button>
                          </div>
                          <div>
                            {selectedRequest.seasons.map((season) => (
                              <button
                                key={`${selectedRequest.id}-${season.seasonNumber}`}
                                type="button"
                                className={(selectedSeasons[selectedRequest.id] || []).includes(season.seasonNumber) ? "is-selected" : ""}
                                onClick={() => toggleSeason(selectedRequest, season.seasonNumber)}
                                title={season.title}
                              >
                                S{season.seasonNumber}
                              </button>
                            ))}
                          </div>
                        </div>
                      ) : null}

                      {requestOptionsLoading[selectedRequest.id] ? <span className="requests-options-status">Loading Seerr destinations...</span> : null}
                      {selectedRequestOptions?.error ? <span className="requests-options-status is-error">{selectedRequestOptions.error}</span> : null}
                      {selectedRequestOptions?.servers?.length ? (
                        <>
                          <label>
                            <span>{selectedRequest.mediaType === "tv" ? t("FEATURES.REQUESTS.SONARR_SERVER") : t("FEATURES.REQUESTS.RADARR_SERVER")}</span>
                            <select value={selectedRequestForm.serverId ?? ""} onChange={(event) => handleServerChange(selectedRequest, event.target.value)}>
                              {selectedRequestOptions.servers.map((entry) => (
                                <option key={entry.server.id} value={entry.server.id}>
                                  {entry.server.name}{entry.server.is4k ? " 4K" : ""}{entry.server.isDefault ? " default" : ""}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label>
                            <span>Quality profile</span>
                            <select value={selectedRequestForm.profileId ?? ""} onChange={(event) => updateOptionForm(selectedRequest, { profileId: event.target.value })}>
                              {(selectedRequestServer?.profiles || []).map((profile) => (
                                <option key={profile.id} value={profile.id}>{profile.name}</option>
                              ))}
                            </select>
                          </label>
                          <label className="requests-root-folder-field">
                            <span>Root folder</span>
                            <select value={selectedRequestForm.rootFolder || ""} onChange={(event) => updateOptionForm(selectedRequest, { rootFolder: event.target.value })}>
                              {(selectedRequestServer?.rootFolders || []).map((folder) => (
                                <option key={folder.path} value={folder.path}>
                                  {folder.path}{folder.freeSpaceLabel ? ` · ${folder.freeSpaceLabel} free` : ""}
                                </option>
                              ))}
                            </select>
                            {selectedRequestRoot?.freeSpaceLabel ? <small>{selectedRequestRoot.freeSpaceLabel} free</small> : null}
                          </label>
                          {selectedRequest.mediaType === "tv" && selectedRequestServer?.languageProfiles?.length ? (
                            <label>
                              <span>Language profile</span>
                              <select value={selectedRequestForm.languageProfileId ?? ""} onChange={(event) => updateOptionForm(selectedRequest, { languageProfileId: event.target.value })}>
                                {selectedRequestServer.languageProfiles.map((profile) => (
                                  <option key={profile.id} value={profile.id}>{profile.name}</option>
                                ))}
                              </select>
                            </label>
                          ) : null}
                          {selectedRequestServer?.tags?.length ? (
                            <div className="requests-tag-options">
                              <span>Tags</span>
                              <div>
                                {selectedRequestServer.tags.map((tag) => (
                                  <button
                                    key={tag.id}
                                    type="button"
                                    className={(selectedRequestForm.tags || []).map(Number).includes(Number(tag.id)) ? "is-selected" : ""}
                                    onClick={() => toggleTag(selectedRequest, tag.id)}
                                  >
                                    {tag.label}
                                  </button>
                                ))}
                              </div>
                            </div>
                          ) : null}
                          <label className="requests-edit-toggle">
                            <input
                              type="checkbox"
                              checked={Boolean(selectedRequestForm.is4k)}
                              onChange={(event) => updateOptionForm(selectedRequest, { is4k: event.target.checked })}
                            />
                            <span>4K request</span>
                          </label>
                        </>
                      ) : !requestOptionsLoading[selectedRequest.id] && !selectedRequestOptions?.error ? (
                        <span className="requests-options-status">No destination options returned by Seerr.</span>
                      ) : null}
                      <div className="requests-edit-actions">
                        {(() => {
                          const isAlreadyAvailable = selectedRequest.availability?.status === "Available";
                          const isAlreadyRequested = selectedRequest.requested && !isAlreadyAvailable;
                          const isDemoBlocked = blockedIds.has(selectedRequest.id);
                          const requestDisabled =
                            Boolean(busyAction) ||
                            isDemoBlocked ||
                            isAlreadyAvailable ||
                            isAlreadyRequested ||
                            Boolean(requestOptionsLoading[selectedRequest.id]) ||
                            Boolean(selectedRequestOptions?.error) ||
                            (selectedRequest.mediaType === "tv" && selectedRequest.seasons?.length && !(selectedSeasons[selectedRequest.id] || []).length);
                          return (
                            <button type="button" disabled={requestDisabled} onClick={() => requestMedia(selectedRequest)}>
                              <ChatCheckFillIcon size={17} />
                              {isDemoBlocked ? "Demo: request blocked" : isAlreadyAvailable ? t("FEATURES.REQUESTS.AVAILABLE") : isAlreadyRequested ? t("FEATURES.REQUESTS.ALREADY_REQUESTED") : t("FEATURES.REQUESTS.REQUEST_THIS")}
                            </button>
                          );
                        })()}
                        {blockedIds.has(selectedRequest.id) || seerrReadOnly ? (
                          <small className="requests-options-status">
                            {blockedIds.has(selectedRequest.id) ? "Nothing was sent. This Seerr connection is read-only in the demo." : "Demo: this Seerr connection is read-only, so requests are blocked."}
                          </small>
                        ) : null}
                      </div>
                    </div>
                  ) : null}

                  {!selectedRequest.isSearchResult && canManageRequests && editingRequestId === selectedRequest.id ? (
                    <div className="requests-edit-panel">
                      <div className="requests-edit-heading">
                        <div>
                          <span>Admin routing</span>
                          <strong>Edit request destination</strong>
                        </div>
                        <small>{selectedRequest.source}</small>
                      </div>
                      {requestOptionsLoading[selectedRequest.id] ? <span className="requests-options-status">Loading Seerr destinations...</span> : null}
                      {selectedRequestOptions?.error ? <span className="requests-options-status is-error">{selectedRequestOptions.error}</span> : null}
                      {selectedRequestOptions?.servers?.length ? (
                        <>
                          <label>
                            <span>{selectedRequest.mediaType === "tv" ? t("FEATURES.REQUESTS.SONARR_SERVER") : t("FEATURES.REQUESTS.RADARR_SERVER")}</span>
                            <select value={selectedRequestForm.serverId ?? ""} onChange={(event) => handleServerChange(selectedRequest, event.target.value)}>
                              {selectedRequestOptions.servers.map((entry) => (
                                <option key={entry.server.id} value={entry.server.id}>
                                  {entry.server.name}{entry.server.is4k ? " 4K" : ""}{entry.server.isDefault ? " default" : ""}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label>
                            <span>Quality profile</span>
                            <select value={selectedRequestForm.profileId ?? ""} onChange={(event) => updateOptionForm(selectedRequest, { profileId: event.target.value })}>
                              {(selectedRequestServer?.profiles || []).map((profile) => (
                                <option key={profile.id} value={profile.id}>{profile.name}</option>
                              ))}
                            </select>
                          </label>
                          <label className="requests-root-folder-field">
                            <span>Root folder</span>
                            <select value={selectedRequestForm.rootFolder || ""} onChange={(event) => updateOptionForm(selectedRequest, { rootFolder: event.target.value })}>
                              {(selectedRequestServer?.rootFolders || []).map((folder) => (
                                <option key={folder.path} value={folder.path}>
                                  {folder.path}{folder.freeSpaceLabel ? ` · ${folder.freeSpaceLabel} free` : ""}
                                </option>
                              ))}
                            </select>
                            {selectedRequestRoot?.freeSpaceLabel ? <small>{selectedRequestRoot.freeSpaceLabel} free</small> : null}
                          </label>
                          {selectedRequest.mediaType === "tv" && selectedRequestServer?.languageProfiles?.length ? (
                            <label>
                              <span>Language profile</span>
                              <select value={selectedRequestForm.languageProfileId ?? ""} onChange={(event) => updateOptionForm(selectedRequest, { languageProfileId: event.target.value })}>
                                {selectedRequestServer.languageProfiles.map((profile) => (
                                  <option key={profile.id} value={profile.id}>{profile.name}</option>
                                ))}
                              </select>
                            </label>
                          ) : null}
                          {selectedRequestServer?.tags?.length ? (
                            <div className="requests-tag-options">
                              <span>Tags</span>
                              <div>
                                {selectedRequestServer.tags.map((tag) => (
                                  <button
                                    key={tag.id}
                                    type="button"
                                    className={(selectedRequestForm.tags || []).map(Number).includes(Number(tag.id)) ? "is-selected" : ""}
                                    onClick={() => toggleTag(selectedRequest, tag.id)}
                                  >
                                    {tag.label}
                                  </button>
                                ))}
                              </div>
                            </div>
                          ) : null}
                          <label className="requests-edit-toggle">
                            <input
                              type="checkbox"
                              checked={Boolean(selectedRequestForm.is4k)}
                              onChange={(event) => updateOptionForm(selectedRequest, { is4k: event.target.checked })}
                            />
                            <span>4K request</span>
                          </label>
                          <div className="requests-edit-actions">
                            <button type="button" disabled={Boolean(busyAction)} onClick={(event) => saveRequestEdit(selectedRequest, event)}>
                              Save changes
                            </button>
                          </div>
                        </>
                      ) : !requestOptionsLoading[selectedRequest.id] && !selectedRequestOptions?.error ? (
                        <span className="requests-options-status">No destination options returned by Seerr.</span>
                      ) : null}
                    </div>
                  ) : null}

                  {selectedRequest.genres?.length ? (
                    <div className="requests-detail-tags">
                      {selectedRequest.genres.map((genre) => (
                        <span key={genre}>{genre}</span>
                      ))}
                    </div>
                  ) : null}

                  {selectedRequestLoading ? <div className="requests-detail-loading">Loading request details...</div> : null}

                  {selectedRequest.cast?.length ? (
                    <div className="requests-cast-list">
                      <strong>Cast</strong>
                      <div>
                        {selectedRequest.cast.map((person) => (
                          <article key={person.id || `${person.name}-${person.character}`}>
                            <span className="requests-cast-photo">
                              {person.imageUrl ? <img src={person.imageUrl} alt="" loading="lazy" /> : <AccountCircleFillIcon size={18} />}
                            </span>
                            <span>
                              <b>{person.name}</b>
                              {person.character ? <small>{person.character}</small> : null}
                            </span>
                          </article>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {!selectedRequest.isSearchResult ? (
                  <dl>
                    <div>
                      <dt>Requester</dt>
                      <dd><RequesterIdentity request={selectedRequest} /></dd>
                    </div>
                    <div>
                      <dt>Requested</dt>
                      <dd>{formatDate(selectedRequest.createdAt)}</dd>
                    </div>
                    {seerrSources.length > 1 ? (
                      <div>
                        <dt>Source</dt>
                        <dd>{selectedRequest.source}</dd>
                      </div>
                    ) : null}
                  </dl>
                  ) : null}

                  {!selectedRequest.isSearchResult && selectedRequest.requestedSeasons?.length ? (
                    <div className="requests-episode-list">
                      <strong>Requested episodes</strong>
                      {selectedRequest.requestedSeasons.map((season) => (
                        <section key={season.seasonNumber || "season"}>
                          <span>Season {season.seasonNumber || "unknown"}</span>
                          {season.episodes?.length ? (
                            <div>
                              {season.episodes.map((episode) => (
                                <small key={`${season.seasonNumber}-${episode.episodeNumber}`}>
                                  E{episode.episodeNumber}: {episode.title}{episode.airDate ? ` · ${formatDate(episode.airDate)}` : ""}
                                </small>
                              ))}
                            </div>
                          ) : (
                            <small>Whole season requested</small>
                          )}
                        </section>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            </Modal.Body>
          </>
        ) : null}
      </Modal>
      <Modal show={Boolean(selectedIssue)} onHide={() => setSelectedIssue(null)} centered size="lg" contentClassName="requests-modal">
        {selectedIssue ? (
          <>
            <Modal.Body>
              <button type="button" className="requests-modal-close" aria-label={t("CLOSE")} onClick={() => setSelectedIssue(null)}>
                <CloseCircleLineIcon size={22} />
              </button>
              <div className="requests-detail">
                <div className="requests-detail-art">
                  <RequestPoster request={selectedIssue} large />
                </div>
                <div className="requests-detail-copy">
                  <div className="requests-detail-heading">
                    <span>{selectedIssue.issueType} issue</span>
                    <div className="requests-detail-title-row">
                      <h3>{selectedIssue.title}</h3>
                    </div>
                  </div>
                  <div className="requests-detail-meta">
                    <span className="is-type">{selectedIssue.mediaType || "Media"}</span>
                    {issueEpisodeLabel(selectedIssue) ? <span className="is-fact">{issueEpisodeLabel(selectedIssue)}</span> : null}
                    <span className={`is-status is-${String(selectedIssue.status).toLowerCase()}`}>{selectedIssue.status}</span>
                    <span className="is-fact">Reported by {selectedIssue.createdBy}</span>
                  </div>
                  <div className="requests-detail-actions">
                    {selectedIssue.status === "Open" ? (
                      <button type="button" disabled={Boolean(busyAction)} onClick={(event) => runIssueAction(selectedIssue, "resolve", event)}>
                        <CheckboxCircleLineIcon size={17} />
                        Resolve
                      </button>
                    ) : (
                      <button type="button" disabled={Boolean(busyAction)} onClick={(event) => runIssueAction(selectedIssue, "reopen", event)}>
                        <RefreshLineIcon size={17} />
                        Reopen
                      </button>
                    )}
                    <button type="button" disabled={Boolean(busyAction)} onClick={(event) => runIssueAction(selectedIssue, "delete", event)}>
                      <CloseCircleLineIcon size={17} />
                      Delete
                    </button>
                    {canManageRequests && selectedIssue.openUrl ? (
                      <button type="button" onClick={(event) => openSeerrRequest(selectedIssue, event)}>
                        <ExternalLinkLineIcon size={17} />
                        Open in {selectedIssue.source}
                      </button>
                    ) : null}
                  </div>
                  <div className="requests-issue-comments">
                    <strong>Comments</strong>
                    {selectedIssue.comments?.length ? (
                      selectedIssue.comments.map((comment) => (
                        <p key={comment.id || comment.createdAt}>
                          <b>{comment.user || "User"}</b>
                          <span>{comment.message}</span>
                          {comment.createdAt ? <time>{formatDate(comment.createdAt)}</time> : null}
                        </p>
                      ))
                    ) : (
                      <span>No comments yet.</span>
                    )}
                    <label>
                      <span>Add a comment</span>
                      <textarea value={issueComment} onChange={(event) => setIssueComment(event.target.value)} rows={3} placeholder={t("FEATURES.REQUESTS.REPLY_PLACEHOLDER")} />
                    </label>
                    <button type="button" disabled={Boolean(busyAction) || !issueComment.trim()} onClick={(event) => runIssueAction(selectedIssue, "comment", event)}>
                      Send comment
                    </button>
                  </div>
                </div>
              </div>
            </Modal.Body>
          </>
        ) : null}
      </Modal>
    </div>
  );
}

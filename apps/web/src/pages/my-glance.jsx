import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import AccountCircleFillIcon from "remixicon-react/AccountCircleFillIcon";
import axios from "../lib/axios_instance";
import Config from "../lib/config";
import { fetchActiveSessions, getCachedActiveSessions, subscribeActiveSessions } from "../lib/session-cache";
import { slugifyUserName } from "../lib/userProfile";
import { getCurrentRequestOwnerCandidates, isOwnRequest, PIPELINE_FILTERS } from "./requests/helpers";
import { useTranslation } from "react-i18next";
import Loading from "./components/general/loading";
import AchievementsPanel from "./components/my-glance/AchievementsPanel";
import "./css/home-user-wrap.css";
import "./css/my-glance.css";

function authHeaders() {
  return { Authorization: `Bearer ${localStorage.getItem("token")}` };
}

function jellyfinUserFromConfig(config) {
  return config?.settings?.auth?.jellyfinUser || config?.user || {};
}

function nameTokens(value = "") {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((part) => part.length > 2);
}

function namesOverlap(left, right) {
  const a = new Set(nameTokens(left));
  const b = new Set(nameTokens(right));
  if (!a.size || !b.size) {
    const compactLeft = String(left || "").toLowerCase();
    const compactRight = String(right || "").toLowerCase();
    return Boolean(compactLeft && compactRight && (compactLeft.includes(compactRight) || compactRight.includes(compactLeft)));
  }
  let hits = 0;
  for (const token of a) if (b.has(token)) hits += 1;
  return hits / Math.max(a.size, b.size) > 0.42;
}

function looksLikeJellyfinId(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || ""));
}

function ticksToClock(ticks = 0) {
  const seconds = Math.max(0, Math.floor(Number(ticks || 0) / 10000000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remaining = seconds % 60;
  const pad = (value) => String(value).padStart(2, "0");
  return hours ? `${hours}:${pad(minutes)}:${pad(remaining)}` : `${minutes}:${pad(remaining)}`;
}

function Poster({ item }) {
  const [failed, setFailed] = useState(!item?.hasPrimaryImage && !item?.posterUrl && !item?.id && !item?.imageId);
  const posterUrl =
    item?.posterUrl || (item?.imageId || item?.id ? `/proxy/Items/Images/Primary?id=${item.imageId || item.id}&fillWidth=260&quality=82` : "");
  if (failed || !posterUrl) return <span>{item?.seriesName?.slice(0, 1) || item?.name?.slice(0, 1) || item?.title?.slice(0, 1) || "M"}</span>;
  return <img src={posterUrl} alt="" loading="lazy" onError={() => setFailed(true)} />;
}

function episodeLabel(item) {
  const hasSeason = item.seasonNumber !== undefined && item.seasonNumber !== null;
  const hasEpisode = item.episodeNumber !== undefined && item.episodeNumber !== null;
  const parts = [];
  if (hasSeason || hasEpisode) {
    parts.push(`S${hasSeason ? item.seasonNumber : "?"}:E${hasEpisode ? item.episodeNumber : "?"}`);
  }
  if (item.type === "Episode" && item.name) parts.push(item.name);
  return parts.join(" · ");
}

function itemHref(item) {
  if (item?.href) return item.href;
  if (item?.id && looksLikeJellyfinId(item.id)) return `/libraries/item/${item.id}`;
  if (item?.id && item.type && item.type !== "download") return `/libraries/item/${item.id}`;
  if (item?.availability?.jellyfinItemId) return `/libraries/item/${item.availability.jellyfinItemId}`;
  if (item?.jellyfinItemId) return `/libraries/item/${item.jellyfinItemId}`;
  return "/requests";
}

function collectUserKeys(lists = {}, requests = []) {
  const titles = [];
  const ids = new Set();
  for (const item of [
    ...(lists.continueWatching || []),
    ...(lists.watchlist || []),
    ...(lists.favourites || []),
    ...(lists.recentlyWatched || []),
    ...(lists.nextEpisodes || []),
  ]) {
    if (item.id) ids.add(String(item.id));
    if (item.seriesId) ids.add(String(item.seriesId));
    if (item.imageId) ids.add(String(item.imageId));
    titles.push(item.seriesName || item.name);
  }
  for (const request of requests) {
    titles.push(request.title);
    if (request.availability?.jellyfinItemId) ids.add(String(request.availability.jellyfinItemId));
  }
  return { titles: titles.filter(Boolean), ids };
}

function matchesUserLibrary(name, itemIds, { titles, ids }) {
  if (itemIds.some((id) => id && ids.has(String(id)))) return true;
  return titles.some((title) => namesOverlap(title, name));
}

function Rail({ title, subtitle, items = [], empty, actions = [], onAction }) {
  const { t } = useTranslation();
  const preview = items.slice(0, 18);
  return (
    <section className="user-media-rail">
      <div className="user-media-rail-heading">
        <div>
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </div>
        <strong>{items.length}</strong>
      </div>
      <div className="user-media-grid">
        {preview.length ? (
          preview.map((item) => {
            const heading = item.type === "Episode" && item.seriesName ? item.seriesName : item.seriesName || item.name || item.title;
            const meta = [item.type || item.mediaType, item.year, item.progress ? `${item.progress}%` : null, item.pipelineLabel || item.status]
              .filter(Boolean)
              .join(" · ");
            return (
              <article key={item.id || item.title || heading} className="user-media-card">
                <Link to={itemHref(item)}>
                  <div className="user-media-poster">
                    <Poster item={item} />
                    {Number(item.progress) > 0 && Number(item.progress) < 100 ? (
                      <span className="my-glance-progress" aria-hidden="true">
                        <i style={{ width: `${Math.min(100, Number(item.progress))}%` }} />
                      </span>
                    ) : null}
                  </div>
                  <strong>{heading}</strong>
                  <span>{meta}</span>
                  {item.type === "Episode" ? <small>{episodeLabel(item)}</small> : item.when ? <small>{item.when}</small> : null}
                </Link>
                {actions.length && item.id && looksLikeJellyfinId(item.id) ? (
                  <div className="user-media-actions">
                    {actions.map((action) => (
                      <button key={action.action} type="button" title={action.label} onClick={() => onAction?.(item, action.action)}>
                        {action.label}
                      </button>
                    ))}
                  </div>
                ) : null}
              </article>
            );
          })
        ) : (
          <div className="user-media-empty">{empty}</div>
        )}
      </div>
      {items.length > preview.length ? <div className="user-media-more">{t("FEATURES.MY_GLANCE.MORE", { count: items.length - preview.length })}</div> : null}
    </section>
  );
}

function LiveNow({ sessions }) {
  const { t } = useTranslation();
  const playing = (sessions || []).filter((session) => session?.NowPlayingItem);
  if (!playing.length) {
    return (
      <section className="my-glance-live is-idle">
        <p>{t("FEATURES.MY_GLANCE.NOW_PLAYING")}</p>
        <strong>{t("FEATURES.MY_GLANCE.NOTHING_PLAYING")}</strong>
        <span>{t("FEATURES.MY_GLANCE.NOTHING_PLAYING_HINT")}</span>
      </section>
    );
  }

  if (playing.length === 1) return <LiveSession session={playing[0]} />;

  return (
    <div className="my-glance-live-list">
      {playing.map((session) => (
        <LiveSession key={session.Id} session={session} />
      ))}
    </div>
  );
}

function LiveSession({ session }) {
  const { t } = useTranslation();
  const nowPlaying = session.NowPlayingItem;
  const playState = session.PlayState || {};
  const title = nowPlaying.Type === "Episode" && nowPlaying.SeriesName ? nowPlaying.SeriesName : nowPlaying.Name;
  const subtitle =
    nowPlaying.Type === "Episode"
      ? `${nowPlaying.Name} · S${nowPlaying.ParentIndexNumber} E${nowPlaying.IndexNumber}`
      : nowPlaying.Type || session.Client;
  const runtime = Number(nowPlaying.RunTimeTicks || 0);
  const position = Number(playState.PositionTicks || 0);
  const percent = runtime ? Math.min(100, Math.round((position / runtime) * 100)) : 0;
  const transcode = Boolean(session.TranscodingInfo);
  const itemId = nowPlaying.SeriesId || nowPlaying.Id;
  const posterId = nowPlaying.Type === "Episode" && nowPlaying.SeriesId ? nowPlaying.SeriesId : nowPlaying.Id;

  return (
    <section className="my-glance-live">
      <Link to={`/libraries/item/${nowPlaying.Id || itemId}`} className="my-glance-live-link">
        <div className="my-glance-live-poster">
          <img src={`/proxy/Items/Images/Primary?id=${posterId}&fillWidth=220&quality=80`} alt="" />
        </div>
        <div>
          <p>{t("FEATURES.MY_GLANCE.NOW_PLAYING")}</p>
          <h2>{title}</h2>
          <span>
            {subtitle} · {session.DeviceName || session.Client || t("FEATURES.MY_GLANCE.DEVICE")} · {transcode ? t("TRANSCODE") : playState.PlayMethod || t("DIRECT")}
          </span>
          <span className="my-glance-live-time">
            {ticksToClock(position)}
            {runtime ? ` / ${ticksToClock(runtime)}` : ""}
          </span>
          <span className="my-glance-progress my-glance-live-bar" aria-hidden="true">
            <i style={{ width: `${percent}%` }} />
          </span>
        </div>
      </Link>
    </section>
  );
}

export default function MyGlance() {
  const { t } = useTranslation();
  const [config, setConfig] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("config") || "null") || null;
    } catch {
      return null;
    }
  });
  const [lists, setLists] = useState(null);
  const [requests, setRequests] = useState([]);
  const [calendarReleases, setCalendarReleases] = useState(null);
  const [downloads, setDownloads] = useState(null);
  const [maintainerrItems, setMaintainerrItems] = useState(null);
  const [liveSessions, setLiveSessions] = useState(() => getCachedActiveSessions() || []);
  const [pipelineFilter, setPipelineFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState("");
  const [busyId, setBusyId] = useState("");
  const [digests, setDigests] = useState([]);
  const [digestBusyId, setDigestBusyId] = useState("");

  useEffect(() => {
    Config.getConfig().then(setConfig).catch(() => setConfig((current) => current || {}));
  }, []);

  const jellyfinUser = jellyfinUserFromConfig(config);
  const jellyfinUserId = jellyfinUser?.id || jellyfinUser?.Id || jellyfinUser?.userId || jellyfinUser?.UserId || config?.user?.id;
  const displayName = jellyfinUser?.name || jellyfinUser?.Name || config?.username || t("FEATURES.MY_GLANCE.YOU");
  const role = config?.settings?.auth?.role || t("FEATURES.MY_GLANCE.VIEWER");
  const profilePath = `/users/${slugifyUserName(displayName) || "account"}`;
  const avatarUrl = jellyfinUserId
    ? `/proxy/Users/Images/Primary?id=${encodeURIComponent(jellyfinUserId)}&fillWidth=160&quality=80`
    : "";

  useEffect(() => {
    const unsubscribe = subscribeActiveSessions((sessions) => setLiveSessions(Array.isArray(sessions) ? sessions : []));
    fetchActiveSessions().catch(() => {});
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!config) return;
    let active = true;
    async function load() {
      try {
        const [media, requestData] = await Promise.all([
          jellyfinUserId
            ? axios.get(`/api/users/${encodeURIComponent(jellyfinUserId)}/media-lists`, { headers: authHeaders() }).catch(() => ({ data: {} }))
            : Promise.resolve({ data: {} }),
          axios.get("/api/requests", { headers: authHeaders() }).catch(() => ({ data: { requests: [] } })),
        ]);
        if (!active) return;
        setLists(media.data || {});
        const owners = getCurrentRequestOwnerCandidates(config);
        const mine = (requestData.data?.requests || []).filter((request) => request.isMine || isOwnRequest(request, owners));
        setRequests(mine);

        const extras = await Promise.all([
          axios.get("/api/integrations/calendar", { headers: authHeaders() }).catch(() => null),
          axios.get("/api/integrations/downloads", { headers: authHeaders() }).catch(() => null),
          axios.get("/api/maintainerr", { headers: authHeaders() }).catch(() => null),
        ]);
        if (!active) return;
        const [calendarData, downloadData, maintainerrData] = extras;
        setCalendarReleases(calendarData ? calendarData.data?.releases || [] : null);
        setDownloads(downloadData ? downloadData.data?.items || downloadData.data || [] : null);
        const bundle = maintainerrData?.data;
        setMaintainerrItems(bundle ? [...(bundle.upcomingActions || []), ...(bundle.scheduledItems || [])] : null);
      } catch (error) {
        console.log(error);
        if (active) setLists({});
      }
    }
    load();
    return () => {
      active = false;
    };
  }, [config, jellyfinUserId]);

  const [forYou, setForYou] = useState(null);
  useEffect(() => {
    if (!jellyfinUserId) return undefined;
    let active = true;
    axios
      .get("/insights-data/for-you", { headers: authHeaders(), params: { userId: jellyfinUserId } })
      .then((response) => active && setForYou(response.data))
      .catch(() => active && setForYou(null));
    return () => {
      active = false;
    };
  }, [jellyfinUserId]);

  useEffect(() => {
    if (!config) return undefined;
    let active = true;
    axios
      .get("/api/newsletter/my-subscriptions", { headers: authHeaders() })
      .then((response) => {
        if (!active) return;
        const subscriptions = response.data?.subscriptions || [];
        setDigests(
          (response.data?.campaigns || [])
            .filter((campaign) => campaign.type === "per-user" && campaign.enabled)
            .map((campaign) => {
              const sub = subscriptions.find((row) => row.campaignId === campaign.id);
              return { ...campaign, optedIn: sub ? sub.optedIn !== false : true };
            })
        );
      })
      .catch(() => {
        if (active) setDigests([]);
      });
    return () => {
      active = false;
    };
  }, [config]);

  async function toggleDigest(campaign, optedIn) {
    setDigestBusyId(campaign.id);
    try {
      const response = await axios.put(
        "/api/newsletter/my-subscriptions",
        { campaignId: campaign.id, optedIn },
        { headers: authHeaders() }
      );
      const subscriptions = response.data?.subscriptions || [];
      setDigests((current) =>
        current.map((item) => {
          if (item.id !== campaign.id) return item;
          const sub = subscriptions.find((row) => row.campaignId === item.id);
          return { ...item, optedIn: sub ? sub.optedIn !== false : optedIn };
        })
      );
    } catch {
      setMessage(t("FEATURES.MY_GLANCE.UPDATE_FAIL"));
    } finally {
      setDigestBusyId("");
    }
  }

  const myLiveSessions = useMemo(() => {
    const playing = (Array.isArray(liveSessions) ? liveSessions : []).filter((session) => session?.NowPlayingItem);
    const byId = playing.filter((session) => String(session.UserId || "") === String(jellyfinUserId || ""));
    if (byId.length) return byId;
    return playing.filter((session) => String(session.UserName || "").toLowerCase() === String(displayName).toLowerCase());
  }, [displayName, jellyfinUserId, liveSessions]);

  const userKeys = useMemo(() => collectUserKeys(lists || {}, requests), [lists, requests]);

  const comingUp = useMemo(() => {
    if (!calendarReleases) return [];
    return calendarReleases
      .filter((release) => matchesUserLibrary(release.title, [], userKeys))
      .slice(0, 18)
      .map((release) => ({
        id: release.id,
        name: release.title,
        title: release.title,
        type: release.type === "movie" ? "Movie" : "Episode",
        posterUrl: release.posterUrl,
        pipelineLabel: release.hasFile ? t("FEATURES.MY_GLANCE.ON_DISK") : release.service,
        when: release.date
          ? new Date(release.date).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
          : release.subtitle,
        href: "/calendar",
      }));
  }, [calendarReleases, t, userKeys]);

  const arriving = useMemo(() => {
    if (!downloads) return [];
    const owners = getCurrentRequestOwnerCandidates(config || {});
    return (Array.isArray(downloads) ? downloads : [])
      .filter((item) => Number(item.progress || 0) < 100)
      .filter((item) => {
        const request = item.request || {};
        if (request.id && requests.some((row) => String(row.id) === String(request.id))) return true;
        if (request.requestedBy && isOwnRequest({ requestedBy: request.requestedBy }, owners)) return true;
        return requests.some((row) => namesOverlap(row.title, item.name) || namesOverlap(row.title, request.title));
      })
      .map((item) => ({
        id: item.id,
        name: item.name,
        title: item.name,
        type: "download",
        progress: item.progress,
        pipelineLabel: [item.client, item.state].filter(Boolean).join(" · "),
        jellyfinItemId: item.request?.jellyfinItemId,
        href: item.request?.jellyfinItemId ? `/libraries/item/${item.request.jellyfinItemId}` : "/downloads",
      }));
  }, [config, downloads, requests]);

  const atRisk = useMemo(() => {
    if (!maintainerrItems) return [];
    const seen = new Set();
    return maintainerrItems
      .filter((item) => matchesUserLibrary(item.title, [item.mediaId, item.id], userKeys))
      .filter((item) => {
        const key = `${item.mediaId || item.id}:${item.title}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 18)
      .map((item) => ({
        id: looksLikeJellyfinId(item.mediaId) ? item.mediaId : item.id,
        name: item.title,
        title: item.title,
        type: "cleanup",
        pipelineLabel: item.action || item.status || "cleanup",
        when: item.dueAt ? t("FEATURES.MY_GLANCE.DUE", { date: new Date(item.dueAt).toLocaleDateString() }) : item.collection || "Maintainerr",
        href: looksLikeJellyfinId(item.mediaId) ? `/libraries/item/${item.mediaId}` : "/maintainerr",
      }));
  }, [maintainerrItems, t, userKeys]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const match = (items = []) => {
      if (!needle) return items;
      return items.filter((item) =>
        [item.name, item.seriesName, item.title, item.type, item.year, item.pipelineLabel, item.status, item.when]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(needle))
      );
    };
    const requestItems = requests.filter((request) => pipelineFilter === "all" || String(request.pipelineStatus || "").toLowerCase() === pipelineFilter);
    return {
      continueWatching: match(lists?.continueWatching || lists?.resumable || []),
      nextEpisodes: match(lists?.nextEpisodes || []),
      recentlyWatched: match(lists?.recentlyWatched || []),
      watchlistMovies: match(lists?.watchlistByType?.movies || lists?.watchlist?.filter((item) => item.type === "Movie") || []),
      watchlistShows: match(lists?.watchlistByType?.shows || lists?.watchlist?.filter((item) => item.type === "Series") || []),
      favourites: match(lists?.favourites || []),
      staleWatchlist: match(lists?.staleWatchlist || []),
      libraryGaps: match(lists?.libraryGaps || []),
      requests: match(requestItems),
      comingUp: match(comingUp),
      arriving: match(arriving),
      atRisk: match(atRisk),
    };
  }, [arriving, atRisk, comingUp, lists, pipelineFilter, query, requests]);

  const pipelineCounts = useMemo(() => {
    const counts = { all: requests.length };
    for (const stage of PIPELINE_FILTERS) {
      if (stage.id === "all") continue;
      counts[stage.id] = requests.filter((request) => String(request.pipelineStatus || "").toLowerCase() === stage.id).length;
    }
    return counts;
  }, [requests]);

  async function reloadLists() {
    if (!jellyfinUserId) return;
    const response = await axios.get(`/api/users/${encodeURIComponent(jellyfinUserId)}/media-lists`, { headers: authHeaders() });
    setLists(response.data || {});
  }

  async function runAction(item, action) {
    if (!jellyfinUserId || !item?.id) return;
    setBusyId(`${item.id}:${action}`);
    setMessage("");
    try {
      await axios.post(
        `/api/users/${encodeURIComponent(jellyfinUserId)}/media/${encodeURIComponent(item.id)}/actions`,
        { action },
        { headers: authHeaders() }
      );
      setMessage(t("FEATURES.MY_GLANCE.UPDATED"));
      await reloadLists();
    } catch (error) {
      setMessage(error.response?.data?.error || t("FEATURES.MY_GLANCE.UPDATE_FAIL"));
    } finally {
      setBusyId("");
    }
  }

  if (!config || !lists) return <Loading />;

  const stats = [
    { label: t("FEATURES.MY_GLANCE.CONTINUE"), value: (lists.continueWatching || lists.resumable || []).length },
    { label: t("FEATURES.MY_GLANCE.WATCHLIST"), value: (lists.watchlist || []).length },
    { label: t("FEATURES.MY_GLANCE.FAVOURITES"), value: (lists.favourites || []).length },
    { label: t("FEATURES.MY_GLANCE.MY_REQUESTS"), value: requests.length },
  ];
  const taste = [...(lists.taste?.genres || []).slice(0, 8), ...(lists.taste?.actors || []).slice(0, 4), ...(lists.taste?.studios || []).slice(0, 4)];

  return (
    <div className="my-glance-page">
      <header className="my-glance-hero">
        <div className="my-glance-identity">
          <span className="my-glance-avatar">
            {avatarUrl ? (
              <img
                src={avatarUrl}
                alt=""
                onError={(event) => {
                  event.currentTarget.style.display = "none";
                }}
              />
            ) : null}
            <AccountCircleFillIcon size={42} />
          </span>
          <div>
            <p>{t("FEATURES.MY_GLANCE.TITLE")}</p>
            <h1>{displayName}</h1>
            <span>{t("FEATURES.MY_GLANCE.INTRO", { role })}</span>
          </div>
        </div>
        <div className="my-glance-hero-actions">
          <Link to="/requests">{t("FEATURES.MY_GLANCE.OPEN_REQUESTS")}</Link>
          <Link to={profilePath} className="is-ghost">
            {t("FEATURES.MY_GLANCE.FULL_PROFILE")}
          </Link>
        </div>
      </header>

      <LiveNow sessions={myLiveSessions} />

      <div className="my-glance-stats">
        {stats.map((stat) => (
          <div key={stat.label}>
            <strong>{stat.value}</strong>
            <span>{stat.label}</span>
          </div>
        ))}
      </div>

      {jellyfinUserId ? <AchievementsPanel userId={jellyfinUserId} /> : null}

      {digests.length ? (
        <section className="my-glance-digest">
          <p>{t("FEATURES.MY_GLANCE.DIGEST")}</p>
          <span>{t("FEATURES.MY_GLANCE.DIGEST_SUB")}</span>
          {digests.map((campaign) => (
            <div key={campaign.id}>
              <strong>{campaign.name}</strong>
              <button
                type="button"
                disabled={digestBusyId === campaign.id}
                onClick={() => toggleDigest(campaign, !campaign.optedIn)}
              >
                {campaign.optedIn ? t("FEATURES.NEWSLETTER.OPT_OUT") : t("FEATURES.NEWSLETTER.OPT_IN")}
              </button>
            </div>
          ))}
        </section>
      ) : null}

      {taste.length ? (
        <section className="my-glance-taste">
          <p>{t("FEATURES.MY_GLANCE.TASTE")}</p>
          <div>
            {taste.map((item) => (
              <span key={`${item.name}-${item.count}`}>{item.name}</span>
            ))}
          </div>
        </section>
      ) : null}

      <nav className="my-glance-pipeline" aria-label={t("FEATURES.MY_GLANCE.PIPELINE")}>
        {PIPELINE_FILTERS.map((stage) => (
          <button
            key={stage.id}
            type="button"
            className={pipelineFilter === stage.id ? "is-active" : ""}
            onClick={() => setPipelineFilter(stage.id)}
          >
            {t(`FEATURES.REQUESTS.PIPELINE_${stage.id}`)}
            <strong>{pipelineCounts[stage.id] || 0}</strong>
          </button>
        ))}
      </nav>

      <div className="my-glance-toolbar">
        <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("FEATURES.MY_GLANCE.SEARCH")} />
        {message ? <em>{busyId ? t("FEATURES.MY_GLANCE.UPDATING") : message}</em> : <em>{t("FEATURES.MY_GLANCE.ACTIONS_HINT")}</em>}
      </div>

      {!jellyfinUserId ? (
        <div className="user-media-empty">{t("FEATURES.MY_GLANCE.SIGN_IN")}</div>
      ) : null}

      <Rail
        title={t("FEATURES.MY_GLANCE.CONTINUE_WATCHING")}
        subtitle={t("FEATURES.MY_GLANCE.CONTINUE_SUB")}
        items={filtered.continueWatching}
        empty={t("FEATURES.MY_GLANCE.EMPTY_CONTINUE")}
        onAction={runAction}
        actions={[{ label: t("FEATURES.MY_GLANCE.WATCHED"), action: "markWatched" }]}
      />
      <Rail
        title={t("FEATURES.MY_GLANCE.UP_NEXT")}
        subtitle={t("FEATURES.MY_GLANCE.UP_NEXT_SUB")}
        items={filtered.nextEpisodes}
        empty={t("FEATURES.MY_GLANCE.EMPTY_UP_NEXT")}
        onAction={runAction}
        actions={[{ label: t("FEATURES.MY_GLANCE.WATCHED"), action: "markWatched" }]}
      />
      {forYou?.picks?.length ? (
        <Rail title="Picked for you" subtitle="Unwatched titles from your library that match what you watch most" items={forYou.picks} empty="" />
      ) : null}
      {(forYou?.because || []).map((row) => (
        <Rail key={row.seed.id} title={`Because you watched ${row.seed.name}`} subtitle="Similar genres you haven't played yet" items={row.items} empty="" />
      ))}
      {calendarReleases ? (
        <Rail title={t("FEATURES.MY_GLANCE.COMING_UP")} subtitle={t("FEATURES.MY_GLANCE.COMING_UP_SUB")} items={filtered.comingUp} empty={t("FEATURES.MY_GLANCE.EMPTY_COMING")} />
      ) : null}
      {downloads ? (
        <Rail title={t("FEATURES.MY_GLANCE.ARRIVING")} subtitle={t("FEATURES.MY_GLANCE.ARRIVING_SUB")} items={filtered.arriving} empty={t("FEATURES.MY_GLANCE.EMPTY_ARRIVING")} />
      ) : null}
      {maintainerrItems ? (
        <Rail title={t("FEATURES.MY_GLANCE.AT_RISK")} subtitle={t("FEATURES.MY_GLANCE.AT_RISK_SUB")} items={filtered.atRisk} empty={t("FEATURES.MY_GLANCE.EMPTY_AT_RISK")} />
      ) : null}
      <Rail
        title={t("FEATURES.MY_GLANCE.WATCHLIST_MOVIES")}
        subtitle={t("FEATURES.MY_GLANCE.SAVED_JELLYFIN")}
        items={filtered.watchlistMovies}
        empty={t("FEATURES.MY_GLANCE.EMPTY_WATCHLIST_MOVIES")}
        onAction={runAction}
        actions={[
          { label: t("FEATURES.MY_GLANCE.REMOVE"), action: "removeWatchlist" },
          { label: t("FEATURES.MY_GLANCE.FAVOURITE"), action: "favourite" },
        ]}
      />
      <Rail
        title={t("FEATURES.MY_GLANCE.WATCHLIST_SHOWS")}
        subtitle={t("FEATURES.MY_GLANCE.SAVED_JELLYFIN")}
        items={filtered.watchlistShows}
        empty={t("FEATURES.MY_GLANCE.EMPTY_WATCHLIST_SHOWS")}
        onAction={runAction}
        actions={[{ label: t("FEATURES.MY_GLANCE.REMOVE"), action: "removeWatchlist" }, { label: t("FEATURES.MY_GLANCE.FAVOURITE"), action: "favourite" }]}
      />
      <Rail
        title={t("FEATURES.MY_GLANCE.STALE")}
        subtitle={t("FEATURES.MY_GLANCE.STALE_SUB")}
        items={filtered.staleWatchlist}
        empty={t("FEATURES.MY_GLANCE.EMPTY_STALE")}
        onAction={runAction}
        actions={[{ label: t("FEATURES.MY_GLANCE.REMOVE"), action: "removeWatchlist" }]}
      />
      <Rail title={t("FEATURES.MY_GLANCE.GAPS")} subtitle={t("FEATURES.MY_GLANCE.GAPS_SUB")} items={filtered.libraryGaps} empty={t("FEATURES.MY_GLANCE.EMPTY_GAPS")} />
      <Rail
        title={t("FEATURES.MY_GLANCE.FAVOURITES")}
        subtitle={t("FEATURES.MY_GLANCE.FAVOURITES_SUB")}
        items={filtered.favourites}
        empty={t("FEATURES.MY_GLANCE.EMPTY_FAVOURITES")}
        onAction={runAction}
        actions={[{ label: t("FEATURES.MY_GLANCE.UNFAVOURITE"), action: "unfavourite" }]}
      />
      <Rail title={t("FEATURES.MY_GLANCE.RECENT")} subtitle={t("FEATURES.MY_GLANCE.RECENT_SUB")} items={filtered.recentlyWatched} empty={t("FEATURES.MY_GLANCE.EMPTY_RECENT")} />
      <Rail title={t("FEATURES.MY_GLANCE.MY_REQUESTS")} subtitle={t("FEATURES.MY_GLANCE.REQUESTS_SUB")} items={filtered.requests} empty={t("FEATURES.MY_GLANCE.EMPTY_REQUESTS")} />
    </div>
  );
}

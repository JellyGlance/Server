import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import axios from "../lib/axios_instance";
import Config from "../lib/config";
import { slugifyUserName } from "../lib/userProfile";
import Loading from "./components/general/loading";
import UserInfo from "./components/user-info";
import { AccountDashboard, QuickConnectUserWrap } from "./components/home/UserWrapUpDashboard";
import "./css/home-user-wrap.css";
import { mediaServerName } from "../lib/media-server";

const token = localStorage.getItem("token");
const PROFILE_SECTIONS = [
  { id: "overview", label: "Overview" },
  { id: "media", label: "Media" },
  { id: "taste", label: "Taste" },
  { id: "household", label: "Household" },
];

function MediaPoster({ item }) {
  const [failed, setFailed] = useState(!item?.hasPrimaryImage);

  if (failed) {
    return <span>{item?.type?.slice(0, 1) || "M"}</span>;
  }

  return (
    <img
      src={`/proxy/Items/Images/Primary?id=${item.imageId || item.id}&fillWidth=260&quality=82`}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

function UserMediaRail({ title, subtitle, items = [], onAction, actions = [], variant = "" }) {
  const previewItems = items.slice(0, 18);

  function episodeLabel(item) {
    const hasSeason = item.seasonNumber !== undefined && item.seasonNumber !== null;
    const hasEpisode = item.episodeNumber !== undefined && item.episodeNumber !== null;
    const parts = [];

    if (hasSeason || hasEpisode) {
      parts.push(`S${hasSeason ? item.seasonNumber : "?"}:E${hasEpisode ? item.episodeNumber : "?"}`);
    }
    if (item.name) {
      parts.push(item.name);
    }

    return parts.join(" · ");
  }

  return (
    <section className={`user-media-rail${variant ? ` is-${variant}` : ""}`}>
      <div className="user-media-rail-heading">
        <div>
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </div>
        <strong>{items.length}</strong>
      </div>
      <div className="user-media-grid">
        {previewItems.length ? (
          previewItems.map((item) => (
            <article key={item.id} className="user-media-card">
              <Link to={`/libraries/item/${item.id}`}>
                <div className="user-media-poster">
                  <MediaPoster item={item} />
                </div>
                <strong>{item.type === "Episode" && item.seriesName ? item.seriesName : item.name}</strong>
                <span>
                  {item.type}
                  {item.year ? ` · ${item.year}` : ""}
                  {item.progress ? ` · ${item.progress}%` : ""}
                </span>
                {item.type === "Episode" ? <small>{episodeLabel(item)}</small> : item.reason ? (
                  <small>Because of {item.reason}</small>
                ) : item.users?.length ? (
                  <small>{item.users.join(", ")}</small>
                ) : null}
              </Link>
              {actions.length ? (
                <div className="user-media-actions">
                  {actions.map((action) => (
                    <button key={action.action} type="button" title={action.label} onClick={() => onAction?.(item, action.action)}>
                      {action.label}
                    </button>
                  ))}
                </div>
              ) : null}
            </article>
          ))
        ) : (
          <div className="user-media-empty">Nothing here yet.</div>
        )}
      </div>
      {items.length > previewItems.length ? <div className="user-media-more">{items.length - previewItems.length} more hidden by this compact rail.</div> : null}
    </section>
  );
}

export default function UserProfilePage() {
  const { UserId: userKey = "" } = useParams();
  const [profileUser, setProfileUser] = useState(null);
  const [profileRank, setProfileRank] = useState(0);
  const [access, setAccess] = useState(null);
  const [profileForbidden, setProfileForbidden] = useState(false);
  const [config, setConfig] = useState(null);
  const [mediaLists, setMediaLists] = useState({ favourites: [], watchlist: [] });
  const [mediaListsLoading, setMediaListsLoading] = useState(false);
  const [mediaSearch, setMediaSearch] = useState("");
  const [mediaMessage, setMediaMessage] = useState("");
  const [activeProfileSection, setActiveProfileSection] = useState("overview");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchProfileData() {
      try {
        const [configResponse, profileResponse, accessResponse] = await Promise.all([
          Config.getConfig(),
          axios
            .get("/stats/getUserProfileWrapUp", {
              params: { user: decodeURIComponent(userKey) },
              headers: { Authorization: `Bearer ${token}` },
            })
            .catch(async (error) => {
              // 403 means this isn't the signed-in user's own profile.
              if (error.response?.status === 403) {
                return { data: { user: null, rank: 0, forbidden: true } };
              }
              // 404 means no such user, so only fall back to the full list for other errors.
              if (error.response?.status !== 404) {
                const fallback = await axios.get("/stats/getUserWrapUp", { headers: { Authorization: `Bearer ${token}` } });
                const rankedUsers = [...(fallback.data || [])].sort((a, b) => Number(b.TotalWatchTime || 0) - Number(a.TotalWatchTime || 0));
                const normalizedKey = decodeURIComponent(userKey).toLowerCase();
                const matchedUser = rankedUsers.find((user) => {
                  return user.UserId?.toLowerCase?.() === normalizedKey || slugifyUserName(user.UserName) === normalizedKey;
                });

                return {
                  data: {
                    user: matchedUser || null,
                    rank: matchedUser ? rankedUsers.findIndex((user) => user.UserId === matchedUser.UserId) + 1 : 0,
                  },
                };
              }

              return { data: { user: null, rank: 0 } };
            }),
          // Account management details need the Users permission; the profile itself doesn't.
          axios.get("/api/userAccess", { headers: { Authorization: `Bearer ${token}` } }).catch(() => ({ data: null })),
        ]);

        setConfig(configResponse);
        setProfileUser(profileResponse.data?.user || null);
        setProfileRank(Number(profileResponse.data?.rank || 0));
        setProfileForbidden(Boolean(profileResponse.data?.forbidden));
        setAccess(accessResponse.data);
      } catch (error) {
        console.log(error);
      } finally {
        setLoading(false);
      }
    }

    fetchProfileData();
    const intervalId = setInterval(fetchProfileData, 60000 * 5);
    return () => clearInterval(intervalId);
  }, [userKey]);

  const matchedUser = profileUser;
  const rank = profileRank;
  const localUsers = access?.localUsers || [];
  const localUser = localUsers.find((user) => slugifyUserName(user.username) === decodeURIComponent(userKey).toLowerCase());

  useEffect(() => {
    let active = true;

    async function fetchMediaLists() {
      if (!matchedUser?.UserId) {
        setMediaLists({ favourites: [], watchlist: [] });
        setMediaListsLoading(false);
        return;
      }

      setMediaListsLoading(true);
      try {
        const response = await axios.get(`/api/users/${encodeURIComponent(matchedUser.UserId)}/media-lists`, {
          params: { full: "true" },
          headers: { Authorization: `Bearer ${token}` },
        });
        if (active) {
          setMediaLists(response.data || { favourites: [], watchlist: [] });
        }
      } catch (error) {
        console.log(error);
        if (active) {
          setMediaLists({ favourites: [], watchlist: [] });
        }
      } finally {
        if (active) {
          setMediaListsLoading(false);
        }
      }
    }

    fetchMediaLists();
    return () => {
      active = false;
    };
  }, [matchedUser?.UserId]);

  const reloadMediaLists = async () => {
    if (!matchedUser?.UserId) return;
    setMediaListsLoading(true);
    try {
      const response = await axios.get(`/api/users/${encodeURIComponent(matchedUser.UserId)}/media-lists`, {
        params: { full: "true" },
        headers: { Authorization: `Bearer ${token}` },
      });
      setMediaLists(response.data || { favourites: [], watchlist: [] });
    } finally {
      setMediaListsLoading(false);
    }
  };

  async function runMediaAction(item, action) {
    if (!matchedUser?.UserId || !item?.id) return;
    try {
      setMediaMessage("");
      await axios.post(
        `/api/users/${encodeURIComponent(matchedUser.UserId)}/media/${encodeURIComponent(item.id)}/actions`,
        { action },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setMediaMessage(`Updated ${mediaServerName()} media state.`);
      await reloadMediaLists();
    } catch (error) {
      setMediaMessage(error.response?.data?.error || error.message || "Unable to update item.");
    }
  }

  const filterMedia = (items = []) => {
    const query = mediaSearch.trim().toLowerCase();
    if (!query) return items;
    return items.filter((item) =>
      [item.name, item.seriesName, item.type, item.year, ...(item.genres || []), ...(item.users || [])]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query))
    );
  };

  if (loading) {
    return <Loading />;
  }

  if (matchedUser) {
    const sectionCounts = {
      overview: Number(matchedUser.TotalStreams || 0),
      media:
        (mediaLists.continueWatching || []).length +
        (mediaLists.recentlyWatched || []).length +
        (mediaLists.favourites || []).length +
        (mediaLists.watchlist || []).length +
        (mediaLists.nextEpisodes || []).length +
        (mediaLists.recommendations || []).length,
      taste:
        (mediaLists.taste?.genres || []).length +
        (mediaLists.taste?.actors || []).length +
        (mediaLists.taste?.studios || []).length,
      household:
        (mediaLists.sharedFavourites || []).length +
        (mediaLists.familyWatchlist?.movies || []).length +
        (mediaLists.familyWatchlist?.shows || []).length +
        (mediaLists.staleWatchlist || []).length +
        (mediaLists.libraryGaps || []).length,
    };

    return (
      <div className="user-profile-page">
        <QuickConnectUserWrap user={matchedUser} rank={rank || null} />
        <nav className="user-profile-subnav" aria-label="Profile sections">
          {PROFILE_SECTIONS.map((section) => (
            <button
              key={section.id}
              type="button"
              className={activeProfileSection === section.id ? "is-active" : ""}
              onClick={() => setActiveProfileSection(section.id)}
              aria-pressed={activeProfileSection === section.id}
            >
              <span>{section.label}</span>
              <strong className={mediaListsLoading && section.id !== "overview" ? "is-loading" : ""}>
                {mediaListsLoading && section.id !== "overview" ? "..." : sectionCounts[section.id] || 0}
              </strong>
            </button>
          ))}
        </nav>
        <div className="user-profile-media-section">
          {activeProfileSection !== "overview" ? <section className="user-media-toolbar">
            <div>
              <h2>{PROFILE_SECTIONS.find((section) => section.id === activeProfileSection)?.label} profile</h2>
              <p>
                {activeProfileSection === "media"
                  ? "Favourites, watchlist, progress, and recommendations."
                  : activeProfileSection === "taste"
                    ? "Genres, people, studios, and profile overlap."
                    : "Shared picks, stale watchlists, and household gaps."}
              </p>
            </div>
            <input type="search" value={mediaSearch} onChange={(event) => setMediaSearch(event.target.value)} placeholder="Search this profile..." />
          </section> : null}
          {mediaMessage ? <div className="user-media-message">{mediaMessage}</div> : null}

          {activeProfileSection === "overview" ? (
            <section className="user-profile-overview-note">
              <div>
                <h2>Profile at a glance</h2>
                <p>Use the section switcher above for watchlists, taste data, and household overlap.</p>
              </div>
              <button type="button" onClick={() => setActiveProfileSection("media")}>Open media</button>
            </section>
          ) : null}

          {activeProfileSection === "media" ? (
            <>
              <UserMediaRail
                title="Continue Watching"
                subtitle={`In-progress ${mediaServerName()} media for this user.`}
                items={filterMedia(mediaLists.continueWatching || [])}
                onAction={runMediaAction}
                actions={[{ label: "Watched", action: "markWatched" }]}
              />
              <UserMediaRail title="Recently Watched" subtitle="Last 10 synced plays for this user." items={filterMedia(mediaLists.recentlyWatched || [])} />
              <UserMediaRail
                title="Favourites"
                subtitle={`${mediaServerName()} favourites for this user.`}
                items={filterMedia(mediaLists.favourites || [])}
                onAction={runMediaAction}
                actions={[{ label: "Unfavourite", action: "unfavourite" }, { label: "Watched", action: "markWatched" }]}
              />
              <UserMediaRail
                title="Watchlist Movies"
                subtitle={`Movies pulled from ${mediaServerName()} Watchlist.`}
                items={filterMedia(mediaLists.watchlistByType?.movies || [])}
                onAction={runMediaAction}
                actions={[{ label: "Remove", action: "removeWatchlist" }, { label: "Favourite", action: "favourite" }, { label: "Watched", action: "markWatched" }]}
                variant="featured"
              />
              <UserMediaRail
                title="Watchlist Shows"
                subtitle={`Shows pulled from ${mediaServerName()} Watchlist.`}
                items={filterMedia(mediaLists.watchlistByType?.shows || [])}
                onAction={runMediaAction}
                actions={[{ label: "Remove", action: "removeWatchlist" }, { label: "Favourite", action: "favourite" }]}
                variant="featured"
              />
              <UserMediaRail title="Next Episodes" subtitle="Next unwatched episodes from this profile's shows." items={filterMedia(mediaLists.nextEpisodes || [])} onAction={runMediaAction} actions={[{ label: "Watched", action: "markWatched" }]} />
              <UserMediaRail title="Recommended" subtitle="Suggestions based on watchlist genres." items={filterMedia(mediaLists.recommendations || [])} onAction={runMediaAction} actions={[{ label: "Watchlist", action: "addWatchlist" }, { label: "Favourite", action: "favourite" }]} />
            </>
          ) : null}

          {activeProfileSection === "taste" ? <>
            <section className="user-media-taste">
            <div>
              <h2>Taste profile</h2>
              <p>Built from favourites, watchlist, and recent plays.</p>
            </div>
            <div>
              {(mediaLists.taste?.genres || []).map((item) => <span key={`genre-${item.name}`}>{item.name} · {item.count}</span>)}
              {(mediaLists.taste?.actors || []).slice(0, 6).map((item) => <span key={`actor-${item.name}`}>{item.name} · {item.count}</span>)}
              {(mediaLists.taste?.studios || []).slice(0, 6).map((item) => <span key={`studio-${item.name}`}>{item.name} · {item.count}</span>)}
            </div>
            </section>
            <UserMediaRail title="Shared Favourites" subtitle="Items this user and others overlap on." items={filterMedia(mediaLists.sharedFavourites || [])} />
          </> : null}

          {activeProfileSection === "household" ? <>
            <UserMediaRail title="Family Watchlist" subtitle="Combined household watchlist, grouped by popularity." items={filterMedia([...(mediaLists.familyWatchlist?.movies || []), ...(mediaLists.familyWatchlist?.shows || [])])} />
            <UserMediaRail title="Stale Watchlist" subtitle="Watchlisted for 30+ days and not cleared yet." items={filterMedia(mediaLists.staleWatchlist || [])} onAction={runMediaAction} actions={[{ label: "Remove", action: "removeWatchlist" }]} />
            <UserMediaRail title="Library Gaps" subtitle="Watchlisted shows with an unwatched next episode to catch up on." items={filterMedia(mediaLists.libraryGaps || [])} />
          </> : null}
        </div>
      </div>
    );
  }

  if (profileForbidden) {
    return (
      <div className="user-profile-page">
        <section className="user-profile-empty">
          <h1>Profile not available</h1>
          <p>You can only view your own profile.</p>
          <Link to="/me">Go to My Glance</Link>
        </section>
      </div>
    );
  }

  if (localUser || ["local", "oidc"].includes(config?.settings?.auth?.mode)) {
    return (
      <div className="user-profile-page">
        <AccountDashboard access={access} />
      </div>
    );
  }

  if (userKey.length > 20) {
    return <UserInfo />;
  }

  return (
    <div className="user-profile-page">
      <section className="user-profile-empty">
        <h1>User not found</h1>
        <p>No JellyGlance profile matched `{decodeURIComponent(userKey)}`.</p>
        <Link to="/users">Back to users</Link>
      </section>
    </div>
  );
}

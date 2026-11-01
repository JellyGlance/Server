/* eslint-disable react/prop-types */
import { useState, useEffect } from "react";
import axios from "../../lib/axios_instance";
import { useParams, Link } from "react-router-dom";
import { Blurhash } from "react-blurhash";
import { Tabs, Tab, Button } from "react-bootstrap";

import ExternalLinkFillIcon from "remixicon-react/ExternalLinkFillIcon";
import ArchiveDrawerFillIcon from "remixicon-react/ArchiveDrawerFillIcon";
import ArrowLeftSLineIcon from "remixicon-react/ArrowLeftSLineIcon";
import InformationLineIcon from "remixicon-react/InformationLineIcon";
import PlayFillIcon from "remixicon-react/PlayFillIcon";
import TvLineIcon from "remixicon-react/TvLineIcon";
import FilmLineIcon from "remixicon-react/FilmLineIcon";
import FileMusicLineIcon from "remixicon-react/FileMusicLineIcon";
import CheckboxMultipleBlankLineIcon from "remixicon-react/CheckboxMultipleBlankLineIcon";

import "../css/items/item-details.css";

import MoreItems from "./item-info/more-items";
import ItemActivity from "./item-info/item-activity";
import ItemNotFound from "./item-info/item-not-found";

import Config from "../../lib/config";
import { fetchActiveSessions, getCachedActiveSessions, subscribeActiveSessions } from "../../lib/session-cache";
import Loading from "./general/loading";
import ItemOptions from "./item-info/item-options";
import { Trans, useTranslation } from "react-i18next";
import baseUrl from "../../lib/baseurl";
import GlobalStats from "./general/globalStats";
import ErrorBoundary from "./general/ErrorBoundary.jsx";

function parseList(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return String(value)
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
}

function getProviderId(providerIds, keys) {
  const ids = providerIds || {};
  const entries = Object.entries(ids);
  for (const key of keys) {
    if (ids[key]) return ids[key];
    const match = entries.find(([name]) => name.toLowerCase() === key.toLowerCase());
    if (match?.[1]) return match[1];
  }
  return null;
}

function getIndexLabel(data) {
  if (data.Type !== "Episode") return null;
  const season = data.ParentIndexNumber || data.SeasonName?.match(/\d+/)?.[0];
  const episode = data.IndexNumber;
  if (!season && !episode) return data.Name;
  return `S${String(season || 0).padStart(2, "0")}E${String(episode || 0).padStart(2, "0")} - ${data.Name}`;
}

const brandIconUrl = (slug, color) => `https://cdn.simpleicons.org/${slug}/${color}`;

function ItemInfo() {
  const { t } = useTranslation();
  const { Id } = useParams();
  const [data, setData] = useState();
  const [config, setConfig] = useState();
  const [refresh, setRefresh] = useState(true);
  const [glance, setGlance] = useState(null);
  const [retryBusy, setRetryBusy] = useState(false);
  const [retryMessage, setRetryMessage] = useState("");
  const [refreshBusy, setRefreshBusy] = useState(false);
  const [liveSessions, setLiveSessions] = useState(() => getCachedActiveSessions() || []);
  const [activeTab, setActiveTab] = useState("tabOverview");

  const [loaded, setLoaded] = useState(false);
  const [fallback, setFallback] = useState(false);

  const SeriesIcon = <TvLineIcon size={"50%"} />;
  const MovieIcon = <FilmLineIcon size={"50%"} />;
  const MusicIcon = <FileMusicLineIcon size={"50%"} />;
  const MixedIcon = <CheckboxMultipleBlankLineIcon size={"50%"} />;

  const currentLibraryDefaultIcon =
    data?.Type === "Movie" ? MovieIcon : data?.Type === "Episode" ? SeriesIcon : data?.Type === "Audio" ? MusicIcon : MixedIcon;

  function formatFileSize(sizeInBytes) {
    if (!sizeInBytes) return "N/A";
    const sizeInMB = sizeInBytes / 1048576;
    if (sizeInMB < 1000) return `${sizeInMB.toFixed(2)} MB`;
    const sizeInGB = sizeInMB / 1024;
    return `${sizeInGB.toFixed(2)} GB`;
  }

  function ticksToTimeString(ticks) {
    if (!ticks) return "N/A";
    const seconds = Math.floor(ticks / 10000000);
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = seconds % 60;
    if (!hours) return `${minutes}m ${remainingSeconds}s`;
    return `${hours}h ${minutes}m`;
  }

  const fetchData = async () => {
    if (config) {
      setRefresh(true);
      setLoaded(false);
      setFallback(false);
      try {
        const itemData = await axios.post(
          `/api/getItemDetails`,
          {
            Id: Id,
          },
          {
            headers: {
              Authorization: `Bearer ${config.token}`,
              "Content-Type": "application/json",
            },
          }
        );

        setData(itemData.data[0]);
        axios
          .get(`/api/item-glance/${encodeURIComponent(Id)}`, {
            headers: { Authorization: `Bearer ${config.token}` },
          })
          .then((response) => setGlance(response.data))
          .catch(() => setGlance(null));
      } catch (error) {
        setData({ notfound: true, message: error.response?.data });
        console.log(error);
      }
      setRefresh(false);
    }
  };

  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const newConfig = await Config.getConfig();
        setConfig(newConfig);
      } catch (error) {
        console.log(error);
      }
    };

    fetchData();

    if (!config) {
      fetchConfig();
    }

    const intervalId = setInterval(fetchData, 60000 * 5);
    return () => clearInterval(intervalId);
    // eslint-disable-next-line
  }, [config, Id]);

  useEffect(() => {
    const unsubscribe = subscribeActiveSessions((sessions) => setLiveSessions(Array.isArray(sessions) ? sessions : []));
    fetchActiveSessions().catch(() => {});
    return unsubscribe;
  }, []);

  if (!data || refresh) {
    return <Loading />;
  }

  if (data && data.notfound) {
    return <ItemNotFound message="Item not found" itemId={Id} fetchdataMethod={fetchData} />;
  }

  const canOps = ["Owner", "Admin"].includes(config?.settings?.auth?.role);
  const jellyfinWeb = String(config?.hostUrl || "").replace(/\/+$/, "");
  const jellyfinOpenUrl = jellyfinWeb ? `${jellyfinWeb}/web/#/details?id=${encodeURIComponent(Id)}` : "";
  const watchingNow = (Array.isArray(liveSessions) ? liveSessions : [])
    .filter((session) => {
      const item = session?.NowPlayingItem;
      if (!item) return false;
      return [item.Id, item.SeriesId, item.SeasonId].map(String).includes(String(Id));
    })
    .map((session) => session.UserName || session.DeviceName)
    .filter(Boolean);

  const itemId = data.EpisodeId || data.Id;
  const heroImageId = ["Episode", "Season"].includes(data.Type) ? data.SeriesId : data.Id;
  const title = data.Type === "Episode" ? data.SeriesName || data.Name : data.SeriesName || data.Name;
  const episodeLabel = getIndexLabel(data);
  const genres = parseList(data.Genres).slice(0, 4);
  const providerIds = data.Type === "Series" ? data.ProviderIds || {} : data.ProviderIds || {};
  const seriesProviderIds = data.SeriesProviderIds || providerIds;
  const imdbId = getProviderId(providerIds, ["Imdb", "IMDb"]);
  const tmdbId = getProviderId(providerIds, ["Tmdb", "TMDb", "TheMovieDb"]);
  const tvdbId = getProviderId(seriesProviderIds, ["Tvdb", "TVDB", "TheTVDB"]);
  const rottenId = getProviderId(providerIds, ["RottenTomatoes", "Rotten Tomatoes"]);
  const jellyfinUrl =
    data.JellyfinUrl ||
    ((config?.settings?.EXTERNAL_URL ?? config?.hostUrl) && `${config.settings?.EXTERNAL_URL ?? config.hostUrl}/web/index.html#!/details?id=${itemId}`);
  const rottenLink = rottenId
    ? `https://www.rottentomatoes.com/m/${rottenId}`
    : `https://www.rottentomatoes.com/search?search=${encodeURIComponent(`${data.Name || title} ${data.ProductionYear || ""}`.trim())}`;
  const arrLinks = data.ArrLinks || [];
  const actionLinks = [
    jellyfinUrl && { label: "Open in Jellyfin", url: jellyfinUrl, primary: true },
    ...arrLinks.map((link) => ({ label: link.matched ? `Open in ${link.name}` : `Find in ${link.name}`, url: link.url })),
  ].filter(Boolean);
  const studio = Array.isArray(data.Studios) ? data.Studios[0]?.Name || data.Studios[0] : null;
  const qualityProfile = data.Type === "Movie" ? "Main Quality" : data.Type;
  const status = data.archived ? "Archived" : "Downloaded";
  const language = data.OriginalLanguage || data.PreferredMetadataLanguage || "Unknown";

  return (
    <div className="item-detail-page">
      <section className="item-hero" style={{ "--item-backdrop": `url(/proxy/Items/Images/Backdrop?id=${heroImageId}&fillWidth=1600&quality=92)` }}>
        <div className="item-breadcrumbs">
          {data.ParentId && (
            <Link to={`/libraries/${data.ParentId}`} className="item-crumb">
              {data.LibraryName}
            </Link>
          )}
          {["Episode", "Season"].includes(data.Type) && (
            <>
              <ArrowLeftSLineIcon size={18} />
              <Link to={`/libraries/item/${data.SeriesId}`} className="item-crumb">
                {data.SeriesName}
              </Link>
            </>
          )}
          {data.Type === "Episode" && (
            <>
              <ArrowLeftSLineIcon size={18} />
              <Link to={`/libraries/item/${data.SeasonId}`} className="item-crumb">
                {data.SeasonName}
              </Link>
            </>
          )}
        </div>

        <div className="item-hero-content">
          <div className="item-poster-shell">
            {!data.archived && data.PrimaryImageHash && !loaded && !fallback ? (
              <Blurhash hash={data.PrimaryImageHash} width={"100%"} height={"100%"} className="item-poster-blur" />
            ) : null}
            {!data.archived && !fallback ? (
              <img
                className="item-image"
                src={`${baseUrl}/proxy/Items/Images/Primary?id=${heroImageId}&fillWidth=360&quality=92`}
                alt=""
                style={{ opacity: loaded ? 1 : 0 }}
                onLoad={() => setLoaded(true)}
                onError={() => setFallback(true)}
              />
            ) : (
              <div className="item-poster-fallback">
                {data.archived ? <ArchiveDrawerFillIcon size={58} /> : currentLibraryDefaultIcon}
                <span>{data.archived ? <Trans i18nKey="ARCHIVED" /> : data.Type}</span>
              </div>
            )}
          </div>

          <div className="item-hero-copy">
            <div className="item-title-row">
              <span className="item-bookmark" aria-hidden="true" />
              <div>
                <h1>{title}</h1>
                <div className="item-facts-row">
                  {data.OfficialRating ? <span className="item-age-rating">{data.OfficialRating}</span> : null}
                  {data.ProductionYear ? <span>{data.ProductionYear}</span> : null}
                  <span>{ticksToTimeString(data.RunTimeTicks)}</span>
                  {jellyfinUrl ? (
                    <a href={jellyfinUrl} target="_blank" rel="noreferrer" title="Open in Jellyfin">
                      <ExternalLinkFillIcon size={22} />
                    </a>
                  ) : null}
                </div>
              </div>
            </div>
            {episodeLabel ? <p className="item-episode-label">{episodeLabel}</p> : null}

            <div className="item-ratings-row">
              {tmdbId ? (
                <a className="item-rating-pill tmdb" href={`https://www.themoviedb.org/${["Series", "Season", "Episode"].includes(data.Type) ? "tv" : "movie"}/${tmdbId}`} target="_blank" rel="noreferrer">
                  <img src={brandIconUrl("themoviedatabase", "01B4E4")} alt="TMDb" loading="lazy" decoding="async" />
                  <span>{data.CommunityRating ? `${Math.round(Number(data.CommunityRating) * 10)}%` : "Open"}</span>
                </a>
              ) : null}
              {imdbId ? (
                <a className="item-rating-pill imdb" href={`https://www.imdb.com/title/${imdbId}/`} target="_blank" rel="noreferrer">
                  <img src={brandIconUrl("imdb", "F5C518")} alt="IMDb" loading="lazy" decoding="async" />
                  <span>{data.CommunityRating ? Number(data.CommunityRating).toFixed(1) : "Open"}</span>
                </a>
              ) : null}
              <a className="item-rating-pill rotten" href={rottenLink} target="_blank" rel="noreferrer">
                <img src={brandIconUrl("rottentomatoes", "FA320A")} alt="Rotten Tomatoes" loading="lazy" decoding="async" />
                <span>{data.CriticRating ? `${Math.round(data.CriticRating)}%` : "Search"}</span>
              </a>
              {tvdbId ? (
                <a className="item-rating-pill tvdb" href={`https://thetvdb.com/dereferrer/series/${tvdbId}`} target="_blank" rel="noreferrer">
                  <img src={brandIconUrl("thetvdb", "00AEEF")} alt="TVDB" loading="lazy" decoding="async" />
                  <span>Open</span>
                </a>
              ) : null}
            </div>

            {glance ? (
              <div className="item-glance-strip">
                <span className={glance.jellyfin ? "is-on" : ""}>
                  {glance.jellyfin ? t("FEATURES.GLANCE.JELLYFIN_IN") : t("FEATURES.GLANCE.JELLYFIN_MISSING")}
                </span>
                <span className={glance.request ? "is-on" : ""}>
                  {glance.request ? t("FEATURES.GLANCE.SEERR", { status: glance.request.status }) : t("FEATURES.GLANCE.NO_REQUEST")}
                </span>
                <span className={glance.arr ? "is-on" : ""}>
                  {glance.arr
                    ? t(glance.arr.hasFile ? "FEATURES.GLANCE.ARR_HAS_FILE" : "FEATURES.GLANCE.ARR_WAITING", { service: glance.arr.service })
                    : t("FEATURES.GLANCE.NO_ARR")}
                </span>
                <span className={glance.download ? "is-on" : ""}>
                  {glance.download
                    ? t("FEATURES.GLANCE.DOWNLOAD", { client: glance.download.client, state: glance.download.state })
                    : t("FEATURES.GLANCE.NO_DOWNLOAD")}
                </span>
                {glance.tdarr ? <span className={glance.tdarr.connected ? "is-on" : ""}>Tdarr</span> : null}
                {glance.maintainerr ? <span className={glance.maintainerr.connected ? "is-on" : ""}>Maintainerr</span> : null}
                {glance.kometa ? <span className={glance.kometa.connected ? "is-on" : ""}>Kometa</span> : null}
                <button
                  type="button"
                  className="item-glance-retry"
                  disabled={retryBusy}
                  onClick={async () => {
                    setRetryBusy(true);
                    setRetryMessage("");
                    try {
                      const response = await axios.post(
                        "/api/retry-grab",
                        {
                          itemId: Id,
                          title: data.Name || data.SeriesName,
                          mediaType: data.Type,
                          requestId: glance.request?.id,
                          tmdb: glance.request?.tmdb || glance.arr?.tmdb,
                          tvdb: glance.request?.tvdb || glance.arr?.tvdb,
                        },
                        { headers: { Authorization: `Bearer ${config.token}` } }
                      );
                      setRetryMessage(response.data?.ok ? t("FEATURES.GLANCE.RETRY_OK") : t("FEATURES.GLANCE.RETRY_FAIL"));
                    } catch (error) {
                      setRetryMessage(error.response?.data?.error || t("FEATURES.GLANCE.RETRY_FAIL"));
                    } finally {
                      setRetryBusy(false);
                    }
                  }}
                >
                  {retryBusy ? t("FEATURES.GLANCE.RETRYING") : t("FEATURES.GLANCE.RETRY_GRAB")}
                </button>
                {retryMessage ? <span className="is-on">{retryMessage}</span> : null}
                {watchingNow.length ? (
                  <span className="is-on">{t("FEATURES.OPS.WATCHING_NOW", { names: watchingNow.join(", ") })}</span>
                ) : null}
                {canOps ? (
                  <button
                    type="button"
                    className="item-glance-retry"
                    disabled={refreshBusy}
                    onClick={async () => {
                      setRefreshBusy(true);
                      setRetryMessage("");
                      try {
                        await axios.post(
                          "/api/jellyfin/refresh-item",
                          { itemId: Id, recursive: true },
                          { headers: { Authorization: `Bearer ${config.token}` } }
                        );
                        setRetryMessage(t("FEATURES.OPS.REFRESH_OK"));
                      } catch (error) {
                        setRetryMessage(error.response?.data?.error || t("FEATURES.OPS.REFRESH_FAIL"));
                      } finally {
                        setRefreshBusy(false);
                      }
                    }}
                  >
                    {refreshBusy ? t("FEATURES.OPS.REFRESHING") : t("FEATURES.OPS.REFRESH_ITEM")}
                  </button>
                ) : null}
                {jellyfinOpenUrl ? (
                  <a href={jellyfinOpenUrl} target="_blank" rel="noreferrer">
                    {t("FEATURES.OPS.OPEN_JELLYFIN")}
                  </a>
                ) : null}
                {glance.request?.openUrl ? (
                  <a href={glance.request.openUrl} target="_blank" rel="noreferrer">
                    {t("FEATURES.GLANCE.OPEN_SEERR")}
                  </a>
                ) : null}
              </div>
            ) : null}

            <div className="item-snapshot-row">
              <div className="item-snapshot-cell is-wide">
                <span>Path</span>
                <strong>{data.Path || "N/A"}</strong>
              </div>
              <div>
                <span>Status</span>
                <strong>{status}</strong>
              </div>
              <div>
                <span>Quality Profile</span>
                <strong>{qualityProfile}</strong>
              </div>
              <div>
                <span>Size</span>
                <strong>{formatFileSize(data.Size)}</strong>
              </div>
              <div>
                <span>Original Language</span>
                <strong>{language}</strong>
              </div>
              <div>
                <span>Studio</span>
                <strong>{studio || "N/A"}</strong>
              </div>
              <div>
                <span>Genres</span>
                <strong>{genres.length ? genres.join(", ") : "N/A"}</strong>
              </div>
            </div>

            {data.Overview ? (
              <p className="item-overview">{data.Overview}</p>
            ) : (
              <p className="item-overview item-overview-muted">No description has been synced for this item yet.</p>
            )}

            <div className="item-action-row">
              {actionLinks.map((link) => (
                <a key={`${link.label}-${link.url}`} href={link.url} target="_blank" rel="noreferrer" className={`item-action-link ${link.primary ? "is-primary" : ""}`}>
                  <ExternalLinkFillIcon size={16} />
                  {link.label}
                </a>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="item-technical-panel">
        <div className="item-section-heading">
          <InformationLineIcon size={22} />
          <div>
            <span>Media details</span>
            <strong>{data.FileName || data.Name}</strong>
          </div>
        </div>
        <div className="item-technical-grid">
          <div>
            <span>File name</span>
            <strong>{data.FileName || "N/A"}</strong>
          </div>
          <div>
            <span>Path</span>
            <strong>{data.Path || "N/A"}</strong>
          </div>
          <div>
            <span>Bitrate</span>
            <strong>{data.Bitrate ? `${Math.round(Number(data.Bitrate) / 1000)} Kbps` : "N/A"}</strong>
          </div>
          <div>
            <span>Last activity</span>
            <strong>{data.LastActivityDate ? new Date(data.LastActivityDate).toLocaleString() : "Never"}</strong>
          </div>
        </div>
      </section>

      <div className="item-tabs-row">
        <Button onClick={() => setActiveTab("tabOverview")} active={activeTab === "tabOverview"} variant="outline-primary" type="button">
          <PlayFillIcon size={16} />
          <Trans i18nKey="TAB_CONTROLS.OVERVIEW" />
        </Button>
        <Button onClick={() => setActiveTab("tabActivity")} active={activeTab === "tabActivity"} variant="outline-primary" type="button">
          <InformationLineIcon size={16} />
          <Trans i18nKey="TAB_CONTROLS.ACTIVITY" />
        </Button>
        {data.archived && (
          <Button onClick={() => setActiveTab("tabOptions")} active={activeTab === "tabOptions"} variant="outline-primary" type="button">
            <ArchiveDrawerFillIcon size={16} />
            <Trans i18nKey="TAB_CONTROLS.OPTIONS" />
          </Button>
        )}
      </div>

      <Tabs defaultActiveKey="tabOverview" activeKey={activeTab} variant="pills" className="hide-tab-titles">
        <Tab eventKey="tabOverview" title="Overview" className="bg-transparent">
          <GlobalStats id={Id} param={"itemid"} endpoint={"getGlobalItemStats"} title={<Trans i18nKey="GLOBAL_STATS.ITEM_STATS" />} />
          {["Series", "Season"].includes(data && data.Type) ? <MoreItems data={data} /> : <></>}
        </Tab>
        <Tab eventKey="tabActivity" title="Activity" className="bg-transparent">
          <ErrorBoundary>
            <ItemActivity itemid={Id} />
          </ErrorBoundary>
        </Tab>
        <Tab eventKey="tabOptions" title="Options" className="bg-transparent">
          <ItemOptions itemid={Id} itemName={data?.SeriesName || data?.Name} />
        </Tab>
      </Tabs>
    </div>
  );
}
export default ItemInfo;

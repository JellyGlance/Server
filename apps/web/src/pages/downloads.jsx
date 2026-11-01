import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import AddLineIcon from "remixicon-react/AddLineIcon";
import CloseLineIcon from "remixicon-react/CloseLineIcon";
import DownloadCloud2FillIcon from "remixicon-react/DownloadCloud2FillIcon";
import FileUploadLineIcon from "remixicon-react/FileUploadLineIcon";
import PauseLineIcon from "remixicon-react/PauseLineIcon";
import PlayLineIcon from "remixicon-react/PlayLineIcon";
import TimerFlashLineIcon from "remixicon-react/TimerFlashLineIcon";
import axios from "../lib/axios_instance";
import Config from "../lib/config";
import { loadSavedIntegrations } from "../lib/integrations-storage";
import { useTranslation } from "react-i18next";
import "./css/integrations.css";

const iconUrl = (slug) => `https://cdn.jsdelivr.net/gh/selfhst/icons/svg/${slug}.svg`;

function clientIcon(client) {
  if (!client?.slug) return null;
  return <img src={iconUrl(client.slug)} alt="" loading="lazy" decoding="async" />;
}

function normalizeName(value = "") {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function friendlyTorrentName(value, file) {
  if (file?.name) return file.name;
  const trimmed = value.trim();
  if (!trimmed) return "New torrent";
  if (trimmed.startsWith("magnet:")) {
    const match = trimmed.match(/[?&]dn=([^&]+)/);
    return match ? decodeURIComponent(match[1].replace(/\+/g, " ")) : "Magnet download";
  }
  return trimmed.split("/").pop() || "Torrent download";
}

function isDownloadPaused(download) {
  const state = String(download?.state || "").toLowerCase();
  return state.includes("paus") || state.includes("stopp") || state === "paused" || state === "stopped";
}

export default function Downloads() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const fileInputRef = useRef(null);
  const [integrations, setIntegrations] = useState(loadSavedIntegrations({ clients: [] }));
  const savedClients = integrations.clients || [];
  const usableClients = savedClients.filter((client) => client.protocol === "Torrent" || client.protocol === "Usenet");
  const [selectedClientId, setSelectedClientId] = useState(usableClients[0]?.instanceId || "");
  const [torrentValue, setTorrentValue] = useState("");
  const [torrentFile, setTorrentFile] = useState(null);
  const [downloads, setDownloads] = useState([]);
  const [autobrrHits, setAutobrrHits] = useState([]);
  const [cleanuparr, setCleanuparr] = useState(null);
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [busyDownloadId, setBusyDownloadId] = useState("");
  const [canManageDownloads, setCanManageDownloads] = useState(false);

  const selectedClient = usableClients.find((client) => client.instanceId === selectedClientId) || usableClients[0];
  const clientByName = useMemo(() => {
    return usableClients.reduce((map, client) => {
      map.set(normalizeName(client.name), client);
      return map;
    }, new Map());
  }, [usableClients]);
  const activeCount = downloads.filter((download) => download.progress < 100).length;

  async function loadDownloadData() {
    try {
      const [integrationResponse, downloadResponse, autobrrResponse, cleanuparrResponse] = await Promise.all([
        axios.get("/api/integrations", {
          headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
        }).catch(() => ({ data: loadSavedIntegrations({ clients: [] }) })),
        axios.get("/api/downloads/stitched", {
          headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
        }).catch(() => axios.get("/api/integrations/downloads", {
          headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
        })),
        axios.get("/api/autobrr/hits", {
          headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
        }).catch(() => ({ data: { items: [] } })),
        axios.get("/api/downloads/cleanuparr", {
          headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
        }).catch(() => ({ data: null })),
      ]);
      setIntegrations(integrationResponse.data || { clients: [] });
      if (Array.isArray(downloadResponse.data?.items)) {
        setDownloads(downloadResponse.data.items);
      }
      setAutobrrHits(Array.isArray(autobrrResponse.data?.items) ? autobrrResponse.data.items : []);
      setCleanuparr(cleanuparrResponse.data?.configured ? cleanuparrResponse.data : null);
    } catch (error) {
      console.log("Unable to load download sync data", error);
    }
  }

  async function runDownloadSync() {
    try {
      await axios.get("/api/startTask?task=DownloadQueueSync", {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      });
      window.setTimeout(loadDownloadData, 2000);
    } catch (error) {
      console.log("Unable to start download sync", error);
    }
  }

  useEffect(() => {
    localStorage.setItem("jellyglance_active_download_count", String(activeCount));
    window.dispatchEvent(new CustomEvent("jellyglance-download-count", { detail: activeCount }));
  }, [activeCount]);

  useEffect(() => {
    loadDownloadData();
    Config.getConfig()
      .then((cfg) => {
        const permissions = cfg?.settings?.auth?.permissions || {};
        setCanManageDownloads(Boolean(permissions.downloads || permissions.settings));
        if (permissions.home === false && !permissions.downloads && !permissions.settings) {
          navigate("/me", { replace: true });
        }
      })
      .catch(() => setCanManageDownloads(false));
  }, [navigate]);

  useEffect(() => {
    if (!selectedClientId && usableClients[0]?.instanceId) {
      setSelectedClientId(usableClients[0].instanceId);
    }
  }, [selectedClientId, usableClients]);

  async function addTorrent() {
    if (!selectedClient) {
      setMessage(t("FEATURES.DOWNLOADS.ADD_CLIENT_FIRST"));
      return;
    }

    if (!torrentValue.trim()) {
      setMessage(t("FEATURES.DOWNLOADS.NEED_MAGNET"));
      return;
    }

    const nextDownload = {
      id: `${Date.now()}`,
      name: friendlyTorrentName(torrentValue, torrentFile),
      client: selectedClient.name,
      source: "Other",
      state: torrentValue.trim().startsWith("magnet:") ? "magnet" : "torrentURL",
      progress: 0,
      size: "Queued",
      down: "0 B/s",
      up: "0 B/s",
    };

    setIsSubmitting(true);
    setMessage("");
    try {
      await axios.post("/api/downloads/add", {
        client: selectedClient.name,
        instanceId: selectedClient.instanceId,
        value: torrentValue,
        fileName: torrentFile?.name,
      });
      setMessage(t("FEATURES.DOWNLOADS.SENT_TO", { name: nextDownload.name, client: selectedClient.name }));
      setTorrentValue("");
      setTorrentFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      await runDownloadSync();
    } catch (error) {
      setMessage(error?.response?.data?.error || t("FEATURES.DOWNLOADS.QUEUE_FAIL"));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function removeDownload(id) {
    if (!window.confirm(t("FEATURES.DOWNLOADS.REMOVE_CONFIRM"))) return;
    setBusyDownloadId(id);
    setMessage("");
    try {
      await axios.post("/api/downloads/remove", { id });
      setDownloads((current) => current.filter((download) => download.id !== id));
      window.setTimeout(loadDownloadData, 1500);
    } catch (error) {
      setMessage(error?.response?.data?.error || t("FEATURES.DOWNLOADS.REMOVE_FAIL"));
    } finally {
      setBusyDownloadId("");
    }
  }

  async function retryGrab(download) {
    setBusyDownloadId(download.id);
    setMessage("");
    try {
      const response = await axios.post("/api/retry-grab", {
        title: download.name,
        name: download.name,
        requestId: download.request?.id,
        mediaType: download.request?.mediaType,
        tmdb: download.request?.tmdb,
        tvdb: download.request?.tvdb,
      });
      setMessage(response.data?.ok ? t("FEATURES.DOWNLOADS.RETRY_OK") : t("FEATURES.DOWNLOADS.RETRY_FAIL"));
    } catch (error) {
      setMessage(error?.response?.data?.error || t("FEATURES.DOWNLOADS.RETRY_FAIL"));
    } finally {
      setBusyDownloadId("");
    }
  }

  async function toggleDownloadPaused(download) {
    const paused = !isDownloadPaused(download);
    setBusyDownloadId(download.id);
    setMessage("");
    try {
      await axios.post("/api/downloads/pause", { id: download.id, paused });
      setDownloads((current) =>
        current.map((item) => (item.id === download.id ? { ...item, state: paused ? "paused" : "downloading" } : item))
      );
      window.setTimeout(loadDownloadData, 1500);
    } catch (error) {
      setMessage(error?.response?.data?.error || t("FEATURES.DOWNLOADS.UPDATE_FAIL"));
    } finally {
      setBusyDownloadId("");
    }
  }

  return (
    <div className="downloads-page">
      <header className="download-page-header">
        <div>
          <p>{t("FEATURES.DOWNLOADS.KICKER")}</p>
          <h1>{t("FEATURES.DOWNLOADS.TITLE")}</h1>
          <span>{t("FEATURES.DOWNLOADS.INTRO")}</span>
        </div>
      </header>

      {canManageDownloads ? <section className="download-add-bar">
        <label>
          <span>{t("FEATURES.DOWNLOADS.CLIENT")}</span>
          <select value={selectedClientId} onChange={(event) => setSelectedClientId(event.target.value)} disabled={!usableClients.length}>
            {usableClients.length ? (
              usableClients.map((client) => (
                <option value={client.instanceId} key={client.instanceId}>
                  {client.name}
                </option>
              ))
            ) : (
              <option>{t("FEATURES.DOWNLOADS.NO_CLIENTS")}</option>
            )}
          </select>
        </label>
        <label className="download-magnet-field">
          <span>{t("FEATURES.DOWNLOADS.TORRENT_OR_MAGNET")}</span>
          <input value={torrentValue} onChange={(event) => setTorrentValue(event.target.value)} placeholder="magnet:?xt=... or https://example/torrent.torrent" />
        </label>
        <label className="download-file-button">
          <FileUploadLineIcon size={16} />
          <span>{torrentFile ? torrentFile.name : t("FEATURES.DOWNLOADS.TORRENT_FILE")}</span>
          <input ref={fileInputRef} type="file" accept=".torrent,application/x-bittorrent" onChange={(event) => setTorrentFile(event.target.files?.[0] || null)} />
        </label>
        <button type="button" className="download-add-button" onClick={addTorrent} disabled={isSubmitting || !usableClients.length}>
          <AddLineIcon size={18} />
          {isSubmitting ? t("FEATURES.DOWNLOADS.ADDING") : t("FEATURES.DOWNLOADS.ADD_TORRENT")}
        </button>
        <button type="button" className="download-add-button" onClick={runDownloadSync}>
          <TimerFlashLineIcon size={18} />
          {t("FEATURES.DOWNLOADS.SYNC_NOW")}
        </button>
      </section> : null}
      {message ? <p className="download-inline-message">{message}</p> : null}

      <section className="download-console-grid">
        <article className="download-panel active-downloads-panel">
          <h2>{t("FEATURES.DOWNLOADS.ACTIVE")}</h2>
          <div className="download-list">
            {downloads.length ? downloads.map((download) => (
              <div className="download-row" key={download.id}>
                <div className="download-row-main">
                  <div className="download-title-group">
                    <span className="download-row-client-icon">
                      {clientIcon(clientByName.get(normalizeName(download.client))) || <DownloadCloud2FillIcon size={18} />}
                    </span>
                    <div>
                      <strong>{download.name}</strong>
                      <span>
                        {download.client} · {download.source} · {download.state}
                        {download.request ? ` · Request ${download.request.status}` : ""}
                      </span>
                    </div>
                  </div>
                  <div className="download-row-actions">
                    <small>{download.progress}%</small>
                    {canManageDownloads ? (
                      <>
                    <button
                      type="button"
                      aria-label={isDownloadPaused(download) ? t("FEATURES.DOWNLOADS.RESUME") : t("FEATURES.DOWNLOADS.PAUSE")}
                      disabled={Boolean(busyDownloadId)}
                      onClick={() => toggleDownloadPaused(download)}
                    >
                      {isDownloadPaused(download) ? <PlayLineIcon size={17} /> : <PauseLineIcon size={17} />}
                    </button>
                    <button
                      type="button"
                      className="is-danger"
                      aria-label={t("FEATURES.DOWNLOADS.REMOVE")}
                      disabled={Boolean(busyDownloadId)}
                      onClick={() => removeDownload(download.id)}
                    >
                      <CloseLineIcon size={17} />
                    </button>
                      </>
                    ) : null}
                  </div>
                </div>
                <div className="download-progress-track">
                  <span style={{ width: `${download.progress}%` }} />
                </div>
                <div className="download-row-meta">
                  <span>{download.size}</span>
                  <span>{t("FEATURES.DOWNLOADS.DOWN", { rate: download.down })}</span>
                  <span>{t("FEATURES.DOWNLOADS.UP", { rate: download.up })}</span>
                  <span>
                    <TimerFlashLineIcon size={13} />
                    {download.progress >= 100 ? t("FEATURES.DOWNLOADS.COMPLETE") : t("FEATURES.DOWNLOADS.ACTIVE_STATE")}
                  </span>
                  {download.cleanuparr ? (
                    <span className={`download-cleanuparr ${download.cleanuparr.needsIntervention ? "is-attention" : ""}`}>
                      {download.cleanuparr.needsIntervention
                        ? t("FEATURES.DOWNLOADS.CLEANUPARR_INTERVENTION")
                        : t("FEATURES.DOWNLOADS.CLEANUPARR_HANDLING", { reason: download.cleanuparr.reason || download.cleanuparr.eventType })}
                    </span>
                  ) : download.stalledReason ? (
                    <span className="download-stalled">{download.stalledReason}</span>
                  ) : null}
                  {download.peers != null || download.seeds != null ? (
                    <span>{t("FEATURES.DOWNLOADS.PEERS", { seeds: download.seeds || 0, peers: download.peers || 0 })}</span>
                  ) : null}
                  {download.request ? (
                    <Link to="/requests" className="download-request-chip">
                      {download.request.source}: {download.request.title}
                    </Link>
                  ) : null}
                  {String(download.state || "").toLowerCase().match(/fail|error|stall/) || download.request ? (
                    <button type="button" disabled={Boolean(busyDownloadId)} onClick={() => retryGrab(download)}>
                      {t("FEATURES.DOWNLOADS.RETRY_GRAB")}
                    </button>
                  ) : null}
                </div>
              </div>
            )) : (
              <div className="integration-empty-state">{t("FEATURES.DOWNLOADS.EMPTY")}</div>
            )}
          </div>
        </article>

        <article className="download-panel download-clients-panel">
          <h2>{t("FEATURES.DOWNLOADS.CLIENTS")}</h2>
          <div className="download-client-list">
            {usableClients.length ? usableClients.map((client) => {
              const count = downloads.filter((download) => download.client === client.name).length;
              return (
                <div className="download-client-row" key={client.instanceId}>
                  <span className="download-client-icon">{clientIcon(client) || <DownloadCloud2FillIcon size={20} />}</span>
                  <div>
                    <strong>{client.name}</strong>
                    <span>
                      {client.name} · {t("FEATURES.DOWNLOADS.DOWNLOAD_COUNT", { count })}
                    </span>
                    {client.message ? <small>{client.message}</small> : null}
                  </div>
                  <span className={`integration-status-light ${client.connected ? "is-connected" : "is-disconnected"}`} />
                </div>
              );
            }) : (
              <div className="integration-empty-state">{t("FEATURES.DOWNLOADS.NO_CLIENTS_YET")}</div>
            )}
          </div>
        </article>
      </section>

      {cleanuparr ? <CleanuparrPanel snapshot={cleanuparr} t={t} /> : null}

      {autobrrHits.length ? (
        <section className="download-panel autobrr-hits-panel">
          <h2>{t("FEATURES.DOWNLOADS.AUTOBRR")}</h2>
          <div className="download-list">
            {autobrrHits.map((hit) => (
              <div className="download-row" key={hit.id}>
                <div className="download-row-main">
                  <div className="download-title-group">
                    <div>
                      <strong>{hit.name}</strong>
                      <span>
                        {[hit.filter, hit.indexer, hit.action, hit.source].filter(Boolean).join(" · ")}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function CleanuparrPanel({ snapshot, t }) {
  const totals = snapshot.totals || {};
  const unhealthy = (snapshot.instances || []).flatMap((instance) => (instance.ok ? instance.stats?.health?.unhealthy || [] : []));
  const unreachable = (snapshot.instances || []).filter((instance) => !instance.ok);
  const attention = (totals.needsAttention || 0) + (totals.interventions || 0);
  const tiles = [
    ["CLEANUPARR_STRIKES", totals.strikes],
    ["CLEANUPARR_REMOVALS", totals.removals],
    ["CLEANUPARR_CLEANED", totals.cleaned],
    ["CLEANUPARR_EVENTS", totals.events],
    ["CLEANUPARR_ATTENTION", attention],
  ];
  return (
    <section className="download-panel cleanuparr-panel">
      <div className="cleanuparr-panel-head">
        <h2>{t("FEATURES.DOWNLOADS.CLEANUPARR")}</h2>
        <span>{t("FEATURES.DOWNLOADS.CLEANUPARR_WINDOW", { hours: snapshot.hours })}</span>
      </div>
      <div className="cleanuparr-tiles">
        {tiles.map(([key, value]) => (
          <div key={key} className={`cleanuparr-tile ${key === "CLEANUPARR_ATTENTION" && value ? "is-attention" : ""}`}>
            <strong>{Number(value || 0).toLocaleString()}</strong>
            <span>{t(`FEATURES.DOWNLOADS.${key}`)}</span>
          </div>
        ))}
      </div>
      <p className={`cleanuparr-health ${unhealthy.length || unreachable.length ? "is-attention" : ""}`}>
        {unreachable.length
          ? unreachable.map((instance) => t("FEATURES.DOWNLOADS.CLEANUPARR_UNREACHABLE", { name: instance.name, error: instance.error })).join(" · ")
          : unhealthy.length
            ? t("FEATURES.DOWNLOADS.CLEANUPARR_UNHEALTHY", { names: unhealthy.map((row) => row.name).join(", ") })
            : t("FEATURES.DOWNLOADS.CLEANUPARR_HEALTHY")}
      </p>
      {snapshot.recentEvents?.length ? (
        <div className="download-list">
          {snapshot.recentEvents.slice(0, 8).map((event) => (
            <div className={`download-row cleanuparr-event ${event.needsIntervention ? "is-attention" : ""}`} key={event.id}>
              <div className="download-row-main">
                <div className="download-title-group">
                  <div>
                    <strong>{event.item || event.title}</strong>
                    <span>
                      {[event.title, event.strikeCount ? `#${event.strikeCount}` : "", event.instanceType, new Date(event.receivedAt).toLocaleString()]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </div>
                  {event.needsIntervention ? <span className="download-cleanuparr is-attention">{t("FEATURES.DOWNLOADS.CLEANUPARR_INTERVENTION")}</span> : null}
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="cleanuparr-empty">{t("FEATURES.DOWNLOADS.CLEANUPARR_NO_EVENTS")}</p>
      )}
    </section>
  );
}

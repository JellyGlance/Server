import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import AddLineIcon from "remixicon-react/AddLineIcon";
import ArrowDownSLineIcon from "remixicon-react/ArrowDownSLineIcon";
import CheckboxCircleLineIcon from "remixicon-react/CheckboxCircleLineIcon";
import ClipboardLineIcon from "remixicon-react/ClipboardLineIcon";
import DownloadCloud2FillIcon from "remixicon-react/DownloadCloud2FillIcon";
import ErrorWarningLineIcon from "remixicon-react/ErrorWarningLineIcon";
import EyeFillIcon from "remixicon-react/EyeFillIcon";
import EyeOffFillIcon from "remixicon-react/EyeOffFillIcon";
import HeartPulseLineIcon from "remixicon-react/HeartPulseLineIcon";
import Plug2FillIcon from "remixicon-react/Plug2FillIcon";
import Settings3LineIcon from "remixicon-react/Settings3LineIcon";
import UploadCloud2LineIcon from "remixicon-react/UploadCloud2LineIcon";
import UserAddLineIcon from "remixicon-react/UserAddLineIcon";
import axios from "../lib/axios_instance";
import { useTranslation } from "react-i18next";
import { formatDate as formatLocaleDate } from "../lib/format-date";
import { loadSavedIntegrations, saveSavedIntegrations } from "../lib/integrations-storage";
import JellyfinIntegrationSettings from "./components/settings/JellyfinIntegrationSettings";
import "./css/integrations.css";

const iconUrl = (slug) => {
  const safe = String(slug || "sonarr")
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "");
  const iconSlug = /^[a-z0-9][a-z0-9-]{0,63}$/.test(safe) ? safe : "sonarr";
  return `https://cdn.jsdelivr.net/gh/selfhst/icons/svg/${iconSlug}.svg`;
};
const tdarrLogoUrl = "https://home.tdarr.io/static/media/logo3-min.246d6df44c7f16ddebaf.png";
const sickChillLogoUrl = "https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/sickchill.png";
const integrationTabItems = [
  ["media-server", "Media Server"],
  ["automation", "Arr Apps"],
  ["seerr", "Seerr Apps"],
  ["downloads", "Download Clients"],
  ["invites", "3rd party apps"],
];
const integrationTabKeys = integrationTabItems.map(([key]) => key);

function normalizeIntegrationTabSlug(value = "") {
  const normalized = String(value || "")
    .replace(/^#\/?/, "")
    .trim()
    .toLowerCase();
  const aliases = {
    media: "media-server",
    mediaserver: "media-server",
    "media-server": "media-server",
    jellyfin: "media-server",
    arr: "automation",
    arrapps: "automation",
    "arr-apps": "automation",
    automation: "automation",
    jellyseerr: "seerr",
    overseerr: "seerr",
    seerr: "seerr",
    download: "downloads",
    downloads: "downloads",
    "download-clients": "downloads",
    clients: "downloads",
    invite: "invites",
    invites: "invites",
    "invites-transcodes": "invites",
    transcodes: "invites",
    tdarr: "invites",
  };
  return aliases[normalized] || (integrationTabKeys.includes(normalized) ? normalized : "");
}

const automationApps = [
  { name: "Sonarr", slug: "sonarr", purpose: "Series automation", accent: "#35c5f4" },
  { name: "SickChill", slug: "sickchill", purpose: "Series automation", accent: "#d35b5b" },
  { name: "Radarr", slug: "radarr", purpose: "Movie automation", accent: "#f4c430" },
  { name: "Lidarr", slug: "lidarr", purpose: "Music automation", accent: "var(--secondary-color)" },
  { name: "Readarr", slug: "readarr", purpose: "Book automation", accent: "#e8a87c" },
  { name: "Prowlarr", slug: "prowlarr", purpose: "Indexer management", accent: "#4aa8f0" },
  { name: "Bazarr", slug: "bazarr", purpose: "Subtitle automation", accent: "#84d160" },
  { name: "Jellyseerr", slug: "jellyseerr", purpose: "Request management", accent: "#6366f1" },
  { name: "Overseerr", slug: "overseerr", purpose: "Request management", accent: "#7dd3fc" },
];

const downloadClientOptions = [
  { name: "qBittorrent", slug: "qbittorrent", protocol: "Torrent", auth: "userpass" },
  { name: "Transmission", slug: "transmission", protocol: "Torrent", auth: "userpass" },
  { name: "Deluge", slug: "deluge", protocol: "Torrent", auth: "password" },
  { name: "SABnzbd", slug: "sabnzbd", protocol: "Usenet" },
  { name: "NZBGet", slug: "nzbget", protocol: "Usenet", auth: "userpass", authHint: "Use the Restricted username and password from NZBGet Settings > Security." },
  { name: "rTorrent", slug: "rtorrent", protocol: "Torrent", auth: "userpass" },
  { name: "BitTorrent", slug: null, protocol: "Torrent" },
];

// Saved clients keep the fields they were created with, so look the auth style up from the catalog too.
function downloadClientAuth(app = {}) {
  const slug = String(app.slug || app.name || "").toLowerCase();
  const option = downloadClientOptions.find((item) => item.slug && slug.includes(item.slug));
  return { auth: option?.auth || app.auth, authHint: option?.authHint || app.authHint };
}

const thirdPartyOptions = [
  { name: "Tdarr", slug: "tdarr", purpose: "Active transcodes", accent: "var(--primary-light-color)", secretOptional: true },
  { name: "Wizarr", slug: "wizarr", purpose: "Jellyfin invite links", accent: "#8b5cf6" },
  { name: "Maintainerr", slug: "maintainerr", purpose: "Cleanup schedule", accent: "#1abca1" },
  { name: "Unpackerr", slug: "unpackerr", purpose: "Extract status", accent: "#f59e0b", secretOptional: true },
  { name: "Kometa", slug: "kometa", purpose: "Collections and overlays", accent: "#ec4899", secretOptional: true },
  { name: "Notifiarr", slug: "notifiarr", purpose: "Arr notify status", accent: "#f97316" },
  { name: "Recyclarr", slug: "recyclarr", purpose: "Arr config health", accent: "#22d3ee", secretOptional: true },
  { name: "autobrr", slug: "autobrr", purpose: "Filter hits", accent: "#fb7185" },
  { name: "Audiobookshelf", slug: "audiobookshelf", purpose: "Audiobook listening", accent: "#e0b865", secretLabel: "API token" },
];
const firstRunIntegrationPickerOptions = [
  ...automationApps.map((app) => ({ ...app, key: `arr:${app.slug}`, label: app.name, description: app.purpose, kind: "Arr Apps" })),
  ...thirdPartyOptions.map((app) => ({ ...app, key: `third:${app.slug}`, label: app.name, description: app.purpose, kind: "3rd party apps" })),
  ...downloadClientOptions.map((app) => ({ ...app, key: `download:${app.name}`, label: app.name, description: app.protocol, kind: "Download Clients" })),
];

const initialThirdPartyApps = thirdPartyOptions.map((app, index) => ({
  ...app,
  instanceId: `${app.name}-${index}`,
  connected: false,
  values: {},
}));

const initialAutomationApps = automationApps.map((app, index) => ({
  ...app,
  instanceId: `${app.name}-${index}`,
  connected: false,
  values: {},
}));

const defaultAgentOptions = {
  tv: ["Sonarr", "SickChill"],
  movies: ["Radarr"],
  videos: ["Lidarr"],
};

const defaultAgentMeta = {
  Sonarr: { slug: "sonarr", accent: "#35c5f4", role: "Series automation" },
  SickChill: { slug: "sickchill", accent: "#d35b5b", role: "Series automation" },
  Radarr: { slug: "radarr", accent: "#f4c430", role: "Movie automation" },
  Tdarr: { slug: "tdarr", accent: "#38bdf8", role: "Media processing" },
  Lidarr: { slug: "lidarr", accent: "var(--secondary-color)", role: "Music automation" },
  Readarr: { slug: "readarr", accent: "#e8a87c", role: "Book automation" },
  Jellyfin: { slug: "jellyfin", accent: "#8b5cf6", role: "Media server" },
};

const seerrAppNames = new Set(["seerr", "jellyseerr", "overseerr"]);

function isSeerrApp(app) {
  return seerrAppNames.has(String(app.name || app.slug || "").toLowerCase());
}

function normalizeAutomationApps(savedApps) {
  const automationSavedApps = Array.isArray(savedApps)
    ? savedApps.filter((app) => !["tdarr", "wizarr"].includes(String(app.name || app.slug || "").toLowerCase()))
    : [];
  if (!automationSavedApps.length) {
    return initialAutomationApps;
  }

  const savedNames = new Set(automationSavedApps.map((app) => String(app.name || "").toLowerCase()));
  const missingDefaults = initialAutomationApps.filter((app) => !savedNames.has(app.name.toLowerCase()));
  return [...automationSavedApps, ...missingDefaults];
}

function normalizeThirdPartyApps(savedApps, legacyAutomationApps = []) {
  const byName = new Map();
  const addUnique = (apps = []) => {
    apps.forEach((app) => {
      const name = String(app.name || app.slug || "").trim().toLowerCase();
      if (name && !byName.has(name)) byName.set(name, app);
    });
  };

  addUnique(Array.isArray(savedApps) ? savedApps : []);
  addUnique(
    Array.isArray(legacyAutomationApps)
      ? legacyAutomationApps.filter((app) => ["tdarr", "wizarr"].includes(String(app.name || app.slug || "").toLowerCase()))
      : []
  );

  const savedThirdPartyApps = [...byName.values()];
  if (!savedThirdPartyApps.length) {
    return initialThirdPartyApps;
  }

  const savedNames = new Set(savedThirdPartyApps.map((app) => String(app.name || "").toLowerCase()));
  const missingDefaults = initialThirdPartyApps.filter((app) => !savedNames.has(app.name.toLowerCase()));
  return [...savedThirdPartyApps, ...missingDefaults];
}

function AppIcon({ app }) {
  const [imageFailed, setImageFailed] = useState(false);
  const normalizedName = String(app.name || "").toLowerCase();
  const fallback = <span className="integration-fallback-icon">{app.name.slice(0, 2)}</span>;
  if (imageFailed) return fallback;

  if (normalizedName.includes("tdarr")) {
    return <img src={tdarrLogoUrl} alt="" loading="lazy" decoding="async" onError={() => setImageFailed(true)} />;
  }

  const iconSlug =
    normalizedName.includes("home assistant") || normalizedName.includes("hacs")
      ? "home-assistant"
      : app.slug;

  if (!iconSlug) {
    return fallback;
  }

  const source = normalizedName.includes("sickchill") ? sickChillLogoUrl : iconUrl(iconSlug);
  return <img src={source} alt="" loading="lazy" decoding="async" onError={() => setImageFailed(true)} />;
}

function formatHealthDate(value) {
  return formatLocaleDate(value, {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }, { fallback: "Never" });
}

function summarizeHealth(entries = []) {
  if (!entries.length) {
    return { successRate: "No checks", failingSince: null };
  }

  const successCount = entries.filter((entry) => entry.ok).length;
  const successRate = `${Math.round((successCount / entries.length) * 100)}% healthy`;
  if (entries[0]?.ok) {
    return { successRate, failingSince: null };
  }

  const failureStreak = [];
  for (const entry of entries) {
    if (entry.ok) break;
    failureStreak.push(entry);
  }

  return {
    successRate,
    failingSince: failureStreak[failureStreak.length - 1]?.checkedAt || entries[0]?.checkedAt,
  };
}

function buildHealthTimeline(entries = []) {
  return [...entries]
    .sort((first, second) => new Date(first.checkedAt || 0) - new Date(second.checkedAt || 0))
    .slice(-24);
}

function isLiveConnected(app) {
  if (app?.connected) return true;
  if (app?.messageType === "error") return false;
  const message = String(app?.message || "");
  return Boolean(app?.version) || /connected to/i.test(message);
}

function IntegrationCard({ app, type, onChange, onRemove, onSave, onTest, onCopySecret, removable = false }) {
  const { auth: clientAuth, authHint } = type === "download" ? downloadClientAuth(app) : {};
  const usesUserPass = clientAuth === "userpass";
  const usesPasswordOnly = clientAuth === "password";
  const secretOptional =
    Boolean(app.secretOptional) ||
    ["tdarr", "unpackerr", "kometa", "recyclarr"].some((slug) => String(app.name || app.slug || "").toLowerCase().includes(slug));
  // Saved apps keep only the fields they were created with, so read the label from the catalog too.
  const secretLabel =
    app.secretLabel || thirdPartyOptions.find((option) => String(app.slug || app.name || "").toLowerCase().includes(option.slug))?.secretLabel || "API key";
  const authLabel = usesUserPass || usesPasswordOnly ? "Password" : secretOptional ? `${secretLabel} (optional)` : secretLabel;
  const connected = isLiveConnected(app);
  const values = app.values || {};
  const hasStoredSecret = Boolean(values.secret) || connected;
  const secretPlaceholder = usesPasswordOnly || usesUserPass
    ? `${app.name} password`
    : secretOptional
      ? "Paste API key if auth is enabled"
      : hasStoredSecret && !values.secret
        ? "Saved on server — paste to replace"
        : `Paste ${secretLabel}`;
  const [showSecret, setShowSecret] = useState(false);

  return (
    <article className="integration-card" style={{ "--integration-accent": app.accent || "var(--primary-light-color)" }}>
      <div className="integration-card-header">
        <span className="integration-icon">
          <AppIcon app={app} />
        </span>
        <div>
          <h2>{app.name}</h2>
          <p>{type === "download" ? app.protocol : app.purpose}</p>
        </div>
        <span
          className={`integration-status-light ${connected ? "is-connected" : "is-disconnected"}`}
          aria-label={connected ? "Connected" : "Not connected"}
          title={connected ? "Connected" : "Not connected"}
        />
      </div>
      <div className="integration-fields">
        <label>
          URL
          <input
            value={values.url || ""}
            onChange={(event) => onChange(app.instanceId, "url", event.target.value)}
            placeholder={`https://${app.name.toLowerCase().replaceAll(" ", "-")}.local`}
          />
        </label>
        {usesUserPass ? (
          <label>
            Username
            <input
              value={values.username || ""}
              onChange={(event) => onChange(app.instanceId, "username", event.target.value)}
              placeholder={`${app.name} username`}
              autoComplete="username"
            />
          </label>
        ) : null}
        <label>
          {authLabel}
          <span className="integration-secret-field">
            <input
              value={values.secret || ""}
              onChange={(event) => onChange(app.instanceId, "secret", event.target.value)}
              placeholder={secretPlaceholder}
              type={showSecret ? "text" : "password"}
              autoComplete={usesUserPass || usesPasswordOnly ? "current-password" : "off"}
            />
            <button type="button" title={showSecret ? "Hide secret" : "Reveal secret"} onClick={() => setShowSecret(!showSecret)}>
              {showSecret ? <EyeOffFillIcon size={17} /> : <EyeFillIcon size={17} />}
            </button>
            <button type="button" title="Copy secret" onClick={() => onCopySecret(values.secret || "")} disabled={!values.secret}>
              <ClipboardLineIcon size={17} />
            </button>
          </span>
        </label>
        {authHint ? <small className="integration-auth-hint">{authHint}</small> : null}
      </div>
      {app.message ? <p className={`integration-message ${app.messageType === "error" ? "is-error" : ""}`}>{app.message}</p> : null}
      <div className="integration-actions">
        <button type="button" onClick={() => onTest(app.instanceId)}>
          Test
        </button>
        <button type="button" onClick={() => onSave(app.instanceId)}>
          Save
        </button>
        {removable ? (
          <button type="button" className="is-danger" onClick={() => onRemove(app.instanceId)}>
            Remove
          </button>
        ) : null}
      </div>
    </article>
  );
}

export default function Integrations({ embedded = false, firstRun = false, activeTab: controlledActiveTab = "", onTabChange, actions = null }) {
  // Re-render dates and numbers in the new locale when the language changes.
  useTranslation();
  const fileInputRef = useRef(null);
  const firstRunDefaultTab = firstRun ? "automation" : "media-server";
  const availableTabItems = firstRun ? integrationTabItems.filter(([key]) => key !== "media-server") : integrationTabItems;
  const [internalActiveTab, setInternalActiveTab] = useState(normalizeIntegrationTabSlug(controlledActiveTab) || firstRunDefaultTab);
  const activeTab = normalizeIntegrationTabSlug(controlledActiveTab) || internalActiveTab;
  const [arrApps, setArrApps] = useState(initialAutomationApps);
  const [clients, setClients] = useState([]);
  const [thirdParty, setThirdParty] = useState(initialThirdPartyApps);
  const [agentDefaults, setAgentDefaults] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("jellyglance_agent_defaults") || "{}") || {};
    } catch {
      return {};
    }
  });
  const [selectedClient, setSelectedClient] = useState(downloadClientOptions[0].name);
  const [firstRunSelection, setFirstRunSelection] = useState(firstRunIntegrationPickerOptions[0]?.key || "");
  const [firstRunPickerOpen, setFirstRunPickerOpen] = useState(false);
  const [firstRunVisibleIds, setFirstRunVisibleIds] = useState([]);
  const [healthHistory, setHealthHistory] = useState([]);
  const [diagnostics, setDiagnostics] = useState([]);
  const [busyAction, setBusyAction] = useState("");
  const arrAppsRef = useRef(arrApps);
  const clientsRef = useRef(clients);
  const thirdPartyRef = useRef(thirdParty);
  arrAppsRef.current = arrApps;
  clientsRef.current = clients;
  thirdPartyRef.current = thirdParty;
  const [notice, setNotice] = useState("");
  const [savedIntegrationsAvailable, setSavedIntegrationsAvailable] = useState(false);
  const [loadedSavedIntegrations, setLoadedSavedIntegrations] = useState(!firstRun);
  const connectorCount = useMemo(() => arrApps.length + clients.length + thirdParty.length, [arrApps.length, clients.length, thirdParty.length]);
  const automationOnlyApps = useMemo(() => arrApps.filter((app) => !isSeerrApp(app)), [arrApps]);
  const sickChillApps = useMemo(() => automationOnlyApps.filter((app) => String(app.name).toLowerCase() === "sickchill"), [automationOnlyApps]);
  const primaryAutomationApps = useMemo(() => automationOnlyApps.filter((app) => String(app.name).toLowerCase() !== "sickchill"), [automationOnlyApps]);
  const seerrApps = useMemo(() => arrApps.filter(isSeerrApp), [arrApps]);
  const enabledIntegrations = useMemo(() => [...arrApps, ...clients, ...thirdParty].filter((item) => item.connected), [arrApps, clients, thirdParty]);
  const selectedFirstRunIntegration = useMemo(
    () => firstRunIntegrationPickerOptions.find((option) => option.key === firstRunSelection) || firstRunIntegrationPickerOptions[0],
    [firstRunSelection]
  );
  const firstRunConfiguredIntegrations = useMemo(
    () =>
      [...arrApps, ...clients, ...thirdParty].filter((item) => {
        const hasValues = Object.values(item.values || {}).some((value) => String(value || "").trim());
        return firstRunVisibleIds.includes(item.instanceId) || item.connected || hasValues || item.message;
      }),
    [arrApps, clients, thirdParty, firstRunVisibleIds]
  );

  function updateAgentDefault(type, value) {
    setAgentDefaults((current) => {
      const next = { ...current, [type]: value };
      localStorage.setItem("jellyglance_agent_defaults", JSON.stringify(next));
      return next;
    });
  }
  const latestHealthById = useMemo(() => {
    const lookup = new Map();
    healthHistory.forEach((entry) => {
      if (entry.instanceId && !lookup.has(entry.instanceId)) {
        lookup.set(entry.instanceId, entry);
      }
    });
    return lookup;
  }, [healthHistory]);

  useEffect(() => {
    const normalized = normalizeIntegrationTabSlug(controlledActiveTab);
    if (normalized) {
      setInternalActiveTab(normalized);
    }
  }, [controlledActiveTab]);

  useEffect(() => {
    if (firstRun && activeTab === "media-server") {
      setInternalActiveTab("automation");
      onTabChange?.("automation");
    }
  }, [activeTab, firstRun, onTabChange]);

  function selectIntegrationTab(tabKey) {
    const normalized = normalizeIntegrationTabSlug(tabKey) || firstRunDefaultTab;
    setInternalActiveTab(normalized);
    onTabChange?.(normalized);
  }

  useEffect(() => {
    async function loadIntegrations() {
      if (firstRun && !loadedSavedIntegrations) {
        setArrApps(initialAutomationApps);
        setClients([]);
        setThirdParty(initialThirdPartyApps);
        setFirstRunVisibleIds([]);
        setHealthHistory([]);
        setSavedIntegrationsAvailable(true);
        return;
      }

      try {
        const response = await axios.get("/api/integrations", {
          headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
        });
        let saved = response.data || {};
        const localSaved = loadSavedIntegrations();
        const backendIsEmpty = !saved.arrApps?.length && !saved.clients?.length && !saved.thirdParty?.length;
        const localHasIntegrations = localSaved.arrApps?.length || localSaved.clients?.length || localSaved.thirdParty?.length;

        if (backendIsEmpty && localHasIntegrations) {
          saved = localSaved;
          axios
            .post("/api/integrations", saved, {
              headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
            })
            .catch((error) => console.log("Unable to migrate local integrations", error));
        }

        saveSavedIntegrations(saved);
        setHealthHistory(Array.isArray(saved.healthHistory) ? saved.healthHistory : []);
        setArrApps(normalizeAutomationApps(saved.arrApps));
        if (Array.isArray(saved.clients)) {
          setClients(saved.clients);
        }
        const normalizedThirdParty = normalizeThirdPartyApps(saved.thirdParty, saved.arrApps);
        setThirdParty(normalizedThirdParty);
        if (firstRun) {
          const visibleIds = [...normalizeAutomationApps(saved.arrApps), ...(Array.isArray(saved.clients) ? saved.clients : []), ...normalizedThirdParty]
            .filter((item) => item.connected || Object.values(item.values || {}).some((value) => String(value || "").trim()))
            .map((item) => item.instanceId);
          setFirstRunVisibleIds(visibleIds);
        }
      } catch {
        const saved = loadSavedIntegrations();
        const normalizedArrApps = normalizeAutomationApps(saved.arrApps);
        setArrApps(normalizedArrApps);
        if (Array.isArray(saved.clients)) {
          setClients(saved.clients);
        }
        const normalizedThirdParty = normalizeThirdPartyApps(saved.thirdParty, saved.arrApps);
        setThirdParty(normalizedThirdParty);
        if (firstRun) {
          const visibleIds = [...normalizedArrApps, ...(Array.isArray(saved.clients) ? saved.clients : []), ...normalizedThirdParty]
            .filter((item) => item.connected || Object.values(item.values || {}).some((value) => String(value || "").trim()))
            .map((item) => item.instanceId);
          setFirstRunVisibleIds(visibleIds);
        }
      }
    }
    loadIntegrations();
    if (!firstRun || loadedSavedIntegrations) {
      loadHealthHistory();
    }
  }, [firstRun, loadedSavedIntegrations]);

  async function loadHealthHistory() {
    try {
      const response = await axios.get("/api/integrations/health-history", {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      });
      setHealthHistory(response.data || []);
    } catch (error) {
      console.log("Unable to load integration health history", error);
    }
  }

  function persist(nextArrApps = arrApps, nextClients = clients, nextThirdParty = thirdParty) {
    const payload = { arrApps: nextArrApps, clients: nextClients, thirdParty: nextThirdParty };
    saveSavedIntegrations(payload);
    window.dispatchEvent(new CustomEvent("jellyglance-integrations-updated", { detail: payload }));
    axios
      .post("/api/integrations", payload, {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      })
      .then(() => window.dispatchEvent(new CustomEvent("jellyglance-integrations-updated", { detail: payload })))
      .catch((error) => console.log("Unable to save integrations", error));
  }

  function loadExistingIntegrations() {
    setLoadedSavedIntegrations(true);
    setNotice("Loaded saved integrations into first-run setup.");
  }

  function showFirstRunIntegration(instanceId) {
    setFirstRunVisibleIds((current) => (current.includes(instanceId) ? current : [...current, instanceId]));
  }

  function removeFirstRunIntegration(instanceId, listName, setList, type) {
    setFirstRunVisibleIds((current) => current.filter((id) => id !== instanceId));
    if (type === "download") {
      removeIntegration(listName, setList, instanceId);
      return;
    }
    setList((current) => {
      const next = current.map((item) =>
        item.instanceId === instanceId
          ? {
              ...item,
              connected: false,
              message: "",
              messageType: "",
              values: {},
            }
          : item
      );
      const nextArrApps = listName === "arrApps" ? next : arrApps;
      const nextThirdParty = listName === "thirdParty" ? next : thirdParty;
      persist(nextArrApps, clients, nextThirdParty);
      return next;
    });
  }

  function exportIntegrations() {
    const payload = {
      exportedAt: new Date().toISOString(),
      version: 1,
      integrations: { arrApps, clients, thirdParty },
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `jellyglance-integrations-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    URL.revokeObjectURL(link.href);
    link.remove();
    setNotice("Integration config exported.");
  }

  async function importIntegrations(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const imported = parsed.integrations || parsed;
      const nextArrApps = normalizeAutomationApps(imported.arrApps);
      const nextClients = Array.isArray(imported.clients) ? imported.clients : [];
      const nextThirdParty = normalizeThirdPartyApps(imported.thirdParty, imported.arrApps);
      setArrApps(nextArrApps);
      setClients(nextClients);
      setThirdParty(nextThirdParty);
      persist(nextArrApps, nextClients, nextThirdParty);
      setNotice(`${file.name} imported.`);
    } catch (error) {
      setNotice("Import failed. Choose a JellyGlance integrations JSON file.");
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function copySecret(secret) {
    if (!secret) return;
    await navigator.clipboard.writeText(secret);
    if (!firstRun) {
      setNotice("Secret copied.");
    }
  }

  function persistForList(listName, next) {
    persist(
      listName === "arrApps" ? next : arrAppsRef.current,
      listName === "clients" ? next : clientsRef.current,
      listName === "thirdParty" ? next : thirdPartyRef.current
    );
  }

  function applyTestResults(results = []) {
    const byId = new Map(results.map((row) => [row.instanceId, row]));
    const patch = (list) =>
      list.map((item) => {
        const row = byId.get(item.instanceId);
        if (!row) return item;
        return {
          ...item,
          connected: Boolean(row.ok),
          version: row.version || item.version,
          message: row.message || item.message,
          messageType: row.ok ? "success" : "error",
        };
      });
    const nextArrApps = patch(arrAppsRef.current);
    const nextClients = patch(clientsRef.current);
    const nextThirdParty = patch(thirdPartyRef.current);
    setArrApps(nextArrApps);
    setClients(nextClients);
    setThirdParty(nextThirdParty);
    persist(nextArrApps, nextClients, nextThirdParty);
  }

  async function testAllIntegrations() {
    try {
      setBusyAction("test-all");
      setNotice("");
      const response = await axios.post(
        "/api/integrations/test-all",
        {},
        {
          headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
        }
      );
      setDiagnostics(response.data.results || []);
      setHealthHistory(response.data.history || []);
      applyTestResults(response.data.results || []);
      setNotice("Integration diagnostics complete.");
    } catch (error) {
      setNotice(error?.response?.data?.error || "Unable to run integration diagnostics.");
    } finally {
      setBusyAction("");
    }
  }

  function updateIntegration(listName, setList, instanceId, field, value) {
    setList((current) => {
      const next = current.map((item) =>
        item.instanceId === instanceId
          ? {
              ...item,
              connected: false,
              message: "",
              values: {
                ...(item.values || {}),
                [field]: value,
              },
            }
          : item
      );
      persistForList(listName, next);
      return next;
    });
  }

  function removeIntegration(listName, setList, instanceId) {
    setList((current) => {
      const next = current.filter((item) => item.instanceId !== instanceId);
      persistForList(listName, next);
      return next;
    });
  }

  function saveIntegration(listName, setList, instanceId) {
    setList((current) => {
      const next = current.map((item) =>
        item.instanceId === instanceId
          ? {
              ...item,
              message: "Saved",
              messageType: "success",
            }
          : item
      );
      persistForList(listName, next);
      return next;
    });
  }

  async function testIntegration(listName, setList, instanceId) {
    const currentList = listName === "clients" ? clients : listName === "thirdParty" ? thirdParty : arrApps;
    const selectedIntegration = currentList.find((item) => item.instanceId === instanceId);

    if (!selectedIntegration) {
      return;
    }

    const values = selectedIntegration.values || {};
    const needsUsername = listName === "clients" && downloadClientAuth(selectedIntegration).auth === "userpass";
    const missingUrl = !values.url?.trim();
    const missingUsername = needsUsername && !values.username?.trim();
    const secretOptional =
      listName === "thirdParty" &&
      (selectedIntegration.secretOptional ||
        ["tdarr", "unpackerr", "kometa", "recyclarr"].some((slug) => String(selectedIntegration.name || selectedIntegration.slug || "").toLowerCase().includes(slug)));
    const missingSecret = !secretOptional && !values.secret?.trim() && !isLiveConnected(selectedIntegration);
    const invalidUrl = values.url?.trim() && !/^https?:\/\//i.test(values.url.trim());
    const validationError = invalidUrl ? "URL must start with http:// or https://" : "Fill in all required fields before testing";

    setList((current) =>
      current.map((item) => {
        if (item.instanceId !== instanceId) return item;

        if (missingUrl || missingUsername || missingSecret || invalidUrl) {
          return {
            ...item,
            connected: false,
            message: validationError,
            messageType: "error",
          };
        }

        return {
          ...item,
          message: "Testing connection...",
          messageType: "success",
        };
      })
    );

    if (missingUrl || missingUsername || missingSecret || invalidUrl) {
      return;
    }

    try {
      const response = await axios.post(
        "/api/integrations/test",
        {
          type: listName === "clients" ? "download" : listName === "thirdParty" ? "thirdParty" : "automation",
          integration: selectedIntegration,
        },
        {
          headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
        }
      );

      setList((current) => {
        const next = current.map((item) =>
          item.instanceId === instanceId
            ? {
                ...item,
                connected: true,
                version: response.data.version,
                message: response.data.message || `Connected to ${response.data.version}`,
                messageType: "success",
              }
            : item
        );
        persistForList(listName, next);
        return next;
      });
    } catch (error) {
      const message = error?.response?.data?.error || "Connection test failed";
      setList((current) => {
        const next = current.map((item) =>
          item.instanceId === instanceId
            ? {
                ...item,
                connected: false,
                message,
                messageType: "error",
              }
            : item
        );
        persistForList(listName, next);
        return next;
      });
    }
  }

  function addClient() {
    const client = downloadClientOptions.find((item) => item.name === selectedClient);
    if (!client) return;
    setClients((current) => {
      const next = [
        ...current,
        {
          ...client,
          instanceId: `${client.name}-${Date.now()}-${current.length}`,
          connected: false,
          values: {},
        },
      ];
      persist(arrApps, next, thirdParty);
      return next;
    });
  }

  function addFirstRunIntegration() {
    const [kind, identifier] = String(firstRunSelection || "").split(":");
    if (kind === "arr") {
      const match = arrApps.find((item) => item.slug === identifier);
      if (match) showFirstRunIntegration(match.instanceId);
      setFirstRunPickerOpen(false);
      return;
    }

    if (kind === "third") {
      const match = thirdParty.find((item) => item.slug === identifier);
      if (match) showFirstRunIntegration(match.instanceId);
      setFirstRunPickerOpen(false);
      return;
    }

    if (kind === "download") {
      const existing = clients.find((item) => item.name === identifier && !firstRunVisibleIds.includes(item.instanceId));
      if (existing) {
        showFirstRunIntegration(existing.instanceId);
        setFirstRunPickerOpen(false);
        return;
      }
      const client = downloadClientOptions.find((item) => item.name === identifier);
      if (!client) return;
      setClients((current) => {
        const nextClient = {
          ...client,
          instanceId: `${client.name}-${Date.now()}-${current.length}`,
          connected: false,
          values: {},
        };
        const next = [...current, nextClient];
        persist(arrApps, next, thirdParty);
        setFirstRunVisibleIds((visible) => [...visible, nextClient.instanceId]);
        return next;
      });
    }
    setFirstRunPickerOpen(false);
  }

  return (
    <div className={`integrations-page${embedded ? " is-embedded" : ""}${firstRun ? " is-first-run" : ""}`}>
      <section className="integrations-hero">
        <div>
          <p>Media control</p>
          <h1>Integrations</h1>
          <span>Connect automation apps and as many download clients as your stack needs.</span>
        </div>
        <div className="integrations-status">
          <Plug2FillIcon />
          <strong>{connectorCount}</strong>
          <span>connectors</span>
        </div>
      </section>

      {firstRun ? (
        <section className="first-run-integrations-shell">
          <div className="first-run-integrations-left">
            <div className="first-run-integrations-toolbar">
              <div className="first-run-integrations-picker">
                <span>Add an integration</span>
                <div className={`first-run-integrations-picker-row${firstRunPickerOpen ? " is-open" : ""}`}>
                  <div className="first-run-app-picker">
                    <button
                      type="button"
                      className="first-run-app-picker-trigger"
                      onClick={() => setFirstRunPickerOpen((open) => !open)}
                      aria-expanded={firstRunPickerOpen}
                    >
                      <span className="first-run-app-picker-icon">
                        <AppIcon app={selectedFirstRunIntegration} />
                      </span>
                      <span className="first-run-app-picker-copy">
                        <strong>{selectedFirstRunIntegration?.label}</strong>
                        <small>{selectedFirstRunIntegration?.kind} · {selectedFirstRunIntegration?.description}</small>
                      </span>
                      <ArrowDownSLineIcon size={20} />
                    </button>
                    {firstRunPickerOpen ? (
                      <div className="first-run-app-picker-menu">
                        {firstRunIntegrationPickerOptions.map((option) => (
                          <button
                            type="button"
                            key={option.key}
                            className={firstRunSelection === option.key ? "is-selected" : ""}
                            onClick={() => {
                              setFirstRunSelection(option.key);
                              setFirstRunPickerOpen(false);
                            }}
                          >
                            <span className="first-run-app-picker-icon">
                              <AppIcon app={option} />
                            </span>
                            <span className="first-run-app-picker-copy">
                              <strong>{option.label}</strong>
                              <small>{option.kind} · {option.description}</small>
                            </span>
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <button type="button" onClick={addFirstRunIntegration}>
                    <AddLineIcon size={18} />
                    Add integration
                  </button>
                </div>
              </div>

              <div className="first-run-integrations-utility">
                {!firstRun || loadedSavedIntegrations ? (
                  <button type="button" onClick={testAllIntegrations} disabled={busyAction === "test-all"}>
                    <HeartPulseLineIcon size={18} />
                    {busyAction === "test-all" ? "Testing" : "Test all"}
                  </button>
                ) : null}
                <label>
                  <UploadCloud2LineIcon size={18} />
                  Import
                  <input ref={fileInputRef} type="file" accept=".json,application/json" onChange={importIntegrations} />
                </label>
              </div>
            </div>

            {actions ? <div className="first-run-integrations-actions">{actions}</div> : null}
          </div>

          <section className="integration-section first-run-configured-list">
            <div className="integration-section-title">
              <div>
                <h2>Configured integrations</h2>
                <span>{firstRunConfiguredIntegrations.length ? `${firstRunConfiguredIntegrations.length} in setup` : "Add the apps you want ready for first sync."}</span>
              </div>
            </div>
            {firstRunConfiguredIntegrations.length ? (
              <div className="integration-grid">
                {firstRunConfiguredIntegrations.map((app) => {
                  const type = clients.some((client) => client.instanceId === app.instanceId)
                    ? "download"
                    : thirdParty.some((item) => item.instanceId === app.instanceId)
                      ? "thirdParty"
                      : "automation";
                  const listName = type === "download" ? "clients" : type === "thirdParty" ? "thirdParty" : "arrApps";
                  const setList = type === "download" ? setClients : type === "thirdParty" ? setThirdParty : setArrApps;
                  return (
                    <IntegrationCard
                      key={app.instanceId}
                      app={app}
                      type={type}
                      onChange={(instanceId, field, value) => updateIntegration(listName, setList, instanceId, field, value)}
                      onRemove={(instanceId) => removeFirstRunIntegration(instanceId, listName, setList, type)}
                      onSave={(instanceId) => saveIntegration(listName, setList, instanceId)}
                      onTest={(instanceId) => testIntegration(listName, setList, instanceId)}
                      onCopySecret={copySecret}
                      removable
                    />
                  );
                })}
              </div>
            ) : (
              <div className="first-run-integrations-empty">
                <strong>No integrations added yet</strong>
                <span>Choose an app above, add it to the setup list, then fill in its connection details here.</span>
              </div>
            )}
          </section>
        </section>
      ) : null}

      {firstRun ? null : (

      <nav className="integration-subtabs" aria-label="Integration categories">
        {availableTabItems.map(([key, label]) => (
          <button type="button" className={activeTab === key ? "is-active" : ""} onClick={() => selectIntegrationTab(key)} key={key}>
            {label}
          </button>
        ))}
      </nav>
      )}

      {activeTab === "media-server" ? <JellyfinIntegrationSettings compact firstRun={firstRun} /> : null}

      {activeTab === "media-server" ? (
        <section className="integration-agent-panel">
          <div className="integration-subsection-title">
            <strong>Default media agents</strong>
            <span>Choose the preferred service for TV, movies, and audio workflows.</span>
          </div>
          <div className="integration-agent-grid">
            {Object.entries(defaultAgentOptions).map(([type, options]) => {
              const typeLabel = type === "tv" ? "TV shows" : type === "movies" ? "Movies" : "Audio";
              const selected = agentDefaults[type] || options[0];
              return (
                <div key={type} className="integration-agent-category">
                  <span className="integration-agent-type-label">{typeLabel}</span>
                  <div className="integration-agent-choices">
                    {options.map((option) => {
                      const meta = defaultAgentMeta[option] || {};
                      const isSelected = selected === option;
                      return (
                        <button
                          type="button"
                          key={option}
                          className={`integration-agent-choice${isSelected ? " is-selected" : ""}`}
                          style={{ "--agent-accent": meta.accent || "var(--primary-color)" }}
                          onClick={() => updateAgentDefault(type, option)}
                          aria-pressed={isSelected}
                        >
                          <span className="integration-agent-choice-icon">
                            <AppIcon app={{ name: option, ...meta }} />
                          </span>
                          <span className="integration-agent-choice-copy">
                            <strong>{option}</strong>
                            <small>{meta.role || ""}</small>
                          </span>
                          {isSelected ? <span className="integration-agent-check">✓</span> : null}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      {!firstRun && notice ? <div className="integration-notice">{notice}</div> : null}

      {!firstRun && activeTab === "automation" ? (
        <section className="integration-section">
          <div className="integration-section-title">
            <div>
              <h2>Arr Apps</h2>
              <span>Sonarr, Radarr, Lidarr, Readarr, Prowlarr, and Bazarr</span>
            </div>
            <Settings3LineIcon />
          </div>
          {!firstRun ? (
            <div className="integration-toolbar">
              {firstRun && !loadedSavedIntegrations && savedIntegrationsAvailable ? (
                <button type="button" onClick={loadExistingIntegrations}>
                  <DownloadCloud2FillIcon size={18} />
                  Load saved integrations
                </button>
              ) : null}
              {!firstRun || loadedSavedIntegrations ? (
                <button type="button" onClick={testAllIntegrations} disabled={busyAction === "test-all"}>
                  <HeartPulseLineIcon size={18} />
                  {busyAction === "test-all" ? "Testing" : "Test all"}
                </button>
              ) : null}
              <button type="button" onClick={exportIntegrations}>
                <DownloadCloud2FillIcon size={18} />
                Export
              </button>
              <label>
                <UploadCloud2LineIcon size={18} />
                Import
                <input ref={fileInputRef} type="file" accept=".json,application/json" onChange={importIntegrations} />
              </label>
            </div>
          ) : null}
          <div className="integration-grid">
            {primaryAutomationApps.map((app) => (
              <IntegrationCard
                key={app.instanceId}
                app={app}
                type="automation"
                onChange={(instanceId, field, value) => updateIntegration("arrApps", setArrApps, instanceId, field, value)}
                onRemove={(instanceId) => removeIntegration("arrApps", setArrApps, instanceId)}
                onSave={(instanceId) => saveIntegration("arrApps", setArrApps, instanceId)}
                onTest={(instanceId) => testIntegration("arrApps", setArrApps, instanceId)}
                onCopySecret={copySecret}
              />
            ))}
          </div>
          {sickChillApps.length ? (
            <div className="integration-subsection">
              <div className="integration-subsection-title">
                <strong>TV alternative</strong>
                <span>Connect SickChill for health checks. It does not fill the JellyGlance release calendar — use Sonarr for that.</span>
              </div>
              <div className="integration-grid integration-grid-single-row">
                {sickChillApps.map((app) => (
                  <IntegrationCard
                    key={app.instanceId}
                    app={app}
                    type="automation"
                    onChange={(instanceId, field, value) => updateIntegration("arrApps", setArrApps, instanceId, field, value)}
                    onRemove={(instanceId) => removeIntegration("arrApps", setArrApps, instanceId)}
                    onSave={(instanceId) => saveIntegration("arrApps", setArrApps, instanceId)}
                    onTest={(instanceId) => testIntegration("arrApps", setArrApps, instanceId)}
                    onCopySecret={copySecret}
                  />
                ))}
              </div>
            </div>
          ) : null}
          <div className="integration-link-panel">
            <div>
              <strong>Automation health</strong>
              <span>Review Bazarr subtitles and Prowlarr indexer status from one JellyGlance view.</span>
            </div>
            <div className="integration-link-actions">
              <Link to="/automation-health">Open Automation Health</Link>
            </div>
          </div>
        </section>
      ) : null}

      {!firstRun && activeTab === "seerr" ? (
        <section className="integration-section">
          <div className="integration-section-title">
            <div>
              <h2>Seerr Apps</h2>
              <span>Jellyseerr and Overseerr request management</span>
            </div>
            <Settings3LineIcon />
          </div>
          {!firstRun ? (
          <div className="integration-toolbar">
            {firstRun && !loadedSavedIntegrations && savedIntegrationsAvailable ? (
              <button type="button" onClick={loadExistingIntegrations}>
                <DownloadCloud2FillIcon size={18} />
                Load saved integrations
              </button>
            ) : null}
            {!firstRun || loadedSavedIntegrations ? (
              <button type="button" onClick={testAllIntegrations} disabled={busyAction === "test-all"}>
                <HeartPulseLineIcon size={18} />
                {busyAction === "test-all" ? "Testing" : "Test all"}
              </button>
            ) : null}
            <button type="button" onClick={exportIntegrations}>
              <DownloadCloud2FillIcon size={18} />
              Export
            </button>
            <label>
              <UploadCloud2LineIcon size={18} />
              Import
              <input ref={fileInputRef} type="file" accept=".json,application/json" onChange={importIntegrations} />
            </label>
          </div>
          ) : null}
          <div className="integration-grid">
            {seerrApps.map((app) => (
              <IntegrationCard
                key={app.instanceId}
                app={app}
                type="automation"
                onChange={(instanceId, field, value) => updateIntegration("arrApps", setArrApps, instanceId, field, value)}
                onRemove={(instanceId) => removeIntegration("arrApps", setArrApps, instanceId)}
                onSave={(instanceId) => saveIntegration("arrApps", setArrApps, instanceId)}
                onTest={(instanceId) => testIntegration("arrApps", setArrApps, instanceId)}
                onCopySecret={copySecret}
              />
            ))}
          </div>
        </section>
      ) : null}

      {!firstRun && activeTab === "downloads" ? (
        <section className="integration-section">
          <div className="integration-section-title">
            <div>
              <h2>Download Clients</h2>
              <span>Add more than one torrent or Usenet client</span>
            </div>
            <div className="client-adder">
              {firstRun && !loadedSavedIntegrations && savedIntegrationsAvailable ? (
                <button type="button" onClick={loadExistingIntegrations}>
                  <DownloadCloud2FillIcon size={18} />
                  Load saved integrations
                </button>
              ) : null}
              {!firstRun || loadedSavedIntegrations ? (
                <button type="button" onClick={testAllIntegrations} disabled={busyAction === "test-all"}>
                  <HeartPulseLineIcon size={18} />
                  {busyAction === "test-all" ? "Testing" : "Test all"}
                </button>
              ) : null}
              <button type="button" onClick={exportIntegrations}>
                <DownloadCloud2FillIcon size={18} />
                Export
              </button>
              <label className="integration-import-button">
                <UploadCloud2LineIcon size={18} />
                Import
                <input ref={fileInputRef} type="file" accept=".json,application/json" onChange={importIntegrations} />
              </label>
              <select value={selectedClient} onChange={(event) => setSelectedClient(event.target.value)}>
                {downloadClientOptions.map((client) => (
                  <option key={client.name}>{client.name}</option>
                ))}
              </select>
              <button type="button" onClick={addClient}>
                <AddLineIcon size={18} />
                Add client
              </button>
            </div>
          </div>
          <div className="integration-grid">
            {clients.map((client) => (
              <IntegrationCard
                key={client.instanceId}
                app={client}
                type="download"
                onChange={(instanceId, field, value) => updateIntegration("clients", setClients, instanceId, field, value)}
                onRemove={(instanceId) => removeIntegration("clients", setClients, instanceId)}
                onSave={(instanceId) => saveIntegration("clients", setClients, instanceId)}
                onTest={(instanceId) => testIntegration("clients", setClients, instanceId)}
                onCopySecret={copySecret}
                removable
              />
            ))}
          </div>
        </section>
      ) : null}

      {!firstRun && activeTab === "invites" ? (
        <section className="integration-section">
          <div className="integration-section-title">
            <div>
              <h2>3rd party apps</h2>
              <span>Wizarr, Tdarr, Maintainerr, Audiobookshelf, Unpackerr, and Kometa</span>
            </div>
            <UserAddLineIcon />
          </div>
          {!firstRun ? (
          <div className="integration-toolbar">
            {firstRun && !loadedSavedIntegrations && savedIntegrationsAvailable ? (
              <button type="button" onClick={loadExistingIntegrations}>
                <DownloadCloud2FillIcon size={18} />
                Load saved integrations
              </button>
            ) : null}
            {!firstRun || loadedSavedIntegrations ? (
              <button type="button" onClick={testAllIntegrations} disabled={busyAction === "test-all"}>
                <HeartPulseLineIcon size={18} />
                {busyAction === "test-all" ? "Testing" : "Test all"}
              </button>
            ) : null}
            <button type="button" onClick={exportIntegrations}>
              <DownloadCloud2FillIcon size={18} />
              Export
            </button>
            <label>
              <UploadCloud2LineIcon size={18} />
              Import
              <input ref={fileInputRef} type="file" accept=".json,application/json" onChange={importIntegrations} />
            </label>
          </div>
          ) : null}
          <div className="integration-grid">
            {thirdParty.map((app) => (
              <IntegrationCard
                key={app.instanceId}
                app={app}
                type="thirdParty"
                onChange={(instanceId, field, value) => updateIntegration("thirdParty", setThirdParty, instanceId, field, value)}
                onRemove={(instanceId) => removeIntegration("thirdParty", setThirdParty, instanceId)}
                onSave={(instanceId) => saveIntegration("thirdParty", setThirdParty, instanceId)}
                onTest={(instanceId) => testIntegration("thirdParty", setThirdParty, instanceId)}
                onCopySecret={copySecret}
              />
            ))}
          </div>
          <div className="integration-link-panel">
            <div>
              <strong>Open connected tools</strong>
              <span>Manage Wizarr invitations, monitor Tdarr transcodes, and review Maintainerr cleanup activity from JellyGlance.</span>
            </div>
            <div className="integration-link-actions">
              <Link to="/wizarr">Open Wizarr links</Link>
              <Link to="/active-transcodes">Open Active Transcodes</Link>
              <Link to="/maintainerr">Open Maintainerr</Link>
            </div>
          </div>
        </section>
      ) : null}

      {!firstRun && activeTab !== "media-server" ? (
        <section className="integration-section integration-health-panel">
          <div className="integration-section-title">
            <div>
              <h2>Health History</h2>
              <span>Recent integration checks</span>
            </div>
            <HeartPulseLineIcon />
          </div>
          <div className="integration-health-grid">
            {enabledIntegrations.map((item) => {
              const health = latestHealthById.get(item.instanceId);
              const healthEntries = healthHistory.filter((entry) => entry.instanceId === item.instanceId);
              const summary = summarizeHealth(healthEntries);
              return (
                <article key={item.instanceId} className={health?.ok ? "is-ok" : "is-error"}>
                  {health?.ok ? <CheckboxCircleLineIcon size={18} /> : <ErrorWarningLineIcon size={18} />}
                  <div>
                    <strong>{item.name}</strong>
                    <span>{health?.message || "No health checks recorded"}</span>
                    <em>{summary.failingSince ? `Failing since ${formatHealthDate(summary.failingSince)}` : summary.successRate}</em>
                    <div className="integration-uptime-timeline" aria-label={`${item.name} uptime timeline`}>
                      {buildHealthTimeline(healthEntries).map((entry, index) => (
                        <i
                          key={`${entry.checkedAt || index}-${index}`}
                          className={entry.ok ? "is-ok" : "is-error"}
                          title={`${formatHealthDate(entry.checkedAt)} · ${entry.ok ? "Healthy" : "Failed"}`}
                        />
                      ))}
                    </div>
                  </div>
                  <small>{formatHealthDate(health?.checkedAt)}</small>
                </article>
              );
            })}
            {!enabledIntegrations.length ? <div className="integration-empty-state">No enabled integrations yet.</div> : null}
          </div>
          {diagnostics.length ? (
            <div className="integration-diagnostic-list">
              {diagnostics.filter((result) => enabledIntegrations.some((item) => item.instanceId === result.instanceId)).map((result) => (
                <span key={`${result.instanceId}-${result.checkedAt}`} className={result.ok ? "is-ok" : "is-error"}>
                  {result.name}: {result.message}
                </span>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

    </div>
  );
}

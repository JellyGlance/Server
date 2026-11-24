import { useEffect, useMemo, useRef, useState } from "react";
import SearchLineIcon from "remixicon-react/SearchLineIcon";
import CloseLineIcon from "remixicon-react/CloseLineIcon";

// Every searchable setting. "anchor" is the visible heading or label we scroll to after opening the tab.
const SETTINGS_INDEX = [
  { tab: "tabGeneral", title: "Language", anchor: "Language", keywords: "translation locale english" },
  { tab: "tabGeneral", title: "Hour format (12 or 24 hour)", anchor: "Hour Format", keywords: "clock time am pm" },
  { tab: "tabGeneral", title: "Font weight", anchor: "Font weight", keywords: "text bold thin typography" },
  { tab: "tabGeneral", title: "External URL", anchor: "External URL", keywords: "server access public address domain link" },
  { tab: "tabGeneral", title: "Theme and colours", anchor: "Theme preset", keywords: "theme colour color dark light accent appearance primary background" },
  { tab: "tabGeneral", title: "Navbar order", anchor: "Navbar order", keywords: "menu sidebar navigation reorder hide tabs" },
  { tab: "tabSecurity", title: "Login method (Jellyfin, Quick Connect, local)", anchor: "Authentication", keywords: "sign in login auth quick connect password" },
  { tab: "tabSecurity", title: "Single sign-on (OIDC)", anchor: "Issuer URL", keywords: "sso oidc oauth authentik authelia keycloak client id secret redirect" },
  { tab: "tabSecurity", title: "Active sessions privacy", anchor: "Active Sessions privacy", keywords: "hide users privacy now playing" },
  { tab: "tabKiosk", title: "Kiosk page widgets", anchor: "Customise Kiosk Page", keywords: "tv display wall dashboard widgets order hidden" },
  { tab: "tabStatusPage", title: "Status Page builder", keywords: "status page public uptime blocks layout share builder" },
  { tab: "tabStatusPage", title: "Maintenance notice", anchor: "Maintenance notice", keywords: "maintenance outage downtime notice status" },
  { tab: "tabStatusPage", title: "Uptime history", anchor: "Blocks", keywords: "uptime history availability status bars" },
  { tab: "tabLibraries", title: "Libraries to track", keywords: "library select hide exclude collections" },
  { tab: "tabLibraries", title: "Display library names", anchor: "Display library names", keywords: "rename library" },
  { tab: "tabActivityMonitor", title: "Activity monitor polling", anchor: "Activity Monitor", keywords: "interval refresh active idle sessions polling realtime" },
  { tab: "tabJellyfinDevices", title: "Authorised devices", keywords: "jellyfin devices clients remove revoke" },
  { tab: "tabJellyfinPlugins", title: "Jellyfin plugins", keywords: "plugins install update catalogue" },
  { tab: "tabJellyfinJobs", title: "Jellyfin scheduled jobs", keywords: "scheduled tasks jobs schedules library scan triggers" },
  { tab: "tabIntegrations", sub: "media-server", title: "Media server (Jellyfin) connection", keywords: "jellyfin emby server url api key connection" },
  { tab: "tabIntegrations", sub: "automation", title: "Sonarr, Radarr, Lidarr and other Arr apps", keywords: "arr sonarr radarr lidarr readarr prowlarr bazarr" },
  { tab: "tabIntegrations", sub: "automation", title: "Automation health", anchor: "Automation health", keywords: "arr health checks" },
  { tab: "tabIntegrations", sub: "seerr", title: "Jellyseerr / Overseerr (requests)", keywords: "seerr jellyseerr overseerr requests" },
  { tab: "tabIntegrations", sub: "downloads", title: "Download clients", keywords: "qbittorrent sabnzbd nzbget transmission deluge downloads" },
  { tab: "tabIntegrations", sub: "invites", title: "Invites and transcodes (Wizarr, Tdarr)", keywords: "wizarr tdarr invites transcodes maintainerr" },
  { tab: "tabKeys", title: "API keys", keywords: "api key token access swagger docs developer" },
  { tab: "tabWebhooks", title: "Webhooks", anchor: "Webhook Configuration", keywords: "discord gotify slack ntfy telegram webhook url events" },
  { tab: "tabWebhooks", title: "Quiet hours (Night Shift)", anchor: "Night Shift", keywords: "quiet hours night do not disturb" },
  { tab: "tabWebhooks", title: "Webhook notification cards", anchor: "Notification cards", keywords: "card accent colour style embed" },
  { tab: "tabNotifications", title: "Notification delivery (in-app, desktop, mobile)", anchor: "Delivery", keywords: "push desktop mobile browser notifications" },
  { tab: "tabNotifications", title: "What to notify about", anchor: "What to notify about", keywords: "notification types categories playback errors" },
  { tab: "tabNotifications", title: "Pop-up position and duration", anchor: "In-app pop-ups", keywords: "toast position duration" },
  { tab: "tabNotifications", title: "Threshold alerts", anchor: "Threshold alerts", keywords: "alerts disk space stuck downloads failed jobs new device warning" },
  { tab: "tabNewsletter", title: "Newsletter campaigns", anchor: "Campaigns", keywords: "newsletter email report weekly digest" },
  { tab: "tabNewsletter", title: "Email (SMTP) server", anchor: "Shared SMTP", keywords: "smtp email mail server sender password" },
  { tab: "tabNewsletter", title: "Digest channels", anchor: "Channels", keywords: "newsletter discord telegram webhook digest" },
  { tab: "tabNewsletter", title: "Automatic newsletter emails", anchor: "Automations", keywords: "welcome milestone admin digest re-engagement wizarr" },
  { tab: "tabNewsletter", title: "Newsletter archive", anchor: "Archive", keywords: "newsletter archive public digest history" },
  { tab: "tabTasks", title: "JellyGlance tasks", keywords: "sync tasks schedule full partial backup run" },
  { tab: "tabBackup", title: "Backups", anchor: "Backups", keywords: "backup restore export" },
  { tab: "tabBackup", title: "Off-box backup copy (S3)", anchor: "Off-box copy", keywords: "s3 bucket remote offsite cloud region" },
  { tab: "tabImports", title: "Import from Jellystat, Tautulli, Jellyfin or Trakt", keywords: "import history jellystat tautulli trakt playback migrate" },
  { tab: "tabHealth", title: "Webhook delivery history", anchor: "Webhook Delivery History", keywords: "health webhook log failures" },
  { tab: "tabHealth", title: "Admin audit log", anchor: "Admin Audit Log", keywords: "audit log changes admin history" },
  { tab: "tabRepair", title: "Repair hub", keywords: "repair fix missing links task failures cleanup" },
  { tab: "tabLogs", title: "Logs", keywords: "logs debug errors output" },
];

function score(entry, words) {
  const title = entry.title.toLowerCase();
  const hay = `${title} ${entry.tabLabel.toLowerCase()} ${entry.keywords}`;
  let total = 0;
  for (const word of words) {
    if (!hay.includes(word)) return 0;
    total += title.startsWith(word) ? 4 : title.includes(word) ? 3 : entry.tabLabel.toLowerCase().includes(word) ? 2 : 1;
  }
  return total;
}

function highlightAnchor(anchor, attempt = 0) {
  if (!anchor) return;
  const target = anchor.toLowerCase();
  const pane = document.querySelector(".settings .tab-content") || document;
  const candidates = pane.querySelectorAll("h1, h2, h3, h4, h5, label, legend, strong, .form-label");
  const match = Array.from(candidates).find((node) => node.textContent.trim().toLowerCase().startsWith(target));
  if (!match) {
    if (attempt < 15) window.setTimeout(() => highlightAnchor(anchor, attempt + 1), 200);
    return;
  }
  const block = match.closest("section, fieldset, .notification-panel, .kiosk-settings-panel, .settings-form, .card") || match;
  block.scrollIntoView({ behavior: "smooth", block: "start" });
  block.classList.remove("settings-search-flash");
  void block.offsetWidth;
  block.classList.add("settings-search-flash");
  window.setTimeout(() => block.classList.remove("settings-search-flash"), 2400);
}

export default function SettingsSearch({ allowedTabs, tabLabels, onOpen }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef(null);
  const wrapRef = useRef(null);

  const entries = useMemo(
    () =>
      SETTINGS_INDEX.filter((entry) => allowedTabs.includes(entry.tab)).map((entry) => ({ ...entry, tabLabel: tabLabels[entry.tab] || "" })),
    [allowedTabs, tabLabels]
  );

  const results = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    return entries
      .map((entry) => ({ entry, value: score(entry, words) }))
      .filter((row) => row.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 8)
      .map((row) => row.entry);
  }, [entries, query]);

  useEffect(() => {
    function onKey(event) {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || "") || document.activeElement?.isContentEditable;
      if ((event.key === "k" && (event.ctrlKey || event.metaKey)) || (event.key === "/" && !typing)) {
        event.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
    }
    function onClick(event) {
      if (!wrapRef.current?.contains(event.target)) setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, []);

  useEffect(() => setCursor(0), [query]);

  function choose(entry) {
    onOpen(entry.tab, entry.sub);
    setOpen(false);
    setQuery("");
    inputRef.current?.blur();
    window.setTimeout(() => highlightAnchor(entry.anchor), 150);
  }

  function onKeyDown(event) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setCursor((value) => Math.min(value + 1, results.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setCursor((value) => Math.max(value - 1, 0));
    } else if (event.key === "Enter" && results[cursor]) {
      event.preventDefault();
      choose(results[cursor]);
    } else if (event.key === "Escape") {
      setQuery("");
      setOpen(false);
      inputRef.current?.blur();
    }
  }

  return (
    <div className="settings-search" ref={wrapRef}>
      <div className="settings-search-box">
        <SearchLineIcon size={16} />
        <input
          ref={inputRef}
          type="search"
          value={query}
          placeholder="Search settings"
          aria-label="Search settings"
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
        />
        {query ? (
          <button type="button" aria-label="Clear search" onClick={() => setQuery("")}>
            <CloseLineIcon size={14} />
          </button>
        ) : (
          <kbd>/</kbd>
        )}
      </div>
      {open && query.trim() ? (
        <div className="settings-search-results" role="listbox">
          {results.length ? (
            results.map((entry, index) => (
              <button
                key={`${entry.tab}-${entry.title}`}
                type="button"
                role="option"
                aria-selected={index === cursor}
                className={index === cursor ? "is-active" : ""}
                onMouseEnter={() => setCursor(index)}
                onClick={() => choose(entry)}
              >
                <strong>{entry.title}</strong>
                <span>{entry.tabLabel}</span>
              </button>
            ))
          ) : (
            <p>No settings match that.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}

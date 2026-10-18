import { useEffect, useMemo, useRef, useState } from "react";
import Alert from "react-bootstrap/Alert";
import Button from "react-bootstrap/Button";
import { useSearchParams } from "react-router-dom";
import axios from "../../../lib/axios_instance";
import AppsLineIcon from "remixicon-react/AppsLineIcon";
import DeviceLineIcon from "remixicon-react/DeviceLineIcon";
import Plug2LineIcon from "remixicon-react/Plug2LineIcon";
import RefreshLineIcon from "remixicon-react/RefreshLineIcon";
import SearchLineIcon from "remixicon-react/SearchLineIcon";
import { PlatformIcon } from "../../../lib/platform-icons.jsx";
import {
  PLUGIN_FILTERS,
  PLUGIN_SORTS,
  countPluginFilters,
  findPluginFilter,
  findPluginSort,
  groupJellyfinPlugins,
  pluginInitials,
  pluginStatus,
  pluginVersionsLabel,
  searchPluginGroups,
  visiblePluginGroups,
} from "../../../lib/jellyfin-plugins.js";

import "../../css/settings/settings.css";

function errorText(error, fallback) {
  const data = error?.response?.data;
  if (typeof data === "string") return data;
  return data?.error || data?.message || fallback;
}

function formatDate(value) {
  if (!value) return "Never";
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  } catch {
    return "Unknown";
  }
}

function PluginArt({ plugin }) {
  const [failedSrc, setFailedSrc] = useState("");
  const initials = pluginInitials(plugin.name);

  if (plugin.imageUrl && failedSrc !== plugin.imageUrl) {
    return (
      <div className="jellyfin-plugin-art" aria-hidden="true">
        <img src={plugin.imageUrl} alt="" loading="lazy" decoding="async" onError={() => setFailedSrc(plugin.imageUrl)} />
      </div>
    );
  }

  return (
    <div className="jellyfin-plugin-art is-fallback" aria-hidden="true">
      {initials || <Plug2LineIcon size={22} />}
    </div>
  );
}

function pluginCardClass(group) {
  return [
    "jellyfin-plugin-card",
    group.status === "Disabled" ? "is-disabled" : "",
    group.status === "Restart" ? "is-restart" : "",
    group.members.some((member) => member.status === "Malfunctioned" || member.status === "NotSupported") ? "is-issue" : "",
    group.members.length > 1 ? "has-duplicates" : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function PluginCard({ group }) {
  const status = pluginStatus(group.status);
  const versionsLabel = pluginVersionsLabel(group);

  return (
    <article className={pluginCardClass(group)} aria-label={versionsLabel ? `${group.name}, ${versionsLabel}` : undefined}>
      <PluginArt plugin={group} />
      <div className="jellyfin-plugin-head">
        <h3 className="jellyfin-plugin-name" title={group.name}>
          {group.name}
        </h3>
        <div className="jellyfin-plugin-badges">
          <span className={`jellyfin-plugin-status ${status.cls}`} title={status.hint}>
            {status.label}
          </span>
          {versionsLabel ? (
            <span
              className="jellyfin-plugin-status is-duplicate"
              title={`${versionsLabel}. Older copies are not loaded; remove them in the Jellyfin dashboard.`}
            >
              {group.members.length} versions
            </span>
          ) : null}
        </div>
      </div>
      {group.description ? (
        <p
          className="jellyfin-plugin-desc"
          title={group.descriptionSource === "repository" ? "Description from the plugin repository manifest" : undefined}
        >
          {group.description}
        </p>
      ) : (
        <p className="jellyfin-plugin-desc is-placeholder">No description provided.</p>
      )}
      <footer className="jellyfin-plugin-footer">
        <div className="jellyfin-plugin-versions">
          <span className="jellyfin-plugin-version" title="Loaded version">
            v{group.version || "?"}
          </span>
          {group.others.map((other) => {
            const otherStatus = pluginStatus(other.status);
            return (
              <span
                key={other.version}
                className="jellyfin-plugin-version is-older"
                title={`${other.version}: ${otherStatus.label}. ${otherStatus.hint}`}
              >
                + {other.version}
              </span>
            );
          })}
        </div>
        {!group.canUninstall ? (
          <span className="jellyfin-plugin-meta is-bundled" title="Ships with Jellyfin; cannot be uninstalled">
            Bundled
          </span>
        ) : group.owner ? (
          <span className="jellyfin-plugin-meta" title="Repository owner">
            by {group.owner}
          </span>
        ) : null}
      </footer>
    </article>
  );
}

function PluginSkeletons() {
  return Array.from({ length: 6 }, (_, index) => (
    <article key={index} className="jellyfin-plugin-card is-skeleton" aria-hidden="true">
      <div className="jellyfin-plugin-art" />
      <div className="jellyfin-plugin-head">Loading plugin</div>
      <p className="jellyfin-plugin-desc">Loading description</p>
      <div className="jellyfin-plugin-footer">Loading version</div>
    </article>
  ));
}

export default function JellyfinAdminSettings({ view = "devices" }) {
  const isPluginsView = view === "plugins";
  const [devices, setDevices] = useState([]);
  const [plugins, setPlugins] = useState([]);
  const [pluginTotal, setPluginTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState(null);
  const [pluginQuery, setPluginQuery] = useState("");
  const [searchParams, setSearchParams] = useSearchParams();
  const pluginSearchRef = useRef(null);
  const pluginFilter = findPluginFilter(searchParams.get("filter"));
  const pluginSort = findPluginSort(searchParams.get("sort"));

  const pluginGroups = useMemo(() => groupJellyfinPlugins(plugins), [plugins]);
  const searchedPluginGroups = useMemo(() => searchPluginGroups(pluginGroups, pluginQuery), [pluginGroups, pluginQuery]);
  const pluginFilterCounts = useMemo(() => countPluginFilters(searchedPluginGroups), [searchedPluginGroups]);
  const visiblePlugins = useMemo(
    () => visiblePluginGroups(searchedPluginGroups, pluginFilter.id, pluginSort.id),
    [searchedPluginGroups, pluginFilter.id, pluginSort.id]
  );
  const pluginSummary = useMemo(() => {
    const allCounts = countPluginFilters(pluginGroups);
    return { total: pluginGroups.length, enabled: allCounts.enabled, duplicates: allCounts.duplicates };
  }, [pluginGroups]);

  function updatePluginParam(name, value, defaultValue) {
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (value === defaultValue) next.delete(name);
        else next.set(name, value);
        return next;
      },
      { replace: true }
    );
  }

  function clearPluginSearch() {
    setPluginQuery("");
    updatePluginParam("filter", "all", "all");
    pluginSearchRef.current?.focus();
  }

  async function loadJellyfinAdmin() {
    setLoading(true);
    setMessage(null);

    try {
      if (isPluginsView) {
        const response = await axios.get("/api/jellyfin/plugins");
        const nextPlugins = response.data?.plugins || [];
        setPlugins(nextPlugins);
        setPluginTotal(response.data?.total ?? nextPlugins.length);
      } else {
        const response = await axios.get("/api/jellyfin/devices");
        setDevices(response.data?.devices || []);
      }
    } catch (error) {
      setMessage({ type: "danger", text: errorText(error, "Unable to load Jellyfin admin data") });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadJellyfinAdmin();
  }, [view]);

  return (
    <div className="jellyfin-admin-settings">
      <div className="jellyfin-admin-header">
        <div>
          <p>{isPluginsView ? "Jellyfin plugins" : "Jellyfin devices"}</p>
          <h1>{isPluginsView ? "Plugins" : "Authorised Devices"}</h1>
          <span>
            {isPluginsView
              ? "Review installed and enabled plugin packages reported by Jellyfin."
              : "Review client devices returned by your Jellyfin server."}
          </span>
        </div>
        <Button type="button" variant="outline-light" onClick={loadJellyfinAdmin} disabled={loading}>
          <RefreshLineIcon size={17} />
          Refresh
        </Button>
      </div>

      {message ? (
        <Alert variant={message.type} onClose={() => setMessage(null)} dismissible>
          {message.text}
        </Alert>
      ) : null}

      {!isPluginsView ? (
        <section className="jellyfin-admin-section">
          <div className="jellyfin-admin-section-heading">
            <div>
              <DeviceLineIcon size={20} />
              <div>
                <h2>Authorised Devices</h2>
                <p>{devices.length} devices returned by Jellyfin.</p>
              </div>
            </div>
          </div>
          <div className="jellyfin-device-list">
            {loading ? <div className="jellyfin-admin-empty">Loading devices...</div> : null}
            {!loading && !devices.length ? <div className="jellyfin-admin-empty">No authorised devices were returned by Jellyfin.</div> : null}
            {devices.map((device) => (
              <article key={device.id || `${device.name}-${device.appName}`} className="jellyfin-device-row">
                <div className="jellyfin-device-icon">
                  <PlatformIcon client={device.appName} deviceName={device.name} />
                </div>
                <div>
                  <span>{device.appName}</span>
                  <strong>{device.name}</strong>
                  <p>{device.appVersion ? `Version ${device.appVersion}` : "No app version reported"}</p>
                </div>
                <div className="jellyfin-device-meta">
                  <span>{device.lastUserName || "No user"}</span>
                  <strong>{formatDate(device.dateLastActivity)}</strong>
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {isPluginsView ? (
        <section className="jellyfin-admin-section jellyfin-plugin-section" aria-labelledby="jf-plugins-heading">
          <div className="jellyfin-admin-section-heading">
            <div>
              <AppsLineIcon size={20} />
              <div>
                <h2 id="jf-plugins-heading">Installed Plugins</h2>
                {!loading && pluginSummary.total ? (
                  <div className="jellyfin-plugin-summary">
                    <span>
                      <b>{pluginSummary.total}</b> plugins
                    </span>
                    <span>
                      <b>{pluginSummary.enabled}</b>
                      <span className="is-long"> of {pluginSummary.total} enabled</span>
                      <span className="is-short"> enabled</span>
                    </span>
                    {pluginSummary.duplicates ? (
                      <span className="is-warn">
                        <b>{pluginSummary.duplicates}</b>
                        <span className="is-long"> with duplicate versions</span>
                        <span className="is-short">{pluginSummary.duplicates === 1 ? " duplicate" : " duplicates"}</span>
                      </span>
                    ) : null}
                    {pluginTotal !== pluginSummary.total ? (
                      <span title="Every copy Jellyfin reports, including older versions">{pluginTotal} installed copies</span>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          {loading || pluginGroups.length ? (
            <>
              <div className="jellyfin-plugin-toolbar">
                <label className="jellyfin-plugin-search">
                  Search plugins
                  <div>
                    <SearchLineIcon />
                    <input
                      ref={pluginSearchRef}
                      type="search"
                      value={pluginQuery}
                      onChange={(event) => setPluginQuery(event.target.value)}
                      placeholder="Name, description or version..."
                      aria-describedby="jf-plugin-results"
                    />
                  </div>
                </label>
                <label className="jellyfin-plugin-sort">
                  Sort
                  <select value={pluginSort.id} onChange={(event) => updatePluginParam("sort", event.target.value, "name")}>
                    {PLUGIN_SORTS.map((sort) => (
                      <option key={sort.id} value={sort.id}>
                        {sort.label}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="jellyfin-plugin-filters" role="group" aria-label="Filter plugins by status">
                  {PLUGIN_FILTERS.map((filter) => (
                    <button
                      key={filter.id}
                      type="button"
                      aria-pressed={pluginFilter.id === filter.id}
                      className={pluginFilterCounts[filter.id] ? "" : "is-zero"}
                      onClick={() => updatePluginParam("filter", filter.id, "all")}
                    >
                      {filter.label}
                      <span className="count">{pluginFilterCounts[filter.id]}</span>
                    </button>
                  ))}
                </div>
              </div>
              <p className="jellyfin-plugin-results" id="jf-plugin-results" aria-live="polite">
                {loading
                  ? "Loading plugins..."
                  : visiblePlugins.length === pluginGroups.length
                    ? `Showing all ${pluginGroups.length} plugins`
                    : `Showing ${visiblePlugins.length} of ${pluginGroups.length} plugins`}
              </p>
            </>
          ) : null}

          <div className="jellyfin-plugin-grid">
            {loading ? <PluginSkeletons /> : null}
            {!loading && !pluginGroups.length ? (
              <div className="jellyfin-plugin-empty" role="status">
                <Plug2LineIcon />
                <strong>No plugins were returned by Jellyfin.</strong>
              </div>
            ) : null}
            {!loading && pluginGroups.length && !visiblePlugins.length ? (
              <div className="jellyfin-plugin-empty" role="status">
                <SearchLineIcon />
                <strong>
                  No plugins match
                  {pluginQuery.trim() ? ` “${pluginQuery.trim()}”` : ""}
                  {pluginFilter.id !== "all" ? ` in ${pluginFilter.label}` : ""}
                </strong>
                <p>Try a different name, or clear the search and filters to see all {pluginGroups.length} installed plugins.</p>
                <Button type="button" variant="outline-light" onClick={clearPluginSearch}>
                  Clear search &amp; filters
                </Button>
              </div>
            ) : null}
            {!loading ? visiblePlugins.map((group) => <PluginCard key={group.key} group={group} />) : null}
          </div>
        </section>
      ) : null}
    </div>
  );
}

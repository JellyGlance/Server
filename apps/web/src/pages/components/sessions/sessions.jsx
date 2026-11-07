import { useState, useEffect } from "react";
import Config from "../../../lib/config";
// import API from "../../../classes/jellyfin-api";

import "../../css/sessions.css";
import ErrorBoundary from "../general/ErrorBoundary";
import SessionCard from "./session-card";
import SessionWall from "./session-wall";

const SESSION_VIEW_KEY = "jellyglance_sessions_view";

function getStoredSessionView() {
  try {
    return localStorage.getItem(SESSION_VIEW_KEY) === "wall" ? "wall" : "cards";
  } catch {
    return "cards";
  }
}

import socket from "../../../socket";
import {
  cacheActiveSessions,
  fetchActiveSessions,
  getCachedActiveSessions,
  subscribeActiveSessions,
} from "../../../lib/session-cache";
import { useSessionGlanceStitch } from "../../../lib/session-glance-cache";
import {
  ACTIVE_SESSION_IP_PRIVACY_EVENT,
  ACTIVE_SESSION_IP_PRIVACY_KEY,
  getActiveSessionIpPrivacy,
  shouldHideActiveSessionIp,
} from "../../../lib/privacy-settings";

function canManageSessions(config) {
  const role = String(config?.settings?.auth?.role || "").toLowerCase();
  if (role.includes("owner") || role.includes("admin")) return true;
  try {
    const token = localStorage.getItem("token");
    if (!token) return false;
    const payload = JSON.parse(window.atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    const tokenRole = String(payload?.role || payload?.Role || "").toLowerCase();
    return tokenRole.includes("owner") || tokenRole.includes("admin");
  } catch {
    return false;
  }
}

function Sessions({ surface = "home" }) {
  const [data, setData] = useState(() => getCachedActiveSessions());
  const [view, setView] = useState(() => getStoredSessionView());
  const [ipPrivacy, setIpPrivacy] = useState(() => getActiveSessionIpPrivacy());
  const [config, setConfig] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("config") || "null");
    } catch {
      return null;
    }
  });
  const canManage = canManageSessions(config);
  const stitchByItemId = useSessionGlanceStitch(data || []);

  useEffect(() => {
    const handleIpPrivacyUpdate = () => setIpPrivacy(getActiveSessionIpPrivacy());
    const handleStorage = (event) => {
      if (event.key === ACTIVE_SESSION_IP_PRIVACY_KEY) {
        handleIpPrivacyUpdate();
      }
    };

    window.addEventListener(ACTIVE_SESSION_IP_PRIVACY_EVENT, handleIpPrivacyUpdate);
    window.addEventListener("storage", handleStorage);

    return () => {
      window.removeEventListener(ACTIVE_SESSION_IP_PRIVACY_EVENT, handleIpPrivacyUpdate);
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeActiveSessions(setData);
    const handleSessions = (sessionData) => {
      if (typeof sessionData === "object" && Array.isArray(sessionData)) {
        cacheActiveSessions(sessionData);
      }
    };

    socket.on("sessions", handleSessions);

    fetchActiveSessions().catch((error) => console.log(error));

    return () => {
      unsubscribe();
      socket.off("sessions", handleSessions);
    };
  }, []);

  const hideIpAddress = shouldHideActiveSessionIp(surface, ipPrivacy);

  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const newConfig = await Config.getConfig();
        setConfig(newConfig);
      } catch (error) {
        console.log(error);
      }
    };

    if (!config) {
      fetchConfig();
    }
  }, [config]);

  const changeView = (nextView) => {
    setView(nextView);
    try {
      localStorage.setItem(SESSION_VIEW_KEY, nextView);
    } catch {
      // ignore storage errors
    }
  };

  // Nobody playing (or nothing loaded yet): render nothing so the section disappears.
  if (!Array.isArray(data) || data.length === 0) {
    return null;
  }

  return (
    <div className="sessions-widget">
      <div className="sessions-widget-header">
        <h1 className="my-3">
          Active Sessions
        </h1>
        <div className="sessions-view-toggle" role="group" aria-label="Session layout">
          <button type="button" className={view === "cards" ? "is-active" : ""} aria-pressed={view === "cards"} onClick={() => changeView("cards")}>
            Cards
          </button>
          <button type="button" className={view === "wall" ? "is-active" : ""} aria-pressed={view === "wall"} onClick={() => changeView("wall")}>
            Wall
          </button>
        </div>
      </div>
      {view === "wall" ? <SessionWall sessions={data} /> : <div className="sessions-container">
        {data &&
          data.length > 0 &&
          data
            .sort((a, b) => a.Id.padStart(12, "0").localeCompare(b.Id.padStart(12, "0")))
            .map((session) => (
              <ErrorBoundary key={session.Id}>
                <SessionCard
                  data={{ session: session, base_url: config?.base_url }}
                  hideIpAddress={hideIpAddress}
                  kiosk={surface === "kiosk"}
                  canManage={canManage}
                  stitch={stitchByItemId.get(session.NowPlayingItem?.Id) || null}
                />
              </ErrorBoundary>
            ))}
      </div>}
    </div>
  );
}

export default Sessions;

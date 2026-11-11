import { useState, useEffect } from "react";
import Config from "../../../lib/config";
// import API from "../../../classes/jellyfin-api";

import "../../css/sessions.css";
import ErrorBoundary from "../general/ErrorBoundary";
import SessionCard from "./session-card";
import SessionWall from "./session-wall";
import { SessionBandwidth, SessionList } from "./session-views";
import { resolveSessionsView } from "../../../lib/home-settings";
import { orderSessions } from "../../../lib/session-order";

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

const VIEW_LABELS = { auto: "Auto", cards: "Cards", wall: "Wall", list: "List", bandwidth: "Bandwidth" };

// Home passes view/onViewChange so the choice lives in the Home layout; other
// pages keep the old Cards/Wall toggle stored on its own.
function Sessions({ surface = "home", view: controlledView, onViewChange }) {
  const [data, setData] = useState(() => getCachedActiveSessions());
  const [storedView, setView] = useState(() => getStoredSessionView());
  const isControlled = Boolean(controlledView);
  const chosenView = isControlled ? controlledView : storedView;
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
    if (isControlled) {
      onViewChange?.(nextView);
      return;
    }
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

  const view = resolveSessionsView(chosenView, data.length);
  const viewOptions = isControlled ? ["auto", "cards", "wall", "list", "bandwidth"] : ["cards", "wall"];
  const isDemo = data.some((session) => session?.IsDemo);

  return (
    <div className="sessions-widget">
      <div className="sessions-widget-header">
        <h1 className="my-3">
          Active Sessions
          {isDemo ? <span className="home-demo-badge">Demo sessions</span> : null}
        </h1>
        <div className="sessions-view-toggle" role="group" aria-label="Session layout">
          {viewOptions.map((option) => (
            <button
              key={option}
              type="button"
              className={chosenView === option ? "is-active" : ""}
              aria-pressed={chosenView === option}
              title={option === "auto" ? `Auto: showing ${VIEW_LABELS[view]}` : undefined}
              onClick={() => changeView(option)}
            >
              {VIEW_LABELS[option]}
              {option === "auto" && chosenView === "auto" ? <small> · {VIEW_LABELS[view]}</small> : null}
            </button>
          ))}
        </div>
      </div>
      {view === "list" ? <SessionList sessions={data} /> : null}
      {view === "bandwidth" ? <SessionBandwidth sessions={data} /> : null}
      {view === "wall" ? <SessionWall sessions={data} /> : null}
      {view === "cards" ? <div className="sessions-container">
        {orderSessions(data).map((session) => (
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
      </div> : null}
    </div>
  );
}

export default Sessions;

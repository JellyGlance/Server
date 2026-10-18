// import logo from './logo.svg';
import "./App.css";
import React, { lazy, useState, useEffect } from "react";
import { Routes, Route } from "react-router-dom";
import axios from "./lib/axios_instance";

import socket from "./socket";
import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";

import Config from "./lib/config";
import { applyFontWeightPreference } from "./lib/appearance";
import { clearSessionStorage } from "./lib/auth-storage";
import { prewarmActiveSessions } from "./lib/session-cache";
import { applyPwaStartUrl, isOpsRole, pwaStartPath } from "./lib/pwa-manifest";
import { getStoredWorkspaceMode, WORKSPACE_MODE_UPDATED_EVENT } from "./lib/workspace-mode";
import { DEFAULT_THEME, applyTheme, hydrateThemeFromPreferences } from "./lib/theme";
import { getStoredNotificationSettings, normalizeNotificationSettings, notificationCategory, storeNotificationSettings } from "./lib/notification-settings";
import { shouldSendSystemNotification, showSystemNotification } from "./lib/system-notifications";

import Loading from "./pages/components/general/loading";
import ErrorPage from "./pages/components/general/error";
import routes from "./routes";
import { FIRST_RUN_EXTRAS_KEY } from "./lib/first-run";
import { APP_VERSION_STORAGE_KEY } from "./lib/events";

const Signup = lazy(() => import("./pages/signup"));
const Setup = lazy(() => import("./pages/setup"));
const FirstRunExtras = lazy(() => import("./pages/first-run-extras"));
const Login = lazy(() => import("./pages/login"));
const Navbar = lazy(() => import("./pages/components/general/navbar"));
const WhatsNewModal = lazy(() => import("./pages/components/general/WhatsNewModal"));
const PwaInstallBanner = lazy(() => import("./pages/components/general/PwaInstallBanner"));

// Warm common authenticated routes after login so navigation feels instant.
function preloadCriticalRoutes() {
  const warm = () => {
    import("./pages/home");
    import("./pages/my-glance");
    import("./pages/requests");
    import("./pages/activity");
    import("./pages/settings");
  };
  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(warm, { timeout: 4000 });
    return;
  }
  window.setTimeout(warm, 2500);
}

function notificationKind(message) {
  const type = String(message?.type || "").toLowerCase();
  if (type === "error") return "error";
  if (type === "warning" || type === "warn") return "warning";
  if (type === "success") return "success";
  return "info";
}

function isManualTaskNotification(message) {
  const triggerType = String(message?.triggerType || message?.triggertype || "").toLowerCase();
  const text = String(message?.message || message || "");
  return message?.manual === true || triggerType === "manual" || /^manual\b/i.test(text);
}

function shouldShowNotification(message, settings) {
  if (settings.manualTaskToasts && isManualTaskNotification(message)) return true;
  const kind = notificationKind(message);
  if (settings.mode === "all") return true;
  if (settings.mode === "important") return kind === "warning" || kind === "error";
  if (settings.mode === "errors") return kind === "error";
  return false;
}

const SYSTEM_NOTIFICATION_TITLES = {
  librarySync: "Library sync",
  playbackSync: "Playback sync",
  backups: "Backup",
  tasks: "JellyGlance task",
  downloads: "Download queued",
  errors: "Task error",
  playback: "Now playing",
};

function sendSystemNotification(settings, category, message) {
  const type = String(message?.type || "").toLowerCase();
  if (type === "update") return;
  if (!shouldSendSystemNotification(settings)) return;
  const text = message?.message || message;
  if (!text || typeof text !== "string") return;
  const prefix = type === "error" ? "Failed: " : type === "warning" || type === "warn" ? "Warning: " : "";
  showSystemNotification(`${prefix}${SYSTEM_NOTIFICATION_TITLES[category] || "JellyGlance"}`, text, { tag: `jellyglance-${category}` });
}

function sessionPlaybackKey(session) {
  return session?.Id && session?.NowPlayingItem?.Id ? `${session.Id}:${session.NowPlayingItem.Id}` : null;
}

function sessionPlaybackText(session) {
  const item = session.NowPlayingItem || {};
  const title = item.SeriesName ? `${item.SeriesName} · ${item.Name}` : item.Name || "something";
  const where = [session.Client, session.DeviceName].filter(Boolean).join(" on ");
  return `${session.UserName || "Someone"} started ${title}${where ? ` (${where})` : ""}`;
}

function toastOptions(settings, autoCloseOverride) {
  return {
    autoClose: autoCloseOverride || settings.durationSeconds * 1000,
  };
}

function isLibrarySyncProgress(message) {
  const type = String(message?.type || "").toLowerCase();
  const text = String(message?.message || message || "");
  return (type === "start" || type === "update") && /\b(?:syncing|fetching) (?:data for )?library\b/i.test(text);
}

function taskToastId(task) {
  return `jellyglance-task-toast:${task}`;
}

const recentTaskNotifications = new Map();
const TASK_NOTIFICATION_DEDUPE_MS = 30000;

function isDuplicateTaskNotification(task, message) {
  const key = [
    task,
    message?.type || "Info",
    message?.triggerType || message?.triggertype || "",
    message?.message || message || "",
  ].join(":");
  const now = Date.now();
  const lastSeen = recentTaskNotifications.get(key) || 0;

  recentTaskNotifications.set(key, now);
  recentTaskNotifications.forEach((timestamp, notificationKey) => {
    if (now - timestamp > TASK_NOTIFICATION_DEDUPE_MS) {
      recentTaskNotifications.delete(notificationKey);
    }
  });

  return now - lastSeen < TASK_NOTIFICATION_DEDUPE_MS;
}

function App() {
  const [setupState, setSetupState] = useState(0);
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [errorFlag, seterrorFlag] = useState(false);
  const [startupErrorMessage, setStartupErrorMessage] = useState("Error: Unable to connect to JellyGlance Backend");
  const [notificationSettings, setNotificationSettings] = useState(getStoredNotificationSettings);
  const token = localStorage.getItem("token");
  const shouldShowFirstRunExtras =
    setupState === 2 &&
    token !== undefined &&
    token !== null &&
    config?.settings?.firstRunExtrasCompleted !== true &&
    (localStorage.getItem(FIRST_RUN_EXTRAS_KEY) === "true" || config?.settings?.firstRunExtrasPending === true);
  const kioskMode = window.location.pathname === "/home/kiosk" || window.location.pathname === "/kiosk";

  const wsListeners = [
    { task: "PlaybackSyncTask", ref: React.useRef(null) },
    { task: "PartialSyncTask", ref: React.useRef(null) },
    { task: "FullSyncTask", ref: React.useRef(null) },
    { task: "BackupTask", ref: React.useRef(null) },
    { task: "TaskError", ref: React.useRef(null) },
    { task: "GeneralAlert", ref: React.useRef(null) },
  ];

  useEffect(() => {
    wsListeners.forEach((listener) => {
      socket.on(listener.task, (message) => {
        const category = notificationCategory(listener.task, message);
        if (notificationSettings.categories?.[category] === false) {
          return;
        }
        if (!shouldShowNotification(message, notificationSettings)) {
          return;
        }
        if (isDuplicateTaskNotification(listener.task, message)) {
          return;
        }
        sendSystemNotification(notificationSettings, category, message);
        if (!notificationSettings.inApp) {
          return;
        }
        const toastId = taskToastId(listener.task);
        const options = {
          ...toastOptions(notificationSettings, message?.type === "Start" || message?.type === "Update" ? 15000 : undefined),
          hideProgressBar: isLibrarySyncProgress(message),
        };
        const onCloseOptions = {
          ...options,
          toastId,
          onClose: () => {
            if (listener.ref.current === toastId) {
              listener.ref.current = null;
            }
          },
        };
        if (!listener.ref.current && toast.isActive(toastId)) {
          listener.ref.current = toastId;
        }
        if (message && message.type === "Start") {
          listener.ref.current = toast.info(message?.message || message, {
            ...onCloseOptions,
          });
        } else if (message && message.type === "Success" && !listener.ref.current) {
          listener.ref.current = toast.success(message?.message || message, {
            ...onCloseOptions,
          });
        } else if (message && message.type === "Error" && !listener.ref.current) {
          listener.ref.current = toast.error(message?.message || message, {
            ...onCloseOptions,
          });
        } else if (message && message.type === "Update" && !listener.ref.current) {
          listener.ref.current = toast.info(message?.message || message, {
            ...onCloseOptions,
          });
        } else if (message && message.type === "Update") {
          toast.update(toastId, {
            render: message?.message || message,
            type: toast.TYPE.INFO,
            ...options,
          });
        } else if (message && message.type === "Error") {
          toast.update(toastId, {
            render: message?.message || message,
            type: toast.TYPE.ERROR,
            ...toastOptions(notificationSettings),
          });
        } else if (message && message.type === "Success") {
          toast.update(toastId, {
            render: message?.message || message,
            type: toast.TYPE.SUCCESS,
            ...toastOptions(notificationSettings),
          });
        }
      });
    });

    let knownPlayback = null;
    function handlePlaybackSessions(sessions) {
      if (!Array.isArray(sessions)) return;
      const active = sessions.filter((session) => sessionPlaybackKey(session));
      const nextKeys = new Set(active.map(sessionPlaybackKey));
      if (knownPlayback && notificationSettings.categories?.playback && notificationSettings.mode === "all") {
        active
          .filter((session) => !knownPlayback.has(sessionPlaybackKey(session)))
          .forEach((session) => {
            const text = sessionPlaybackText(session);
            sendSystemNotification(notificationSettings, "playback", { type: "Info", message: text });
            if (notificationSettings.inApp) toast.info(text, toastOptions(notificationSettings));
          });
      }
      knownPlayback = nextKeys;
    }
    socket.on("sessions", handlePlaybackSessions);

    function handleThresholdAlert(alert) {
      let role = "Viewer";
      try {
        role = JSON.parse(localStorage.getItem("config") || "{}")?.settings?.auth?.role || "Viewer";
      } catch {
        /* ignore */
      }
      if (!isOpsRole(role) || !alert?.message) return;
      if (shouldSendSystemNotification(notificationSettings)) {
        showSystemNotification(alert.title || "JellyGlance alert", alert.message, { tag: `jellyglance-alert-${alert.alertType || "general"}` });
      }
      if (notificationSettings.inApp) {
        const show = alert.type === "Error" ? toast.error : toast.warn;
        show(`${alert.title}: ${alert.message}`, { autoClose: 12000 });
      }
    }
    socket.on("ThresholdAlert", handleThresholdAlert);

    return () => {
      socket.off("ThresholdAlert", handleThresholdAlert);
      wsListeners.forEach((listener) => {
        socket.off(listener.task);
      });
      socket.off("sessions", handlePlaybackSessions);
    };
  }, [notificationSettings]);

  useEffect(() => {
    function handleNotificationSettings(event) {
      setNotificationSettings(normalizeNotificationSettings(event.detail));
    }

    window.addEventListener("jellyglance-notification-settings-updated", handleNotificationSettings);
    return () => {
      window.removeEventListener("jellyglance-notification-settings-updated", handleNotificationSettings);
    };
  }, []);

  useEffect(() => {
    function handleWorkspaceMode(event) {
      const role = config?.settings?.auth?.role;
      applyPwaStartUrl(pwaStartPath(role, event.detail || getStoredWorkspaceMode(isOpsRole(role)), config?.settings?.auth?.permissions));
    }
    window.addEventListener(WORKSPACE_MODE_UPDATED_EVENT, handleWorkspaceMode);
    return () => window.removeEventListener(WORKSPACE_MODE_UPDATED_EVENT, handleWorkspaceMode);
  }, [config]);

  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const newConfig = await Config.getConfig(true);
        if (!newConfig.response) {
          setConfig(newConfig);
        } else {
          if (newConfig.response.status === 403 || newConfig.response.status === 401) {
            clearSessionStorage(localStorage);
            window.location.reload();
          } else if (newConfig.response.status !== 403) {
            seterrorFlag(true);
          }
        }
        setLoading(false);
        if (!newConfig.response) {
          setNotificationSettings(storeNotificationSettings(newConfig.settings?.notifications));
          applyPwaStartUrl(pwaStartPath(newConfig.settings?.auth?.role, getStoredWorkspaceMode(isOpsRole(newConfig.settings?.auth?.role)), newConfig.settings?.auth?.permissions));
          hydrateThemeFromPreferences(newConfig.settings?.preferences);
        }
      } catch (error) {
        console.log(error);
      }
    };

    if (setupState === 0) {
      setLoading(false);
      axios
        .get("/auth/isConfigured")
        .then(async (response) => {
          if (response.status === 200) {
            setSetupState(response.data.state);
            if (response.data.version) {
              localStorage.setItem(APP_VERSION_STORAGE_KEY, response.data.version);
            }
          }
        })
        .catch((error) => {
          console.log(error);
          const message = error.response?.data?.message || error.response?.data?.error || error.message;
          setStartupErrorMessage(error.response?.status ? `Error ${error.response.status}: ${message}` : "Error: Unable to connect to JellyGlance Backend");
          seterrorFlag(true);
        });
    }

    if (!config && setupState === 2 && token !== undefined && token !== null) {
      fetchConfig();
    }
  }, [config, setupState, token]);

  useEffect(() => {
    if (setupState === 2 && token !== undefined && token !== null) {
      prewarmActiveSessions(token);
      preloadCriticalRoutes();
    }
  }, [setupState, token]);

  useEffect(() => {
    if (setupState < 2 || shouldShowFirstRunExtras) {
      applyTheme(DEFAULT_THEME);
    }
  }, [setupState, shouldShowFirstRunExtras]);

  useEffect(() => {
    applyFontWeightPreference();
  }, []);

  useEffect(() => {
    const handleAuthExpired = () => {
      setConfig(null);
    };

    window.addEventListener("jellyglance-auth-expired", handleAuthExpired);
    return () => window.removeEventListener("jellyglance-auth-expired", handleAuthExpired);
  }, []);

  if (loading) {
    return <Loading />;
  }

  if (errorFlag) {
    return <ErrorPage message={startupErrorMessage} />;
  }

  if (!config && setupState === 2 && (token === undefined || token === null)) {
    return <Login />;
  }

  if (setupState === 0) {
    return <Setup />;
  }
  if (setupState === 1) {
    return <Signup />;
  }

  // Keep the app visible while the authenticated configuration request is pending.
  if (setupState === 2 && !config) {
    return token ? <Loading /> : <Login />;
  }

  if (config && shouldShowFirstRunExtras) {
    return <FirstRunExtras />;
  }

  if (config && setupState === 2 && token !== null) {
    return (
      <div className="App">
        <div className="d-flex flex-column flex-md-row">
          {kioskMode ? null : <Navbar />}
          <main className="app-shell-main w-md-100">
            <Routes>
              {routes.map((route, index) => (
                <Route key={index} path={route.path} element={route.element} />
              ))}
            </Routes>
          </main>
        </div>
        <ToastContainer
          theme="dark"
          position={notificationSettings.position}
          limit={5}
          pauseOnFocusLoss={false}
          hideProgressBar={false}
          className="jellyglance-toast-container"
          toastClassName="jellyglance-toast"
          bodyClassName="jellyglance-toast-body"
          progressClassName="jellyglance-toast-progress"
        />
        <WhatsNewModal enabled={!kioskMode} />
        {kioskMode ? null : (
          <PwaInstallBanner
            enabled
            viewerStart={pwaStartPath(config?.settings?.auth?.role, getStoredWorkspaceMode(isOpsRole(config?.settings?.auth?.role)), config?.settings?.auth?.permissions) === "/me"}
          />
        )}
      </div>
    );
  }
}

export default App;

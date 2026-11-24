import { useEffect, useRef, useState } from "react";
import axios from "../lib/axios_instance";
import baseUrl from "../lib/baseurl";
import { clearApiCache } from "../lib/api-cache";
import Form from "react-bootstrap/Form";
import Button from "react-bootstrap/Button";
import { InputGroup } from "react-bootstrap";

import EyeFillIcon from "remixicon-react/EyeFillIcon";
import EyeOffFillIcon from "remixicon-react/EyeOffFillIcon";
import UploadCloud2LineIcon from "remixicon-react/UploadCloud2LineIcon";
import Database2LineIcon from "remixicon-react/Database2LineIcon";
import ArrowDownSLineIcon from "remixicon-react/ArrowDownSLineIcon";
import CheckboxCircleFillIcon from "remixicon-react/CheckboxCircleFillIcon";
import CloseCircleFillIcon from "remixicon-react/CloseCircleFillIcon";
import CheckboxBlankCircleLineIcon from "remixicon-react/CheckboxBlankCircleLineIcon";
import jellyfinLogo from "./images/jellyfin.svg";
import embyLogo from "./images/emby.svg";

import "./css/setup.css";
import i18next from "i18next";
import { Trans } from "react-i18next";
import SetupShell from "./components/setup/SetupShell";

const RESTORE_WAIT_TIMEOUT_MS = 60 * 60 * 1000;

const SERVER_TYPES = [
  { id: "auto", label: "Auto-detect" },
  { id: "jellyfin", label: "Jellyfin" },
  { id: "emby", label: "Emby" },
];

function serverName(type) {
  return type === "emby" ? "Emby" : type === "jellyfin" ? "Jellyfin" : "media server";
}

// Where to find an API key on each server, shown under the API key field.
const API_KEY_HELP = {
  jellyfin: "In Jellyfin: Dashboard → API Keys → + (name it JellyGlance).",
  emby: "In Emby: Settings → Advanced → API Keys → New API Key.",
  auto: "Jellyfin: Dashboard → API Keys. Emby: Settings → Advanced → API Keys.",
};

// Error bodies can be a string, { errorMessage }, { error } or an HTML page.
function readableError(error, fallback) {
  if (error?.code === "ERR_NETWORK") return i18next.t("ERROR_MESSAGES.NETWORK_ERROR");
  const data = error?.response?.data;
  if (typeof data === "string" && data.trim() && !data.trim().startsWith("<")) return data.trim();
  if (data && typeof data === "object") return data.errorMessage || data.error || data.message || fallback;
  return error?.response?.status ? `${fallback} (HTTP ${error.response.status})` : fallback;
}

// Only probe things that look like an address, so typing "h", "ht", "htt" does not
// fire a request for each letter.
function looksLikeHost(value) {
  const text = String(value || "").trim();
  if (text.length < 4) return false;
  return /[.:]/.test(text) || /localhost/i.test(text);
}

function CheckSpinner(props) {
  return <span className={`setup-spinner ${props.className || ""}`} />;
}

const CHECK_ICONS = {
  pending: CheckboxBlankCircleLineIcon,
  running: CheckSpinner,
  success: CheckboxCircleFillIcon,
  error: CloseCircleFillIcon,
};

// The two things a connection needs: the address answers, and the key is accepted.
function ConnectionChecks({ checks }) {
  return (
    <ul className="setup-checks" aria-live="polite">
      {checks.map((check) => {
        const Icon = CHECK_ICONS[check.state];
        return (
          <li className={`setup-check is-${check.state}`} key={check.id}>
            <Icon className="setup-check-icon" size={18} aria-hidden="true" />
            <div>
              <strong>{check.label}</strong>
              {check.detail ? <small>{check.detail}</small> : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function waitForFirstRunRestoreComplete() {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Restore is taking longer than expected. Refresh the page to check whether setup finished."));
    }, RESTORE_WAIT_TIMEOUT_MS);

    const poll = setInterval(async () => {
      try {
        const [statusResponse, configResponse] = await Promise.all([
          axios.get("/backup/first-run/restore/status"),
          axios.get("/auth/isConfigured"),
        ]);

        const restoreStatus = statusResponse.data || {};
        const configuredState = Number(configResponse.data?.state ?? 0);

        if (restoreStatus.status === "complete") {
          cleanup();
          resolve({
            setupState: Number(restoreStatus.setupState ?? configuredState ?? 0),
            restoredRows: Number(restoreStatus.restoredRows || 0),
          });
          return;
        }

        if (restoreStatus.status === "failed") {
          cleanup();
          reject(new Error(restoreStatus.error || "Restore failed"));
          return;
        }

        if (configuredState >= 2) {
          cleanup();
          resolve({ setupState: configuredState, restoredRows: Number(restoreStatus.restoredRows || 0) });
        }
      } catch {
        // Ignore transient polling errors while restore runs.
      }
    }, 2000);

    function cleanup() {
      clearTimeout(timeout);
      clearInterval(poll);
    }
  });
}

function Setup() {
  const [formValues, setFormValues] = useState({ SERVER_TYPE: "auto" });
  const [processing, setProcessing] = useState(false);
  const [saveState, setSaveState] = useState("idle");
  const [showPassword, setShowPassword] = useState(false);
  const [connectionTest, setConnectionTest] = useState({ status: "idle", message: "" });
  const [restoreStatus, setRestoreStatus] = useState({ status: "idle", message: "" });
  const [restoreProgress, setRestoreProgress] = useState(0);
  const [restorePhase, setRestorePhase] = useState("idle");
  const [probe, setProbe] = useState({ status: "idle" });
  const fileInputRef = useRef(null);
  const probeRequest = useRef(0);

  // Check the URL a moment after typing stops. Older answers are ignored if the
  // URL changed again while they were in flight.
  useEffect(() => {
    const host = formValues.JF_HOST?.trim();
    if (!looksLikeHost(host)) {
      setProbe({ status: "idle" });
      return undefined;
    }

    const requestId = ++probeRequest.current;
    setProbe({ status: "checking" });
    const timer = setTimeout(async () => {
      try {
        const { data } = await axios.post("/auth/probe-server", { JF_HOST: host });
        if (requestId !== probeRequest.current) return;
        setProbe(data?.reachable ? { status: "ok", info: data } : { status: "fail" });
      } catch {
        if (requestId !== probeRequest.current) return;
        setProbe({ status: "fail" });
      }
    }, 650);

    return () => clearTimeout(timer);
  }, [formValues.JF_HOST]);

  function redirectToAppRoot() {
    const rootPath = baseUrl ? `${baseUrl}/` : "/";
    window.location.replace(rootPath);
  }

  function clearStoredAuth() {
    localStorage.removeItem("token");
    localStorage.removeItem("config");
    clearApiCache();
  }

  function finishRestoreFlow({ setupState, restoredRows }) {
    setRestorePhase("complete");

    if (setupState >= 2) {
      setRestoreStatus({
        status: "success",
        message: `Restored ${restoredRows.toLocaleString()} rows. Opening login...`,
      });
      clearStoredAuth();
      setTimeout(redirectToAppRoot, 700);
      return;
    }

    if (setupState === 1) {
      setRestoreStatus({
        status: "success",
        message: `Restored ${restoredRows.toLocaleString()} rows. Continue with admin access setup...`,
      });
      clearStoredAuth();
      setTimeout(redirectToAppRoot, 700);
      return;
    }

    setRestoreStatus({
      status: "success",
      message: `Restored ${restoredRows.toLocaleString()} rows. Connect Jellyfin to finish setup.`,
    });
    setProcessing(false);
    setRestorePhase("idle");
    setRestoreProgress(0);
  }

  function handleFormChange(event) {
    setFormValues({ ...formValues, [event.target.name]: event.target.value });
    setConnectionTest({ status: "idle", message: "" });
    setSaveState("idle");
  }

  function chooseServerType(type) {
    setFormValues((current) => ({ ...current, SERVER_TYPE: type }));
    setConnectionTest({ status: "idle", message: "" });
  }

  function serverPayload(values) {
    const { SERVER_TYPE, ...rest } = values;
    return SERVER_TYPE && SERVER_TYPE !== "auto" ? { ...rest, SERVER_TYPE } : rest;
  }

  async function testConnection() {
    setProcessing(true);
    setConnectionTest({ status: "testing", message: `Testing ${serverName(formValues.SERVER_TYPE)} connection...` });

    try {
      const response = await axios.post("/auth/test-jellyfin", serverPayload(formValues), {
        headers: {
          "Content-Type": "application/json",
        },
      });

      const detected = response.data.serverType || formValues.SERVER_TYPE;
      setFormValues((current) => ({
        ...current,
        JF_HOST: response.data.cleanedUrl || current.JF_HOST,
        SERVER_TYPE: detected,
      }));
      setConnectionTest({
        status: "success",
        testedHost: response.data.cleanedUrl || formValues.JF_HOST,
        testedKey: formValues.JF_API_KEY,
        testedType: detected,
        message: `Connected to ${serverName(detected)} at ${response.data.cleanedUrl || formValues.JF_HOST}`,
      });
    } catch (error) {
      const status = error?.response?.status;
      const message =
        status === 401 || status === 403
          ? "The server rejected this API key. Check it was copied in full, or create a new one."
          : readableError(error, "Couldn't reach the server. Check the URL and API key.");
      setConnectionTest({ status: "error", message });
    } finally {
      setProcessing(false);
    }
  }

  // The connection must have passed a test with exactly these values.
  function isTestedForCurrentValues() {
    const testedHost = connectionTest.testedHost?.replace(/\/+$/, "");
    const currentHost = formValues.JF_HOST?.trim()?.replace(/\/+$/, "");
    return (
      connectionTest.status === "success" &&
      testedHost === currentHost &&
      connectionTest.testedKey === formValues.JF_API_KEY &&
      connectionTest.testedType === formValues.SERVER_TYPE
    );
  }

  // One primary button: it tests the connection first, then saves.
  async function handleFormSubmit(event) {
    event.preventDefault();
    if (!isTestedForCurrentValues()) {
      await testConnection();
      return;
    }

    setProcessing(true);
    setSaveState("saving");
    try {
      await axios.post("/auth/configSetup/", serverPayload(formValues));
      setSaveState("saved");
      setTimeout(() => window.location.reload(), 600);
    } catch (error) {
      let errorMessage;
      if (error.response?.status === 401) errorMessage = i18next.t("ERROR_MESSAGES.INVALID_LOGIN");
      else if (error.response?.status === 404) errorMessage = i18next.t("ERROR_MESSAGES.INVALID_URL").replace("{STATUS}", error.response.status);
      else errorMessage = readableError(error, "Couldn't save the server details.");
      setConnectionTest({ status: "error", message: errorMessage });
      setSaveState("idle");
      setProcessing(false);
    }
  }

  async function handleBackupRestore(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!String(file.name || "").toLowerCase().endsWith(".json")) {
      setRestoreStatus({ status: "error", message: "Choose a JellyGlance or Jellystat .json backup file." });
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    const formData = new FormData();
    formData.append("file", file);

    try {
      setProcessing(true);
      setRestoreProgress(0);
      setRestorePhase("uploading");
      setRestoreStatus({ status: "testing", message: `Uploading ${file.name}...` });

      const response = await axios.post("/backup/first-run/restore", formData, {
        timeout: 0,
        onUploadProgress: (progressEvent) => {
          if (progressEvent.total) {
            const progress = Math.round((progressEvent.loaded / progressEvent.total) * 100);
            setRestoreProgress(progress);
            if (progress >= 100) {
              setRestorePhase("applying");
              setRestoreStatus({
                status: "testing",
                message: "Applying backup to database. Large backups can take several minutes...",
              });
            }
          }
        },
      });

      let restoreResult;
      if (response.data?.status === "processing") {
        restoreResult = await waitForFirstRunRestoreComplete();
      } else {
        restoreResult = {
          setupState: Number(response.data?.setupState ?? 0),
          restoredRows: Number(response.data?.restoredRows || 0),
        };
      }

      finishRestoreFlow(restoreResult);
    } catch (error) {
      const payload = error.response?.data;
      const message =
        (typeof payload === "object" && payload?.error) ||
        (typeof payload === "string" && payload) ||
        error.message ||
        "Restore failed";
      setRestoreStatus({ status: "error", message });
      setProcessing(false);
      setRestorePhase("idle");
      setRestoreProgress(0);
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  const detectedType = probe.status === "ok" ? probe.info?.serverType : null;
  const shownType = formValues.SERVER_TYPE !== "auto" ? formValues.SERVER_TYPE : detectedType;
  const hasHost = Boolean(formValues.JF_HOST?.trim());
  const hasKey = Boolean(formValues.JF_API_KEY?.trim());
  const testing = connectionTest.status === "testing";

  const addressCheck = (() => {
    if (probe.status === "checking") return { state: "running", detail: "Looking for Jellyfin or Emby at this address..." };
    if (probe.status === "ok") {
      const { serverLabel, version, serverName: name } = probe.info || {};
      const parts = [[serverLabel, version].filter(Boolean).join(" "), name].filter(Boolean);
      return { state: "success", detail: parts.join(" · ") || "The server answered." };
    }
    if (probe.status === "fail") {
      return { state: "error", detail: "Nothing answered as Jellyfin or Emby. Check the port and whether it is http or https." };
    }
    return { state: "pending", detail: hasHost ? "Finish typing the address." : "Enter the server address." };
  })();

  const keyCheck = (() => {
    if (testing) return { state: "running", detail: "Signing in with the API key..." };
    if (connectionTest.status === "success") return { state: "success", detail: connectionTest.message };
    if (connectionTest.status === "error") return { state: "error", detail: connectionTest.message };
    return { state: "pending", detail: hasKey ? "Press Test connection to check it." : "Paste an API key from your server." };
  })();

  const checks = [
    { id: "address", label: "Server reachable", ...addressCheck },
    { id: "key", label: "API key accepted", ...keyCheck },
  ];
  const showChecks = hasHost || connectionTest.status !== "idle";

  return (
    <SetupShell
      step={1}
      eyebrow="Media server connection"
      title="Connect your media server"
      description="Add your Jellyfin or Emby URL and API key, or restore a previous JellyGlance backup to bring an old install back."
      minimal
    >
      <section className="setup-stage-shell">
        <section className="setup-stage-form-card">
          <div className="setup-jellyfin-form-header">
            <div className="setup-jellyfin-logo" aria-hidden="true">
              <img src={shownType === "emby" ? embyLogo : jellyfinLogo} alt="" />
            </div>
            <div className="setup-form-heading-block">
              <strong>{shownType ? `${serverName(shownType)} connection` : "Server connection"}</strong>
              <span>Enter the server you want JellyGlance to index and monitor.</span>
            </div>
          </div>
          <Form onSubmit={handleFormSubmit} className="setup-form">
            <div className="setup-server-type" role="radiogroup" aria-label="Media server type">
              {SERVER_TYPES.map((type) => (
                <button
                  key={type.id}
                  type="button"
                  role="radio"
                  aria-checked={formValues.SERVER_TYPE === type.id}
                  className={formValues.SERVER_TYPE === type.id ? "is-active" : ""}
                  onClick={() => chooseServerType(type.id)}
                >
                  {type.label}
                  {type.id === "auto" && formValues.SERVER_TYPE === "auto" && detectedType ? (
                    <span className="setup-server-type-detected"> · {serverName(detectedType)}</span>
                  ) : null}
                </button>
              ))}
            </div>
            <Form.Group className="inputbox">
              <Form.Label>URL</Form.Label>
              <Form.Control
                id="JF_HOST"
                name="JF_HOST"
                value={formValues.JF_HOST || ""}
                onChange={handleFormChange}
                placeholder={formValues.SERVER_TYPE === "emby" ? "http://192.168.1.10:8096 or https://emby.example.com" : "http://192.168.1.10:8096 or https://jellyfin.example.com"}
                autoComplete="off"
                autoFocus
                spellCheck={false}
              />
              <small className="setup-field-hint">The address the JellyGlance server uses to reach it. A LAN address is fine.</small>
            </Form.Group>

            <Form.Group className="inputbox">
              <Form.Label>
                <Trans i18nKey={"SETTINGS_PAGE.API_KEY"} />
              </Form.Label>
              <InputGroup>
                <Form.Control
                  className="px-0"
                  id="JF_API_KEY"
                  name="JF_API_KEY"
                  value={formValues.JF_API_KEY || ""}
                  onChange={handleFormChange}
                  type={showPassword ? "text" : "password"}
                  placeholder={`Paste ${serverName(formValues.SERVER_TYPE)} API key`}
                  autoComplete="off"
                />
                <Button
                  className="login-show-password"
                  type="button"
                  aria-label={showPassword ? "Hide API key" : "Show API key"}
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? <EyeFillIcon /> : <EyeOffFillIcon />}
                </Button>
              </InputGroup>
              <small className="setup-field-hint">{API_KEY_HELP[formValues.SERVER_TYPE] || API_KEY_HELP.auto}</small>
            </Form.Group>

            {showChecks ? <ConnectionChecks checks={checks} /> : null}

            <div className="setup-button-row">
              {connectionTest.status === "success" ? (
                <Button type="button" className="setup-secondary-button" disabled={processing} onClick={testConnection}>
                  Test again
                </Button>
              ) : null}
              <Button type="submit" className="setup-button" disabled={processing || !formValues.JF_HOST?.trim() || !formValues.JF_API_KEY?.trim()}>
                {testing ? <span className="setup-spinner setup-button-spinner" aria-hidden="true" /> : null}
                {testing
                  ? "Testing connection..."
                  : saveState === "saving"
                    ? "Saving..."
                    : saveState === "saved"
                      ? i18next.t("SETTINGS_SAVED")
                      : isTestedForCurrentValues()
                        ? "Save and continue"
                        : "Test connection"}
              </Button>
            </div>
          </Form>
        </section>

        <section className="setup-stage-form-card setup-restore-card">
          <details className="setup-restore-details" open={restoreStatus.status !== "idle" || undefined}>
            <summary className="setup-jellyfin-form-header">
              <div className="setup-jellyfin-logo" aria-hidden="true">
                <Database2LineIcon size={28} />
              </div>
              <div className="setup-form-heading-block">
                <strong>Moving from another install?</strong>
                <span>Restore a JellyGlance or Jellystat JSON backup instead of starting fresh.</span>
              </div>
              <ArrowDownSLineIcon className="setup-restore-chevron" size={20} aria-hidden="true" />
            </summary>
            <div className="setup-restore-body">
              <div className="setup-restore-actions">
                <label className={`setup-restore-upload${processing ? " is-disabled" : ""}`}>
                  <UploadCloud2LineIcon size={18} />
                  <span>
                    {processing && restoreStatus.status === "testing"
                      ? restorePhase === "applying"
                        ? "Applying backup..."
                        : restoreProgress > 0
                          ? `Uploading ${restoreProgress}%...`
                          : "Preparing upload..."
                      : restorePhase === "complete"
                        ? "Restore complete"
                        : "Choose backup JSON"}
                  </span>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".json,application/json"
                    disabled={processing}
                    onChange={handleBackupRestore}
                  />
                </label>
                <p className="setup-restore-hint">Restores config, libraries and activity. Older backups without app config still restore library and activity data.</p>
              </div>

              {restoreStatus.message ? (
                <div className={`setup-connection-status is-${restoreStatus.status}`} role="status">
                  {restoreStatus.message}
                </div>
              ) : null}
            </div>
          </details>
        </section>
      </section>
    </SetupShell>
  );
}

export default Setup;

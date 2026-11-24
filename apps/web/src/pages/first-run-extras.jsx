import { useState } from "react";
import Button from "react-bootstrap/Button";
import RefreshLineIcon from "remixicon-react/RefreshLineIcon";
import RocketLineIcon from "remixicon-react/RocketLineIcon";
import ServerLineIcon from "remixicon-react/ServerLineIcon";
import Database2LineIcon from "remixicon-react/Database2LineIcon";
import DashboardLineIcon from "remixicon-react/DashboardLineIcon";
import axios from "../lib/axios_instance";
import Config from "../lib/config";
import baseUrl from "../lib/baseurl";
import { FIRST_RUN_EXTRAS_KEY } from "../lib/first-run";
import Integrations from "./integrations";
import JellystatImport from "./components/settings/JellystatImport";
import TautulliImport from "./components/settings/TautulliImport";
import { ImportSourceLabel } from "../lib/import-source-logos";
import SetupShell from "./components/setup/SetupShell";
import "./css/settings/settings.css";
import { mediaServerName } from "../lib/media-server";

// Integrations are set up one group at a time; see firstRunGroups in integrations.jsx.
const INTEGRATION_GROUPS = [
  { id: "arr", label: "Arr apps" },
  { id: "requests", label: "Requests" },
  { id: "download", label: "Download clients" },
  { id: "third", label: "Other apps" },
];

export default function FirstRunExtras() {
  const [activePanel, setActivePanel] = useState("integrations");
  const [activeImportSource, setActiveImportSource] = useState("jellystat");
  const [integrationGroup, setIntegrationGroup] = useState(INTEGRATION_GROUPS[0].id);
  const groupIndex = INTEGRATION_GROUPS.findIndex((group) => group.id === integrationGroup);
  const nextGroup = INTEGRATION_GROUPS[groupIndex + 1];
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const currentStep = activePanel === "integrations" ? 3 : activePanel === "imports" ? 4 : 5;

  async function startFirstSync() {
    try {
      setBusy(true);
      setMessage("");
      await axios.post(
        "/api/first-run/start-sync",
        {},
        {
          headers: {
            Authorization: `Bearer ${localStorage.getItem("token")}`,
            "Content-Type": "application/json",
          },
        }
      );
      localStorage.removeItem(FIRST_RUN_EXTRAS_KEY);
      localStorage.removeItem("config");
      await Config.setConfig();
      window.location.assign(`${baseUrl || ""}/`);
    } catch (error) {
      setMessage(error.response?.data?.error || "Unable to start the first sync.");
      setBusy(false);
    }
  }

  function goNext() {
    if (activePanel === "integrations") {
      if (nextGroup) {
        setIntegrationGroup(nextGroup.id);
        document.querySelector(".setup-content")?.scrollTo({ top: 0 });
        return;
      }
      setActivePanel("imports");
      return;
    }

    if (activePanel === "imports") {
      setActivePanel("sync");
      return;
    }

    startFirstSync();
  }

  function goBack() {
    if (activePanel === "integrations" && groupIndex > 0) {
      setIntegrationGroup(INTEGRATION_GROUPS[groupIndex - 1].id);
      return;
    }

    if (activePanel === "imports") {
      setIntegrationGroup(INTEGRATION_GROUPS[INTEGRATION_GROUPS.length - 1].id);
      setActivePanel("integrations");
      return;
    }

    if (activePanel === "sync") {
      setActivePanel("imports");
    }
  }

  const actionRow = (
    <div className="setup-button-row setup-extra-actions">
      {activePanel !== "integrations" || groupIndex > 0 ? (
        <Button type="button" className="setup-secondary-button" onClick={goBack} disabled={busy}>
          Back
        </Button>
      ) : null}
      {activePanel === "integrations" ? (
        <Button type="button" className="setup-secondary-button" onClick={() => setActivePanel("sync")} disabled={busy}>
          Skip to sync
        </Button>
      ) : null}
      <Button type="button" className={`setup-button${activePanel === "sync" ? " setup-launch-button" : ""}`} onClick={goNext} disabled={busy}>
        {busy
          ? "Starting sync..."
          : activePanel === "sync"
            ? "Start first sync"
            : activePanel === "integrations" && nextGroup
              ? `Next: ${nextGroup.label}`
              : activePanel === "integrations"
                ? "Next: History import"
                : "Next: First sync"}
      </Button>
    </div>
  );

  return (
    <SetupShell
      step={currentStep}
      eyebrow={activePanel === "integrations" ? "" : activePanel === "imports" ? "Legacy history" : "Build dashboard"}
      title={
        activePanel === "integrations"
          ? ""
          : activePanel === "imports"
            ? "Import old watch history"
            : "Start the first sync"
      }
      description={
        activePanel === "integrations"
          ? ""
          : activePanel === "imports"
            ? `Import Jellystat or Tautulli history and match legacy users before the initial ${mediaServerName()} sync fills the rest of the dashboard.`
            : `JellyGlance will run the first full ${mediaServerName()} sync, recently added sync, Playback Reporting import, and dashboard stat refresh.`
      }
      minimal
    >
      <div className={`setup-extras ${activePanel === "integrations" ? "is-integrations-step" : ""}`}>
        {message ? <div className="setup-connection-status is-error">{message}</div> : null}

        <div className="setup-extra-panel">
          {activePanel === "integrations" ? <Integrations
              embedded
              firstRun
              actions={actionRow}
              firstRunGroup={integrationGroup}
              onFirstRunGroupChange={setIntegrationGroup}
            /> : null}
          {activePanel === "imports" ? (
            <>
              <div className="setup-import-intro">
                <div>
                  <strong>
                    Bring in old watch history <span className="setup-optional-badge">Optional</span>
                  </strong>
                  <span>
                    Moving from Jellystat or Tautulli? Import its history so your stats start with the full picture. Starting
                    fresh? Just continue.
                  </span>
                </div>
                <div className="setup-import-source-tabs" role="tablist" aria-label="History import source">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={activeImportSource === "jellystat"}
                    className={activeImportSource === "jellystat" ? "is-active" : ""}
                    onClick={() => setActiveImportSource("jellystat")}
                  >
                    <ImportSourceLabel source="jellystat" label="Jellystat" />
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={activeImportSource === "tautulli"}
                    className={activeImportSource === "tautulli" ? "is-active" : ""}
                    onClick={() => setActiveImportSource("tautulli")}
                  >
                    <ImportSourceLabel source="tautulli" label="Tautulli" />
                  </button>
                </div>
              </div>
              {activeImportSource === "jellystat" ? <JellystatImport compact /> : <TautulliImport compact />}
            </>
          ) : null}
          {activePanel === "sync" ? (
            <section className="setup-launch">
              <div className="setup-launch-hero">
                <span className="setup-launch-orb" aria-hidden="true">
                  <RocketLineIcon size={30} />
                </span>
                <div>
                  <span className="setup-launch-kicker">Final step</span>
                  <h3>Ready to build your dashboard</h3>
                  <p>
                    One click and JellyGlance reads your {mediaServerName()} server. Anything you skipped can be set up later in
                    Settings.
                  </p>
                </div>
              </div>

              <ol className="setup-launch-tasks">
                {[
                  { icon: ServerLineIcon, title: "Libraries and users", text: `Full ${mediaServerName()} library and user sync` },
                  { icon: RefreshLineIcon, title: "Recently added", text: "Your newest media, ready on the home page" },
                  { icon: Database2LineIcon, title: "Playback history", text: "Playback Reporting Plugin import, when installed" },
                  { icon: DashboardLineIcon, title: "Dashboard stats", text: "Charts and totals refreshed with the new data" },
                ].map((task, index) => (
                  <li key={task.title} style={{ "--task-delay": `${index * 90}ms` }}>
                    <span className="setup-launch-task-icon" aria-hidden="true">
                      <task.icon size={18} />
                    </span>
                    <div>
                      <strong>{task.title}</strong>
                      <small>{task.text}</small>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          ) : null}
        </div>

        {activePanel !== "integrations" ? actionRow : null}
      </div>
    </SetupShell>
  );
}

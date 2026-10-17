import { useEffect, useState } from "react";
import Alert from "react-bootstrap/Alert";
import Button from "react-bootstrap/Button";
import Col from "react-bootstrap/Col";
import Form from "react-bootstrap/Form";
import InputGroup from "react-bootstrap/InputGroup";
import Row from "react-bootstrap/Row";
import EyeFillIcon from "remixicon-react/EyeFillIcon";
import EyeOffFillIcon from "remixicon-react/EyeOffFillIcon";
import axios from "../../../lib/axios_instance";
import Config from "../../../lib/config";
import Loading from "../general/loading";
import MediaServerConnectionTest from "./MediaServerConnectionTest";

export default function JellyfinIntegrationSettings({ compact = false, firstRun = false }) {
  const [config, setConfig] = useState(null);
  const [showKey, setKeyState] = useState(false);
  const [formValues, setFormValues] = useState({});
  const [isEditingConnection, setIsEditingConnection] = useState(!firstRun);
  const [isSubmitted, setIsSubmitted] = useState("");
  const [loadState, setLoadState] = useState("Loading");
  const [submissionMessage, setSubmissionMessage] = useState("");

  useEffect(() => {
    Config.getConfig()
      .then((nextConfig) => {
        setFormValues({ JF_HOST: nextConfig.hostUrl, SERVER_TYPE: nextConfig.SERVER_TYPE || "jellyfin" });
        setConfig(nextConfig);
        setLoadState("Loaded");
      })
      .catch((error) => {
        console.log("Error retrieving config:", error);
        setLoadState("Critical");
        setSubmissionMessage("Error retrieving configuration. Unable to contact backend server.");
      });
  }, []);

  function handleFormChange(event) {
    setFormValues({ ...formValues, [event.target.name]: event.target.value });
  }

  async function handleFormSubmit(event) {
    event.preventDefault();

    setIsSubmitted("");
    const payload = config?.SERVER_TYPE_LOCKED ? { ...formValues, SERVER_TYPE: undefined } : formValues;
    const label = formValues.SERVER_TYPE === "emby" ? "Emby" : "Jellyfin";
    axios
      .post("/api/setconfig/", payload, {
        headers: {
          Authorization: `Bearer ${config.token}`,
          "Content-Type": "application/json",
        },
      })
      .then((response) => {
        console.log("Config updated successfully:", response.data);
        setIsSubmitted("Success");
        setSubmissionMessage(`Successfully updated ${label} connection`);
        Config.getConfig(true)
          .then((nextConfig) => nextConfig?.hostUrl && setConfig(nextConfig))
          .catch(() => {});
        if (firstRun) {
          setIsEditingConnection(false);
        }
      })
      .catch((error) => {
        const errorMessage = error.response?.data?.errorMessage || error.message;
        console.log("Error updating config:", errorMessage);
        setIsSubmitted("Failed");
        setSubmissionMessage(`Error updating ${label} connection: ${errorMessage}`);
      });
  }

  if (loadState === "Loading") {
    return <Loading />;
  }

  if (loadState === "Critical") {
    return <div className="submit critical">{submissionMessage}</div>;
  }

  const hasSavedConnection = Boolean(config?.hostUrl);
  const savedType = config?.SERVER_TYPE || (config?.IS_JELLYFIN === false ? "emby" : "jellyfin");
  const selectedType = formValues.SERVER_TYPE || savedType;
  const selectedLabel = selectedType === "emby" ? "Emby" : "Jellyfin";

  return (
    <section className={`jellyfin-integration-card${compact ? " is-compact" : ""}`}>
      <div className="jellyfin-integration-header">
        <span className="integration-icon">
          <img src={`https://cdn.jsdelivr.net/gh/selfhst/icons/svg/${selectedType === "emby" ? "emby" : "jellyfin"}.svg`} alt="" loading="lazy" decoding="async" />
        </span>
        <div>
          <p>Media server</p>
          <h2>{selectedLabel} Connection</h2>
          <span>
            {firstRun
              ? "Already connected for setup. Re-enter details only if you want to replace the saved media server connection."
              : "Primary media server used for sessions, library scans, artwork, users, and statistics."}
          </span>
        </div>
      </div>

      {firstRun && hasSavedConnection && !isEditingConnection ? (
        <div className="settings-form integration-settings-form jellyfin-connected-summary">
          <div>
            <span>Connected server</span>
            <strong>{config.hostUrl}</strong>
          </div>
          <Button variant="outline-success" type="button" onClick={() => setIsEditingConnection(true)}>
            Replace connection
          </Button>
        </div>
      ) : (
        <Form onSubmit={handleFormSubmit} className="settings-form integration-settings-form">
          <Form.Group as={Row} className="mb-3">
            <Form.Label column>Server type</Form.Label>
            <Col sm="10">
              <Form.Select name="SERVER_TYPE" value={formValues.SERVER_TYPE || "jellyfin"} onChange={handleFormChange} disabled={config?.SERVER_TYPE_LOCKED}>
                <option value="jellyfin">Jellyfin</option>
                <option value="emby">Emby</option>
              </Form.Select>
              {config?.SERVER_TYPE_LOCKED ? <Form.Text muted>Set by the IS_EMBY_API environment variable.</Form.Text> : null}
              {!config?.SERVER_TYPE_LOCKED && selectedType !== savedType ? (
                <Form.Text muted>
                  Not saved yet. Enter the {selectedLabel} URL and API key, then press Update to switch from {savedType === "emby" ? "Emby" : "Jellyfin"}.
                </Form.Text>
              ) : null}
            </Col>
          </Form.Group>

          <Form.Group as={Row} className="mb-3">
            <Form.Label column>{selectedLabel} URL</Form.Label>
            <Col sm="10">
              <Form.Control
                id="JF_HOST"
                name="JF_HOST"
                value={formValues.JF_HOST || ""}
                onChange={handleFormChange}
                placeholder="http://127.0.0.1:8096 or https://media.example.com"
                autoComplete="off"
              />
            </Col>
          </Form.Group>

          <Form.Group as={Row} className="mb-3">
            <Form.Label column>API Key</Form.Label>
            <Col sm="10">
              <InputGroup>
                <Form.Control
                  id="JF_API_KEY"
                  name="JF_API_KEY"
                  value={formValues.JF_API_KEY || ""}
                  onChange={handleFormChange}
                  type={showKey ? "text" : "password"}
                  autoComplete="off"
                />
                <Button variant="outline-primary" type="button" onClick={() => setKeyState(!showKey)}>
                  {showKey ? <EyeFillIcon /> : <EyeOffFillIcon />}
                </Button>
              </InputGroup>
            </Col>
          </Form.Group>

          {isSubmitted !== "" ? (
            <Alert bg="dark" data-bs-theme="dark" variant={isSubmitted === "Failed" ? "danger" : "success"}>
              {submissionMessage}
            </Alert>
          ) : null}

          <div className="d-flex flex-column flex-md-row justify-content-end align-items-md-center gap-2">
            {firstRun && hasSavedConnection ? (
              <Button variant="outline-secondary" type="button" onClick={() => setIsEditingConnection(false)}>
                Cancel
              </Button>
            ) : null}
            <Button variant="outline-success" type="submit">
              Update
            </Button>
          </div>
        </Form>
      )}

      {hasSavedConnection && !firstRun ? <MediaServerConnectionTest token={config.token} hostUrl={config.hostUrl} /> : null}
    </section>
  );
}

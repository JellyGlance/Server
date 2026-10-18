import { useEffect, useState } from "react";
import axios from "../../../lib/axios_instance";
import Form from "react-bootstrap/Form";
import Row from "react-bootstrap/Row";
import Col from "react-bootstrap/Col";
import Button from "react-bootstrap/Button";
import Alert from "react-bootstrap/Alert";
import Spinner from "react-bootstrap/Spinner";
import EyeFillIcon from "remixicon-react/EyeFillIcon";
import EyeOffFillIcon from "remixicon-react/EyeOffFillIcon";
import LoginCircleLineIcon from "remixicon-react/LoginCircleLineIcon";
import ShieldKeyholeLineIcon from "remixicon-react/ShieldKeyholeLineIcon";
import UserSettingsLineIcon from "remixicon-react/UserSettingsLineIcon";
import { Link } from "react-router-dom";

import Config from "../../../lib/config";
import {
  ACTIVE_SESSION_IP_PRIVACY_OPTIONS,
  getActiveSessionIpPrivacy,
  setActiveSessionIpPrivacy,
} from "../../../lib/privacy-settings";

import "../../css/settings/settings.css";
import { InputGroup } from "react-bootstrap";
import { useTranslation } from "react-i18next";

const OIDC = "SETTINGS_PAGE.OIDC";
const OIDC_ROLES = ["Owner", "Admin", "Manager", "Viewer", "Household", "Disabled"];

function roleMappingToText(mapping) {
  if (!mapping || typeof mapping !== "object") return typeof mapping === "string" ? mapping : "";
  return Object.entries(mapping)
    .map(([group, role]) => `${group}=${role}`)
    .join("\n");
}

const authModes = [
  {
    id: "quick-connect",
    title: "Jellyfin Login / Quick Connect",
    text: "Use Jellyfin Quick Connect for account access.",
    Icon: LoginCircleLineIcon,
  },
  {
    id: "oidc",
    title: "OIDC / Authentik",
    text: "Use an external identity provider.",
    Icon: ShieldKeyholeLineIcon,
  },
  {
    id: "local",
    title: "Local",
    text: "Use a JellyGlance username and password.",
    Icon: UserSettingsLineIcon,
  },
];

export default function SecuritySettings() {
  const { t } = useTranslation();
  const [authMode, setAuthMode] = useState("quick-connect");
  const [showOidcSecret, setShowOidcSecret] = useState(false);
  const [oidcValues, setOidcValues] = useState({});
  const [activeSessionIpPrivacy, setActiveSessionIpPrivacyState] = useState(() => getActiveSessionIpPrivacy());
  const [saving, setSaving] = useState(false);
  const [isSubmitted, setisSubmitted] = useState("");
  const [submissionMessage, setsubmissionMessage] = useState("");
  const token = localStorage.getItem("token");
  const activeAuthMode = authModes.find((mode) => mode.id === authMode) || authModes[0];
  const activePrivacyMode = ACTIVE_SESSION_IP_PRIVACY_OPTIONS.find((option) => option.id === activeSessionIpPrivacy) || ACTIVE_SESSION_IP_PRIVACY_OPTIONS[0];

  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const newConfig = await Config.getConfig(true);
        const nextAuth = newConfig.settings?.auth || {};
        const nextMode = nextAuth.mode || (newConfig.requireLogin ? "local" : "quick-connect");

        setAuthMode(nextMode);
        setOidcValues({
          issuerUrl: nextAuth.issuerUrl || "",
          clientId: nextAuth.clientId || "",
          clientSecret: "",
          redirectUri: nextAuth.redirectUri || `${window.location.origin}/auth/oidc/callback`,
          scopes: nextAuth.scopes || "openid profile email",
          groupsClaim: nextAuth.groupsClaim || "groups",
          roleMapping: roleMappingToText(nextAuth.roleMapping),
          linkPolicy: nextAuth.linkPolicy || "verified_email",
          autoProvision: Boolean(nextAuth.autoProvision),
          defaultRole: nextAuth.defaultRole || "Viewer",
          clearClientSecret: false,
        });
      } catch (error) {
        console.log(error);
      }
    };

    fetchConfig();

    const intervalId = setInterval(fetchConfig, 60000 * 5);
    return () => clearInterval(intervalId);
  }, []);

  async function saveAuthMode(payload) {
    const result = await axios
      .post("/api/setAuthMode", payload, {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      })
      .catch((error) => error.response);

    if (result?.status >= 400) {
      return { isValid: false, errorMessage: result?.data?.errorMessage || "Unable to update authentication mode" };
    }

    await Config.setConfig();
    return { isValid: true };
  }

  async function handleAuthSubmit(event) {
    event.preventDefault();
    setSaving(true);
    setisSubmitted("");

    let result;

    if (authMode === "quick-connect") {
      result = await saveAuthMode({ mode: "quick-connect" });
    }

    if (authMode === "oidc") {
      result = await saveAuthMode({ mode: "oidc", ...oidcValues });
    }

    if (authMode === "local") {
      result = await saveAuthMode({ mode: "local" });
    }

    setSaving(false);
    if (result?.isValid) {
      setisSubmitted("Success");
      setsubmissionMessage("Authentication settings updated.");
      return;
    }

    setisSubmitted("Failed");
    setsubmissionMessage(result?.errorMessage || "Unable to update authentication settings.");
  }

  function handleOidcChange(event) {
    const { name, type, checked, value } = event.target;
    setOidcValues({ ...oidcValues, [name]: type === "checkbox" ? checked : value });
  }

  function handleActiveSessionIpPrivacyChange(value) {
    const nextValue = setActiveSessionIpPrivacy(value);
    setActiveSessionIpPrivacyState(nextValue);
    setisSubmitted("Success");
    setsubmissionMessage("Active Sessions IP privacy updated.");
  }

  return (
    <div className="security-page">
      <header className="security-hero">
        <div>
          <span>Access Control</span>
          <h1>Security</h1>
          <p>Manage sign-in, identity providers, and what sensitive session details are visible on shared screens.</p>
        </div>
        <div className="security-current-stack" aria-label="Current security settings">
          <article>
            <LoginCircleLineIcon size={18} />
            <span>Authentication</span>
            <strong>{activeAuthMode.title}</strong>
          </article>
          <article>
            <ShieldKeyholeLineIcon size={18} />
            <span>IP Privacy</span>
            <strong>{activePrivacyMode.title}</strong>
          </article>
        </div>
      </header>

      {isSubmitted !== "" ? (
        <Alert bg="dark" data-bs-theme="dark" variant={isSubmitted === "Failed" ? "danger" : "success"} className="security-status-alert">
          {submissionMessage}
        </Alert>
      ) : null}

      <section className="settings-form security-auth-form security-privacy-form">
        <div className="security-auth-header">
          <div>
            <h2>Active Sessions privacy</h2>
            <p>Choose where JellyGlance hides viewer IP addresses in Active Sessions cards and details.</p>
          </div>
          <strong>{activePrivacyMode.title}</strong>
        </div>

        <div className="security-auth-grid security-privacy-grid" role="radiogroup" aria-label="Active Sessions IP privacy">
          {ACTIVE_SESSION_IP_PRIVACY_OPTIONS.map(({ id, title, text }) => (
            <button
              key={id}
              type="button"
              className={`security-auth-card ${activeSessionIpPrivacy === id ? "is-active" : ""}`}
              onClick={() => handleActiveSessionIpPrivacyChange(id)}
            >
              <ShieldKeyholeLineIcon size={22} />
              <span>
                <strong>{title}</strong>
                <small>{text}</small>
              </span>
            </button>
          ))}
        </div>
      </section>

      <Form onSubmit={handleAuthSubmit} className="settings-form security-auth-form">
        <div className="security-auth-header">
          <div>
            <h2>Authentication</h2>
            <p>Choose how JellyGlance signs users in after Jellyfin setup.</p>
          </div>
          <strong>{activeAuthMode.title}</strong>
        </div>

        <div className="security-auth-grid" role="radiogroup" aria-label="Authentication mode">
          {authModes.map(({ id, title, text, Icon }) => (
            <button
              key={id}
              type="button"
              className={`security-auth-card ${authMode === id ? "is-active" : ""}`}
              onClick={() => setAuthMode(id)}
            >
              <Icon size={22} />
              <span>
                <strong>{title}</strong>
                <small>{text}</small>
              </span>
            </button>
          ))}
        </div>

        {authMode === "quick-connect" && (
          <div className="security-auth-panel">
            <strong>Jellyfin Login / Quick Connect selected</strong>
            <p>
              JellyGlance will send users through Jellyfin Quick Connect. No local admin username or password is needed for
              this mode.
            </p>
          </div>
        )}

        {authMode === "oidc" && (
          <div className="security-auth-panel">
            <Form.Group as={Row} className="mb-3">
              <Form.Label column>Issuer URL</Form.Label>
              <Col>
                <Form.Control
                  name="issuerUrl"
                  value={oidcValues.issuerUrl || ""}
                  onChange={handleOidcChange}
                  placeholder="https://auth.example.com/application/o/jellyglance/"
                  required={authMode === "oidc"}
                />
              </Col>
            </Form.Group>

            <Form.Group as={Row} className="mb-3">
              <Form.Label column>Client ID</Form.Label>
              <Col>
                <Form.Control name="clientId" value={oidcValues.clientId || ""} onChange={handleOidcChange} required={authMode === "oidc"} />
              </Col>
            </Form.Group>

            <Form.Group as={Row} className="mb-3">
              <Form.Label column>Client Secret</Form.Label>
              <Col>
                <InputGroup>
                  <Form.Control
                    name="clientSecret"
                    value={oidcValues.clientSecret || ""}
                    onChange={handleOidcChange}
                    placeholder="Leave blank to keep the saved secret"
                    type={showOidcSecret ? "text" : "password"}
                    autoComplete="off"
                  />
                  <Button variant="outline-primary" type="button" onClick={() => setShowOidcSecret(!showOidcSecret)}>
                    {showOidcSecret ? <EyeFillIcon /> : <EyeOffFillIcon />}
                  </Button>
                </InputGroup>
              </Col>
            </Form.Group>

            <Form.Group as={Row} className="mb-3">
              <Form.Label column>Redirect URI</Form.Label>
              <Col>
                <Form.Control name="redirectUri" value={oidcValues.redirectUri || ""} onChange={handleOidcChange} />
              </Col>
            </Form.Group>

            <Form.Group className="mb-3 security-oidc-check">
              <div>
                <Form.Check
                  type="checkbox"
                  id="oidc-public-client"
                  name="clearClientSecret"
                  checked={Boolean(oidcValues.clearClientSecret)}
                  onChange={handleOidcChange}
                  label={t(`${OIDC}.PUBLIC_CLIENT`)}
                />
              </div>
            </Form.Group>

            <Form.Group as={Row} className="mb-3">
              <Form.Label column>{t(`${OIDC}.SCOPES`)}</Form.Label>
              <Col>
                <Form.Control name="scopes" value={oidcValues.scopes || ""} onChange={handleOidcChange} placeholder="openid profile email groups" />
              </Col>
            </Form.Group>

            <Form.Group as={Row} className="mb-3">
              <Form.Label column>{t(`${OIDC}.GROUPS_CLAIM`)}</Form.Label>
              <Col>
                <Form.Control name="groupsClaim" value={oidcValues.groupsClaim || ""} onChange={handleOidcChange} placeholder="groups" />
              </Col>
            </Form.Group>

            <Form.Group as={Row} className="mb-3">
              <Form.Label column>{t(`${OIDC}.ROLE_MAPPING`)}</Form.Label>
              <Col>
                <Form.Control
                  as="textarea"
                  rows={3}
                  name="roleMapping"
                  value={oidcValues.roleMapping || ""}
                  onChange={handleOidcChange}
                  placeholder={"jellyglance-admins=Admin\njellyglance-users=Viewer"}
                />
                <Form.Text muted>{t(`${OIDC}.ROLE_MAPPING_HINT`)}</Form.Text>
              </Col>
            </Form.Group>

            <Form.Group as={Row} className="mb-3">
              <Form.Label column>{t(`${OIDC}.LINK_POLICY`)}</Form.Label>
              <Col>
                <Form.Select name="linkPolicy" value={oidcValues.linkPolicy || "verified_email"} onChange={handleOidcChange}>
                  <option value="verified_email">{t(`${OIDC}.LINK_VERIFIED_EMAIL`)}</option>
                  <option value="username">{t(`${OIDC}.LINK_USERNAME`)}</option>
                  <option value="manual">{t(`${OIDC}.LINK_MANUAL`)}</option>
                </Form.Select>
                {oidcValues.linkPolicy === "username" ? <Form.Text className="text-warning">{t(`${OIDC}.LINK_USERNAME_WARNING`)}</Form.Text> : null}
              </Col>
            </Form.Group>

            <Form.Group as={Row} className="mb-3">
              <Form.Label column>{t(`${OIDC}.DEFAULT_ROLE`)}</Form.Label>
              <Col>
                <Form.Select name="defaultRole" value={oidcValues.defaultRole || "Viewer"} onChange={handleOidcChange}>
                  {OIDC_ROLES.map((role) => (
                    <option key={role} value={role}>
                      {role}
                    </option>
                  ))}
                </Form.Select>
              </Col>
            </Form.Group>

            <Form.Group className="mb-3 security-oidc-check">
              <div>
                <Form.Check
                  type="checkbox"
                  id="oidc-auto-provision"
                  name="autoProvision"
                  checked={Boolean(oidcValues.autoProvision)}
                  onChange={handleOidcChange}
                  label={t(`${OIDC}.AUTO_PROVISION`)}
                />
                <Form.Text muted>{t(`${OIDC}.BREAK_GLASS`)}</Form.Text>
              </div>
            </Form.Group>
          </div>
        )}

        {authMode === "local" && (
          <div className="security-auth-panel">
            <strong>Local login selected</strong>
            <p>
              Local JellyGlance accounts are created and managed on the Users page. Add users there, assign them Admin,
              Manager, Viewer, or Disabled roles, and reset passwords without changing the authentication mode here.
            </p>
            <Link className="security-users-link" to="/users">
              Manage local users
            </Link>
          </div>
        )}

        <div className="security-form-actions">
          <Button variant="outline-success" type="submit" disabled={saving}>
            {saving ? <Spinner animation="border" size="sm" /> : authMode === "oidc" ? "Test & Save" : "Save Authentication"}
          </Button>
        </div>
      </Form>
    </div>
  );
}

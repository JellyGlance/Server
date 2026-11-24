import { useState, useEffect } from "react";

import axios from "../lib/axios_instance";
import Config from "../lib/config";
import "./css/setup.css";
import Loading from "./components/general/loading";
import Form from "react-bootstrap/Form";
import Button from "react-bootstrap/Button";
import { InputGroup } from "react-bootstrap";

import EyeFillIcon from "remixicon-react/EyeFillIcon";
import EyeOffFillIcon from "remixicon-react/EyeOffFillIcon";
import AdminLineIcon from "remixicon-react/AdminLineIcon";
import Key2LineIcon from "remixicon-react/Key2LineIcon";
import CheckLineIcon from "remixicon-react/CheckLineIcon";
import RefreshLineIcon from "remixicon-react/RefreshLineIcon";
import jellyfinLogo from "./images/jellyfin.svg";
import embyLogo from "./images/emby.svg";
import i18next from "i18next";
import { Trans } from "react-i18next";
import SetupShell from "./components/setup/SetupShell";
import { FIRST_RUN_EXTRAS_KEY } from "../lib/first-run";

function Signup() {
  const [config, setConfig] = useState(null);
  const [formValues, setFormValues] = useState({});
  const [processing, setProcessing] = useState(false);
  const [submitButtonText, setsubmitButtonText] = useState(i18next.t("CREATE_USER"));
  const [showPassword, setShowPassword] = useState(false);
  const [authMode, setAuthMode] = useState("quick-connect");
  const [quickConnect, setQuickConnect] = useState(null);
  const [quickConnectStatus, setQuickConnectStatus] = useState("");
  const [serverType, setServerType] = useState("jellyfin");
  const [authError, setAuthError] = useState("");
  const [codeCopied, setCodeCopied] = useState(false);
  const [redirectCopied, setRedirectCopied] = useState(false);
  const defaultRedirectUri = `${window.location.origin}/auth/oidc/callback`;
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  // Emby has no Quick Connect: its option signs in with an Emby admin username and password.
  const embyLogin = authMode === "quick-connect" && serverType === "emby";
  const serverName = serverType === "emby" ? "Emby" : "Jellyfin";
  const quickConnectLabel = serverType === "emby" ? "Emby login" : "Jellyfin Quick Connect";

  useEffect(() => {
    axios
      .get("/auth/isConfigured")
      .then((response) => {
        if (response.data?.serverType === "emby") {
          setServerType("emby");
          setsubmitButtonText("Sign in with Emby");
        }
      })
      .catch(() => {});
  }, []);

  function handleFormChange(event) {
    setFormValues({ ...formValues, [event.target.name]: event.target.value });
    setAuthError("");
  }

  function handleAuthModeChange(nextMode) {
    setAuthMode(nextMode);
    setQuickConnect(null);
    setQuickConnectStatus("");
    setAuthError("");
    setShowPassword(false);
    setsubmitButtonText(
      nextMode === "quick-connect"
        ? serverType === "emby"
          ? "Sign in with Emby"
          : "Enable Quick Connect"
        : nextMode === "oidc"
          ? "Test & Save OIDC"
          : i18next.t("CREATE_USER")
    );
  }

  async function handleFormSubmit(event) {
    event.preventDefault();
    setAuthError("");

    if (authMode === "local" && formValues.JS_PASSWORD !== formValues.JS_PASSWORD_CONFIRM) {
      setAuthError("The passwords don't match.");
      return;
    }

    setProcessing(true);

    if (embyLogin) {
      finishEmbyLogin();
      return;
    }

    if (authMode === "quick-connect") {
      if (quickConnect?.secret) {
        await checkQuickConnectApproval();
        return;
      }
      startQuickConnect();
      return;
    }

    saveAuthSetup(formValues.JS_PASSWORD || undefined);
  }

  async function saveAuthSetup(hashedPassword) {
    axios
      .post(
        "/auth/setup-auth",
        {
          mode: authMode,
          username: formValues.JS_USERNAME,
          password: hashedPassword,
          issuerUrl: formValues.OIDC_ISSUER_URL,
          clientId: formValues.OIDC_CLIENT_ID,
          clientSecret: formValues.OIDC_CLIENT_SECRET,
          redirectUri: formValues.OIDC_REDIRECT_URI,
        },
        {
          headers: {
            "Content-Type": "application/json",
          },
        }
      )
      .then(async (response) => {
        localStorage.setItem("token", response.data.token);
        setsubmitButtonText("Settings Saved");
        await finishSetupNavigation();
        return;
      })
      .catch((error) => {
        let errorMessage = `Error : ${error.response?.status || "Unknown"}`;
        if (error.code === "ERR_NETWORK") {
          errorMessage = i18next.t("ERROR_MESSAGES.NETWORK_ERROR");
        } else if (error.response?.data?.errorMessage) {
          errorMessage = error.response.data.errorMessage;
        } else if (error.response?.status === 401) {
          errorMessage = i18next.t("ERROR_MESSAGES.UNAUTHORIZED").replace("{STATUS}", error.response.status);
        } else if (error.response?.status === 404) {
          errorMessage = i18next.t("ERROR_MESSAGES.INVALID_URL").replace("{STATUS}", error.response.status);
        }
        setAuthError(errorMessage);
        setProcessing(false);
      });
  }

  async function finishEmbyLogin() {
    try {
      setProcessing(true);
      setQuickConnectStatus("Signing in with Emby...");
      const response = await axios.post(
        "/auth/media-server-login",
        { username: formValues.JS_USERNAME, password: formValues.JS_PASSWORD },
        { headers: { "Content-Type": "application/json" } }
      );
      localStorage.setItem("token", response.data.token);
      localStorage.removeItem("config");
      window.dispatchEvent(new Event("jellyglance-config-updated"));
      await finishSetupNavigation();
    } catch (error) {
      setQuickConnectStatus("");
      setAuthError(
        error.response?.status === 401
          ? "Emby didn't accept that username and password."
          : error.response?.data?.errorMessage || `Error : ${error.response?.status || "Unknown"}`
      );
      setProcessing(false);
    }
  }

  async function finishQuickConnect(secret) {
    try {
      setProcessing(true);
      setQuickConnectStatus("Approved. Saving Jellyfin Quick Connect...");
      const response = await axios.post(
        "/auth/jellyfin-quick-connect/complete",
        { secret },
        {
          headers: {
            "Content-Type": "application/json",
          },
        }
      );

      localStorage.setItem("token", response.data.token);
      localStorage.removeItem("config");
      window.dispatchEvent(new Event("jellyglance-config-updated"));
      await finishSetupNavigation();
    } catch (error) {
      const errorMessage = error.response?.data?.errorMessage || `Error : ${error.response?.status || "Unknown"}`;
      setQuickConnectStatus("");
      setAuthError(errorMessage);
      setProcessing(false);
    }
  }

  // Jellyfin is not opened automatically: a page can only open a tab in front of
  // itself. The link below opens it, and Ctrl/Cmd or middle-click keeps it behind.
  async function startQuickConnect() {
    try {
      setProcessing(true);
      setQuickConnect(null);
      setCodeCopied(false);
      setAuthError("");
      setQuickConnectStatus("Requesting a code from Jellyfin...");
      const response = await axios.post("/auth/jellyfin-quick-connect/initiate");
      setQuickConnect(response.data);
      setCodeCopied(await copyQuickConnectCode(response.data.code));

      setQuickConnectStatus("");
      setProcessing(false);
    } catch (error) {
      const errorMessage =
        error.response?.data?.errorMessage ||
        (error.response?.status === 401 || error.response?.status === 403
          ? "Quick Connect is turned off in Jellyfin. Enable it in Dashboard → General, or use another sign-in method."
          : `Error : ${error.response?.status || "Unknown"}`);
      setQuickConnectStatus("");
      setAuthError(errorMessage);
      setProcessing(false);
    }
  }

  async function checkQuickConnectApproval() {
    if (!quickConnect?.secret) return;

    try {
      setQuickConnectStatus("Checking Jellyfin Quick Connect approval...");
      const response = await axios.post("/auth/jellyfin-quick-connect/status", {
        secret: quickConnect.secret,
      });

      if (response.data.authenticated) {
        await finishQuickConnect(quickConnect.secret);
        return;
      }

      setQuickConnectStatus("Not approved yet. Enter the code in Jellyfin and press Authorize.");
      setProcessing(false);
    } catch (error) {
      setQuickConnectStatus(error.response?.data?.errorMessage || "Still waiting for Jellyfin approval...");
      setProcessing(false);
    }
  }

  async function copyText(text, setCopied) {
    if (!text || !navigator.clipboard?.writeText) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be blocked on plain http; the value stays selectable.
    }
  }

  async function copyQuickConnectCode(code) {
    if (!code || !navigator.clipboard?.writeText) {
      return false;
    }

    try {
      await navigator.clipboard.writeText(code);
      return true;
    } catch (error) {
      console.log(error);
      return false;
    }
  }

  async function finishSetupNavigation() {
    try {
      const response = await axios.get("/auth/isConfigured");
      if (response.data?.state !== 2) {
        setAuthError("Unable to finish setup. Please try again.");
        setQuickConnectStatus("");
        setProcessing(false);
        return;
      }
    } catch (error) {
      setAuthError(error.response?.data?.errorMessage || "Unable to confirm setup state");
      setProcessing(false);
      return;
    }

    localStorage.setItem(FIRST_RUN_EXTRAS_KEY, "true");
    localStorage.removeItem("config");
    window.location.reload();
  }

  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const newConfig = await Config.getConfig(true);
        setConfig(newConfig);
      } catch (error) {
        if (error.code === "ERR_NETWORK") {
          console.log(error);
        }
      }
    };

    if (!config) {
      fetchConfig();
    }
  }, [config]);

  useEffect(() => {
    if (!quickConnect?.secret || processing) {
      return undefined;
    }

    const interval = window.setInterval(async () => {
      try {
        const response = await axios.post("/auth/jellyfin-quick-connect/status", {
          secret: quickConnect.secret,
        });

        if (response.data.authenticated) {
          window.clearInterval(interval);
          finishQuickConnect(quickConnect.secret);
        }
      } catch (error) {
        if (error.response?.data?.errorMessage) setQuickConnectStatus(error.response.data.errorMessage);
      }
    }, 3000);

    return () => window.clearInterval(interval);
  }, [quickConnect?.secret, processing]);

  if (!config) {
    return <Loading />;
  }

  const methods = [
    {
      id: "quick-connect",
      title: quickConnectLabel,
      detail: serverType === "emby" ? "Your Emby admin account" : "Approve with your Jellyfin admin",
      icon: <img src={serverType === "emby" ? embyLogo : jellyfinLogo} alt="" />,
      recommended: true,
    },
    { id: "oidc", title: "OIDC / SSO", detail: "Authentik, Authelia, Keycloak...", icon: <Key2LineIcon size={18} /> },
    { id: "local", title: "Local login", detail: "Username and password for JellyGlance", icon: <AdminLineIcon size={18} /> },
  ];

  const heading =
    authMode === "quick-connect" ? quickConnectLabel : authMode === "oidc" ? "OIDC provider" : "Local admin account";
  const subheading = embyLogin
    ? "Sign in with an Emby administrator account. Emby checks the password; JellyGlance doesn't store it."
    : authMode === "quick-connect"
      ? "Sign in through Jellyfin. Any Jellyfin administrator can approve it, and no extra password is created."
      : authMode === "oidc"
        ? "Admins sign in through your identity provider. JellyGlance checks the provider before saving."
        : "Create a username and password just for JellyGlance.";

  const submitLabel = processing
    ? authMode === "quick-connect" && !embyLogin && !quickConnect?.code
      ? "Requesting code..."
      : `${i18next.t("VALIDATING")}...`
    : embyLogin
      ? "Sign in with Emby"
      : authMode === "quick-connect"
        ? quickConnect?.code
          ? "I've approved it, continue"
          : "Start Quick Connect"
        : authMode === "oidc"
          ? "Test and save OIDC"
          : submitButtonText;

  const passwordToggle = (
    <Button
      className="login-show-password"
      type="button"
      aria-label={showPassword ? "Hide password" : "Show password"}
      onClick={() => setShowPassword(!showPassword)}
    >
      {showPassword ? <EyeFillIcon /> : <EyeOffFillIcon />}
    </Button>
  );

  return (
    <SetupShell
      step={2}
      eyebrow="Admin access"
      title="Choose admin authentication"
      description="Choose how admins sign in to JellyGlance."
      minimal
    >
      <section className="setup-stage-shell">
        <section className="setup-stage-form-card">
          <div className="setup-auth-options" role="radiogroup" aria-label="Admin sign-in method">
            {methods.map((method) => (
              <button
                key={method.id}
                type="button"
                role="radio"
                aria-checked={authMode === method.id}
                className={`setup-auth-option ${authMode === method.id ? "is-active" : ""}`}
                onClick={() => handleAuthModeChange(method.id)}
              >
                <span className="setup-auth-option-icon" aria-hidden="true">
                  {method.icon}
                </span>
                <span className="setup-auth-option-copy">
                  <strong>
                    {method.title}
                    {method.recommended ? <em className="setup-auth-badge">Recommended</em> : null}
                  </strong>
                  <small>{method.detail}</small>
                </span>
              </button>
            ))}
          </div>

          <Form onSubmit={handleFormSubmit} className="setup-form">
            <div className="setup-form-heading-block">
              <strong>{heading}</strong>
              <span>{subheading}</span>
            </div>

            {authMode === "quick-connect" && !embyLogin ? (
              quickConnect?.code ? (
                <div className="setup-qc">
                  <ol className="setup-qc-steps">
                    <li>
                      <span className="setup-qc-num">1</span>
                      <div>
                        <strong>Open Jellyfin and press Authorize</strong>
                        {quickConnect.quickConnectUrl ? (
                          <>
                            <a
                              className="setup-qc-open"
                              href={quickConnect.quickConnectUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              Open Jellyfin Quick Connect
                              <span aria-hidden="true">↗</span>
                            </a>
                            <small>
                              The code is filled in for you. {isMac ? "⌘" : "Ctrl"}-click or middle-click to open it
                              behind this tab.
                            </small>
                          </>
                        ) : (
                          <small>In Jellyfin, go to your profile → Quick Connect.</small>
                        )}
                      </div>
                    </li>
                    <li>
                      <span className="setup-qc-num">2</span>
                      <div>
                        <strong>Check Jellyfin shows this code</strong>
                        <div className="quick-connect-code-chip">
                          <span className="quick-connect-code">{quickConnect.code}</span>
                          <Button
                            type="button"
                            className="quick-connect-copy-button"
                            onClick={() => copyText(quickConnect.code, setCodeCopied)}
                          >
                            {codeCopied ? (
                              <>
                                <CheckLineIcon size={14} /> Copied
                              </>
                            ) : (
                              "Copy"
                            )}
                          </Button>
                        </div>
                      </div>
                    </li>
                    <li>
                      <span className="setup-qc-num">3</span>
                      <div>
                        <strong>Come back here</strong>
                        <small>This page continues by itself once Jellyfin approves the code.</small>
                      </div>
                    </li>
                  </ol>
                  <div className="setup-qc-footer">
                    <span className="quick-connect-waiting" role="status">
                      <span className="quick-connect-waiting-dot" aria-hidden="true" />
                      {quickConnectStatus || "Waiting for approval..."}
                    </span>
                    <button type="button" className="setup-link-button" onClick={startQuickConnect} disabled={processing}>
                      <RefreshLineIcon size={14} aria-hidden="true" /> New code
                    </button>
                  </div>
                </div>
              ) : (
                <div className="setup-qc-intro">
                  <p>
                    Press <strong>Start Quick Connect</strong> to get a 6-digit code, then open Jellyfin from the link
                    with the code already filled in and press Authorize.
                  </p>
                  <small>Quick Connect must be enabled in Jellyfin: Dashboard → General → Quick Connect.</small>
                  {quickConnectStatus ? <small className="quick-connect-status">{quickConnectStatus}</small> : null}
                </div>
              )
            ) : null}

            {(authMode === "local" || embyLogin) && (
              <>
                <Form.Group className="inputbox">
                  <Form.Label>
                    <Trans i18nKey={"USERNAME"} />
                  </Form.Label>
                  <Form.Control
                    id="JS_USERNAME"
                    name="JS_USERNAME"
                    value={formValues.JS_USERNAME || ""}
                    onChange={handleFormChange}
                    placeholder={embyLogin ? "Emby admin username" : "admin"}
                    autoComplete="username"
                    autoFocus
                    required
                  />
                </Form.Group>

                <Form.Group className="inputbox">
                  <Form.Label>
                    <Trans i18nKey={"PASSWORD"} />
                  </Form.Label>
                  <InputGroup>
                    <Form.Control
                      id="JS_PASSWORD"
                      name="JS_PASSWORD"
                      value={formValues.JS_PASSWORD || ""}
                      onChange={handleFormChange}
                      type={showPassword ? "text" : "password"}
                      placeholder=" "
                      autoComplete={embyLogin ? "current-password" : "new-password"}
                      required
                    />
                    {passwordToggle}
                  </InputGroup>
                </Form.Group>

                {authMode === "local" ? (
                  <Form.Group className="inputbox">
                    <Form.Label>Confirm password</Form.Label>
                    <Form.Control
                      id="JS_PASSWORD_CONFIRM"
                      name="JS_PASSWORD_CONFIRM"
                      value={formValues.JS_PASSWORD_CONFIRM || ""}
                      onChange={handleFormChange}
                      type={showPassword ? "text" : "password"}
                      placeholder=" "
                      autoComplete="new-password"
                      required
                    />
                    {formValues.JS_PASSWORD_CONFIRM && formValues.JS_PASSWORD_CONFIRM !== formValues.JS_PASSWORD ? (
                      <small className="setup-field-hint is-error">Doesn&apos;t match the password above.</small>
                    ) : null}
                  </Form.Group>
                ) : null}
              </>
            )}

            {authMode === "oidc" && (
              <>
                <div className="setup-redirect-box">
                  <div>
                    <strong>Add this redirect URI to your provider</strong>
                    <code>{formValues.OIDC_REDIRECT_URI || defaultRedirectUri}</code>
                  </div>
                  <Button
                    type="button"
                    className="quick-connect-copy-button"
                    onClick={() => copyText(formValues.OIDC_REDIRECT_URI || defaultRedirectUri, setRedirectCopied)}
                  >
                    {redirectCopied ? "Copied" : "Copy"}
                  </Button>
                </div>

                <Form.Group className="inputbox">
                  <Form.Label>Issuer URL</Form.Label>
                  <Form.Control
                    id="OIDC_ISSUER_URL"
                    name="OIDC_ISSUER_URL"
                    value={formValues.OIDC_ISSUER_URL || ""}
                    onChange={handleFormChange}
                    placeholder="https://auth.example.com/application/o/jellyglance/"
                    autoComplete="off"
                    spellCheck={false}
                    autoFocus
                    required
                  />
                  <small className="setup-field-hint">
                    The provider&apos;s base URL. JellyGlance reads /.well-known/openid-configuration from it.
                  </small>
                </Form.Group>

                <div className="setup-field-row">
                  <Form.Group className="inputbox">
                    <Form.Label>Client ID</Form.Label>
                    <Form.Control
                      id="OIDC_CLIENT_ID"
                      name="OIDC_CLIENT_ID"
                      value={formValues.OIDC_CLIENT_ID || ""}
                      onChange={handleFormChange}
                      placeholder=" "
                      autoComplete="off"
                      spellCheck={false}
                      required
                    />
                  </Form.Group>

                  <Form.Group className="inputbox">
                    <Form.Label>Client secret</Form.Label>
                    <InputGroup>
                      <Form.Control
                        id="OIDC_CLIENT_SECRET"
                        name="OIDC_CLIENT_SECRET"
                        value={formValues.OIDC_CLIENT_SECRET || ""}
                        onChange={handleFormChange}
                        type={showPassword ? "text" : "password"}
                        placeholder="Leave empty for public clients"
                        autoComplete="off"
                      />
                      {passwordToggle}
                    </InputGroup>
                  </Form.Group>
                </div>

                <details className="setup-advanced">
                  <summary>Advanced: custom redirect URI</summary>
                  <Form.Group className="inputbox">
                    <Form.Label>Redirect URI</Form.Label>
                    <Form.Control
                      id="OIDC_REDIRECT_URI"
                      name="OIDC_REDIRECT_URI"
                      value={formValues.OIDC_REDIRECT_URI || ""}
                      onChange={handleFormChange}
                      placeholder={defaultRedirectUri}
                      autoComplete="off"
                      spellCheck={false}
                    />
                    <small className="setup-field-hint">Only needed behind a reverse proxy that changes the public URL.</small>
                  </Form.Group>
                </details>
              </>
            )}

            {embyLogin && quickConnectStatus ? <div className="setup-connection-status">{quickConnectStatus}</div> : null}

            {authError ? (
              <div className="setup-connection-status is-error" role="alert">
                {authError}
              </div>
            ) : null}

            <Button type="submit" className={quickConnect?.code && authMode === "quick-connect" ? "setup-secondary-button" : "setup-button"} disabled={processing}>
              {processing ? <span className="setup-spinner setup-button-spinner" aria-hidden="true" /> : null}
              {submitLabel}
            </Button>
          </Form>
        </section>
      </section>
    </SetupShell>
  );
}

export default Signup;

import { useState, useEffect } from "react";
import axios from "../lib/axios_instance";
import Config from "../lib/config";
import baseUrl from "../lib/baseurl";
import "./css/setup.css";
import Form from "react-bootstrap/Form";
import Button from "react-bootstrap/Button";
import { InputGroup } from "react-bootstrap";

import EyeFillIcon from "remixicon-react/EyeFillIcon";
import EyeOffFillIcon from "remixicon-react/EyeOffFillIcon";
import logo_dark from "./images/icon-b-512.png";
import projectText from "./images/project-text.png";
import AuthArtworkBackground from "./components/AuthArtworkBackground";
import Loading from "./components/general/loading";
import { Trans } from "react-i18next";
import i18next from "i18next";
import { isOpsRole } from "../lib/pwa-manifest";
import { getStoredWorkspaceMode, workspaceHomePath } from "../lib/workspace-mode";

function Login() {
  const [config, setConfig] = useState(null);
  const [setupInfo, setSetupInfo] = useState(null);
  const [formValues, setFormValues] = useState({});
  const [showPassword, setShowPassword] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [submitButtonText, setsubmitButtonText] = useState(i18next.t("LOGIN"));
  const [quickConnect, setQuickConnect] = useState(null);
  const [quickConnectStatus, setQuickConnectStatus] = useState("");
  const [oidcStatus, setOidcStatus] = useState("");
  // Break-glass: local accounts still sign in when single sign-on is set up but broken.
  const [useLocalLogin, setUseLocalLogin] = useState(false);
  // Emby has no Quick Connect, so its "quick-connect" mode signs in with the Emby username and password.
  const embyServer = setupInfo?.serverType === "emby";
  const canQuickConnect = setupInfo?.auth?.mode === "quick-connect" && !embyServer;
  const canMediaPassword = setupInfo?.auth?.mode === "quick-connect" && embyServer;
  const oidcConfigured = setupInfo?.auth?.mode === "oidc";
  const canOidc = oidcConfigured && !useLocalLogin;
  const canUseQuickConnect = canQuickConnect || canOidc;

  function handleFormChange(event) {
    setFormValues({ ...formValues, [event.target.name]: event.target.value });
  }

  async function copyQuickConnectCode(code) {
    if (!code) {
      return false;
    }

    if (navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(code);
        return true;
      } catch {
        // Fall through to the selection based copy path below.
      }
    }

    const textarea = document.createElement("textarea");
    textarea.value = code;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.top = "0";
    textarea.style.left = "0";
    textarea.style.width = "1px";
    textarea.style.height = "1px";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    textarea.setSelectionRange(0, code.length);

    let copied;
    try {
      copied = document.execCommand("copy");
    } finally {
      document.body.removeChild(textarea);
    }

    return copied;
  }

  async function handleFormSubmit(event) {
    setProcessing(true);
    event.preventDefault();

    if (canQuickConnect) {
      startQuickConnect(true);
      return;
    }

    if (canOidc) {
      startOidcLogin();
      return;
    }

    if (canMediaPassword) {
      mediaServerLogin(formValues.JS_USERNAME, formValues.JS_PASSWORD);
      return;
    }

    beginLogin(formValues.JS_USERNAME, formValues.JS_PASSWORD);
  }

  function redirectAfterLogin(nextConfig) {
    const role = nextConfig?.settings?.auth?.role || "";
    const permissions = nextConfig?.settings?.auth?.permissions || {};
    const ops = isOpsRole(role);
    window.location.replace(workspaceHomePath(ops, getStoredWorkspaceMode(ops), permissions));
  }

  function startOidcLogin() {
    setProcessing(true);
    setOidcStatus("");
    window.location.href = `${baseUrl}/auth/oidc/login`.replace(/\/{2,}/g, "/");
  }

  async function mediaServerLogin(username, password) {
    try {
      setProcessing(true);
      setsubmitButtonText(i18next.t("LOGIN"));
      const response = await axios.post("/auth/media-server-login", { username, password }, { headers: { "Content-Type": "application/json" } });
      localStorage.setItem("token", response.data.token);
      localStorage.removeItem("jellyglance_logged_out");
      const nextConfig = await Config.setConfig();
      redirectAfterLogin(nextConfig);
    } catch (error) {
      setsubmitButtonText(error.response?.data?.errorMessage || `Error : ${error.response?.status || "Unknown"}`);
      setProcessing(false);
    }
  }

  async function finishQuickConnect(secret) {
    try {
      setProcessing(true);
      setQuickConnectStatus("Approved. Opening JellyGlance...");
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
      localStorage.removeItem("jellyglance_logged_out");
      const nextConfig = await Config.setConfig();
      redirectAfterLogin(nextConfig);
    } catch (error) {
      const errorMessage = error.response?.data?.errorMessage || `Error : ${error.response?.status || "Unknown"}`;
      setQuickConnectStatus(errorMessage);
      setProcessing(false);
    }
  }

  async function startQuickConnect(openJellyfin = false) {
    try {
      setQuickConnect(null);
      setQuickConnectStatus("Requesting a Jellyfin Quick Connect code...");
      const response = await axios.post("/auth/jellyfin-quick-connect/initiate");
      const copied = await copyQuickConnectCode(response.data.code);

      setQuickConnect(response.data);
      setQuickConnectStatus(
        copied
          ? "Code copied. Paste it into Jellyfin Quick Connect to approve this browser."
          : "Enter this code in Jellyfin Quick Connect to approve this browser."
      );

      if (openJellyfin && response.data.quickConnectUrl) {
        window.open(response.data.quickConnectUrl, "_blank", "noopener,noreferrer");
      }

      setProcessing(false);
    } catch (error) {
      const errorMessage = error.response?.data?.errorMessage || `Error : ${error.response?.status || "Unknown"}`;
      setQuickConnectStatus(errorMessage);
      setProcessing(false);
    }
  }

  async function beginLogin(JS_USERNAME, hashedPassword) {
    axios
      .post(
        "/auth/login",
        {
          username: JS_USERNAME,
          password: hashedPassword,
        },
        {
          headers: {
            "Content-Type": "application/json",
          },
        }
      )
      .then(async (response) => {
        localStorage.setItem("token", response.data.token);
        localStorage.removeItem("jellyglance_logged_out");
        setProcessing(false);
        if (JS_USERNAME || response.data.token) {
          const nextConfig = await Config.setConfig();
          setsubmitButtonText(i18next.t("SUCCESS"));
          redirectAfterLogin(nextConfig);
          return;
        }
      })
      .catch((error) => {
        let errorMessage = `Error : ${error.response?.status || "Unknown"}`;
        if (error.code === "ERR_NETWORK") {
          errorMessage = i18next.t("ERROR_MESSAGES.NETWORK_ERROR");
        } else if (error.response?.status === 401) {
          errorMessage = i18next.t("ERROR_MESSAGES.INVALID_LOGIN");
        } else if (error.response?.status === 404) {
          errorMessage = i18next.t("ERROR_MESSAGES.INVALID_URL").replace("{STATUS}", error.response.status);
        }
        if (JS_USERNAME) {
          setsubmitButtonText(errorMessage);
        }

        setProcessing(false);
      });
  }

  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const newConfig = await Config.setConfig();
        setConfig(newConfig);
      } catch (error) {
        if (error.code === "ERR_NETWORK") {
          if (error.response.status !== 401 && error.response.status !== 403) {
            // console.log(error);
          }
        }
      }
    };

    const fetchSetupInfo = async () => {
      try {
        const response = await axios.get("/auth/isConfigured");
        setSetupInfo(response.data);
        const oidcError = sessionStorage.getItem("jellyglance_oidc_error");
        if (oidcError) {
          setsubmitButtonText(oidcError);
          setOidcStatus(oidcError);
          sessionStorage.removeItem("jellyglance_oidc_error");
        }
        setConfig({});
      } catch (error) {
        console.log(error);
        setSetupInfo({ state: 2 });
        setConfig({});
      }
    };

    if (!config) {
      fetchSetupInfo();
      if (localStorage.getItem("token")) {
        fetchConfig();
      }
    }
  }, [config]);

  useEffect(() => {
    if (!canQuickConnect || quickConnect || processing || !setupInfo) {
      return undefined;
    }
    if (localStorage.getItem("token")) {
      return undefined;
    }
    if (sessionStorage.getItem("jg_qc_autostarted")) {
      return undefined;
    }
    sessionStorage.setItem("jg_qc_autostarted", "1");
    startQuickConnect(false);
    return undefined;
  }, [canQuickConnect, setupInfo]);

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
        setQuickConnectStatus(error.response?.data?.errorMessage || "Still waiting for Jellyfin approval...");
      }
    }, 5000);

    return () => window.clearInterval(interval);
  }, [quickConnect?.secret, processing]);

  if (!config || config.token) {
    return <Loading />;
  }

  return (
    <section className="auth-page">
      <AuthArtworkBackground />
      <div className="form-box d-flex flex-column">
        <div className="login-brand">
          <img src={logo_dark} className="login-logo" alt="" />
          <img src={projectText} className="login-wordmark" alt="JellyGlance" />
        </div>

        <Form onSubmit={handleFormSubmit} className="setup-form login-form">
          {canQuickConnect ? (
            <div className="setup-auth-summary quick-connect-intro">
              <strong>Jellyfin Quick Connect</strong>
              <small>Use Jellyfin Quick Connect to approve this browser with your Jellyfin admin account.</small>
              {!quickConnect?.code && quickConnectStatus && <small className="quick-connect-status">{quickConnectStatus}</small>}
            </div>
          ) : canOidc ? (
            <div className="setup-auth-summary quick-connect-intro">
              <strong>{setupInfo?.auth?.label || "OIDC / Authentik"}</strong>
              <small>Continue with your configured identity provider.</small>
              {oidcStatus && <small className="quick-connect-status">{oidcStatus}</small>}
              {!quickConnect?.code && !embyServer && (
                <Button
                  type="button"
                  className="quick-connect-refresh-button"
                  disabled={processing}
                  onClick={() => startQuickConnect(true)}
                >
                  Use Jellyfin Quick Connect
                </Button>
              )}
            </div>
          ) : (
            <>
              {canMediaPassword ? (
                <div className="setup-auth-summary quick-connect-intro">
                  <strong>{setupInfo?.auth?.label || "Emby login"}</strong>
                  <small>Sign in with your Emby username and password. JellyGlance checks it with your Emby server and does not store it.</small>
                </div>
              ) : null}
              <Form.Group className="inputbox">
                <Form.Label>
                  <Trans i18nKey={"USERNAME"} />
                </Form.Label>
                <Form.Control
                  id="JS_USERNAME"
                  name="JS_USERNAME"
                  value={formValues.JS_USERNAME || ""}
                  onChange={handleFormChange}
                  placeholder=" "
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
                  />
                  <Button className="login-show-password" type="button" onClick={() => setShowPassword(!showPassword)}>
                    {showPassword ? <EyeFillIcon /> : <EyeOffFillIcon />}
                  </Button>
                </InputGroup>
              </Form.Group>
            </>
          )}

          {canUseQuickConnect && quickConnect?.code ? (
            <>
              <Button type="button" className="setup-button quick-connect-open-button" disabled={processing} onClick={() => startQuickConnect(true)}>
                Open Jellyfin Quick Connect
              </Button>

              <div className="quick-connect-code-panel">
                <span className="quick-connect-code">{quickConnect.code}</span>
                <small>Enter this code in Jellyfin Quick Connect. JellyGlance will continue automatically.</small>
                {quickConnectStatus && <small className="quick-connect-status">{quickConnectStatus}</small>}
                <Button type="submit" className="quick-connect-refresh-button" disabled={processing}>
                  {processing ? `${i18next.t("VALIDATING")}...` : "Get New Code"}
                </Button>
              </div>
            </>
          ) : (
            <Button type="submit" className="setup-button">
              {processing
                ? `${i18next.t("VALIDATING")}...`
                : canQuickConnect
                  ? "Continue with Quick Connect"
                  : canOidc
                    ? `Continue with ${setupInfo?.auth?.label || "OIDC"}`
                  : submitButtonText}
            </Button>
          )}
          {oidcConfigured ? (
            <Button type="button" variant="link" className="login-local-toggle" onClick={() => setUseLocalLogin(!useLocalLogin)}>
              {useLocalLogin ? i18next.t("SETTINGS_PAGE.OIDC.USE_SSO") : i18next.t("SETTINGS_PAGE.OIDC.USE_LOCAL")}
            </Button>
          ) : null}
        </Form>
      </div>
    </section>
  );
}

export default Login;

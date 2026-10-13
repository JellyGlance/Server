import { useState } from "react";
import Alert from "react-bootstrap/Alert";
import Button from "react-bootstrap/Button";
import { useTranslation } from "react-i18next";
import axios from "../../../lib/axios_instance";

const PREFIX = "SETTINGS_PAGE.CONNECTION_TEST";
const STATUS_ICON = { pass: "✓", warn: "!", fail: "✕", skip: "–" };
const STATUS_VARIANT = { pass: "text-success", warn: "text-warning", fail: "text-danger", skip: "text-muted" };

// Admin-only live check of the saved media server connection.
export default function MediaServerConnectionTest({ token, hostUrl }) {
  const { t } = useTranslation();
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  async function runTest() {
    setRunning(true);
    setError("");
    setResult(null);
    try {
      const response = await axios.post(
        "/api/jellyfin/connection-test",
        {},
        { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } }
      );
      setResult(response.data);
    } catch (requestError) {
      setError(
        requestError?.response?.status === 403
          ? t(`${PREFIX}.ADMIN_ONLY`)
          : t(`${PREFIX}.COULD_NOT_RUN`, { message: requestError?.message || "" })
      );
    } finally {
      setRunning(false);
    }
  }

  const label = result?.serverLabel || "Jellyfin";

  return (
    <div className="settings-form integration-settings-form media-server-connection-test">
      <div className="d-flex flex-column flex-md-row justify-content-between align-items-md-center gap-2 mb-2">
        <div>
          <strong>{t(`${PREFIX}.TITLE`)}</strong>
          <div className="text-muted small">
            {t(`${PREFIX}.STORED_URL`)} <code>{result?.url || hostUrl || t(`${PREFIX}.NONE`)}</code>
          </div>
        </div>
        <Button variant="outline-primary" type="button" onClick={runTest} disabled={running}>
          {running ? t(`${PREFIX}.RUNNING`) : t(`${PREFIX}.RUN`)}
        </Button>
      </div>

      {error ? (
        <Alert bg="dark" data-bs-theme="dark" variant="danger">
          {error}
        </Alert>
      ) : null}

      {result ? (
        <>
          <Alert bg="dark" data-bs-theme="dark" variant={result.overall === "fail" ? "danger" : result.overall === "warn" ? "warning" : "success"}>
            {t(`${PREFIX}.OVERALL_${String(result.overall || "fail").toUpperCase()}`, { server: label })}
          </Alert>
          <ul className="list-unstyled mb-0">
            {result.checks.map((check) => {
              const params = { server: label, ...(check.details || {}) };
              const message = t(`${PREFIX}.${check.id.toUpperCase()}_${check.code}`, {
                ...params,
                defaultValue: t(`${PREFIX}.GENERIC_${check.code}`, { ...params, defaultValue: check.code }),
              });
              const hint = t(`${PREFIX}.HINT_${check.code}`, { ...params, defaultValue: "" });
              return (
                <li key={check.id} className="mb-2">
                  <span className={`me-2 fw-bold ${STATUS_VARIANT[check.status] || ""}`} aria-label={check.status}>
                    {STATUS_ICON[check.status] || "?"}
                  </span>
                  <strong>{t(`${PREFIX}.CHECK_${check.id.toUpperCase()}`)}:</strong> {message}
                  {hint && check.status !== "pass" ? <div className="text-muted small ms-4">{hint}</div> : null}
                </li>
              );
            })}
          </ul>
        </>
      ) : null}
    </div>
  );
}

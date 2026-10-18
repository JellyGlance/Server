import { useState } from "react";
import { useTranslation } from "react-i18next";
import CheckboxCircleFillIcon from "remixicon-react/CheckboxCircleFillIcon";
import CloseCircleFillIcon from "remixicon-react/CloseCircleFillIcon";
import ErrorWarningFillIcon from "remixicon-react/ErrorWarningFillIcon";
import IndeterminateCircleLineIcon from "remixicon-react/IndeterminateCircleLineIcon";
import Loader4LineIcon from "remixicon-react/Loader4LineIcon";
import PulseLineIcon from "remixicon-react/PulseLineIcon";
import axios from "../../../lib/axios_instance";

export const CONNECTION_TEST_PREFIX = "SETTINGS_PAGE.CONNECTION_TEST";
const PREFIX = CONNECTION_TEST_PREFIX;
const STATUS_ICON = {
  pass: CheckboxCircleFillIcon,
  warn: ErrorWarningFillIcon,
  fail: CloseCircleFillIcon,
  skip: IndeterminateCircleLineIcon,
};

function normaliseUrl(value) {
  return String(value || "")
    .trim()
    .replace(/\/+$/, "");
}

// Runs the admin-only live check of the saved media server connection.
export function useConnectionTest(token) {
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

  return { running, result, error, runTest };
}

// Shows the status of each connection check next to the form.
export default function MediaServerConnectionTest({ running, result, error, hostUrl, formUrl }) {
  const { t } = useTranslation();
  const label = result?.serverLabel || "Jellyfin";
  const testedUrl = result?.url || hostUrl;
  const showTestedUrl = Boolean(testedUrl) && normaliseUrl(testedUrl) !== normaliseUrl(formUrl);

  let state = "idle";
  if (running) state = "running";
  else if (error) state = "fail";
  else if (result) state = ["pass", "warn", "fail"].includes(result.overall) ? result.overall : "fail";

  let summary = t(`${PREFIX}.UNTESTED`);
  if (state === "running") summary = t(`${PREFIX}.RUNNING_SUMMARY`, { server: label });
  else if (error) summary = error;
  else if (result) summary = t(`${PREFIX}.OVERALL_${state.toUpperCase()}`, { server: label });

  const SummaryIcon = state === "running" ? Loader4LineIcon : state === "idle" ? PulseLineIcon : STATUS_ICON[state];

  return (
    <div className="jf-connection-results" aria-live="polite" aria-busy={running}>
      <div className="jf-connection-results-head">
        <strong>{t(`${PREFIX}.RESULTS_TITLE`)}</strong>
        <span>{t(`${PREFIX}.TESTS_SAVED`)}</span>
      </div>

      <div className={`jf-connection-summary is-${state}`} role="status">
        <SummaryIcon className={state === "running" ? "jf-spin" : ""} aria-hidden="true" />
        <span>{summary}</span>
      </div>

      {showTestedUrl ? (
        <div className="jf-connection-tested-url">
          {t(`${PREFIX}.STORED_URL`)} <code>{testedUrl}</code>
        </div>
      ) : null}

      {result?.checks?.length ? (
        <ul className="jf-connection-checks">
          {result.checks.map((check) => {
            const params = { server: label, ...(check.details || {}) };
            const message = t(`${PREFIX}.${check.id.toUpperCase()}_${check.code}`, {
              ...params,
              defaultValue: t(`${PREFIX}.GENERIC_${check.code}`, { ...params, defaultValue: check.code }),
            });
            const hint = t(`${PREFIX}.HINT_${check.code}`, { ...params, defaultValue: "" });
            const status = STATUS_ICON[check.status] ? check.status : "fail";
            const Icon = STATUS_ICON[status];
            return (
              <li key={check.id} className={`jf-connection-check is-${status}`}>
                <Icon className="jf-connection-check-icon" aria-hidden="true" />
                <div>
                  <div className="jf-connection-check-line">
                    <strong>{t(`${PREFIX}.CHECK_${check.id.toUpperCase()}`)}</strong>
                    <span className="jf-connection-check-badge">{t(`${PREFIX}.STATUS_${status.toUpperCase()}`)}</span>
                  </div>
                  <div className="jf-connection-check-message">{message}</div>
                  {hint && status !== "pass" ? <div className="jf-connection-check-hint">{hint}</div> : null}
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

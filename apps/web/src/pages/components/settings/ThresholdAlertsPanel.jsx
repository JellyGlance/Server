import { useEffect, useState } from "react";
import AlarmWarningLineIcon from "remixicon-react/AlarmWarningLineIcon";
import { useTranslation } from "react-i18next";
import axios from "../../../lib/axios_instance";

const AR = "ALERT_RULES";

function authHeader() {
  return { Authorization: `Bearer ${localStorage.getItem("token")}` };
}

function isAdmin() {
  try {
    const role = JSON.parse(localStorage.getItem("config") || "{}")?.settings?.auth?.role;
    return role === "Owner" || role === "Admin";
  } catch {
    return false;
  }
}

const CHECKS = [
  { key: "stuckDownloads", title: "Stuck downloads", text: "A download has made no progress for a while." },
  { key: "lowDisk", title: "Low disk space", text: "A Sonarr, Radarr or Lidarr disk drops below the free-space limit." },
  { key: "failedJobs", title: "Failed server jobs", text: "A Jellyfin scheduled task fails or is aborted." },
  { key: "newDevices", title: "New devices", text: "Someone plays something on a device that hasn't been seen before." },
];

const PRESETS = [
  { name: "Late-night streaming", metric: "active_streams", op: "gt", value: 0, from: 1, to: 5, severity: "info" },
  { name: "Transcode spike", metric: "transcodes", op: "gte", value: 3, from: null, to: null, severity: "warning" },
  { name: "Account sharing", metric: "user_streams", op: "gte", value: 3, from: null, to: null, severity: "warning" },
  { name: "Bandwidth spike", metric: "bandwidth_mbps", op: "gt", value: 100, from: null, to: null, severity: "warning" },
  { name: "Media server down", trigger: "server_down", severity: "critical", cooldownMinutes: 15 },
  { name: "New user", trigger: "new_user", severity: "info", cooldownMinutes: 0 },
];

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

function newRule(preset = {}) {
  return {
    id: `rule-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    name: "",
    enabled: true,
    metric: "active_streams",
    op: "gt",
    value: 0,
    from: null,
    to: null,
    severity: "warning",
    trigger: "metric",
    cooldownMinutes: 60,
    actions: [],
    ...preset,
  };
}

function newAction(type = "discord") {
  return { id: `action-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, type, url: "", token: "" };
}

function RuleActions({ rule, catalog, onChange }) {
  const { t } = useTranslation();
  const actions = rule.actions || [];
  const max = catalog?.maxActions || 5;
  const types = catalog?.actions || [];
  const edit = (id, patch) => onChange(actions.map((action) => (action.id === id ? { ...action, ...patch } : action)));
  return (
    <div className="threshold-rule-actions">
      {actions.map((action) => {
        const type = types.find((item) => item.id === action.type);
        return (
          <div key={action.id} className="threshold-rule-action">
            <select value={action.type} aria-label={t(`${AR}.ACTION_TYPE`)} onChange={(event) => edit(action.id, { type: event.target.value })}>
              {types.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
            <input
              type="url"
              className="threshold-rule-action-url"
              placeholder={action.hasUrl ? t(`${AR}.URL_SAVED`, { hint: action.urlHint || "" }) : t(`${AR}.URL_PLACEHOLDER_${action.type.toUpperCase()}`)}
              value={action.url || ""}
              autoComplete="off"
              onChange={(event) => edit(action.id, { url: event.target.value })}
            />
            {type?.needsToken || action.type === "webhook" ? (
              <input
                type="password"
                className="threshold-rule-action-token"
                placeholder={action.hasToken ? t(`${AR}.TOKEN_SAVED`) : t(type?.needsToken ? `${AR}.TOKEN_REQUIRED` : `${AR}.TOKEN_OPTIONAL`)}
                value={action.token || ""}
                autoComplete="off"
                onChange={(event) => edit(action.id, { token: event.target.value })}
              />
            ) : null}
            <button type="button" className="threshold-rule-remove" aria-label={t(`${AR}.REMOVE_ACTION`)} onClick={() => onChange(actions.filter((item) => item.id !== action.id))}>
              ×
            </button>
          </div>
        );
      })}
      {actions.length < max ? (
        <button type="button" className="threshold-rule-action-add" onClick={() => onChange([...actions, newAction()])}>
          + {t(`${AR}.ADD_ACTION`)}
        </button>
      ) : null}
      {!actions.length ? <small className="threshold-rule-hint">{t(`${AR}.NO_ACTIONS`)}</small> : null}
    </div>
  );
}

function CustomRules({ rules, catalog, lastFired, log, onChange, onTest }) {
  const { t } = useTranslation();
  const [testing, setTesting] = useState("");
  const [testResults, setTestResults] = useState({});
  const [openHistory, setOpenHistory] = useState("");
  const units = Object.fromEntries((catalog?.metrics || []).map((metric) => [metric.id, metric.unit]));
  const events = catalog?.events || [];
  const max = catalog?.maxRules || 25;
  const edit = (id, patch) => onChange(rules.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule)));
  const remove = (id) => onChange(rules.filter((rule) => rule.id !== id));
  const add = (preset) => rules.length < max && onChange([...rules, newRule(preset)]);

  async function test(rule) {
    setTesting(rule.id);
    setTestResults((current) => ({ ...current, [rule.id]: null }));
    const results = await onTest(rule);
    setTestResults((current) => ({ ...current, [rule.id]: results }));
    setTesting("");
  }

  return (
    <div className="threshold-rules">
      <h4>Custom rules</h4>
      <p className="threshold-alerts-copy">{t(`${AR}.INTRO`)}</p>
      {rules.map((rule) => {
        const trigger = rule.trigger || "metric";
        const event = events.find((item) => item.id === trigger);
        const history = (log || []).filter((entry) => entry.ruleId === rule.id);
        const results = testResults[rule.id];
        return (
          <div key={rule.id} className={`threshold-rule${rule.enabled ? "" : " is-disabled"}`}>
            <div className="threshold-rule-line">
              <label className="threshold-rule-toggle" title={rule.enabled ? t(`${AR}.RULE_ON`) : t(`${AR}.RULE_OFF`)}>
                <input type="checkbox" checked={rule.enabled} onChange={(e) => edit(rule.id, { enabled: e.target.checked })} />
              </label>
              <input className="threshold-rule-name" placeholder="Rule name" maxLength={80} value={rule.name} onChange={(e) => edit(rule.id, { name: e.target.value })} />
              <button type="button" className="threshold-rule-remove" aria-label="Remove rule" onClick={() => remove(rule.id)}>
                ×
              </button>
            </div>
            <div className="threshold-rule-line">
              <span>{t(`${AR}.WHEN`)}</span>
              <select value={trigger === "metric" ? `metric:${rule.metric}` : trigger} aria-label={t(`${AR}.TRIGGER`)} onChange={(e) => {
                const value = e.target.value;
                edit(rule.id, value.startsWith("metric:") ? { trigger: "metric", metric: value.slice(7) } : { trigger: value, value: value === "new_items" ? Math.max(1, Number(rule.value) || 1) : rule.value });
              }}>
                <optgroup label={t(`${AR}.GROUP_METRICS`)}>
                  {(catalog?.metrics || []).map((metric) => (
                    <option key={metric.id} value={`metric:${metric.id}`}>
                      {metric.label}
                    </option>
                  ))}
                </optgroup>
                <optgroup label={t(`${AR}.GROUP_EVENTS`)}>
                  {events.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </optgroup>
              </select>
              {trigger === "metric" ? (
                <>
                  <span>is</span>
                  <select value={rule.op} onChange={(e) => edit(rule.id, { op: e.target.value })}>
                    {(catalog?.operators || []).map((op) => (
                      <option key={op.id} value={op.id}>
                        {op.label}
                      </option>
                    ))}
                  </select>
                  <input type="number" min="0" step="any" value={rule.value} onChange={(e) => edit(rule.id, { value: e.target.value })} />
                  <span>{units[rule.metric] || ""}</span>
                </>
              ) : event?.threshold ? (
                <>
                  <span>{t(`${AR}.AT_LEAST`)}</span>
                  <input type="number" min="1" step="1" value={rule.value} onChange={(e) => edit(rule.id, { value: e.target.value })} />
                  <span>{event.unit}</span>
                </>
              ) : null}
              <select
                value={rule.from === null ? "" : rule.from}
                aria-label="Active from"
                onChange={(e) => edit(rule.id, e.target.value === "" ? { from: null, to: null } : { from: Number(e.target.value), to: rule.to ?? (Number(e.target.value) + 1) % 24 })}
              >
                <option value="">any time</option>
                {HOURS.map((hour) => (
                  <option key={hour} value={hour}>
                    from {String(hour).padStart(2, "0")}:00
                  </option>
                ))}
              </select>
              {rule.from !== null ? (
                <select value={rule.to ?? ""} aria-label="Active until" onChange={(e) => edit(rule.id, { to: Number(e.target.value) })}>
                  {HOURS.filter((hour) => hour !== rule.from).map((hour) => (
                    <option key={hour} value={hour}>
                      to {String(hour).padStart(2, "0")}:00
                    </option>
                  ))}
                </select>
              ) : null}
              <select value={rule.severity} aria-label="Severity" onChange={(e) => edit(rule.id, { severity: e.target.value })}>
                <option value="info">Info</option>
                <option value="warning">Warning</option>
                <option value="critical">Critical</option>
              </select>
              <label className="threshold-rule-cooldown">
                {t(`${AR}.COOLDOWN`)}
                <input type="number" min="0" max="10080" value={rule.cooldownMinutes ?? 60} onChange={(e) => edit(rule.id, { cooldownMinutes: e.target.value })} />
                {t(`${AR}.MINUTES`)}
              </label>
            </div>
            <RuleActions rule={rule} catalog={catalog} onChange={(actions) => edit(rule.id, { actions })} />
            <div className="threshold-rule-footer">
              <button type="button" className="threshold-rule-test" disabled={testing === rule.id} onClick={() => test(rule)}>
                {testing === rule.id ? t(`${AR}.TESTING`) : t(`${AR}.SEND_TEST`)}
              </button>
              <small>{lastFired?.[rule.id] ? t(`${AR}.LAST_FIRED`, { when: timeAgo(lastFired[rule.id]) }) : t(`${AR}.NEVER_FIRED`)}</small>
              {history.length ? (
                <button type="button" className="threshold-rule-history-toggle" onClick={() => setOpenHistory(openHistory === rule.id ? "" : rule.id)}>
                  {t(`${AR}.HISTORY`, { count: history.length })}
                </button>
              ) : null}
              {results ? (
                <span className="threshold-rule-results">
                  {results.length
                    ? results.map((result) => (
                        <span key={result.id} className={result.ok ? "is-ok" : "is-failed"}>
                          {result.type}: {result.ok ? t(`${AR}.DELIVERED`) : result.error}
                        </span>
                      ))
                    : t(`${AR}.TEST_NO_ACTIONS`)}
                </span>
              ) : null}
            </div>
            {openHistory === rule.id ? (
              <div className="threshold-rule-history">
                {history.slice(0, 10).map((entry, index) => (
                  <div key={`${entry.at}-${index}`} className={`threshold-alerts-log-row is-${entry.severity || "warning"}`}>
                    <strong>{entry.title}</strong>
                    <span>
                      {entry.message}
                      {entry.delivery?.length ? ` · ${entry.delivery.map((d) => `${d.type} ${d.ok ? "✓" : `✕ ${d.error || ""}`}`).join(", ")}` : ""}
                    </span>
                    <small>{timeAgo(entry.at)}</small>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
      <div className="threshold-rule-add">
        <button type="button" disabled={rules.length >= max} onClick={() => add()}>
          Add rule
        </button>
        {PRESETS.map((preset) => (
          <button key={preset.name} type="button" disabled={rules.length >= max} onClick={() => add(preset)}>
            + {preset.name}
          </button>
        ))}
      </div>
    </div>
  );
}

function timeAgo(value) {
  const minutes = Math.round((Date.now() - new Date(value).getTime()) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.round(minutes / 60)}h ago`;
  return `${Math.round(minutes / 1440)}d ago`;
}

export default function ThresholdAlertsPanel() {
  const [settings, setSettings] = useState(null);
  const [catalog, setCatalog] = useState(null);
  const [log, setLog] = useState([]);
  const [lastFired, setLastFired] = useState({});
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const admin = isAdmin();

  function load() {
    axios
      .get("/alerts-data/settings", { headers: authHeader() })
      .then((response) => {
        setSettings(response.data.settings);
        setCatalog(response.data.catalog || null);
        setLog(response.data.log || []);
        setLastFired(response.data.lastFired || {});
      })
      .catch((error) => setMessage(error.response?.data?.error || "Unable to load alert settings."));
  }

  useEffect(() => {
    if (admin) load();
  }, [admin]);

  if (!admin) return null;

  async function testRule(rule) {
    try {
      const response = await axios.post("/alerts-data/rules/test", { rule }, { headers: authHeader() });
      load();
      return response.data.results || [];
    } catch (error) {
      return [{ id: "error", type: "test", ok: false, error: error.response?.data?.error || "That didn't work." }];
    }
  }

  function update(patch) {
    setSettings((current) => ({ ...current, ...patch }));
  }

  async function run(action) {
    setBusy(true);
    setMessage("");
    try {
      if (action === "save") {
        const response = await axios.put("/alerts-data/settings", settings, { headers: authHeader() });
        setSettings(response.data.settings);
        setMessage("Alert settings saved.");
      } else if (action === "test") {
        await axios.post("/alerts-data/test", {}, { headers: authHeader() });
        setMessage("Test alert sent to your webhooks and this browser.");
        load();
      } else {
        const response = await axios.post("/alerts-data/run", {}, { headers: authHeader() });
        setMessage(response.data.sent ? `Checked now and sent ${response.data.sent} alert${response.data.sent === 1 ? "" : "s"}.` : "Checked now. Nothing needs attention.");
        load();
      }
    } catch (error) {
      setMessage(error.response?.data?.error || "That didn't work.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="notification-panel threshold-alerts">
      <div className="notification-panel-title">
        <AlarmWarningLineIcon size={18} />
        <h3>Threshold alerts</h3>
      </div>
      <p className="threshold-alerts-copy">
        JellyGlance checks these every 5 minutes. Alerts appear here for admins and go to any webhook subscribed to the <strong>Threshold alert</strong> event. Add your own rules below for anything else you want to watch.
      </p>
      {!settings ? (
        <p className="threshold-alerts-copy">{message || "Loading…"}</p>
      ) : (
        <>
          <label className="threshold-alerts-master">
            <input type="checkbox" checked={settings.enabled} onChange={(event) => update({ enabled: event.target.checked })} />
            <span>Alerts are {settings.enabled ? "on" : "off"}</span>
          </label>
          <div className={`threshold-alerts-grid${settings.enabled ? "" : " is-disabled"}`}>
            {CHECKS.map((check) => (
              <div key={check.key} className="threshold-alerts-item">
                <label>
                  <input type="checkbox" checked={settings[check.key]} onChange={(event) => update({ [check.key]: event.target.checked })} />
                  <span>
                    <strong>{check.title}</strong>
                    <small>{check.text}</small>
                  </span>
                </label>
                {check.key === "stuckDownloads" ? (
                  <div className="threshold-alerts-limit">
                    Stuck for
                    <input type="number" min="10" max="1440" value={settings.stuckMinutes} onChange={(event) => update({ stuckMinutes: event.target.value })} />
                    minutes
                  </div>
                ) : null}
                {check.key === "lowDisk" ? (
                  <div className="threshold-alerts-limit">
                    Below
                    <input type="number" min="1" max="50" value={settings.lowDiskPercent} onChange={(event) => update({ lowDiskPercent: event.target.value })} />% free
                  </div>
                ) : null}
              </div>
            ))}
          </div>
          <div className={`threshold-rules-wrap${settings.enabled ? "" : " is-disabled"}`}>
            <CustomRules
              rules={settings.customRules || []}
              catalog={catalog}
              lastFired={lastFired}
              log={log}
              onTest={testRule}
              onChange={(customRules) => update({ customRules })}
            />
          </div>
          <div className="threshold-alerts-actions">
            <button type="button" className="is-primary" disabled={busy} onClick={() => run("save")}>
              Save alerts
            </button>
            <button type="button" disabled={busy} onClick={() => run("check")}>
              Check now
            </button>
            <button type="button" disabled={busy} onClick={() => run("test")}>
              Send test
            </button>
            {message ? <em>{message}</em> : null}
          </div>
          {log.length ? (
            <div className="threshold-alerts-log">
              <h4>Recent alerts</h4>
              {log.slice(0, 10).map((entry, index) => (
                <div key={`${entry.at}-${index}`} className={`threshold-alerts-log-row is-${entry.severity || "warning"}`}>
                  <strong>{entry.title}</strong>
                  <span>{entry.message}</span>
                  <small>{timeAgo(entry.at)}</small>
                </div>
              ))}
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

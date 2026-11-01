import { useEffect, useState } from "react";
import SendPlaneLineIcon from "remixicon-react/SendPlaneLineIcon";
import axios from "../../../lib/axios_instance";

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

const PRESETS = [
  { label: "Stuck download → Home Assistant", trigger: "download_stuck", format: "homeassistant", name: "Stuck download to HA" },
  { label: "Cleanuparr → ntfy", trigger: "cleanuparr_intervention", format: "ntfy", name: "Cleanuparr to ntfy" },
  { label: "Low disk → Discord", trigger: "disk_low", format: "discord", name: "Low disk to Discord", cooldownMinutes: 60 },
  { label: "Playback started → Home Assistant", trigger: "playback_started", format: "homeassistant", name: "Playback to HA" },
];

const URL_PLACEHOLDER = {
  homeassistant: "https://homeassistant.local:8123/api/webhook/jellyglance",
  ntfy: "https://ntfy.sh/your-topic",
  discord: "https://discord.com/api/webhooks/…",
  json: "https://example.com/hook",
};

function newRule(preset = {}) {
  return {
    id: `hook-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    name: "",
    enabled: true,
    trigger: "download_stuck",
    format: "json",
    url: "",
    urlHint: "",
    hasUrl: false,
    headers: [],
    bodyTemplate: "",
    filterField: "message",
    filterText: "",
    cooldownMinutes: 0,
    ...preset,
  };
}

function timeAgo(value) {
  const minutes = Math.round((Date.now() - new Date(value).getTime()) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.round(minutes / 60)}h ago`;
  return `${Math.round(minutes / 1440)}d ago`;
}

function RuleEditor({ rule, catalog, onChange, onRemove, onTest, testing, lastResult }) {
  const [showAdvanced, setShowAdvanced] = useState(Boolean(rule.bodyTemplate || rule.headers?.length || rule.filterText));
  const [preview, setPreview] = useState("");
  const edit = (patch) => onChange({ ...rule, ...patch });
  const headers = rule.headers || [];
  const editHeader = (index, patch) => edit({ headers: headers.map((row, i) => (i === index ? { ...row, ...patch } : row)) });

  async function loadPreview() {
    try {
      const response = await axios.post("/webhook-out-data/preview", { rule: { ...rule, headers: [] } }, { headers: authHeader() });
      setPreview(JSON.stringify(response.data.body, null, 2));
    } catch (error) {
      setPreview(error.response?.data?.error || "Unable to build a preview.");
    }
  }

  return (
    <div className={`threshold-rule webhook-out-rule${rule.enabled ? "" : " is-disabled"}`}>
      <div className="threshold-rule-line">
        <label className="threshold-rule-toggle" title={rule.enabled ? "Enabled" : "Disabled"}>
          <input type="checkbox" checked={rule.enabled} onChange={(event) => edit({ enabled: event.target.checked })} />
        </label>
        <input className="threshold-rule-name" placeholder="Rule name" value={rule.name} onChange={(event) => edit({ name: event.target.value })} />
        <span>When</span>
        <select aria-label="Trigger" value={rule.trigger} onChange={(event) => edit({ trigger: event.target.value })}>
          {(catalog?.triggers || []).map((item) => (
            <option key={item.id} value={item.id}>{item.label}</option>
          ))}
        </select>
        <span>send</span>
        <select aria-label="Format" value={rule.format} onChange={(event) => edit({ format: event.target.value })}>
          {(catalog?.formats || []).map((item) => (
            <option key={item.id} value={item.id}>{item.label}</option>
          ))}
        </select>
        <button type="button" className="threshold-rule-remove" aria-label="Remove rule" onClick={onRemove}>×</button>
      </div>
      <div className="threshold-rule-actions">
        <div className="threshold-rule-action">
          <input
            className="threshold-rule-action-url"
            type="password"
            autoComplete="off"
            aria-label="Destination URL"
            placeholder={rule.hasUrl ? `Saved: ${rule.urlHint} (leave blank to keep)` : URL_PLACEHOLDER[rule.format] || URL_PLACEHOLDER.json}
            value={rule.url}
            onChange={(event) => edit({ url: event.target.value })}
          />
          <span className="threshold-rule-cooldown">
            at most every
            <input type="number" min="0" max="1440" value={rule.cooldownMinutes} onChange={(event) => edit({ cooldownMinutes: event.target.value })} />
            min
          </span>
        </div>
      </div>
      <div className="threshold-rule-footer">
        <button type="button" className="threshold-rule-test" disabled={testing || (!rule.url && !rule.hasUrl)} onClick={onTest}>
          {testing ? "Sending…" : "Send test"}
        </button>
        <button type="button" className="threshold-rule-history-toggle" onClick={() => setShowAdvanced((value) => !value)}>
          {showAdvanced ? "Hide options" : "Filter, headers & body"}
        </button>
        <button type="button" className="threshold-rule-history-toggle" onClick={loadPreview}>Preview payload</button>
        {lastResult ? (
          <span className="threshold-rule-results">
            <span className={lastResult.ok ? "is-ok" : "is-failed"}>
              {lastResult.ok ? `Delivered (HTTP ${lastResult.status})` : `Failed: ${lastResult.error}`}
            </span>
          </span>
        ) : null}
      </div>
      {showAdvanced ? (
        <div className="threshold-rule-actions webhook-out-advanced">
          <div className="threshold-rule-action">
            <span>Only if</span>
            <select aria-label="Filter field" value={rule.filterField || "message"} onChange={(event) => edit({ filterField: event.target.value })}>
              {(catalog?.fields || []).map((field) => (
                <option key={field} value={field}>{field}</option>
              ))}
            </select>
            <span>contains</span>
            <input placeholder="any text (optional)" value={rule.filterText} onChange={(event) => edit({ filterText: event.target.value })} />
          </div>
          {headers.map((row, index) => (
            <div key={index} className="threshold-rule-action">
              <input placeholder="Header" value={row.name} onChange={(event) => editHeader(index, { name: event.target.value })} />
              <input
                className="threshold-rule-action-token"
                type="password"
                autoComplete="off"
                placeholder={row.hasValue ? "Saved (leave blank to keep)" : "Value, e.g. Bearer …"}
                value={row.value}
                onChange={(event) => editHeader(index, { value: event.target.value })}
              />
              <button type="button" className="threshold-rule-remove" aria-label="Remove header" onClick={() => edit({ headers: headers.filter((_, i) => i !== index) })}>×</button>
            </div>
          ))}
          {headers.length < 10 ? (
            <button type="button" className="threshold-rule-action-add" onClick={() => edit({ headers: [...headers, { name: "", value: "" }] })}>+ Header</button>
          ) : null}
          <textarea
            className="webhook-out-template"
            rows={5}
            spellCheck={false}
            placeholder={'Custom JSON body (optional). Leave blank for the built-in format.\n{"text": "{{title}}: {{message}}", "severity": "{{severity}}"}'}
            value={rule.bodyTemplate}
            onChange={(event) => edit({ bodyTemplate: event.target.value })}
          />
          <small className="threshold-rule-hint">
            Placeholders: {"{{title}} {{message}} {{severity}} {{trigger}} {{event}} {{alertType}} {{user}} {{item}} {{series}} {{device}} {{at}}"} and {"{{data.<field>}}"} for raw event fields.
          </small>
        </div>
      ) : null}
      {preview ? <pre className="webhook-out-preview">{preview}</pre> : null}
    </div>
  );
}

export default function WebhookOutPanel() {
  const [rules, setRules] = useState(null);
  const [catalog, setCatalog] = useState(null);
  const [log, setLog] = useState([]);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState("");
  const [results, setResults] = useState({});
  const [message, setMessage] = useState("");
  const admin = isAdmin();

  async function load() {
    try {
      const response = await axios.get("/webhook-out-data/rules", { headers: authHeader() });
      setRules(response.data.rules || []);
      setCatalog(response.data.catalog);
      setLog(response.data.log || []);
    } catch (error) {
      setMessage(error.response?.data?.error || "Unable to load outbound webhooks.");
    }
  }

  useEffect(() => {
    if (admin) load();
  }, [admin]);

  if (!admin) return null;

  async function save() {
    setBusy(true);
    setMessage("");
    try {
      const response = await axios.put("/webhook-out-data/rules", { rules }, { headers: authHeader() });
      setRules(response.data.rules);
      setMessage("Outbound webhooks saved.");
    } catch (error) {
      setMessage(error.response?.data?.error || "Unable to save.");
    } finally {
      setBusy(false);
    }
  }

  async function test(rule) {
    setTesting(rule.id);
    try {
      const response = await axios.post(`/webhook-out-data/rules/${encodeURIComponent(rule.id)}/test`, { rule }, { headers: authHeader() });
      setResults((current) => ({ ...current, [rule.id]: response.data.result }));
      const fresh = await axios.get("/webhook-out-data/log", { headers: authHeader() });
      setLog(fresh.data.log || []);
    } catch (error) {
      setResults((current) => ({ ...current, [rule.id]: { ok: false, error: error.response?.data?.error || error.message } }));
    } finally {
      setTesting("");
    }
  }

  const max = catalog?.maxRules || 25;

  return (
    <section className="notification-panel threshold-alerts webhook-out">
      <div className="notification-panel-title">
        <SendPlaneLineIcon size={18} />
        <h3>Outbound webhook rules</h3>
      </div>
      <p className="threshold-alerts-copy">
        When something happens in JellyGlance, POST it as JSON to Home Assistant, ntfy, Discord or any URL. URLs and header values are stored encrypted and never shown again after saving.
      </p>
      {!rules ? (
        <p className="threshold-alerts-copy">{message || "Loading…"}</p>
      ) : (
        <>
          <div className="threshold-rules">
            {rules.length ? null : <p className="threshold-alerts-copy">No rules yet. Start from a preset or add a blank rule.</p>}
            {rules.map((rule) => (
              <RuleEditor
                key={rule.id}
                rule={rule}
                catalog={catalog}
                testing={testing === rule.id}
                lastResult={results[rule.id]}
                onTest={() => test(rule)}
                onRemove={() => setRules(rules.filter((item) => item.id !== rule.id))}
                onChange={(next) => setRules(rules.map((item) => (item.id === rule.id ? next : item)))}
              />
            ))}
            <div className="threshold-rule-add">
              <button type="button" disabled={rules.length >= max} onClick={() => setRules([...rules, newRule()])}>+ Blank rule</button>
              {PRESETS.map((preset) => (
                <button key={preset.label} type="button" disabled={rules.length >= max} onClick={() => setRules([...rules, newRule(preset)])}>
                  + {preset.label}
                </button>
              ))}
            </div>
          </div>
          <div className="threshold-alerts-actions">
            <button type="button" className="is-primary" disabled={busy} onClick={save}>Save webhook rules</button>
            {message ? <em>{message}</em> : null}
          </div>
          <div className="threshold-alerts-log">
            <h4>Recent deliveries</h4>
            {log.length ? (
              log.slice(0, 15).map((entry) => (
                <div key={entry.id} className={`threshold-alerts-log-row ${entry.ok ? "is-info" : "is-critical"}`}>
                  <strong>{entry.ruleName}{entry.test ? " (test)" : ""}</strong>
                  <span>
                    {entry.ok ? `HTTP ${entry.status} in ${entry.ms} ms` : entry.error}
                    {entry.title ? ` · ${entry.title}` : ""}
                  </span>
                  <small>{timeAgo(entry.at)}</small>
                </div>
              ))
            ) : (
              <p className="threshold-alerts-copy">Nothing sent yet.</p>
            )}
          </div>
        </>
      )}
    </section>
  );
}

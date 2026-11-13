import { useEffect, useMemo, useState } from "react";
import DeleteBin6LineIcon from "remixicon-react/DeleteBin6LineIcon";
import RefreshLineIcon from "remixicon-react/RefreshLineIcon";
import AddLineIcon from "remixicon-react/AddLineIcon";
import axios from "../lib/axios_instance";
import "./css/cleanup-rules.css";

const emptyForm = {
  name: "",
  libraryId: "",
  unwatchedDays: "",
  watchedBy: "",
  addedDays: "",
  sizeGb: "",
  ratingBelow: "",
  tag: "",
  leavingSoon: true,
  leavingSoonDays: "14",
  unmonitor: true,
  delete: false,
};

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value >= 1099511627776) return `${(value / 1099511627776).toFixed(value >= 1099511627776 * 10 ? 0 : 1)} TB`;
  if (value >= 1073741824) return `${(value / 1073741824).toFixed(value >= 1073741824 * 10 ? 0 : 1)} GB`;
  if (value >= 1048576) return `${(value / 1048576).toFixed(1)} MB`;
  if (!value) return "0 B";
  return `${value} B`;
}

function formFromRule(rule) {
  if (!rule) return { ...emptyForm };
  return {
    name: rule.name || "",
    libraryId: rule.libraryId || "",
    unwatchedDays: rule.conditions?.unwatchedDays ?? "",
    watchedBy: rule.conditions?.watchedBy || "",
    addedDays: rule.conditions?.addedDays ?? "",
    sizeGb: rule.conditions?.sizeGb ?? "",
    ratingBelow: rule.conditions?.ratingBelow ?? "",
    tag: rule.actions?.tag || "",
    leavingSoon: Boolean(rule.actions?.leavingSoon),
    leavingSoonDays: rule.actions?.leavingSoonDays ?? "14",
    unmonitor: Boolean(rule.actions?.unmonitor),
    delete: Boolean(rule.actions?.delete),
  };
}

function payloadFromForm(form) {
  return {
    name: form.name,
    libraryId: form.libraryId,
    conditions: {
      unwatchedDays: form.unwatchedDays === "" ? null : form.unwatchedDays,
      watchedBy: form.watchedBy || null,
      addedDays: form.addedDays === "" ? null : form.addedDays,
      sizeGb: form.sizeGb === "" ? null : form.sizeGb,
      ratingBelow: form.ratingBelow === "" ? null : form.ratingBelow,
    },
    actions: {
      tag: form.tag,
      leavingSoon: form.leavingSoon,
      leavingSoonDays: form.leavingSoonDays,
      unmonitor: form.unmonitor,
      delete: form.delete,
    },
  };
}

export default function CleanupRules() {
  const [rules, setRules] = useState([]);
  const [libraries, setLibraries] = useState([]);
  const [automationAllowed, setAutomationAllowed] = useState(true);
  const [selectedId, setSelectedId] = useState("");
  const [form, setForm] = useState(emptyForm);
  const [preview, setPreview] = useState(null);
  const [runs, setRuns] = useState([]);
  const [exclusions, setExclusions] = useState([]);
  const [exclusionReason, setExclusionReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState(null);

  const selected = useMemo(() => rules.find((rule) => rule.id === selectedId) || null, [rules, selectedId]);

  const loadLists = async () => {
    setLoading(true);
    setError("");
    try {
      const [ruleRes, libRes] = await Promise.all([axios.get("/cleanup-rules/rules"), axios.get("/cleanup-rules/libraries")]);
      setRules(ruleRes.data.rules || []);
      setLibraries(libRes.data.libraries || []);
      setAutomationAllowed(ruleRes.data.automationAllowed !== false && libRes.data.automationAllowed !== false);
    } catch (err) {
      setError(err.response?.data?.error || "Unable to load cleanup rules");
    } finally {
      setLoading(false);
    }
  };

  const loadRuleExtras = async (id) => {
    if (!id) {
      setPreview(null);
      setRuns([]);
      setExclusions([]);
      return;
    }
    try {
      const [previewRes, runRes, exclusionRes] = await Promise.all([
        axios.get(`/cleanup-rules/rules/${id}/preview`),
        axios.get(`/cleanup-rules/rules/${id}/runs`),
        axios.get(`/cleanup-rules/rules/${id}/exclusions`),
      ]);
      setPreview(previewRes.data);
      setRuns(runRes.data.runs || []);
      setExclusions(exclusionRes.data.exclusions || []);
    } catch (err) {
      setError(err.response?.data?.error || "Unable to load the rule preview");
    }
  };

  useEffect(() => {
    loadLists();
  }, []);

  useEffect(() => {
    setForm(formFromRule(selected));
    loadRuleExtras(selectedId);
  }, [selectedId, selected]);

  const updateField = (key, value) => setForm((current) => ({ ...current, [key]: value }));

  const startNew = () => {
    setSelectedId("");
    setForm({ ...emptyForm, libraryId: libraries[0]?.id || "" });
    setPreview(null);
    setRuns([]);
    setExclusions([]);
  };

  const saveRule = async () => {
    setBusy(true);
    setError("");
    try {
      if (selectedId) {
        const { data } = await axios.put(`/cleanup-rules/rules/${selectedId}`, payloadFromForm(form));
        setRules((current) => current.map((rule) => (rule.id === selectedId ? data.rule : rule)));
      } else {
        const { data } = await axios.post("/cleanup-rules/rules", payloadFromForm(form));
        setRules((current) => [...current, data.rule]);
        setSelectedId(data.rule.id);
      }
    } catch (err) {
      setError(err.response?.data?.error || "Unable to save the rule");
    } finally {
      setBusy(false);
    }
  };

  const removeRule = async () => {
    if (!selectedId || !window.confirm(`Delete rule “${selected?.name}”? This does not delete any media.`)) return;
    setBusy(true);
    try {
      await axios.delete(`/cleanup-rules/rules/${selectedId}`);
      setRules((current) => current.filter((rule) => rule.id !== selectedId));
      startNew();
    } catch (err) {
      setError(err.response?.data?.error || "Unable to delete the rule");
    } finally {
      setBusy(false);
    }
  };

  const requestEnable = async (next) => {
    if (!selectedId) return;
    if (next.enabled && !next.dryRun) {
      setConfirm({
        kind: "enable-live",
        title: "Turn on live actions?",
        body: `This will allow “${selected.name}” to tag, move into Leaving soon, unmonitor or delete the ${preview?.count || 0} matching items (${formatBytes(preview?.bytes)}). Server automation is ${automationAllowed ? "available" : "currently disabled and will still block live changes"}.`,
        next,
      });
      return;
    }
    await applyFlags(next);
  };

  const applyFlags = async (next) => {
    setBusy(true);
    setError("");
    try {
      const { data } = await axios.put(`/cleanup-rules/rules/${selectedId}`, { ...payloadFromForm(form), enabled: next.enabled, dryRun: next.dryRun });
      setRules((current) => current.map((rule) => (rule.id === selectedId ? data.rule : rule)));
    } catch (err) {
      setError(err.response?.data?.error || "Unable to update the rule");
    } finally {
      setBusy(false);
    }
  };

  const requestRun = () => {
    if (!selectedId) return;
    setConfirm({
      kind: "run",
      title: selected?.dryRun === false && selected?.enabled ? "Run live cleanup?" : "Run a dry-run preview?",
      body: `“${selected?.name}” currently matches ${preview?.count || 0} items (${formatBytes(preview?.bytes)}). ${
        selected?.dryRun === false && selected?.enabled
          ? "This is a live run. Items may be tagged, added to Leaving soon, unmonitored or deleted through Sonarr or Radarr."
          : "This stays a dry run. No library, tag, collection or Arr changes will be made."
      }`,
    });
  };

  const confirmAction = async () => {
    const pending = confirm;
    setConfirm(null);
    if (!pending) return;
    if (pending.kind === "enable-live") {
      await applyFlags(pending.next);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const { data } = await axios.post(`/cleanup-rules/rules/${selectedId}/run`, { confirm: true });
      setPreview(data);
      const { data: runData } = await axios.get(`/cleanup-rules/rules/${selectedId}/runs`);
      setRuns(runData.runs || []);
    } catch (err) {
      setError(err.response?.data?.error || "Unable to run the rule");
      if (err.response?.data?.run) {
        const { data: runData } = await axios.get(`/cleanup-rules/rules/${selectedId}/runs`);
        setRuns(runData.runs || []);
      }
    } finally {
      setBusy(false);
    }
  };

  const excludeItem = async (item) => {
    if (!selectedId) return;
    setBusy(true);
    try {
      await axios.post(`/cleanup-rules/rules/${selectedId}/exclusions`, { itemId: item.id, itemName: item.name, reason: exclusionReason });
      setExclusionReason("");
      await loadRuleExtras(selectedId);
    } catch (err) {
      setError(err.response?.data?.error || "Unable to exclude that item");
    } finally {
      setBusy(false);
    }
  };

  const dropExclusion = async (id) => {
    setBusy(true);
    try {
      await axios.delete(`/cleanup-rules/exclusions/${id}`);
      await loadRuleExtras(selectedId);
    } catch (err) {
      setError(err.response?.data?.error || "Unable to remove the exclusion");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="cleanup-rules">
      <section className="cleanup-hero">
        <DeleteBin6LineIcon />
        <div>
          <h1>Cleanup rules</h1>
          <p>Build per-library rules that tag stale items, add them to a Leaving soon collection, then unmonitor and delete through Sonarr or Radarr. New rules stay disabled and in dry run until you turn a specific rule on.</p>
        </div>
      </section>

      {!automationAllowed ? (
        <p className="cleanup-banner is-warn">Server automation is disabled on this build. You can preview matches and keep a run history, but live tag, collection, unmonitor and delete actions stay blocked.</p>
      ) : null}

      {error ? <p className="cleanup-error">{error}</p> : null}

      <div className="cleanup-summary">
        <div><strong>{rules.length}</strong><span>rules</span></div>
        <div><strong>{rules.filter((rule) => rule.enabled).length}</strong><span>enabled</span></div>
        <div><strong>{preview ? preview.count : "—"}</strong><span>current matches</span></div>
        <div><strong>{preview ? formatBytes(preview.bytes) : "—"}</strong><span>space in preview</span></div>
      </div>

      <div className="cleanup-toolbar">
        <button type="button" className="cleanup-btn is-primary" onClick={startNew}><AddLineIcon size={16} /> New rule</button>
        <button type="button" className="cleanup-btn" onClick={loadLists} disabled={loading}><RefreshLineIcon size={16} /> Refresh</button>
      </div>

      {loading ? <p className="cleanup-muted">Loading rules…</p> : null}

      <div className="cleanup-rule-list">
        {rules.map((rule) => (
          <button key={rule.id} type="button" className={`cleanup-rule${rule.id === selectedId ? " is-selected" : ""}`} onClick={() => setSelectedId(rule.id)}>
            <div>
              <strong>{rule.name}</strong>
              <div className="cleanup-badges">
                <span className="cleanup-badge">{rule.libraryName || rule.libraryId}</span>
                <span className={`cleanup-badge ${rule.enabled ? "is-ok" : "is-off"}`}>{rule.enabled ? "Enabled" : "Disabled"}</span>
                <span className={`cleanup-badge ${rule.dryRun ? "is-warn" : "is-ok"}`}>{rule.dryRun ? "Dry run" : "Live"}</span>
              </div>
            </div>
            <small>Select</small>
          </button>
        ))}
        {!loading && !rules.length ? <p className="cleanup-muted">No cleanup rules yet. New rules are saved disabled and in dry run.</p> : null}
      </div>

      <form
        className="cleanup-form"
        onSubmit={(event) => {
          event.preventDefault();
          saveRule();
        }}
      >
        <h2>{selectedId ? "Edit rule" : "New rule"}</h2>
        <div className="cleanup-grid">
          <label className="cleanup-field">
            <span>Name</span>
            <input value={form.name} onChange={(event) => updateField("name", event.target.value)} required placeholder="Unwatched movies older than a year" />
          </label>
          <label className="cleanup-field">
            <span>Library</span>
            <select value={form.libraryId} onChange={(event) => updateField("libraryId", event.target.value)} required>
              <option value="">Select a library</option>
              {libraries.map((library) => (
                <option key={library.id} value={library.id}>{library.name}</option>
              ))}
            </select>
          </label>
          <label className="cleanup-field">
            <span>Unwatched for days</span>
            <input type="number" min="0" value={form.unwatchedDays} onChange={(event) => updateField("unwatchedDays", event.target.value)} placeholder="e.g. 365" />
          </label>
          <label className="cleanup-field">
            <span>Watched by</span>
            <select value={form.watchedBy} onChange={(event) => updateField("watchedBy", event.target.value)}>
              <option value="">Not required</option>
              <option value="all">Every user</option>
              <option value="active">All active users</option>
            </select>
          </label>
          <label className="cleanup-field">
            <span>Added more than days ago</span>
            <input type="number" min="0" value={form.addedDays} onChange={(event) => updateField("addedDays", event.target.value)} placeholder="e.g. 180" />
          </label>
          <label className="cleanup-field">
            <span>Size above (GB)</span>
            <input type="number" min="0" step="0.1" value={form.sizeGb} onChange={(event) => updateField("sizeGb", event.target.value)} placeholder="e.g. 20" />
          </label>
          <label className="cleanup-field">
            <span>Rating below</span>
            <input type="number" min="0" step="0.1" value={form.ratingBelow} onChange={(event) => updateField("ratingBelow", event.target.value)} placeholder="e.g. 5.5" />
          </label>
          <label className="cleanup-field">
            <span>Tag first</span>
            <input value={form.tag} onChange={(event) => updateField("tag", event.target.value)} placeholder="leaving-soon" />
          </label>
        </div>
        <div className="cleanup-grid">
          <label className="cleanup-check"><input type="checkbox" checked={form.leavingSoon} onChange={(event) => updateField("leavingSoon", event.target.checked)} /> Add to Leaving soon</label>
          <label className="cleanup-field">
            <span>Leaving soon countdown (days)</span>
            <input type="number" min="1" value={form.leavingSoonDays} onChange={(event) => updateField("leavingSoonDays", event.target.value)} />
          </label>
          <label className="cleanup-check"><input type="checkbox" checked={form.unmonitor} onChange={(event) => updateField("unmonitor", event.target.checked)} /> Then unmonitor in Sonarr or Radarr</label>
          <label className="cleanup-check"><input type="checkbox" checked={form.delete} onChange={(event) => updateField("delete", event.target.checked)} /> Then delete through the Arr, with files</label>
        </div>
        <div className="cleanup-actions">
          <button type="submit" className="cleanup-btn is-primary" disabled={busy}>Save rule</button>
          {selectedId ? <button type="button" className="cleanup-btn is-danger" disabled={busy} onClick={removeRule}>Delete rule</button> : null}
        </div>
        {selected ? (
          <div className="cleanup-actions">
            <button type="button" className="cleanup-btn" disabled={busy} onClick={() => requestEnable({ enabled: !selected.enabled, dryRun: selected.dryRun })}>
              {selected.enabled ? "Disable rule" : "Enable rule"}
            </button>
            <button type="button" className="cleanup-btn" disabled={busy || !selected.enabled} onClick={() => requestEnable({ enabled: selected.enabled, dryRun: !selected.dryRun })}>
              {selected.dryRun ? "Allow live actions" : "Return to dry run"}
            </button>
            <button type="button" className="cleanup-btn is-primary" disabled={busy || !selected.enabled} onClick={requestRun}>
              {selected.dryRun ? "Run dry-run" : "Run cleanup"}
            </button>
          </div>
        ) : <p className="cleanup-muted">Saving a new rule leaves it disabled and in dry run. Enable it afterwards if you want a run in the history.</p>}
      </form>

      {selectedId && preview ? (
        <section className="cleanup-preview">
          <h2>Preview</h2>
          <p className="cleanup-muted">{preview.count} items, {formatBytes(preview.bytes)} would be affected. {preview.excludedCount || 0} excluded.</p>
          <table className="cleanup-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Type</th>
                <th>Size</th>
                <th>Rating</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {(preview.matches || []).slice(0, 50).map((item) => (
                <tr key={item.id}>
                  <td>{item.name}{item.year ? ` (${item.year})` : ""}</td>
                  <td>{item.type}</td>
                  <td>{formatBytes(item.size)}</td>
                  <td>{item.rating ?? "—"}</td>
                  <td><button type="button" className="cleanup-btn" onClick={() => excludeItem(item)}>Exclude</button></td>
                </tr>
              ))}
              {!preview.matches?.length ? <tr><td colSpan={5}>No matches.</td></tr> : null}
            </tbody>
          </table>
          <div className="cleanup-inline" style={{ marginTop: "0.7rem" }}>
            <label className="cleanup-field" style={{ flex: 1 }}>
              <span>Exclusion reason (optional)</span>
              <input value={exclusionReason} onChange={(event) => setExclusionReason(event.target.value)} placeholder="Keep for the kids, waiting on a remux…" />
            </label>
          </div>
          {exclusions.length ? (
            <table className="cleanup-table">
              <thead><tr><th>Excluded</th><th>Reason</th><th></th></tr></thead>
              <tbody>
                {exclusions.map((row) => (
                  <tr key={row.id}>
                    <td>{row.itemName || row.itemId}</td>
                    <td>{row.reason || "—"}</td>
                    <td><button type="button" className="cleanup-btn" onClick={() => dropExclusion(row.id)}>Remove</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </section>
      ) : null}

      {selectedId ? (
        <section className="cleanup-history">
          <h2>Run history</h2>
          {!runs.length ? <p className="cleanup-muted">No runs yet.</p> : (
            <table className="cleanup-table">
              <thead><tr><th>When</th><th>Status</th><th>Matches</th><th>Size</th><th>Note</th></tr></thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={run.id}>
                    <td>{run.startedAt ? new Date(run.startedAt).toLocaleString() : "—"}</td>
                    <td>{run.status}{run.dryRun ? " · dry run" : ""}</td>
                    <td>{run.matchCount}</td>
                    <td>{formatBytes(run.bytes)}</td>
                    <td>{run.message || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      ) : null}

      {confirm ? (
        <div className="cleanup-confirm" role="dialog" aria-modal="true" aria-labelledby="cleanup-confirm-title">
          <div className="cleanup-confirm-card">
            <h2 id="cleanup-confirm-title">{confirm.title}</h2>
            <p>{confirm.body}</p>
            <div className="cleanup-actions">
              <button type="button" className="cleanup-btn is-primary" onClick={confirmAction}>Confirm</button>
              <button type="button" className="cleanup-btn" onClick={() => setConfirm(null)}>Cancel</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

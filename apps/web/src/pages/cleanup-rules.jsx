import { useEffect, useMemo, useRef, useState } from "react";
import DeleteBin6LineIcon from "remixicon-react/DeleteBin6LineIcon";
import RefreshLineIcon from "remixicon-react/RefreshLineIcon";
import AddLineIcon from "remixicon-react/AddLineIcon";
import ArrowDownSLineIcon from "remixicon-react/ArrowDownSLineIcon";
import CheckLineIcon from "remixicon-react/CheckLineIcon";
import FilmLineIcon from "remixicon-react/FilmLineIcon";
import TvLineIcon from "remixicon-react/TvLineIcon";
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

// Starter rules. Each is created per matching library, disabled and in dry run, and never deletes files.
const DEFAULT_RULES = [
  {
    key: "stale-movies",
    name: "Unwatched movies older than a year",
    description: "Movies added over a year ago that nobody has played in the last year.",
    kind: "movies",
    conditions: { unwatchedDays: 365, addedDays: 365 },
  },
  {
    key: "never-watched-movies",
    name: "Movies no one started in 6 months",
    description: "Recent-ish additions that have sat unplayed for six months.",
    kind: "movies",
    conditions: { unwatchedDays: 180, addedDays: 180 },
  },
  {
    key: "large-movies",
    name: "Large unwatched movies (40 GB+)",
    description: "Big remuxes and 4K files nobody has watched for six months — the quickest space wins.",
    kind: "movies",
    conditions: { unwatchedDays: 180, addedDays: 90, sizeGb: 40 },
  },
  {
    key: "low-rated-movies",
    name: "Low-rated movies nobody watched",
    description: "Rated below 5.0 and unplayed for 90 days since being added.",
    kind: "movies",
    conditions: { unwatchedDays: 90, addedDays: 90, ratingBelow: 5 },
  },
  {
    key: "watched-by-everyone",
    name: "Movies everyone has watched",
    description: "Every user has seen it and nobody has rewatched it in 60 days.",
    kind: "movies",
    conditions: { watchedBy: "all", unwatchedDays: 60, addedDays: 90 },
  },
  {
    key: "stale-shows",
    name: "TV shows untouched for two years",
    description: "Series added over a year ago with no plays in the last two years.",
    kind: "tvshows",
    conditions: { unwatchedDays: 730, addedDays: 365 },
  },
  {
    key: "large-shows",
    name: "Large unwatched TV shows (100 GB+)",
    description: "Whole series over 100 GB that nobody has played for a year.",
    kind: "tvshows",
    conditions: { unwatchedDays: 365, addedDays: 180, sizeGb: 100 },
  },
];

const DEFAULT_RULE_ACTIONS = { tag: "leaving-soon", leavingSoon: true, leavingSoonDays: 14, unmonitor: true, delete: false };

function libraryKind(library) {
  const type = String(library?.collection_type || library?.collectionType || "").toLowerCase();
  if (type === "movies") return "movies";
  if (type === "tvshows") return "tvshows";
  return "";
}

function describeConditions(conditions = {}) {
  const parts = [];
  if (conditions.unwatchedDays) parts.push(`unplayed ${conditions.unwatchedDays}d`);
  if (conditions.addedDays) parts.push(`added ${conditions.addedDays}d+ ago`);
  if (conditions.sizeGb) parts.push(`over ${conditions.sizeGb} GB`);
  if (conditions.ratingBelow) parts.push(`rated under ${conditions.ratingBelow}`);
  if (conditions.watchedBy === "all") parts.push("watched by everyone");
  if (conditions.watchedBy === "active") parts.push("watched by all active users");
  return parts.join(" · ");
}

function defaultRuleName(preset, library, multipleLibraries) {
  return multipleLibraries ? `${preset.name} — ${library.name}` : preset.name;
}

function formFromPreset(preset, libraryId) {
  return {
    ...emptyForm,
    name: preset.name,
    libraryId: libraryId || "",
    unwatchedDays: preset.conditions.unwatchedDays ?? "",
    watchedBy: preset.conditions.watchedBy || "",
    addedDays: preset.conditions.addedDays ?? "",
    sizeGb: preset.conditions.sizeGb ?? "",
    ratingBelow: preset.conditions.ratingBelow ?? "",
    tag: DEFAULT_RULE_ACTIONS.tag,
    leavingSoon: DEFAULT_RULE_ACTIONS.leavingSoon,
    leavingSoonDays: String(DEFAULT_RULE_ACTIONS.leavingSoonDays),
    unmonitor: DEFAULT_RULE_ACTIONS.unmonitor,
    delete: false,
  };
}

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
  const [defaultsOpen, setDefaultsOpen] = useState(null);
  // Nothing is pre-selected: the admin opts in to each default rule and library.
  const [pickedDefaults, setPickedDefaults] = useState(() => new Set());
  const [defaultsNotice, setDefaultsNotice] = useState("");
  // Libraries the default rules are added to (null = every movie and TV library). Starts with none selected.
  const [defaultLibraryIds, setDefaultLibraryIds] = useState(() => new Set());
  // A form to show once the selection is cleared (templates, "New rule"), so the reset below doesn't wipe it.
  const pendingForm = useRef(null);

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
    setForm(pendingForm.current || formFromRule(selected));
    pendingForm.current = null;
    loadRuleExtras(selectedId);
  }, [selectedId, selected]);

  const updateField = (key, value) => setForm((current) => ({ ...current, [key]: value }));

  // Libraries each default applies to, and which of those already have a rule with the same name.
  const defaultTargets = useMemo(
    () =>
      DEFAULT_RULES.map((preset) => {
        const allOfKind = libraries.filter((library) => libraryKind(library) === preset.kind);
        const targets = allOfKind.filter((library) => !defaultLibraryIds || defaultLibraryIds.has(library.id));
        const ruleNames = new Set(rules.map((rule) => String(rule.name || "").trim().toLowerCase()));
        // Name by library whenever more than one library of this kind exists, so names stay stable as the selection changes.
        const missing = targets.filter((library) => !ruleNames.has(defaultRuleName(preset, library, allOfKind.length > 1).toLowerCase()));
        return { preset, targets, missing, multiple: allOfKind.length > 1 };
      }),
    [libraries, rules, defaultLibraryIds]
  );
  const defaultLibraries = libraries.filter((library) => libraryKind(library));
  const isLibraryPicked = (id) => !defaultLibraryIds || defaultLibraryIds.has(id);
  const toggleLibrary = (id) =>
    setDefaultLibraryIds((current) => {
      const next = new Set(current || defaultLibraries.map((library) => library.id));
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const pickedTargets = defaultTargets.filter(({ preset }) => pickedDefaults.has(preset.key));
  const rulesToCreate = pickedTargets.reduce((sum, row) => sum + row.missing.length, 0);
  const showDefaults = defaultsOpen ?? (!loading && rules.length === 0);

  const togglePicked = (key) =>
    setPickedDefaults((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const usePresetAsTemplate = (preset) => {
    const target =
      libraries.find((library) => libraryKind(library) === preset.kind && isLibraryPicked(library.id)) ||
      libraries.find((library) => libraryKind(library) === preset.kind);
    const next = formFromPreset(preset, target?.id || libraries[0]?.id || "");
    if (selectedId) pendingForm.current = next;
    setSelectedId("");
    setForm(next);
    setPreview(null);
    setRuns([]);
    setExclusions([]);
    setDefaultsNotice(`Loaded “${preset.name}” into the form below. Adjust it, then save.`);
    window.requestAnimationFrame(() => document.querySelector(".cleanup-form")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  const addDefaultRules = async () => {
    if (!rulesToCreate) return;
    setBusy(true);
    setError("");
    setDefaultsNotice("");
    const created = [];
    const failed = [];
    for (const { preset, missing, multiple } of pickedTargets) {
      for (const library of missing) {
        const name = defaultRuleName(preset, library, multiple);
        try {
          const { data } = await axios.post("/cleanup-rules/rules", payloadFromForm({ ...formFromPreset(preset, library.id), name }));
          if (data?.rule) created.push(data.rule);
        } catch (err) {
          failed.push(`${name}: ${err.response?.data?.error || "failed"}`);
        }
      }
    }
    if (created.length) setRules((current) => [...current, ...created]);
    setBusy(false);
    if (failed.length) setError(`Some default rules could not be added — ${failed.join("; ")}`);
    if (created.length) {
      setDefaultsNotice(`Added ${created.length} rule${created.length === 1 ? "" : "s"}. They are disabled and in dry run — select one to preview its matches.`);
      setDefaultsOpen(false);
    }
  };

  const startNew = () => {
    const next = { ...emptyForm, libraryId: libraries[0]?.id || "" };
    if (selectedId) pendingForm.current = next;
    setSelectedId("");
    setForm(next);
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
        <div className="cleanup-inline">
          <button type="button" className="cleanup-btn is-primary" onClick={startNew}><AddLineIcon size={16} /> New rule</button>
          <button type="button" className={`cleanup-btn${showDefaults ? " is-active" : ""}`} aria-expanded={showDefaults} onClick={() => setDefaultsOpen(!showDefaults)}>
            <ArrowDownSLineIcon size={16} className={showDefaults ? "is-flipped" : ""} /> Default rules
          </button>
        </div>
        <button type="button" className="cleanup-btn" onClick={loadLists} disabled={loading}><RefreshLineIcon size={16} /> Refresh</button>
      </div>

      {defaultsNotice ? <p className="cleanup-banner is-ok">{defaultsNotice}</p> : null}

      {showDefaults ? (
        <section className="cleanup-defaults" aria-label="Default rules">
          <header>
            <div>
              <h2>Default rules</h2>
              <p className="cleanup-muted">
                Pick the starters you want. Each one is added for every matching library, disabled and in dry run, tags items <code>leaving-soon</code>, adds them to Leaving soon for 14 days and unmonitors — nothing is deleted.
              </p>
            </div>
            <div className="cleanup-inline">
              <button type="button" className="cleanup-btn" onClick={() => setPickedDefaults(new Set(DEFAULT_RULES.map((preset) => preset.key)))}>Select all</button>
              <button type="button" className="cleanup-btn" onClick={() => setPickedDefaults(new Set())}>Clear</button>
            </div>
          </header>
          <div className="cleanup-default-libraries">
            <span className="cleanup-muted">Libraries</span>
            {defaultLibraries.map((library) => (
              <button
                type="button"
                key={library.id}
                className={`cleanup-chip${isLibraryPicked(library.id) ? " is-on" : ""}`}
                aria-pressed={isLibraryPicked(library.id)}
                onClick={() => toggleLibrary(library.id)}
              >
                {libraryKind(library) === "movies" ? <FilmLineIcon size={13} /> : <TvLineIcon size={13} />}
                {library.name}
              </button>
            ))}
            <button type="button" className="cleanup-link" onClick={() => setDefaultLibraryIds(null)}>All</button>
            <button type="button" className="cleanup-link" onClick={() => setDefaultLibraryIds(new Set())}>None</button>
          </div>
          <div className="cleanup-default-grid">
            {defaultTargets.map(({ preset, targets, missing }) => {
              const picked = pickedDefaults.has(preset.key);
              const unavailable = !targets.length;
              const noLibraryOfKind = !libraries.some((library) => libraryKind(library) === preset.kind);
              const allAdded = targets.length > 0 && !missing.length;
              return (
                <article key={preset.key} className={`cleanup-default${picked && !allAdded ? " is-picked" : ""}${noLibraryOfKind || allAdded ? " is-muted" : ""}`}>
                  <label className="cleanup-default-main">
                    <input type="checkbox" checked={picked && !allAdded} disabled={noLibraryOfKind || allAdded} onChange={() => togglePicked(preset.key)} />
                    <span className="cleanup-default-icon">{preset.kind === "movies" ? <FilmLineIcon size={16} /> : <TvLineIcon size={16} />}</span>
                    <span className="cleanup-default-copy">
                      <strong>{preset.name}</strong>
                      <small>{preset.description}</small>
                      <em>{describeConditions(preset.conditions)}</em>
                    </span>
                  </label>
                  <footer>
                    <span className={`cleanup-badge${allAdded ? " is-ok" : unavailable ? " is-off" : ""}`}>
                      {allAdded ? (
                        <>
                          <CheckLineIcon size={11} /> Added
                        </>
                      ) : unavailable ? (
                        noLibraryOfKind ? `No ${preset.kind === "movies" ? "movie" : "TV"} library` : "No library selected"
                      ) : (
                        `${missing.length} ${missing.length === 1 ? "library" : "libraries"}`
                      )}
                    </span>
                    <button type="button" className="cleanup-link" disabled={noLibraryOfKind} onClick={() => usePresetAsTemplate(preset)}>
                      Use as template
                    </button>
                  </footer>
                </article>
              );
            })}
          </div>
          <div className="cleanup-actions">
            <button type="button" className="cleanup-btn is-primary" disabled={busy || !rulesToCreate} onClick={addDefaultRules}>
              <AddLineIcon size={16} />
              {rulesToCreate
                ? `Add ${rulesToCreate} rule${rulesToCreate === 1 ? "" : "s"}`
                : !pickedDefaults.size
                  ? "Pick a rule to add"
                  : defaultLibraryIds && !defaultLibraryIds.size
                    ? "Pick a library"
                    : "Nothing new to add"}
            </button>
            <span className="cleanup-muted">Existing rules with the same name are skipped.</span>
          </div>
        </section>
      ) : null}

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
        {!loading && !rules.length ? <p className="cleanup-muted">No cleanup rules yet. Add some of the default rules above, or build your own below. New rules are saved disabled and in dry run.</p> : null}
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
          <p className="cleanup-muted">
            {preview.count} items, {formatBytes(preview.bytes)} would be affected. {preview.excludedCount || 0} excluded
            {preview.protectedCount ? `, ${preview.protectedCount} protected because someone is watching or has favourited them` : ""}.
          </p>
          {preview.protectionError ? <p className="cleanup-banner is-warn">{preview.protectionError}. Live runs are blocked until this works again.</p> : null}
          {preview.protected?.length ? (
            <details className="cleanup-protected">
              <summary>Protected ({preview.protected.length})</summary>
              <ul>
                {preview.protected.map((item) => (
                  <li key={item.id}>
                    <strong>{item.name}</strong> — {item.reasons.join("; ")}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
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

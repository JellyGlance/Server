import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import StackLineIcon from "remixicon-react/StackLineIcon";
import AddLineIcon from "remixicon-react/AddLineIcon";
import RefreshLineIcon from "remixicon-react/RefreshLineIcon";
import CloseLineIcon from "remixicon-react/CloseLineIcon";
import CheckboxCircleFillIcon from "remixicon-react/CheckboxCircleFillIcon";
import Settings3LineIcon from "remixicon-react/Settings3LineIcon";
import axios from "../lib/axios_instance";
import "./css/auto-collections.css";

const TYPE_LABELS = {
  recently_added: "Recently added",
  trending: "Trending (TMDB)",
  oscar_winners: "Oscar winners",
  imdb_top_250: "IMDb Top 250",
  franchise: "Franchise (TMDB collections)",
  trakt_list: "Trakt list",
  letterboxd_list: "Letterboxd list",
};

const TYPE_HINTS = {
  recently_added: "The newest titles in the library. Works without TMDB.",
  trending: "What is trending on TMDB this week (or today), matched to titles you already have.",
  oscar_winners: "Best Picture winners from a TMDB list, matched to your library.",
  imdb_top_250: "The IMDb Top 250 from a TMDB list (falls back to TMDB top rated), matched to your library.",
  franchise: "Pick TMDB collections such as Star Wars or The Lord of the Rings; every part you own goes in.",
  trakt_list: "Any public Trakt list or watchlist, matched to your library. Needs a Trakt Client ID.",
  letterboxd_list: "Any public Letterboxd list or watchlist, matched to your library by title and year.",
};

const TMDB_TYPES = new Set(["trending", "oscar_winners", "imdb_top_250", "franchise"]);

const emptyForm = { name: "", type: "recently_added", libraryId: "", limit: "20", media: "movie", window: "week", collections: [], url: "" };
const LIST_TYPES = new Set(["trakt_list", "letterboxd_list"]);

function libraryMedia(library) {
  return String(library?.collection_type || "").toLowerCase() === "tvshows" ? "tv" : "movie";
}

function formFromBuilder(builder) {
  const options = builder.options || {};
  return {
    name: builder.name,
    type: builder.type,
    libraryId: builder.libraryId || "",
    limit: String(options.limit || "20"),
    media: options.media || "movie",
    window: options.window || "week",
    url: options.url || "",
    poster: options.poster || "",
    collections: Array.isArray(options.collections)
      ? options.collections
      : (options.collectionIds || []).map((id) => ({ id, name: `Collection ${id}` })),
  };
}

function optionsFromForm(form) {
  const options = { limit: Number(form.limit) || 20, poster: form.poster || "collage" };
  if (form.type === "trending") Object.assign(options, { media: form.media, window: form.window });
  if (LIST_TYPES.has(form.type)) options.url = form.url.trim();
  if (form.type === "franchise") {
    options.collectionIds = form.collections.map((row) => row.id);
    options.collections = form.collections;
  }
  return options;
}

function FranchisePicker({ value, onChange, disabled }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");
  const timer = useRef(null);

  useEffect(() => {
    window.clearTimeout(timer.current);
    if (query.trim().length < 2 || disabled) {
      setResults([]);
      return undefined;
    }
    timer.current = window.setTimeout(async () => {
      setSearching(true);
      setError("");
      try {
        const { data } = await axios.get("/auto-collections/tmdb/collections", { params: { q: query.trim() } });
        setResults(data.results || []);
      } catch (err) {
        setError(err.response?.data?.error || "Search failed");
      } finally {
        setSearching(false);
      }
    }, 350);
    return () => window.clearTimeout(timer.current);
  }, [query, disabled]);

  const chosen = new Set(value.map((row) => row.id));
  return (
    <div className="ac-franchise">
      <label className="ac-field">
        <span>TMDB collections</span>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={disabled ? "Add a TMDB key first" : "Search, e.g. Star Wars"} disabled={disabled} />
      </label>
      {value.length ? (
        <div className="ac-chips">
          {value.map((row) => (
            <span className="ac-chip" key={row.id}>
              {row.name}
              <button type="button" aria-label={`Remove ${row.name}`} onClick={() => onChange(value.filter((item) => item.id !== row.id))}>
                <CloseLineIcon size={13} />
              </button>
            </span>
          ))}
        </div>
      ) : null}
      {searching ? <p className="ac-muted">Searching TMDB…</p> : null}
      {error ? <p className="ac-error">{error}</p> : null}
      {results.length ? (
        <div className="ac-search-results">
          {results.map((row) => (
            <button
              type="button"
              key={row.id}
              className={chosen.has(row.id) ? "is-chosen" : ""}
              disabled={chosen.has(row.id)}
              onClick={() => {
                onChange([...value, { id: row.id, name: row.name }]);
                setQuery("");
                setResults([]);
              }}
            >
              {row.poster ? <img src={row.poster} alt="" loading="lazy" /> : <span className="ac-search-noart" />}
              <span>{row.name}</span>
              {chosen.has(row.id) ? <CheckboxCircleFillIcon size={15} /> : <AddLineIcon size={15} />}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default function AutoCollections() {
  const [status, setStatus] = useState({ automationAllowed: true, tmdbConfigured: false, libraries: [], types: [] });
  const [builders, setBuilders] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [form, setForm] = useState(emptyForm);
  const [preview, setPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [overlays, setOverlays] = useState(null);
  const [overlayLibraryId, setOverlayLibraryId] = useState("");
  const [overlayPicked, setOverlayPicked] = useState(() => new Set());
  const [originalCount, setOriginalCount] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [overlayBusy, setOverlayBusy] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [showUnmatched, setShowUnmatched] = useState(false);

  const selected = builders.find((builder) => builder.id === selectedId);
  const libraries = status.libraries || [];
  const mediaLibraries = libraries.filter((library) => /^(movies|tvshows)$/i.test(String(library.collection_type || "")));
  const needsTmdb = TMDB_TYPES.has(form.type);
  const traktConfigured = Boolean(status.trakt?.configured);
  const typeUnavailable = (id) => (TMDB_TYPES.has(id) && !status.tmdbConfigured) || (id === "trakt_list" && !traktConfigured);
  const applyOn = selected && selected.previewOnly === false && selected.applyEnabled;

  const loadOriginals = () =>
    axios
      .get("/auto-collections/overlays/originals")
      .then(({ data }) => setOriginalCount((data.originals || []).length))
      .catch(() => {});

  const load = async () => {
    setError("");
    try {
      const [statusRes, builderRes] = await Promise.all([axios.get("/auto-collections/status"), axios.get("/auto-collections/builders")]);
      setStatus(statusRes.data);
      setBuilders(builderRes.data.builders || []);
      if (!overlayLibraryId && statusRes.data.libraries?.length) {
        const preferred = statusRes.data.libraries.find((library) => /^movies$/i.test(String(library.collection_type || ""))) || statusRes.data.libraries[0];
        setOverlayLibraryId(preferred.id);
      }
      loadOriginals();
    } catch (err) {
      setError(err.response?.data?.error || "Unable to load auto collections");
    }
  };

  useEffect(() => {
    load();
  }, []);

  const loadPreview = async (id) => {
    if (!id) return;
    setPreviewLoading(true);
    setShowUnmatched(false);
    try {
      const { data } = await axios.get(`/auto-collections/builders/${id}/preview`);
      setPreview(data);
    } catch (err) {
      setPreview(null);
      setError(err.response?.data?.error || "Unable to preview");
    } finally {
      setPreviewLoading(false);
    }
  };

  useEffect(() => {
    setNotice("");
    if (!selected) {
      setPreview(null);
      return;
    }
    setForm(formFromBuilder(selected));
    loadPreview(selected.id);
  }, [selectedId]);

  const startNew = () => {
    setSelectedId("");
    const first = mediaLibraries[0] || libraries[0];
    setForm({ ...emptyForm, libraryId: first?.id || "", media: libraryMedia(first) });
    setPreview(null);
  };

  const updateForm = (patch) => setForm((current) => ({ ...current, ...patch }));

  const save = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    const payload = { name: form.name, type: form.type, libraryId: form.libraryId, options: optionsFromForm(form) };
    try {
      if (selectedId) {
        const { data } = await axios.put(`/auto-collections/builders/${selectedId}`, {
          ...payload,
          options: { ...payload.options, schedule: selected.options?.schedule || "off" },
          previewOnly: selected.previewOnly,
          applyEnabled: selected.applyEnabled,
        });
        setBuilders((current) => current.map((builder) => (builder.id === selectedId ? data.builder : builder)));
        setNotice("Saved. Preview refreshed.");
        loadPreview(selectedId);
      } else {
        const { data } = await axios.post("/auto-collections/builders", payload);
        setBuilders((current) => [...current, data.builder]);
        setSelectedId(data.builder.id);
      }
    } catch (err) {
      setError(err.response?.data?.error || "Unable to save the builder");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!selectedId || !window.confirm("Delete this builder? Any collection it already created stays in your media server.")) return;
    setBusy(true);
    try {
      await axios.delete(`/auto-collections/builders/${selectedId}`);
      setBuilders((current) => current.filter((builder) => builder.id !== selectedId));
      setSelectedId("");
    } catch (err) {
      setError(err.response?.data?.error || "Unable to delete the builder");
    } finally {
      setBusy(false);
    }
  };

  const setPosterOption = async (enabled) => {
    if (!selected) return;
    setBusy(true);
    try {
      const { data } = await axios.put(`/auto-collections/builders/${selected.id}`, {
        name: selected.name,
        type: selected.type,
        libraryId: selected.libraryId,
        options: { ...(selected.options || {}), poster: enabled ? "collage" : "none" },
        previewOnly: selected.previewOnly,
        applyEnabled: selected.applyEnabled,
      });
      setBuilders((current) => current.map((builder) => (builder.id === selected.id ? data.builder : builder)));
    } catch (err) {
      setError(err.response?.data?.error || "Unable to update the builder");
    } finally {
      setBusy(false);
    }
  };

  const [posterUrl, setPosterUrl] = useState("");
  const [posterLoading, setPosterLoading] = useState(false);
  const loadPosterPreview = async () => {
    if (!selected) return;
    setPosterLoading(true);
    try {
      const response = await axios.get(`/auto-collections/builders/${selected.id}/poster`, { responseType: "blob" });
      setPosterUrl((current) => {
        if (current) URL.revokeObjectURL(current);
        return URL.createObjectURL(response.data);
      });
    } catch {
      setError("Unable to render the poster preview");
    } finally {
      setPosterLoading(false);
    }
  };

  useEffect(() => {
    setPosterUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return "";
    });
  }, [selectedId]);

  const setSchedule = async (schedule) => {
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      const { data } = await axios.put(`/auto-collections/builders/${selected.id}`, {
        name: selected.name,
        type: selected.type,
        libraryId: selected.libraryId,
        options: { ...(selected.options || {}), schedule },
        previewOnly: selected.previewOnly,
        applyEnabled: selected.applyEnabled,
      });
      setBuilders((current) => current.map((builder) => (builder.id === selected.id ? data.builder : builder)));
    } catch (err) {
      setError(err.response?.data?.error || "Unable to update the schedule");
    } finally {
      setBusy(false);
    }
  };

  const setApply = async (enabled) => {
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      const { data } = await axios.put(`/auto-collections/builders/${selected.id}`, {
        name: selected.name,
        type: selected.type,
        libraryId: selected.libraryId,
        options: selected.options,
        previewOnly: !enabled,
        applyEnabled: enabled,
      });
      setBuilders((current) => current.map((builder) => (builder.id === selected.id ? data.builder : builder)));
    } catch (err) {
      setError(err.response?.data?.error || "Unable to update the builder");
    } finally {
      setBusy(false);
    }
  };

  const runConfirmed = async () => {
    const pending = confirm;
    setConfirm(null);
    if (!pending) return;
    setError("");
    setNotice("");
    if (pending.kind === "collection") {
      setBusy(true);
      try {
        const { data } = await axios.post(`/auto-collections/builders/${selected.id}/apply`, { confirm: true });
        setNotice(`“${selected.name}”: ${data.message || "written to your media server"}.`);
        loadPreview(selected.id);
      } catch (err) {
        setError(err.response?.data?.error || "Unable to apply the collection");
      } finally {
        setBusy(false);
      }
      return;
    }
    setOverlayBusy(true);
    try {
      if (pending.kind === "overlays") {
        const { data } = await axios.post("/auto-collections/overlays/apply", { itemIds: pending.ids, confirm: true });
        const failed = data.failed || [];
        setNotice(`Badges added to ${data.applied?.length || 0} poster${data.applied?.length === 1 ? "" : "s"}.${failed.length ? ` ${failed.length} failed.` : ""}`);
        if (failed.length) setError(failed.slice(0, 3).map((row) => row.error).join("; "));
        setOverlayPicked(new Set());
      } else {
        const { data } = await axios.post("/auto-collections/overlays/revert", { itemIds: pending.ids });
        setNotice(`Restored ${data.restored?.length || 0} original poster${data.restored?.length === 1 ? "" : "s"}.`);
      }
      await loadOriginals();
      await loadOverlays();
    } catch (err) {
      setError(err.response?.data?.error || "Unable to update posters");
    } finally {
      setOverlayBusy(false);
    }
  };

  const loadOverlays = async () => {
    setOverlayBusy(true);
    setError("");
    try {
      const { data } = await axios.get("/auto-collections/overlays/preview", { params: { libraryId: overlayLibraryId, limit: 12 } });
      setOverlays(data);
    } catch (err) {
      setError(err.response?.data?.error || "Unable to preview overlays");
    } finally {
      setOverlayBusy(false);
    }
  };

  const toggleOverlay = (id) =>
    setOverlayPicked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const tmdbLink = (
    <Link to="/settings/integrations/metadata" className="ac-inline-link">
      Settings → Integrations → Metadata
    </Link>
  );

  return (
    <div className="auto-collections">
      <section className="ac-hero">
        <StackLineIcon />
        <div>
          <h1>Auto collections and poster overlays</h1>
          <p>Build Kometa-style collections from Recently added, Trending, Oscar winners, IMDb Top 250 or TMDB franchises, and add resolution, HDR, audio and rating badges to posters. Builders start as preview only; nothing changes in your media server until you allow it and confirm.</p>
        </div>
      </section>

      {!status.automationAllowed ? (
        <p className="ac-banner is-warn">Server automation is disabled (JG_DISABLE_SERVER_AUTOMATION=1). You can preview collections and overlays, but nothing will be written to your media server.</p>
      ) : null}
      {!status.tmdbConfigured ? (
        <p className="ac-banner is-warn">
          Add a TMDB API key in {tmdbLink} to use Trending, Oscar winners, IMDb Top 250 and Franchise builders. Recently added works without it.
        </p>
      ) : null}
      {error ? <p className="ac-banner is-error">{error}</p> : null}
      {notice ? <p className="ac-banner is-ok">{notice}</p> : null}

      <div className="ac-toolbar">
        <button type="button" className="ac-btn is-primary" onClick={startNew}>
          <AddLineIcon size={16} /> New builder
        </button>
        <button type="button" className="ac-btn" onClick={load}>
          <RefreshLineIcon size={16} /> Refresh
        </button>
        <Link to="/settings/integrations/metadata" className="ac-btn">
          <Settings3LineIcon size={16} /> TMDB {status.tmdbConfigured ? "connected" : "not set up"}
        </Link>
      </div>

      {builders.length ? (
        <div className="ac-builder-list">
          {builders.map((builder) => {
            const live = builder.previewOnly === false && builder.applyEnabled;
            return (
              <button key={builder.id} type="button" className={`ac-builder${builder.id === selectedId ? " is-selected" : ""}`} onClick={() => setSelectedId(builder.id)}>
                <div>
                  <strong>{builder.name}</strong>
                  <div className="ac-badges">
                    <span className="ac-badge">{TYPE_LABELS[builder.type] || builder.type}</span>
                    <span className="ac-badge">{builder.libraryName || libraries.find((library) => library.id === builder.libraryId)?.name || (builder.libraryId ? "Library" : "All libraries")}</span>
                    <span className={`ac-badge ${live ? "is-ok" : "is-warn"}`}>{live ? "Can apply" : "Preview only"}</span>
                    {live && ["daily", "weekly"].includes(builder.options?.schedule) ? <span className="ac-badge is-ok">{builder.options.schedule === "daily" ? "Daily" : "Weekly"}</span> : null}
                  </div>
                </div>
                <span className="ac-muted">{builder.id === selectedId ? "Editing" : "Select"}</span>
              </button>
            );
          })}
        </div>
      ) : (
        <p className="ac-muted">No builders yet. Start with “Recently added” — it works straight away — or add a TMDB key for the others.</p>
      )}

      <form className="ac-form" onSubmit={save}>
        <h2>{selectedId ? "Edit builder" : "New builder"}</h2>
        <div className="ac-grid">
          <label className="ac-field">
            <span>Collection name</span>
            <input value={form.name} onChange={(event) => updateForm({ name: event.target.value })} required placeholder="Recently added movies" />
          </label>
          <label className="ac-field">
            <span>Builder</span>
            <select value={form.type} onChange={(event) => updateForm({ type: event.target.value })}>
              {Object.entries(TYPE_LABELS).map(([id, label]) => (
                <option key={id} value={id} disabled={typeUnavailable(id)}>
                  {label}
                  {TMDB_TYPES.has(id) && !status.tmdbConfigured ? " — needs TMDB key" : id === "trakt_list" && !traktConfigured ? " — needs Trakt Client ID" : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="ac-field">
            <span>Library</span>
            <select
              value={form.libraryId}
              onChange={(event) => {
                const library = libraries.find((row) => row.id === event.target.value);
                updateForm({ libraryId: event.target.value, media: library ? libraryMedia(library) : form.media });
              }}
            >
              <option value="">All libraries</option>
              {libraries.map((library) => (
                <option key={library.id} value={library.id}>
                  {library.name}
                </option>
              ))}
            </select>
          </label>
          <label className="ac-field">
            <span>Maximum titles</span>
            <input type="number" min="1" max="100" value={form.limit} onChange={(event) => updateForm({ limit: event.target.value })} />
          </label>
          {form.type === "trending" ? (
            <>
              <label className="ac-field">
                <span>Trending</span>
                <select value={form.media} onChange={(event) => updateForm({ media: event.target.value })}>
                  <option value="movie">Movies</option>
                  <option value="tv">TV shows</option>
                </select>
              </label>
              <label className="ac-field">
                <span>Window</span>
                <select value={form.window} onChange={(event) => updateForm({ window: event.target.value })}>
                  <option value="week">This week</option>
                  <option value="day">Today</option>
                </select>
              </label>
            </>
          ) : null}
        </div>
        {LIST_TYPES.has(form.type) ? (
          <label className="ac-field">
            <span>{form.type === "trakt_list" ? "Trakt list link" : "Letterboxd list link"}</span>
            <input
              type="url"
              value={form.url}
              required
              onChange={(event) => updateForm({ url: event.target.value })}
              placeholder={form.type === "trakt_list" ? "https://trakt.tv/users/name/lists/list-name" : "https://letterboxd.com/name/list/list-name/"}
            />
          </label>
        ) : null}
        {form.type === "franchise" ? <FranchisePicker value={form.collections} onChange={(collections) => updateForm({ collections })} disabled={!status.tmdbConfigured} /> : null}
        <p className="ac-muted">{TYPE_HINTS[form.type]}</p>
        <div className="ac-actions">
          <button type="submit" className="ac-btn is-primary" disabled={busy || typeUnavailable(form.type) || (form.type === "franchise" && !form.collections.length) || (LIST_TYPES.has(form.type) && !form.url.trim())}>
            {selectedId ? "Save changes" : "Save builder"}
          </button>
          {selectedId ? (
            <button type="button" className="ac-btn is-danger" disabled={busy} onClick={remove}>
              Delete
            </button>
          ) : null}
        </div>
      </form>

      {selected ? (
        <section className="ac-card ac-apply">
          <div className="ac-apply-row">
            <label className="ac-switch">
              <input type="checkbox" checked={Boolean(applyOn)} disabled={busy || !status.automationAllowed} onChange={(event) => setApply(event.target.checked)} />
              <span>
                <strong>Allow writing this collection to your media server</strong>
                <small>Off keeps the builder preview only. On lets you create or update the collection — always after a confirm.</small>
              </span>
            </label>
            <button
              type="button"
              className="ac-btn is-primary"
              disabled={busy || previewLoading || !applyOn || !preview?.items?.length || Boolean(preview?.tmdbError)}
              onClick={() =>
                setConfirm({
                  kind: "collection",
                  title: `Apply “${selected.name}”?`,
                  body: `This creates the collection “${selected.name}” with ${preview.items.length} title${preview.items.length === 1 ? "" : "s"}, or, if it already exists, adds and removes titles so it matches this preview. No media files are changed.`,
                })
              }
            >
              {busy ? "Working…" : "Apply to media server"}
            </button>
          </div>
          <label className="ac-field ac-schedule">
            <span>Refresh automatically</span>
            <select value={selected.options?.schedule || "off"} disabled={busy || !applyOn} onChange={(event) => setSchedule(event.target.value)}>
              <option value="off">Off — only when I click Apply</option>
              <option value="daily">Every day</option>
              <option value="weekly">Every week</option>
            </select>
          </label>
          {!applyOn ? <p className="ac-muted">Turn on writing above to schedule this builder.</p> : null}
          <div className="ac-poster-option">
            <label className="ac-switch">
              <input type="checkbox" checked={selected.options?.poster === "collage" || selected.options?.poster === undefined} disabled={busy} onChange={(event) => setPosterOption(event.target.checked)} />
              <span>
                <strong>Give the collection its own poster</strong>
                <small>A collage of the first four titles with the collection name, set each time it is applied.</small>
              </span>
            </label>
            {selected.options?.poster !== "none" ? (
              <div className="ac-poster-preview">
                {posterUrl ? <img src={posterUrl} alt={`${selected.name} poster preview`} /> : null}
                <button type="button" className="ac-btn" disabled={posterLoading || !preview?.items?.length} onClick={loadPosterPreview}>
                  {posterLoading ? "Rendering…" : posterUrl ? "Refresh poster preview" : "Preview poster"}
                </button>
              </div>
            ) : null}
          </div>
          {preview?.lastRun ? (
            <p className="ac-muted">
              Last applied {new Date(preview.lastRun.at).toLocaleString()} · {preview.lastRun.message}
            </p>
          ) : null}
        </section>
      ) : null}

      {selected ? (
        <section className="ac-card">
          <div className="ac-card-head">
            <h2>Collection preview</h2>
            <button type="button" className="ac-btn" disabled={previewLoading} onClick={() => loadPreview(selected.id)}>
              <RefreshLineIcon size={15} /> {previewLoading ? "Loading…" : "Refresh"}
            </button>
          </div>
          {preview ? (
            <>
              <p className="ac-muted">
                {preview.items?.length || 0} title{preview.items?.length === 1 ? "" : "s"} from your library
                {preview.sourceCount && preview.type !== "recently_added" ? ` · ${preview.sourceCount} on the ${preview.type === "trakt_list" ? "Trakt" : preview.type === "letterboxd_list" ? "Letterboxd" : "TMDB"} list` : ""}
                {preview.unmatched?.length ? (
                  <>
                    {" · "}
                    <button type="button" className="ac-inline-link" onClick={() => setShowUnmatched(!showUnmatched)}>
                      {preview.unmatched.length} not in your library
                    </button>
                  </>
                ) : null}
                .
              </p>
              {preview.tmdbError ? <p className="ac-banner is-warn">{preview.tmdbError}</p> : null}
              {showUnmatched && preview.unmatched?.length ? (
                <ul className="ac-unmatched">
                  {preview.unmatched.slice(0, 100).map((row, index) => (
                    <li key={`${row.tmdbId || row.title}-${index}`}>
                      {row.title}
                      {row.year ? ` (${row.year})` : ""}
                    </li>
                  ))}
                </ul>
              ) : null}
              <div className="ac-poster-grid">
                {(preview.items || []).slice(0, 48).map((item) => (
                  <figure key={item.id} className="ac-poster">
                    <img alt="" loading="lazy" src={`/proxy/Items/Images/Primary?id=${item.id}&fillWidth=300&quality=50`} />
                    <figcaption>
                      {item.name}
                      {item.year ? ` (${item.year})` : ""}
                      <small>{item.franchise || item.type}</small>
                    </figcaption>
                  </figure>
                ))}
              </div>
              {!preview.items?.length && !preview.tmdbError ? <p className="ac-muted">Nothing in this library matches yet.</p> : null}
            </>
          ) : (
            <p className="ac-muted">{previewLoading ? "Building the preview…" : "No preview yet."}</p>
          )}
        </section>
      ) : null}

      <section className="ac-card">
        <div className="ac-card-head">
          <div>
            <h2>Poster overlays</h2>
            <p className="ac-muted">Badges for 4K, 1080p, HDR, Dolby Vision, Atmos, DTS, 5.1 and rating, drawn on the real poster. The original is stored before any change, so you can restore it.</p>
          </div>
        </div>
        <div className="ac-toolbar">
          <label className="ac-field">
            <span>Library</span>
            <select value={overlayLibraryId} onChange={(event) => setOverlayLibraryId(event.target.value)}>
              {libraries.map((library) => (
                <option key={library.id} value={library.id}>
                  {library.name}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="ac-btn is-primary" disabled={overlayBusy || !overlayLibraryId} onClick={loadOverlays}>
            {overlayBusy ? "Rendering…" : "Render preview"}
          </button>
          {overlays?.items?.length ? (
            <>
              <button type="button" className="ac-btn" onClick={() => setOverlayPicked(new Set(overlays.items.map((item) => item.id)))}>
                Select all
              </button>
              <button
                type="button"
                className="ac-btn is-primary"
                disabled={overlayBusy || !overlayPicked.size || !status.automationAllowed}
                onClick={() =>
                  setConfirm({
                    kind: "overlays",
                    ids: [...overlayPicked],
                    title: `Add badges to ${overlayPicked.size} poster${overlayPicked.size === 1 ? "" : "s"}?`,
                    body: "The current posters are saved first, then replaced with the badged versions in your media server. You can restore the originals at any time.",
                  })
                }
              >
                Apply badges ({overlayPicked.size})
              </button>
            </>
          ) : null}
          {originalCount ? (
            <button
              type="button"
              className="ac-btn is-danger"
              disabled={overlayBusy || !status.automationAllowed}
              onClick={() =>
                setConfirm({
                  kind: "revert",
                  ids: undefined,
                  title: `Restore ${originalCount} original poster${originalCount === 1 ? "" : "s"}?`,
                  body: "Every poster JellyGlance changed goes back to the original it saved.",
                })
              }
            >
              Restore all originals ({originalCount})
            </button>
          ) : null}
        </div>
        {overlays ? (
          <div className="ac-poster-grid ac-overlay-grid">
            {overlays.items.map((item) => (
              <figure key={item.id} className={`ac-poster${overlayPicked.has(item.id) ? " is-picked" : ""}`}>
                <button type="button" onClick={() => toggleOverlay(item.id)} aria-pressed={overlayPicked.has(item.id)}>
                  <img alt={`${item.name} with badges`} src={item.preview} />
                  {overlayPicked.has(item.id) ? <CheckboxCircleFillIcon className="ac-pick" size={22} /> : null}
                </button>
                <figcaption>
                  {item.name}
                  {item.year ? ` (${item.year})` : ""}
                  <small>
                    {(item.badges || []).join(" · ") || "No badges"}
                    {item.applied ? " · applied" : ""}
                  </small>
                </figcaption>
              </figure>
            ))}
          </div>
        ) : null}
      </section>

      {/* Rendered on <body> so the scaled app shell can't trap the fixed overlay. */}
      {confirm ? createPortal(
        <div className="ac-confirm" role="dialog" aria-modal="true" aria-labelledby="ac-confirm-title">
          <div className="ac-confirm-card">
            <h2 id="ac-confirm-title">{confirm.title}</h2>
            <p>{confirm.body}</p>
            <div className="ac-actions">
              <button type="button" className="ac-btn is-primary" onClick={runConfirmed}>
                Confirm
              </button>
              <button type="button" className="ac-btn" onClick={() => setConfirm(null)}>
                Cancel
              </button>
            </div>
          </div>
        </div>,
        document.body
      ) : null}
    </div>
  );
}

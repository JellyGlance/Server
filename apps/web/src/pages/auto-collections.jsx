import { useEffect, useState } from "react";
import StackLineIcon from "remixicon-react/StackLineIcon";
import AddLineIcon from "remixicon-react/AddLineIcon";
import RefreshLineIcon from "remixicon-react/RefreshLineIcon";
import axios from "../lib/axios_instance";
import "./css/auto-collections.css";

const TYPE_LABELS = {
  trending: "Trending (TMDB)",
  recently_added: "Recently added",
  oscar_winners: "Oscar winners",
  imdb_top_250: "IMDb Top 250",
  franchise: "Franchise (TMDB collections)",
};

const emptyForm = { name: "", type: "recently_added", libraryId: "", limit: "20" };

export default function AutoCollections() {
  const [status, setStatus] = useState({ automationAllowed: true, tmdbConfigured: false, libraries: [], types: [] });
  const [builders, setBuilders] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [form, setForm] = useState(emptyForm);
  const [preview, setPreview] = useState(null);
  const [overlays, setOverlays] = useState(null);
  const [overlayLibraryId, setOverlayLibraryId] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [overlayBusy, setOverlayBusy] = useState(false);

  const selected = builders.find((builder) => builder.id === selectedId);

  const load = async () => {
    setError("");
    try {
      const [statusRes, builderRes] = await Promise.all([axios.get("/auto-collections/status"), axios.get("/auto-collections/builders")]);
      setStatus(statusRes.data);
      setBuilders(builderRes.data.builders || []);
      if (!overlayLibraryId && statusRes.data.libraries?.length) {
        const preferred = statusRes.data.libraries.find((library) => /movie|tvshow/i.test(String(library.collection_type || library.name))) || statusRes.data.libraries[0];
        setOverlayLibraryId(preferred.id);
      }
    } catch (err) {
      setError(err.response?.data?.error || "Unable to load auto collections");
    }
  };

  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (!selected) {
      setForm((current) => ({ ...emptyForm, libraryId: current.libraryId || status.libraries[0]?.id || "" }));
      setPreview(null);
      return;
    }
    setForm({
      name: selected.name,
      type: selected.type,
      libraryId: selected.libraryId || "",
      limit: selected.options?.limit || "20",
    });
    setBusy(true);
    axios.get(`/auto-collections/builders/${selected.id}/preview`)
      .then(({ data }) => setPreview(data))
      .catch((err) => setError(err.response?.data?.error || "Unable to preview"))
      .finally(() => setBusy(false));
  }, [selectedId]);

  const save = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    const payload = { name: form.name, type: form.type, libraryId: form.libraryId, options: { limit: form.limit } };
    try {
      if (selectedId) {
        const { data } = await axios.put(`/auto-collections/builders/${selectedId}`, payload);
        setBuilders((current) => current.map((builder) => (builder.id === selectedId ? data.builder : builder)));
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
    if (!selectedId || !window.confirm("Delete this builder? This does not change Jellyfin.")) return;
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

  const loadOverlays = async () => {
    setOverlayBusy(true);
    setError("");
    try {
      const { data } = await axios.get("/auto-collections/overlays/preview", { params: { libraryId: overlayLibraryId, limit: 8 } });
      setOverlays(data);
    } catch (err) {
      setError(err.response?.data?.error || "Unable to preview overlays");
    } finally {
      setOverlayBusy(false);
    }
  };

  return (
    <div className="auto-collections">
      <section className="ac-hero">
        <StackLineIcon />
        <div>
          <h1>Auto collections and poster overlays</h1>
          <p>Build Kometa-style collections from Trending, Recently added, Oscar winners, IMDb Top 250 or TMDB franchises, and preview resolution, HDR, audio and rating badges on posters. Everything stays preview-only until you enable apply, and originals are stored before any poster write.</p>
        </div>
      </section>

      {!status.automationAllowed ? (
        <p className="ac-banner is-warn">Server automation is disabled on this build. You can preview collections and overlays, but Jellyfin collections and posters will not be changed.</p>
      ) : null}
      {!status.tmdbConfigured ? (
        <p className="ac-banner is-warn">No TMDB API key is configured, so Trending, Oscars, IMDb Top 250 and Franchise previews stay empty until TMDB_API_KEY is set. Recently added still works from the local library.</p>
      ) : null}
      {error ? <p className="ac-error">{error}</p> : null}

      <div className="ac-toolbar">
        <button type="button" className="ac-btn is-primary" onClick={() => { setSelectedId(""); setForm({ ...emptyForm, libraryId: status.libraries[0]?.id || "" }); }}><AddLineIcon size={16} /> New builder</button>
        <button type="button" className="ac-btn" onClick={load}><RefreshLineIcon size={16} /> Refresh</button>
      </div>

      {builders.map((builder) => (
        <button key={builder.id} type="button" className={`ac-builder${builder.id === selectedId ? " is-selected" : ""}`} onClick={() => setSelectedId(builder.id)}>
          <div>
            <strong>{builder.name}</strong>
            <div className="ac-badges">
              <span className="ac-badge">{TYPE_LABELS[builder.type] || builder.type}</span>
              <span className="ac-badge">{builder.libraryName || "All libraries"}</span>
              <span className="ac-badge is-warn">{builder.previewOnly ? "Preview only" : "Apply enabled"}</span>
            </div>
          </div>
          <span className="ac-muted">Select</span>
        </button>
      ))}

      <form className="ac-form" onSubmit={save}>
        <h2>{selectedId ? "Edit builder" : "New builder"}</h2>
        <div className="ac-grid">
          <label className="ac-field"><span>Name</span><input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} required placeholder="Recently added movies" /></label>
          <label className="ac-field">
            <span>Builder</span>
            <select value={form.type} onChange={(event) => setForm((current) => ({ ...current, type: event.target.value }))}>
              {Object.entries(TYPE_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
          </label>
          <label className="ac-field">
            <span>Library</span>
            <select value={form.libraryId} onChange={(event) => setForm((current) => ({ ...current, libraryId: event.target.value }))}>
              <option value="">All libraries</option>
              {status.libraries.map((library) => <option key={library.id} value={library.id}>{library.name}</option>)}
            </select>
          </label>
          <label className="ac-field"><span>Limit</span><input type="number" min="1" max="100" value={form.limit} onChange={(event) => setForm((current) => ({ ...current, limit: event.target.value }))} /></label>
        </div>
        <div className="ac-actions">
          <button type="submit" className="ac-btn is-primary" disabled={busy}>Save builder</button>
          {selectedId ? <button type="button" className="ac-btn" disabled={busy} onClick={remove}>Delete</button> : null}
          <button type="button" className="ac-btn" disabled>Apply to Jellyfin is disabled</button>
        </div>
        <p className="ac-muted">New builders are saved as preview only, with apply off. Live writes need a confirm step, stored originals for posters, and server automation to be enabled.</p>
      </form>

      {preview ? (
        <section className="ac-card">
          <h2>Collection preview</h2>
          <p className="ac-muted">{preview.items?.length || 0} titles in the library{preview.unmatched?.length ? `, ${preview.unmatched.length} on the list but not in the library` : ""}.{preview.tmdbError ? ` ${preview.tmdbError}` : ""}</p>
          <div className="ac-poster-grid">
            {(preview.items || []).slice(0, 24).map((item) => (
              <figure key={item.id} className="ac-poster">
                <img alt="" src={`/proxy/Items/Images/Primary?id=${item.id}&fillWidth=300&quality=50`} />
                <figcaption>{item.name}{item.year ? ` (${item.year})` : ""}<small>{item.type}</small></figcaption>
              </figure>
            ))}
          </div>
          {!preview.items?.length ? <p className="ac-muted">No matches in this preview.</p> : null}
        </section>
      ) : null}

      <section className="ac-card">
        <h2>Poster overlay preview</h2>
        <p className="ac-muted">Server-side badges for 4K, 1080p, HDR, Dolby Vision, Atmos, DTS, 5.1 and rating. These images are previews only and never overwrite the original poster.</p>
        <div className="ac-toolbar">
          <label className="ac-field">
            <span>Library</span>
            <select value={overlayLibraryId} onChange={(event) => setOverlayLibraryId(event.target.value)}>
              {status.libraries.map((library) => <option key={library.id} value={library.id}>{library.name}</option>)}
            </select>
          </label>
          <button type="button" className="ac-btn is-primary" disabled={overlayBusy || !overlayLibraryId} onClick={loadOverlays}>{overlayBusy ? "Rendering…" : "Render preview"}</button>
        </div>
        {overlays ? (
          <div className="ac-poster-grid" style={{ marginTop: "0.8rem" }}>
            {overlays.items.map((item) => (
              <figure key={item.id} className="ac-poster">
                <img alt={`${item.name} overlay preview`} src={item.preview} />
                <figcaption>{item.name}{item.year ? ` (${item.year})` : ""}<small>{(item.badges || []).join(" · ") || "No badges"}</small></figcaption>
              </figure>
            ))}
          </div>
        ) : null}
      </section>
    </div>
  );
}

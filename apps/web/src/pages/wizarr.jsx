import { useEffect, useMemo, useState } from "react";
import AddLineIcon from "remixicon-react/AddLineIcon";
import ClipboardLineIcon from "remixicon-react/ClipboardLineIcon";
import DeleteBinLineIcon from "remixicon-react/DeleteBinLineIcon";
import ExternalLinkLineIcon from "remixicon-react/ExternalLinkLineIcon";
import MailSendLineIcon from "remixicon-react/MailSendLineIcon";
import RefreshLineIcon from "remixicon-react/RefreshLineIcon";
import SearchLineIcon from "remixicon-react/SearchLineIcon";
import UserAddLineIcon from "remixicon-react/UserAddLineIcon";
import axios from "../lib/axios_instance";
import { formatDate as formatLocaleDate } from "../lib/format-date";
import "./css/integrations.css";

const emptyForm = {
  serverIds: [],
  libraryIds: [],
  expiresInDays: 7,
  duration: "unlimited",
  unlimited: true,
  allowDownloads: false,
  allowLiveTv: false,
  allowMobileUploads: false,
  wizardBundleId: "",
  customCode: "",
  sendEmail: false,
  emailRecipient: "",
};

function formatDate(value) {
  return formatLocaleDate(value, {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }, { fallback: "Never" });
}

function statusLabel(invite) {
  const status = String(invite.status || "").toLowerCase();
  if (status === "used") return "Used";
  if (status === "expired") return "Expired";
  return "Active";
}

function cleanUsedBy(value) {
  const text = String(value || "").trim();
  if (/^<User\s+\d+>$/.test(text)) return "";
  return text;
}

export default function WizarrPage() {
  const [data, setData] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const librariesByServer = useMemo(() => {
    const map = new Map();
    (data?.libraries || []).forEach((library) => {
      const key = String(library.serverId || "");
      map.set(key, [...(map.get(key) || []), library]);
    });
    return map;
  }, [data?.libraries]);

  const selectedLibraries = useMemo(() => {
    if (!form.serverIds.length) return data?.libraries || [];
    return form.serverIds.flatMap((serverId) => librariesByServer.get(String(serverId)) || []);
  }, [data?.libraries, form.serverIds, librariesByServer]);

  const inviteStats = useMemo(() => {
    const invites = data?.invites || [];
    return invites.reduce(
      (stats, invite) => {
        const status = statusLabel(invite).toLowerCase();
        stats[status] = (stats[status] || 0) + 1;
        return stats;
      },
      { all: invites.length, active: 0, used: 0, expired: 0 }
    );
  }, [data?.invites]);

  const visibleInvites = useMemo(() => {
    const query = search.trim().toLowerCase();
    return [...(data?.invites || [])]
      .filter((invite) => statusFilter === "all" || statusLabel(invite).toLowerCase() === statusFilter)
      .filter((invite) => {
        if (!query) return true;
        return [invite.code, invite.url, invite.displayName, ...(invite.serverNames || []), cleanUsedBy(invite.usedBy)].filter(Boolean).join(" ").toLowerCase().includes(query);
      })
      .sort((first, second) => {
        const rank = { active: 0, expired: 1, used: 2 };
        const firstRank = rank[statusLabel(first).toLowerCase()] ?? 3;
        const secondRank = rank[statusLabel(second).toLowerCase()] ?? 3;
        if (firstRank !== secondRank) return firstRank - secondRank;
        return new Date(second.created || 0) - new Date(first.created || 0);
      });
  }, [data?.invites, search, statusFilter]);

  const customCodeValid = !form.customCode || /^[A-Za-z0-9]{6,10}$/.test(form.customCode.trim());
  const emailRecipientValid = !form.sendEmail || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.emailRecipient.trim());

  useEffect(() => {
    loadWizarr();
  }, []);

  async function loadWizarr() {
    try {
      setLoading(true);
      setError("");
      const response = await axios.get("/api/wizarr/summary");
      setData(response.data);
      const firstServer = response.data?.servers?.find((server) => server.verified) || response.data?.servers?.[0];
      setForm((current) => ({
        ...current,
        serverIds: current.serverIds.length ? current.serverIds : firstServer ? [firstServer.id] : [],
      }));
    } catch (loadError) {
      setError(loadError?.response?.data?.error || "Unable to load Wizarr. Check Settings > Integrations > 3rd party apps.");
    } finally {
      setLoading(false);
    }
  }

  function toggleListValue(field, value) {
    setForm((current) => {
      const existing = new Set(current[field] || []);
      if (existing.has(value)) {
        existing.delete(value);
      } else {
        existing.add(value);
      }
      return { ...current, [field]: Array.from(existing) };
    });
  }

  function updateForm(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function selectAllLibraries() {
    setForm((current) => ({ ...current, libraryIds: selectedLibraries.map((library) => library.id) }));
  }

  function clearLibraries() {
    setForm((current) => ({ ...current, libraryIds: [] }));
  }

  async function createInvite(event) {
    event.preventDefault();
    if (!form.serverIds.length) {
      setNotice("Choose at least one server.");
      return;
    }
    if (!customCodeValid) {
      setNotice("Custom invite code must be 6-10 letters or numbers.");
      return;
    }
    if (!emailRecipientValid) {
      setNotice("Enter a valid email recipient.");
      return;
    }

    try {
      setSaving(true);
      setNotice("");
      const response = await axios.post("/api/wizarr/invitations", form);
      const invite = response.data?.invitation;
      setNotice(
        response.data?.email
          ? `Invite created and emailed to ${form.emailRecipient.trim()}.`
          : invite?.url
            ? `Invite created: ${invite.url}`
            : "Invite created."
      );
      setForm((current) => ({ ...emptyForm, serverIds: current.serverIds }));
      await loadWizarr();
    } catch (createError) {
      setNotice(createError?.response?.data?.error || "Unable to create invite.");
    } finally {
      setSaving(false);
    }
  }

  async function copyInvite(invite) {
    if (!invite.url) return;
    await navigator.clipboard.writeText(invite.url);
    setNotice("Invite link copied.");
  }

  async function deleteInvite(invite) {
    if (!window.confirm(`Delete invite ${invite.code || invite.id}?`)) return;
    try {
      await axios.delete(`/api/wizarr/invitations/${encodeURIComponent(invite.id)}`);
      setNotice("Invite deleted.");
      await loadWizarr();
    } catch (deleteError) {
      setNotice(deleteError?.response?.data?.error || "Unable to delete invite.");
    }
  }

  return (
    <div className="integrations-page wizarr-page">
      <section className="integration-page-header">
        <div>
          <p>Invite manager</p>
          <h1>Wizarr Links</h1>
          <span>Create and manage Jellyfin invite links without leaving JellyGlance.</span>
        </div>
        <button type="button" className="wizarr-refresh-button" onClick={loadWizarr} disabled={loading}>
          <RefreshLineIcon size={18} />
          Refresh
        </button>
      </section>

      {notice ? <div className="integration-notice">{notice}</div> : null}
      {error ? <div className="integration-notice is-error">{error}</div> : null}

      {!error ? (
        <section className="wizarr-dashboard">
          <article>
            <span>Total invites</span>
            <strong>{data?.status?.invites ?? inviteStats.all}</strong>
            <small>All links</small>
          </article>
          <article>
            <span>Active</span>
            <strong>{inviteStats.active}</strong>
            <small>Ready to use</small>
          </article>
          <article>
            <span>Users</span>
            <strong>{data?.status?.users ?? 0}</strong>
            <small>Wizarr accounts</small>
          </article>
          <article>
            <span>Servers</span>
            <strong>{data?.servers?.length ?? 0}</strong>
            <small>Destinations</small>
          </article>
        </section>
      ) : null}

      {!error ? (
        <section className="wizarr-layout">
          <form className="wizarr-create-card" onSubmit={createInvite}>
            <div className="integration-section-title">
              <div>
                <h2>New invite</h2>
                <span>{form.serverIds.length} server selected · {form.libraryIds.length || "all"} libraries</span>
              </div>
              <UserAddLineIcon />
            </div>

            <div className="wizarr-form-section">
              <div className="wizarr-form-heading">
                <span>Servers</span>
                <small>Pick one or more verified destinations</small>
              </div>
              <div className="wizarr-choice-grid">
                {(data?.servers || []).map((server) => (
                  <button type="button" key={server.id} className={form.serverIds.includes(server.id) ? "is-selected" : ""} onClick={() => toggleListValue("serverIds", server.id)}>
                    <strong>{server.name}</strong>
                    <span>{server.type || "server"}{server.verified ? "" : " · unverified"}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="wizarr-form-section">
              <div className="wizarr-form-heading">
                <span>Libraries</span>
                <div>
                  <button type="button" onClick={selectAllLibraries} disabled={!selectedLibraries.length}>All</button>
                  <button type="button" onClick={clearLibraries} disabled={!form.libraryIds.length}>Clear</button>
                </div>
              </div>
              <div className="wizarr-choice-grid is-libraries">
                {selectedLibraries.map((library) => (
                  <button type="button" key={library.id} className={form.libraryIds.includes(library.id) ? "is-selected" : ""} onClick={() => toggleListValue("libraryIds", library.id)}>
                    <strong>{library.name}</strong>
                    <span>{library.serverName}</span>
                  </button>
                ))}
                {!selectedLibraries.length ? <span className="wizarr-empty-inline">No libraries reported by Wizarr.</span> : null}
              </div>
            </div>

            <div className="wizarr-form-grid">
              <label>
                Invite expires
                <select value={form.expiresInDays ?? ""} onChange={(event) => updateForm("expiresInDays", event.target.value ? Number(event.target.value) : "")}>
                  <option value="">Never</option>
                  <option value="1">1 day</option>
                  <option value="7">1 week</option>
                  <option value="30">1 month</option>
                </select>
              </label>
              <label>
                User access
                <select value={form.unlimited ? "unlimited" : form.duration} onChange={(event) => {
                  const value = event.target.value;
                  updateForm("unlimited", value === "unlimited");
                  updateForm("duration", value);
                }}>
                  <option value="unlimited">Unlimited</option>
                  <option value="7">7 days</option>
                  <option value="30">30 days</option>
                  <option value="90">90 days</option>
                </select>
              </label>
            </div>

            <div className="wizarr-form-grid">
              <label>
                Wizard bundle ID
                <input
                  type="number"
                  min="1"
                  step="1"
                  inputMode="numeric"
                  value={form.wizardBundleId}
                  onChange={(event) => updateForm("wizardBundleId", event.target.value.replace(/\D/g, ""))}
                  placeholder="Default"
                />
              </label>
              <label>
                Custom code
                <input
                  value={form.customCode}
                  onChange={(event) => updateForm("customCode", event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10))}
                  placeholder="Optional"
                  maxLength={10}
                  className={customCodeValid ? "" : "is-invalid"}
                />
              </label>
            </div>

            <div className="wizarr-toggle-row" aria-label="Invite permissions">
              <label>
                <input type="checkbox" checked={form.allowDownloads} onChange={(event) => updateForm("allowDownloads", event.target.checked)} />
                Downloads
              </label>
              <label>
                <input type="checkbox" checked={form.allowLiveTv} onChange={(event) => updateForm("allowLiveTv", event.target.checked)} />
                Live TV
              </label>
              <label>
                <input type="checkbox" checked={form.allowMobileUploads} onChange={(event) => updateForm("allowMobileUploads", event.target.checked)} />
                Mobile uploads
              </label>
            </div>

            <div className="wizarr-email-box">
              <label>
                <input type="checkbox" checked={form.sendEmail} onChange={(event) => updateForm("sendEmail", event.target.checked)} />
                <span>
                  <strong>Email invite</strong>
                  <small>Use the built-in SMTP settings from Newsletter.</small>
                </span>
                <MailSendLineIcon size={18} />
              </label>
              <input
                type="email"
                value={form.emailRecipient}
                onChange={(event) => updateForm("emailRecipient", event.target.value)}
                placeholder="person@example.com"
                disabled={!form.sendEmail}
                className={emailRecipientValid ? "" : "is-invalid"}
              />
            </div>

            <button type="submit" disabled={saving || loading}>
              <AddLineIcon size={18} />
              {saving ? "Creating" : "Create invite"}
            </button>
          </form>

          <section className="wizarr-invite-panel">
            <div className="wizarr-invite-toolbar">
              <div>
                <h2>Invite links</h2>
                <span>{visibleInvites.length} shown from {(data?.invites || []).length}</span>
              </div>
              <label className="wizarr-search">
                <SearchLineIcon size={18} />
                <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search code, server, user..." />
              </label>
            </div>
            <div className="wizarr-filter-row">
              {[
                ["all", `All ${inviteStats.all}`],
                ["active", `Active ${inviteStats.active}`],
                ["used", `Used ${inviteStats.used}`],
                ["expired", `Expired ${inviteStats.expired}`],
              ].map(([key, label]) => (
                <button type="button" key={key} className={statusFilter === key ? "is-active" : ""} onClick={() => setStatusFilter(key)}>
                  {label}
                </button>
              ))}
            </div>
            <div className="wizarr-invite-list">
            {visibleInvites.map((invite) => {
              const usedBy = cleanUsedBy(invite.usedBy);
              return (
              <article key={invite.id || invite.code} className={`wizarr-invite-card is-${String(statusLabel(invite)).toLowerCase()}`}>
                <div>
                  <span>{statusLabel(invite)}</span>
                  <h2>{invite.code || `Invite ${invite.id}`}</h2>
                  <p>{invite.url || invite.displayName || invite.serverNames?.join(", ") || "Wizarr invite"}</p>
                </div>
                <div className="wizarr-invite-meta">
                  <span>Created {formatDate(invite.created)}</span>
                  <span>Expires {formatDate(invite.expires)}</span>
                  {usedBy ? <span>Used by {usedBy}</span> : null}
                </div>
                <div className="wizarr-invite-actions">
                  <button type="button" onClick={() => copyInvite(invite)} disabled={!invite.url} title="Copy invite link">
                    <ClipboardLineIcon size={18} />
                  </button>
                  <a href={invite.url || "#"} target="_blank" rel="noreferrer" title="Open invite" aria-disabled={!invite.url}>
                    <ExternalLinkLineIcon size={18} />
                  </a>
                  <button type="button" className="is-danger" onClick={() => deleteInvite(invite)} title="Delete invite">
                    <DeleteBinLineIcon size={18} />
                  </button>
                </div>
              </article>
              );
            })}
            </div>
            {loading ? <div className="integration-empty-state">Loading Wizarr invites...</div> : null}
            {!loading && !visibleInvites.length ? <div className="integration-empty-state">No invite links match this view.</div> : null}
          </section>
        </section>
      ) : null}
    </div>
  );
}

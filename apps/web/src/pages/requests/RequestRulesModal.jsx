import { useEffect, useState } from "react";
import { Modal, Spinner } from "react-bootstrap";
import axios from "../../lib/axios_instance";

function authHeader() {
  return { Authorization: `Bearer ${localStorage.getItem("token")}` };
}

function NumberField({ label, value, onChange, min = 0, max = 999, suffix }) {
  return (
    <label className="request-rules-field">
      <span>{label}</span>
      <div>
        <input type="number" min={min} max={max} value={value} onChange={(event) => onChange(Number(event.target.value))} />
        {suffix ? <em>{suffix}</em> : null}
      </div>
    </label>
  );
}

function Toggle({ label, help, checked, onChange }) {
  return (
    <label className="request-rules-toggle">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <div>
        <strong>{label}</strong>
        {help ? <small>{help}</small> : null}
      </div>
    </label>
  );
}

const GENRE_SUGGESTIONS = ["Action", "Adventure", "Animation", "Comedy", "Crime", "Documentary", "Drama", "Family", "Fantasy", "Horror", "Kids", "Reality", "Romance", "Science Fiction", "Thriller"];

function newRoute(index) {
  return { id: `route-${Date.now().toString(36)}-${index}`, name: `Rule ${index + 1}`, enabled: true, users: [], genres: [], mediaType: "any", action: "hold" };
}

function outcomeLabel(entry) {
  if (entry.outcome === "approved") return "Sent to Sonarr/Radarr";
  if (entry.outcome === "held") return "Held for review";
  if (entry.outcome === "approved-by-seerr") return "Approved by Seerr";
  return entry.outcome || "—";
}

function RoutingRules({ routes, users, onChange }) {
  const update = (index, patch) => onChange(routes.map((route, i) => (i === index ? { ...route, ...patch } : route)));
  const move = (index, delta) => {
    const next = [...routes];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };
  return (
    <div className="request-routing">
      <p className="request-routing-help">
        Rules run top to bottom and the first match decides. <strong>Approve</strong> sends the request straight on to Sonarr/Radarr; <strong>Hold</strong> keeps it waiting for
        an admin. Requests that match no rule use the settings above, which hold them unless auto-approve is on.
      </p>
      {routes.length === 0 ? <p className="request-routing-empty">No routing rules yet.</p> : null}
      {routes.map((route, index) => (
        <div className={`request-routing-rule${route.enabled ? "" : " is-disabled"}`} key={route.id} data-testid="routing-rule">
          <div className="request-routing-row">
            <input type="checkbox" checked={route.enabled} onChange={(event) => update(index, { enabled: event.target.checked })} title="Enabled" />
            <input className="request-routing-name" value={route.name} onChange={(event) => update(index, { name: event.target.value })} aria-label="Rule name" />
            <select value={route.action} onChange={(event) => update(index, { action: event.target.value })} aria-label="Action">
              <option value="approve">Approve</option>
              <option value="hold">Hold</option>
            </select>
            <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => move(index, -1)} disabled={index === 0} title="Move up">↑</button>
            <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => move(index, 1)} disabled={index === routes.length - 1} title="Move down">↓</button>
            <button type="button" className="btn btn-sm btn-outline-danger" onClick={() => onChange(routes.filter((_, i) => i !== index))} title="Remove">✕</button>
          </div>
          <div className="request-routing-row">
            <label>
              <span>Type</span>
              <select value={route.mediaType} onChange={(event) => update(index, { mediaType: event.target.value })}>
                <option value="any">Movies and TV</option>
                <option value="movie">Movies</option>
                <option value="tv">TV shows</option>
              </select>
            </label>
            <label>
              <span>People</span>
              <select
                multiple
                value={route.users}
                onChange={(event) => update(index, { users: [...event.target.selectedOptions].map((option) => option.value) })}
                title="Leave empty for everyone"
              >
                {users.map((user) => (
                  <option key={user.value} value={user.value}>
                    {user.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="request-routing-genres">
              <span>Genres</span>
              <input
                list="request-routing-genres"
                value={route.genres.join(", ")}
                placeholder="Any genre"
                onChange={(event) => update(index, { genres: event.target.value.split(",").map((genre) => genre.trimStart()) })}
                onBlur={() => update(index, { genres: route.genres.map((genre) => genre.trim()).filter(Boolean) })}
              />
            </label>
          </div>
        </div>
      ))}
      <datalist id="request-routing-genres">
        {GENRE_SUGGESTIONS.map((genre) => (
          <option key={genre} value={genre} />
        ))}
      </datalist>
      <button type="button" className="btn btn-sm btn-outline-primary" onClick={() => onChange([...routes, newRoute(routes.length)])}>
        Add rule
      </button>
    </div>
  );
}

function RoutingLog({ entries }) {
  if (!entries.length) return <p className="request-routing-empty">Nothing routed yet.</p>;
  return (
    <table className="request-rules-users request-routing-log">
      <thead>
        <tr>
          <th>When</th>
          <th>Person</th>
          <th>Title</th>
          <th>Rule</th>
          <th>Result</th>
        </tr>
      </thead>
      <tbody>
        {entries.map((entry) => (
          <tr key={entry.id}>
            <td>{new Date(entry.created_at).toLocaleString()}</td>
            <td>{entry.user_name}</td>
            <td>{entry.title || `${entry.media_type} ${entry.media_id}`}</td>
            <td>{entry.route_name || "Default"}</td>
            <td className={`request-routing-outcome is-${entry.outcome}`}>{outcomeLabel(entry)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function RequestRulesModal({ show, onHide }) {
  const [users, setUsers] = useState([]);
  const [rules, setRules] = useState(null);
  const [usage, setUsage] = useState([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [log, setLog] = useState([]);

  useEffect(() => {
    if (!show) return;
    setMessage("");
    axios
      .get("/api/requests/rules", { headers: authHeader() })
      .then((response) => {
        setRules(response.data.rules);
        setUsage(response.data.usage || []);
      })
      .catch((error) => setMessage(error.response?.data?.error || "Unable to load request rules."));
    axios
      .get("/api/requests/routing-log", { headers: authHeader() })
      .then((response) => setLog(response.data.entries || []))
      .catch(() => {});
    axios
      .get("/insights-data/wrapped/years", { headers: authHeader() })
      .then((response) => setUsers((response.data.users || []).map((user) => ({ value: user.id, label: user.name }))))
      .catch(() => {});
  }, [show]);

  const set = (patch) => setRules((current) => ({ ...current, ...patch }));
  const setUser = (key, patch) =>
    setRules((current) => ({
      ...current,
      users: { ...current.users, [key]: { mode: "default", autoApprove: "default", movieLimit: current.movieLimit, tvLimit: current.tvLimit, ...(current.users[key] || {}), ...patch } },
    }));

  async function save() {
    try {
      setSaving(true);
      const response = await axios.put("/api/requests/rules", rules, { headers: authHeader() });
      setRules(response.data.rules);
      setUsage(response.data.usage || []);
      setMessage("Saved.");
    } catch (error) {
      setMessage(error.response?.data?.error || "Unable to save request rules.");
    } finally {
      setSaving(false);
    }
  }

  const usageByKey = new Map(usage.map((row) => [row.user_key, row]));
  const knownUsers = [...users];
  usage.forEach((row) => {
    if (!knownUsers.some((user) => user.value === row.user_key)) knownUsers.push({ value: row.user_key, label: row.user_name });
  });

  return (
    <Modal show={show} onHide={onHide} centered size="lg" contentClassName="requests-modal request-rules-modal">
      <Modal.Header closeButton>
        <Modal.Title>Request rules</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {!rules ? (
          message ? <p>{message}</p> : <Spinner animation="border" size="sm" />
        ) : (
          <div className="request-rules">
            <Toggle
              label="Limit how much people can request"
              help="Counts requests made through JellyGlance. When someone hits their limit, the request button tells them when their next one frees up."
              checked={rules.enabled}
              onChange={(enabled) => set({ enabled })}
            />
            <div className={`request-rules-grid${rules.enabled ? "" : " is-disabled"}`}>
              <NumberField label="Movies" value={rules.movieLimit} onChange={(movieLimit) => set({ movieLimit })} suffix="requests" />
              <NumberField label="every" value={rules.movieDays} min={1} max={365} onChange={(movieDays) => set({ movieDays })} suffix="days" />
              <NumberField label="TV shows" value={rules.tvLimit} onChange={(tvLimit) => set({ tvLimit })} suffix="requests" />
              <NumberField label="every" value={rules.tvDays} min={1} max={365} onChange={(tvDays) => set({ tvDays })} suffix="days" />
            </div>
            <Toggle label="Admins have no limit" checked={rules.exemptAdmins} onChange={(exemptAdmins) => set({ exemptAdmins })} />
            <Toggle
              label="File requests in Seerr under each person's own account"
              help="Without this, Seerr sees every JellyGlance request as coming from the admin and approves it straight away. With it on, Seerr uses that person's own approval settings and they show as the requester."
              checked={rules.requestAsSeerrUser}
              onChange={(requestAsSeerrUser) => set({ requestAsSeerrUser })}
            />
            <Toggle
              label="Auto-approve everyone"
              help="Approve new requests straight away unless a person is set to Never below. Admins are always auto-approved."
              checked={rules.autoApproveAll}
              onChange={(autoApproveAll) => set({ autoApproveAll })}
            />

            <h4>Per person</h4>
            <table className="request-rules-users">
              <thead>
                <tr>
                  <th>Person</th>
                  <th>Used</th>
                  <th>Limit</th>
                  <th>Auto-approve</th>
                </tr>
              </thead>
              <tbody>
                {knownUsers.map((user) => {
                  const rule = rules.users[user.value] || { mode: "default", autoApprove: "default" };
                  const used = usageByKey.get(user.value);
                  return (
                    <tr key={user.value}>
                      <td>{user.label}</td>
                      <td>
                        {used ? `${used.movies} movies, ${used.tv} TV` : "None"}
                      </td>
                      <td>
                        <select value={rule.mode} onChange={(event) => setUser(user.value, { mode: event.target.value })}>
                          <option value="default">Default</option>
                          <option value="custom">Custom</option>
                          <option value="unlimited">No limit</option>
                        </select>
                        {rule.mode === "custom" ? (
                          <span className="request-rules-custom">
                            <input type="number" min={0} value={rule.movieLimit ?? rules.movieLimit} onChange={(event) => setUser(user.value, { movieLimit: Number(event.target.value) })} title="Movies" /> movies
                            <input type="number" min={0} value={rule.tvLimit ?? rules.tvLimit} onChange={(event) => setUser(user.value, { tvLimit: Number(event.target.value) })} title="TV" /> TV
                          </span>
                        ) : null}
                      </td>
                      <td>
                        <select value={rule.autoApprove} onChange={(event) => setUser(user.value, { autoApprove: event.target.value })}>
                          <option value="default">Default</option>
                          <option value="always">Always</option>
                          <option value="never">Never</option>
                        </select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <h4>Smart routing</h4>
            <RoutingRules routes={rules.routes || []} users={knownUsers} onChange={(routes) => set({ routes })} />

            <h4>Routing log</h4>
            <RoutingLog entries={log} />
          </div>
        )}
      </Modal.Body>
      <Modal.Footer>
        {message ? <span className="request-rules-message">{message}</span> : null}
        <button type="button" className="btn btn-outline-secondary" onClick={onHide}>
          Close
        </button>
        <button type="button" className="btn btn-primary" onClick={save} disabled={!rules || saving}>
          {saving ? <Spinner animation="border" size="sm" /> : null} Save rules
        </button>
      </Modal.Footer>
    </Modal>
  );
}

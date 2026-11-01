import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Bar, BarChart, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Spinner } from "react-bootstrap";
import CalendarCheckLineIcon from "remixicon-react/CalendarCheckLineIcon";
import HeartPulseLineIcon from "remixicon-react/HeartPulseLineIcon";
import PulseLineIcon from "remixicon-react/PulseLineIcon";
import PlayList2LineIcon from "remixicon-react/PlayList2LineIcon";
import DeviceLineIcon from "remixicon-react/DeviceLineIcon";
import axios from "../lib/axios_instance";
import { useTranslation } from "react-i18next";
import { formatDate as formatLocaleDate } from "../lib/format-date";
import "./css/insights.css";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function authHeader() {
  return { Authorization: `Bearer ${localStorage.getItem("token")}` };
}

function hours(seconds) {
  const value = Number(seconds || 0) / 3600;
  return value >= 100 ? Math.round(value).toLocaleString() : value.toFixed(1);
}

function bytes(value) {
  const n = Number(value || 0);
  if (!n) return "–";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i >= 3 ? 1 : 0)} ${units[i]}`;
}

function dateText(value) {
  return formatLocaleDate(value, { day: "numeric", month: "short", year: "numeric" }, { fallback: "Never" });
}

function poster(id, width = 180) {
  return id ? `/proxy/Items/Images/Primary?id=${id}&fillWidth=${width}&quality=80` : "";
}

function useInsight(path, params) {
  const [state, setState] = useState({ loading: true, data: null, error: null });
  const key = JSON.stringify(params);
  useEffect(() => {
    let active = true;
    setState((current) => ({ ...current, loading: true, error: null }));
    axios
      .get(`/insights-data/${path}`, { headers: authHeader(), params })
      .then((response) => active && setState({ loading: false, data: response.data, error: null }))
      .catch((error) => {
        if (!active) return;
        const status = error.response?.status;
        setState({
          loading: false,
          data: null,
          error: status === 403 ? "Only server admins can see this." : error.response?.data?.error || "Unable to load this report.",
        });
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, key]);
  return state;
}

function Loading({ state, children }) {
  if (state.loading && !state.data) {
    return (
      <div className="insights-loading">
        <Spinner animation="border" size="sm" /> Loading…
      </div>
    );
  }
  if (state.error) return <div className="insights-error">{state.error}</div>;
  return children;
}

function Stat({ label, value, note }) {
  return (
    <article className="insights-stat">
      <span>{label}</span>
      <strong>{value}</strong>
      {note ? <small>{note}</small> : null}
    </article>
  );
}

function RankList({ title, rows, valueOf, showPoster = false }) {
  if (!rows?.length) return null;
  return (
    <section className="insights-panel">
      <h3>{title}</h3>
      <ol className="insights-rank">
        {rows.map((row, index) => (
          <li key={`${row.name}-${index}`}>
            <b>{index + 1}</b>
            {showPoster && row.item_id ? <img src={poster(row.item_id, 80)} alt="" loading="lazy" /> : null}
            <span>{row.name}</span>
            <em>{valueOf(row)}</em>
          </li>
        ))}
      </ol>
    </section>
  );
}

function isoDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function shiftAnchor(anchor, period, step) {
  const [y, m, d] = anchor.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  if (period === "week") date.setDate(date.getDate() + 7 * step);
  else if (period === "month") date.setMonth(date.getMonth() + step, 1);
  else date.setFullYear(date.getFullYear() + step, 0, 1);
  return isoDate(date);
}

function nextDay(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return isoDate(new Date(y, m - 1, d + 1));
}

function shortDay(iso) {
  const [y, m, d] = String(iso).split("-").map(Number);
  return `${d} ${MONTHS[m - 1]}${y !== new Date().getFullYear() ? ` ${y}` : ""}`;
}

function recapTitle(data) {
  if (!data) return "";
  if (data.period === "week") return `Week of ${shortDay(data.start)}`;
  if (data.period === "month") return `${MONTHS[Number(data.start.slice(5, 7)) - 1]} ${data.start.slice(0, 4)}`;
  return `${data.year} in review`;
}

const PERIODS = [
  { id: "week", label: "Week" },
  { id: "month", label: "Month" },
  { id: "year", label: "Year" },
];

function RecapDelivery({ users, selectedUserId, selectedPeriod }) {
  const [state, setState] = useState({ loading: true, data: null, error: null });
  const [form, setForm] = useState({ userId: "", period: "week", email: "", webhookId: "" });
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState(null);
  const load = () =>
    axios
      .get("/insights-data/wrapped/delivery", { headers: authHeader() })
      .then((response) => setState({ loading: false, data: response.data, error: null }))
      .catch((error) => setState({ loading: false, data: null, error: error.response?.data?.error || "Unable to load recap delivery." }));
  useEffect(() => {
    load();
  }, []);
  const data = state.data;
  useEffect(() => {
    setForm((current) => ({
      ...current,
      userId: data && !data.admin ? data.ownUserId || "" : selectedUserId || current.userId,
      period: selectedPeriod === "month" ? "month" : "week",
    }));
  }, [selectedUserId, selectedPeriod, data]);
  const nameOf = (sub) => users.find((user) => user.id === sub.userId)?.name || sub.userName || sub.userId;
  const webhookName = (id) => data?.webhooks?.find((hook) => Number(hook.id) === Number(id))?.name || `Webhook #${id}`;
  const run = async (key, action, done) => {
    setBusy(key);
    setNotice(null);
    try {
      const response = await action();
      setNotice({ ok: true, text: done(response.data) });
      await load();
    } catch (error) {
      setNotice({ ok: false, text: error.response?.data?.error || "Something went wrong." });
    } finally {
      setBusy("");
    }
  };
  const save = (event) => {
    event.preventDefault();
    run(
      "save",
      () => axios.post("/insights-data/wrapped/delivery", { ...form, webhookId: form.webhookId || null }, { headers: authHeader() }),
      () => {
        setForm((current) => ({ ...current, email: "", webhookId: "" }));
        return "Recap delivery saved.";
      }
    );
  };
  if (state.loading) return null;
  if (state.error) return <section className="insights-panel insights-delivery"><h3>Recap delivery</h3><p className="insights-muted">{state.error}</p></section>;
  const canSave = form.userId && (form.email || form.webhookId);
  return (
    <section className="insights-panel insights-delivery">
      <h3>Recap delivery</h3>
      <p className="insights-muted">
        Get each finished week or month sent automatically, with the recap card attached. Weekly recaps go out on Monday and monthly ones on the 1st.
        {data.smtpReady ? "" : " Email needs SMTP set up under Newsletter settings first."}
      </p>
      {data.subscriptions.length ? (
        <ul className="insights-delivery-list">
          {data.subscriptions.map((sub) => (
            <li key={sub.id}>
              <div>
                <strong>{nameOf(sub)}</strong> · {sub.period === "month" ? "Monthly" : "Weekly"}
                <span className="insights-muted">
                  {[sub.email, sub.webhookId ? webhookName(sub.webhookId) : null].filter(Boolean).join(" + ")}
                  {sub.lastResult ? ` · last sent ${dateText(sub.lastResult.at)}${sub.lastResult.ok ? "" : ` (failed: ${sub.lastResult.error})`}` : " · not sent yet"}
                </span>
              </div>
              <div className="insights-delivery-actions">
                <button type="button" disabled={Boolean(busy)} onClick={() => run(`send-${sub.id}`, () => axios.post(`/insights-data/wrapped/delivery/${sub.id}/send`, {}, { headers: authHeader() }), (result) => (result.ok ? `Sent “${result.title}”.` : `Send failed: ${result.error}`))}>
                  {busy === `send-${sub.id}` ? "Sending…" : "Send now"}
                </button>
                <button type="button" disabled={Boolean(busy)} onClick={() => run(`toggle-${sub.id}`, () => axios.post("/insights-data/wrapped/delivery", { id: sub.id, enabled: sub.enabled === false }, { headers: authHeader() }), () => (sub.enabled === false ? "Recap delivery resumed." : "Recap delivery paused."))}>
                  {sub.enabled === false ? "Resume" : "Pause"}
                </button>
                <button type="button" className="danger" disabled={Boolean(busy)} onClick={() => run(`del-${sub.id}`, () => axios.delete(`/insights-data/wrapped/delivery/${sub.id}`, { headers: authHeader() }), () => "Recap delivery removed.")}>
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      <form className="insights-delivery-form" onSubmit={save}>
        {data.admin ? (
          <select aria-label="User" value={form.userId} onChange={(event) => setForm({ ...form, userId: event.target.value })}>
            <option value="">Pick a user…</option>
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.name}
              </option>
            ))}
          </select>
        ) : null}
        <select aria-label="How often" value={form.period} onChange={(event) => setForm({ ...form, period: event.target.value })}>
          <option value="week">Weekly</option>
          <option value="month">Monthly</option>
        </select>
        <input type="email" placeholder="Email address" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} />
        {data.admin ? (
          <select aria-label="Webhook" value={form.webhookId} onChange={(event) => setForm({ ...form, webhookId: event.target.value })}>
            <option value="">No webhook</option>
            {data.webhooks.map((hook) => (
              <option key={hook.id} value={hook.id}>
                {hook.name}
                {hook.enabled === false ? " (disabled)" : ""}
              </option>
            ))}
          </select>
        ) : null}
        <button type="submit" className="insights-share" disabled={!canSave || Boolean(busy)}>
          {busy === "save" ? "Saving…" : "Schedule recap"}
        </button>
      </form>
      {notice ? <p className={notice.ok ? "insights-delivery-ok" : "insights-delivery-error"}>{notice.text}</p> : null}
    </section>
  );
}

function Wrapped() {
  const meta = useInsight("wrapped/years", {});
  const [period, setPeriod] = useState("year");
  const [anchor, setAnchor] = useState(isoDate(new Date()));
  const [userId, setUserId] = useState("");
  const [sharing, setSharing] = useState(false);
  const params = { period, date: anchor, userId: userId || undefined };
  const state = useInsight("wrapped", params);
  const data = state.data;
  const peakHour = useMemo(() => (data?.hours || []).reduce((best, row) => (!best || Number(row.seconds) > Number(best.seconds) ? row : best), null), [data]);
  const peakDay = useMemo(() => (data?.weekdays || []).reduce((best, row) => (!best || Number(row.seconds) > Number(best.seconds) ? row : best), null), [data]);
  const chart = useMemo(() => {
    if (!data) return [];
    const toHours = (seconds) => Math.round((Number(seconds || 0) / 3600) * 10) / 10;
    if (data.period === "year") return MONTHS.map((label, i) => ({ label, hours: toHours(data.months?.find((m) => m.month === i + 1)?.seconds) }));
    const byDay = new Map((data.days || []).map((row) => [row.day, row.seconds]));
    const rows = [];
    for (let day = data.start; day <= data.end; day = nextDay(day)) {
      const date = new Date(`${day}T12:00:00`);
      rows.push({ label: data.period === "week" ? WEEKDAYS[((date.getDay() + 6) % 7) + 1].slice(0, 3) : String(date.getDate()), hours: toHours(byDay.get(day)) });
    }
    return rows;
  }, [data]);
  const scoped = Boolean(meta.data?.scoped);
  const scopedId = scoped ? meta.data?.users?.[0]?.id || "" : "";
  useEffect(() => {
    if (scopedId) setUserId(scopedId);
  }, [scopedId]);
  const who = userId ? meta.data?.users?.find((user) => user.id === userId)?.name : scoped ? "You" : "The server";
  const atLatest = shiftAnchor(anchor, period, 1) > isoDate(new Date());
  const years = meta.data?.years || [new Date().getFullYear()];

  const share = async () => {
    setSharing(true);
    try {
      const response = await axios.get("/insights-data/wrapped/card", { headers: authHeader(), params, responseType: "blob" });
      const file = new File([response.data], `jellyglance-${data?.period || period}-${data?.start || anchor}.png`, { type: "image/png" });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: recapTitle(data) }).catch(() => {});
      } else {
        const url = URL.createObjectURL(file);
        const link = document.createElement("a");
        link.href = url;
        link.download = file.name;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } finally {
      setSharing(false);
    }
  };

  return (
    <>
      <div className="insights-pickers">
        <div className="insights-period" role="tablist" aria-label="Recap period">
          {PERIODS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={period === entry.id}
              className={period === entry.id ? "active" : ""}
              onClick={() => {
                setPeriod(entry.id);
                setAnchor(isoDate(new Date()));
              }}
            >
              {entry.label}
            </button>
          ))}
        </div>
        {period === "year" ? (
          <select value={Number(anchor.slice(0, 4))} onChange={(event) => setAnchor(Number(event.target.value) === new Date().getFullYear() ? isoDate(new Date()) : `${event.target.value}-01-01`)}>
            {years.map((entry) => (
              <option key={entry} value={entry}>
                {entry}
              </option>
            ))}
          </select>
        ) : (
          <div className="insights-step">
            <button type="button" aria-label="Previous" onClick={() => setAnchor(shiftAnchor(anchor, period, -1))}>
              ‹
            </button>
            <span>{data && data.period === period ? `${shortDay(data.start)} – ${shortDay(data.end)}` : "…"}</span>
            <button type="button" aria-label="Next" disabled={atLatest} onClick={() => setAnchor(shiftAnchor(anchor, period, 1))}>
              ›
            </button>
          </div>
        )}
        <select value={userId} onChange={(event) => setUserId(event.target.value)} disabled={scoped}>
          {scoped ? null : <option value="">Whole server</option>}
          {(meta.data?.users || []).map((user) => (
            <option key={user.id} value={user.id}>
              {user.name}
            </option>
          ))}
        </select>
        <button type="button" className="insights-share" onClick={share} disabled={sharing || !data?.totals?.plays}>
          {sharing ? "Rendering…" : "Share card"}
        </button>
      </div>
      <Loading state={state}>
        {data && data.totals?.plays ? (
          <div className="insights-wrapped">
            <section className="insights-hero">
              <span>{recapTitle(data)}</span>
              <h2>
                {who} watched <strong>{hours(data.totals.seconds)} hours</strong> across {data.totals.plays.toLocaleString()} plays.
              </h2>
              <p>
                That&apos;s {data.totals.titles.toLocaleString()} different titles over {data.totals.active_days} days
                {peakDay ? `, with ${WEEKDAYS[peakDay.dow]} as the favourite day` : ""}
                {peakHour ? ` and ${String(peakHour.hour).padStart(2, "0")}:00 as the busiest hour` : ""}.
              </p>
            </section>
            <div className="insights-stats">
              <Stat label="Top show" value={data.topShows[0]?.name || "–"} note={data.topShows[0] ? `${hours(data.topShows[0].seconds)} hours` : null} />
              <Stat label="Top movie" value={data.topMovies[0]?.name || "–"} note={data.topMovies[0] ? `${data.topMovies[0].plays} plays` : null} />
              <Stat
                label="Longest binge"
                value={data.longestBinge ? `${data.longestBinge.episodes} episodes` : "–"}
                note={data.longestBinge ? `${data.longestBinge.name} on ${dateText(data.longestBinge.day)}` : null}
              />
              <Stat label="Biggest day" value={data.busiestDay ? `${hours(data.busiestDay.seconds)} hours` : "–"} note={data.busiestDay ? dateText(data.busiestDay.day) : null} />
              <Stat label="Top genre" value={data.genres[0]?.name || "–"} note={data.genres[1] ? `then ${data.genres.slice(1, 3).map((g) => g.name).join(" and ")}` : null} />
              <Stat label="Favourite app" value={data.topClients[0]?.name || "–"} note={data.topClients[0] ? `${data.topClients[0].plays} plays` : null} />
            </div>
            <section className="insights-panel">
              <h3>{data.period === "year" ? "Hours watched each month" : "Hours watched each day"}</h3>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={chart}>
                  <XAxis dataKey="label" stroke="#8a97ad" fontSize={12} interval={data.period === "month" ? 4 : 0} />
                  <YAxis stroke="#8a97ad" fontSize={12} width={40} />
                  <Tooltip cursor={{ fill: "rgba(255,255,255,0.04)" }} contentStyle={{ background: "#101624", border: "1px solid #2a3350" }} />
                  <Bar dataKey="hours" fill="var(--primary-color, #8b5cf6)" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </section>
            <div className="insights-grid">
              <RankList title="Top shows" rows={data.topShows} valueOf={(row) => `${hours(row.seconds)} h`} showPoster />
              <RankList title="Top movies" rows={data.topMovies} valueOf={(row) => `${row.plays} plays`} showPoster />
              {data.topUsers?.length ? <RankList title="Top watchers" rows={data.topUsers} valueOf={(row) => `${hours(row.seconds)} h`} /> : null}
              <RankList title="Top genres" rows={data.genres} valueOf={(row) => `${hours(row.seconds)} h`} />
            </div>
          </div>
        ) : (
          <div className="insights-empty">No plays recorded for this {period} yet.</div>
        )}
      </Loading>
      <RecapDelivery users={meta.data?.users || []} selectedUserId={userId} selectedPeriod={period} />
    </>
  );
}

function LibraryHealth() {
  const [staleDays, setStaleDays] = useState(365);
  const state = useInsight("library-health", { staleDays });
  const data = state.data;
  const [section, setSection] = useState("stale");
  const sections = data
    ? [
        { id: "stale", label: "Not watched", count: data.stale.length },
        { id: "transcoded", label: "Often transcoded", count: data.transcoded.length },
        { id: "noSubs", label: "No subtitles", count: data.noSubs.length },
        { id: "duplicates", label: "Duplicates", count: data.duplicates.length },
        { id: "largest", label: "Largest files", count: data.largest.length },
      ]
    : [];
  return (
    <Loading state={state}>
      {data ? (
        <>
          <div className="insights-stats">
            <Stat label="Files" value={Number(data.summary.files).toLocaleString()} note={`${bytes(data.summary.total_size)} in total`} />
            <Stat label="Not watched" value={data.stale.length === 100 ? "100+" : data.stale.length} note={`${bytes(data.summary.staleSize)} could be freed`} />
            <Stat label="Often transcoded" value={data.transcoded.length} note="Transcoded twice or more in 6 months" />
            <Stat label="Duplicate movies" value={data.duplicates.length} note="Same title and year" />
          </div>
          <div className="insights-subtabs">
            {sections.map((entry) => (
              <button key={entry.id} type="button" className={section === entry.id ? "is-active" : ""} onClick={() => setSection(entry.id)}>
                {entry.label} <em>{entry.count}</em>
              </button>
            ))}
            {section === "stale" ? (
              <select value={staleDays} onChange={(event) => setStaleDays(Number(event.target.value))}>
                <option value={180}>6 months</option>
                <option value={365}>1 year</option>
                <option value={730}>2 years</option>
              </select>
            ) : null}
          </div>
          <section className="insights-panel">
            <table className="insights-table">
              {section === "stale" ? (
                <>
                  <thead><tr><th>Title</th><th>Type</th><th>Added</th><th>Last watched</th><th>Size</th></tr></thead>
                  <tbody>{data.stale.map((row) => <tr key={row.id}><td>{row.name}{row.year ? ` (${row.year})` : ""}</td><td>{row.type}</td><td>{dateText(row.added)}</td><td>{dateText(row.last_played)}</td><td>{bytes(row.size)}</td></tr>)}</tbody>
                </>
              ) : null}
              {section === "transcoded" ? (
                <>
                  <thead><tr><th>Title</th><th>Transcodes</th><th>Direct plays</th><th>Main reason</th></tr></thead>
                  <tbody>{data.transcoded.map((row) => <tr key={`${row.id}-${row.name}`}><td>{row.name}</td><td>{row.transcodes}</td><td>{row.direct}</td><td>{(row.reasons || "").replace(/[[\]"]/g, "").replace(/,/g, ", ") || "Unknown"}</td></tr>)}</tbody>
                </>
              ) : null}
              {section === "noSubs" ? (
                <>
                  <thead><tr><th>Title</th><th>Type</th><th>Size</th></tr></thead>
                  <tbody>{data.noSubs.map((row) => <tr key={row.id}><td>{row.name}</td><td>{row.type}</td><td>{bytes(row.size)}</td></tr>)}</tbody>
                </>
              ) : null}
              {section === "duplicates" ? (
                <>
                  <thead><tr><th>Title</th><th>Copies</th><th>Files</th></tr></thead>
                  <tbody>{data.duplicates.map((row) => <tr key={`${row.name}-${row.year}`}><td>{row.name}{row.year ? ` (${row.year})` : ""}</td><td>{row.copies}</td><td className="insights-paths">{row.items.map((item) => <div key={item.id}>{item.path || item.id} · {bytes(item.size)}</div>)}</td></tr>)}</tbody>
                </>
              ) : null}
              {section === "largest" ? (
                <>
                  <thead><tr><th>Title</th><th>Type</th><th>Bitrate</th><th>Size</th></tr></thead>
                  <tbody>{data.largest.map((row) => <tr key={row.id}><td>{row.name}</td><td>{row.type}</td><td>{row.bitrate ? `${(row.bitrate / 1e6).toFixed(1)} Mbps` : "–"}</td><td>{bytes(row.size)}</td></tr>)}</tbody>
                </>
              ) : null}
            </table>
          </section>
        </>
      ) : null}
    </Loading>
  );
}

const REASON_TEXT = {
  ContainerBitrateExceedsLimit: "File bitrate is above the client or remote limit",
  AudioChannelsNotSupported: "Too many audio channels for the device",
  AudioCodecNotSupported: "Audio codec not supported by the device",
  VideoCodecNotSupported: "Video codec not supported by the device",
  VideoBitrateNotSupported: "Video bitrate too high for the device",
  SubtitleCodecNotSupported: "Subtitles had to be burned in",
  ContainerNotSupported: "File container not supported",
  DirectPlayError: "Direct play failed",
  VideoLevelNotSupported: "Video profile level not supported",
  VideoRangeTypeNotSupported: "HDR type not supported",
};

function Streams() {
  const [days, setDays] = useState(30);
  const state = useInsight("streams", { days });
  const data = state.data;
  return (
    <>
      <div className="insights-pickers">
        <select value={days} onChange={(event) => setDays(Number(event.target.value))}>
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
          <option value={365}>Last year</option>
        </select>
      </div>
      <Loading state={state}>
        {data ? (
          <>
            <div className="insights-stats">
              <Stat label="Plays" value={data.summary.plays.toLocaleString()} note="Live plays only, imports excluded" />
              <Stat label="Transcoded" value={`${Math.round(data.summary.transcodeRate * 100)}%`} note={`${data.summary.transcodes} plays`} />
              <Stat label="Peak at once" value={data.summary.peak?.peak ?? 0} note={data.summary.peak ? dateText(data.summary.peak.at) : null} />
              <Stat label="Top video codec" value={data.codecs[0]?.name?.toUpperCase() || "–"} note={data.codecs[1] ? `then ${data.codecs[1].name.toUpperCase()}` : null} />
            </div>
            <section className="insights-panel">
              <h3>Plays and transcodes per day</h3>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={data.daily.map((row) => ({ ...row, day: dateText(row.day) }))}>
                  <XAxis dataKey="day" stroke="#8a97ad" fontSize={11} minTickGap={24} />
                  <YAxis stroke="#8a97ad" fontSize={12} width={32} allowDecimals={false} />
                  <Tooltip contentStyle={{ background: "#101624", border: "1px solid #2a3350" }} />
                  <Line type="monotone" dataKey="plays" name="Plays" stroke="#8b5cf6" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="transcodes" name="Transcodes" stroke="#f59e0b" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </section>
            <div className="insights-grid">
              <RankList title="Why streams transcode" rows={data.reasons.map((row) => ({ ...row, name: REASON_TEXT[row.name] || row.name }))} valueOf={(row) => `${row.plays}`} />
              <RankList title="Clients that transcode most" rows={data.clients} valueOf={(row) => `${row.transcodes} of ${row.plays}`} />
              <RankList title="Video codecs played" rows={data.codecs.map((row) => ({ ...row, name: row.name.toUpperCase() }))} valueOf={(row) => `${row.plays}`} />
              <RankList title="Play methods" rows={data.methods} valueOf={(row) => `${row.plays}`} />
            </div>
          </>
        ) : null}
      </Loading>
    </>
  );
}

function ShowCard({ row }) {
  return (
    <article className="insights-show">
      <img src={poster(row.series_id, 160)} alt="" loading="lazy" />
      <div>
        <strong>{row.series_name}</strong>
        <span>
          Next: S{row.next_season}E{row.next_episode} · {row.next_name}
        </span>
        <div className="insights-progress">
          <i style={{ width: `${Math.round(row.progress * 100)}%` }} />
        </div>
        <small>
          {row.user_name} · {row.watched} of {row.total} watched · last {dateText(row.last_watched)}
        </small>
      </div>
    </article>
  );
}

function UpNext() {
  const meta = useInsight("wrapped/years", {});
  const [userId, setUserId] = useState("");
  const state = useInsight("up-next", { userId: userId || undefined });
  const data = state.data;
  const scoped = Boolean(meta.data?.scoped);
  return (
    <>
      <div className="insights-pickers">
        <select value={userId} onChange={(event) => setUserId(event.target.value)} disabled={scoped}>
          {scoped ? null : <option value="">Everyone</option>}
          {(meta.data?.users || []).map((user) => (
            <option key={user.id} value={user.id}>
              {user.name}
            </option>
          ))}
        </select>
      </div>
      <Loading state={state}>
        {data ? (
          <>
            <section className="insights-panel">
              <h3>Up next <em>{data.upNext.length}</em></h3>
              {data.upNext.length ? <div className="insights-shows">{data.upNext.map((row) => <ShowCard key={`${row.user_id}-${row.series_id}`} row={row} />)}</div> : <div className="insights-empty">Nothing in progress.</div>}
            </section>
            <section className="insights-panel">
              <h3>Dropped for over {data.abandonDays} days <em>{data.abandoned.length}</em></h3>
              {data.abandoned.length ? <div className="insights-shows">{data.abandoned.map((row) => <ShowCard key={`${row.user_id}-${row.series_id}`} row={row} />)}</div> : <div className="insights-empty">No dropped shows.</div>}
            </section>
          </>
        ) : null}
      </Loading>
    </>
  );
}

const VERDICT_TEXT = { healthy: "Plays direct", mixed: "Sometimes transcodes", struggles: "Mostly transcodes", idle: "No plays" };

function mbps(value) {
  return value ? `${(Number(value) / 1e6).toFixed(1)} Mbps` : "–";
}

function pct(value) {
  return `${Math.round(Number(value || 0) * 100)}%`;
}

function DeviceCard({ device }) {
  const m = device.methods;
  const total = device.plays || 1;
  const segments = [
    { key: "directPlay", label: "Direct play", value: m.directPlay },
    { key: "directStream", label: "Direct stream", value: m.directStream },
    { key: "transcode", label: "Transcode", value: m.transcode },
    { key: "unknown", label: "Unknown", value: m.unknown },
  ].filter((seg) => seg.value > 0);
  return (
    <section className={`insights-panel device-card is-${device.verdict}`}>
      <header className="device-card-head">
        <div>
          <h3>{device.name}</h3>
          <small className="insights-muted">{device.client}</small>
        </div>
        <span className={`device-verdict is-${device.verdict}`}>{VERDICT_TEXT[device.verdict]}</span>
      </header>
      <div className="device-bar" aria-label="Play methods">
        {segments.map((seg) => (
          <span key={seg.key} className={`is-${seg.key}`} style={{ width: `${(seg.value / total) * 100}%` }} title={`${seg.label}: ${seg.value}`} />
        ))}
      </div>
      <div className="device-legend">
        {segments.map((seg) => (
          <span key={seg.key}>
            <i className={`is-${seg.key}`} /> {seg.label} {pct(seg.value / total)}
          </span>
        ))}
      </div>
      <dl className="device-facts">
        <div><dt>Plays</dt><dd>{device.plays.toLocaleString()}</dd></div>
        <div><dt>Watched</dt><dd>{hours(device.seconds)} h</dd></div>
        <div><dt>Typical bitrate</dt><dd>{mbps(device.avgBitrate)}</dd></div>
        <div><dt>Last seen</dt><dd>{dateText(device.lastSeen)}</dd></div>
      </dl>
      {device.reasons.length ? (
        <div className="device-reasons">
          <b>Why it transcodes</b>
          {device.reasons.map((r) => (
            <div key={r.code} className="device-reason">
              <span>{r.label} <em>×{r.count}</em></span>
              {r.hint ? <small>{r.hint}</small> : null}
            </div>
          ))}
          {device.methods.transcode ? <small className="insights-muted">Hardware accelerated: {pct(device.hardwareRate)} of transcodes</small> : null}
        </div>
      ) : null}
      <div className="device-meta">
        <div>
          <b>Apps</b>
          <div className="device-chips">
            {device.apps.slice(0, 3).map((a) => (
              <span key={a.name}>{a.name} <b>{a.plays}</b></span>
            ))}
          </div>
        </div>
        <div>
          <b>Used by</b>
          <div className="device-chips">
            {device.users.map((u) => (
              <span key={u.id || u.name}>{u.name} <b>{u.plays}</b></span>
            ))}
            {device.userCount > device.users.length ? <span>+{device.userCount - device.users.length}</span> : null}
          </div>
        </div>
      </div>
    </section>
  );
}

function Devices() {
  const [days, setDays] = useState(90);
  const [sort, setSort] = useState("recent");
  const state = useInsight("devices", { days, sort });
  const data = state.data;
  return (
    <>
      <div className="insights-pickers">
        <select value={days} onChange={(event) => setDays(Number(event.target.value))}>
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
          <option value={365}>Last year</option>
        </select>
        <select value={sort} onChange={(event) => setSort(event.target.value)}>
          <option value="recent">Recently seen</option>
          <option value="plays">Most plays</option>
          <option value="transcode">Most transcoding</option>
        </select>
      </div>
      <Loading state={state}>
        {data ? (
          <>
            <div className="insights-stats">
              <Stat label="Devices" value={data.summary.devices} note={`Seen in the last ${data.days} days`} />
              <Stat label="Plays" value={data.summary.plays.toLocaleString()} note="Live plays only, imports excluded" />
              <Stat label="Transcoded" value={pct(data.summary.transcodeRate)} note="Across all devices" />
              <Stat label="Mostly transcoding" value={data.summary.struggling} note="Devices over 50%" />
            </div>
            {data.devices.length ? (
              <div className="device-grid">
                {data.devices.map((device) => (
                  <DeviceCard key={device.key} device={device} />
                ))}
              </div>
            ) : (
              <div className="insights-empty">No plays in this period yet.</div>
            )}
          </>
        ) : null}
      </Loading>
    </>
  );
}

export const INSIGHT_TABS = [
  { id: "wrapped", label: "Recap", icon: CalendarCheckLineIcon, Component: Wrapped },
  { id: "upnext", label: "Up next", icon: PlayList2LineIcon, Component: UpNext },
  { id: "health", label: "Library health", icon: HeartPulseLineIcon, Component: LibraryHealth },
  { id: "streams", label: "Streams", icon: PulseLineIcon, Component: Streams },
  { id: "devices", label: "Devices", icon: DeviceLineIcon, Component: Devices },
];

const TABS = INSIGHT_TABS;

export default function Insights() {
  // Re-render dates and numbers in the new locale when the language changes.
  useTranslation();
  const [params, setParams] = useSearchParams();
  const active = TABS.find((tab) => tab.id === params.get("tab")) || TABS[0];
  const ActiveComponent = active.Component;
  return (
    <main className="insights-page">
      <header className="insights-header">
        <div>
          <span>Insights</span>
          <h1>{active.label}</h1>
        </div>
        <nav className="insights-tabs" role="tablist">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <button key={tab.id} type="button" role="tab" aria-selected={tab.id === active.id} className={tab.id === active.id ? "is-active" : ""} onClick={() => setParams({ tab: tab.id })}>
                <Icon size={16} />
                {tab.label}
              </button>
            );
          })}
        </nav>
      </header>
      <ActiveComponent />
    </main>
  );
}

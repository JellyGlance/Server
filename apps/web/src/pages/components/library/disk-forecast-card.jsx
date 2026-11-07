import { useEffect, useState } from "react";
import axios from "../../../lib/axios_instance";
import HardDrive2LineIcon from "remixicon-react/HardDrive2LineIcon";
import "../../css/library/disk-forecast.css";

export function formatBytes(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  let size = bytes;
  let i = 0;
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024;
    i += 1;
  }
  return `${size >= 10 || i === 0 ? size.toFixed(0) : size.toFixed(1)} ${units[i]}`;
}

function daysLabel(days) {
  if (days >= 365) {
    const years = days / 365;
    return years >= 10 ? "10+ years" : `~${years >= 2 ? Math.round(years) : years.toFixed(1)} years`;
  }
  return `~${days} day${days === 1 ? "" : "s"}`;
}

function headline(forecast) {
  switch (forecast?.status) {
    case "filling":
      return { value: daysLabel(forecast.daysUntilFull), caption: "until full at the current pace", tone: forecast.daysUntilFull <= 30 ? "danger" : forecast.daysUntilFull <= 90 ? "warn" : "ok" };
    case "stable":
      return { value: "Stable", caption: "very little has been added lately", tone: "ok" };
    case "full":
      return { value: "Full", caption: "no free space reported", tone: "danger" };
    case "no_disk":
      return { value: "—", caption: "connect Sonarr, Radarr or Lidarr to see free space", tone: "muted" };
    default:
      return { value: "Need more data", caption: forecast?.reason || "not enough library history yet", tone: "muted" };
  }
}

export function DiskForecastView({ data }) {
  const { forecast = {}, perLibrary = [], disks = [] } = data;
  const head = headline(forecast);
  const usedPct = data.totalBytes ? Math.round((data.usedBytes / data.totalBytes) * 100) : 0;
  const range = forecast.status === "filling" && forecast.rangeDays && forecast.rangeDays[1] && forecast.rangeDays[0] !== forecast.rangeDays[1] ? forecast.rangeDays : null;
  const maxLib = Math.max(1, ...perLibrary.map((l) => l.bytesPerDay));

  return (
    <section className={`disk-forecast tone-${head.tone}`} aria-label="Disk-fill forecast">
      <div className="disk-forecast-head">
        <HardDrive2LineIcon size={18} />
        <span>Disk-fill forecast</span>
        {forecast.confidence ? <span className="disk-forecast-confidence">{forecast.confidence} confidence</span> : null}
      </div>
      <div className="disk-forecast-body">
        <div className="disk-forecast-hero">
          <div className="disk-forecast-value">{head.value}</div>
          <div className="disk-forecast-caption">{head.caption}</div>
          {range ? (
            <div className="disk-forecast-range">
              between {daysLabel(range[0])} and {daysLabel(range[1])} depending on the last 30 vs 90 days
            </div>
          ) : null}
        </div>
        <dl className="disk-forecast-stats">
          <div><dt>Free</dt><dd>{data.totalBytes ? formatBytes(data.freeBytes) : "—"}</dd></div>
          <div><dt>Used</dt><dd>{data.totalBytes ? `${formatBytes(data.usedBytes)} (${usedPct}%)` : "—"}</dd></div>
          <div><dt>Added per day</dt><dd>{forecast.bytesPerDay !== undefined ? `~${formatBytes(forecast.bytesPerDay)}` : "—"}</dd></div>
          <div><dt>History</dt><dd>{forecast.historyDays || 0} days</dd></div>
        </dl>
      </div>
      {data.totalBytes ? (
        <div className="disk-forecast-bar" role="img" aria-label={`${usedPct}% used`}>
          <span style={{ width: `${usedPct}%` }} />
        </div>
      ) : null}
      {perLibrary.length ? (
        <div className="disk-forecast-libraries">
          <div className="disk-forecast-subhead">Growth by library, last 30 days</div>
          {perLibrary.slice(0, 6).map((lib) => (
            <div className="disk-forecast-lib" key={lib.id}>
              <span className="disk-forecast-lib-name">{lib.name}</span>
              <span className="disk-forecast-lib-bar"><span style={{ width: `${Math.max(3, (lib.bytesPerDay / maxLib) * 100)}%` }} /></span>
              <span className="disk-forecast-lib-value">{formatBytes(lib.bytes30d)} · {lib.items30d.toLocaleString()} items</span>
            </div>
          ))}
        </div>
      ) : null}
      <p className="disk-forecast-note">
        Based on what was added recently{disks.length ? ` and free space across ${disks.length} disk${disks.length === 1 ? "" : "s"} reported by your *arr apps` : ""}. Deletions aren&apos;t counted, so this leans towards filling sooner.
      </p>
    </section>
  );
}

export default function DiskForecastCard({ token }) {
  const [data, setData] = useState(null);

  useEffect(() => {
    let cancelled = false;
    axios
      .get("/stats/getDiskForecast", { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => !cancelled && setData(res.data))
      .catch(() => !cancelled && setData(null));
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (!data) return null;
  return <DiskForecastView data={data} />;
}

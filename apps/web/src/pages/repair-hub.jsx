import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Spinner } from "react-bootstrap";
import { Link } from "react-router-dom";
import AlertLineIcon from "remixicon-react/AlertLineIcon";
import ArrowRightLineIcon from "remixicon-react/ArrowRightLineIcon";
import CheckboxCircleLineIcon from "remixicon-react/CheckboxCircleLineIcon";
import Database2LineIcon from "remixicon-react/Database2LineIcon";
import ErrorWarningLineIcon from "remixicon-react/ErrorWarningLineIcon";
import FileSearchLineIcon from "remixicon-react/FileSearchLineIcon";
import HammerLineIcon from "remixicon-react/HammerLineIcon";
import ImageLineIcon from "remixicon-react/ImageLineIcon";
import RefreshLineIcon from "remixicon-react/RefreshLineIcon";
import TimeLineIcon from "remixicon-react/TimeLineIcon";
import Tv2LineIcon from "remixicon-react/Tv2LineIcon";
import ComputerLineIcon from "remixicon-react/ComputerLineIcon";
import { useTranslation } from "react-i18next";
import axios from "../lib/axios_instance";
import { formatDate as formatLocaleDate } from "../lib/format-date";
import "./css/repair-hub.css";

const numberFormat = new Intl.NumberFormat();

function authHeaders() {
  return {
    Authorization: `Bearer ${localStorage.getItem("token")}`,
    "Content-Type": "application/json",
  };
}

function formatNumber(value) {
  return numberFormat.format(Number(value || 0));
}

function formatDate(value, emptyLabel) {
  return formatLocaleDate(
    value,
    {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    },
    { fallback: emptyLabel || "" }
  );
}

function itemMeta(item, fallback) {
  return [item.Type, item.ProductionYear].filter(Boolean).join(" · ") || fallback;
}

function RepairMetric({ icon: Icon, label, value, detail, tone = "neutral" }) {
  return (
    <article className={`repair-metric is-${tone}`}>
      <Icon size={22} />
      <div>
        <span>{label}</span>
        <strong>{formatNumber(value)}</strong>
        <small>{detail}</small>
      </div>
    </article>
  );
}

function SampleList({ title, items, emptyText, samplesLabel, itemFallback }) {
  return (
    <section className="repair-panel">
      <div className="repair-panel-title">
        <h2>{title}</h2>
        <span>{samplesLabel}</span>
      </div>
      <div className="repair-sample-list">
        {items.map((item) => {
          const content = (
            <>
              <div>
                <strong>{item.Name}</strong>
                <span>{itemMeta(item, itemFallback)}</span>
              </div>
              <ArrowRightLineIcon size={17} />
            </>
          );
          const isItem = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(item.Id || ""));
          return isItem ? (
            <Link to={`/libraries/item/${item.Id}`} key={`${title}-${item.Id}`} className="repair-sample-row">
              {content}
            </Link>
          ) : (
            <div key={`${title}-${item.Id}-${item.Name}`} className="repair-sample-row">
              {content}
            </div>
          );
        })}
        {!items.length ? <div className="repair-empty">{emptyText}</div> : null}
      </div>
    </section>
  );
}

function RepairHub() {
  const { t } = useTranslation();
  const [summary, setSummary] = useState(null);
  const [unmatched, setUnmatched] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [scanBusy, setScanBusy] = useState(false);
  const [scanMessage, setScanMessage] = useState("");

  async function loadRepairHub() {
    try {
      setLoading(true);
      setError("");
      const [summaryResponse, unmatchedResponse] = await Promise.all([
        axios.get("/stats/repair-hub", { headers: authHeaders() }),
        axios.get("/tautulli/unmatched", { params: { limit: 6 }, headers: authHeaders() }),
      ]);
      setSummary(summaryResponse.data && typeof summaryResponse.data === "object" ? summaryResponse.data : {});
      setUnmatched(Array.isArray(unmatchedResponse.data) ? unmatchedResponse.data : []);
    } catch (requestError) {
      setError(requestError.response?.data?.error || t("FEATURES.REPAIR.LOAD_ERROR"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadRepairHub();
  }, []);

  const counts = summary?.counts || {};
  const samples = summary?.samples || {};
  const totalIssues = useMemo(
    () =>
      Number(counts.missingPosters || 0) +
      Number(counts.missingLogos || 0) +
      Number(counts.missingRuntime || 0) +
      Number(counts.emptySeries || 0) +
      Number(counts.orphanedActivity || 0) +
      Number(counts.unmatchedImports || 0) +
      Number(counts.transcodeClients || 0) +
      Number(counts.failedStarts || 0),
    [counts]
  );

  const queue = [
    {
      key: "unmatched",
      icon: Database2LineIcon,
      title: t("FEATURES.REPAIR.UNMATCHED_HISTORY"),
      count: counts.unmatchedImports,
      detail: t("FEATURES.REPAIR.LAST_SEEN", { date: formatDate(summary?.activityLinks?.unmatchedLastSeen, t("FEATURES.REPAIR.NO_RECENT")) }),
      action: "/settings?tab=tabImports",
      actionLabel: t("FEATURES.REPAIR.OPEN_IMPORTS"),
      tone: "danger",
    },
    {
      key: "posters",
      icon: ImageLineIcon,
      title: t("FEATURES.REPAIR.MISSING_POSTERS"),
      count: counts.missingPosters,
      detail: t("FEATURES.REPAIR.MISSING_POSTERS_DETAIL"),
      action: "/settings?tab=tabLibraries",
      actionLabel: t("FEATURES.REPAIR.LIBRARY_SETTINGS"),
      tone: "warning",
    },
    {
      key: "series",
      icon: Tv2LineIcon,
      title: t("FEATURES.REPAIR.EMPTY_SERIES"),
      count: counts.emptySeries,
      detail: t("FEATURES.REPAIR.EMPTY_SERIES_DETAIL"),
      action: "/settings?tab=tabLibraries",
      actionLabel: t("FEATURES.REPAIR.CHECK_SYNC"),
      tone: "warning",
    },
    {
      key: "activity",
      icon: FileSearchLineIcon,
      title: t("FEATURES.REPAIR.ORPHANED_ACTIVITY"),
      count: counts.orphanedActivity,
      detail: t("FEATURES.REPAIR.LAST_SEEN", { date: formatDate(summary?.activityLinks?.orphanedLastSeen, t("FEATURES.REPAIR.NO_RECENT")) }),
      action: "/activity",
      actionLabel: t("FEATURES.REPAIR.OPEN_ACTIVITY"),
      tone: "neutral",
    },
    {
      key: "transcodes",
      icon: ComputerLineIcon,
      title: t("FEATURES.REPAIR.TRANSCODE_CLIENTS"),
      count: counts.transcodeClients,
      detail: t("FEATURES.REPAIR.TRANSCODE_CLIENTS_DETAIL"),
      action: "/activity",
      actionLabel: t("FEATURES.REPAIR.OPEN_ACTIVITY"),
      tone: counts.transcodeClients ? "warning" : "neutral",
    },
    {
      key: "failed-starts",
      icon: AlertLineIcon,
      title: t("FEATURES.REPAIR.FAILED_STARTS"),
      count: counts.failedStarts,
      detail: t("FEATURES.REPAIR.FAILED_STARTS_DETAIL"),
      action: "/activity",
      actionLabel: t("FEATURES.REPAIR.OPEN_ACTIVITY"),
      tone: counts.failedStarts ? "danger" : "neutral",
    },
  ];

  return (
    <div className="repair-hub">
      <header className="repair-hero">
        <div>
          <span>{t("FEATURES.REPAIR.KICKER")}</span>
          <h1>{t("FEATURES.REPAIR.TITLE")}</h1>
          <p>{t("FEATURES.REPAIR.INTRO")}</p>
        </div>
        <Button type="button" onClick={loadRepairHub} disabled={loading}>
          {loading ? <Spinner size="sm" animation="border" /> : <RefreshLineIcon size={17} />}
          {t("FEATURES.REPAIR.REFRESH")}
        </Button>
        <Button
          type="button"
          variant="outline-light"
          disabled={scanBusy}
          onClick={async () => {
            setScanBusy(true);
            setScanMessage("");
            try {
              await axios.post("/api/jellyfin/refresh-library", {}, { headers: authHeaders() });
              setScanMessage(t("FEATURES.OPS.SCAN_OK"));
            } catch (requestError) {
              setScanMessage(requestError.response?.data?.error || t("FEATURES.OPS.SCAN_FAIL"));
            } finally {
              setScanBusy(false);
            }
          }}
        >
          {scanBusy ? <Spinner size="sm" animation="border" /> : <Database2LineIcon size={17} />}
          {scanBusy ? t("FEATURES.OPS.SCANNING") : t("FEATURES.OPS.SCAN_LIBRARIES")}
        </Button>
      </header>

      {error ? <Alert variant="danger">{error}</Alert> : null}
      {scanMessage ? <Alert variant="info">{scanMessage}</Alert> : null}

      <section className="repair-overview">
        <RepairMetric
          icon={totalIssues ? ErrorWarningLineIcon : CheckboxCircleLineIcon}
          label={t("FEATURES.REPAIR.QUEUE")}
          value={totalIssues}
          detail={totalIssues ? t("FEATURES.REPAIR.NEEDS_ATTENTION") : t("FEATURES.REPAIR.NOTHING_TO_REPAIR")}
          tone={totalIssues ? "danger" : "ok"}
        />
        <RepairMetric icon={ImageLineIcon} label={t("FEATURES.REPAIR.ARTWORK")} value={Number(counts.missingPosters || 0) + Number(counts.missingLogos || 0)} detail={t("FEATURES.REPAIR.POSTERS_AND_LOGOS")} tone="warning" />
        <RepairMetric icon={ComputerLineIcon} label={t("FEATURES.REPAIR.PLAYBACK_QUALITY")} value={Number(counts.transcodeClients || 0) + Number(counts.failedStarts || 0)} detail={t("FEATURES.REPAIR.PLAYBACK_QUALITY_DETAIL")} tone={counts.failedStarts ? "danger" : "neutral"} />
        <RepairMetric icon={AlertLineIcon} label={t("FEATURES.REPAIR.TASK_FAILURES")} value={counts.taskFailures} detail={t("FEATURES.REPAIR.RECENT_FAILED_LOGS")} tone={counts.taskFailures ? "danger" : "ok"} />
      </section>

      <section className="repair-queue">
        {queue.map((item) => (
          <article key={item.key} className={`repair-queue-card is-${item.tone}`}>
            <item.icon size={22} />
            <div>
              <span>{item.title}</span>
              <strong>{formatNumber(item.count)}</strong>
              <small>{item.detail}</small>
            </div>
            <Link to={item.action}>
              {item.actionLabel}
              <ArrowRightLineIcon size={16} />
            </Link>
          </article>
        ))}
      </section>

      {unmatched.length ? (
        <section className="repair-panel">
          <div className="repair-panel-title">
            <h2>{t("FEATURES.REPAIR.TAUTULLI_LINKS")}</h2>
            <Link to="/settings?tab=tabImports">{t("FEATURES.REPAIR.OPEN_LINKER")}</Link>
          </div>
          <div className="repair-unmatched-grid">
            {unmatched.map((item) => (
              <article key={`${item.SeriesName}-${item.NowPlayingItemName}-${item.MediaType}`}>
                <Database2LineIcon size={18} />
                <div>
                  <strong>{item.SeriesName ? `${item.SeriesName} - ${item.NowPlayingItemName}` : item.NowPlayingItemName}</strong>
                  <span>{item.MediaType} · {formatNumber(item.PlayCount)} {t("UNITS.PLAYS")}</span>
                  <small>{t("FEATURES.REPAIR.LAST_WATCHED", { date: formatDate(item.LastActivityDate, t("FEATURES.REPAIR.NO_RECENT")) })}</small>
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <div className="repair-sample-grid">
        <SampleList title={t("FEATURES.REPAIR.MISSING_POSTERS")} items={samples.missingPosters || []} emptyText={t("FEATURES.REPAIR.NO_POSTER_SAMPLES")} samplesLabel={t("FEATURES.REPAIR.SAMPLES", { count: (samples.missingPosters || []).length })} itemFallback={t("FEATURES.REPAIR.LIBRARY_ITEM")} />
        <SampleList title={t("FEATURES.REPAIR.MISSING_LOGOS")} items={samples.missingLogos || []} emptyText={t("FEATURES.REPAIR.NO_LOGO_SAMPLES")} samplesLabel={t("FEATURES.REPAIR.SAMPLES", { count: (samples.missingLogos || []).length })} itemFallback={t("FEATURES.REPAIR.LIBRARY_ITEM")} />
        <SampleList title={t("FEATURES.REPAIR.TRANSCODE_CLIENTS")} items={(samples.transcodeClients || []).map((row) => ({ Id: row.Client, Name: `${row.Client} · ${row.DeviceName}`, Type: t("FEATURES.REPAIR.TRANSCODES_OF_PLAYS", { transcodes: row.Transcodes, plays: row.Plays }) }))} emptyText={t("FEATURES.REPAIR.NO_TRANSCODE_CLIENTS")} samplesLabel={t("FEATURES.REPAIR.SAMPLES", { count: (samples.transcodeClients || []).length })} itemFallback={t("FEATURES.REPAIR.LIBRARY_ITEM")} />
        <SampleList title={t("FEATURES.REPAIR.FAILED_STARTS")} items={(samples.failedStarts || []).map((row) => ({ Id: row.Id, Name: row.Name, Type: t("FEATURES.REPAIR.FAILED_START_META", { count: row.Fails }) }))} emptyText={t("FEATURES.REPAIR.NO_FAILED_STARTS")} samplesLabel={t("FEATURES.REPAIR.SAMPLES", { count: (samples.failedStarts || []).length })} itemFallback={t("FEATURES.REPAIR.LIBRARY_ITEM")} />
      </div>

      <section className="repair-panel">
        <div className="repair-panel-title">
          <h2>{t("FEATURES.REPAIR.TASK_FAILURES")}</h2>
          <Link to="/settings?tab=tabLogs">{t("FEATURES.REPAIR.OPEN_LOGS")}</Link>
        </div>
        <div className="repair-task-list">
          {(samples.taskFailures || []).map((task) => (
            <article key={`${task.Id}-${task.TimeRun}`}>
              <HammerLineIcon size={18} />
              <div>
                <strong>{task.Name || task.Id}</strong>
                <span>{task.Result || t("FEATURES.REPAIR.FAILED")}</span>
              </div>
              <time>{formatDate(task.TimeRun, t("FEATURES.REPAIR.NO_RECENT"))}</time>
            </article>
          ))}
          {!(samples.taskFailures || []).length ? <div className="repair-empty">{t("FEATURES.REPAIR.NO_TASK_FAILURES")}</div> : null}
        </div>
      </section>
    </div>
  );
}

export default RepairHub;

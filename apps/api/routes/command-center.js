const express = require("express");
const API = require("../classes/api-loader");
const { getAuditLog, mergeSettings, addAuditEntry, getSettings } = require("../classes/admin-history");
const {
  clampRetentionDays,
  resolveRetention,
  rollupStatus,
  MIN_RETENTION_DAYS,
  MAX_RETENTION_DAYS,
} = require("../classes/playback-rollups");
const db = require("../db");
const { getUserPreferences, saveUserTheme } = require("../classes/user-preferences");
const Config = require("../classes/config");
const {
  buildItemGlance,
  stitchDownloads,
  buildLibraryStorage,
  buildOpsDigest,
  listWidgetCatalog,
  buildHomepageWidgets,
  buildSessionWidgets,
  buildDownloadWidgets,
  buildCalendarWidgets,
  buildLibraryWidgets,
  buildHealthWidgets,
  buildRequestWidgets,
  buildCatalogWidgets,
  buildStorageWidgets,
  buildViewerWidgets,
  buildUserWidgets,
  buildActivityWidgets,
  buildWatchWidgets,
  buildRecentWidgets,
  buildStalledWidgets,
  buildStitchedWidgets,
  buildTodayWidgets,
  buildInviteWidgets,
  buildAutobrrWidgets,
  buildTranscodeWidgets,
  buildMaintainerrWidgets,
  buildAutomationWidgets,
  buildDeviceWidgets,
  buildDigestWidgets,
  buildBackupWidgets,
  buildWebhookWidgets,
  buildJobWidgets,
  buildNowPlayingWidgets,
  buildRepairWidgets,
  buildStatisticsWidgets,
  buildIssueWidgets,
  buildNewsletterWidgets,
  buildJellyfinJobWidgets,
  fetchAutobrrHits,
  retryFailedGrab,
  stopWidgetSession,
  pauseWidgetDownload,
  runWidgetRequestAction,
  refreshWidgetItem,
  getJellyfinStatus,
} = require("../classes/command-center");

function canUseWidgetWrite(req) {
  if (req.apiKeyScope === "widgets-write" || req.apiKeyScope === "full") return true;
  if (req.apiKeyScope === "widgets") return false;
  return ["Owner", "Admin"].includes(req.user?.role);
}

const router = express.Router();

router.get("/item-glance/:id", async (req, res) => {
  /* #swagger.tags = ['Widgets'] #swagger.summary = 'Item glance' */
  try {
    const glance = await buildItemGlance(req.params.id);
    if (!glance) return res.status(404).send({ error: "Item not found" });
    res.send(glance);
  } catch (error) {
    console.error("Item glance failed:", error);
    res.status(503).send({ error: "Unable to load item glance" });
  }
});

router.get("/downloads/stitched", async (req, res) => {
  /* #swagger.tags = ['Widgets'] #swagger.summary = 'Downloads with matching requests' */
  try {
    res.send({ items: await stitchDownloads() });
  } catch (error) {
    console.error("Download stitch failed:", error);
    res.status(503).send({ error: "Unable to stitch downloads" });
  }
});

router.get("/ops-digest", async (req, res) => {
  /* #swagger.tags = ['Widgets'] #swagger.summary = 'Ops digest' */
  try {
    res.send(await buildOpsDigest());
  } catch (error) {
    console.error("Ops digest failed:", error);
    res.status(503).send({ error: "Unable to load ops digest" });
  }
});

router.get("/library-storage", async (req, res) => {
  /* #swagger.tags = ['Widgets'] #swagger.summary = 'Library storage' */
  try {
    res.send(await buildLibraryStorage());
  } catch (error) {
    console.error("Library storage failed:", error);
    res.status(503).send({ error: "Unable to load library storage" });
  }
});

router.get("/widgets", async (_req, res) => {
  /* #swagger.tags = ['Widgets'] #swagger.summary = 'List widget endpoints' */
  res.send(listWidgetCatalog());
});

router.get("/widgets/homepage", async (req, res) => {
  /* #swagger.tags = ['Widgets'] #swagger.summary = 'Dashboard snapshot' */
  try {
    res.send(await buildHomepageWidgets());
  } catch (error) {
    console.error("Homepage widget failed:", error);
    res.status(503).send({ error: "Unable to load widget" });
  }
});

router.get("/widgets/sessions", async (_req, res) => {
  /* #swagger.tags = ['Widgets'] #swagger.summary = 'Playback counts' */
  try {
    res.send(await buildSessionWidgets());
  } catch (error) {
    console.error("Session widget failed:", error);
    res.status(503).send({ error: "Unable to load session widget" });
  }
});

router.get("/widgets/downloads", async (_req, res) => {
  /* #swagger.tags = ['Widgets'] #swagger.summary = 'Download queue snapshot' */
  try {
    res.send(await buildDownloadWidgets());
  } catch (error) {
    console.error("Download widget failed:", error);
    res.status(503).send({ error: "Unable to load download widget" });
  }
});

router.get("/widgets/calendar", async (_req, res) => {
  /* #swagger.tags = ['Widgets'] #swagger.summary = 'Arr calendar snapshot' */
  try {
    res.send(await buildCalendarWidgets());
  } catch (error) {
    console.error("Calendar widget failed:", error);
    res.status(503).send({ error: "Unable to load calendar widget" });
  }
});

router.get("/widgets/libraries", async (_req, res) => {
  /* #swagger.tags = ['Widgets'] #swagger.summary = 'Library sizes' */
  try {
    res.send(await buildLibraryWidgets());
  } catch (error) {
    console.error("Library widget failed:", error);
    res.status(503).send({ error: "Unable to load library widget" });
  }
});

router.get("/widgets/health", async (_req, res) => {
  /* #swagger.tags = ['Widgets'] #swagger.summary = 'Ops and Jellyfin health' */
  try {
    res.send(await buildHealthWidgets());
  } catch (error) {
    console.error("Health widget failed:", error);
    res.status(503).send({ error: "Unable to load health widget" });
  }
});

router.get("/widgets/requests", async (_req, res) => {
  /* #swagger.tags = ['Widgets'] #swagger.summary = 'Seerr request counts' */
  try {
    res.send(await buildRequestWidgets());
  } catch (error) {
    console.error("Request widget failed:", error);
    res.status(503).send({ error: "Unable to load request widget" });
  }
});

const extraWidgetRoutes = [
  ["catalog", buildCatalogWidgets, "Catalog totals"],
  ["storage", buildStorageWidgets, "Library storage"],
  ["viewers", buildViewerWidgets, "Viewers today"],
  ["users", buildUserWidgets, "User roster"],
  ["activity", buildActivityWidgets, "Recent playback"],
  ["watch", buildWatchWidgets, "Watch time"],
  ["recent", buildRecentWidgets, "Recently added"],
  ["stalled", buildStalledWidgets, "Stalled downloads"],
  ["stitched", buildStitchedWidgets, "Cached download queue"],
  ["today", buildTodayWidgets, "Releases today"],
  ["invites", buildInviteWidgets, "Wizarr invites"],
  ["autobrr", buildAutobrrWidgets, "autobrr hits"],
  ["transcodes", buildTranscodeWidgets, "Tdarr queue"],
  ["maintainerr", buildMaintainerrWidgets, "Maintainerr cleanup"],
  ["automation", buildAutomationWidgets, "Integration health"],
  ["devices", buildDeviceWidgets, "Known devices"],
  ["digest", buildDigestWidgets, "Ops digest"],
  ["backup", buildBackupWidgets, "Backup hint"],
  ["webhooks", buildWebhookWidgets, "Webhook deliveries"],
  ["jobs", buildJobWidgets, "Task history"],
  ["nowplaying", buildNowPlayingWidgets, "Now playing"],
  ["repair", buildRepairWidgets, "Repair gaps"],
  ["statistics", buildStatisticsWidgets, "Weekly stats"],
  ["issues", buildIssueWidgets, "Seerr issues"],
  ["newsletter", buildNewsletterWidgets, "Newsletter"],
  ["jellyfin-jobs", buildJellyfinJobWidgets, "Jellyfin tasks"],
];

router.post("/widgets/sessions/stop", async (req, res) => {
  /* #swagger.tags = ['Widgets'] #swagger.summary = 'Stop a live session' */
  if (!canUseWidgetWrite(req)) {
    return res.status(403).send({ error: "widgets-write key or admin session required" });
  }
  try {
    const sessionId = String(req.body?.sessionId || "").trim();
    if (!sessionId) return res.status(400).send({ error: "Missing sessionId" });
    await stopWidgetSession(sessionId);
    await addAuditEntry(req, "widget.session.stopped", { sessionId });
    res.send({ ok: true });
  } catch (error) {
    console.error("Widget session stop failed:", error);
    res.status(error.statusCode || 503).send({ error: error.message || "Unable to stop session" });
  }
});

router.post("/widgets/downloads/pause", async (req, res) => {
  /* #swagger.tags = ['Widgets'] #swagger.summary = 'Pause or resume a download' */
  if (!canUseWidgetWrite(req)) {
    return res.status(403).send({ error: "widgets-write key or admin session required" });
  }
  try {
    const id = String(req.body?.id || "").trim();
    if (!id) return res.status(400).send({ error: "Missing download id" });
    res.send(await pauseWidgetDownload(id, Boolean(req.body?.paused)));
  } catch (error) {
    console.error("Widget download pause failed:", error);
    res.status(error.statusCode || 503).send({ error: error.message || "Unable to update download" });
  }
});

router.post("/widgets/requests/actions", async (req, res) => {
  /* #swagger.tags = ['Widgets'] #swagger.summary = 'Approve, decline, or retry a request' */
  if (!canUseWidgetWrite(req)) {
    return res.status(403).send({ error: "widgets-write key or admin session required" });
  }
  try {
    const requestId = req.body?.requestId || req.body?.id;
    const action = String(req.body?.action || "").toLowerCase();
    if (!requestId || !action) return res.status(400).send({ error: "requestId and action are required" });
    res.send(
      await runWidgetRequestAction({
        requestId,
        sourceId: req.body?.sourceId,
        action,
      })
    );
  } catch (error) {
    console.error("Widget request action failed:", error);
    res.status(error.statusCode || 503).send({ error: error.message || "Unable to update request" });
  }
});

router.post("/widgets/repair/refresh", async (req, res) => {
  /* #swagger.tags = ['Widgets'] #swagger.summary = 'Refresh a Jellyfin item' */
  if (!canUseWidgetWrite(req)) {
    return res.status(403).send({ error: "widgets-write key or admin session required" });
  }
  try {
    const itemId = String(req.body?.itemId || "").trim();
    if (!itemId) return res.status(400).send({ error: "itemId is required" });
    await refreshWidgetItem(itemId, req.body?.recursive !== false);
    await addAuditEntry(req, "widget.repair.refresh", { itemId });
    res.send({ ok: true });
  } catch (error) {
    console.error("Widget repair refresh failed:", error);
    res.status(error.statusCode || 503).send({ error: error.message || "Unable to refresh item" });
  }
});

for (const [slug, builder, summary] of extraWidgetRoutes) {
  router.get(`/widgets/${slug}`, async (_req, res) => {
    /* #swagger.tags = ['Widgets'] */
    try {
      res.send(await builder());
    } catch (error) {
      console.error(`${summary} widget failed:`, error);
      res.status(503).send({ error: `Unable to load ${slug} widget` });
    }
  });
}

router.get("/admin-audit/export", async (req, res) => {
  try {
    const rows = await getAuditLog();
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", "attachment; filename=jellyglance-audit.json");
    res.send(JSON.stringify(rows, null, 2));
  } catch (error) {
    res.status(503).send({ error: "Unable to export audit log" });
  }
});

router.post("/admin-audit/retention", async (req, res) => {
  try {
    const retention = Math.min(2000, Math.max(20, Number(req.body?.retention || 100)));
    await mergeSettings({ AdminAuditRetention: retention });
    res.send({ ok: true, retention });
  } catch (error) {
    res.status(500).send({ error: "Unable to save retention" });
  }
});

// Raw playback retention. Off unless an admin turns it on; pruning is irreversible.
router.get("/playback-retention", async (req, res) => {
  try {
    const settings = await getSettings();
    const retention = resolveRetention(settings);
    const status = await rollupStatus(db.pool).catch(() => null);
    res.send({
      days: retention.days,
      source: retention.source,
      min_days: MIN_RETENTION_DAYS,
      max_days: MAX_RETENTION_DAYS,
      rollups: status,
    });
  } catch (error) {
    res.status(503).send({ error: "Unable to load playback retention" });
  }
});

router.post("/playback-retention", async (req, res) => {
  try {
    const days = clampRetentionDays(req.body?.days);
    // Turning pruning on deletes history for good, so it has to be confirmed explicitly.
    if (days > 0 && req.body?.confirm !== true) {
      return res.status(400).send({ error: "Confirm that old raw playback history will be deleted permanently." });
    }
    await mergeSettings({ PlaybackRetentionDays: days });
    await addAuditEntry(req, "playback-retention.update", { days });
    const effective = resolveRetention({ PlaybackRetentionDays: days });
    res.send({ ok: true, days, effective_days: effective.days, source: effective.source });
  } catch (error) {
    res.status(500).send({ error: "Unable to save playback retention" });
  }
});

router.post("/setBackupDestination", async (req, res) => {
  try {
    const dest = req.body || {};
    await mergeSettings({
      BackupDestination: {
        kind: String(dest.kind || "local").toLowerCase(),
        url: String(dest.url || "").trim(),
        username: String(dest.username || "").trim(),
        secret: String(dest.secret || "").trim(),
        bucket: String(dest.bucket || "").trim(),
        region: String(dest.region || "us-east-1").trim(),
        prefix: String(dest.prefix || "").trim(),
      },
    });
    res.send({ ok: true });
  } catch (error) {
    res.status(500).send({ error: "Unable to save backup destination" });
  }
});

router.get("/autobrr/hits", async (req, res) => {
  try {
    const { getIntegrationData } = require("../classes/integration-store");
    const live = await fetchAutobrrHits();
    if (live.length) {
      res.send({ items: live });
      return;
    }
    const cached = await getIntegrationData();
    res.send({ items: cached.autobrr?.hits || [] });
  } catch (error) {
    console.error("autobrr hits failed:", error);
    res.status(503).send({ error: "Unable to load autobrr hits" });
  }
});

router.post("/retry-grab", async (req, res) => {
  try {
    const result = await retryFailedGrab(req.body || {});
    if (!result.ok) {
      res.status(502).send({ error: result.error || "Unable to retry grab", ...result });
      return;
    }
    res.send(result);
  } catch (error) {
    console.error("Retry grab failed:", error);
    res.status(503).send({ error: error.message || "Unable to retry grab" });
  }
});

router.get("/preferences", async (req, res) => {
  try {
    res.send(await getUserPreferences(req.user));
  } catch (error) {
    res.status(error.statusCode || 503).send({ error: error.message || "Unable to load preferences" });
  }
});

router.put("/preferences", async (req, res) => {
  try {
    const theme = await saveUserTheme(req.user, req.body?.theme || req.body || {});
    new Config().clearCache();
    res.send({ theme });
  } catch (error) {
    res.status(error.statusCode || 503).send({ error: error.message || "Unable to save preferences" });
  }
});

router.get("/jellyfin/status", async (req, res) => {
  /* #swagger.tags = ['Widgets'] #swagger.summary = 'Jellyfin status' */
  try {
    res.send(await getJellyfinStatus());
  } catch (error) {
    res.status(503).send({ ok: false, error: error.message || "Unable to reach Jellyfin" });
  }
});

router.post("/jellyfin/refresh-item", async (req, res) => {
  try {
    const itemId = String(req.body?.itemId || "").trim();
    if (!itemId) {
      res.status(400).send({ error: "itemId is required" });
      return;
    }
    await API.refreshItem(itemId, { recursive: req.body?.recursive !== false });
    await addAuditEntry(req, "jellyfin.refresh-item", { itemId });
    res.send({ ok: true });
  } catch (error) {
    console.error("Jellyfin item refresh failed:", error);
    res.status(error.statusCode || 503).send({ error: error.message || "Unable to refresh item" });
  }
});

router.post("/jellyfin/refresh-library", async (req, res) => {
  try {
    await API.refreshLibrary();
    await addAuditEntry(req, "jellyfin.refresh-library", {});
    res.send({ ok: true });
  } catch (error) {
    console.error("Jellyfin library scan failed:", error);
    res.status(error.statusCode || 503).send({ error: error.message || "Unable to scan libraries" });
  }
});

module.exports = router;

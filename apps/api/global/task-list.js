const TaskName = require("../logging/taskName");

const Tasks = {
  Backup: { path: "./tasks/BackupTask.js", name: TaskName.backup },
  Restore: { path: "./tasks/BackupTask.js", name: TaskName.restore },
  JellyfinSync: { path: "./tasks/FullSyncTask.js", name: TaskName.fullsync },
  PartialJellyfinSync: { path: "./tasks/RecentlyAddedItemsSyncTask.js", name: TaskName.partialsync },
  JellyfinPlaybackReportingPluginSync: { path: "./tasks/PlaybackReportingPluginSyncTask.js", name: TaskName.import },
  RefreshDashboardStats: { path: "./tasks/RefreshDashboardStatsTask.js", name: "Refresh Dashboard Stats" },
  ClearStaleTasks: { path: "./tasks/ClearStaleTasksTask.js", name: "Clear Stale Task Logs" },
  WebhookHealthCheck: { path: "./tasks/WebhookHealthCheckTask.js", name: "Webhook Health Check" },
  IntegrationSync: { path: "./tasks/IntegrationSyncTask.js", name: "Integration Sync" },
  ArrCalendarSync: { path: "./tasks/ArrCalendarSyncTask.js", name: "Arr Calendar Sync" },
  DownloadQueueSync: { path: "./tasks/DownloadQueueSyncTask.js", name: "Download Queue Sync" },
  InviteSync: { path: "./tasks/InviteSyncTask.js", name: "Invite Sync" },
  IntegrationHealthCheck: { path: "./tasks/IntegrationHealthCheckTask.js", name: "Integration Health Check" },
  NewsletterCampaigns: { path: "./tasks/NewsletterCampaignsTask.js", name: "Newsletter Campaigns" },
  WrappedRecaps: { path: "./tasks/WrappedRecapsTask.js", name: "Wrapped Recaps" },
};

module.exports = Tasks;

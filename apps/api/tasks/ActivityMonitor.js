const db = require("../db");

const dayjs = require("dayjs");
const { columnsPlayback } = require("../models/jf_playback_activity");
const { jf_activity_watchdog_columns, jf_activity_watchdog_mapping } = require("../models/jf_activity_watchdog");
const configClass = require("../classes/config");
const API = require("../classes/api-loader");
const { sendUpdate } = require("../ws");
const { isNumber } = require("../utils/typeValidation");
const WebhookManager = require("../classes/webhook-manager");
const { matchRecentPlayback, playSessionIdOf, sessionMatchesWatchdog } = require("../utils/playback-sessions");
const { createPlaybackNotifier } = require("../utils/playback-notify");

const MINIMUM_SECONDS_TO_INCLUDE_PLAYBACK = process.env.MINIMUM_SECONDS_TO_INCLUDE_PLAYBACK
  ? Number(process.env.MINIMUM_SECONDS_TO_INCLUDE_PLAYBACK)
  : 1;

const NEW_WATCH_EVENT_THRESHOLD_HOURS = process.env.NEW_WATCH_EVENT_THRESHOLD_HOURS
  ? Math.max(Math.min(Number(process.env.NEW_WATCH_EVENT_THRESHOLD_HOURS), 12), 1)
  : 1;

const webhookManager = new WebhookManager();

function playbackStreamDetails(session, item) {
  const streams = Array.isArray(item?.MediaStreams) && item.MediaStreams.length
    ? item.MediaStreams
    : Array.isArray(session.MediaStreams)
      ? session.MediaStreams
      : [];
  const video = streams.find((stream) => stream?.Type === "Video") || null;
  const audio = streams.find((stream) => stream?.Type === "Audio" && stream?.IsDefault) || streams.find((stream) => stream?.Type === "Audio") || null;
  const transcode = session.TranscodingInfo || null;
  return {
    videoHeight: Number(video?.Height) || null,
    videoCodec: video?.Codec || null,
    videoRange: video?.VideoRangeType || video?.VideoRange || null,
    audioCodec: audio?.Codec || null,
    audioChannels: Number(audio?.Channels) || null,
    transcodeReasons: Array.isArray(transcode?.TranscodeReasons) ? transcode.TranscodeReasons.slice(0, 3) : [],
    transcodeVideoCodec: transcode?.VideoCodec || null,
  };
}

function playbackWebhookData(session, ended = false) {
  const item = session.NowPlayingItem;
  const posterItemId = item?.SeriesId || item?.Id || session.NowPlayingItemId;
  const episodeId = item?.SeriesId ? item.Id : session.EpisodeId;
  return {
    sessionInfo: {
      sessionId: session.Id,
      playSessionId: playSessionIdOf(session) || undefined,
      userId: session.UserId,
      deviceId: session.DeviceId,
      deviceName: session.DeviceName,
      clientName: session.Client,
      applicationVersion: session.ApplicationVersion,
      playMethod: session.PlayMethod || session.PlayState?.PlayMethod,
      isPaused: Boolean(session.IsPaused ?? session.PlayState?.IsPaused),
      playbackDuration: Number(session.PlaybackDuration || 0),
      startTime: session.ActivityDateInserted,
      endTime: ended ? new Date().toISOString() : undefined,
    },
    userData: {
      username: session.UserName,
      userId: session.UserId,
      userImageTag: session.UserPrimaryImageTag,
    },
    mediaInfo: {
      itemId: item?.Id || session.NowPlayingItemId,
      posterItemId,
      episodeId,
      seasonId: item?.SeasonId || session.SeasonId,
      seasonNumber: session.SeasonNumber ?? item?.ParentIndexNumber,
      episodeNumber: session.EpisodeNumber ?? item?.IndexNumber,
      mediaType: episodeId || item?.SeriesId ? "Episode" : "Movie",
      mediaName: session.NowPlayingItemName || item?.Name,
      seriesName: session.SeriesName || item?.SeriesName,
      playMethod: session.PlayMethod || session.PlayState?.PlayMethod,
      productionYear: item?.ProductionYear || null,
      officialRating: item?.OfficialRating || null,
      communityRating: Number(item?.CommunityRating) || null,
      genres: Array.isArray(item?.Genres) ? item.Genres.slice(0, 3) : [],
      overview: item?.Overview ? String(item.Overview).slice(0, 400) : null,
      runTimeTicks: Number(item?.RunTimeTicks || session.RunTimeTicks) || null,
      positionTicks: Number(session.PlayState?.PositionTicks) || null,
      ...playbackStreamDetails(session, item),
    },
  };
}

function applyLiveSessionToWatchdog(wdData, sessionData) {
  const mapped = jf_activity_watchdog_mapping(sessionData);
  let changed = wdData.NowPlayingItemId !== mapped.NowPlayingItemId
    || wdData.EpisodeId !== mapped.EpisodeId
    || wdData.DeviceId !== mapped.DeviceId
    || wdData.IsPaused != mapped.IsPaused
    || wdData.NowPlayingItemName !== mapped.NowPlayingItemName
    || wdData.Client !== mapped.Client;

  if (!changed) return false;

  wdData.DeviceId = mapped.DeviceId;
  wdData.DeviceName = mapped.DeviceName;
  wdData.Client = mapped.Client;
  wdData.ApplicationVersion = mapped.ApplicationVersion;
  wdData.NowPlayingItemId = mapped.NowPlayingItemId;
  wdData.NowPlayingItemName = mapped.NowPlayingItemName;
  wdData.EpisodeId = mapped.EpisodeId;
  wdData.SeasonId = mapped.SeasonId;
  wdData.SeriesName = mapped.SeriesName;
  wdData.PlayMethod = mapped.PlayMethod;
  wdData.UserPrimaryImageTag = mapped.UserPrimaryImageTag;
  wdData.SeasonNumber = mapped.SeasonNumber;
  wdData.EpisodeNumber = mapped.EpisodeNumber;
  wdData.MediaStreams = mapped.MediaStreams;
  wdData.TranscodingInfo = mapped.TranscodingInfo;
  wdData.PlayState = mapped.PlayState;
  wdData.OriginalContainer = mapped.OriginalContainer;
  wdData.RemoteEndPoint = mapped.RemoteEndPoint;
  wdData.ServerId = mapped.ServerId;

  if (wdData.IsPaused != mapped.IsPaused) {
    if (mapped.IsPaused == true) {
      const startTime = dayjs(wdData.ActivityDateInserted);
      const lastPausedDate = dayjs(sessionData.LastPausedDate, "YYYY-MM-DD HH:mm:ss.SSSZ");
      wdData.PlaybackDuration = parseInt(wdData.PlaybackDuration) + lastPausedDate.diff(startTime, "seconds");
      wdData.ActivityDateInserted = `${lastPausedDate.format("YYYY-MM-DD HH:mm:ss.SSSZ")}`;
    } else {
      wdData.ActivityDateInserted = dayjs().format("YYYY-MM-DD HH:mm:ss.SSSZ");
    }
  }
  wdData.IsPaused = mapped.IsPaused;
  return true;
}

async function getSessionsInWatchDog(SessionData, WatchdogData) {
  return WatchdogData.filter((wdData) => {
    const sessionData = SessionData.find((session) => sessionMatchesWatchdog(session, wdData));
    if (!sessionData) return false;
    return applyLiveSessionToWatchdog(wdData, sessionData);
  });
}

async function getSessionsNotInWatchDog(SessionData, WatchdogData) {
  return SessionData.filter((sessionData) => {
    if (WatchdogData.length === 0) return true;
    return !WatchdogData.some((wdData) => sessionMatchesWatchdog(sessionData, wdData));
  }).map(jf_activity_watchdog_mapping);
}

function getWatchDogNotInSessions(SessionData, WatchdogData) {
  const removedData = WatchdogData.filter((wdData) => {
    if (SessionData.length === 0) return true;
    return !SessionData.some((sessionData) => sessionMatchesWatchdog(sessionData, wdData));
  });

  //this is to update the playback duration for the removed items where it was playing before stopped as duration is only updated on pause

  removedData.map((obj) => {
    obj.Id = obj.ActivityId;
    const startTime = dayjs(obj.ActivityDateInserted);
    const endTime = dayjs();

    const diffInSeconds = endTime.diff(startTime, "seconds");

    if (obj.IsPaused == false) {
      obj.PlaybackDuration = parseInt(obj.PlaybackDuration) + diffInSeconds;
    }

    obj.ActivityDateInserted = endTime.format("YYYY-MM-DD HH:mm:ss.SSSZ");
    const { ...rest } = obj;

    return { ...rest };
  });
  return removedData;
}

let currentIntervalId = null;
let lastHadActiveSessions = false;
let emptySessionPolls = 0;
let cachedPollingSettings = {
  activeSessionsInterval: 1000,
  idleInterval: 5000,
};

const playbackNotifier = createPlaybackNotifier({
  firstStartStableMs: 2500,
  itemChangeStableMs: 8000,
  endGraceMs: Number(process.env.PLAYBACK_WEBHOOK_END_GRACE_MS) || 90_000,
  pausedGraceMs: Number(process.env.PLAYBACK_WEBHOOK_PAUSED_GRACE_MS) || 30 * 60 * 1000,
});

async function recordFinishedPlayback(dataToRemove) {
  const toDeleteIds = dataToRemove.map((row) => row.ActivityId);

  //get data from jf_playback_activity within the last hour with progress of <=80% for current items in session
  const ExistingRecords = await db
    .query(`SELECT * FROM jf_recent_playback_activity(${NEW_WATCH_EVENT_THRESHOLD_HOURS})`)
    .then((res) => {
      if (res.rows && Array.isArray(res.rows) && res.rows.length > 0) {
        return res.rows.filter(
          (row) =>
            dataToRemove.some((pbi) => pbi.NowPlayingItemId === row.NowPlayingItemId && pbi.EpisodeId === row.EpisodeId) &&
            row.Progress <= 80.0,
        );
      }
      return [];
    })
    .catch((err) => {
      console.error("Error fetching existing records:", err);
      return [];
    });

  //a playback picked up again within the threshold adds to its earlier row, unless that would run past the item's runtime.
  //each earlier row takes at most one playback, and a stream that ran alongside it gets its own row.
  const merges = matchRecentPlayback(dataToRemove, ExistingRecords, {
    withinRuntime: (existing, playbackData) =>
      existing.RunTimeTicks == undefined ||
      !isNumber(existing.RunTimeTicks) ||
      (Number(existing.PlaybackDuration) + Number(playbackData.PlaybackDuration)) * 10000000 <= Number(existing.RunTimeTicks),
  });

  const ExistingDataToUpdate = [];
  let playbackToInsert = [];
  for (const playbackData of dataToRemove) {
    const existingrow = merges.get(playbackData);
    if (existingrow) {
      playbackData.Id = existingrow.Id;
      playbackData.PlaybackDuration = Number(existingrow.PlaybackDuration) + Number(playbackData.PlaybackDuration);
      playbackData.ActivityDateInserted = dayjs().format("YYYY-MM-DD HH:mm:ss.SSSZ");
      ExistingDataToUpdate.push(playbackData);
    } else {
      playbackToInsert.push(playbackData);
    }
  }

  //skip anything too short to count
  playbackToInsert = playbackToInsert.filter((pb) => pb.PlaybackDuration >= MINIMUM_SECONDS_TO_INCLUDE_PLAYBACK);
  const updates = ExistingDataToUpdate.filter((pb) => pb.PlaybackDuration >= MINIMUM_SECONDS_TO_INCLUDE_PLAYBACK);

  if (toDeleteIds.length > 0) {
    await db.deleteBulk("jf_activity_watchdog", toDeleteIds, "ActivityId");
    console.log("Removed Data from WD Count: ", dataToRemove.length);
  }
  if (playbackToInsert.length > 0) {
    await db.insertBulk("jf_playback_activity", playbackToInsert, columnsPlayback);
    console.log("Activity inserted/updated Count: ", playbackToInsert.length);
  }
  if (updates.length > 0) {
    await db.insertBulk("jf_playback_activity", updates, columnsPlayback);
  }
}

async function ActivityMonitor(defaultInterval) {
  // console.log("Activity Monitor started with default interval: " + defaultInterval);

  const runMonitoring = async () => {
    try {
      const config = await new configClass().getConfig();

      if (config.error || config.state !== 2) {
        return;
      }

      // Get adaptive polling settings from config
      const pollingSettings = config.settings?.ActivityMonitorPolling || {
        activeSessionsInterval: 1000,
        idleInterval: 5000,
      };

      // Check if polling settings have changed
      const settingsChanged =
        cachedPollingSettings.activeSessionsInterval !== pollingSettings.activeSessionsInterval ||
        cachedPollingSettings.idleInterval !== pollingSettings.idleInterval;

      if (settingsChanged) {
        console.log("[ActivityMonitor] Polling settings changed, updating intervals");
        console.log("Old settings:", cachedPollingSettings);
        console.log("New settings:", pollingSettings);
        cachedPollingSettings = { ...pollingSettings };
      }

      const ExcludedUsers = config.settings?.ExcludedUsers || [];
      const apiSessionData = await API.getSessions();
      const SessionData = apiSessionData.filter(
        (row) => row.NowPlayingItem !== undefined && row.UserId && !ExcludedUsers.includes(row.UserId),
      );
      sendUpdate("sessions", apiSessionData);

      const hasActiveSessions = SessionData.length > 0;

      // Determine current appropriate interval
      const currentInterval = hasActiveSessions ? pollingSettings.activeSessionsInterval : pollingSettings.idleInterval;

      // Check if we need to change the interval (either due to session state change OR settings change)
      if (hasActiveSessions !== lastHadActiveSessions || settingsChanged) {
        if (hasActiveSessions !== lastHadActiveSessions) {
          console.log(
            `[ActivityMonitor] Switching to ${hasActiveSessions ? "active" : "idle"} polling mode (${currentInterval}ms)`,
          );
          lastHadActiveSessions = hasActiveSessions;
        }
        if (settingsChanged) {
          console.log(`[ActivityMonitor] Applying new ${hasActiveSessions ? "active" : "idle"} interval: ${currentInterval}ms`);
        }

        if (currentIntervalId) {
          clearInterval(currentIntervalId);
        }
        currentIntervalId = setInterval(runMonitoring, currentInterval);
      }

      const { started: playbackStarted, ended: playbackEnded } = playbackNotifier.collect(SessionData);
      if (playbackStarted.length > 0) {
        await Promise.all(
          playbackStarted.map((session) => webhookManager.triggerEventWebhooks("playback_started", playbackWebhookData(session))),
        );
      }
      if (playbackEnded.length > 0) {
        await Promise.all(
          playbackEnded.map((session) => webhookManager.triggerEventWebhooks("playback_ended", playbackWebhookData(session, true))),
        );
      }
      await webhookManager.flushQuietHoursDigest();

      const WatchdogData = await db.query("SELECT * FROM jf_activity_watchdog").then((res) => res.rows);

      if (SessionData.length === 0 && WatchdogData.length === 0) {
        emptySessionPolls = 0;
        return;
      }

      if (SessionData.length === 0 && WatchdogData.length > 0) {
        emptySessionPolls += 1;
        if (emptySessionPolls < 8) {
          return;
        }
      } else {
        emptySessionPolls = 0;
      }

      const WatchdogDataToInsert = await getSessionsNotInWatchDog(SessionData, WatchdogData);
      const WatchdogDataToUpdate = await getSessionsInWatchDog(SessionData, WatchdogData);
      const dataToRemove = await getWatchDogNotInSessions(SessionData, WatchdogData);

      // Finished playbacks go first. A session that moves on to its next item keeps its
      // Id, so its old row has to be closed before the new one can take that Id.
      if (dataToRemove.length > 0) {
        await recordFinishedPlayback(dataToRemove);
      }

      if (WatchdogDataToInsert.length > 0) {
        await db.insertBulk("jf_activity_watchdog", WatchdogDataToInsert, jf_activity_watchdog_columns);
        console.log("New Data Inserted: ", WatchdogDataToInsert.length);
      }

      //update wd state
      if (WatchdogDataToUpdate.length > 0) {
        await db.insertBulk("jf_activity_watchdog", WatchdogDataToUpdate, jf_activity_watchdog_columns);
        console.log("Existing Data Updated: ", WatchdogDataToUpdate.length);
      }
    } catch (error) {
      if (error?.code === "ECONNREFUSED") {
        console.error("Error: Unable to connect to API"); //TO-DO Change this to correct API name
      } else if (error?.code === "ERR_BAD_RESPONSE") {
        console.warn(error.response?.data);
      } else {
        console.error(error);
      }
      return [];
    }
  };

  // Get initial configuration to start with the correct interval
  const initConfig = async () => {
    try {
      const config = await new configClass().getConfig();

      if (config.error || config.state !== 2) {
        console.log("[ActivityMonitor] Config not ready, starting with default interval:", defaultInterval + "ms");
        currentIntervalId = setInterval(runMonitoring, defaultInterval);
        return;
      }

      // Get adaptive polling settings from config
      const pollingSettings = config.settings?.ActivityMonitorPolling || {
        activeSessionsInterval: 1000,
        idleInterval: 5000,
      };

      // Initialize cached settings
      cachedPollingSettings = { ...pollingSettings };

      // Start with idle interval since there are likely no active sessions at startup
      const initialInterval = pollingSettings.idleInterval;
      console.log("[ActivityMonitor] Starting adaptive polling with idle interval:", initialInterval + "ms");
      console.log("[ActivityMonitor] Loaded settings:", pollingSettings);
      currentIntervalId = setInterval(runMonitoring, initialInterval);
    } catch (error) {
      console.log("[ActivityMonitor] Error loading config, using default interval:", defaultInterval + "ms");
      currentIntervalId = setInterval(runMonitoring, defaultInterval);
    }
  };

  // Initialize with proper configuration
  await initConfig();

  // Return a cleanup function
  return () => {
    if (currentIntervalId) {
      clearInterval(currentIntervalId);
      currentIntervalId = null;
    }
  };
}

module.exports = {
  ActivityMonitor,
};

const express = require("express");
const { mediaServerAuthHeaders, chooseServerType, withServerType } = require("../classes/server-type");

const { axios } = require("../classes/axios");
const configClass = require("../classes/config");
const API = require("../classes/api-loader");
const { getIntegrations } = require("../classes/integration-store");
const { joinSafeHttpUrl, sendSafeError, toSafeHttpUrl, safeHttpGet} = require("../utils/security");
const { assertSafeDestination, BlockedDestinationError, guardedLookup } = require("../utils/outbound-guard");

const router = express.Router();
const SAFE_DEVICE_NAME = /^[A-Za-z0-9._-]{1,64}$/;

let sessionSonarrCache = { expiresAt: 0, ratingsByKey: new Map() };

function normalizeSessionRating(value) {
  const number = Number(String(value ?? "").replace("%", ""));
  return Number.isFinite(number) && number > 0 ? number : null;
}

function normalizeSessionSeriesTitle(value) {
  return String(value || "")
    .replace(/\s*\(\d{4}\)\s*$/, "")
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .toLowerCase();
}

function getSessionSeriesKey(session) {
  const item = session?.NowPlayingItem || {};
  const providerIds = item.ProviderIds || {};
  const tvdbId = providerIds.Tvdb || providerIds.TVDB || providerIds.tvdb;
  const imdbId = providerIds.Imdb || providerIds.IMDb || providerIds.imdb;
  const title = item.SeriesName || (["Series", "Season"].includes(item.Type) ? item.Name : "");
  return {
    id: tvdbId ? `tvdb:${tvdbId}` : imdbId ? `imdb:${imdbId}` : "",
    title: String(title || "").trim(),
  };
}

async function attachSonarrSessionRatings(sessions = []) {
  const activeSeries = sessions.map(getSessionSeriesKey).filter((entry) => entry.id || entry.title);
  if (!activeSeries.length) return sessions;

  try {
    const integrations = await getIntegrations();
    const sonarr = (integrations.arrApps || []).find(
      (integration) => integration.connected && String(integration.slug || integration.name || "").toLowerCase().includes("sonarr")
    );
    if (!sonarr?.values?.url || !sonarr?.values?.secret) return sessions;

    const cacheKey = `${sonarr.instanceId || sonarr.name || sonarr.values.url}`;
    let series = sessionSonarrCache.key === cacheKey && Date.now() < sessionSonarrCache.expiresAt ? sessionSonarrCache.series : null;
    if (!series) {
      const response = await axios.get(`${sonarr.values.url.replace(/\/$/, "")}/api/v3/series`, {
        timeout: 5000,
        headers: { "X-Api-Key": sonarr.values.secret },
      });
      series = Array.isArray(response.data) ? response.data : [];
      sessionSonarrCache = { key: cacheKey, expiresAt: Date.now() + 5 * 60 * 1000, series, ratingsByKey: new Map() };
    }

    const ratingsByKey = new Map();
    series.forEach((entry) => {
      const ratings = {
        // Sonarr commonly stores its IMDb score as the generic ratings.value.
        imdb: normalizeSessionRating(entry.ratings?.imdb ?? entry.ratings?.value),
        rottenTomatoes: normalizeSessionRating(entry.ratings?.rottenTomatoes),
      };
      if (!ratings.imdb && !ratings.rottenTomatoes) return;
      const providerIds = entry.tvdbId || entry.imdbId ? [`tvdb:${entry.tvdbId}`, `imdb:${entry.imdbId}`] : [];
      providerIds.filter((key) => !key.endsWith(":undefined")).forEach((key) => ratingsByKey.set(key, ratings));
      if (entry.title) ratingsByKey.set(`title:${normalizeSessionSeriesTitle(entry.title)}`, ratings);
    });

    return sessions.map((session) => {
      const key = getSessionSeriesKey(session);
      const ratings = ratingsByKey.get(key.id) || ratingsByKey.get(`title:${normalizeSessionSeriesTitle(key.title)}`);
      return ratings ? { ...session, SonarrRatings: ratings } : session;
    });
  } catch (error) {
    console.log("Unable to load Sonarr session ratings:", error.response?.status || error.message);
    return sessions;
  }
}

function getJellyfinAuthHeaders(config) {
  return {
    Authorization: `MediaBrowser Token="${config.JF_API_KEY}"`,
    "X-Emby-Authorization": `MediaBrowser Token="${config.JF_API_KEY}"`,
    "X-MediaBrowser-Token": config.JF_API_KEY,
  };
}

function toUnsignedInt(value, fallback) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function getJellyfinOrigin(config) {
  if (!config?.JF_HOST) {
    return null;
  }

  try {
    const hostUrl = new URL(config.JF_HOST);
    return `${hostUrl.protocol}//${hostUrl.host}`;
  } catch {
    return null;
  }
}

function isAllowedPluginImageUrl(url, config) {
  try {
    const parsed = new URL(url);
    if (!/^https?:$/.test(parsed.protocol)) {
      return false;
    }

    const jellyfinOrigin = getJellyfinOrigin(config);
    if (!jellyfinOrigin) {
      return false;
    }

    if (parsed.origin === jellyfinOrigin) {
      return true;
    }

    if (config.IS_JELLYFIN == false && parsed.hostname === "raw.githubusercontent.com") {
      return parsed.pathname.startsWith("/MediaBrowser/Emby.Resources/");
    }

    return false;
  } catch {
    return false;
  }
}

router.get("/web/assets/img/devices/", async (req, res) => {
  const { devicename } = req.query; // Get the image URL from the query string
  const config = await new configClass().getConfig();

  if (config.error) {
    res.send({ error: config.error });
    return;
  }

  if (!devicename || !SAFE_DEVICE_NAME.test(String(devicename))) {
    res.status(400).send("device name is required");
    return;
  }

  const encodedDevice = encodeURIComponent(String(devicename));
  let url = joinSafeHttpUrl(config.JF_HOST, `/web/assets/img/devices/${encodedDevice}.svg`);
  if (config.IS_JELLYFIN == false) {
    url = toSafeHttpUrl(
      `https://raw.githubusercontent.com/MediaBrowser/Emby.Resources/master/images/devices/${encodedDevice}.png`,
      { allowedHostnames: ["raw.githubusercontent.com"] }
    );
  }

  axios
    .get(url, {
      responseType: "arraybuffer",
    })
    .then((response) => {
      res.set("Content-Type", "image/svg+xml");
      if (config.IS_JELLYFIN == false) {
        res.set("Content-Type", "image/png");
      }
      res.status(200);

      if (response.headers["content-type"].startsWith("image/")) {
        res.send(response.data);
      } else {
        res.status(500).send("Error fetching image");
      }

      return; // Add this line
    })
    .catch((error) => {
      res.status(error?.response?.status || 500).send("Error fetching image: " + error);
    });
});

router.get("/Items/Images/Backdrop/", async (req, res) => {
  const { id, fillWidth, quality, blur } = req.query; // Get the image URL from the query string
  const config = await new configClass().getConfig();

  if (config.error) {
    res.send({ error: config.error });
    return;
  }

  if (!id) {
    res.status(400).send("id is required");
    return;
  }

  const width = toUnsignedInt(fillWidth, 800);
  const imageQuality = toUnsignedInt(quality, 100);
  const blurValue = toUnsignedInt(blur, 0);
  const encodedId = encodeURIComponent(id);
  let url = `${config.JF_HOST}/Items/${encodedId}/Images/Backdrop?fillWidth=${width}&quality=${imageQuality}&blur=${blurValue}`;

  axios
    .get(url, {
      responseType: "arraybuffer",
      headers: getJellyfinAuthHeaders(config),
    })
    .then((response) => {
      res.set("Content-Type", "image/jpeg");
      res.set("Cache-Control", "public, max-age=86400, stale-while-revalidate=604800");
      res.status(200);

      if (response.headers["content-type"].startsWith("image/")) {
        res.send(response.data);
      } else {
        res.status(500).send("Error fetching image");
      }
    })
    .catch((error) => {
      res.status(error?.response?.status || 500).send("Error fetching image: " + error);
    });
});

router.get("/Items/Images/Primary/", async (req, res) => {
  const { id, fillWidth, quality } = req.query; // Get the image URL from the query string
  const config = await new configClass().getConfig();

  if (config.error) {
    res.send({ error: config.error });
    return;
  }

  if (!id) {
    res.status(400).send("id is required");
    return;
  }

  const width = toUnsignedInt(fillWidth, 400);
  const imageQuality = toUnsignedInt(quality, 100);
  const encodedId = encodeURIComponent(id);
  let url = `${config.JF_HOST}/Items/${encodedId}/Images/Primary?fillWidth=${width}&quality=${imageQuality}`;

  axios
    .get(url, {
      responseType: "arraybuffer",
      headers: getJellyfinAuthHeaders(config),
    })
    .then((response) => {
      res.set("Content-Type", "image/jpeg");
      res.set("Cache-Control", "public, max-age=86400, stale-while-revalidate=604800");
      res.status(200);

      if (response.headers["content-type"].startsWith("image/")) {
        res.send(response.data);
      } else {
        res.status(500).send("Error fetching image");
      }
    })
    .catch((error) => {
      res.status(error?.response?.status || 500).send("Error fetching image: " + error);
    });
});

router.get("/Users/Images/Primary/", async (req, res) => {
  const { id, tag, fillWidth, quality } = req.query;
  const config = await new configClass().getConfig();

  if (config.error) {
    res.send({ error: config.error });
    return;
  }

  if (!id) {
    res.status(400).send("id is required");
    return;
  }

  const encodedId = encodeURIComponent(id || "");
  const encodedTag = tag ? `&tag=${encodeURIComponent(tag)}` : "";
  const width = toUnsignedInt(fillWidth, 100);
  const imageQuality = toUnsignedInt(quality, 100);
  let url = `${config.JF_HOST}/Users/${encodedId}/Images/Primary?fillWidth=${width}&quality=${imageQuality}${encodedTag}`;

  axios
    .get(url, {
      responseType: "arraybuffer",
      headers: getJellyfinAuthHeaders(config),
    })
    .then((response) => {
      const contentType = response.headers["content-type"] || "";
      res.set("Content-Type", contentType.startsWith("image/") ? contentType : "image/jpeg");
      res.set("Cache-Control", "public, max-age=86400, stale-while-revalidate=604800");
      res.status(200);

      if (contentType.startsWith("image/")) {
        res.send(response.data);
      } else {
        res.status(500).send("Error fetching image");
      }
    })
    .catch((error) => {
      res.status(error?.response?.status || 500).send("Error fetching image: " + error);
    });
});

router.get("/Plugins/Images/", async (req, res) => {
  const { id, url: imageUrl } = req.query;
  const config = await new configClass().getConfig();

  if (config.error) {
    res.status(503).send({ error: config.error });
    return;
  }

  if (!id && !imageUrl) {
    res.status(400).send("No plugin image provided");
    return;
  }

  const encodedId = id ? encodeURIComponent(id) : undefined;
  const candidates = imageUrl ? [imageUrl] : [
    `${config.JF_HOST}/Plugins/${encodedId}/Image`,
    `${config.JF_HOST}/Plugins/${encodedId}/Images/Primary`,
    `${config.JF_HOST}/Plugins/${encodedId}/Thumb`,
  ];

  for (const url of candidates) {
    try {
      if (!/^https?:\/\//i.test(url) || !isAllowedPluginImageUrl(url, config)) {
        continue;
      }

      const response = await safeHttpGet(url, "", {
        responseType: "arraybuffer",
        headers: {
          ...(imageUrl ? {} : mediaServerAuthHeaders(config.JF_API_KEY)),
          "User-Agent": "JellyGlance/1.0.6",
        },
      });

      const contentType = response.headers["content-type"] || "image/png";
      if (!contentType.startsWith("image/")) continue;

      res.set("Content-Type", contentType);
      res.set("Cache-Control", "public, max-age=86400, stale-while-revalidate=604800");
      res.status(200).send(response.data);
      return;
    } catch {
      // Try the next Jellyfin plugin image endpoint.
    }
  }

  res.status(404).send("Plugin image not found");
});

router.get("/getSessions", async (req, res) => {
  try {
    const sessions = await API.getSessions();
    res.send(await attachSonarrSessionRatings(sessions));
  } catch (error) {
    res.status(503);
    sendSafeError(res, error);
  }
});

router.get("/getAdminUsers", async (req, res) => {
  try {
    const adminUser = await API.getAdmins(true);
    res.send(adminUser);
  } catch (error) {
    res.status(503);
    sendSafeError(res, error);
  }
});

router.get("/getRecentlyAdded", async (req, res) => {
  try {
    const { libraryid } = req.query;

    const recentlyAdded = await API.getRecentlyAdded({ libraryid: libraryid });
    res.send(recentlyAdded);
  } catch (error) {
    res.status(503);
    sendSafeError(res, error);
  }
});

//API related functions

// Audiobookshelf covers, public like the other poster routes above. The token stays server-side.
router.get("/Audiobookshelf/Images/:itemId", async (req, res) => {
  try {
    const audiobookshelf = require("../classes/audiobookshelf");
    const integration = await audiobookshelf.getConnectedAudiobookshelf();
    if (!integration) return res.status(404).end();
    const cover = await audiobookshelf.fetchAudiobookshelfCover(integration, req.params.itemId, req.query.width);
    res.set("Content-Type", cover.contentType.startsWith("image/") ? cover.contentType : "image/webp");
    res.set("Cache-Control", "public, max-age=86400");
    res.send(Buffer.from(cover.data));
  } catch (error) {
    res.status(error.statusCode || error.response?.status || 502).end();
  }
});

// Admin-only connection check for a media server URL. The URL comes from the
// request, so the destination is checked after DNS resolution and redirects are
// not followed (a redirect could otherwise point the server at an internal host).
router.post("/validateSettings", async (req, res) => {
  if (!req.permissions?.settings || !["Owner", "Admin"].includes(req.user?.role)) {
    res.status(403).json({ message: "Admin role required" });
    return;
  }

  const { url, apikey, serverType: requestedType } = req.body || {};

  if (url === undefined || apikey === undefined) {
    res.status(400);
    res.send("URL or API Key not provided");
    return;
  }

  const raw = String(url || "").trim();
  const candidate = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
  try {
    await assertSafeDestination(candidate, { allowPrivate: true });
  } catch (error) {
    res.status(400).send(error instanceof BlockedDestinationError ? error.message : "Invalid URL");
    return;
  }

  const requestOptions = { maxRedirects: 0, lookup: guardedLookup({ allowPrivate: true }) };
  // No auto-detection here: probing the URL for its server type would be a second
  // outbound call from request input. Callers pass serverType, otherwise the
  // active type is used.
  const serverType = await chooseServerType(requestedType, null);
  const validation = await withServerType(serverType, () => API.validateSettings(candidate, apikey, requestOptions));
  if (validation.isValid === false) {
    res.status(validation.status);
    res.send(validation.errorMessage);
  } else {
    res.send({ ...validation, serverType });
  }
});

// Handle other routes
router.use((req, res) => {
  res.status(404).send({ error: "Not Found" });
});

module.exports = router;

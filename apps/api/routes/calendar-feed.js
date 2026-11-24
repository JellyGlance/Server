const express = require("express");
const feed = require("../classes/calendar-feed");

// Public: GET /calendar-feed/<token>.ics — the token in the URL is the only credential.
const publicRouter = express.Router();

publicRouter.get("/:file", async (req, res) => {
  try {
    const token = String(req.params.file || "").replace(/\.ics$/i, "");
    if (!token || !(await feed.feedTokenMatches(token))) return res.status(404).end();
    res.set("Content-Type", "text/calendar; charset=utf-8");
    res.set("Content-Disposition", 'inline; filename="jellyglance.ics"');
    res.set("Cache-Control", "private, max-age=900");
    res.send(await feed.buildFeed());
  } catch (error) {
    console.error("Calendar feed failed:", error.message);
    res.status(503).end();
  }
});

// Admin: feed link management and the daily digest settings.
const adminRouter = express.Router();

function sendError(res, error, fallback) {
  const status = error.statusCode || 500;
  if (status >= 500) console.error(fallback, error);
  res.status(status).send({ error: error.message || fallback });
}

adminRouter.get("/", async (req, res) => {
  try {
    res.send({ token: await feed.getFeedToken({ create: false }) });
  } catch (error) {
    sendError(res, error, "Unable to load the calendar feed");
  }
});

adminRouter.post("/enable", async (req, res) => {
  try {
    res.send({ token: await feed.getFeedToken({ create: true }) });
  } catch (error) {
    sendError(res, error, "Unable to create the calendar feed");
  }
});

adminRouter.post("/rotate", async (req, res) => {
  try {
    res.send({ token: await feed.rotateFeedToken() });
  } catch (error) {
    sendError(res, error, "Unable to reset the calendar feed link");
  }
});

adminRouter.delete("/", async (req, res) => {
  try {
    await feed.disableFeed();
    res.send({ token: null });
  } catch (error) {
    sendError(res, error, "Unable to turn off the calendar feed");
  }
});

adminRouter.get("/digest", async (req, res) => {
  try {
    res.send(await feed.getDigestSettings());
  } catch (error) {
    sendError(res, error, "Unable to load digest settings");
  }
});

adminRouter.put("/digest", async (req, res) => {
  try {
    res.send(await feed.saveDigestSettings(req.body || {}));
  } catch (error) {
    sendError(res, error, "Unable to save digest settings");
  }
});

adminRouter.post("/digest/send", async (req, res) => {
  try {
    const payload = await feed.sendDigest({ force: true });
    res.send({ sent: true, todayCount: payload.todayCount, missingCount: payload.missingCount, message: payload.message });
  } catch (error) {
    sendError(res, error, "Unable to send the digest");
  }
});

module.exports = { publicRouter, adminRouter };

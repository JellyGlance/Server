const express = require("express");
const tools = require("../classes/library-tools");

const router = express.Router();

function sendError(res, error, fallback) {
  const status = error.statusCode || 500;
  if (status >= 500) console.error(fallback, error);
  res.status(status).send({ error: error.message || fallback });
}

router.get("/libraries", async (req, res) => {
  try {
    res.send({ libraries: await tools.listLibraries() });
  } catch (error) {
    sendError(res, error, "Unable to list libraries");
  }
});

router.get("/duplicates", async (req, res) => {
  try {
    res.send(await tools.findDuplicates({ libraryId: req.query.libraryId, crossLibraryOnly: req.query.crossLibraryOnly === "1" }));
  } catch (error) {
    sendError(res, error, "Unable to find duplicates");
  }
});

router.get("/upgrades", async (req, res) => {
  try {
    res.send(
      await tools.findUpgrades({
        libraryId: req.query.libraryId,
        minResolution: req.query.minResolution,
        requireSurround: req.query.requireSurround === "1",
        limit: req.query.limit,
      })
    );
  } catch (error) {
    sendError(res, error, "Unable to find upgrade candidates");
  }
});

router.post("/upgrades/search", async (req, res) => {
  try {
    res.send(await tools.searchUpgrades(req.body?.itemIds));
  } catch (error) {
    sendError(res, error, "Unable to start the searches");
  }
});

router.get("/upgrades/schedule", async (req, res) => {
  try {
    res.send(await tools.getUpgradeSchedule());
  } catch (error) {
    sendError(res, error, "Unable to load the upgrade schedule");
  }
});

router.put("/upgrades/schedule", async (req, res) => {
  try {
    res.send(await tools.saveUpgradeSchedule(req.body || {}));
  } catch (error) {
    sendError(res, error, "Unable to save the upgrade schedule");
  }
});

router.post("/upgrades/schedule/run", async (req, res) => {
  try {
    res.send({ result: await tools.maybeRunUpgradeBatch({ force: true }), schedule: await tools.getUpgradeSchedule() });
  } catch (error) {
    sendError(res, error, "Unable to run the upgrade batch");
  }
});

router.post("/refresh", async (req, res) => {
  try {
    res.send(await tools.refreshMetadata(req.body?.itemIds));
  } catch (error) {
    sendError(res, error, "Unable to refresh metadata");
  }
});

router.post("/duplicates/delete", async (req, res) => {
  try {
    if (!req.body?.confirm) return res.status(400).send({ error: "Confirmation required" });
    res.send(await tools.deleteDuplicateCopy(String(req.body?.itemId || "")));
  } catch (error) {
    sendError(res, error, "Unable to delete that copy");
  }
});

module.exports = router;

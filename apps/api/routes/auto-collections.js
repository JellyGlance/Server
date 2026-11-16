const express = require("express");
const collections = require("../classes/auto-collections");

const router = express.Router();

function sendError(res, error, fallback) {
  const status = error.statusCode || 500;
  if (status >= 500) console.error(fallback, error);
  res.status(status).send({ error: error.message || fallback, code: error.code });
}

router.get("/status", async (req, res) => {
  try {
    res.send({
      automationAllowed: collections.automationAllowed(),
      tmdbConfigured: Boolean(collections.createTmdbClient()),
      types: collections.BUILDER_TYPES,
      libraries: await collections.listLibraries(),
    });
  } catch (error) {
    sendError(res, error, "Unable to load collection status");
  }
});

router.get("/builders", async (req, res) => {
  try {
    res.send({ builders: await collections.listBuilders(), automationAllowed: collections.automationAllowed() });
  } catch (error) {
    sendError(res, error, "Unable to list builders");
  }
});

router.post("/builders", async (req, res) => {
  try {
    res.status(201).send({ builder: await collections.createBuilder(req.body || {}) });
  } catch (error) {
    sendError(res, error, "Unable to create the builder");
  }
});

router.put("/builders/:id", async (req, res) => {
  try {
    res.send({ builder: await collections.updateBuilder(req.params.id, req.body || {}) });
  } catch (error) {
    sendError(res, error, "Unable to update the builder");
  }
});

router.delete("/builders/:id", async (req, res) => {
  try {
    res.send(await collections.deleteBuilder(req.params.id));
  } catch (error) {
    sendError(res, error, "Unable to delete the builder");
  }
});

router.get("/builders/:id/preview", async (req, res) => {
  try {
    res.send(await collections.previewBuilder(req.params.id));
  } catch (error) {
    sendError(res, error, "Unable to preview the builder");
  }
});

router.post("/builders/:id/apply", async (req, res) => {
  try {
    res.send(await collections.applyBuilder(req.params.id, { confirm: Boolean(req.body?.confirm) }));
  } catch (error) {
    sendError(res, error, "Unable to apply the builder");
  }
});

router.get("/overlays/preview", async (req, res) => {
  try {
    res.send(await collections.previewOverlays({ libraryId: req.query.libraryId, limit: req.query.limit }));
  } catch (error) {
    sendError(res, error, "Unable to preview poster overlays");
  }
});

router.post("/overlays/apply", async (req, res) => {
  try {
    res.send(await collections.applyOverlays({ itemIds: req.body?.itemIds || [], confirm: Boolean(req.body?.confirm) }));
  } catch (error) {
    sendError(res, error, "Unable to apply poster overlays");
  }
});

router.post("/overlays/revert", async (req, res) => {
  try {
    res.send(await collections.revertOverlays({ itemIds: req.body?.itemIds }));
  } catch (error) {
    sendError(res, error, "Unable to revert poster overlays");
  }
});

router.get("/overlays/originals", async (req, res) => {
  try {
    res.send({ originals: await collections.listOriginals() });
  } catch (error) {
    sendError(res, error, "Unable to list stored originals");
  }
});

module.exports = router;

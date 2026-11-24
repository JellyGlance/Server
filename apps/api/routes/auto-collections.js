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
    const tmdb = await collections.tmdbStatus();
    res.send({
      automationAllowed: collections.automationAllowed(),
      tmdbConfigured: tmdb.configured,
      tmdb,
      trakt: await collections.traktStatus(),
      types: collections.BUILDER_TYPES,
      libraries: await collections.listLibraries(),
    });
  } catch (error) {
    sendError(res, error, "Unable to load collection status");
  }
});

// TMDB key, managed from Settings > Integrations > Metadata. Never returns the key itself.
router.get("/tmdb", async (req, res) => {
  try {
    res.send(await collections.tmdbStatus());
  } catch (error) {
    sendError(res, error, "Unable to load TMDB settings");
  }
});

router.put("/tmdb", async (req, res) => {
  try {
    res.send(await collections.saveTmdbApiKey(req.body?.apiKey));
  } catch (error) {
    sendError(res, error, "Unable to save the TMDB key");
  }
});

router.get("/trakt", async (req, res) => {
  try {
    res.send(await collections.traktStatus());
  } catch (error) {
    sendError(res, error, "Unable to load Trakt settings");
  }
});

router.put("/trakt", async (req, res) => {
  try {
    res.send(await collections.saveTraktClientId(req.body?.clientId));
  } catch (error) {
    sendError(res, error, "Unable to save the Trakt Client ID");
  }
});

router.get("/tmdb/collections", async (req, res) => {
  try {
    res.send({ results: await collections.searchTmdbCollections(req.query.q) });
  } catch (error) {
    sendError(res, error, "Unable to search TMDB collections");
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

router.get("/builders/:id/poster", async (req, res) => {
  try {
    const buffer = await collections.previewCollectionPoster(req.params.id);
    res.set("Content-Type", "image/jpeg");
    res.set("Cache-Control", "no-store");
    res.send(buffer);
  } catch (error) {
    sendError(res, error, "Unable to render the collection poster");
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

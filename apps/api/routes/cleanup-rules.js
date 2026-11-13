const express = require("express");
const cleanup = require("../classes/cleanup-rules");

const router = express.Router();

function sendError(res, error, fallback) {
  const status = error.statusCode || 500;
  const body = { error: error.message || fallback, code: error.code };
  if (error.preview) body.preview = { count: error.preview.count, bytes: error.preview.bytes };
  if (error.run) body.run = error.run;
  if (status >= 500) console.error(fallback, error);
  res.status(status).send(body);
}

router.get("/libraries", async (req, res) => {
  try {
    res.send({ libraries: await cleanup.listLibraries(), automationAllowed: cleanup.automationAllowed() });
  } catch (error) {
    sendError(res, error, "Unable to list libraries");
  }
});

router.get("/rules", async (req, res) => {
  try {
    res.send({ rules: await cleanup.listRules(), automationAllowed: cleanup.automationAllowed() });
  } catch (error) {
    sendError(res, error, "Unable to list cleanup rules");
  }
});

router.post("/rules", async (req, res) => {
  try {
    res.status(201).send({ rule: await cleanup.createRule(req.body || {}) });
  } catch (error) {
    sendError(res, error, "Unable to create the rule");
  }
});

router.get("/rules/:id", async (req, res) => {
  try {
    res.send({ rule: await cleanup.getRule(req.params.id), automationAllowed: cleanup.automationAllowed() });
  } catch (error) {
    sendError(res, error, "Unable to load the rule");
  }
});

router.put("/rules/:id", async (req, res) => {
  try {
    res.send({ rule: await cleanup.updateRule(req.params.id, req.body || {}) });
  } catch (error) {
    sendError(res, error, "Unable to update the rule");
  }
});

router.delete("/rules/:id", async (req, res) => {
  try {
    res.send(await cleanup.deleteRule(req.params.id));
  } catch (error) {
    sendError(res, error, "Unable to delete the rule");
  }
});

router.get("/rules/:id/preview", async (req, res) => {
  try {
    res.send(await cleanup.previewRule(req.params.id));
  } catch (error) {
    sendError(res, error, "Unable to preview the rule");
  }
});

router.post("/rules/:id/run", async (req, res) => {
  try {
    const createdBy = req.user?.username || req.user?.name || req.user?.Id || null;
    res.send(await cleanup.runRule(req.params.id, { confirm: Boolean(req.body?.confirm), createdBy }));
  } catch (error) {
    sendError(res, error, "Unable to run the rule");
  }
});

router.get("/rules/:id/runs", async (req, res) => {
  try {
    res.send({ runs: await cleanup.listRuns(req.params.id) });
  } catch (error) {
    sendError(res, error, "Unable to load run history");
  }
});

router.get("/rules/:id/exclusions", async (req, res) => {
  try {
    res.send({ exclusions: await cleanup.listExclusions(req.params.id) });
  } catch (error) {
    sendError(res, error, "Unable to list exclusions");
  }
});

router.post("/rules/:id/exclusions", async (req, res) => {
  try {
    res.status(201).send({
      exclusion: await cleanup.addExclusion({
        ruleId: req.params.id,
        itemId: req.body?.itemId,
        itemName: req.body?.itemName,
        reason: req.body?.reason,
      }),
    });
  } catch (error) {
    sendError(res, error, "Unable to add the exclusion");
  }
});

router.delete("/exclusions/:id", async (req, res) => {
  try {
    res.send(await cleanup.removeExclusion(req.params.id));
  } catch (error) {
    sendError(res, error, "Unable to remove the exclusion");
  }
});

module.exports = router;

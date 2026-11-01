const express = require("express");
const webhookOut = require("../classes/webhook-out");
const { CATALOG } = require("../classes/webhook-out-rules");

const router = express.Router();

// Rules POST data to arbitrary URLs, so only Owners and Admins may see or change them.
router.use((req, res, next) => {
  if (["Owner", "Admin"].includes(req.user?.role)) return next();
  return res.status(403).json({ error: "Only admins can manage outbound webhooks" });
});

router.get("/rules", async (_req, res) => {
  try {
    const [rules, log] = await Promise.all([webhookOut.loadRules(), webhookOut.getLog()]);
    res.json({ rules: rules.map(webhookOut.maskRule), log, catalog: CATALOG });
  } catch (error) {
    res.status(503).json({ error: error.message || "Unable to load outbound webhooks" });
  }
});

router.put("/rules", async (req, res) => {
  try {
    const rules = await webhookOut.saveRules(req.body?.rules || []);
    res.json({ rules: rules.map(webhookOut.maskRule) });
  } catch (error) {
    res.status(400).json({ error: error.message || "Unable to save outbound webhooks" });
  }
});

router.post("/rules/:id/test", async (req, res) => {
  try {
    res.json({ result: await webhookOut.testRule(req.params.id, req.body?.rule || null) });
  } catch (error) {
    res.status(error.status || 400).json({ error: error.message || "Test failed" });
  }
});

router.post("/preview", (req, res) => {
  try {
    res.json(webhookOut.preview(req.body?.rule || {}));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.get("/log", async (_req, res) => {
  try {
    res.json({ log: await webhookOut.getLog() });
  } catch (error) {
    res.status(503).json({ error: error.message });
  }
});

module.exports = router;

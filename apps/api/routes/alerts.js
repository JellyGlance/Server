const express = require("express");
const alerts = require("../classes/threshold-alerts");
const { CATALOG } = require("../classes/alert-rules");

const router = express.Router();

// Alert rules can send data to arbitrary URLs, so only Owners and Admins may see or change them,
// even if a custom role has been given the settings permission.
router.use((req, res, next) => {
  if (["Owner", "Admin"].includes(req.user?.role)) return next();
  return res.status(403).json({ error: "Only admins can manage alerts" });
});

function lastFiredMap(state) {
  return Object.fromEntries(Object.entries(state.ruleLastFired || {}).map(([id, at]) => [id, new Date(at).toISOString()]));
}

router.get("/settings", async (req, res) => {
  try {
    const [settings, log, state] = await Promise.all([alerts.getAlertSettings(), alerts.getAlertLog(), alerts.getAlertState()]);
    res.json({ settings: alerts.maskSettings(settings), log: log.slice(0, 40), lastFired: lastFiredMap(state), catalog: CATALOG });
  } catch (error) {
    res.status(503).json({ error: error.message || "Unable to load alert settings" });
  }
});

router.put("/settings", async (req, res) => {
  try {
    res.json({ settings: alerts.maskSettings(await alerts.saveAlertSettings(req.body || {})) });
  } catch (error) {
    res.status(400).json({ error: error.message || "Unable to save alert settings" });
  }
});

router.post("/test", async (req, res) => {
  try {
    await alerts.sendTestAlert();
    res.json({ ok: true });
  } catch (error) {
    res.status(503).json({ error: error.message || "Unable to send a test alert" });
  }
});

router.post("/rules/test", async (req, res) => {
  try {
    const results = await alerts.sendRuleTest(req.body?.rule || {});
    res.json({ ok: results.every((result) => result.ok), results });
  } catch (error) {
    res.status(400).json({ error: error.message || "Unable to send a test for this rule" });
  }
});

router.post("/run", async (req, res) => {
  try {
    res.json(await alerts.runChecks({ force: true }));
  } catch (error) {
    res.status(503).json({ error: error.message || "Unable to run alert checks" });
  }
});

module.exports = router;

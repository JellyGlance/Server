const express = require("express");
const copilot = require("../classes/ops-copilot");

const router = express.Router();

function actorOf(req) {
  return req.user?.username || req.user?.name || (req.user?.id ? `User ${req.user.id}` : "Admin");
}

router.get("/examples", (req, res) => {
  res.send({ examples: copilot.EXAMPLES });
});

router.post("/ask", async (req, res) => {
  const question = String(req.body?.question || "").trim().slice(0, 500);
  if (!question) return res.status(400).send({ error: "Ask a question" });
  try {
    res.send(await copilot.ask(question, actorOf(req)));
  } catch (error) {
    console.error("Ops Copilot ask failed:", error);
    res.status(500).send({ error: "Unable to answer right now" });
  }
});

router.post("/plans/:id/:decision", async (req, res) => {
  const { id, decision } = req.params;
  if (!["approve", "cancel", "undo"].includes(decision)) return res.status(400).send({ error: "Unknown decision" });
  try {
    res.send(await copilot.decide(id, decision, actorOf(req)));
  } catch (error) {
    res.status(error.statusCode || 500).send({ error: error.message || "Unable to update plan" });
  }
});

router.get("/audit", async (req, res) => {
  try {
    res.send(await copilot.getAudit(Math.min(500, Number(req.query.limit) || 100)));
  } catch (error) {
    console.error("Ops Copilot audit failed:", error);
    res.status(500).send({ error: "Unable to load audit log" });
  }
});

module.exports = router;

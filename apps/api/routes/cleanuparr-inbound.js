// Public receiver for Cleanuparr notifications (#317). Authenticated by a per-install token, not a session.
// In Cleanuparr add a Gotify provider with Server URL = <JellyGlance URL>/cleanuparr and
// Application Token = the token shown on the Integrations page; Cleanuparr then POSTs to /cleanuparr/message?token=...
const express = require("express");
const cleanuparr = require("../classes/cleanuparr");
const { deliver } = require("../classes/threshold-alerts");

const router = express.Router();

function providedToken(req) {
  return String(req.query.token || req.get("X-Gotify-Key") || req.get("X-Api-Key") || "").trim();
}

async function receive(req, res) {
  try {
    const expected = await cleanuparr.getWebhookToken({ create: false });
    if (!cleanuparr.tokensMatch(expected, providedToken(req))) {
      return res.status(401).json({ error: "Invalid token" });
    }
    const event = await cleanuparr.handleInbound(req.body, { deliverAlerts: deliver });
    // Gotify-shaped reply so Cleanuparr treats the send as delivered.
    return res.status(200).json({
      id: event.id,
      title: event.title,
      eventType: event.eventType,
      needsIntervention: event.needsIntervention,
      date: event.receivedAt,
    });
  } catch (error) {
    console.error("[CLEANUPARR] Inbound notification failed:", error.message);
    return res.status(500).json({ error: "Unable to record notification" });
  }
}

router.post("/message", receive);
router.post("/webhook", receive);

module.exports = router;

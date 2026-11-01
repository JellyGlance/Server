const express = require("express");
const gap = require("../classes/subtitle-gap");

const router = express.Router();

router.get("/settings", async (req, res) => {
  try {
    res.send(await gap.getPrefs());
  } catch (error) {
    res.status(500).send({ error: "Unable to load language settings" });
  }
});

router.put("/settings", async (req, res) => {
  try {
    res.send(await gap.savePrefs(req.body || {}));
  } catch (error) {
    res.status(500).send({ error: "Unable to save language settings" });
  }
});

router.get("/report", async (req, res) => {
  try {
    res.send(await gap.getReport());
  } catch (error) {
    console.error("Subtitle gap report failed:", error);
    res.status(500).send({ error: "Unable to build the report" });
  }
});

router.post("/bazarr-search", async (req, res) => {
  const targets = (Array.isArray(req.body?.items) ? req.body.items : [])
    .filter((t) => t && ["movie", "series"].includes(t.kind) && t.title)
    .map((t) => ({ key: String(t.key || ""), kind: t.kind, title: String(t.title).slice(0, 300), year: Number(t.year) || null }));
  if (!targets.length) return res.status(400).send({ error: "Pick at least one title" });
  try {
    res.send(await gap.searchInBazarr(targets));
  } catch (error) {
    res.status(error.statusCode || 500).send({ error: error.statusCode ? error.message : "Bazarr search failed" });
  }
});

module.exports = router;

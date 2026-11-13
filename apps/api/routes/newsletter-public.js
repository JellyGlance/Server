// Public, read-only newsletter archive. Off by default.
const express = require("express");
const newsletterArchive = require("../classes/newsletter-archive");
const { getAppSettings, getNewsletterSettings } = require("../classes/smtp-mailer");

const publicRouter = express.Router();

async function archiveEnabled() {
  const settings = await getAppSettings();
  const newsletter = getNewsletterSettings(settings);
  return Boolean(newsletter.archive?.enabled);
}

publicRouter.get("/", async (_req, res) => {
  try {
    if (!(await archiveEnabled())) return res.status(404).json({ enabled: false });
    const entries = await newsletterArchive.listEntries({ includeHtml: false });
    res.set("Cache-Control", "no-store");
    res.json(
      newsletterArchive.buildArchivePayload({
        enabled: true,
        entries,
      })
    );
  } catch {
    res.status(503).json({ enabled: true, error: "The newsletter archive is unavailable right now." });
  }
});

publicRouter.get("/:id", async (req, res) => {
  try {
    if (!(await archiveEnabled())) return res.status(404).json({ enabled: false });
    const entry = await newsletterArchive.getEntry(req.params.id);
    if (!entry) return res.status(404).json({ error: "Not found" });
    res.set("Cache-Control", "no-store");
    res.json(entry);
  } catch {
    res.status(503).json({ error: "The newsletter archive is unavailable right now." });
  }
});

module.exports = { publicRouter };

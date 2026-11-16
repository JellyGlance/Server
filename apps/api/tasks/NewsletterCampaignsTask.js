const { parentPort } = require("worker_threads");

async function runNewsletterCampaignsTask() {
  try {
    const { sendDueCampaigns, runDueNewsletterAutomations } = require("../routes/newsletter");
    const results = await sendDueCampaigns(null);
    let automations = { results: [] };
    try {
      automations = await runDueNewsletterAutomations(null);
    } catch (error) {
      automations = { ok: false, error: error.message, results: [] };
    }
    const autoCount = Array.isArray(automations.results) ? automations.results.length : 0;
    parentPort.postMessage({
      status: "complete",
      message: `Processed ${results.length} due newsletter campaign${results.length === 1 ? "" : "s"} and ${autoCount} automatic email${autoCount === 1 ? "" : "s"}`,
    });
  } catch (error) {
    parentPort.postMessage({ status: "error", message: error.message });
  }
}

parentPort.on("message", async (message) => {
  if (message.command === "start") {
    await runNewsletterCampaignsTask(message.triggertype);
    process.exit(0);
  }
});

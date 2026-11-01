const { parentPort } = require("worker_threads");

async function runWrappedRecapsTask() {
  try {
    const { sendDueRecaps } = require("../classes/wrapped-delivery");
    const results = await sendDueRecaps();
    const failed = results.filter((row) => !row.ok).length;
    parentPort.postMessage({
      status: "complete",
      message: `Sent ${results.length - failed} recap${results.length - failed === 1 ? "" : "s"}${failed ? `, ${failed} failed` : ""}`,
    });
  } catch (error) {
    parentPort.postMessage({ status: "error", message: error.message });
  }
}

parentPort.on("message", async (message) => {
  if (message.command === "start") {
    await runWrappedRecapsTask(message.triggertype);
    process.exit(0);
  }
});

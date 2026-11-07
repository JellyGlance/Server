const express = require("express");
const incomplete = require("../classes/incomplete-seasons");

const router = express.Router();

router.get("/report", async (req, res) => {
  try {
    res.send(await incomplete.getReport());
  } catch (error) {
    console.error("Incomplete season report failed:", error);
    res.status(500).send({ error: "Unable to build the report" });
  }
});

module.exports = router;

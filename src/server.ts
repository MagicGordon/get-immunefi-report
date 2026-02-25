import express from "express";
import * as dotenv from "dotenv";
import { BrowserContext } from "playwright";
import { initContext, getReports, getReportDetail, buildReportUrl } from "./scraper";

dotenv.config();

const PORT = process.env.PORT || 3210;

let context: BrowserContext;

const app = express();

// GET /reports?status=Escalated
app.get("/reports", async (req, res) => {
  try {
    const filter = (req.query.status as string) || "Escalated";
    const reports = await getReports(context, filter);
    res.json(reports);
  } catch (error) {
    console.error("Error in GET /reports:", error);
    res.status(500).json({ error: "Failed to fetch reports" });
  }
});

// GET /reports/:id
app.get("/reports/:id", async (req, res) => {
  try {
    const reportId = req.params.id;
    const reportUrl = buildReportUrl(reportId);
    const markdown = await getReportDetail(context, reportUrl);

    if (!markdown) {
      res.status(404).json({ error: "Report not found or content could not be extracted" });
      return;
    }

    res.json({ id: reportId, markdown });
  } catch (error) {
    console.error(`Error in GET /reports/${req.params.id}:`, error);
    res.status(500).json({ error: "Failed to fetch report detail" });
  }
});

async function start() {
  console.log("Initializing browser context...");
  context = await initContext();

  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`  GET /reports?status=Escalated`);
    console.log(`  GET /reports/:id`);
  });
}

start().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});

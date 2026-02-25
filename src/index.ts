import * as dotenv from "dotenv";
import { initContext, getReports, getReportDetail, buildReportUrl } from "./scraper";

dotenv.config();

const REPORT_FILTER = process.env.REPORT_FILTER || "Escalated";
const REPORT_ID = process.env.REPORT_ID || "";

async function main() {
  const context = await initContext();

  try {
    // If REPORT_ID is specified, fetch detail directly (no list needed)
    if (REPORT_ID) {
      console.log(`\nFetching detail for report #${REPORT_ID}...`);
      const reportUrl = buildReportUrl(REPORT_ID);
      const markdown = await getReportDetail(context, reportUrl);
      if (markdown) {
        console.log(`\n${"=".repeat(60)}`);
        console.log(`Report Detail (Markdown):`);
        console.log(`${"=".repeat(60)}\n`);
        console.log(markdown);
      } else {
        console.log("\nFailed to fetch report detail.");
      }
      return;
    }

    // Otherwise, fetch and display report list
    console.log(`Report filter: ${REPORT_FILTER}`);
    const reports = await getReports(context, REPORT_FILTER);

    if (reports.length > 0) {
      console.log(`\n${"=".repeat(60)}`);
      console.log(`Found ${reports.length} "${REPORT_FILTER}" Reports:`);
      console.log(`${"=".repeat(60)}\n`);

      reports.forEach((r, i) => {
        const badges = [r.unread ? "Unread" : "Read", r.stale ? "Stale" : ""].filter(Boolean).join(", ");
        console.log(`[${i + 1}] ${r.id} ${r.title} [${badges}]`);
        console.log(`    Severity: ${r.severity} | Type: ${r.type} | Status: ${r.status}`);
        console.log(`    Whitehat: ${r.whitehat} | SLA: ${r.sla}`);
        console.log(`    Date: ${r.date}`);
        console.log(`    Link: ${r.link}`);
        console.log("");
      });
    } else {
      console.log(`\nNo "${REPORT_FILTER}" reports found.`);
      console.log("Check screenshots in .auth/ directory for debugging.");
    }
  } finally {
    await context.close();
  }
}

main().catch(console.error);

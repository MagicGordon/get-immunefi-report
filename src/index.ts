import * as dotenv from "dotenv";
import { initContext, getReports, getReportDetail, ReportItem } from "./scraper";

dotenv.config();

const REPORT_FILTER = process.env.REPORT_FILTER || "Escalated";
const REPORT_ID = process.env.REPORT_ID || "";

async function main() {
  console.log(`Report filter: ${REPORT_FILTER}`);

  const context = await initContext();

  try {
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

    // If REPORT_ID is specified, fetch its detail
    if (REPORT_ID && reports.length > 0) {
      const targetId = REPORT_ID.startsWith("#") ? REPORT_ID : `#${REPORT_ID}`;
      const match = reports.find((r) => r.id === targetId);

      if (match) {
        console.log(`\nFetching detail for ${match.id} ${match.title}...`);
        const markdown = await getReportDetail(context, match.link);
        if (markdown) {
          console.log(`\n${"=".repeat(60)}`);
          console.log(`Report Detail (Markdown):`);
          console.log(`${"=".repeat(60)}\n`);
          console.log(markdown);
        } else {
          console.log("\nFailed to fetch report detail.");
        }
      } else {
        console.error(`\nReport ${targetId} not found in "${REPORT_FILTER}" list.`);
        console.error(`Available IDs: ${reports.map((r) => r.id).join(", ")}`);
      }
    }
  } finally {
    await context.close();
  }
}

main().catch(console.error);

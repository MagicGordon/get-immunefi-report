import { chromium, BrowserContext } from "playwright";
import * as path from "path";
import * as fs from "fs";
import * as dotenv from "dotenv";

dotenv.config();

const USER_DATA_DIR = path.join(__dirname, "..", ".auth", "user-data");
const SCREENSHOT_DIR = path.join(__dirname, "..", ".auth");
const IMMUNEFI_BUGS_URL = "https://bugs.immunefi.com";
const REPORT_FILTER = process.env.REPORT_FILTER || "Escalated";
const REPORT_ID = process.env.REPORT_ID || "";

function getCredentials(): { email: string; password: string } {
  const email = process.env.IMMUNEFI_EMAIL;
  const password = process.env.IMMUNEFI_PASSWORD;
  if (!email || !password) {
    console.error("Missing IMMUNEFI_EMAIL or IMMUNEFI_PASSWORD in .env file.");
    console.error("Copy .env.example to .env and fill in your credentials.");
    process.exit(1);
  }
  return { email, password };
}

function ensureDirs() {
  for (const dir of [USER_DATA_DIR, SCREENSHOT_DIR]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}

async function checkLoginStatus(context: BrowserContext): Promise<boolean> {
  const page = await context.newPage();
  try {
    await page.goto(IMMUNEFI_BUGS_URL, { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForTimeout(2000);

    const url = page.url();
    console.log(`Current URL: ${url}`);

    const isOnLoginPage = await page.locator('input[name="email"]').isVisible({ timeout: 3000 }).catch(() => false);

    if (!isOnLoginPage) {
      console.log("Session is valid, already logged in.");
      await page.close();
      return true;
    }

    console.log("Session expired or not logged in.");
    await page.close();
    return false;
  } catch (error) {
    console.log("Error checking login status:", error);
    await page.close();
    return false;
  }
}

async function performLogin(context: BrowserContext): Promise<boolean> {
  const { email, password } = getCredentials();
  const page = await context.newPage();

  try {
    console.log("Navigating to login page...");
    await page.goto(IMMUNEFI_BUGS_URL, { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForTimeout(1000);

    console.log("Filling in credentials...");
    await page.locator('input[name="email"]').fill(email);
    await page.locator('input[name="password"]').fill(password);

    console.log("Clicking Login...");
    await page.locator('button:has-text("Login")').click();

    console.log("Waiting for login response...");
    try {
      await page.waitForURL((url) => {
        const href = url.toString();
        return !href.endsWith("/") || href.includes("dashboard") || href.includes("report");
      }, { timeout: 30000 });
    } catch {
      console.log("URL did not change, checking page state...");
    }

    await page.waitForTimeout(3000);
    const url = page.url();
    console.log(`URL after login: ${url}`);

    const stillOnLogin = await page.locator('input[name="email"]').isVisible({ timeout: 3000 }).catch(() => false);

    if (stillOnLogin) {
      await page.screenshot({ path: path.join(SCREENSHOT_DIR, "login-failed.png"), fullPage: true });
      console.error("Login failed! Screenshot saved to .auth/login-failed.png");
      const errorText = await page.locator('[class*="error"], [class*="alert"], [role="alert"]').first().innerText().catch(() => "");
      if (errorText) console.error(`Error message: ${errorText}`);
      await page.close();
      return false;
    }

    console.log("Login successful!");
    await page.close();
    return true;
  } catch (error) {
    console.error("Login error:", error);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "login-error.png"), fullPage: true }).catch(() => {});
    await page.close();
    return false;
  }
}

interface ReportItem {
  id: string;
  title: string;
  date: string;
  reporter: string;
  level: string;
  severity: string;
  type: string;
  status: string;
  link: string;
}

async function getReports(context: BrowserContext, filter: string): Promise<ReportItem[]> {
  const page = await context.newPage();

  try {
    // Navigate to Program Reports with status filter via URL query param
    // Filter values: all (no param), escalated, confirmed, paid, closed
    const statusParam = filter.toLowerCase() === "all" ? "" : `?status=${filter.toLowerCase()}`;
    const reportsUrl = `${IMMUNEFI_BUGS_URL}/program-reports${statusParam}`;
    console.log(`\nNavigating to: ${reportsUrl}`);
    await page.goto(reportsUrl, { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForTimeout(2000);
    console.log(`Page URL: ${page.url()}`);

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "filtered-reports.png"), fullPage: true });

    // Scrape table rows
    const rows = page.locator("table tbody tr");
    const rowCount = await rows.count();
    console.log(`Found ${rowCount} report rows`);

    const reports: ReportItem[] = [];

    if (rowCount > 0) {
      // td[0]=checkbox, [1]=ID, [2]=Title, [3]=Date, [4]=Reporter,
      // [5]=Level, [6]=Severity, [7]=Type, [8]=ClosedBy, [9]=Status
      for (let i = 0; i < rowCount; i++) {
        const row = rows.nth(i);
        const cells = await row.locator("td").all();
        const c = await Promise.all(cells.map((cell) => cell.innerText().catch(() => "")));
        const link = await row.locator("a").first().getAttribute("href").catch(() => "");

        reports.push({
          id: (c[1] || "").trim(),
          title: (c[2] || "").trim(),
          date: (c[3] || "").trim(),
          reporter: (c[4] || "").trim(),
          level: (c[5] || "").trim(),
          severity: (c[6] || "").trim(),
          type: (c[7] || "").trim(),
          status: (c[9] || "").trim(),
          link: link ? (link.startsWith("http") ? link : `${IMMUNEFI_BUGS_URL}${link}`) : "",
        });
      }
    } else {
      console.log("\nNo report rows found. Page content:");
      const bodyText = await page.locator("body").innerText();
      console.log(bodyText.substring(0, 2000));
    }

    await page.close();
    return reports;
  } catch (error) {
    console.error("Error fetching reports:", error);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "error-page.png"), fullPage: true }).catch(() => {});
    await page.close();
    return [];
  }
}

async function getReportDetail(context: BrowserContext, reportUrl: string): Promise<string> {
  const page = await context.newPage();

  try {
    console.log(`\nNavigating to report: ${reportUrl}`);
    await page.goto(reportUrl, { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForTimeout(3000);

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "report-detail.png"), fullPage: true });

    const markdown = await page.evaluate(() => {
      const md: string[] = [];

      // --- 1. Title ---
      const h1 = document.querySelector("h1");
      if (h1) md.push(`# ${(h1 as HTMLElement).innerText.trim()}`, "");

      // --- 2. Subtitle (submitted by...) ---
      const h1Next = h1?.nextElementSibling as HTMLElement | null;
      if (h1Next) {
        const sub = h1Next.innerText?.trim() || "";
        if (sub.includes("Submitted")) md.push(`> ${sub}`, "");
      }

      // --- 3. Metadata key-value pairs ---
      const metaKeys = ["Report ID", "Report type", "Has PoC?"];
      for (const key of metaKeys) {
        for (const el of document.body.querySelectorAll("*")) {
          if (el.children.length === 0 && el.textContent?.trim() === key) {
            const parent = el.parentElement;
            if (parent) {
              const siblings = Array.from(parent.children);
              const idx = siblings.indexOf(el);
              if (idx >= 0 && idx + 1 < siblings.length) {
                md.push(`- **${key}**: ${siblings[idx + 1].textContent?.trim()}`);
                break;
              }
            }
          }
        }
      }

      // Target
      for (const el of document.body.querySelectorAll("*")) {
        if (el.children.length === 0 && el.textContent?.trim() === "Target") {
          const container = el.parentElement;
          if (container) {
            const codeEl = container.querySelector("code, pre, div");
            const val = codeEl?.textContent?.trim().replace("Copied!", "").trim();
            if (val) md.push(`- **Target**: ${val}`);
          }
          break;
        }
      }

      // Impacts
      for (const el of document.body.querySelectorAll("*")) {
        if (el.children.length === 0 && el.textContent?.trim() === "Impacts") {
          const container = el.parentElement;
          if (container) {
            const items = container.querySelectorAll("li");
            if (items.length > 0) {
              md.push("");
              items.forEach((li) => {
                const t = li.textContent?.trim();
                if (t) md.push(`- ${t}`);
              });
            }
          }
          break;
        }
      }

      md.push("");

      // --- 4. Find the report content container ---
      const candidates = Array.from(document.querySelectorAll("main, article, section, div"))
        .filter((el) => {
          const textLen = (el as HTMLElement).innerText?.length || 0;
          const hasStructure = el.querySelector("h2, h3, pre, code");
          return textLen > 800 && hasStructure;
        });
      const container = candidates.sort(
        (a, b) => ((b as HTMLElement).innerText?.length || 0) - ((a as HTMLElement).innerText?.length || 0)
      )[0] as HTMLElement | undefined;

      if (!container) {
        md.push("*Could not locate report content container.*");
        return md.join("\n");
      }

      // --- 5. Walk DOM nodes and convert to markdown ---
      // Start from "Details" h2 to skip metadata already extracted above
      const nodes = container.querySelectorAll("h2, h3, p, pre, ul, ol, blockquote");
      let started = false;

      for (const el of nodes) {
        const tag = el.tagName;
        const text = (el as HTMLElement).innerText?.trim() || "";

        // Start capturing from the "Details" heading
        if (tag === "H2" && text === "Details") {
          started = true;
        }
        if (!started) continue;

        // Stop at Timeline section
        if (tag === "H2" && text === "Timeline") break;
        // Stop at Attachments section
        if (tag === "H2" && text === "Attachments") break;

        if (tag === "H2") {
          md.push(`\n## ${text}\n`);
          continue;
        }

        if (tag === "H3") {
          md.push(`\n### ${text}\n`);
          continue;
        }

        if (tag === "P") {
          // Skip <p> inside <li> (already handled by UL/OL)
          if (el.closest("li")) continue;
          if (text) md.push(`${text}\n`);
          continue;
        }

        if (tag === "PRE") {
          md.push(`\n\`\`\`\n${text}\n\`\`\`\n`);
          continue;
        }

        if (tag === "UL") {
          // Skip nested lists (already handled by parent list's li.innerText)
          if (el.closest("li")) continue;
          el.querySelectorAll(":scope > li").forEach((li) => {
            md.push(`- ${(li as HTMLElement).innerText.trim()}`);
          });
          md.push("");
          continue;
        }

        if (tag === "OL") {
          if (el.closest("li")) continue;
          let i = 1;
          el.querySelectorAll(":scope > li").forEach((li) => {
            md.push(`${i++}. ${(li as HTMLElement).innerText.trim()}`);
          });
          md.push("");
          continue;
        }

        if (tag === "BLOCKQUOTE") {
          md.push(
            (el as HTMLElement).innerText
              .split("\n")
              .map((line: string) => `> ${line}`)
              .join("\n") + "\n"
          );
        }
      }

      return md.join("\n").replace(/\n{3,}/g, "\n\n");
    });

    return markdown;
  } catch (error) {
    console.error("Error fetching report detail:", error);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "detail-error.png"), fullPage: true }).catch(() => {});
    return "";
  } finally {
    await page.close();
  }
}

async function main() {
  ensureDirs();

  console.log("Launching headless browser with persistent context...");
  console.log(`Report filter: ${REPORT_FILTER}`);

  const context = await chromium.launchPersistentContext(USER_DATA_DIR, {
    headless: true,
    viewport: { width: 1280, height: 800 },
    args: ["--disable-blink-features=AutomationControlled", "--no-sandbox"],
  });

  try {
    let loggedIn = await checkLoginStatus(context);

    if (!loggedIn) {
      loggedIn = await performLogin(context);
      if (!loggedIn) {
        console.error("\nFailed to log in. Exiting.");
        return;
      }
    }

    const reports = await getReports(context, REPORT_FILTER);

    if (reports.length > 0) {
      console.log(`\n${"=".repeat(60)}`);
      console.log(`Found ${reports.length} "${REPORT_FILTER}" Reports:`);
      console.log(`${"=".repeat(60)}\n`);

      reports.forEach((r, i) => {
        console.log(`[${i + 1}] ${r.id} ${r.title}`);
        console.log(`    Severity: ${r.severity} | Type: ${r.type} | Status: ${r.status}`);
        console.log(`    Reporter: ${r.reporter} | Level: ${r.level}`);
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

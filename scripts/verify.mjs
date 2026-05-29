import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const OUT = "/tmp/altazah-shots";
mkdirSync(OUT, { recursive: true });
const BASE = "http://localhost:3000";

const log = (...a) => console.log("•", ...a);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
const page = await ctx.newPage();

const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(`console.error: ${m.text()}`);
});

async function shot(name) {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
  log("shot", name);
}

// 1. Landing
await page.goto(BASE, { waitUntil: "networkidle" });
await page.getByText("off the spreadsheet").waitFor({ timeout: 8000 });
await shot("01-landing");

// 2. Manager -> dashboard
await page.getByRole("button", { name: /Manager/ }).click();
await page.waitForURL("**/admin", { timeout: 8000 });
await page.getByText(/Good (morning|afternoon|evening), Khaled/).waitFor();
await shot("02-admin-dashboard");

// 3. Schedule grid
await page.goto(`${BASE}/admin/schedule`, { waitUntil: "networkidle" });
await page.getByRole("heading", { name: "Schedule" }).waitFor();
await shot("03-schedule-grid");

// 3b. Open a shift (cell containing a time range with en dash)
const shiftCell = page.locator("button", { hasText: "–" }).first();
await shiftCell.click();
await page.getByRole("dialog").waitFor({ timeout: 5000 });
await shot("04-shift-modal");
await page.keyboard.press("Escape");

// 3c. Publish
await page.getByRole("button", { name: /Publish/ }).click();
await shot("05-schedule-published");

// 4. Team
await page.goto(`${BASE}/admin/employees`, { waitUntil: "networkidle" });
await page.getByRole("heading", { name: "Team" }).waitFor();
await shot("06-team");
await page.getByRole("button", { name: /Add member/ }).click();
await page.getByRole("dialog").waitFor();
await shot("07-employee-modal");
await page.keyboard.press("Escape");

// 5. Costs
await page.goto(`${BASE}/admin/costs`, { waitUntil: "networkidle" });
await page.getByRole("heading", { name: "Labour cost" }).waitFor();
await shot("08-costs");

// 6. Employee view (mobile)
await page.setViewportSize({ width: 402, height: 880 });
await page.goto(BASE, { waitUntil: "networkidle" });
await page.getByRole("button", { name: /Team member/ }).click();
await page.waitForURL("**/me", { timeout: 8000 });
await page.getByText(/This fortnight/).waitFor();
await shot("09-employee-schedule");

// 6b. Shift detail
await page.getByText(/Next shift/).waitFor();
await page.locator("button", { hasText: /paid/ }).first().click();
await page.getByRole("dialog").waitFor();
await shot("10-employee-shift-detail");
await page.keyboard.press("Escape");

// 7. Profile
await page.goto(`${BASE}/me/profile`, { waitUntil: "networkidle" });
await page.getByText("Your pay rate").waitFor();
await shot("11-employee-profile");

await browser.close();

if (errors.length) {
  console.log("\n⚠️  Browser errors detected:");
  errors.forEach((e) => console.log("  -", e));
  process.exit(1);
} else {
  console.log("\n✅ All flows navigated with no page/console errors.");
}

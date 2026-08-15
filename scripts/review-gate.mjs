// Batch 3: display filter, row marks, and QA waiver as an exit from a blocked gate.
import { createRequire } from "node:module";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(repoRoot, "apps/desktop/package.json"));
const { _electron: electron } = require("playwright");
const electronExecutable = require("electron");

const findings = [];
function note(step, verdict, detail) {
  findings.push({ step, verdict, detail });
  console.log(`[${verdict}] ${step} :: ${detail}`);
}

const userData = await mkdtemp(join(tmpdir(), "tl-b3-"));
const env = {};
for (const [k, v] of Object.entries(process.env)) {
  if (typeof v === "string") env[k] = v;
}
env.TRANSLUNAR_TEST_USER_DATA = userData;
env.TRANSLUNAR_DATA_DIR = join(userData, "engine-data");
env.TRANSLUNAR_TEST_SOURCE = join(repoRoot, "fixtures/formats/real.docx");
env.TRANSLUNAR_TEST_SOURCE_FILES = env.TRANSLUNAR_TEST_SOURCE;
env.TRANSLUNAR_TEST_EXPORT_DOCX = join(userData, "out.docx");
env.TRANSLUNAR_TEST_EXPORT_DIRECTORY = userData;

const app = await electron.launch({
  executablePath: electronExecutable,
  args: ["."],
  cwd: join(repoRoot, "apps/desktop"),
  env,
});
const page = await app.firstWindow();
await page.waitForLoadState("domcontentloaded");
await app.evaluate(async ({ BrowserWindow }) => {
  const [w] = BrowserWindow.getAllWindows();
  w.setContentSize(1680, 942);
});

await page.getByTestId("welcome").waitFor({ timeout: 60000 });
await page.getByRole("button", { name: "Create project" }).click();
await page.getByLabel("Name").fill("Batch3");
await page.getByRole("button", { name: "Create", exact: true }).click();
await page.getByTestId("import-document").waitFor({ timeout: 30000 });
await page.getByRole("button", { name: "Choose files" }).click();
await page.getByTestId("workbench").waitFor({ timeout: 60000 });
await page.waitForTimeout(1500);

await page.getByTestId("display-filter").waitFor();
note("filter-bar", "WORKS", "display filter is mounted");

const totalBefore = await page.locator("tbody tr").count();
await page.getByTestId("filter-state-confirmed").click();
await page.waitForTimeout(300);
const afterConfirmed = await page.locator("tbody tr").count();
note(
  "filter-confirmed-empty",
  afterConfirmed === 0 ? "WORKS" : "BUG",
  `confirmed filter shows ${afterConfirmed} of ${totalBefore}`,
);
await page.getByTestId("filter-clear").click();
await page.waitForTimeout(200);

await page.getByTestId("filter-repeats").click();
await page.waitForTimeout(300);
const afterRepeats = await page.locator("tbody tr").count();
const countText = await page.getByTestId("filter-count").innerText();
note(
  "filter-repeats",
  afterRepeats > 0 && afterRepeats < totalBefore ? "WORKS" : "BUG",
  `repeats show ${afterRepeats}; count says "${countText}"`,
);

const repeatMarks = await page.locator('[data-testid^="mark-repeat-"]').count();
note(
  "repeat-marks",
  repeatMarks > 0 ? "WORKS" : "BUG",
  `${repeatMarks} repeat marks visible on filtered rows`,
);

await page.getByTestId("filter-clear").click();
await page.waitForTimeout(300);

// Confirm two segments so draft/confirmed filters have something to show.
async function activate(ordinal) {
  const row = page.locator("tbody tr").nth(ordinal - 1);
  const btn = row.locator("button.segment-target-activate");
  if (await btn.count()) await btn.click({ timeout: 5000 });
  await page.waitForTimeout(500);
}
await activate(1);
await page
  .locator(".segment-row--active textarea")
  .fill("TL-900 便携式电源站用户指南");
await page.keyboard.press("Control+Enter");
await page.waitForTimeout(1200);

await page.getByTestId("filter-state-confirmed").click();
await page.waitForTimeout(400);
const confirmedOnly = await page.locator("tbody tr").count();
note(
  "filter-confirmed-after-work",
  confirmedOnly >= 1 ? "WORKS" : "BUG",
  `${confirmedOnly} confirmed rows after translating one`,
);
await page.getByTestId("filter-clear").click();

// Force a QA error we can waive: leave a target empty, run QA, waive, export.
await page
  .getByTestId("workbench")
  .locator(".workbench__header-actions")
  .getByRole("button", { name: "QA", exact: true })
  .click();
await page.getByTestId("qa-review").waitFor();
await page.getByRole("button", { name: "Run QA" }).click();
await page.waitForTimeout(2500);
const qaText = await page.getByTestId("qa-review").innerText();
note("qa-run", "INFO", qaText.replace(/\s+/g, " ").slice(0, 160));

const waiveBtn = page.locator('[data-testid^="waive-"]').first();
const hasWaive = (await waiveBtn.count()) > 0;
note(
  "waive-controls",
  hasWaive ? "WORKS" : "MISSING",
  hasWaive ? "waive buttons present on findings" : "no waive buttons",
);

if (hasWaive) {
  await waiveBtn.click();
  await page.getByTestId("waive-confirm").waitFor();
  await page.getByLabel("Reason").fill("False positive for this probe pass");
  await page
    .getByTestId("waive-confirm")
    .getByRole("button", { name: "Waive" })
    .click();
  await page.waitForTimeout(1500);
  const afterWaive = await page.getByTestId("qa-review").innerText();
  note(
    "waive-applied",
    /Waived/i.test(afterWaive) ? "WORKS" : "BUG",
    afterWaive.replace(/\s+/g, " ").slice(0, 200),
  );
}

await page.screenshot({ path: join(userData, "batch3.png") });
await app.close();

const failed = findings.filter((f) =>
  ["BUG", "MISSING"].includes(f.verdict),
).length;
console.log(
  `\n=== BATCH 3: ${failed === 0 ? "PASS" : `${failed} FAILING`} ===`,
);
if (failed > 0) process.exitCode = 1;

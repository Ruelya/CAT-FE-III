// Status bar, Go To, structure column, and TM pretranslate.
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

const userData = await mkdtemp(join(tmpdir(), "tl-b4-"));
const env = {};
for (const [k, v] of Object.entries(process.env)) {
  if (typeof v === "string") env[k] = v;
}
env.TRANSLUNAR_TEST_USER_DATA = userData;
env.TRANSLUNAR_DATA_DIR = join(userData, "engine-data");
env.TRANSLUNAR_TEST_SOURCE = join(repoRoot, "fixtures/formats/real.docx");
env.TRANSLUNAR_TEST_SOURCE_FILES = env.TRANSLUNAR_TEST_SOURCE;

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
await page.getByLabel("Name").fill("Batch4");
await page.getByRole("button", { name: "Create", exact: true }).click();
await page.getByTestId("import-document").waitFor({ timeout: 30000 });
await page.getByRole("button", { name: "Choose files" }).click();
await page.getByTestId("workbench").waitFor({ timeout: 60000 });
await page.waitForTimeout(1200);

await page.getByTestId("workbench-status").waitFor();
const status = await page.getByTestId("workbench-status").innerText();
note("status-bar", /segment/i.test(status) ? "WORKS" : "BUG", status);

const structureCells = await page.locator(".segment-structure").count();
note(
  "structure-column",
  structureCells > 0 ? "WORKS" : "BUG",
  `${structureCells} structure labels`,
);

await page.keyboard.press("Control+g");
await page.getByTestId("goto-dialog").waitFor();
await page.getByLabel("Segment number").fill("7");
await page.getByTestId("goto-submit").click();
await page.waitForTimeout(800);
const active = await page.locator(".segment-row--active").innerText();
note(
  "goto-segment",
  active.includes("warranty") || /7\b/.test(active) ? "WORKS" : "BUG",
  active.replace(/\s+/g, " ").slice(0, 120),
);

// Seed memory from a repeated sentence, clear its twin, then pretranslate.
await page
  .locator(".segment-row--active textarea")
  .fill("质保期为自购买之日起 24 个月，详见 8.2 节。");
await page.keyboard.press("Control+Shift+Enter");
await page.waitForTimeout(1200);

// Segment 5 / 9 are duplicates in the fixture. Confirm 5 into the TM.
await page.keyboard.press("Control+g");
await page.getByTestId("goto-dialog").waitFor();
await page.getByLabel("Segment number").fill("5");
await page.getByTestId("goto-submit").click();
await page.waitForTimeout(500);
await page
  .locator(".segment-row--active textarea")
  .fill("按住电源按钮 3 秒以开启设备。");
await page.keyboard.press("Control+Shift+Enter");
await page.waitForTimeout(1500);

// Clear the twin (9) so pretranslate has an empty target to fill.
await page.keyboard.press("Control+g");
await page.getByTestId("goto-dialog").waitFor();
await page.getByLabel("Segment number").fill("9");
await page.getByTestId("goto-submit").click();
await page.waitForTimeout(500);
await page.locator(".segment-row--active textarea").fill("");
await page.waitForTimeout(800);

await page.getByTestId("pretranslate").click();
await page.waitForTimeout(5000);
const twin = await page.locator(".segment-row--active textarea").inputValue();
const notice = await page
  .getByTestId("propagation-notice")
  .innerText()
  .catch(() => "");
note(
  "pretranslate",
  twin.includes("按住电源按钮") || /Reused/i.test(notice) ? "WORKS" : "BUG",
  `twin target="${twin.slice(0, 40)}" notice="${notice}"`,
);

await page.screenshot({ path: join(userData, "batch4.png") });
await app.close();

const failed = findings.filter((f) => f.verdict === "BUG").length;
console.log(
  `\n=== BATCH 4: ${failed === 0 ? "PASS" : `${failed} FAILING`} ===`,
);
if (failed > 0) process.exitCode = 1;

// Visual audit probe: capture the workbench in the states that currently look
// half-finished, so fixes are driven by pixels rather than guesswork.
import { createRequire } from "node:module";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(repoRoot, "apps/desktop/package.json"));
const { _electron: electron } = require("playwright");
const electronExecutable = require("electron");
const OUT = "/tmp/visual-audit";
await mkdir(OUT, { recursive: true });

const userData = await mkdtemp(join(tmpdir(), "tl-vis-"));
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
  w.setContentSize(1440, 900);
});

await page.getByTestId("welcome").waitFor({ timeout: 60000 });
await page.getByRole("button", { name: "Create project" }).click();
await page.getByLabel("Name").fill("Visual");
await page.getByRole("button", { name: "Create", exact: true }).click();
await page.getByTestId("import-document").waitFor({ timeout: 30000 });
await page.getByRole("button", { name: "Choose files" }).click();
await page.getByTestId("workbench").waitFor({ timeout: 60000 });
await page.waitForTimeout(1500);

// Dismiss import banner if present.
const dismiss = page.getByRole("button", { name: "Dismiss" });
if (await dismiss.count()) await dismiss.click().catch(() => {});

await page.screenshot({ path: join(OUT, "01-workbench-initial.png") });

// Activate a tagged segment and type.
const row2 = page.locator("tbody tr").nth(1);
await row2.locator("button.segment-target-activate").click();
await page.waitForTimeout(600);
await page
  .locator(".segment-row--active textarea")
  .fill("首次操作 TL-900 电源站之前，请阅读所有安全说明。");
await page.waitForTimeout(800);
await page.screenshot({ path: join(OUT, "02-active-tagged-segment.png") });

// Seed TM + terms for dock density.
await page.evaluate(async () => {
  const api = window.translunar;
  const projects = await api.invoke("project.list", { offset: 0, limit: 5 });
  const project = projects.items[0];
  const tb = await api.invoke("termbase.create", {
    name: "Visual TB",
    sourceLocale: project.sourceLocale,
    writable: true,
  });
  await api.invoke("termbase.mount", {
    projectId: project.id,
    termbaseId: tb.id,
    priority: 0,
    writable: true,
    enabled: true,
  });
  await api.invoke("term.upsert", {
    termbaseId: tb.id,
    sourceLocale: project.sourceLocale,
    sourceTerm: "power station",
    translations: [
      { locale: project.targetLocale, term: "电源站", preferred: true },
      { locale: project.targetLocale, term: "电站", forbidden: true },
    ],
  });
});

await page.keyboard.press("Control+Shift+Enter");
await page.waitForTimeout(1200);

// Confirm a repeated sentence for matches.
const row5 = page.locator("tbody tr").nth(4);
if (await row5.locator("button.segment-target-activate").count()) {
  await row5.locator("button.segment-target-activate").click();
}
await page.waitForTimeout(400);
await page
  .locator(".segment-row--active textarea")
  .fill("按住电源按钮 3 秒以开启设备。");
await page.keyboard.press("Control+Shift+Enter");
await page.waitForTimeout(1200);

// Twin segment for matches dock.
const row9 = page.locator("tbody tr").nth(8);
if (await row9.locator("button.segment-target-activate").count()) {
  await row9.locator("button.segment-target-activate").click();
}
await page.waitForTimeout(1200);
await page.locator(".segment-row--active textarea").fill("");
await page.waitForTimeout(1000);
await page.screenshot({ path: join(OUT, "03-matches-dock.png") });

// Stacked dock: the term pane is always visible; memory tools are chips.
await page.getByTestId("intel-pane-tb").waitFor({ state: "visible" });
await page.waitForTimeout(800);
await page.screenshot({ path: join(OUT, "04-terms-dock.png") });

await page
  .getByTestId("intel-dock")
  .getByRole("button", { name: /^Concordance/ })
  .click({ force: true });
await page.waitForTimeout(400);
await page.getByTestId("concordance-query").fill("power button");
await page
  .getByTestId("intel-dock")
  .getByRole("button", { name: "Search", exact: true })
  .click();
await page.waitForTimeout(1200);
await page.screenshot({ path: join(OUT, "05-concordance-dock.png") });

await page
  .getByTestId("intel-dock")
  .getByRole("button", { name: /^AI/ })
  .click({ force: true });
await page.waitForTimeout(600);
await page.screenshot({ path: join(OUT, "06-ai-dock.png") });

// Filter bar density.
await page.getByTestId("filter-repeats").click();
await page.waitForTimeout(400);
await page.screenshot({ path: join(OUT, "07-filter-active.png") });
await page.getByTestId("filter-clear").click();

// Suggestions.
await page.keyboard.press("Control+g");
await page.getByTestId("goto-dialog").waitFor();
await page.getByLabel("Segment number").fill("10");
await page.getByTestId("goto-submit").click();
await page.waitForTimeout(600);
await page
  .locator(".segment-row--active textarea")
  .pressSequentially("Please contact sup", { delay: 40 });
await page.waitForTimeout(900);
await page.screenshot({ path: join(OUT, "08-suggestions.png") });

// Dark theme.
await page.evaluate(() => {
  window.localStorage.setItem(
    "translunar.renderer.appearance.v1",
    JSON.stringify({ version: 1, theme: "dark", accentSeed: "#e0a458" }),
  );
});
await page.reload();
await page.waitForLoadState("domcontentloaded");
await page.getByTestId("workbench").waitFor({ timeout: 60000 }).catch(() => {});
await page.waitForTimeout(2000);
// May land on welcome if session not restored - open via project if needed.
if ((await page.getByTestId("workbench").count()) === 0) {
  const open = page.getByRole("button", { name: /Open|Visual/i }).first();
  if (await open.count()) await open.click();
  await page.waitForTimeout(2000);
}
await page.screenshot({ path: join(OUT, "09-dark.png") });

console.log("shots in", OUT);
await app.close();

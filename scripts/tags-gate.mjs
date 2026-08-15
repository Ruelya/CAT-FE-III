// Tags visible in the source column, and Ctrl+, places them on the target.
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

const userData = await mkdtemp(join(tmpdir(), "tl-tags-"));
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
await page.getByLabel("Name").fill("Tags");
await page.getByRole("button", { name: "Create", exact: true }).click();
await page.getByTestId("import-document").waitFor({ timeout: 30000 });
await page.getByRole("button", { name: "Choose files" }).click();
await page.getByTestId("workbench").waitFor({ timeout: 60000 });
await page.waitForTimeout(1200);

const capsules = await page.locator(".inline-tag").count();
note(
  "source-tags-visible",
  capsules > 0 ? "WORKS" : "BUG",
  `${capsules} inline tag capsules in the grid`,
);

// Segment 2 has the bold span. Activate, type a translation, place tags.
const row = page.locator("tbody tr").nth(1);
await row.locator("button.segment-target-activate").click();
await page.waitForTimeout(500);
await page
  .locator(".segment-row--active textarea")
  .fill("首次操作 TL-900 电源站之前，请阅读所有安全说明。");
await page.waitForTimeout(1200);
await page.keyboard.press("Control+,");
await page.waitForTimeout(2000);

const state = await page.evaluate(async () => {
  const api = window.translunar;
  const projects = await api.invoke("project.list", { offset: 0, limit: 5 });
  const docs = await api.invoke("document.list", {
    projectId: projects.items[0].id,
    offset: 0,
    limit: 10,
  });
  const rows = await api.invoke("segment.editor.list", {
    documentId: docs.items[0].id,
    offset: 0,
    limit: 50,
  });
  const tagged = rows.items.find((r) => (r.sourceTags ?? []).length > 0);
  return {
    sourceTags: tagged?.sourceTags?.length ?? 0,
    targetTags: tagged?.targetTags?.length ?? 0,
    issues: (tagged?.tagIssues ?? []).map((i) => i.code),
  };
});
note(
  "place-tags",
  state.targetTags > 0 && !state.issues.includes("tag_missing")
    ? "WORKS"
    : "BUG",
  JSON.stringify(state),
);

await page.screenshot({ path: join(userData, "tags.png") });
await app.close();

const failed = findings.filter((f) => f.verdict === "BUG").length;
console.log(`\n=== TAGS: ${failed === 0 ? "PASS" : `${failed} FAILING`} ===`);
if (failed > 0) process.exitCode = 1;

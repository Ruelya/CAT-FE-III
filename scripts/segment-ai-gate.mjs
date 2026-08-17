// Segment AI dock: reachable, honest about missing credentials, and wired to
// the current segment rather than a side chat.
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

const userData = await mkdtemp(join(tmpdir(), "tl-ai-"));
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
await page.getByLabel("Name").fill("SegmentAI");
await page.getByRole("button", { name: "Create", exact: true }).click();
await page.getByTestId("import-document").waitFor({ timeout: 30000 });
await page.getByRole("button", { name: "Choose files" }).click();
await page.getByTestId("workbench").waitFor({ timeout: 60000 });
await page.waitForTimeout(1200);

await page.getByRole("tab", { name: /AI/ }).click({ force: true });
await page.waitForTimeout(800);
const tabs = await page.getByRole("tab").allInnerTexts();
note("tabs", "INFO", tabs.join(" | "));
await page.getByTestId("segment-ai").waitFor({ timeout: 10000 });
const text = await page.getByTestId("segment-ai").innerText();
note(
  "ai-tab-on-segment",
  /this segment/i.test(text) ? "WORKS" : "BUG",
  text.replace(/\s+/g, " ").slice(0, 200),
);

const noProfile = await page.getByTestId("ai-no-profile").count();
const generate = await page.getByTestId("ai-generate").count();
note(
  "ai-honest-about-credentials",
  noProfile > 0 || generate > 0 ? "WORKS" : "BUG",
  noProfile > 0
    ? "shows the no-profile guidance"
    : "shows generate controls (a profile is configured)",
);

await page.screenshot({ path: join(userData, "segment-ai.png") });
await app.close();

const failed = findings.filter((f) => f.verdict === "BUG").length;
console.log(
  `\n=== SEGMENT AI: ${failed === 0 ? "PASS" : `${failed} FAILING`} ===`,
);
if (failed > 0) process.exitCode = 1;

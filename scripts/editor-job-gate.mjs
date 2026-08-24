// Editor job gate: a translator does one whole job on a real DOCX using only
// the keyboard.
// Type, Ctrl+Enter, repeat. No mouse, no panel hunting. Then QA and export.
import { createRequire } from "node:module";
import { mkdtemp, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(repoRoot, "apps/desktop/package.json"));
const { _electron: electron } = require("playwright");
const electronExecutable = require("electron");
const desktopRoot = join(repoRoot, "apps", "desktop");
const OUT = await mkdtemp(join(tmpdir(), "tl-job-gate-"));

const findings = [];
function note(step, verdict, detail) {
  findings.push({ step, verdict, detail });
  console.log(`[${verdict}] ${step} :: ${detail}`);
}

const userData = await mkdtemp(join(tmpdir(), "tl-m1-"));
const outPath = join(userData, "out.docx");
const env = {};
for (const [k, v] of Object.entries(process.env)) {
  if (typeof v === "string") env[k] = v;
}
env.TRANSLUNAR_TEST_USER_DATA = userData;
env.TRANSLUNAR_DATA_DIR = join(userData, "engine-data");
env.TRANSLUNAR_TEST_SOURCE = join(repoRoot, "fixtures/formats/real.docx");
env.TRANSLUNAR_TEST_SOURCE_FILES = env.TRANSLUNAR_TEST_SOURCE;
env.TRANSLUNAR_TEST_EXPORT_DOCX = outPath;
env.TRANSLUNAR_TEST_EXPORT_DIRECTORY = userData;

const app = await electron.launch({
  executablePath: electronExecutable,
  args: ["."],
  cwd: desktopRoot,
  env,
});
const page = await app.firstWindow();
await page.waitForLoadState("domcontentloaded");
await app.evaluate(async ({ BrowserWindow }) => {
  const [w] = BrowserWindow.getAllWindows();
  w.setContentSize(1680, 942);
});
const consoleErrors = [];
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(m.text());
});

await page.getByTestId("welcome").waitFor({ timeout: 60000 });
await page.getByRole("button", { name: "Create project" }).click();
await page.getByLabel("Name").fill("M1 gate");
await page.getByRole("button", { name: "Create", exact: true }).click();
await page.getByTestId("import-document").waitFor({ timeout: 30000 });
await page.getByRole("button", { name: "Choose files" }).click();
await page.getByTestId("workbench").waitFor({ timeout: 60000 });
await page.waitForTimeout(1200);

const total = await page.locator("tbody tr").count();
note("import", "INFO", `${total} segments`);

// Keyboard-only pass. Click once to enter the grid, then never touch the
// mouse. The workbench may open with the first segment already staged, in
// which case its cell holds the editing surface instead of an activate
// button; accept whichever the first row is showing.
await page
  .locator(
    '.segment-row--active [data-testid^="target-surface-"], [data-testid^="segment-activate-"]',
  )
  .first()
  .click();
await page.waitForTimeout(400);

let typed = 0;
let propagationSeen = 0;
for (let step = 0; step < total + 4; step += 1) {
  const editor = page.locator(".segment-row--active textarea");
  if ((await editor.count()) === 0) break;
  // Use the whole source: a truncated target trips number and length QA for
  // reasons that have nothing to do with what this gate is measuring.
  const source = await page
    .locator(".segment-row--active .segment-source")
    .first()
    .innerText()
    .catch(() => `segment ${step}`);
  const existing = await editor.inputValue();
  if (existing.trim() === "") {
    await editor.fill(`[zh] ${source}`);
    typed += 1;
  }
  await page.keyboard.press("Control+Enter");
  await page.waitForTimeout(700);

  if (await page.getByTestId("propagation-notice").count()) {
    propagationSeen += 1;
  }
  const confirmed = await page.locator(".status-chip--confirmed").count();
  if (confirmed >= total) break;
}

const confirmed = await page.locator(".status-chip--confirmed").count();
note(
  "keyboard-only-pass",
  confirmed === total ? "WORKS" : "BUG",
  `${confirmed}/${total} confirmed, typed ${typed} targets, Ctrl+Enter only`,
);
note(
  "propagation-visible",
  propagationSeen > 0 ? "WORKS" : "MISSING",
  `propagation notice appeared ${propagationSeen} time(s)`,
);
await page.screenshot({ path: join(OUT, "m1-after-pass.png") });

const conflicts = await page
  .locator("text=/another writer|save error/i")
  .count();
note(
  "no-phantom-conflicts",
  conflicts === 0 ? "WORKS" : "BUG",
  `${conflicts} conflict or save-error banners after a normal single-user pass`,
);

// QA then export.
await page.getByTestId("workbench-qa").click();
await page.getByTestId("qa-review").waitFor();
await page.getByRole("button", { name: "Run QA" }).click();
await page.waitForTimeout(2500);
const qaText = await page.getByTestId("qa-review").innerText();
note("qa", "INFO", qaText.replace(/\s+/g, " ").slice(0, 200));
await page.screenshot({ path: join(OUT, "m1-qa.png") });

await page
  .getByTestId("qa-review")
  .getByRole("button", { name: "Export" })
  .click();
await page.getByTestId("export-review").waitFor();
await page
  .getByTestId("export-review")
  .getByRole("button", { name: "Export", exact: true })
  .click();
const exported = await page
  .getByTestId("export-result")
  .waitFor({ timeout: 45000 })
  .then(() => true)
  .catch(() => false);
const exportText = await page.getByTestId("export-review").innerText();
await page.screenshot({ path: join(OUT, "m1-export.png") });

const info = await stat(outPath).catch(() => null);
let targetInFile = false;
if (info) {
  targetInFile =
    execFileSync("python3", [
      "-c",
      "import sys,zipfile;z=zipfile.ZipFile(sys.argv[1]);print(any(b'[zh]' in z.read(n) for n in z.namelist()))",
      outPath,
    ])
      .toString()
      .trim() === "True";
}
note(
  "export",
  exported && !/blocked/i.test(exportText) && targetInFile ? "WORKS" : "BUG",
  `gate=${exportText.replace(/\s+/g, " ").slice(0, 120)} file=${info ? info.size + "B" : "missing"} targetInside=${targetInFile}`,
);

note(
  "console",
  consoleErrors.length === 0 ? "WORKS" : "BUG",
  `${consoleErrors.length} console errors`,
);

await writeFile(
  join(OUT, "m1-gate.json"),
  JSON.stringify({ findings, consoleErrors }, null, 2),
);
await app.close();

const failed = findings.filter((f) => f.verdict === "BUG").length;
console.log(
  `\n=== M1 GATE: ${failed === 0 ? "PASS" : `${failed} FAILING`} ===`,
);
if (failed > 0) process.exitCode = 1;

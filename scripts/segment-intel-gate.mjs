// Does the workbench actually work like a workbench? Translate one segment,
// then check that the memory dock offers the earned match on the twin segment
// and that one keystroke puts it in. Then seed a termbase and check the term
// dock recognises it in the source and inserts the translation at the caret.
import { createRequire } from "node:module";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(repoRoot, "apps/desktop/package.json"));
const { _electron: electron } = require("playwright");
const electronExecutable = require("electron");
const desktopRoot = join(repoRoot, "apps", "desktop");
const OUT = await mkdtemp(join(tmpdir(), "tl-intel-shots-"));

const findings = [];
function note(step, verdict, detail) {
  findings.push({ step, verdict, detail });
  console.log(`[${verdict}] ${step} :: ${detail}`);
}

const userData = await mkdtemp(join(tmpdir(), "tl-intel-"));
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
await page.getByLabel("Name").fill("Intel gate");
await page.getByRole("button", { name: "Create", exact: true }).click();
await page.getByTestId("import-document").waitFor({ timeout: 30000 });
await page.getByRole("button", { name: "Choose files" }).click();
await page.getByTestId("workbench").waitFor({ timeout: 60000 });
await page.waitForTimeout(1200);

// The dock exists and reports on the current segment.
await page.getByTestId("intel-dock").waitFor();
note("dock-present", "WORKS", "segment intelligence dock is mounted");

async function activate(ordinal) {
  const row = page.locator("tbody tr").nth(ordinal - 1);
  const btn = row.locator("button.segment-target-activate");
  if (await btn.count()) await btn.click({ timeout: 5000 });
  await page.waitForTimeout(900);
}

async function dockText() {
  return (await page.getByTestId("intel-dock").innerText()).replace(
    /\s+/g,
    " ",
  );
}

// Segment 5 and 9 are the same sentence. Translate 5, then look at 9.
await activate(5);
const before = await dockText();
note("dock-empty-first", "INFO", before.slice(0, 120));

await page
  .locator(".segment-row--active textarea")
  .fill("按住电源按钮 3 秒以开启设备。");
await page.keyboard.press("Control+Shift+Enter"); // confirm, stay
await page.waitForTimeout(1800);

// Segment 9 is the twin, already propagated. Clear it so the memory has to do
// the work, then check the dock offers the match.
await activate(9);
await page.locator(".segment-row--active textarea").fill("");
await page.waitForTimeout(1500);
const twinDock = await dockText();
const offersMatch = twinDock.includes("按住电源按钮");
note(
  "memory-offers-earned-match",
  offersMatch ? "WORKS" : "MISSING",
  twinDock.slice(0, 200),
);
await page.screenshot({ path: join(OUT, "intel-matches.png") });

if (offersMatch) {
  // One keystroke, no retyping.
  await page.locator(".segment-row--active textarea").click({ force: true });
  await page.keyboard.press("Control+1");
  await page.waitForTimeout(1200);
  const applied = await page
    .locator(".segment-row--active textarea")
    .inputValue();
  note(
    "ctrl-1-applies-match",
    applied.includes("按住电源按钮") ? "WORKS" : "BUG",
    `target after Ctrl+1: "${applied.slice(0, 60)}"`,
  );
}

// Seed a termbase, then check recognition on a segment containing the term.
const seeded = await page.evaluate(async () => {
  const api = window.translunar;
  const projects = await api.invoke("project.list", { offset: 0, limit: 5 });
  const project = projects.items[0];
  const termbase = await api.invoke("termbase.create", {
    name: "Probe TB",
    sourceLocale: project.sourceLocale,
    writable: true,
  });
  await api.invoke("termbase.mount", {
    projectId: project.id,
    termbaseId: termbase.id,
    priority: 0,
    writable: true,
    enabled: true,
  });
  await api.invoke("term.upsert", {
    termbaseId: termbase.id,
    sourceLocale: project.sourceLocale,
    sourceTerm: "power station",
    translations: [
      { locale: project.targetLocale, term: "电源站", preferred: true },
    ],
  });
  return { termbaseId: termbase.id };
});
note("termbase-seeded", "INFO", JSON.stringify(seeded));

// Segment 2 contains "TL-900 power station".
await activate(2);
await page.waitForTimeout(1500);
await page.getByRole("tab", { name: /Terms/ }).click();
await page.waitForTimeout(500);
const termDock = await dockText();
const recognised = termDock.includes("power station");
note(
  "term-recognition",
  recognised ? "WORKS" : "MISSING",
  termDock.slice(0, 200),
);
await page.screenshot({ path: join(OUT, "intel-terms.png") });

if (recognised) {
  const editor = page.locator(".segment-row--active textarea");
  await editor.fill("首次操作");
  await editor.click({ force: true });
  await page.keyboard.press("End");
  await page.getByRole("button", { name: "电源站" }).click();
  await page.waitForTimeout(900);
  const withTerm = await editor.inputValue();
  note(
    "term-insert-at-caret",
    withTerm.includes("电源站") ? "WORKS" : "BUG",
    `target after insert: "${withTerm}"`,
  );
}

note(
  "console",
  consoleErrors.length === 0 ? "WORKS" : "BUG",
  `${consoleErrors.length} console errors: ${consoleErrors.slice(0, 2).join(" | ")}`,
);

await writeFile(
  join(OUT, "intel-gate.json"),
  JSON.stringify({ findings, consoleErrors }, null, 2),
);
await app.close();
const failed = findings.filter((f) =>
  ["BUG", "MISSING"].includes(f.verdict),
).length;
console.log(
  `\n=== INTEL GATE: ${failed === 0 ? "PASS" : `${failed} FAILING`} ===`,
);
if (failed > 0) process.exitCode = 1;

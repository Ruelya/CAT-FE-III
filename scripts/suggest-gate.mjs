// Does typing produce useful completions, and does accepting one replace the
// word rather than appending to it?
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

const userData = await mkdtemp(join(tmpdir(), "tl-sug-"));
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
  cwd: join(repoRoot, "apps", "desktop"),
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
await page.getByLabel("Name").fill("Suggest");
await page.getByRole("button", { name: "Create", exact: true }).click();
await page.getByTestId("import-document").waitFor({ timeout: 30000 });
await page.getByRole("button", { name: "Choose files" }).click();
await page.getByTestId("workbench").waitFor({ timeout: 60000 });
await page.waitForTimeout(1200);

async function activate(ordinal) {
  const row = page.locator("tbody tr").nth(ordinal - 1);
  const btn = row.locator("button.segment-target-activate");
  if (await btn.count()) await btn.click({ timeout: 5000 });
  await page.waitForTimeout(800);
}

// Seed a term so terminology has something to offer.
await page.evaluate(async () => {
  const api = window.translunar;
  const projects = await api.invoke("project.list", { offset: 0, limit: 5 });
  const project = projects.items[0];
  const tb = await api.invoke("termbase.create", {
    name: "Suggest TB",
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
      { locale: project.targetLocale, term: "powerhouse", preferred: true },
    ],
  });
});

// Segment 10 carries an e-mail and a date: pure placeables.
await activate(10);
const editor = page.locator(".segment-row--active textarea");
await editor.click();
await editor.pressSequentially("Please contact sup", { delay: 40 });
await page.waitForTimeout(900);

const popupVisible = await page
  .getByTestId("suggestion-popup")
  .isVisible()
  .catch(() => false);
const popupText = popupVisible
  ? (await page.getByTestId("suggestion-popup").innerText()).replace(
      /\s+/g,
      " ",
    )
  : "";
note(
  "placeable-suggested",
  popupText.includes("support@translunar.example") ? "WORKS" : "MISSING",
  popupText.slice(0, 200),
);
await page.screenshot({ path: join(userData, "suggest.png") });

if (popupText.includes("support@translunar.example")) {
  await page.keyboard.press("Tab");
  await page.waitForTimeout(800);
  const value = await editor.inputValue();
  note(
    "accept-replaces-word",
    value === "Please contact support@translunar.example" ? "WORKS" : "BUG",
    `target: "${value}"`,
  );
}

// Escape must close the list and keep it closed for that word.
await editor.fill("Please contact sup");
await page.waitForTimeout(900);
await page.keyboard.press("Escape");
await page.waitForTimeout(400);
const afterEscape = await page
  .getByTestId("suggestion-popup")
  .isVisible()
  .catch(() => false);
note(
  "escape-dismisses",
  afterEscape === false ? "WORKS" : "BUG",
  `popup visible after Esc: ${afterEscape}`,
);

// A term completion on segment 2.
await activate(2);
const editor2 = page.locator(".segment-row--active textarea");
await editor2.click();
await editor2.pressSequentially("Use the power", { delay: 40 });
await page.waitForTimeout(900);
const termPopup = (
  await page
    .getByTestId("suggestion-popup")
    .innerText()
    .catch(() => "")
).replace(/\s+/g, " ");
note(
  "term-suggested",
  termPopup.includes("powerhouse") ? "WORKS" : "MISSING",
  termPopup.slice(0, 200),
);

note(
  "console",
  consoleErrors.length === 0 ? "WORKS" : "BUG",
  `${consoleErrors.length} errors ${consoleErrors.slice(0, 2).join(" | ")}`,
);

await app.close();
const failed = findings.filter((f) =>
  ["BUG", "MISSING"].includes(f.verdict),
).length;
console.log(
  `\n=== SUGGEST: ${failed === 0 ? "PASS" : `${failed} FAILING`} ===`,
);
console.log(`shots in ${userData}`);
if (failed > 0) process.exitCode = 1;

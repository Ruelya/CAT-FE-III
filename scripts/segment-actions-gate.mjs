// Batch 1: concordance answers a phrase question, Quick Add Term closes the
// sedimentation loop from inside the editor, and copy-source works.
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

const userData = await mkdtemp(join(tmpdir(), "tl-b1-"));
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
await page.getByLabel("Name").fill("Batch1");
await page.getByRole("button", { name: "Create", exact: true }).click();
await page.getByTestId("import-document").waitFor({ timeout: 30000 });
await page.getByRole("button", { name: "Choose files" }).click();
await page.getByTestId("workbench").waitFor({ timeout: 60000 });
await page.waitForTimeout(1200);

async function activate(ordinal) {
  const row = page.locator("tbody tr").nth(ordinal - 1);
  const btn = row.locator("button.segment-target-activate");
  if (await btn.count()) await btn.click({ timeout: 5000 });
  await page.waitForTimeout(900);
}
const dockText = async () =>
  (await page.getByTestId("intel-dock").innerText()).replace(/\s+/g, " ");

// Build memory: translate segment 5.
await activate(5);
await page
  .locator(".segment-row--active textarea")
  .fill("按住电源按钮 3 秒以开启设备。");
await page.keyboard.press("Control+Shift+Enter");
await page.waitForTimeout(1800);

// Copy source into an empty target.
await activate(3);
await page.locator(".segment-row--active textarea").click({ force: true });
await page.keyboard.press("Control+Insert");
await page.waitForTimeout(800);
const copied = await page.locator(".segment-row--active textarea").inputValue();
note(
  "copy-source",
  copied.includes("1,024 Wh") ? "WORKS" : "BUG",
  `target after Ctrl+Insert: "${copied.slice(0, 50)}"`,
);

await page.keyboard.press("Control+Delete");
await page.waitForTimeout(800);
const cleared = await page
  .locator(".segment-row--active textarea")
  .inputValue();
note(
  "clear-target",
  cleared === "" ? "WORKS" : "BUG",
  `target after Ctrl+Delete: "${cleared}"`,
);

// Concordance on a typed phrase. The stacked dock swaps the memory pane
// between Matches / Concordance / AI with tool chips, not a tablist.
await page
  .getByTestId("intel-dock")
  .getByRole("button", { name: /^Concordance/ })
  .click();
await page.waitForTimeout(400);
await page.getByTestId("concordance-query").fill("power button");
await page
  .getByTestId("intel-dock")
  .getByRole("button", { name: "Search", exact: true })
  .click({ timeout: 5000 });
await page.waitForTimeout(1500);
const conc = await dockText();
note(
  "concordance-finds-earned-unit",
  conc.includes("按住电源按钮") ? "WORKS" : "MISSING",
  conc.slice(0, 220),
);
await page.screenshot({ path: join(userData, "concordance.png") });

// Quick Add Term from inside the editor: select in source, select in target.
await activate(2);
await page.waitForTimeout(600);
// The term recognition pane is always visible in the stacked dock.
await page.getByTestId("intel-pane-tb").waitFor({ state: "visible" });
const addDisabledFirst = await page.getByTestId("quick-add-term").isDisabled();
note(
  "add-term-guarded",
  addDisabledFirst ? "WORKS" : "BUG",
  "Add term is disabled until both sides are selected",
);

const editor = page.locator(".segment-row--active textarea");
await editor.fill("请先阅读安全说明，电源站");
// Select "power station" in the source cell.
await page.evaluate(() => {
  const row = document.querySelector(".segment-row--active .segment-source");
  if (!row) return;
  const needle = "power station";
  const full = row.textContent ?? "";
  const start = full.indexOf(needle);
  if (start < 0) return;
  const end = start + needle.length;
  const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
  let consumed = 0;
  let startNode = null;
  let startOffset = 0;
  let endNode = null;
  let endOffset = 0;
  let node;
  while ((node = walker.nextNode())) {
    const len = (node.nodeValue ?? "").length;
    const nodeStart = consumed;
    const nodeEnd = consumed + len;
    if (!startNode && start >= nodeStart && start <= nodeEnd) {
      startNode = node;
      startOffset = start - nodeStart;
    }
    if (end >= nodeStart && end <= nodeEnd) {
      endNode = node;
      endOffset = end - nodeStart;
      break;
    }
    consumed = nodeEnd;
  }
  if (!startNode || !endNode) return;
  const range = document.createRange();
  range.setStart(startNode, startOffset);
  range.setEnd(endNode, endOffset);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
});
// Select the last three characters of the target.
await page.evaluate(() => {
  const editors = document.querySelectorAll("textarea");
  const el = editors[editors.length - 1];
  if (!el) return;
  el.setSelectionRange(el.value.length - 3, el.value.length);
  el.dispatchEvent(new Event("select", { bubbles: true }));
  document.dispatchEvent(new Event("selectionchange"));
});
await page.waitForTimeout(600);
const canAdd = !(await page.getByTestId("quick-add-term").isDisabled());
note(
  "add-term-enabled-on-selection",
  canAdd ? "WORKS" : "BUG",
  "Add term became available once both sides were selected",
);

if (canAdd) {
  await page.getByTestId("quick-add-term").click();
  await page.waitForTimeout(2000);
  const terms = await dockText();
  note(
    "quick-add-term",
    terms.includes("power station") ? "WORKS" : "BUG",
    terms.slice(0, 200),
  );
  await page.screenshot({ path: join(userData, "quick-add.png") });
}

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
  `\n=== BATCH 1: ${failed === 0 ? "PASS" : `${failed} FAILING`} ===`,
);
console.log(`shots in ${userData}`);
if (failed > 0) process.exitCode = 1;

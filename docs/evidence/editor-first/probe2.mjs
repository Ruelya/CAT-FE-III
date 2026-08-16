// Probe part 2: panels inventory, QA jump-back, export round-trip, assets
// disconnection, and a repro attempt for the single-writer conflict bug.
import { createRequire } from "node:module";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire("/workspace/apps/desktop/package.json");
const { _electron: electron } = require("playwright");
const electronExecutable = require("electron");

const desktopRoot = "/workspace/apps/desktop";
const OUT = "/tmp/editor-probe";
const SHOTS = join(OUT, "shots2");
await mkdir(SHOTS, { recursive: true });

const findings = [];
let shotIndex = 0;
function note(step, verdict, detail) {
  findings.push({ step, verdict, detail });
  console.log(`[${verdict}] ${step} :: ${detail}`);
}
async function shot(page, name) {
  shotIndex += 1;
  const file = join(SHOTS, `${String(shotIndex).padStart(2, "0")}-${name}.png`);
  await page.screenshot({ path: file }).catch(() => {});
}

const userData = await mkdtemp(join(tmpdir(), "tl-probe2-"));
const env = {};
for (const [k, v] of Object.entries(process.env)) {
  if (typeof v === "string") env[k] = v;
}
env.TRANSLUNAR_TEST_USER_DATA = userData;
env.TRANSLUNAR_DATA_DIR = join(userData, "engine-data");
env.TRANSLUNAR_TEST_SOURCE = "/tmp/probe-fixtures/real.docx";
env.TRANSLUNAR_TEST_SOURCE_FILES = "/tmp/probe-fixtures/real.docx";
env.TRANSLUNAR_TEST_EXPORT_DOCX = join(OUT, "out.docx");

const app = await electron.launch({
  executablePath: electronExecutable,
  args: ["."],
  cwd: desktopRoot,
  env,
});
const page = await app.firstWindow();
await page.waitForLoadState("domcontentloaded");
await app.evaluate(async ({ BrowserWindow }) => {
  const [win] = BrowserWindow.getAllWindows();
  win.setMinimumSize(320, 240);
  win.setContentSize(1680, 942);
});
const consoleErrors = [];
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(m.text());
});

async function step(name, fn) {
  try {
    await page.keyboard.press("Escape").catch(() => {});
    await fn();
  } catch (error) {
    note(name, "BROKE", String(error).slice(0, 300));
    await shot(page, `BROKE-${name.replace(/[^a-z0-9]+/gi, "-")}`);
  }
}

async function activateByOrdinal(ordinal) {
  const row = page.locator("tbody tr").nth(ordinal - 1);
  const btn = row.locator("button.segment-target-activate");
  if (await btn.count()) await btn.click({ timeout: 5000 });
  await page.waitForTimeout(400);
}

async function openPanel(label) {
  await page.keyboard.press("Escape").catch(() => {});
  const direct = page
    .locator('[data-testid="editor-command-bar"] .editor-command-bar__primary')
    .getByRole("button", { name: new RegExp(label, "i") });
  if (await direct.count()) {
    await direct.first().click({ timeout: 5000 });
    return true;
  }
  const more = page.locator(
    '[data-testid="editor-command-bar"] .editor-command-bar__overflow button',
  );
  await more.first().click({ timeout: 5000 });
  await page.waitForTimeout(200);
  const item = page.getByRole("menuitem", { name: new RegExp(label, "i") });
  if (await item.count()) {
    await item.first().click({ timeout: 5000 });
    return true;
  }
  await page.keyboard.press("Escape");
  return false;
}

async function panelText() {
  const shell = page.locator(".editor-panel, .panel-shell, section.panel");
  if (await shell.count()) return shell.first().innerText();
  // Fallback: text after the segment table inside editor region.
  return page
    .locator(".editor-region > :last-child")
    .innerText()
    .catch(() => "");
}

// setup
await step("setup", async () => {
  await page.getByTestId("welcome").waitFor({ timeout: 60000 });
  await page.getByRole("button", { name: "Create project" }).click();
  await page.getByLabel("Name").fill("Probe2");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await page.getByTestId("import-document").waitFor({ timeout: 30000 });
  await page.getByRole("button", { name: "Choose files" }).click();
  await page.getByTestId("workbench").waitFor({ timeout: 60000 });
  await page.waitForTimeout(1200);
});

// A. tags panel deep look on the tagged segment
await step("tags-panel-deep", async () => {
  await activateByOrdinal(2);
  await openPanel("tags");
  await page.waitForTimeout(400);
  const text = await panelText();
  note("tags-panel-full", "INFO", text.replace(/\s+/g, " ").slice(0, 600));
  const buttons = await page
    .locator(".editor-region")
    .getByRole("button", { name: /insert|add|copy|place/i })
    .allInnerTexts()
    .catch(() => []);
  note(
    "tag-insert-into-target",
    buttons.length ? "INFO" : "MISSING",
    buttons.length
      ? `controls: ${buttons.join(", ")}`
      : "tags are listed and tag_missing is reported, but no control inserts a tag into the target",
  );
  await shot(page, "tags-deep");
  await page.keyboard.press("Escape");
});

// B. find panel behavior
await step("find-panel", async () => {
  await activateByOrdinal(3);
  await openPanel("find");
  await page.waitForTimeout(300);
  await shot(page, "find-open");
  const text = await panelText();
  note("find-panel-content", "INFO", text.replace(/\s+/g, " ").slice(0, 500));
  const input = page.locator(".editor-region input[type=text], .editor-region input:not([type])").first();
  if (await input.count()) {
    await input.fill("power");
    const go = page
      .locator(".editor-region")
      .getByRole("button", { name: /find|search|next/i });
    if (await go.count()) {
      await go.first().click();
      await page.waitForTimeout(600);
      await shot(page, "find-results");
      const after = await panelText();
      note("find-results", "INFO", after.replace(/\s+/g, " ").slice(0, 400));
    }
  }
  await page.keyboard.press("Escape");
});

// C. comments add + where they surface
await step("comments-panel", async () => {
  await activateByOrdinal(7);
  await openPanel("comments");
  await page.waitForTimeout(300);
  const text = await panelText();
  note("comments-content", "INFO", text.replace(/\s+/g, " ").slice(0, 400));
  const box = page.locator(".editor-region textarea").last();
  const add = page
    .locator(".editor-region")
    .getByRole("button", { name: /add|create|comment/i })
    .last();
  if ((await box.count()) && (await add.count())) {
    await box.fill("术语疑问：warranty 译法待定");
    await add.click();
    await page.waitForTimeout(800);
    await shot(page, "comment-added");
    const after = await panelText();
    note(
      "comment-added",
      after.includes("warranty") ? "WORKS" : "INFO",
      after.replace(/\s+/g, " ").slice(0, 300),
    );
    // Does the grid row show any visual sign that segment 7 is commented?
    const row = await page.locator("tbody tr").nth(6).innerText();
    note(
      "comment-marker-in-grid",
      /comment|批注|💬/i.test(row) ? "WORKS" : "MISSING",
      `row 7 renders: '${row.replace(/\s+/g, " ").slice(0, 160)}'`,
    );
  }
  await page.keyboard.press("Escape");
});

// D. remaining panels quick inventory
for (const label of ["review", "spell", "history", "source", "cjk", "prefs"]) {
  await step(`panel-${label}`, async () => {
    const opened = await openPanel(label);
    if (!opened) {
      note(`panel-${label}`, "MISSING", "no such command");
      return;
    }
    await page.waitForTimeout(400);
    const text = await panelText();
    note(
      `panel-${label}`,
      "INFO",
      text.replace(/\s+/g, " ").slice(0, 450) || "(empty panel)",
    );
    await shot(page, `panel-${label}`);
    await page.keyboard.press("Escape");
  });
}

// E. segment status affordances: what states can a user set?
await step("status-affordances", async () => {
  const row = page.locator("tbody tr").nth(2);
  await row.click({ button: "right" });
  await page.waitForTimeout(300);
  const menus = await page.locator("[role=menu]:visible").count();
  note(
    "row-context-menu",
    menus ? "INFO" : "MISSING",
    menus
      ? "right-click opens a context menu"
      : "right-click on a segment row does nothing (no status change, no lock, no add-as-new)",
  );
  await page.keyboard.press("Escape");
});

// F. confirm-conflict repro: type then confirm quickly, three times
await step("conflict-repro", async () => {
  let conflicts = 0;
  const targets = ["电池容量为 1,024 Wh。", "质保期为 24 个月。", "充电低温警告。"];
  const ordinals = [3, 7, 8];
  for (let i = 0; i < 3; i += 1) {
    await activateByOrdinal(ordinals[i]);
    const editor = page.locator(".segment-row--active textarea");
    await editor.fill(targets[i]);
    await page
      .getByRole("button", { name: /^Confirm segment / })
      .click({ timeout: 5000 });
    await page.waitForTimeout(1200);
    const conflict = await page
      .locator("text=/modified by another writer|conflict/i")
      .count();
    if (conflict) {
      conflicts += 1;
      await shot(page, `conflict-${i}`);
    }
  }
  note(
    "single-writer-conflict",
    conflicts ? "BUG" : "OK",
    `${conflicts}/3 confirm attempts produced a single-writer revision conflict`,
  );
});

// G. QA: issues and jump-back
await step("qa-surface", async () => {
  await page
    .getByTestId("workbench")
    .getByRole("button", { name: "QA" })
    .click({ timeout: 10000 });
  await page.getByTestId("qa-review").waitFor();
  await page.getByRole("button", { name: "Run QA" }).click();
  await page.waitForTimeout(2500);
  await shot(page, "qa");
  const text = await page.getByTestId("qa-review").innerText();
  note("qa-content", "INFO", text.replace(/\s+/g, " ").slice(0, 600));
  const anyButtons = await page
    .getByTestId("qa-review")
    .locator("button")
    .allInnerTexts();
  note("qa-actions", "INFO", `buttons: ${anyButtons.join(", ")}`);
});

// H. export + verify docx round trip
await step("export-roundtrip", async () => {
  await page
    .getByTestId("qa-review")
    .getByRole("button", { name: "Export" })
    .click();
  await page.getByTestId("export-review").waitFor();
  const gate = await page.getByTestId("export-review").innerText();
  note("export-gate", "INFO", gate.replace(/\s+/g, " ").slice(0, 300));
  await page
    .getByTestId("export-review")
    .getByRole("button", { name: "Export", exact: true })
    .click();
  const ok = await page
    .getByTestId("export-result")
    .waitFor({ timeout: 45000 })
    .then(() => true)
    .catch(() => false);
  await shot(page, "export");
  const resultText = await page
    .getByTestId("export-review")
    .innerText()
    .catch(() => "");
  note(
    "export-result",
    ok ? "INFO" : "BROKE",
    resultText.replace(/\s+/g, " ").slice(0, 400),
  );
});

// I. assets hub: TM/concordance live far from the segment
await step("assets-disconnection", async () => {
  const fileMenu = page.getByTestId("title-file-menu");
  if (await fileMenu.count()) {
    await fileMenu.click();
  }
  const assets = page.getByTestId("title-file-assets");
  if (await assets.count()) {
    await assets.click();
    await page.waitForTimeout(1000);
    await shot(page, "assets");
    const text = await page.locator("main, body").first().innerText();
    const hasConcordance = /concordance/i.test(text);
    const hasTmSearch = /search/i.test(text) && /tm|memory/i.test(text);
    note(
      "assets-tm-tools",
      "INFO",
      `assets surface: concordance=${hasConcordance} tmSearch=${hasTmSearch}; sections: ${text
        .replace(/\s+/g, " ")
        .slice(0, 300)}`,
    );
  } else {
    note("assets-nav", "MISSING", "no assets button from workbench");
  }
});

await writeFile(
  join(OUT, "findings2.json"),
  JSON.stringify({ findings, consoleErrors }, null, 2),
);
console.log(`\nconsole errors: ${consoleErrors.length}`);
await app.close();

// Editor-first hands-on probe. Drives the built desktop app through a real
// translator's job script and records, step by step, what exists, what reacts
// to the current segment, and where the chain breaks. Read-only with respect
// to the repository; all artifacts land under /tmp/editor-probe/.
import { createRequire } from "node:module";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire("/workspace/apps/desktop/package.json");
const { _electron: electron } = require("playwright");
const electronExecutable = require("electron");

const desktopRoot = "/workspace/apps/desktop";
const OUT = "/tmp/editor-probe";
const SHOTS = join(OUT, "shots");
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
  await page.screenshot({ path: file, fullPage: false }).catch(() => {});
  return file;
}

const userData = await mkdtemp(join(tmpdir(), "tl-probe-"));
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
page.on("pageerror", (e) => consoleErrors.push(String(e)));

async function step(name, fn) {
  try {
    await fn();
  } catch (error) {
    note(name, "BROKE", String(error).slice(0, 400));
    await shot(page, `BROKE-${name.replace(/[^a-z0-9]+/gi, "-")}`);
  }
}

const activeTargetSel = ".segment-row--active textarea";

async function activateByOrdinal(ordinal) {
  // Rows are 1-based in the UI. Activate via the target cell button, or keep
  // the active one.
  const row = page.locator("tbody tr").nth(ordinal - 1);
  const btn = row.locator("button.segment-target-activate");
  if (await btn.count()) {
    await btn.click();
  } else {
    await row.locator("textarea").click();
  }
  await page.waitForTimeout(500);
}

async function tmPanelText() {
  return (await page.locator('[data-testid="tm-panel"]').innerText()).replace(
    /\s+/g,
    " ",
  );
}

// ---------------------------------------------------------------- 1. open
await step("open-and-create-project", async () => {
  await page.getByTestId("welcome").waitFor({ timeout: 60000 });
  await shot(page, "welcome");
  await page.getByRole("button", { name: "Create project" }).click();
  await page.getByTestId("create-project").waitFor();
  await shot(page, "create-project-form");
  const formText = await page.getByTestId("create-project").innerText();
  note(
    "create-project-fields",
    "INFO",
    `form contains: ${formText.replace(/\s+/g, " ").slice(0, 300)}`,
  );
  await page.getByLabel("Name").fill("Probe TL-900");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await page.getByTestId("import-document").waitFor({ timeout: 30000 });
  await shot(page, "import");
  await page.getByRole("button", { name: "Choose files" }).click();
  await page.getByTestId("workbench").waitFor({ timeout: 60000 });
  await page.waitForTimeout(1500);
  await shot(page, "workbench-initial");
});

// ------------------------------------------------- 2. inventory of the bench
await step("workbench-inventory", async () => {
  const headers = await page
    .locator("table.segment-table thead th")
    .allInnerTexts();
  note("grid-columns", "INFO", `columns: ${headers.join(" | ")}`);
  const rows = await page.locator("tbody tr").count();
  note("segment-count", "INFO", `${rows} segments imported from real.docx`);
  const sources = await page.locator(".segment-source").allInnerTexts();
  note("first-sources", "INFO", sources.slice(0, 3).join(" || "));
  const commandButtons = await page
    .locator('[data-testid="editor-command-bar"] button')
    .allInnerTexts();
  note(
    "command-bar",
    "INFO",
    `visible commands: ${commandButtons.filter(Boolean).join(", ")}`,
  );
  // Open the overflow menu if present to see the full command list.
  const overflow = page.locator(
    '[data-testid="editor-command-bar"] .editor-command-bar__overflow button',
  );
  if (await overflow.count()) {
    await overflow.first().click();
    await page.waitForTimeout(200);
    const menuItems = await page
      .locator(".editor-command-bar__menu-item")
      .allInnerTexts();
    note(
      "command-bar-overflow",
      "INFO",
      menuItems.map((t) => t.replace(/\s+/g, " ")).join(", "),
    );
    await shot(page, "command-overflow");
    await page.keyboard.press("Escape");
  }
  // Tag rendering in source: does the bold run show as tag or plain text?
  const seg2 = await page.locator("tbody tr").nth(1).innerText();
  note(
    "inline-tag-rendering",
    "INFO",
    `segment 2 renders as: ${seg2.replace(/\s+/g, " ").slice(0, 220)}`,
  );
});

// -------------------------------------- 3. does the TM dock track the segment
await step("tm-dock-tracks-segment", async () => {
  await activateByOrdinal(1);
  const tm1 = await tmPanelText();
  await activateByOrdinal(3);
  const tm3 = await tmPanelText();
  note(
    "tm-dock-refresh",
    "INFO",
    `seg1 dock='${tm1.slice(0, 120)}' seg3 dock='${tm3.slice(0, 120)}'`,
  );
  await shot(page, "tm-dock");
});

// --------------------------------------------- 4. terminology on the bench?
await step("terminology-on-bench", async () => {
  const termUi = await page
    .locator("text=/term/i")
    .allInnerTexts()
    .catch(() => []);
  note(
    "term-recognition-window",
    termUi.length ? "INFO" : "MISSING",
    termUi.length
      ? `elements mentioning terms: ${termUi.slice(0, 5).join(" | ")}`
      : "no terminology UI anywhere in the workbench",
  );
});

// ------------------------------- 5. translate + confirm + TM writeback check
await step("confirm-writes-tm", async () => {
  // Segment 4: "Do not expose the device to temperatures above 45 C."
  await activateByOrdinal(4);
  await page.locator(activeTargetSel).fill("请勿将设备暴露在超过 45 C 的温度下。");
  await page.getByRole("button", { name: /^Confirm segment / }).click();
  await page.waitForTimeout(1500);
  await shot(page, "after-confirm-seg4");
  // Segment 6 is the identical sentence. If confirm wrote the TM and the dock
  // queries by current segment, an exact match must appear now.
  await activateByOrdinal(6);
  await page.waitForTimeout(1200);
  const tm = await tmPanelText();
  const hasMatch = tm.includes("请勿将设备暴露");
  note(
    "tm-writeback-and-lookup",
    hasMatch ? "WORKS" : "MISSING",
    `dock for identical segment 6 shows: '${tm.slice(0, 200)}'`,
  );
  await shot(page, "tm-exact-on-duplicate");
  if (hasMatch) {
    // Is there any way to APPLY the match without retyping?
    const applyControls = await page
      .locator('[data-testid="tm-panel"] button, [data-testid="tm-panel"] a')
      .allInnerTexts();
    const usable = applyControls.filter(
      (t) => t && !/collapse|expand/i.test(t),
    );
    note(
      "tm-apply-control",
      usable.length ? "INFO" : "MISSING",
      usable.length
        ? `controls: ${usable.join(", ")}`
        : "match is displayed but there is no control to apply it to the target",
    );
  }
  // Did the duplicate segment auto-propagate on confirm?
  const seg6Target = await page
    .locator("tbody tr")
    .nth(5)
    .locator("td")
    .nth(2)
    .innerText();
  note(
    "auto-propagation-on-confirm",
    seg6Target.includes("请勿") ? "WORKS" : "MISSING",
    `duplicate segment 6 target after confirming 4: '${seg6Target.replace(/\s+/g, " ").slice(0, 120)}'`,
  );
});

// --------------------------------------------------- 6. AutoSuggest while typing
await step("autosuggest-while-typing", async () => {
  await activateByOrdinal(5);
  const editor = page.locator(activeTargetSel);
  await editor.click();
  await editor.pressSequentially("按住电源", { delay: 60 });
  await page.waitForTimeout(700);
  const popups = await page
    .locator(
      "[role=listbox], [role=menu]:visible, .autosuggest, .suggestions, [data-testid*=suggest]",
    )
    .count();
  note(
    "autosuggest",
    popups ? "INFO" : "MISSING",
    popups
      ? `${popups} popup-like elements appeared`
      : "typing in the target produces no suggestion UI of any kind",
  );
  await shot(page, "typing-no-suggest");
});

// ------------------------------------------------------- 7. tags / QuickPlace
await step("tags-panel", async () => {
  // Segment 2 has the bold inline run.
  await activateByOrdinal(2);
  const tagsBtn = page
    .locator('[data-testid="editor-command-bar"]')
    .getByRole("button", { name: /tags/i });
  if (!(await tagsBtn.count())) {
    // maybe inside overflow
    await page
      .locator(
        '[data-testid="editor-command-bar"] .editor-command-bar__overflow button',
      )
      .first()
      .click();
    await page.getByRole("menuitem", { name: /tags/i }).click();
  } else {
    await tagsBtn.click();
  }
  await page.waitForTimeout(500);
  await shot(page, "tags-panel");
  const panel = page.locator("section,div").filter({ hasText: /^Tags/ });
  const panelText = await page
    .locator(".editor-region")
    .innerText()
    .then((t) => t.replace(/\s+/g, " "));
  note("tags-panel-content", "INFO", panelText.slice(0, 500));
  // Try inserting a tag if an insert control exists.
  const insert = page.getByRole("button", { name: /insert|copy/i });
  if (await insert.count()) {
    const labels = await insert.allInnerTexts();
    note("tag-insert-controls", "INFO", labels.join(", "));
  }
});

// --------------------------------------------------------- 8. propagate panel
await step("propagate-panel", async () => {
  // Confirm segment 5 then try the Propagate panel for its duplicate (9).
  await activateByOrdinal(5);
  await page
    .locator(activeTargetSel)
    .fill("按住电源键 3 秒以开机。");
  await page.getByRole("button", { name: /^Confirm segment / }).click();
  await page.waitForTimeout(1200);
  const propBtn = page
    .locator('[data-testid="editor-command-bar"]')
    .getByRole("button", { name: /propagate/i });
  if (await propBtn.count()) {
    await propBtn.click();
  } else {
    await page
      .locator(
        '[data-testid="editor-command-bar"] .editor-command-bar__overflow button',
      )
      .first()
      .click();
    await page.getByRole("menuitem", { name: /propagate/i }).click();
  }
  await page.waitForTimeout(500);
  await shot(page, "propagate-panel");
  const region = await page.locator(".editor-region").innerText();
  note("propagate-ui", "INFO", region.replace(/\s+/g, " ").slice(0, 400));
  // Try running it.
  const run = page.getByRole("button", { name: /propagate|apply|run/i }).last();
  if (await run.count()) {
    await run.click();
    await page.waitForTimeout(1500);
    const seg9 = await page
      .locator("tbody tr")
      .nth(8)
      .locator("td")
      .nth(2)
      .innerText();
    note(
      "propagate-result",
      seg9.includes("按住") ? "WORKS" : "MISSING",
      `segment 9 (duplicate of 5) target: '${seg9.replace(/\s+/g, " ").slice(0, 120)}'`,
    );
    await shot(page, "after-propagate");
  }
});

// ------------------------------------------------------ 9. concordance search
await step("concordance", async () => {
  const anywhere = await page.locator("text=/concordance/i").count();
  note(
    "concordance-ui",
    anywhere ? "INFO" : "MISSING",
    anywhere
      ? "some concordance UI exists in the workbench"
      : "no concordance entry point anywhere in the workbench",
  );
});

// ------------------------------------------------- 10. find / display filter
await step("find-and-filter", async () => {
  const findBtn = page
    .locator('[data-testid="editor-command-bar"]')
    .getByRole("button", { name: /find/i });
  if (await findBtn.count()) {
    await findBtn.click();
    await page.waitForTimeout(400);
    await shot(page, "find-panel");
    const regionText = await page.locator(".editor-region").innerText();
    note(
      "find-panel-content",
      "INFO",
      regionText.replace(/\s+/g, " ").slice(0, 500),
    );
  } else {
    note("find-panel", "MISSING", "no Find command on the bar");
  }
  // Any way to filter the grid by segment state (draft/confirmed/comments)?
  const filterUi = await page
    .locator("select, [role=combobox]")
    .allInnerTexts()
    .catch(() => []);
  note(
    "display-filter",
    "INFO",
    `selects visible in workbench: ${filterUi.join(" | ").slice(0, 200) || "none"}`,
  );
});

// ----------------------------------------------------------- 11. comments
await step("comments", async () => {
  await activateByOrdinal(7);
  const commentsBtn = page
    .locator('[data-testid="editor-command-bar"]')
    .getByRole("button", { name: /comments/i });
  if (await commentsBtn.count()) {
    await commentsBtn.click();
  } else {
    await page
      .locator(
        '[data-testid="editor-command-bar"] .editor-command-bar__overflow button',
      )
      .first()
      .click();
    const item = page.getByRole("menuitem", { name: /comments/i });
    if (await item.count()) await item.click();
    else {
      note("comments", "MISSING", "no Comments command anywhere");
      return;
    }
  }
  await page.waitForTimeout(400);
  await shot(page, "comments-panel");
  const regionText = await page.locator(".editor-region").innerText();
  note(
    "comments-panel-content",
    "INFO",
    regionText.replace(/\s+/g, " ").slice(0, 400),
  );
});

// -------------------------------------------------------------- 12. review/QA
await step("qa-and-jump-back", async () => {
  await page
    .getByTestId("workbench")
    .getByRole("button", { name: "QA" })
    .click();
  await page.getByTestId("qa-review").waitFor();
  await page.getByRole("button", { name: "Run QA" }).click();
  await page.waitForTimeout(2500);
  await shot(page, "qa-review");
  const qaText = await page.getByTestId("qa-review").innerText();
  note("qa-issues", "INFO", qaText.replace(/\s+/g, " ").slice(0, 500));
  // Can we jump from an issue back to its segment in the editor?
  const jump = page
    .getByTestId("qa-review")
    .getByRole("button", { name: /open|go|jump|segment/i });
  note(
    "qa-jump-to-segment",
    (await jump.count()) ? "INFO" : "MISSING",
    (await jump.count())
      ? `jump-ish controls: ${(await jump.allInnerTexts()).join(", ")}`
      : "issues are listed but there is no control to jump back to the segment",
  );
});

// ---------------------------------------------------------------- 13. export
await step("export-docx", async () => {
  await page
    .getByTestId("qa-review")
    .getByRole("button", { name: "Export" })
    .click();
  await page.getByTestId("export-review").waitFor();
  await shot(page, "export-review");
  const gateText = await page.getByTestId("export-review").innerText();
  note("export-gate", "INFO", gateText.replace(/\s+/g, " ").slice(0, 400));
  await page
    .getByTestId("export-review")
    .getByRole("button", { name: "Export", exact: true })
    .click();
  await page
    .getByTestId("export-result")
    .waitFor({ timeout: 45000 })
    .catch(() => {});
  await shot(page, "export-result");
  const resultText = await page
    .getByTestId("export-review")
    .innerText()
    .catch(() => "");
  note("export-result", "INFO", resultText.replace(/\s+/g, " ").slice(0, 400));
});

await writeFile(
  join(OUT, "findings.json"),
  JSON.stringify({ findings, consoleErrors }, null, 2),
);
console.log(`\nconsole errors: ${consoleErrors.length}`);
await app.close();

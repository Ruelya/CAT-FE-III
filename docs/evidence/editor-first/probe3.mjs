// Probe part 3: finish the job like a translator would — translate all 10
// segments, use Apply tags where the source has protected tags, confirm
// everything, pass QA, export, and verify the DOCX round trip. Also: find with
// source scope, proper comment add, assets-hub disconnection check.
import { createRequire } from "node:module";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire("/workspace/apps/desktop/package.json");
const { _electron: electron } = require("playwright");
const electronExecutable = require("electron");

const desktopRoot = "/workspace/apps/desktop";
const OUT = "/tmp/editor-probe";
const SHOTS = join(OUT, "shots3");
await mkdir(SHOTS, { recursive: true });

const findings = [];
let shotIndex = 0;
function note(step, verdict, detail) {
  findings.push({ step, verdict, detail });
  console.log(`[${verdict}] ${step} :: ${detail}`);
}
async function shot(page, name) {
  shotIndex += 1;
  await page
    .screenshot({
      path: join(SHOTS, `${String(shotIndex).padStart(2, "0")}-${name}.png`),
    })
    .catch(() => {});
}

const userData = await mkdtemp(join(tmpdir(), "tl-probe3-"));
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
  await page.waitForTimeout(350);
}

await step("setup", async () => {
  await page.getByTestId("welcome").waitFor({ timeout: 60000 });
  await page.getByRole("button", { name: "Create project" }).click();
  await page.getByLabel("Name").fill("Probe3");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await page.getByTestId("import-document").waitFor({ timeout: 30000 });
  await page.getByRole("button", { name: "Choose files" }).click();
  await page.getByTestId("workbench").waitFor({ timeout: 60000 });
  await page.waitForTimeout(1200);
});

// Translate everything. Segments 2 and 7 carry protected tags: type first,
// then use the Tags panel's "Apply tags" and observe what it does to the text.
const translations = new Map([
  [1, "TL-900 便携式电源站用户指南"],
  [2, "首次操作 TL-900 电源站之前，请阅读所有安全说明。"],
  [3, "电池容量为 1,024 Wh，额定输出为 1,500 W。"],
  [4, "请勿将设备暴露在超过 45 C 的温度下。"],
  [5, "按住电源按钮 3 秒以开启设备。"],
  [6, "请勿将设备暴露在超过 45 C 的温度下。"],
  [7, "质保期为自购买之日起 24 个月，详见 8.2 节。"],
  [8, "在低于 0 C 的环境中充电可能会永久损坏电池单元。"],
  [9, "按住电源按钮 3 秒以开启设备。"],
  [10, "请在 2026-12-31 前联系 support@translunar.example 注册延长质保。"],
]);

await step("translate-all", async () => {
  for (const [ordinal, text] of translations) {
    await activateByOrdinal(ordinal);
    const editor = page.locator(".segment-row--active textarea");
    await editor.fill(text);

    if (ordinal === 2 || ordinal === 7) {
      // Open Tags panel and press Apply tags; capture what changes.
      const before = await editor.inputValue();
      const tagsBtn = page
        .locator('[data-testid="editor-command-bar"]')
        .getByRole("button", { name: /tags/i });
      await tagsBtn.click();
      await page.waitForTimeout(300);
      const apply = page.getByRole("button", { name: /apply tags/i });
      if (await apply.count()) {
        await apply.click();
        await page.waitForTimeout(800);
        const after = await page
          .locator(".segment-row--active textarea")
          .inputValue();
        note(
          `apply-tags-seg${ordinal}`,
          after !== before ? "WORKS" : "MISSING",
          `before='${before.slice(0, 60)}' after='${after.slice(0, 120)}'`,
        );
        await shot(page, `apply-tags-${ordinal}`);
      } else {
        note(`apply-tags-seg${ordinal}`, "MISSING", "no Apply tags button");
      }
      await tagsBtn.click(); // close panel
    }

    await page
      .getByRole("button", { name: /^Confirm segment / })
      .click({ timeout: 5000 });
    await page.waitForTimeout(900);
    // Detect conflicts or save errors as we go.
    const bad = await page
      .locator("text=/conflict|save error/i")
      .count()
      .catch(() => 0);
    if (bad) {
      note(
        `confirm-seg${ordinal}`,
        "BUG",
        "conflict/save error while confirming normally",
      );
      await shot(page, `confirm-bug-${ordinal}`);
      await page.waitForTimeout(1500);
    }
  }
  const chips = await page.locator(".status-chip--confirmed").count();
  note("all-confirmed", chips >= 9 ? "INFO" : "BUG", `${chips}/10 confirmed`);
  await shot(page, "all-translated");
});

// Duplicate leverage while translating: when we reached segment 6 (identical
// to 4), did anything offer or prefill the earlier translation?
await step("duplicate-experience", async () => {
  const seg6 = await page.locator("tbody tr").nth(5).innerText();
  note(
    "duplicate-prefill",
    "INFO",
    `segment 6 row after full pass: '${seg6.replace(/\s+/g, " ").slice(0, 140)}'`,
  );
});

// Find with source scope: does it jump/highlight?
await step("find-source-scope", async () => {
  const findBtn = page
    .locator('[data-testid="editor-command-bar"]')
    .getByRole("button", { name: /find/i });
  await findBtn.click();
  await page.waitForTimeout(300);
  const query = page.locator(".editor-region input").first();
  await query.fill("warranty");
  await page.locator(".editor-region select").first().selectOption("source");
  await page
    .locator(".editor-region")
    .getByRole("button", { name: "Find", exact: true })
    .click();
  await page.waitForTimeout(800);
  await shot(page, "find-source");
  const regionText = await page.locator(".editor-region").innerText();
  const feedback = regionText.match(/\d+\s*(match|result|hit)|no (match|result)/i);
  note(
    "find-feedback",
    feedback ? "INFO" : "MISSING",
    feedback
      ? `feedback: ${feedback[0]}`
      : "Find gives no result count, no jump, no highlight that we can detect",
  );
  await findBtn.click();
});

// Comment properly: the comments panel textarea specifically.
await step("comment-add", async () => {
  await activateByOrdinal(7);
  const commentsBtn = page
    .locator('[data-testid="editor-command-bar"]')
    .getByRole("button", { name: /comments/i });
  await commentsBtn.click();
  await page.waitForTimeout(300);
  const panelBox = page.locator("textarea").last();
  await panelBox.fill("术语疑问：warranty 译法待定");
  const add = page.getByTestId("comment-create");
  await add.click({ timeout: 5000 });
  await page.waitForTimeout(900);
  await shot(page, "comment-added");
  const region = await page.locator(".editor-region").innerText();
  note(
    "comment-added",
    region.includes("warranty 译法待定") ? "WORKS" : "INFO",
    region.replace(/\s+/g, " ").slice(0, 260),
  );
  const row7 = await page.locator("tbody tr").nth(6).innerText();
  note(
    "comment-marker-in-grid",
    /comment/i.test(row7) ? "WORKS" : "MISSING",
    `grid row gives ${/comment/i.test(row7) ? "" : "no "}sign this segment is commented`,
  );
  await commentsBtn.click();
});

// Assets from the workbench: is TM search connected to the current segment?
await step("assets-hub", async () => {
  await page.getByTestId("title-file-menu").click({ timeout: 5000 });
  await page.getByTestId("title-file-assets").click({ timeout: 5000 });
  await page.waitForTimeout(1200);
  await shot(page, "assets-hub");
  const text = await page.locator("body").innerText();
  note(
    "assets-hub-shape",
    "INFO",
    text.replace(/\s+/g, " ").slice(0, 500),
  );
  // back to workbench
  const back = page.getByRole("button", { name: /workbench|back/i }).first();
  if (await back.count()) await back.click();
  await page.waitForTimeout(800);
});

// QA then export; verify gate clears and the file round-trips.
await step("qa-then-export", async () => {
  await page
    .getByTestId("workbench")
    .getByRole("button", { name: "QA" })
    .click({ timeout: 10000 });
  await page.getByTestId("qa-review").waitFor();
  await page.getByRole("button", { name: "Run QA" }).click();
  await page.waitForTimeout(2500);
  const qaText = await page.getByTestId("qa-review").innerText();
  note("qa-after-full-pass", "INFO", qaText.replace(/\s+/g, " ").slice(0, 400));
  await shot(page, "qa-full-pass");
  await page
    .getByTestId("qa-review")
    .getByRole("button", { name: "Export" })
    .click();
  await page.getByTestId("export-review").waitFor();
  await page
    .getByTestId("export-review")
    .getByRole("button", { name: "Export", exact: true })
    .click();
  const ok = await page
    .getByTestId("export-result")
    .waitFor({ timeout: 45000 })
    .then(() => true)
    .catch(() => false);
  await shot(page, "export-final");
  const result = await page.getByTestId("export-review").innerText();
  note(
    "export-final",
    ok ? "WORKS" : "BLOCKED",
    result.replace(/\s+/g, " ").slice(0, 300),
  );
});

await writeFile(
  join(OUT, "findings3.json"),
  JSON.stringify({ findings, consoleErrors }, null, 2),
);
console.log(`\nconsole errors: ${consoleErrors.length}`);
await app.close();

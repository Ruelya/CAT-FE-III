// Probe 4: can a determined translator actually deliver the DOCX?
// Translate all, then walk EVERY segment applying tags via the Tags panel,
// re-run QA, export, and inspect the produced DOCX.
import { createRequire } from "node:module";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire("/workspace/apps/desktop/package.json");
const { _electron: electron } = require("playwright");
const electronExecutable = require("electron");

const desktopRoot = "/workspace/apps/desktop";
const OUT = "/tmp/editor-probe";
const SHOTS = join(OUT, "shots4");
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

const userData = await mkdtemp(join(tmpdir(), "tl-probe4-"));
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

async function step(name, fn) {
  try {
    await fn();
  } catch (error) {
    note(name, "BROKE", String(error).slice(0, 250));
    await shot(page, `BROKE-${name.replace(/[^a-z0-9]+/gi, "-")}`);
  }
}

async function activateByOrdinal(ordinal) {
  const row = page.locator("tbody tr").nth(ordinal - 1);
  const btn = row.locator("button.segment-target-activate");
  if (await btn.count()) await btn.click({ timeout: 5000 });
  await page.waitForTimeout(350);
}

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

await step("setup-and-translate", async () => {
  await page.getByTestId("welcome").waitFor({ timeout: 60000 });
  await page.getByRole("button", { name: "Create project" }).click();
  await page.getByLabel("Name").fill("Probe4");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await page.getByTestId("import-document").waitFor({ timeout: 30000 });
  await page.getByRole("button", { name: "Choose files" }).click();
  await page.getByTestId("workbench").waitFor({ timeout: 60000 });
  await page.waitForTimeout(1200);
  for (const [ordinal, text] of translations) {
    await activateByOrdinal(ordinal);
    const editor = page.locator(".segment-row--active textarea");
    const existing = await editor.inputValue();
    if (existing.trim() === "") await editor.fill(text);
    else if (existing !== text) await editor.fill(text);
    await page
      .getByRole("button", { name: /^Confirm segment / })
      .click({ timeout: 5000 });
    await page.waitForTimeout(900);
  }
  const chips = await page.locator(".status-chip--confirmed").count();
  note("confirmed-count", "INFO", `${chips}/10 confirmed after first pass`);
});

// Second pass: confirm any stragglers (duplicates knocked back to draft).
await step("second-pass-confirm", async () => {
  for (let ordinal = 1; ordinal <= 10; ordinal += 1) {
    const row = page.locator("tbody tr").nth(ordinal - 1);
    const chip = await row.locator(".status-chip").first().innerText();
    if (!/confirmed/i.test(chip)) {
      await activateByOrdinal(ordinal);
      await page
        .getByRole("button", { name: /^Confirm segment / })
        .click({ timeout: 5000 });
      await page.waitForTimeout(900);
    }
  }
  const chips = await page.locator(".status-chip--confirmed").count();
  note(
    "confirmed-after-retry",
    chips === 10 ? "WORKS" : "BUG",
    `${chips}/10 confirmed after retry pass`,
  );
  await shot(page, "after-second-pass");
});

// Tag pass: for every segment open Tags and press Apply tags.
await step("apply-tags-everywhere", async () => {
  const tagsBtn = page
    .locator('[data-testid="editor-command-bar"]')
    .getByRole("button", { name: /tags/i });
  for (let ordinal = 1; ordinal <= 10; ordinal += 1) {
    await activateByOrdinal(ordinal);
    await tagsBtn.click();
    await page.waitForTimeout(250);
    const apply = page.getByRole("button", { name: /apply tags/i });
    if (await apply.count()) {
      await apply.click({ timeout: 5000 });
      await page.waitForTimeout(700);
    }
    await tagsBtn.click(); // close
    await page.waitForTimeout(150);
  }
  note("apply-tags-pass", "INFO", "clicked Apply tags on all 10 segments");
  await shot(page, "after-tag-pass");
});

// QA again.
await step("qa-after-tags", async () => {
  await page
    .getByTestId("workbench")
    .getByRole("button", { name: "QA" })
    .click({ timeout: 10000 });
  await page.getByTestId("qa-review").waitFor();
  await page.getByRole("button", { name: "Run QA" }).click();
  await page.waitForTimeout(2500);
  const text = await page.getByTestId("qa-review").innerText();
  const missing = (text.match(/tag_missing/g) ?? []).length;
  note(
    "qa-tag-missing-after-apply",
    missing === 0 ? "WORKS" : "BUG",
    `tag_missing occurrences after applying tags everywhere: ${missing}; summary: ${text
      .replace(/\s+/g, " ")
      .slice(0, 250)}`,
  );
  await shot(page, "qa-after-tags");
});

// Export.
await step("export", async () => {
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
  const text = await page.getByTestId("export-review").innerText();
  note(
    "export",
    ok && !/blocked/i.test(text) ? "WORKS" : "BLOCKED",
    text.replace(/\s+/g, " ").slice(0, 300),
  );
  await shot(page, "export");
});

await writeFile(
  join(OUT, "findings4.json"),
  JSON.stringify({ findings }, null, 2),
);
await app.close();

// Phase 1 vertical slice through the real UI and real engine:
// create project -> import DOCX -> edit/confirm -> exact TM -> number QA ->
// export DOCX, plus the honest AI/Agent degradation without credentials.
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { expect, test } from "@playwright/test";
import { _electron as electron } from "playwright";
import type { ElectronApplication, Page } from "playwright";

const appRoot = resolve(import.meta.dirname, "../..");
const repoRoot = resolve(appRoot, "../..");
const fixture = join(repoRoot, "fixtures", "docx", "m0-source.docx");
const shotsDir = join(appRoot, "test-results", "shots");

let app: ElectronApplication;
let page: Page;
let workDir: string;
let exportPath: string;

test.beforeAll(async () => {
  workDir = mkdtempSync(join(tmpdir(), "tl-desktop-e2e-"));
  exportPath = join(workDir, "translated.docx");
  mkdirSync(shotsDir, { recursive: true });
  app = await electron.launch({
    args: ["."],
    cwd: appRoot,
    env: {
      ...process.env,
      TL_DATA_DIR: join(workDir, "engine-data"),
      TL_ENGINE_BIN: join(repoRoot, "target", "debug", "tl-engine"),
      TL_FAKE_OPEN_PATH: fixture,
      TL_FAKE_SAVE_PATH: exportPath,
    },
  });
  page = await app.firstWindow();
});

test.afterAll(async () => {
  await app.close();
});

async function shot(name: string) {
  await page.screenshot({ path: join(shotsDir, name), fullPage: false });
}

test("vertical slice through the INSTRUMENT workbench", async () => {
  // Engine handshake surfaces in the header.
  await expect(page.locator(".app-header__engine")).toContainText("pid", {
    timeout: 30_000,
  });
  await shot("01-projects-empty.png");

  // Create a project.
  await page.getByPlaceholder("例如：产品手册 v3").fill("演示项目");
  await page.getByRole("button", { name: "创建项目" }).click();
  await expect(page.locator(".app-header__context strong")).toHaveText(
    "演示项目",
  );

  // Import the DOCX fixture through the import dialog: pick the file via
  // the (seamed) dedicated dialog channel, keep default sentence mode.
  await page.getByRole("button", { name: "导入", exact: true }).click();
  const importDialog = page.locator(".tl-dialog");
  await expect(importDialog).toContainText("导入文档");
  await importDialog.getByRole("button", { name: "选择文件…" }).click();
  await expect(importDialog).toContainText("m0-source.docx");
  await importDialog.getByRole("button", { name: "导入", exact: true }).click();
  await expect(page.locator(".segment-grid tbody tr").first()).toContainText(
    "The retention period is 30 days.",
    { timeout: 30_000 },
  );
  const rows = page.locator(".segment-grid tbody tr");
  await expect(rows).toHaveCount(3);
  await shot("02-imported-grid.png");

  // Edit and confirm segment 1 (writes the exact TM).
  const editor = page.getByLabel("句段 1 译文");
  await editor.fill("保留期为 30 天。");
  await page.getByRole("button", { name: "确认", exact: true }).click();
  await expect(rows.first()).toContainText("已确认");
  await expect(page.locator(".app-statusbar")).toContainText("写入 TM");

  // The TM dock shows the 100% exact match for the same source.
  await expect(page.locator(".match-card").first()).toContainText("100%");
  await shot("03-confirmed-tm-hit.png");

  // Draft a wrong number in segment 2, then run number QA.
  await rows.nth(1).click();
  const editor2 = page.getByLabel("句段 2 译文");
  await editor2.fill("表中金额：1,300。");
  await page.getByRole("button", { name: "保存草稿" }).click();
  await expect(page.locator(".app-statusbar")).toContainText("草稿已保存");
  await page.getByRole("button", { name: "QA", exact: true }).click();
  await page.getByRole("button", { name: "运行数字 QA" }).click();
  // The engine now runs the full rule library, so target the number issue
  // card instead of assuming it is the first one.
  const numberIssue = page.locator(".issue-card", { hasText: "1300" }).first();
  await expect(numberIssue).toContainText("未解决");
  await shot("04-number-qa-issue.png");

  // AI assist degrades honestly without credentials.
  await page.getByRole("button", { name: "AI 辅助" }).click();
  await expect(page.locator(".tl-panel__header .tl-badge")).toContainText(
    "未配置",
  );
  await expect(page.locator(".honest-note").first()).toContainText(
    "不会假装成功",
  );
  await shot("05-ai-honest-unconfigured.png");

  // The agent cannot start without a provider: the start button stays
  // disabled and the honest note says why.
  await page.getByRole("button", { name: "Agent", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "创建任务单并运行" }),
  ).toBeDisabled();
  await expect(page.locator(".honest-note").first()).toContainText(
    "没有密钥时它不会启动",
  );
  await shot("06-agent-honest-refusal.png");

  // Export the translated DOCX through the (seamed) save dialog.
  await page.getByRole("button", { name: "导出译文" }).click();
  await expect(page.locator(".app-statusbar")).toContainText("导出完成", {
    timeout: 30_000,
  });
  expect(existsSync(exportPath)).toBe(true);
  expect(statSync(exportPath).size).toBeGreaterThan(0);
  await shot("07-exported.png");
});

// Continues in the same app instance: the document now has one confirmed,
// one draft, and one untranslated segment.
test("workbench intel: filter, concordance, preview, and settings", async () => {
  const rows = page.locator(".segment-grid tbody tr");

  // State filter narrows the grid; the count chip stays honest.
  await page.getByLabel("按状态筛选").selectOption("untranslated");
  await expect(rows).toHaveCount(1);
  await expect(page.locator(".grid-toolbar__count")).toHaveText("1/3");
  await page.getByRole("button", { name: "清除" }).click();
  await expect(rows).toHaveCount(3);

  // Text filter matches source and target text.
  await page.getByLabel("按文本筛选").fill("retention");
  await expect(rows).toHaveCount(1);
  await shot("08-grid-filter.png");
  await page.getByRole("button", { name: "清除" }).click();

  // F3 opens the concordance dock; hits jump back to the grid.
  await page.keyboard.press("F3");
  await expect(page.getByLabel(/检索词/)).toBeVisible();
  await page.getByLabel(/检索词/).fill("30");
  await expect(page.locator(".concordance__hit").first()).toBeVisible();
  await page
    .locator(".match-card")
    .first()
    .getByRole("button", { name: "定位句段" })
    .click();
  await expect(
    page.locator(".segment-grid tr[data-active='true']"),
  ).toBeVisible();
  await shot("09-concordance.png");

  // Preview backfills confirmed/draft targets and flags untranslated
  // segments instead of pretending the document is done. The proofread
  // view follows the segment that is active in the grid.
  await page.getByRole("button", { name: "预览", exact: true }).click();
  await expect(page.locator(".tl-dialog")).toContainText("译文预览");
  await expect(page.locator(".tl-dialog")).toContainText("保留期为 30 天。");
  await expect(
    page.locator(".preview__segment[data-fallback='true']").first(),
  ).toBeVisible();
  await expect(
    page.locator(".preview__segment[data-active='true']"),
  ).toBeVisible();
  await shot("10-preview.png");

  // Layout view: the engine's export pipeline produces the DOCX bytes and
  // docx-preview renders them — same artifact as「导出译文」.
  await page.getByRole("tab", { name: "版式视图（DOCX）" }).click();
  await expect(page.locator(".preview__docx .docx-wrapper")).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.locator(".preview__docx")).toContainText(
    "保留期为 30 天。",
  );
  await expect(page.locator(".tl-dialog")).toContainText("已回填 2 个已译单元");
  await shot("10b-preview-docx.png");
  await page.getByRole("button", { name: "关闭对话框" }).click();
  await expect(page.locator(".tl-dialog")).toHaveCount(0);

  // Project settings: language pair fixed, TM and termbase files move
  // through the dedicated dialog channels against the real engine.
  await page.getByRole("button", { name: "项目设置" }).click();
  await expect(page.locator(".settings__locales")).toHaveText("en-US → zh-CN");

  // External TM import: a real CSV through tm.import, honest counts back.
  const tmCsvPath = join(workDir, "external-tm.csv");
  writeFileSync(
    tmCsvPath,
    "source,target\nBilling is monthly.,按月计费。\nSupport hours are 24/7.,支持时间为全天候。\n",
  );
  await app.evaluate((_electronModule, path) => {
    process.env.TL_FAKE_TM_OPEN_PATH = path;
  }, tmCsvPath);
  await page.getByRole("button", { name: "导入外部 TM…" }).click();
  await expect(page.getByRole("status")).toContainText(
    "外部 TM 导入完成：读取 2 条，新增 2，更新 0",
  );

  // TM export: 1 confirmed entry + 2 imported ones land in a real TMX file.
  const tmExportPath = join(workDir, "tm-export.tmx");
  await app.evaluate((_electronModule, path) => {
    process.env.TL_FAKE_TM_SAVE_PATH = path;
  }, tmExportPath);
  await page.getByRole("button", { name: "导出 TM…" }).click();
  await expect(page.getByRole("status")).toContainText("TM 导出完成：3 条");
  expect(existsSync(tmExportPath)).toBe(true);
  expect(statSync(tmExportPath).size).toBeGreaterThan(0);

  // Honest failure: exporting to the same path again surfaces the engine's
  // refusal to overwrite instead of a fake success.
  await page.getByRole("button", { name: "导出 TM…" }).click();
  await expect(page.getByRole("alert")).toContainText("already exists");

  // Termbase: create + mount, then CSV import and export round-trip.
  await page.getByLabel("新术语库名称").fill("产品术语");
  await page.getByRole("button", { name: "新建并挂载" }).click();
  await expect(page.getByText("已挂载")).toBeVisible();

  // The CSV carries a term that hits segment 1 ("retention") so the dock
  // later shows the imported hit next to the quick-added one.
  const termCsvPath = join(workDir, "terms.csv");
  writeFileSync(
    termCsvPath,
    "sourceTerm,targetTerm\nbilling cycle,账单周期\nretention,保留\n",
  );
  await app.evaluate((_electronModule, path) => {
    process.env.TL_FAKE_TERM_OPEN_PATH = path;
  }, termCsvPath);
  await page.getByRole("button", { name: "导入术语到 产品术语" }).click();
  await expect(page.getByRole("status")).toContainText(
    "术语库「产品术语」导入完成：读取 2 条，新增 2，合并 0",
  );

  const termExportPath = join(workDir, "terms-export.csv");
  await app.evaluate((_electronModule, path) => {
    process.env.TL_FAKE_TERM_SAVE_PATH = path;
  }, termExportPath);
  await page.getByRole("button", { name: "导出术语库 产品术语" }).click();
  await expect(page.getByRole("status")).toContainText(
    "术语库「产品术语」导出完成：2 条",
  );
  expect(existsSync(termExportPath)).toBe(true);
  expect(statSync(termExportPath).size).toBeGreaterThan(0);

  // Term management: the mounted termbase is not write-only. List the
  // imported entries, edit one source/target pair through term.update,
  // then delete that entry through term.delete (leaving "retention"
  // untouched for the dock assertions below).
  const settingsDialog = page.locator(".tl-dialog");
  await page
    .getByRole("button", { name: "管理术语库 产品术语 的术语" })
    .click();
  await expect(settingsDialog).toContainText("2 条术语");
  await expect(settingsDialog).toContainText("billing cycle");
  await settingsDialog
    .getByRole("button", { name: "编辑译文 账单周期" })
    .click();
  await settingsDialog
    .getByLabel("源术语", { exact: true })
    .fill("billing period");
  await settingsDialog.getByLabel("目标术语", { exact: true }).fill("账期");
  await settingsDialog.getByRole("button", { name: "保存修改" }).click();
  await expect(settingsDialog).toContainText("billing period");
  await expect(settingsDialog).toContainText("账期");
  await shot("11a-term-manage.png");

  // Deleting takes an explicit confirmation and reports the real count.
  await settingsDialog
    .getByRole("button", { name: "删除术语 billing period" })
    .click();
  await settingsDialog
    .getByRole("button", { name: "确认删除术语 billing period" })
    .click();
  await expect(settingsDialog).toContainText("1 条术语");
  await expect(settingsDialog).not.toContainText("billing period");

  await shot("11-settings.png");
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(page.locator(".tl-dialog")).toHaveCount(0);

  // Term dock: quick-add a term into the mounted termbase; the active
  // segment then hits both the quick-added term and the CSV-imported one.
  await rows.first().click();
  await page.getByRole("button", { name: "术语", exact: true }).click();
  await page.getByLabel(/源术语/).fill("retention period");
  await page.getByLabel("目标术语").fill("保留期");
  await page.getByRole("button", { name: "添加术语" }).click();
  await expect(
    page.locator(".term-hit__target").filter({ hasText: "保留期" }).first(),
  ).toBeVisible();
  await expect(page.locator(".match-card")).toHaveCount(2);
  await shot("11b-term-hit.png");

  // Pretranslation runs against the project TM and reports honestly.
  await page.getByRole("button", { name: "预翻译" }).click();
  await expect(page.locator(".app-statusbar")).toContainText("预翻译完成");
  await shot("11c-pretranslate.png");
});

// Drives the import dialog end to end: re-point the source-file seam, pick
// the file, optionally flip segmentation or attach an SRX ruleset, submit.
async function importThroughDialog(
  path: string,
  options: { paragraph?: boolean; srxPath?: string; shot?: string } = {},
) {
  await app.evaluate((_electronModule, value) => {
    process.env.TL_FAKE_OPEN_PATH = value;
  }, path);
  await page.getByRole("button", { name: "导入", exact: true }).click();
  const dialog = page.locator(".tl-dialog");
  await dialog.getByRole("button", { name: "选择文件…" }).click();
  await expect(dialog).toContainText(path.split("/").pop() ?? path);
  if (options.paragraph) {
    await dialog.getByLabel("分段方式").selectOption("paragraph");
  }
  if (options.srxPath) {
    await app.evaluate((_electronModule, value) => {
      process.env.TL_FAKE_SRX_PATH = value;
    }, options.srxPath);
    await dialog.getByRole("button", { name: "选择 SRX 规则…" }).click();
    await expect(dialog).toContainText(
      options.srxPath.split("/").pop() ?? options.srxPath,
    );
  }
  if (options.shot) {
    await shot(options.shot);
  }
  await dialog.getByRole("button", { name: "导入", exact: true }).click();
}

// The TXT filter is registered engine-side; the import seam is re-pointed
// at a generated 400-paragraph file to exercise row virtualization for real.
test("virtualized grid stays windowed on a large document", async () => {
  const largePath = join(workDir, "large.txt");
  writeFileSync(
    largePath,
    Array.from(
      { length: 400 },
      (_, i) => `Segment number ${i} ends here.`,
    ).join("\n\n"),
  );
  await importThroughDialog(largePath);
  await expect(page.locator(".app-statusbar")).toContainText(
    "已导入「large.txt」",
    { timeout: 30_000 },
  );
  await expect(page.getByText("Segment number 0 ends here.")).toBeVisible();

  // Only a window of rows is mounted; spacers hold the rest of the height.
  const mounted = page.locator(
    ".segment-grid tbody tr:not(.segment-grid__spacer)",
  );
  expect(await mounted.count()).toBeLessThan(400);
  expect(
    await page.locator(".segment-grid tr.segment-grid__spacer").count(),
  ).toBeGreaterThan(0);

  // Scrolling to the bottom mounts the tail rows (wheel over the grid,
  // like a user would; the delta is clamped to the max scroll offset).
  await page.locator(".segment-grid").hover();
  await page.mouse.wheel(0, 100_000);
  await expect(page.getByText("Segment number 399 ends here.")).toBeVisible();
  expect(await mounted.count()).toBeLessThan(400);
  await shot("12-virtualized-tail.png");
});

// document.import options exposed by the dialog actually reach the engine:
// paragraph mode keeps a two-sentence paragraph whole, and a custom SRX
// ruleset overrides the built-in sentence breaks.
test("import dialog segmentation options shape the grid", async () => {
  const rows = page.locator(".segment-grid tbody tr");

  // Paragraph mode: one paragraph with two sentences stays one segment
  // (sentence mode would split it in two).
  const paragraphPath = join(workDir, "paragraph.txt");
  writeFileSync(paragraphPath, "First sentence. Second sentence.");
  await importThroughDialog(paragraphPath, { paragraph: true });
  await expect(page.locator(".app-statusbar")).toContainText(
    "已导入「paragraph.txt」：1 个句段",
    { timeout: 30_000 },
  );
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("First sentence. Second sentence.");
  await shot("13-paragraph-mode.png");

  // Custom SRX: only a semicolon breaks, so the built-in period rule no
  // longer splits and the first segment ends at the semicolon.
  const srxPath = join(workDir, "semicolon.srx");
  writeFileSync(
    srxPath,
    `<srx version="2.0"><header/><body>
      <languagerules><languagerule languagerulename="en" languagepattern="en.*">
        <rule break="yes"><beforebreak>;</beforebreak><afterbreak>\\s+</afterbreak></rule>
      </languagerule></languagerules>
      <maprules><maprule languagerulename="en" languagepattern="en.*"/></maprules>
    </body></srx>`,
  );
  const srxDocPath = join(workDir, "srx-doc.txt");
  writeFileSync(srxDocPath, "Alpha part; beta part. Still the same segment.");
  await importThroughDialog(srxDocPath, {
    srxPath,
    shot: "14a-import-dialog-srx.png",
  });
  await expect(page.locator(".app-statusbar")).toContainText(
    "已导入「srx-doc.txt」：2 个句段",
    { timeout: 30_000 },
  );
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText("Alpha part;");
  await expect(rows.nth(1)).toContainText("beta part. Still the same segment.");
  await shot("14-custom-srx.png");
});

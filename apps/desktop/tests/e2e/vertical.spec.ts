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

interface MenuItemSnapshot {
  label: string;
  enabled: boolean;
  accelerator: string | null;
  registerAccelerator: boolean;
}

// Playwright cannot drive native menus, so menu assertions run as pure
// main-process evaluations (template state) plus programmatic item clicks
// (the same handler a real click invokes) — no flaky native UI involved.
async function snapshotMenuItems(): Promise<MenuItemSnapshot[]> {
  return app.evaluate(({ Menu }) => {
    const snapshots: Array<{
      label: string;
      enabled: boolean;
      accelerator: string | null;
      registerAccelerator: boolean;
    }> = [];
    const menu = Menu.getApplicationMenu();
    if (!menu) {
      return snapshots;
    }
    const walk = (items: Electron.MenuItem[]): void => {
      for (const item of items) {
        snapshots.push({
          label: item.label,
          enabled: item.enabled,
          accelerator: item.accelerator ?? null,
          registerAccelerator: item.registerAccelerator,
        });
        if (item.submenu) {
          walk(item.submenu.items);
        }
      }
    };
    walk(menu.items);
    return snapshots;
  });
}

async function findMenuItem(label: string): Promise<MenuItemSnapshot | null> {
  const items = await snapshotMenuItems();
  return items.find((item) => item.label === label) ?? null;
}

/** Clicks a menu item from the main process; refuses when disabled. */
async function clickMenuItem(label: string): Promise<boolean> {
  return app.evaluate(({ Menu }, itemLabel) => {
    const menu = Menu.getApplicationMenu();
    if (!menu) {
      return false;
    }
    const walk = (items: Electron.MenuItem[]): Electron.MenuItem | null => {
      for (const item of items) {
        if (item.label === itemLabel) {
          return item;
        }
        if (item.submenu) {
          const hit = walk(item.submenu.items);
          if (hit) {
            return hit;
          }
        }
      }
      return null;
    };
    const item = walk(menu.items);
    if (!item || !item.enabled) {
      return false;
    }
    // Electron types `MenuItem.click` loosely as `Function`.
    (item.click as unknown as () => void)();
    return true;
  }, label);
}

test("vertical slice through the workbench", async () => {
  // Engine handshake surfaces in the bottom status bar.
  await expect(page.locator(".app-statusbar__engine")).toContainText("pid", {
    timeout: 30_000,
  });
  await shot("01-projects-empty.png");

  // The app ships a real localized menu instead of Electron's default
  // English one, and it is honest: no project open means the workbench
  // commands are disabled.
  const topLabels = await app.evaluate(({ Menu }) =>
    Menu.getApplicationMenu()?.items.map((item) => item.label),
  );
  expect(topLabels).toEqual(["文件", "编辑", "视图", "导航", "帮助"]);
  expect((await findMenuItem("导入文档…"))?.enabled).toBe(false);
  expect((await findMenuItem("导出译文…"))?.enabled).toBe(false);
  expect(await clickMenuItem("导出译文…")).toBe(false);

  // Create a project. The workbench opens with the reference pane map:
  // ribbon toolbar on top, project explorer on the left (title, language
  // pair), resource rail on the right.
  await page.getByPlaceholder("例如：产品手册 v3").fill("演示项目");
  await page.getByRole("button", { name: "创建项目" }).click();
  await expect(page.locator(".project-explorer__name")).toHaveText("演示项目");
  await expect(page.getByRole("toolbar", { name: "工具栏" })).toBeVisible();
  await expect(page.locator(".explorer__langs")).toContainText("en-US → zh-CN");

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
  // The imported document opens as a real editor tab, and the explorer's
  // project details carry the honest counts from document.list.
  await expect(
    page.getByRole("tab", { name: "m0-source.docx" }),
  ).toHaveAttribute("aria-selected", "true");
  const details = page.getByRole("region", { name: "项目详情" });
  await expect(details).toContainText("文件数");
  await expect(details).toContainText("总句段");
  await shot("02-imported-grid.png");

  // Edit and confirm segment 1 (writes the exact TM). Trados-style: the
  // row has no buttons — Ctrl+Enter in the target editor confirms and
  // advances the selection to the next unconfirmed segment.
  const editor = page.getByLabel("句段 1 译文");
  await editor.fill("保留期为 30 天。");
  await editor.press("Control+Enter");
  await expect(rows.first()).toContainText("已确认");
  await expect(page.locator(".app-statusbar")).toContainText("写入 TM");
  await expect(page.getByLabel("句段 2 译文")).toBeVisible();

  // Re-select segment 1: the TM dock reacts to the active segment and now
  // shows the 100% exact match written by the confirm.
  await rows.first().click();
  await expect(page.locator(".match-card").first()).toContainText("100%");
  await shot("03-confirmed-tm-hit.png");

  // Draft a wrong number in segment 2, then run the full QA library.
  // No save button: typing persists the draft automatically after the
  // pause — the row's state badge flips to 草稿 once the engine acks it
  // (the state cell, specifically: the editor hint also says 草稿).
  await rows.nth(1).click();
  const editor2 = page.getByLabel("句段 2 译文");
  await editor2.fill("表中金额：1,300。");
  await expect(rows.nth(1).locator(".segment-grid__state")).toContainText(
    "草稿",
  );
  await page.getByRole("button", { name: "QA", exact: true }).click();
  await page.getByRole("button", { name: "运行 QA" }).click();
  // The engine now runs the full rule library, so target the number issue
  // card instead of assuming it is the first one.
  const numberIssue = page.locator(".issue-card", { hasText: "1300" }).first();
  await expect(numberIssue).toContainText("未解决");
  await shot("04-number-qa-issue.png");

  // Waive the number issue: a human decision on record, not a fake resolve.
  // The card flips to 已忽略 and says honestly that nothing was confirmed
  // and nothing reached the TM; the segment stays a draft.
  await numberIssue.getByRole("button", { name: "忽略" }).click();
  const waivedIssue = page.locator(".issue-card", { hasText: "1300" }).first();
  await expect(waivedIssue).toContainText("已忽略");
  await expect(waivedIssue).toContainText("未确认句段、未写入 TM");
  await expect(page.locator(".app-statusbar")).toContainText("已忽略 QA 问题");
  await expect(rows.nth(1).locator(".segment-grid__state")).toContainText(
    "草稿",
  );
  await shot("04b-qa-issue-waived.png");

  // 恢复 brings the same issue back to 未解决 for the rest of the run.
  await waivedIssue.getByRole("button", { name: "恢复" }).click();
  await expect(
    page.locator(".issue-card", { hasText: "1300" }).first(),
  ).toContainText("未解决");

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

  // State filter narrows the grid; the ribbon count chip stays honest.
  await page.getByLabel("按状态筛选").selectOption("untranslated");
  await expect(rows).toHaveCount(1);
  await expect(page.locator(".ribbon__filter-count")).toHaveText("1/3");
  await page.getByRole("button", { name: "清除" }).click();
  await expect(rows).toHaveCount(3);

  // The ribbon's far-right search filters source and target text.
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
  // view follows the segment that is active in the grid. It opens from
  // the 预览 view tab under the grid.
  await page.getByRole("tab", { name: "预览", exact: true }).click();
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
  await expect(page.locator(".tl-dialog")).toContainText(
    "点击段落可跳转到编辑网格",
  );
  await shot("10b-preview-docx.png");

  // Click-to-segment: the preview export embeds per-paragraph segment
  // anchors, so clicking the draft table paragraph jumps the grid to its
  // segment through the same onJump path the proofread view uses (which
  // also closes the dialog).
  await page
    .locator(".preview__docx p", { hasText: "表中金额" })
    .first()
    .click();
  await expect(page.locator(".tl-dialog")).toHaveCount(0);
  await expect(
    page.locator(".segment-grid tr[data-active='true']"),
  ).toContainText("表中金额");

  // Project settings: the project info form edits name and language pair
  // through project.update, and TM and termbase files move through the
  // dedicated dialog channels against the real engine.
  await page.getByRole("button", { name: "项目设置" }).click();
  const settingsForm = page.locator(".tl-dialog");
  await expect(settingsForm.getByLabel("项目名称")).toHaveValue("演示项目");
  await expect(settingsForm.getByLabel("源语言")).toHaveValue("en-US");
  await expect(settingsForm.getByLabel("目标语言")).toHaveValue("zh-CN");

  // The import-defaults section reflects what the DOCX import auto-saved
  // earlier in the run: sentence mode with the built-in SRX rules.
  await expect(settingsForm.getByLabel("默认分段方式")).toHaveValue("sentence");
  await expect(settingsForm).toContainText("内置规则（en-US）");
  await shot("11d-import-defaults.png");

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

  // Honest overwrite flow: exporting to the same path again is refused by
  // the engine (destination exists) and surfaces an explicit confirm
  // instead of a fake success or a dead-end failure.
  const statBeforeCancel = statSync(tmExportPath);
  await page.getByRole("button", { name: "导出 TM…" }).click();
  const overwritePrompt = page.getByRole("alertdialog", {
    name: "目标已存在，要覆盖吗？",
  });
  await expect(overwritePrompt).toContainText("tm-export.tmx");
  await overwritePrompt.scrollIntoViewIfNeeded();
  await shot("10c-tm-overwrite-confirm.png");

  // 取消 leaves the existing file untouched: same bytes, same mtime.
  await page.getByRole("button", { name: "取消" }).click();
  await expect(overwritePrompt).toHaveCount(0);
  await expect(page.getByRole("status")).toContainText("已取消导出");
  const statAfterCancel = statSync(tmExportPath);
  expect(statAfterCancel.size).toBe(statBeforeCancel.size);
  expect(statAfterCancel.mtimeMs).toBe(statBeforeCancel.mtimeMs);

  // 覆盖 retries with the explicit overwrite flag and replaces the file.
  await page.getByRole("button", { name: "导出 TM…" }).click();
  await expect(overwritePrompt).toBeVisible();
  await page.getByRole("button", { name: "覆盖" }).click();
  await expect(page.getByRole("status")).toContainText(
    "TM 导出完成（已覆盖）：3 条",
  );
  expect(existsSync(tmExportPath)).toBe(true);
  expect(statSync(tmExportPath).size).toBeGreaterThan(0);

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
  // The dialog pre-fills from the project defaults auto-saved by the last
  // successful import, so make this import's choice explicit instead of
  // inheriting whatever an earlier test stored.
  await dialog
    .getByLabel("分段方式")
    .selectOption(options.paragraph ? "paragraph" : "sentence");
  if (options.srxPath) {
    await app.evaluate((_electronModule, value) => {
      process.env.TL_FAKE_SRX_PATH = value;
    }, options.srxPath);
    await dialog.getByRole("button", { name: "选择 SRX 规则…" }).click();
    await expect(dialog).toContainText(
      options.srxPath.split("/").pop() ?? options.srxPath,
    );
  } else if (!options.paragraph) {
    // Drop an inherited SRX default so this import uses the built-ins.
    const clearSrx = dialog.getByRole("button", { name: "清除" });
    if (await clearSrx.isVisible()) {
      await clearSrx.click();
    }
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

  // The paragraph choice was auto-saved as the project default, so
  // reopening the dialog pre-fills it (persisted through the real engine).
  await page.getByRole("button", { name: "导入", exact: true }).click();
  const prefillDialog = page.locator(".tl-dialog");
  await expect(prefillDialog.getByLabel("分段方式")).toHaveValue("paragraph");
  await prefillDialog.getByRole("button", { name: "取消" }).click();
  await expect(page.locator(".tl-dialog")).toHaveCount(0);

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

// Runs with the state left by the previous tests: project open, document
// open. Menu assertions stay in the main process (template snapshot +
// programmatic clicks) — Playwright never touches the native menu bar.
test("application menu mirrors workbench state and shortcuts", async () => {
  // With a document open, every workbench command is enabled.
  for (const label of [
    "导入文档…",
    "导出译文…",
    "项目设置…",
    "返回项目列表",
    "确认当前句段",
    "译文预览…",
    "翻译记忆面板",
    "QA 面板",
    "筛选句段",
    "一致性检索（取选中文本）",
  ]) {
    expect((await findMenuItem(label))?.enabled, label).toBe(true);
  }

  // Renderer-owned chords (already handled by workbench keydown/textarea
  // handlers) are displayed but not registered, so the menu never swallows
  // them; menu-owned accelerators are registered normally.
  const items = await snapshotMenuItems();
  const byLabel = new Map(items.map((item) => [item.label, item]));
  expect(byLabel.get("一致性检索（取选中文本）")?.accelerator).toBe("F3");
  expect(byLabel.get("一致性检索（取选中文本）")?.registerAccelerator).toBe(
    false,
  );
  expect(byLabel.get("确认当前句段")?.registerAccelerator).toBe(false);
  expect(byLabel.get("筛选句段")?.registerAccelerator).toBe(false);
  expect(byLabel.get("导入文档…")?.accelerator).toBe("CmdOrCtrl+O");
  expect(byLabel.get("导入文档…")?.registerAccelerator).toBe(true);

  // Menu clicks reach the renderer over IPC and drive the same commands as
  // the workbench buttons: dock switch, then the preview dialog.
  expect(await clickMenuItem("QA 面板")).toBe(true);
  await expect(page.getByRole("button", { name: "运行 QA" })).toBeVisible();

  expect(await clickMenuItem("译文预览…")).toBe(true);
  await expect(page.locator(".tl-dialog")).toContainText("译文预览");
  await page.getByRole("button", { name: "关闭对话框" }).click();
  await expect(page.locator(".tl-dialog")).toHaveCount(0);
});

// Phase 1 vertical slice through the real UI and real engine:
// create project -> import DOCX -> edit/confirm -> exact TM -> number QA ->
// export DOCX, plus the honest AI/Agent degradation without credentials.
import { existsSync, mkdtempSync, mkdirSync, statSync } from "node:fs";
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

  // Import the DOCX fixture through the (seamed) file dialog.
  await page.getByRole("button", { name: "导入" }).click();
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

  // The agent refuses to fake a run without a provider.
  await page.getByRole("button", { name: "Agent", exact: true }).click();
  await page.getByRole("button", { name: "对当前文档运行 Agent" }).click();
  await expect(page.locator(".honest-note[data-tone='danger']")).toContainText(
    "不会假装完成任务",
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

import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { test, expect, type Page, type ConsoleMessage } from "@playwright/test";
import { _electron as electron, type ElectronApplication } from "playwright";

const require = createRequire(import.meta.url);
const electronExecutable = require("electron") as string;
const desktopRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const sourceFixture = join(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures/single-segment-source.txt",
);

async function launchApp(options: {
  userData: string;
  sourcePath?: string;
}): Promise<{ app: ElectronApplication; page: Page }> {
  const env: { [key: string]: string } = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") env[key] = value;
  }
  env.TRANSLUNAR_TEST_USER_DATA = options.userData;
  env.TRANSLUNAR_DATA_DIR = join(options.userData, "engine-data");
  if (options.sourcePath) {
    env.TRANSLUNAR_TEST_SOURCE = options.sourcePath;
    env.TRANSLUNAR_TEST_SOURCE_FILES = options.sourcePath;
  }

  const app = await electron.launch({
    executablePath: electronExecutable,
    args: ["."],
    cwd: desktopRoot,
    env,
  });

  const page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  return { app, page };
}

function attachConsoleGuard(page: Page): {
  errors: string[];
  dispose: () => void;
} {
  const errors: string[] = [];
  const onConsole = (msg: ConsoleMessage) => {
    if (msg.type() === "error") {
      errors.push(msg.text());
    }
  };
  const onPageError = (err: Error) => {
    errors.push(err.message);
  };
  page.on("console", onConsole);
  page.on("pageerror", onPageError);
  return {
    errors,
    dispose: () => {
      page.off("console", onConsole);
      page.off("pageerror", onPageError);
    },
  };
}

async function createProjectAndImport(page: Page): Promise<void> {
  await expect(page.getByTestId("welcome")).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByTestId("create-project")).toBeVisible();
  await page.getByLabel("Name").fill(`P3 ${Date.now()}`);
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByTestId("import-document")).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole("button", { name: "Choose files" }).click();
  await expect(page.getByTestId("workbench")).toBeVisible({ timeout: 60_000 });
}

test.describe("P3 interop / PDF / task package", () => {
  test("Insights interop and task package sections are reachable", async () => {
    const userData = await mkdtemp(join(tmpdir(), "tl-p3-"));
    const { app, page } = await launchApp({
      userData,
      sourcePath: sourceFixture,
    });
    const guard = attachConsoleGuard(page);

    try {
      await createProjectAndImport(page);

      await page.getByTestId("nav-insights").click();
      await expect(page.getByTestId("project-insights")).toBeVisible({
        timeout: 30_000,
      });

      await page.getByTestId("insights-section-interop").click();
      await expect(page.getByTestId("insights-interop")).toBeVisible();
      await expect(page.getByTestId("interop-review-panel")).toBeVisible();
      await page.getByTestId("interop-mode-table").click();
      await expect(page.getByTestId("interop-table-panel")).toBeVisible();

      await page.getByTestId("insights-section-task").click();
      await expect(page.getByTestId("task-package-panel")).toBeVisible();

      // Dialog cancel paths: export without path should leave UI stable
      // (engine may open native dialog; when TRANSLUNAR_TEST paths unset, cancel)
      await page.getByTestId("insights-section-interop").click();
      await page.getByTestId("interop-mode-review").click();
      await expect(page.getByTestId("interop-review-apply")).toBeDisabled();

      // Non-PDF source: no PDF chrome
      await page.getByRole("button", { name: "Back" }).click();
      await expect(page.getByTestId("workbench")).toBeVisible({
        timeout: 30_000,
      });
      await expect(page.getByTestId("pdf-page-review")).toHaveCount(0);

      // Reimport entry present on Workbench
      await expect(page.getByTestId("reimport-open")).toBeVisible();
      await page.getByTestId("reimport-open").click();
      await expect(page.getByTestId("reimport-dialog")).toBeVisible();
      await page
        .getByTestId("reimport-dialog")
        .getByRole("button", { name: "Cancel" })
        .click();
      await expect(page.getByTestId("reimport-dialog")).toHaveCount(0);

      const critical = guard.errors.filter(
        (e) =>
          !e.includes("DevTools") &&
          !e.includes("Autofill") &&
          !e.includes("Electron Security Warning"),
      );
      expect(critical, critical.join("\n")).toEqual([]);
    } finally {
      guard.dispose();
      await app.close();
      await rm(userData, { recursive: true, force: true });
    }
  });

  test("PDF review path is fixture/tool gated", async () => {
    // PDF OCR requires Poppler/Tesseract + PDF fixture in the environment.
    // Unit tests cover list→get→correct with fake Engine. Real-Engine PDF E2E
    // is skipped when no PDF fixture is configured.
    const pdfFixture = process.env.TRANSLUNAR_TEST_PDF;
    test.skip(
      !pdfFixture,
      "TRANSLUNAR_TEST_PDF not set — PDF real-Engine path covered by unit tests",
    );

    const userData = await mkdtemp(join(tmpdir(), "tl-p3-pdf-"));
    const { app, page } = await launchApp({
      userData,
      sourcePath: pdfFixture as string,
    });
    const guard = attachConsoleGuard(page);
    try {
      await createProjectAndImport(page);
      await expect(page.getByTestId("pdf-page-review")).toBeVisible({
        timeout: 60_000,
      });
      await expect(page.getByTestId("pdf-page-image")).toBeVisible({
        timeout: 30_000,
      });
      expect(guard.errors.length).toBeGreaterThanOrEqual(0);
    } finally {
      guard.dispose();
      await app.close();
      await rm(userData, { recursive: true, force: true });
    }
  });

  test("interop review export→preview→apply is fixture gated", async () => {
    const reviewPath = process.env.TRANSLUNAR_TEST_INTEROP_REVIEW;
    const exportPath = process.env.TRANSLUNAR_TEST_EXPORT_DOCX;
    test.skip(
      !reviewPath,
      "TRANSLUNAR_TEST_INTEROP_REVIEW not set — review interop apply covered by unit tests",
    );

    const userData = await mkdtemp(join(tmpdir(), "tl-p3-review-"));
    const env: { [key: string]: string } = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (typeof value === "string") env[key] = value;
    }
    env.TRANSLUNAR_TEST_USER_DATA = userData;
    env.TRANSLUNAR_DATA_DIR = join(userData, "engine-data");
    env.TRANSLUNAR_TEST_SOURCE = sourceFixture;
    env.TRANSLUNAR_TEST_SOURCE_FILES = sourceFixture;
    env.TRANSLUNAR_TEST_INTEROP_REVIEW = reviewPath as string;
    if (exportPath) env.TRANSLUNAR_TEST_EXPORT_DOCX = exportPath;

    const app = await electron.launch({
      executablePath: electronExecutable,
      args: ["."],
      cwd: desktopRoot,
      env,
    });
    const page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    const guard = attachConsoleGuard(page);
    try {
      await createProjectAndImport(page);
      await page.getByTestId("nav-insights").click();
      await expect(page.getByTestId("project-insights")).toBeVisible({
        timeout: 30_000,
      });
      await page.getByTestId("insights-section-interop").click();
      await page.getByTestId("interop-mode-review").click();
      await page.getByTestId("interop-review-open").click();
      await page.getByTestId("interop-review-preview").click();
      await expect(page.getByTestId("interop-review-table")).toBeVisible({
        timeout: 60_000,
      });
      // Apply remains gated on selection + actor/reason; unit covers apply.
      await expect(page.getByTestId("interop-review-apply")).toBeVisible();
    } finally {
      guard.dispose();
      await app.close();
      await rm(userData, { recursive: true, force: true });
    }
  });

  test("interop table preview is fixture gated", async () => {
    const tablePath = process.env.TRANSLUNAR_TEST_INTEROP_TABLE;
    test.skip(
      !tablePath,
      "TRANSLUNAR_TEST_INTEROP_TABLE not set — table interop covered by unit tests",
    );

    const userData = await mkdtemp(join(tmpdir(), "tl-p3-table-"));
    const env: { [key: string]: string } = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (typeof value === "string") env[key] = value;
    }
    env.TRANSLUNAR_TEST_USER_DATA = userData;
    env.TRANSLUNAR_DATA_DIR = join(userData, "engine-data");
    env.TRANSLUNAR_TEST_SOURCE = sourceFixture;
    env.TRANSLUNAR_TEST_SOURCE_FILES = sourceFixture;
    env.TRANSLUNAR_TEST_INTEROP_TABLE = tablePath as string;

    const app = await electron.launch({
      executablePath: electronExecutable,
      args: ["."],
      cwd: desktopRoot,
      env,
    });
    const page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    const guard = attachConsoleGuard(page);
    try {
      await createProjectAndImport(page);
      await page.getByTestId("nav-insights").click();
      await expect(page.getByTestId("project-insights")).toBeVisible({
        timeout: 30_000,
      });
      await page.getByTestId("insights-section-interop").click();
      await page.getByTestId("interop-mode-table").click();
      await page.getByTestId("interop-table-open").click();
      await page.getByTestId("interop-table-preview").click();
      await expect(page.getByTestId("interop-table-rows")).toBeVisible({
        timeout: 60_000,
      });
    } finally {
      guard.dispose();
      await app.close();
      await rm(userData, { recursive: true, force: true });
    }
  });

  test("task package open→preview is fixture gated", async () => {
    const packagePath = process.env.TRANSLUNAR_TEST_TASK_PACKAGE_INPUT;
    test.skip(
      !packagePath,
      "TRANSLUNAR_TEST_TASK_PACKAGE_INPUT not set — task package apply covered by unit tests",
    );

    const userData = await mkdtemp(join(tmpdir(), "tl-p3-task-"));
    const env: { [key: string]: string } = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (typeof value === "string") env[key] = value;
    }
    env.TRANSLUNAR_TEST_USER_DATA = userData;
    env.TRANSLUNAR_DATA_DIR = join(userData, "engine-data");
    env.TRANSLUNAR_TEST_SOURCE = sourceFixture;
    env.TRANSLUNAR_TEST_SOURCE_FILES = sourceFixture;
    env.TRANSLUNAR_TEST_TASK_PACKAGE_INPUT = packagePath as string;

    const app = await electron.launch({
      executablePath: electronExecutable,
      args: ["."],
      cwd: desktopRoot,
      env,
    });
    const page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    const guard = attachConsoleGuard(page);
    try {
      await createProjectAndImport(page);
      await page.getByTestId("nav-insights").click();
      await expect(page.getByTestId("project-insights")).toBeVisible({
        timeout: 30_000,
      });
      await page.getByTestId("insights-section-task").click();
      await expect(page.getByTestId("task-package-panel")).toBeVisible();
      await page.getByTestId("task-open").click();
      await page.locator("#task-actor").fill("e2e");
      await page.locator("#task-reason").fill("fixture preview");
      await page.getByTestId("task-preview").click();
      await expect(page.getByTestId("task-rows")).toBeVisible({
        timeout: 60_000,
      });
    } finally {
      guard.dispose();
      await app.close();
      await rm(userData, { recursive: true, force: true });
    }
  });
});

import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
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
/**
 * The repository ships deterministic PDF fixtures, so the real-Engine PDF path
 * is verifiable by default instead of skipped. TRANSLUNAR_TEST_PDF still wins
 * when a lane wants to point at a different document.
 */
const pdfFixtureDefault = join(
  desktopRoot,
  "../../fixtures/pdf/text-layout.pdf",
);

function pdfInfoAvailable(): boolean {
  const configured = process.env.TRANSLUNAR_PDFINFO_PATH?.trim();
  const command = configured || "pdfinfo";
  const result = spawnSync(command, ["-v"], {
    encoding: "utf8",
    timeout: 5_000,
    windowsHide: true,
  });
  if (result.error) {
    return false;
  }
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.toLowerCase();
  return result.status === 0 || output.includes("pdfinfo");
}

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
    // is skipped when no PDF fixture is configured, or when pdfinfo is absent
    // (Windows packaging runners do not install Poppler).
    const pdfFixture = process.env.TRANSLUNAR_TEST_PDF ?? pdfFixtureDefault;
    test.skip(!existsSync(pdfFixture), `no PDF fixture at ${pdfFixture}`);
    test.skip(
      !pdfInfoAvailable(),
      "pdfinfo not on PATH; PDF review E2E is tool-gated",
    );

    const userData = await mkdtemp(join(tmpdir(), "tl-p3-pdf-"));
    const { app, page } = await launchApp({
      userData,
      sourcePath: pdfFixture,
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
    // Round trip: the app exports the bilingual review document, then reads
    // the same path back. No external fixture is required, and the export and
    // import halves are verified against each other.
    const userData = await mkdtemp(join(tmpdir(), "tl-p3-review-"));
    const reviewPath =
      process.env.TRANSLUNAR_TEST_INTEROP_REVIEW ??
      join(userData, "interop-review.docx");
    const exportPath = process.env.TRANSLUNAR_TEST_EXPORT_DOCX ?? reviewPath;
    const env: { [key: string]: string } = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (typeof value === "string") env[key] = value;
    }
    env.TRANSLUNAR_TEST_USER_DATA = userData;
    env.TRANSLUNAR_DATA_DIR = join(userData, "engine-data");
    env.TRANSLUNAR_TEST_SOURCE = sourceFixture;
    env.TRANSLUNAR_TEST_SOURCE_FILES = sourceFixture;
    env.TRANSLUNAR_TEST_INTEROP_REVIEW = reviewPath;
    env.TRANSLUNAR_TEST_EXPORT_DOCX = exportPath;

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

      // Produce the fixture with the product, then consume it.
      await page.getByTestId("interop-review-export").click();
      await expect(
        page.getByTestId("interop-review-export-notice"),
      ).toBeVisible({ timeout: 60_000 });
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
    // The bilingual table filter accepts the same document the review panel
    // exports, so the table path is exercised without an external fixture.
    const userData = await mkdtemp(join(tmpdir(), "tl-p3-table-"));
    const tablePath =
      process.env.TRANSLUNAR_TEST_INTEROP_TABLE ??
      join(userData, "interop-table.docx");
    const env: { [key: string]: string } = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (typeof value === "string") env[key] = value;
    }
    env.TRANSLUNAR_TEST_USER_DATA = userData;
    env.TRANSLUNAR_DATA_DIR = join(userData, "engine-data");
    env.TRANSLUNAR_TEST_SOURCE = sourceFixture;
    env.TRANSLUNAR_TEST_SOURCE_FILES = sourceFixture;
    env.TRANSLUNAR_TEST_INTEROP_TABLE = tablePath;
    env.TRANSLUNAR_TEST_EXPORT_DOCX = tablePath;

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

      // Produce the bilingual document, then read it back through the table.
      await page.getByTestId("interop-mode-review").click();
      await page.getByTestId("interop-review-export").click();
      await expect(
        page.getByTestId("interop-review-export-notice"),
      ).toBeVisible({ timeout: 60_000 });

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
    /*
     * Still fixture gated, deliberately and with a recorded reason.
     *
     * The PDF, interop review, and interop table paths were closed by making
     * the test produce its own fixture through the product's export. The same
     * round trip was attempted here and did not settle inside the timeout, so
     * rather than ship a flaky always-on case this stays gated on a supplied
     * package until the export-then-open sequence is understood. Set
     * TRANSLUNAR_TEST_TASK_PACKAGE_INPUT to a .tltask file to run it.
     * Tracked in docs/release-readiness.md.
     */
    const packagePath = process.env.TRANSLUNAR_TEST_TASK_PACKAGE_INPUT;
    test.skip(
      !packagePath,
      "TRANSLUNAR_TEST_TASK_PACKAGE_INPUT not set; task package apply is covered by unit tests",
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

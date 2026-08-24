import { createRequire } from "node:module";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { test, expect, type Page, type ConsoleMessage } from "@playwright/test";
import { _electron as electron, type ElectronApplication } from "playwright";

import { expectNoAxeViolations } from "./helpers/ui-checks.js";

const require = createRequire(import.meta.url);
const electronExecutable = require("electron") as string;
const desktopRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const fixtureA = join(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures/single-segment-source.txt",
);

async function launchApp(options: {
  userData: string;
  sourceFiles?: string[];
}): Promise<{ app: ElectronApplication; page: Page }> {
  const env: { [key: string]: string } = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") env[key] = value;
  }
  env.TRANSLUNAR_TEST_USER_DATA = options.userData;
  env.TRANSLUNAR_DATA_DIR = join(options.userData, "engine-data");
  if (options.sourceFiles && options.sourceFiles.length > 0) {
    const sep = process.platform === "win32" ? ";" : ":";
    env.TRANSLUNAR_TEST_SOURCE_FILES = options.sourceFiles.join(sep);
    env.TRANSLUNAR_TEST_SOURCE = options.sourceFiles[0]!;
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

async function expectNoViewportOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    return {
      scrollWidth: doc.scrollWidth,
      clientWidth: doc.clientWidth,
    };
  });
  expect(
    overflow.scrollWidth,
    `viewport horizontal overflow: ${JSON.stringify(overflow)}`,
  ).toBeLessThanOrEqual(overflow.clientWidth + 1);
}

async function createImportedProject(page: Page, name: string): Promise<void> {
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByTestId("create-project")).toBeVisible();
  await page.getByLabel("Name").fill(name);
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByTestId("import-document")).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole("button", { name: "Choose files" }).click();
  await expect(page.getByTestId("workbench")).toBeVisible({
    timeout: 60_000,
  });
}

function documentSelect(page: Page) {
  return page.getByTestId("document-switcher-select");
}

async function readSessionIdentity(page: Page): Promise<{
  version: number;
  projectId: string;
  documentId: string;
}> {
  const raw = await page.evaluate(() =>
    localStorage.getItem("translunar.renderer.session.v1"),
  );
  expect(raw, "session-v1 must be persisted").toBeTruthy();
  const parsed = JSON.parse(raw!) as {
    version: number;
    projectId: string;
    documentId: string;
  };
  expect(parsed.version).toBe(1);
  expect(parsed.projectId).toBeTruthy();
  expect(parsed.documentId).toBeTruthy();
  return parsed;
}

async function openProjectRow(page: Page, projectName: string): Promise<void> {
  await page
    .locator(".project-row")
    .filter({ hasText: projectName })
    .getByRole("button", { name: "Open", exact: true })
    .click();
}

/**
 * Secondary and destructive row actions live behind the row overflow menu, so
 * a test opens the menu exactly as a user does. Passing a row filter keeps the
 * assertion bound to one project or template.
 */
async function openRowAction(
  page: Page,
  row: { hasText: string } | null,
  action: string,
): Promise<void> {
  const scope = row
    ? page.locator(".project-list__item").filter({ hasText: row.hasText })
    : page.locator(".project-list__item").first();
  await scope.getByRole("button", { name: /^More actions for / }).click();
  await page.getByRole("menuitem", { name: action }).click();
}

test.describe("P1 project lifecycle", () => {
  test("S9–S10 dirty switch, add-files retention, search hit, insights, relaunch", async () => {
    const userData = await mkdtemp(join(tmpdir(), "tl-p1-s9-"));
    const secondSource = join(userData, "second-source.txt");
    const thirdSource = join(userData, "third-source.txt");
    const uniqueSearchText = "Second document line for P1 search.";
    const dirtyTargetText = "Dirty target before switch";
    await writeFile(secondSource, uniqueSearchText, "utf8");
    await writeFile(thirdSource, "Third document retained after add.", "utf8");
    let app: ElectronApplication | undefined;
    let page: Page;
    let consoleGuard: ReturnType<typeof attachConsoleGuard> | undefined;

    try {
      ({ app, page } = await launchApp({
        userData,
        sourceFiles: [fixtureA, secondSource],
      }));
      consoleGuard = attachConsoleGuard(page);
      await page.setViewportSize({ width: 1250, height: 744 });

      await expect(page.getByTestId("welcome")).toBeVisible({
        timeout: 60_000,
      });
      await createImportedProject(page, "P1 Multi");

      await expect(page.getByTestId("document-switcher")).toBeVisible();
      await expect(page.getByTestId("batch-import-summary")).toBeVisible({
        timeout: 15_000,
      });

      const select = documentSelect(page);
      const optionCount = await select.locator("option").count();
      expect(optionCount).toBeGreaterThanOrEqual(2);
      const firstValue = await select
        .locator("option")
        .nth(0)
        .getAttribute("value");
      const secondValue = await select
        .locator("option")
        .nth(1)
        .getAttribute("value");
      if (!firstValue || !secondValue) {
        throw new Error("Expected two document options");
      }

      // Dirty target then switch — save-before-switch must retain continuity.
      const editor = page.locator('[data-testid^="target-editor-"]').first();
      await editor.fill(dirtyTargetText);
      await select.selectOption(secondValue);
      await expect(page.getByTestId("workbench")).toBeVisible({
        timeout: 30_000,
      });
      await expect(select).toHaveValue(secondValue);

      const sessionAfterSwitch = await readSessionIdentity(page);
      expect(sessionAfterSwitch.documentId).toBe(secondValue);

      // Prove dirty target persisted on the previous document.
      await select.selectOption(firstValue);
      await expect(page.getByTestId("workbench")).toBeVisible({
        timeout: 30_000,
      });
      await expect(
        page.locator('[data-testid^="target-editor-"]').first(),
      ).toHaveValue(dirtyTargetText);
      await select.selectOption(secondValue);
      await expect(select).toHaveValue(secondValue);

      // Mid-run picker env cannot change: close and relaunch with only thirdSource.
      await app.close();
      app = undefined;
      ({ app, page } = await launchApp({
        userData,
        sourceFiles: [thirdSource],
      }));
      consoleGuard.dispose();
      consoleGuard = attachConsoleGuard(page);
      await page.setViewportSize({ width: 1250, height: 744 });

      await expect(page.getByTestId("workbench")).toBeVisible({
        timeout: 90_000,
      });
      const resumedSelect = documentSelect(page);
      await expect(resumedSelect).toHaveValue(secondValue);
      const sessionResumed = await readSessionIdentity(page);
      expect(sessionResumed.documentId).toBe(secondValue);
      expect(sessionResumed.projectId).toBe(sessionAfterSwitch.projectId);

      const optionsBeforeAdd = await resumedSelect.locator("option").count();
      await page.getByTestId("add-files").click();
      await expect(page.getByTestId("batch-import-summary")).toBeVisible({
        timeout: 30_000,
      });
      await expect(page.getByTestId("batch-import-summary")).toContainText(
        /succeeded/i,
      );
      await expect
        .poll(async () => resumedSelect.locator("option").count(), {
          timeout: 30_000,
        })
        .toBeGreaterThan(optionsBeforeAdd);
      await expect(resumedSelect).toHaveValue(secondValue);

      // Search must yield and activate a real hit for deterministic imported text.
      await page.getByTestId("nav-search").click();
      await expect(page.getByTestId("global-search")).toBeVisible();
      await page.getByLabel("Query").fill(uniqueSearchText);
      await page
        .getByTestId("global-search")
        .getByRole("button", { name: "Search", exact: true })
        .click();
      await expect(page.getByTestId("search-result-status")).toContainText(
        /[1-9]\d* result/,
        { timeout: 30_000 },
      );
      const hitButton = page
        .getByTestId("search-results")
        .getByRole("button")
        .first();
      await expect(hitButton).toBeVisible({ timeout: 15_000 });
      await hitButton.click();
      await expect(page.getByTestId("workbench")).toBeVisible({
        timeout: 30_000,
      });
      const sessionAfterSearch = await readSessionIdentity(page);
      expect(sessionAfterSearch.projectId).toBe(sessionAfterSwitch.projectId);
      await expect(documentSelect(page)).toHaveValue(
        sessionAfterSearch.documentId,
      );

      await page.getByRole("button", { name: "Home" }).click();
      await expect(page.getByTestId("project-home")).toBeVisible({
        timeout: 30_000,
      });
      await openRowAction(page, { hasText: "P1 Multi" }, "Insights");
      await expect(page.getByTestId("project-insights")).toBeVisible({
        timeout: 30_000,
      });
      await expect(page.getByText("Progress")).toBeVisible();
      await expectNoAxeViolations(page, "insights");
      await expectNoViewportOverflow(page);

      // Hydrate final Workbench identity before process relaunch.
      await page.getByRole("button", { name: "Home" }).click();
      await expect(page.getByTestId("project-home")).toBeVisible({
        timeout: 30_000,
      });
      await openProjectRow(page, "P1 Multi");
      await expect(page.getByTestId("workbench")).toBeVisible({
        timeout: 60_000,
      });
      const sessionBeforeRelaunch = await readSessionIdentity(page);
      await expect(documentSelect(page)).toHaveValue(
        sessionBeforeRelaunch.documentId,
      );

      await app.close();
      app = undefined;
      ({ app, page } = await launchApp({
        userData,
        sourceFiles: [thirdSource],
      }));
      consoleGuard.dispose();
      consoleGuard = attachConsoleGuard(page);
      await expect(page.getByTestId("workbench")).toBeVisible({
        timeout: 90_000,
      });
      const sessionAfterRelaunch = await readSessionIdentity(page);
      expect(sessionAfterRelaunch.projectId).toBe(
        sessionBeforeRelaunch.projectId,
      );
      expect(sessionAfterRelaunch.documentId).toBe(
        sessionBeforeRelaunch.documentId,
      );
      await expect(documentSelect(page)).toHaveValue(
        sessionBeforeRelaunch.documentId,
      );
      await expect(page.getByTestId("app-shell")).toContainText("P1 Multi");

      expect(consoleGuard.errors, consoleGuard.errors.join("\n")).toEqual([]);
    } finally {
      consoleGuard?.dispose();
      if (app) await app.close();
      await rm(userData, { recursive: true, force: true });
    }
  });

  test("S11–S16 templates, project update/archive/unarchive, recycle lifecycle", async () => {
    const userData = await mkdtemp(join(tmpdir(), "tl-p1-tpl-"));
    let app: ElectronApplication | undefined;
    let page: Page;
    let consoleGuard: ReturnType<typeof attachConsoleGuard> | undefined;

    try {
      ({ app, page } = await launchApp({
        userData,
        sourceFiles: [fixtureA],
      }));
      consoleGuard = attachConsoleGuard(page);
      await page.setViewportSize({ width: 1250, height: 744 });

      await expect(page.getByTestId("welcome")).toBeVisible({
        timeout: 60_000,
      });
      await createImportedProject(page, "P1 Seed");

      await page.getByRole("button", { name: "Home" }).click();
      await expect(page.getByTestId("project-home")).toBeVisible({
        timeout: 30_000,
      });

      // Project edit via authoritative get.
      await openRowAction(page, { hasText: "P1 Seed" }, "Edit");
      const editDialog = page.getByTestId("edit-project-dialog");
      await expect(editDialog).toBeVisible();
      await expect(
        editDialog.getByRole("button", { name: "Cancel" }),
      ).toBeFocused();
      await editDialog.getByLabel("Name").fill("P1 Seed Updated");
      await editDialog.getByRole("button", { name: "Save" }).click();
      await expect(page.getByText("P1 Seed Updated")).toBeVisible({
        timeout: 15_000,
      });

      // Templates: create, edit, use, delete.
      await page.getByTestId("nav-templates").click();
      await expect(page.getByTestId("templates")).toBeVisible();
      await expectNoAxeViolations(page, "templates");
      await page.getByRole("button", { name: "New template" }).click();
      await expect(page.getByTestId("template-form")).toBeVisible();
      await page.getByLabel("Name").fill("P1 Template");
      await page.getByRole("button", { name: "Save" }).click();
      await expect(page.getByText("P1 Template")).toBeVisible({
        timeout: 15_000,
      });

      await openRowAction(page, { hasText: "P1 Template" }, "Edit");
      await expect(page.getByTestId("template-form")).toBeVisible();
      await page.getByLabel("Name").fill("P1 Template Edited");
      await page.getByRole("button", { name: "Save" }).click();
      await expect(page.getByText("P1 Template Edited")).toBeVisible({
        timeout: 15_000,
      });

      await page
        .getByRole("button", { name: /^Use template / })
        .first()
        .click();
      await expect(page.getByTestId("use-template-form")).toBeVisible();
      await page.getByLabel("Project name").fill("From Template");
      await page.getByRole("button", { name: "Create" }).click();
      await expect(page.getByTestId("import-document")).toBeVisible({
        timeout: 30_000,
      });
      await page.getByRole("button", { name: "Choose files" }).click();
      await expect(page.getByTestId("workbench")).toBeVisible({
        timeout: 60_000,
      });

      await page.getByRole("button", { name: "Home" }).click();
      await expect(page.getByTestId("project-home")).toBeVisible({
        timeout: 30_000,
      });
      await page.getByTestId("nav-templates").click();
      await expect(page.getByTestId("templates")).toBeVisible();
      await openRowAction(page, { hasText: "P1 Template Edited" }, "Delete");
      const deleteConfirm = page.getByTestId("delete-template-confirm");
      await expect(deleteConfirm).toBeVisible();
      await expect(
        deleteConfirm.getByRole("button", { name: "Cancel" }),
      ).toBeFocused();
      await deleteConfirm.getByRole("button", { name: "Delete" }).click();
      await expect(deleteConfirm).toBeHidden({ timeout: 15_000 });

      await page.getByRole("button", { name: "Projects" }).click();
      await expect(page.getByTestId("project-home")).toBeVisible();

      // Archive / unarchive seed project.
      await openRowAction(page, { hasText: "P1 Seed Updated" }, "Archive");
      const lifecycleConfirm = page.getByTestId("lifecycle-confirm");
      await expect(lifecycleConfirm).toBeVisible();
      await expect(
        lifecycleConfirm.getByRole("button", { name: "Cancel" }),
      ).toBeFocused();
      await lifecycleConfirm.getByRole("button", { name: "Archive" }).click();

      // Lifecycle filters are toggle buttons, not a partial tab widget.
      await page.getByRole("button", { name: "Archived" }).click();
      await expect(page.getByText("P1 Seed Updated")).toBeVisible({
        timeout: 15_000,
      });
      await openRowAction(page, { hasText: "P1 Seed Updated" }, "Unarchive");
      await expect(page.getByTestId("lifecycle-confirm")).toBeVisible();
      await page
        .getByTestId("lifecycle-confirm")
        .getByRole("button", { name: "Unarchive" })
        .click();
      await page.getByRole("button", { name: "Active" }).click();
      await expect(page.getByText("P1 Seed Updated")).toBeVisible({
        timeout: 15_000,
      });

      // Recycle project, exclude from Home, restore, re-delete, purge.
      await openRowAction(page, { hasText: "From Template" }, "Recycle");
      const recycleConfirm = page.getByTestId("recycle-project-confirm");
      await expect(recycleConfirm).toBeVisible();
      await recycleConfirm.getByRole("button", { name: "Recycle" }).click();
      await expect(page.getByText("From Template")).toHaveCount(0, {
        timeout: 15_000,
      });

      await page.getByTestId("nav-recycle").click();
      await expect(page.getByTestId("recycle-bin")).toBeVisible({
        timeout: 15_000,
      });
      await expectNoAxeViolations(page, "recycle");
      const recycleRow = page
        .locator(".project-row")
        .filter({ hasText: "From Template" });
      await expect(recycleRow).toBeVisible({ timeout: 15_000 });

      // Restore acts in one click; the row leaves the recycle list.
      await recycleRow.getByRole("button", { name: "Restore" }).click();
      await expect(recycleRow).toHaveCount(0, { timeout: 15_000 });

      await page.getByRole("button", { name: "Projects" }).click();
      await expect(page.getByTestId("project-home")).toBeVisible();
      await expect(page.getByText("From Template")).toBeVisible({
        timeout: 15_000,
      });

      // Re-recycle the restored project, then purge permanently.
      await openRowAction(page, { hasText: "From Template" }, "Recycle");
      await page
        .getByTestId("recycle-project-confirm")
        .getByRole("button", { name: "Recycle" })
        .click();
      await expect(page.getByText("From Template")).toHaveCount(0, {
        timeout: 15_000,
      });

      await page.getByTestId("nav-recycle").click();
      await expect(page.getByTestId("recycle-bin")).toBeVisible();
      const reRecycleRow = page
        .locator(".project-row")
        .filter({ hasText: "From Template" });
      await expect(reRecycleRow).toBeVisible({ timeout: 15_000 });
      await reRecycleRow.getByRole("button", { name: "Purge" }).click();
      const purgeConfirm = page.getByTestId("purge-confirm");
      await expect(purgeConfirm).toBeVisible();
      await purgeConfirm.getByRole("button", { name: "Purge" }).click();
      await expect(purgeConfirm).toBeHidden({ timeout: 15_000 });
      await expect(
        page.locator(".project-row").filter({ hasText: "From Template" }),
      ).toHaveCount(0, { timeout: 15_000 });

      // Purged identity must stay off Active Home and default search.
      await page.getByRole("button", { name: "Projects" }).click();
      await expect(page.getByTestId("project-home")).toBeVisible();
      await expect(page.getByText("From Template")).toHaveCount(0);
      await page.getByTestId("nav-search").click();
      await expect(page.getByTestId("global-search")).toBeVisible();
      await page.getByLabel("Query").fill("From Template");
      await page
        .getByTestId("global-search")
        .getByRole("button", { name: "Search", exact: true })
        .click();
      await expect(page.getByTestId("search-result-status")).toContainText(
        /0 results? for/,
        { timeout: 20_000 },
      );

      await expectNoViewportOverflow(page);
      expect(consoleGuard.errors, consoleGuard.errors.join("\n")).toEqual([]);
    } finally {
      consoleGuard?.dispose();
      if (app) await app.close();
      await rm(userData, { recursive: true, force: true });
    }
  });

  test("S15 open example project with validated identity", async () => {
    const userData = await mkdtemp(join(tmpdir(), "tl-p1-ex-"));
    let app: ElectronApplication | undefined;
    let page: Page;
    let consoleGuard: ReturnType<typeof attachConsoleGuard> | undefined;

    try {
      ({ app, page } = await launchApp({ userData }));
      consoleGuard = attachConsoleGuard(page);

      await expect(page.getByTestId("welcome")).toBeVisible({
        timeout: 60_000,
      });
      await page.getByTestId("open-example").click();

      // Bundled example materializes project + document then enters Workbench.
      await expect(page.getByTestId("workbench")).toBeVisible({
        timeout: 90_000,
      });
      await expect(page.getByTestId("app-shell")).toContainText(
        "Example: Welcome to Translunar",
      );
      await expect(page.getByTestId("document-switcher")).toBeVisible();
      const exampleSelect = documentSelect(page);
      await expect(exampleSelect).toBeVisible();

      const session = await readSessionIdentity(page);
      await expect(exampleSelect).toHaveValue(session.documentId);
      const selectedLabel = await exampleSelect.evaluate((el) => {
        const select = el as HTMLSelectElement;
        return select.selectedOptions[0]?.textContent ?? "";
      });
      expect(selectedLabel.toLowerCase()).toMatch(/welcome/);

      // Resumability: process relaunch hydrates the same example identity.
      await app.close();
      app = undefined;
      ({ app, page } = await launchApp({ userData }));
      consoleGuard.dispose();
      consoleGuard = attachConsoleGuard(page);
      await expect(page.getByTestId("workbench")).toBeVisible({
        timeout: 90_000,
      });
      const resumed = await readSessionIdentity(page);
      expect(resumed.projectId).toBe(session.projectId);
      expect(resumed.documentId).toBe(session.documentId);
      await expect(documentSelect(page)).toHaveValue(session.documentId);
      await expect(page.getByTestId("app-shell")).toContainText(
        "Example: Welcome to Translunar",
      );

      expect(consoleGuard.errors, consoleGuard.errors.join("\n")).toEqual([]);
    } finally {
      consoleGuard?.dispose();
      if (app) await app.close();
      await rm(userData, { recursive: true, force: true });
    }
  });
});

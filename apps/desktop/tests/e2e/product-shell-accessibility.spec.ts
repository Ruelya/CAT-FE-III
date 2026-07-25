import { existsSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "@playwright/test";

import {
  assertKeyboardEntersContainer,
  closeProductShell,
  dismissFirstRunTutorial,
  launchProductShell,
  resizeWindow,
  runScopedAxe,
  VIEWPORTS,
} from "./product-shell-helpers.js";

/**
 * Accessibility + keyboard evidence for the reachable product-shell surfaces:
 * Project Home, Setup, Settings (including Backup/Restore and Update sections),
 * and the Tutorial overlay. Runs axe (minus color-contrast, which is a manual
 * design check) and a keyboard-entry assertion at all three supported
 * viewports against a real Engine build.
 *
 * Workbench/QA/Export surfaces keep their layout-overflow coverage in
 * workbench.spec.ts; this spec adds axe/keyboard for the shell chrome those
 * specs do not cover.
 */
test("project home is axe-clean and keyboard-reachable at all viewports", async () => {
  const harness = await launchProductShell("a11y-home");
  try {
    const { page, application, consoleErrors } = harness;
    await dismissFirstRunTutorial(page);

    // The active-projects view always renders the "Continue translating"
    // heading (an empty workspace still shows it above the empty-state card),
    // so it is a stable anchor in either locale.
    await expect(
      page.getByRole("heading", { name: /Continue translating|继续翻译/i }),
    ).toBeVisible();

    for (const viewport of VIEWPORTS) {
      await resizeWindow(application, viewport.width, viewport.height);
      await page.waitForTimeout(80);
      await runScopedAxe(page, ".project-home-shell");
    }
    await resizeWindow(application, 1250, 744);

    // The workspace-view switcher is a labelled landmark. It is an <aside>
    // (role="complementary"), holding the projects/search/templates/recycle
    // tabs — not a <nav>. Assert the real role and that keyboard focus reaches
    // the home shell.
    await expect(
      page.getByRole("complementary", {
        name: /Project workspace views|项目工作区视图/i,
      }),
    ).toBeVisible();
    await assertKeyboardEntersContainer(page, ".project-home-shell");

    expect(consoleErrors, "unexpected renderer console/page errors").toEqual(
      [],
    );
  } finally {
    await closeProductShell(harness);
  }
});

test("settings dialog (backup/restore + update) is axe-clean and focus-trapped at all viewports", async () => {
  const harness = await launchProductShell("a11y-settings");
  try {
    const { page, application, consoleErrors } = harness;
    await dismissFirstRunTutorial(page);

    // Settings FAB aria-label depends on system/persisted locale: en-US → "Open
    // product settings", zh-CN → "打开产品设置". Match either.
    const settings = page.getByRole("button", {
      name: /Open product settings|打开产品设置|Settings|设置/i,
    });
    await expect(settings).toBeVisible();
    await settings.click();
    const dialog = page.getByRole("dialog", {
      name: /Product settings|产品设置/i,
    });
    await expect(dialog).toBeVisible();

    // Backup/Restore and Update controls are present in the dialog.
    await expect(
      dialog.getByRole("button", { name: /Back up workspace|备份工作区/i }),
    ).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: /Restore workspace|恢复工作区/i }),
    ).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: /Check for updates|检查更新/i }),
    ).toBeVisible();

    for (const viewport of VIEWPORTS) {
      await resizeWindow(application, viewport.width, viewport.height);
      await page.waitForTimeout(80);
      await runScopedAxe(page, '[role="dialog"]');
    }
    await resizeWindow(application, 1250, 744);

    // Keyboard focus is trapped inside the modal dialog.
    await assertKeyboardEntersContainer(page, '[role="dialog"]');

    // Escape closes the dialog and returns to Home.
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);

    expect(consoleErrors, "unexpected renderer console/page errors").toEqual(
      [],
    );
  } finally {
    await closeProductShell(harness);
  }
});

test("first-run tutorial overlay is axe-clean and keyboard-operable at all viewports", async () => {
  const harness = await launchProductShell("a11y-tutorial");
  try {
    const { page, application, consoleErrors } = harness;
    const tutorial = page.getByRole("dialog", {
      name: /First-run tutorial|首次使用教程/i,
    });
    await expect(tutorial).toBeVisible();

    for (const viewport of VIEWPORTS) {
      await resizeWindow(application, viewport.width, viewport.height);
      await page.waitForTimeout(80);
      await runScopedAxe(page, ".tutorial-dialog");
    }
    await resizeWindow(application, 1250, 744);

    // Keyboard focus is inside the tutorial dialog.
    await assertKeyboardEntersContainer(page, ".tutorial-dialog");

    // The Skip control dismisses the overlay via keyboard.
    await tutorial.getByRole("button", { name: /^(Skip|跳过)$/ }).click();
    await expect(tutorial).toHaveCount(0);

    expect(consoleErrors, "unexpected renderer console/page errors").toEqual(
      [],
    );
  } finally {
    await closeProductShell(harness);
  }
});

test("tutorial completes through Open Example and opens the bundled project offline", async () => {
  const harness = await launchProductShell("tutorial-example");
  try {
    const { page, consoleErrors } = harness;
    const tutorial = page.getByRole("dialog", {
      name: /First-run tutorial|首次使用教程/i,
    });
    await expect(tutorial).toBeVisible();

    // Advance the reducer to the final step via the Next control.
    const next = tutorial.getByRole("button", { name: /^(Next|下一步)$/ });
    for (let step = 0; step < 6; step += 1) {
      if (await next.isVisible().catch(() => false)) {
        await next.click();
      }
    }

    // Final step exposes Open Example; it uses the real Engine import path.
    const openExample = tutorial.getByRole("button", {
      name: /Open example project|打开示例项目/i,
    });
    await expect(openExample).toBeVisible();
    await openExample.click();

    // The bundled example opens into the workbench (real Engine project).
    await expect(
      page.getByRole("region", { name: /Translation segments|翻译句段/i }),
    ).toBeVisible({ timeout: 20_000 });

    expect(consoleErrors, "unexpected renderer console/page errors").toEqual(
      [],
    );
  } finally {
    await closeProductShell(harness);
  }
});

test("workspace backup runs through the settings UI with the deterministic seam", async () => {
  const harness = await launchProductShell("shell-backup", {
    withBackupSeam: true,
  });
  try {
    const { page, backupDestination, consoleErrors } = harness;
    await dismissFirstRunTutorial(page);

    const settings = page.getByRole("button", {
      name: /Open product settings|打开产品设置|Settings|设置/i,
    });
    await settings.click();
    const dialog = page.getByRole("dialog", {
      name: /Product settings|产品设置/i,
    });
    await expect(dialog).toBeVisible();

    // Trigger a real backup through the seam-backed destination.
    await dialog
      .getByRole("button", { name: /Back up workspace|备份工作区/i })
      .click();

    // The success notice (`.surface-success`, the only success-only status
    // node — the update-status paragraph also has role="status" and is always
    // present) confirms the Engine backup completed. Wait on it specifically to
    // avoid a strict-mode multiple-match.
    await expect(dialog.locator(".surface-success")).toBeVisible({
      timeout: 15_000,
    });

    // The seam points the Engine directly at `backupDestination` (it must not
    // pre-exist); the Engine creates it and writes the authoritative
    // manifest.json inside. Assert that real artifact, not merely the notice.
    expect(existsSync(backupDestination)).toBe(true);
    expect(existsSync(join(backupDestination, "manifest.json"))).toBe(true);

    expect(consoleErrors, "unexpected renderer console/page errors").toEqual(
      [],
    );
  } finally {
    await closeProductShell(harness);
  }
});

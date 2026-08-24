import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { test, expect, type Page, type ConsoleMessage } from "@playwright/test";
import { _electron as electron, type ElectronApplication } from "playwright";

import {
  expectNoAxeViolations,
  waitForAnimations,
} from "./helpers/ui-checks.js";

const require = createRequire(import.meta.url);
const electronExecutable = require("electron") as string;
const desktopRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const sourceFixture = join(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures/single-segment-source.txt",
);

async function launchApp(userData: string): Promise<{
  app: ElectronApplication;
  page: Page;
}> {
  const env: { [key: string]: string } = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") env[key] = value;
  }
  env.TRANSLUNAR_TEST_USER_DATA = userData;
  env.TRANSLUNAR_DATA_DIR = join(userData, "engine-data");
  env.TRANSLUNAR_TEST_SOURCE = sourceFixture;
  env.TRANSLUNAR_TEST_SOURCE_FILES = sourceFixture;

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
    win?.setContentSize(1680, 942);
  });
  return { app, page };
}

function attachConsoleGuard(page: Page): {
  errors: string[];
  dispose: () => void;
} {
  const errors: string[] = [];
  const onConsole = (msg: ConsoleMessage) => {
    if (msg.type() === "error") errors.push(msg.text());
  };
  const onPageError = (err: Error) => errors.push(err.message);
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

/** Accessible name of whatever currently holds focus. */
async function focusedName(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el) return "none";
    return (
      el.getAttribute("aria-label") ??
      el.getAttribute("title") ??
      (el.textContent ?? "").trim().slice(0, 40) ??
      el.tagName
    );
  });
}

async function createOpenProject(page: Page, name: string): Promise<void> {
  await expect(page.getByTestId("welcome")).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: "Create project" }).click();
  await page.getByLabel("Name").fill(name);
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByTestId("import-document")).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole("button", { name: "Choose files" }).click();
  await expect(page.getByTestId("workbench")).toBeVisible({ timeout: 60_000 });
}

test.describe("accessibility and keyboard", () => {
  test("every reachable surface passes axe at every impact level", async () => {
    const userData = await mkdtemp(join(tmpdir(), "tl-a11y-"));
    let app: ElectronApplication | undefined;
    let guard: ReturnType<typeof attachConsoleGuard> | undefined;

    try {
      const launched = await launchApp(userData);
      app = launched.app;
      const { page } = launched;
      guard = attachConsoleGuard(page);

      await expect(page.getByTestId("welcome")).toBeVisible({
        timeout: 60_000,
      });
      await expectNoAxeViolations(page, "welcome");

      await page.getByRole("button", { name: "Create project" }).click();
      await expect(page.getByTestId("create-project")).toBeVisible();
      await expectNoAxeViolations(page, "create-project");

      // Submitting an empty form must not produce an inaccessible error state.
      await page.getByRole("button", { name: "Create" }).click();
      await expect(page.getByLabel("Name")).toHaveAttribute(
        "aria-invalid",
        "true",
      );
      await expect(page.getByLabel("Name")).toBeFocused();
      await expectNoAxeViolations(page, "create-project-invalid");

      await page.getByLabel("Name").fill("A11y Project");
      await page.getByRole("button", { name: "Create" }).click();
      await expect(page.getByTestId("import-document")).toBeVisible({
        timeout: 30_000,
      });
      await expectNoAxeViolations(page, "import-document");

      await page.getByRole("button", { name: "Choose files" }).click();
      await expect(page.getByTestId("workbench")).toBeVisible({
        timeout: 60_000,
      });
      await expectNoAxeViolations(page, "workbench");

      // The overflow menu is a separate rendered state and needs its own audit.
      await page.getByTestId("cmd-overflow").click();
      await expect(page.getByTestId("cmd-overflow-menu")).toBeVisible();
      await expectNoAxeViolations(page, "workbench-overflow-menu");
      await page.keyboard.press("Escape");

      await page.getByTestId("nav-search").click();
      await expect(page.getByTestId("global-search")).toBeVisible();
      await expectNoAxeViolations(page, "search");

      await page.getByTestId("nav-ai-control").click();
      await expect(page.getByTestId("ai-control")).toBeVisible();
      await expectNoAxeViolations(page, "ai-control");

      await page.getByTestId("nav-plugins").click();
      await expect(page.getByTestId("plugins")).toBeVisible();
      await expectNoAxeViolations(page, "plugins");

      await page.getByTestId("nav-settings").click();
      await expect(page.getByTestId("product-settings")).toBeVisible();
      await expectNoAxeViolations(page, "settings-locale");
      await page.getByTestId("settings-tab-appearance").click();
      await expectNoAxeViolations(page, "settings-appearance");

      // The command palette is a modal surface of its own.
      await page.keyboard.press("Control+k");
      await expect(page.getByTestId("command-palette")).toBeVisible();
      await expectNoAxeViolations(page, "command-palette");
      await page.keyboard.press("Escape");

      expect(guard.errors, guard.errors.join("\n")).toEqual([]);
    } finally {
      guard?.dispose();
      if (app) await app.close().catch(() => undefined);
      await rm(userData, { recursive: true, force: true }).catch(
        () => undefined,
      );
    }
  });

  test("every section of every multi-section surface passes axe", async () => {
    // Thirty axe runs in one session; the default 60s budget is for a single
    // interaction path, not a sweep.
    test.setTimeout(240_000);
    /*
     * Auditing only the default section of a surface hides everything behind
     * the other tabs. A runtime probe found two selects with no accessible
     * name at all, on the Plugins permissions section and the Collaboration
     * members section, neither of which the surface-level audit ever reached.
     */
    const userData = await mkdtemp(join(tmpdir(), "tl-a11y-sections-"));
    let app: ElectronApplication | undefined;
    let guard: ReturnType<typeof attachConsoleGuard> | undefined;

    try {
      const launched = await launchApp(userData);
      app = launched.app;
      const { page } = launched;
      guard = attachConsoleGuard(page);

      await createOpenProject(page, "Sections Project");

      const surfaces: Array<{
        nav: string;
        root: string;
        sections: string[];
      }> = [
        {
          nav: "nav-insights",
          root: "project-insights",
          sections: [
            "insights-section-analytics",
            "insights-section-interop",
            "insights-section-task",
          ],
        },
        {
          nav: "nav-assets",
          root: "asset-hub",
          sections: [
            "assets-tab-tm",
            "assets-tab-termbase",
            "assets-tab-alignment",
            "assets-tab-corpus",
            "assets-tab-catalog",
            "assets-tab-curation",
          ],
        },
        {
          nav: "nav-ai-control",
          root: "ai-control",
          sections: [
            "ai-tab-providers",
            "ai-tab-usage",
            "ai-tab-interactive",
            "ai-tab-batch",
            "ai-tab-quality",
            // interactive is availability-gated and may not render.
          ],
        },
        {
          nav: "nav-plugins",
          root: "plugins",
          sections: [
            "plugins-tab-installed",
            "plugins-tab-bundled",
            "plugins-tab-permissions",
            "plugins-tab-aiActions",
            "plugins-tab-uiPanels",
            "plugins-tab-connectors",
          ],
        },
        {
          nav: "nav-collaboration",
          root: "collaboration",
          sections: [
            "collab-tab-members",
            "collab-tab-locks",
            "collab-tab-presence",
            "collab-tab-assignments",
            "collab-tab-opLog",
          ],
        },
        {
          nav: "nav-settings",
          root: "product-settings",
          sections: [
            "settings-tab-locale",
            "settings-tab-appearance",
            "settings-tab-data",
            "settings-tab-updates",
            "settings-tab-ocr",
            "settings-tab-tutorial",
          ],
        },
      ];

      const audited: string[] = [];
      for (const surface of surfaces) {
        const nav = page.getByTestId(surface.nav);
        // Session-scoped destinations are only offered from a session surface,
        // so return to the Workbench before each hop rather than assuming the
        // previous surface still exposes the next one.
        if (!(await nav.isVisible().catch(() => false))) {
          await page.keyboard.press("Control+k");
          await page.getByTestId("command-palette-input").fill("workbench");
          await page.keyboard.press("Enter");
          await expect(page.getByTestId("workbench")).toBeVisible({
            timeout: 30_000,
          });
        }
        if (!(await nav.isVisible().catch(() => false))) {
          throw new Error(`destination ${surface.nav} is unreachable`);
        }
        await nav.click();
        await expect(page.getByTestId(surface.root)).toBeVisible({
          timeout: 30_000,
        });
        for (const section of surface.sections) {
          const tab = page.getByTestId(section);
          if (!(await tab.isVisible().catch(() => false))) continue;
          await tab.click();
          await expectNoAxeViolations(page, `${surface.root}/${section}`);
          audited.push(`${surface.root}/${section}`);
        }
      }

      // A sweep that silently reaches nothing would pass vacuously. These two
      // sections in particular are where the unnamed selects were found.
      expect(audited).toContain("plugins/plugins-tab-permissions");
      expect(audited).toContain("collaboration/collab-tab-members");
      for (const surface of surfaces) {
        expect(
          audited.some((entry) => entry.startsWith(`${surface.root}/`)),
          `${surface.root} contributed no audited section`,
        ).toBe(true);
      }
      expect(audited.length, audited.join(", ")).toBeGreaterThanOrEqual(28);

      expect(guard.errors, guard.errors.join("\n")).toEqual([]);
    } finally {
      guard?.dispose();
      if (app) await app.close().catch(() => undefined);
      await rm(userData, { recursive: true, force: true }).catch(
        () => undefined,
      );
    }
  });

  test("dark theme passes axe on the surfaces a user lives in", async () => {
    const userData = await mkdtemp(join(tmpdir(), "tl-a11y-dark-"));
    let app: ElectronApplication | undefined;

    try {
      const launched = await launchApp(userData);
      app = launched.app;
      const { page } = launched;

      await expect(page.getByTestId("welcome")).toBeVisible({
        timeout: 60_000,
      });
      await page.evaluate(() => {
        window.localStorage.setItem(
          "translunar.renderer.appearance.v1",
          JSON.stringify({
            version: 1,
            theme: "dark",
            accentSeed: "#e0a458",
          }),
        );
      });
      await page.reload();
      await expect(page.getByTestId("welcome")).toBeVisible({
        timeout: 60_000,
      });
      await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
      await expectNoAxeViolations(page, "dark-welcome");

      await createOpenProject(page, "Dark Project");
      await expectNoAxeViolations(page, "dark-workbench");

      await page.getByTestId("workbench-qa").click();
      await expect(page.getByTestId("qa-review")).toBeVisible();
      await expectNoAxeViolations(page, "dark-qa");
    } finally {
      if (app) await app.close().catch(() => undefined);
      await rm(userData, { recursive: true, force: true }).catch(
        () => undefined,
      );
    }
  });

  test("keyboard alone reaches the workbench and drives the editor", async () => {
    const userData = await mkdtemp(join(tmpdir(), "tl-a11y-kbd-"));
    let app: ElectronApplication | undefined;
    let guard: ReturnType<typeof attachConsoleGuard> | undefined;

    try {
      const launched = await launchApp(userData);
      app = launched.app;
      const { page } = launched;
      guard = attachConsoleGuard(page);

      await createOpenProject(page, "Keyboard Project");

      // The command palette is the keyboard entry point to every destination.
      await page.keyboard.press("Control+k");
      await expect(page.getByTestId("command-palette")).toBeVisible();
      await expect(page.getByTestId("command-palette-input")).toBeFocused();

      await page.getByTestId("command-palette-input").fill("qa");
      await page.keyboard.press("Enter");
      await expect(page.getByTestId("qa-review")).toBeVisible({
        timeout: 30_000,
      });

      // And back, without touching the pointer.
      await page.keyboard.press("Control+k");
      await page.getByTestId("command-palette-input").fill("workbench");
      await page.keyboard.press("Enter");
      await expect(page.getByTestId("workbench")).toBeVisible({
        timeout: 30_000,
      });

      // The editor toolbar is one tab stop with arrow navigation inside it.
      await page.getByTestId("cmd-editor.findReplace").focus();
      await page.keyboard.press("ArrowRight");
      expect(await focusedName(page)).toContain("Tags");
      await page.keyboard.press("Home");
      expect(await focusedName(page)).toContain("Find");

      // The overflow menu moves focus in and returns it on Escape.
      await page.getByTestId("cmd-overflow").focus();
      await page.keyboard.press("ArrowDown");
      const firstItem = await focusedName(page);
      expect(firstItem.length).toBeGreaterThan(0);
      await page.keyboard.press("Escape");
      expect(await focusedName(page)).toContain("More");

      // Opening and closing an editor panel returns focus to its opener.
      await page.getByTestId("cmd-editor.findReplace").click();
      await expect(page.getByTestId("panel-find-replace")).toBeVisible();
      await page.getByRole("button", { name: "Close Find" }).click();
      await expect(page.getByTestId("panel-find-replace")).toBeHidden();
      expect(await focusedName(page)).toContain("Find");

      // Ctrl+Enter confirms the active segment from the editor.
      const editor = page.locator('[data-testid^="target-editor-"]').first();
      await editor.click();
      await editor.fill("键盘可达性验证。");
      await page.keyboard.press("Control+Enter");
      await expect(page.locator(".status-chip--confirmed")).toHaveCount(1, {
        timeout: 30_000,
      });

      expect(guard.errors, guard.errors.join("\n")).toEqual([]);
    } finally {
      guard?.dispose();
      if (app) await app.close().catch(() => undefined);
      await rm(userData, { recursive: true, force: true }).catch(
        () => undefined,
      );
    }
  });

  test("a row overflow menu is fully visible and paints above later content", async () => {
    // Regression: the project list used overflow hidden to round its corners,
    // which cut the menu off after the second item, and the row entrance
    // animation left a stacking context that let the pagination row paint over
    // what was left. A walkthrough found it; a viewport-only geometry check
    // could not, because a clipped element still reports its full box.
    const userData = await mkdtemp(join(tmpdir(), "tl-menu-"));
    let app: ElectronApplication | undefined;

    try {
      const launched = await launchApp(userData);
      app = launched.app;
      const { page } = launched;

      await createOpenProject(page, "Menu Project");
      await page.getByRole("button", { name: "Home", exact: true }).click();
      await expect(page.getByTestId("project-home")).toBeVisible({
        timeout: 30_000,
      });

      await page
        .getByRole("button", { name: /^More actions for / })
        .first()
        .click();
      const menu = page.getByRole("menu");
      await expect(menu).toBeVisible();

      // Every item the surface offers must actually be reachable.
      const labels = await menu.getByRole("menuitem").allInnerTexts();
      expect(labels.map((l) => l.trim())).toEqual([
        "Edit",
        "Archive",
        "Insights",
        "Assets",
        "Recycle",
      ]);

      const report = await page.evaluate(() => {
        const node = document.querySelector('[role="menu"]');
        if (!node) return null;
        const rect = node.getBoundingClientRect();

        // No ancestor may clip the menu box.
        let clippedBy: string | null = null;
        let parent = node.parentElement;
        while (parent && parent !== document.body) {
          const style = getComputedStyle(parent);
          if (style.overflow !== "visible" || style.overflowY !== "visible") {
            const box = parent.getBoundingClientRect();
            if (rect.bottom - box.bottom > 2 || rect.right - box.right > 2) {
              clippedBy = parent.className || parent.tagName;
              break;
            }
          }
          parent = parent.parentElement;
        }

        // The menu must be what a click actually lands on.
        const topAtItems = document.elementFromPoint(
          rect.left + 40,
          rect.top + 42,
        );
        return {
          clippedBy,
          topAtItems: topAtItems
            ? `${topAtItems.tagName}.${String(topAtItems.className)}`
            : "none",
        };
      });

      expect(report?.clippedBy, "menu is clipped by an ancestor").toBeNull();
      expect(report?.topAtItems).toContain("menu__item");
    } finally {
      if (app) await app.close().catch(() => undefined);
      await rm(userData, { recursive: true, force: true }).catch(
        () => undefined,
      );
    }
  });

  test("a destructive confirmation shows which button Enter will activate", async () => {
    // Regression: focus moved to Cancel programmatically, but because the
    // dialog was opened with the pointer, :focus-visible suppressed the ring
    // and a tester could not tell which button was armed on a destructive
    // confirmation.
    const userData = await mkdtemp(join(tmpdir(), "tl-confirm-"));
    let app: ElectronApplication | undefined;

    try {
      const launched = await launchApp(userData);
      app = launched.app;
      const { page } = launched;

      await createOpenProject(page, "Confirm Project");
      await page.getByRole("button", { name: "Home", exact: true }).click();
      await expect(page.getByTestId("project-home")).toBeVisible({
        timeout: 30_000,
      });

      await page
        .getByRole("button", { name: /^More actions for / })
        .first()
        .click();
      await page.getByRole("menuitem", { name: "Recycle" }).click();

      const dialog = page.getByTestId("recycle-project-confirm");
      await expect(dialog).toBeVisible();

      const cancel = dialog.getByRole("button", { name: "Cancel" });
      await expect(cancel).toBeFocused();

      const ring = await cancel.evaluate((node) => {
        const style = getComputedStyle(node);
        return {
          style: style.outlineStyle,
          width: Number.parseFloat(style.outlineWidth),
          color: style.outlineColor,
        };
      });
      expect(ring.style).not.toBe("none");
      expect(ring.width).toBeGreaterThanOrEqual(2);

      // Escape must remain non-destructive.
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
      await expect(page.getByTestId("project-home")).toBeVisible();
    } finally {
      if (app) await app.close().catch(() => undefined);
      await rm(userData, { recursive: true, force: true }).catch(
        () => undefined,
      );
    }
  });

  test("reduced motion collapses every transition to zero", async () => {
    const userData = await mkdtemp(join(tmpdir(), "tl-a11y-motion-"));
    let app: ElectronApplication | undefined;

    try {
      const launched = await launchApp(userData);
      app = launched.app;
      const { page } = launched;
      await page.emulateMedia({ reducedMotion: "reduce" });

      await createOpenProject(page, "Motion Project");
      await waitForAnimations(page);

      const durations = await page.evaluate(() => {
        const nodes = Array.from(
          document.querySelectorAll(
            ".btn, .app-chrome, .segment-row, .tm-panel",
          ),
        );
        return Array.from(
          new Set(
            nodes.map((node) => getComputedStyle(node).transitionDuration),
          ),
        );
      });
      // Motion tokens go to 0ms and the reduce block forces 0s, so nothing
      // may report a running transition duration.
      for (const duration of durations) {
        expect(
          duration.replace(/[\d.]+s/g, (v) =>
            Number.parseFloat(v) === 0 ? "0s" : v,
          ),
        ).toBe("0s");
      }
    } finally {
      if (app) await app.close().catch(() => undefined);
      await rm(userData, { recursive: true, force: true }).catch(
        () => undefined,
      );
    }
  });
});

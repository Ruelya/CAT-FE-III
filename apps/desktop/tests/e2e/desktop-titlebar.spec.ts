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

test.describe("desktop custom title bar chrome", () => {
  test("title strip is reachable with platform-gated window controls", async () => {
    const userData = await mkdtemp(join(tmpdir(), "translunar-titlebar-"));
    let app: ElectronApplication | undefined;
    let guard: { errors: string[]; dispose: () => void } | undefined;

    try {
      const launched = await launchApp(userData);
      app = launched.app;
      const { page } = launched;
      guard = attachConsoleGuard(page);

      const shell = page.getByTestId("app-shell");
      await expect(shell).toBeVisible({ timeout: 60_000 });

      const platform = await page.evaluate(() =>
        window.translunar.getWindowChromePlatform(),
      );
      expect(platform === "macos" || platform === "custom").toBe(true);

      const dataChrome = await shell.getAttribute("data-window-chrome");
      expect(dataChrome).toBe(platform);

      if (platform === "custom") {
        await expect(page.getByTestId("window-controls")).toBeVisible();
        await expect(
          page.getByRole("button", { name: "Minimize" }),
        ).toBeVisible();
        const maximize = page.getByRole("button", { name: "Maximize" });
        await expect(maximize).toBeVisible();
        await expect(page.getByRole("button", { name: "Close" })).toBeVisible();

        // Maximize then restore via the same control; do not click Close.
        await maximize.click();
        await expect(
          page.getByRole("button", { name: "Restore" }),
        ).toBeVisible({ timeout: 10_000 });
        await expect(page.getByTestId("window-controls")).toHaveAttribute(
          "data-maximized",
          "true",
        );

        await page.getByRole("button", { name: "Restore" }).click();
        await expect(
          page.getByRole("button", { name: "Maximize" }),
        ).toBeVisible({ timeout: 10_000 });
        await expect(page.getByTestId("window-controls")).toHaveAttribute(
          "data-maximized",
          "false",
        );
      } else {
        // macOS: native traffic lights only — no duplicate custom controls.
        await expect(page.getByTestId("window-controls")).toHaveCount(0);
        await expect(
          page.getByRole("button", { name: "Minimize" }),
        ).toHaveCount(0);
      }

      // Drag / no-drag contract on the title strip.
      const regions = await page.evaluate(() => {
        const header = document.querySelector(".app-chrome");
        const actions = document.querySelector(".app-chrome__actions");
        if (!header || !actions) return null;
        const headerStyle = getComputedStyle(header);
        const actionsStyle = getComputedStyle(actions);
        return {
          headerDrag: headerStyle.getPropertyValue("-webkit-app-region"),
          actionsDrag: actionsStyle.getPropertyValue("-webkit-app-region"),
        };
      });
      expect(regions).not.toBeNull();
      expect(regions?.headerDrag).toBe("drag");
      expect(regions?.actionsDrag).toBe("no-drag");

      expect(guard.errors, `console/page errors: ${guard.errors.join("\n")}`).toEqual(
        [],
      );
    } finally {
      guard?.dispose();
      if (app) await app.close();
      await rm(userData, { recursive: true, force: true });
    }
  });
});

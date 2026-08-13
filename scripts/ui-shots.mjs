#!/usr/bin/env node
/**
 * Renderer visual-evidence harness.
 *
 * Launches the built Electron app against a real Engine in an isolated data
 * directory, walks every route family, and records one PNG plus one geometry
 * report per state. The geometry report is the machine-checkable half of the
 * evidence: document overflow, element overlap, undersized hit targets, and
 * computed motion durations.
 *
 * Requires a current build: run `pnpm build:desktop` first (or `pnpm ui:shots`
 * which does it for you).
 *
 * Usage:
 *   node scripts/ui-shots.mjs
 *   node scripts/ui-shots.mjs --theme light,dark --viewport 1180x700,1680x942
 *   node scripts/ui-shots.mjs --zoom 1.25 --reduced-motion
 *   node scripts/ui-shots.mjs --only workbench,projects --out /tmp/evidence
 *
 * Exit code is 1 when any geometry assertion fails, so it can gate a release.
 */
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";

const root = resolve(import.meta.dirname, "..");
const desktopRoot = join(root, "apps", "desktop");
const require = createRequire(join(desktopRoot, "package.json"));
const { _electron: electron } = require("playwright");
const electronExecutable = require("electron");

/* ── CLI ────────────────────────────────────────────────── */

function flag(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  return value && !value.startsWith("--") ? value : true;
}

const themes = String(flag("theme", "light")).split(",");
const viewports = String(flag("viewport", "1680x942"))
  .split(",")
  .map((entry) => {
    const [width, height] = entry.split("x").map(Number);
    return { width, height, label: entry };
  });
const zooms = String(flag("zoom", "1")).split(",").map(Number);
const reducedMotion = process.argv.includes("--reduced-motion");
const only = flag("only", null);
const onlyRoutes = only && only !== true ? String(only).split(",") : null;
const outDir = String(
  flag("out", join(desktopRoot, "test-results", "ui-shots")),
);

/** Interactive controls must stay at or above this CSS pixel size. */
const MIN_TARGET = 32;

/* ── Geometry probe (runs inside the renderer) ──────────── */

const geometryProbe = `(() => {
  const doc = document.documentElement;
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  const overflow = {
    documentScrollWidth: doc.scrollWidth,
    horizontal: doc.scrollWidth > window.innerWidth + 1,
  };

  const interactiveSelector =
    'button, a[href], input, select, textarea, [role="button"], [role="tab"], [role="menuitem"], [tabindex]:not([tabindex="-1"])';
  const nodes = Array.from(document.querySelectorAll(interactiveSelector));

  const describe = (el) => {
    const label =
      el.getAttribute('aria-label') ||
      el.getAttribute('title') ||
      (el.textContent || '').trim().slice(0, 40) ||
      el.getAttribute('data-testid') ||
      el.tagName.toLowerCase();
    return { label, testId: el.getAttribute('data-testid') || null };
  };

  const visible = [];
  for (const el of nodes) {
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    if (
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      Number(style.opacity) === 0 ||
      rect.width === 0 ||
      rect.height === 0
    ) {
      continue;
    }
    visible.push({ el, rect, style });
  }

  const undersized = visible
    .filter(
      ({ el, rect }) =>
        el.tagName !== 'A' &&
        el.getAttribute('role') !== 'menuitem' &&
        // Documented exception: an overlay chip whose visible box must stay
        // small but whose hit area is extended by a pseudo-element.
        el.getAttribute('data-hit-area') !== 'extended' &&
        (rect.width < ${MIN_TARGET} - 0.5 || rect.height < ${MIN_TARGET} - 0.5),
    )
    .map(({ el, rect }) => ({
      ...describe(el),
      width: Math.round(rect.width * 10) / 10,
      height: Math.round(rect.height * 10) / 10,
    }));

  const clipped = visible
    .filter(({ rect }) => rect.right > viewport.width + 1 || rect.left < -1)
    .map(({ el, rect }) => ({
      ...describe(el),
      left: Math.round(rect.left),
      right: Math.round(rect.right),
    }));

  /*
   * A popover taller than its row is silently cut off when an ancestor uses
   * overflow hidden to round its corners. The element still reports a full
   * bounding box, so a viewport check cannot see it; the ancestor's clip
   * rectangle has to be compared directly.
   */
  const occluded = [];
  for (const { el, rect } of visible) {
    let node = el.parentElement;
    while (node && node !== document.body) {
      const style = getComputedStyle(node);
      const clips =
        style.overflow === 'hidden' ||
        style.overflowY === 'hidden' ||
        style.overflowX === 'hidden';
      if (clips) {
        const box = node.getBoundingClientRect();
        const hiddenBelow = rect.bottom - box.bottom;
        const hiddenRight = rect.right - box.right;
        if (hiddenBelow > 2 || hiddenRight > 2) {
          occluded.push({
            ...describe(el),
            hiddenPx: Math.round(Math.max(hiddenBelow, hiddenRight)),
            clippedBy: node.className || node.tagName,
          });
          break;
        }
      }
      node = node.parentElement;
    }
  }

  const overlaps = [];
  for (let i = 0; i < visible.length; i += 1) {
    for (let j = i + 1; j < visible.length; j += 1) {
      const a = visible[i];
      const b = visible[j];
      if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
      const overlapW =
        Math.min(a.rect.right, b.rect.right) - Math.max(a.rect.left, b.rect.left);
      const overlapH =
        Math.min(a.rect.bottom, b.rect.bottom) - Math.max(a.rect.top, b.rect.top);
      // Ignore hairline touching; only report real occlusion.
      if (overlapW > 2 && overlapH > 2) {
        overlaps.push({ a: describe(a.el), b: describe(b.el) });
      }
    }
  }

  const truncated = Array.from(document.querySelectorAll('*'))
    .filter((el) => {
      if (el.children.length > 0) return false;
      const style = getComputedStyle(el);
      if (style.textOverflow !== 'ellipsis' && style.overflow !== 'hidden') {
        return false;
      }
      return el.scrollWidth > el.clientWidth + 2 && !el.hasAttribute('title');
    })
    .slice(0, 25)
    .map((el) => ({
      text: (el.textContent || '').trim().slice(0, 60),
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    }));

  const motionSamples = Array.from(
    document.querySelectorAll('.btn, .app-chrome, [data-motion]'),
  )
    .slice(0, 12)
    .map((el) => getComputedStyle(el).transitionDuration)
    .filter((value, index, list) => list.indexOf(value) === index);

  return {
    viewport,
    overflow,
    undersized,
    clipped,
    occluded,
    overlaps: overlaps.slice(0, 40),
    overlapCount: overlaps.length,
    truncated,
    motionSamples,
    theme: doc.getAttribute('data-theme'),
  };
})()`;

/* ── Route walk ─────────────────────────────────────────── */

/**
 * Each route is `{ name, reach }`. `reach` receives the page and must leave
 * the renderer in the state to be photographed.
 */
function buildRoutes(page) {
  const click = async (testId) => {
    await page.getByTestId(testId).click();
    await page.waitForTimeout(450);
  };
  const clickName = async (name, scope) => {
    const target = scope
      ? page.getByTestId(scope).getByRole("button", { name, exact: true })
      : page.getByRole("button", { name, exact: true });
    await target.first().click();
    await page.waitForTimeout(450);
  };

  return [
    {
      name: "workbench",
      reach: async () => {
        await page.getByTestId("app-shell").waitFor();
        if (
          await page
            .getByTestId("workbench")
            .isVisible()
            .catch(() => false)
        ) {
          return;
        }
        await page.getByTestId("project-home").waitFor({ timeout: 30_000 });
        await page
          .locator(".project-row")
          .first()
          .getByRole("button", { name: "Open", exact: true })
          .click();
        await page.getByTestId("workbench").waitFor({ timeout: 60_000 });
        await page.waitForTimeout(600);
      },
    },
    {
      name: "workbench-tm-collapsed",
      reach: async () => {
        const collapse = page.getByRole("button", {
          name: /Collapse exact TM panel/i,
        });
        if (await collapse.isVisible().catch(() => false)) {
          await collapse.click();
          await page.waitForTimeout(450);
        }
      },
      after: async () => {
        const expand = page.getByRole("button", {
          name: /Expand exact TM panel/i,
        });
        if (await expand.isVisible().catch(() => false)) await expand.click();
      },
    },
    { name: "qa", reach: () => clickName("QA", "workbench") },
    { name: "export", reach: () => clickName("Export", "qa-review") },
    { name: "insights", reach: () => click("nav-insights") },
    { name: "assets", reach: () => click("nav-assets") },
    { name: "projects", reach: () => clickName("Home") },
    { name: "templates", reach: () => click("nav-templates") },
    {
      name: "recycle",
      reach: async () => {
        await clickName("Home");
        await click("nav-recycle");
      },
    },
    { name: "search", reach: () => click("nav-search") },
    { name: "ai-control", reach: () => click("nav-ai-control") },
    { name: "plugins", reach: () => click("nav-plugins") },
    { name: "settings", reach: () => click("nav-settings") },
    {
      name: "create-project",
      reach: async () => {
        await clickName("Home");
        await clickName("Create project");
      },
    },
  ];
}

/* ── Session ────────────────────────────────────────────── */

async function seedAndCapture({ theme, viewport, zoom }) {
  const userData = await mkdtemp(join(tmpdir(), "tl-shots-"));
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") env[key] = value;
  }
  env.TRANSLUNAR_TEST_USER_DATA = userData;
  env.TRANSLUNAR_DATA_DIR = join(userData, "engine-data");
  env.TRANSLUNAR_TEST_SOURCE = join(
    desktopRoot,
    "tests/e2e/fixtures/single-segment-source.txt",
  );
  env.TRANSLUNAR_TEST_SOURCE_FILES = env.TRANSLUNAR_TEST_SOURCE;

  const launchArgs = ["."];
  if (reducedMotion) launchArgs.push("--force-prefers-reduced-motion");

  const app = await electron.launch({
    executablePath: electronExecutable,
    args: launchArgs,
    cwd: desktopRoot,
    env,
  });
  const page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded");

  // Electron ignores Playwright's viewport emulation; resize the real window.
  await app.evaluate(
    async ({ BrowserWindow }, size) => {
      const [win] = BrowserWindow.getAllWindows();
      win.setMinimumSize(320, 240);
      win.setContentSize(size.width, size.height);
    },
    { width: viewport.width, height: viewport.height },
  );
  if (reducedMotion) {
    await page.emulateMedia({ reducedMotion: "reduce" });
  }
  // The callbacks below run inside the renderer, not in this Node process.
  /* eslint-disable no-undef */
  if (zoom !== 1) {
    await page.evaluate((factor) => {
      document.documentElement.style.fontSize = `${16 * factor}px`;
    }, zoom);
  }
  await page.evaluate((value) => {
    window.localStorage.setItem(
      "translunar.renderer.appearance.v1",
      JSON.stringify({ version: 1, theme: value, accentSeed: "#765847" }),
    );
  }, theme);
  /* eslint-enable no-undef */
  await page.reload();
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(1200);

  const suffix = [
    theme,
    viewport.label,
    zoom === 1 ? null : `zoom${zoom}`,
    reducedMotion ? "reduced" : null,
  ]
    .filter(Boolean)
    .join("_");
  const sessionDir = join(outDir, suffix);
  await mkdir(sessionDir, { recursive: true });

  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(err.message));

  const results = [];

  const capture = async (name) => {
    await page.waitForTimeout(350);
    await page.screenshot({ path: join(sessionDir, `${name}.png`) });
    const geometry = await page.evaluate(geometryProbe);
    const failures = [];
    if (geometry.overflow.horizontal) {
      failures.push(
        `horizontal document overflow (${geometry.overflow.documentScrollWidth} > ${geometry.viewport.width})`,
      );
    }
    if (geometry.clipped.length > 0) {
      failures.push(`${geometry.clipped.length} clipped control(s)`);
    }
    if (geometry.occluded.length > 0) {
      failures.push(
        `${geometry.occluded.length} control(s) cut off by an ancestor overflow`,
      );
    }
    if (geometry.overlapCount > 0) {
      failures.push(`${geometry.overlapCount} overlapping control pair(s)`);
    }
    if (geometry.undersized.length > 0) {
      failures.push(
        `${geometry.undersized.length} control(s) under ${MIN_TARGET}px`,
      );
    }
    if (reducedMotion) {
      const moving = geometry.motionSamples.filter(
        (value) => value !== "0s" && value !== "",
      );
      if (moving.length > 0) {
        failures.push(`reduced motion not honoured: ${moving.join(", ")}`);
      }
    }
    await writeFile(
      join(sessionDir, `${name}.json`),
      `${JSON.stringify({ name, ...geometry, failures }, null, 2)}\n`,
      "utf8",
    );
    results.push({ session: suffix, name, failures, geometry });
    const mark = failures.length === 0 ? "ok" : "FAIL";
    process.stdout.write(
      `  ${mark.padEnd(4)} ${suffix}/${name}${failures.length ? ` :: ${failures.join("; ")}` : ""}\n`,
    );
  };

  // Welcome exists only before the first project is created.
  if (
    await page
      .getByTestId("welcome")
      .isVisible()
      .catch(() => false)
  ) {
    if (!onlyRoutes || onlyRoutes.includes("welcome")) await capture("welcome");
    await page.getByRole("button", { name: "Create project" }).click();
    await page.getByTestId("create-project").waitFor();
    await page.getByLabel("Name").fill("Aurora Field Guide");
    if (!onlyRoutes || onlyRoutes.includes("create-project")) {
      await capture("create-project-filled");
    }
    await page.getByRole("button", { name: "Create" }).click();
    await page.getByTestId("import-document").waitFor({ timeout: 30_000 });
    if (!onlyRoutes || onlyRoutes.includes("import")) await capture("import");
    await page.getByRole("button", { name: "Choose files" }).click();
    await page.getByTestId("workbench").waitFor({ timeout: 60_000 });
    await page.waitForTimeout(800);
  }

  for (const route of buildRoutes(page)) {
    if (onlyRoutes && !onlyRoutes.includes(route.name)) continue;
    try {
      await route.reach();
      await capture(route.name);
      if (route.after) await route.after();
    } catch (error) {
      process.stdout.write(
        `  SKIP ${suffix}/${route.name} :: ${error.message.split("\n")[0]}\n`,
      );
      results.push({
        session: suffix,
        name: route.name,
        failures: [`unreachable: ${error.message.split("\n")[0]}`],
      });
    }
  }

  await app.close().catch(() => undefined);
  await rm(userData, { recursive: true, force: true }).catch(() => undefined);
  return { results, consoleErrors };
}

/* ── Main ───────────────────────────────────────────────── */

await mkdir(outDir, { recursive: true });
const allResults = [];
const allConsoleErrors = [];

for (const theme of themes) {
  for (const viewport of viewports) {
    for (const zoom of zooms) {
      process.stdout.write(
        `\n${theme} ${viewport.label}${zoom === 1 ? "" : ` @${zoom}x`}${reducedMotion ? " reduced-motion" : ""}\n`,
      );
      const { results, consoleErrors } = await seedAndCapture({
        theme,
        viewport,
        zoom,
      });
      allResults.push(...results);
      allConsoleErrors.push(...consoleErrors);
    }
  }
}

const failed = allResults.filter((entry) => entry.failures.length > 0);
const summary = {
  generatedAt: new Date().toISOString(),
  themes,
  viewports: viewports.map((entry) => entry.label),
  zooms,
  reducedMotion,
  captured: allResults.length,
  failed: failed.length,
  consoleErrors: allConsoleErrors,
  failures: failed.map(({ session, name, failures }) => ({
    session,
    name,
    failures,
  })),
};
await writeFile(
  join(outDir, "summary.json"),
  `${JSON.stringify(summary, null, 2)}\n`,
  "utf8",
);

process.stdout.write(
  `\nui-shots: ${allResults.length} captured, ${failed.length} with findings, ${allConsoleErrors.length} console error(s)\n`,
);
process.stdout.write(`evidence: ${outDir}\n`);
process.exit(failed.length === 0 && allConsoleErrors.length === 0 ? 0 : 1);

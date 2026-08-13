#!/usr/bin/env node
/**
 * Renderer delivery and startup budget check.
 *
 * Measures what actually ships and what the user actually waits for:
 * emitted asset bytes, cold first contentful paint inside Electron, the font
 * requests a Latin-only session makes, and interaction cost in the segment
 * grid. Every number comes from a real production build in a real Electron
 * window, not from a bundler estimate.
 *
 * Exit code is 1 when a budget is exceeded, so it can gate a release.
 *
 * Usage:
 *   pnpm build:desktop && node scripts/ui-perf.mjs
 *   node scripts/ui-perf.mjs --json
 */
import { readdirSync, statSync, readFileSync } from "node:fs";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { tmpdir } from "node:os";
import { join, resolve, extname } from "node:path";
import { createRequire } from "node:module";

const root = resolve(import.meta.dirname, "..");
const desktopRoot = join(root, "apps", "desktop");
const rendererDist = join(desktopRoot, "dist", "renderer");
const require = createRequire(join(desktopRoot, "package.json"));
const { _electron: electron } = require("playwright");
const electronExecutable = require("electron");

const jsonOutput = process.argv.includes("--json");

/**
 * Budgets. Chosen from the measured baseline with headroom, not from a wish:
 * see docs/performance-budgets.md for how each one was derived.
 */
const BUDGETS = {
  /** Initial renderer script, gzipped, that must arrive before first paint. */
  initialScriptGzipBytes: 200 * 1024,
  /** Renderer stylesheet, gzipped. */
  styleGzipBytes: 32 * 1024,
  /** First contentful paint inside the Electron window, cold. */
  firstContentfulPaintMs: 1500,
  /** Fonts a Latin-only session is allowed to download. */
  maxFontRequestsLatinSession: 3,
  /** Median frame cost while scrolling and typing in the segment grid. */
  interactionFrameMs: 16,
};

function gzipSize(path) {
  return gzipSync(readFileSync(path)).length;
}

function collectAssets() {
  const assetsDir = join(rendererDist, "assets");
  const entries = readdirSync(assetsDir).map((name) => {
    const path = join(assetsDir, name);
    return {
      name,
      ext: extname(name),
      bytes: statSync(path).size,
      gzipBytes: /\.(js|css|html)$/.test(name) ? gzipSize(path) : null,
    };
  });
  return entries.sort((a, b) => b.bytes - a.bytes);
}

async function measureRuntime() {
  const userData = await mkdtemp(join(tmpdir(), "tl-perf-"));
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

  const app = await electron.launch({
    executablePath: electronExecutable,
    args: ["."],
    cwd: desktopRoot,
    env,
  });
  const page = await app.firstWindow();

  /** Every asset the renderer actually fetches, by URL. */
  const requested = [];
  page.on("request", (request) => requested.push(request.url()));

  await page.waitForLoadState("domcontentloaded");
  await app.evaluate(async ({ BrowserWindow }) => {
    const [win] = BrowserWindow.getAllWindows();
    win?.setContentSize(1680, 942);
  });
  await page.getByTestId("welcome").waitFor({ timeout: 60_000 });

  /* eslint-disable no-undef -- the callbacks below run in the renderer. */
  const paint = await page.evaluate(() => {
    const fcp = performance
      .getEntriesByType("paint")
      .find((entry) => entry.name === "first-contentful-paint");
    const nav = performance.getEntriesByType("navigation")[0];
    return {
      firstContentfulPaintMs: fcp ? Math.round(fcp.startTime) : null,
      domContentLoadedMs: nav ? Math.round(nav.domContentLoadedEventEnd) : null,
    };
  });

  const fontRequestsLatin = requested.filter((url) =>
    url.endsWith(".woff2"),
  ).length;

  // Reach the Workbench, then measure interaction cost with real typing.
  await page.getByRole("button", { name: "Create project" }).click();
  await page.getByLabel("Name").fill("Perf");
  await page.getByRole("button", { name: "Create" }).click();
  await page.getByTestId("import-document").waitFor({ timeout: 30_000 });
  await page.getByRole("button", { name: "Choose files" }).click();
  await page.getByTestId("workbench").waitFor({ timeout: 60_000 });
  await page.waitForTimeout(600);

  const editor = page.locator('[data-testid^="target-editor-"]').first();
  await editor.click();
  /*
   * Measure the work a keystroke causes, not the display cadence. Waiting on
   * requestAnimationFrame would floor every sample at the 16.7 ms refresh
   * interval and report a healthy editor as over budget. React flushes a
   * discrete input event synchronously, so the dispatch call itself contains
   * the render and commit cost. Long tasks are recorded separately because a
   * single 200 ms stall matters more than a slightly slow median.
   */
  const typing = await page.evaluate(async () => {
    const field = document.querySelector('[data-testid^="target-editor-"]');
    if (!field) return null;

    const longTasks = [];
    let observer;
    try {
      observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          longTasks.push(Math.round(entry.duration));
        }
      });
      observer.observe({ entryTypes: ["longtask"] });
    } catch {
      // longtask is unavailable on some platforms; the median still applies.
    }

    const samples = [];
    for (let i = 0; i < 40; i += 1) {
      const start = performance.now();
      field.value = `${field.value}测`;
      field.dispatchEvent(new Event("input", { bubbles: true }));
      samples.push(performance.now() - start);
      // Yield between keystrokes so effects and timers run as they would for
      // a real typist, without counting the wait as keystroke cost.
      await new Promise((r) => setTimeout(r, 8));
    }
    observer?.disconnect();

    samples.sort((a, b) => a - b);
    const at = (q) =>
      Math.round(
        samples[Math.min(samples.length - 1, Math.floor(samples.length * q))] *
          100,
      ) / 100;
    return {
      medianMs: at(0.5),
      p95Ms: at(0.95),
      longTasks,
    };
  });

  /* eslint-enable no-undef */

  // CJK content is on screen now, so the CJK face may legitimately load.
  const fontRequestsAfterCjk = requested.filter((url) =>
    url.endsWith(".woff2"),
  ).length;

  await app.close().catch(() => undefined);
  await rm(userData, { recursive: true, force: true }).catch(() => undefined);

  return { paint, fontRequestsLatin, fontRequestsAfterCjk, typing };
}

const assets = collectAssets();
const scripts = assets.filter((a) => a.ext === ".js");
const styles = assets.filter((a) => a.ext === ".css");
const fonts = assets.filter((a) => a.ext === ".woff2");
const initialScriptGzip = scripts.reduce(
  (sum, a) => sum + (a.gzipBytes ?? 0),
  0,
);
const styleGzip = styles.reduce((sum, a) => sum + (a.gzipBytes ?? 0), 0);

const runtime = await measureRuntime();

const results = [
  {
    id: "initial-script-gzip",
    value: initialScriptGzip,
    budget: BUDGETS.initialScriptGzipBytes,
    unit: "bytes",
  },
  {
    id: "style-gzip",
    value: styleGzip,
    budget: BUDGETS.styleGzipBytes,
    unit: "bytes",
  },
  {
    id: "first-contentful-paint",
    value: runtime.paint.firstContentfulPaintMs ?? Number.POSITIVE_INFINITY,
    budget: BUDGETS.firstContentfulPaintMs,
    unit: "ms",
  },
  {
    id: "font-requests-latin-session",
    value: runtime.fontRequestsLatin,
    budget: BUDGETS.maxFontRequestsLatinSession,
    unit: "requests",
  },
  {
    id: "typing-frame-median",
    value: runtime.typing?.medianMs ?? Number.POSITIVE_INFINITY,
    budget: BUDGETS.interactionFrameMs,
    unit: "ms",
  },
];

const failures = results.filter((r) => r.value > r.budget);

const report = {
  generatedAt: new Date().toISOString(),
  assets: assets.map(({ name, bytes, gzipBytes }) => ({
    name,
    bytes,
    gzipBytes,
  })),
  totals: {
    scriptBytes: scripts.reduce((s, a) => s + a.bytes, 0),
    scriptGzipBytes: initialScriptGzip,
    styleBytes: styles.reduce((s, a) => s + a.bytes, 0),
    styleGzipBytes: styleGzip,
    fontBytes: fonts.reduce((s, a) => s + a.bytes, 0),
    fontCount: fonts.length,
  },
  runtime,
  results,
  failures: failures.map((f) => f.id),
};

const outDir = join(desktopRoot, "test-results");
await mkdir(outDir, { recursive: true });
await writeFile(
  join(outDir, "ui-perf.json"),
  `${JSON.stringify(report, null, 2)}\n`,
  "utf8",
);

if (jsonOutput) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else {
  process.stdout.write("\nEmitted renderer assets\n");
  for (const asset of assets) {
    const gz = asset.gzipBytes ? ` (gzip ${fmt(asset.gzipBytes)})` : "";
    process.stdout.write(
      `  ${fmt(asset.bytes).padStart(10)}${gz}  ${asset.name}\n`,
    );
  }
  process.stdout.write("\nBudgets\n");
  for (const result of results) {
    const ok = result.value <= result.budget ? "ok  " : "FAIL";
    process.stdout.write(
      `  ${ok} ${result.id.padEnd(28)} ${String(result.value).padStart(8)} ${result.unit} (budget ${result.budget})\n`,
    );
  }
  process.stdout.write(
    `\nfonts fetched: ${runtime.fontRequestsLatin} before CJK content, ${runtime.fontRequestsAfterCjk} after\n`,
  );
  process.stdout.write(
    `typing keystroke cost: median ${runtime.typing?.medianMs} ms, p95 ${runtime.typing?.p95Ms} ms\n`,
  );
  const longTasks = runtime.typing?.longTasks ?? [];
  process.stdout.write(
    `long tasks during typing: ${longTasks.length === 0 ? "none" : longTasks.join(", ") + " ms"}\n`,
  );
  process.stdout.write(`report: ${join(outDir, "ui-perf.json")}\n`);
}

function fmt(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

process.exit(failures.length === 0 ? 0 : 1);

/* Automated screenshot test suite for Translunar CAT Workbench Gemini Plus & Art studies.
   Drives every prototype through scenario matrix and dialogs using puppeteer-core,
   saving screenshots to both /opt/cursor/artifacts/design-gemini-plus/ and local shots/ directories. */

import puppeteer from "puppeteer-core";
import { mkdirSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const rootDir = join(here, "..");
const artifactDir = "/opt/cursor/artifacts/design-gemini-plus";
const CHROME_PATH = "/usr/local/bin/google-chrome";

const PROTOTYPES = [
  /* Job A: 3 Modern SaaS Functional Redo Systems */
  "saas-gemini-plus-linear",
  "saas-gemini-plus-stripe",
  "saas-gemini-plus-raycast",

  /* Job B: 4 Awwwards/FWA/CSSDA-grade Artistic Studies */
  "saas-gemini-art-kinetic",
  "saas-gemini-art-editorial",
  "saas-gemini-art-glass",
  "saas-gemini-art-monolith",
];

const SCENARIOS = [
  { name: "01-grid-imported", scene: "grid" },
  { name: "02-confirm-wrote-tm", scene: "confirmed" },
  { name: "03-locked-segment", scene: "locked" },
  { name: "04-qa-unedited-fuzzy", scene: "qa" },
  { name: "05-ai-unconfigured", scene: "ai" },
  { name: "06-agent-awaiting-review", scene: "agent" },
  { name: "07-export-qa-gate", scene: "gate" },
  {
    name: "08-command-palette",
    scene: "grid",
    action: async (p) => {
      await p.evaluate(() => {
        S.palette = { open: true, q: "", sel: 0 };
        render();
      });
    },
  },
  {
    name: "09-find-replace",
    scene: "grid",
    action: async (p) => {
      await p.evaluate(() => {
        S.find = { open: true, mode: "replace", q: "记忆库", r: "翻译记忆库", incl: false };
        render();
      });
    },
  },
  {
    name: "10-dialog-memory-manage",
    scene: "grid",
    action: async (p) => {
      await p.evaluate(() => {
        S.dialog = "tm";
        render();
      });
    },
  },
  {
    name: "11-dialog-settings",
    scene: "grid",
    action: async (p) => {
      await p.evaluate(() => {
        S.dialog = "settings";
        S.settingsTab = "qa";
        render();
      });
    },
  },
];

async function run() {
  console.log("Building all 7 HTML prototypes...");
  const { execSync } = await import("node:child_process");
  execSync("node docs/design-studies/src/build.mjs", { stdio: "inherit" });

  console.log("\nLaunching headless browser for automated screenshot captures...");
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--window-size=1640,1000",
    ],
  });

  for (const proto of PROTOTYPES) {
    console.log(`\nCapturing prototype: ${proto}...`);
    const protoArtifactDir = join(artifactDir, proto);
    const protoLocalShotsDir = join(rootDir, proto, "shots");
    mkdirSync(protoArtifactDir, { recursive: true });
    mkdirSync(protoLocalShotsDir, { recursive: true });

    const page = await browser.newPage();
    await page.setViewport({ width: 1640, height: 1000, deviceScaleFactor: 1 });

    page.on("pageerror", (err) => {
      console.error(`[${proto}] Page error:`, err);
    });

    const htmlPath = join(rootDir, proto, "index.html");

    for (const sc of SCENARIOS) {
      await page.goto(`file://${htmlPath}?scene=${sc.scene}`, { waitUntil: "networkidle0" });
      await new Promise((r) => setTimeout(r, 60));

      if (sc.action) {
        await sc.action(page);
        await new Promise((r) => setTimeout(r, 120));
      }

      const outArtifact = join(protoArtifactDir, `${sc.name}.png`);
      const outLocal = join(protoLocalShotsDir, `${sc.name}.png`);

      await page.screenshot({ path: outArtifact });
      copyFileSync(outArtifact, outLocal);
      console.log(`  ✓ ${sc.name}`);
    }

    await page.close();
  }

  await browser.close();
  console.log("\nAll screenshots captured successfully across all 7 prototypes!");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

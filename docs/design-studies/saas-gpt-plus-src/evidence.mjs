/* Captures the compact review set after shots.mjs has exercised the complete
   state matrix. The same renders go to upload artifacts and repository shots. */
const { chromium } = await import(process.env.PW || "playwright");
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const studies = join(here, "..");
const artifactDir = "/opt/cursor/artifacts/design-gpt-tune";
const repoDir = join(studies, "shots", "gpt-tune");
const THEMES = [
  "aperture",
  "moss",
  "orbit",
  "prism",
  "folio",
  "relay",
  "signal",
  "nocturne",
  "orbit-light",
];
const ART = new Set(["folio", "relay", "signal", "nocturne", "orbit-light"]);

mkdirSync(artifactDir, { recursive: true });
mkdirSync(repoDir, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1640, height: 1000 },
  deviceScaleFactor: 1,
  locale: "zh-CN",
});
const errors = [];

for (const theme of THEMES) {
  const page = await context.newPage();
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`${theme}: ${message.text()}`);
  });
  page.on("pageerror", (error) => errors.push(`${theme}: ${error.message}`));
  await page.goto(`file://${join(studies, `saas-gpt-plus-${theme}`, "index.html")}?scene=grid`);
  await page.waitForSelector(".preview__doc");

  const contract = await page.evaluate(() => ({
    tree: Boolean(document.querySelector(".filetree .treechildren")),
    grid: Boolean(document.querySelector(".grid tbody tr .rowmenu__btn")),
    docks: document.querySelectorAll(".docktabs [role=tab]").length,
    dialogs: typeof dialog === "function" && typeof vDialogs === "function",
    scenes: document.querySelectorAll(".scene").length,
  }));
  if (!contract.tree || !contract.grid || contract.docks < 4 || !contract.dialogs || contract.scenes < 8) {
    errors.push(`${theme}: incomplete IA ${JSON.stringify(contract)}`);
  }

  await page.screenshot({ path: join(repoDir, `${theme}_workbench.png`) });
  if (ART.has(theme)) {
    await page.screenshot({ path: join(artifactDir, `${theme}_workbench_final.png`) });
  }

  if (theme === "aperture") {
    const tune = await page.evaluate(() => {
      const ribbon = getComputedStyle(document.querySelector(".ribbon"));
      const button = getComputedStyle(document.querySelector(".rbtn"));
      const block = getComputedStyle(document.querySelector(".preview__block"));
      const translated = getComputedStyle(document.querySelector('.pvseg[data-state="confirmed"]'));
      const source = getComputedStyle(document.querySelector(".pvseg[data-fallback]"));
      const active = getComputedStyle(document.querySelector(".pvseg[data-active]"));
      return {
        toolbar: ribbon.backgroundColor,
        ribbonDirection: button.flexDirection,
        proofWrap: block.flexWrap,
        translated: translated.backgroundColor,
        source: source.backgroundColor,
        active: active.backgroundColor,
        activeBorder: active.borderTopColor,
      };
    });
    const expected = {
      toolbar: "rgb(249, 247, 242)",
      ribbonDirection: "column",
      proofWrap: "wrap",
      active: "rgb(255, 255, 255)",
    };
    for (const [key, value] of Object.entries(expected)) {
      if (tune[key] !== value) errors.push(`aperture: ${key}=${tune[key]}, expected ${value}`);
    }
    if (tune.translated === tune.source || tune.activeBorder === tune.active) {
      errors.push(`aperture: proof block states are not visually distinct ${JSON.stringify(tune)}`);
    }
    await page.locator(".ribbon").screenshot({
      path: join(artifactDir, "ribbon_grouped_warm_final.png"),
    });
    await page.locator(".preview__body").screenshot({
      path: join(artifactDir, "proofread_color_blocks_final.png"),
    });
    await page.locator(".ribbon").screenshot({
      path: join(repoDir, "ribbon_grouped_warm.png"),
    });
    await page.locator(".preview__body").screenshot({
      path: join(repoDir, "proofread_color_blocks.png"),
    });
  }
  await page.close();
}

await context.close();
await browser.close();

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log("captured 9 workbenches, ribbon, and proof blocks; visual contracts passed");

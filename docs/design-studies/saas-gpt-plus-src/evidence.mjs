/* Captures every real ribbon and validates that layout is shared while color
   remains theme-owned. The final matrix is composed from those screenshots. */
const { chromium } = await import(process.env.PW || "playwright");
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const studies = join(here, "..");
const artifactDir = "/opt/cursor/artifacts/design-gpt-ribbon";
const THEMES = [
  "aperture",
  "moss",
  "orbit",
  "orbit-light",
  "prism",
  "folio",
  "relay",
  "signal",
  "nocturne",
];

mkdirSync(artifactDir, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1640, height: 1000 },
  deviceScaleFactor: 1,
  locale: "zh-CN",
});
const errors = [];
const ribbonColors = new Set();

for (const theme of THEMES) {
  const page = await context.newPage();
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`${theme}: ${message.text()}`);
  });
  page.on("pageerror", (error) => errors.push(`${theme}: ${error.message}`));
  await page.goto(`file://${join(studies, `saas-gpt-plus-${theme}`, "index.html")}?scene=grid`);
  await page.waitForSelector(".ribbon");

  const contract = await page.evaluate(() => {
    const probe = document.createElement("span");
    probe.style.color = "var(--accent)";
    document.body.append(probe);
    const result = {
      direction: getComputedStyle(document.querySelector(".rbtn")).flexDirection,
      groups: document.querySelectorAll(".rgroup").length,
      ribbon: getComputedStyle(document.querySelector(".ribbon")).backgroundColor,
      confirm: getComputedStyle(document.querySelector(".rbtn--primary")).color,
      accent: getComputedStyle(probe).color,
      tree: Boolean(document.querySelector(".filetree .treechildren")),
      docks: document.querySelectorAll(".docktabs [role=tab]").length,
    };
    probe.remove();
    return result;
  });

  if (
    contract.direction !== "column" ||
    contract.groups < 4 ||
    contract.confirm !== contract.accent ||
    !contract.tree ||
    contract.docks < 4
  ) {
    errors.push(`${theme}: ribbon/IA contract ${JSON.stringify(contract)}`);
  }
  ribbonColors.add(contract.ribbon);
  await page.locator(".ribbon").screenshot({
    path: join(artifactDir, `${theme}_ribbon.png`),
  });
  await page.close();
}

if (ribbonColors.size !== THEMES.length) {
  errors.push(`expected ${THEMES.length} theme-owned ribbon colors, found ${ribbonColors.size}`);
}

const matrix = await context.newPage();
await matrix.setViewportSize({ width: 1640, height: 900 });
const rows = THEMES.map((theme) => {
  const png = readFileSync(join(artifactDir, `${theme}_ribbon.png`)).toString("base64");
  return `<section><strong>${theme}</strong><img alt="${theme} ribbon" src="data:image/png;base64,${png}"></section>`;
}).join("");
await matrix.setContent(`<style>
  *{box-sizing:border-box}body{margin:0;background:#11151a;color:#e8edf1;font:600 12px ui-monospace,monospace}
  main{padding:14px;display:grid;gap:8px}section{display:grid;grid-template-columns:108px 1fr;align-items:center;gap:12px}
  strong{text-align:right;letter-spacing:.05em}img{display:block;width:100%;height:auto;border:1px solid #343a40}
</style><main>${rows}</main>`);
await matrix.locator("main").screenshot({
  path: join(artifactDir, "ribbon_palette_matrix_final.png"),
});
await matrix.close();
await context.close();
await browser.close();

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log(`validated ${THEMES.length} grouped ribbons with ${ribbonColors.size} theme-owned palettes`);

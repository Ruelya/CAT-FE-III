/* Records one end-to-end walkthrough per visual system: type a draft, confirm
   it into memory, apply an engine fix, waive a rule, jump with the palette,
   open the management dialogs, then hit the export quality gate. */

const { chromium } = await import(process.env.PW || "playwright");
import { mkdirSync, rmSync, readdirSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const studies = join(here, "..");
const outDir = "/tmp/gpt-plus-video";
const THEMES = ["aperture", "moss", "orbit", "prism"];
const VIEW = { width: 1640, height: 1000 };

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

for (const theme of THEMES) {
  const dir = join(outDir, theme);
  mkdirSync(dir, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: VIEW,
    locale: "zh-CN",
    recordVideo: { dir, size: VIEW },
  });
  const page = await ctx.newPage();
  await page.goto(`file://${join(studies, `saas-gpt-plus-${theme}`, "index.html")}`);
  await page.waitForSelector(".app");
  await wait(1200);

  /* Draft, then confirm — the confirm writes memory and moves on. */
  await page.click('tr[data-row="10"] .c-tgt');
  await wait(500);
  await page.click("#editor");
  await page.keyboard.press("End");
  await page.keyboard.type("并保持术语一致。", { delay: 45 });
  await wait(700);
  await page.keyboard.press("Control+Enter");
  await wait(1300);

  /* Apply a memory match by keyboard, the way a translator actually would. */
  await page.keyboard.press("Control+1");
  await wait(1300);

  /* Lock a segment, and watch the ribbon verb flip to 解锁. */
  await page.click('tr[data-row="13"] .c-tgt');
  await wait(400);
  await page.keyboard.press("Control+l");
  await wait(1200);
  await page.keyboard.press("Control+l");
  await wait(900);

  /* Find and replace across the document, skipping confirmed rows. */
  await page.keyboard.press("Control+h");
  await wait(500);
  await page.fill("#findq", "记忆库");
  await wait(600);
  await page.fill("#findr", "翻译记忆库");
  await wait(500);
  await page.keyboard.press("F4");
  await wait(900);
  await page.keyboard.press("F4");
  await wait(900);
  await page.click('[data-act="find-close"]');
  await wait(600);

  /* QA: run it, apply the engine fix, waive a whole rule. */
  await page.click('[data-dock="qa"]');
  await wait(700);
  await page.click('[data-cmd="run-qa"]');
  await wait(900);
  await page.click('[data-cmd="apply-fix"]');
  await wait(1200);
  await page.click('[data-cmd="waive-rule"]');
  await wait(1300);

  /* Command palette: search, then jump to a dock. */
  await page.keyboard.press("Control+k");
  await wait(700);
  await page.fill("#paletteq", "术语");
  await wait(900);
  await page.keyboard.press("ArrowDown");
  await wait(500);
  await page.keyboard.press("Enter");
  await wait(1100);

  /* Management surfaces. */
  await page.click('.menubar__item[data-menu="3"]');
  await wait(700);
  await page.click('.menudrop__item[data-cmd="open-tm-manage"]');
  await wait(1400);
  await page.keyboard.press("Escape");
  await wait(600);
  await page.click(".rail--left [data-cmd=\"open-project-settings\"]");
  await wait(900);
  await page.click('[data-settab="qa"]');
  await wait(1200);
  await page.keyboard.press("Escape");
  await wait(700);

  /* Export runs into the quality gate, then the overwrite decision. */
  await page.click('[data-cmd="export-document"]');
  await wait(1600);
  await page.click('[data-cmd="gate-override"]');
  await wait(1300);
  await page.click('[data-cmd="overwrite-confirm"]');
  await wait(1600);

  await ctx.close();
  await browser.close();

  const file = readdirSync(dir).find((f) => f.endsWith(".webm"));
  renameSync(join(dir, file), join(outDir, `${theme}.webm`));
  console.log(`recorded ${theme}`);
}

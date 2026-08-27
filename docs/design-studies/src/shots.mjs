/* Drives every study through the full scenario and dialog matrix, captures a
   shot of each state, and records one end-to-end walkthrough per system.
   Any console error or page exception fails the run — the studies are meant
   to be clicked through by a reviewer, so they have to actually work. */

/* Resolved at runtime so the studies never need a package.json of their own;
   pass PW=$(npm root -g)/playwright/index.mjs (see README-opus.md). */
const { chromium } = await import(process.env.PW || "playwright");
import { mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const studies = join(here, "..");
const tmp = "/tmp/opus-shots";
const THEMES = [
  "saas-opus-quarry",
  "saas-opus-cobalt",
  "saas-opus-ledger",
  "saas-opus-art-riso",
  "saas-opus-art-atelier",
  "saas-opus-art-phosphor",
  "saas-opus-art-vitrine",
  "saas-opus-art-atelier-light",
  "saas-opus-art-phosphor-light",
];
const VIEW = { width: 1640, height: 1000 };

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* Each entry: [filename, async setup(page)]. `scene` navigations reset all
   state, so the shots are independent of one another. */
const SHOTS = [
  ["01-grid-imported", async (p) => scene(p, "grid")],
  ["02-confirm-wrote-tm", async (p) => scene(p, "confirmed")],
  ["03-locked-segment", async (p) => scene(p, "locked")],
  ["04-qa-unedited-fuzzy", async (p) => scene(p, "qa")],
  ["05-ai-unconfigured", async (p) => scene(p, "ai")],
  ["06-agent-awaiting-review", async (p) => scene(p, "agent")],
  ["07-export-qa-gate", async (p) => scene(p, "gate")],
  ["08-projects-empty", async (p) => scene(p, "projects")],
  [
    "09-command-palette",
    async (p) => {
      await scene(p, "grid");
      await p.keyboard.press("Control+k");
    },
  ],
  [
    "10-menu-translate",
    async (p) => {
      await scene(p, "grid");
      await p.click('.menubar__item[data-menu="4"]');
    },
  ],
  [
    "11-find-replace",
    async (p) => {
      await scene(p, "grid");
      await p.keyboard.press("Control+h");
      await p.fill("#findq", "记忆库");
      await p.fill("#findr", "翻译记忆库");
    },
  ],
  [
    "12-filters-and-search",
    async (p) => {
      await scene(p, "grid");
      await p.click('.chip[data-filter="draft"]');
      await p.click('.chip[data-filter="term"]');
    },
  ],
  [
    "13-row-menu",
    async (p) => {
      await scene(p, "grid");
      await p.click('tr[data-row="14"] .rowmenu__btn');
    },
  ],
  [
    "14-term-dock",
    async (p) => {
      await scene(p, "grid");
      await p.click('[data-dock="term"]');
    },
  ],
  [
    "15-preview-layout",
    async (p) => {
      await scene(p, "grid");
      await p.click('[data-act="pv-layout"]');
    },
  ],
  [
    "16-dialog-new-project",
    async (p) => {
      await scene(p, "projects");
      await p.click('.menubar__item[data-menu="0"]');
      await p.click('.menudrop__item[data-cmd="new-project"]');
    },
  ],
  [
    "17-dialog-import",
    async (p) => {
      await scene(p, "grid");
      await p.click('[data-cmd="import-document"]');
    },
  ],
  [
    "18-settings-qa-gate",
    async (p) => {
      await scene(p, "grid");
      await p.click('.rail--left [data-cmd="open-project-settings"]');
      await p.click('[data-settab="qa"]');
    },
  ],
  [
    "19-settings-tm-transfer",
    async (p) => {
      await scene(p, "grid");
      await p.click('.rail--left [data-cmd="open-project-settings"]');
      await p.click('[data-settab="tm"]');
    },
  ],
  [
    "20-settings-archive",
    async (p) => {
      await scene(p, "grid");
      await p.click('.menubar__item[data-menu="3"]');
      await p.click('.menudrop__item[data-cmd="archive-project"]');
    },
  ],
  [
    "21-dialog-memory-manage",
    async (p) => {
      await scene(p, "grid");
      await p.click('.menubar__item[data-menu="3"]');
      await p.click('.menudrop__item[data-cmd="open-tm-manage"]');
      await p.click('[data-act="tm-cascade"]');
    },
  ],
  [
    "22-dialog-termbase-manage",
    async (p) => {
      await scene(p, "grid");
      await p.click('.menubar__item[data-menu="3"]');
      await p.click('.menudrop__item[data-cmd="open-term-manage"]');
    },
  ],
  [
    "23-export-overwrite",
    async (p) => {
      await scene(p, "gate");
      await p.click('[data-cmd="gate-override"]');
    },
  ],
  [
    "25-file-tree-expanded",
    async (p) => {
      await scene(p, "grid");
      await p.click('[data-dir="legal"]');
      await p.click('[data-cmd="open-doc-strings"]');
    },
  ],
  [
    "26-file-tree-search",
    async (p) => {
      await scene(p, "grid");
      await p.fill("#filesearch", "doc");
    },
  ],
  [
    /* Proofreading reads as colour blocks, so the shot has to show enough of
       the flow to compare fills: opened tall, scrolled to where confirmed,
       draft, locked and untranslated chips all sit together. */
    "27-proofread-chips",
    async (p) => {
      await scene(p, "grid");
      await p.evaluate(() => {
        document.querySelector(".preview").style.maxHeight = "660px";
        document.querySelector(".preview__body").style.maxHeight = "600px";
        document.querySelector(".preview__body").scrollTop = 300;
      });
    },
  ],
  [
    "24-engine-gate",
    async (p) => {
      await scene(p, "grid");
      await p.evaluate(() => {
        S.engine = "down";
        S.status = "引擎已停止，编辑已锁定";
        render();
      });
    },
  ],
];

async function scene(page, id) {
  await page.click(`.scene[data-scene="${id}"]`);
  await wait(90);
}

async function shoot(page, file) {
  await wait(140);
  await page.screenshot({ path: file });
}

const errors = [];

for (const theme of THEMES) {
  const outTmp = join(tmp, theme);
  rmSync(outTmp, { recursive: true, force: true });
  mkdirSync(outTmp, { recursive: true });

  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: VIEW,
    deviceScaleFactor: 2,
    locale: "zh-CN",
  });
  const page = await ctx.newPage();
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`${theme}: console ${m.text()}`);
  });
  page.on("pageerror", (e) => errors.push(`${theme}: pageerror ${e.message}`));

  await page.goto(`file://${join(studies, theme, "index.html")}`);
  await page.waitForSelector(".app");

  for (const [name, setup] of SHOTS) {
    await setup(page);
    await shoot(page, join(outTmp, `${name}.png`));
  }

  /* Sanity: the shell must render every required region in the work scene. */
  await scene(page, "grid");
  const tree = await page.evaluate(() => {
    const depth = (r) => r.querySelectorAll(".tree__indent i").length;
    const rows = [...document.querySelectorAll(".tree__row")];
    return {
      dirs: rows.filter((r) => r.classList.contains("tree__row--dir")).length,
      files: rows.filter((r) => r.classList.contains("tree__row--file")).length,
      maxDepth: Math.max(...rows.map(depth)),
      collapsible: !!document.querySelector('.tree__row--dir[aria-expanded="false"]'),
    };
  });
  if (tree.dirs < 4 || tree.maxDepth < 2 || !tree.collapsible)
    errors.push(`${theme}: tree shape ${JSON.stringify(tree)}`);
  const missing = await page.evaluate(() => {
    const need = [
      ".titlebar",
      ".menubar__item",
      ".ribbon",
      ".rail--left",
      ".tree",
      '.tree__row--dir[aria-expanded="true"]',
      ".tree__row--file .tree__icon svg",
      ".tree__indent i",
      ".tree__filerow[data-active]",
      ".chips .chip",
      ".doctabs .doctab",
      ".grid table tbody tr",
      ".statecell .statechip",
      ".preview",
      ".docktabs [role=tab]",
      ".dockbody .panel",
      ".statusbar .stat--engine",
      '.pvseg[data-state="confirmed"]',
      '.pvseg[data-state="draft"]',
      '.pvseg[data-state="locked"]',
      ".pvseg[data-fallback]",
      ".pvseg[data-active]",
    ];
    return need.filter((s) => !document.querySelector(s));
  });
  if (missing.length) errors.push(`${theme}: missing ${missing.join(", ")}`);

  /* The proofreading view states segment status with fills, so assert that
     every state resolves to its own opaque colour and that no chip carries a
     line decoration. A theme that forgets to retint would otherwise ship a
     preview where four states look identical. */
  const chips = await page.evaluate(() => {
    const pick = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const cs = getComputedStyle(el);
      return { bg: cs.backgroundColor, deco: cs.textDecorationLine, border: cs.borderTopColor };
    };
    return {
      confirmed: pick('.pvseg[data-state="confirmed"]'),
      draft: pick('.pvseg[data-state="draft"]'),
      locked: pick('.pvseg[data-state="locked"]'),
      none: pick(".pvseg[data-fallback]"),
      active: pick(".pvseg[data-active]"),
      decorated: [...document.querySelectorAll(".pvseg")].filter(
        (e) => getComputedStyle(e).textDecorationLine !== "none",
      ).length,
    };
  });
  const fills = [chips.confirmed, chips.draft, chips.locked, chips.none].map((c) => c && c.bg);
  if (new Set(fills).size !== 4)
    errors.push(`${theme}: proofread fills not distinct ${JSON.stringify(fills)}`);
  if (fills.some((f) => !f || f === "rgba(0, 0, 0, 0)"))
    errors.push(`${theme}: proofread chip without a fill ${JSON.stringify(fills)}`);
  if (chips.decorated)
    errors.push(`${theme}: ${chips.decorated} proofread chips carry a line decoration`);
  if (!chips.active || chips.active.border === chips.confirmed.border)
    errors.push(`${theme}: active proofread chip has no outline of its own`);

  await browser.close();
  console.log(`captured ${theme}: ${SHOTS.length} shots`);
}

if (errors.length) {
  console.error("\nFAILURES:\n" + errors.join("\n"));
  process.exit(1);
}
console.log("\nno console errors, all regions present");

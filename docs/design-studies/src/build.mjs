/* Composes one self-contained index.html per visual system.
   Everything is inlined so a study can be opened straight from disk with no
   server, no build step and no network. An art study may add one extra
   script — the "art layer" — which owns material that lives outside #root
   (grain, light fields, scanlines) and therefore survives a re-render. */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "..");

const STUDIES = [
  {
    slug: "quarry",
    dir: "saas-opus-quarry",
    family: "saas-opus",
    css: "theme-quarry.css",
    blurb: "温石中性色，最宽松的密度，发丝线分隔。",
  },
  {
    slug: "cobalt",
    dir: "saas-opus-cobalt",
    family: "saas-opus",
    css: "theme-cobalt.css",
    blurb: "深色控制台，靠表面层级分隔，蓝色只表示「你在哪」。",
  },
  {
    slug: "ledger",
    dir: "saas-opus-ledger",
    family: "saas-opus",
    css: "theme-ledger.css",
    blurb: "无彩瑞士数据表，最紧密度，颜色只表示状态。",
  },
  {
    slug: "riso",
    dir: "saas-opus-art-riso",
    family: "saas-opus-art",
    css: "art-riso.css",
    js: "art-riso.js",
    blurb: "双色孔版印刷：纸纹、网点、套印偏移。",
  },
  {
    slug: "atelier",
    dir: "saas-opus-art-atelier",
    family: "saas-opus-art",
    css: "art-atelier.css",
    js: "art-atelier.js",
    blurb: "夜间画廊：衬线字、黄铜光泽、凹凸压印。",
  },
  {
    slug: "phosphor",
    dir: "saas-opus-art-phosphor",
    family: "saas-opus-art",
    css: "art-phosphor.css",
    js: "art-phosphor.js",
    blurb: "CRT 荧光终端：扫描线、辉光、色散。",
  },
  {
    slug: "vitrine",
    dir: "saas-opus-art-vitrine",
    family: "saas-opus-art",
    css: "art-vitrine.css",
    js: "art-vitrine.js",
    blurb: "玻璃与光：磨砂层叠、镜面高光、漂移光场。",
  },
];

const read = (f) => readFileSync(join(here, f), "utf8");
const base = read("base.css");
const data = read("data.js");
const app = read("app.js");

for (const s of STUDIES) {
  const theme = read(s.css);
  const artJs = s.js && existsSync(join(here, s.js)) ? read(s.js) : null;
  const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Translunar 工作台 — ${s.family} / ${s.slug}</title>
<meta name="description" content="${s.blurb}">
<style>
/* ===== base.css — structure shared by every visual system ===== */
${base}
/* ===== ${s.css} — this visual system ===== */
${theme}
</style>
</head>
<body>
<div id="root"></div>
<script>
const THEME_NAME = ${JSON.stringify(s.slug)};
const THEME_FAMILY = ${JSON.stringify(s.family)};
</script>
<script>
/* ===== data.js — fixtures, identical across systems ===== */
${data}
</script>
<script>
/* ===== app.js — state, dispatcher, markup, keymap ===== */
${app}
</script>
${
  artJs
    ? `<script>
/* ===== ${s.js} — art layer, lives outside #root ===== */
${artJs}
</script>`
    : ""
}
</body>
</html>
`;
  const dir = join(out, s.dir);
  mkdirSync(join(dir, "shots"), { recursive: true });
  writeFileSync(join(dir, "index.html"), html);
  console.log(`${s.dir}/index.html  ${(html.length / 1024).toFixed(0)} KB`);
}

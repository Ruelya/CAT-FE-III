/* Composes one self-contained index.html per visual system.
   Everything is inlined so a study can be opened straight from disk with no
   server, no build step and no network. */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "..");

const THEMES = [
  /* Job A: 3 Modern SaaS Functional Redo Systems */
  {
    dir: "saas-gemini-plus-linear",
    file: "theme-gemini-plus-linear.css",
    name: "Linear Dark Pro",
    title: "Translunar 工作台 — Linear Dark Pro Edition",
    blurb: "高速度工程级暗色石墨控制台，紫罗兰电光强调，VS Code 文件树与完备 IA。",
  },
  {
    dir: "saas-gemini-plus-stripe",
    file: "theme-gemini-plus-stripe.css",
    name: "Stripe Dashboard",
    title: "Translunar 工作台 — Stripe Dashboard Edition",
    blurb: "企业级板岩深色侧栏与纯白卡片表面，Stripe 标志性紫蓝强调，层级阴影与完备 IA。",
  },
  {
    dir: "saas-gemini-plus-raycast",
    file: "theme-gemini-plus-raycast.css",
    name: "Raycast Modern HUD",
    title: "Translunar 工作台 — Raycast Modern HUD Edition",
    blurb: "键盘优先深色碳纤维生产力 HUD，暖金琥珀色状态胶囊，极简高效与完备 IA。",
  },

  /* Job B: 4 Awwwards/FWA/CSSDA-grade Artistic Studies */
  {
    dir: "saas-gemini-art-kinetic",
    file: "theme-gemini-art-kinetic.css",
    name: "Cyber-Kinetic HUD",
    title: "Translunar 工作台 — Cyber-Kinetic Tactical HUD",
    blurb: "Awwwards 级别赛博动能战术 HUD，发光霓虹翡翠与青蓝遥测线，脉冲光环与军规级读数。",
  },
  {
    dir: "saas-gemini-art-editorial",
    file: "theme-gemini-art-editorial.css",
    name: "Swiss High Editorial",
    title: "Translunar 工作台 — Swiss High Editorial Luxury",
    blurb: "CSSDA 级别瑞士高级编辑风尚，暖雪花石膏画布与纯黑朱砂红高反差，高定衬线排版。",
  },
  {
    dir: "saas-gemini-art-glass",
    file: "theme-gemini-art-glass.css",
    name: "Spatial Aurora Glass",
    title: "Translunar 工作台 — Spatial Aurora Neo-Glassmorphism",
    blurb: "FWA 级别多层极光毛玻璃拟态，深邃宇宙紫渐变，透光镜面高光与流光气场。",
  },
  {
    dir: "saas-gemini-art-monolith",
    file: "theme-gemini-art-monolith.css",
    name: "Constructivist Monolith",
    title: "Translunar 工作台 — Constructivist Brutalist Monolith",
    blurb: "包豪斯/拉姆斯构成主义粗野巨石，触感混凝土与国际安全橙，重型黑框与机械冲压标牌。",
  },
];

const read = (f) => readFileSync(join(here, f), "utf8");
const base = read("base.css");
const data = read("data.js");
const app = read("app.js");

for (const t of THEMES) {
  const theme = read(t.file);
  const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${t.title}</title>
<meta name="description" content="${t.blurb}">
<style>
/* ===== base.css — structure shared by every visual system ===== */
${base}
/* ===== ${t.file} — this visual system ===== */
${theme}
</style>
</head>
<body>
<div id="root"></div>
<script>
const THEME_NAME = ${JSON.stringify(t.name)};
</script>
<script>
/* ===== data.js — fixtures, identical across systems ===== */
${data}
</script>
<script>
/* ===== app.js — state, dispatcher, markup, keymap ===== */
${app}
</script>
</body>
</html>
`;
  const dir = join(out, t.dir);
  mkdirSync(join(dir, "shots"), { recursive: true });
  writeFileSync(join(dir, "index.html"), html);
  console.log(`${t.dir}/index.html  ${(html.length / 1024).toFixed(0)} KB`);
}

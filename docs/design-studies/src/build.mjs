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
    blurb: "液态玻璃：连续圆角、镜面描边、编辑区与右栏同为厚玻璃。",
  },
  {
    slug: "atelier-light",
    dir: "saas-opus-art-atelier-light",
    family: "saas-opus-art",
    css: ["art-atelier.css", "art-atelier-light.css"],
    js: "art-atelier.js",
    blurb: "白昼画廊：同一字体与交互，灰泥墙与古铜。",
  },
  {
    slug: "phosphor-light",
    dir: "saas-opus-art-phosphor-light",
    family: "saas-opus-art",
    css: ["art-phosphor.css", "art-phosphor-light.css"],
    js: "art-phosphor.js",
    blurb: "日光终端：同一等宽排版，反射式液晶而非发光管。",
  },

  /* Ported from the Fable studies onto this shared IA. The visual systems are
     Fable's — palette, type, geometry, material, motion — restated against the
     Opus variable contract so they run on the same renderer, the same IDE
     tree, the same proofreading chips and the same stacked ribbon as the rest
     of the family. The faces travel with the file. */
  {
    slug: "compact",
    dir: "saas-opus-compact",
    family: "saas-opus",
    css: "theme-compact.css",
    fonts: [
      ["Geist", 400, "Geist-400-normal-latin.woff2"],
      ["Geist", 500, "Geist-500-normal-latin.woff2"],
      ["Geist", 600, "Geist-600-normal-latin.woff2"],
      ["Geist Mono", 400, "GeistMono-400-normal-latin.woff2"],
      ["Geist Mono", 500, "GeistMono-500-normal-latin.woff2"],
    ],
    blurb: "紧凑光亮：12.5px、4px 圆角、发丝线，密度即层级。",
  },
  {
    slug: "comfortable",
    dir: "saas-opus-comfortable",
    family: "saas-opus",
    css: "theme-comfortable.css",
    fonts: [
      ["Figtree", 400, "Figtree-400-normal-latin.woff2"],
      ["Figtree", 500, "Figtree-500-normal-latin.woff2"],
      ["Figtree", 600, "Figtree-600-normal-latin.woff2"],
      ["Spline Sans Mono", 400, "SplineSansMono-400-normal-latin.woff2"],
      ["Spline Sans Mono", 500, "SplineSansMono-500-normal-latin.woff2"],
    ],
    blurb: "舒适光亮：13.5px、胶囊控件、柔和抬升，深青强调。",
  },
  {
    slug: "dark",
    dir: "saas-opus-dark",
    family: "saas-opus",
    css: "theme-dark.css",
    fonts: [
      ["Hanken Grotesk", 400, "HankenGrotesk-400-normal-latin.woff2"],
      ["Hanken Grotesk", 500, "HankenGrotesk-500-normal-latin.woff2"],
      ["Hanken Grotesk", 600, "HankenGrotesk-600-normal-latin.woff2"],
      ["JetBrains Mono", 400, "JetBrainsMono-400-normal-latin.woff2"],
      ["JetBrains Mono", 500, "JetBrainsMono-500-normal-latin.woff2"],
    ],
    blurb: "暗色专注：浮层靠亮度分层而非重投影。",
  },
  {
    slug: "terra",
    dir: "saas-opus-art-terra",
    family: "saas-opus-art",
    css: "art-terra.css",
    fonts: [
      ["Onest", 400, "Onest-400-normal-latin.woff2"],
      ["Onest", 500, "Onest-500-normal-latin.woff2"],
      ["Onest", 600, "Onest-600-normal-latin.woff2"],
      ["Sometype Mono", 400, "SometypeMono-400-normal-latin.woff2"],
      ["Sometype Mono", 500, "SometypeMono-500-normal-latin.woff2"],
    ],
    blurb: "陶土触感：挤出的控件、真实按陷、带回弹的弹簧曲线。",
  },
  {
    slug: "aurora",
    dir: "saas-opus-art-aurora",
    family: "saas-opus-art",
    css: "art-aurora.css",
    js: "art-aurora.js",
    fonts: [
      ["Schibsted Grotesk", 400, "SchibstedGrotesk-400-normal-latin.woff2"],
      ["Schibsted Grotesk", 500, "SchibstedGrotesk-500-normal-latin.woff2"],
      ["Schibsted Grotesk", 700, "SchibstedGrotesk-700-normal-latin.woff2"],
      ["DM Mono", 400, "DMMono-400-normal-latin.woff2"],
      ["DM Mono", 500, "DMMono-500-normal-latin.woff2"],
    ],
    blurb: "极光玻璃：漂移光场之上一整片磨砂，面板靠透明度分层。",
  },
  {
    slug: "blueprint",
    dir: "saas-opus-art-blueprint",
    family: "saas-opus-art",
    css: "art-blueprint.css",
    fonts: [
      ["Bricolage Grotesque", 400, "BricolageGrotesque-400-normal-latin.woff2"],
      ["Bricolage Grotesque", 500, "BricolageGrotesque-500-normal-latin.woff2"],
      ["Bricolage Grotesque", 600, "BricolageGrotesque-600-normal-latin.woff2"],
      ["Martian Mono", 400, "MartianMono-400-normal-latin.woff2"],
      ["Martian Mono", 500, "MartianMono-500-normal-latin.woff2"],
    ],
    blurb: "蓝晒制图：双层坐标网格、针管笔线、虚线焦点环。",
  },
  {
    slug: "acid",
    dir: "saas-opus-art-acid",
    family: "saas-opus-art",
    css: "art-acid.css",
    fonts: [
      ["Familjen Grotesk", 400, "FamiljenGrotesk-400-normal-latin.woff2"],
      ["Familjen Grotesk", 500, "FamiljenGrotesk-500-normal-latin.woff2"],
      ["Familjen Grotesk", 700, "FamiljenGrotesk-700-normal-latin.woff2"],
      ["Unbounded", 500, "Unbounded-500-normal-latin.woff2"],
      ["Unbounded", 700, "Unbounded-700-normal-latin.woff2"],
      ["Space Mono", 400, "SpaceMono-400-normal-latin.woff2"],
      ["Space Mono", 700, "SpaceMono-700-normal-latin.woff2"],
    ],
    blurb: "画廊酸性：零圆角、硬线描边、硬偏移投影，克莱因蓝担全部动作。",
  },
];

const read = (f) => readFileSync(join(here, f), "utf8");
const base = read("base.css");
const data = read("data.js");
const app = read("app.js");

/* Type is not decoration on these studies, it is half the visual system, so
   the faces travel with the file rather than being approximated by whatever
   the reviewer happens to have installed. Only the latin subset is inlined —
   CJK falls through to the system stack, which is what the originals did. */
const fontDir = join(here, "..", "fonts");
function faces(list) {
  if (!list || !list.length) return "";
  return list
    .map(([family, weight, file]) => {
      const path = join(fontDir, file);
      if (!existsSync(path)) throw new Error(`missing font ${file}`);
      const b64 = readFileSync(path).toString("base64");
      return `@font-face{font-family:"${family}";font-style:normal;font-weight:${weight};font-display:swap;src:url(data:font/woff2;base64,${b64}) format("woff2")}`;
    })
    .join("\n");
}

for (const s of STUDIES) {
  /* A study may be a base sheet plus an override layer. The light siblings
     are built that way on purpose: whatever they do not restate, they
     inherit, so type, spacing and interaction cannot drift from the study
     they are a sibling of. */
  const sheets = Array.isArray(s.css) ? s.css : [s.css];
  const theme = sheets.map((f) => `/* --- ${f} --- */\n${read(f)}`).join("\n");
  const artJs = s.js && existsSync(join(here, s.js)) ? read(s.js) : null;
  const fontCss = faces(s.fonts);
  const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Translunar 工作台 — ${s.family} / ${s.slug}</title>
<meta name="description" content="${s.blurb}">
<style>
${fontCss ? `/* ===== bundled faces for this visual system ===== */\n${fontCss}\n` : ""}/* ===== base.css — structure shared by every visual system ===== */
${base}
/* ===== ${sheets.join(" + ")} — this visual system ===== */
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

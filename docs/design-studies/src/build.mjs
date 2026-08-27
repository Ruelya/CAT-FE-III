/* Composes one self-contained index.html per visual system.
   Everything is inlined so a study can be opened straight from disk with no
   server, no build step and no network. */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "..");

const THEMES = [
  {
    id: "quarry",
    name: "quarry",
    title: "Translunar 工作台 — saas-opus / quarry",
    blurb: "温石中性色，最宽松的密度，发丝线分隔。",
  },
  {
    id: "cobalt",
    name: "cobalt",
    title: "Translunar 工作台 — saas-opus / cobalt",
    blurb: "深色控制台，靠表面层级分隔，蓝色只表示「你在哪」。",
  },
  {
    id: "ledger",
    name: "ledger",
    title: "Translunar 工作台 — saas-opus / ledger",
    blurb: "无彩瑞士数据表，最紧密度，颜色只表示状态。",
  },
];

const read = (f) => readFileSync(join(here, f), "utf8");
const base = read("base.css");
const data = read("data.js");
const app = read("app.js");

for (const t of THEMES) {
  const theme = read(`theme-${t.id}.css`);
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
/* ===== theme-${t.id}.css — this visual system ===== */
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
  const dir = join(out, `saas-opus-${t.id}`);
  mkdirSync(join(dir, "shots"), { recursive: true });
  writeFileSync(join(dir, "index.html"), html);
  console.log(`saas-opus-${t.id}/index.html  ${(html.length / 1024).toFixed(0)} KB`);
}

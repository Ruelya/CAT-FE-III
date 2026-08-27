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
    id: "aperture",
    name: "aperture",
    title: "Translunar 工作台 — saas-gpt-plus / aperture",
    blurb: "冷白工作室、蓝色焦点与紧凑分层，适合高频翻译。",
  },
  {
    id: "moss",
    name: "moss",
    title: "Translunar 工作台 — saas-gpt-plus / moss",
    blurb: "暖纸底、苔绿焦点与低眩光表面，适合长时工作。",
  },
  {
    id: "orbit",
    name: "orbit",
    title: "Translunar 工作台 — saas-gpt-plus / orbit",
    blurb: "石墨深色控制台、青蓝焦点与清晰状态分层。",
  },
  {
    id: "prism",
    name: "prism",
    title: "Translunar 工作台 — saas-gpt-plus / prism",
    blurb: "柔雾紫灰表面、靛蓝焦点与克制的半透明层次。",
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
  const dir = join(out, `saas-gpt-plus-${t.id}`);
  mkdirSync(join(dir, "shots"), { recursive: true });
  writeFileSync(join(dir, "index.html"), html);
  console.log(`saas-gpt-plus-${t.id}/index.html  ${(html.length / 1024).toFixed(0)} KB`);
}

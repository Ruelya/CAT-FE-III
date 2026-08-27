# saas-opus — full-fidelity Workbench prototypes

Three Modern SaaS visual systems for the Translunar CAT Workbench, built for
visual selection. They share one information architecture, byte for byte: the
same fixtures, the same renderer, the same keymap. Only the stylesheet differs,
so a preference expressed here is a preference about visual language and
nothing else.

| Study | Open |
| --- | --- |
| quarry — warm stone, most generous | [`saas-opus-quarry/index.html`](saas-opus-quarry/index.html) |
| cobalt — dark console, medium density | [`saas-opus-cobalt/index.html`](saas-opus-cobalt/index.html) |
| ledger — achromatic Swiss data sheet, densest | [`saas-opus-ledger/index.html`](saas-opus-ledger/index.html) |

Each `index.html` is self-contained — no server, no build step, no network.
Open it from disk and click.

Feature coverage is catalogued in [`FEATURE-INVENTORY.md`](FEATURE-INVENTORY.md),
which was written from the shipped source on `cursor/gf-workbench-s3d-2398`
(`WorkbenchView`, `SegmentGrid`, `Ribbon`, `FindWidget`, `PreviewPane`,
`TmPanel`, `TermPanel`, `QaPanel`, `AiPanel`, `TmManageDialog`,
`ProjectSettingsDialog`, `CommandPalette`, the projects view, the status bar
and the engine gate).

## Design read

### quarry — the long shift

Warm stone neutrals, deep pine accent, Source Sans 3, the widest density of the
three (36px rows, 13.5px text).

The premise is that a translator sits in this window for six hours, so the
window should behave like paper rather than like software. Every neutral carries
a yellow cast, which leaves cool colour unused by the chrome and therefore free
to mean something: the only blue-green things on screen are a state chip, a
match score, or the accent on the row you are in. Separation is done entirely
with hairlines and air — `--shadow-1` is `none`, so no card floats and there is
no false depth to read past. Section headings are set as words at 11.5px/650
rather than as tracked-out capitals, because in a Chinese UI tracked capitals
buy nothing and cost legibility.

Pick quarry if the room is bright and sessions are long.

### cobalt — the focused console

Near-black blue-cast surfaces, one electric blue accent, Public Sans, medium
density (30px rows, 12.5px text), 6px radii.

Four docks, a ribbon, a grid and a preview is a lot of edges. Cobalt removes
most of them: panels separate by stepping the surface (`#12161d` → `#161b23` →
`#1c222c`) instead of by drawing a line, so a fully populated screen shows a
handful of visible borders rather than dozens. That budget is then spent on the
one thing worth an edge — the active row, which gets a 2px accent marker and a
wash that fades out to the right so the marker stays the loudest thing in the
viewport. Blue is reserved for "where you are" and for the primary action;
green, amber and red are states and never decoration. Overlays are lifted with
a real shadow plus a 1px lit top edge, the only place in the system where
depth is used.

Pick cobalt if the work happens at night, or next to a dark editor.

### ledger — the data sheet

Strictly grey neutrals, ink-black accent, Nimbus Sans, the densest of the three
(26px rows, 12px text), zero radius anywhere, ink chrome top and bottom.

Ledger takes one rule seriously: **hue is a state channel, not a style
channel.** The entire interface — chrome, surfaces, borders, buttons, selected
rows, the command palette — is achromatic, and the accent is ink black. That
leaves green, amber, red and blue doing nothing except reporting segment state,
QA severity, and placeholder tokens. A coloured pixel in the corner of your eye
always means something, which is exactly the property you want when you are
scanning 118 rows for the four that are wrong.

The grid is ruled in both directions and the header sits under a 2px black
rule, because it is a table and pretending otherwise helps no one. The active
row inverts its ordinal cell to solid black. Black chrome above and below frames
the white sheet so the document, not the application, reads as the subject.

Pick ledger if the job is review and QA at volume.

## What every study contains

Identical in all three. The eight scenarios in the top bar reset state, so any
of them can be entered directly, or by URL: `index.html?scene=qa`.

- **Shell** — 文件/编辑/视图/项目/翻译/QA/帮助 menus with shortcut hints;
  ribbon verbs 撤销 重做 导入 导出 确认 锁定 插入记忆 插入术语 预翻译 查找
  查找下一个 替换 检索 运行 QA 预览 命令搜索; `Ctrl+K` palette over commands,
  dock jumps and documents; status bar with progress meter, 字数, clickable
  草稿/QA jumps, 行列, INS and engine identity.
- **Left** — project, language pair, aggregate and per-document progress, file
  search, document list with arm-then-confirm removal, document tabs, seven
  closable filter chips (未译 草稿 已确认 QA 锁定 有术语 有标签), import
  affordance, project details.
- **Centre** — grid of `# / 源文 / 译文 / 状态`, where 状态 carries the state
  chip, the open-QA count, the lock glyph and the origin chip (`100 TM`,
  `95 TM`, `AI`, and a struck-through muted chip once a match has been
  edited); placeholder tokens are lexed and highlighted, and turn red when a
  finding says one is missing. Row menu: 复制源文 · 清空译文 · 锁定 · 确认句段.
  Find/replace on `Ctrl+F` / `Ctrl+H` with 含已确认, an `n/total 段` counter and
  `F4` / `Shift+F4`. The three confirm variants are on `Ctrl+Enter`,
  `Ctrl+Alt+Enter` and `Ctrl+Alt+Shift+Enter`, labelled in the 翻译 menu.
- **Right, four docks** — 记忆 (scored matches with the owning memory name,
  `Ctrl+1…9`, apply-as-draft, plus concordance over the document and the
  project TM), 术语 (hits with 首选/禁用 tags, forbidden entries not
  insertable, quick add), QA (grouped by rule, evidence, 修复为 + 应用修复,
  and 忽略 / 忽略同类 / 忽略本句 / 恢复为未解决), AI (short-label provider
  form, 辅助 with a candidate diff, Agent run with a step log including a
  failure, and an explicit human review gate; an unconfigured provider says so).
- **Bottom** — collapsible preview with 校对视图 and 版式视图（DOCX）, and
  click-to-jump back to the segment.
- **Dialogs** — 新建项目, 导入（句/段/SRX）, 项目设置 (信息 · 导入默认 ·
  质量检查 with 有错误时阻止导出 · 生命周期/归档 · 翻译记忆 with explicit
  import/export target selection · 术语库), 记忆库管理 (挂载 启用 可写 重命名
  卸载 删除 with the engine's cascade-delete refusal), 术语库管理, 导出覆盖,
  导出 QA 门 (仍要导出 / 取消), 引擎闸门.

## Scenarios

| id | 场景 | shows |
| --- | --- | --- |
| `projects` | 空项目列表 | no project open: menus degrade, ribbon hidden, minimal status bar |
| `grid` | 导入后的网格 | working state, memory dock, editor mounted on #10 |
| `confirmed` | 确认写入 TM | #10 confirmed, origin becomes `100 TM`, propagation reported |
| `locked` | 锁定句段 | #11 read-only, no editor, confirm refused |
| `qa` | 模糊未改 QA | QA filter chip on, `qa.unedited-fuzzy` on a 95% match |
| `ai` | AI 未配置 | provider form, agent disabled, honest 未配置 |
| `agent` | Agent 待审核 | run summary, step log with one failure, human gate |
| `gate` | 导出 QA 门 | export blocked, failing rules named |

## Rebuilding

```sh
cd docs/design-studies
node src/build.mjs                       # src/* -> saas-opus-*/index.html

export PW=$(npm root -g)/playwright/index.mjs
node src/shots.mjs                       # 24 states x 3 systems -> /tmp/opus-shots
node src/walk.mjs                        # walkthrough recordings -> /tmp/opus-video
```

`src/shots.mjs` doubles as the smoke test: it drives every scenario and dialog
through real clicks and fails the run on any console error, page exception, or
missing shell region.

Sources: `src/data.js` (fixtures), `src/app.js` (state, dispatcher, markup,
keymap), `src/base.css` (structure and the variable contract),
`src/theme-*.css` (one visual system each).

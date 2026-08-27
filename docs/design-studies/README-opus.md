# saas-opus — full-fidelity Workbench prototypes

Sixteen visual systems for the Translunar CAT Workbench, built for visual
selection. They share one information architecture, byte for byte: the same
fixtures, the same renderer, the same keymap, the same twenty-six reachable
states. Only the stylesheet differs — plus, for the art studies, one small
script that owns material living outside the app root. A preference expressed
here is therefore a preference about visual language and nothing else.

**Modern SaaS** — quiet chrome, one system, high clarity.

| Study                                         | Open                                                                 |
| --------------------------------------------- | -------------------------------------------------------------------- |
| compact — cool gray, indigo, densest of all   | [`saas-opus-compact/index.html`](saas-opus-compact/index.html)       |
| comfortable — air and capsules, deep teal     | [`saas-opus-comfortable/index.html`](saas-opus-comfortable/index.html) |
| dark — blue-cast dark, separation by luminance | [`saas-opus-dark/index.html`](saas-opus-dark/index.html)             |
| quarry — warm stone, most generous            | [`saas-opus-quarry/index.html`](saas-opus-quarry/index.html)         |
| cobalt — dark console, medium density         | [`saas-opus-cobalt/index.html`](saas-opus-cobalt/index.html)         |
| ledger — achromatic Swiss data sheet, densest | [`saas-opus-ledger/index.html`](saas-opus-ledger/index.html)         |

**Art** — the browser as a material, at the same feature depth.

| Study          | Material                                 | Open                                                                                 |
| -------------- | ---------------------------------------- | ------------------------------------------------------------------------------------ |
| terra          | thumbed clay on a mineral bench          | [`saas-opus-art-terra/index.html`](saas-opus-art-terra/index.html)                   |
| aurora         | frosted glass over a drifting light field | [`saas-opus-art-aurora/index.html`](saas-opus-art-aurora/index.html)                 |
| blueprint      | white line on Prussian blue paper        | [`saas-opus-art-blueprint/index.html`](saas-opus-art-blueprint/index.html)           |
| acid           | hard black line on gallery off-white     | [`saas-opus-art-acid/index.html`](saas-opus-art-acid/index.html)                     |
| riso           | two-ink risograph on newsprint           | [`saas-opus-art-riso/index.html`](saas-opus-art-riso/index.html)                     |
| atelier        | night gallery, serif and brass           | [`saas-opus-art-atelier/index.html`](saas-opus-art-atelier/index.html)               |
| phosphor       | CRT tube, all-monospace                  | [`saas-opus-art-phosphor/index.html`](saas-opus-art-phosphor/index.html)             |
| vitrine        | liquid glass over a drifting light field | [`saas-opus-art-vitrine/index.html`](saas-opus-art-vitrine/index.html)               |
| atelier-light  | the same gallery in daylight             | [`saas-opus-art-atelier-light/index.html`](saas-opus-art-atelier-light/index.html)   |
| phosphor-light | the same terminal, reflective            | [`saas-opus-art-phosphor-light/index.html`](saas-opus-art-phosphor-light/index.html) |

`compact`, `comfortable`, `dark`, `terra`, `aurora`, `blueprint` and `acid` are
the visual systems of the Fable studies, moved onto this base. Their palettes,
type, radii, motion curves and material rules are Fable's; their markup,
fixtures, keymap, file tree, proofreading chips, stacked ribbon and dialog set
are this family's, so all sixteen studies are the same prototype wearing
sixteen skins. Fable's own `saas-shared` base is not carried over.

The two light studies are built as override layers: `art-atelier-light.css`
loads after `art-atelier.css` and restates only what the change of light
requires. Type, spacing, motion and every interaction are inherited, so a
sibling pair cannot drift apart.

Each `index.html` is self-contained — no server, no build step, no network.
Open it from disk and click.

Feature coverage is catalogued in [`FEATURE-INVENTORY.md`](FEATURE-INVENTORY.md),
which was written from the shipped source on `cursor/gf-workbench-s3d-2398`
(`WorkbenchView`, `SegmentGrid`, `Ribbon`, `FindWidget`, `PreviewPane`,
`TmPanel`, `TermPanel`, `QaPanel`, `AiPanel`, `TmManageDialog`,
`ProjectSettingsDialog`, `CommandPalette`, the projects view, the status bar
and the engine gate).

## Design read

### compact — density as hierarchy

Cool gray scale, one calibrated indigo, Geist over Geist Mono at 12.5px, 30px
rows, 4px radii, almost no shadow.

The argument is that a dense tool does not need colour or elevation to be
readable — it needs the gray scale to be honest and the weights to be few.
Nothing floats; separation is a hairline, and the only saturated thing on
screen is the state you are in. It fits the most rows of any study here, which
is the point: a reviewer scanning three hundred segments should see them.

### comfortable — the same system with air

Neutral gray with a cool-green cast, deep teal accent, Figtree over Spline Sans
Mono at 13.5px, 38px rows, 7–12px radii, soft shadows.

Where compact argues with density, this one argues with room. Surfaces lift by
a real shadow rather than a rule, badges and filter chips are capsules, and the
dock tabs read as a segmented control. It is the study to pick if the reader is
working on a laptop panel rather than a 27-inch monitor.

### dark — separation by luminance

Blue-cast dark grays, Hanken Grotesk over JetBrains Mono at 13px, 6px radii.

The rule that makes a dark UI work is stated here and then obeyed everywhere: a
float is _lighter_ than the panel behind it, never a glow around it. Borders
stay crisp instead of dissolving, so a dialog over a panel over the desk is
three legible planes rather than one dark blur with halos.

### terra — thumbed clay

Mineral gray-green bench, terracotta accent, Onest over Sometype Mono, 14px
radii, motion on a spring with a small overshoot.

Every control is extruded: a highlight along the top edge, an earth-coloured
shadow beneath, and a real inset when pressed. Because the accent is a warm
earth red, QA's rose has to be kept away from it, and it is — the danger colour
sits several steps cooler so a failing rule never reads as a primary action.
This is the product's default theme.

### aurora — frosted glass

A low-resolution light field drifts behind the window and the whole workbench is
one sheet of frosted glass over it. Schibsted Grotesk over DM Mono, one mint
accent, a focus ring that glows.

Panels separate by transparency rather than by fill, and a float is a second
layer of glass on the first. The field is the study's signature and also the
first thing a tired reader would turn off, which is why in the product it is a
switch (`fx.ambient`) rather than a fact.

### blueprint — the drawing

White line on Prussian blue paper. Bricolage Grotesque over Martian Mono at
12.5px, 2px radii — a technical pen does not round corners.

The ground is a two-layer coordinate grid, 6px fine under 30px coarse, and the
panels are zones drawn on that one sheet rather than objects sitting on top of
it: every surface is the paper at a different transparency. Headings are drawing
titles, tracked-out caps anchored to a leader tick, and focus is a dashed
construction line instead of a glow.

### acid — hard line

Black 1.5px stroke on gallery off-white, hard offset shadows that do not blur,
every radius zero. Familjen Grotesk over Space Mono, panel titles in Unbounded.

International Klein blue carries the whole active action; acid yellow-green
appears only as selection and search hit, never as decoration. Motion is the
layout's physics — a control displaces a pixel on hover and its shadow follows,
then it presses back in on click.

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

### riso — the proof sheet

Newsprint cream, federal blue and fluorescent orange-red, URW Gothic set as
poster type over Public Sans, hard offset shadows, zero radius anywhere.

The premise is that this is a proof pulled off a duplicator, so nothing on
screen is brighter than the sheet it is printed on. The paper is real: a fibre
tile is generated at load and multiplied over the whole window, so every ink
sits _in_ the stock instead of glowing out of a backlight. There is no such
thing as a flat fill — every tinted surface carries a staggered 45° dot screen
at 4px, which is why a chip reads as printed rather than as painted.

Two drums, two jobs. Ink A (blue) carries structure and text. Ink B (orange)
carries **the live and the counted**: the segment ordinal column, the progress
readouts, the status bar numerals, the active row, every selected filter chip
and every primary action. Because the second ink appears nowhere else, the
whole sheet answers "where am I and how far in" without a legend. The active
row is the second pull, deliberately one pixel out of register on the source
cell — misregistration as a state, which is the only honest way to use it.
Registration targets sit in the trim at the bottom corners.

Pick riso if the studio wants the tool to have a graphic voice.

### atelier — the night gallery

Warm charcoal walls, ivory setting, brass fittings. P052 for display and C059
for text, so the Latin runs serif and reads as caption matter around the
Chinese. 34px rows, long easings.

Material here is pressed and struck rather than printed. Inputs are debossed
into the wall — an inner shadow with a lit edge underneath — and anything
raised carries the reverse. Every horizontal rule is a fillet: a dark line with
a 7%-white edge below it, which is what a moulding does in a lit room.

The room has one light source and it is the pointer. A script publishes the
cursor as `--mx/--my`, eased rather than snapped, and the wall wash plus the
specular band on every brass surface point at it. Move across the window and
different fittings catch the light; hold still and the room settles. The work
itself is matted and framed — the grid sits on a plate held off the wall by a
brass fillet and a long shadow, the way a print hangs. Ornament is rationed to
exactly one lozenge, centred on the dialog head rule.

Pick atelier if the work is precious and the room is dark.

### phosphor — the tube

Near-black glass, pale green-white emission, an amber gun for "you are here"
and a cyan gun for reference. Everything is monospaced, Chinese included, so
source and target land on one cell grid. 30px rows, `steps()` easing.

Nothing here is printed or lit from behind; it is emitted. Glyphs bleed into
the glass, scanlines multiply across the window, and a refresh bar rolls down
the tube on a 7.5-second period. A noise field redraws at 12fps from baked
tiles — never per-frame, and at 5% over a screen blend, because this has to
read as a tube under load and not as texture over the text. Roughly every
seventy frames the raster tears once and recovers.

Convergence is the state channel. The row you are working splits into red and
cyan the way a mistuned gun does, and its ordinal cell grows a blinking caret
block — so the live line is identifiable from across the room without a single
extra pixel of chrome. Panels are drawn in cyan hairlines rather than filled,
and glow is capped below the legibility threshold throughout: the tube is the
effect, the text is the product.

Pick phosphor if the operator wants the machine to feel like a machine.

### vitrine — liquid glass

Ice daylight, a deep teal accent, one warm rim. Inter pushed to its optical
extremes — 9.5px labels at 0.19em against headings at −0.026em. 15px radii,
long settle easings.

A cold light field drifts behind the window on a canvas: five soft sources on
mutually prime periods, parallaxed against the pointer by depth, so the widest
source moves least. It is drawn at an eighth resolution and blown back up,
which is both cheap and exactly the softness wanted, because every pane in
front of it is frosted anyway.

**One material, four densities.** Everything in front of the field is the same
glass and differs only in how much light it holds back: `0.30` for window
furniture, `0.34` for the two rails, `0.50` for dock cards and ribbon
lozenges, `0.74` for the reading sheet. Depth is density, never a different
substance — there is no opaque slab anywhere in the composition, and nothing
so transparent that the field moves under running text. Every pane carries the
same specular signature (a bright top stroke, a dimmer bottom one, a hairline
ring, a shadow that proves the gap), and radii are concentric, so nested
corners stay parallel.

The editor and the right dock are full participants: the segment sheet is
thick glass rather than a white card, the dock cards are one density thinner
than the sheet, and the sub-bars inside a pane are not filled again — they are
the same pane, separated by a hairline. Controls lift a glass lozenge under
the pointer instead of painting a rectangle; inputs are the one place the
material is pushed in rather than out.

Readability is measured, not asserted. Secondary and tertiary text were
darkened until the worst case across all six pane densities cleared AA for
small text — 6.2:1 for `--text-muted` and 4.3:1 for `--text-faint` on the
thinnest chrome, 8.2:1 and 5.7:1 on the reading sheet. The light field was
pulled to one cool family with a single warm rim so state colour reads as part
of the glass rather than as stickers on top of it.

Pick vitrine if the product wants to look like light.

### atelier-light — the day gallery

The same room with the shutters open. Every decision that gives atelier its
character is inherited unchanged — P052 display serif over C059, the pressed
metal, the plate framing the work area, the light that tracks the pointer.
Only the physics of the light change: plaster walls instead of charcoal,
antique brass instead of lit brass, and a sun patch rather than a lamp, so
corners fall into shade instead of into black. Debossing inverts to a grey
inset with a white lip below it, which is what pressed material looks like
from above rather than from within.

Pick atelier-light if the gallery is right but the room should be a daytime
one.

### phosphor-light — the daylight terminal

A reflective panel instead of an emissive tube: the same all-monospace
setting, the same zero radii, the same caret block, convergence split and
tear. What inverts is the physics. Glow becomes ghosting — ink bleeds a little
into the glass rather than out of it. The scanline comb multiplies down
instead of screening up, the refresh pass reads as a shadow crossing the
panel, and the grain layer flips blend mode from the sheet (`--crt-noise-blend`),
so the art layer is shared with the dark sibling rather than forked. The amber
gun becomes ochre, which is the same signal absorbed rather than emitted.

Pick phosphor-light if the machine feeling is right but the room has windows.

## What every study contains

Identical in all three. The eight scenarios in the top bar reset state, so any
of them can be entered directly, or by URL: `index.html?scene=qa`.

- **Shell** — 文件/编辑/视图/项目/翻译/QA/帮助 menus with shortcut hints;
  ribbon verbs 撤销 重做 导入 导出 确认 锁定 插入记忆 插入术语 预翻译 查找
  查找下一个 替换 检索 运行 QA 预览 命令搜索; `Ctrl+K` palette over commands,
  dock jumps and documents; status bar with progress meter, 字数, clickable
  草稿/QA jumps, 行列, INS and engine identity.

  The ribbon is a shared **layout** and nothing else: the icon sits above its
  label, and the verbs divide into four groups — 历史, 文档, 翻译, 审校 —
  separated by vertical rules and named underneath. Colour is not shared. Each
  study paints the toolbar from its own tokens, and 确认 is simply the check
  action in that study's accent or ink: pine in quarry, blue in cobalt, ink
  black in ledger, Ink B orange in riso, brass in atelier, amber in phosphor,
  teal in vitrine, antique brass in atelier-light, ochre in phosphor-light.
  `shots.mjs` asserts the layout per study and then fails the run if any two
  studies land on the same ribbon background or the same colour for 确认, so a
  single colorway cannot be forced across systems that exist to differ.

- **Left** — project, language pair, aggregate progress, file search, an
  **IDE file tree**, document tabs, seven closable filter chips (未译 草稿
  已确认 QA 锁定 有术语 有标签), import affordance, project details.
  The tree nests six documents under `docs/guides`, `docs`, `reference`,
  `ui/strings` and `legal`: folders sort before files, chevrons expand and
  collapse, one indent guide is drawn per ancestor level, icons follow the
  format (`docx` / `md` / `json`), a folder rolls up its descendants' file
  count and open-QA count, a file shows its confirmed percentage over a fill
  line, the open tab and the active file are marked separately, and removal is
  still arm-then-confirm on hover. Search matches the whole path and forces
  every folder open, so a hit is never hidden behind a collapsed chevron.
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
  click-to-jump back to the segment. 校对视图 states segment status as
  **colour, not decoration**: every segment is a filled rounded chip and a
  paragraph is a wrapping row of them, so the shape of the document survives
  while every boundary and every state stays legible without being read.
  Four fills — 已确认, 草稿, 锁定, and 未译 (which carries the source, muted,
  behind a dashed edge) — plus the active chip, which drops to the pane colour
  and takes a solid accent outline. Nothing underlines and nothing strikes
  through. Studies retint by restating the `--pv-*` contract on `:root`;
  `shots.mjs` fails the run if a study leaves two states the same colour or
  lets a line decoration back onto a chip.
- **Dialogs** — 新建项目, 导入（句/段/SRX）, 项目设置 (信息 · 导入默认 ·
  质量检查 with 有错误时阻止导出 · 生命周期/归档 · 翻译记忆 with explicit
  import/export target selection · 术语库), 记忆库管理 (挂载 启用 可写 重命名
  卸载 删除 with the engine's cascade-delete refusal), 术语库管理, 导出覆盖,
  导出 QA 门 (仍要导出 / 取消), 引擎闸门.

## Scenarios

| id          | 场景         | shows                                                             |
| ----------- | ------------ | ----------------------------------------------------------------- |
| `projects`  | 空项目列表   | no project open: menus degrade, ribbon hidden, minimal status bar |
| `grid`      | 导入后的网格 | working state, memory dock, editor mounted on #10                 |
| `confirmed` | 确认写入 TM  | #10 confirmed, origin becomes `100 TM`, propagation reported      |
| `locked`    | 锁定句段     | #11 read-only, no editor, confirm refused                         |
| `qa`        | 模糊未改 QA  | QA filter chip on, `qa.unedited-fuzzy` on a 95% match             |
| `ai`        | AI 未配置    | provider form, agent disabled, honest 未配置                      |
| `agent`     | Agent 待审核 | run summary, step log with one failure, human gate                |
| `gate`      | 导出 QA 门   | export blocked, failing rules named                               |

Scenario switches also reset the tree: `legal` collapsed, search cleared,
`onboarding-guide.docx` active.

## Rebuilding

```sh
cd docs/design-studies
node src/build.mjs                       # src/* -> saas-opus-*/index.html

export PW=$(npm root -g)/playwright/index.mjs
node src/shots.mjs                       # 27 states x 16 systems -> /tmp/opus-shots
node src/walk.mjs                        # walkthrough recordings  -> /tmp/opus-video
bash src/publish.sh                      # -> <study>/shots + /opt/cursor/artifacts

node src/emit-themes.mjs                 # :root -> packages/ui/src/themes/*.css
```

`src/shots.mjs` doubles as the smoke test: it drives every scenario and dialog
through real clicks and fails the run on any console error, page exception,
missing shell region, a file tree that has lost its nesting, its chevrons or
its active-file marker, a proofreading view whose four segment states do not
resolve to four distinct fills, a ribbon that has stopped stacking its icons
over its labels or lost its group rules, or two studies that have converged on
the same ribbon paint.

Sources: `src/data.js` (fixtures), `src/app.js` (state, dispatcher, markup,
keymap), `src/base.css` (structure and the variable contract),
`src/theme-*.css` and `src/art-*.css` (one visual system each), `src/art-*.js`
(art layers).

A study's `css` field in `src/build.mjs` may be a list, in which case the
sheets are concatenated in order. That is how the light siblings are built —
`["art-atelier.css", "art-atelier-light.css"]` — so an override layer states
only its difference and inherits everything else by construction.

An art layer is a plain script appended after `app.js`. It may only touch
`<body>` and `<html>` — never `#root`, which the renderer replaces wholesale on
every state change. That constraint is what lets grain, noise and light survive
a keystroke. Overlay entrance animations are latched in `app.js` (`entering()`)
so they play when a surface appears rather than on every re-render, and every
study honours `prefers-reduced-motion`.

## In the product

All sixteen ship in the Electron app. A theme is three things there:

- **Tokens** — `packages/ui/src/themes/<id>.css`, generated from the study's
  `:root` by `src/emit-themes.mjs`. A palette can only be wrong in one place.
- **Material** — `packages/ui/src/theme-surfaces.css`, hand-written, keyed on
  `[data-theme]`. Clay pressing, blueprint's leader ticks, acid's offset
  shadows, glass, ledger's black masthead, the terminal's monospace: things
  that target product class names the studies do not have.
- **Effects** — `packages/ui/src/fx.css`, keyed on `[data-fx-*]`. Scanlines and
  the refresh roll, paper fibre and the coordinate grid, the drifting field.

`packages/ui/src/theme.ts` is the registry: id, label, group, `color-scheme`,
and which effects the theme ships on. `apps/desktop/src/renderer/lib/theme.tsx`
is the single writer of `data-theme` and `data-fx-*` on `<html>`, backed by a
module store so any component can read the theme without a provider.

The reader switches theme from the status bar (主题), from 命令搜索, or from
外观 (`AppearanceDialog`). The choice and every effect override persist in
`localStorage`; overrides are stored per theme, so silencing phosphor's
scanlines does not silence atelier's grain. `prefers-reduced-motion` suppresses
the drifting field without discarding the stored choice.

The default is `terra`.

`apps/desktop/tests/e2e/themes.spec.ts` holds the contract: terra on a first
launch, sixteen workbenches that do not converge on the same paint, an effect
switched off that stays off after a theme round-trip, and a choice that
survives a restart. `theme-gallery.spec.ts` in the same folder captures one
screenshot per theme into `app-themes/`.

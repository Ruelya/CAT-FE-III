# Workbench Feature Inventory

Source of truth: `apps/desktop` at `cursor/gf-workbench-s3d-2398`. Every row below was
read out of the shipped code, not out of a PRD. Anything a prototype adds beyond the
shipped surface is marked **(proposed)** so a prototype can never be mistaken for
landed behaviour.

Files read: `App.tsx`, `views/WorkbenchView.tsx`, `views/ProjectsView.tsx`,
`main/menu-template.ts`, `shared/desktop-api.ts`, `lib/segment-filter.ts`,
`components/{Ribbon,SegmentGrid,TokenText,FindWidget,PreviewPane,TmPanel,ConcordancePanel,TermPanel,QaPanel,AiPanel,AgentPanel,CommandPalette,ImportDocumentDialog,ProjectSettingsDialog,TmManageDialog,TermManagePanel,ExportOverwriteConfirm,ExportQaGateConfirm,EngineGate,Splitter}.tsx`.

---

## 1. Application menu (`main/menu-template.ts`)

Accelerator ownership matters: chords marked *renderer* are displayed by the menu but
registered with `registerAccelerator: false`, so the raw key event reaches the renderer
keymap. Everything else is owned by the menu.

| Menu | Item | Command | Accelerator | Owner | Enabled when |
| --- | --- | --- | --- | --- | --- |
| 文件 | 导入文档… | `import-document` | Ctrl+O | menu | project open |
| 文件 | 导出译文… | `export-document` | Ctrl+E | menu | document open |
| 文件 | 项目设置… | `open-project-settings` | Ctrl+, | menu | project open |
| 文件 | 返回项目列表 | `close-project` | — | menu | project open |
| 文件 | 退出 | role `quit` | — | menu | always (non-mac) |
| 编辑 | 撤销 / 重做 | roles `undo` / `redo` | Ctrl+Z / Ctrl+Y | menu | always |
| 编辑 | 剪切 / 复制 / 粘贴 / 全选 | roles | standard | menu | always |
| 编辑 | 确认当前句段 | `confirm-segment` | Ctrl+Enter | renderer | document open |
| 编辑 | 确认并到下一句段 | `confirm-segment-any` | Ctrl+Alt+Enter | renderer | document open |
| 编辑 | 确认并停留 | `confirm-segment-stay` | Ctrl+Alt+Shift+Enter | renderer | document open |
| 编辑 | 锁定/解锁句段 | `toggle-lock-segment` | Ctrl+L | menu | document open |
| 视图 | 命令面板 | `open-command-palette` | Ctrl+Shift+P (Ctrl+K synonym) | renderer | project open |
| 视图 | 预览面板 | `toggle-preview` | Ctrl+P | menu | document open |
| 视图 | 记忆面板 | `show-dock-memory` | Ctrl+1 | renderer | project open |
| 视图 | 术语面板 | `show-dock-term` | Ctrl+2 | renderer | project open |
| 视图 | QA 面板 | `show-dock-qa` | Ctrl+3 | renderer | project open |
| 视图 | AI 面板 | `show-dock-ai` | Ctrl+4 | renderer | project open |
| 视图 | 实际大小 / 放大 / 缩小 / 切换全屏 | roles | standard | menu | always |
| 导航 | 查找… | `open-find` | Ctrl+F | renderer | document open |
| 导航 | 替换… | `open-replace` | Ctrl+H | renderer | document open |
| 导航 | 查找下一个 | `find-next` | F4 | renderer | document open |
| 导航 | 查找上一个 | `find-prev` | Shift+F4 | renderer | document open |
| 导航 | 筛选句段 | `focus-filter` | Ctrl+Shift+F | renderer | document open |
| 导航 | 检索（取选中文本） | `open-concordance` | F3 | renderer | project open |
| 帮助 | 重新加载窗口 / 开发者工具 | roles | — | menu | always |

`MenuCommand` union (`shared/desktop-api.ts`) — 20 commands, exactly the table above:
`import-document`, `export-document`, `open-project-settings`, `close-project`,
`open-command-palette`, `toggle-preview`, `open-concordance`, `focus-filter`,
`open-find`, `open-replace`, `find-next`, `find-prev`, `confirm-segment`,
`confirm-segment-any`, `confirm-segment-stay`, `toggle-lock-segment`,
`show-dock-memory`, `show-dock-term`, `show-dock-qa`, `show-dock-ai`.

Prototype menu mapping: the brief asks for 文件/编辑/视图/项目/翻译/QA/帮助. The
prototypes keep every command above and redistribute them — 导航 folds into 编辑,
项目 collects 项目设置/记忆库管理/术语库管理/归档/返回项目列表, 翻译 collects the
confirm family + 锁定 + 预翻译 + 插入记忆/插入术语 + AI 翻译/润色 + Agent, QA collects
运行 QA + the waive family + 应用修复 + 有错误时阻止导出.

## 2. Ribbon (`components/Ribbon.tsx`)

Overflow-aware: items that no longer fit fold into a trailing 更多 menu (measured with
`ResizeObserver`, never scrolled). Every button dispatches the same handler as its menu
item; none owns behaviour.

| Group | Button | Tooltip | Disabled when |
| --- | --- | --- | --- |
| 项目 | 项目列表 | 返回项目列表 | — |
| 项目 | TM 管理 | TM 管理 | — |
| 文档 | 导入 | 导入文档（Ctrl+O） | busy |
| 文档 | 导出译文 | 导出译文（Ctrl+E） | no document / busy |
| 编辑 | 确认句段 | 确认句段（Ctrl+Enter） | no document |
| 编辑 | 锁定句段 / 解锁句段 | 锁定句段（Ctrl+L） | no document / no selection |
| 编辑 | 预翻译 | 预翻译 | no document / busy |
| 审校 | 查找 | 查找（Ctrl+F） | no document |
| 审校 | 替换 | 替换（Ctrl+H） | no document |
| 审校 | 筛选 | 筛选（Ctrl+Shift+F） | no document |
| 审校 | 检索 | 检索（F3，取选中文本） | — |
| tail | 搜索句段 input | 按文本筛选 | no document |

Ribbon verbs the brief additionally requires in the prototypes: 撤销, 重做,
查找下一个, 插入记忆, 插入术语, 运行 QA, 预览, 命令搜索 (Ctrl+K). All of these exist as
commands in the shipped app (menu roles, `find-next`, TM 应用为草稿, 术语 插入,
QA 运行 QA, `toggle-preview`, `open-command-palette`) — the prototypes only promote them
to the ribbon row.

## 3. Status bar (`App.tsx`)

Left: last status message (replaces silently, never animates).
Right, in order, each rendered only when it has a real value:

| Readout | Content | Behaviour |
| --- | --- | --- |
| 句段 | `activeOrdinal+1/total`, or `total` with no selection | static |
| 已确认 | `counts.confirmed` | static |
| 草稿 | `counts.draft` | **click → grid filter `draft`** (hidden at 0) |
| 剩余 | `counts.untranslated` | static |
| 字数 | engine `sourceWords`, `toLocaleString` | omitted entirely when the engine reports none |
| QA | `counts.openIssues` | **click → grid filter `qa`** (hidden at 0, danger tone) |
| progress | `SegmentProgress` bar + `%` | `%` omitted when total is 0 |
| 行列 | caret `line:column` from the mounted textarea | omitted with no editor |
| INS | insert mode | literal; the editor has no overwrite mode |
| engine | `StatusDot` + `engine <version> · pid <n>` / `engine: 连接中` / `启动中` / `重启中 (n)` / `已停止：<lastError>` | dot: ok / busy / down |

Window title: `<project> — <document> (src → tgt)`, or `<project> (src → tgt)`, or
`Translunar`.

## 4. Left explorer (`WorkbenchView.tsx`)

Three sections in one collapsible rail (`Splitter`, width persisted per project;
double-click resets, chevron collapses).

- **项目**: caption + 项目设置 gear; project name; `语言对：src → tgt`; `进度：n%` plus a
  `SegmentProgress` bar labelled `已确认 c/t`. Progress renders **only** when every
  document reported real counts (`projectTotals.hasProgress`).
- **文件**: `搜索文件` input (local substring filter, no RPC — appears only with ≥1
  document); document rows carrying name, `format · 确认 c/t · 草稿 d · QA q`
  (falls back to `format · n 句段` without progress), a per-document progress bar and
  `%`; 移除 button → two-step `确认移除` / `取消`.
- **项目详情**: 名称, 源语言, 目标语言, 创建时间, 文件数, 总句段, 已确认句段（n%）.
- Empty states: `暂无文档`, `无匹配文件`.

**Prototype deviation — the 文件 section is a tree, not a list.** The shipped app
renders documents flat; every `saas-opus-*` study renders the same documents as an
IDE file tree, folded from the directory each document was imported from. Nothing
about the per-document data changes, only how it is arranged:

| Element | Behaviour |
| --- | --- |
| Folder row | chevron toggles; folders sort before files, both alphabetical |
| Indent guide | one hairline per ancestor level, drawn at every depth |
| File icon | per format — `docx`, `md`, `json` each get their own glyph |
| Folder rollup | descendant file count, plus an open-QA badge when any child has findings |
| File badge | 已确认 `%` over a two-tone fill line; QA count badge when open > 0 |
| Active file | row marker, accent icon, weight bump — distinct from "tab is open" |
| Removal | unchanged: hover → 移除 → `确认移除` / `取消` |
| Search | matches the full path (`docs/guides/onboarding-guide.docx`) and force-expands every folder |
| Reset | a 场景 switch collapses `legal`, clears the search, re-activates `onboarding-guide.docx` |

Fixture tree: `docs/guides/{onboarding-guide.docx, troubleshooting.docx}`,
`docs/release-notes-4.2.docx`, `reference/api-reference.md`,
`ui/strings/console-strings.json`, `legal/terms-of-service.docx`.

## 5. Center — document tabs, banners, toolbar

- **Document tabs**: one tab per opened document, `×` closes the tab only (the document
  stays in the project); closing the active tab lands on its neighbour, closing the last
  shows the empty grid.
- **Inline banners**, in render order: QA-gate confirm, overwrite confirm, unacked-write
  alert (`句段 #n 的草稿/确认未被引擎确认写入（<message>）` + 关闭).
- **Grid toolbar**: 状态 select (`全部状态` / `未译` / `草稿` / `已确认` / `QA 问题`),
  removable chips (one per active channel: state chip, `“query”` chip — `×` clears that
  channel, Esc clears all), and a right-aligned `visible/total` count.
- **Filter channels shipped**: state + free text (`lib/segment-filter.ts`).
  **(proposed)** in the prototypes: 锁定, 有术语, 有标签 chips — the data exists
  (`Segment.locked`, `term.lookup`, `lexPlaceholderTokens`) but no filter channel does.

## 6. Find / replace widget (`components/FindWidget.tsx`)

Floating, VS Code shaped. Ctrl+F opens the find row, Ctrl+H opens with the replace row
revealed; re-summoning refocuses and selects. Esc closes and hands focus back to the grid.

| Control | Note |
| --- | --- |
| 查找 input | Enter = 查找下一个, Shift+Enter = 查找上一个 |
| `n 段` | matching **segments** among the visible rows, not occurrences |
| ↑ / ↓ | 查找上一个 (Shift+F4) / 查找下一个 (F4) |
| × | 关闭（Esc） |
| 替换为 input | Enter = 替换 |
| 替换 | active segment only; reports `已替换 n 处「q」`; falls through to find-next when the active row has no match |
| 全部替换 | one `segment.replace` across the whole document; reports replaced segments, occurrences, `n 个已确认句段退回草稿`, `跳过 n 个已确认句段`, `跳过 n 个已锁定句段` |
| 含已确认 | off by default; confirmed rows are skipped and reported instead of silently rewritten |

Find never hides rows — it moves the selection and reports wrapping
(`已从头继续，跳到句段 #n`) and misses (`查找「q」：没有匹配`).

## 7. Segment grid (`components/SegmentGrid.tsx`)

Columns: `#` / `源文 <locale>` / `译文 <locale>` / `状态`.

| Element | Detail |
| --- | --- |
| Ordinal | `segment.ordinal + 1` |
| Source / target text | `TokenText`: placeholder tokens (`{name}`, `{{var}}`, `%s`, `<b>`, `&amp;`) render as mono chips; tokens named by an open `qa.tag-placeholder_*` issue get the danger outline (missing → source side, extra → target side) |
| Target editor | textarea mounts on the selected row unless it is locked; debounced auto-save at 700 ms; flushes on leave/unmount; IME-safe (inserts queue to `compositionend`) |
| State chip | `○ 未译` / `✎ 草稿` / `✓ 已确认` — glyph first, colour second |
| QA overlay | `⚠n` on the state chip when the segment has open issues |
| Lock glyph | separate lock icon, never a colour change; a locked row is selectable but never mounts the editor |
| Origin chip | persisted `Segment.origin`: `95 TM` (tmExact/tmFuzzy, score only for TM) or `AI`; muted when `origin.edited`; tooltip lists 状态/来源/分值/模型. Falls back to the live best TM match on the active row. Never invented for human rows |
| Row menu `⋯` | 复制源文 (disabled when locked), 清空译文 (disabled when locked or empty), 锁定/解锁. Opens on click, right-click, ContextMenu key, or Shift+F10 |

Confirm chords all call the same `segment.confirm`; only the navigation differs:

| Chord | Mode | After confirm |
| --- | --- | --- |
| Ctrl+Enter | `nextUnconfirmed` | next unconfirmed visible row |
| Ctrl+Alt+Enter | `nextAny` | next visible row, any state |
| Ctrl+Alt+Shift+Enter | `stay` | stays put |

Locked rows are stepped over by both advancing chords. Nothing wraps.

Other grid keys: `↑`/`↓` move the selection in row mode, `Enter` re-enters the editor,
`Esc` leaves the editor (flushing the draft) and drops focus to the row.

Virtualisation kicks in above 120 rows (measured heights, 400 px overscan).

## 8. Workbench keymap (`WorkbenchView.tsx` keydown)

| Chord | Action |
| --- | --- |
| F3 | 检索, seeded from the current text selection |
| F4 / Shift+F4 | 查找下一个 / 上一个 (plain F4 only — never Alt+F4) |
| Ctrl+F / Ctrl+H | find widget (find row / replace row) |
| Ctrl+Shift+F | focus the ribbon 搜索句段 filter box |
| Ctrl+K / Ctrl+Shift+P | command palette |
| Alt+↑ / Alt+↓ | step the selection, works while typing |
| Ctrl+1…9 **in the target editor** | apply the n-th 记忆 match as a draft (memoQ semantics); reports `没有第 n 条记忆匹配` when absent |
| Ctrl+1…4 **outside the editor** | switch dock (记忆/术语/QA/AI) |
| Esc | clears the display filter — last resort only (find widget, row menu, editor exit and dialogs consume it first) |

## 9. Right dock — four groups

### 9.1 记忆 (Ctrl+1)

`TmPanel` (workbench-owned `tm.lookup` on the active segment) over `ConcordancePanel`.

- Panel title 翻译记忆 + best-match `MatchBadge`.
- Match card: score badge + grade (`精确` / `模糊`), source memory name, `应用为草稿`
  button, target text, `源：<sourceText>`. Double-click applies. Apply stamps the real
  grade and score as the segment origin.
- Empty / error: `未选中句段`, `无匹配`, verbatim lookup error.
- 检索 (concordance): `检索词` field, `n 命中` badge, per-hit `源文`/`译文` badge, `#ordinal`,
  `定位句段`, highlighted match; then a `项目 TM（模糊检索）` section (score ≥ 50) with
  `n 条` badge and `译：…` lines. Empties: `输入检索词`, `文档内无命中`, `TM 内无相似条目`.

### 9.2 术语 (Ctrl+2)

- `n 个术语库` badge from `termbase.list` (enabled mounts only).
- Per hit: source term, then each translation with `首选` / `禁用` badge and an `插入`
  button (disabled for forbidden terms). Insert lands at the caret of the live editor
  without saving; only with no editor mounted does it append to the saved draft.
- Quick capture form (only when a writable termbase is mounted): 源术语, 目标术语,
  添加术语 → `term.add`.
- Empties: `尚未挂载术语库`, `未选中句段`, `当前句段无术语命中`.

### 9.3 QA (Ctrl+3)

- Title `质量检查（未解决 n）` + `运行 QA`.
- Open issues grouped by `ruleId` (group ranked by its most severe member), severity
  ordered error → warning → info inside each group; waived then resolved below.
- Issue card: severity glyph `⛔ 错误` / `⚠ 警告` / `ⓘ 提示`, status badge
  `未解决` / `已忽略` / `已解决`, rule id, message (localised for `qa.unedited-fuzzy`,
  `qa.length-ratio`, `qa.target-length-limit`; engine message otherwise), evidence line
  `源 [..] ≠ 译 [..]` (suppressed for behavioural rules), waive note `备注：…`.
- Actions: `忽略` (this finding), `忽略同类` (this rule across the document — only when
  another open issue shares the rule), `忽略本句` (only when the segment has more than
  one open issue), `恢复` (waived → 未解决), `定位句段`.
- Correction channel: `qa.fix.list` supplies engine-computed replacements; a card shows
  `修复为：<fixedTargetText>` and an `应用修复` button **only** when the engine proposed
  one. Labels: 去除首尾空白, 标点改全角, 省略号改 ……, 删除重复词, 数字改为源文数值.
- Rule ids seen in the engine: `qa.number-mismatch`, `qa.unit-mismatch`,
  `qa.tag-placeholder_missing` / `_extra`, `qa.tag-tag_*`, `qa.empty-target`,
  `qa.source-equals-target`, `qa.edge-whitespace`, `qa.repeated-word`,
  `qa.length-ratio`, `qa.target-length-limit`, `qa.unedited-fuzzy`,
  `qa.missing-final-punctuation`, `qa.unbalanced-delimiter`, `qa.cjk-halfwidth-punctuation`,
  `qa.cjk-ellipsis`, `qa.cjk-dash`, `qa.cjk-latin-spacing`, `qa.term-missing`,
  `qa.term-forbidden`, `qa.term-required`, `qa.same-source-different-target`,
  `qa.different-source-same-target`, `qa.regex`.

### 9.4 AI (Ctrl+4)

`AiPanel` (辅助) over `AgentPanel` (Agent) — one dock, two honest lifecycles.

**AI 辅助**
- Header badge: `provider · model` when configured, `未配置` otherwise.
- Unconfigured: form 供应商 / 模型 / Base URL / API Key → `保存配置`. Providers:
  OpenAI, OpenAI Responses, Anthropic, Google Gemini, DeepL, DeepSeek, 通义千问,
  智谱 GLM, Kimi, 火山引擎, OpenAI 兼容端点.
- Configured: `AI 翻译`, `AI 润色` (needs existing target), `取消请求` while a run polls.
- Candidate: `翻译候选` / `润色候选` badge, `标签完整` / `标签破损` badge, draft text, a
  character diff against the target at request time, `应用为草稿` (blocked when the tag
  check failed, with the missing/extra token list) and `拒绝`.
- `该句段已确认` note instead of buttons on confirmed rows.
- Apply stamps `aiDraft` + model as origin, **never a score** — no provider returns one.

**Agent 模式**
- Status badge: 运行中 / 等待人工审核 / 已取消 / 失败.
- `任务指令（可选）` textarea; `创建任务单并运行` / `取消运行`.
- Summary strip: 计划 n, TM n, AI 草稿 n, 失败 n, QA 未解决 n.
- Step feed: 规划 / TM 预翻 / AI 起草 / 质检 / 总结 / 取消, each with `#index`, a
  segment id fragment, a detail line, and a done/failed/skipped tone.
- `等待人工审核` gate: `去工作台查看草稿` and `去导出…`. **The agent never exports.**
- `未配置 AI 供应商` note when the provider is unset; the start button stays disabled.

## 10. Preview pane (`components/PreviewPane.tsx`)

Collapsible bottom pane (Ctrl+P), height persisted, splitter with double-click reset.

- **校对视图**: client-side backfill grouped by structural path. Summary
  `共 n 个句段：m 个已有译文，k 个未译`. Each segment is a button carrying `data-state`
  and `data-fallback`; untranslated segments show the source, visibly marked. Follows the
  active grid row (scrolled to centre) and jumps back on click.
- **版式视图（DOCX）**: the real `document.export` pipeline renders to a temp DOCX and the
  bytes are drawn by `docx-preview`, so layout cannot drift from the exported file.
  States: `正在生成版式预览…`, `正在重新生成版式预览…` (stale DOM stays visible),
  `已回填 n 个已译单元`, `版式预览生成失败：<message>`. Clicking an anchored region
  (`tlseg-` bookmarks) jumps to that segment; unanchored chrome does nothing.
  Only offered for `docx` / `bilingual-docx`. Re-export is debounced (600 ms) and paused
  while the pane is collapsed.
- Legend badges: 已确认 / 草稿 / 未译.

## 11. Command palette (`components/CommandPalette.tsx`)

Ctrl+K or Ctrl+Shift+P. `搜索命令` input, substring filter with match highlight,
`↑`/`↓`/`Enter`/`Esc`, disabled rows render but never run, `没有匹配的命令` when empty.

Catalog: 导入文档… (Ctrl+O), 导出译文… (Ctrl+E), 项目设置… (Ctrl+,), 返回项目列表,
确认当前句段 (Ctrl+Enter), 确认并到下一句段 (Ctrl+Alt+Enter), 确认并停留
(Ctrl+Alt+Shift+Enter), 锁定/解锁当前句段 (Ctrl+L), 预览面板 (Ctrl+P), 查找… (Ctrl+F),
替换… (Ctrl+H), 查找下一个 (F4), 查找上一个 (Shift+F4), 筛选句段 (Ctrl+Shift+F),
检索（取选中文本） (F3), 记忆面板 (Ctrl+1), 术语面板 (Ctrl+2), QA 面板 (Ctrl+3),
AI 面板 (Ctrl+4), and one `打开文档：<name>` per project document.

## 12. Dialogs and blocking surfaces

### 12.1 项目列表 / 新建项目 (`views/ProjectsView.tsx`)

Full-bleed working surface, not a centered card. Create toolbar (项目名称 / 源语言 /
目标语言 / 创建项目) over a hairline list. `项目（n）` caption,
`显示已归档项目（n）` toggle (only when archived projects exist), `已归档` badge per row.
Empties: `还没有项目`, `没有进行中的项目`. Errors surface verbatim.

### 12.2 导入文档 (`ImportDocumentDialog.tsx`)

`选择文件…` + basename (`未选择文件` until picked); 分段方式 = `句子（SRX 规则）` /
`段落`; `选择 SRX 规则…` (sentence mode only) + basename + `清除`, else
`内置规则（<sourceLocale>）`. Footer 取消 / 导入 (`导入中…`). Pre-fills from the stored
project defaults and auto-saves the successful choice back through `project.update`; a
failed defaults-save keeps the dialog open and says so without pretending.

### 12.3 项目设置 (`ProjectSettingsDialog.tsx`)

| Section | Controls |
| --- | --- |
| 项目信息 | 项目名称 / 源语言 / 目标语言 → 保存项目信息 (engine refuses a locale change once the project holds content; refusal shown verbatim) |
| 导入默认 | 默认分段方式; 选择默认 SRX 规则… + basename + 清除, else `内置规则（locale）`; 保存导入默认 |
| 质量检查 | `有错误时阻止导出` checkbox → `qa.profile.update` with the stored revision |
| 生命周期 | `进行中` / `已归档` + badge + `归档项目` / `恢复项目` |
| 翻译记忆 | 记忆库 picker (`（可写）` suffix, defaults to the writable mount) + `导入外部 TM…` / `导出 TM…`; without mounts: `未挂载记忆库，无法导入或导出。请先在 TM 管理中挂载。` |
| 术语库 | per mounted termbase: `管理术语` / `收起术语` (inline `TermManagePanel`), `导入 CSV/TBX…`, `导出…`, `卸载`; unmounted termbases get `挂载`; `新术语库名称` + `新建并挂载` |

Per-action in-flight tracking (a long TM import never locks the termbase buttons).
Blocked exports raise the inline overwrite confirm. Result messages carry the engine's
real counts (`读取 n 条，新增 a，更新 u` / `合并 m`).

### 12.4 记忆库管理 / TM 管理 (`TmManageDialog.tsx`)

**挂载的记忆库** — per mount: name, `可写`/`只读` badge, `已停用` badge, locale-mismatch
badge (`语言对 x → y（项目 a → b）`, a soft note — the attach is never refused), and
actions 上移 / 下移 / 停用|启用 / 设为可写 / 重命名 / 卸载. `设为可写` demotes the current
writable mount first (the engine allows at most one).

**Attach / create / delete** — `挂载已有记忆库` select + `挂载` + `删除`; delete is
two-step (`确认删除` / `取消`) and, when the engine refuses because entries remain, its
message is shown verbatim with an explicit `连同条目删除` cascade. `新建记忆库` name +
`新建并挂载`.

**条目** — 记忆库 select, `搜索源文或译文` + 搜索, count line
(`记忆库「X」共 n 条` / `匹配「q」共 n 条`), entry cards (`源：…` + target) with
编辑 (inline 源文/译文 + 保存/取消) and 删除 → `确认删除`, pager `上一页 / 第 n / m 页 / 下一页`
(50 per page). Empties: `未挂载记忆库`, `记忆库暂无条目`, `无匹配条目`.

### 12.5 术语库管理 (`TermManagePanel.tsx`, inline in 项目设置)

`n 条术语` badge; per entry: source term with 编辑 / 删除 → `确认删除`; per translation:
term + `首选` / `禁用` badge, 编辑, and `删除译文` (only when more than one translation);
inline form 源术语 / 目标术语 → 保存修改 / 取消. Empty: `术语库为空`.

### 12.6 导出覆盖 (`ExportOverwriteConfirm.tsx`)

`目标已存在，要覆盖吗？` + the full destination path. `覆盖` retries with
`overwrite: true` (carrying an already-made QA-gate decision); `取消` leaves the existing
file untouched. Reported as `导出完成（已覆盖）：<path>（n 个已译单元）`.

### 12.7 导出 QA 门 (`ExportQaGateConfirm.tsx`)

`存在 QA 错误，仍要导出吗？` + `n 个错误未解决：<rule ids>` (engine sends at most three).
`仍要导出` retries with `overrideQaGate: true`; `取消` exports nothing and leaves the
findings in the QA dock. Gate + overwrite compose: passing the gate then hitting an
existing file raises the overwrite confirm carrying the gate decision.

### 12.8 引擎闸门 (`EngineGate.tsx`)

Modal over an `inert` workbench whenever the engine is not `ready`:

| State | Title | Body | Action |
| --- | --- | --- | --- |
| starting | 正在启动翻译引擎 | — | — |
| restarting | 翻译引擎正在自动重启 | 第 n 次重试，编辑已锁定 | — |
| down | 翻译引擎已停止 | 编辑已锁定 | 重新启动引擎 / 正在重新启动… |

`lastError` is printed verbatim when present. On recovery the workbench resyncs from the
engine and reports `引擎已恢复，已重新同步`.

## 13. Status messages the workbench emits

Draft/confirm: `句段 #n 草稿已保存`, `句段 #n 已确认并写入 TM，TM 传播 k 个重复句段，QA q 个问题`,
`句段 #n 译文为空，无法确认`, `句段 #n 草稿未保存：引擎未确认写入`, `句段 #n 未确认：引擎未确认写入`.
Row menu: `句段 #n 已复制源文为草稿`, `句段 #n 已清空译文`, `句段 #n 已锁定` / `已解锁`.
Batch: `预翻译完成：检查 c 个未译句段，填充 p 个（精确 e / 模糊 f），跳过 l 个已锁定句段`,
`QA 完成：检查 c 个句段，o 个未解决问题`, `已忽略 n 个 QA 问题`, `已恢复 … 为未解决`,
`句段 #n 已应用修复`. Files: `已导入「X」：n 个句段`,
`已移除「X」：删除 s 个句段、q 条 QA 记录`, `导出完成：<path>（n 个已译单元）`,
`已取消导出`. TM apply: `已应用第 n 条记忆匹配（s%）为草稿`. Find: `查找「q」：没有匹配`,
`查找「q」：已从头继续，跳到句段 #n`. Filter: `已清除筛选`. Engine: `引擎已恢复，已重新同步`.

## 14. Layout persistence (`components/Splitter.tsx`)

Left rail width, right rail width, both collapse flags, and the preview height are
persisted per project. Splitters are keyboard-operable, double-click resets to the
default, and the chevron collapses/expands.

## 15. Scenario matrix the prototypes must reach

| # | Scenario | What must be true on screen |
| --- | --- | --- |
| 1 | empty projects | projects view, `还没有项目`, create toolbar, no workbench chrome |
| 2 | imported grid | tabs, filters, grid with mixed states, docks populated |
| 3 | confirm wrote TM | status line `已确认并写入 TM…`, row flips to ✓ with a `100 TM` origin chip, memory dock shows the entry it just wrote |
| 4 | locked row | lock glyph, no editor on that row, row-menu 解锁, ribbon flips to 解锁句段, replace/pretranslate skip counts |
| 5 | unedited-fuzzy QA | `qa.unedited-fuzzy` finding, `模糊匹配（95%）未修改即确认`, no evidence bracket, 忽略/忽略同类/定位句段 |
| 6 | AI unconfigured | 未配置 badge, provider form, Agent start disabled with `未配置 AI 供应商` |
| 7 | Agent awaitingReview | 等待人工审核 badge, step feed, summary counts, 去工作台查看草稿 / 去导出… |
| 8 | export gate | `存在 QA 错误，仍要导出吗？` banner with real counts and rule ids, 仍要导出 / 取消 |

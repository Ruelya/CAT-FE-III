# Translunar CAT Workbench — Feature & Interaction Inventory

This document provides a comprehensive inventory of all features, panels, state machines, dialogs, workflows, and keyboard bindings implemented in `cursor/gf-workbench-s3d-2398` across the desktop workbench.

---

## 1. Application Shell & Navigation Structure

### 1.1 Native/App Menu Bar (`menu-template.ts`)
1. **文件 (File)**:
   - `导入文档…` (Cmd/Ctrl+O) — Enabled when project open. Opens `ImportDocumentDialog`.
   - `导出译文…` (Cmd/Ctrl+E) — Enabled when document open. Triggers export pipeline, subject to QA gate and file overwrite checks.
   - `项目设置…` (Cmd/Ctrl+,) — Enabled when project open. Opens `ProjectSettingsDialog`.
   - `返回项目列表` — Closes current project and returns to `ProjectsView`.
   - `退出` (Quit) — Non-macOS quit role.
2. **编辑 (Edit)**:
   - `撤销` (Undo) / `重做` (Redo) / `剪切` / `复制` / `粘贴` / `全选`.
   - **Studio Confirm Chords**:
     - `确认当前句段` (`CmdOrCtrl+Enter`) — Commits segment text, writes to working TM, runs confirm-time QA, navigates to next unconfirmed segment.
     - `确认并到下一句段` (`CmdOrCtrl+Alt+Enter`) — Commits segment and navigates to the immediate next row regardless of status.
     - `确认并停留` (`CmdOrCtrl+Alt+Shift+Enter`) — Commits segment and keeps selection on current row.
   - `锁定/解锁句段` (`CmdOrCtrl+L`) — Toggles segment lock state (`Segment.locked`). Locked segments are read-only and cannot mount editor.
3. **视图 (View)**:
   - `命令面板` (`CmdOrCtrl+Shift+P` / `CmdOrCtrl+K`) — Opens global command palette.
   - `预览面板` (`CmdOrCtrl+P`) — Toggles collapsible bottom preview drawer.
   - **Dock Group Switches**:
     - `记忆面板` (`CmdOrCtrl+1`) — TM lookup & concordance dock.
     - `术语面板` (`CmdOrCtrl+2`) — Terminology lookup & quick capture dock.
     - `QA 面板` (`CmdOrCtrl+3`) — Quality assurance issues & fixes dock.
     - `AI 面板` (`CmdOrCtrl+4`) — AI Assistant & Autonomous Translation Agent dock.
   - Zoom controls (`实际大小`, `放大`, `缩小`, `切换全屏`).
4. **导航 (Navigation)**:
   - `查找…` (`CmdOrCtrl+F`) — Summons floating find widget in find mode.
   - `替换…` (`CmdOrCtrl+H`) — Summons floating find widget in replace mode.
   - `查找下一个` (`F4`) — Jumps selection to next match across visible rows without filtering.
   - `查找上一个` (`Shift+F4`) — Jumps selection to previous match across visible rows.
   - `句段筛选` (`CmdOrCtrl+Shift+F`) — Focuses filter search input in toolbar/ribbon.
5. **项目 (Project)**:
   - `TM 管理…` — Opens multi-TM management dialog (`TmManageDialog`).
   - `预翻译…` — Batch pre-translates current document using active TM mounts.
   - `语料检索…` (`F3`) — Concordance search on selected text across project segments & TM.
6. **翻译 / QA / 帮助 (Translation / QA / Help)**:
   - `运行 QA 检查` — Re-runs QA pipeline across full document.
   - `帮助` — Documentation, shortcuts, version information.

### 1.2 Ribbon Action Toolbar (`Ribbon.tsx`)
- **Group: 项目 (Project)**: 返回项目列表, TM 管理.
- **Group: 文档 (Document)**: 导入文档 (`CmdOrCtrl+O`), 导出译文 (`CmdOrCtrl+E`).
- **Group: 翻译 (Translate)**: 确认句段 (`CmdOrCtrl+Enter`), 锁定句段/解锁句段 (`CmdOrCtrl+L`), 预翻译.
- **Group: 检索 (Search/Find)**: 查找 (`CmdOrCtrl+F`), 替换 (`CmdOrCtrl+H`), 语料检索 (`F3`).
- **Group: QA & 辅助 (QA & Tools)**: 运行 QA, 预览面板 (`CmdOrCtrl+P`), 命令搜索 (`Ctrl+K`).
- **Display Filter Search Box**: Quick filter input (`CmdOrCtrl+Shift+F`) on the far right with responsive overflow collapse into a "更多" menu.

### 1.3 Command Palette (`CommandPalette.tsx`)
- Triggered via `CmdOrCtrl+K` or `CmdOrCtrl+Shift+P`.
- Modal overlay with search query, highlighted substrings, keyboard navigation (ArrowUp, ArrowDown, Enter, Esc).
- Aggregates all menu actions, dock tab switches, and document jumps. Disabled actions render as muted unclickable items.

### 1.4 Status Bar (`App.tsx`)
- **Left: Status Message** — Live reactive text ("Translunar CAT 就绪", "句段 #3 草稿已保存", etc.).
- **Right: Instrumentation Readouts**:
  - `句段`: Current active ordinal / total count (e.g. `句段 3/12`).
  - `已确认`: Total confirmed segments count.
  - `草稿`: Total draft segments count — clickable filter jump (`statJumpRef.current("draft")`).
  - `剩余`: Untranslated count.
  - `字数`: Source word count (UAX #29 / CJK characters) computed by engine.
  - `QA`: Open QA issues count with danger tone — clickable filter jump (`statJumpRef.current("qa")`).
  - `进度`: Progress bar with percentage calculation.
  - `行列`: Target editor caret line & column position (e.g. `行列 1:14`).
  - `INS`: Truthful insert-mode indicator.
  - `Engine Status`: Colored status dot + version/PID/restart count (`engine 0.3.1 · pid 4192`, `engine: 重启中`, `engine: 已停止`).

---

## 2. Left Sidebar: Project & Document Explorer

- **Project Header & Metadata**:
  - Project title, language pair indicator (`en-US → zh-CN`), gear button for `ProjectSettingsDialog`.
  - Project-level translation progress bar & percentage.
- **Document List Section**:
  - Search/filter input for documents in project.
  - Document items with active state, format tag (e.g. `docx`, `xlsx`, `md`, `txt`), progress bar, confirmed/total segment counts, draft badge, QA error count.
  - Inline hover delete button with two-step confirmation (`确认移除` / `取消`).
- **Project Details Section**:
  - Name, source locale, target locale, creation date, document count, total segments, confirmed segments percentage.
- **Action**:
  - `+ 导入新文档` button triggering `ImportDocumentDialog`.
- **Resizable Splitter**:
  - Left rail resize handle (min 200px, max 480px, default 280px) and collapse/expand toggle button.

---

## 3. Center Working Grid (`SegmentGrid.tsx` & Toolbar)

### 3.1 Document Tabs & Toolbar
- **Document Tabs (`doc-tabs`)**: Multi-document tab strip with active highlight and close `×` button.
- **Filter Toolbar (`grid-toolbar`)**:
  - Status dropdown selector: `全部状态`, `未译 (untranslated)`, `草稿 (draft)`, `已确认 (confirmed)`, `QA 问题 (qa)`.
  - Filter chips: removable tags for active state filter and text query with `×` button and segment counter (`可见句段/总句段`).
- **Alert Banner**:
  - Unacknowledged write alert (`workbench-unacked`) when engine fails to confirm save.

### 3.2 Floating Find & Replace Widget (`FindWidget.tsx`)
- VS Code style floating card in the top right of the grid.
- **Find Row**: Query input, match count readout (`3 个匹配`), Prev (`Shift+Enter` / `Shift+F4`), Next (`Enter` / `F4`), toggle replace arrow, close `×` (`Esc`).
- **Replace Row**: Replace text input, `含已确认` checkbox, `替换` button, `全部替换` button.
- **Non-hiding**: Find moves selection cursor across rows rather than filtering them away.

### 3.3 Bilingual Segment Grid
- **Columns**: `#` (Ordinal), `源文 (Source Locale)`, `译文 (Target Locale)`, `状态 (State)`.
- **Source Column**:
  - Formatted text with inline token highlighting (`TokenText.tsx`) for placeholder tags (`{{var}}`, `{0}`, `<tag>`, `%s`, etc.).
  - QA danger outline for missing tags.
- **Target Column**:
  - Read-only token view for inactive rows with extra-tag danger outlines.
  - Active row mounts inline `<textarea>` editor:
    - Auto-focus, real-time caret tracking for status bar.
    - Trados-style debounced draft persistence on typing.
    - IME composition safety (queuing external inserts during composition).
    - Studio confirm chords (`Ctrl+Enter`, `Ctrl+Alt+Enter`, `Ctrl+Alt+Shift+Enter`).
    - `Esc` returns focus to row-level roving navigation (ArrowUp/Down travel, Enter to edit).
- **Status Column**:
  - **Lock Icon**: `IconLock` for locked segments (editor disabled, read-only).
  - **State Badge / Chip**:
    - Untranslated: `· 未译`
    - Draft: `✎ 草稿`
    - Confirmed: `✓ 已确认`
    - QA indicator: `⚠ 2` badge.
  - **Origin / TM Match Badge**:
    - Exact match (`100%`, `101%` ICE/Context)
    - Fuzzy match (`95%`, `75%`)
    - Machine Translation (`MT`, `AI`)
  - **Row Context Menu (`⋯`)**:
    - `复制源文` (Copy source to target)
    - `清空译文` (Clear target text)
    - `锁定句段` / `解锁句段` (Toggle segment lock)

---

## 4. Right Utility Docks (`WorkbenchView.tsx` 4 Tabs)

The right sidebar provides 4 dock panels toggled via header tabs or `CmdOrCtrl+1..4`:

### 4.1 记忆 (TM Dock & Concordance) — `TmPanel.tsx` & `ConcordancePanel.tsx`
- **Sub-mode 1: 实时匹配 (TM Lookup)**:
  - Top match badge in dock header (e.g. `95% 模糊`).
  - Ranked list of match cards from mounted TM libraries.
  - Match card displays: Score badge, Grade label (精确/模糊), TM origin library name, Target text, Diff-highlighted Source text comparison.
  - Action: `应用为草稿` button or double-click or `Ctrl+数字` hotkey to apply directly into editor at caret.
- **Sub-mode 2: 语料检索 (Concordance Search — F3)**:
  - Query input box with real-time search across all document segments and project TMs.
  - Match count, highlighted keyword snippets in source/target context, click-to-jump into segment grid.

### 4.2 术语 (Terminology Dock) — `TermPanel.tsx`
- Active segment terminology recognition (source term matched in text).
- Match cards showing: Source term, Target translation, Target locale, Source Termbase name.
- Action: `插入` button to insert term translation into editor at caret position.
- Quick Term Addition Form:
  - `源术语` input, `目标译文` input, `添加术语` button into active writable termbase.

### 4.3 QA (Quality Assurance Dock) — `QaPanel.tsx`
- **Header**: QA Issue count badge, `运行 QA 检查` button.
- **Grouped Issue List**:
  - Grouped by rule type (e.g. `qa.tag-placeholder_missing`, `qa.unedited-fuzzy`, `qa.length-ratio`, `qa.target-length-limit`, `qa.terminology_mismatch`).
  - Severity level: `⛔ 错误 (Error)`, `⚠ 警告 (Warning)`, `ⓘ 提示 (Info)`.
  - Segment jump button (`定位到句段 #N`).
  - Dynamic parameters (e.g., "模糊匹配（85%）未修改即确认", "译文长度比 180%，超出 50%–150%").
- **Resolution & Waiver Actions**:
  - `应用修复` — Renders when engine proposed fix exists (`qa.fix.apply`).
  - Three waiver options:
    - `忽略` (Waive single issue)
    - `忽略同类` (Waive all issues of this rule across document)
    - `忽略本句` (Waive all issues on this segment)
  - `恢复` (Restore waived issue back to open status).

### 4.4 AI (AI Assistant & Agent Dock) — `AiPanel.tsx` & `AgentPanel.tsx`
- **Section 1: AI Assistant (单句辅助)**:
  - Provider Status: Configured status pill or unconfigured prompt (`OpenAI`, `Anthropic`, `Gemini`, `DeepSeek`, `DeepL`, `Qwen`, `GLM`, `Kimi`, `OpenAI-compatible`).
  - Configuration card (when unconfigured): Provider dropdown, Model name, Base URL, API Key inputs, Save button.
  - Assist actions for active segment: `AI 翻译 (Translate)`, `润色优化 (Refine)`.
  - Candidate Preview Card: Shows generated candidate text, inline character-level diff against current target, model tag, `应用为草稿` button.
- **Section 2: Autonomous Translation Agent (全自动 Agent)**:
  - Document-level autonomous workflow: Planning -> TM Pre-translation -> AI Drafting -> Automated QA -> Summary.
  - Custom instruction input textarea.
  - Live execution feed with real-time step notifications (Plan ✓, TM 预翻 ✓, AI 起草 ⋯, 质检, 总结).
  - Status pill: `运行中 (running)`, `等待人工审核 (awaitingReview)`, `已取消 (canceled)`, `失败 (failed)`.
  - **Human Audit Gate**: When agent reaches `awaitingReview`, displays execution summary (TM applied, AI drafted, failed, open QA issues) and prompts human review before export.
  - Action: `前往审核与导出` button (Agent never exports autonomously).

---

## 5. Bottom Preview Drawer (`PreviewPane.tsx`)

- Collapsible drawer at the bottom of the center grid (toggled via `Ctrl+P` or header chevron).
- Resizable vertical height splitter with double-click reset.
- **Mode 1: 校对视图 (Proofread View)**:
  - Flowing structural text layout grouped by heading/paragraph path.
  - Untranslated segments highlighted with placeholder styling.
  - Real-time highlight following active grid segment, click-to-jump back into grid.
- **Mode 2: 版式视图 (Layout View — DOCX / PDF / HTML)**:
  - Engine export preview rendering actual document layout.
  - Embedded segment anchors (`tlseg-N`) allowing bidirectional jump from rendered document elements directly into grid segments.
  - Auto-refresh with debounce after segment changes.

---

## 6. Dialogs & Modal Overlays

### 6.1 新建项目 (Create Project — in `ProjectsView.tsx`)
- Full toolbar / form: Project Name, Source Locale, Target Locale, Create submit button.

### 6.2 导入文档对话框 (`ImportDocumentDialog.tsx`)
- Source file picker (`window.tl.chooseSourceFile()`).
- Segmentation mode choice: `句子分割 (Sentence)` vs `段落分割 (Paragraph)`.
- Custom SRX ruleset file picker (`window.tl.chooseSrxFile()`).
- Auto-remembers project default segmentation settings.

### 6.3 项目设置对话框 (`ProjectSettingsDialog.tsx`)
- **General Tab**: Project Name, Source/Target Locales (engine forbids change once content exists), Lifecycle status (Archive/Restore).
- **Import Defaults Tab**: Default segmentation (Sentence/Paragraph) and default SRX ruleset path.
- **TM Mounts Tab**: Mount/unmount memories, set working memory, import/export TMX/CSV/TSV.
- **Termbase Mounts Tab**: Mount/unmount termbases, create termbase, entry management panel (`TermManagePanel.tsx`).
- **QA Profile Tab**: Severity thresholds, length ratio boundaries, enabled checks.

### 6.4 翻译记忆库管理对话框 (`TmManageDialog.tsx`)
- Multi-TM mounts list: Enable/disable toggle, Writable/Working memory radio, Priority order adjust, Language pair mismatch indicator.
- Memory rename & delete (with cascade confirmation if entries remain).
- TM Entries browser: Paged table (50/page), keyword search, inline edit source/target, delete entry.

### 6.5 导出与引擎确认闸门 (Export & Engine Gates)
- **QA Gate Refusal Modal (`ExportQaGateConfirm.tsx`)**: Refuses export when error-severity QA issues exist. Shows error count & rule IDs. Options: `仍要导出 (Override QA Gate)` vs `取消 (Cancel)`.
- **Export Overwrite Modal (`ExportOverwriteConfirm.tsx`)**: Refuses silent overwrite when destination file already exists. Shows full destination path. Options: `覆盖 (Overwrite)` vs `取消 (Cancel)`.
- **Engine Down / Reconnect Gate (`EngineGate.tsx`)**: Modal blocking screen when engine is `starting`, `restarting`, or `down`. Renders live restart attempts, last error message, and manual `重新启动引擎` button.

---

## 7. Complete Scenario Matrix

The design studies must demonstrate full fidelity across all critical states:
1. **Empty Project State**: Project opened with 0 documents imported, clear call-to-action to import documents.
2. **Standard Translation Grid**: Active segment editing, draft auto-save, inline token highlights, TM match badge in status column.
3. **TM Confirm & Propagation**: Exact match applied, confirmed state (`✓`), working TM updated.
4. **Locked Segment**: Read-only row with lock glyph, editor disabled.
5. **Unedited Fuzzy Match QA Alert**: Warning severity QA card in dock & inline grid badge for unedited fuzzy match.
6. **AI Unconfigured State**: Clear, honest setup UI in AI dock with provider selection.
7. **Agent Awaiting Review State**: Agent completed autonomous translation pass, showing step checklist, execution metrics, and human audit gate.
8. **Export QA Gate Warning**: Inline confirm banner warning about open QA errors before export.
9. **Engine Gate Interruption**: Engine supervisor reconnect / relaunch alert overlay.

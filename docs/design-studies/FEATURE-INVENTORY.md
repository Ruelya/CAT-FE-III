# Translunar CAT Workbench — feature inventory

Source baseline: `cursor/gf-workbench-s3d-2398`. Reviewed renderer, Electron menu, shared desktop API, and engine-backed panels before prototype construction.

## 1. Application shell

### Window and engine lifecycle
- Window title: project, active document, and `sourceLocale → targetLocale`.
- Engine states: connecting, starting, ready, restarting with retry count, down with last error.
- Non-ready engine gate makes the application surface inert.
- Down-state action: restart engine.
- Recovery action: refresh project documents, active segments, and QA issues; report synchronization status.
- Persistent unacknowledged-write alert for draft or confirm writes the engine did not acknowledge.

### Application menu at the baseline
| Menu | Commands |
| --- | --- |
| 文件 | 导入文档 `Ctrl+O`; 导出译文 `Ctrl+E`; 项目设置 `Ctrl+,`; 返回项目列表; 退出 |
| 编辑 | 撤销; 重做; 剪切; 复制; 粘贴; 全选; 确认当前句段 `Ctrl+Enter`; 确认并到下一句段 `Ctrl+Alt+Enter`; 确认并停留 `Ctrl+Alt+Shift+Enter`; 锁定/解锁句段 `Ctrl+L` |
| 视图 | 命令面板 `Ctrl+Shift+P` / `Ctrl+K`; 预览面板 `Ctrl+P`; 记忆/术语/QA/AI 面板 `Ctrl+1…4`; 实际大小; 放大; 缩小; 切换全屏 |
| 导航 | 查找 `Ctrl+F`; 替换 `Ctrl+H`; 查找下一个 `F4`; 查找上一个 `Shift+F4`; 筛选句段 `Ctrl+Shift+F`; 检索选中文本 `F3` |
| 帮助 | 重新加载窗口; 开发者工具 |

Prototype menu IA expands the same command set into the owner-requested headings: 文件 / 编辑 / 视图 / 项目 / 翻译 / QA / 帮助.

### Status bar
- Replacing status message.
- Current segment / total.
- Confirmed, draft, remaining, engine-computed source word count.
- Draft and QA counters are clickable grid-filter jumps.
- Segmented completion bar and percent.
- Real target-editor caret position as line:column.
- Insert-mode readout `INS`.
- Engine status dot, version, and pid or lifecycle/error text.

## 2. Projects surface
- Create project: name, source locale, target locale.
- Validation, busy state, and engine error.
- Project list with language pair.
- Active-project count.
- Archived-project badge and “show archived” toggle.
- Empty states for no projects and no active projects.
- Open project.

## 3. Workbench command ribbon
- Project list.
- TM management.
- Import document.
- Export translation.
- Confirm segment.
- Lock or unlock segment.
- Pretranslate.
- Find.
- Replace.
- Filter focus.
- Concordance.
- Resident segment-text filter.
- Responsive overflow into “more”.

The prototypes expose the owner-requested verb row in one quiet command system: 撤销 / 重做 / 查找 / 查找下一个 / 确认 / 锁定 / 插入记忆 / 插入术语 / 运行 QA / 预览 / 导出 / 命令搜索.

## 4. Project explorer and document tabs
- Project name and language pair.
- Project confirmed percentage and segmented progress.
- File search.
- Document list: format, segment count, confirmed count, draft count, QA count, percent, per-document progress.
- Open document.
- Two-step remove: 移除 → 确认移除 / 取消.
- Project details: name, source locale, target locale, created date, file count, total segments, confirmed segments.
- Open-document tab strip.
- Switch tab.
- Close tab without deleting the document.
- Empty states: no documents, no file-search match, no open document, document has no segments.
- Resizable and collapsible left rail.

## 5. Grid, editor, provenance, and navigation

### Columns and row state
- `#`, source text with locale, target editor/text with locale, status.
- Translation state glyphs: `○` untranslated, `✎` draft, `✓` confirmed.
- Independent lock glyph and read-only locked row.
- QA overlay with open-issue count.
- Persisted origin chip:
  - exact or fuzzy TM score plus `TM`;
  - `AI` with model in tooltip;
  - muted chip after human editing;
  - human/plain typing has no invented provenance.
- Active-segment live best TM match when no persisted origin exists.
- Placeholder/token highlighting for `{name}`, `{{var}}`, printf tokens, tags, and entities.
- QA danger outline driven by engine evidence for missing source tokens and extra target tokens.
- Selected and editing states.
- Virtualized rows above 120 segments.

### Editing lifecycle
- Selection lands in the target editor.
- Debounced draft autosave.
- Draft flush on segment change, editor exit, filtering, project/document close, and before locking.
- IME-safe composition and caret insertion.
- Term insertion at the live caret.
- Confirm empty-target guard.
- Confirm-time QA refresh.
- Confirm writes to TM and may propagate duplicate segments.
- Confirm navigation:
  - next unconfirmed `Ctrl+Enter`;
  - next row `Ctrl+Alt+Enter`;
  - stay `Ctrl+Alt+Shift+Enter`.
- `Esc`: leave edit mode while preserving draft; row-navigation mode.
- Row-navigation `↑/↓`, `Enter` to edit.
- Global visible-row navigation `Alt+↑/↓`.

### Row menu
- Open from ellipsis, right-click, or `Shift+F10`.
- 复制源文.
- 清空译文.
- 锁定 / 解锁.
- Locked rows disable text-writing actions.

## 6. Search and filters

### Display filter
- State selector: all, untranslated, draft, confirmed, QA issues.
- Case-insensitive text filter over source and target.
- Independently closable active chips.
- Visible / total count.
- `Esc` clears filters as a last-resort action.
- Owner-requested prototype chips add direct views for locked, term-hit, and tagged rows while retaining baseline state/text filters.

### Find and replace
- Floating find widget, `Ctrl+F`.
- Replace row, `Ctrl+H`.
- Query, visible matching-segment count, previous, next, close.
- Enter / Shift+Enter travel.
- Find next `F4`, previous `Shift+F4`, with wrap feedback.
- Replacement text.
- Replace current and replace all.
- “含已确认” opt-in; confirmed replacements demote to draft.
- Locked and confirmed skip counts.
- Find travels without hiding grid rows.

## 7. Right dock

### 记忆
- Live `tm.lookup` for active source segment.
- Best-score chip shared by dock tab, panel, and active row.
- Exact/fuzzy grade, score, memory name, target, source.
- Apply as draft by button, double-click, or numbered `Ctrl+1…9` while editor has focus.
- TM lookup errors and no-match state.
- Concordance:
  - F3 seed from selected text;
  - document source/target substring hits with highlighting;
  - segment ordinal and jump;
  - project TM fuzzy search with 50% floor, score, source, target.

### 术语
- Mounted/enabled termbase count.
- In-text lookup for active source segment.
- Source term and target translations.
- Preferred and forbidden statuses.
- Insert allowed translation at target-editor caret.
- Quick add source/target term to first writable mounted termbase.
- Honest no-mount, no-selection, no-hit, and engine-error states.

### QA
- Run QA for active document.
- Open, waived, and resolved statuses.
- Error / warning / info glyph and label.
- Rule grouping and severity ordering.
- Localized parameterized messages.
- Source/target evidence.
- Ignore one finding.
- Ignore all open findings of the same rule.
- Ignore all open findings on the same segment.
- Restore a waived finding.
- Jump to segment.
- Engine-proposed “修复为” preview.
- Apply deterministic fix through revision and lock guards; confirmed target returns to draft.
- Rule families surfaced by the engine:
  - empty/equal target;
  - numbers and units;
  - inline tags and placeholders;
  - delimiters, final punctuation, whitespace, repeated words, length ratio, target limit;
  - CJK punctuation, ellipsis, dash, and Latin spacing;
  - required/forbidden terminology;
  - same-source/different-target and different-source/same-target;
  - regex rules;
  - unedited fuzzy confirmation.

### AI 辅助
- Honest configured / unconfigured status.
- Provider list: OpenAI, OpenAI Responses, Anthropic, Gemini, DeepL, DeepSeek, Qwen, GLM, Kimi, Volcengine, OpenAI-compatible.
- Configuration: provider, model, optional Base URL, API key, validation/save.
- Translate and refine active unconfirmed segment.
- Async assist lifecycle and cancel.
- Candidate model and elapsed result report.
- Character diff against current target.
- Tag-integrity result; broken candidates cannot apply.
- Apply as AI-origin draft or reject.

### Agent
- Optional task instruction.
- Create task and run.
- Per-document concurrent run tracking.
- Running, awaiting human review, canceled, failed.
- Cancel request.
- Summary counts: planned, TM applied, AI drafts, failed segments, open QA.
- Step feed: plan, TM pretranslation, AI drafting, QA, summary, cancel.
- Human review gate: return to workbench or enter export flow.
- Agent never performs export automatically.

## 8. Bottom preview
- Resizable and collapsible; per-project persisted height/open state.
- Proofread view grouped by structural path.
- Translated target with state treatment; untranslated fallback to source.
- Active-segment follow and click-to-jump.
- Summary and confirmed/draft/untranslated legend.
- DOCX and bilingual-DOCX layout view generated through the real export pipeline.
- Loading, refreshing, ready, and error states.
- Anchored DOCX click-to-jump.
- Edit debounce for layout regeneration; collapse pauses regeneration.

## 9. Dialogs and gates

### Import document
- Source file picker.
- Sentence segmentation through built-in or custom SRX.
- Paragraph segmentation.
- SRX picker and clear action.
- Project-default prefill and auto-save after successful import.
- Busy, cancel, error, and partial-success/default-save-error states.

### Project settings
- Edit project name and language pair.
- Save import defaults: sentence/paragraph, custom/built-in SRX.
- QA profile toggle: block export on open error-severity findings.
- Archive and restore project.
- Explicit mounted-memory selector for TM import destination / export source.
- Import TMX/CSV/TSV and report read/add/update counts.
- Export TM with overwrite protection.
- Termbase list, mount/unmount, create-and-mount.
- Termbase CSV/TSV/TBX import/export with overwrite protection.
- Open inline term manager.

### TM management
- Mounted memory list and priority move up/down.
- Enabled/disabled read path.
- Single writable working memory.
- Language-pair mismatch warning.
- Rename memory.
- Unmount while preserving entries.
- Attach existing memory.
- Create and attach memory.
- Delete unmounted memory with confirmation.
- Cascade delete only after an entry-count conflict and explicit “连同条目删除”.
- Pick mounted memory for entry browsing.
- Search source/target.
- Paginated 50-entry list.
- Edit and delete TM entries with confirmation.

### Termbase management
- Browse source terms and translations.
- Preferred / forbidden statuses.
- Edit source term or one target translation.
- Delete whole entry.
- Delete one translation when alternatives remain.
- Confirmation and errors.

### Export and engine gates
- Existing destination: path, 覆盖 / 取消; overwrite retry preserves a previous QA override.
- QA export gate: open error count, leading rule IDs, 仍要导出 / 取消.
- Engine starting, restarting, and stopped gates; editing locked whenever the engine cannot acknowledge writes.

## 10. Command palette
- Open with `Ctrl+K` or `Ctrl+Shift+P`.
- Type to filter, active row, arrow travel, Enter execute, Esc/backdrop close.
- Disabled commands remain visible.
- Import, export, settings, project list, all three confirm modes, lock, preview, find, replace, next/previous, grid filter, concordance.
- Dock jumps: memory, term, QA, AI.
- One open-document command per project document.
- Prototype catalog also carries direct documentation/help entries requested in the visual-selection brief.

## 11. Prototype scenario matrix
Every version exposes the same switcher and deterministic states:
1. Empty projects.
2. Imported grid.
3. Confirm wrote TM.
4. Locked row.
5. Unedited-fuzzy QA.
6. AI unconfigured.
7. Agent awaiting review.
8. Export QA gate.


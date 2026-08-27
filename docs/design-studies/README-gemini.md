# Translunar CAT Workbench — Modern SaaS Design Studies (Gemini Edition)

This study presents **three distinct, full-fidelity visual & interaction prototypes** for the Translunar CAT Workbench, adhering strictly to **Nielsen’s 10 Usability Heuristics** and tier-1 modern SaaS product aesthetics (Linear, Stripe Dashboard, Notion Workspace).

---

## 1. Design System Variants & Design Reads

### Variant A: Linear Dark Pro (`saas-gemini-linear`)
- **Design Metaphor**: High-velocity engineer/translator command center.
- **Palette & Tokens**: Deep obsidian tones (`#0e1015`, `#14171f`), subtle hairline borders (`#232838`), and electric indigo/purple accents (`#5e6ad2`).
- **Typography**: Inter UI with JetBrains Mono for segmentation ordinals, status tags, and inline placeholders.
- **Key Interactions**:
  - Dense, compact ribbon toolbar with prominent keyboard chord badges (`Ctrl+Enter`, `Ctrl+L`, `Ctrl+F`, `F3`, `Ctrl+K`).
  - Dark-mode high-contrast grid with inline placeholder token badges (`{{var}}`, `<tag>`).
  - Seamless collapsible preview drawer and fast tab-switching right dock (TM, Term, QA, AI).
- **Prototype Path**: `docs/design-studies/saas-gemini-linear/index.html`

### Variant B: Stripe Dashboard Slate (`saas-gemini-stripe`)
- **Design Metaphor**: Enterprise-grade financial/technical SaaS interface.
- **Palette & Tokens**: Clean cool slate sidebar (`#0f172a`), pristine card surfaces (`#ffffff`, `#f8fafc`), crisp borders (`#e2e8f0`), and Stripe signature blurple (`#635bff`).
- **Typography**: System UI stack with SF Mono metrics.
- **Key Interactions**:
  - Elevated card-based table structure with clear status chips (`✓ 已确认`, `✎ 草稿`, `🔒 已锁定`).
  - Prominent project breadcrumbs and global actions in top navigation.
  - Distinctive QA warning cards and human-in-the-loop autonomous agent review state.
- **Prototype Path**: `docs/design-studies/saas-gemini-stripe/index.html`

### Variant C: Notion Workspace (`saas-gemini-notion`)
- **Design Metaphor**: Fluid, document-first knowledge and localization workspace.
- **Palette & Tokens**: Warm minimal white (`#ffffff`), subtle off-white sidebars (`#fbfbfa`), delicate dividers (`#e9e9e8`), and understated color accents (Notion blue `#2383e2`, Notion red `#d44c47`).
- **Typography**: Clean document serif/sans hybrid aesthetic with monospace code bubbles.
- **Key Interactions**:
  - Document header integration with inline progress percentage and live word counts.
  - Inline hover menus, non-intrusive segment editing, and clean dialog overlays.
- **Prototype Path**: `docs/design-studies/saas-gemini-notion/index.html`

---

## 2. Complete Feature & Interaction Coverage

Every HTML prototype covers 100% of the workbench feature inventory (`FEATURE-INVENTORY.md`):
1. **Menu Bar**: 文件 / 编辑 / 视图 / 项目 / 翻译 / QA / 帮助.
2. **Action Ribbon Toolbar**: 撤销, 重做, 导入文档, 导出译文, 确认 (Ctrl+Enter), 锁定 (Ctrl+L), 预翻译, 查找 (Ctrl+F), 替换 (Ctrl+H), 语料检索 (F3), 运行 QA, 预览 (Ctrl+P), 命令搜索 (Ctrl+K).
3. **Left Explorer**: Project status, language pair (`en-US → zh-CN`), overall progress bar, document filter search, multi-document list with delete confirm, project metadata.
4. **Center Working Grid**:
   - Document tabs with active state and close `×`.
   - Grid status filter selector and removable filter chips.
   - Segment table: Ordinal `#`, Source locale text with placeholder tokens (`TokenText`), Target inline editor `<textarea>` with caret tracking and auto-save, Status badges, Origin match chips (100% TM, 95% TM, ICE), Row context menu.
   - Floating Find & Replace widget (`FindWidget`).
5. **Bottom Collapsible Preview Drawer**:
   - Resizable drawer with Proofread view (校对视图) & Layout view (版式视图).
6. **Right Utility Dock (4 Tabs)**:
   - **记忆 (Memory)**: Ranked TM matches, match score badge, source/target diff comparison, "应用为草稿" button.
   - **术语 (Term)**: Matched terms recognition, "插入译文" button, quick term capture form.
   - **QA (Quality Assurance)**: Grouped issues, severity tags, dynamic parameters, waiver actions (`忽略`, `忽略同类`, `忽略本句`).
   - **AI / Agent**: Provider configuration, segment AI assist (translate/refine), Autonomous Agent live step execution feed, and human audit gate.
7. **Status Bar**: Real-time status message, segment position, confirmed/draft/untranslated/word counts, clickable QA jump button, progress percentage, caret row:column readout, INS indicator, Engine lifecycle status dot.
8. **Modals & Overlays**:
   - 导入文档 (`ImportDocumentDialog`)
   - 项目设置 (`ProjectSettingsDialog`)
   - 翻译记忆库管理 (`TmManageDialog`)
   - QA 质量门禁拦截 (`ExportQaGateConfirm`)

---

## 3. Interactive Scenario Switcher

Each prototype includes a floating **场景演示** bar at the bottom:
- `1. 标准工作区`: Default editing mode with TM match applied.
- `2. QA 警告`: Active segment with unedited fuzzy match QA warning in right dock.
- `3. Agent 待审核`: Autonomous agent finished document pass, displaying audit summary & "前往审核与导出" gate.
- `4. 导出闸门`: Export blocked modal alerting about open QA errors.
- `5. 导入对话框`: Document import modal with segmentation options.

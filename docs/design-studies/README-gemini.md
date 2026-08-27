# Translunar CAT Workbench — Gemini Plus & Art Design Studies

Seven full-fidelity visual systems for the Translunar CAT Workbench built on Opus's deep IA foundation, featuring a VS Code-style hierarchical file tree in the left rail and complete parity across all 8 scenarios, 4 docks, 7 menus, ribbon toolbar, preview pane, and system dialogs.

| Group | Study ID | Visual Direction | Open |
| :--- | :--- | :--- | :--- |
| **Job A (SaaS Redo)** | `saas-gemini-plus-linear` | Linear Dark Pro — High-density graphite & electric indigo | [`saas-gemini-plus-linear/index.html`](saas-gemini-plus-linear/index.html) |
| **Job A (SaaS Redo)** | `saas-gemini-plus-stripe` | Stripe Dashboard — Enterprise slate sidebar & pure white cards | [`saas-gemini-plus-stripe/index.html`](saas-gemini-plus-stripe/index.html) |
| **Job A (SaaS Redo)** | `saas-gemini-plus-raycast` | Raycast Modern HUD — Dark carbon & warm amber gold pills | [`saas-gemini-plus-raycast/index.html`](saas-gemini-plus-raycast/index.html) |
| **Job B (Artistic)** | `saas-gemini-art-kinetic` | Cyber-Kinetic HUD — Neo-Tokyo telemetry & glowing neon emerald | [`saas-gemini-art-kinetic/index.html`](saas-gemini-art-kinetic/index.html) |
| **Job B (Artistic)** | `saas-gemini-art-editorial` | Swiss High Editorial — Alabaster canvas, high-fashion serif & vermilion | [`saas-gemini-art-editorial/index.html`](saas-gemini-art-editorial/index.html) |
| **Job B (Artistic)** | `saas-gemini-art-glass` | Spatial Aurora Glass — Multi-layer frosted glassmorphism & cosmic glow | [`saas-gemini-art-glass/index.html`](saas-gemini-art-glass/index.html) |
| **Job B (Artistic)** | `saas-gemini-art-monolith` | Constructivist Monolith — Architectural concrete, black frames & safety orange | [`saas-gemini-art-monolith/index.html`](saas-gemini-art-monolith/index.html) |

---

## 1. Design Reads

### Job A: 3 Modern SaaS Systems (Functional Redo with VS Code Tree)

#### 1. `saas-gemini-plus-linear` — Linear Dark Pro
- **Metaphor**: High-velocity technical localization console for engineers and precision translators.
- **Palette**: Dark obsidian ground (`#0b0d13`), dark graphite surfaces (`#10141d`, `#161b26`), subtle structural borders (`#242c3d`), electric violet/indigo primary actions (`#5e6ad2`), emerald ok (`#27a66f`), coral danger (`#eb5757`).
- **Left Pane**: VS Code-style nested file tree (`01_Source`, `02_Reference`, `03_Translation_Memory`, `04_Deliverables`) with expand/collapse chevrons (`▾`/`▸`), format badges (`W`, `MD`, `PDF`, `XLS`, `TM`), progress percentage readouts, and document deletion.
- **Interaction**: Monospaced data tags, high-contrast token highlights (`{{var}}`, `{count}`), and crisp keyboard navigation.

#### 2. `saas-gemini-plus-stripe` — Stripe Dashboard
- **Metaphor**: Enterprise operations and localization governance dashboard.
- **Palette**: Deep slate left rail (`#0f172a`) with luminous active items, crisp porcelain and white card surfaces (`#ffffff`, `#f8fafc`), hairline slate borders (`#e2e8f0`), and Stripe signature blurple (`#635bff`).
- **Left Pane**: Deep dark sidebar with glowing folder nodes, clear tree hierarchy, and high-visibility file progress metrics.
- **Interaction**: Multi-layer card elevation shadows, clear status pills (`✓ 已确认`, `✎ 草稿`, `🔒 已锁定`), and elevated modal cards.

#### 3. `saas-gemini-plus-raycast` — Raycast Modern HUD
- **Metaphor**: Keyboard-first productivity HUD with Scandinavian minimalism.
- **Palette**: Warm carbon panels (`#111113`, `#18181b`, `#202024`), sleek rounded pill badges (`8px`/`12px`), warm gold / amber accents (`#f59e0b`), high-contrast typography.
- **Left Pane**: Tactile folder blocks, pill-shaped file indicators, and instant search responsiveness.
- **Interaction**: Prominent shortcut keycaps (`<kbd>`), hyper-focused keyboard chords, and clean state chips.

---

### Job B: 4 Awwwards / FWA / CSSDA-Level Artistic Studies

#### 4. `saas-gemini-art-kinetic` — Cyber-Kinetic Tactical HUD
- **Concept**: Awwwards-grade high-tech tactical HUD interface inspired by industrial cybernetics and Neo-Tokyo aesthetics.
- **Visuals**: Deep void background (`#040609`) with subtle luminous grid background texture, tactical neon emerald (`#00ff9d`) and cyan (`#00e5ff`) telemetry lines, glowing active segment border with pulse aura (`box-shadow: inset 3px 0 0 #00ff9d, 0 0 15px rgba(0,255,157,0.15)`), monospace data tags, and military-grade telemetry instrumentation.

#### 5. `saas-gemini-art-editorial` — Swiss High Editorial Luxury
- **Concept**: CSSDA-grade haute-couture editorial catalog inspired by Swiss typographic atelier and luxury fashion monographs.
- **Visuals**: Warm natural alabaster paper canvas (`#fbf9f5`), stark contrast deep ink black (`#111111`), and vibrant vermilion red (`#ff3300`) state accents. Elegant high-contrast serif display headings (`Playfair Display` / `Bodoni`) juxtaposed with razor-sharp grotesque grid lines, dramatic oversized typographic ordinals, and solid ink-block active row marker.

#### 6. `saas-gemini-art-glass` — Spatial Aurora Neo-Glassmorphism
- **Concept**: FWA-grade multi-layer frosted glassmorphism inspired by VisionOS spatial translucency and cosmic aurora lighting.
- **Visuals**: Deep cosmic midnight aurora gradient canvas (`#070913` to `#1e1b4b`), multi-layered frosted glass panels (`background: rgba(18,22,38,0.72); backdrop-filter: blur(24px)`), translucent glass borders with specular rim lighting, luminous electric cyan (`#38bdf8`) and magenta (`#ec4899`) glow gradients, and luminous aurora active row aura.

#### 7. `saas-gemini-art-monolith` — Constructivist Brutalist Monolith
- **Concept**: Raw constructivist architectural monolith inspired by Bauhaus, Dieter Rams functionalism, and brutalist physical instruments.
- **Visuals**: Tactile architectural concrete (`#ded9d0`) and basalt stone (`#1c1a17`), heavy 2px structural black ink rules, bold industrial typography (`Arial Black` / `Impact`), vivid Bauhaus international safety orange (`#ff5500`) state accents, and stamped industrial badges with zero border-radius.

---

## 2. Checklist vs Opus Complete Inventory

All 7 visual systems pass 100% of the feature checklist documented in `FEATURE-INVENTORY.md`:

| Category | Requirement | Implementation in Gemini Plus & Art |
| :--- | :--- | :--- |
| **Shell & Menus** | 7 top-level menus (`文件`, `编辑`, `视图`, `项目`, `翻译`, `QA`, `帮助`) | ✓ Full dropdown menus with shortcuts, state gating, and accelerators |
| **Ribbon Toolbar** | Action ribbon with verbs | ✓ 撤销, 重做, 导入, 导出, 确认 (`Ctrl+Enter`), 锁定 (`Ctrl+L`), 插入记忆, 插入术语, 预翻译, 查找 (`Ctrl+F`), 查找下一个 (`F4`), 替换 (`Ctrl+H`), 检索 (`F3`), 运行 QA, 预览 (`Ctrl+P`), 命令搜索 (`Ctrl+K`) |
| **Command Palette** | Global search overlay (`Ctrl+K` / `Ctrl+Shift+P`) | ✓ Catalog with commands, dock switches, and document jumps |
| **Left Rail** | **VS Code-like File Tree** | ✓ Hierarchical nested folders (`01_Source`, `02_Reference`, `03_Translation_Memory`, `04_Deliverables`), expand/collapse chevrons (`▾`/`▸`), format badges (`W`, `MD`, `PDF`, `XLS`, `TM`), progress readouts, removal confirm, search filter, project details |
| **Center Grid** | Bilingual segment table | ✓ Row status (`# / 源文 / 译文 / 状态`), placeholder token lexer with danger red missing highlights, lock icon, state chips, QA count badge, origin chips (`100 TM`, `95 TM`, `AI`, struck-through edited), row menu (`⋯`) |
| **Target Editor** | Active inline editor | ✓ Auto-focus, debounced draft persistence, caret line:col tracking, roving row navigation (`Esc`/`Enter`) |
| **Confirm Chords** | Studio confirm family | ✓ `Ctrl+Enter` (confirm & advance unconfirmed), `Ctrl+Alt+Enter` (confirm & advance any), `Ctrl+Alt+Shift+Enter` (confirm & stay) |
| **Find & Replace** | Floating search widget | ✓ `Ctrl+F` find row, `Ctrl+H` replace row, `含已确认` option, segment match count, `F4`/`Shift+F4` navigation |
| **Preview Drawer** | Bottom collapsible preview | ✓ `校对视图` (proofread structural backfill) and `版式视图（DOCX）` with bidirectional click-to-jump |
| **Dock 1: 记忆** | TM & Concordance | ✓ Scored matches with owning memory name, `Ctrl+1..9` apply-as-draft, Concordance search over document and project TM |
| **Dock 2: 术语** | Terminology | ✓ In-text term recognition with `首选`/`禁用` tags (forbidden cannot be inserted), quick term capture |
| **Dock 3: QA** | Quality Assurance | ✓ Grouped by rule, severity tags (`⛔ 错误`, `⚠ 警告`, `ⓘ 提示`), dynamic evidence, `修复为` + `应用修复`, waivers (`忽略`, `忽略同类`, `忽略本句`), `恢复为未解决` |
| **Dock 4: AI** | AI Assist & Agent | ✓ Provider configuration form (honest unconfigured state), AI assist (translate/refine) with character diff candidate, Autonomous Agent step execution feed with failure handling & human review gate |
| **Status Bar** | Instrument readout strip | ✓ Status message, segment count, confirmed/draft/untranslated/word counts, clickable 草稿/QA jumps, 行列, INS, Engine lifecycle status |
| **Dialogs & Gates** | Complete modal suite | ✓ 新建项目, 导入文档 (SRX/段落), 项目设置 (General, Import, QA Gate, TM Transfer, Termbase, Archive), 记忆库管理 (Mounts, Priorities, Cascade delete refusal, Entries browser), 术语库管理, 导出覆盖确认, 导出 QA 门拦截, 引擎闸门 |

---

## 3. Scenarios & Smoke Testing

Every prototype supports 8 instant scenario entrypoints via top switcher bar or `?scene=<id>`:

| Scenario ID | Name | Core State Validated |
| :--- | :--- | :--- |
| `projects` | 空项目列表 | No project open: menus degrade, ribbon hidden, project list displayed |
| `grid` | 导入后的网格 | Default working state, TM dock open, editor mounted on segment #10 |
| `confirmed` | 确认写入 TM | Segment #10 confirmed, origin stamped as `100 TM`, propagation reported |
| `locked` | 锁定句段 | Segment #11 locked, read-only, editor mounting blocked |
| `qa` | 模糊未改 QA | QA filter chip active, `qa.unedited-fuzzy` finding on 95% match |
| `ai` | AI 未配置 | AI dock in unconfigured state with provider setup form |
| `agent` | Agent 待审核 | Autonomous Agent execution summary, step log with failure, human audit gate |
| `gate` | 导出 QA 门 | Export blocked by QA error gate with failing rule names |

---

## 4. Rebuilding & Automated Testing

```sh
cd docs/design-studies
node src/build.mjs                       # Builds all 7 self-contained index.html files
node src/shots.mjs                       # Runs 11 scenarios x 7 prototypes -> /opt/cursor/artifacts/design-gemini-plus/
```

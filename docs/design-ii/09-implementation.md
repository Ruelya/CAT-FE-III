# 09 · 落地方案

> 本文只描述**怎么实施**，不实施。分支 `design/translunar-ii` 到此为止只含文档。

---

## 1. 为什么不引入任何新依赖

现有栈：React **19.2.7** · Vite **8.1.5** · Electron **41**（Chromium **146**）· lucide-react · 手写 CSS。

| 候选依赖 | 本设计的替代 | 结论 |
| --- | --- | --- |
| Framer Motion / GSAP | View Transitions API + `@starting-style` + `allow-discrete` + scroll-driven animations + `linear()` | **不引入**。本设计的动效词汇（Seam Wipe）本质是 `clip-path` + `transform`，原生足够 |
| Floating UI / Popper | CSS Anchor Positioning（`position-anchor` / `position-area` / `position-try-fallbacks`） | **不引入** |
| Radix / shadcn | Popover API + `<dialog>` + 原生表单控件 + 自写 roving tabindex | **不引入**。密集编辑器的网格/IME 行为无法被通用组件库满足，包进来只会两头不讨好 |
| Tailwind | `@layer tokens/base/components` + 自定义属性 | **不引入**。9,317 行 `styles.css` 的问题不是"没有 Tailwind"，是没有 token 层与命名约定 |
| TanStack Virtual | 现有窗口化 + `content-visibility` + `contain-intrinsic-size` | **不引入**（现有实现已工作，只需接 Document Matrix 的视口计算） |
| 图表库 | 本设计的"图表"只有堆叠比例条与 Live Matrix，均为 CSS | **不引入** |

**唯一新增资产**：字体 woff2 子集（Jost / IBM Plex Sans / IBM Plex Mono / IBM Plex Sans SC），
全部 SIL OFL，随包分发。替换现有的 Space Grotesk / Chivo / Space Mono / Noto Sans SC。
体积需控制：CJK 用动态子集或按需分片，保证安装包 < 200MB（PRD N-02）。

---

## 2. CSS 架构

### 2.1 现状问题

`styles.css` 9,317 行 + 5 个组件级 CSS（`AlignmentCorpusPanel.css` 720 / `PluginsPanel.css` 699 /
`TaskPackagePanel.css` 612 / `DiscussionSnapshotPanel.css` 720 / `product-shell.css` 208）。
没有层、没有 token、值散落。

### 2.2 目标结构

```
src/renderer/styles/
  00-tokens.css        @layer tokens   — 02-foundations.md §5 全量 token（唯一定义处）
  01-reset.css         @layer base     — reset + 字体 face + 全局排印
  02-primitives.css    @layer base     — .plate / .seam-* / .micro / .num / 焦点环
  03-motion.css        @layer base     — 缓动、View Transition 规则、reduced-motion
  10-components/       @layer components
      button.css  field.css  chip.css  menu.css  popover.css  dialog.css
      drawer.css  toast.css  banner.css  table.css  tabs.css  stepper.css
      progress.css  skeleton.css  empty.css  matrix.css  lamp.css  tag.css
  20-shell/            @layer components
      shell.css  band-spine.css  index-spine.css  instrument.css  cmdk.css
  30-surfaces/         @layer surfaces
      workbench.css  project.css  quality.css  assets.css  ai.css  system.css
  90-overrides.css     @layer overrides — 平台差异、forced-colors、打印
```

```css
@layer tokens, base, components, surfaces, overrides;
```

**规则**：
- token **只在 `00-tokens.css` 定义**，其余文件只消费。
- 组件 CSS 不得出现字面色值、字面字号、字面间距（lint 强制）。
- 插件面板注入的是**只读的 token 快照**，不能改写宿主变量。

### 2.3 命名

BEM 变体：`.block__element` + `data-*` 状态（不用 `--modifier` 类）。
状态一律走 `data-*`，因为它们同时是测试与无障碍的钩子：

```html
<div class="seg-row" data-state="draft" data-active data-selected>
```

---

## 3. 文件映射（现有 → 新）

| 现有文件 | 处置 |
| --- | --- |
| `App.tsx` | **重写外壳**：引入 `Shell`（Band Spine + Index Spine + Surface Slot + Instrument Strip）；Surface 路由改为显式路由表 + View Transition |
| `Workbench.tsx`（5,266 行） | **拆分**：`Workbench.tsx`（编排）/ `SegmentGrid.tsx` / `SegmentRow.tsx` / `FilterRail.tsx` / `Masthead.tsx` / `Stack/`（`MatchList` `TermList` `AssistantDrawer`）/ `PreviewDock/` / `FindReplaceDrawer.tsx` / `EditorPrefsDrawer.tsx`。单文件上限 400 行 |
| `AssistantPanel.tsx` / `LiveAssistantPanel.tsx` / `OfflineAssistantPanel` | 合并为 `Stack/AssistantDrawer.tsx` + 三个状态分支 |
| `WorkbenchPages.tsx` | **删除**。`SurfaceHeader` 的 `…` 导航被 Index Spine 取代；`TranslationMemoryPage` 并入新 `screens/assets` |
| `ProjectHome.tsx`（1,251 行） | 重写版面（35/65），拆出 `ProjectCard` / `SearchTab` / `TemplatesTab` / `RecycleTab` |
| `SetupView.tsx`（822 行） | 重写向导（30/70 + 分组表单 + 新 Stepper） |
| `QaReviewPage.tsx`（1,211 行） | 重写为三栏（分布 / 清单 / 证据）+ 新增 `就地修复` |
| `ExportReviewPage.tsx` | 重写为门禁页 + **新增降级清单区** |
| `ProjectInsightsPage.tsx`（1,677 行） | 版面改竖向 Tab List；各子面板拆成独立文件 |
| `AiControlPage.tsx` | 重写为三 Tab；**新增 Grounding Inspector** |
| `AssetCurationPanel.tsx` | 重写为三段式（选择/分析/应用）+ Live Matrix |
| `AlignmentCorpusPanel.tsx` | 重写对齐视图（连线 + 置信度 + Live Matrix） |
| `PluginsPanel.tsx`（1,752 行） | 重写条目（权限表 §G7 + 诚实声明） |
| `TaskPackagePanel.tsx` / `InteropPanel.tsx` / `DiscussionSnapshotPanel.tsx` | 版面重做，逻辑保留 |
| `ProductSettingsPage.tsx` | 模态 → Surface + 竖向 Tab List |
| `TutorialOverlay.tsx` | 全屏覆盖 → 锚定式 Coach Marks |
| `DraftRecoveryDialog.tsx` | 保留为 Dialog，重做版面 + 新增"复制到剪贴板"逃生通道 |
| `GlobalSearchPanel.tsx` | 并入命令面板 + 首页搜索 Tab |
| `BrandMark.tsx` | 重做（含 Band Echo） |
| `styles.css` + 5 个组件 CSS | 按 §2.2 拆分 |
| **新增** | `Shell.tsx` `BandSpine.tsx` `IndexSpine.tsx` `InstrumentStrip.tsx` `CommandPalette.tsx` `DocumentMatrix.tsx` `LiveMatrix.tsx` `ActiveAxis.tsx` `useViewTransition.ts` `useComposition.ts` `useRovingGrid.ts` `useResizeHandle.ts` |

**不动的东西**（逻辑契约，本次重构不碰）：
`editor-commands.ts` · `workbench-utils.ts` · `assistant-state.ts` · `draft-persist.ts` ·
`session-utils.ts` · `shell-error.ts` · `tutorial-state.ts` · `useFocusTrap.ts` ·
`plugin-provenance-utils.ts` · `asset-curation-utils.ts` · `alignment-corpus-utils.ts` ·
`discussion-snapshot-utils.ts` · `project-home-utils.ts` · `i18n/*` · `@translunar/contracts`。
它们的单测应当全程保持绿色——**这是本次重构"只换前端表达、不动业务契约"的证明**。

---

## 4. 分期计划

按"每期结束都能跑、都能截图评审"切。

### 期 0 · 地基（无可见变化）
1. 建 `styles/` 分层结构与 `@layer` 顺序；把 `00-tokens.css` 写全。
2. 引入四款字体的 woff2 + `@font-face` + 子集脚本。
3. 加 `scripts/check-contrast.py` 到 CI。
4. 加 stylelint 规则：禁字面色值/字号/间距、禁 `>6px` 圆角（`.brand-plate` 除外）、
   禁常驻元素 `box-shadow`、禁 3/5/6/8px 边框。
5. 加 `useComposition.ts` 全局组合态守卫 + `html[data-composing]` 钩子。

**验收**：视觉零变化，CI 全绿，`pnpm typecheck` 通过。

### 期 1 · 外壳
1. `Shell.tsx` + Band Spine + Index Spine + Instrument Strip + Surface Slot。
2. 删除浮动齿轮 FAB 与 `…` overflow 导航。
3. `CommandPalette.tsx`（先接：Surface 跳转、文档切换、段号跳转、设置）。
4. View Transition 路由（`useViewTransition.ts`）。

**验收**：六个 Surface 可用 `Ctrl+1..6` 到达；彩条为竖脊柱；仪表条堆叠比例条数值自洽；
转场在 Reduced Motion 下退化正确。

> **期 1 实施记录**（分支 `implement/ortho-frontend`）
>
> 已完成并在 Electron 实机验证：`Shell` / `BandSpine` / `IndexSpine` / `InstrumentStrip` /
> `CommandPalette` / `useViewTransition` / `useComposition`，`App.tsx` 三条分支统一由 `Shell` 包裹。
> 实测：Band 6px@x=0、Spine 48px、仪表条 30px、六灯随 `Ctrl+1..6` 迁移 Active Axis、
> 命令面板 640px 贴左上（x=94）。
>
> 实施中发现并处理的偏差：
>
> | 偏差 | 处置 |
> | --- | --- |
> | 旧横向彩条存在于 4 处（`WorkbenchPages` / `ProjectHome` / `SetupView` / `Workbench`），与"全屏唯一 Band"冲突 | 4 处全删；`styles.css` 中 4 个 grid 模板里为它预留的 `9px` 行同步删除（否则内容行错位、网格不可见） |
> | 旧状态条与 Instrument Strip 重复显示段计数/保存态 | 删除 `Workbench` 的 `status-bar`，`--status-height` 行从 `.workbench-app` grid 移除 |
> | 旧 `…` 溢出导航在 `Workbench` 与 `WorkbenchPages` 各有一份 | 两份都删；`onReturnHome` / `onNavigate` / `onOpenSettings` 三个 prop 随之从 `WorkbenchProps` 移除 |
> | **删除 `…` 导航会丢失"跳转前 `await persistAllSegments()`"的保证** | 新增 `onRegisterLeaveGuard`：`Workbench` 注册落盘守卫，`App` 在 `goToSurface` / `returnHome` 前 `await`。契约同 §5.1"静默持久化，不拦截" |
> | 深色主题双轨：新 token 用 `:root[data-theme]`，旧 `styles.css` 用 `.workbench-app.theme-dark`（由工作台偏好驱动） | **仍开**。Shell 外壳随 `data-theme` 正确反转，旧 Surface 内容不响应。留到期 8「深色主题全量校对」统一，不做临时 CSS 桥（旧 CSS 无 `@layer`，桥接必然被特异性问题反噬） |
>
> 平台能力实测（Electron 41 / Chromium **146.0.7680.216**）：
> `corner-shape` · `field-sizing` · `interpolate-size` · `anchor-name` · `position-area` ·
> `text-box-trim` · View Transitions · `@starting-style` · `linear()` · scroll-driven animations
> **全部为 true**，§1「不引入任何新依赖」的前提成立。

### 期 2 · 工作台骨架
1. `Masthead` 重做（标识板 bevel + 文档切换器；移除全局搜索框）。
2. `FilterRail` 降到 3 组，其余功能迁到命令面板/快捷键。
3. `DocumentMatrix` + 网格滚动接管（隐藏原生滚动条）。
4. `ActiveAxis` 单例 + 各驻留位接线。

**验收**：Matrix 与滚动/筛选/跳转完全一致；全屏仅一条 Axis；筛选栏无裁切。

#### 期 2 实现记录（2026-04）

| 交付 | 位置 | 说明 |
| --- | --- | --- |
| `Masthead` | `components/workbench/Masthead.tsx` | 真实项目名 / 语向 / 文件数；`brand-plate` 为唯一 45° bevel；文档切换走 `persistAllSegments` → `onOpenDocument`；常驻全局搜索控件移除，`Ctrl+Shift+K` 仍开 `GlobalSearchPanel`，关闭后焦点回 `editor-region` |
| `FilterRail` | `components/workbench/FilterRail.tsx` | 三组：状态 chip（All/Untranslated/Draft/Confirmed/Issues）· 匹配选择器 · 问题导航。移除文内搜索 / Exact TM 装饰条 / 命令条 / Confirm |
| 匹配选择器 | 同上 | 词汇表完整呈现；**仅 `All` 为 live**；其余 option `disabled` +「暂缓/Deferred」，**不**写入 Engine/RPC，不合成分数或桶计数 |
| `DocumentMatrix` | 既有组件 + `Workbench` 挂载 | 置于段落网格左侧；`segmentStates` 按**文档 ordinal** 投影到 `counts.total`（未知位 `null` 中性空心；混合未知桶不染色）；`viewportRange` 由网格 `scrollTop` 映射到 ordinal；`onNavigate` → 按 ordinal seek + `scrollIntoView`（不抢译文焦点）；滚轮/视口括号/键盘转发给 `.segment-grid` 唯一滚动所有者；原生滚动条隐藏；标题+图例走 i18n |
| `ActiveAxis` | `components/workbench/ActiveAxis.tsx` | Workbench 内至多一个 `[data-axis="active"]`；活动行优先于 chip；关闭旧 `.id-cell::before` 轴伪元素；不触碰 Index Spine 壳层标记 |
| 布局宿主 | `Workbench` 根 `workbench-app` | **期 2 有意保留 legacy flex 骨架**（`workbench-layout` / `editor-column` / `editor-grid-row`），不挂载设计稿 `.wb` CSS grid 与 `data-stack` 区划。Masthead / FilterRail / Matrix 邻接在 flex 上交付；`.wb` 规则暂为死 CSS，待期 4 Stack/预览联动时再迁。支持宽度仍以设计稿 1250 / 1680 / 1920 为验收参照，但响应式折叠列属后续 |

**未做（明确 out of scope）**：期 3 单元格几何、期 4 Stack（含挂载 `.wb` + `data-stack`）、深色双轨桥、全量 match 桶投影、contract/engine/preload 变更。

### 期 3 · 网格与单元格
1. 行几何重做（板块+缝、状态方灯 8 形、行内动作条移到列间缝）。
2. 译文单元格（`field-sizing` + IME 契约 + 焦点即 Axis）。
3. 标签胶囊（配对高亮、缺失/错序、`Alt+←/→` 移动）。
4. roving tabindex（`useRovingGrid.ts`）+ 多选与批量条。
5. 内联 QA 条。

**验收**：1 万段 P95 ≤ 33ms；IME 十项测试全过；键盘全流程可走；axe 无 serious。

#### 期 3 实现记录（2026-08）

| 交付 | 位置 | 说明 |
| --- | --- | --- |
| `SegmentGrid` | `components/workbench/SegmentGrid.tsx` | `role="grid"` + 虚拟 spacer + 共享 `ResizeObserver` 行高缓存 + BatchBar 挂载；滚动仍由网格根节点承担（Matrix 所有权不变） |
| `SegmentRow` | `components/workbench/SegmentRow.tsx` | 板块+缝四列行：ID / 方灯 / 原文 / 译文；`data-active`/`data-selected`；无卡片圆角投影 |
| `SegmentStatusLamp` | `components/workbench/SegmentStatusLamp.tsx` | 八态形状编码（空心/半填/实心/缺角/外框/叉/斜杠/横条）+ 本地化名；forced-colors 保形 |
| `TagCapsule` | `components/workbench/TagCapsule.tsx` | 配对高亮、缺失/错序钩子、`Alt+←/→` 移动意图；不解析 XML |
| `SeamActionRail` | `components/workbench/SeamActionRail.tsx` | 原文/译文列间缝 24px 动作条：最佳匹配 / 批注 / 更多；hover·focus-within 可见 |
| `InlineQaStrip` | `components/workbench/InlineQaStrip.tsx` | 行内 QA/标签问题条；Locate / Ignore 走既有回调意图 |
| `BatchBar` | `components/workbench/BatchBar.tsx` | 多选 36px 批量条；Confirm / Clear / Lock / Pretranslate(占位) / Comment / Cancel |
| `useRovingGrid` | `hooks/useRovingGrid.ts` | 单 Tab 停 · 四向导航 · Enter 编辑 · Esc 导航/清多选 · Ctrl+Shift+A · 组合态优先 |
| 编排 | `Workbench.tsx` | 行视图模型 join + 选择态 + 批量适配既有 `segment.confirm` / `updateTarget` / `workflow.set`；不改 engine/contracts/草稿/leave-guard |
| 样式 | `styles/30-surfaces/workbench.css` | plate/seam、方灯、胶囊、批量条、内联 QA、`field-sizing`、`scroll-margin-block: 96px`、`html[data-composing]` |
| i18n | `i18n/messages.ts` | 方灯名 / 选择计数 / 批量 / 内联 QA / 标签态 en+zh |

**未做 / 残留（Phase 4+ 或后续）**：
- 批量 Pretranslate 无文档级选中 ID 适配器（导向 AI Control 面；未新增 engine 路径）
- 内联 Ignore：QA 发现已 `prompt` 理由并调用 `qa.issue.waive`；标签结构发现仍不可 waive；完整 Stack QA 表单仍在后续 QA Surface
- 批量 Lock：无 collab 选中 ID 适配器时禁用并 deferred toast（禁止 bulk-sign）
- `aria-activedescendant` 跨虚拟窗口 seek 握手的 E2E 与 IME 十项 Electron 全量、axe、1 万段 P95 同机基线 trace 待质量环
- 原文侧 `TaggedText` 内联胶囊与 `TagCapsule` 配对高亮尚未完全双向同步（缺失标签已用胶囊表达）
- 列宽拖拽 / 可选 match-source 列仍属后续

### 期 4 · Stack 与预览坞
1. Stack 改常驻双区 + AI 抽屉；单一折叠控件。
2. 匹配卡（词级 diff 改删除线/下划线）与术语条。
3. Grounding Inspector。
4. 预览坞（真实页面结构 + 定位淡染 + 弹出窗口 + PDF 双栏对照）。

**验收**：TM 与术语同屏可见；无双向箭头/悬浮胶囊；接地内容可检查。

#### 期 4 实现记录（2026-08）

| 交付 | 位置 | 说明 |
| --- | --- | --- |
| `StackPanel` | `components/workbench/Stack/StackPanel.tsx` | 替换 `SuggestionsPanel` 四标签；Matches + Terms 常驻同屏；单一折叠控件 → 40px rail；`inert`/`aria-hidden` + 焦点迁移保留 |
| `MatchList` / `MatchCard` | `Stack/MatchList.tsx` · `MatchCard.tsx` | 规则分隔卡；100% 档位 + 项目 TM + 日期；`wordDiff` 词级 `del`/`ins`（删除线/下划线，无色块） |
| `wordDiff` | `Stack/wordDiff.ts` + 单测 | 纯函数 LCS 分词 diff；无新依赖 |
| `TermList` / `TermRow` | `Stack/TermList.tsx` · `TermRow.tsx` | `原文 → 译文` + 首选/禁用/待定 chip；禁用用 `--err-ink` |
| `AssistantDrawer` | `Stack/AssistantDrawer.tsx` | 底栏抽屉默认收起；展开挂载既有 `AssistantPanel` / `PluginAiActions` / `PluginWorkbenchPanels` |
| `GroundingInspector` | `Stack/GroundingInspector.tsx` | 抽自 Live 面板；仅有真实 `PromptBundle` 时展示可检视段落；`LiveAssistantPanel` 改用此组件 |
| `PreviewDock` | `components/workbench/PreviewDock/PreviewDock.tsx` | 从 `Workbench` 抽出原 `DocumentPreview`；跟随段 + 信号淡染左缘；PDF 图文双栏保留；`window.open` 弹出（失败则禁用并诚实文案） |
| 编排 | `Workbench.tsx` | `suggestionTab` → `assistantOpen`；去掉 Stack 内 QA 标签（QA 行内 + 后续 Surface）；`suggestionsMode: maximized` 读偏好时夹到 `docked`；最大化对等箭头已从 Stack 移除 |
| 样式 | `styles/30-surfaces/workbench-stack.css` | 双区 flex、AI 抽屉展开、预览 `[data-preview-active]` |
| i18n | `i18n/messages.ts` | 术语态 / 抽屉 / 接地条目 / 预览弹出 en+zh |
| 布局宿主 | legacy flex | **仍不挂载**设计稿 `.wb` + `data-stack` 区划（与 Matrix 滚动所有权解耦；双区 Stack 在 flex 上交付） |

**未做 / 残留**：
- `.wb` CSS grid 宿主与 `data-stack=collapsed|overlay` 响应式覆盖列未挂载（死 CSS 仍在 `workbench.css`；双区 Stack + 预览坞已可用）
- 弹出预览为 `window.open` 尽力路径，非完整第二显示器 BrowserWindow 同步会话；环境拦截时控件禁用
- 匹配/术语区间缝可拖高度与比例持久化未做
- TM 分数仍为 100% exact 展示（无模糊分桶 engine）
- 术语添加对话框 / hover 定义 popover 无新 RPC，未发明后端
- Stack 折叠宽度仍走既有 `.suggestions-panel` / `.suggestions-collapsed` 与偏好键

### 期 5 · 项目类页面
项目首页（35/65 + 卡片 FLIP 转场）、新建向导（30/70 + 分组表单 + 新 Stepper）、
洞察（竖 Tab + 概览动作绑定 + 各子面板）。

#### 期 5 实现记录（2026-08）

| 交付 | 位置 | 说明 |
| --- | --- | --- |
| `ProjectHome` 35/65 | `ProjectHome.tsx` + `components/project/*` | 删除常驻四项侧栏；构图栏 + §E2 横向 Tabs（项目/搜索/模板/回收站，计数上标签）；刷新在左栏底部 |
| `ProjectCard` / panes | `ProjectCard.tsx` · `ProjectsPane` · `TemplatesPane` · `RecyclePane` | 板块+缝网格；3px Band Echo；4px 进度；归档降饱和+角标；溢出菜单；清除需名称确认 |
| `project-open` FLIP | card `data-opening` + Masthead `.identity` | 共享 `view-transition-name: project-identity`；`useViewTransition("surface")`；reduced-motion 直切 |
| `SetupView` 30/70 | `SetupView.tsx` + `Stepper` · `CompositionRail` | §E5 两位 Mono 步进；删除右侧装饰信息栏与 SQLITE 芯片；步骤 2 复用/质量/自动化分组 + 后果 meta |
| `ProjectInsightsPage` | 编排 + `components/project/insights/*` | §E3 竖向分组 Tab（~180px）；概览块决策动作 + 诚实 residual；子面板拆出 |
| 样式 | `styles/30-surfaces/project-home.css` · `setup.css` · `insights.css` | 新 surface 层；`styles.css` 旧壳/横 Tab/卡片布局规则已中和 |
| i18n | `i18n/messages.ts` | 首页摘要/归档角标/清除确认、向导分组与 meta、洞察分组与动作 en+zh |

**验收**：AC1–AC14（布局/契约/步进/竖 Tab/概览动作/抽取/i18n）；`project-home-utils` 与 messages 单测绿；desktop typecheck 绿。

**未做 / 残留**：
- 跨项目 TM/术语/语料总量无 RPC → 左栏仅展示本页可得项目/模板/回收计数
- 概览「打开质检 / AI 控制」无父级路由时为 residual 文案（可选 `onOpenQa` / `onOpenAiControl`）
- 工作区路径更改字段未实现（原 API 无）
- 永久清除名称确认已实现；模板「另存为」/重命名/导出归档若原先不在首页菜单则未发明
- `styles.css` 中部分旧 project-card 子选择器仍存在但已用 `.legacy-*` 前缀隔离布局冲突

### 期 6 · 质量与资产
QA 复核三栏 + 就地修复；导出复核 + 降级清单；资产 Surface 五 Tab（TM / 术语 / 养护 / 对齐 / 互操作）。

#### 期 6 实现记录（2026-08）

| 交付 | 位置 | 说明 |
| --- | --- | --- |
| QA 三栏 | `QaReviewPage.tsx` + `components/quality/*` | 分布 / 清单 / 证据；Live Matrix 投影已加载问题；严重度 chip；队列并入清单次级分组 |
| 就地修复 | `QaEvidencePanel` | `segment.updateTarget`（与 Workbench 同形）；Ctrl+Enter 保存并下一条；span 高亮 |
| 配置档抽屉 | `QaProfileDrawer` | 420px 抽屉；clone/update + 强制审校 `project.update` |
| 导出门禁 | `ExportReviewPage` + `ExportGate*` | §A8 横幅；四项门禁行；覆盖导出；**查看问题 →** `qa-review` |
| 降级清单 | `ExportDegradationList` | 导出前 `document.degradation`；导出后 `ExportDocumentResult.degradation` |
| 资产五 Tab | `components/assets/AssetsSurface` | 默认 **养护**；TM / 术语 hub；挂载既有养护/对齐/互操作面板 |
| 样式 | `styles/30-surfaces/quality.css` · `assets.css` | 新 surface 层；`styles/index.css` 引入 |
| i18n | `i18n/messages.ts` | 三栏/门禁/降级/资产 Tab/就地修复 en+zh |

**验收**：AC1–AC14（三栏/证据/就地修复/门禁/降级/五 Tab/RPC 不变/诚实计数/i18n）；`qa-presenters` 单测；desktop typecheck。

**未做 / 残留**：
- Live Matrix 仅投影当前页已加载 issues（PAGE_SIZE）；无全量聚合 RPC
- 就地修复为纯文本译文编辑器；TagCapsule 与 Workbench 完全对等未做
- 导出页额外格式（双语 DOCX / XLIFF / TMX）不在本页接线，残差文案指向互操作
- TM 健康分桶无后端 → 诚实 residual；无假遥测数字
- TaskPackagePanel 仍仅 Insights「流程」Tab，不进资产五 Tab
- 审校者队列仅「打开段」；无新 accept/reject RPC
- Insights 仍 dual-host 养护/对齐/互操作面板

### 期 7 · AI 与插件
AI 控制台三 Tab；划词 AI 锚定菜单；一致性修复助手；插件权限表与宿主归属条。

#### 期 7 实现记录（2026-08）

| 交付 | 位置 | 说明 |
| --- | --- | --- |
| AI 控制台三 Tab | `AiControlPage.tsx` + `components/ai/ai-presenters.ts` | ORTHO 头栏（启用灯 + 全部关闭）+ §E2 三 Tab（引擎与配置档 / 批处理 / 用量）；配置档 master–detail；凭据仅状态不回显；用量堆叠条 + 预算门禁；接地为工作台 residual |
| 划词 AI 菜单 | `components/workbench/SelectionAiMenu.tsx` + `PluginAiActions` | 选区锚定 §A4；`editorSelection`/`menu`；IME 组合态不打开；可选 `selectionText` 入 invoke context；内置润色无 RPC → residual 省略 |
| 一致性修复 | `ConsistencyRepairToast/Drawer` + `consistency-presenters.ts` | 术语插入后客户端扫描已加载段；toast → 抽屉勾选；`segment.updateTarget` 顺序应用；无多段撤销 residual |
| 插件 G7 + 宿主条 | `PluginsPanel.tsx` + `PluginPanelHost.tsx` + `plugin-permission-presenters.ts` | 贡献计数 + 权限表 + Tier3/OS 诚实声明；24px「插件：名称」归属条（iframe 外） |
| 样式 | `styles/30-surfaces/ai.css` · `plugins.css` | 新 surface 层；`styles/index.css` 引入 |
| i18n | `i18n/messages.ts` | 三 Tab 标签、全部关闭、权限状态、诚实文案、toast/抽屉、宿主条 en+zh |

**验收**：AC1–AC13（三 Tab/启用与关闭/master–detail/接地 residual/RPC 不变/用量诚实/划词菜单/一致性/G7/宿主条/i18n）；`ai-presenters` · `consistency-presenters` · `plugin-permission-presenters` · SelectionAiMenu 单测；desktop typecheck。

**未做 / 残留**：
- AI 控制台无活动段 → 接地预览无法调用 `ai.grounding.preview`（诚实 residual，不标「已接地」）
- 内置 G-01 润色菜单无 Engine 路径 → 仅插件 `editorSelection` 动作
- 一致性扫描仅已加载段；上限 200 行 + residual
- 无多段撤销 API → 抽屉内诚实 residual
- 批处理 Live Matrix 可选未挂（item 列表已保留真实状态）
- 插件「报告问题」无 RPC → 菜单项 residual disabled

### 期 8 · 系统与收尾
设置 Surface；Coach Marks 教程；草稿恢复；三态统一；深色主题全量校对；
高对比模式；三档密度 × 三档缩放的截图矩阵。

#### 期 8 实现记录（2026-08）— **ORTHO 前端分期收尾**

| 交付 | 位置 | 说明 |
| --- | --- | --- |
| 主题单源 | `components/system/theme-controller.ts` | `light\|dark\|system` → resolve → `documentElement.dataset.theme`；localStorage `translunar.theme.v1`；关闭 `.workbench-app.theme-dark` 双轨 |
| 密度 × 缩放 | `appearance-controller.ts` | `data-density` + `--ui-scale`（0.8–1.6）；与编辑器 `--editor-zoom` 正交；Ctrl+Alt+[ / ] 循环密度 |
| 设置 Surface | `ProductSettingsPage.tsx` + `settings-presenters.ts` + `30-surfaces/settings.css` | 非 modal；§E3 纵向 Tab（应用/数据/引擎/其他）；外观即时生效；深链 `settingsSection`；Surface Slot 挂载 |
| Coach Marks | `TutorialOverlay.tsx` | 锚定 popover + signal ring；无全屏遮罩/文档焦点陷阱；Esc 跳过；reducer 契约不变 |
| 草稿恢复 | `DraftRecoveryDialog.tsx` + `draft-recovery-presenters.ts` | 多选（过时默认关）；批量丢弃确认；剪贴板多段拼接；顺序恢复；§D8 wordDiff 可选 |
| 三态 | `SurfaceStates.tsx` | Loading/Empty/Error 原语；renderer 内 `LoaderCircle`+`.spin` 清零 |
| Forced-colors | `styles/01-reset.css` | 全局 system color map；elev 关闭；灯保留 `forced-color-adjust: none` |
| Legacy 别名 | `00-tokens.css` + `styles.css` `:root` | `--bg/--surface/...` → ORTHO tokens；深色仅靠 `data-theme` |
| 证据矩阵 | `evidence/screenshot-matrix.md` · `docs/design-ii/reference/density-zoom-screenshot-matrix.md` | 3×3 清单 + 通过准则；PNG 捕获 deferred |
| i18n | `i18n/messages.ts` | 设置分组、外观、草稿批量、coach 进度 en+zh |

**验收**：AC1–AC12（设置 Surface / RPC 保留 / 外观 / 深链 / coach / 草稿 / 三态 / 单源深色 / forced-colors / 矩阵 / i18n / typecheck+单测）。

**未做 / 残留**：
- 密度×缩放 PNG 实拍未做（无引擎截图农场）→ 清单与准则已落盘
- 教程 step 枚举仍为 7 步；未强行改为设计稿 5 步（presentation 映射）
- 快捷键编辑器无 store → residual 预设列表
- Global search 并入命令面板不在本期范围
- 部分面板 busy 仅文案、骨架未全量替换为 SurfaceLoading 组件（已无圆形 spinner）

**双轨关闭说明（给后续 agent）**：颜色唯一驱动为 `:root[data-theme]` + `00-tokens.css`。禁止再为 `.workbench-app.theme-dark` 写调色板。Workbench 偏好主题控件写同一 `theme-controller`。

---


## 5. 迁移风险与对策

| 风险 | 对策 |
| --- | --- |
| `Workbench.tsx` 5,266 行拆分引入回归 | 先补齐 `editor-commands.ts` / `workbench-utils.ts` 的单测覆盖，再拆；拆分只搬运不改逻辑，一次一个组件 |
| 隐藏原生滚动条后无法滚动（可访问性/习惯） | 保留滚轮、键盘、触控板惯性；Matrix 提供等效交互；设置里给"显示原生滚动条"逃生开关 |
| Index Spine 占用宽度引起反弹 | `Ctrl+\` 可隐藏并持久化；<1024px 自动隐藏 |
| View Transition 在长列表上卡顿 | Surface Slot 用 `contain: layout paint`；转场只捕获 Slot，不捕获 Spine/Band/仪表条；1 万段场景实测后再定 |
| `corner-shape` 只有 Chromium 有 | 产品是 Electron 独占，无跨浏览器需求；`@supports not` 退化为直角（不伪造） |
| 新字体的 CJK 体积 | 按需分片 + `unicode-range`；只随包分发常用字集，其余走系统字体 fallback |
| 一次性推翻导致长期不可用状态 | 分期 0–8 每期可发布；期 1 之后旧 `…` 导航即删除，不做双轨 |
| i18n 文案要重写（大量违规文案） | 期 0 先出**文案审计表**：扫 `messages.ts` 5,605 行，标出装饰性/营销/规则 ID 直出的条目，逐期替换 |

---

## 6. 定稿验收（全局）

### 6.1 自动化

| 检查 | 工具 |
| --- | --- |
| 对比度 | `scripts/check-contrast.py` |
| 无障碍 | `@axe-core/playwright` 覆盖 6 Surface + 12 个主要叠层 |
| 字号下限 | Playwright 断言：所有可见文本计算后 `font-size` ≥ 11px |
| 单轴 | Playwright 断言：`[data-axis="active"]` 数量 ≤ 1 |
| 单彩条 | Playwright 断言：`.band-spine` = 1，`.band-echo` ≤ 1 |
| 单切角 | Playwright 断言：每 Surface `corner-shape: bevel` ≤ 1 |
| 无浮层 | 断言：非 `[popover]`/`dialog`/`.toast` 元素的 `box-shadow` = `none` |
| 无 spinner | 源码扫描：不存在 `LoaderCircle` + `.spin` 组合 |
| token 纪律 | stylelint：组件 CSS 无字面色值/字号/间距 |
| 性能 | Playwright trace：1 万段滚动 P95 帧时间 ≤ 33ms |

### 6.2 人工

截图矩阵：`1250×744 / 1680×942 / 1920×1080` × `浅/深` × `紧凑/标准/宽松` = 18 张主工作台，
外加每个 Surface 的浅/深各一张。逐张对照 `01-art-direction.md §5` 禁止清单与
`screens/workbench.md §10` 验收清单。

### 6.3 十条终判（`README.md §4` 的复述）

1. 先像翻译软件。
2. 每个非标准图形都能说出它解决的可用性问题。
3. 彩条恰好一次，固定顺序，无语义。
4. 矩阵要么编码真实数据且可交互，要么低于所有边框且不可交互。
5. 大底是非彩色层理，"越亮=越可编辑"不被打破。
6. 橙色 ≤1.5%，全屏一条 Active Axis。
7. 数字自洽，无假遥测。
8. 键盘可完成全部主流程，IME 期间零打扰。
9. Reduced Motion 下功能反馈不丢。
10. 深色是层理反转，不是反色。

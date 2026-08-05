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

### 期 2 · 工作台骨架
1. `Masthead` 重做（标识板 bevel + 文档切换器；移除全局搜索框）。
2. `FilterRail` 降到 3 组，其余功能迁到命令面板/快捷键。
3. `DocumentMatrix` + 网格滚动接管（隐藏原生滚动条）。
4. `ActiveAxis` 单例 + 各驻留位接线。

**验收**：Matrix 与滚动/筛选/跳转完全一致；全屏仅一条 Axis；筛选栏无裁切。

### 期 3 · 网格与单元格
1. 行几何重做（板块+缝、状态方灯 8 形、行内动作条移到列间缝）。
2. 译文单元格（`field-sizing` + IME 契约 + 焦点即 Axis）。
3. 标签胶囊（配对高亮、缺失/错序、`Alt+←/→` 移动）。
4. roving tabindex（`useRovingGrid.ts`）+ 多选与批量条。
5. 内联 QA 条。

**验收**：1 万段 P95 ≤ 33ms；IME 十项测试全过；键盘全流程可走；axe 无 serious。

### 期 4 · Stack 与预览坞
1. Stack 改常驻双区 + AI 抽屉；单一折叠控件。
2. 匹配卡（词级 diff 改删除线/下划线）与术语条。
3. Grounding Inspector。
4. 预览坞（真实页面结构 + 定位淡染 + 弹出窗口 + PDF 双栏对照）。

**验收**：TM 与术语同屏可见；无双向箭头/悬浮胶囊；接地内容可检查。

### 期 5 · 项目类页面
项目首页（35/65 + 卡片 FLIP 转场）、新建向导（30/70 + 分组表单 + 新 Stepper）、
洞察（竖 Tab + 概览动作绑定 + 各子面板）。

### 期 6 · 质量与资产
QA 复核三栏 + 就地修复；导出复核 + 降级清单；资产 Surface 五 Tab（TM / 术语 / 养护 / 对齐 / 互操作）。

### 期 7 · AI 与插件
AI 控制台三 Tab；划词 AI 锚定菜单；一致性修复助手；插件权限表与宿主归属条。

### 期 8 · 系统与收尾
设置 Surface；Coach Marks 教程；草稿恢复；三态统一；深色主题全量校对；
高对比模式；三档密度 × 三档缩放的截图矩阵。

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

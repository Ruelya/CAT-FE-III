# 04 · 动效系统

> 立场：动效**不是装饰**，是**空间说明书**——告诉用户新东西从哪来、旧东西去了哪。
> 全应用只有一个动作词汇：**沿结构缝行进的遮罩推移（Seam Wipe）**。
> 零依赖：不引入 Framer Motion / GSAP / react-spring。全部用 Chromium 146 的原生能力。

---

## 1. 时间尺度（五档）

| 档 | Token | 时长 | 适用 |
| --- | --- | --- | --- |
| **L0 微反馈** | `--d-micro` | 90ms | hover、按下、焦点、快捷键回执、方灯变色 |
| **L1 状态** | `--d-state` | 140ms | 选中、确认、保存、筛选、标签、Axis 迁移 |
| **L2 局部空间** | `--d-local` | 200ms | 预览坞、Stack 折叠、popover、抽屉、行展开 |
| **L3 页面** | `--d-page` | 280ms | Surface 切换、文档切换、向导步进 |
| **L4 低频构图** | `--d-slow` | 420ms | 首页/空态/向导的一次性图形揭示（**仅低频页面**） |

**硬约束**：任何工作台动作**不等待动画**。状态变更立即生效（DOM/焦点/持久化先行），动画只是追赶。

## 2. 缓动

```css
--ease-in:   linear(0,.22 3.5%,.42 7.2%,.6 11.2%,.75 15.7%,.87 20.9%,.95 26.9%,1 36%,1);
             /* 进入：类弹簧、无过冲。用 linear() 逼近临界阻尼，不引物理库 */
--ease-move: cubic-bezier(.2,.8,.2,1);   /* 位移/尺寸变化 */
--ease-out:  cubic-bezier(.4,0,1,1);     /* 退出：快离场 */
```

规则：**进入用 `--ease-in`，退出用 `--ease-out`，退出时长 = 进入的 60–70%**。
位移与尺寸一律 `--ease-move`。**禁止 `linear`**（除跟手拖拽外）。**禁止 `ease`/`ease-in-out` 默认值**。

## 3. 七套编排

### 编排 A · Surface 转场（L3）— "缝上推移"

切换顶层页面（工作台 ↔ QA 复核 ↔ 洞察 ↔ 设置…）。

**关键帧语义**：旧层保留在 70% 强度**不移动**；新层从 20px 外沿方向进入并盖住它。
方向由层级决定：**深入 = 从右下进入；返回 = 从左上进入**。
Band Spine 提前 40ms 开始扫掠（`03-signatures.md §1.5`）。

```ts
export type Dir = "in" | "out";
export function navigateSurface(next: () => void, dir: Dir) {
  document.documentElement.dataset.transition = "surface";
  const done = () => { delete document.documentElement.dataset.transition; };
  if (!document.startViewTransition || prefersReduced()) { next(); done(); return; }
  const vt = document.startViewTransition({
    update: next,
    types: [dir === "in" ? "surface-in" : "surface-out"],
  });
  vt.finished.finally(done);
}
```

```css
::view-transition-group(surface) { animation-duration: var(--d-page); }
::view-transition-old(surface),
::view-transition-new(surface)   { animation-timing-function: var(--ease-move); mix-blend-mode: normal; }

/* 旧层：不动，只降到 70% */
html:active-view-transition-type(surface-in, surface-out)::view-transition-old(surface) {
  animation: sf-dim var(--d-page) var(--ease-out) both;
}
@keyframes sf-dim { to { opacity: .7 } }

html:active-view-transition-type(surface-in)::view-transition-new(surface) {
  animation: sf-enter-in var(--d-page) var(--ease-in) both;
}
@keyframes sf-enter-in {
  from { translate: 20px 12px; opacity: 0; clip-path: inset(0 0 0 100%) }
  to   { translate: 0 0;       opacity: 1; clip-path: inset(0 0 0 0) }
}
html:active-view-transition-type(surface-out)::view-transition-new(surface) {
  animation: sf-enter-out var(--d-page) var(--ease-in) both;
}
@keyframes sf-enter-out {
  from { translate: -20px -12px; opacity: 0; clip-path: inset(0 100% 0 0) }
  to   { translate: 0 0;         opacity: 1; clip-path: inset(0 0 0 0) }
}

/* 恒定元素不参与捕获 */
.band-spine, .index-spine { view-transition-name: none; }
```

### 编排 B · Active Axis 迁移（L1）

见 `03-signatures.md §3.4/3.5`。同容器 160ms FLIP；跨容器分两段（收 80ms / 展 100ms），**不飞越**。

### 编排 C · 面板局部空间（L2）

**Stack 折叠**（420px → 40px 轨道）：
1. 面板内容 `opacity → 0`（100ms）
2. 网格**立即**解算到最终宽度（0ms，不等待）
3. 面板壳用 FLIP 变形为轨道（190ms，`--ease-move`）
4. chevron 方向**在目标状态提交后**才翻转
5. 键盘焦点**立即**移动到轨道按钮，不等动画

**预览坞升起**：容器 220ms 自底进入；文档内容延迟 60ms 后 120ms 淡入；关闭 160ms。
拖拽调整高度**跟手无缓动**；松手吸附 ≤100ms。焦点与活动行**不移动**。

```css
.dock {
  block-size: var(--dock-h);
  transition: block-size var(--d-local) var(--ease-move),
              opacity 120ms var(--ease-in) 60ms,
              overlay var(--d-local) allow-discrete,
              display var(--d-local) allow-discrete;
  interpolate-size: allow-keywords;      /* 支持 auto 高度过渡 */
}
.dock[data-collapsed] { block-size: 32px; }
@starting-style { .dock { block-size: 32px; opacity: 0 } }
.dock[data-resizing] { transition: none }   /* 拖拽期间跟手 */
```

### 编排 D · 段落确认（L1）— 最高频动作，最严纪律

按 `Ctrl+Enter`：

| t | 事件 |
| --- | --- |
| 0ms | **持久化请求发出**；状态方灯**立即**由半填 → 实心（100ms 填充过渡） |
| 0ms | Document Matrix 对应点同步变为实心（120ms） |
| 0–140ms | Active Axis 在当前行收缩（`scaleY 1→.2`） |
| 140–160ms | 行底色由 `--shade` 归位到 `--deck`（160ms） |
| **持久化成功后** | 焦点前进到下一段；Axis 在新行展开（100ms） |
| 持久化失败 | 方灯回滚 + 行前缘变红 200ms + 内联错误；焦点**不动** |

**绝对禁止**：在 `compositionstart` → `compositionend` 之间执行确认、移焦、面板切换、
或对译文单元格做任何高度动画。见 `07-interaction.md §3`。

### 编排 E · 矩阵点燃（L2，一次性）

Live Matrix 首次挂载或数据集整体替换时，沿**对角线**扫掠点亮，单点 260ms、行进步长 0.9ms/点。
1,248 点 → 总时长约 1.4s，但**不阻塞任何交互**（点在动画期间已可点击）。
之后**永不重播**；单点状态变化只做 120ms 局部过渡。

### 编排 F · AI 流式输出（L1，唯一允许的循环）

- 按**可读语义块**追加（短语/子句），每块 60–80ms 淡入。**禁止逐字打字机效果**。
- 一条 2px 进度轨（`--signal`）在面板头循环，**仅在请求真正进行中**，完成后 140ms 内消失。
- 取消：立即停止，已生成内容保留并标注"已停止"。

```css
@property --rail-x { syntax: "<percentage>"; inherits: false; initial-value: -40% }
.ai-rail[data-active] {
  background: linear-gradient(90deg, transparent, var(--signal) 50%, transparent);
  background-size: 40% 100%;
  background-position-x: var(--rail-x);
  animation: rail 1100ms linear infinite;
}
@keyframes rail { to { --rail-x: 140% } }
```

### 编排 G · QA 导航（L1/L2）

- **近距离**（目标在 ±30 行内）：160–180ms 平滑滚动。
- **远距离**：`scrollTo({behavior:"instant"})` 跳到目标附近 → 目标行 220ms 定位高亮
  （`--signal-wash` 淡入 80ms → 保持 60ms → 淡出 80ms）。
  **绝不**穿越数百行做电影式长滚动。

### 编排 H · 文档切换（L3 变体）

工具条、列结构、预览框架、面板几何**全部保持不动**（它们不参与转场捕获）。
只有网格内容与 Document Matrix 交换：旧内容 100ms 淡出 / 新内容 160ms 淡入，方向位移 ≤8px。
成功加载后 Band Spine 做一次 240ms 扫掠。

## 4. 弹层与临时层（`@starting-style` + `allow-discrete`，零 JS）

```css
[popover] {
  border: 1px solid var(--rule-strong);
  border-radius: var(--r-pop);
  background: var(--deck);
  box-shadow: var(--elev-pop);
  position-anchor: --trigger;           /* CSS Anchor Positioning */
  position-area: block-end span-inline-end;
  position-try-fallbacks: flip-block, flip-inline;
  opacity: 0; translate: 0 -6px;
  transition: opacity var(--d-local) var(--ease-in),
              translate var(--d-local) var(--ease-in),
              display var(--d-local) allow-discrete,
              overlay var(--d-local) allow-discrete;
}
[popover]:popover-open { opacity: 1; translate: 0 0 }
@starting-style { [popover]:popover-open { opacity: 0; translate: 0 -6px } }

dialog::backdrop {
  background: var(--scrim);
  opacity: 0;
  transition: opacity var(--d-local) var(--ease-in), display var(--d-local) allow-discrete;
}
dialog[open]::backdrop { opacity: 1 }
@starting-style { dialog[open]::backdrop { opacity: 0 } }
```

**规则**：模态从**触发源的位置**放大进入（`transform-origin` 由 anchor 推出），
关闭时收回触发源。不做背景模糊。遮罩不做模糊。

## 5. 滚动驱动（无 JS 的粘性状态）

```css
/* 网格滚动时，列头获得结构缝与压深底 —— 用 scroll-driven animation，不用 IntersectionObserver */
@keyframes head-pin {
  to { background: var(--shade); border-block-end-color: var(--rule-strong) }
}
.grid-head {
  animation: head-pin linear both;
  animation-timeline: scroll(nearest block);
  animation-range: 0 24px;
}
```

## 6. 禁止清单

- ❌ 循环动画，**除非**对应一个真实进行中的操作（AI 生成、导入、导出、批量 QA、同步）
- ❌ 背景轨道、彩条、纹理、方灯、活动行、装饰文字、星芒的任何循环
- ❌ 圆形 spinner（一律用与最终布局同形的骨架屏）
- ❌ 逐字打字机、文字逐词浮现、网格文本的任何入场动画
- ❌ 动画 `width` / `height` / `top` / `left` / `margin`（只动 `transform` / `opacity` / `clip-path`）
- ❌ 视差、3D 翻转、旋转 >15°、缩放 >1.06
- ❌ 队列式动画（新动画必须**取消**被取代的旧动画，不排队）
- ❌ 同一时刻 >2 个主要动画

## 7. 性能预算与验收

| 项 | 目标 |
| --- | --- |
| 交互帧时间 P95 | ≤ 33ms（PRD C 验收） |
| 动画属性 | 仅 `transform` / `opacity` / `clip-path` / `background-position` |
| 合成层 | 同时 ≤ 6 个 `will-change`；动画结束立即移除 |
| 虚拟列表 | 1 万段：`content-visibility: auto` + `contain-intrinsic-size` + 窗口化 |
| 验收场景 | 1 万段列表 + Stack 展开 + 预览展开 + 125% 文本缩放 + Document Matrix 拖拽，同时进行 |

## 8. Reduced Motion

`prefers-reduced-motion: reduce` 或应用内"减少动效"开关（二者取或）时：

| 替换 | 保留 |
| --- | --- |
| 所有位移 / 缩放 / 描边生长 / 长距平滑滚动 → **0–100ms 交叉淡入或即时** | 焦点可见性 |
| View Transition → 直接 DOM 更新（`startViewTransition` 不调用） | 错误与告警的出现 |
| 矩阵点燃 → 直接显示 | 保存状态变化 |
| Band 扫掠 → 不播放 | 进度条的**确定性**进度（仍然更新数值，只是不做补间） |
| AI 流式 → 仍分块追加，但无淡入 | 所有功能性反馈 |

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 1ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 1ms !important;
    scroll-behavior: auto !important;
  }
  /* 例外：真实进行中的操作仍需可见的活动指示 */
  .ai-rail[data-active], .progress--indeterminate {
    animation-duration: 1100ms !important;
    animation-iteration-count: infinite !important;
  }
}
:root[data-motion="reduced"] { /* 应用内开关，规则同上 */ }
```

## 9. 动效审计表（每次视觉改动后跑一遍）

| # | 检查 | 判据 |
| --- | --- | --- |
| 1 | 是否有动画在表达"因果"以外的东西 | 说不出"谁引起的、去哪了" → 删 |
| 2 | 是否有动画阻塞输入 | 动画期间控件不可操作 → 失败 |
| 3 | 时长是否落在五档内 | 出现 250ms / 350ms 等散值 → 失败 |
| 4 | 退出是否短于进入 | 退出 ≥ 进入 → 失败 |
| 5 | 是否有非法循环 | 无对应真实操作的 `infinite` → 失败 |
| 6 | IME 期间是否静默 | 组合态内触发任何动画/移焦 → 失败 |
| 7 | Reduced Motion 是否等价 | 关掉动效后功能反馈丢失 → 失败 |
| 8 | 是否动了布局属性 | `width/height/top/left` 出现在 `transition-property` → 失败 |

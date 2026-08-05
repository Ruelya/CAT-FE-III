# 03 · 标志系统：Band Spine · Live Matrix · Active Axis · Seam

> 本文定义**被保留的三项资产**的新角色，以及两个新增的结构装置。
> 每一节的结构是：**做什么 → 为什么它是可用性装置 → 精确规格 → 代码 → 违规判据**。

---

## 1. Translunar Band Spine（保留资产 · 角色重定义）

### 1.1 做什么

五色彩条从"顶栏下缘 6px 横带"改为**窗口最左缘 4px、贯穿全高的垂直脊柱**。
自上而下固定顺序，每色占窗口高度的 1/5，**平分，不随任何数据变化**。

```
┌─┬──────────────────────────────────────┐
│▓│  ← band-1 Burnt Orange   (0–20%)     │
│▓│                                       │
│▒│  ← band-2 Solar Ochre    (20–40%)    │
│▒│                                       │
│▓│  ← band-3 Lichen Green   (40–60%)    │   4px 宽，与 Index Spine 相邻
│▓│                                       │   永不被任何内容遮挡
│▒│  ← band-4 Instrument Teal(60–80%)    │
│▒│                                       │
│▓│  ← band-5 Dusk Blue      (80–100%)   │
└─┴──────────────────────────────────────┘
```

### 1.2 为什么它不再是贴纸

1. **不可删除性**：横带贴在顶栏下缘时，它是顶栏的一条下划线，删掉界面照常成立。
   竖立在窗口最左缘并贯穿全高时，它是**窗口边界本身**，删掉会露出结构断面。
2. **跨 Surface 恒定**：全应用切换任何页面，脊柱**不动、不重绘、不参与转场**。
   它是空间连续性的物理锚点——用户永远知道"还在同一个应用里"。
   实现上它位于 View Transition 的捕获范围之外（`view-transition-name: none`）。
3. **转场发令**：Surface 切换时脊柱做一次自上而下 240ms 的亮度扫掠（`+8%` 明度波峰，
   宽度 25% 高度），内容随后 40ms 进入。**一个零成本、高辨识度、不重复的签名动作。**
4. **等分即防误读**：五段严格等分，永远不随进度/数量变化 ⇒ 用户不可能把它当成数据。
   这条比"写规则说它无语义"更可靠。

### 1.3 精确规格

| 项 | 值 |
| --- | --- |
| 宽度 | `--band-w: 4px`，固定，不随缩放/密度变化 |
| 位置 | `position: fixed; inset-block: 0; inset-inline-start: 0; z-index: 900` |
| 分段 | 5 × 20% 高度，`background: linear-gradient(...)` 硬边（无渐变过渡） |
| 顺序 | 恒定 1→5，**禁止**反转、重排、随机、"彩虹"变体 |
| 透明度 | 100%，**禁止**透明、发光、模糊、渐变 |
| 深色 | 五色各降亮 10%（值见 `02-foundations.md §1.5`） |
| 覆盖率 | 1250×744 下 0.32%（预算 0.8%）✓ |

### 1.4 压缩回显（Echo）

同序五色的压缩版本，**一屏最多再出现一次**，三选一：

| 位置 | 形式 |
| --- | --- |
| 应用标记（Index Spine 顶部 32×32） | 5 条 2px 水平细条嵌在标记方块下缘 |
| 项目卡缩略图（首页） | 卡片左缘 3px × 卡高的竖条 |
| 文档预览把手左端 | 20px 宽 × 3px 高的五段水平条 |

Echo **不参与**扫掠动画，**不可交互**，**不带 tooltip**。

### 1.5 代码

```css
.band-spine {
  position: fixed;
  inset-block: 0;
  inset-inline-start: 0;
  width: var(--band-w);
  z-index: 900;
  pointer-events: none;
  view-transition-name: none;          /* 转场时不被捕获，保证绝对静止 */
  background: linear-gradient(
    to bottom,
    var(--band-1) 0 20%,
    var(--band-2) 20% 40%,
    var(--band-3) 40% 60%,
    var(--band-4) 60% 80%,
    var(--band-5) 80% 100%
  );
}

/* 转场扫掠：一个自上而下移动的亮度波峰 */
.band-spine::after {
  content: "";
  position: absolute;
  inset-inline: 0;
  height: 25%;
  background: rgb(255 255 255 / .30);
  mix-blend-mode: soft-light;
  translate: 0 -30%;
  opacity: 0;
}
html[data-transition="surface"] .band-spine::after {
  animation: band-sweep 240ms var(--ease-move) both;
}
@keyframes band-sweep {
  0%   { translate: 0 -30%; opacity: 0; }
  15%  { opacity: 1; }
  85%  { opacity: 1; }
  100% { translate: 0 400%; opacity: 0; }
}
@media (prefers-reduced-motion: reduce) {
  html[data-transition="surface"] .band-spine::after { animation: none; }
}
```

### 1.6 违规判据

- 一屏出现 >1 个 `.band-spine` → 失败
- Echo 出现 >1 处 → 失败
- 任一 band 色出现在 `button` / `[role=status]` / 图表系列 / 链接 / 焦点 → 失败
- band 分段高度不等 → 失败
- band 参与除 `band-sweep` 外的任何动画 → 失败

---

## 2. Live Matrix（保留资产 · 从纹理升级为数据基底）

### 2.1 来源与立论

孤星遍布的规则圆点阵，其形式来源是**打孔卡 / 打孔纸带**——早期计算机的数据存储介质
（一格 = 一条记录，孔位 = 记录状态）。

本产品的天然对应物是**段落**：一个文档就是 N 条正交排列的记录，每条有明确状态。
因此圆点矩阵在这里**不需要被"用作装饰"，它本来就是这个产品的数据结构的图形形式。**

这条继承把上一代最可有可无的元素，变成本设计最不可替代的元素。

### 2.2 两个等级（外观必须可区分）

| | **Live Matrix** | **Inert Matrix** |
| --- | --- | --- |
| 编码数据 | ✅ 每点 = 一条真实记录 | ❌ 不编码任何值 |
| 可交互 | ✅ 点击/拖拽/键盘/tooltip | ❌ `pointer-events: none` |
| 点径 / 间距 | 3px / 9px pitch | 1px / 6px pitch |
| 对比度 | 与状态色同级（可读） | **低于屏上任何一条边框**（≤ `--rule-soft`） |
| 可聚焦 | ✅ `tabindex` + roving | ❌ `aria-hidden` |
| 动画 | 状态变更时单点 120ms 过渡；首次点燃一次对角扫掠 | 永不动画（转场遮罩揭示一次除外） |
| 位置 | 有明确容器与标题 | 面板头空余半幅、外 gutter、预览边缘、仪表条端帽、空态 |

**两者永不相邻**。任何一屏若同时存在 Live 与 Inert，二者之间必须隔着至少一条结构缝。

### 2.3 Document Matrix（主装置）

主工作台段落网格左侧，**28px 宽、与网格等高**的竖条。文档全部 N 段各占一个点。

```
 ┌──┐
 │∘∘∘│  ← 3 列 × ⌈N/3⌉ 行，自上而下、自左而右按段序排列
 │∘●∘│
 │●●◐│     ∘ 空心  = 未翻译
 │●◐●│     ◐ 半填  = 草稿
 │┏━━┓│    ● 实心  = 已确认
 │┃●✕┃│    ✕ 叉    = 有 QA 错误（红）
 │┃◉●┃│    ◉ 橙环  = 当前段（Active Axis 的驻留点）
 │┗━━┛│    ┏┓ 括号 = 当前视口范围
 │∘∘∘│
 └──┘
```

**它直接取代原生滚动条**：网格用 `scrollbar-width: none`，滚动完全由 Matrix + 键盘 + 滚轮驱动。

#### 交互

| 动作 | 结果 |
| --- | --- |
| Hover 某点 | 该点放大到 4px；锚定 tooltip 显示 `段 418 · 草稿 · TM 96%`（≤120ms 延迟） |
| 单击某点 | 网格跳转并把该段置于视口 1/3 处；Active Axis 迁移到该行；**不夺走译文输入焦点** |
| 拖拽视口括号 | 实时滚动（无缓动，跟手），松手 ≤100ms 吸附到整行 |
| 滚轮悬于 Matrix 上 | 等同网格滚动 |
| `Tab` 进入 | 焦点落在当前段的点；`↑↓←→` 移动焦点点；`Enter` 跳转；`Esc` 退回网格 |
| 右键 | 上下文菜单：`只看未翻译` / `只看有问题` / `跳到第一个问题` / `复制段号` |

#### 密度自适应

| 段数 N | 列数 | 单点表示 | 说明 |
| --- | --- | --- | --- |
| ≤ 240 | 3 | 1 段 | 一段一点 |
| 241 – 900 | 3 | 1 段 | 点径降至 2px，pitch 6px |
| 901 – 3,000 | 3 | **聚合 k 段**（k=⌈N/900⌉） | 点状态 = 该桶内**最差**状态（错误 > 未翻译 > 草稿 > 确认） |
| > 3,000 | 3 | 聚合 | 同上；tooltip 显示 `段 1201–1204 · 3 草稿 1 错误` |

聚合规则用"最差优先"，因为用户扫这条的目的是**找问题**，不是数进度。

#### 为什么值得占 28px

它一次性回答三个高频问题：**我在哪 / 还剩多少 / 问题扎堆在哪**。
上一代对这三个问题的答案分别是：原生滚动条（只答一半）、页脚计数（只答第二个）、无（第三个）。
28px = 1250px 宽度的 2.2%，换掉一个 14px 的原生滚动条，净成本 14px。

### 2.4 Live Matrix 的其他复用点

同一组件，换数据源：

| 场景 | 一点 = | 状态编码 | 位置 |
| --- | --- | --- | --- |
| TM 库健康度 | 一个 TM 单元（采样/聚合） | 干净 / 疑似重复 / 语义错位 / 已隔离 | 资产养护页头部 |
| QA 分布 | 一段 | 无问题 / 警告 / 错误 / 已忽略 | QA 复核页左栏 |
| 批处理进度 | 一个任务单元 | 待处理 / 处理中 / 成功 / 失败 | 预翻译、批量 QA、导入的进度面 |
| 项目文件构成 | 一个文档 | 按完成度四档 | 洞察 → 文件 |
| Reimport 差异 | 一段 | 未变 / 已变 / 新增 / 删除 | 洞察 → 重导入 |
| 对齐置信度 | 一个句对 | 高 / 中 / 低 / 需人工 | 对齐工作台 |
| 语料养护批次 | 一条发现 | 保留 / 复核 / 隔离 | 养护结果 |

**每处都必须有标题与图例。** 没有图例的 Live Matrix = 假仪表 = 违规。

### 2.5 代码

```tsx
// DocumentMatrix.tsx — 只画，不拿业务逻辑
type Cell = { from: number; to: number; state: "untranslated"|"draft"|"confirmed"|"error"; active?: boolean };

export function DocumentMatrix({
  cells, viewport, onSeek,
}: {
  cells: Cell[];
  viewport: { first: number; last: number };  // 屏上可见段序号
  onSeek(ordinal: number): void;
}) {
  const COLS = 3;
  const rows = Math.ceil(cells.length / COLS);
  return (
    <div
      className="doc-matrix"
      role="slider"
      aria-label="文档段落矩阵"
      aria-valuemin={1}
      aria-valuemax={cells.at(-1)?.to ?? 1}
      aria-valuenow={viewport.first}
      tabIndex={0}
      style={{ "--cols": COLS, "--rows": rows } as React.CSSProperties}
    >
      {cells.map((c, i) => (
        <button
          key={c.from}
          type="button"
          className="doc-matrix__dot"
          data-state={c.state}
          data-active={c.active || undefined}
          data-in-view={c.from >= viewport.first && c.to <= viewport.last || undefined}
          style={{ "--i": i } as React.CSSProperties}
          onClick={() => onSeek(c.from)}
          aria-label={
            c.from === c.to ? `段 ${c.from}，${LABEL[c.state]}`
                            : `段 ${c.from} 至 ${c.to}，${LABEL[c.state]}`
          }
        />
      ))}
      <div className="doc-matrix__viewport" aria-hidden />
    </div>
  );
}
```

```css
.doc-matrix {
  width: var(--matrix-w);
  display: grid;
  grid-template-columns: repeat(var(--cols), 1fr);
  align-content: start;
  gap: 3px;
  padding: var(--s-4) var(--s-3);
  background: var(--frame);
  border-inline-end: 1px solid var(--rule-strong);
  position: relative;
  overscroll-behavior: contain;
}

.doc-matrix__dot {
  inline-size: 100%; aspect-ratio: 1;
  border: 0; padding: 0; border-radius: 50%;
  background: transparent;
  box-shadow: inset 0 0 0 1.25px var(--rule-field);   /* 空心 = 未翻译，56% 保证 3:1 */
  transition: box-shadow var(--d-state) var(--ease-move),
              scale var(--d-micro) var(--ease-move);
}
.doc-matrix__dot[data-state="draft"]     { background: linear-gradient(to top, var(--text-2) 50%, transparent 50%); }
.doc-matrix__dot[data-state="confirmed"] { background: var(--ok); box-shadow: none; }
.doc-matrix__dot[data-state="error"]     { background: var(--err); box-shadow: none; }
.doc-matrix__dot[data-active] {
  background: var(--signal);
  box-shadow: 0 0 0 2px var(--paper), 0 0 0 3.5px var(--signal);
  scale: 1.15;
}
.doc-matrix__dot:hover { scale: 1.35; }
.doc-matrix__dot:focus-visible { outline: 2px solid var(--signal); outline-offset: 2px; }

/* 视口括号：由 JS 设 --vp-top/--vp-h */
.doc-matrix__viewport {
  position: absolute; inset-inline: 2px;
  top: var(--vp-top); height: var(--vp-h);
  border: 1px solid var(--text-1);
  border-inline-width: 2px;
  pointer-events: none;
  transition: top var(--d-micro) linear, height var(--d-micro) linear;
}

/* 首次点燃：对角扫掠，仅一次 */
@media (prefers-reduced-motion: no-preference) {
  .doc-matrix[data-ignite] .doc-matrix__dot {
    animation: dot-ignite 260ms var(--ease-in) both;
    animation-delay: calc(var(--i) * 0.9ms);
  }
}
@keyframes dot-ignite { from { opacity: 0; scale: .4 } to { opacity: 1; scale: 1 } }
```

```css
/* Inert Matrix：必须明显更弱、更密、不可交互 */
.matrix-inert {
  pointer-events: none;
  background-image: radial-gradient(circle at 1px 1px, var(--rule-soft) 1px, transparent 0);
  background-size: 6px 6px;
  /* 必须被裁切到板块边界，不得散点 */
  mask-image: linear-gradient(to right, black 60%, transparent 100%);
}
```

### 2.6 违规判据

- Live Matrix 缺图例或标题 → 失败
- Inert Matrix 对比度 ≥ `--rule` → 失败
- Inert Matrix 可聚焦 / 可点击 / 有 tooltip → 失败
- 任一 Matrix 出现在 `.cell-source` / `.cell-target` / `.match-body` / 表单标签之后 → 失败
- Inert Matrix 持续动画（shimmer/pulse/scroll）→ 失败
- 一屏 Inert Matrix > 3 处或合计覆盖 > 3% → 失败

---

## 3. Active Axis（新增 · 全应用唯一焦点表达）

### 3.1 做什么

一条 **2px 信号橙线**，同一时刻全屏**有且只有一条**，恒定含义：**"你在这里"**。
它会在位置之间**移动**，而不是消失后在别处出现。

### 3.2 它取代了什么

| 上一代的 5 套高亮 | 现在 |
| --- | --- |
| 活动行左侧 2px 橙边 | Axis 驻留于行前缘 |
| Tab 下方 2px 橙下划线 | Axis 迁移到标签下缘 |
| 输入框 focus ring | Axis 驻留态（2px 橙环 + 2px 偏移） |
| 向导当前步高亮 | Axis 驻留于步进器 |
| 列表选中项前缘 | Axis 驻留于该项前缘 |

用户只需学**一个**视觉语言，而且**移动过程本身告诉他焦点去了哪**。

### 3.3 驻留位（Perch）清单

| Perch | 几何 | 触发 |
| --- | --- | --- |
| 网格活动行 | 行左缘，`2px × 行高`，贴 Document Matrix 内侧 | 段落选中 |
| Stack 面板标签 | 标签下缘，`2px × 标签宽` | 标签切换 |
| 命令面板选中项 | 项左缘，`2px × 项高` | ↑↓ 移动 |
| 表单字段 | 字段左缘，`2px × 字段高`（同时字段获得焦点环） | 焦点进入 |
| 向导步进器 | 当前步左缘，`2px × 步高` | 步骤变化 |
| Index Spine 当前 Surface | 图标左缘，`2px × 32px` | Surface 切换 |
| 预览坞当前页 | 页码左缘 | 页面变化 |

### 3.4 移动规则

- **同容器内移动**：160ms，`--ease-move`，只动 `translate` 与 `scaleY`。
- **跨容器移动**（如从网格行 → Stack 标签）：Axis **不飞越**。它在源位收缩（80ms）→
  在目标位展开（100ms）。飞越会在密集界面里制造穿越内容的噪声。
- **Surface 切换**：Axis 随页面转场一同消失/重建，不做 FLIP。
- **多选**：多选状态下 Axis 停在**锚点行**（anchor），其余选中行用 `--shade` 底 + 左缘 1px `--rule-strong`。
  Axis 永不分裂。

### 3.5 代码

```css
/* Axis 是一个共享 view-transition-name 的单例元素 */
.axis {
  position: absolute;
  inline-size: 2px;
  background: var(--signal);
  view-transition-name: active-axis;
  border-radius: 1px;
}
::view-transition-old(active-axis),
::view-transition-new(active-axis) { animation-duration: 160ms; animation-timing-function: var(--ease-move); }

/* 横向驻留（标签下缘） */
.axis[data-orient="x"] { inline-size: auto; block-size: 2px; }
```

```ts
// 迁移：只在同容器内用 View Transition
export function moveAxis(to: HTMLElement, sameContainer: boolean) {
  const run = () => mountAxisInto(to);
  if (!sameContainer || !document.startViewTransition ||
      matchMedia("(prefers-reduced-motion: reduce)").matches) { run(); return; }
  document.startViewTransition(run);
}
```

### 3.6 违规判据

- 运行时 `[data-axis="active"]` 数量 ≠ 1（且非"无焦点"空状态）→ 失败
- Axis 用于表达"选中集合"而非"当前锚点" → 失败
- Axis 跨容器做飞越动画 → 失败
- Axis 颜色不是 `--signal` → 失败

---

## 4. Seam（新增 · 板块骨架）

### 4.1 做什么

界面由**刚性板块（Plate）**沿一套**可见接缝（Seam）**对接。板块之间**没有 gap、没有圆角、没有阴影**——
交界处就是缝。缝的**权重**表达结构层级。

```
结构缝 1px @34%  —— 板块之间（Ink↔Paper、网格↔Stack、Spine↔内容）
面板缝 1px @18%  —— 板块内分区（面板头↔内容、网格行之间、输入框边框）
内部缝 1px @10%  —— 卡片内分隔、次级列分隔
```

### 4.2 为什么

对照 `21-qa-review.png`：QA 卡片（圆角+边框）嵌在面板（边框）里，面板嵌在布局（边框）里，
预览又是一层圆角框——**4 层嵌套边框**，每层都在消耗对比度预算，而它们表达的信息量是零。

板块-接缝制把这 4 层压成 2 条不同权重的缝，把省下的对比度全部交还给内容。
这也是国际主义排版风格与孤星本身的原生做法：**结构由线与块面表达，不由容器嵌套表达。**

### 4.3 唯一允许"浮"的东西

真正的临时层：`[popover]`、`<dialog>`、`.toast`、拖拽幻影。
它们必须：① 用 `--elev-pop` 单级暖调阴影；② 用 CSS Anchor Positioning **锚定到触发源**；
③ 关闭时回到触发源。**没有第二级阴影。**

### 4.4 45° 切角

`corner-shape: bevel`（Chromium 139+ 原生），**每屏最多一处**，只用于该屏的品牌板：
主工作台 = Stack 面板标题块右上角；首页 = 标识板右上角；向导 = 左栏构图板右下角。

**不用 `clip-path` 伪造**——伪造会丢失边框、焦点环与 `outline`，且无法参与 `view-transition`。

### 4.5 代码

```css
.plate            { background: var(--frame); border: 0; border-radius: 0; box-shadow: none; }
.plate--deck      { background: var(--deck); }
.plate--ink       { background: var(--ink); color: var(--text-on-ink); }

.seam-e  { border-inline-end:  1px solid var(--rule-strong); }
.seam-s  { border-block-end:   1px solid var(--rule-strong); }
.seam-e\@panel { border-inline-end: 1px solid var(--rule); }
.seam-s\@row   { border-block-end:  1px solid var(--rule); }

.brand-plate {
  background: var(--ink);
  color: var(--text-on-ink);
  border-radius: 0 var(--bevel) 0 0;
  corner-shape: bevel;
}
@supports not (corner-shape: bevel) {
  /* 极端兜底：退化为直角，不伪造 */
  .brand-plate { border-radius: 0; }
}
```

### 4.6 违规判据

- 常驻板块出现 `box-shadow` → 失败
- 板块之间出现 `gap` / `margin`（应当直接对接）→ 失败
- 出现第 4 档缝权重 → 失败
- 一屏 `corner-shape: bevel` > 1 处 → 失败
- popover / menu 未锚定到触发源（用固定坐标）→ 失败

---

## 5. 三项资产的同屏预算表

| 资产 | 每屏数量 | 覆盖率上限 | 备注 |
| --- | --- | --- | --- |
| Band Spine（完整） | 恰好 1 | 0.32%（实算） | 跨 Surface 恒定 |
| Band Echo（压缩） | ≤ 1 | 可忽略 | 与完整版共存 |
| Live Matrix | ≤ 2（主 + 辅） | 不设上限（它是内容） | 必须有标题 + 图例 |
| Inert Matrix | ≤ 3 处 | 合计 < 3% | 对比度 ≤ `--rule-soft` |
| Active Axis | 恰好 1 | 可忽略 | 含焦点环合一态 |
| 信号橙总量（面 + 线） | — | ≤ 1.5% | 含主按钮填充 |
| 45° 切角 | ≤ 1 | — | 只在品牌板 |
| 装饰性几何（轨道弧/刻度/定位记号） | ≤ 1 组 | 合计 < 3% | 只在 chrome 与外 gutter |

**总装饰预算 6–8%**（沿用上一代的这一条，它是对的）。

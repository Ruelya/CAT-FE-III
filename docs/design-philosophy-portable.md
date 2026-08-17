# 纸面与仪器：可迁移的前端设计哲学

| 项 | 值 |
| --- | --- |
| 版本 | 2026-08-17 |
| 来源产品 | Translunar CAT 桌面端（Electron + React）当前已上线的渲染器 |
| 这份文档的用途 | 把设计读法、原则、token、组件配方、信息架构和禁令抽成一份**不依赖本仓库也能落地**的规范 |
| 本仓对照 | 运行时数字以 `apps/desktop/src/renderer/tokens.css` 为准；本仓强制合同是 `.trellis/spec/frontend/design-language.md` |

把这份文件连同第 16 节的 token 表一起拷走即可。不必带 Electron、Rust 引擎或 CAT 网格。

---

## 0. 一句话读法

**安静的编辑结构，暖纸冷墨，工业控件，高信息密度。品牌色带是数据，不是装饰。**

适用产品：译者、工程师、分析师、运维会在同一窗口坐几个小时的**专业桌面工具**。

不适用：营销落地页、消费 App、等权卡片仪表盘、玻璃拟态暗色 SaaS。

三档旋钮（先定旋钮，再画界面）：

| 旋钮 | 取值 | 含义 |
| --- | ---: | --- |
| 变化 Variance | 6/10 | 流程可预期。层级可以不对称。不要营销构图。 |
| 动效 Motion | 5/10 | 覆盖面广，幅度小，必须有因果。不要环境动效。 |
| 密度 Density | 8/10 | 专业密度。可点目标永不小于 32 px。 |

外部「落地页品味」技能（Inter、玻璃、Hero、Bento、海军绿配色）与这份读法冲突时，以本文为准。

---

## 1. 十一条原则（换产品也不改）

1. **暖纸，冷结构。** 表面是暖的。分割线、次要文字、边框、禁用态是冷绿灰。这层张力避免整屏变成米色糊。
2. **只有一个强调色。** 交互强调色全产品只有一种（本系统是高级棕）。成功 / 警告 / 错误 / 信息是主题固定色，绝不从强调色种子派生。
3. **品牌色带做功。** 五色色带是分类数据色板（进度、严重度、类型、图表）。它们不上按钮。
4. **质量靠字体，不靠渐变。** 颜色是结构，字体是声音。
5. **从不只靠颜色。** 状态 = 颜色 + 文字；空间够再加一个图标。
6. **实心材料。** 禁止 `backdrop-filter`、毛玻璃、半透明面板。深度来自四级表面阶梯 + 1 px 边框。阴影少，且带纸色倾向。
7. **32 px 地板。** 可点区域至少 32×32。视觉上更小的芯片必须扩大热区，不能缩小目标。
8. **每个表面只有一个主操作。** 次要和危险操作必须够得到，但视觉上从属。
9. **空状态不重复页头主按钮。** 主操作已经在表面上时，空状态只陈述事实然后停。
10. **可见窗口不是全集。** 分页、过滤、当前页计数不得冒充全文 / 全库数字。权威计数来自数据层。
11. **行生命周期在铬上，不在每行控件里。** 密表列只报状态。改状态走命令条、菜单、快捷键。不要在每一行塞下拉。

---

## 2. 色彩系统

原始色值、圆角、阴影、z-index、时长只允许出现在一份 token 文件里。业务 CSS 只引用变量。

### 2.1 表面阶梯

相邻两级 CIE L\* 差至少 2.5。没有边框时结构仍应可读。

| Token | 浅色 | 深色 | 用途 |
| --- | --- | --- | --- |
| `--color-sunken` | `#e2ded4` | `#121110` | 凹陷井、芯片底 |
| `--color-canvas` | `#eeeae1` | `#1a1714` | 应用底 |
| `--color-surface` | `#f7f4ee` | `#24211c` | 面板、坞、表格 |
| `--color-raised` | `#fffefb` | `#2f2b25` | 输入、菜单、抬起行 |
| `--color-line` | `#d5d2c8` | `#37332c` | 装饰分割线，无对比门槛 |
| `--color-border` | `#82857e` | `#79756b` | 控件边界，≥ 3:1 |
| `--color-border-strong` | `#6d716b` | `#8b8579` | 更强的控件边 |
| `--color-text` | `#1f1d1a` | `#f3efe8` | 正文 |
| `--color-text-muted` | `#585c57` | `#a5a89f` | 次要，冷色 |
| `--color-text-subtle` | `#5c605c` | `#96948b` | 第三级 |

浅色阶梯实测 L\*：88.53 / 92.78 / 96.27 / 99.65。深色：5.12 / 7.98 / 12.90 / 17.76。

### 2.2 强调色

默认种子 `#765847`。运行时从用户偏好覆盖整个强调色家族。浅色默认把种子当作 `--color-accent`。深色默认提亮到约 `#b98a70`。

| Token | 职责 |
| --- | --- |
| `--color-accent` | 主按钮、焦点、选中强调 |
| `--color-accent-hover` / `--color-accent-active` | 按压阶梯 |
| `--color-accent-soft` | 选中行、软芯片 |
| `--color-on-accent` | 实心强调底上的字 |
| `--color-focus` | 2 px 焦点环 |

自定义种子必须同时满足：强调底上的正文 ≥ 4.5:1；焦点环在 canvas / surface / raised 上 ≥ 3:1。达不到就拒绝，并给出可见原因。

本仓浅色运行时（种子 `#765847`）：accent `#765847`，hover `#6a5041`，active `#5f493b`，soft `#e5ded7`，on-accent `#fffefb`。深色：accent `#b98a70`，hover `#c39a83`，active `#cba894`，soft `#45382e`，on-accent `#1f1d1a`。

### 2.3 语义色（主题固定，与种子无关）

| Token | 浅色 | 深色 |
| --- | --- | --- |
| `--color-success` | `#1b5e3f` | `#63c093` |
| `--color-warning` | `#7a4a08` | `#e0ac4b` |
| `--color-error` | `#a32f2f` | `#f08a8a` |
| `--color-info` | `#1f5570` | `#77bcd9` |

各有 `*-soft` 底：浅 `#dfe9e2` / `#f0e6d3` / `#f4dedd` / `#dce8ee`；深 `#1c2f26` / `#332a17` / `#3a2222` / `#1d2a33`。实心语义底上的字用 `--color-on-solid`（浅 `#fffefb`，深 `#1a1714`）。

### 2.4 品牌色带与数据序列

标识顺序固定，不可对调，不可上交互控件。

| 序 | 名 | 标识 | 浅色序列 | 深色序列 |
| --- | --- | --- | --- | --- |
| 1 | Burnt | `#d9562b` | `#ad3f1d` | `#eb8258` |
| 2 | Ochre | `#d29a2e` | `#a3761a` | `#e8c063` |
| 3 | Lichen | `#87904a` | `#667130` | `#b0bb72` |
| 4 | Teal | `#4f8076` | `#356057` | `#5f978c` |
| 5 | Dusk | `#526f86` | `#374b5c` | `#5a7d95` |

堆叠条相邻分段之间留 1 px 父表面色缝。每个序列另配文字或图例。相邻序列浅色最小 L\* 差 3.4，深色 6.0。

### 2.5 覆盖与阴影

| Token | 浅色 | 深色 |
| --- | --- | --- |
| `--color-scrim` | `rgb(31 29 26 / 38%)` | `rgb(7 6 5 / 62%)` |
| `--color-hover-tint` | `rgb(31 29 26 / 5%)` | `rgb(243 239 232 / 6%)` |
| `--color-active-tint` | `rgb(31 29 26 / 9%)` | `rgb(243 239 232 / 10%)` |
| `--shadow-sm` | `0 1px 2px rgb(31 29 26 / 7%)` | `0 1px 2px rgb(0 0 0 / 40%)` |
| `--shadow-md` | `0 6px 18px rgb(31 29 26 / 11%)` | `0 6px 18px rgb(0 0 0 / 52%)` |
| `--shadow-lg` | `0 18px 44px rgb(31 29 26 / 18%)` | `0 18px 44px rgb(0 0 0 / 62%)` |

阴影只给：抬起行 / 粘性头（sm）、菜单（md）、对话框（lg）。面板不用阴影制造深度。

### 2.6 对比门槛

| 元素 | 门槛 |
| --- | ---: |
| 正文和标签 | 4.5:1 |
| 大号字（18.66 px 粗或 24 px 常规） | 3:1 |
| 焦点环落在的每一级表面 | 3:1 |
| 表单边界、开关、图表轴 | 3:1 |
| 装饰分割线 | 无 |

---

## 3. 字体

四套角色。运行时不拉网络字体。每个 `@font-face` 都是 `font-display: swap`。

| Token | 本仓字体 | 可替换 | 职责 |
| --- | --- | --- | --- |
| `--font-display` | Space Grotesk | `"Segoe UI Variable Display", system-ui` | 表面标题、品牌、空状态标题 |
| `--font-ui` | Chivo | `"Segoe UI Variable Text", "Segoe UI", system-ui` | 全部铬和正文 |
| `--font-mono` | Space Mono | `ui-monospace, "Cascadia Mono", Consolas` | 数字、ID、路径、快捷键 |
| `--font-cjk` | Noto Sans SC | `"Microsoft YaHei", "PingFang SC"` | 源/译文和任何 CJK。永不预加载 |

字号：

| Token | 尺寸 | 用途 |
| --- | ---: | --- |
| `--text-2xs` | 11 px | 快捷键、密表副标签 |
| `--text-xs` | 12 px | 元数据、说明、芯片 |
| `--text-sm` | 13 px | 次要正文、单元格 |
| `--text-md` | 14 px | 默认正文和控件 |
| `--text-lg` | 16 px | 小节标题、主编辑区 |
| `--text-xl` | 20 px | 面板标题 |
| `--text-2xl` | 26 px | 表面标题 |
| `--text-3xl` | 34 px | 欢迎页专用 |

字重：400 / 500 / 600 / 700。行高：tight 1.2，snug 1.35，body 1.5，CJK 1.75。字距：tight `-0.01em`，normal 0，wide `0.02em`。

规则：

- 数字、计数、百分比、时长一律 `font-variant-numeric: tabular-nums`。
- 斜体只用于散文里的真强调，不用在标签上。
- 散文行宽封顶 `--measure`（68ch）。表格不是散文。
- 技术值（ID、修订、ISO 时间）降权：等宽、弱色；太长就放进折叠的「技术细节」。原始 JSON 不是界面。
- CJK 字体按 `unicode-range` 按需下载。拉丁会话不该为它付流量。

迁到没有自托管字体的项目时：保留四角色和字号阶梯，用上表「可替换」列。不要改成 Inter + slate。

---

## 4. 空间、形状、层级

**间距** `--space-*`：2 / 4 / 8 / 12 / 16 / 20 / 24 / 32 / 48。没有别的值。

**圆角**（形状锁）：输入和芯片 4 px；按钮、菜单、面板 6 px；对话框 8 px；圆点 / 头像 999 px。一个矩形只用其中一档。

**控件高**：非交互芯片 24 px；控件 32 / 36 / 40 px。32 px 是交互地板。

**层** `--z-*`：base 0，sticky 10，dock 20，menu 30，dialog 40，toast 50。禁止裸 `z-index` 整数。

**焦点**：`--focus-width` 2 px，`--focus-offset` 2 px，环色用 `--color-focus`。

**产品铬几何（参考，可改数字，不要改层级逻辑）：**

| Token | 默认 | 含义 |
| --- | ---: | --- |
| `--chrome-height` | 44 px | 标题条 |
| `--rail-w` | 40 px | 活动栏 |
| 文件树宽 | 200 px，夹 140–360 | 可拖 |
| 情报坞宽 | 300 px，夹 220–480 | 可拖 |
| 预览抽屉高 | 220 px，夹 140–480 | 默关 |
| `--measure` | 68ch | 散文行宽 |

---

## 5. 动效

覆盖面广，幅度小，有因果。只动画 `transform` 和 `opacity`。唯一例外：坞开关时测量过的轨道宽度。

| Token | 值 | 用途 |
| --- | --- | --- |
| `--motion-instant` | 60 ms | 按下 |
| `--motion-fast` | 120 ms | 颜色和状态 |
| `--motion-base` | 160 ms | 表面切换 |
| `--motion-slow` | 220 ms | 坞尺寸 |
| `--ease-standard` | `cubic-bezier(0.2, 0.8, 0.2, 1)` | 默认 |
| `--ease-decelerate` | `cubic-bezier(0, 0, 0.2, 1)` | 进入 |
| `--ease-accelerate` | `cubic-bezier(0.4, 0, 1, 1)` | 离开 |
| `--stagger-step` | 40 ms | 列表前 8 行 |

七个动效类：

| 类 | 触发 | 规格 |
| --- | --- | --- |
| M1 | 表面切换 | View Transition，或 8 px `translateY` 交叉淡入，160 ms |
| M2 | 坞开合 | 轨道宽 + 透明度，220 ms。内容保持挂载，变 `inert` |
| M3 | 活动行 | 左侧强调条 + accent-soft 底 |
| M4 | 异步 | 骨架几何等于落定布局。按钮保留标签 |
| M5 | 确认 / 保存成功 | 芯片变色 + 一次 `scale(1.04 → 1)` |
| M6 | 列表首屏 | 前 8 行上移 6 px。密表禁止回弹缓动 |
| M7 | `:active` | `translateY(1px)` 或 `scale(0.985)`，60 ms |

`prefers-reduced-motion: reduce` 时所有时长归零。禁止：环境循环、视差、劫持滚动、跑马灯、自定义光标、用转圈替换按钮文字。

每条动画必须能用一句话说清：层级、因果、反馈或状态。说不清就删。

---

## 6. 组件配方

不要发明第二套按钮或表单语言。

### 6.1 按钮

| 意图 | 做法 |
| --- | --- |
| primary | 实心强调色。每个表面只有一个 |
| secondary | 抬起底 + 边框 |
| ghost | 透明，悬停用 hover-tint |
| quiet | 看起来像字，仍是 32 px 热区。行内三级操作 |
| danger | 实心错误色 |
| icon | 32 px 正方形，必须同时有 `title` 和 `aria-label` |

标签不换行。主按钮最多三个词。按钮不拉满容器。表单提交行右对齐、按内容宽。进行中保留标签并禁止连点。`:active` 走 M7。

### 6.2 字段

上标签、控件、下提示、提示下错误。占位符不是标签。非法控件设 `aria-invalid` 和 `aria-describedby`。提交后焦点落到第一个非法控件。

### 6.3 芯片与进度

芯片：成功 / 警告 / 错误 / 信息 / 强调，软底 + 同色字 + 细边。进度条用品牌序列分段，段间 1 px 父色缝，旁边必须有文字计数。

### 6.4 表与列表

粘性表头。1 px `--color-line` 行线。悬停浅罩。选中 = accent-soft + 左侧强调条。数字列右对齐且等宽数字。滚动关在面板里。禁止文档级横向溢出。

长列表虚拟化。异步内容先占位，避免布局跳动。

### 6.5 页签与导航

像路由的切换用 `<nav>` + `aria-current`。真页签必须做完整 APG：roving tabindex、方向键 / Home / End、`aria-controls`、具名 `tabpanel`。半套页签不如链接列表。

### 6.6 面板与对话框

折叠坞的内容保持挂载，`inert` + `aria-hidden`，焦点回到展开控件。

对话框锁焦点、关闭后还回打开者、Escape 是非破坏、异步完成前不卸载。

模态里焦点环用 `:focus`，不只 `:focus-visible`。初始焦点落在**最安全的动作**：确认框是取消；恢复草稿是恢复，不是丢弃。

### 6.7 空、载、错

- 载入：骨架几何等于落定布局。
- 空：有边界、有标题。禁止光秃表头。禁止单独写 `Loading` / `Empty`。
- 错：带类型、贴在控件旁、保留用户输入、有用时给重试。
- 短暂结果进 toast（`--z-toast`）。持久结果留在产生它的控件旁边。

### 6.8 图标

只许一个家族。本仓是 Phosphor：密铬 16 px，标题条 18 px，空状态 20 px；默认 `regular`，窗控和开关用 `bold`。禁止第二套、手绘路径、用 emoji 当结构图标。

---

## 7. 交互状态（每个可点物都要齐）

静止、悬停、`:focus-visible`、`:active`、选中 / 当前、禁用。状态变化不得改布局尺寸。

每个异步动作：进行中（防连点）、成功（结果否则看不见时）、带类型的错误（贴控件、保留输入）、长操作可取消、恢复路径。

每个集合：载入骨架、有意的空、带重试的错。

---

## 8. 信息架构（可迁移的专业桌面骨架）

工作面是最密、视觉上最主导的表面。其余表面从属。

### 8.1 产品铬

一条标题条。左：品牌标记 + 产品名 + 当前对象。中：仅当前上下文合法的文件菜单。右：仅当前上下文合法的目的地 + 平台窗控。

铬只暴露现在能去的地方，并永远标出当前位置。

外观存在客户端偏好（主题 + 强调色种子），不进服务端设置，不进 git。

同一时刻只挂一个表面。不要为桌面工具硬套 URL 路由，除非产品本身是网站。

### 8.2 列表 / 表单表面

- 内容限宽、顶对齐。
- 表单不漂在空视口里：要么表面还有真内容，要么表单坐在有边界的卡片里。
- 不要 Bento、等权功能卡、套娃装饰卡。
- 向导步骤只描述真实关口，不发明多余步。

### 8.3 工作面配方（本产品当前实现，作参考）

主编辑器当前是：全宽命令条（含当前行工作流）、左侧活动栏 + 文件树、中间过滤条 + 网格、右侧情报栈、底栏状态、预览默认关闭的底抽屉。

```text
+-- 标题条 ------------------------------------------------------------+
| 命令条  图标带  查找 标签 批注 撤销 重做  保存  确认  工作流         |
+-- 活动栏 | 文件树 | 过滤 + 网格 + 分页 | 情报栈 ----------------------+
|  文件/聊 | 树     | 客户端过滤条       | 记忆 / 术语 / 语境 / 段 AI   |
|          | +添加  | # Source Target    | 查找 / 抽取 / 添加术语分列   |
|          |        | Status             | 可拖宽度                     |
+----------+--------+--------------------+-----------------------------+
| 预览抽屉  默认关；从状态行打开；高度可拖                              |
+----------------------------------------------------------------------+
| 状态行  对象 · 进度 · 权威计数 · 预览 / 预翻译                       |
+----------------------------------------------------------------------+
```

网格列：`#` · Source · Target · Status。结构标签和行工作流不占列。

可迁移的决策，不是 CAT 专属：

1. **命令条占满宽，不要第二套文档页签条。** 文件切换走树或单一切换器。
2. **情报靠网格，不要漂成独立产品。** 记忆 / 术语 / 助手回答「当前行」的问题。查找、抽取、添加是三个动作，不要合成一个模糊按钮。
3. **预览是宿主，不是编辑器。** 默认关，需要时再开。不要用文档套件替换网格。
4. **两层过滤不要合成一个控件。** 客户端过滤当前窗口；服务端分页是另一层。计数用全集，不用当前页冒充。
5. **状态行报事实。** 进度条用品牌序列，旁边写数字。
6. **行状态在铬上改，表格只展示。** 密表里的下拉会拖慢扫读和键盘路径。

### 8.4 两层过滤（任何大数据表都适用）

| 层 | 作用 | 计数 |
| --- | --- | --- |
| 客户端显示过滤 | 在**当前页**上收 Open / Draft / 有问题 / 有批注 / 重复等 | 「显示 n / 全集 N」 |
| 服务端页窗 | offset / limit | 全集 N 来自数据层 |

跳转到一条不在当前页的记录时，必须翻页找到它，不能因为不在本页就停。

---

## 9. 文案

短、功能、领域准确。陈述事实和可做的恢复。

禁止：描述性副标题、引导微文案、功能旁白、未做功能的文案、用「不是」做对照句、营销词（Elevate / Seamless / Unleash / Next-Gen）、编造精确数字、可见文案里的 em dash / en dash、装饰状态点、滚动提示、铬上的版本戳。

标签和标题用句式大小写。专有名词才用词首大写。

---

## 10. 无障碍地板

两个主题都要 WCAG 2.2 AA。

- 每个工作流都能用键盘做完。焦点环永不摘掉。
- 重复行操作的无障碍名带上该项身份。
- 状态用 `role="status"`，可行动失败用 `role="alert"`，不抢焦点。
- 阅读顺序等于视觉顺序。换表面后焦点落到新标题。
- CJK IME 合成中途不得被确认或保存打断。
- 支持最小窗 1180×700，以及 1250×744、1680×942、1920×1080，和 125% 文字缩放。无文档级溢出、重叠、裁切、藏起的主操作。

---

## 11. 禁令（一张表）

毛玻璃 · 第二个强调色 · 从强调色派生语义色 · token 文件外的裸色 · 4/6/8/full 以外的圆角 · 裸 `z-index` · 裸时长 · 第二套图标 · 手绘图标路径 · emoji 当结构 · 占位符当标签 · 小于 32 px 的热区 · 用 `display: none` 做坞动画 · 除 M2 外动画宽高 top left · 环境动效 · 密表回弹缓动 · 转圈替换按钮字 · 光秃的 Loading / Empty · 没有空状态的空表 · JSON 当界面 · 半套 `role="tab"` · 破坏操作不先聚焦最安全项 · 可见文案里的长破折号 · 营销填料 · 非数据驱动的行内布局样式。

---

## 12. 这份哲学明确拒绝的产品形态

| 错名词 | 原因 |
| --- | --- |
| 把代码编辑器当产品 | 缓冲区不是段对 + 标签 + 记忆。 |
| 把文档套件当编辑器 | Word / OnlyOffice 最多做预览宿主。 |
| 宣称对标闭源旗舰已完成 | 接近是目标，对等不是承诺。 |
| 当前页计数冒充全文 | 计数属于数据层。 |
| 落地页默认盘（Hero、Bento、玻璃、Inter） | 旋钮和材料都反了。 |

---

## 13. 迁到其他项目

按这个顺序做，不要先改色再想原则。

1. **原样拷第 16 节 token。** 先跑通浅色。深色是同一套角色，不是另一套审美。
2. **保留四角色字体，可换具体文件。** 不要换成 Inter + 石板灰。
3. **保留一个强调色种子。** 换品牌时只换种子，重算 hover / active / soft / on-accent，跑对比门槛。不要加第二个强调色。
4. **语义色不要跟着种子走。** 成功绿、警告赭、错误红、信息青保持独立。
5. **品牌五色只做数据序列。** 没有品牌色带就仍用这五色当图表分类色，或按同样的 L\* 间隔重做一列。
6. **组件只实现第 6 节。** 先按钮、字段、芯片、表、空状态、对话框。不要先做玻璃卡。
7. **工作面按第 8.3 的决策裁。** 没有「段」就换成你的主记录行；没有「记忆」就换成当前行的上下文坞。预览默认关。
8. **两层过滤原样留下。** 任何会超过一屏的表都需要。
9. **校验至少做三件事：** 禁止 token 外裸色；交互目标 ≥ 32 px；`prefers-reduced-motion` 时时长为 0。
10. **丢掉本仓专有物：** Electron 预加载、引擎 RPC、CAT 测试 id、OnlyOffice 宿主、PDF 页坞。那些是产品，不是风格。

改名对照：

| 本仓名 | 带走后 |
| --- | --- |
| Translunar / 高级棕 | 你的产品名 / 你的强调色种子 |
| 段网格 | 主记录表 |
| 情报坞 | 当前行上下文 |
| StructurePreview | 只读预览宿主 |
| appearance-v1 | 客户端主题偏好 |
| workbench-layout.v2 | 坞宽高本地记忆 |

---

## 14. 本仓文件地图（仅对照，迁移时可删）

| 路径 | 角色 |
| --- | --- |
| `apps/desktop/src/renderer/tokens.css` | 唯一允许裸色 / 圆角 / 动效 / z 的文件 |
| `apps/desktop/src/renderer/styles/primitives.css` | 按钮、字段、芯片、空状态 |
| `apps/desktop/src/renderer/styles/workbench.css` | 工作面网格和坞 |
| `apps/desktop/src/renderer/surfaces/Workbench.tsx` | 工作面组装 |
| `apps/desktop/src/renderer/state/appearance.ts` | 主题与种子 |
| `apps/desktop/src/renderer/state/workbench-layout.ts` | 坞几何 |
| `.trellis/spec/frontend/design-language.md` | 本仓英文强制合同 |
| `docs/design.md` | 本仓英文、含当前工作面几何 |

---

## 15. 本仓如何验收（迁移后换成你的门）

| 门 | 本仓命令 |
| --- | --- |
| 静态设计审计 | `pnpm ui:audit` |
| 视觉与几何 | `pnpm ui:shots` |
| 减少动效 | `node scripts/ui-shots.mjs --reduced-motion` |
| 对比与 token | `appearance.test.ts` |
| 行为 | 桌面 vitest |

不能机检的规则，靠截图人工读。

---

## 16. 可复制 token（CSS）

把下面整段放进目标项目的唯一 token 文件。业务样式只引用变量。

```css
:root,
html[data-theme="light"] {
  color-scheme: light;
  --color-sunken: #e2ded4;
  --color-canvas: #eeeae1;
  --color-surface: #f7f4ee;
  --color-raised: #fffefb;
  --color-line: #d5d2c8;
  --color-border: #82857e;
  --color-border-strong: #6d716b;
  --color-text: #1f1d1a;
  --color-text-muted: #585c57;
  --color-text-subtle: #5c605c;
  --color-accent-seed: #765847;
  --color-accent: #765847;
  --color-accent-hover: #6a5041;
  --color-accent-active: #5f493b;
  --color-accent-soft: #e5ded7;
  --color-on-accent: #fffefb;
  --color-focus: #765847;
  --color-success: #1b5e3f;
  --color-warning: #7a4a08;
  --color-error: #a32f2f;
  --color-info: #1f5570;
  --color-success-soft: #dfe9e2;
  --color-warning-soft: #f0e6d3;
  --color-error-soft: #f4dedd;
  --color-info-soft: #dce8ee;
  --color-on-solid: #fffefb;
  --color-brand-burnt: #d9562b;
  --color-brand-ochre: #d29a2e;
  --color-brand-lichen: #87904a;
  --color-brand-teal: #4f8076;
  --color-brand-dusk: #526f86;
  --color-series-ochre: #a3761a;
  --color-series-lichen: #667130;
  --color-series-burnt: #ad3f1d;
  --color-series-teal: #356057;
  --color-series-dusk: #374b5c;
  --color-scrim: rgb(31 29 26 / 38%);
  --color-hover-tint: rgb(31 29 26 / 5%);
  --color-active-tint: rgb(31 29 26 / 9%);
  --shadow-sm: 0 1px 2px rgb(31 29 26 / 7%);
  --shadow-md: 0 6px 18px rgb(31 29 26 / 11%);
  --shadow-lg: 0 18px 44px rgb(31 29 26 / 18%);
}

html[data-theme="dark"] {
  color-scheme: dark;
  --color-sunken: #121110;
  --color-canvas: #1a1714;
  --color-surface: #24211c;
  --color-raised: #2f2b25;
  --color-line: #37332c;
  --color-border: #79756b;
  --color-border-strong: #8b8579;
  --color-text: #f3efe8;
  --color-text-muted: #a5a89f;
  --color-text-subtle: #96948b;
  --color-accent-seed: #765847;
  --color-accent: #b98a70;
  --color-accent-hover: #c39a83;
  --color-accent-active: #cba894;
  --color-accent-soft: #45382e;
  --color-on-accent: #1f1d1a;
  --color-focus: #b98a70;
  --color-success: #63c093;
  --color-warning: #e0ac4b;
  --color-error: #f08a8a;
  --color-info: #77bcd9;
  --color-success-soft: #1c2f26;
  --color-warning-soft: #332a17;
  --color-error-soft: #3a2222;
  --color-info-soft: #1d2a33;
  --color-on-solid: #1a1714;
  --color-series-ochre: #e8c063;
  --color-series-lichen: #b0bb72;
  --color-series-burnt: #eb8258;
  --color-series-teal: #5f978c;
  --color-series-dusk: #5a7d95;
  --color-scrim: rgb(7 6 5 / 62%);
  --color-hover-tint: rgb(243 239 232 / 6%);
  --color-active-tint: rgb(243 239 232 / 10%);
  --shadow-sm: 0 1px 2px rgb(0 0 0 / 40%);
  --shadow-md: 0 6px 18px rgb(0 0 0 / 52%);
  --shadow-lg: 0 18px 44px rgb(0 0 0 / 62%);
}

:root {
  --space-0-5: 2px;
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;
  --space-7: 32px;
  --space-8: 48px;
  --radius-sm: 4px;
  --radius-md: 6px;
  --radius-lg: 8px;
  --radius-full: 999px;
  --font-display: "Space Grotesk", "Segoe UI Variable Display", system-ui, sans-serif;
  --font-ui: "Chivo", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif;
  --font-mono: "Space Mono", ui-monospace, "Cascadia Mono", Consolas, monospace;
  --font-cjk: "Noto Sans SC", "Microsoft YaHei", "PingFang SC", sans-serif;
  --text-2xs: 0.6875rem;
  --text-xs: 0.75rem;
  --text-sm: 0.8125rem;
  --text-md: 0.875rem;
  --text-lg: 1rem;
  --text-xl: 1.25rem;
  --text-2xl: 1.625rem;
  --text-3xl: 2.125rem;
  --leading-tight: 1.2;
  --leading-snug: 1.35;
  --leading-body: 1.5;
  --leading-cjk: 1.75;
  --weight-regular: 400;
  --weight-medium: 500;
  --weight-semibold: 600;
  --weight-bold: 700;
  --tracking-tight: -0.01em;
  --tracking-normal: 0;
  --tracking-wide: 0.02em;
  --control-h-xs: 24px;
  --control-h-sm: 32px;
  --control-h-md: 36px;
  --control-h-lg: 40px;
  --z-base: 0;
  --z-sticky: 10;
  --z-dock: 20;
  --z-menu: 30;
  --z-dialog: 40;
  --z-toast: 50;
  --motion-instant: 60ms;
  --motion-fast: 120ms;
  --motion-base: 160ms;
  --motion-slow: 220ms;
  --ease-standard: cubic-bezier(0.2, 0.8, 0.2, 1);
  --ease-decelerate: cubic-bezier(0, 0, 0.2, 1);
  --ease-accelerate: cubic-bezier(0.4, 0, 1, 1);
  --stagger-step: 40ms;
  --chrome-height: 44px;
  --rail-w: 40px;
  --measure: 68ch;
  --focus-width: 2px;
  --focus-ring: var(--focus-width) solid var(--color-focus);
  --focus-offset: 2px;
}

@media (prefers-reduced-motion: reduce) {
  :root {
    --motion-instant: 0ms;
    --motion-fast: 0ms;
    --motion-base: 0ms;
    --motion-slow: 0ms;
    --stagger-step: 0ms;
  }
}
```

---

## 17. 设计读法（可贴进新项目的 README 头）

> 专业桌面工作面。暖纸冷结构，一个强调色，品牌色带只做数据。密度 8，动效 5，变化 6。实心材料，32 px 地板，每面一个主操作。空状态不重复页头。可见页不是全集。行生命周期在铬上，不在每行控件里。

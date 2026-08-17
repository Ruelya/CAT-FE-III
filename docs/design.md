# Translunar 前端设计

| 项 | 值 |
| --- | --- |
| 日期 | 2026-08-17 |
| 范围 | Electron 渲染进程里已经落地的界面，不是愿望清单 |
| 视觉权威 | `.trellis/spec/frontend/design-language.md` + `apps/desktop/src/renderer/tokens.css` |
| 交互权威 | `.trellis/spec/frontend/electron-workbench.md` |
| 实现锚点 | `apps/desktop/src/renderer/`（合并课件向工作台 + Option 2 分页之后） |

本文提取**当前产品**的前端设计。颜色、圆角、运动、z-index 只允许出现在 `tokens.css`。另一份文档和这份打架时，以 `design-language.md` 和 `tokens.css` 为准，并在同一次改动里修正过期文档。

---

## 1. 设计读法

这是给职业译者和本地化工程师用的**本机优先 CAT 工作台**。人从 Trados / memoQ / Phrase 过来，在同一窗口里坐几个小时。评判标准是密度、键盘可达、工具是否让路。

不是营销站，不是消费 App，不是分析看板。

一句话：**安静的校样结构，暖纸冷墨，工业控件，高信息密度，品牌色带只做数据而不是装饰。**

| 旋钮 | 值 | 含义 |
| --- | ---: | --- |
| 变化 | 6/10 | 工作流可预期，层次可以不对称。禁止营销构图。 |
| 运动 | 5/10 | 覆盖面广、幅度小、必有因果。禁止环境动画。 |
| 密度 | 8/10 | 专业密度。可点目标不低于 32 px。 |

`.agents/skills/design-taste-frontend` 和 `ui-ux-pro-max` 面向落地页和移动端。本产品的主体是密表、段网格、多步表单，那两份技能的默认审美**不采用**。

前端只做展示和交互。分段、TM、QA、计数、导出门都在 Rust 引擎。渲染进程不直连 SQLite。

---

## 2. 信息架构

`App.tsx` 同时只挂一个 surface。没有 URL 路由。去向由 `routes/resolveSurface.ts` 和 `use-app-controller.ts` 决定。

### 2.1 产品壳

`shell/AppChrome.tsx` 是唯一的标题条：

- 左：品牌五色带 + 产品名 + 当前项目 / 文件
- 中：File 菜单（工作台时：Add files / Save / Pretranslate / Reimport / Recycle）
- 右：Home、Search、Command palette、AI、Assets、Settings，以及 QA / Export / Insights；Windows/Linux 上还有自定义最小化 / 最大化 / 关闭
- macOS 用系统红绿灯（`hiddenInset`）；其他平台用渲染进程控件（`hidden`）

外观存在 `localStorage` 键 `translunar.renderer.appearance.v1`（theme + accentSeed）。不进 `ProductShellSettings`，不进 git。

### 2.2 Surface 清单

| Surface | 角色 |
| --- | --- |
| Welcome | 零项目时的第一屏。Create project / Open example。列出真实支持的导入格式。 |
| Project Home | 活动 / 归档项目列表。 |
| Create / Import | 建项与选文件。导入后进工作台，不在向导里再插 Memory / Terms 门。 |
| **Workbench** | 视觉和交互的中心。段网格 + 情报 + 预览。 |
| QA / Export | 质检与交活。豁免要记人、记理由。 |
| Asset Hub | 项目内 TM / TB / 对齐 / 语料 / 目录 / 策展。 |
| Insights | 分析、interop、任务包。 |
| Templates / Recycle / Search | 模板、回收站、全局搜索。 |
| AI Control / Plugins / Collaboration / Settings | P4 壳。协作在本产品范围里整段排除，入口按能力隐藏。 |

次级 surface 用紧凑列表和表单，不要 bento、不要等权功能卡。

### 2.3 工作台（当前布局）

工作台是 IDE 形 CAT 编辑器，不是四列表格加右侧 Exact TM。

```text
+-- AppChrome: brand ribbon, title, File, nav, window controls --------+
| Act | Files   | EditorTabs                                           | Preview      |
| bar | FileNav | CommandBar  Confirm / Find / Tags / Comments         | Live recon   |
| F/P |         | FilterBar   Open Draft Confirmed Findings ...        | DOMPurify    |
| /C  |         | IntelDock   Matches / Terms / Concordance / AI       | click to jump|
|     |         | SegmentGrid # | Ctx | Source | Target | Status       |              |
|     |         | paging      Previous   n-m of N   Next               |              |
+-----+---------+------------------------------------------------------+--------------+
| Status: file, locales, progress, counts          Add files / Pretranslate          |
+-----------------------------------------------------------------------------------+
```

默认几何（`workbench-layout.v1`）：

| 坞 | 默认 | 夹紧 |
| --- | ---: | --- |
| 文件列表 | 200 px | 140–360 |
| 情报窗 | 300 px | 220–480 |
| 右侧预览 | 280 px | 200–520 |

默认：文件列表开、预览开、ACP 聊天关。活动条只开关这三块坞，不另开一套导航。

**网格列**：`#` · `Ctx` · Source · Target · Status。

- Ctx 用 `structureLabel(structuralPath)`，例如 `html`。
- Source 用 `TaggedText`：行内标签是 `inline-tag` 芯片，不是纯文本。Ctrl/Meta+点击源标签可放到译文（QuickPlace）。
- 只有活动行挂 `TargetEditor`（隐藏 `textarea` 的 testid 仍是 `target-editor-${id}`，可见层 `target-surface-${id}`）。
- Status：Open / Draft / Confirmed，外加 Translation / Review / Signed 工作流。

**过滤有两层，不要合成一个控件：**

1. `DisplayFilterBar`：当前页上的客户端组合（Open / Draft / Confirmed / Findings / Comments / Repeats + 文本 / 正则 / 空白 / 标签显示）。testid：`display-filter`。
2. 引擎分页：`segment.editor.list` 的一页窗口。testid：`bilingual-grid`、`segment-paging`。文档计数用引擎 `counts`，禁止用当前页冒充全文。

**情报窗**在网格**上方**（`IntelDock placement="top"`）：Matches / Terms / Concordance / AI。这是课件向工作台，不是右侧 Exact TM 单栏。

**预览**在右侧，是 `StructurePreview`：

- Markdown：`marked` → `DOMPurify`
- HTML：按标签重铺 → `DOMPurify`
- 其他：标签到排版 → 同一消毒器
- 有托管 DOCX 字节时，`docx-preview` 画原文件，**在**可点击的 live 块上面
- testid：`structure-preview`、`preview-block-${segmentId}`
- 这不是 Word COM，不是 PDF 页坞，也不是 OnlyOffice

OnlyOffice 只读宿主（`LayoutPreview`）还在仓库里，**默认不挂进工作台**，以免把 live preview 挤掉。

PDF 文件另开 `PdfPageReview` 坞，规则见 `interop-pdf.md`。

---

## 3. 颜色

暖纸面 + 冷绿灰结构 + 唯一交互强调色（高级棕）。语义色（成功 / 警告 / 错误 / 信息）主题固定，不从强调色种子派生。

### 3.1 浅色（默认）

运行时默认种子是 `#765847`（`tokens.css` / appearance-v1）。下面是浅色主题的表面和结构。

| Token | Hex | 用途 |
| --- | --- | --- |
| `--color-sunken` | `#e2ded4` | 凹陷 |
| `--color-canvas` | `#eeeae1` | 画布 |
| `--color-surface` | `#f7f4ee` | 面板 |
| `--color-raised` | `#fffefb` | 抬起 / 输入 |
| `--color-line` | `#d5d2c8` | 装饰分割线 |
| `--color-border` | `#82857e` | 控件边 |
| `--color-text` | `#1f1d1a` | 正文 |
| `--color-text-muted` | `#585c57` | 次要（冷绿灰） |
| `--color-accent` | 由种子派生 | 唯一交互强调 |
| `--color-success` | `#1b5e3f` | 成功 |
| `--color-warning` | `#7a4a08` | 警告 |
| `--color-error` | `#a32f2f` | 错误 |
| `--color-info` | `#1f5570` | 信息 |

相邻表面 CIE L\* 差 ≥ 2.5，结构不靠描边也能分开。

### 3.2 深色

画布 `#1a1714`，表面 `#24211c`，正文 `#f3efe8`。强调色变亮（默认派生约 `#b98a70`），语义色同样主题固定。

### 3.3 品牌色带（只做标识和数据）

顺序固定，不可调换。不给按钮上色。

| 顺序 | 名 | 标识 Hex |
| --- | --- | --- |
| 1 | Burnt | `#d9562b` |
| 2 | Ochre | `#d29a2e` |
| 3 | Lichen | `#87904a` |
| 4 | Teal | `#4f8076` |
| 5 | Dusk | `#526f86` |

进度条、QA 严重度、文档类型、图表序列用派生的 `--color-series-*`。段与段之间留 1 px 父表面缝。状态永远是颜色 + 文字，有空再加 Phosphor 图标。

### 3.4 硬规则

- 每个 surface 只有一个强调色。
- 禁止 `backdrop-filter`、毛玻璃、半透明面板。遮罩和状态染色必须走 token。
- 禁止在 `tokens.css` 外写裸色值。`pnpm ui:audit` 检查。
- 自定义种子必须让 on-accent 正文 ≥ 4.5:1、焦点环对画布 / 表面 / 抬起 ≥ 3:1，否则拒绝并说明原因。

---

## 4. 字体与尺度

四套打包字体，运行时不拉网字。

| Token | 字体 | 用途 |
| --- | --- | --- |
| `--font-display` | Space Grotesk | 标题、品牌、空态标题 |
| `--font-ui` | Chivo | 全部界面正文 |
| `--font-mono` | Space Mono | 数字、ID、语对、路径、快捷键 |
| `--font-cjk` | Noto Sans SC | 源/译文和任何 CJK。不预加载。 |

数字列用 `tabular-nums`。斜体只用于真正的强调，不用在标签上。

字号：11 / 12 / 13 / 14 / 16 / 20 / 26 / 34（`--text-2xs` … `--text-3xl`）。34 只给 Welcome。正文行宽 ≤ 68 字符；表格格不是正文。

间距只允许 2 / 4 / 8 / 12 / 16 / 20 / 24 / 32 / 48。

圆角只允许 4 / 6 / 8 / 999（点、头像）。

控件高度 32 / 36 / 40。**可点目标地板 32 px**。看起来更小的东西用 padding 或伪元素扩热区。

阴影只有三级，而且带纸色，不用纯黑：行 / 菜单 / 对话框。面板深度靠表面阶梯 + 1 px 边，不靠阴影。

z-index 只走 `--z-base|sticky|dock|menu|dialog|toast`。

---

## 5. 运动

宽覆盖、小幅度、有因果。只动画 `transform` 和 `opacity`（坞轨道宽度是唯一例外）。

| 类 | 触发 | 做法 |
| --- | --- | --- |
| M1 | 换 surface | View Transition 或 8 px 上移交叉淡入，160 ms |
| M2 | 坞开合 | 轨道宽 + 透明度，220 ms。内容保持挂载，`inert` |
| M3 | 活动行 | 左强调条 + 浅棕底 |
| M4 | 异步 | 骨架几何对齐结果；按钮保留文案 |
| M5 | 确认 / 保存成功 | 状态芯片变色 + 一次 `scale(1.04→1)` |
| M6 | 列表首屏 | 前 8 行 6 px 上移。密表禁止过冲缓动 |
| M7 | `:active` | `translateY(1px)` 或 `scale(0.985)`，60 ms |

`prefers-reduced-motion: reduce` 时所有运动 token 归零。

---

## 6. 交互合同（工作台）

这些是译者手感，不是装饰。

| 动作 | 合同 |
| --- | --- |
| 确认 | Ctrl+Enter 跳到下一未确认；Ctrl+Alt+Enter 严格下一段；Ctrl+Shift+Enter 停在本段。本页走完且后面还有，再拉下一页。 |
| 保存 | Ctrl+S / File → Save 走 `SaveCoordinator.flush`。IME 合成中不确认、不保存。 |
| 行间移动 | 上下箭头在网格里走，不离开网格。 |
| 源标签 | 芯片。Ctrl/Meta+点击放到译文。相邻占位可成组。 |
| 过滤条 | 多条件组合，不是单选替换。计数必须说清「当前看见多少 / 文档一共多少」。 |
| 分页 | 引擎窗口。`Previous` / `1–n of N` / `Next`。 |
| QA Jump | 按 `focusSegmentId` 翻页找段，段不在当前页也不能直接 return。 |
| 预览跳段 | 点 preview 块或 Enter/Space。 |
| 空态 | 主按钮已经在桅杆上时，空态只陈述事实，不再重复同一个动作。 |
| 破坏性确认 | 初始焦点在最安全的动作（通常是 Cancel；恢复草稿时是 Recover）。 |

隐藏的 `textarea.sr-only` 仍是自动化锚。对它 `click` 必须 `{ force: true }`。

红线 testid（不要改名）：`workbench`、`bilingual-grid`、`display-filter`、`intel-dock`、`structure-preview`、`segment-paging`、`target-editor-*`、`target-surface-*`、`add-files`、`file-nav`。

---

## 7. 组件形状

**按钮**五种：primary（每个 surface 一个）、secondary、ghost、quiet、danger。文案不换行，主按钮最多三词。不要为了填满容器而拉满宽。Pending 时保留文案、禁止连点。纯图标必须同时有 `title` 和 `aria-label`。

**字段**：标签在上，控件，提示在下，错误在提示下。Placeholder 不是标签。

**表**：粘性表头，1 px `--color-line` 行线，悬停浅底，选中 = accent-soft + 左强调条。数字右对齐、等宽。滚动关在面板里，禁止文档级横向溢出。

**坞 / 对话框**：收起的坞内容保持挂载，`inert` + `aria-hidden`。对话框锁焦、Esc 非破坏、异步完成前不卸掉。

**图标**：只用 `@phosphor-icons/react`。密条 16、标题条 18、空态 20。默认 `regular`，窗控和开关用 `bold`。

**状态**：语义芯片 = 颜色 + 字 + 图标。短暂结果进 toast；持久结果留在产生它的控件旁边。

---

## 8. 文案

短、能执行、用行业词。说事实和可恢复动作。

禁止：说明性副标题、导游式微文案、功能旁白、未来功能、`不是` 对照句、营销词（Elevate / Seamless / Unleash / Next-Gen）、编造精确数字、可见文案里的 em dash / en dash、装饰状态点、滚动提示、产品壳上的版本戳。

标签和标题用 sentence case。专有名词才 Title Case。

---

## 9. 可达性地板

两个主题都要 WCAG 2.2 AA。

- 全部工作流键盘可走完，焦点环永不摘掉
- 重复行操作的名字里带上行身份
- `role="status"` 报状态，`role="alert"` 报可处理失败，不抢焦
- 阅读顺序等于视觉顺序；换 surface 后焦点落到新标题
- CJK IME 合成不被确认 / 保存打断
- 可用视口：1180×700、1250×744、1680×942、1920×1080，以及 125% 字号。禁止文档级横溢、重叠、裁切、藏起主操作

---

## 10. 这不是什么

写 UI 时不要滑回这些错误名词：

| 不是 | 为什么 |
| --- | --- |
| VS Code / Zed / Monaco 当产品 | 那是代码编辑器。脊梁是段对 + 标签 + TM。 |
| OnlyOffice / Word 当编辑器 | 文档套件只能当预览宿主。默认预览是 live reconstruction。 |
| 自称已经达到 Trados | 没有 Word COM、没有七档审校、没有 `.sdltm/.sdltb`、没有云协作。做到接近，不要宣称已达。 |
| 自制四列表格冒充 Studio | 课件向布局（情报在上、预览在右、底栏）才是当前译者表面。 |
| 当前页计数冒充全文 | 计数来自引擎 `counts`。 |

---

## 11. 文件地图

| 路径 | 职责 |
| --- | --- |
| `apps/desktop/src/renderer/tokens.css` | 唯一允许写裸色 / 圆角 / 运动 / z 的文件 |
| `apps/desktop/src/renderer/styles/` | 重置、壳、工作台、surface |
| `apps/desktop/src/renderer/surfaces/Workbench.tsx` | 工作台编排 |
| `apps/desktop/src/renderer/workbench/SegmentGrid.tsx` | 段网格 + 分页 |
| `apps/desktop/src/renderer/workbench/IntelDock.tsx` | 记忆 / 术语 / 语境 / 段 AI |
| `apps/desktop/src/renderer/workbench/StructurePreview.tsx` | 右侧 live preview |
| `apps/desktop/src/renderer/workbench/DisplayFilterBar.tsx` | 客户端过滤条 |
| `apps/desktop/src/renderer/workbench/TaggedText.tsx` | 源文标签芯片 |
| `apps/desktop/src/renderer/state/appearance.ts` | appearance-v1 |
| `apps/desktop/src/renderer/state/workbench-layout.ts` | 坞宽和开关 |

---

## 12. 验收

| 门 | 命令 |
| --- | --- |
| 设计系统静态审计 | `pnpm ui:audit` |
| 视觉 + 几何 | `pnpm ui:shots` / `pnpm ui:shots:matrix` |
| 减弱运动 | `node scripts/ui-shots.mjs --reduced-motion` |
| 对比度与 token | `apps/desktop/src/renderer/state/appearance.test.ts` |
| 行为 | `pnpm --filter @translunar/desktop test` |

机械查不了的规则，对着 `ui-shots` 的 PNG 看。

---

## 13. 禁止清单

毛玻璃 · 第二强调色 · 从强调色派生语义色 · `tokens.css` 外的裸色 · 4/6/8/full 以外的圆角 · 裸 `z-index` · 裸运动时长 · 第二套图标 · 手绘图标路径 · 用 emoji 当结构图标 · 用 placeholder 当标签 · 可点目标小于 32 px · 用 `display: none` 做坞动画 · 动画宽高 top left（M2 除外） · 环境运动 · 密表过冲 · 转圈替换按钮文案 · 光秃的 `Loading` / `Empty` · 没有空态的空表 · 把 JSON 当界面 · 半套 `role="tab"` · 破坏性操作没有 Cancel-first · 可见文案里的 em/en dash · 营销词 · 非数据驱动的 inline layout style。

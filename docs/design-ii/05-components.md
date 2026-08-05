# 05 · 组件规格库

> 每个组件的结构：**几何 → 状态 → 键盘 → 无障碍 → 禁止**。
> 所有组件遵守 `01-art-direction.md` 命题五（板块与接缝）：常驻组件**无圆角、无阴影、无 gap**。

---

## A. 表面与容器

### A1 · Plate（板块）
唯一的容器原语。四个变体：`--deck` / `--paper`（默认）/ `--frame` / `--ink`。
`border-radius: 0`、`box-shadow: none`、板块之间直接对接。
分区靠 §A2 的缝，不靠内边距间隙。

### A2 · Seam（接缝）
三档：`--rule-strong`（结构）/ `--rule`（面板）/ `--rule-soft`（内部）。全部 1px。
横缝用 `border-block-end`，竖缝用 `border-inline-end`。**禁止用 `<hr>` 或 `div` 假缝。**

### A3 · Brand Plate（品牌板）
`--ink` 面 + 单角 45° `corner-shape: bevel`（14px）。**每屏最多一处。**
承载：屏级标识、面板主标题、命令面板头。内部只放 Jost 标题 + 至多一行 `--t-micro`。

### A4 · Popover
`popover` 属性 + CSS Anchor Positioning 锚定触发源。`--deck` 底、`--r-pop` 圆角、
1px `--rule-strong` 边、`--elev-pop` 单级阴影。`position-try-fallbacks: flip-block, flip-inline`。
关闭时焦点**必须**回触发源。**禁止**背景模糊。

### A5 · Dialog（模态）
`<dialog>` + `showModal()`。宽度三档：`sm 420` / `md 560` / `lg 760`。
结构：`Brand Plate 头（标题 + 一行 kicker）/ 内容（--deck）/ 动作区（--frame，右对齐）`。
遮罩 `--scrim`（不模糊）。`Esc` 关闭；有未保存内容时 `Esc` 触发二次确认。
**只用于**：破坏性确认、必须阻断的输入、系统级恢复。**其余一律用抽屉或就地编辑。**

### A6 · Drawer（抽屉）
本设计的**默认叠层形式**（取代大量模态）。从右侧或底部推入，宽 360/420/560。
不带遮罩（除非在 <1180px 覆盖网格时）。可 `Esc` 关闭，焦点回触发源。
**滚动锁**只锁抽屉内部，主区域仍可滚动阅读。

### A7 · Toast
右下角堆叠，最多 3 条，宽 320–420。`--ink` 面、4px 左缘状态色、`--r-pop`。
自动消失 4.5s（错误类**不自动消失**）。带撤销的 toast 停留 8s。
`aria-live="polite"`（错误用 `assertive`），**不夺焦点**。
**禁止**：全宽横幅式 toast、堆叠 >3、居中 toast。

### A8 · Banner（横幅）
就地插入内容流（不浮动）。`--frame` 底 + 3px 左缘状态色 + 图标 + 文案 + ≤2 个动作。
阻断性错误横幅的左缘 3px 允许使用低透明度斜纹（**全应用唯一允许斜纹之处**）。

---

## B. 动作

### B1 · Button

| 变体 | 面 | 文字 | 边框 | 用途 |
| --- | --- | --- | --- | --- |
| `primary` | `--signal` | `--text-1`（**墨字，永不白字**） | 1px `--rule-field` | **每屏仅一个** |
| `secondary` | 透明 | `--text-1` | 1px `--rule-field` | 常规动作 |
| `ghost` | 透明 | `--text-2` | 无 | 低优先动作、图标按钮 |
| `danger` | 透明 | `--err-ink` | 1px `--err` | 破坏性，**必经确认** |
| `on-ink` | 透明 | `--text-on-ink` | 1px `rgb(243 239 231 / .40)` | Ink 面上的动作 |

几何：高 `--ctl-h`（Standard 32px），内距 `0 14px`，圆角 `--r-ctl` 4px，字重 500。
主表单动作高 40px。图标按钮 `--ctl-h` 见方。

状态：hover = 底加深 6%；**按下 = `translate: 0 1px` + 底再深 4%**；
disabled = `--text-3` + `cursor: not-allowed` + `aria-disabled`（**不用 `disabled` 属性**，
否则丢失可聚焦性与 tooltip）；loading = 内容替换为 3 点脉冲 + `aria-busy`，宽度**不变**（防跳动）。

禁止：药丸按钮、渐变、发光、投影、>6px 圆角、纯图标无 `aria-label`。

### B2 · Icon Button
`--ctl-h` 见方，`--icon` 16px 图标，1.5px 线宽。**必须**有 `aria-label` + tooltip。
命中区不小于 28×28（Compact）。

### B3 · Split Button
主动作 + 4px 缝 + 12px 宽的 `▾`。用于"导出（默认格式）/ 选择格式"。
`▾` 部分开 Popover 菜单。键盘：`Enter` 主动作，`Alt+↓` 开菜单。

### B4 · Chip（筛选/标记）
高 28px，圆角 4px，`--frame` 底，1px `--rule`。含 `方灯? + 文字 + Mono 计数?`。
选中：`--shade` 底 + 下缘 Active Axis。**Chip 是本设计里唯一接近药丸的形状**，
且只用于筛选与标签。**导航项、按钮、状态标记一律不做成 chip。**

### B5 · Menu
Popover 内的 `role="menu"`。项高 32px，左侧 20px 图标槽，右侧快捷键（Mono 11px `--text-2`）。
分组用 `--rule-soft` 缝 + `--t-micro` 组标题。破坏性项在最后一组，文字 `--err-ink`。
键盘：`↑↓` 移动、`Home/End`、首字母跳转、`→` 进子菜单、`Esc` 逐层关闭。

---

## C. 输入

### C1 · Text Field
`--deck` 底、**1px `--rule-field` 边**、`--r-input` 3px、高 `--ctl-h`、内距 `0 10px`。
> 边框用 `--rule-field`（56%）而非 `--rule`：`--deck` 填充对 `--frame` 底只有 1.20:1，
> 靠填充无法界定控件边界。实算见 `08-accessibility.md §1.2`。
**可见标签必填**（`--t-meta`，位于字段上方 6px），占位符**不得**替代标签。
聚焦：边框 2px `--signal`（Axis 驻留态），`outline: none`（不叠双环）。
错误：边框 `--err` + 字段下方 `--t-meta` 的 `--err-ink` 文案 + `aria-describedby` + `aria-invalid`。
帮助文本常驻（不是 tooltip）。
**验证时机**：`blur` 时校验，不在每次击键时报错。

### C2 · Textarea
同 C1 + `field-sizing: content`，`min-block-size` 3 行，`max-block-size` 12 行后内部滚动。

### C3 · Select
原生 `<select>` 加样式（保证键盘与 IME 行为正确）。高 `--ctl-h`，右侧 `▾` 用背景图。
**超过 12 项**改用 §C4 Combobox。

### C4 · Combobox（可搜索选择器）
输入框 + Popover 列表。`role="combobox"` + `aria-expanded` + `aria-activedescendant`。
命中字符用 `--signal-ink` 加粗（**不用背景高亮**）。支持拼音首字母（中文选项）。

### C5 · Number Field
Mono 字体，`tabular-nums`，右对齐。步进器是**两个 14px 高的方形按钮**竖排在右侧（不是圆形）。
`↑↓` 步进，`Shift+↑↓` ×10。带单位时单位是字段内右侧的 `--text-2` 静态后缀。

### C6 · Checkbox / Radio
16×16。Checkbox **方形**（2px 圆角），Radio 圆形。
未选：1px `--rule-field` 边 + `--deck` 底。选中：`--signal` 底 + `--text-1` 勾/点（墨色）+ 1px `--rule-field` 边。
`indeterminate` 用横条。标签可点击，标签与控件间距 8px。

### C7 · Switch
仅用于**立即生效的二元开关**（如"跟随当前段"）。40×20，轨道 `--rule-strong` / 选中 `--signal`，
滑块 12×12 方形（2px 圆角，`--deck`）。
**需要"保存"才生效的设置一律用 Checkbox，不用 Switch**——Switch 暗示即时生效。

### C8 · Segmented Control
2–4 项互斥。`--frame` 底，选中项 `--deck` 底 + 1px `--rule-strong` 边 + Active Axis 在下缘。
高 `--ctl-h`。用于：Active/Archived、明/暗/系统、源/目标范围。

### C9 · Slider
仅用于**连续且可粗调**的值（预览缩放、字号）。轨道 2px `--rule-strong`，
滑块 12×12 方形，填充段 `--signal`。**必须**并列一个数值 Number Field（键盘精确输入）。

### C10 · File Drop Zone
1px **虚线** `--rule-strong` 边（虚线是本设计唯一允许虚线的地方——它表达"待填充"）。
默认 `--paper` 底；拖入时 `--shade` 底 + 边框变 `--signal` + 内部 Inert Matrix 淡入。
必须同时提供 `选择文件` 与 `选择文件夹` 按钮（拖拽不是唯一入口）。

---

## D. 数据展示

### D1 · Data Table
行分隔用 `--rule` 横缝；**无斑马纹**；列头 `--frame` 底 + sticky + `--t-micro`。
可排序列头带 `↑↓` 指示 + `aria-sort`。数值列右对齐 + Mono + `tabular-nums`。
行 hover `--shade`；选中行 `--shade` + 左缘 Active Axis。
分页在表底：`共 1,248 条 · 每页 50 ▾ · ‹ 1 2 3 … 25 ›`。

### D2 · Status Lamp
8px 方形，形状+色+文本三重编码。完整表见 `screens/workbench.md §3.3`。
**永不单独出现**——必须伴随可见文本或 `aria-label`。

### D3 · Progress
- **确定性**：4px 高横条，`--rule` 轨道 + `--signal` 填充 + 右侧 Mono 百分比。
- **不确定**：2px 高的往复轨（`04-motion.md` 编排 F），**仅在真实操作进行中**。
- **堆叠比例条**：见 `06-shell-navigation.md §4`（仪表条）与洞察页。
- **禁止**圆形 spinner。

### D4 · Live Matrix
见 `03-signatures.md §2`。**必须有标题 + 图例 + 键盘操作**。

### D5 · Skeleton
与最终布局**同形**的 `--frame` 色块。加载 >300ms 才显示。
可选极缓 shimmer（1.4s，Reduced Motion 下关闭）。

### D6 · Empty State
高表达区。结构：
```
[大留白 + Inert Matrix 裁切块]
标题（--t-title，Jost）          ← 说明"为什么空"
一行说明（--t-body，--text-2）    ← 说明"怎么办"
[一个主动作]  [一个次动作?]
```
**禁止**：氛围散文、插画吉祥物、"暂无数据"、只有图标没有下一步。

### D7 · Metric（数字块）
`--t-micro` 标签在上，Mono 20–28px 数值在下，可选 `--t-meta` 变化量。
**禁止**做成大 KPI 卡；**禁止**没有用户决策与之关联的仪表盘数字。

### D8 · Word Diff
删除词：`--text-2` + `text-decoration: line-through`。
新增词：`--text-1` + 1px 下划线（`text-underline-offset: 3px`）。
**不用彩色背景块**——绿/红背景与状态色语义冲突。

### D9 · Tag Pill（受保护标签）
见 `screens/workbench.md §3.4`。

### D10 · Code / Path
Mono 12.5px，`--frame` 底，2px 圆角，内距 `1px 4px`。用于文件路径、结构路径、规则 ID、哈希。
长路径中段省略（`word/document.xml#…#p:3`），完整值在 tooltip 与 `title`。

---

## E. 导航

### E1 · Index Spine
见 `06-shell-navigation.md §2`。

### E2 · Tabs（横向）
仅在 ≤6 项时使用。高 40px，`--t-section` 字号，间距 20px，
选中项下缘 Active Axis + 文字 `--text-1`，未选中 `--text-2`。
计数用 Mono 附在标签后。键盘：`←→` 移动 + 自动激活；`Home/End`。
**≥7 项一律改用 §E3。**

### E3 · Tab List（竖向）
180px 宽的左侧列（`--frame` 面 + 右缘结构缝）。项高 36px，左侧 16px 图标槽。
选中项左缘 Active Axis + `--shade` 底。分组用 `--t-micro` 组标题。
用于：项目洞察的 11 个子标签、设置的分组。

### E4 · Breadcrumb
仅在 ≥3 层时出现。`--t-meta`，分隔符是 `/`（`--text-3`）。最后一项不可点。

### E5 · Stepper（向导步进器）
竖向。每步：`Mono 编号（2 位，如 01）` + 标题 + 状态图标。
已完成 = `--ok` 勾；当前 = Active Axis 在左缘 + `--text-1`；未来 = `--text-2`。
**编号与标题之间必须有 12px 间距**（上一代的 `02Configuration` 粘连是明确缺陷）。
**不用倒计时式文案**（`T-3` / `LAUNCH`）。

### E6 · Pagination
`‹ 上一页  第 3 / 25 页  下一页 ›` + 可输入页码 + 每页条数选择器。
Mono 数字。当前页用 `--shade` 底 + Axis。

---

## F. 反馈与保护

### F1 · Tooltip
锚定式 Popover，`--ink` 底、`--text-on-ink`、`--t-meta`、6px 圆角、内距 `6px 8px`。
延迟 400ms 出现，80ms 消失。含快捷键时快捷键用 `<kbd>`。
**只做补充说明，不承载必需信息**（图标按钮必须另有 `aria-label`）。

### F2 · Confirm Dialog
`sm` 尺寸。结构：`标题（做什么）/ 一句后果说明 / [取消] [执行]`。
**破坏性动作的执行按钮是 `danger` 变体，且不是默认焦点**（默认焦点在"取消"）。
不可逆动作要求**输入确认**（如键入项目名）——仅用于"永久清除"级别。

### F3 · Undo Toast
执行后立即出 toast：`已移入回收站 · 撤销`。停留 8s。
**批量与破坏性动作必须提供撤销**（PRD 原则：使用者主权）。

### F4 · Inline Error
字段下方 `--t-meta` + `--err-ink` + 12px 警告图标。`aria-describedby` 关联。
**必须说明原因与修复方式**，不写 "Invalid input"。

### F5 · Error State（区块级）
结构：`发生了什么 / 你的工作怎么样了 / 一个恢复动作 / 技术细节（折叠）`。
**必须**明确说明用户数据是否保住（如"已输入的译文保存在本地草稿中"）。
**禁止** `ABORT` / `MISSION FAILED` 式文案。

---

## G. 特有组件（本产品自有对象）

### G1 · Segment Row
见 `screens/workbench.md §3.2`。

### G2 · Match Card
见 `screens/workbench.md §4.3`。

### G3 · Term Row
见 `screens/workbench.md §4.4`。

### G4 · Document Switcher
Masthead 上的按钮 + Popover：搜索框、文件列表（名称 / 类型 / 段数 / 4px 进度条 / 问题数）。
当前文件左缘 Active Axis。`Ctrl+Tab` / `Ctrl+Shift+Tab` 在文件间循环。

### G5 · Provenance Strip（来源条）
标注一条数据的来源与可信度。3px 左缘色 + `--t-micro` 文本。
`--machine` = MT/LLM 生成；`--ok` = 人工确认；`--text-2` = 导入；`--warn` = 插件产出未审。
**AI 产出必须带此条**（PRD 原则 2：AI 产出标注来源）。

### G6 · Grounding Inspector（接地检查器）
可展开面板，列出**实际注入**到提示中的内容：术语 n 条、TM 例句 n 条、风格指令、文档上下文。
每项可点开看原文。**没有它就不许在 UI 里出现"接地"字样**（PRD F-03）。

### G7 · Permission Sheet（插件权限表）
表格：能力 / 范围 / 状态（已授权 / 未请求 / 已拒绝 / 未知）/ 动作（授权 / 撤销）。
"未知"状态必须显式呈现并说明"OS 层无法强制"（design-notes §3 的诚实声明）。

### G8 · Waiver Control（忽略需理由）
QA 忽略、导出门禁覆盖等场景。结构：`原因输入（必填，≥8 字）+ 操作人 + [记录并忽略]`。
记录持久化且在 QA 复核页可复查/撤销。**没有原因输入的"忽略"按钮一律违规**（PRD H-07）。

---

## H. 组件清单与去向映射

| 现有实现 | 新组件 | 处置 |
| --- | --- | --- |
| `surface-dialog-backdrop` + 圆角卡 | A5 Dialog | 重写几何，多数场景改 A6 Drawer |
| `segmented-control` | C8 | 保留概念，重做几何 |
| `project-card` | 见 `screens/project.md §1.3` | 重做 |
| `icon-button` | B2 | 保留，统一尺寸与命中区 |
| `surface-kicker` | `--t-micro` 工具类 | 保留 |
| `translunar-band`（5×span） | `03-signatures.md §1` Band Spine | **重定位为脊柱** |
| `wizard-check` | C6 | 重做 |
| `tm-entry` 卡 | D1 表格行 / G2 | 卡改行 |
| `spin`（LoaderCircle） | D3 / D5 | **删除圆形 spinner** |
| Suggestions 四标签 | `screens/workbench.md §4` | **改为常驻双区 + 抽屉** |
| 工具条 8 组 | `screens/workbench.md §2` | **降到 3 组** |
| `shell-settings-fab` 浮动齿轮 | E1 Index Spine 工具区 | **删除浮动 FAB** |
| `…` overflow 导航 | E1 + §3 命令面板 | **删除隐藏导航** |

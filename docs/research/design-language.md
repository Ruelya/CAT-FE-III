# 设计语言研究：生产力优先、数据密集的桌面 CAT 工作台

> 分支：`cursor/gf-research-design-2398`（基于 `cursor/gf-copy-audit-2398`）
> 性质：研究 + 设计规范，不含实现。
> 参照物：任务附带的 Trados 风格 mockup（密度与布局参考，非像素级复刻目标）、
> memoQ / Crowdin 官方文档截图、VS Code 工作台架构图。
> 截图与来源清单已存档：`/opt/cursor/artifacts/research-design/`（见其中 `REFERENCES.md`）。

本规范针对现有代码：`apps/desktop/src/renderer/`（`app.css`、各组件）与
`packages/ui/src/`（`tokens.css`、`components.css`、`components.tsx`）。
每条判断都对应到真实文件、真实类名。

---

## 1. 为什么 mockup 看起来专业，而当前前端看起来廉价

### 1.1 专业感的来源（mockup / memoQ / VS Code 的共性）

1. **一整块连续表面，用发丝线切开，而不是浮起来的卡片。**
   mockup 里 explorer、grid、TM rail、状态栏共用同一底色族，边界只有 1px 分隔线。
   memoQ 编辑器（`memoq-translation-editor.png`）同理。视线扫过时没有投影、没有圆角
   卡片打断，信息本身就是界面。
2. **每一像素都在报数。** mockup 左栏每个文件带右对齐百分比；状态栏是
   `Segments: 1,248 · Translated: 849 (68%) · Remaining: 399 (32%) · Words: 18,732`；
   memoQ 状态栏是 `Proj(lat) 3% | Doc 3% | TR 7 | R1 0 | … | Ins | Pos 1 | Length 96+0/62+0`。
   专业工具的密度来自"真实读数密度"，不是装饰密度。
3. **状态用字形 + 数字，颜色只是第二通道。** mockup 的状态列是 `100%` 分值 +
   `TM` 来源缩写的组合芯片；Trados 官方文档明确状态列是图标（铅笔、对勾、锁）+
   匹配百分比，悬停出 origin/score 详情。任何一个色盲用户都能只靠字形读懂。
4. **键盘是一等公民。** Trados/memoQ 的核心循环是 `Ctrl+Enter` 确认并跳到下一个
   未确认句段；Crowdin 编辑器自带命令面板（`crowdin-command-palette.png`）；
   VS Code 的整个 chrome 围绕 `Ctrl+Shift+P` 组织。专业感 = 手不离键盘也能走完全流程。
5. **几何稳定。** 选中 mockup 第 6 行，行高不变，只是描了一圈 1px 蓝框、光标进入
   单元格。编辑是"进入这一行"，不是"这一行变成另一个控件"。
6. **一套图标语法。** mockup 工具条的图标来自同一家族：统一光学尺寸、统一描边、
   下方统一 10px 标签。

### 1.2 当前实现的廉价点（文件 + 类名 + 问题）

先说公道话：`packages/ui/src/tokens.css` 的 INSTRUMENT 令牌层方向是对的（冷灰 +
单一深蓝、2/4px 圆角、发丝边框、focus ring、`prefers-reduced-motion` 总开关）。
廉价感主要来自组件层没有兑现令牌层的承诺：

| # | 文件 / 类名 | 问题 |
|---|---|---|
| 1 | `packages/ui/src/tokens.css` `--tl-font-ui` | 声明 `"Inter"` 打头，但全仓库没有任何 `@font-face` / 字体打包（已 grep 验证）。这是一个虚构的字体栈：Windows 实际落在 Segoe UI，界面呈现从未被设计过。 |
| 2 | `apps/desktop/src/renderer/components/Ribbon.tsx` `ICONS` 常量、`WorkbenchView.tsx` 内联齿轮 SVG | 手绘 SVG 图标路径，共约 11 枚，24×24 stroke 1.8；齿轮却是 15px 另一套参数。没有图标系统，光学尺寸不一致，且大量命令（上一个/下一个/替换/全部替换）完全没有图标，退化成纯文字幽灵按钮。 |
| 3 | `apps/desktop/src/renderer/app.css` `.doc-tabs__tab` / `.view-tabs__tab` / `.dock-tabs button` / `.preview__tabs button` | 一个应用四套标签页语法：凸起页签（上缘 2px 嵌线）、上边框高亮、下边框高亮、描边药丸按钮。没有统一的 tab 文法，是"拼出来的"而不是"设计出来的"。 |
| 4 | `app.css` `.workbench { grid-template-columns: 260px minmax(0,1fr) 336px }` | 三栏写死，无 splitter、无折叠、无布局记忆。336px 的右栏里塞了 6 个 `flex:1` 的 dock 标签（`.dock-tabs button`），每个约 56px，中文标签互相挤压。 |
| 5 | `app.css` `.grid-toolbar { flex-wrap: wrap }` + `WorkbenchView.tsx` 查找/替换区 | 查找、替换、全部替换、含已确认……全部常驻工具条，窄窗口时整条换行。偶发任务占用永久 chrome；换行的工具条是典型网页表单气质。VS Code 的做法是可召唤的 find widget。 |
| 6 | `SegmentGrid.tsx` `STATE_LABEL` + `app.css` `.segment-grid__state-stack`、`.tl-badge` | 状态列是纵向堆叠的宽文字徽章（已确认 / 草稿 / QA / 匹配徽章），一行最多叠三枚，行高随之抖动。mockup 用一枚紧凑芯片（分值 + 来源字形）解决同样的信息。 |
| 7 | `app.css` `.segment-grid__target-editor textarea { min-height: 48px }` + `animation: tl-slide-up` | 选中句段时单元格被替换成 textarea：行高跳变 + 重放入场动画。核心循环（每选一行）都伴随一次布局位移和一次装饰动效。 |
| 8 | `app.css` `.segment-grid tbody tr:hover` 与 `tr[data-active="true"]` | 悬停色和选中色是同一个 `--tl-color-accent-faint`，选中态失去意义；所有行 `cursor: pointer`，编辑表格呈现成"链接列表"。 |
| 9 | `App.tsx` `key={statusMessage}` + `app.css` `.app-statusbar__message { animation: tl-slide-up }`；`.dock-view`、`.match-card`、`.issue-card`、`.agent-step`、`.dock-tabs__chip`、`.tl-empty` 各挂 `tl-slide-up`/`tl-fade-in` | 两个样式文件共 14 处 animation 挂点，状态栏每条消息、每次切 dock、每张卡片挂载都在播动画。动效无处不在 = 动效没有意义。 |
| 10 | `app.css` `.projects-view { max-width: 1100px; margin: 0 auto }` + `.tl-panel`（阴影卡片） | 启动界面是"居中 1100px 的两张阴影卡片 + 表单"，SaaS 落地页气质。桌面工具的起点应是全出血列表 + 工具行（参照 Trados Projects 视图 / VS Code Welcome）。 |
| 11 | `app.css` `.app-statusbar { font-family: var(--tl-font-mono) }` | 整个状态栏（含中文消息文本）走 mono 栈。中文没有等宽字形，实际渲染是"假 mono"，混排观感破碎。mono 应只作用于数字读数（已有 `.tl-num` 却没用在刀刃上）。 |
| 12 | `SegmentGrid.tsx` 渲染 `—` 占位、`App.tsx` `"—"` 与 `` `— ${lastError}` `` | em-dash 作为可见字形（skill 明令禁止）。空目标应该就是空，或用中性字形（如 `·`），错误拼接用冒号。 |
| 13 | `packages/ui/src/components.css` `.tl-panel`（默认卡片：边框+圆角+阴影）与 `app.css` `.dock-view > .tl-panel { border:none; border-radius:0; box-shadow:none }` | 组件默认形态是错的（浮卡），应用层再用覆盖把它拍平。默认值与使用场景相反，说明组件语义没想清楚。 |
| 14 | `packages/ui/src/components.tsx` `Kbd` 组件 | 已 grep 验证零使用。键盘提示组件是死代码，而整个 chrome（ribbon tooltip 之外）没有任何快捷键可见性；`SegmentGrid` 的行不可聚焦（无 `tabIndex`、无上下键导航），鼠标是唯一入口。 |
| 15 | `components.css` `.tl-dialog__title`（11px 全大写 + 0.06em 字距） | 全大写字距微标题用在面板小节是 VS Code 惯例，用在对话框主标题上层级过低。对话框标题应为 13-15px 句式半粗体。 |
| 16 | `components.css` `.honest-note`（三色左边条）+ `.ai-draft`、`.agent-gate`（蓝色填充框） | 彩色警示框族在 dock 里层层堆叠，web alert 气质。参照 Crowdin 的 QA inline banner（`crowdin-qa-inline.png`）：一条紧凑的字形+文本行，贴在目标单元格下方，不是一摞填色盒子。 |
| 17 | `app.css` `.ribbon { overflow-x: auto }` | 工具条溢出策略是"横向滚动"。专业桌面工具的溢出策略是收纳（More 菜单 / chevron），滚动的工具条是移动端网页手法。 |
| 18 | `tokens.css` 整体 | 只有一套浅色主题，没有 `data-theme` 挂点；没有密度令牌（行高、控件高度、图标尺寸），密度散落在各组件的 magic number 里。 |

一句话诊断：**令牌层是仪器，组件层是网页。** mockup 的专业感不需要新颜色、
新阴影，需要的是把 18 条组件层的"网页习惯"逐条换成"仪器习惯"。

---

## 2. 令牌系统（Token System）

原则：全部挂在 `:root` 语义令牌上；组件禁止直接引用灰阶原始值（`--tl-gray-*`
只允许 `tokens.css` 内部映射使用）。禁止紫色辉光、禁止 hero 渐变、禁止玻璃拟态。

### 2.1 表面（surfaces）

保留现有五级表面模型，明确各级职责，并补一级"编辑器纸面"：

| 令牌 | 现值（保留） | 职责 |
|---|---|---|
| `--tl-color-bg` | `#eef0f4` | 窗口底、页签条底 |
| `--tl-color-surface` | `#f7f8fa` | 侧栏、工具条、状态栏、面板 |
| `--tl-color-surface-raised` | `#ffffff` | 编辑器纸面（grid、输入控件、对话框） |
| `--tl-color-sunken` | `#e2e5eb` | 面板头、页签槽、meter 轨道 |
| 新增 `--tl-color-surface-active` | ≈ `#f1f4fa`（accent-faint 的中性化） | 选中行/项的底色，与 hover 分离（见 2.3） |

阴影只保留三档且只用于真正浮起的层：`--tl-shadow-raised`（primary 按钮）、
`--tl-shadow-pop`（菜单/浮层）、`--tl-shadow-overlay`(对话框)。侧栏、面板、
卡片一律零阴影。

暗色主题：MVP 不做，但令牌命名现在就按主题无关写（已达标），后续加
`[data-theme="dark"]` 只换值不换名。

### 2.2 边框

| 令牌 | 值 | 用途 |
|---|---|---|
| `--tl-color-border` | `#cdd2da`（现值） | 结构发丝线：分栏、行分隔、面板头 |
| `--tl-color-border-strong` | `#aab1bd`(现值) | 控件描边：输入框、下拉、表头底线 |
| 新增 `--tl-border-hairline` | `1px solid var(--tl-color-border)` | 复合令牌，杜绝散写 |

规则：**结构边界只用发丝线，永远单边。** 行与行之间只有 `border-bottom`；
禁止给列表行同时上 `border-top` + `border-bottom`。分栏边界是 splitter 的
可视化本体（见 §3）。

### 2.3 焦点与选中

现有 `--tl-focus-ring`（2px 软圈 + 1px 实圈）保留，作为**键盘焦点**唯一样式。
需要新增并区分三个正交状态：

| 状态 | 样式 | 备注 |
|---|---|---|
| hover | `background: var(--tl-color-sunken)` | 中性灰，不再借用 accent-faint |
| selected（选中行/项） | `background: var(--tl-color-surface-active)` + 左侧 2px accent spine | 现有 spine 手法保留 |
| focused（键盘焦点） | `--tl-focus-ring` | 只随 `:focus-visible` 出现 |
| editing（正在编辑的句段） | 1px `--tl-color-accent` 全周描边，行内 caret | 行高不变，参照 mockup 第 6 行 |

### 2.4 状态字形（永不只靠颜色）

为句段状态、QA、匹配来源定义"字形 + 颜色"成对令牌。字形是信息主体，
颜色是冗余通道：

| 状态 | 字形（glyph） | 颜色令牌 | 示例呈现 |
|---|---|---|---|
| 未译 | `○`（空圈图标） | `--tl-color-text-faint` | `○` |
| 草稿 | 铅笔图标 | `--tl-color-accent` | `✎ 84%` |
| 已确认 | 对勾图标 | `--tl-status-ok` | `✓` |
| QA 未解决 | 三角叹号图标 | `--tl-status-danger` | `⚠ 2` |
| TM 精确匹配 | `100` 分值 + `TM` 缩写 | `--tl-status-ok` | `100 TM` |
| TM 模糊匹配 | 分值 + `TM` | `--tl-color-accent` | `85 TM` |
| 机器翻译 | 分值 + `MT` | `--tl-status-warn` | `62 MT` |
| AI 草稿 | 分值/无 + `AI` | `--tl-color-accent` | `AI` |

实现要求：图标来自同一图标库（推荐 `@tabler/icons-react`，2400+ 枚、
stroke 可全局定为 1.75、含 CAT 场景需要的全部字形；备选 `@phosphor-icons/react`）。
删除 `Ribbon.tsx` 的手绘 `ICONS` 与 `WorkbenchView.tsx` 的内联齿轮。
现有 `MatchBadge`（`components.tsx`）升级为"分值 + 来源缩写"双段芯片。

### 2.5 字体

| 层 | 推荐 | 理由 |
|---|---|---|
| UI 文本 | 打包 **IBM Plex Sans**（Latin，400/500/600），CJK 回落 `"PingFang SC", "Microsoft YaHei", "Noto Sans SC"` | 与已声明的 IBM Plex Mono 同族，仪器气质；CJK 用系统原生渲染最锐利，不打包 10MB 中文字体。删除虚构的 Inter 声明。 |
| 数字/代码/读数 | 打包 **IBM Plex Mono**（400/500） | 现在 tokens 里排第一却从未真正加载；状态栏读数、句段序号、分值、locale 代码全部走它 + `font-variant-numeric: tabular-nums`（现有 `.tl-num` 保留并强制使用）。 |
| 字号阶梯 | 保留现有 11/12/13/15/18 | 网格正文 13px / 行高 1.5（CJK 下限）；chrome 标签 11-12px。 |

规则：mono 只用于数字与代码类读数。撤销 `.app-statusbar` 的整体 mono
（中文消息回 UI 栈）。全大写 + 字距微标题仅限侧栏小节头与表头，
对话框标题改 13px 句式 600。

### 2.6 密度

新增密度令牌，替代散落的 magic number：

```css
--tl-row-h-grid: 32px;      /* 句段行最小高度（单行文本时） */
--tl-row-h-list: 24px;      /* 侧栏树行 */
--tl-ctl-h-sm: 22px;        /* 工具条内控件 */
--tl-ctl-h-md: 28px;        /* 表单控件（现 ribbon search 已是 28px） */
--tl-icon-sm: 14px;
--tl-icon-md: 16px;
--tl-ribbon-h: 56px;        /* 现值保留 */
--tl-statusbar-h: 24px;     /* 现 30px 偏高，压到 24px（VS Code 22px） */
--tl-tab-h: 30px;
```

间距沿用现有 `--tl-space-1..6`（2/4/8/12/16/24）。方向：比现状再紧一档，
向 memoQ 的行密度靠拢；留白是仪器的敌人，对齐才是仪器的呼吸感。

---

## 3. 布局规则

### 3.1 骨架（MVP）

沿用 mockup / VS Code 的五区骨架，全部平面、发丝线分隔：

```
┌──────────────────────────────────────────────┐
│ 原生菜单（Electron，保留）                        │
│ Ribbon 工具条（56px，可折叠为 32px 图标行·后期）    │
├────────┬───────────────────────────┬─────────┤
│ 项目    │ 文档页签条                   │ 资源    │
│ 资源管理 │ 双语网格（唯一滚动主体）        │ 右栏    │
│ (侧栏)  │ 视图页签（文本/预览）           │ (dock)  │
├────────┴───────────────────────────┴─────────┤
│ 状态栏（24px，全宽读数条）                        │
└──────────────────────────────────────────────┘
```

### 3.2 Splitter 与折叠

| 能力 | MVP | 后期 |
|---|---|---|
| 左右栏拖拽调宽（4px 命中区、hover 变 accent、双击复位） | ✅ | |
| 左右栏可折叠（快捷键 + 分隔线上的 chevron；折叠记忆宽度） | ✅ | |
| 布局持久化（每项目记住两栏宽度与折叠态） | ✅ | |
| 底部第三栏（预览/评论横向面板，参照 memoQ View pane） | | ✅ |
| 面板拖出重排 / 浮动窗口（Trados 全家桶能力） | | ✅（大概率永不做，成本收益差） |
| Ribbon 折叠为单行图标模式 | | ✅ |

约束：
- 中央网格是唯一 `flex:1` 主体，最小宽度 480px；两侧栏各有 min/max
  （左 180-400px，右 240-480px）。
- 右栏 dock 标签从 6 个压到 3 组（见 §4.8），标签超宽时收纳为图标 + tooltip，
  禁止 `flex:1` 均分挤压。
- **不做假 chrome**：没有云同步指示器、没有头像、没有通知铃铛、没有协作者
  在线点。单机工具的 chrome 只报本机事实（引擎状态、文档读数、QA 计数）。
  mockup 里的 `04_Deliverables` 云图标、评论者头像属于其网络版语境，明确不抄。

### 3.3 网格几何

- 列结构向 mockup 收敛：`# | 源文 | 译文 | 状态`（现有结构保留），
  状态列 96px → 72px（芯片化后足够）。
- 行内编辑不改变行盒：选中行进入编辑态时，目标单元格内容区变为
  `contenteditable`/无边框 textarea，靠行级 1px accent 描边表达编辑态，
  高度只随内容自然增长（与非编辑态同一套 line-height）。
- 表头常驻（现有 sticky 保留），列宽后期支持拖拽。

---

## 4. 组件清单（Component Inventory)

每项标注：现状 → 目标。

### 4.1 Ribbon 工具条
现状：`Ribbon.tsx` 手绘图标 + `overflow-x:auto`。
目标：图标库统一字形（16-18px、stroke 1.75）；组间发丝分隔（现有
`.ribbon__divider` 保留）；空间不足时收纳进尾部 More 菜单，禁止滚动；
每个按钮 tooltip 恒带快捷键（现状已做，保留）；`disabled` 语义保留。

### 4.2 命令面板（新建，MVP 高优先）
`Ctrl+Shift+P` / `Ctrl+K`。单输入框 + 结果列表，复用对话框表面令牌
（overlay 阴影允许）。收录全部菜单命令 + dock 切换 + 文档切换，右侧列快捷键
（终于让 `Kbd` 组件上岗）。参照 `vscode-command-palette.png` 与
`crowdin-command-palette.png`：无图形装饰，行高 28px，匹配字符高亮。

### 4.3 双语网格（SegmentGrid）
现状：文字徽章堆叠、行高跳变、鼠标唯一入口。
目标：
- 状态列 = 单枚组合芯片（§2.4 字形表），QA 以角标计数叠加，不再纵向堆徽章。
- 行可聚焦：roving `tabIndex`，`↑/↓` 移动选区，`Enter` 进入编辑，
  `Ctrl+Enter` 确认并前进（引擎语义已有，补键盘入口），`Esc` 退出编辑。
- hover 中性灰、selected 中性蓝底 + spine、editing 描边（§2.3）。
- 虚拟滚动保留（现有实现质量不错，无需重写）。
- 空目标占位：空单元格，不渲染 `—`。

### 4.4 标签芯片（tag chips，新建）
行内标签（`<b>`、`{1}`、占位符）渲染为 mono 字形芯片：
`--tl-color-sunken` 底、1px 边、2px 圆角、11px mono，成对标签同色系。
QA 标签校验错误时芯片描边转 `--tl-status-danger`。这是 CAT 编辑器的
核心可信度部件（memoQ 文档 F9 插 tag 流程），MVP 至少要"正确显示"，
编辑插入可后期。

### 4.5 TM 命中行（match-card 重构）
现状：`components.css` `.match-card` 卡片 + 「应用为草稿」文字按钮 + 挂载动画。
目标：参照 mockup 右栏与 `memoq-translation-results.png`：
- 顶部固定"最佳匹配"块：整句译文 + 组合芯片，绿色（精确）/蓝色（模糊）左 spine。
- 其余命中为紧凑行：左列分值芯片，右列源/译两行文本，行分隔发丝线，
  无卡片边框、无阴影、无入场动画。
- 双击或 `Ctrl+数字` 应用；应用动作不再需要每行一个按钮（保留右键/悬停浮现）。
- 源文差异高亮（fuzzy diff）后期补。

### 4.6 状态栏
现状：30px、整体 mono、消息重放动画。
目标：24px 仪器读数条。左侧消息（UI 字体，无动画，静默替换）；右侧读数组：
`句段 6/1248 · 已确认 849 · 草稿 12 · QA 3 · ▓▓▓░ 68% · 引擎 ●`，
数字全部 `.tl-num`。每个读数可点击（跳转筛选/面板)后期。
进度条保留现有双段 `SegmentProgress`（确认+草稿）设计，这是现状里的亮点。

### 4.7 筛选芯片（filter chips，新建）
现状：筛选状态藏在下拉框 + ribbon 角落的 `{n}/{total}` 计数。
目标：激活任一筛选（状态、文本、QA）后，网格工具条左端出现可删除芯片：
`草稿 ×` `"安装" ×`，芯片底 `--tl-color-accent-soft`。计数读数
`142/1248` 常驻工具条右端。清除全部 = 逐芯片删除或 `Esc`。

### 4.8 右栏 dock
现状：6 个均分文字标签（TM/术语/一致性/QA/AI/Agent）。
目标：MVP 收敛为 3 组标签：**记忆库**（TM + 一致性合并，一致性以搜索框形态
内嵌）、**术语**、**检查**（QA + AI 审校合并）；Agent 面板挂到检查组尾部或
独立可折叠区。标签 = 图标 + 文字，宽度自适应，计数角标保留
（`.dock-tabs__chip` 去掉动画）。

### 4.9 对话框 / 空态 / 警示
- 对话框标题改句式 13px 600（§2.5）；入场动画保留一处 `tl-rise-in`（§5）。
- 空态：居中大空态只允许出现在"中央无文档"一处；dock 面板空态一律左上角
  一行 12px `--tl-color-text-faint` 文本，不再加动画（现 `.tl-empty` 降级使用）。
- 警示：`.honest-note` 三色系保留为唯一 inline banner 形态，但收紧为
  字形 + 单行文本（参照 `crowdin-qa-inline.png`）；`.ai-draft`、`.agent-gate`
  的蓝色填充盒改为同一 banner 文法（左 spine，不填色）。

---

## 5. 动效：只做功能性动效

现状 14 处 animation 挂点，全部重审。唯一判据：**动效必须回答"什么变了"**。

| 保留 | 理由 |
|---|---|
| 对话框/浮层入场 `tl-rise-in`（170-220ms） | 层级出现，空间因果 |
| 引擎忙碌点 `tl-pulse` | 实时活性信号，busy 结束即停 |
| splitter hover 变色（120ms） | 可拖拽 affordance |
| 进度条宽度过渡（220ms） | 数值连续性 |
| 焦点/hover 颜色过渡（120ms） | 输入反馈 |

| 删除 | 位置 |
|---|---|
| 状态栏消息 slide-up | `app.css` `.app-statusbar__message` + `App.tsx` `key={statusMessage}` |
| dock 切换整面板 slide-up | `.dock-view` |
| 卡片挂载 slide-up / fade-in | `.match-card`、`.issue-card`、`.agent-step`、`.dock-tabs__chip`、`.segment-grid__match` |
| 编辑器展开 slide-up | `.segment-grid__target-editor` |
| 空态 fade-in | `.tl-empty` |
| 预览页签 fade-in | `.preview__pane`（保留与否随预览重构，倾向删） |

`prefers-reduced-motion` 总开关（`components.css` 末尾）保留。
新动效预算：任何新增动画必须能在 PR 描述里用一句话说明它表达了哪个状态迁移，
说不出就不加。时长只允许 `--tl-motion-fast/base/slow` 三档，无弹跳。

---

## 6. Copy-free chrome（无文案化的界面骨架）

copy 审计分支已删掉说明性文案，本节把"删完之后靠什么"定成规则：

1. **控件自述**：标签只写名词/动词本身（`导入`、`确认`、`QA`），
   禁止副标题、禁止解释句、禁止「不是……而是……」句式的任何变体。
2. **快捷键即文档**：每个命令的 tooltip = `命令名（快捷键）`（现状已做，保持）；
   命令面板是全部命令的可搜索目录，取代一切"引导文案"。
3. **读数即状态**：能用数字说的不用句子说。`142/1248` 优于「已筛选出 142 个
   句段」；状态栏消息仅保留操作结果时态（`已导出 → path`），不写过程叙述。
4. **空态零句号**：空态最多一个名词短语（`无匹配`、`暂无文档`），
   不加操作建议；操作入口本来就在 chrome 上。
5. **字形优先**：状态、来源、风险一律走 §2.4 字形表；文字徽章（已确认/草稿）
   在网格状态列中被字形芯片替换，全文标签只保留在筛选下拉等纯文本语境。
6. **错误信息 = 事实 + 位置**：`句段 #12 草稿未写入（超时）`，
   不解释机制、不安抚。

---

## 7. Do-not-ship：廉价模式清单

以下模式一经出现即打回（含现存代码的清退项）：

1. **紫色辉光、彩虹/hero 渐变、玻璃拟态**（backdrop blur 卡片）。
2. **浮动阴影卡片当作面板**：侧栏、dock、网格容器零阴影零圆角浮层
   （清退 `.tl-panel` 默认卡片形态）。
3. **手绘 SVG 图标路径**（清退 `Ribbon.tsx` `ICONS`、`WorkbenchView.tsx` 齿轮）。
4. **假 chrome**：云同步图标、头像、通知铃铛、在线协作点、
   fake 版本号/构建号装饰。
5. **em-dash `—` 作为任何可见字形**（清退 SegmentGrid/App 占位与拼接）。
6. **会换行/会滚动的工具条**（清退 `.grid-toolbar` `flex-wrap`、
   `.ribbon` `overflow-x:auto`）。
7. **装饰动效**：挂载入场、内容 key 重放、切页齐闪（§5 删除清单）。
8. **一个界面多套 tab 文法**（四套收敛为两套：页签条 + 下划线标签）。
9. **hover 与 selected 同色**、全表格 `cursor:pointer`。
10. **纯颜色状态**：任何只有色点/色底而无字形或数字的状态呈现
   （`.tl-status-dot` 必须与文字读数相邻出现，现状 App.tsx 已达标，保持）。
11. **居中卡片式"欢迎页"布局**（清退 `.projects-view` 居中 1100px 形态）。
12. **中文文本走 mono 栈**（清退 `.app-statusbar` 整体 mono）。
13. **声明而不加载的字体**（清退虚构 Inter；要么打包要么从栈里删除）。
14. **堆叠文字徽章表达状态**（清退 `.segment-grid__state-stack` 纵向堆叠）。
15. **说明性 UI 文案回流**：副标题、引导语、业务规则小作文、
   「不是」句式（copy 审计成果视为回归红线，e2e 已有断言）。
16. **无键盘等价物的鼠标交互**：新组件 PR 必须列出键盘路径，
   否则不合并（网格行导航为第一还债项）。

---

## 附：MVP 执行顺序建议（供后续任务拆分，非本任务范围）

1. 字体落地（打包 Plex Sans/Mono、删 Inter 幻影）+ 图标库替换。全局观感在
   一个 PR 内质变。
2. 网格芯片化 + 行内编辑几何稳定 + 键盘导航。核心循环体验质变。
3. 动效清退（纯删除，低风险）。
4. splitter + 折叠 + 布局持久化。
5. 命令面板 + 筛选芯片。
6. dock 收敛（6→3）与 TM 命中行重构。
7. ProjectsView 全出血重排、状态栏 24px 化。

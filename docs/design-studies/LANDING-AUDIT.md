# 落地审计：Opus 原型 → Electron/React 工作台

审计对象：`cursor/gf-themes-2398` 分支之上的 `apps/desktop`（审计分支 `cursor/gf-landing-audit-2398`）。
对照物：`docs/design-studies/FEATURE-INVENTORY.md`（原型契约）、`docs/design-studies/src/{app.js,data.js}`（Opus HTML 原型的实际 IA）、`docs/design-studies/README-opus.md`。

审计方法：逐条读实现代码（非跑分、非截图猜测），每条结论都给 `文件:行号`；文件树部分另用真实引擎 + Playwright/xvfb 驱动真实应用拍照验证。**审计过程中发现并当场修复了两处文件树真实缺陷**（见 §2.3），除此之外没有实现任何新功能。

---

## 0. 结论摘要

| 问题 | 结论 |
| --- | --- |
| 原型 Workbench 功能是否全部落地？ | **绝大多数已落地**：清单 59 项中 **HAVE 50 / PARTIAL 6 / MISSING 3**。缺口集中在「入口晋升」（ribbon 动词、菜单 IA）与三个外观级差距，没有任何核心能力缺失。 |
| IDE 式左侧文件树是否正确落地？ | **正确**（修复后）。路径成树、折叠、字母序、进度/QA 汇总、搜索强制展开均为真实实现并有单测 + 真实引擎 e2e 验证。本次修复了搜索只匹配文件名且会把树压平的缺陷，并补上了有数据未绘制的文件夹 QA 徽章。余下差距为外观级：缩进参考线、按格式图标、「已打开标签」标记。 |

原型里**没有**评论 / 云同步 / 协作之类的剧场功能——`FEATURE-INVENTORY.md` 本身就是从已落地代码读出来的，原型唯一的演示机关是 8 个场景切换器（`data.js:672-681`），属于「原型专用，正确地未随产品发布」。

---

## 1. 文件树专项审计（判定：正确）

实现位置：`apps/desktop/src/renderer/lib/doc-tree.ts`（树构建）、`apps/desktop/src/renderer/views/WorkbenchView.tsx:1349-1400`（搜索/折叠状态）与 `2183-2311`（渲染）、`apps/desktop/src/renderer/app.css:919-1002`（样式）。

### 1.1 逐要素对照（原型契约：FEATURE-INVENTORY §4 表格）

| 要素 | 原型要求 | 实测 | 证据 |
| --- | --- | --- | --- |
| 路径成树 | 从导入目录折出文件夹；扁平导入保持扁平 | **HAVE**。共享前缀剥除后逐段建目录；单文档归根 | `doc-tree.ts:62-77,108-128`；单测 `doc-tree.test.ts`（keeps a flat import flat / derives folders） |
| 文件夹排序 | 文件夹在前，二者各自按字母序 | **HAVE**（zh-Hans-CN collator） | `doc-tree.ts:131-158` |
| 折叠 chevron | 点击切换，状态可持久 | **HAVE**。`aria-expanded` 如实上报，搜索时强制为开 | `WorkbenchView.tsx:2189-2206`、`app.css:948-954` |
| 缩进 | 每层缩进 | **HAVE**（`paddingLeft = 6+depth*12` / `depth*12`） | `WorkbenchView.tsx:2197,2246` |
| 缩进参考线 | 每个祖先层一条 hairline | **MISSING**（仅缩进，无参考线；外观级） | `app.css:919-1002` 无对应规则 |
| 文件图标 | docx / md / json 各自 glyph | **PARTIAL**：统一 `IconFileText` | `WorkbenchView.tsx:2255-2260` |
| 文件夹汇总 | 后代文件数 + 打开 QA 徽章 | **HAVE**（本次补上 QA 徽章，此前有数据未绘制） | `doc-tree.ts:165-182`、`WorkbenchView.tsx:2218-2234`、`app.css:966-975` |
| 文件徽章 | 确认 % 与双色进度线；QA 计数 | **HAVE**（进度条 + %，meta 行含 `QA n`） | `WorkbenchView.tsx:2263-2291` |
| 激活文件 | 行标记 + 强调 | **HAVE**：左侧 accent 边 + 底色（`data-active`） | `WorkbenchView.tsx:2244-2247`、`app.css:999-1002` |
| 激活 vs 已打开标签 | 树里区分「打开着标签」与「激活」 | **PARTIAL**：树只标激活；已打开标签由中央标签页表达 | `WorkbenchView.tsx:2244` |
| 移除 | 悬停 移除 → 确认移除/取消 两步 | **HAVE** | `WorkbenchView.tsx:2293-2311` |
| 搜索 | 匹配完整路径（`docs/guides/onboarding-guide.docx`）并强制展开所有文件夹 | **HAVE（本次修复）**：改为匹配树实际绘制的可见路径；命中时文件夹保留且强开 | `doc-tree.ts:184-201`、`WorkbenchView.tsx:1349-1363,1391-1400` |
| 展开/折叠全部 | —（原型无此钮） | 产品额外提供 | `WorkbenchView.tsx:2149-2166` |

### 1.2 真实应用验证（真实引擎 + xvfb）

用临时 Playwright spec 通过真实 `tl-engine` 导入嵌套语料（`docs/guides/{getting-started,advanced}.txt`、`docs/api.txt`、`legal/terms.txt`、`readme.txt`），全部断言通过后截图（spec 用后即删，不入库）：

- 树按 `docs ▸ guides ▸ …`、`legal ▸ …`、根文件 呈现，共享前缀（临时目录）被剥除；
- 折叠 `docs` 后其后代全部隐藏、chevron 上报 `aria-expanded=false`；
- 搜索 `guides` 强制展开刚折叠的 `docs`，两个 guide 文件回到屏上，`terms.txt` 隐去；
- 搜索被剥除的前缀段（`corpus`）如实答「无匹配文件」——树上没有它的行，搜索就不该命中；
- 清除搜索恢复读者的折叠状态。

### 1.3 本次修复的两处真实缺陷（同分支，带测试）

1. **搜索藏匹配 + 压平树**（`fix(explorer)` 提交）：原实现只按 `document.name` 子串过滤，输入树上明明画着的文件夹名（如 `guides`）会答「无匹配文件」；且过滤后按幸存文档重新测共享前缀，会把被搜索的文件夹从树上压平掉。修复：新增 `docTreeDisplayPaths`（匹配树实际绘制的可见路径），`buildDocTree` / `docTreeDirKeys` 增加 `prefixDocuments` 参数、始终以全量文档测前缀。新增单测 4 组 + `WorkbenchView` 集成测试 2 个。
2. **文件夹 QA 徽章有数据未绘制**：`rollup.openIssues` 一直在算（`doc-tree.ts:165-182`），但目录行没画。补上危险色徽章（与 dock 页签同款），带 title 与单测。

---

## 2. 功能落地清单（HAVE / PARTIAL / MISSING）

「原型 IA」指 `data.js` 的 MENUS/PALETTE/RIBBON 定义与 `app.js` 行为；「契约」指 FEATURE-INVENTORY 对应章节。判定原则：能力落地即 HAVE，能力在但原型指定的入口/形态未采纳为 PARTIAL，能力与入口都无为 MISSING。

### 2.1 应用菜单（契约 §1；原型 `data.js:486-595`）

| # | 项 | 判定 | 证据 |
| --- | --- | --- | --- |
| 1 | 文件：导入/导出/项目设置/返回列表/退出 | HAVE | `menu-template.ts:74-99` |
| 2 | 编辑：撤销/重做/剪切/复制/粘贴/全选（roles） | HAVE | `menu-template.ts:101-110` |
| 3 | 确认三连（Ctrl+Enter / Ctrl+Alt+Enter / Ctrl+Alt+Shift+Enter，renderer 持有） | HAVE | `menu-template.ts:112-140`、e2e `vertical.spec.ts:819-857` |
| 4 | 锁定/解锁句段（Ctrl+L，菜单持有） | HAVE | `menu-template.ts:141-147` |
| 5 | 视图：命令面板/预览/四面板/缩放/全屏 | HAVE | `menu-template.ts:149-207` |
| 6 | 导航：查找/替换/上一个/下一个/筛选/检索 | HAVE | `menu-template.ts:209-258` |
| 7 | 原型 7 菜单 IA（新增 项目/翻译/QA 顶层，导航并入编辑） | PARTIAL：20 个命令全部可达，但仍是 5 菜单结构（文件/编辑/视图/导航/帮助） | `menu-template.ts:74,101,149,210,260` vs `data.js:486-595` |
| 8 | 新建项目… 菜单入口 | PARTIAL：创建在项目列表工具条，无菜单项 | `ProjectsView.tsx`（创建工具条）vs `data.js:490` |
| 9 | 折叠左栏/折叠右栏 菜单命令 | PARTIAL：Splitter chevron 有 UI，无菜单命令 | `Splitter.tsx` vs `data.js:525-526` |
| 10 | 帮助：键盘快捷键… / 关于 | MISSING（帮助菜单仅 重新加载/开发者工具） | `menu-template.ts:260-266` vs `data.js:588-594` |

### 2.2 Ribbon（契约 §2；原型 `data.js:632-670`）

| # | 项 | 判定 | 证据 |
| --- | --- | --- | --- |
| 11 | 项目组：项目列表 / TM 管理 | HAVE | `Ribbon.tsx:110-134` |
| 12 | 文档组：导入 / 导出译文 | HAVE | `Ribbon.tsx:135-152` |
| 13 | 编辑组：确认 / 锁定（随选中翻转）/ 预翻译 | HAVE | `Ribbon.tsx:153-183` |
| 14 | 审校组：查找/替换/筛选/检索 + 搜索句段框 | HAVE | `Ribbon.tsx:184-260,408` |
| 15 | 溢出折叠进「更多」（ResizeObserver 实测，不滚动） | HAVE | `Ribbon.tsx:262-318,363` |
| 16 | 原型晋升动词：撤销/重做/查找下一个/插入记忆/插入术语/运行 QA/预览 | PARTIAL：命令全部存在（菜单 roles、F4、Ctrl+1…9、术语 插入、QA dock、Ctrl+P），只是未晋升上 ribbon | `data.js:636-668` vs `Ribbon.tsx:110-260` |

### 2.3 状态栏（契约 §3）

| # | 项 | 判定 | 证据 |
| --- | --- | --- | --- |
| 17 | 十项读数（句段/已确认/草稿/剩余/字数/QA/进度/行列/INS/引擎） | HAVE | `App.tsx:210-326` |
| 18 | 可点读数（草稿→筛选草稿、QA→筛选 QA） | HAVE | `App.tsx:233-243,263-275` |
| 19 | 主题入口（状态栏 主题 按钮 → 外观对话框） | HAVE（超出原型） | `App.tsx:313-330` |

### 2.4 左侧资源管理器（契约 §4）

| # | 项 | 判定 | 证据 |
| --- | --- | --- | --- |
| 20 | 项目节：名称/语言对/进度（仅当全部文档有真实计数） | HAVE | `WorkbenchView.tsx:2120-2141` |
| 21 | 文件树（嵌套/折叠/汇总/搜索强开） | HAVE（本次修复后；详见 §1） | §1 |
| 22 | 项目详情节 | HAVE | `WorkbenchView.tsx`（项目详情 region；e2e `vertical.spec.ts:176-178`） |
| 23 | 移除两步确认 | HAVE | `WorkbenchView.tsx:2293-2311` |
| 24 | 缩进参考线（每层 hairline） | MISSING（外观级） | `app.css:919-1002` |
| 25 | 按格式文件图标 | PARTIAL：单一 `IconFileText` | `WorkbenchView.tsx:2255-2260` |
| 26 | 激活 vs 已打开标签区分 | PARTIAL：树只标激活 | `WorkbenchView.tsx:2244-2247` |

### 2.5 中央区：标签页 / 工具条 / 筛选（契约 §5）

| # | 项 | 判定 | 证据 |
| --- | --- | --- | --- |
| 27 | 文档标签页（×只关标签、落到邻居） | HAVE | `WorkbenchView.tsx`（tabs strip）；e2e `vertical.spec.ts:171-175` |
| 28 | 网格工具条：状态 select + 可移除 chips + n/total 计数 | HAVE | `WorkbenchView.tsx`（grid-toolbar）；e2e `vertical.spec.ts:276-290` |
| 29 | 筛选通道：状态 + 自由文本 | HAVE | `lib/segment-filter.ts` |
| 30 | 原型筛选 chips：锁定 / 有术语 / 有标签 | MISSING（契约本身标注 proposed；数据引擎侧齐备——`Segment.locked`、`term.lookup`、占位符 token——但无筛选通道） | `app.js:165-173` vs `lib/segment-filter.ts` |
| 31 | 行内横幅：QA 门确认 / 覆盖确认 / 未确认写入警报 | HAVE | `WorkbenchView.tsx:2435-2452` |

### 2.6 查找/替换（契约 §6）

| # | 项 | 判定 | 证据 |
| --- | --- | --- | --- |
| 32 | FindWidget 全套（n 段计数、替换/全部替换、含已确认开关、回绕报告） | HAVE | `FindWidget.tsx`、`WorkbenchView.tsx:2529`；单测 `FindWidget.test.tsx` |

### 2.7 句段网格（契约 §7）

| # | 项 | 判定 | 证据 |
| --- | --- | --- | --- |
| 33 | TokenText 占位符 chips + QA 危险描边 | HAVE | `TokenText.tsx` |
| 34 | 状态 chip / ⚠n 叠加 / 锁定 glyph / origin chip（含 muted） | HAVE | `SegmentGrid.tsx`；e2e `vertical.spec.ts:681-711` |
| 35 | 行菜单 ⋯（复制源文/清空译文/锁定解锁，锁定时禁用写操作） | HAVE | `SegmentGrid.tsx`；e2e `vertical.spec.ts:772-781` |
| 36 | 虚拟化（>120 行开窗） | HAVE | `SegmentGrid.tsx`；e2e `vertical.spec.ts:548-580` |
| 37 | 编辑器：700ms 防抖自动存、IME 安全、Esc 退出冲草稿 | HAVE | `SegmentGrid.tsx` |

### 2.8 键位表（契约 §8）

| # | 项 | 判定 | 证据 |
| --- | --- | --- | --- |
| 38 | F3/F4/Shift+F4/Ctrl+F/H/Shift+F/K/Shift+P、Alt+↑↓、编辑器内 Ctrl+1…9 应用记忆、编辑器外 Ctrl+1…4 切 dock、Esc 兜底清筛选 | HAVE | `WorkbenchView.tsx`（keydown 处理）；e2e `vertical.spec.ts:294,871` |

### 2.9 右侧四组 dock（契约 §9）

| # | 项 | 判定 | 证据 |
| --- | --- | --- | --- |
| 39 | 记忆：TmPanel（匹配卡/应用为草稿/双击应用）+ 检索（文档命中 + TM 模糊检索） | HAVE | `WorkbenchView.tsx:2677-2690`、`TmPanel.tsx`、`ConcordancePanel.tsx` |
| 40 | 术语：命中列表（首选/禁用徽章、插入到光标）+ 快捷录入 | HAVE | `WorkbenchView.tsx:2692-2698`、`TermPanel.tsx` |
| 41 | QA：按规则分组、忽略/忽略同类/忽略本句/恢复/定位、引擎修复通道（修复为：… + 应用修复） | HAVE | `WorkbenchView.tsx:2700-2734`、`QaPanel.tsx`；e2e `vertical.spec.ts:1156-1201` |
| 42 | AI 辅助：11 家供应商配置、候选 + 字符差异 + 标签完整性检查、取消请求、已确认句段不给按钮 | HAVE | `WorkbenchView.tsx:2736-2740`、`AiPanel.tsx` |
| 43 | Agent：任务单/步骤流/汇总条/等待人工审核门（去工作台/去导出…，从不代导出） | HAVE | `WorkbenchView.tsx:2741-2745`、`AgentPanel.tsx` |

### 2.10 预览面板（契约 §10）

| # | 项 | 判定 | 证据 |
| --- | --- | --- | --- |
| 44 | 校对视图：回填分组、data-state/fallback、跟随激活行、点击跳回 | HAVE | `PreviewPane.tsx`、`WorkbenchView.tsx:2576`；e2e `vertical.spec.ts:308-317` |
| 45 | 版式视图（DOCX）：真实 export 管道 + docx-preview、tlseg- 锚点点击跳段、600ms 防抖 | HAVE | `PreviewPane.tsx`；e2e `vertical.spec.ts:319-341` |

### 2.11 命令面板（契约 §11）

| # | 项 | 判定 | 证据 |
| --- | --- | --- | --- |
| 46 | Ctrl+K / Ctrl+Shift+P、子串高亮、禁用行渲染不执行、打开文档：× n、外加主题/FX 命令 | HAVE | `CommandPalette.tsx`、`WorkbenchView.tsx:1938-2046,2755-2759` |

### 2.12 对话框与阻塞面（契约 §12）

| # | 项 | 判定 | 证据 |
| --- | --- | --- | --- |
| 47 | 项目列表/新建（全幅工作面、归档切换） | HAVE | `ProjectsView.tsx` |
| 48 | 导入文档（分段方式/SRX/默认回存） | HAVE | `ImportDocumentDialog.tsx`；e2e `vertical.spec.ts:585-634` |
| 49 | 项目设置（项目信息/导入默认/QA 门/生命周期/TM/术语库六节） | HAVE | `ProjectSettingsDialog.tsx` |
| 50 | TM 管理（挂载/可写切换/重命名/停用/条目分页编辑/级联删除） | HAVE | `TmManageDialog.tsx`；e2e `vertical.spec.ts:1088-1151` |
| 51 | 术语库管理（内联面板、译文级编辑删除） | HAVE | `TermManagePanel.tsx`；e2e `vertical.spec.ts:451-482` |
| 52 | 导出覆盖确认 | HAVE | `ExportOverwriteConfirm.tsx`；e2e `vertical.spec.ts:392-418` |
| 53 | 导出 QA 门（真实计数与规则 id、仍要导出/取消、与覆盖确认可组合） | HAVE | `ExportQaGateConfirm.tsx`；e2e `vertical.spec.ts:892-958` |
| 54 | 引擎闸门（starting/restarting/down 三态 + inert 工作台 + lastError 原文） | HAVE | `EngineGate.tsx`、e2e `engine-down.spec.ts` |

### 2.13 状态消息 / 持久化 / 主题（契约 §13-14 + 主题系统）

| # | 项 | 判定 | 证据 |
| --- | --- | --- | --- |
| 55 | §13 全部状态消息措辞（草稿/确认/批量/文件/TM 应用/查找/引擎恢复） | HAVE | `WorkbenchView.tsx` 各 onStatusMessage；e2e 断言多处 |
| 56 | 布局持久化（左右栏宽、折叠、预览高，双击重置） | HAVE | `Splitter.tsx` |
| 57 | 16 套主题（terra/紧凑/舒适/暗色/aurora/blueprint/酸性/温石/钴蓝/账表/孔版/atelier×2/phosphor×2/vitrine） | HAVE | `packages/ui/src/theme.ts:55-111` |
| 58 | FX 开关（扫描线/颗粒/环境光）、localStorage 持久化、重启保留 | HAVE | `lib/theme.tsx:41-64,137-145`；e2e `themes.spec.ts:145-186` |
| 59 | 原生窗框跟随主题 | HAVE | e2e `themes.spec.ts:164-172` |

**合计：HAVE 50 / PARTIAL 6 / MISSING 3（共 59 项）。**

---

## 3. 原型专用、正确地未发布

| 原型机关 | 位置 | 处置 |
| --- | --- | --- |
| 场景切换器（8 场景：空项目列表→导出 QA 门） | `data.js:672-681`、`app.js` 场景重置 | 演示机关，产品不需要；契约 §15 的 8 个场景在产品里全部由真实流程可达（e2e 逐一走到） |
| Fixture 数据（6 文档树、预置 issues/TM/terms） | `data.js` | 演示数据；产品由真实引擎供数 |
| 帮助→键盘快捷键…（原型实现为打开命令面板） | `app.js:618-620` | 原型糖；产品命令面板本身已列出全部快捷键 |
| 菜单中 cmd:null 的占位项（剪切/复制/粘贴等） | `data.js:506-509` | 产品用 Electron roles 真实实现，反而更完整 |

原型没有评论、云同步、协作、机翻记忆库市场等任何引擎不存在的功能——不存在「剧场功能误落地」的风险面。

---

## 4. 差距 Top 8（按影响排序）

1. **Ribbon 未晋升原型动词**（§2.2 #16，PARTIAL）：撤销/重做/查找下一个/插入记忆/插入术语/运行 QA/预览 都有命令，就差 ribbon 按钮。原型把它们排进 历史/翻译/审校 组（`data.js:632-670`）。
2. **筛选 chips 锁定/有术语/有标签**（§2.5 #30，MISSING）：原型七 chips（`app.js:165-173`），产品只有状态+文本两通道；引擎侧数据齐备，缺的是 `segment-filter.ts` 的三个通道与工具条 UI。
3. **菜单 IA 未采用 7 菜单结构**（§2.1 #7，PARTIAL）：项目/翻译/QA 顶层菜单未建，相应命令散在 ribbon/dock/设置里。命令无一缺失，纯入口分布差异。
4. **文件树缩进参考线**（§2.4 #24，MISSING）：原型每祖先层一条 hairline，产品只有缩进。外观级，`app.css` 一条 border 即可补。
5. **按格式文件图标**（§2.4 #25，PARTIAL）：docx/md/json 应各有 glyph，现统一 `IconFileText`。
6. **树中「已打开标签」标记**（§2.4 #26，PARTIAL）：原型区分 打开/激活 两态，产品树只标激活（打开态由中央标签页承担，信息不丢但树上不可见）。
7. **帮助菜单：键盘快捷键…/关于**（§2.1 #10，MISSING）：帮助菜单只有 重新加载/开发者工具。
8. **零散菜单入口**（§2.1 #8/#9，PARTIAL）：新建项目…、折叠左栏/折叠右栏 无菜单命令（功能本体都在）。

---

## 5. 验证记录

- 单元测试：`pnpm --filter @translunar/desktop test` → **26 文件 336 用例全过**（含本次新增的树搜索/QA 徽章用例）。
- 类型检查：`pnpm --filter @translunar/desktop typecheck` → 四个 tsconfig 全过。
- 端到端：`./scripts/linux-display.sh … playwright test` → **20 用例全过**（vertical / themes / theme-gallery / engine-down，真实 `tl-engine`）。
- 文件树实拍：临时 spec 经真实引擎导入嵌套语料，断言嵌套/折叠/搜索强开/前缀不可搜/状态恢复全部通过并截图（spec 不入库）。

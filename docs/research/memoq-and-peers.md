# 研究：memoQ 逆向拆解 + 同类 CAT 对比（Phrase / OmegaT / Wordfast / CafeTran / Déjà Vu）

| 项目 | 值 |
| --- | --- |
| 日期 | 2026-08-26 |
| 性质 | 证据型研究（仅官方文档 + 官方截图 + 少量社区佐证），不含实现 |
| 服务对象 | Translunar 工作台 PRD（本地优先、无伪服务器协作） |
| 截图存档 | Cloud Agent 运行工件目录 `/opt/cursor/artifacts/research-memoq/`（原始 URL 均在文中给出，可复现下载） |

写作规则：**每一条论断后附官方来源 URL**。memoQ 以 `docs.memoq.com/current`（memoQ 12.4 文档）为准；旧版本页（10.x/12.x）仅在当前版页面未覆盖细节时引用，并注明版本。术语一律引用官方英文名。

---

## 目录

1. [memoQ 编辑器信息架构（IA）](#1-memoq-编辑器信息架构ia)
2. [行状态：图标 + 颜色 + 百分比（非仅颜色）](#2-行状态图标--颜色--百分比非仅颜色)
3. [Translation results 面板：命中类型分色分编号](#3-translation-results-面板命中类型分色分编号)
4. [确认 / TM 写入 / 拆分合并 / 锁定 / 翻译与审校模式](#4-确认--tm-写入--拆分合并--锁定--翻译与审校模式)
5. [标签与占位符：一等公民 chips + 标签 QA](#5-标签与占位符一等公民-chips--标签-qa)
6. [QA 体系：warning/error 双级 + 可重映射严重度 + Resolve errors and warnings](#6-qa-体系warningerror-双级--可重映射严重度--resolve-errors-and-warnings)
7. [过滤与排序 vs 查找 vs 视图（Views）](#7-过滤与排序-vs-查找-vs-视图views)
8. [资源模型：TM / TB / LiveDocs / Muses / MT 在 UI 中的暴露方式](#8-资源模型tm--tb--livedocs--muses--mt-在-ui-中的暴露方式)
9. [子句级复用：fragment assembly / MatchPatch / LSC / predictive typing](#9-子句级复用fragment-assembly--matchpatch--lsc--predictive-typing)
10. [Web 端（webtrans / memoQ editor）的简化策略](#10-web-端webtrans--memoq-editor的简化策略)
11. [社区佐证：编辑器密度与状态图标](#11-社区佐证编辑器密度与状态图标)
12. [对比附录 A：Phrase（TMS CAT editor）](#12-对比附录-aphrasetms-cat-editor)
13. [对比附录 B：OmegaT](#13-对比附录-bomegat)
14. [对比附录 C：Wordfast Pro](#14-对比附录-cwordfast-pro)
15. [对比附录 D（简）：CafeTran Espresso 与 Déjà Vu X3](#15-对比附录-dcafetran-espresso-与-déjà-vu-x3)
16. [Translunar 借鉴 / 放弃清单（steal vs skip）](#16-translunar-借鉴--放弃清单steal-vs-skip)
17. [已读页面清单](#17-已读页面清单)

---

## 1. memoQ 编辑器信息架构（IA）

### 1.1 从项目到编辑器的路径

- 打开项目后进入 **Project home**，选 **Translations** 窗格，双击文档名即在**独立编辑器标签页**中打开翻译编辑器（每个文档/视图一个 tab）。来源：[Translation editor](https://docs.memoq.com/current/en/Workspace/translation-editor.html)。
- Translations 窗格有 **Documents** 与 **Views** 两个标签；视图（View）在 Views 标签下管理，与文档不混排。来源：[Project home – Translations (translator pro)](https://docs.memoq.com/12-2/en/Workspace/project-home-translations-tpro.html)、[Create view (filtering and sorting)](https://docs.memoq.com/current/en/Workspace/create-view-filtering-and-sorting.html)。
- Translations 列表中每个视图显示：Name、Comments 图标列（无评论浅蓝、有评论黄色）、`#`（段数）、Progress。来源：[Project home – Translations (translator pro)](https://docs.memoq.com/12-2/en/Workspace/project-home-translations-tpro.html)。

### 1.2 编辑器三大区块

官方结构：**Grid（网格）+ View pane（预览，默认底部）+ Translation results pane（翻译结果，默认右侧）**。来源：[Translation editor](https://docs.memoq.com/current/en/Workspace/translation-editor.html)。

- **Grid**：每段一行；左单元格源文，右单元格译文；结构化内容（表格/XML/数据库）中一段通常对应一个单元格或记录。来源：[Translation editor](https://docs.memoq.com/current/en/Workspace/translation-editor.html)、[The Grid](https://docs.memoq.com/current/en/Workspace/the-grid.html)。
- 官方对网格列的定义（Help Center）：“翻译网格每段一行、每行三列：第一列源段、第二列目标段、第三列显示该段翻译的**状态信息**”；活动单元格以**浅红色边框**高亮；Tab 在源/目标单元格间切换。来源：[Status column in the translation grid（memoQ Help Center）](https://support.memoq.com/hc/en-us/articles/6162041844369-Status-column-in-the-translation-grid)。
- 行号列可点击（点击首段行号、Shift+点击末段行号即可整段选择）。来源：[The Grid (10.3)](https://docs.memoq.com/10-3/en/Places/the-grid.html)。
- **View pane（预览）**：默认显示文档格式化预览；当前段以**红色边框**高亮；在预览中点击任意位置，Grid 会同步跳转；预览内可 Ctrl+F 查找。官方明确“预览只是相似而非相同”（memoQ 用多种外部技术把文档转成网页，不保证每种格式都有预览；XML 类预览显示结构而非排版）。官方列出的可预览格式：Word、Excel、PowerPoint、HTML、XML（含 XSLT）、多语 Excel、文本、WPML XLIFF。来源：[Translation editor](https://docs.memoq.com/current/en/Workspace/translation-editor.html)。
- **预览可拆屏**：拖拽 View pane 标题栏可将其脱离主窗口拖到第二块屏幕，再拖回可停靠。来源：[Translation editor](https://docs.memoq.com/current/en/Workspace/translation-editor.html)。
- **布局预设**：内置两种布局——`Default` 与 `Results on top`（官方原话：后者 “similar to Trados Studio”）；按 **F11** 切换；View 功能区 Layout 菜单可恢复 Default。来源：[Translation editor](https://docs.memoq.com/current/en/Workspace/translation-editor.html)。
- **活动行横排**：View 功能区 `Active Row → In the middle (horizontal)` 可让当前段以“源上译下”的横排卡片显示在 Grid 中部（其余仍是网格）。来源：[The Grid (10.3)](https://docs.memoq.com/10-3/en/Places/the-grid.html)。

### 1.3 状态栏（底部）

状态栏逐项显示：服务器连接状态、`Proj (语言)` 项目完成百分比（右键可切换按词/段/字符计）、`Doc` 文档完成百分比、`TR`（译员已确认段数）、`R1`、`R2`（审校 1/2 已确认）、`Ed`（已编辑未确认）、`Rej`（被驳回）、`Empty`（未动）、`Pre`（预翻译）、`Frag`（片段拼装填充）、`MT`（机翻填充）、`QA errors`、`Ins`（插入/改写模式）、`Pos`、`Length`（源/译字符数，标签长度以 `+` 号追加，如 `96 + 0 / 62 + 0`）。来源：[Translation editor](https://docs.memoq.com/current/en/Workspace/translation-editor.html)。官方主截图佐证：`https://docs.memoq.com/current/en/Images/t-z/translation-editor.png`（存档 `translation-editor.png`）。

### 1.4 其他编辑器内 tab

- **Resolve errors and warnings** 是一个独立的文档 tab（见 §6）。来源：[Resolve errors and warnings](https://docs.memoq.com/current/en/Workspace/resolve-errors-and-warnings-tab.html)。
- LiveDocs 的对齐编辑器（alignment editor）、单语文档编辑器也复用“编辑器 tab”模式。来源：[Alignment editor](https://docs.memoq.com/current/en/Workspace/alignment-editor.html)、[LiveDocs - Monolingual document (Library) editor](https://docs.memoq.com/current/en/Workspace/livedocs-monolingual-document-.html)。

**IA 结论**：memoQ 的编辑器 = “一个网格 + 两个可停靠辅助窗格 + 一组以 tab 形式追加的批处理工作台（QA、对齐）”。密度高但分区稳定，所有次级功能都挂在功能区（ribbon）而不是行内按钮。

---

## 2. 行状态：图标 + 颜色 + 百分比（非仅颜色）

### 2.1 状态盒（status box）构成

每行右端是 status box，同时承载：**匹配率百分比 + 状态颜色 + 状态图标 + 评论图标 + 警告/错误图标 + 自动传播图标**。来源：[The Grid](https://docs.memoq.com/current/en/Workspace/the-grid.html)。官方截图 `https://docs.memoq.com/current/en/Images/r-s/statuses.png`（存档 `statuses.png`）显示同一状态盒里叠加了百分比、勾/叉、闪电、气泡多个符号。

### 2.2 官方状态表（docs.memoq.com/current 版本）

| 状态（官方名） | 颜色 | 图形符号（非颜色冗余） |
| --- | --- | --- |
| Not started | 灰 | — |
| Edited | 粉 | — |
| Pre-translated | 蓝 | 显示匹配率 % |
| Assembled from fragments | 紫 | — |
| Machine-translated | 橙 | — |
| Translator confirmed | 绿 | **单勾** |
| Reviewer 1 confirmed | 绿 | **单勾 + 加号** |
| Reviewer 2 confirmed | 绿 | **双勾** |
| Rejected | 红 | **划叉的铅笔** |
| Locked | 灰底 | **挂锁图标** |

来源：[The Grid](https://docs.memoq.com/current/en/Workspace/the-grid.html)（“memoQ uses color coding to indicate the status of each segment… Translator confirmed: Green, with a single tick mark… Reviewer 1 confirmed: … a single tick mark and a plus sign… Reviewer 2 confirmed: … a double tick mark… Rejected: Red and a crossed-over pencil… Locked: A padlock icon”）。

> 注：Help Center 旧文对 Edited/Assembled 的颜色描述略有出入（brown/pink），以 docs 当前版为准。来源：[Status column in the translation grid](https://support.memoq.com/hc/en-us/articles/6162041844369-Status-column-in-the-translation-grid)。

### 2.3 状态盒上的附加图标

- **百分比**：若该段曾插入 TM/LiveDocs 匹配，匹配率常驻状态盒；MatchPatch 修补过的匹配带感叹号（如 `!92%`）。来源：[The Grid](https://docs.memoq.com/current/en/Workspace/the-grid.html)、[Translation results pane](https://docs.memoq.com/current/en/Workspace/translation-results-list.html)。
- **QA 警告**：橙色闪电；双击闪电打开 Warnings 窗口可忽略；被忽略的警告换成专用“已忽略”图标（截图 `https://docs.memoq.com/current/en/Images/i-l/ignored-warning.png`）。**QA 错误**：错误图标（缺必需标签等），不可忽略、阻断导出。来源：[The Grid (10.3)](https://docs.memoq.com/10-3/en/Places/the-grid.html)。
- **评论**：每行常驻评论图标，双击或 Ctrl+M 打开 Notes 窗口；有评论时悬停显示内容；他人删除高亮文本时目标单元格右上角出现**橙色三角**。来源：[The Grid (10.3)](https://docs.memoq.com/10-3/en/Places/the-grid.html)。
- **自动传播开关**：行级“auto-propagate”图标可双击切换为“不传播”（Ctrl+Shift+H），导出再导入后仍保留。来源：[The Grid (10.3)](https://docs.memoq.com/10-3/en/Places/the-grid.html)。
- **状态可手动改**：双击状态盒打开 **Change segment status** 窗口（例如把 Confirmed 改回 Not started 以修正统计）。来源：[The Grid (10.3)](https://docs.memoq.com/10-3/en/Places/the-grid.html)。

**要点**：memoQ 从不单靠颜色区分状态——勾/双勾/加号/铅笔/挂锁/闪电/气泡是与颜色并行的第二编码，且百分比数字长期驻留。这直接回应了可访问性与“扫一眼知道每段来历”的诉求。

---

## 3. Translation results 面板：命中类型分色分编号

### 3.1 三段式结构

面板分三部分：**顶部命中列表**（左列=资源中的源语条目，中列=编号，右列=目标语等价物）、**中部 Compare boxes**（三个对比框：当前源段 / 命中源文 / 命中译文）、**底部元信息 + “lamps” 指示灯**。来源：[Translation results pane](https://docs.memoq.com/current/en/Workspace/translation-results-list.html)。官方截图 `https://docs.memoq.com/current/en/Images/t-z/translation_results_pane.png`（存档 `translation_results_pane.png`）。

### 3.2 命中类型 → 颜色（桌面版官方口径）

| 颜色 | 类型 |
| --- | --- |
| 红 | TM 与 LiveDocs 匹配（三种子图标：LiveDocs 双语文档 / LiveDocs 对齐对 / TM） |
| 蓝 | 术语库（三种子图标：常规 TB / 术语提取会话接受项 / 外部术语服务） |
| 黑 | **禁用术语**（forbidden terms，列表中划线，不可插入，仅警示；使用即触发 QA 警告） |
| 紫 | fragment assembly（片段拼装）结果 |
| 浅橙 | 自动 concordance（LSC，最长子串索引） |
| 深橙 | 机器翻译 |
| 黄 | MT concordance |
| 灰 | 非译元素（non-translatables） |
| 绿 | auto-translation rules（日期/度量/货币等模式规则）结果 |

来源：[Translation results pane](https://docs.memoq.com/current/en/Workspace/translation-results-list.html)。

### 3.3 匹配率与排序

- 匹配分制：**102%** 双上下文匹配（double context）、**101%** 上下文匹配、**100%** 精确匹配、95–99% 高模糊、85–94% / 75–84% 中模糊、50–74% 低模糊；TC（track changes）匹配是针对“源文档带修订”的特殊精确匹配。来源：[Translation results pane](https://docs.memoq.com/current/en/Workspace/translation-results-list.html)、[Match rates from translation memories and LiveDocs corpora](https://docs.memoq.com/current/en/Concepts/concepts-match-rates-from-translation-m.html)。
- 同分排序：XLIFF:doc 存储匹配 → **Master TM** → LiveDocs → **Working TM** → 其他参考 TM；再同分取修改时间最新者。来源：[Translation results pane](https://docs.memoq.com/current/en/Workspace/translation-results-list.html)。
- 匹配率可被 **罚分（penalties）** 拉低（不可靠 TM/用户/未确认对齐等），也可被 MatchPatch **加分并打感叹号**。来源：[Match rates…](https://docs.memoq.com/current/en/Concepts/concepts-match-rates-from-translation-m.html)、[Edit corpus settings](https://docs.memoq.com/current/en/Workspace/edit-corpus-settings.html)。

### 3.4 Compare boxes 与差异指示灯（lamps）

- Compare boxes 有两种视图：**Track changes view**（把 TM 命中“修订成”当前源段来显示插入/删除）与 **Traditional compare view**（黑=相同、红=差异、蓝=命中里缺的词）。来源：[Translation results pane](https://docs.memoq.com/current/en/Workspace/translation-results-list.html)。
- 底部两组小灯：左侧 2 盏指示“该条目来自自动对齐 / 源文曾被编辑重存”；当所选 TM 匹配率在 95–101% 时另有 **6 盏差异灯：空格 / 标点 / 大小写 / 粗斜下划线格式 / 标签 / 数字与实体**。**彩色点亮 = 需要人工修**；**灰色点亮 = memoQ 检测到差异且已自动修好**（如自动替换数字、自动套格式）。来源：[Translation results pane](https://docs.memoq.com/current/en/Workspace/translation-results-list.html)。灯图标截图：`https://docs.memoq.com/current/en/Images/i-l/icon_lamps.png`（存档 `icon_lamps.png`）。
- 底部元信息：Sub/Dom/Pro/Cli 四个元字段 + 资源名 + 修改人 + 修改时间 + 匹配率 + **该 TM 条目是由译员还是 R1/R2 确认的角色信息**。来源：[Translation results pane](https://docs.memoq.com/current/en/Workspace/translation-results-list.html)。
- TM 命中可**就地编辑**：右键命中 → View/edit 打开 View or edit TM entry 窗口。来源：[Translation results pane](https://docs.memoq.com/current/en/Workspace/translation-results-list.html)。
- 隐藏与排序可调：面板顶部“闭眼”图标表示部分命中被折叠（长匹配盖短匹配等），点击或 Ctrl+Shift+D 展开全部；Translation results settings 窗口可限制 TM 命中条数、开关单语 LiveDocs 命中、按类型排序/禁用、配置自动插入最佳命中。来源：[Translation results pane](https://docs.memoq.com/current/en/Workspace/translation-results-list.html)、[Translation results settings (memoQweb)](https://docs.memoq.com/current/en/memoQWeb-help/mqw-translation-results-settings.html)。

### 3.5 插入操作

Ctrl+Space 插入第一条；Ctrl+数字插入第 N 条；Ctrl+Up/Down 移动高亮后 Ctrl+Enter 插入；双击插入。整段命中替换全部已输入文本，局部命中插入光标处。来源：[Translation editor](https://docs.memoq.com/current/en/Workspace/translation-editor.html)、[The Grid (10.3)](https://docs.memoq.com/10-3/en/Places/the-grid.html)。

---

## 4. 确认 / TM 写入 / 拆分合并 / 锁定 / 翻译与审校模式

### 4.1 确认（confirm）语义

- **Ctrl+Enter**：把译文存入文档 + 存入项目的 **working TM**，状态变 Confirmed，随后**跳到下一段并对其预翻译**（整段匹配则直接填入；文档第一段永不自动预翻译）。来源：[Translation editor](https://docs.memoq.com/current/en/Workspace/translation-editor.html)、[The Grid (10.3)](https://docs.memoq.com/10-3/en/Places/the-grid.html)。
- **Ctrl+Shift+Enter**：确认但**不写 TM**（官方场景：目标格不是真正的译文，或项目没有 TM）。来源：[The Grid (10.3)](https://docs.memoq.com/10-3/en/Places/the-grid.html)。Web 端同义命令名为 **Confirm without update**。来源：[Translating with memoQ editor](https://docs.memoq.com/current/en/webNext-help/memoQeditor-translating.html)。
- **无手动保存**：“You do not have to save the document: memoQ will automatically save every change, even when a segment is not confirmed.” 来源：[Translation editor](https://docs.memoq.com/current/en/Workspace/translation-editor.html)。
- **源文编辑（F2）**：源格变绿可编辑；确认被改源的段时 memoQ **向 TM 写两条**（原源文一条 + 改后源文一条）。来源：[The Grid (10.3)](https://docs.memoq.com/10-3/en/Places/the-grid.html)。

### 4.2 拆分 / 合并（split / join）

- **Ctrl+J** 合并两段（译文也拼接）；**Ctrl+T** 在光标处拆分（译文留在前一段）。来源：[The Grid (10.3)](https://docs.memoq.com/10-3/en/Places/the-grid.html)。（Web 端 memoQ editor 的拆分快捷键是 Ctrl+S。来源：[Translating with memoQ editor](https://docs.memoq.com/current/en/webNext-help/memoQeditor-translating.html)。）
- **不可拆合是常态化设计**：包/在线项目里 PM 可禁用拆合；结构化文档（Excel/XML）跨单元格/跨元素的段不可合并，官方建议“看预览就明白为什么合不了”。来源：[The Grid (10.3)](https://docs.memoq.com/10-3/en/Places/the-grid.html)。
- 分段错误的正解不是手工拆合而是**加缩写 + 重分段**：Edit 功能区 Add Abbreviation → 勾选 Resegment this document now / Resegment all documents now。来源：[The Grid (10.3)](https://docs.memoq.com/10-3/en/Places/the-grid.html)。

### 4.3 锁定（lock）

Ctrl+Shift+L 锁定/解锁当前段或多选段；跨文档批量走 Preparation 功能区 **Lock/Unlock segments** 窗口；锁定目的官方明说两条：防误改 + **从 Statistics 中排除**。锁定段显示挂锁、灰底、不可编辑。来源：[The Grid (10.3)](https://docs.memoq.com/10-3/en/Places/the-grid.html)、[The Grid](https://docs.memoq.com/current/en/Workspace/the-grid.html)。

### 4.4 翻译 vs 审校：角色化状态而非模式切换

memoQ 桌面端**没有独立“审校模式”开关**，区别由以下机制承担：

1. **角色化确认**：同一 Ctrl+Enter，按当前用户角色写成 Translator confirmed / Reviewer 1 confirmed / Reviewer 2 confirmed 三种状态（图标勾/勾+加号/双勾），TM 条目也记录确认角色。来源：[The Grid](https://docs.memoq.com/current/en/Workspace/the-grid.html)、[Translation results pane](https://docs.memoq.com/current/en/Workspace/translation-results-list.html)。
2. **驳回**：审校 **Shift+Enter** 驳回段；若项目配了 LQA 模型则弹 **Enter LQA error** 窗口做结构化反馈（错误类型/严重度），PM 可出 LQA 报告。来源：[The Grid (10.3)](https://docs.memoq.com/10-3/en/Places/the-grid.html)。
3. **Track changes**：Review 功能区开关，插入/删除/修改以 Word 式修订显示，记录用户名和时间；`Show changes → Final version` 只看终稿。仅 Word/SDLXLIFF/表格 RTF 能导出修订。来源：[The Grid (10.3)](https://docs.memoq.com/10-3/en/Places/the-grid.html)。
4. **版本对比**：Review 功能区 `Compare versions`：Off / Against Last Received Version / Against Last Delivered Version / Against Last Inserted Match / Custom。来源：[The Grid (10.3)](https://docs.memoq.com/10-3/en/Places/the-grid.html)。
5. **文本标记（Mark text）**：荧光笔式高亮，四类：Information / Warning / Error / Other，可挂评论。来源：[The Grid (10.3)](https://docs.memoq.com/10-3/en/Places/the-grid.html)。

Web 端 memoQ editor 则把“确认图标按角色渲染 + 状态色表（White Not started / Orange Edited / Light green TR / Green R1 / Dark green R2 / Blue Pre-translated / Yellow MT / Red Rejected）”写进了同一篇文档。来源：[Translating with memoQ editor](https://docs.memoq.com/current/en/webNext-help/memoQeditor-translating.html)。

### 4.5 自动传播（auto-propagation）

开启后确认重复段会自动填充文档内其余重复段；官方警告其危险性（同句异译场景），并提供**行级豁免**（见 §2.3）。来源：[The Grid (10.3)](https://docs.memoq.com/10-3/en/Places/the-grid.html)。

---

## 5. 标签与占位符：一等公民 chips + 标签 QA

### 5.1 标签在网格中的形态

- 能内联渲染的格式只有 bold/italic/underline/上下标及组合；**其余一切格式与结构都渲染成 inline tag**（截图 `https://docs.memoq.com/current/en/Images/i-l/inline-tags.png` 中 `rpr` 圆角小 chip 环绕 “Line 26”）。图片/嵌入对象也各有 inline tag。来源：[The Grid (10.3)](https://docs.memoq.com/10-3/en/Places/the-grid.html)。
- **四档显示密度**（Edit 功能区 Inline Tags 菜单）：Short（仅类型+编号）→ Medium（类型+名称）→ Filtered（类型+名称+过滤后属性，**默认**，属性集由文档类型/过滤器配置定义）→ Long（全部属性，官方警告可能把文档挤到不可读，仅排错用）。来源：[The Grid (10.3)](https://docs.memoq.com/10-3/en/Places/the-grid.html)。
- **配对与编号规则**：按名称与 id 属性配对；从左到右编号；开/闭标签同号、空标签独立号；目标侧沿用源侧配对与编号，无源对应者给新号；删除标签不重排号，重开文档才重算。来源：[The Grid (10.3)](https://docs.memoq.com/10-3/en/Places/the-grid.html)。
- 旧式格式标签（legacy formatting tags）以花括号 `{}` 形态出现（段内换行等），**属于必需标签**。来源：[The Grid (10.3)](https://docs.memoq.com/10-3/en/Places/the-grid.html)。

### 5.2 标签操作命令集（全键盘化）

| 命令（官方名） | 快捷键 | 语义 |
| --- | --- | --- |
| Copy next tag sequence | **F9** | 复制下一个尚未进入目标格的标签序列；若先选中目标文本再按，配对标签环绕所选文本 |
| （按住）Ctrl | — | 弹出标签/标签对选择菜单，按需挑选 |
| Tag insertion mode | F6 | 进入“逐击放置标签”模式，放完才能改文本 |
| Insert all tags | Alt+F8 | 全部源标签一次性倒进光标处（官方原话“不推荐使用”） |
| Arrange tags | Alt+F6 | 自动修正标签顺序 |
| Remove all tags | Ctrl+F8 | 清空目标格全部标签 |
| Insert new inline tag / Edit inline tag | — / Ctrl+F9 | 新建（需文档类型允许）/ 编辑标签，走 Inline tag 窗口 |
| Quick insert tag | Ctrl+F10 | 从文档类型允许的标签列表中挑选插入，成对标签按对插入 |

来源：[The Grid (10.3)](https://docs.memoq.com/10-3/en/Places/the-grid.html)。功能区截图：`https://docs.memoq.com/current/en/Images/d-h/edit-ribbon-tag-commands-all.png`（存档 `edit-ribbon-tag-commands-all.png`）。

### 5.3 placeables 与 AutoPick

- 官方定义：“Numbers, tags, terms, non-translatable items, auto-translation suggestions are together called **placeables**.”
- 打字时按住 Ctrl 呼出 **AutoPick** 菜单，只列出**源文有而目标格还没有**的 terms/numbers/tags 等 placeables；Tab/Enter 插入首项。来源：[The Grid (10.3)](https://docs.memoq.com/10-3/en/Places/the-grid.html)。官方截图 `https://docs.memoq.com/current/en/Images/t-z/the-grid-autopick.png`（存档 `the-grid-autopick.png`）清晰展示 `rpr`/`tab`/`fld`/`instr`/`hlnk` 等 chip 与 AutoPick 下拉。
- **Regex Tagger**（Preparation 功能区）：把混在正文里的代码/占位符文本用正则规则**转成真正的 inline tag** 加以保护——官方把“文本样式的占位符”升格为受保护 chip 的入口。来源：[The Grid (10.3)](https://docs.memoq.com/10-3/en/Places/the-grid.html)。

### 5.4 标签 QA（错误 vs 警告的分界）

- **缺必需标签（含 legacy formatting tags）= 错误**：段上显示错误图标，**不能导出文档**，不可忽略。**缺可选标签 = 警告**：橙色闪电，可双击处理或去 Resolve errors and warnings 批处理。来源：[The Grid (10.3)](https://docs.memoq.com/10-3/en/Places/the-grid.html)。
- QA settings 的 **Inline tags** 标签页可开：与源对照的 well-formedness、配对标签交叠（overlapping paired tags）、目标缺/多标签、**标签顺序变化**（高亮首个错序标签）、标签前后空格是否与源一致、开/闭标签内不得有空格、无实体定义/多实体定义的 Unicode 字符。来源：[Edit QA settings](https://docs.memoq.com/current/en/Workspace/edit-qa-settings.html)。
- QA 代码表中标签类占据 1001–2017 段位（例：2003 overlapping tag pairs、2004 missing required tag、2010 not well-formed against source、2011 missing inline tag、2015 extra inline tag、2016 changed tag order、2017 non-translatable tag sequence changed）。来源：[Quality Assurance (QA) warnings](https://docs.memoq.com/current/en/Concepts/concepts-quality-assurance-qa-warnings.html)。
- Translation results 里 TM 命中**按 TM 内存储的真实格式和标签渲染**（空 chip 形态），帮助理解匹配率成因。来源：[Translating with memoQ editor](https://docs.memoq.com/current/en/webNext-help/memoQeditor-translating.html)。

---

## 6. QA 体系：warning/error 双级 + 可重映射严重度 + Resolve errors and warnings

### 6.1 QA 是资源（QA settings resource）

- QA 检查项打包为可克隆、可导入导出（.mqres）、每项目**恰好选一个**的“QA settings”轻资源；默认资源不可编辑，必须先 Clone。来源：[Edit QA settings](https://docs.memoq.com/current/en/Workspace/edit-qa-settings.html)、[Resource Console - QA settings](https://docs.memoq.com/current/en/Workspace/resconsole-qasettings.html)。
- 官方反复强调 **QA ≠ LQA**：QA 是自动检查；LQA 是人工结构化反馈（打分/分类）。来源：[Edit QA settings](https://docs.memoq.com/current/en/Workspace/edit-qa-settings.html)。

### 6.2 检查域（Edit QA settings 的九个标签页）

1. **Segments and terms**：术语一致性（Source to target / Target to source / Both ways）；禁用术语告警（含“源文里出现禁用术语”反向告警 3098）；目标/源长度比例（按字符与词双轨 + 允许偏差）；硬上限字符数；目标=源告警；空目标告警；bold/italic/underline 对齐检查；auto-translatables 使用检查；非译元素一致性（可选精确匹配以减少误报）。
2. **Consistency**：目标重复词；同源异译 / 异源同译 / 双向（可选含格式、大小写敏感）；**对 TM 的一致性**（best exact/context match 与译文不同、most recent match 与译文不同、存在多个 exact/context matches）；修订一致性（源有增删而译文没有）。
3. **Numbers**：数字格式校验（可按语言自定义小数点/负号/千分组符，>10000 与 <10000 分开配置，非断空格支持）；**语言学解读数字**（官方例子：EN→HU 里 `1,000` 两边相同反而应告警，因为匈语逗号是小数点）；全角数字检测；**字母数字混合码**（产品号/URL）一致性；**度量单位跟随数字检查**（可维护单位表）。
4. **Punctuation**：语言特定标点；括号/引号/撇号配对与数量；标点前后空格（含法语非断空格规则）；**标点序列合法性**（内置 10 条规则，如 `.,` 非法、破折号前只允许句号或逗号等，省略号可豁免）；句末标点一致。
5. **Spaces, capitals, characters**：双空格；段尾空格；首字母大小写一致；**禁用字符表**（可按 Unicode 码点添加）；拼写/语法告警（可跳过非译元素）；**“视为空格的标签”表**（如 HTML `<br>`）。
6. **Inline tags**：见 §5.4。
7. **Length**：按行内注释携带的长度上限检查；**像素级长度检查**（用正则从行注释提取 `120px;Arial;10pt;BI` 之类的字体/字号/样式/限宽，计算目标渲染宽度；可声明“这些警告不可忽略”即升级为出口闸门）。
8. **Regex**：七种自定义正则检查（目标禁配、目标缺配、源目匹配数不等、缺替换、禁替换、替换数不等、纯目标禁配），支持 `$1` 组引用、**Correction 字段可给出自动修复**，可 `Expand tags to text` 检查标签内部。
9. **Severity**：**任一检查结果都可以逐条在 Warning/Error 之间重映射**（默认全部 warning；error 阻断交付）。

以上全部来源：[Edit QA settings](https://docs.memoq.com/current/en/Workspace/edit-qa-settings.html)、[Specify number format for language](https://docs.memoq.com/current/en/Workspace/specify-number-format-for-language.html)。

### 6.3 QA 代码表

官方维护完整代码表（**100+ 条**，带 `{0}` 参数化描述文案），三个号段：1001–1002（memoQ `{tags}`）、2001–2017（inline tag / 属性 / 实体）、3010–3309（文本类：数字 3061–3069、符号前后空格 3071–3076、引号括号 3077–3089、术语 3091–3098、一致性 3100/3101/3151–3153、格式 3131–3134、长度 3081–3084/3180–3182、标签周边空格 3190–3197、正则 3200–3206、修订 3220/3221、度量/编码/日期 3301–3309）。来源：[Quality Assurance (QA) warnings](https://docs.memoq.com/current/en/Concepts/concepts-quality-assurance-qa-warnings.html)。

### 6.4 Resolve errors and warnings（批处理 tab）

- 入口：Review 功能区 Quality Assurance 下拉 → Resolve errors and warnings；先选 **scope**（Project / Active document / Selected documents 等，多目标语项目全语言收集）。来源：[Resolve errors and warnings (scope)](https://docs.memoq.com/12-0/en/Workspace/resolve-errors-and-warnings-scope.html)、[Resolve errors and warnings](https://docs.memoq.com/current/en/Workspace/resolve-errors-and-warnings-tab.html)。
- 列表列：**Ignore 复选框列**（错误行无法勾）、Document、Row、**Code**（可按 code 排序做“同类问题一次清完”）、Description（auto-translation 类问题还给出建议）、错误/警告图标列。行配色：错误红、被忽略警告浅蓝、**已修复并确认的绿**、不可编辑灰。来源：[Resolve errors and warnings](https://docs.memoq.com/current/en/Workspace/resolve-errors-and-warnings-tab.html)。
- 顶部是**可编辑的当前段**（类似翻译编辑器但无 Translation results、无预测输入），memoQ 能给出 **Correction 建议并一键 Apply Auto correction（Ctrl+Alt+Space）**；Ctrl+Enter 确认并回写文档与 working TM，Ctrl+Shift+Enter 只回写文档。来源：[Resolve errors and warnings](https://docs.memoq.com/current/en/Workspace/resolve-errors-and-warnings-tab.html)。
- 忽略操作三粒度：**Ignore and move to next / Ignore all of this kind / Ignore all for this row**。工具栏开关：Refresh data、Hide ignored items、Hide warnings（只看阻断导出的错误）。可 **Export report** 出 HTML 报告。QA 也能**跑在 TM 上**（结果不持久化，官方提醒勿点 Refresh）。来源：[Resolve errors and warnings](https://docs.memoq.com/current/en/Workspace/resolve-errors-and-warnings-tab.html)。
- 运行语义细节：确认段时只跑“快检查”，**一致性检查只在 Run QA 批处理时跑**，所以警告可能在确认后消失。来源：[The Grid (10.3)](https://docs.memoq.com/10-3/en/Places/the-grid.html)。
- Web 端 QA issues 侧栏：按 Row / Category 分组，Errors（红，不可忽略）/ Active warnings（黄）/ Ignored warnings（灰）三态过滤，支持“Ignore this warning type”按类型忽略、多选 Ignore/Restore、点卡片跳段。来源：[Translating with memoQ editor](https://docs.memoq.com/current/en/webNext-help/memoQeditor-translating.html)。

---

## 7. 过滤与排序 vs 查找 vs 视图（Views）

memoQ 把“缩小工作集”分成**三层互不混淆的机制**：

### 7.1 网格顶部的过滤/排序条（即时、临时）

- Source / Target 两个文本框联合过滤（叠加语义：新条件默认叠在旧结果上，可勾 Clear previous filter results 改为重来）；设置弹窗提供大小写敏感、**regex（带 Regex Assistant）**、搜索范围扩展（含 comments、含 context ID、或只搜两者）、匹配方式（Anything / Only whole words）、Highlight all。**Ctrl+Shift+F = 选中即过滤**（再按取消）。来源：[The Grid (10.3)](https://docs.memoq.com/10-3/en/Places/the-grid.html)。截图：`https://docs.memoq.com/current/en/Images/d-h/filtering_and_sorting.png`、`filtering-options.png`。
- Sort 下拉：No sorting / Alphabetical by source / by target / Source text length / Target text length / Match rate / Frequency（重复次数）/ Last changed / **Row status**（升序定义为 Not started → Pre-translated → Edited → Translator confirmed → R1 → R2）。来源：[The Grid](https://docs.memoq.com/current/en/Workspace/the-grid.html)。

### 7.2 查找/替换（另一条通道）

Ctrl+F 打开 **Quick find**，再按一次升级为 **Advanced find and replace**；Ctrl+H 替换同理两段式。查找不改变网格工作集，与过滤条并存。来源：[The Grid (10.3)](https://docs.memoq.com/10-3/en/Places/the-grid.html)。

### 7.3 Views（持久、可命名、可派发的静态切片）

- 官方定义直接把两者对立起来：“Using views is different from the on-the-fly filtering… A view is always static – it has a name and it can be re-opened any time, can be exported or imported as though it were a separate file, can be assigned to a translator… With on-the-fly filtering, when you close the project, you lose the filtered list.” 来源：[Views (concepts)](https://docs.memoq.com/12-0/en/Concepts/concepts-views.html)。
- 视图是**引用不是拷贝**：改视图里的段即改原文档。来源：[Create view (filtering and sorting)](https://docs.memoq.com/current/en/Workspace/create-view-filtering-and-sorting.html)。
- 两大形态：**glue**（多个小文件拼成一个可开一次的“大文档”）与 **split**（按段号区间切大文档，如 1500–3000 段）。来源：[Views (concepts)](https://docs.memoq.com/12-0/en/Concepts/concepts-views.html)、[Create view…](https://docs.memoq.com/current/en/Workspace/create-view-filtering-and-sorting.html)。
- 过滤条件维度（Create view 窗口）：重复频次（Minimum frequency + Keep duplicates 双语义）；源/目标包含词表；**Common filters**（未确认/各角色已确认/预翻译/匹配率区间/错误/变更冲突标记/重复/非重复/锁定/未锁定）；**Status 组合面板**（匹配率区间 + 行状态多选含 X-translated + 锁定三态 + 其他属性：自动拆合、错误、未抑制警告、重复、TC 匹配、有评论、自动传播、Find/Replace 标记、被修订段…组间 AND、组内 OR）；**Conflicts and changes**（双语更新告警、服务器下载的他人变更、冲突胜负、按用户名/时间过滤、“插入的匹配被改过 / 从零翻译”）；**Comment and tags**（评论包含文本、LQA 错误行、源/目标含 memoQ `{tag}`、源/目标含指定文本的 inline tag，并支持 **`tagname>attribute>value` 三级查询语法**，带引号转义与语法错误红底提示）。来源：[Create view (filtering and sorting)](https://docs.memoq.com/current/en/Workspace/create-view-filtering-and-sorting.html)。
- 视图静态性官方示例：建“已编辑段”视图后某段被确认，**不会**从视图消失。来源：[Create view…](https://docs.memoq.com/current/en/Workspace/create-view-filtering-and-sorting.html)。

**结论**：memoQ 的“display filter vs find”答案是三件套——**临时过滤条（会话级）、双段式查找替换（不动工作集）、命名视图（持久、可交接）**。视图的条件面板同时也是 memoQ 全部行级元数据的清单。

---

## 8. 资源模型：TM / TB / LiveDocs / Muses / MT 在 UI 中的暴露方式

### 8.1 Resource console：20 种资源、轻重分级

- **Resource console** 是所有资源的中央管理处；官方口径：memoQ 有 **20 种资源**，其中 4 种是 **heavy resources**（TM、TB、LiveDocs corpora、Muses——含大量语言/统计数据），其余是 **light resources**（QA settings、分段规则、过滤器配置、非译清单、自动翻译规则、快捷键集等），轻资源可导出成 `.mqres` XML。来源：[Resource console](https://docs.memoq.com/current/en/Workspace/resource-console.html)、[Resource Console - Non-translatable lists](https://docs.memoq.com/12-2/en/Workspace/resconsole-nontrans.html)。
- 布局：左侧资源类别列表；heavy 资源有语言过滤字段；列表下方是该类资源全部动作链接（create/clone/edit/import/export/share/pin…）。来源：[Resource console](https://docs.memoq.com/current/en/Workspace/resource-console.html)。
- 所有资源遵循统一惯例：**默认资源不可编辑，Clone 后编辑，勾选复选框激活**（QA settings、键盘快捷键集等一致）。来源：[Edit QA settings](https://docs.memoq.com/current/en/Workspace/edit-qa-settings.html)、[Customize memoQ shortcuts](https://docs.memoq.com/current/en/Workspace/customize-memoq-shortcuts.html)。

### 8.2 各资源在编辑器里的暴露点（不写论文，只列 UI 接触面）

| 资源 | 编辑器接触面 |
| --- | --- |
| **TM** | Translation results 红色命中 + compare boxes + 元数据 + lamps；Ctrl+K Concordance；确认即写 working TM；命中右键 View/edit 就地改条目；Master/Working/Reference 排序权重 |
| **TB（术语库）** | 蓝色命中 + 源文中术语高亮；**Ctrl+E** Create term base entry / **Ctrl+Q** Add terms now（选中源+译即时入库，不弹窗）；禁用术语黑色划线仅警示；QA 联动（3091–3098）；多语条目、Moderated（术语员审批）机制 |
| **LiveDocs** | 与 TM 同列红色命中（子图标区分双语文档/对齐对）；对齐错了右键命中 → Show document 进对齐编辑器**边翻边修**（LiveAlign）；单语文档只服务 Concordance（Library）；未确认对齐吃罚分 |
| **Muses** | 不进 Translation results，只作为 **predictive typing** 的候选来源（列表末位）；训练自 TM/LiveDocs，可调 Sensitivity（5–25 次起收）与 Precision（0–100） |
| **MT** | 深橙命中；可参与 MatchPatch 修补；预翻译可批填（状态 Machine-translated 橙色） |
| **非译清单 / auto-translation rules** | 灰色/绿色命中 + placeables 进 AutoPick + QA 一致性检查 |

来源：[Translation results pane](https://docs.memoq.com/current/en/Workspace/translation-results-list.html)、[Concordance](https://docs.memoq.com/current/en/Workspace/concordance.html)、[Term bases (concepts)](https://docs.memoq.com/current/en/Concepts/concepts-term-bases.html)、[Translating with memoQ editor](https://docs.memoq.com/current/en/webNext-help/memoQeditor-translating.html)、[LiveDocs (concepts)](https://docs.memoq.com/current/en/Concepts/concepts-livedocs.html)、[Alignment (concepts)](https://docs.memoq.com/current/en/Concepts/concepts-alignment.html)、[Alignment editor](https://docs.memoq.com/current/en/Workspace/alignment-editor.html)、[Muses (concepts)](https://docs.memoq.com/current/en/Concepts/concepts-muses.html)、[Train Muse](https://docs.memoq.com/current/en/Workspace/train-muse.html)、[Create Muse](https://docs.memoq.com/current/en/Workspace/create-muse.html)、[Predictive typing](https://docs.memoq.com/current/en/Workspace/predictive-typing.html)、[Edit corpus settings](https://docs.memoq.com/current/en/Workspace/edit-corpus-settings.html)、[Edit QA settings](https://docs.memoq.com/current/en/Workspace/edit-qa-settings.html)。

### 8.3 Concordance 细节（因为它是 TM 的第二张脸）

- Ctrl+K；默认 **KWIC 三列视图**（语料库语言学经典布局），选中行在底部显示译文与元数据；**Source+target** 视图逐行并排 + **Guess translation**（从整段译文猜术语翻译，**绿色深浅表示置信度**）；Filter source/target 二次过滤；通配符 `*`（可选变化）与 `+`（必须变化）前后缀；命中右键 View/Edit Entry / Delete entry 直接维护 TM；Ctrl+E 从 Concordance 直接建术语。来源：[Concordance](https://docs.memoq.com/current/en/Workspace/concordance.html)。

### 8.4 键盘可定制性

大多数快捷键可改：Options → Keyboard shortcuts → Clone 默认集 → Customize memoQ shortcuts 窗口按分类搜索命令、录入组合键（冲突即时提示）、另有 Special characters 与 **Inline tags 快捷键**两个子窗口；激活需勾选。来源：[Customize memoQ shortcuts](https://docs.memoq.com/current/en/Workspace/customize-memoq-shortcuts.html)、[Options - Keyboard shortcuts](https://docs.memoq.com/current/en/Workspace/options-keyboard-shortcuts.html)。

---

## 9. 子句级复用：fragment assembly / MatchPatch / LSC / predictive typing

这是 memoQ 相对“TM 整段命中”之外的四层子句级复用管线，全部有官方机制说明：

1. **Fragment assembly（紫色命中）**：整段无命中时，从段首开始贪心找最长片段（TM 只用精确匹配、TB 不用前缀匹配），逐词推进拼出覆盖全段的“patchwork”，没覆盖的词**保留源语**填坑；多个术语命中同一片段时按术语库优先级 + 元数据契合度（Domain > Project name > Client name > Subject——注意官方文中给出的重要性排序示例以 Client > Subject 为准）打分取胜。来源：[Translation results pane](https://docs.memoq.com/current/en/Workspace/translation-results-list.html)。官方示例截图：`https://docs.memoq.com/current/en/Images/d-h/fragass_example4.png`（存档 `fragass_example4.png`）。
2. **MatchPatch（`!93%`）**：用 TB/TM/MT 修补模糊 TM 命中的差异词；显示 `73%->93%` 双分数；修补匹配**封顶 94%**（强制罚分防冒充精确匹配）；**不修数字和标签**（官方明确这是 TM 自己的职责）；预翻译时不修补；网格中修补段用**浅蓝**区别于普通预翻译。来源：[Translation results pane](https://docs.memoq.com/current/en/Workspace/translation-results-list.html)。截图：`match-patch-new.png`。
3. **LSC（Longest Substring Concordance，浅橙）**：自动检索最长可 concordance 子串并尝试给出对应译文；无译文时双击进 Concordance 窗口。来源：[Translation results pane](https://docs.memoq.com/current/en/Workspace/translation-results-list.html)。
4. **Predictive typing**：输入 1–2 字符起浮词补全，来源优先级固定为 non-translatables → auto-translatables → TB → LSC → 术语插件 → **Muses（永远垫底）**；大小写策略三选一（跟原命中 / 跟输入 / 基于源段智能猜）。来源：[Predictive typing](https://docs.memoq.com/current/en/Workspace/predictive-typing.html)、[Disabling or configuring predictive typing（Help Center）](https://support.memoq.com/hc/en-us/articles/360010266600-Disabling-or-configuring-predictive-typing-in-memoQ)。

---

## 10. Web 端（webtrans / memoQ editor）的简化策略

memoQ 有两代 Web 编辑器，其“做减法”的清单对 Translunar 有参考价值：

- **webtrans（旧）**：同样是双列网格 + 右侧 Translation results + 底部 View pane；官方直言“不能用 memoQ 的高级搜索功能（只有按文本与状态过滤）”；预览“不保证像最终文档，甚至不保证有”。来源：[webtrans - Translation editor](https://docs.memoq.com/current/en/memoQWeb-help/mqw-translation-editor.html)。
- **memoQ editor（新，webNext）**：右侧改为**图标侧栏**（Translation results / Look up term / Focus on row / Comments / QA issues / Reference files 六个抽屉）；“Focus on row” 把当前行的命中+评论+QA 收进一个面板；保存状态改为“云图标 + All changes saved”；状态栏增加当前段 **Context ID 显示与复制按钮**；交付走顶部 **Deliver** 按钮，有错误时按钮变为推荐动作（Return document）。来源：[Translating with memoQ editor](https://docs.memoq.com/current/en/webNext-help/memoQeditor-translating.html)。
- 新 Web 端把桌面的复杂过滤收敛为：文本过滤（Any match / Words match / Entire segment + 词序开关 + 大小写）+ Advanced filters；查找替换支持搜源/目标/标签/评论/Context ID，Replace all 明确列出**不替换**的情形（锁定行、他人切片、源文/标签/评论内命中）。来源：[Translating with memoQ editor](https://docs.memoq.com/current/en/webNext-help/memoQeditor-translating.html)。
- 桌面沿革注：sublanguage（en-US/en-GB 区分）设置影响 Translation results 与 Pre-translate。来源：[Translating with memoQ editor](https://docs.memoq.com/current/en/webNext-help/memoQeditor-translating.html)。

---

## 11. 社区佐证：编辑器密度与状态图标

仅两条有代表性的公开讨论（观点性内容，不作为规格依据）：

- ProZ 三工具对比帖：用户列 memoQ 优点“更直观；能建真正独立的视图（按段号/状态/重复与否）；能按长度/频次排序；自动传播快且不误改”，缺点“编辑器有时逐段移动变慢；TM/工作文件没有单文件原生格式，转移要导出”；对应 Trados 的“只能过滤、不能建独立视图；不能按长度/字母/频次排序”。来源：[A Comparative Study of User Perception and Friendliness…（ProZ）](https://www.proz.com/forum/cat_tools_technical_help/362011-a_comparative_study_of_user_perception_and_friendliness_of_sdl_trados_memoq_and_phrase_in_translat.html)。
- ProZ memoQ vs Trados 帖：推荐 memoQ 的三个理由“可用性与直觉、格式互操作、速度”。来源：[MemoQ vs. Trados（ProZ）](https://www.proz.com/forum/memoq_support/236008-memoq_vs_trados.html)。

---

## 12. 对比附录 A：Phrase（TMS CAT editor）

> 范围：Phrase TMS 的 CAT web editor（桌面版 2025-10 起进入维护模式，官方推荐 Web 版）。来源：[CAT Editor (TMS)](https://support.phrase.com/hc/en-us/articles/5709683847964-CAT-Editor-TMS)。

**IA**：编辑器按“panes”划分：翻译表 + CAT pane（命中）+ QA pane + LQA pane + 预览（Tools → Show preview tab 开启，可显示源或目标文档）+ 底部状态栏（总段数/已确认段数、源字符统计、资源连接状态指示灯，指示灯在 Web 版右上角）。来源：[CAT Editor (TMS)](https://support.phrase.com/hc/en-us/articles/5709683847964-CAT-Editor-TMS)、[Phrase TMS Quick Start Guide for Linguists (PDF)](https://phrase.com/wp-content/uploads/2023/11/phrase-tms-quick-start-guide-linguists.pdf)。Web 版单窗口上限 15 万段、最多 290 个已打开 job。来源：[CAT Web Editor (TMS)](https://support.phrase.com/hc/en-us/articles/5709683890204-CAT-Web-Editor-TMS)。

**确认与状态**：段默认 unconfirmed；Ctrl+Enter / 点击段旁状态图标确认；确认写 TM（TM 须为 Write 模式）；**编辑已确认段自动退回 unconfirmed**；上一工作流步骤确认过的段显示**灰色对勾**；锁定（Ctrl+L）仅 PM/管理员可操作。来源：[Segments (TMS)](https://support.phrase.com/hc/en-us/articles/5709678012828-Segments-TMS)。

**QA（其最有辨识度的部分）**：

- 两档运行：**Instant QA**（确认段时跑；有问题则段**不落 TM**、显示黄色警告三角并弹开 QA pane，必须修复或标 false positive 才能确认）与 **Manual QA**（提交 job 前全量跑）。来源：[Quality Assurance - QA (TMS)](https://support.phrase.com/hc/en-us/articles/5709703799324-Quality-Assurance-QA-TMS)、[Quality Assurance Pane - QA (TMS)](https://support.phrase.com/hc/en-us/articles/5709694857372-Quality-Assurance-Pane-QA-TMS)。
- 检查表按 Linguistic / Terminology / Formatting and tags / **Workflow** / Custom checks 分组；亮点检查：**Unedited TM fuzzy match**（模糊匹配未改就确认）、**Unedited NT/MT fuzzy match**、**Newer version in a preceding workflow step available**、**Unresolved comment**、nested tags、tags-joined segments（`{j}` 数量）、XLIFF 结构标签顺序、自定义正则（源目匹配数对比 + 命名组计数）。部分检查可选择在翻译表中**高亮**。来源：[Quality Assurance - QA (TMS)](https://support.phrase.com/hc/en-us/articles/5709703799324-Quality-Assurance-QA-TMS)。
- 治理：PM 可设“QA 未跑/未清不得 Complete”、逐项禁用 “Can be ignored”；QA 结局持久化在 job 上（`QA Warnings: 2 (1 ignored)`、Not launched、Incomplete）。忽略可跨工作流步骤生效。来源：[Quality Assurance - QA (TMS)](https://support.phrase.com/hc/en-us/articles/5709703799324-Quality-Assurance-QA-TMS)。

**标签**：官方分四类展示——Unpaired/Single、Custom、Joined、Paired；悬停或 Edit → Tags → Expand tags 查看内容。来源：[Quick Start Guide (PDF)](https://phrase.com/wp-content/uploads/2023/11/phrase-tms-quick-start-guide-linguists.pdf)。

**过滤**：编辑器内过滤即输即滤；可按 Source/Target/Context Key/Context Note/Tags 搜索，支持 regex 与最多 5 个 `AND`/`OR` 算子；可按段状态、TM 匹配率区间、**自定义段元数据**（来自 Strings）过滤与排序。来源：[Filtering (TMS)](https://support.phrase.com/hc/en-us/articles/5709720416796-Filtering-TMS)。

**值得偷的独有想法**：① “确认时 Instant QA 不过 → 不落 TM”的闸门语义；② “Unedited fuzzy match” 类**行为型 QA**（不是文本对比，而是过程审计）；③ QA 结局作为 job 元数据持久展示；④ 段元数据（context key/note）作为一等过滤维度。

---

## 13. 对比附录 B：OmegaT

> 范围：OmegaT 6.x 官方手册（manual-latest）。

**IA**：主窗口 = Editor + Notepad + Fuzzy Matches + Glossaries + Segment properties + Comments + Multiple Translations + Dictionaries/Machine Translations（默认停靠成 tab）+ 状态栏；窗格可拖拽重排/浮出，`View → Restore OmegaT Window` 一键复位；窗格右上角统一提供 actions/最小化/最大化/浮出小部件；**关闭的窗格有内容时 tab 会橙色高亮提示**（可按窗格开关）。来源：[Panes](https://omegat.sourceforge.io/manual-latest/en/chapter.panes.html)。

**编辑器形态（与网格派完全不同）**：正文以**文档流**呈现，当前段展开为“源文行（绿底加粗）+ 紧随其下的译文行”，行尾有 `<segment 2148 ¶>` 段标记；双击任意段即跳转编辑；**光标默认锁定在译文字段（F2 解锁）**，状态栏显示 LCK/UNL 与 INS/OVR。来源：[Panes](https://omegat.sourceforge.io/manual-latest/en/chapter.panes.html)。空译文=未翻译（生成译文时保留原文）；允许存储“译文=源文”。来源：[Panes](https://omegat.sourceforge.io/manual-latest/en/chapter.panes.html)。

**Fuzzy Matches 的三重百分比**：每条命中并列显示三个分数——①按源语分词器做词干化、忽略标签与数字；②不做词干化、忽略标签与数字；③含标签数字的全文比对。选中命中加粗显示；**缺词蓝色、邻接部分绿色**。Ctrl+2..5 选第 N 条，Ctrl+R 整段替换 / Ctrl+I 光标处插入。来源：[Panes](https://omegat.sourceforge.io/manual-latest/en/chapter.panes.html)。

**Glossaries**：项目内 `glossary` 目录的所有文件即术语库（**纯文本 TSV/CSV，文件一变即时生效**）；每项目一个可写术语表，Ctrl+Shift+G 建条目；`View → Mark Glossary Matches` 给源文命中词加下划线，右键弹出可插入译法；词条注释可带超链接。来源：[Panes](https://omegat.sourceforge.io/manual-latest/en/chapter.panes.html)。

**Multiple Translations（独有）**：同一源段在不同上下文可登记**多个替代译文**（Create Alternative Translation / Use as Default Translation）。来源：[Panes](https://omegat.sourceforge.io/manual-latest/en/chapter.panes.html)。

**标签与 QA**：装饰格式转成灰色保护标签，可删可手输可移动；Ctrl+Shift+T 插入全部缺失标签 / Ctrl+T 插入下一个缺失标签；官方警告“标签管理出错会导致译文件打不开”，交付前用 **Tools → Check Issues...（Ctrl+Shift+V）** 统一体检（含标签问题与术语问题检测）。来源：[Introduction to OmegaT](https://omegat.sourceforge.io/manual-latest/en/chapter.instant.start.guide.html)、[Menus](https://omegat.sourceforge.io/manual-latest/en/chapter.menus.html)。

**状态栏**：双击数字在“计数模式/百分比模式”间切换，同屏给出文件内、项目内（去重与总量双口径）与当前段字符数。来源：[Panes](https://omegat.sourceforge.io/manual-latest/en/chapter.panes.html)。

**值得偷的独有想法**：① 匹配率三分数并列（把“为什么是 85%”解释给译员）；② 术语库=目录里的纯文本文件、外部编辑即时热载；③ Multiple Translations 的“同源异译”一等建模（memoQ 用 101%/102% 上下文匹配间接解决，OmegaT 直接给 UI）；④ Notepad（存 TM 不出译文件的私人段级笔记）与 Comments（文件自带注释，只读）分开两个窗格。

---

## 14. 对比附录 C：Wordfast Pro

> 范围：Wordfast Pro（TXLF Editor）官方 User Guide 11.1 与 5.x 在线文档。

**IA**：TXLF Editor view = 文件名 tab（可 chain 多文件）+ 功能区式 Action Bar + **Table Filter**（表内过滤/搜索）+ 编辑器双列表格 + Terminology pane；列结构为：**源段列（编号+色码）/ 目标段列 / Segment Score 列（TM 匹配百分比，无表头标签）/ Status 列 / Verification 列（绿色对勾提交段）**。来源：[TXLF Editor View (5.3)](https://www.wordfast.com/WFP/5.3/c1730832.html)、[WFP User Guide 11.1 (PDF)](https://www.wordfast.com/WFP/11.1/assets/pdf/WFP_User_Guide_11.1.0.pdf)。

**状态图标（纯图标制）**：官方状态表——Transcheck 非语言错误 / 锁定 / **do not write to TM**（不可提交 TM）/ 分析期标记的重复段 / 挂注释 / **源文被编辑过** / **段被拆分过** / **段被合并过** / **跨段落合并过**。来源：[WFP User Guide 11.1 (PDF)](https://www.wordfast.com/WFP/11.1/assets/pdf/WFP_User_Guide_11.1.0.pdf)（“Segment status” 表）、[TXLF Editor View (5.3)](https://www.wordfast.com/WFP/5.3/c1730832.html)。编辑源文会在 Status 列挂 Edit Source 图标，且 Revert Source 后**图标与历史保留**。来源：[WFP User Guide 11.1 (PDF)](https://www.wordfast.com/WFP/11.1/assets/pdf/WFP_User_Guide_11.1.0.pdf)。

**Transcheck（其 QA 品牌）**：

- 三种运行面：**Transcheck segments while translating**（提交段时即时警告，可选 Go back to fix / Continue）；**Transcheck All**（Review tab，全文件扫描，错误段 Status 列挂错误图标 + Transcheck tab 逐条看，括号里给段内错误计数）；**Transcheck Report**（项目级批处理报告，**Source/Target Consistency 只能在 Report 里跑**）。来源：[WFP Essentials QRG 11.1 (PDF)](https://www.wordfast.com/WFP/11.1/assets/pdf/WFP_Essentials_QRG_11.1.0.pdf)、[Configure Transcheck (5.6)](https://www.wordfast.com/WFP/5.6/t1960501.html)。
- 检查目录分三类：**Segment Content Checks**（大小写、源/目标一致性、拷源、空目标、注释、数字差异、标点、重复词——子词重复用正则找、段长、Smart Punctuation 按目标语标点规范、标签、空白）；**Segment Status Checks**（**Edited Context Match / Edited Exact Match**——上下文/精确匹配被改过、Edited Source、Unconfirmed、**Unedited Exact Match / Unedited Fuzzy Match**——未编辑即提交）；**Reference Checks**（**Blocklist 黑名单**、Forbidden Character、Mistranslated Text（误译词对照表）、Spelling、Terminology、Untranslatable Text、**Untranslated MT**——目标里残留未译 MT 内容）。来源：[WFP User Guide 11.1 (PDF)](https://www.wordfast.com/WFP/11.1/assets/pdf/WFP_User_Guide_11.1.0.pdf)。
- 标签检查细分：非格式标签缺失、源格式在目标缺失、目标多出格式；可 **Skip exact matches / Skip context matches**（对高信任匹配放行减噪）。来源：[Configure Transcheck (5.6)](https://www.wordfast.com/WFP/5.6/t1960501.html)。

**值得偷的独有想法**：① 状态列专记“**结构履历**”（拆过/合过/跨段合过/源改过）而不仅是工作流状态；② Verification 列与 Status 列分离（提交动作独立成列）；③ Transcheck 的 **Skip exact/context matches** 降噪开关；④ Blocklist（黑名单词表）与 Mistranslated Text 对照表作为独立参考资源。

---

## 15. 对比附录 D（简）：CafeTran Espresso 与 Déjà Vu X3

**CafeTran Espresso**（官方支持库 + 官方整理文档）：

- **Matchboard**：把 TM 段/片段、术语、MT、auto-assembling 结果聚合到一个可停靠面板，色码：蓝=TM、绿=术语、紫=MT、棕=auto-assembling/上下文匹配、粉=模糊匹配。来源：[CafeTran Espresso - Menu and Interface（官方文档集）](https://github.com/idimitriadis0/TheCafeTranFiles/blob/master/CafeTran%20Espresso%20-%202%20Menu%20and%20Interface.md)。
- **Auto-assembling**：用启用的资源“修补拼装”出建议译文；资源可设 Low/Medium/High 优先级或右键 Keep out of auto-assembling；可设自动插入阈值；**可用 auto-assembling 改写 MT 结果**（用自家 TM/术语替换 MT 里的词）。来源：[CafeTran Espresso - Preferences（官方文档集）](https://github.com/idimitriadis0/TheCafeTranFiles/blob/master/CafeTran%20Espresso%20-%201%20Preferences.md)、[Menu and Interface](https://github.com/idimitriadis0/TheCafeTranFiles/blob/master/CafeTran%20Espresso%20-%202%20Menu%20and%20Interface.md)。
- **QA=过滤器**：QA 菜单逐项跑（如 Tags check），问题段**直接以过滤形式呈现在网格里**，改完点 Filter 回全量视图。来源：[Check Errors（CafeTran 官方支持库）](https://cafetran.freshdesk.com/support/solutions/articles/6000112731-check-errors)。
- 匹配分类官方口径：Context/exact segment matches、Fuzzy segment matches、Exact fragment matches、Fragment hits。来源：[Segment and Fragment Matching](https://cafetran.freshdesk.com/support/solutions/articles/6000088050-segment-and-fragment-matching)。

**Déjà Vu X3**（Atril 官方）：

- **DeepMiner**：跨库统计抽取子段并**修复模糊匹配**；**Assemble**：无整段命中时从 TM/TB/Lexicon 拼装译文（可选把未知词按源文填入）；**AutoWrite**：边打字边从库里拼候选。来源：[Déjà Vu X3 Professional（Atril）](https://atril.com/product/deja-vu-x3-professional/)、[Key Features（Atril）](https://atril.com/key-features/)、[Using Déjà Vu X3 - A Tutorial（Atril helpdesk）](https://helpdesk.atril.com/hc/en-us/articles/205540701-Using-D%C3%A9j%C3%A0-Vu-X3-A-Tutorial)。
- **Lexicon（独有概念）**：为项目建立全部源语词/短语的**频次索引**，译者只译相关项、删除噪声项，剩下的成为**项目级最高优先词表**，压过 TB 中的多义翻译。来源：[What is the Lexicon（Atril helpdesk）](https://helpdesk.atril.com/hc/en-us/articles/208457905-What-is-the-Lexicon)。

---

## 16. Translunar 借鉴 / 放弃清单（steal vs skip）

前提（仓库现状）：Translunar 是本地优先桌面 CAT；QA 现状为确定性规则集（完整性/数字/标签/标点/空白/重复/长度/术语/一致性/自定义正则，`crates/tl-qa`），数字检查是**源目数字 token 集合相等**、占位符检查是**token 计数平衡**（`crates/tl-domain` 的 `number_mismatch`/`placeholder_mismatch`）；编辑器已采用 Trados 式生命周期（打字即草稿、Ctrl+Enter 确认）。

### 16.1 借鉴（steal）——按投入产出排序

**S1. 状态盒 = 图标+颜色+百分比三编码（低成本，高回报）**
memoQ 的勾/双勾/加号/铅笔/挂锁/闪电 + 常驻匹配率百分比（§2）。Translunar 当前草稿徽章是文字型；引入“非颜色冗余符号 + 段级来源百分比（TM/MT/拼装）”可一次解决可访问性与“来历可见”两个 PRD 诉求。依据：[The Grid](https://docs.memoq.com/current/en/Workspace/the-grid.html)。

**S2. warning/error 双级 + Severity 重映射 + 三粒度忽略（QA 交互核心）**
错误阻断导出、警告可忽略；每条检查可在配置里改级；忽略有 Ignore one / Ignore all of this kind / Ignore all for this row 三粒度，且忽略态有专用图标并可折叠（§6）。这是把 QA 从“报表”变成“工作流”的关键。依据：[Edit QA settings](https://docs.memoq.com/current/en/Workspace/edit-qa-settings.html)、[Resolve errors and warnings](https://docs.memoq.com/current/en/Workspace/resolve-errors-and-warnings-tab.html)。

**S3. Resolve errors 式批处理面板：code 列 + 顶部可编辑段 + Apply Auto correction**
问题列表带稳定 code（可按类清）、当前段就地可编辑、机器给 Correction 一键套用（§6.4）。Translunar 的 QA 报告已有 fingerprint 概念，缺“就地修复 + 自动修复建议”闭环。依据：[Resolve errors and warnings](https://docs.memoq.com/current/en/Workspace/resolve-errors-and-warnings-tab.html)。

**S4. 标签 chips 的四档显示密度 + F9 系列键盘流**
Short/Medium/Filtered/Long 四档 + F9 复制下一序列 + 选中文本按 F9 环绕配对 + Alt+F6 整序 + Ctrl+F8 清空（§5.2）。比“一种渲染打天下”更能同时服务轻标签 DOCX 与重标签 XML/HTML。依据：[The Grid (10.3)](https://docs.memoq.com/10-3/en/Places/the-grid.html)。

**S5. 临时过滤 / 查找 / 命名视图三层分离**
特别是 Views 的“静态、命名、可再开、引用不拷贝”语义与按状态/警告/评论/标签属性（`tag>attr>value`）建切片（§7）。本地单人场景同样成立（“今天只清未确认+有警告的段”）。依据：[Views (concepts)](https://docs.memoq.com/12-0/en/Concepts/concepts-views.html)、[Create view…](https://docs.memoq.com/current/en/Workspace/create-view-filtering-and-sorting.html)。

**S6. 行为型 QA（Phrase/Wordfast 独有，memoQ 没有）**
“Unedited fuzzy match 未改就确认”“Edited exact/context match 高信任匹配被改动”“目标残留未译 MT”——审计**过程**而非文本。本地单机同样能实现（我们已有 revision 历史）。依据：[Phrase QA 列表](https://support.phrase.com/hc/en-us/articles/5709703799324-Quality-Assurance-QA-TMS)、[WFP User Guide 11.1](https://www.wordfast.com/WFP/11.1/assets/pdf/WFP_User_Guide_11.1.0.pdf)。

**S7. OmegaT 三重匹配百分比 + memoQ lamps（可解释匹配）**
向译员解释“分数为什么低/差异在哪一类（空格/标点/大小写/格式/标签/数字）/机器是否已代修”。lamps 的“彩色=要人修，灰色=已自动修”语义可直接映射到 Translunar 的 TM 面板。依据：[OmegaT Panes](https://omegat.sourceforge.io/manual-latest/en/chapter.panes.html)、[Translation results pane](https://docs.memoq.com/current/en/Workspace/translation-results-list.html)。

**S8. Ctrl+Shift+Enter“确认但不写 TM”**
一个快捷键解决“占位译文别污染 TM”的真实痛点；Wordfast 甚至有段级 do-not-write-to-TM 状态图标。依据：[The Grid (10.3)](https://docs.memoq.com/10-3/en/Places/the-grid.html)、[WFP User Guide 11.1](https://www.wordfast.com/WFP/11.1/assets/pdf/WFP_User_Guide_11.1.0.pdf)。

**S9. Concordance 的 KWIC + Guess translation（绿色置信度渐变）+ 就地编辑 TM 条目**
本地 TM 越大越需要；“猜译文”不依赖服务器。依据：[Concordance](https://docs.memoq.com/current/en/Workspace/concordance.html)。

**S10. 结构履历图标（Wordfast）**
拆过/合过/源改过在状态列留痕，回溯段来源时省一次 diff。依据：[WFP User Guide 11.1](https://www.wordfast.com/WFP/11.1/assets/pdf/WFP_User_Guide_11.1.0.pdf)。

**S11. OmegaT 式“术语=目录里的纯文本文件，热加载”作为补充入口**
与 SQLite 术语库并存：监听一个 `glossary/` 目录做只读补充源，符合本地优先直觉。依据：[OmegaT Panes](https://omegat.sourceforge.io/manual-latest/en/chapter.panes.html)。

### 16.2 放弃（skip）——及理由

| 项 | 理由 |
| --- | --- |
| **Muses（统计预测训练）** | 需要训练管线与大语料才有收益（官方最低词频阈值 5–25 次）；Translunar 的 AI 辅助已由 LLM 通道承担。依据：[Train Muse](https://docs.memoq.com/current/en/Workspace/train-muse.html) |
| **LiveDocs 全家桶（ActiveTM/LiveAlign/Library）** | 是 memoQ 的第二套 TM 基建；Translunar 只需要“对齐导入生成 TM”这一条路径，不需要平行的 corpus 资源类型 |
| **Moderated TB / Qterm 讨论区 / 服务器资源 pin/publish** | 全部是服务器协作叙事，违反“本地优先、无伪协作”红线。依据：[Term bases (concepts)](https://docs.memoq.com/current/en/Concepts/concepts-term-bases.html)、[Translation results pane](https://docs.memoq.com/current/en/Workspace/translation-results-list.html) |
| **LQA 模型 / R1/R2 双审角色链 / slices / Deliver 工作流** | 多人流程；单机场景保留单一 Confirmed + Rejected 即可（Shift+Enter 驳回语义可留作自审标记） |
| **像素级长度检查** | 依赖字体测量且主要服务软件本地化字幕/UI 约束场景，投入产出差；保留字符版长度上限即可。依据：[Edit QA settings](https://docs.memoq.com/current/en/Workspace/edit-qa-settings.html) |
| **20 种资源的 Resource console 面面俱到** | Translunar 资源类型少（TM/TB/QA 配置/分段规则），一个轻量资源页足够；但**“默认不可改、克隆再编辑”的资源惯例值得保留** |
| **fragment assembly 的“未覆盖词填源语”** | memoQ 自己都承认结果里残留源语（§9）；在 LLM 可用的时代，拼装的坑位填充交给 AI 通道更干净。MatchPatch 的**封顶 94% 罚分**思想保留 |
| **双 Web 编辑器 / webtrans** | 无服务器产品无此问题 |
| **Insert all tags（Alt+F8）** | 官方原话“不推荐使用”；不做一次性倒标签，只做 F9 逐序列与整序（Arrange） |

### 16.3 直接超越现有“数字+占位符 QA”的落地建议（按官方证据映射）

1. **数字：从“集合相等”升级为“locale 感知 + 分类告警”**——区分 missing/extra/format-mismatch/grouping（memoQ 3061–3069 六种数字码），支持按语言配置小数点/千分位/负号，全角数字检测（3065 对 CJK 直接相关）。依据：[Edit QA settings – Numbers](https://docs.memoq.com/current/en/Workspace/edit-qa-settings.html)、[QA warnings 表](https://docs.memoq.com/current/en/Concepts/concepts-quality-assurance-qa-warnings.html)。
2. **占位符/标签：从“计数平衡”升级为“结构校验”**——well-formedness、配对交叠（2003）、顺序变化（2016）、标签前后空格（3190–3197）。依据同上。
3. **字母数字码 + 度量 + 日期三类实体检查**（3301–3309）——比裸数字检查更贴近专利/技术文档场景。依据：[QA warnings 表](https://docs.memoq.com/current/en/Concepts/concepts-quality-assurance-qa-warnings.html)。
4. **行为型检查**（S6）与 **TM 一致性检查**（best/most-recent exact match 与译文不一致，memoQ 3151–3153）。依据：[Edit QA settings – Consistency](https://docs.memoq.com/current/en/Workspace/edit-qa-settings.html)。
5. **每条 finding 携带 code + 参数化文案 + 可选 Correction**，UI 端给 Apply auto correction。依据：[Resolve errors and warnings](https://docs.memoq.com/current/en/Workspace/resolve-errors-and-warnings-tab.html)。

---

## 17. 已读页面清单

### memoQ（docs.memoq.com，除注明外均为 /current = memoQ 12.4）

1. https://docs.memoq.com/current/en/Welcome/welcome-memoq-docs.html
2. https://docs.memoq.com/current/en/Workspace/translation-editor.html
3. https://docs.memoq.com/current/en/Workspace/the-grid.html
4. https://docs.memoq.com/10-3/en/Places/the-grid.html （10.3 版，交互细节最全）
5. https://docs.memoq.com/current/en/Workspace/translation-results-list.html
6. https://docs.memoq.com/current/en/Concepts/concepts-match-rates-from-translation-m.html
7. https://docs.memoq.com/current/en/Concepts/concepts-translation-memories.html
8. https://docs.memoq.com/current/en/Workspace/edit-qa-settings.html
9. https://docs.memoq.com/current/en/Workspace/resconsole-qasettings.html
10. https://docs.memoq.com/current/en/Concepts/concepts-quality-assurance-qa-warnings.html
11. https://docs.memoq.com/current/en/Workspace/resolve-errors-and-warnings-tab.html
12. https://docs.memoq.com/12-0/en/Workspace/resolve-errors-and-warnings-scope.html
13. https://docs.memoq.com/current/en/Workspace/specify-number-format-for-language.html
14. https://docs.memoq.com/current/en/Workspace/create-view-filtering-and-sorting.html
15. https://docs.memoq.com/12-0/en/Concepts/concepts-views.html
16. https://docs.memoq.com/current/en/Workspace/project-home-translations-pm.html
17. https://docs.memoq.com/12-2/en/Workspace/project-home-translations-tpro.html
18. https://docs.memoq.com/current/en/Workspace/ribbons-documents.html
19. https://docs.memoq.com/current/en/Workspace/resource-console.html
20. https://docs.memoq.com/current/en/Workspace/memoq-menu-resources.html
21. https://docs.memoq.com/12-2/en/Workspace/resconsole-nontrans.html
22. https://docs.memoq.com/current/en/Concepts/concepts-livedocs.html
23. https://docs.memoq.com/current/en/Concepts/concepts-alignment.html
24. https://docs.memoq.com/current/en/Workspace/alignment-editor.html
25. https://docs.memoq.com/current/en/Workspace/livedocs-monolingual-document-.html
26. https://docs.memoq.com/current/en/Workspace/memoq-online-project-livedocs.html
27. https://docs.memoq.com/current/en/Workspace/edit-corpus-settings.html
28. https://docs.memoq.com/current/en/Concepts/concepts-term-bases.html
29. https://docs.memoq.com/current/en/Concepts/concepts-muses.html
30. https://docs.memoq.com/current/en/Workspace/create-muse.html
31. https://docs.memoq.com/current/en/Workspace/train-muse.html
32. https://docs.memoq.com/current/en/Workspace/predictive-typing.html
33. https://docs.memoq.com/current/en/Workspace/concordance.html
34. https://docs.memoq.com/current/en/Workspace/customize-memoq-shortcuts.html
35. https://docs.memoq.com/current/en/Workspace/options-keyboard-shortcuts.html
36. https://docs.memoq.com/current/en/memoQWeb-help/mqw-translation-editor.html （webtrans）
37. https://docs.memoq.com/current/en/memoQWeb-help/mqw-translation-results-settings.html
38. https://docs.memoq.com/current/en/webNext-help/memoQeditor-translating.html （新 memoQ editor）
39. https://support.memoq.com/hc/en-us/articles/6162041844369-Status-column-in-the-translation-grid （Help Center）
40. https://support.memoq.com/hc/en-us/articles/360010266600-Disabling-or-configuring-predictive-typing-in-memoQ （Help Center）

### Phrase

41. https://support.phrase.com/hc/en-us/articles/5709683847964-CAT-Editor-TMS
42. https://support.phrase.com/hc/en-us/articles/5709683890204-CAT-Web-Editor-TMS
43. https://support.phrase.com/hc/en-us/articles/5709683926812-CAT-Pane-TMS
44. https://support.phrase.com/hc/en-us/articles/5709694857372-Quality-Assurance-Pane-QA-TMS
45. https://support.phrase.com/hc/en-us/articles/5709703799324-Quality-Assurance-QA-TMS
46. https://support.phrase.com/hc/en-us/articles/5709678012828-Segments-TMS
47. https://support.phrase.com/hc/en-us/articles/5709720416796-Filtering-TMS
48. https://phrase.com/wp-content/uploads/2023/11/phrase-tms-quick-start-guide-linguists.pdf

### OmegaT

49. https://omegat.sourceforge.io/manual-latest/en/chapter.panes.html
50. https://omegat.sourceforge.io/manual-latest/en/chapter.instant.start.guide.html
51. https://omegat.sourceforge.io/manual-latest/en/chapter.menus.html

### Wordfast

52. https://www.wordfast.com/WFP/11.1/assets/pdf/WFP_User_Guide_11.1.0.pdf
53. https://www.wordfast.com/WFP/11.1/assets/pdf/WFP_Essentials_QRG_11.1.0.pdf
54. https://www.wordfast.com/WFP/5.3/c1730832.html
55. https://www.wordfast.com/WFP/5.6/t1960501.html

### CafeTran / Déjà Vu

56. https://cafetran.freshdesk.com/support/solutions/articles/6000112731-check-errors
57. https://cafetran.freshdesk.com/support/solutions/articles/6000088050-segment-and-fragment-matching
58. https://cafetran.freshdesk.com/support/solutions/articles/6000108186-first-project-with-resources
59. https://github.com/idimitriadis0/TheCafeTranFiles/blob/master/CafeTran%20Espresso%20-%201%20Preferences.md
60. https://github.com/idimitriadis0/TheCafeTranFiles/blob/master/CafeTran%20Espresso%20-%202%20Menu%20and%20Interface.md
61. https://atril.com/product/deja-vu-x3-professional/
62. https://atril.com/key-features/
63. https://helpdesk.atril.com/hc/en-us/articles/208457905-What-is-the-Lexicon
64. https://helpdesk.atril.com/hc/en-us/articles/205540701-Using-D%C3%A9j%C3%A0-Vu-X3-A-Tutorial

### 社区（仅观点佐证）

65. https://www.proz.com/forum/cat_tools_technical_help/362011-a_comparative_study_of_user_perception_and_friendliness_of_sdl_trados_memoq_and_phrase_in_translat.html
66. https://www.proz.com/forum/memoq_support/236008-memoq_vs_trados.html

### 官方截图存档（`/opt/cursor/artifacts/research-memoq/`，均下载自 docs.memoq.com/current/en/Images/）

| 文件 | 内容 |
| --- | --- |
| `translation-editor.png` | 编辑器全貌：功能区、过滤条、网格、状态盒、Translation results、View pane、状态栏 |
| `translation_results_pane.png` | 结果面板三段式：色码编号命中（红/蓝/黑/橙）、track-changes 对比框、Pro/Dom/Cli/Sub 元数据、lamps |
| `statuses.png` | 状态盒：百分比 + 勾/叉 + 闪电 + 评论气泡叠加 |
| `filtering_and_sorting.png` / `filtering-options.png` | 网格顶部过滤排序条与过滤选项弹窗 |
| `the-grid-autopick.png` | 标签 chips（rpr/tab/fld/instr/hlnk）与 AutoPick 菜单 |
| `the-grid-predictive.png` | 预测输入浮层 |
| `inline-tags.png` / `inline-tag-formatting.png` / `inline-tag-formatting-target.png` | 行内标签 chip 形态与目标侧复制 |
| `example-error.png` / `segment-with-warning.png` / `ignored-warning.png` / `icon_error.png` / `icon_warning.png` | 错误/警告/已忽略警告图标 |
| `resolve-errors-and-warnings-tab.png` | Resolve errors and warnings 批处理 tab |
| `match-patch-new.png` / `fragass_example4.png` | MatchPatch 与 fragment assembly 官方示例 |
| `icon_lamps.png` | 六盏差异指示灯 |
| `horizontal-view.png` | 活动行横排视图 |
| `edit-ribbon-tag-commands-all.png` | Edit 功能区标签命令组 |
| `translation-editor-status-bar.png` / `translation-editor-view-pane.png` / `translation-editor-segment.png` / `translation-results.png` / `translation-editor-grid.png` | 状态栏 / 预览窗格 / 段特写 / 结果列表 / 网格特写 |

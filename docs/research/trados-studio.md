# Trados Studio 逆向研究：UI、段落生命周期与引擎能力

> 面向 Translunar 工作台重构的证据型参考。以 RWS 官方文档树（Trados Studio 2026 Release，publication `1279521`）为主要来源，逐页爬取并核对；2026 文档树缺失的参考主题（如 Segment Status column、TM matches）补引 Trados Studio 2024 SR1 / 2022 官方文档。每条结论均附来源 URL。
>
> 说明：`docs.rws.com` 的 zh-CN 路径下 2026 文档尚未翻译，页面回退显示英文原文（页面提示 "该内容不提供所选语言版本"），因此本文引用 zh-CN URL、正文引述官方英文原名。
>
> 本次共读取 2026 文档树约 440+ 个主题页（见文末附录），官方截图存档于 `/opt/cursor/artifacts/research-trados/`。

---

## 1. 工作台信息架构（Workbench IA）

### 1.1 顶层结构：Ribbon 而非菜单

Trados Studio 的主导航是 **ribbon**（功能区），不是传统菜单栏。官方对 ribbon 的定义："The ribbon is the navigation bar displayed across the main window… All the commands are organized in logical groups, which are joined together under tabs. Each tab relates to a type of activity, such as reviewing or translating."（[The ribbon](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/the-ribbon-338310)）

官方拆解的 ribbon 组成（同页，附官方标注截图 `ribbon-557193.png`）：

- **Quick Access Toolbar**（快速访问工具栏）：ribbon 之上的迷你工具栏，默认含 **Save**、**Undo/Redo**、**View Target**，可自定义（[The Quick Access Toolbar](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/the-quick-access-toolbar-338564)）。
- **Tabs**（选项卡）／**Groups**（命令组）／**Dialog launcher**（组右下角的高级设置入口）／**Commands**。
- **Smart Help**（AI 问答）、**Notifications area**、**Ribbon display options**、**Cloud Sign In**（2026 新增元素，[The ribbon](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/the-ribbon-338310)）。

关键机制——**上下文敏感 ribbon**：

- **Home、View、Add-Ins、Help** 是常驻 tab；但组内容随当前视图变化（Projects 视图下 Home 显示项目命令，Reports 视图下显示报表命令）。
- **Review 和 Advanced 是 Editor 视图专属的上下文 tab**，只在 Editor 视图出现："The Review and Advanced tabs are contextual tabs and appear on the ribbon only when you are in the Editor view."
- ribbon 不可移除，只可最小化（Ctrl+F1）。

（以上均出自 [The ribbon](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/the-ribbon-338310)）

**File menu** 是 ribbon 第一个 tab、所有视图可用，收纳"对文件/项目整体的操作与全局设置"（Open/Save/Save As/Save All、Print & View、Setup、Options 等），与其余 tab"操作文件内容"区分（[The File menu](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/the-file-menu-490688)）。

**Tell Me 搜索框**：按官方名为 "Tell Me box"，用于按关键词查找命令与帮助（[Searching for features and commands in the Tell Me box](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/searching-for-features-and-commands-in-the-tell-me-box-587718)）。

### 1.2 视图（Views）：专用工作区

官方定义："Views in Trados Studio are specialized workspaces designed for specific tasks."（[Views in Trados Studio](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/views-in-trados-studio-365276)）2026 版视图清单（同页）：

| 视图 | 官方职责描述（摘要） |
| --- | --- |
| **Welcome** | 快捷入口：新建项目、翻译单文档、打开包、视频/帮助、快捷键列表 |
| **Manager** | 多项目集中管理（2026 重点新视图） |
| **Projects** | 创建与跟踪单个项目、查看项目/文件状态 |
| **Files** | 打开文件翻译/审校、批处理、字数与进度 |
| **Reports** | 分析报表（喂给计划与报价流程） |
| **Editor** | 翻译与审校："The translation environment is bilingual; source language segments and the segment translations are displayed side-by-side in a single editor screen. Text is displayed in WYSIWYG format…" |
| **Translation Memories** | TM 创建与维护 |
| **Termbases**（2026） | 术语库管理（官方 Editor 截图左下角视图列表可见） |

**Navigation pane**（左侧导航窗格）内容随视图变化；在 Editor 视图中显示所有打开的文件树、可展开文档结构（页眉/表格等组件），点击即滚动定位；多文件时每个文件一个编辑窗口（[The navigation pane](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/the-navigation-pane-365284)、[The Editor view](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/the-editor-view-347941)）。

### 1.3 Editor 视图布局（官方十要素）

官方 [The Editor view](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/the-editor-view-347941) 列出的组成（配官方标注截图，存档为 `editor-view-549248.png`）：

1. Ribbon tabs；2. Ribbon groups；3. **Translation resource windows**（翻译结果、Concordance、评论、消息、术语识别、术语搜索等资源窗口）；4. **Termbase Viewer** window；5. Navigation pane（打开文档列表）；6. View navigation buttons（左下角视图切换按钮）；7. **Editor**（主编辑区网格）；8. **Status bar**："Displays information about the active document, segment, and display filter."；9. **Advanced Display Filter** window；10. **Preview** window（"Displays a real-time preview of the target document as you work"）。

从官方截图（1075×704，2026 版）还可确认：

- 编辑网格列序：**段号列 → 源文列 → 段状态列（Segment Status column）→ 译文列 → 文档结构列（DSI）**。状态列中出现 `CM`、`91%`、`98%`、`AI` 等来源/分数徽标；文档结构列显示 `H`、`H+`、`LI`、`FN`、`P` 等结构码。
- 上方资源窗口区以标签页组织：Translation Results、Fragment Matches、Concordance Search、Comments (0)、TQAs (0)、Messages、Term Recognition、Termbase Search。
- 右缘竖排折叠标签：Preview、TQE、AI Assistant、Advanced Display Filter 2.0；左缘竖排：Termbase Viewer。
- 状态栏（右下）：当前过滤器名（"All segments"）、INS/OVR、三个进度百分比、字符数（"Chars: 14"）、段落计数（"0/1001"）。

编辑网格的列结构另有官方文字佐证（SDL 官方 Quick Start Guide《Translating and Reviewing Documents》）："The first column displays segment numbers… Between the source and target segment columns is the segment status column… To the right of the target language segments is the document structure column. It displays a code that tells you where in the original document the segment text appears. Hover over the code or click on the code…"（[Quick Start Guide PDF](http://www.uco.es/~lr1maalm/TradosTranslatingAndReviewingDocuments.pdf)）

### 1.4 Editor 视图窗口清单与默认停靠

官方窗口全集（[The Editor view windows，Studio 2022 文档](https://docs.rws.com/en-US/trados-studio-2022-980998/the-editor-view-windows-340578)；2026 文档树已将该总表拆散到各窗口主题，窗口本身仍全部存在，见 [The Editor view](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/the-editor-view-347941) 与官方截图）：

| 窗口 | 官方一句话契约 |
| --- | --- |
| **Translation Results** | "displays the results of translation memory lookups and automated translation lookups for the active source segment. From here you can apply one of the results to the current segment." |
| **Fragment Matches** | "displays the results of the fragment matching, when available."（upLIFT 片段召回） |
| **Concordance Search** | 显示相关搜索结果；可把结果文本插入译文；可设"TM 无结果时自动做 concordance" |
| **Comments** | 所有打开文件的评论：查看/编辑/新增 |
| **Messages** | 所有打开文件的验证错误消息 |
| **TQAs** | 打开文件的翻译质量评估条目：查看/编辑/删除 |
| **Confirmation Statistics** | 当前文件全部段落的状态统计 |
| **Term Recognition** | 当前源文段在 MultiTerm 术语库中的命中列表 |
| **Termbase Search** | 手动术语搜索及结果 |
| **Termbase Viewer** | 浏览术语库、查看/新增/编辑术语条目（默认左侧停靠） |
| **Preview** | WYSIWYG 预览，"updated in real time. This means that as you type, the changes you make are immediately visible" |

默认布局（同上 340578 页）："By default, the Translation Results, Concordance Search, Comments, TQAs and Messages windows appear grouped together at the top of the Editor view. However, **if you open a file for review, they appear at the bottom of the view as tabs**. The Preview window appears in the bottom right-hand corner of the view."——即翻译模式资源区在上、审校模式资源区在下，这是 Studio 按打开模式切换布局的明确证据。

**按打开模式切换的三套配置**：文件可以 **Open for Translation / Open for Review / Open for Sign-Off** 三种方式打开；审校/签发模式使用官方所称 **"Review configuration" / "Sign-off configuration"**——布局切换（Comments 窗口自动出现在底部）、**Track Changes 自动开启**、Home tab 的 **File Actions / Segment Actions 组只显示该阶段可用的状态命令**（[Reviewing translated files](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/reviewing-translated-files-353610)）。

**窗口系统**：Projects/Files/Editor/Translation Memories 四个视图的窗口均可重排；每个窗口右上角三个按钮 **Menu（Floating / Auto Hide）**、**Auto Hide**（图钉）、**Close**；关闭后从 **View** tab 恢复（[Windows and window navigation](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/windows-and-window-navigation-338273)）。

---

## 2. 段落生命周期（核心）

### 2.1 段状态全集（confirmation level）

官方状态表（[Translation statuses](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/translation-statuses-344738)、[Changing segment statuses](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/changing-segment-statuses-488363)）：

| 状态（官方名） | 语义 |
| --- | --- |
| **Not Translated** | 目标段从未被翻译或编辑 |
| **Draft** | "may have been edited but it is not yet considered fully translated, **or a translation memory match was applied to the segment but the segment text has been edited since then**" |
| **Translated** | "The translation is confirmed as complete." |
| **Translation Rejected** | 审校人拒绝 |
| **Translation Approved** | 审校人通过 |
| **Sign-off Rejected** | 签发阶段拒绝 |
| **Signed Off** | 签发通过，"ready to be released to the customer" |

锁定（Locked）是叠加在状态之上的独立标志位，状态列单独显示锁图标（[Segment Status column，2024 SR1](https://docs.rws.com/en-US/trados-studio-2024-sr1-1187677/segment-status-column-340490)）。

**文档级状态由段状态自动汇总**（[Translation statuses](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/translation-statuses-344738)）：Unspecified（全部 Not Translated）→ In Translation（至少一段 Draft）→ Translated（全部 Translated）→ In Review（无 Not Translated/Draft 且至少一段 Translated）→ …按此规则逐级判定。

### 2.2 确认（Confirm）动作与快捷键（官方原文）

确认按"文件打开模式"落到不同状态（[Confirming translations](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/confirming-translations-352560)）：

- 打开供翻译 → **Confirm (Translated)**
- 打开供审校 → **Confirm (Translation Approved)**
- 打开供签发 → **Confirm (Signed Off)**

入口：按 **Ctrl+Enter**，或 **Editor 视图 → Home tab → Segment Actions 组**选上述命令（同页）。批量改状态：Ctrl+点击段号列多选行 → 右键 → **Change Segment Status > Translated/Translation Approved/Signed Off**（同页）；单段也可右键 **Change Segment Status** 直接改（[Translation statuses](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/translation-statuses-344738)）。

**Confirm 三变体及快捷键**（桌面版 Home tab > Segments/Segment Actions 组；官方 Trados Online Editor 快捷键表与 2024 文档同文）：

| 变体（官方名） | 快捷键 |
| --- | --- |
| **Confirm and Move to Next Unconfirmed Segment** | **Ctrl+Enter** |
| **Confirm and Move to Next Segment**（无论下一段状态） | **Ctrl+Alt+Enter** |
| **Confirm, but do not Move to Next Segment** | **Ctrl+Alt+Shift+Enter** |

（来源：[Confirming translated text，2024](https://docs.rws.com/en-US/trados-studio-2024-1145319/confirming-translated-text-353400)、[Shortcuts in Online Editor（2026 文档树内官方快捷键表）](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/shortcuts-in-online-editor-515739)）

**Ctrl+Enter 的完整后置动作链**（官方"Post-confirmation automatic actions"，[Confirming translations](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/confirming-translations-352560)）：

1. 状态列图标更新为 Translated/Translation Approved/Signed Off（依打开模式）。
2. **"The translation is automatically added to the TM."** 若含 track changes 按"已接受"入库；可在 Options 改为手动 TM 更新。
3. **段级验证（Segment verification）执行**，错误进 **Messages** 窗口。
4. **Preview** 窗口可见新译文。
5. **"Trados Studio automatically places your cursor in the next unconfirmed segment, skipping all locked segments."**（跳到下一未确认段，跳过锁定段。）
6. （若开启）触发自动传播（Auto-propagation，见 2.6）。

补充（同页）：默认 **"when the system applies a 100% TM match to a segment, the segment is automatically confirmed."** 若确认时更新的 TM 与命中 TM 不同，也会写入该 TM——均为 Options 可控。

### 2.3 打字即 Draft（unconfirm-on-type）：官方真相

我们已采用的"输入即草稿自动保存、Ctrl+Enter 确认 + 写 TM + 跳下一未确认段"与官方一致：

- "To unconfirm a translation in the Editor, **type in the target segment**. The Confirmed (Translated) status of the current segment **changes to Draft** and the draft icon is displayed in the segment status column."（[Unconfirming translated text](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/unconfirming-translated-text-353406)）
- "If you want to edit a segment that is already confirmed, click inside the target segment and make changes. The segment status automatically changes to **Draft**."（[Translating files using Editor resources](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/translating-files-using-editor-resources-353380)）
- 清空目标段 → 系统自动置 **Draft**（[Changing segment statuses](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/changing-segment-statuses-488363)："When you clear a target segment, the system automatically marks the segment as having Draft status."）
- 编辑带 TM 匹配的段落时，"the background color of the percentage match figure disappears to indicate that there was a percentage match with the TM which has been changed."（[Translating files using Editor resources](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/translating-files-using-editor-resources-353380)）——即：匹配分数徽标保留、底色消失，标记"此译文源自匹配但已被改动"。
- **Copy Source to Target** 覆盖已确认段时同样把状态打回 **Draft**；而 **Copy All Source to Target** 只填充**空的、Draft/Not Translated、未锁定**的段（[Copying source content to target segments](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/copying-source-content-to-target-segments-505211)）。

**审校侧快捷键**（官方 Quick Start Guide）：审校模式 **Ctrl+Enter** = Confirm (Translation Approved)；**Ctrl+Shift+Enter** = Reject (Translation Rejected)（[Translating and Reviewing Documents PDF](http://www.uco.es/~lr1maalm/TradosTranslatingAndReviewingDocuments.pdf)）。

### 2.4 进入段落时发生什么（行激活契约）

- "When a row becomes the active row, **a lookup is performed in the translation memory (TM) and the termbase**. You can only edit the target segment for an active row."（[Editing target segments 子主题 "Activating rows for translation"](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/editing-target-segments-354004)）
- "By default Trados Studio automatically performs a TM lookup whenever you place the cursor in an untranslated segment… **The best TM match is automatically placed in the target segment** and, if the match is a 100% match, the translation is automatically confirmed."（[Translating files using Editor resources](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/translating-files-using-editor-resources-353380)）
- TM 无命中时（若接了 MT）："the system resorts to the MT suggestions for the segment. **The MT suggestion is automatically inserted into the segment** and you can then further edit"（[Translating with Machine Translation (MT)](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/translating-with-machine-translation-mt--354763)）。

这一切由 **File > Options > Editor > Automation** 精确开关（[官方设置参考](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/file-options-editor-automation-344856)），选项原名：

| 选项（Translation Memory 组） | 说明 |
| --- | --- |
| **Perform lookup when active segment changes** | 光标进新段即查 TM |
| **Apply best match after successful lookup** | 自动填入最佳匹配；**"not applied to segments that have been confirmed or that you have edited"**（不覆盖已确认/已编辑段） |
| **Apply automated translation when no TM match is found** | TM 无命中自动插入 MT（**默认开**） |
| **Perform automated translation lookup on confirmed segments** | 已确认段也查 MT（默认关） |
| **Turn off Track Changes when applying TM matches** | 应用 TM 时不记修订 |
| **Copy source when no match is found** | 无匹配时拷源文 |
| **Confirm segment after applying an exact match** | 应用 exact/context match 后自动确认 |
| **Apply better match if found in TM after merging segments** | 合并段后自动应用更优匹配（默认开） |
| **Enable LookAhead** | 预取后续段的 TM 结果（长句实时响应） |

| 选项（After Confirming Segments Manually 组） | 说明 |
| --- | --- |
| **Update translation memory** | **"adds the segment translation to the TM when the translator confirms a translation or when a reviewer approves a translation"** |
| **Enable verification of segment** | 确认时段级验证 |

### 2.5 TM 写入时机（精确规则）

1. **交互式写入 = 确认时**："Confirmed translations are added to the translation memory automatically."（[Confirming translated text，2024](https://docs.rws.com/en-US/trados-studio-2024-1145319/confirming-translated-text-353400)）由 `Editor > Automation > Update translation memory` 控制，译员确认或审校通过均写（[File > Options > Editor > Automation](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/file-options-editor-automation-344856)）。打字、失焦、跳段**都不写 TM**——写入是确认动作的副作用。
2. **项目 TM 与主 TM 分层**：使用项目 TM 时，确认写入项目 TM 而非主 TM（Quick Start Guide："If you are using a project translation memory, the translation is added to the project translation memory and not the main translation memory."，[PDF](http://www.uco.es/~lr1maalm/TradosTranslatingAndReviewingDocuments.pdf)）；主 TM 用批任务 **Update Main Translation Memories** 回灌（[Running batch tasks: Update Main Project Translation Memories](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/running-batch-tasks-update-main-project-translation-memories-359281)）。
3. **批量写入的状态门槛**：批任务 TM 更新默认只吸收 **Translated、Translation Approved、Signed Off** 三种状态的段；写入模式可选 Merge / Add new / Overwrite / Leave unchanged / Keep most recent（[Specifying batch settings: Translation Memory Updates](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/specifying-batch-settings-translation-memory-updates-548332)）。
4. 确认含 track changes 的段时按"修订已接受"的文本入 TM（[Confirming translations](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/confirming-translations-352560)）。

### 2.6 自动传播（Auto-propagation）

确认一段后，Studio 自动把译文传播到文件内相似源文段（[File > Options > Editor > Auto-propagation](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/file-options-editor-auto-propagation-344868)）：

- 默认 **Minimum match value = 100%**；默认只传播到**空目标段和未确认段**；可选覆盖已确认段（**Auto-propagate exact matches to confirmed segments**）。
- **Confirm segment after auto-propagating an exact match**：仅 100% 匹配的传播段可自动确认。
- 起点可选 **Next segment in document / First segment in document**；可设 **Prompt User** 弹 [Auto-propagate Confirmed Translation 对话框](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/auto-propagate-confirmed-translation-342130)（Yes / Yes to All / No / No to All，显示匹配度与目标段号）。
- 传播产生独立来源图标："The segment was translated and confirmed by auto-propagation."（[Segment Status column，2024 SR1](https://docs.rws.com/en-US/trados-studio-2024-sr1-1187677/segment-status-column-340490)）

### 2.7 锁定（Lock）

- 入口：选中行 → **Advanced tab → Lock Segment / Lock Segments**；解锁同理（[Locking segments](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/locking-segments-353468)、[Unlocking segments](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/unlocking-segments-520942)）。
- 确认跳段时**跳过锁定段**（[Confirming translated text](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/confirming-translated-text-353400)）。
- 默认 QA 检查**忽略锁定段**（可在 QA Checker > Segments to Exclude 关闭 "Exclude locked segments"）（[Locking segments](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/locking-segments-353468)）。
- 不能锁定含 TQA 的段；也不能合并锁定段（同页、[Merging segments](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/merging-segments-353417)）。
- PerfectMatch 段"automatically locked when opened for translation"（[Segment Status column，2024 SR1](https://docs.rws.com/en-US/trados-studio-2024-sr1-1187677/segment-status-column-340490)）。

### 2.8 拆分与合并（Split / Merge）

- **拆分**：光标放在**源文**要拆的位置 → 右键 → **Split Segments**；"If the segment has a translation, the entire content of the translation is placed in the first target segment."（[Splitting segments](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/splitting-segments-353412)）
- **合并**：Ctrl+点击段号列选多行 → 右键 → **Merge Segments**；已有译文会一并合并；**锁定段、含 TQA 的段不可合并**；跨段落合并需先开启选项（[Merging segments](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/merging-segments-353417)）。
- 两页均警告：改变切分会影响 TM 命中（TM 内切分与文件切分不再一致）。
- 合并后自动重查 TM 并应用更优匹配（默认开，[Automation 设置](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/file-options-editor-automation-344856)）；跨段落合并后空出的段可隐藏、其状态可指定（同页 Table 3）。

### 2.9 持久化模型：确认 ≠ 保存文件

Studio 的确认/TM 写入与**文档文件落盘是两回事**：

- 手动保存（**Ctrl+S** / QAT 的 Save）只保存当前活动文件；有未保存修改的文件在导航窗格文件名旁显示**星号 `*`**，保存后消失（[Identifying unsaved files](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/identifying-unsaved-files-353488)）。
- **AutoSave** 默认每 **10 分钟**保存一次挂起修改，定位是崩溃/断电恢复，"is not a replacement for saving your files manually"；若不恢复自动保存的文件，未保存修改即丢失（[Adjusting AutoSave intervals](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/adjusting-autosave-intervals-353508)）。
- 即：**打字→Draft 只是状态变化，不是持久化**；Ctrl+Enter 写 TM 但 .sdlxliff 仍需手动保存。Translunar 的"输入即持久化草稿"模型比 Studio 更强，这是**有意的改进**而非偏离（见 §9.3）。

### 2.10 段状态列（Segment Status column）的全部语义

状态列图标承载六类信息："The current status of the translation / The origin of the translation / The translation provider / The translation memory percentage match applied / The segment lock status / If verification found any errors"（[Segment Status column，2024 SR1](https://docs.rws.com/en-US/trados-studio-2024-sr1-1187677/segment-status-column-340490)，2026 文档树已移除该总表页，语义在 2026 界面截图中原样可见）。

来源（origin）徽标语义（同页）：

| 徽标 | 语义 |
| --- | --- |
| `100%`（绿底） | 100% TM 匹配，**自动确认** |
| `CM` | Context match（内容+上下文双 100%），**自动确认** |
| 底色消失的 `CM`/`%` | 该匹配已被人工编辑 |
| `PM` | PerfectMatch，打开即锁定 |
| `77%` 等橙底 | fuzzy 匹配已应用、未确认 |
| 无底色 `%` + 已确认图标 | fuzzy 应用后被编辑并确认（保留原始百分比） |
| 传播图标 | auto-propagation 写入并确认 |
| `AT` | 机器翻译写入并确认（NMT 结果标 `NMT`，2026 截图另见 `AI` 徽标） |
| 错误/警告图标 | 验证失败，详情在 Messages 窗口（Error / Warning 两级） |

悬停状态列显示 **Translation Details tooltip**：Status / Origin / Provider / Score 四项（同页）。

---

## 3. 面板契约（TM / 术语 / Concordance / MT / QA）

### 3.1 Translation Results 窗口

**职责**："displays the results of translation memory (TM) lookups and automated translation lookups for the current segment. If the lookup has found a translation you want to use, you can apply either the repaired or the unrepaired translation"（[Specifying Translation Results window settings 关联描述，2024](https://docs.rws.com/en-US/trados-studio-2024-1145319/specifying-translation-results-window-settings-353335)；2026 同主题 [353335](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/specifying-translation-results-window-settings-353335)）。

**每条命中显示的字段**（同页设置项反推 + 官方截图）：

- 首行可显示**当前文档源文段**（`Show document source segment`）。
- 每条结果：TM 源文（与文档源文的**差异高亮**）、译文、匹配分（`CM`/`%`）、来源/提供方（MT 结果在窗口底部显示 provider 名，[Translating with MT](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/translating-with-machine-translation-mt--354763)）；窗口底栏显示 TU 默认字段（创建时间/作者等）。
- 可选列：**Show translation unit field values**（TU 自定义字段值，最右侧加列）、**Show original translation unit**（TM 原始 TU 对照）、**Search result display mode = Show translation proposal**（placeable 本地化后再显示）。
- 差异标记样式由 **Options > Editor > Text Markup Formatting** 控制："specify how the differences between the translation file and the translation memory (TM) match are indicated."（同页 Note）

**应用手势**（[Applying translation results](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/applying-translation-results-517392)）：

- 多条命中时 **Select Next Match / Select Previous Match** 或 **Alt+PageUp / Alt+PageDown** 翻选。
- 应用：**Apply Translation Result** 或 **Apply Translation without upLIFT Repair**（Match Repair 开启时两种版本并存）。
- 默认行为已经把最佳命中填进目标段（见 2.4），窗口手势主要用于"换一条"。

**惩罚（penalties）与打分**：TM 分数"calculated based on penalties"；本地/服务器 TM 可配置，云 TM 的 status penalties 在 Language Cloud 配置、客户端不可改（[Translating files using Editor resources](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/translating-files-using-editor-resources-353380)、[Applying TM lookups](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/applying-tm-lookups-782069)）。官方 penalty 类型（[File > Options > TM and Automated Translation > Penalties](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/file-options-translation-memory-and-automated-translation-penalties-345455)）：

- **Missing formatting** / **Different formatting**（格式缺失/不同）
- **Multiple translations**（同源多译）
- **Auto-localization**（日期/时间/数字/度量自动替换产生）
- **Text Replacement**（变量/缩写/字母数字串替换产生）

另有 **TM 过滤器惩罚**（按 TU 字段值罚分，[Specifying TM filters and applying penalties](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/specifying-tm-filters-and-applying-penalties-570407)）。

### 3.2 Fragment Matches 窗口（upLIFT）

- TM 整段无命中时自动聚焦并显示**片段级**命中（默认开；exact match 时不做片段查找）（[File > Options > Editor > Fragment Matches](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/file-options-editor-fragment-matches-422233)）。
- 源片段与匹配片段默认 khaki 高亮，颜色/字号可配（同页）。
- **upLIFT Match Repair**：用片段召回自动"修补" fuzzy 命中；Editor 内默认开启，Analyze/Pre-translate 批任务默认关闭；默认只修 ≤10 词的段（[upLIFT Match Repair](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/uplift-match-repair-486829)）。
- 云端对应能力：**Neural Fragment Recall**（限定语向，[Applying TM lookups](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/applying-tm-lookups-782069)、[Neural fragment recall optimization](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/neural-fragment-recall-optimization-1187591)）。

### 3.3 Concordance Search 窗口

（[Performing a Concordance Search](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/performing-a-concordance-search-354706)）

- 手动：窗口内输入文本，选源/目标侧，回车。
- 划词快捷键：**F3**（按所选侧搜）、**Ctrl+F3**（搜 TM 源侧）、**Ctrl+Shift+F3**（搜 TM 目标侧）、**F6** 在结果的源/目标间切换、**Ctrl+Alt+F3** 把结果文本插入光标处。
- 目标侧搜索是否可用取决于 TM 创建/属性设置（同页）。
- **Perform search if the TM lookup returns no results**：TM 无命中自动跑 concordance（默认关）（[Specifying Concordance Search window settings](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/specifying-concordance-search-window-settings-353329)）。
- 显示配置：命中高亮色（默认黄）、字号、**Show translation unit field values**（自定义字段值加列显示；默认字段固定显示在窗口底栏）（同页）。

### 3.4 Term Recognition / Termbase Search / Termbase Viewer

- **自动识别**：光标进段即查术语库；命中术语在**源文段上方画红色括号线**（"highlighted by a red bracketed line in the source segment text"），命中列表（hitlist）进 Term Recognition 窗口（[Translating files using Editor resources](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/translating-files-using-editor-resources-353380)、[Terminology，2024](https://docs.rws.com/en-US/trados-studio-2024-1145319/terminology-341278)）。
- **插入手势**：光标放目标位置 → Term Recognition/Termbase Search 中选中术语 → **Insert term translation**（也可右键）；或 **Ctrl+Shift+L** 直接在编辑器内弹出术语译名列表选择插入（[Inserting a translated term](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/inserting-a-translated-term-354606)）。键盘导航：焦点移入窗口后 ↑↓ 选择、**Insert** 插入、**Enter** 看词条详情（[Extended keyboard support in the Editor view，2024](https://docs.rws.com/en-US/trados-studio-2024-1145319/extended-keyboard-support-in-the-editor-view-802731)）。
- **View term detail** 在 Termbase Viewer 打开完整词条（定义等）（[Inserting a translated term](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/inserting-a-translated-term-354606)）。
- 命中列表展示密度由 **Hitlist settings** 控制（语言/术语库信息量、是否显示目标术语与格式、字段展开/紧凑；可存 `*.mthits` 复用）（[Specifying Termbase Search window settings](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/specifying-termbase-search-window-settings-353340)）。
- 翻译中可直接加词条（**Quick Add New Term / Add New Term**，Home tab Terminology 组，官方 ribbon 截图可见；[Adding termbases during translation](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/adding-termbases-during-translation-354564)）。

### 3.5 Comments 窗口

（[Adding comments](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/adding-comments-354441)）

- 评论只能加在**目标侧**：选中文本 / 当前段 / 整个文件三种 **Scope**。
- **Severity 三级：information / warning / error**。
- 入口：**Review tab > Add Comment**（Quick Start Guide 记载快捷键 **Ctrl+Shift+N**，[PDF](http://www.uco.es/~lr1maalm/TradosTranslatingAndReviewingDocuments.pdf)）。
- 有评论的文本高亮显示；不能叠加在 TQA 上（同页）。
- 评论可版本化（Edit Comments dialog 追加新版本）（同页）。

### 3.6 Messages 窗口（QA 输出）

- "displays verification error messages for all open files"（[The Editor view windows，2022](https://docs.rws.com/en-US/trados-studio-2022-980998/the-editor-view-windows-340578)）。
- 消息分级 **Errors / Warnings / Notes**，各有图标（[Viewing messages](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/viewing-messages-532416)）；状态列同步显示错误/警告图标（[Segment Status column，2024 SR1](https://docs.rws.com/en-US/trados-studio-2024-sr1-1187677/segment-status-column-340490)）。

### 3.7 TQAs 窗口（了解即可）

审校打分框架：开启 **Assess Quality** 模式后，选中目标文本右键 **Add TQA**，按 **Category + Severity** 记录；直接增删改文本会自动生成 TQA 条目（Type = Addition/Deletion/Replacement…）（[Adding TQA items](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/adding-tqa-items-521327)）。TQA 需 Professional 许可或云订阅（[Reviewing files](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/reviewing-files-420478)）。

### 3.8 Preview 窗口

（[Previewing files](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/previewing-files-352618)、[Previewing translated files in the Preview window](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/previewing-translated-files-in-the-preview-window-353474)、[Preview features available by file type](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/preview-features-available-by-file-type-574285)）

- 三种预览途径：**Preview 窗口**（内嵌）、**View In**（原生应用打开，File > Print & View > View In）、**Print Preview**（浏览器中双语 sdlxliff 对照，可打印）。
- Preview 窗口两种模式：**Preview/Embedded**（按需 **Refresh**，只随确认段更新）与 **Real-time Preview**（"update to reflect the changes as you type. This update occurs every time you confirm a segment."，并明确警告耗 CPU）。
- 可预览源文/译文/**Side-by-side**（并排仅 HTML/XML 类型）；支持 Word/PowerPoint/Excel/RTF/XML/HTML/PDF。
- 默认位置：Editor 右上角 Preview 标签（[353474](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/previewing-translated-files-in-the-preview-window-353474)）。
- 无预览时显示 "**Click here to generate initial preview**" 链接（[The Editor view windows，2022](https://docs.rws.com/en-US/trados-studio-2022-980998/the-editor-view-windows-340578)）。

---

## 4. 过滤、查找/替换、导航

### 4.1 标准 Display Filter 与 Advanced Display Filter 2.0

- **标准 Display Filter**：位于 **Review tab > Display Filter 组**，下拉选预定义过滤器（按状态等快速过滤），"a great tool to quickly perform searches inside your segments"（[Displaying the Advanced Display Filter](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/displaying-the-advanced-display-filter-376359)、[Editing with ADF 2.0，2021 文档步骤](https://docs.rws.com/en-US/trados-studio-2021-sr2-813470/editing-with-advanced-display-filter-2-0-536803)）。当前过滤器名显示在**状态栏**（[The Editor view](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/the-editor-view-347941)：status bar 显示 "display filter"）。
- **Advanced Display Filter 2.0**：**View tab** 打开，独立窗口（右缘竖排标签），七个条件页 + 组合过滤（[Applying the Advanced Display Filter](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/applying-the-advanced-display-filter-521182)）：
  - **Content**：源/译/标签内文本或正则；右键 **Source Filter / Target Filter / Selection Filter** 直接以段文/选中文本作条件。
  - **Filter Attributes**：状态、来源、review 特征、重复（unique/exclude first occurrences）、锁定、track changes 等。
  - **Comments**：按用户/严重级/正则搜评论内容。
  - **Document Structure**：按结构码（如 `H` 标题）过滤。
  - **Segment**：按用户、日期、段号、拆分/合并段、**fuzzy 匹配分数区间**（"Fuzzy values between"）。
  - **Colors**：按源文文字颜色过滤。
  - **Sampling**：随机抽样（QA 抽检）。
  - 附加能力：**反转过滤**（Reverse）、**高亮过滤结果**（多色叠加）、**给全部过滤段加评论**、**保存/加载 `.sdladfsettings`**、**导出过滤段生成 SDLXLIFF**。
- 2024 官方对 ADF 2.0 的增强列表（倒推能力基线）：按段号、仅合并段、源=译、fuzzy 值、文字色/高亮色、含标签、标签内内容、随机抽样过滤，可反转/高亮/导出（[Enhanced Advanced Display Filter，2024 SR1](https://docs.rws.com/en-US/trados-studio-2024-sr1-1187677/enhanced-advanced-display-filter-793720)）。

### 4.2 Find & Replace 与 Go To

- **Find and Replace** 对话框：Find / Replace 两个 tab；支持**正则**（.NET 语法）与**通配符**（[Editing with Find and Replace](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/editing-with-find-and-replace-536795)、[Using regular expressions in Find and Replace](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/using-regular-expressions-in-find-and-replace-361030)、[Using wildcards](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/using-wildcards-in-find-and-replace-361035)）。
- 快捷键：**F4** Find next、**Shift+F4** Find previous（会话内已有搜索才可用）（[Finding text with keyboard shortcut keys](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/finding-text-with-keyboard-shortcut-keys-354149)）。
- **Go To**（**Home tab > Go To**）：按 **Number / Category / Status / Comment** 定位，Previous/Next 循环跳转（[Navigating segments on a filter basis](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/navigating-segments-on-a-filter-basis-520933)）。四种定位维度的细目（[Go to 对话框](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/go-to-342501)）：
  - **Number**：按段号直达。
  - **Category**：按**译文来源**跳转——Untranslated / Fuzzy Matched / 100% Match / Context Match / PerfectMatch / Translated / Automated Translation。
  - **Status**：按七种段状态跳转（同 §2.1 全集）。
  - **Comment**：跳到下一个带评论的段。

### 4.3 段间导航

（[Navigating segments](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/navigating-segments-352446)）

- **Ctrl+↓ / Ctrl+↑**：下一/上一**未确认**段（Home tab > Navigate 组 Next/Previous 同义）。
- **Ctrl+Page Up / Ctrl+Page Down**：段首/段尾。
- 源/译列可拆成两个独立滚动列表；错位时 **View tab > Scroll source to target selection** 重新对齐。

---

## 5. QA / 验证体系

（[Verifying translations](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/verifying-translations-359741)）

**三个触发时机**：

1. **段级：确认段落时自动验证**（"Verifications on a segment level occur when you confirm a segment."）。
2. **文件级**：Editor 视图 **Review tab > Quality Assurance > Verify**（快捷键 **F8**，[Translating files using Editor resources](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/translating-files-using-editor-resources-353380)）。
3. **项目级**：Projects 视图 **Batch Tasks > Verify Files**。

**五套验证器**（同页）：**Document verifier / QA Checker (3.0) / Terminology verifier / Tag verification / XML validation**。Tag 验证默认开启；QA Checker 大部分检查默认关闭需手动启用。错误显示在 **Messages** 窗口，段状态列同步标错。

**QA Checker 3.0 检查组**（[Specifying settings for QA Checker](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/specifying-settings-for-qa-checker-359765)）：Segments verification（漏译/未编辑/长度对比）、Segments to exclude（可按匹配类型排除，如 PerfectMatch 段）、Inconsistencies（同源异译/重复词）、Punctuation、Numbers（日期/时间/数字/度量/货币转换）、Word list（简版术语检查）、Regular expressions（.NET 正则规则）、Trademark check、Length verification（字符上限）、QA Checker profiles（打包导出设置）。全局与语向级两层设置，语向级覆盖全局（同页）。

**Terminology verifier**：检查是否使用了术语库目标术语、是否用了**禁用术语**（[Verifying translations](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/verifying-translations-359741)、[Specifying settings for the Terminology Verifier](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/specifying-settings-for-the-terminology-verifier-359769)）。

---

## 6. 引擎能力推断（TM 匹配、MT、AutoSuggest、批任务）

### 6.1 匹配类型层级

（[TM matches，2024 SR1](https://docs.rws.com/en-US/trados-studio-2024-sr1-1187677/tm-matches-341353)）

| 类型 | 定义 | 特权 |
| --- | --- | --- |
| **PerfectMatch (PM)** | 与**既有双语文件**（非 TM）比对的上下文匹配；检查前后文与切分；可动态合并最多 3 个连续段 | 打开即锁定、"typically need no further translation or editing" |
| **Context Match (CM)** | 100% 匹配 + 相同文件上下文（**前一段相同**；TM 中随 TU 存储前段作为上下文，上下文段不可见） | "better than a 100% match"，自动确认 |
| **100% (Exact)** | 全部字符与字符格式完全一致 | 默认自动确认 |
| **Fuzzy** | <100%；**默认 fuzzy match threshold = 70%**，低于视为无匹配（项目/文档/全局三处可调） | 显示橙底百分比 |

### 6.2 MT / Language Cloud

- MT 作为与 server TM 同级的 provider 接入；TM 无 100%/fuzzy 命中时 MT 建议**自动填入**目标段；provider 名显示在 Translation Results 底部（[Translating with MT](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/translating-with-machine-translation-mt--354763)）。
- 提供方：Language Weaver（NMT）、DeepL、Language Weaver Edge 及 AppStore 的 Automated translation 类插件（同页）。
- 云项目附加 **MTQE**（MT 质量预估）：Editor 右侧 **TQE** 按钮（同页；官方截图右缘可见 TQE 标签）。
- 云 TM 的 status penalties 在 Language Cloud 配置，客户端只读（[Applying TM lookups](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/applying-tm-lookups-782069)）。

### 6.3 AutoSuggest / AutoText / QuickPlace

- **AutoSuggest**：输入时前缀联想下拉，来源含 AutoSuggest 词典（由 TM 生成）、AutoText、术语库目标词等；双击建议插入（[Editing with AutoSuggest](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/editing-with-autosuggest-354131)、[Translating with AutoSuggest and AutoText](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/translating-with-autosuggest-and-autotext-300997)）。AutoText 条目 ≥5 字符（[Editing with AutoSuggest 关联主题](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/editing-with-autosuggest-354131)）。
- **QuickPlace（Ctrl+, 逗号）**：把源文的**格式、数字、标签、placeable** 转移到目标段的下拉（源段中对应内容金色高亮）（[Translating files using Editor resources](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/translating-files-using-editor-resources-353380)、Quick Start Guide [PDF](http://www.uco.es/~lr1maalm/TradosTranslatingAndReviewingDocuments.pdf)）。
- **QuickInsert 工具栏**：插标签/特殊符号（同页）。
- 标签显示四模式：**No Tag Text / Partial Tag Text / Full Tag Text / Tag ID**（View tab > Options 组，[Specifying the tag display mode](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/specifying-the-tag-display-mode-353345)）。

### 6.4 批任务（Batch Tasks）清单

2026 文档树 "Running batch tasks" 系列主题给出的官方任务集：**Analyze Files、Pre-translate Files、Pseudo-translate、Verify Files、Word Count、Translation Count、WIP Report、PerfectMatch、Export Files、Export for Bilingual Review、Update from Reviewed Target File (Retrofit)、Generate Target Translations、Populate Project Translation Memories、Update Main Project Translation Memories、Finalize、Translation Quality Assessment**（[Batch tasks and task sequences](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/batch-tasks-and-task-sequences-359241) 及其子主题，例如 [Running batch tasks: Finalize](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/running-batch-tasks-finalize-359273)、[Running batch tasks: PerfectMatch](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/running-batch-tasks-perfectmatch-518581)）。任务可编成 **task sequences**（Prepare / Prepare without project TM 等）。

### 6.5 2026 内置 AI 栈（AI Bridge / AI Assistant / Smart Review / MTQE / Smart Help）

2026 版把 AI 归为四件套 + 一个云包（[Trados Studio and AI](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/trados-studio-and-ai-1147776)）：

- **AI Bridge**（2026 新增，随 Studio 自动安装的原生 AI 集成层）：一个 provider 桥连接 **OpenAI、Azure OpenAI、Anthropic Claude、Google Gemini、DeepSeek、xAI Grok** 及**本地运行时（Ollama、LM Studio）**；同一套 provider 连接与 prompt library 供两个消费面共享——① Editor 右缘 **AI Assistant** 面板（针对活动段的交互式提示建议），② **批任务 translation provider**（Analyze / Pre-translate Files with AI Bridge）与逐段翻译来源。它取代 2024 的 AppStore 插件 "Open AI Provider (AI Professional)"（[AI Assistant and AI Bridge](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/ai-assistant-and-ai-bridge-1147781)）。生成式翻译会结合术语库、TM 等资源（官方称 generative translation）。
- **Smart Review**：LLM 评审活动段，输出分数+解释（高质量绿标/低质量红标）+ 改译建议；**AppStore 应用**，云项目还需购买 **AI Essentials** 云包（AWS Bedrock，或加钱换 Azure OpenAI）（[Smart Review](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/smart-review-1152571)）。
- **MTQE**（MT 质量预估）：Language Weaver 等 provider 对 MT 输出打质量分，2024 起支持，Editor 右缘 TQE 标签（[Machine Translation Quality Estimation](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/machine-translation-quality-estimation-1147785)，另见 §6.2）。
- **Smart Help（Trados Copilot）**：界面内问答帮助（[Trados Copilot – Smart Help](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/trados-copilot-e28093-smart-help-1147789)）。

要点：即便到 2026，Studio 也**没有把任何 AI 元素放进编辑网格**——AI Assistant 是右缘折叠标签，Smart Review 结果落在段标记上，MTQE 在 TQE 标签里；网格行内始终只有文本+状态列（见 §8）。

---

## 7. 键盘快捷键汇总（本次核实的官方来源）

| 快捷键 | 动作（官方名） | 来源 |
| --- | --- | --- |
| **Ctrl+Enter** | Confirm and Move to Next Unconfirmed Segment（跳过锁定段） | [353400](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/confirming-translated-text-353400) |
| **Ctrl+Alt+Enter** | Confirm and Move to Next Segment | [2024/353400](https://docs.rws.com/en-US/trados-studio-2024-1145319/confirming-translated-text-353400)、[OE 快捷键表](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/shortcuts-in-online-editor-515739) |
| **Ctrl+Alt+Shift+Enter** | Confirm, but do not Move to Next Segment | 同上 |
| **Ctrl+Shift+Enter** | Reject (Translation Rejected)（审校模式） | [Quick Start PDF](http://www.uco.es/~lr1maalm/TradosTranslatingAndReviewingDocuments.pdf) |
| **Ctrl+↓ / Ctrl+↑** | 下一/上一未确认段 | [352446](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/navigating-segments-352446) |
| **Ctrl+PageUp / Ctrl+PageDown** | 段首 / 段尾 | 同上 |
| **Alt+PageUp / Alt+PageDown** | Translation Results 上/下一条匹配 | [517392](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/applying-translation-results-517392) |
| **Ctrl+Shift+L** | 弹出术语译名列表并插入 | [354606](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/inserting-a-translated-term-354606) |
| **F3 / Ctrl+F3 / Ctrl+Shift+F3** | Concordance：按所选侧 / 源侧 / 目标侧搜索 | [354706](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/performing-a-concordance-search-354706) |
| **F6** | Concordance 结果内源/目标切换 | 同上 |
| **Ctrl+Alt+F3** | 插入 Concordance 结果文本 | 同上 |
| **Ctrl+,**（逗号） | QuickPlace 下拉（格式/数字/标签转移） | [353380](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/translating-files-using-editor-resources-353380) |
| **F8** | Verify（QA 验证当前文件） | 同上 |
| **F4 / Shift+F4** | Find next / Find previous | [354149](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/finding-text-with-keyboard-shortcut-keys-354149) |
| **Ctrl+Shift+N** | Add Comment | [Quick Start PDF](http://www.uco.es/~lr1maalm/TradosTranslatingAndReviewingDocuments.pdf) |
| **Ctrl+Insert** | Copy Source to Target | [OE 快捷键表](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/shortcuts-in-online-editor-515739)、[Copying source content to target segments](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/copying-source-content-to-target-segments-505211) |
| **Alt+Delete** | 清空当前目标段 | [OE 快捷键表](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/shortcuts-in-online-editor-515739) |
| **Shift+F3** | 切换所选文本大小写 | [OE 快捷键表](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/shortcuts-in-online-editor-515739) |
| **Ctrl+F1** | 最小化/恢复 ribbon | [338310](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/the-ribbon-338310) |

快捷键体系本身可全量自定义：**File > Options > Keyboard Shortcuts**（按视图分区、冲突标红、Shift+F10 保留），并可从 Welcome 视图打印全表（[Keyboard shortcuts](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/keyboard-shortcuts-341986)、[Viewing keyboard shortcuts](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/viewing-keyboard-shortcuts-557465)）。另有 Default / SDLX / SDL Trados 三套预设快捷键方案（同页）。

---

## 8. Studio 明确**不**放在屏幕上的东西（负空间，同样重要）

以下每条都以官方文档"唯一给出的操作路径"为证——官方从未提供第二种 UI：

1. **行内没有任何 Save/Confirm 按钮**。确认的入口只有三个：快捷键、ribbon（Home > Segment Actions）、段号列右键菜单（[Confirming translations](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/confirming-translations-352560)）。官方 Editor 截图中，网格行内只有文本与状态图标，无任何按钮。
2. **没有"保存到 TM"按钮**。TM 写入是确认动作的自动副作用（Options 可改为手动），不是显式操作（[344856](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/file-options-editor-automation-344856)）。
3. **网格下方没有常驻编辑辅助区**。所有辅助（TM 结果、术语、QA、评论、预览）都是**可停靠/可关闭的独立窗口**，默认在网格上方或右缘标签内，绝不占据行与行之间的空间（[The Editor view windows，2022](https://docs.rws.com/en-US/trados-studio-2022-980998/the-editor-view-windows-340578)）。2026 新增的 AI Assistant 也只是右缘一个折叠标签（官方截图）。
4. **行内不显示元数据文本**。状态、来源、匹配分、锁、QA 结果全部压缩为**状态列里的图标/徽标**，详情藏在悬停 tooltip（Status/Origin/Provider/Score）里（[Segment Status column，2024 SR1](https://docs.rws.com/en-US/trados-studio-2024-sr1-1187677/segment-status-column-340490)）。
5. **源文默认不可编辑**。源文编辑是**项目设置里显式启用**的例外能力（"You can only edit source segments if source editing is enabled in your project settings."），定位是修正源文小错以保证 TU 质量，且改动可经 **File > Advanced Save > Save Source As** 回写原文档（[Editing source segments](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/editing-source-segments-354182)）。
6. **没有行级 MT 按钮**。MT 结果与 TM 结果统一走 Translation Results 窗口和自动插入管道（[354763](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/translating-with-machine-translation-mt--354763)）。
7. **没有"完成度仪表盘"占据编辑区**。进度只存在于状态栏百分比和 Confirmation Statistics 窗口（[The Editor view](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/the-editor-view-347941)、[Viewing file confirmation statistics](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/viewing-file-confirmation-statistics-331928)）。
8. **过滤是"隐藏行"而非"高亮行"**："Only segments that match the conditions of the filter are displayed in the Editor window."（[Editing target segments 关联主题 "Filtering segments"](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/editing-target-segments-354004)）高亮是 ADF 2.0 的可选叠加，不是默认。
9. **确认动作没有确认弹窗**。唯一的交互式弹窗是可选的 Auto-propagate 提示（默认不弹）（[342130](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/auto-propagate-confirmed-translation-342130)）。

---

## 9. 对 Translunar 的取舍（steal vs skip）

前提：Translunar 是本地优先的 Electron 小型 CAT，无 GroupShare/Language Cloud/包工作流。

### 9.1 值得偷（steal）

1. **段生命周期核心闭环**（已采用，官方背书）：打字→Draft；**Ctrl+Enter = 确认 + 写 TM + 跳下一未确认段（跳过锁定段）**；清空→Draft。来源见 §2.2–2.5。
2. **确认变体**：补 **Ctrl+Alt+Enter**（确认+顺跳）与 **Ctrl+Alt+Shift+Enter**（确认不动）两个低成本变体，键位照抄。
3. **状态列即信息中枢**：源/译之间一列，图标+徽标（状态、来源 `CM/100%/85%/MT/AI`、锁、QA 错误），悬停出 Status/Origin/Provider/Score tooltip；**编辑后徽标底色消失**这个"已污染"信号非常廉价且高效（§2.10）。
4. **行激活 = 查询管线**：进段自动查 TM+术语；最佳命中自动填空段；exact 自动确认（做成可关的选项，默认照 Studio：apply best match 开、auto-confirm exact 开）（§2.4）。
5. **TM 无命中 → MT 自动兜底填入**，来源徽标区分（§2.4、§6.2）。
6. **自动传播**：确认后把译文传播到文件内相同源文段（默认 100%、只传空段/未确认段、不弹窗），是重复率高的文档的最大提效点（§2.6）。
7. **Concordance F3 家族**与 **Ctrl+Shift+L 术语插入**：划词即查、键盘闭环（§3.3、§3.4）。
8. **术语红括号线**：源文上方细括号标注命中术语，不打断阅读（§3.4）。
9. **Display Filter 下拉 + 状态栏显示当前过滤器名 + "Filtered X of Y"计数**；进阶条件（状态/来源/正则/段号区间）可后补（§4.1）。
10. **Go To（按状态/评论/段号循环跳转）**：实现成本低（§4.2）。
11. **确认时段级 QA**+Messages 式集中列表+状态列错误图标；F8 全文验证（§5）。QA 检查子集选：漏译、标点、数字、术语禁用词、长度、源=译。
12. **预览双模式**：手动 Refresh 的普通预览 + 确认触发的 Real-time 预览（我们已有 live preview，补"确认时刷新"节流语义与官方 CPU 警告的思路）（§3.8）。
13. **锁定段**：跳段跳过 + QA 默认忽略 + 不可合并，三条规则一起抄（§2.7）。
14. **拆分/合并**：光标拆源文、段号列多选合并、"译文并入首段"规则照抄；跨段落合并可不做（§2.8）。
15. **文档结构列（DSI 码）**：一列短码 + 悬停解释，廉价的上下文定位（§1.3）。
16. **批量 TM 回灌的状态门槛**：导出/更新 TM 时默认只取 Translated 及以上状态（§2.5.3）。
17. **AI Bridge 的接入形态**（架构参考，非抄 UI）：一个 provider 桥（含本地 Ollama/LM Studio）+ 共享 prompt library，同时喂**交互面板**与**批量预翻译**两个消费面；AI 建议永不进网格行内，只走右缘面板/来源徽标（§6.5）。Translunar 的 AI provider 层正好照此收敛。

### 9.2 应跳过（skip）

1. **GroupShare / Language Cloud / 包（package）工作流、Check in/out**——云协同链路整套不做。
2. **TQA 框架**（类别×严重级×计分×报告）与 **MTQE/TQE**：企业审校计量体系，小团队用评论即可。同理跳过 **Smart Review / Smart Help / AI Essentials 云包**——LLM 评审绑 AppStore 应用与云订阅（AWS Bedrock），本地场景没有对应物（§6.5）。
3. **Sign-off 双阶段**（Translation Approved / Signed Off / 两种 Rejected）：保留 Draft/Translated（+可选一档 Reviewed）即可；七状态是 LSP 流水线产物。
4. **PerfectMatch**：依赖"旧双语文件对齐+动态合并"的重基建；本地场景用 CM/100% 足够。
5. **upLIFT 片段召回与 Match Repair**：需要 TM 细粒度对齐引擎；可用简化的子串 concordance 兜底。
6. **AutoSuggest 词典**（离线 n-gram 词典构建）与 AutoText 管理：维护成本高；保留术语+MT 补全即可。
7. **Track Changes 全套修订模型**（含源文修订、修订过滤、按修订入 TM）：Electron 编辑器中成本极高，先不做。
8. **Ribbon + 可停靠窗口系统**（Floating/Auto Hide/多显示器）：Studio 因功能海量才需要；小应用用固定布局+可折叠侧栏。
9. **批任务/任务序列引擎**（16 种任务+自定义序列）：留下"导出/QA 全文/统计"几个一键动作即可。
10. **QA Checker profiles、语向级设置覆盖、项目模板**：单人/小团队直接全局设置。
11. **三套快捷键预设（Default/SDLX/SDL Trados）**：一套即可，但快捷键要可自定义。
12. **原生应用 View In 预览、Print Preview**：保留内嵌 HTML 预览即可。
13. **伪翻译（Pseudo-translate）、Retrofit、对齐工具、MultiTerm 独立应用**。

### 9.3 与现有 PRD 的对表（供 PRD 精化，不再自造）

- 我们的"type = draft auto-save"：**状态语义**与官方一致（§2.3），且官方还规定**清空目标段也归 Draft**——PRD 应补此边界。**持久化语义**上我们强于 Studio：Studio 打字后仍需 Ctrl+S 落盘（AutoSave 仅崩溃恢复，§2.9），Translunar 输入即写库，应在 PRD 中明确这是有意改进（并因此**不需要**星号"未保存"标记与手动 Save 按钮）。
- 我们的"Ctrl+Enter = confirm + TM + next unconfirmed"：官方一致，且官方语义包含**跳过锁定段**与**确认时段级 QA**、**确认时刷新预览**、**（可选）自动传播**四个挂钩——PRD 可按需挂接。
- 官方"100% 命中自动确认""最佳命中自动填入"是**默认开**的选项而非固定行为；PRD 若做成常开需说明理由，建议保留开关。
- TM 写入只认确认；**审校批准（Approved）同样写 TM**——若未来加 Reviewed 状态，写库规则照此。

---

## 附录 A：官方截图存档

`/opt/cursor/artifacts/research-trados/`：

| 文件 | 内容 | 来源页 |
| --- | --- | --- |
| `editor-view-549248.png` | Editor 视图官方标注全图（2026，10 要素） | [The Editor view](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/the-editor-view-347941) |
| `ribbon-557193.png` | Ribbon 官方标注图（QAT/tabs/groups/dialog launcher/Smart Help） | [The ribbon](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/the-ribbon-338310) |
| `track-changes-353728.jpg` | 修订显示样式 | [Working with Track Changes](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/working-with-track-changes-353720) |
| `autosuggest-341145.jpg` | AutoSuggest 下拉示例 | [Editing with AutoSuggest](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/editing-with-autosuggest-354131) |
| `termbase-search-704738.png` | 术语搜索结果 | [Searching termbase entries](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/searching-termbase-entries-354600) |
| `comments-segment-980011.png` | 段级评论标记（Online Editor） | [Viewing comments](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/viewing-comments-505277) |

## 附录 B：本次遍历的官方文档树

- 主入口：[Understanding the user interface](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/understanding-the-user-interface-338262)（2026 Release，publication 1279521），自此 BFS 递归抓取站内链接，共读取约 **440+ 个主题页**，优先覆盖：Editor、segment、confirm、translation results、concordance、term、QA/verification、preview、filter、track changes、TM/MT、batch tasks、keyboard shortcuts 等关键词主题。
- 2026 文档树已下线的参考页改引：[Segment Status column（2024 SR1）](https://docs.rws.com/en-US/trados-studio-2024-sr1-1187677/segment-status-column-340490)、[TM matches（2024 SR1）](https://docs.rws.com/en-US/trados-studio-2024-sr1-1187677/tm-matches-341353)、[The Editor view windows（2022）](https://docs.rws.com/en-US/trados-studio-2022-980998/the-editor-view-windows-340578)、[Extended keyboard support in the Editor view（2024）](https://docs.rws.com/en-US/trados-studio-2024-1145319/extended-keyboard-support-in-the-editor-view-802731)。
- 官方补充材料：[Shortcuts in Online Editor（2026 文档树内）](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/shortcuts-in-online-editor-515739)、SDL 官方 [Translating and Reviewing Documents Quick Start Guide（PDF）](http://www.uco.es/~lr1maalm/TradosTranslatingAndReviewingDocuments.pdf)。
- 正文引用的 2026 主题页（核心子集）：
  - IA：[338262](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/understanding-the-user-interface-338262) · [338310](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/the-ribbon-338310) · [338564](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/the-quick-access-toolbar-338564) · [490688](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/the-file-menu-490688) · [365276](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/views-in-trados-studio-365276) · [365284](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/the-navigation-pane-365284) · [338273](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/windows-and-window-navigation-338273) · [347941](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/the-editor-view-347941) · [587718](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/searching-for-features-and-commands-in-the-tell-me-box-587718)
  - 生命周期：[344738](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/translation-statuses-344738) · [352560](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/confirming-translations-352560) · [353400](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/confirming-translated-text-353400) · [353406](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/unconfirming-translated-text-353406) · [488363](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/changing-segment-statuses-488363) · [353543](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/changing-the-status-of-translated-segments-353543) · [352446](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/navigating-segments-352446) · [353468](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/locking-segments-353468) · [520942](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/unlocking-segments-520942) · [353412](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/splitting-segments-353412) · [353417](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/merging-segments-353417) · [353178](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/auto-propagation-353178) · [344868](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/file-options-editor-auto-propagation-344868) · [342130](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/auto-propagate-confirmed-translation-342130) · [344856](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/file-options-editor-automation-344856) · [354004](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/editing-target-segments-354004) · [353380](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/translating-files-using-editor-resources-353380)
  - 面板：[353335](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/specifying-translation-results-window-settings-353335) · [517392](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/applying-translation-results-517392) · [782069](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/applying-tm-lookups-782069) · [354710](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/performing-manual-lookups-354710) · [422233](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/file-options-editor-fragment-matches-422233) · [486829](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/uplift-match-repair-486829) · [354706](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/performing-a-concordance-search-354706) · [353329](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/specifying-concordance-search-window-settings-353329) · [354606](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/inserting-a-translated-term-354606) · [353340](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/specifying-termbase-search-window-settings-353340) · [354441](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/adding-comments-354441) · [532416](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/viewing-messages-532416) · [521327](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/adding-tqa-items-521327) · [331928](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/viewing-file-confirmation-statistics-331928) · [352618](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/previewing-files-352618) · [353474](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/previewing-translated-files-in-the-preview-window-353474) · [574285](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/preview-features-available-by-file-type-574285)
  - 过滤/查找：[376359](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/displaying-the-advanced-display-filter-376359) · [521182](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/applying-the-advanced-display-filter-521182) · [536803](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/editing-with-advanced-display-filter-2-0-536803) · [536795](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/editing-with-find-and-replace-536795) · [354149](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/finding-text-with-keyboard-shortcut-keys-354149) · [361030](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/using-regular-expressions-in-find-and-replace-361030) · [520933](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/navigating-segments-on-a-filter-basis-520933) · [342501](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/go-to-342501)
  - QA：[359741](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/verifying-translations-359741) · [359765](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/specifying-settings-for-qa-checker-359765) · [359769](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/specifying-settings-for-the-terminology-verifier-359769) · [521441](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/specifying-settings-for-the-tag-verifier-521441) · [359761](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/generating-verification-results-without-batch-tasks-359761)
  - 引擎/批任务：[345455](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/file-options-translation-memory-and-automated-translation-penalties-345455) · [570407](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/specifying-tm-filters-and-applying-penalties-570407) · [354763](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/translating-with-machine-translation-mt--354763) · [514600](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/using-machine-translation-providers-514600) · [354131](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/editing-with-autosuggest-354131) · [300997](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/translating-with-autosuggest-and-autotext-300997) · [353345](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/specifying-the-tag-display-mode-353345) · [359241](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/batch-tasks-and-task-sequences-359241) · [548332](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/specifying-batch-settings-translation-memory-updates-548332) · [359281](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/running-batch-tasks-update-main-project-translation-memories-359281) · [341986](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/keyboard-shortcuts-341986) · [1187591](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/neural-fragment-recall-optimization-1187591)
  - 2026 AI 栈：[1147776](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/trados-studio-and-ai-1147776) · [1147781](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/ai-assistant-and-ai-bridge-1147781) · [1152571](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/smart-review-1152571) · [1147785](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/machine-translation-quality-estimation-1147785) · [1147789](https://docs.rws.com/zh-CN/trados-studio-2026-release-1279521/trados-copilot-e28093-smart-help-1147789)

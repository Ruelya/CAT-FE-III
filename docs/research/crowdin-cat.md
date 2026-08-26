# Crowdin CAT 产品逆向研究

| 项目 | 值 |
| --- | --- |
| 日期 | 2026-08-26 |
| 性质 | 只读研究，无实现。为 Translunar 工作台重构 PRD 提供证据基础 |
| 方法 | 官方文档站全站爬取（sitemap-0.xml，273 个英文 URL）+ 官方截图 + 官方博客更新日志 + 社区论坛帖子 |
| 截图存档 | `/opt/cursor/artifacts/research-crowdin/`（15 张官方截图，清单见附录 C） |
| 404 记录 | `https://support.crowdin.com/sitemap.xml`（改用 `sitemap-0.xml` 成功）；`https://support.crowdin.com/online-editor-keyboard-shortcuts/`（编辑器快捷键全表只存在于产品内 Ctrl+Shift+K 弹层，文档站无独立页面；Enterprise 的 [`/enterprise/keyboard-shortcuts/`](https://support.crowdin.com/enterprise/keyboard-shortcuts/) 只覆盖工作区导航键） |

一句话结论：Crowdin 编辑器是一台"以当前字符串为引力中心"的机器。左列选中一行，右侧所有资源面板（上下文、TM、MT、AI、术语、评论、其他语言）同步刷新；保存（Save）与批准（Approve）是两个分离的动词，由两种角色执行；QA 以 Error/Warning 双级在保存瞬间拦截。Translunar 要学的是这套引力结构和拦截时机，不是它的云端协作剧场。

---

## 0. Crowdin 产品形态速写

Crowdin 是 SaaS 本地化管理平台，分两个产品：crowdin.com（个人账户中心制，资源挂在 owner 账户下）与 Crowdin Enterprise（组织中心制，带可视化 Workflow 引擎、SSO、供应商 B2B 模型）。来源：[Comparing Crowdin and Crowdin Enterprise](https://support.crowdin.com/enterprise/comparing-crowdin-and-crowdin-enterprise/)。

官方对编辑器的定义：

> "The Editor is the main place in Crowdin where project members can work on translations. It allows users to suggest, vote on, review, and approve translations online."
> —— [Editor Overview](https://support.crowdin.com/online-editor/)

注意四个动词的顺序：suggest → vote → review → approve。翻译在 Crowdin 里默认是"建议"（suggestion），一条字符串可挂多条建议，投票排序，审校批准其一。这与 Trados 式"一格一译文"的桌面模型有本质区别（见 §5 判断）。

没有官方命名的 "Editor v2"。编辑器经历持续翻修：2024-02 编辑器主题（Tallinn Night/Day）；2024-08 可配置默认布局、tooltip 显示热键；2025-04 Multilingual (Grid) 大改版（Compact/Default 双密度、列宽列显隐可配）；2025-08 文件树面板取代旧文件对话框、标签可点击过滤、Asset Editor 重设计。来源：[Year in Review 2024](https://crowdin.com/blog/year-in-review-2024)、[What's New April 2025](https://crowdin.com/blog/whats-new-at-crowdin-april-2025)、[What's New August 2025](https://crowdin.com/blog/whats-new-at-crowdin-august-2025)。

---

## 1. 信息架构：编辑器布局

主要来源：[Editor Overview](https://support.crowdin.com/online-editor/)，官方截图 `crowdin-sbs_editor.webp`、`crowdin-comfortable.webp`、`crowdin-multilingual_mode_grid.webp`（原始 URL 见附录 C）。

### 1.1 顶栏

从官方 Side-by-Side 截图逐项还原（左→右）：

1. 绿色返回按钮（回项目页）。
2. 面包屑导航路径：`项目名 / 目标语言 / 文件名`（如 `Umbrella / French / strings.xml`）。悬停文件名弹出该文件的翻译/批准进度（词数+百分比）；在任务模式下面包屑显示任务名，悬停出任务详情弹层（任务 ID、直达链接、截止日、语言、类型、指派人）。来源：Editor Overview "Navigation and Quick Access"、"Tasks in the Editor"。
3. 水平主菜单：File, Edit, View, Language, Project, Help。官方措辞："Using the main menu at the top of the Editor (File, Edit, View, Language, Project, Help), you can select content for translation, download or upload translations, perform various string actions, change the Editor's layout, switch target languages, access project pages and switch projects, access help materials, and more." 水平菜单可在设置里关闭，关闭后收进左上角汉堡图标，面包屑各段变成可点击下拉。
4. 右上角：两个圆环进度指示器（当前文件/文件夹的已翻译 %、已批准 %）→ 未保存翻译图标（有未保存时亮绿点，点开可 Save All / View Strings）→ 编辑器模式切换图标组 → 命令面板图标 → 键盘快捷键图标 → 设置齿轮 → 用户头像。

### 1.2 四种编辑器模式

> "The available modes include Side-by-Side, Comfortable, Multilingual, and Multilingual (Grid), each providing a unique layout for presenting and managing translations. The Side-by-Side mode is enabled by default."
> —— [Editor Overview](https://support.crowdin.com/online-editor/)

| 模式 | 布局 | 官方定位 |
| --- | --- | --- |
| Side-by-Side（默认） | 左列表（源文+译文两列同行）+ 右资源面板 | 批量作业、投票、批量批准："ideal for managing multiple translations at once" |
| Comfortable | 左侧 Files/Strings 双视图窄列 + 中央单字符串工作区 + 右评论列 | 单串聚焦："focus on one string at a time... ideal for handling complex translations or performing detailed proofreading" |
| Multilingual | 同 Side-by-Side，但可同时选多目标语言，每页 50 行 | 多语种译者 |
| Multilingual (Grid) | 电子表格：每语言一列，行密度 Compact/Medium/Large，列可拉宽/固定/隐藏/重排（Sort Columns + Reset To Default），悬停单元格出现 Save/Cancel/Approve/Copy Source 迷你面板，QA 状态直接显示在单元格内 | 多语言紧凑批处理 |

关键架构判断：Comfortable 不是简单的"放大版行编辑"，而是把左列从"字符串表"降格成"导航列表"（Files/Strings 切换），把屏幕中央整块让给当前字符串 + 建议流（French Translations → AI Suggestion → TM and MT Suggestions → Other Languages 自上而下一屏内滚动）。Side-by-Side 则把同样的建议流折叠进右侧面板。两种模式共享同一数据面板集合，只是排布不同。

### 1.3 左列：字符串列表

- 每行结构（Side-by-Side 截图证据）：状态图标（色块）+ 源文 + 灰色小字 key（如 `password_recovery`）+ 标记图标（labels/comments/screenshots）；译文列内联显示 QA 错误红字、拼写检查黄字、未解决 issue 红色计数徽章、行尾 Approve 图标。
- 状态集合（官方词表）：untranslated / partially translated（复数形式部分未译）/ translated / partially approved / approved / hidden（仅 PM 与审校可见）。
- 行标记（marker）及点击行为是文档明确定义的交互契约，例如："Screenshots — The string has screenshots attached. — Opens the Context & Translations panel and the first screenshot in the screenshot viewer."，以及 Master String / Duplicate String 标记点击后在新标签页打开对应字符串。
- 顶部搜索框（Ctrl+F 聚焦），搜索范围随打开对象变化（文件/文件夹/全项目）。搜索限定器：Everything / Strings / Translations / Context / Identifier (Key)；选项 Match case、Match whole phrase、Exact match（后两者互斥）；短语上限 128 字符；纯数字查内部 ID，带引号查文本中的数字。
- 过滤器（详见 §3.5）与"显示周边字符串"（puzzle 图标，加载当前页每条字符串前后各至多 5 条灰显上下文串；普通模式下可直接编辑它们，任务模式下严格只读）。
- 底部字符串计数按钮（如 `10 STRINGS`）点开 Get Info：对 Filtered 与 Selected 分别统计 Strings / Words / Characters (no spaces) / Characters (with spaces)。

来源：[Editor Overview](https://support.crowdin.com/online-editor/) 各节。

### 1.4 引力中心：当前字符串

文档反复出现的机制是"选中即刷新"：

- "This section displays the list of strings, with the active one highlighted."（列表中活动行高亮）
- 术语、TM、MT、AI、评论、截图、其他语言，全部按当前选中字符串取数。
- 截图查看器随选中行走："When you select another string in the list, the open viewer follows it. If the new string appears on the same screenshot, the solid outline moves to it. Otherwise, the viewer switches to that string's screenshots."
- Comfortable 模式下左列 Files 视图选中项变化时 Strings 视图自动刷新。
- WYSIWYG 预览里活动字符串黄色高亮，点预览里的句子即选中对应行。

也就是说：选区（selection）是全编辑器唯一的状态源，所有面板都是它的投影。这是 Translunar 工作台重构最值得抄的一条骨架原则。

### 1.5 右侧面板

Side-by-Side / Multilingual 模式下右侧是一根图标栏 + 可展开面板，包含以下节（每节可折叠，全大写小标题）：

1. **Context & Translations**：context 文本 + Request（缺上下文时一键向 PM 请求）+ key + Labels + 截图预览卡（红框标出字符串位置，悬停放大，点击开 viewer）+ 他人译文（带投票 +/-）+ AI Suggestion + TM and MT Suggestions（合并为 "Automated Suggestions" 可折叠组）+ Other Languages。
2. **Comments**：讨论 + issue 上报（详见 §2.6）。
3. **Search TM**：TM 并发检索（Source/Target 双向、Guess translation、Numeric equivalence、通配符 `*` `+` `-` 与引号精确短语）。
4. **Terminology**：术语卡片浏览与搜索，查不到时回落 Wikipedia 解释。
5. **Style Guides**：项目风格指南弹层预览 + 下载。
6. **File Context**：文件级说明（纯文本或 Markdown，经理可在编辑器内直接编辑，其他人只读）。

面板自定义是产品级特性：图标可拖拽重排（"reorder the sections in the right panel... by dragging their icons"），节可 pin 固定，设置里可 Reset to default。第三方应用可通过 [Editor Right Panel 模块](https://support.crowdin.com/developer/crowdin-apps-module-editor-right-panel/) 注入新 tab，声明 `modes: translate / comfortable / side-by-side / multilingual / review / assets`。

来源：[Editor Overview](https://support.crowdin.com/online-editor/)、[Editor Right Panel Module](https://support.crowdin.com/developer/crowdin-apps-module-editor-right-panel/)。

### 1.6 底部与预览面板

- Side-by-Side / Multilingual 模式：底部可开合 WYSIWYG 预览面板；Comfortable 模式预览默认常驻。支持格式官方列表：HTML, XML, TXT, DOCX, XLSX, HAML, Web XML, Markdown, MDX, DITA, Wiki, ADOC, Coffee, FTL, JS, TS, FTLH。
- 预览内状态着色（官方词表）：Red - untranslated；Blue - translated；Light-green - approved；Gray - not for translation；活动串黄色。
- 预览工具：基础列表回退（仅 Comfortable）/ 高亮开关 / 译文预览开关 / 缩放（仅 Comfortable）/ Full Screen（Ctrl+F）/ Dual Preview（Ctrl+D，源文与译文并排，点一侧自动高亮另一侧对应句并弹出翻译气泡）。
- Full Screen 与 Dual Preview 显示整份文件，绕过字符串列表分页；预览内可直接内联编辑："Click on any highlighted text directly within the WYSIWYG preview. A popover will appear where you can enter and save your translation."

来源：[Editor Overview](https://support.crowdin.com/online-editor/) "WYSIWYG File Preview"。

### 1.7 文件浏览器

2025-08 起为常驻左侧可折叠面板（替代旧对话框）："A new file tree panel replaces the old file dialog, allowing you to manage content and files directly in the editor."（[What's New August 2025](https://crowdin.com/blog/whats-new-at-crowdin-august-2025)）。开关：Ctrl+[ 或 File > Open（Ctrl+O）。树顶部有 All Strings 项；底部显示选中项路径（如 `/app/src/main/res/values/strings.xml`）与选择摘要（`Currently selected: 3 files`）；经理可切换隐藏文件可见性；File > Recent Files 快速重开最近文件。来源：[Editor Overview](https://support.crowdin.com/online-editor/) "Switching Between Files and Folders"。

---

## 2. UI 背后的后端能力（documented，非营销话术）

### 2.1 Translation Memory

来源：[Translation Memory](https://support.crowdin.com/translation-memory/)、[TM Settings](https://support.crowdin.com/project-settings/translation-memories/)。

- **匹配三级**（官方定义原文）："Perfect Match - TM segment's text and context completely match the source string; 100% Match - TM segment's text matches the source string, but the context is different; Fuzzy Match (99% and less)"。Perfect 记为 101%。fuzzy 计算考虑词序、标点、格式标签、长于源文的匹配等因素。HTML 标签在匹配时替换为占位符，降低标签对匹配率的干扰。
- **Perfect match 的 context 定义可配**（TM Match Context Type）：Key and Context / Auto / Previous and next segment（前后句上下文，适合 HTML 类无 key 格式）。这说明后端同时存了 key、context 字段和段落邻接关系。
- **Auto-Substitution**：把 TM 建议里的非译元素（tags、HTML entities、换行、转义序列、placeholders、数字、大小写、特殊字符、URL、ICU 语法）替换为源串中的对应物，把 fuzzy 提升为可用建议；改进后的百分比在建议下方显示，影响成本报表口径。
- **Penalties（扣分规则）**：可对 TM 建议按条件降低匹配率：Auto-substitution Applied / Multiple Identical TM Matches / TM Priority Less Than N / Last Modified More Than N months / Last Used More Than N months。
- **TM 优先级**：多 TM 可赋 1-N 优先级，数字大优先。auto-translate 时建议排序参数链：Relevance → 是否被 auto-substitution 改进 → TM priority → 主语言优先于方言 → 创建日期新者优先。
- **TM 记录管理**：Translation Units / Segments 双视图；usage count、created、last modified、author 字段；Find & Replace；TMX/XLSX/CSV 上传下载；CSV/XLSX 列自动识别；TMX 导出带扩展元数据（`x-crowdin-metadata`、`creationid`、`creationdate`、`changeid`、`changedate`、`usagecount`、`lastusagedate`），官方明说这是给桌面工具离线清洗 TM 用的。
- **编辑器内直接编辑 TM 记录**：经理权限可在 Automated Suggestions 与 Search TM 内改/删 TM 段，全语言逐段编辑、Undo、清空全部段即删除该 TM 单元。
- **删除语义**（三种场景官方写死）：删 TM 单元不删项目译文；从 Activity 撤销翻译行为删译文不删 TM；在编辑器删某条译文则译文与对应 TM 记录一起删。
- 每译一条默认自动进项目 TM，可改为只存已批准译文（Save only approved suggestion to Translation Memory）。
- 方言回落（TM Suggestions for Dialects）：西语建议可显示给阿根廷西语，但 Search TM 不回落。

### 2.2 术语库（Glossary）

来源：[Glossary](https://support.crowdin.com/glossary/)。

- 两级模型：**Concept**（definition、subject、translatable、note、URL、figure）包含多语言 **Term**（term、language、part of speech、type、status、gender、description(context)、note、URL）。type 枚举含 full form/acronym/abbreviation/phrase/variant；status 枚举 preferred/admitted/not recommended（+draft）。
- 编辑器内表现：命中术语下划线，悬停出卡片（Translations / Source / Concept 三区），卡片内每条译法带 Insert 按钮；点击下划线直接把术语译文填进翻译框；术语无译文时点击对有术语管理权者打开 Edit Concept，否则打开 Terminology 面板。卡片"stays open while the pointer is on it... closes when you move the pointer away or when you press Esc"。
- 编辑器内建术语：选中词 → Create Term（默认 Ctrl+G）。
- 权限梯度：项目设置里可给译者/审校开 draft-only 或 full 术语管理权。
- TBX (v2/v3)、CSV、XLSX 上传下载；CSV/XLSX 列名自动识别（`Term [en]`、`Concept Definition` 等模式）。
- QA 联动：Consistent terminology 检查"translation doesn't use the glossary term for a source word, or uses a term marked not recommended or obsolete"。

### 2.3 机器翻译

来源：[Machine Translation](https://support.crowdin.com/machine-translation/)。

- 引擎：Crowdin Translate（自家，基于 Global TM，免 key）、Microsoft Translator（可选自定义模型、区域）、DeepL（formality、model type、tag handling XML/HTML、use context、style rule、DeepL 侧 TM 复用及阈值、custom instructions 每行一条至多 10 条 300 字符）、ModernMT、Amazon Translate（terminologies）、Google Translate、Google AutoML（自定义模型+词汇表）。
- 建议按引擎配置日期排序显示；MT 建议有缓存，缓存标 history 图标并显示 "Last updated: 7 hours ago"，可手动 Clear cache。
- 明确的工程细节：编辑器显示的简化标签（`<0>Sample</0>`）只是显示层，发给 MT 引擎的是原始 markup；标签错位是引擎行为不是 Crowdin 配置。

### 2.4 AI

来源：[Crowdin AI](https://support.crowdin.com/crowdin-ai/)、[Advisors](https://support.crowdin.com/advisors/)。

- Provider 体系（OpenAI、Azure OpenAI、Gemini、Anthropic、Mistral、DeepSeek、xAI、Watsonx、Groq 等，可装 Store 应用扩展），Crowdin 托管或自带 key。
- Prompt 类型：Auto-Translation & AI Suggestion / QA check / Advisor string context review / 自定义。Basic 模式勾选上下文源（其他语言译文、术语、TM 建议、风格指南、前后字符串、文件上下文、项目上下文、截图、AI 生成文件摘要）；Advanced 模式用占位符拼 prompt（`%strings%`、`%siblingsStrings%`、`%fileContext%`、`%filteredStrings%` 等全列表见来源页）。
- 编辑器内 AI Suggestion 显示于 Context & Translations；需在账户级选定默认 prompt，否则不显示。
- AI QA check（prompt 驱动的质检，Warning 级）与 Auto-retry on QA issues（AI 译文过不了 QA 自动重试）。
- AI Logs：30 天请求日志（状态、耗时、输入/输出 token、HTTP 状态码）。
- **Advisors**（2025 新）：后台巡检项目配置的"本地化 linter"，按严重度排卡片（缺截图、缺术语表、缺风格指南、上下文覆盖率低等），带一键修复动作、Dismiss 分组、outdated 自动重查。

### 2.5 QA 检查

来源：[QA Check Settings](https://support.crowdin.com/project-settings/qa-checks/)、[Custom QA Checks (Enterprise)](https://support.crowdin.com/enterprise/custom-qa-checks/)。

官方检查项全表（每项可配 Error 或 Warning）：

| 检查 | 官方描述要点 |
| --- | --- |
| Empty translation | 译文空而源文非空，或反之 |
| Length issues | 超出字符上限 |
| Tags mismatch | HTML 标签、id 属性或 CDATA 不一致 |
| Spaces mismatch | 首尾空格/换行、重复空格、特殊字符旁空格、不间断空格 |
| Variables mismatch | 占位符不一致 |
| Punctuation mismatch | 标点及标点前后空格 |
| Character case mismatch | 句首大小写或连续大写 |
| Special characters mismatch | 括号、引号、markup 实体、换段、货币符号 |
| "Incorrect translation" issues | 有未解决的 "Current translation is wrong" issue |
| Spelling mistakes | 词典外单词（固定 Warning） |
| ICU syntax | 破坏 ICU 语法/缺 `other` 复数形式/结构与源不同（固定启用，级别可选） |
| Consistent terminology | 未用术语或用了 not recommended/obsolete 术语 |
| Duplicate translation | 与已有译文重复（固定启用+固定 Error） |
| FTL syntax / Android syntax / MDX syntax | 格式特定语法（FTL、MDX 固定 Error） |
| Numbers mismatch | 数字缺失或不一致 |
| AI-powered check | 不满足 AI prompt 评估标准（固定 Warning） |
| Outdated translation | 译文早于源文变更（固定 Warning） |

- Error/Warning 语义（官方定义）："Warning: Translators see the QA issue along with suggestions for fixes and can still save the translation with Save anyway. Error: ... can save the translation only after resolving it."
- **Revalidate** 按钮全量重跑 QA（改设置/AI prompt/术语后用），跑时按钮禁用并出现 Cancel。
- 拼写检查按目标语言解释（"Spellcheck explanations are shown in the target language you're translating into"），有项目级 Ignore list，且明确与术语表隔离（加术语不等于加白名单）。
- QA 状态机（项目面板）：OFF / IN PROGRESS / NO ISSUES / ISSUES FOUND；语言级和文件级都有 QA 指示器，悬停显示 issue 数；点击进入编辑器时自动带 QA issues 过滤。
- Enterprise 另有 Custom QA Checks（用 JS 写自定义检查）。

### 2.6 评论与 Issue

来源：[Editor Overview](https://support.crowdin.com/online-editor/)、[Issues](https://support.crowdin.com/issues/)。

- 评论区支持 @username 定向；附件至多 10 个/条，可拖拽、可剪贴板粘贴，图片可预览、音视频可直接播放；右侧 Comments 图标带未读气泡计数。
- Issue 是评论区里的结构化子类型：勾选 Issue checkbox + 四个类型（官方枚举）：General question / Current translation is wrong / Lack of contextual information / Mistake in the source string。
- Issue 生命周期：报告者可 Edit/Resolve/Delete 自己的 issue；经理可过滤（With Unresolved Issues，当前语言或全语言）、回复（Ctrl+Enter 发送）、Resolve。
- Issue 联动 QA（"Incorrect translation" issues 检查项）、联动 Advanced Filter（按 issue 类型过滤）、联动 Jira/Slack/Webhooks。

### 2.7 截图与视觉上下文

来源：[Screenshots](https://support.crowdin.com/screenshots/)、[Screens Translation](https://support.crowdin.com/screens-translation/)、[In-Context](https://support.crowdin.com/developer/in-context-localization/)。

- 截图上传后三种打标法：Auto tag（OCR 识别图内文字并自动匹配项目字符串，可多图批量）；Text recognition（框选图内文字→系统全项目搜相似串）；手动拖拽（字符串列表拖到图上，可 Tag All）。
- 截图可换图保留标记："If the text on the screenshot changed its location, strings would remain tagged but on the new locations."
- 编辑器内截图查看器是重头交互（快捷键详见 §3.6）：可拖拽可缩放的浮层，记住上次尺寸位置；当前串实线框、其他串虚线框，点虚线框切换字符串不换图。
- **Screens Translation**：项目语言页可切换为"截图墙"替代文件列表，点图进编辑器，点图上色块 tag 加载对应字符串直接翻译；预览可切换状态描边（红/蓝/绿/黄）与译文替换视图。官方对比口径：对比 In-Context 的优势是"No Setup Required"、"Works with Mockups"（可用 Figma/Sketch/XD 插件推设计稿提前翻译）、"Consistent Performance"。
- **In-Context**：一行 JS + 伪语言包，把 Web 应用变成可就地编辑的翻译环境；伪语言把每条源串换成 `crwdns123456:0crwdne123456:0` 型标识符，脚本扫描替换为可编辑标签；弹出的是"simplified version of Crowdin Editor... with all the functionality (TM, machine translation, approve/vote option, comments, terms)"。可选参数：preload_texts（5000+ 串项目自动关闭）、touch_optimized、before_commit 校验回调、before_dom_insert、manual start（SPA 用 `window.jipt.start()/stop()`）、只截可视区、只标可见串。Shadow DOM 明确不支持。

### 2.8 任务

来源：[Project Tasks](https://support.crowdin.com/tasks/)、[User Tasks](https://support.crowdin.com/user-tasks/)。

- 类型四种：Translate by own translators / Proofread by own proofreaders / Translate by vendor / Proofread by vendor。字符串筛选（按修改期、按 label 含/排、仅 auto-translated 串）、按语言拆分子任务、Split files/strings 按词量分给多人。
- 序列任务：翻译任务可挂 pending 校对任务，翻译完成自动把校对任务从 Pending 变 To Do 并通知。
- 看板三列 To Do / In Progress / Done + Closed/Pending 状态；All Tasks 列表批量改状态/指派/删除；成本挂钩（Rates template + 自动 Cost Estimate / Translation Cost 报表 + Rates Mismatch 标签）。
- **Task-based access control**：开启后译者/审校在任务范围外只读，"users see a notice that active access to strings is available only through assigned tasks"。
- 编辑器内任务态：File 菜单被 Task 菜单替换（含任务级 Export/Upload、Project Strings 退出任务视图）；过滤与搜索只作用于任务范围。

### 2.9 工作流（Enterprise 专属）

来源：[Workflow Overview](https://support.crowdin.com/enterprise/workflows/)、[Source Text Review](https://support.crowdin.com/enterprise/source-text-review/)。

步骤类型全表：Source Text Review、Custom Code（JS 条件分流字符串）、Switch Source Language、TM Auto-Translation（40%-101% 阈值可配）、MT Auto-Translation、AI Auto-Translation、Translation、Translation by Vendor、Translation by API Vendor、Crowdsourcing、Proofreading、Proofreading by Vendor、App-based Step。步骤可并联可串联，模板可复用。

Source Text Review 值得单独记：源文先审后译，编辑器进 Review mode，"If the source text is correct, click Approve... If the source text requires edits, enter the corrected version and click Save"，改动积累后一键 Apply reviewed 回写源文件，弹 Keep translations for changed strings 对话框逐串决定保留译文/批准。crowdin.com 无工作流引擎，只有"标准项目生命周期"。

### 2.10 报表

来源：[Project Reports](https://support.crowdin.com/project-reports/)、[Contributor Reports](https://support.crowdin.com/contributor-reports/)。

- Project Overview：Translatable/Hidden/Total 词量、Activity Summary（翻译分 Human/TM/MT/AI 四线图）、Translation Savings（默认 Net Rate Scheme：TM Perfect 5% 净率/95% 节省，100% 15%/85%，95-99% 35%/65%，85-94% 55%/45%，75-84% 75%/25%，<75% 无节省；MT/AI 另一张表）、Source Content Updates、QA Check Issues（含 per-1000-words 密度和语言×类型热力图）、Reported Issues（平均解决时长、Top Reporters & Resolvers）、Project Members。
- Cost Estimate（预算）与 Translation Cost（实付）：报价单位 words/strings/chars；Net Rate Schemes 可自定义匹配档；加权字数（weighted words）概念；内部模糊匹配（internal fuzzy match）预测；报表进队列后台生成，Archive 存档。
- Auto-Translation Accuracy 与 Translator Accuracy：以"初始译文 vs 最终批准译文"的字符级 Match Score 度量后编辑量，评估各 AI prompt/MT 引擎/译员的质量。
- Top Members 排行（Translated/Approved/Voted/"+"votes/Winning 列）。

### 2.11 权限模型

来源：[Roles](https://support.crowdin.com/roles/)。

角色：Owner / Manager / Developer (Translation Requestor) / Language Coordinator / Proofreader / Translator / Member / Blocked。编辑器内的关键裁决：

- Translator 可加译文、可投票，不能批准；"In the Editor, voting and approving are mutually exclusive: vote controls appear only for Translators"（同一 UI 面板按角色渲染投票或批准控件，二选一）。
- Translator 只能删自己的译文；Proofreader 及以上可删他人译文、可解除批准。
- 隐藏字符串默认只有 Manager+ 可见，可开选项放给审校。
- 源文编辑（context、key、max length）仅 Developer+。

### 2.12 字符串与文件管理

来源：[String Management](https://support.crowdin.com/string-management/)、[File Management](https://support.crowdin.com/file-management/)、[Import Settings](https://support.crowdin.com/project-settings/import/)、[Custom Segmentation](https://support.crowdin.com/custom-segmentation/)、[Version Management](https://support.crowdin.com/version-management/)。

- 字符串级元数据：identifier、context、labels、max length（比例/固定/无限三模式）、visibility、plurals（CLDR 规则）、复数/ICU 类型、优先级。经理可在编辑器内直接 Add/Edit/Delete/Hide 字符串（限支持的格式）。
- **重复串管理**是一等公民：master string / duplicate 概念；检测基（regular 只比源文 / strict 比源文+key）× 可见性 × 译文共享，共 6 档（Show / Show but auto-translate / Show within a version branch regular / strict / Hide regular / Hide strict）；共享译文的继承与回退规则写得非常细（"If a unique translation is saved for a duplicate... it stops inheriting; If that unique translation is later removed, sharing is restored automatically"）。
- 文件级：优先级（低/普通/高，影响译者看到的排序）、对译者显示的友好标题、导出路径模板（`Overview.%language%.csv`）、文件级目标语言豁免、文件上下文、修订版本可回滚（Revisions 列）、分支管理。
- 更新源文件时的 **Keep Translations for Updated Strings** 对话框：逐串对比 Current/New（绿增红删高亮），勾选保留译文 + 底部 Keep Approvals 选项。
- **SRX 2.0 自定义分段**：HTML/MD/XML 等无 key 格式按 SRX 分段，可按文件粘贴自定义 SRX 规则，保存即重新导入分段。
- 词数统计规则页（[Word Counter](https://support.crowdin.com/word-counter/)）给出完整口径：URL/email 算 1 词、中日文按字计、HTML 标签在部分格式不计词等。

### 2.13 离线翻译（对桌面 CAT 最直接相关）

来源：[Offline Translation](https://support.crowdin.com/offline-translation/)。

- 官方承认桌面 CAT 工作流："Offline translation allows you to work on project files outside Crowdin using your preferred desktop CAT tools."
- 导出：单文件（原格式或 XLIFF）、按语言全量（ZIP 或单个 XLIFF）、**按当前过滤条件导出 XLIFF**（Export Filtered in XLIFF，可在编辑器内应用过滤后导出）。
- XLIFF `state` 属性契约：`needs-translation` / `translated` / `final`（=已批准）；回传时 state 不对则译文不进项目。
- 回传高级选项：Allow target translation to match source / Approve added translations / Translate hidden strings。

### 2.14 documented vs marketing 的分界

- 文档站（support.crowdin.com）的能力描述基本全部可操作核验：每个功能给出入口路径、枚举值、边界（128 字符搜索上限、5000+ 串关 preload、10 附件上限、30 天 AI 日志）。本节以上所有引用都取自文档站或开发者门户。
- 营销页（如 [Translators Workbench](https://crowdin.com/features/translators-workbench)）话术需要打折的例子："The workspace built for linguists"、"Stop guessing. Crowdin brings the context to you."、"Translate smarter, not harder"、"Join thousands of linguists who love working in Crowdin"。其中 "Real-time AI agent"（侧栏改写/换语气/解释成语）对应的是 Store 里的 Crowdin Copilot 应用而非编辑器内建（文档站 For Translators 页写明 "ask your project owner to install and configure the Crowdin Copilot app from the Crowdin Store"）。营销页的 "{count}+ languages" 模板变量泄漏也提示其可信度层级低于文档。
- 社区论坛暴露了文档不写的真实摩擦：批准遇 QA 警告要点两次（Approve → Approve anyway）且鼠标要重新定位，300 串一坐就是 300 次（[社区帖 1095](https://community.crowdin.com/t/is-it-possible-to-change-editor-ui/1095)）；批量批准的入口藏在 Side-by-Side 模式，用户在其他模式找不到全选控件（[社区帖 11186](https://community.crowdin.com/t/select-all-strings-for-bulk-approval/11186)、[社区帖 3789](https://community.crowdin.com/t/bulk-approve-translations-retroactively-under-certain-conditions/3789)）。

---

## 3. 前端交互逻辑

### 3.1 保存 vs 批准：两个动词，两级状态

来源：[Editor Overview](https://support.crowdin.com/online-editor/)。

- **Save translation** 是译者的动词，把输入变成一条 suggestion；**Approve** 是审校的动词，把某条 suggestion 变成导出用译文。两级状态（translated / approved）贯穿列表图标、预览着色、过滤器、进度环、报表。
- Auto-save 默认关闭。开关改变主按钮视觉语义："When Auto-save is disabled, the Save translation button acts as the primary action and appears green. When Auto-save is enabled, the button becomes gray, as manual saving is optional." 保存时短暂显示 "Saving…" → "Saved"。
- Automatically move to next string 默认开启：保存或批准后自动跳下一条。
- Auto-approve 选项：审校及以上加的译文自动带批准。
- 未保存状态有全局出口：右上角 Unsaved Translations 图标（绿点+计数 tooltip）→ Save All / View Strings；过滤器里有对应的 Unsaved Translations 项。放弃当前输入用 Cancel 回退到保存前状态。
- 批量批准：勾选左侧 checkbox → Approve；Multilingual 模式下批量批准作用于所有选中语言。

### 3.2 QA 拦截时机与逃生门

来源：[Editor Overview](https://support.crowdin.com/online-editor/) "QA Checks"、截图 `crowdin-qa_inline_banner.webp`。

- 触发时机：手动保存或 auto-save 切串瞬间。
- Error（阻塞）：内联横幅 "Review issues to save" + Save 按钮橙色警示徽章；保存与导航（换语言、换文件、改过滤器）都被阻止；悬停 Save 出 tooltip "Resolve blocking issues first"；即使个人设置关掉 QA 提示 Error 仍强制。允许换到别的字符串继续干活，但当前串保持未保存。
- Warning（非阻塞）：设置开时显示横幅可 **Save Anyway**；设置关时直接静默保存。
- **Autofix**：横幅内单条修复图标 + 头部 "Fix (N)" 一键全修，修完自动保存放行。
- 译文框内可开 Translation field highlighting，潜在 QA 问题词下划线；Real-Time Spellcheck 实时打分（无问题绿标，有问题红色计数标签，官方注明内建拼写检查优先级高于 Grammarly/LanguageTool 浏览器扩展）。

### 3.3 建议的应用路径

来源：[Editor Overview](https://support.crowdin.com/online-editor/)。

- 点击任一 TM/MT/AI 建议 → 填入翻译框（还需手动保存）；建议卡上另有 **Use and Save** 一步到位。
- TM 建议卡显示：TM 名、匹配百分比、创建日期、原贡献者（"by Michael Ross (m.ross)"）；101% 且曾被批准的建议带 **High relevance suggestion** 标签。
- Comfortable 模式的 Text selection mode：从 TM/MT 建议里只拷一部分文字。
- 术语插入：点下划线术语直接填入；多译法时悬停卡片选 Insert。
- Translation alignment（词对齐提示）：源文中已有历史译法的词加虚线下划线，悬停显示历史译法及使用次数（[Translation Consistency](https://support.crowdin.com/translation-consistency/)，试验性 ML，源语限英语系）。
- Auto-complete：输入时弹出翻译预测补全（可关）。
- Copy Source（Alt+C）与 Copy Source Skeleton（只拷贝不可译元素骨架），均支持多选批量。

### 3.4 源文选区 → 上下文菜单

选中源文或译文中的词后出现图标，点开菜单（官方枚举）：Search TM / Search in Terminology and Wikipedia / Create Term / Transform（仅译文，大小写转换）/ Copy / Copy & Paste（拷贝并立即粘到翻译框）。这是"源文选区驱动资源检索"的直接证据：TM 与术语检索不必离开当前字符串。来源：[Editor Overview](https://support.crowdin.com/online-editor/) "Context Menu Options for Selected Words"。

### 3.5 过滤器体系（三层）

来源：[Editor Overview](https://support.crowdin.com/online-editor/)。

1. **基础过滤**（一层菜单）：Show All / All, Untranslated First / Untranslated / Need to Be Voted / Not Approved / Approved / Unsaved Translations / QA issues（可细到具体检查类型）/ Machine Translations（TM/MT/AI 原样未改的译文，"Often these strings require additional review"）/ With Comments / With Unresolved Issues（当前或全语言）/ Hidden / Advanced Filter / AI/CroQL Filter。
2. **Advanced Filter**（组合面板）：Labels 含/排（All/Any 逻辑）、Duplicates（Master/Duplicates Only/共享译文/自有译文）、Visibility、QA Issues（含 Without QA Checks、QA check in progress）、Strings Added/Updated、Translations Updated 日期区间、Verbal Expression（结构模式匹配，配 Scope）、Translations 状态、Approvals 状态、Engine（MT/TM/AI/Any）、Translation Method（Auto/Manual）、Comments（含四种 issue 类型）、Screenshots 有无、String Type（Simple/Plurals/ICU）、Votes 大于/小于、Translated By / Approved By 具体成员。排序：Original/Added/Updated/Last Comment/Alphabet(Source/Identifier)/Length/Votes ± 升降序。
3. **AI/CroQL Filter**：自然语言 → AI 生成 CroQL 表达式，或直接写 [CroQL](https://support.crowdin.com/developer/croql/)。
- 轻量入口：点字符串上下文区的 label 标签即"以该标签过滤"（tooltip `Filter by label: {label-name}`），并清空其他条件；再点别的标签则替换。
- Multilingual 模式下过滤语义是 OR-across-languages：任一选中语言满足条件即显示。

### 3.6 键盘

官方文档写死的默认键：

| 键 | 动作 | 来源 |
| --- | --- | --- |
| Ctrl+F / ⌘+F | 聚焦字符串搜索框 | [Editor Overview](https://support.crowdin.com/online-editor/) |
| Ctrl+K / ⌘+K | 命令面板 | 同上 |
| Ctrl+Shift+K / Shift+⌘+K | 快捷键列表（可就地改键） | 同上 |
| Ctrl+O / Cmd+O | 打开文件面板 | 同上 |
| Ctrl+[ | 开合文件浏览器 | 同上 |
| Alt+C | Copy Source（RTL 流程官方步骤 1） | 同上 "Translating RTL Languages" |
| Ctrl+F / Ctrl+D（预览内） | 预览全屏 / 双栏预览 | 同上 "WYSIWYG File Preview" |
| Ctrl+G | 选中词建术语 | [Glossary](https://support.crowdin.com/glossary/) |
| Ctrl+Enter / ⌘+Enter | 评论区发送回复 | [Issues](https://support.crowdin.com/issues/) |
| Space / 1 / C / ← → / Esc；Ctrl+滚轮缩放；点击放大 200%、Alt+点击缩小 | 截图查看器全套 | [Editor Overview](https://support.crowdin.com/online-editor/) "Screenshot Viewer" |

补充证据：

- 保存译文的默认键是 Ctrl+Enter / ⌘+Enter。官方文档站不在页面上列出该键（快捷键全表只在产品内），第三方接入方文档记录了它："click to Save the translation (or use Ctrl+Enter or ⌘+Enter)"（[ControlShift Labs 帮助中心](https://support.controlshiftlabs.com/article/421-help-for-translators-getting-started-in-crowdin)）。
- "Most of the hotkeys can be customized to your personal preferences. Click on the necessary key combination, and modify it with the help of your keyboard."（编辑器内改键，[Editor Overview](https://support.crowdin.com/online-editor/)）
- 2024-08 起 "Crowdin Editor tooltips now show the hotkey you can use to activate the same action"（[What's New August 2024](https://crowdin.com/blog/what-is-new-at-crowdin-agust-2024)）。
- Enterprise 工作区（编辑器外）用 Gmail 式序列键：`g then w` 去 Workspace、`p then s` 去 Strings 等（[Keyboard Shortcuts](https://support.crowdin.com/enterprise/keyboard-shortcuts/)）。

### 3.7 命令面板

> "The Command Palette in the Editor is your hub for accessing various commands efficiently. It serves as a central location for all available commands."
> —— [Editor Overview](https://support.crowdin.com/online-editor/)

入口三个：右上角图标、Help > Open Command Palette、Ctrl+K。截图 `crowdin-command_palette.webp` 显示为居中搜索框 + 命令列表（行尾带对应快捷键）。

### 3.8 预览与就地编辑

§1.6 已述结构，交互补充：Dual Preview 中"clicking a string in the Source panel will automatically highlight the corresponding string in the Translation panel (and vice versa) while opening the translation popover"，气泡里可展开 Source String 对照。这实现了"预览即编辑器"的第二入口，且与字符串列表选区互通。

### 3.9 特殊内容处理

- 复数：按 CLDR 规则渲染 N 个表单分区输入（[Editor Overview](https://support.crowdin.com/online-editor/) "Plural Forms"）。
- ICU：语法检查 + Copy Source Skeleton + [ICU Message Syntax](https://support.crowdin.com/icu-message-syntax/) 专页。
- HTML 标签显示三态 Show/Hide/Auto，隐藏时 `<a href="...">Sample</a>` 显示为 `<0>Sample</0>`。
- RTL：官方推荐流程是 Copy Source（Alt+C）→ 翻译 → 变量标签原样不动（"Leave variables, tags, etc., unchanged in the translation, even if they look wrong. They will be in the right positions in the exported file."）。
- 不可打印字符显示开关；Compact strings view（长串只显示开头）；色盲配色开关。

---

## 4. 文案与密度

### 4.1 Crowdin 的标注习惯（值得学）

从官方截图与文档 UI 词表提取：

- **短动词按钮**：Save / Cancel / Approve / Fix (N) / Save Anyway / Use and Save / Insert / Request / Resolve / Reply / Dismiss / Revalidate / Auto-Translate / Upload / Download。没有一个按钮超过三个词。
- **面板小标题全大写名词**：CONTEXT & TRANSLATIONS / FRENCH TRANSLATIONS / AI SUGGESTION / TM AND MT SUGGESTIONS / OTHER LANGUAGES / COMMENTS / SOURCE STRING（截图证据 `crowdin-sbs_editor.webp`、`crowdin-comfortable.webp`）。
- **状态词是裸形容词**：untranslated / translated / approved / hidden，配固定色（红/蓝/绿/灰 + 活动黄）。
- **计数即信息**：`10 STRINGS`、`28/10`（长度限制超限计数）、`0/10`（评论附件位）、未读气泡、圆环上直接写 64%/17%。密度靠徽章和计数撑，不靠句子。
- **QA 消息模式 = 事实 + 恢复动作**："Source text does not end with "!". Please remove "!" from the end of the translation."（截图证据）。一句事实一句动作，无客套。
- **空态一句话**："No translations suggested yet"（Comfortable 截图）。无插画式空态叙事。

### 4.2 与 Translunar 文案规则冲突的部分（不要抄）

我们的规则（`docs/design.md` §10）：禁描述性副标题、引导性 microcopy、功能叙事、"不是"式对比句、营销填充词。Crowdin 违例主要集中在营销层和文档层，编辑器 UI 本身较克制：

- 营销页 slogans 全数不可入库："Stop guessing. Crowdin brings the context to you."、"Translate smarter, not harder"、"The workspace built for linguists"、"Your editor, your way"（[Translators Workbench](https://crowdin.com/features/translators-workbench)）。
- 文档腔的引导句不进 UI："It's always better to ask than assume."、"Don't guess-report the issue"（[Issues](https://support.crowdin.com/issues/)）这是帮助文章语气，如果搬进界面就违反我们的 no-guiding-microcopy 规则。
- Crowdin UI 里也有轻微的叙事倾向可警惕：Advisors 卡片的 "Why this matters" 区块是解释性段落（[Advisors](https://support.crowdin.com/advisors/)）。桌面版做同类巡检时应把结论压缩到一行事实 + 一个动作按钮。
- 命名不一致的教训：同一动作在文档里叫 Auto-Translate、在旧截图菜单里叫 Pre-translate（`crowdin-string_menu.webp` 显示 "Pre-translate"，[Editor Overview](https://support.crowdin.com/online-editor/) 现行文本为 "Auto-Translate"），产品改名留下截图残影。动词表要一次定死。

### 4.3 密度结论

Crowdin 编辑器单屏信息密度分层明确：列表行两行制（源文 + 灰色 key），行内 QA/评论/截图以图标和色块表达；右面板折叠段落制，默认只展开当前需要的节。Grid 模式提供三档行密度（Compact/Medium/Large）交给用户。Translunar 的表格行密度与徽章语言可直接对标这套分层，而不需要它的营销词汇。

---

## 5. 桌面本地 CAT：该偷什么、该跳过什么

判断基准：Translunar 是本地优先 Electron CAT，单机翻译者场景为主，没有多人在线协作的诚实实现路径（引擎侧已有 TM/TB/QA/过滤器/资产库，见 `docs/research-rebase-from-mature-cat.md`）。

### 5.1 偷（Top 15，按优先级）

1. **选区即状态源**：当前字符串是唯一引力中心，TM/术语/QA/评论/预览全部是它的投影，切行即全刷新（§1.4）。这是工作台重构的骨架原则。
2. **保存与批准分离的两级状态**（translated / approved）+ 列表、预览、过滤器、进度环全链路一致的状态色（§3.1）。单机同样成立：自译自审是真实校对流程。
3. **QA Error/Warning 双级 + 保存瞬间拦截 + Save Anyway 逃生门 + Fix (N) 一键自动修复**（§3.2）。QA 检查项清单（§2.5 表格）可直接作为我们 QA 引擎的验收清单。
4. **TM 匹配语义全套**：101/100/fuzzy 三级、context 参与匹配（且 context 定义可配）、auto-substitution 提升 fuzzy、penalties 降权、多 TM 优先级（§2.1）。这是 TM 从"存储"变"产品"的分水岭。
5. **过滤器三层结构**：一层常用枚举（Untranslated First、Not Approved、QA issues、Machine Translations…）+ Advanced 组合面板 + 查询语言兜底（§3.5）。桌面版可把 CroQL 换成本地查询表达式。
6. **Export Filtered（按当前过滤条件导出 XLIFF）与 XLIFF state 契约**（needs-translation/translated/final）（§2.13）。这直接是本地 CAT 的交换格式规范。
7. **源文选区 → 上下文菜单**：Search TM / 查术语 / Create Term（Ctrl+G）/ 大小写转换 / Copy & Paste（§3.4）。低成本高频交互。
8. **术语两级模型（concept/term）+ 悬停卡 + 点击即插入 + 编辑器内建术语**（§2.2）。TBX v2/v3 + CSV/XLSX 列自动识别也照抄。
9. **命令面板（Ctrl+K）+ 全部快捷键可改 + tooltip 显示热键**（§3.6、§3.7）。改键界面"点组合键直接按新键"的交互也值得抄。
10. **截图上下文**：截图挂串、查看器随选中行联动、实线/虚线框区分当前串（§2.7）。本地版可对接本地图片文件夹与 OCR 自动打标。
11. **重复串 master/duplicate 模型 + 检测基（regular/strict）+ 译文继承与自动回退**（§2.12）。文档级翻译里重复段极常见，这套语义完整且经过验证。
12. **更新源文件时的 Keep Translations 对话框**：逐串 diff（绿增红删）、勾选保留、Keep Approvals（§2.12）。本地文件重导入场景一模一样。
13. **未保存状态的全局出口**：Unsaved 图标 + 计数 + Save All + 专用过滤器（§3.1）。防丢稿是桌面应用的底线体验。
14. **预览即第二编辑入口**：WYSIWYG 状态着色四色 + 点句选行 + Dual Preview 双向高亮 + 气泡就地编辑（§1.6、§3.8）。Translunar 已有预览跳转，目标形态是这个。
15. **QA 消息文案模式**：一句事实 + 一句恢复动作，短动词按钮，全大写小节标题，计数徽章表密度（§4.1）。这套文案纪律与我们的 copy 规则兼容。

### 5.2 跳过（云端剧场与不适配项）

- **多人建议流 + 投票 + Top Members 排行**：suggestion 多版本共存、+/- 投票、Winning 计数是众包协作机制，单机没有诚实实现（§2.6 voting、§2.10）。单机只需要"译文 + 历史版本"。
- **Tasks/看板/序列任务/供应商市场/成本报表**：To Do 看板、Translate by vendor、Rates template、Net Rate Scheme 全是多人商务结算件（§2.8、§2.10）。桌面版最多要一个"待办过滤器"，不要看板。
- **Workflow 引擎与 Crowdsourcing 步骤**（Enterprise）：可视化步骤编排为组织协作设计（§2.9）。单机的"工作流"就是过滤器 + 状态。
- **In-Context JS 注入**：依赖伪语言包 + 目标站点部署脚本，纯 Web SaaS 形态（§2.7）。桌面版的对等物是本地预览，而不是往用户网站里注 JS。
- **Global TM / Crowdin Translate**：跨租户共享 TM 云资产（§2.3）。本地版没有对应物，MT 接第三方 API 即可。
- **Advisors 的云巡检形态照单全收不必**：概念可借鉴（项目健康度检查），但卡片式"Why this matters"叙事与我们文案规则冲突，桌面版压成一行事实 + 动作（§4.2）。
- **权限矩阵**：八角色矩阵是多租户产物（§2.11）。单机保留"翻译 / 审校"两顶帽子（模式切换）即可，不建角色系统。
- **评论区 @提及、未读气泡、Jira/Slack 联动**：无协作对象（§2.6）。可保留单机"串级备注"作为 issue 的退化形态。
- **报表家族大部**：Savings/Accuracy/Cost 系列服务于甲方汇报（§2.10）。单机保留字数统计口径（Word Counter 规则页很有参考价值）与简单进度即可。

### 5.3 有条件借鉴

- **Auto-Translate 批处理对话框**（作用域 Selected/Filtered/File/All + 已有译文三种处置 + Skip approved）：单机预翻译完全适用，但去掉 vendor/queue 部分（§2.10 之 auto-translation、[Auto-Translation](https://support.crowdin.com/auto-translation/)）。
- **SRX 自定义分段**：引擎已支持 SRX 的话，把"按文件粘贴 SRX 规则、保存即重分段"的交互抄过来（§2.12）。
- **Screens Translation 截图墙**：以截图为一等导航对象翻 UI 文案的思路可用于本地截图文件夹场景，优先级低（§2.7）。
- **AI prompt 的上下文装配清单**（前后串、文件上下文、术语、TM、风格指南、其他语言译文）：这份清单就是本地 AI 辅助的 context builder 规格，但 provider 管理台、日志台从简（§2.4）。

---

## 附录 A：实际阅读的官方页面

文档站（support.crowdin.com，含开发者门户）：

1. https://support.crowdin.com/ （站点首页）
2. https://support.crowdin.com/online-editor/ （核心，全文）
3. https://support.crowdin.com/enterprise/online-editor/ （对照 Enterprise 差异）
4. https://support.crowdin.com/enterprise/keyboard-shortcuts/
5. https://support.crowdin.com/translation-memory/
6. https://support.crowdin.com/project-settings/translation-memories/
7. https://support.crowdin.com/glossary/
8. https://support.crowdin.com/project-settings/glossaries/
9. https://support.crowdin.com/project-settings/qa-checks/
10. https://support.crowdin.com/enterprise/custom-qa-checks/
11. https://support.crowdin.com/machine-translation/
12. https://support.crowdin.com/project-settings/machine-translation/
13. https://support.crowdin.com/crowdin-ai/
14. https://support.crowdin.com/advisors/
15. https://support.crowdin.com/tasks/
16. https://support.crowdin.com/user-tasks/
17. https://support.crowdin.com/screenshots/
18. https://support.crowdin.com/screens-translation/
19. https://support.crowdin.com/developer/in-context-localization/
20. https://support.crowdin.com/developer/crowdin-apps-module-editor-right-panel/
21. https://support.crowdin.com/issues/
22. https://support.crowdin.com/project-reports/
23. https://support.crowdin.com/contributor-reports/
24. https://support.crowdin.com/string-management/
25. https://support.crowdin.com/file-management/
26. https://support.crowdin.com/uploading-files/
27. https://support.crowdin.com/project-settings/ （General）
28. https://support.crowdin.com/project-settings/privacy-collaboration/
29. https://support.crowdin.com/project-settings/import/
30. https://support.crowdin.com/project-settings/export/
31. https://support.crowdin.com/project-settings/languages/
32. https://support.crowdin.com/project-settings/labels/
33. https://support.crowdin.com/project-settings/auto-translate/
34. https://support.crowdin.com/auto-translation/
35. https://support.crowdin.com/translation-strategies/
36. https://support.crowdin.com/translation-consistency/
37. https://support.crowdin.com/offline-translation/
38. https://support.crowdin.com/downloading-translations/
39. https://support.crowdin.com/uploading-translations/
40. https://support.crowdin.com/version-management/
41. https://support.crowdin.com/custom-segmentation/
42. https://support.crowdin.com/word-counter/
43. https://support.crowdin.com/style-guide/
44. https://support.crowdin.com/icu-message-syntax/
45. https://support.crowdin.com/expression-syntax-elements/
46. https://support.crowdin.com/supported-formats/
47. https://support.crowdin.com/roles/
48. https://support.crowdin.com/for-translators/
49. https://support.crowdin.com/discussions/
50. https://support.crowdin.com/project-activity/
51. https://support.crowdin.com/bundles/
52. https://support.crowdin.com/enterprise/workflows/
53. https://support.crowdin.com/enterprise/source-text-review/
54. https://support.crowdin.com/enterprise/comparing-crowdin-and-crowdin-enterprise/

官方博客（版本演进证据）：

55. https://crowdin.com/blog/whats-new-at-crowdin-april-2025 （全文）
56. https://crowdin.com/blog/year-in-review-2024 （检索摘录）
57. https://crowdin.com/blog/what-is-new-at-crowdin-agust-2024 （检索摘录）
58. https://crowdin.com/blog/what-is-new-at-crowdin-february-2024 （检索摘录）
59. https://crowdin.com/blog/whats-new-at-crowdin-august-2025 （检索摘录）

官方营销页（用于 §4.2 话术对照）：

60. https://crowdin.com/features/translators-workbench

## 附录 B：社区与第三方来源

- https://community.crowdin.com/t/is-it-possible-to-change-editor-ui/1095 （批准遇 QA 需二次点击的摩擦）
- https://community.crowdin.com/t/select-all-strings-for-bulk-approval/11186 （批量批准入口只在 Side-by-Side）
- https://community.crowdin.com/t/bulk-approve-translations-retroactively-under-certain-conditions/3789 （批量批准官方指引）
- https://support.controlshiftlabs.com/article/421-help-for-translators-getting-started-in-crowdin （Ctrl+Enter 保存默认键的第三方记录）

## 附录 C：截图存档清单

本地路径 `/opt/cursor/artifacts/research-crowdin/`，均取自 https://support.crowdin.com/online-editor/ 页面的 `/_astro/` 资源：

| 文件 | 内容 | 原始 URL |
| --- | --- | --- |
| crowdin-sbs_editor.webp | Side-by-Side 全貌（列表、行内 QA、右面板、评论） | https://support.crowdin.com/_astro/sbs_editor.BS-ZxXRm_Zx14K0.webp |
| crowdin-comfortable.webp | Comfortable 全貌（Files/Strings 双视图、建议流） | https://support.crowdin.com/_astro/comfortable.hESNiXLa_Z1keg73.webp |
| crowdin-multilingual_mode_grid.webp | Grid 模式 + 列设置下拉 | https://support.crowdin.com/_astro/multilingual_mode_grid.gtR0jzS2_1IkU7r.webp |
| crowdin-qa_inline_banner.webp | "Review issues to save" 横幅 + Fix (1) | https://support.crowdin.com/_astro/qa_inline_banner.DApPNT8c_Z2imeFL.webp |
| crowdin-string_menu.webp | String 菜单全项（含 Pre-translate 旧名） | https://support.crowdin.com/_astro/string_menu.CvsQD0lT_Z1q3D1R.webp |
| crowdin-html_preview.webp | WYSIWYG 预览 | https://support.crowdin.com/_astro/html_preview.sFZ8q48B_ZxkAj9.webp |
| crowdin-wysiwyg_inline_editing.webp | 预览内联编辑气泡 | https://support.crowdin.com/_astro/wysiwyg_inline_editing.evo1GHyA_Z1wqk5z.webp |
| crowdin-search_tm_tab.webp | Search TM 面板 | https://support.crowdin.com/_astro/search_tm_tab.CUo6F_c8_Z1x8XKl.webp |
| crowdin-terms.webp | 术语面板卡片 | https://support.crowdin.com/_astro/terms.Y68OjtP6_QJuyn.webp |
| crowdin-screenshots_in_editor.webp | 截图上下文卡片 | https://support.crowdin.com/_astro/screenshots_in_editor.BamxfLja_ZzjowT.webp |
| crowdin-advanced_filter.webp | Advanced Filter 面板 | https://support.crowdin.com/_astro/advanced_filter.un8wxhak_1D1zXx.webp |
| crowdin-command_palette.webp | 命令面板 | https://support.crowdin.com/_astro/command_palette.CsyRr3V8_Z6U6MC.webp |
| crowdin-file_browser.webp | 文件浏览器面板 | https://support.crowdin.com/_astro/file_browser.CYOkanLz_1llk6Y.webp |
| crowdin-multi_approve.webp | 批量批准 | https://support.crowdin.com/_astro/multi_approve.CERYoBfo_1L0XSy.webp |
| crowdin-vote.webp | 投票控件 | https://support.crowdin.com/_astro/vote.DCDIAaaS_k4U1I.webp |

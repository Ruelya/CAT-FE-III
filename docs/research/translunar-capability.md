# Translunar 能力盘点：真实引擎 vs. 工作台愿景草图

> 调研基线：分支 `cursor/gf-copy-audit-2398`，commit `8f958ee`（Trados 式编辑器：输入即草稿、Ctrl+Enter 确认；说明性文案已剥离）。
> 方法：只读代码盘点（`packages/contracts`、`crates/*`、`apps/desktop`），逐文件核对，不做假设。
> 用途：为后续 PRD 划定"真实能力边界"——凡标注 NEVER-FAKE 的项，PRD 不得以假 chrome 呈现。
> **⚠️ 严重过时（历史快照，只当目录、不当事实）**：gf-tm-context tip 上协议已是 **61 方法 + 2 通知**
> （新增 `segment.lock`、`memory.*` 多库、`qa.profile.*`、`ai.profile.*` 等），并已落地 origin 体系、
> Agent 三档审批与 TM/邻句/文档抽样 grounding。当前事实见 `docs/research/completeness.md`。

---

## 一、引擎 RPC 契约清单

来源：`packages/contracts/src/protocol.generated.ts`（由 Rust `tl-protocol` schema 生成）与 `crates/tl-engine/src/*`。共 **57 个方法 + 2 个通知帧**。引擎为单进程单线程 stdio JSONL 服务；AI 调用在 worker 线程执行，事件回流主循环。

### 1.1 握手与生命周期（engine.*）

| 方法 | 入参 | 返回字段 |
| --- | --- | --- |
| `engine.initialize` | `clientName` `clientVersion` `protocolVersion` | `engineName` `engineVersion` `protocolVersion` `capabilities{aiAgent, aiAssist, filters[], notifications}` |
| `engine.shutdown` | 无 | `ok` |

已注册 filter id（`Engine::open` 实际注册，`crates/tl-engine/src/lib.rs`）：`builtin.docx`、`builtin.txt`、`builtin.markdown`、`builtin.html`、`builtin.xliff`、`builtin.xlsx`、`builtin.pptx`，以及仅显式指定才启用的 `builtin.bilingual-docx`、`builtin.bilingual-xlsx`（双栏对照表模式，probe 永不命中）。

### 1.2 项目（project.*）

| 方法 | 入参 | 返回字段 |
| --- | --- | --- |
| `project.create` | `name` `sourceLocale` `targetLocale` | `Project` |
| `project.list` | 无 | `projects: Project[]` |
| `project.get` | `projectId` | `Project` |
| `project.update` | `projectId` + 可选 `name` `sourceLocale` `targetLocale` `segmentation` `srxPath` `clearSrxPath` | `Project` |
| `project.archive` | `projectId` `archived?`（默认 true，可逆） | `Project` |

`Project` 字段：`id` `name` `sourceLocale` `targetLocale` `domain` `lifecycle(active/archived/trash)` `archivedAtMs?` `revision` `createdAtMs` `updatedAtMs` `configuration`。

`ProjectConfiguration` 中**引擎真正读取的只有** `qaProfileId`（qa.run 选 profile）、`segmentation`、`srxPath`（导入默认）。其余字段（`aiProfileIds` `analysisProfileId` `pipelineId` `templateId` `engineAllowlist` `editorDefaults` `taskPackage`）仅是持久化 schema，引擎无任何读取路径——PRD 不得把它们当作已有功能。

语言对规则：项目一旦持有语言资产（已导入文档 / TM 条目 / 挂载术语库），改语言对返回 `conflict`。

### 1.3 文档（document.*）

| 方法 | 入参 | 返回字段 |
| --- | --- | --- |
| `document.import` | `projectId` `sourcePath` + 可选 `filterId` `segmentation(sentence/paragraph)` `srxPath` | `document: Document` `segmentCount` |
| `document.list` | `projectId` | `documents: Document[]`、`progress: DocumentProgress[]`（逐文档 SQL 计数：`counts{total, untranslated, draft, confirmed, openIssues}`） |
| `document.export` | `documentId` `outputPath` + 可选 `overwrite`（默认 false，目标已存在则返回 `exportBlocked`）、`segmentAnchors`（预览锚点） | `outputPath` `translatedSegments` `degradation: DegradationFinding[]` |
| `document.remove` | `documentId` | `document`（末次元数据回显）`removedSegments` `removedQaIssues` `managedCopyDeleted`；**项目 TM 与术语库刻意保留** |

`Document` 字段：`id` `projectId` `name` `format` `filterId` `relativePath` `segmentCount` `sourceSha256` `status(active/failed/superseded)` `revision` `currentVersion` `degradation[]` `importedAtMs` `updatedAtMs`。

`DegradationFinding`：`code` `severity(warning/error)` `message` `structuralPath?`——例如 DOCX 导出会把段内混排格式压平并上报 `docx.inline_formatting_flattened`（`crates/tl-filter-docx`），退化是**显式上报**而非静默。

### 1.4 句段（segment.*）

| 方法 | 入参 | 返回字段 |
| --- | --- | --- |
| `segment.list` | `documentId` + 可选 `offset` `limit`（省略返回全量） | `segments: Segment[]` `totalSegments` |
| `segment.update` | `segmentId` `targetText` `baseRevision`（乐观并发，revision 不匹配返回 `conflict`） | `segment` |
| `segment.confirm` | `segmentId` `baseRevision` | `segment`、`tmEntry`（**本次确认写入的 TM 条目**）、`propagated: Segment[]`（同项目未译重复句段自动填为草稿） |
| `segment.replace` | `documentId` `find` `replaceWith` `includeConfirmed?` | `segments[]`（改动行及新 revision）`replacedOccurrences` `skippedConfirmed` `demotedConfirmed`（被改写的已确认句段退回草稿计数） |

`Segment` 字段：`id` `documentId` `ordinal` `sourceText` `targetText` `state` `sourceHash` `contextHash` `structuralPath` `revision` `updatedAtMs`。

**句段状态机只有三态**：`untranslated → draft → confirmed`（`SegmentState`，`tl-domain`）。确认即写 TM（`upsert_tm_entry`，同源 hash 覆盖旧译文）；空译文拒绝确认（`invalidParams`）。替换清空译文则诚实回到 `untranslated`。**不存在** "已翻译（未确认）/已审校/已锁定" 等状态，也没有句段级锁。

### 1.5 翻译记忆（tm.*）

| 方法 | 入参 | 返回字段 |
| --- | --- | --- |
| `tm.lookup` | `projectId` `sourceText` + 可选 `minScore`（默认阈值，精确匹配恒过）`limit` | `matches: [{entry, score(0..100), grade}]` `totalMatches` |
| `tm.list` | `projectId` + 可选 `query`（大小写不敏感子串）`offset` `limit` | `entries[]`（最近确认在前）`total` |
| `tm.update` | `entryId` `sourceText` `targetText` | `entry`（改源文会重建 hash 与模糊索引） |
| `tm.delete` | `entryId` | `entry`（被删条目回显） |
| `tm.import` | `projectId` `path` + 可选 `format(tmx/csv/tsv)` | `imported` `added` `updated` |
| `tm.export` | `projectId` `path` + 可选 `format` `overwrite` | `exported` `outputPath` |
| `tm.pretranslate` | `documentId` + 可选 `minScore` | `checked` `pretranslated` `exact` `fuzzy` `segments[]`（改动行） |

`TmEntry` 字段：`id` `memoryId` `sourceText` `targetText` `sourceHash` `originProjectId` `originDocumentId` `originSegmentId` `confirmedAtMs`。TM 是**项目级单库**（`project_memory_id`），没有多 TM 挂载/优先级/穿透（penalty）模型。

**匹配分级的真实语义**（`crates/tl-engine/src/assets.rs::tm_matches`）：引擎只产出 `exact`（hash 相等，恒 100 分）与 `fuzzy`（索引召回 + `match_score`）。契约里声明的 `inContext` 分级**没有任何产出路径**——UI 若展示"上下文匹配/101%"即为造假。

### 1.6 术语库（termbase.* / term.*）

| 方法 | 入参 | 返回字段 |
| --- | --- | --- |
| `termbase.create` | `name` `sourceLocale` | `Termbase{id, name, sourceLocale, domain?, writable, revision, …}` |
| `termbase.list` | 可选 `projectId`（限定 mounts） | `termbases[]` `mounts: TermbaseMount[]{termbaseId, projectId, enabled, priority, writable, …}` |
| `termbase.attach` / `termbase.detach` | `projectId` `termbaseId` | `mount`（detach 未挂载返回 `notFound`） |
| `termbase.import` | `termbaseId` `path` `targetLocale` + 可选 `format(csv/tsv/tbx)` | `imported` `added` `merged` |
| `termbase.export` | `termbaseId` `path` + 可选 `format` `overwrite` | `exported` `outputPath` |
| `term.add` | `termbaseId` `sourceTerm` `targetTerm` `targetLocale` + 可选 `definition` `domain` `forbidden` | `entry: TermEntry` |
| `term.update` | `entryId` + 可选 `sourceTerm` `translationId` `targetTerm` `forbidden` | `entry` |
| `term.delete` | `entryId` + 可选 `translationId`（仅删单个译法） | `entry?`（整条删除时为 null） |
| `term.list` | `termbaseId` + 可选 `offset` `limit` | `entries[]`（源词序）`total` |
| `term.lookup` | `projectId` `sourceText` | `matches: [{entryId, termbaseId, sourceTerm, start, end, translations[]}]`（span 为归一化文本的 Unicode 标量偏移） |

`TermTranslation` 字段：`id` `entryId` `locale` `term` `preferred` `forbidden` `createdAtMs` `updatedAtMs`。术语支持首选/禁用两种标记；`TermStatus(candidate/active/deprecated)` 存在于契约但 UI 未使用。

### 1.7 质量检查（qa.*）

| 方法 | 入参 | 返回字段 |
| --- | --- | --- |
| `qa.run` | `documentId` | `checkedSegments` `openIssues` `issues[]` |
| `qa.list` | `documentId` + 可选 `offset` `limit` | `issues[]`（open→waived→resolved，各按时间）`total` |
| `qa.waive` | `issueId` `waived(bool)` + 可选 `note` | `issue`（豁免绝不改句段/不写 TM；指纹=规则+句段+证据，证据变则豁免失效、开新 issue） |

`QaIssue` 字段：`id` `segmentId` `ruleId` `severity(error/warning/info)` `status(open/waived/resolved)` `message` `fingerprint` `evidence{sourceNumbers, targetNumbers, sourceValues?, targetValues?, relatedSegmentIds?}` `waiveNote?` `createdAtMs` `updatedAtMs`。

内置规则（`crates/tl-qa`，两个 profile：`builtin.qa.standard` 与 `builtin.qa.cjk-professional`，按目标语言自动选默认）：
`qa.empty-target`、`qa.source-equals-target`、`qa.number-mismatch`、`qa.unit-mismatch`、`qa.tag-{tag_missing, tag_extra, tag_order, tag_pair}`、`qa.tag-{placeholder_missing, placeholder_extra}`（文本占位符 `{name}`/`{{var}}`/printf/标记/实体）、`qa.unbalanced-delimiter`、`qa.missing-final-punctuation`、`qa.edge-whitespace`、`qa.repeated-word`、`qa.length-ratio`、`qa.target-length-limit`、CJK 专项（`qa.cjk-halfwidth-punctuation`、`qa.cjk-ellipsis`、`qa.cjk-dash`、`qa.cjk-latin-spacing`）、术语一致性（`qa.term-required:*`、`qa.term-forbidden:*`，取自挂载术语库）、跨句一致性（`qa.same-source-different-target`、`qa.different-source-same-target`）、`qa.regex`（自定义正则规则类型，引擎侧尚无配置入口）。

### 1.8 AI（ai.*）

| 方法 | 入参 | 返回字段 |
| --- | --- | --- |
| `ai.configure` | `provider` `model` `apiKey`（**仅存内存，绝不落盘**）+ 可选 `baseUrl`（`openaiCompatible` 必填） | `configured` `provider?` `model?` |
| `ai.status` | 无 | 同上 |
| `ai.assist.start` | `segmentId` `action(translate/refine)` + 可选 `instruction` | `AiAssistRunView`（立即返回 running；已确认句段直接 `conflict`，refine 空译文 `invalidParams`） |
| `ai.assist.status` | `assistId` | `AiAssistRunView`：`status(running/done/failed/canceled)`、`result?{draftTarget, provider, model, elapsedMs, tagCheck{ok, missing?, extra?}}`、`errorMessage?` |
| `ai.assist.cancel` | `assistId` | `AiAssistRunView`（丢弃迟到的 provider 结果） |
| `ai.agent.start` | `documentId` + 可选 `instruction` `maxSegments` | `AgentRunView` |
| `ai.agent.status` | `runId` | `AgentRunView`：`status(running/awaitingReview/canceled/failed)` `plannedSegments` `tmApplied` `aiDrafted` `failedSegments` `openQaIssues` `steps[]{index, kind(plan/tm/translate/qa/summary/cancel), status(done/failed/skipped), detail, segmentId?}` `cancelRequested` |
| `ai.agent.cancel` | `runId` | `AgentRunView` |

**契约级红线（写进 Rust 注释与类型的，不是 UI 约定）**：
- Assist 终态 `done` 只携带 proposal，**从不写句段**；应用与否由人决定。
- Agent 生命周期**没有 "completed/成功" 态**——正常终点是 `awaitingReview`；agent 从不确认句段、从不签发、从不导出。
- 只有 `segment.confirm` 写 TM。`qa.waive` 不写 TM、不改句段。

### 1.9 通知帧

| 通知 | 载荷 |
| --- | --- |
| `notify.engine.ready` | `engineName` `engineVersion` `protocolVersion`（启动时） |
| `notify.ai.agent.step` | `runId` `documentId` `runStatus` `step`（运行中逐步推送，终态转换随帧可见） |

### 1.10 错误码

`invalidRequest` `methodNotFound` `invalidParams` `notFound` `conflict` `filterFailed` `exportBlocked` `aiNotConfigured` `aiFailed` `io` `internal`。桌面端另有桥接层错误 `engineDown`（supervisor 未就绪/引擎不可达）。

### 1.11 已有库代码但未接入 RPC 的能力（重要：是 NEAR/LATER 的依据，不是 HAVE）

| 库 | 内容 | 接入状态 |
| --- | --- | --- |
| `crates/tl-editor` | 拼写检查、CJK/拉丁间距与标点正则、OpenCC 简繁转换、`InlineTag`/`EditorTagIssue` 模型、`suggest.rs` 输入联想（非译元素/术语/TM 片段三源合并排序） | **tl-engine 未依赖**（Cargo.toml 无此依赖），零 RPC |
| `crates/tl-ai-quality` | 离线 QE 打分、语义 QA、术语抽取 | 同上，零 RPC |
| `crates/tl-qa` 扩展类型 | `QaRun`/`QaGateResult`/`QaExportOverride`/`ReviewStatistics`/`ReviewQueueItem`/`ReviewerStatistic`/`QaReportSnapshot`/`QaRegexRule` | 类型存在，引擎只用 profile 评估 + issue 指纹调和，其余无 RPC 无存储 |
| `crates/tl-ai` 扩展类型 | `AiBatchRun`/`AiConversation`/`AiUsageRecord`/`GroundingOptions` | 类型存在，引擎只用 `execute_provider` 单次补全 |
| `packages/plugin-sdk` | 插件 SDK | 引擎无插件宿主 RPC |

---

## 二、桌面端现有界面与真实绑定

### 2.1 preload 桥（`window.tl`，contextIsolation 开启）

通道全集（`apps/desktop/src/shared/desktop-api.ts`）：`invoke(method, params)`（任意引擎 RPC 透传）、`engineStatus()` / `relaunchEngine()` / `onEngineStatus()`、`onNotification()`、7 个原生文件对话框（源文档 / 导出 / TM 导入导出 / 术语库导入导出 / SRX，均带 E2E 环境变量替身）、`renderDocxPreview(documentId)`（主进程用真实导出管线写临时 DOCX 并回传字节）、`onMenuCommand()` / `setMenuContext()`（菜单启用状态由 renderer 汇报）。

### 2.2 应用外壳（`App.tsx`）

- 引擎未就绪时整个工作台 `inert` + `EngineGate` 遮罩（starting/restarting/down 三态如实呈现，down 提供手动重启）。supervisor 崩溃预算 5 次、指数退避、请求超时 120s（`engine-supervisor.ts`）。
- 底部状态栏：状态消息（每条重放入场动画）+ 实时统计（当前句段 n/总数、已确认、草稿、剩余、QA 未解决、确认进度条与百分比）+ 引擎状态点（版本/pid/重启计数/最后错误）。
- 引擎崩溃恢复后自动 resync 并明说"已重新同步"；未被引擎 ack 的写入以持久 inline 告警呈现（`UnackedWrite`），绝不装作保存成功。

### 2.3 项目列表（`ProjectsView`）

新建项目表单（名称/语言对）+ 项目列表（默认隐藏已归档，可勾选显示）。绑定：`project.list` / `project.create`。

### 2.4 工作台三栏（`WorkbenchView`）

- **左侧资源栏**：项目卡（名称、语言对、真实进度条——仅当每个文件都报了 progress 才显示百分比，绝不估算）；文件列表（格式、确认 n/总数、草稿数、QA 数、逐文件进度条与百分比、两步确认的移除）；项目详情（名称/语言对/创建时间/文件数/总句段/已确认）。绑定：`document.list`（含 progress）、`document.remove`。
- **中央编辑区**：文档标签页（多开、关标签不删文档）；工具条（状态筛选 全部/未译/草稿/已确认/QA + 查找/替换/全部替换/含已确认开关）；双语网格 `SegmentGrid`（#、源文+locale、译文+locale、状态列；>120 行自动虚拟滚动；行内 textarea 编辑，输入 700ms 静默后自动存草稿、离开句段 flush、卸载 flush、失败 re-arm 重试；IME 组合期间不保存不插入不确认，compositionend 后统一处理；Ctrl+Enter 确认后自动跳到下一个未确认句段）；行内徽标（未译/草稿/已确认、QA、活动行 TM 最佳匹配分）；底部 文本/预览 视图切换。绑定：`segment.list` / `segment.update` / `segment.confirm` / `segment.replace`。
- **右侧 dock（6 个标签）**：TM（活动句段 `tm.lookup` 实时查询，最佳分数芯片同时驱动 dock 标签、面板徽标、网格行内徽标——三处同源不可能打架；应用为草稿）；术语（`termbase.list`+`term.lookup` 命中、首选/禁用徽标、插入到编辑器光标处、快速添加进首个可写术语库）；检索 Concordance（文档内子串检索双向高亮 + `tm.lookup` 模糊检索、定位句段、F3 取选区播种）；QA（`qa.run`/`qa.waive`，证据 `源[...]≠译[...]`、忽略/恢复/定位、未解决计数芯片）；AI 辅助（见 §4）；Agent（见 §4）。

### 2.5 对话框

导入（文件选择 + 分段方式 sentence/SRX 或 paragraph + SRX 选择，成功后把选项自动存回项目默认）；项目设置（项目信息/导入默认/生命周期归档/TM 导入导出/术语库 创建-挂载-卸载-导入-导出-逐条管理 `TermManagePanel`）；TM 管理（`tm.list` 搜索分页 50/页 + `tm.update`/`tm.delete` 两步删除）；译文预览（校对视图：客户端回填 + 未译标记 + 点击回跳；版式视图（仅 DOCX/双语 DOCX）：真实导出管线产物 + 段落锚点点击回跳 + 编辑后 600ms 静默重导出）；导出覆盖确认（`exportBlocked` 后显式 覆盖/取消）。

### 2.6 应用菜单与快捷键

菜单五组：文件（导入 Ctrl+O、导出 Ctrl+E、项目设置 Ctrl+,、返回项目列表）、编辑（系统角色 + 确认当前句段 Ctrl+Enter）、视图（预览 Ctrl+P、六个 dock 面板 Ctrl+1..6、缩放、全屏）、导航（筛选 Ctrl+F、查找下一个/上一个 F4/Shift+F4、替换 Ctrl+H、一致性检索 F3）、帮助。macOS 额外 app 菜单。菜单启用状态由 renderer 汇报的 `MenuContext{projectOpen, documentOpen}` 驱动。编辑器/工作台 chord 归 renderer 所有（`registerAccelerator: false`），菜单只显示不抢键。另有 Alt+↑/↓ 逐行移动选区（编辑中可用）。

---

## 三、用户草图 + Mockup 逐项分类

分档定义：
- **HAVE**：现在就有，且绑定真实引擎数据。
- **NEAR**：引擎数据/契约已备，缺的是 UI 编排或一层薄 RPC；不引入新存储、不违红线。
- **LATER**：需要新的引擎能力（新 RPC、新存储、甚至新服务端），本仓库尚无支撑。
- **NEVER-FAKE**：在对应后端能力落地之前，禁止以任何假 chrome / 假数据形式出现在 UI。

### 3.1 骨架与全局

| 草图项 | 分档 | 依据 |
| --- | --- | --- |
| 三栏布局（左资源 / 中网格 / 右面板） | **HAVE** | `WorkbenchView` 即是三栏 + 顶部 ribbon + 底部状态栏 |
| 标题栏显示 项目/文档/语言对 | **NEAR** | 数据全在（project.name、activeDocument.name、locales），当前窗口标题是静态 `"Translunar CAT"`（`main/index.ts`）；改 `document.title`/`BrowserWindow.setTitle` 即可 |
| 标题栏"模式"指示（翻译/审校模式） | **NEVER-FAKE** | 引擎无审校模式概念（三态状态机，无 reviewer 角色）；显示一个不改变任何行为的模式开关即是假 chrome |
| 标题栏"未保存"（dirty）指示 | **NEAR** | 真实 dirty 概念存在（编辑器未 flush 的草稿 + `UnackedWrite`），但要如实定义：输入即自动存草稿，dirty 窗口只有 ≤700ms 或引擎未 ack；可显示"保存中/未确认写入"而非传统 dirty 星号 |
| 菜单栏（File/Edit/View/Project/Translate/Review/Tools/Window/Help 九组） | **HAVE（5 组）/ NEVER-FAKE（空壳组）** | 现有 文件/编辑/视图/导航/帮助 全部绑定真实命令；Mockup 的 Review/Tools 等组若无真实命令填充，不得挂灰色假菜单 |
| 命令面板（Ctrl+K / Ctrl+Shift+P） | **NEAR** | 全部菜单命令已收敛为 `MenuCommand` 联合类型 + 单一 dispatch 路径（`handleMenuCommand`），做一个列出真实命令的面板是纯 UI 编排 |
| 左侧图标导航条（项目/编辑器/报告等分区） | **NEAR** | 现有两个顶级视图（项目列表 ↔ 工作台）可挂进去；"报告/仪表盘"分区无数据支撑，属 LATER |
| 浮动/可拖拽面板、面板布局自定义 | **NEAR** | dock 已是六标签结构，改成可拆分是纯前端工作；但注意成本与收益 |
| 状态栏（句段数/进度/QA/引擎状态） | **HAVE** | 全部真实计数（SQL 计数或加载中的网格计数），引擎状态点含 pid/版本/重启数 |
| 状态栏 INS/OVR 插入模式、光标行列号 | **NEAR** | 纯编辑器本地状态，可如实显示；无须引擎 |
| 缩放滑块 | **HAVE（菜单）/ NEAR（滑块控件）** | 视图菜单已有 放大/缩小/实际大小（Electron role）；滑块只是同能力的另一皮肤 |

### 3.2 左侧资源区

| 草图项 | 分档 | 依据 |
| --- | --- | --- |
| 项目名 + 语言对 + 进度% | **HAVE** | 真实 SQL 计数，无 progress 时诚实不显示百分比 |
| 截止日期（Due: May 30, 2025） | **LATER** | `Project` 无 due date 字段；需契约+存储+UI 三层 |
| "Created by 项目经理" | **LATER/NEVER-FAKE** | 无用户体系；单机单人。加假署名即造假 |
| 文件夹树（01_Source / 02_Reference / 03_TM / 04_Deliverables） | **LATER** | 文档是平面列表（`relativePath` 存在但无目录树语义）；参考文件/交付物不是引擎概念 |
| 文件搜索框 | **NEAR** | 文档列表在 renderer 内存中，本地过滤即可 |
| 逐文件进度%（68%/100%/45%/0%） | **HAVE** | `document.list` 的 progress 已驱动逐文件进度条+百分比 |
| 文件树里的 TM 文件（.sdltm）节点 | **NEVER-FAKE** | TM 是项目级 SQLite 内部资产，没有独立 TM 文件实体；伪造 `.sdltm` 文件节点是假 chrome。TM 管理入口已有（ribbon + 对话框） |
| 云同步图标（Deliverables ☁） | **NEVER-FAKE** | 全栈无任何云/同步/远端代码；见 §3.6 |
| 项目详情卡（名称/语言/创建时间/文件数/句段数） | **HAVE** | 现有"项目详情"区即是 |

### 3.3 中央编辑区

| 草图项 | 分档 | 依据 |
| --- | --- | --- |
| 双语网格（#/源/译/状态） | **HAVE** | 含虚拟滚动、行内编辑、自动草稿、Ctrl+Enter 确认 |
| 文档多标签 | **HAVE** | 多开、关闭回退到邻居标签 |
| 文档内搜索 + 筛选图标组 | **HAVE** | ribbon 筛选框（Ctrl+F）+ 状态下拉 + 查找 F4/Shift+F4 |
| 查找/替换/全部替换（含已确认降级草稿） | **HAVE** | `segment.replace` 单事务全文替换，跳过/降级计数如实上报 |
| 句段状态芯片：TM 100%/95%/85%、MT 62% | **NEVER-FAKE（按此形态）** | 引擎不存储"句段来源"（TM 预翻/AI 草稿/人工输入落库后不可区分——`Segment` 无 origin 字段），也不存储应用时的匹配分。行内能诚实显示的是**活动句段的实时 `tm.lookup` 最佳分**（已有）。给每行永久标注"95% TM"需要新的 origin 持久化（LATER）；"MT 62%" 这种置信度分数任何 provider 都不返回，**永远不得显示** |
| 生命周期 未翻译→草稿→已翻译→已确认→已审校→已锁定 | **HAVE（前 2+确认）/ LATER（已审校/已锁定）** | 引擎三态：未译/草稿/已确认。"已翻译≠已确认"的四态、审校态、锁定态都需要契约+状态机+存储改造；`tl-qa` 有 Review* 类型雏形但零接入。UI 不得先画六态色标 |
| 标签芯片（inline tag chips，紫色 ▸tag◂） | **NEVER-FAKE（结构化芯片）/ NEAR（文本占位符高亮）** | 句段是纯文本，无结构化 inline tag 运行时模型（DOCX 混排导出时压平并上报退化）。文本占位符（`{name}`/`%s`/`<b>`/`&amp;`）真实存在且 QA 与 AI tagCheck 都在校验——把它们**高亮为不可误删的文本 token** 是 NEAR；画成"来自文档格式的结构化标签芯片"则是在假装保真往返 |
| 行内评论数（💬17） | **NEVER-FAKE** | 无评论存储；见 §3.6 |
| 三点行菜单（复制源文/清空/锁定等） | **NEAR（现有操作）/ LATER（锁定）** | 复制源文到译文、清空译文可用 `segment.update` 立刻实现；锁定无引擎支持 |
| 底部 Text / Preview / Source 视图切换 | **HAVE（Text/Preview）** | 预览含校对视图+DOCX 版式视图（真实导出管线+锚点回跳）。"Source"（原始文件视图）无支撑，LATER |
| 底部 Comments / Messages 面板 | **NEVER-FAKE** | 无评论/消息后端；见 §3.6 |
| 源文选区 → TM/术语联动 | **HAVE** | F3 取选区播种 concordance；活动句段自动触发 `tm.lookup` + `term.lookup` |
| IME 安全（组合期不保存/不插入/Enter 不确认） | **HAVE** | `SegmentGrid` 与查找/替换框都有 `isComposing` 防护，插入排队到 compositionend |
| 撤销/重做 | **HAVE（编辑器内）** | textarea 原生 undo + 菜单系统角色；无跨句段/跨会话的操作历史（那是 LATER） |

### 3.4 右侧面板区

| 草图项 | 分档 | 依据 |
| --- | --- | --- |
| TM 面板（匹配列表、分数、应用） | **HAVE** | 精确/模糊分级真实；注意 `inContext` 无产出路径，UI 里的"上下文"标签是死代码 |
| TM 选择器下拉（多 TM 切换） | **NEVER-FAKE** | 单项目单 TM；画下拉即暗示多 TM 挂载（LATER 需引擎多 memory 模型） |
| 术语面板（命中+插入+快速添加） | **HAVE** | 多术语库挂载真实存在（mounts + priority 字段），仅"优先级排序 UI"未做（NEAR） |
| MT 面板（独立机翻面板） | **NEAR（作为 AI 辅助的呈现）/ NEVER-FAKE（假多引擎对比）** | 真实能力=当前配置的**单个** provider 的 assist 翻译提案。可以把 AI 辅助面板叫"机器翻译"，但同屏多引擎对比、逐引擎置信度都无支撑 |
| QA 面板 | **HAVE** | 运行/忽略/恢复/定位/证据展示 |
| Concordance 面板 | **HAVE** | 文档内检索 + TM 模糊检索 |
| 评论面板 | **NEVER-FAKE** | 见 §3.6 |
| 预览面板（右侧常驻） | **NEAR** | 预览能力已有（对话框形态）；改为右侧常驻 pane 是编排工作，注意版式视图每次刷新走真实导出管线的成本 |
| 术语建议（Term Suggestions 列表 + 收藏图标） | **HAVE(命中列表)/LATER（收藏）** | 命中列表=term.lookup；收藏/书签无存储 |

### 3.5 AI（详见 §4）

| 草图项 | 分档 | 依据 |
| --- | --- | --- |
| AI 翻译/润色（单句段，异步可取消） | **HAVE** | `ai.assist.*` 全生命周期 + 标签完整性门禁 + 差异对比 |
| Agent 批量起草（任务单/步骤流/人工审核门） | **HAVE** | `ai.agent.*` + 实时步骤通知 + `awaitingReview` 终态 + "去工作台查看草稿/去导出"人工闸门 |
| 多 provider 配置 | **HAVE** | 11 种 provider（见 §4 表） |
| AI 置信度 / 质量分（MT 62%） | **NEVER-FAKE** | 无 provider 返回置信度；`tl-ai-quality` 的 QE 打分未接入。任何数字都是编造 |
| AI 自动确认 / 自动导出 | **NEVER-FAKE（契约级禁止）** | `AgentRunStatus` 注释与实现共同保证：agent 从不确认、从不导出 |

### 3.6 协作 / 云（全家族 NEVER-FAKE→LATER）

| 草图项 | 分档 | 依据 |
| --- | --- | --- |
| 云同步（04_Deliverables ☁、cloud sync） | **NEVER-FAKE** | 引擎是本地 SQLite + 本地文件管线；仓库内无任何网络同步、账号、远端存储代码（AI provider HTTP 调用除外）。落地=全新服务端，LATER |
| 角色/成员/权限（Created by、Reviewer、members） | **NEVER-FAKE** | 无用户/身份/会话模型。假头像、假角色下拉即造假 |
| 评论/消息（Comments(1)/Messages(2)、行内 💬、Reviewer 头像+时间戳） | **NEVER-FAKE** | 无评论表、无作者概念。QA 豁免备注（`waiveNote`）是现有的最接近物——单机、无作者、挂在 QA issue 上 |
| 通知中心 | **NEVER-FAKE** | 现有通知=引擎进程内帧（agent step / ready），不是用户间通知 |
| 修订/跟踪更改（track changes） | **NEVER-FAKE（假修订流）** | 无修订存储。真实存在的：revision 计数（乐观并发）、AI 候选 vs 当前译文的字符 diff（仅展示）。句段历史/修订接受拒绝是 LATER |
| LQA（错误类型学打分，MQM 等） | **LATER** | `tl-qa` 有 ReviewStatistics 等类型雏形，零 RPC 零存储零 UI；QA 豁免≠LQA |
| 字数统计（Words: 18,732、加权字数、分析报告） | **NEVER-FAKE（现阶段）→ NEAR（如实标注口径后）** | 引擎全链路**只有句段计数**，无任何词数统计（crates 中无 word count 代码）。状态栏若要展示词数，必须先在引擎或 renderer 明确统计口径（源文词/字符、CJK 分词规则）并如实标注；在句段口径的进度旁边放一个来路不明的"字数 18,732"就是数字剧场。加权字数（TM 折扣分析）需要 LATER 的分析管线 |

---

## 四、AI 融合的诚实边界

### 4.1 Provider 目录（`crates/tl-ai/src/lib.rs::provider_descriptor`，全部真实可配）

| Provider | 线协议 | 默认 Base URL | 默认模型 | 流式 | 用量上报 |
| --- | --- | --- | --- | --- | --- |
| `openai` | OpenAI Chat Completions | `https://api.openai.com/v1` | `gpt-5-mini` | ✓ | ✓ |
| `openaiResponses` | OpenAI Responses | `https://api.openai.com/v1` | `gpt-5-mini` | ✓ | ✓ |
| `anthropic` | Anthropic Messages（原生） | `https://api.anthropic.com` | `claude-sonnet-4-5` | ✓ | ✓ |
| `gemini` | Gemini generateContent（原生） | `https://generativelanguage.googleapis.com/v1beta` | `gemini-2.5-flash` | ✓ | ✓ |
| `deepl` | DeepL v2 translate | `https://api-free.deepl.com/v2` | `deepl-translate` | ✗ | ✗ |
| `deepseek` / `qwen` / `glm` / `kimi` / `volcengine` | OpenAI 兼容 Chat Completions | 各家官方兼容端点 | `deepseek-chat` / `qwen-plus` / `glm-4-flash` / `moonshot-v1-8k` / `endpoint-id` | ✓ | ✓ |
| `openaiCompatible` | OpenAI 兼容（自定义端点，`baseUrl` 必填） | `http://127.0.0.1:11434/v1`（本地 Ollama 习惯值） | `local-model` | ✓ | ✓ |

引擎同一时刻**只持有一份 AI 配置**（provider+model+key，内存态，重启即失）。SSE 流式解析、取消（轮询间隔内断连）、限速 Retry-After、响应体上限都在 `tl-ai` 实现。

### 4.2 Assist（单句段，人审提案）

`ai.assist.start` 在 RPC 线程验证后立即返回，provider 调用在 worker 线程；UI 每 150ms 轮询 `ai.assist.status`，网格/TM/agent 轮询期间全程可用。终态 `done` 携带 `draftTarget + tagCheck`；**UI 在 `tagCheck.ok=false` 时禁用"应用为草稿"并列出缺失/多余 token**（`AiPanel`）。应用=写草稿（走 `segment.update`），确认权永远在人。已确认句段直接拒绝 assist（`conflict`）。

### 4.3 Agent（文档级批量，awaitingReview 终态）

`ai.agent.start` 内联完成 plan + TM 精确预翻，然后 4 线程 worker 池并行起草 TM 未命中的句段（每句一个 `translate` step，失败单句计入 `failedSegments` 不中断整跑），跑 QA，`summary` 后停在 **`awaitingReview`**。步骤经 `notify.ai.agent.step` 实时推送 + 800ms 兜底轮询。取消快速诚实（逐 item 检查 + HTTP 断连）。UI 的人工闸门是两个跳转按钮（查看草稿/去导出），**导出流程本身仍会撞上 `exportBlocked` 覆盖确认**——agent 无法绕过任何人工闸门。

### 4.4 红线核对表（现状全部合规，PRD 必须延续）

| 红线 | 现状证据 |
| --- | --- |
| 只有人工确认写 TM | `segment.confirm` 是唯一 TM 写入路径（导入除外）；assist/agent 只写草稿 |
| Assist/Agent 从不确认/导出/假成功 | 契约注释 + `AgentRunStatus` 无 success 态 + agent 面板终态文案"等待人工审核" |
| 不显示假 TM% | 行内匹配徽标只来自活动句段实时 `tm.lookup`；无逐行持久化匹配分。注意：`inContext` 契约死枚举，勿在 UI 激活 |
| 引擎按句段计数就不做字数剧场 | 状态栏/进度条全部句段口径；全仓库无词数代码 |
| 无后端不做评论/头像 | 现 UI 零评论零头像零成员 |

---

## 五、Copy audit 遗留

对 `apps/desktop/src/renderer` 全量扫描（`placeholder=`、请/例如/点击/提示 等模式）：

1. **合规**：说明性/教学性文案已清除。剩余 3 处 placeholder 均为字段名式（`查找`、`替换为`、`搜索句段`），非指导语。
2. **遗留 1（死标签）**：`TmPanel.tsx` 的 `GRADE_LABEL` 含 `inContext: "上下文"`——引擎无 `inContext` 产出路径，该标签永不渲染。属无害死代码，但若未来有人"顺手"接上会直接违反 no-fake-TM% 红线，建议删除或加注释锁死。
3. **遗留 2（过期注释）**：`ImportDocumentDialog.tsx` 顶部 doc 注释仍写有 "the dialog note says so / the dialog note documents this"，而对应的对话框内提示文案已在 copy strip 中删除。注释与 UI 不符，应更新。
4. **遗留 3（叫法不一致）**：concordance 在 dock 标签叫 `检索`、面板标题叫 `Concordance 检索`、菜单/ribbon 叫 `一致性检索`。三个名字一个功能，PRD 阶段应统一。

---

## 六、推荐 MVP 切片（按"零新引擎能力"到"薄 RPC"排序）

**S0 纯 UI 编排（不动引擎，不碰红线）**
1. 窗口/标题栏动态标题：`项目名 — 文档名 (源→目标)`（数据全有）。
2. 命令面板：枚举现有 `MenuCommand` + dock 切换 + 项目内文档跳转（单一 dispatch 路径已就绪）。
3. 左栏文件本地搜索框；concordance 命名统一。
4. 状态栏补 INS/行列号等编辑器本地事实；删除 `inContext` 死标签；修正 ImportDocumentDialog 过期注释。
5. 行菜单最小集：复制源文到译文 / 清空译文（`segment.update` 即可，清空后如实回 `untranslated`）。

**S1 薄前端能力（仍零新 RPC）**
6. 文本占位符高亮（渲染层给 `{name}`/`%s`/标记类 token 上色，与 QA `qa.tag-placeholder_*`、AI `tagCheck` 同一套 token 语义）——这是"标签芯片"的诚实版本。
7. 预览从对话框改右侧常驻 pane（注意版式视图重导出成本，保留 600ms 静默）。
8. MT 面板 = AI 辅助面板换名重排（单 provider，如实展示 provider/model/耗时，无置信度数字）。

**S2 薄 RPC / 契约小改（引擎小步）**
9. 词数统计：引擎在 `SegmentCounts` 或独立方法里给出**口径明确**的源文词/字符计数（CJK 按字符），状态栏标注口径后才展示。
10. 句段来源持久化（`Segment.origin: tm-exact/tm-fuzzy(score)/ai-draft(model)/human`）——这是逐行"95% TM"徽标的唯一诚实路径。
11. 多 TM 挂载若确有需求，先做引擎 memory 模型，再谈 TM 选择器下拉。

**明确不进 MVP（LATER，需全新后端）**：云同步、成员/角色、评论/消息/通知、track changes 修订流、审校/锁定状态机、LQA 打分、截止日期/项目经理字段、文件夹树+参考文件、加权字数分析。这些在 PRD 里只能以 roadmap 出现，不得画进当前界面。

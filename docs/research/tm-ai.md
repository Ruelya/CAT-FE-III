# TM 与 AI 的关联核查 + TM 功能完善度评估

> 核对基线：`origin/cursor/gf-mt-agent-modes-2398`（commit `3016927`），日期 2026-08-28。
> 性质：**核查**，不实现功能。红线：每条结论给 `文件:行号` 或 RPC 名；NEVER-FAKE 形态不建议去画。
> 注意：`docs/research/translunar-capability.md` §1.5 与 `docs/research/pdf-mt-agent.md` 的多处结论
> 在本基线上已过时（多 TM、origin、术语注入、多候选均已落地），过时清单见 §5。
> **⚠️ 本文 §1–4 自身也已过时**（写于 mt-agent-modes 基线）：「prompt 不注入 TM 例句」与
> 「aiDraft 无行为型 QA 消费者」两条结论在 gf-tm-context tip 上均已推翻——
> `prompt_grounding_for` + `aiops::grounded_messages` 已接 TM 分节，`qa.unedited-ai-draft` 已落地。
> **以 §6「已补」为准**；全量复核见 `docs/research/completeness.md`。

## 1. 一句话结论

TM 与 AI 的关联远不止「确认写 TM」：**Agent 起跑时 TM 精确命中前置分流（不烧 token）、Turbo 档经同一
`segment.confirm` 把 QA 干净的 AI 草稿写回 TM、origin 体系让 TM/AI 来源全链路可见并喂给行为型 QA 规则
`qa.unedited-fuzzy`**；唯一的大缺口是 **prompt 不注入 TM 例句**（`build_grounded_prompt` 的 TM 分节引擎零调用，
本轮只接了术语）。TM 本体完善度约 **80%（能用、核心闭环完整、模糊匹配深度体验有洞）**。

---

## 2. TM ↔ AI 关联表（除确认写 TM 之外）

| # | 通路 | 方向 | 是否存在 | 证据 |
| --- | --- | --- | --- | --- |
| 1 | `segment.confirm` → upsert TM | 人工/Turbo → TM | **存在，且是翻译流唯一写库门** | 确认时写唯一 writable 挂载：`crates/tl-engine/src/lib.rs:1245-1259`（`working_memory_id` :1248，`upsert_tm_entry` :1249）。`tm_entries` 的全部写入方只有三个：confirm（`lib.rs:1249`）、`tm.import`（`crates/tl-engine/src/assets.rs:356`）、`tm.update` 条目编辑（`assets.rs:292-296`）——assist/agent 都不直接写库 |
| 2 | Agent 开跑时 TM 精确预翻 | TM → AI（前置分流） | **存在** | `ai.agent.start` 第一阶段：按 enabled 挂载 priority 顺序对 `(memory, source_hash)` 唯一索引点查（`lib.rs:1788-1796`），命中落 Draft + `origin{tmExact, 100}`（`lib.rs:1800-1811`），**未命中才进 AI worker 队列**（`lib.rs:1824-1833`）；三档一致（`lib.rs:1779-1783` 注释 + `docs/prd/mt-agent-modes.md` §1）。测试：`crates/tl-engine/tests/vertical.rs:846`。UI 回显「TM 预翻 X 句」（`AgentPanel.tsx:289`）与计数芯片 `TM {tmApplied}`（`AgentPanel.tsx:494`） |
| 3 | `tm.pretranslate` 与 AI 的互斥/先后 | 并行无关（共享安全谓词） | **无显式编排，靠谓词天然互斥** | 两者都只认「未译 + 空译文 + 未锁」的行：pretranslate 过滤 `assets.rs:444-449`；agent 落稿前重查活行 `still_pending`（`lib.rs:2033-2038`），行已被填即诚实 skipped。先到者占位、后到者跳过，无锁无排队 |
| 4 | Assist / Agent prompt 注入 TM 匹配 | TM → AI（prompt grounding） | **不存在（本轮只接了术语）** | prompt 构造是 `assist_messages`（`crates/tl-engine/src/aiops.rs:79-135`）：system + instruction + **Terminology 分节**（`aiops.rs:97-114`，只注入挂载术语库真实命中，`lib.rs:1479-1510` `prompt_terms_for`），**没有 TM 分节**。`tl-ai` 现成的 `build_grounded_prompt`（`crates/tl-ai/src/lib.rs:1628`，`GroundingInput.tm_matches` :1602，`GroundingOptions.include_tm` :1475）**引擎零调用**（`tl-engine` 全文无 `build_grounded_prompt`/`GroundingInput` 引用）。PRD 明确推迟：`docs/prd/mt-agent-modes.md:133-135`「本轮只接术语分节语义，全量 grounding 等独立切片」 |
| 5 | AI 草稿（aiDraft+model）确认后进 TM 的来源保留 | AI → TM（有信息损失） | **句段保留，TM 条目不保留** | 句段侧：确认从不重盖 origin（`lib.rs:1273-1275` 注释「confirming never restamps」；`tl-domain/src/lib.rs:325` 注释「Confirming never changes the origin」），行上永远可见 `aiDraft + model`。TM 侧：`TmEntry` 无 origin/model 字段（`crates/tl-domain/src/lib.rs:528-538`，仅句对 + `origin_project/document/segment_id` 指针 + `confirmed_at_ms`），`TmMatchItem` 也只带 entry/score/grade/memoryName（`crates/tl-protocol/src/tm.rs:31-42`）——**「这条 TM 来自 AI」在库内与检索结果里不可见**，只能靠 originSegmentId 反查句段 |
| 6 | Turbo 自动确认写 TM vs 手动确认 | AI(Turbo) → TM | **同一个 `segment_confirm` 实现** | `turbo_confirm_segment` 直接调 `self.segment_confirm`（`lib.rs:1916-1919`），注释明说走「the ordinary segment.confirm path (TM write, propagation, honest failures)」（`lib.rs:1878-1884`）；前置硬门是句段级 QA 零 error（`lib.rs:1897-1915`），失败/有 error 留草稿并如实记步骤（`lib.rs:1905-1914`、:1931-1940）。TM 预翻的草稿在 Turbo 档也走同一门（`lib.rs:1845-1852`）。测试：`vertical.rs:1629-1668` |
| 7 | 检索/TmPanel 把 AI 草稿当 TM 命中 | —（污染检查） | **不会** | `tm.lookup` 只读 `tm_entries`：exact 点查 `store.tm_entry_by_source`（`assets.rs:122`）+ 模糊索引召回（`assets.rs:130-147`）；草稿在 `segments` 表，未确认不入库（写入方见第 1 行）。Concordance 的文档内命中（可含 AI 草稿译文）与「项目 TM（模糊检索）」是两个分区、分别标注（`ConcordancePanel.tsx:163-165` 源文/译文 badge；:185-222 TM 独立小节） |
| 8 | `qa.unedited-fuzzy` 等行为型规则看 origin | TM origin → QA | **存在** | 规则只在三个引擎事实齐备时触发：`confirmed && origin.kind==tmFuzzy && !origin.edited`（`crates/tl-qa/src/lib.rs:1176-1205`），从不由文本推断；引擎在全量 QA 与句段级刷新两处喂 origin（`crates/tl-engine/src/qacheck.rs:105`、`:202`）。附注：aiDraft origin 目前没有对应的行为型 QA 消费者（如「AI 草稿未编辑即确认」），是事实不是缺陷主张 |
| 9 | 多库：AI 读哪些 mount | TM → AI | **enabled 挂载、priority 决胜；writable 只管写** | Agent 精确 pass 读 `enabled_memory_mounts` priority 顺序、第一命中即用（`lib.rs:1700-1704`、:1788-1796）；`enabled` 门定义在 `crates/tl-engine/src/memories.rs:404-413`；`tm.lookup`/`tm.pretranslate` 走 `tm_matches_mounted` 分数第一、priority 决胜（`assets.rs:165-190`）——exact 全 100 分，两种口径对精确命中等价。写路径只认唯一 writable（`memories.rs:418-430`），Turbo 自动确认因此也写工作库。禁用库不参与读（测试 `crates/tl-engine/tests/engine_rpc.rs:4101`）；无工作库时 Turbo 自动确认与手动确认一样诚实失败（`memories.rs:424-429`，测试 `engine_rpc.rs:4119-4200`） |
| 10 | 未落地能力盘点 | — | **以下均不存在，勿画** | ① AI 直接写 TM：无任何路径（见第 1 行的写入方全集；Turbo 也是经 confirm）。② TM 当向量库给 AI：无 embedding/向量检索代码——模糊召回是 token 索引 recall + `match_score` 重排（`assets.rs:3-5` 模块注释），`crates/` 检索 embedding/vector 仅命中 office filter 的 XML 词汇。③ `build_grounded_prompt` 的 TM/corpus/上下文分节：`tl-ai` 有实现有测试、零 RPC 零引擎调用（同第 4 行）。④ `tl-ai` 的 `AiBatchRun`/`AiConversation` 等类型闲置无接线 |

**三句话结论：**

- **已关联的**：Agent 内 TM 精确预翻前置分流（命中句根本不去 AI，origin `tmExact/100`）；Turbo 档 AI 草稿经同一 `segment.confirm` 写回 TM（QA 零 error 硬门）；origin 体系贯穿 TM 应用 / AI 应用 / 预翻译 / 传播，并喂 `qa.unedited-fuzzy` 行为规则。
- **故意断开的**：assist/agent 从不直接写 TM（唯一写库门是 `segment.confirm`）；AI 草稿未确认绝不出现在 TM 检索里；`ai.agent.review` 的 reject 不写任何句段（`lib.rs:2225-2234`）。
- **缺失的**：prompt 不注入 TM 例句（75–99 分模糊命中对 AI 完全不可见，`build_grounded_prompt` 现成但零调用）；TM 条目不记录 AI 来源（进库即只剩句对 + 溯源指针）；aiDraft origin 无行为型 QA 消费者。

---

## 3. TM 本体完善度（与 AI 无关的部分）

| 功能 | 档位 | 证据（当前树） |
| --- | --- | --- |
| 活动句 lookup + 分数 + grade | **HAVE** | 工作台对活动句段实时 `tm.lookup`（`WorkbenchView.tsx:464-488`），dock 列表 / TM 标签芯片 / 网格行内徽标三处同源（`WorkbenchView.tsx:457-461` 注释、`:1584-1586`）。分数 0–100、grade exact/fuzzy（`assets.rs:108-159`）。默认 minScore 60 / limit 20（`tl-protocol/src/tm.rs:8,16`） |
| `inContext` 上下文匹配 | **MISSING（契约死枚举，NEVER-FAKE）** | 引擎只构造 Exact（`assets.rs:126`）与 Fuzzy（`assets.rs:143`）；`tm.rs:25-26` 注明 reserved。UI 死 grade 不渲染标签（`TmPanel.tsx:22-25`）——与 capability 文档 §1.5 该句一致，**仍无产出路径，不得画 101%** |
| 应用为草稿（按钮/双击） | **HAVE** | `TmPanel.tsx:85-91`（按钮）、`:63-69`（双击），走 `segment.update` 并盖真实 grade/score origin（`WorkbenchView.tsx:1198-1211`） |
| Ctrl+1…9 应用第 N 条 | **HAVE** | 编辑器聚焦时 Ctrl/Cmd+数字应用对应记忆匹配（memoQ 语义，`WorkbenchView.tsx:2102-2136`） |
| 插入记忆（ribbon/菜单/命令面板） | **HAVE** | `Ribbon.tsx:226-227`、`WorkbenchView.tsx:1466-1474`、命令面板 `:2645`；无匹配时诚实报「没有第 1 条记忆匹配」（测试 `WorkbenchView.test.tsx:3393-3405`） |
| 预翻译（精确/模糊、锁定跳过、minScore） | **引擎 HAVE / UI PARTIAL** | 引擎完整：exact+fuzzy、origin 打真实 grade+score、锁定行跳过并计数上报、minScore 参数默认 75（`assets.rs:432-503`、`tm.rs:18`）。**UI 缝**：ribbon「预翻译」一键只传 documentId（`WorkbenchView.tsx:1315-1317`），minScore 无旋钮——引擎有 UI 无 |
| 检索 concordance | **HAVE（有小缝）** | 文档内双向子串检索 + 高亮 + 定位句段（`ConcordancePanel.tsx:26-47`、:170-176）；TM 模糊检索区 minScore 50（`:23`、:116-120）。**缝**：TM 区只按 sourceText 召回（`tm.lookup` 无译文侧检索），且 TM 命中卡无「应用/定位」动作，纯展示 |
| 确认写 TM + 重复句传播 | **HAVE** | 确认写唯一工作库 + 传播到全项目未译重复句为草稿（origin `tmExact/100`）+ 句段级 QA 同事务（`lib.rs:1245-1305`）；UI 消息含传播计数（`WorkbenchView.tsx:1154-1161`）。测试 `engine_rpc.rs:4124` |
| 多库挂载管理 | **HAVE（S3d 全套）** | `TmManageDialog.tsx`：挂载（:300-310）/ 新建并挂载（:387-401）/ 启停（:240-247）/ 排序（:228-236）/ 设为可写（先降后升，:253-278）/ 卸载（:280-290）/ 改名 baseRevision（:312-341）/ 删库两段式 cascade（:344-361）/ 按库浏览条目（:144-150）；attach 语言对软提示 badge（:102-120、:531-538）。`project.create` 自动建库挂 writable priority 0（`lib.rs:465-498`，测试 `engine_rpc.rs:3963`） |
| 条目编辑/删除、分页搜索 | **HAVE** | `tm.list` 分页（默认 100/上限 500，`tm.rs:12-14`）+ 源/译双侧大小写不敏感子串搜索（`assets.rs:216-243`）；`tm.update` 改源文重建 hash+模糊索引、重复源诚实 conflict（`assets.rs:249-297`）；`tm.delete`（`assets.rs:300-316`）；对话框 50/页 + 两步删除（`TmManageDialog.tsx`） |
| origin 芯片（TM 分 / AI 模型 / edited 失色） | **HAVE** | `SegmentGrid.tsx:137-183`：TM 芯片带真实分值、AI 芯片永不带数字（:159-160 注释 NEVER-FAKE）、`edited` 后 muted 失色保值（:145-146、:180；`packages/ui/src/components.tsx:315-338`）；tooltip 列状态/来源/分值/模型；无 origin 的行什么都不显示（:138-139「never a guess」）。持久 origin 优先于实时 lookup 徽标（:921-931） |
| 导入导出 TMX/CSV/TSV | **HAVE** | 引擎：格式推断/显式、批内去重、单事务（`assets.rs:318-383`）；导出 overwrite 门 + 管理目录拒绝（`assets.rs:385-430`）。UI：设置页选库下拉（缺省工作库、可写标注，`ProjectSettingsDialog.tsx:1072-1084`）、memoryId 显式随调用（:590-596、:618-624）、覆盖两段确认（:150、:719-728）、结果点名库 |
| 空库/无匹配/禁用库/无工作库 | **HAVE（诚实）** | 无匹配空态（`TmPanel.tsx:58-59`）；禁用挂载不参与读（`memories.rs:404-413`，测试 `engine_rpc.rs:4101`）；无工作库确认诚实 conflict 提示去 TM 管理（`memories.rs:424-429`），UI 原样上抛（`WorkbenchView.tsx:1180`） |
| TM 条目元数据（作者/domain/备注/用量） | **MISSING** | `TmEntry` 只有句对 + 溯源指针 + 时间（`tl-domain/src/lib.rs:528-538`）；TMX 的 domain/author 导入即丢（`assets.rs:354-366` 只取 source/target/created_at；`TmExchangeUnit` 有字段，`assets.rs:405-417` 导出恒 None） |
| 模糊命中源文差异高亮（fuzzy diff） | **MISSING（UI 层）** | `TmPanel.tsx:93-96` 源文纯文本展示，无与活动句源文的差异标注——Trados/memoQ 的基本体验，两串文本都已在手（`TmMatchItem.entry.sourceText` + `activeSegment.sourceText`），纯渲染缺席 |
| 确认不写 TM 变体 | **MISSING（chord 已预留）** | `SegmentGrid.tsx:207-211`：Ctrl+Shift+Enter 注释明说「reserved for confirm-without-TM (an engine contract extension); the chord stays vacant until that exists」——引擎无此契约 |
| 罚分/折扣模型（对齐/导入 penalty） | **MISSING** | 分数只有 `match_score` 重排 + priority 决胜（`assets.rs:165-190`），无 per-memory penalty、无导入折扣概念 |

**「UI 有引擎无 / 引擎有 UI 弱」的缝汇总**：引擎有 UI 弱——`tm.pretranslate` 的 `minScore`（无旋钮）、`tm.lookup` 的 `limit/minScore`（工作台恒默认）、`tm.list` 双侧子串搜索没有被 concordance 借用做译文侧 TM 检索。UI 有引擎无——Ctrl+Shift+Enter 确认不写 TM（chord 预留、契约缺席）。没有发现任何假 chrome（inContext 死标签已在本树改为不渲染）。

---

## 4. 完善度总评与缺口

**档位：能用、核心闭环完整，约 80%。** 译者日常主链路（查 → 应用/快捷键 → 预翻译 → 检索 → 确认写库 → 传播 → 多库管理 → 导入导出 → 来源可见）全部真实落地且有引擎测试（`engine_rpc.rs:3958-4200` multi-TM 族、`vertical.rs:846/1629`）；洞集中在模糊匹配的深度体验与条目元数据。不是「半残」——没有一条主链路是假的或断的。

Top 缺口（≤8，不估工期）：

| # | 缺口 | 档位 | 依据 |
| --- | --- | --- | --- |
| 1 | prompt 注入 TM 例句（assist + agent） | **NEAR 薄契约** | `build_grounded_prompt` TM 分节现成（`tl-ai/src/lib.rs:1628`、:1553-1560），缺引擎接线 + 注入策略；PRD 已定位为独立切片（`mt-agent-modes.md:133-135`）。这是 TM↔AI 最大的缺失通路 |
| 2 | 预翻译 minScore/选项 UI | **HAVE 可补 UI** | 参数在契约（`tm.rs:18`）与引擎（`assets.rs:439`），ribbon 恒默认（`WorkbenchView.tsx:1315-1317`） |
| 3 | 模糊命中源文差异高亮 | **HAVE 可补 UI** | 两串源文都在 `TmMatchItem`，纯渲染工作（`TmPanel.tsx:93-96`） |
| 4 | concordance 译文侧 TM 检索 | **HAVE 可补 UI（借 `tm.list` 双侧子串）/ NEAR（正门给 `tm.lookup` 加 field）** | `tm.list` 已搜 source+target（`assets.rs:216-219`）；`tm.lookup` 只按源召回（`assets.rs:120`） |
| 5 | 确认不写 TM 变体 | **NEAR 薄契约** | `SegmentConfirmParams` 加可选 flag；chord 已预留（`SegmentGrid.tsx:207-211`） |
| 6 | TM 条目元数据（作者/domain/备注/AI 来源标记） | **LATER** | `TmEntry` 动存储 schema；顺带解决第 2 节第 5 行「AI 来源进库即丢」与 TMX domain/author 丢失 |
| 7 | aiDraft origin 的行为型 QA 规则（如「AI 草稿未编辑即确认」） | **NEAR 薄契约** | `qa.unedited-fuzzy` 的同构复制（`tl-qa/src/lib.rs:1176-1205` 模式 + `origin.kind==aiDraft` 谓词），引擎已喂 origin |
| 8 | inContext 上下文匹配 | **LATER（落地前 NEVER-FAKE）** | 需要 `contextHash`（字段已在 `Segment`，`tl-domain/src/lib.rs:356`）参与 lookup 与存储索引；在此之前任何「上下文匹配/101%」都是造假 |

不建议做的（NEVER-FAKE，与既有红线一致）：假 `.sdltm` 文件树节点、假 101%/上下文匹配、MT/QE 置信度分数、TM 命中排名「推荐」标签。

---

## 5. 过时文档清单（对照本基线标出过时句）

### `docs/research/translunar-capability.md`（基线 `8f958ee`，落后多轮）

| 位置 | 过时句 | 当前事实 |
| --- | --- | --- |
| §1.5:76 | 「TM 是项目级单库（project_memory_id），没有多 TM 挂载/优先级/穿透模型」 | S3c/S3d 已落地 `memory.create/list/attach/detach/update/rename/delete` 七 RPC（`tl-protocol/src/lib.rs:57-63`）+ mounts 全语义（`crates/tl-engine/src/memories.rs` 全文件）；`project_memory_id` 仅剩派生 id 形状（`assets.rs:37-44`） |
| §1.5:69-74 | `tm.list/import/export` 无 `memoryId`；`tm.pretranslate` 返回字段无 `skippedLocked` | 均已扩展（`assets.rs:236-240`、:323-324、:387-388、:432-503） |
| §1.4:60-62 | `Segment` 字段列表无 `origin`/`locked`；「不存在……句段级锁」 | `Segment.origin` + `locked` 已是契约字段（`tl-domain/src/lib.rs:346-368`）；`segment.lock` 是正式方法（`tl-engine/src/lib.rs:1313-1336`） |
| §3.3:229 | 「引擎不存储句段来源……`Segment` 无 origin 字段……需要新的 origin 持久化（LATER）」 | origin 持久化已落地（`tl-domain/src/lib.rs:309-342`），行内芯片已上线（`SegmentGrid.tsx:137-183`） |
| §3.3:233 | 「锁定无引擎支持」 | 同上，`segment.lock` 已落地 |
| §3.4:245 | 「TM 选择器下拉 NEVER-FAKE：单项目单 TM」 | 多库挂载真实存在，选库下拉已是真功能（`TmManageDialog.tsx`、`ProjectSettingsDialog.tsx:1072-1084`） |
| §1.8 表 | `ai.assist.start`/`ai.agent.start` 参数与 `AgentRunView` 字段（无 profileId/approvalMode/proposals 等） | 本轮契约增量见 `docs/prd/mt-agent-modes.md` §5 与 `tl-protocol/src/ai.rs` |
| §五:319 | 「`TmPanel.tsx` 的 GRADE_LABEL 含 `inContext: "上下文"` 死标签」 | 已修：GRADE_LABEL 为 Partial Record 只含 exact/fuzzy，死 grade 不渲染（`TmPanel.tsx:22-25`） |
| **仍成立** | §1.5:78「`inContext` 分级没有任何产出路径」 | 本树复核仍成立（`assets.rs:126`、:143 只造 Exact/Fuzzy） |

### `docs/research/pdf-mt-agent.md`（基线 `6c2692f`，落后一轮；文件在 `cursor/gf-research-pdf-mt-agent-2398` 分支）

| 位置 | 过时句 | 当前事实 |
| --- | --- | --- |
| §3.2 | 「同时配置多 provider……不存在」「Assist prompt 术语注入核实为无」「`instruction` 参数存在但 AiPanel 永远传 null」 | `ai.profile.add/list/remove` 已落地（`lib.rs:1392-1472`）；术语已注入 assist 与 agent prompt（`aiops.rs:97-114`、`lib.rs:1560-1562`、`agent.rs:130-138`） |
| §4.1/§4.3 | 「Agent 整篇一刀、maxSegments UI 传 null、失败句无一等重跑、步骤 id 不可跳、`AgentRunView` 无 failedSegmentIds」 | `segmentIds` 作用域（`lib.rs:1713-1727`、`AgentPanel.tsx:279-281`）、maxSegments 输入框（`AgentPanel.tsx:446-451`）、失败句重跑新任务单（`AgentPanel.tsx:516-524`）、`failedSegmentIds`（`lib.rs:1752`）均已落地 |
| §4.1 | 「TM 预翻 inline」描述基本成立，但当时无审批三档 | 现有 `approvalMode: manual/auto/turbo`（`lib.rs:1760-1763`），TM 精确复用三档一致 |
| **仍成立** | §2 全部 PDF/MinerU 结论、§3.2「QE/置信度 NEVER-FAKE」 | 本树未变 |

### 与本基线一致（非过时）

- `docs/prd/s3-multi-tm.md`：状态头「S3d 已落地」与引擎/UI 事实吻合（唯一未立项项：多库模糊召回基准，`s3-multi-tm.md:23`）。
- `docs/prd/mt-agent-modes.md`：即本轮实现决策记录，与代码一致（含「本轮只接术语、TM grounding 推迟」`:133-135`）。

---

## 6. 已补（`cursor/gf-tm-context-2398` 轮，基线 `3016927` 之后）

§4 的八个缺口按档位处置如下。LATER 两项维持不做；其余全部落地，证据以本轮代码为准。

| # | 缺口 | 处置 | 落点 |
| --- | --- | --- | --- |
| 1 | prompt 注入 TM 例句 | **已补** | 引擎新增 `prompt_grounding_for`（`crates/tl-engine/src/lib.rs`）：`tm_matches_mounted` 真实命中（enabled 挂载、minScore 60、上限 5 条，provenance 带库名+grade），经 `aiops::grounded_messages` 进 `tl_ai::build_grounded_prompt` 的 TM 分节。术语分节保留原管道。assist 与 agent 起草共用同一条路（`ai_assist_start` / `ai_agent_start` 未命中分支） |
| 2 | 预翻译 minScore UI | **已补** | `PretranslateDialog.tsx`：ribbon「预翻译」先开对话框，阈值 1–100、默认 75（与引擎 `TM_PRETRANSLATE_DEFAULT_MIN_SCORE` 一致），随 `tm.pretranslate` 显式下发 |
| 3 | 模糊命中源文 diff | **已补** | `TmPanel.tsx`：fuzzy 卡渲染记忆源文 vs 活动句源文的字符级差异（复用 `lib/diff.ts` 的 `diffChars`），exact 卡保持纯文本 |
| 4 | concordance 译文侧 TM | **已补（借 `tm.list`）** | `ConcordancePanel.tsx` 新增「项目 TM（双侧子串）」小节：`memory.list` 取 enabled 挂载，逐库 `tm.list` 双侧子串（每库 20、合并展示 20），命中侧打「源文/译文」badge 并高亮。禁用挂载照旧排除 |
| 5 | 确认不写 TM | **已补** | `SegmentConfirmParams.skipTmWrite`（可选，缺省 false），`SegmentConfirmResult.tmEntry` 变 `Option`。跳过 upsert 时**同时跳过传播**（传播本质是 TM 级复用），句段级 QA 照常跑。Ctrl+Shift+Enter / 菜单「确认但跳过 TM 写入」接线（`SegmentGrid.tsx` `nextUnconfirmedSkipTm`、`menu-template.ts`、快捷键表） |
| 6 | TM 条目元数据/AI 来源进库 | **维持 LATER，未做** | 需 `TmEntry` schema 动存储，本轮红线明确排除 |
| 7 | aiDraft 未改即确认 QA | **已补** | `qa.unedited-ai-draft`（`crates/tl-qa/src/lib.rs`）：谓词 `confirmed && origin.kind==aiDraft && !origin.edited`，warning 级，params 带 `model`；`QaPanel.tsx` 本地化「AI 草稿（模型）未修改即确认」。与 `qa.unedited-fuzzy` 同构，只吃引擎事实 |
| 8 | inContext 101% | **维持 LATER，未做、未画** | lookup 仍只产 exact/fuzzy；本轮上下文感知全部走 AI prompt，无任何假上下文匹配分 |

### 上下文感知（全文感知）的实现口径

- **单一 prompt 路**：`aiops::grounded_messages` 是 assist 与 agent 起草的唯一 prompt 构造点，共用同一 persona（`DRAFTING_SYSTEM_INSTRUCTION`）与同一 `build_grounded_prompt` 分节渲染，无第二套文案。
- **邻句窗**：活动句 ±2（`GROUNDING_CONTEXT_RADIUS`，与 `GroundingOptions` 默认 before 2 / after 2 一致），源+现有译文一并注入，空译文如实留空（`store::segments_by_ordinal_range`）。
- **文档级信号**：同文档**已确认**句对均匀抽样，上限 8 条（`GROUNDING_DOCUMENT_SAMPLE_LIMIT`），排除活动句与邻句窗，经新增 `GroundingInput.document_sample` 分节（`crates/tl-ai/src/lib.rs` `GroundingDocumentPair`）。未确认草稿、别的文档、禁用库一概不进 prompt。
- **预算与诚实截断**：整包 `max_chars` 默认 24,000 字符，活动句段分节保留预算，砍分节时 bundle 置 `truncated`（`build_grounded_prompt` 既有语义，未改）。
- **测试**：`crates/tl-engine/tests/vertical.rs::drafting_prompts_ground_in_real_tm_neighbours_and_document_pairs` 用捕获式 SSE 假 provider 断言 assist 与 agent 发出的 messages 里真实出现 TM 例句、邻句、已确认句对；负例断言无数据时三个分节全部缺席。`aiops.rs` 单测覆盖分节渲染与空 grounding 不编造。

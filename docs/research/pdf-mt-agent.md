# PDF/OCR、MT 接入、AI Agent —— 核查与方向探索

> 核对基线：`origin/cursor/gf-ux-remain-2398`（commit `6c2692f`），日期 2026-08-28。
> 性质：**核查 + 方向探索**。本轮不实现 PDF filter、MinerU、多模型并行、新 Agent 流程。
> 红线：每个结论给 `文件:行号` 或 RPC 名；凡标 NEVER-FAKE 的形态不得以假 chrome 出现。

## 1. 一句话结论

- **PDF/MinerU**：绿地上**从未接入**——不是半残，是零。整棵当前树（crates/apps/packages）对 `pdf`/`ocr`/`mineru` 大小写不敏感检索为**零匹配**；导入对话框与文件过滤器也不暗示 PDF，无诚实性缺陷。唯一残留是 `fixtures/pdf/` 四个死文件，零测试引用。
- **MT**：接 AI API 翻译**允许且已落地**——11 个 provider（含 DeepL、OpenAI 兼容端点）单供应商配置、密钥仅内存、单句异步提案、tagCheck 门禁、人点应用；**同时配置多 provider / 并行多模型多候选在当前契约下不存在**（`Engine.ai` 是单个 `Option` 字段，assist 同句段单飞）。
- **Agent**：管线真实且红线干净（TM 预翻 → ≤4 worker 起草 → QA → 只停 `awaitingReview`，从不确认/写 TM/导出），但对译者是"整篇一刀"：无作用域入口、`maxSegments` UI 永远传 null（默认 50 静默截断）、失败句无一等重跑、步骤句段 id 截断 8 位不可跳转、术语不进 prompt、已有的 `qa.fix.list/apply` 没被 Agent 收尾利用。

---

## 2. PDF / MinerU 对照

### 2.1 逐项核查（当前树）

| 检查 | 结论 | 证据 |
| --- | --- | --- |
| `builtin.pdf` 是否注册 | **未落地** | `crates/tl-engine/src/lib.rs:249-262`：FilterRegistry 只注册 docx / txt / md / html / xliff / xlsx / pptx + 两个显式双语 filter（bilingual docx/xlsx）。全 `crates/` 检索 `pdf`（忽略大小写）零匹配 |
| `tl-filter-pdf` crate 是否存在 | **不存在** | `crates/` 目录清单；根 `Cargo.toml:3-21` workspace members 共 16 个 `tl-*` crate，无 pdf |
| `mineru.credential.*` / `pdf.page.*` / `pdf.correctOcr` | **不存在** | `packages/contracts/src/index.ts:45-103`（`ENGINE_METHODS` 共 57 个方法）与 `crates/tl-protocol/src/lib.rs:34-90`（方法常量目录）均无任何 `mineru.*` / `pdf.*` 条目 |
| 导入对话框能否选 .pdf | **不能，且不暗示能** | `apps/desktop/src/main/index.ts:197-213`：`chooseSource` 过滤器 extensions = docx/txt/md/html/xlf/xliff/xlsx/pptx。`ImportDocumentDialog.tsx:29`：`FormatChoice` 只有 `auto` 与两个双语 filter |
| 桌面 Settings → OCR / MinerU 表单 | **不存在** | `apps/` 与 `packages/` 全树检索 `pdf|ocr|mineru`（忽略大小写）零匹配；renderer 组件清单中无任何 OCR/凭证表单 |
| 密钥 keyring / `TRANSLUNAR_MINERU_*` | **不存在** | `crates/` `apps/` `packages/` 检索 `keyring|TRANSLUNAR_` 零匹配；当前引擎唯一的密钥面是 `ai.configure` 的内存态 `SecretString`（`crates/tl-protocol/src/ai.rs:19-20`，`crates/tl-ai/src/lib.rs:617-649`） |
| `fixtures/pdf/*` | **历史残留死文件** | `fixtures/pdf/` 仍有 `mixed.pdf` / `scanned.pdf` / `text-layout.pdf` / `scanned-page.png`；全仓引用只出现在 `.trellis/tasks/archive/` 的历史证据文档（且那些引用记录的正是"no filter matched the source"失败）。当前 `scripts/`、测试、e2e 均不引用 |
| 旧 `translunar-engine` 测试名 | **编不过（包已不存在）** | 根 `Cargo.toml:3-21` 无 `translunar-engine` 成员；`docs/mineru-ocr.md:98` 的 `cargo test -p translunar-engine mineru` 在当前工作区无法解析包名 |

**诚实性判定**：无缺陷。导入扩展名、格式下拉、设置页都没有 PDF/OCR 的假入口。`fixtures/pdf/` 属于无 UI 面的死文件，不构成对用户的暗示（可在未来清理，但本轮不动）。

### 2.2 旧合同（`docs/mineru-ocr.md`）→ 当前状态

| 旧 RPC / 行为 | 当前状态 | 证据 |
| --- | --- | --- |
| `mineru.credential.set` / `status` / `delete` | 无此 RPC | `packages/contracts/src/index.ts:45-103` |
| `document.import` 走 `builtin.pdf` | 无此 filter | `crates/tl-engine/src/lib.rs:249-262` |
| 导入选项 `ocrEngine` / `ocrMode` / `ocrLanguages` / `pageRange` / `mineruBaseUrl` / OCR 侧 `segmentationMode` | 无任何 OCR 选项 | `crates/tl-protocol/src/document.rs:9-27`：`DocumentImportParams` 仅 `projectId` / `sourcePath` / `filterId` / `srxPath` / `segmentation` |
| `project.batchImport` | 无此 RPC | `crates/tl-protocol/src/lib.rs:34-90` |
| `pdf.page.list` / `pdf.page.get` / `pdf.correctOcr` | 无此 RPC | 同上 |
| `TRANSLUNAR_MINERU_BASE_URL` 等 6 个环境变量 | 引擎不读 | `crates/` 检索 `TRANSLUNAR_` 零匹配 |
| OS keyring `translunar-cat.mineru` | 引擎无 keyring 依赖 | `crates/` 检索 `keyring` 零匹配 |
| Poppler / Tesseract 本地 OCR 残余 | 不存在 | `crates/` 检索 `poppler|tesseract` 零匹配（含于 pdf/ocr 检索） |
| 结构路径 `pdf:p=…;s=ocr;…` 与网格 OCR 标记 | 不存在 | renderer 检索 `ocr` 零匹配 |
| 老前端 `translunar.renderer.pdf-import-options.v1` localStorage | 不存在 | renderer localStorage 使用仅 `ProjectsView.tsx:22-56`（最近项目）与 `lib/theme.tsx`（主题） |
| 旧 AI 纠错入口 `ai.run.start(freeform)` | 无此 RPC；现行 AI 面是 `ai.assist.*` | `packages/contracts/src/index.ts:95-102` |

`docs/mineru-ocr.md` 顶部的 Historical 声明**核实后成立**，已在该文件补记核对基线（见本轮 diff）。`.trellis/spec/frontend/interop-pdf.md` 顶部 Historical 声明同样成立（该文件描述的 `pdf.page.*`、interop、taskPackage、reimport 全部不在当前契约）。`docs/editor-first-iteration.md` 2026-08-15 段（`:134-145`）描述的是旧前端挂旧引擎 RPC，顶部已有 pre-greenfield 声明，无需再改。

### 2.3 若要恢复 MinerU：落地成本（只列，不做）

- **crate**：新建 `tl-filter-pdf`（probe PDF 魔数；文本层提取本地路径 + MinerU HTTP 路径）。HTTP 取消可复用 `tl-ai` 的模式（`execute_provider` 的 50ms 轮询 abort，`crates/tl-ai/src/lib.rs:778-813`）。
- **协议**：`tl-protocol` 恢复 `mineru.credential.set/status/delete` 三个方法 + `DocumentImportParams` 扩展 OCR 选项（闭合枚举，未知值 typed `invalidParams`，**无静默 fallback**——旧合同这条红线必须保留）；如需页面审阅再加 `pdf.page.*`（可后置）。
- **引擎**：FilterRegistry 注册 + 凭证存储。红线：密钥**不进 SQLite**——要么恢复 keyring 依赖（新增 crate 依赖 + 平台矩阵测试成本），要么先走 `ai.configure` 同款内存态（重启即失，成本最低，先能用）。
- **桌面**：`chooseSource` 过滤器加 pdf（`apps/desktop/src/main/index.ts:201-210`）；导入对话框加 OCR 选项组；Settings 加凭证表单（write-only，永不回显）。
- **主要风险**：① 扫描件 vs 文本层判别（旧合同用 `ocrMode=auto` 承担，判错即产出乱码段）；② 页数/字节 preflight 必须先于凭证读取与 HTTP（旧合同 `break-loop-page-tree-bounds` 教训在 `.trellis/tasks/archive/2026-08/08-02-mineru-ocr-pdf-pipeline/`）；③ 失败必须 typed 且不发布半截文档（AC-02 语义）；④ 凭证不得进 SQLite/日志/错误文本（AC-03 语义）。

---

## 3. MT：能不能接 AI API？多模型/多候选边界

### 3.1 HAVE（现在就能用）

- **`ai.configure`**：11 个 `AiProviderKind`（`crates/tl-ai/src/lib.rs:35-47`；目录 `provider_catalog()` `:484-501`）——openai / openaiResponses / anthropic / gemini / **deepl** / deepseek / qwen / glm / kimi / volcengine / **openaiCompatible**。`baseUrl` 可选（`openaiCompatible` 实际必填其端点，`crates/tl-protocol/src/ai.rs:15-18`）。远端强制 HTTPS、loopback 允许 HTTP（`validate_endpoint`，`tl-ai/src/lib.rs:456-482`）。UI 下拉同 11 项（`AiPanel.tsx:21-33`）。
- **密钥仅内存**：`Engine.ai: Option<AiRuntime>`（`crates/tl-engine/src/lib.rs:283`、`:1319-1324`），`SecretString` Debug 打 `[REDACTED]`、Drop zeroize（`tl-ai/src/lib.rs:639-649`）；协议注释明说 never persisted（`ai.rs:19-20`）；UI 保存后清空密钥输入框（`AiPanel.tsx:105`）。重启即失，无落盘。
- **`ai.assist.start(translate|refine)`**：单句提案、立即返回、轮询到终态（`tl-engine/src/lib.rs:1345-1425`）。**不写句段**——`done` 只带 `result.draftTarget`，人点「应用为草稿」（`AiPanel.tsx:356-365`），拒绝按钮并列（`:369-372`）。
- **门禁**（引擎侧，非 UI 约定）：已确认句段 → `conflict`（`lib.rs:1352-1356`）；锁定 → `conflict`（`:1357-1361`）；refine 空译文 → `invalidParams`（`:1362-1366`）；未配置 → `aiNotConfigured`（`:1368`）；同句段单飞（`:1371-1380`）。tagCheck 破损 → UI `applyBlocked` 禁用应用（`AiPanel.tsx:241,355`；校验器与 QA 同源，`tl-ai/src/lib.rs:1898-1910`）。
- **取消诚实**：`ai.assist.cancel` 丢弃迟到结果（`lib.rs:1877-1880`）；in-flight HTTP 在 50ms 轮询内 abort（`tl-ai/src/lib.rs:778-813`），实测断言 `<5s` 而非等 60s 超时（`tl-ai` 测试 `cancellation_aborts_an_in_flight_request_without_waiting_for_the_timeout`）。
- **DeepL 已是一等 provider**：`DeeplTranslate` 协议走 `POST {base}/translate` 表单（`tl-ai/src/lib.rs:1057-1093`），locale 截断映射（`zh-CN`→`zh`，`:1114-1116`），不是也不需要第二套"MT 管线"。
- **溯源已存在**：应用 AI 草稿会打 `origin{kind: aiDraft, model}`，Agent TM 预翻打 `origin{kind: tmExact, score: 100}`（`lib.rs:1741-1746`、`:1582-1587`；契约 `crates/tl-protocol/src/segment.rs:39-45`）。注：`docs/research/translunar-capability.md` §3.3 "（`Segment` 无 origin 字段）"与 §3.3 "锁定无引擎支持"两句已过时（`segment.lock` 现为正式方法，contracts `:61`）；本轮不改该文档正文，在此登记。

### 3.2 NOT（当前没有，不许画）

- **同时配置多个 provider**：`self.ai = Some(runtime)` 是覆盖式单槽（`lib.rs:1322`），无 profile 列表存储（`tl-ai` 的 `AiProviderProfile`/`AiSettings` 类型存在但引擎只造一个临时 "runtime" profile，`aiops.rs:17-43`）。
- **并行打多模型出多候选**：assist 同句段单飞守卫（`lib.rs:1371-1380`）+ 单槽 provider，客户端并发第二发就是 `conflict`。
- **同屏多引擎对比 / MT 62% 置信度**：没有任何 provider 返回置信度；`tl-ai-quality`（QE 打分）零 RPC 零依赖——`crates/tl-engine/Cargo.toml` dependencies 不含它。NEVER-FAKE（与 `translunar-capability.md` §3.5 一致）。
- **独立「MT 面板」**：就是「AI 辅助」dock（`AiPanel.tsx:255`）。叫法可以改，第二块面板没有。
- **Assist prompt 术语注入**：核实为**无**。`assist_messages`（`crates/tl-engine/src/aiops.rs:45-82`）只有固定 system 文案 + 可选 `instruction` 拼接；`tl-ai` 里现成的 `build_grounded_prompt`（Terminology/TM/上下文分节注入，`tl-ai/src/lib.rs:1628-1846`）**引擎从未调用**（`tl-engine` 全文无 `build_grounded_prompt`/`GroundingInput` 引用）。另注：`ai.assist.start` 的 `instruction` 参数存在，但 AiPanel 永远传 `null`（`AiPanel.tsx:132`）——参数有、UI 无。

### 3.3 用户问「是否允许接入 AI API 翻译、多模型/候选」

**接入 API：允许且已落地。** 单供应商 + 模型名 + 可选 baseUrl，见 §3.1。要换模型 = 重新 `ai.configure`（密钥重输，因为不落盘）。

**多模型/多候选：契约未允许并行。** 诚实路径三条（只写，不实现）：

- **方案 A（现状即可）**：切换 `ai.configure` 再跑第二次 assist。候选一次只有一张，换供应商要重贴密钥。可用但笨，无契约改动。
- **方案 B（NEAR，薄契约增量）**：最小增量是三件事——
  1. 引擎持有**内存态 profile 列表**（`ai.profile.add/list/remove`，或 `ai.configure` 接受数组；密钥依旧内存态、不落盘）；
  2. `ai.assist.start` 加可选 `profileId`，同句段单飞守卫从 per-segment 放宽为 per-(segment, profile)（`lib.rs:1371-1380` 的谓词加一个维度）；
  3. UI 一次点击串行/并发发 N 个 start，列 N 张候选卡，各带**真实** `provider` / `model` / `elapsedMs` / `tagCheck`（`AiAssistResult` 已有全部四个字段，`ai.rs:61-68`），人应用其中一张为草稿（origin 记真实 model）。
  禁止：编造排名、编造分数、编造"推荐"标签。卡片顺序按返回先后或字母序，别装智能。
- **方案 C（DeepL 与 LLM 并列）**：DeepL 已经是 provider 之一（§3.1），在方案 B 里它就是 profiles 中的一项，天然与 LLM 并排出候选卡。不存在"接 DeepL 需要另一套管线"的问题。

**密钥生命周期 / 取消 / 已确认拒绝**（三条现状红线，多候选方案必须原样继承）：密钥仅内存、重启即失、UI 不回显（§3.1）；每张候选可独立取消，迟到结果丢弃（`lib.rs:1877-1880`）；已确认句段任何 assist 一律 `conflict`（`lib.rs:1352-1356`），多候选不改变这一点。

---

## 4. AI Agent：现状评估（译者视角）

### 4.1 流水线事实

`ai.agent.start`（`crates/tl-engine/src/lib.rs:1483-1636`）：
plan（`:1548-1558`，步骤文案就写明「结束停在人工审核门」）→ **TM 精确预翻 inline**（`:1560-1612`，按挂载优先级点查 (memory, hash) 唯一索引，命中落 Draft + `origin tmExact score 100`）→ 未命中交 **≤4 worker** 队列起草（`agent.rs:36` `AGENT_SEGMENT_WORKERS = 4`）→ 全部收队后引擎线程跑 `qa.run`（`lib.rs:1798-1800`）→ summary（`:1819-1833`）→ **唯一正常终态 `awaitingReview`**（`:1818`；契约注释「never confirms, never signs off, never exports」，`ai.rs:178-189`）。

人闸：`AgentPanel.tsx:253-264` 两个按钮「去工作台查看草稿」「去导出…」；导出仍会撞 QA 门（`ExportQaGateConfirm.tsx`）。指令是自由文本进 system prompt（`aiops.rs:58-61`；输入框 `AgentPanel.tsx:220-224`）。

### 4.2 优点（写明，这些是别家 CAT 的 agent 营销词里最常造假的部分）

- **不确认、不写 TM、不导出**：契约级（`ai.rs:178-189`），测试断言终态 `awaitingReview`（`crates/tl-engine/tests/vertical.rs:783-878`）。
- **人的工作不可被覆盖**：worker 回来时重查活行，已被人编辑/锁定/非未译 → skipped 并如实记步骤（`lib.rs:1704-1719`）；锁定行根本不进计划（`:1529`）。
- **草稿也要过 tag 完整性门**：破损不落草稿、计失败（`:1721-1737`）——与 assist、QA 同一个校验器。
- **取消诚实**：已产出草稿保留、剩余句未触碰，步骤明说（`:1856-1864`）；HTTP abort 同 §3.1。
- **并发有界**：同文档第二个 run 是 `conflict` 不是排队（`:1490-1497`）；全局 4 run 上限（`:63-68`、`:1503`）。
- **失败不装死**：空译文/调用失败逐句计入 `failedSegments` 并落步骤（`:1763-1785`）。

### 4.3 弱点（毒舌但每条有出处）

1. **整篇一刀**：计划集只能是"该文档全部未译句"（`untranslated_document_segments` + 空译文 + 未锁定，`lib.rs:1525-1531`）。`AgentStartParams` 只有 `documentId` / `instruction` / `maxSegments`（`ai.rs:125-132`）——没有筛选集、没有选中句、没有"只跑 QA 未过的句"。
2. **`maxSegments` 存在但被 UI 藏死**：AgentPanel 永远传 `null`（`AgentPanel.tsx:169`）→ 引擎默认 50（`lib.rs:63`、`:1518-1521`）。一篇 300 句未译的文档，Agent 静默只做前 50 句，译者只能从「计划 50」倒推。参数就在契约里，这是纯 UI 欠账，也是最接近"作用域"的现成杠杆。
3. **失败句只能肉眼扒 steps**：`AgentRunView` 只有 `failedSegments` 计数 + 步骤流水（`ai.rs:200-214`），没有 `failedSegmentIds` 集合，UI 无法圈选。
4. **没有失败重跑入口**：不过引擎语义其实友好——失败句没落草稿、仍是未译，**再 start 一次天然只重试失败句 + 剩余句**（TM 命中句已成 Draft 不会重扫）。缺的是 UI 一键与"这是新 run"的诚实标注。
5. **步骤句段 id 截断 8 位且不可点**（`AgentPanel.tsx:275-277`）：`jumpToSegment` 就在同一个工作台（`WorkbenchView.tsx:1770`），AgentPanel 没接。译者看到「句段 3f9a2b1c…标签破损」后要自己去网格里找。
6. **指令不自动带术语**：见 §3.2 —— agent worker 与 assist 共用 `assist_messages`（`agent.rs:128-135`），术语命中（`term_lookup` → `attached_term_entries` + `term_hits`，`crates/tl-engine/src/assets.rs:1109-1118`）从不进 prompt。术语违规只能靠 QA 事后抓（`qa.term-required:*`）。
7. **QA 收尾只报数不给路**：run 结束报 `openQaIssues`（`lib.rs:1806-1817`），但已有的 `qa.fix.list/apply`（引擎 `qacheck.rs:557-603`、`:613-669`；renderer 已接 `WorkbenchView.tsx:1400`、`:1427`）没有被 Agent 的收尾卡片引用——译者要自己想起 QA 面板里有「应用修复」。

### 4.4 e2e / 测试现状

- Rust 侧：loopback SSE fixture 驱动完整 run 到 `awaitingReview`（`vertical.rs:783-878`）；assist 的 tag 门、确认句拒绝、off-thread、取消、失败诚实各有专测（`vertical.rs:413-781`）；`qa.fix` 有守卫测试（`engine_rpc.rs:3266`、`:3361`）。
- Playwright e2e 只覆盖**无凭证时的诚实拒绝**（`apps/desktop/tests/e2e/vertical.spec.ts:254-272`）——真 provider 的 agent 桌面路径无 e2e（可理解：要真密钥）。

---

## 5. 增强方向表 + 推荐切片

判档口径：**HAVE**=引擎数据/RPC 已备，纯 UI 编排；**NEAR**=需一层薄契约（新可选参数/新只读字段），不引入新存储；**LATER**=需要新存储/新状态机；**NEVER-FAKE**=后端落地前禁止以假形态出现。

| # | 方向 | 档位 | 依据与边界 |
| --- | --- | --- | --- |
| 1a | 作用域：露出 `maxSegments` + 「本次只处理前 N 句」的诚实提示 | **HAVE** | 参数已在契约（`ai.rs:131`），UI 传 null（`AgentPanel.tsx:169`）；默认 50 截断必须显式告知 |
| 1b | 作用域：未译句 | **HAVE（即现状）** | 引擎本来只取未译（`lib.rs:1525-1531`），UI 把这句话说出来即可 |
| 1c | 作用域：当前筛选 / 选中句集 | **NEAR** | `AgentStartParams` 加可选 `segmentIds[]`，plan 时与未译集取交集；不改状态机。筛选状态（全部/未译/草稿/已确认/QA）已在工作台工具条 |
| 1d | 作用域：未确认（= 重写既有草稿） | **LATER，慎** | 违反当前"空译文才可 claim"的安全谓词（`:1529`）与 mid-run 保护精神（`:1704-1719`）；需要显式 `replaceDrafts` 语义 + 交互确认，别顺手做 |
| 2 | 术语进 prompt | **NEAR** | 引擎 start/worker 侧对每个 miss 用现成 `attached_term_entries` + `term_hits`（`assets.rs:1109-1118`）取命中，注入 messages（现成模板：`tl-ai` 的 Terminology 分节，`tl-ai/src/lib.rs:1656-1675`）。**只注入术语库命中，禁止让模型编术语**；assist 同理。无新 RPC，改的是引擎内部管道 + prompt 构造 |
| 3 | 失败集一键重跑 | **HAVE（粗）/ NEAR（精）** | 粗：`awaitingReview` 且 `failedSegments>0` 时给「再跑一次（新任务单）」按钮——失败句仍是未译，新 run 天然只做它们（§4.3-4）。精：`AgentRunView` 加只读 `failedSegmentIds[]`，配合 1c 的 `segmentIds` 精确圈跑。**必须如实标注是新 run**，禁止假装同一 run 续跑 |
| 4 | 步骤点击 → 跳句段 | **HAVE** | `notify.ai.agent.step` 已带 `segmentId`（`ai.rs:169-176`）；`jumpToSegment` 已在 `WorkbenchView.tsx:1770`；AgentPanel 加 onJump prop，id 截断只是显示问题 |
| 5 | QA 后列可机械修复项 | **HAVE** | `qa.fix.list/apply` RPC 与 renderer 接线均已存在（`qacheck.rs:557,613`；`WorkbenchView.tsx:1400,1427`）。Agent 收尾卡片给「查看可自动修复项」入口跳 QA 面板即可。**Agent 永不自动 apply**——apply 的守卫（stale revision conflict、锁定 conflict、确认句降级为草稿）都要人来担 |
| 6 | 多模型候选 | **NEAR** | 同 §3.3 方案 B：内存 profile 列表 + `ai.assist.start(profileId)` + 单飞守卫放宽为 per-(segment, profile)。候选卡只放真实 provider/model/elapsedMs/tagCheck。**NEVER-FAKE**：排名、置信度、"最佳"标签 |
| 7 | 项目级默认 instruction 持久化 | **HAVE（localStorage）/ LATER（引擎字段）** | renderer 已有 per-key localStorage 惯例（`ProjectsView.tsx:22-56`、`lib/theme.tsx`），按 projectId 存默认指令立刻可做；进 `Project.configuration` 需要 domain + 存储改字段，归 LATER |
| 8 | 明确不做 | **NEVER-FAKE** | 自动确认/自动导出（契约级禁止，`ai.rs:178-189`）；假「已完成」态（正常终点是 `awaitingReview`，没有 completed）；QE/置信度分数（`tl-ai-quality` 零 RPC，`tl-engine/Cargo.toml` 无依赖）；云队列/多人审校（全栈无用户/远端模型，`translunar-capability.md` §3.6） |

### 推荐切片顺序（3–5 步，不估日历时间）

1. **步骤跳转 + maxSegments 露出**（表 4 + 1a，全 HAVE）：译者审 Agent 产出的最短路径是"看到失败步骤 → 点过去改"；同一刀顺手把 50 句静默截断改成显式输入 + 提示。只依赖已有 `notify.ai.agent.step` / `ai.agent.status` / `jumpToSegment`，零契约改动。
2. **QA 收尾接 `qa.fix.list`**（表 5，HAVE）：Agent 报完 `openQaIssues` 后给一个真实入口，译者点进去批量应用机械修复——这是把已有 RPC 变成日常动线，依赖 `qa.fix.list` / `qa.fix.apply`。
3. **术语注入 prompt**（表 2，NEAR）：术语一致性是译者每天挨 QA 打的第一大项；注入后 `qa.term-required:*` 从"事后抓错"变"事前喂对"，形成闭环。依赖引擎内部 `term_hits` 管道，无新 RPC。
4. **失败句一键重跑（新任务单）**（表 3 粗档，HAVE）：失败句语义上天然可重跑，UI 只差一个按钮和一句诚实文案；精确圈跑等 `segmentIds` 契约（切片 5）一起做。依赖 `ai.agent.start`。
5. **作用域 `segmentIds[]` + `failedSegmentIds[]`**（表 1c + 3 精档，NEAR）：一次契约增量同时解锁"跑当前筛选/选中句"与"精确重跑失败集"，也是多候选（表 6）之外唯一需要动 `tl-protocol` 的方向。依赖 `ai.agent.start` / `ai.agent.status` 的参数与视图扩展。

---

## 6. 本轮未做 / 刻意不做

- **未实现**任何 PDF filter / MinerU 管线 / 多模型并行 / 新 Agent 流程 / UI 改动——本轮性质是核查与探索，见开头。
- **未改** `docs/research/translunar-capability.md`：其 §3.3 有两句已过时（`Segment` 现有 `origin` 字段，`crates/tl-protocol/src/segment.rs:45`；`segment.lock` 现为正式方法，`packages/contracts/src/index.ts:61`），已在 §3.1 登记，留给该文档的下一次整体刷新，避免只补一句造成前后档位论证不一致。
- **未清理** `fixtures/pdf/` 死文件：零引用、无 UI 面，删除属杂务不属本轮。
- **刻意不建议**：假 PDF 预览、假 MT 置信度、假多引擎同屏对比、Agent 自动确认/自动导出/假完成态、QE 分数、云队列、多人审校（NEVER-FAKE 全清单见 §5 表 8）。
- `docs/mineru-ocr.md` 顶部历史声明核实成立，仅补一行核对记录（不删历史合同正文）。

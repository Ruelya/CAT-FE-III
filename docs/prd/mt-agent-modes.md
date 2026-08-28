# MT 多候选 + Agent 审批三档 + 进度可视化

> 基线：`cursor/gf-ux-remain-2398`（`6c2692f`）。研究背景：`docs/research/pdf-mt-agent.md`
> （`cursor/gf-research-pdf-mt-agent-2398` 分支）。本文是实现决策记录：三个用户诉求
> （MT 多模型多候选、Agent 缺陷修复、审批模式 + 进度可视化）各自怎么切、为什么这样切。
> 红线继承自研究文档 §5 表 8（NEVER-FAKE 清单）与仓库现有契约注释，全部保持。

## 0. 一页结论

- **MT 多候选**＝内存态 AI 配置列表（`ai.profile.add/list/remove`）+ `ai.assist.start`
  可选 `profileId` + 单飞守卫从 per-segment 放宽为 per-(segment, profile)。UI 一次点击
  对每个配置并行发一条 assist，每条一张候选卡，卡上只有引擎返回的
  provider / model / elapsedMs / tagCheck / 文本。没有分数、没有排名、没有「最佳」。
- **审批三档**＝`ai.agent.start` 新参数 `approvalMode: manual | auto | turbo`（缺省
  manual）。差异只作用于 **AI 草稿的落格与确认**；TM 精确复用、tag 门禁、锁定/已确认
  守卫、导出人工化在三档一致。
- **进度可视化**＝`AgentRunView` 新增 `eligibleSegments` / `processedSegments` /
  `skippedSegments` / `autoConfirmed` / `failedSegmentIds` / `proposals` /
  `approvalMode` / `profileId` / `provider` / `model`，全部由引擎在真实事件点计数。
  UI 进度条 = processed / planned，两个数都来自引擎，没有时间估算式假百分比。
- **Agent 缺陷**：本轮修 §4.3 的 1a（maxSegments 露出）、1c（segmentIds 作用域）、
  3（失败句精确重跑）、4（步骤跳句段）、5（QA 收尾入口）、6（术语进 prompt）；
  明确推迟 1d（重写既有草稿）与 7（项目级指令持久化到引擎）。

## 1. 审批三档：各自动做什么、仍要人点什么

对标编程 Agent 的权限档（Claude Code：逐步审批 / 自动接受编辑 / bypass）。CAT 里
与「编辑文件」对应的动作是**落草稿**，与「危险操作」对应的动作是**确认写 TM**，
与「不可逆出仓」对应的动作是**导出**。映射如下：

| 动作 | 手动（默认） | 自动 | Turbo |
| --- | --- | --- | --- |
| TM 精确命中落草稿 | 自动 | 自动 | 自动 |
| AI 草稿落格 | **人工批准**（逐条或整批） | 自动（tag 完整才落） | 自动（tag 完整才落） |
| `segment.confirm`（写 TM） | 人工 | 人工 | **自动，仅限句段级 QA 无 error 的句段** |
| `document.export` | 人工 | 人工 | 人工 |
| 终态 | `awaitingReview` | `awaitingReview` | `awaitingReview` |

三条 rationale：

1. **TM 精确命中三档都直接落草稿**：独立功能 `tm.pretranslate` 本来就整批落草稿，
   Agent 里对同一动作要求逐条点头会造成同一动作两种权限语义。TM 命中是确定性
   复用人工确认过的译文（unique (memory, hash) 点查，origin `tmExact/100`），
   属于「读操作级」信任。
2. **手动档管住的是生成式内容**：AI 草稿是模型产物，手动档把它们全部押进
   `proposals` 队列，引擎在批准前不写任何句段（Assist 提案红线的 Agent 版）。
   批准走与自动档完全相同的写入守卫：活行仍未译、未锁、tag 已过，且同事务刷新
   该句段 QA。人工在运行中或运行后均可批准（候选到达即可处理）。
3. **Turbo 的「自动确认」有硬门**：草稿落格后引擎跑句段级 QA
   （`refresh_segment_qa`，与确认时同一套规则），存在 error severity 的 open issue
   就留在草稿并如实记步骤；干净句段走**同一个** `segment_confirm` 实现（写 TM +
   传播 + QA 刷新 + 无可写记忆时的诚实失败）。Turbo 是显式选择的模式，UI 有
   高权限警示。导出永远不自动做——QA 导出门与人工决定保持唯一出口。

不存在「completed」假终态：三档的正常终点都是 `awaitingReview`，因为导出
（唯一的「完成」语义）永远在人手里。

## 2. 进度可视化：读哪些真实字段

进度条与计数全部来自 `AgentRunView`（RPC `ai.agent.status` / 通知
`notify.ai.agent.step`），没有客户端合成的估算：

| UI 元素 | 字段 | 计数点 |
| --- | --- | --- |
| 进度条 value / max | `processedSegments` / `plannedSegments` | 每个计划句段到达终局（TM 落稿、AI 落稿、提案入队、失败、跳过）时 +1 |
| 「范围内共 N 句」 | `eligibleSegments` | plan 时对作用域内未译未锁句段的总数（截断前），maxSegments 截断因此显式可见 |
| 计数芯片 | `tmApplied` / `aiDrafted` / `failedSegments` / `skippedSegments` / `autoConfirmed` / `openQaIssues` | 引擎既有/新增计数器，事件点各自 +1 |
| 待审批队列 | `proposals[]`（status: pending/applied/rejected/stale） | 手动档每个 AI 候选入队/批准/拒绝/作废时更新 |
| 失败句集合 | `failedSegmentIds[]` | 失败事件点收集，供精确重跑 |
| 当前阶段 | `steps[]` 最后一条 + `status` | 既有步骤流水 |
| 使用的配置 | `profileId` / `provider` / `model` | start 时解析的配置回显 |

取消语义不变：processed < planned 的取消运行就显示为没跑完，进度条停在真实位置。

## 3. MT 多候选：API 形状与守卫

### 3.1 配置列表（密钥仍仅内存）

- `ai.profile.add {provider, model, baseUrl?, apiKey, label?}` → 配置列表。上限 6 个
  （每候选一个 assist 工作线程，fan-out 有界）；超限是诚实 Conflict。
- `ai.profile.list {}` → `{profiles: AiProfileView[], defaultProfileId?}`。
  `AiProfileView` 只有 `profileId / provider / model / baseUrl / label / createdAtMs`
  ——密钥永远不出引擎，list 不回显、错误文本不携带。
- `ai.profile.remove {profileId}` → 更新后的列表。移除默认配置时默认落到剩余第一个。
- `ai.configure` 保持原签名与「单槽覆盖」语义：upsert 保留 id `default` 的配置并设为
  默认，别的配置不动。`ai.status` 增加 `profileCount`；`configured = profileCount > 0`。
- 所有配置与研究文档 §3.1 相同的生命周期：引擎内存态、重启即失、`SecretString`
  Debug 打码 + Drop zeroize。**不进 SQLite。**

### 3.2 并发守卫

`ai.assist.start` 新可选参数 `profileId`（缺省用默认配置）。单飞守卫由
「同句段一发」放宽为「同句段同配置一发」：多候选是不同配置的并行合法请求，
同配置重复点击仍是 Conflict。面板的「取消请求」对本次扇出的全部在飞请求逐一
调 `ai.assist.cancel`，迟到结果照旧丢弃。

### 3.3 候选卡上放什么

只放 `AiAssistResult` 已有的真实字段：provider、model、elapsedMs、tagCheck、
draftTarget（+ 与当前译文的 diff）。排序按返回先后。tag 破损的候选照旧禁用
「应用为草稿」。应用哪张由人点，应用走既有 `segment.update`（origin 记真实
model）。禁止項照旧：排名、置信度、「推荐」标签、多引擎对比分。

Agent 侧同理：`ai.agent.start` 新可选 `profileId`，一次 run 用一个配置（run 视图
回显）。多配置对比翻译是 assist 面板的事，Agent 不做多模型混跑。

## 4. Agent 缺陷：本轮修什么、推迟什么

按研究文档 §4.3 / §5 编号：

**本轮修：**

- **1a maxSegments 露出**（HAVE）：面板数值输入，缺省 50 显式可见；配合
  `eligibleSegments` 把「静默截断」变成「本次处理 X / 范围内共 Y」。
- **1c segmentIds 作用域**（NEAR）：`AgentStartParams.segmentIds?`，plan 时与
  未译未锁集合取交集；UI 提供「全部未译 / 当前筛选可见句段」两个作用域。
- **3 失败句精确重跑**（NEAR）：`AgentRunView.failedSegmentIds[]` + 终态面板
  「重跑失败句（新任务单）」按钮，把失败集合作为 `segmentIds` 发起**新 run**，
  文案明示是新任务单。
- **4 步骤跳句段**（HAVE）：步骤行的句段 id 变成「定位」按钮接 `jumpToSegment`。
- **5 QA 收尾入口**（HAVE）：`awaitingReview` 且 `openQaIssues > 0` 时给
  「查看 QA 修复项」入口切到 QA dock（`qa.fix.list/apply` 既有接线）。
  Agent 永远不自动 apply 修复。
- **6 术语进 prompt**（NEAR）：agent worker 与 assist 的 prompt 注入当前句段的
  termbase 命中（`attached_term_entries` + `term_hits` 既有管道），preferred 译法
  要求采用、forbidden 译法要求规避。只注入库内命中，模型编不出术语。

**明确推迟：**

- **1d 重写既有草稿**（LATER）：违反「空译文才可 claim」安全谓词与 mid-run 保护，
  需要显式 `replaceDrafts` 语义，本轮不顺手做。
- **7 项目级默认指令持久化到引擎**（LATER）：需要 `Project.configuration` 动存储。
- `build_grounded_prompt` 全量接入（TM 例句 / corpus / 上下文分节）：本轮只接术语
  分节语义。**后续 `gf-tm-context` 轮已落地** TM 例句 + 邻句窗 + 同文档已确认句
  抽样的统一 grounding（assist/agent 同一条路），详见 `docs/research/tm-ai.md` §6；
  corpus 分节仍未接。
- NEVER-FAKE 全清单照旧：自动导出、假完成态、QE/置信度、云队列、多人审校。

## 5. 契约增量一览

新方法：`ai.profile.add` / `ai.profile.list` / `ai.profile.remove` / `ai.agent.review`。

改动类型：
- `AiStatusResult` + `profileCount`。
- `AiAssistParams` + `profileId?`；`AiAssistRunView` + `profileId`。
- `AgentStartParams` + `approvalMode?`（缺省 manual）、`segmentIds?`、`profileId?`。
- `AgentRunView` + `approvalMode` / `profileId` / `provider` / `model` /
  `eligibleSegments` / `processedSegments` / `skippedSegments` / `autoConfirmed` /
  `failedSegmentIds` / `proposals`。
- `AgentStepKind` + `proposal` / `confirm`。
- 新类型 `AgentApprovalMode`、`AgentProposal`、`AgentProposalStatus`、
  `AgentReviewDecision`、`AiProfileView` 及配套 params/results。

`ai.agent.review {runId, segmentIds[], decision: apply | reject}`：只对手动档的
pending 提案生效；apply 走草稿写入守卫 + 同事务句段 QA 刷新，活行被人动过就置
stale 并如实说明；reject 只改提案状态，不写任何句段。

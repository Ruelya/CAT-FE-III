# S3 提案：memoQ 式 QA 升级包（契约先行，部分已落地）

状态：**S3b 已落地 ⑤③②①**。已交付：`qa.unedited-fuzzy` 行为型检查（确认时
钩子 + `qa.run` 复现，warning，score 存 `params`）；`QaIssue.params` 参数化
文案（存储 V6，渲染端据此本地化长度/行为类规则）；`qa.waive` 三粒度
（issueId / ruleId+documentId / segmentId，结果统一 `{ issues }`）；
`qa.profile.get/update`（项目级 severity 重映射 + settings 覆写 +
`blockExportOnError`，baseRevision 乐观并发）；`document.export` 导出闸门
（缺省关闭，拒绝时 `exportBlocked` 带结构化 `data`，`overrideQaGate` 显式
放行，渲染端「仍要导出/取消」对话）。severity 重映射的引擎通道与 RPC 已
全部落地，但设置界面暂只暴露导出闸门开关（重映射 UI 需按规则枚举，留给
⑥ Resolve 面板一并设计）。**未落地：④ Correction 自动修复通道与
⑥ Resolve 式批处理面板**——按本文顺序为后续立项，届时 chrome 与引擎能力
同日出现（PRD §8.4 底线）。

以下为原提案全文，契约边界不变。

对应 PRD：`workbench-refactor.md` §7.1 S3 行的六项与 §8.4 条目 2。
验收蓝本：`memoq-and-peers.md` §6（warning/error 双级、严重度重映射、
三粒度忽略、Resolve 面板）；Phrase 附录 A（Instant QA 导出闸门、行为型检查）。

## 0. 现状盘点（写提案时的引擎事实）

- `tl-qa::QaProfileDefinition` 已有 `enabled_rule_ids`、`severity_overrides`、
  `settings`（长度阈值、CJK 开关）、`regex_rules` —— 重映射的数据结构已存在，
  缺的是**项目级配置通道**（现在只能吃内建 profile）。
- 引擎 `compiled_profile` 从项目配置读 profile id，缺省
  `default_profile_id(target_locale)`。
- `qa.waive` 是逐 issue 的；豁免只在同一指纹复现期间有效（已如实）。
- S3a 已落地：确认时段级 QA（`segment.confirm` 返回 `qaIssues`，同事务落库；
  跨句一致性规则留给下一次 `qa.run`）与锁定句段排除（锁定行不产出候选、
  其存量 issue 不被 resolve pass 触碰）。
- ruleId 表已稳定（`qa.number-mismatch` 等 + `qa.term-*:<id>` +
  `qa.regex:<id>` 参数化前缀）。

## 1. 六项契约提案

### ① 稳定 code 表 + 参数化文案

ruleId 即 code，已满足稳定性要求。补充项：`QaIssue` 增加可选
`params: BTreeMap<String, String>`（如 `{"expected":"30","found":"40"}`），
渲染端据此本地化文案，`message` 保留为引擎产出的英文回退。纯增量字段，
serde default，旧 issue 行照常解析。

### ② severity 重映射 + 导出闸门

- 新 RPC `qa.profile.get { projectId }` / `qa.profile.update { projectId,
  severityOverrides, settings, baseRevision }`。存进项目配置（memoQ 惯例：
  内建 profile 不可改，项目层是克隆再覆写）。
- `document.export` 增加闸门语义：profile 里
  `blockExportOnError: true` 时，导出前对该文档跑一次 `qa.run` 等价检查，
  存在 error 级 open issue 即回 `exportBlocked`，错误消息列出条数与前三个
  ruleId。显式 `overrideQaGate: true` 可放行（与覆盖写文件的 `overwrite`
  同一诚实模式：拒绝→用户显式决定→放行）。
- 缺省关闭：现有导出行为不变，闸门是配置出来的，不是默认剧场。

### ③ 忽略三粒度

`qa.waive` params 从 `{ issueId, waived }` 扩展为三选一：

```
{ issueId, waived }                    // 现状：逐条
{ ruleId, documentId, waived }         // 按规则（该文档全部匹配 issue）
{ segmentId, waived }                  // 按句段（该句段全部 issue）
```

结果统一为 `{ issues: QaIssue[] }`（受影响的全部行，客户端整体替换）。
落库仍是逐 issue 的 waive 记录 —— 粒度是**操作**语义，不是存储语义，
审计与指纹失效规则不变。

### ④ Correction 自动修复通道

- `tl-qa` 为可机械修复的规则（数字、半角标点、首尾空白、重复词）生成
  `QaFix { issueId, fixedTargetText, description }`；无法安全修复的规则
  不产出 fix，不猜。
- 新 RPC `qa.fix.list { documentId }`（预览）与
  `qa.fix.apply { issueId, baseRevision }`（应用）。apply 走与
  `segment.update` 完全相同的守卫：revision 冲突、锁定句段 conflict、
  已确认句段退回草稿。修复后同事务重跑该句段段级 QA（复用 S3a 通道）。

### ⑤ 行为型检查：未改动即确认的 fuzzy

新规则 `qa.unedited-fuzzy`（warning）：`state == confirmed` 且
`origin.kind == tmFuzzy` 且 `origin.edited == false`。依赖项已全部在库
（S2 origin + edited 位 + S3a 确认时钩子），是六项里最便宜的一项，
建议首先立项。

### ⑥ Resolve 式批处理面板

纯 UI，排在 ②③④ 之后：按 ruleId 分组排序、组头计数、顶部内嵌当前句段
编辑器（复用 `segment.update` 与网格同一草稿语义）。不新增引擎契约。

## 2. 顺序建议与共同验收

建议顺序：⑤ → ③ → ② → ④ → ⑥（① 随任意一项顺带）。

每项共同底线：`pnpm contracts:check` 通过；引擎测试覆盖新守卫与迁移；
渲染端不出现引擎未落地的按钮；文案零长篇说教。

## 3. 开放问题

1. 闸门作用域：`blockExportOnError` 按项目还是按文档？memoQ 是导出配置级；
   建议项目级起步，避免文档粒度配置矩阵。
2. `qa.fix.apply` 批量化（全文档一键修复）是否首版就做？建议不做——
   逐条应用 + 预览已覆盖 memoQ Correction 的主路径，批量留给使用数据裁决。
3. 按规则忽略是否跨文档（项目级）？Trados/memoQ 均有项目级先例，但我们的
   `qa.list` 是文档作用域；首版按文档，避免隐形全局豁免。

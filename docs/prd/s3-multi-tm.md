# S3 提案：多 TM 挂载（契约先行，未立项）

状态：**书面提案**。引擎 memory 模型先行，TM 选择器 UI 在能力落地前
一个像素都不出现（PRD §9：多 TM 文件树/TM 选择器现属 NEVER-FAKE）。

对应 PRD：`workbench-refactor.md` §8.4 条目 4。

## 0. 现状盘点（写提案时的引擎事实）

- 存储层**已经是多库形状**：`tm_entries.memory_id` 列、唯一索引
  `(memory_id, source_hash)`、按库分页索引、模糊召回索引 per-memory
  重建（`for_each_tm_index_seed` 按 memory_id 分桶）。
- 唯一的 1:1 绑定在派生函数 `project_memory_id(project_id)` —— 每个项目
  一个隐式库。改动面是这一个接缝，不是存储重写。
- 挂载模型有现成先例：术语库已实现
  `termbase.create/list/attach/detach` + `TermbaseMount { priority,
  enabled, writable }`。多 TM 抄同一族形状，不发明第二套语义。

## 1. 契约提案

### 实体与挂载

```
Memory { id, name, sourceLocale, targetLocale, revision, createdAtMs, updatedAtMs }
MemoryMount { projectId, memoryId, priority, enabled, writable, revision, ... }
```

新 RPC 族（与 termbase 族同形）：`memory.create` / `memory.list` /
`memory.attach` / `memory.detach` / `memory.update`。

### 读路径（穿透）

- `tm.lookup`、`tm.pretranslate`、检索：合并全部 `enabled` 挂载的匹配，
  分数第一、priority 决胜。`TmMatchItem.entry.memoryId` 字段今天已存在，
  结果可直接标注来源库，无契约破坏。
- `tm.list`/`tm.import`/`tm.export` 增加可选 `memoryId` 参数，缺省
  指向工作库（见下）。

### 写路径（唯一工作库）

`segment.confirm` 的 TM 写入只进**恰好一个** `writable` 挂载（工作库）。
引擎在 attach/update 时强制该不变量：把第二个库设为 writable 会回
conflict，先降级旧工作库。memoQ 的 primary TM 语义同款，避免
"确认写进了哪个库"永远说不清。

### 迁移

`SCHEMA_Vn`：为每个既有项目把隐式库物化为真实 `Memory` 行 +
一条 `writable, priority 0` 挂载；`project_memory_id` 派生保留为迁移期
兼容读路径，一个版本后删除。旧库打开零丢失、零重导。

## 2. UI（引擎落地之后才动工）

- TM 管理对话框从单库表格升级为挂载列表（复用术语库挂载 UI 的交互）。
- 记忆 dock 匹配卡标注来源库名（数据今天已在 `memoryId`）。
- 不做 TM 文件树、不做 `.sdltm` 节点、不做每句段库选择器。

## 3. 开放问题

1. 库的语言对是否强约束（attach 时校验 locale 匹配项目）？termbase 只软
   校验 sourceLocale；建议 TM 同样软校验 + 挂载时警告，不硬拒绝。
2. 穿透查询的性能：多库模糊召回是 per-memory 索引的并行点查，预期线性；
   立项时对 10 万条 × 3 库跑一次基准再定是否需要合并索引。

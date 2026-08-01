# Findings round 2

## meta
- task: `.trellis/tasks/07-19-collaboration-server`
- branch: `task/07-19-collaboration-server`
- head_sha: `512be0738f2723493ef332ddd2f50dc5a7521c75`
- round: 2
- resumed_after: `.trellis/tasks/07-19-collaboration-server/review/verify-1.md`

## need_verify
- required: false
- evidence: `verify-1.md` 已完整回答 Q1–Q4，`mission_status: satisfied`，且 `unanswered` 中没有本轮 mission 未答问题。

## issues
### F1
- severity: major
- files: `crates/protocol/src/collab.rs:153-159`, `crates/engine/src/collab.rs:139-147`, `crates/storage/src/store/collab.rs:472-507`, `packages/contracts/src/protocol.generated.ts:2989-2993`, `packages/contracts/src/protocol.schema.json:5488-5503`
- problem: round 1 发现 `collab.assignment.complete` 可通过省略 `expectedRevision` 绕过 revision safety；当前 wire/store/contracts 已统一改为必填 `u64`，不再存在该绕过。
- minimal_fix: 已完成。协议反序列化拒绝缺失/null revision，storage 无条件比较 revision；独立黑盒证明 missing/stale 请求均无 assignment 或 op-log 副作用，正确 revision 恰好递增并追加一次完成 op。
- status: fixed

### F2
- severity: major
- files: `crates/storage/src/store/collab.rs:150-350`, `crates/storage/src/store/collab.rs:423-507`, `crates/storage/src/store/collab.rs:644-672`
- problem: round 1 发现实体 mutation 与 op-log 分离 autocommit、sequence 分配未受写事务保护，且 lock heartbeat 未记 op；当前相关 membership/lock/assignment mutation 已在 Immediate transaction 内完成实体写入、sequence 分配与 op 插入，heartbeat 追加 `lock.heartbeat`。
- minimal_fix: 已完成。验证中的 rollback fault test 证明 op 插入失败时成员、锁、assignment 与 op 均不残留；round-trip test 证明 heartbeat kind、连续 sequence 和重启持久性。
- status: fixed

### F3
- severity: minor
- files: `crates/storage/src/store/collab.rs:710-`, `scripts/engine-smoke.mjs:1861-2009`, `.trellis/tasks/07-19-collaboration-server/review/verify-1.md:24-152`
- problem: round 1 缺少独立 gates 与真实 wall-clock TTL 证据；verify-1 已在当前工作树新构建的 Engine 上完成 scoped test/clippy/smoke，并用 1000ms TTL 黑盒探针证明 presence 过期省略、锁有效期内阻塞 B 且过期后允许 B 获取。
- minimal_fix: 无需产品改动；所需独立证据已经满足 mission success criteria。
- status: fixed

## residual_risks
- V4（accepted nit）：focused collab smoke 本身仍只覆盖 stale assignment revision 和 presence 立即可见，没有把“缺失 `expectedRevision`”及真实 TTL sleep 纳入长期 smoke。`verify-1` 的独立探针已证明当前产品行为正确，因此这是 CI 回归覆盖增强项，不阻塞 AC-01..AC-06，也不要求本任务继续修改产品代码。
- 若未来希望强化长期守门，可将 `.trellis/tasks/07-19-collaboration-server/review/_probe-ttl-revision.mjs` 中的关键断言选择性并入 `TRANSLUNAR_SMOKE_SCOPE=collab`；避免扩大到全 workspace 或 Desktop E2E。

## assumptions
- 已读取完整 `verify-1.md`，包括 mission answers、A1–A6、V1–V4、unanswered 与 overall；没有仅依据 `mission_status` 作判断。
- 验证对象是 branch HEAD 加当前未提交工作树；verify 确认使用的新构建 binary 晚于相关源码。
- A1 storage collab tests 3/3、A2 engine build、A3 storage+engine strict clippy、A4 focused collab smoke、A5 TTL/revision 黑盒均通过。
- 非本轮 AC 的多连接压力、多节点同步、完整 RBAC/UI/cancel 流程继续按 round 1 范围假设排除；没有把它们静默当作已验证能力。
- `git diff --check` 通过；contracts 文件仅出现 Git 的 LF→CRLF 工作树提示，不是补丁错误或 verify failure。

## summary_for_orchestrator
- verdict: green
- ready_for_closeout: yes
- F1–F3 均由当前代码与 `verify-1.md` 的 satisfied mission 关闭；没有 open blocker、major、minor 或 needs_evidence。唯一残余是已接受的 V4 nit（focused smoke 未长期内建 missing-revision/真实 TTL 两个断言），当前产品行为已有独立黑盒证据，不阻塞 closeout。Orchestrator 可进入 closeout/commit/archive；本轮 review 未改产品代码、未提交。

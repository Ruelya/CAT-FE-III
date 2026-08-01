# Findings round 1

## meta
- task: `.trellis/tasks/07-19-collaboration-server`
- branch: `task/07-19-collaboration-server`
- head_sha: `512be0738f2723493ef332ddd2f50dc5a7521c75`
- round: 1

## need_verify
- required: true

### Verify mission (required if need_verify)
- purpose: 独立确认当前未提交工作树上的 owned-surface gates 与真实 Engine 进程行为；静态审查和实现者自检不能单独满足 AC-03/AC-06，也需要用黑盒行为确认 F1 的 revision 绕过。
- questions:
  - Q1: 从当前源码重新构建后，storage 的 collab 测试、storage+engine 严格 clippy、focused collab smoke 是否都在独立运行中通过？
  - Q2: 同一 data dir 重启 Engine 后成员是否仍存在，锁冲突 RPC 是否稳定返回 `conflict`、`entity=segment_lock` 和当前 `holderActorId`？
  - Q3: 使用真实 wall clock 时，presence 是否在 TTL 内可见并在 TTL 后省略；B 是否只在 A 的锁释放或过期后才能获得同一 segment 锁？
  - Q4: assignment 完成是否必须携带 `expectedRevision`；stale 或缺失 revision 的请求是否在不改变 assignment、revision 和 op-log 的前提下被拒绝？
- success_criteria:
  - `translunar-storage` 的 collab 测试全部通过，且 storage/engine 严格 clippy 无 warning/error。
  - focused collab smoke 使用本工作树新构建的 Engine 通过；重启后的成员、typed lock holder、assignment stale conflict 和代表性 op-log kind 均被观察到。
  - `ttlMs=1000` 的 presence 立即可见并在等待超过 TTL 后不再列出；同 TTL 的锁在有效期内阻止 B、过期后允许 B 获取。
  - assignment create/list/complete 只在准确 revision 下完成并恰好递增一次；stale revision 和缺失 revision 都不能产生状态或 op-log 变化。
- failure_signals:
  - 任一 scoped build/test/clippy/smoke 失败，或 smoke 使用了旧 binary。
  - 重启丢失成员，锁冲突缺少 holder，presence/lock 超过 TTL 后仍有效，或到期前 B 可获取。
  - 缺失/stale `expectedRevision` 的完成请求成功，revision 改变，或追加 `assignment.complete` op。
  - 日志出现与 collab 改动直接相关的 panic、SQLite constraint/race、协议反序列化或 warning-as-error。
- suggested_commands:
  - `cargo test -p translunar-storage collab -- --nocapture`
  - `cargo clippy -p translunar-storage -p translunar-engine --all-targets -- -D warnings`
  - `cargo build -p translunar-engine && TRANSLUNAR_SMOKE_SCOPE=collab node scripts/engine-smoke.mjs`
  - 使用临时 data dir 和当前 `target/debug/translunar-engine` 做最小 JSON-RPC 探针：presence/lock `ttlMs=1000`，以及省略 `expectedRevision` 的 assignment complete；前后读取 assignment/op-log 以判断是否发生副作用。
- scope: `crates/storage`, `crates/engine`, `crates/protocol` 的 collab surface，以及 `scripts/engine-smoke.mjs` 的 `TRANSLUNAR_SMOKE_SCOPE=collab` 路径。
- avoid: 不运行全 workspace、Electron/Desktop E2E、插件任务或非 collab smoke；不改产品代码，不把自检输出当作独立证据。
- related_issues: F1, F3

## issues
### F1
- severity: major
- files: `crates/protocol/src/collab.rs:153-160`, `crates/engine/src/collab.rs:139-147`, `crates/storage/src/store/collab.rs:438-452`
- problem: `collab.assignment.complete` 将 `expectedRevision` 定义为带 `serde(default)` 的 `Option<u64>`，storage 只在值为 `Some` 时检查 revision。因此客户端省略该字段即可无条件完成 assignment，绕过 AC-04 要求的 revision safety；现有 stale 测试和 smoke 只覆盖“字段存在但过期”，没有覆盖缺失字段。
- minimal_fix: 将 wire 和 store 参数改为必填 `u64`，无条件比较当前 revision；同步生成的协议产物，并增加 RPC/存储测试，证明缺失字段被拒绝且 stale/缺失请求均不改变 assignment revision/status、也不追加 op-log。
- status: open

### F2
- severity: major
- files: `crates/storage/src/store/collab.rs:150-207`, `crates/storage/src/store/collab.rs:210-321`, `crates/storage/src/store/collab.rs:394-467`, `crates/storage/src/store/collab.rs:572-598`
- problem: membership、lock、assignment 的实体写入和 `append_collab_op` 是分离的 autocommit 语句；进程在两者之间退出或 op 插入失败时，RPC 虽可失败但实体变更已经持久化，AC-05 的同步基础会出现无法由 op-log 重放的状态。`append_collab_op` 本身也以未加事务保护的 `MAX(sequence)+1` 生成序号，存在并发唯一键竞争。此外 `heartbeat_segment_lock` 会修改 lease/revision，却完全不追加任何 lock mutation op。
- minimal_fix: 对每个需记录的 membership/lock/assignment mutation 使用一个 immediate transaction，把实体变更、项目内 sequence 分配和 op 插入后一起 commit；为 lock heartbeat 明确定义并追加 `lock.heartbeat`（含新的 expiry/revision）。增加 rollback/fault 测试和连续分页/sequence 测试，证明失败 mutation 不留下实体或孤立 op，成功 mutation 恰有一个 op。
- status: open

### F3
- severity: minor
- files: `crates/storage/src/store/collab.rs:640-817`, `scripts/engine-smoke.mjs:1861-2009`
- problem: AC-06 当前只有实现者自检声明；新增 storage 测试通过直接把 expiry 改成过去来覆盖过滤逻辑，focused smoke 只证明 presence 立即出现，没有独立运行或真实 wall-clock expiry 证据。静态实现看起来会按时间过滤，但 AC-03/AC-06 的最终判断仍需独立进程证据。
- minimal_fix: 执行上面的 Verify mission；若独立 gates 和 TTL 探针满足 success criteria，则将本项标记 fixed，无需改产品代码；否则按 verify 报告中的具体 V* 结果修复最小范围。
- status: needs_evidence

## assumptions
- 按用户要求，本轮重点限定为 AC-01..AC-06；PRD 的多节点同步、企业 RBAC、UI、完整 cancel 流程等非 AC 扩展不作为本轮新增阻塞项。
- `check.jsonl` 除 seed 外只引用 `prd.md` 与 `.trellis/spec/backend/engine-boundary.md`，没有需读取的 research 文件；任务此前也没有 `findings-*.md` 或 `verify-*.md`。
- 当前改动尚未提交；审查基于 branch `task/07-19-collaboration-server` 的 HEAD 加工作树差异。`git diff --check` 已通过。
- 静态正向证据包括：成员使用 migration 17 的持久表且 smoke 重启后复查；`LockHeld` 携带 holder/expiry 并映射为 typed RPC conflict；presence/list 按当前时间过滤；提供 revision 时 stale assignment 会冲突；协议方法与 `collab.local.v1` capability 已注册。

## summary_for_orchestrator
- 当前实现对 AC-01、typed lock conflict、presence 过滤和 focused smoke 增加了有效覆盖，但不能 green：F1 允许省略 assignment revision，直接破坏 AC-04；F2 让 durable mutation 与 op-log 脱离事务且遗漏 lock heartbeat，破坏 AC-05 的可靠同步基础。先派发本文件的独立 Verify mission（尤其确认 F1 黑盒行为与真实 TTL），读取完整 verify 报告后再做最小修复；无需 re-plan。

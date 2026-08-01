# Verify report round 1

## mission_echo
- purpose: 独立确认当前未提交工作树上的 owned-surface gates 与真实 Engine 进程行为；用黑盒行为确认 F1 revision 绕过是否仍存在，并为 AC-03/AC-06 提供独立证据（Orchestrator 说明 F1/F2 已修：必填 revision + transactional op-log + lock.heartbeat）。
- questions_addressed:
  - Q1: **是，全部通过。** 从当前工作树源码侧，`cargo test -p translunar-storage collab` 3/3 通过；`cargo clippy -p translunar-storage -p translunar-engine --all-targets -- -D warnings` 无 warning/error；`cargo build -p translunar-engine` 成功；`TRANSLUNAR_SMOKE_SCOPE=collab node scripts/engine-smoke.mjs` 通过（Focused collaboration smoke passed）。binary `target/debug/translunar-engine.exe` mtime 晚于 collab 相关源文件。
  - Q2: **是。** focused collab smoke 在同一 data dir 上 `restart()` 后 `collab.member.list` 仍含 alice/bob；B 抢锁返回 `conflict`，`data.entity=segment_lock`，`data.holderActorId=alice`。独立探针再次复现了相同 lock conflict 形状。
  - Q3: **是（真实 wall-clock）。** 独立 JSON-RPC 探针 `ttlMs=1000`：presence 立即可见，sleep 1300ms 后省略；alice 持锁期间 bob 冲突，过期后 bob 成功 acquire。
  - Q4: **是，必须携带 `expectedRevision`。** wire 类型为必填 `u64`（无 `Option`/`serde(default)`）。省略字段 → `invalid_request`（`missing field expectedRevision`），assignment 仍为 open/rev 0，op-log total 不变；stale revision → `conflict` 且无状态/op 副作用；正确 revision 恰好完成一次（status=completed, rev+1，追加 1 条 `assignment.complete`）。

## environment
- cwd: `K:\Workbench\CAT`
- branch: `task/07-19-collaboration-server`
- head_sha (committed): `512be07`；审查/验证对象含 **未提交工作树** collab 改动（`crates/{protocol,storage,engine}`、contracts、smoke 等）
- toolchain: rustc 1.97.1 / cargo 1.97.1 / node v24.17.0
- OS: Windows
- binary: `K:\Workbench\CAT\target\debug\translunar-engine.exe`（mtime 2026-08-02 02:31:30 +0800；protocol collab.rs 02:29、storage collab.rs 02:30）
- deviations:
  - 额外执行了 mission 建议的 strict clippy（用户 dispatch 列表未写 clippy，但 success_criteria 要求）。
  - 真实 TTL / 缺失 revision 黑盒未改产品代码，使用临时探针脚本：`review/_probe-ttl-revision.mjs`（验证产物，非产品路径）。
  - 未跑全 workspace test / Electron E2E（符合 avoid）。

## actions
### A1
- command: `cargo test -p translunar-storage collab -- --nocapture`
- exit_code: 0
- duration_note: ~0.3s test runtime after prior compile
- log_excerpt: |
    running 3 tests
    test store::collab::tests::collab_mutation_rolls_back_when_op_log_insert_fails ... ok
    test store::collab::tests::expired_locks_and_presence_are_omitted ... ok
    test store::collab::tests::members_locks_presence_assignments_and_ops_round_trip ... ok
    test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 114 filtered out
- interpretation: storage collab surface 覆盖成员/锁/presence/assignment/op-log round-trip、stale complete 不写 op、`lock.heartbeat` kind 存在、op 序号连续、重启后成员与 ops 仍在、以及 op-log insert 失败时成员/锁/assignment 实体回滚。支持 F2 事务与 F1 stale 路径。

### A2
- command: `cargo build -p translunar-engine`
- exit_code: 0
- log_excerpt: |
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.75s
- interpretation: engine 包可构建；后续 smoke/探针使用该 debug binary。

### A3
- command: `cargo clippy -p translunar-storage -p translunar-engine --all-targets -- -D warnings`
- exit_code: 0
- duration_note: ~9.5s
- log_excerpt: |
    Checking translunar-storage v0.1.0
    Checking translunar-protocol v0.1.0
    Checking translunar-engine v0.1.0
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 9.48s
- interpretation: storage/engine 严格 clippy 干净，满足 Q1 success_criteria 中的 clippy 项。

### A4
- command: `TRANSLUNAR_SMOKE_SCOPE=collab node scripts/engine-smoke.mjs`
- exit_code: 0
- log_excerpt: |
    Focused collaboration smoke passed.
- interpretation: 真实 Engine 进程路径验证 AC-01 重启后成员仍在、AC-02 typed lock conflict（holder/entity）、presence 立即可见、assignment create/list/complete + stale complete conflict、代表性 op-log kinds（member.upsert / lock.acquire / assignment.complete）。**未**覆盖缺失 `expectedRevision` 与真实 wall-clock TTL（由 A5 补齐）。

### A5
- command: `node .trellis/tasks/07-19-collaboration-server/review/_probe-ttl-revision.mjs`
- exit_code: 0
- duration_note: 含两次 ≥1.3s sleep（presence + lock TTL）
- log_excerpt: |
    {
      "ok": true,
      "binary": "K:\\Workbench\\CAT\\target\\debug\\translunar-engine.exe",
      "results": {
        "presence_immediate_visible": true,
        "presence_after_ttl_omitted": true,
        "bob_blocked_while_alice_holds": true,
        "lock_conflict": {"code":"conflict","entity":"segment_lock","holderActorId":"alice"},
        "bob_acquires_after_ttl": true,
        "missing_revision_rejected": true,
        "missing_revision_error": {"code":"invalid_request","message":"collab.assignment.complete: missing field `expectedRevision`"},
        "missing_no_state_change": true,
        "missing_no_oplog_change": true,
        "stale_revision_rejected": true,
        "stale_no_state_change": true,
        "stale_no_oplog_change": true,
        "complete_ok_status": "completed",
        "complete_ok_revision": 1,
        "complete_incremented": true,
        "complete_appended_once": true,
        "second_stale_rejected": true,
        "final_stable": true
      }
    }
- interpretation: 独立黑盒证明 (1) 真实 TTL 下 presence/lock 过期行为；(2) 省略 `expectedRevision` 在 RPC 层被拒绝且无副作用；(3) stale/正确/二次 stale 的 revision safety 与 op-log 计数一致。直接关闭 findings 中 F1 黑盒与 F3 真实 TTL 证据缺口。

### A6 (static / code evidence)
- command: read/grep on protocol, storage, contracts
- exit_code: n/a
- log_excerpt: |
    // crates/protocol/src/collab.rs
    pub struct CollabAssignmentCompleteParams {
        pub assignment_id: String,
        pub expected_revision: u64,   // required, not Option, no serde(default)
        ...
    }
    // crates/storage/src/store/collab.rs
    complete_assignment(..., expected_revision: u64, ...)
      if current.revision != expected_revision { EntityConflict { ... } }
    mutations use transaction_with_behavior(Immediate); append_collab_op inside tx;
    heartbeat_segment_lock appends kind "lock.heartbeat"
    // packages/contracts protocol.schema.json CollabAssignmentCompleteParams
    "required": ["assignmentId", "expectedRevision"]
    // protocol.generated.ts
    expectedRevision: number;  // on CollabAssignmentCompleteParams
- interpretation: F1 修复在 wire/store/contracts 三层一致；F2 事务边界与 heartbeat op 在代码与 unit test 中可观察。

## findings_for_reviewer
### V1
- severity: info
- related_review_ids: F1
- title: F1 已修复并经黑盒确认 — assignment.complete 强制 expectedRevision
- evidence: `crates/protocol/src/collab.rs` `CollabAssignmentCompleteParams.expected_revision: u64`；探针 missing field → `invalid_request`；stale → `conflict`；状态/op-log 无副作用；正确 rev 仅递增一次
- detail: 原 findings 描述的 `Option` + `serde(default)` 绕过路径在当前工作树不存在。RPC 省略字段在反序列化阶段失败，不会进入 storage complete 路径。建议 review 将 F1 标为 fixed。
- suggested_next: review mark F1 fixed; optional smoke 增补「省略 expectedRevision」回归（非阻塞）

### V2
- severity: info
- related_review_ids: F2
- title: F2 已修复 — Immediate 事务绑定实体+op，heartbeat 写 lock.heartbeat，失败回滚有测
- evidence: `collab.rs` member/lock/assignment mutations 均 `transaction_with_behavior(Immediate)` + `append_collab_op` + commit；`heartbeat_segment_lock` kind `lock.heartbeat`；test `collab_mutation_rolls_back_when_op_log_insert_fails` ok；round-trip 断言 `lock.heartbeat` 与连续 sequence
- detail: 实体写入与 op 插入不再是分离 autocommit。op sequence 仍为事务内 `MAX(sequence)+1`，但 Immediate 事务提供写串行化；unit test 证明 op insert abort 不留实体/孤立 op。建议 review 将 F2 标为 fixed。
- suggested_next: review mark F2 fixed; residual concurrency stress out_of_scope for this AC round unless multi-connection writers appear

### V3
- severity: info
- related_review_ids: F3
- title: F3 所需独立证据已齐 — 真实 wall-clock TTL + owned gates 均绿
- evidence: A1–A5；探针 `ttlMs=1000` presence/lock 过期；smoke 重启成员与 typed lock conflict
- detail: unit test 仍用 SQL 改写 `expires_at_ms` 做过滤逻辑单测（可接受），但 mission 要求的真实 wall-clock 进程证据已由 A5 提供。AC-03/AC-06 不再仅依赖实现者自检。
- suggested_next: review mark F3 fixed given verify evidence; optional 将短 TTL 探针并入 focused smoke（覆盖增强，非 blocker）

### V4
- severity: nit
- related_review_ids: new
- title: focused collab smoke 仍未覆盖「缺失 expectedRevision」与真实 TTL sleep
- evidence: `scripts/engine-smoke.mjs` `exerciseFocusedCollabSmoke` 仅 stale complete + 默认 presence heartbeat；无 omit field / sleep 过期路径
- detail: 产品行为已由独立探针证明正确；这是测试覆盖缺口而非功能回归。若希望 CI 长期守门，可将 A5 关键断言并入 smoke collab scope。
- suggested_next: optional follow-up test hardening; out_of_scope for green quality if review accepts verify probe as AC-06 evidence

## unanswered
- 无 mission 问题未答。
- 未验证：多连接并发下 op sequence 唯一键压力、多节点同步、RBAC/UI/cancel 全流程（按 findings assumptions 非本轮 AC）。
- 未重新执行 review 静态逐行 diff 审查（verify 职责是运行与行为证据）。

## overall
- mission_status: satisfied
- summary_for_reviewer: 独立 verify 在当前未提交工作树上确认 owned gates 全绿（storage collab tests、storage+engine strict clippy、engine build、collab smoke）。F1 的 revision 绕过已不存在：wire/store 必填 `expectedRevision`，RPC 省略字段返回 `invalid_request` 且无 assignment/op-log 副作用；stale 与正确路径行为符合 AC-04。F2 的 durable mutation 与 op-log 现处于 Immediate 事务内，heartbeat 追加 `lock.heartbeat`，失败回滚单测通过。F3/AC-06 获得真实 wall-clock TTL 进程证据（presence 与 lock 均 1s TTL）。建议 review 将 F1/F2/F3 标 fixed 并结束本轮 quality，除非要对 smoke 覆盖做 optional 补强（V4 nit）。
- recommended_review_focus:
  1. 对照本报告 V1–V3 更新 findings 状态（F1/F2 open → fixed，F3 needs_evidence → fixed）。
  2. 快速抽查 `complete_assignment` / `heartbeat_segment_lock` / `append_collab_op` 事务边界是否还有遗漏 mutation。
  3. 决定是否采纳 V4（smoke 增补）作为 follow-up，而非本轮 blocker。

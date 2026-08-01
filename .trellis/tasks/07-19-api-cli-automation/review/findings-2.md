# Findings round 2

## meta
- task: `.trellis/tasks/07-19-api-cli-automation`
- branch: `task/07-19-api-cli-automation`
- head_sha: `6d380294606fa4c296f4914106283817b02c1e0b`
- round: 2
- worktree: uncommitted
- evidence: `.trellis/tasks/07-19-api-cli-automation/review/verify-1.md`

## need_verify
- required: false
- note: 当前证据已足以关闭上一轮的验证性问题；下一次验证应在 F5/F6 修复后进行，不在本轮重复派发 Verify mission。

## issues

### F1
- severity: major
- files: `crates/engine/src/local_api.rs`
- problem: HTTP API 的客户端输入错误和 Engine/协议错误分类曾被映射为 500/`internal_error`，不满足稳定错误码契约。
- minimal_fix: 已将路由 DTO 解码和相关 Engine 错误映射调整为稳定的 HTTP 状态/错误码，并增加 malformed DTO、坏导入、缺失导出等覆盖。
- status: fixed
- evidence: Verify A1 / V3；`cargo test -p translunar-engine --lib local_` 通过，测试 `http_error_taxonomy_client_failures_are_not_internal_error` 通过。

### F2
- severity: minor
- files: `crates/engine/src/local_auth.rs`
- problem: 原实现使用 UUIDv7 拼接生成令牌，并仅按字符数校验，未满足设计中 32 字节随机令牌契约。
- minimal_fix: 已改为 CSPRNG 生成并使用 base64url 表示，生成令牌解码后为 32 字节；相关格式/随机生成测试已加入并通过。
- status: fixed
- evidence: Verify A1 / A8 / V5；ensure/rotate 生成 43 字符、解码 32 字节且彼此不同的令牌。
- follow_up: F5 是该校验收紧后暴露的 smoke 测试令牌集成问题，不重新打开本问题的生成实现判断。

### F3
- severity: minor
- files: `crates/engine/src/local_auth.rs`
- problem: 原实现只要环境变量存在就启用测试内存后端，`0`/`false` 等值也会误触发测试模式。
- minimal_fix: 已改为仅 `TRANSLUNAR_API_TEST_MODE=1` 启用，并覆盖 unset、`0`、`false`、`true`、`yes` 等值。
- status: fixed
- evidence: Verify A1 / A8 / V4；精确值测试通过，运行时 `=1` 后端行为正常。

### F4
- severity: major
- files: `crates/engine/src/local_auth.rs`, `crates/engine/src/local_api.rs`, `crates/engine/src/bin/translunar.rs`
- problem: 上一轮缺少 AC-03/AC-04 持久性、令牌不落 SQLite、stdio 兼容性和质量门禁的独立证据。
- minimal_fix: 已由 Verify A1、A2、A4、A5、A8、A9 补齐：CLI 运行结果在新进程中可见，ensure/rotate 两个令牌均不在 SQLite，stdio initialize + project.list 成功，build/clippy/unit gates 通过。
- status: fixed
- evidence: Verify-1 mission status 为 `partial` 的唯一原因是 F5 smoke 配置失败；AC-01～AC-04 和 stdio 最小探针均已独立验证。
- follow_up: smoke 自动化缺口已从本问题拆出为 F6，不再阻塞本问题的证据判断。

### F5
- severity: major
- files: `scripts/engine-smoke.mjs:2050-2095`, `crates/engine/src/local_auth.rs:default_token_store`
- problem: V1：F2 收紧令牌校验后，smoke 固定的 `TRANSLUNAR_API_TEST_TOKEN=test-local-api-token-value-32b` 不再是可解码至少 32 字节的 base64url 令牌。`default_token_store` 还忽略了 `store.set` 的错误，于是错误配置被静默吞掉并生成随机令牌，随后 smoke 的固定令牌相等断言失败，`TRANSLUNAR_SMOKE_SCOPE=api` 以退出码 1 结束。该 smoke 是 AC-05 的要求门禁，因此当前不能 closeout。
- minimal_fix: 将 smoke 和相关文档中的固定测试令牌改为可解码 32 字节的 base64url 值，并让测试令牌注入失败显式报告（不要使用 `let _ = store.set(...)` 静默回退到随机令牌）。补充一个无效 `TRANSLUNAR_API_TEST_TOKEN` 的失败/诊断测试，再完整重跑 API smoke。
- status: open
- related_verify: V1；Verify A3、A8。

### F6
- severity: minor
- files: `scripts/engine-smoke.mjs:2029-2226`
- problem: V2：API smoke 只检查 CLI `run` 返回 project ID 和导出文件，没有在 CLI 进程退出后启动第二个进程并断言同一 project/document ID。Verify 已用独立命令证明 AC-03 持久化正确，但自动回归保护仍不完整。
- minimal_fix: 在 smoke 的 CLI run 后用新进程执行 `project list`，断言返回 `summary.projectId`；再通过新 serve/API 或 stdio 查询 `/v1/projects/{projectId}/documents`，断言 `summary.documentId`，继续使用 disposable data-dir。
- status: open
- related_verify: V2；Verify A5。

## assumptions
- Verify-1 是本轮验证的完整报告；其 `mission_status: partial` 仅由 F5 的 smoke 固定令牌契约失败导致，并不推翻 A1/A2/A5/A6/A7/A8/A9 的具体成功证据。
- F1–F3 的修复已经存在于当前未提交工作树；本轮仅更新审查状态，不修改产品或 smoke 代码。
- `--allow-remote` 的显式 unsafe opt-in、仅 health 免认证、直接 EngineService 调用，以及 X-03～X-07 out-of-scope 判断保持不变。

## residual_risks
- OS keyring 非测试后端未在本机验证；Verify 使用了文档规定的 memory backend，实际宿主 keyring 可用性仍是环境相关风险。
- 完整 API surface 中的 filters、TM、termbase 端点未做穷举运行验证，但不影响 AC-02 的最低 project/import/list/QA/export 流程结论。
- 当前 API smoke 的跨进程持久化断言仍缺失，已由 F6 明确跟踪；独立 Verify 已证明当前 Engine/SQLite 行为正确。
- X-03 folder watch、X-04 clipboard/global shortcut、X-05 webhooks、X-06 editor/browser plugins、X-07 third-party connectors 仍是明确 out of scope，不作为本轮缺陷。

## summary_for_orchestrator
- verdict: need_fix
- open_blockers: 0
- open_majors: 1 (`F5`)
- open_minors: 1 (`F6`)
- needs_evidence: 0
- ready_for_closeout: false
- dispatch_fix: yes
- summary: Verify 已确认 AC-01～AC-04、CLI 跨进程持久化、令牌不落 SQLite、stdio 最小路径及 F1–F3 修复均正常。当前唯一阻塞性产品/门禁问题是 F5：收紧后的 32-byte base64url 测试令牌与 smoke 固定值不兼容，且无效注入错误被静默吞掉，导致 API smoke 失败。建议立即派发 fix 处理 F5，并一并补齐 F6 的跨进程 smoke 断言；修复后重新运行 `TRANSLUNAR_SMOKE_SCOPE=api`，再进行下一轮 review/verify。

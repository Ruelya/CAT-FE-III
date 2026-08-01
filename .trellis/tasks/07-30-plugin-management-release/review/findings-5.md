# Findings round 5

## meta
- task: .trellis/tasks/07-30-plugin-management-release
- branch: task/07-28-plugin-management-release
- head_sha: 5ee23e940dbd38ce9970d88da395d86b90a4060d
- worktree: includes uncommitted implement/fix/review WIP and fresh desktop E2E artifacts
- round: 5
- after_fix_worker: 019fbc9e
- reviewed_context: `review/findings-4.md`; focused diffs for `crates/engine/src/plugin.rs`, `crates/engine/src/plugin_bundled.rs`, and `apps/desktop/tests/e2e/workbench.spec.ts`

## need_verify
- required: false
- reason: F7/F8 的代码与测试修复均已定点核对，focused Engine unit test 已通过，且修复后的 release-bundled + local `.tlplugin` 真实 Electron 用例在 fresh build 上 1/1 通过。没有剩余 blocker/major 或必须完成的新验证任务；未重跑完整七用例矩阵作为非阻塞 residual risk 记录。

## issues

### F1
- severity: major
- files: `crates/plugin-runtime/src/package_archive.rs`; `crates/engine/src/plugin.rs`; `crates/engine/src/plugin_bundled.rs`; `crates/storage/src/migrations.rs`; `scripts/package-plugins.mjs`; `apps/desktop/src/renderer/PluginsPanel.tsx`
- problem: 早期广泛证据缺口已由后续 focused tests、Engine smoke、可重复打包和 fresh Electron 验证关闭。
- minimal_fix: none
- status: fixed

### F2
- severity: major
- files: `scripts/engine-smoke.mjs:2207-2265`; `scripts/engine-smoke.mjs:2820-2952`
- problem: plugin smoke 契约及 archive/bundled/degraded 生命周期覆盖已修复并通过。
- minimal_fix: none
- status: fixed

### F3
- severity: major
- files: `apps/desktop/tests/e2e/workbench.spec.ts:427-454`; related plugin E2E call sites
- problem: Inspect confirmation、精确 Plugins heading 和 permission flow 已在 verify-2 的 fresh-build 六个通过用例中证明修复。
- minimal_fix: none
- status: fixed

### F4
- severity: major
- files: `scripts/engine-smoke.mjs:2820-2952`; `apps/desktop/tests/e2e/workbench.spec.ts:1316-1474`
- problem: Engine archive/bundled smoke、Electron bundled Path A 及本轮修复后的 local `.tlplugin` Path B 均已有通过证据，原端到端缺口关闭。
- minimal_fix: none
- status: fixed

### F5
- severity: minor
- files: `crates/plugin-runtime/src/package_archive.rs:1093-1385`
- problem: archive 恶意边界负向测试已修复并通过。
- minimal_fix: none
- status: fixed

### F6
- severity: minor
- files: `crates/engine/src/plugin_bundled.rs:721-1030`
- problem: provenance spoof 和无效 release metadata/license 回归测试已修复并通过。
- minimal_fix: none
- status: fixed

### F7
- severity: major
- files: `apps/desktop/tests/e2e/workbench.spec.ts:1322-1336`; `apps/desktop/tests/e2e/workbench.spec.ts:1441-1473`
- problem: 已修复。Path B 现在把 catalog archive 复制到 `mkdtempSync` 创建的 bundled root 外临时目录，再将该副本传给 picker fixture；inspection 和 installed row 均断言 `local archive`，同时断言 UI 不含归档绝对路径或临时目录，并完成 uninstall 与 `consoleErrors === []`。fix evidence 记录 fresh build 后 Playwright `installs release-bundled and .tlplugin` 聚焦用例 1/1 通过，覆盖同一用例中的 bundled Path A 与 local archive Path B。
- minimal_fix: none
- status: fixed

### F8
- severity: minor
- files: `crates/engine/src/plugin.rs:368-404`; `crates/engine/src/plugin_bundled.rs:842-909`
- problem: 已修复。`inspect_plugin` 在构造 inspection 前对 materialized source 调用与 install/upgrade 相同的 `classify_source_kind`，仍在返回前清理 staging；新增 unit test 证明 verified catalog archive inspect 为 `Bundled`、同 bytes 在 root 外为 `LocalArchive`、bundled root 内未列入 index 的 archive 不会升格。fix evidence 记录该 unit test 通过，修复后的 Path B Electron 用例也证明 root 外 inspect/install 标签一致。
- minimal_fix: none
- status: fixed

## assumptions
- fix worker 提供的 unit test pass、fresh desktop build 及聚焦 Playwright 用例 1/1 pass 视为本轮输入证据；reviewer 未重复执行命令，仅定点核对对应 diff 和 `git diff --check`。
- 聚焦 Electron 用例顺序仍先完整执行 bundled Path A，再执行 local archive Path B；因此 1/1 通过同时证明 Path A 未被 F7/F8 修复回退。
- inspect 的 source classification 仍由 Engine 基于 configured bundled root、verified index 名称和 archive hash 派生；renderer/manifest 未获得 provenance authority。
- verify-2 已在 fresh build 上证明其余六个插件用例、三 viewport overflow/screenshots 和通过用例空 console/page errors；本轮未重跑完整七用例矩阵不推翻已有证据。

## residual_risks
- Plugins **Versions** 对话框、版本历史列表和 UI rollback 入口仍无专属 Electron E2E；已有 Engine/unit 和 connector/AI UI host upgrade/rollback RPC/surface rebind 证据，但 acceptance evidence 应如实区分 UI 未专测部分。
- 插件 **stale-revision** typed error、Engine-derived refresh 与 desktop recovery 没有专属 Electron E2E；其它领域的 stale-revision fixture 不等同于 Plugins 面板验证。
- **Reduced-motion** 模式未专测；现有证据仅覆盖 named controls、三 viewport overflow/fresh screenshots 和相关交互，不应宣称 reduced-motion 专项已通过。
- F7/F8 修复后只重跑了 bundled + `.tlplugin` 聚焦用例，没有重新运行完整七用例插件矩阵。这是可选最终置信度提升；verify-2 已在同一此前 fresh build 上证明其余六例，且 F7/F8 修改范围局限于 source classification 和该 fixture，因此不作为 closeout blocker。
- full workspace clippy 与非插件 monorepo E2E 未运行，按选择性 qualification 范围记录为非阻塞风险，不得在 evidence 中宣称 green。
- 工作树仍包含未提交实现、fix、review和测试产物；closeout 前应确认最终 clean rebuild 的 archives/index/hash、截图和 acceptance evidence 同步，并仅提交任务相关文件。

## summary_for_orchestrator
- open_blockers: 0
- open_majors: 0
- open_minors: 0
- open_needs_evidence: 0
- ready_for_closeout: yes
- dispatch_trellis_fix_next: no
- dispatch_trellis_verify_next: no
- optional_final_confidence: 如时间允许，可在同一 fresh dist 上重跑完整七用例插件 Electron 矩阵；这是非阻塞补强，不是 green 标准的未满足项。

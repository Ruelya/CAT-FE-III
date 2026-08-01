# Findings round 4

## meta
- task: .trellis/tasks/07-30-plugin-management-release
- branch: task/07-28-plugin-management-release
- head_sha: 5ee23e940dbd38ce9970d88da395d86b90a4060d
- worktree: includes uncommitted implement/fix/review WIP and fresh desktop build/E2E artifacts
- round: 4
- after_verify: `review/verify-2.md` read in full

## need_verify
- required: false
- reason: verify-2 已将剩余失败诊断为一个可直接修复的 E2E fixture 错误（F7）和一个明确的 inspect provenance 产品不一致（F8）。在修复落地前继续运行同一 Electron 用例只会复现已知失败；修复后应对 Path B 及相关 source-kind 回归做一次聚焦验证。

## issues

### F1
- severity: major
- files: `crates/plugin-runtime/src/package_archive.rs`; `crates/engine/src/plugin.rs`; `crates/engine/src/plugin_bundled.rs`; `crates/storage/src/migrations.rs`; `scripts/package-plugins.mjs`; `apps/desktop/src/renderer/PluginsPanel.tsx`
- problem: Round 1 的广泛证据缺口已被后续 focused tests、Engine smoke、打包重建和真实 Electron 验证拆分并处理；本轮无重新打开依据。
- minimal_fix: none
- status: fixed

### F2
- severity: major
- files: `scripts/engine-smoke.mjs:2207-2265`; `scripts/engine-smoke.mjs:2820-2952`
- problem: 同版本幂等/不同 bytes conflict、完整 plugin lifecycle、`.tlplugin` inspect/install、bundled list/apply/current 和 degraded catalog 隔离均已有通过的 focused plugin smoke 证据。
- minimal_fix: none
- status: fixed

### F3
- severity: major
- files: `apps/desktop/tests/e2e/workbench.spec.ts:427-454`; `apps/desktop/tests/e2e/workbench.spec.ts:1212-1218`; related plugin E2E call sites
- problem: 已修复并有真实运行证据。verify-2 在 fresh `pnpm build` 后运行 7 个插件相关 Electron 用例，其中 local process、connector、Tier 2 sandbox、AI/UI host、Tier 1 和 crash degraded 六个通过。共享 inspection helper 能到达 Inspect package、确认后进入 permission review；精确 Plugins heading 不再 strict-mode 多匹配。通过用例收集的 console/page errors 为空，verify-1 中的 heading/permission timeout 回归已在实践中消失。
- minimal_fix: none
- status: fixed

### F4
- severity: major
- files: `scripts/engine-smoke.mjs:2820-2952`; `apps/desktop/tests/e2e/workbench.spec.ts:1316-1467`
- problem: 原有 archive/bundled 广泛端到端缺口已基本关闭并收敛为 F7/F8。Engine smoke 已通过 `.tlplugin`、bundled apply/current、无 archive path 和 degraded isolation；verify-2 的真实 Electron Path A 已通过 catalog list、Bundled 区 install、host-derived `bundled`、Current、uninstall 和 renderer path non-disclosure。Path B 也实际完成 picker→Inspect→confirm→permission→installed row，只因 fixture 指向可信 catalog archive而在错误的 `local archive` badge 预期处失败。剩余离散工作不再保留为笼统 F4，分别由 F7 fixture 修复和 F8 inspect source-kind 一致性承接。
- minimal_fix: none；不要回退“可信 index+hash archive 安装为 bundled”的正确 provenance 语义。
- status: fixed

### F5
- severity: minor
- files: `crates/plugin-runtime/src/package_archive.rs:1093-1385`
- problem: encrypted、symlink、special file、count/depth/path/size 等 archive 边界测试已通过。
- minimal_fix: none
- status: fixed

### F6
- severity: minor
- files: `crates/engine/src/plugin_bundled.rs:721-1030`
- problem: bundled provenance spoof、hash mismatch、local directory derivation和 invalid release metadata/license 负向测试已通过。
- minimal_fix: none
- status: fixed

### F7
- severity: major
- files: `apps/desktop/tests/e2e/workbench.spec.ts:1322-1329`; `apps/desktop/tests/e2e/workbench.spec.ts:1435-1466`
- problem: `.tlplugin` Path B 意图验证 community/local archive，但 fixture 直接使用 `apps/desktop/resources/plugins/example.hello-srt-0.1.0.tlplugin`，该文件位于可信 bundled root、被 index 列出且 hash 匹配。因此 install 按安全契约正确派生为 `bundled`，而 E2E 错误地期待 installed row 含 `local archive`，导致 fresh Electron 矩阵 6/7 而非全绿，并阻断 Path B 的 uninstall 与最终 console error 断言。该失败是测试 fixture 设计错误，不是本地 archive 安装失败。（来源：verify-2 V1）
- minimal_fix: 在 E2E harness 的临时目录中复制 release `.tlplugin`，确保 picker fixture 位于 configured bundled root 之外，再用该临时路径启动 Path B；保持 inspection/install badge 均期待 `local archive`，断言 UI/renderer 不显示临时绝对路径，完成 uninstall 并检查 `consoleErrors === []`。Path A 保持使用真实 catalog，不得把 bundled 产品语义改成 local 来让测试通过。修复后仅需 fresh build 并聚焦重跑该用例及最小 source-kind 回归。
- status: open

### F8
- severity: minor
- files: `crates/engine/src/plugin.rs:368-398`; `crates/engine/src/plugin.rs:437-441`; `crates/engine/src/plugin.rs:851-855`; `crates/engine/src/plugin_bundled.rs:349-387`
- problem: `inspect_plugin` 直接返回 materialization 检测到的 `staged.source_kind`，没有调用 install/upgrade 使用的 `classify_source_kind`。verify-2 因此观察到同一可信 catalog archive在 Inspect package 中显示 `local archive`，确认安装后变为 `bundled`。R3/R4 要求 inspection 返回 host-derived source kind；确认前后的来源标签变化会误导权限/安装决策。V1 fixture 错误触发了该路径，但 F8 是独立产品一致性问题。（来源：verify-2 V2）
- minimal_fix: 在 `inspect_plugin` 构造 `PluginInspection` 前，按 install/upgrade 相同规则对 staged source 应用 `classify_source_kind`，并保持 cleanup/side-effect-free 行为。增加 focused unit test：已验证 catalog archive inspect 返回 `Bundled`；同一 archive 复制到 bundled root 外 inspect 返回 `LocalArchive`；unlisted/hash-mismatched archive不得升格。随后聚焦重跑 Path A/Path B source label 断言。
- status: open

## assumptions
- `verify-2.md` 已完整读取；其 E2E 明确在 17:10 fresh build 后运行，截图在 17:11 之后生成，因此本轮接受这些结果，不与 verify-1 的 stale-dist 假绿混淆。
- Path A 的所有断言在同一测试进入 Path B 前已完成，包括 catalog 可用、bundled source、路径不泄露、Current/uninstall 和空 console errors；后续 Path B 失败不推翻 Path A 证据。
- verified catalog 内 archive 安装为 `bundled` 是 R2/AC-04 要求的 host-derived provenance，不应为满足 F7 而修改 Engine 分类规则。
- 通过的六个 Electron 用例及 viewport harness 足以关闭 F3 的原 selector/inspection 回归；尚未专测的 Versions UI、plugin stale revision 和 reduced-motion 作为明确 residual risk 保留，不伪称已经验证。

## residual_risks
- Plugins **Versions** 对话框、版本历史列表和 UI rollback 入口没有专属 Electron E2E；verify-2 只证明 connector/AI UI host 的 upgrade/rollback RPC 与相关 surface rebind。发布证据必须区分 RPC lifecycle 与 Versions UI 未验证部分。
- 插件 **stale-revision** typed error、Engine-derived refresh 和恢复流程没有专属 desktop E2E；其它域的 stale fixture 不能替代插件面板证据。
- **Reduced-motion** 模式未设置或专测；本轮只有 named controls、三 viewport overflow 与 fresh screenshots 证据，不能据此宣称所有动画在 reduced-motion 下已验证。
- 1250x744、1680x942、1920x1080 的 fresh screenshot/overflow 断言通过，六个通过用例 console/page errors 为空；失败的 Path B 未执行最后 uninstall 和 console assertion，须在 F7 修复后补齐。
- full workspace clippy 与非插件 monorepo E2E 未运行，继续作为选择性资格范围外风险；acceptance evidence 不得宣称这些 gate green。
- 工作树仍含未提交实现/fix/review和 fresh E2E artifacts；closeout 前需同步最终 clean rebuild、archive/index hash、截图与 acceptance evidence。

## summary_for_orchestrator
- open_blockers: 0
- open_majors: 1
- open_minors: 1
- open_needs_evidence: 0
- ready_for_closeout: no
- dispatch_trellis_fix_next: yes
- dispatch_trellis_verify_next: no
- fix_scope: F7 仅把 local `.tlplugin` fixture 复制到 bundled root 外并完成 Path B；F8 让 inspect 使用与 install/upgrade 相同的 host-derived source classification，并添加 catalog-inspect/local-copy 负向回归。修复落地后再派聚焦 verify，当前无需重复运行已知失败。

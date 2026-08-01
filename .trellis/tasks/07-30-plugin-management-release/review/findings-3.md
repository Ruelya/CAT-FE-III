# Findings round 3

## meta
- task: .trellis/tasks/07-30-plugin-management-release
- branch: task/07-28-plugin-management-release
- head_sha: 5ee23e940dbd38ce9970d88da395d86b90a4060d
- worktree: includes uncommitted implement, fix, rebuilt release artifacts, and review WIP
- round: 3
- after_fix_worker: 019fbc85
- reviewed_context: `review/findings-2.md`; full `review/verify-1.md`; focused diffs for the five fix-touched paths

## need_verify
- required: true

### Verify mission
- purpose: F3/F4 的 E2E 代码已经适配 inspect-before-mutation、精确 heading，并新增 bundled catalog 与 `.tlplugin` 流程，但 fix worker 只完成 E2E TypeScript 编译，尚未在 fresh desktop build 上运行真实 Electron。上一轮已证明 stale dist 会产生假绿，因此必须用重新构建的 WIP 验证这些修复，才能判断 AC-08/AC-09 及 F3/F4 的桌面部分是否关闭。
- questions:
  - fresh `pnpm build` 后，原有插件 Electron 用例是否能通过 Inspect package 确认，再进入 permission review，而不再出现 heading strict-mode 碰撞或 permission timeout？
  - 新增的 bundled E2E 是否真实看到可信 catalog、从 Bundled 区安装/恢复 Tier 1 package、显示 host-derived `bundled` source kind，并且 renderer-visible catalog/plugin state 不泄露 release archive 路径或 `.tlplugin` 文件名？
  - 新增的 `.tlplugin` picker E2E 是否显示 `local archive` inspection、identity/version/hash prefix/compatibility，确认前不安装，确认后完成 permission review/install/uninstall？
  - upgrade、version history、rollback、diagnostics、stale revision recovery、disable/uninstall 等现有插件矩阵在 fresh build 上是否仍通过，且所有相关用例的 `consoleErrors`/page errors 为空？
  - 1250x744、1680x942、1920x1080 三个要求尺寸下，fresh WIP Plugins surface、inspection/permission/version dialogs 是否无重叠/裁切，并保持键盘操作、focus containment 和 reduced-motion-safe 行为？
- success_criteria:
  - 在同一次验证中先完成 fresh desktop build，再运行与 Plugins/plugin/bundled/archive 相关的真实 Electron Playwright 用例；所有目标用例通过，不能复用验证前的旧 dist。
  - Inspect package 对话框的关键字段断言通过，mutation 只发生在确认后；permission review、enable/disable、upgrade/history/rollback/diagnostic/stale-revision/uninstall 流程没有超时或 selector ambiguity。
  - bundled 与 local archive 两条新增路径通过；catalog/renderer 可见 JSON 和 UI 不含可信 bundled archive 的资源目录路径或 `.tlplugin` 文件名，source badge 与 Engine-derived state 一致。
  - 三个指定窗口尺寸均有 fresh-build 截图或等价布局断言，内容无重叠/遮挡；键盘/focus 检查通过；console/page error 收集为空。
  - 若某用例失败，报告须区分 selector/test-fixture 缺陷、环境问题与真实产品行为错误，并给出首个有效错误和受影响 AC，不能只记录非零退出码。
- failure_signals:
  - 未 rebuild 就直接运行 E2E，或运行结果来自 stale dist。
  - Inspect package 未出现、确认前已安装、确认后无法进入 permissions，或 `Plugins` heading 再次多匹配。
  - bundled catalog 不可见/无法 apply，source kind 不是 `bundled`，或 renderer/UI 暴露 release archive 的 resources 路径或 `.tlplugin` 文件名。
  - `.tlplugin` 被当作目录/错误 source kind，或 inspect/install/uninstall 任一流程失败。
  - upgrade/history/rollback/stale revision/diagnostics 等既有插件用例回退，出现 console/page error、布局重叠/裁切或键盘/focus 失效。
- suggested_commands:
  - `cd apps/desktop && pnpm build`
  - `cd apps/desktop && pnpm exec playwright test tests/e2e/workbench.spec.ts --grep "plugin|release-bundled|tlplugin"`（按仓库实际 Playwright wrapper/项目参数调整，但必须针对刚生成的 dist）
  - 使用现有 desktop screenshot/layout harness 在 1250x744、1680x942、1920x1080 捕获 Plugins、Inspect、Permissions 和 version-history 状态；若现有命令名称不同，以仓库脚本为准
- scope: `apps/desktop/tests/e2e/workbench.spec.ts` 中 Plugins/plugin/bundled/archive/upgrade/rollback/diagnostic/stale-revision 相关真实 Electron 用例，以及它们依赖的 fresh desktop build；只检查 F3/F4 桌面剩余证据。
- avoid: 不使用未 rebuild 的 `dist`；不把 `tsc`、Vitest 或 Engine smoke 代替真实 Electron；不跑无关全 monorepo E2E 或 full workspace clippy；不要重复已通过的 package archive、bundled unit、storage 或 package reproducibility 全套验证，除非 Electron 失败诊断明确指向它们。
- related_issues: F3, F4

## issues

### F1
- severity: major
- files: `crates/plugin-runtime/src/package_archive.rs`; `crates/engine/src/plugin.rs`; `crates/engine/src/plugin_bundled.rs`; `crates/storage/src/migrations.rs`; `scripts/package-plugins.mjs`; `apps/desktop/src/renderer/PluginsPanel.tsx`
- problem: Round 1 的广泛证据缺口已在 `verify-1.md` 中收敛，并在后续 F2-F6 中分别处理；本轮没有发现需要重新打开 F1 的新事实。
- minimal_fix: none
- status: fixed

### F2
- severity: major
- files: `scripts/engine-smoke.mjs:2207-2265`; `scripts/engine-smoke.mjs:2820-2952`
- problem: 已修复。smoke 现在断言同版本同 hash 安装幂等成功，identity/hash/revision/status/activeVersionId 不变；另构造同版本不同 bytes 并要求 typed `plugin_conflict` 且 active state 不变。fix summary 记录 `TRANSLUNAR_SMOKE_SCOPE=plugin` 完整通过，因此原先被 duplicate 断言阻断的后续 lifecycle 已执行；同一 smoke 还新增并通过 `.tlplugin` inspect/install、bundled list/apply/current、缺失 catalog 降级与 local install/Engine health 隔离。
- minimal_fix: none
- status: fixed

### F3
- severity: major
- files: `apps/desktop/tests/e2e/workbench.spec.ts:427-454`; `apps/desktop/tests/e2e/workbench.spec.ts:1212-1218`; related plugin E2E call sites
- problem: fix diff 已增加共享 `confirmPluginInspection`/`installPluginPackageFromPicker` helper，断言 Plugin ID、Version、Source、Package hash、Compatibility 和 hash prefix 后再确认 install/upgrade；原有插件用例已改为先确认 inspection，Plugins heading 也改成 exact name + level/id。E2E TypeScript 编译通过，静态修复方向正确。但 fresh Electron E2E 未运行，尚不能证明上一轮真实发生的 strict-mode/permission timeout 已消失，也不能证明既有 upgrade/history/rollback/diagnostic/stale-revision 流程未回退。
- minimal_fix: 不再修改产品代码；执行本轮 Verify mission。若 fresh E2E 只暴露 selector/fixture 问题，最小修正共用 helper 或定位器并重跑受影响插件矩阵；若暴露产品行为错误，再按首个有效失败修复。
- status: needs_evidence

### F4
- severity: major
- files: `scripts/engine-smoke.mjs:2820-2952`; `apps/desktop/tests/e2e/workbench.spec.ts:1316-1467`
- problem: Engine 部分已修复并有通过的 smoke 证据：release-built `.tlplugin` 走 inspect/install，可信 bundled root 走 `plugin.bundled.list/apply` 和 second apply/current，序列化 catalog 不暴露 archive path；缺失 catalog root 后 local directory install 和 Engine health 仍正常。Electron 测试也已新增 bundled catalog install/current/uninstall、permission/enable、renderer-visible payload path 检查，以及 `.tlplugin` picker→inspect→permission→install→uninstall 流程。不过这些新增 Electron 路径从未实际运行，F4 的桌面端到端部分仍等待证据。
- minimal_fix: 执行本轮 Verify mission，重点运行新增 `installs release-bundled and .tlplugin packages without exposing archive paths` 用例及相关 Plugins 矩阵；只在失败证据指明时做最小 E2E fixture/selector 或产品修复。
- status: needs_evidence

### F5
- severity: minor
- files: `crates/plugin-runtime/src/package_archive.rs:1093-1385`
- problem: 已修复。新增参数化边界测试覆盖 encrypted entry、ZIP symlink、special Unix FIFO mode、entry count、depth、path length 与声明 uncompressed size 超限，并为每一类拒绝断言 extraction destination 保持为空。fix summary 记录 package archive tests 9/9 通过。
- minimal_fix: none
- status: fixed

### F6
- severity: minor
- files: `crates/engine/src/plugin_bundled.rs:721-1030`
- problem: 已修复。新增测试证明 bundled root 中未列入 index 或 hash 不匹配的 archive 仍是 `LocalArchive`，安装不会获得 `Bundled`；配置真实 catalog 时 local directory 仍是 `LocalDirectory`；缺 LICENSE 的 release package 使 catalog fail closed 但不破坏 Engine/local install；无效 publisher/license expression 被 release validation 拒绝。fix summary 记录 plugin_bundled tests 8/8 通过。
- minimal_fix: none
- status: fixed

## assumptions
- fix worker 报告的 `TRANSLUNAR_SMOKE_SCOPE=plugin` pass、package archive 9/9、plugin_bundled 8/8 和 E2E TypeScript compile pass 视为本轮输入证据；本 reviewer 未重复执行这些命令。
- `crates/storage/src/store.rs` 的额外改动不构成新 finding：成功 provenance validator 的缺省 usage 从 `Value::Null` 改为 `{}`，与 Engine `plugin_attempt` 及 checkpoint migration 已有 `unwrap_or_else(|| json!({}))` 写入语义一致；通过的 plugin scope smoke 会执行 `exerciseQaPipelinePluginSmoke`，没有观察到该路径回归。
- fresh Electron E2E 明确未运行，因此不能用代码存在、E2E tsc 或上一轮 stale-dist pass 关闭 F3/F4。
- Engine smoke 对 archive/bundled/degraded 的通过可以关闭 F4 的进程级部分，但不能替代 renderer/Electron 路径。

## residual_risks
- fresh-build Electron 的完整插件矩阵、空 console/page errors、三个指定 viewport、keyboard/focus trap、reduced motion 和 non-overlap 仍未证明；这些由本轮 Verify mission 承接。
- 新 bundled E2E 通过 `window.translunar.invoke` 检查 catalog/plugin state；验证时需确认它断言的是 renderer 实际可见 API，且不把 managed Engine data path 与被禁止的 release archive/resources path 混为一谈。
- archive security 新增边界被合并成一个测试函数；9/9 pass 证明该函数整体完成，但后续失败定位粒度较粗，不影响当前关闭 F5。
- full workspace clippy 与非插件 monorepo E2E 仍未运行，按 selective qualification 约束保留为非阻塞环境/范围风险，不得在 acceptance evidence 中宣称已 green。
- 工作树仍包含未提交实现、fix、重建二进制资源和 review 产物；closeout 前需确认 clean rebuild 的 archives/index/hash 与最终 evidence 同步。

## summary_for_orchestrator
- open_blockers: 0
- open_majors: 2
- open_minors: 0
- open_needs_evidence: 2
- ready_for_closeout: no
- dispatch_trellis_fix_next: no
- dispatch_trellis_verify_next: yes
- verify_focus: fresh desktop build 后的真实 Electron Plugins/plugin/bundled/`.tlplugin`/upgrade/history/rollback/diagnostic/stale-revision 矩阵，三个要求尺寸，以及空 console/page errors；不得复用 stale dist。

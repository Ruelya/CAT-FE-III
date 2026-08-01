# Findings round 2

## meta
- task: .trellis/tasks/07-30-plugin-management-release
- branch: task/07-28-plugin-management-release
- head_sha: 5ee23e940dbd38ce9970d88da395d86b90a4060d
- worktree: includes uncommitted implement WIP and verify-generated/rebuilt release artifacts
- round: 2
- resumes: `review/findings-1.md` after full consumption of `review/verify-1.md`

## need_verify
- required: false
- reason: `verify-1.md` 已把未知风险收敛为可直接修复的 smoke/Electron 测试脱节和明确覆盖缺口；在这些修复落地前重复验证不会提供新判断。修复后应由 Orchestrator 重新进入 review，并为受影响的 smoke、fresh-build Electron E2E 和新增负向测试安排聚焦验证。

## issues

### F1
- severity: major
- files: `crates/plugin-runtime/src/package_archive.rs`; `crates/engine/src/plugin.rs`; `crates/engine/src/plugin_bundled.rs`; `crates/storage/src/migrations.rs`; `scripts/package-plugins.mjs`; `apps/desktop/src/renderer/PluginsPanel.tsx`
- problem: Round 1 的广泛“缺少运行时资格证据”已被 `verify-1.md` 显著收敛。现已有可信证据证明：package archive focused tests 8/8、Engine plugin lifecycle 25/25、bundled catalog 4/4、storage 6/6、desktop typecheck、desktop vitest 174/174、package validator/check 和双重 deterministic rebuild 均通过；live RPC 也证明 `.tlplugin` inspect/install、同版本同 hash 幂等且 revision 不变、同版本不同 bytes 返回 `plugin_conflict`。剩余失败和覆盖缺口不再保留为笼统 F1，而拆分为 F2-F6。
- minimal_fix: none；保留 `verify-1.md` 的命令、结果和产品解释作为已建立证据，不要因后续测试脚本修复而重复扩大审查范围。
- status: fixed

### F2
- severity: major
- files: `scripts/engine-smoke.mjs:2207-2218`
- problem: `TRANSLUNAR_SMOKE_SCOPE=plugin` 仍断言重复安装必须返回 `invalid_state`，与当前最终契约“同版本同 hash 幂等成功且 revision 不变”以及通过的 unit/live RPC 证据冲突。smoke 因此在 hello-srt enable 后提前退出，upgrade、失败补偿、rollback、revoke、disable/uninstall 等后续发布资格流程没有执行。该问题是测试契约过时，不是已观察到的产品幂等实现错误。（来源：V1）
- minimal_fix: 将 duplicate 段改为断言第二次 install 成功、plugin identity/hash/revision 和 active generation 均不变；另以修改 package bytes 的同版本包断言 typed `plugin_conflict` 且 active state 不变。随后让完整 plugin smoke 继续跑完既有 upgrade/failure/rollback/revoke/disable/uninstall 段，保留产品语义日志。
- status: open

### F3
- severity: major
- files: `apps/desktop/tests/e2e/workbench.spec.ts:427-436`; `apps/desktop/tests/e2e/workbench.spec.ts:1181-1187`; `apps/desktop/tests/e2e/workbench.spec.ts:1319-1322`; `apps/desktop/tests/e2e/workbench.spec.ts:1631-1633`; `apps/desktop/tests/e2e/workbench.spec.ts:2063-2066`; `apps/desktop/tests/e2e/workbench.spec.ts:2466-2469`; `apps/desktop/tests/e2e/workbench.spec.ts:2684-2687`
- problem: fresh desktop build 上的真实 Electron 插件 E2E 没有适配 inspect-before-mutation：选择包后仍直接等待 Permission review，而产品现在必须先显示并确认 Inspect package。主 Plugins heading 查询还使用非 exact 名称，因 `Plugins`、`Bundled core plugins`、`Installed plugins` 同时匹配而触发 Playwright strict-mode 失败。旧 dist 上的绿色运行不包含 WIP UI，已被 verifier 正确判定为无效资格证据；当前不能宣称 AC-08/AC-09 的真实桌面流程 green。（来源：V2、V3）
- minimal_fix: 在共用 E2E helper 中显式等待 Inspect package，对 identity/version/source/hash prefix/compatibility/distribution/capability diagnostics 的关键字段做断言，再点击对应 Install package 或 Upgrade package 确认按钮，之后才进入 permission helper；将 Plugins heading 定位改为 `exact: true`、明确 level 或稳定的 aria-labelledby/id。所有插件 E2E 必须先执行 fresh `pnpm build`，并继续断言 `consoleErrors`/page errors 为空。
- status: open

### F4
- severity: major
- files: `scripts/engine-smoke.mjs`; `apps/desktop/tests/e2e/workbench.spec.ts`; `apps/desktop/src/main/index.ts`; `apps/desktop/src/renderer/PluginsPanel.tsx`
- problem: 即使修复现有失败，当前 Engine smoke 仍只使用 `examples/plugins/*` 目录且不调用 `plugin.bundled.list/apply`；Electron E2E 也没有 bundled install/restore/update 或 `.tlplugin` inspect-confirm-install 路径。live RPC 已证明 archive API 基本可用，bundled unit tests 已证明缺失/篡改 catalog 的 Engine 层降级，但它们不能替代 PRD R6/AC-08 明确要求的 archive 与 bundled 端到端资格，也未证明 renderer 不获得 bundled 文件系统路径。（来源：V8）
- minimal_fix: 扩展 plugin smoke，至少从生成的 `.tlplugin` 完成 inspect/install，并在配置可信 bundled root 后调用 `plugin.bundled.list/apply` 覆盖 install/restore（以及可构造时的 update），再以损坏或缺失 catalog 证明普通 local install/Engine health 不受影响。扩展 fresh-build Electron E2E，从 Bundled 区完成 install/restore 或 apply update，并断言 renderer-visible state/IPC payload 不含 archive filesystem path；另用 picker fixture 走一次 `.tlplugin` inspect-confirm-install。保持用例选择性，不扩成全 monorepo E2E。
- status: open

### F5
- severity: minor
- files: `crates/plugin-runtime/src/package_archive.rs`
- problem: 实现包含 encrypted entry、symlink/special Unix mode、entry count、depth/path/total-size 等拒绝分支，但当前 8 个 archive tests 没有为这些边界提供负向回归；AC-02 的恶意归档矩阵因此只有实现静态证据，没有完整的可执行防回退证据。（来源：V4）
- minimal_fix: 增加最小构造归档用例，覆盖 encrypted、symlink/special file、超 entry count、超 depth/path/size；每例同时断言 typed rejection、目标目录为空且 staging 被清理。可把共享 ZIP 构造器复用到参数化测试，避免重复大 fixture。
- status: open

### F6
- severity: minor
- files: `crates/engine/src/plugin_bundled.rs`; `crates/engine/src/plugin.rs`
- problem: `classify_source_kind` 和 release package validation 的静态逻辑合理，且已有 missing/tampered catalog tests，但没有直接钉死“位于 bundled root 却未被可信 index+hash 授权的本地输入不得成为 Bundled”，也没有 invalid publisher/license release package 的 catalog 负向测试。AC-03/AC-04 的 provenance spoof 和 release metadata 失败边界仍容易回退。（来源：V5）
- minimal_fix: 增加负向 unit tests：bundled root 中未列入 index、名字不匹配或 hash 不匹配的 archive inspect/install 不能得到 `Bundled`；本地 manifest 自称 bundled 仍由 host 派生为 local source；缺失/无效 publisher、license 或 LICENSE material 的 catalog package 被拒绝/使 catalog 按设计降级，同时 Engine open 和 local list/install 保持健康。
- status: open

## assumptions
- `verify-1.md` 已完整读取；其中 stale-dist Electron E2E 的绿色结果明确不作为证据，只有 fresh build 的失败用于本轮判断。
- 同版本同 hash 幂等成功是当前产品契约；unit tests、live RPC 和 PRD AC-05 一致，因此 F2 应修改 smoke，而不是把产品改回 `invalid_state`。
- `apps/desktop/resources/plugins` 的五个 archives 与 index 已由 `--check`、双临时输出重建和资源逐字节比对证明可重复；`evidence-manifest.json` 的 `outDir` 差异不影响 archive/index 资格，但 acceptance evidence 不应把不同输出目录下的 evidence manifest 宣称为字节稳定。
- verifier 在 hello-srt/qa-pipeline archive 中发现的 `src/index.ts` 作为 V7 info 保留：本轮不把有意分发的公开 SDK process-package 源文件等同于 credential/private-path/raw-runtime-payload 泄露；acceptance evidence 必须明确该分发策略，不能笼统声称 archive “无任何 source text”。若 AC-12 被要求按字面禁止可分发源码，则该约束与文本型 process plugin packaging 需要 Orchestrator 触发 re-plan，而不是由 fix/review自行改写要求。

## residual_risks
- 真实 Electron 环境可启动，但 fresh-build 插件 E2E 当前在 inspect/heading 处阻断；1250x744、1680x942、1920x1080 的 WIP 截图、non-overlap、keyboard/focus trap、reduced-motion 和空 console/page error 尚未重新建立，F3 修复后仍需运行并记录。
- candidate attach/hash mismatch、rollback、cross-plugin health 已有 unit 证据，但完整进程级 plugin smoke 尚因 F2 未跑到后段；真实日志结论必须等修复后重跑。
- degraded bundled catalog 与 local install 隔离已有 unit 证据，没有进程/Electron 证据；这是 F4 的明确覆盖工作，而非未知产品失败。
- 全 workspace clippy 与非插件 monorepo E2E 未运行，符合 round 1 mission 的 selective-scope 约束；它们不应被 acceptance evidence 宣称为 green。
- 工作树仍包含未提交实现、重建后的二进制 archives 和 verify 产物；closeout 前需确认最终 diff、资源 hash 和 evidence mapping 对应同一个 clean rebuild。

## summary_for_orchestrator
- open_blockers: 0
- open_majors: 3
- open_minors: 2
- open_needs_evidence: 0
- ready_for_closeout: no
- dispatch_trellis_fix_next: yes
- fix_scope: 先对齐 plugin smoke 的幂等/冲突契约（F2），更新 fresh-build Electron inspect/heading 流（F3），补齐 archive+bundled smoke/E2E（F4），再补最小 archive/provenance 负向 tests（F5-F6）。修复后再进入 review/verify；当前无需在未修复状态下追加 verify mission。

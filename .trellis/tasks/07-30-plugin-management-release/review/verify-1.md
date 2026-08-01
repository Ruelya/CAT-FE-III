# Verify report round 1

## mission_echo
- purpose: 为插件管理发布资格（R6 / AC-02、AC-04–AC-11）收集**有产品语义**的运行时证据：归档安全与 canonical hash、bundled catalog 降级隔离、安装/升级/候选失败保留旧 generation、Engine smoke 生命周期、真实 Electron 交互与布局、可重复制品与敏感扫描。不可用“exit 0 即 green”替代。
- questions_addressed:
  - **Q1 归档恶意输入是否在持久化前失败且清理临时目录；目录与 `.tlplugin` 是否同 canonical SHA-256？**  
    **部分满足。** `package_archive` 8/8 通过：路径遍历、绝对/盘符/UNC/`.` 路径、大小写与 Unicode 碰撞、高压缩比、缺 format marker 均在 `extract`/`materialize` 阶段拒绝；失败用例断言目标目录为空（`destination.read_dir().next().is_none()`）。`directory_and_archive_share_canonical_hash` 证明目录与归档 materialize 后 SHA-256 一致（fixture `8b66a87437ca…` 与 live probe 一致）。实现中另有加密项、symlink、特殊 unix mode、条目数/总大小/深度上限，**但无对应 unit 测试**（见 V4）。
  - **Q2 catalog 篡改/缺失是否只降级；能否伪造 `bundled` provenance？**  
    **在 unit/引擎层基本满足；伪造与 license 边缘仍缺专项测试。** `plugin_bundled::tests` 4/4：`missing_bundled_root_degrades_catalog_without_breaking_engine`（`catalog_available=false`，本地 list 仍健康）、`tampered_catalog_index_fails_closed_for_catalog_only`（引擎仍 open，catalog 空 + diagnostics）、`verified_release_catalog_lists_allowlisted_packages`（worktree `apps/desktop/resources/plugins` 列出 5 个 allowlist 包）。`classify_source_kind` 仅当源路径 canonicalize 后等于**已校验 index 中命名且 hash 通过的 archive** 时才返回 `Bundled`；live probe 在未配置 bundled root 时 inspect archive 为 `localArchive`。无专门 “local manifest 声明 bundled / renderer 伪造” 测试（见 V5）。
  - **Q3 同版本同 hash 幂等、改 bytes typed conflict、失败保留旧 generation、rollback 校验？**  
    **引擎/存储 unit + 针对性 live probe 支持产品语义；Engine smoke 与实现脱节。**  
    - 同 hash 幂等：`duplicate_install_is_idempotent_without_mutating_enabled_plugin` 通过；live RPC：第二次 `plugin.install` **成功** 且 `revision` 不变。  
    - 改 bytes：live RPC 返回 `plugin_conflict` / `plugin version 0.1.0 already exists with a different package hash`，active hash/rev 不变。  
    - 候选失败 / 旧 generation：`failed_candidate_attach_restores_previous_process_generation`、`process_upgrade_preflight_failure_keeps_active_generation_unchanged`、`blue_green_upgrade_rollback_and_restart_keep_immutable_package_roots` 等 25 个 `plugin::tests` 全过。  
    - 重启 hash：`reload_enabled_plugins` 在 hash 失败时 `record_plugin_crash` 并 unregister（代码路径 + storage reopen/quarantine tests）。  
    - **Engine smoke 失败**：期望 duplicate 为 `invalid_state`，与当前幂等语义矛盾（见 V1）。
  - **Q4 Engine smoke 是否覆盖 inspect/install/权限/升级/rollback/bundled/degraded？**  
    **未完成。** `TRANSLUNAR_SMOKE_SCOPE=plugin` 在 hello-srt enable 后的 duplicate install 断言处失败（`Error: duplicate typed conflict`），后续 upgrade/rollback/crash/revoke 等未执行。静态阅读 smoke：覆盖**目录** inspect/install（非 `.tlplugin`）、失败 upgrade 保留 generation、rollback、tier1、crash degraded；**不调用** `plugin.bundled.*`，也无损坏 catalog smoke（见 V1/V8）。
  - **Q5 Desktop typecheck / 真实 Electron E2E（inspect-before-mutation、bundled、布局、console error）？**  
    **typecheck 通过；WIP 真构建下插件 E2E 失败。**  
    - `pnpm --filter @translunar/desktop typecheck` exit 0；desktop vitest 174/174 pass（含 provenance helpers）。  
    - **未 rebuild 时** E2E 曾假绿（旧 dist 无 inspect 对话框 / 新 heading）。  
    - **`pnpm build` 后** 重跑：  
      - `manages a local process plugin…`：`getByRole('heading', { name: 'Plugins' })` 严格模式匹配 3 个 heading（`Plugins` / `Bundled core plugins` / `Installed plugins`）失败（V3）。  
      - connector / tier1 / crash：点击 `Install package…` 后停在 **Inspect package** 确认流，E2E 仍直接等待 `Permission review`，超时（V2）——证明 inspect-before-mutation **代码存在** 但 **E2E 未适配**，不能宣称 AC 交互合格。  
    - 布局 1250×744 / 1680×942 / 1920×1080：旧证据目录有截图，但本次 WIP 真构建未跑通 capture 路径。  
    - **无** bundled catalog install/restore 的 E2E 用例。
  - **Q6 发布脚本可重复、license、敏感扫描？**  
    **核心制品可重复并通过 check；扫描有说明。**  
    - `node --test scripts/package-plugins.test.mjs` pass；`package-plugins.mjs --check`：`plugin catalog check ok (5 packages)`。  
    - 两次 `--out` 临时目录：5 个 `.tlplugin` + `index.json` **字节级一致**；与 `apps/desktop/resources/plugins` 的 archive/index **MATCH**。  
    - `evidence-manifest.json` 含 `outDir` 字段，不同输出路径时 hash 不同（`builtAt: "deterministic"`）；默认 out 与 resources 对齐时可稳定。  
    - index 5 包均有 publisher/license；各 archive 含 LICENSE。allowlist id 与 index 一致。  
    - 启发式扫描：index 无私有绝对路径；connector README/manifest 命中 “secret”/“Token” 字面量为文档字段名（非 credential）；hello-srt / qa-pipeline 包内含 `src/index.ts`（process 示例源码入包，是否允许需产品裁决，见 V7）。

## meta
- task: `.trellis/tasks/07-30-plugin-management-release`
- branch: `task/07-28-plugin-management-release`
- head_sha: `5ee23e940dbd38ce9970d88da395d86b90a4060d` (`5ee23e9`)
- worktree: dirty implement WIP（验证针对 worktree，非仅 HEAD 树）
- round: 1
- related_review_ids: F1
- verify_file: `.trellis/tasks/07-30-plugin-management-release/review/verify-1.md`

## environment
- cwd: `K:\Workbench\CAT`
- OS: Windows (win32), shell bash
- toolchain: cargo test/build debug；Node v24.17.0；pnpm desktop vite/tsc/playwright
- Electron/Playwright：可启动真实 Electron（非 headless 缺失）；**必须先 `apps/desktop` `pnpm build` 才能验证 WIP**，否则 e2e 跑旧 dist 假绿
- deviations:
  - cargo filter 一次只能一个 TESTNAME：分别跑 `plugin::tests` 与 `plugin_bundled::tests`、`store::plugin` 与 `migration_24`
  - Engine smoke 未通过故未完成后续 lifecycle 段
  - 未跑全 workspace clippy / 全 monorepo e2e（符合 avoid）
  - 验证过程中执行过 `package-plugins.mjs`（含默认 out 与临时 out），resources 与 evidence-manifest 可能被重写为可重复产物

## actions

### A1
- command: `cargo test -p translunar-plugin-runtime package_archive --lib`
- exit_code: 0
- log_excerpt: |
    test package_archive::tests::… 8 passed; 0 failed
    (traversal, absolute/drive/UNC, casefold/unicode, high ratio, format marker, canonical hash, reproducible build, distribution metadata)
- interpretation: 归档安全与 canonical-hash 的 focused 测试通过；恶意路径在写入前失败且断言空目录。

### A2
- command: `cargo test -p translunar-engine --lib plugin::tests`
- exit_code: 0
- log_excerpt: |
    test result: ok. 25 passed; 0 failed (plugin lifecycle / upgrade / rollback / isolation)
- interpretation: 候选失败保留 generation、幂等安装、rollback、权限/贡献隔离等与 R3/R6 一致的引擎语义有 unit 证据。

### A3
- command: `cargo test -p translunar-engine --lib plugin_bundled::tests`
- exit_code: 0
- log_excerpt: |
    4 passed: semver precedence; missing root degrades; verified catalog 5 packages; tampered index fails closed
- interpretation: catalog 损坏/缺失不阻止 Engine open；tamper 仅降级 catalog。

### A4
- command: `cargo test -p translunar-storage --lib store::plugin` 与 `migration_24`
- exit_code: 0
- log_excerpt: |
    store::plugin 5 passed; migration_24_backfills_local_directory_provenance_and_survives_reopen ok
- interpretation: CAS/version history、quarantine、legacy package diagnostic、migration_24 通过。

### A5
- command: `node --test scripts/package-plugins.test.mjs`；`node scripts/package-plugins.mjs --check`；双 `--out` 重建对比
- exit_code: 0
- log_excerpt: |
    ✔ plugin core catalog builds and checks deterministically
    plugin catalog check ok (5 packages)
    archives+index TMP1==TMP2; MATCH resources; evidence-manifest differs by outDir only
- interpretation: allowlist 打包可重复；--check 验证 release index/hash。

### A6
- command: `TRANSLUNAR_SMOKE_SCOPE=plugin node scripts/engine-smoke.mjs`（engine debug 已 build）
- exit_code: 1
- log_excerpt: |
    Error: duplicate typed conflict
      at exerciseFocusedPluginSmoke (engine-smoke.mjs:2218)
    assert(duplicateError?.code === "invalid_state", "duplicate typed conflict");
- interpretation: smoke 仍按“重复安装必须 fail closed”编写；产品已改为同版本同 hash **幂等成功**（unit + live probe）。smoke 不能作为本 worktree 资格证据直至对齐。

### A7
- command: 最小 Engine JSON-RPC probe（install 幂等 / 不同 bytes conflict / archive install）
- exit_code: 0
- log_excerpt: |
    duplicate SUCCESS { sameRev: true }
    B conflict code: plugin_conflict message: … different package hash; status installed rev 0
    A archive install status installed sourceKind localArchive
- interpretation: 产品语义与 unit 一致；`.tlplugin` 可 inspect+install（非 bundled root 时 kind=`localArchive`）。

### A8
- command: `pnpm --filter @translunar/desktop typecheck`；desktop `vitest run`（全包 174）
- exit_code: 0
- interpretation: 桌面类型与单元测试干净；不替代 Electron 交互资格。

### A9
- command: stale dist 下 `playwright test -g plugin…`（**无 rebuild**）
- exit_code: 0（**无效资格证据**）
- interpretation: 旧 dist 上 6 个相关用例曾 pass；rebuild 后全部失效 → 说明必须针对 WIP 构建验证。

### A10
- command: `cd apps/desktop && pnpm build` 后重跑插件相关 e2e
- exit_code: 非 0（用例 failed）
- log_excerpt: |
    local plugin: strict mode — heading "Plugins" matched 3 elements
    connector/tier1/crash: Permission review dialog not found (stuck after Install package…; inspect confirm required)
- interpretation: WIP 引入 bundled 分区 heading + inspect-before-mutation 后，现有 e2e **未更新**；真实 Electron 资格 **未建立**。

## results_table

| Area | Command / probe | Result | Product meaning |
| --- | --- | --- | --- |
| package_archive | cargo test … package_archive | 8/8 pass | 多数恶意路径在写前拒绝；canonical hash 目录=归档 |
| engine plugin lifecycle | cargo test … plugin::tests | 25/25 pass | 幂等、冲突、候选失败、rollback、隔离 |
| engine bundled | cargo test … plugin_bundled | 4/4 pass | catalog 降级不挡 Engine；release catalog 可读 |
| storage plugin + m24 | cargo test store::plugin / migration_24 | 6/6 pass | CAS/history/quarantine/provenance backfill |
| package-plugins | node test + --check + dual rebuild | pass | archives/index 可重复；allowlist 一致 |
| Engine smoke plugin | TRANSLUNAR_SMOKE_SCOPE=plugin | **fail** | 卡在过时 duplicate 断言；生命周期未跑完 |
| Live RPC probe | install/idempotent/conflict/archive | pass | 与 unit 语义一致 |
| desktop typecheck/vitest | pnpm typecheck / vitest | pass | 静态/组件层干净 |
| Electron e2e (stale dist) | playwright 无 rebuild | pass（**不可信**） | 未覆盖 WIP UI |
| Electron e2e (fresh build) | build + playwright 插件相关 | **fail** | inspect 确认与 heading 选择器阻断资格 |

## findings_for_reviewer

### V1
- severity: major
- related_review_ids: F1
- title: Engine smoke `plugin` scope 与同版本同 hash 幂等语义脱节
- evidence: `scripts/engine-smoke.mjs:2207-2218` 期望 `duplicateError?.code === "invalid_state"`；`plugin::tests::duplicate_install_is_idempotent…` 与 live probe 显示第二次 install **成功且 revision 不变**；smoke exit 1 `duplicate typed conflict`
- detail: 发布资格依赖的 focused smoke 在 hello-srt enable 后即失败，upgrade/rollback/crash/revoke 段未执行。不是运行时破坏幂等，而是 **测试脚本过时**。
- suggested_next: 将 smoke 改为断言幂等成功（与 unit 对齐），并另加“同版本不同 bytes → `plugin_conflict`”用例；然后重跑完整 `TRANSLUNAR_SMOKE_SCOPE=plugin`。

### V2
- severity: major
- related_review_ids: F1
- title: 真实 Electron E2E 未适配 inspect-before-mutation，WIP 构建下插件用例失败
- evidence: `PluginsPanel.tsx` `beginInspect` → inspect 对话框 → `confirmInspection` 才 `plugin.install`；e2e 仅 `Install package…` 后立刻 `grantInstalledPluginPermissions` 等 `Permission review`；fresh build 下 connector/tier1/crash 均 timeout “Permission review not found”
- detail: 产品路径正确要求 inspect 确认，但 e2e 仍按旧“选包即装”编写。stale dist 假绿会误导 review。
- suggested_next: e2e helper 在 permission 前点击 inspect 对话框确认（`Install package` / `Upgrade package`），并断言 inspect 展示 hash/sourceKind；覆盖 `.tlplugin` 与 directory 两条选择路径。

### V3
- severity: major
- related_review_ids: F1
- title: Plugins 面板新 heading 导致 Playwright 名称碰撞
- evidence: fresh e2e `getByRole('heading', { name: 'Plugins' })` strict mode：匹配 `Plugins`、`Bundled core plugins`、`Installed plugins`（`messages.ts` plugins.title / bundledTitle / installedTitle）
- detail: bundled 分区 UI 使默认 substring 角色查询失败，阻断后续 install 流验证。
- suggested_next: e2e 使用 `{ exact: true }` 或 `getByRole('heading', { name: 'Plugins', level: 2 })` / `#plugins-heading`。

### V4
- severity: minor
- related_review_ids: F1
- title: 归档安全实现有 symlink/加密/数量深度上限，但无对应 unit 测试
- evidence: `package_archive.rs` rejects encrypted、symlink、special mode、`MAX_ARCHIVE_ENTRIES`/`MAX_PACKAGE_*`；tests 仅 8 项（无上述用例）
- detail: 恶意输入矩阵在 mission 中要求更广；当前 evidence 对“任何恶意输入”覆盖不完整。
- suggested_next: 为 encrypted/symlink/entry-limit/depth 各加 reject + empty dest 断言。

### V5
- severity: minor
- related_review_ids: F1
- title: 缺少 “伪造 bundled provenance” 与 invalid license/publisher catalog 专项测试
- evidence: `classify_source_kind` 逻辑存在；`validate_release_package_requirements` 在 catalog 校验中调用；无 “目录放在 bundled root 但不在 index / hash 错仍标 bundled” 的 #[test]
- detail: 静态逻辑合理，但 AC 要求的伪造抵抗未用失败用例钉死。
- suggested_next: unit：任意文件放入 resources/plugins 非 index 名 → install sourceKind ≠ Bundled；index 改 publisher/license 不匹配 → 条目丢弃/degraded。

### V6
- severity: info
- related_review_ids: F1
- title: evidence-manifest 随 outDir 变化（archives/index 仍可重复）
- evidence: dual rebuild 仅 `evidence-manifest.json` mismatch（`outDir` 不同）；packageSha256/archiveSha256 稳定
- detail: 不以 evidence-manifest 字节相等作为 release gate；index+archives 才是资格核心。
- suggested_next: acceptance-evidence 明确只 pin index/archive hashes；或 evidence 去掉 outDir。

### V7
- severity: info
- related_review_ids: F1
- title: 部分 release archive 含 `src/index.ts` 源码文本
- evidence: `example.hello-srt` / `example.qa-pipeline-process` zip 内 `src/index.ts`；mission 扫描 “source text / raw plugin payload”
- detail: 对 process 示例可能是有意分发；若 AC 禁止源码入 core archive，则需 strip。
- suggested_next: 对照 PRD/allowlist 政策；若允许则 evidence 声明豁免。

### V8
- severity: major
- related_review_ids: F1
- title: Engine smoke 与 E2E 均未覆盖 `.tlplugin` archive 与 `plugin.bundled.*` 生命周期
- evidence: smoke 源路径均为 `examples/plugins/*` 目录；无 `plugin.bundled.list/apply`；e2e 无 bundled install/update 断言；live probe 仅证明 archive install API 可用
- detail: AC-02/bundled restore 与 archive inspect-before-mutation 的端到端资格仍缺口。
- suggested_next: smoke 增加 archive path + bundled apply/restore + degraded catalog；e2e 增加 bundled 区 Install 与无 filesystem path 暴露断言。

## residual_unverified
- 完整 `TRANSLUNAR_SMOKE_SCOPE=plugin`（需先修 V1）中的 upgrade 失败保留 generation、rollback、revoke、uninstall 端到端日志证据
- Engine 进程级 degraded bundled catalog + 同时 local install 健康（unit 有，smoke/e2e 无）
- 真实 UI：inspect 对话框字段、确认前无 mutation、stale revision 在 Plugins 面板的 typed error/刷新
- 真实 UI：bundled catalog 列表/安装/更新、renderer 不拿到 bundled 文件系统路径
- 窗口尺寸无重叠与 keyboard/focus trap 在 **WIP 真构建** 下的截图/断言（本次未跑通 capture）
- 加密 ZIP / symlink entry / 超限条目的测试证明（仅有实现）
- 全量 workspace clippy / 非插件 e2e（按 mission avoid 未跑）

## unanswered
- Engine smoke 在修正 duplicate 断言后是否全绿？（未跑通）
- E2E 适配 inspect + exact heading 后插件矩阵是否全绿、consoleErrors 是否仍为 []？（未验证）
- 发布策略是否允许 process 插件 archive 携带 `src/**`？（需产品确认）
- candidate hash mismatch / host attach 失败在 **真实 smoke** 中的 revision/CAS 日志形态（unit 有，smoke 无）

## overall
- mission_status: **partial**
- summary_for_reviewer:  
  Focused **Rust/Node 证据支持** 归档主威胁模型、canonical hash、安装幂等与 hash conflict、候选失败保留 generation、bundled catalog 降级、storage CAS/migration_24、以及 core archives/index 可重复打包。  
  **不能** 据此关闭 F1 的发布资格：`TRANSLUNAR_SMOKE_SCOPE=plugin` 因过时 duplicate 断言失败（V1）；桌面在 **rebuild 后** 插件 E2E 因 inspect-before-mutation 未接入测试（V2）与 heading 名称碰撞（V3）失败；archive/bundled 端到端与若干恶意归档边界仍缺（V4/V5/V8）。  
  早先未 rebuild 的 e2e 绿色结果必须丢弃。  
  建议 review：将 V1–V3、V8 视为打开的 major 证据缺口（修复 smoke/e2e 或明确 waiver），unit 绿不替代 smoke/e2e。
- recommended_review_focus:
  1. 是否阻塞 closeout：V1 smoke + V2/V3 e2e 是否必须本任务内修  
  2. 产品确认 duplicate install 幂等是否最终契约（unit/live 已按幂等）  
  3. bundled UI/API 与 `.tlplugin` 是否纳入本任务 AC 硬门槛（V8）  
  4. acceptance-evidence 仅保留本报告可追溯命令结果，删除未跑 smoke/e2e 的 AC 宣称

## summary_for_orchestrator
- mission_status: partial
- open_verify_findings: V1 major, V2 major, V3 major, V8 major, V4 minor, V5 minor, V6–V7 info
- ready_for_closeout: no
- next: fix smoke + e2e（inspect 确认、heading exact）→ 重跑 plugin smoke 与插件 e2e → review resume_from verify-1

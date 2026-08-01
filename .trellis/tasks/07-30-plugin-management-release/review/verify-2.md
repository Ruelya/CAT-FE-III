# Verify report round 2

## mission_echo
- purpose: F3/F4 的 E2E 已适配 inspect-before-mutation、精确 heading，并新增 bundled catalog 与 `.tlplugin` 流程，但上一轮仅 TypeScript 编译过，未在 fresh desktop build 上跑真实 Electron。本轮必须在 **fresh `pnpm build` 产物** 上验证 Plugins/plugin/bundled/archive 矩阵，才能关闭 AC-08/AC-09 及 F3/F4 的桌面证据缺口（避免 stale dist 假绿）。
- questions_addressed:
  - **Q1 原有插件 Electron 用例在 fresh build 后能否 Inspect → permission review，且无 heading strict-mode / permission timeout？**  
    **是（在跑到的矩阵内）。** 本地 process 插件、connector、Tier1、sandbox、AI/UI host、crash degraded 均通过；共享 helper `confirmPluginInspection` / `installPluginPackageFromPicker` 生效。`#plugins-heading` / `getByRole('heading', { name: 'Plugins', exact: true, level: 2 })` 不再触发 strict-mode 三匹配；permission review 可达且可 grant。
  - **Q2 新增 bundled E2E 是否看到可信 catalog、Bundled 区安装/恢复 Tier1、`bundled` source kind、且 renderer 不泄露 release archive 路径或 `.tlplugin` 文件名？**  
    **是（Path A 完整通过）。** 同一失败用例在 Path B 断言前已完成 Path A：`plugin.bundled.list` `catalogAvailable=true`、含 `example.tier1-toolkit`；Bundled 区 Install → installed badge `bundled`；`plugin.get.sourceKind === "bundled"`；`packagePath` 不含 `resources/plugins` 与 `*.tlplugin`；serialized catalog 不含 `.tlplugin` / resources 路径；Current 按钮 disabled；Uninstall 清空；`consoleErrors === []`。
  - **Q3 新增 `.tlplugin` picker E2E：local archive inspection、identity/version/hash/compatibility，确认前不装，确认后 permission/install/uninstall？**  
    **部分。** Path B 到达 Inspect package，断言 identity/`local archive`/version 后 `confirmPluginInspection` + `grantInstalledPluginPermissions` 成功，插件行可见且可操作。**安装后 source badge 为 `bundled` 而非期望的 `local archive`**，用例在 `toContainText("local archive")` 失败，未执行 Uninstall 与最终 `consoleErrors` 断言。根因：fixture 的 `TRANSLUNAR_TEST_PLUGIN_SOURCE` 指向 **release catalog 内** 的 `apps/desktop/resources/plugins/example.hello-srt-0.1.0.tlplugin`；`install_plugin` 调用 `classify_source_kind` 后合法升为 `bundled`。另：`inspect_plugin` **未** 调用 `classify_source_kind`，故 inspect 仍显示 `local archive`，与 install 后 badge 不一致（产品小不一致，见 V2）。
  - **Q4 upgrade / version history / rollback / diagnostics / stale revision / disable/uninstall 矩阵在 fresh build 是否仍通过且 console/page errors 空？**  
    **大体通过；个别子项未专测。** connector 生命周期含 upgrade+rollback RPC 并 pass；AI/UI host 含 upgrade+rollback 与 surface rebind 并 pass；Tier1 disable/uninstall pass；crash degraded pass；各通过用例末尾 `consoleErrors === []`。**未** 找到 Plugins 面板 **Versions** 对话框 / version-history UI 的专属 E2E；**未** 找到插件 stale-revision recovery 的专属 Electron 用例（仅有其它域的 stale fixture 命名）。
  - **Q5 1250×744 / 1680×942 / 1920×1080 下 Plugins / inspection / permission / 相关表面无重叠裁切，键盘/focus / reduced-motion？**  
    **布局溢出断言通过；键盘命名控件部分覆盖；reduced-motion 未专测。** `captureResponsiveSurface` 在本地插件、permissions、Tier1 inventory/QA、connector profile、AI editor、sandbox panel、degraded 等路径于三尺寸断言 `body/html/#root` 水平 overflow ≤1 并截图（`apps/desktop/test-results/...` 与任务 evidence 目录均有 2026-08-01 17:11 左右 fresh 产物）。`expectNamedControls` 覆盖 `.plugins-panel` 可见控件 accessible name。未跑独立 reduced-motion 用例。

## meta
- task: `.trellis/tasks/07-30-plugin-management-release`
- branch: `task/07-28-plugin-management-release`
- head_sha: `5ee23e940dbd38ce9970d88da395d86b90a4060d`
- worktree: dirty implement/fix/review WIP（验证针对 worktree dist，非仅 HEAD 树）
- round: 2
- related_review_ids: F3, F4
- verify_file: `.trellis/tasks/07-30-plugin-management-release/review/verify-2.md`
- prior_verify: `review/verify-1.md`（stale-dist 假绿 + rebuild 后 heading/inspect 失败；本轮修复后的 E2E 首次真跑）

## environment
- cwd: `K:\Workbench\CAT`（desktop 命令在 `apps/desktop`）
- OS: Windows (win32), shell bash
- Node / pnpm: Node v24 系；`pnpm` 可用
- Electron/Playwright: `@playwright/test` 1.61.1，project `electron`，workers=1，真实 Electron 可启动
- dist freshness:
  - build 完成：`dist/renderer/index.html` / `dist/electron/main/index.js` ≈ **2026-08-01 17:10:19–20**
  - 首张 E2E 截图 ≈ **17:11:05** → **先 build 后 e2e**，非 stale dist
- deviations:
  - 建议 grep `plugin|release-bundled|tlplugin` 仅 4 例；为覆盖 mission 中的 upgrade/rollback/Tier1/crash，扩展为 7 例全插件矩阵（见 A2）。
  - 未跑 monorepo 全 E2E、clippy、Engine smoke、cargo unit（符合 avoid；上一轮 smoke/unit 已由 findings-3 视为输入）。
  - 未单独开 reduced-motion harness。
  - 无产品代码修改。

## actions

### A1
- command: `cd apps/desktop && pnpm build`
- exit_code: 0
- duration_note: ~数秒（contracts prebuild + vite + tsc electron）
- log_excerpt: |
    > @translunar/desktop@0.1.0 build
    > vite build && tsc -p tsconfig.electron.json
    ✓ 1822 modules transformed.
    dist/renderer/index.html … built in 670ms
    (chunk size warning only)
- interpretation: fresh WIP dist 生成成功，可作为后续 Electron 资格基础。

### A2
- command: |
    cd apps/desktop && pnpm exec playwright test tests/e2e/workbench.spec.ts \
      --grep "plugin|release-bundled|tlplugin|Tier 1 toolkit|OpenAI-compatible connector|AI actions|crashed|sandbox panel"
- exit_code: 1
- duration_note: ~2.4 min, 7 tests, 1 worker
- log_excerpt: |
    [1/7] manages a local process plugin…          PASSED
    [2/7] installs release-bundled and .tlplugin…  FAILED (line 1460)
    [3/7] uses the official OpenAI-compatible connector… PASSED
    [4/7] hosts a Tier 2 sandbox panel…            PASSED
    [5/7] mounts plugin AI actions…                PASSED
    [6/7] manages a manifest-only Tier 1 toolkit…  PASSED
    [7/7] isolates a crashed process plugin…       PASSED
    1 failed / 6 passed (2.4m)

    First failure (Path B after Path A succeeded):
      Locator: .plugins-panel__item filter Hello SRT
      Expected: "local archive"
      Received: "… process installed bundled Translunar · MIT sha256:8b66a87437ca …"
      at workbench.spec.ts:1460
- interpretation:  
  - F3 主风险（heading 碰撞、inspect 后 permission timeout）在 fresh build 上 **已消除**。  
  - F4 Path A（bundled catalog + 无路径泄露）**已证明**。  
  - F4 Path B 卡在 **source kind 期望 vs 真实 host-derived 分类**：fixture 使用 catalog 内 archive 路径，install 正确标为 `bundled`。

### A3
- command: 静态核对 `inspect_plugin` vs `install_plugin` 的 `classify_source_kind` 调用
- exit_code: n/a（只读）
- log_excerpt: |
    crates/engine/src/plugin.rs:
      inspect_plugin ~388: source_kind: staged.source_kind  // 无 classify
      install_plugin ~851: staged.source_kind = classify_source_kind(...)
      upgrade_plugin ~437: staged.source_kind = classify_source_kind(...)
    workbench.spec.ts:1322-1329 archivePath =
      apps/desktop/resources/plugins/example.hello-srt-0.1.0.tlplugin
- interpretation: Path B 失败 = **fixture 路径落在 verified catalog archive** + **install 正确升格 bundled**；inspect 仍报 localArchive 是 **inspect 漏 classify** 的产品不一致，却恰好让 Path B 的 inspect 断言先通过。

### A4
- command: 三 viewport 截图与 overflow harness 产物检查
- exit_code: n/a
- log_excerpt: |
    Fresh screenshots under apps/desktop/test-results/ (17:11–17:13):
      plugin-management-{1250x744,1680x942,1920x1080}.png
      plugin-permissions-*.png
      plugin-qa-pipeline-inventory-*.png / plugin-qa-provenance-*.png
      plugin-connector-profile-reference-*.png
      plugin-ai-ui-editor-*.png
      plugin-tier2-panel-*.png
      plugin-degraded-*.png
    captureResponsiveSurface asserts body/html/#root horizontal overflow ≤ 1
    1250 permission dialog visually coherent; scope controls usable
    Insights tabs may use internal horizontal scroll at dense width (document overflow still asserted)
- interpretation: 指定三尺寸有 **本轮 fresh** 截图与溢出断言；非仅归档旧图。未发现用例级 layout fail。

## results_table

| Area | Command / probe | Result | Product meaning |
| --- | --- | --- | --- |
| Fresh desktop build | `pnpm build` | pass | WIP dist 可用 |
| Local process plugin E2E | inspect → enable → permissions → disable/uninstall + 3 viewports | pass | F3 inspect-before-mutation / heading 修复有效 |
| Bundled catalog Path A | list/install/sourceKind/path leak/Current/uninstall | pass | F4 桌面 bundled 路径合格 |
| `.tlplugin` Path B | picker → inspect → install → badge | **fail** at installed `local archive` | fixture 用 catalog 路径 → install=`bundled`；inspect 未 classify |
| Connector lifecycle | install + upgrade/rollback RPC | pass | upgrade/rollback 未回退 |
| Tier1 lifecycle | install/enable/QA/pipeline/disable/uninstall | pass | 权限与贡献矩阵稳定 |
| AI/UI host | surfaces + upgrade/rollback rebind | pass | 升级回滚后 surface 绑定 |
| Crash degraded | durable degraded UI + viewports | pass | 崩溃隔离 UI 稳定 |
| Sandbox Tier2 panel | opaque session | pass | 相关插件面板矩阵 |
| Console/page errors | 6 通过用例 `consoleErrors===[]` | pass | 无收集到的 console/page error |
| Viewports 1250/1680/1920 | captureResponsiveSurface | pass（溢出断言） | 无 document 水平溢出失败 |
| Version history UI / plugin stale-revision E2E | 矩阵内无专测 | unanswered | 见 unanswered |

## findings_for_reviewer

### V1
- severity: major
- related_review_ids: F4
- title: `.tlplugin` Path B fixture 使用 release catalog 路径，安装后 source 为 `bundled` 而非 `local archive`
- evidence: |
    `apps/desktop/tests/e2e/workbench.spec.ts:1322-1329,1435-1460`
    Playwright error: expected "local archive", received installed badge `bundled`
    archivePath = `apps/desktop/resources/plugins/example.hello-srt-0.1.0.tlplugin`
    `classify_source_kind`（`plugin_bundled.rs:349-387`）在路径等于 verified index archive 时返回 `Bundled`
- detail: |
    这是 **test-fixture 设计错误**，不是 “`.tlplugin` 无法安装” 的产品失败。
    Path B 意图验证 **community/local archive** 路径；把 `TRANSLUNAR_TEST_PLUGIN_SOURCE` 指到 bundled root 内已索引且 hash 匹配的文件时，host-derived provenance **必须** 为 `bundled`（与 Path A / R2 一致）。
    安装流本身已走过：Inspect 对话框 → 确认 → Permission review → 行可见。
    **最小修正**：将 `.tlplugin` 复制到 harness 临时目录（bundled root **之外**）再作为 picker fixture；继续断言 `local archive`、不暴露临时绝对路径、uninstall。
    可选：用非 allowlist 的另一归档文件，避免 catalog 同名同 hash 干扰。
- suggested_next: fix_recipe_hint — E2E only: `cpSync(archivePath, join(dataDir, "hello.tlplugin"))` 后 `pluginSource: copyPath`；保持 Path A 不变；重跑该单测

### V2
- severity: minor
- related_review_ids: F4 | new
- title: `inspect_plugin` 未调用 `classify_source_kind`，与 install/upgrade 的 host-derived source 不一致
- evidence: |
    `crates/engine/src/plugin.rs:368-398` inspect 使用 `staged.source_kind` only
    `plugin.rs:851-855` install 与 `437-441` upgrade 调用 `classify_source_kind`
    本轮 Path B：inspect 断言 `local archive` 通过，安装后 UI 为 `bundled`
- detail: |
    R3/R4 要求 inspect 返回 **derived** source kind。当前 inspect 仅反映归档/目录检测（`localArchive`/`localDirectory`），即使用户点选的是 verified release archive，Inspect 对话框 Source 也不会显示 `bundled`，安装后 badge 才变化。
    本轮失败主因仍是 V1 fixture；即使修了 inspect，**若 fixture 仍用 catalog 路径**，正确期望应变为 inspect+install 均为 `bundled`（那将测不到 local archive 语义）。产品与 fixture 应一并裁决。
- suggested_next: fix_recipe_hint — 在 `inspect_plugin` 对 `staged.source_kind` 应用与 install 相同的 `classify_source_kind`；单测覆盖 catalog 路径 inspect → `Bundled`

### V3
- severity: info
- related_review_ids: F3
- title: F3 桌面证据：inspect-before-mutation 与 heading 选择器在 fresh build 上已通过既有插件矩阵
- evidence: |
    6/7 相关 E2E pass on dist built 17:10
    `confirmPluginInspection` / exact Plugins heading / permission grant 路径在 local/connector/tier1/sandbox/ai/crash 均成功
    对比 verify-1：rebuild 后曾 heading×3 与 Permission timeout
- detail: 可视为 F3 的 Electron 证据需求 **基本满足**；残余仅 F4 Path B fixture（及 V2 inspect 一致性），不阻挡 “原有矩阵回归” 判断。
- suggested_next: re-run_with — reviewer 可用本报告关闭 F3 needs_evidence（或保留至 Path B 绿）

### V4
- severity: info
- related_review_ids: F4
- title: F4 Path A（bundled catalog + 无 archive 路径泄露）在真实 Electron 上通过
- evidence: |
    同一失败测试 Path A 全部断言在 Path B 之前执行成功（error-context 与测试顺序）
    sourceKind bundled；packagePath 非 resources/plugins；无 `.tlplugin` 文件名；Current disabled；console 空
- detail: Engine smoke 已覆盖的进程级 bundled 行为，现有 **renderer + real Engine** 桌面闭环证据。
- suggested_next: out_of_scope for further product work on Path A unless Path B fix regresses it

### V5
- severity: info
- related_review_ids: F3, F4
- title: 三指定 viewport 有 fresh 截图 + overflow 断言通过；reduced-motion / Versions UI / plugin stale-revision 未覆盖
- evidence: |
    `captureResponsiveSurface` in workbench.spec.ts:623-678
    test-results screenshots mtime 17:11–17:13
    no failing overflow expects in the 6 green tests
- detail: 布局“无 document 水平溢出”有自动化证据；Insights 标签条在 1250 可能出现 **区域内** 横向滚动（与 document overflow 断言不同）。键盘侧有 `expectNamedControls`；无 focus-trap 专项失败。reduced-motion-safe、Versions 对话框、插件 stale revision recovery **不能**从本轮矩阵宣称合格。
- suggested_next: out_of_scope unless AC 明确要求 UI-level version history / reduced-motion 专测

## unanswered
- Plugins **Versions** 对话框（version history 列表、UI 回滚入口）在 Electron E2E 中是否正确？（本轮仅有 RPC upgrade/rollback）
- 插件 **stale revision** 恢复在桌面 UI 上的表现（矩阵无对应用例）
- **reduced-motion** 下 inspect/permission/version 动画是否安全（无专测）
- Path B 在 fixture 修正后，uninstall 与最终 `consoleErrors` 是否为空（本轮未跑到）
- 修复 V2 后，inspect 对 catalog 路径是否显示 `bundled`（需产品修复 + 重测）

## overall
- mission_status: **partial**
- summary_for_reviewer: |
    在 **fresh `apps/desktop` `pnpm build`（17:10）** 之后运行的 7 例插件相关真实 Electron E2E 中 **6 通过、1 失败**。  
    **F3**（inspect-before-mutation、精确 Plugins heading、permission 流、既有 upgrade/rollback/disable/uninstall/crash 矩阵）在 fresh dist 上得到正面证据，verify-1 中的 selector/timeout 回归已消失，且通过用例 `consoleErrors` 为空，三尺寸 overflow 截图 harness 通过。  
    **F4 Path A**（bundled catalog 安装、`bundled` source、不向 renderer 暴露 release archive 路径/文件名）完整通过。  
    **F4 Path B** 因 E2E 把 picker 指向 **已索引的 release `.tlplugin`**，安装后 host-derived source 为 **`bundled`**，与断言 `local archive` 冲突而失败；流程上 inspect→confirm→permissions→install 已发生。次要产品问题：`inspect_plugin` 未 classify，导致 inspect 与 install source 不一致（V2）。  
    建议：fix worker **只改 E2E fixture**（V1）即可关闭 Path B；可选引擎 inspect classify（V2）。无需因本失败回退 bundled 产品语义。
- recommended_review_focus: |
    1. 是否将 F3 标 fixed（基于本报告 6 绿 + Path A）。  
    2. F4：Path A 可关闭桌面 bundled 证据；Path B 保持 needs_evidence 直至 V1 fixture 修复并单测重跑。  
    3. V2 是否作为 minor 产品 follow-up 纳入本任务或拆出。  
    4. 不要把 “安装后出现 bundled” 误判为 provenance 伪造——路径在 verified catalog 内时 **正是** 期望语义。

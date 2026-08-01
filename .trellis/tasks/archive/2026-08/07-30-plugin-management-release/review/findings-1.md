# Findings round 1

## meta
- task: .trellis/tasks/07-30-plugin-management-release
- branch: task/07-28-plugin-management-release
- head_sha: 5ee23e940dbd38ce9970d88da395d86b90a4060d
- worktree: includes uncommitted implement WIP
- round: 1
- continues: 019fbc4b-62bd-7752-bb95-55a0b9d1692f (524 timeout; context distilled)

## need_verify
- required: true

### Verify mission
- purpose: 这次变更同时跨越归档安全、Engine 生命周期/持久化、bundled catalog、桌面交互和发布制品；仅凭静态审查不足以判断候选包失败时是否保持旧 generation、catalog 降级是否隔离，以及桌面确认/版本操作是否真正可用。R6/AC-02、AC-04 至 AC-11 是发布资格门槛，因此需要一次选择性但有产品语义结论的验证。
- questions:
  - 归档恶意输入（遍历、绝对/UNC/drive、重复及大小写/Unicode 碰撞、链接/特殊文件、加密或不支持压缩、压缩比/数量/深度/大小超限）是否在任何持久化或 managed-package 写入前失败，并且失败后临时目录为空或已清理？目录与 `.tlplugin` 的同一内容是否得到相同 canonical SHA-256？
  - bundled index/archive hash 篡改、缺失或无效 release license/publisher 时，catalog 是否只降级而不阻止 Engine 启动、普通 local install 和其他插件健康？local manifest、路径或 renderer 请求能否伪造 `bundled` provenance？
  - 同版本同 hash 是否幂等，改 bytes 是否得到 typed conflict；安装、升级、权限扩张、candidate hash mismatch、host/registry attach 失败和重启后校验是否保留旧 active generation 并留下有界诊断？rollback 是否只激活 hash 校验通过的 immutable version，并保留无关插件和 built-ins 健康？
  - Engine smoke 是否覆盖 local archive inspect/install、权限 review、enable/contribution/restart、upgrade、rollback、revoke、disable、uninstall 及 bundled install/restore；存储重启和 degraded catalog 情况是否覆盖？
  - Desktop build/typecheck 和真实 Electron E2E 是否证明目录/归档 inspect-before-mutation、bundled catalog、权限决定、upgrade/history/rollback、诊断、stale revision recovery、uninstall 在 1250x744/1680x942/1920x1080 下无重叠，且无 console/page error？
  - 发布脚本从显式 allowlist 生成的 core archives/index 是否可重复，所有 release examples 是否通过同一 validator、具备 publisher/license 和 license text，证据中的 archive/index/diagnostic/log 扫描是否没有 credential、private path、source text 或 raw plugin payload？
- success_criteria:
  - 归档安全和 canonical-hash focused tests 全部通过；恶意样本在写入前拒绝，临时输出清理可由测试或文件系统断言观察到。
  - plugin-runtime、engine/plugin、storage 相关 focused tests 通过；同版本幂等/冲突、启动 hash 校验、catalog tamper/degraded、补偿和 rollback 的断言与 R3/R6 产品语义一致。
  - selective Engine smoke 完成上述本地及 bundled 生命周期，失败场景明确显示旧 generation 仍可用、revision/CAS 和错误记录正确；不得只报告命令 exit code。
  - desktop package/build/type checks 与真实 Electron E2E 通过，确认 inspect 在 mutation 前发生、renderer 不获得 bundled filesystem path、所有操作刷新 Engine-derived state 且无页面/控制台错误；截图或布局检查记录实际尺寸。
  - packaging/reproducibility、license/secret/private-path/payload 扫描及 evidence mapping 与 acceptance-evidence 相互一致；任何未运行的最终 gate 都在报告中明确列为未验证而非宣称 green。
- failure_signals:
  - 任一恶意 archive 在目标或 managed package 目录留下文件，或目录/archive canonical hash 不一致。
  - catalog 损坏阻止 Engine/local install，或非 bundled 输入可以获得 `bundled` source kind；catalog/hash/license 校验被绕过。
  - candidate 失败后旧 generation 未恢复、active record 被切换、版本/权限/贡献归属不一致、rollback 激活未校验 hash 的版本，或无界/泄露敏感数据的诊断。
  - 同版本不同 bytes 被接受、同 hash 重装造成新版本/副作用，或 restart 后 tampered package 仍激活。
  - 桌面在确认前发生 mutation、stale revision 未显示 typed error/刷新、bundled/local 路径或版本历史流程不可完成、布局重叠/键盘不可达、出现 console/page errors。
  - allowlist 之外的 fixture/private API/固定 credential 进入 release archive，重复打包 hash/index 不稳定，或 evidence 扫描发现 secret/private path/raw payload。
- suggested_commands:
  - `cargo test -p translunar-plugin-runtime package_archive --lib`
  - `cargo test -p translunar-engine plugin --lib`（按实际测试模块进一步缩小到 package/bundled/lifecycle tests）
  - `cargo test -p translunar-storage --lib`
  - `node --test scripts/package-plugins.test.mjs`，随后用 release validator 对 `apps/desktop/resources/plugins` 的 index、archives 和 license material 做一次 clean temporary output/rebuild 对比
  - 在支持的环境运行 task 中声明的 Engine smoke 和最小真实 Electron E2E；若仓库脚本名称不同，以对应脚本为准，不要以静态 typecheck 替代交互验证
- scope: `.tlplugin` extraction/hash and plugin-runtime tests; Engine plugin/bundled lifecycle and storage migration/restart paths; `scripts/package-plugins*`; `apps/desktop/src/main/index.ts`, `PluginsPanel.tsx`, bundled resources, and the task acceptance evidence. 只运行与本任务相关的 package/engine/storage/desktop checks。
- avoid: 不跑无关的全 monorepo E2E、完整发行包或全 workspace clippy 作为本 mission 的唯一证据；不要重做已完成的协议 schema 全量阅读；不要把“命令成功”当作没有产品问题的结论。
- related_issues: F1

## issues
### F1
- severity: major
- files: `crates/plugin-runtime/src/package_archive.rs`; `crates/engine/src/plugin.rs`; `crates/engine/src/plugin_bundled.rs`; `crates/storage/src/migrations.rs`; `apps/desktop/src/main/index.ts`; `apps/desktop/src/renderer/PluginsPanel.tsx`; `scripts/package-plugins.mjs`; `apps/desktop/resources/plugins/*`
- problem: 代码和新增 evidence 已覆盖大量 R1-R5 方向，但本轮没有可依赖的运行时/交互资格证据来证明 AC-02、AC-04、AC-05、AC-06、AC-07、AC-08、AC-09、AC-10、AC-11 的关键产品语义。尤其是候选包发布后 hash 校验、补偿路径、重启/rollback、损坏 catalog 隔离以及真实 Electron 的 inspect-before-mutation、stale revision、无 console error 和布局要求，都不能由静态 diff 或 archive listing 单独推出。该任务的 PRD 明确把 focused tests、Engine smoke、真实 Electron E2E 和可重复制品证据列为 release qualification，而当前 worktree 仍是未提交 implement WIP。
- minimal_fix: 不修改产品逻辑以“迎合”审查；先执行 Verify mission 中的选择性 Rust/TypeScript/package、Engine smoke 和真实 Electron E2E。若报告发现失败，只修复对应的最小事务/边界/交互问题并重新运行受影响的检查；更新 acceptance-evidence，仅宣称实际运行且结果可追溯的 AC。所有无法在当前环境运行的 gate 必须记录为未验证并由 Orchestrator 决定是否阻塞发布。
- status: needs_evidence

## assumptions
- review-1 已完成任务规划、研究、代码大段检查和 archive/catalog/provenance/authority 的静态调查；本轮不重复读取生成 schema 或进行全量代码审阅。
- 当前 HEAD 仍为 `5ee23e940dbd38ce9970d88da395d86b90a4060d`，实现变更保留在 worktree，故验证必须针对当前 worktree，而不是仅针对 HEAD。
- acceptance-evidence 中的文字和制品清单视为待核对声明；除非 verify report 给出命令、结果和产品解释，不把它们视为已完成 R6 资格证明。
- E2E、截图和 full clippy 未在本轮运行；按审查规则将其作为验证任务和 residual risk，而不是直接断言实现必然错误。

## residual_risks
- 未证明真实 Electron 的窗口尺寸、focus trapping、reduced-motion、键盘可达性、窄视口 wrapping/non-overlap 和 console/page error 约束。
- 未证明真实 Engine 进程重启、candidate attach/compensation、rollback integrity、cross-plugin health 及 degraded bundled catalog 的端到端行为。
- 工作树含二进制 archive 和任务证据的未提交修改；发布前仍需确认 clean rebuild、hash/index 一致性、license material 及敏感信息/私有路径扫描。
- `git diff --check` 目前只报告任务证据 Markdown 的 trailing whitespace；这是非产品性 nit，不单独阻塞本轮，但 closeout 前可清理。

## summary_for_orchestrator
- open_blockers: 0
- open_majors: 1
- ready_for_closeout: no

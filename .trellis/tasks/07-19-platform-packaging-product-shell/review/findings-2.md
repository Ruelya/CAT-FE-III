# Findings round 2

## meta
- task: `.trellis/tasks/07-19-platform-packaging-product-shell`
- branch: `task/07-19-platform-packaging-product-shell`
- head_sha: `3e4dd7197e538e93828fbe6763a5fa4ea458a3b9`
- working_tree: uncommitted
- round: 2

## need_verify
- required: false

## issues
### F1
- severity: major
- files: `crates/engine/src/ai.rs`, `crates/engine/src/lib.rs`, `apps/desktop/src/renderer/workbench-utils.ts`, `apps/desktop/src/renderer/workbench-utils.test.ts`, `scripts/engine-smoke.mjs`
- problem: Round 1 lacked focused evidence for the release-blocking Engine allowlist paths and localized desktop `policy_denied` formatting. `review/verify-1.md` now supplies that evidence: Rust allowlist tests passed 12/12, focused desktop tests passed 21/21, and the broader desktop unit suite passed 175/175. Denied interactive/batch starts create no durable run or batch, pipeline denial is observed, the stable `policy_denied` data shape is covered, and catalog interpolation preserves generic error formatting.
- minimal_fix: None; the evidence gate is satisfied.
- status: fixed

## residual_risks
- Accepted: Native Windows/macOS installer/package install-and-launch smoke, signing/notarization hooks, and CI artifact/platform/minimum-OS records remain native CI-runner evidence and were not reproduced by this focused local verification.
- Accepted: Automated axe/keyboard coverage does not include the complete Workbench/QA/Export surface; color-contrast and native screen-reader qualification remain in the documented manual accessibility matrix.
- Accepted: Remaining hard-coded English in `Workbench.tsx` is still excluded from the catalog audit because that surface is owned by the separate visual work; the reviewed AI `policy_denied` product path is localized.

## assumptions
- `review/verify-1.md` has `mission_status: satisfied` and answers every required mission question. Its optional stdio smoke did not reach the allowlist assertion because an unrelated PDF import failed first; the mission explicitly made that smoke optional once the required focused Engine and desktop suites were green, so this does not reopen F1.
- The previously accepted shell settings, data-directory migration/backup/restore, draft journal, update manager, packaging gates, tutorial assets, governance files, and broad tests remain the supplied baseline and were not re-reviewed in this resume round.
- Unrelated untracked task directories and `undefined/` shown by `git status` remain outside this task review.

## closeout
- ready_for_closeout: true
- reason: F1 is fixed by a complete satisfied Verify report; there are no open blocker, major, minor, or evidence-gated findings. The listed package/CI, accessibility, and Workbench-English limitations are explicit accepted residual risks rather than quality-loop blockers.

## summary_for_orchestrator
- Verdict is `green`. F1 is closed as `fixed` from the full `verify-1.md` evidence, no additional Verify mission is required, and the task is ready for closeout with the native package/CI evidence, incomplete automated axe matrix, and remaining `Workbench.tsx` English recorded as accepted residual risks.

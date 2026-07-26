# Independent closure check: Plugin Tier 3 foundation

Active task: `.trellis/tasks/07-26-plugin-tier3-foundation`

Goal: verify every AC in `prd.md` against the current shared worktree, with particular attention to duplicate-install atomicity, generation/revision races, crash and timeout error propagation, durable degraded state, contribution removal, SDK dogfood, Engine smoke, Electron IPC/UI evidence, and `retryable: false` after a process failure.

Editable scope: task-owned implementation and tests in `crates/plugin-runtime`, `crates/filter-core`, `crates/storage`, `crates/engine`, `packages/plugin-sdk`, `examples/plugins/hello-srt`, `fixtures/plugins`, `scripts/engine-smoke.mjs`, and the desktop plugin panel/E2E. Directly fix only clear defects and run focused validation for any edit.

Required review output: findings ordered by severity with file/line evidence; acceptance-criteria verdicts; commands run and exact failures; remaining risk. Send a `done` event only after the review is complete.

Forbidden actions: do not commit or archive tasks; do not edit unrelated parent planning; never stage, delete, or overwrite `.trellis/workspace/Ruelya/workbench-assistant-1250x744.png`; do not revert concurrent changes. You are not alone in the worktree, so accommodate existing edits.

# Findings round 1

## meta
- task: `.trellis/tasks/07-19-platform-packaging-product-shell`
- branch: `task/07-19-platform-packaging-product-shell`
- head_sha: `3e4dd7197e538e93828fbe6763a5fa4ea458a3b9`
- working_tree: uncommitted
- round: 1

## need_verify
- required: true

### Verify mission
- purpose: Confirm that the uncommitted Engine allowlist enforcement tests and desktop `policy_denied` presentation changes pass focused runtime/unit validation before this release-blocking task is eligible for closeout.
- questions:
  - Do the focused Rust Engine allowlist tests pass for interactive AI, batch AI, and pipeline pretranslation, while preserving the stable `policy_denied` behavior and preventing denied starts from creating durable runs or batches?
  - Do the available focused desktop unit tests for `workbench-utils` and shell-related behavior pass, including localized formatting of structured `policy_denied` errors on the Live Assistant and AI Control surfaces?
  - If the local Engine smoke prerequisites are available, does the stdio smoke prove that a disallowed profile is rejected with structured project/profile IDs and cannot bypass the Engine boundary?
- success_criteria:
  - The focused allowlist Engine test selection compiles and passes for interactive, batch, and pipeline denial paths.
  - Available focused desktop `workbench-utils` and shell unit tests are green and demonstrate that a structured `policy_denied` error becomes the localized allowlist message without regressing generic error formatting.
  - If the optional stdio smoke is run, its allowlist assertion is green and observes `policy_denied` with the expected project/profile identity; inability to run this optional smoke is documented and does not by itself fail the mission when the required focused suites are green.
- failure_signals:
  - A disallowed AI profile can start interactive, batch, or pipeline work, or a denied request leaves behind a durable run/batch.
  - The Engine returns an unstable or unstructured denial instead of the expected `policy_denied` identity at a boundary covered by the focused tests.
  - Desktop formatting exposes raw policy text, fails to interpolate the profile ID, or breaks generic Engine error formatting.
  - A focused test fails to compile or fails for a product-code reason; environment-only failures must be separated from product failures in the verify report.
- suggested_commands:
  - `cargo test -p translunar-engine allowlist --lib`
  - `pnpm --filter @translunar/desktop test -- workbench-utils`
  - `pnpm --filter @translunar/desktop test -- shell`
  - `pnpm test:e2e:engine` (optional when the local Engine smoke prerequisites are available)
- scope: `crates/engine/src/ai.rs`, `crates/engine/src/lib.rs`, `apps/desktop/src/renderer/workbench-utils.ts`, its focused tests, relevant desktop shell tests if present, and the allowlist block in `scripts/engine-smoke.mjs`.
- avoid: Do not run the full monorepo suite, native Windows/macOS package builds, installer smoke, or the full accessibility matrix for this focused mission.
- related_issues: F1

## issues
### F1
- severity: major
- files: `crates/engine/src/ai.rs`, `crates/engine/src/lib.rs`, `apps/desktop/src/renderer/workbench-utils.ts`, `apps/desktop/src/renderer/workbench-utils.test.ts`, `scripts/engine-smoke.mjs`
- problem: The reviewed release-blocking allowlist and localized error-path changes are still uncommitted and have no attached focused verification report, so their compile/runtime behavior cannot yet be accepted for closeout.
- minimal_fix: Run the Verify mission and attach a complete `review/verify-1.md`; no product-code change is requested unless focused verification identifies a concrete failure.
- status: needs_evidence

## residual_risks
- Accepted: native Windows/macOS package installation and launch smoke remains CI-runner evidence rather than a local verification requirement.
- Accepted: full migration of remaining hard-coded English copy in `Workbench.tsx` is deferred.
- Accepted: the complete axe/manual accessibility matrix, including native/manual coverage, remains residual qualification work.

## assumptions
- The already-landed shell settings, data-directory migration/backup/restore, draft journal, update manager, package-readiness gates, example assets, packaging scripts, governance documents, and broad unit suites are treated as the supplied baseline and were not re-reviewed in this focused round.
- The unrelated untracked task directories and `undefined/` entry shown by `git status` are outside this task review.

## closeout
- ready_for_closeout: false
- reason: The required focused Verify mission has not yet produced a report with `mission_status: satisfied`.

## summary_for_orchestrator
- Verdict is `need_verify`. No concrete product defect is opened in this round; F1 is an evidence-only gate covering the release-blocking Engine allowlist paths and desktop localized error handling. Dispatch `trellis-verify` with this mission, then resume review with the complete verify report. The three stated residual risks are accepted and do not independently block closeout.

# Findings round 1

## meta
- task: `.trellis/tasks/07-19-advanced-ai-quality`
- branch: `task/07-19-advanced-ai-quality`
- head_sha: `e7f1c06bb93ebcfc26cb990fc1fca5483a9fa657`
- round: 1

## need_verify
- required: true

### Verify mission (required if need_verify)
- purpose: Independently establish that the current HEAD satisfies the focused offline quality unit, protocol/build, generated-contract, and real stdio smoke gates; the only runtime evidence currently recorded is the implementer's self-check.
- questions:
  - Do the focused core tests pass on the current HEAD and demonstrate repeatable QE output plus the planted offline semantic-QA and bounded term-extraction behaviors?
  - Do the protocol crate and Engine compile with all three additive `ai.quality.*` methods and the `ai.quality.offline` initialization capability, without generated-contract drift?
  - Does the focused `ai-quality` smoke exercise the real Engine over stdio successfully, without a provider/network dependency or a termbase mutation?
- success_criteria:
  - `translunar-ai-quality-core` tests pass, and repeated scoring of the same fixture yields the same per-segment score, route, and factors with one row per input segment.
  - Offline semantic QA exposes the planted `semantic.empty_target`, `semantic.source_equals_target`, and `semantic.number_mismatch` findings with structured severity/confidence/evidence.
  - Term extraction honors `maximumCandidates`, reports repeated-source frequencies, and leaves termbase state unchanged; no provider or network setup is needed.
  - Protocol tests, Engine build, and generated-contract drift check pass; initialization advertises `ai.quality.offline` and all three methods remain callable through stdio.
  - The focused Engine smoke completes and its assertions cover score, semantic-QA, and term-extraction responses.
- failure_signals:
  - Any focused test/build/contract/smoke failure attributable to these packages or methods.
  - Nondeterministic score rows, a score-row count different from the segment count, wrong route bands, missing required semantic codes, output exceeding the requested candidate bound, any termbase write, or any provider/network requirement.
  - Missing `ai.quality.offline`, rejected `ai.quality.*` dispatch, wire-schema drift, non-JSON stdout, or a stdio compatibility regression.
  - Unrelated dirty task directories or unrelated warnings are noise unless they prevent a focused command from running; record such a prevention as infrastructure blockage rather than a product failure.
- suggested_commands:
  - `cargo test -p translunar-ai-quality-core --lib`
  - `cargo test -p translunar-protocol --lib`
  - `cargo build -p translunar-engine`
  - `pnpm contracts:check`
  - `TRANSLUNAR_SMOKE_SCOPE=ai-quality node scripts/engine-smoke.mjs`
- scope: `crates/ai-quality-core`, AI-quality protocol contracts, `crates/engine/src/ai_quality.rs` plus dispatch/initialization, generated contracts, and `scripts/engine-smoke.mjs` focused scope. A narrow disposable RPC probe may be used if existing assertions do not answer a mission question.
- avoid: Full workspace tests, full desktop builds/E2E, plugin tasks, unrelated smoke scopes, network/provider calls, persistent fixture data, and product-code edits during verification.
- related_issues: F3

## issues
### F1
- severity: major
- files: `crates/ai-quality-core/src/lib.rs:200-213`, `crates/ai-quality-core/src/lib.rs:573-592`, `.trellis/tasks/07-19-advanced-ai-quality/prd.md:37-41`
- problem: Term extraction treats a target observed in exactly half of a source term's occurrences as stable (`count * 2 >= frequency`). With two occurrences paired to two different targets, both have frequency one, so lexicographic tie-breaking returns one complete target string as `suggestedTarget` instead of leaving it empty. This directly violates R3's “stable target string; otherwise empty” rule, and the sole extraction unit test plus smoke only assert the source candidate/frequency, so the false suggestion is unguarded.
- minimal_fix: Require an unambiguous stable target (at minimum a unique strict majority, not `>= 50%`; use any stronger documented threshold if intended), return `None` for ties/split targets, and add focused tests for both a repeated stable target and two conflicting targets. Keep extraction report-only.
- status: open

### F2
- severity: minor
- files: `.trellis/tasks/07-19-advanced-ai-quality/prd.md:20-25`, `crates/ai-quality-core/src/lib.rs:238-324`, `crates/ai-quality-core/src/lib.rs:535-549`
- problem: R1 explicitly lists punctuation retention as an offline QE feature, but `score_segment` has factors for emptiness/equality, length, numbers, placeholders, and negation only. There is no punctuation factor or test, so the implemented explanation/score omits one planned deterministic signal.
- minimal_fix: Add a deterministic, language-safe punctuation-retention/mismatch factor with a bounded penalty and a focused unit fixture that asserts its factor and resulting score/route; do not alter export gates.
- status: open

### F3
- severity: major
- files: `.trellis/tasks/07-19-advanced-ai-quality/implement.md:9-13`, `crates/ai-quality-core/src/lib.rs:523-594`, `scripts/engine-smoke.mjs:1962-2027`
- problem: AC-04 and the runtime portions of AC-01..AC-03 currently rely on implement-reported self-check results. No independent `verify-1.md` exists for the current HEAD, so test/build/contract/real-stdio behavior is not yet independently evidenced for a green verdict.
- minimal_fix: Run the Verify mission above and record a complete `review/verify-1.md` with answers, relevant excerpts, triage for any failure, V* findings, unanswered items, and `mission_status`; product changes are needed only if verification exposes a failure.
- status: needs_evidence

## assumptions
- Product implementation is already present on the current branch/master baseline; the visible tracked worktree diff is limited to task metadata/checklist updates, so this review evaluates the checked-in implementation at HEAD rather than treating the task-only diff as the full feature patch.
- No prior `review/findings-*.md` or `review/verify-*.md` existed in the task directory when round 1 began.
- Read-only Engine flow (`get_document` plus `all_segments` into the pure core) is sufficient static evidence that the extraction handler itself does not write a termbase; runtime verification still checks for unexpected integration side effects.

## summary_for_orchestrator
- Verdict is `need_fix`: F1 is a major correctness gap in stable target suggestion and F2 is a minor missing planned QE signal. F3 also requires the independent focused Verify mission before green. Apply the minimal fixes without broadening scope, then ensure the mission is executed against the resulting HEAD and resume review with the entire verify report.

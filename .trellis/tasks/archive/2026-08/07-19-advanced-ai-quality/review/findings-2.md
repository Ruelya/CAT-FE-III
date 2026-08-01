# Findings round 2

## meta
- task: `.trellis/tasks/07-19-advanced-ai-quality`
- branch: `task/07-19-advanced-ai-quality`
- head_sha: `e7f1c06bb93ebcfc26cb990fc1fca5483a9fa657` (reviewed working tree includes the uncommitted F1/F2 fix)
- round: 2

## need_verify
- required: false

### Verify mission (required if need_verify)
- none; `review/verify-1.md` has `mission_status: satisfied` and records all five focused commands as successful.

## issues
### F1
- severity: major
- files: `crates/ai-quality-core/src/lib.rs:204-216`, `crates/ai-quality-core/src/lib.rs:625-676`
- problem: Fixed. Suggested targets now require a strict majority, and a 50/50 split returns no suggestion.
- minimal_fix: Completed strict-majority predicate and added unit coverage for both a repeated stable target and conflicting targets; preserve report-only extraction.
- status: fixed

### F2
- severity: minor
- files: `crates/ai-quality-core/src/lib.rs:318-330`, `crates/ai-quality-core/src/lib.rs:458-482`, `crates/ai-quality-core/src/lib.rs:677-706`
- problem: Fixed. QE scoring now includes a deterministic punctuation-signature mismatch factor while preserving route calculation and export-gate independence.
- minimal_fix: Completed punctuation factor implementation and unit coverage for equivalent CJK/ASCII punctuation and a mismatched punctuation kind.
- status: fixed

### F3
- severity: major
- files: `.trellis/tasks/07-19-advanced-ai-quality/review/verify-1.md:1-137`
- problem: Fixed. Independent verification is recorded with `mission_status: satisfied`; core tests, protocol tests, Engine build, generated-contract check, and real stdio `ai-quality` smoke all exited successfully.
- minimal_fix: Completed by the Verify mission; retain `verify-1.md` with the task artifacts.
- status: fixed

## residual_risks
### V4
- type: residual_risk
- source: `review/verify-1.md` V4
- files: `scripts/engine-smoke.mjs:1962-2027`
- risk: The focused smoke remains thinner than the full acceptance wording: it checks `scores.length >= 2`, one semantic code, and one term candidate, but does not integration-assert exact score-row count, all planted semantic codes, the offline capability string, maximum-candidate truncation, or termbase read-back.
- disposition: Accepted as a non-blocking MVP coverage gap. Unit tests and static/verify evidence cover the implemented behavior; no new issue or verification mission is required for this task.

## assumptions
- `review/verify-1.md` was read in full. Its V1–V3 findings confirm the F1/F2 fixes and close the original F3 evidence gap; V6 is unrelated worktree noise and V5 is not elevated into a release-blocking finding.
- The reviewed fixes are currently uncommitted, as required by the user instruction; closeout/orchestrator must ensure the `ai-quality-core` changes are included before commit/merge.
- No product code was modified by this review.

## summary_for_orchestrator
- Verdict is `green`. F1, F2, and F3 are fixed with focused unit coverage and a satisfied independent verification mission. V4 remains documented only as a residual smoke-assertion risk and does not block closeout. Ready for closeout: **yes**.

## ready_for_closeout
- yes

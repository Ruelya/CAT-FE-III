# Findings round 3

## meta
- task: `.trellis/tasks/07-19-api-cli-automation`
- branch: `task/07-19-api-cli-automation`
- head_sha: `6d38029`
- round: 3
- worktree: uncommitted; unrelated dirty/untracked paths preserved outside this review
- evidence: focused Rust test run and `TRANSLUNAR_SMOKE_SCOPE=api` run completed successfully in the current worktree

## need_verify
- required: false

### Verify mission
- none — the claimed F5/F6 evidence is sufficient and was independently reproduced; no further verification mission is required.

## issues

### F1
- severity: major
- files: `crates/engine/src/local_api.rs`
- problem: Earlier HTTP error responses did not preserve the stable client/Engine error taxonomy.
- minimal_fix: Completed in the prior round; typed request failures and relevant Engine failures now map to stable HTTP status/error codes, with focused regression coverage.
- status: fixed
- evidence: Prior Verify-1 A1/V3 and round-3 focused tests remain green.

### F2
- severity: minor
- files: `crates/engine/src/local_auth.rs`
- problem: Earlier token generation did not meet the 32 random-byte base64url contract.
- minimal_fix: Completed in the prior round; tokens are generated from 32 OS-CSPRNG bytes and validated by decoded length/format.
- status: fixed
- evidence: `generated_token_is_base64url_of_32_csprng_bytes` passed; round-3 run reports 11 focused tests passed.

### F3
- severity: minor
- files: `crates/engine/src/local_auth.rs`
- problem: Earlier test mode was enabled by environment-variable presence rather than the documented exact opt-in.
- minimal_fix: Completed in the prior round; only `TRANSLUNAR_API_TEST_MODE=1` selects the memory backend.
- status: fixed
- evidence: `api_test_mode_only_when_value_is_one` passed in the round-3 focused test run.

### F4
- severity: major
- files: `crates/engine/src/local_auth.rs`, `crates/engine/src/local_api.rs`, `crates/engine/src/bin/translunar.rs`
- problem: Earlier independent evidence was missing for durable CLI rows, token non-persistence, stdio viability, and owned quality gates.
- minimal_fix: Completed in the prior round; the prior Verify-1 report established those runtime and quality-gate results.
- status: fixed
- evidence: Prior Verify-1 A1/A2/A4/A5/A8/A9; no regression observed in the current focused tests/smoke.

### F5
- severity: major
- files: `crates/engine/src/local_auth.rs:130-159`, `scripts/engine-smoke.mjs:2050-2122`
- problem: The API smoke test used an invalid fixed token after token validation was tightened, and invalid test-token injection could previously be swallowed and replaced by a random token, causing a failed/non-deterministic smoke gate.
- minimal_fix: Use a fixed token that decodes to 32 bytes of base64url data and propagate test-token injection errors as an explicit `InvalidRequest` naming `TRANSLUNAR_API_TEST_TOKEN`; retain a unit regression test and rerun the API smoke.
- status: fixed
- evidence: The smoke now uses `BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc` (valid base64url for 32 bytes). `invalid_api_test_token_injection_fails_loudly` passed, and the complete `TRANSLUNAR_SMOKE_SCOPE=api node scripts/engine-smoke.mjs` run exited 0 with `Focused local API/CLI smoke passed.`

### F6
- severity: minor
- files: `scripts/engine-smoke.mjs:2085-2176`
- problem: The API smoke previously checked only the CLI run response and export file, not whether the project/document rows were visible after the CLI process exited.
- minimal_fix: After CLI `run`, use a new CLI process to list projects and a separately spawned `serve` process to list project documents; assert both exact IDs returned by the original run.
- status: fixed
- evidence: Current smoke contains the second-process project ID assertion and the separately served document ID assertion; the complete API smoke passed in the current worktree.

## assumptions
- The round-3 command was run against the current worktree and its existing debug CLI binary; the command itself completed both the 11-test focused suite and the API smoke successfully.
- The `TRANSLUNAR_API_TEST_TOKEN` value is intentionally a deterministic test-only credential under `TRANSLUNAR_API_TEST_MODE=1`; production token storage remains the OS keyring path.
- F1–F4 statuses are carried forward from the complete Verify-1 evidence and round-2 review; this round specifically closes F5/F6.

## residual_risks
- The non-test OS keyring backend was not exercised in this disposable test run. Keyring availability, prompts, and platform-specific behavior remain environment-dependent; the documented memory backend and its failure behavior are covered.

## summary_for_orchestrator
- F5 and F6 are fixed. The valid 32-byte base64url smoke token, loud invalid-injection failure, 11 passing focused unit tests, and a passing `TRANSLUNAR_SMOKE_SCOPE=api` run provide sufficient evidence; the smoke now asserts exact project and document IDs across process boundaries. All tracked review issues F1–F6 are fixed, there are 0 open major/blocker issues, no verification mission remains, and the task is ready for closeout.
- verdict: green
- open_blockers: 0
- open_majors: 0
- open_minors: 0
- needs_evidence: 0
- ready_for_closeout: yes

# Findings round 1

## meta
- task: `.trellis/tasks/07-19-api-cli-automation`
- branch: `task/07-19-api-cli-automation`
- head_sha: `6d380294606fa4c296f4914106283817b02c1e0b`
- round: 1
- worktree: uncommitted

## need_verify
- required: true

### Verify mission
- purpose: Independently establish AC-01 through AC-05 at runtime, especially CLI row durability after process exit and continued stdio viability; the implementation self-check is only a claim, and the current API smoke does not reopen the workspace and assert that the CLI-created project/document still exist.
- questions:
  - Does `translunar serve` bind loopback by default, reject a non-loopback host without `--allow-remote`, leave only `GET /health` public, and return 401 for both missing and invalid bearer tokens on protected routes?
  - With valid auth, can a fresh process create a project, import a fixture, list its document, run document QA, and export a real output file?
  - Does `translunar run` exit successfully after import → QA → export, and can a second process reopen the same `--data-dir` and find the exact returned project/document IDs while the exported file remains present?
  - Do token ensure/rotate/status work with the intended test-memory setup, and are both the ensured and rotated raw tokens absent from `translunar.sqlite3`?
  - Does a disposable stdio engine still complete at least `engine.initialize` plus one protected post-initialize call, and do the owned Rust tests/build/clippy gates pass?
- success_criteria:
  - Default and explicit loopback serving succeeds; non-loopback serving without unsafe opt-in fails before listening; `/health` succeeds without auth while protected routes reject missing and wrong tokens with 401.
  - Authenticated project create/import/document-list/QA/export succeeds and produces an output file.
  - A separate CLI/engine process reopening the workspace returns the same CLI-run project and document IDs, proving durable rows rather than only successful in-process objects.
  - Neither the initial nor rotated token bytes occur in the SQLite file; test-memory behavior matches the documented `TRANSLUNAR_API_TEST_MODE=1` contract.
  - The focused local tests, `translunar` build, API smoke, clippy, and a minimal stdio initialize/use probe complete without product-relevant warnings or failures.
- failure_signals:
  - A non-loopback address listens without `--allow-remote`, health requires auth, or any protected endpoint accepts a missing/wrong token.
  - Any required authenticated workflow route fails, returns a nominal success without an exported file, or produces unstable/misclassified errors relevant to F1.
  - The CLI returns success but a newly opened process cannot find the returned project/document, or SQLite contains either raw token.
  - The API smoke hangs/leaks its server, the stdio probe cannot initialize/use the engine, or focused tests/build/clippy fail for owned code.
- suggested_commands:
  - `cargo test -p translunar-engine --lib local_`
  - `cargo build -p translunar-engine --bin translunar --bin translunar-engine`
  - `TRANSLUNAR_SMOKE_SCOPE=api node scripts/engine-smoke.mjs`
  - `cargo clippy -p translunar-engine --all-targets -- -D warnings`
  - Run `translunar --json run` against a disposable data directory, capture `projectId`/`documentId`, then use a new process (`project list` plus authenticated document list or an equivalent direct probe) to assert those exact IDs; inspect the resulting SQLite bytes for both ensured and rotated test tokens.
- scope: `crates/engine/src/local_auth.rs`, `crates/engine/src/local_api.rs`, `crates/engine/src/bin/translunar.rs`, `crates/engine/src/bin/translunar-engine.rs`, and the `api` scope in `scripts/engine-smoke.mjs`; disposable workspaces only.
- avoid: Full workspace/desktop E2E suites, unrelated plugin/AI/collaboration builds, persistent user keyrings or workspaces, and X-03 through X-07 automation features.
- related_issues: F1, F4

## issues

### F1
- severity: major
- files: `crates/engine/src/local_api.rs:128-203`, `crates/engine/src/local_api.rs:354-381`
- problem: The HTTP adapter does not preserve the stable Engine/protocol error taxonomy required by R2. Typed request decoding uses `serde_json::from_value(...)?`, so a syntactically valid JSON body with missing/wrongly typed fields becomes `EngineError::Json` and is returned as HTTP 500/`internal_error` instead of a 400/`invalid_request`. The mapper also collapses import/export and most storage failures into `internal_error`, rather than aligned codes such as the protocol's document/import/export/storage categories. This makes normal client input failures look like server faults and prevents automation from branching on stable errors.
- minimal_fix: Convert all route DTO deserialization failures to `EngineError::InvalidRequest`, and introduce one exhaustive HTTP status/code mapping aligned with the existing RPC error taxonomy for import, export, storage, QA-gate, not-found, and conflict failures. Add focused HTTP assertions for a malformed typed body and an unsupported/malformed document import (plus one export failure) so they cannot regress to 500/`internal_error`.
- status: open

### F2
- severity: minor
- files: `crates/engine/src/local_auth.rs:15`, `crates/engine/src/local_auth.rs:124-134`, `crates/engine/src/local_auth.rs:170-182`
- problem: The design requires a token made from at least 32 random bytes, but generation concatenates two UUIDv7 values. Their timestamps/version/variant bits are predictable metadata, so the 32-byte buffer is not 32 random bytes; validation also accepts any whitespace-free string of only 24 characters. The effective entropy of generated tokens is still substantial, but it does not meet the explicit credential-generation contract.
- minimal_fix: Fill a 32-byte array directly from the operating system CSPRNG and base64url-encode it; validate configured test tokens against a clearly documented minimum entropy/decoded-byte rule rather than a 24-character length check. Add a deterministic format/decoded-length test without logging the token.
- status: open

### F3
- severity: minor
- files: `crates/engine/src/local_auth.rs:113-121`
- problem: Test mode is enabled by the mere presence of `TRANSLUNAR_API_TEST_MODE`, so values such as `0` or `false` still bypass the OS keyring and select the in-memory backend. The design explicitly defines the opt-in as `TRANSLUNAR_API_TEST_MODE=1`; presence-based behavior makes launcher/CI configuration mistakes surprising and can silently change credential behavior.
- minimal_fix: Enable the memory backend only when the variable equals the documented opt-in value (`1`, with any deliberately supported aliases documented), and add tests proving unset/`0`/`false` do not activate it while `1` does.
- status: open

### F4
- severity: major
- files: `scripts/engine-smoke.mjs:2029-2226`, `crates/engine/src/local_api.rs:512-651`, `crates/engine/src/local_auth.rs:204-224`
- problem: AC-03 and AC-05 still need independent runtime evidence. The smoke captures a CLI-run project ID and checks the output file, but never opens a second process and asserts that the same project/document rows survived; the unit helper assertion remains in-process. The SQLite test checks the originally ensured token after rotation but does not retain and check the rotated token. The claimed test/build/smoke/clippy results and minimal stdio compatibility have no verify report yet.
- minimal_fix: Execute the Verify mission first. If durability/token checks fail or remain unobservable, extend the focused smoke/test to reopen the workspace in a new process, assert the exact CLI summary IDs, and check both pre- and post-rotation secrets; then rerun only the owned gates.
- status: needs_evidence

## assumptions
- `check.jsonl` contains no non-seed research artifact, so review judgment uses the PRD, design, implementation plan, engine-boundary spec, final file state, and worktree diff only.
- The uncommitted final state of the listed API/CLI/auth/smoke files is the review scope even where portions already existed at `HEAD`.
- `--allow-remote` is the explicit unsafe opt-in required by AC-01; retaining bearer authentication after opting in is expected.
- Inline, serialized Engine calls are acceptable for this MVP under R2; no concurrency/async requirement was inferred.

## residual_risks
- X-03 folder watch, X-04 clipboard/global shortcut, X-05 webhooks, X-06 editor/browser plugins, and X-07 third-party connectors are explicitly out of scope and are not defects in this round.
- Remote serving has no TLS; because it requires the explicit unsafe opt-in and still uses bearer auth, this is documented residual risk rather than an AC failure.
- Actual OS-keyring availability and prompts vary by host. Verification should use the memory backend and disposable data; production keyring UX remains environment-dependent.
- The handcrafted HTTP server is single-connection/inline and has limited HTTP feature support. That is acceptable for the stated loopback MVP, but higher concurrency and hardened remote serving would require a later design.

## summary_for_orchestrator
- verdict: need_fix
- open_blockers: 0
- open_majors: 1 (`F1`)
- open_minors: 2 (`F2`, `F3`)
- needs_evidence: 1 major (`F4`)
- ready_for_closeout: false
- summary: The direct EngineService architecture, loopback guard, protected-route auth boundary, API workflow surface, CLI run flow, keyring separation, and untouched stdio dispatcher are structurally present. Closeout is blocked by the major HTTP error-contract defect and by missing independent evidence for durability, token non-persistence across rotation, focused gates, and minimal stdio compatibility. Fix F1-F3, run the selective Verify mission, then resume review with the complete verify report.

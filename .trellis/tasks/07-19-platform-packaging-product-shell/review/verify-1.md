# Verify report round 1

## mission_echo
- purpose: Confirm that the uncommitted Engine allowlist enforcement tests and desktop `policy_denied` presentation changes pass focused runtime/unit validation before this release-blocking task is eligible for closeout.
- questions_addressed:
  - Q1: Do the focused Rust Engine allowlist tests pass for interactive AI, batch AI, and pipeline pretranslation, while preserving stable `policy_denied` behavior and preventing denied starts from creating durable runs or batches?
    - **Yes.** `cargo test -p translunar-engine allowlist --lib` compiled and passed **12/12** tests (0 failed). Product-path coverage includes:
      - `ai::tests::interactive_and_batch_ai_starts_enforce_project_allowlist` — interactive `start_ai_run` and batch `start_ai_batch` return `EngineError::PolicyDenied` with matching `project_id`/`profile_id`; `list_ai_runs` total stays **0**; `list_ai_batches` total stays **0** (“denied batch start must not create a durable batch”).
      - `ai::tests::pipeline_pretranslation_enforces_project_allowlist` — pipeline run terminates `Failed` with step error containing `policy_denied`; no durable AI batch is created.
      - `ai::tests::alignment_refinement_enforces_project_allowlist_before_creating_run` — allowlist gate before alignment refinement run creation.
      - `allowlist::tests::denial_data_shape_is_stable` — denial JSON shape is `{ reason: "policy_denied", projectId, profileId }` and RPC maps to `ErrorCode::PolicyDenied`.
      - Additional unit coverage: empty/exact/unlisted allowlist rules, tightened historical project, missing-project storage error, default empty allowlist, plus related curation/catalog allowlist filters.
  - Q2: Do available focused desktop unit tests for `workbench-utils` and shell-related behavior pass, including localized formatting of structured `policy_denied` errors on Live Assistant and AI Control surfaces?
    - **Yes for the available unit surface.** Focused vitest run of `workbench-utils.test.ts`, `shell-error.test.ts`, and `shell-settings.test.ts` passed **21/21**. The critical product assertion `localizes policy_denied through the product catalog when t is provided` proves:
      - `engineErrorCode` → `"policy_denied"`
      - `engineErrorDataField(..., "profileId")` → profile id
      - without `t`, `formatEngineError` falls back to the protocol message (generic path preserved)
      - with `t`, maps to catalog key `error.allowlistDenied` and interpolates `profileId` (e.g. `denied:prof-2`)
    - Call sites `LiveAssistantPanel.tsx` and `AiControlPage.tsx` both use `formatEngineError(reason, t)`; there is no separate component-level policy_denied test, but the shared formatter unit test plus call-site wiring satisfy the mission’s “available focused unit tests” bar. Broader `pnpm --filter @translunar/desktop test -- workbench-utils|shell` (filter not narrowed by vitest arg shape) also ran the full desktop unit suite **175/175 green**.
  - Q3: If local Engine smoke prerequisites are available, does stdio smoke prove a disallowed profile is rejected with structured project/profile IDs?
    - **Not answered by runtime smoke.** Optional `pnpm test:e2e:engine` **failed before** the allowlist block on an unrelated PDF import (`document.import: no filter matched the source` for `fixtures/pdf/text-layout.pdf`, code `unsupported_document`). The allowlist assertion in `scripts/engine-smoke.mjs` (~stdio `ai.run.start` after tightening `engineAllowlist`) was **not reached**. Per mission success criteria, optional smoke inability does **not** fail the mission when required focused suites are green. Lib tests already cover the same structured denial identity at the Engine service boundary.

## environment
- cwd: `K:\Workbench\CAT`
- branch: `task/07-19-platform-packaging-product-shell`
- head_sha: `3e4dd71` (matches findings meta short sha; working tree still has uncommitted product + review artifacts)
- toolchain: cargo/Rust (Windows), Node v24.17.0, pnpm, vitest 4.1.10
- deviations:
  - Suggested `pnpm --filter @translunar/desktop test -- workbench-utils|shell` invoked the full desktop vitest suite (vitest received `"--"` as a filter token and did not narrow files). Re-ran with explicit paths for a true focused pass.
  - Optional engine smoke attempted; aborted on PDF filter matching, not on allowlist logic.

## actions
### A1
- command: `cargo test -p translunar-engine allowlist --lib`
- exit_code: 0
- duration_note: ~2s after already-warm test build
- log_excerpt: |
    running 12 tests
    test allowlist::tests::configuration_default_has_empty_allowlist ... ok
    test allowlist::tests::denial_data_shape_is_stable ... ok
    test allowlist::tests::existing_project_with_disallowed_profile_cannot_start_new_work ... ok
    test allowlist::tests::exact_profile_id_is_allowed ... ok
    test allowlist::tests::missing_project_surfaces_storage_not_found ... ok
    test allowlist::tests::empty_allowlist_is_permissive ... ok
    test allowlist::tests::unlisted_profile_id_is_denied ... ok
    test ai::tests::interactive_and_batch_ai_starts_enforce_project_allowlist ... ok
    test curation_tests::provider_curation_enforces_project_allowlist ... ok
    test ai::tests::alignment_refinement_enforces_project_allowlist_before_creating_run ... ok
    test ai::tests::pipeline_pretranslation_enforces_project_allowlist ... ok
    test plugin_bundled::tests::verified_release_catalog_lists_allowlisted_packages ... ok
    test result: ok. 12 passed; 0 failed; 0 ignored; 0 measured; 134 filtered out
- interpretation: Required Engine allowlist selection compiles and passes for interactive, batch, and pipeline denial paths with stable `policy_denied` identity and no durable run/batch on deny.

### A2
- command: `pnpm --filter @translunar/desktop test -- workbench-utils`
- exit_code: 0
- duration_note: ~13s
- log_excerpt: |
    Test Files  29 passed (29)
    Tests  175 passed (175)
    ...
    ✓ src/renderer/workbench-utils.test.ts (7 tests)
- interpretation: Desktop unit suite green including workbench-utils policy_denied localization; filter did not isolate file (see A4 for focused re-run).

### A3
- command: `pnpm --filter @translunar/desktop test -- shell`
- exit_code: 0
- duration_note: ~14s
- log_excerpt: |
    Test Files  29 passed (29)
    Tests  175 passed (175)
    ...
    ✓ src/main/shell-settings.test.ts (9 tests)
    ✓ src/renderer/shell-error.test.ts (5 tests)
    ✓ src/renderer/workbench-utils.test.ts (7 tests)
- interpretation: Shell-related unit tests green within the full desktop unit matrix; no product regressions observed.

### A4
- command: `cd apps/desktop && pnpm exec vitest run src/renderer/workbench-utils.test.ts src/renderer/shell-error.test.ts src/main/shell-settings.test.ts`
- exit_code: 0
- duration_note: ~1.7s
- log_excerpt: |
    ✓ src/renderer/shell-error.test.ts (5 tests)
    ✓ src/renderer/workbench-utils.test.ts (7 tests)
    ✓ src/main/shell-settings.test.ts (9 tests)
    Test Files  3 passed (3)
    Tests  21 passed (21)
- interpretation: True focused desktop unit evidence for workbench-utils + shell helpers is green, including structured `policy_denied` localization.

### A5
- command: `pnpm test:e2e:engine`
- exit_code: 1
- duration_note: build ~9s then smoke abort
- log_excerpt: |
    cargo build -p translunar-engine ... Finished `dev` profile
    Error: document.import: no filter matched the source: K:\Workbench\CAT\fixtures\pdf\text-layout.pdf
      code: 'unsupported_document'
- interpretation: Optional stdio smoke did not reach the allowlist assertion. Failure is a PDF document-filter / fixture prerequisite issue, not an allowlist product regression. Documented as unanswered optional Q3 evidence; does not fail the mission under stated success criteria.

## findings_for_reviewer
### V1
- severity: info
- related_review_ids: F1
- title: Focused Engine allowlist and desktop policy_denied unit evidence is green
- evidence: `cargo test -p translunar-engine allowlist --lib` 12/12; vitest `workbench-utils.test.ts` policy_denied case; `ai.rs` assertions that denied interactive/batch starts leave run/batch totals at 0
- detail: F1 was evidence-only (`needs_evidence`). Required mission suites now demonstrate compile+runtime pass for release-blocking allowlist paths and desktop localization of structured denials. No product defect observed in scoped verification.
- suggested_next: review can clear F1 evidence gate; commit uncommitted allowlist/desktop changes when quality loop accepts

### V2
- severity: noise
- related_review_ids: new
- title: Optional engine smoke aborted on PDF import before allowlist block
- evidence: `scripts/engine-smoke.mjs` / `fixtures/pdf/text-layout.pdf` → `unsupported_document` / “no filter matched the source”
- detail: Local optional smoke prerequisites incomplete or PDF filter path unavailable in this environment. Allowlist stdio assertion not executed. Out of mission hard requirements; residual risk only if reviewers demand end-to-end stdio proof beyond lib tests.
- suggested_next: out_of_scope for this allowlist mission unless CI smoke is required; if pursued, fix PDF filter registration / fixture packaging and re-run smoke to the allowlist section only

### V3
- severity: info
- related_review_ids: new
- title: pnpm desktop test filter args did not narrow vitest file selection
- evidence: `vitest run "--" "workbench-utils"` executed all 29 desktop unit files
- detail: Harmless for this mission (full suite also green); for future verify, prefer `pnpm exec vitest run <path>` under `apps/desktop`.
- suggested_next: out_of_scope (process note only)

## unanswered
- Stdio smoke allowlist assertion (Q3 optional): not observed because smoke died earlier on PDF import. Lib-level interactive/batch/pipeline denials already cover the same Engine boundary behavior with structured `policy_denied` + project/profile ids.
- Component-level UI snapshot that Live Assistant / AI Control **render** the localized string after a live Engine denial is not covered by unit tests (only shared `formatEngineError` + call-site usage). Mission asked for available unit tests; that bar is met.

## overall
- mission_status: satisfied
- summary_for_reviewer: Required focused evidence for F1 is in place. Engine allowlist filter `allowlist` is fully green for interactive, batch, pipeline (and related) denial paths with stable `policy_denied` shape and no durable run/batch on deny. Desktop `workbench-utils` unit test proves catalog localization of `policy_denied` via `error.allowlistDenied` with profileId interpolation without breaking generic formatting; Live Assistant and AI Control already call `formatEngineError(..., t)`. Optional stdio smoke failed for an unrelated PDF import prerequisite and did not exercise the allowlist block; that optional gap is documented and non-blocking per mission criteria. No product-code failures in scoped verification.
- recommended_review_focus: Treat F1 as evidence-satisfied unless review insists on stdio smoke; decide whether V2 PDF smoke breakage is residual platform noise vs a separate task. Uncommitted files under `crates/engine` and `apps/desktop` remain the commit surface once review closes.

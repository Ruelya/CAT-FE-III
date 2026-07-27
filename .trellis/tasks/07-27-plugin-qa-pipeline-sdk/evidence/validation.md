# Validation Evidence: Public Plugin QA And Pipeline SDK

## Acceptance Criteria

| Criterion | Evidence | Result |
| --- | --- | --- |
| AC-01 | `translunar-plugin-runtime` `qa_pipeline` contract tests; SDK `qa-pipeline.test.ts`; shared `fixtures/plugins/qa-pipeline-contract-v1.json`; generated contract drift check | Pass |
| AC-02 | Engine plugin lifecycle suite, including `declarative_toolkit_runs_without_a_process_and_survives_restart`, `sandbox_toolkit_uses_bounded_runtime_and_detaches_cleanly`, `fatal_process_pipeline_failure_detaches_exact_generation_contributions`, exact filter/connector lease replacement tests, and process degradation | Pass |
| AC-03 | Engine QA executor/registry tests, storage QA transaction tests, Tier 1/Tier 2/Tier 3 focused smoke, and desktop QA provenance flow | Pass |
| AC-04 | Pipeline crate suite; Engine pipeline suite; `process_pipeline_cancel_kills_uncooperative_child_and_recycles`; `fatal_process_pipeline_failure_detaches_exact_generation_contributions`; focused real-Engine smoke proving Tier 2/Tier 3 execution, checkpointing, typed fatal failure, degradation, recovery, and later Engine health | Pass |
| AC-05 | `process_upgrade_rejects_qa_and_pipeline_collisions_before_version_cas`, `process_upgrade_preflights_pipeline_artifacts_and_stored_config`, `process_upgrade_preflight_failure_keeps_active_generation_unchanged`, restoration/degraded fallback, checkpoint migration, compatible-generation resume, grant-carry, scope-expansion, upgrade, and rollback tests | Pass |
| AC-06 | Capability audit tests; sanitized failed QA/pipeline storage tests; bounded diagnostics tests; focused smoke rejects fixture secret/source/target/raw-payload leakage | Pass |
| AC-07 | `examples/plugins/qa-pipeline-process`, `fixtures/plugins/qa-pipeline-sandbox`, SDK build/tests, and focused real-Engine lifecycle smoke using normal inspect/install/grant/enable/run/restart/disable/uninstall paths | Pass |
| AC-08 | Generated Rust-to-TypeScript contracts, 168 desktop unit tests, real Electron lifecycle E2E, Plugins inventory, QA provenance, and pipeline history projections | Pass |
| AC-09 | Six screenshots at 1250x744, 1680x942, and 1920x1080 for Plugins inventory and QA provenance; Electron geometry/accessibility suite passed. No page-level overlap, clipping, or uncontrolled horizontal overflow was observed. The intentionally scrollable Project Insights tab strip and broader visual-design divergence remain recorded as product follow-up, not hidden as a functional failure. | Pass with documented visual follow-up |
| AC-10 | Format, lint, typecheck, contracts, docs, SDK, desktop build, full workspace tests, focused Engine smoke, and Electron E2E passed. The unscoped Engine smoke is externally blocked before this feature's flow because the host lacks three PDF/OCR executables; exact evidence is below. | Pass for task scope; environment exception recorded |

## Commands And Results

Passed:

```text
pnpm format:check
pnpm lint
pnpm typecheck
pnpm contracts:check
pnpm docs:check
pnpm test
pnpm --filter @translunar/plugin-sdk typecheck
pnpm --filter @translunar/plugin-sdk test                 # 2 files, 30 tests
pnpm --filter @translunar/desktop build
cargo test -p translunar-plugin-runtime qa_pipeline       # 7 passed
cargo test -p translunar-pipeline -p translunar-storage   # 7 + 110 passed
cargo test -p translunar-engine plugin::tests             # 25 passed
cargo test -p translunar-ai-core connector::tests         # 22 passed
cargo test -p translunar-filter-core                      # 4 passed
cargo test -p translunar-engine qa                        # 10 passed
cargo test -p translunar-engine pipeline                  # 9 passed
cargo test -p translunar-engine plugin_checkpoint_migration_is_recorded_before_resume
$env:TRANSLUNAR_SMOKE_SCOPE='qa-pipeline'; pnpm test:e2e:engine
pnpm test:e2e:desktop                                     # 32 passed, 1 skipped
```

`pnpm test` passed the Node/Electron toolchain suite, 30 SDK tests, 168 desktop
tests, 121 Engine tests, 110 storage tests, every other Rust workspace test,
and all doc tests. Strict
Clippy is included in `pnpm lint` and passed with `-D warnings`.

The unscoped `pnpm test:e2e:engine` was attempted and stopped at the unrelated
PDF import flow with:

```text
document.import: no filter matched the source: fixtures/pdf/text-layout.pdf
code: unsupported_document
```

Host tool inspection found `pdftotext.exe` only. `pdfinfo`, `pdftoppm`, and
`tesseract` are absent, so the PDF filter correctly does not register. The
task-owned `qa-pipeline` Engine smoke passes on the same build and exercises the
complete public QA/pipeline lifecycle.

## Visual Evidence

- `evidence/screenshots/plugin-qa-pipeline-inventory-1250x744.png`
- `evidence/screenshots/plugin-qa-pipeline-inventory-1680x942.png`
- `evidence/screenshots/plugin-qa-pipeline-inventory-1920x1080.png`
- `evidence/screenshots/plugin-qa-provenance-1250x744.png`
- `evidence/screenshots/plugin-qa-provenance-1680x942.png`
- `evidence/screenshots/plugin-qa-provenance-1920x1080.png`

Manual inspection confirms controls remain visible and operable at all three
sizes. It also confirms that the current application is materially less dense
and less compositionally faithful than `docs/stitch/DESIGN.md`; that deviation
is described in the project walkthrough and final task report.

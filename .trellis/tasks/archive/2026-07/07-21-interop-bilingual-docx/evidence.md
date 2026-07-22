# Acceptance Evidence: Bilingual DOCX And Table Interchange

Recorded on 2026-07-22 against the combined task worktree. Rust verification
ran in the isolated VPS workspace
`/home/ubuntu/workspaces/cat-interop-20260721`; desktop verification used Node
22.17.0 and the synchronized Windows GNU release Engine.

## Acceptance Matrix

| Criterion | Executable evidence |
| --- | --- |
| AC1 | `review::tests::builds_and_reparses_three_column_review_with_stable_manifest_hash`, `target_and_comment_edits_do_not_change_manifest_digest`, `export_is_no_clobber`, Engine review round trip, and stdio review export/preview prove three columns, visible status/comments, opaque IDs, canonical digest, reparse, and no overwrite. |
| AC2 | Engine tests assert `changed`, `unchanged`, `missing`, `added`, and `invalid`. Codec tests reject duplicate row/bookmark identities and malformed/unclosed XML and diagnose missing markers/source tamper. Engine and smoke stale/tamper cases leave no preview or review persistence. |
| AC3 | Engine/storage review tests apply one selected changed row, persist exactly one review/comment and operation across restart, return the same terminal result on retry, and leave unselected/invalid/added rows untouched. |
| AC4 | Focused DOCX/XLSX bilingual filter tests cover headers, multi-run/shared/inline strings, extra metadata, formula rejection, target-only rewrite, no-clobber, and opaque-part raw copy. Engine generic-filter coverage proves ordinary DOCX/XLSX compatibility. |
| AC5 | Engine table preview tests assert writable/locale validation before staging, raw source rows, structural paths, stable IDs, metadata, valid/duplicate diagnostics, and selected apply. Storage tests assert provenance plus atomic malformed-row rollback and explicit stale/read-only no-write paths. |
| AC6 | Full Rust workspace tests, strict Clippy, real stdio smoke, generated-contract equality, Windows GNU release build, restart/idempotence assertions, and malformed staging cleanup all pass. |
| AC7 | Real-Engine Electron E2E exports and rewrites a review DOCX, verifies `unchanged`, `unchanged`, `changed`, applies one review proposal, previews/applies two XLSX rows, displays raw row 2, and asserts terminal UI, no duplicate empty state, no overflow, and no console/page errors. |

## Final Rust And Process Gate

The final post-audit code passed:

```text
cargo fmt --all -- --check
cargo test -p translunar-filter-office-core -p translunar-filter-interop \
  -p translunar-engine -p translunar-storage
  -> Engine 31, interop 20, Office core 6, storage 39 passed
cargo test --workspace
  -> all workspace unit, binary, and doc tests passed
cargo clippy --workspace --all-targets -- -D warnings
node scripts/engine-smoke.mjs
  -> Engine smoke passed
cargo build -p translunar-engine --release --target x86_64-pc-windows-gnu
```

The final Windows GNU binary is
`.local-cache/translunar-engine-interop-20260722-final.exe`, SHA-256
`DD57D60648C12F0CC9CE8FBC26CE50DE6D743D265BC3DFE0666481FF614231ED`.

The audit added these focused regressions:

```text
filter-office-core::rejects_unclosed_missing_and_multiple_xml_roots
filter-interop::duplicate_missing_and_malformed_review_markers_are_rejected_or_diagnosed
engine::interop_review_classifies_missing_and_added_rows
engine::interop_table_preview_requires_writable_locale_matching_library
storage::interop_table_apply_rejects_stale_and_read_only_libraries_without_writes
```

## Contracts And Desktop Gate

The Node 22 verification chain passed:

```text
pnpm contracts:check
Rust schema and generated TypeScript byte equality
pnpm typecheck
pnpm exec eslint apps packages/contracts/src
pnpm -r --if-present test
  -> 5 files, 17 tests passed
scoped Prettier check
pnpm --filter @translunar/desktop test:e2e
  -> 9 passed, 1 PDF prerequisite skip (`TRANSLUNAR_PDF_E2E` unset)
focused final-binary interop E2E
  -> 1 passed
```

The final Electron run used the refreshed Engine above. Screenshots at
1250x744, 1680x942, and 1920x1080 were inspected from
`C:\Users\Cloud\AppData\Local\Temp\cat-interop-screens`; preview rows and
controls were non-overlapping and horizontally contained.

## Failure And Rollback Evidence

- Review destination no-clobber preserves the existing bytes.
- Stale segment/document review input creates no durable preview, review,
  comment, workflow transition, or operation.
- Source tamper stays visible as `invalid`; duplicate identities, invalid
  digest, and malformed XML/ZIP fail parsing and clean staging.
- Formula/malformed table input creates no preview and cleans staging.
- Malformed accepted metadata rolls back every selected TM insert and the
  library revision.
- Stale and read-only libraries leave TM counts/revisions unchanged and keep
  their previews open for deliberate resolution.
- Review/table retries after restart return the recorded terminal result and
  do not duplicate reviews, comments, or TM units.

## Environment Note

Local MSVC Rust linking remains unavailable because Git's Unix `link.exe`
shadows the MSVC linker and interprets Rust's `/NOLOGO` arguments as Unix
operands. Local `cargo fmt` passes; compilation, strict Clippy, workspace tests,
stdio smoke, schema generation, and Windows GNU release linking were therefore
run on the isolated VPS. This is an environment limitation, not a task failure.

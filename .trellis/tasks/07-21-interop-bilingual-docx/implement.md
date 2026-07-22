# Implementation Plan: Bilingual DOCX And Table Interchange

## Ordered Checklist

- [x] Add the append-only migration and Store projections for durable review
      and table previews, including expected revision, terminal status, row
      disposition, and cleanup/reopen behavior.
- [x] Add pure bounded bilingual-row codecs to `filter-docx` and `filter-xlsx`;
      cover headers, multi-run text, shared/inline strings, formulas, extra
      metadata columns, structural paths, malformed packages, and raw-copy
      preservation.
- [x] Add the review-package builder/parser to `filter-interop`: three visible
      columns, bookmark markers, canonical manifest hash, source hash checks,
      comments/status context, package limits, reparse, and no-clobber export.
- [x] Add protocol structs, method catalog entries, stable error mapping, and
      Engine service methods for review export/preview/apply and table
      preview/apply. Regenerate JSON Schema and TypeScript contracts.
- [x] Implement one-transaction review apply using existing review/comment/
      workflow primitives and one-transaction TM apply with row provenance,
      library revision checks, duplicate handling, and idempotence.
- [x] Register explicit `builtin.bilingual-docx` and
      `builtin.bilingual-xlsx` modes without changing ordinary DOCX/XLSX probe
      selection; add filter-list and generic import/export coverage.
- [x] Extend stdio smoke through review export/edit/preview/apply/restart,
      source tamper/stale/no-clobber, table preview/selection/apply/rollback,
      and malformed package cleanup.
- [x] Add desktop Interop review/table orchestration with trusted dialogs,
      paginated accessible preview rows, selection, typed errors, busy states,
      save-before-navigation, and real-engine E2E at supported viewports.
- [x] Update backend/frontend specs with verified contracts and exact evidence;
      run the full local/VPS quality gates before the child commit gate.

## Data-Flow Review Checklist

- [x] File dialog -> generated RPC -> Engine -> codec -> Store transaction is
      mapped for each operation.
- [x] Manifest and row hashes are canonicalized in one Rust owner.
- [x] Current segment/library revisions are checked at both preview and apply.
- [x] Renderer consumes generated types and never parses package bytes.
- [x] Every failure path leaves SQLite, managed sources, TM rows, and output
      destinations unchanged.

## Risk Files

`crates/protocol/src/lib.rs`, `crates/storage/src/migrations.rs`,
`crates/storage/src/store.rs`, `crates/engine/src/lib.rs`,
`crates/filter-interop/src/lib.rs`, `crates/filter-docx/src/lib.rs`,
`crates/filter-xlsx/src/lib.rs`, generated `packages/contracts/src/*`,
`apps/desktop/src/renderer/WorkbenchPages.tsx`, new interop surface files,
`scripts/engine-smoke.mjs`, and backend/frontend specs.

## Validation Commands

Focused:

```text
cargo fmt --all -- --check
cargo test -p translunar-filter-docx -p translunar-filter-xlsx -p translunar-filter-interop
cargo test -p translunar-storage -p translunar-protocol -p translunar-engine
```

Cross-layer:

```text
pnpm contracts:check
pnpm exec eslint apps packages/contracts/src
pnpm typecheck
pnpm -r --if-present test
pnpm build:desktop
node scripts/engine-smoke.mjs
pnpm --filter @translunar/desktop test:e2e
```

VPS/release:

```text
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
cargo build -p translunar-engine
cargo build -p translunar-engine --release --target x86_64-pc-windows-gnu
```

## Acceptance Evidence To Record

- Manifest canonicalization/hash vectors and Word round-trip fixtures.
- Changed/unchanged/missing/added/invalid matrix, including tamper and stale
  conflicts with unchanged row counts and revisions.
- Atomic review/TM rollback and restart/idempotence assertions.
- DOCX/XLSX opaque-part hashes before/after generic export.
- Contract/schema byte equality, smoke output, desktop E2E result, and any
  full-tree formatting caveat unrelated to this child.

## Rollback Points

- Keep new RPCs unregistered until codec and migration tests pass.
- Do not alter ordinary `builtin.docx`/`builtin.xlsx` probe behavior to make
  bilingual fixtures select automatically.
- If review apply cannot preserve a status/comment construct, report a typed
  invalid/degradation row and apply no selected rows rather than guessing.
- Failed staging or transaction cleanup must leave open previews retryable and
  existing destinations/TM rows untouched.

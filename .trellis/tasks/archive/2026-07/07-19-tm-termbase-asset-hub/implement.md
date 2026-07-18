# Implementation Plan: TM And Termbase Asset Hub

## Preconditions

- Core v2 task is archived and schema/protocol conventions are current.
- Read backend engine/database/error/quality specs and cross-layer guide before
  each migration or protocol batch.
- Preserve old TM tables and methods until compatibility tests pass.

## 1. Asset Core Contracts

- [x] Add `crates/asset-core` with serializable library/unit/term records,
      normalization, placeholder extraction, CJK fuzzy scoring, and bounded
      deterministic ranking tests.
- [x] Add RFC-4180 CSV/TSV, TMX 1.4b, and TBX-Basic codecs with malformed-input
      diagnostics and round-trip fixtures.
- [x] Gate: asset-core unit tests, strict clippy, and codec fixture tests.

## 2. Schema And Repositories

- [x] Add migration 4 for TM libraries/mounts/units and termbases/entries.
- [x] Backfill schema-v3 memories and entries without losing provenance; create
      default project mounts atomically for fresh projects.
- [x] Implement paged library/mount/unit/termbase/term repositories, metadata
      filters, and optimistic mount transitions.
- [x] Gate: fresh database, migration upgrade/rollback backup, FK/unique checks,
      deterministic pages, and restart round trips.

## 3. Matching, Concordance, And Sinking

- [x] Implement exact/101%/fuzzy/CJK search, configurable thresholds, numeric
      and placeholder substitutions, metadata filters, and concordance pages.
- [x] Extend confirm/QA transactions for idempotent multi-library sinking and
      forbidden-term issue reconciliation.
- [x] Gate: two reference + one writable mount, read-only rejection, CJK score
      ranking, context match, duplicate sink, and forbidden QA tests.

## 4. Exchange Services And Protocol

- [x] Add engine file-flow services for TMX/CSV and TBX/CSV import/export with
      staged publication and typed row diagnostics.
- [x] Add generated protocol params/results/catalog entries and capability
      strings for library, search, concordance, term, and exchange methods.
- [x] Keep `tm.lookupExact` and legacy confirmation response behavior unchanged.
- [x] Gate: JSON Schema/TypeScript drift, unknown-ID/error mapping, malformed
      input rollback, and protocol round trips.

## 5. Client And Qualification

- [x] Expose only additive asset calls through the existing preload method map;
      do not duplicate matching or SQLite rules in React.
- [x] Extend `scripts/engine-smoke.mjs` with library mounts, fuzzy/context
      search, term recognition, TMX/CSV/TBX/CSV round trips, concordance, and
      confirmation sinking.
- [x] Run local ESLint/typecheck/Vitest/desktop build and E2E; run VPS fmt,
      clippy, tests, smoke, and a bounded asset search benchmark.
- [x] Update backend/frontend specs with finalized asset contracts, commit,
      archive this child, and continue to `07-19-text-html-xliff-srx`.

## Validation Commands

```powershell
$env:PATH='K:\Software\cursor\resources\app\resources\helpers;' + $env:PATH
pnpm contracts:check
pnpm exec eslint apps packages/contracts/src
pnpm typecheck
pnpm --filter @translunar/desktop test
pnpm --filter @translunar/desktop test:e2e
```

```bash
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
node scripts/engine-smoke.mjs
```

## Rollback Points

- Before migration 4: remove asset-core/protocol wiring without changing the
  schema-v3 database.
- After migration 4: use the automatic pre-migration backup; never delete or
  rewrite legacy TM rows during rollback.
- Before capability advertisement: keep new methods hidden while legacy exact
  lookup and confirmation tests remain the compatibility fallback.

## Verification Evidence

- VPS: `cargo fmt --all -- --check`, strict workspace clippy, and all workspace
  tests passed.
- VPS stdio smoke passed library lifecycle, CSV/TMX/TBX exchange,
  concordance, exact/context search, forbidden QA, restart, legacy TM, DOCX
  export, health, and backup.
- The disposable release benchmark measured 100,000 segments and 100,000 TM
  units: exact search 331 ms, fuzzy search 360 ms, peak RSS 42,912 KiB.
- Local ESLint, TypeScript, 8 Vitest tests, production desktop build, and
  Electron E2E (3/3) passed with the VPS cross-built Windows GNU engine.
- The VPS-generated schema SHA-256
  `caadf13bb7f7e5b8ad5ed9168bdc24a239a3790b94804339cc5c60f07ffca75c`
  matches the committed local schema. Local `pnpm contracts:check` remains
  unavailable because this workstation resolves GNU `link.exe` instead of the
  MSVC Windows SDK linker; schema generation and local json2ts comparison were
  performed separately.

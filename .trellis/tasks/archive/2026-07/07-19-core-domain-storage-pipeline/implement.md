# Implementation Plan: Core Domain, Storage, And Pipeline v2

## Preconditions

- Preserve migration 1 and the legacy protocol/DOCX entry points.
- Load backend specs and cross-layer guide before every protocol/schema batch.
- Keep the workspace buildable at each numbered checkpoint.
- Run Rust compile/test on `ssh moehub`; regenerate contracts and run Electron
  checks locally with supported Node 22.

## 1. Contract And Crate Skeleton

- [x] Add `crates/filter-core` and `crates/pipeline` to the workspace with
      typed errors, descriptors, registries, and focused unit tests.
- [x] Move/bridge the existing filter events and collector from `domain` into
      `filter-core` without changing DOCX behavior.
- [x] Extend domain values for project/document versions, lifecycle, tags,
      operations, health, backup manifests, and pipeline records.
- [x] Convert `filter-docx` to the registry contract and retain its current
      extraction/export fixture tests.
- [x] Gate: fmt, strict clippy, domain/filter/pipeline/DOCX tests.

## 2. Storage Migrations And Repositories

- [x] Add migration 2 for lifecycle/document versions/tags/operations and
      migration 3 for pipeline definitions/runs.
- [x] Implement pre-migration online backup and manifest generation before any
      pending migration executes.
- [x] Backfill schema-v1 rows and add fixture-based equality/export tests.
- [x] Add row codecs and repositories for project/document pages, versions,
      tags, operations, pipeline definitions, runs, and step runs.
- [x] Add optimistic project/run transitions, deterministic pages, and atomic
      operation recording for project/segment writes.
- [x] Recover orphaned pipeline work as interrupted on startup.
- [x] Gate: fresh database, v1 upgrade, failed migration, stale write,
      rollback, restart, and foreign-key tests.

## 3. Generic Filter Service

- [x] Add engine-owned filter registry with built-in DOCX registration and
      capability listing.
- [x] Implement generic import: path/relative-path validation, probe/explicit
      selection, streaming validation, managed version copy, transactional
      persistence, and cleanup on failure.
- [x] Implement generic export: stored filter selection, current version/tags,
      temporary output, validation, and atomic publish.
- [x] Delegate legacy DOCX methods to the generic service and prove response
      compatibility.
- [x] Add same-basename/different-relative-path multi-document process test.
- [x] Gate: filter registry/event failures, import rollback, multi-file restart,
      generic + legacy export structural validation.

## 4. Pipeline Runtime

- [x] Implement definition validation and persistence protocol services.
- [x] Implement run/step state transitions with expected revisions,
      checkpoints, cancellation flag, progress, and restart interruption.
- [x] Implement `PipelineManager` background workers with per-worker stores and
      durable polling; ensure dispatcher returns the queued run immediately.
- [x] Register and test `core.checkpoint` and `core.qa.document` steps.
- [x] Implement list/get/cancel/resume methods and typed invalid-transition
      errors.
- [x] Gate: successful real QA run, immediate-return assertion, cancellation,
      restart interruption, resumable checkpoint, and non-resumable failure.

## 5. History, Health, And Backup

- [x] Expose paged history and prove mutation+operation atomicity.
- [x] Implement read-only SQLite/row/version/file health diagnostics with typed
      findings and content redaction.
- [x] Implement staged explicit backup with SQLite snapshot, managed files,
      hashes, manifest, verification, and no-overwrite publication.
- [x] Restore a backup into a separate data directory in an integration test;
      compare counts/history and export output.
- [x] Gate: clean/missing-file/broken-link/FK findings and backup failure
      cleanup tests.

## 6. Protocol And Client Compatibility

- [x] Add all approved method constants, params/results, catalog entries, stable
      error mapping, page validation, and capability strings.
- [x] Regenerate JSON Schema and TypeScript contracts; do not hand-edit output.
- [x] Update engine smoke to cover v1 upgrade, multi-document, history, filter,
      pipeline, health, and backup while retaining the original flow.
- [x] Update Electron code only where additive generated fields require it; do
      not add domain logic to renderer/main.
- [x] Gate: contracts drift, ESLint, TypeScript, Vitest, production desktop
      build, existing Electron E2E.

## 7. Capacity And Final Qualification

- [x] Add a deterministic 100k-segment fixture/benchmark command that avoids
      shipping the generated database.
- [x] Measure open/count/first-middle-last page/history page and peak-process
      memory on VPS; write results under task research.
- [x] Run full local frontend gate and full VPS Rust fmt/clippy/test/process
      gate from a clean synchronized source tree.
- [x] Re-run schema-v1 DOCX recovery/export and desktop screenshots to catch
      compatibility regressions.
- [x] Update backend specs for the finalized schema, filter, pipeline, history,
      health, and backup contracts.
- [x] Commit the implementation, archive this child, update parent progress,
      then activate `07-19-tm-termbase-asset-hub`.

## Validation Commands

```powershell
$env:PATH='K:\Software\cursor\resources\app\resources\helpers;' + $env:PATH
pnpm contracts:generate
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

- After section 1: revert new crate wiring without touching persisted data.
- After section 2: restore a pre-migration backup; never author a destructive
  down-migration.
- After section 3: keep generic methods unadvertised while legacy DOCX remains.
- After section 4: disable pipeline capability registration without changing
  completed run/history rows.
- Backup/health operations are additive and must never mutate active user data.

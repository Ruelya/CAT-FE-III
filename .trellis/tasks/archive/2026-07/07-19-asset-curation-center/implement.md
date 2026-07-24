# Implementation Plan: Asset Curation Center

## Preconditions and gates

- [x] Confirm the PRD/design convergence pass and preserve unrelated dirty
      worktree paths.
- [x] Read the backend database/engine/error/quality guides, frontend
      component/state/type/quality guides, and the cross-layer thinking guide.
- [x] Keep `Workbench.tsx`, shared `styles.css`, visual-polish/identity task
      files, and generated Trellis/toolchain files out of this child.

## Ordered implementation

### 1. Pure curation core

- [x] Add `crates/curation-core` to the workspace with bounded serializable
      input/output types, rule IDs, finding evidence, score calculation,
      duplicate/near-duplicate grouping, locale/script checks, term mining,
      drift grouping, and JSONL/TSV row conversion.
- [x] Add deterministic fixtures for duplicate, source=target, wrong-language,
      number/date/placeholder, length, drift, and high-quality preservation.
- [x] Gate: `cargo test -p translunar-curation-core` and strict Clippy.

### 2. Migration and storage projections

- [x] Add migration 15 with curation columns, runs, findings, and changes;
      cover fresh install, v14 upgrade, strict checks, reopen, and rollback on
      a late failing statement.
- [x] Extend TM row readers/writers and import/confirmation inserts with safe
      defaults. Add bounded catalog queries across TM, termbase, and corpus.
- [x] Implement run creation/get/finding pages, atomic apply, exact-image
      rollback, operation history, stale/no-clobber tests, and restart tests.
- [x] Gate: storage unit tests, migration tests, and a 10,000-unit disposable
      analysis benchmark.

### 3. Protocol and Engine

- [x] Add Rust protocol params/results/method constants/catalog entries,
      generate schema/TypeScript, and map typed errors/capabilities.
- [x] Add Engine catalog, analyze, finding, apply, rollback, and export services;
      validate optional provider responses and publish files atomically.
- [x] Extend `scripts/engine-smoke.mjs` with a dirty-fixture lifecycle,
      malformed/stale/zero-write paths, restart, rollback, and JSONL/TSV export.
- [x] Gate: `pnpm contracts:check`, Engine unit/integration tests, and smoke.

### 4. Desktop surface

- [x] Add `AssetCurationPanel.tsx` plus focused styles and utility tests; add an
      Assets tab to `ProjectInsightsPage` without changing unrelated visual
      files.
- [x] Use generated contracts, page-owned RPC orchestration, explicit loading/
      empty/error/stale/terminal states, accessible labels, bounded evidence,
      and revision-safe refresh after mutations.
- [x] Gate: ESLint, strict typecheck, focused Vitest, production build, and
      real-Engine Electron E2E at the supported viewports with overflow,
      overlap, accessibility, and console/page-error assertions.

### 5. Quality and handoff

- [x] Run full backend/frontend package quality checks and inspect all changed
      files for scope drift.
- [x] Load `trellis-check` guidance for the full cross-layer review; fix all
      findings and repeat the gates.
- [x] Load `trellis-update-spec`; record durable curation and desktop IPC
      conventions in the backend/frontend code-specs.
- [x] Prepare a batched commit plan containing only task-owned files; the user
      already authorized the task commit before this final quality pass.

## Validation commands

```powershell
pnpm contracts:check
pnpm lint
pnpm typecheck
pnpm test
pnpm --filter @translunar/desktop test
pnpm --filter @translunar/desktop build
pnpm test:e2e:engine
```

```bash
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
node scripts/engine-smoke.mjs
```

## Risk and rollback points

- Before migration 15, remove pure/protocol scaffolding without changing
  existing schemas.
- After migration 15, use the automatic pre-migration backup; never delete or
  rewrite migration 1-14 statements.
- Before applying curation, keep all runs preview-only. If stale checks or
  before-image tests fail, disable apply/rollback capability advertisement and
  retain catalog/analyze read paths.
- If the desktop surface conflicts with unrelated visual work, keep it as a
  separate panel/style file and do not resolve the unrelated worktree changes.

## Verification evidence (2026-07-24)

### Local Windows

- `pnpm contracts:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, and
  `pnpm --filter @translunar/desktop build` passed. Desktop Vitest reported 31
  passing tests; the Rust workspace passed after one isolated rerun of the
  pre-existing timing-sensitive pipeline cancellation test.
- `cargo fmt --all -- --check`,
  `cargo clippy --workspace --all-targets -- -D warnings`, and
  `cargo test --workspace` passed. Focused curation-core, storage, and Engine
  curation suites passed independently.
- `pnpm test:e2e:desktop` passed 13 real-Engine Electron tests with one
  conditional PDF/OCR test skipped. The focused curation test covered catalog
  filtering, stale conflict/error-code preservation, refresh, apply, restart,
  JSONL export, rollback, restart, accessibility, three viewports, overflow/
  heading overlap, and console/page errors.
- `cargo run -p translunar-curation-core --bin curation_benchmark` analyzed
  10,000 units in 3,857 ms. Windows does not expose `/proc/self/status`, so the
  cross-platform peak-memory evidence comes from the VPS run below.
- The local default full smoke cannot import the PDF fixture because
  `pdfinfo`, `pdftoppm`, and `tesseract` are not installed. The focused
  curation smoke passed locally; the complete smoke passed on the equipped VPS.
- Local Node is 24.17.0 while the repository-supported range is Node 22.17.x
  through 22.x. pnpm 10.18.3 emitted the expected engine warning; all commands
  above still completed successfully.

### VPS `moehub` (Linux aarch64)

- Current source was copied to an isolated temporary directory. Remote
  `cargo fmt --all -- --check`, strict workspace Clippy, and
  `cargo test --workspace` passed with Rust 1.97.1.
- The unscoped `node scripts/engine-smoke.mjs` passed against the freshly built
  Engine with PDF/OCR tools present, covering the legacy/full format flow and
  the complete curation lifecycle.
- The 10,000-unit curation benchmark completed in 8,314 ms with
  `peakRssKib: 21928`, 10,000 scores, 476 bounded findings, and no term/drift
  groups for the unique-source fixture.

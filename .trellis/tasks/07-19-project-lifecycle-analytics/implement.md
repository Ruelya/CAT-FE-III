# Implementation Plan: Project Lifecycle And Analytics

## Preconditions

- QA/review migration 9 and generated protocol are committed and green.
- Use Codex inline mode and read backend Engine/database/error/quality plus
  frontend Electron/state/type/accessibility specs before editing.
- Preserve migrations 1..9 and existing single-document/backup contracts.

## 1. Lifecycle Core And Storage

- [ ] Add lifecycle-core models and deterministic re-import matching,
      word/CJK/repetition counting, weighting and archive manifests.
- [ ] Add migration 10 tables/indexes/default analysis profile and fresh/
      upgrade/rollback/reopen coverage.
- [ ] Implement template CRUD/resolution, document versions/re-import apply,
      recycle/history, search reconciliation and analysis/analytics queries.

## 2. Engine And Protocol

- [ ] Add batch file/folder discovery/import with bounded diagnostics and
      preserved relative paths; retain legacy imports.
- [ ] Add template, re-import preview/apply, archive export/restore, recycle,
      history, search, analysis and analytics RPC/capability contracts.
- [ ] Implement versioned hash-validated no-clobber project archives and atomic
      restore without credentials/shared external asset leakage.

## 3. Desktop

- [ ] Build three-step setup and project home with multi-file progress,
      add-file/folder/drag-drop diagnostics and recent/lifecycle actions.
- [ ] Build templates, re-import preview, archive/restore, recycle/history and
      global search with direct project/document/segment navigation.
- [ ] Build analysis/weighted effort/progress/productivity/AI/asset views with
      unavailable/stale states and no billing semantics.

## 4. Integration And Finish

- [ ] Extend storage/Engine tests and stdio smoke through multi-file/template/
      re-import/search/analysis/recycle/archive/restart flows.
- [ ] Extend real-Engine Electron E2E and three-viewport screenshots/overflow/
      console gates; retain 10,000-row and panel performance checks.
- [ ] Run full Rust/contracts/smoke/Windows GNU/Node 22/Electron gates, update
      specs, commit and archive.

## Validation Commands

```bash
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
pnpm contracts:check
node scripts/engine-smoke.mjs
cargo build --target x86_64-pc-windows-gnu -p translunar-engine
```

```bash
pnpm exec prettier --check .
pnpm exec eslint apps packages/contracts/src
pnpm typecheck
pnpm --filter @translunar/desktop test
pnpm --filter @translunar/desktop build
cd apps/desktop && pnpm exec playwright test
```

## Rollback Points

- Restore the automatic pre-v10 backup; never edit released migrations.
- A failed batch import/re-import/archive restore leaves no partial project or
  search/analysis projection.
- Recycle and history preserve inverse information until explicit purge.
- Renderer never becomes the source of truth for matching, archive validity,
  counts, weighting, productivity or asset health.

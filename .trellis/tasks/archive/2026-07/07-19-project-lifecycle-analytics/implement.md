# Implementation Plan: Project Lifecycle And Analytics

## Preconditions

- QA/review migration 9 and generated protocol are committed and green.
- Use Codex inline mode and read backend Engine/database/error/quality plus
  frontend Electron/state/type/accessibility specs before editing.
- Preserve migrations 1..9 and existing single-document/backup contracts.

## 1. Lifecycle Core And Storage

- [x] Add lifecycle-core models and deterministic re-import matching,
      word/CJK/repetition counting, weighting and archive manifests.
- [x] Add migration 10 tables/indexes/default analysis profile and fresh/
      upgrade/rollback/reopen coverage.
- [x] Implement template CRUD/resolution, document versions/re-import apply,
      recycle/history, search reconciliation and analysis/analytics queries.

## 2. Engine And Protocol

- [x] Add batch file/folder discovery/import with bounded diagnostics and
      preserved relative paths; retain legacy imports.
- [x] Add template, re-import preview/apply, archive export/restore, recycle,
      history, search, analysis and analytics RPC/capability contracts.
- [x] Implement versioned hash-validated no-clobber project archives and atomic
      restore without credentials/shared external asset leakage.

## 3. Desktop

- [x] Build three-step setup and project home with multi-file progress,
      add-file/folder/drag-drop diagnostics and recent/lifecycle actions.
- [x] Build templates, re-import preview, archive/restore, recycle/history and
      global search with direct project/document/segment navigation.
- [x] Build analysis/weighted effort/progress/productivity/AI/asset views with
      unavailable/stale states and no billing semantics.

## 4. Integration And Finish

- [x] Extend storage/Engine tests and stdio smoke through multi-file/template/
      re-import/search/analysis/recycle/archive/restart flows.
- [x] Extend real-Engine Electron E2E and three-viewport screenshots/overflow/
      console gates; retain 10,000-row and panel performance checks.
- [x] Run full Rust/contracts/smoke/Windows GNU/Node 22/Electron gates, update
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

## Completion Record

This archived implementation record is completed through corrective task
`.trellis/tasks/07-20-project-lifecycle-acceptance`, which was created after
the original archive exposed missing desktop and process-level evidence. The
corrective task preserves the original PRD rather than replacing it.

Verified evidence (2026-07-21):

- Node 22.17.0 / pnpm 10.18.3: format, ESLint, typecheck, 15 Vitest tests,
  and production desktop build passed.
- `/home/ubuntu/workspaces/cat-lifecycle-acceptance` (isolated synchronized
  tree, no `.git`): `pnpm format:check`, `pnpm lint`, `pnpm test`,
  `pnpm contracts:check`, Rust fmt/clippy/workspace tests, Engine smoke, and
  Linux/Windows GNU release builds passed.
- Windows GNU Engine SHA-256:
  `b2cd0e0fa8fffa215efdbb460632010d287a39df5d18a0ce22f8cad737fa813d`.
- Real-Engine Electron E2E passed 7 tests with 1 existing PDF prerequisite
  branch skipped; lifecycle, performance, geometry, overflow, and
  console/page-error assertions were included.
- Project Home and Project Insights screenshots at 1250x744, 1680x942, and
  1920x1080 were captured and manually inspected.

The Trellis `mem` executable was unavailable because its installed module was
missing; repository context scripts supplied the equivalent checks. This is a
tooling note, not an unchecked implementation item.

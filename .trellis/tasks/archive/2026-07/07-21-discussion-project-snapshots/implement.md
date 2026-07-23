# Execution Plan

## Ordered Checklist

- [x] Curate the parent-defined protocol names/types/catalog for discussion
      thread list/create/resolve, message list/create/update/delete, and
      snapshot list/create/get/previewRestore/restore operations.
- [x] Add migration 14 and storage records/queries for threads, messages,
      immutable snapshots, previews, deterministic paging, and mention tokens.
- [x] Implement canonical snapshot capture, diff preview, revision/digest
      validation, and atomic project-local restore with history.
- [x] Wire Engine methods and stdio dispatch with bounded validation and typed
      errors; add focused Rust restart/stale/rollback tests.
- [x] Regenerate and check JSON/TypeScript contracts.
- [x] Add the Project Insights discussions/snapshots panel and integrate it
      without touching unrelated Workbench visual work.
- [x] Extend real-Engine Electron/stdio coverage for create/page/resolve,
      snapshot preview/restore, stale/duplicate/missing/rollback paths.
- [x] Run formatting, lint, targeted tests, contract check, desktop typecheck,
      and the supported E2E viewports; record evidence in this task.

## Validation Commands

```text
cargo fmt --all -- --check
cargo test -p translunar-storage discussion -- --nocapture
cargo test -p translunar-storage snapshot -- --nocapture
cargo test -p translunar-engine discussion -- --nocapture
cargo test -p translunar-engine snapshot -- --nocapture
node scripts/check-contracts.mjs
pnpm --filter @translunar/desktop typecheck
pnpm --filter @translunar/desktop test
```

## Validation Evidence

Recorded 2026-07-23 after the final implementation pass:

- Local Windows: `cargo fmt --all -- --check`, desktop typecheck (Electron,
  renderer, and E2E configs), 7 Vitest files / 25 tests, targeted ESLint,
  Node script syntax checks, `git diff --check`, and
  `node scripts/check-contracts.mjs` all passed.
- VPS (`ssh moe`, Rust 1.97.1 / Node 22.17.0): strict workspace Clippy,
  78 storage tests, targeted discussion/snapshot Engine tests, all workspace
  tests, contract drift, and the real `engine-smoke.mjs` all passed. The smoke
  covered three scopes, mentions, paging, tombstones, stale/duplicate/terminal
  snapshot paths, restore/history, and restart recovery.
- Windows Electron using the freshly cross-built x86_64 GNU Engine: the full
  desktop suite passed 12 tests with one explicit optional-PDF skip. This
  includes the discussion/snapshot flow and the 10,000-segment 60-second
  performance budget. The new flow captured discussion and snapshot surfaces
  at 1250x744, 1680x942, and 1920x1080; overflow, named-control, and
  console/page-error assertions passed, and the screenshots were inspected.
- VPS Xvfb supplementary E2E passed 11/13 functional tests including the new
  flow; its existing 10,000-segment frame P95 measured 33.3 ms because that
  display is quantized to 30 Hz. The authoritative `<33 ms` performance gate
  passed on Windows; the Xvfb timing limitation is documented in the frontend
  code-spec rather than weakening the product threshold.

## Risk / Rollback Points

- Migration and payload schema: run v13 upgrade/reopen tests before changing
  restore logic.
- Restore transaction: inject a validation failure after document and before
  mount writes; assert the original project digest and history remain intact.
- Generated contracts: inspect the schema diff and keep additions additive.
- Desktop integration: limit edits to the new panel and Insights tab; leave
  concurrent Workbench/style changes untouched.

## Review Gate

Before activation, verify the PRD convergence pass, all required artifacts,
curated manifests, and the parent R5 dependency mapping. Implementation starts
only after `task.py start` records this child as `in_progress`.

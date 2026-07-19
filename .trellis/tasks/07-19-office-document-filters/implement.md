# Implementation Plan: Office Document Filters

## Preconditions

- `text-html-xliff-srx` is archived and its filter/engine contracts are current.
- Read `engine-boundary.md`, `error-handling.md`, and `database-guidelines.md`.
- Work in Codex inline mode; do not dispatch sub-agents.
- Keep the legacy DOCX methods and existing fixtures green at every checkpoint.

## 1. Planning And Shared Package Helper

- [x] Use the Codex inline workflow gate and load all applicable backend specs.
- [x] Add `crates/filter-office-core` for bounded ZIP access, relationship
      discovery, XML validation, text-node ranges, and package reassembly.
- [x] Add unit tests for traversal limits, malformed XML, encrypted/path
      traversal entries, no-clobber publication, and untouched-entry identity.
- Gate: format, strict clippy, and isolated helper tests.

## 2. DOCX Completion

- [x] Extend `filter-docx` part discovery to body, headers, footers,
      footnotes/endnotes, drawings/text boxes, and opt-in comments.
- [x] Implement accepted-revision traversal and stable part/paragraph paths;
      preserve run/paragraph/table properties and protected controls.
- [x] Implement range-local export for every owned part with per-part and final
      package revalidation; retain legacy API wrappers.
- [x] Add fixtures for all B-01 structures, optional comments, Unicode,
      revisions, malformed packages, and unchanged ZIP entries.
- Gate: DOCX unit tests, generic import/export/restart, and legacy E2E.

## 3. XLSX Filter

- [x] Add `crates/filter-xlsx` descriptor/probe and workbook relationship parser.
- [x] Implement sheet/row/column selection options with bounded diagnostics.
- [x] Import shared/inline rich text; protect formulas and non-text cells;
      emit stable cell paths and protected run tags.
- [x] Export translated cells with shared-string cloning, preserve formatting,
      reparse selected values, and no-clobber publish.
- [x] Add multi-sheet, repeated-string, rich-text, formula, selection, and
      malformed/unsupported fixtures.
- Gate: isolated crate plus generic engine restart/export tests.

## 4. PPTX Filter

- [x] Add `crates/filter-pptx` descriptor/probe and presentation relationship
      parser.
- [x] Import slide shapes, tables, SmartArt, and opt-in notes/masters with
      stable owner paths and protected run tags.
- [x] Export owned text ranges, preserve package relationships/media/charts,
      reparse all changed parts, and report unsupported text-bearing parts.
- [x] Add slide, table, SmartArt, notes/master, formatting, malformed, and
      package-preservation fixtures.
- Gate: isolated crate plus generic engine restart/export tests.

## 5. Engine And Contract Integration

- [x] Register DOCX/XLSX/PPTX in deterministic filter catalog and retain legacy
      DOCX routing; pass locale/options and original extensions.
- [x] Add Office coverage to `scripts/engine-smoke.mjs`, including selection,
      malformed import cleanup, restart, export, and destination no-clobber.
- [x] Verify protocol schema remains unchanged; no additional wire field was
      required and generated contracts have no drift.

## 6. Quality And Finish

- [x] Run local lint/typecheck/unit/build/E2E and VPS fmt/clippy/workspace tests,
      smoke, and release build.
- [x] Update backend specs with Office boundary, options, degradation, and
      package-preservation contracts.
- [ ] Update PRD acceptance evidence, commit, archive, update parent progress,
      and continue to `07-19-pdf-ocr-workflow`.

## Verification Evidence

- VPS: rustfmt, strict workspace clippy, workspace tests, seven-filter stdio
  smoke, debug Engine build, and Windows GNU release build all passed.
- Local: Prettier, ESLint, TypeScript, Vitest 8/8, desktop production build,
  and Electron E2E 3/3 passed with `target/cross/translunar-engine.exe`.
- Protocol schema is unchanged at SHA-256
  `a5dc7cc00107e8c683bab91e1a7e07e9f576aeeb9c42139757208fe5ffa22d95`.
- Windows release Engine size: 16,238,165 bytes.

## Validation Commands

```powershell
cargo fmt --all -- --check
git diff --check
pnpm exec eslint apps packages/contracts/src
pnpm typecheck
pnpm --filter @translunar/desktop test
pnpm --filter @translunar/desktop build
pnpm --filter @translunar/desktop test:e2e
```

```bash
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
node scripts/engine-smoke.mjs
cargo build --release --target x86_64-pc-windows-gnu -p translunar-engine
```

## Rollback Points

- Disable a new registry entry if its isolated fixtures fail; never delete
  managed sources or alter the schema to hide a filter failure.
- Keep staged ZIPs private until all owned parts reparse successfully; remove
  the stage on any failure and leave the destination unchanged.
- Revert only the Office crates/registration in a work commit; preserve the
  generic filter contract and prior text/XLIFF behavior.

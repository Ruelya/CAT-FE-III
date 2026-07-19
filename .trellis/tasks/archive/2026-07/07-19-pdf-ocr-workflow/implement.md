# Implementation Plan: PDF Text And OCR Workflow

## Preconditions

- Office/text filters are archived and generic options/degradation/no-clobber
  contracts are current.
- Use Codex inline mode and the PDF render-and-verify skill; no sub-agents.
- Read backend engine/error/quality/storage specs and frontend data-flow/testing
  specs before cross-layer changes.

## 1. Fixtures And Toolchain

- [x] Add stable ReportLab fixtures: text/layout, scanned, and mixed PDF.
- [x] Render every fixture with Poppler and visually inspect nonblank page
      geometry; retain generation script and deterministic assertions.
- [x] Add `crates/filter-pdf` tool resolution, bounded child execution, timeout,
      stdout/stderr caps, cleanup, version diagnostics, and typed errors.
- [x] Add deterministic fake-tool tests plus real Poppler/Tesseract smoke.

## 2. Text Layout And OCR Filter

- [x] Parse bbox-layout pages/flows/blocks/lines/words and implement stable
      reading order, heading/table heuristics, page selection, and SRX splitting.
- [x] Implement auto/always/never OCR, page rendering, Tesseract TSV parsing,
      language/DPI options, confidence/bbox normalization, and mixed-page rules.
- [x] Emit stable PDF structural paths, OCR notes, and explicit layout/OCR/
      unsupported-content degradation; register `builtin.pdf`.
- [x] Add malformed/encrypted/empty/missing-tool/timeout/oversize/no-page-loss
      tests and generic Engine import/restart tests.

## 3. Page Review And OCR Correction

- [x] Add page list/get and OCR correction protocol contracts and regenerate
      schema/TypeScript.
- [x] Add Engine page projection/render/base64 services with PDF-only guards and
      bounded DPI/image size.
- [x] Add transactional Store OCR source correction, context hash recalculation,
      reasoned history, stale/state/type rejection, and restart tests.

## 4. DOCX Reconstruction

- [x] Build a valid DOCX from ordered PDF segments with page size/breaks,
      headings, table candidates, target fallback, and XML escaping.
- [x] Add overflow/image/column/table/OCR degradation findings; validate through
      `DocxFilter`, publish no-clobber, and re-import the output fixture.
- [x] Render reconstructed output through the available Office/PDF conversion
      tool or inspect package plus a generated PDF proof; reject blank/clipped
      visual output.

## 5. Desktop Review Flow

- [x] Generalize source picker/Setup import to registered P0 formats without
      breaking legacy DOCX E2E.
- [x] Add lazy PDF original-page/OCR comparison in the preview panel, active
      segment following, confidence display, correction reason/conflict flow,
      loading/error/empty states, keyboard access, and reduced-motion behavior.
- [x] Use generic export with a DOCX suggestion for PDF and add Electron E2E
      for import, review, correction, panel modes, restart, and export.

## 6. Integration And Finish

- [x] Extend Engine smoke with text/scanned/mixed PDF, typed failure, correction,
      restart, page PNG, DOCX export, re-import, and no-clobber checks.
- [x] Run VPS fmt/clippy/workspace tests/smoke/release and local format/lint/
      typecheck/unit/build/Electron E2E with synchronized Engine.
- [ ] Commit/archive the completed child and continue to
      to `07-19-professional-editor`.

## Validation Commands

```bash
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
node scripts/engine-smoke.mjs
cargo build --release --target x86_64-pc-windows-gnu -p translunar-engine
```

```powershell
pnpm exec prettier --check .
pnpm exec eslint apps packages/contracts/src
pnpm typecheck
pnpm --filter @translunar/desktop test
pnpm --filter @translunar/desktop build
pnpm --filter @translunar/desktop test:e2e
```

## Rollback Points

- Missing system tools keep `builtin.pdf` registered but produce typed
  capability errors; never fall back to silent empty imports.
- Protocol additions are additive; preserve generated schema/clients together.
- Preview images are derived temporary data. No cleanup path may delete the
  immutable managed PDF or an existing export.

## Verification Evidence

- Real fixtures and visual checks ran on `ssh moehub` with Poppler and
  Tesseract 5.3.4; text columns, tables, OCR confidence, mixed-page coverage,
  and reconstructed pages were nonblank and readable.
- Rust workspace and engine smoke passed on the VPS. Local desktop checks
  passed with the synchronized generated contracts and the PDF/legacy E2E
  suites. The Windows GNU release binary was produced from the VPS toolchain.

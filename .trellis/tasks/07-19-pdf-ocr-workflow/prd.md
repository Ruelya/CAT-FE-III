# PDF Text And OCR Workflow

## Goal

Deliver the layered P0 PDF workflow in `docs/PRD.md` v2.0. A translator can
import a text-layer, scanned, or mixed PDF, review source blocks against the
original page, correct OCR text with history, translate through the normal CAT
model, and export a best-effort DOCX with an explicit degradation report.

## Requirements

### P1. Internal PDF filter (B-07)

- Register `builtin.pdf` through the existing generic `filter.list`,
  `document.import`, and `document.export` methods. Renderer code does not parse
  PDF content or invoke OCR directly.
- Validate the PDF header, page count, tool output, and bounded options before
  persistence. Malformed, encrypted, or unsupported PDFs fail with typed,
  actionable errors and leave no managed source/document.
- Resolve Poppler/Tesseract executables from explicit bounded options, product
  environment variables, then `PATH`; invoke them with `Command` arguments,
  never a shell. Time, output bytes, pages, DPI, and process lifetime are
  bounded and child processes are terminated on timeout.

### P2. Text-layer extraction and layout

- Use Poppler bbox-layout extraction to retain page, flow, block, line, word,
  and geometry information. Reconstruct paragraphs/headings, identify likely
  tables, and produce deterministic multi-column reading order.
- Structural paths encode page, order, block kind, geometry, source kind, and
  confidence. They remain stable across restart and are sufficient for export
  and page-review projection without reparsing in Electron.
- Support inclusive `pageRange`, `segmentationMode=paragraph|sentence`, and
  locale-aware SRX sentence splitting. Empty/unselected pages are not silently
  reported as translated content.

### P3. Scanned/mixed-page OCR

- `ocrMode=auto|always|never` defaults to `auto`. Auto uses the text layer when
  present and OCRs only pages without meaningful text; always OCRs every
  selected page; never explicitly accepts empty scanned pages with warnings.
- Render OCR/preview pages with `pdftoppm`, invoke Tesseract TSV with configured
  `ocrLanguages` and bounded `ocrDpi`, group words by block/paragraph/line, and
  retain average confidence and bounding boxes.
- Missing OCR/render tools on a page that requires OCR return an actionable
  error. A mixed document cannot silently lose scanned pages.
- OCR text is editable only through an Engine command that requires expected
  revision and a non-empty reason, is limited to OCR-origin segments, keeps
  operation history, recalculates source/context hashes, and rejects confirmed
  segments.

### P4. Original-page review surface

- Add generic PDF page list/get RPCs. Page get renders one bounded-DPI PNG on
  demand from the immutable managed source and returns base64 plus authoritative
  layout blocks/segment revisions; large page images are never preloaded all at
  once.
- The desktop supports PDF selection/import through the generic document path.
  For a PDF document, the preview area shows original page and extracted/OCR
  blocks, follows the active segment, identifies OCR confidence, and provides a
  correction interaction with reason and conflict handling.
- The comparison UI is keyboard accessible, respects collapsed/maximized panel
  behavior, and does not expose arbitrary filesystem paths to the renderer.

### P5. Best-effort reconstruction and degradation

- PDF export produces a validated no-clobber DOCX. It preserves page order,
  paragraph/heading hierarchy, explicit page breaks, detected table rows, and
  approximate page dimensions/margins; untranslated blocks copy source text.
- Export does not claim pixel fidelity or modify the source PDF. It reports
  text expansion/overflow risk, reconstructed columns/tables, OCR-origin text,
  missing fonts/images, and any protected unsupported elements as structured
  degradation findings.
- The output package reparses through the DOCX filter before publication and
  can be imported again as a normal document.

### P6. Compatibility and safety

- Existing Office/text/XLIFF filters, assets, QA, restart recovery, backups,
  schema upgrades, and legacy DOCX methods remain green.
- Logs/errors contain page numbers, counts, tool IDs, exit class, and durations,
  never document text, OCR bodies, arbitrary stderr dumps, or user secrets.
- Preview rendering and OCR are local by default. No cloud OCR request is made
  by this task; a future connector may implement that capability explicitly.

## Acceptance Criteria

- [x] `filter.list` reports `builtin.pdf`; a real text-layer fixture imports
      headings, paragraphs, table candidates, and two-column reading order with
      exact page/block geometry and deterministic paths.
- [x] A scanned fixture and mixed text/scanned fixture exercise real Tesseract
      OCR, confidence/bbox capture, auto/always/never behavior, language/DPI
      options, missing-tool errors, and no silent page loss.
- [x] PDF page list/get returns bounded page summaries, a valid rendered PNG,
      and blocks tied to authoritative segment IDs/revisions after restart.
- [x] OCR correction updates source/context hashes atomically, records reasoned
      history, rejects stale/non-OCR/confirmed edits, and survives restart.
- [x] Export creates a valid re-importable DOCX, preserves page/block order and
      untranslated text, rejects overwrite, and returns layout/OCR/overflow
      degradation findings.
- [x] Desktop can choose/import a PDF, review original-page vs OCR text, correct
      one OCR block, navigate/collapse/maximize preview, and export DOCX in E2E.
- [x] PDF fixtures and exported artifacts are rendered to PNG and visually
      checked for readable, non-overlapping pages; automated pixel/dimension
      checks reject blank or clipped output.
- [x] Full VPS fmt/clippy/tests/smoke/release and local contract/lint/typecheck/
      unit/build/Electron E2E gates pass.

## Out Of Scope

- Pixel-perfect PDF rewriting, editing vector graphics, translating text inside
  arbitrary images, cloud OCR, handwriting recognition, and AI image-text
  translation (B-14/P2).
- Bundling/signing Poppler and Tesseract binaries in installers; the platform
  packaging child owns redistribution and final per-platform binary placement.
- Generic source-edit mode for non-OCR documents; the professional-editor child
  owns C-16 beyond the restricted OCR correction command delivered here.

## Constraints And Decisions

- Poppler/Tesseract are proven domain engines for parsing/rendering/OCR; the
  Rust layer owns orchestration, bounds, normalization, layout heuristics, and
  persistence. Do not hand-roll a PDF interpreter or OCR engine.
- `pdftotext` is mandatory for text-layer import. `pdftoppm` is mandatory for
  page review and OCR. Tesseract is mandatory only when selected pages require
  OCR.
- DOCX is the required M0 reconstructed output; direct PDF write-back is not
  implied by generic export.

## Completion Evidence

- `crates/filter-pdf` contains the bounded Poppler/Tesseract adapter, stable
  structural paths, layout/table heuristics, OCR modes, and reconstruction
  tests. Fixtures are generated by `scripts/generate-pdf-fixtures.py` and are
  checked with real Poppler/Tesseract on the VPS.
- The protocol, engine, storage, preload, and renderer implement
  `pdf.page.list`, `pdf.page.get`, and `pdf.correctOcr`. The Electron PDF E2E
  covers import, page review, OCR correction, target editing, panel modes, and
  DOCX export without renderer-side parsing or filesystem access.
- VPS gates passed with Node 22: `cargo fmt --all -- --check`, strict
  `cargo clippy`, `cargo test --workspace`, `node scripts/engine-smoke.mjs`,
  and the Electron suite (4/4, including PDF). Local Prettier, ESLint,
  TypeScript, Vitest (8/8), production build, and legacy Electron E2E (3/3)
  also passed. The release engine was built with
  `cargo build --release --target x86_64-pc-windows-gnu -p translunar-engine`.
- Rendered fixture and desktop evidence was inspected at 1920x1080. Preview
  images are lazy and derived; exports are validated and published without
  clobbering an existing destination. Protocol schema SHA-256:
  `327ca08920741f3a21bc1fb2c3eb7e588a0b2a3c4eb6def6fa9c750230f81d13`.

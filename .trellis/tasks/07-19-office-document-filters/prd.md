# Complete Office Document Filters

## Goal

Deliver the remaining P0 Office format support in `docs/PRD.md` v2.0. A
translator can import and export real DOCX, XLSX, and PPTX packages through the
same generic filter contract, edit every owned text unit, protect non-text
structures, and receive an explicit degradation finding whenever a package
feature is not safely representable.

## Scope And Requirements

### O1. Shared Office filter contract

- Register stable descriptors `builtin.docx`, `builtin.xlsx`, and `builtin.pptx`
  through `FilterRegistry`; callers use only `filter.list`, `document.import`,
  and `document.export`.
- Preserve legacy `document.importDocx`/`document.exportDocx` behavior while
  routing the generic path through the same enhanced DOCX implementation.
- Use bounded string options on the existing import wire field. Unknown options
  are ignored; invalid values return a typed import error before persistence.
- Structural paths identify the OOXML part and stable object identity, never a
  transient ordinal alone. Every imported unit maps to one owned text range.
- ZIP entries not owned by a filter are copied byte-for-byte. A changed package
  is staged, reparsed, fsynced, and published with no-clobber semantics.

### O2. DOCX P0 coverage (B-01)

- Import/export body paragraphs, table-cell paragraphs, text boxes and other
  drawing text in `word/document.xml`.
- Import/export headers, footers, footnotes, and endnotes when present. Comment
  text is opt-in through `includeComments=true`; comments remain notes when
  imported and are never silently discarded.
- Treat accepted revision content as translatable: include `w:ins` and
  `w:moveTo`, exclude `w:del` and `w:moveFrom` from source text. Field
  instructions, proofing metadata, and non-text drawing XML remain protected.
- Preserve run properties, paragraph properties, table geometry, relationships,
  comments, numbering, media, custom XML, and unknown package parts.
- Export only owned text ranges, preserve untranslated units exactly, validate
  every modified XML part and the final ZIP package, and report unsupported
  constructs as degradation rather than dropping text.

### O3. XLSX P0 coverage (B-02)

- Import worksheet cell text from shared strings and inline rich-text strings;
  formulas, numeric/date cells, errors, drawing XML, and workbook metadata are
  protected and never exposed as editable source text.
- Support selection options `sheetNames`, `sheetIndexes`, `rowRange`, and
  `columnRange` (inclusive, bounded). The default imports all visible
  worksheets and all used text cells.
- Preserve rich-text run boundaries as protected inline tags and preserve
  shared-string formatting on export. If a translated shared string is reused
  by multiple cells, clone it safely rather than changing unrelated cells.
- Structural paths use workbook part, worksheet relationship identity, and cell
  reference (for example `xl/worksheets/sheet1.xml#cell:B12`). Export updates
  only selected translated cells and leaves formulas and unowned cells intact.

### O4. PPTX P0 coverage (B-03)

- Import text from slide shapes, text boxes, table cells, and SmartArt diagram
  data. Notes pages and slide masters are opt-in with `includeNotes=true` and
  `includeMasters=true`; ordinary slide text is always included.
- Preserve run-level formatting, shape/table geometry, relationships, media,
  chart data, animations, and unknown parts. Non-text XML is protected.
- Structural paths use stable slide/part identity plus paragraph/run owner;
  slide order is not the sole identity. Export changes only owned `<a:t>` or
  SmartArt text ranges and reparses every changed part.
- A package with unsupported encrypted/invalid XML or an unowned text-bearing
  part fails with a comprehensible typed error or a degradation record; it must
  never silently lose text.

### O5. Safety, fidelity, and compatibility

- Parsers do not execute macros, external relationships, formulas, embedded
  scripts, or ActiveX. ZIP/XML limits prevent resource exhaustion.
- Imports are transactional: malformed packages leave no document or managed
  source row. Existing exports remain unchanged on any validation/publication
  failure.
- Existing TXT/Markdown/HTML/XLIFF/SRX, TM/TB, QA, restart recovery, protocol
  generation, and Electron flows remain green.

## Acceptance Criteria

- [x] `filter.list` reports DOCX, XLSX, and PPTX descriptors after restart and
      the legacy DOCX methods still pass their compatibility fixture.
- [x] DOCX fixtures cover body/table/text-box/header/footer/footnote/endnote,
      optional comments, accepted/rejected revisions, multi-run formatting,
      Unicode, and preservation of unrelated ZIP entries.
- [x] XLSX fixtures cover multiple sheets, sheet/row/column selection, shared
      and inline rich text, repeated shared strings, formulas and numeric cells
      remaining unchanged, and translated/untranslated round trips.
- [x] PPTX fixtures cover shapes, tables, SmartArt, optional notes/masters,
      multi-run formatting, slide relationships, and unchanged media/charts.
- [x] Every malformed/unsupported package returns a typed actionable error or
      explicit degradation, persists nothing on import failure, and never
      overwrites an existing export destination.
- [x] Structural paths are stable across restart and export; a second document
      with identical OOXML ordinals cannot collide in tags or persisted units.
- [x] Full Rust format/clippy/tests, extended engine smoke, generated schema
      checks, desktop lint/typecheck/unit/build/E2E remain green.

## Verification Evidence

- VPS (`/home/ubuntu/workspace/CAT-core-dev`): workspace rustfmt, strict clippy,
  all workspace tests, seven-filter stdio smoke, debug Engine build, and Windows
  GNU release Engine build passed.
- The Windows release artifact is 16,238,165 bytes and was copied to
  `target/cross/translunar-engine.exe` for desktop testing.
- Local gates passed with the synchronized Engine: ESLint, TypeScript, Vitest
  8/8, production desktop build, and Electron E2E 3/3.
- Protocol/schema did not change. The schema SHA-256 remains
  `a5dc7cc00107e8c683bab91e1a7e07e9f576aeeb9c42139757208fe5ffa22d95`
  and no generated contract file drifted.
- Node 24 emitted the repository's expected engine-range warning (`>=22.17 <23`)
  but every JavaScript/desktop gate completed successfully.

## Out Of Scope

- Binary legacy Office formats (`.doc`, `.xls`, `.ppt`), ODF conversion, PDF,
  and third-party Office plug-ins (handled by sibling tasks).
- Pixel-perfect Office rendering and an editor-side XLSX/PPTX visual preview;
  this task supplies normalized units and preview-safe metadata for the editor.
- Formula translation, macro execution, external link resolution, encrypted
  packages, and automatic layout reflow.

## Constraints And Decisions

- Rust owns ZIP/XML parsing, selection, protected tags, offsets, validation,
  degradation findings, and publication. The renderer only renders events.
- Preserve source XML/ZIP ordering and untouched bytes wherever possible;
  reserialization is limited to changed XML parts and is followed by reparse.
- Options are additive to the existing protocol map and remain bounded by the
  shared Engine validation contract.

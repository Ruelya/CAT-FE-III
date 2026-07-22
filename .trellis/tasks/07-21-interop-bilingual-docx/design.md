# Technical Design: Bilingual DOCX And Table Interchange

## Boundary And Ownership

```text
trusted file dialog / renderer selection
  -> generated interop RPC contracts
  -> Engine review/table service
  -> filter-interop + filter-docx/filter-xlsx codecs
  -> Store immediate transaction + managed staging files
```

Rust owns DOCX/XLSX parsing, canonicalization, hashing, row classification,
revision validation, review/comment creation, TM provenance, and publication.
The renderer receives typed preview rows and sends only row IDs, expected
revisions, actor/reason, and destination paths.

## Codec Layout

Extend the existing format crates with reusable, pure row projections:

- `filter-docx` exposes bounded two-cell table extraction and range-aware row
  replacement for `builtin.bilingual-docx`. The ordinary `DocxFilter` remains
  the default `builtin.docx` implementation.
- `filter-xlsx` exposes bounded two-column row extraction for
  `builtin.bilingual-xlsx`, reusing its existing shared/inline string and
  formula protection. The ordinary `XlsxFilter` remains unchanged.
- `filter-interop` owns the review-package codec because it already owns
  cross-format safety helpers. It creates a minimal valid OOXML package with
  `word/document.xml`, relationships/content types, and a custom XML manifest
  part, then reparses it before publication.

Generic table rows use structural paths such as
`bilingual-docx:word/document.xml#table:0/row:3` and
`bilingual-xlsx:xl/worksheets/sheet1.xml#row:7`. These paths are not used as
review identities; review rows use random opaque IDs.

## Review Package Format

The generated Word table has exactly three visible columns:

1. `ID / status` cell: opaque row ID and a bookmarked status line;
2. source cell: immutable source text surrounded by a source bookmark;
3. target cell: editable target bookmark followed by an editable comments
   bookmark.

Bookmark names are deterministic, ASCII-safe encodings of the opaque row ID.
The custom XML part `customXml/translunar-review.json` contains canonical JSON:

```text
formatVersion, projectId, documentId, baseDocumentRevision,
rows[{rowId, segmentId, segmentRevision, ordinal, sourceHash}],
manifestHash
```

`manifestHash` is SHA-256 over canonical JSON with `manifestHash` omitted. It
covers only binding/identity data, so target and comment edits do not invalidate
the package. The parser also verifies each source bookmark against the stored
source hash and rejects duplicate/missing row IDs. The manifest is opaque to the
UI and is never trusted as a replacement for current SQLite rows.

The codec limits XML/package depth and size through `OfficePackage` and adds
review-specific row/cell/manifest bounds. Generated output uses escaped XML
text, no macros or external relationships, and preserves the original source
package only as a manifest reference; it is a new review artifact.

## Preview Data Flow

1. Engine validates `projectId`, `documentId`, expected document revision, and
   input file bounds.
2. Codec parses the manifest/table and returns immutable row bindings plus
   editable target/comment/status values. It computes the manifest digest and
   source hashes before any Store call.
3. Engine loads current segments/editor rows and classifies every package row:
   `changed`, `unchanged`, `missing`, `added`, or `invalid`. It captures each
   current segment revision and the document revision in a durable preview.
4. Store writes `interop_previews` and `interop_preview_rows` in one immediate
   transaction, and stages the input under the workspace temporary directory.
   The preview status is `open` and can be reopened after process restart.

No target, comment, workflow, review, or TM write occurs during preview.

## Review Apply Transaction

`interop.review.apply` loads an open review preview, verifies the expected
document revision and every selected row's segment revision/source hash, and
rejects any invalid selected row. One immediate transaction then:

- inserts a review proposal using the existing review schema for target/source
  changes, preserving the captured base revision;
- inserts bounded new segment comments for comment deltas with a deterministic
  preview/row provenance token so retries cannot duplicate them;
- records status context in the review reason/operation metadata and updates
  workflow state only through the existing Engine-owned transition rules;
- increments the document revision once and marks the preview applied;
- appends one auditable operation containing preview ID, row IDs, counts, and
  actor/reason, never document text.

If any row fails validation or a write fails, SQLite rolls back and the staged
file remains available for retry or explicit cleanup. A terminal preview cannot
be applied again.

## Table Preview And TM Apply

DOCX table parsing walks `w:tbl/w:tr/w:tc` cells and preserves text across
runs. XLSX parsing follows the workbook relationships, resolves shared and
inline strings, and rejects formulas/numeric/error cells. The first row is a
header only when its first two normalized cells are source/target aliases;
otherwise it is data. Extra named columns become bounded metadata.

The table preview stores a canonical input SHA-256, format, row number, row ID,
locales, source/target text, metadata, and disposition. Row IDs are
`sha256(inputHash || rowNumber || sourceHash || targetHash)` truncated only for
display; the full hash remains in the stored preview. Duplicate detection uses
the target library's normalized source/target key.

Apply verifies the writable library and expected library revision, validates all
selected rows, then calls a transaction-aware Store method that inserts every
unit and provenance metadata (`previewId`, `rowId`, `sourcePathHash`,
`sourceRow`, `sourceFormat`). The library revision increments once when the
transaction inserts at least one new unit. A malformed accepted row or any
later failure aborts the entire transaction.

## Protocol Shape

Additive generated methods and representative payloads:

```text
interop.review.export ReviewExportParams -> ReviewExportResult
interop.review.preview ReviewPreviewParams -> ReviewPreviewResult
interop.review.apply ReviewApplyParams -> ReviewApplyResult
interop.table.preview TablePreviewParams -> TablePreviewResult
interop.table.apply TableApplyParams -> TableApplyResult
```

Preview row results contain only bounded IDs, ordinals, dispositions, deltas,
diagnostics, and text needed for the review UI; pagination is mandatory for
large documents. Apply requests contain `previewId`, expected revision(s),
selected row IDs, actor, and reason. Error codes map to existing `conflict`,
`invalid_request`, `invalid_state`, `unsupported_document`, and `export_error`
without clients branching on messages.

## Persistence And Migration

Append migration 11 with `interop_previews` and `interop_preview_rows`. Foreign
keys cascade preview rows, statuses are constrained, and staged paths are
workspace-relative. The migration has fresh/upgrade/reopen tests. No existing
review, segment, TM, or generic filter table is rewritten in place.

## Desktop Surface

Add a focused Interop review/table surface under Project Insights. Main owns
review/table input and output dialogs; preload only exposes existing generic
`invoke` plus trusted path selectors. React renders paginated rows, selection,
busy/error/empty states, and accessible classifications. It never opens a ZIP,
parses XML, computes hashes, or estimates revisions. Navigation flushes pending
Workbench edits before starting a preview/apply.

## Compatibility, Limits, And Rollback

- Existing filter IDs, generic `document.import/export`, TM exchange methods,
  and review RPCs remain wire-compatible.
- Existing destinations are never replaced. Staging is removed on failed
  publication but retained for an open preview until apply/cancel/expiry.
- Input/package limits are inherited from `filter-office-core`, with 100,000
  rows, 1 MiB cells, bounded metadata/comments, and a 64 MiB manifest cap.
- A codec that cannot preserve a construct returns a typed degradation or
  invalid finding; it never silently falls back to ordinary DOCX semantics.

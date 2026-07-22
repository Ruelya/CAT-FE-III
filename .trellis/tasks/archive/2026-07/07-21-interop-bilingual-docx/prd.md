# Bilingual DOCX And Table Interchange

## Goal

Give a translator a reviewable, round-trip-safe bilingual deliverable and a
deliberate path for recovering two-column bilingual tables into a writable TM.
The signed-review workflow must be distinguishable from ordinary DOCX/table
translation, must never apply stale or tampered rows, and must leave the
workspace and TM unchanged when an apply fails.

## Confirmed Baseline

- `crates/filter-docx` imports ordinary DOCX paragraphs, tables, headers,
  footers, notes, and protected runs into the generic `FilterEvent` stream.
  Its native export rewrites owned text ranges and raw-copies unowned ZIP
  parts, but it has no source/target table mode or review manifest.
- `crates/filter-xlsx` already protects formulas/numeric cells and preserves
  unrelated OOXML parts, but it does not expose a two-column bilingual-row
  projection.
- `crates/filter-office-core` validates bounded OOXML ZIPs and provides
  range replacement, raw-copy reconstruction, and no-clobber publication.
- `review_revisions` already stores expected segment revisions and accepts a
  target/source/tag proposal atomically; `segment_comments` and workflow state
  are durable Engine-owned projections.
- `tm_units` already stores arbitrary metadata and origin fields, and
  `import_tm_units` is transactional, but the current exchange RPC has no
  preview, row selection, or table-row provenance contract.
- The parent interoperability task requires this child after native CAT
  formats and before alignment/reference corpora. Renderer code must use the
  generated method catalog and must not parse DOCX/XLSX or mutate TM rows.

## Requirements

### R1. Signed bilingual review DOCX export

- Export a three-column Word review document for a selected project/document:
  opaque row ID, source text, and editable target text. Each row also exposes
  current workflow/status and comment context without adding a fourth visible
  column.
- Include every selected segment in deterministic ordinal order, preserve
  source text exactly, and bind each row to the document ID, segment ID,
  segment revision, and normalized source hash in a machine-readable manifest.
- Include a canonical manifest digest that covers immutable binding data but
  excludes editable target/comment fields. Editing target or comments is
  therefore allowed while source/identity tampering is detectable.
- Publish only after the generated package reparses and validates. Never
  replace an existing destination; a failed export leaves no partial file.

### R2. Review preview and apply

- Preview a returned review DOCX against an expected project/document revision
  and report one row for every manifest/table row with exactly one of:
  `changed`, `unchanged`, `missing`, `added`, or `invalid`.
- `changed` rows must include target/comment/status deltas and the captured
  segment revision. Source/hash changes, duplicate or missing markers,
  malformed XML, invalid manifest digests, unsupported target tags, and
  ambiguous identities are `invalid` and block apply.
- Detect stale project/document or segment revisions before any write. A
  stale or tampered preview returns a typed conflict/invalid error and does
  not create a review, comment, workflow transition, or history operation.
- Apply an explicit selection of valid changed rows as Engine-owned review
  proposals and comment/status context in one immediate SQLite transaction.
  Missing/added/unchanged rows remain visible in the result and are never
  silently treated as applied.
- Reopening the workspace after apply shows the same durable review proposals,
  comments, revisions, and operation history. Applying a preview twice is
  rejected or returns the recorded terminal result without duplicating rows.

### R3. Generic bilingual DOCX and XLSX table mode

- Provide separate generic filter IDs/modes for two-column bilingual DOCX and
  XLSX tables. They are not aliases for the signed review package and are
  selected explicitly when the input is ambiguous with an ordinary document.
- Treat the first two logical columns as source and target, recognize an
  optional header row, preserve additional named columns as bounded metadata,
  and return deterministic row numbers/structural paths.
- Import and export ordinary bilingual table documents through the existing
  generic document filter boundary. Existing DOCX/XLSX behavior and filter IDs
  remain unchanged.
- Reject formulas, encrypted/traversing/duplicate/oversized packages,
  malformed rows, unsupported cell types, and missing source/target values with
  typed errors before any document or TM state is persisted.

### R4. Table-to-TM preview and atomic apply

- Preview a selected DOCX/XLSX table into a chosen writable TM library with
  source/target locales, bounded row diagnostics, duplicate detection, and
  stable row IDs derived from input hash plus row number.
- Show valid, duplicate, and invalid rows before writing. The caller chooses
  valid row IDs; no row is written during preview.
- Apply selected rows only when the library revision and preview identity
  still match. Store row number, source path hash, input format, preview ID,
  and row ID in TM metadata so every imported unit has durable provenance.
- Any malformed accepted row, read-only library, locale mismatch, stale
  revision, or storage error rolls back the entire apply. Existing TM rows and
  the destination file remain unchanged.

### R5. Cross-layer and safety boundaries

- Additive RPC namespaces are `interop.review.export`,
  `interop.review.preview`, `interop.review.apply`, `interop.table.preview`,
  and `interop.table.apply`; generated JSON Schema and TypeScript contracts
  are the only client payload source.
- File parsing, manifest hashing, row classification, revision checks,
  comments, review creation, TM writes, and error-code mapping stay in Rust.
  Electron owns dialogs, busy/error states, selection controls, and rendering
  of authoritative previews only.
- Cap review/table input and output at the existing OOXML package limits,
  100,000 rows, 1 MiB per cell, bounded comments/metadata, and bounded
  manifest size. Errors/logs contain IDs, row numbers, counts, and hashes only,
  never source/target bodies or credentials.

## Acceptance Criteria

- [x] AC1: A representative document exports to a valid three-column review
      DOCX; the manifest digest verifies, opaque row IDs survive Word round
      trip, status/comments are visible, and an existing destination is not
      overwritten.
- [x] AC2: Editing target/comment cells produces a preview with correct
      changed/unchanged/missing/added/invalid classifications. Source tamper,
      duplicate IDs, malformed XML, and stale segment/document revisions fail
      before persistence.
- [x] AC3: Applying selected valid rows creates exactly one durable review or
      comment proposal per selected row, is restart-safe and idempotent, and
      leaves unselected/invalid rows untouched.
- [x] AC4: Explicit generic bilingual DOCX and XLSX filters import and export
      two-column tables while ordinary `builtin.docx`/`builtin.xlsx` behavior
      remains compatible and opaque OOXML parts are preserved.
- [x] AC5: DOCX/XLSX table preview shows row provenance and duplicate/invalid
      diagnostics; atomic TM apply persists selected rows with provenance and
      rolls back completely on a malformed accepted row, stale library, or
      read-only library.
- [x] AC6: Real stdio smoke covers export, edit/preview, stale/tamper/no-clobber,
      table preview/apply, restart, and malformed-package cleanup. Focused Rust
      tests cover manifest canonicalization, DOCX/XLSX rows, limits, and
      transaction rollback; generated contracts remain drift-free.
- [x] AC7: Desktop review/table surfaces use trusted file dialogs, accessible
      row selection and typed errors, show no horizontal overflow at supported
      viewports, and pass real-Engine Electron E2E without renderer parsing.

## Constraints And Out Of Scope

- The review package is tamper-evident, not a cryptographic signature or proof
  of reviewer identity. No secret key is embedded in a DOCX.
- Word comments, tracked revisions, macros, embedded objects, formulas, and
  arbitrary layout are not executed. Unsupported constructs remain opaque or
  produce an explicit degradation/invalid finding.
- This child does not implement alignment, reference corpora, offline task
  packages, server collaboration, or generic project snapshot/restore.
- The existing ordinary DOCX filter remains the default for `.docx`; signed
  review packages and generic bilingual tables require their explicit mode or
  dedicated RPC.

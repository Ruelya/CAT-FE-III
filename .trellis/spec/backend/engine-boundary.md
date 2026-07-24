# M0 Engine Boundary

## 1. Scope / Trigger

Use this contract for changes to `crates/domain`, `crates/protocol`,
`crates/storage`, `crates/filter-docx`, or `crates/engine`. It also applies when
Electron needs a new engine operation, because the wire schema and Rust service
must exist before renderer orchestration.

The Rust engine is the only owner of business rules, document processing,
SQLite, segment state, TM, QA, and persistence. Do not move those rules into
Electron to make a UI test pass.

## 2. Signatures

The process signature is:

```text
translunar-engine --data-dir <PATH> [--protocol stdio]
```

Stdio accepts one request and emits one response per line:

```rust
pub struct RpcRequest {
    pub jsonrpc: String, // exactly "2.0"
    pub id: serde_json::Value,
    pub method: String,
    pub params: serde_json::Value,
}
```

Protocol version 1 contains these method signatures, with concrete params and
results defined in `crates/protocol/src/lib.rs` and `RpcMethodCatalog`:

```text
engine.initialize         InitializeParams      -> InitializeResult
project.create            CreateProjectParams   -> Project
project.get               ProjectIdParams       -> ProjectSnapshot
document.importDocx       ImportDocxParams       -> Document
segment.list              SegmentListParams      -> SegmentPage
segment.updateTarget      UpdateTargetParams     -> Segment
segment.confirm           ConfirmSegmentParams   -> ConfirmSegmentResult
tm.lookupExact            ExactLookupParams      -> ExactLookupResult
qa.runDocument            DocumentIdParams       -> QaListResult
qa.list                   ListQaParams           -> QaListResult
document.exportDocx       ExportDocxParams       -> ExportDocxResult
```

`Store::open(data_dir)` owns `translunar.sqlite3`, `sources/`, `exports/`, and
`tmp/`. Schema versioning uses `PRAGMA user_version`; released migrations are
append-only.

## 3. Contracts

- `engine.initialize` with `protocolVersion: 1` must succeed before any other
  method. It returns engine version and capabilities.
- Rust structs use camelCase on the wire. Error codes are stable snake_case.
- Stdout contains JSON-RPC frames only. Structured `tracing` diagnostics go to
  stderr.
- Every segment mutation requires `expectedRevision`; every successful write
  increments revision and returns the authoritative segment/count state.
- Confirmation validates a non-empty target, updates the segment, upserts one
  provenance-bearing TM entry, reconciles number QA, and commits in one SQLite
  transaction.
- Every connection enables foreign keys, WAL, `synchronous=NORMAL`, and a
  5000 ms busy timeout.
- DOCX import copies the immutable source into `sources/` before persistence.
  Export edits a temporary copy, validates OOXML, and atomically publishes it.
- Rust-generated JSON Schema and generated TypeScript contracts are committed
  together. `pnpm contracts:check` is the drift gate.

## 4. Validation & Error Matrix

| Condition                                                               | Required result                                                 |
| ----------------------------------------------------------------------- | --------------------------------------------------------------- |
| `jsonrpc` is not `2.0`, params do not deserialize, or method is unknown | `invalid_request`                                               |
| A non-initialize method arrives before a successful handshake           | `invalid_state`                                                 |
| `protocolVersion` is not 1                                              | `invalid_request`                                               |
| Project, document, or segment does not exist                            | `not_found` with entity/id data                                 |
| `expectedRevision` differs from storage                                 | `conflict` with segmentId, expectedRevision, and actualRevision |
| Confirm target is empty or a storage state invariant fails              | `invalid_state`                                                 |
| DOCX package is unsupported or malformed                                | `unsupported_document`                                          |
| SQLite, managed-copy, or general IO fails                               | `storage_error`                                                 |
| Temporary export, validation, or publication fails                      | `export_error`                                                  |

An error must not partially commit confirmation or replace an export
destination.

## 5. Good / Base / Bad Cases

- Good: update a draft at revision N, receive N+1, confirm with N+1, then read
  one TM entry and engine-derived counts/QA.
- Base: import a valid DOCX with untranslated paragraphs; export changes only
  translated structural paths and preserves unrelated ZIP parts byte-for-byte.
- Bad: retry a save with stale revision N after storage reached N+1. Return
  `conflict`; never overwrite the current target.
- Bad: parse or write SQLite from Electron. No renderer or main module may open
  the database.

## 6. Tests Required

- Domain unit tests: normalization, number token multisets, content/context
  hashes, and filter event completeness.
- Storage tests: WAL/foreign keys, migration rollback, restart recovery, stale
  writes, transactional confirmation, unique TM provenance, and QA resolution.
- DOCX tests: ordered body/table extraction, malformed package rejection,
  translated/untranslated paragraphs, and unowned part preservation.
- Protocol/engine tests: camelCase schema, snake_case errors, mandatory
  handshake, typed conflict data, and full service restart flow.
- Process test: `pnpm test:e2e:engine` must import, save, restart, confirm, query
  TM/QA, resolve QA, export, and validate the result through stdio.

## 7. Wrong vs Correct

### Wrong

```typescript
// Renderer invents a domain transition and count before Rust responds.
segment.state = target.trim() ? "draft" : "untranslated";
counts.draft += 1;
```

### Correct

```typescript
const saved = await window.translunar.invoke("segment.updateTarget", {
  segmentId: segment.id,
  targetText,
  expectedRevision: segment.revision,
});

// Replace local display state with the engine response.
applySegment(saved);
```

## 8. Core v2 Durable Extension

### 1. Scope / Trigger

Use this contract when adding a format filter, project lifecycle write,
pipeline step, operation history entry, health diagnostic, or workspace backup.
The Rust storage boundary remains authoritative; a renderer may only invoke the
generated method catalog.

### 2. Signatures

The additive protocol methods are:

```text
project.list/update/setLifecycle
document.list/get/import/export
filter.list
history.list
data.checkHealth/createBackup
pipeline.step.list/create/list/get/validate
pipeline.run/run.list/run.get/run.cancel/run.resume
```

Managed source paths are stored relative to the workspace (for example
`sources/<document-id>.docx`) and resolved against the active data directory
when a document is read or exported. Legacy absolute paths are normalized during
open when they are inside the workspace.

### 3. Contracts

- Pages accept bounded limits and return deterministic ordering plus `total`.
- Project and pipeline mutations require `expectedRevision`; successful
  mutations append one operation or state transition in the same immediate
  transaction.
- Pipeline states are `queued -> running -> succeeded|failed`, with
  `canceling -> canceled` and `interrupted -> queued|failed`.
- Startup marks orphaned running work interrupted in one transaction. Resume
  preserves committed step output/checkpoint data; non-resumable steps become a
  typed `step_not_resumable` failure.
- `data.checkHealth` is read-only and returns IDs/paths/hashes only. Explicit
  backup stages a SQLite snapshot, sources, exports, hashes, and manifest, then
  atomically publishes a new destination without overwriting an existing one.

### 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| Unknown filter or pipeline step | `not_found` with entity/id data |
| Stale project or pipeline revision | `conflict` with entity, expected, actual |
| Invalid pipeline state transition | `invalid_state` |
| Missing managed source, broken version link, or FK violation | typed health finding; no document text |
| Existing backup destination or staging copy failure | `storage_error`/`invalid_state`; staging is removed |

### 5. Good / Base / Bad Cases

- Good: import two files with the same basename under distinct relative paths,
  restart, page them, and export both through generic and legacy methods.
- Base: cancel a delayed checkpoint and observe durable `canceled` status while
  polling; resume an interrupted resumable step from its previous checkpoint.
- Bad: reopen a workspace whose source path still points at the old absolute
  directory, or let a failed stale mutation append an operation.

### 6. Tests Required

- Real schema-v1 upgrade with TM/QA equality, automatic pre-migration backup,
  rollback, newer-schema rejection, and DOCX export validation.
- Storage health findings for missing source, broken current-version link, and
  foreign-key violation; backup no-overwrite and failed-staging cleanup.
- Engine cancellation, restart interruption, resumable recovery,
  non-resumable failure, typed filter/project conflicts, and multi-document
  restart/export.
- Stdio smoke must cover filter listing, lifecycle/history, pipeline polling,
  health, backup, and the legacy flow.
- Run the disposable 100,000-segment benchmark and retain its measured evidence.

### 7. Wrong vs Correct

#### Wrong

```rust
// A backup stores an absolute path from the source machine and the restore
// silently relies on that machine's sources directory.
managed_source_path = path.to_string_lossy().into_owned();
```

#### Correct

```rust
// Store a workspace-relative path; resolve only at the storage boundary.
managed_source_path = "sources/<document-id>.docx".to_string();
let source = paths.root.join(&managed_source_path);
```

## TM And Termbase Asset Boundary

### 1. Scope / Trigger

This contract applies to translation-memory libraries, termbases, open-format
exchange, concordance, and automatic confirmation sinking. It is a
cross-layer extension of protocol v1; legacy `tm.lookupExact` and
`segment.confirm` responses remain compatible.

### 2. Signatures

The additive RPC methods are:

```text
tm.library.list/create/mount/unmount
tm.search
tm.concordance
tm.import/tm.export
termbase.list/create/mount/unmount
term.search/term.upsert
termbase.import/termbase.export
```

`tm.search` accepts `projectId`, source/target locale, query, threshold
`0..101`, bounded offset/limit, library/domain/time/origin filters, and
optional context hashes. `term.search` accepts project, text, termbase IDs,
and bounded paging. Exchange requests identify `libraryId`/`termbaseId`, a
managed input/output path, locale mapping, and `format` (`tmx`, `csv`, `tsv`,
or `tbx`).

### 3. Contracts

- SQLite migration 4 owns `tm_libraries`, mounts, `tm_units`, `termbases`,
  entries, and translations. A fresh or migrated project has a default
  writable TM library and termbase mount.
- TM matches are normalized in Rust and sorted by score, mount priority,
  recency, and ID. Context matches are score `101`; exact matches are `100`.
  Results include source/target metadata and number/date/placeholder
  substitutions.
- CSV/TSV uses RFC-4180 quoting and preserves non-reserved metadata columns;
  TMX/TBX exchange is parsed and revalidated before atomic publication.
- A confirmation writes legacy TM provenance and one idempotent unit per
  enabled writable `write` mount in the same immediate transaction. Forbidden
  term QA uses `term-forbidden:<translationId>` rule IDs and resolves on a
  corrected target.
- Renderer code calls these methods only through generated
  `ENGINE_METHODS`/`DesktopApi`; matching, parsing, and SQLite stay in Rust.

### 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| Unknown library/termbase/project or mount | `not_found` with entity and ID |
| Read-only library/termbase write or invalid format pairing | `invalid_state`/`invalid_request` |
| Stale mount revision | `conflict` with entity, ID, expected, and actual revision |
| Malformed TMX/TBX/CSV/TSV | `invalid_request` with row diagnostics when available; no rows committed |
| Existing export destination | `invalid_state`; destination is unchanged |
| Oversized exchange input or page limit outside `1..500` | `invalid_request` |

Asset error messages and logs never include source/target document text.

### 5. Good / Base / Bad Cases

- Good: mount two reference libraries and one writable library; exact and 101%
  context searches are deterministic, and confirmation retries do not add a
  duplicate unit.
- Base: export a multi-target term entry to TBX/CSV, import it into another
  writable termbase, and preserve preferred/forbidden flags.
- Bad: import a valid row followed by a malformed row, or sink into a
  read-only mount; the transaction rolls back and existing rows remain intact.

### 6. Tests Required

- Asset-core tests assert Unicode normalization, CJK fuzzy ranking, date and
  placeholder substitutions, Latin word boundaries, CSV/TSV, TMX, and TBX
  round trips.
- Storage tests assert migration backfill, default mounts, deterministic
  pages, read-only rejection, context `101`, idempotent multi-mount sinking,
  target-side term recognition, and forbidden QA resolution.
- Engine smoke asserts RPC library/termbase lifecycle, malformed-row rollback,
  TMX/CSV/TBX exchange, concordance, restart persistence, and legacy exact
  lookup.
- VPS quality gates are `cargo fmt --check`, strict clippy, all workspace
  tests, and the stdio smoke. Desktop gates include generated contract drift,
  typecheck, lint, unit tests, build, and Electron E2E.

### 7. Wrong vs Correct

#### Wrong

```typescript
// Renderer parses TMX or invents a fuzzy score for a suggestion card.
const score = levenshtein(query, candidate);
```

#### Correct

```typescript
const result = await window.translunar.invoke("tm.search", {
  projectId,
  sourceLocale,
  targetLocale,
  query,
  threshold: 70,
  offset: 0,
  limit: 50,
  libraryIds: [],
});
// Render the authoritative Rust result; do not recompute score or persistence.
```

## Text, HTML, XLIFF, And SRX Filter Boundary

### 1. Scope / Trigger

Use this contract when adding or changing TXT, Markdown, HTML/XHTML, XLIFF, SRX,
or another source-range filter. The same rules apply to future Office/PDF
filters whenever they emit protected inline tags, notes, or caller-controlled
filter options.

### 2. Signatures

The generic wire methods remain:

```text
document.import ImportDocumentParams -> ImportDocumentResult
document.export ExportDocumentParams -> ExportDocumentResult
filter.list EmptyParams -> FilterListResult
```

`ImportDocumentParams` has an additive optional map:

```rust
pub options: BTreeMap<String, String> // default {}
```

Current keys are `segmentationMode=paragraph|sentence`, `srxPath`,
`translatableAttributes`, `addTranslatableAttributes`, and
`removeTranslatableAttributes`. Engine rejects more than 32 entries, keys
outside 1..64 bytes, or values over 4096 bytes.

The internal request adds Engine-owned context:

```rust
pub struct ImportRequest {
    pub source: PathBuf,
    pub document_id: Option<String>,
    pub source_locale: Option<String>,
    pub options: BTreeMap<String, String>,
}
```

Built-in IDs are `builtin.docx`, `builtin.txt`, `builtin.markdown`,
`builtin.html`, and `builtin.xliff`. SQLite migration 5 adds
`segment_notes(segment_id, id, text, author)` with a composite primary key.

### 3. Contracts

- Engine assigns `document_id` before parsing and every filter namespaces tag
  and note IDs with it. `inline_tags.id` is a global SQLite primary key; an
  ordinal-only ID is invalid across multiple documents.
- Project source locale and caller options flow through Engine to the filter.
  Renderer code never parses SRX, HTML, Markdown, or XLIFF.
- TXT/Markdown/HTML structural paths own exact UTF-8 byte ranges. Export applies
  replacements in descending order and leaves gaps/unowned bytes unchanged.
- XLIFF structural paths use encoded file/unit/segment IDs. Existing target
  inner content is replaced; a missing target is inserted after source. Unknown
  namespaces, metadata, source, IDs, notes, and state remain in the original
  XML.
- SRX 2.0 supports `languagerules`, standard `maprule/languagemap`, break/no-
  break rules, built-in zh/en/ja/ko profiles, and UTF-8 source offsets.
- `publish_bytes_noclobber` is the only shared byte-publication helper. A
  format validates/reparses first, then the helper writes a sibling temporary
  file, fsyncs it, and publishes without replacing an existing path.
- Document insertion persists segments, inline tags, and segment notes in the
  same immediate transaction. A failed parse or uniqueness check removes the
  managed source and commits nothing.

### 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| Unknown filter ID | `not_found` with filter ID |
| Malformed UTF-8/HTML/XHTML/XLIFF/SRX or unsupported XLIFF version | `unsupported_document`; no document/source row |
| Oversized input, option map/key/value, XML depth, or SRX file | typed import failure; no partial persistence |
| Duplicate/overlapping structural range or XLIFF stable path | import/export failure; original source/destination unchanged |
| Existing export destination | `export_error`; destination is not replaced |
| Second tagged document reuses ordinal/tag shape | succeeds because tag IDs include Engine document ID |
| XLIFF notes/state followed by restart | `Store::list_segment_notes` returns the same records |

### 5. Good / Base / Bad Cases

- Good: import sentence-mode TXT, tagged HTML, and XLIFF 2.1 through the same
  RPC; edit, restart, and export each while preserving unowned bytes.
- Base: import XLIFF 1.2 with an existing target, note, state, inline code, and
  unknown namespace; update only target content and reparse the result.
- Bad: generate inline tag IDs from `ordinal + position`, or collect notes in
  the filter event stream but omit them from the storage transaction.

### 6. Tests Required

- SRX unit tests: standard `languagemap`, custom rule, no-break abbreviation,
  decimal/URL, zh/en/ja/ko punctuation, paragraph/sentence offsets.
- Format tests: TXT BOM/CRLF, Markdown code/URL protection, HTML/XHTML tags and
  configurable attributes, XLIFF 1.2/2.1 target/note/state/metadata/inline code,
  malformed input, and no-clobber publication.
- Storage/Engine tests: migration 5, note restart persistence, two similarly
  tagged documents without ID conflict, generic import/export/restart, failed
  import cleanup, and bounded options.
- Stdio smoke must list all five filters and round-trip TXT, Markdown, HTML,
  XLIFF, and legacy/generic DOCX. Desktop E2E must use the synchronized current
  Engine binary.

### 7. Wrong vs Correct

#### Wrong

```rust
// Collides when a second document has the same unit ordinal and tag position.
tag.id = format!("html-tag-{ordinal}-{position}");
// Notes are collected but silently discarded by Store::insert_document.
```

#### Correct

```rust
tag.id = format!("{document_id}-html-tag-{ordinal}-{position}");
transaction.execute(
    "INSERT INTO segment_notes (segment_id, id, text, author) VALUES (?1, ?2, ?3, ?4)",
    params![segment_id, note.id, note.text, note.author],
)?;
```

## External CAT Interchange Boundary

### 1. Scope / Trigger

Use this contract when changing SDLXLIFF, memoQ XLIFF/MQXLZ, another private
CAT dialect, or the vendor-package validation used by those filters. The
Engine and generic filter event stream remain authoritative; Electron never
parses vendor XML or opens a CAT ZIP package.

### 2. Signatures

The wire surface remains the existing generic boundary:

```text
document.import ImportDocumentParams -> ImportDocumentResult
document.export ExportDocumentParams -> ExportDocumentResult
filter.list EmptyParams -> FilterListResult
```

The registered descriptors are:

```text
builtin.sdlxliff  .sdlxliff
builtin.mqxliff   .mqxliff
builtin.mqxlz     .mqxlz
```

Plain XML paths are
`<vendor>:<hex-file-id>:<hex-unit-id>[:<hex-segment-id>]`. MQXLZ paths insert
the hex-encoded package entry name after the vendor prefix. No private-format
RPC or renderer-side model is added.

### 3. Contracts

- `filter-interop` accepts UTF-8 XLIFF 1.2 and bounded 2.x dialects only when
  file, unit, and segment identity is unambiguous. SDL `seg-source` markers,
  memoQ segments, states, locks, comments, and inline codes normalize to the
  existing event, note, and protected-tag model.
- When a segmented unit has explicit source marker IDs, target markers must
  match those IDs one-to-one; a positional fallback is allowed only when the
  corresponding target marker is itself unidentified. Duplicate or mismatched
  explicit IDs are rejected as ambiguous rather than silently re-paired.
- Parsed documents build direct-child and exact-ID indexes once. A unit-level
  note applies to every logical segment in that unit, while a note or unmapped
  vendor field nested under a logical segment belongs only to that segment's
  structural path; exact-ID comment references remain ambiguity checked.
- Import keeps the managed source immutable. Export rewrites only owned target
  content, rejects missing or duplicate structural paths, reparses the result,
  and proves that every source/path identity is unchanged before publication.
  Vendor state/comments and unknown namespaces remain opaque source bytes.
- An unmapped vendor-qualified field inside a supported unit is preserved and
  emits `unsupported_vendor_field`; it is never silently reconstructed or
  dropped, including attributes on nested inline elements. Errors contain
  bounded paths/counts, never source or target text.
- XML has exactly one root element; only whitespace, well-formed comments, and
  terminated processing instructions may occur outside it. Comments cannot
  contain `--` or end in `-`, processing instructions end in `?>`, attributes
  cannot contain an unescaped `<`, and character data cannot contain `]]>`.
- XML text and attribute values must contain only predefined or numeric entity
  references. CDATA is treated as literal text; unknown, unterminated, or
  invalid entity references are rejected as malformed XML.
- XML limits are 64 MiB, depth 256, and 100,000 translatable units. DOCTYPE,
  external declarations, invalid UTF-8, duplicate attributes, duplicate stable
  paths, and ambiguous/missing identities are rejected.
- MQXLZ is single-disk non-ZIP64, contains exactly one `.mqxliff`, `.xlf`, or
  `.xliff` entry, and allows at most 4,096 entries. ZIP64 EOCD/entry sentinels
  and the ZIP64 central-directory extra-field ID are rejected before archive
  construction. Entry names are at most 4,096 bytes; one uncompressed entry is
  at most 256 MiB; total uncompressed size is at most 1 GiB; compression ratio
  is at most 200:1.
- Validate the raw central directory before constructing `ZipArchive`. The
  `zip` crate indexes entries by raw filename and otherwise collapses exact
  duplicate names. Also reject normalized duplicates, traversal/absolute
  names, encryption, overlapping payload ranges, inconsistent directory
  counts/sizes, and more than one candidate XLIFF entry.
- Read each ZIP entry through a limit of its declared uncompressed size and
  reject a decompressed byte count that differs from that declaration.
- MQXLZ export replaces only the selected XML entry through
  `filter-office-core::rebuild_zip`; every auxiliary entry is raw-copied. The
  rebuilt ZIP and vendor XML are re-read before `publish_bytes_noclobber`.

### 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| Malformed/oversized/deep XML, DTD, invalid UTF-8, missing stable identity | `unsupported_document`; no managed source or document row |
| Duplicate import path or duplicate/unknown export path | Typed import/export failure; source and destination unchanged |
| Unsupported vendor-qualified field in a valid unit | Warning degradation with structural path; bytes preserved |
| Traversal, exact/normalized duplicate, encrypted, overlapping, ZIP64, multi-disk, oversized, or ratio-bomb entry | `unsupported_document`; no partial persistence |
| Zero or multiple candidate XLIFF entries | `unsupported_document`; package is not treated as generic XLIFF |
| Rebuilt source/path identity differs | `export_error`; staged bytes are not published |
| Existing output path | `export_error`; existing bytes are unchanged |

### 5. Good / Base / Bad Cases

- Good: import segmented SDLXLIFF with paired inline codes, state, lock, and a
  referenced comment; edit, restart, export, and re-import while opaque vendor
  metadata remains byte-preserved.
- Base: import memoQ 2.x XML or a one-XLIFF MQXLZ, report an unmapped field as a
  degradation, and raw-copy an auxiliary binary entry during export.
- Bad: let `ZipArchive` collapse duplicate central-directory names, fall back
  to `builtin.xliff` while claiming native fidelity, flatten inline markup, or
  publish before the rebuilt package reparses.

### 6. Tests Required

- `filter-interop` tests assert XLIFF 1.2/2.x SDL/memoQ fixtures, segmented
  markers, states/comments, paired/standalone tags, unknown metadata, target
  insertion/replacement, source identity, and no-clobber behavior.
- Adversarial fixtures must contain real duplicate central-directory names and
  encryption flags plus forged oversized metadata, ZIP64 extra/sentinels, a
  ratio bomb, traversal, multiple XLIFF entries, DTD, excessive depth/size,
  text outside the root, invalid comments/processing instructions/attributes,
  forbidden character data, and duplicate paths.
- Engine tests register all three descriptors and prove generic import, note/
  target persistence across restart, QA-gated export, native re-import, opaque
  MQXLZ auxiliary preservation, and stale-destination rejection.
- The real stdio smoke covers XML and ZIP import/edit/restart/export, malformed
  no-partial-persistence behavior, metadata/tag preservation, and no-clobber.
  Contract drift and Electron E2E run with a synchronized current Engine.

### 7. Wrong vs Correct

#### Wrong

```rust
// zip 8.x may collapse duplicate central-directory names before len() is read.
let archive = ZipArchive::new(file)?;
for index in 0..archive.len() {
    validate(archive.by_index(index)?)?;
}
```

#### Correct

```rust
let declared = validate_central_directory(&mut file)?;
file.seek(SeekFrom::Start(0))?;
let archive = ZipArchive::new(file)?;
ensure_entry_count_and_ranges(archive, declared)?;
let rebuilt = rebuild_zip(source, &changed_xml)?;
reparse_vendor_package(&rebuilt)?;
publish_bytes_noclobber(output, &rebuilt)?;
```

## Office OOXML Filter Boundary

### 1. Scope / Trigger

Use this contract when changing DOCX, XLSX, PPTX, or the shared OOXML package
layer. Office filters must preserve the original ZIP package, own exact XML
text ranges, and expose all user selection through the generic filter options
map; Electron never opens an Office ZIP or evaluates a formula/macro.

### 2. Signatures

The wire surface remains unchanged:

```text
document.import ImportDocumentParams -> ImportDocumentResult
document.export ExportDocumentParams -> ExportDocumentResult
filter.list EmptyParams -> FilterListResult
```

Built-in IDs are `builtin.docx`, `builtin.xlsx`, and `builtin.pptx`. Supported
options are:

```text
DOCX: includeComments=true|false
XLSX: sheetNames, sheetIndexes, rowRange, columnRange, includeHiddenSheets
PPTX: slideIndexes, includeNotes, includeMasters
```

Ranges are inclusive; sheet/slide indexes are 1-based. The Engine's shared
32-entry/key/value bounds apply before a filter parses an option.

### 3. Contracts

- `filter-office-core` rejects encrypted, traversing, oversized, duplicate, or
  deeply nested package entries; it never resolves external relationships.
- Unchanged ZIP entries use raw-copy publication. Changed XML parts are
  range-rewritten, reparsed, rebuilt into a staged ZIP, fsynced, and published
  without replacing an existing destination.
- DOCX includes body/table/text-box/header/footer/footnote/endnote text,
  optionally comments, includes `w:ins`/`w:moveTo`, and excludes
  `w:del`/`w:moveFrom`. Legacy body paths remain
  `word/document.xml#p:<index>`.
- XLSX owns cell paths such as
  `xlsx:xl/worksheets/sheet1.xml#cell:B12`. Formulas, numbers, errors, and
  booleans are protected. Translating a reused shared string clones `<si>`,
  updates only the selected cell index, preserves rich-run markup, and updates
  `uniqueCount`.
- PPTX owns paragraph paths by part plus XML owner offset. Slides, shapes,
  tables, and SmartArt are default; notes and masters are option-controlled.
- Macros, ActiveX, embedded objects, and PPTX chart text are preserved as
  opaque parts and reported as warning degradation findings on import/export.
- Inline tag IDs include the Engine-assigned document ID. Office imports use no
  Office-specific schema or RPC methods.

### 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| Missing content-types/root/main relationship or malformed ZIP/XML | `unsupported_document`; no managed source/document |
| Encrypted entry, traversal name, external main part, duplicate relationship ID | typed import failure; no partial persistence |
| Invalid sheet/row/column/slide/boolean option | `invalid_request`/typed import failure |
| Formula, numeric cell, macro, ActiveX, embedded object | not editable; opaque data preserved; applicable degradation returned |
| Unknown/duplicate structural path during export | export failure; destination absent/unchanged |
| Existing destination | `export_error`; no overwrite |
| Untranslated Office document | valid byte-preserving export with translated count 0 |

### 5. Good / Base / Bad Cases

- Good: import a workbook selecting two columns, translate one of two cells
  sharing the same string, restart, and export without changing the other cell
  or its formula neighbors.
- Base: import a DOCX containing table, text box, header/footer, foot/endnotes,
  accepted/deleted revisions, and optional comments; export one footer while
  every unrelated package part remains present.
- Bad: rewrite `sharedStrings.xml` in place for one cell, flatten every Office
  run/property tree, execute a formula/macro, or silently omit chart/embedded
  content without a degradation finding.

### 6. Tests Required

- Office core: range overlap, path traversal, DOCTYPE/depth/size bounds,
  relationship target normalization, external target opacity, and raw-copy
  package reconstruction.
- DOCX: body/table/text box/header/footer/footnote/endnote/comment/revision,
  multi-run Unicode round trip, legacy path/method, malformed input, and
  unchanged custom parts.
- XLSX: sheet/name/index/row/column selection, hidden sheets, shared/inline rich
  strings, shared-string cloning and `uniqueCount`, formula/numeric protection,
  malformed input, restart, and no-clobber.
- PPTX: shape/table/SmartArt/notes/master, multi-run formatting, media/chart/
  embedded preservation and degradation, malformed input, restart, and
  no-clobber.
- Stdio smoke must list seven filters and round-trip DOCX/XLSX/PPTX plus the
  text/interchange filters. Desktop E2E uses the synchronized Windows Engine.

### 7. Wrong vs Correct

#### Wrong

```rust
// Mutates every cell that references shared string 7.
shared_strings[7].text = target;
// Re-serializes the complete workbook and drops opaque ZIP entries.
```

#### Correct

```rust
let cloned_si = clone_shared_string(shared_xml, &shared_strings[7], target)?;
let new_index = shared_strings.len() + appended.len();
rewrite_cell_value(sheet_xml, "B12", new_index)?;
rebuild_package_with_raw_copy(source, changed_parts)?;
```

## PDF/OCR Filter And Page Review Boundary

### 1. Scope / Trigger

Use this contract when changing PDF import, Poppler/Tesseract orchestration,
page preview, OCR source correction, or reconstructed DOCX export. Native PDF
and OCR parsing stays in translunar-filter-pdf; Electron never invokes tools
or parses structural paths.

### 2. Signatures

The generic filter methods register builtin.pdf. Page review and OCR
correction add these protocol-v1 methods:

    pdf.page.list   PdfPageListParams -> PdfPageListResult
    pdf.page.get    PdfPageGetParams  -> PdfPageDetail
    pdf.correctOcr  CorrectOcrParams  -> Segment

Import options are pageRange, segmentationMode, srxPath, ocrMode,
ocrLanguages, ocrDpi, toolTimeoutMs, pdfTextCommand, pdfInfoCommand,
pdfRenderCommand, and ocrCommand. Executables resolve from the explicit
option, then the matching TRANSLUNAR_*_PATH environment variable, then PATH.

### 3. Contracts

- pdftotext -bbox-layout owns text-layer extraction, pdfinfo owns page and
  encryption metadata, pdftoppm owns bounded PNG rendering, and Tesseract TSV
  owns OCR words/confidence. Every tool uses Command arguments, never a shell.
- Time, output bytes, page count, source size, page range, DPI, and language
  options are bounded. Timeout and output overflow kill and reap the child.
- ocrMode=auto OCRs only selected pages without meaningful text; always OCRs
  every selected page; never retains empty scanned pages as an explicit
  degradation rather than silently claiming translated content.
- Structural paths encode page, deterministic block order, kind, milli-point
  bbox, source kind, and confidence.
- Page list/get project persisted segments and revisions. page.get renders one
  managed-source page at 72..200 DPI and returns at most 32 MiB of PNG as
  base64; previews are never persisted.
- pdf.correctOcr requires a changed non-empty source, reason, expected
  revision, OCR-origin path, and non-confirmed state. One immediate transaction
  updates source/revision/hash, recalculates neighboring context hashes, and
  appends a reasoned pdf.correct_ocr operation.
- PDF export creates a no-clobber DOCX with page breaks, heading/body styles,
  reconstructed table rows/cells, source fallback for untranslated segments,
  and PDF page size. The staged package passes DocxFilter validation before
  publication.

### 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| Bad header, encrypted PDF, invalid bbox/TSV, or page count outside bounds | typed unsupported_document; no document/source row |
| Required tool missing, nonzero, timed out, or oversized | actionable import/page error naming the tool class; no page loss |
| Invalid mode/range/language/DPI/timeout | invalid_request or typed import error before persistence |
| pdf.page.* on non-PDF or page outside range | invalid_request or not_found |
| Stale, non-OCR, unchanged, empty, or confirmed correction | conflict or invalid_state; no hash/history mutation |
| Existing DOCX destination or invalid staged package | export_error; destination unchanged |

Errors may include tool IDs, page numbers, counts, and exit class. They never
include source text, OCR bodies, arbitrary stderr, or user secrets.

### 5. Good / Base / Bad Cases

- Good: import mixed PDF, keep text page 1, OCR page 2, restart, review PNG,
  correct one OCR block, translate it, and export a re-importable DOCX.
- Base: import scanned PDF with ocrMode=never; persist a zero-segment PDF with
  explicit degradation and page preview.
- Bad: parse PDF in Electron, silently skip a scanned page when OCR is missing,
  mutate a confirmed source, or overwrite an export.

### 6. Tests Required

- Filter tests use real text/scanned/mixed fixtures and assert column order,
  tables, geometry, auto/always/never, page range, language/DPI, missing tools,
  malformed options, no-clobber, and DOCX re-import.
- Storage tests assert source/context hashes, neighbor recalculation, conflict,
  reasoned history, and confirmed/non-OCR rejection.
- Stdio smoke covers registration, restart, page PNG, OCR correction, stale
  conflict, DOCX export, no-clobber, and DOCX re-import.
- Electron E2E under Node 22 plus Poppler/Tesseract covers import, page/block
  comparison, correction, target edit, panel modes, export, and console errors.
- Render fixture and reconstructed pages to PNG and inspect nonblank,
  non-overlapping output at supported desktop sizes.

### 7. Wrong Vs Correct

Wrong: the renderer runs OCR, changes sourceText, and increments revision.

Correct: the renderer calls pdf.correctOcr with segmentId, sourceText, reason,
and expectedRevision, then replaces display state with the returned Segment.

## Professional Editor And OpenCC Boundary

### 1. Scope / Trigger

Use this contract for protected target tags, editor history, comments, review,
workflow state, spelling, Chinese conversion, and any new editor mutation. The
Engine and SQLite remain authoritative; renderer code only supplies a command,
an expected revision, and presentation intent.

### 2. Signatures

The additive protocol-v1 surface includes:

```text
segment.editor.list
segment.tag.set
segment.chinese.convert
segment.propagate
segment.find
segment.replace.preview / segment.replace.apply
segment.split / segment.merge / segment.correctSource / segment.workflow.set
segment.comment.list/create/update/resolve/delete
segment.spell.check / dictionary.list/add/remove
editor.undo / editor.redo / editor.history
review.create/list/accept/reject
editor.preferences.get/update
```

`segment.chinese.convert` accepts `segmentId`, `expectedRevision`, and one of
`simplifiedToTraditional`, `simplifiedToTaiwan`,
`simplifiedToHongKong`, `traditionalToSimplified`,
`taiwanToSimplified`, or `hongKongToSimplified`, and returns an
`EditorMutationResult`.

### 3. Contracts

- Migration 6/7 editor tables and every editor mutation participate in one
  immediate transaction and one durable undo/redo snapshot. Confirmation
  snapshots include legacy TM, mounted TM units, and QA side effects.
- `segment.tag.set` allows `tag_missing` findings so a translator can build a
  valid target structure incrementally. Wrong-side, out-of-range, extra,
  incomplete-pair, and crossed/order findings reject the write. Confirmation
  rejects every remaining tag finding.
- Equal-position tag order is the submitted/insertion order. Validation uses a
  stable position sort and SQLite reload uses `ORDER BY position, rowid`; tag ID
  lexical order must not put an end tag before its start tag.
- Chinese conversion uses embedded OpenCC phrase dictionaries through the
  pure-Rust `ferrous-opencc` dependency. It performs no download, subprocess,
  or runtime dictionary lookup. The converted target, tag position clamp,
  revision, operation reason, and undo snapshot commit atomically.
- Signed segments reject content/tag/source/conversion writes. Review and
  workflow operations remain available so a reviewer can deliberately return a
  segment to an editable state.

### 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| Stale segment revision | `conflict` with expected/actual revision; no history row |
| Partial but structurally valid target tags | Persist and return live `tag_missing` findings |
| Extra, crossed, incomplete, wrong-side, or out-of-range tag | `invalid_state`; target tags unchanged |
| Confirm with any tag finding | `invalid_state`; no TM/QA/state side effect |
| Chinese conversion on empty, unchanged, or signed target | `invalid_state`; no revision/history change |
| Unknown conversion profile | `invalid_request` during protocol deserialization |
| OpenCC embedded configuration failure | `invalid_state` without source/target content |

### 5. Good / Base / Bad Cases

- Good: insert one complete tag pair at a collapsed caret, observe remaining
  missing tags, add/move the rest, confirm, restart, and export valid structure.
- Good: convert `鼠标和打印机里的软件` with `simplifiedToTaiwan`, receive
  `滑鼠和印表機裡的軟體`, undo, restart, and redo the same phrase-aware result.
- Base: a target already matching the selected Chinese profile returns an
  explicit no-change error instead of inventing a revision.
- Bad: sort equal-position tags by source ID, or reject every partial tag set;
  both make pair insertion at a caret impossible.

### 6. Tests Required

- Editor-core unit tests assert equal-position pair order and OpenCC phrase
  conversion in both directions.
- Engine tests assert partial-pair persistence with live missing findings,
  confirmation blocking, conversion undo/redo across restart, signed read-only,
  redo branch invalidation, and TM/QA restoration.
- Stdio smoke calls `segment.chinese.convert` and proves undo restores the
  simplified target.
- Electron E2E covers pair insertion/move, comment CRUD, source/target/tag
  review, signed read-only, and Chinese conversion through the real Engine.

### 7. Wrong vs Correct

#### Wrong

```rust
// Lexical ID order can place `:end` before `:start` at the same caret.
tags.sort_by_key(|tag| (tag.position, tag.id.clone()));
// Rejects the first valid pair because other source tags are still missing.
if !validate_target_tags(source, target, text).is_empty() { return Err(...); }
```

#### Correct

```rust
tags.sort_by_key(|tag| tag.position); // stable: submitted order wins ties
let blocking = issues.iter().filter(|issue| issue.code != "tag_missing");
// Persist incremental structure; confirmation performs the complete check.
```

## Grounded BYOK AI Boundary

### 1. Scope / Trigger

Use this contract for provider profiles, credentials, grounded prompts,
interactive AI proposals, batch pretranslation, AI usage, or AI pipeline steps.
The Engine owns policy, provider I/O, retries, durable state, usage, and every
target mutation. Renderer code never calls a provider directly.

### 2. Signatures

Protocol v1 exposes the additive `ai.provider.*`, `ai.settings.*`,
`ai.grounding.preview`, `ai.run.*`, `ai.result.apply`, `ai.batch.*`,
`ai.usage.query`, and `ai.conversation.*` families. `ai.credential.set` is an
internal Engine dispatch operation reached only through the main/preload
trusted credential channel; it is deliberately absent from the generated
renderer method catalog.

Grounding options and Engine-owned input include the additive corpus shape:

```rust
pub struct GroundingOptions {
    #[serde(default = "default_include_corpus")] // true
    pub include_corpus: bool,
    #[serde(default = "default_corpus_top_n")] // 5, maximum 10
    pub corpus_top_n: u8,
    // existing term, TM, context, style, and character options
}

pub struct GroundingInput {
    #[serde(default)]
    pub corpus_matches: Vec<GroundingCorpusMatch>,
    // existing active-segment and asset fields
}

pub struct GroundingCorpusMatch {
    pub corpus_id: String,
    pub corpus_name: String,
    pub source_label: String,
    pub structural_path: String,
    pub matched_side: GroundingCorpusMatchedSide,
    pub source: String,
    pub target: Option<String>,
}
```

### 3. Contracts

- Migration 8 stores revisioned non-secret profiles/settings, runs/events,
  batches/items, exactly-once usage, and conversations/messages. Provider
  secrets live only in the OS keyring behind an opaque workspace/profile key.
- Custom remote endpoints require HTTPS. Loopback HTTP is allowed for local
  engines and deterministic fixtures. Redirects are disabled, response/SSE
  sizes and timeouts are bounded, and errors crossing RPC are redacted.
- Grounding is rebuilt from Engine-owned segment, tags, terms, TM, style, and
  bounded context. The stored prompt hash and active-segment revision must
  still match before network I/O.
- Grounding options validate before any Store read. When corpus grounding is
  enabled, Engine searches active project corpora with the active source text,
  `side=both`, `offset=0`, and `limit=corpusTopN`; it preserves Store order and
  emits a `corpus` section before document context.
- Corpus matches expose corpus ID/name, file name or matched alignment-document
  ID, structural path, matched side, and source/optional target. A target-only
  monolingual row keeps an empty source plus populated target and is never
  projected as a bilingual TM example.
- Corpus JSON is untrusted data inside `<grounding-section>` delimiters. Literal
  angle brackets are JSON Unicode-escaped before rendering so corpus text
  cannot close the delimiter or inject an instruction.
- Interactive completions remain proposals until `ai.result.apply` validates
  run/segment revisions, signed state, and protected tags, then delegates to
  the normal editor mutation/history path.
- Batch workers claim durable items, prefer authoritative TM, rate-limit
  provider work, and use expected revisions for drafts. Batch grounding omits
  neighboring target text while retaining neighboring source text: another
  worker may update those targets between run creation and execution, and such
  batch-owned writes must not invalidate the prompt hash. Interactive runs keep
  bilingual context.
- Usage is committed once per `(run_id, attempt)`. Disabled AI, disallowed
  request kinds/origins, missing credentials, and exhausted monthly budgets
  fail before provider I/O.

### 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| Missing/unavailable OS credential storage | `credential_unavailable`; no plaintext fallback |
| Disabled policy or exhausted budget | `ai_disabled` / `budget_exceeded` before network I/O |
| Auth, rate, timeout, protocol, or availability failure | Stable typed provider error with retryability and no body/secret |
| Stale or signed interactive target | Conflict/read-only error; proposal remains unapplied |
| AI output with invalid protected tags | Typed rejection; no target write |
| Restart with active run/batch item | Durable interrupted state that can resume within bounded attempts |
| Missing additive corpus options in an older persisted request | Deserialize as `includeCorpus=true`, `corpusTopN=5` |
| `corpusTopN > 10` | `InvalidGrounding` before project, segment, or corpus reads |

### 5. Good / Base / Bad Cases

- Good: create a keyring-backed profile, preview bounded grounding, stream a
  proposal, apply it through the editor revision path, restart, and recover the
  conversation and usage without any secret in SQLite.
- Base: disable AI or omit a keyring capability; non-AI editing, filters, TM,
  QA, and export remain available while real AI requests fail explicitly.
- Base: no active corpus matches, `includeCorpus=false`, or `corpusTopN=0`
  omits the corpus section without changing the existing grounding sections.
- Bad: persist a prompt/credential for later replay, let renderer code call a
  provider, or include neighboring batch targets in a prompt hash that another
  worker can change before execution.
- Bad: let the renderer fetch/re-rank corpus rows, treat target-only content as
  bilingual, or interpolate raw corpus text outside the delimited JSON section.

### 6. Tests Required

- AI-core fixtures cover OpenAI-compatible SSE, Anthropic, Gemini, DeepL,
  catalog/URL validation, bounds, retries, cancellation, usage, and redaction.
- Storage and Engine tests cover keyring lifecycle, restart recovery, grounding,
  streaming, explicit resume, TM-first concurrent batches, protected tags,
  budget gates, and exactly-once usage.
- AI-core tests assert legacy option defaults, the `0..=10` corpus bound,
  deterministic top-N order, corpus-before-context placement, character bounds,
  and delimiter escaping. Engine tests import source- and target-monolingual
  corpora and assert file/path/side provenance in `ai.grounding.preview`.
- Stdio smoke and Electron E2E use loopback fixtures only. They must prove the
  secret is absent from SQLite, protocol payloads, renderer state, and errors.

### 7. Wrong vs Correct

#### Wrong

```rust
// Another worker can update this target after run creation and stale the hash.
batch_context.target = neighboring_segment.target_text;
// Renderer-visible generic RPC accepts a plaintext credential.
catalog.register("ai.credential.set");
```

#### Correct

```rust
batch_context.target = String::new(); // stable source-only batch context
// Main/preload trusted IPC calls EngineClient::callInternal instead.
let corpus = store.search_reference_corpora(&ReferenceCorpusSearchRequest {
    project_id,
    query: active_source,
    side: ReferenceCorpusSearchSide::Both,
    offset: 0,
    limit: u32::from(options.corpus_top_n),
    corpus_ids: Vec::new(),
})?; // Engine projects this authoritative order into delimited grounding data.
```

## Comprehensive QA, Review, And Delivery Gate

### 1. Scope / Trigger

Use this contract when changing mechanical/CJK QA, profiles, issue waivers,
reports, review statistics/state, or any original-format export.

### 2. Signatures

Protocol v1 exposes additive `qa.profile.*`, `qa.run`, `qa.run.list/get`,
`qa.issue.list/waive/revoke`, `qa.report.export`, `qa.gate.check`,
`qa.override.list`, `review.queue`, and `review.stats`. `document.export` and
legacy `document.exportDocx` accept optional
`qaOverride { actor, reason }`; `segment.workflow.set` accepts optional actor
and reason for a direct translation-to-signed transition.

Migration 9 owns `qa_profiles`, `qa_runs`, `qa_run_items`, `qa_waivers`,
`qa_report_records`, and `qa_export_overrides`, plus additive QA issue columns.
Built-in Standard and CJK profiles are deterministic migration seeds.

### 3. Contracts

- `qa-core` is provider-free and owns validated profiles, deterministic rule
  evaluation/fingerprints/scalar spans, and escaped HTML/formula-safe XLSX.
- Storage resolves locale defaults, gathers authoritative tags/terms/segments,
  reconciles findings, preserves matching waivers, and derives review data.
- Every original-format export runs fresh QA. Open unwaived errors return
  `qa_gate_blocked` before publication. An override is valid only when the gate
  is blocked and its pending attempt must finish as succeeded or failed.
- Reports and document exports validate staging and publish no-clobber. A
  report DB failure removes the published file rather than leaving an orphan.
- `reviewRequired` defaults to true for old and new projects. When false, a
  translation-to-signed transition still requires bounded actor and reason and
  records both in durable editor history.

### 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| Invalid/duplicate/bounded regex profile data | `qa_profile_invalid`; no persistence |
| Open unwaived error at export | `qa_gate_blocked` with IDs/counts only; no output |
| Override on a clear gate | `invalid_request`; no audit row or export |
| Blocked override missing actor/reason | `invalid_request`; no publication |
| Existing report/export destination | typed export error; destination unchanged |
| Direct sign-off while review is required | invalid state; no workflow mutation |
| Direct sign-off without actor/reason | invalid request; no history mutation |

### 5. Good / Base / Bad Cases

- Good: clone a built-in profile, add a validated regex, run project/document
  QA, waive/revoke by fingerprint, export both reports, then resolve blockers
  or perform one explicit audited delivery override.
- Base: a clean document exports normally and rejects an unnecessary override.
- Bad: let React recompute findings/gate totals, carry a waiver to a changed
  fingerprint, skip fresh QA for a legacy export, or mark a failed override as
  succeeded.

### 6. Tests Required

- QA-core covers every rule family, Unicode spans/fingerprints, hostile HTML,
  formula-looking XLSX text, and consistency grouping.
- Storage covers migration 9 fresh/upgrade/rollback/reopen, profile revisions,
  live reconciliation, runs/pages, terms/consistency, waivers, gate/override,
  review queue/stats, and direct sign-off history.
- Engine and stdio smoke cover dirty multilingual data, both report formats,
  blocked/no-output export, successful override, restart, and legacy exports.
- Electron E2E uses the real Engine for profile regex, report buttons,
  navigation, waive/revoke, three QA/export viewports, review policy/direct
  sign-off, blockers, and override without console/page errors.

### 7. Wrong vs Correct

#### Wrong

```typescript
const clear = visibleIssues.filter((issue) => issue.severity === "error").length === 0;
await invoke("document.export", { documentId, outputPath, qaOverride: { actor, reason } });
```

#### Correct

```typescript
const gate = await invoke("qa.gate.check", { projectId, documentId });
await invoke("document.export", {
  documentId,
  outputPath,
  ...(!gate.clear ? { qaOverride: { actor, reason } } : {}),
});
```

## Project Lifecycle And Analytics

### 1. Scope / Trigger

Use this contract for multi-file project setup, templates, source re-import,
project archives, recycle/history, global search, analysis, or operational
analytics. These operations are Engine-owned and are additive to legacy
single-document and workspace-backup methods.

### 2. Signatures

Protocol v1 exposes `project.template.*`, `document.reimport.preview/apply`,
`project.archive.export/restore`, `recycle.*`, `search.global`,
`analysis.profile.list`, `analysis.run/get`, and `project.analytics.get`.
Migration 10 stores template revisions, document versions/re-import previews,
recycle entries, archive records, analysis snapshots, and search projections.

### 3. Contracts

- Batch import accepts bounded OS paths and returns one diagnostic per input;
  Engine normalizes relative paths, rejects traversal/collisions, and never
  reads source content in Electron.
- Re-import previews are tied to document revision and source hash. Apply is
  expected-revision protected and preserves unchanged target/tags/comments;
  removed rows remain recoverable as superseded versions.
- Archive restore validates schema, limits, entry hashes, and dependencies
  before one atomic transaction. It always creates a new project identity and
  never includes credentials or external shared-library content.
- Normal search, recycle, and analytics queries exclude soft-deleted rows;
  analysis and weighted effort are snapshots with explicit stale state and
  deterministic integer weights. Missing historical instrumentation is null,
  never fabricated as zero.
- The global-search FTS projection retains both active and recycled project,
  document, and segment rows. `includeRecycled` is enforced by the query, not
  by deleting trash rows during projection rebuild; otherwise an admin search
  cannot recover recycled content after restart or another rebuild.
- `project.get`, `document.list`, project counts, and analytics expose active
  documents only. Recycled document relative paths still reserve collision
  keys for batch import until restore or purge, so a hidden document cannot be
  shadowed by a second import at the same project-relative path.
- A permanent document/project purge deletes dependent segment rows inside the
  same immediate transaction before the document cascade reaches version rows
  protected by restrictive foreign keys.
- ZIP entry read failures and malformed archive manifest/project JSON map to
  `invalid_request`. Restore staging is discarded and SQLite remains unchanged.

### 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| Traversal, collision, unsupported batch item | Per-file diagnostic; no silent drop |
| Stale re-import preview or mutable project revision | `conflict`; no partial write |
| Invalid archive schema/hash/limit/dependency | typed invalid request; workspace unchanged |
| Truncated ZIP entry or malformed manifest/project JSON | `invalid_request`; workspace unchanged |
| Search/recycle/analytics references purged item | Exclude from normal result; admin history remains bounded |
| Recycled document/project | Exclude from snapshots, counts, and normal search; include when explicitly requested; reserve relative paths |
| Purge a document with current/superseded versions | Delete dependent segments then cascade in one transaction; no FK failure |
| Analysis source/config revision changed | `stale: true`; caller must rerun |

### 5. Good / Base / Bad Cases

- Good: import two nested files, restart, page deterministic results, re-import
  one file, and observe unchanged target state plus explicit mapping counts.
- Base: restore a valid archive into a new identity while reporting unresolved
  shared dependencies for deliberate remapping.
- Bad: let React calculate words/weights, overwrite an archive destination,
  transfer an ambiguous translation, or expose recycled text in search.

### 6. Tests Required

- Lifecycle-core tests cover normalized matching, Unicode/CJK counts,
  repetition, integer weighting, and manifest hashes.
- Storage tests cover migration 10 fresh/upgrade/rollback/reopen, template
  revisions, stale previews, recycle/purge, search reconciliation, snapshots,
  and archive transaction rollback.
- Storage regressions recycle and restore a searchable document, prove
  `includeRecycled` survives projection rebuild/restart, verify active-only
  project/document projections, and purge versioned documents and projects.
- Engine/stdio tests cover batch import, both re-import directions, archive
  restore validation (including malformed JSON/ZIP), no-clobber, restart,
  search exclusion/inclusion, and analytics null history.
- Electron E2E uses the real Engine for wizard/drop, template, search,
  re-import preview, recycle/archive actions, analytics, three viewports, and
  no console/page errors.

### 7. Wrong vs Correct

#### Wrong

```typescript
const words = sourceText.trim().split(/\s+/u).length;
await invoke("document.reimport.apply", { documentId, rows });
```

#### Correct

```typescript
const analysis = await invoke("analysis.run", { projectId, profileId });
await invoke("document.reimport.apply", {
  documentId,
  previewId,
  expectedRevision: document.revision,
});
```

#### Wrong

```rust
// Rebuilding only active rows makes includeRecycled permanently empty.
SELECT id FROM projects WHERE lifecycle != 'trash';
```

#### Correct

```rust
// Rebuild the complete projection; normal/admin visibility is query policy.
SELECT id FROM projects ORDER BY id;
// search_global adds lifecycle predicates unless include_recycled is true.
```

## Bilingual Review And Table Interop

### 1. Scope / Trigger

Use this contract for signed bilingual review DOCX export/import, explicit
two-column DOCX/XLSX filters, durable interop previews, or table-to-TM writes.
Rust owns package parsing, canonical hashes, row classification, revisions,
review/comment/workflow effects, TM provenance, and persistence. Electron owns
only trusted file selection and presentation of generated protocol results.

### 2. Signatures

Protocol v1 exposes these additive methods:

```text
interop.review.export  ReviewExportParams  -> ReviewExportResult
interop.review.preview ReviewPreviewParams -> ReviewPreviewResult
interop.review.apply   ReviewApplyParams   -> InteropApplyResult
interop.table.preview  TablePreviewParams  -> TablePreviewResult
interop.table.apply    TableApplyParams    -> InteropApplyResult
```

Review and table previews accept exactly one of `inputPath` or `previewId`,
plus a project/document or project/library binding, expected revision, and
bounded `offset`/`limit`. Apply requests contain the preview ID, the matching
expected revision, explicit row IDs, actor, and reason. Migration 11 backs
`Store::create_interop_preview`, `Store::apply_review_interop`, and
`Store::apply_table_interop` with `interop_previews` and
`interop_preview_rows`.

Generic filter registration is additive:

```text
builtin.bilingual-docx .docx
builtin.bilingual-xlsx .xlsx
```

Ordinary `builtin.docx` and `builtin.xlsx` probe and export behavior remains
unchanged.

### 3. Contracts

- A review artifact is a newly generated three-visible-column DOCX. Its custom
  JSON manifest contains `formatVersion`, project/document IDs, base document
  revision, and rows of `rowId`, `segmentId`, `segmentRevision`, `ordinal`, and
  normalized `sourceHash`. `manifestHash` is SHA-256 over that canonical shape
  with the hash field omitted; editable target/comment/status text is excluded.
  This is tamper evidence, not a cryptographic reviewer identity signature.
- Review row IDs are opaque and distinct from segment IDs. Duplicate manifest
  bindings or table identities fail parsing. Missing source/target bookmarks,
  source/hash tamper, unsupported status/tag edits, or ambiguous bindings make
  the affected row `invalid`; package rows absent from the manifest are
  `added`, and manifest rows absent from the table are `missing`.
- Review preview classifies every row as `changed`, `unchanged`, `missing`,
  `added`, or `invalid`, stages the input under `tmp/`, and persists only the
  preview projection. It writes no target, review, comment, workflow, or TM
  state. A staged preview can be paged after restart.
- Review apply accepts only selected `changed` rows. One immediate transaction
  revalidates document and segment revisions/source hashes, creates review and
  additive comment/workflow context, increments the document revision once,
  appends one operation, and marks the preview terminal. Replaying an applied
  preview returns its stored terminal result without duplicate side effects.
- Bilingual DOCX/XLSX modes treat the first two logical columns as source and
  target, detect an optional per-group header, retain extra named columns as
  bounded metadata, and report deterministic one-based source rows and
  structural paths. Formulas and unsupported typed cells are rejected.
- Table preview derives a stable row ID from input SHA-256, source row, source
  hash, and target hash. It rejects a read-only or locale-mismatched library
  before staging; dispositions are `valid`, `duplicate`, or `invalid`. Apply
  revalidates writability, locales, revision, selected rows, and duplicates
  before inserting any unit. Provenance metadata includes
  `previewId`, `rowId`, `sourcePathHash`, `sourceRow`, and `sourceFormat`.
- `filter-office-core::validate_xml` requires exactly one closed root element,
  rejects character data outside it, and rejects DTD/depth/size violations.
  Review export reparses the complete generated package before no-clobber
  publication. Inputs remain subject to Office package limits, 100,000 rows,
  1 MiB source/target cells, and bounded comments/metadata.
- Renderer and main code consume generated method payloads and never open ZIPs,
  parse XML, compute manifest/row hashes, classify rows, or mutate SQLite/TM.

### 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| Existing review/export destination | `export_error`; existing bytes are unchanged |
| Invalid manifest digest/binding, duplicate identity/bookmark, malformed or unclosed XML/ZIP | `unsupported_document`; staging is removed and no preview is stored |
| Source tamper, missing marker, unsupported status/tag edit | Persist an `invalid` preview row; selecting it returns `invalid_state` with no writes |
| Stale document/segment/library revision | `conflict` before persistence/apply; preview remains open where applicable |
| Formula, unsupported cell type, empty table, wrong explicit format | Typed import failure; staging and document/TM state are unchanged |
| Duplicate/invalid/unselected row | Visible in the preview and never silently applied |
| Read-only library or locale mismatch at preview/apply | `invalid_state`; no staging, TM unit, revision, or operation change |
| Malformed accepted row or later SQLite failure | Roll back every selected TM/review side effect and keep the preview retryable |

Errors and operations may contain IDs, hashes, row numbers, and counts. They
must not contain source/target bodies, comments, credentials, or package bytes.

### 5. Good / Base / Bad Cases

- Good: export a review, edit one target/comment, preview one `changed` and the
  remaining `unchanged` rows, apply the selected row, restart, and replay the
  same terminal result without duplicate reviews/comments.
- Good: preview a two-column XLSX with named metadata, select valid rows, and
  persist one library-revision increment plus complete row provenance.
- Base: a returned review omits one bound row and adds an unbound row; both stay
  visible as `missing`/`added` and neither is selectable for apply.
- Bad: parse DOCX/XLSX in TypeScript, infer a table mode from an ordinary
  Office probe, trust a manifest instead of current SQLite revisions, or insert
  TM rows before validating the complete selection.

### 6. Tests Required

- Office/interchange unit tests assert canonical manifest hashes, editable
  target/comment digest stability, duplicate/missing/malformed bookmarks,
  source tamper, unclosed/multiple XML roots, limits, no-clobber, table headers,
  multi-run/shared/inline strings, formulas, structural paths, and opaque parts.
- Storage tests assert migration 11 fresh/upgrade/rollback/reopen, durable
  paging, atomic review/comment/TM writes, provenance, idempotent restart,
  malformed accepted-row rollback, and stale/read-only library no-write paths.
- Engine tests assert all five review dispositions, invalid-row blocking,
  stale conflicts with no preview, generic filter compatibility, table
  duplicate/invalid diagnostics, staging cleanup, and restart behavior.
- The real stdio smoke covers review export/edit/preview/apply, stale/tamper/
  malformed/no-clobber, table preview/apply/duplicate, restart/idempotence, and
  cleanup. Generated schema and TypeScript must remain byte-equal.
- Real-Engine Electron E2E covers trusted dialogs, changed/valid selection,
  proposal/TM results, pagination/terminal states, three supported viewports,
  horizontal overflow, and console/page errors.

### 7. Wrong vs Correct

#### Wrong

```typescript
// Renderer opens the package, trusts its revision, and writes selected rows.
const rows = parseDocxZip(await readFile(path));
await importTmRows(rows.filter((row) => row.target));
```

#### Correct

```typescript
const preview = await window.translunar.invoke("interop.table.preview", {
  projectId,
  libraryId,
  inputPath,
  format: "xlsx",
  sourceLocale,
  targetLocale,
  expectedLibraryRevision: library.revision,
  offset: 0,
  limit: 50,
});
// Render preview.rows and apply only explicit Engine-classified valid row IDs.
```

## Alignment Refinement Boundary

### 1. Scope / Trigger

Use this contract for optional provider-backed refinement of a persisted
alignment session. The deterministic alignment plan and all link ownership
rules remain usable without AI. Engine owns provider policy and I/O, while the
alignment-core crate owns strict response parsing and partition validation.

### 2. Signatures

The persisted run request adds this additive field:

```rust
pub alignment_refinement: Option<AlignmentRefinementRunContext>;

pub struct AlignmentRefinementRunContext {
    pub session_id: String,
    pub expected_session_revision: u64,
    pub links: Vec<AlignmentRefinementLinkRevision>,
    pub actor: String,
    pub reason: String,
    pub correlation_id: Option<String>,
}
```

The storage boundary exposes `prepare_alignment_refinement` and
`complete_alignment_refinement_run`; the pure validator exposes
`parse_alignment_refinement_response(response, source, target)`.

### 3. Contracts

- A refinement selects at most 64 proposed links and at most 64 source and
  target snapshot segments per side. Serialized selection input is bounded to
  256 KiB; the provider response is bounded to 64 KiB and evidence to 240
  Unicode scalar values.
- The worker rebuilds source/target snapshots and the prompt hash from SQLite,
  then verifies them before provider I/O. The persisted request contains IDs,
  revisions, actor, reason, and correlation only; it never stores source or
  target text.
- The provider must return exactly one JSON object with `links`. Each link has
  only `sourceSegmentIds`, `targetSegmentIds`, `confidenceBasisPoints`, and
  single-line `evidence`. Unknown fields, text echoes, unknown IDs, duplicate
  or crossing members, incomplete partitions, and confidence above 10000 are
  rejected as one whole response.
- Provider deltas are discarded for refinement. A valid response replaces the
  selected partition in one immediate transaction, creates `origin=ai` and
  `status=proposed` links, records the operation, completes the AI run, and
  commits usage together. No refinement can confirm a link or write TM data.
- Structured refinement is rejected before network I/O for DeepL-style
  providers that do not expose a structured chat response.

### 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| Stale session, document, snapshot, or selected-link revision | `conflict`/`alignment_stale`; no provider call or link write |
| Missing/unknown/duplicate/crossing member or incomplete partition | `alignment_response_invalid`; original links and session revision unchanged |
| Unknown response field, text echo, malformed JSON, oversized response, or invalid confidence | `alignment_response_invalid`; no proposal text or delta is persisted |
| Provider unavailable, credential/policy failure, or cancellation | Typed failed/canceled run; deterministic session remains usable |
| SQLite failure while replacing links or completing the run | Transaction rollback; usage and audit are not partially committed |

Errors and audit projections contain bounded IDs, counts, and error codes only;
they never include provider response bodies, prompts, credentials, or segment
text.

### 5. Good / Base / Bad Cases

- Good: a valid ID-only response produces proposed AI links and one session
  revision, while the same run records usage and an audit operation atomically.
- Base: an unavailable provider or malformed response leaves deterministic
  links untouched; a later manual edit remains possible.
- Bad: stream provider text into `ai_run_events`, trust a response's text
  fields, or auto-confirm/apply a model suggestion.

### 6. Tests Required

- Alignment-core fixtures assert accepted output, strict unknown-field/text-
  echo rejection, duplicate/crossing/unknown members, confidence and byte
  limits, and complete partition validation.
- Storage fixtures assert atomic accepted replacement, proposed/AI provenance,
  usage and audit rows, rollback on invalid output, restart persistence, and
  stale selection rejection.
- Engine fixtures assert prompt-hash revalidation, no source text in the
  persisted request, no delta events, unavailable and canceled runs, and
  offline alignment behavior without a provider.
- Contract drift must keep the generated JSON Schema and TypeScript projection
  byte-equal for the additive run field.

### 7. Wrong vs Correct

#### Wrong

```rust
// A streaming delta becomes durable before the response is validated.
store.append_ai_run_delta(run_id, provider_chunk)?;
```

#### Correct

```rust
let response = execute_provider_without_persisted_deltas(...)?;
let suggestions = parse_alignment_refinement_response(response.as_bytes(), &source, &target)?;
store.complete_alignment_refinement_run(run_id, response, provider, &usage, elapsed_ms)?;
```

## Alignment TM Apply Boundary

### 1. Scope / Trigger

Use this contract when sinking confirmed alignment links into a translation
memory. Storage owns selection validation, current-snapshot checks,
deduplication, provenance, terminal state, revision changes, and idempotent
replay. Candidate creation, manual correction, and AI refinement cannot write
TM units implicitly.

### 2. Signatures

The storage boundary is:

```rust
Store::apply_alignment_to_tm(ApplyAlignmentToTm) -> Result<AlignmentApplyResult>
```

`ApplyAlignmentToTm` contains `session_id`, `library_id`, expected session and
library revisions, explicit `(link_id, expected_revision)` selections, actor,
reason, and optional correlation ID. `AlignmentApplyResult` returns selected,
inserted, and duplicate counts; resulting session/library revisions; one
operation ID; inserted TM unit IDs; and duplicate link-to-unit mappings.

### 3. Contracts

- Apply accepts 1..100,000 unique bounded link IDs. Actor is at most 256 bytes,
  reason at most 4,096 bytes, and IDs/correlation IDs at most 256 bytes. Link
  selections are sorted canonically only for request fingerprinting; persisted
  link order remains session order.
- One `TransactionBehavior::Immediate` transaction revalidates the open
  session, active project, both document revisions, every immutable snapshot
  against the current segment ID/order/revision/hash/text, the complete link
  partition, every selected link revision/status/side, and the TM library
  revision/writability/locales before inserting a unit.
- Only explicitly selected, confirmed, non-empty bilingual links apply.
  Content deduplication uses `(exact_key(source), sha256(normalized target))`
  against both existing library units and earlier links in the same request.
- New TM units keep `origin_segment_id = NULL` so normal confirmation sinking
  retains its provenance uniqueness. `metadata_json` carries the alignment
  session/link, both documents and revisions, both complete segment groups,
  confidence, evidence, origin, algorithm, pre-apply session/link revisions,
  actor, reason, and optional correlation ID.
- A success increments the TM library exactly once, including duplicate-only
  applies; increments and terminally closes the session exactly once; appends
  one `alignment.session.apply` operation; and stores the complete result plus
  a canonical request fingerprint in `terminal_result_json`.
- Replaying the same canonical request after restart returns the stored result
  without a new transaction side effect. Any different request against an
  applied session returns `InvalidState`.
- Manual partition replacement, link-status updates, AI-refinement preparation,
  and apply all use the same current-snapshot validation. A segment cannot
  change independently of its document revision and remain silently usable.

### 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| Duplicate/empty/oversized selection or actor/reason/ID bound failure | `InvalidState` before persistence |
| Stale session, document, link, or library revision | `EntityConflict`; no TM/revision/history/terminal write |
| Stale segment revision | `Conflict` with segment ID and expected/actual revisions; no apply side effect |
| Segment membership/order/hash/text differs from the snapshot | `InvalidState`/`InvalidData`; no apply side effect |
| Proposed/rejected/unaligned/empty selected link | `InvalidState`; mixed valid/invalid selections roll back as one request |
| Read-only or locale-mismatched library | `InvalidState`; library and session remain unchanged |
| Existing or same-request duplicate content | Return the existing/planned TM unit ID in `duplicates`; do not insert another row |
| SQLite failure on any later insert/revision/history/terminal statement | Roll back every earlier insert and keep the session retryable |
| Applied session plus identical/different request | Return stored result / reject as a different terminal request |

### 5. Good / Base / Bad Cases

- Good: confirm two links, apply both, receive two provenance-complete units,
  one library revision, one terminal session revision, and the same result
  after reopening and replaying the selection in a different order.
- Base: both selected contents already exist. Insert zero rows, map both links
  to their existing unit IDs, increment the library once, and close the session.
- Bad: insert the first selected row before discovering that the second link is
  proposed, stale, or malformed; or use `origin_segment_id` for a multi-segment
  group and collide with normal confirmation-sink uniqueness.

### 6. Tests Required

- Storage tests assert complete metadata and operation provenance, terminal
  state, restart replay, different-request rejection, duplicate-only behavior,
  and exact session/library/count results.
- Regressions cover duplicate selection, mixed confirmed/proposed selection,
  stale session/link/segment/document/library revisions, read-only and locale-
  mismatched libraries, and current-snapshot rejection for manual/status/refine.
- Install a temporary SQLite trigger that aborts the second `tm_units` insert;
  assert zero TM units, no apply operation, unchanged library/session revisions,
  no terminal result, and an open retryable session.

### 7. Wrong vs Correct

#### Wrong

```rust
for link in selected_links {
    insert_tm_unit(link)?; // a later invalid link leaves earlier rows visible
}
mark_session_applied(session_id)?;
```

#### Correct

```rust
let transaction = connection
    .transaction_with_behavior(TransactionBehavior::Immediate)?;
let plans = validate_current_session_links_library_and_build_plans(&transaction, input)?;
insert_deduplicated_units_and_terminal_result(&transaction, plans)?;
transaction.commit()?;
```

## Reference Corpus Boundary

### 1. Scope / Trigger

Use this contract for project-owned monolingual or bilingual reference
corpora, corpus search, reindex/remove, and corpus materialized from confirmed
alignment links. The Engine owns filter selection, parsing, locale mapping,
and managed-file publication. Store owns corpus revisions, provenance,
capacity checks, search projections, and all SQLite transactions. A corpus
never mutates active documents or TM units implicitly.

### 2. Signatures

The Engine entry point is:

```rust
EngineService::import_reference_corpus(
    ReferenceCorpusImportRequest,
) -> Result<ReferenceCorpusMutationResult>
```

The Store boundary is:

```rust
Store::create_reference_corpus(NewReferenceCorpus)
Store::create_reference_corpus_from_alignment(CreateReferenceCorpusFromAlignment)
Store::list_reference_corpora(project_id, status, offset, limit)
Store::search_reference_corpora(&ReferenceCorpusSearchRequest)
Store::reindex_reference_corpus(ReindexReferenceCorpus)
Store::remove_reference_corpus(RemoveReferenceCorpus)
```

`ReferenceCorpusImportRequest` carries project/expected project revision,
source path, name, kind (`monolingualSource`, `monolingualTarget`, or
`bilingual`), project locales, optional registered filter ID/options, actor,
reason, and optional correlation ID. `ReferenceCorpusSearchRequest` carries
project, query, side (`source`, `target`, `both`), optional corpus IDs, and
bounded offset/limit.

The additive concordance response is:

```rust
pub struct ConcordanceResult {
    pub hits: Vec<ConcordanceHit>, // existing TM page
    pub total: u32,                // existing TM total
    #[serde(default)]
    pub corpus_hits: Vec<CorpusSearchHit>,
    #[serde(default)]
    pub corpus_total: u32,
    pub offset: u32,
    pub limit: u32,
}
```

### 3. Contracts

- The selected filter parses a bounded temporary copy. Source-monolingual
  units map to `source_text`; target-monolingual units map the imported source
  text to `target_text` only when the explicit target locale is selected.
  Bilingual units require a non-empty authoritative target.
- Filter metadata locale declarations are checked against the selected side
  and project target locale. Provenance records file name, filter/format,
  input SHA-256, options hash, mapped side, ordinal, structural path, and
  inline-tag/note counts; alignment corpora additionally record session/link,
  document/segment groups, confidence, evidence, origin, and algorithm.
- File corpora publish an immutable `sources/reference-corpus-<id>.*` copy only
  after parsing and mapping succeed. Store canonicalizes the path under
  `sources/`, rejects symlink/path escapes, and verifies the digest before its
  immediate insert transaction. If persistence fails, Engine removes that
  staged managed copy; a terminal remove deletes searchable rows but retains
  the managed copy for recoverability.
- Entries have dense ordinals, unique structural paths, kind-specific text
  shape, normalized source/target keys, and bounded provenance. Limits are
  64 active corpora/project, 100,000 entries/corpus, 200,000 active entries/
  project, 1 MiB per text side, 64 MiB total text, 1,000 diagnostics, and
  500 results/page.
- Search scans active corpora for the project and sorts exact, then prefix,
  then contains matches, followed by corpus recency, ordinal, and IDs. The
  returned `matchedSide` and complete corpus/file/path/link provenance are
  authoritative; clients must not re-rank or reconstruct it.
- `tm.concordance` runs TM and corpus retrieval with the same project, query,
  side, offset, and limit. Its original `hits` and `total` remain TM-only;
  `corpusHits` and `corpusTotal` are an independent page projected through the
  same Engine helper as `corpus.search`.
- Reindex rebuilds normalized keys from stored entry text under an expected
  corpus revision, preserving entry IDs/text/provenance. All mutations append
  one bounded operation with actor/reason/correlation and commit as one
  transaction.

### 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| Unknown filter, missing/empty input, malformed/unsupported format | Typed import error; no corpus or managed copy |
| Project revision, locale, corpus revision, or alignment snapshot is stale | `conflict`; no rows, index, operation, or file deletion |
| Missing authoritative bilingual target or wrong filter locale | `invalid_request`; staged copy is removed |
| Unsafe managed path, digest mismatch, duplicate path, invalid shape, or limit exceeded | `invalid_state`/typed import error; transaction is rolled back |
| SQLite failure after managed publication | Storage error; every corpus/entry/operation row rolls back and managed copy is cleaned |
| Search selects a foreign, removed, or unknown corpus | Typed not-found/invalid-state result; removed rows are never searchable |
| Reindex/remove receives read/terminal or stale corpus | Conflict/invalid-state; existing projection and source remain unchanged |
| Older concordance response omits corpus fields | Deserialize them as an empty page and zero total |

Errors and operations expose bounded IDs, paths, counts, and codes only; they
never include corpus bodies or full filter/provider payloads.

### 5. Good / Base / Bad Cases

- Good: import source and target TXT plus a bilingual XLIFF, restart, search,
  reindex to the same projection, and remove one corpus while its managed copy
  and unrelated TM/document rows remain intact.
- Base: materialize selected confirmed links from an open or applied alignment
  session and retain session/link/document/segment provenance without copying
  or rewriting the documents.
- Base: a concordance query with no corpus matches returns unchanged TM
  `hits/total` plus empty `corpusHits` and `corpusTotal=0`.
- Bad: persist a corpus before validating all units, treat a target-monolingual
  row as bilingual TM evidence, delete the managed source on remove, or let a
  failed second entry leave the first row visible.
- Bad: concatenate TM and corpus rows into one client-ranked list or reinterpret
  `total` as a combined count.

### 6. Tests Required

- Engine fixtures assert TXT source/target mapping, XLIFF authoritative-target
  and locale rejection, filter/options provenance, restart, malformed/empty/
  unknown input cleanup, and a forced SQLite failure with no managed copy or
  corpus row.
- Engine concordance fixtures seed TM and corpus matches, compare
  `corpusHits` byte-for-byte with `corpus.search`, and prove adding corpus rows
  does not change TM `hits`, IDs, or `total`.
- Storage fixtures assert migration 12 fresh/upgrade/strict/rollback/reopen,
  path canonicalization/digest checks, dense shape/path/limit validation,
  alignment-corpus provenance, deterministic search/paging, reindex equality,
  terminal removal isolation, and later-entry rollback.
- Focused gates are `cargo fmt --all -- --check`, strict Clippy, and
  `cargo test -p translunar-storage -p translunar-engine`; generated protocol
  consumers must add contract drift coverage before exposing RPC methods.

### 7. Wrong vs Correct

#### Wrong

```rust
for entry in parsed_entries {
    store.insert_entry(entry)?; // a later failure exposes a partial corpus
}
fs::remove_file(managed_source)?; // removal destroys recoverable provenance
```

#### Correct

```rust
let parsed = parse_and_validate_all_units(&temporary_copy)?;
temporary_copy.persist_noclobber(&managed_path)?;
let result = store.create_reference_corpus(NewReferenceCorpus { entries: parsed, ..input });
if result.is_err() {
    let _ = fs::remove_file(managed_path); // only failed staging is cleaned
}
let corpus = protocol_reference_corpus_search_result(
    store.search_reference_corpora(&corpus_request)?,
);
ConcordanceResult {
    hits: tm_hits,
    total: tm_total,
    corpus_hits: corpus.items,
    corpus_total: corpus.total,
    offset,
    limit,
}
```

## Alignment And Corpus RPC Boundary

### 1. Scope / Trigger

Use this contract when exposing alignment sessions, alignment-to-TM apply, or
reference-corpus lifecycle through protocol v1. `crates/protocol` owns the wire
shape, Engine owns storage-to-wire projection and error redaction, and Store
continues to own revisions and transactions.

### 2. Signatures

The additive generated method catalog is:

```text
alignment.session.create  AlignmentSessionCreateParams -> AlignmentSessionCreateResult
alignment.session.get     AlignmentSessionGetParams    -> AlignmentSessionGetResult
alignment.session.list    AlignmentSessionListParams   -> AlignmentSessionPage
alignment.session.update  AlignmentSessionUpdateParams -> AlignmentMutationResult
alignment.session.refine  AlignmentSessionRefineParams -> AiRun
alignment.session.apply   AlignmentSessionApplyParams  -> AlignmentApplyResult
corpus.list               CorpusListParams             -> ReferenceCorpusPage
corpus.import             CorpusImportParams           -> ReferenceCorpusMutationResult
corpus.fromAlignment      CorpusFromAlignmentParams    -> ReferenceCorpusMutationResult
corpus.search             CorpusSearchParams           -> CorpusSearchResult
corpus.reindex            CorpusMutationParams         -> ReferenceCorpusMutationResult
corpus.remove             CorpusMutationParams         -> ReferenceCorpusMutationResult
```

Initialization advertises `alignment.sessions`, `alignment.ai-refinement`,
`alignment.tm-apply`, and `reference-corpus`.

### 3. Contracts

- Session/corpus list and search/get-link pages accept only limits `1..500` and
  return Engine-authoritative ordering, `offset`, `limit`, and `total`.
- `alignment.session.update` uses the strict camel-case tagged mutation
  `replaceLinks` or `setStatus`; every write carries the expected session and
  applicable link/library/project/corpus revision plus actor and reason.
- Engine projects storage records into protocol DTOs. It never serializes a
  storage record directly: corpus entries omit `normalized_source` and
  `normalized_target`, and an applied session exposes only
  `terminal_result_json.result`, never the internal request fingerprint.
- Protocol evidence is a camel-case projection distinct from the persisted
  alignment-core evidence representation. For a struct-variant enum, Serde
  `rename_all` renames variants only; wire fields require
  `rename_all_fields = "camelCase"` or an explicit protocol DTO.
- Refinement builds `AlignmentRefinementRunContext` from IDs/revisions only and
  delegates to the existing bounded AI run service. Apply and corpus mutations
  delegate to their existing Store transactions without duplicating rules.
- Rust schema, generated TypeScript, `RpcMethodCatalog`, dispatcher branches,
  and `ENGINE_METHODS` change together. `pnpm contracts:check` proves generated
  files are byte-current.

### 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| Stale session/link/library/project/corpus revision | `conflict` with entity, ID, expected, and actual revision |
| Alignment work/segment/refinement bound exceeded | `resource_limit_exceeded` with camel-case resource, limit, and actual counts |
| Invalid provider refinement graph/response | `alignment_response_invalid`; no response body or echoed text |
| Other alignment-core partition validation failure | `alignment_invalid_partition` with a generic message |
| Explicit corpus filter ID is unknown | `not_found` with `entity=filter` and the filter ID |
| No filter match, malformed/empty/locale-invalid corpus, or filter failure | Redacted `unsupported_corpus_input`; no input path/body in message/data |
| Invalid page size or malformed tagged params | `invalid_request` before storage work |
| Invalid stored terminal projection | `storage_error`; never fall back to exposing raw terminal JSON |

### 5. Good / Base / Bad Cases

- Good: create/page/confirm/apply a session, reopen it with the public terminal
  result, materialize a corpus, search/reindex/remove it, and retain typed
  provenance without any internal fingerprint or normalized key.
- Base: call optional refinement without a configured profile. The typed AI
  error returns while the deterministic session remains editable.
- Bad: return `AlignmentSessionRecord` or `ReferenceCorpusEntryRecord` directly,
  expose `FilterError::NoMatch` with its path, or hand-maintain TypeScript types.

### 6. Tests Required

- Protocol tests assert strict tagged mutations, camel-case evidence fields,
  defaults, and stable snake-case error codes.
- Engine tests drive all 12 dispatcher branches through create/get/list/update/
  apply and corpus import/from-alignment/search/reindex/remove. They assert AI
  refinement reaches its service boundary, capabilities are present, internal
  fields are absent, and corpus/filter errors are redacted.
- Focused gates are Rust format, protocol/Engine tests, strict Clippy, generated
  contract drift, contracts TypeScript check, and full workspace typecheck.

### 7. Wrong vs Correct

#### Wrong

```rust
// Leaks requestFingerprint and relies on persisted snake_case evidence fields.
serialize_result(store.get_alignment_session(session_id)?)
```

#### Correct

```rust
let session = protocol_alignment_session(store.get_alignment_session(session_id)?)?;
// The projection decodes only terminal_result_json["result"] and maps evidence.
serialize_result(session)
```

## Offline Task Package Boundary

### 1. Scope / Trigger

Use this contract for offline `.tltask` assignment export, detached task
import, return export, three-way preview, selected merge, or discard. The ZIP
is a bounded transport artifact, never a live database. Rust owns ZIP parsing,
canonical JSON and hashes, identity binding, classifications, revision checks,
transactions, and history. Electron owns trusted dialogs and presentation.

### 2. Signatures

Protocol v1 exposes five additive methods:

```text
taskPackage.export  TaskPackageExportParams  -> TaskPackageResult
taskPackage.preview TaskPackagePreviewParams -> TaskPackagePreviewResult
taskPackage.import  TaskPackageImportParams  -> TaskPackageImportResult
taskPackage.apply   TaskPackageApplyParams   -> TaskPackageApplyResult
taskPackage.discard TaskPackageDiscardParams -> TaskPackageDiscardResult
```

Assignment export requires `projectId`, `expectedProjectRevision`, one to 50
`documents` with optional explicit `segmentIds`, optional explicit TM/termbase
`assetSlices`, `destinationPath`, `actor`, and `reason`. Return export instead
requires `workingProjectId` and `parentPackageId`; assignment-only fields are
rejected. Preview requires exactly one of `packagePath` or `previewId` plus a
bounded `offset`/`limit`. Import requires an assignment `previewId`. Apply is:

```text
TaskPackageApplyParams {
  previewId,
  expectedProjectRevision,
  selectedRowIds,
  actor,
  reason
}
```

There is deliberately no public `requestDigest`. Storage derives and persists
the apply fingerprint inside the same write boundary from the preview ID,
expected project revision, sorted unique row IDs, actor, and reason.

Migration 13 adds `task_packages`, `task_package_bindings`,
`task_package_previews`, and `task_package_preview_rows`. The Store entry points
are `snapshot_task_package_assignment`, `snapshot_task_package_return`,
`create_task_package_assignment_preview`,
`create_task_package_return_preview`, `import_task_package_assignment`,
`list_task_package_preview_rows`, `apply_task_package`, and
`discard_task_package`.

### 3. Contracts

- Format version 1 uses canonical `manifest.json`. `manifestHash` is SHA-256
  over the manifest with that field cleared. Every payload entry has a safe
  slash-separated relative path, byte count, and SHA-256. Projection hashes
  cover editable content and stable origin identity but intentionally ignore
  revision metadata; revisions are checked independently.
- Assignment packages contain immutable managed source bytes, selected base
  projections, instructions, and only explicitly requested asset rows. Return
  packages resolve origin identities exclusively through immutable bindings
  and contain only changed bound projections plus their durable base.
- Readers reject traversal/absolute/Windows paths, duplicate names, ZIP64,
  encryption, unsupported compression, more than 2,048 entries, path depth
  over 8, compression ratio over 1,000, missing/unlisted payloads, and hash or
  manifest mismatch before Store mutation. Publication uses a temporary file,
  full revalidation, fsync, and no-clobber persistence.
- Limits are 50 documents, 100,000 segments, 100 MiB per entry, 500 MiB total
  uncompressed payload, 64 MiB manifest, 10,000 asset rows, 1,000 comments per
  projection, 1 MiB per text field, and 256 KiB instructions.
- Assignment import generates new local project/document/segment IDs and one
  immutable binding per selected origin segment. Managed sources are staged
  under `sources/`; the project stores a non-secret task-package reference and
  imported asset slices are local read-only snapshots.
- Return preview persists all rows, counts, hashes, projections, diagnostics,
  and expected project/document/segment revisions. Dispositions are
  `unchanged`, `remoteChanged`, `localChanged`, `bothChanged`, `deleted`,
  `added`, `tagInvalid`, and `missingDependency`. Only `remoteChanged` and an
  identical `bothChanged` row have `safeToApply=true`.
- Apply accepts one to 100,000 unique explicit row IDs. One Immediate
  transaction rechecks preview/package state, project and document revisions,
  each current segment revision/hash, immutable source/path identity, and
  protected tags before any row write. It then applies target/tags/workflow/
  comments through existing rules, sinks confirmed targets through existing TM
  semantics, updates revisions, records operation/editor history, marks the
  preview/package terminal, and stores the result and internal digest.
- A byte-identical retry of an applied import or merge returns its stored
  result after restart. A retry whose internally derived digest differs is
  `invalid_state`. Failed preview/import/apply leaves authoritative content
  unchanged and keeps open staging retryable. Explicit discard first marks the
  package and all open previews discarded, commits audit state, then removes
  their workspace-local staged files.
- Logs, errors, and history may contain bounded IDs, hashes, counts, paths, and
  reason metadata. They must not contain credentials, provider configuration,
  full libraries, package bytes, or unbounded document text.

### 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| Wrong assignment/return field combination, empty actor/reason, or both/neither preview locator | `invalid_request`; no file or database write |
| Existing `.tltask` destination | `invalid_state`/`export_error`; existing bytes remain unchanged |
| Unsafe/duplicate/encrypted/unsupported ZIP entry, malformed canonical JSON, missing entry, or hash mismatch | `invalid_request`; preview staging is removed and no preview is stored |
| Configured document/segment/entry/manifest/asset/comment limit exceeded | `resource_limit` with bounded `resource`, `limit`, and `actual` data |
| Unknown package, preview, project, document, segment, or selected row | `not_found`; no write |
| Stale project/document/segment revision | `conflict` (or `invalid_state` for a refreshed hash mismatch); preview remains retryable |
| Selected `localChanged`, divergent `bothChanged`, deleted, added, tag-invalid, or missing-dependency row | `invalid_state`; no selected row is applied |
| Import source/binding mismatch or source identity changed in a detached task | `invalid_state`; no partial project/source/binding residue |
| Late SQLite/editor/comment/TM failure | Entire Immediate transaction rolls back; preview/package stays open |
| Replay of terminal preview with same/different internal digest | Return stored result / `invalid_state`, respectively; never duplicate history, comments, or TM |
| Discard of imported/applied package or mismatched preview/package | `invalid_state`; terminal state and files remain intact |

### 5. Good / Base / Bad Cases

- Good: export a bounded assignment, import it as a detached project, edit a
  bound target, export a return, preview one `remoteChanged` row, apply it,
  restart, and replay the same terminal result with the same operation ID.
- Good: page a return whose safe rows span pages, select explicit row IDs,
  preserve an unselected local edit, and apply only the selected safe rows.
- Base: an unchanged assignment or all-conflict return remains inspectable and
  pageable with no enabled merge; explicit discard removes its staging.
- Bad: mount the ZIP as SQLite, use local IDs in a return, trust a renderer
  hash, infer conflicts in TypeScript, apply rows one transaction at a time, or
  overwrite an existing destination.

### 6. Tests Required

- `task-package-core` unit tests assert canonical key ordering, manifest/path/
  limit validation, revision-independent projection hashes, and every
  disposition including identical and divergent dual edits.
- Migration/storage tests assert schema 13 fresh/upgrade/reopen/STRICT/late-
  failure rollback, binding uniqueness, assignment import atomicity, durable
  paging, every classification, selected atomic merge, comment/tag/workflow/TM
  invariants, unselected local-edit preservation, discard, and restart
  idempotence.
- Engine tests assert assignment and return payload shapes, explicit asset
  slices, ZIP path/encryption/compression/ratio/size/count failures, tamper,
  missing/duplicate entries, no-clobber publication, staging cleanup, and
  dispatch/error mapping. Generated schema and TypeScript must be byte-equal.
- The real stdio smoke covers export/preview/import/return, the conflict matrix,
  stale/tamper/no-clobber/rollback, restart, and idempotent terminal replay.
- Real-Engine Electron E2E covers trusted dialogs, paging, cross-page safe
  selection, audit/export guards, retry after stale apply, terminal states,
  accessibility, no console/page errors, and horizontal containment at
  1250x744, 1680x942, and 1920x1080.

### 7. Wrong vs Correct

#### Wrong

```typescript
const requestDigest = await hash({ previewId, selectedRowIds });
await window.translunar.invoke("taskPackage.apply", {
  previewId,
  selectedRowIds,
  requestDigest,
});
```

#### Correct

```typescript
await window.translunar.invoke("taskPackage.apply", {
  previewId: preview.previewId,
  expectedProjectRevision: preview.expectedProjectRevision,
  selectedRowIds: [...selectedRows],
  actor: actor.trim(),
  reason: reason.trim(),
});
// Storage canonicalizes this request and derives the idempotency digest.
```

#### Wrong

```rust
for row in selected_rows {
    store.apply_one_task_package_row(row)?;
}
```

#### Correct

```rust
let transaction = connection.transaction_with_behavior(
    rusqlite::TransactionBehavior::Immediate,
)?;
validate_complete_task_package_selection(&transaction, &selected_rows)?;
apply_complete_task_package_selection(&transaction, &selected_rows)?;
transaction.commit()?;
```

## Discussion Threads And Project Snapshots Boundary

### 1. Scope / Trigger

Use this contract for local project-, document-, or segment-scoped discussion
threads and for immutable named project snapshots. The feature crosses the
protocol catalog, migration 14, storage transactions, Engine dispatch, and
Project Insights. It does not add network collaboration, notifications,
attachments, or snapshot files.

### 2. Signatures

Protocol v1 adds these generated Engine methods:

```text
discussion.thread.list/create/resolve
discussion.message.list/create/update/delete
project.snapshot.list/create/get/previewRestore/restore
```

Discussion create/resolve/message mutations carry actor, reason, and expected
project/thread/message revisions. Thread pages and message pages carry
`items`, `total`, `offset`, and `limit`; list limits are validated in `1..=500`.
Thread scope is `project|document|segment`, and message rows expose stable
`ordinal`, `revision`, `threadRevision`, `mentions`, and `deleted` fields.

Migration 14 creates `discussion_threads`, `discussion_messages`,
`project_snapshots`, and `project_snapshot_previews` as STRICT tables with
foreign keys, scope/status checks, deterministic indexes, and terminal preview
status. Snapshot preview accepts `snapshotId` and
`expectedProjectRevision`; restore accepts only `previewId`,
`expectedProjectRevision`, `actor`, and `reason`.

### 3. Contracts

- Storage derives lower-cased literal `@token` metadata locally. It never
  queues notifications or contacts a server. Message edits preserve ordinal;
  deletes retain the row as a tombstone, and list order is `(ordinal, id)`.
- Discussion actor/reason/title/body limits are 128 bytes, 512 bytes, 256
  bytes, and 16 KiB respectively. Scope references are checked against the
  selected project before any write. Every successful mutation appends one
  bounded operation-history entry in the same Immediate transaction.
- Snapshot capture is canonical and immutable. It includes project
  configuration, active documents/versions/segments and project-local editor,
  comment, review, workflow, discussion, and mount-reference state. It never
  selects credentials, AI secrets, shared asset rows, or operations. The
  stored SHA-256 covers the canonical payload, not client input.
- Snapshot names are unique per project. Payloads are capped at 64 MiB;
  metadata and pages remain bounded and deterministically ordered.
- Preview writes only a preview row and returns a stable preview ID, current
  state hash, expected/current revisions, change summary, and missing mount
  references. Restore rechecks both revision and current-state hash, validates
  dependencies, applies project-local rows in one Immediate transaction,
  increments the project revision once, and appends
  `project.snapshot.restore`.
- A successful preview becomes terminal `applied`; a stale/failed restore
  leaves the preview open and the snapshot/shared assets untouched. A fresh
  preview is required for retry.
- On Windows, `scripts/check-contracts.mjs` invokes `pnpm.cmd` through
  `cmd.exe /d /s /c`; direct `spawnSync("pnpm.cmd")` can return `EINVAL` even
  when the generated contracts are current.

### 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| Unknown project/document/segment/thread/message/snapshot/preview | `not_found`; no side effect |
| Stale expected project/thread/message revision | `conflict` with entity, expected, and actual revision data; no mutation |
| Invalid scope references, empty/bounded text, malformed page limit, or oversized payload | `invalid_request`/`resource_limit`; no partial write |
| Duplicate `(project, name)` snapshot | `invalid_state`; existing snapshot remains immutable |
| Missing mounted dependency or changed preview revision/hash | `invalid_state`/`conflict`; preview remains retryable and project unchanged |
| Restore of an `applied` preview | `invalid_state`; no second operation or revision increment |
| SQLite/FK/validation failure during restore | Transaction rollback; no partial project, discussion, mount, or history write |

### 5. Good / Base / Bad Cases

- Good: create all three scopes, page messages, edit then tombstone a reply,
  resolve/reopen, restart, and observe the same ordinals and mentions.
- Good: create a named snapshot, preview it, reject a stale restore, refresh
  the preview, restore once, and replay the terminal preview without another
  operation.
- Base: a preview reports zero changes and no missing mounts; the UI remains
  inspectable while mutation controls are disabled during busy/error states.
- Bad: compute a digest in React, write discussion rows outside the revision
  transaction, delete tombstones, replace a duplicate snapshot, or restore a
  snapshot after only checking its project revision.

### 6. Tests Required

- Protocol tests assert camelCase serialization, all 12 method catalog entries,
  bounded page limits, and capability reporting.
- Storage tests cover migration 14 fresh/upgrade/reopen/rollback, scope/FK
  checks, mention normalization, stable paging/ordinals, stale writes,
  duplicate names, missing mounts, injected restore failure, atomic rollback,
  and restart persistence.
- Engine tests assert handshake/dispatch, typed `conflict`/`invalid_state`
  data, bounded validation, history operations, terminal preview behavior,
  and no secret/shared-row leakage from payloads.
- `scripts/check-contracts.mjs` and the real stdio smoke must pass. Smoke must
  cover all scopes, mention/tombstone paging, stale preview, duplicate name,
  restore/history, terminal retry, and restart recovery.
- Real-Engine Electron E2E must cover create/edit/delete/resolve/reopen,
  snapshot preview/stale/restore/restart, console/page errors, horizontal
  overflow, named controls, and screenshots at 1250x744, 1680x942, and
  1920x1080.

### 7. Wrong vs Correct

#### Wrong

```typescript
const requestDigest = await sha256(snapshotJson);
await window.translunar.invoke("project.snapshot.restore", {
  previewId,
  requestDigest,
});
```

#### Correct

```typescript
await window.translunar.invoke("project.snapshot.restore", {
  previewId: preview.previewId,
  expectedProjectRevision: preview.expectedProjectRevision,
  actor: actor.trim(),
  reason: reason.trim(),
});
// Rust rechecks the stored preview hash and derives the authoritative restore.
```

## Asset Catalog And Curation Boundary

### 1. Scope / Trigger

Use this contract for the unified TM/termbase/corpus catalog and for explicit
translation-memory curation. The feature crosses migration 15, storage,
`curation-core`, Engine/provider orchestration, generated protocol contracts,
dataset publication, and Project Insights. It never adds a second asset sink,
hard-deletes an asset, mutates a termbase/corpus, or schedules hidden work.

### 2. Signatures

Protocol v1 adds these generated methods:

```text
asset.catalog.list      AssetCatalogListParams    -> AssetCatalogPage
curation.run            CurationRunParams         -> CurationRunSnapshot
curation.run.get        CurationRunIdParams       -> CurationRunSnapshot
curation.finding.list   CurationFindingListParams -> CurationFindingPage
curation.apply          CurationApplyParams       -> CurationMutationResult
curation.rollback       CurationRollbackParams    -> CurationMutationResult
curation.export         CurationExportParams      -> CurationExportResult
```

Migration 15 adds `quality_score_basis_points`, `curation_state`,
`curation_revision`, and `last_curated_run_id` to `tm_units`, plus STRICT
`curation_runs`, `curation_run_units`, `curation_findings`, and
`curation_changes` tables. Run/apply/rollback/export requests carry the
authoritative run/library revisions defined in `crates/protocol/src/curation.rs`.

### 3. Contracts

- `curation-core` is deterministic and I/O-free. One run accepts at most
  100,000 units from one library; evidence is capped at 32 values and 256
  characters per value. Scores are integer basis points in `0..=10_000`.
- The catalog is globally or project scoped, combines TM, termbase, and active
  corpus rows, applies the same optional locale/domain/origin/time/query
  filters, and sorts before slicing. Page limits are `1..=500`; the bounded
  page window cannot exceed 100,000 rows.
- Analysis validates the library revision before optional provider work and
  revalidates it inside the Immediate run-creation transaction. A provider
  envelope is capped at 256 KiB and is accepted only when strict JSON contains
  unique known unit IDs, bounded labels/evidence, and valid basis-point scores.
  Any invalid or stale provider result creates zero curation rows.
- `apply` requires an open run, exact run/library revisions, a non-empty unique
  finding selection, matching unit snapshot hashes, actor, and reason. It
  stores every before image, updates all analyzed scores, quarantines only
  selected actionable units, advances revisions, and appends one operation in
  the same Immediate transaction.
- `rollback` accepts only an applied run and exact revisions. It verifies the
  current projection against each stored after image, restores score/state/
  last-run values, advances revisions monotonically, marks changes restored,
  and appends one operation atomically. An identical terminal retry returns the
  stored result; a different retry fails without writes.
- Export reads active units from the run, applies an optional minimum score,
  renders UTF-8 JSONL or TSV, reparses/counts the temporary file, fsyncs, and
  publishes without replacing an existing destination.

### 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| Unknown project/library/run/finding | `not_found` with bounded entity/ID data; no write |
| Stale run, library, or unit snapshot | `conflict` or `invalid_state`; the whole transaction rolls back |
| Page limit outside `1..=500`, inverted dates, invalid policy, duplicate/empty selection | `invalid_request`/`invalid_state`; no partial state |
| Provider response is oversized, malformed, text-echoing, duplicated, or contains an unknown ID | `provider_protocol`; zero curation rows |
| Apply selects a `keep` finding or a terminal run receives a different retry | `invalid_state`; no unit/history mutation |
| Rollback sees an interleaved unit projection | `invalid_state`/`conflict`; no restored flag or revision changes |
| Export score exceeds 10,000 or serialization/validation fails | `invalid_request`/`export_error`; no destination |
| Export destination exists | `export_error`; existing bytes remain unchanged |

### 5. Good / Base / Bad Cases

- Good: analyze a shared mounted library under one project audit owner, select
  actionable findings, apply, restart, export active rows, rollback, restart,
  and observe the original state with larger revisions.
- Base: offline analysis returns scores, findings, term candidates, and drift
  groups without any mutation; an optional provider is advisory only.
- Bad: compute scores in React, accept a provider annotation for an unknown
  unit, quarantine every low-score row without explicit selection, decrement a
  revision during rollback, or overwrite an existing dataset destination.

### 6. Tests Required

- `curation-core` tests cover all deterministic rules, provider envelope
  rejection, >=90% dirty-fixture detection, clean-row preservation, stable
  mining/drift, and JSONL/TSV round trips.
- Migration/storage tests cover fresh migration 15, strict constraints,
  catalog filters/order/pages/reopen, late-failure rollback, stale snapshots,
  idempotent apply/rollback, before images, operation history, and restart.
- Engine/protocol tests cover camelCase payloads, method catalog/capabilities,
  typed conflicts, provider zero-write failures, no-clobber export, and restart.
- `cargo run -p translunar-curation-core --bin curation_benchmark` must analyze
  exactly 10,000 deterministic units and print JSON containing `elapsedMs` and
  Linux `peakRssKib`.
- Contract drift, strict Clippy, workspace tests, full stdio smoke, and the
  real-Engine Electron curation flow must pass. The Electron flow covers stale
  refresh, apply, restart, export, rollback, restart, accessible controls,
  console/page errors, and the three supported viewport sizes.

### 7. Wrong vs Correct

#### Wrong

```typescript
const score = scoreTranslationPair(sourceText, targetText);
await window.translunar.invoke("curation.apply", {
  runId,
  selectedFindingIds: score < 5000 ? allFindingIds : [],
});
```

#### Correct

```typescript
await window.translunar.invoke("curation.apply", {
  runId: run.id,
  expectedRunRevision: run.revision,
  expectedLibraryRevision: library.revision,
  selectedFindingIds: [...selectedFindingIds],
  actor: actor.trim(),
  reason: reason.trim(),
});
// Storage validates the immutable analysis and selected findings atomically.
```

## Plugin runtime (local process filters)

- Engine owns plugin install/enable/disable/uninstall and copies packages into
  `<dataDir>/plugins/<id>/`.
- Tier 3 process plugins speak newline JSON-RPC; crashes/timeouts must not kill
  the Engine process.
- Filter contributions register through the same `FilterRegistry` as built-ins
  and must not use the `builtin.` id prefix.
- Effective permissions are `requested ∩ granted`; missing grants fail closed
  with `plugin_permission_denied`.
- Advertise `plugin.runtime.v1`, `plugin.process.v1`, `plugin.filter.v1`, and
  `plugin.local-install` from `engine.initialize`.
- Migration 16 introduces `plugin_installations`; never rewrite earlier migrations.

## Local API and CLI

- `translunar` CLI and loopback HTTP API call `EngineService` directly; they must
  not route through Electron or nested stdio engines for workflow commands.
- Bind `127.0.0.1` by default. Non-loopback binds require an explicit
  `--allow-remote` opt-in.
- Authenticate protected HTTP routes with a bearer token stored in the OS
  keyring service `translunar-cat.local-api` (test memory backend via
  `TRANSLUNAR_API_TEST_MODE`).
- Never persist the raw API token in SQLite or log it at info level.
- Desktop `translunar-engine --protocol stdio` remains the GUI transport and
  must stay unchanged by API/CLI work.

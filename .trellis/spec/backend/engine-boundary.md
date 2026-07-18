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

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

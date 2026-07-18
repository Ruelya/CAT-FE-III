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

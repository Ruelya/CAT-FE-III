# Technical Design: M0 Vertical Slice

## 1. Fixed Decisions

This design implements, rather than reopens, the decisions in
`docs/design-notes.md`:

- Electron + TypeScript UI shell.
- Rust headless engine as the sole domain/persistence authority.
- SQLite WAL owned exclusively by the engine.
- Same engine protocol is reusable by Electron, future CLI/local API, team mode,
  and out-of-process plugins.
- Windows and macOS are product targets; Linux is not.

The implementation is a serial vertical slice. It intentionally avoids splitting
the work into independently drifting frontend/backend projects.

## 2. Repository Shape

```text
apps/
  desktop/                 Electron main, preload, React renderer
crates/
  protocol/                JSON-RPC wire types and schema export
  domain/                  entities, state transitions, filter/pipeline traits
  storage/                 rusqlite store and migrations
  filter-docx/             OOXML import/export implementation
  engine/                  composition root and stdio server binary
fixtures/
  docx/                    deterministic fixture source/output expectations
scripts/                   schema generation and end-to-end smoke helpers
```

`pnpm` is the JavaScript workspace/package manager. Cargo remains authoritative
for Rust. Root commands orchestrate both without hiding the underlying commands.

## 3. Runtime Architecture

```text
React renderer
  -> context-isolated preload API
  -> Electron main typed client
  -> child stdin/stdout (JSON-RPC 2.0, one JSON object per line)
  -> Rust engine dispatcher
  -> domain services
  -> SQLite / managed files / DOCX filter
```

Renderer security defaults:

- `contextIsolation: true`
- `nodeIntegration: false`
- no renderer access to filesystem paths except values selected/returned through
  the preload API
- main process validates preload requests against generated protocol types

The engine accepts `--data-dir <path>` and `--protocol stdio`. Stdout is reserved
for protocol frames; diagnostics use stderr with structured tracing.

## 4. Protocol

The protocol begins with `engine.initialize`:

```json
{
  "protocolVersion": 1,
  "client": { "name": "translunar-desktop", "version": "0.0.1" }
}
```

The engine rejects incompatible versions. Initial methods:

| Method                 | Purpose                                        |
| ---------------------- | ---------------------------------------------- |
| `engine.initialize`    | handshake and capabilities                     |
| `project.create`       | create project and writable default TM         |
| `project.get`          | project/files/counts                           |
| `document.importDocx`  | copy, parse, persist, return document summary  |
| `segment.list`         | ordered page/list for one document             |
| `segment.updateTarget` | expected-revision draft save                   |
| `segment.confirm`      | transactional confirm + TM sink + QA refresh   |
| `tm.lookupExact`       | exact source lookup with provenance            |
| `qa.runDocument`       | rerun deterministic rules and reconcile issues |
| `qa.list`              | persisted open/resolved issues                 |
| `document.exportDocx`  | atomic translated package export               |

Errors carry stable `code`, human-readable `message`, and structured `data`.
Required codes include `invalid_request`, `not_found`, `conflict`,
`invalid_state`, `unsupported_document`, `storage_error`, and `export_error`.

Rust protocol structs derive Serde and JSON Schema. A checked-in generated schema
drives TypeScript types; CI fails when generated output differs.

## 5. Domain Model and State

Identifiers are UUIDv7 strings. Timestamps are UTC RFC 3339 in protocol and
integer milliseconds in SQLite.

### Segment identity

Each imported unit stores:

- `structural_path`: package part plus body paragraph ordinal, e.g.
  `word/document.xml#p:17`
- normalized source text
- preceding/following normalized source context where available
- `source_hash = SHA-256(normalized source)`
- `context_hash = SHA-256(source + NUL + previous + NUL + next)`

This establishes the content-addressed/provenance foundation required by the
asset hub without pretending paragraph ordinal alone is stable across re-import.

### Segment state machine

```text
untranslated --update(non-empty)--> draft --confirm--> confirmed
confirmed --update(changed)-------> draft
draft --update(empty)-------------> untranslated
```

Every write increments `revision`. `expected_revision` is mandatory for mutation.

## 6. SQLite

`rusqlite` uses bundled SQLite for reproducible desktop builds. Every connection
enables:

```sql
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA busy_timeout = 5000;
```

Versioned migrations use `PRAGMA user_version` and execute inside an immediate
transaction. Core tables:

- `projects`
- `documents`
- `segments`
- `translation_memories`
- `tm_entries` with unique `(memory_id, origin_segment_id)`
- `qa_issues` with unique `(segment_id, rule_id, fingerprint)`

Confirm runs one transaction: validate revision/target, update segment, upsert TM
entry, reconcile number QA, commit, then return the resulting aggregate.

## 7. Filter and Pipeline Boundary

The domain crate defines a `DocumentFilter` contract that emits a stream of typed
events rather than format-specific objects:

```text
StartDocument -> StartUnit -> Text -> EndUnit -> EndDocument
```

For this slice the pipeline consumes those events into persisted segments. The
DOCX implementation is internal but uses the same contract future filters use.
No plugin loading is implemented yet.

## 8. DOCX Round Trip

### Import

1. SHA-256 the source and copy it into managed storage.
2. Open as ZIP and validate `[Content_Types].xml` and `word/document.xml`.
3. Parse `word/document.xml` with `quick-xml` event APIs without trimming text.
4. For each `w:p` in `w:body`, collect visible `w:t`, tab, and line-break content;
   skip field instructions and empty/non-text paragraphs.
5. Persist text, body paragraph ordinal, hashes, and context.

### Export

1. Read the managed original archive and create a temporary output archive.
2. Copy every entry with its name and compression method.
3. For `word/document.xml`, stream-copy XML events. At a translated paragraph,
   write target text into the first writable `w:t` and emit empty text for later
   writable `w:t` nodes in the same paragraph.
4. Preserve all unrelated events, attributes, namespace declarations, package
   parts, and directory entries.
5. Reopen the temporary ZIP, validate required entries/XML, then atomically rename
   it to the requested output.

This is deliberately conservative. Paragraph/run-perfect reflow is a later DOCX
design task; corrupting unsupported structures is never an acceptable fallback.

## 9. QA and TM

Number QA tokenizes ASCII/full-width digits with decimal/group separators,
normalizes Unicode/full-width punctuation and leading zeros, then compares
multisets. Evidence stores source and target token arrays.

TM lookup in this slice is exact normalized-source equality. Entries retain
project/document/segment provenance and confirmation time. The interface is
separate from storage so Tantivy/CJK fuzzy recall can be introduced without
changing protocol consumers.

## 10. Electron Renderer

The renderer implements only orchestration and presentation:

- project form calls `project.create` and `document.importDocx`
- workbench calls `segment.list`
- debounced edits call `segment.updateTarget`
- confirmation calls `segment.confirm`, then uses the returned aggregate/counts
- Suggestions/QA panels call `tm.lookupExact` and `qa.list`
- export calls `document.exportDocx`

No segment state, QA rule, TM match, or persistence result is inferred locally.
IME composition suppresses confirmation and focus advance until `compositionend`.

## 11. Failure and Rollback

- Database migration failure leaves `user_version` unchanged and aborts startup
  with a typed diagnostic.
- Import failure removes the incomplete managed copy and rolls back all database
  rows.
- Engine crash causes Electron main to reject pending calls, retain stderr tail,
  and offer restart; SQLite WAL preserves committed edits.
- Export never replaces an existing destination until the temporary package has
  passed validation.
- Protocol/schema changes are additive within version 1; incompatible changes
  require a protocol version bump.

## 12. Trade-offs

- JSON-lines framing is chosen for debuggability and CLI/plugin reuse; large file
  bytes are always passed by path, never JSON.
- `rusqlite` is synchronous by design. A single engine-owned writer avoids async
  SQLite complexity; expensive pipeline work can move to worker threads later.
- Current official APIs support bundled rusqlite, quick-xml event copy/write, and
  zip archive entry iteration. Those capabilities are sufficient for the first
  conservative DOCX round trip.

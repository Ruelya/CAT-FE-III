# M0 Architecture

## Process Boundary

```text
React renderer
  -> context-isolated preload API
  -> Electron main
  -> JSON-RPC 2.0 over child stdin/stdout
  -> Rust engine
  -> domain services / SQLite / DOCX filter
```

Electron and TypeScript own presentation and operating-system integration. The
Rust process owns every business rule, state transition, document operation,
and persistent write. The renderer has `nodeIntegration: false`, runs with
`contextIsolation: true` and `sandbox: true`, and can invoke only the protocol
methods exposed by preload and allowlisted by main.

Electron main owns file dialogs, engine startup, handshake, restart, shutdown,
and rejection of pending requests after a crash. Paths are passed to Rust; file
bytes are never transported through JSON.

## Protocol Contract

Requests and responses are newline-framed JSON-RPC 2.0. The first request is
`engine.initialize` with protocol version 1. M0 exposes project creation and
lookup, DOCX import/export, segment listing/edit/confirmation, exact TM lookup,
and QA run/list operations.

Rust protocol types derive JSON Schema. `crates/protocol` is authoritative;
`packages/contracts` contains generated TypeScript types plus the method-to-
params/result catalog. `pnpm contracts:check` fails when checked-in contracts
drift from Rust.

Stable errors include `invalid_request`, `not_found`, `conflict`,
`invalid_state`, `unsupported_document`, `storage_error`, and `export_error`.
Optimistic writes require the segment's expected revision, so a stale renderer
cannot overwrite a newer edit.

## Persistence Ownership

`crates/storage` creates the data directory and opens one SQLite database. Each
connection enables foreign keys, WAL, normal synchronous mode, and a five-
second busy timeout. Migrations use `PRAGMA user_version` and run atomically.

A confirmation is one transaction: validate the revision and non-empty target,
change segment state, upsert one provenance-bearing TM entry, reconcile number
QA issues, and return the resulting aggregate. A crash can lose an uncommitted
operation but cannot expose only part of a confirmation.

The renderer treats RPC responses as server state. It does not recreate segment
state transitions, number QA, TM rules, counts, or persistence outcomes.

## DOCX Boundary

The domain crate defines a format-neutral document event pipeline. The DOCX
adapter validates the OOXML package, extracts visible body paragraphs in
document order, and stores structural paragraph paths with normalized content
and context hashes. Empty and field-only paragraphs are skipped conservatively.

Export starts from the immutable managed source package. It changes translated
body paragraphs, preserves unrelated ZIP parts, validates the temporary OOXML
package, and then atomically publishes the destination. Untranslated paragraphs
retain their original source text.

## Renderer Data Flow

The setup screen creates a project and imports a selected DOCX. The workbench
loads its project snapshot, ordered segments, and QA issues through preload.
Target text is editable and saved with a debounce. IME composition suppresses
confirmation and focus movement; successful confirmation advances to the next
visible segment only after the engine responds.

Suggestions display exact TM results for the active source segment and
document QA evidence. Suggestions and document preview each have docked,
collapsed, and maximized states. These modes are presentation-only state and do
not enter SQLite.

## Recovery And Failure

- Engine restart reopens SQLite and recovers committed drafts, confirmations,
  TM entries, and QA lifecycle state.
- Import rolls back rows and removes an incomplete managed source copy.
- Export never replaces its destination before package validation succeeds.
- Protocol stdout contains frames only; structured diagnostics use stderr.
- Incompatible wire changes require a protocol version bump. Additive version 1
  changes regenerate the Rust schema and TypeScript contracts together.

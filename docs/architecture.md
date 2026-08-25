# Desktop Architecture

## Process Boundary

```text
React renderer
  -> context-isolated preload API
  -> Electron main
  -> JSON-RPC 2.0 over child stdin/stdout
  -> Rust engine (tl-engine)
  -> tl-* domain/filter crates + state.json store
```

Electron and TypeScript own presentation and operating-system integration. The
Rust process owns every business rule, state transition, document operation,
and persistent write. The renderer runs with `contextIsolation: true` and
`nodeIntegration: false`, and can invoke only the protocol methods exposed by
preload and allowlisted by main.

Electron main owns file dialogs, engine startup, handshake, crash-restart with
bounded backoff (`apps/desktop/src/main/engine-supervisor.ts`), shutdown, and
rejection of pending requests after a crash. Paths are passed to Rust; file
bytes are never transported through JSON.

## Protocol Contract

Requests and responses are newline-framed JSON-RPC 2.0. The first request is
`engine.initialize` with protocol version 1. The current contract covers
project creation/list/get, document import/list/export, segment
list/update/confirm, TM lookup (exact and fuzzy) plus import/export and
pretranslate, termbase and term management with in-text term lookup, QA
run/list, AI configure/status/assist, and the asynchronous agent
(`ai.agent.start` / `ai.agent.status` / `ai.agent.cancel` with
`notify.ai.agent.step` events).

Rust protocol types derive JSON Schema. `crates/tl-protocol` is authoritative;
`packages/contracts` contains generated TypeScript types plus the method-to-
params/result catalog. `pnpm contracts:check` fails when checked-in contracts
drift from Rust.

Stable error codes include `invalidRequest`, `methodNotFound`,
`invalidParams`, `notFound`, `conflict`, `filterFailed`, `exportBlocked`,
`aiNotConfigured`, `aiFailed`, `io`, and `internal`. Segment writes require
the segment's expected revision, so a stale renderer cannot overwrite a newer
edit.

## Persistence Ownership

`crates/tl-engine/src/store.rs` owns whole-state JSON persistence: the entire
engine state lives in memory and every committed mutation is written as one
atomic `state.json` (temp file plus rename) under the data directory. Managed
copies of imported documents live under `documents/<document-id>/`. A crash
can lose an unwritten mutation but cannot expose a partially written state
file. A real storage layer can replace this without touching the wire
protocol; until that lands there is no database in this tree.

The renderer treats RPC responses as server state. It does not recreate
segment state transitions, QA rules, TM scoring, counts, or persistence
outcomes.

## Format Boundary

`crates/tl-filter-core` defines a format-neutral document event pipeline and a
filter registry. The engine registers filters for DOCX, TXT, Markdown, HTML,
XLIFF, XLSX, and PPTX. Import extracts translation units with structural
paths, splits plain-text units into SRX sentences (`crates/tl-segmentation`),
and keeps units carrying inline tags or pre-existing targets whole so
alignment survives.

Export re-reads the engine-managed source copy, merges sentence segments back
per structural path, leaves fully untranslated units untouched, and falls back
to source text for untranslated sentences inside partially translated units.

## Renderer Data Flow

The Projects view creates a project and imports a selected document. The
workbench (`WorkbenchView`) loads its segments and QA issues through preload
and edits targets through `segment.update` with expected revisions. Side
panels surface TM matches, concordance search, term hits with quick add and
insert, QA issues, document preview, AI assist, and the agent run.

AI goes through the engine: `ai.configure` accepts an OpenAI-compatible
endpoint at runtime, `ai.status` reports honest availability, and without
credentials assist and agent refuse instead of pretending. Agent runs execute
asynchronously in the engine, stream `notify.ai.agent.step` events, and park
every result at a human review gate before anything is applied.

## Recovery And Failure

- Engine restart reloads `state.json`; committed edits, confirmations, TM
  entries, and QA state survive.
- Electron main supervises the engine process with bounded crash-restart and
  backoff; engine status surfaces in the workbench header instead of failing
  silently.
- Export publishes atomically through a temp file (`publish_bytes_noclobber`
  in `crates/tl-filter-core`) and never overwrites an existing destination.
- Protocol stdout contains frames only; structured diagnostics use stderr.
- Incompatible wire changes require a protocol version bump. Additive version
  1 changes regenerate the Rust schema and TypeScript contracts together.

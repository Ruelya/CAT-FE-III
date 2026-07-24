# Asset Curation Evidence

## Product anchors

- `docs/PRD.md:407-425` defines AC-01 through AC-11 and the hard fixture gate:
  known dirty data must be detected at `>= 90%`, high-quality assets must never
  be deleted by mistake, and every mistaken deletion must be recoverable.
- `.trellis/tasks/07-19-complete-full-cat-prd/prd.md:153-158` assigns AC-03 to
  AC-08 to this P1 child and defers AC-09 to AC-11 until scheduler/plugin
  foundations exist.
- `.trellis/tasks/archive/2026-07/07-19-tm-termbase-asset-hub/prd.md` explicitly
  leaves semantic cleaning, quality scores, duplicate curation, mining, drift,
  preview, rollback, and scheduling to this child.
- `.trellis/tasks/archive/2026-07/07-21-alignment-reference-corpora/prd.md`
  owns reference-corpus import/search and leaves corpus-wide quality,
  deduplication, language identification, and terminology mining to this child.

## Existing durable boundaries

- `crates/asset-core/src/lib.rs` owns `TmLibrary`, `TmUnit`, `Termbase`,
  `TermEntry`, normalization, exact keys, number/date/placeholder extraction,
  deterministic matching, and TMX/TBX/CSV/TSV codecs. It is pure and has no
  SQLite or protocol dependency.
- `crates/storage/src/store.rs:1827-2250` provides transactional TM library
  lifecycle, bounded unit pages, imports/exports, and deterministic search.
  Confirmation sinking is in `store.rs:5610-5745` and
  `store.rs:8112-8250`; it writes provenance-bearing units in the same
  immediate transaction as the segment confirmation.
- `crates/storage/src/store/alignment.rs:145-310` and the methods around
  `:666-1000` provide durable reference-corpus records, entries, paging,
  search, reindex, and provenance. Curation must treat these rows as input and
  must not mutate active document/TM/corpus content implicitly.
- `crates/storage/src/migrations.rs` is append-only and currently ends at
  migration 14 (`LATEST_SCHEMA_VERSION`); migrations 12-14 cover corpora,
  task packages, discussions, and snapshots. The curation schema must be a new
  transactional migration 15.
- `operations` is created by migration 2. `append_operation` records project,
  entity, kind, base/result revisions, actor/correlation, before/after JSON,
  and a monotonic project sequence. Curation apply/rollback must use it.

## Reusable domain and execution primitives

- `crates/qa-core/src/lib.rs:36-195` defines bounded `QaCategory`, severity,
  evidence, `QaFindingCandidate`, segment input, terminology expectations, and
  consistency input. `CompiledQaProfile` evaluates length ratio, numbers,
  punctuation, whitespace, repetition, terminology, and bounded regex rules.
  `evaluate_consistency` (`:932-1003`) detects same-source/different-target and
  different-source/same-target drift.
- `crates/alignment-core/src/lib.rs:264-428` exposes deterministic candidate
  scoring with length, numbers, punctuation, tags, and lexical anchors. Its
  algorithm is useful evidence for an optional semantic refinement but must not
  be invoked from the renderer.
- `crates/pipeline/src/lib.rs:58-145` defines durable run/step statuses,
  resumable/cancellable descriptors, and `StepExecutionContext`. Storage and
  Engine already expose `pipeline.run`, `pipeline.run.list/get/cancel/resume`.
  Curation analysis is initially an Engine-owned bounded RPC; scheduler/idle
  triggering remains a later child, so no new background thread is required.

## Wire and desktop boundaries

- `crates/protocol/src/lib.rs` is authoritative. `RpcMethodCatalog` and the
  generated `packages/contracts/src/protocol.schema.json` plus
  `protocol.generated.ts` must change together.
- `crates/engine/src/lib.rs:5708-6380` dispatches every method and owns file
  publication, provider access, and storage orchestration. Curation methods
  belong here, with bounded limits and typed errors.
- `apps/desktop/src/renderer/ProjectInsightsPage.tsx:47-99,451-549` already
  has accessible tabs and page-local loading/action/error state. A focused
  `AssetCurationPanel.tsx` can be added as a new tab without touching the
  unrelated dirty `Workbench.tsx` or shared `styles.css`.
- `packages/contracts/src/index.ts` derives the method map from generated
  types; the renderer must call only `window.translunar.invoke` with generated
  params/results. No renderer code may parse assets, score quality, or write
  SQLite.

## Decisions recorded for this child

1. Deliver AC-01 through AC-08 and a bounded AC-10 export. AC-09 and AC-11 are
   explicit follow-ups for scheduler/plugin foundations.
2. Keep curation analysis deterministic and offline by default. Use script,
   locale, length, number/date/placeholder, duplicate, and lexical-alignment
   signals; an optional configured AI provider may return only strict,
   ID-referenced semantic annotations. Provider failure leaves the offline
   result usable and never writes an asset.
3. Apply is preview-first and quarantine-based. It never hard-deletes a TM
   unit, term entry, or corpus row. Every changed unit has a serialized before
   image and one-click rollback guarded by current library/run revisions.
4. Scope mutation to TM units in this child. Termbases and reference corpora
   participate in the unified catalog, terminology mining, and drift findings;
   direct term/corpus mutation is deferred to their owning workflows.
5. Use bounded pages (`1..500`), a maximum of 100,000 TM units per run, 32
   evidence values per finding, 256-character evidence values, and a 256 KiB
   optional provider request/response envelope.

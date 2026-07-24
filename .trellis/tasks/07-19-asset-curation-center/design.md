# Technical Design: Asset Curation Center

## 1. Ownership and crate boundaries

```text
Project Insights / future API or plugin client
  -> generated protocol-v1 curation/catalog RPCs
  -> Engine orchestration, bounded provider refinement, file publication
  -> curation-core deterministic findings, scoring, mining, export rows
  -> Storage migration 15, revisions, snapshots, operations, TM projection
  -> existing asset-core / qa-core / alignment-core primitives
```

`crates/curation-core` is pure Rust. It receives bounded `CurationUnit`
records and returns findings, scores, mining candidates, drift groups, and
export records. It has no SQLite, filesystem, network, or protocol imports.
`asset-core` remains the owner of normalization and open-format asset values;
`qa-core` remains the owner of segment QA semantics. The new crate may call
their public helpers or use equivalent small pure adapters, but must not reach
through storage internals.

Storage owns all durable state and optimistic concurrency. Engine maps storage
records to protocol types, invokes the pure analyzer, validates optional AI
responses, and performs atomic file publication. React renders authoritative
projections and sends IDs/selections only.

## 2. Durable model and migration 15

Migration 15 is append-only and transactional. It adds nullable/defaulted
curation columns to `tm_units` so old rows remain valid:

- `quality_score_basis_points INTEGER` (null means not yet analyzed);
- `curation_state TEXT NOT NULL DEFAULT 'active'` with `active` and
  `quarantined` values;
- `curation_revision INTEGER NOT NULL DEFAULT 0`;
- `last_curated_run_id TEXT` (no FK so history survives run cleanup).

It creates:

```text
curation_runs
  id, project_id, library_id, status, mode, policy_json,
  base_library_revision, revision, summary_json, actor, reason,
  provider_profile_id, created_at_ms, completed_at_ms, updated_at_ms

curation_run_units
  run_id, library_id, unit_id, quality_score_basis_points,
  recommended_action, explanation_json, unit_snapshot_hash, created_at_ms

curation_findings
  id, run_id, library_id, unit_id, kind, severity, disposition,
  score_basis_points, canonical_unit_id, evidence_json, explanation,
  revision, created_at_ms, updated_at_ms

curation_changes
  id, run_id, finding_id, library_id, unit_id, action,
  before_json, after_json, restored, revision, created_at_ms, restored_at_ms
```

All JSON columns have `json_valid` checks; enums have strict CHECK clauses;
counts/revisions are non-negative. Indexes cover run status/order, run-unit and
finding page order, unit lookup, and library/run. A run is immutable after analysis
except for status transitions (`open -> applied -> rolled_back` or
`open -> discarded`). A change row is the one authoritative rollback image.

Every run targets exactly one TM library and requires one existing project for
audit ownership. The project does not narrow a shared library's analyzed unit
set and the library need not be owned by that project. Global catalog reads
remain available without a project. The existing `tm_units` SELECT/INSERT
helpers are extended consistently so legacy import and confirmation sinking
supply defaults. After an explicit apply, existing TM lookup/search/
concordance exclude quarantined units by default; the catalog and curation
history can still display them for recovery.

## 3. Pure analysis model

`CurationUnit` contains unit ID/library, locales/domain, source/target text,
provenance, metadata, created time, and current state. The analyzer applies
stable passes in this order:

1. Validate non-empty/bounded text and compute normalized keys, numbers, dates,
   placeholders, script profile, and token anchors.
2. Group exact source+target duplicates; choose the earliest `(created_at,id)`
   as canonical. Group same-source competing targets and near-source pairs with
   a bounded n-gram/Jaccard score from `asset-core`.
3. Emit rule findings for source=target, minimum length, length ratio,
   numbers/dates/placeholders, date bounds, likely wrong language, and
   semantic mismatch. Evidence values are truncated and capped.
4. Compute a 0..10,000 quality score from provenance bonus plus deterministic
   penalties. Optional provider annotations can add a bounded semantic score,
   but never remove a hard rule finding.
5. Mine candidate terms from repeated source n-grams (Latin tokens and CJK
   character n-grams) with stable target agreement. Build drift groups from
   normalized source/target maps and return only IDs/evidence.

Language detection is deliberately conservative: locale script expectations
   (CJK/Japanese/Korean vs Latin/Cyrillic) and a small stopword/script signal
   produce `likely-wrong-language` only when confidence clears a threshold.
   This avoids deleting short legitimate product names. The optional provider
   path receives a delimited JSON array of unit IDs, locale pair, and bounded
   text excerpts; the strict response contains only known IDs, score, label,
   and short evidence. Any unknown ID, duplicate, text echo, invalid score, or
   oversized response rejects the entire refinement.

## 4. Storage transactions and state machine

### Analyze

Engine reads a deterministic snapshot of at most 100,000 units plus the current
library revision, runs the pure analyzer, and calls
`Store::create_curation_run`. Storage opens an immediate transaction,
revalidates the library revision, and inserts the run, every run-unit score,
and all findings atomically. If the library changed during analysis or any
insertion fails, no run/findings are visible.

### Apply

`Store::apply_curation` opens an immediate transaction, reloads the run,
checks `status=open`, expected run revision, every selected finding, and the
library revision. It locks all run units by ID, verifies their snapshot hashes,
serializes their complete before projection, applies the analyzed score to
every unit, quarantines only units named by selected actionable findings,
increments `curation_revision`, and sets `last_curated_run_id`. It inserts one
`curation_changes` row per changed unit, increments the library revision once,
updates run status/summary, and appends one `operations` record.
Any mismatch rolls back every statement and returns a typed conflict.

### Rollback

`Store::rollback_curation` checks the run/change/library revisions, then restores
the before-image score, state, and last-run fields while incrementing each unit
curation revision, marks each change restored, increments the library revision,
updates the run, and appends a rollback operation in the same transaction. A
second identical rollback returns
the terminal result without changing rows; a stale interleaving returns a
conflict and leaves all state untouched.

### Export

Engine loads only active units from a completed/applied run, converts them to a
strict JSONL or TSV row, validates row count/UTF-8, writes a temporary sibling,
fsyncs, and calls the existing no-clobber publisher. Existing destinations are
never replaced.

## 5. Protocol surface

Additive methods and typed payloads:

```text
asset.catalog.list        AssetCatalogListParams        -> AssetCatalogPage
curation.run              CurationRunParams             -> CurationRunSnapshot
curation.finding.list     CurationFindingListParams     -> CurationFindingPage
curation.run.get           CurationRunIdParams            -> CurationRunSnapshot
curation.apply            CurationApplyParams            -> CurationMutationResult
curation.rollback          CurationRollbackParams        -> CurationMutationResult
curation.export            CurationExportParams          -> CurationExportResult
```

`curation.run` accepts one project for audit ownership, one library, policy,
actor/reason, and an optional provider profile. `curation.apply` carries
selected finding IDs
and expected run/library revisions. `asset.catalog.list` supports
`kind=all|tm|termbase|corpus`, optional project, locale/domain/query/time
filters, and bounded pages.
Every page returns `offset`, `limit`, and `total`; limits outside `1..500` are
invalid requests. Error mapping uses existing `not_found`, `conflict`,
`invalid_request`, `invalid_state`, `storage_error`, and `export_error` codes,
with bounded IDs/counts and no raw asset text in error messages.

The protocol schema is generated from Rust. `packages/contracts` is regenerated
and checked; no handwritten renderer interfaces are permitted.

## 6. Desktop integration

Add `AssetCurationPanel.tsx` and a focused style file imported by that panel.
Add an `assets` tab to `ProjectInsightsPage` while preserving existing tabs and
avoiding unrelated `Workbench.tsx`/`styles.css` edits. The panel has:

- catalog scope/kind/locale/domain/query controls and deterministic paging;
- run policy controls and a clearly labeled Analyze action;
- summary metrics and a findings table with severity, score, rule, evidence,
  provenance, and selection checkboxes;
- preview/apply/rollback/export actions with actor/reason fields;
- named loading, empty, error, stale, applied, rolled-back, and export status
  regions.

The page owns all RPC calls and refreshes authoritative state after every
mutation. The panel owns only transient filters, selected IDs, and dialog
visibility. No text parsing, scoring, hashing, file access, or optimistic
revision/count updates occur in React. Icon-only actions use Lucide with
`title` and `aria-label`; controls remain contained at 1250x744, 1680x942,
and 1920x1080.

## 7. Compatibility, performance, and rollback

- Existing TM search, confirmation, termbase, corpus, QA, alignment, pipeline,
  and snapshot methods remain wire-compatible. New fields are additive/defaulted
  where they touch existing projections.
- Curation analysis is bounded to 100,000 units and must not load document
  bodies. A deterministic 10,000-unit fixture records elapsed time and peak
  memory; paging happens after stable sorting.
- Migration backup/restore is the rollback for schema 15. Binary rollback to a
  pre-curation build leaves quarantined columns harmless; restoring the backup
  removes migration 15 data. No released migration is edited.
- Curation is never scheduled implicitly. Provider use is opt-in, BYOK, and
  source-labelled; network failure returns the offline analysis or a typed
  refinement error without changing assets.

# Technical Design: Project Lifecycle And Analytics

## 1. Architecture And Ownership

```text
Project home / setup / search / analytics
  -> generated project.*, document.*, search.*, analysis.*, archive.* RPC
  -> Engine lifecycle and analytics services
  -> lifecycle-core pure matching/counting/archive manifest models
  -> Storage migration 10 durable versions/templates/recycle/index/snapshots
  -> existing filters, editor history, assets, QA, AI usage, backup primitives
```

Add a pure `lifecycle-core` crate for deterministic re-import matching, Unicode
word/CJK/repetition counts, match-band weighting, archive manifest/hash models,
and analytics aggregation inputs. It must not access SQLite, Electron, secrets,
or local paths. Storage owns queries and transactions; Engine owns file staging,
archive ZIP publication/validation, recursive import discovery, and RPC errors.

## 2. Migration 10 And Durable Model

Add revisioned `project_templates`, `document_versions`,
`document_reimport_previews`, `document_reimport_items`, `recycle_entries`,
`project_archive_records`, `analysis_profiles`, `analysis_runs/items`, and a
contentless FTS/search projection or equivalent indexed tables with triggers/
explicit reconciliation. Extend project/document lifecycle metadata additively.
Preserve migrations 1..9 unchanged and use the existing pre-migration backup.

## 3. Multi-File And Templates

Batch import accepts OS-selected paths only in main/Engine, expands folders with
bounds, normalizes relative paths, stages each filter import, and commits valid
documents according to explicit atomicity mode. The initial UI uses
best-effort-per-file with a complete diagnostic result; project creation itself
is rolled back if no file succeeds.

Templates store IDs and safe configuration snapshots. Creation resolves each
reference against current assets/providers/profiles/pipelines and returns a
dependency report; credentials remain keyring-owned and never enter archives or
templates.

## 4. Re-Import

Engine imports the candidate source into staging units, then lifecycle-core
matches by structural path/signature followed by unique normalized source plus
bounded neighbor context. Preview rows are immutable and tied to document/source
revision/hash. Apply creates a document version, maps unchanged state, inserts
new rows, supersedes removed rows, rebuilds context/search/QA, and records one
compound history event in a transaction.

## 5. Archive, Restore, And Recycle

Project archives are versioned ZIP packages with canonical JSON manifest,
per-entry SHA-256, limits, managed sources and project-owned SQLite/JSON slices.
Engine validates to staging before one storage import transaction. Shared asset
dependencies are declared by stable metadata and remapped explicitly.

Recycle is soft deletion in the main database. Normal list/search/analytics
exclude recycled rows. Restore reactivates the same identity when safe; purge
deletes dependent project-owned rows in one transaction after explicit backup/
reason checks. Lifecycle archive is reversible state, not recycle deletion.

## 6. Search And Analytics

Storage owns normalized indexed source/target/comment/note projections and
bounded snippet extraction. Every mutation boundary reconciles the index in the
same transaction. Search results contain only IDs, names, field, snippet,
ordinal and status data required for navigation.

Analysis snapshots pin project/document revisions, profile revision and time.
Pure counters distinguish Unicode words, scalar characters and CJK characters;
repetition groups use normalized hashes. TM bands use Engine-ranked results.
Progress and time-in-state replay durable events with a bounded idle-gap rule.
AI contribution joins applied run proposals to later target revisions and marks
unknown history unavailable. Asset health reuses authoritative asset/usage data.

## 7. Protocol And Desktop

Add additive bounded methods for project batch import/home/list, templates,
re-import preview/apply, archive export/restore, recycle list/restore/purge,
history, global search, analysis profile/run/get/list, and analytics summary/
trend. Renderer uses the existing generic invoke bridge and main-owned file/
folder/archive dialogs plus sanitized drag/drop paths.

The desktop adds project home/dashboard and upgrades setup to a three-step
wizard. Every navigation from Workbench flushes edits first. Search results and
file progress navigate through project/document/segment IDs; no counts,
matching, weighting or archive decisions are recalculated in React.

## 8. Compatibility And Rollback

Legacy `project.create`, `document.import`, lifecycle and backup calls remain.
New fields default safely for old requests. Archive format version and schema
compatibility fail before writes. Rollback restores the pre-v10 backup; project
archives remain portable artifacts and are never silently upgraded in place.

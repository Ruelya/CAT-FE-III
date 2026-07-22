# Technical Design: Interoperability, Alignment, And Offline Review

## 1. Architecture And Ownership

The existing boundary remains authoritative:

```text
trusted desktop dialogs / renderer orchestration
  -> generated protocol contracts
  -> Engine services
  -> format / interop / alignment domain crates
  -> transactional Store + managed immutable files
```

Native CAT and DOCX/ZIP parsing stays in filter/interop crates. Alignment,
package validation/merge, corpus retrieval, discussion transitions, and
snapshot restore stay in Rust. React renders authoritative previews and sends
IDs, selections, expected revisions, actors, and reasons.

## 2. Child Boundaries

### External CAT interchange

Extend `filter-xliff` with reusable XLIFF token/range primitives and add
format-specific adapters for `builtin.sdlxliff`, `builtin.mqxliff`, and
`builtin.mqxlz`. Each adapter owns probe confidence, resource bounds, stable
structural paths, protected inline tags, target/status/comment ranges,
degradation, validation, and atomic no-clobber publication. MQXLZ is a bounded
ZIP envelope around MQXLIFF plus opaque entries.

### Bilingual DOCX and table ingest

Use a dedicated interop service rather than overloading ordinary DOCX export.
Review documents carry an opaque manifest and row IDs; preview parses the
returned file, binds it to project/document/base revisions, and emits proposed
review changes. Generic table ingest produces a staged asset-import preview and
uses existing TM library writes on apply.

### Alignment and corpora

Add an `alignment-core` crate for deterministic candidates and edit validation.
Migration-backed sessions own source/target document revisions, links and
status. Applying selected links delegates to the existing TM service. Reference
corpora use managed immutable source documents plus rebuildable search
projections; Engine retrieval returns provenance and feeds AI grounding through
the existing grounding builder.

### Offline packages

Use a versioned ZIP manifest with canonical JSON, bounded entries and SHA-256
hashes. Export snapshots selected project data and asset slices. Import first
stages and validates; preview computes three-way conflicts against base and
current revisions; apply writes selected operations in one immediate
transaction. Package files never become a second live workspace database.

### Discussions and snapshots

Thread/message tables are append-oriented with explicit resolve/reopen
operations. Mentions are parsed and normalized in Rust but do not notify a
server. Named snapshots store a canonical project-owned state document plus
hash and dependency references. Restore validates expected project revision and
applies a forward history operation, preserving previous state for undo/audit.

## 3. Protocol Shape

Additive protocol-v1 namespaces are expected to be:

```text
interop.review.export / interop.review.preview / interop.review.apply
interop.table.preview / interop.table.apply
alignment.session.create/get/list/update/apply
corpus.list/import/remove/search
taskPackage.export / taskPackage.preview / taskPackage.apply
discussion.thread.list/create/resolve
discussion.message.list/create/update/delete
project.snapshot.list/create/get/previewRestore/restore
```

Exact request/result structures are finalized within each child and generated
into `packages/contracts`. Long parsing/indexing work returns durable run IDs if
it cannot meet the ordinary bounded RPC latency budget.

## 4. Persistence And Compatibility

- Released migrations remain append-only. Each child owns one additive schema
  migration only when durable state is required and proves fresh/upgrade/
  rollback/reopen behavior.
- Existing generic import/export, XLIFF structural paths, TM/TB IDs, project
  archives, editor operations, and comments remain compatible.
- External identities are namespaced by format and document. Original bytes are
  immutable managed sources; export rewrites only format-owned ranges.
- Derived alignment/corpus indexes are rebuildable. Shared TM/TB content is
  referenced or sliced explicitly, never silently copied on snapshot restore.

## 5. Security And Resource Limits

XML forbids DTD/external entities and enforces depth/text/unit limits. ZIP
readers reject traversal, duplicate names, encryption, excessive entry count,
entry size and compression ratio. Manifests use strict schemas and canonical
hashes. Error/log payloads may identify entry/row/segment IDs and counts but
never include credentials, full document text, or unbounded vendor metadata.

## 6. Desktop Integration

Project Insights gains an Interop area with focused tabs rather than nesting
cards. Workbench exposes segment discussion and review-diff navigation. Trusted
main/preload methods select native CAT, DOCX, and task-package input/output
paths. Every destructive or revisioned apply keeps an accessible dialog mounted
until the awaited Engine result succeeds.

## 7. Rollout And Rollback

Each child is committed and archived independently. New filters/capabilities are
registered only with passing fixtures and smoke coverage. A failed import,
preview, merge, alignment apply, corpus index, or snapshot restore leaves
SQLite and existing output files unchanged. Later children may extend earlier
payloads additively but cannot weaken their validation or native-fidelity tests.

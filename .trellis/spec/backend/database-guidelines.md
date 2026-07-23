# Database Guidelines

## Storage Model

`crates/storage` uses `rusqlite` directly. `Store` owns one connection to
`<data-dir>/translunar.sqlite3` and the managed `sources/`, `exports/`, and
`tmp/` directories. SQLite is durable truth; renderer state and future search
indexes are projections that must be rebuildable.

Every opened connection is configured by `configure_connection` in
`crates/storage/src/migrations.rs` with foreign keys, WAL,
`synchronous=NORMAL`, and a 5000 ms busy timeout.

## Query And Transaction Pattern

- Use SQL constants or inline SQL with positional parameters and `params!`.
  Never interpolate user or document values into SQL text.
- Map rows through named functions such as `row_to_segment` and collect the
  iterator into `Result<Vec<_>, _>` before returning.
- Use `OptionalExtension` only when absence is an expected branch; otherwise
  convert absence to `StorageError::NotFound`.
- Use `TransactionBehavior::Immediate` for writes. Validate the current row,
  perform all related writes, read the authoritative result, then commit.
- Keep compound transitions atomic. `Store::confirm_segment` updates the
  segment, upserts its TM provenance, reconciles number QA, and commits once.
- Require `expected_revision` for mutable segment writes. The SQL `WHERE`
  clause includes the revision and a zero-row update becomes a typed conflict.

```rust
let transaction = self.connection
    .transaction_with_behavior(TransactionBehavior::Immediate)?;
let current = find_segment(&transaction, segment_id)?;
ensure_revision(&current, expected_revision)?;
// related writes use the same transaction
transaction.commit()?;
```

## Schema And Naming

Tables and columns use plural snake_case names. IDs are text UUIDs; timestamps
are integer Unix milliseconds with an `_at_ms` suffix; booleans are constrained
integers. Foreign keys state their delete behavior. State/severity fields have
`CHECK` constraints, and application invariants also use `STRICT` tables.

Indexes use `<table>_<purpose>_idx`, for example
`tm_entries_exact_idx`. Natural uniqueness is declared in schema, such as
`UNIQUE(document_id, ordinal)` and `UNIQUE(memory_id, origin_segment_id)`.

`inline_tags.id` is a global primary key, so format filters namespace it with
the Engine-assigned document ID. Migration 5 stores imported format/XLIFF notes
in `segment_notes` with `PRIMARY KEY(segment_id, id)`; segment, tags, and notes
are inserted in the same document-import transaction.

## Migrations

Schema versioning uses `PRAGMA user_version`. Released migrations are
append-only entries in `crates/storage/src/migrations.rs`:

1. Increase `LATEST_SCHEMA_VERSION` by exactly one.
2. Add a new immutable migration constant.
3. Append `(version, sql)` to the ordered migration list.
4. Run each migration in an immediate transaction and update `user_version`
   inside that transaction.
5. Reject databases newer than the engine with `SchemaTooNew`.

Never edit migration 1 after it has shipped. Add a forward migration and test
both a fresh database and an upgrade from the previous version.

## Required Tests

Storage tests live beside `Store` and use `tempfile`. Cover foreign keys and
WAL, migration rollback, restart recovery, stale revisions, transaction
atomicity, deterministic ordering, and cascade behavior. A failed write must
leave no partial segment, TM, QA, or file publication state.

## Avoid

- No ORM abstraction over the current direct-SQL repository pattern.
- No unchecked integer casts between SQLite `i64` and domain counters.
- No read-modify-write sequence outside one transaction.
- No schema mutation during ordinary query execution.
- No derived cache that cannot be discarded and rebuilt from SQLite.

## Portable Paths, Recovery, And Capacity

Managed source/version paths are workspace-relative slash-separated values in
SQLite. `Store::get_document` and health checks resolve them against
`DataPaths::root`; schema-v1 absolute paths are converted in an immediate
transaction during open when they are inside that root. This keeps an explicit
backup restorable in a different directory without rewriting user content.

Before a pending migration, use SQLite's online backup API and fsync the
snapshot plus manifest. Migration and orphan-run recovery each use one
`TransactionBehavior::Immediate` transaction. A worker connection must open
with `open_worker` so it does not mark another live worker interrupted.

Large collections are verified with bounded SQL pages, not `all_segments`.
The `storage-benchmark` binary streams a deterministic 100,000-segment fixture,
measures aggregate/first-middle-last/history pages and peak RSS, and deletes the
generated directory unless `--keep` is supplied.

## Offline Task Package Storage

### Schema contract

Migration 13 is append-only and creates four STRICT tables: `task_packages`,
`task_package_bindings`, `task_package_previews`, and
`task_package_preview_rows`. Package and preview status values are constrained
to their finite sets; package kind and row disposition are constrained in SQL;
`UNIQUE(package_id, origin_segment_id)` prevents duplicate origin bindings and
`UNIQUE(local_segment_id)` prevents a local segment from being rebound. Preview
rows cascade only with their owning preview. The migration must pass fresh,
v12-upgrade, reopen, constraint, and late-statement rollback tests.

### Transaction contract

`taskPackage.preview` validates the complete staged transport and persists the
package, counts, diagnostics, hashes, projections, and expected revisions in an
Immediate transaction. It does not update segments, documents, TM/TB, or
operations. `taskPackage.import` creates the detached project, managed sources,
read-only asset snapshots, and immutable bindings in one transaction; a failed
row or source publication leaves no project or source residue.

`Store::apply_task_package` performs all selected-row validation and writes in
one Immediate transaction. It checks project/document/segment revisions,
current projection hashes, immutable source identity, protected tags, and row
dispositions before applying target, tags, workflow, comments, document and
project revisions, TM confirmation, and operation/editor history. Any later
failure rolls back every side effect and leaves the open preview and staged
package retryable.

### Idempotency and files

The apply fingerprint is derived internally with canonical JSON from
`preview_id`, expected project revision, sorted unique selected row IDs, actor,
and reason. It is stored with the terminal preview/package result; the wire
request has no digest field. A matching terminal retry returns the stored result
without another operation, comment, TM row, or revision increment. A different
fingerprint is `InvalidState`. Discard marks open previews/package discarded in
SQLite, commits the audit operation, then removes only validated workspace-local
staged paths.

### Storage checks

- Good: reopen an applied preview and replay the same selection; assert the
  operation ID and all revisions remain unchanged.
- Base: page durable rows after restart and apply only safe explicit IDs while
  an unselected local segment remains unchanged.
- Bad: write selected rows in separate transactions, calculate the digest in
  React, or delete staging before the status transaction commits.

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

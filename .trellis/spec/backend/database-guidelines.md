# Database Guidelines

> **Historical / not current greenfield.** There is no database in the current
> tree. `crates/storage` and `translunar.sqlite3` were removed in the
> greenfield reset; persistence today is the whole-state `state.json` written
> atomically by `crates/tl-engine/src/store.rs`. Keep this document as the
> reference contract for when a real storage layer returns.

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

## Plugin version history and staged package storage

Migration 18 is an append-only extension after the released migrations 16 and
17. It keeps the migration-16 installation projection for wire compatibility
and stores immutable candidate history in `plugin_versions`. The active version
foreign key is constrained to the same plugin; version rows, package hashes,
and normalized JSON projections are not updated in place. Any future plugin
schema change must add a migration rather than editing 16, 17, or 18.

Plugin package writes follow the same storage transaction boundary as other
mutable state:

- package bytes are copied to a unique staging directory and hashed there;
- the canonical hash covers sorted regular-file paths, sizes, and streamed
  SHA-256 digests, including `manifest.json`;
- a successful activation uses one `TransactionBehavior::Immediate` CAS over
  the installation revision and active-version pointer;
- failed candidates remain diagnosable without replacing the prior active
  package, and rollback selects a validated version belonging to the same id;
- uninstall quarantines the managed root before deleting rows and leaves the
  quarantine recoverable when cleanup fails.

Filesystem-aware normalization during `Store::open` is idempotent. Missing or
tampered managed packages retain their durable installation/version rows and
receive bounded diagnostics; normalization never silently deletes history.
The tested concurrency boundary is SQLite CAS plus the serialized Engine
dispatcher, not ownership by multiple independent Engine processes.

### Migration 24: package provenance and distribution metadata

Migration 24 is an append-only extension after migrations 16–23. It adds
host-derived provenance and optional distribution JSON to both the active
installation projection and immutable version history:

```text
plugin_installations.source_kind
  TEXT NOT NULL DEFAULT 'localDirectory'
  CHECK (source_kind IN ('localDirectory', 'localArchive', 'bundled'))

plugin_installations.distribution_json
  TEXT NULL
  CHECK (NULL or json object, valid JSON, <= 4096 bytes)

plugin_versions.source_kind
  same closed enum as installations

plugin_versions.distribution_json
  same bounds as installations
```

Contracts:

- Existing rows backfill to `localDirectory` with null distribution; released
  migrations 16–24 remain immutable after ship.
- Version rows own historical provenance; the installation row mirrors the
  active version for list/get projections.
- `source_kind` is written only by Engine lifecycle after
  `classify_source_kind`; Store must not accept a renderer-supplied provenance
  override.
- `distribution_json` stores the closed publisher/license/homepage object (or
  null for legacy packages). It is not a grant of bundled authority.

## Plugin capability decisions and audit

### 1. Scope / Trigger

Use this contract when changing migration 19, normalized manifest permission
requests, decision persistence, upgrade carry-forward, authorization checks,
or plugin audit paging.

### 2. Signatures

Migration 19 adds two STRICT tables:

```text
plugin_capability_requests(
  id, plugin_id, version_id, capability_id, required,
  requested_scope_json, granted_scope_json, contribution_id,
  legacy_permission, carried_from_request_id, decision, actor, reason,
  revision, created_at_ms, updated_at_ms, decided_at_ms
)
plugin_capability_audit(
  sequence, id, plugin_id, version_id, request_id, capability_id,
  scope_json, event, outcome, operation, actor, reason,
  request_revision, created_at_ms
)
```

`Store::decide_plugin_capability(PluginCapabilityDecisionInput)` is the only
decision mutation entry point. `Store::authorize_plugin_capability` evaluates
one `PluginCapabilityCheck` and appends the operation result in the same
immediate transaction.

### 3. Contracts

- A request is unique by plugin/version/capability/requested-scope/contribution.
  Its decision is `pending|granted|denied|revoked`; revision starts at zero and
  increments exactly once for every accepted review decision.
- `granted_scope_json` is null unless the decision is granted, is normalized
  before persistence, and must be contained by `requested_scope_json`.
- Decision mutation validates actor/reason bounds and expected revision, writes
  the request and decision audit event, updates the legacy active projection,
  and performs any active-plugin detach in one Immediate transaction.
- The audit stream is ordered by the SQLite `AUTOINCREMENT` sequence. Update
  and delete triggers make it immutable; reads page by plugin and optional
  request ID in ascending sequence order.
- Upgrade carry uses semantic identity and records `carried_from_request_id`.
  Unsupported capability IDs never carry a grant. Store opening may add missing
  structured requests idempotently but must not rewrite existing decisions.
- Migration 19 maps exact active-version legacy grants to explicit decisions.
  Ambiguous/unsupported legacy entries stay pending; released migrations 16
  through 19 remain immutable.

### 4. Validation & Error Matrix

| Condition | Required storage result |
| --- | --- |
| Stale `expected_revision` | `EntityConflict`; no request, plugin, projection, or audit write |
| Grant scope is malformed or exceeds request | `InvalidState`; transaction rolls back |
| Grant targets unsupported capability | `InvalidState`; request remains visible and ungranted |
| Revoke targets a non-granted request | `InvalidState`; no detach or audit mutation |
| Active granted request is denied/revoked | Request decision and plugin disable commit together with ordered evidence |
| Audit update/delete attempted | SQLite trigger aborts the statement |
| Migration 19 reopens or normalization repeats | No duplicate request/audit row and no decision rewrite |

### 5. Good / Base / Bad Cases

- Good: decide revision 0, receive revision 1, authorize an in-scope operation,
  restart, and read immutable decision plus operation audit rows in sequence.
- Base: preserve an unsupported optional request as pending so a newer host can
  interpret it later without granting authority today.
- Bad: append audit after committing the decision, delete denial history,
  compare raw scope JSON strings, or carry a grant by capability name alone.

### 6. Tests Required

- Migration tests cover fresh v19, v18 upgrade, exact legacy mapping,
  unsupported legacy requests, immutable triggers, reopen, and idempotency.
- Store tests cover decision CAS, bounded actor/reason, contained scope,
  operation allow/deny evidence, detach atomicity, restart, audit paging/order,
  cross-plugin isolation, and semantic carry-forward.
- Engine tests assert a failed transaction leaves plugin revision, request
  revision, active registration, and audit count unchanged.

### 7. Wrong vs Correct

#### Wrong

```rust
update_decision(request_id)?;
transaction.commit()?;
append_audit(request_id)?;
```

#### Correct

```rust
let tx = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
compare_request_revision(&tx, request_id, expected_revision)?;
update_decision_and_projection(&tx, input)?;
append_immutable_audit(&tx, input)?;
tx.commit()?;
```

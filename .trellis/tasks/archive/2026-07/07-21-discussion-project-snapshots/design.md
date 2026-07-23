# Technical Design

## Boundaries

- `crates/protocol` defines discussion and snapshot request/result types and
  method names. `ProtocolCatalog` remains the single contract source.
- `crates/storage` owns migration 14, validation, deterministic paging,
  canonical payload hashing, and all transactions. New implementation lives
  in `store/discussion.rs` and `store/snapshot.rs` with small public records
  re-exported by `store.rs`.
- `crates/engine` validates bounded actor/reason/text fields, maps storage
  errors to existing typed RPC errors, and dispatches methods. It does not
  calculate diffs or parse payloads in the renderer.
- `apps/desktop` adds a Project Insights tab and calls only generated
  `window.translunar.invoke` contracts. No new file dialog or filesystem API is
  needed.

## Persistence

Migration 14 adds:

- `discussion_threads` with scope, project/document/segment references,
  subject, status, revision, and timestamps;
- `discussion_messages` with per-thread ordinal, actor, body, mentions JSON,
  revision, durable deletion state, and timestamps;
- `project_snapshots` with immutable name, base revision, canonical payload,
  SHA-256, actor/reason, and timestamps;
- `project_snapshot_previews` with expected revision, current-state digest,
  summary JSON, status, and applied timestamp.

Foreign keys and scope checks are enforced in storage validation. Indexes use
project + updated/created time + ID, and all list operations cap page size at
the protocol boundary.

## Snapshot payload and restore

The payload is a versioned, serde-validated `ProjectSnapshotPayload` composed
of the existing project/document/version/segment/editor/review records plus
discussion records and mount references. It contains no operations, credentials,
AI profile secrets, or TM/TB unit rows. Canonical serialization uses sorted
vectors and `serde_json::to_vec`; SHA-256 is stored with the snapshot.

Preview loads the current payload, computes a digest, compares stable IDs and
content, and reports counts and unresolved mount IDs. It writes one preview row
but no project data. Restore opens an immediate transaction, rechecks the
project revision and digest, validates all rows and mount references, then:

1. updates project configuration and revision;
2. restores existing project-local documents/versions/segments/editor children
   and inserts missing rows with preserved IDs;
3. marks active documents absent from the snapshot as local trash (without
   deleting rows or shared assets);
4. restores only mount references that still exist, leaving unrelated shared
   assets untouched;
5. restores discussions and records one `project.snapshot.restore` operation.

The transaction commits once. Any validation, foreign-key, missing-source, or
revision failure rolls back and leaves the preview open. Repeating a successful
restore is rejected by terminal preview status; a fresh preview is required.

## Discussion behavior

Thread creation and message/resolve mutations use expected thread/project or
message revisions, derive mentions from literal `@token` runs, and append an
operation with actor/reason in the same transaction. Message edits preserve
their ordinal; deletes retain a tombstone. Results remain ordered by
`(ordinal, id)`. Thread list filters are scope-aware and exclude resolved
threads by default.

The additive protocol names follow the parent design exactly:

```text
discussion.thread.list/create/resolve
discussion.message.list/create/update/delete
project.snapshot.list/create/get/previewRestore/restore
```

## Compatibility and rollback

- Existing databases migrate atomically from v13 to v14; rollback is opening a
  pre-migration backup and does not require data rewriting.
- Existing RPCs and generated contracts remain unchanged except for additive
  methods/types and the schema version capability.
- If a snapshot restore fails, the preview row stays `open`; no compensating
  operation or partial row update is emitted.

## Security and limits

Actor, reason, subject, and message lengths are bounded. Mention extraction is
local and treats `@` followed by a non-whitespace token as metadata only.
Snapshot payload bytes, document count, segment count, and preview page size
are bounded before JSON parsing or transaction work. Credentials and secret
fields are never selected into the payload.

# Discussion Threads And Project Snapshots

## Goal

Provide a restart-safe, local-only way to discuss project work and restore a
named project state. This closes R5 of the interoperability/offline-review
parent without implying network collaboration or notification delivery.

## Confirmed Baseline

- `operations` already provides ordered, durable project history with actor,
  reason, revisions, and before/after metadata.
- Segment comments, review proposals, document versions, project lifecycle,
  mounted TM/TB references, and project configuration already exist.
- Project archives are portable exports that create a new identity on restore;
  they are not suitable for restoring an existing project in place.
- The Rust protocol is the source of truth for generated TypeScript contracts;
  renderer code must not parse persistence or derive revisions.

## Requirements

### D1. Scoped discussion threads

- Support project-, document-, and segment-scoped threads. A thread has a
  stable ID, optional title, open/resolved state, revision, actor timestamps,
  and an ordered message count.
- Create a thread with its first message, append messages with an expected
  thread revision, and resolve/reopen with an expected thread revision.
- Messages keep stable ordinals and contain literal `@mention` tokens returned
  as local metadata. Revisioned edits preserve the ordinal; deletion is a
  durable tombstone so history and message order remain auditable. Mentions do
  not enqueue notifications or contact a server.
- List threads and messages with bounded paging, deterministic ordering, and an
  `includeResolved` filter. Every mutation appends an operation-history entry.

### S1. Immutable named snapshots

- Create a named immutable snapshot through the expected project revision. A
  snapshot captures project configuration, active documents and versions,
  current segments/tags/notes/comments/reviews/workflow state, discussion
  threads/messages, and mounted TM/TB references.
- Snapshot payloads never contain credentials, AI secrets, or shared asset
  rows. Mounted libraries/termbases are references only.
- List snapshots by project with bounded deterministic paging and retrieve one
  named snapshot's public metadata by ID. Creating the same name is rejected
  rather than replacing an existing snapshot.

### S2. Preview and restore

- Preview a snapshot against an expected current project revision and return a
  stable preview ID, current-state digest, changed/added/removed counts, and
  missing mounted-asset references before any write.
- Restore only an open preview whose expected project revision and state digest
  still match. Apply all project-local changes in one transaction, increment
  the project revision once, and append an auditable forward operation.
- Restore never deletes the snapshot, rewrites shared TM/TB rows, or changes
  projects outside the selected project. A failed restore is all-or-nothing
  and the preview remains retryable after a fresh preview.

### F1. Desktop surface and boundaries

- Add a Project Insights surface for discussions and snapshots with typed
  loading, empty, error, stale, and terminal states; accessible controls and
  bounded paging; and no browser-native confirm dialogs.
- Main/preload expose no filesystem capability for this workflow. React calls
  generated Engine contracts only and never parses snapshot JSON or computes
  digests.
- Existing history, editor comments, project archive, task-package, and
  alignment workflows remain wire-compatible.

## Acceptance Criteria

- [x] AC1: A project, document, and segment thread can each be created,
      paged, appended to, resolved, reopened, and recovered after Engine
      restart; message order and literal mentions remain stable.
- [x] AC2: Thread mutations reject stale thread/project revisions without
      writing a message or state change, and each successful mutation appears
      in `history.list` with actor and reason metadata.
- [x] AC3: A named snapshot captures the required project-local state and
      mounted-asset references while excluding credentials and shared asset
      contents; duplicate names are rejected.
- [x] AC4: Snapshot preview reports deterministic diffs and missing
      dependencies without changing the workspace; stale previews are rejected
      before any write.
- [x] AC5: A valid restore atomically returns project-local state, preserves
      the snapshot and shared assets, increments the project revision once,
      appends history, and survives restart. Injected failures leave no partial
      restore.
- [x] AC6: Desktop discussions/snapshots expose the workflows through typed
      Engine calls, accessible dialogs/labels, bounded paging, and coherent
      error/stale/terminal states at all supported viewports.
- [x] AC7: Rust format, clippy, targeted storage/engine tests, contract drift,
      stdio smoke, and real-Engine Electron E2E cover restart, stale, duplicate,
      missing-dependency, rollback, console-error, and overflow paths.

## Constraints And Out Of Scope

- Local metadata only: no sockets, notification service, identity provider,
  simultaneous editing, permissions/roles, or attachments.
- Snapshot export/import files are out of scope; the existing project archive
  remains the portable project handoff mechanism.
- Restoring a snapshot may mark documents that are absent from the snapshot as
  project-local trash, but it never purges their rows or shared dependencies.

## Technical Notes

- Use a schema migration after v13. Store immutable snapshot payloads as
  validated JSON plus SHA-256 and persist preview state for stale checking.
- Derive internal restore digests from the canonical preview payload and the
  current project state. Do not expose a client-supplied request digest.
- Keep snapshot and discussion operations in the existing `operations` stream;
  operation metadata contains IDs/counts, not secrets or full credentials.

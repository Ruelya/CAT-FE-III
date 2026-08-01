# Closeout: 07-19-collaboration-server

## What shipped

Lightweight **local-first collaboration MVP** on the headless Engine / SQLite
boundary (offline single-user mode remains intact):

| Area | Delivery |
| --- | --- |
| Storage | Migration **17**: `collab_members`, `collab_segment_locks`, `collab_presence`, `collab_assignments`, `collab_op_log` |
| Protocol | Additive `collab.*` methods + capability `collab.local.v1`; contracts regenerated |
| Membership | Add/list/remove with roles `owner` \| `member`; restart-persistent |
| Locks | Acquire/release/heartbeat/list; typed `LockHeld` → RPC `conflict` with `holderActorId` |
| Presence | Heartbeat + list with wall-clock TTL filtering |
| Assignments | Create/list/complete with **required** `expectedRevision: u64` |
| Op-log | Append-only project sequences for membership/lock/assignment mutations; list by `afterSequence` |
| Quality | Storage collab tests (round-trip, TTL filter, transactional rollback); focused `TRANSLUNAR_SMOKE_SCOPE=collab` smoke; independent verify-1 gates + TTL/revision probe |

### Hardening from quality loop (F1/F2)

- **F1 (fixed):** `CollabAssignmentCompleteParams.expected_revision` is required
  `u64` (no `Option` / `serde(default)`). Missing/null → `invalid_request` with
  no state/op side effects; stale → `conflict` with no side effects.
- **F2 (fixed):** Membership/lock/assignment mutations use one SQLite
  `Immediate` transaction for entity write + sequence allocation + op insert.
  `collab.lock.heartbeat` appends `lock.heartbeat` with new expiry/revision.
  Fault test proves op insert failure rolls back entity rows.

### Acceptance (AC-01..AC-06)

| AC | Status | Evidence |
| --- | --- | --- |
| AC-01 members survive restart | met | focused collab smoke restart list |
| AC-02 typed lock conflict | met | smoke + probe (`entity=segment_lock`, `holderActorId`) |
| AC-03 presence TTL | met | verify-1 wall-clock probe (`ttlMs=1000`) |
| AC-04 assignment revision safety | met | required wire field + missing/stale black-box |
| AC-05 op-log foundation | met | transactional append + smoke kinds + rollback test |
| AC-06 owned-surface gates | met | storage collab tests, storage+engine clippy, collab smoke |

Review **findings-2** verdict: **green** (`ready_for_closeout: yes`).

## Specs touched

| Path | Change |
| --- | --- |
| [`.trellis/spec/backend/engine-boundary.md`](../../spec/backend/engine-boundary.md) | Added **Collaboration Local MVP Boundary** (7 mandatory code-spec sections): method signatures, migration 17, required `expectedRevision`, Immediate transactional op-log, `lock.heartbeat` contract, error matrix, tests, wrong/correct |

No guide-only changes. Backend `index.md` already points at `engine-boundary.md`; no index update required.

## Suggested commit

**Subject:**

```text
feat(collab): local MVP membership, locks, presence, assignments, op-log
```

**Body:**

```text
Add self-hosted collaboration foundation on Engine/SQLite without breaking
offline single-user mode.

- Migration 17: members, segment locks, presence, assignments, append-only op-log
- Protocol collab.* methods and collab.local.v1 capability; contracts synced
- Typed segment-lock conflict (holderActorId); wall-clock lock/presence TTL
- assignment.complete requires expectedRevision (u64); missing/stale safe
- Durable mutations commit entity + sequence + op in one Immediate transaction
- lock.heartbeat records lock.heartbeat op with expiry/revision
- Storage collab tests + focused TRANSLUNAR_SMOKE_SCOPE=collab smoke

Spec: document Collaboration Local MVP Boundary in engine-boundary.md
(required revision, transactional op-log, lock.heartbeat).

Task: .trellis/tasks/07-19-collaboration-server
```

## Residual risks

1. **V4 smoke thinness (accepted nit):** focused collab smoke covers stale
   assignment revision and immediate presence visibility, but does **not**
   permanently embed (a) missing `expectedRevision` rejection or (b) real
   wall-clock TTL sleep. Product behavior is proven by
   `review/verify-1.md` + `review/_probe-ttl-revision.mjs`. Future hardening:
   selectively fold those assertions into `TRANSLUNAR_SMOKE_SCOPE=collab`
   without expanding to full workspace/Desktop E2E.
2. **Scope limits (by design):** no multi-node CRDT/sync consumer, no enterprise
   RBAC/audit, no WebSocket fanout UI, no assignment cancel path, no multi-
   connection stress. Op-log is foundation only.
3. **Presence has no op-log:** intentional for ephemeral heartbeats; sync
   consumers must not expect presence ops.
4. **RBAC enforcement is minimal:** roles are stored/listed; deep
   authorization of every write path beyond advisory locks is out of this MVP.

## Closeout notes

- Do **not** archive this task here (Orchestrator / finish-work policy).
- Do **not** git commit/merge from closeout (Orchestrator owns git).
- Working tree includes product + task review artifacts on branch
  `task/07-19-collaboration-server` (uncommitted at closeout time).
- Probe script under `review/` is verification evidence, not a product path.

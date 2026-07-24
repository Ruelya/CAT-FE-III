# Lightweight collaboration server

## Goal

Add a self-hosted team foundation that keeps single-user offline mode intact
while enabling shared project membership, segment locks, presence heartbeats,
simple roles, assignments, and an append-only operation log for later sync.

## Confirmed baseline

- Single-user Engine + SQLite is complete and offline-first.
- Discussions/comments already exist locally.
- Local API/CLI transports call EngineService directly.
- No multi-user membership, locks, presence, or op-log sync tables exist yet.

## Scope (MVP)

### R1. Workspace membership and roles (I-06)

- Projects may have members with roles: `owner` | `member`.
- Owner can add/remove members; members can read/write assigned work.
- Offline single-user projects remain valid with an implicit local owner.

### R2. Segment locks (I-05)

- Acquire/release/heartbeat segment locks with actor identity and expiry.
- Conflicting acquire returns a typed conflict including current holder.
- Locks are advisory Engine-enforced gates for collaborative writes.

### R3. Presence (I-05)

- Actors heartbeat into project presence with optional active document/segment.
- Stale presence expires after a TTL and is omitted from listings.

### R4. Assignments (I-08)

- Assign a document or ordinal range to a member with optional due timestamp.
- List assignments by project; complete/cancel with revision checks.

### R5. Operation log foundation (I-05 sync prep)

- Append immutable op-log entries for membership/lock/assignment mutations.
- List op-log pages by project for future replica sync consumers.

### R6. Protocol

- Additive `collab.*` methods and `collab.local.v1` capability.
- No requirement to break offline desktop workflows.

## Out of scope

- Full multi-node CRDT, enterprise RBAC/audit, customer portals.
- Production WebSocket fanout UI, mobile clients, billing.
- Automatic asset replica pull/push across machines (op-log is the foundation).

## Acceptance criteria

- [ ] AC-01: Add member + list members persists across Engine restart.
- [ ] AC-02: Lock acquire by A blocks B until release/expiry; conflict is typed.
- [ ] AC-03: Presence heartbeat appears in project presence list and expires.
- [ ] AC-04: Assignment create/list/complete works with revision safety.
- [ ] AC-05: Mutations append op-log entries readable via `collab.opLog.list`.
- [ ] AC-06: Focused smoke `collab` and package gates for owned surface pass.

## Constraints

- Offline local-first mode remains complete without starting a collab server.
- Preserve unrelated dirty paths.

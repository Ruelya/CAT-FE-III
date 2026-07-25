# Design: Collaboration MVP

## Storage migration 17

- `collab_members(project_id, actor_id, role, ...)`
- `collab_segment_locks(segment_id unique, project_id, actor_id, expires_at_ms, revision, ...)`
- `collab_presence(project_id, actor_id PK, document_id?, segment_id?, expires_at_ms, ...)`
- `collab_assignments(...)`
- `collab_op_log(id, project_id, sequence, kind, payload_json, actor_id, created_at_ms)`

## Engine methods

- `collab.member.list|add|remove`
- `collab.lock.acquire|release|heartbeat|list`
- `collab.presence.heartbeat|list`
- `collab.assignment.list|create|complete`
- `collab.opLog.list`

Locks/presence use wall-clock expiry; list endpoints purge expired rows lazily.

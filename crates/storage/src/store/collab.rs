use rusqlite::{Connection, OptionalExtension, TransactionBehavior, params};
use serde_json::{Value, json};
use uuid::Uuid;

use super::{Store, now_ms, require_nonempty, to_i64, to_u32};
use crate::{Result, StorageError};

const DEFAULT_LOCK_TTL_MS: i64 = 60_000;
const DEFAULT_PRESENCE_TTL_MS: i64 = 30_000;
const MAX_PAGE: u32 = 200;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CollabRole {
    Owner,
    Member,
}

impl CollabRole {
    #[allow(dead_code)]
    fn as_str(self) -> &'static str {
        match self {
            Self::Owner => "owner",
            Self::Member => "member",
        }
    }

    fn parse(value: &str) -> Result<Self> {
        match value {
            "owner" => Ok(Self::Owner),
            "member" => Ok(Self::Member),
            other => Err(StorageError::InvalidData(format!("unknown role {other}"))),
        }
    }
}

#[derive(Debug, Clone)]
pub struct CollabMemberRecord {
    pub project_id: String,
    pub actor_id: String,
    pub role: CollabRole,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}

#[derive(Debug, Clone)]
pub struct CollabLockRecord {
    pub segment_id: String,
    pub project_id: String,
    pub document_id: String,
    pub actor_id: String,
    pub expires_at_ms: i64,
    pub revision: u64,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}

#[derive(Debug, Clone)]
pub struct CollabPresenceRecord {
    pub project_id: String,
    pub actor_id: String,
    pub document_id: Option<String>,
    pub segment_id: Option<String>,
    pub expires_at_ms: i64,
    pub updated_at_ms: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AssignmentStatus {
    Open,
    Completed,
    Canceled,
}

impl AssignmentStatus {
    #[allow(dead_code)]
    fn as_str(self) -> &'static str {
        match self {
            Self::Open => "open",
            Self::Completed => "completed",
            Self::Canceled => "canceled",
        }
    }

    fn parse(value: &str) -> Result<Self> {
        match value {
            "open" => Ok(Self::Open),
            "completed" => Ok(Self::Completed),
            "canceled" => Ok(Self::Canceled),
            other => Err(StorageError::InvalidData(format!(
                "unknown assignment status {other}"
            ))),
        }
    }
}

#[derive(Debug, Clone)]
pub struct CollabAssignmentRecord {
    pub id: String,
    pub project_id: String,
    pub document_id: String,
    pub assignee_actor_id: String,
    pub ordinal_start: u32,
    pub ordinal_end: u32,
    pub due_at_ms: Option<i64>,
    pub status: AssignmentStatus,
    pub revision: u64,
    pub created_by: String,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}

#[derive(Debug, Clone)]
pub struct CollabOpLogRecord {
    pub id: String,
    pub project_id: String,
    pub sequence: u64,
    pub kind: String,
    pub payload: Value,
    pub actor_id: String,
    pub created_at_ms: i64,
}

impl Store {
    pub fn list_collab_members(&self, project_id: &str) -> Result<Vec<CollabMemberRecord>> {
        require_nonempty(project_id, "project id")?;
        let mut statement = self.connection.prepare(
            "SELECT project_id, actor_id, role, created_at_ms, updated_at_ms
             FROM collab_members WHERE project_id = ?1
             ORDER BY role DESC, actor_id",
        )?;
        let rows = statement.query_map([project_id], |row| {
            Ok(CollabMemberRecord {
                project_id: row.get(0)?,
                actor_id: row.get(1)?,
                role: CollabRole::parse(&row.get::<_, String>(2)?).map_err(|error| {
                    rusqlite::Error::FromSqlConversionFailure(
                        2,
                        rusqlite::types::Type::Text,
                        Box::new(error),
                    )
                })?,
                created_at_ms: row.get(3)?,
                updated_at_ms: row.get(4)?,
            })
        })?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(Into::into)
    }

    pub fn add_collab_member(
        &mut self,
        project_id: &str,
        actor_id: &str,
        role: CollabRole,
        acting_actor: &str,
    ) -> Result<CollabMemberRecord> {
        require_nonempty(project_id, "project id")?;
        require_nonempty(actor_id, "actor id")?;
        require_nonempty(acting_actor, "acting actor")?;
        let _ = self.get_project(project_id)?;
        let now = now_ms();
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        tx.execute(
            "INSERT INTO collab_members(project_id, actor_id, role, created_at_ms, updated_at_ms)
             VALUES (?1, ?2, ?3, ?4, ?4)
             ON CONFLICT(project_id, actor_id) DO UPDATE SET
                role = excluded.role,
                updated_at_ms = excluded.updated_at_ms",
            params![project_id, actor_id, role.as_str(), now],
        )?;
        append_collab_op(
            &tx,
            project_id,
            "member.upsert",
            json!({ "actorId": actor_id, "role": role.as_str() }),
            acting_actor,
        )?;
        let member = get_collab_member(&tx, project_id, actor_id)?;
        tx.commit()?;
        Ok(member)
    }

    pub fn remove_collab_member(
        &mut self,
        project_id: &str,
        actor_id: &str,
        acting_actor: &str,
    ) -> Result<()> {
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let deleted = tx.execute(
            "DELETE FROM collab_members WHERE project_id = ?1 AND actor_id = ?2",
            params![project_id, actor_id],
        )?;
        if deleted == 0 {
            return Err(StorageError::NotFound {
                entity: "collab_member",
                id: format!("{project_id}/{actor_id}"),
            });
        }
        append_collab_op(
            &tx,
            project_id,
            "member.remove",
            json!({ "actorId": actor_id }),
            acting_actor,
        )?;
        tx.commit()?;
        Ok(())
    }

    pub fn acquire_segment_lock(
        &mut self,
        project_id: &str,
        document_id: &str,
        segment_id: &str,
        actor_id: &str,
        ttl_ms: Option<i64>,
    ) -> Result<CollabLockRecord> {
        require_nonempty(segment_id, "segment id")?;
        require_nonempty(actor_id, "actor id")?;
        let now = now_ms();
        let ttl = ttl_ms.unwrap_or(DEFAULT_LOCK_TTL_MS).max(1_000);
        let expires = now + ttl;
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        purge_expired_locks(&tx, now)?;
        if let Some(existing) = get_segment_lock(&tx, segment_id)?
            && existing.actor_id != actor_id
            && existing.expires_at_ms > now
        {
            return Err(StorageError::LockHeld {
                segment_id: segment_id.to_string(),
                holder_actor_id: existing.actor_id.clone(),
                revision: existing.revision,
                expires_at_ms: existing.expires_at_ms,
            });
        }
        tx.execute(
            "INSERT INTO collab_segment_locks(
                segment_id, project_id, document_id, actor_id, expires_at_ms, revision,
                created_at_ms, updated_at_ms
             ) VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6, ?6)
             ON CONFLICT(segment_id) DO UPDATE SET
                actor_id = excluded.actor_id,
                expires_at_ms = excluded.expires_at_ms,
                revision = collab_segment_locks.revision + 1,
                updated_at_ms = excluded.updated_at_ms",
            params![segment_id, project_id, document_id, actor_id, expires, now],
        )?;
        append_collab_op(
            &tx,
            project_id,
            "lock.acquire",
            json!({ "segmentId": segment_id, "actorId": actor_id, "expiresAtMs": expires }),
            actor_id,
        )?;
        let lock = get_segment_lock(&tx, segment_id)?.ok_or_else(|| StorageError::NotFound {
            entity: "segment_lock",
            id: segment_id.to_string(),
        })?;
        tx.commit()?;
        Ok(lock)
    }

    pub fn release_segment_lock(&mut self, segment_id: &str, actor_id: &str) -> Result<()> {
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let current = get_segment_lock(&tx, segment_id)?.ok_or_else(|| StorageError::NotFound {
            entity: "segment_lock",
            id: segment_id.to_string(),
        })?;
        if current.actor_id != actor_id {
            return Err(StorageError::EntityConflict {
                entity: "segment_lock",
                id: segment_id.to_string(),
                expected_revision: current.revision,
                actual_revision: current.revision,
            });
        }
        tx.execute(
            "DELETE FROM collab_segment_locks WHERE segment_id = ?1",
            [segment_id],
        )?;
        append_collab_op(
            &tx,
            &current.project_id,
            "lock.release",
            json!({ "segmentId": segment_id, "actorId": actor_id }),
            actor_id,
        )?;
        tx.commit()?;
        Ok(())
    }

    pub fn heartbeat_segment_lock(
        &mut self,
        segment_id: &str,
        actor_id: &str,
        ttl_ms: Option<i64>,
    ) -> Result<CollabLockRecord> {
        let now = now_ms();
        let ttl = ttl_ms.unwrap_or(DEFAULT_LOCK_TTL_MS).max(1_000);
        let expires = now + ttl;
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let current = get_segment_lock(&tx, segment_id)?.ok_or_else(|| StorageError::NotFound {
            entity: "segment_lock",
            id: segment_id.to_string(),
        })?;
        if current.actor_id != actor_id {
            return Err(StorageError::EntityConflict {
                entity: "segment_lock",
                id: segment_id.to_string(),
                expected_revision: current.revision,
                actual_revision: current.revision,
            });
        }
        tx.execute(
            "UPDATE collab_segment_locks
             SET expires_at_ms = ?2, revision = revision + 1, updated_at_ms = ?3
             WHERE segment_id = ?1",
            params![segment_id, expires, now],
        )?;
        let lock = get_segment_lock(&tx, segment_id)?.ok_or_else(|| StorageError::NotFound {
            entity: "segment_lock",
            id: segment_id.to_string(),
        })?;
        append_collab_op(
            &tx,
            &lock.project_id,
            "lock.heartbeat",
            json!({
                "segmentId": segment_id,
                "actorId": actor_id,
                "expiresAtMs": lock.expires_at_ms,
                "revision": lock.revision,
            }),
            actor_id,
        )?;
        tx.commit()?;
        Ok(lock)
    }

    pub fn list_segment_locks(&self, project_id: &str) -> Result<Vec<CollabLockRecord>> {
        let now = now_ms();
        let mut statement = self.connection.prepare(
            "SELECT segment_id, project_id, document_id, actor_id, expires_at_ms, revision,
                    created_at_ms, updated_at_ms
             FROM collab_segment_locks
             WHERE project_id = ?1 AND expires_at_ms > ?2
             ORDER BY segment_id",
        )?;
        let rows = statement.query_map(params![project_id, now], map_lock_row)?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(Into::into)
    }

    pub fn presence_heartbeat(
        &mut self,
        project_id: &str,
        actor_id: &str,
        document_id: Option<String>,
        segment_id: Option<String>,
        ttl_ms: Option<i64>,
    ) -> Result<CollabPresenceRecord> {
        require_nonempty(project_id, "project id")?;
        require_nonempty(actor_id, "actor id")?;
        let now = now_ms();
        let ttl = ttl_ms.unwrap_or(DEFAULT_PRESENCE_TTL_MS).max(1_000);
        let expires = now + ttl;
        self.connection.execute(
            "INSERT INTO collab_presence(
                project_id, actor_id, document_id, segment_id, expires_at_ms, updated_at_ms
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(project_id, actor_id) DO UPDATE SET
                document_id = excluded.document_id,
                segment_id = excluded.segment_id,
                expires_at_ms = excluded.expires_at_ms,
                updated_at_ms = excluded.updated_at_ms",
            params![project_id, actor_id, document_id, segment_id, expires, now],
        )?;
        Ok(CollabPresenceRecord {
            project_id: project_id.to_string(),
            actor_id: actor_id.to_string(),
            document_id,
            segment_id,
            expires_at_ms: expires,
            updated_at_ms: now,
        })
    }

    pub fn list_presence(&self, project_id: &str) -> Result<Vec<CollabPresenceRecord>> {
        let now = now_ms();
        let mut statement = self.connection.prepare(
            "SELECT project_id, actor_id, document_id, segment_id, expires_at_ms, updated_at_ms
             FROM collab_presence
             WHERE project_id = ?1 AND expires_at_ms > ?2
             ORDER BY actor_id",
        )?;
        let rows = statement.query_map(params![project_id, now], |row| {
            Ok(CollabPresenceRecord {
                project_id: row.get(0)?,
                actor_id: row.get(1)?,
                document_id: row.get(2)?,
                segment_id: row.get(3)?,
                expires_at_ms: row.get(4)?,
                updated_at_ms: row.get(5)?,
            })
        })?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(Into::into)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn create_assignment(
        &mut self,
        project_id: &str,
        document_id: &str,
        assignee_actor_id: &str,
        ordinal_start: u32,
        ordinal_end: u32,
        due_at_ms: Option<i64>,
        created_by: &str,
    ) -> Result<CollabAssignmentRecord> {
        if ordinal_end < ordinal_start {
            return Err(StorageError::InvalidData(
                "ordinalEnd must be >= ordinalStart".into(),
            ));
        }
        let id = Uuid::now_v7().to_string();
        let now = now_ms();
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        tx.execute(
            "INSERT INTO collab_assignments(
                id, project_id, document_id, assignee_actor_id, ordinal_start, ordinal_end,
                due_at_ms, status, revision, created_by, created_at_ms, updated_at_ms
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'open', 0, ?8, ?9, ?9)",
            params![
                id,
                project_id,
                document_id,
                assignee_actor_id,
                ordinal_start as i64,
                ordinal_end as i64,
                due_at_ms,
                created_by,
                now
            ],
        )?;
        append_collab_op(
            &tx,
            project_id,
            "assignment.create",
            json!({ "id": id, "assigneeActorId": assignee_actor_id }),
            created_by,
        )?;
        let assignment = get_assignment(&tx, &id)?;
        tx.commit()?;
        Ok(assignment)
    }

    pub fn complete_assignment(
        &mut self,
        assignment_id: &str,
        expected_revision: u64,
        actor_id: &str,
    ) -> Result<CollabAssignmentRecord> {
        let now = now_ms();
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let current = get_assignment(&tx, assignment_id)?;
        if current.revision != expected_revision {
            return Err(StorageError::EntityConflict {
                entity: "assignment",
                id: assignment_id.to_string(),
                expected_revision,
                actual_revision: current.revision,
            });
        }
        tx.execute(
            "UPDATE collab_assignments
             SET status = 'completed', revision = revision + 1, updated_at_ms = ?2
             WHERE id = ?1",
            params![assignment_id, now],
        )?;
        append_collab_op(
            &tx,
            &current.project_id,
            "assignment.complete",
            json!({ "id": assignment_id }),
            actor_id,
        )?;
        let assignment = get_assignment(&tx, assignment_id)?;
        tx.commit()?;
        Ok(assignment)
    }

    pub fn list_assignments(&self, project_id: &str) -> Result<Vec<CollabAssignmentRecord>> {
        let mut statement = self.connection.prepare(
            "SELECT id, project_id, document_id, assignee_actor_id, ordinal_start, ordinal_end,
                    due_at_ms, status, revision, created_by, created_at_ms, updated_at_ms
             FROM collab_assignments
             WHERE project_id = ?1
             ORDER BY updated_at_ms DESC, id",
        )?;
        let rows = statement.query_map([project_id], map_assignment_row)?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(Into::into)
    }

    pub fn list_collab_ops(
        &self,
        project_id: &str,
        after_sequence: u64,
        limit: u32,
    ) -> Result<(Vec<CollabOpLogRecord>, u32)> {
        let limit = limit.clamp(1, MAX_PAGE);
        let total = self.connection.query_row(
            "SELECT COUNT(*) FROM collab_op_log WHERE project_id = ?1 AND sequence > ?2",
            params![project_id, to_i64(after_sequence)?],
            |row| row.get::<_, i64>(0),
        )?;
        let mut statement = self.connection.prepare(
            "SELECT id, project_id, sequence, kind, payload_json, actor_id, created_at_ms
             FROM collab_op_log
             WHERE project_id = ?1 AND sequence > ?2
             ORDER BY sequence ASC
             LIMIT ?3",
        )?;
        let rows = statement.query_map(
            params![
                project_id,
                to_i64(after_sequence)?,
                to_i64(u64::from(limit))?
            ],
            |row| {
                let payload: String = row.get(4)?;
                let payload: Value = serde_json::from_str(&payload).map_err(|error| {
                    rusqlite::Error::FromSqlConversionFailure(
                        4,
                        rusqlite::types::Type::Text,
                        Box::new(error),
                    )
                })?;
                Ok(CollabOpLogRecord {
                    id: row.get(0)?,
                    project_id: row.get(1)?,
                    sequence: row.get::<_, i64>(2)? as u64,
                    kind: row.get(3)?,
                    payload,
                    actor_id: row.get(5)?,
                    created_at_ms: row.get(6)?,
                })
            },
        )?;
        let items = rows.collect::<std::result::Result<Vec<_>, _>>()?;
        Ok((items, to_u32(total)?))
    }
}

fn get_collab_member(
    conn: &Connection,
    project_id: &str,
    actor_id: &str,
) -> Result<CollabMemberRecord> {
    conn.query_row(
        "SELECT project_id, actor_id, role, created_at_ms, updated_at_ms
         FROM collab_members WHERE project_id = ?1 AND actor_id = ?2",
        params![project_id, actor_id],
        |row| {
            Ok(CollabMemberRecord {
                project_id: row.get(0)?,
                actor_id: row.get(1)?,
                role: CollabRole::parse(&row.get::<_, String>(2)?).map_err(|error| {
                    rusqlite::Error::FromSqlConversionFailure(
                        2,
                        rusqlite::types::Type::Text,
                        Box::new(error),
                    )
                })?,
                created_at_ms: row.get(3)?,
                updated_at_ms: row.get(4)?,
            })
        },
    )
    .map_err(|error| match error {
        rusqlite::Error::QueryReturnedNoRows => StorageError::NotFound {
            entity: "collab_member",
            id: format!("{project_id}/{actor_id}"),
        },
        other => other.into(),
    })
}

fn get_segment_lock(conn: &Connection, segment_id: &str) -> Result<Option<CollabLockRecord>> {
    conn.query_row(
        "SELECT segment_id, project_id, document_id, actor_id, expires_at_ms, revision,
                created_at_ms, updated_at_ms
         FROM collab_segment_locks WHERE segment_id = ?1",
        [segment_id],
        map_lock_row,
    )
    .optional()
    .map_err(Into::into)
}

fn get_assignment(conn: &Connection, assignment_id: &str) -> Result<CollabAssignmentRecord> {
    conn.query_row(
        "SELECT id, project_id, document_id, assignee_actor_id, ordinal_start, ordinal_end,
                due_at_ms, status, revision, created_by, created_at_ms, updated_at_ms
         FROM collab_assignments WHERE id = ?1",
        [assignment_id],
        map_assignment_row,
    )
    .map_err(|error| match error {
        rusqlite::Error::QueryReturnedNoRows => StorageError::NotFound {
            entity: "assignment",
            id: assignment_id.to_string(),
        },
        other => other.into(),
    })
}

fn purge_expired_locks(conn: &Connection, now: i64) -> Result<()> {
    conn.execute(
        "DELETE FROM collab_segment_locks WHERE expires_at_ms <= ?1",
        [now],
    )?;
    Ok(())
}

fn append_collab_op(
    conn: &Connection,
    project_id: &str,
    kind: &str,
    payload: Value,
    actor_id: &str,
) -> Result<()> {
    let now = now_ms();
    let sequence = conn.query_row(
        "SELECT COALESCE(MAX(sequence), 0) + 1 FROM collab_op_log WHERE project_id = ?1",
        [project_id],
        |row| row.get::<_, i64>(0),
    )?;
    let id = Uuid::now_v7().to_string();
    conn.execute(
        "INSERT INTO collab_op_log(id, project_id, sequence, kind, payload_json, actor_id, created_at_ms)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            id,
            project_id,
            sequence,
            kind,
            serde_json::to_string(&payload)?,
            actor_id,
            now
        ],
    )?;
    Ok(())
}

fn map_lock_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<CollabLockRecord> {
    Ok(CollabLockRecord {
        segment_id: row.get(0)?,
        project_id: row.get(1)?,
        document_id: row.get(2)?,
        actor_id: row.get(3)?,
        expires_at_ms: row.get(4)?,
        revision: row.get::<_, i64>(5)? as u64,
        created_at_ms: row.get(6)?,
        updated_at_ms: row.get(7)?,
    })
}

fn map_assignment_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<CollabAssignmentRecord> {
    Ok(CollabAssignmentRecord {
        id: row.get(0)?,
        project_id: row.get(1)?,
        document_id: row.get(2)?,
        assignee_actor_id: row.get(3)?,
        ordinal_start: row.get::<_, i64>(4)? as u32,
        ordinal_end: row.get::<_, i64>(5)? as u32,
        due_at_ms: row.get(6)?,
        status: AssignmentStatus::parse(&row.get::<_, String>(7)?).map_err(|error| {
            rusqlite::Error::FromSqlConversionFailure(
                7,
                rusqlite::types::Type::Text,
                Box::new(error),
            )
        })?,
        revision: row.get::<_, i64>(8)? as u64,
        created_by: row.get(9)?,
        created_at_ms: row.get(10)?,
        updated_at_ms: row.get(11)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn open_store() -> (tempfile::TempDir, Store) {
        let temp = tempfile::tempdir().expect("collab temp directory");
        let store = Store::open(temp.path()).expect("open collab store");
        (temp, store)
    }

    #[test]
    fn members_locks_presence_assignments_and_ops_round_trip() {
        let (temp, mut store) = open_store();
        let project = store
            .create_project("Collab", "en-US", "zh-CN", "general")
            .expect("create project");

        let owner = store
            .add_collab_member(&project.id, "alice", CollabRole::Owner, "alice")
            .expect("add owner");
        assert_eq!(owner.role, CollabRole::Owner);
        store
            .add_collab_member(&project.id, "bob", CollabRole::Member, "alice")
            .expect("add member");
        assert_eq!(
            store
                .list_collab_members(&project.id)
                .expect("list members")
                .len(),
            2
        );

        let lock = store
            .acquire_segment_lock(&project.id, "doc-1", "seg-1", "alice", Some(60_000))
            .expect("acquire lock");
        assert_eq!(lock.actor_id, "alice");
        let conflict = store
            .acquire_segment_lock(&project.id, "doc-1", "seg-1", "bob", None)
            .expect_err("bob must conflict");
        match conflict {
            StorageError::LockHeld {
                segment_id,
                holder_actor_id,
                ..
            } => {
                assert_eq!(segment_id, "seg-1");
                assert_eq!(holder_actor_id, "alice");
            }
            other => panic!("expected LockHeld, got {other:?}"),
        }

        let presence = store
            .presence_heartbeat(
                &project.id,
                "alice",
                Some("doc-1".into()),
                Some("seg-1".into()),
                Some(30_000),
            )
            .expect("presence");
        assert_eq!(presence.actor_id, "alice");
        assert!(
            store
                .list_presence(&project.id)
                .expect("list presence")
                .iter()
                .any(|item| item.actor_id == "alice")
        );

        let assignment = store
            .create_assignment(&project.id, "doc-1", "bob", 0, 2, None, "alice")
            .expect("create assignment");
        let completed = store
            .complete_assignment(&assignment.id, assignment.revision, "bob")
            .expect("complete assignment");
        assert_eq!(completed.status, AssignmentStatus::Completed);
        assert_eq!(completed.revision, assignment.revision + 1);
        let (ops_before_stale, _) = store
            .list_collab_ops(&project.id, 0, 50)
            .expect("ops before stale");
        let stale = store
            .complete_assignment(&assignment.id, assignment.revision, "bob")
            .expect_err("stale complete must conflict");
        assert!(matches!(stale, StorageError::EntityConflict { .. }));
        let still_completed = store
            .list_assignments(&project.id)
            .expect("list assignments")
            .into_iter()
            .find(|item| item.id == assignment.id)
            .expect("assignment still exists");
        assert_eq!(still_completed.status, AssignmentStatus::Completed);
        assert_eq!(still_completed.revision, completed.revision);
        let (ops_after_stale, _) = store
            .list_collab_ops(&project.id, 0, 50)
            .expect("ops after stale");
        assert_eq!(
            ops_after_stale.len(),
            ops_before_stale.len(),
            "stale complete must not append op-log"
        );

        store
            .heartbeat_segment_lock("seg-1", "alice", Some(60_000))
            .expect("heartbeat lock");
        store
            .release_segment_lock("seg-1", "alice")
            .expect("release lock");
        let (ops, total) = store.list_collab_ops(&project.id, 0, 50).expect("list ops");
        assert!(total >= 5);
        assert!(ops.iter().any(|op| op.kind == "member.upsert"));
        assert!(ops.iter().any(|op| op.kind == "lock.acquire"));
        assert!(ops.iter().any(|op| op.kind == "lock.heartbeat"));
        assert!(ops.iter().any(|op| op.kind == "assignment.create"));
        assert!(ops.iter().any(|op| op.kind == "assignment.complete"));
        assert!(ops.iter().any(|op| op.kind == "lock.release"));
        for (index, op) in ops.iter().enumerate() {
            assert_eq!(op.sequence, (index as u64) + 1);
        }

        drop(store);
        let reopened = Store::open(temp.path()).expect("reopen store");
        let members = reopened
            .list_collab_members(&project.id)
            .expect("members after restart");
        assert_eq!(members.len(), 2);
        assert!(members.iter().any(|m| m.actor_id == "alice"));
        assert!(members.iter().any(|m| m.actor_id == "bob"));
        let (ops_after, _) = reopened
            .list_collab_ops(&project.id, 0, 50)
            .expect("ops after restart");
        assert_eq!(ops_after.len(), ops.len());
    }

    #[test]
    fn collab_mutation_rolls_back_when_op_log_insert_fails() {
        let (_temp, mut store) = open_store();
        let project = store
            .create_project("Atomic", "en-US", "zh-CN", "general")
            .expect("create project");
        store
            .connection
            .execute_batch(
                "CREATE TEMP TRIGGER fail_collab_op_insert
                 BEFORE INSERT ON collab_op_log
                 BEGIN SELECT RAISE(ABORT, 'injected collab op failure'); END;",
            )
            .expect("install op-log failure trigger");

        let add_err = store
            .add_collab_member(&project.id, "alice", CollabRole::Owner, "alice")
            .expect_err("member upsert must roll back with op failure");
        assert!(matches!(add_err, StorageError::Database(_)));
        assert!(
            store
                .list_collab_members(&project.id)
                .expect("list members")
                .is_empty(),
            "failed member mutation must leave no entity row"
        );

        let lock_err = store
            .acquire_segment_lock(&project.id, "doc-1", "seg-1", "alice", None)
            .expect_err("lock acquire must roll back with op failure");
        assert!(matches!(lock_err, StorageError::Database(_)));
        assert!(
            store
                .list_segment_locks(&project.id)
                .expect("list locks")
                .is_empty(),
            "failed lock mutation must leave no lock row"
        );

        let assign_err = store
            .create_assignment(&project.id, "doc-1", "bob", 0, 1, None, "alice")
            .expect_err("assignment create must roll back with op failure");
        assert!(matches!(assign_err, StorageError::Database(_)));
        assert!(
            store
                .list_assignments(&project.id)
                .expect("list assignments")
                .is_empty(),
            "failed assignment mutation must leave no assignment row"
        );

        let (ops, total) = store
            .list_collab_ops(&project.id, 0, 50)
            .expect("list ops after failures");
        assert_eq!(total, 0);
        assert!(ops.is_empty(), "failed mutations must leave no orphan ops");

        store
            .connection
            .execute_batch("DROP TRIGGER fail_collab_op_insert")
            .expect("remove op-log failure trigger");

        store
            .add_collab_member(&project.id, "alice", CollabRole::Owner, "alice")
            .expect("member upsert after trigger removal");
        let (ops_ok, total_ok) = store
            .list_collab_ops(&project.id, 0, 50)
            .expect("list ops after success");
        assert_eq!(total_ok, 1);
        assert_eq!(ops_ok.len(), 1);
        assert_eq!(ops_ok[0].sequence, 1);
        assert_eq!(ops_ok[0].kind, "member.upsert");
    }

    #[test]
    fn expired_locks_and_presence_are_omitted() {
        let (_temp, mut store) = open_store();
        let project = store
            .create_project("Expiry", "en-US", "zh-CN", "general")
            .expect("create project");
        store
            .acquire_segment_lock(&project.id, "doc-1", "seg-exp", "alice", Some(1_000))
            .expect("short lock");
        // Force expiry by rewriting expires_at_ms into the past.
        store
            .connection
            .execute(
                "UPDATE collab_segment_locks SET expires_at_ms = 1 WHERE segment_id = ?1",
                ["seg-exp"],
            )
            .expect("force lock expiry");
        store
            .presence_heartbeat(&project.id, "alice", None, None, Some(1_000))
            .expect("presence");
        store
            .connection
            .execute(
                "UPDATE collab_presence SET expires_at_ms = 1 WHERE project_id = ?1",
                [&project.id],
            )
            .expect("force presence expiry");

        assert!(
            store
                .list_segment_locks(&project.id)
                .expect("list locks")
                .is_empty()
        );
        assert!(
            store
                .list_presence(&project.id)
                .expect("list presence")
                .is_empty()
        );
        // Acquire should succeed after purge of expired holder.
        let lock = store
            .acquire_segment_lock(&project.id, "doc-1", "seg-exp", "bob", None)
            .expect("bob acquires expired lock");
        assert_eq!(lock.actor_id, "bob");
    }
}

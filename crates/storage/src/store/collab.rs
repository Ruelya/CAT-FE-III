use rusqlite::{OptionalExtension, params};
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
        self.connection.execute(
            "INSERT INTO collab_members(project_id, actor_id, role, created_at_ms, updated_at_ms)
             VALUES (?1, ?2, ?3, ?4, ?4)
             ON CONFLICT(project_id, actor_id) DO UPDATE SET
                role = excluded.role,
                updated_at_ms = excluded.updated_at_ms",
            params![project_id, actor_id, role.as_str(), now],
        )?;
        self.append_collab_op(
            project_id,
            "member.upsert",
            json!({ "actorId": actor_id, "role": role.as_str() }),
            acting_actor,
        )?;
        self.list_collab_members(project_id)?
            .into_iter()
            .find(|item| item.actor_id == actor_id)
            .ok_or_else(|| StorageError::NotFound {
                entity: "collab_member",
                id: format!("{project_id}/{actor_id}"),
            })
    }

    pub fn remove_collab_member(
        &mut self,
        project_id: &str,
        actor_id: &str,
        acting_actor: &str,
    ) -> Result<()> {
        let deleted = self.connection.execute(
            "DELETE FROM collab_members WHERE project_id = ?1 AND actor_id = ?2",
            params![project_id, actor_id],
        )?;
        if deleted == 0 {
            return Err(StorageError::NotFound {
                entity: "collab_member",
                id: format!("{project_id}/{actor_id}"),
            });
        }
        self.append_collab_op(
            project_id,
            "member.remove",
            json!({ "actorId": actor_id }),
            acting_actor,
        )?;
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
        self.purge_expired_locks(now)?;
        if let Some(existing) = self.get_segment_lock(segment_id)?
            && existing.actor_id != actor_id
            && existing.expires_at_ms > now
        {
            return Err(StorageError::EntityConflict {
                entity: "segment_lock",
                id: segment_id.to_string(),
                expected_revision: existing.revision,
                actual_revision: existing.revision,
            });
        }
        let ttl = ttl_ms.unwrap_or(DEFAULT_LOCK_TTL_MS).max(1_000);
        let expires = now + ttl;
        self.connection.execute(
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
        self.append_collab_op(
            project_id,
            "lock.acquire",
            json!({ "segmentId": segment_id, "actorId": actor_id, "expiresAtMs": expires }),
            actor_id,
        )?;
        self.get_segment_lock(segment_id)?
            .ok_or_else(|| StorageError::NotFound {
                entity: "segment_lock",
                id: segment_id.to_string(),
            })
    }

    pub fn release_segment_lock(&mut self, segment_id: &str, actor_id: &str) -> Result<()> {
        let current = self
            .get_segment_lock(segment_id)?
            .ok_or_else(|| StorageError::NotFound {
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
        self.connection.execute(
            "DELETE FROM collab_segment_locks WHERE segment_id = ?1",
            [segment_id],
        )?;
        self.append_collab_op(
            &current.project_id,
            "lock.release",
            json!({ "segmentId": segment_id, "actorId": actor_id }),
            actor_id,
        )?;
        Ok(())
    }

    pub fn heartbeat_segment_lock(
        &mut self,
        segment_id: &str,
        actor_id: &str,
        ttl_ms: Option<i64>,
    ) -> Result<CollabLockRecord> {
        let current = self
            .get_segment_lock(segment_id)?
            .ok_or_else(|| StorageError::NotFound {
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
        let now = now_ms();
        let ttl = ttl_ms.unwrap_or(DEFAULT_LOCK_TTL_MS).max(1_000);
        let expires = now + ttl;
        self.connection.execute(
            "UPDATE collab_segment_locks
             SET expires_at_ms = ?2, revision = revision + 1, updated_at_ms = ?3
             WHERE segment_id = ?1",
            params![segment_id, expires, now],
        )?;
        self.get_segment_lock(segment_id)?
            .ok_or_else(|| StorageError::NotFound {
                entity: "segment_lock",
                id: segment_id.to_string(),
            })
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
        self.connection.execute(
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
        self.append_collab_op(
            project_id,
            "assignment.create",
            json!({ "id": id, "assigneeActorId": assignee_actor_id }),
            created_by,
        )?;
        self.get_assignment(&id)
    }

    pub fn complete_assignment(
        &mut self,
        assignment_id: &str,
        expected_revision: Option<u64>,
        actor_id: &str,
    ) -> Result<CollabAssignmentRecord> {
        let current = self.get_assignment(assignment_id)?;
        if let Some(expected) = expected_revision
            && current.revision != expected
        {
            return Err(StorageError::EntityConflict {
                entity: "assignment",
                id: assignment_id.to_string(),
                expected_revision: expected,
                actual_revision: current.revision,
            });
        }
        let now = now_ms();
        self.connection.execute(
            "UPDATE collab_assignments
             SET status = 'completed', revision = revision + 1, updated_at_ms = ?2
             WHERE id = ?1",
            params![assignment_id, now],
        )?;
        self.append_collab_op(
            &current.project_id,
            "assignment.complete",
            json!({ "id": assignment_id }),
            actor_id,
        )?;
        self.get_assignment(assignment_id)
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

    fn get_segment_lock(&self, segment_id: &str) -> Result<Option<CollabLockRecord>> {
        self.connection
            .query_row(
                "SELECT segment_id, project_id, document_id, actor_id, expires_at_ms, revision,
                        created_at_ms, updated_at_ms
                 FROM collab_segment_locks WHERE segment_id = ?1",
                [segment_id],
                map_lock_row,
            )
            .optional()
            .map_err(Into::into)
    }

    fn get_assignment(&self, assignment_id: &str) -> Result<CollabAssignmentRecord> {
        self.connection
            .query_row(
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

    fn purge_expired_locks(&self, now: i64) -> Result<()> {
        self.connection.execute(
            "DELETE FROM collab_segment_locks WHERE expires_at_ms <= ?1",
            [now],
        )?;
        Ok(())
    }

    fn append_collab_op(
        &self,
        project_id: &str,
        kind: &str,
        payload: Value,
        actor_id: &str,
    ) -> Result<()> {
        let now = now_ms();
        let sequence = self.connection.query_row(
            "SELECT COALESCE(MAX(sequence), 0) + 1 FROM collab_op_log WHERE project_id = ?1",
            [project_id],
            |row| row.get::<_, i64>(0),
        )?;
        let id = Uuid::now_v7().to_string();
        self.connection.execute(
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

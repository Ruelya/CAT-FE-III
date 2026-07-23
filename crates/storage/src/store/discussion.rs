use std::collections::BTreeSet;

use rusqlite::{Connection, OptionalExtension, Row, TransactionBehavior, params};
use serde::{Deserialize, Serialize};
use serde_json::json;

use super::{
    Store, append_operation, ensure_entity_revision, find_document, find_project, find_segment,
    next_revision, not_found, now_ms, read_u32, read_u64, require_nonempty, to_i64, to_u32,
};
use crate::{Result, StorageError};

const MAX_ACTOR_BYTES: usize = 128;
const MAX_REASON_BYTES: usize = 512;
const MAX_TITLE_BYTES: usize = 256;
const MAX_MESSAGE_BYTES: usize = 16 * 1024;
const MAX_MENTION_CHARS: usize = 64;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DiscussionScope {
    Project,
    Document,
    Segment,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DiscussionStatus {
    Open,
    Resolved,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscussionThreadRecord {
    pub id: String,
    pub project_id: String,
    pub scope: DiscussionScope,
    pub document_id: Option<String>,
    pub segment_id: Option<String>,
    pub title: String,
    pub status: DiscussionStatus,
    pub revision: u64,
    pub message_count: u32,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
    pub resolved_at_ms: Option<i64>,
    pub resolved_by: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscussionMessageRecord {
    pub id: String,
    pub thread_id: String,
    pub ordinal: u32,
    pub actor: String,
    pub body: String,
    pub mentions: Vec<String>,
    pub revision: u64,
    pub thread_revision: u64,
    pub deleted: bool,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}

#[derive(Debug, Clone)]
pub struct DiscussionThreadFilter {
    pub project_id: String,
    pub scope: Option<DiscussionScope>,
    pub document_id: Option<String>,
    pub segment_id: Option<String>,
    pub include_resolved: bool,
    pub offset: u32,
    pub limit: u32,
}

#[derive(Debug, Clone)]
pub struct NewDiscussionThread {
    pub project_id: String,
    pub scope: DiscussionScope,
    pub document_id: Option<String>,
    pub segment_id: Option<String>,
    pub title: String,
    pub body: String,
    pub actor: String,
    pub reason: String,
    pub expected_project_revision: u64,
}

#[derive(Debug, Clone)]
pub struct NewDiscussionMessage {
    pub thread_id: String,
    pub body: String,
    pub actor: String,
    pub reason: String,
    pub expected_thread_revision: u64,
}

impl Store {
    pub fn list_discussion_threads(
        &self,
        filter: &DiscussionThreadFilter,
    ) -> Result<(Vec<DiscussionThreadRecord>, u32)> {
        find_project(&self.connection, &filter.project_id)?;
        validate_scope_filter(&self.connection, filter)?;
        let scope = filter.scope.map(discussion_scope_text);
        let total = self.connection.query_row(
            "SELECT COUNT(*)
             FROM discussion_threads
             WHERE project_id = ?1
               AND (?2 IS NULL OR scope = ?2)
               AND (?3 IS NULL OR document_id = ?3)
               AND (?4 IS NULL OR segment_id = ?4)
               AND (?5 = 1 OR status = 'open')",
            params![
                filter.project_id,
                scope,
                filter.document_id,
                filter.segment_id,
                filter.include_resolved,
            ],
            |row| row.get::<_, i64>(0),
        )?;
        let mut statement = self.connection.prepare(
            "SELECT t.id, t.project_id, t.scope, t.document_id, t.segment_id,
                    t.title, t.status, t.revision,
                    (SELECT COUNT(*) FROM discussion_messages m
                     WHERE m.thread_id = t.id AND m.deleted = 0),
                    t.created_at_ms, t.updated_at_ms, t.resolved_at_ms, t.resolved_by
             FROM discussion_threads t
             WHERE t.project_id = ?1
               AND (?2 IS NULL OR t.scope = ?2)
               AND (?3 IS NULL OR t.document_id = ?3)
               AND (?4 IS NULL OR t.segment_id = ?4)
               AND (?5 = 1 OR t.status = 'open')
             ORDER BY t.updated_at_ms DESC, t.id
             LIMIT ?6 OFFSET ?7",
        )?;
        let items = statement
            .query_map(
                params![
                    filter.project_id,
                    scope,
                    filter.document_id,
                    filter.segment_id,
                    filter.include_resolved,
                    i64::from(filter.limit),
                    i64::from(filter.offset),
                ],
                row_to_discussion_thread,
            )?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok((items, to_u32(total)?))
    }

    pub fn create_discussion_thread(
        &mut self,
        input: NewDiscussionThread,
    ) -> Result<DiscussionThreadRecord> {
        validate_actor_reason(&input.actor, &input.reason)?;
        validate_bounded_nonempty("discussion message", &input.body, MAX_MESSAGE_BYTES)?;
        if input.title.len() > MAX_TITLE_BYTES {
            return Err(StorageError::InvalidState(format!(
                "discussion title must be at most {MAX_TITLE_BYTES} bytes"
            )));
        }
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let project = find_project(&transaction, &input.project_id)?;
        ensure_entity_revision(
            "project",
            &input.project_id,
            project.revision,
            input.expected_project_revision,
        )?;
        validate_discussion_scope(
            &transaction,
            &input.project_id,
            input.scope,
            input.document_id.as_deref(),
            input.segment_id.as_deref(),
        )?;
        let now = now_ms();
        let thread_id = translunar_domain::new_id();
        let message_id = translunar_domain::new_id();
        let title = normalized_title(&input.title, &input.body);
        transaction.execute(
            "INSERT INTO discussion_threads (
                id, project_id, scope, document_id, segment_id, title, status,
                revision, created_at_ms, updated_at_ms, resolved_at_ms, resolved_by
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'open', 0, ?7, ?7, NULL, NULL)",
            params![
                thread_id,
                input.project_id,
                discussion_scope_text(input.scope),
                input.document_id,
                input.segment_id,
                title,
                now,
            ],
        )?;
        let mentions = extract_mentions(&input.body);
        transaction.execute(
            "INSERT INTO discussion_messages (
                id, thread_id, ordinal, actor, body, mentions_json, revision,
                deleted, created_at_ms, updated_at_ms
             ) VALUES (?1, ?2, 0, ?3, ?4, ?5, 0, 0, ?6, ?6)",
            params![
                message_id,
                thread_id,
                input.actor,
                input.body.trim(),
                serde_json::to_string(&mentions)?,
                now,
            ],
        )?;
        let created = find_discussion_thread(&transaction, &thread_id)?;
        append_operation(
            &transaction,
            &input.project_id,
            "discussion_thread",
            &thread_id,
            "discussion.thread.create",
            None,
            Some(created.revision),
            &input.actor,
            None,
            None,
            Some(json!({
                "reason": input.reason.trim(),
                "thread": created,
                "messageId": message_id,
            })),
        )?;
        transaction.commit()?;
        Ok(created)
    }

    pub fn resolve_discussion_thread(
        &mut self,
        thread_id: &str,
        resolved: bool,
        expected_revision: u64,
        actor: &str,
        reason: &str,
    ) -> Result<DiscussionThreadRecord> {
        validate_actor_reason(actor, reason)?;
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let current = find_discussion_thread(&transaction, thread_id)?;
        ensure_entity_revision(
            "discussion_thread",
            thread_id,
            current.revision,
            expected_revision,
        )?;
        let target_status = if resolved {
            DiscussionStatus::Resolved
        } else {
            DiscussionStatus::Open
        };
        if current.status == target_status {
            transaction.commit()?;
            return Ok(current);
        }
        let revision = next_revision(current.revision)?;
        let now = now_ms();
        let changed = transaction.execute(
            "UPDATE discussion_threads
             SET status = ?1, revision = ?2, updated_at_ms = ?3,
                 resolved_at_ms = ?4, resolved_by = ?5
             WHERE id = ?6 AND revision = ?7",
            params![
                discussion_status_text(target_status),
                to_i64(revision)?,
                now,
                resolved.then_some(now),
                resolved.then_some(actor.trim()),
                thread_id,
                to_i64(expected_revision)?,
            ],
        )?;
        if changed != 1 {
            let actual = find_discussion_thread(&transaction, thread_id)?.revision;
            return Err(StorageError::EntityConflict {
                entity: "discussion_thread",
                id: thread_id.to_string(),
                expected_revision,
                actual_revision: actual,
            });
        }
        let updated = find_discussion_thread(&transaction, thread_id)?;
        append_operation(
            &transaction,
            &current.project_id,
            "discussion_thread",
            thread_id,
            if resolved {
                "discussion.thread.resolve"
            } else {
                "discussion.thread.reopen"
            },
            Some(current.revision),
            Some(updated.revision),
            actor,
            None,
            Some(json!({"thread": current, "reason": reason.trim()})),
            Some(json!({"thread": updated, "reason": reason.trim()})),
        )?;
        transaction.commit()?;
        Ok(updated)
    }

    pub fn list_discussion_messages(
        &self,
        thread_id: &str,
        include_deleted: bool,
        offset: u32,
        limit: u32,
    ) -> Result<(Vec<DiscussionMessageRecord>, u32)> {
        find_discussion_thread(&self.connection, thread_id)?;
        let total = self.connection.query_row(
            "SELECT COUNT(*) FROM discussion_messages
             WHERE thread_id = ?1 AND (?2 = 1 OR deleted = 0)",
            params![thread_id, include_deleted],
            |row| row.get::<_, i64>(0),
        )?;
        let mut statement = self.connection.prepare(
            "SELECT m.id, m.thread_id, m.ordinal, m.actor, m.body,
                    m.mentions_json, m.revision, t.revision, m.deleted,
                    m.created_at_ms, m.updated_at_ms
             FROM discussion_messages m
             JOIN discussion_threads t ON t.id = m.thread_id
             WHERE m.thread_id = ?1 AND (?2 = 1 OR m.deleted = 0)
             ORDER BY m.ordinal, m.id
             LIMIT ?3 OFFSET ?4",
        )?;
        let items = statement
            .query_map(
                params![
                    thread_id,
                    include_deleted,
                    i64::from(limit),
                    i64::from(offset)
                ],
                row_to_discussion_message,
            )?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok((items, to_u32(total)?))
    }

    pub fn create_discussion_message(
        &mut self,
        input: NewDiscussionMessage,
    ) -> Result<DiscussionMessageRecord> {
        validate_actor_reason(&input.actor, &input.reason)?;
        validate_bounded_nonempty("discussion message", &input.body, MAX_MESSAGE_BYTES)?;
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let thread = find_discussion_thread(&transaction, &input.thread_id)?;
        ensure_open_thread(&thread)?;
        ensure_entity_revision(
            "discussion_thread",
            &input.thread_id,
            thread.revision,
            input.expected_thread_revision,
        )?;
        let ordinal = transaction.query_row(
            "SELECT COALESCE(MAX(ordinal), -1) + 1
             FROM discussion_messages WHERE thread_id = ?1",
            [&input.thread_id],
            |row| row.get::<_, i64>(0),
        )?;
        let ordinal = u32::try_from(ordinal)
            .map_err(|_| StorageError::InvalidData("message ordinal overflow".to_string()))?;
        let id = translunar_domain::new_id();
        let now = now_ms();
        let mentions = extract_mentions(&input.body);
        transaction.execute(
            "INSERT INTO discussion_messages (
                id, thread_id, ordinal, actor, body, mentions_json, revision,
                deleted, created_at_ms, updated_at_ms
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, 0, ?7, ?7)",
            params![
                id,
                input.thread_id,
                i64::from(ordinal),
                input.actor,
                input.body.trim(),
                serde_json::to_string(&mentions)?,
                now,
            ],
        )?;
        let thread_revision = next_revision(thread.revision)?;
        update_thread_revision(
            &transaction,
            &input.thread_id,
            thread.revision,
            thread_revision,
            now,
        )?;
        let message = find_discussion_message(&transaction, &id)?;
        append_operation(
            &transaction,
            &thread.project_id,
            "discussion_message",
            &id,
            "discussion.message.create",
            Some(thread.revision),
            Some(thread_revision),
            &input.actor,
            None,
            None,
            Some(json!({"message": message, "reason": input.reason.trim()})),
        )?;
        transaction.commit()?;
        Ok(message)
    }

    pub fn update_discussion_message(
        &mut self,
        message_id: &str,
        body: &str,
        actor: &str,
        reason: &str,
        expected_revision: u64,
    ) -> Result<DiscussionMessageRecord> {
        validate_actor_reason(actor, reason)?;
        validate_bounded_nonempty("discussion message", body, MAX_MESSAGE_BYTES)?;
        self.mutate_discussion_message(
            message_id,
            actor,
            reason,
            expected_revision,
            MessageMutation::Update(body.trim()),
        )
    }

    pub fn delete_discussion_message(
        &mut self,
        message_id: &str,
        actor: &str,
        reason: &str,
        expected_revision: u64,
    ) -> Result<DiscussionMessageRecord> {
        validate_actor_reason(actor, reason)?;
        self.mutate_discussion_message(
            message_id,
            actor,
            reason,
            expected_revision,
            MessageMutation::Delete,
        )
    }

    fn mutate_discussion_message(
        &mut self,
        message_id: &str,
        actor: &str,
        reason: &str,
        expected_revision: u64,
        mutation: MessageMutation<'_>,
    ) -> Result<DiscussionMessageRecord> {
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let current = find_discussion_message(&transaction, message_id)?;
        ensure_entity_revision(
            "discussion_message",
            message_id,
            current.revision,
            expected_revision,
        )?;
        if current.deleted {
            return Err(StorageError::InvalidState(
                "a deleted discussion message cannot be changed".to_string(),
            ));
        }
        let thread = find_discussion_thread(&transaction, &current.thread_id)?;
        ensure_open_thread(&thread)?;
        let revision = next_revision(current.revision)?;
        let thread_revision = next_revision(thread.revision)?;
        let now = now_ms();
        let (body, mentions, deleted, operation_kind) = match mutation {
            MessageMutation::Update(body) => (
                body.to_string(),
                extract_mentions(body),
                false,
                "discussion.message.update",
            ),
            MessageMutation::Delete => (
                "[deleted]".to_string(),
                Vec::new(),
                true,
                "discussion.message.delete",
            ),
        };
        let changed = transaction.execute(
            "UPDATE discussion_messages
             SET body = ?1, mentions_json = ?2, revision = ?3,
                 deleted = ?4, updated_at_ms = ?5
             WHERE id = ?6 AND revision = ?7 AND deleted = 0",
            params![
                body,
                serde_json::to_string(&mentions)?,
                to_i64(revision)?,
                deleted,
                now,
                message_id,
                to_i64(expected_revision)?,
            ],
        )?;
        if changed != 1 {
            let actual = find_discussion_message(&transaction, message_id)?.revision;
            return Err(StorageError::EntityConflict {
                entity: "discussion_message",
                id: message_id.to_string(),
                expected_revision,
                actual_revision: actual,
            });
        }
        update_thread_revision(
            &transaction,
            &thread.id,
            thread.revision,
            thread_revision,
            now,
        )?;
        let updated = find_discussion_message(&transaction, message_id)?;
        append_operation(
            &transaction,
            &thread.project_id,
            "discussion_message",
            message_id,
            operation_kind,
            Some(current.revision),
            Some(updated.revision),
            actor,
            None,
            Some(json!({"message": current, "reason": reason.trim()})),
            Some(json!({"message": updated, "reason": reason.trim()})),
        )?;
        transaction.commit()?;
        Ok(updated)
    }
}

enum MessageMutation<'a> {
    Update(&'a str),
    Delete,
}

fn validate_scope_filter(connection: &Connection, filter: &DiscussionThreadFilter) -> Result<()> {
    if let Some(document_id) = filter.document_id.as_deref() {
        let document = find_document(connection, document_id)?;
        if document.project_id != filter.project_id {
            return Err(StorageError::InvalidState(
                "discussion document does not belong to the project".to_string(),
            ));
        }
    }
    if let Some(segment_id) = filter.segment_id.as_deref() {
        let segment = find_segment(connection, segment_id)?;
        let document = find_document(connection, &segment.document_id)?;
        if document.project_id != filter.project_id {
            return Err(StorageError::InvalidState(
                "discussion segment does not belong to the project".to_string(),
            ));
        }
    }
    Ok(())
}

fn validate_discussion_scope(
    connection: &Connection,
    project_id: &str,
    scope: DiscussionScope,
    document_id: Option<&str>,
    segment_id: Option<&str>,
) -> Result<()> {
    match scope {
        DiscussionScope::Project if document_id.is_none() && segment_id.is_none() => Ok(()),
        DiscussionScope::Document if document_id.is_some() && segment_id.is_none() => {
            let document = find_document(connection, document_id.unwrap_or_default())?;
            if document.project_id == project_id {
                Ok(())
            } else {
                Err(StorageError::InvalidState(
                    "discussion document does not belong to the project".to_string(),
                ))
            }
        }
        DiscussionScope::Segment if segment_id.is_some() => {
            let segment = find_segment(connection, segment_id.unwrap_or_default())?;
            let document = find_document(connection, &segment.document_id)?;
            if document.project_id != project_id {
                return Err(StorageError::InvalidState(
                    "discussion segment does not belong to the project".to_string(),
                ));
            }
            if let Some(document_id) = document_id
                && document_id != document.id
            {
                return Err(StorageError::InvalidState(
                    "discussion document does not contain the segment".to_string(),
                ));
            }
            Ok(())
        }
        _ => Err(StorageError::InvalidState(
            "discussion scope references are inconsistent".to_string(),
        )),
    }
}

fn validate_actor_reason(actor: &str, reason: &str) -> Result<()> {
    validate_bounded_nonempty("discussion actor", actor, MAX_ACTOR_BYTES)?;
    validate_bounded_nonempty("discussion reason", reason, MAX_REASON_BYTES)
}

fn validate_bounded_nonempty(label: &str, value: &str, max_bytes: usize) -> Result<()> {
    require_nonempty(label, value)?;
    if value.len() > max_bytes {
        return Err(StorageError::InvalidState(format!(
            "{label} must be at most {max_bytes} bytes"
        )));
    }
    Ok(())
}

fn normalized_title(title: &str, body: &str) -> String {
    let value = if title.trim().is_empty() {
        body.lines().next().unwrap_or("Discussion").trim()
    } else {
        title.trim()
    };
    truncate_utf8(value, MAX_TITLE_BYTES)
}

fn truncate_utf8(value: &str, max_bytes: usize) -> String {
    if value.len() <= max_bytes {
        return value.to_string();
    }
    let mut end = max_bytes;
    while !value.is_char_boundary(end) {
        end = end.saturating_sub(1);
    }
    value[..end].to_string()
}

pub fn extract_mentions(value: &str) -> Vec<String> {
    let chars = value.chars().collect::<Vec<_>>();
    let mut mentions = Vec::new();
    let mut seen = BTreeSet::new();
    let mut index = 0;
    while index < chars.len() {
        if chars[index] != '@'
            || index
                .checked_sub(1)
                .and_then(|previous| chars.get(previous))
                .is_some_and(|character| {
                    character.is_alphanumeric() || matches!(character, '_' | '-' | '.')
                })
        {
            index += 1;
            continue;
        }
        let start = index + 1;
        let mut end = start;
        while end < chars.len()
            && end - start < MAX_MENTION_CHARS
            && (chars[end].is_alphanumeric() || matches!(chars[end], '_' | '-' | '.'))
        {
            end += 1;
        }
        while end > start && chars[end - 1] == '.' {
            end -= 1;
        }
        if end > start {
            let token = format!(
                "@{}",
                chars[start..end].iter().collect::<String>().to_lowercase()
            );
            if seen.insert(token.clone()) {
                mentions.push(token);
            }
            index = end;
        } else {
            index += 1;
        }
    }
    mentions
}

fn ensure_open_thread(thread: &DiscussionThreadRecord) -> Result<()> {
    if thread.status == DiscussionStatus::Open {
        Ok(())
    } else {
        Err(StorageError::InvalidState(
            "resolved discussion thread must be reopened before mutation".to_string(),
        ))
    }
}

fn update_thread_revision(
    connection: &Connection,
    thread_id: &str,
    expected_revision: u64,
    revision: u64,
    updated_at_ms: i64,
) -> Result<()> {
    let changed = connection.execute(
        "UPDATE discussion_threads
         SET revision = ?1, updated_at_ms = ?2
         WHERE id = ?3 AND revision = ?4",
        params![
            to_i64(revision)?,
            updated_at_ms,
            thread_id,
            to_i64(expected_revision)?,
        ],
    )?;
    if changed == 1 {
        Ok(())
    } else {
        let actual = find_discussion_thread(connection, thread_id)?.revision;
        Err(StorageError::EntityConflict {
            entity: "discussion_thread",
            id: thread_id.to_string(),
            expected_revision,
            actual_revision: actual,
        })
    }
}

pub(super) fn find_discussion_thread(
    connection: &Connection,
    thread_id: &str,
) -> Result<DiscussionThreadRecord> {
    connection
        .query_row(
            "SELECT t.id, t.project_id, t.scope, t.document_id, t.segment_id,
                    t.title, t.status, t.revision,
                    (SELECT COUNT(*) FROM discussion_messages m
                     WHERE m.thread_id = t.id AND m.deleted = 0),
                    t.created_at_ms, t.updated_at_ms, t.resolved_at_ms, t.resolved_by
             FROM discussion_threads t WHERE t.id = ?1",
            [thread_id],
            row_to_discussion_thread,
        )
        .optional()?
        .ok_or_else(|| not_found("discussion_thread", thread_id))
}

pub(super) fn find_discussion_message(
    connection: &Connection,
    message_id: &str,
) -> Result<DiscussionMessageRecord> {
    connection
        .query_row(
            "SELECT m.id, m.thread_id, m.ordinal, m.actor, m.body,
                    m.mentions_json, m.revision, t.revision, m.deleted,
                    m.created_at_ms, m.updated_at_ms
             FROM discussion_messages m
             JOIN discussion_threads t ON t.id = m.thread_id
             WHERE m.id = ?1",
            [message_id],
            row_to_discussion_message,
        )
        .optional()?
        .ok_or_else(|| not_found("discussion_message", message_id))
}

pub(super) fn row_to_discussion_thread(row: &Row<'_>) -> rusqlite::Result<DiscussionThreadRecord> {
    Ok(DiscussionThreadRecord {
        id: row.get(0)?,
        project_id: row.get(1)?,
        scope: parse_discussion_scope(row.get(2)?, 2)?,
        document_id: row.get(3)?,
        segment_id: row.get(4)?,
        title: row.get(5)?,
        status: parse_discussion_status(row.get(6)?, 6)?,
        revision: read_u64(row, 7)?,
        message_count: read_u32(row, 8)?,
        created_at_ms: row.get(9)?,
        updated_at_ms: row.get(10)?,
        resolved_at_ms: row.get(11)?,
        resolved_by: row.get(12)?,
    })
}

pub(super) fn row_to_discussion_message(
    row: &Row<'_>,
) -> rusqlite::Result<DiscussionMessageRecord> {
    let mentions_json = row.get::<_, String>(5)?;
    let mentions = serde_json::from_str(&mentions_json).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(5, rusqlite::types::Type::Text, Box::new(error))
    })?;
    Ok(DiscussionMessageRecord {
        id: row.get(0)?,
        thread_id: row.get(1)?,
        ordinal: read_u32(row, 2)?,
        actor: row.get(3)?,
        body: row.get(4)?,
        mentions,
        revision: read_u64(row, 6)?,
        thread_revision: read_u64(row, 7)?,
        deleted: row.get(8)?,
        created_at_ms: row.get(9)?,
        updated_at_ms: row.get(10)?,
    })
}

fn discussion_scope_text(scope: DiscussionScope) -> &'static str {
    match scope {
        DiscussionScope::Project => "project",
        DiscussionScope::Document => "document",
        DiscussionScope::Segment => "segment",
    }
}

fn discussion_status_text(status: DiscussionStatus) -> &'static str {
    match status {
        DiscussionStatus::Open => "open",
        DiscussionStatus::Resolved => "resolved",
    }
}

fn parse_discussion_scope(value: String, column: usize) -> rusqlite::Result<DiscussionScope> {
    match value.as_str() {
        "project" => Ok(DiscussionScope::Project),
        "document" => Ok(DiscussionScope::Document),
        "segment" => Ok(DiscussionScope::Segment),
        _ => Err(rusqlite::Error::FromSqlConversionFailure(
            column,
            rusqlite::types::Type::Text,
            Box::new(StorageError::InvalidData(format!(
                "unknown discussion scope {value}"
            ))),
        )),
    }
}

fn parse_discussion_status(value: String, column: usize) -> rusqlite::Result<DiscussionStatus> {
    match value.as_str() {
        "open" => Ok(DiscussionStatus::Open),
        "resolved" => Ok(DiscussionStatus::Resolved),
        _ => Err(rusqlite::Error::FromSqlConversionFailure(
            column,
            rusqlite::types::Type::Text,
            Box::new(StorageError::InvalidData(format!(
                "unknown discussion status {value}"
            ))),
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::NewDocument;
    use translunar_filter_core::ImportedUnit;

    #[test]
    fn mention_tokens_are_local_normalized_and_stable() {
        assert_eq!(
            extract_mentions("Ask @Alice, @bob.smith and @ALICE; ignore mail@example.com."),
            vec!["@alice", "@bob.smith"]
        );
    }

    #[test]
    fn discussion_lifecycle_is_revisioned_pageable_and_restart_safe() {
        let temp = tempfile::tempdir().expect("discussion temp directory");
        let (project_id, document_id, segment_id, thread_id);
        {
            let mut store = Store::open(temp.path()).expect("open discussion store");
            let project = store
                .create_project("Discussion", "en-US", "zh-CN", "general")
                .expect("create discussion project");
            project_id = project.id.clone();
            let document = NewDocument {
                id: translunar_domain::new_id(),
                project_id: project.id.clone(),
                name: "discussion.txt".to_string(),
                relative_path: "discussion.txt".to_string(),
                format: "txt".to_string(),
                filter_id: "builtin.txt".to_string(),
                source_sha256: "discussion-source".to_string(),
                degradation: Vec::new(),
                original_source_path: temp.path().join("discussion.txt"),
                managed_source_path: temp.path().join("sources/discussion.txt"),
            };
            document_id = document.id.clone();
            store
                .insert_document(
                    &document,
                    &[ImportedUnit::plain(0, "txt:0", "Discuss this")],
                )
                .expect("insert discussion document");
            segment_id = store
                .all_segments(&document_id)
                .expect("discussion segments")[0]
                .id
                .clone();
            let thread = store
                .create_discussion_thread(NewDiscussionThread {
                    project_id: project.id,
                    scope: DiscussionScope::Segment,
                    document_id: Some(document_id.clone()),
                    segment_id: Some(segment_id.clone()),
                    title: "Terminology".to_string(),
                    body: "Please ask @Reviewer.".to_string(),
                    actor: "alice".to_string(),
                    reason: "Open terminology discussion".to_string(),
                    expected_project_revision: project.revision,
                })
                .expect("create discussion thread");
            thread_id = thread.id.clone();
            let reply = store
                .create_discussion_message(NewDiscussionMessage {
                    thread_id: thread.id,
                    body: "Resolved with @Alice.".to_string(),
                    actor: "reviewer".to_string(),
                    reason: "Answer terminology question".to_string(),
                    expected_thread_revision: thread.revision,
                })
                .expect("append discussion reply");
            assert_eq!(reply.ordinal, 1);
            assert_eq!(reply.thread_revision, 1);
            let edited = store
                .update_discussion_message(
                    &reply.id,
                    "Resolved with @Alice and @Owner.",
                    "reviewer",
                    "Clarify answer",
                    reply.revision,
                )
                .expect("edit discussion reply");
            assert_eq!(edited.revision, 1);
            assert_eq!(edited.thread_revision, 2);
            let resolved = store
                .resolve_discussion_thread(
                    &thread_id,
                    true,
                    edited.thread_revision,
                    "alice",
                    "Terminology agreed",
                )
                .expect("resolve discussion");
            assert_eq!(resolved.status, DiscussionStatus::Resolved);

            let stale = store
                .create_discussion_message(NewDiscussionMessage {
                    thread_id: thread_id.clone(),
                    body: "stale".to_string(),
                    actor: "alice".to_string(),
                    reason: "stale attempt".to_string(),
                    expected_thread_revision: 0,
                })
                .expect_err("resolved/stale thread must reject message");
            assert!(matches!(stale, StorageError::InvalidState(_)));
        }

        let store = Store::open(temp.path()).expect("reopen discussion store");
        let (threads, total) = store
            .list_discussion_threads(&DiscussionThreadFilter {
                project_id: project_id.clone(),
                scope: Some(DiscussionScope::Segment),
                document_id: Some(document_id),
                segment_id: Some(segment_id),
                include_resolved: true,
                offset: 0,
                limit: 1,
            })
            .expect("list discussion threads after restart");
        assert_eq!(total, 1);
        assert_eq!(threads[0].message_count, 2);
        let (messages, message_total) = store
            .list_discussion_messages(&thread_id, false, 0, 1)
            .expect("page messages after restart");
        assert_eq!(message_total, 2);
        assert_eq!(messages[0].mentions, vec!["@reviewer"]);
        let (operations, _) = store
            .list_operations(&project_id, 0, 20, false)
            .expect("discussion history");
        assert_eq!(
            operations
                .iter()
                .filter(|operation| operation.kind.starts_with("discussion."))
                .count(),
            4
        );
    }
}

use std::collections::{BTreeMap, BTreeSet};

use rusqlite::{Connection, OptionalExtension, Row, Transaction, TransactionBehavior, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use translunar_asset_core::{AssetMountMode, TermbaseMount, TmLibraryMount};
use translunar_domain::{
    Document, DocumentNote, DocumentVersion, EditorComment, EditorWorkflowState, InlineTag,
    Project, ReviewRevision, Segment,
};

use super::discussion::{
    DiscussionMessageRecord, DiscussionThreadRecord, row_to_discussion_message,
    row_to_discussion_thread,
};
use super::lifecycle::rebuild_project_search;
use super::{
    Store, append_operation, editor_workflow_state_text, ensure_entity_revision, find_document,
    find_project, next_revision, not_found, now_ms, read_u32, read_u64, require_nonempty,
    row_to_document, row_to_review, row_to_segment, row_to_termbase_mount, row_to_tm_library_mount,
    segment_state_text, tag_kind_text, tag_side_text, to_i64, to_u32,
};
use crate::{Result, StorageError};

const SNAPSHOT_PAYLOAD_VERSION: u32 = 1;
const MAX_SNAPSHOT_NAME_BYTES: usize = 256;
const MAX_SNAPSHOT_ACTOR_BYTES: usize = 128;
const MAX_SNAPSHOT_REASON_BYTES: usize = 512;
const MAX_SNAPSHOT_BYTES: usize = 64 * 1024 * 1024;
const MAX_SNAPSHOT_PAGE_SIZE: u32 = 500;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NamedProjectSnapshotRecord {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub base_project_revision: u64,
    pub state_hash: String,
    pub document_count: u32,
    pub segment_count: u32,
    pub thread_count: u32,
    pub created_at_ms: i64,
    pub actor: String,
    pub reason: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ProjectSnapshotPreviewStatusRecord {
    Open,
    Applied,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSnapshotChangeSummaryRecord {
    pub documents_added: u32,
    pub documents_removed: u32,
    pub documents_changed: u32,
    pub segments_added: u32,
    pub segments_removed: u32,
    pub segments_changed: u32,
    pub comments_changed: u32,
    pub reviews_changed: u32,
    pub discussions_changed: u32,
    pub mounts_added: u32,
    pub mounts_removed: u32,
    pub mounts_changed: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSnapshotPreviewRecord {
    pub preview_id: String,
    pub snapshot_id: String,
    pub project_id: String,
    pub expected_project_revision: u64,
    pub current_project_revision: u64,
    pub current_state_hash: String,
    pub status: ProjectSnapshotPreviewStatusRecord,
    pub summary: ProjectSnapshotChangeSummaryRecord,
    pub missing_dependency_ids: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct NewProjectSnapshot {
    pub project_id: String,
    pub name: String,
    pub expected_project_revision: u64,
    pub actor: String,
    pub reason: String,
}

#[derive(Debug, Clone)]
pub struct RestoreProjectSnapshot {
    pub preview_id: String,
    pub expected_project_revision: u64,
    pub actor: String,
    pub reason: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProjectSnapshotPayload {
    schema_version: u32,
    project: Project,
    documents: Vec<ProjectSnapshotDocument>,
    discussions: Vec<ProjectSnapshotDiscussion>,
    tm_mounts: Vec<TmLibraryMount>,
    termbase_mounts: Vec<TermbaseMount>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProjectSnapshotDocument {
    document: Document,
    original_source_path: String,
    managed_source_path: String,
    versions: Vec<DocumentVersion>,
    segments: Vec<ProjectSnapshotSegment>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProjectSnapshotSegment {
    segment: Segment,
    document_version_id: String,
    source_version: u32,
    workflow_state: EditorWorkflowState,
    lineage_id: Option<String>,
    source_edit_revision: u64,
    source_tags: Vec<InlineTag>,
    target_tags: Vec<InlineTag>,
    notes: Vec<DocumentNote>,
    comments: Vec<EditorComment>,
    reviews: Vec<ReviewRevision>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProjectSnapshotDiscussion {
    thread: DiscussionThreadRecord,
    messages: Vec<DiscussionMessageRecord>,
}

#[derive(Debug, Clone)]
struct StoredProjectSnapshot {
    metadata: NamedProjectSnapshotRecord,
    payload_json: String,
}

impl Store {
    pub fn create_project_snapshot(
        &mut self,
        input: NewProjectSnapshot,
    ) -> Result<NamedProjectSnapshotRecord> {
        validate_snapshot_text("snapshot name", &input.name, MAX_SNAPSHOT_NAME_BYTES)?;
        validate_snapshot_text("snapshot actor", &input.actor, MAX_SNAPSHOT_ACTOR_BYTES)?;
        validate_snapshot_text("snapshot reason", &input.reason, MAX_SNAPSHOT_REASON_BYTES)?;
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
        let duplicate = transaction
            .query_row(
                "SELECT 1 FROM project_snapshots WHERE project_id = ?1 AND name = ?2",
                params![input.project_id, input.name.trim()],
                |_| Ok(()),
            )
            .optional()?
            .is_some();
        if duplicate {
            return Err(StorageError::InvalidState(
                "a project snapshot with this name already exists".to_string(),
            ));
        }
        let payload = capture_snapshot_payload(&transaction, &project.id)?;
        let (payload_json, state_hash) = encode_payload(&payload)?;
        let now = now_ms();
        let id = translunar_domain::new_id();
        transaction.execute(
            "INSERT INTO project_snapshots (
                id, project_id, name, base_project_revision, state_hash, payload_json,
                document_count, segment_count, thread_count, actor, reason, created_at_ms
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
            params![
                id,
                input.project_id,
                input.name.trim(),
                to_i64(project.revision)?,
                state_hash,
                payload_json,
                to_i64(u64::try_from(payload.documents.len()).map_err(|_| {
                    StorageError::InvalidData("snapshot document count overflow".to_string())
                })?)?,
                to_i64(
                    u64::try_from(snapshot_segment_count(&payload)).map_err(|_| {
                        StorageError::InvalidData("snapshot segment count overflow".to_string())
                    })?
                )?,
                to_i64(u64::try_from(payload.discussions.len()).map_err(|_| {
                    StorageError::InvalidData("snapshot thread count overflow".to_string())
                })?)?,
                input.actor.trim(),
                input.reason.trim(),
                now,
            ],
        )?;
        let metadata = find_snapshot(&transaction, &id)?.metadata;
        append_operation(
            &transaction,
            &project.id,
            "project_snapshot",
            &id,
            "project.snapshot.create",
            Some(project.revision),
            Some(project.revision),
            input.actor.trim(),
            None,
            None,
            Some(json!({
                "snapshotId": id,
                "name": metadata.name,
                "documentCount": metadata.document_count,
                "segmentCount": metadata.segment_count,
                "threadCount": metadata.thread_count,
                "reason": input.reason.trim(),
            })),
        )?;
        transaction.commit()?;
        Ok(metadata)
    }

    pub fn list_project_snapshots(
        &self,
        project_id: &str,
        offset: u32,
        limit: u32,
    ) -> Result<(Vec<NamedProjectSnapshotRecord>, u32)> {
        find_project(&self.connection, project_id)?;
        let total = self.connection.query_row(
            "SELECT COUNT(*) FROM project_snapshots WHERE project_id = ?1",
            [project_id],
            |row| row.get::<_, i64>(0),
        )?;
        let limit = limit.min(MAX_SNAPSHOT_PAGE_SIZE);
        let mut statement = self.connection.prepare(
            "SELECT id, project_id, name, base_project_revision, state_hash,
                    document_count, segment_count, thread_count, created_at_ms, actor, reason
             FROM project_snapshots
             WHERE project_id = ?1
             ORDER BY created_at_ms DESC, id
             LIMIT ?2 OFFSET ?3",
        )?;
        let items = statement
            .query_map(
                params![project_id, i64::from(limit), i64::from(offset)],
                row_to_snapshot_metadata,
            )?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok((items, to_u32(total)?))
    }

    pub fn get_project_snapshot(&self, snapshot_id: &str) -> Result<NamedProjectSnapshotRecord> {
        Ok(find_snapshot(&self.connection, snapshot_id)?.metadata)
    }

    pub fn preview_project_snapshot_restore(
        &mut self,
        snapshot_id: &str,
        expected_project_revision: u64,
    ) -> Result<ProjectSnapshotPreviewRecord> {
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let snapshot = find_snapshot(&transaction, snapshot_id)?;
        let project = find_project(&transaction, &snapshot.metadata.project_id)?;
        ensure_entity_revision(
            "project",
            &project.id,
            project.revision,
            expected_project_revision,
        )?;
        let current_payload = capture_snapshot_payload(&transaction, &project.id)?;
        let (_, current_state_hash) = encode_payload(&current_payload)?;
        let snapshot_payload = decode_stored_snapshot(&snapshot)?;
        let summary = snapshot_diff(&snapshot_payload, &current_payload)?;
        let missing_dependency_ids = missing_dependencies(&transaction, &snapshot_payload)?;
        let now = now_ms();
        let preview_id = translunar_domain::new_id();
        transaction.execute(
            "INSERT INTO project_snapshot_previews (
                id, snapshot_id, project_id, expected_project_revision,
                current_state_hash, summary_json, missing_dependencies_json,
                status, result_json, created_at_ms, updated_at_ms, applied_at_ms
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'open', NULL, ?8, ?8, NULL)",
            params![
                preview_id,
                snapshot_id,
                project.id,
                to_i64(expected_project_revision)?,
                current_state_hash,
                serde_json::to_string(&summary)?,
                serde_json::to_string(&missing_dependency_ids)?,
                now,
            ],
        )?;
        let preview = find_preview(&transaction, &preview_id)?;
        transaction.commit()?;
        Ok(preview)
    }

    pub fn restore_project_snapshot(
        &mut self,
        input: RestoreProjectSnapshot,
    ) -> Result<ProjectSnapshotRestoreResultRecord> {
        validate_snapshot_text("snapshot actor", &input.actor, MAX_SNAPSHOT_ACTOR_BYTES)?;
        validate_snapshot_text("snapshot reason", &input.reason, MAX_SNAPSHOT_REASON_BYTES)?;
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let preview = find_preview_row(&transaction, &input.preview_id)?;
        if preview.status != ProjectSnapshotPreviewStatusRecord::Open {
            return Err(StorageError::InvalidState(
                "snapshot preview is no longer open; create a fresh preview".to_string(),
            ));
        }
        if preview.expected_project_revision != input.expected_project_revision {
            return Err(StorageError::EntityConflict {
                entity: "project_snapshot_preview",
                id: input.preview_id,
                expected_revision: input.expected_project_revision,
                actual_revision: preview.expected_project_revision,
            });
        }
        let project = find_project(&transaction, &preview.project_id)?;
        ensure_entity_revision(
            "project",
            &project.id,
            project.revision,
            input.expected_project_revision,
        )?;
        let current_payload = capture_snapshot_payload(&transaction, &project.id)?;
        let (_, current_hash) = encode_payload(&current_payload)?;
        if current_hash != preview.current_state_hash {
            return Err(StorageError::InvalidState(
                "snapshot preview is stale; create a fresh preview".to_string(),
            ));
        }
        let snapshot = find_snapshot(&transaction, &preview.snapshot_id)?;
        let desired_payload = decode_stored_snapshot(&snapshot)?;
        if desired_payload.project.id != project.id {
            return Err(StorageError::InvalidData(
                "snapshot project identity does not match preview".to_string(),
            ));
        }
        let missing = missing_dependencies(&transaction, &desired_payload)?;
        if !missing.is_empty() {
            return Err(StorageError::InvalidState(format!(
                "snapshot references missing mounted assets: {}",
                missing.join(", ")
            )));
        }
        let summary = snapshot_diff(&desired_payload, &current_payload)?;
        let next_project_revision = next_revision(project.revision)?;
        let now = now_ms();
        apply_project_snapshot(
            &transaction,
            &project,
            &desired_payload,
            next_project_revision,
            now,
        )?;
        let operation = append_operation(
            &transaction,
            &project.id,
            "project_snapshot",
            &snapshot.metadata.id,
            "project.snapshot.restore",
            Some(project.revision),
            Some(next_project_revision),
            input.actor.trim(),
            None,
            Some(json!({
                "previewId": input.preview_id,
                "snapshotId": snapshot.metadata.id,
                "stateHash": current_hash,
                "reason": input.reason.trim(),
            })),
            Some(json!({
                "previewId": input.preview_id,
                "snapshotId": snapshot.metadata.id,
                "summary": summary,
                "projectRevision": next_project_revision,
            })),
        )?;
        let result = ProjectSnapshotRestoreResultRecord {
            preview_id: input.preview_id.clone(),
            snapshot_id: snapshot.metadata.id.clone(),
            status: ProjectSnapshotPreviewStatusRecord::Applied,
            project_revision: next_project_revision,
            summary,
            operation_id: Some(operation.id),
        };
        let changed = transaction.execute(
            "UPDATE project_snapshot_previews
             SET status = 'applied', result_json = ?1, updated_at_ms = ?2,
                 applied_at_ms = ?2
             WHERE id = ?3 AND status = 'open'",
            params![serde_json::to_string(&result)?, now, input.preview_id],
        )?;
        if changed != 1 {
            return Err(StorageError::InvalidState(
                "snapshot preview changed before restore completed".to_string(),
            ));
        }
        transaction.commit()?;
        Ok(result)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSnapshotRestoreResultRecord {
    pub preview_id: String,
    pub snapshot_id: String,
    pub status: ProjectSnapshotPreviewStatusRecord,
    pub project_revision: u64,
    pub summary: ProjectSnapshotChangeSummaryRecord,
    pub operation_id: Option<String>,
}

fn validate_snapshot_text(label: &str, value: &str, max_bytes: usize) -> Result<()> {
    require_nonempty(label, value)?;
    if value.trim().len() > max_bytes {
        return Err(StorageError::InvalidState(format!(
            "{label} must be at most {max_bytes} bytes"
        )));
    }
    Ok(())
}

fn encode_payload(payload: &ProjectSnapshotPayload) -> Result<(String, String)> {
    let bytes = serde_json::to_vec(payload)?;
    if bytes.len() > MAX_SNAPSHOT_BYTES {
        return Err(StorageError::InvalidState(format!(
            "snapshot payload exceeds {MAX_SNAPSHOT_BYTES} bytes"
        )));
    }
    let mut hasher = Sha256::new();
    hasher.update(&bytes);
    let hash = hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    let json = String::from_utf8(bytes)
        .map_err(|_| StorageError::InvalidData("snapshot payload is not UTF-8".to_string()))?;
    Ok((json, hash))
}

fn decode_payload(payload_json: &str) -> Result<ProjectSnapshotPayload> {
    if payload_json.len() > MAX_SNAPSHOT_BYTES {
        return Err(StorageError::InvalidData(
            "stored snapshot payload exceeds the supported limit".to_string(),
        ));
    }
    let payload: ProjectSnapshotPayload = serde_json::from_str(payload_json)?;
    if payload.schema_version != SNAPSHOT_PAYLOAD_VERSION {
        return Err(StorageError::InvalidData(format!(
            "unsupported snapshot payload version {}",
            payload.schema_version
        )));
    }
    Ok(payload)
}

fn decode_stored_snapshot(snapshot: &StoredProjectSnapshot) -> Result<ProjectSnapshotPayload> {
    let payload = decode_payload(&snapshot.payload_json)?;
    let (_, computed_hash) = encode_payload(&payload)?;
    if computed_hash != snapshot.metadata.state_hash {
        return Err(StorageError::InvalidData(
            "stored snapshot payload hash does not match its metadata".to_string(),
        ));
    }
    Ok(payload)
}

fn snapshot_segment_count(payload: &ProjectSnapshotPayload) -> usize {
    payload
        .documents
        .iter()
        .map(|document| document.segments.len())
        .sum()
}

fn capture_snapshot_payload(
    connection: &Connection,
    project_id: &str,
) -> Result<ProjectSnapshotPayload> {
    let project = find_project(connection, project_id)?;
    let mut document_statement = connection.prepare(
        "SELECT d.id, d.project_id, d.name, d.relative_path, d.format, d.filter_id,
                d.source_sha256, d.current_version, d.status, d.revision, d.segment_count,
                d.degradation_json, d.imported_at_ms, d.updated_at_ms,
                v.original_source_path, v.managed_source_path
         FROM documents d
         JOIN document_versions v
           ON v.document_id = d.id AND v.version = d.current_version
         WHERE d.project_id = ?1 AND d.lifecycle = 'active'
         ORDER BY d.relative_path, d.imported_at_ms, d.id",
    )?;
    let documents = document_statement
        .query_map([project_id], |row| {
            let document = row_to_document(row)?;
            Ok((
                document,
                row.get::<_, String>(14)?,
                row.get::<_, String>(15)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    drop(document_statement);
    let mut snapshot_documents = Vec::with_capacity(documents.len());
    for (document, original_source_path, managed_source_path) in documents {
        let versions = capture_document_versions(connection, &document.id)?;
        let mut segment_statement = connection.prepare(
            "SELECT id, document_id, ordinal, structural_path, source_text, target_text,
                    state, revision, source_hash, context_hash, updated_at_ms
             FROM segments WHERE document_id = ?1 ORDER BY ordinal, id",
        )?;
        let segments = segment_statement
            .query_map([document.id.as_str()], row_to_segment)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        drop(segment_statement);
        let mut snapshot_segments = Vec::with_capacity(segments.len());
        for segment in segments {
            snapshot_segments.push(capture_snapshot_segment(connection, segment)?);
        }
        snapshot_documents.push(ProjectSnapshotDocument {
            document,
            original_source_path,
            managed_source_path,
            versions,
            segments: snapshot_segments,
        });
    }
    let discussions = capture_snapshot_discussions(connection, project_id)?;
    let tm_mounts = capture_tm_mounts(connection, project_id)?;
    let termbase_mounts = capture_termbase_mounts(connection, project_id)?;
    let mut payload = ProjectSnapshotPayload {
        schema_version: SNAPSHOT_PAYLOAD_VERSION,
        project,
        documents: snapshot_documents,
        discussions,
        tm_mounts,
        termbase_mounts,
    };
    canonicalize_payload(&mut payload);
    Ok(payload)
}

fn capture_document_versions(
    connection: &Connection,
    document_id: &str,
) -> Result<Vec<DocumentVersion>> {
    let mut statement = connection.prepare(
        "SELECT id, document_id, version, source_sha256, original_source_path,
                managed_source_path, reason, created_at_ms
         FROM document_versions WHERE document_id = ?1 ORDER BY version, id",
    )?;
    statement
        .query_map([document_id], |row| {
            Ok(DocumentVersion {
                id: row.get(0)?,
                document_id: row.get(1)?,
                version: read_u32(row, 2)?,
                source_sha256: row.get(3)?,
                original_source_path: row.get(4)?,
                managed_source_path: row.get(5)?,
                reason: row.get(6)?,
                created_at_ms: row.get(7)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(Into::into)
}

fn capture_snapshot_segment(
    connection: &Connection,
    segment: Segment,
) -> Result<ProjectSnapshotSegment> {
    let source_tags =
        super::list_inline_tags(connection, &segment.id, translunar_domain::TagSide::Source)?;
    let target_tags =
        super::list_inline_tags(connection, &segment.id, translunar_domain::TagSide::Target)?;
    let notes = capture_segment_notes(connection, &segment.id)?;
    let comments = super::list_editor_comments(connection, &segment.id, true)?;
    let mut review_statement = connection.prepare(
        "SELECT r.id, r.segment_id, r.base_revision, r.before_target, r.proposed_target,
                r.author, r.reason, r.status, r.created_at_ms, r.updated_at_ms,
                r.before_source, r.proposed_source, r.before_target_tags_json,
                r.proposed_target_tags_json
         FROM review_revisions r WHERE r.segment_id = ?1 ORDER BY r.created_at_ms, r.id",
    )?;
    let reviews = review_statement
        .query_map([segment.id.as_str()], row_to_review)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let (document_version_id, source_version, workflow_state, lineage_id, source_edit_revision) =
        connection.query_row(
            "SELECT document_version_id, source_version, workflow_state, lineage_id,
                        source_edit_revision
                 FROM segments s JOIN segment_editor_meta m ON m.segment_id = s.id
                 WHERE s.id = ?1",
            [&segment.id],
            |row| {
                let workflow_state = match row.get::<_, String>(2)?.as_str() {
                    "review" => EditorWorkflowState::Review,
                    "signed" => EditorWorkflowState::Signed,
                    _ => EditorWorkflowState::Translation,
                };
                Ok((
                    row.get::<_, Option<String>>(0)?,
                    read_u32(row, 1)?,
                    workflow_state,
                    row.get::<_, Option<String>>(3)?,
                    read_u64(row, 4)?,
                ))
            },
        )?;
    let document_version_id = document_version_id.ok_or_else(|| {
        StorageError::InvalidData(format!("segment {} has no document version", segment.id))
    })?;
    Ok(ProjectSnapshotSegment {
        segment,
        document_version_id,
        source_version,
        workflow_state,
        lineage_id,
        source_edit_revision,
        source_tags,
        target_tags,
        notes,
        comments,
        reviews,
    })
}

fn capture_snapshot_discussions(
    connection: &Connection,
    project_id: &str,
) -> Result<Vec<ProjectSnapshotDiscussion>> {
    let mut thread_statement = connection.prepare(
        "SELECT t.id, t.project_id, t.scope, t.document_id, t.segment_id,
                t.title, t.status, t.revision,
                (SELECT COUNT(*) FROM discussion_messages m
                 WHERE m.thread_id = t.id AND m.deleted = 0),
                t.created_at_ms, t.updated_at_ms, t.resolved_at_ms, t.resolved_by
         FROM discussion_threads t WHERE t.project_id = ?1 ORDER BY t.id",
    )?;
    let threads = thread_statement
        .query_map([project_id], row_to_discussion_thread)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    drop(thread_statement);
    let mut result = Vec::with_capacity(threads.len());
    for thread in threads {
        let mut message_statement = connection.prepare(
            "SELECT m.id, m.thread_id, m.ordinal, m.actor, m.body,
                    m.mentions_json, m.revision, t.revision, m.deleted,
                    m.created_at_ms, m.updated_at_ms
             FROM discussion_messages m JOIN discussion_threads t ON t.id = m.thread_id
             WHERE m.thread_id = ?1 ORDER BY m.ordinal, m.id",
        )?;
        let messages = message_statement
            .query_map([thread.id.as_str()], row_to_discussion_message)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        result.push(ProjectSnapshotDiscussion { thread, messages });
    }
    Ok(result)
}

fn capture_segment_notes(connection: &Connection, segment_id: &str) -> Result<Vec<DocumentNote>> {
    let mut statement = connection
        .prepare("SELECT id, text, author FROM segment_notes WHERE segment_id = ?1 ORDER BY id")?;
    statement
        .query_map([segment_id], |row| {
            Ok(DocumentNote {
                id: row.get(0)?,
                text: row.get(1)?,
                author: row.get(2)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(Into::into)
}

fn capture_tm_mounts(connection: &Connection, project_id: &str) -> Result<Vec<TmLibraryMount>> {
    let mut statement = connection.prepare(
        "SELECT project_id, library_id, mode, priority, enabled, revision,
                created_at_ms, updated_at_ms
         FROM tm_library_mounts WHERE project_id = ?1 ORDER BY priority, library_id",
    )?;
    statement
        .query_map([project_id], row_to_tm_library_mount)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(Into::into)
}

fn capture_termbase_mounts(
    connection: &Connection,
    project_id: &str,
) -> Result<Vec<TermbaseMount>> {
    let mut statement = connection.prepare(
        "SELECT project_id, termbase_id, priority, writable, enabled, revision,
                created_at_ms, updated_at_ms
         FROM termbase_mounts WHERE project_id = ?1 ORDER BY priority, termbase_id",
    )?;
    statement
        .query_map([project_id], row_to_termbase_mount)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(Into::into)
}

fn canonicalize_payload(payload: &mut ProjectSnapshotPayload) {
    payload.documents.sort_by(|left, right| {
        left.document.id.cmp(&right.document.id).then(
            left.document
                .relative_path
                .cmp(&right.document.relative_path),
        )
    });
    for document in &mut payload.documents {
        document.versions.sort_by(|left, right| {
            left.version
                .cmp(&right.version)
                .then(left.id.cmp(&right.id))
        });
        document.segments.sort_by(|left, right| {
            left.segment
                .ordinal
                .cmp(&right.segment.ordinal)
                .then(left.segment.id.cmp(&right.segment.id))
        });
        for segment in &mut document.segments {
            segment.source_tags.sort_by(|left, right| {
                left.position
                    .cmp(&right.position)
                    .then(left.id.cmp(&right.id))
            });
            segment.target_tags.sort_by(|left, right| {
                left.position
                    .cmp(&right.position)
                    .then(left.id.cmp(&right.id))
            });
            segment.notes.sort_by(|left, right| left.id.cmp(&right.id));
            segment
                .comments
                .sort_by(|left, right| left.id.cmp(&right.id));
            segment
                .reviews
                .sort_by(|left, right| left.id.cmp(&right.id));
        }
    }
    payload
        .discussions
        .sort_by(|left, right| left.thread.id.cmp(&right.thread.id));
    for discussion in &mut payload.discussions {
        discussion.messages.sort_by(|left, right| {
            left.ordinal
                .cmp(&right.ordinal)
                .then(left.id.cmp(&right.id))
        });
    }
    payload
        .tm_mounts
        .sort_by(|left, right| left.library_id.cmp(&right.library_id));
    payload
        .termbase_mounts
        .sort_by(|left, right| left.termbase_id.cmp(&right.termbase_id));
}

fn snapshot_diff(
    snapshot: &ProjectSnapshotPayload,
    current: &ProjectSnapshotPayload,
) -> Result<ProjectSnapshotChangeSummaryRecord> {
    let snapshot_documents = snapshot
        .documents
        .iter()
        .map(|item| {
            Ok::<(String, Value), StorageError>((
                item.document.id.clone(),
                serde_json::to_value(item)?,
            ))
        })
        .collect::<std::result::Result<BTreeMap<_, _>, _>>()?;
    let current_documents = current
        .documents
        .iter()
        .map(|item| {
            Ok::<(String, Value), StorageError>((
                item.document.id.clone(),
                serde_json::to_value(item)?,
            ))
        })
        .collect::<std::result::Result<BTreeMap<_, _>, _>>()?;
    let (documents_added, documents_removed, documents_changed) =
        diff_values(&snapshot_documents, &current_documents)?;
    let snapshot_segments = flatten_segments(snapshot)?;
    let current_segments = flatten_segments(current)?;
    let (segments_added, segments_removed, segments_changed) =
        diff_values(&snapshot_segments, &current_segments)?;
    let snapshot_comments = flatten_comments(snapshot)?;
    let current_comments = flatten_comments(current)?;
    let comments_changed = total_diff_count(&snapshot_comments, &current_comments)?;
    let snapshot_reviews = flatten_reviews(snapshot)?;
    let current_reviews = flatten_reviews(current)?;
    let reviews_changed = total_diff_count(&snapshot_reviews, &current_reviews)?;
    let snapshot_discussions = flatten_discussions(snapshot)?;
    let current_discussions = flatten_discussions(current)?;
    let discussions_changed = total_diff_count(&snapshot_discussions, &current_discussions)?;
    let snapshot_mounts = flatten_mounts(snapshot)?;
    let current_mounts = flatten_mounts(current)?;
    let (mounts_added, mounts_removed, mounts_changed) =
        diff_values(&snapshot_mounts, &current_mounts)?;
    Ok(ProjectSnapshotChangeSummaryRecord {
        documents_added,
        documents_removed,
        documents_changed,
        segments_added,
        segments_removed,
        segments_changed,
        comments_changed,
        reviews_changed,
        discussions_changed,
        mounts_added,
        mounts_removed,
        mounts_changed,
    })
}

fn diff_values(
    expected: &BTreeMap<String, Value>,
    actual: &BTreeMap<String, Value>,
) -> Result<(u32, u32, u32)> {
    let added = expected
        .keys()
        .filter(|key| !actual.contains_key(*key))
        .count();
    let removed = actual
        .keys()
        .filter(|key| !expected.contains_key(*key))
        .count();
    let changed = expected
        .iter()
        .filter(|(key, value)| actual.get(*key).is_some_and(|other| other != *value))
        .count();
    Ok((
        u32::try_from(added)
            .map_err(|_| StorageError::InvalidData("snapshot diff overflow".to_string()))?,
        u32::try_from(removed)
            .map_err(|_| StorageError::InvalidData("snapshot diff overflow".to_string()))?,
        u32::try_from(changed)
            .map_err(|_| StorageError::InvalidData("snapshot diff overflow".to_string()))?,
    ))
}

fn total_diff_count(
    expected: &BTreeMap<String, Value>,
    actual: &BTreeMap<String, Value>,
) -> Result<u32> {
    let (added, removed, changed) = diff_values(expected, actual)?;
    added
        .checked_add(removed)
        .and_then(|value| value.checked_add(changed))
        .ok_or_else(|| StorageError::InvalidData("snapshot diff overflow".to_string()))
}

fn flatten_segments(payload: &ProjectSnapshotPayload) -> Result<BTreeMap<String, Value>> {
    let mut result = BTreeMap::new();
    for document in &payload.documents {
        for segment in &document.segments {
            result.insert(segment.segment.id.clone(), serde_json::to_value(segment)?);
        }
    }
    Ok(result)
}

fn flatten_comments(payload: &ProjectSnapshotPayload) -> Result<BTreeMap<String, Value>> {
    let mut result = BTreeMap::new();
    for document in &payload.documents {
        for segment in &document.segments {
            for comment in &segment.comments {
                result.insert(comment.id.clone(), serde_json::to_value(comment)?);
            }
        }
    }
    Ok(result)
}

fn flatten_reviews(payload: &ProjectSnapshotPayload) -> Result<BTreeMap<String, Value>> {
    let mut result = BTreeMap::new();
    for document in &payload.documents {
        for segment in &document.segments {
            for review in &segment.reviews {
                result.insert(review.id.clone(), serde_json::to_value(review)?);
            }
        }
    }
    Ok(result)
}

fn flatten_discussions(payload: &ProjectSnapshotPayload) -> Result<BTreeMap<String, Value>> {
    let mut result = BTreeMap::new();
    for discussion in &payload.discussions {
        result.insert(
            format!("thread:{}", discussion.thread.id),
            serde_json::to_value(&discussion.thread)?,
        );
        for message in &discussion.messages {
            result.insert(
                format!("message:{}", message.id),
                serde_json::to_value(message)?,
            );
        }
    }
    Ok(result)
}

fn flatten_mounts(payload: &ProjectSnapshotPayload) -> Result<BTreeMap<String, Value>> {
    let mut result = BTreeMap::new();
    for mount in &payload.tm_mounts {
        result.insert(
            format!("tm:{}", mount.library_id),
            serde_json::to_value(mount)?,
        );
    }
    for mount in &payload.termbase_mounts {
        result.insert(
            format!("term:{}", mount.termbase_id),
            serde_json::to_value(mount)?,
        );
    }
    Ok(result)
}

fn missing_dependencies(
    connection: &Connection,
    payload: &ProjectSnapshotPayload,
) -> Result<Vec<String>> {
    let mut missing = BTreeSet::new();
    for mount in &payload.tm_mounts {
        let exists = connection
            .query_row(
                "SELECT 1 FROM tm_libraries WHERE id = ?1",
                [&mount.library_id],
                |_| Ok(()),
            )
            .optional()?
            .is_some();
        if !exists {
            missing.insert(mount.library_id.clone());
        }
    }
    for mount in &payload.termbase_mounts {
        let exists = connection
            .query_row(
                "SELECT 1 FROM termbases WHERE id = ?1",
                [&mount.termbase_id],
                |_| Ok(()),
            )
            .optional()?
            .is_some();
        if !exists {
            missing.insert(mount.termbase_id.clone());
        }
    }
    Ok(missing.into_iter().collect())
}

fn find_snapshot(connection: &Connection, snapshot_id: &str) -> Result<StoredProjectSnapshot> {
    connection
        .query_row(
            "SELECT id, project_id, name, base_project_revision, state_hash,
                    document_count, segment_count, thread_count, created_at_ms, actor, reason,
                    payload_json
             FROM project_snapshots WHERE id = ?1",
            [snapshot_id],
            |row| {
                Ok(StoredProjectSnapshot {
                    metadata: row_to_snapshot_metadata(row)?,
                    payload_json: row.get(11)?,
                })
            },
        )
        .optional()?
        .ok_or_else(|| not_found("project_snapshot", snapshot_id))
}

fn row_to_snapshot_metadata(row: &Row<'_>) -> rusqlite::Result<NamedProjectSnapshotRecord> {
    Ok(NamedProjectSnapshotRecord {
        id: row.get(0)?,
        project_id: row.get(1)?,
        name: row.get(2)?,
        base_project_revision: read_u64(row, 3)?,
        state_hash: row.get(4)?,
        document_count: read_u32(row, 5)?,
        segment_count: read_u32(row, 6)?,
        thread_count: read_u32(row, 7)?,
        created_at_ms: row.get(8)?,
        actor: row.get(9)?,
        reason: row.get(10)?,
    })
}

fn find_preview(connection: &Connection, preview_id: &str) -> Result<ProjectSnapshotPreviewRecord> {
    let row = find_preview_row(connection, preview_id)?;
    Ok(row.into_record())
}

#[derive(Debug, Clone)]
struct StoredPreviewRow {
    preview_id: String,
    snapshot_id: String,
    project_id: String,
    expected_project_revision: u64,
    current_state_hash: String,
    status: ProjectSnapshotPreviewStatusRecord,
    summary: ProjectSnapshotChangeSummaryRecord,
    missing_dependency_ids: Vec<String>,
}

impl StoredPreviewRow {
    fn into_record(self) -> ProjectSnapshotPreviewRecord {
        ProjectSnapshotPreviewRecord {
            preview_id: self.preview_id,
            snapshot_id: self.snapshot_id,
            project_id: self.project_id,
            expected_project_revision: self.expected_project_revision,
            current_project_revision: self.expected_project_revision,
            current_state_hash: self.current_state_hash,
            status: self.status,
            summary: self.summary,
            missing_dependency_ids: self.missing_dependency_ids,
        }
    }
}

fn find_preview_row(connection: &Connection, preview_id: &str) -> Result<StoredPreviewRow> {
    connection
        .query_row(
            "SELECT id, snapshot_id, project_id, expected_project_revision,
                    current_state_hash, summary_json, missing_dependencies_json, status
             FROM project_snapshot_previews WHERE id = ?1",
            [preview_id],
            |row| {
                let status = match row.get::<_, String>(7)?.as_str() {
                    "open" => ProjectSnapshotPreviewStatusRecord::Open,
                    "applied" => ProjectSnapshotPreviewStatusRecord::Applied,
                    value => {
                        return Err(rusqlite::Error::FromSqlConversionFailure(
                            7,
                            rusqlite::types::Type::Text,
                            format!("invalid snapshot preview status {value}").into(),
                        ));
                    }
                };
                let summary = serde_json::from_str(&row.get::<_, String>(5)?).map_err(|error| {
                    rusqlite::Error::FromSqlConversionFailure(
                        5,
                        rusqlite::types::Type::Text,
                        Box::new(error),
                    )
                })?;
                let missing_dependency_ids = serde_json::from_str(&row.get::<_, String>(6)?)
                    .map_err(|error| {
                        rusqlite::Error::FromSqlConversionFailure(
                            6,
                            rusqlite::types::Type::Text,
                            Box::new(error),
                        )
                    })?;
                Ok(StoredPreviewRow {
                    preview_id: row.get(0)?,
                    snapshot_id: row.get(1)?,
                    project_id: row.get(2)?,
                    expected_project_revision: read_u64(row, 3)?,
                    current_state_hash: row.get(4)?,
                    status,
                    summary,
                    missing_dependency_ids,
                })
            },
        )
        .optional()?
        .ok_or_else(|| not_found("project_snapshot_preview", preview_id))
}

fn apply_project_snapshot(
    transaction: &Transaction<'_>,
    current_project: &Project,
    payload: &ProjectSnapshotPayload,
    next_project_revision: u64,
    now: i64,
) -> Result<()> {
    validate_snapshot_references(transaction, current_project, payload)?;
    let changed = transaction.execute(
        "UPDATE projects
         SET name = ?1, source_locale = ?2, target_locale = ?3, domain = ?4,
             lifecycle = ?5, configuration_json = ?6, revision = ?7,
             updated_at_ms = ?8, archived_at_ms = ?9
         WHERE id = ?10 AND revision = ?11",
        params![
            payload.project.name,
            payload.project.source_locale,
            payload.project.target_locale,
            payload.project.domain,
            project_lifecycle_text(payload.project.lifecycle),
            serde_json::to_string(&payload.project.configuration)?,
            to_i64(next_project_revision)?,
            now,
            payload.project.archived_at_ms,
            current_project.id,
            to_i64(current_project.revision)?,
        ],
    )?;
    if changed != 1 {
        return Err(StorageError::EntityConflict {
            entity: "project",
            id: current_project.id.clone(),
            expected_revision: current_project.revision,
            actual_revision: find_project(transaction, &current_project.id)?.revision,
        });
    }
    let desired_documents = payload
        .documents
        .iter()
        .map(|document| document.document.id.as_str())
        .collect::<BTreeSet<_>>();
    let mut current_document_ids = transaction
        .prepare("SELECT id FROM documents WHERE project_id = ?1")?
        .query_map([current_project.id.as_str()], |row| row.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    current_document_ids.sort();
    for document_id in current_document_ids {
        if !desired_documents.contains(document_id.as_str()) {
            let revision = find_document(transaction, &document_id)?.revision;
            transaction.execute(
                "UPDATE documents SET lifecycle = 'trash', revision = ?1, updated_at_ms = ?2
                 WHERE id = ?3",
                params![to_i64(next_revision(revision)?)?, now, document_id],
            )?;
        }
    }
    for document in &payload.documents {
        apply_snapshot_document(transaction, current_project, document, now)?;
    }
    restore_snapshot_discussions(transaction, current_project, payload)?;
    restore_snapshot_mounts(transaction, current_project, payload)?;
    rebuild_project_search(transaction, &current_project.id)?;
    Ok(())
}

fn validate_snapshot_references(
    transaction: &Transaction<'_>,
    project: &Project,
    payload: &ProjectSnapshotPayload,
) -> Result<()> {
    if payload.project.id != project.id {
        return Err(StorageError::InvalidData(
            "snapshot project identity does not match target project".to_string(),
        ));
    }
    for document in &payload.documents {
        if document.document.project_id != project.id {
            return Err(StorageError::InvalidData(
                "snapshot document belongs to another project".to_string(),
            ));
        }
        let version_ids = document
            .versions
            .iter()
            .map(|version| version.id.as_str())
            .collect::<BTreeSet<_>>();
        for segment in &document.segments {
            if segment.segment.document_id != document.document.id
                || !version_ids.contains(segment.document_version_id.as_str())
            {
                return Err(StorageError::InvalidData(
                    "snapshot segment references an invalid document version".to_string(),
                ));
            }
        }
    }
    for discussion in &payload.discussions {
        if discussion.thread.project_id != project.id {
            return Err(StorageError::InvalidData(
                "snapshot discussion belongs to another project".to_string(),
            ));
        }
        for message in &discussion.messages {
            if message.thread_id != discussion.thread.id {
                return Err(StorageError::InvalidData(
                    "snapshot message references another thread".to_string(),
                ));
            }
        }
    }
    missing_dependencies(transaction, payload)?
        .is_empty()
        .then_some(())
        .ok_or_else(|| StorageError::InvalidState("snapshot has missing dependencies".to_string()))
}

fn apply_snapshot_document(
    transaction: &Transaction<'_>,
    project: &Project,
    desired: &ProjectSnapshotDocument,
    now: i64,
) -> Result<()> {
    let current = transaction
        .query_row(
            "SELECT id, project_id, name, relative_path, format, filter_id, source_sha256,
                    current_version, status, revision, segment_count, degradation_json,
                    imported_at_ms, updated_at_ms
             FROM documents WHERE id = ?1",
            [desired.document.id.as_str()],
            row_to_document,
        )
        .optional()?;
    let document_revision = current
        .as_ref()
        .map(|document| {
            if document.project_id != project.id {
                return Err(StorageError::InvalidState(
                    "snapshot document id belongs to another project".to_string(),
                ));
            }
            let changed = document != &desired.document;
            if changed {
                next_revision(document.revision)
            } else {
                Ok(document.revision)
            }
        })
        .transpose()?
        .unwrap_or(desired.document.revision);
    if current.is_some() {
        transaction.execute(
            "UPDATE documents SET name = ?1, relative_path = ?2, format = ?3,
                    filter_id = ?4, source_sha256 = ?5, current_version = ?6,
                    status = ?7, revision = ?8, segment_count = ?9,
                    degradation_json = ?10, updated_at_ms = ?11, lifecycle = 'active',
                    original_source_path = ?12, managed_source_path = ?13
             WHERE id = ?14",
            params![
                desired.document.name,
                desired.document.relative_path,
                desired.document.format,
                desired.document.filter_id,
                desired.document.source_sha256,
                i64::from(desired.document.current_version),
                document_status_text(desired.document.status),
                to_i64(document_revision)?,
                i64::from(desired.document.segment_count),
                serde_json::to_string(&desired.document.degradation)?,
                now,
                desired.original_source_path,
                desired.managed_source_path,
                desired.document.id,
            ],
        )?;
    } else {
        transaction.execute(
            "INSERT INTO documents (
                id, project_id, name, relative_path, format, filter_id, source_sha256,
                current_version, status, revision, segment_count, degradation_json,
                imported_at_ms, updated_at_ms, lifecycle, original_source_path,
                managed_source_path
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12,
                       ?13, ?14, 'active', ?15, ?16)",
            params![
                desired.document.id,
                project.id,
                desired.document.name,
                desired.document.relative_path,
                desired.document.format,
                desired.document.filter_id,
                desired.document.source_sha256,
                i64::from(desired.document.current_version),
                document_status_text(desired.document.status),
                to_i64(desired.document.revision)?,
                i64::from(desired.document.segment_count),
                serde_json::to_string(&desired.document.degradation)?,
                desired.document.imported_at_ms,
                now,
                desired.original_source_path,
                desired.managed_source_path,
            ],
        )?;
    }
    for version in &desired.versions {
        let existing = transaction
            .query_row(
                "SELECT id FROM document_versions WHERE document_id = ?1 AND version = ?2",
                params![version.document_id, i64::from(version.version)],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        if let Some(existing_id) = existing {
            if existing_id != version.id {
                return Err(StorageError::InvalidState(
                    "snapshot document version identity conflicts with current data".to_string(),
                ));
            }
            transaction.execute(
                "UPDATE document_versions SET source_sha256 = ?1, original_source_path = ?2,
                        managed_source_path = ?3, reason = ?4, created_at_ms = ?5
                 WHERE id = ?6",
                params![
                    version.source_sha256,
                    version.original_source_path,
                    version.managed_source_path,
                    version.reason,
                    version.created_at_ms,
                    version.id,
                ],
            )?;
        } else {
            transaction.execute(
                "INSERT INTO document_versions (
                    id, document_id, version, source_sha256, original_source_path,
                    managed_source_path, reason, created_at_ms
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![
                    version.id,
                    desired.document.id,
                    i64::from(version.version),
                    version.source_sha256,
                    version.original_source_path,
                    version.managed_source_path,
                    version.reason,
                    version.created_at_ms,
                ],
            )?;
        }
    }
    let desired_ids = desired
        .segments
        .iter()
        .map(|segment| segment.segment.id.as_str())
        .collect::<BTreeSet<_>>();
    let existing_ids = transaction
        .prepare("SELECT id FROM segments WHERE document_id = ?1")?
        .query_map([desired.document.id.as_str()], |row| {
            row.get::<_, String>(0)
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    for (index, segment_id) in existing_ids.iter().enumerate() {
        transaction.execute(
            "UPDATE segments SET ordinal = ?1, structural_path = ?2 WHERE id = ?3",
            params![
                1_000_000_000_i64
                    .checked_add(i64::try_from(index).map_err(|_| {
                        StorageError::InvalidData("snapshot segment index overflow".to_string())
                    })?)
                    .ok_or_else(|| StorageError::InvalidData(
                        "snapshot segment ordinal overflow".to_string()
                    ))?,
                format!("__snapshot_restore__/{}", segment_id),
                segment_id,
            ],
        )?;
    }
    for segment_id in existing_ids {
        if !desired_ids.contains(segment_id.as_str()) {
            let referenced: i64 = transaction.query_row(
                "SELECT (
                    (SELECT COUNT(*) FROM tm_units WHERE origin_segment_id = ?1)
                    + (SELECT COUNT(*) FROM tm_entries WHERE origin_segment_id = ?1)
                )",
                [&segment_id],
                |row| row.get(0),
            )?;
            if referenced > 0 {
                return Err(StorageError::InvalidState(
                    "snapshot restore would remove a segment referenced by shared assets"
                        .to_string(),
                ));
            }
            transaction.execute("DELETE FROM segments WHERE id = ?1", [&segment_id])?;
        }
    }
    for segment in &desired.segments {
        apply_snapshot_segment(transaction, desired.document.id.as_str(), segment, now)?;
    }
    Ok(())
}

fn apply_snapshot_segment(
    transaction: &Transaction<'_>,
    document_id: &str,
    desired: &ProjectSnapshotSegment,
    now: i64,
) -> Result<()> {
    let existing = transaction
        .query_row(
            "SELECT id, document_id, ordinal, structural_path, source_text, target_text,
                    state, revision, source_hash, context_hash, updated_at_ms
             FROM segments WHERE id = ?1",
            [desired.segment.id.as_str()],
            row_to_segment,
        )
        .optional()?;
    if let Some(current) = &existing
        && current.document_id != document_id
    {
        return Err(StorageError::InvalidState(
            "snapshot segment id belongs to another document".to_string(),
        ));
    }
    if existing.is_some() {
        transaction.execute(
            "UPDATE segments SET ordinal = ?1, structural_path = ?2, source_text = ?3,
                    target_text = ?4, state = ?5, revision = ?6, source_hash = ?7,
                    context_hash = ?8, updated_at_ms = ?9, document_version_id = ?10,
                    source_version = ?11 WHERE id = ?12",
            params![
                i64::from(desired.segment.ordinal),
                desired.segment.structural_path,
                desired.segment.source_text,
                desired.segment.target_text,
                segment_state_text(desired.segment.state),
                to_i64(desired.segment.revision)?,
                desired.segment.source_hash,
                desired.segment.context_hash,
                now,
                desired.document_version_id,
                i64::from(desired.source_version),
                desired.segment.id,
            ],
        )?;
    } else {
        transaction.execute(
            "INSERT INTO segments (
                id, document_id, ordinal, structural_path, source_text, target_text,
                state, revision, source_hash, context_hash, updated_at_ms,
                document_version_id, source_version
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
            params![
                desired.segment.id,
                document_id,
                i64::from(desired.segment.ordinal),
                desired.segment.structural_path,
                desired.segment.source_text,
                desired.segment.target_text,
                segment_state_text(desired.segment.state),
                to_i64(desired.segment.revision)?,
                desired.segment.source_hash,
                desired.segment.context_hash,
                now,
                desired.document_version_id,
                i64::from(desired.source_version),
            ],
        )?;
    }
    transaction.execute(
        "DELETE FROM inline_tags WHERE segment_id = ?1",
        [desired.segment.id.as_str()],
    )?;
    for tag in desired.source_tags.iter().chain(desired.target_tags.iter()) {
        transaction.execute(
            "INSERT INTO inline_tags (
                id, segment_id, side, position, kind, pair_id, payload, display_text, protected
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                tag.id,
                desired.segment.id,
                tag_side_text(tag.side),
                i64::from(tag.position),
                tag_kind_text(tag.kind),
                tag.pair_id,
                tag.payload,
                tag.display_text,
                tag.protected,
            ],
        )?;
    }
    transaction.execute(
        "DELETE FROM segment_notes WHERE segment_id = ?1",
        [desired.segment.id.as_str()],
    )?;
    for note in &desired.notes {
        transaction.execute(
            "INSERT INTO segment_notes (segment_id, id, text, author) VALUES (?1, ?2, ?3, ?4)",
            params![desired.segment.id, note.id, note.text, note.author],
        )?;
    }
    transaction.execute(
        "DELETE FROM segment_comments WHERE segment_id = ?1",
        [desired.segment.id.as_str()],
    )?;
    for comment in &desired.comments {
        transaction.execute(
            "INSERT INTO segment_comments (
                id, segment_id, author, text, created_at_ms, updated_at_ms,
                revision, resolved, immutable
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                comment.id,
                desired.segment.id,
                comment.author,
                comment.text,
                comment.created_at_ms,
                comment.updated_at_ms,
                to_i64(comment.revision)?,
                comment.resolved,
                comment.immutable,
            ],
        )?;
    }
    transaction.execute(
        "DELETE FROM review_revisions WHERE segment_id = ?1",
        [desired.segment.id.as_str()],
    )?;
    for review in &desired.reviews {
        transaction.execute(
            "INSERT INTO review_revisions (
                id, segment_id, base_revision, before_target, proposed_target,
                author, reason, status, created_at_ms, updated_at_ms,
                before_source, proposed_source, before_target_tags_json,
                proposed_target_tags_json
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10,
                       ?11, ?12, ?13, ?14)",
            params![
                review.id,
                desired.segment.id,
                to_i64(review.base_revision)?,
                review.before_target,
                review.proposed_target,
                review.author,
                review.reason,
                review_status_text(review.status),
                review.created_at_ms,
                review.updated_at_ms,
                review.before_source,
                review.proposed_source,
                serde_json::to_string(&review.before_target_tags)?,
                review
                    .proposed_target_tags
                    .as_ref()
                    .map(serde_json::to_string)
                    .transpose()?,
            ],
        )?;
    }
    transaction.execute(
        "UPDATE segment_editor_meta SET workflow_state = ?1, lineage_id = ?2,
                source_edit_revision = ?3, updated_at_ms = ?4 WHERE segment_id = ?5",
        params![
            editor_workflow_state_text(desired.workflow_state),
            desired.lineage_id,
            to_i64(desired.source_edit_revision)?,
            now,
            desired.segment.id,
        ],
    )?;
    Ok(())
}

fn restore_snapshot_discussions(
    transaction: &Transaction<'_>,
    project: &Project,
    payload: &ProjectSnapshotPayload,
) -> Result<()> {
    let desired_ids = payload
        .discussions
        .iter()
        .map(|discussion| discussion.thread.id.as_str())
        .collect::<BTreeSet<_>>();
    let existing_ids = transaction
        .prepare("SELECT id FROM discussion_threads WHERE project_id = ?1")?
        .query_map([project.id.as_str()], |row| row.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    for id in existing_ids {
        if !desired_ids.contains(id.as_str()) {
            transaction.execute("DELETE FROM discussion_threads WHERE id = ?1", [&id])?;
        }
    }
    for discussion in &payload.discussions {
        let thread = &discussion.thread;
        let existing = transaction
            .query_row(
                "SELECT t.id, t.project_id, t.scope, t.document_id, t.segment_id,
                        t.title, t.status, t.revision,
                        (SELECT COUNT(*) FROM discussion_messages m
                         WHERE m.thread_id = t.id AND m.deleted = 0),
                        t.created_at_ms, t.updated_at_ms, t.resolved_at_ms, t.resolved_by
                 FROM discussion_threads t WHERE t.id = ?1",
                [thread.id.as_str()],
                row_to_discussion_thread,
            )
            .optional()?;
        if let Some(current) = &existing {
            if current.project_id != project.id {
                return Err(StorageError::InvalidState(
                    "snapshot discussion id belongs to another project".to_string(),
                ));
            }
            transaction.execute(
                "UPDATE discussion_threads SET scope = ?1, document_id = ?2,
                        segment_id = ?3, title = ?4, status = ?5, revision = ?6,
                        created_at_ms = ?7, updated_at_ms = ?8, resolved_at_ms = ?9,
                        resolved_by = ?10 WHERE id = ?11",
                params![
                    discussion_scope_text(thread.scope),
                    thread.document_id,
                    thread.segment_id,
                    thread.title,
                    discussion_status_text(thread.status),
                    to_i64(thread.revision)?,
                    thread.created_at_ms,
                    thread.updated_at_ms,
                    thread.resolved_at_ms,
                    thread.resolved_by,
                    thread.id,
                ],
            )?;
        } else {
            transaction.execute(
                "INSERT INTO discussion_threads (
                    id, project_id, scope, document_id, segment_id, title, status,
                    revision, created_at_ms, updated_at_ms, resolved_at_ms, resolved_by
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
                params![
                    thread.id,
                    project.id,
                    discussion_scope_text(thread.scope),
                    thread.document_id,
                    thread.segment_id,
                    thread.title,
                    discussion_status_text(thread.status),
                    to_i64(thread.revision)?,
                    thread.created_at_ms,
                    thread.updated_at_ms,
                    thread.resolved_at_ms,
                    thread.resolved_by,
                ],
            )?;
        }
        let desired_message_ids = discussion
            .messages
            .iter()
            .map(|message| message.id.as_str())
            .collect::<BTreeSet<_>>();
        let existing_message_ids = transaction
            .prepare("SELECT id FROM discussion_messages WHERE thread_id = ?1")?
            .query_map([thread.id.as_str()], |row| row.get::<_, String>(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        for (index, id) in existing_message_ids.iter().enumerate() {
            transaction.execute(
                "UPDATE discussion_messages SET ordinal = ?1 WHERE id = ?2",
                params![
                    1_000_000_000_i64
                        .checked_add(i64::try_from(index).map_err(|_| {
                            StorageError::InvalidData("snapshot message index overflow".to_string())
                        })?)
                        .ok_or_else(|| StorageError::InvalidData(
                            "snapshot message ordinal overflow".to_string()
                        ))?,
                    id,
                ],
            )?;
        }
        for id in existing_message_ids {
            if !desired_message_ids.contains(id.as_str()) {
                transaction.execute("DELETE FROM discussion_messages WHERE id = ?1", [&id])?;
            }
        }
        for message in &discussion.messages {
            let existing = transaction
                .query_row(
                    "SELECT m.id, m.thread_id, m.ordinal, m.actor, m.body,
                            m.mentions_json, m.revision, t.revision, m.deleted,
                            m.created_at_ms, m.updated_at_ms
                     FROM discussion_messages m
                     JOIN discussion_threads t ON t.id = m.thread_id
                     WHERE m.id = ?1",
                    [message.id.as_str()],
                    row_to_discussion_message,
                )
                .optional()?;
            if let Some(current) = &existing {
                if current.thread_id != thread.id {
                    return Err(StorageError::InvalidState(
                        "snapshot message id belongs to another thread".to_string(),
                    ));
                }
                transaction.execute(
                    "UPDATE discussion_messages SET ordinal = ?1, actor = ?2, body = ?3,
                            mentions_json = ?4, revision = ?5, deleted = ?6,
                            created_at_ms = ?7, updated_at_ms = ?8 WHERE id = ?9",
                    params![
                        i64::from(message.ordinal),
                        message.actor,
                        message.body,
                        serde_json::to_string(&message.mentions)?,
                        to_i64(message.revision)?,
                        message.deleted,
                        message.created_at_ms,
                        message.updated_at_ms,
                        message.id,
                    ],
                )?;
            } else {
                transaction.execute(
                    "INSERT INTO discussion_messages (
                        id, thread_id, ordinal, actor, body, mentions_json, revision,
                        deleted, created_at_ms, updated_at_ms
                     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                    params![
                        message.id,
                        thread.id,
                        i64::from(message.ordinal),
                        message.actor,
                        message.body,
                        serde_json::to_string(&message.mentions)?,
                        to_i64(message.revision)?,
                        message.deleted,
                        message.created_at_ms,
                        message.updated_at_ms,
                    ],
                )?;
            }
        }
    }
    Ok(())
}

fn restore_snapshot_mounts(
    transaction: &Transaction<'_>,
    project: &Project,
    payload: &ProjectSnapshotPayload,
) -> Result<()> {
    let desired_tm = payload
        .tm_mounts
        .iter()
        .map(|mount| mount.library_id.as_str())
        .collect::<BTreeSet<_>>();
    let current_tm = transaction
        .prepare("SELECT library_id FROM tm_library_mounts WHERE project_id = ?1")?
        .query_map([project.id.as_str()], |row| row.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    for library_id in current_tm {
        if !desired_tm.contains(library_id.as_str()) {
            transaction.execute(
                "DELETE FROM tm_library_mounts WHERE project_id = ?1 AND library_id = ?2",
                params![project.id, library_id],
            )?;
        }
    }
    for mount in &payload.tm_mounts {
        transaction.execute(
            "INSERT INTO tm_library_mounts (
                project_id, library_id, mode, priority, enabled, revision,
                created_at_ms, updated_at_ms
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
             ON CONFLICT(project_id, library_id) DO UPDATE SET
                mode = excluded.mode, priority = excluded.priority, enabled = excluded.enabled,
                revision = excluded.revision, created_at_ms = excluded.created_at_ms,
                updated_at_ms = excluded.updated_at_ms",
            params![
                project.id,
                mount.library_id,
                asset_mount_mode_text(mount.mode),
                i64::from(mount.priority),
                mount.enabled,
                to_i64(mount.revision)?,
                mount.created_at_ms,
                mount.updated_at_ms,
            ],
        )?;
    }
    let desired_terms = payload
        .termbase_mounts
        .iter()
        .map(|mount| mount.termbase_id.as_str())
        .collect::<BTreeSet<_>>();
    let current_terms = transaction
        .prepare("SELECT termbase_id FROM termbase_mounts WHERE project_id = ?1")?
        .query_map([project.id.as_str()], |row| row.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    for termbase_id in current_terms {
        if !desired_terms.contains(termbase_id.as_str()) {
            transaction.execute(
                "DELETE FROM termbase_mounts WHERE project_id = ?1 AND termbase_id = ?2",
                params![project.id, termbase_id],
            )?;
        }
    }
    for mount in &payload.termbase_mounts {
        transaction.execute(
            "INSERT INTO termbase_mounts (
                project_id, termbase_id, priority, writable, enabled, revision,
                created_at_ms, updated_at_ms
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
             ON CONFLICT(project_id, termbase_id) DO UPDATE SET
                priority = excluded.priority, writable = excluded.writable,
                enabled = excluded.enabled, revision = excluded.revision,
                created_at_ms = excluded.created_at_ms, updated_at_ms = excluded.updated_at_ms",
            params![
                project.id,
                mount.termbase_id,
                i64::from(mount.priority),
                mount.writable,
                mount.enabled,
                to_i64(mount.revision)?,
                mount.created_at_ms,
                mount.updated_at_ms,
            ],
        )?;
    }
    Ok(())
}

fn project_lifecycle_text(value: translunar_domain::ProjectLifecycle) -> &'static str {
    match value {
        translunar_domain::ProjectLifecycle::Active => "active",
        translunar_domain::ProjectLifecycle::Archived => "archived",
        translunar_domain::ProjectLifecycle::Trash => "trash",
    }
}

fn document_status_text(value: translunar_domain::DocumentStatus) -> &'static str {
    match value {
        translunar_domain::DocumentStatus::Active => "active",
        translunar_domain::DocumentStatus::Failed => "failed",
        translunar_domain::DocumentStatus::Superseded => "superseded",
    }
}

fn discussion_scope_text(value: super::discussion::DiscussionScope) -> &'static str {
    match value {
        super::discussion::DiscussionScope::Project => "project",
        super::discussion::DiscussionScope::Document => "document",
        super::discussion::DiscussionScope::Segment => "segment",
    }
}

fn discussion_status_text(value: super::discussion::DiscussionStatus) -> &'static str {
    match value {
        super::discussion::DiscussionStatus::Open => "open",
        super::discussion::DiscussionStatus::Resolved => "resolved",
    }
}

fn review_status_text(value: translunar_domain::ReviewStatus) -> &'static str {
    match value {
        translunar_domain::ReviewStatus::Pending => "pending",
        translunar_domain::ReviewStatus::Accepted => "accepted",
        translunar_domain::ReviewStatus::Rejected => "rejected",
    }
}

fn asset_mount_mode_text(value: AssetMountMode) -> &'static str {
    match value {
        AssetMountMode::Write => "write",
        AssetMountMode::Reference => "reference",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::{NewDocument, NewTmLibrary};
    use translunar_filter_core::ImportedUnit;

    fn seeded_store(temp: &tempfile::TempDir, name: &str) -> (Store, Project, Document, Segment) {
        let mut store = Store::open(temp.path()).expect("open snapshot store");
        let project = store
            .create_project(name, "en-US", "zh-CN", "general")
            .expect("create project");
        let document = NewDocument {
            id: translunar_domain::new_id(),
            project_id: project.id.clone(),
            name: "snapshot.txt".to_string(),
            relative_path: "snapshot.txt".to_string(),
            format: "txt".to_string(),
            filter_id: "builtin.txt".to_string(),
            source_sha256: "snapshot-source".to_string(),
            degradation: Vec::new(),
            original_source_path: temp.path().join("snapshot.txt"),
            managed_source_path: temp.path().join("sources/snapshot.txt"),
        };
        store
            .insert_document(&document, &[ImportedUnit::plain(0, "txt:0", "Hello")])
            .expect("insert document");
        let segment = store.all_segments(&document.id).expect("segments")[0].clone();
        let document = store
            .get_document(&document.id)
            .expect("get document")
            .document;
        (store, project, document, segment)
    }

    #[test]
    fn snapshot_create_preview_restore_is_restart_safe() {
        let temp = tempfile::tempdir().expect("snapshot temp directory");
        let (project_id, snapshot_id, segment_id);
        {
            let (mut store, project, _document, segment) = seeded_store(&temp, "Snapshots");
            project_id = project.id.clone();
            segment_id = segment.id.clone();
            let snapshot = store
                .create_project_snapshot(NewProjectSnapshot {
                    project_id: project.id.clone(),
                    name: "baseline".to_string(),
                    expected_project_revision: project.revision,
                    actor: "tester".to_string(),
                    reason: "baseline".to_string(),
                })
                .expect("create snapshot");
            snapshot_id = snapshot.id.clone();
            store
                .update_target(&segment_id, "Changed", segment.revision)
                .expect("change target");
            let current = store.get_project(&project.id).expect("project").project;
            let preview = store
                .preview_project_snapshot_restore(&snapshot_id, current.revision)
                .expect("preview restore");
            assert_eq!(preview.status, ProjectSnapshotPreviewStatusRecord::Open);
            assert_eq!(preview.summary.segments_changed, 1);
            let result = store
                .restore_project_snapshot(RestoreProjectSnapshot {
                    preview_id: preview.preview_id,
                    expected_project_revision: current.revision,
                    actor: "tester".to_string(),
                    reason: "restore baseline".to_string(),
                })
                .expect("restore snapshot");
            assert_eq!(result.status, ProjectSnapshotPreviewStatusRecord::Applied);
            assert_eq!(
                store
                    .get_segment(&segment_id)
                    .expect("restored segment")
                    .target_text,
                ""
            );
        }
        let store = Store::open(temp.path()).expect("reopen snapshot store");
        assert_eq!(
            store
                .get_project_snapshot(&snapshot_id)
                .expect("snapshot")
                .project_id,
            project_id
        );
        assert_eq!(
            store
                .get_segment(&segment_id)
                .expect("segment after restart")
                .target_text,
            ""
        );
    }

    #[test]
    fn stale_snapshot_preview_rejects_without_writes() {
        let temp = tempfile::tempdir().expect("stale snapshot temp directory");
        let (mut store, project, _document, segment) = seeded_store(&temp, "Stale snapshot");
        let snapshot = store
            .create_project_snapshot(NewProjectSnapshot {
                project_id: project.id.clone(),
                name: "baseline".to_string(),
                expected_project_revision: project.revision,
                actor: "tester".to_string(),
                reason: "capture baseline".to_string(),
            })
            .expect("create snapshot");
        let changed = store
            .update_target(&segment.id, "First change", segment.revision)
            .expect("first mutation");
        let preview = store
            .preview_project_snapshot_restore(&snapshot.id, project.revision)
            .expect("preview restore");
        let latest = store
            .update_target(&segment.id, "Second change", changed.revision)
            .expect("make preview stale");
        let error = store
            .restore_project_snapshot(RestoreProjectSnapshot {
                preview_id: preview.preview_id.clone(),
                expected_project_revision: project.revision,
                actor: "tester".to_string(),
                reason: "stale restore".to_string(),
            })
            .expect_err("stale preview must fail");
        assert!(matches!(error, StorageError::InvalidState(_)));
        assert_eq!(
            store.get_segment(&segment.id).expect("current segment"),
            latest
        );
        let status: String = store
            .connection
            .query_row(
                "SELECT status FROM project_snapshot_previews WHERE id = ?1",
                [preview.preview_id],
                |row| row.get(0),
            )
            .expect("preview status");
        assert_eq!(status, "open");
        let (history, _) = store
            .list_operations(&project.id, 0, 100, false)
            .expect("history");
        assert!(
            history
                .iter()
                .all(|operation| operation.kind != "project.snapshot.restore")
        );
    }

    #[test]
    fn duplicate_snapshot_and_missing_mount_are_rejected() {
        let temp = tempfile::tempdir().expect("missing mount temp directory");
        let (mut store, project, _document, _segment) = seeded_store(&temp, "Missing mount");
        let external = store
            .create_tm_library(NewTmLibrary {
                name: "External TM".to_string(),
                source_locale: "en-US".to_string(),
                target_locale: "zh-CN".to_string(),
                domain: None,
                writable: false,
                owner_project_id: None,
            })
            .expect("create external TM");
        store
            .mount_tm_library(
                &project.id,
                &external.id,
                AssetMountMode::Reference,
                20,
                true,
                None,
            )
            .expect("mount external TM");
        let snapshot = store
            .create_project_snapshot(NewProjectSnapshot {
                project_id: project.id.clone(),
                name: "mounted".to_string(),
                expected_project_revision: project.revision,
                actor: "tester".to_string(),
                reason: "capture mount".to_string(),
            })
            .expect("create mounted snapshot");
        let duplicate = store
            .create_project_snapshot(NewProjectSnapshot {
                project_id: project.id.clone(),
                name: "mounted".to_string(),
                expected_project_revision: project.revision,
                actor: "tester".to_string(),
                reason: "duplicate".to_string(),
            })
            .expect_err("duplicate snapshot name must fail");
        assert!(matches!(duplicate, StorageError::InvalidState(_)));
        store
            .connection
            .execute("DELETE FROM tm_libraries WHERE id = ?1", [&external.id])
            .expect("remove dependency");
        let preview = store
            .preview_project_snapshot_restore(&snapshot.id, project.revision)
            .expect("preview missing dependency");
        assert_eq!(preview.missing_dependency_ids, vec![external.id]);
        let error = store
            .restore_project_snapshot(RestoreProjectSnapshot {
                preview_id: preview.preview_id.clone(),
                expected_project_revision: project.revision,
                actor: "tester".to_string(),
                reason: "missing dependency".to_string(),
            })
            .expect_err("missing dependency restore must fail");
        assert!(matches!(error, StorageError::InvalidState(_)));
        let status: String = store
            .connection
            .query_row(
                "SELECT status FROM project_snapshot_previews WHERE id = ?1",
                [preview.preview_id],
                |row| row.get(0),
            )
            .expect("preview status");
        assert_eq!(status, "open");
    }

    #[test]
    fn injected_restore_failure_rolls_back_and_preview_remains_retryable() {
        let temp = tempfile::tempdir().expect("rollback snapshot temp directory");
        let (mut store, project, _document, segment) = seeded_store(&temp, "Rollback snapshot");
        let snapshot = store
            .create_project_snapshot(NewProjectSnapshot {
                project_id: project.id.clone(),
                name: "baseline".to_string(),
                expected_project_revision: project.revision,
                actor: "tester".to_string(),
                reason: "capture baseline".to_string(),
            })
            .expect("create snapshot");
        let changed = store
            .update_target(&segment.id, "Changed", segment.revision)
            .expect("change target");
        let preview = store
            .preview_project_snapshot_restore(&snapshot.id, project.revision)
            .expect("preview restore");
        store
            .connection
            .execute_batch(
                "CREATE TEMP TRIGGER fail_snapshot_mount
                 BEFORE UPDATE ON tm_library_mounts
                 BEGIN SELECT RAISE(ABORT, 'injected snapshot restore failure'); END;",
            )
            .expect("install failure trigger");
        let error = store
            .restore_project_snapshot(RestoreProjectSnapshot {
                preview_id: preview.preview_id.clone(),
                expected_project_revision: project.revision,
                actor: "tester".to_string(),
                reason: "exercise rollback".to_string(),
            })
            .expect_err("injected restore must fail");
        assert!(matches!(error, StorageError::Database(_)));
        assert_eq!(
            store
                .get_segment(&segment.id)
                .expect("segment after rollback"),
            changed
        );
        assert_eq!(
            store
                .get_project(&project.id)
                .expect("project after rollback")
                .project
                .revision,
            project.revision
        );
        let status: String = store
            .connection
            .query_row(
                "SELECT status FROM project_snapshot_previews WHERE id = ?1",
                [&preview.preview_id],
                |row| row.get(0),
            )
            .expect("preview status");
        assert_eq!(status, "open");
        store
            .connection
            .execute_batch("DROP TRIGGER fail_snapshot_mount;")
            .expect("remove failure trigger");
        let retried = store
            .restore_project_snapshot(RestoreProjectSnapshot {
                preview_id: preview.preview_id,
                expected_project_revision: project.revision,
                actor: "tester".to_string(),
                reason: "retry restore".to_string(),
            })
            .expect("retry restore");
        assert_eq!(retried.status, ProjectSnapshotPreviewStatusRecord::Applied);
        assert_eq!(
            store
                .get_segment(&segment.id)
                .expect("restored segment")
                .target_text,
            ""
        );
    }
}

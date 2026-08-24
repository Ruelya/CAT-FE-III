//! Durable storage for offline `.tltask` packages.
//!
//! The package codec lives in Engine, while this module owns the authoritative
//! project snapshots, detached bindings, durable previews, and atomic merge.
//! Package JSON is treated as a transport projection; all writes still go
//! through the regular segment/editor/TM/QA tables.

use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

use rusqlite::{OptionalExtension, Transaction, TransactionBehavior, params};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use translunar_domain::{
    Document, DocumentNote, EditorWorkflowState, InlineTag, Project, ProjectConfiguration, Segment,
    SegmentState, TagSide, TaskPackageProjectReference, new_id,
};
use translunar_filter_core::ImportedUnit;
use translunar_task_package_core::{
    TaskPackageClassification, TaskPackageDisposition, TaskPackageDocumentPayload,
    TaskPackageError, TaskPackageKind, TaskPackageManifest, TaskPackageProjection,
    TaskPackageReturnPayload, TaskPackageReturnRow, canonical_json, canonical_sha256,
    classify_three_way, sha256_hex,
};

use super::*;

const MAX_PACKAGE_ACTOR_BYTES: usize = 256;
const MAX_PACKAGE_REASON_BYTES: usize = 4_096;
const MAX_PACKAGE_ROWS: usize = 100_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TaskPackageRecordStatus {
    Staged,
    Imported,
    Open,
    Applied,
    Discarded,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TaskPackagePreviewStatus {
    Open,
    Applied,
    Discarded,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskPackageRecord {
    pub id: String,
    pub kind: TaskPackageKind,
    pub origin_project_id: String,
    pub working_project_id: Option<String>,
    pub parent_package_id: Option<String>,
    pub base_project_revision: u64,
    pub manifest: TaskPackageManifest,
    pub staged_path: String,
    pub status: TaskPackageRecordStatus,
    pub actor: String,
    pub reason: String,
    pub request_digest: Option<String>,
    pub result_json: Option<String>,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
    pub applied_at_ms: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskPackageBindingRecord {
    pub id: String,
    pub package_id: String,
    pub local_project_id: Option<String>,
    pub local_document_id: Option<String>,
    pub local_segment_id: Option<String>,
    pub origin_project_id: String,
    pub origin_document_id: String,
    pub origin_segment_id: String,
    pub base_document_revision: u64,
    pub base_segment_revision: u64,
    pub base_source_hash: String,
    pub base_projection: TaskPackageProjection,
    pub source_entry: String,
    pub tag_id_map: BTreeMap<String, String>,
    pub comment_id_map: BTreeMap<String, String>,
    pub created_at_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TaskPackagePreviewCounts {
    pub total: u32,
    pub unchanged: u32,
    pub remote_changed: u32,
    pub local_changed: u32,
    pub both_changed: u32,
    pub deleted: u32,
    pub added: u32,
    pub tag_invalid: u32,
    pub missing_dependency: u32,
    #[serde(default)]
    pub document_revisions: BTreeMap<String, u64>,
}

impl TaskPackagePreviewCounts {
    fn add(&mut self, disposition: TaskPackageDisposition) -> Result<()> {
        self.total = self
            .total
            .checked_add(1)
            .ok_or_else(|| StorageError::InvalidData("task package count overflow".to_string()))?;
        let slot = match disposition {
            TaskPackageDisposition::Unchanged => &mut self.unchanged,
            TaskPackageDisposition::RemoteChanged => &mut self.remote_changed,
            TaskPackageDisposition::LocalChanged => &mut self.local_changed,
            TaskPackageDisposition::BothChanged => &mut self.both_changed,
            TaskPackageDisposition::Deleted => &mut self.deleted,
            TaskPackageDisposition::Added => &mut self.added,
            TaskPackageDisposition::TagInvalid => &mut self.tag_invalid,
            TaskPackageDisposition::MissingDependency => &mut self.missing_dependency,
        };
        *slot = slot
            .checked_add(1)
            .ok_or_else(|| StorageError::InvalidData("task package count overflow".to_string()))?;
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskPackageDiagnostic {
    pub code: String,
    pub message: String,
    #[serde(default)]
    pub row_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskPackagePreviewRecord {
    pub id: String,
    pub package_id: String,
    pub kind: TaskPackageKind,
    pub origin_project_id: String,
    pub expected_project_revision: u64,
    pub status: TaskPackagePreviewStatus,
    pub counts: TaskPackagePreviewCounts,
    pub diagnostics: Vec<TaskPackageDiagnostic>,
    pub staged_path: String,
    pub request_digest: Option<String>,
    pub result_json: Option<String>,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
    pub applied_at_ms: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskPackagePreviewRowRecord {
    pub preview_id: String,
    pub row_id: String,
    pub ordinal: u32,
    pub origin_document_id: String,
    pub origin_segment_id: String,
    pub disposition: TaskPackageDisposition,
    pub reason: String,
    pub safe_to_apply: bool,
    pub identical_change: bool,
    pub selected: bool,
    pub base_hash: Option<String>,
    pub current_hash: Option<String>,
    pub remote_hash: Option<String>,
    pub current_revision: Option<u64>,
    pub remote_revision: Option<u64>,
    pub base_projection: Option<TaskPackageProjection>,
    pub current_projection: Option<TaskPackageProjection>,
    pub remote_projection: Option<TaskPackageProjection>,
    pub diagnostic_code: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskPackageAssignmentSelection {
    pub document_id: String,
    #[serde(default)]
    pub segment_ids: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskPackageDocumentSnapshot {
    pub document: Document,
    pub managed_source_path: String,
    pub projections: Vec<TaskPackageProjection>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskPackageAssignmentSnapshot {
    pub project: Project,
    pub documents: Vec<TaskPackageDocumentSnapshot>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskPackageReturnSnapshot {
    pub parent_package_id: String,
    pub origin_project_id: String,
    pub origin_project_name: String,
    pub source_locale: String,
    pub target_locale: String,
    pub base_project_revision: u64,
    pub working_project_id: String,
    pub documents: Vec<TaskPackageReturnPayload>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskPackageExportRecord {
    pub manifest: TaskPackageManifest,
    pub working_project_id: Option<String>,
    pub staged_path: String,
    pub actor: String,
    pub reason: String,
    #[serde(default)]
    pub base_projections: Vec<TaskPackageProjection>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskPackageDocumentImport {
    pub local_document_id: String,
    pub origin_document_id: String,
    pub name: String,
    pub relative_path: String,
    pub format: String,
    pub filter_id: String,
    pub source_sha256: String,
    pub original_source_path: String,
    pub managed_source_path: String,
    pub source_entry: String,
    pub projections: Vec<TaskPackageProjection>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskPackageAssignmentImport {
    pub preview_id: String,
    pub local_project_id: String,
    pub project_name: String,
    pub domain: String,
    #[serde(default)]
    pub instructions: String,
    pub documents: Vec<TaskPackageDocumentImport>,
    #[serde(default)]
    pub asset_slices: Vec<translunar_task_package_core::TaskPackageAssetSlicePayload>,
    pub actor: String,
    pub reason: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskPackageReturnPreview {
    pub id: String,
    pub package: TaskPackageExportRecord,
    pub staged_path: String,
    pub documents: Vec<TaskPackageReturnPayload>,
    #[serde(default)]
    pub diagnostics: Vec<TaskPackageDiagnostic>,
    pub actor: String,
    pub reason: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskPackageAssignmentPreview {
    pub id: String,
    pub package: TaskPackageExportRecord,
    pub staged_path: String,
    pub documents: Vec<TaskPackageDocumentPayload>,
    #[serde(default)]
    pub diagnostics: Vec<TaskPackageDiagnostic>,
    pub actor: String,
    pub reason: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskPackageImportResult {
    pub package_id: String,
    pub preview_id: String,
    pub project: Project,
    pub documents: Vec<Document>,
    pub binding_count: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskPackageApply {
    pub preview_id: String,
    pub expected_project_revision: u64,
    pub selected_row_ids: Vec<String>,
    pub actor: String,
    pub reason: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskPackageApplyResult {
    pub preview_id: String,
    pub status: String,
    pub selected_count: u32,
    pub applied_count: u32,
    pub skipped_count: u32,
    pub project_revision: u64,
    pub document_revisions: BTreeMap<String, u64>,
    pub segment_ids: Vec<String>,
    pub operation_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskPackageDiscardResult {
    pub package_id: String,
    pub preview_id: Option<String>,
    pub status: String,
    pub removed_staged_file: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct StoredTaskPackageMetadata {
    #[serde(default)]
    base_projections: Vec<TaskPackageProjection>,
    #[serde(default)]
    terminal_result: Option<Value>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct TagProjection {
    source: Vec<InlineTag>,
    target: Vec<InlineTag>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct CommentProjection {
    id: String,
    author: String,
    text: String,
    resolved: bool,
    immutable: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct TaskPackageApplyFingerprint<'a> {
    preview_id: &'a str,
    expected_project_revision: u64,
    selected_row_ids: Vec<&'a str>,
    actor: &'a str,
    reason: &'a str,
}

#[derive(Debug, Clone)]
struct ValidatedApplyRow {
    current: Segment,
    remote: TaskPackageProjection,
}

impl Store {
    /// Return an authoritative assignment snapshot. This is read-only and is
    /// intentionally separate from package publication so a caller can stage
    /// and hash bytes before recording the export.
    pub fn snapshot_task_package_assignment(
        &self,
        project_id: &str,
        expected_project_revision: u64,
        selections: &[TaskPackageAssignmentSelection],
    ) -> Result<TaskPackageAssignmentSnapshot> {
        let project = find_project(&self.connection, project_id)?;
        ensure_entity_revision(
            "project",
            project_id,
            project.revision,
            expected_project_revision,
        )?;
        if selections.is_empty() || selections.len() > translunar_task_package_core::MAX_DOCUMENTS {
            return Err(StorageError::InvalidState(
                "task package assignment must select 1..50 documents".to_string(),
            ));
        }
        let mut seen_documents = BTreeSet::new();
        let mut documents = Vec::with_capacity(selections.len());
        for selection in selections {
            require_nonempty("assignment document id", &selection.document_id)?;
            if !seen_documents.insert(selection.document_id.clone()) {
                return Err(StorageError::InvalidState(
                    "assignment contains duplicate document identities".to_string(),
                ));
            }
            let managed = self.get_document(&selection.document_id)?;
            if managed.document.project_id != project_id
                || managed.document.status != translunar_domain::DocumentStatus::Active
            {
                return Err(StorageError::InvalidState(
                    "assignment document is not an active member of the project".to_string(),
                ));
            }
            let all_segments = self.all_segments(&selection.document_id)?;
            let selected = select_segments(&all_segments, &selection.segment_ids)?;
            let projections = selected
                .into_iter()
                .map(|segment| {
                    projection_for_segment(
                        &self.connection,
                        &segment,
                        &segment.document_id,
                        &segment.id,
                        segment.revision,
                        None,
                        None,
                    )
                })
                .collect::<Result<Vec<_>>>()?;
            documents.push(TaskPackageDocumentSnapshot {
                document: managed.document,
                managed_source_path: path_text(&managed.managed_source_path),
                projections,
            });
        }
        documents.sort_by(|left, right| left.document.id.cmp(&right.document.id));
        Ok(TaskPackageAssignmentSnapshot { project, documents })
    }

    /// Return changed rows from a detached assignment. Bindings are the only
    /// trusted origin identity; local IDs are never placed in the return wire
    /// projection.
    pub fn snapshot_task_package_return(
        &self,
        working_project_id: &str,
        parent_package_id: &str,
    ) -> Result<TaskPackageReturnSnapshot> {
        let working_project = find_project(&self.connection, working_project_id)?;
        let parent = find_task_package(&self.connection, parent_package_id)?;
        if parent.kind != TaskPackageKind::Assignment
            || parent.working_project_id.as_deref() != Some(working_project_id)
        {
            return Err(StorageError::InvalidState(
                "task package binding does not belong to the working project".to_string(),
            ));
        }
        let metadata = decode_task_package_metadata(parent.result_json.as_deref())?;
        if metadata.base_projections.is_empty() {
            return Err(StorageError::InvalidData(
                "assignment package has no durable base projections".to_string(),
            ));
        }
        let manifest = &parent.manifest;
        let mut by_document = BTreeMap::<String, Vec<TaskPackageReturnRow>>::new();
        let bindings = list_task_package_bindings(&self.connection, parent_package_id)?;
        let base_by_segment = metadata
            .base_projections
            .iter()
            .map(|projection| (projection.origin_segment_id.as_str(), projection))
            .collect::<BTreeMap<_, _>>();
        for binding in bindings {
            let base = base_by_segment
                .get(binding.origin_segment_id.as_str())
                .copied()
                .ok_or_else(|| {
                    StorageError::InvalidData(format!(
                        "missing durable base for origin segment {}",
                        binding.origin_segment_id
                    ))
                })?
                .clone();
            let current = binding
                .local_segment_id
                .as_deref()
                .map(|id| find_segment(&self.connection, id))
                .transpose()?;
            let remote = match current {
                Some(segment) => {
                    if segment.source_hash != base.source_hash
                        || segment.source_text != base.source_text
                        || segment.structural_path != base.structural_path
                    {
                        return Err(StorageError::InvalidState(format!(
                            "detached task changed immutable source for {}",
                            binding.origin_segment_id
                        )));
                    }
                    let reverse_tags = reverse_map(&binding.tag_id_map);
                    let reverse_comments = reverse_map(&binding.comment_id_map);
                    Some(projection_for_segment(
                        &self.connection,
                        &segment,
                        &binding.origin_document_id,
                        &binding.origin_segment_id,
                        segment.revision,
                        Some(&reverse_tags),
                        Some(&reverse_comments),
                    )?)
                }
                None => None,
            };
            let changed = match &remote {
                Some(remote) => remote.projection_hash != base.projection_hash,
                None => true,
            };
            if !changed {
                continue;
            }
            let row = TaskPackageReturnRow {
                base,
                remote,
                dependency_ok: true,
            };
            by_document
                .entry(binding.origin_document_id)
                .or_default()
                .push(row);
        }
        let mut documents = Vec::new();
        for document in &manifest.documents {
            if let Some(mut rows) = by_document.remove(&document.origin_document_id) {
                rows.sort_by(|left, right| {
                    left.base.ordinal.cmp(&right.base.ordinal).then_with(|| {
                        left.base
                            .origin_segment_id
                            .cmp(&right.base.origin_segment_id)
                    })
                });
                documents.push(TaskPackageReturnPayload {
                    origin_document_id: document.origin_document_id.clone(),
                    source_sha256: document.source_sha256.clone(),
                    base_revision: document.base_revision,
                    rows,
                });
            }
        }
        Ok(TaskPackageReturnSnapshot {
            parent_package_id: parent_package_id.to_string(),
            origin_project_id: parent.origin_project_id,
            origin_project_name: manifest.project_name.clone(),
            source_locale: manifest.source_locale.clone(),
            target_locale: manifest.target_locale.clone(),
            base_project_revision: parent.base_project_revision,
            working_project_id: working_project.id,
            documents,
        })
    }

    pub fn record_task_package_export(
        &mut self,
        input: TaskPackageExportRecord,
    ) -> Result<TaskPackageRecord> {
        input.manifest.validate()?;
        validate_package_actor_reason(&input.actor, &input.reason)?;
        require_nonempty("task package staged path", &input.staged_path)?;
        let base_projections = validate_export_base(&self.connection, &input)?;
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        if find_task_package_optional(&transaction, &input.manifest.package_id)?.is_some() {
            return Err(StorageError::InvalidState(
                "task package identity already exists".to_string(),
            ));
        }
        let origin_project_id = input.manifest.project_id.clone();
        let now = now_ms();
        let metadata = StoredTaskPackageMetadata {
            base_projections,
            terminal_result: None,
        };
        let metadata_json = serde_json::to_string(&metadata)?;
        let manifest_json =
            String::from_utf8(canonical_json(&input.manifest)?).map_err(|error| {
                StorageError::InvalidData(format!(
                    "canonical task package manifest is not UTF-8: {error}"
                ))
            })?;
        transaction.execute(
            "INSERT INTO task_packages (
                id, kind, origin_project_id, working_project_id, parent_package_id,
                base_project_revision, manifest_json, manifest_hash, staged_path,
                status, actor, reason, request_digest, result_json, created_at_ms,
                updated_at_ms, applied_at_ms
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'staged', ?10, ?11,
                       NULL, ?12, ?13, ?13, NULL)",
            params![
                &input.manifest.package_id,
                task_package_kind_text(input.manifest.kind),
                &origin_project_id,
                input.working_project_id.as_deref(),
                input.manifest.parent_package_id.as_deref(),
                to_i64(input.manifest.base_project_revision)?,
                manifest_json,
                &input.manifest.manifest_hash,
                &input.staged_path,
                &input.actor,
                &input.reason,
                metadata_json,
                now,
            ],
        )?;
        let operation_project = input
            .working_project_id
            .as_deref()
            .unwrap_or(&input.manifest.project_id);
        let operation = append_operation(
            &transaction,
            operation_project,
            "task_package",
            &input.manifest.package_id,
            match input.manifest.kind {
                TaskPackageKind::Assignment => "taskPackage.export.assignment",
                TaskPackageKind::Return => "taskPackage.export.return",
            },
            None,
            None,
            &input.actor,
            None,
            None,
            Some(serde_json::json!({
                "packageId": input.manifest.package_id,
                "kind": task_package_kind_text(input.manifest.kind),
                "documentIds": input.manifest.documents.iter().map(|d| d.origin_document_id.clone()).collect::<Vec<_>>(),
                "assetSliceCount": input.manifest.asset_slices.len(),
                "reason": input.reason,
            })),
        )?;
        let mut record = find_task_package(&transaction, &input.manifest.package_id)?;
        record.result_json = Some(metadata_json);
        let _ = operation;
        transaction.commit()?;
        Ok(record)
    }

    pub fn create_task_package_assignment_preview(
        &mut self,
        input: TaskPackageAssignmentPreview,
    ) -> Result<TaskPackagePreviewRecord> {
        input.package.manifest.validate()?;
        if input.package.manifest.kind != TaskPackageKind::Assignment {
            return Err(StorageError::InvalidState(
                "assignment preview requires an assignment package".to_string(),
            ));
        }
        validate_package_actor_reason(&input.actor, &input.reason)?;
        validate_preview_staged_path(&self.paths, &input.staged_path)?;
        validate_assignment_payload(&input.package.manifest, &input.documents)?;
        let base = input
            .documents
            .iter()
            .flat_map(|document| document.segments.iter().cloned())
            .collect::<Vec<_>>();
        let package = self.ensure_task_package_for_preview(&input.package, &base)?;
        let mut rows = Vec::with_capacity(base.len());
        for projection in base {
            rows.push(TaskPackagePreviewRowRecord {
                preview_id: input.id.clone(),
                row_id: task_package_row_id(
                    &input.package.manifest.package_id,
                    &projection.origin_segment_id,
                ),
                ordinal: projection.ordinal,
                origin_document_id: projection.origin_document_id.clone(),
                origin_segment_id: projection.origin_segment_id.clone(),
                disposition: TaskPackageDisposition::Unchanged,
                reason: "assignment row is ready for detached import".to_string(),
                safe_to_apply: false,
                identical_change: false,
                selected: false,
                base_hash: Some(projection.projection_hash.clone()),
                current_hash: None,
                remote_hash: Some(projection.projection_hash.clone()),
                current_revision: None,
                remote_revision: Some(projection.base_revision),
                base_projection: Some(projection.clone()),
                current_projection: None,
                remote_projection: Some(projection),
                diagnostic_code: None,
            });
        }
        let counts = counts_for_preview_rows(&rows)?;
        let record = self.persist_task_package_preview(
            &package,
            TaskPackagePreviewStatus::Open,
            input.id,
            input.staged_path,
            counts,
            input.diagnostics,
            rows,
        )?;
        Ok(record)
    }

    pub fn create_task_package_return_preview(
        &mut self,
        input: TaskPackageReturnPreview,
    ) -> Result<TaskPackagePreviewRecord> {
        input.package.manifest.validate()?;
        if input.package.manifest.kind != TaskPackageKind::Return {
            return Err(StorageError::InvalidState(
                "return preview requires a return package".to_string(),
            ));
        }
        validate_package_actor_reason(&input.actor, &input.reason)?;
        validate_preview_staged_path(&self.paths, &input.staged_path)?;
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let origin_project = find_project(&transaction, &input.package.manifest.project_id)?;
        let parent_id = input
            .package
            .manifest
            .parent_package_id
            .as_deref()
            .ok_or_else(|| StorageError::InvalidData("return package has no parent".to_string()))?;
        let parent = find_task_package(&transaction, parent_id)?;
        if parent.kind != TaskPackageKind::Assignment
            || parent.origin_project_id != origin_project.id
        {
            return Err(StorageError::InvalidState(
                "return package parent does not belong to the origin project".to_string(),
            ));
        }
        let metadata = decode_task_package_metadata(parent.result_json.as_deref())?;
        if input.package.manifest.base_project_revision != parent.base_project_revision
            || input.package.manifest.source_locale != parent.manifest.source_locale
            || input.package.manifest.target_locale != parent.manifest.target_locale
            || input.package.manifest.documents != parent.manifest.documents
        {
            return Err(StorageError::InvalidState(
                "return package manifest does not match its parent assignment".to_string(),
            ));
        }
        let base_by_segment = metadata
            .base_projections
            .iter()
            .map(|projection| (projection.origin_segment_id.clone(), projection.clone()))
            .collect::<BTreeMap<_, _>>();
        if base_by_segment.is_empty() {
            return Err(StorageError::InvalidData(
                "parent assignment has no durable base projections".to_string(),
            ));
        }
        let parent_documents = parent
            .manifest
            .documents
            .iter()
            .map(|document| (document.origin_document_id.as_str(), document))
            .collect::<BTreeMap<_, _>>();
        let mut seen_documents = BTreeSet::new();
        let mut remote_by_segment =
            BTreeMap::<String, (Option<TaskPackageProjection>, bool)>::new();
        for document in &input.documents {
            let reference = parent_documents
                .get(document.origin_document_id.as_str())
                .ok_or_else(|| invalid_package("return payload has an unknown document"))?;
            if document.source_sha256 != reference.source_sha256
                || document.base_revision != reference.base_revision
                || !seen_documents.insert(document.origin_document_id.clone())
            {
                return Err(invalid_package(
                    "return payload document metadata is invalid or duplicated",
                ));
            }
            for row in &document.rows {
                row.base.validate()?;
                if row.base.origin_document_id != document.origin_document_id {
                    return Err(invalid_package(
                        "return row document identity does not match its payload",
                    ));
                }
                let trusted = base_by_segment.get(&row.base.origin_segment_id);
                if let Some(trusted) = trusted {
                    if trusted.projection_hash != row.base.projection_hash
                        || trusted.base_revision != row.base.base_revision
                        || trusted.source_hash != row.base.source_hash
                    {
                        return Err(StorageError::InvalidState(format!(
                            "return base projection for {} does not match the durable assignment",
                            row.base.origin_segment_id
                        )));
                    }
                    if let Some(remote) = &row.remote
                        && (remote.origin_document_id != row.base.origin_document_id
                            || remote.origin_segment_id != row.base.origin_segment_id)
                    {
                        return Err(invalid_package(
                            "return remote projection identity does not match its base row",
                        ));
                    }
                } else {
                    // A return may explicitly describe a newly added row. It
                    // carries a validated base-shaped identity for stable
                    // diagnostics, but it is not trusted for merge and is
                    // classified against an absent base below.
                    let remote = row.remote.as_ref().ok_or_else(|| {
                        invalid_package("unbound return row cannot be an anonymous deletion")
                    })?;
                    if remote.origin_document_id != document.origin_document_id
                        || remote.origin_segment_id != row.base.origin_segment_id
                    {
                        return Err(invalid_package(
                            "return added row identity does not match its document",
                        ));
                    }
                }
                if remote_by_segment
                    .insert(
                        row.base.origin_segment_id.clone(),
                        (row.remote.clone(), row.dependency_ok),
                    )
                    .is_some()
                {
                    return Err(StorageError::InvalidState(
                        "return package contains duplicate segment identities".to_string(),
                    ));
                }
                if let Some(remote) = &row.remote {
                    remote.validate()?;
                }
            }
        }
        let mut rows = Vec::new();
        let mut counts = TaskPackagePreviewCounts::default();
        let mut document_revisions = BTreeSet::new();
        for base in metadata.base_projections {
            let current = find_origin_segment(&transaction, &base.origin_segment_id)?;
            let current_projection = current
                .as_ref()
                .map(|segment| {
                    projection_for_segment(
                        &transaction,
                        segment,
                        &base.origin_document_id,
                        &base.origin_segment_id,
                        segment.revision,
                        None,
                        None,
                    )
                })
                .transpose()?;
            if let Some(segment) = &current {
                document_revisions.insert(segment.document_id.clone());
            }
            let (remote, dependency_ok) = remote_by_segment
                .remove(&base.origin_segment_id)
                .unwrap_or((Some(base.clone()), true));
            let tag_valid = remote
                .as_ref()
                .map(|projection| remote_tags_are_valid(&transaction, current.as_ref(), projection))
                .transpose()?
                .unwrap_or(true);
            let classification = classify_three_way(
                Some(&base),
                current_projection.as_ref(),
                remote.as_ref(),
                tag_valid,
                dependency_ok,
            )?;
            counts.add(classification.disposition)?;
            rows.push(preview_row_from_classification(
                &input.id,
                &base,
                current_projection,
                remote,
                classification,
                current.as_ref().map(|segment| segment.revision),
                Some(base.clone()),
            ));
        }
        for (_origin_segment_id, (remote, dependency_ok)) in remote_by_segment {
            let remote = remote.ok_or_else(|| {
                invalid_package("unbound return row cannot be an anonymous deletion")
            })?;
            let tag_valid = remote_tags_are_valid(&transaction, None, &remote)?;
            let classification =
                classify_three_way(None, None, Some(&remote), tag_valid, dependency_ok)?;
            counts.add(classification.disposition)?;
            rows.push(preview_row_from_classification(
                &input.id,
                &remote,
                None,
                Some(remote.clone()),
                classification,
                None,
                None,
            ));
        }
        rows.sort_by(|left, right| {
            left.ordinal
                .cmp(&right.ordinal)
                .then_with(|| left.origin_document_id.cmp(&right.origin_document_id))
                .then_with(|| left.origin_segment_id.cmp(&right.origin_segment_id))
        });
        for document_id in document_revisions {
            let revision =
                find_document_for_project(&transaction, &document_id, &origin_project.id)?.revision;
            counts.document_revisions.insert(document_id, revision);
        }
        let package = ensure_task_package_in_transaction(&transaction, &input.package, &[])?;
        let expected_project_revision = origin_project.revision;
        let record = persist_task_package_preview_in_transaction(
            &transaction,
            &package,
            TaskPackagePreviewStatus::Open,
            &input.id,
            &input.staged_path,
            &counts,
            &input.diagnostics,
            &rows,
            expected_project_revision,
        )?;
        transaction.commit()?;
        Ok(record)
    }

    pub fn import_task_package_assignment(
        &mut self,
        input: TaskPackageAssignmentImport,
    ) -> Result<TaskPackageImportResult> {
        validate_package_actor_reason(&input.actor, &input.reason)?;
        if input.instructions.len() > translunar_task_package_core::MAX_INSTRUCTION_BYTES {
            return Err(StorageError::InvalidState(
                "task package instructions exceed the configured limit".to_string(),
            ));
        }
        require_nonempty("local task project id", &input.local_project_id)?;
        require_nonempty("local task project name", &input.project_name)?;
        let import_digest = request_digest_for_import(&input)?;
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let preview = find_task_package_preview(&transaction, &input.preview_id)?;
        if preview.status == TaskPackagePreviewStatus::Applied {
            if preview.request_digest.as_deref() != Some(import_digest.as_str()) {
                return Err(StorageError::InvalidState(
                    "assignment preview was already imported with a different request".to_string(),
                ));
            }
            let result = decode_task_package_import_result(&preview)?;
            transaction.commit()?;
            return Ok(result);
        }
        if preview.status != TaskPackagePreviewStatus::Open
            || preview.kind != TaskPackageKind::Assignment
        {
            return Err(StorageError::InvalidState(
                "assignment preview is not open".to_string(),
            ));
        }
        let package = find_task_package(&transaction, &preview.package_id)?;
        if package.kind != TaskPackageKind::Assignment {
            return Err(StorageError::InvalidState(
                "preview package is not an assignment".to_string(),
            ));
        }
        let manifest = &package.manifest;
        validate_import_documents(manifest, &input.documents)?;
        let (preview_rows, _) = query_task_package_preview_rows(&transaction, &preview.id)?;
        let preview_by_segment = preview_rows
            .iter()
            .filter_map(|row| {
                row.base_projection
                    .as_ref()
                    .map(|base| (row.origin_segment_id.as_str(), base))
            })
            .collect::<BTreeMap<_, _>>();
        for document in &input.documents {
            validate_task_package_path(&self.paths, &document.source_entry, false)?;
            if !manifest
                .entries
                .iter()
                .any(|entry| entry.path == document.source_entry)
            {
                return Err(invalid_package(
                    "assignment source entry is absent from the manifest",
                ));
            }
            validate_task_package_path(&self.paths, &document.managed_source_path, true)?;
            for projection in &document.projections {
                let expected = preview_by_segment
                    .get(projection.origin_segment_id.as_str())
                    .ok_or_else(|| {
                        invalid_package("assignment import row is absent from the preview")
                    })?;
                if *expected != projection {
                    return Err(StorageError::InvalidState(
                        "assignment import row differs from its validated preview".to_string(),
                    ));
                }
            }
        }
        if find_project_optional(&transaction, &input.local_project_id)?.is_some() {
            return Err(StorageError::InvalidState(
                "local task project identity already exists".to_string(),
            ));
        }
        let configuration = ProjectConfiguration {
            task_package: Some(TaskPackageProjectReference {
                package_id: package.id.clone(),
                origin_project_id: package.origin_project_id.clone(),
                parent_package_id: package.parent_package_id.clone(),
                instructions: input.instructions.clone(),
            }),
            ..ProjectConfiguration::default()
        };
        let project = create_project_with_id_in_transaction(
            &transaction,
            &input.local_project_id,
            &input.project_name,
            &manifest.source_locale,
            &manifest.target_locale,
            &input.domain,
            configuration,
        )?;
        let mut documents = Vec::with_capacity(input.documents.len());
        let mut binding_count = 0_u32;
        for document_input in &input.documents {
            let mut tag_maps = BTreeMap::<String, BTreeMap<String, String>>::new();
            let mut units = Vec::with_capacity(document_input.projections.len());
            for projection in &document_input.projections {
                let tags = decode_tags(&projection.tags_json)?;
                let (mapped_tags, tag_map) = remap_tags(&tags)?;
                tag_maps.insert(projection.origin_segment_id.clone(), tag_map);
                units.push(ImportedUnit {
                    ordinal: projection.ordinal,
                    structural_path: projection.structural_path.clone(),
                    source_text: projection.source_text.clone(),
                    target_text: Some(projection.target_text.clone()),
                    inline_tags: mapped_tags,
                    notes: Vec::<DocumentNote>::new(),
                });
            }
            let new_document = NewDocument {
                id: document_input.local_document_id.clone(),
                project_id: project.id.clone(),
                name: document_input.name.clone(),
                relative_path: document_input.relative_path.clone(),
                format: document_input.format.clone(),
                filter_id: document_input.filter_id.clone(),
                source_sha256: document_input.source_sha256.clone(),
                degradation: Vec::new(),
                original_source_path: document_input.original_source_path.clone().into(),
                managed_source_path: document_input.managed_source_path.clone().into(),
            };
            let document = insert_document_in_transaction(
                &transaction,
                &self.paths,
                &new_document,
                &units,
                now_ms(),
            )?;
            for projection in &document_input.projections {
                let local_segment =
                    find_segment_by_ordinal(&transaction, &document.id, projection.ordinal)?
                        .ok_or_else(|| StorageError::NotFound {
                            entity: "segment",
                            id: format!("{}:{}", document.id, projection.ordinal),
                        })?;
                if local_segment.source_hash != projection.source_hash {
                    return Err(StorageError::InvalidState(format!(
                        "imported source hash differs for origin segment {}",
                        projection.origin_segment_id
                    )));
                }
                let workflow = parse_workflow_state(&projection.workflow_state)?;
                let state = parse_segment_state(&projection.segment_state)?;
                transaction.execute(
                    "UPDATE segments SET state = ?1 WHERE id = ?2",
                    params![segment_state_text(state), &local_segment.id],
                )?;
                transaction.execute(
                    "UPDATE segment_editor_meta SET workflow_state = ?1 WHERE segment_id = ?2",
                    params![editor_workflow_state_text(workflow), &local_segment.id],
                )?;
                let comments = decode_comments(&projection.comments_json)?;
                let mut comment_map = BTreeMap::new();
                for comment in comments {
                    let local_id = new_id();
                    comment_map.insert(comment.id.clone(), local_id.clone());
                    transaction.execute(
                        "INSERT INTO segment_comments (
                            id, segment_id, author, text, created_at_ms, updated_at_ms,
                            revision, resolved, immutable
                         ) VALUES (?1, ?2, ?3, ?4, ?5, ?5, 0, ?6, ?7)",
                        params![
                            &local_id,
                            &local_segment.id,
                            &comment.author,
                            &comment.text,
                            now_ms(),
                            comment.resolved,
                            comment.immutable,
                        ],
                    )?;
                }
                let mut tag_map = tag_maps
                    .remove(&projection.origin_segment_id)
                    .unwrap_or_default();
                let binding = TaskPackageBindingRecord {
                    id: new_id(),
                    package_id: package.id.clone(),
                    local_project_id: Some(project.id.clone()),
                    local_document_id: Some(document.id.clone()),
                    local_segment_id: Some(local_segment.id.clone()),
                    origin_project_id: package.origin_project_id.clone(),
                    origin_document_id: projection.origin_document_id.clone(),
                    origin_segment_id: projection.origin_segment_id.clone(),
                    base_document_revision: manifest
                        .documents
                        .iter()
                        .find(|item| item.origin_document_id == projection.origin_document_id)
                        .map(|item| item.base_revision)
                        .unwrap_or(projection.base_revision),
                    base_segment_revision: projection.base_revision,
                    base_source_hash: projection.source_hash.clone(),
                    base_projection: projection.clone(),
                    source_entry: document_input.source_entry.clone(),
                    tag_id_map: std::mem::take(&mut tag_map),
                    comment_id_map: comment_map,
                    created_at_ms: now_ms(),
                };
                insert_task_package_binding(&transaction, &binding)?;
                binding_count = binding_count.checked_add(1).ok_or_else(|| {
                    StorageError::InvalidData("task package binding count overflow".to_string())
                })?;
            }
            documents.push(document);
        }
        import_task_package_assets(&transaction, &project, &input.asset_slices)?;
        let result = TaskPackageImportResult {
            package_id: package.id.clone(),
            preview_id: preview.id.clone(),
            project: project.clone(),
            documents: documents.clone(),
            binding_count,
        };
        let now = now_ms();
        let result_json = serde_json::to_string(&result)?;
        let mut package_metadata = decode_task_package_metadata(package.result_json.as_deref())?;
        package_metadata.terminal_result = Some(serde_json::to_value(&result)?);
        let package_result_json = serde_json::to_string(&package_metadata)?;
        let operation = append_operation(
            &transaction,
            &project.id,
            "task_package",
            &package.id,
            "taskPackage.import.assignment",
            None,
            Some(project.revision),
            &input.actor,
            Some(&preview.id),
            None,
            Some(serde_json::json!({
                "packageId": package.id,
                "previewId": preview.id,
                "documentCount": documents.len(),
                "bindingCount": binding_count,
                "reason": input.reason,
            })),
        )?;
        mark_task_package_preview_applied(
            &transaction,
            &preview.id,
            &result_json,
            &import_digest,
            now,
        )?;
        transaction.execute(
            "UPDATE task_packages SET working_project_id = ?1, status = 'imported',
                request_digest = ?2, result_json = ?3, updated_at_ms = ?4
             WHERE id = ?5",
            params![
                &project.id,
                &import_digest,
                &package_result_json,
                now,
                &package.id,
            ],
        )?;
        let _ = operation;
        transaction.commit()?;
        Ok(result)
    }

    pub fn get_task_package(&self, package_id: &str) -> Result<TaskPackageRecord> {
        find_task_package(&self.connection, package_id)
    }

    pub fn get_task_package_preview(&self, preview_id: &str) -> Result<TaskPackagePreviewRecord> {
        find_task_package_preview(&self.connection, preview_id)
    }

    pub fn list_task_package_preview_rows(
        &self,
        preview_id: &str,
        offset: u32,
        limit: u32,
    ) -> Result<(Vec<TaskPackagePreviewRowRecord>, u32)> {
        find_task_package_preview(&self.connection, preview_id)?;
        let total = self.connection.query_row(
            "SELECT COUNT(*) FROM task_package_preview_rows WHERE preview_id = ?1",
            [preview_id],
            |row| row.get::<_, i64>(0),
        )?;
        let mut statement = self.connection.prepare(
            "SELECT preview_id, row_id, ordinal, origin_document_id, origin_segment_id,
                    disposition, reason, safe_to_apply, identical_change, selected,
                    base_hash, current_hash, remote_hash, current_revision, remote_revision,
                    base_projection_json, current_projection_json, remote_projection_json,
                    diagnostic_code
             FROM task_package_preview_rows
             WHERE preview_id = ?1
             ORDER BY ordinal, origin_document_id, origin_segment_id, row_id
             LIMIT ?2 OFFSET ?3",
        )?;
        let rows = statement
            .query_map(
                params![preview_id, i64::from(limit), i64::from(offset)],
                row_to_task_package_preview_row,
            )?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok((rows, to_u32(total)?))
    }

    pub fn apply_task_package(
        &mut self,
        input: TaskPackageApply,
    ) -> Result<TaskPackageApplyResult> {
        validate_package_actor_reason(&input.actor, &input.reason)?;
        let selected = unique_package_row_ids(&input.selected_row_ids)?;
        let computed_digest = task_package_apply_request_digest(
            &input.preview_id,
            input.expected_project_revision,
            &selected,
            &input.actor,
            &input.reason,
        )?;
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let preview = find_task_package_preview(&transaction, &input.preview_id)?;
        if preview.status == TaskPackagePreviewStatus::Applied {
            if preview.request_digest.as_deref() != Some(computed_digest.as_str()) {
                return Err(StorageError::InvalidState(
                    "task package preview was already applied with a different request".to_string(),
                ));
            }
            let result = decode_task_package_apply_result(&preview)?;
            transaction.commit()?;
            return Ok(result);
        }
        if preview.status != TaskPackagePreviewStatus::Open
            || preview.kind != TaskPackageKind::Return
        {
            return Err(StorageError::InvalidState(
                "task package preview is not an open return preview".to_string(),
            ));
        }
        let package = find_task_package(&transaction, &preview.package_id)?;
        let project = find_project(&transaction, &preview.origin_project_id)?;
        ensure_entity_revision(
            "project",
            &project.id,
            project.revision,
            input.expected_project_revision,
        )?;
        if preview.counts.document_revisions.is_empty() {
            // An empty map is valid for a package containing only added rows,
            // but selected rows still undergo segment-level validation below.
        } else {
            for (document_id, expected_revision) in &preview.counts.document_revisions {
                let document = find_document(&transaction, document_id)?;
                ensure_entity_revision(
                    "document",
                    document_id,
                    document.revision,
                    *expected_revision,
                )?;
            }
        }
        let (all_rows, _) = query_task_package_preview_rows(&transaction, &preview.id)?;
        let row_map = all_rows
            .iter()
            .map(|row| (row.row_id.as_str(), row))
            .collect::<BTreeMap<_, _>>();
        let mut plans = Vec::with_capacity(selected.len());
        for row_id in &selected {
            let row =
                row_map
                    .get(row_id.as_str())
                    .copied()
                    .ok_or_else(|| StorageError::NotFound {
                        entity: "task_package_preview_row",
                        id: row_id.clone(),
                    })?;
            if !row.safe_to_apply
                || !matches!(
                    row.disposition,
                    TaskPackageDisposition::RemoteChanged | TaskPackageDisposition::BothChanged
                )
            {
                return Err(StorageError::InvalidState(format!(
                    "task package row {row_id} is not safe to apply"
                )));
            }
            let current_projection = row.current_projection.as_ref().ok_or_else(|| {
                StorageError::InvalidData(format!(
                    "task package row {row_id} has no current projection"
                ))
            })?;
            let remote = row.remote_projection.clone().ok_or_else(|| {
                StorageError::InvalidData(format!(
                    "task package row {row_id} has no remote projection"
                ))
            })?;
            let current = find_segment(&transaction, &current_projection.origin_segment_id)?;
            ensure_revision(
                &current,
                row.current_revision.ok_or_else(|| {
                    StorageError::InvalidData(format!(
                        "task package row {row_id} has no current revision"
                    ))
                })?,
            )?;
            let refreshed = projection_for_segment(
                &transaction,
                &current,
                &row.origin_document_id,
                &row.origin_segment_id,
                current.revision,
                None,
                None,
            )?;
            if row.current_hash.as_deref() != Some(refreshed.projection_hash.as_str())
                || refreshed.projection_hash != current_projection.projection_hash
            {
                return Err(StorageError::InvalidState(format!(
                    "task package row {row_id} is stale"
                )));
            }
            if refreshed.source_hash != remote.source_hash
                || refreshed.structural_path != remote.structural_path
                || refreshed.origin_document_id != remote.origin_document_id
                || refreshed.origin_segment_id != remote.origin_segment_id
            {
                return Err(StorageError::InvalidState(format!(
                    "task package row {row_id} changed immutable source identity"
                )));
            }
            if !remote_tags_are_valid(&transaction, Some(&current), &remote)? {
                return Err(StorageError::InvalidState(format!(
                    "task package row {row_id} has invalid protected tags"
                )));
            }
            plans.push(ValidatedApplyRow { current, remote });
        }
        let history_before = capture_structural_history(
            &transaction,
            plans.iter().map(|plan| plan.current.id.as_str()),
        )?;
        let mut changed_documents = BTreeMap::<String, Document>::new();
        let mut segment_ids = Vec::with_capacity(plans.len());
        let now = now_ms();
        for plan in &plans {
            let project_id = project.id.clone();
            let updated = apply_task_package_projection(
                &transaction,
                &plan.current,
                &plan.remote,
                &project_id,
                &input.actor,
                &input.reason,
                now,
            )?;
            let document = find_document(&transaction, &updated.document_id)?;
            changed_documents.insert(document.id.clone(), document);
            segment_ids.push(updated.id);
        }
        for document in changed_documents.values() {
            let next_revision = next_revision(document.revision)?;
            let changed = transaction.execute(
                "UPDATE documents SET revision = ?1, updated_at_ms = ?2
                 WHERE id = ?3 AND revision = ?4",
                params![
                    to_i64(next_revision)?,
                    now,
                    &document.id,
                    to_i64(document.revision)?,
                ],
            )?;
            if changed != 1 {
                let actual = find_document(&transaction, &document.id)?.revision;
                return Err(StorageError::EntityConflict {
                    entity: "document",
                    id: document.id.clone(),
                    expected_revision: document.revision,
                    actual_revision: actual,
                });
            }
        }
        let next_project_revision = next_revision(project.revision)?;
        transaction.execute(
            "UPDATE projects SET revision = ?1, updated_at_ms = ?2
             WHERE id = ?3 AND revision = ?4",
            params![
                to_i64(next_project_revision)?,
                now,
                &project.id,
                to_i64(project.revision)?,
            ],
        )?;
        let refreshed_documents = changed_documents
            .keys()
            .map(|id| {
                let document = find_document(&transaction, id)?;
                Ok((id.clone(), document.revision))
            })
            .collect::<Result<BTreeMap<_, _>>>()?;
        let history_after =
            capture_structural_history(&transaction, segment_ids.iter().map(String::as_str))?;
        let operation = append_operation(
            &transaction,
            &project.id,
            "task_package",
            &package.id,
            "taskPackage.apply",
            Some(project.revision),
            Some(next_project_revision),
            &input.actor,
            Some(&preview.id),
            None,
            Some(serde_json::json!({
                "previewId": preview.id,
                "packageId": package.id,
                "rowIds": selected,
                "segmentIds": segment_ids,
                "reason": input.reason,
            })),
        )?;
        append_editor_operation(
            &transaction,
            &project.id,
            "taskPackage.apply",
            &package.id,
            Some(project.revision),
            Some(next_project_revision),
            &input.actor,
            Some(&input.reason),
            &history_before,
            &history_after,
        )?;
        let selected_count = to_u32(selected.len() as i64)?;
        let result = TaskPackageApplyResult {
            preview_id: preview.id.clone(),
            status: "applied".to_string(),
            selected_count,
            applied_count: selected_count,
            skipped_count: to_u32(all_rows.len() as i64)?.saturating_sub(selected_count),
            project_revision: next_project_revision,
            document_revisions: refreshed_documents,
            segment_ids,
            operation_id: Some(operation.id),
        };
        let result_json = serde_json::to_string(&result)?;
        transaction.execute(
            "UPDATE task_package_preview_rows SET selected = 0 WHERE preview_id = ?1",
            [&preview.id],
        )?;
        for row_id in &selected {
            transaction.execute(
                "UPDATE task_package_preview_rows SET selected = 1
                 WHERE preview_id = ?1 AND row_id = ?2",
                params![&preview.id, row_id],
            )?;
        }
        mark_task_package_preview_applied(
            &transaction,
            &preview.id,
            &result_json,
            &computed_digest,
            now,
        )?;
        transaction.execute(
            "UPDATE task_packages SET status = 'applied', request_digest = ?1,
                result_json = ?2, updated_at_ms = ?3, applied_at_ms = ?3
             WHERE id = ?4",
            params![&computed_digest, &result_json, now, &package.id],
        )?;
        transaction.commit()?;
        Ok(result)
    }

    pub fn discard_task_package(
        &mut self,
        package_id: &str,
        preview_id: Option<&str>,
        actor: &str,
        reason: &str,
    ) -> Result<TaskPackageDiscardResult> {
        validate_package_actor_reason(actor, reason)?;
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let package = find_task_package(&transaction, package_id)?;
        if matches!(
            package.status,
            TaskPackageRecordStatus::Applied | TaskPackageRecordStatus::Imported
        ) {
            return Err(StorageError::InvalidState(
                "a terminal task package cannot be discarded".to_string(),
            ));
        }
        let mut staged_paths = vec![package.staged_path.clone()];
        let mut preview_statement = transaction.prepare(
            "SELECT id, staged_path, status FROM task_package_previews
             WHERE package_id = ?1",
        )?;
        let previews = preview_statement
            .query_map([package_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        drop(preview_statement);
        if let Some(preview_id) = preview_id {
            let preview = find_task_package_preview(&transaction, preview_id)?;
            if preview.package_id != package_id {
                return Err(StorageError::InvalidState(
                    "preview does not belong to the package".to_string(),
                ));
            }
            if preview.status == TaskPackagePreviewStatus::Applied {
                return Err(StorageError::InvalidState(
                    "an applied task package preview cannot be discarded".to_string(),
                ));
            }
        }
        let now = now_ms();
        for (preview_id, staged_path, status) in &previews {
            if status == "open" {
                transaction.execute(
                    "UPDATE task_package_previews SET status = 'discarded', updated_at_ms = ?1
                     WHERE id = ?2",
                    params![now, preview_id],
                )?;
            }
            staged_paths.push(staged_path.clone());
        }
        transaction.execute(
            "UPDATE task_packages SET status = 'discarded', updated_at_ms = ?1
             WHERE id = ?2 AND status <> 'applied'",
            params![now, package_id],
        )?;
        let operation_project = package
            .working_project_id
            .as_deref()
            .unwrap_or(package.origin_project_id.as_str());
        if find_project_optional(&transaction, operation_project)?.is_some() {
            append_operation(
                &transaction,
                operation_project,
                "task_package",
                package_id,
                "taskPackage.discard",
                None,
                None,
                actor,
                preview_id,
                None,
                Some(serde_json::json!({"packageId": package_id, "reason": reason})),
            )?;
        }
        transaction.commit()?;
        staged_paths.sort();
        staged_paths.dedup();
        let mut removed = false;
        for path in &staged_paths {
            removed |= remove_staged_file(&self.paths, path);
        }
        Ok(TaskPackageDiscardResult {
            package_id: package_id.to_string(),
            preview_id: preview_id.map(ToOwned::to_owned),
            status: "discarded".to_string(),
            removed_staged_file: removed,
        })
    }

    fn ensure_task_package_for_preview(
        &mut self,
        input: &TaskPackageExportRecord,
        base_projections: &[TaskPackageProjection],
    ) -> Result<TaskPackageRecord> {
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let record = ensure_task_package_in_transaction(&transaction, input, base_projections)?;
        transaction.commit()?;
        Ok(record)
    }

    #[allow(clippy::too_many_arguments)]
    fn persist_task_package_preview(
        &mut self,
        package: &TaskPackageRecord,
        status: TaskPackagePreviewStatus,
        preview_id: String,
        staged_path: String,
        counts: TaskPackagePreviewCounts,
        diagnostics: Vec<TaskPackageDiagnostic>,
        rows: Vec<TaskPackagePreviewRowRecord>,
    ) -> Result<TaskPackagePreviewRecord> {
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let result = persist_task_package_preview_in_transaction(
            &transaction,
            package,
            status,
            &preview_id,
            &staged_path,
            &counts,
            &diagnostics,
            &rows,
            package.base_project_revision,
        )?;
        transaction.commit()?;
        Ok(result)
    }
}

fn validate_package_actor_reason(actor: &str, reason: &str) -> Result<()> {
    // The actor travels with the package across machines, so it stays
    // required; a reason is optional context recorded when volunteered.
    require_nonempty("task package actor", actor)?;
    if actor.len() > MAX_PACKAGE_ACTOR_BYTES || reason.len() > MAX_PACKAGE_REASON_BYTES {
        return Err(StorageError::InvalidState(
            "task package actor or reason exceeds the configured limit".to_string(),
        ));
    }
    Ok(())
}

fn task_package_kind_text(kind: TaskPackageKind) -> &'static str {
    match kind {
        TaskPackageKind::Assignment => "assignment",
        TaskPackageKind::Return => "return",
    }
}

fn parse_task_package_record_status(value: &str) -> rusqlite::Result<TaskPackageRecordStatus> {
    match value {
        "staged" => Ok(TaskPackageRecordStatus::Staged),
        "imported" => Ok(TaskPackageRecordStatus::Imported),
        "open" => Ok(TaskPackageRecordStatus::Open),
        "applied" => Ok(TaskPackageRecordStatus::Applied),
        "discarded" => Ok(TaskPackageRecordStatus::Discarded),
        _ => Err(rusqlite::Error::FromSqlConversionFailure(
            0,
            rusqlite::types::Type::Text,
            Box::new(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "invalid task package status",
            )),
        )),
    }
}

fn task_package_preview_status_text(status: TaskPackagePreviewStatus) -> &'static str {
    match status {
        TaskPackagePreviewStatus::Open => "open",
        TaskPackagePreviewStatus::Applied => "applied",
        TaskPackagePreviewStatus::Discarded => "discarded",
    }
}

fn parse_task_package_preview_status(value: &str) -> rusqlite::Result<TaskPackagePreviewStatus> {
    match value {
        "open" => Ok(TaskPackagePreviewStatus::Open),
        "applied" => Ok(TaskPackagePreviewStatus::Applied),
        "discarded" => Ok(TaskPackagePreviewStatus::Discarded),
        _ => Err(rusqlite::Error::FromSqlConversionFailure(
            0,
            rusqlite::types::Type::Text,
            Box::new(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "invalid task package preview status",
            )),
        )),
    }
}

fn parse_task_package_kind(value: &str) -> rusqlite::Result<TaskPackageKind> {
    match value {
        "assignment" => Ok(TaskPackageKind::Assignment),
        "return" => Ok(TaskPackageKind::Return),
        _ => Err(rusqlite::Error::FromSqlConversionFailure(
            0,
            rusqlite::types::Type::Text,
            Box::new(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "invalid task package kind",
            )),
        )),
    }
}

fn select_segments(all: &[Segment], requested: &[String]) -> Result<Vec<Segment>> {
    if requested.is_empty() {
        return Ok(all.to_vec());
    }
    let requested = requested.iter().collect::<BTreeSet<_>>();
    if requested.len() > translunar_task_package_core::MAX_SEGMENTS {
        return Err(StorageError::InvalidState(
            "task package segment selection exceeds the configured limit".to_string(),
        ));
    }
    let mut selected = all
        .iter()
        .filter(|segment| requested.contains(&segment.id))
        .cloned()
        .collect::<Vec<_>>();
    if selected.len() != requested.len() {
        let found = selected
            .iter()
            .map(|segment| segment.id.as_str())
            .collect::<BTreeSet<_>>();
        let missing = requested
            .iter()
            .find(|id| !found.contains(id.as_str()))
            .map(|id| id.to_string())
            .unwrap_or_else(|| "unknown".to_string());
        return Err(StorageError::NotFound {
            entity: "segment",
            id: missing,
        });
    }
    selected.sort_by_key(|segment| segment.ordinal);
    Ok(selected)
}

fn projection_for_segment(
    connection: &Connection,
    segment: &Segment,
    origin_document_id: &str,
    origin_segment_id: &str,
    revision: u64,
    reverse_tag_ids: Option<&BTreeMap<String, String>>,
    reverse_comment_ids: Option<&BTreeMap<String, String>>,
) -> Result<TaskPackageProjection> {
    let source_tags = list_inline_tags(connection, &segment.id, TagSide::Source)?;
    let target_tags = list_inline_tags(connection, &segment.id, TagSide::Target)?;
    let tags = TagProjection {
        source: remap_projection_tags(source_tags, reverse_tag_ids),
        target: remap_projection_tags(target_tags, reverse_tag_ids),
    };
    let comments = list_editor_comments(connection, &segment.id, true)?
        .into_iter()
        .map(|comment| CommentProjection {
            id: reverse_comment_ids
                .and_then(|mapping| mapping.get(&comment.id))
                .cloned()
                .unwrap_or(comment.id),
            author: comment.author,
            text: comment.text,
            resolved: comment.resolved,
            immutable: comment.immutable,
        })
        .collect::<Vec<_>>();
    let tags_json = String::from_utf8(canonical_json(&tags)?).map_err(|error| {
        StorageError::InvalidData(format!("task package tags are not UTF-8: {error}"))
    })?;
    let comments_json = String::from_utf8(canonical_json(&comments)?).map_err(|error| {
        StorageError::InvalidData(format!("task package comments are not UTF-8: {error}"))
    })?;
    let workflow_state = connection
        .query_row(
            "SELECT workflow_state FROM segment_editor_meta WHERE segment_id = ?1",
            [segment.id.as_str()],
            |row| row.get::<_, String>(0),
        )
        .optional()?
        .unwrap_or_else(|| "translation".to_string());
    TaskPackageProjection {
        origin_document_id: origin_document_id.to_string(),
        origin_segment_id: origin_segment_id.to_string(),
        ordinal: segment.ordinal,
        structural_path: segment.structural_path.clone(),
        source_hash: segment.source_hash.clone(),
        base_revision: revision,
        source_text: segment.source_text.clone(),
        target_text: segment.target_text.clone(),
        segment_state: segment_state_text(segment.state).to_string(),
        tags_json,
        workflow_state,
        comments_json,
        projection_hash: String::new(),
    }
    .with_computed_hash()
    .map_err(StorageError::from)
}

fn remap_projection_tags(
    tags: Vec<InlineTag>,
    reverse_ids: Option<&BTreeMap<String, String>>,
) -> Vec<InlineTag> {
    tags.into_iter()
        .map(|mut tag| {
            if let Some(mapping) = reverse_ids {
                if let Some(id) = mapping.get(&tag.id) {
                    tag.id = id.clone();
                }
                if let Some(pair_id) = tag.pair_id.as_mut()
                    && let Some(id) = mapping.get(pair_id)
                {
                    *pair_id = id.clone();
                }
            }
            tag
        })
        .collect()
}

fn decode_tags(value: &str) -> Result<TagProjection> {
    if value.trim().is_empty() {
        return Ok(TagProjection {
            source: Vec::new(),
            target: Vec::new(),
        });
    }
    serde_json::from_str(value).map_err(|error| {
        StorageError::InvalidData(format!("task package tag projection is invalid: {error}"))
    })
}

fn decode_comments(value: &str) -> Result<Vec<CommentProjection>> {
    if value.trim().is_empty() {
        return Ok(Vec::new());
    }
    serde_json::from_str(value).map_err(|error| {
        StorageError::InvalidData(format!(
            "task package comment projection is invalid: {error}"
        ))
    })
}

fn remap_tags(tags: &TagProjection) -> Result<(Vec<InlineTag>, BTreeMap<String, String>)> {
    let mut mapping = BTreeMap::new();
    let mut all = tags
        .source
        .iter()
        .chain(tags.target.iter())
        .collect::<Vec<_>>();
    all.sort_by_key(|tag| (tag.side, tag.position, tag.id.clone()));
    for tag in &all {
        mapping.entry(tag.id.clone()).or_insert_with(new_id);
    }
    let mapped = tags
        .source
        .iter()
        .chain(tags.target.iter())
        .map(|tag| {
            let mut mapped = (*tag).clone();
            mapped.id = mapping.get(&tag.id).cloned().ok_or_else(|| {
                StorageError::InvalidData("task package tag map is incomplete".to_string())
            })?;
            mapped.pair_id = tag
                .pair_id
                .as_ref()
                .map(|id| {
                    mapping.get(id).cloned().ok_or_else(|| {
                        StorageError::InvalidState(
                            "task package tag pair references an unknown tag".to_string(),
                        )
                    })
                })
                .transpose()?;
            Ok(mapped)
        })
        .collect::<Result<Vec<_>>>()?;
    Ok((mapped, mapping))
}

fn reverse_map(mapping: &BTreeMap<String, String>) -> BTreeMap<String, String> {
    mapping
        .iter()
        .map(|(origin, local)| (local.clone(), origin.clone()))
        .collect()
}

fn remote_tags_are_valid(
    connection: &Connection,
    current: Option<&Segment>,
    remote: &TaskPackageProjection,
) -> Result<bool> {
    let remote_tags = decode_tags(&remote.tags_json)?;
    let Some(current) = current else {
        return Ok(true);
    };
    let current_source = list_inline_tags(connection, &current.id, TagSide::Source)?;
    if current_source != remote_tags.source {
        return Ok(false);
    }
    Ok(validate_target_tags(&current_source, &remote_tags.target, &remote.target_text).is_empty())
}

fn decode_task_package_metadata(value: Option<&str>) -> Result<StoredTaskPackageMetadata> {
    let Some(value) = value else {
        return Ok(StoredTaskPackageMetadata {
            base_projections: Vec::new(),
            terminal_result: None,
        });
    };
    serde_json::from_str(value).map_err(|error| {
        StorageError::InvalidData(format!("task package metadata is invalid: {error}"))
    })
}

fn metadata_from_base_projections(
    _package_id: &str,
    projections: &[TaskPackageProjection],
) -> Result<String> {
    Ok(serde_json::to_string(&StoredTaskPackageMetadata {
        base_projections: projections.to_vec(),
        terminal_result: None,
    })?)
}

fn validate_export_base(
    connection: &Connection,
    input: &TaskPackageExportRecord,
) -> Result<Vec<TaskPackageProjection>> {
    let manifest = &input.manifest;
    let mut base = input.base_projections.clone();
    for projection in &base {
        projection.validate()?;
    }
    let unique = base
        .iter()
        .map(|projection| projection.origin_segment_id.as_str())
        .collect::<BTreeSet<_>>();
    if unique.len() != base.len() {
        return Err(StorageError::InvalidState(
            "task package export contains duplicate segment identities".to_string(),
        ));
    }
    match manifest.kind {
        TaskPackageKind::Assignment => {
            let project = find_project(connection, &manifest.project_id)?;
            ensure_entity_revision(
                "project",
                &project.id,
                project.revision,
                manifest.base_project_revision,
            )?;
            let manifest_documents = manifest
                .documents
                .iter()
                .map(|document| (document.origin_document_id.as_str(), document))
                .collect::<BTreeMap<_, _>>();
            let mut counts = BTreeMap::<String, usize>::new();
            for projection in &base {
                let reference = manifest_documents
                    .get(projection.origin_document_id.as_str())
                    .ok_or_else(|| {
                        StorageError::InvalidState(
                            "task package export row is absent from the manifest".to_string(),
                        )
                    })?;
                let document = find_document(connection, &projection.origin_document_id)?;
                if document.project_id != project.id
                    || document.source_sha256 != reference.source_sha256
                    || document.revision != reference.base_revision
                {
                    return Err(StorageError::InvalidState(
                        "task package manifest document metadata is stale".to_string(),
                    ));
                }
                let segment = find_segment(connection, &projection.origin_segment_id)?;
                if segment.document_id != projection.origin_document_id
                    || segment.source_hash != projection.source_hash
                    || segment.revision != projection.base_revision
                {
                    return Err(StorageError::InvalidState(format!(
                        "task package export row {} is stale",
                        projection.origin_segment_id
                    )));
                }
                *counts
                    .entry(projection.origin_document_id.clone())
                    .or_default() += 1;
            }
            for reference in &manifest.documents {
                if counts
                    .get(&reference.origin_document_id)
                    .copied()
                    .unwrap_or_default()
                    != reference.segment_count as usize
                {
                    return Err(StorageError::InvalidState(
                        "task package manifest segment counts do not match the export".to_string(),
                    ));
                }
            }
        }
        TaskPackageKind::Return => {
            let working_project_id = input.working_project_id.as_deref().ok_or_else(|| {
                StorageError::InvalidState("return export requires a working project".to_string())
            })?;
            let parent = manifest.parent_package_id.as_deref().ok_or_else(|| {
                StorageError::InvalidState("return export requires a parent package".to_string())
            })?;
            let package = find_task_package(connection, parent)?;
            if package.working_project_id.as_deref() != Some(working_project_id) {
                return Err(StorageError::InvalidState(
                    "return export working project is not bound to the parent".to_string(),
                ));
            }
            let working = find_project(connection, working_project_id)?;
            let _ = working;
            for projection in &base {
                projection.validate()?;
            }
        }
    }
    base.sort_by(|left, right| {
        left.origin_document_id
            .cmp(&right.origin_document_id)
            .then_with(|| left.ordinal.cmp(&right.ordinal))
            .then_with(|| left.origin_segment_id.cmp(&right.origin_segment_id))
    });
    Ok(base)
}

fn validate_assignment_payload(
    manifest: &TaskPackageManifest,
    documents: &[TaskPackageDocumentPayload],
) -> Result<()> {
    if documents.len() != manifest.documents.len() {
        return Err(invalid_package(
            "assignment payload document count does not match the manifest",
        ));
    }
    let manifest_docs = manifest
        .documents
        .iter()
        .map(|document| (document.origin_document_id.as_str(), document))
        .collect::<BTreeMap<_, _>>();
    let mut total = 0_usize;
    for document in documents {
        let reference = manifest_docs
            .get(document.origin_document_id.as_str())
            .ok_or_else(|| invalid_package("assignment payload has unknown document"))?;
        if document.source_sha256 != reference.source_sha256
            || document.base_revision != reference.base_revision
            || document.segments.len() != reference.segment_count as usize
        {
            return Err(invalid_package(
                "assignment payload document metadata does not match the manifest",
            ));
        }
        let mut ordinals = BTreeSet::new();
        for projection in &document.segments {
            projection.validate()?;
            if projection.origin_document_id != document.origin_document_id
                || !ordinals.insert(projection.ordinal)
            {
                return Err(invalid_package(
                    "assignment payload contains an invalid segment identity",
                ));
            }
        }
        total = total.checked_add(document.segments.len()).ok_or_else(|| {
            StorageError::InvalidData("task package segment count overflow".to_string())
        })?;
    }
    if total > translunar_task_package_core::MAX_SEGMENTS {
        return Err(StorageError::InvalidState(
            "assignment payload exceeds the segment limit".to_string(),
        ));
    }
    Ok(())
}

fn validate_import_documents(
    manifest: &TaskPackageManifest,
    documents: &[TaskPackageDocumentImport],
) -> Result<()> {
    if documents.len() != manifest.documents.len() {
        return Err(invalid_package(
            "assignment import document count does not match the manifest",
        ));
    }
    let refs = manifest
        .documents
        .iter()
        .map(|document| (document.origin_document_id.as_str(), document))
        .collect::<BTreeMap<_, _>>();
    let mut local_ids = BTreeSet::new();
    for document in documents {
        if !local_ids.insert(document.local_document_id.clone()) {
            return Err(StorageError::InvalidState(
                "assignment import contains duplicate local document IDs".to_string(),
            ));
        }
        let reference = refs
            .get(document.origin_document_id.as_str())
            .ok_or_else(|| invalid_package("assignment import has unknown document"))?;
        if document.source_sha256 != reference.source_sha256
            || document.projections.len() != reference.segment_count as usize
        {
            return Err(invalid_package(
                "assignment import document metadata does not match the manifest",
            ));
        }
        let mut ids = BTreeSet::new();
        for projection in &document.projections {
            projection.validate()?;
            if projection.origin_document_id != document.origin_document_id
                || !ids.insert(projection.origin_segment_id.clone())
            {
                return Err(invalid_package(
                    "assignment import contains duplicate segment identities",
                ));
            }
        }
    }
    Ok(())
}

fn counts_for_preview_rows(
    rows: &[TaskPackagePreviewRowRecord],
) -> Result<TaskPackagePreviewCounts> {
    let mut counts = TaskPackagePreviewCounts::default();
    for row in rows {
        counts.add(row.disposition)?;
    }
    Ok(counts)
}

fn task_package_row_id(package_id: &str, origin_segment_id: &str) -> String {
    sha256_hex(format!("{package_id}\0{origin_segment_id}").as_bytes())
}

fn unique_package_row_ids(ids: &[String]) -> Result<Vec<String>> {
    if ids.is_empty() || ids.len() > MAX_PACKAGE_ROWS {
        return Err(StorageError::InvalidState(
            "task package apply requires 1..100000 selected rows".to_string(),
        ));
    }
    let unique = ids.iter().cloned().collect::<BTreeSet<_>>();
    if unique.len() != ids.len() {
        return Err(StorageError::InvalidState(
            "task package apply selection contains duplicate row IDs".to_string(),
        ));
    }
    Ok(unique.into_iter().collect())
}

fn invalid_package(message: impl Into<String>) -> StorageError {
    StorageError::TaskPackage(TaskPackageError::InvalidPackage(message.into()))
}

pub fn task_package_apply_request_digest(
    preview_id: &str,
    expected_project_revision: u64,
    selected_row_ids: &[String],
    actor: &str,
    reason: &str,
) -> Result<String> {
    let mut selected = selected_row_ids
        .iter()
        .map(String::as_str)
        .collect::<Vec<_>>();
    selected.sort_unstable();
    canonical_sha256(&TaskPackageApplyFingerprint {
        preview_id,
        expected_project_revision,
        selected_row_ids: selected,
        actor,
        reason,
    })
    .map_err(StorageError::from)
}

fn request_digest_for_import(input: &TaskPackageAssignmentImport) -> Result<String> {
    canonical_sha256(input).map_err(StorageError::from)
}

fn preview_row_from_classification(
    preview_id: &str,
    identity: &TaskPackageProjection,
    current: Option<TaskPackageProjection>,
    remote: Option<TaskPackageProjection>,
    classification: TaskPackageClassification,
    current_revision: Option<u64>,
    base: Option<TaskPackageProjection>,
) -> TaskPackagePreviewRowRecord {
    TaskPackagePreviewRowRecord {
        preview_id: preview_id.to_string(),
        row_id: task_package_row_id(preview_id, &identity.origin_segment_id),
        ordinal: identity.ordinal,
        origin_document_id: identity.origin_document_id.clone(),
        origin_segment_id: identity.origin_segment_id.clone(),
        disposition: classification.disposition,
        reason: classification.reason,
        safe_to_apply: classification.safe_to_apply,
        identical_change: classification.identical_change,
        selected: false,
        base_hash: classification.base_hash,
        current_hash: classification.current_hash,
        remote_hash: classification.remote_hash,
        current_revision,
        remote_revision: remote.as_ref().map(|projection| projection.base_revision),
        base_projection: base,
        current_projection: current,
        remote_projection: remote,
        diagnostic_code: None,
    }
}

fn find_task_package_optional(
    connection: &Connection,
    package_id: &str,
) -> Result<Option<TaskPackageRecord>> {
    connection
        .query_row(
            "SELECT id, kind, origin_project_id, working_project_id, parent_package_id,
                    base_project_revision, manifest_json, staged_path, status, actor,
                    reason, request_digest, result_json, created_at_ms, updated_at_ms,
                    applied_at_ms
             FROM task_packages WHERE id = ?1",
            [package_id],
            row_to_task_package,
        )
        .optional()
        .map_err(Into::into)
}

fn find_task_package(connection: &Connection, package_id: &str) -> Result<TaskPackageRecord> {
    find_task_package_optional(connection, package_id)?.ok_or_else(|| StorageError::NotFound {
        entity: "task_package",
        id: package_id.to_string(),
    })
}

fn row_to_task_package(row: &Row<'_>) -> rusqlite::Result<TaskPackageRecord> {
    let manifest_json = row.get::<_, String>(6)?;
    let manifest = serde_json::from_str(&manifest_json).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(6, rusqlite::types::Type::Text, Box::new(error))
    })?;
    Ok(TaskPackageRecord {
        id: row.get(0)?,
        kind: parse_task_package_kind(&row.get::<_, String>(1)?)?,
        origin_project_id: row.get(2)?,
        working_project_id: row.get(3)?,
        parent_package_id: row.get(4)?,
        base_project_revision: read_u64(row, 5)?,
        manifest,
        staged_path: row.get(7)?,
        status: parse_task_package_record_status(&row.get::<_, String>(8)?)?,
        actor: row.get(9)?,
        reason: row.get(10)?,
        request_digest: row.get(11)?,
        result_json: row.get(12)?,
        created_at_ms: row.get(13)?,
        updated_at_ms: row.get(14)?,
        applied_at_ms: row.get(15)?,
    })
}

fn ensure_task_package_in_transaction(
    transaction: &Transaction<'_>,
    input: &TaskPackageExportRecord,
    base_projections: &[TaskPackageProjection],
) -> Result<TaskPackageRecord> {
    if let Some(existing) = find_task_package_optional(transaction, &input.manifest.package_id)? {
        if existing.manifest.manifest_hash != input.manifest.manifest_hash
            || existing.kind != input.manifest.kind
            || existing.origin_project_id != input.manifest.project_id
        {
            return Err(StorageError::InvalidState(
                "task package identity is already bound to different content".to_string(),
            ));
        }
        if matches!(
            existing.status,
            TaskPackageRecordStatus::Imported
                | TaskPackageRecordStatus::Applied
                | TaskPackageRecordStatus::Discarded
        ) {
            return Err(StorageError::InvalidState(
                "task package is already terminal".to_string(),
            ));
        }
        transaction.execute(
            "UPDATE task_packages SET status = 'open', staged_path = ?1, updated_at_ms = ?2
             WHERE id = ?3",
            params![&input.staged_path, now_ms(), &existing.id],
        )?;
        return find_task_package(transaction, &existing.id);
    }
    let parent = input.manifest.parent_package_id.as_deref();
    if let Some(parent) = parent {
        let parent_record = find_task_package(transaction, parent)?;
        if parent_record.kind != TaskPackageKind::Assignment
            || parent_record.origin_project_id != input.manifest.project_id
        {
            return Err(StorageError::InvalidState(
                "return package parent identity is invalid".to_string(),
            ));
        }
    }
    let manifest_json = String::from_utf8(canonical_json(&input.manifest)?).map_err(|error| {
        StorageError::InvalidData(format!(
            "canonical task package manifest is not UTF-8: {error}"
        ))
    })?;
    let result_json = metadata_from_base_projections(&input.manifest.package_id, base_projections)?;
    let now = now_ms();
    transaction.execute(
        "INSERT INTO task_packages (
            id, kind, origin_project_id, working_project_id, parent_package_id,
            base_project_revision, manifest_json, manifest_hash, staged_path,
            status, actor, reason, request_digest, result_json, created_at_ms,
            updated_at_ms, applied_at_ms
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'open', ?10, ?11,
                   NULL, ?12, ?13, ?13, NULL)",
        params![
            &input.manifest.package_id,
            task_package_kind_text(input.manifest.kind),
            &input.manifest.project_id,
            input.working_project_id.as_deref(),
            parent,
            to_i64(input.manifest.base_project_revision)?,
            manifest_json,
            &input.manifest.manifest_hash,
            &input.staged_path,
            &input.actor,
            &input.reason,
            result_json,
            now,
        ],
    )?;
    find_task_package(transaction, &input.manifest.package_id)
}

fn find_task_package_preview(
    connection: &Connection,
    preview_id: &str,
) -> Result<TaskPackagePreviewRecord> {
    connection
        .query_row(
            "SELECT id, package_id, kind, origin_project_id, expected_project_revision,
                    status, counts_json, diagnostics_json, staged_path, request_digest,
                    result_json, created_at_ms, updated_at_ms, applied_at_ms
             FROM task_package_previews WHERE id = ?1",
            [preview_id],
            row_to_task_package_preview,
        )
        .optional()?
        .ok_or_else(|| StorageError::NotFound {
            entity: "task_package_preview",
            id: preview_id.to_string(),
        })
}

fn row_to_task_package_preview(row: &Row<'_>) -> rusqlite::Result<TaskPackagePreviewRecord> {
    let counts_json = row.get::<_, String>(6)?;
    let diagnostics_json = row.get::<_, String>(7)?;
    let counts = serde_json::from_str(&counts_json).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(6, rusqlite::types::Type::Text, Box::new(error))
    })?;
    let diagnostics = serde_json::from_str(&diagnostics_json).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(7, rusqlite::types::Type::Text, Box::new(error))
    })?;
    Ok(TaskPackagePreviewRecord {
        id: row.get(0)?,
        package_id: row.get(1)?,
        kind: parse_task_package_kind(&row.get::<_, String>(2)?)?,
        origin_project_id: row.get(3)?,
        expected_project_revision: read_u64(row, 4)?,
        status: parse_task_package_preview_status(&row.get::<_, String>(5)?)?,
        counts,
        diagnostics,
        staged_path: row.get(8)?,
        request_digest: row.get(9)?,
        result_json: row.get(10)?,
        created_at_ms: row.get(11)?,
        updated_at_ms: row.get(12)?,
        applied_at_ms: row.get(13)?,
    })
}

#[allow(clippy::too_many_arguments)]
fn persist_task_package_preview_in_transaction(
    transaction: &Transaction<'_>,
    package: &TaskPackageRecord,
    status: TaskPackagePreviewStatus,
    preview_id: &str,
    staged_path: &str,
    counts: &TaskPackagePreviewCounts,
    diagnostics: &[TaskPackageDiagnostic],
    rows: &[TaskPackagePreviewRowRecord],
    expected_project_revision: u64,
) -> Result<TaskPackagePreviewRecord> {
    require_nonempty("task package preview id", preview_id)?;
    validate_preview_staged_path_text(staged_path)?;
    if rows.len() > MAX_PACKAGE_ROWS {
        return Err(StorageError::InvalidState(
            "task package preview exceeds the row limit".to_string(),
        ));
    }
    if find_task_package_preview_optional(transaction, preview_id)?.is_some() {
        return Err(StorageError::InvalidState(
            "task package preview identity already exists".to_string(),
        ));
    }
    let now = now_ms();
    transaction.execute(
        "INSERT INTO task_package_previews (
            id, package_id, kind, origin_project_id, expected_project_revision,
            status, counts_json, diagnostics_json, staged_path, request_digest,
            result_json, created_at_ms, updated_at_ms, applied_at_ms
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, NULL, NULL, ?10, ?10, NULL)",
        params![
            preview_id,
            &package.id,
            task_package_kind_text(package.kind),
            &package.origin_project_id,
            to_i64(expected_project_revision)?,
            task_package_preview_status_text(status),
            serde_json::to_string(counts)?,
            serde_json::to_string(diagnostics)?,
            staged_path,
            now,
        ],
    )?;
    let mut seen = BTreeSet::new();
    for row in rows {
        if row.preview_id != preview_id || !seen.insert(row.origin_segment_id.as_str()) {
            return Err(StorageError::InvalidState(
                "task package preview contains duplicate or mismatched rows".to_string(),
            ));
        }
        insert_task_package_preview_row(transaction, row)?;
    }
    transaction.execute(
        "UPDATE task_packages SET status = 'open', staged_path = ?1, updated_at_ms = ?2
         WHERE id = ?3",
        params![staged_path, now, &package.id],
    )?;
    find_task_package_preview(transaction, preview_id)
}

fn find_task_package_preview_optional(
    connection: &Connection,
    preview_id: &str,
) -> Result<Option<TaskPackagePreviewRecord>> {
    connection
        .query_row(
            "SELECT id, package_id, kind, origin_project_id, expected_project_revision,
                    status, counts_json, diagnostics_json, staged_path, request_digest,
                    result_json, created_at_ms, updated_at_ms, applied_at_ms
             FROM task_package_previews WHERE id = ?1",
            [preview_id],
            row_to_task_package_preview,
        )
        .optional()
        .map_err(Into::into)
}

fn insert_task_package_preview_row(
    transaction: &Transaction<'_>,
    row: &TaskPackagePreviewRowRecord,
) -> Result<()> {
    transaction.execute(
        "INSERT INTO task_package_preview_rows (
            preview_id, row_id, ordinal, origin_document_id, origin_segment_id,
            disposition, reason, safe_to_apply, identical_change, selected,
            base_hash, current_hash, remote_hash, current_revision, remote_revision,
            base_projection_json, current_projection_json, remote_projection_json,
            diagnostic_code
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12,
                   ?13, ?14, ?15, ?16, ?17, ?18, ?19)",
        params![
            &row.preview_id,
            &row.row_id,
            i64::from(row.ordinal),
            &row.origin_document_id,
            &row.origin_segment_id,
            task_package_disposition_text(row.disposition),
            &row.reason,
            row.safe_to_apply,
            row.identical_change,
            row.selected,
            row.base_hash.as_deref(),
            row.current_hash.as_deref(),
            row.remote_hash.as_deref(),
            row.current_revision.map(to_i64).transpose()?,
            row.remote_revision.map(to_i64).transpose()?,
            row.base_projection
                .as_ref()
                .map(serde_json::to_string)
                .transpose()?,
            row.current_projection
                .as_ref()
                .map(serde_json::to_string)
                .transpose()?,
            row.remote_projection
                .as_ref()
                .map(serde_json::to_string)
                .transpose()?,
            row.diagnostic_code.as_deref(),
        ],
    )?;
    Ok(())
}

fn task_package_disposition_text(disposition: TaskPackageDisposition) -> &'static str {
    match disposition {
        TaskPackageDisposition::Unchanged => "unchanged",
        TaskPackageDisposition::RemoteChanged => "remoteChanged",
        TaskPackageDisposition::LocalChanged => "localChanged",
        TaskPackageDisposition::BothChanged => "bothChanged",
        TaskPackageDisposition::Deleted => "deleted",
        TaskPackageDisposition::Added => "added",
        TaskPackageDisposition::TagInvalid => "tagInvalid",
        TaskPackageDisposition::MissingDependency => "missingDependency",
    }
}

fn parse_task_package_disposition(value: &str) -> rusqlite::Result<TaskPackageDisposition> {
    match value {
        "unchanged" => Ok(TaskPackageDisposition::Unchanged),
        "remoteChanged" => Ok(TaskPackageDisposition::RemoteChanged),
        "localChanged" => Ok(TaskPackageDisposition::LocalChanged),
        "bothChanged" => Ok(TaskPackageDisposition::BothChanged),
        "deleted" => Ok(TaskPackageDisposition::Deleted),
        "added" => Ok(TaskPackageDisposition::Added),
        "tagInvalid" => Ok(TaskPackageDisposition::TagInvalid),
        "missingDependency" => Ok(TaskPackageDisposition::MissingDependency),
        _ => Err(rusqlite::Error::FromSqlConversionFailure(
            0,
            rusqlite::types::Type::Text,
            Box::new(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "invalid task package disposition",
            )),
        )),
    }
}

fn row_to_task_package_preview_row(row: &Row<'_>) -> rusqlite::Result<TaskPackagePreviewRowRecord> {
    Ok(TaskPackagePreviewRowRecord {
        preview_id: row.get(0)?,
        row_id: row.get(1)?,
        ordinal: read_u32(row, 2)?,
        origin_document_id: row.get(3)?,
        origin_segment_id: row.get(4)?,
        disposition: parse_task_package_disposition(&row.get::<_, String>(5)?)?,
        reason: row.get(6)?,
        safe_to_apply: row.get(7)?,
        identical_change: row.get(8)?,
        selected: row.get(9)?,
        base_hash: row.get(10)?,
        current_hash: row.get(11)?,
        remote_hash: row.get(12)?,
        current_revision: read_optional_u64(row, 13)?,
        remote_revision: read_optional_u64(row, 14)?,
        base_projection: read_optional_json_struct(row, 15)?,
        current_projection: read_optional_json_struct(row, 16)?,
        remote_projection: read_optional_json_struct(row, 17)?,
        diagnostic_code: row.get(18)?,
    })
}

fn read_optional_json_struct<T: serde::de::DeserializeOwned>(
    row: &Row<'_>,
    index: usize,
) -> rusqlite::Result<Option<T>> {
    row.get::<_, Option<String>>(index)?
        .map(|value| {
            serde_json::from_str(&value).map_err(|error| {
                rusqlite::Error::FromSqlConversionFailure(
                    index,
                    rusqlite::types::Type::Text,
                    Box::new(error),
                )
            })
        })
        .transpose()
}

fn query_task_package_preview_rows(
    connection: &Connection,
    preview_id: &str,
) -> Result<(Vec<TaskPackagePreviewRowRecord>, u32)> {
    let total = connection.query_row(
        "SELECT COUNT(*) FROM task_package_preview_rows WHERE preview_id = ?1",
        [preview_id],
        |row| row.get::<_, i64>(0),
    )?;
    let mut statement = connection.prepare(
        "SELECT preview_id, row_id, ordinal, origin_document_id, origin_segment_id,
                disposition, reason, safe_to_apply, identical_change, selected,
                base_hash, current_hash, remote_hash, current_revision, remote_revision,
                base_projection_json, current_projection_json, remote_projection_json,
                diagnostic_code
         FROM task_package_preview_rows WHERE preview_id = ?1
         ORDER BY ordinal, origin_document_id, origin_segment_id, row_id",
    )?;
    let rows = statement
        .query_map([preview_id], row_to_task_package_preview_row)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok((rows, to_u32(total)?))
}

fn mark_task_package_preview_applied(
    transaction: &Transaction<'_>,
    preview_id: &str,
    result_json: &str,
    request_digest: &str,
    now: i64,
) -> Result<()> {
    transaction.execute(
        "UPDATE task_package_previews
         SET status = 'applied', request_digest = ?1, result_json = ?2,
             updated_at_ms = ?3, applied_at_ms = ?3
         WHERE id = ?4 AND status = 'open'",
        params![request_digest, result_json, now, preview_id],
    )?;
    Ok(())
}

fn decode_task_package_import_result(
    preview: &TaskPackagePreviewRecord,
) -> Result<TaskPackageImportResult> {
    let value = preview.result_json.as_deref().ok_or_else(|| {
        StorageError::InvalidData("applied assignment preview has no result".to_string())
    })?;
    serde_json::from_str(value).map_err(|error| {
        StorageError::InvalidData(format!(
            "stored assignment import result is invalid: {error}"
        ))
    })
}

fn decode_task_package_apply_result(
    preview: &TaskPackagePreviewRecord,
) -> Result<TaskPackageApplyResult> {
    let value = preview.result_json.as_deref().ok_or_else(|| {
        StorageError::InvalidData("applied return preview has no result".to_string())
    })?;
    serde_json::from_str(value).map_err(|error| {
        StorageError::InvalidData(format!(
            "stored task package apply result is invalid: {error}"
        ))
    })
}

fn insert_task_package_binding(
    transaction: &Transaction<'_>,
    binding: &TaskPackageBindingRecord,
) -> Result<()> {
    transaction.execute(
        "INSERT INTO task_package_bindings (
            id, package_id, local_project_id, local_document_id, local_segment_id,
            origin_project_id, origin_document_id, origin_segment_id,
            base_document_revision, base_segment_revision, base_source_hash,
            base_projection_json, source_entry, tag_id_map_json, comment_id_map_json,
            created_at_ms
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12,
                   ?13, ?14, ?15, ?16)",
        params![
            &binding.id,
            &binding.package_id,
            binding.local_project_id.as_deref(),
            binding.local_document_id.as_deref(),
            binding.local_segment_id.as_deref(),
            &binding.origin_project_id,
            &binding.origin_document_id,
            &binding.origin_segment_id,
            to_i64(binding.base_document_revision)?,
            to_i64(binding.base_segment_revision)?,
            &binding.base_source_hash,
            serde_json::to_string(&binding.base_projection)?,
            &binding.source_entry,
            serde_json::to_string(&binding.tag_id_map)?,
            serde_json::to_string(&binding.comment_id_map)?,
            binding.created_at_ms,
        ],
    )?;
    Ok(())
}

fn list_task_package_bindings(
    connection: &Connection,
    package_id: &str,
) -> Result<Vec<TaskPackageBindingRecord>> {
    let mut statement = connection.prepare(
        "SELECT id, package_id, local_project_id, local_document_id, local_segment_id,
                origin_project_id, origin_document_id, origin_segment_id,
                base_document_revision, base_segment_revision, base_source_hash,
                base_projection_json, source_entry, tag_id_map_json,
                comment_id_map_json, created_at_ms
         FROM task_package_bindings WHERE package_id = ?1
         ORDER BY origin_document_id, origin_segment_id, id",
    )?;
    statement
        .query_map([package_id], row_to_task_package_binding)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(Into::into)
}

fn row_to_task_package_binding(row: &Row<'_>) -> rusqlite::Result<TaskPackageBindingRecord> {
    Ok(TaskPackageBindingRecord {
        id: row.get(0)?,
        package_id: row.get(1)?,
        local_project_id: row.get(2)?,
        local_document_id: row.get(3)?,
        local_segment_id: row.get(4)?,
        origin_project_id: row.get(5)?,
        origin_document_id: row.get(6)?,
        origin_segment_id: row.get(7)?,
        base_document_revision: read_u64(row, 8)?,
        base_segment_revision: read_u64(row, 9)?,
        base_source_hash: row.get(10)?,
        base_projection: read_json_struct(row, 11)?,
        source_entry: row.get(12)?,
        tag_id_map: read_json_struct(row, 13)?,
        comment_id_map: read_json_struct(row, 14)?,
        created_at_ms: row.get(15)?,
    })
}

fn read_json_struct<T: serde::de::DeserializeOwned>(
    row: &Row<'_>,
    index: usize,
) -> rusqlite::Result<T> {
    let value = row.get::<_, String>(index)?;
    serde_json::from_str(&value).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(
            index,
            rusqlite::types::Type::Text,
            Box::new(error),
        )
    })
}

fn find_project_optional(connection: &Connection, project_id: &str) -> Result<Option<Project>> {
    connection
        .query_row(
            "SELECT id, name, source_locale, target_locale, domain, lifecycle, revision,
                    configuration_json, created_at_ms, updated_at_ms, archived_at_ms
             FROM projects WHERE id = ?1",
            [project_id],
            row_to_project,
        )
        .optional()
        .map_err(Into::into)
}

fn find_origin_segment(connection: &Connection, segment_id: &str) -> Result<Option<Segment>> {
    connection
        .query_row(
            "SELECT id, document_id, ordinal, structural_path, source_text, target_text,
                    state, revision, source_hash, context_hash, updated_at_ms
             FROM segments WHERE id = ?1",
            [segment_id],
            row_to_segment,
        )
        .optional()
        .map_err(Into::into)
}

fn find_document_for_project(
    connection: &Connection,
    document_id: &str,
    project_id: &str,
) -> Result<Document> {
    let document = find_document(connection, document_id)?;
    if document.project_id != project_id {
        return Err(StorageError::InvalidState(
            "task package document does not belong to the origin project".to_string(),
        ));
    }
    Ok(document)
}

fn parse_segment_state(value: &str) -> Result<SegmentState> {
    match value {
        "untranslated" | "" => Ok(SegmentState::Untranslated),
        "draft" => Ok(SegmentState::Draft),
        "confirmed" => Ok(SegmentState::Confirmed),
        _ => Err(StorageError::InvalidState(
            "task package segment state is invalid".to_string(),
        )),
    }
}

fn parse_workflow_state(value: &str) -> Result<EditorWorkflowState> {
    match value {
        "translation" | "" => Ok(EditorWorkflowState::Translation),
        "review" => Ok(EditorWorkflowState::Review),
        "signed" => Ok(EditorWorkflowState::Signed),
        _ => Err(StorageError::InvalidState(
            "task package workflow state is invalid".to_string(),
        )),
    }
}

fn apply_task_package_projection(
    transaction: &Transaction<'_>,
    current: &Segment,
    remote: &TaskPackageProjection,
    project_id: &str,
    actor: &str,
    reason: &str,
    now: i64,
) -> Result<Segment> {
    if current.source_text != remote.source_text
        || current.source_hash != remote.source_hash
        || current.structural_path != remote.structural_path
    {
        return Err(StorageError::InvalidState(
            "task package cannot change immutable source content".to_string(),
        ));
    }
    let state = parse_segment_state(&remote.segment_state)?;
    let workflow = parse_workflow_state(&remote.workflow_state)?;
    if state == SegmentState::Confirmed && remote.target_text.trim().is_empty() {
        return Err(StorageError::InvalidState(
            "task package cannot confirm an empty target".to_string(),
        ));
    }
    let tags = decode_tags(&remote.tags_json)?;
    let current_source_tags = list_inline_tags(transaction, &current.id, TagSide::Source)?;
    if current_source_tags != tags.source
        || !validate_target_tags(&current_source_tags, &tags.target, &remote.target_text).is_empty()
    {
        return Err(StorageError::InvalidState(
            "task package protected tag projection is invalid".to_string(),
        ));
    }
    let next = next_revision(current.revision)?;
    let changed = transaction.execute(
        "UPDATE segments
         SET target_text = ?1, state = ?2, revision = ?3, updated_at_ms = ?4
         WHERE id = ?5 AND revision = ?6",
        params![
            &remote.target_text,
            segment_state_text(state),
            to_i64(next)?,
            now,
            &current.id,
            to_i64(current.revision)?,
        ],
    )?;
    if changed != 1 {
        let actual = find_segment(transaction, &current.id)?.revision;
        return Err(StorageError::Conflict {
            segment_id: current.id.clone(),
            expected_revision: current.revision,
            actual_revision: actual,
        });
    }
    transaction.execute(
        "UPDATE segment_editor_meta SET workflow_state = ?1, updated_at_ms = ?2
         WHERE segment_id = ?3",
        params![editor_workflow_state_text(workflow), now, &current.id],
    )?;
    transaction.execute(
        "DELETE FROM inline_tags WHERE segment_id = ?1 AND side = 'target'",
        [&current.id],
    )?;
    insert_target_tags(transaction, &current.id, &tags.target)?;
    reconcile_task_package_comments(transaction, &current.id, &remote.comments_json, now)?;
    let updated = find_segment(transaction, &current.id)?;
    if updated.state == SegmentState::Confirmed {
        let memory_id = transaction
            .query_row(
                "SELECT id FROM translation_memories
                 WHERE project_id = ?1 AND writable = 1 ORDER BY id LIMIT 1",
                [project_id],
                |row| row.get::<_, String>(0),
            )
            .optional()?
            .ok_or_else(|| {
                StorageError::InvalidData(
                    "origin project has no writable translation memory".to_string(),
                )
            })?;
        upsert_tm_entry(transaction, &updated, project_id, &memory_id, now)?;
        sink_segment_to_asset_libraries(transaction, &updated, project_id, now)?;
    }
    let _ = reconcile_number_qa(transaction, &updated, now)?;
    let _ = reconcile_forbidden_term_qa(transaction, &updated, project_id, now)?;
    qa::reconcile_segment_local_qa(transaction, &updated.id, now)?;
    let _ = actor;
    let _ = reason;
    Ok(updated)
}

fn reconcile_task_package_comments(
    transaction: &Transaction<'_>,
    segment_id: &str,
    projection_json: &str,
    now: i64,
) -> Result<()> {
    let remote = decode_comments(projection_json)?;
    let remote_ids = remote
        .iter()
        .map(|comment| comment.id.as_str())
        .collect::<BTreeSet<_>>();
    if remote_ids.len() != remote.len() {
        return Err(StorageError::InvalidState(
            "task package comment projection contains duplicate IDs".to_string(),
        ));
    }
    let current = list_editor_comments(transaction, segment_id, true)?;
    let current_by_id = current
        .iter()
        .map(|comment| (comment.id.as_str(), comment))
        .collect::<BTreeMap<_, _>>();
    for comment in &remote {
        if let Some(existing) = current_by_id.get(comment.id.as_str()) {
            if existing.immutable
                && (existing.author != comment.author
                    || existing.text != comment.text
                    || existing.resolved != comment.resolved
                    || !comment.immutable)
            {
                return Err(StorageError::InvalidState(
                    "task package cannot modify an immutable comment".to_string(),
                ));
            }
            if existing.author == comment.author
                && existing.text == comment.text
                && existing.resolved == comment.resolved
                && existing.immutable == comment.immutable
            {
                continue;
            }
            transaction.execute(
                "UPDATE segment_comments
                 SET author = ?1, text = ?2, resolved = ?3, immutable = ?4,
                     revision = revision + 1, updated_at_ms = ?5
                 WHERE id = ?6 AND segment_id = ?7",
                params![
                    &comment.author,
                    &comment.text,
                    comment.resolved,
                    comment.immutable,
                    now,
                    &comment.id,
                    segment_id,
                ],
            )?;
        } else {
            let collision = transaction
                .query_row(
                    "SELECT segment_id FROM segment_comments WHERE id = ?1",
                    [&comment.id],
                    |row| row.get::<_, String>(0),
                )
                .optional()?;
            if collision.is_some() {
                return Err(StorageError::InvalidState(
                    "task package comment identity collides with another segment".to_string(),
                ));
            }
            transaction.execute(
                "INSERT INTO segment_comments (
                    id, segment_id, author, text, created_at_ms, updated_at_ms,
                    revision, resolved, immutable
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?5, 0, ?6, ?7)",
                params![
                    &comment.id,
                    segment_id,
                    &comment.author,
                    &comment.text,
                    now,
                    comment.resolved,
                    comment.immutable,
                ],
            )?;
        }
    }
    for comment in current {
        if !remote_ids.contains(comment.id.as_str()) {
            if comment.immutable {
                return Err(StorageError::InvalidState(
                    "task package cannot remove an immutable comment".to_string(),
                ));
            }
            transaction.execute(
                "DELETE FROM segment_comments WHERE id = ?1 AND segment_id = ?2",
                params![comment.id, segment_id],
            )?;
        }
    }
    Ok(())
}

fn import_task_package_assets(
    transaction: &Transaction<'_>,
    project: &Project,
    slices: &[translunar_task_package_core::TaskPackageAssetSlicePayload],
) -> Result<()> {
    let total = slices.iter().try_fold(0_usize, |total, slice| {
        total.checked_add(slice.rows.len()).ok_or_else(|| {
            StorageError::InvalidData("task package asset row count overflow".to_string())
        })
    })?;
    if total > translunar_task_package_core::MAX_ASSET_ROWS {
        return Err(StorageError::InvalidState(
            "task package asset slices exceed the row limit".to_string(),
        ));
    }
    for (priority, slice) in slices.iter().enumerate() {
        match slice.kind.as_str() {
            "tm" => import_task_tm_slice(transaction, project, slice, priority)?,
            "termbase" | "tb" => import_task_termbase_slice(transaction, project, slice, priority)?,
            _ => {
                return Err(StorageError::InvalidState(
                    "task package asset slice kind is unsupported".to_string(),
                ));
            }
        }
    }
    Ok(())
}

fn import_task_tm_slice(
    transaction: &Transaction<'_>,
    project: &Project,
    slice: &translunar_task_package_core::TaskPackageAssetSlicePayload,
    priority: usize,
) -> Result<()> {
    let library_id = new_id();
    let now = now_ms();
    transaction.execute(
        "INSERT INTO tm_libraries (
            id, name, source_locale, target_locale, domain, owner_project_id,
            writable, revision, created_at_ms, updated_at_ms
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, 0, ?7, ?7)",
        params![
            &library_id,
            &slice.name,
            &slice.source_locale,
            &slice.target_locale,
            &project.domain,
            &project.id,
            now,
        ],
    )?;
    transaction.execute(
        "INSERT INTO tm_library_mounts (
            project_id, library_id, mode, priority, enabled, revision,
            created_at_ms, updated_at_ms
         ) VALUES (?1, ?2, 'read', ?3, 1, 0, ?4, ?4)",
        params![&project.id, &library_id, to_i64(priority as u64)?, now],
    )?;
    let mut seen = BTreeSet::new();
    for row in &slice.rows {
        if !seen.insert(row.row_id.as_str()) {
            return Err(StorageError::InvalidState(
                "task package TM slice contains duplicate row IDs".to_string(),
            ));
        }
        require_nonempty("task package TM source", &row.source_text)?;
        require_nonempty("task package TM target", &row.target_text)?;
        let mut metadata = if row.metadata_json.trim().is_empty() {
            BTreeMap::<String, String>::new()
        } else {
            serde_json::from_str(&row.metadata_json).map_err(|error| {
                StorageError::InvalidData(format!("task package TM metadata is invalid: {error}"))
            })?
        };
        metadata.insert(
            "taskPackageSourceLibraryId".to_string(),
            slice.library_id.clone(),
        );
        metadata.insert("taskPackageRowId".to_string(), row.row_id.clone());
        if !row.provenance_json.trim().is_empty() {
            metadata.insert(
                "taskPackageProvenance".to_string(),
                row.provenance_json.clone(),
            );
        }
        transaction.execute(
            "INSERT INTO tm_units (
                id, library_id, source_locale, target_locale, source_text,
                target_text, source_hash, source_key, target_hash, domain,
                origin_project_id, origin_document_id, origin_segment_id,
                context_before_hash, context_after_hash, author, metadata_json,
                created_at_ms, updated_at_ms
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, NULL, NULL,
                       NULL, NULL, NULL, 'task-package', ?11, ?12, ?12)",
            params![
                new_id(),
                &library_id,
                &slice.source_locale,
                &slice.target_locale,
                &row.source_text,
                &row.target_text,
                translunar_domain::sha256_hex(normalize_match_key(&row.source_text).as_bytes()),
                exact_key(&row.source_text),
                translunar_domain::sha256_hex(normalize_match_key(&row.target_text).as_bytes()),
                &project.domain,
                serde_json::to_string(&metadata)?,
                now,
            ],
        )?;
    }
    Ok(())
}

fn import_task_termbase_slice(
    transaction: &Transaction<'_>,
    project: &Project,
    slice: &translunar_task_package_core::TaskPackageAssetSlicePayload,
    priority: usize,
) -> Result<()> {
    let termbase_id = new_id();
    let now = now_ms();
    transaction.execute(
        "INSERT INTO termbases (
            id, name, source_locale, domain, writable, revision,
            created_at_ms, updated_at_ms, owner_project_id
         ) VALUES (?1, ?2, ?3, ?4, 0, 0, ?5, ?5, ?6)",
        params![
            &termbase_id,
            &slice.name,
            &slice.source_locale,
            &project.domain,
            now,
            &project.id,
        ],
    )?;
    transaction.execute(
        "INSERT INTO termbase_mounts (
            project_id, termbase_id, priority, writable, enabled, revision,
            created_at_ms, updated_at_ms
         ) VALUES (?1, ?2, ?3, 0, 1, 0, ?4, ?4)",
        params![&project.id, &termbase_id, to_i64(priority as u64)?, now],
    )?;
    let mut seen = BTreeSet::new();
    for row in &slice.rows {
        if !seen.insert(row.row_id.as_str()) {
            return Err(StorageError::InvalidState(
                "task package termbase slice contains duplicate row IDs".to_string(),
            ));
        }
        require_nonempty("task package source term", &row.source_text)?;
        require_nonempty("task package target term", &row.target_text)?;
        let entry_id = new_id();
        transaction.execute(
            "INSERT INTO term_entries (
                id, termbase_id, source_locale, source_term, source_key,
                part_of_speech, definition, example, domain, status, revision,
                created_at_ms, updated_at_ms
             ) VALUES (?1, ?2, ?3, ?4, ?5, NULL, NULL, NULL, ?6, 'approved', 0,
                       ?7, ?7)",
            params![
                &entry_id,
                &termbase_id,
                &slice.source_locale,
                &row.source_text,
                normalize_match_key(&row.source_text),
                &project.domain,
                now,
            ],
        )?;
        transaction.execute(
            "INSERT INTO term_translations (
                id, entry_id, locale, term, term_key, preferred, forbidden,
                created_at_ms, updated_at_ms
             ) VALUES (?1, ?2, ?3, ?4, ?5, 1, 0, ?6, ?6)",
            params![
                new_id(),
                &entry_id,
                &slice.target_locale,
                &row.target_text,
                normalize_match_key(&row.target_text),
                now,
            ],
        )?;
    }
    Ok(())
}

fn remove_staged_file(paths: &DataPaths, stored_path: &str) -> bool {
    let candidate = Path::new(stored_path);
    let candidate = if candidate.is_absolute() {
        candidate.to_path_buf()
    } else {
        paths.root.join(candidate)
    };
    let Ok(parent) = candidate.parent().unwrap_or(&paths.root).canonicalize() else {
        return false;
    };
    let allowed = [&paths.temporary, &paths.exports]
        .iter()
        .filter_map(|path| path.canonicalize().ok())
        .any(|root| parent.starts_with(root));
    allowed && candidate.is_file() && fs::remove_file(candidate).is_ok()
}

fn validate_task_package_path(paths: &DataPaths, value: &str, managed: bool) -> Result<()> {
    require_nonempty("task package path", value)?;
    let normalized = if managed {
        let stored = stored_managed_source_path(paths, Path::new(value));
        if Path::new(&stored).is_absolute() {
            return Err(StorageError::InvalidState(
                "task package managed source must remain inside the workspace".to_string(),
            ));
        }
        stored.replace('\\', "/")
    } else {
        value.to_string()
    };
    translunar_task_package_core::validate_safe_path(&normalized)?;
    if managed && !normalized.starts_with("sources/") {
        return Err(StorageError::InvalidState(
            "task package managed source must be stored under sources/".to_string(),
        ));
    }
    Ok(())
}

fn validate_preview_staged_path(paths: &DataPaths, value: &str) -> Result<()> {
    validate_preview_staged_path_text(value)?;
    let normalized = value.replace('\\', "/");
    let candidate = paths.root.join(&normalized);
    let temporary = paths.temporary.canonicalize()?;
    let parent = candidate
        .parent()
        .ok_or_else(|| invalid_package("task package preview path has no parent"))?
        .canonicalize()?;
    if !parent.starts_with(temporary) {
        return Err(invalid_package(
            "task package preview must remain under workspace tmp/",
        ));
    }
    Ok(())
}

fn validate_preview_staged_path_text(value: &str) -> Result<()> {
    require_nonempty("task package preview staged path", value)?;
    let path = Path::new(value);
    if path.is_absolute() {
        return Err(invalid_package(
            "task package preview staged path must be workspace-relative",
        ));
    }
    let normalized = value.replace('\\', "/");
    translunar_task_package_core::validate_safe_path(&normalized)?;
    if !normalized.starts_with("tmp/") {
        return Err(invalid_package(
            "task package preview must be staged under tmp/",
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;
    use translunar_task_package_core::{
        TaskPackageDocumentRef, TaskPackageEntry, canonical_sha256,
    };

    fn manifest(
        package_id: &str,
        project: &Project,
        document: &TaskPackageDocumentSnapshot,
        kind: TaskPackageKind,
        parent_package_id: Option<String>,
    ) -> TaskPackageManifest {
        let mut manifest = TaskPackageManifest {
            format_version: translunar_task_package_core::TASK_PACKAGE_FORMAT_VERSION,
            package_id: package_id.to_string(),
            kind,
            project_id: project.id.clone(),
            project_name: project.name.clone(),
            source_locale: project.source_locale.clone(),
            target_locale: project.target_locale.clone(),
            base_project_revision: project.revision,
            parent_package_id,
            instruction_sha256: None,
            documents: vec![TaskPackageDocumentRef {
                origin_document_id: document.document.id.clone(),
                name: document.document.name.clone(),
                format: document.document.format.clone(),
                source_sha256: document.document.source_sha256.clone(),
                base_revision: document
                    .projections
                    .first()
                    .map(|projection| projection.base_revision)
                    .unwrap_or_default(),
                segment_count: document.projections.len() as u32,
            }],
            asset_slices: Vec::new(),
            entries: vec![
                TaskPackageEntry {
                    path: "manifest.json".to_string(),
                    size_bytes: 1,
                    sha256: translunar_task_package_core::sha256_hex(b"x"),
                },
                TaskPackageEntry {
                    path: format!("documents/{}/source.txt", document.document.id),
                    size_bytes: 6,
                    sha256: document.document.source_sha256.clone(),
                },
            ],
            manifest_hash: String::new(),
        };
        manifest.manifest_hash = canonical_sha256(&manifest).expect("manifest digest");
        manifest
    }

    #[test]
    fn assignment_snapshot_preview_and_import_are_atomic() {
        let root = tempdir().expect("temporary store");
        let mut store = Store::open(root.path()).expect("open store");
        let project = store
            .create_project("Owner", "en", "zh", "general")
            .expect("create project");
        let managed = store.paths().managed_source("origin-doc", "txt");
        let source = root.path().join("source.txt");
        std::fs::write(&source, "Source").expect("write source");
        let source_hash = translunar_domain::sha256_hex(b"Source");
        let document = store
            .insert_document(
                &NewDocument {
                    id: "origin-doc".to_string(),
                    project_id: project.id.clone(),
                    name: "source.txt".to_string(),
                    relative_path: "source.txt".to_string(),
                    format: "txt".to_string(),
                    filter_id: "builtin.txt".to_string(),
                    source_sha256: source_hash,
                    degradation: Vec::new(),
                    original_source_path: source.clone(),
                    managed_source_path: managed.clone(),
                },
                &[ImportedUnit::plain(0, "txt:0", "Source")],
            )
            .expect("insert document");
        let snapshot = store
            .snapshot_task_package_assignment(
                &project.id,
                project.revision,
                &[TaskPackageAssignmentSelection {
                    document_id: document.id.clone(),
                    segment_ids: Vec::new(),
                }],
            )
            .expect("snapshot assignment");
        let document_snapshot = snapshot.documents.first().expect("document snapshot");
        let assignment_manifest = manifest(
            "assignment-1",
            &snapshot.project,
            document_snapshot,
            TaskPackageKind::Assignment,
            None,
        );
        let record = store
            .record_task_package_export(TaskPackageExportRecord {
                manifest: assignment_manifest.clone(),
                working_project_id: None,
                staged_path: "tmp/assignment-1.tltask".to_string(),
                actor: "owner".to_string(),
                reason: "handoff".to_string(),
                base_projections: document_snapshot.projections.clone(),
            })
            .expect("record assignment");
        assert_eq!(record.status, TaskPackageRecordStatus::Staged);
        let payload = TaskPackageDocumentPayload {
            origin_document_id: document_snapshot.document.id.clone(),
            source_sha256: document_snapshot.document.source_sha256.clone(),
            base_revision: document_snapshot
                .projections
                .first()
                .expect("projection")
                .base_revision,
            source_entry: "documents/origin-doc/source.txt".to_string(),
            segments: document_snapshot.projections.clone(),
        };
        let preview = store
            .create_task_package_assignment_preview(TaskPackageAssignmentPreview {
                id: "preview-assignment-1".to_string(),
                package: TaskPackageExportRecord {
                    manifest: assignment_manifest.clone(),
                    working_project_id: None,
                    staged_path: "tmp/assignment-1.tltask".to_string(),
                    actor: "owner".to_string(),
                    reason: "preview".to_string(),
                    base_projections: Vec::new(),
                },
                staged_path: "tmp/assignment-1.tltask".to_string(),
                documents: vec![payload.clone()],
                diagnostics: Vec::new(),
                actor: "owner".to_string(),
                reason: "preview".to_string(),
            })
            .expect("preview assignment");
        assert_eq!(preview.counts.total, 1);
        let duplicate_payload = payload.clone();
        let imported = store
            .import_task_package_assignment(TaskPackageAssignmentImport {
                preview_id: preview.id,
                local_project_id: "task-project-1".to_string(),
                project_name: "Detached".to_string(),
                domain: "general".to_string(),
                instructions: "Translate offline".to_string(),
                documents: vec![TaskPackageDocumentImport {
                    local_document_id: "task-doc-1".to_string(),
                    origin_document_id: payload.origin_document_id,
                    name: "source.txt".to_string(),
                    relative_path: "source.txt".to_string(),
                    format: "txt".to_string(),
                    filter_id: "builtin.txt".to_string(),
                    source_sha256: payload.source_sha256,
                    original_source_path: "assignment/source.txt".to_string(),
                    managed_source_path: "sources/task-doc-1.txt".to_string(),
                    source_entry: payload.source_entry,
                    projections: payload.segments,
                }],
                asset_slices: Vec::new(),
                actor: "recipient".to_string(),
                reason: "start task".to_string(),
            })
            .expect("import assignment");
        assert_eq!(imported.project.id, "task-project-1");
        assert_eq!(imported.binding_count, 1);
        let bindings =
            list_task_package_bindings(&store.connection, "assignment-1").expect("bindings");
        assert_eq!(bindings.len(), 1);
        assert_eq!(
            bindings[0].origin_segment_id,
            document_snapshot.projections[0].origin_segment_id
        );
        assert!(
            store
                .create_task_package_assignment_preview(TaskPackageAssignmentPreview {
                    id: "preview-assignment-duplicate".to_string(),
                    package: TaskPackageExportRecord {
                        manifest: assignment_manifest.clone(),
                        working_project_id: None,
                        staged_path: "tmp/assignment-1.tltask".to_string(),
                        actor: "owner".to_string(),
                        reason: "duplicate preview".to_string(),
                        base_projections: Vec::new(),
                    },
                    staged_path: "tmp/assignment-1.tltask".to_string(),
                    documents: vec![duplicate_payload],
                    diagnostics: Vec::new(),
                    actor: "owner".to_string(),
                    reason: "duplicate preview".to_string(),
                })
                .is_err()
        );
    }

    #[test]
    fn discard_removes_all_task_package_preview_staging_files() {
        let root = tempdir().expect("temporary store");
        let mut store = Store::open(root.path()).expect("open store");
        let project = store
            .create_project("Owner", "en", "zh", "general")
            .expect("create project");
        let source = root.path().join("source.txt");
        std::fs::write(&source, "Source").expect("write source");
        let document = store
            .insert_document(
                &NewDocument {
                    id: "discard-origin-doc".to_string(),
                    project_id: project.id.clone(),
                    name: "source.txt".to_string(),
                    relative_path: "source.txt".to_string(),
                    format: "txt".to_string(),
                    filter_id: "builtin.txt".to_string(),
                    source_sha256: translunar_domain::sha256_hex(b"Source"),
                    degradation: Vec::new(),
                    original_source_path: source,
                    managed_source_path: store.paths().managed_source("discard-origin-doc", "txt"),
                },
                &[ImportedUnit::plain(0, "txt:0", "Source")],
            )
            .expect("insert document");
        let snapshot = store
            .snapshot_task_package_assignment(
                &project.id,
                project.revision,
                &[TaskPackageAssignmentSelection {
                    document_id: document.id.clone(),
                    segment_ids: Vec::new(),
                }],
            )
            .expect("snapshot assignment");
        let document_snapshot = snapshot.documents.first().expect("document snapshot");
        let package_manifest = manifest(
            "discard-package",
            &snapshot.project,
            document_snapshot,
            TaskPackageKind::Assignment,
            None,
        );
        let payload = TaskPackageDocumentPayload {
            origin_document_id: document.id.clone(),
            source_sha256: document.source_sha256.clone(),
            base_revision: document_snapshot.projections[0].base_revision,
            source_entry: "documents/discard-origin-doc/source.txt".to_string(),
            segments: document_snapshot.projections.clone(),
        };
        let first_path = root.path().join("tmp/first.tltask");
        let second_path = root.path().join("tmp/second.tltask");
        std::fs::write(&first_path, b"first").expect("write first staged file");
        std::fs::write(&second_path, b"second").expect("write second staged file");
        store
            .record_task_package_export(TaskPackageExportRecord {
                manifest: package_manifest.clone(),
                working_project_id: None,
                staged_path: "tmp/first.tltask".to_string(),
                actor: "owner".to_string(),
                reason: "handoff".to_string(),
                base_projections: document_snapshot.projections.clone(),
            })
            .expect("record package");
        for (preview_id, staged_path) in [
            ("discard-preview-1", "tmp/first.tltask"),
            ("discard-preview-2", "tmp/second.tltask"),
        ] {
            store
                .create_task_package_assignment_preview(TaskPackageAssignmentPreview {
                    id: preview_id.to_string(),
                    package: TaskPackageExportRecord {
                        manifest: package_manifest.clone(),
                        working_project_id: None,
                        staged_path: staged_path.to_string(),
                        actor: "owner".to_string(),
                        reason: "preview".to_string(),
                        base_projections: Vec::new(),
                    },
                    staged_path: staged_path.to_string(),
                    documents: vec![payload.clone()],
                    diagnostics: Vec::new(),
                    actor: "owner".to_string(),
                    reason: "preview".to_string(),
                })
                .expect("create preview");
        }
        let discarded = store
            .discard_task_package(
                "discard-package",
                Some("discard-preview-1"),
                "owner",
                "cancel handoff",
            )
            .expect("discard package");
        assert!(discarded.removed_staged_file);
        assert!(!first_path.exists());
        assert!(!second_path.exists());
        assert_eq!(
            store
                .get_task_package_preview("discard-preview-1")
                .expect("first preview")
                .status,
            TaskPackagePreviewStatus::Discarded
        );
        assert_eq!(
            store
                .get_task_package_preview("discard-preview-2")
                .expect("second preview")
                .status,
            TaskPackagePreviewStatus::Discarded
        );
        assert_eq!(
            store
                .get_task_package("discard-package")
                .expect("package")
                .status,
            TaskPackageRecordStatus::Discarded
        );
    }

    #[test]
    fn return_preview_classifies_and_applies_remote_change_idempotently() {
        let root = tempdir().expect("temporary store");
        let mut store = Store::open(root.path()).expect("open store");
        let owner = store
            .create_project("Owner", "en", "zh", "general")
            .expect("create owner");
        let source_hash = translunar_domain::sha256_hex(b"Source");
        let document = store
            .insert_document(
                &NewDocument {
                    id: "origin-doc-return".to_string(),
                    project_id: owner.id.clone(),
                    name: "source.txt".to_string(),
                    relative_path: "source.txt".to_string(),
                    format: "txt".to_string(),
                    filter_id: "builtin.txt".to_string(),
                    source_sha256: source_hash,
                    degradation: Vec::new(),
                    original_source_path: root.path().join("source.txt"),
                    managed_source_path: store.paths().managed_source("origin-doc-return", "txt"),
                },
                &[ImportedUnit::plain(0, "txt:0", "Source")],
            )
            .expect("insert owner document");
        let assignment = store
            .snapshot_task_package_assignment(
                &owner.id,
                owner.revision,
                &[TaskPackageAssignmentSelection {
                    document_id: document.id.clone(),
                    segment_ids: Vec::new(),
                }],
            )
            .expect("snapshot owner");
        let assignment_doc = assignment.documents.first().expect("assignment doc");
        let assignment_manifest = manifest(
            "assignment-return-1",
            &owner,
            assignment_doc,
            TaskPackageKind::Assignment,
            None,
        );
        store
            .record_task_package_export(TaskPackageExportRecord {
                manifest: assignment_manifest.clone(),
                working_project_id: None,
                staged_path: "tmp/assignment-return-1.tltask".to_string(),
                actor: "owner".to_string(),
                reason: "handoff".to_string(),
                base_projections: assignment_doc.projections.clone(),
            })
            .expect("record assignment");
        let assignment_preview = store
            .create_task_package_assignment_preview(TaskPackageAssignmentPreview {
                id: "preview-return-assignment".to_string(),
                package: TaskPackageExportRecord {
                    manifest: assignment_manifest,
                    working_project_id: None,
                    staged_path: "tmp/assignment-return-1.tltask".to_string(),
                    actor: "owner".to_string(),
                    reason: "preview".to_string(),
                    base_projections: Vec::new(),
                },
                staged_path: "tmp/assignment-return-1.tltask".to_string(),
                documents: vec![TaskPackageDocumentPayload {
                    origin_document_id: assignment_doc.document.id.clone(),
                    source_sha256: assignment_doc.document.source_sha256.clone(),
                    base_revision: assignment_doc.projections[0].base_revision,
                    source_entry: "documents/origin-doc-return/source.txt".to_string(),
                    segments: assignment_doc.projections.clone(),
                }],
                diagnostics: Vec::new(),
                actor: "owner".to_string(),
                reason: "preview".to_string(),
            })
            .expect("assignment preview");
        let imported = store
            .import_task_package_assignment(TaskPackageAssignmentImport {
                preview_id: assignment_preview.id,
                local_project_id: "task-project-return".to_string(),
                project_name: "Detached".to_string(),
                domain: "general".to_string(),
                instructions: String::new(),
                documents: vec![TaskPackageDocumentImport {
                    local_document_id: "task-doc-return".to_string(),
                    origin_document_id: assignment_doc.document.id.clone(),
                    name: "source.txt".to_string(),
                    relative_path: "source.txt".to_string(),
                    format: "txt".to_string(),
                    filter_id: "builtin.txt".to_string(),
                    source_sha256: assignment_doc.document.source_sha256.clone(),
                    original_source_path: "source.txt".to_string(),
                    managed_source_path: "sources/task-doc-return.txt".to_string(),
                    source_entry: "documents/origin-doc-return/source.txt".to_string(),
                    projections: assignment_doc.projections.clone(),
                }],
                asset_slices: Vec::new(),
                actor: "recipient".to_string(),
                reason: "start".to_string(),
            })
            .expect("import task");
        let local_segment_id = store
            .all_segments(&imported.documents[0].id)
            .expect("local segments")[0]
            .id
            .clone();
        store
            .connection
            .execute(
                "UPDATE segments SET target_text = 'Translated', state = 'draft', revision = 1
                 WHERE id = ?1",
                [&local_segment_id],
            )
            .expect("edit detached target");
        let returned = store
            .snapshot_task_package_return("task-project-return", "assignment-return-1")
            .expect("snapshot return");
        assert_eq!(returned.documents[0].rows.len(), 1);
        let mut added_base = assignment_doc.projections[0].clone();
        added_base.origin_segment_id = "added-segment".to_string();
        added_base.target_text.clear();
        added_base.projection_hash.clear();
        let added_base = added_base
            .with_computed_hash()
            .expect("added base projection");
        let mut added_remote = added_base.clone();
        added_remote.target_text = "Added translation".to_string();
        added_remote.segment_state = "draft".to_string();
        added_remote.projection_hash.clear();
        let added_remote = added_remote
            .with_computed_hash()
            .expect("added remote projection");
        let mut return_documents = returned.documents.clone();
        return_documents[0]
            .rows
            .push(translunar_task_package_core::TaskPackageReturnRow {
                base: added_base,
                remote: Some(added_remote),
                dependency_ok: true,
            });
        let return_manifest = manifest(
            "return-1",
            &owner,
            assignment_doc,
            TaskPackageKind::Return,
            Some("assignment-return-1".to_string()),
        );
        let return_base = returned.documents[0].rows[0].base.clone();
        store
            .record_task_package_export(TaskPackageExportRecord {
                manifest: return_manifest.clone(),
                working_project_id: Some("task-project-return".to_string()),
                staged_path: "tmp/return-1.tltask".to_string(),
                actor: "recipient".to_string(),
                reason: "return".to_string(),
                base_projections: vec![return_base],
            })
            .expect("record return");
        let preview = store
            .create_task_package_return_preview(TaskPackageReturnPreview {
                id: "preview-return-1".to_string(),
                package: TaskPackageExportRecord {
                    manifest: return_manifest,
                    working_project_id: Some("task-project-return".to_string()),
                    staged_path: "tmp/return-1.tltask".to_string(),
                    actor: "recipient".to_string(),
                    reason: "preview".to_string(),
                    base_projections: Vec::new(),
                },
                staged_path: "tmp/return-1.tltask".to_string(),
                documents: return_documents,
                diagnostics: Vec::new(),
                actor: "owner".to_string(),
                reason: "preview".to_string(),
            })
            .expect("return preview");
        assert_eq!(preview.counts.remote_changed, 1);
        assert_eq!(preview.counts.added, 1);
        let rows = store
            .list_task_package_preview_rows(&preview.id, 0, 20)
            .expect("preview rows")
            .0;
        let row_id = rows
            .iter()
            .find(|row| row.disposition == TaskPackageDisposition::RemoteChanged)
            .expect("remote-changed row")
            .row_id
            .clone();
        let applied = store
            .apply_task_package(TaskPackageApply {
                preview_id: preview.id.clone(),
                expected_project_revision: preview.expected_project_revision,
                selected_row_ids: vec![row_id.clone()],
                actor: "owner".to_string(),
                reason: "merge".to_string(),
            })
            .expect("apply return");
        assert_eq!(applied.applied_count, 1);
        let replay = store
            .apply_task_package(TaskPackageApply {
                preview_id: preview.id,
                expected_project_revision: applied.project_revision - 1,
                selected_row_ids: vec![row_id],
                actor: "owner".to_string(),
                reason: "merge".to_string(),
            })
            .expect("idempotent replay");
        assert_eq!(replay.operation_id, applied.operation_id);
        let owner_segment = store.all_segments(&document.id).expect("owner segments")[0].clone();
        assert_eq!(owner_segment.target_text, "Translated");
    }
}

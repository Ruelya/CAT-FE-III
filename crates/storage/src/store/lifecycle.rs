use std::collections::BTreeMap;

use rusqlite::{OptionalExtension, Transaction, TransactionBehavior, params};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use translunar_asset_core::{
    AssetMountMode, TermEntry, TermStatus, Termbase, TermbaseMount, TmLibrary, TmLibraryMount,
    TmUnit, exact_key, normalize_match_key,
};
use translunar_domain::{
    Document, DocumentNote, DocumentVersion, EditorComment, EditorPreferences, EditorWorkflowState,
    InlineTag, Operation, Project, ProjectConfiguration, ProjectLifecycle, QaIssue, ReviewRevision,
    Segment, TranslationMemory, new_id, normalize_text, segment_hashes, sha256_hex,
};
use translunar_filter_core::ImportedUnit;
use translunar_lifecycle_core::{
    AiContributionSummary, AnalysisSegment, AnalysisSummary, AnalysisWeights, AnalyticsTrendBucket,
    ArchiveDependency, AssetHealthSummary, OptionalCountMetric, PROJECT_ARCHIVE_FORMAT_VERSION,
    ProductivitySummary, ProgressSummary, ProjectAnalyticsSummary, ReimportPlan, ReimportSegment,
    WorkflowBucket, active_editing_ms, analyze_segments, plan_reimport,
};

use super::{
    Store, append_operation, create_project_in_transaction, editor_workflow_state_text,
    ensure_entity_revision, find_project, find_termbase, find_tm_library, next_revision, now_ms,
    project_lifecycle_text, qa_issue_status_text, qa_severity_text, read_optional_u64, read_u64,
    require_nonempty, review_status_text, row_to_document, segment_state_text, tag_kind_text,
    tag_side_text, to_i64, to_u32,
};
use crate::{Result, StorageError};

pub const DEFAULT_RECYCLE_RETENTION_MS: i64 = 30 * 24 * 60 * 60 * 1_000;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectTemplateRecord {
    pub id: String,
    pub revision: u64,
    pub name: String,
    pub description: String,
    pub definition: Value,
    pub built_in: bool,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisProfileRecord {
    pub id: String,
    pub revision: u64,
    pub name: String,
    pub weights: AnalysisWeights,
    pub built_in: bool,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisRunRecord {
    pub id: String,
    pub project_id: String,
    pub document_id: Option<String>,
    pub profile_id: String,
    pub profile_revision: u64,
    pub project_revision: u64,
    pub document_revision: Option<u64>,
    pub stale: bool,
    pub summary: AnalysisSummary,
    pub document_summaries: BTreeMap<String, AnalysisSummary>,
    pub created_at_ms: i64,
    pub completed_at_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecycleEntryRecord {
    pub id: String,
    pub project_id: String,
    pub entity_type: String,
    pub entity_id: String,
    pub display_name: String,
    pub previous_state: String,
    pub actor: String,
    pub reason: String,
    pub deleted_at_ms: i64,
    pub retention_until_ms: i64,
    pub restored_at_ms: Option<i64>,
    pub purged_at_ms: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GlobalSearchQuery {
    pub text: String,
    pub project_id: Option<String>,
    pub fields: Vec<String>,
    pub locale: Option<String>,
    pub workflow_state: Option<String>,
    pub updated_after_ms: Option<i64>,
    pub updated_before_ms: Option<i64>,
    pub include_recycled: bool,
    pub offset: u32,
    pub limit: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GlobalSearchResult {
    pub project_id: String,
    pub project_name: String,
    pub document_id: Option<String>,
    pub document_name: Option<String>,
    pub segment_id: Option<String>,
    pub segment_ordinal: Option<u32>,
    pub field: String,
    pub locale: Option<String>,
    pub workflow_state: Option<String>,
    pub snippet: String,
    pub updated_at_ms: i64,
}

#[derive(Debug, Clone)]
pub struct NewReimportPreview {
    pub document_id: String,
    pub expected_document_revision: u64,
    pub candidate_source_sha256: String,
    pub original_source_path: String,
    pub staged_source_path: String,
    pub filter_id: String,
    pub options: BTreeMap<String, String>,
    pub actor: String,
    pub units: Vec<ImportedUnit>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TemplateDependencyResolution {
    pub kind: String,
    pub requested_id: String,
    pub resolved_id: Option<String>,
    pub status: String,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProjectFromTemplateResult {
    pub project: Project,
    pub diagnostics: Vec<TemplateDependencyResolution>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct TemplateDefinition {
    source_locale: Option<String>,
    target_locale: Option<String>,
    domain: Option<String>,
    qa_profile_id: Option<String>,
    pipeline_id: Option<String>,
    ai_profile_ids: Vec<String>,
    engine_allowlist: Vec<String>,
    analysis_profile_id: Option<String>,
    review_required: Option<bool>,
    editor_defaults: Option<EditorPreferences>,
    #[serde(alias = "tmLibraries")]
    tm_mounts: Vec<TemplateTmMount>,
    #[serde(alias = "termbases")]
    termbase_mounts: Vec<TemplateTermbaseMount>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct TemplateTmMount {
    id: String,
    mode: Option<String>,
    priority: Option<u32>,
    enabled: Option<bool>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct TemplateTermbaseMount {
    id: String,
    priority: Option<u32>,
    writable: Option<bool>,
    enabled: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReimportPreviewRecord {
    pub id: String,
    pub project_id: String,
    pub document_id: String,
    pub expected_document_revision: u64,
    pub candidate_source_sha256: String,
    pub plan: ReimportPlan,
    pub created_at_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredImportedUnit {
    ordinal: u32,
    structural_path: String,
    source_text: String,
    target_text: Option<String>,
    inline_tags: Vec<InlineTag>,
    notes: Vec<DocumentNote>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectArchiveData {
    pub project: Project,
    pub documents: Vec<ArchiveDocumentData>,
    pub operations: Vec<Operation>,
    pub dependencies: Vec<ArchiveDependency>,
    pub tm_libraries: Vec<ArchiveTmLibraryData>,
    pub termbases: Vec<ArchiveTermbaseData>,
    #[serde(default)]
    pub external_tm_mounts: Vec<TmLibraryMount>,
    #[serde(default)]
    pub external_termbase_mounts: Vec<TermbaseMount>,
}

#[derive(Debug, Clone)]
pub struct NewProjectArchiveRecord {
    pub archive_path: String,
    pub archive_sha256: String,
    pub manifest: Value,
    pub actor: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveDocumentData {
    pub document: Document,
    pub original_source_path: String,
    pub managed_source_path: String,
    pub segments: Vec<ArchiveSegmentData>,
    #[serde(default)]
    pub versions: Vec<ArchiveDocumentVersionData>,
    #[serde(default)]
    pub reimport_previews: Vec<ArchiveReimportPreviewData>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveSegmentData {
    pub segment: Segment,
    pub workflow_state: EditorWorkflowState,
    pub tags: Vec<InlineTag>,
    pub notes: Vec<DocumentNote>,
    pub comments: Vec<EditorComment>,
    pub reviews: Vec<ReviewRevision>,
    pub qa_issues: Vec<QaIssue>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveDocumentVersionData {
    pub version: DocumentVersion,
    pub superseded_segments: Vec<ArchiveVersionSegmentData>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveVersionSegmentData {
    pub old_segment_id: String,
    pub old_ordinal: u32,
    pub disposition: String,
    pub snapshot: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveReimportPreviewData {
    pub id: String,
    pub expected_document_revision: u64,
    pub candidate_source_sha256: String,
    pub original_source_path: String,
    pub staged_source_path: String,
    pub filter_id: String,
    pub options: BTreeMap<String, String>,
    pub status: String,
    pub actor: String,
    pub unchanged_count: u32,
    pub changed_count: u32,
    pub new_count: u32,
    pub removed_count: u32,
    pub ambiguous_count: u32,
    pub created_at_ms: i64,
    pub applied_at_ms: Option<i64>,
    pub items: Vec<ArchiveReimportItemData>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveReimportItemData {
    pub ordinal: u32,
    pub disposition: String,
    pub old_segment_id: Option<String>,
    pub new_segment_key: Option<String>,
    pub old_ordinal: Option<u32>,
    pub new_ordinal: Option<u32>,
    pub structural_path: Option<String>,
    pub source_text: Option<String>,
    pub imported_unit: Option<Value>,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveTmLibraryData {
    pub library: TmLibrary,
    pub mount: TmLibraryMount,
    pub units: Vec<TmUnit>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveTermbaseData {
    pub termbase: Termbase,
    pub mount: TermbaseMount,
    pub entries: Vec<TermEntry>,
}

impl Store {
    pub fn export_project_archive_data(&self, project_id: &str) -> Result<ProjectArchiveData> {
        let aggregate = self.get_project(project_id)?;
        let mut documents = Vec::with_capacity(aggregate.documents.len());
        for document in aggregate.documents {
            let managed = self.get_document(&document.id)?;
            let reviews = self.list_review_revisions(&document.id, true)?;
            let qa_issues = self.list_qa(&document.id, true)?;
            let mut segments = Vec::new();
            let mut offset = 0_u32;
            loop {
                let (page, total) = self.list_segments(&document.id, offset, 500)?;
                for segment in page {
                    let row = self.get_editor_row(&segment.id)?;
                    segments.push(ArchiveSegmentData {
                        segment,
                        workflow_state: row.workflow_state,
                        tags: row.source_tags.into_iter().chain(row.target_tags).collect(),
                        notes: self.list_segment_notes(&row.segment.id)?,
                        comments: row.comments,
                        reviews: reviews
                            .iter()
                            .filter(|review| review.segment_id == row.segment.id)
                            .cloned()
                            .collect(),
                        qa_issues: qa_issues
                            .iter()
                            .filter(|issue| issue.segment_id == row.segment.id)
                            .cloned()
                            .collect(),
                    });
                }
                offset = offset.saturating_add(500);
                if offset >= total {
                    break;
                }
            }
            documents.push(ArchiveDocumentData {
                versions: load_archive_document_versions(&self.connection, &document.id)?,
                reimport_previews: load_archive_reimport_previews(&self.connection, &document.id)?,
                document,
                original_source_path: managed.original_source_path.to_string_lossy().into_owned(),
                managed_source_path: managed
                    .managed_source_path
                    .strip_prefix(&self.paths.root)
                    .unwrap_or(&managed.managed_source_path)
                    .to_string_lossy()
                    .replace('\\', "/"),
                segments,
            });
        }
        let mut operations = Vec::new();
        let mut offset = 0_u32;
        loop {
            let (page, total) = self.list_operations(project_id, offset, 500, false)?;
            operations.extend(page);
            offset = offset.saturating_add(500);
            if offset >= total {
                break;
            }
        }
        let dependencies = archive_dependencies(&self.connection, project_id)?;
        let tm_mounts = self
            .list_tm_library_mounts(project_id)?
            .into_iter()
            .map(|mount| (mount.library_id.clone(), mount))
            .collect::<BTreeMap<_, _>>();
        let owned_tm_ids = {
            let mut statement = self
                .connection
                .prepare("SELECT id FROM tm_libraries WHERE owner_project_id = ?1 ORDER BY id")?;
            statement
                .query_map([project_id], |row| row.get::<_, String>(0))?
                .collect::<std::result::Result<Vec<_>, _>>()?
        };
        let mut tm_libraries = Vec::new();
        for library_id in owned_tm_ids {
            let library = self.get_tm_library(&library_id)?;
            let mount = tm_mounts.get(&library_id).cloned().ok_or_else(|| {
                StorageError::InvalidData("owned TM library is not mounted".to_string())
            })?;
            let mut units = Vec::new();
            let mut offset = 0_u32;
            loop {
                let (page, total) = self.list_tm_units(&library_id, offset, 500)?;
                units.extend(page);
                offset = offset.saturating_add(500);
                if offset >= total {
                    break;
                }
            }
            tm_libraries.push(ArchiveTmLibraryData {
                library,
                mount,
                units,
            });
        }
        let termbase_mounts = self
            .list_termbase_mounts(project_id)?
            .into_iter()
            .map(|mount| (mount.termbase_id.clone(), mount))
            .collect::<BTreeMap<_, _>>();
        let owned_termbase_ids = {
            let mut statement = self
                .connection
                .prepare("SELECT id FROM termbases WHERE owner_project_id = ?1 ORDER BY id")?;
            statement
                .query_map([project_id], |row| row.get::<_, String>(0))?
                .collect::<std::result::Result<Vec<_>, _>>()?
        };
        let mut termbases = Vec::new();
        for termbase_id in owned_termbase_ids {
            let termbase = self.get_termbase(&termbase_id)?;
            let mount = termbase_mounts.get(&termbase_id).cloned().ok_or_else(|| {
                StorageError::InvalidData("owned termbase is not mounted".to_string())
            })?;
            let entries = self.export_term_entries(&termbase_id)?;
            termbases.push(ArchiveTermbaseData {
                termbase,
                mount,
                entries,
            });
        }
        let external_tm_mounts = self
            .list_tm_library_mounts(project_id)?
            .into_iter()
            .filter(|mount| {
                dependencies.iter().any(|dependency| {
                    dependency.kind == "tm_library" && dependency.id == mount.library_id
                })
            })
            .collect();
        let external_termbase_mounts = self
            .list_termbase_mounts(project_id)?
            .into_iter()
            .filter(|mount| {
                dependencies.iter().any(|dependency| {
                    dependency.kind == "termbase" && dependency.id == mount.termbase_id
                })
            })
            .collect();
        Ok(ProjectArchiveData {
            project: aggregate.project,
            documents,
            operations,
            dependencies,
            tm_libraries,
            termbases,
            external_tm_mounts,
            external_termbase_mounts,
        })
    }

    pub fn restore_project_archive_data(
        &mut self,
        archive: &ProjectArchiveData,
        managed_sources: &BTreeMap<String, String>,
        dependency_remaps: &BTreeMap<String, String>,
        actor: &str,
        archive_record: &NewProjectArchiveRecord,
    ) -> Result<Project> {
        require_nonempty("archive restore actor", actor)?;
        if archive.documents.is_empty() {
            return Err(StorageError::InvalidState(
                "project archive contains no documents".to_string(),
            ));
        }
        for path in managed_sources.values() {
            if path.trim().is_empty() || path.contains("..") || path.contains('\\') {
                return Err(StorageError::InvalidData(
                    "archive managed source path is unsafe".to_string(),
                ));
            }
        }
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let now = now_ms();
        let project_id = new_id();
        let project = Project {
            id: project_id.clone(),
            name: archive.project.name.clone(),
            source_locale: archive.project.source_locale.clone(),
            target_locale: archive.project.target_locale.clone(),
            domain: archive.project.domain.clone(),
            lifecycle: ProjectLifecycle::Active,
            revision: 0,
            configuration: archive.project.configuration.clone(),
            created_at_ms: now,
            updated_at_ms: now,
            archived_at_ms: None,
        };
        transaction.execute(
            "INSERT INTO projects (
                id, name, source_locale, target_locale, domain, lifecycle, revision,
                configuration_json, created_at_ms, updated_at_ms, archived_at_ms
             ) VALUES (?1, ?2, ?3, ?4, ?5, 'active', 0, ?6, ?7, ?7, NULL)",
            params![
                project.id,
                project.name,
                project.source_locale,
                project.target_locale,
                project.domain,
                serde_json::to_string(&project.configuration)?,
                now,
            ],
        )?;
        create_restored_default_assets(&transaction, &project)?;
        let mut document_ids = BTreeMap::new();
        let mut segment_ids = BTreeMap::new();
        let mut version_ids = BTreeMap::new();
        for archived_document in &archive.documents {
            let document_id = new_id();
            document_ids.insert(archived_document.document.id.clone(), document_id.clone());
            for archived_segment in &archived_document.segments {
                segment_ids.insert(archived_segment.segment.id.clone(), new_id());
            }
            for version in archive_document_versions(archived_document) {
                if version_ids
                    .insert(version.version.id.clone(), new_id())
                    .is_some()
                {
                    return Err(StorageError::InvalidData(
                        "archive contains duplicate document version ids".to_string(),
                    ));
                }
                for snapshot in version.superseded_segments {
                    segment_ids
                        .entry(snapshot.old_segment_id)
                        .or_insert_with(new_id);
                }
            }
            for preview in &archived_document.reimport_previews {
                for item in &preview.items {
                    if let Some(old_segment_id) = &item.old_segment_id {
                        segment_ids
                            .entry(old_segment_id.clone())
                            .or_insert_with(new_id);
                    }
                }
            }
        }
        for archived_document in &archive.documents {
            let document_id = document_ids
                .get(&archived_document.document.id)
                .ok_or_else(|| StorageError::InvalidData("document remap missing".to_string()))?;
            let versions = archive_document_versions(archived_document);
            let current_version = versions
                .iter()
                .find(|version| {
                    version.version.version == archived_document.document.current_version
                })
                .ok_or_else(|| {
                    StorageError::InvalidData(format!(
                        "archive is missing current document version {}",
                        archived_document.document.current_version
                    ))
                })?;
            let managed_source_path = managed_sources
                .get(&current_version.version.managed_source_path)
                .or_else(|| managed_sources.get(&archived_document.document.id))
                .ok_or_else(|| StorageError::InvalidData("source remap missing".to_string()))?;
            transaction.execute(
                "INSERT INTO documents (
                    id, project_id, name, relative_path, format, filter_id,
                    source_sha256, original_source_path, managed_source_path,
                    current_version, status, revision, segment_count,
                    degradation_json, imported_at_ms, updated_at_ms, lifecycle
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 'active',
                           ?11, ?12, ?13, ?14, ?15, 'active')",
                params![
                    document_id,
                    project.id,
                    archived_document.document.name,
                    archived_document.document.relative_path,
                    archived_document.document.format,
                    archived_document.document.filter_id,
                    archived_document.document.source_sha256,
                    format!("archive:{}", archived_document.document.id),
                    managed_source_path,
                    i64::from(archived_document.document.current_version),
                    to_i64(archived_document.document.revision)?,
                    i64::try_from(archived_document.segments.len()).map_err(|_| {
                        StorageError::InvalidData("archive segment count overflow".to_string())
                    })?,
                    serde_json::to_string(&archived_document.document.degradation)?,
                    archived_document.document.imported_at_ms,
                    now,
                ],
            )?;
            for archived_version in &versions {
                let version_id =
                    version_ids
                        .get(&archived_version.version.id)
                        .ok_or_else(|| {
                            StorageError::InvalidData(
                                "archive version remap is missing".to_string(),
                            )
                        })?;
                let version_source = managed_sources
                    .get(&archived_version.version.managed_source_path)
                    .or_else(|| {
                        (archived_version.version.version
                            == archived_document.document.current_version)
                            .then_some(managed_source_path)
                    })
                    .ok_or_else(|| {
                        StorageError::InvalidData(format!(
                            "source remap missing for document version {}",
                            archived_version.version.id
                        ))
                    })?;
                transaction.execute(
                    "INSERT INTO document_versions (
                        id, document_id, version, source_sha256, original_source_path,
                        managed_source_path, reason, created_at_ms
                     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                    params![
                        version_id,
                        document_id,
                        i64::from(archived_version.version.version),
                        archived_version.version.source_sha256,
                        format!("archive:{}", archived_version.version.original_source_path),
                        version_source,
                        archived_version.version.reason,
                        archived_version.version.created_at_ms,
                    ],
                )?;
            }
            let current_version_id =
                version_ids
                    .get(&current_version.version.id)
                    .ok_or_else(|| {
                        StorageError::InvalidData(
                            "archive current version remap is missing".to_string(),
                        )
                    })?;
            for archived_segment in &archived_document.segments {
                restore_archive_segment(
                    &transaction,
                    document_id,
                    current_version_id,
                    archived_document.document.current_version,
                    archived_segment,
                    &segment_ids,
                    now,
                )?;
            }
            restore_archive_document_history(
                &transaction,
                archived_document,
                &project.id,
                document_id,
                managed_sources,
                &version_ids,
                &segment_ids,
            )?;
        }
        restore_archive_assets(
            &transaction,
            archive,
            &project,
            &document_ids,
            &segment_ids,
            dependency_remaps,
        )?;
        for operation in &archive.operations {
            let entity_id = if operation.entity_type == "project" {
                project.id.clone()
            } else if operation.entity_type == "document" {
                document_ids
                    .get(&operation.entity_id)
                    .cloned()
                    .unwrap_or_else(|| operation.entity_id.clone())
            } else if operation.entity_type == "segment" {
                segment_ids
                    .get(&operation.entity_id)
                    .cloned()
                    .unwrap_or_else(|| operation.entity_id.clone())
            } else {
                operation.entity_id.clone()
            };
            transaction.execute(
                "INSERT INTO operations (
                    id, project_id, sequence, entity_type, entity_id, kind,
                    base_revision, result_revision, actor, correlation_id,
                    before_json, after_json, created_at_ms
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
                params![
                    new_id(),
                    project.id,
                    to_i64(operation.sequence)?,
                    operation.entity_type,
                    entity_id,
                    operation.kind,
                    operation.base_revision.map(to_i64).transpose()?,
                    operation.result_revision.map(to_i64).transpose()?,
                    operation.actor,
                    operation.correlation_id,
                    operation
                        .before
                        .as_ref()
                        .map(serde_json::to_string)
                        .transpose()?,
                    operation
                        .after
                        .as_ref()
                        .map(serde_json::to_string)
                        .transpose()?,
                    operation.created_at_ms,
                ],
            )?;
        }
        append_operation(
            &transaction,
            &project.id,
            "project",
            &project.id,
            "project.archive.restore",
            None,
            Some(0),
            actor,
            None,
            None,
            Some(serde_json::json!({"sourceProjectId": archive.project.id})),
        )?;
        insert_project_archive_record(
            &transaction,
            Some(&project.id),
            "restore",
            archive_record,
            now,
        )?;
        rebuild_project_search(&transaction, &project.id)?;
        transaction.commit()?;
        Ok(project)
    }

    pub fn record_project_archive_export(
        &mut self,
        project_id: &str,
        record: &NewProjectArchiveRecord,
    ) -> Result<()> {
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let project = find_project(&transaction, project_id)?;
        insert_project_archive_record(&transaction, Some(project_id), "export", record, now_ms())?;
        append_operation(
            &transaction,
            project_id,
            "project",
            project_id,
            "project.archive.export",
            Some(project.revision),
            Some(project.revision),
            &record.actor,
            None,
            None,
            Some(serde_json::json!({
                "archiveSha256": record.archive_sha256,
                "archivePath": record.archive_path,
            })),
        )?;
        transaction.commit()?;
        Ok(())
    }

    pub fn create_reimport_preview(
        &mut self,
        input: NewReimportPreview,
    ) -> Result<ReimportPreviewRecord> {
        require_nonempty("document id", &input.document_id)?;
        require_nonempty("candidate source digest", &input.candidate_source_sha256)?;
        require_nonempty("re-import actor", &input.actor)?;
        if input.units.is_empty() {
            return Err(StorageError::InvalidState(
                "re-import candidate contains no translatable units".to_string(),
            ));
        }
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let (project_id, actual_revision) = transaction
            .query_row(
                "SELECT project_id, revision FROM documents WHERE id = ?1",
                [&input.document_id],
                |row| Ok((row.get::<_, String>(0)?, read_u64(row, 1)?)),
            )
            .optional()?
            .ok_or_else(|| StorageError::NotFound {
                entity: "document",
                id: input.document_id.clone(),
            })?;
        ensure_entity_revision(
            "document",
            &input.document_id,
            actual_revision,
            input.expected_document_revision,
        )?;
        let old_segments = load_reimport_segments(&transaction, &input.document_id)?;
        let new_segments = imported_reimport_segments(&input.units);
        let plan = plan_reimport(&old_segments, &new_segments)
            .map_err(|error| StorageError::InvalidState(error.to_string()))?;
        let now = now_ms();
        let preview_id = new_id();
        transaction.execute(
            "UPDATE document_reimport_previews
             SET status = 'discarded'
             WHERE document_id = ?1 AND status = 'pending'",
            [&input.document_id],
        )?;
        transaction.execute(
            "INSERT INTO document_reimport_previews (
                id, project_id, document_id, expected_document_revision,
                candidate_source_sha256, original_source_path, staged_source_path,
                filter_id, options_json, status, actor, unchanged_count,
                changed_count, new_count, removed_count, ambiguous_count,
                created_at_ms
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'pending', ?10,
                       ?11, ?12, ?13, ?14, ?15, ?16)",
            params![
                preview_id,
                project_id,
                input.document_id,
                to_i64(input.expected_document_revision)?,
                input.candidate_source_sha256,
                input.original_source_path,
                input.staged_source_path,
                input.filter_id,
                serde_json::to_string(&input.options)?,
                input.actor,
                i64::from(plan.unchanged),
                i64::from(plan.changed),
                i64::from(plan.new_segments),
                i64::from(plan.removed),
                i64::from(plan.ambiguous),
                now,
            ],
        )?;
        let units = input
            .units
            .iter()
            .map(stored_unit)
            .map(|unit| (unit.ordinal, unit))
            .collect::<BTreeMap<_, _>>();
        for (index, item) in plan.items.iter().enumerate() {
            let unit = item.new_ordinal.and_then(|ordinal| units.get(&ordinal));
            transaction.execute(
                "INSERT INTO document_reimport_items (
                    preview_id, ordinal, disposition, old_segment_id,
                    new_segment_key, old_ordinal, new_ordinal, structural_path,
                    source_text, imported_unit_json, reason
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
                params![
                    preview_id,
                    i64::try_from(index).map_err(|_| StorageError::InvalidData(
                        "re-import mapping exceeds SQLite INTEGER".to_string()
                    ))?,
                    reimport_disposition_text(item.disposition),
                    item.old_segment_id,
                    item.new_segment_id,
                    item.old_ordinal.map(i64::from),
                    item.new_ordinal.map(i64::from),
                    unit.map(|value| value.structural_path.as_str()),
                    unit.map(|value| value.source_text.as_str()),
                    unit.map(serde_json::to_string).transpose()?,
                    item.reason,
                ],
            )?;
        }
        transaction.commit()?;
        Ok(ReimportPreviewRecord {
            id: preview_id,
            project_id,
            document_id: input.document_id,
            expected_document_revision: input.expected_document_revision,
            candidate_source_sha256: input.candidate_source_sha256,
            plan,
            created_at_ms: now,
        })
    }

    pub fn apply_reimport_preview(
        &mut self,
        preview_id: &str,
        expected_document_revision: u64,
        actor: &str,
    ) -> Result<Document> {
        require_nonempty("re-import actor", actor)?;
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let preview = transaction
            .query_row(
                "SELECT project_id, document_id, expected_document_revision,
                        candidate_source_sha256, original_source_path,
                        staged_source_path, status, actor
                 FROM document_reimport_previews WHERE id = ?1",
                [preview_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        read_u64(row, 2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, String>(4)?,
                        row.get::<_, String>(5)?,
                        row.get::<_, String>(6)?,
                        row.get::<_, String>(7)?,
                    ))
                },
            )
            .optional()?
            .ok_or_else(|| StorageError::NotFound {
                entity: "document_reimport_preview",
                id: preview_id.to_string(),
            })?;
        if preview.6 != "pending" {
            return Err(StorageError::InvalidState(
                "re-import preview is no longer pending".to_string(),
            ));
        }
        if preview.2 != expected_document_revision {
            return Err(StorageError::EntityConflict {
                entity: "document",
                id: preview.1.clone(),
                expected_revision: preview.2,
                actual_revision: expected_document_revision,
            });
        }
        let (current, current_original_path, current_managed_path) = transaction
            .query_row(
                "SELECT id, project_id, name, relative_path, format, filter_id,
                        source_sha256, current_version, status, revision,
                        segment_count, degradation_json, imported_at_ms, updated_at_ms,
                        original_source_path, managed_source_path
                 FROM documents WHERE id = ?1",
                [&preview.1],
                |row| {
                    Ok((
                        row_to_document(row)?,
                        row.get::<_, String>(14)?,
                        row.get::<_, String>(15)?,
                    ))
                },
            )
            .optional()?
            .ok_or_else(|| StorageError::NotFound {
                entity: "document",
                id: preview.1.clone(),
            })?;
        ensure_entity_revision(
            "document",
            &current.id,
            current.revision,
            expected_document_revision,
        )?;
        let mut statement = transaction.prepare(
            "SELECT disposition, old_segment_id, new_ordinal, imported_unit_json, reason
             FROM document_reimport_items
             WHERE preview_id = ?1 ORDER BY ordinal",
        )?;
        let items = statement
            .query_map([preview_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, Option<u32>>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, String>(4)?,
                ))
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        drop(statement);
        let units = items
            .iter()
            .filter_map(|item| item.3.as_deref())
            .map(serde_json::from_str::<StoredImportedUnit>)
            .collect::<std::result::Result<Vec<_>, _>>()?;
        let units_by_ordinal = units
            .iter()
            .map(|unit| (unit.ordinal, unit))
            .collect::<BTreeMap<_, _>>();
        let next_version = current
            .current_version
            .checked_add(1)
            .ok_or_else(|| StorageError::InvalidData("document version overflow".to_string()))?;
        let next_revision = next_revision(current.revision)?;
        let version_id = new_id();
        let now = now_ms();
        transaction.execute(
            "INSERT INTO document_versions (
                id, document_id, version, source_sha256, original_source_path,
                managed_source_path, reason, created_at_ms
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'source-reimport', ?7)",
            params![
                version_id,
                current.id,
                i64::from(next_version),
                preview.3,
                preview.4,
                preview.5,
                now,
            ],
        )?;
        for (disposition, old_segment_id, _, _, _) in &items {
            if let Some(old_segment_id) = old_segment_id {
                transaction.execute(
                    "INSERT INTO document_version_segments (
                        version_id, old_segment_id, old_ordinal, disposition, snapshot_json
                     ) SELECT ?1, s.id, s.ordinal, ?2, ?3
                       FROM segments s WHERE s.id = ?4",
                    params![
                        version_id,
                        if disposition == "ambiguous" {
                            "ambiguous"
                        } else {
                            disposition
                        },
                        snapshot_segment(&transaction, old_segment_id)?,
                        old_segment_id,
                    ],
                )?;
            }
        }
        transaction.execute(
            "UPDATE segments
             SET ordinal = ordinal + 1000000000,
                 structural_path = ?1 || structural_path
             WHERE document_id = ?2",
            params![format!("__reimport__/{preview_id}/"), current.id],
        )?;
        for (disposition, old_segment_id, new_ordinal, _, _) in &items {
            if disposition == "removed" {
                if let Some(old_segment_id) = old_segment_id {
                    transaction.execute("DELETE FROM segments WHERE id = ?1", [old_segment_id])?;
                }
                continue;
            }
            let ordinal = new_ordinal.ok_or_else(|| {
                StorageError::InvalidData("re-import item is missing a new ordinal".to_string())
            })?;
            let unit = units_by_ordinal.get(&ordinal).ok_or_else(|| {
                StorageError::InvalidData("re-import item is missing its imported unit".to_string())
            })?;
            let previous = ordinal
                .checked_sub(1)
                .and_then(|value| units_by_ordinal.get(&value));
            let next = ordinal
                .checked_add(1)
                .and_then(|value| units_by_ordinal.get(&value));
            let (source_hash, context_hash) = segment_hashes(
                &unit.source_text,
                previous.map(|value| value.source_text.as_str()),
                next.map(|value| value.source_text.as_str()),
            );
            if disposition == "unchanged" || disposition == "changed" {
                let segment_id = old_segment_id.as_deref().ok_or_else(|| {
                    StorageError::InvalidData(
                        "matched re-import item has no old segment".to_string(),
                    )
                })?;
                if disposition == "changed" {
                    clear_changed_segment_state(&transaction, segment_id, now)?;
                } else {
                    transaction.execute(
                        "DELETE FROM inline_tags WHERE segment_id = ?1 AND side = 'source'",
                        [segment_id],
                    )?;
                    transaction.execute(
                        "DELETE FROM segment_notes WHERE segment_id = ?1",
                        [segment_id],
                    )?;
                }
                transaction.execute(
                    "UPDATE segments
                     SET ordinal = ?1, structural_path = ?2, source_text = ?3,
                         target_text = CASE WHEN ?4 = 'unchanged' THEN target_text ELSE '' END,
                         state = CASE WHEN ?4 = 'unchanged' THEN state ELSE 'untranslated' END,
                         revision = revision + 1, source_hash = ?5, context_hash = ?6,
                         updated_at_ms = ?7, document_version_id = ?8, source_version = ?9
                     WHERE id = ?10",
                    params![
                        i64::from(unit.ordinal),
                        unit.structural_path,
                        unit.source_text,
                        disposition,
                        source_hash,
                        context_hash,
                        now,
                        version_id,
                        i64::from(next_version),
                        segment_id,
                    ],
                )?;
                insert_reimport_annotations(
                    &transaction,
                    segment_id,
                    unit,
                    disposition == "unchanged",
                )?;
            } else {
                let segment_id = new_id();
                transaction.execute(
                    "INSERT INTO segments (
                        id, document_id, ordinal, structural_path, source_text,
                        target_text, state, revision, source_hash, context_hash,
                        updated_at_ms, document_version_id, source_version
                     ) VALUES (?1, ?2, ?3, ?4, ?5, '', 'untranslated', 0,
                               ?6, ?7, ?8, ?9, ?10)",
                    params![
                        segment_id,
                        current.id,
                        i64::from(unit.ordinal),
                        unit.structural_path,
                        unit.source_text,
                        source_hash,
                        context_hash,
                        now,
                        version_id,
                        i64::from(next_version),
                    ],
                )?;
                insert_reimport_annotations(&transaction, &segment_id, unit, false)?;
            }
        }
        let segment_count = transaction.query_row(
            "SELECT COUNT(*) FROM segments WHERE document_id = ?1",
            [&current.id],
            |row| row.get::<_, i64>(0),
        )?;
        transaction.execute(
            "UPDATE documents
             SET source_sha256 = ?1, original_source_path = ?2,
                 managed_source_path = ?3, current_version = ?4,
                 revision = ?5, segment_count = ?6, updated_at_ms = ?7
             WHERE id = ?8 AND revision = ?9",
            params![
                preview.3,
                preview.4,
                preview.5,
                i64::from(next_version),
                to_i64(next_revision)?,
                segment_count,
                now,
                current.id,
                to_i64(expected_document_revision)?,
            ],
        )?;
        transaction.execute(
            "UPDATE document_reimport_previews
             SET status = 'applied', applied_at_ms = ?1 WHERE id = ?2",
            params![now, preview_id],
        )?;
        transaction.execute(
            "UPDATE analysis_runs SET stale = 1
             WHERE project_id = ?1 AND status = 'succeeded'",
            [&preview.0],
        )?;
        rebuild_project_search(&transaction, &preview.0)?;
        append_operation(
            &transaction,
            &preview.0,
            "document",
            &current.id,
            "document.reimport",
            Some(current.revision),
            Some(next_revision),
            actor,
            Some(preview_id),
            Some(serde_json::json!({
                "sourceSha256": current.source_sha256,
                "version": current.current_version,
                "originalSourcePath": current_original_path,
                "managedSourcePath": current_managed_path,
            })),
            Some(serde_json::json!({
                "sourceSha256": preview.3,
                "version": next_version,
                "previewId": preview_id,
                "previewActor": preview.7,
            })),
        )?;
        transaction.commit()?;
        Ok(self.get_document(&current.id)?.document)
    }

    pub fn create_project_template(
        &mut self,
        name: &str,
        description: &str,
        definition: Value,
    ) -> Result<ProjectTemplateRecord> {
        require_nonempty("template name", name)?;
        validate_template_definition(&definition)?;
        let now = now_ms();
        let record = ProjectTemplateRecord {
            id: new_id(),
            revision: 1,
            name: name.trim().to_string(),
            description: description.trim().to_string(),
            definition,
            built_in: false,
            created_at_ms: now,
            updated_at_ms: now,
        };
        self.connection.execute(
            "INSERT INTO project_templates (
                id, revision, name, description, definition_json, built_in,
                created_at_ms, updated_at_ms
             ) VALUES (?1, 1, ?2, ?3, ?4, 0, ?5, ?5)",
            params![
                record.id,
                record.name,
                record.description,
                serde_json::to_string(&record.definition)?,
                now,
            ],
        )?;
        Ok(record)
    }

    pub fn update_project_template(
        &mut self,
        template_id: &str,
        expected_revision: u64,
        name: &str,
        description: &str,
        definition: Value,
    ) -> Result<ProjectTemplateRecord> {
        require_nonempty("template name", name)?;
        validate_template_definition(&definition)?;
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let current = find_template(&transaction, template_id, None)?;
        if current.built_in {
            return Err(StorageError::InvalidState(
                "built-in project templates cannot be modified".to_string(),
            ));
        }
        ensure_entity_revision(
            "project_template",
            template_id,
            current.revision,
            expected_revision,
        )?;
        let now = now_ms();
        let updated = ProjectTemplateRecord {
            id: current.id.clone(),
            revision: next_revision(current.revision)?,
            name: name.trim().to_string(),
            description: description.trim().to_string(),
            definition,
            built_in: false,
            created_at_ms: current.created_at_ms,
            updated_at_ms: now,
        };
        transaction.execute(
            "INSERT INTO project_templates (
                id, revision, name, description, definition_json, built_in,
                created_at_ms, updated_at_ms
             ) VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6, ?7)",
            params![
                updated.id,
                to_i64(updated.revision)?,
                updated.name,
                updated.description,
                serde_json::to_string(&updated.definition)?,
                updated.created_at_ms,
                updated.updated_at_ms,
            ],
        )?;
        transaction.commit()?;
        Ok(updated)
    }

    pub fn get_project_template(
        &self,
        template_id: &str,
        revision: Option<u64>,
    ) -> Result<ProjectTemplateRecord> {
        find_template(&self.connection, template_id, revision)
    }

    pub fn list_project_templates(
        &self,
        offset: u32,
        limit: u32,
    ) -> Result<(Vec<ProjectTemplateRecord>, u32)> {
        let total = self.connection.query_row(
            "SELECT COUNT(DISTINCT id) FROM project_templates",
            [],
            |row| row.get::<_, i64>(0),
        )?;
        let mut statement = self.connection.prepare(
            "SELECT t.id, t.revision, t.name, t.description, t.definition_json,
                    t.built_in, t.created_at_ms, t.updated_at_ms
             FROM project_templates t
             WHERE t.revision = (
                 SELECT MAX(latest.revision) FROM project_templates latest
                 WHERE latest.id = t.id
             )
             ORDER BY t.updated_at_ms DESC, t.name, t.id
             LIMIT ?1 OFFSET ?2",
        )?;
        let items = statement
            .query_map(
                params![i64::from(limit), i64::from(offset)],
                row_to_template,
            )?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok((items, to_u32(total)?))
    }

    pub fn delete_project_template(
        &mut self,
        template_id: &str,
        expected_revision: u64,
    ) -> Result<()> {
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let current = find_template(&transaction, template_id, None)?;
        if current.built_in {
            return Err(StorageError::InvalidState(
                "built-in project templates cannot be deleted".to_string(),
            ));
        }
        ensure_entity_revision(
            "project_template",
            template_id,
            current.revision,
            expected_revision,
        )?;
        transaction.execute("DELETE FROM project_templates WHERE id = ?1", [template_id])?;
        transaction.commit()?;
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    pub fn create_project_from_template(
        &mut self,
        template_id: &str,
        template_revision: Option<u64>,
        name: &str,
        source_locale: Option<&str>,
        target_locale: Option<&str>,
        domain: Option<&str>,
        dependency_remaps: &BTreeMap<String, String>,
    ) -> Result<ProjectFromTemplateResult> {
        require_nonempty("project name", name)?;
        let template = self.get_project_template(template_id, template_revision)?;
        let definition = serde_json::from_value::<TemplateDefinition>(template.definition.clone())
            .map_err(|error| {
                StorageError::InvalidData(format!("invalid project template definition: {error}"))
            })?;
        let source_locale = source_locale
            .filter(|value| !value.trim().is_empty())
            .map(str::to_string)
            .or(definition.source_locale)
            .ok_or_else(|| {
                StorageError::InvalidState(
                    "project template requires a source locale or override".to_string(),
                )
            })?;
        let target_locale = target_locale
            .filter(|value| !value.trim().is_empty())
            .map(str::to_string)
            .or(definition.target_locale)
            .ok_or_else(|| {
                StorageError::InvalidState(
                    "project template requires a target locale or override".to_string(),
                )
            })?;
        let domain = domain
            .map(str::to_string)
            .or(definition.domain)
            .unwrap_or_default();
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let mut diagnostics = Vec::new();
        let qa_profile_id = resolve_template_reference(
            &transaction,
            "qa_profile",
            "qa_profiles",
            definition.qa_profile_id.as_deref(),
            dependency_remaps,
            &mut diagnostics,
        )?;
        let pipeline_id = resolve_template_reference(
            &transaction,
            "pipeline",
            "pipeline_definitions",
            definition.pipeline_id.as_deref(),
            dependency_remaps,
            &mut diagnostics,
        )?;
        let analysis_profile_id = resolve_template_reference(
            &transaction,
            "analysis_profile",
            "analysis_profiles",
            definition.analysis_profile_id.as_deref(),
            dependency_remaps,
            &mut diagnostics,
        )?;
        let mut ai_profile_ids = Vec::new();
        for profile_id in &definition.ai_profile_ids {
            if let Some(resolved) = resolve_template_reference(
                &transaction,
                "ai_profile",
                "ai_provider_profiles",
                Some(profile_id),
                dependency_remaps,
                &mut diagnostics,
            )? {
                ai_profile_ids.push(resolved);
            }
        }
        let configuration = ProjectConfiguration {
            template_id: Some(template.id.clone()),
            qa_profile_id,
            pipeline_id,
            engine_allowlist: definition.engine_allowlist,
            ai_profile_ids,
            analysis_profile_id,
            editor_defaults: definition.editor_defaults,
            review_required: definition.review_required.unwrap_or(true),
        };
        let project = create_project_in_transaction(
            &transaction,
            name,
            &source_locale,
            &target_locale,
            &domain,
            configuration,
        )?;
        for mount in &definition.tm_mounts {
            restore_template_tm_mount(
                &transaction,
                &project,
                mount,
                dependency_remaps,
                &mut diagnostics,
            )?;
        }
        for mount in &definition.termbase_mounts {
            restore_template_termbase_mount(
                &transaction,
                &project,
                mount,
                dependency_remaps,
                &mut diagnostics,
            )?;
        }
        append_operation(
            &transaction,
            &project.id,
            "project",
            &project.id,
            "project.template.create",
            None,
            Some(0),
            "template",
            None,
            None,
            Some(serde_json::json!({
                "templateId": template.id,
                "templateRevision": template.revision,
            })),
        )?;
        transaction.commit()?;
        Ok(ProjectFromTemplateResult {
            project,
            diagnostics,
        })
    }

    pub fn recycle_entity(
        &mut self,
        entity_type: &str,
        entity_id: &str,
        expected_revision: u64,
        actor: &str,
        reason: &str,
        retention_ms: Option<i64>,
    ) -> Result<RecycleEntryRecord> {
        require_nonempty("recycle actor", actor)?;
        require_nonempty("recycle reason", reason)?;
        let retention_ms = retention_ms.unwrap_or(DEFAULT_RECYCLE_RETENTION_MS);
        if retention_ms <= 0 {
            return Err(StorageError::InvalidState(
                "recycle retention must be positive".to_string(),
            ));
        }
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let now = now_ms();
        let (project_id, display_name, previous_state, result_revision) = match entity_type {
            "project" => {
                let current = find_project(&transaction, entity_id)?;
                ensure_entity_revision("project", entity_id, current.revision, expected_revision)?;
                if current.lifecycle == ProjectLifecycle::Trash {
                    return Err(StorageError::InvalidState(
                        "project is already in the recycle bin".to_string(),
                    ));
                }
                let revision = next_revision(current.revision)?;
                transaction.execute(
                    "UPDATE projects
                     SET lifecycle = 'trash', revision = ?1, archived_at_ms = ?2,
                         updated_at_ms = ?2
                     WHERE id = ?3 AND revision = ?4",
                    params![
                        to_i64(revision)?,
                        now,
                        entity_id,
                        to_i64(expected_revision)?
                    ],
                )?;
                (
                    current.id,
                    current.name,
                    project_lifecycle_text(current.lifecycle).to_string(),
                    revision,
                )
            }
            "document" => {
                let (project_id, name, revision, lifecycle) = transaction
                    .query_row(
                        "SELECT project_id, name, revision, lifecycle
                         FROM documents WHERE id = ?1",
                        [entity_id],
                        |row| {
                            Ok((
                                row.get::<_, String>(0)?,
                                row.get::<_, String>(1)?,
                                read_u64(row, 2)?,
                                row.get::<_, String>(3)?,
                            ))
                        },
                    )
                    .optional()?
                    .ok_or_else(|| StorageError::NotFound {
                        entity: "document",
                        id: entity_id.to_string(),
                    })?;
                ensure_entity_revision("document", entity_id, revision, expected_revision)?;
                if lifecycle == "trash" {
                    return Err(StorageError::InvalidState(
                        "document is already in the recycle bin".to_string(),
                    ));
                }
                let result_revision = next_revision(revision)?;
                transaction.execute(
                    "UPDATE documents
                     SET lifecycle = 'trash', revision = ?1, updated_at_ms = ?2
                     WHERE id = ?3 AND revision = ?4",
                    params![
                        to_i64(result_revision)?,
                        now,
                        entity_id,
                        to_i64(expected_revision)?
                    ],
                )?;
                (project_id, name, lifecycle, result_revision)
            }
            _ => {
                return Err(StorageError::InvalidState(
                    "recycle entity type must be project or document".to_string(),
                ));
            }
        };
        let entry = RecycleEntryRecord {
            id: new_id(),
            project_id: project_id.clone(),
            entity_type: entity_type.to_string(),
            entity_id: entity_id.to_string(),
            display_name,
            previous_state,
            actor: actor.trim().to_string(),
            reason: reason.trim().to_string(),
            deleted_at_ms: now,
            retention_until_ms: now.saturating_add(retention_ms),
            restored_at_ms: None,
            purged_at_ms: None,
        };
        transaction.execute(
            "INSERT INTO recycle_entries (
                id, project_id, entity_type, entity_id, display_name,
                previous_state, actor, reason, deleted_at_ms, retention_until_ms,
                restored_at_ms, purged_at_ms
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, NULL, NULL)",
            params![
                entry.id,
                entry.project_id,
                entry.entity_type,
                entry.entity_id,
                entry.display_name,
                entry.previous_state,
                entry.actor,
                entry.reason,
                entry.deleted_at_ms,
                entry.retention_until_ms,
            ],
        )?;
        append_operation(
            &transaction,
            &project_id,
            entity_type,
            entity_id,
            "recycle.delete",
            Some(expected_revision),
            Some(result_revision),
            actor,
            None,
            None,
            Some(serde_json::to_value(&entry)?),
        )?;
        delete_search_projection(&transaction, entity_type, entity_id)?;
        transaction.commit()?;
        Ok(entry)
    }

    pub fn list_recycle_entries(
        &self,
        offset: u32,
        limit: u32,
    ) -> Result<(Vec<RecycleEntryRecord>, u32)> {
        let total = self.connection.query_row(
            "SELECT COUNT(*) FROM recycle_entries
             WHERE restored_at_ms IS NULL AND purged_at_ms IS NULL",
            [],
            |row| row.get::<_, i64>(0),
        )?;
        let mut statement = self.connection.prepare(
            "SELECT id, project_id, entity_type, entity_id, display_name,
                    previous_state, actor, reason, deleted_at_ms, retention_until_ms,
                    restored_at_ms, purged_at_ms
             FROM recycle_entries
             WHERE restored_at_ms IS NULL AND purged_at_ms IS NULL
             ORDER BY deleted_at_ms DESC, id
             LIMIT ?1 OFFSET ?2",
        )?;
        let items = statement
            .query_map(params![i64::from(limit), i64::from(offset)], row_to_recycle)?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok((items, to_u32(total)?))
    }

    pub fn restore_recycle_entry(&mut self, entry_id: &str, actor: &str) -> Result<()> {
        require_nonempty("restore actor", actor)?;
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let entry = find_recycle_entry(&transaction, entry_id)?;
        ensure_active_recycle_entry(&entry)?;
        let now = now_ms();
        match entry.entity_type.as_str() {
            "project" => {
                transaction.execute(
                    "UPDATE projects
                     SET lifecycle = ?1, revision = revision + 1,
                         archived_at_ms = CASE WHEN ?1 = 'archived' THEN ?2 ELSE NULL END,
                         updated_at_ms = ?2
                     WHERE id = ?3",
                    params![entry.previous_state, now, entry.entity_id],
                )?;
            }
            "document" => {
                transaction.execute(
                    "UPDATE documents SET lifecycle = 'active', revision = revision + 1,
                         updated_at_ms = ?1 WHERE id = ?2",
                    params![now, entry.entity_id],
                )?;
            }
            _ => {
                return Err(StorageError::InvalidState(
                    "invalid recycle entry".to_string(),
                ));
            }
        }
        transaction.execute(
            "UPDATE recycle_entries SET restored_at_ms = ?1 WHERE id = ?2",
            params![now, entry_id],
        )?;
        append_operation(
            &transaction,
            &entry.project_id,
            &entry.entity_type,
            &entry.entity_id,
            "recycle.restore",
            None,
            None,
            actor,
            None,
            Some(serde_json::to_value(&entry)?),
            None,
        )?;
        rebuild_project_search(&transaction, &entry.project_id)?;
        transaction.commit()?;
        Ok(())
    }

    pub fn purge_recycle_entry(&mut self, entry_id: &str, actor: &str, reason: &str) -> Result<()> {
        require_nonempty("purge actor", actor)?;
        require_nonempty("purge reason", reason)?;
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let entry = find_recycle_entry(&transaction, entry_id)?;
        ensure_active_recycle_entry(&entry)?;
        match entry.entity_type.as_str() {
            "project" => {
                transaction.execute("DELETE FROM projects WHERE id = ?1", [&entry.entity_id])?;
            }
            "document" => {
                transaction.execute("DELETE FROM documents WHERE id = ?1", [&entry.entity_id])?;
                transaction.execute(
                    "UPDATE recycle_entries SET purged_at_ms = ?1, actor = ?2, reason = ?3
                     WHERE id = ?4",
                    params![now_ms(), actor.trim(), reason.trim(), entry_id],
                )?;
            }
            _ => {
                return Err(StorageError::InvalidState(
                    "invalid recycle entry".to_string(),
                ));
            }
        }
        transaction.commit()?;
        Ok(())
    }

    pub fn rebuild_global_search(&mut self, project_id: Option<&str>) -> Result<()> {
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        if let Some(project_id) = project_id {
            rebuild_project_search(&transaction, project_id)?;
        } else {
            transaction.execute("DELETE FROM global_search_entries", [])?;
            let mut statement = transaction
                .prepare("SELECT id FROM projects WHERE lifecycle != 'trash' ORDER BY id")?;
            let project_ids = statement
                .query_map([], |row| row.get::<_, String>(0))?
                .collect::<std::result::Result<Vec<_>, _>>()?;
            drop(statement);
            for project_id in project_ids {
                rebuild_project_search(&transaction, &project_id)?;
            }
        }
        transaction.commit()?;
        Ok(())
    }

    pub fn search_global(
        &mut self,
        query: &GlobalSearchQuery,
    ) -> Result<(Vec<GlobalSearchResult>, u32)> {
        if query.limit == 0 || query.limit > 200 {
            return Err(StorageError::InvalidState(
                "search limit must be between 1 and 200".to_string(),
            ));
        }
        require_nonempty("search text", &query.text)?;
        self.rebuild_global_search(query.project_id.as_deref())?;
        let match_query = fts_query(&query.text);
        let fields_json = serde_json::to_string(&query.fields)?;
        let lifecycle_filter = if query.include_recycled { 1_i64 } else { 0_i64 };
        let total = self.connection.query_row(
            "SELECT COUNT(*)
             FROM global_search_fts f
             JOIN global_search_entries e ON e.id = f.rowid
             JOIN projects p ON p.id = e.project_id
             LEFT JOIN documents d ON d.id = e.document_id
             WHERE global_search_fts MATCH ?1
               AND (?2 IS NULL OR e.project_id = ?2)
               AND (json_array_length(?3) = 0 OR e.field IN (SELECT value FROM json_each(?3)))
               AND (?4 IS NULL OR e.locale = ?4)
               AND (?5 IS NULL OR e.workflow_state = ?5)
               AND (?6 IS NULL OR e.updated_at_ms >= ?6)
               AND (?7 IS NULL OR e.updated_at_ms <= ?7)
               AND (?8 = 1 OR (p.lifecycle != 'trash' AND COALESCE(d.lifecycle, 'active') != 'trash'))",
            params![
                match_query,
                query.project_id,
                fields_json,
                query.locale,
                query.workflow_state,
                query.updated_after_ms,
                query.updated_before_ms,
                lifecycle_filter,
            ],
            |row| row.get::<_, i64>(0),
        )?;
        let mut statement = self.connection.prepare(
            "SELECT e.project_id, e.project_name, e.document_id, e.document_name,
                    e.segment_id, e.segment_ordinal, e.field, e.locale,
                    e.workflow_state,
                    snippet(global_search_fts, 0, '<mark>', '</mark>', '...', 24),
                    e.updated_at_ms
             FROM global_search_fts f
             JOIN global_search_entries e ON e.id = f.rowid
             JOIN projects p ON p.id = e.project_id
             LEFT JOIN documents d ON d.id = e.document_id
             WHERE global_search_fts MATCH ?1
               AND (?2 IS NULL OR e.project_id = ?2)
               AND (json_array_length(?3) = 0 OR e.field IN (SELECT value FROM json_each(?3)))
               AND (?4 IS NULL OR e.locale = ?4)
               AND (?5 IS NULL OR e.workflow_state = ?5)
               AND (?6 IS NULL OR e.updated_at_ms >= ?6)
               AND (?7 IS NULL OR e.updated_at_ms <= ?7)
               AND (?8 = 1 OR (p.lifecycle != 'trash' AND COALESCE(d.lifecycle, 'active') != 'trash'))
             ORDER BY bm25(global_search_fts), e.updated_at_ms DESC,
                      e.project_id, e.document_id, e.segment_ordinal, e.field, e.id
             LIMIT ?9 OFFSET ?10",
        )?;
        let items = statement
            .query_map(
                params![
                    match_query,
                    query.project_id,
                    fields_json,
                    query.locale,
                    query.workflow_state,
                    query.updated_after_ms,
                    query.updated_before_ms,
                    lifecycle_filter,
                    i64::from(query.limit),
                    i64::from(query.offset),
                ],
                |row| {
                    let ordinal = row.get::<_, Option<i64>>(5)?;
                    Ok(GlobalSearchResult {
                        project_id: row.get(0)?,
                        project_name: row.get(1)?,
                        document_id: row.get(2)?,
                        document_name: row.get(3)?,
                        segment_id: row.get(4)?,
                        segment_ordinal: ordinal.and_then(|value| u32::try_from(value).ok()),
                        field: row.get(6)?,
                        locale: row.get(7)?,
                        workflow_state: row.get(8)?,
                        snippet: row.get(9)?,
                        updated_at_ms: row.get(10)?,
                    })
                },
            )?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok((items, to_u32(total)?))
    }

    pub fn get_analysis_profile(
        &self,
        profile_id: &str,
        revision: Option<u64>,
    ) -> Result<AnalysisProfileRecord> {
        find_analysis_profile(&self.connection, profile_id, revision)
    }

    pub fn list_analysis_profiles(&self) -> Result<Vec<AnalysisProfileRecord>> {
        let mut statement = self.connection.prepare(
            "SELECT p.id, p.revision, p.name, p.definition_json, p.built_in,
                    p.created_at_ms, p.updated_at_ms
             FROM analysis_profiles p
             WHERE p.revision = (
                 SELECT MAX(latest.revision) FROM analysis_profiles latest
                 WHERE latest.id = p.id
             )
             ORDER BY p.built_in DESC, p.name, p.id",
        )?;
        statement
            .query_map([], row_to_analysis_profile)?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(StorageError::from)
    }

    pub fn run_analysis(
        &mut self,
        project_id: &str,
        document_id: Option<&str>,
        profile_id: &str,
        profile_revision: Option<u64>,
    ) -> Result<AnalysisRunRecord> {
        let profile = self.get_analysis_profile(profile_id, profile_revision)?;
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let project = find_project(&transaction, project_id)?;
        let document_revision = if let Some(document_id) = document_id {
            Some(
                transaction
                    .query_row(
                        "SELECT revision FROM documents
                         WHERE id = ?1 AND project_id = ?2 AND lifecycle = 'active'",
                        params![document_id, project_id],
                        |row| read_u64(row, 0),
                    )
                    .optional()?
                    .ok_or_else(|| StorageError::NotFound {
                        entity: "document",
                        id: document_id.to_string(),
                    })?,
            )
        } else {
            None
        };
        let mut statement = transaction.prepare(
            "SELECT s.id, s.document_id, d.name, d.revision, s.source_text,
                    s.target_text, m.workflow_state,
                    CASE WHEN EXISTS (
                        SELECT 1 FROM tm_units u
                        JOIN tm_library_mounts mount ON mount.library_id = u.library_id
                        WHERE mount.project_id = d.project_id AND mount.enabled = 1
                          AND u.source_hash = s.source_hash
                    ) THEN 100 ELSE NULL END,
                    (
                        SELECT r.proposal_text
                        FROM operations o JOIN ai_runs r ON r.id = o.correlation_id
                        WHERE o.project_id = d.project_id
                          AND o.entity_type = 'segment' AND o.entity_id = s.id
                          AND o.kind = 'segment.ai_apply' AND r.status = 'succeeded'
                          AND r.proposal_text IS NOT NULL
                        ORDER BY o.sequence DESC LIMIT 1
                    )
             FROM segments s
             JOIN documents d ON d.id = s.document_id
             LEFT JOIN segment_editor_meta m ON m.segment_id = s.id
             WHERE d.project_id = ?1 AND d.lifecycle = 'active'
               AND (?2 IS NULL OR d.id = ?2)
             ORDER BY d.id, s.ordinal, s.id",
        )?;
        let rows = statement
            .query_map(params![project_id, document_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    read_u64(row, 3)?,
                    AnalysisSegment {
                        id: row.get(0)?,
                        source_text: row.get(4)?,
                        target_text: row.get(5)?,
                        workflow: match row.get::<_, Option<String>>(6)?.as_deref() {
                            Some("review") => WorkflowBucket::Review,
                            Some("signed") => WorkflowBucket::Signed,
                            _ => WorkflowBucket::Translation,
                        },
                        tm_match_percent: row.get(7)?,
                        ai_proposal: row.get(8)?,
                    },
                ))
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        drop(statement);

        let all_segments = rows
            .iter()
            .map(|(_, _, _, _, segment)| segment.clone())
            .collect::<Vec<_>>();
        let summary = analyze_segments(&all_segments, &profile.weights)
            .map_err(|error| StorageError::InvalidState(error.to_string()))?;
        let mut grouped: BTreeMap<String, (String, u64, Vec<AnalysisSegment>)> = BTreeMap::new();
        for (_, row_document_id, name, revision, segment) in rows {
            let entry = grouped
                .entry(row_document_id)
                .or_insert_with(|| (name, revision, Vec::new()));
            entry.2.push(segment);
        }
        let mut document_summaries = BTreeMap::new();
        for (row_document_id, (_, _, segments)) in &grouped {
            document_summaries.insert(
                row_document_id.clone(),
                analyze_segments(segments, &profile.weights)
                    .map_err(|error| StorageError::InvalidState(error.to_string()))?,
            );
        }
        let now = now_ms();
        let run = AnalysisRunRecord {
            id: new_id(),
            project_id: project_id.to_string(),
            document_id: document_id.map(str::to_string),
            profile_id: profile.id.clone(),
            profile_revision: profile.revision,
            project_revision: project.revision,
            document_revision,
            stale: false,
            summary,
            document_summaries,
            created_at_ms: now,
            completed_at_ms: now,
        };
        transaction.execute(
            "INSERT INTO analysis_runs (
                id, project_id, document_id, scope, profile_id, profile_revision,
                project_revision, document_revision, status, stale, summary_json,
                created_at_ms, completed_at_ms
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'succeeded', 0, ?9, ?10, ?10)",
            params![
                run.id,
                run.project_id,
                run.document_id,
                if document_id.is_some() {
                    "document"
                } else {
                    "project"
                },
                run.profile_id,
                to_i64(run.profile_revision)?,
                to_i64(run.project_revision)?,
                run.document_revision.map(to_i64).transpose()?,
                serde_json::to_string(&run.summary)?,
                now,
            ],
        )?;
        for (row_document_id, (name, revision, _)) in grouped {
            let item_summary = run
                .document_summaries
                .get(&row_document_id)
                .ok_or_else(|| StorageError::InvalidState("analysis item missing".to_string()))?;
            transaction.execute(
                "INSERT INTO analysis_run_items (
                    run_id, document_id, document_name, document_revision, summary_json
                 ) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![
                    run.id,
                    row_document_id,
                    name,
                    to_i64(revision)?,
                    serde_json::to_string(item_summary)?,
                ],
            )?;
        }
        transaction.commit()?;
        Ok(run)
    }

    pub fn get_analysis_run(&self, run_id: &str) -> Result<AnalysisRunRecord> {
        let mut run = self
            .connection
            .query_row(
                "SELECT r.id, r.project_id, r.document_id, r.profile_id,
                        r.profile_revision, r.project_revision, r.document_revision,
                        CASE WHEN p.revision != r.project_revision
                                  OR (r.document_id IS NOT NULL AND d.revision != r.document_revision)
                             THEN 1 ELSE r.stale END,
                        r.summary_json, r.created_at_ms, r.completed_at_ms
                 FROM analysis_runs r
                 JOIN projects p ON p.id = r.project_id
                 LEFT JOIN documents d ON d.id = r.document_id
                 WHERE r.id = ?1 AND r.status = 'succeeded'",
                [run_id],
                |row| {
                    let summary_json = row.get::<_, String>(8)?;
                    let summary = serde_json::from_str(&summary_json).map_err(|error| {
                        rusqlite::Error::FromSqlConversionFailure(
                            8,
                            rusqlite::types::Type::Text,
                            Box::new(error),
                        )
                    })?;
                    Ok(AnalysisRunRecord {
                        id: row.get(0)?,
                        project_id: row.get(1)?,
                        document_id: row.get(2)?,
                        profile_id: row.get(3)?,
                        profile_revision: read_u64(row, 4)?,
                        project_revision: read_u64(row, 5)?,
                        document_revision: read_optional_u64(row, 6)?,
                        stale: row.get(7)?,
                        summary,
                        document_summaries: BTreeMap::new(),
                        created_at_ms: row.get(9)?,
                        completed_at_ms: row.get(10)?,
                    })
                },
            )
            .optional()?
            .ok_or_else(|| StorageError::NotFound {
                entity: "analysis_run",
                id: run_id.to_string(),
            })?;
        let mut statement = self.connection.prepare(
            "SELECT document_id, summary_json FROM analysis_run_items
             WHERE run_id = ?1 ORDER BY document_id",
        )?;
        let items = statement
            .query_map([run_id], |row| {
                let json = row.get::<_, String>(1)?;
                let summary = serde_json::from_str(&json).map_err(|error| {
                    rusqlite::Error::FromSqlConversionFailure(
                        1,
                        rusqlite::types::Type::Text,
                        Box::new(error),
                    )
                })?;
                Ok((row.get::<_, String>(0)?, summary))
            })?
            .collect::<std::result::Result<BTreeMap<_, _>, _>>()?;
        run.document_summaries = items;
        Ok(run)
    }

    pub fn get_project_analytics(
        &self,
        project_id: &str,
        idle_gap_ms: u64,
        trend_bucket_ms: u64,
        trend_bucket_count: u32,
    ) -> Result<ProjectAnalyticsSummary> {
        if !(1_000..=24 * 60 * 60 * 1_000).contains(&idle_gap_ms) {
            return Err(StorageError::InvalidState(
                "analytics idle gap must be between 1 second and 24 hours".to_string(),
            ));
        }
        if !(60_000..=365 * 24 * 60 * 60 * 1_000).contains(&trend_bucket_ms)
            || !(1..=120).contains(&trend_bucket_count)
        {
            return Err(StorageError::InvalidState(
                "analytics trend buckets are outside supported bounds".to_string(),
            ));
        }
        find_project(&self.connection, project_id)?;
        let generated_at_ms = now_ms();
        let progress = query_progress(&self.connection, project_id, None)?;
        let mut document_progress = BTreeMap::new();
        let mut document_statement = self.connection.prepare(
            "SELECT id FROM documents
             WHERE project_id = ?1 AND lifecycle = 'active'
             ORDER BY relative_path, id",
        )?;
        let document_ids = document_statement
            .query_map([project_id], |row| row.get::<_, String>(0))?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        drop(document_statement);
        for document_id in document_ids {
            document_progress.insert(
                document_id.clone(),
                query_progress(&self.connection, project_id, Some(&document_id))?,
            );
        }
        let mut activity_statement = self.connection.prepare(
            "SELECT created_at_ms FROM operations
             WHERE project_id = ?1 AND entity_type = 'segment'
               AND kind IN (
                   'segment.update_target', 'segment.ai_apply', 'segment.confirm',
                   'segment.workflow.set', 'segment.comment.create',
                   'segment.comment.update', 'segment.review.accept',
                   'segment.review.reject', 'segment.tags.set'
               )
             ORDER BY created_at_ms, sequence",
        )?;
        let activity_times = activity_statement
            .query_map([project_id], |row| row.get::<_, i64>(0))?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        drop(activity_statement);
        let active_ms = active_editing_ms(&activity_times, idle_gap_ms);
        let active_metric = active_ms.map_or_else(
            || OptionalCountMetric::unavailable("at least two durable editing events are required"),
            OptionalCountMetric::available,
        );
        let throughput = active_ms.filter(|value| *value > 0).map(|value| {
            let scaled = u128::from(progress.confirmed_segments)
                .saturating_mul(3_600_000)
                .saturating_mul(1_000)
                / u128::from(value);
            u64::try_from(scaled).unwrap_or(u64::MAX)
        });
        let productivity = ProductivitySummary {
            idle_gap_ms,
            activity_events: u64::try_from(activity_times.len()).unwrap_or(u64::MAX),
            active_editing_ms: active_metric,
            confirmed_segments_per_hour_milli: throughput.map_or_else(
                || OptionalCountMetric::unavailable("active editing time is unavailable or zero"),
                OptionalCountMetric::available,
            ),
            time_in_state_ms: query_time_in_state(&self.connection, project_id, generated_at_ms)?,
        };
        let (ai_instrumented, ai_contribution) =
            query_ai_contribution(&self.connection, project_id)?;
        let ai = AiContributionSummary {
            available: ai_instrumented,
            contribution: ai_contribution,
            reason: (!ai_instrumented).then(|| {
                "no explicit AI apply events exist; historical proposals are not treated as applied"
                    .to_string()
            }),
        };
        let assets = query_asset_health(&self.connection, project_id, progress.qa_blockers)?;
        let trends = query_analytics_trends(
            &self.connection,
            project_id,
            generated_at_ms,
            trend_bucket_ms,
            trend_bucket_count,
        )?;
        Ok(ProjectAnalyticsSummary {
            project_id: project_id.to_string(),
            generated_at_ms,
            progress,
            document_progress,
            productivity,
            ai,
            assets,
            trends,
        })
    }
}

fn query_progress(
    connection: &rusqlite::Connection,
    project_id: &str,
    document_id: Option<&str>,
) -> Result<ProgressSummary> {
    let values = connection.query_row(
        "SELECT COUNT(*),
                COALESCE(SUM(CASE WHEN s.state = 'untranslated' THEN 1 ELSE 0 END), 0),
                COALESCE(SUM(CASE WHEN s.state = 'draft' THEN 1 ELSE 0 END), 0),
                COALESCE(SUM(CASE WHEN s.state = 'confirmed' THEN 1 ELSE 0 END), 0),
                COALESCE(SUM(CASE WHEN COALESCE(m.workflow_state, 'translation') = 'translation' THEN 1 ELSE 0 END), 0),
                COALESCE(SUM(CASE WHEN m.workflow_state = 'review' THEN 1 ELSE 0 END), 0),
                COALESCE(SUM(CASE WHEN m.workflow_state = 'signed' THEN 1 ELSE 0 END), 0)
         FROM segments s
         JOIN documents d ON d.id = s.document_id
         LEFT JOIN segment_editor_meta m ON m.segment_id = s.id
         WHERE d.project_id = ?1 AND d.lifecycle = 'active'
           AND (?2 IS NULL OR d.id = ?2)",
        params![project_id, document_id],
        |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, i64>(3)?,
                row.get::<_, i64>(4)?,
                row.get::<_, i64>(5)?,
                row.get::<_, i64>(6)?,
            ))
        },
    )?;
    let qa_blockers = connection.query_row(
        "SELECT COUNT(*) FROM qa_issues q
         JOIN segments s ON s.id = q.segment_id
         JOIN documents d ON d.id = s.document_id
         WHERE d.project_id = ?1 AND d.lifecycle = 'active'
           AND (?2 IS NULL OR d.id = ?2)
           AND q.status = 'open' AND q.severity IN ('error', 'warning')",
        params![project_id, document_id],
        |row| row.get::<_, i64>(0),
    )?;
    let total_segments = nonnegative_u64(values.0, "analytics total segments")?;
    let workflow_review = nonnegative_u64(values.5, "analytics review segments")?;
    let workflow_signed = nonnegative_u64(values.6, "analytics signed segments")?;
    let completion_basis_points = if total_segments == 0 {
        0
    } else {
        u16::try_from(
            workflow_signed
                .saturating_mul(10_000)
                .checked_div(total_segments)
                .unwrap_or(0),
        )
        .unwrap_or(10_000)
    };
    Ok(ProgressSummary {
        total_segments,
        untranslated_segments: nonnegative_u64(values.1, "analytics untranslated segments")?,
        draft_segments: nonnegative_u64(values.2, "analytics draft segments")?,
        confirmed_segments: nonnegative_u64(values.3, "analytics confirmed segments")?,
        workflow_translation: nonnegative_u64(values.4, "analytics translation workflow")?,
        workflow_review,
        workflow_signed,
        reviewed_segments: workflow_review.saturating_add(workflow_signed),
        qa_blockers: nonnegative_u64(qa_blockers, "analytics QA blockers")?,
        completion_basis_points,
    })
}

fn query_time_in_state(
    connection: &rusqlite::Connection,
    project_id: &str,
    generated_at_ms: i64,
) -> Result<BTreeMap<String, OptionalCountMetric>> {
    let mut statement = connection.prepare(
        "SELECT s.id, d.imported_at_ms, COALESCE(m.workflow_state, 'translation')
         FROM segments s JOIN documents d ON d.id = s.document_id
         LEFT JOIN segment_editor_meta m ON m.segment_id = s.id
         WHERE d.project_id = ?1 AND d.lifecycle = 'active'
         ORDER BY s.id",
    )?;
    let rows = statement
        .query_map([project_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, String>(2)?,
            ))
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    drop(statement);
    let mut clocks = rows
        .into_iter()
        .map(|(id, imported_at_ms, expected_state)| {
            (
                id,
                ("translation".to_string(), imported_at_ms, expected_state),
            )
        })
        .collect::<BTreeMap<_, _>>();
    let mut totals = BTreeMap::from([
        ("translation".to_string(), 0_u64),
        ("review".to_string(), 0_u64),
        ("signed".to_string(), 0_u64),
    ]);
    let mut operations = connection.prepare(
        "SELECT entity_id, created_at_ms,
                json_extract(before_json, '$.workflowState'),
                json_extract(after_json, '$.workflowState')
         FROM operations
         WHERE project_id = ?1 AND entity_type = 'segment'
           AND kind = 'segment.workflow.set'
         ORDER BY sequence",
    )?;
    let transitions = operations
        .query_map([project_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, Option<String>>(3)?,
            ))
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    drop(operations);
    for (segment_id, at_ms, before_state, after_state) in transitions {
        let Some((state, last_ms, _)) = clocks.get_mut(&segment_id) else {
            continue;
        };
        if let Some(before_state) = before_state {
            *state = before_state;
        }
        let duration = u64::try_from(at_ms.saturating_sub(*last_ms)).unwrap_or(0);
        let current = totals.get(state).copied().unwrap_or(0);
        totals.insert(state.clone(), current.saturating_add(duration));
        if let Some(after_state) = after_state {
            *state = after_state;
        }
        *last_ms = at_ms.max(*last_ms);
    }
    if clocks
        .values()
        .any(|(state, _, expected_state)| state != expected_state)
    {
        let reason = "workflow transition history is incomplete";
        return Ok(BTreeMap::from([
            (
                "translation".to_string(),
                OptionalCountMetric::unavailable(reason),
            ),
            (
                "review".to_string(),
                OptionalCountMetric::unavailable(reason),
            ),
            (
                "signed".to_string(),
                OptionalCountMetric::unavailable(reason),
            ),
        ]));
    }
    for (state, last_ms, _) in clocks.values() {
        let duration = u64::try_from(generated_at_ms.saturating_sub(*last_ms)).unwrap_or(0);
        let current = totals.get(state).copied().unwrap_or(0);
        totals.insert(state.clone(), current.saturating_add(duration));
    }
    Ok(totals
        .into_iter()
        .map(|(state, value)| (state, OptionalCountMetric::available(value)))
        .collect())
}

fn query_ai_contribution(
    connection: &rusqlite::Connection,
    project_id: &str,
) -> Result<(bool, translunar_lifecycle_core::AiContribution)> {
    let mut statement = connection.prepare(
        "SELECT s.id, s.source_text, s.target_text,
                (
                    SELECT r.proposal_text
                    FROM operations o JOIN ai_runs r ON r.id = o.correlation_id
                    WHERE o.project_id = d.project_id
                      AND o.entity_type = 'segment' AND o.entity_id = s.id
                      AND o.kind = 'segment.ai_apply' AND r.status = 'succeeded'
                      AND r.proposal_text IS NOT NULL
                    ORDER BY o.sequence DESC LIMIT 1
                )
         FROM segments s JOIN documents d ON d.id = s.document_id
         WHERE d.project_id = ?1 AND d.lifecycle = 'active'
         ORDER BY d.id, s.ordinal, s.id",
    )?;
    let segments = statement
        .query_map([project_id], |row| {
            Ok(AnalysisSegment {
                id: row.get(0)?,
                source_text: row.get(1)?,
                target_text: row.get(2)?,
                workflow: WorkflowBucket::Translation,
                tm_match_percent: None,
                ai_proposal: row.get(3)?,
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    let instrumented = segments.iter().any(|segment| segment.ai_proposal.is_some());
    let summary = analyze_segments(&segments, &AnalysisWeights::default())
        .map_err(|error| StorageError::InvalidState(error.to_string()))?;
    Ok((instrumented, summary.ai_contribution))
}

fn query_asset_health(
    connection: &rusqlite::Connection,
    project_id: &str,
    qa_open_blockers: u64,
) -> Result<AssetHealthSummary> {
    let tm_units = connection.query_row(
        "SELECT COUNT(*) FROM tm_units u
         JOIN tm_libraries l ON l.id = u.library_id
         WHERE l.owner_project_id = ?1",
        [project_id],
        |row| row.get::<_, i64>(0),
    )?;
    let term_entries = connection.query_row(
        "SELECT COUNT(*) FROM term_entries e
         JOIN termbases t ON t.id = e.termbase_id
         WHERE t.owner_project_id = ?1",
        [project_id],
        |row| row.get::<_, i64>(0),
    )?;
    Ok(AssetHealthSummary {
        tm_confirmed_units: nonnegative_u64(tm_units, "analytics TM units")?,
        term_entries: nonnegative_u64(term_entries, "analytics term entries")?,
        qa_open_blockers,
        tm_reuse_segments: OptionalCountMetric::unavailable(
            "manual TM application provenance is not available for the full project history",
        ),
        mounted_library_hit_segments: OptionalCountMetric::unavailable(
            "historical TM applications do not record the contributing mounted library",
        ),
        curation_outcomes: OptionalCountMetric::unavailable(
            "asset curation outcome instrumentation is not available",
        ),
    })
}

fn query_analytics_trends(
    connection: &rusqlite::Connection,
    project_id: &str,
    generated_at_ms: i64,
    bucket_ms: u64,
    bucket_count: u32,
) -> Result<Vec<AnalyticsTrendBucket>> {
    let bucket_ms_i64 = i64::try_from(bucket_ms)
        .map_err(|_| StorageError::InvalidData("analytics bucket overflow".to_string()))?;
    let span = bucket_ms_i64
        .checked_mul(i64::from(bucket_count))
        .ok_or_else(|| StorageError::InvalidData("analytics trend span overflow".to_string()))?;
    let start_ms = generated_at_ms.saturating_sub(span);
    let mut buckets = (0..bucket_count)
        .map(|index| {
            let start = start_ms.saturating_add(bucket_ms_i64.saturating_mul(i64::from(index)));
            AnalyticsTrendBucket {
                start_ms: start,
                end_ms: start.saturating_add(bucket_ms_i64),
                ..AnalyticsTrendBucket::default()
            }
        })
        .collect::<Vec<_>>();
    let mut statement = connection.prepare(
        "SELECT created_at_ms,
                CASE
                    WHEN kind IN ('segment.update_target', 'segment.ai_apply') THEN 'target'
                    WHEN kind = 'segment.confirm' THEN 'confirm'
                    WHEN kind = 'segment.workflow.set' THEN 'workflow'
                END
         FROM operations
         WHERE project_id = ?1 AND created_at_ms >= ?2
           AND kind IN ('segment.update_target', 'segment.ai_apply',
                        'segment.confirm', 'segment.workflow.set')
         UNION ALL
         SELECT u.created_at_ms, 'tm'
         FROM tm_units u JOIN tm_libraries l ON l.id = u.library_id
         WHERE l.owner_project_id = ?1 AND u.created_at_ms >= ?2
         UNION ALL
         SELECT e.created_at_ms, 'term'
         FROM term_entries e JOIN termbases t ON t.id = e.termbase_id
         WHERE t.owner_project_id = ?1 AND e.created_at_ms >= ?2
         UNION ALL
         SELECT COALESCE(q.completed_at_ms, q.created_at_ms), 'qa'
         FROM qa_runs q
         WHERE q.project_id = ?1
           AND COALESCE(q.completed_at_ms, q.created_at_ms) >= ?2
         ORDER BY 1, 2",
    )?;
    let events = statement
        .query_map(params![project_id, start_ms], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    for (created_at_ms, kind) in events {
        let elapsed = created_at_ms.saturating_sub(start_ms);
        let Ok(index) = usize::try_from(elapsed / bucket_ms_i64) else {
            continue;
        };
        let Some(bucket) = buckets.get_mut(index) else {
            continue;
        };
        match kind.as_str() {
            "target" => bucket.target_edits = bucket.target_edits.saturating_add(1),
            "confirm" => bucket.confirmations = bucket.confirmations.saturating_add(1),
            "workflow" => {
                bucket.workflow_transitions = bucket.workflow_transitions.saturating_add(1)
            }
            "tm" => bucket.tm_units_added = bucket.tm_units_added.saturating_add(1),
            "term" => bucket.terms_added = bucket.terms_added.saturating_add(1),
            "qa" => bucket.qa_runs_completed = bucket.qa_runs_completed.saturating_add(1),
            _ => {}
        }
    }
    Ok(buckets)
}

fn nonnegative_u64(value: i64, label: &str) -> Result<u64> {
    u64::try_from(value)
        .map_err(|_| StorageError::InvalidData(format!("{label} is negative or overflowed")))
}

fn resolve_template_reference(
    transaction: &Transaction<'_>,
    kind: &str,
    table: &str,
    requested_id: Option<&str>,
    dependency_remaps: &BTreeMap<String, String>,
    diagnostics: &mut Vec<TemplateDependencyResolution>,
) -> Result<Option<String>> {
    let Some(requested_id) = requested_id.filter(|value| !value.trim().is_empty()) else {
        return Ok(None);
    };
    let resolved_id = dependency_remaps
        .get(requested_id)
        .map(String::as_str)
        .unwrap_or(requested_id);
    let sql = match table {
        "qa_profiles" => "SELECT 1 FROM qa_profiles WHERE id = ?1 LIMIT 1",
        "pipeline_definitions" => "SELECT 1 FROM pipeline_definitions WHERE id = ?1 LIMIT 1",
        "analysis_profiles" => "SELECT 1 FROM analysis_profiles WHERE id = ?1 LIMIT 1",
        "ai_provider_profiles" => "SELECT 1 FROM ai_provider_profiles WHERE id = ?1 LIMIT 1",
        "tm_libraries" => "SELECT 1 FROM tm_libraries WHERE id = ?1 LIMIT 1",
        "termbases" => "SELECT 1 FROM termbases WHERE id = ?1 LIMIT 1",
        _ => {
            return Err(StorageError::InvalidState(
                "unsupported project template dependency kind".to_string(),
            ));
        }
    };
    let exists = transaction
        .query_row(sql, [resolved_id], |_| Ok(()))
        .optional()?
        .is_some();
    if !exists {
        diagnostics.push(TemplateDependencyResolution {
            kind: kind.to_string(),
            requested_id: requested_id.to_string(),
            resolved_id: None,
            status: "missing".to_string(),
            message: format!("{kind} '{requested_id}' is unavailable; built-in defaults apply"),
        });
        return Ok(None);
    }
    let remapped = resolved_id != requested_id;
    diagnostics.push(TemplateDependencyResolution {
        kind: kind.to_string(),
        requested_id: requested_id.to_string(),
        resolved_id: Some(resolved_id.to_string()),
        status: if remapped { "remapped" } else { "resolved" }.to_string(),
        message: if remapped {
            format!("{kind} '{requested_id}' was remapped to '{resolved_id}'")
        } else {
            format!("{kind} '{requested_id}' was resolved")
        },
    });
    Ok(Some(resolved_id.to_string()))
}

fn restore_template_tm_mount(
    transaction: &Transaction<'_>,
    project: &Project,
    mount: &TemplateTmMount,
    dependency_remaps: &BTreeMap<String, String>,
    diagnostics: &mut Vec<TemplateDependencyResolution>,
) -> Result<()> {
    let Some(library_id) = resolve_template_reference(
        transaction,
        "tm_library",
        "tm_libraries",
        Some(&mount.id),
        dependency_remaps,
        diagnostics,
    )?
    else {
        return Ok(());
    };
    let library = find_tm_library(transaction, &library_id)?;
    if library.source_locale != project.source_locale
        || library.target_locale != project.target_locale
    {
        if let Some(diagnostic) = diagnostics.last_mut() {
            diagnostic.status = "incompatible".to_string();
            diagnostic.resolved_id = None;
            diagnostic.message = format!(
                "TM library '{}' locale pair is incompatible; the project default remains mounted",
                mount.id
            );
        }
        return Ok(());
    }
    let mode = match mount.mode.as_deref().unwrap_or("reference") {
        "reference" => AssetMountMode::Reference,
        "write" if library.writable => AssetMountMode::Write,
        "write" => {
            if let Some(diagnostic) = diagnostics.last_mut() {
                diagnostic.status = "incompatible".to_string();
                diagnostic.resolved_id = None;
                diagnostic.message = format!(
                    "TM library '{}' is read-only and cannot be mounted for writes",
                    mount.id
                );
            }
            return Ok(());
        }
        _ => {
            return Err(StorageError::InvalidData(format!(
                "template TM mount '{}' has an invalid mode",
                mount.id
            )));
        }
    };
    transaction.execute(
        "INSERT INTO tm_library_mounts (
            project_id, library_id, mode, priority, enabled, revision,
            created_at_ms, updated_at_ms
         ) VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6, ?6)",
        params![
            project.id,
            library.id,
            match mode {
                AssetMountMode::Write => "write",
                AssetMountMode::Reference => "reference",
            },
            i64::from(mount.priority.unwrap_or(100)),
            mount.enabled.unwrap_or(true),
            project.created_at_ms,
        ],
    )?;
    Ok(())
}

fn restore_template_termbase_mount(
    transaction: &Transaction<'_>,
    project: &Project,
    mount: &TemplateTermbaseMount,
    dependency_remaps: &BTreeMap<String, String>,
    diagnostics: &mut Vec<TemplateDependencyResolution>,
) -> Result<()> {
    let Some(termbase_id) = resolve_template_reference(
        transaction,
        "termbase",
        "termbases",
        Some(&mount.id),
        dependency_remaps,
        diagnostics,
    )?
    else {
        return Ok(());
    };
    let termbase = find_termbase(transaction, &termbase_id)?;
    let writable = mount.writable.unwrap_or(false);
    if termbase.source_locale != project.source_locale || (writable && !termbase.writable) {
        if let Some(diagnostic) = diagnostics.last_mut() {
            diagnostic.status = "incompatible".to_string();
            diagnostic.resolved_id = None;
            diagnostic.message = format!(
                "termbase '{}' is incompatible; the project default remains mounted",
                mount.id
            );
        }
        return Ok(());
    }
    transaction.execute(
        "INSERT INTO termbase_mounts (
            project_id, termbase_id, priority, writable, enabled, revision,
            created_at_ms, updated_at_ms
         ) VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6, ?6)",
        params![
            project.id,
            termbase.id,
            i64::from(mount.priority.unwrap_or(100)),
            writable,
            mount.enabled.unwrap_or(true),
            project.created_at_ms,
        ],
    )?;
    Ok(())
}

fn validate_template_definition(definition: &Value) -> Result<()> {
    let object = definition.as_object().ok_or_else(|| {
        StorageError::InvalidState("template definition must be an object".to_string())
    })?;
    let forbidden = ["credential", "apiKey", "secret", "token", "password"];
    let encoded = serde_json::to_string(object)?.to_ascii_lowercase();
    if forbidden
        .iter()
        .any(|key| encoded.contains(&key.to_ascii_lowercase()))
    {
        return Err(StorageError::InvalidState(
            "template definition cannot contain credentials or secrets".to_string(),
        ));
    }
    Ok(())
}

fn find_template(
    connection: &rusqlite::Connection,
    template_id: &str,
    revision: Option<u64>,
) -> Result<ProjectTemplateRecord> {
    connection
        .query_row(
            "SELECT id, revision, name, description, definition_json, built_in,
                    created_at_ms, updated_at_ms
             FROM project_templates
             WHERE id = ?1 AND revision = COALESCE(?2, (
                 SELECT MAX(revision) FROM project_templates WHERE id = ?1
             ))",
            params![template_id, revision.map(to_i64).transpose()?],
            row_to_template,
        )
        .optional()?
        .ok_or_else(|| StorageError::NotFound {
            entity: "project_template",
            id: template_id.to_string(),
        })
}

fn row_to_template(row: &rusqlite::Row<'_>) -> rusqlite::Result<ProjectTemplateRecord> {
    let definition_json = row.get::<_, String>(4)?;
    let definition = serde_json::from_str(&definition_json).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(4, rusqlite::types::Type::Text, Box::new(error))
    })?;
    Ok(ProjectTemplateRecord {
        id: row.get(0)?,
        revision: read_u64(row, 1)?,
        name: row.get(2)?,
        description: row.get(3)?,
        definition,
        built_in: row.get(5)?,
        created_at_ms: row.get(6)?,
        updated_at_ms: row.get(7)?,
    })
}

fn find_analysis_profile(
    connection: &rusqlite::Connection,
    profile_id: &str,
    revision: Option<u64>,
) -> Result<AnalysisProfileRecord> {
    connection
        .query_row(
            "SELECT id, revision, name, definition_json, built_in,
                    created_at_ms, updated_at_ms
             FROM analysis_profiles
             WHERE id = ?1 AND revision = COALESCE(?2, (
                 SELECT MAX(revision) FROM analysis_profiles WHERE id = ?1
             ))",
            params![profile_id, revision.map(to_i64).transpose()?],
            row_to_analysis_profile,
        )
        .optional()?
        .ok_or_else(|| StorageError::NotFound {
            entity: "analysis_profile",
            id: profile_id.to_string(),
        })
}

fn row_to_analysis_profile(row: &rusqlite::Row<'_>) -> rusqlite::Result<AnalysisProfileRecord> {
    let definition_json = row.get::<_, String>(3)?;
    let weights = serde_json::from_str(&definition_json).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(3, rusqlite::types::Type::Text, Box::new(error))
    })?;
    Ok(AnalysisProfileRecord {
        id: row.get(0)?,
        revision: read_u64(row, 1)?,
        name: row.get(2)?,
        weights,
        built_in: row.get(4)?,
        created_at_ms: row.get(5)?,
        updated_at_ms: row.get(6)?,
    })
}

fn row_to_recycle(row: &rusqlite::Row<'_>) -> rusqlite::Result<RecycleEntryRecord> {
    Ok(RecycleEntryRecord {
        id: row.get(0)?,
        project_id: row.get(1)?,
        entity_type: row.get(2)?,
        entity_id: row.get(3)?,
        display_name: row.get(4)?,
        previous_state: row.get(5)?,
        actor: row.get(6)?,
        reason: row.get(7)?,
        deleted_at_ms: row.get(8)?,
        retention_until_ms: row.get(9)?,
        restored_at_ms: row.get(10)?,
        purged_at_ms: row.get(11)?,
    })
}

fn find_recycle_entry(
    connection: &rusqlite::Connection,
    entry_id: &str,
) -> Result<RecycleEntryRecord> {
    connection
        .query_row(
            "SELECT id, project_id, entity_type, entity_id, display_name,
                    previous_state, actor, reason, deleted_at_ms, retention_until_ms,
                    restored_at_ms, purged_at_ms
             FROM recycle_entries WHERE id = ?1",
            [entry_id],
            row_to_recycle,
        )
        .optional()?
        .ok_or_else(|| StorageError::NotFound {
            entity: "recycle_entry",
            id: entry_id.to_string(),
        })
}

fn ensure_active_recycle_entry(entry: &RecycleEntryRecord) -> Result<()> {
    if entry.restored_at_ms.is_some() || entry.purged_at_ms.is_some() {
        return Err(StorageError::InvalidState(
            "recycle entry is no longer active".to_string(),
        ));
    }
    Ok(())
}

fn delete_search_projection(
    transaction: &Transaction<'_>,
    entity_type: &str,
    entity_id: &str,
) -> Result<()> {
    match entity_type {
        "project" => {
            transaction.execute(
                "DELETE FROM global_search_entries WHERE project_id = ?1",
                [entity_id],
            )?;
        }
        "document" => {
            transaction.execute(
                "DELETE FROM global_search_entries WHERE document_id = ?1",
                [entity_id],
            )?;
        }
        _ => {}
    }
    Ok(())
}

fn rebuild_project_search(transaction: &Transaction<'_>, project_id: &str) -> Result<()> {
    transaction.execute(
        "DELETE FROM global_search_entries WHERE project_id = ?1",
        [project_id],
    )?;
    transaction.execute(
        "INSERT INTO global_search_entries (
            project_id, project_name, field, locale, content, updated_at_ms
         )
         SELECT id, name, 'project', source_locale, name, updated_at_ms
         FROM projects WHERE id = ?1 AND lifecycle != 'trash'",
        [project_id],
    )?;
    transaction.execute(
        "INSERT INTO global_search_entries (
            project_id, project_name, document_id, document_name, field,
            locale, content, updated_at_ms
         )
         SELECT p.id, p.name, d.id, d.name, 'document', p.source_locale,
                d.name || ' ' || d.relative_path, d.updated_at_ms
         FROM projects p JOIN documents d ON d.project_id = p.id
         WHERE p.id = ?1 AND p.lifecycle != 'trash' AND d.lifecycle = 'active'",
        [project_id],
    )?;
    transaction.execute(
        "INSERT INTO global_search_entries (
            project_id, project_name, document_id, document_name, segment_id,
            segment_ordinal, field, locale, workflow_state, content, updated_at_ms
         )
         SELECT p.id, p.name, d.id, d.name, s.id, s.ordinal, 'source',
                p.source_locale, COALESCE(m.workflow_state, 'translation'),
                s.source_text, s.updated_at_ms
         FROM projects p
         JOIN documents d ON d.project_id = p.id
         JOIN segments s ON s.document_id = d.id
         LEFT JOIN segment_editor_meta m ON m.segment_id = s.id
         WHERE p.id = ?1 AND p.lifecycle != 'trash' AND d.lifecycle = 'active'",
        [project_id],
    )?;
    transaction.execute(
        "INSERT INTO global_search_entries (
            project_id, project_name, document_id, document_name, segment_id,
            segment_ordinal, field, locale, workflow_state, content, updated_at_ms
         )
         SELECT p.id, p.name, d.id, d.name, s.id, s.ordinal, 'target',
                p.target_locale, COALESCE(m.workflow_state, 'translation'),
                s.target_text, s.updated_at_ms
         FROM projects p
         JOIN documents d ON d.project_id = p.id
         JOIN segments s ON s.document_id = d.id
         LEFT JOIN segment_editor_meta m ON m.segment_id = s.id
         WHERE p.id = ?1 AND p.lifecycle != 'trash' AND d.lifecycle = 'active'
           AND s.target_text != ''",
        [project_id],
    )?;
    transaction.execute(
        "INSERT INTO global_search_entries (
            project_id, project_name, document_id, document_name, segment_id,
            segment_ordinal, field, locale, workflow_state, content, updated_at_ms
         )
         SELECT p.id, p.name, d.id, d.name, s.id, s.ordinal, 'comment',
                p.target_locale, COALESCE(m.workflow_state, 'translation'),
                c.text, c.updated_at_ms
         FROM projects p
         JOIN documents d ON d.project_id = p.id
         JOIN segments s ON s.document_id = d.id
         JOIN segment_comments c ON c.segment_id = s.id
         LEFT JOIN segment_editor_meta m ON m.segment_id = s.id
         WHERE p.id = ?1 AND p.lifecycle != 'trash' AND d.lifecycle = 'active'",
        [project_id],
    )?;
    transaction.execute(
        "INSERT INTO global_search_entries (
            project_id, project_name, document_id, document_name, segment_id,
            segment_ordinal, field, locale, workflow_state, content, updated_at_ms
         )
         SELECT p.id, p.name, d.id, d.name, s.id, s.ordinal, 'note',
                p.source_locale, COALESCE(m.workflow_state, 'translation'),
                n.text, s.updated_at_ms
         FROM projects p
         JOIN documents d ON d.project_id = p.id
         JOIN segments s ON s.document_id = d.id
         JOIN segment_notes n ON n.segment_id = s.id
         LEFT JOIN segment_editor_meta m ON m.segment_id = s.id
         WHERE p.id = ?1 AND p.lifecycle != 'trash' AND d.lifecycle = 'active'",
        [project_id],
    )?;
    Ok(())
}

fn fts_query(input: &str) -> String {
    input
        .split_whitespace()
        .filter(|part| !part.is_empty())
        .map(|part| format!("\"{}\"", part.replace('"', "\"\"")))
        .collect::<Vec<_>>()
        .join(" AND ")
}

fn load_reimport_segments(
    transaction: &Transaction<'_>,
    document_id: &str,
) -> Result<Vec<ReimportSegment>> {
    let mut statement = transaction.prepare(
        "SELECT id, ordinal, structural_path, source_text
         FROM segments WHERE document_id = ?1 ORDER BY ordinal, id",
    )?;
    let rows = statement
        .query_map([document_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, u32>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
            ))
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(rows
        .iter()
        .enumerate()
        .map(
            |(index, (id, ordinal, structural_path, source_text))| ReimportSegment {
                id: id.clone(),
                ordinal: *ordinal,
                structural_path: structural_path.clone(),
                source_text: source_text.clone(),
                context_before: index
                    .checked_sub(1)
                    .and_then(|position| rows.get(position))
                    .map(|row| row.3.clone())
                    .unwrap_or_default(),
                context_after: rows
                    .get(index + 1)
                    .map(|row| row.3.clone())
                    .unwrap_or_default(),
            },
        )
        .collect())
}

fn imported_reimport_segments(units: &[ImportedUnit]) -> Vec<ReimportSegment> {
    units
        .iter()
        .enumerate()
        .map(|(index, unit)| ReimportSegment {
            id: format!("candidate:{}", unit.ordinal),
            ordinal: unit.ordinal,
            structural_path: unit.structural_path.clone(),
            source_text: unit.source_text.clone(),
            context_before: index
                .checked_sub(1)
                .and_then(|position| units.get(position))
                .map(|value| value.source_text.clone())
                .unwrap_or_default(),
            context_after: units
                .get(index + 1)
                .map(|value| value.source_text.clone())
                .unwrap_or_default(),
        })
        .collect()
}

fn stored_unit(unit: &ImportedUnit) -> StoredImportedUnit {
    StoredImportedUnit {
        ordinal: unit.ordinal,
        structural_path: unit.structural_path.clone(),
        source_text: unit.source_text.clone(),
        target_text: unit.target_text.clone(),
        inline_tags: unit.inline_tags.clone(),
        notes: unit.notes.clone(),
    }
}

fn reimport_disposition_text(
    disposition: translunar_lifecycle_core::ReimportDisposition,
) -> &'static str {
    use translunar_lifecycle_core::ReimportDisposition;
    match disposition {
        ReimportDisposition::Unchanged => "unchanged",
        ReimportDisposition::Changed => "changed",
        ReimportDisposition::New => "new",
        ReimportDisposition::Removed => "removed",
        ReimportDisposition::Ambiguous => "ambiguous",
    }
}

fn snapshot_segment(transaction: &Transaction<'_>, segment_id: &str) -> Result<String> {
    transaction
        .query_row(
            "SELECT json_object(
                'id', s.id,
                'ordinal', s.ordinal,
                'structuralPath', s.structural_path,
                'sourceText', s.source_text,
                'targetText', s.target_text,
                'state', s.state,
                'revision', s.revision,
                'workflowState', COALESCE(m.workflow_state, 'translation'),
                'tags', json(COALESCE((
                    SELECT json_group_array(json_object(
                        'id', t.id, 'side', t.side, 'position', t.position,
                        'kind', t.kind, 'pairId', t.pair_id, 'payload', t.payload,
                        'displayText', t.display_text, 'protected', t.protected
                    )) FROM inline_tags t WHERE t.segment_id = s.id
                ), '[]')),
                'comments', json(COALESCE((
                    SELECT json_group_array(json_object(
                        'id', c.id, 'author', c.author, 'text', c.text,
                        'revision', c.revision, 'resolved', c.resolved,
                        'immutable', c.immutable, 'createdAtMs', c.created_at_ms,
                        'updatedAtMs', c.updated_at_ms
                    )) FROM segment_comments c WHERE c.segment_id = s.id
                ), '[]')),
                'reviews', json(COALESCE((
                    SELECT json_group_array(json_object(
                        'id', r.id, 'baseRevision', r.base_revision,
                        'beforeTarget', r.before_target, 'proposedTarget', r.proposed_target,
                        'author', r.author, 'reason', r.reason, 'status', r.status,
                        'createdAtMs', r.created_at_ms, 'updatedAtMs', r.updated_at_ms
                    )) FROM review_revisions r WHERE r.segment_id = s.id
                ), '[]')),
                'qaIssues', json(COALESCE((
                    SELECT json_group_array(json_object(
                        'id', q.id, 'ruleId', q.rule_id, 'severity', q.severity,
                        'status', q.status, 'message', q.message,
                        'fingerprint', q.fingerprint, 'evidence', json(q.evidence_json),
                        'createdAtMs', q.created_at_ms, 'updatedAtMs', q.updated_at_ms
                    )) FROM qa_issues q WHERE q.segment_id = s.id
                ), '[]'))
             )
             FROM segments s
             LEFT JOIN segment_editor_meta m ON m.segment_id = s.id
             WHERE s.id = ?1",
            [segment_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?
        .ok_or_else(|| StorageError::NotFound {
            entity: "segment",
            id: segment_id.to_string(),
        })
}

fn clear_changed_segment_state(
    transaction: &Transaction<'_>,
    segment_id: &str,
    now: i64,
) -> Result<()> {
    transaction.execute(
        "DELETE FROM inline_tags WHERE segment_id = ?1",
        [segment_id],
    )?;
    transaction.execute(
        "DELETE FROM segment_notes WHERE segment_id = ?1",
        [segment_id],
    )?;
    transaction.execute(
        "DELETE FROM segment_comments WHERE segment_id = ?1",
        [segment_id],
    )?;
    transaction.execute(
        "DELETE FROM review_revisions WHERE segment_id = ?1",
        [segment_id],
    )?;
    transaction.execute("DELETE FROM qa_issues WHERE segment_id = ?1", [segment_id])?;
    transaction.execute(
        "UPDATE segment_editor_meta
         SET workflow_state = 'translation', lineage_id = NULL,
             source_edit_revision = source_edit_revision + 1, updated_at_ms = ?1
         WHERE segment_id = ?2",
        params![now, segment_id],
    )?;
    Ok(())
}

fn insert_reimport_annotations(
    transaction: &Transaction<'_>,
    segment_id: &str,
    unit: &StoredImportedUnit,
    preserve_target_tags: bool,
) -> Result<()> {
    let tag_ids = unit
        .inline_tags
        .iter()
        .filter(|tag| preserve_target_tags || tag.side == translunar_domain::TagSide::Source)
        .map(|tag| (tag.id.clone(), format!("{segment_id}:reimport:{}", tag.id)))
        .collect::<BTreeMap<_, _>>();
    for tag in &unit.inline_tags {
        if tag.side == translunar_domain::TagSide::Target || !tag_ids.contains_key(&tag.id) {
            continue;
        }
        let id = tag_ids.get(&tag.id).ok_or_else(|| {
            StorageError::InvalidData("re-import tag mapping is incomplete".to_string())
        })?;
        transaction.execute(
            "INSERT INTO inline_tags (
                id, segment_id, side, position, kind, pair_id, payload,
                display_text, protected
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                id,
                segment_id,
                tag_side_text(tag.side),
                i64::from(tag.position),
                tag_kind_text(tag.kind),
                tag.pair_id
                    .as_ref()
                    .and_then(|pair_id| tag_ids.get(pair_id)),
                tag.payload,
                tag.display_text,
                tag.protected,
            ],
        )?;
    }
    for note in &unit.notes {
        transaction.execute(
            "INSERT INTO segment_notes (segment_id, id, text, author)
             VALUES (?1, ?2, ?3, ?4)",
            params![
                segment_id,
                format!("{segment_id}:reimport:{}", note.id),
                note.text,
                note.author,
            ],
        )?;
    }
    Ok(())
}

fn load_archive_document_versions(
    connection: &rusqlite::Connection,
    document_id: &str,
) -> Result<Vec<ArchiveDocumentVersionData>> {
    let mut statement = connection.prepare(
        "SELECT id, document_id, version, source_sha256, original_source_path,
                managed_source_path, reason, created_at_ms
         FROM document_versions WHERE document_id = ?1 ORDER BY version, id",
    )?;
    let versions = statement
        .query_map([document_id], |row| {
            Ok(DocumentVersion {
                id: row.get(0)?,
                document_id: row.get(1)?,
                version: row.get(2)?,
                source_sha256: row.get(3)?,
                original_source_path: row.get(4)?,
                managed_source_path: row.get(5)?,
                reason: row.get(6)?,
                created_at_ms: row.get(7)?,
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    versions
        .into_iter()
        .map(|version| {
            let mut snapshots = connection.prepare(
                "SELECT old_segment_id, old_ordinal, disposition, snapshot_json
                 FROM document_version_segments
                 WHERE version_id = ?1 ORDER BY old_ordinal, old_segment_id",
            )?;
            let superseded_segments = snapshots
                .query_map([version.id.as_str()], |row| {
                    let snapshot = serde_json::from_str::<Value>(&row.get::<_, String>(3)?)
                        .map_err(|error| {
                            rusqlite::Error::FromSqlConversionFailure(
                                3,
                                rusqlite::types::Type::Text,
                                Box::new(error),
                            )
                        })?;
                    Ok(ArchiveVersionSegmentData {
                        old_segment_id: row.get(0)?,
                        old_ordinal: row.get(1)?,
                        disposition: row.get(2)?,
                        snapshot,
                    })
                })?
                .collect::<std::result::Result<Vec<_>, _>>()?;
            Ok(ArchiveDocumentVersionData {
                version,
                superseded_segments,
            })
        })
        .collect()
}

fn load_archive_reimport_previews(
    connection: &rusqlite::Connection,
    document_id: &str,
) -> Result<Vec<ArchiveReimportPreviewData>> {
    let mut statement = connection.prepare(
        "SELECT id, expected_document_revision, candidate_source_sha256,
                original_source_path, staged_source_path, filter_id, options_json,
                status, actor, unchanged_count, changed_count, new_count,
                removed_count, ambiguous_count, created_at_ms, applied_at_ms
         FROM document_reimport_previews
         WHERE document_id = ?1 ORDER BY created_at_ms, id",
    )?;
    let previews = statement
        .query_map([document_id], |row| {
            let options =
                serde_json::from_str::<BTreeMap<String, String>>(&row.get::<_, String>(6)?)
                    .map_err(|error| {
                        rusqlite::Error::FromSqlConversionFailure(
                            6,
                            rusqlite::types::Type::Text,
                            Box::new(error),
                        )
                    })?;
            Ok(ArchiveReimportPreviewData {
                id: row.get(0)?,
                expected_document_revision: read_u64(row, 1)?,
                candidate_source_sha256: row.get(2)?,
                original_source_path: row.get(3)?,
                staged_source_path: row.get(4)?,
                filter_id: row.get(5)?,
                options,
                status: row.get(7)?,
                actor: row.get(8)?,
                unchanged_count: row.get(9)?,
                changed_count: row.get(10)?,
                new_count: row.get(11)?,
                removed_count: row.get(12)?,
                ambiguous_count: row.get(13)?,
                created_at_ms: row.get(14)?,
                applied_at_ms: row.get(15)?,
                items: Vec::new(),
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    previews
        .into_iter()
        .map(|mut preview| {
            let mut items_statement = connection.prepare(
                "SELECT ordinal, disposition, old_segment_id, new_segment_key,
                        old_ordinal, new_ordinal, structural_path, source_text,
                        imported_unit_json, reason
                 FROM document_reimport_items
                 WHERE preview_id = ?1 ORDER BY ordinal",
            )?;
            preview.items = items_statement
                .query_map([preview.id.as_str()], |row| {
                    let imported_unit = row
                        .get::<_, Option<String>>(8)?
                        .map(|value| {
                            serde_json::from_str::<Value>(&value).map_err(|error| {
                                rusqlite::Error::FromSqlConversionFailure(
                                    8,
                                    rusqlite::types::Type::Text,
                                    Box::new(error),
                                )
                            })
                        })
                        .transpose()?;
                    Ok(ArchiveReimportItemData {
                        ordinal: row.get(0)?,
                        disposition: row.get(1)?,
                        old_segment_id: row.get(2)?,
                        new_segment_key: row.get(3)?,
                        old_ordinal: row.get(4)?,
                        new_ordinal: row.get(5)?,
                        structural_path: row.get(6)?,
                        source_text: row.get(7)?,
                        imported_unit,
                        reason: row.get(9)?,
                    })
                })?
                .collect::<std::result::Result<Vec<_>, _>>()?;
            Ok(preview)
        })
        .collect()
}

fn archive_dependencies(
    connection: &rusqlite::Connection,
    project_id: &str,
) -> Result<Vec<ArchiveDependency>> {
    let mut dependencies = Vec::new();
    let mut statement = connection.prepare(
        "SELECT 'tm_library', l.id, l.name
         FROM tm_library_mounts m JOIN tm_libraries l ON l.id = m.library_id
         WHERE m.project_id = ?1 AND l.owner_project_id IS NULL
         UNION ALL
         SELECT 'termbase', t.id, t.name
         FROM termbase_mounts m JOIN termbases t ON t.id = m.termbase_id
         WHERE m.project_id = ?1 AND t.owner_project_id IS NULL
         ORDER BY 1, 2",
    )?;
    let rows = statement
        .query_map([project_id], |row| {
            Ok(ArchiveDependency {
                kind: row.get(0)?,
                id: row.get(1)?,
                name: row.get(2)?,
                required: false,
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    dependencies.extend(rows);
    Ok(dependencies)
}

fn insert_project_archive_record(
    transaction: &Transaction<'_>,
    project_id: Option<&str>,
    direction: &str,
    record: &NewProjectArchiveRecord,
    now: i64,
) -> Result<()> {
    require_nonempty("archive path", &record.archive_path)?;
    require_nonempty("archive digest", &record.archive_sha256)?;
    require_nonempty("archive actor", &record.actor)?;
    transaction.execute(
        "INSERT INTO project_archive_records (
            id, project_id, direction, format_version, archive_path,
            archive_sha256, manifest_json, status, actor, created_at_ms,
            completed_at_ms
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'succeeded', ?8, ?9, ?9)",
        params![
            new_id(),
            project_id,
            direction,
            i64::from(PROJECT_ARCHIVE_FORMAT_VERSION),
            record.archive_path,
            record.archive_sha256,
            serde_json::to_string(&record.manifest)?,
            record.actor,
            now,
        ],
    )?;
    Ok(())
}

fn create_restored_default_assets(transaction: &Transaction<'_>, project: &Project) -> Result<()> {
    let memory = TranslationMemory {
        id: new_id(),
        project_id: project.id.clone(),
        name: format!("{} TM", project.name),
        source_locale: project.source_locale.clone(),
        target_locale: project.target_locale.clone(),
        writable: true,
    };
    transaction.execute(
        "INSERT INTO translation_memories (
            id, project_id, name, source_locale, target_locale, writable
         ) VALUES (?1, ?2, ?3, ?4, ?5, 1)",
        params![
            memory.id,
            memory.project_id,
            memory.name,
            memory.source_locale,
            memory.target_locale,
        ],
    )?;
    transaction.execute(
        "INSERT INTO tm_libraries (
            id, name, source_locale, target_locale, domain, owner_project_id,
            writable, revision, created_at_ms, updated_at_ms
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, 0, ?7, ?7)",
        params![
            memory.id,
            memory.name,
            memory.source_locale,
            memory.target_locale,
            project.domain,
            project.id,
            project.created_at_ms,
        ],
    )?;
    transaction.execute(
        "INSERT INTO tm_library_mounts (
            project_id, library_id, mode, priority, enabled, revision,
            created_at_ms, updated_at_ms
         ) VALUES (?1, ?2, 'write', 0, 1, 0, ?3, ?3)",
        params![project.id, memory.id, project.created_at_ms],
    )?;
    let termbase_id = new_id();
    transaction.execute(
        "INSERT INTO termbases (
            id, name, source_locale, domain, writable, revision,
            created_at_ms, updated_at_ms, owner_project_id
         ) VALUES (?1, ?2, ?3, ?4, 1, 0, ?5, ?5, ?6)",
        params![
            termbase_id,
            format!("{} Termbase", project.name),
            project.source_locale,
            project.domain,
            project.created_at_ms,
            project.id,
        ],
    )?;
    transaction.execute(
        "INSERT INTO termbase_mounts (
            project_id, termbase_id, priority, writable, enabled, revision,
            created_at_ms, updated_at_ms
         ) VALUES (?1, ?2, 0, 1, 1, 0, ?3, ?3)",
        params![project.id, termbase_id, project.created_at_ms],
    )?;
    Ok(())
}

fn archive_document_versions(document: &ArchiveDocumentData) -> Vec<ArchiveDocumentVersionData> {
    if !document.versions.is_empty() {
        return document.versions.clone();
    }
    vec![ArchiveDocumentVersionData {
        version: DocumentVersion {
            id: format!("{}:v1", document.document.id),
            document_id: document.document.id.clone(),
            version: document.document.current_version,
            source_sha256: document.document.source_sha256.clone(),
            original_source_path: document.original_source_path.clone(),
            managed_source_path: document.managed_source_path.clone(),
            reason: "archive-legacy".to_string(),
            created_at_ms: document.document.imported_at_ms,
        },
        superseded_segments: Vec::new(),
    }]
}

fn remap_snapshot_segment(snapshot: &Value, segment_id: &str) -> Result<String> {
    let mut value = snapshot.clone();
    if let Some(object) = value.as_object_mut() {
        object.insert("id".to_string(), Value::String(segment_id.to_string()));
    }
    Ok(serde_json::to_string(&value)?)
}

fn restore_archive_document_history(
    transaction: &Transaction<'_>,
    archived_document: &ArchiveDocumentData,
    project_id: &str,
    document_id: &str,
    managed_sources: &BTreeMap<String, String>,
    version_ids: &BTreeMap<String, String>,
    segment_ids: &BTreeMap<String, String>,
) -> Result<()> {
    for archived_version in archive_document_versions(archived_document) {
        let version_id = version_ids
            .get(&archived_version.version.id)
            .ok_or_else(|| {
                StorageError::InvalidData("archive version remap is missing".to_string())
            })?;
        for snapshot in &archived_version.superseded_segments {
            let old_segment_id = segment_ids.get(&snapshot.old_segment_id).ok_or_else(|| {
                StorageError::InvalidData("archive historical segment remap is missing".to_string())
            })?;
            transaction.execute(
                "INSERT INTO document_version_segments (
                    version_id, old_segment_id, old_ordinal, disposition, snapshot_json
                 ) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![
                    version_id,
                    old_segment_id,
                    i64::from(snapshot.old_ordinal),
                    snapshot.disposition,
                    remap_snapshot_segment(&snapshot.snapshot, old_segment_id)?,
                ],
            )?;
        }
    }
    for preview in &archived_document.reimport_previews {
        let staged_source_path = managed_sources
            .get(&preview.staged_source_path)
            .cloned()
            .unwrap_or_else(|| preview.staged_source_path.clone());
        let restored_preview_id = new_id();
        transaction.execute(
            "INSERT INTO document_reimport_previews (
                id, project_id, document_id, expected_document_revision,
                candidate_source_sha256, original_source_path, staged_source_path,
                filter_id, options_json, status, actor, unchanged_count,
                changed_count, new_count, removed_count, ambiguous_count,
                created_at_ms, applied_at_ms
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11,
                       ?12, ?13, ?14, ?15, ?16, ?17, ?18)",
            params![
                restored_preview_id,
                project_id,
                document_id,
                to_i64(preview.expected_document_revision)?,
                preview.candidate_source_sha256,
                format!("archive:{}", preview.original_source_path),
                staged_source_path,
                preview.filter_id,
                serde_json::to_string(&preview.options)?,
                preview.status,
                preview.actor,
                i64::from(preview.unchanged_count),
                i64::from(preview.changed_count),
                i64::from(preview.new_count),
                i64::from(preview.removed_count),
                i64::from(preview.ambiguous_count),
                preview.created_at_ms,
                preview.applied_at_ms,
            ],
        )?;
        for item in &preview.items {
            let old_segment_id = item
                .old_segment_id
                .as_ref()
                .and_then(|id| segment_ids.get(id));
            let new_segment_key = item
                .new_segment_key
                .as_ref()
                .map(|id| segment_ids.get(id).cloned().unwrap_or_else(|| id.clone()));
            transaction.execute(
                "INSERT INTO document_reimport_items (
                    preview_id, ordinal, disposition, old_segment_id,
                    new_segment_key, old_ordinal, new_ordinal, structural_path,
                    source_text, imported_unit_json, reason
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
                params![
                    restored_preview_id,
                    i64::from(item.ordinal),
                    item.disposition,
                    old_segment_id,
                    new_segment_key,
                    item.old_ordinal.map(i64::from),
                    item.new_ordinal.map(i64::from),
                    item.structural_path,
                    item.source_text,
                    item.imported_unit
                        .as_ref()
                        .map(serde_json::to_string)
                        .transpose()?,
                    item.reason,
                ],
            )?;
        }
    }
    Ok(())
}

fn restore_archive_segment(
    transaction: &Transaction<'_>,
    document_id: &str,
    version_id: &str,
    source_version: u32,
    archived: &ArchiveSegmentData,
    segment_ids: &BTreeMap<String, String>,
    now: i64,
) -> Result<()> {
    let segment_id = segment_ids
        .get(&archived.segment.id)
        .ok_or_else(|| StorageError::InvalidData("archive segment remap is missing".to_string()))?;
    transaction.execute(
        "INSERT INTO segments (
            id, document_id, ordinal, structural_path, source_text, target_text,
            state, revision, source_hash, context_hash, updated_at_ms,
            document_version_id, source_version
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
        params![
            segment_id,
            document_id,
            i64::from(archived.segment.ordinal),
            archived.segment.structural_path,
            archived.segment.source_text,
            archived.segment.target_text,
            segment_state_text(archived.segment.state),
            to_i64(archived.segment.revision)?,
            archived.segment.source_hash,
            archived.segment.context_hash,
            archived.segment.updated_at_ms,
            version_id,
            i64::from(source_version),
        ],
    )?;
    transaction.execute(
        "UPDATE segment_editor_meta SET workflow_state = ?1, updated_at_ms = ?2
         WHERE segment_id = ?3",
        params![
            editor_workflow_state_text(archived.workflow_state),
            now,
            segment_id,
        ],
    )?;
    let tag_ids = archived
        .tags
        .iter()
        .map(|tag| (tag.id.clone(), new_id()))
        .collect::<BTreeMap<_, _>>();
    for tag in &archived.tags {
        transaction.execute(
            "INSERT INTO inline_tags (
                id, segment_id, side, position, kind, pair_id, payload,
                display_text, protected
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                tag_ids
                    .get(&tag.id)
                    .ok_or_else(|| StorageError::InvalidData(
                        "archive tag remap is missing".to_string()
                    ))?,
                segment_id,
                tag_side_text(tag.side),
                i64::from(tag.position),
                tag_kind_text(tag.kind),
                tag.pair_id.as_ref().and_then(|id| tag_ids.get(id)),
                tag.payload,
                tag.display_text,
                tag.protected,
            ],
        )?;
    }
    for note in &archived.notes {
        transaction.execute(
            "INSERT INTO segment_notes (segment_id, id, text, author)
             VALUES (?1, ?2, ?3, ?4)",
            params![segment_id, new_id(), note.text, note.author],
        )?;
    }
    for comment in &archived.comments {
        transaction.execute(
            "INSERT INTO segment_comments (
                id, segment_id, author, text, created_at_ms, updated_at_ms,
                revision, resolved, immutable
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                new_id(),
                segment_id,
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
    for review in &archived.reviews {
        transaction.execute(
            "INSERT INTO review_revisions (
                id, segment_id, base_revision, before_target, proposed_target,
                author, reason, status, created_at_ms, updated_at_ms,
                before_source, proposed_source, before_target_tags_json,
                proposed_target_tags_json
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10,
                       ?11, ?12, ?13, ?14)",
            params![
                new_id(),
                segment_id,
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
    for issue in &archived.qa_issues {
        transaction.execute(
            "INSERT INTO qa_issues (
                id, segment_id, rule_id, severity, status, message,
                fingerprint, evidence_json, created_at_ms, updated_at_ms
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                new_id(),
                segment_id,
                issue.rule_id,
                qa_severity_text(issue.severity),
                qa_issue_status_text(issue.status),
                issue.message,
                issue.fingerprint,
                serde_json::to_string(&issue.evidence)?,
                issue.created_at_ms,
                issue.updated_at_ms,
            ],
        )?;
    }
    Ok(())
}

fn restore_archive_assets(
    transaction: &Transaction<'_>,
    archive: &ProjectArchiveData,
    project: &Project,
    document_ids: &BTreeMap<String, String>,
    segment_ids: &BTreeMap<String, String>,
    dependency_remaps: &BTreeMap<String, String>,
) -> Result<()> {
    if !archive.tm_libraries.is_empty() {
        transaction.execute(
            "DELETE FROM translation_memories WHERE project_id = ?1",
            [&project.id],
        )?;
        transaction.execute(
            "DELETE FROM tm_libraries WHERE owner_project_id = ?1",
            [&project.id],
        )?;
        for (index, archived) in archive.tm_libraries.iter().enumerate() {
            let library_id = new_id();
            transaction.execute(
                "INSERT INTO tm_libraries (
                    id, name, source_locale, target_locale, domain, owner_project_id,
                    writable, revision, created_at_ms, updated_at_ms
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                params![
                    library_id,
                    archived.library.name,
                    archived.library.source_locale,
                    archived.library.target_locale,
                    archived.library.domain,
                    project.id,
                    archived.library.writable,
                    to_i64(archived.library.revision)?,
                    archived.library.created_at_ms,
                    archived.library.updated_at_ms,
                ],
            )?;
            if index == 0 {
                transaction.execute(
                    "INSERT INTO translation_memories (
                        id, project_id, name, source_locale, target_locale, writable
                     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                    params![
                        library_id,
                        project.id,
                        archived.library.name,
                        archived.library.source_locale,
                        archived.library.target_locale,
                        archived.library.writable,
                    ],
                )?;
            }
            transaction.execute(
                "INSERT INTO tm_library_mounts (
                    project_id, library_id, mode, priority, enabled, revision,
                    created_at_ms, updated_at_ms
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![
                    project.id,
                    library_id,
                    match archived.mount.mode {
                        AssetMountMode::Write => "write",
                        AssetMountMode::Reference => "reference",
                    },
                    i64::from(archived.mount.priority),
                    archived.mount.enabled,
                    to_i64(archived.mount.revision)?,
                    archived.mount.created_at_ms,
                    archived.mount.updated_at_ms,
                ],
            )?;
            for unit in &archived.units {
                let unit_id = new_id();
                let origin_project_id = unit
                    .origin_project_id
                    .as_deref()
                    .filter(|id| *id == archive.project.id)
                    .map(|_| project.id.as_str());
                let origin_document_id = unit
                    .origin_document_id
                    .as_ref()
                    .and_then(|id| document_ids.get(id));
                let origin_segment_id = unit
                    .origin_segment_id
                    .as_ref()
                    .and_then(|id| segment_ids.get(id));
                transaction.execute(
                    "INSERT INTO tm_units (
                        id, library_id, source_locale, target_locale, source_text,
                        target_text, source_hash, source_key, target_hash, domain,
                        origin_project_id, origin_document_id, origin_segment_id,
                        context_before_hash, context_after_hash, author, metadata_json,
                        created_at_ms, updated_at_ms
                     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10,
                               ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19)",
                    params![
                        unit_id,
                        library_id,
                        unit.source_locale,
                        unit.target_locale,
                        unit.source_text,
                        unit.target_text,
                        unit.source_hash,
                        exact_key(&unit.source_text),
                        unit.target_hash,
                        unit.domain,
                        origin_project_id,
                        origin_document_id,
                        origin_segment_id,
                        unit.context_before_hash,
                        unit.context_after_hash,
                        unit.author,
                        serde_json::to_string(&unit.metadata)?,
                        unit.created_at_ms,
                        unit.updated_at_ms,
                    ],
                )?;
                if index == 0
                    && let (Some(origin_document_id), Some(origin_segment_id)) =
                        (origin_document_id, origin_segment_id)
                {
                    transaction.execute(
                        "INSERT OR IGNORE INTO tm_entries (
                                id, memory_id, source_text, target_text, source_hash,
                                origin_project_id, origin_document_id, origin_segment_id,
                                confirmed_at_ms
                             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                        params![
                            new_id(),
                            library_id,
                            unit.source_text,
                            unit.target_text,
                            sha256_hex(normalize_text(&unit.source_text).as_bytes()),
                            project.id,
                            origin_document_id,
                            origin_segment_id,
                            unit.created_at_ms,
                        ],
                    )?;
                }
            }
        }
    }
    if !archive.termbases.is_empty() {
        transaction.execute(
            "DELETE FROM termbases WHERE owner_project_id = ?1",
            [&project.id],
        )?;
        for archived in &archive.termbases {
            let termbase_id = new_id();
            transaction.execute(
                "INSERT INTO termbases (
                    id, name, source_locale, domain, writable, revision,
                    created_at_ms, updated_at_ms, owner_project_id
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![
                    termbase_id,
                    archived.termbase.name,
                    archived.termbase.source_locale,
                    archived.termbase.domain,
                    archived.termbase.writable,
                    to_i64(archived.termbase.revision)?,
                    archived.termbase.created_at_ms,
                    archived.termbase.updated_at_ms,
                    project.id,
                ],
            )?;
            transaction.execute(
                "INSERT INTO termbase_mounts (
                    project_id, termbase_id, priority, writable, enabled,
                    revision, created_at_ms, updated_at_ms
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![
                    project.id,
                    termbase_id,
                    i64::from(archived.mount.priority),
                    archived.mount.writable,
                    archived.mount.enabled,
                    to_i64(archived.mount.revision)?,
                    archived.mount.created_at_ms,
                    archived.mount.updated_at_ms,
                ],
            )?;
            for entry in &archived.entries {
                let entry_id = new_id();
                transaction.execute(
                    "INSERT INTO term_entries (
                        id, termbase_id, source_locale, source_term, source_key,
                        part_of_speech, definition, example, domain, status,
                        revision, created_at_ms, updated_at_ms
                     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10,
                               ?11, ?12, ?13)",
                    params![
                        entry_id,
                        termbase_id,
                        entry.source_locale,
                        entry.source_term,
                        normalize_match_key(&entry.source_term),
                        entry.part_of_speech,
                        entry.definition,
                        entry.example,
                        entry.domain,
                        match entry.status {
                            TermStatus::Candidate => "candidate",
                            TermStatus::Active => "active",
                            TermStatus::Deprecated => "deprecated",
                        },
                        to_i64(entry.revision)?,
                        entry.created_at_ms,
                        entry.updated_at_ms,
                    ],
                )?;
                for translation in &entry.translations {
                    transaction.execute(
                        "INSERT INTO term_translations (
                            id, entry_id, locale, term, term_key, preferred,
                            forbidden, created_at_ms, updated_at_ms
                         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                        params![
                            new_id(),
                            entry_id,
                            translation.locale,
                            translation.term,
                            normalize_match_key(&translation.term),
                            translation.preferred,
                            translation.forbidden,
                            translation.created_at_ms,
                            translation.updated_at_ms,
                        ],
                    )?;
                }
            }
        }
    }
    for mount in &archive.external_tm_mounts {
        let Some(library_id) = dependency_remaps.get(&mount.library_id) else {
            continue;
        };
        let library = find_tm_library(transaction, library_id)?;
        if library.source_locale != project.source_locale
            || library.target_locale != project.target_locale
        {
            return Err(StorageError::InvalidState(format!(
                "remapped TM library {} locale pair does not match the restored project",
                library.id
            )));
        }
        transaction.execute(
            "INSERT INTO tm_library_mounts (
                project_id, library_id, mode, priority, enabled, revision,
                created_at_ms, updated_at_ms
             ) VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6, ?6)",
            params![
                project.id,
                library.id,
                match mount.mode {
                    AssetMountMode::Write => "write",
                    AssetMountMode::Reference => "reference",
                },
                i64::from(mount.priority),
                mount.enabled,
                project.created_at_ms,
            ],
        )?;
    }
    for mount in &archive.external_termbase_mounts {
        let Some(termbase_id) = dependency_remaps.get(&mount.termbase_id) else {
            continue;
        };
        let termbase = find_termbase(transaction, termbase_id)?;
        if termbase.source_locale != project.source_locale {
            return Err(StorageError::InvalidState(format!(
                "remapped termbase {} source locale does not match the restored project",
                termbase.id
            )));
        }
        if mount.writable && !termbase.writable {
            return Err(StorageError::InvalidState(format!(
                "remapped termbase {} is read-only",
                termbase.id
            )));
        }
        transaction.execute(
            "INSERT INTO termbase_mounts (
                project_id, termbase_id, priority, writable, enabled,
                revision, created_at_ms, updated_at_ms
             ) VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6, ?6)",
            params![
                project.id,
                termbase.id,
                i64::from(mount.priority),
                mount.writable,
                mount.enabled,
                project.created_at_ms,
            ],
        )?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use tempfile::tempdir;
    use translunar_asset_core::TmExchangeUnit;
    use translunar_filter_core::ImportedUnit;

    use super::*;
    use crate::store::{
        NewDocument, NewTermEntry, NewTermTranslation, NewTermbase, NewTmLibrary,
        TermSearchRequest, TmSearchRequest,
    };

    fn create_store() -> (tempfile::TempDir, Store) {
        let temp = tempdir().expect("temporary store");
        let store = Store::open(temp.path()).expect("open store");
        (temp, store)
    }

    #[test]
    fn templates_are_revisioned_and_reject_secret_fields() {
        let (_temp, mut store) = create_store();
        let created = store
            .create_project_template(
                "Legal",
                "Safe defaults",
                serde_json::json!({
                    "sourceLocale": "en-US",
                    "targetLocale": "zh-CN",
                    "assetIds": ["tm-reference"]
                }),
            )
            .expect("create template");
        let updated = store
            .update_project_template(
                &created.id,
                created.revision,
                "Legal v2",
                "Updated",
                serde_json::json!({"sourceLocale": "en-US"}),
            )
            .expect("update template");
        assert_eq!(updated.revision, 2);
        assert_eq!(
            store
                .get_project_template(&created.id, Some(1))
                .expect("historical revision")
                .name,
            "Legal"
        );
        assert!(
            store
                .create_project_template("Unsafe", "", serde_json::json!({"apiKey": "forbidden"}),)
                .is_err()
        );
        let reference_tm = store
            .create_tm_library(NewTmLibrary {
                name: "Reusable legal TM".to_string(),
                source_locale: "en-US".to_string(),
                target_locale: "zh-CN".to_string(),
                domain: Some("legal".to_string()),
                writable: false,
                owner_project_id: None,
            })
            .expect("create reusable TM");
        let reference_tb = store
            .create_termbase(NewTermbase {
                name: "Reusable legal terms".to_string(),
                source_locale: "en-US".to_string(),
                domain: Some("legal".to_string()),
                writable: false,
            })
            .expect("create reusable termbase");
        let reusable = store
            .create_project_template(
                "Reusable legal",
                "Full safe template",
                serde_json::json!({
                    "sourceLocale": "en-US",
                    "targetLocale": "zh-CN",
                    "domain": "legal",
                    "qaProfileId": "builtin.qa.cjk-professional",
                    "pipelineId": "missing-pipeline",
                    "analysisProfileId": "builtin.analysis.standard",
                    "reviewRequired": false,
                    "editorDefaults": serde_json::to_value(EditorPreferences::default())
                        .expect("serialize editor defaults"),
                    "tmMounts": [{
                        "id": "old-tm",
                        "mode": "reference",
                        "priority": 20,
                        "enabled": true
                    }],
                    "termbaseMounts": [{
                        "id": "old-tb",
                        "priority": 20,
                        "writable": false,
                        "enabled": true
                    }]
                }),
            )
            .expect("create reusable template");
        let instantiated = store
            .create_project_from_template(
                &reusable.id,
                None,
                "From template",
                None,
                None,
                None,
                &BTreeMap::from([
                    ("old-tm".to_string(), reference_tm.id.clone()),
                    ("old-tb".to_string(), reference_tb.id.clone()),
                ]),
            )
            .expect("instantiate project template");
        assert_eq!(instantiated.project.source_locale, "en-US");
        assert_eq!(instantiated.project.target_locale, "zh-CN");
        assert_eq!(
            instantiated.project.configuration.template_id,
            Some(reusable.id)
        );
        assert_eq!(
            instantiated.project.configuration.qa_profile_id.as_deref(),
            Some("builtin.qa.cjk-professional")
        );
        assert_eq!(
            instantiated
                .project
                .configuration
                .analysis_profile_id
                .as_deref(),
            Some("builtin.analysis.standard")
        );
        assert!(!instantiated.project.configuration.review_required);
        assert!(instantiated.project.configuration.editor_defaults.is_some());
        assert!(
            instantiated.diagnostics.iter().any(|diagnostic| {
                diagnostic.kind == "pipeline" && diagnostic.status == "missing"
            })
        );
        assert!(
            store
                .list_tm_library_mounts(&instantiated.project.id)
                .expect("list instantiated TM mounts")
                .iter()
                .any(|mount| mount.library_id == reference_tm.id)
        );
        assert!(
            store
                .list_termbase_mounts(&instantiated.project.id)
                .expect("list instantiated termbase mounts")
                .iter()
                .any(|mount| mount.termbase_id == reference_tb.id)
        );
    }

    #[test]
    fn search_recycle_restore_and_analysis_survive_restart() {
        let (temp, mut store) = create_store();
        let project = store
            .create_project("Lifecycle", "en-US", "zh-CN", "general")
            .expect("create project");
        let managed = store.paths().managed_source("document-1", "txt");
        std::fs::write(&managed, "Hello 世界").expect("managed source");
        let input = NewDocument {
            id: "document-1".to_string(),
            project_id: project.id.clone(),
            name: "guide.txt".to_string(),
            relative_path: "docs/guide.txt".to_string(),
            format: "txt".to_string(),
            filter_id: "builtin.txt".to_string(),
            source_sha256: "digest".to_string(),
            degradation: Vec::new(),
            original_source_path: managed.clone(),
            managed_source_path: managed,
        };
        let document = store
            .insert_document(
                &input,
                &[
                    ImportedUnit::plain(0, "p/1", "Hello world"),
                    ImportedUnit::plain(1, "p/2", "你好世界"),
                ],
            )
            .expect("insert document");
        let query = GlobalSearchQuery {
            text: "world".to_string(),
            project_id: None,
            fields: vec!["source".to_string()],
            locale: None,
            workflow_state: None,
            updated_after_ms: None,
            updated_before_ms: None,
            include_recycled: false,
            offset: 0,
            limit: 20,
        };
        let (hits, total) = store.search_global(&query).expect("search source");
        assert_eq!(total, 1);
        assert_eq!(hits[0].document_id.as_deref(), Some(document.id.as_str()));

        let run = store
            .run_analysis(&project.id, None, "builtin.analysis.standard", None)
            .expect("run analysis");
        assert_eq!(run.summary.segments, 2);
        assert_eq!(run.summary.source_cjk_characters, 4);

        let entry = store
            .recycle_entity(
                "document",
                &document.id,
                document.revision,
                "tester",
                "obsolete",
                None,
            )
            .expect("recycle document");
        assert_eq!(store.search_global(&query).expect("search recycled").1, 0);
        store
            .restore_recycle_entry(&entry.id, "tester")
            .expect("restore document");
        assert_eq!(store.search_global(&query).expect("search restored").1, 1);

        drop(store);
        let reopened = Store::open(temp.path()).expect("reopen store");
        assert_eq!(
            reopened
                .get_analysis_run(&run.id)
                .expect("persisted analysis")
                .summary
                .segments,
            2
        );
    }

    #[test]
    fn operational_analytics_use_durable_events_and_mark_unknown_metrics_unavailable() {
        let (_temp, mut store) = create_store();
        let project = store
            .create_project("Analytics", "en-US", "zh-CN", "general")
            .expect("create analytics project");
        let managed = store.paths().managed_source("analytics-document", "txt");
        std::fs::write(&managed, "Count 2\nHello").expect("write analytics source");
        let document = store
            .insert_document(
                &NewDocument {
                    id: "analytics-document".to_string(),
                    project_id: project.id.clone(),
                    name: "analytics.txt".to_string(),
                    relative_path: "analytics.txt".to_string(),
                    format: "txt".to_string(),
                    filter_id: "builtin.txt".to_string(),
                    source_sha256: "analytics-digest".to_string(),
                    degradation: Vec::new(),
                    original_source_path: managed.clone(),
                    managed_source_path: managed,
                },
                &[
                    ImportedUnit::plain(0, "p/1", "Count 2"),
                    ImportedUnit::plain(1, "p/2", "Hello"),
                ],
            )
            .expect("insert analytics document");
        let (segments, _) = store
            .list_segments(&document.id, 0, 20)
            .expect("list analytics segments");
        let first = store
            .update_target(&segments[0].id, "数量 3", segments[0].revision)
            .expect("translate first analytics segment");
        let confirmed = store
            .confirm_segment(&first.id, first.revision)
            .expect("confirm first analytics segment");
        store
            .set_editor_workflow(
                &confirmed.segment.id,
                EditorWorkflowState::Review,
                confirmed.segment.revision,
            )
            .expect("move analytics segment to review");
        let before_ai = store
            .get_project_analytics(&project.id, 300_000, 3_600_000, 24)
            .expect("analytics before AI apply");
        assert!(!before_ai.ai.available);
        assert!(before_ai.ai.reason.is_some());

        let now = now_ms();
        store
            .connection
            .execute(
                "INSERT INTO ai_runs (
                    id, kind, project_id, document_id, segment_id, profile_id,
                    model, action, prompt_hash, request_json, base_segment_revision,
                    status, revision, attempt, max_attempts, cancellation_requested,
                    proposal_text, error_retryable, created_at_ms, completed_at_ms,
                    updated_at_ms
                 ) VALUES (
                    'analytics-ai', 'interactive', ?1, ?2, ?3, NULL,
                    'test-model', 'translate', 'prompt', '{}', ?4,
                    'succeeded', 1, 1, 1, 0, '机器译文', 0, ?5, ?5, ?5
                 )",
                params![
                    project.id,
                    document.id,
                    segments[1].id,
                    to_i64(segments[1].revision).expect("AI base revision"),
                    now,
                ],
            )
            .expect("insert durable AI run");
        let applied = store
            .apply_ai_proposal(
                "analytics-ai",
                &segments[1].id,
                "机器译文",
                segments[1].revision,
            )
            .expect("apply durable AI proposal");
        store
            .update_target(&applied.id, "机器译文（人工修订）", applied.revision)
            .expect("edit applied AI proposal");
        let analytics = store
            .get_project_analytics(&project.id, 300_000, 3_600_000, 24)
            .expect("operational analytics");
        assert_eq!(analytics.progress.total_segments, 2);
        assert_eq!(analytics.progress.confirmed_segments, 1);
        assert_eq!(analytics.progress.workflow_review, 1);
        assert!(analytics.progress.qa_blockers >= 1);
        assert_eq!(analytics.document_progress.len(), 1);
        assert!(analytics.productivity.active_editing_ms.available);
        assert!(analytics.productivity.activity_events >= 4);
        assert!(analytics.ai.available);
        assert_eq!(analytics.ai.contribution.applied_segments, 1);
        assert_eq!(analytics.ai.contribution.replaced_segments, 1);
        assert!(analytics.ai.contribution.edit_distance > 0);
        assert_eq!(analytics.assets.tm_confirmed_units, 1);
        assert!(!analytics.assets.tm_reuse_segments.available);
        assert!(!analytics.assets.mounted_library_hit_segments.available);
        assert!(!analytics.assets.curation_outcomes.available);
        assert!(
            analytics
                .trends
                .iter()
                .any(|bucket| bucket.target_edits >= 1)
        );
    }

    #[test]
    fn reimport_preserves_unchanged_work_resets_changes_and_rejects_stale_preview() {
        let (_temp, mut store) = create_store();
        let project = store
            .create_project("Re-import", "en-US", "zh-CN", "general")
            .expect("create project");
        let managed = store.paths().managed_source("reimport-document", "txt");
        std::fs::write(&managed, "initial").expect("managed source");
        let document = store
            .insert_document(
                &NewDocument {
                    id: "reimport-document".to_string(),
                    project_id: project.id,
                    name: "source.txt".to_string(),
                    relative_path: "source.txt".to_string(),
                    format: "txt".to_string(),
                    filter_id: "builtin.txt".to_string(),
                    source_sha256: "initial-digest".to_string(),
                    degradation: Vec::new(),
                    original_source_path: managed.clone(),
                    managed_source_path: managed,
                },
                &[
                    ImportedUnit::plain(0, "p/1", "Stable"),
                    ImportedUnit::plain(1, "p/2", "Change me"),
                    ImportedUnit::plain(2, "p/3", "Remove me"),
                ],
            )
            .expect("insert document");
        let (segments, _) = store
            .list_segments(&document.id, 0, 10)
            .expect("list segments");
        let stable = store
            .update_target(&segments[0].id, "稳定译文", segments[0].revision)
            .expect("translate stable segment");
        store
            .update_target(&segments[1].id, "旧译文", segments[1].revision)
            .expect("translate changed segment");
        store
            .connection
            .execute(
                "INSERT INTO segment_comments (
                    id, segment_id, author, text, created_at_ms, updated_at_ms,
                    revision, resolved, immutable
                 ) VALUES ('stable-comment', ?1, 'reviewer', 'Keep this', 1, 1, 0, 0, 0)",
                [&stable.id],
            )
            .expect("insert stable comment");

        let preview = store
            .create_reimport_preview(NewReimportPreview {
                document_id: document.id.clone(),
                expected_document_revision: document.revision,
                candidate_source_sha256: "candidate-digest".to_string(),
                original_source_path: "candidate.txt".to_string(),
                staged_source_path: "sources/candidate.txt".to_string(),
                filter_id: "builtin.txt".to_string(),
                options: BTreeMap::new(),
                actor: "tester".to_string(),
                units: vec![
                    ImportedUnit::plain(0, "p/1", "Stable"),
                    ImportedUnit::plain(1, "p/2", "Changed source"),
                    ImportedUnit::plain(2, "p/4", "Brand new"),
                ],
            })
            .expect("preview re-import");
        assert_eq!(preview.plan.unchanged, 1);
        assert_eq!(preview.plan.changed, 1);
        assert_eq!(preview.plan.new_segments, 1);
        assert_eq!(preview.plan.removed, 1);
        let updated = store
            .apply_reimport_preview(&preview.id, document.revision, "tester")
            .expect("apply re-import");
        assert_eq!(updated.current_version, 2);
        assert_eq!(updated.revision, 1);
        let (segments, total) = store
            .list_segments(&document.id, 0, 10)
            .expect("list re-imported segments");
        assert_eq!(total, 3);
        assert_eq!(segments[0].id, stable.id);
        assert_eq!(segments[0].target_text, "稳定译文");
        assert!(segments[1].target_text.is_empty());
        assert_eq!(segments[2].source_text, "Brand new");
        let comments = store
            .connection
            .query_row(
                "SELECT COUNT(*) FROM segment_comments WHERE segment_id = ?1",
                [&stable.id],
                |row| row.get::<_, i64>(0),
            )
            .expect("count preserved comments");
        assert_eq!(comments, 1);
        let snapshots = store
            .connection
            .query_row(
                "SELECT COUNT(*) FROM document_version_segments",
                [],
                |row| row.get::<_, i64>(0),
            )
            .expect("count recoverable snapshots");
        assert_eq!(snapshots, 3);

        let stale = store
            .create_reimport_preview(NewReimportPreview {
                document_id: document.id.clone(),
                expected_document_revision: updated.revision,
                candidate_source_sha256: "stale-digest".to_string(),
                original_source_path: "stale.txt".to_string(),
                staged_source_path: "sources/stale.txt".to_string(),
                filter_id: "builtin.txt".to_string(),
                options: BTreeMap::new(),
                actor: "tester".to_string(),
                units: vec![ImportedUnit::plain(0, "p/1", "Stable")],
            })
            .expect("create stale preview");
        store
            .connection
            .execute(
                "UPDATE documents SET revision = revision + 1 WHERE id = ?1",
                [&document.id],
            )
            .expect("make preview stale");
        assert!(
            store
                .apply_reimport_preview(&stale.id, updated.revision, "tester")
                .is_err()
        );
    }

    #[test]
    fn project_archive_data_restores_equivalent_content_under_new_ids() {
        let (_temp, mut store) = create_store();
        let project = store
            .create_project("Portable", "en-US", "zh-CN", "legal")
            .expect("create project");
        let managed = store.paths().managed_source("portable-document", "txt");
        std::fs::write(&managed, "Portable source").expect("write managed source");
        let document = store
            .insert_document(
                &NewDocument {
                    id: "portable-document".to_string(),
                    project_id: project.id.clone(),
                    name: "portable.txt".to_string(),
                    relative_path: "folder/portable.txt".to_string(),
                    format: "txt".to_string(),
                    filter_id: "builtin.txt".to_string(),
                    source_sha256: "portable-digest".to_string(),
                    degradation: Vec::new(),
                    original_source_path: managed.clone(),
                    managed_source_path: managed,
                },
                &[ImportedUnit::plain(0, "p/1", "Portable source")],
            )
            .expect("insert document");
        let (segments, _) = store
            .list_segments(&document.id, 0, 10)
            .expect("list segments");
        let translated = store
            .update_target(&segments[0].id, "可移植译文", segments[0].revision)
            .expect("translate segment");
        let confirmed = store
            .confirm_segment(&translated.id, translated.revision)
            .expect("confirm segment and sink owned TM");
        let owned_termbase = store
            .list_termbases(Some(&project.id), 0, 20)
            .expect("list owned termbase")
            .0
            .remove(0);
        store
            .upsert_term_entry(NewTermEntry {
                termbase_id: owned_termbase.id.clone(),
                source_locale: "en-US".to_string(),
                source_term: "Portable source".to_string(),
                part_of_speech: None,
                definition: Some("Archive-owned terminology".to_string()),
                example: None,
                domain: Some("legal".to_string()),
                status: TermStatus::Active,
                translations: vec![NewTermTranslation {
                    locale: "zh-CN".to_string(),
                    term: "可移植译文".to_string(),
                    preferred: true,
                    forbidden: false,
                }],
            })
            .expect("insert owned terminology");
        let external_tm = store
            .create_tm_library(NewTmLibrary {
                name: "Shared reference".to_string(),
                source_locale: "en-US".to_string(),
                target_locale: "zh-CN".to_string(),
                domain: Some("legal".to_string()),
                writable: true,
                owner_project_id: None,
            })
            .expect("create external TM");
        store
            .import_tm_units(
                &external_tm.id,
                &[TmExchangeUnit {
                    source_locale: "en-US".to_string(),
                    target_locale: "zh-CN".to_string(),
                    source_text: "External only".to_string(),
                    target_text: "仅外部".to_string(),
                    domain: Some("legal".to_string()),
                    author: Some("shared".to_string()),
                    created_at_ms: Some(1),
                    metadata: BTreeMap::new(),
                }],
            )
            .expect("seed external TM");
        store
            .mount_tm_library(
                &project.id,
                &external_tm.id,
                AssetMountMode::Reference,
                10,
                true,
                None,
            )
            .expect("mount external TM");
        let external_tb = store
            .create_termbase(NewTermbase {
                name: "Shared terminology".to_string(),
                source_locale: "en-US".to_string(),
                domain: Some("legal".to_string()),
                writable: true,
            })
            .expect("create external termbase");
        store
            .mount_termbase(&project.id, &external_tb.id, 10, false, true, None)
            .expect("mount external termbase");
        let reimport_source = store
            .paths()
            .managed_source("portable-document-reimport", "txt");
        std::fs::write(&reimport_source, "Portable source").expect("write re-import source");
        let reimport_relative = reimport_source
            .strip_prefix(&store.paths().root)
            .expect("workspace relative re-import source")
            .to_string_lossy()
            .replace('\\', "/");
        let preview = store
            .create_reimport_preview(NewReimportPreview {
                document_id: document.id.clone(),
                expected_document_revision: document.revision,
                candidate_source_sha256: "portable-reimport-digest".to_string(),
                original_source_path: "portable-v2.txt".to_string(),
                staged_source_path: reimport_relative,
                filter_id: "builtin.txt".to_string(),
                options: BTreeMap::new(),
                actor: "tester".to_string(),
                units: vec![ImportedUnit::plain(0, "p/1", "Portable source")],
            })
            .expect("preview unchanged re-import");
        let reimported = store
            .apply_reimport_preview(&preview.id, document.revision, "tester")
            .expect("apply unchanged re-import");
        assert_eq!(reimported.current_version, 2);
        store
            .connection
            .execute(
                "INSERT INTO segment_comments (
                    id, segment_id, author, text, created_at_ms, updated_at_ms,
                    revision, resolved, immutable
                 ) VALUES ('archive-comment', ?1, 'reviewer', 'Archive me', 1, 1, 0, 0, 0)",
                [&translated.id],
            )
            .expect("insert comment");
        let archive = store
            .export_project_archive_data(&project.id)
            .expect("export archive data");
        assert_eq!(archive.documents.len(), 1);
        assert_eq!(archive.documents[0].segments[0].comments.len(), 1);
        assert_eq!(archive.documents[0].versions.len(), 2);
        assert_eq!(archive.documents[0].reimport_previews.len(), 1);
        assert_eq!(archive.tm_libraries.len(), 1);
        assert_eq!(archive.tm_libraries[0].units.len(), 1);
        assert_eq!(archive.termbases.len(), 1);
        assert_eq!(archive.termbases[0].entries.len(), 1);
        assert!(
            archive
                .dependencies
                .iter()
                .any(|dependency| dependency.id == external_tm.id)
        );
        assert!(
            archive
                .dependencies
                .iter()
                .any(|dependency| dependency.id == external_tb.id)
        );
        assert!(
            archive
                .tm_libraries
                .iter()
                .all(|library| library.library.id != external_tm.id)
        );
        assert!(
            archive
                .termbases
                .iter()
                .all(|termbase| termbase.termbase.id != external_tb.id)
        );
        let mut restored_sources = BTreeMap::new();
        for (index, version) in archive.documents[0].versions.iter().enumerate() {
            let restored_source = store
                .paths()
                .managed_source(&format!("restored-portable-{index}"), "txt");
            std::fs::write(&restored_source, "Portable source")
                .expect("write restored version source");
            let restored_relative = restored_source
                .strip_prefix(&store.paths().root)
                .expect("workspace relative source")
                .to_string_lossy()
                .replace('\\', "/");
            restored_sources.insert(
                version.version.managed_source_path.clone(),
                restored_relative,
            );
        }
        let restored = store
            .restore_project_archive_data(
                &archive,
                &restored_sources,
                &BTreeMap::from([
                    (external_tm.id.clone(), external_tm.id.clone()),
                    (external_tb.id.clone(), external_tb.id.clone()),
                ]),
                "tester",
                &NewProjectArchiveRecord {
                    archive_path: "portable.tlcat".to_string(),
                    archive_sha256: "a".repeat(64),
                    manifest: serde_json::json!({"formatVersion": 1}),
                    actor: "tester".to_string(),
                },
            )
            .expect("restore archive data");
        assert_ne!(restored.id, project.id);
        let restored_project = store
            .get_project(&restored.id)
            .expect("get restored project");
        assert_eq!(restored_project.documents.len(), 1);
        assert_ne!(restored_project.documents[0].id, document.id);
        assert_eq!(
            restored_project.documents[0].relative_path,
            "folder/portable.txt"
        );
        let (restored_segments, _) = store
            .list_segments(&restored_project.documents[0].id, 0, 10)
            .expect("list restored segments");
        assert_eq!(restored_segments[0].source_text, "Portable source");
        assert_eq!(restored_segments[0].target_text, "可移植译文");
        assert_ne!(restored_segments[0].id, confirmed.segment.id);
        assert_eq!(
            store
                .get_editor_row(&restored_segments[0].id)
                .expect("restored editor row")
                .comments
                .len(),
            1
        );
        assert_eq!(restored_project.documents[0].current_version, 2);
        assert_eq!(restored_project.documents[0].revision, reimported.revision);
        let version_count: i64 = store
            .connection
            .query_row(
                "SELECT COUNT(*) FROM document_versions WHERE document_id = ?1",
                [&restored_project.documents[0].id],
                |row| row.get(0),
            )
            .expect("count restored versions");
        assert_eq!(version_count, 2);
        let preview_count: i64 = store
            .connection
            .query_row(
                "SELECT COUNT(*) FROM document_reimport_previews WHERE document_id = ?1",
                [&restored_project.documents[0].id],
                |row| row.get(0),
            )
            .expect("count restored previews");
        assert_eq!(preview_count, 1);
        let snapshot_count: i64 = store
            .connection
            .query_row(
                "SELECT COUNT(*) FROM document_version_segments dvs
                 JOIN document_versions dv ON dv.id = dvs.version_id
                 WHERE dv.document_id = ?1",
                [&restored_project.documents[0].id],
                |row| row.get(0),
            )
            .expect("count restored version snapshots");
        assert_eq!(snapshot_count, 1);
        let (tm_matches, _) = store
            .search_tm(&TmSearchRequest {
                project_id: restored.id.clone(),
                source_locale: "en-US".to_string(),
                target_locale: "zh-CN".to_string(),
                query: "Portable source".to_string(),
                threshold: 100,
                offset: 0,
                limit: 20,
                library_ids: Vec::new(),
                domain: None,
                since_ms: None,
                origin_project_id: None,
                origin_document_id: None,
                context_before_hash: None,
                context_after_hash: None,
            })
            .expect("search restored TM");
        assert_eq!(tm_matches.len(), 1);
        assert_eq!(tm_matches[0].unit.target_text, "可移植译文");
        let legacy_tm = store
            .lookup_exact(&restored.id, "Portable source")
            .expect("lookup restored legacy TM provenance");
        assert_eq!(legacy_tm.len(), 1);
        assert_eq!(legacy_tm[0].target_text, "可移植译文");
        let (term_matches, _) = store
            .search_terms(&TermSearchRequest {
                project_id: restored.id.clone(),
                text: "Portable source".to_string(),
                offset: 0,
                limit: 20,
                termbase_ids: Vec::new(),
            })
            .expect("search restored terminology");
        assert_eq!(term_matches.len(), 1);
        assert!(
            store
                .list_tm_library_mounts(&restored.id)
                .expect("list restored TM mounts")
                .iter()
                .any(|mount| mount.library_id == external_tm.id)
        );
        assert!(
            store
                .list_termbase_mounts(&restored.id)
                .expect("list restored termbase mounts")
                .iter()
                .any(|mount| mount.termbase_id == external_tb.id)
        );
    }
}

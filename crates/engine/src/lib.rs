use std::collections::{BTreeMap, BTreeSet};
use std::env;
use std::fs::{self, File};
use std::io::{BufReader, Read, Write};
use std::path::{Component, Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, Ordering},
};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use base64::Engine as _;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use tempfile::NamedTempFile;
use thiserror::Error;
use translunar_ai_core::{
    AiCoreError, AlignmentRefinementLinkRevision, AlignmentRefinementRunContext,
};
use translunar_alignment_core::{AlignmentError, AlignmentEvidence as CoreAlignmentEvidence};
use translunar_asset_core::{
    AssetError, TermExchangeEntry, TermExchangeTranslation, TermStatus, TmExchangeUnit, exact_key,
    normalize_match_key,
};
use translunar_domain::{
    DataHealthReport, Document, EditorPreferences, EditorWorkflowState, Project, ProjectLifecycle,
    Segment, SegmentEditorRow, SegmentState, SpellFinding, new_id, state_for_target,
};
use translunar_editor_core::{
    SearchOptions, TextMatch, check_user_dictionary, cjk_assistance, normalize_dictionary_word,
    spell_word_spans,
};
use translunar_filter_core::{
    ExportRequest, FilterError, FilterRegistry, ImportRequest, ImportedDocument,
    collect_imported_document,
};
use translunar_filter_docx::{
    BilingualDocxFilter, DocxError, DocxFilter,
    extract_bilingual_table_rows as extract_bilingual_docx_rows,
};
use translunar_filter_html::HtmlFilter;
use translunar_filter_interop::{
    MqxliffFilter, MqxlzFilter, ParsedReviewPackage, ReviewExportInput, ReviewExportRow,
    ReviewPackageError, SdlxliffFilter, export_review_docx, parse_review_docx,
    source_hash as review_source_hash,
};
use translunar_filter_pdf::{PdfError, PdfFilter, PdfPath};
use translunar_filter_pptx::PptxFilter;
use translunar_filter_text::{MarkdownFilter, TxtFilter};
use translunar_filter_xliff::XliffFilter;
use translunar_filter_xlsx::{
    BilingualTableRow as BilingualXlsxTableRow, BilingualXlsxFilter, XlsxError, XlsxFilter,
    extract_bilingual_table_rows as extract_bilingual_xlsx_rows,
};
use translunar_lifecycle_core::{
    ArchiveEntry, MAX_ARCHIVE_ENTRIES, MAX_ARCHIVE_ENTRY_BYTES, MAX_ARCHIVE_TOTAL_BYTES,
    PROJECT_ARCHIVE_FORMAT_VERSION, ProjectArchiveManifest, sha256_hex,
};
use translunar_pipeline::{
    ArtifactKind, PipelineDefinition, PipelineError, PipelineFailure, PipelineStep,
    PipelineStepDefinition, PipelineStepOwner, PipelineStepPluginAttempt,
    PipelineStepPluginBinding, PipelineStepPluginOperation, PipelineStepRun, ResolvedPipelineStep,
    StepCheckpointMigrationContext, StepCheckpointMigrationOutcome, StepCheckpointSink,
    StepDescriptor, StepExecutionContext, StepOutcome, StepRegistry,
};
use translunar_protocol as protocol;
use translunar_protocol::methods;
use translunar_protocol::{
    AnalysisProfile, AnalysisProfileListResult, AnalysisRunIdParams, AnalysisRunParams,
    AnalysisRunResult, AssetExchangeFormat, BackupResult, BatchImportAtomicity,
    BatchImportDiagnostic, BilingualTableFormat, ConcordanceParams, ConcordanceResult,
    ConfirmSegmentParams, ConfirmSegmentResult, ConvertSegmentChineseParams, CorrectOcrParams,
    CorrectSourceParams, CreateBackupParams, CreatePipelineParams, CreateProjectParams,
    CreateSegmentCommentParams, DeleteSegmentCommentParams, DictionaryListParams,
    DictionaryListResult, DictionaryWordParams, DiscussionMessage, DiscussionMessageCreateParams,
    DiscussionMessageDeleteParams, DiscussionMessageListParams, DiscussionMessagePage,
    DiscussionMessageUpdateParams, DiscussionScope, DiscussionStatus, DiscussionThread,
    DiscussionThreadCreateParams, DiscussionThreadListParams, DiscussionThreadPage,
    DiscussionThreadResolveParams, DocumentIdParams, DocumentListParams, DocumentPage,
    DocumentReimportApplyParams, DocumentReimportPreviewParams, DocumentReimportPreviewResult,
    EditorHistoryParams, EditorHistoryResult, EditorMutationResult, EditorSearchField,
    EditorSegmentFilter, EditorSegmentListParams, EditorSegmentPage, EditorSegmentSort,
    EditorUndoRedoParams, EmptyParams, EmptyResult, ErrorCode, ExactLookupParams,
    ExactLookupResult, ExportDocumentParams, ExportDocumentResult, ExportDocxParams,
    ExportDocxResult, FilterListResult, FindSegmentsParams, GlobalSearchHit, GlobalSearchPage,
    GlobalSearchParams, HistoryListParams, ImportDocumentParams, ImportDocumentResult,
    ImportDocxParams, InitializeParams, InitializeResult, InteropApplyResult, InteropPreviewStatus,
    ListQaParams, MergeSegmentsParams, NamedProjectSnapshot, OperationPage, PROTOCOL_VERSION,
    PdfBoundingBox, PdfPageBlock, PdfPageDetail, PdfPageGetParams, PdfPageListParams,
    PdfPageListResult, PdfPageSummary, PipelineCapabilityResult, PipelineDefinitionPage,
    PipelineIdParams, PipelineListParams, PipelineRunIdParams, PipelineRunListParams,
    PipelineRunPage, PipelineRunRevisionParams, PipelineRunSnapshot as ProtocolPipelineRunSnapshot,
    PipelineValidationResult, ProjectAnalyticsParams, ProjectAnalyticsResult,
    ProjectArchiveExportParams, ProjectArchiveRestoreParams, ProjectArchiveResult,
    ProjectBatchImportParams, ProjectBatchImportResult, ProjectCreateFromTemplateParams,
    ProjectCreateFromTemplateResult, ProjectIdParams, ProjectListParams, ProjectPage,
    ProjectSnapshot, ProjectSnapshotChangeSummary, ProjectSnapshotCreateParams,
    ProjectSnapshotGetParams, ProjectSnapshotListParams, ProjectSnapshotPage,
    ProjectSnapshotPreview, ProjectSnapshotPreviewRestoreParams, ProjectSnapshotPreviewStatus,
    ProjectSnapshotRestoreParams, ProjectSnapshotRestoreResult, ProjectTemplate,
    ProjectTemplateCreateParams, ProjectTemplateDeleteParams, ProjectTemplateGetParams,
    ProjectTemplateListParams, ProjectTemplatePage, ProjectTemplateUpdateParams,
    PropagateSegmentParams, QaListResult, RecycleDeleteParams, RecycleEntry,
    RecycleEntryActionParams, RecycleListParams, RecyclePage, ReplaceApplyParams,
    ReplacePreviewItem, ReplacePreviewParams, ReplacePreviewResult, ResolveSegmentCommentParams,
    ReviewApplyParams, ReviewCreateParams, ReviewDecisionParams, ReviewExportParams,
    ReviewExportResult, ReviewInteropDisposition, ReviewListParams, ReviewListResult,
    ReviewPreviewParams, ReviewPreviewResult, ReviewPreviewRow, RpcError, RpcRequest, RpcResponse,
    RunPipelineParams, SegmentCommentListParams, SegmentCommentListResult, SegmentFindMatch,
    SegmentFindResult, SegmentListParams, SegmentPage, SetEditorWorkflowParams,
    SetProjectLifecycleParams, SetSegmentTagsParams, SpellCheckParams, SpellCheckResult,
    SplitSegmentParams, TableApplyParams, TableInteropDisposition, TablePreviewParams,
    TablePreviewResult, TablePreviewRow, TemplateDependencyDiagnostic, TermSearchParams,
    TermSearchResult, TermUpsertParams, TermbaseCreateParams, TermbaseExportParams,
    TermbaseExportResult, TermbaseImportParams, TermbaseImportResult, TermbaseListParams,
    TermbaseMountParams, TermbasePage, TermbaseUnmountParams, TmExportParams, TmExportResult,
    TmImportParams, TmImportResult, TmLibraryCreateParams, TmLibraryListParams,
    TmLibraryMountParams, TmLibraryPage, TmLibraryUnmountParams, TmSearchParams, TmSearchResult,
    UpdateEditorPreferencesParams, UpdateProjectParams, UpdateSegmentCommentParams,
    UpdateTargetParams, ValidatePipelineParams,
};
use translunar_storage as storage;
use translunar_storage::{
    AnalysisProfileRecord as StorageAnalysisProfile, AnalysisRunRecord as StorageAnalysisRun,
    ConcordanceRequest as StorageConcordanceRequest,
    DiscussionMessageRecord as StorageDiscussionMessage, DiscussionScope as StorageDiscussionScope,
    DiscussionStatus as StorageDiscussionStatus,
    DiscussionThreadFilter as StorageDiscussionThreadFilter,
    DiscussionThreadRecord as StorageDiscussionThread, EditorFilter as StorageEditorFilter,
    EditorListRequest as StorageEditorListRequest, EditorMutation as StorageEditorMutation,
    EditorSearchField as StorageEditorSearchField, EditorSort as StorageEditorSort,
    GlobalSearchQuery as StorageGlobalSearchQuery, GlobalSearchResult as StorageGlobalSearchResult,
    INTEROP_STRUCTURAL_PATH_METADATA, InteropApplyResult as StorageInteropApplyResult,
    InteropPreviewKind, InteropPreviewRecord, InteropPreviewRowRecord, ManagedDocument,
    NamedProjectSnapshotRecord as StorageProjectSnapshot, NewDiscussionMessage,
    NewDiscussionThread, NewDocument, NewInteropPreview, NewInteropPreviewRow,
    NewPipelineDefinition, NewProjectArchiveRecord, NewProjectSnapshot, NewReferenceCorpus,
    NewReferenceCorpusEntry, NewReimportPreview, NewTermEntry, NewTermTranslation, NewTmLibrary,
    ProjectArchiveData, ProjectFromTemplateResult as StorageProjectFromTemplateResult,
    ProjectSnapshotChangeSummaryRecord as StorageSnapshotSummary,
    ProjectSnapshotPreviewRecord as StorageSnapshotPreview,
    ProjectSnapshotPreviewStatusRecord as StorageSnapshotPreviewStatus,
    ProjectSnapshotRestoreResultRecord as StorageSnapshotRestoreResult,
    ProjectTemplateRecord as StorageProjectTemplate, ProjectUpdate,
    RecycleEntryRecord as StorageRecycleEntry, ReferenceCorpusKind, ReferenceCorpusMutationResult,
    ReimportPreviewRecord as StorageReimportPreview, ReplaceItem as StorageReplaceItem,
    ReplacePreview as StorageReplacePreview, ReplaceRequest as StorageReplaceRequest,
    RestoreProjectSnapshot, ReviewInteropApply, ReviewProposal, StorageError, Store,
    TableInteropApply, TermSearchRequest as StorageTermSearchRequest,
    TmSearchRequest as StorageTmSearchRequest, interop_comment_context,
};
use translunar_task_package_core::TaskPackageError;
use zip::write::{SimpleFileOptions, ZipWriter};
use zip::{CompressionMethod, ZipArchive};

mod ai;
mod ai_quality;
mod allowlist;
mod collab;
mod curation;
mod local_api;
mod local_auth;
mod plugin;
mod plugin_ai_ui;
mod plugin_capability;
mod plugin_connector;
mod plugin_declarative;
mod plugin_external_connector;
pub use local_api::{LocalApiConfig, run_pipeline, serve as serve_local_api, validate_bind};
pub use local_auth::{LocalApiTokenStore, default_token_store, ensure_token, rotate_token};
mod qa;
mod task_package;

pub use ai::AlignmentRefinementStart;

#[derive(Debug, Error)]
pub enum EngineError {
    #[error(transparent)]
    Storage(#[from] StorageError),

    #[error("document import failed: {0}")]
    Import(#[source] FilterError),

    #[error("reference corpus import failed: {0}")]
    CorpusImport(#[source] FilterError),

    #[error("unsupported reference corpus input: {0}")]
    CorpusInput(String),

    #[error("document export failed: {0}")]
    Export(#[source] FilterError),

    #[error("asset exchange failed: {0}")]
    Asset(#[from] AssetError),

    #[error("asset curation failed: {0}")]
    Curation(#[from] translunar_curation_core::CurationError),

    #[error("curation dataset export failed: {0}")]
    CurationExport(String),

    #[error("plugin manifest invalid: {0}")]
    PluginInvalidManifest(String),

    #[error("plugin schema or protocol version is unsupported: {0}")]
    PluginUnsupportedVersion(String),

    #[error("plugin is incompatible with this host: {0}")]
    PluginIncompatibleHost(String),

    #[error("plugin capability is unavailable: {0}")]
    PluginCapabilityUnsupported(String),

    #[error("plugin identity or version conflicts with existing state: {0}")]
    PluginConflict(String),

    #[error("plugin package is invalid: {0}")]
    PluginPackageInvalid(String),

    #[error("plugin package hash mismatch: {0}")]
    PluginPackageHashMismatch(String),

    #[error("plugin upgrade failed: {0}")]
    PluginUpgradeFailed(String),

    #[error("plugin permission denied: {0}")]
    PluginPermissionDenied(String),

    #[error("plugin capability denied: {0}")]
    PluginCapabilityDenied(Box<translunar_plugin_runtime::PluginCapabilityDenial>),

    #[error("plugin process failed: {0}")]
    PluginProcessFailed(String),

    #[error("plugin sandbox failed: {0}")]
    PluginSandboxFailed(String),

    #[error("plugin AI action `{contribution_id}` from `{plugin_id}` failed ({code}): {message}")]
    PluginAiActionFailed {
        plugin_id: String,
        contribution_id: String,
        code: String,
        message: String,
    },

    #[error("engine I/O failed: {0}")]
    Io(#[from] std::io::Error),

    #[error("engine JSON processing failed: {0}")]
    Json(#[from] serde_json::Error),

    #[error("task package validation failed: {0}")]
    TaskPackage(#[from] TaskPackageError),

    #[error("task package export failed: {0}")]
    TaskPackageExport(String),

    #[error("invalid request: {0}")]
    InvalidRequest(String),

    #[error("invalid engine state: {0}")]
    InvalidState(String),

    #[error("AI provider profile `{profile_id}` is not allowed for project `{project_id}`")]
    PolicyDenied {
        project_id: String,
        profile_id: String,
    },

    #[error("QA gate blocked document export")]
    QaGateBlocked {
        document_id: String,
        run_id: String,
        blocker_issue_ids: Vec<String>,
        error_count: u64,
        warning_count: u64,
        info_count: u64,
        waived_count: u64,
    },

    #[error("QA report export failed: {0}")]
    ReportExport(String),

    #[error(transparent)]
    Ai(#[from] AiCoreError),

    #[error("AI credential storage is unavailable: {0}")]
    CredentialUnavailable(String),

    #[error("AI is disabled")]
    AiDisabled,

    #[error("AI monthly token budget is exhausted")]
    BudgetExceeded,
}

pub type Result<T> = std::result::Result<T, EngineError>;

fn bounded_page_size(limit: u32) -> Result<u32> {
    if (1..=500).contains(&limit) {
        Ok(limit)
    } else {
        Err(EngineError::InvalidRequest(
            "limit must be between 1 and 500".to_string(),
        ))
    }
}

fn collect_batch_files(
    root: &Path,
    directory: &Path,
    output: &mut Vec<(PathBuf, Option<String>)>,
    max_files: usize,
) -> Result<()> {
    let mut entries = fs::read_dir(directory)?.collect::<std::io::Result<Vec<_>>>()?;
    entries.sort_by_key(std::fs::DirEntry::file_name);
    for entry in entries {
        let path = entry.path();
        if path.is_dir() {
            collect_batch_files(root, &path, output, max_files)?;
        } else if path.is_file() {
            if output.len() >= max_files {
                return Err(EngineError::InvalidRequest(format!(
                    "folder import exceeds the {max_files} file limit"
                )));
            }
            let relative = path
                .strip_prefix(root)
                .map_err(|_| {
                    EngineError::InvalidRequest(
                        "discovered file escaped the selected folder".to_string(),
                    )
                })?
                .to_string_lossy()
                .replace('\\', "/");
            output.push((path, Some(relative)));
        }
    }
    Ok(())
}

fn engine_error_code(error: &EngineError) -> &'static str {
    match error {
        EngineError::Storage(StorageError::NotFound { .. }) => "not_found",
        EngineError::Storage(StorageError::Conflict { .. })
        | EngineError::Storage(StorageError::EntityConflict { .. }) => "conflict",
        EngineError::Import(FilterError::PluginPermissionDenied { .. })
        | EngineError::CorpusImport(FilterError::PluginPermissionDenied { .. })
        | EngineError::Export(FilterError::PluginPermissionDenied { .. }) => {
            "plugin_permission_denied"
        }
        EngineError::Import(FilterError::PluginProcessFailed { .. })
        | EngineError::CorpusImport(FilterError::PluginProcessFailed { .. })
        | EngineError::Export(FilterError::PluginProcessFailed { .. }) => "plugin_process_failed",
        EngineError::PluginInvalidManifest(_) => "plugin_invalid_manifest",
        EngineError::PluginUnsupportedVersion(_) => "plugin_unsupported_version",
        EngineError::PluginIncompatibleHost(_) => "plugin_incompatible_host",
        EngineError::PluginCapabilityUnsupported(_) => "plugin_capability_unsupported",
        EngineError::PluginConflict(_) => "plugin_conflict",
        EngineError::PluginPackageInvalid(_) => "plugin_package_invalid",
        EngineError::PluginPackageHashMismatch(_) => "plugin_package_hash_mismatch",
        EngineError::PluginUpgradeFailed(_) => "plugin_upgrade_failed",
        EngineError::PluginPermissionDenied(_) => "plugin_permission_denied",
        EngineError::PluginCapabilityDenied(_) => "plugin_permission_denied",
        EngineError::PluginProcessFailed(_) => "plugin_process_failed",
        EngineError::PluginSandboxFailed(_) | EngineError::PluginAiActionFailed { .. } => {
            "plugin_sandbox_failed"
        }
        EngineError::Import(_) => "unsupported_document",
        EngineError::CorpusImport(FilterError::NotFound(_)) => "not_found",
        EngineError::CorpusImport(_) | EngineError::CorpusInput(_) => "unsupported_corpus_input",
        EngineError::Storage(StorageError::Alignment(AlignmentError::ResourceLimitExceeded {
            ..
        })) => "resource_limit_exceeded",
        EngineError::Storage(StorageError::Alignment(
            AlignmentError::InvalidRefinementResponse { .. }
            | AlignmentError::InvalidRefinementConfidence { .. },
        )) => "alignment_response_invalid",
        EngineError::Storage(StorageError::Alignment(_)) => "alignment_invalid_partition",
        EngineError::TaskPackage(TaskPackageError::ResourceLimit { .. })
        | EngineError::Storage(StorageError::TaskPackage(TaskPackageError::ResourceLimit {
            ..
        })) => "resource_limit",
        EngineError::TaskPackageExport(_) => "export_error",
        EngineError::TaskPackage(_) | EngineError::Storage(StorageError::TaskPackage(_)) => {
            "invalid_request"
        }
        EngineError::InvalidRequest(_) => "invalid_request",
        EngineError::InvalidState(_) => "invalid_state",
        EngineError::PolicyDenied { .. } => "policy_denied",
        EngineError::Io(_) | EngineError::Storage(_) => "storage_error",
        _ => "internal_error",
    }
}

fn protocol_template(value: StorageProjectTemplate) -> ProjectTemplate {
    ProjectTemplate {
        id: value.id,
        revision: value.revision,
        name: value.name,
        description: value.description,
        definition: value.definition,
        built_in: value.built_in,
        created_at_ms: value.created_at_ms,
        updated_at_ms: value.updated_at_ms,
    }
}

fn protocol_discussion_scope(value: StorageDiscussionScope) -> DiscussionScope {
    match value {
        StorageDiscussionScope::Project => DiscussionScope::Project,
        StorageDiscussionScope::Document => DiscussionScope::Document,
        StorageDiscussionScope::Segment => DiscussionScope::Segment,
    }
}

fn storage_discussion_scope(value: DiscussionScope) -> StorageDiscussionScope {
    match value {
        DiscussionScope::Project => StorageDiscussionScope::Project,
        DiscussionScope::Document => StorageDiscussionScope::Document,
        DiscussionScope::Segment => StorageDiscussionScope::Segment,
    }
}

fn protocol_discussion_status(value: StorageDiscussionStatus) -> DiscussionStatus {
    match value {
        StorageDiscussionStatus::Open => DiscussionStatus::Open,
        StorageDiscussionStatus::Resolved => DiscussionStatus::Resolved,
    }
}

fn protocol_discussion_thread(value: StorageDiscussionThread) -> DiscussionThread {
    DiscussionThread {
        id: value.id,
        project_id: value.project_id,
        scope: protocol_discussion_scope(value.scope),
        document_id: value.document_id,
        segment_id: value.segment_id,
        title: value.title,
        status: protocol_discussion_status(value.status),
        revision: value.revision,
        message_count: value.message_count,
        created_at_ms: value.created_at_ms,
        updated_at_ms: value.updated_at_ms,
        resolved_at_ms: value.resolved_at_ms,
        resolved_by: value.resolved_by,
    }
}

fn protocol_discussion_message(value: StorageDiscussionMessage) -> DiscussionMessage {
    DiscussionMessage {
        id: value.id,
        thread_id: value.thread_id,
        ordinal: value.ordinal,
        actor: value.actor,
        body: value.body,
        mentions: value.mentions,
        revision: value.revision,
        thread_revision: value.thread_revision,
        deleted: value.deleted,
        created_at_ms: value.created_at_ms,
        updated_at_ms: value.updated_at_ms,
    }
}

fn protocol_snapshot_metadata(value: StorageProjectSnapshot) -> NamedProjectSnapshot {
    NamedProjectSnapshot {
        id: value.id,
        project_id: value.project_id,
        name: value.name,
        base_project_revision: value.base_project_revision,
        state_hash: value.state_hash,
        document_count: value.document_count,
        segment_count: value.segment_count,
        thread_count: value.thread_count,
        created_at_ms: value.created_at_ms,
        actor: value.actor,
        reason: value.reason,
    }
}

fn protocol_snapshot_summary(value: StorageSnapshotSummary) -> ProjectSnapshotChangeSummary {
    ProjectSnapshotChangeSummary {
        documents_added: value.documents_added,
        documents_removed: value.documents_removed,
        documents_changed: value.documents_changed,
        segments_added: value.segments_added,
        segments_removed: value.segments_removed,
        segments_changed: value.segments_changed,
        comments_changed: value.comments_changed,
        reviews_changed: value.reviews_changed,
        discussions_changed: value.discussions_changed,
        mounts_added: value.mounts_added,
        mounts_removed: value.mounts_removed,
        mounts_changed: value.mounts_changed,
    }
}

fn protocol_snapshot_preview_status(
    value: StorageSnapshotPreviewStatus,
) -> ProjectSnapshotPreviewStatus {
    match value {
        StorageSnapshotPreviewStatus::Open => ProjectSnapshotPreviewStatus::Open,
        StorageSnapshotPreviewStatus::Applied => ProjectSnapshotPreviewStatus::Applied,
    }
}

fn protocol_snapshot_preview(value: StorageSnapshotPreview) -> ProjectSnapshotPreview {
    ProjectSnapshotPreview {
        preview_id: value.preview_id,
        snapshot_id: value.snapshot_id,
        project_id: value.project_id,
        expected_project_revision: value.expected_project_revision,
        current_project_revision: value.current_project_revision,
        current_state_hash: value.current_state_hash,
        status: protocol_snapshot_preview_status(value.status),
        summary: protocol_snapshot_summary(value.summary),
        missing_dependency_ids: value.missing_dependency_ids,
    }
}

fn protocol_snapshot_restore_result(
    value: StorageSnapshotRestoreResult,
) -> ProjectSnapshotRestoreResult {
    ProjectSnapshotRestoreResult {
        preview_id: value.preview_id,
        snapshot_id: value.snapshot_id,
        status: protocol_snapshot_preview_status(value.status),
        project_revision: value.project_revision,
        summary: protocol_snapshot_summary(value.summary),
        operation_id: value.operation_id,
    }
}

fn protocol_project_from_template(
    value: StorageProjectFromTemplateResult,
) -> ProjectCreateFromTemplateResult {
    ProjectCreateFromTemplateResult {
        project: value.project,
        diagnostics: value
            .diagnostics
            .into_iter()
            .map(|diagnostic| TemplateDependencyDiagnostic {
                kind: diagnostic.kind,
                requested_id: diagnostic.requested_id,
                resolved_id: diagnostic.resolved_id,
                status: diagnostic.status,
                message: diagnostic.message,
            })
            .collect(),
    }
}

fn protocol_recycle_entry(value: StorageRecycleEntry) -> RecycleEntry {
    RecycleEntry {
        id: value.id,
        project_id: value.project_id,
        entity_type: value.entity_type,
        entity_id: value.entity_id,
        display_name: value.display_name,
        previous_state: value.previous_state,
        actor: value.actor,
        reason: value.reason,
        deleted_at_ms: value.deleted_at_ms,
        retention_until_ms: value.retention_until_ms,
        restored_at_ms: value.restored_at_ms,
        purged_at_ms: value.purged_at_ms,
    }
}

fn protocol_search_hit(value: StorageGlobalSearchResult) -> GlobalSearchHit {
    GlobalSearchHit {
        project_id: value.project_id,
        project_name: value.project_name,
        document_id: value.document_id,
        document_name: value.document_name,
        segment_id: value.segment_id,
        segment_ordinal: value.segment_ordinal,
        field: value.field,
        locale: value.locale,
        workflow_state: value.workflow_state,
        snippet: value.snippet,
        updated_at_ms: value.updated_at_ms,
    }
}

fn protocol_analysis_profile(value: StorageAnalysisProfile) -> AnalysisProfile {
    AnalysisProfile {
        id: value.id,
        revision: value.revision,
        name: value.name,
        weights: value.weights,
        built_in: value.built_in,
        created_at_ms: value.created_at_ms,
        updated_at_ms: value.updated_at_ms,
    }
}

fn protocol_analysis_run(value: StorageAnalysisRun) -> AnalysisRunResult {
    AnalysisRunResult {
        id: value.id,
        project_id: value.project_id,
        document_id: value.document_id,
        profile_id: value.profile_id,
        profile_revision: value.profile_revision,
        project_revision: value.project_revision,
        document_revision: value.document_revision,
        stale: value.stale,
        summary: value.summary,
        document_summaries: value.document_summaries,
        created_at_ms: value.created_at_ms,
        completed_at_ms: value.completed_at_ms,
    }
}

fn protocol_alignment_session_status(
    value: storage::AlignmentSessionStatus,
) -> protocol::AlignmentSessionStatus {
    match value {
        storage::AlignmentSessionStatus::Open => protocol::AlignmentSessionStatus::Open,
        storage::AlignmentSessionStatus::Applied => protocol::AlignmentSessionStatus::Applied,
        storage::AlignmentSessionStatus::Discarded => protocol::AlignmentSessionStatus::Discarded,
    }
}

fn storage_alignment_session_status(
    value: protocol::AlignmentSessionStatus,
) -> storage::AlignmentSessionStatus {
    match value {
        protocol::AlignmentSessionStatus::Open => storage::AlignmentSessionStatus::Open,
        protocol::AlignmentSessionStatus::Applied => storage::AlignmentSessionStatus::Applied,
        protocol::AlignmentSessionStatus::Discarded => storage::AlignmentSessionStatus::Discarded,
    }
}

fn protocol_alignment_apply_result(
    value: storage::AlignmentApplyResult,
) -> protocol::AlignmentApplyResult {
    protocol::AlignmentApplyResult {
        session_id: value.session_id,
        library_id: value.library_id,
        status: protocol_alignment_session_status(value.status),
        selected_count: value.selected_count,
        inserted_count: value.inserted_count,
        duplicate_count: value.duplicate_count,
        session_revision: value.session_revision,
        library_revision: value.library_revision,
        operation_id: value.operation_id,
        tm_unit_ids: value.tm_unit_ids,
        duplicates: value
            .duplicates
            .into_iter()
            .map(|duplicate| protocol::AlignmentApplyDuplicate {
                link_id: duplicate.link_id,
                tm_unit_id: duplicate.tm_unit_id,
            })
            .collect(),
    }
}

fn protocol_alignment_terminal_result(
    value: Option<Value>,
) -> Result<Option<protocol::AlignmentApplyResult>> {
    value
        .map(|terminal| {
            let stored = terminal.get("result").cloned().ok_or_else(|| {
                EngineError::Storage(StorageError::InvalidData(
                    "alignment terminal result is missing its public result".to_string(),
                ))
            })?;
            let result =
                serde_json::from_value::<storage::AlignmentApplyResult>(stored).map_err(|_| {
                    EngineError::Storage(StorageError::InvalidData(
                        "alignment terminal result is invalid".to_string(),
                    ))
                })?;
            Ok(protocol_alignment_apply_result(result))
        })
        .transpose()
}

fn protocol_alignment_session(
    value: storage::AlignmentSessionRecord,
) -> Result<protocol::AlignmentSession> {
    let terminal_result = protocol_alignment_terminal_result(value.terminal_result)?;
    Ok(protocol::AlignmentSession {
        id: value.id,
        project_id: value.project_id,
        source_document_id: value.source_document_id,
        target_document_id: value.target_document_id,
        source_document_revision: value.source_document_revision,
        target_document_revision: value.target_document_revision,
        source_locale: value.source_locale,
        target_locale: value.target_locale,
        algorithm_version: value.algorithm_version,
        status: protocol_alignment_session_status(value.status),
        revision: value.revision,
        terminal_result,
        created_at_ms: value.created_at_ms,
        updated_at_ms: value.updated_at_ms,
        closed_at_ms: value.closed_at_ms,
    })
}

fn protocol_alignment_link(value: storage::AlignmentLinkRecord) -> protocol::AlignmentLink {
    protocol::AlignmentLink {
        id: value.id,
        session_id: value.session_id,
        ordinal: value.ordinal,
        source_segment_ids: value.source_segment_ids,
        target_segment_ids: value.target_segment_ids,
        source_text: value.source_text,
        target_text: value.target_text,
        confidence_basis_points: value.confidence_basis_points,
        evidence: value
            .evidence
            .into_iter()
            .map(protocol_alignment_evidence)
            .collect(),
        origin: value.origin,
        status: value.status,
        revision: value.revision,
        created_at_ms: value.created_at_ms,
        updated_at_ms: value.updated_at_ms,
    }
}

fn protocol_alignment_evidence(value: CoreAlignmentEvidence) -> protocol::AlignmentEvidence {
    match value {
        CoreAlignmentEvidence::Length {
            score_basis_points,
            source_chars,
            target_chars,
            summary,
        } => protocol::AlignmentEvidence::Length {
            score_basis_points,
            source_chars,
            target_chars,
            summary,
        },
        CoreAlignmentEvidence::Numbers {
            score_basis_points,
            source_values,
            target_values,
            source_value_count,
            target_value_count,
            summary,
        } => protocol::AlignmentEvidence::Numbers {
            score_basis_points,
            source_values,
            target_values,
            source_value_count,
            target_value_count,
            summary,
        },
        CoreAlignmentEvidence::Punctuation {
            score_basis_points,
            source_signature,
            target_signature,
            summary,
        } => protocol::AlignmentEvidence::Punctuation {
            score_basis_points,
            source_signature,
            target_signature,
            summary,
        },
        CoreAlignmentEvidence::Tags {
            score_basis_points,
            source_signature,
            target_signature,
            source_tag_count,
            target_tag_count,
            summary,
        } => protocol::AlignmentEvidence::Tags {
            score_basis_points,
            source_signature,
            target_signature,
            source_tag_count,
            target_tag_count,
            summary,
        },
        CoreAlignmentEvidence::LexicalAnchors {
            score_basis_points,
            shared_anchors,
            shared_anchor_count,
            summary,
        } => protocol::AlignmentEvidence::LexicalAnchors {
            score_basis_points,
            shared_anchors,
            shared_anchor_count,
            summary,
        },
        CoreAlignmentEvidence::Displacement {
            penalty_basis_points,
            source_position_basis_points,
            target_position_basis_points,
            summary,
        } => protocol::AlignmentEvidence::Displacement {
            penalty_basis_points,
            source_position_basis_points,
            target_position_basis_points,
            summary,
        },
        CoreAlignmentEvidence::Unaligned {
            side,
            penalty_basis_points,
            summary,
        } => protocol::AlignmentEvidence::Unaligned {
            side,
            penalty_basis_points,
            summary,
        },
        CoreAlignmentEvidence::AiRefinement { summary } => {
            protocol::AlignmentEvidence::AiRefinement { summary }
        }
    }
}

fn protocol_alignment_session_create_result(
    value: storage::AlignmentSessionCreateResult,
) -> Result<protocol::AlignmentSessionCreateResult> {
    Ok(protocol::AlignmentSessionCreateResult {
        session: protocol_alignment_session(value.session)?,
        work_units: value.work_units,
        source_segment_count: value.source_segment_count,
        target_segment_count: value.target_segment_count,
        link_count: value.link_count,
        operation_id: value.operation_id,
    })
}

fn protocol_alignment_mutation_result(
    value: storage::AlignmentMutationResult,
) -> Result<protocol::AlignmentMutationResult> {
    Ok(protocol::AlignmentMutationResult {
        session: protocol_alignment_session(value.session)?,
        links: value
            .links
            .into_iter()
            .map(protocol_alignment_link)
            .collect(),
        operation_id: value.operation_id,
    })
}

fn storage_expected_alignment_link_revision(
    value: protocol::AlignmentExpectedLinkRevision,
) -> storage::ExpectedAlignmentLinkRevision {
    storage::ExpectedAlignmentLinkRevision {
        link_id: value.link_id,
        expected_revision: value.expected_revision,
    }
}

fn protocol_reference_corpus_kind(
    value: storage::ReferenceCorpusKind,
) -> protocol::ReferenceCorpusKind {
    match value {
        storage::ReferenceCorpusKind::MonolingualSource => {
            protocol::ReferenceCorpusKind::MonolingualSource
        }
        storage::ReferenceCorpusKind::MonolingualTarget => {
            protocol::ReferenceCorpusKind::MonolingualTarget
        }
        storage::ReferenceCorpusKind::Bilingual => protocol::ReferenceCorpusKind::Bilingual,
    }
}

fn storage_reference_corpus_kind(
    value: protocol::ReferenceCorpusKind,
) -> storage::ReferenceCorpusKind {
    match value {
        protocol::ReferenceCorpusKind::MonolingualSource => {
            storage::ReferenceCorpusKind::MonolingualSource
        }
        protocol::ReferenceCorpusKind::MonolingualTarget => {
            storage::ReferenceCorpusKind::MonolingualTarget
        }
        protocol::ReferenceCorpusKind::Bilingual => storage::ReferenceCorpusKind::Bilingual,
    }
}

fn protocol_reference_corpus_source_kind(
    value: storage::ReferenceCorpusSourceKind,
) -> protocol::ReferenceCorpusSourceKind {
    match value {
        storage::ReferenceCorpusSourceKind::File => protocol::ReferenceCorpusSourceKind::File,
        storage::ReferenceCorpusSourceKind::Alignment => {
            protocol::ReferenceCorpusSourceKind::Alignment
        }
    }
}

fn protocol_reference_corpus_status(
    value: storage::ReferenceCorpusStatus,
) -> protocol::ReferenceCorpusStatus {
    match value {
        storage::ReferenceCorpusStatus::Active => protocol::ReferenceCorpusStatus::Active,
        storage::ReferenceCorpusStatus::Removed => protocol::ReferenceCorpusStatus::Removed,
    }
}

fn storage_reference_corpus_status(
    value: protocol::ReferenceCorpusStatus,
) -> storage::ReferenceCorpusStatus {
    match value {
        protocol::ReferenceCorpusStatus::Active => storage::ReferenceCorpusStatus::Active,
        protocol::ReferenceCorpusStatus::Removed => storage::ReferenceCorpusStatus::Removed,
    }
}

fn protocol_reference_corpus(value: storage::ReferenceCorpusRecord) -> protocol::ReferenceCorpus {
    protocol::ReferenceCorpus {
        id: value.id,
        project_id: value.project_id,
        name: value.name,
        kind: protocol_reference_corpus_kind(value.kind),
        source_locale: value.source_locale,
        target_locale: value.target_locale,
        source_kind: protocol_reference_corpus_source_kind(value.source_kind),
        managed_source_path: value.managed_source_path,
        input_filter_id: value.input_filter_id,
        input_format: value.input_format,
        input_sha256: value.input_sha256,
        source_document_id: value.source_document_id,
        target_document_id: value.target_document_id,
        alignment_session_id: value.alignment_session_id,
        status: protocol_reference_corpus_status(value.status),
        revision: value.revision,
        entry_count: value.entry_count,
        diagnostic_count: value.diagnostic_count,
        diagnostics: value.diagnostics,
        created_at_ms: value.created_at_ms,
        updated_at_ms: value.updated_at_ms,
        removed_at_ms: value.removed_at_ms,
    }
}

fn protocol_reference_corpus_entry(
    value: storage::ReferenceCorpusEntryRecord,
) -> protocol::ReferenceCorpusEntry {
    protocol::ReferenceCorpusEntry {
        id: value.id,
        corpus_id: value.corpus_id,
        ordinal: value.ordinal,
        source_text: value.source_text,
        target_text: value.target_text,
        structural_path: value.structural_path,
        provenance: value.provenance,
        created_at_ms: value.created_at_ms,
        updated_at_ms: value.updated_at_ms,
    }
}

fn protocol_reference_corpus_mutation_result(
    value: storage::ReferenceCorpusMutationResult,
) -> protocol::ReferenceCorpusMutationResult {
    protocol::ReferenceCorpusMutationResult {
        corpus: protocol_reference_corpus(value.corpus),
        affected_entry_count: value.affected_entry_count,
        operation_id: value.operation_id,
    }
}

fn storage_reference_corpus_search_side(
    value: protocol::CorpusSearchSide,
) -> storage::ReferenceCorpusSearchSide {
    match value {
        protocol::CorpusSearchSide::Source => storage::ReferenceCorpusSearchSide::Source,
        protocol::CorpusSearchSide::Target => storage::ReferenceCorpusSearchSide::Target,
        protocol::CorpusSearchSide::Both => storage::ReferenceCorpusSearchSide::Both,
    }
}

fn storage_reference_corpus_concordance_side(
    value: translunar_asset_core::ConcordanceSide,
) -> storage::ReferenceCorpusSearchSide {
    match value {
        translunar_asset_core::ConcordanceSide::Source => {
            storage::ReferenceCorpusSearchSide::Source
        }
        translunar_asset_core::ConcordanceSide::Target => {
            storage::ReferenceCorpusSearchSide::Target
        }
        translunar_asset_core::ConcordanceSide::Both => storage::ReferenceCorpusSearchSide::Both,
    }
}

fn protocol_reference_corpus_matched_side(
    value: storage::ReferenceCorpusMatchedSide,
) -> protocol::CorpusMatchedSide {
    match value {
        storage::ReferenceCorpusMatchedSide::Source => protocol::CorpusMatchedSide::Source,
        storage::ReferenceCorpusMatchedSide::Target => protocol::CorpusMatchedSide::Target,
        storage::ReferenceCorpusMatchedSide::Both => protocol::CorpusMatchedSide::Both,
    }
}

fn protocol_reference_corpus_match_kind(
    value: storage::ReferenceCorpusMatchKind,
) -> protocol::CorpusMatchKind {
    match value {
        storage::ReferenceCorpusMatchKind::Exact => protocol::CorpusMatchKind::Exact,
        storage::ReferenceCorpusMatchKind::Prefix => protocol::CorpusMatchKind::Prefix,
        storage::ReferenceCorpusMatchKind::Contains => protocol::CorpusMatchKind::Contains,
    }
}

fn protocol_reference_corpus_search_result(
    value: storage::ReferenceCorpusSearchResult,
) -> protocol::CorpusSearchResult {
    protocol::CorpusSearchResult {
        items: value
            .items
            .into_iter()
            .map(|hit| protocol::CorpusSearchHit {
                corpus: protocol_reference_corpus(hit.corpus),
                entry: protocol_reference_corpus_entry(hit.entry),
                matched_side: protocol_reference_corpus_matched_side(hit.matched_side),
                match_kind: protocol_reference_corpus_match_kind(hit.match_kind),
            })
            .collect(),
        total: value.total,
        offset: value.offset,
        limit: value.limit,
    }
}

fn protocol_reimport_preview(value: StorageReimportPreview) -> DocumentReimportPreviewResult {
    DocumentReimportPreviewResult {
        preview_id: value.id,
        document_id: value.document_id,
        expected_document_revision: value.expected_document_revision,
        candidate_source_sha256: value.candidate_source_sha256,
        plan: value.plan,
        created_at_ms: value.created_at_ms,
    }
}

#[derive(Debug, Clone)]
pub struct ReferenceCorpusImportRequest {
    pub project_id: String,
    pub expected_project_revision: u64,
    pub source_path: PathBuf,
    pub name: String,
    pub kind: ReferenceCorpusKind,
    pub source_locale: String,
    pub target_locale: String,
    pub filter_id: Option<String>,
    pub options: BTreeMap<String, String>,
    pub actor: String,
    pub reason: String,
    pub correlation_id: Option<String>,
}

struct ValidatedProjectArchive {
    manifest: ProjectArchiveManifest,
    data: ProjectArchiveData,
    payloads: BTreeMap<String, Vec<u8>>,
}

struct PreparedDocumentImport {
    input: NewDocument,
    units: Vec<translunar_filter_core::ImportedUnit>,
}

#[derive(Debug, Clone)]
struct StagedInteropInput {
    path: PathBuf,
    relative_path: String,
    sha256: String,
}

#[derive(Debug, Clone)]
struct BilingualInteropRow {
    group: u32,
    source_row: u32,
    structural_path: String,
    cells: Vec<String>,
}

enum BatchSelection {
    Candidate {
        path: PathBuf,
        display: String,
        relative: String,
    },
    Failed(Box<BatchImportDiagnostic>),
}

fn validate_project_archive_file(path: &Path) -> Result<()> {
    let _ = read_validated_project_archive(path)?;
    Ok(())
}

fn read_validated_project_archive(path: &Path) -> Result<ValidatedProjectArchive> {
    if !path.is_file() {
        return Err(EngineError::InvalidRequest(
            "project archive does not exist".to_string(),
        ));
    }
    let file = File::open(path)?;
    let mut archive = ZipArchive::new(file).map_err(|error| {
        EngineError::InvalidRequest(format!("invalid project archive: {error}"))
    })?;
    if archive.is_empty() || archive.len() > MAX_ARCHIVE_ENTRIES.saturating_add(1) {
        return Err(EngineError::InvalidRequest(
            "project archive entry count is outside supported bounds".to_string(),
        ));
    }
    let mut manifest_bytes = None;
    let mut payloads = BTreeMap::new();
    let mut total = 0_u64;
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).map_err(|error| {
            EngineError::InvalidRequest(format!("invalid project archive entry: {error}"))
        })?;
        if entry.is_dir() {
            return Err(EngineError::InvalidRequest(
                "project archive cannot contain directory entries".to_string(),
            ));
        }
        let name = entry.name().to_string();
        if name == "manifest.json" {
            if manifest_bytes.is_some() || entry.size() > 8 * 1024 * 1024 {
                return Err(EngineError::InvalidRequest(
                    "project archive contains an invalid manifest".to_string(),
                ));
            }
            let mut bytes = Vec::with_capacity(usize::try_from(entry.size()).unwrap_or(0));
            entry.read_to_end(&mut bytes).map_err(|error| {
                EngineError::InvalidRequest(format!(
                    "invalid project archive manifest data: {error}"
                ))
            })?;
            manifest_bytes = Some(bytes);
            continue;
        }
        if entry.size() > MAX_ARCHIVE_ENTRY_BYTES {
            return Err(EngineError::InvalidRequest(
                "project archive entry exceeds the size limit".to_string(),
            ));
        }
        total = total.checked_add(entry.size()).ok_or_else(|| {
            EngineError::InvalidRequest("project archive size overflow".to_string())
        })?;
        if total > MAX_ARCHIVE_TOTAL_BYTES {
            return Err(EngineError::InvalidRequest(
                "project archive exceeds the total size limit".to_string(),
            ));
        }
        let mut bytes = Vec::with_capacity(usize::try_from(entry.size()).unwrap_or(0));
        entry.read_to_end(&mut bytes).map_err(|error| {
            EngineError::InvalidRequest(format!("invalid project archive entry data: {error}"))
        })?;
        if payloads.insert(name, bytes).is_some() {
            return Err(EngineError::InvalidRequest(
                "project archive contains duplicate entry paths".to_string(),
            ));
        }
    }
    let manifest_bytes = manifest_bytes.ok_or_else(|| {
        EngineError::InvalidRequest("project archive manifest is missing".to_string())
    })?;
    let manifest: ProjectArchiveManifest =
        serde_json::from_slice(&manifest_bytes).map_err(|error| {
            EngineError::InvalidRequest(format!("invalid project archive manifest: {error}"))
        })?;
    manifest
        .validate()
        .map_err(|error| EngineError::InvalidRequest(error.to_string()))?;
    if payloads.len() != manifest.entries.len() {
        return Err(EngineError::InvalidRequest(
            "project archive entries do not match its manifest".to_string(),
        ));
    }
    for expected in &manifest.entries {
        let bytes = payloads.get(&expected.path).ok_or_else(|| {
            EngineError::InvalidRequest(format!(
                "project archive entry is missing: {}",
                expected.path
            ))
        })?;
        if u64::try_from(bytes.len()).unwrap_or(u64::MAX) != expected.size_bytes
            || sha256_hex(bytes) != expected.sha256
        {
            return Err(EngineError::InvalidRequest(format!(
                "project archive entry failed hash validation: {}",
                expected.path
            )));
        }
    }
    let project_bytes = payloads.get("project.json").ok_or_else(|| {
        EngineError::InvalidRequest("project archive data is missing".to_string())
    })?;
    let data: ProjectArchiveData = serde_json::from_slice(project_bytes).map_err(|error| {
        EngineError::InvalidRequest(format!("invalid project archive data: {error}"))
    })?;
    if data.project.id != manifest.project_id
        || data.project.name != manifest.project_name
        || data.project.source_locale != manifest.source_locale
        || data.project.target_locale != manifest.target_locale
    {
        return Err(EngineError::InvalidRequest(
            "project archive identity does not match its manifest".to_string(),
        ));
    }
    Ok(ValidatedProjectArchive {
        manifest,
        data,
        payloads,
    })
}

fn sha256_path(path: &Path) -> Result<String> {
    let mut file = File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn archive_managed_source_path(root: &Path, stored: &str) -> Result<PathBuf> {
    let path = Path::new(stored);
    if path
        .components()
        .any(|component| matches!(component, Component::ParentDir))
    {
        return Err(EngineError::InvalidState(
            "managed archive source path contains traversal".to_string(),
        ));
    }
    let resolved = if path.is_absolute() {
        path.to_path_buf()
    } else {
        root.join(path)
    };
    if !resolved.starts_with(root) {
        return Err(EngineError::InvalidState(
            "managed archive source escaped the workspace".to_string(),
        ));
    }
    Ok(resolved)
}

#[derive(Default)]
struct StagedArchiveSources {
    paths: Vec<PathBuf>,
    retain: bool,
}

impl StagedArchiveSources {
    fn retain(&mut self) {
        self.retain = true;
    }
}

impl Drop for StagedArchiveSources {
    fn drop(&mut self) {
        if !self.retain {
            for path in &self.paths {
                let _ = fs::remove_file(path);
            }
        }
    }
}

fn stage_archive_source(
    store: &Store,
    source_key: &str,
    bytes: &[u8],
    extension: &str,
    managed_sources: &mut BTreeMap<String, String>,
    created_sources: &mut StagedArchiveSources,
) -> Result<String> {
    if let Some(existing) = managed_sources.get(source_key) {
        return Ok(existing.clone());
    }
    let restored_name = format!("archive-{}", translunar_domain::new_id());
    let destination = store.paths().managed_source(&restored_name, extension);
    let mut temporary = tempfile::Builder::new()
        .prefix("archive-source-")
        .suffix(&format!(".{extension}"))
        .tempfile_in(&store.paths().temporary)?;
    temporary.write_all(bytes)?;
    temporary.as_file().sync_all()?;
    temporary
        .persist_noclobber(&destination)
        .map_err(|error| EngineError::Io(error.error))?;
    let relative = destination
        .strip_prefix(&store.paths().root)
        .map_err(|_| {
            EngineError::InvalidState("restored source escaped the workspace".to_string())
        })?
        .to_string_lossy()
        .replace('\\', "/");
    managed_sources.insert(source_key.to_string(), relative.clone());
    created_sources.paths.push(destination);
    Ok(relative)
}

fn storage_editor_field(field: EditorSearchField) -> StorageEditorSearchField {
    match field {
        EditorSearchField::Source => StorageEditorSearchField::Source,
        EditorSearchField::Target => StorageEditorSearchField::Target,
        EditorSearchField::Both => StorageEditorSearchField::Both,
    }
}

fn protocol_editor_field(field: StorageEditorSearchField) -> EditorSearchField {
    match field {
        StorageEditorSearchField::Source => EditorSearchField::Source,
        StorageEditorSearchField::Target => EditorSearchField::Target,
        StorageEditorSearchField::Both => EditorSearchField::Both,
    }
}

fn storage_editor_filter(filter: EditorSegmentFilter) -> StorageEditorFilter {
    match filter {
        EditorSegmentFilter::All => StorageEditorFilter::All,
        EditorSegmentFilter::Untranslated => StorageEditorFilter::Untranslated,
        EditorSegmentFilter::Draft => StorageEditorFilter::Draft,
        EditorSegmentFilter::Confirmed => StorageEditorFilter::Confirmed,
        EditorSegmentFilter::Issues => StorageEditorFilter::Issues,
        EditorSegmentFilter::Tagged => StorageEditorFilter::Tagged,
        EditorSegmentFilter::Commented => StorageEditorFilter::Commented,
    }
}

fn storage_editor_sort(sort: EditorSegmentSort) -> StorageEditorSort {
    match sort {
        EditorSegmentSort::Ordinal => StorageEditorSort::Ordinal,
        EditorSegmentSort::UpdatedAt => StorageEditorSort::UpdatedAt,
        EditorSegmentSort::State => StorageEditorSort::State,
    }
}

fn editor_mutation_result(mutation: StorageEditorMutation) -> EditorMutationResult {
    EditorMutationResult {
        rows: mutation.rows,
        counts: mutation.counts,
        operation_id: mutation.operation_id,
        focus_segment_id: mutation.focus_segment_id,
    }
}

fn structural_split_path(path: &str) -> Option<(&str, &str, u8)> {
    let (base, suffix) = path.rsplit_once("#split:")?;
    let (lineage, part) = suffix.rsplit_once(':')?;
    if base.is_empty() || lineage.is_empty() {
        return None;
    }
    let part = part.parse::<u8>().ok()?;
    matches!(part, 1 | 2).then_some((base, lineage, part))
}

fn collapse_structural_segments(mut segments: Vec<Segment>) -> Result<Vec<Segment>> {
    loop {
        let mut collapsed = Vec::with_capacity(segments.len());
        let mut index = 0;
        let mut changed = false;
        while index < segments.len() {
            let segment = &segments[index];
            let Some((base, lineage, part)) = structural_split_path(&segment.structural_path)
            else {
                collapsed.push(segment.clone());
                index += 1;
                continue;
            };
            if part != 1 {
                return Err(EngineError::InvalidState(format!(
                    "structural split part has no preceding sibling: {}",
                    segment.structural_path
                )));
            }
            let second = segments.get(index + 1).ok_or_else(|| {
                EngineError::InvalidState(format!(
                    "structural split is incomplete: {}",
                    segment.structural_path
                ))
            })?;
            let Some((second_base, second_lineage, second_part)) =
                structural_split_path(&second.structural_path)
            else {
                return Err(EngineError::InvalidState(format!(
                    "structural split is incomplete: {}",
                    segment.structural_path
                )));
            };
            if base != second_base || lineage != second_lineage || second_part != 2 {
                return Err(EngineError::InvalidState(format!(
                    "structural split siblings do not match: {} and {}",
                    segment.structural_path, second.structural_path
                )));
            }
            let mut combined = segment.clone();
            combined.structural_path = base.to_string();
            combined.source_text = format!("{}{}", segment.source_text, second.source_text);
            combined.target_text =
                if segment.target_text.is_empty() && second.target_text.is_empty() {
                    String::new()
                } else {
                    format!(
                        "{}{}",
                        if segment.target_text.is_empty() {
                            &segment.source_text
                        } else {
                            &segment.target_text
                        },
                        if second.target_text.is_empty() {
                            &second.source_text
                        } else {
                            &second.target_text
                        }
                    )
                };
            combined.state = if segment.state == SegmentState::Confirmed
                && second.state == SegmentState::Confirmed
            {
                SegmentState::Confirmed
            } else {
                state_for_target(&combined.target_text)
            };
            combined.revision = segment.revision.max(second.revision);
            combined.updated_at_ms = segment.updated_at_ms.max(second.updated_at_ms);
            collapsed.push(combined);
            index += 2;
            changed = true;
        }
        if !changed {
            return Ok(collapsed);
        }
        segments = collapsed;
    }
}

fn hunspell_dictionary(locale: &str) -> Option<(PathBuf, String)> {
    let normalized = locale.replace('-', "_");
    let language = normalized.split('_').next().unwrap_or(&normalized);
    let mut names = vec![normalized.clone(), locale.to_string(), language.to_string()];
    names.sort();
    names.dedup();
    let mut directories = env::var_os("TRANSLUNAR_HUNSPELL_DIRS")
        .map(|value| env::split_paths(&value).collect::<Vec<_>>())
        .unwrap_or_default();
    directories.extend([
        PathBuf::from("/usr/share/hunspell"),
        PathBuf::from("/usr/share/myspell"),
        PathBuf::from("/usr/share/myspell/dicts"),
        PathBuf::from("/usr/local/share/hunspell"),
        PathBuf::from("/Library/Spelling"),
        PathBuf::from("C:/Program Files/LibreOffice/share/extensions"),
    ]);
    for directory in directories {
        for name in &names {
            let direct = directory.join(format!("{name}.dic"));
            let direct_affix = directory.join(format!("{name}.aff"));
            if direct.is_file() && direct_affix.is_file() {
                return Some((directory.clone(), name.clone()));
            }
            if let Ok(entries) = fs::read_dir(&directory) {
                for entry in entries.flatten().take(256) {
                    let child = entry.path();
                    if child.join(format!("{name}.dic")).is_file()
                        && child.join(format!("{name}.aff")).is_file()
                    {
                        return Some((child, name.clone()));
                    }
                }
            }
        }
    }
    None
}

fn run_hunspell(
    locale: &str,
    text: &str,
    user_words: &BTreeSet<String>,
    limit: usize,
) -> Option<(String, Vec<SpellFinding>)> {
    let (dictionary_directory, dictionary_name) = hunspell_dictionary(locale)?;
    let words = spell_word_spans(text)
        .into_iter()
        .filter(|word| !user_words.contains(&normalize_dictionary_word(&word.text)))
        .take(5_000)
        .collect::<Vec<_>>();
    let input = words
        .iter()
        .map(|word| word.text.as_str())
        .collect::<Vec<_>>()
        .join("\n");
    let binary = env::var_os("TRANSLUNAR_HUNSPELL_BIN")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            PathBuf::from(if cfg!(windows) {
                "hunspell.exe"
            } else {
                "hunspell"
            })
        });
    let stdout = NamedTempFile::new().ok()?;
    let stderr = NamedTempFile::new().ok()?;
    let mut command = Command::new(binary);
    command
        .arg("-a")
        .arg("-d")
        .arg(&dictionary_name)
        .env("DICPATH", env::join_paths([&dictionary_directory]).ok()?)
        .stdin(Stdio::piped())
        .stdout(Stdio::from(stdout.reopen().ok()?))
        .stderr(Stdio::from(stderr.reopen().ok()?));
    let mut child = command.spawn().ok()?;
    if let Some(mut stdin) = child.stdin.take()
        && (stdin.write_all(input.as_bytes()).is_err() || stdin.write_all(b"\n").is_err())
    {
        let _ = child.kill();
        let _ = child.wait();
        return None;
    }
    let deadline = Instant::now() + Duration::from_secs(2);
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if Instant::now() < deadline => thread::sleep(Duration::from_millis(10)),
            Ok(None) => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
            Err(_) => return None,
        }
    };
    if !status.success() || stdout.as_file().metadata().ok()?.len() > 1_048_576 {
        return None;
    }
    let output = fs::read_to_string(stdout.path()).ok()?;
    let findings = parse_hunspell_output(
        &output,
        &words,
        text,
        &format!("hunspell:{dictionary_name}"),
        limit,
    )?;
    Some((format!("hunspell:{dictionary_name}"), findings))
}

fn parse_hunspell_output(
    output: &str,
    words: &[TextMatch],
    text: &str,
    provider: &str,
    limit: usize,
) -> Option<Vec<SpellFinding>> {
    let results = output
        .lines()
        .filter(|line| !line.trim().is_empty() && !line.starts_with('@'))
        .collect::<Vec<_>>();
    if results.len() < words.len() {
        return None;
    }
    let mut findings = Vec::new();
    for (word, result) in words.iter().zip(results) {
        let marker = result.as_bytes().first().copied().unwrap_or_default();
        if matches!(marker, b'*' | b'+' | b'-') {
            continue;
        }
        if !matches!(marker, b'&' | b'#' | b'?') {
            return None;
        }
        let suggestions = result
            .split_once(':')
            .map(|(_, suggestions)| {
                suggestions
                    .split(',')
                    .map(str::trim)
                    .filter(|suggestion| !suggestion.is_empty())
                    .take(8)
                    .map(ToOwned::to_owned)
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        findings.push(SpellFinding {
            word: word.text.clone(),
            start: u32::try_from(text[..word.start].chars().count()).unwrap_or(u32::MAX),
            end: u32::try_from(text[..word.end].chars().count()).unwrap_or(u32::MAX),
            suggestions,
            provider: provider.to_string(),
        });
        if findings.len() >= limit {
            break;
        }
    }
    Some(findings)
}

fn validate_filter_options(options: &std::collections::BTreeMap<String, String>) -> Result<()> {
    if options.len() > 32 {
        return Err(EngineError::InvalidRequest(
            "filter options must contain at most 32 entries".to_string(),
        ));
    }
    for (key, value) in options {
        if key.trim().is_empty() || key.len() > 64 || value.len() > 4096 {
            return Err(EngineError::InvalidRequest(
                "filter option keys must be 1..64 bytes and values at most 4096 bytes".to_string(),
            ));
        }
    }
    Ok(())
}

fn validate_reference_corpus_import_request(
    project: &Project,
    request: &ReferenceCorpusImportRequest,
) -> Result<()> {
    if project.revision != request.expected_project_revision {
        return Err(StorageError::EntityConflict {
            entity: "project",
            id: project.id.clone(),
            expected_revision: request.expected_project_revision,
            actual_revision: project.revision,
        }
        .into());
    }
    if project.lifecycle != ProjectLifecycle::Active {
        return Err(EngineError::InvalidState(
            "reference corpus import requires an active project".to_string(),
        ));
    }
    if request.name.trim().is_empty()
        || request.actor.trim().is_empty()
        || request.reason.trim().is_empty()
    {
        return Err(EngineError::InvalidRequest(
            "reference corpus name, actor, and reason are required".to_string(),
        ));
    }
    if request.source_locale != project.source_locale
        || request.target_locale != project.target_locale
    {
        return Err(EngineError::CorpusInput(
            "reference corpus locales do not match the project".to_string(),
        ));
    }
    if request
        .filter_id
        .as_deref()
        .is_some_and(|filter_id| filter_id.trim().is_empty())
    {
        return Err(EngineError::InvalidRequest(
            "reference corpus filter ID must not be empty".to_string(),
        ));
    }
    Ok(())
}

fn validate_reference_corpus_filter_locales(
    imported: &ImportedDocument,
    kind: ReferenceCorpusKind,
    expected_filter_source_locale: &str,
    target_locale: &str,
) -> Result<()> {
    if imported.metadata.format.trim().is_empty() {
        return Err(EngineError::CorpusInput(
            "reference corpus filter returned an empty format".to_string(),
        ));
    }
    if imported
        .metadata
        .source_locale
        .as_deref()
        .is_some_and(|locale| locale != expected_filter_source_locale)
    {
        return Err(EngineError::CorpusInput(
            "reference corpus input source locale does not match the selected corpus side"
                .to_string(),
        ));
    }
    if kind == ReferenceCorpusKind::Bilingual
        && imported
            .metadata
            .properties
            .get("targetLocale")
            .is_some_and(|locale| locale != target_locale)
    {
        return Err(EngineError::CorpusInput(
            "reference corpus input target locale does not match the project".to_string(),
        ));
    }
    Ok(())
}

fn reference_corpus_entries_from_import(
    imported: &ImportedDocument,
    kind: ReferenceCorpusKind,
    filter_id: &str,
    input_sha256: &str,
    input_file_name: &str,
    options_sha256: &str,
) -> Result<Vec<NewReferenceCorpusEntry>> {
    if imported.units.is_empty() {
        return Err(EngineError::CorpusInput(
            "reference corpus input contains no translatable units".to_string(),
        ));
    }
    imported
        .units
        .iter()
        .map(|unit| {
            let target_authoritative = unit.target_text.is_some();
            let (source_text, target_text, mapped_side) = match kind {
                ReferenceCorpusKind::MonolingualSource => {
                    (unit.source_text.clone(), String::new(), "source")
                }
                ReferenceCorpusKind::MonolingualTarget => {
                    (String::new(), unit.source_text.clone(), "target")
                }
                ReferenceCorpusKind::Bilingual => {
                    let target = unit
                        .target_text
                        .as_ref()
                        .filter(|target| !target.trim().is_empty())
                        .ok_or_else(|| {
                            EngineError::CorpusInput(format!(
                                "bilingual reference corpus unit {} has no authoritative target",
                                unit.ordinal
                            ))
                        })?;
                    (unit.source_text.clone(), target.clone(), "bilingual")
                }
            };
            Ok(NewReferenceCorpusEntry {
                ordinal: unit.ordinal,
                source_text,
                target_text,
                structural_path: unit.structural_path.clone(),
                provenance: json!({
                    "sourceKind": "file",
                    "inputFileName": input_file_name,
                    "inputFilterId": filter_id,
                    "inputFormat": imported.metadata.format.as_str(),
                    "inputSha256": input_sha256,
                    "filterOptionsSha256": options_sha256,
                    "mappedSide": mapped_side,
                    "targetAuthoritative": target_authoritative,
                    "ordinal": unit.ordinal,
                    "structuralPath": unit.structural_path.as_str(),
                    "inlineTagCount": unit.inline_tags.len(),
                    "noteCount": unit.notes.len(),
                }),
            })
        })
        .collect()
}

fn reference_corpus_import_diagnostics(imported: &ImportedDocument) -> Vec<String> {
    imported
        .degradation
        .iter()
        .map(|finding| {
            let severity = match finding.severity {
                translunar_domain::DegradationSeverity::Warning => "warning",
                translunar_domain::DegradationSeverity::Error => "error",
            };
            let code = if finding.code.trim().is_empty() {
                "filter_degradation"
            } else {
                finding.code.as_str()
            };
            format!("{severity}:{code}")
        })
        .collect()
}

fn map_pdf_service_error(error: PdfError) -> EngineError {
    EngineError::Import(FilterError::Processing(error.to_string()))
}

fn normalize_relative_path(value: Option<&str>, source: &Path) -> Result<String> {
    let fallback = source
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.trim().is_empty())
        .ok_or_else(|| EngineError::InvalidRequest("sourcePath must name a file".to_string()))?;
    let candidate = value
        .filter(|path| !path.trim().is_empty())
        .unwrap_or(fallback);
    let candidate = candidate.replace('\\', "/");
    if candidate.starts_with('/')
        || candidate.starts_with("//")
        || candidate.as_bytes().get(1) == Some(&b':')
    {
        return Err(EngineError::InvalidRequest(
            "relativePath must be project-relative".to_string(),
        ));
    }
    let mut parts = Vec::new();
    for part in candidate.split('/') {
        match part.trim() {
            "" | "." => {}
            ".." => {
                return Err(EngineError::InvalidRequest(
                    "relativePath must not contain parent traversal".to_string(),
                ));
            }
            normalized => parts.push(normalized),
        }
    }
    if parts.is_empty() {
        return Err(EngineError::InvalidRequest(
            "relativePath must name a file".to_string(),
        ));
    }
    Ok(parts.join("/"))
}

#[derive(Clone)]
struct ActivePluginProcessRegistry {
    entries: Arc<Mutex<BTreeMap<String, ActivePluginProcessGeneration>>>,
}

struct ActivePluginProcessGeneration {
    version_id: String,
    activation_revision: u64,
    filters: Vec<(String, Arc<dyn translunar_filter_core::DocumentFilter>)>,
    connector_leases: Vec<translunar_ai_core::EngineConnectorLease>,
    process: Arc<translunar_plugin_runtime::PluginProcess>,
}

impl Default for ActivePluginProcessRegistry {
    fn default() -> Self {
        Self {
            entries: Arc::new(Mutex::new(BTreeMap::new())),
        }
    }
}

impl ActivePluginProcessRegistry {
    fn insert(
        &self,
        plugin_id: String,
        version_id: String,
        activation_revision: u64,
        filters: Vec<(String, Arc<dyn translunar_filter_core::DocumentFilter>)>,
        connector_leases: Vec<translunar_ai_core::EngineConnectorLease>,
        process: Arc<translunar_plugin_runtime::PluginProcess>,
    ) -> Option<Arc<translunar_plugin_runtime::PluginProcess>> {
        self.entries
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .insert(
                plugin_id,
                ActivePluginProcessGeneration {
                    version_id,
                    activation_revision,
                    filters,
                    connector_leases,
                    process,
                },
            )
            .map(|entry| entry.process)
    }

    fn remove(&self, plugin_id: &str) -> Option<Arc<translunar_plugin_runtime::PluginProcess>> {
        self.entries
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .remove(plugin_id)
            .map(|entry| entry.process)
    }

    fn remove_generation(
        &self,
        plugin_id: &str,
        version_id: &str,
        activation_revision: u64,
    ) -> Option<ActivePluginProcessGeneration> {
        let mut entries = self
            .entries
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let matches = entries.get(plugin_id).is_some_and(|entry| {
            entry.version_id == version_id && entry.activation_revision == activation_revision
        });
        if matches {
            entries.remove(plugin_id)
        } else {
            None
        }
    }

    fn drain(&self) -> Vec<Arc<translunar_plugin_runtime::PluginProcess>> {
        std::mem::take(
            &mut *self
                .entries
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner),
        )
        .into_values()
        .map(|entry| entry.process)
        .collect()
    }

    #[cfg(test)]
    fn get(&self, plugin_id: &str) -> Option<Arc<translunar_plugin_runtime::PluginProcess>> {
        self.entries
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .get(plugin_id)
            .map(|entry| Arc::clone(&entry.process))
    }

    #[cfg(test)]
    fn contains_key(&self, plugin_id: &str) -> bool {
        self.entries
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .contains_key(plugin_id)
    }

    #[cfg(test)]
    fn is_empty(&self) -> bool {
        self.entries
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .is_empty()
    }
}

#[derive(Clone)]
struct PipelineManager {
    data_dir: PathBuf,
    registry: StepRegistry,
    active: Arc<Mutex<std::collections::HashMap<String, ActivePipelineExecution>>>,
    checkpoint_router: PluginPipelineCheckpointRouter,
    shutting_down: Arc<AtomicBool>,
    filters: FilterRegistry,
    plugin_qa_registry: qa::PluginQaRegistry,
    plugin_processes: ActivePluginProcessRegistry,
    ai: ai::AiManager,
}

#[derive(Clone)]
struct ActivePipelineExecution {
    cancellation: Arc<AtomicBool>,
    stale_activation: Arc<AtomicBool>,
    checkpoint_gate: Arc<Mutex<()>>,
    owners: BTreeSet<PipelineStepOwner>,
}

#[derive(Debug, Clone, Default)]
pub(crate) struct PluginPipelineCheckpointRouter {
    routes: Arc<Mutex<std::collections::HashMap<String, PluginPipelineCheckpointRoute>>>,
}

#[derive(Debug, Clone)]
struct PluginPipelineCheckpointRoute {
    contribution_id: String,
    sink: StepCheckpointSink,
}

pub(crate) struct PluginPipelineCheckpointRouteGuard {
    invocation_id: String,
    router: PluginPipelineCheckpointRouter,
}

impl Drop for PluginPipelineCheckpointRouteGuard {
    fn drop(&mut self) {
        if let Ok(mut routes) = self.router.routes.lock() {
            routes.remove(&self.invocation_id);
        }
    }
}

impl PluginPipelineCheckpointRouter {
    pub(crate) fn register(
        &self,
        invocation_id: &str,
        contribution_id: &str,
        sink: StepCheckpointSink,
    ) -> std::result::Result<PluginPipelineCheckpointRouteGuard, PipelineError> {
        let mut routes = self.routes.lock().map_err(|_| {
            PipelineError::Execution("pipeline checkpoint router is unavailable".to_string())
        })?;
        if routes.contains_key(invocation_id) {
            return Err(PipelineError::Boundary(
                "pipeline checkpoint invocation is already active".to_string(),
            ));
        }
        routes.insert(
            invocation_id.to_string(),
            PluginPipelineCheckpointRoute {
                contribution_id: contribution_id.to_string(),
                sink,
            },
        );
        Ok(PluginPipelineCheckpointRouteGuard {
            invocation_id: invocation_id.to_string(),
            router: self.clone(),
        })
    }

    pub(crate) fn publish(
        &self,
        invocation_id: &str,
        contribution_id: &str,
        checkpoint: Value,
    ) -> std::result::Result<(), PipelineError> {
        let route = self
            .routes
            .lock()
            .map_err(|_| {
                PipelineError::Execution("pipeline checkpoint router is unavailable".to_string())
            })?
            .get(invocation_id)
            .cloned()
            .ok_or(PipelineError::StaleActivation)?;
        if route.contribution_id != contribution_id {
            return Err(PipelineError::Boundary(
                "pipeline checkpoint contribution does not match the active invocation".to_string(),
            ));
        }
        route.sink.publish(checkpoint)
    }
}

struct ResolvedPipelineRun {
    steps: Vec<Option<ResolvedPipelineStep>>,
    plugin_bindings: Vec<Option<PipelineStepPluginBinding>>,
}

struct ResolvedPipelineResume {
    steps: Vec<Option<ResolvedPipelineStep>>,
    migration: Option<ResolvedCheckpointMigration>,
}

struct ResolvedCheckpointMigration {
    step_index: u32,
    outcome: StepCheckpointMigrationOutcome,
    attempt: PipelineStepPluginAttempt,
}

struct CheckpointStep;

impl PipelineStep for CheckpointStep {
    fn descriptor(&self) -> StepDescriptor {
        StepDescriptor {
            id: "core.checkpoint".to_string(),
            version: "1".to_string(),
            display_name: "Checkpoint".to_string(),
            input: ArtifactKind::None,
            output: ArtifactKind::Json,
            config_schema_version: 1,
            resumable: true,
            cancellable: true,
        }
    }

    fn execute(
        &self,
        context: StepExecutionContext,
    ) -> std::result::Result<StepOutcome, PipelineError> {
        let delay_ms = context
            .config
            .get("delayMs")
            .and_then(Value::as_u64)
            .unwrap_or(0)
            .min(60_000);
        let mut elapsed = 0;
        while elapsed < delay_ms {
            if context.cancellation.load(Ordering::Relaxed) {
                return Err(PipelineError::Canceled);
            }
            let tick = (delay_ms - elapsed).min(10);
            thread::sleep(Duration::from_millis(tick));
            elapsed += tick;
        }
        if context.cancellation.load(Ordering::Relaxed) {
            return Err(PipelineError::Canceled);
        }
        Ok(StepOutcome {
            output: context.input,
            checkpoint: Some(json!({ "completed": true })),
            usage: None,
        })
    }
}

struct QaDocumentStep {
    data_dir: PathBuf,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AiPretranslateConfig {
    profile_id: String,
    #[serde(default = "default_ai_tm_threshold")]
    tm_threshold: u8,
    #[serde(default = "default_ai_concurrency")]
    concurrency: u8,
    #[serde(default = "default_ai_requests_per_minute")]
    requests_per_minute: u16,
    #[serde(default = "default_ai_max_attempts")]
    max_attempts: u8,
    #[serde(default)]
    replace_drafts: bool,
    #[serde(default)]
    grounding: translunar_ai_core::GroundingOptions,
}

struct AiPretranslateStep {
    data_dir: PathBuf,
    ai: ai::AiManager,
}

impl PipelineStep for AiPretranslateStep {
    fn descriptor(&self) -> StepDescriptor {
        StepDescriptor {
            id: "core.ai.pretranslate".to_string(),
            version: "1".to_string(),
            display_name: "AI pretranslation".to_string(),
            input: ArtifactKind::None,
            output: ArtifactKind::Segments,
            config_schema_version: 1,
            resumable: true,
            cancellable: true,
        }
    }

    fn execute(
        &self,
        context: StepExecutionContext,
    ) -> std::result::Result<StepOutcome, PipelineError> {
        if context.cancellation.load(Ordering::Relaxed) {
            return Err(PipelineError::Canceled);
        }
        let config: AiPretranslateConfig = serde_json::from_value(context.config)
            .map_err(|_| PipelineError::Execution("AI batch config is invalid".to_string()))?;
        let mut store = Store::open_worker(&self.data_dir)
            .map_err(|_| PipelineError::Execution("AI batch storage is unavailable".to_string()))?;
        let batch = ai::create_and_spawn_ai_batch(
            &mut store,
            &self.ai,
            translunar_protocol::AiBatchStartParams {
                project_id: context.project_id,
                document_id: context.document_id,
                profile_id: config.profile_id,
                tm_threshold: config.tm_threshold,
                concurrency: config.concurrency,
                requests_per_minute: config.requests_per_minute,
                max_attempts: config.max_attempts,
                replace_drafts: config.replace_drafts,
                options: config.grounding,
            },
        )
        .map_err(|_| PipelineError::Execution("AI batch could not start".to_string()))?;
        loop {
            let current = store.get_ai_batch(&batch.id).map_err(|_| {
                PipelineError::Execution("AI batch state is unavailable".to_string())
            })?;
            if context.cancellation.load(Ordering::Relaxed) {
                let _ = store.request_ai_batch_cancel(&current.id, current.revision);
                self.ai.cancel_batch(&current.id);
                return Err(PipelineError::Canceled);
            }
            if current.status.is_terminal() {
                if current.status == translunar_ai_core::AiBatchStatus::Failed {
                    return Err(PipelineError::Execution("AI batch failed".to_string()));
                }
                return Ok(StepOutcome {
                    output: serde_json::to_value(&current).map_err(|_| {
                        PipelineError::Execution("AI batch output is invalid".to_string())
                    })?,
                    checkpoint: Some(json!({ "batchId": current.id })),
                    usage: serde_json::to_value(&current.usage).ok(),
                });
            }
            thread::sleep(Duration::from_millis(100));
        }
    }
}

const fn default_ai_tm_threshold() -> u8 {
    85
}

const fn default_ai_concurrency() -> u8 {
    3
}

const fn default_ai_requests_per_minute() -> u16 {
    60
}

const fn default_ai_max_attempts() -> u8 {
    3
}

impl PipelineStep for QaDocumentStep {
    fn descriptor(&self) -> StepDescriptor {
        StepDescriptor {
            id: "core.qa.document".to_string(),
            version: "1".to_string(),
            display_name: "Document QA".to_string(),
            input: ArtifactKind::None,
            output: ArtifactKind::QaFindings,
            config_schema_version: 1,
            resumable: true,
            cancellable: true,
        }
    }

    fn execute(
        &self,
        context: StepExecutionContext,
    ) -> std::result::Result<StepOutcome, PipelineError> {
        if context.cancellation.load(Ordering::Relaxed) {
            return Err(PipelineError::Canceled);
        }
        let document_id = context
            .document_id
            .clone()
            .or_else(|| {
                context
                    .input
                    .get("documentId")
                    .and_then(Value::as_str)
                    .map(ToOwned::to_owned)
            })
            .ok_or_else(|| PipelineError::Execution("documentId is required".to_string()))?;
        let mut store = Store::open_worker(&self.data_dir)
            .map_err(|error| PipelineError::Execution(error.to_string()))?;
        let issues = store
            .run_document_qa(&document_id)
            .map_err(|error| PipelineError::Execution(error.to_string()))?;
        Ok(StepOutcome {
            output: serde_json::to_value(issues)
                .map_err(|error| PipelineError::Execution(error.to_string()))?,
            checkpoint: Some(json!({ "documentId": document_id })),
            usage: None,
        })
    }
}

impl PipelineManager {
    fn new(
        data_dir: PathBuf,
        ai: ai::AiManager,
        filters: FilterRegistry,
        plugin_qa_registry: qa::PluginQaRegistry,
        plugin_processes: ActivePluginProcessRegistry,
    ) -> Result<Self> {
        let mut registry = StepRegistry::default();
        registry
            .register(Arc::new(CheckpointStep))
            .map_err(|error| EngineError::InvalidState(error.to_string()))?;
        registry
            .register(Arc::new(QaDocumentStep {
                data_dir: data_dir.clone(),
            }))
            .map_err(|error| EngineError::InvalidState(error.to_string()))?;
        registry
            .register(Arc::new(AiPretranslateStep {
                data_dir: data_dir.clone(),
                ai: ai.clone(),
            }))
            .map_err(|error| EngineError::InvalidState(error.to_string()))?;
        Ok(Self {
            data_dir,
            registry,
            active: Arc::new(Mutex::new(std::collections::HashMap::new())),
            checkpoint_router: PluginPipelineCheckpointRouter::default(),
            shutting_down: Arc::new(AtomicBool::new(false)),
            filters,
            plugin_qa_registry,
            plugin_processes,
            ai,
        })
    }

    pub(crate) fn checkpoint_router(&self) -> PluginPipelineCheckpointRouter {
        self.checkpoint_router.clone()
    }

    fn descriptors(&self) -> Vec<StepDescriptor> {
        self.registry.descriptors()
    }

    fn validate(
        &self,
        name: String,
        steps: Vec<PipelineStepDefinition>,
    ) -> PipelineValidationResult {
        let definition = translunar_pipeline::PipelineDefinition {
            id: "validation".to_string(),
            project_id: None,
            name,
            version: 1,
            revision: 0,
            steps,
            created_at_ms: 0,
            updated_at_ms: 0,
        };
        match self.registry.validate_definition(&definition) {
            Ok(()) => PipelineValidationResult {
                valid: true,
                errors: Vec::new(),
            },
            Err(error) => PipelineValidationResult {
                valid: false,
                errors: vec![error.to_string()],
            },
        }
    }

    fn resolve_new_run(&self, definition: &PipelineDefinition) -> Result<ResolvedPipelineRun> {
        let resolved = definition
            .steps
            .iter()
            .map(|step| self.registry.resolve_binding(&step.step_id))
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(|error| EngineError::InvalidState(error.to_string()))?;
        let created_at_ms = pipeline_now_ms()?;
        let bindings = definition
            .steps
            .iter()
            .zip(&resolved)
            .map(
                |(definition_step, resolved)| match &resolved.binding().owner {
                    PipelineStepOwner::Builtin => Ok(None),
                    owner @ PipelineStepOwner::Plugin { .. } => {
                        Ok(Some(PipelineStepPluginBinding {
                            owner: owner.clone(),
                            config_hash: pipeline_json_hash(&definition_step.config)?,
                            created_at_ms,
                        }))
                    }
                },
            )
            .collect::<Result<Vec<_>>>()?;
        Ok(ResolvedPipelineRun {
            steps: resolved.into_iter().map(Some).collect(),
            plugin_bindings: bindings,
        })
    }

    fn resolve_resume(
        &self,
        definition: &PipelineDefinition,
        snapshot: &translunar_storage::PipelineRunSnapshot,
    ) -> std::result::Result<ResolvedPipelineResume, PipelineFailure> {
        if definition.steps.len() != snapshot.steps.len() {
            return Err(plugin_checkpoint_incompatible(
                "the pipeline definition no longer matches the recorded run",
            ));
        }
        let current_index = snapshot.run.current_step_index as usize;
        let mut steps = Vec::with_capacity(definition.steps.len());
        let mut migration = None;
        for (index, (definition_step, step_run)) in
            definition.steps.iter().zip(&snapshot.steps).enumerate()
        {
            if index < current_index {
                steps.push(None);
                continue;
            }
            let resolved = self
                .registry
                .resolve_binding(&definition_step.step_id)
                .map_err(|_| {
                    plugin_checkpoint_incompatible(
                        "the recorded pipeline step implementation is unavailable",
                    )
                })?;
            match (&resolved.binding().owner, &step_run.plugin_binding) {
                (PipelineStepOwner::Builtin, None) => {}
                (
                    current_owner @ PipelineStepOwner::Plugin {
                        plugin_id: current_plugin_id,
                        contribution_id: current_contribution_id,
                        checkpoint_schema_version: current_schema_version,
                        ..
                    },
                    Some(binding),
                ) => {
                    let PipelineStepOwner::Plugin {
                        plugin_id: recorded_plugin_id,
                        contribution_id: recorded_contribution_id,
                        ..
                    } = &binding.owner
                    else {
                        unreachable!("plugin binding must contain a plugin owner")
                    };
                    let config_hash =
                        pipeline_json_hash(&definition_step.config).map_err(|_| {
                            plugin_checkpoint_incompatible(
                                "the recorded pipeline step configuration is invalid",
                            )
                        })?;
                    if current_plugin_id != recorded_plugin_id
                        || current_contribution_id != recorded_contribution_id
                        || binding.config_hash != config_hash
                    {
                        return Err(plugin_checkpoint_incompatible(
                            "the active plugin step is incompatible with the recorded run",
                        ));
                    }
                    if index == current_index
                        && let Some(checkpoint) = step_run.checkpoint.as_ref()
                    {
                        let source_schema_version = step_run
                            .latest_checkpoint
                            .as_ref()
                            .map(|checkpoint| checkpoint.schema_version)
                            .ok_or_else(|| {
                                plugin_checkpoint_incompatible(
                                    "the recorded checkpoint has no schema provenance",
                                )
                            })?;
                        let target_schema_version = current_schema_version.ok_or_else(|| {
                            plugin_checkpoint_incompatible(
                                "the active plugin step has no checkpoint schema",
                            )
                        })?;
                        if source_schema_version != target_schema_version {
                            let started_at_ms = pipeline_now_ms().map_err(|_| {
                                plugin_checkpoint_incompatible(
                                    "checkpoint migration time is unavailable",
                                )
                            })?;
                            let cancellation = Arc::new(AtomicBool::new(false));
                            let outcome = resolved
                                .step()
                                .migrate_checkpoint(StepCheckpointMigrationContext {
                                    run_id: snapshot.run.id.clone(),
                                    project_id: snapshot.run.project_id.clone(),
                                    document_id: snapshot.run.document_id.clone(),
                                    config: definition_step.config.clone(),
                                    checkpoint: checkpoint.clone(),
                                    source_schema_version,
                                    target_schema_version,
                                    deadline_ms: 120_000,
                                    cancellation,
                                })
                                .map_err(|_| {
                                    plugin_checkpoint_incompatible(
                                        "the plugin could not migrate the recorded checkpoint",
                                    )
                                })?;
                            if !self.registry.is_current(resolved.binding())
                                || resolved.binding().owner != *current_owner
                            {
                                return Err(plugin_checkpoint_incompatible(
                                    "the plugin activation changed during checkpoint migration",
                                ));
                            }
                            let input = step_run.input.as_ref().ok_or_else(|| {
                                plugin_checkpoint_incompatible(
                                    "the interrupted plugin step has no input provenance",
                                )
                            })?;
                            let attempt_index = step_run.latest_plugin_attempt.as_ref().map_or(
                                Ok(0),
                                |attempt| {
                                    attempt.attempt_index.checked_add(1).ok_or_else(|| {
                                        plugin_checkpoint_incompatible(
                                            "checkpoint migration attempt index overflow",
                                        )
                                    })
                                },
                            )?;
                            let completed_at_ms = pipeline_now_ms().map_err(|_| {
                                plugin_checkpoint_incompatible(
                                    "checkpoint migration time is unavailable",
                                )
                            })?;
                            migration = Some(ResolvedCheckpointMigration {
                                step_index: index as u32,
                                attempt: PipelineStepPluginAttempt {
                                    id: new_id(),
                                    attempt_index,
                                    operation: PipelineStepPluginOperation::CheckpointMigrate,
                                    input_hash: pipeline_json_hash(input).map_err(|_| {
                                        plugin_checkpoint_incompatible(
                                            "pipeline input hashing failed",
                                        )
                                    })?,
                                    output_hash: None,
                                    checkpoint_input_hash: Some(
                                        pipeline_json_hash(checkpoint).map_err(|_| {
                                            plugin_checkpoint_incompatible(
                                                "source checkpoint hashing failed",
                                            )
                                        })?,
                                    ),
                                    checkpoint_output_hash: Some(
                                        pipeline_json_hash(&outcome.checkpoint).map_err(|_| {
                                            plugin_checkpoint_incompatible(
                                                "migrated checkpoint hashing failed",
                                            )
                                        })?,
                                    ),
                                    checkpoint_schema_version: Some(target_schema_version),
                                    usage: outcome.usage.clone().unwrap_or_else(|| json!({})),
                                    failure: None,
                                    started_at_ms,
                                    completed_at_ms,
                                },
                                outcome,
                            });
                        }
                    }
                }
                _ => {
                    return Err(plugin_checkpoint_incompatible(
                        "the active plugin step does not match the immutable run binding",
                    ));
                }
            }
            steps.push(Some(resolved));
        }
        Ok(ResolvedPipelineResume { steps, migration })
    }

    fn spawn_resolved(
        &self,
        run_id: String,
        steps: Vec<Option<ResolvedPipelineStep>>,
    ) -> Result<()> {
        let owners = steps
            .iter()
            .flatten()
            .map(|step| step.binding().owner.clone())
            .collect();
        let token = Arc::new(AtomicBool::new(false));
        let stale_activation = Arc::new(AtomicBool::new(false));
        let checkpoint_gate = Arc::new(Mutex::new(()));
        if let Ok(mut active) = self.active.lock() {
            if active.contains_key(&run_id) {
                return Ok(());
            }
            active.insert(
                run_id.clone(),
                ActivePipelineExecution {
                    cancellation: Arc::clone(&token),
                    stale_activation: Arc::clone(&stale_activation),
                    checkpoint_gate: Arc::clone(&checkpoint_gate),
                    owners,
                },
            );
        } else {
            return Err(EngineError::InvalidState(
                "pipeline active-run registry is unavailable".to_string(),
            ));
        }
        let manager = self.clone();
        thread::spawn(move || {
            manager.execute(
                run_id.clone(),
                token,
                stale_activation,
                checkpoint_gate,
                steps,
            );
            if let Ok(mut active) = manager.active.lock() {
                active.remove(&run_id);
            }
        });
        Ok(())
    }

    fn cancel(&self, run_id: &str) {
        if let Ok(active) = self.active.lock()
            && let Some(execution) = active.get(run_id)
        {
            let _gate = execution.checkpoint_gate.lock().ok();
            execution.cancellation.store(true, Ordering::Release);
        }
    }

    fn cancel_owner(&self, owner: &PipelineStepOwner) {
        if let Ok(active) = self.active.lock() {
            for execution in active.values() {
                if execution.owners.contains(owner) {
                    let _gate = execution.checkpoint_gate.lock().ok();
                    execution.stale_activation.store(true, Ordering::Release);
                    execution.cancellation.store(true, Ordering::Release);
                }
            }
        }
    }

    pub(crate) fn begin_shutdown(&self) {
        self.shutting_down.store(true, Ordering::Release);
        if let Ok(active) = self.active.lock() {
            for execution in active.values() {
                let _gate = execution.checkpoint_gate.lock().ok();
                execution.cancellation.store(true, Ordering::Release);
            }
        }
    }

    fn execute(
        &self,
        run_id: String,
        token: Arc<AtomicBool>,
        stale_activation: Arc<AtomicBool>,
        checkpoint_gate: Arc<Mutex<()>>,
        steps: Vec<Option<ResolvedPipelineStep>>,
    ) {
        let mut store = match Store::open_worker(&self.data_dir) {
            Ok(store) => store,
            Err(_) => return,
        };
        let initial = match store.get_pipeline_run(&run_id) {
            Ok(snapshot) => snapshot,
            Err(_) => return,
        };
        if initial.run.status == translunar_pipeline::PipelineRunStatus::Canceling {
            let _ = store.finalize_pipeline_canceled(&run_id);
            return;
        }
        let mut snapshot = match store.start_pipeline_run(&run_id) {
            Ok(snapshot) => snapshot,
            Err(_) => {
                let _ = Self::finalize_if_canceling(&mut store, &run_id);
                return;
            }
        };
        let definition = match store.get_pipeline_definition(&snapshot.run.definition_id) {
            Ok(definition) => definition,
            Err(error) => {
                let _ = store.fail_pipeline_run(
                    &run_id,
                    PipelineFailure {
                        code: "definition_not_found".to_string(),
                        message: error.to_string(),
                        retryable: false,
                    },
                );
                return;
            }
        };
        while snapshot.run.current_step_index < snapshot.run.step_count {
            if self.shutting_down.load(Ordering::Acquire) {
                return;
            }
            if token.load(Ordering::Relaxed)
                || store.pipeline_cancel_requested(&run_id).unwrap_or(false)
            {
                let _ = Self::finalize_if_canceling(&mut store, &run_id);
                return;
            }
            let index = snapshot.run.current_step_index;
            let Some(definition_step) = definition.steps.get(index as usize) else {
                let _ = store.fail_pipeline_run(
                    &run_id,
                    PipelineFailure {
                        code: "step_index_invalid".to_string(),
                        message: format!("missing pipeline step {index}"),
                        retryable: false,
                    },
                );
                return;
            };
            let step = match steps.get(index as usize).and_then(Option::as_ref) {
                Some(step) if step.descriptor().id == definition_step.step_id => step,
                _ => {
                    if Self::finalize_if_canceling(&mut store, &run_id) {
                        return;
                    }
                    let _ = store.fail_pipeline_run(
                        &run_id,
                        PipelineFailure {
                            code: "step_not_found".to_string(),
                            message: "the pinned pipeline step is unavailable".to_string(),
                            retryable: false,
                        },
                    );
                    return;
                }
            };
            if stale_activation.load(Ordering::Acquire) || !self.registry.is_current(step.binding())
            {
                Self::fail_stale_activation(&mut store, &run_id);
                return;
            }
            let input = if index == 0 {
                snapshot.run.input.clone()
            } else {
                snapshot
                    .steps
                    .get(index as usize - 1)
                    .and_then(|item| item.output.clone())
                    .unwrap_or(Value::Null)
            };
            let step_run = match store.start_pipeline_step(&run_id, index, input.clone()) {
                Ok(step_run) => step_run,
                Err(error) => {
                    // A cancellation can win the revision race between the
                    // loop guard and step start. Preserve the canceling
                    // transition instead of converting that expected race
                    // into a failed run.
                    if Self::finalize_if_canceling(&mut store, &run_id) {
                        return;
                    }
                    let _ = store.fail_pipeline_run(
                        &run_id,
                        PipelineFailure {
                            code: "step_start_failed".to_string(),
                            message: error.to_string(),
                            retryable: true,
                        },
                    );
                    return;
                }
            };
            let attempt_started_at_ms = match pipeline_now_ms() {
                Ok(value) => value,
                Err(error) => {
                    self.fail_step_error(
                        &mut store,
                        &step_run,
                        step.binding(),
                        &input,
                        PipelineError::Execution(error.to_string()),
                        step_run.updated_at_ms,
                    );
                    return;
                }
            };
            if let Err(error) = step.step().validate_config(&definition_step.config) {
                self.fail_step_error(
                    &mut store,
                    &step_run,
                    step.binding(),
                    &input,
                    error,
                    attempt_started_at_ms,
                );
                return;
            }
            if let Err(error) = step.step().validate_input(&input) {
                self.fail_step_error(
                    &mut store,
                    &step_run,
                    step.binding(),
                    &input,
                    error,
                    attempt_started_at_ms,
                );
                return;
            }
            let context = StepExecutionContext {
                run_id: run_id.clone(),
                project_id: snapshot.run.project_id.clone(),
                document_id: snapshot.run.document_id.clone(),
                input: input.clone(),
                config: definition_step.config.clone(),
                checkpoint: step_run.checkpoint.clone(),
                deadline_ms: 120_000,
                cancellation: Arc::clone(&token),
            };
            let checkpoint_sink = match &step.binding().owner {
                PipelineStepOwner::Builtin => None,
                PipelineStepOwner::Plugin {
                    checkpoint_schema_version: Some(schema_version),
                    ..
                } => {
                    let data_dir = self.data_dir.clone();
                    let registry = self.registry.clone();
                    let binding = step.binding().clone();
                    let run_id = run_id.clone();
                    let token = Arc::clone(&token);
                    let stale_activation = Arc::clone(&stale_activation);
                    let shutting_down = Arc::clone(&self.shutting_down);
                    let checkpoint_gate = Arc::clone(&checkpoint_gate);
                    let step_index = index;
                    let schema_version = *schema_version;
                    Some(StepCheckpointSink::new(move |checkpoint| {
                        let _gate = checkpoint_gate.lock().map_err(|_| {
                            PipelineError::Execution(
                                "pipeline checkpoint gate is unavailable".to_string(),
                            )
                        })?;
                        if shutting_down.load(Ordering::Acquire) || token.load(Ordering::Acquire) {
                            return Err(PipelineError::Canceled);
                        }
                        if stale_activation.load(Ordering::Acquire)
                            || !registry.is_current(&binding)
                        {
                            return Err(PipelineError::StaleActivation);
                        }
                        let mut checkpoint_store = Store::open_worker(&data_dir)
                            .map_err(|error| PipelineError::Execution(error.to_string()))?;
                        checkpoint_store
                            .append_pipeline_step_checkpoint(
                                &run_id,
                                step_index,
                                schema_version,
                                checkpoint,
                            )
                            .map(|_| ())
                            .map_err(|error| {
                                if token.load(Ordering::Acquire) {
                                    PipelineError::Canceled
                                } else {
                                    PipelineError::Execution(error.to_string())
                                }
                            })
                    }))
                }
                PipelineStepOwner::Plugin {
                    checkpoint_schema_version: None,
                    ..
                } => None,
            };
            match step
                .step()
                .execute_with_checkpoint_sink(context, checkpoint_sink)
            {
                Ok(outcome) => {
                    if self.shutting_down.load(Ordering::Acquire) {
                        return;
                    }
                    if stale_activation.load(Ordering::Acquire)
                        || !self.registry.is_current(step.binding())
                    {
                        Self::fail_stale_activation(&mut store, &run_id);
                        return;
                    }
                    if token.load(Ordering::Relaxed)
                        || store.pipeline_cancel_requested(&run_id).unwrap_or(false)
                    {
                        let _ = Self::finalize_if_canceling(&mut store, &run_id);
                        return;
                    }
                    if let Err(error) = step.step().validate_output(&outcome.output) {
                        self.fail_step_error(
                            &mut store,
                            &step_run,
                            step.binding(),
                            &input,
                            error,
                            attempt_started_at_ms,
                        );
                        return;
                    }
                    let completion = if step_run.plugin_binding.is_some() {
                        match Self::plugin_attempt(
                            &step_run,
                            step.binding(),
                            &input,
                            Some(&outcome.output),
                            outcome.checkpoint.as_ref(),
                            outcome.usage.as_ref(),
                            None,
                            attempt_started_at_ms,
                        ) {
                            Ok(attempt) => store.complete_plugin_pipeline_step(
                                &run_id,
                                index,
                                outcome.output,
                                outcome.checkpoint,
                                outcome.usage,
                                &attempt,
                            ),
                            Err(error) => {
                                self.fail_step_error(
                                    &mut store,
                                    &step_run,
                                    step.binding(),
                                    &input,
                                    error,
                                    attempt_started_at_ms,
                                );
                                return;
                            }
                        }
                    } else {
                        store.complete_pipeline_step(
                            &run_id,
                            index,
                            outcome.output,
                            outcome.checkpoint,
                            outcome.usage,
                        )
                    };
                    match completion {
                        Ok(updated) => snapshot = updated,
                        Err(error) => {
                            if Self::finalize_if_canceling(&mut store, &run_id) {
                                return;
                            }
                            let _ = store.fail_pipeline_run(
                                &run_id,
                                PipelineFailure {
                                    code: "step_commit_failed".to_string(),
                                    message: error.to_string(),
                                    retryable: true,
                                },
                            );
                            return;
                        }
                    }
                }
                Err(PipelineError::Canceled) => {
                    if self.shutting_down.load(Ordering::Acquire) {
                        return;
                    }
                    if stale_activation.load(Ordering::Acquire) {
                        Self::fail_stale_activation(&mut store, &run_id);
                        return;
                    }
                    let _ = Self::finalize_if_canceling(&mut store, &run_id);
                    return;
                }
                Err(error) => {
                    if self.shutting_down.load(Ordering::Acquire) {
                        return;
                    }
                    if stale_activation.load(Ordering::Acquire)
                        || !self.registry.is_current(step.binding())
                    {
                        Self::fail_stale_activation(&mut store, &run_id);
                        return;
                    }
                    if Self::finalize_if_canceling(&mut store, &run_id) {
                        return;
                    }
                    self.fail_step_error(
                        &mut store,
                        &step_run,
                        step.binding(),
                        &input,
                        error,
                        attempt_started_at_ms,
                    );
                    return;
                }
            }
        }
    }

    fn finalize_if_canceling(store: &mut Store, run_id: &str) -> bool {
        let is_canceling = store
            .get_pipeline_run(run_id)
            .map(|snapshot| {
                snapshot.run.status == translunar_pipeline::PipelineRunStatus::Canceling
            })
            .unwrap_or(false);
        if is_canceling {
            let _ = store.finalize_pipeline_canceled(run_id);
        }
        is_canceling
    }

    fn fail_stale_activation(store: &mut Store, run_id: &str) {
        let _ = store.fail_pipeline_run(
            run_id,
            PipelineFailure {
                code: "plugin_stale_activation".to_string(),
                message: "the plugin pipeline activation changed during execution".to_string(),
                retryable: false,
            },
        );
    }

    fn fail_step_error(
        &self,
        store: &mut Store,
        step_run: &PipelineStepRun,
        execution_binding: &translunar_pipeline::PipelineStepBinding,
        input: &Value,
        error: PipelineError,
        started_at_ms: i64,
    ) {
        let run_id = &step_run.run_id;
        let failure = Self::pipeline_failure(error);
        self.degrade_failed_plugin_generation(store, step_run, &failure);
        if step_run.plugin_binding.is_some()
            && let Ok(attempt) = Self::plugin_attempt(
                step_run,
                execution_binding,
                input,
                None,
                None,
                None,
                Some(&failure),
                started_at_ms,
            )
        {
            match store.fail_plugin_pipeline_run(run_id, failure.clone(), &attempt) {
                Ok(_) => return,
                Err(error) => {
                    tracing::error!(run_id, error = %error, "failed to persist plugin pipeline failure provenance");
                    let _ = store.fail_pipeline_run(
                        run_id,
                        PipelineFailure {
                            code: failure.code,
                            message: "plugin pipeline step failed".to_string(),
                            retryable: failure.retryable,
                        },
                    );
                    return;
                }
            }
        }
        let _ = store.fail_pipeline_run(run_id, failure);
    }

    fn degrade_failed_plugin_generation(
        &self,
        store: &mut Store,
        step_run: &PipelineStepRun,
        failure: &PipelineFailure,
    ) {
        if !matches!(
            failure.code.as_str(),
            "plugin_timeout" | "plugin_resource_limit" | "plugin_host_crash" | "plugin_protocol"
        ) {
            return;
        }
        let Some(binding) = step_run.plugin_binding.as_ref() else {
            return;
        };
        let PipelineStepOwner::Plugin {
            plugin_id,
            version_id,
            activation_revision,
            contribution_id,
            ..
        } = &binding.owner
        else {
            return;
        };
        let diagnostic = format!(
            "pipeline execution for {contribution_id} failed ({})",
            failure.code
        );
        let detach_generation = match store.record_plugin_crash_for_version(
            plugin_id,
            Some(version_id),
            *activation_revision,
            diagnostic,
        ) {
            Ok(Some(_)) => true,
            Ok(None) => {
                tracing::warn!(
                    plugin_id,
                    activation_revision,
                    "ignored stale pipeline plugin failure after lifecycle state changed"
                );
                false
            }
            Err(error) => {
                tracing::error!(
                    plugin_id,
                    activation_revision,
                    error = %error,
                    "failed to persist pipeline plugin crash state"
                );
                true
            }
        };
        if !detach_generation {
            return;
        }

        let Some(generation) =
            self.plugin_processes
                .remove_generation(plugin_id, version_id, *activation_revision)
        else {
            for owner in self
                .registry
                .unregister_plugin_generation(plugin_id, *activation_revision)
            {
                self.cancel_owner(&owner);
            }
            return;
        };

        for owner in self
            .registry
            .unregister_plugin_generation(plugin_id, *activation_revision)
        {
            self.cancel_owner(&owner);
        }
        self.plugin_qa_registry
            .detach_generation(plugin_id, *activation_revision);
        for (filter_id, filter) in generation.filters {
            let _ = self.filters.unregister_if_same(&filter_id, &filter);
        }
        for lease in generation.connector_leases {
            if let Ok(Some(lease)) = self.ai.connectors.detach_lease(&lease) {
                let _ = lease.shutdown();
            }
        }
        generation.process.stop();
    }

    fn pipeline_failure(error: PipelineError) -> PipelineFailure {
        match error {
            PipelineError::Plugin(failure) => failure,
            PipelineError::StaleActivation => PipelineFailure {
                code: "plugin_stale_activation".to_string(),
                message: "the plugin pipeline activation is stale".to_string(),
                retryable: false,
            },
            PipelineError::Boundary(_) | PipelineError::InvalidDefinition(_) => PipelineFailure {
                code: "step_boundary_invalid".to_string(),
                message: "pipeline step input, output, or configuration is invalid".to_string(),
                retryable: false,
            },
            error => PipelineFailure {
                code: "step_failed".to_string(),
                message: error.to_string(),
                retryable: true,
            },
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn plugin_attempt(
        step_run: &PipelineStepRun,
        execution_binding: &translunar_pipeline::PipelineStepBinding,
        input: &Value,
        output: Option<&Value>,
        checkpoint_output: Option<&Value>,
        usage: Option<&Value>,
        failure: Option<&PipelineFailure>,
        started_at_ms: i64,
    ) -> std::result::Result<PipelineStepPluginAttempt, PipelineError> {
        let _historical_binding = step_run.plugin_binding.as_ref().ok_or_else(|| {
            PipelineError::Boundary("plugin pipeline binding is missing".to_string())
        })?;
        let checkpoint_schema_version = match &execution_binding.owner {
            PipelineStepOwner::Plugin {
                checkpoint_schema_version,
                ..
            } => *checkpoint_schema_version,
            PipelineStepOwner::Builtin => {
                return Err(PipelineError::Boundary(
                    "plugin pipeline binding has a builtin owner".to_string(),
                ));
            }
        };
        if checkpoint_output.is_some() && checkpoint_schema_version.is_none() {
            return Err(PipelineError::Boundary(
                "plugin pipeline checkpoint schema is missing".to_string(),
            ));
        }
        let hash = |value: &Value| {
            pipeline_json_hash(value)
                .map_err(|_| PipelineError::Boundary("pipeline value hashing failed".to_string()))
        };
        let attempt_index = step_run
            .latest_plugin_attempt
            .as_ref()
            .map_or(Ok(0), |attempt| {
                attempt.attempt_index.checked_add(1).ok_or_else(|| {
                    PipelineError::Boundary("plugin attempt index overflow".to_string())
                })
            })?;
        let completed_at_ms = pipeline_now_ms().map_err(|_| {
            PipelineError::Boundary("plugin attempt timestamp is unavailable".to_string())
        })?;
        Ok(PipelineStepPluginAttempt {
            id: new_id(),
            attempt_index,
            operation: if step_run.checkpoint.is_some() {
                PipelineStepPluginOperation::Resume
            } else {
                PipelineStepPluginOperation::Execute
            },
            input_hash: hash(input)?,
            output_hash: output.map(hash).transpose()?,
            checkpoint_input_hash: step_run.checkpoint.as_ref().map(hash).transpose()?,
            checkpoint_output_hash: checkpoint_output.map(hash).transpose()?,
            checkpoint_schema_version,
            usage: usage.cloned().unwrap_or_else(|| json!({})),
            failure: failure.cloned(),
            started_at_ms,
            completed_at_ms,
        })
    }
}

fn pipeline_now_ms() -> Result<i64> {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| {
            EngineError::InvalidState("system clock is before the Unix epoch".to_string())
        })?
        .as_millis();
    i64::try_from(millis)
        .map_err(|_| EngineError::InvalidState("system clock is out of range".to_string()))
}

fn pipeline_json_hash(value: &Value) -> Result<String> {
    let bytes = serde_json::to_vec(value)
        .map_err(|_| EngineError::InvalidState("pipeline JSON is not serializable".to_string()))?;
    Ok(format!("{:x}", Sha256::digest(bytes)))
}

fn plugin_checkpoint_incompatible(message: &str) -> PipelineFailure {
    PipelineFailure {
        code: "plugin_checkpoint_incompatible".to_string(),
        message: message.to_string(),
        retryable: false,
    }
}

pub struct EngineService {
    store: Store,
    filters: FilterRegistry,
    pipeline: PipelineManager,
    ai: ai::AiManager,
    plugin_connector_catalog: ai::PluginConnectorCatalog,
    plugin_processes: ActivePluginProcessRegistry,
    pending_plugin_processes: std::collections::BTreeMap<
        (String, String),
        std::sync::Arc<translunar_plugin_runtime::PluginProcess>,
    >,
    plugin_sandbox_runtimes: translunar_plugin_runtime::SandboxRuntimeRegistry,
    plugin_sandbox_keys:
        std::collections::BTreeMap<String, translunar_plugin_runtime::SandboxRuntimeKey>,
    pending_sandbox_workers: std::collections::BTreeMap<
        translunar_plugin_runtime::SandboxRuntimeKey,
        plugin::PreparedSandboxActivation,
    >,
    plugin_filter_owners: std::collections::BTreeMap<String, String>,
    plugin_qa_registry: qa::PluginQaRegistry,
    plugin_ai_action_registry: plugin_ai_ui::PluginAiActionRegistry,
    plugin_ui_panel_registry: plugin_ai_ui::PluginUiPanelRegistry,
    plugin_ai_action_cancels: plugin_ai_ui::AiActionCancelRegistry,
    external_connector_registry: plugin_external_connector::ExternalConnectorRegistry,
    external_connector_credentials:
        std::sync::Arc<dyn plugin_external_connector::ExternalConnectorCredentialStore>,
    plugin_pipeline_owners: std::collections::BTreeMap<String, PipelineStepOwner>,
    plugin_activation_revisions: std::collections::BTreeMap<String, u64>,
    plugin_capabilities: plugin_capability::PluginCapabilityService,
}

impl EngineService {
    pub fn open(data_dir: impl AsRef<Path>) -> Result<Self> {
        let data_dir = data_dir.as_ref().to_path_buf();
        let ai = ai::AiManager::new(data_dir.clone())?;
        Self::open_with_ai(data_dir, ai)
    }

    fn open_with_ai(data_dir: PathBuf, ai: ai::AiManager) -> Result<Self> {
        let filters = FilterRegistry::default();
        filters
            .register(Arc::new(DocxFilter))
            .map_err(|error| EngineError::InvalidState(error.to_string()))?;
        filters
            .register(Arc::new(BilingualDocxFilter))
            .map_err(|error| EngineError::InvalidState(error.to_string()))?;
        filters
            .register(Arc::new(XlsxFilter))
            .map_err(|error| EngineError::InvalidState(error.to_string()))?;
        filters
            .register(Arc::new(BilingualXlsxFilter))
            .map_err(|error| EngineError::InvalidState(error.to_string()))?;
        filters
            .register(Arc::new(PptxFilter))
            .map_err(|error| EngineError::InvalidState(error.to_string()))?;
        filters
            .register(Arc::new(PdfFilter))
            .map_err(|error| EngineError::InvalidState(error.to_string()))?;
        filters
            .register(Arc::new(TxtFilter))
            .map_err(|error| EngineError::InvalidState(error.to_string()))?;
        filters
            .register(Arc::new(MarkdownFilter))
            .map_err(|error| EngineError::InvalidState(error.to_string()))?;
        filters
            .register(Arc::new(HtmlFilter))
            .map_err(|error| EngineError::InvalidState(error.to_string()))?;
        filters
            .register(Arc::new(XliffFilter))
            .map_err(|error| EngineError::InvalidState(error.to_string()))?;
        filters
            .register(Arc::new(SdlxliffFilter))
            .map_err(|error| EngineError::InvalidState(error.to_string()))?;
        filters
            .register(Arc::new(MqxliffFilter))
            .map_err(|error| EngineError::InvalidState(error.to_string()))?;
        filters
            .register(Arc::new(MqxlzFilter))
            .map_err(|error| EngineError::InvalidState(error.to_string()))?;
        let store = Store::open(&data_dir)?;
        let plugin_capabilities = plugin_capability::PluginCapabilityService::open(&data_dir)?;
        let plugin_qa_registry = qa::PluginQaRegistry::default();
        let plugin_processes = ActivePluginProcessRegistry::default();
        let pipeline = PipelineManager::new(
            data_dir,
            ai.clone(),
            filters.clone(),
            plugin_qa_registry.clone(),
            plugin_processes.clone(),
        )?;
        let mut service = Self {
            store,
            filters,
            pipeline,
            ai,
            plugin_connector_catalog: ai::PluginConnectorCatalog::new(),
            plugin_processes,
            pending_plugin_processes: std::collections::BTreeMap::new(),
            plugin_sandbox_runtimes: translunar_plugin_runtime::SandboxRuntimeRegistry::default(),
            plugin_sandbox_keys: std::collections::BTreeMap::new(),
            pending_sandbox_workers: std::collections::BTreeMap::new(),
            plugin_filter_owners: std::collections::BTreeMap::new(),
            plugin_qa_registry,
            plugin_ai_action_registry: plugin_ai_ui::PluginAiActionRegistry::default(),
            plugin_ui_panel_registry: plugin_ai_ui::PluginUiPanelRegistry::default(),
            plugin_ai_action_cancels: plugin_ai_ui::AiActionCancelRegistry::default(),
            external_connector_registry:
                plugin_external_connector::ExternalConnectorRegistry::default(),
            external_connector_credentials:
                plugin_external_connector::default_external_connector_credential_store(),
            plugin_pipeline_owners: std::collections::BTreeMap::new(),
            plugin_activation_revisions: std::collections::BTreeMap::new(),
            plugin_capabilities,
        };
        service.reload_enabled_plugins()?;
        Ok(service)
    }

    pub fn create_project(&mut self, params: CreateProjectParams) -> Result<Project> {
        self.store
            .create_project(
                &params.name,
                &params.source_locale,
                &params.target_locale,
                &params.domain,
            )
            .map_err(Into::into)
    }

    pub fn get_project(&self, project_id: &str) -> Result<ProjectSnapshot> {
        let aggregate = self.store.get_project(project_id)?;
        Ok(ProjectSnapshot {
            project: aggregate.project,
            documents: aggregate.documents,
            counts: aggregate.counts,
        })
    }

    pub fn list_projects(&self, params: ProjectListParams) -> Result<ProjectPage> {
        let limit = bounded_page_size(params.limit)?;
        let (items, total) = self
            .store
            .list_projects(params.lifecycle, params.offset, limit)?;
        Ok(ProjectPage {
            items,
            total,
            offset: params.offset,
            limit,
        })
    }

    pub fn update_project(&mut self, params: UpdateProjectParams) -> Result<Project> {
        self.store
            .update_project(
                &params.project_id,
                ProjectUpdate {
                    name: params.name,
                    source_locale: params.source_locale,
                    target_locale: params.target_locale,
                    domain: params.domain,
                    configuration: params.configuration,
                    expected_revision: params.expected_revision,
                    actor: params.actor,
                    correlation_id: params.correlation_id,
                },
            )
            .map_err(Into::into)
    }

    pub fn set_project_lifecycle(&mut self, params: SetProjectLifecycleParams) -> Result<Project> {
        self.store
            .set_project_lifecycle(
                &params.project_id,
                params.lifecycle,
                params.expected_revision,
                &params.actor,
                params.correlation_id.as_deref(),
            )
            .map_err(Into::into)
    }

    pub fn list_project_templates(
        &self,
        params: ProjectTemplateListParams,
    ) -> Result<ProjectTemplatePage> {
        let limit = bounded_page_size(params.limit)?;
        let (items, total) = self.store.list_project_templates(params.offset, limit)?;
        Ok(ProjectTemplatePage {
            items: items.into_iter().map(protocol_template).collect(),
            total,
            offset: params.offset,
            limit,
        })
    }

    pub fn get_project_template(
        &self,
        params: ProjectTemplateGetParams,
    ) -> Result<ProjectTemplate> {
        Ok(protocol_template(self.store.get_project_template(
            &params.template_id,
            params.revision,
        )?))
    }

    pub fn create_project_template(
        &mut self,
        params: ProjectTemplateCreateParams,
    ) -> Result<ProjectTemplate> {
        Ok(protocol_template(self.store.create_project_template(
            &params.name,
            &params.description,
            params.definition,
        )?))
    }

    pub fn update_project_template(
        &mut self,
        params: ProjectTemplateUpdateParams,
    ) -> Result<ProjectTemplate> {
        Ok(protocol_template(self.store.update_project_template(
            &params.template_id,
            params.expected_revision,
            &params.name,
            &params.description,
            params.definition,
        )?))
    }

    pub fn delete_project_template(
        &mut self,
        params: ProjectTemplateDeleteParams,
    ) -> Result<EmptyResult> {
        self.store
            .delete_project_template(&params.template_id, params.expected_revision)?;
        Ok(EmptyResult::default())
    }

    pub fn create_project_from_template(
        &mut self,
        params: ProjectCreateFromTemplateParams,
    ) -> Result<ProjectCreateFromTemplateResult> {
        Ok(protocol_project_from_template(
            self.store.create_project_from_template(
                &params.template_id,
                params.template_revision,
                &params.name,
                params.source_locale.as_deref(),
                params.target_locale.as_deref(),
                params.domain.as_deref(),
                &params.dependency_remaps,
            )?,
        ))
    }

    pub fn export_project_archive(
        &mut self,
        params: ProjectArchiveExportParams,
    ) -> Result<ProjectArchiveResult> {
        let destination = PathBuf::from(&params.destination_path);
        if destination.exists() {
            return Err(EngineError::InvalidState(
                "project archive destination already exists".to_string(),
            ));
        }
        let parent = destination
            .parent()
            .filter(|path| !path.as_os_str().is_empty())
            .unwrap_or_else(|| Path::new("."));
        fs::create_dir_all(parent)?;
        let archive_data = self.store.export_project_archive_data(&params.project_id)?;
        let project_json = serde_json::to_vec_pretty(&archive_data)?;
        let mut payloads = vec![("project.json".to_string(), project_json)];
        for document in &archive_data.documents {
            if document.versions.is_empty() {
                let managed = self.store.get_document(&document.document.id)?;
                let bytes = fs::read(&managed.managed_source_path)?;
                let extension = managed
                    .managed_source_path
                    .extension()
                    .and_then(|value| value.to_str())
                    .filter(|value| !value.is_empty())
                    .unwrap_or("source");
                payloads.push((
                    format!("sources/{}/source.{extension}", document.document.id),
                    bytes,
                ));
            } else {
                for version in &document.versions {
                    let source = archive_managed_source_path(
                        &self.store.paths().root,
                        &version.version.managed_source_path,
                    )?;
                    let bytes = fs::read(&source).map_err(|error| {
                        EngineError::InvalidState(format!(
                            "archive source for document version {} is unavailable: {error}",
                            version.version.id
                        ))
                    })?;
                    let extension = source
                        .extension()
                        .and_then(|value| value.to_str())
                        .filter(|value| !value.is_empty())
                        .unwrap_or("source");
                    payloads.push((
                        format!(
                            "sources/{}/versions/{}/source.{extension}",
                            document.document.id, version.version.id
                        ),
                        bytes,
                    ));
                }
            }
            for preview in &document.reimport_previews {
                let source = archive_managed_source_path(
                    &self.store.paths().root,
                    &preview.staged_source_path,
                )?;
                if !source.is_file() {
                    if preview.status == "pending" {
                        return Err(EngineError::InvalidState(format!(
                            "pending re-import preview {} source is unavailable",
                            preview.id
                        )));
                    }
                    continue;
                }
                let bytes = fs::read(&source)?;
                let extension = source
                    .extension()
                    .and_then(|value| value.to_str())
                    .filter(|value| !value.is_empty())
                    .unwrap_or("source");
                payloads.push((
                    format!(
                        "sources/{}/reimports/{}/source.{extension}",
                        document.document.id, preview.id
                    ),
                    bytes,
                ));
            }
        }
        payloads.sort_by(|left, right| left.0.cmp(&right.0));
        let entries = payloads
            .iter()
            .map(|(path, bytes)| ArchiveEntry {
                path: path.clone(),
                size_bytes: u64::try_from(bytes.len()).unwrap_or(u64::MAX),
                sha256: sha256_hex(bytes),
            })
            .collect::<Vec<_>>();
        let manifest = ProjectArchiveManifest {
            format_version: PROJECT_ARCHIVE_FORMAT_VERSION,
            schema_version: self.store.check_health()?.schema_version,
            created_at_ms: chrono::Utc::now().timestamp_millis(),
            project_id: archive_data.project.id.clone(),
            project_name: archive_data.project.name.clone(),
            source_locale: archive_data.project.source_locale.clone(),
            target_locale: archive_data.project.target_locale.clone(),
            entries,
            dependencies: archive_data.dependencies.clone(),
        };
        manifest
            .validate()
            .map_err(|error| EngineError::InvalidState(error.to_string()))?;
        let manifest_json = serde_json::to_vec_pretty(&manifest)?;
        let mut temporary = NamedTempFile::new_in(parent)?;
        {
            let mut writer = ZipWriter::new(temporary.as_file_mut());
            let options = SimpleFileOptions::default()
                .compression_method(CompressionMethod::Deflated)
                .unix_permissions(0o600);
            for (path, bytes) in &payloads {
                writer
                    .start_file(path, options)
                    .map_err(|error| EngineError::InvalidState(error.to_string()))?;
                writer.write_all(bytes)?;
            }
            writer
                .start_file("manifest.json", options)
                .map_err(|error| EngineError::InvalidState(error.to_string()))?;
            writer.write_all(&manifest_json)?;
            writer
                .finish()
                .map_err(|error| EngineError::InvalidState(error.to_string()))?;
        }
        temporary.as_file().sync_all()?;
        validate_project_archive_file(temporary.path())?;
        let archive_sha256 = sha256_path(temporary.path())?;
        temporary
            .persist_noclobber(&destination)
            .map_err(|error| EngineError::Io(error.error))?;
        if let Err(error) = self.store.record_project_archive_export(
            &archive_data.project.id,
            &NewProjectArchiveRecord {
                archive_path: destination.to_string_lossy().into_owned(),
                archive_sha256: archive_sha256.clone(),
                manifest: serde_json::to_value(&manifest)?,
                actor: params.actor,
            },
        ) {
            let _ = fs::remove_file(&destination);
            return Err(error.into());
        }
        Ok(ProjectArchiveResult {
            project_id: archive_data.project.id,
            archive_path: destination.to_string_lossy().into_owned(),
            archive_sha256,
            diagnostics: manifest
                .dependencies
                .iter()
                .map(|dependency| {
                    format!(
                        "External {} '{}' must be remapped after restore",
                        dependency.kind, dependency.name
                    )
                })
                .collect(),
        })
    }

    pub fn restore_project_archive(
        &mut self,
        params: ProjectArchiveRestoreParams,
    ) -> Result<ProjectArchiveResult> {
        let archive_path = PathBuf::from(&params.archive_path);
        let validated = read_validated_project_archive(&archive_path)?;
        let archive_sha256 = sha256_path(&archive_path)?;
        let mut managed_sources = BTreeMap::new();
        let mut created_sources = StagedArchiveSources::default();
        for document in &validated.data.documents {
            if document.versions.is_empty() {
                let prefix = format!("sources/{}/source.", document.document.id);
                let (entry_path, bytes) = validated
                    .payloads
                    .iter()
                    .find(|(path, _)| path.starts_with(&prefix))
                    .ok_or_else(|| {
                        EngineError::InvalidRequest(format!(
                            "archive is missing the managed source for document {}",
                            document.document.id
                        ))
                    })?;
                let extension = Path::new(entry_path)
                    .extension()
                    .and_then(|value| value.to_str())
                    .unwrap_or("source");
                let relative = stage_archive_source(
                    &self.store,
                    &document.document.id,
                    bytes,
                    extension,
                    &mut managed_sources,
                    &mut created_sources,
                )?;
                managed_sources.insert(document.managed_source_path.clone(), relative);
            } else {
                for version in &document.versions {
                    let prefix = format!(
                        "sources/{}/versions/{}/source.",
                        document.document.id, version.version.id
                    );
                    let (entry_path, bytes) = validated
                        .payloads
                        .iter()
                        .find(|(path, _)| path.starts_with(&prefix))
                        .ok_or_else(|| {
                            EngineError::InvalidRequest(format!(
                                "archive is missing source for document version {}",
                                version.version.id
                            ))
                        })?;
                    let extension = Path::new(entry_path)
                        .extension()
                        .and_then(|value| value.to_str())
                        .unwrap_or("source");
                    stage_archive_source(
                        &self.store,
                        &version.version.managed_source_path,
                        bytes,
                        extension,
                        &mut managed_sources,
                        &mut created_sources,
                    )?;
                }
            }
            for preview in &document.reimport_previews {
                let prefix = format!(
                    "sources/{}/reimports/{}/source.",
                    document.document.id, preview.id
                );
                let payload = validated
                    .payloads
                    .iter()
                    .find(|(path, _)| path.starts_with(&prefix));
                let Some((entry_path, bytes)) = payload else {
                    if preview.status == "pending" {
                        return Err(EngineError::InvalidRequest(format!(
                            "archive is missing pending re-import source {}",
                            preview.id
                        )));
                    }
                    continue;
                };
                let extension = Path::new(entry_path)
                    .extension()
                    .and_then(|value| value.to_str())
                    .unwrap_or("source");
                stage_archive_source(
                    &self.store,
                    &preview.staged_source_path,
                    bytes,
                    extension,
                    &mut managed_sources,
                    &mut created_sources,
                )?;
            }
        }
        let restored = self.store.restore_project_archive_data(
            &validated.data,
            &managed_sources,
            &params.dependency_remaps,
            &params.actor,
            &NewProjectArchiveRecord {
                archive_path: archive_path.to_string_lossy().into_owned(),
                archive_sha256: archive_sha256.clone(),
                manifest: serde_json::to_value(&validated.manifest)?,
                actor: params.actor.clone(),
            },
        );
        let project = restored?;
        created_sources.retain();
        let remapped = validated
            .manifest
            .dependencies
            .iter()
            .filter(|dependency| params.dependency_remaps.contains_key(&dependency.id))
            .count();
        Ok(ProjectArchiveResult {
            project_id: project.id,
            archive_path: archive_path.to_string_lossy().into_owned(),
            archive_sha256,
            diagnostics: vec![format!(
                "Restored with {remapped} of {} external dependencies explicitly remapped",
                validated.manifest.dependencies.len()
            )],
        })
    }

    pub fn list_discussion_threads(
        &self,
        params: DiscussionThreadListParams,
    ) -> Result<DiscussionThreadPage> {
        let limit = bounded_page_size(params.limit)?;
        let (items, total) =
            self.store
                .list_discussion_threads(&StorageDiscussionThreadFilter {
                    project_id: params.project_id,
                    scope: params.scope.map(storage_discussion_scope),
                    document_id: params.document_id,
                    segment_id: params.segment_id,
                    include_resolved: params.include_resolved,
                    offset: params.offset,
                    limit,
                })?;
        Ok(DiscussionThreadPage {
            items: items.into_iter().map(protocol_discussion_thread).collect(),
            total,
            offset: params.offset,
            limit,
        })
    }

    pub fn create_discussion_thread(
        &mut self,
        params: DiscussionThreadCreateParams,
    ) -> Result<DiscussionThread> {
        Ok(protocol_discussion_thread(
            self.store.create_discussion_thread(NewDiscussionThread {
                project_id: params.project_id,
                scope: storage_discussion_scope(params.scope),
                document_id: params.document_id,
                segment_id: params.segment_id,
                title: params.title,
                body: params.body,
                actor: params.actor,
                reason: params.reason,
                expected_project_revision: params.expected_project_revision,
            })?,
        ))
    }

    pub fn resolve_discussion_thread(
        &mut self,
        params: DiscussionThreadResolveParams,
    ) -> Result<DiscussionThread> {
        Ok(protocol_discussion_thread(
            self.store.resolve_discussion_thread(
                &params.thread_id,
                params.resolved,
                params.expected_revision,
                &params.actor,
                &params.reason,
            )?,
        ))
    }

    pub fn list_discussion_messages(
        &self,
        params: DiscussionMessageListParams,
    ) -> Result<DiscussionMessagePage> {
        let limit = bounded_page_size(params.limit)?;
        let (items, total) = self.store.list_discussion_messages(
            &params.thread_id,
            params.include_deleted,
            params.offset,
            limit,
        )?;
        Ok(DiscussionMessagePage {
            items: items.into_iter().map(protocol_discussion_message).collect(),
            total,
            offset: params.offset,
            limit,
        })
    }

    pub fn create_discussion_message(
        &mut self,
        params: DiscussionMessageCreateParams,
    ) -> Result<DiscussionMessage> {
        Ok(protocol_discussion_message(
            self.store.create_discussion_message(NewDiscussionMessage {
                thread_id: params.thread_id,
                body: params.body,
                actor: params.actor,
                reason: params.reason,
                expected_thread_revision: params.expected_thread_revision,
            })?,
        ))
    }

    pub fn update_discussion_message(
        &mut self,
        params: DiscussionMessageUpdateParams,
    ) -> Result<DiscussionMessage> {
        Ok(protocol_discussion_message(
            self.store.update_discussion_message(
                &params.message_id,
                &params.body,
                &params.actor,
                &params.reason,
                params.expected_revision,
            )?,
        ))
    }

    pub fn delete_discussion_message(
        &mut self,
        params: DiscussionMessageDeleteParams,
    ) -> Result<DiscussionMessage> {
        Ok(protocol_discussion_message(
            self.store.delete_discussion_message(
                &params.message_id,
                &params.actor,
                &params.reason,
                params.expected_revision,
            )?,
        ))
    }

    pub fn list_project_snapshots(
        &self,
        params: ProjectSnapshotListParams,
    ) -> Result<ProjectSnapshotPage> {
        let limit = bounded_page_size(params.limit)?;
        let (items, total) =
            self.store
                .list_project_snapshots(&params.project_id, params.offset, limit)?;
        Ok(ProjectSnapshotPage {
            items: items.into_iter().map(protocol_snapshot_metadata).collect(),
            total,
            offset: params.offset,
            limit,
        })
    }

    pub fn create_project_snapshot(
        &mut self,
        params: ProjectSnapshotCreateParams,
    ) -> Result<NamedProjectSnapshot> {
        Ok(protocol_snapshot_metadata(
            self.store.create_project_snapshot(NewProjectSnapshot {
                project_id: params.project_id,
                name: params.name,
                expected_project_revision: params.expected_project_revision,
                actor: params.actor,
                reason: params.reason,
            })?,
        ))
    }

    pub fn get_project_snapshot(
        &self,
        params: ProjectSnapshotGetParams,
    ) -> Result<NamedProjectSnapshot> {
        Ok(protocol_snapshot_metadata(
            self.store.get_project_snapshot(&params.snapshot_id)?,
        ))
    }

    pub fn preview_project_snapshot_restore(
        &mut self,
        params: ProjectSnapshotPreviewRestoreParams,
    ) -> Result<ProjectSnapshotPreview> {
        Ok(protocol_snapshot_preview(
            self.store.preview_project_snapshot_restore(
                &params.snapshot_id,
                params.expected_project_revision,
            )?,
        ))
    }

    pub fn restore_project_snapshot(
        &mut self,
        params: ProjectSnapshotRestoreParams,
    ) -> Result<ProjectSnapshotRestoreResult> {
        Ok(protocol_snapshot_restore_result(
            self.store
                .restore_project_snapshot(RestoreProjectSnapshot {
                    preview_id: params.preview_id,
                    expected_project_revision: params.expected_project_revision,
                    actor: params.actor,
                    reason: params.reason,
                })?,
        ))
    }

    pub fn batch_import(
        &mut self,
        params: ProjectBatchImportParams,
    ) -> Result<ProjectBatchImportResult> {
        if params.items.is_empty() || params.items.len() > 1_000 {
            return Err(EngineError::InvalidRequest(
                "batch import requires between 1 and 1000 selections".to_string(),
            ));
        }
        validate_filter_options(&params.options)?;
        let project = self.store.get_project(&params.project_id)?;
        let mut expanded = Vec::new();
        for item in params.items {
            let path = PathBuf::from(&item.path);
            if path.is_dir() {
                collect_batch_files(&path, &path, &mut expanded, 1_000)?;
            } else {
                expanded.push((path, item.relative_path));
            }
        }
        if expanded.is_empty() {
            return Err(EngineError::InvalidRequest(
                "batch import selection contains no files".to_string(),
            ));
        }
        let mut seen = self
            .store
            .list_all_document_relative_paths(&params.project_id)?
            .into_iter()
            .collect::<BTreeSet<_>>();
        let mut selections = Vec::with_capacity(expanded.len());
        for (path, relative_path) in expanded {
            let display = path.to_string_lossy().into_owned();
            let relative = match normalize_relative_path(relative_path.as_deref(), &path) {
                Ok(relative) => relative,
                Err(error) => {
                    selections.push(BatchSelection::Failed(Box::new(BatchImportDiagnostic {
                        path: display,
                        relative_path: relative_path.unwrap_or_default(),
                        status: "failed".to_string(),
                        document: None,
                        error_code: Some(engine_error_code(&error).to_string()),
                        message: Some(error.to_string()),
                    })));
                    continue;
                }
            };
            if !seen.insert(relative.clone()) {
                selections.push(BatchSelection::Failed(Box::new(BatchImportDiagnostic {
                    path: display,
                    relative_path: relative,
                    status: "failed".to_string(),
                    document: None,
                    error_code: Some("relative_path_collision".to_string()),
                    message: Some(
                        "the relative path already exists in the project or batch".to_string(),
                    ),
                })));
                continue;
            }
            selections.push(BatchSelection::Candidate {
                path,
                display,
                relative,
            });
        }
        let diagnostics = match params.atomicity {
            BatchImportAtomicity::BestEffort => selections
                .into_iter()
                .map(|selection| match selection {
                    BatchSelection::Failed(diagnostic) => *diagnostic,
                    BatchSelection::Candidate {
                        display, relative, ..
                    } => {
                        let result = self.import_document(ImportDocumentParams {
                            project_id: params.project_id.clone(),
                            source_path: display.clone(),
                            relative_path: Some(relative.clone()),
                            filter_id: params.filter_id.clone(),
                            options: params.options.clone(),
                        });
                        match result {
                            Ok(imported) => BatchImportDiagnostic {
                                path: display,
                                relative_path: relative,
                                status: "succeeded".to_string(),
                                document: Some(imported.document),
                                error_code: None,
                                message: None,
                            },
                            Err(error) => BatchImportDiagnostic {
                                path: display,
                                relative_path: relative,
                                status: "failed".to_string(),
                                document: None,
                                error_code: Some(engine_error_code(&error).to_string()),
                                message: Some(error.to_string()),
                            },
                        }
                    }
                })
                .collect(),
            BatchImportAtomicity::AllOrNothing => self.import_batch_atomically(
                &params.project_id,
                &project.project.source_locale,
                params.filter_id.as_deref(),
                &params.options,
                selections,
            )?,
        };
        let succeeded = u32::try_from(
            diagnostics
                .iter()
                .filter(|item| item.status == "succeeded")
                .count(),
        )
        .unwrap_or(u32::MAX);
        let failed = u32::try_from(diagnostics.len())
            .unwrap_or(u32::MAX)
            .saturating_sub(succeeded);
        Ok(ProjectBatchImportResult {
            items: diagnostics,
            succeeded,
            failed,
        })
    }

    pub fn list_recycle(&self, params: RecycleListParams) -> Result<RecyclePage> {
        let limit = bounded_page_size(params.limit)?;
        let (items, total) = self.store.list_recycle_entries(params.offset, limit)?;
        Ok(RecyclePage {
            items: items.into_iter().map(protocol_recycle_entry).collect(),
            total,
            offset: params.offset,
            limit,
        })
    }

    pub fn recycle_delete(&mut self, params: RecycleDeleteParams) -> Result<RecycleEntry> {
        Ok(protocol_recycle_entry(self.store.recycle_entity(
            &params.entity_type,
            &params.entity_id,
            params.expected_revision,
            &params.actor,
            &params.reason,
            params.retention_ms,
        )?))
    }

    pub fn recycle_restore(&mut self, params: RecycleEntryActionParams) -> Result<EmptyResult> {
        self.store
            .restore_recycle_entry(&params.entry_id, &params.actor)?;
        Ok(EmptyResult::default())
    }

    pub fn recycle_purge(&mut self, params: RecycleEntryActionParams) -> Result<EmptyResult> {
        self.store
            .purge_recycle_entry(&params.entry_id, &params.actor, &params.reason)?;
        Ok(EmptyResult::default())
    }

    pub fn search_global(&mut self, params: GlobalSearchParams) -> Result<GlobalSearchPage> {
        let limit = bounded_page_size(params.limit)?;
        let query = StorageGlobalSearchQuery {
            text: params.text,
            project_id: params.project_id,
            fields: params.fields,
            locale: params.locale,
            workflow_state: params.workflow_state,
            updated_after_ms: params.updated_after_ms,
            updated_before_ms: params.updated_before_ms,
            include_recycled: params.include_recycled,
            offset: params.offset,
            limit,
        };
        let (items, total) = self.store.search_global(&query)?;
        Ok(GlobalSearchPage {
            items: items.into_iter().map(protocol_search_hit).collect(),
            total,
            offset: params.offset,
            limit,
        })
    }

    pub fn list_analysis_profiles(&self) -> Result<AnalysisProfileListResult> {
        Ok(AnalysisProfileListResult {
            items: self
                .store
                .list_analysis_profiles()?
                .into_iter()
                .map(protocol_analysis_profile)
                .collect(),
        })
    }

    pub fn run_analysis(&mut self, params: AnalysisRunParams) -> Result<AnalysisRunResult> {
        Ok(protocol_analysis_run(self.store.run_analysis(
            &params.project_id,
            params.document_id.as_deref(),
            &params.profile_id,
            params.profile_revision,
        )?))
    }

    pub fn get_analysis_run(&self, params: AnalysisRunIdParams) -> Result<AnalysisRunResult> {
        Ok(protocol_analysis_run(
            self.store.get_analysis_run(&params.run_id)?,
        ))
    }

    pub fn get_project_analytics(
        &self,
        params: ProjectAnalyticsParams,
    ) -> Result<ProjectAnalyticsResult> {
        Ok(self.store.get_project_analytics(
            &params.project_id,
            params.idle_gap_ms,
            params.trend_bucket_ms,
            params.trend_bucket_count,
        )?)
    }

    pub fn create_alignment_session(
        &mut self,
        params: protocol::AlignmentSessionCreateParams,
    ) -> Result<protocol::AlignmentSessionCreateResult> {
        let result = self
            .store
            .create_alignment_session(storage::NewAlignmentSession {
                project_id: params.project_id,
                source_document_id: params.source_document_id,
                target_document_id: params.target_document_id,
                expected_project_revision: params.expected_project_revision,
                expected_source_document_revision: params.expected_source_document_revision,
                expected_target_document_revision: params.expected_target_document_revision,
                options: params.options,
                actor: params.actor,
                reason: params.reason,
                correlation_id: params.correlation_id,
            })?;
        protocol_alignment_session_create_result(result)
    }

    pub fn get_alignment_session(
        &self,
        params: protocol::AlignmentSessionGetParams,
    ) -> Result<protocol::AlignmentSessionGetResult> {
        let limit = bounded_page_size(params.limit)?;
        let session = self.store.get_alignment_session(&params.session_id)?;
        let (links, total) = self.store.list_alignment_links(
            &params.session_id,
            params.link_status,
            params.offset,
            limit,
        )?;
        Ok(protocol::AlignmentSessionGetResult {
            session: protocol_alignment_session(session)?,
            links: links.into_iter().map(protocol_alignment_link).collect(),
            total,
            offset: params.offset,
            limit,
        })
    }

    pub fn list_alignment_sessions(
        &self,
        params: protocol::AlignmentSessionListParams,
    ) -> Result<protocol::AlignmentSessionPage> {
        let limit = bounded_page_size(params.limit)?;
        self.store.get_project(&params.project_id)?;
        let (items, total) = self.store.list_alignment_sessions(
            &params.project_id,
            params.status.map(storage_alignment_session_status),
            params.offset,
            limit,
        )?;
        Ok(protocol::AlignmentSessionPage {
            items: items
                .into_iter()
                .map(protocol_alignment_session)
                .collect::<Result<Vec<_>>>()?,
            total,
            offset: params.offset,
            limit,
        })
    }

    pub fn update_alignment_session(
        &mut self,
        params: protocol::AlignmentSessionUpdateParams,
    ) -> Result<protocol::AlignmentMutationResult> {
        let protocol::AlignmentSessionUpdateParams {
            session_id,
            expected_session_revision,
            mutation,
            actor,
            reason,
            correlation_id,
        } = params;
        let result = match mutation {
            protocol::AlignmentSessionMutation::ReplaceLinks { links, replacement } => {
                self.store
                    .replace_alignment_partition(storage::ReplaceAlignmentPartition {
                        session_id,
                        expected_session_revision,
                        links: links
                            .into_iter()
                            .map(storage_expected_alignment_link_revision)
                            .collect(),
                        replacement: replacement
                            .into_iter()
                            .map(|link| storage::ManualAlignmentPartitionLink {
                                source_segment_ids: link.source_segment_ids,
                                target_segment_ids: link.target_segment_ids,
                            })
                            .collect(),
                        actor,
                        reason,
                        correlation_id,
                    })?
            }
            protocol::AlignmentSessionMutation::SetStatus {
                link_id,
                expected_link_revision,
                status,
            } => self
                .store
                .update_alignment_link_status(storage::UpdateAlignmentLinkStatus {
                    session_id,
                    link_id,
                    expected_session_revision,
                    expected_link_revision,
                    status,
                    actor,
                    reason,
                    correlation_id,
                })?,
        };
        protocol_alignment_mutation_result(result)
    }

    pub fn refine_alignment_session(
        &mut self,
        params: protocol::AlignmentSessionRefineParams,
    ) -> Result<translunar_ai_core::AiRun> {
        self.start_alignment_refinement(AlignmentRefinementStart {
            profile_id: params.profile_id,
            context: AlignmentRefinementRunContext {
                session_id: params.session_id,
                expected_session_revision: params.expected_session_revision,
                links: params
                    .links
                    .into_iter()
                    .map(|link| AlignmentRefinementLinkRevision {
                        link_id: link.link_id,
                        expected_revision: link.expected_revision,
                    })
                    .collect(),
                actor: params.actor,
                reason: params.reason,
                correlation_id: params.correlation_id,
            },
            max_attempts: params.max_attempts,
        })
    }

    pub fn apply_alignment_session(
        &mut self,
        params: protocol::AlignmentSessionApplyParams,
    ) -> Result<protocol::AlignmentApplyResult> {
        let result = self
            .store
            .apply_alignment_to_tm(storage::ApplyAlignmentToTm {
                session_id: params.session_id,
                library_id: params.library_id,
                expected_session_revision: params.expected_session_revision,
                expected_library_revision: params.expected_library_revision,
                links: params
                    .links
                    .into_iter()
                    .map(storage_expected_alignment_link_revision)
                    .collect(),
                actor: params.actor,
                reason: params.reason,
                correlation_id: params.correlation_id,
            })?;
        Ok(protocol_alignment_apply_result(result))
    }

    pub fn list_reference_corpora(
        &self,
        params: protocol::CorpusListParams,
    ) -> Result<protocol::ReferenceCorpusPage> {
        let limit = bounded_page_size(params.limit)?;
        let (items, total) = self.store.list_reference_corpora(
            &params.project_id,
            params.status.map(storage_reference_corpus_status),
            params.offset,
            limit,
        )?;
        Ok(protocol::ReferenceCorpusPage {
            items: items.into_iter().map(protocol_reference_corpus).collect(),
            total,
            offset: params.offset,
            limit,
        })
    }

    pub fn create_reference_corpus_from_alignment(
        &mut self,
        params: protocol::CorpusFromAlignmentParams,
    ) -> Result<protocol::ReferenceCorpusMutationResult> {
        let result = self.store.create_reference_corpus_from_alignment(
            storage::CreateReferenceCorpusFromAlignment {
                project_id: params.project_id,
                expected_project_revision: params.expected_project_revision,
                session_id: params.session_id,
                expected_session_revision: params.expected_session_revision,
                name: params.name,
                links: params
                    .links
                    .into_iter()
                    .map(storage_expected_alignment_link_revision)
                    .collect(),
                actor: params.actor,
                reason: params.reason,
                correlation_id: params.correlation_id,
            },
        )?;
        Ok(protocol_reference_corpus_mutation_result(result))
    }

    pub fn search_reference_corpora(
        &self,
        params: protocol::CorpusSearchParams,
    ) -> Result<protocol::CorpusSearchResult> {
        let limit = bounded_page_size(params.limit)?;
        let result =
            self.store
                .search_reference_corpora(&storage::ReferenceCorpusSearchRequest {
                    project_id: params.project_id,
                    query: params.query,
                    side: storage_reference_corpus_search_side(params.side),
                    corpus_ids: params.corpus_ids,
                    offset: params.offset,
                    limit,
                })?;
        Ok(protocol_reference_corpus_search_result(result))
    }

    pub fn reindex_reference_corpus(
        &mut self,
        params: protocol::CorpusMutationParams,
    ) -> Result<protocol::ReferenceCorpusMutationResult> {
        let result = self
            .store
            .reindex_reference_corpus(storage::ReindexReferenceCorpus {
                corpus_id: params.corpus_id,
                expected_revision: params.expected_revision,
                actor: params.actor,
                reason: params.reason,
                correlation_id: params.correlation_id,
            })?;
        Ok(protocol_reference_corpus_mutation_result(result))
    }

    pub fn remove_reference_corpus(
        &mut self,
        params: protocol::CorpusMutationParams,
    ) -> Result<protocol::ReferenceCorpusMutationResult> {
        let result = self
            .store
            .remove_reference_corpus(storage::RemoveReferenceCorpus {
                corpus_id: params.corpus_id,
                expected_revision: params.expected_revision,
                actor: params.actor,
                reason: params.reason,
                correlation_id: params.correlation_id,
            })?;
        Ok(protocol_reference_corpus_mutation_result(result))
    }

    pub fn list_documents(&self, params: DocumentListParams) -> Result<DocumentPage> {
        let limit = bounded_page_size(params.limit)?;
        let (items, total) = self
            .store
            .list_documents(&params.project_id, params.offset, limit)?;
        Ok(DocumentPage {
            items,
            total,
            offset: params.offset,
            limit,
        })
    }

    pub fn get_document(&self, document_id: &str) -> Result<Document> {
        Ok(self.store.get_document(document_id)?.document)
    }

    pub fn import_docx(&mut self, params: ImportDocxParams) -> Result<Document> {
        Ok(self
            .import_document(ImportDocumentParams {
                project_id: params.project_id,
                source_path: params.source_path,
                relative_path: None,
                filter_id: Some("builtin.docx".to_string()),
                options: Default::default(),
            })?
            .document)
    }

    pub fn import_document(
        &mut self,
        params: ImportDocumentParams,
    ) -> Result<ImportDocumentResult> {
        let project = self.store.get_project(&params.project_id)?;
        validate_filter_options(&params.options)?;
        let source_path = PathBuf::from(&params.source_path);
        if !source_path.is_file() {
            return Err(EngineError::InvalidRequest(format!(
                "source document does not exist: {}",
                source_path.display()
            )));
        }
        let relative_path = normalize_relative_path(params.relative_path.as_deref(), &source_path)?;
        let prepared = match self.prepare_document_import(
            &params.project_id,
            &project.project.source_locale,
            source_path,
            relative_path,
            params.filter_id.as_deref(),
            &params.options,
        ) {
            Ok(prepared) => prepared,
            Err(error) => return Err(self.handle_plugin_filter_failure(error)),
        };
        let managed_source_path = prepared.input.managed_source_path.clone();
        match self.store.insert_document(&prepared.input, &prepared.units) {
            Ok(document) => Ok(ImportDocumentResult {
                filter_id: prepared.input.filter_id,
                degradation: prepared.input.degradation,
                document,
            }),
            Err(error) => {
                let _ = std::fs::remove_file(managed_source_path);
                Err(error.into())
            }
        }
    }

    pub fn import_reference_corpus(
        &mut self,
        request: ReferenceCorpusImportRequest,
    ) -> Result<ReferenceCorpusMutationResult> {
        let project = self.store.get_project(&request.project_id)?.project;
        validate_reference_corpus_import_request(&project, &request)?;
        let input = match self.prepare_reference_corpus_import(&project, request) {
            Ok(input) => input,
            Err(error) => return Err(self.handle_plugin_filter_failure(error)),
        };
        let managed_source_path = input.managed_source_path.clone();
        match self.store.create_reference_corpus(input) {
            Ok(result) => Ok(result),
            Err(error) => match fs::remove_file(&managed_source_path) {
                Ok(()) => Err(error.into()),
                Err(cleanup_error) if cleanup_error.kind() == std::io::ErrorKind::NotFound => {
                    Err(error.into())
                }
                Err(cleanup_error) => Err(EngineError::InvalidState(format!(
                    "reference corpus persistence failed and managed source cleanup failed: {cleanup_error}"
                ))),
            },
        }
    }

    pub fn import_reference_corpus_rpc(
        &mut self,
        params: protocol::CorpusImportParams,
    ) -> Result<protocol::ReferenceCorpusMutationResult> {
        let result = self.import_reference_corpus(ReferenceCorpusImportRequest {
            project_id: params.project_id,
            expected_project_revision: params.expected_project_revision,
            source_path: PathBuf::from(params.source_path),
            name: params.name,
            kind: storage_reference_corpus_kind(params.kind),
            source_locale: params.source_locale,
            target_locale: params.target_locale,
            filter_id: params.filter_id,
            options: params.options,
            actor: params.actor,
            reason: params.reason,
            correlation_id: params.correlation_id,
        })?;
        Ok(protocol_reference_corpus_mutation_result(result))
    }

    fn prepare_reference_corpus_import(
        &self,
        project: &Project,
        request: ReferenceCorpusImportRequest,
    ) -> Result<NewReferenceCorpus> {
        validate_filter_options(&request.options)?;
        if !request.source_path.is_file() {
            return Err(EngineError::CorpusInput(
                "reference corpus source file does not exist".to_string(),
            ));
        }
        let input_file_name = request
            .source_path
            .file_name()
            .and_then(|value| value.to_str())
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| {
                EngineError::CorpusInput(
                    "reference corpus source path must name a file".to_string(),
                )
            })?
            .to_string();
        let filter = self
            .filters
            .select(&request.source_path, request.filter_id.as_deref())
            .map_err(EngineError::CorpusImport)?;
        let descriptor = filter.descriptor();
        let staging_id = translunar_domain::new_id();
        let extension = request
            .source_path
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or("source");
        let managed_source_path = self
            .store
            .paths()
            .managed_source(&format!("reference-corpus-{staging_id}"), extension);
        let mut temporary = tempfile::Builder::new()
            .prefix("reference-corpus-import-")
            .suffix(&format!(".{extension}"))
            .tempfile_in(&self.store.paths().temporary)?;
        let input_sha256 = copy_and_hash(&request.source_path, temporary.as_file_mut())?;
        temporary.as_file().sync_all()?;
        let filter_source_locale = match request.kind {
            ReferenceCorpusKind::MonolingualTarget => request.target_locale.clone(),
            ReferenceCorpusKind::MonolingualSource | ReferenceCorpusKind::Bilingual => {
                request.source_locale.clone()
            }
        };
        let stream = filter
            .import(ImportRequest {
                source: temporary.path().to_path_buf(),
                document_id: Some(format!("reference-corpus-{staging_id}")),
                source_locale: Some(filter_source_locale.clone()),
                options: request.options.clone(),
            })
            .map_err(EngineError::CorpusImport)?;
        let imported = collect_imported_document(stream).map_err(EngineError::CorpusImport)?;
        validate_reference_corpus_filter_locales(
            &imported,
            request.kind,
            &filter_source_locale,
            &request.target_locale,
        )?;
        let options_sha256 = sha256_hex(&serde_json::to_vec(&request.options)?);
        let entries = reference_corpus_entries_from_import(
            &imported,
            request.kind,
            &descriptor.id,
            &input_sha256,
            &input_file_name,
            &options_sha256,
        )?;
        let diagnostics = reference_corpus_import_diagnostics(&imported);
        let input_format = imported.metadata.format;
        temporary
            .persist_noclobber(&managed_source_path)
            .map_err(|error| EngineError::Io(error.error))?;
        Ok(NewReferenceCorpus {
            project_id: project.id.clone(),
            expected_project_revision: request.expected_project_revision,
            name: request.name,
            kind: request.kind,
            source_locale: request.source_locale,
            target_locale: request.target_locale,
            managed_source_path,
            input_filter_id: descriptor.id,
            input_format,
            input_sha256,
            entries,
            diagnostics,
            actor: request.actor,
            reason: request.reason,
            correlation_id: request.correlation_id,
        })
    }

    fn prepare_document_import(
        &self,
        project_id: &str,
        source_locale: &str,
        source_path: PathBuf,
        relative_path: String,
        filter_id: Option<&str>,
        options: &BTreeMap<String, String>,
    ) -> Result<PreparedDocumentImport> {
        let name = Path::new(&relative_path)
            .file_name()
            .and_then(|value| value.to_str())
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| {
                EngineError::InvalidRequest("relativePath must name a file".to_string())
            })?
            .to_string();
        let filter = self
            .filters
            .select(&source_path, filter_id)
            .map_err(EngineError::Import)?;
        let descriptor = filter.descriptor();
        let document_id = translunar_domain::new_id();
        let extension = source_path
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or("source");
        let managed_source_path = self.store.paths().managed_source(&document_id, extension);
        let mut temporary = tempfile::Builder::new()
            .prefix("import-")
            .suffix(&format!(".{extension}"))
            .tempfile_in(&self.store.paths().temporary)?;
        let source_sha256 = copy_and_hash(&source_path, temporary.as_file_mut())?;
        temporary.as_file().sync_all()?;
        let stream = filter
            .import(ImportRequest {
                source: temporary.path().to_path_buf(),
                document_id: Some(document_id.clone()),
                source_locale: Some(source_locale.to_string()),
                options: options.clone(),
            })
            .map_err(EngineError::Import)?;
        let imported = collect_imported_document(stream).map_err(EngineError::Import)?;
        if imported.units.is_empty() && descriptor.id != "builtin.pdf" {
            return Err(EngineError::Import(FilterError::Invalid(
                "document contains no translatable units".to_string(),
            )));
        }
        temporary
            .persist_noclobber(&managed_source_path)
            .map_err(|error| EngineError::Io(error.error))?;
        Ok(PreparedDocumentImport {
            input: NewDocument {
                id: document_id,
                project_id: project_id.to_string(),
                name,
                relative_path,
                format: imported.metadata.format,
                filter_id: descriptor.id.clone(),
                source_sha256,
                degradation: imported.degradation,
                original_source_path: source_path,
                managed_source_path,
            },
            units: imported.units,
        })
    }

    fn import_batch_atomically(
        &mut self,
        project_id: &str,
        source_locale: &str,
        filter_id: Option<&str>,
        options: &BTreeMap<String, String>,
        selections: Vec<BatchSelection>,
    ) -> Result<Vec<BatchImportDiagnostic>> {
        let mut diagnostics = Vec::with_capacity(selections.len());
        let mut ready = Vec::new();
        for (index, selection) in selections.into_iter().enumerate() {
            match selection {
                BatchSelection::Failed(diagnostic) => diagnostics.push(Some(*diagnostic)),
                BatchSelection::Candidate {
                    path,
                    display,
                    relative,
                } => match self.prepare_document_import(
                    project_id,
                    source_locale,
                    path,
                    relative.clone(),
                    filter_id,
                    options,
                ) {
                    Ok(prepared) => {
                        diagnostics.push(None);
                        ready.push((index, display, relative, prepared));
                    }
                    Err(error) => {
                        let error = self.handle_plugin_filter_failure(error);
                        diagnostics.push(Some(BatchImportDiagnostic {
                            path: display,
                            relative_path: relative,
                            status: "failed".to_string(),
                            document: None,
                            error_code: Some(engine_error_code(&error).to_string()),
                            message: Some(error.to_string()),
                        }));
                    }
                },
            }
        }
        if diagnostics.iter().any(Option::is_some) {
            for (_, _, _, prepared) in &ready {
                let _ = fs::remove_file(&prepared.input.managed_source_path);
            }
            for (index, display, relative, _) in ready {
                diagnostics[index] = Some(BatchImportDiagnostic {
                    path: display,
                    relative_path: relative,
                    status: "failed".to_string(),
                    document: None,
                    error_code: Some("atomic_batch_aborted".to_string()),
                    message: Some(
                        "atomic batch was rolled back because another file failed".to_string(),
                    ),
                });
            }
            return Ok(diagnostics
                .into_iter()
                .map(|diagnostic| diagnostic.expect("atomic batch diagnostic"))
                .collect());
        }
        let mut inputs = Vec::with_capacity(ready.len());
        for (_, _, _, prepared) in &ready {
            inputs.push((&prepared.input, prepared.units.as_slice()));
        }
        let documents = match self.store.insert_documents_atomic(&inputs) {
            Ok(documents) => documents,
            Err(error) => {
                for (_, _, _, prepared) in &ready {
                    let _ = fs::remove_file(&prepared.input.managed_source_path);
                }
                let error = EngineError::from(error);
                let code = engine_error_code(&error).to_string();
                let message = error.to_string();
                return Ok(ready
                    .into_iter()
                    .map(|(_, display, relative, _)| BatchImportDiagnostic {
                        path: display,
                        relative_path: relative,
                        status: "failed".to_string(),
                        document: None,
                        error_code: Some(code.clone()),
                        message: Some(message.clone()),
                    })
                    .collect());
            }
        };
        for ((index, display, relative, prepared), document) in ready.into_iter().zip(documents) {
            diagnostics[index] = Some(BatchImportDiagnostic {
                path: display,
                relative_path: relative,
                status: "succeeded".to_string(),
                document: Some(document),
                error_code: None,
                message: None,
            });
            // The managed source is now owned by the committed document.
            let _ = prepared;
        }
        Ok(diagnostics
            .into_iter()
            .map(|diagnostic| diagnostic.expect("atomic batch diagnostic"))
            .collect())
    }

    pub fn preview_document_reimport(
        &mut self,
        params: DocumentReimportPreviewParams,
    ) -> Result<DocumentReimportPreviewResult> {
        validate_filter_options(&params.options)?;
        let managed = self.store.get_document(&params.document_id)?;
        if managed.document.revision != params.expected_revision {
            return Err(StorageError::EntityConflict {
                entity: "document",
                id: params.document_id,
                expected_revision: params.expected_revision,
                actual_revision: managed.document.revision,
            }
            .into());
        }
        let project = self.store.get_project(&managed.document.project_id)?;
        let source_path = PathBuf::from(&params.source_path);
        if !source_path.is_file() {
            return Err(EngineError::InvalidRequest(format!(
                "source document does not exist: {}",
                source_path.display()
            )));
        }
        let filter = match self
            .filters
            .select(&source_path, Some(&managed.document.filter_id))
        {
            Ok(filter) => filter,
            Err(error) => {
                return Err(self.handle_plugin_filter_failure(EngineError::Import(error)));
            }
        };
        let extension = source_path
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or("source");
        let staged_name = format!(
            "{}-reimport-{}",
            managed.document.id,
            translunar_domain::new_id()
        );
        let staged_path = self.store.paths().managed_source(&staged_name, extension);
        let mut temporary = tempfile::Builder::new()
            .prefix("reimport-")
            .suffix(&format!(".{extension}"))
            .tempfile_in(&self.store.paths().temporary)?;
        let source_sha256 = copy_and_hash(&source_path, temporary.as_file_mut())?;
        temporary.as_file().sync_all()?;
        let stream = match filter.import(ImportRequest {
            source: temporary.path().to_path_buf(),
            document_id: Some(managed.document.id.clone()),
            source_locale: Some(project.project.source_locale),
            options: params.options.clone(),
        }) {
            Ok(stream) => stream,
            Err(error) => {
                return Err(self.handle_plugin_filter_failure(EngineError::Import(error)));
            }
        };
        let imported = match collect_imported_document(stream) {
            Ok(imported) => imported,
            Err(error) => {
                return Err(self.handle_plugin_filter_failure(EngineError::Import(error)));
            }
        };
        if imported.units.is_empty() {
            return Err(EngineError::Import(FilterError::Invalid(
                "re-import candidate contains no translatable units".to_string(),
            )));
        }
        temporary
            .persist_noclobber(&staged_path)
            .map_err(|error| EngineError::Io(error.error))?;
        let staged_relative_path = staged_path
            .strip_prefix(&self.store.paths().root)
            .map_err(|_| {
                EngineError::InvalidState(
                    "re-import staging path escaped the workspace".to_string(),
                )
            })?
            .to_string_lossy()
            .replace('\\', "/");
        let result = self.store.create_reimport_preview(NewReimportPreview {
            document_id: managed.document.id,
            expected_document_revision: params.expected_revision,
            candidate_source_sha256: source_sha256,
            original_source_path: source_path.to_string_lossy().into_owned(),
            staged_source_path: staged_relative_path,
            filter_id: managed.document.filter_id,
            options: params.options,
            actor: params.actor,
            units: imported.units,
        });
        match result {
            Ok(preview) => Ok(protocol_reimport_preview(preview)),
            Err(error) => {
                let _ = fs::remove_file(staged_path);
                Err(error.into())
            }
        }
    }

    pub fn apply_document_reimport(
        &mut self,
        params: DocumentReimportApplyParams,
    ) -> Result<Document> {
        self.store
            .apply_reimport_preview(
                &params.preview_id,
                params.expected_document_revision,
                &params.actor,
            )
            .map_err(Into::into)
    }

    pub fn list_segments(&self, params: SegmentListParams) -> Result<SegmentPage> {
        let limit = params.limit.clamp(1, 1_000);
        let (items, total) = self
            .store
            .list_segments(&params.document_id, params.offset, limit)?;
        Ok(SegmentPage {
            items,
            total,
            offset: params.offset,
            limit,
        })
    }

    pub fn list_editor_segments(
        &self,
        params: EditorSegmentListParams,
    ) -> Result<EditorSegmentPage> {
        let limit = bounded_page_size(params.limit)?;
        let (items, total) = self.store.list_editor_rows(&StorageEditorListRequest {
            document_id: params.document_id,
            query: params.query,
            field: storage_editor_field(params.field),
            filter: storage_editor_filter(params.filter),
            sort: storage_editor_sort(params.sort),
            descending: params.descending,
            offset: params.offset,
            limit,
            include_context: params.include_context,
        })?;
        Ok(EditorSegmentPage {
            items,
            total,
            offset: params.offset,
            limit,
        })
    }

    pub fn set_segment_tags(
        &mut self,
        params: SetSegmentTagsParams,
    ) -> Result<EditorMutationResult> {
        Ok(editor_mutation_result(self.store.set_target_tags(
            &params.segment_id,
            &params.target_tags,
            params.expected_revision,
        )?))
    }

    pub fn convert_segment_chinese(
        &mut self,
        params: ConvertSegmentChineseParams,
    ) -> Result<EditorMutationResult> {
        Ok(editor_mutation_result(self.store.convert_chinese_target(
            &params.segment_id,
            params.profile,
            params.expected_revision,
        )?))
    }

    pub fn propagate_segment(
        &mut self,
        params: PropagateSegmentParams,
    ) -> Result<EditorMutationResult> {
        Ok(editor_mutation_result(self.store.propagate_segment(
            &params.segment_id,
            params.expected_revision,
        )?))
    }

    pub fn find_segments(&self, params: FindSegmentsParams) -> Result<SegmentFindResult> {
        let limit = bounded_page_size(params.limit)?;
        let options = SearchOptions {
            regex: params.regex,
            case_sensitive: params.case_sensitive,
            whole_word: params.whole_word,
        };
        let (matches, total) = self.store.find_editor_matches(
            &params.document_id,
            &params.query,
            storage_editor_field(params.field),
            options,
            params.offset,
            limit,
        )?;
        Ok(SegmentFindResult {
            matches: matches
                .into_iter()
                .map(|item| SegmentFindMatch {
                    segment_id: item.segment_id,
                    field: protocol_editor_field(item.field),
                    start: item.start,
                    end: item.end,
                    matched_text: item.matched_text,
                    revision: item.revision,
                })
                .collect(),
            total,
            offset: params.offset,
            limit,
        })
    }

    pub fn preview_replace(&self, params: ReplacePreviewParams) -> Result<ReplacePreviewResult> {
        let preview = self.store.preview_replace(&StorageReplaceRequest {
            document_id: params.document_id,
            query: params.query,
            replacement: params.replacement,
            field: storage_editor_field(params.field),
            options: SearchOptions {
                regex: params.regex,
                case_sensitive: params.case_sensitive,
                whole_word: params.whole_word,
            },
        })?;
        let changed_segments = preview
            .items
            .iter()
            .map(|item| item.segment_id.as_str())
            .collect::<BTreeSet<_>>()
            .len();
        let replacement_count = preview
            .items
            .iter()
            .fold(0_u32, |total, item| total.saturating_add(item.replacements));
        Ok(ReplacePreviewResult {
            token: preview.token,
            document_id: preview.document_id,
            items: preview
                .items
                .into_iter()
                .map(|item| ReplacePreviewItem {
                    segment_id: item.segment_id,
                    revision: item.revision,
                    field: protocol_editor_field(item.field),
                    before: item.before,
                    after: item.after,
                    replacements: item.replacements,
                })
                .collect(),
            changed_segments: u32::try_from(changed_segments).unwrap_or(u32::MAX),
            replacement_count,
        })
    }

    pub fn apply_replace(&mut self, params: ReplaceApplyParams) -> Result<EditorMutationResult> {
        let preview = StorageReplacePreview {
            token: params.preview.token,
            document_id: params.preview.document_id,
            items: params
                .preview
                .items
                .into_iter()
                .map(|item| StorageReplaceItem {
                    segment_id: item.segment_id,
                    revision: item.revision,
                    field: storage_editor_field(item.field),
                    before: item.before,
                    after: item.after,
                    replacements: item.replacements,
                })
                .collect(),
        };
        Ok(editor_mutation_result(
            self.store.apply_replace_preview(&preview)?,
        ))
    }

    pub fn split_segment(&mut self, params: SplitSegmentParams) -> Result<EditorMutationResult> {
        Ok(editor_mutation_result(self.store.split_segment(
            &params.segment_id,
            params.source_offset,
            params.target_offset,
            params.expected_revision,
        )?))
    }

    pub fn merge_segments(&mut self, params: MergeSegmentsParams) -> Result<EditorMutationResult> {
        Ok(editor_mutation_result(self.store.merge_segments(
            &params.first_segment_id,
            &params.second_segment_id,
            params.first_expected_revision,
            params.second_expected_revision,
        )?))
    }

    pub fn correct_source(&mut self, params: CorrectSourceParams) -> Result<EditorMutationResult> {
        Ok(editor_mutation_result(
            self.store.generic_source_correction(
                &params.segment_id,
                &params.source_text,
                &params.reason,
                params.expected_revision,
            )?,
        ))
    }

    pub fn list_segment_comments(
        &self,
        params: SegmentCommentListParams,
    ) -> Result<SegmentCommentListResult> {
        Ok(SegmentCommentListResult {
            comments: self
                .store
                .list_editor_comments(&params.segment_id, params.include_resolved)?,
        })
    }

    pub fn create_segment_comment(
        &mut self,
        params: CreateSegmentCommentParams,
    ) -> Result<translunar_domain::EditorComment> {
        Ok(self
            .store
            .create_editor_comment(&params.segment_id, &params.author, &params.text)?)
    }

    pub fn update_segment_comment(
        &mut self,
        params: UpdateSegmentCommentParams,
    ) -> Result<translunar_domain::EditorComment> {
        Ok(self.store.update_editor_comment(
            &params.comment_id,
            &params.text,
            params.expected_revision,
        )?)
    }

    pub fn resolve_segment_comment(
        &mut self,
        params: ResolveSegmentCommentParams,
    ) -> Result<translunar_domain::EditorComment> {
        Ok(self.store.resolve_editor_comment(
            &params.comment_id,
            params.resolved,
            params.expected_revision,
        )?)
    }

    pub fn delete_segment_comment(
        &mut self,
        params: DeleteSegmentCommentParams,
    ) -> Result<EmptyResult> {
        self.store
            .delete_editor_comment(&params.comment_id, params.expected_revision)?;
        Ok(EmptyResult {})
    }

    pub fn spell_check(&self, params: SpellCheckParams) -> Result<SpellCheckResult> {
        let limit = bounded_page_size(params.limit)? as usize;
        if params.text.len() > 65_536 {
            return Err(EngineError::InvalidRequest(
                "spell-check text must be at most 65536 bytes".to_string(),
            ));
        }
        let words = self
            .store
            .list_dictionary_words(&params.locale)?
            .into_iter()
            .map(|word| normalize_dictionary_word(&word))
            .collect::<BTreeSet<_>>();
        let (available, provider, mut findings) = if let Some((provider, findings)) =
            run_hunspell(&params.locale, &params.text, &words, limit)
        {
            (true, provider, findings)
        } else {
            (
                false,
                "builtin-fallback".to_string(),
                check_user_dictionary(&params.text, &words, limit),
            )
        };
        if findings.len() < limit {
            findings.extend(cjk_assistance(&params.text, limit - findings.len()));
        }
        Ok(SpellCheckResult {
            available,
            provider,
            findings,
        })
    }

    pub fn list_dictionary(&self, params: DictionaryListParams) -> Result<DictionaryListResult> {
        Ok(DictionaryListResult {
            words: self.store.list_dictionary_words(&params.locale)?,
            locale: params.locale,
        })
    }

    pub fn add_dictionary_word(
        &mut self,
        params: DictionaryWordParams,
    ) -> Result<DictionaryListResult> {
        Ok(DictionaryListResult {
            words: self
                .store
                .add_dictionary_word(&params.locale, &params.word)?,
            locale: params.locale,
        })
    }

    pub fn remove_dictionary_word(
        &mut self,
        params: DictionaryWordParams,
    ) -> Result<DictionaryListResult> {
        Ok(DictionaryListResult {
            words: self
                .store
                .remove_dictionary_word(&params.locale, &params.word)?,
            locale: params.locale,
        })
    }

    pub fn editor_history(&self, params: EditorHistoryParams) -> Result<EditorHistoryResult> {
        let limit = bounded_page_size(params.limit)?;
        let (operations, total, can_undo, can_redo) =
            self.store
                .editor_history(&params.project_id, params.offset, limit)?;
        Ok(EditorHistoryResult {
            operations,
            total,
            can_undo,
            can_redo,
        })
    }

    pub fn undo_editor(&mut self, params: EditorUndoRedoParams) -> Result<EditorMutationResult> {
        Ok(editor_mutation_result(
            self.store.undo_editor(&params.project_id)?,
        ))
    }

    pub fn redo_editor(&mut self, params: EditorUndoRedoParams) -> Result<EditorMutationResult> {
        Ok(editor_mutation_result(
            self.store.redo_editor(&params.project_id)?,
        ))
    }

    pub fn create_review(
        &mut self,
        params: ReviewCreateParams,
    ) -> Result<translunar_domain::ReviewRevision> {
        Ok(self.store.create_review_revision(&ReviewProposal {
            segment_id: &params.segment_id,
            proposed_target: params.proposed_target.as_deref(),
            proposed_source: params.proposed_source.as_deref(),
            proposed_target_tags: params.proposed_target_tags.as_deref(),
            author: &params.author,
            reason: &params.reason,
            expected_revision: params.expected_revision,
        })?)
    }

    pub fn set_editor_workflow(
        &mut self,
        params: SetEditorWorkflowParams,
    ) -> Result<EditorMutationResult> {
        let actor = params.actor.as_deref().unwrap_or("desktop");
        Ok(editor_mutation_result(
            self.store.set_editor_workflow_with_context(
                &params.segment_id,
                params.state,
                params.expected_revision,
                actor,
                params.reason.as_deref(),
            )?,
        ))
    }

    pub fn list_reviews(&self, params: ReviewListParams) -> Result<ReviewListResult> {
        Ok(ReviewListResult {
            revisions: self
                .store
                .list_review_revisions(&params.document_id, params.include_closed)?,
        })
    }

    pub fn accept_review(&mut self, params: ReviewDecisionParams) -> Result<EditorMutationResult> {
        Ok(editor_mutation_result(self.store.accept_review(
            &params.review_id,
            params.expected_segment_revision,
        )?))
    }

    pub fn reject_review(
        &mut self,
        params: ReviewDecisionParams,
    ) -> Result<translunar_domain::ReviewRevision> {
        Ok(self
            .store
            .reject_review(&params.review_id, params.expected_segment_revision)?)
    }

    pub fn get_editor_preferences(&self, _params: EmptyParams) -> Result<EditorPreferences> {
        self.store.get_editor_preferences().map_err(Into::into)
    }

    pub fn update_editor_preferences(
        &mut self,
        params: UpdateEditorPreferencesParams,
    ) -> Result<EditorPreferences> {
        self.store
            .update_editor_preferences(&params.preferences)
            .map_err(Into::into)
    }

    pub fn list_pdf_pages(&self, params: PdfPageListParams) -> Result<PdfPageListResult> {
        let document = self.store.get_document(&params.document_id)?;
        if document.document.filter_id != "builtin.pdf" {
            return Err(EngineError::InvalidRequest(
                "pdf.page.list requires a PDF document".to_string(),
            ));
        }
        let segments = collapse_structural_segments(self.store.all_segments(&params.document_id)?)?;
        let mut counts = BTreeMap::<u32, (u32, u32, Vec<String>)>::new();
        for segment in &segments {
            let path = PdfPath::decode(&segment.structural_path)
                .map_err(|error| EngineError::InvalidState(error.to_string()))?;
            let count = counts.entry(path.page).or_default();
            count.0 = count
                .0
                .checked_add(1)
                .ok_or_else(|| EngineError::InvalidState("PDF block count overflow".to_string()))?;
            if path.source_kind == "ocr" {
                count.1 = count.1.checked_add(1).ok_or_else(|| {
                    EngineError::InvalidState("PDF OCR block count overflow".to_string())
                })?;
            }
            count.2.push(segment.id.clone());
        }
        let layouts = PdfFilter
            .page_layouts(&ImportRequest::new(document.managed_source_path.clone()))
            .map_err(map_pdf_service_error)?;
        Ok(PdfPageListResult {
            pages: layouts
                .into_iter()
                .map(|layout| {
                    let (block_count, ocr_block_count, segment_ids) = counts
                        .get(&layout.summary.page)
                        .cloned()
                        .unwrap_or_default();
                    PdfPageSummary {
                        page: layout.summary.page,
                        width: layout.summary.width,
                        height: layout.summary.height,
                        block_count,
                        ocr_block_count,
                        segment_ids,
                    }
                })
                .collect(),
        })
    }

    pub fn get_pdf_page(&self, params: PdfPageGetParams) -> Result<PdfPageDetail> {
        if !(72..=200).contains(&params.dpi) {
            return Err(EngineError::InvalidRequest(
                "PDF page DPI must be between 72 and 200".to_string(),
            ));
        }
        let document = self.store.get_document(&params.document_id)?;
        if document.document.filter_id != "builtin.pdf" {
            return Err(EngineError::InvalidRequest(
                "pdf.page.get requires a PDF document".to_string(),
            ));
        }
        let layouts = PdfFilter
            .page_layouts(&ImportRequest::new(document.managed_source_path.clone()))
            .map_err(map_pdf_service_error)?;
        let layout = layouts
            .into_iter()
            .find(|layout| layout.summary.page == params.page)
            .ok_or_else(|| {
                EngineError::Storage(StorageError::NotFound {
                    entity: "pdf_page",
                    id: params.page.to_string(),
                })
            })?;
        let temporary = tempfile::Builder::new()
            .prefix("pdf-preview-")
            .suffix(".png")
            .tempfile_in(&self.store.paths().temporary)?;
        let path = temporary.path().to_path_buf();
        drop(temporary);
        PdfFilter
            .render_page(
                &document.managed_source_path,
                params.page,
                params.dpi,
                &path,
            )
            .map_err(map_pdf_service_error)?;
        let image = std::fs::read(&path);
        let _ = std::fs::remove_file(&path);
        let image = image?;
        if image.len() > 32 * 1024 * 1024 {
            return Err(EngineError::InvalidState(
                "rendered PDF page exceeds the 32 MiB limit".to_string(),
            ));
        }
        let mut blocks = self
            .store
            .all_segments(&params.document_id)?
            .into_iter()
            .filter_map(|segment| {
                let path = PdfPath::decode(&segment.structural_path).ok()?;
                (path.page == params.page).then_some((path, segment))
            })
            .collect::<Vec<_>>();
        blocks.sort_by_key(|(path, _)| path.order);
        Ok(PdfPageDetail {
            page: params.page,
            width: layout.summary.width,
            height: layout.summary.height,
            dpi: params.dpi,
            image_png_base64: base64::engine::general_purpose::STANDARD.encode(image),
            blocks: blocks
                .into_iter()
                .map(|(path, segment)| PdfPageBlock {
                    segment_id: segment.id,
                    revision: segment.revision,
                    source_text: segment.source_text,
                    target_text: segment.target_text,
                    state: segment.state,
                    bbox: PdfBoundingBox {
                        x: path.x as f64 / 1000.0,
                        y: path.y as f64 / 1000.0,
                        width: path.width as f64 / 1000.0,
                        height: path.height as f64 / 1000.0,
                    },
                    kind: path.kind,
                    source_kind: path.source_kind,
                    confidence: path.confidence,
                })
                .collect(),
        })
    }

    pub fn correct_ocr(&mut self, params: CorrectOcrParams) -> Result<Segment> {
        self.store
            .correct_ocr_source(
                &params.segment_id,
                &params.source_text,
                &params.reason,
                params.expected_revision,
            )
            .map_err(Into::into)
    }

    pub fn update_target(&mut self, params: UpdateTargetParams) -> Result<Segment> {
        let segment = self.store.update_target(
            &params.segment_id,
            &params.target_text,
            params.expected_revision,
        )?;
        if segment.revision != params.expected_revision {
            self.refresh_live_plugin_qa(&segment.document_id);
        }
        Ok(segment)
    }

    pub fn confirm_segment(
        &mut self,
        params: ConfirmSegmentParams,
    ) -> Result<ConfirmSegmentResult> {
        let confirmation = self
            .store
            .confirm_segment(&params.segment_id, params.expected_revision)?;
        let document_ids = std::iter::once(confirmation.segment.document_id.as_str())
            .chain(
                confirmation
                    .propagated
                    .iter()
                    .map(|segment| segment.document_id.as_str()),
            )
            .map(str::to_string)
            .collect::<BTreeSet<_>>();
        for document_id in document_ids {
            self.refresh_live_plugin_qa(&document_id);
        }
        Ok(ConfirmSegmentResult {
            segment: confirmation.segment,
            counts: confirmation.counts,
            tm_entry: confirmation.tm_entry,
            qa_issues: confirmation.qa_issues,
            propagated: confirmation.propagated,
        })
    }

    fn refresh_live_plugin_qa(&mut self, document_id: &str) {
        if self.plugin_qa_registry.snapshots().is_empty() {
            return;
        }
        let project_id = match self.store.get_document(document_id) {
            Ok(document) => document.document.project_id,
            Err(error) => {
                tracing::warn!(document_id, error = %error, "live plugin QA document lookup failed");
                return;
            }
        };
        if let Err(error) = self.execute_qa_run(&project_id, Some(document_id), None) {
            tracing::warn!(
                project_id,
                document_id,
                error = %error,
                "live plugin QA refresh failed after a committed segment mutation"
            );
        }
    }

    pub fn lookup_exact(&self, params: ExactLookupParams) -> Result<ExactLookupResult> {
        Ok(ExactLookupResult {
            matches: self
                .store
                .lookup_exact(&params.project_id, &params.source_text)?,
        })
    }

    pub fn list_tm_libraries(&self, params: TmLibraryListParams) -> Result<TmLibraryPage> {
        let limit = bounded_page_size(params.limit)?;
        let (items, total) =
            self.store
                .list_tm_libraries(params.project_id.as_deref(), params.offset, limit)?;
        let mounts = params
            .project_id
            .as_deref()
            .map(|project_id| self.store.list_tm_library_mounts(project_id))
            .transpose()?
            .unwrap_or_default();
        Ok(TmLibraryPage {
            items,
            mounts,
            total,
            offset: params.offset,
            limit,
        })
    }

    pub fn create_tm_library(
        &mut self,
        params: TmLibraryCreateParams,
    ) -> Result<translunar_asset_core::TmLibrary> {
        Ok(self.store.create_tm_library(NewTmLibrary {
            name: params.name,
            source_locale: params.source_locale,
            target_locale: params.target_locale,
            domain: params.domain,
            writable: params.writable,
            owner_project_id: params.owner_project_id,
        })?)
    }

    pub fn mount_tm_library(
        &mut self,
        params: TmLibraryMountParams,
    ) -> Result<translunar_asset_core::TmLibraryMount> {
        Ok(self.store.mount_tm_library(
            &params.project_id,
            &params.library_id,
            params.mode,
            params.priority,
            params.enabled,
            params.expected_revision,
        )?)
    }

    pub fn unmount_tm_library(&mut self, params: TmLibraryUnmountParams) -> Result<EmptyResult> {
        self.store.unmount_tm_library(
            &params.project_id,
            &params.library_id,
            params.expected_revision,
        )?;
        Ok(EmptyResult {})
    }

    pub fn search_tm(&self, params: TmSearchParams) -> Result<TmSearchResult> {
        let limit = bounded_page_size(params.limit)?;
        if params.threshold > 101 {
            return Err(EngineError::InvalidRequest(
                "threshold must be between 0 and 101".to_string(),
            ));
        }
        let (matches, total) = self.store.search_tm(&StorageTmSearchRequest {
            project_id: params.project_id,
            source_locale: params.source_locale,
            target_locale: params.target_locale,
            query: params.query,
            threshold: params.threshold,
            offset: params.offset,
            limit,
            library_ids: params.library_ids,
            domain: params.domain,
            since_ms: params.since_ms,
            origin_project_id: params.origin_project_id,
            origin_document_id: params.origin_document_id,
            context_before_hash: params.context_before_hash,
            context_after_hash: params.context_after_hash,
        })?;
        Ok(TmSearchResult {
            matches,
            total,
            offset: params.offset,
            limit,
        })
    }

    pub fn concordance(&self, params: ConcordanceParams) -> Result<ConcordanceResult> {
        let limit = bounded_page_size(params.limit)?;
        let (hits, total) = self.store.concordance(&StorageConcordanceRequest {
            project_id: params.project_id.clone(),
            query: params.query.clone(),
            side: params.side,
            offset: params.offset,
            limit,
        })?;
        let corpus =
            self.store
                .search_reference_corpora(&storage::ReferenceCorpusSearchRequest {
                    project_id: params.project_id,
                    query: params.query,
                    side: storage_reference_corpus_concordance_side(params.side),
                    corpus_ids: Vec::new(),
                    offset: params.offset,
                    limit,
                })?;
        let corpus = protocol_reference_corpus_search_result(corpus);
        Ok(ConcordanceResult {
            hits,
            total,
            corpus_hits: corpus.items,
            corpus_total: corpus.total,
            offset: params.offset,
            limit,
        })
    }

    pub fn import_tm(&mut self, params: TmImportParams) -> Result<TmImportResult> {
        let library = self.store.get_tm_library(&params.library_id)?;
        let bytes = read_asset_input(&params.source_path)?;
        let units = match params.format {
            AssetExchangeFormat::Tmx => translunar_asset_core::parse_tmx(
                BufReader::new(bytes.as_slice()),
                &params.source_locale,
                &params.target_locale,
            )?,
            AssetExchangeFormat::Csv => translunar_asset_core::parse_tm_csv(
                BufReader::new(bytes.as_slice()),
                &params.source_locale,
                &params.target_locale,
            )?,
            AssetExchangeFormat::Tsv => translunar_asset_core::parse_tm_tsv(
                BufReader::new(bytes.as_slice()),
                &params.source_locale,
                &params.target_locale,
            )?,
            AssetExchangeFormat::Tbx => {
                return Err(EngineError::InvalidRequest(
                    "TBX is a termbase format, not a translation-memory format".to_string(),
                ));
            }
        };
        if units.len() > 1_000_000 {
            return Err(EngineError::InvalidRequest(
                "asset import exceeds the 1,000,000-unit limit".to_string(),
            ));
        }
        let (inserted, skipped) = self.store.import_tm_units(&library.id, &units)?;
        Ok(TmImportResult {
            library_id: library.id,
            inserted,
            skipped,
            diagnostics: Vec::new(),
        })
    }

    pub fn export_tm(&self, params: TmExportParams) -> Result<TmExportResult> {
        let library = self.store.get_tm_library(&params.library_id)?;
        let units = self.store.export_tm_units(&library.id)?;
        let exchange = units.iter().map(tm_unit_to_exchange).collect::<Vec<_>>();
        let source_locale = library.source_locale.clone();
        let target_locale = library.target_locale.clone();
        let format = params.format;
        let output_path = PathBuf::from(&params.output_path);
        publish_asset_file(
            &output_path,
            |file| {
                match format {
                    AssetExchangeFormat::Tmx => translunar_asset_core::write_tmx(file, &exchange),
                    AssetExchangeFormat::Csv => {
                        translunar_asset_core::write_tm_csv(file, &exchange)
                    }
                    AssetExchangeFormat::Tsv => {
                        translunar_asset_core::write_tm_tsv(file, &exchange)
                    }
                    AssetExchangeFormat::Tbx => Err(AssetError::Invalid {
                        row: 0,
                        message: "TBX is a termbase format, not a translation-memory format"
                            .to_string(),
                    }),
                }
                .map_err(EngineError::from)
            },
            |path| {
                let bytes = std::fs::read(path)?;
                match format {
                    AssetExchangeFormat::Tmx => {
                        translunar_asset_core::parse_tmx(
                            BufReader::new(bytes.as_slice()),
                            &source_locale,
                            &target_locale,
                        )?;
                    }
                    AssetExchangeFormat::Csv => {
                        translunar_asset_core::parse_tm_csv(
                            BufReader::new(bytes.as_slice()),
                            &source_locale,
                            &target_locale,
                        )?;
                    }
                    AssetExchangeFormat::Tsv => {
                        translunar_asset_core::parse_tm_tsv(
                            BufReader::new(bytes.as_slice()),
                            &source_locale,
                            &target_locale,
                        )?;
                    }
                    AssetExchangeFormat::Tbx => {
                        return Err(EngineError::InvalidRequest(
                            "invalid TM export format".to_string(),
                        ));
                    }
                }
                Ok(())
            },
        )?;
        Ok(TmExportResult {
            library_id: library.id,
            output_path: output_path.to_string_lossy().into_owned(),
            unit_count: u32::try_from(exchange.len()).map_err(|_| {
                EngineError::InvalidState("TM export unit count overflow".to_string())
            })?,
        })
    }

    pub fn list_termbases(&self, params: TermbaseListParams) -> Result<TermbasePage> {
        let limit = bounded_page_size(params.limit)?;
        let (items, total) =
            self.store
                .list_termbases(Some(&params.project_id), params.offset, limit)?;
        let mounts = self.store.list_termbase_mounts(&params.project_id)?;
        Ok(TermbasePage {
            items,
            mounts,
            total,
            offset: params.offset,
            limit,
        })
    }

    pub fn create_termbase(
        &mut self,
        params: TermbaseCreateParams,
    ) -> Result<translunar_asset_core::Termbase> {
        Ok(self
            .store
            .create_termbase(translunar_storage::NewTermbase {
                name: params.name,
                source_locale: params.source_locale,
                domain: params.domain,
                writable: params.writable,
            })?)
    }

    pub fn mount_termbase(
        &mut self,
        params: TermbaseMountParams,
    ) -> Result<translunar_asset_core::TermbaseMount> {
        Ok(self.store.mount_termbase(
            &params.project_id,
            &params.termbase_id,
            params.priority,
            params.writable,
            params.enabled,
            params.expected_revision,
        )?)
    }

    pub fn unmount_termbase(&mut self, params: TermbaseUnmountParams) -> Result<EmptyResult> {
        self.store.unmount_termbase(
            &params.project_id,
            &params.termbase_id,
            params.expected_revision,
        )?;
        Ok(EmptyResult {})
    }

    pub fn search_terms(&self, params: TermSearchParams) -> Result<TermSearchResult> {
        let limit = bounded_page_size(params.limit)?;
        let (matches, total) = self.store.search_terms(&StorageTermSearchRequest {
            project_id: params.project_id,
            text: params.text,
            offset: params.offset,
            limit,
            termbase_ids: params.termbase_ids,
        })?;
        Ok(TermSearchResult {
            matches,
            total,
            offset: params.offset,
            limit,
        })
    }

    pub fn upsert_term(
        &mut self,
        params: TermUpsertParams,
    ) -> Result<translunar_asset_core::TermEntry> {
        let translations = params
            .translations
            .into_iter()
            .map(|translation| NewTermTranslation {
                locale: translation.locale,
                term: translation.term,
                preferred: translation.preferred,
                forbidden: translation.forbidden,
            })
            .collect();
        Ok(self.store.upsert_term_entry(NewTermEntry {
            termbase_id: params.termbase_id,
            source_locale: params.source_locale,
            source_term: params.source_term,
            part_of_speech: params.part_of_speech,
            definition: params.definition,
            example: params.example,
            domain: params.domain,
            status: params.status,
            translations,
        })?)
    }

    pub fn import_termbase(
        &mut self,
        params: TermbaseImportParams,
    ) -> Result<TermbaseImportResult> {
        let termbase = self.store.get_termbase(&params.termbase_id)?;
        let bytes = read_asset_input(&params.source_path)?;
        let entries = match params.format {
            AssetExchangeFormat::Tbx => translunar_asset_core::parse_tbx(
                BufReader::new(bytes.as_slice()),
                &params.source_locale,
                &params.target_locale,
            )?,
            AssetExchangeFormat::Csv => translunar_asset_core::parse_term_csv(
                BufReader::new(bytes.as_slice()),
                &params.source_locale,
                &params.target_locale,
            )?,
            AssetExchangeFormat::Tsv => translunar_asset_core::parse_term_tsv(
                BufReader::new(bytes.as_slice()),
                &params.source_locale,
                &params.target_locale,
            )?,
            AssetExchangeFormat::Tmx => {
                return Err(EngineError::InvalidRequest(
                    "TMX is a translation-memory format, not a termbase format".to_string(),
                ));
            }
        };
        if entries.len() > 1_000_000 {
            return Err(EngineError::InvalidRequest(
                "termbase import exceeds the 1,000,000-entry limit".to_string(),
            ));
        }
        let (inserted, skipped) = self.store.import_term_entries(&termbase.id, &entries)?;
        Ok(TermbaseImportResult {
            termbase_id: termbase.id,
            inserted,
            skipped,
            diagnostics: Vec::new(),
        })
    }

    pub fn export_termbase(&self, params: TermbaseExportParams) -> Result<TermbaseExportResult> {
        let termbase = self.store.get_termbase(&params.termbase_id)?;
        let entries = self.store.export_term_entries(&termbase.id)?;
        let exchange = entries
            .iter()
            .filter_map(|entry| term_entry_to_exchange(entry, &params.target_locale))
            .collect::<Vec<_>>();
        let source_locale = termbase.source_locale.clone();
        let target_locale = params.target_locale.clone();
        let format = params.format;
        let output_path = PathBuf::from(&params.output_path);
        publish_asset_file(
            &output_path,
            |file| {
                match format {
                    AssetExchangeFormat::Tbx => translunar_asset_core::write_tbx(file, &exchange),
                    AssetExchangeFormat::Csv => {
                        translunar_asset_core::write_term_csv(file, &exchange)
                    }
                    AssetExchangeFormat::Tsv => {
                        translunar_asset_core::write_term_tsv(file, &exchange)
                    }
                    AssetExchangeFormat::Tmx => Err(AssetError::Invalid {
                        row: 0,
                        message: "TMX is a translation-memory format, not a termbase format"
                            .to_string(),
                    }),
                }
                .map_err(EngineError::from)
            },
            |path| {
                let bytes = std::fs::read(path)?;
                match format {
                    AssetExchangeFormat::Tbx => {
                        translunar_asset_core::parse_tbx(
                            BufReader::new(bytes.as_slice()),
                            &source_locale,
                            &target_locale,
                        )?;
                    }
                    AssetExchangeFormat::Csv => {
                        translunar_asset_core::parse_term_csv(
                            BufReader::new(bytes.as_slice()),
                            &source_locale,
                            &target_locale,
                        )?;
                    }
                    AssetExchangeFormat::Tsv => {
                        translunar_asset_core::parse_term_tsv(
                            BufReader::new(bytes.as_slice()),
                            &source_locale,
                            &target_locale,
                        )?;
                    }
                    AssetExchangeFormat::Tmx => {
                        return Err(EngineError::InvalidRequest(
                            "invalid termbase export format".to_string(),
                        ));
                    }
                }
                Ok(())
            },
        )?;
        Ok(TermbaseExportResult {
            termbase_id: termbase.id,
            output_path: output_path.to_string_lossy().into_owned(),
            entry_count: u32::try_from(exchange.len()).map_err(|_| {
                EngineError::InvalidState("termbase export entry count overflow".to_string())
            })?,
        })
    }

    pub fn run_document_qa(&mut self, document_id: &str) -> Result<QaListResult> {
        let document = self.store.get_document(document_id)?;
        self.execute_qa_run(&document.document.project_id, Some(document_id), None)?;
        Ok(QaListResult {
            issues: self.store.list_qa(document_id, false)?,
        })
    }

    pub fn list_qa(&self, params: ListQaParams) -> Result<QaListResult> {
        Ok(QaListResult {
            issues: self
                .store
                .list_qa(&params.document_id, params.include_resolved)?,
        })
    }

    pub fn export_docx(&mut self, params: ExportDocxParams) -> Result<ExportDocxResult> {
        let result = self.export_document(ExportDocumentParams {
            document_id: params.document_id,
            output_path: params.output_path,
            qa_override: params.qa_override,
        })?;
        Ok(ExportDocxResult {
            output_path: result.output_path,
            translated_segments: result.translated_segments,
        })
    }

    pub fn export_review(&self, params: ReviewExportParams) -> Result<ReviewExportResult> {
        let document = self.review_document_binding(
            &params.project_id,
            &params.document_id,
            params.expected_document_revision,
        )?;
        let rows = self.load_all_editor_rows(&params.document_id)?;
        if rows.is_empty() {
            return Err(EngineError::InvalidRequest(
                "review export requires at least one segment".to_string(),
            ));
        }
        let export_rows = rows
            .iter()
            .map(|row| ReviewExportRow {
                row_id: translunar_domain::new_id(),
                segment_id: row.segment.id.clone(),
                segment_revision: row.segment.revision,
                ordinal: row.segment.ordinal,
                source_text: row.segment.source_text.clone(),
                target_text: row.segment.target_text.clone(),
                status: workflow_state_text(row.workflow_state).to_string(),
                comments: interop_comment_context(&row.comments),
            })
            .collect::<Vec<_>>();
        let result = export_review_docx(
            &ReviewExportInput {
                project_id: params.project_id,
                document_id: document.document.id,
                base_document_revision: params.expected_document_revision,
                rows: export_rows,
            },
            Path::new(&params.output_path),
        )
        .map_err(map_review_export_error)?;
        Ok(ReviewExportResult {
            output_path: result.output_path,
            row_count: result.row_count,
            manifest_hash: result.manifest_hash,
        })
    }

    pub fn preview_review(&mut self, params: ReviewPreviewParams) -> Result<ReviewPreviewResult> {
        let limit = bounded_page_size(params.limit)?;
        match (params.input_path.as_deref(), params.preview_id.as_deref()) {
            (Some(_), Some(_)) | (None, None) => Err(EngineError::InvalidRequest(
                "exactly one of inputPath or previewId is required".to_string(),
            )),
            (None, Some(preview_id)) => {
                let preview = self.store.get_interop_preview(preview_id)?;
                if preview.kind != InteropPreviewKind::Review
                    || preview.project_id != params.project_id
                    || preview.document_id.as_deref() != Some(params.document_id.as_str())
                {
                    return Err(EngineError::InvalidState(
                        "review preview does not match the requested project and document"
                            .to_string(),
                    ));
                }
                if preview.expected_revision != params.expected_document_revision {
                    return Err(StorageError::EntityConflict {
                        entity: "document",
                        id: params.document_id,
                        expected_revision: params.expected_document_revision,
                        actual_revision: preview.expected_revision,
                    }
                    .into());
                }
                protocol_review_preview_result(&self.store, preview, params.offset, limit)
            }
            (Some(input_path), None) => {
                let document = self.review_document_binding(
                    &params.project_id,
                    &params.document_id,
                    params.expected_document_revision,
                )?;
                let source_path = PathBuf::from(input_path);
                let extension = source_path
                    .extension()
                    .and_then(|value| value.to_str())
                    .unwrap_or("docx")
                    .to_ascii_lowercase();
                if extension != "docx" {
                    return Err(EngineError::InvalidRequest(
                        "review preview input must be a DOCX file".to_string(),
                    ));
                }
                let preview_id = translunar_domain::new_id();
                let staged = self.stage_interop_input(&source_path, &preview_id, &extension)?;
                let parsed = match parse_review_docx(&staged.path) {
                    Ok(parsed) => parsed,
                    Err(error) => {
                        let _ = fs::remove_file(&staged.path);
                        return Err(map_review_import_error(error));
                    }
                };
                if parsed.manifest.project_id != params.project_id
                    || parsed.manifest.document_id != params.document_id
                {
                    let _ = fs::remove_file(&staged.path);
                    return Err(EngineError::InvalidRequest(
                        "review manifest project or document binding is invalid".to_string(),
                    ));
                }
                if parsed.manifest.base_document_revision != params.expected_document_revision {
                    let _ = fs::remove_file(&staged.path);
                    return Err(StorageError::EntityConflict {
                        entity: "document",
                        id: params.document_id,
                        expected_revision: parsed.manifest.base_document_revision,
                        actual_revision: params.expected_document_revision,
                    }
                    .into());
                }
                let rows = match classify_review_rows(
                    &document.document,
                    &self.load_all_editor_rows(&document.document.id)?,
                    &parsed,
                ) {
                    Ok(rows) => rows,
                    Err(error) => {
                        let _ = fs::remove_file(&staged.path);
                        return Err(error);
                    }
                };
                let preview = self.store.create_interop_preview(NewInteropPreview {
                    id: preview_id,
                    kind: InteropPreviewKind::Review,
                    project_id: params.project_id,
                    document_id: Some(params.document_id),
                    library_id: None,
                    expected_revision: params.expected_document_revision,
                    input_sha256: staged.sha256,
                    input_format: "review-docx".to_string(),
                    staged_input_path: staged.relative_path,
                    source_locale: None,
                    target_locale: None,
                    manifest_hash: Some(parsed.manifest.manifest_hash),
                    rows,
                });
                let preview = match preview {
                    Ok(preview) => preview,
                    Err(error) => {
                        let _ = fs::remove_file(&staged.path);
                        return Err(error.into());
                    }
                };
                protocol_review_preview_result(&self.store, preview, params.offset, limit)
            }
        }
    }

    pub fn apply_review(&mut self, params: ReviewApplyParams) -> Result<InteropApplyResult> {
        let preview = self.store.get_interop_preview(&params.preview_id)?;
        let staged_path = self.resolve_staged_interop_path(&preview.staged_input_path)?;
        let result = self.store.apply_review_interop(ReviewInteropApply {
            preview_id: params.preview_id,
            expected_document_revision: params.expected_document_revision,
            selected_row_ids: params.selected_row_ids,
            actor: params.actor,
            reason: params.reason,
        })?;
        if result.status == "applied" {
            let _ = fs::remove_file(staged_path);
        }
        protocol_interop_apply_result(result)
    }

    pub fn preview_table(&mut self, params: TablePreviewParams) -> Result<TablePreviewResult> {
        let limit = bounded_page_size(params.limit)?;
        match (params.input_path.as_deref(), params.preview_id.as_deref()) {
            (Some(_), Some(_)) | (None, None) => Err(EngineError::InvalidRequest(
                "exactly one of inputPath or previewId is required".to_string(),
            )),
            (None, Some(preview_id)) => {
                let preview = self.store.get_interop_preview(preview_id)?;
                if preview.kind != InteropPreviewKind::Table
                    || preview.project_id != params.project_id
                    || preview.library_id.as_deref() != Some(params.library_id.as_str())
                {
                    return Err(EngineError::InvalidState(
                        "table preview does not match the requested project and library"
                            .to_string(),
                    ));
                }
                if preview.expected_revision != params.expected_library_revision {
                    return Err(StorageError::EntityConflict {
                        entity: "tm_library",
                        id: params.library_id,
                        expected_revision: params.expected_library_revision,
                        actual_revision: preview.expected_revision,
                    }
                    .into());
                }
                if preview.source_locale.as_deref() != Some(params.source_locale.as_str())
                    || preview.target_locale.as_deref() != Some(params.target_locale.as_str())
                {
                    return Err(EngineError::InvalidState(
                        "table preview locale binding does not match the request".to_string(),
                    ));
                }
                if let Some(format) = params.format
                    && table_format_id(format) != preview.input_format
                {
                    return Err(EngineError::InvalidRequest(
                        "table preview format does not match the staged input".to_string(),
                    ));
                }
                protocol_table_preview_result(&self.store, preview, params.offset, limit)
            }
            (Some(input_path), None) => {
                self.store.get_project(&params.project_id)?;
                let library = self.store.get_tm_library(&params.library_id)?;
                if library.revision != params.expected_library_revision {
                    return Err(StorageError::EntityConflict {
                        entity: "tm_library",
                        id: params.library_id,
                        expected_revision: params.expected_library_revision,
                        actual_revision: library.revision,
                    }
                    .into());
                }
                if !library.writable {
                    return Err(EngineError::InvalidState(
                        "table preview requires a writable TM library".to_string(),
                    ));
                }
                if library.source_locale != params.source_locale
                    || library.target_locale != params.target_locale
                {
                    return Err(EngineError::InvalidState(
                        "table preview locales do not match the TM library".to_string(),
                    ));
                }
                let source_path = PathBuf::from(input_path);
                let format = table_format_from_path(params.format, &source_path)?;
                let extension = match format {
                    BilingualTableFormat::Docx => "docx",
                    BilingualTableFormat::Xlsx => "xlsx",
                };
                let preview_id = translunar_domain::new_id();
                let staged = self.stage_interop_input(&source_path, &preview_id, extension)?;
                let table_rows = match extract_bilingual_rows(format, &staged.path) {
                    Ok(rows) => rows,
                    Err(error) => {
                        let _ = fs::remove_file(&staged.path);
                        return Err(error);
                    }
                };
                let rows = match classify_table_rows(
                    &self.store,
                    &library.id,
                    &params.project_id,
                    &staged.sha256,
                    format,
                    table_rows,
                ) {
                    Ok(rows) => rows,
                    Err(error) => {
                        let _ = fs::remove_file(&staged.path);
                        return Err(error);
                    }
                };
                let preview = self.store.create_interop_preview(NewInteropPreview {
                    id: preview_id,
                    kind: InteropPreviewKind::Table,
                    project_id: params.project_id,
                    document_id: None,
                    library_id: Some(params.library_id),
                    expected_revision: params.expected_library_revision,
                    input_sha256: staged.sha256,
                    input_format: table_format_id(format).to_string(),
                    staged_input_path: staged.relative_path,
                    source_locale: Some(params.source_locale),
                    target_locale: Some(params.target_locale),
                    manifest_hash: None,
                    rows,
                });
                let preview = match preview {
                    Ok(preview) => preview,
                    Err(error) => {
                        let _ = fs::remove_file(&staged.path);
                        return Err(error.into());
                    }
                };
                protocol_table_preview_result(&self.store, preview, params.offset, limit)
            }
        }
    }

    pub fn apply_table(&mut self, params: TableApplyParams) -> Result<InteropApplyResult> {
        let preview = self.store.get_interop_preview(&params.preview_id)?;
        let staged_path = self.resolve_staged_interop_path(&preview.staged_input_path)?;
        let result = self.store.apply_table_interop(TableInteropApply {
            preview_id: params.preview_id,
            expected_library_revision: params.expected_library_revision,
            selected_row_ids: params.selected_row_ids,
            actor: params.actor,
            reason: params.reason,
        })?;
        if result.status == "applied" {
            let _ = fs::remove_file(staged_path);
        }
        protocol_interop_apply_result(result)
    }

    fn review_document_binding(
        &self,
        project_id: &str,
        document_id: &str,
        expected_revision: u64,
    ) -> Result<ManagedDocument> {
        self.store.get_project(project_id)?;
        let document = self.store.get_document(document_id)?;
        if document.document.project_id != project_id {
            return Err(EngineError::InvalidState(
                "document does not belong to the requested project".to_string(),
            ));
        }
        if document.document.revision != expected_revision {
            return Err(StorageError::EntityConflict {
                entity: "document",
                id: document_id.to_string(),
                expected_revision,
                actual_revision: document.document.revision,
            }
            .into());
        }
        Ok(document)
    }

    fn load_all_editor_rows(&self, document_id: &str) -> Result<Vec<SegmentEditorRow>> {
        let (rows, total) = self.store.list_editor_rows(&StorageEditorListRequest {
            document_id: document_id.to_string(),
            query: String::new(),
            field: StorageEditorSearchField::Both,
            filter: StorageEditorFilter::All,
            sort: StorageEditorSort::Ordinal,
            descending: false,
            offset: 0,
            limit: 100_000,
            include_context: false,
        })?;
        let returned = u32::try_from(rows.len()).map_err(|_| {
            EngineError::InvalidState("interop editor row count overflow".to_string())
        })?;
        if total > returned {
            return Err(EngineError::InvalidState(
                "document exceeds the supported interop row limit".to_string(),
            ));
        }
        Ok(rows)
    }

    fn stage_interop_input(
        &self,
        source: &Path,
        preview_id: &str,
        extension: &str,
    ) -> Result<StagedInteropInput> {
        if !source.is_file() {
            return Err(EngineError::InvalidRequest(format!(
                "interop input does not exist: {}",
                source.display()
            )));
        }
        let extension = extension
            .trim()
            .trim_start_matches('.')
            .chars()
            .filter(|value| value.is_ascii_alphanumeric())
            .collect::<String>();
        let extension = if extension.is_empty() {
            "source".to_string()
        } else {
            extension
        };
        let destination = self
            .store
            .paths()
            .temporary
            .join(format!("interop-{preview_id}.{extension}"));
        let mut temporary = tempfile::Builder::new()
            .prefix("interop-stage-")
            .suffix(&format!(".{extension}"))
            .tempfile_in(&self.store.paths().temporary)?;
        let sha256 = copy_and_hash(source, temporary.as_file_mut())?;
        temporary.as_file().sync_all()?;
        temporary
            .persist_noclobber(&destination)
            .map_err(|error| EngineError::Io(error.error))?;
        let relative_path = destination
            .strip_prefix(&self.store.paths().root)
            .map_err(|_| {
                EngineError::InvalidState("interop staging path escaped the workspace".to_string())
            })?
            .to_string_lossy()
            .replace('\\', "/");
        Ok(StagedInteropInput {
            path: destination,
            relative_path,
            sha256,
        })
    }

    fn resolve_staged_interop_path(&self, relative_path: &str) -> Result<PathBuf> {
        let path = Path::new(relative_path);
        if path.is_absolute()
            || path
                .components()
                .any(|component| !matches!(component, Component::Normal(_)))
        {
            return Err(EngineError::InvalidState(
                "stored interop staging path is invalid".to_string(),
            ));
        }
        Ok(self.store.paths().root.join(path))
    }

    pub fn export_document(
        &mut self,
        params: ExportDocumentParams,
    ) -> Result<ExportDocumentResult> {
        let document = self.store.get_document(&params.document_id)?;
        let segments = self.store.all_segments(&params.document_id)?;
        let output_path = PathBuf::from(&params.output_path);
        let run = self.execute_qa_run(
            &document.document.project_id,
            Some(&params.document_id),
            None,
        )?;
        let gate = self.store.qa_gate_result(&params.document_id, run)?;
        let override_id = if gate.clear {
            if params.qa_override.is_some() {
                return Err(EngineError::InvalidRequest(
                    "a clear QA gate does not require an override".to_string(),
                ));
            }
            None
        } else if let Some(qa_override) = params.qa_override.as_ref() {
            let destination_name = output_path
                .file_name()
                .map(|name| name.to_string_lossy().into_owned())
                .unwrap_or_else(|| params.output_path.clone());
            Some(
                self.store
                    .create_qa_export_override(
                        &gate,
                        &document.document.project_id,
                        &qa_override.actor,
                        &qa_override.reason,
                        &destination_name,
                    )?
                    .id,
            )
        } else {
            return Err(EngineError::QaGateBlocked {
                document_id: gate.document_id,
                run_id: gate.run.id,
                blocker_issue_ids: gate.blocker_issue_ids,
                error_count: gate.error_count,
                warning_count: gate.warning_count,
                info_count: gate.info_count,
                waived_count: gate.waived_count,
            });
        };
        let filter = self
            .filters
            .resolve(&document.document.filter_id)
            .map_err(EngineError::Export)?;
        let report = match filter.export(ExportRequest {
            source: &document.managed_source_path,
            output: &output_path,
            segments: &segments,
        }) {
            Ok(report) => report,
            Err(error) => {
                if let Some(override_id) = override_id.as_deref() {
                    let _ = self.store.finish_qa_export_override(override_id, false);
                }
                return Err(self.handle_plugin_filter_failure(EngineError::Export(error)));
            }
        };
        if let Some(override_id) = override_id.as_deref() {
            self.store.finish_qa_export_override(override_id, true)?;
        }
        Ok(ExportDocumentResult {
            output_path: report.output_path,
            filter_id: document.document.filter_id,
            translated_segments: report.translated_segments,
            degradation: report.degradation,
        })
    }

    pub fn list_filters(&self, _params: EmptyParams) -> FilterListResult {
        FilterListResult {
            filters: self.filters.descriptors(),
        }
    }

    pub fn list_history(&self, params: HistoryListParams) -> Result<OperationPage> {
        let limit = bounded_page_size(params.limit)?;
        let (items, total) = self.store.list_operations(
            &params.project_id,
            params.offset,
            limit,
            params.descending,
        )?;
        Ok(OperationPage {
            items,
            total,
            offset: params.offset,
            limit,
        })
    }

    pub fn check_health(&self, _params: EmptyParams) -> Result<DataHealthReport> {
        Ok(self.store.check_health()?)
    }

    pub fn create_backup(&self, params: CreateBackupParams) -> Result<BackupResult> {
        if params.destination_path.trim().is_empty() {
            return Err(EngineError::InvalidRequest(
                "destinationPath must not be empty".to_string(),
            ));
        }
        let destination = PathBuf::from(&params.destination_path);
        let manifest = self.store.create_backup(&destination)?;
        Ok(BackupResult {
            destination_path: destination.to_string_lossy().into_owned(),
            manifest,
        })
    }

    pub fn pipeline_capabilities(&self) -> PipelineCapabilityResult {
        PipelineCapabilityResult {
            status_values: vec![
                translunar_pipeline::PipelineRunStatus::Queued,
                translunar_pipeline::PipelineRunStatus::Running,
                translunar_pipeline::PipelineRunStatus::Canceling,
                translunar_pipeline::PipelineRunStatus::Canceled,
                translunar_pipeline::PipelineRunStatus::Interrupted,
                translunar_pipeline::PipelineRunStatus::Succeeded,
                translunar_pipeline::PipelineRunStatus::Failed,
            ],
            steps: self.pipeline.descriptors(),
        }
    }

    pub fn validate_pipeline(&self, params: ValidatePipelineParams) -> PipelineValidationResult {
        self.pipeline.validate(params.name, params.steps)
    }

    pub fn create_pipeline(&mut self, params: CreatePipelineParams) -> Result<PipelineDefinition> {
        let validation = self
            .pipeline
            .validate(params.name.clone(), params.steps.clone());
        if !validation.valid {
            return Err(EngineError::InvalidRequest(validation.errors.join("; ")));
        }
        self.store
            .create_pipeline_definition(NewPipelineDefinition {
                project_id: params.project_id,
                name: params.name,
                steps: params.steps,
            })
            .map_err(Into::into)
    }

    pub fn list_pipelines(&self, params: PipelineListParams) -> Result<PipelineDefinitionPage> {
        let limit = bounded_page_size(params.limit)?;
        let (items, total) = self.store.list_pipeline_definitions(
            params.project_id.as_deref(),
            params.offset,
            limit,
        )?;
        Ok(PipelineDefinitionPage {
            items,
            total,
            offset: params.offset,
            limit,
        })
    }

    pub fn get_pipeline(&self, params: PipelineIdParams) -> Result<PipelineDefinition> {
        Ok(self.store.get_pipeline_definition(&params.pipeline_id)?)
    }

    pub fn run_pipeline(
        &mut self,
        params: RunPipelineParams,
    ) -> Result<ProtocolPipelineRunSnapshot> {
        let definition = self.store.get_pipeline_definition(&params.definition_id)?;
        self.pipeline
            .registry
            .validate_definition(&definition)
            .map_err(|error| EngineError::InvalidRequest(error.to_string()))?;
        let resolved = self.pipeline.resolve_new_run(&definition)?;
        let snapshot = self.store.create_pipeline_run_with_bindings(
            &params.definition_id,
            &params.project_id,
            params.document_id.as_deref(),
            params.input,
            &resolved.plugin_bindings,
        )?;
        let run_id = snapshot.run.id.clone();
        self.pipeline.spawn_resolved(run_id, resolved.steps)?;
        Ok(to_protocol_pipeline_snapshot(snapshot))
    }

    pub fn list_pipeline_runs(&self, params: PipelineRunListParams) -> Result<PipelineRunPage> {
        let limit = bounded_page_size(params.limit)?;
        let (items, total) =
            self.store
                .list_pipeline_runs(&params.project_id, params.offset, limit)?;
        Ok(PipelineRunPage {
            items,
            total,
            offset: params.offset,
            limit,
        })
    }

    pub fn get_pipeline_run(
        &self,
        params: PipelineRunIdParams,
    ) -> Result<ProtocolPipelineRunSnapshot> {
        Ok(to_protocol_pipeline_snapshot(
            self.store.get_pipeline_run(&params.run_id)?,
        ))
    }

    pub fn cancel_pipeline_run(
        &mut self,
        params: PipelineRunRevisionParams,
    ) -> Result<ProtocolPipelineRunSnapshot> {
        let snapshot = self
            .store
            .request_pipeline_cancel(&params.run_id, params.expected_revision)?;
        self.pipeline.cancel(&params.run_id);
        Ok(to_protocol_pipeline_snapshot(snapshot))
    }

    pub fn resume_pipeline_run(
        &mut self,
        params: PipelineRunRevisionParams,
    ) -> Result<ProtocolPipelineRunSnapshot> {
        let current = self.store.get_pipeline_run(&params.run_id)?;
        let definition = self
            .store
            .get_pipeline_definition(&current.run.definition_id)?;
        if current.run.status == translunar_pipeline::PipelineRunStatus::Interrupted {
            if current.run.revision != params.expected_revision {
                return Err(EngineError::Storage(StorageError::EntityConflict {
                    entity: "pipeline_run",
                    id: params.run_id.clone(),
                    expected_revision: params.expected_revision,
                    actual_revision: current.run.revision,
                }));
            }
            let resolved = match self.pipeline.resolve_resume(&definition, &current) {
                Ok(resolved) => resolved,
                Err(failure) => {
                    let failed = self.store.fail_pipeline_run(&params.run_id, failure)?;
                    return Ok(to_protocol_pipeline_snapshot(failed));
                }
            };
            if let Some(migration) = &resolved.migration
                && let Err(error) = self.store.migrate_pipeline_step_checkpoint(
                    &params.run_id,
                    migration.step_index,
                    migration.outcome.checkpoint.clone(),
                    &migration.attempt,
                )
            {
                let failed = self.store.fail_pipeline_run(
                    &params.run_id,
                    plugin_checkpoint_incompatible(&format!(
                        "checkpoint migration could not be persisted: {error}"
                    )),
                )?;
                return Ok(to_protocol_pipeline_snapshot(failed));
            }
            let descriptor = resolved
                .steps
                .get(current.run.current_step_index as usize)
                .and_then(Option::as_ref)
                .ok_or_else(|| {
                    EngineError::InvalidState(format!(
                        "pipeline run points to missing step {}",
                        current.run.current_step_index
                    ))
                })?
                .descriptor();
            if !descriptor.resumable {
                let failed = self.store.fail_pipeline_run(
                    &params.run_id,
                    PipelineFailure {
                        code: "step_not_resumable".to_string(),
                        message: format!("pipeline step {} cannot resume", descriptor.id),
                        retryable: false,
                    },
                )?;
                return Ok(to_protocol_pipeline_snapshot(failed));
            }
            let snapshot = self
                .store
                .resume_pipeline_run(&params.run_id, params.expected_revision)?;
            let run_id = snapshot.run.id.clone();
            self.pipeline.spawn_resolved(run_id, resolved.steps)?;
            return Ok(to_protocol_pipeline_snapshot(snapshot));
        }
        let snapshot = self
            .store
            .resume_pipeline_run(&params.run_id, params.expected_revision)?;
        Ok(to_protocol_pipeline_snapshot(snapshot))
    }
}

fn to_protocol_pipeline_snapshot(
    snapshot: translunar_storage::PipelineRunSnapshot,
) -> ProtocolPipelineRunSnapshot {
    ProtocolPipelineRunSnapshot {
        run: snapshot.run,
        steps: snapshot.steps,
    }
}

fn read_asset_input(path: &str) -> Result<Vec<u8>> {
    if path.trim().is_empty() {
        return Err(EngineError::InvalidRequest(
            "sourcePath must not be empty".to_string(),
        ));
    }
    let path = Path::new(path);
    let metadata = path.metadata().map_err(EngineError::Io)?;
    if !metadata.is_file() {
        return Err(EngineError::InvalidRequest(
            "asset source path must name a file".to_string(),
        ));
    }
    if metadata.len() > 256 * 1024 * 1024 {
        return Err(EngineError::InvalidRequest(
            "asset source exceeds the 256 MiB limit".to_string(),
        ));
    }
    std::fs::read(path).map_err(EngineError::Io)
}

fn tm_unit_to_exchange(unit: &translunar_asset_core::TmUnit) -> TmExchangeUnit {
    TmExchangeUnit {
        source_locale: unit.source_locale.clone(),
        target_locale: unit.target_locale.clone(),
        source_text: unit.source_text.clone(),
        target_text: unit.target_text.clone(),
        domain: unit.domain.clone(),
        author: unit.author.clone(),
        created_at_ms: Some(unit.created_at_ms),
        metadata: unit.metadata.clone(),
    }
}

fn term_entry_to_exchange(
    entry: &translunar_asset_core::TermEntry,
    target_locale: &str,
) -> Option<TermExchangeEntry> {
    let target_translations = entry
        .translations
        .iter()
        .filter(|translation| {
            target_locale.trim().is_empty() || translation.locale == target_locale
        })
        .map(|translation| TermExchangeTranslation {
            locale: translation.locale.clone(),
            term: translation.term.clone(),
            preferred: translation.preferred,
            forbidden: translation.forbidden,
        })
        .collect::<Vec<_>>();
    if target_translations.is_empty() {
        return None;
    }
    Some(TermExchangeEntry {
        source_locale: entry.source_locale.clone(),
        source_term: entry.source_term.clone(),
        target_translations,
        part_of_speech: entry.part_of_speech.clone(),
        definition: entry.definition.clone(),
        example: entry.example.clone(),
        domain: entry.domain.clone(),
        status: match entry.status {
            TermStatus::Candidate => "candidate",
            TermStatus::Active => "active",
            TermStatus::Deprecated => "deprecated",
        }
        .to_string(),
        metadata: Default::default(),
    })
}

fn publish_asset_file(
    output_path: &Path,
    write: impl FnOnce(&mut File) -> Result<()>,
    validate: impl FnOnce(&Path) -> Result<()>,
) -> Result<()> {
    if output_path.as_os_str().is_empty() {
        return Err(EngineError::InvalidRequest(
            "outputPath must not be empty".to_string(),
        ));
    }
    if output_path.exists() {
        return Err(EngineError::InvalidState(
            "asset export destination already exists".to_string(),
        ));
    }
    let parent = output_path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    std::fs::create_dir_all(parent)?;
    let mut temporary = NamedTempFile::new_in(parent)?;
    write(temporary.as_file_mut())?;
    temporary.as_file_mut().flush()?;
    temporary.as_file().sync_all()?;
    validate(temporary.path())?;
    temporary
        .persist_noclobber(output_path)
        .map_err(|error| EngineError::Io(error.error))?;
    Ok(())
}

impl Drop for EngineService {
    fn drop(&mut self) {
        self.shutdown_plugin_runtimes();
    }
}

pub struct RpcDispatcher {
    service: EngineService,
    initialized: bool,
}

/// Handle that can cancel AI actions without borrowing the full dispatcher mutably.
#[derive(Clone)]
pub struct RpcCancelHandle {
    cancels: plugin_ai_ui::AiActionCancelRegistry,
}

impl RpcCancelHandle {
    pub fn handle_cancel(&self, request: RpcRequest) -> RpcResponse {
        let id = request.id.clone();
        if request.jsonrpc != "2.0" {
            return RpcResponse::failure(
                id,
                rpc_error(EngineError::InvalidRequest(
                    "jsonrpc must be exactly '2.0'".to_string(),
                )),
            );
        }
        if request.method != methods::PLUGIN_AI_ACTION_CANCEL {
            return RpcResponse::failure(
                id,
                rpc_error(EngineError::InvalidRequest(
                    "cancel handle only accepts plugin.aiAction.cancel".to_string(),
                )),
            );
        }
        match parse_params::<translunar_protocol::PluginAiActionCancelParams>(request.params) {
            Ok(params) => {
                let cancelled = self.cancels.cancel(&params.invocation_id);
                match serialize_result(translunar_protocol::PluginAiActionCancelResult {
                    cancelled,
                    invocation_id: params.invocation_id,
                }) {
                    Ok(value) => RpcResponse::success(id, value),
                    Err(error) => RpcResponse::failure(id, rpc_error(error)),
                }
            }
            Err(error) => RpcResponse::failure(id, rpc_error(error)),
        }
    }
}

impl RpcDispatcher {
    pub fn open(data_dir: impl AsRef<Path>) -> Result<Self> {
        Ok(Self {
            service: EngineService::open(data_dir)?,
            initialized: false,
        })
    }

    pub fn shared_cancel_handle(&self) -> RpcCancelHandle {
        RpcCancelHandle {
            cancels: self.service.plugin_ai_action_cancels.clone(),
        }
    }

    pub fn handle(&mut self, request: RpcRequest) -> RpcResponse {
        let id = request.id.clone();
        match self.dispatch(request) {
            Ok(value) => RpcResponse::success(id, value),
            Err(error) => RpcResponse::failure(id, rpc_error(error)),
        }
    }

    fn dispatch(&mut self, request: RpcRequest) -> Result<Value> {
        if request.jsonrpc != "2.0" {
            return Err(EngineError::InvalidRequest(
                "jsonrpc must be exactly '2.0'".to_string(),
            ));
        }
        if request.method == methods::INITIALIZE {
            return self.initialize(parse_params(request.params)?);
        }
        if !self.initialized {
            return Err(EngineError::InvalidState(
                "engine.initialize must succeed before other methods".to_string(),
            ));
        }

        match request.method.as_str() {
            methods::PROJECT_CREATE => {
                serialize_result(self.service.create_project(parse_params(request.params)?)?)
            }
            methods::PROJECT_GET => {
                let params: ProjectIdParams = parse_params(request.params)?;
                serialize_result(self.service.get_project(&params.project_id)?)
            }
            methods::PROJECT_LIST => {
                serialize_result(self.service.list_projects(parse_params(request.params)?)?)
            }
            methods::PROJECT_UPDATE => {
                serialize_result(self.service.update_project(parse_params(request.params)?)?)
            }
            methods::PROJECT_SET_LIFECYCLE => serialize_result(
                self.service
                    .set_project_lifecycle(parse_params(request.params)?)?,
            ),
            methods::PROJECT_TEMPLATE_LIST => serialize_result(
                self.service
                    .list_project_templates(parse_params(request.params)?)?,
            ),
            methods::PROJECT_TEMPLATE_GET => serialize_result(
                self.service
                    .get_project_template(parse_params(request.params)?)?,
            ),
            methods::PROJECT_TEMPLATE_CREATE => serialize_result(
                self.service
                    .create_project_template(parse_params(request.params)?)?,
            ),
            methods::PROJECT_TEMPLATE_UPDATE => serialize_result(
                self.service
                    .update_project_template(parse_params(request.params)?)?,
            ),
            methods::PROJECT_TEMPLATE_DELETE => serialize_result(
                self.service
                    .delete_project_template(parse_params(request.params)?)?,
            ),
            methods::PROJECT_CREATE_FROM_TEMPLATE => serialize_result(
                self.service
                    .create_project_from_template(parse_params(request.params)?)?,
            ),
            methods::PROJECT_BATCH_IMPORT => {
                serialize_result(self.service.batch_import(parse_params(request.params)?)?)
            }
            methods::PROJECT_ARCHIVE_EXPORT => serialize_result(
                self.service
                    .export_project_archive(parse_params(request.params)?)?,
            ),
            methods::PROJECT_ARCHIVE_RESTORE => serialize_result(
                self.service
                    .restore_project_archive(parse_params(request.params)?)?,
            ),
            methods::DISCUSSION_THREAD_LIST => serialize_result(
                self.service
                    .list_discussion_threads(parse_params(request.params)?)?,
            ),
            methods::DISCUSSION_THREAD_CREATE => serialize_result(
                self.service
                    .create_discussion_thread(parse_params(request.params)?)?,
            ),
            methods::DISCUSSION_THREAD_RESOLVE => serialize_result(
                self.service
                    .resolve_discussion_thread(parse_params(request.params)?)?,
            ),
            methods::DISCUSSION_MESSAGE_LIST => serialize_result(
                self.service
                    .list_discussion_messages(parse_params(request.params)?)?,
            ),
            methods::DISCUSSION_MESSAGE_CREATE => serialize_result(
                self.service
                    .create_discussion_message(parse_params(request.params)?)?,
            ),
            methods::DISCUSSION_MESSAGE_UPDATE => serialize_result(
                self.service
                    .update_discussion_message(parse_params(request.params)?)?,
            ),
            methods::DISCUSSION_MESSAGE_DELETE => serialize_result(
                self.service
                    .delete_discussion_message(parse_params(request.params)?)?,
            ),
            methods::PROJECT_SNAPSHOT_LIST => serialize_result(
                self.service
                    .list_project_snapshots(parse_params(request.params)?)?,
            ),
            methods::PROJECT_SNAPSHOT_CREATE => serialize_result(
                self.service
                    .create_project_snapshot(parse_params(request.params)?)?,
            ),
            methods::PROJECT_SNAPSHOT_GET => serialize_result(
                self.service
                    .get_project_snapshot(parse_params(request.params)?)?,
            ),
            methods::PROJECT_SNAPSHOT_PREVIEW_RESTORE => serialize_result(
                self.service
                    .preview_project_snapshot_restore(parse_params(request.params)?)?,
            ),
            methods::PROJECT_SNAPSHOT_RESTORE => serialize_result(
                self.service
                    .restore_project_snapshot(parse_params(request.params)?)?,
            ),
            methods::TASK_PACKAGE_EXPORT => serialize_result(
                self.service
                    .export_task_package(parse_params(request.params)?)?,
            ),
            methods::TASK_PACKAGE_PREVIEW => serialize_result(
                self.service
                    .preview_task_package(parse_params(request.params)?)?,
            ),
            methods::TASK_PACKAGE_APPLY => serialize_result(
                self.service
                    .apply_task_package(parse_params(request.params)?)?,
            ),
            methods::TASK_PACKAGE_IMPORT => serialize_result(
                self.service
                    .import_task_package(parse_params(request.params)?)?,
            ),
            methods::TASK_PACKAGE_DISCARD => serialize_result(
                self.service
                    .discard_task_package(parse_params(request.params)?)?,
            ),
            methods::DOCUMENT_LIST => {
                serialize_result(self.service.list_documents(parse_params(request.params)?)?)
            }
            methods::DOCUMENT_GET => {
                let params: DocumentIdParams = parse_params(request.params)?;
                serialize_result(self.service.get_document(&params.document_id)?)
            }
            methods::DOCUMENT_IMPORT => serialize_result(
                self.service
                    .import_document(parse_params(request.params)?)?,
            ),
            methods::DOCUMENT_IMPORT_DOCX => {
                serialize_result(self.service.import_docx(parse_params(request.params)?)?)
            }
            methods::DOCUMENT_REIMPORT_PREVIEW => serialize_result(
                self.service
                    .preview_document_reimport(parse_params(request.params)?)?,
            ),
            methods::DOCUMENT_REIMPORT_APPLY => serialize_result(
                self.service
                    .apply_document_reimport(parse_params(request.params)?)?,
            ),
            methods::RECYCLE_LIST => {
                serialize_result(self.service.list_recycle(parse_params(request.params)?)?)
            }
            methods::RECYCLE_DELETE => {
                serialize_result(self.service.recycle_delete(parse_params(request.params)?)?)
            }
            methods::RECYCLE_RESTORE => serialize_result(
                self.service
                    .recycle_restore(parse_params(request.params)?)?,
            ),
            methods::RECYCLE_PURGE => {
                serialize_result(self.service.recycle_purge(parse_params(request.params)?)?)
            }
            methods::SEARCH_GLOBAL => {
                serialize_result(self.service.search_global(parse_params(request.params)?)?)
            }
            methods::ANALYSIS_PROFILE_LIST => {
                let _: EmptyParams = parse_params(request.params)?;
                serialize_result(self.service.list_analysis_profiles()?)
            }
            methods::ANALYSIS_RUN => {
                serialize_result(self.service.run_analysis(parse_params(request.params)?)?)
            }
            methods::ANALYSIS_RUN_GET => serialize_result(
                self.service
                    .get_analysis_run(parse_params(request.params)?)?,
            ),
            methods::PROJECT_ANALYTICS_GET => serialize_result(
                self.service
                    .get_project_analytics(parse_params(request.params)?)?,
            ),
            methods::SEGMENT_LIST => {
                serialize_result(self.service.list_segments(parse_params(request.params)?)?)
            }
            methods::SEGMENT_UPDATE_TARGET => {
                serialize_result(self.service.update_target(parse_params(request.params)?)?)
            }
            methods::SEGMENT_CONFIRM => serialize_result(
                self.service
                    .confirm_segment(parse_params(request.params)?)?,
            ),
            methods::SEGMENT_EDITOR_LIST => serialize_result(
                self.service
                    .list_editor_segments(parse_params(request.params)?)?,
            ),
            methods::SEGMENT_TAG_SET => serialize_result(
                self.service
                    .set_segment_tags(parse_params(request.params)?)?,
            ),
            methods::SEGMENT_CHINESE_CONVERT => serialize_result(
                self.service
                    .convert_segment_chinese(parse_params(request.params)?)?,
            ),
            methods::SEGMENT_PROPAGATE => serialize_result(
                self.service
                    .propagate_segment(parse_params(request.params)?)?,
            ),
            methods::SEGMENT_FIND => {
                serialize_result(self.service.find_segments(parse_params(request.params)?)?)
            }
            methods::SEGMENT_REPLACE_PREVIEW => serialize_result(
                self.service
                    .preview_replace(parse_params(request.params)?)?,
            ),
            methods::SEGMENT_REPLACE_APPLY => {
                serialize_result(self.service.apply_replace(parse_params(request.params)?)?)
            }
            methods::SEGMENT_SPLIT => {
                serialize_result(self.service.split_segment(parse_params(request.params)?)?)
            }
            methods::SEGMENT_MERGE => {
                serialize_result(self.service.merge_segments(parse_params(request.params)?)?)
            }
            methods::SEGMENT_CORRECT_SOURCE => {
                serialize_result(self.service.correct_source(parse_params(request.params)?)?)
            }
            methods::SEGMENT_WORKFLOW_SET => serialize_result(
                self.service
                    .set_editor_workflow(parse_params(request.params)?)?,
            ),
            methods::SEGMENT_COMMENT_LIST => serialize_result(
                self.service
                    .list_segment_comments(parse_params(request.params)?)?,
            ),
            methods::SEGMENT_COMMENT_CREATE => serialize_result(
                self.service
                    .create_segment_comment(parse_params(request.params)?)?,
            ),
            methods::SEGMENT_COMMENT_UPDATE => serialize_result(
                self.service
                    .update_segment_comment(parse_params(request.params)?)?,
            ),
            methods::SEGMENT_COMMENT_RESOLVE => serialize_result(
                self.service
                    .resolve_segment_comment(parse_params(request.params)?)?,
            ),
            methods::SEGMENT_COMMENT_DELETE => serialize_result(
                self.service
                    .delete_segment_comment(parse_params(request.params)?)?,
            ),
            methods::SEGMENT_SPELL_CHECK => {
                serialize_result(self.service.spell_check(parse_params(request.params)?)?)
            }
            methods::DICTIONARY_LIST => serialize_result(
                self.service
                    .list_dictionary(parse_params(request.params)?)?,
            ),
            methods::DICTIONARY_ADD => serialize_result(
                self.service
                    .add_dictionary_word(parse_params(request.params)?)?,
            ),
            methods::DICTIONARY_REMOVE => serialize_result(
                self.service
                    .remove_dictionary_word(parse_params(request.params)?)?,
            ),
            methods::EDITOR_UNDO => {
                serialize_result(self.service.undo_editor(parse_params(request.params)?)?)
            }
            methods::EDITOR_REDO => {
                serialize_result(self.service.redo_editor(parse_params(request.params)?)?)
            }
            methods::EDITOR_HISTORY => {
                serialize_result(self.service.editor_history(parse_params(request.params)?)?)
            }
            methods::REVIEW_CREATE => {
                serialize_result(self.service.create_review(parse_params(request.params)?)?)
            }
            methods::REVIEW_LIST => {
                serialize_result(self.service.list_reviews(parse_params(request.params)?)?)
            }
            methods::REVIEW_ACCEPT => {
                serialize_result(self.service.accept_review(parse_params(request.params)?)?)
            }
            methods::REVIEW_REJECT => {
                serialize_result(self.service.reject_review(parse_params(request.params)?)?)
            }
            methods::REVIEW_QUEUE => serialize_result(
                self.service
                    .list_review_queue(parse_params(request.params)?)?,
            ),
            methods::REVIEW_STATS => serialize_result(
                self.service
                    .review_statistics(parse_params(request.params)?)?,
            ),
            methods::INTEROP_REVIEW_EXPORT => {
                serialize_result(self.service.export_review(parse_params(request.params)?)?)
            }
            methods::INTEROP_REVIEW_PREVIEW => {
                serialize_result(self.service.preview_review(parse_params(request.params)?)?)
            }
            methods::INTEROP_REVIEW_APPLY => {
                serialize_result(self.service.apply_review(parse_params(request.params)?)?)
            }
            methods::INTEROP_TABLE_PREVIEW => {
                serialize_result(self.service.preview_table(parse_params(request.params)?)?)
            }
            methods::INTEROP_TABLE_APPLY => {
                serialize_result(self.service.apply_table(parse_params(request.params)?)?)
            }
            methods::EDITOR_PREFERENCES_GET => serialize_result(
                self.service
                    .get_editor_preferences(parse_params(request.params)?)?,
            ),
            methods::EDITOR_PREFERENCES_UPDATE => serialize_result(
                self.service
                    .update_editor_preferences(parse_params(request.params)?)?,
            ),
            methods::PDF_PAGE_LIST => {
                serialize_result(self.service.list_pdf_pages(parse_params(request.params)?)?)
            }
            methods::PDF_PAGE_GET => {
                serialize_result(self.service.get_pdf_page(parse_params(request.params)?)?)
            }
            methods::PDF_CORRECT_OCR => {
                serialize_result(self.service.correct_ocr(parse_params(request.params)?)?)
            }
            methods::ALIGNMENT_SESSION_CREATE => serialize_result(
                self.service
                    .create_alignment_session(parse_params(request.params)?)?,
            ),
            methods::ALIGNMENT_SESSION_GET => serialize_result(
                self.service
                    .get_alignment_session(parse_params(request.params)?)?,
            ),
            methods::ALIGNMENT_SESSION_LIST => serialize_result(
                self.service
                    .list_alignment_sessions(parse_params(request.params)?)?,
            ),
            methods::ALIGNMENT_SESSION_UPDATE => serialize_result(
                self.service
                    .update_alignment_session(parse_params(request.params)?)?,
            ),
            methods::ALIGNMENT_SESSION_REFINE => serialize_result(
                self.service
                    .refine_alignment_session(parse_params(request.params)?)?,
            ),
            methods::ALIGNMENT_SESSION_APPLY => serialize_result(
                self.service
                    .apply_alignment_session(parse_params(request.params)?)?,
            ),
            methods::CORPUS_LIST => serialize_result(
                self.service
                    .list_reference_corpora(parse_params(request.params)?)?,
            ),
            methods::CORPUS_IMPORT => serialize_result(
                self.service
                    .import_reference_corpus_rpc(parse_params(request.params)?)?,
            ),
            methods::CORPUS_FROM_ALIGNMENT => serialize_result(
                self.service
                    .create_reference_corpus_from_alignment(parse_params(request.params)?)?,
            ),
            methods::CORPUS_SEARCH => serialize_result(
                self.service
                    .search_reference_corpora(parse_params(request.params)?)?,
            ),
            methods::CORPUS_REINDEX => serialize_result(
                self.service
                    .reindex_reference_corpus(parse_params(request.params)?)?,
            ),
            methods::CORPUS_REMOVE => serialize_result(
                self.service
                    .remove_reference_corpus(parse_params(request.params)?)?,
            ),
            methods::ASSET_CATALOG_LIST => serialize_result(
                self.service
                    .list_asset_catalog(parse_params(request.params)?)?,
            ),
            methods::CURATION_RUN => {
                serialize_result(self.service.run_curation(parse_params(request.params)?)?)
            }
            methods::CURATION_RUN_GET => serialize_result(
                self.service
                    .get_curation_run(parse_params(request.params)?)?,
            ),
            methods::CURATION_FINDING_LIST => serialize_result(
                self.service
                    .list_curation_findings(parse_params(request.params)?)?,
            ),
            methods::CURATION_APPLY => {
                serialize_result(self.service.apply_curation(parse_params(request.params)?)?)
            }
            methods::CURATION_ROLLBACK => serialize_result(
                self.service
                    .rollback_curation(parse_params(request.params)?)?,
            ),
            methods::CURATION_EXPORT => serialize_result(
                self.service
                    .export_curation(parse_params(request.params)?)?,
            ),
            methods::COLLAB_MEMBER_LIST => serialize_result(
                self.service
                    .list_collab_members(parse_params(request.params)?)?,
            ),
            methods::COLLAB_MEMBER_ADD => serialize_result(
                self.service
                    .add_collab_member(parse_params(request.params)?)?,
            ),
            methods::COLLAB_MEMBER_REMOVE => serialize_result(
                self.service
                    .remove_collab_member(parse_params(request.params)?)?,
            ),
            methods::COLLAB_LOCK_ACQUIRE => serialize_result(
                self.service
                    .acquire_collab_lock(parse_params(request.params)?)?,
            ),
            methods::COLLAB_LOCK_RELEASE => serialize_result(
                self.service
                    .release_collab_lock(parse_params(request.params)?)?,
            ),
            methods::COLLAB_LOCK_HEARTBEAT => serialize_result(
                self.service
                    .heartbeat_collab_lock(parse_params(request.params)?)?,
            ),
            methods::COLLAB_LOCK_LIST => serialize_result(
                self.service
                    .list_collab_locks(parse_params(request.params)?)?,
            ),
            methods::COLLAB_PRESENCE_HEARTBEAT => serialize_result(
                self.service
                    .collab_presence_heartbeat(parse_params(request.params)?)?,
            ),
            methods::COLLAB_PRESENCE_LIST => serialize_result(
                self.service
                    .list_collab_presence(parse_params(request.params)?)?,
            ),
            methods::COLLAB_ASSIGNMENT_LIST => serialize_result(
                self.service
                    .list_collab_assignments(parse_params(request.params)?)?,
            ),
            methods::COLLAB_ASSIGNMENT_CREATE => serialize_result(
                self.service
                    .create_collab_assignment(parse_params(request.params)?)?,
            ),
            methods::COLLAB_ASSIGNMENT_COMPLETE => serialize_result(
                self.service
                    .complete_collab_assignment(parse_params(request.params)?)?,
            ),
            methods::COLLAB_OP_LOG_LIST => serialize_result(
                self.service
                    .list_collab_ops(parse_params(request.params)?)?,
            ),
            methods::PLUGIN_LIST => {
                serialize_result(self.service.list_plugins(parse_params(request.params)?)?)
            }
            methods::PLUGIN_GET => {
                serialize_result(self.service.get_plugin(parse_params(request.params)?)?)
            }
            methods::PLUGIN_INSTALL => {
                serialize_result(self.service.install_plugin(parse_params(request.params)?)?)
            }
            methods::PLUGIN_ENABLE => {
                serialize_result(self.service.enable_plugin(parse_params(request.params)?)?)
            }
            methods::PLUGIN_DISABLE => {
                serialize_result(self.service.disable_plugin(parse_params(request.params)?)?)
            }
            methods::PLUGIN_UNINSTALL => serialize_result(
                self.service
                    .uninstall_plugin(parse_params(request.params)?)?,
            ),
            methods::PLUGIN_INSPECT => {
                serialize_result(self.service.inspect_plugin(parse_params(request.params)?)?)
            }
            methods::PLUGIN_VERSION_LIST => serialize_result(
                self.service
                    .list_plugin_versions(parse_params(request.params)?)?,
            ),
            methods::PLUGIN_UPGRADE => {
                serialize_result(self.service.upgrade_plugin(parse_params(request.params)?)?)
            }
            methods::PLUGIN_ROLLBACK => serialize_result(
                self.service
                    .rollback_plugin(parse_params(request.params)?)?,
            ),
            methods::PLUGIN_PERMISSION_REQUEST_LIST => serialize_result(
                self.service
                    .list_plugin_capability_requests(parse_params(request.params)?)?,
            ),
            methods::PLUGIN_PERMISSION_REVIEW => serialize_result(
                self.service
                    .review_plugin_capabilities(parse_params(request.params)?)?,
            ),
            methods::PLUGIN_PERMISSION_GRANT => serialize_result(
                self.service
                    .grant_plugin_capability(parse_params(request.params)?)?,
            ),
            methods::PLUGIN_PERMISSION_DENY => serialize_result(
                self.service
                    .deny_plugin_capability(parse_params(request.params)?)?,
            ),
            methods::PLUGIN_PERMISSION_REVOKE => serialize_result(
                self.service
                    .revoke_plugin_capability(parse_params(request.params)?)?,
            ),
            methods::PLUGIN_PERMISSION_AUDIT_LIST => serialize_result(
                self.service
                    .list_plugin_capability_audit(parse_params(request.params)?)?,
            ),
            methods::PLUGIN_AI_ACTION_LIST => {
                parse_params::<EmptyParams>(request.params)?;
                serialize_result(self.service.list_plugin_ai_actions())
            }
            methods::PLUGIN_AI_ACTION_INVOKE => serialize_result(
                self.service
                    .invoke_plugin_ai_action(parse_params(request.params)?)?,
            ),
            methods::PLUGIN_AI_ACTION_CANCEL => serialize_result(
                self.service
                    .cancel_plugin_ai_action(parse_params(request.params)?)?,
            ),
            methods::PLUGIN_AI_ACTION_HISTORY_LIST => serialize_result(
                self.service
                    .list_plugin_ai_action_history(parse_params(request.params)?)?,
            ),
            methods::PLUGIN_UI_PANEL_LIST => {
                parse_params::<EmptyParams>(request.params)?;
                serialize_result(self.service.list_plugin_ui_panels())
            }
            methods::PLUGIN_UI_PANEL_BRIDGE_CALL => serialize_result(
                self.service
                    .call_plugin_ui_panel_bridge(parse_params(request.params)?)?,
            ),
            methods::EXTERNAL_CONNECTOR_CATALOG => {
                parse_params::<EmptyParams>(request.params)?;
                serialize_result(self.service.list_external_connector_catalog())
            }
            methods::EXTERNAL_CONNECTOR_PROFILE_LIST => serialize_result(
                self.service
                    .list_external_connector_profiles(parse_params(request.params)?)?,
            ),
            methods::EXTERNAL_CONNECTOR_PROFILE_CREATE => serialize_result(
                self.service
                    .create_external_connector_profile(parse_params(request.params)?)?,
            ),
            methods::EXTERNAL_CONNECTOR_PROFILE_UPDATE => serialize_result(
                self.service
                    .update_external_connector_profile(parse_params(request.params)?)?,
            ),
            methods::EXTERNAL_CONNECTOR_PROFILE_DELETE => serialize_result(
                self.service
                    .delete_external_connector_profile(parse_params(request.params)?)?,
            ),
            methods::EXTERNAL_CONNECTOR_CREDENTIAL_SET => serialize_result(
                self.service
                    .set_external_connector_credential(parse_params(request.params)?)?,
            ),
            methods::EXTERNAL_CONNECTOR_CREDENTIAL_DELETE => serialize_result(
                self.service
                    .delete_external_connector_credential(parse_params(request.params)?)?,
            ),
            methods::EXTERNAL_CONNECTOR_CREDENTIAL_STATUS => serialize_result(
                self.service
                    .external_connector_credential_status(parse_params(request.params)?)?,
            ),
            methods::EXTERNAL_CONNECTOR_INVOKE => serialize_result(
                self.service
                    .invoke_external_connector(parse_params(request.params)?)?,
            ),
            methods::EXTERNAL_CONNECTOR_CHECKPOINT_GET => serialize_result(
                self.service
                    .get_external_connector_checkpoint(parse_params(request.params)?)?,
            ),
            methods::TM_LOOKUP_EXACT => {
                serialize_result(self.service.lookup_exact(parse_params(request.params)?)?)
            }
            methods::TM_LIBRARY_LIST => serialize_result(
                self.service
                    .list_tm_libraries(parse_params(request.params)?)?,
            ),
            methods::TM_LIBRARY_CREATE => serialize_result(
                self.service
                    .create_tm_library(parse_params(request.params)?)?,
            ),
            methods::TM_LIBRARY_MOUNT => serialize_result(
                self.service
                    .mount_tm_library(parse_params(request.params)?)?,
            ),
            methods::TM_LIBRARY_UNMOUNT => serialize_result(
                self.service
                    .unmount_tm_library(parse_params(request.params)?)?,
            ),
            methods::TM_SEARCH => {
                serialize_result(self.service.search_tm(parse_params(request.params)?)?)
            }
            methods::TM_CONCORDANCE => {
                serialize_result(self.service.concordance(parse_params(request.params)?)?)
            }
            methods::TM_IMPORT => {
                serialize_result(self.service.import_tm(parse_params(request.params)?)?)
            }
            methods::TM_EXPORT => {
                serialize_result(self.service.export_tm(parse_params(request.params)?)?)
            }
            methods::TERMBASE_LIST => {
                serialize_result(self.service.list_termbases(parse_params(request.params)?)?)
            }
            methods::TERMBASE_CREATE => serialize_result(
                self.service
                    .create_termbase(parse_params(request.params)?)?,
            ),
            methods::TERMBASE_MOUNT => {
                serialize_result(self.service.mount_termbase(parse_params(request.params)?)?)
            }
            methods::TERMBASE_UNMOUNT => serialize_result(
                self.service
                    .unmount_termbase(parse_params(request.params)?)?,
            ),
            methods::TERM_SEARCH => {
                serialize_result(self.service.search_terms(parse_params(request.params)?)?)
            }
            methods::TERM_UPSERT => {
                serialize_result(self.service.upsert_term(parse_params(request.params)?)?)
            }
            methods::TERMBASE_IMPORT => serialize_result(
                self.service
                    .import_termbase(parse_params(request.params)?)?,
            ),
            methods::TERMBASE_EXPORT => serialize_result(
                self.service
                    .export_termbase(parse_params(request.params)?)?,
            ),
            methods::QA_RUN_DOCUMENT => {
                let params: DocumentIdParams = parse_params(request.params)?;
                serialize_result(self.service.run_document_qa(&params.document_id)?)
            }
            methods::QA_LIST => {
                serialize_result(self.service.list_qa(parse_params(request.params)?)?)
            }
            methods::QA_PROFILE_LIST => serialize_result(
                self.service
                    .list_qa_profiles(parse_params(request.params)?)?,
            ),
            methods::QA_PROFILE_CREATE => serialize_result(
                self.service
                    .create_qa_profile(parse_params(request.params)?)?,
            ),
            methods::QA_PROFILE_CLONE => serialize_result(
                self.service
                    .clone_qa_profile(parse_params(request.params)?)?,
            ),
            methods::QA_PROFILE_UPDATE => serialize_result(
                self.service
                    .update_qa_profile(parse_params(request.params)?)?,
            ),
            methods::QA_PROFILE_DELETE => serialize_result(
                self.service
                    .delete_qa_profile(parse_params(request.params)?)?,
            ),
            methods::QA_RUN => {
                serialize_result(self.service.run_qa(parse_params(request.params)?)?)
            }
            methods::QA_RUN_LIST => {
                serialize_result(self.service.list_qa_runs(parse_params(request.params)?)?)
            }
            methods::QA_RUN_GET => {
                serialize_result(self.service.get_qa_run(parse_params(request.params)?)?)
            }
            methods::QA_ISSUE_LIST => {
                serialize_result(self.service.list_qa_issues(parse_params(request.params)?)?)
            }
            methods::QA_ISSUE_WAIVE => {
                serialize_result(self.service.waive_qa_issue(parse_params(request.params)?)?)
            }
            methods::QA_ISSUE_REVOKE => serialize_result(
                self.service
                    .revoke_qa_issue(parse_params(request.params)?)?,
            ),
            methods::QA_REPORT_EXPORT => serialize_result(
                self.service
                    .export_qa_report(parse_params(request.params)?)?,
            ),
            methods::QA_GATE_CHECK => {
                serialize_result(self.service.check_qa_gate(parse_params(request.params)?)?)
            }
            methods::QA_OVERRIDE_LIST => serialize_result(
                self.service
                    .list_qa_overrides(parse_params(request.params)?)?,
            ),
            methods::DOCUMENT_EXPORT_DOCX => {
                serialize_result(self.service.export_docx(parse_params(request.params)?)?)
            }
            methods::DOCUMENT_EXPORT => serialize_result(
                self.service
                    .export_document(parse_params(request.params)?)?,
            ),
            methods::FILTER_LIST => {
                serialize_result(self.service.list_filters(parse_params(request.params)?))
            }
            methods::HISTORY_LIST => {
                serialize_result(self.service.list_history(parse_params(request.params)?)?)
            }
            methods::DATA_CHECK_HEALTH => {
                serialize_result(self.service.check_health(parse_params(request.params)?)?)
            }
            methods::DATA_CREATE_BACKUP => {
                serialize_result(self.service.create_backup(parse_params(request.params)?)?)
            }
            methods::PIPELINE_STEP_LIST => {
                let _: EmptyParams = parse_params(request.params)?;
                serialize_result(self.service.pipeline_capabilities())
            }
            methods::PIPELINE_CREATE => serialize_result(
                self.service
                    .create_pipeline(parse_params(request.params)?)?,
            ),
            methods::PIPELINE_LIST => {
                serialize_result(self.service.list_pipelines(parse_params(request.params)?)?)
            }
            methods::PIPELINE_GET => {
                serialize_result(self.service.get_pipeline(parse_params(request.params)?)?)
            }
            methods::PIPELINE_VALIDATE => serialize_result(
                self.service
                    .validate_pipeline(parse_params(request.params)?),
            ),
            methods::PIPELINE_RUN => {
                serialize_result(self.service.run_pipeline(parse_params(request.params)?)?)
            }
            methods::PIPELINE_RUN_LIST => serialize_result(
                self.service
                    .list_pipeline_runs(parse_params(request.params)?)?,
            ),
            methods::PIPELINE_RUN_GET => serialize_result(
                self.service
                    .get_pipeline_run(parse_params(request.params)?)?,
            ),
            methods::PIPELINE_RUN_CANCEL => serialize_result(
                self.service
                    .cancel_pipeline_run(parse_params(request.params)?)?,
            ),
            methods::PIPELINE_RUN_RESUME => serialize_result(
                self.service
                    .resume_pipeline_run(parse_params(request.params)?)?,
            ),
            methods::AI_PROVIDER_CATALOG => serialize_result(
                self.service
                    .ai_provider_catalog(parse_params(request.params)?)?,
            ),
            methods::AI_PROVIDER_LIST => serialize_result(
                self.service
                    .list_ai_providers(parse_params(request.params)?)?,
            ),
            methods::AI_PROVIDER_CREATE => serialize_result(
                self.service
                    .create_ai_provider(parse_params(request.params)?)?,
            ),
            methods::AI_PROVIDER_UPDATE => serialize_result(
                self.service
                    .update_ai_provider(parse_params(request.params)?)?,
            ),
            methods::AI_PROVIDER_DELETE => serialize_result(
                self.service
                    .delete_ai_provider(parse_params(request.params)?)?,
            ),
            methods::AI_PROVIDER_TEST => serialize_result(
                self.service
                    .test_ai_provider(parse_params(request.params)?)?,
            ),
            methods::AI_CREDENTIAL_SET => serialize_result(
                self.service
                    .set_ai_credential(parse_params(request.params)?)?,
            ),
            methods::AI_CREDENTIAL_DELETE => serialize_result(
                self.service
                    .delete_ai_credential(parse_params(request.params)?)?,
            ),
            methods::AI_CREDENTIAL_STATUS => serialize_result(
                self.service
                    .ai_credential_status(parse_params(request.params)?)?,
            ),
            methods::AI_SETTINGS_GET => serialize_result(
                self.service
                    .get_ai_settings(parse_params(request.params)?)?,
            ),
            methods::AI_SETTINGS_UPDATE => serialize_result(
                self.service
                    .update_ai_settings(parse_params(request.params)?)?,
            ),
            methods::AI_GROUNDING_PREVIEW => serialize_result(
                self.service
                    .preview_ai_grounding(parse_params(request.params)?)?,
            ),
            methods::AI_RUN_START => {
                serialize_result(self.service.start_ai_run(parse_params(request.params)?)?)
            }
            methods::AI_RUN_GET => {
                serialize_result(self.service.get_ai_run(parse_params(request.params)?)?)
            }
            methods::AI_RUN_LIST => {
                serialize_result(self.service.list_ai_runs(parse_params(request.params)?)?)
            }
            methods::AI_RUN_EVENTS => serialize_result(
                self.service
                    .list_ai_run_events(parse_params(request.params)?)?,
            ),
            methods::AI_RUN_CANCEL => {
                serialize_result(self.service.cancel_ai_run(parse_params(request.params)?)?)
            }
            methods::AI_RUN_RESUME => {
                serialize_result(self.service.resume_ai_run(parse_params(request.params)?)?)
            }
            methods::AI_RESULT_APPLY => serialize_result(
                self.service
                    .apply_ai_result(parse_params(request.params)?)?,
            ),
            methods::AI_BATCH_START => {
                serialize_result(self.service.start_ai_batch(parse_params(request.params)?)?)
            }
            methods::AI_BATCH_GET => {
                serialize_result(self.service.get_ai_batch(parse_params(request.params)?)?)
            }
            methods::AI_BATCH_LIST => serialize_result(
                self.service
                    .list_ai_batches(parse_params(request.params)?)?,
            ),
            methods::AI_BATCH_ITEMS => serialize_result(
                self.service
                    .list_ai_batch_items(parse_params(request.params)?)?,
            ),
            methods::AI_BATCH_CANCEL => serialize_result(
                self.service
                    .cancel_ai_batch(parse_params(request.params)?)?,
            ),
            methods::AI_BATCH_RESUME => serialize_result(
                self.service
                    .resume_ai_batch(parse_params(request.params)?)?,
            ),
            methods::AI_QUALITY_SCORE_DOCUMENT => serialize_result(
                self.service
                    .score_document_quality(parse_params(request.params)?)?,
            ),
            methods::AI_QUALITY_SEMANTIC_QA => serialize_result(
                self.service
                    .run_semantic_qa(parse_params(request.params)?)?,
            ),
            methods::AI_QUALITY_EXTRACT_TERMS => serialize_result(
                self.service
                    .extract_document_terms(parse_params(request.params)?)?,
            ),
            methods::AI_USAGE_QUERY => {
                serialize_result(self.service.query_ai_usage(parse_params(request.params)?)?)
            }
            methods::AI_CONVERSATION_LIST => serialize_result(
                self.service
                    .list_ai_conversations(parse_params(request.params)?)?,
            ),
            methods::AI_CONVERSATION_CREATE => serialize_result(
                self.service
                    .create_ai_conversation(parse_params(request.params)?)?,
            ),
            methods::AI_CONVERSATION_UPDATE => serialize_result(
                self.service
                    .update_ai_conversation(parse_params(request.params)?)?,
            ),
            methods::AI_CONVERSATION_MESSAGES => serialize_result(
                self.service
                    .list_ai_conversation_messages(parse_params(request.params)?)?,
            ),
            _ => Err(EngineError::InvalidRequest(format!(
                "unknown method {}",
                request.method
            ))),
        }
    }

    fn initialize(&mut self, params: InitializeParams) -> Result<Value> {
        if params.protocol_version != PROTOCOL_VERSION {
            return Err(EngineError::InvalidRequest(format!(
                "unsupported protocol version {}; expected {}",
                params.protocol_version, PROTOCOL_VERSION
            )));
        }
        self.initialized = true;
        serialize_result(InitializeResult {
            protocol_version: PROTOCOL_VERSION,
            engine_version: env!("CARGO_PKG_VERSION").to_string(),
            capabilities: vec![
                "docx".to_string(),
                "document.multi-file".to_string(),
                "filter.registry".to_string(),
                "history.operations".to_string(),
                "data.health".to_string(),
                "data.backup".to_string(),
                "pipeline.checkpoint".to_string(),
                "pipeline.document-qa".to_string(),
                "pipeline.ai-pretranslation".to_string(),
                "pipeline.resumable".to_string(),
                "project.lifecycle".to_string(),
                "project.templates".to_string(),
                "project.create-from-template".to_string(),
                "project.batch-import".to_string(),
                "project.archive-portable".to_string(),
                "discussion.threads".to_string(),
                "project.snapshots".to_string(),
                "task-package.offline-handoff".to_string(),
                "document.reimport".to_string(),
                "project.recycle".to_string(),
                "search.global".to_string(),
                "analysis.weighted-effort".to_string(),
                "analysis.project-operational".to_string(),
                "alignment.sessions".to_string(),
                "alignment.ai-refinement".to_string(),
                "alignment.tm-apply".to_string(),
                "reference-corpus".to_string(),
                "asset.catalog".to_string(),
                "asset.curation.offline".to_string(),
                "asset.curation.provider".to_string(),
                "asset.curation.rollback".to_string(),
                "asset.curation.export".to_string(),
                "plugin.runtime.v1".to_string(),
                "plugin.process.v1".to_string(),
                "plugin.filter.v1".to_string(),
                "plugin.local-install".to_string(),
                "plugin.control-plane.v1".to_string(),
                "plugin.manifest.v2".to_string(),
                "plugin.version-history.v1".to_string(),
                "plugin.upgrade.v1".to_string(),
                "plugin.rollback.v1".to_string(),
                "plugin.permissions.v1".to_string(),
                "plugin.qa-rule.v1".to_string(),
                "plugin.pipeline-step.v1".to_string(),
                "collab.local.v1".to_string(),
                "translation-memory.exact".to_string(),
                "translation-memory.library".to_string(),
                "translation-memory.fuzzy-cjk".to_string(),
                "translation-memory.concordance".to_string(),
                "translation-memory.exchange".to_string(),
                "termbase".to_string(),
                "termbase.exchange".to_string(),
                "qa.number-mismatch".to_string(),
                "qa.term-forbidden".to_string(),
                "qa.profiles".to_string(),
                "qa.mechanical-cjk".to_string(),
                "qa.terminology-consistency".to_string(),
                "qa.waivers".to_string(),
                "qa.reports.html-xlsx".to_string(),
                "qa.delivery-gate".to_string(),
                "editor.projection".to_string(),
                "editor.protected-tags".to_string(),
                "editor.chinese-conversion.opencc".to_string(),
                "editor.find-replace".to_string(),
                "editor.split-merge".to_string(),
                "editor.comments".to_string(),
                "editor.spell-fallback".to_string(),
                "editor.spell-hunspell".to_string(),
                "editor.undo-redo".to_string(),
                "editor.review".to_string(),
                "editor.review-queue-statistics".to_string(),
                "editor.workflow".to_string(),
                "editor.workflow-direct-signoff".to_string(),
                "editor.preferences".to_string(),
                "interop.review-docx".to_string(),
                "interop.bilingual-table".to_string(),
                "ai.provider.byok".to_string(),
                "ai.provider.openai-compatible".to_string(),
                "ai.grounding".to_string(),
                "ai.streaming-events".to_string(),
                "ai.batch-pretranslation".to_string(),
                "ai.usage".to_string(),
                "ai.credential.keyring".to_string(),
                "ai.quality.offline".to_string(),
            ],
        })
    }
}

pub fn invalid_rpc_response(message: impl Into<String>) -> RpcResponse {
    RpcResponse::failure(
        Value::Null,
        RpcError {
            code: ErrorCode::InvalidRequest,
            message: message.into(),
            data: None,
        },
    )
}

fn parse_params<T: DeserializeOwned>(value: Value) -> Result<T> {
    serde_json::from_value(value).map_err(|error| EngineError::InvalidRequest(error.to_string()))
}

fn serialize_result<T: Serialize>(value: T) -> Result<Value> {
    serde_json::to_value(value).map_err(|error| {
        EngineError::InvalidState(format!("failed to serialize engine result: {error}"))
    })
}

fn rpc_error(error: EngineError) -> RpcError {
    match error {
        EngineError::CredentialUnavailable(_message) => RpcError {
            code: ErrorCode::CredentialUnavailable,
            message: "operating-system credential storage is unavailable".to_string(),
            data: None,
        },
        EngineError::AiDisabled => RpcError {
            code: ErrorCode::AiDisabled,
            message: "AI requests are disabled for this workspace".to_string(),
            data: None,
        },
        EngineError::BudgetExceeded => RpcError {
            code: ErrorCode::BudgetExceeded,
            message: "the workspace AI token budget is exhausted".to_string(),
            data: None,
        },
        EngineError::Ai(AiCoreError::Authentication | AiCoreError::InvalidCredential) => RpcError {
            code: ErrorCode::ProviderAuthentication,
            message: "AI provider authentication failed".to_string(),
            data: None,
        },
        EngineError::Ai(AiCoreError::RateLimited { retry_after_ms }) => RpcError {
            code: ErrorCode::ProviderRateLimited,
            message: "AI provider rate limit was reached".to_string(),
            data: Some(json!({ "retryAfterMs": retry_after_ms })),
        },
        EngineError::Ai(AiCoreError::Timeout) => RpcError {
            code: ErrorCode::ProviderTimeout,
            message: "AI provider request timed out".to_string(),
            data: None,
        },
        EngineError::Ai(AiCoreError::Unavailable { retryable }) => RpcError {
            code: ErrorCode::ProviderUnavailable,
            message: "AI provider is unavailable".to_string(),
            data: Some(json!({ "retryable": retryable })),
        },
        EngineError::Ai(AiCoreError::Canceled) => RpcError {
            code: ErrorCode::InvalidState,
            message: "AI request was canceled".to_string(),
            data: None,
        },
        EngineError::Ai(
            AiCoreError::InvalidProfile(_)
            | AiCoreError::InvalidEndpoint(_)
            | AiCoreError::InvalidGrounding(_),
        ) => RpcError {
            code: ErrorCode::InvalidRequest,
            message: "AI request configuration is invalid".to_string(),
            data: None,
        },
        EngineError::Ai(
            AiCoreError::Protocol | AiCoreError::ResponseTooLarge | AiCoreError::EventSink,
        ) => RpcError {
            code: ErrorCode::ProviderProtocol,
            message: "AI provider returned an invalid response".to_string(),
            data: None,
        },
        EngineError::Curation(
            translunar_curation_core::CurationError::InvalidSemanticRefinement(_),
        ) => RpcError {
            code: ErrorCode::ProviderProtocol,
            message: "AI provider returned invalid curation annotations".to_string(),
            data: None,
        },
        EngineError::Curation(
            translunar_curation_core::CurationError::InvalidPolicy(message)
            | translunar_curation_core::CurationError::InvalidInput(message),
        ) => RpcError {
            code: ErrorCode::InvalidRequest,
            message,
            data: None,
        },
        EngineError::Curation(_) => RpcError {
            code: ErrorCode::ExportError,
            message: "curation dataset serialization failed".to_string(),
            data: None,
        },
        EngineError::CurationExport(message) => RpcError {
            code: ErrorCode::ExportError,
            message,
            data: None,
        },
        EngineError::PluginInvalidManifest(message) => RpcError {
            code: ErrorCode::PluginInvalidManifest,
            message,
            data: None,
        },
        EngineError::PluginUnsupportedVersion(message) => RpcError {
            code: ErrorCode::PluginUnsupportedVersion,
            message,
            data: None,
        },
        EngineError::PluginIncompatibleHost(message) => RpcError {
            code: ErrorCode::PluginIncompatibleHost,
            message,
            data: None,
        },
        EngineError::PluginCapabilityUnsupported(message) => RpcError {
            code: ErrorCode::PluginCapabilityUnsupported,
            message,
            data: None,
        },
        EngineError::PluginConflict(message) => RpcError {
            code: ErrorCode::PluginConflict,
            message,
            data: None,
        },
        EngineError::PluginPackageInvalid(message) => RpcError {
            code: ErrorCode::PluginPackageInvalid,
            message,
            data: None,
        },
        EngineError::PluginPackageHashMismatch(message) => RpcError {
            code: ErrorCode::PluginPackageHashMismatch,
            message,
            data: None,
        },
        EngineError::PluginUpgradeFailed(message) => RpcError {
            code: ErrorCode::PluginUpgradeFailed,
            message,
            data: None,
        },
        EngineError::PluginPermissionDenied(message) => RpcError {
            code: ErrorCode::PluginPermissionDenied,
            message,
            data: None,
        },
        EngineError::PluginCapabilityDenied(denial) => RpcError {
            code: ErrorCode::PluginPermissionDenied,
            message: denial.message,
            data: Some(json!({
                "denialCode": denial.code,
                "pluginId": denial.plugin_id,
                "versionId": denial.version_id,
                "capabilityId": denial.capability_id,
                "operation": denial.operation,
                "requestId": denial.request_id,
            })),
        },
        EngineError::PluginProcessFailed(message) => RpcError {
            code: ErrorCode::PluginProcessFailed,
            message,
            data: None,
        },
        EngineError::PluginSandboxFailed(message) => RpcError {
            code: ErrorCode::PluginSandboxFailed,
            message,
            data: None,
        },
        EngineError::PluginAiActionFailed {
            plugin_id,
            contribution_id,
            code,
            message,
        } => RpcError {
            code: ErrorCode::PluginSandboxFailed,
            message,
            data: Some(json!({
                "pluginId": plugin_id,
                "contributionId": contribution_id,
                "failureCode": code,
            })),
        },
        EngineError::Import(FilterError::PluginPermissionDenied {
            plugin_id,
            filter_id,
            operation,
            message,
        })
        | EngineError::CorpusImport(FilterError::PluginPermissionDenied {
            plugin_id,
            filter_id,
            operation,
            message,
        })
        | EngineError::Export(FilterError::PluginPermissionDenied {
            plugin_id,
            filter_id,
            operation,
            message,
        }) => RpcError {
            code: ErrorCode::PluginPermissionDenied,
            message,
            data: Some(json!({
                "pluginId": plugin_id,
                "filterId": filter_id,
                "operation": operation,
            })),
        },
        EngineError::Import(FilterError::PluginSandboxFailed {
            plugin_id,
            filter_id,
            operation,
            kind,
            message,
            ..
        })
        | EngineError::CorpusImport(FilterError::PluginSandboxFailed {
            plugin_id,
            filter_id,
            operation,
            kind,
            message,
            ..
        })
        | EngineError::Export(FilterError::PluginSandboxFailed {
            plugin_id,
            filter_id,
            operation,
            kind,
            message,
            ..
        }) => RpcError {
            code: ErrorCode::PluginSandboxFailed,
            message,
            data: Some(json!({
                "pluginId": plugin_id,
                "filterId": filter_id,
                "operation": operation,
                "failureKind": kind.as_str(),
                "retryable": matches!(
                    kind,
                    translunar_filter_core::PluginSandboxFailureKind::Timeout
                        | translunar_filter_core::PluginSandboxFailureKind::Cancelled
                ),
            })),
        },
        EngineError::Import(FilterError::PluginProcessFailed {
            plugin_id,
            filter_id,
            operation,
            kind,
            message,
            ..
        })
        | EngineError::CorpusImport(FilterError::PluginProcessFailed {
            plugin_id,
            filter_id,
            operation,
            kind,
            message,
            ..
        })
        | EngineError::Export(FilterError::PluginProcessFailed {
            plugin_id,
            filter_id,
            operation,
            kind,
            message,
            ..
        }) => RpcError {
            code: ErrorCode::PluginProcessFailed,
            message,
            data: Some(json!({
                "pluginId": plugin_id,
                "filterId": filter_id,
                "operation": operation,
                "failureKind": kind.as_str(),
                "retryable": false,
            })),
        },
        EngineError::CorpusImport(FilterError::NotFound(id)) => RpcError {
            code: ErrorCode::NotFound,
            message: format!("filter not found: {id}"),
            data: Some(json!({ "entity": "filter", "id": id })),
        },
        EngineError::CorpusImport(_) | EngineError::CorpusInput(_) => RpcError {
            code: ErrorCode::UnsupportedCorpusInput,
            message: "reference corpus input is unsupported or invalid".to_string(),
            data: None,
        },
        EngineError::Storage(StorageError::Alignment(AlignmentError::ResourceLimitExceeded {
            resource,
            limit,
            actual,
        })) => RpcError {
            code: ErrorCode::ResourceLimitExceeded,
            message: "alignment request exceeds a configured resource limit".to_string(),
            data: Some(json!({
                "resource": resource,
                "limit": limit,
                "actual": actual,
            })),
        },
        EngineError::Storage(StorageError::Alignment(
            AlignmentError::InvalidRefinementResponse { .. }
            | AlignmentError::InvalidRefinementConfidence { .. },
        )) => RpcError {
            code: ErrorCode::AlignmentResponseInvalid,
            message: "alignment refinement response is invalid".to_string(),
            data: None,
        },
        EngineError::Storage(StorageError::Alignment(_)) => RpcError {
            code: ErrorCode::AlignmentInvalidPartition,
            message: "alignment partition is invalid".to_string(),
            data: None,
        },
        EngineError::TaskPackage(TaskPackageError::ResourceLimit {
            resource,
            limit,
            actual,
        })
        | EngineError::Storage(StorageError::TaskPackage(TaskPackageError::ResourceLimit {
            resource,
            limit,
            actual,
        })) => RpcError {
            code: ErrorCode::ResourceLimit,
            message: "task package exceeds a configured resource limit".to_string(),
            data: Some(json!({
                "resource": resource,
                "limit": limit,
                "actual": actual,
            })),
        },
        EngineError::TaskPackage(TaskPackageError::InvalidInput(message))
        | EngineError::TaskPackage(TaskPackageError::InvalidPackage(message)) => RpcError {
            code: ErrorCode::InvalidRequest,
            message,
            data: None,
        },
        EngineError::Storage(StorageError::TaskPackage(error)) => RpcError {
            code: ErrorCode::InvalidRequest,
            message: error.to_string(),
            data: None,
        },
        EngineError::TaskPackageExport(message) => RpcError {
            code: ErrorCode::ExportError,
            message,
            data: None,
        },
        EngineError::Storage(StorageError::NotFound { entity, id }) => RpcError {
            code: ErrorCode::NotFound,
            message: format!("{entity} not found: {id}"),
            data: Some(json!({ "entity": entity, "id": id })),
        },
        EngineError::Storage(StorageError::Conflict {
            segment_id,
            expected_revision,
            actual_revision,
        }) => RpcError {
            code: ErrorCode::Conflict,
            message: "segment was modified by another writer".to_string(),
            data: Some(json!({
                "segmentId": segment_id,
                "expectedRevision": expected_revision,
                "actualRevision": actual_revision,
            })),
        },
        EngineError::Storage(StorageError::EntityConflict {
            entity,
            id,
            expected_revision,
            actual_revision,
        }) => RpcError {
            code: ErrorCode::Conflict,
            message: format!("{entity} was modified by another writer"),
            data: Some(json!({
                "entity": entity,
                "id": id,
                "expectedRevision": expected_revision,
                "actualRevision": actual_revision,
            })),
        },
        EngineError::QaGateBlocked {
            document_id,
            run_id,
            blocker_issue_ids,
            error_count,
            warning_count,
            info_count,
            waived_count,
        } => RpcError {
            code: ErrorCode::QaGateBlocked,
            message: "document export is blocked by open QA errors".to_string(),
            data: Some(json!({
                "documentId": document_id,
                "runId": run_id,
                "blockerIssueIds": blocker_issue_ids,
                "errorCount": error_count,
                "warningCount": warning_count,
                "infoCount": info_count,
                "waivedCount": waived_count,
            })),
        },
        EngineError::Storage(StorageError::QaProfileInvalid(message)) => RpcError {
            code: ErrorCode::QaProfileInvalid,
            message,
            data: None,
        },
        EngineError::ReportExport(message) => RpcError {
            code: ErrorCode::ReportExportError,
            message,
            data: None,
        },
        EngineError::Storage(StorageError::InvalidState(message))
        | EngineError::InvalidState(message) => RpcError {
            code: ErrorCode::InvalidState,
            message,
            data: None,
        },
        EngineError::PolicyDenied {
            project_id,
            profile_id,
        } => RpcError {
            code: ErrorCode::PolicyDenied,
            message: "the selected AI profile is not allowed for this project".to_string(),
            data: Some(allowlist::allowlist_denial_data(&project_id, &profile_id)),
        },
        EngineError::Import(FilterError::NotFound(id))
        | EngineError::Export(FilterError::NotFound(id)) => RpcError {
            code: ErrorCode::NotFound,
            message: format!("filter not found: {id}"),
            data: Some(json!({ "entity": "filter", "id": id })),
        },
        EngineError::Import(error) => RpcError {
            code: ErrorCode::UnsupportedDocument,
            message: error.to_string(),
            data: None,
        },
        EngineError::Export(error) => RpcError {
            code: ErrorCode::ExportError,
            message: error.to_string(),
            data: None,
        },
        EngineError::Asset(AssetError::Invalid { row, message }) => RpcError {
            code: ErrorCode::InvalidRequest,
            message: "asset exchange data is invalid".to_string(),
            data: Some(json!({ "row": row, "detail": message })),
        },
        EngineError::Asset(AssetError::Csv(error)) => RpcError {
            code: ErrorCode::InvalidRequest,
            message: "asset CSV data is invalid".to_string(),
            data: error
                .position()
                .map(|position| json!({ "row": position.line() })),
        },
        EngineError::Asset(AssetError::Xml(_error)) => RpcError {
            code: ErrorCode::InvalidRequest,
            message: "asset XML data is invalid".to_string(),
            data: None,
        },
        EngineError::Asset(AssetError::Io(error)) => RpcError {
            code: ErrorCode::StorageError,
            message: "asset exchange I/O failed".to_string(),
            data: Some(json!({ "kind": error.kind().to_string() })),
        },
        EngineError::InvalidRequest(message) => RpcError {
            code: ErrorCode::InvalidRequest,
            message,
            data: None,
        },
        EngineError::Storage(error) => RpcError {
            code: ErrorCode::StorageError,
            message: error.to_string(),
            data: None,
        },
        EngineError::Io(error) => RpcError {
            code: ErrorCode::StorageError,
            message: error.to_string(),
            data: None,
        },
        EngineError::Json(_) => RpcError {
            code: ErrorCode::InvalidRequest,
            message: "archive or request JSON is invalid".to_string(),
            data: None,
        },
    }
}

fn workflow_state_text(state: EditorWorkflowState) -> &'static str {
    match state {
        EditorWorkflowState::Translation => "translation",
        EditorWorkflowState::Review => "review",
        EditorWorkflowState::Signed => "signed",
    }
}

fn map_review_import_error(error: ReviewPackageError) -> EngineError {
    match error {
        ReviewPackageError::Io(error) => EngineError::Io(error),
        ReviewPackageError::Publish(error) => EngineError::Import(error),
        other => EngineError::Import(FilterError::Invalid(other.to_string())),
    }
}

fn map_review_export_error(error: ReviewPackageError) -> EngineError {
    match error {
        ReviewPackageError::Io(error) => EngineError::Io(error),
        ReviewPackageError::Publish(error) => EngineError::Export(error),
        other => EngineError::Export(FilterError::Processing(other.to_string())),
    }
}

fn map_bilingual_docx_error(error: DocxError) -> EngineError {
    match error {
        DocxError::Io(error) => EngineError::Io(error),
        other => EngineError::Import(FilterError::Invalid(other.to_string())),
    }
}

fn map_bilingual_xlsx_error(error: XlsxError) -> EngineError {
    match error {
        XlsxError::Io(error) => EngineError::Io(error),
        other => EngineError::Import(FilterError::Invalid(other.to_string())),
    }
}

fn extract_bilingual_rows(
    format: BilingualTableFormat,
    source: &Path,
) -> Result<Vec<BilingualInteropRow>> {
    match format {
        BilingualTableFormat::Docx => extract_bilingual_docx_rows(source)
            .map_err(map_bilingual_docx_error)
            .map(|rows| {
                rows.into_iter()
                    .map(|row| BilingualInteropRow {
                        group: row.table_index,
                        source_row: row.row_number,
                        structural_path: row.structural_path,
                        cells: row.cells,
                    })
                    .collect()
            }),
        BilingualTableFormat::Xlsx => extract_bilingual_xlsx_rows(source)
            .map_err(map_bilingual_xlsx_error)
            .and_then(|rows| {
                rows.into_iter()
                    .map(|row: BilingualXlsxTableRow| {
                        Ok(BilingualInteropRow {
                            group: u32::try_from(row.sheet_index).map_err(|_| {
                                EngineError::InvalidState(
                                    "XLSX sheet index exceeds the supported range".to_string(),
                                )
                            })?,
                            source_row: row.row_number,
                            structural_path: row.structural_path,
                            cells: row.cells,
                        })
                    })
                    .collect()
            }),
    }
}

fn table_format_id(format: BilingualTableFormat) -> &'static str {
    match format {
        BilingualTableFormat::Docx => "bilingual-docx",
        BilingualTableFormat::Xlsx => "bilingual-xlsx",
    }
}

fn table_format_from_path(
    requested: Option<BilingualTableFormat>,
    source: &Path,
) -> Result<BilingualTableFormat> {
    let inferred = match source
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
        .as_deref()
    {
        Some("docx") => Some(BilingualTableFormat::Docx),
        Some("xlsx") => Some(BilingualTableFormat::Xlsx),
        _ => None,
    };
    let format = requested.or(inferred).ok_or_else(|| {
        EngineError::InvalidRequest(
            "table preview requires a DOCX or XLSX input (or an explicit format)".to_string(),
        )
    })?;
    if let Some(inferred) = inferred
        && inferred != format
    {
        return Err(EngineError::InvalidRequest(
            "table preview format does not match the input extension".to_string(),
        ));
    }
    Ok(format)
}

fn is_bilingual_header_cells(cells: &[String]) -> bool {
    let source = cells
        .first()
        .map(|value| value.trim().to_ascii_lowercase())
        .unwrap_or_default();
    let target = cells
        .get(1)
        .map(|value| value.trim().to_ascii_lowercase())
        .unwrap_or_default();
    matches!(source.as_str(), "source" | "source text" | "原文")
        && matches!(
            target.as_str(),
            "target" | "target text" | "translation" | "译文"
        )
}

fn table_row_id(
    input_sha256: &str,
    source_row: u32,
    source_hash: &str,
    target_hash: &str,
) -> String {
    let mut identity =
        Vec::with_capacity(input_sha256.len() + source_hash.len() + target_hash.len() + 16);
    identity.extend_from_slice(input_sha256.as_bytes());
    identity.extend_from_slice(source_row.to_string().as_bytes());
    identity.extend_from_slice(source_hash.as_bytes());
    identity.extend_from_slice(target_hash.as_bytes());
    sha256_hex(&identity)
}

fn classify_table_rows(
    store: &Store,
    library_id: &str,
    _project_id: &str,
    input_sha256: &str,
    _format: BilingualTableFormat,
    rows: Vec<BilingualInteropRow>,
) -> Result<Vec<NewInteropPreviewRow>> {
    let existing = store.export_tm_units(library_id)?;
    let mut existing_keys = BTreeSet::new();
    for unit in existing {
        existing_keys.insert((
            exact_key(&unit.source_text),
            sha256_hex(normalize_match_key(&unit.target_text).as_bytes()),
        ));
    }
    let mut seen_groups = BTreeSet::new();
    let mut headers = BTreeMap::<u32, Vec<String>>::new();
    let mut seen_keys = BTreeSet::new();
    let mut seen_row_ids = BTreeSet::new();
    let mut output = Vec::new();
    let mut ordinal = 0_u32;
    for row in rows {
        if seen_groups.insert(row.group) && is_bilingual_header_cells(&row.cells) {
            headers.insert(row.group, row.cells);
            continue;
        }
        let source = row.cells.first().cloned().unwrap_or_default();
        let target = row.cells.get(1).cloned().unwrap_or_default();
        let source_hash = review_source_hash(&source);
        let target_hash = sha256_hex(normalize_match_key(&target).as_bytes());
        let row_id = table_row_id(input_sha256, row.source_row, &source_hash, &target_hash);
        if !seen_row_ids.insert(row_id.clone()) {
            return Err(EngineError::Import(FilterError::Invalid(
                "bilingual table contains an ambiguous stable row identity".to_string(),
            )));
        }
        let mut diagnostics = Vec::new();
        let mut metadata = BTreeMap::new();
        if let Some(header) = headers.get(&row.group) {
            for (index, value) in row.cells.iter().enumerate().skip(2) {
                if let Some(name) = header.get(index).filter(|name| !name.trim().is_empty()) {
                    metadata.insert(name.clone(), value.clone());
                }
            }
        }
        metadata.insert(
            INTEROP_STRUCTURAL_PATH_METADATA.to_string(),
            row.structural_path.clone(),
        );
        let metadata_json = match serde_json::to_string(&metadata) {
            Ok(value) if value.len() <= 1024 * 1024 => value,
            Ok(_) => {
                diagnostics.push("row metadata exceeds 1 MiB".to_string());
                "{}".to_string()
            }
            Err(error) => {
                diagnostics.push(format!("row metadata is invalid: {error}"));
                "{}".to_string()
            }
        };
        let key = (exact_key(&source), target_hash);
        let duplicate_existing = existing_keys.contains(&key);
        let duplicate_input = !seen_keys.insert(key);
        let disposition = if source.trim().is_empty() || target.trim().is_empty() {
            diagnostics.push("source and target cells are required".to_string());
            "invalid"
        } else if duplicate_existing || duplicate_input {
            diagnostics.push(if duplicate_existing {
                "row duplicates an existing TM unit".to_string()
            } else {
                "row duplicates an earlier input row".to_string()
            });
            "duplicate"
        } else if !diagnostics.is_empty() {
            "invalid"
        } else {
            "valid"
        };
        output.push(NewInteropPreviewRow {
            row_id,
            ordinal,
            source_row: row.source_row,
            segment_id: None,
            expected_segment_revision: None,
            source_hash,
            source_text: source,
            target_text: target,
            current_target: String::new(),
            comments: String::new(),
            current_comments: String::new(),
            status_context: String::new(),
            current_status: String::new(),
            metadata_json,
            source_path_hash: sha256_hex(row.structural_path.as_bytes()),
            disposition: disposition.to_string(),
            diagnostics_json: serde_json::to_string(&diagnostics)?,
        });
        ordinal = ordinal
            .checked_add(1)
            .ok_or_else(|| EngineError::InvalidState("table row ordinal overflow".to_string()))?;
    }
    if output.is_empty() {
        return Err(EngineError::Import(FilterError::Invalid(
            "bilingual table contains no data rows".to_string(),
        )));
    }
    Ok(output)
}

fn classify_review_rows(
    _document: &Document,
    current_rows: &[SegmentEditorRow],
    parsed: &ParsedReviewPackage,
) -> Result<Vec<NewInteropPreviewRow>> {
    let mut current_by_segment = BTreeMap::<String, &SegmentEditorRow>::new();
    for row in current_rows {
        current_by_segment.insert(row.segment.id.clone(), row);
    }
    let mut bindings = BTreeMap::new();
    let mut bound_segments = BTreeSet::new();
    for binding in &parsed.manifest.rows {
        if !bound_segments.insert(binding.segment_id.clone()) {
            return Err(EngineError::InvalidRequest(
                "review manifest contains an ambiguous segment identity".to_string(),
            ));
        }
        if let Some(current) = current_by_segment.get(&binding.segment_id)
            && current.segment.revision != binding.segment_revision
        {
            return Err(StorageError::Conflict {
                segment_id: binding.segment_id.clone(),
                expected_revision: binding.segment_revision,
                actual_revision: current.segment.revision,
            }
            .into());
        }
        bindings.insert(binding.row_id.clone(), binding);
    }
    let mut seen_rows = BTreeSet::new();
    let mut output = Vec::new();
    let mut next_added_ordinal = parsed
        .manifest
        .rows
        .iter()
        .map(|row| row.ordinal)
        .max()
        .unwrap_or(0)
        .saturating_add(1);
    for (index, parsed_row) in parsed.rows.iter().enumerate() {
        let source_row = u32::try_from(index.saturating_add(1)).map_err(|_| {
            EngineError::InvalidState("review source row number overflow".to_string())
        })?;
        let Some(binding) = bindings.get(&parsed_row.row_id).copied() else {
            let mut diagnostics = parsed_row.diagnostics.clone();
            diagnostics.push("row identity is not bound by the review manifest".to_string());
            output.push(NewInteropPreviewRow {
                row_id: parsed_row.row_id.clone(),
                ordinal: next_added_ordinal,
                source_row,
                segment_id: None,
                expected_segment_revision: None,
                source_hash: review_source_hash(&parsed_row.source_text),
                source_text: parsed_row.source_text.clone(),
                target_text: parsed_row.target_text.clone(),
                current_target: String::new(),
                comments: parsed_row.comments.clone(),
                current_comments: String::new(),
                status_context: parsed_row.status.clone(),
                current_status: String::new(),
                metadata_json: "{}".to_string(),
                source_path_hash: String::new(),
                disposition: "added".to_string(),
                diagnostics_json: serde_json::to_string(&diagnostics)?,
            });
            next_added_ordinal = next_added_ordinal.saturating_add(1);
            continue;
        };
        seen_rows.insert(parsed_row.row_id.clone());
        let current = current_by_segment.get(&binding.segment_id).copied();
        let Some(current) = current else {
            let mut diagnostics = parsed_row.diagnostics.clone();
            diagnostics.push("bound segment is no longer present in the document".to_string());
            output.push(NewInteropPreviewRow {
                row_id: binding.row_id.clone(),
                ordinal: binding.ordinal,
                source_row,
                segment_id: None,
                expected_segment_revision: None,
                source_hash: binding.source_hash.clone(),
                source_text: parsed_row.source_text.clone(),
                target_text: parsed_row.target_text.clone(),
                current_target: String::new(),
                comments: parsed_row.comments.clone(),
                current_comments: String::new(),
                status_context: parsed_row.status.clone(),
                current_status: String::new(),
                metadata_json: "{}".to_string(),
                source_path_hash: String::new(),
                disposition: "missing".to_string(),
                diagnostics_json: serde_json::to_string(&diagnostics)?,
            });
            continue;
        };
        let current_status = workflow_state_text(current.workflow_state).to_string();
        let current_comments = interop_comment_context(&current.comments);
        let mut diagnostics = parsed_row.diagnostics.clone();
        if !parsed_row.source_hash_valid
            || review_source_hash(&parsed_row.source_text) != binding.source_hash
            || current.segment.source_hash != binding.source_hash
            || current.segment.ordinal != binding.ordinal
        {
            diagnostics
                .push("immutable source or row binding does not match the manifest".to_string());
        }
        if !matches!(
            parsed_row.status.as_str(),
            "translation" | "review" | "signed"
        ) {
            diagnostics.push("workflow status is unsupported".to_string());
        }
        if current_comments != parsed_row.comments
            && !current_comments.is_empty()
            && parsed_row.comments.trim().is_empty()
        {
            diagnostics
                .push("existing comments cannot be deleted by an offline review".to_string());
        }
        let target_changed = parsed_row.target_text != current.segment.target_text;
        if target_changed && (!current.source_tags.is_empty() || !current.target_tags.is_empty()) {
            diagnostics.push(
                "offline target edits are unsupported for protected-tag segments".to_string(),
            );
        }
        if target_changed && parsed_row.status == "signed" {
            diagnostics.push("a target change cannot be signed in the same apply".to_string());
        }
        let disposition = if !diagnostics.is_empty() {
            "invalid"
        } else if target_changed
            || parsed_row.comments != current_comments
            || parsed_row.status != current_status
        {
            "changed"
        } else {
            "unchanged"
        };
        output.push(NewInteropPreviewRow {
            row_id: binding.row_id.clone(),
            ordinal: binding.ordinal,
            source_row,
            segment_id: Some(binding.segment_id.clone()),
            expected_segment_revision: Some(binding.segment_revision),
            source_hash: binding.source_hash.clone(),
            source_text: parsed_row.source_text.clone(),
            target_text: parsed_row.target_text.clone(),
            current_target: current.segment.target_text.clone(),
            comments: parsed_row.comments.clone(),
            current_comments,
            status_context: parsed_row.status.clone(),
            current_status,
            metadata_json: "{}".to_string(),
            source_path_hash: String::new(),
            disposition: disposition.to_string(),
            diagnostics_json: serde_json::to_string(&diagnostics)?,
        });
    }
    for binding in &parsed.manifest.rows {
        if seen_rows.contains(&binding.row_id) {
            continue;
        }
        let current = current_by_segment.get(&binding.segment_id).copied();
        let (segment_id, expected_revision, source_text, current_target, comments, status) =
            current
                .map(|row| {
                    (
                        Some(binding.segment_id.clone()),
                        Some(binding.segment_revision),
                        row.segment.source_text.clone(),
                        row.segment.target_text.clone(),
                        interop_comment_context(&row.comments),
                        workflow_state_text(row.workflow_state).to_string(),
                    )
                })
                .unwrap_or_else(|| {
                    (
                        None,
                        None,
                        String::new(),
                        String::new(),
                        String::new(),
                        String::new(),
                    )
                });
        output.push(NewInteropPreviewRow {
            row_id: binding.row_id.clone(),
            ordinal: binding.ordinal,
            source_row: binding.ordinal.saturating_add(1),
            segment_id,
            expected_segment_revision: expected_revision,
            source_hash: binding.source_hash.clone(),
            source_text,
            target_text: current_target.clone(),
            current_target,
            comments: comments.clone(),
            current_comments: comments,
            status_context: status.clone(),
            current_status: status,
            metadata_json: "{}".to_string(),
            source_path_hash: String::new(),
            disposition: "missing".to_string(),
            diagnostics_json: serde_json::to_string(&vec![
                "review row is missing from the package".to_string(),
            ])?,
        });
    }
    output.sort_by_key(|row| (row.ordinal, row.row_id.clone()));
    if output.is_empty() {
        return Err(EngineError::Import(FilterError::Invalid(
            "review package contains no rows".to_string(),
        )));
    }
    Ok(output)
}

fn protocol_review_preview_result(
    store: &Store,
    preview: InteropPreviewRecord,
    offset: u32,
    limit: u32,
) -> Result<ReviewPreviewResult> {
    let (rows, total) = store.list_interop_preview_rows(&preview.id, offset, limit)?;
    let document_id = preview.document_id.clone().ok_or_else(|| {
        EngineError::InvalidState("review preview has no document identity".to_string())
    })?;
    Ok(ReviewPreviewResult {
        preview_id: preview.id,
        project_id: preview.project_id,
        document_id,
        expected_document_revision: preview.expected_revision,
        input_sha256: preview.input_sha256,
        input_format: preview.input_format,
        manifest_hash: preview.manifest_hash,
        status: protocol_interop_preview_status(preview.status),
        rows: rows
            .into_iter()
            .map(protocol_review_preview_row)
            .collect::<Result<Vec<_>>>()?,
        total,
        offset,
        limit,
    })
}

fn protocol_review_preview_row(row: InteropPreviewRowRecord) -> Result<ReviewPreviewRow> {
    let diagnostics = serde_json::from_str::<Vec<String>>(&row.diagnostics_json)?;
    let disposition = match row.disposition.as_str() {
        "changed" => ReviewInteropDisposition::Changed,
        "unchanged" => ReviewInteropDisposition::Unchanged,
        "missing" => ReviewInteropDisposition::Missing,
        "added" => ReviewInteropDisposition::Added,
        "invalid" => ReviewInteropDisposition::Invalid,
        value => {
            return Err(EngineError::InvalidState(format!(
                "stored review preview has unknown disposition {value}"
            )));
        }
    };
    Ok(ReviewPreviewRow {
        row_id: row.row_id,
        ordinal: row.ordinal,
        source_row: row.source_row,
        segment_id: row.segment_id,
        expected_segment_revision: row.expected_segment_revision,
        source_hash: row.source_hash,
        source_text: row.source_text,
        target_text: row.target_text,
        current_target: row.current_target,
        comments: row.comments,
        current_comments: row.current_comments,
        status_context: row.status_context,
        current_status: row.current_status,
        disposition,
        diagnostics,
    })
}

fn protocol_table_preview_result(
    store: &Store,
    preview: InteropPreviewRecord,
    offset: u32,
    limit: u32,
) -> Result<TablePreviewResult> {
    let (rows, total) = store.list_interop_preview_rows(&preview.id, offset, limit)?;
    let library_id = preview.library_id.clone().ok_or_else(|| {
        EngineError::InvalidState("table preview has no TM library identity".to_string())
    })?;
    let source_locale = preview.source_locale.clone().ok_or_else(|| {
        EngineError::InvalidState("table preview has no source locale".to_string())
    })?;
    let target_locale = preview.target_locale.clone().ok_or_else(|| {
        EngineError::InvalidState("table preview has no target locale".to_string())
    })?;
    Ok(TablePreviewResult {
        preview_id: preview.id,
        project_id: preview.project_id,
        library_id,
        expected_library_revision: preview.expected_revision,
        input_sha256: preview.input_sha256,
        input_format: preview.input_format,
        source_locale,
        target_locale,
        status: protocol_interop_preview_status(preview.status),
        rows: rows
            .into_iter()
            .map(protocol_table_preview_row)
            .collect::<Result<Vec<_>>>()?,
        total,
        offset,
        limit,
    })
}

fn protocol_table_preview_row(row: InteropPreviewRowRecord) -> Result<TablePreviewRow> {
    let mut metadata = serde_json::from_str::<BTreeMap<String, String>>(&row.metadata_json)?;
    let structural_path = metadata
        .remove(INTEROP_STRUCTURAL_PATH_METADATA)
        .ok_or_else(|| {
            EngineError::InvalidState("stored table preview has no structural path".to_string())
        })?;
    let diagnostics = serde_json::from_str::<Vec<String>>(&row.diagnostics_json)?;
    let disposition = match row.disposition.as_str() {
        "valid" => TableInteropDisposition::Valid,
        "duplicate" => TableInteropDisposition::Duplicate,
        "invalid" => TableInteropDisposition::Invalid,
        value => {
            return Err(EngineError::InvalidState(format!(
                "stored table preview has unknown disposition {value}"
            )));
        }
    };
    Ok(TablePreviewRow {
        row_id: row.row_id,
        ordinal: row.ordinal,
        source_row: row.source_row,
        structural_path,
        source_hash: row.source_hash,
        source_path_hash: row.source_path_hash,
        source_text: row.source_text,
        target_text: row.target_text,
        metadata,
        disposition,
        diagnostics,
    })
}

fn protocol_interop_preview_status(
    status: translunar_storage::InteropPreviewStatus,
) -> InteropPreviewStatus {
    match status {
        translunar_storage::InteropPreviewStatus::Open => InteropPreviewStatus::Open,
        translunar_storage::InteropPreviewStatus::Applied => InteropPreviewStatus::Applied,
        translunar_storage::InteropPreviewStatus::Discarded => InteropPreviewStatus::Discarded,
    }
}

fn protocol_interop_apply_result(result: StorageInteropApplyResult) -> Result<InteropApplyResult> {
    let status = match result.status.as_str() {
        "applied" => InteropPreviewStatus::Applied,
        "open" => InteropPreviewStatus::Open,
        "discarded" => InteropPreviewStatus::Discarded,
        value => {
            return Err(EngineError::InvalidState(format!(
                "stored interop apply result has unknown status {value}"
            )));
        }
    };
    Ok(InteropApplyResult {
        preview_id: result.preview_id,
        status,
        applied_count: result.applied_count,
        skipped_count: result.skipped_count,
        current_revision: result.current_revision,
        operation_id: result.operation_id,
        review_ids: result.review_ids,
        comment_ids: result.comment_ids,
        tm_unit_ids: result.tm_unit_ids,
    })
}

fn copy_and_hash(source: &Path, destination: &mut File) -> Result<String> {
    let mut reader = BufReader::new(File::open(source)?);
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let count = reader.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        hasher.update(&buffer[..count]);
        destination.write_all(&buffer[..count])?;
    }
    Ok(format!("{:x}", hasher.finalize()))
}

#[cfg(test)]
mod curation_tests;

#[cfg(test)]
mod tests {
    use serde_json::json;
    use tempfile::TempDir;
    use translunar_domain::{ChineseConversionProfile, QaIssueStatus, SegmentState};
    use translunar_filter_core::DocumentFilter;
    use translunar_filter_docx::fixture;
    use translunar_filter_pptx::fixture as pptx_fixture;
    use translunar_filter_xlsx::fixture as xlsx_fixture;
    use translunar_protocol::{BatchImportItem, ClientInfo};

    use super::*;

    struct TestContext {
        root: TempDir,
        source: PathBuf,
    }

    impl TestContext {
        fn new() -> Self {
            let root = tempfile::tempdir().expect("temporary directory");
            let source = root.path().join("source.docx");
            fixture::write_fixture(&source).expect("write DOCX fixture");
            Self { root, source }
        }

        fn project(service: &mut EngineService) -> Project {
            service
                .create_project(CreateProjectParams {
                    name: "Retention".to_string(),
                    source_locale: "en-US".to_string(),
                    target_locale: "zh-CN".to_string(),
                    domain: "legal".to_string(),
                })
                .expect("create project")
        }
    }

    fn reference_corpus_import_request(
        project: &Project,
        source_path: &Path,
        name: &str,
        kind: ReferenceCorpusKind,
        filter_id: &str,
    ) -> ReferenceCorpusImportRequest {
        ReferenceCorpusImportRequest {
            project_id: project.id.clone(),
            expected_project_revision: project.revision,
            source_path: source_path.to_path_buf(),
            name: name.to_string(),
            kind,
            source_locale: project.source_locale.clone(),
            target_locale: project.target_locale.clone(),
            filter_id: Some(filter_id.to_string()),
            options: BTreeMap::new(),
            actor: "corpus-engine-test".to_string(),
            reason: "import filtered reference corpus fixture".to_string(),
            correlation_id: Some("corpus-engine-correlation".to_string()),
        }
    }

    fn managed_source_names(root: &Path) -> BTreeSet<String> {
        fs::read_dir(root.join("sources"))
            .expect("read managed sources")
            .map(|entry| {
                entry
                    .expect("read managed source entry")
                    .file_name()
                    .to_string_lossy()
                    .into_owned()
            })
            .collect()
    }

    fn test_qa_override() -> translunar_protocol::QaOverrideInput {
        translunar_protocol::QaOverrideInput {
            actor: "integration-test".to_string(),
            reason: "Fixture intentionally preserves untranslated or mechanically dirty rows"
                .to_string(),
        }
    }

    #[test]
    fn protocol_alignment_and_corpus_projections_hide_internal_fields() {
        let apply = storage::AlignmentApplyResult {
            session_id: "session-1".to_string(),
            library_id: "library-1".to_string(),
            status: storage::AlignmentSessionStatus::Applied,
            selected_count: 1,
            inserted_count: 1,
            duplicate_count: 0,
            session_revision: 3,
            library_revision: 4,
            operation_id: "operation-1".to_string(),
            tm_unit_ids: vec!["unit-1".to_string()],
            duplicates: Vec::new(),
        };
        let session = storage::AlignmentSessionRecord {
            id: "session-1".to_string(),
            project_id: "project-1".to_string(),
            source_document_id: "source-1".to_string(),
            target_document_id: "target-1".to_string(),
            source_document_revision: 2,
            target_document_revision: 5,
            source_locale: "en-US".to_string(),
            target_locale: "zh-CN".to_string(),
            algorithm_version: "fixture".to_string(),
            status: storage::AlignmentSessionStatus::Applied,
            revision: 3,
            terminal_result: Some(json!({
                "requestFingerprint": "must-not-cross-the-wire",
                "result": serde_json::to_value(&apply).expect("serialize terminal result")
            })),
            created_at_ms: 1,
            updated_at_ms: 2,
            closed_at_ms: Some(2),
        };
        let projected =
            serde_json::to_value(protocol_alignment_session(session).expect("project session"))
                .expect("serialize projected session");
        assert_eq!(projected["terminalResult"]["sessionId"], "session-1");
        assert!(
            projected["terminalResult"]
                .get("requestFingerprint")
                .is_none()
        );

        let entry = storage::ReferenceCorpusEntryRecord {
            id: "entry-1".to_string(),
            corpus_id: "corpus-1".to_string(),
            ordinal: 0,
            source_text: "Invoice".to_string(),
            target_text: "发票".to_string(),
            normalized_source: "invoice".to_string(),
            normalized_target: "发票".to_string(),
            structural_path: "txt:0".to_string(),
            provenance: json!({"mappedSide": "both"}),
            created_at_ms: 1,
            updated_at_ms: 1,
        };
        let projected_entry = serde_json::to_value(protocol_reference_corpus_entry(entry))
            .expect("serialize projected corpus entry");
        assert!(projected_entry.get("normalizedSource").is_none());
        assert!(projected_entry.get("normalizedTarget").is_none());
        assert_eq!(projected_entry["structuralPath"], "txt:0");
    }

    #[test]
    fn alignment_and_corpus_errors_are_typed_and_redacted() {
        let limit = rpc_error(EngineError::Storage(StorageError::Alignment(
            AlignmentError::ResourceLimitExceeded {
                resource: translunar_alignment_core::AlignmentResource::WorkUnits,
                limit: 10,
                actual: 11,
            },
        )));
        assert_eq!(limit.code, ErrorCode::ResourceLimitExceeded);
        assert_eq!(
            limit.data.as_ref().and_then(|data| data.get("resource")),
            Some(&json!("workUnits"))
        );
        assert_eq!(
            limit.data.as_ref().and_then(|data| data.get("limit")),
            Some(&json!(10))
        );

        let invalid_response = rpc_error(EngineError::Storage(StorageError::Alignment(
            AlignmentError::InvalidRefinementResponse {
                message: "provider echoed source text".to_string(),
            },
        )));
        assert_eq!(invalid_response.code, ErrorCode::AlignmentResponseInvalid);
        assert!(!invalid_response.message.contains("source text"));

        let corpus = rpc_error(EngineError::CorpusImport(FilterError::NoMatch(
            "secret corpus body".to_string(),
        )));
        assert_eq!(corpus.code, ErrorCode::UnsupportedCorpusInput);
        assert!(!corpus.message.contains("secret corpus body"));

        let missing_filter = rpc_error(EngineError::CorpusImport(FilterError::NotFound(
            "builtin.missing".to_string(),
        )));
        assert_eq!(missing_filter.code, ErrorCode::NotFound);
        assert_eq!(
            missing_filter
                .data
                .as_ref()
                .and_then(|data| data.get("entity")),
            Some(&json!("filter"))
        );
    }

    fn dispatcher_call<P: serde::Serialize>(
        dispatcher: &mut RpcDispatcher,
        id: u64,
        method: &str,
        params: P,
    ) -> RpcResponse {
        dispatcher.handle(RpcRequest {
            jsonrpc: "2.0".to_string(),
            id: json!(id),
            method: method.to_string(),
            params: serde_json::to_value(params).expect("serialize RPC params"),
        })
    }

    fn dispatcher_result<T: serde::de::DeserializeOwned>(response: RpcResponse) -> T {
        if let Some(error) = response.error {
            panic!("unexpected RPC error: {error:?}");
        }
        serde_json::from_value(response.result.expect("RPC result")).expect("decode RPC result")
    }

    #[test]
    fn dispatcher_exposes_restart_safe_discussions_and_snapshot_restore() {
        let context = TestContext::new();
        let mut dispatcher = RpcDispatcher::open(context.root.path()).expect("open dispatcher");
        let initialized: InitializeResult = dispatcher_result(dispatcher_call(
            &mut dispatcher,
            1,
            methods::INITIALIZE,
            InitializeParams {
                protocol_version: PROTOCOL_VERSION,
                client: ClientInfo {
                    name: "discussion-snapshot-test".to_string(),
                    version: "1".to_string(),
                },
            },
        ));
        assert!(
            initialized
                .capabilities
                .iter()
                .any(|capability| capability == "discussion.threads")
        );
        assert!(
            initialized
                .capabilities
                .iter()
                .any(|capability| capability == "project.snapshots")
        );
        let project: Project = dispatcher_result(dispatcher_call(
            &mut dispatcher,
            2,
            methods::PROJECT_CREATE,
            CreateProjectParams {
                name: "Discussion snapshot".to_string(),
                source_locale: "en-US".to_string(),
                target_locale: "zh-CN".to_string(),
                domain: "general".to_string(),
            },
        ));
        let document: Document = dispatcher_result(dispatcher_call(
            &mut dispatcher,
            3,
            methods::DOCUMENT_IMPORT_DOCX,
            ImportDocxParams {
                project_id: project.id.clone(),
                source_path: context.source.to_string_lossy().into_owned(),
            },
        ));
        let segments: SegmentPage = dispatcher_result(dispatcher_call(
            &mut dispatcher,
            4,
            methods::SEGMENT_LIST,
            SegmentListParams {
                document_id: document.id.clone(),
                offset: 0,
                limit: 10,
            },
        ));
        let segment = segments.items.first().expect("imported segment").clone();

        for (id, scope, document_id, segment_id) in [
            (5, DiscussionScope::Project, None, None),
            (
                6,
                DiscussionScope::Document,
                Some(document.id.clone()),
                None,
            ),
            (
                7,
                DiscussionScope::Segment,
                Some(document.id.clone()),
                Some(segment.id.clone()),
            ),
        ] {
            let _: DiscussionThread = dispatcher_result(dispatcher_call(
                &mut dispatcher,
                id,
                methods::DISCUSSION_THREAD_CREATE,
                DiscussionThreadCreateParams {
                    project_id: project.id.clone(),
                    scope,
                    document_id,
                    segment_id,
                    title: format!("{scope:?} discussion"),
                    body: "Ask @Reviewer for context.".to_string(),
                    actor: "author".to_string(),
                    reason: "create discussion".to_string(),
                    expected_project_revision: project.revision,
                },
            ));
        }
        let thread_page: DiscussionThreadPage = dispatcher_result(dispatcher_call(
            &mut dispatcher,
            8,
            methods::DISCUSSION_THREAD_LIST,
            DiscussionThreadListParams {
                project_id: project.id.clone(),
                scope: Some(DiscussionScope::Segment),
                document_id: Some(document.id.clone()),
                segment_id: Some(segment.id.clone()),
                include_resolved: false,
                offset: 0,
                limit: 10,
            },
        ));
        assert_eq!(thread_page.total, 1);
        let thread = thread_page.items[0].clone();
        let reply: DiscussionMessage = dispatcher_result(dispatcher_call(
            &mut dispatcher,
            9,
            methods::DISCUSSION_MESSAGE_CREATE,
            DiscussionMessageCreateParams {
                thread_id: thread.id.clone(),
                body: "Answer from @Owner.".to_string(),
                actor: "reviewer".to_string(),
                reason: "reply".to_string(),
                expected_thread_revision: thread.revision,
            },
        ));
        let edited: DiscussionMessage = dispatcher_result(dispatcher_call(
            &mut dispatcher,
            10,
            methods::DISCUSSION_MESSAGE_UPDATE,
            DiscussionMessageUpdateParams {
                message_id: reply.id.clone(),
                body: "Updated answer from @Owner.".to_string(),
                actor: "reviewer".to_string(),
                reason: "clarify reply".to_string(),
                expected_revision: reply.revision,
            },
        ));
        let deleted: DiscussionMessage = dispatcher_result(dispatcher_call(
            &mut dispatcher,
            11,
            methods::DISCUSSION_MESSAGE_DELETE,
            DiscussionMessageDeleteParams {
                message_id: edited.id.clone(),
                actor: "reviewer".to_string(),
                reason: "withdraw reply".to_string(),
                expected_revision: edited.revision,
            },
        ));
        assert!(deleted.deleted);
        let resolved: DiscussionThread = dispatcher_result(dispatcher_call(
            &mut dispatcher,
            12,
            methods::DISCUSSION_THREAD_RESOLVE,
            DiscussionThreadResolveParams {
                thread_id: thread.id.clone(),
                resolved: true,
                expected_revision: deleted.thread_revision,
                actor: "author".to_string(),
                reason: "close thread".to_string(),
            },
        ));
        let reopened: DiscussionThread = dispatcher_result(dispatcher_call(
            &mut dispatcher,
            13,
            methods::DISCUSSION_THREAD_RESOLVE,
            DiscussionThreadResolveParams {
                thread_id: thread.id.clone(),
                resolved: false,
                expected_revision: resolved.revision,
                actor: "author".to_string(),
                reason: "reopen thread".to_string(),
            },
        ));
        assert_eq!(reopened.status, DiscussionStatus::Open);

        let snapshot: NamedProjectSnapshot = dispatcher_result(dispatcher_call(
            &mut dispatcher,
            14,
            methods::PROJECT_SNAPSHOT_CREATE,
            ProjectSnapshotCreateParams {
                project_id: project.id.clone(),
                name: "review baseline".to_string(),
                expected_project_revision: project.revision,
                actor: "author".to_string(),
                reason: "capture review state".to_string(),
            },
        ));
        let changed: Segment = dispatcher_result(dispatcher_call(
            &mut dispatcher,
            15,
            methods::SEGMENT_UPDATE_TARGET,
            UpdateTargetParams {
                segment_id: segment.id.clone(),
                target_text: "Changed after snapshot".to_string(),
                expected_revision: segment.revision,
            },
        ));
        assert_eq!(changed.target_text, "Changed after snapshot");
        let preview: ProjectSnapshotPreview = dispatcher_result(dispatcher_call(
            &mut dispatcher,
            16,
            methods::PROJECT_SNAPSHOT_PREVIEW_RESTORE,
            ProjectSnapshotPreviewRestoreParams {
                snapshot_id: snapshot.id.clone(),
                expected_project_revision: project.revision,
            },
        ));
        assert_eq!(preview.summary.segments_changed, 1);
        let restored: ProjectSnapshotRestoreResult = dispatcher_result(dispatcher_call(
            &mut dispatcher,
            17,
            methods::PROJECT_SNAPSHOT_RESTORE,
            ProjectSnapshotRestoreParams {
                preview_id: preview.preview_id,
                expected_project_revision: project.revision,
                actor: "author".to_string(),
                reason: "restore review baseline".to_string(),
            },
        ));
        assert_eq!(restored.status, ProjectSnapshotPreviewStatus::Applied);
        assert_eq!(restored.project_revision, project.revision + 1);

        drop(dispatcher);
        let mut restarted = RpcDispatcher::open(context.root.path()).expect("restart dispatcher");
        let _: InitializeResult = dispatcher_result(dispatcher_call(
            &mut restarted,
            18,
            methods::INITIALIZE,
            InitializeParams {
                protocol_version: PROTOCOL_VERSION,
                client: ClientInfo {
                    name: "discussion-snapshot-test".to_string(),
                    version: "1".to_string(),
                },
            },
        ));
        let messages: DiscussionMessagePage = dispatcher_result(dispatcher_call(
            &mut restarted,
            19,
            methods::DISCUSSION_MESSAGE_LIST,
            DiscussionMessageListParams {
                thread_id: thread.id,
                include_deleted: true,
                offset: 0,
                limit: 10,
            },
        ));
        assert_eq!(messages.total, 2);
        assert_eq!(messages.items[0].mentions, vec!["@reviewer"]);
        assert!(messages.items[1].deleted);
        let snapshots: ProjectSnapshotPage = dispatcher_result(dispatcher_call(
            &mut restarted,
            20,
            methods::PROJECT_SNAPSHOT_LIST,
            ProjectSnapshotListParams {
                project_id: project.id,
                offset: 0,
                limit: 10,
            },
        ));
        assert_eq!(snapshots.total, 1);
        let restored_segments: SegmentPage = dispatcher_result(dispatcher_call(
            &mut restarted,
            21,
            methods::SEGMENT_LIST,
            SegmentListParams {
                document_id: document.id,
                offset: 0,
                limit: 10,
            },
        ));
        assert_eq!(restored_segments.items[0].target_text, "");
    }

    #[test]
    fn dispatcher_exposes_alignment_and_reference_corpus_lifecycle() {
        let context = TestContext::new();
        let source_txt = context.root.path().join("alignment-source.txt");
        let target_txt = context.root.path().join("alignment-target.txt");
        fs::write(&source_txt, "Invoice 42.\n\nTotal 100.").expect("write source alignment input");
        fs::write(&target_txt, "Invoice 42.\n\nTotal 100.").expect("write target alignment input");

        let mut dispatcher = RpcDispatcher::open(context.root.path()).expect("open dispatcher");
        let initialized: InitializeResult = dispatcher_result(dispatcher_call(
            &mut dispatcher,
            1,
            methods::INITIALIZE,
            InitializeParams {
                protocol_version: PROTOCOL_VERSION,
                client: ClientInfo {
                    name: "alignment-corpus-test".to_string(),
                    version: "1".to_string(),
                },
            },
        ));
        assert!(
            initialized
                .capabilities
                .iter()
                .any(|capability| capability == "alignment.sessions")
        );
        assert!(
            initialized
                .capabilities
                .iter()
                .any(|capability| capability == "reference-corpus")
        );

        let project: Project = dispatcher_result(dispatcher_call(
            &mut dispatcher,
            2,
            methods::PROJECT_CREATE,
            CreateProjectParams {
                name: "Alignment protocol project".to_string(),
                source_locale: "en-US".to_string(),
                target_locale: "zh-CN".to_string(),
                domain: "general".to_string(),
            },
        ));
        let source_document: ImportDocumentResult = dispatcher_result(dispatcher_call(
            &mut dispatcher,
            3,
            methods::DOCUMENT_IMPORT,
            ImportDocumentParams {
                project_id: project.id.clone(),
                source_path: source_txt.to_string_lossy().into_owned(),
                relative_path: Some("alignment-source.txt".to_string()),
                filter_id: Some("builtin.txt".to_string()),
                options: BTreeMap::new(),
            },
        ));
        let target_document: ImportDocumentResult = dispatcher_result(dispatcher_call(
            &mut dispatcher,
            4,
            methods::DOCUMENT_IMPORT,
            ImportDocumentParams {
                project_id: project.id.clone(),
                source_path: target_txt.to_string_lossy().into_owned(),
                relative_path: Some("alignment-target.txt".to_string()),
                filter_id: Some("builtin.txt".to_string()),
                options: BTreeMap::new(),
            },
        ));

        let created: protocol::AlignmentSessionCreateResult = dispatcher_result(dispatcher_call(
            &mut dispatcher,
            5,
            methods::ALIGNMENT_SESSION_CREATE,
            protocol::AlignmentSessionCreateParams {
                project_id: project.id.clone(),
                source_document_id: source_document.document.id.clone(),
                target_document_id: target_document.document.id.clone(),
                expected_project_revision: project.revision,
                expected_source_document_revision: source_document.document.revision,
                expected_target_document_revision: target_document.document.revision,
                options: Default::default(),
                actor: "protocol-test".to_string(),
                reason: "create deterministic alignment".to_string(),
                correlation_id: Some("alignment-correlation".to_string()),
            },
        ));
        assert!(created.link_count > 0);

        let listed: protocol::AlignmentSessionPage = dispatcher_result(dispatcher_call(
            &mut dispatcher,
            6,
            methods::ALIGNMENT_SESSION_LIST,
            protocol::AlignmentSessionListParams {
                project_id: project.id.clone(),
                status: None,
                offset: 0,
                limit: 50,
            },
        ));
        assert_eq!(listed.total, 1);

        let initial: protocol::AlignmentSessionGetResult = dispatcher_result(dispatcher_call(
            &mut dispatcher,
            7,
            methods::ALIGNMENT_SESSION_GET,
            protocol::AlignmentSessionGetParams {
                session_id: created.session.id.clone(),
                link_status: None,
                offset: 0,
                limit: 50,
            },
        ));
        let candidate = initial.links.first().expect("alignment candidate").clone();

        let refine_error = dispatcher_call(
            &mut dispatcher,
            8,
            methods::ALIGNMENT_SESSION_REFINE,
            protocol::AlignmentSessionRefineParams {
                session_id: created.session.id.clone(),
                expected_session_revision: initial.session.revision,
                links: vec![protocol::AlignmentExpectedLinkRevision {
                    link_id: candidate.id.clone(),
                    expected_revision: candidate.revision,
                }],
                profile_id: "missing-profile".to_string(),
                max_attempts: 1,
                actor: "protocol-test".to_string(),
                reason: "try optional refinement".to_string(),
                correlation_id: None,
            },
        );
        let refine_error = refine_error
            .error
            .expect("refinement should fail without profile");
        assert_ne!(refine_error.code, ErrorCode::InvalidRequest);

        let updated: protocol::AlignmentMutationResult = dispatcher_result(dispatcher_call(
            &mut dispatcher,
            9,
            methods::ALIGNMENT_SESSION_UPDATE,
            protocol::AlignmentSessionUpdateParams {
                session_id: created.session.id.clone(),
                expected_session_revision: initial.session.revision,
                mutation: protocol::AlignmentSessionMutation::SetStatus {
                    link_id: candidate.id.clone(),
                    expected_link_revision: candidate.revision,
                    status: translunar_alignment_core::AlignmentLinkStatus::Confirmed,
                },
                actor: "protocol-test".to_string(),
                reason: "confirm deterministic candidate".to_string(),
                correlation_id: None,
            },
        ));
        let confirmed = updated
            .links
            .iter()
            .find(|link| link.id == candidate.id)
            .expect("confirmed link");
        assert_eq!(
            confirmed.status,
            translunar_alignment_core::AlignmentLinkStatus::Confirmed
        );

        let libraries: protocol::TmLibraryPage = dispatcher_result(dispatcher_call(
            &mut dispatcher,
            10,
            methods::TM_LIBRARY_LIST,
            TmLibraryListParams {
                project_id: Some(project.id.clone()),
                offset: 0,
                limit: 50,
            },
        ));
        let library = libraries
            .items
            .iter()
            .find(|library| library.writable)
            .expect("default writable TM library")
            .clone();
        let applied: protocol::AlignmentApplyResult = dispatcher_result(dispatcher_call(
            &mut dispatcher,
            11,
            methods::ALIGNMENT_SESSION_APPLY,
            protocol::AlignmentSessionApplyParams {
                session_id: created.session.id.clone(),
                library_id: library.id.clone(),
                expected_session_revision: updated.session.revision,
                expected_library_revision: library.revision,
                links: vec![protocol::AlignmentExpectedLinkRevision {
                    link_id: confirmed.id.clone(),
                    expected_revision: confirmed.revision,
                }],
                actor: "protocol-test".to_string(),
                reason: "apply selected alignment".to_string(),
                correlation_id: None,
            },
        ));
        assert_eq!(applied.status, protocol::AlignmentSessionStatus::Applied);

        let terminal: protocol::AlignmentSessionGetResult = dispatcher_result(dispatcher_call(
            &mut dispatcher,
            12,
            methods::ALIGNMENT_SESSION_GET,
            protocol::AlignmentSessionGetParams {
                session_id: created.session.id.clone(),
                link_status: None,
                offset: 0,
                limit: 50,
            },
        ));
        let terminal_json =
            serde_json::to_value(&terminal.session).expect("serialize terminal session");
        assert!(
            terminal_json["terminalResult"]
                .get("requestFingerprint")
                .is_none()
        );

        let from_alignment: protocol::ReferenceCorpusMutationResult =
            dispatcher_result(dispatcher_call(
                &mut dispatcher,
                13,
                methods::CORPUS_FROM_ALIGNMENT,
                protocol::CorpusFromAlignmentParams {
                    project_id: project.id.clone(),
                    expected_project_revision: project.revision,
                    session_id: created.session.id.clone(),
                    expected_session_revision: applied.session_revision,
                    name: "Applied alignment corpus".to_string(),
                    links: vec![protocol::AlignmentExpectedLinkRevision {
                        link_id: confirmed.id.clone(),
                        expected_revision: confirmed.revision,
                    }],
                    actor: "protocol-test".to_string(),
                    reason: "mount confirmed alignment as corpus".to_string(),
                    correlation_id: None,
                },
            ));
        let corpus_list: protocol::ReferenceCorpusPage = dispatcher_result(dispatcher_call(
            &mut dispatcher,
            14,
            methods::CORPUS_LIST,
            protocol::CorpusListParams {
                project_id: project.id.clone(),
                status: Some(protocol::ReferenceCorpusStatus::Active),
                offset: 0,
                limit: 50,
            },
        ));
        assert_eq!(corpus_list.total, 1);
        let search: protocol::CorpusSearchResult = dispatcher_result(dispatcher_call(
            &mut dispatcher,
            15,
            methods::CORPUS_SEARCH,
            protocol::CorpusSearchParams {
                project_id: project.id.clone(),
                query: "Invoice".to_string(),
                side: protocol::CorpusSearchSide::Both,
                corpus_ids: vec![from_alignment.corpus.id.clone()],
                offset: 0,
                limit: 50,
            },
        ));
        assert_eq!(search.total, 1);
        assert!(search.items[0].entry.provenance["alignmentSessionId"].is_string());
        assert!(
            serde_json::to_value(&search.items[0].entry)
                .expect("serialize corpus hit")
                .get("normalizedSource")
                .is_none()
        );

        let reindexed: protocol::ReferenceCorpusMutationResult =
            dispatcher_result(dispatcher_call(
                &mut dispatcher,
                16,
                methods::CORPUS_REINDEX,
                protocol::CorpusMutationParams {
                    corpus_id: from_alignment.corpus.id.clone(),
                    expected_revision: from_alignment.corpus.revision,
                    actor: "protocol-test".to_string(),
                    reason: "rebuild corpus index".to_string(),
                    correlation_id: None,
                },
            ));
        let removed: protocol::ReferenceCorpusMutationResult = dispatcher_result(dispatcher_call(
            &mut dispatcher,
            17,
            methods::CORPUS_REMOVE,
            protocol::CorpusMutationParams {
                corpus_id: reindexed.corpus.id.clone(),
                expected_revision: reindexed.corpus.revision,
                actor: "protocol-test".to_string(),
                reason: "remove corpus mount".to_string(),
                correlation_id: None,
            },
        ));
        assert_eq!(
            removed.corpus.status,
            protocol::ReferenceCorpusStatus::Removed
        );

        let imported: protocol::ReferenceCorpusMutationResult = dispatcher_result(dispatcher_call(
            &mut dispatcher,
            18,
            methods::CORPUS_IMPORT,
            protocol::CorpusImportParams {
                project_id: project.id.clone(),
                expected_project_revision: project.revision,
                source_path: source_txt.to_string_lossy().into_owned(),
                name: "File source corpus".to_string(),
                kind: protocol::ReferenceCorpusKind::MonolingualSource,
                source_locale: project.source_locale.clone(),
                target_locale: project.target_locale.clone(),
                filter_id: Some("builtin.txt".to_string()),
                options: BTreeMap::new(),
                actor: "protocol-test".to_string(),
                reason: "import file corpus".to_string(),
                correlation_id: None,
            },
        ));
        assert_eq!(imported.corpus.entry_count, 2);
        let active_after_remove: protocol::ReferenceCorpusPage =
            dispatcher_result(dispatcher_call(
                &mut dispatcher,
                19,
                methods::CORPUS_LIST,
                protocol::CorpusListParams {
                    project_id: project.id,
                    status: Some(protocol::ReferenceCorpusStatus::Active),
                    offset: 0,
                    limit: 50,
                },
            ));
        assert_eq!(active_after_remove.total, 1);
    }

    fn rewrite_review_source(source: &Path, output: &Path, from: &str, to: &str) {
        let mut archive =
            ZipArchive::new(File::open(source).expect("open review ZIP")).expect("read review ZIP");
        let mut writer = ZipWriter::new(File::create(output).expect("create tampered review"));
        for index in 0..archive.len() {
            let mut entry = archive.by_index(index).expect("read review entry");
            let name = entry.name().to_string();
            let options = SimpleFileOptions::default().compression_method(entry.compression());
            let mut bytes = Vec::new();
            entry.read_to_end(&mut bytes).expect("read review part");
            if name == "word/document.xml" {
                let xml = String::from_utf8(bytes).expect("review document XML is UTF-8");
                let changed = xml.replacen(from, to, 1);
                assert_ne!(changed, xml, "source fixture text must be present");
                bytes = changed.into_bytes();
            }
            writer.start_file(name, options).expect("start review part");
            writer.write_all(&bytes).expect("write review part");
        }
        writer.finish().expect("finish tampered review");
    }

    fn replace_review_part(bytes: &[u8], part: &str, replacement: &[u8]) -> Vec<u8> {
        let mut archive = ZipArchive::new(std::io::Cursor::new(bytes)).expect("read review ZIP");
        let mut writer = ZipWriter::new(std::io::Cursor::new(Vec::new()));
        let mut replaced = false;
        for index in 0..archive.len() {
            let mut entry = archive.by_index(index).expect("read review entry");
            let name = entry.name().to_string();
            let options = SimpleFileOptions::default().compression_method(entry.compression());
            let mut content = Vec::new();
            entry.read_to_end(&mut content).expect("read review part");
            if name == part {
                content = replacement.to_vec();
                replaced = true;
            }
            writer.start_file(name, options).expect("start review part");
            writer.write_all(&content).expect("write review part");
        }
        assert!(replaced, "review part must exist");
        writer.finish().expect("finish review ZIP").into_inner()
    }

    struct NonResumableStep;

    impl PipelineStep for NonResumableStep {
        fn descriptor(&self) -> StepDescriptor {
            StepDescriptor {
                id: "test.nonresumable".to_string(),
                version: "1".to_string(),
                display_name: "Non-resumable test step".to_string(),
                input: ArtifactKind::None,
                output: ArtifactKind::Json,
                config_schema_version: 1,
                resumable: false,
                cancellable: false,
            }
        }

        fn execute(
            &self,
            _context: StepExecutionContext,
        ) -> std::result::Result<StepOutcome, PipelineError> {
            Ok(StepOutcome {
                output: json!({ "completed": true }),
                checkpoint: None,
                usage: None,
            })
        }
    }

    struct TestPluginPipelineStep {
        id: String,
        delay_ms: u64,
        started: Arc<AtomicBool>,
        publish_intermediate: bool,
    }

    struct InterruptingCheckpointStep {
        id: String,
        resumed: Arc<AtomicBool>,
    }

    struct MigratingCheckpointStep {
        id: String,
        migrated: Arc<AtomicBool>,
    }

    impl PipelineStep for MigratingCheckpointStep {
        fn descriptor(&self) -> StepDescriptor {
            StepDescriptor {
                id: self.id.clone(),
                version: "2.0.0".to_string(),
                display_name: "Migrating checkpoint step".to_string(),
                input: ArtifactKind::Json,
                output: ArtifactKind::Json,
                config_schema_version: 1,
                resumable: true,
                cancellable: true,
            }
        }

        fn execute(
            &self,
            context: StepExecutionContext,
        ) -> std::result::Result<StepOutcome, PipelineError> {
            if context.checkpoint != Some(json!({ "cursor": 1, "migrated": true })) {
                return Err(PipelineError::Execution(
                    "migrated checkpoint was not restored".to_string(),
                ));
            }
            Ok(StepOutcome {
                output: json!({ "resumed": true }),
                checkpoint: Some(json!({ "cursor": 2, "migrated": true })),
                usage: Some(json!({ "workUnits": 1 })),
            })
        }

        fn migrate_checkpoint(
            &self,
            context: StepCheckpointMigrationContext,
        ) -> std::result::Result<StepCheckpointMigrationOutcome, PipelineError> {
            assert_eq!(context.source_schema_version, 2);
            assert_eq!(context.target_schema_version, 1);
            assert_eq!(context.checkpoint, json!({ "cursor": 1 }));
            self.migrated.store(true, Ordering::Release);
            Ok(StepCheckpointMigrationOutcome {
                checkpoint: json!({ "cursor": 1, "migrated": true }),
                usage: Some(json!({ "workUnits": 1 })),
            })
        }
    }

    impl PipelineStep for InterruptingCheckpointStep {
        fn descriptor(&self) -> StepDescriptor {
            StepDescriptor {
                id: self.id.clone(),
                version: "1.0.0".to_string(),
                display_name: "Interrupting checkpoint step".to_string(),
                input: ArtifactKind::Json,
                output: ArtifactKind::Json,
                config_schema_version: 1,
                resumable: true,
                cancellable: true,
            }
        }

        fn execute(
            &self,
            context: StepExecutionContext,
        ) -> std::result::Result<StepOutcome, PipelineError> {
            if context.checkpoint != Some(json!({ "cursor": 1 })) {
                return Err(PipelineError::Execution(
                    "resume checkpoint was not restored".to_string(),
                ));
            }
            self.resumed.store(true, Ordering::Release);
            Ok(StepOutcome {
                output: json!({ "resumed": true }),
                checkpoint: Some(json!({ "cursor": 2 })),
                usage: Some(json!({ "workUnits": 1 })),
            })
        }

        fn execute_with_checkpoint_sink(
            &self,
            context: StepExecutionContext,
            checkpoint_sink: Option<StepCheckpointSink>,
        ) -> std::result::Result<StepOutcome, PipelineError> {
            if context.checkpoint.is_none() {
                checkpoint_sink
                    .ok_or_else(|| {
                        PipelineError::Execution("checkpoint sink was not provided".to_string())
                    })?
                    .publish(json!({ "cursor": 1 }))?;
                return Err(PipelineError::Canceled);
            }
            self.execute(context)
        }
    }

    impl PipelineStep for TestPluginPipelineStep {
        fn descriptor(&self) -> StepDescriptor {
            StepDescriptor {
                id: self.id.clone(),
                version: "1.0.0".to_string(),
                display_name: "Test plugin pipeline step".to_string(),
                input: ArtifactKind::Json,
                output: ArtifactKind::Json,
                config_schema_version: 1,
                resumable: true,
                cancellable: true,
            }
        }

        fn execute(
            &self,
            context: StepExecutionContext,
        ) -> std::result::Result<StepOutcome, PipelineError> {
            self.started.store(true, Ordering::Release);
            let deadline = Instant::now() + Duration::from_millis(self.delay_ms);
            while Instant::now() < deadline {
                if context.cancellation.load(Ordering::Acquire) {
                    return Err(PipelineError::Canceled);
                }
                thread::sleep(Duration::from_millis(5));
            }
            Ok(StepOutcome {
                output: json!({ "plugin": true, "input": context.input }),
                checkpoint: Some(json!({ "cursor": 1 })),
                usage: Some(json!({ "units": 1 })),
            })
        }

        fn execute_with_checkpoint_sink(
            &self,
            context: StepExecutionContext,
            checkpoint_sink: Option<StepCheckpointSink>,
        ) -> std::result::Result<StepOutcome, PipelineError> {
            if self.publish_intermediate
                && let Some(sink) = checkpoint_sink
            {
                sink.publish(json!({ "cursor": 0 }))?;
            }
            self.execute(context)
        }
    }

    fn test_plugin_pipeline_owner(step_id: &str, activation_revision: u64) -> PipelineStepOwner {
        test_plugin_pipeline_owner_with_schema(step_id, activation_revision, 1)
    }

    fn test_plugin_pipeline_owner_with_schema(
        step_id: &str,
        activation_revision: u64,
        checkpoint_schema_version: u32,
    ) -> PipelineStepOwner {
        PipelineStepOwner::Plugin {
            plugin_id: "example.pipeline-test".to_string(),
            version_id: format!("version-{activation_revision}"),
            activation_revision,
            contribution_id: step_id.to_string(),
            contribution_version: "1.0.0".to_string(),
            descriptor_version: 1,
            operation_protocol_version: 1,
            config_schema_version: 1,
            checkpoint_schema_version: Some(checkpoint_schema_version),
            tier: translunar_pipeline::PluginPipelineTier::Sandbox,
            descriptor_hash: format!("{activation_revision:064x}"),
        }
    }

    fn wait_for_pipeline_terminal(
        service: &EngineService,
        run_id: &str,
    ) -> ProtocolPipelineRunSnapshot {
        let mut snapshot = service
            .get_pipeline_run(PipelineRunIdParams {
                run_id: run_id.to_string(),
            })
            .expect("read pipeline run");
        for _ in 0..200 {
            if snapshot.run.status.is_terminal() {
                return snapshot;
            }
            thread::sleep(Duration::from_millis(10));
            snapshot = service
                .get_pipeline_run(PipelineRunIdParams {
                    run_id: run_id.to_string(),
                })
                .expect("poll pipeline run");
        }
        snapshot
    }

    #[test]
    fn complete_service_flow_survives_restart() {
        let context = TestContext::new();
        let project;
        let document;
        let draft;
        {
            let mut service = EngineService::open(context.root.path()).expect("open engine");
            project = TestContext::project(&mut service);
            document = service
                .import_docx(ImportDocxParams {
                    project_id: project.id.clone(),
                    source_path: context.source.to_string_lossy().into_owned(),
                })
                .expect("import DOCX");
            assert_eq!(document.segment_count, 3);
            let page = service
                .list_segments(SegmentListParams {
                    document_id: document.id.clone(),
                    offset: 0,
                    limit: 200,
                })
                .expect("list segments");
            draft = service
                .update_target(UpdateTargetParams {
                    segment_id: page.items[0].id.clone(),
                    target_text: "保留期为 60 天。".to_string(),
                    expected_revision: 0,
                })
                .expect("save draft");
        }

        let mut service = EngineService::open(context.root.path()).expect("reopen engine");
        let recovered = service
            .list_segments(SegmentListParams {
                document_id: document.id.clone(),
                offset: 0,
                limit: 200,
            })
            .expect("recover segments");
        assert_eq!(recovered.items[0], draft);
        let confirmation = service
            .confirm_segment(ConfirmSegmentParams {
                segment_id: draft.id.clone(),
                expected_revision: draft.revision,
            })
            .expect("confirm segment");
        assert_eq!(confirmation.segment.state, SegmentState::Confirmed);
        assert!(confirmation.qa_issues.iter().any(|issue| {
            issue.evidence.source_numbers == ["30"] && issue.evidence.target_numbers == ["60"]
        }));

        let exact = service
            .lookup_exact(ExactLookupParams {
                project_id: project.id.clone(),
                source_text: draft.source_text.clone(),
            })
            .expect("lookup TM");
        assert_eq!(exact.matches.len(), 1);

        let corrected = service
            .update_target(UpdateTargetParams {
                segment_id: draft.id.clone(),
                target_text: "保留期为 30 天。".to_string(),
                expected_revision: confirmation.segment.revision,
            })
            .expect("correct target");
        service
            .confirm_segment(ConfirmSegmentParams {
                segment_id: corrected.id,
                expected_revision: corrected.revision,
            })
            .expect("confirm correction");
        let issues = service
            .list_qa(ListQaParams {
                document_id: document.id.clone(),
                include_resolved: true,
            })
            .expect("list QA");
        assert!(issues.issues.iter().any(|issue| {
            matches!(
                issue.rule_id.as_str(),
                "number-mismatch" | "qa.number-mismatch"
            ) && issue.status == QaIssueStatus::Resolved
        }));
        assert!(issues.issues.iter().all(|issue| {
            !matches!(
                issue.rule_id.as_str(),
                "number-mismatch" | "qa.number-mismatch"
            ) || issue.status == QaIssueStatus::Resolved
        }));

        let output = context.root.path().join("translated.docx");
        let exported = service
            .export_docx(ExportDocxParams {
                document_id: document.id,
                output_path: output.to_string_lossy().into_owned(),
                qa_override: Some(test_qa_override()),
            })
            .expect("export DOCX");
        assert_eq!(exported.translated_segments, 1);
        let exported_units = DocxFilter
            .extract_units(&output)
            .expect("reopen exported DOCX");
        assert_eq!(exported_units[0].source_text, "保留期为 30 天。");
        assert_eq!(
            exported_units[2].source_text,
            "This paragraph remains untranslated."
        );
    }

    #[test]
    fn reference_corpus_import_maps_txt_source_and_target_and_survives_restart() {
        let context = TestContext::new();
        let source_txt = context.root.path().join("source-corpus.txt");
        let target_txt = context.root.path().join("target-corpus.txt");
        fs::write(&source_txt, "Alpha source.\n\nBeta source.").expect("write source corpus TXT");
        fs::write(&target_txt, "阿尔法表达。\n\n贝塔表达。").expect("write target corpus TXT");
        let project_id;
        let source_corpus_id;
        let target_corpus_id;
        {
            let mut service = EngineService::open(context.root.path()).expect("open engine");
            let project = TestContext::project(&mut service);
            project_id = project.id.clone();
            let before = managed_source_names(context.root.path());
            let mut source_request = reference_corpus_import_request(
                &project,
                &source_txt,
                "Source expressions",
                ReferenceCorpusKind::MonolingualSource,
                "builtin.txt",
            );
            source_request
                .options
                .insert("segmentationMode".to_string(), "paragraph".to_string());
            let source = service
                .import_reference_corpus(source_request)
                .expect("import source monolingual corpus");
            source_corpus_id = source.corpus.id.clone();
            assert_eq!(source.corpus.kind, ReferenceCorpusKind::MonolingualSource);
            assert_eq!(
                source.corpus.input_filter_id.as_deref(),
                Some("builtin.txt")
            );
            assert_eq!(source.corpus.input_format.as_deref(), Some("txt"));
            assert_eq!(source.corpus.entry_count, 2);
            let source_entries = service
                .store
                .list_reference_corpus_entries(&source.corpus.id, 0, 10)
                .expect("list source corpus entries")
                .0;
            assert!(
                source_entries
                    .iter()
                    .all(|entry| !entry.source_text.is_empty() && entry.target_text.is_empty())
            );
            assert_eq!(source_entries[0].provenance["mappedSide"], "source");
            assert_eq!(source_entries[0].provenance["inputFilterId"], "builtin.txt");

            let mut target_request = reference_corpus_import_request(
                &project,
                &target_txt,
                "Target expressions",
                ReferenceCorpusKind::MonolingualTarget,
                "builtin.txt",
            );
            target_request
                .options
                .insert("segmentationMode".to_string(), "paragraph".to_string());
            let target = service
                .import_reference_corpus(target_request)
                .expect("import target monolingual corpus");
            target_corpus_id = target.corpus.id.clone();
            assert_eq!(target.corpus.kind, ReferenceCorpusKind::MonolingualTarget);
            let target_entries = service
                .store
                .list_reference_corpus_entries(&target.corpus.id, 0, 10)
                .expect("list target corpus entries")
                .0;
            assert!(
                target_entries
                    .iter()
                    .all(|entry| entry.source_text.is_empty() && !entry.target_text.is_empty())
            );
            assert_eq!(target_entries[0].provenance["mappedSide"], "target");
            let after = managed_source_names(context.root.path());
            assert_eq!(after.len(), before.len() + 2);
            assert!(
                source
                    .corpus
                    .managed_source_path
                    .as_deref()
                    .is_some_and(|path| context.root.path().join(path).is_file())
            );
            assert!(
                target
                    .corpus
                    .managed_source_path
                    .as_deref()
                    .is_some_and(|path| context.root.path().join(path).is_file())
            );
        }

        let service = EngineService::open(context.root.path()).expect("restart engine");
        let (corpora, total) = service
            .store
            .list_reference_corpora(&project_id, None, 0, 10)
            .expect("list restarted corpora");
        assert_eq!(total, 2);
        assert!(corpora.iter().any(|corpus| corpus.id == source_corpus_id));
        assert!(corpora.iter().any(|corpus| corpus.id == target_corpus_id));
        assert_eq!(
            service
                .store
                .list_reference_corpus_entries(&source_corpus_id, 0, 10)
                .expect("reload source entries")
                .1,
            2
        );
        assert_eq!(
            service
                .store
                .list_reference_corpus_entries(&target_corpus_id, 0, 10)
                .expect("reload target entries")
                .1,
            2
        );
    }

    #[test]
    fn concordance_adds_authoritative_corpus_results_without_changing_tm_totals() {
        let context = TestContext::new();
        let corpus_path = context.root.path().join("concordance-corpus.txt");
        fs::write(
            &corpus_path,
            "Alpha corpus phrase\n\nAlpha corpus phrase extended",
        )
        .expect("write concordance corpus");
        let mut service = EngineService::open(context.root.path()).expect("open engine");
        let project = TestContext::project(&mut service);
        let library = service
            .store
            .list_tm_libraries(Some(&project.id), 0, 10)
            .expect("list default TM libraries")
            .0
            .into_iter()
            .find(|library| library.writable)
            .expect("default writable TM library");
        service
            .store
            .import_tm_units(
                &library.id,
                &[TmExchangeUnit {
                    source_locale: project.source_locale.clone(),
                    target_locale: project.target_locale.clone(),
                    source_text: "Alpha corpus phrase".to_string(),
                    target_text: "阿尔法语料表达".to_string(),
                    domain: Some(project.domain.clone()),
                    author: Some("concordance-test".to_string()),
                    created_at_ms: Some(1),
                    metadata: BTreeMap::new(),
                }],
            )
            .expect("seed concordance TM unit");
        let request = ConcordanceParams {
            project_id: project.id.clone(),
            query: "Alpha corpus phrase".to_string(),
            side: translunar_asset_core::ConcordanceSide::Both,
            offset: 0,
            limit: 50,
        };
        let baseline = service
            .concordance(request.clone())
            .expect("read TM-only concordance");
        assert_eq!(baseline.total, 1);
        assert_eq!(baseline.hits.len(), 1);
        assert_eq!(baseline.corpus_total, 0);
        assert!(baseline.corpus_hits.is_empty());

        let corpus = service
            .import_reference_corpus(reference_corpus_import_request(
                &project,
                &corpus_path,
                "Concordance reference",
                ReferenceCorpusKind::MonolingualSource,
                "builtin.txt",
            ))
            .expect("import concordance corpus")
            .corpus;
        let direct = service
            .search_reference_corpora(protocol::CorpusSearchParams {
                project_id: project.id,
                query: request.query.clone(),
                side: protocol::CorpusSearchSide::Both,
                corpus_ids: Vec::new(),
                offset: request.offset,
                limit: request.limit,
            })
            .expect("search authoritative corpus results");
        let result = service
            .concordance(request)
            .expect("read additive concordance");

        assert_eq!(result.total, baseline.total);
        assert_eq!(result.hits.len(), baseline.hits.len());
        assert_eq!(result.hits[0].unit.id, baseline.hits[0].unit.id);
        assert_eq!(result.corpus_total, direct.total);
        assert_eq!(result.corpus_total, 2);
        assert_eq!(result.corpus_hits[0].corpus.id, corpus.id);
        assert_eq!(
            result.corpus_hits[0].match_kind,
            protocol::CorpusMatchKind::Exact
        );
        assert_eq!(
            serde_json::to_value(&result.corpus_hits).expect("serialize concordance corpus hits"),
            serde_json::to_value(&direct.items).expect("serialize direct corpus hits")
        );
    }

    #[test]
    fn bilingual_reference_corpus_requires_authoritative_xliff_targets_and_locales() {
        let context = TestContext::new();
        let missing_target = context.root.path().join("missing-target.xliff");
        let wrong_locale = context.root.path().join("wrong-locale.xliff");
        let valid = context.root.path().join("valid-corpus.xliff");
        fs::write(
            &missing_target,
            r#"<?xml version="1.0"?><xliff version="1.2"><file source-language="en-US" target-language="zh-CN"><body><trans-unit id="u1"><source>Hello</source><target>你好</target></trans-unit><trans-unit id="u2"><source>Bye</source></trans-unit></body></file></xliff>"#,
        )
        .expect("write missing-target XLIFF");
        fs::write(
            &wrong_locale,
            r#"<?xml version="1.0"?><xliff version="1.2"><file source-language="en-US" target-language="fr-FR"><body><trans-unit id="u1"><source>Hello</source><target>Bonjour</target></trans-unit></body></file></xliff>"#,
        )
        .expect("write wrong-locale XLIFF");
        fs::write(
            &valid,
            r#"<?xml version="1.0"?><xliff version="1.2"><file source-language="en-US" target-language="zh-CN"><body><trans-unit id="u1"><source>Hello</source><target>你好</target></trans-unit><trans-unit id="u2"><source>Bye</source><target>再见</target></trans-unit></body></file></xliff>"#,
        )
        .expect("write valid XLIFF");
        let mut service = EngineService::open(context.root.path()).expect("open engine");
        let project = TestContext::project(&mut service);
        let before = managed_source_names(context.root.path());
        assert!(matches!(
            service.import_reference_corpus(reference_corpus_import_request(
                &project,
                &missing_target,
                "Missing target",
                ReferenceCorpusKind::Bilingual,
                "builtin.xliff",
            )),
            Err(EngineError::CorpusInput(_))
        ));
        assert_eq!(managed_source_names(context.root.path()), before);
        assert!(matches!(
            service.import_reference_corpus(reference_corpus_import_request(
                &project,
                &wrong_locale,
                "Wrong target locale",
                ReferenceCorpusKind::Bilingual,
                "builtin.xliff",
            )),
            Err(EngineError::CorpusInput(_))
        ));
        assert_eq!(managed_source_names(context.root.path()), before);

        let corpus = service
            .import_reference_corpus(reference_corpus_import_request(
                &project,
                &valid,
                "Authoritative bilingual",
                ReferenceCorpusKind::Bilingual,
                "builtin.xliff",
            ))
            .expect("import authoritative bilingual corpus");
        assert_eq!(corpus.corpus.entry_count, 2);
        assert_eq!(
            corpus.corpus.input_filter_id.as_deref(),
            Some("builtin.xliff")
        );
        assert_eq!(corpus.corpus.input_format.as_deref(), Some("xliff-1.2"));
        let entries = service
            .store
            .list_reference_corpus_entries(&corpus.corpus.id, 0, 10)
            .expect("list bilingual corpus entries")
            .0;
        assert!(
            entries
                .iter()
                .all(|entry| !entry.source_text.is_empty() && !entry.target_text.is_empty())
        );
        assert!(
            entries
                .iter()
                .all(|entry| entry.provenance["targetAuthoritative"] == true)
        );
        assert_eq!(
            managed_source_names(context.root.path()).len(),
            before.len() + 1
        );
    }

    #[test]
    fn reference_corpus_import_failures_leave_no_managed_copy_or_corpus() {
        let context = TestContext::new();
        let valid = context.root.path().join("cleanup-valid.txt");
        let empty = context.root.path().join("cleanup-empty.txt");
        fs::write(&valid, "Valid corpus input.").expect("write valid cleanup fixture");
        fs::write(&empty, "").expect("write empty cleanup fixture");
        let mut service = EngineService::open(context.root.path()).expect("open engine");
        let project = TestContext::project(&mut service);
        let before = managed_source_names(context.root.path());

        let mut locale_mismatch = reference_corpus_import_request(
            &project,
            &valid,
            "Locale mismatch",
            ReferenceCorpusKind::MonolingualSource,
            "builtin.txt",
        );
        locale_mismatch.source_locale = "fr-FR".to_string();
        assert!(matches!(
            service.import_reference_corpus(locale_mismatch),
            Err(EngineError::CorpusInput(_))
        ));
        assert_eq!(managed_source_names(context.root.path()), before);

        assert!(matches!(
            service.import_reference_corpus(reference_corpus_import_request(
                &project,
                &valid,
                "Unknown filter",
                ReferenceCorpusKind::MonolingualSource,
                "missing.filter",
            )),
            Err(EngineError::CorpusImport(FilterError::NotFound(_)))
        ));
        assert_eq!(managed_source_names(context.root.path()), before);
        assert!(matches!(
            service.import_reference_corpus(reference_corpus_import_request(
                &project,
                &empty,
                "Empty input",
                ReferenceCorpusKind::MonolingualSource,
                "builtin.txt",
            )),
            Err(EngineError::CorpusImport(_))
        ));
        assert_eq!(managed_source_names(context.root.path()), before);

        let failure_connection = rusqlite::Connection::open(&service.store.paths().database)
            .expect("open failure-injection connection");
        failure_connection
            .execute_batch(
                "CREATE TRIGGER reference_corpus_engine_insert_failure
                 BEFORE INSERT ON reference_corpora
                 BEGIN
                     SELECT RAISE(ABORT, 'forced reference corpus persistence failure');
                 END;",
            )
            .expect("install corpus persistence failure trigger");
        assert!(
            service
                .import_reference_corpus(reference_corpus_import_request(
                    &project,
                    &valid,
                    "Persistence failure",
                    ReferenceCorpusKind::MonolingualSource,
                    "builtin.txt",
                ))
                .is_err()
        );
        assert_eq!(managed_source_names(context.root.path()), before);
        assert_eq!(
            service
                .store
                .list_reference_corpora(&project.id, None, 0, 10)
                .expect("list corpora after failures")
                .1,
            0
        );
        failure_connection
            .execute_batch("DROP TRIGGER reference_corpus_engine_insert_failure")
            .expect("remove corpus persistence failure trigger");
    }

    #[test]
    fn pipeline_runs_authoritative_document_qa_and_persists_progress() {
        let context = TestContext::new();
        let mut service = EngineService::open(context.root.path()).expect("open engine");
        let project = TestContext::project(&mut service);
        let document = service
            .import_docx(ImportDocxParams {
                project_id: project.id.clone(),
                source_path: context.source.to_string_lossy().into_owned(),
            })
            .expect("import document");
        let definition = service
            .create_pipeline(CreatePipelineParams {
                project_id: Some(project.id.clone()),
                name: "QA delivery".to_string(),
                steps: vec![PipelineStepDefinition {
                    key: "qa".to_string(),
                    step_id: "core.qa.document".to_string(),
                    config: Value::Null,
                }],
            })
            .expect("create pipeline");
        let run = service
            .run_pipeline(RunPipelineParams {
                definition_id: definition.id,
                project_id: project.id,
                document_id: Some(document.id),
                input: json!({}),
            })
            .expect("start pipeline");
        assert_eq!(
            run.run.status,
            translunar_pipeline::PipelineRunStatus::Queued
        );

        let mut final_snapshot = run;
        for _ in 0..100 {
            std::thread::sleep(std::time::Duration::from_millis(10));
            final_snapshot = service
                .get_pipeline_run(PipelineRunIdParams {
                    run_id: final_snapshot.run.id.clone(),
                })
                .expect("poll pipeline");
            if final_snapshot.run.status.is_terminal() {
                break;
            }
        }
        assert_eq!(
            final_snapshot.run.status,
            translunar_pipeline::PipelineRunStatus::Succeeded
        );
        assert_eq!(
            final_snapshot.steps[0].status,
            translunar_pipeline::PipelineStepStatus::Succeeded
        );
        assert!(final_snapshot.steps[0].output.is_some());
    }

    #[test]
    fn pipeline_cancellation_converges_to_canceled() {
        let context = TestContext::new();
        let mut service = EngineService::open(context.root.path()).expect("open engine");
        let project = TestContext::project(&mut service);
        let definition = service
            .create_pipeline(CreatePipelineParams {
                project_id: Some(project.id.clone()),
                name: "Cancelable checkpoint".to_string(),
                steps: vec![PipelineStepDefinition {
                    key: "wait".to_string(),
                    step_id: "core.checkpoint".to_string(),
                    config: json!({ "delayMs": 1_000 }),
                }],
            })
            .expect("create cancelable pipeline");
        let mut snapshot = service
            .run_pipeline(RunPipelineParams {
                definition_id: definition.id,
                project_id: project.id,
                document_id: None,
                input: json!({}),
            })
            .expect("start cancelable pipeline");
        for _ in 0..100 {
            if snapshot.run.status == translunar_pipeline::PipelineRunStatus::Running {
                break;
            }
            std::thread::sleep(Duration::from_millis(5));
            snapshot = service
                .get_pipeline_run(PipelineRunIdParams {
                    run_id: snapshot.run.id.clone(),
                })
                .expect("poll running pipeline");
        }
        let canceling = service
            .cancel_pipeline_run(PipelineRunRevisionParams {
                run_id: snapshot.run.id.clone(),
                expected_revision: snapshot.run.revision,
            })
            .expect("request cancellation");
        assert_eq!(
            canceling.run.status,
            translunar_pipeline::PipelineRunStatus::Canceling
        );
        let mut final_snapshot = canceling;
        for _ in 0..200 {
            if final_snapshot.run.status.is_terminal() {
                break;
            }
            std::thread::sleep(Duration::from_millis(10));
            final_snapshot = service
                .get_pipeline_run(PipelineRunIdParams {
                    run_id: final_snapshot.run.id.clone(),
                })
                .expect("poll canceled pipeline");
        }
        assert_eq!(
            final_snapshot.run.status,
            translunar_pipeline::PipelineRunStatus::Canceled
        );
        assert_eq!(
            final_snapshot.steps[0].status,
            translunar_pipeline::PipelineStepStatus::Canceled
        );
    }

    #[test]
    fn plugin_pipeline_run_persists_binding_attempt_and_checkpoint() {
        let context = TestContext::new();
        let mut service = EngineService::open(context.root.path()).expect("open engine");
        let project = TestContext::project(&mut service);
        let step_id = "example.pipeline.success";
        let owner = test_plugin_pipeline_owner(step_id, 1);
        service
            .pipeline
            .registry
            .register_plugin(
                Arc::new(TestPluginPipelineStep {
                    id: step_id.to_string(),
                    delay_ms: 0,
                    started: Arc::new(AtomicBool::new(false)),
                    publish_intermediate: true,
                }),
                owner.clone(),
            )
            .expect("register plugin step");
        let definition = service
            .create_pipeline(CreatePipelineParams {
                project_id: Some(project.id.clone()),
                name: "Plugin provenance".to_string(),
                steps: vec![PipelineStepDefinition {
                    key: "plugin".to_string(),
                    step_id: step_id.to_string(),
                    config: json!({ "mode": "strict" }),
                }],
            })
            .expect("create plugin pipeline");
        let created = service
            .run_pipeline(RunPipelineParams {
                definition_id: definition.id,
                project_id: project.id,
                document_id: None,
                input: json!({ "value": 7 }),
            })
            .expect("run plugin pipeline");
        let completed = wait_for_pipeline_terminal(&service, &created.run.id);
        assert_eq!(
            completed.run.status,
            translunar_pipeline::PipelineRunStatus::Succeeded
        );
        let step = &completed.steps[0];
        let binding = step.plugin_binding.as_ref().expect("immutable binding");
        assert_eq!(binding.owner, owner);
        assert_eq!(binding.config_hash.len(), 64);
        let attempt = step.latest_plugin_attempt.as_ref().expect("plugin attempt");
        assert_eq!(attempt.operation, PipelineStepPluginOperation::Execute);
        assert_eq!(attempt.input_hash.len(), 64);
        assert_eq!(attempt.output_hash.as_ref().map(String::len), Some(64));
        assert_eq!(
            attempt.checkpoint_output_hash.as_ref().map(String::len),
            Some(64)
        );
        assert!(attempt.failure.is_none());
        let checkpoint = step.latest_checkpoint.as_ref().expect("checkpoint history");
        assert_eq!(checkpoint.sequence, 1);
        assert_eq!(checkpoint.schema_version, 1);
        assert_eq!(checkpoint.checkpoint_hash.len(), 64);
    }

    #[test]
    fn plugin_intermediate_checkpoint_survives_restart_and_drives_resume() {
        let context = TestContext::new();
        let step_id = "example.pipeline.interrupting-checkpoint";
        let owner = test_plugin_pipeline_owner(step_id, 1);
        let run_id;
        {
            let mut service = EngineService::open(context.root.path()).expect("open engine");
            let project = TestContext::project(&mut service);
            service
                .pipeline
                .registry
                .register_plugin(
                    Arc::new(InterruptingCheckpointStep {
                        id: step_id.to_string(),
                        resumed: Arc::new(AtomicBool::new(false)),
                    }),
                    owner.clone(),
                )
                .expect("register interrupting plugin step");
            let definition = service
                .create_pipeline(CreatePipelineParams {
                    project_id: Some(project.id.clone()),
                    name: "Plugin checkpoint restart".to_string(),
                    steps: vec![PipelineStepDefinition {
                        key: "plugin".to_string(),
                        step_id: step_id.to_string(),
                        config: Value::Null,
                    }],
                })
                .expect("create checkpoint pipeline");
            let created = service
                .run_pipeline(RunPipelineParams {
                    definition_id: definition.id,
                    project_id: project.id,
                    document_id: None,
                    input: json!({ "records": ["one", "two"] }),
                })
                .expect("start checkpoint pipeline");
            run_id = created.run.id;
            for _ in 0..100 {
                let snapshot = service
                    .get_pipeline_run(PipelineRunIdParams {
                        run_id: run_id.clone(),
                    })
                    .expect("poll intermediate checkpoint");
                if snapshot.steps[0].checkpoint == Some(json!({ "cursor": 1 })) {
                    break;
                }
                thread::sleep(Duration::from_millis(5));
            }
            let running = service
                .get_pipeline_run(PipelineRunIdParams {
                    run_id: run_id.clone(),
                })
                .expect("read checkpointed run");
            assert_eq!(running.steps[0].checkpoint, Some(json!({ "cursor": 1 })));
            assert_eq!(
                running.run.status,
                translunar_pipeline::PipelineRunStatus::Running
            );
        }

        let mut service = EngineService::open(context.root.path()).expect("restart engine");
        let interrupted = service
            .get_pipeline_run(PipelineRunIdParams {
                run_id: run_id.clone(),
            })
            .expect("read interrupted plugin run");
        assert_eq!(
            interrupted.run.status,
            translunar_pipeline::PipelineRunStatus::Interrupted
        );
        let resumed = Arc::new(AtomicBool::new(false));
        service
            .pipeline
            .registry
            .register_plugin(
                Arc::new(InterruptingCheckpointStep {
                    id: step_id.to_string(),
                    resumed: Arc::clone(&resumed),
                }),
                owner,
            )
            .expect("reattach exact plugin generation");
        service
            .resume_pipeline_run(PipelineRunRevisionParams {
                run_id: run_id.clone(),
                expected_revision: interrupted.run.revision,
            })
            .expect("resume checkpointed plugin run");
        let completed = wait_for_pipeline_terminal(&service, &run_id);
        assert_eq!(
            completed.run.status,
            translunar_pipeline::PipelineRunStatus::Succeeded,
            "resume failed: {:?}; step: {:?}",
            completed.run.error,
            completed.steps[0]
        );
        assert!(resumed.load(Ordering::Acquire));
        assert_eq!(completed.steps[0].checkpoint, Some(json!({ "cursor": 2 })));
    }

    #[test]
    fn detached_plugin_generation_cannot_publish_late_pipeline_result() {
        let context = TestContext::new();
        let mut service = EngineService::open(context.root.path()).expect("open engine");
        let project = TestContext::project(&mut service);
        let step_id = "example.pipeline.detach";
        let owner_v1 = test_plugin_pipeline_owner(step_id, 1);
        let owner_v2 = test_plugin_pipeline_owner(step_id, 2);
        let started = Arc::new(AtomicBool::new(false));
        service
            .pipeline
            .registry
            .register_plugin(
                Arc::new(TestPluginPipelineStep {
                    id: step_id.to_string(),
                    delay_ms: 1_000,
                    started: Arc::clone(&started),
                    publish_intermediate: false,
                }),
                owner_v1.clone(),
            )
            .expect("register old generation");
        let definition = service
            .create_pipeline(CreatePipelineParams {
                project_id: Some(project.id.clone()),
                name: "Plugin detach race".to_string(),
                steps: vec![PipelineStepDefinition {
                    key: "plugin".to_string(),
                    step_id: step_id.to_string(),
                    config: Value::Null,
                }],
            })
            .expect("create plugin pipeline");
        let created = service
            .run_pipeline(RunPipelineParams {
                definition_id: definition.id,
                project_id: project.id,
                document_id: None,
                input: json!({}),
            })
            .expect("run old generation");
        for _ in 0..200 {
            if started.load(Ordering::Acquire) {
                break;
            }
            thread::sleep(Duration::from_millis(5));
        }
        assert!(started.load(Ordering::Acquire), "old generation started");
        let old_binding = service
            .pipeline
            .registry
            .resolve_binding(step_id)
            .expect("resolve old generation")
            .binding()
            .clone();
        service.pipeline.cancel_owner(&owner_v1);
        service
            .pipeline
            .registry
            .unregister_binding(&old_binding)
            .expect("detach old generation");
        service
            .pipeline
            .registry
            .register_plugin(
                Arc::new(TestPluginPipelineStep {
                    id: step_id.to_string(),
                    delay_ms: 0,
                    started: Arc::new(AtomicBool::new(false)),
                    publish_intermediate: false,
                }),
                owner_v2.clone(),
            )
            .expect("register replacement generation");

        let failed = wait_for_pipeline_terminal(&service, &created.run.id);
        assert_eq!(
            failed.run.status,
            translunar_pipeline::PipelineRunStatus::Failed
        );
        assert_eq!(
            failed.run.error.as_ref().map(|error| error.code.as_str()),
            Some("plugin_stale_activation")
        );
        assert!(failed.steps[0].output.is_none());
        assert!(failed.steps[0].checkpoint.is_none());
        assert!(failed.steps[0].latest_plugin_attempt.is_none());
        assert!(failed.steps[0].latest_checkpoint.is_none());
        assert_eq!(
            service
                .pipeline
                .registry
                .resolve_binding(step_id)
                .expect("replacement remains")
                .binding()
                .owner,
            owner_v2
        );
    }

    #[test]
    fn plugin_checkpoint_migration_is_recorded_before_resume() {
        let context = TestContext::new();
        let run_id;
        let step_id = "example.pipeline.migrate";
        {
            let mut service = EngineService::open(context.root.path()).expect("open engine");
            let project = TestContext::project(&mut service);
            service
                .pipeline
                .registry
                .register_plugin(
                    Arc::new(TestPluginPipelineStep {
                        id: step_id.to_string(),
                        delay_ms: 0,
                        started: Arc::new(AtomicBool::new(false)),
                        publish_intermediate: false,
                    }),
                    test_plugin_pipeline_owner_with_schema(step_id, 1, 2),
                )
                .expect("register schema-two generation");
            let definition = service
                .create_pipeline(CreatePipelineParams {
                    project_id: Some(project.id.clone()),
                    name: "Checkpoint migration".to_string(),
                    steps: vec![PipelineStepDefinition {
                        key: "plugin".to_string(),
                        step_id: step_id.to_string(),
                        config: json!({ "mode": "stable" }),
                    }],
                })
                .expect("create migration pipeline");
            let resolved = service
                .pipeline
                .resolve_new_run(&definition)
                .expect("resolve original binding");
            let created = service
                .store
                .create_pipeline_run_with_bindings(
                    &definition.id,
                    &project.id,
                    None,
                    json!({ "records": ["one"] }),
                    &resolved.plugin_bindings,
                )
                .expect("create migration run");
            run_id = created.run.id;
            service
                .store
                .start_pipeline_run(&run_id)
                .expect("start run");
            service
                .store
                .start_pipeline_step(&run_id, 0, json!({ "records": ["one"] }))
                .expect("start plugin step");
            service
                .store
                .append_pipeline_step_checkpoint(&run_id, 0, 2, json!({ "cursor": 1 }))
                .expect("append schema-two checkpoint");
        }

        let mut service = EngineService::open(context.root.path()).expect("restart engine");
        let migrated = Arc::new(AtomicBool::new(false));
        service
            .pipeline
            .registry
            .register_plugin(
                Arc::new(MigratingCheckpointStep {
                    id: step_id.to_string(),
                    migrated: Arc::clone(&migrated),
                }),
                test_plugin_pipeline_owner_with_schema(step_id, 2, 1),
            )
            .expect("register schema-one generation");
        let interrupted = service
            .get_pipeline_run(PipelineRunIdParams {
                run_id: run_id.clone(),
            })
            .expect("read interrupted migration run");
        service
            .resume_pipeline_run(PipelineRunRevisionParams {
                run_id: run_id.clone(),
                expected_revision: interrupted.run.revision,
            })
            .expect("migrate and resume checkpoint");
        let completed = wait_for_pipeline_terminal(&service, &run_id);
        assert_eq!(
            completed.run.status,
            translunar_pipeline::PipelineRunStatus::Succeeded,
            "migration failed: {:?}",
            completed.run.error
        );
        assert!(migrated.load(Ordering::Acquire));
        assert_eq!(
            completed.steps[0]
                .plugin_binding
                .as_ref()
                .and_then(|binding| match &binding.owner {
                    PipelineStepOwner::Plugin {
                        checkpoint_schema_version,
                        ..
                    } => *checkpoint_schema_version,
                    PipelineStepOwner::Builtin => None,
                }),
            Some(2),
            "the immutable original binding must not be rewritten"
        );
        assert_eq!(
            completed.steps[0]
                .latest_checkpoint
                .as_ref()
                .map(|checkpoint| (checkpoint.sequence, checkpoint.schema_version)),
            Some((2, 1)),
            "source, migrated, and resumed checkpoints should remain append-only"
        );
    }

    #[test]
    fn pipeline_resume_accepts_a_compatible_plugin_generation() {
        let context = TestContext::new();
        let run_id;
        let step_id = "example.pipeline.resume";
        {
            let mut service = EngineService::open(context.root.path()).expect("open engine");
            let project = TestContext::project(&mut service);
            service
                .pipeline
                .registry
                .register_plugin(
                    Arc::new(TestPluginPipelineStep {
                        id: step_id.to_string(),
                        delay_ms: 0,
                        started: Arc::new(AtomicBool::new(false)),
                        publish_intermediate: false,
                    }),
                    test_plugin_pipeline_owner(step_id, 1),
                )
                .expect("register original generation");
            let definition = service
                .create_pipeline(CreatePipelineParams {
                    project_id: Some(project.id.clone()),
                    name: "Pinned plugin resume".to_string(),
                    steps: vec![PipelineStepDefinition {
                        key: "plugin".to_string(),
                        step_id: step_id.to_string(),
                        config: json!({ "versioned": true }),
                    }],
                })
                .expect("create plugin pipeline");
            let resolved = service
                .pipeline
                .resolve_new_run(&definition)
                .expect("resolve immutable bindings");
            let created = service
                .store
                .create_pipeline_run_with_bindings(
                    &definition.id,
                    &project.id,
                    None,
                    json!({}),
                    &resolved.plugin_bindings,
                )
                .expect("create pinned run");
            run_id = created.run.id;
            service
                .store
                .start_pipeline_run(&run_id)
                .expect("start run");
            service
                .store
                .start_pipeline_step(&run_id, 0, json!({}))
                .expect("start plugin step");
        }

        let mut service = EngineService::open(context.root.path()).expect("restart engine");
        service
            .pipeline
            .registry
            .register_plugin(
                Arc::new(TestPluginPipelineStep {
                    id: step_id.to_string(),
                    delay_ms: 0,
                    started: Arc::new(AtomicBool::new(false)),
                    publish_intermediate: false,
                }),
                test_plugin_pipeline_owner(step_id, 2),
            )
            .expect("register replacement generation");
        let interrupted = service
            .get_pipeline_run(PipelineRunIdParams {
                run_id: run_id.clone(),
            })
            .expect("read interrupted run");
        let resumed = service
            .resume_pipeline_run(PipelineRunRevisionParams {
                run_id,
                expected_revision: interrupted.run.revision,
            })
            .expect("resume compatible generation");
        let completed = wait_for_pipeline_terminal(&service, &resumed.run.id);
        assert_eq!(
            completed.run.status,
            translunar_pipeline::PipelineRunStatus::Succeeded
        );
    }

    #[test]
    fn interrupted_resumable_pipeline_keeps_previous_checkpoint_and_completes() {
        let context = TestContext::new();
        let definition_id;
        let run_id;
        {
            let mut service = EngineService::open(context.root.path()).expect("open engine");
            let project = TestContext::project(&mut service);
            let definition = service
                .create_pipeline(CreatePipelineParams {
                    project_id: Some(project.id.clone()),
                    name: "Resumable checkpoints".to_string(),
                    steps: vec![
                        PipelineStepDefinition {
                            key: "first".to_string(),
                            step_id: "core.checkpoint".to_string(),
                            config: Value::Null,
                        },
                        PipelineStepDefinition {
                            key: "second".to_string(),
                            step_id: "core.checkpoint".to_string(),
                            config: Value::Null,
                        },
                    ],
                })
                .expect("create resumable pipeline");
            let created = service
                .store
                .create_pipeline_run(&definition.id, &project.id, None, json!({}))
                .expect("create run");
            run_id = created.run.id.clone();
            definition_id = definition.id;
            service
                .store
                .start_pipeline_run(&run_id)
                .expect("start run");
            service
                .store
                .start_pipeline_step(&run_id, 0, json!({}))
                .expect("start first step");
            service
                .store
                .complete_pipeline_step(
                    &run_id,
                    0,
                    json!({ "first": true }),
                    Some(json!({ "checkpoint": 1 })),
                    None,
                )
                .expect("complete first step");
            service
                .store
                .start_pipeline_step(&run_id, 1, json!({ "first": true }))
                .expect("start second step");
        }

        let mut service = EngineService::open(context.root.path()).expect("restart engine");
        let interrupted = service
            .get_pipeline_run(PipelineRunIdParams {
                run_id: run_id.clone(),
            })
            .expect("read interrupted run");
        assert_eq!(
            interrupted.run.status,
            translunar_pipeline::PipelineRunStatus::Interrupted
        );
        assert_eq!(
            interrupted.steps[0].checkpoint,
            Some(json!({ "checkpoint": 1 }))
        );
        let resumed = service
            .resume_pipeline_run(PipelineRunRevisionParams {
                run_id: run_id.clone(),
                expected_revision: interrupted.run.revision,
            })
            .expect("resume run");
        assert_eq!(
            resumed.run.status,
            translunar_pipeline::PipelineRunStatus::Queued
        );
        assert_eq!(resumed.run.definition_id, definition_id);
        let mut final_snapshot = resumed;
        for _ in 0..100 {
            if final_snapshot.run.status.is_terminal() {
                break;
            }
            std::thread::sleep(Duration::from_millis(10));
            final_snapshot = service
                .get_pipeline_run(PipelineRunIdParams {
                    run_id: run_id.clone(),
                })
                .expect("poll resumed run");
        }
        assert_eq!(
            final_snapshot.run.status,
            translunar_pipeline::PipelineRunStatus::Succeeded
        );
        assert_eq!(
            final_snapshot.steps[0].checkpoint,
            Some(json!({ "checkpoint": 1 }))
        );
    }

    #[test]
    fn interrupted_non_resumable_pipeline_fails_explicitly() {
        let context = TestContext::new();
        let run_id;
        {
            let mut service = EngineService::open(context.root.path()).expect("open engine");
            service
                .pipeline
                .registry
                .register(Arc::new(NonResumableStep))
                .expect("register test step");
            let project = TestContext::project(&mut service);
            let definition = service
                .create_pipeline(CreatePipelineParams {
                    project_id: Some(project.id.clone()),
                    name: "Non-resumable recovery".to_string(),
                    steps: vec![PipelineStepDefinition {
                        key: "once".to_string(),
                        step_id: "test.nonresumable".to_string(),
                        config: Value::Null,
                    }],
                })
                .expect("create non-resumable pipeline");
            let created = service
                .store
                .create_pipeline_run(&definition.id, &project.id, None, json!({}))
                .expect("create run");
            run_id = created.run.id.clone();
            service
                .store
                .start_pipeline_run(&run_id)
                .expect("start run");
            service
                .store
                .start_pipeline_step(&run_id, 0, json!({}))
                .expect("start step");
        }

        let mut service = EngineService::open(context.root.path()).expect("restart engine");
        service
            .pipeline
            .registry
            .register(Arc::new(NonResumableStep))
            .expect("register test step after restart");
        let interrupted = service
            .get_pipeline_run(PipelineRunIdParams {
                run_id: run_id.clone(),
            })
            .expect("read interrupted run");
        let failed = service
            .resume_pipeline_run(PipelineRunRevisionParams {
                run_id,
                expected_revision: interrupted.run.revision,
            })
            .expect("explicitly fail non-resumable run");
        assert_eq!(
            failed.run.status,
            translunar_pipeline::PipelineRunStatus::Failed
        );
        assert_eq!(
            failed.run.error.as_ref().map(|error| error.code.as_str()),
            Some("step_not_resumable")
        );
        assert_eq!(
            failed.steps[0].status,
            translunar_pipeline::PipelineStepStatus::Failed
        );
    }

    #[test]
    fn generic_import_keeps_same_basenames_and_legacy_docx_path_works() {
        let context = TestContext::new();
        let first = context.root.path().join("source-a").join("shared.docx");
        let second = context.root.path().join("source-b").join("shared.docx");
        std::fs::create_dir_all(first.parent().expect("first parent")).expect("first dir");
        std::fs::create_dir_all(second.parent().expect("second parent")).expect("second dir");
        std::fs::copy(&context.source, &first).expect("copy first");
        std::fs::copy(&context.source, &second).expect("copy second");

        let mut service = EngineService::open(context.root.path()).expect("open engine");
        let project = TestContext::project(&mut service);
        let first_document = service
            .import_document(ImportDocumentParams {
                project_id: project.id.clone(),
                source_path: first.to_string_lossy().into_owned(),
                relative_path: Some("chapter-a/shared.docx".to_string()),
                filter_id: None,
                options: Default::default(),
            })
            .expect("generic import first");
        let second_document = service
            .import_docx(ImportDocxParams {
                project_id: project.id.clone(),
                source_path: second.to_string_lossy().into_owned(),
            })
            .expect("legacy import second");
        for (document_id, target) in [
            (first_document.document.id.clone(), "第一份译文"),
            (second_document.id.clone(), "第二份译文"),
        ] {
            let segments = service
                .list_segments(SegmentListParams {
                    document_id,
                    offset: 0,
                    limit: 10,
                })
                .expect("list imported segments");
            service
                .update_target(UpdateTargetParams {
                    segment_id: segments.items[0].id.clone(),
                    target_text: target.to_string(),
                    expected_revision: segments.items[0].revision,
                })
                .expect("edit imported document");
        }
        let page = service
            .list_documents(DocumentListParams {
                project_id: project.id.clone(),
                offset: 0,
                limit: 10,
            })
            .expect("list documents");
        assert_eq!(page.total, 2);
        assert_eq!(page.items[0].relative_path, "chapter-a/shared.docx");
        assert_eq!(page.items[1].name, "shared.docx");
        assert_eq!(first_document.filter_id, "builtin.docx");
        assert_eq!(second_document.relative_path, "shared.docx");
        let filter_ids: Vec<_> = service
            .list_filters(EmptyParams::default())
            .filters
            .into_iter()
            .map(|filter| filter.id)
            .collect();
        assert_eq!(
            filter_ids,
            [
                "builtin.bilingual-docx",
                "builtin.bilingual-xlsx",
                "builtin.docx",
                "builtin.html",
                "builtin.markdown",
                "builtin.mqxliff",
                "builtin.mqxlz",
                "builtin.pdf",
                "builtin.pptx",
                "builtin.sdlxliff",
                "builtin.txt",
                "builtin.xliff",
                "builtin.xlsx",
            ]
        );

        drop(service);
        let mut service = EngineService::open(context.root.path()).expect("restart engine");
        let recovered = service
            .list_documents(DocumentListParams {
                project_id: project.id.clone(),
                offset: 0,
                limit: 10,
            })
            .expect("list documents after restart");
        assert_eq!(recovered.items.len(), 2);
        for (document_id, expected_target) in [
            (first_document.document.id.clone(), "第一份译文"),
            (second_document.id.clone(), "第二份译文"),
        ] {
            let segments = service
                .list_segments(SegmentListParams {
                    document_id: document_id.clone(),
                    offset: 0,
                    limit: 10,
                })
                .expect("reload document segments");
            assert_eq!(segments.items[0].target_text, expected_target);
        }
        let generic_output = context.root.path().join("generic-shared.docx");
        let legacy_output = context.root.path().join("legacy-shared.docx");
        let generic_result = service
            .export_document(ExportDocumentParams {
                document_id: first_document.document.id,
                output_path: generic_output.to_string_lossy().into_owned(),
                qa_override: Some(test_qa_override()),
            })
            .expect("generic export after restart");
        let legacy_result = service
            .export_docx(ExportDocxParams {
                document_id: second_document.id,
                output_path: legacy_output.to_string_lossy().into_owned(),
                qa_override: Some(test_qa_override()),
            })
            .expect("legacy export after restart");
        assert_eq!(generic_result.translated_segments, 1);
        assert_eq!(legacy_result.translated_segments, 1);
        assert!(generic_output.is_file());
        assert!(legacy_output.is_file());
    }

    #[test]
    fn batch_import_preserves_relative_paths_and_all_or_nothing_is_atomic() {
        let context = TestContext::new();
        let folder = context.root.path().join("batch");
        let nested = folder.join("nested");
        std::fs::create_dir_all(&nested).expect("create batch folder");
        let first = folder.join("first.txt");
        let second = nested.join("second.md");
        let bad = folder.join("unsupported.bin");
        std::fs::write(&first, "First batch source").expect("write first batch source");
        std::fs::write(&second, "Second *batch* source").expect("write second batch source");
        std::fs::write(&bad, [0, 1, 2, 3]).expect("write unsupported source");

        let mut service = EngineService::open(context.root.path()).expect("open engine");
        let project = TestContext::project(&mut service);
        let best_effort = service
            .batch_import(ProjectBatchImportParams {
                project_id: project.id.clone(),
                items: vec![BatchImportItem {
                    path: folder.to_string_lossy().into_owned(),
                    relative_path: None,
                }],
                filter_id: None,
                options: BTreeMap::new(),
                atomicity: BatchImportAtomicity::BestEffort,
            })
            .expect("best effort batch import");
        assert_eq!(best_effort.succeeded, 2);
        assert_eq!(best_effort.failed, 1);
        assert!(
            best_effort
                .items
                .iter()
                .any(|item| item.relative_path == "nested/second.md" && item.status == "succeeded")
        );
        assert!(
            best_effort
                .items
                .iter()
                .any(|item| item.path.ends_with("unsupported.bin") && item.status == "failed")
        );
        let before_atomic = service
            .list_documents(DocumentListParams {
                project_id: project.id.clone(),
                offset: 0,
                limit: 100,
            })
            .expect("list after best effort")
            .total;

        let atomic_good = context.root.path().join("atomic-good.txt");
        std::fs::write(&atomic_good, "Atomic good").expect("write atomic good");
        let atomic_bad = context.root.path().join("atomic-bad.bin");
        std::fs::write(&atomic_bad, [4, 5, 6]).expect("write atomic bad");
        let atomic_failed = service
            .batch_import(ProjectBatchImportParams {
                project_id: project.id.clone(),
                items: vec![
                    BatchImportItem {
                        path: atomic_good.to_string_lossy().into_owned(),
                        relative_path: Some("atomic/good.txt".to_string()),
                    },
                    BatchImportItem {
                        path: atomic_bad.to_string_lossy().into_owned(),
                        relative_path: Some("atomic/bad.bin".to_string()),
                    },
                ],
                filter_id: None,
                options: BTreeMap::new(),
                atomicity: BatchImportAtomicity::AllOrNothing,
            })
            .expect("atomic failure diagnostics");
        assert_eq!(atomic_failed.succeeded, 0);
        assert_eq!(atomic_failed.failed, 2);
        assert!(
            atomic_failed
                .items
                .iter()
                .all(|item| item.status == "failed")
        );
        assert_eq!(
            service
                .list_documents(DocumentListParams {
                    project_id: project.id.clone(),
                    offset: 0,
                    limit: 100,
                })
                .expect("list after atomic rollback")
                .total,
            before_atomic
        );

        let traversal = service
            .batch_import(ProjectBatchImportParams {
                project_id: project.id.clone(),
                items: vec![BatchImportItem {
                    path: atomic_good.to_string_lossy().into_owned(),
                    relative_path: Some("../escape.txt".to_string()),
                }],
                filter_id: None,
                options: BTreeMap::new(),
                atomicity: BatchImportAtomicity::BestEffort,
            })
            .expect("traversal diagnostics");
        assert_eq!(traversal.succeeded, 0);
        assert_eq!(
            traversal.items[0].error_code.as_deref(),
            Some("invalid_request")
        );

        let atomic_a = context.root.path().join("atomic-a.txt");
        let atomic_b = context.root.path().join("atomic-b.txt");
        std::fs::write(&atomic_a, "Atomic A").expect("write atomic a");
        std::fs::write(&atomic_b, "Atomic B").expect("write atomic b");
        let atomic_success = service
            .batch_import(ProjectBatchImportParams {
                project_id: project.id.clone(),
                items: vec![
                    BatchImportItem {
                        path: atomic_a.to_string_lossy().into_owned(),
                        relative_path: Some("atomic/a.txt".to_string()),
                    },
                    BatchImportItem {
                        path: atomic_b.to_string_lossy().into_owned(),
                        relative_path: Some("atomic/b.txt".to_string()),
                    },
                ],
                filter_id: None,
                options: BTreeMap::new(),
                atomicity: BatchImportAtomicity::AllOrNothing,
            })
            .expect("atomic success");
        assert_eq!(atomic_success.succeeded, 2);
        assert_eq!(atomic_success.failed, 0);
        drop(service);
        let restarted = EngineService::open(context.root.path()).expect("restart engine");
        let recovered = restarted
            .list_documents(DocumentListParams {
                project_id: project.id,
                offset: 0,
                limit: 100,
            })
            .expect("list batch documents after restart");
        assert_eq!(recovered.total, before_atomic + 2);
    }

    #[test]
    fn text_html_xliff_and_office_filters_round_trip_through_generic_engine() {
        let context = TestContext::new();
        let txt = context.root.path().join("sample.txt");
        let markdown = context.root.path().join("sample.md");
        let html = context.root.path().join("sample.html");
        let xliff = context.root.path().join("sample.xlf");
        let xlsx = context.root.path().join("sample.xlsx");
        let pptx = context.root.path().join("sample.pptx");
        std::fs::write(
            &txt,
            "\u{feff}First paragraph.\r\n\r\nSecond paragraph.\r\n",
        )
        .expect("write TXT");
        std::fs::write(
            &markdown,
            "# Heading\n\nVisible **bold** [link](https://example.test) `code`.\n",
        )
        .expect("write Markdown");
        std::fs::write(
            &html,
            "<!-- keep --><p title=\"Greeting\">Hello <strong>world</strong>.</p><script>skip()</script>",
        )
        .expect("write HTML");
        std::fs::write(
            &xliff,
            r#"<xliff version="2.1" srcLang="en" trgLang="zh" xmlns="urn:oasis:names:tc:xliff:document:2.1"><file id="f"><unit id="u"><notes><note id="n">Keep tone</note></notes><segment id="s" state="initial"><source>Hello <ph id="p"/> world</source></segment></unit></file></xliff>"#,
        )
        .expect("write XLIFF");
        xlsx_fixture::write_fixture(&xlsx).expect("write XLSX");
        pptx_fixture::write_fixture(&pptx).expect("write PPTX");

        let mut service = EngineService::open(context.root.path()).expect("open engine");
        let project = TestContext::project(&mut service);
        let oversized_options = (0..33)
            .map(|index| (format!("option-{index}"), "value".to_string()))
            .collect();
        assert!(matches!(
            service.import_document(ImportDocumentParams {
                project_id: project.id.clone(),
                source_path: txt.to_string_lossy().into_owned(),
                relative_path: None,
                filter_id: None,
                options: oversized_options,
            }),
            Err(EngineError::InvalidRequest(_))
        ));
        let cases = [
            (&txt, "builtin.txt", "第一段。", "translated.txt"),
            (&markdown, "builtin.markdown", "标题", "translated.md"),
            (&html, "builtin.html", "你好", "translated.html"),
            (&xliff, "builtin.xliff", "你好世界", "translated.xlf"),
            (&xlsx, "builtin.xlsx", "你好表格", "translated.xlsx"),
            (&pptx, "builtin.pptx", "你好幻灯片", "translated.pptx"),
        ];
        let mut exports = Vec::new();
        for (source, filter_id, target, output_name) in cases {
            let imported = service
                .import_document(ImportDocumentParams {
                    project_id: project.id.clone(),
                    source_path: source.to_string_lossy().into_owned(),
                    relative_path: None,
                    filter_id: None,
                    options: Default::default(),
                })
                .expect("generic format import");
            assert_eq!(imported.filter_id, filter_id);
            let segments = service
                .list_segments(SegmentListParams {
                    document_id: imported.document.id.clone(),
                    offset: 0,
                    limit: 200,
                })
                .expect("list imported segments");
            assert!(!segments.items.is_empty());
            if filter_id == "builtin.xliff" {
                let notes = service
                    .store
                    .list_segment_notes(&segments.items[0].id)
                    .expect("list imported XLIFF notes");
                assert_eq!(notes.len(), 2);
                assert!(notes.iter().any(|note| note.text == "Keep tone"));
                assert!(notes.iter().any(|note| note.text == "initial"));
            }
            service
                .update_target(UpdateTargetParams {
                    segment_id: segments.items[0].id.clone(),
                    target_text: target.to_string(),
                    expected_revision: segments.items[0].revision,
                })
                .expect("edit imported segment");
            exports.push((imported.document.id, context.root.path().join(output_name)));
        }
        service
            .import_document(ImportDocumentParams {
                project_id: project.id.clone(),
                source_path: html.to_string_lossy().into_owned(),
                relative_path: Some("duplicate/sample.html".to_string()),
                filter_id: None,
                options: Default::default(),
            })
            .expect("import second tagged HTML without global tag ID collision");

        let sources_before_failure = std::fs::read_dir(&service.store.paths().sources)
            .expect("read managed sources")
            .count();
        let malformed = context.root.path().join("malformed.xlf");
        std::fs::write(&malformed, "<xliff version=\"2.1\"><file>").expect("write malformed XLIFF");
        assert!(
            service
                .import_document(ImportDocumentParams {
                    project_id: project.id.clone(),
                    source_path: malformed.to_string_lossy().into_owned(),
                    relative_path: None,
                    filter_id: None,
                    options: Default::default(),
                })
                .is_err()
        );
        assert_eq!(
            std::fs::read_dir(&service.store.paths().sources)
                .expect("read managed sources after failure")
                .count(),
            sources_before_failure
        );

        drop(service);
        let mut service = EngineService::open(context.root.path()).expect("restart engine");
        for (document_id, output) in &exports {
            service
                .export_document(ExportDocumentParams {
                    document_id: document_id.clone(),
                    output_path: output.to_string_lossy().into_owned(),
                    qa_override: Some(test_qa_override()),
                })
                .expect("export after restart");
        }
        let recovered_xliff = service
            .list_segments(SegmentListParams {
                document_id: exports[3].0.clone(),
                offset: 0,
                limit: 10,
            })
            .expect("reload XLIFF segment");
        assert_eq!(
            service
                .store
                .list_segment_notes(&recovered_xliff.items[0].id)
                .expect("reload XLIFF notes")
                .len(),
            2
        );
        let txt_output = std::fs::read_to_string(&exports[0].1).expect("read TXT export");
        assert!(txt_output.contains("第一段。"));
        assert!(txt_output.contains("Second paragraph."));
        let markdown_output = std::fs::read_to_string(&exports[1].1).expect("read Markdown export");
        assert!(markdown_output.contains("# 标题"));
        assert!(markdown_output.contains("https://example.test"));
        assert!(markdown_output.contains("`code`"));
        let html_output = std::fs::read_to_string(&exports[2].1).expect("read HTML export");
        assert!(html_output.contains("<!-- keep -->"));
        assert!(html_output.contains("<strong>world</strong>"));
        assert!(html_output.contains("<script>skip()</script>"));
        let xliff_output = std::fs::read_to_string(&exports[3].1).expect("read XLIFF export");
        assert!(xliff_output.contains("<target>"));
        assert!(xliff_output.contains("<ph id=\"p\"/>"));
        assert!(xliff_output.contains("id=\"s\""));
        let xlsx_units = XlsxFilter
            .extract_units(&ImportRequest::new(exports[4].1.clone()))
            .expect("read XLSX export");
        assert_eq!(xlsx_units[0].source_text, "你好表格");
        let pptx_units = PptxFilter
            .extract_units(&ImportRequest::new(exports[5].1.clone()))
            .expect("read PPTX export");
        assert_eq!(pptx_units[0].source_text, "你好幻灯片");
    }

    #[test]
    fn external_cat_formats_round_trip_through_engine_restart() {
        let context = TestContext::new();
        let sdl = context.root.path().join("handoff.sdlxliff");
        let mq = context.root.path().join("handoff.mqxliff");
        let mqxlz = context.root.path().join("handoff.mqxlz");
        std::fs::write(
            &sdl,
            r#"<xliff version="1.2" xmlns:sdl="urn:sdl" xmlns:x="urn:opaque"><file id="f" source-language="en" target-language="zh"><body><trans-unit id="u" sdl:locked="true"><source>Hello <g id="1">world</g></source><target state="translated">旧译文</target><note from="reviewer">Keep tone</note><x:meta keep="yes"/></trans-unit></body></file></xliff>"#,
        )
        .expect("write SDLXLIFF fixture");
        std::fs::write(
            &mq,
            r#"<xliff version="2.0" srcLang="en" trgLang="zh" xmlns="urn:oasis:names:tc:xliff:document:2.0" xmlns:mq="urn:memoq"><file id="f"><unit id="u"><segment id="s" mq:status="Confirmed"><source>Open <ph id="1"/>file</source><target>旧文件</target><mq:metadata keep="yes"/></segment></unit></file></xliff>"#,
        )
        .expect("write MQXLIFF fixture");
        let mut writer = ZipWriter::new(std::fs::File::create(&mqxlz).expect("create MQXLZ"));
        let options = SimpleFileOptions::default();
        writer
            .start_file("documents/main.mqxliff", options)
            .expect("start MQXLIFF part");
        writer.write_all(r#"<xliff version="1.2" xmlns:mq="urn:memoq"><file id="f" source-language="en" target-language="zh"><body><trans-unit id="u" mq:status="Translated"><source>Package text</source><target>旧包译文</target></trans-unit></body></file></xliff>"#.as_bytes()).expect("write MQXLIFF part");
        writer
            .start_file("resources/opaque.bin", options)
            .expect("start opaque part");
        writer
            .write_all(b"opaque auxiliary bytes")
            .expect("write opaque part");
        writer.finish().expect("finish MQXLZ fixture");

        let mut service = EngineService::open(context.root.path()).expect("open engine");
        let project = TestContext::project(&mut service);
        let cases = [
            (&sdl, "builtin.sdlxliff", "SDL 新译文", "returned.sdlxliff"),
            (&mq, "builtin.mqxliff", "memoQ 新译文", "returned.mqxliff"),
            (&mqxlz, "builtin.mqxlz", "包内新译文", "returned.mqxlz"),
        ];
        let mut imported_documents = Vec::new();
        for (source, filter_id, target, output_name) in cases {
            let imported = service
                .import_document(ImportDocumentParams {
                    project_id: project.id.clone(),
                    source_path: source.to_string_lossy().into_owned(),
                    relative_path: None,
                    filter_id: None,
                    options: BTreeMap::new(),
                })
                .expect("import external CAT format");
            assert_eq!(imported.filter_id, filter_id);
            let segment = service
                .list_segments(SegmentListParams {
                    document_id: imported.document.id.clone(),
                    offset: 0,
                    limit: 10,
                })
                .expect("list imported vendor segment")
                .items
                .remove(0);
            let notes = service
                .store
                .list_segment_notes(&segment.id)
                .expect("list imported vendor notes");
            assert!(!notes.is_empty());
            service
                .update_target(UpdateTargetParams {
                    segment_id: segment.id,
                    target_text: target.to_string(),
                    expected_revision: segment.revision,
                })
                .expect("edit vendor target");
            imported_documents.push((
                imported.document.id,
                target.to_string(),
                context.root.path().join(output_name),
            ));
        }

        drop(service);
        let mut service = EngineService::open(context.root.path()).expect("restart engine");
        for (document_id, expected_target, output) in &imported_documents {
            let segment = service
                .list_segments(SegmentListParams {
                    document_id: document_id.clone(),
                    offset: 0,
                    limit: 10,
                })
                .expect("reload vendor segment")
                .items
                .remove(0);
            assert_eq!(&segment.target_text, expected_target);
            assert!(
                !service
                    .store
                    .list_segment_notes(&segment.id)
                    .expect("reload vendor notes")
                    .is_empty()
            );
            let export = service.export_document(ExportDocumentParams {
                document_id: document_id.clone(),
                output_path: output.to_string_lossy().into_owned(),
                qa_override: None,
            });
            match export {
                Ok(_) => {}
                Err(EngineError::QaGateBlocked { .. }) => {
                    service
                        .export_document(ExportDocumentParams {
                            document_id: document_id.clone(),
                            output_path: output.to_string_lossy().into_owned(),
                            qa_override: Some(test_qa_override()),
                        })
                        .expect("override vendor tag QA gate");
                }
                Err(error) => panic!("export vendor format after restart: {error}"),
            }
        }

        let sdl_round_trip = collect_imported_document(
            SdlxliffFilter
                .import(ImportRequest::new(imported_documents[0].2.clone()))
                .expect("reimport SDL output"),
        )
        .expect("collect SDL output");
        assert_eq!(
            sdl_round_trip.units[0].target_text.as_deref(),
            Some("SDL 新译文")
        );
        assert!(
            std::fs::read_to_string(&imported_documents[0].2)
                .expect("read SDL output")
                .contains("<x:meta keep=\"yes\"/>")
        );
        let mq_round_trip = collect_imported_document(
            MqxliffFilter
                .import(ImportRequest::new(imported_documents[1].2.clone()))
                .expect("reimport memoQ output"),
        )
        .expect("collect memoQ output");
        assert_eq!(
            mq_round_trip.units[0].target_text.as_deref(),
            Some("memoQ 新译文")
        );
        let mqxlz_round_trip = collect_imported_document(
            MqxlzFilter
                .import(ImportRequest::new(imported_documents[2].2.clone()))
                .expect("reimport MQXLZ output"),
        )
        .expect("collect MQXLZ output");
        assert_eq!(
            mqxlz_round_trip.units[0].target_text.as_deref(),
            Some("包内新译文")
        );
        let mut archive = ZipArchive::new(
            std::fs::File::open(&imported_documents[2].2).expect("open MQXLZ output"),
        )
        .expect("read MQXLZ output");
        let mut opaque = Vec::new();
        archive
            .by_name("resources/opaque.bin")
            .expect("find opaque MQXLZ part")
            .read_to_end(&mut opaque)
            .expect("read opaque MQXLZ part");
        assert_eq!(opaque, b"opaque auxiliary bytes");

        let existing = &imported_documents[2].2;
        let before = std::fs::read(existing).expect("read first MQXLZ output");
        assert!(
            service
                .export_document(ExportDocumentParams {
                    document_id: imported_documents[2].0.clone(),
                    output_path: existing.to_string_lossy().into_owned(),
                    qa_override: None,
                })
                .is_err()
        );
        assert_eq!(
            std::fs::read(existing).expect("reread MQXLZ output"),
            before
        );
    }

    #[test]
    fn health_and_backup_round_trip_authoritative_workspace() {
        let context = TestContext::new();
        let mut service = EngineService::open(context.root.path()).expect("open engine");
        let project = TestContext::project(&mut service);
        let document = service
            .import_docx(ImportDocxParams {
                project_id: project.id.clone(),
                source_path: context.source.to_string_lossy().into_owned(),
            })
            .expect("import document");
        let segment = service
            .list_segments(SegmentListParams {
                document_id: document.id.clone(),
                offset: 0,
                limit: 10,
            })
            .expect("list segments")
            .items
            .remove(0);
        service
            .update_target(UpdateTargetParams {
                segment_id: segment.id,
                target_text: "保留期为 30 天。".to_string(),
                expected_revision: segment.revision,
            })
            .expect("save translated target");
        let health = service
            .check_health(EmptyParams::default())
            .expect("check health");
        assert!(health.healthy, "unexpected findings: {:?}", health.findings);
        assert!(health.schema_version > 0);

        let destination = context.root.path().join("workspace-backup");
        let backup = service
            .create_backup(CreateBackupParams {
                destination_path: destination.to_string_lossy().into_owned(),
            })
            .expect("create backup");
        assert_eq!(backup.manifest.schema_version, health.schema_version);
        assert!(destination.join("translunar.sqlite3").is_file());
        assert!(
            destination
                .join("sources")
                .join(format!("{}.docx", document.id))
                .is_file()
        );
        drop(service);
        std::fs::remove_file(
            context
                .root
                .path()
                .join("sources")
                .join(format!("{}.docx", document.id)),
        )
        .expect("remove original managed source");
        let mut restored = EngineService::open(&destination).expect("open restored backup");
        let restored_health = restored
            .check_health(EmptyParams::default())
            .expect("check restored health");
        assert!(
            restored_health.healthy,
            "restored findings: {:?}",
            restored_health.findings
        );
        assert_eq!(
            restored
                .get_project(&project.id)
                .expect("restored project")
                .documents
                .len(),
            1
        );
        let history = restored
            .list_history(HistoryListParams {
                project_id: project.id,
                offset: 0,
                limit: 10,
                descending: false,
            })
            .expect("restored history");
        assert_eq!(history.total, 1);
        let restored_output = destination.join("exports").join("restored.docx");
        let exported = restored
            .export_document(ExportDocumentParams {
                document_id: document.id,
                output_path: restored_output.to_string_lossy().into_owned(),
                qa_override: Some(test_qa_override()),
            })
            .expect("export restored document");
        assert_eq!(exported.translated_segments, 1);
        assert!(restored_output.is_file());
    }

    #[test]
    fn dispatcher_requires_handshake_and_returns_typed_conflicts() {
        let context = TestContext::new();
        let mut dispatcher = RpcDispatcher::open(context.root.path()).expect("open dispatcher");
        let before_initialize = dispatcher.handle(RpcRequest {
            jsonrpc: "2.0".to_string(),
            id: json!(1),
            method: methods::PROJECT_CREATE.to_string(),
            params: json!({}),
        });
        assert_eq!(
            before_initialize.error.expect("typed error").code,
            ErrorCode::InvalidState
        );

        let initialized = dispatcher.handle(RpcRequest {
            jsonrpc: "2.0".to_string(),
            id: json!(2),
            method: methods::INITIALIZE.to_string(),
            params: serde_json::to_value(InitializeParams {
                protocol_version: PROTOCOL_VERSION,
                client: ClientInfo {
                    name: "test".to_string(),
                    version: "0".to_string(),
                },
            })
            .expect("serialize params"),
        });
        assert!(initialized.error.is_none());

        let created = dispatcher.handle(RpcRequest {
            jsonrpc: "2.0".to_string(),
            id: json!(3),
            method: methods::PROJECT_CREATE.to_string(),
            params: serde_json::to_value(CreateProjectParams {
                name: "Protocol project".to_string(),
                source_locale: "en-US".to_string(),
                target_locale: "zh-CN".to_string(),
                domain: "general".to_string(),
            })
            .expect("serialize project params"),
        });
        let project: Project = serde_json::from_value(created.result.expect("project result"))
            .expect("decode project");
        let update = UpdateProjectParams {
            project_id: project.id.clone(),
            name: "Updated project".to_string(),
            source_locale: project.source_locale.clone(),
            target_locale: project.target_locale.clone(),
            domain: project.domain.clone(),
            configuration: project.configuration.clone(),
            expected_revision: project.revision,
            actor: "test".to_string(),
            correlation_id: None,
        };
        let updated = dispatcher.handle(RpcRequest {
            jsonrpc: "2.0".to_string(),
            id: json!(4),
            method: methods::PROJECT_UPDATE.to_string(),
            params: serde_json::to_value(&update).expect("serialize update"),
        });
        assert!(updated.error.is_none());
        let stale = dispatcher.handle(RpcRequest {
            jsonrpc: "2.0".to_string(),
            id: json!(5),
            method: methods::PROJECT_UPDATE.to_string(),
            params: serde_json::to_value(update).expect("serialize stale update"),
        });
        let stale_error = stale.error.expect("stale conflict");
        assert_eq!(stale_error.code, ErrorCode::Conflict);
        assert_eq!(
            stale_error
                .data
                .as_ref()
                .and_then(|data| data.get("entity")),
            Some(&json!("project"))
        );
        assert_eq!(
            stale_error
                .data
                .as_ref()
                .and_then(|data| data.get("expectedRevision")),
            Some(&json!(0))
        );
        assert_eq!(
            stale_error
                .data
                .as_ref()
                .and_then(|data| data.get("actualRevision")),
            Some(&json!(1))
        );

        let unknown_filter = dispatcher.handle(RpcRequest {
            jsonrpc: "2.0".to_string(),
            id: json!(6),
            method: methods::DOCUMENT_IMPORT.to_string(),
            params: serde_json::to_value(ImportDocumentParams {
                project_id: project.id,
                source_path: context.source.to_string_lossy().into_owned(),
                relative_path: None,
                filter_id: Some("missing.filter".to_string()),
                options: Default::default(),
            })
            .expect("serialize generic import"),
        });
        let filter_error = unknown_filter.error.expect("unknown filter error");
        assert_eq!(filter_error.code, ErrorCode::NotFound);
        assert_eq!(
            filter_error
                .data
                .as_ref()
                .and_then(|data| data.get("entity")),
            Some(&json!("filter"))
        );
    }

    #[test]
    fn dispatcher_creates_projects_from_templates_and_returns_unavailable_analytics() {
        let context = TestContext::new();
        let mut dispatcher = RpcDispatcher::open(context.root.path()).expect("open dispatcher");
        let initialized = dispatcher.handle(RpcRequest {
            jsonrpc: "2.0".to_string(),
            id: json!(1),
            method: methods::INITIALIZE.to_string(),
            params: serde_json::to_value(InitializeParams {
                protocol_version: PROTOCOL_VERSION,
                client: ClientInfo {
                    name: "lifecycle-test".to_string(),
                    version: "0".to_string(),
                },
            })
            .expect("serialize initialize params"),
        });
        let initialize_result: InitializeResult =
            serde_json::from_value(initialized.result.expect("initialize result"))
                .expect("decode initialize result");
        assert!(
            initialize_result
                .capabilities
                .iter()
                .any(|value| value == "project.create-from-template")
        );
        assert!(
            initialize_result
                .capabilities
                .iter()
                .any(|value| value == "analysis.project-operational")
        );
        assert!(
            initialize_result
                .capabilities
                .iter()
                .any(|value| value == "interop.review-docx")
        );
        assert!(
            initialize_result
                .capabilities
                .iter()
                .any(|value| value == "interop.bilingual-table")
        );
        assert!(
            initialize_result
                .capabilities
                .iter()
                .any(|value| value == "plugin.qa-rule.v1")
        );
        assert!(
            initialize_result
                .capabilities
                .iter()
                .any(|value| value == "plugin.pipeline-step.v1")
        );

        let created_template = dispatcher.handle(RpcRequest {
            jsonrpc: "2.0".to_string(),
            id: json!(2),
            method: methods::PROJECT_TEMPLATE_CREATE.to_string(),
            params: serde_json::to_value(ProjectTemplateCreateParams {
                name: "Lifecycle template".to_string(),
                description: "Safe reusable defaults".to_string(),
                definition: json!({
                    "sourceLocale": "en-US",
                    "targetLocale": "zh-CN",
                    "domain": "legal",
                    "qaProfileId": "builtin.qa.cjk-professional",
                    "pipelineId": "missing-pipeline",
                    "analysisProfileId": "builtin.analysis.standard",
                    "reviewRequired": false
                }),
            })
            .expect("serialize template params"),
        });
        let template: ProjectTemplate =
            serde_json::from_value(created_template.result.expect("template result"))
                .expect("decode template");

        let instantiated = dispatcher.handle(RpcRequest {
            jsonrpc: "2.0".to_string(),
            id: json!(3),
            method: methods::PROJECT_CREATE_FROM_TEMPLATE.to_string(),
            params: serde_json::to_value(ProjectCreateFromTemplateParams {
                template_id: template.id.clone(),
                template_revision: Some(template.revision),
                name: "Instantiated lifecycle project".to_string(),
                source_locale: None,
                target_locale: None,
                domain: None,
                dependency_remaps: BTreeMap::new(),
            })
            .expect("serialize create-from-template params"),
        });
        let created: ProjectCreateFromTemplateResult =
            serde_json::from_value(instantiated.result.expect("instantiated project result"))
                .expect("decode instantiated project");
        assert_eq!(created.project.source_locale, "en-US");
        assert_eq!(created.project.target_locale, "zh-CN");
        assert_eq!(created.project.domain, "legal");
        assert_eq!(
            created.project.configuration.template_id.as_deref(),
            Some(template.id.as_str())
        );
        assert!(!created.project.configuration.review_required);
        assert!(
            created.diagnostics.iter().any(|diagnostic| {
                diagnostic.kind == "pipeline" && diagnostic.status == "missing"
            })
        );

        let analytics_response = dispatcher.handle(RpcRequest {
            jsonrpc: "2.0".to_string(),
            id: json!(4),
            method: methods::PROJECT_ANALYTICS_GET.to_string(),
            params: serde_json::to_value(ProjectAnalyticsParams {
                project_id: created.project.id.clone(),
                idle_gap_ms: 5 * 60 * 1_000,
                trend_bucket_ms: 24 * 60 * 60 * 1_000,
                trend_bucket_count: 3,
            })
            .expect("serialize analytics params"),
        });
        let analytics: ProjectAnalyticsResult =
            serde_json::from_value(analytics_response.result.expect("analytics result"))
                .expect("decode analytics");
        assert_eq!(analytics.project_id, created.project.id);
        assert_eq!(analytics.progress.total_segments, 0);
        assert!(!analytics.productivity.active_editing_ms.available);
        assert!(!analytics.ai.available);
        assert!(!analytics.assets.tm_reuse_segments.available);
        assert_eq!(analytics.trends.len(), 3);
    }

    #[test]
    fn professional_editor_commands_are_transactional_and_persist() {
        let context = TestContext::new();
        let mut service = EngineService::open(context.root.path()).expect("open engine");
        let project = TestContext::project(&mut service);
        let document = service
            .import_docx(ImportDocxParams {
                project_id: project.id.clone(),
                source_path: context.source.to_string_lossy().into_owned(),
            })
            .expect("import document");
        let page = service
            .list_editor_segments(EditorSegmentListParams {
                document_id: document.id.clone(),
                query: String::new(),
                field: EditorSearchField::Both,
                filter: EditorSegmentFilter::All,
                sort: EditorSegmentSort::Ordinal,
                descending: false,
                offset: 0,
                limit: 80,
                include_context: true,
            })
            .expect("list editor rows");
        assert_eq!(page.items.len(), 3);
        assert!(page.items[0].context_after.is_some());

        let first = &page.items[0].segment;
        let saved = service
            .update_target(UpdateTargetParams {
                segment_id: first.id.clone(),
                target_text: "保留期为 30 天。".to_string(),
                expected_revision: first.revision,
            })
            .expect("save target");
        let undone = service
            .undo_editor(EditorUndoRedoParams {
                project_id: project.id.clone(),
            })
            .expect("undo target");
        assert!(
            undone
                .rows
                .iter()
                .find(|row| row.segment.id == first.id)
                .expect("undone row")
                .segment
                .target_text
                .is_empty()
        );
        let redone = service
            .redo_editor(EditorUndoRedoParams {
                project_id: project.id.clone(),
            })
            .expect("redo target");
        let mut redone_first = redone
            .rows
            .iter()
            .find(|row| row.segment.id == first.id)
            .expect("redone row")
            .segment
            .clone();
        assert_eq!(redone_first.target_text, saved.target_text);
        let redone_editor_row = redone
            .rows
            .iter()
            .find(|row| row.segment.id == first.id)
            .expect("redone editor row");
        let target_length = u32::try_from(redone_first.target_text.chars().count()).unwrap_or(1);
        let denominator = u32::try_from(redone_editor_row.source_tags.len().saturating_sub(1))
            .unwrap_or(1)
            .max(1);
        let target_tags = redone_editor_row
            .source_tags
            .iter()
            .enumerate()
            .map(|(index, tag)| translunar_domain::InlineTag {
                id: format!("smoke-target-{index}"),
                side: translunar_domain::TagSide::Target,
                position: u32::try_from(index)
                    .unwrap_or(u32::MAX)
                    .saturating_mul(target_length)
                    / denominator,
                kind: tag.kind,
                pair_id: tag.pair_id.clone(),
                payload: tag.payload.clone(),
                display_text: tag.display_text.clone(),
                protected: true,
            })
            .collect::<Vec<_>>();
        let partial_tags = target_tags.iter().take(2).cloned().collect::<Vec<_>>();
        let partial_mutation = service
            .set_segment_tags(SetSegmentTagsParams {
                segment_id: first.id.clone(),
                target_tags: partial_tags,
                expected_revision: redone_first.revision,
            })
            .expect("insert one protected target tag pair");
        let partial_row = partial_mutation
            .rows
            .iter()
            .find(|row| row.segment.id == first.id)
            .expect("partially tagged row");
        assert_eq!(partial_row.target_tags.len(), 2);
        assert!(
            partial_row
                .tag_issues
                .iter()
                .any(|issue| issue.code == "tag_missing")
        );
        let reverted_partial = service
            .undo_editor(EditorUndoRedoParams {
                project_id: project.id.clone(),
            })
            .expect("undo partial protected target tags");
        redone_first = reverted_partial
            .rows
            .iter()
            .find(|row| row.segment.id == first.id)
            .expect("row after undoing partial protected target tags")
            .segment
            .clone();
        service
            .set_segment_tags(SetSegmentTagsParams {
                segment_id: first.id.clone(),
                target_tags,
                expected_revision: redone_first.revision,
            })
            .expect("set protected target tags");
        let undone_tags = service
            .undo_editor(EditorUndoRedoParams {
                project_id: project.id.clone(),
            })
            .expect("undo protected target tags");
        assert!(
            undone_tags
                .rows
                .iter()
                .find(|row| row.segment.id == first.id)
                .expect("undone protected tag row")
                .target_tags
                .is_empty()
        );
        let redone_tags = service
            .redo_editor(EditorUndoRedoParams {
                project_id: project.id.clone(),
            })
            .expect("redo protected target tags");
        redone_first = redone_tags
            .rows
            .iter()
            .find(|row| row.segment.id == first.id)
            .expect("redone tagged row")
            .segment
            .clone();
        assert_eq!(
            redone_tags
                .rows
                .iter()
                .find(|row| row.segment.id == first.id)
                .expect("redone protected tag row")
                .target_tags
                .len(),
            redone_editor_row.source_tags.len()
        );

        let stale_preview = service
            .preview_replace(ReplacePreviewParams {
                document_id: document.id.clone(),
                query: "30".to_string(),
                replacement: "60".to_string(),
                field: EditorSearchField::Target,
                regex: false,
                case_sensitive: true,
                whole_word: false,
            })
            .expect("preview replace");
        let changed = service
            .update_target(UpdateTargetParams {
                segment_id: redone_first.id.clone(),
                target_text: "保留期为 45 天。".to_string(),
                expected_revision: redone_first.revision,
            })
            .expect("create stale preview");
        assert!(matches!(
            service.apply_replace(ReplaceApplyParams {
                preview: stale_preview
            }),
            Err(EngineError::Storage(StorageError::Conflict { .. }))
        ));
        let preview = service
            .preview_replace(ReplacePreviewParams {
                document_id: document.id.clone(),
                query: "45".to_string(),
                replacement: "60".to_string(),
                field: EditorSearchField::Target,
                regex: false,
                case_sensitive: true,
                whole_word: false,
            })
            .expect("fresh preview");
        let replaced = service
            .apply_replace(ReplaceApplyParams { preview })
            .expect("apply replace");
        assert_eq!(
            replaced
                .rows
                .iter()
                .find(|row| row.segment.id == changed.id)
                .expect("replaced row")
                .segment
                .target_text,
            "保留期为 60 天。"
        );

        let comment = service
            .create_segment_comment(CreateSegmentCommentParams {
                segment_id: first.id.clone(),
                author: "reviewer".to_string(),
                text: "Check the number.".to_string(),
            })
            .expect("create comment");
        let comment = service
            .resolve_segment_comment(ResolveSegmentCommentParams {
                comment_id: comment.id,
                resolved: true,
                expected_revision: comment.revision,
            })
            .expect("resolve comment");
        assert!(comment.resolved);
        service
            .undo_editor(EditorUndoRedoParams {
                project_id: project.id.clone(),
            })
            .expect("undo comment resolution");
        assert!(
            !service
                .list_segment_comments(SegmentCommentListParams {
                    segment_id: first.id.clone(),
                    include_resolved: true,
                })
                .expect("list undone comment")
                .comments[0]
                .resolved
        );
        service
            .redo_editor(EditorUndoRedoParams {
                project_id: project.id.clone(),
            })
            .expect("redo comment resolution");

        let second = &page.items[1].segment;
        let review = service
            .create_review(ReviewCreateParams {
                segment_id: second.id.clone(),
                proposed_target: Some("审阅后的译文。".to_string()),
                proposed_source: None,
                proposed_target_tags: None,
                author: "reviewer".to_string(),
                reason: "Improve clarity".to_string(),
                expected_revision: second.revision,
            })
            .expect("create review");
        let accepted = service
            .accept_review(ReviewDecisionParams {
                review_id: review.id,
                expected_segment_revision: second.revision,
            })
            .expect("accept review");
        assert_eq!(
            accepted
                .rows
                .iter()
                .find(|row| row.segment.id == second.id)
                .expect("reviewed row")
                .segment
                .target_text,
            "审阅后的译文。"
        );
        service
            .undo_editor(EditorUndoRedoParams {
                project_id: project.id.clone(),
            })
            .expect("undo accepted review");
        let pending_review = service
            .list_reviews(ReviewListParams {
                document_id: document.id.clone(),
                include_closed: true,
            })
            .expect("list undone review");
        assert_eq!(
            pending_review.revisions[0].status,
            translunar_domain::ReviewStatus::Pending
        );
        let redone_review = service
            .redo_editor(EditorUndoRedoParams {
                project_id: project.id.clone(),
            })
            .expect("redo accepted review");
        let reviewed_second = redone_review
            .rows
            .iter()
            .find(|row| row.segment.id == second.id)
            .expect("redone reviewed row")
            .segment
            .clone();
        let confirmed_second = service
            .confirm_segment(ConfirmSegmentParams {
                segment_id: reviewed_second.id.clone(),
                expected_revision: reviewed_second.revision,
            })
            .expect("confirm reviewed segment")
            .segment;
        let signed = service
            .set_editor_workflow(SetEditorWorkflowParams {
                segment_id: confirmed_second.id.clone(),
                state: translunar_domain::EditorWorkflowState::Signed,
                expected_revision: confirmed_second.revision,
                actor: None,
                reason: None,
            })
            .expect("sign reviewed segment");
        assert_eq!(
            signed
                .rows
                .iter()
                .find(|row| row.segment.id == second.id)
                .expect("signed row")
                .workflow_state,
            translunar_domain::EditorWorkflowState::Signed
        );
        let signed_segment = signed
            .rows
            .iter()
            .find(|row| row.segment.id == second.id)
            .expect("signed segment")
            .segment
            .clone();
        assert!(matches!(
            service.update_target(UpdateTargetParams {
                segment_id: signed_segment.id,
                target_text: "signed content must not change".to_string(),
                expected_revision: signed_segment.revision,
            }),
            Err(EngineError::Storage(StorageError::InvalidState(_)))
        ));
        service
            .undo_editor(EditorUndoRedoParams {
                project_id: project.id.clone(),
            })
            .expect("undo signed workflow");
        service
            .redo_editor(EditorUndoRedoParams {
                project_id: project.id.clone(),
            })
            .expect("redo signed workflow");

        let third_document_row = &page.items[2];
        let source_review = service
            .create_review(ReviewCreateParams {
                segment_id: third_document_row.segment.id.clone(),
                proposed_target: None,
                proposed_source: Some(format!(
                    "{} corrected",
                    third_document_row.segment.source_text
                )),
                proposed_target_tags: None,
                author: "source-reviewer".to_string(),
                reason: "Correct the source".to_string(),
                expected_revision: third_document_row.segment.revision,
            })
            .expect("create source review");
        assert!(source_review.proposed_source.is_some());
        let accepted_source = service
            .accept_review(ReviewDecisionParams {
                review_id: source_review.id,
                expected_segment_revision: third_document_row.segment.revision,
            })
            .expect("accept source review");
        assert!(
            accepted_source
                .rows
                .iter()
                .find(|row| row.segment.id == third_document_row.segment.id)
                .expect("source-reviewed row")
                .segment
                .source_text
                .ends_with(" corrected")
        );
        service
            .undo_editor(EditorUndoRedoParams {
                project_id: project.id.clone(),
            })
            .expect("undo source review");
        service
            .redo_editor(EditorUndoRedoParams {
                project_id: project.id.clone(),
            })
            .expect("redo source review");

        let first_review_row = service
            .list_editor_segments(EditorSegmentListParams {
                document_id: document.id.clone(),
                query: String::new(),
                field: EditorSearchField::Both,
                filter: EditorSegmentFilter::All,
                sort: EditorSegmentSort::Ordinal,
                descending: false,
                offset: 0,
                limit: 80,
                include_context: true,
            })
            .expect("list tag review row")
            .items
            .into_iter()
            .find(|row| row.segment.id == first.id)
            .expect("tag review row");
        let tag_review = service
            .create_review(ReviewCreateParams {
                segment_id: first.id.clone(),
                proposed_target: Some("保留期为 60 天（审阅）。".to_string()),
                proposed_source: None,
                proposed_target_tags: Some(first_review_row.target_tags.clone()),
                author: "tag-reviewer".to_string(),
                reason: "Review target and protected tags together".to_string(),
                expected_revision: first_review_row.segment.revision,
            })
            .expect("create tag review");
        assert_eq!(
            tag_review
                .proposed_target_tags
                .as_ref()
                .expect("proposed review tags")
                .len(),
            first_review_row.target_tags.len()
        );
        let accepted_tags = service
            .accept_review(ReviewDecisionParams {
                review_id: tag_review.id,
                expected_segment_revision: first_review_row.segment.revision,
            })
            .expect("accept tag review");
        assert_eq!(
            accepted_tags
                .rows
                .iter()
                .find(|row| row.segment.id == first.id)
                .expect("accepted tag review row")
                .target_tags
                .len(),
            first_review_row.target_tags.len()
        );

        let split_source = context.root.path().join("split.txt");
        std::fs::write(&split_source, "Alpha beta gamma.").expect("write split fixture");
        let split_document = service
            .import_document(ImportDocumentParams {
                project_id: project.id.clone(),
                source_path: split_source.to_string_lossy().into_owned(),
                relative_path: None,
                filter_id: Some("builtin.txt".to_string()),
                options: Default::default(),
            })
            .expect("import split fixture")
            .document;
        let third = service
            .list_editor_segments(EditorSegmentListParams {
                document_id: split_document.id,
                query: String::new(),
                field: EditorSearchField::Both,
                filter: EditorSegmentFilter::All,
                sort: EditorSegmentSort::Ordinal,
                descending: false,
                offset: 0,
                limit: 80,
                include_context: true,
            })
            .expect("list split fixture")
            .items
            .remove(0)
            .segment;
        let split = service
            .split_segment(SplitSegmentParams {
                segment_id: third.id.clone(),
                source_offset: 6,
                target_offset: Some(0),
                expected_revision: third.revision,
            })
            .expect("split segment");
        assert_eq!(split.rows.len(), 2);
        let unsplit = service
            .undo_editor(EditorUndoRedoParams {
                project_id: project.id.clone(),
            })
            .expect("undo split");
        assert_eq!(unsplit.rows.len(), 1);
        assert_eq!(unsplit.rows[0].segment.source_text, "Alpha beta gamma.");
        let split = service
            .redo_editor(EditorUndoRedoParams {
                project_id: project.id.clone(),
            })
            .expect("redo split");
        assert_eq!(split.rows.len(), 2);
        let split_index = split
            .rows
            .iter()
            .position(|row| row.segment.id == third.id)
            .expect("split first row");
        let split_first = &split.rows[split_index].segment;
        let split_second = &split.rows[split_index + 1].segment;
        let merged = service
            .merge_segments(MergeSegmentsParams {
                first_segment_id: split_first.id.clone(),
                second_segment_id: split_second.id.clone(),
                first_expected_revision: split_first.revision,
                second_expected_revision: split_second.revision,
            })
            .expect("merge segment");
        assert_eq!(merged.rows.len(), 1);
        let unmerged = service
            .undo_editor(EditorUndoRedoParams {
                project_id: project.id.clone(),
            })
            .expect("undo merge");
        assert_eq!(unmerged.rows.len(), 2);
        let remerged = service
            .redo_editor(EditorUndoRedoParams {
                project_id: project.id.clone(),
            })
            .expect("redo merge");
        assert_eq!(remerged.rows.len(), 1);

        service
            .add_dictionary_word(DictionaryWordParams {
                locale: "en-US".to_string(),
                word: "mispellled".to_string(),
            })
            .expect("add dictionary word");
        let spell = service
            .spell_check(SpellCheckParams {
                locale: "en-US".to_string(),
                text: "mispellled word".to_string(),
                limit: 20,
            })
            .expect("spell check");
        assert!(spell.findings.iter().all(|item| item.word != "mispellled"));

        service
            .update_editor_preferences(UpdateEditorPreferencesParams {
                preferences: EditorPreferences {
                    theme: "dark".to_string(),
                    zoom: 125,
                    show_nonprinting: true,
                    ..EditorPreferences::default()
                },
            })
            .expect("update preferences");
        drop(service);

        let service = EngineService::open(context.root.path()).expect("reopen engine");
        assert_eq!(
            service
                .get_editor_preferences(EmptyParams {})
                .expect("persisted preferences")
                .theme,
            "dark"
        );
        assert_eq!(
            service
                .list_segment_comments(SegmentCommentListParams {
                    segment_id: first.id.clone(),
                    include_resolved: true,
                })
                .expect("persisted comments")
                .comments
                .len(),
            1
        );
        assert_eq!(
            service
                .list_reviews(ReviewListParams {
                    document_id: document.id,
                    include_closed: true,
                })
                .expect("persisted reviews")
                .revisions[0]
                .status,
            translunar_domain::ReviewStatus::Accepted
        );
    }

    #[test]
    fn chinese_conversion_is_phrase_aware_durable_and_undoable() {
        let context = TestContext::new();
        let mut service = EngineService::open(context.root.path()).expect("open engine");
        let project = TestContext::project(&mut service);
        let document = service
            .import_docx(ImportDocxParams {
                project_id: project.id.clone(),
                source_path: context.source.to_string_lossy().into_owned(),
            })
            .expect("import document");
        let page = service
            .list_editor_segments(EditorSegmentListParams {
                document_id: document.id,
                query: String::new(),
                field: EditorSearchField::Both,
                filter: EditorSegmentFilter::All,
                sort: EditorSegmentSort::Ordinal,
                descending: false,
                offset: 0,
                limit: 80,
                include_context: false,
            })
            .expect("list editor rows");
        let first = &page.items[0].segment;
        let saved = service
            .update_target(UpdateTargetParams {
                segment_id: first.id.clone(),
                target_text: "鼠标和打印机里的软件".to_string(),
                expected_revision: first.revision,
            })
            .expect("save simplified target");
        let converted = service
            .convert_segment_chinese(ConvertSegmentChineseParams {
                segment_id: first.id.clone(),
                profile: ChineseConversionProfile::SimplifiedToTaiwan,
                expected_revision: saved.revision,
            })
            .expect("convert target to Taiwan vocabulary");
        assert_eq!(
            converted
                .rows
                .iter()
                .find(|row| row.segment.id == first.id)
                .expect("converted row")
                .segment
                .target_text,
            "滑鼠和印表機裡的軟體"
        );
        let undone = service
            .undo_editor(EditorUndoRedoParams {
                project_id: project.id.clone(),
            })
            .expect("undo Chinese conversion");
        assert_eq!(
            undone
                .rows
                .iter()
                .find(|row| row.segment.id == first.id)
                .expect("undone conversion row")
                .segment
                .target_text,
            "鼠标和打印机里的软件"
        );
        drop(service);

        let mut service = EngineService::open(context.root.path()).expect("reopen engine");
        let redone = service
            .redo_editor(EditorUndoRedoParams {
                project_id: project.id,
            })
            .expect("redo Chinese conversion after restart");
        assert_eq!(
            redone
                .rows
                .iter()
                .find(|row| row.segment.id == first.id)
                .expect("redone conversion row")
                .segment
                .target_text,
            "滑鼠和印表機裡的軟體"
        );
    }

    #[test]
    fn editor_history_invalidates_abandoned_redo_branch() {
        let context = TestContext::new();
        let mut service = EngineService::open(context.root.path()).expect("open engine");
        let project = TestContext::project(&mut service);
        let source = context.root.path().join("history.txt");
        std::fs::write(&source, "Branching editor history.").expect("write history fixture");
        let document = service
            .import_document(ImportDocumentParams {
                project_id: project.id.clone(),
                source_path: source.to_string_lossy().into_owned(),
                relative_path: None,
                filter_id: Some("builtin.txt".to_string()),
                options: Default::default(),
            })
            .expect("import history fixture")
            .document;
        let initial = service
            .list_segments(SegmentListParams {
                document_id: document.id,
                offset: 0,
                limit: 10,
            })
            .expect("list history segment")
            .items
            .remove(0);
        service
            .update_target(UpdateTargetParams {
                segment_id: initial.id.clone(),
                target_text: "first branch".to_string(),
                expected_revision: initial.revision,
            })
            .expect("write first branch");
        let undone = service
            .undo_editor(EditorUndoRedoParams {
                project_id: project.id.clone(),
            })
            .expect("undo first branch");
        let base = undone
            .rows
            .iter()
            .find(|row| row.segment.id == initial.id)
            .expect("history base")
            .segment
            .clone();
        service
            .update_target(UpdateTargetParams {
                segment_id: base.id.clone(),
                target_text: "second branch".to_string(),
                expected_revision: base.revision,
            })
            .expect("write second branch");
        service
            .undo_editor(EditorUndoRedoParams {
                project_id: project.id.clone(),
            })
            .expect("undo second branch");
        let redone = service
            .redo_editor(EditorUndoRedoParams {
                project_id: project.id.clone(),
            })
            .expect("redo second branch");
        assert_eq!(redone.rows[0].segment.target_text, "second branch");
        assert!(matches!(
            service.redo_editor(EditorUndoRedoParams {
                project_id: project.id.clone(),
            }),
            Err(EngineError::Storage(StorageError::InvalidState(_)))
        ));
        drop(service);

        let mut service = EngineService::open(context.root.path()).expect("reopen engine");
        let undone = service
            .undo_editor(EditorUndoRedoParams {
                project_id: project.id.clone(),
            })
            .expect("undo branch after restart");
        assert!(undone.rows[0].segment.target_text.is_empty());
        let redone = service
            .redo_editor(EditorUndoRedoParams {
                project_id: project.id,
            })
            .expect("redo branch after restart");
        assert_eq!(redone.rows[0].segment.target_text, "second branch");
    }

    #[test]
    fn undo_redo_restores_confirmation_tm_and_qa_side_effects() {
        let context = TestContext::new();
        let mut service = EngineService::open(context.root.path()).expect("open engine");
        let project = TestContext::project(&mut service);
        let source = context.root.path().join("confirm-history.txt");
        std::fs::write(&source, "Retention is 30 days.").expect("write confirmation fixture");
        let document = service
            .import_document(ImportDocumentParams {
                project_id: project.id.clone(),
                source_path: source.to_string_lossy().into_owned(),
                relative_path: None,
                filter_id: Some("builtin.txt".to_string()),
                options: Default::default(),
            })
            .expect("import confirmation fixture")
            .document;
        let segment = service
            .list_segments(SegmentListParams {
                document_id: document.id.clone(),
                offset: 0,
                limit: 10,
            })
            .expect("list confirmation fixture")
            .items
            .remove(0);
        let draft = service
            .update_target(UpdateTargetParams {
                segment_id: segment.id.clone(),
                target_text: "保留期为 60 天。".to_string(),
                expected_revision: segment.revision,
            })
            .expect("save confirmation target");
        let preconfirm_qa = service
            .list_qa(ListQaParams {
                document_id: document.id.clone(),
                include_resolved: true,
            })
            .expect("pre-confirm live QA")
            .issues
            .into_iter()
            .map(|issue| issue.id)
            .collect::<BTreeSet<_>>();
        service
            .confirm_segment(ConfirmSegmentParams {
                segment_id: segment.id.clone(),
                expected_revision: draft.revision,
            })
            .expect("confirm fixture");
        assert_eq!(
            service
                .lookup_exact(ExactLookupParams {
                    project_id: project.id.clone(),
                    source_text: segment.source_text.clone(),
                })
                .expect("confirmed exact lookup")
                .matches
                .len(),
            1
        );
        let confirmed_qa = service
            .list_qa(ListQaParams {
                document_id: document.id.clone(),
                include_resolved: false,
            })
            .expect("confirmed QA")
            .issues;
        assert!(confirmed_qa.len() > preconfirm_qa.len());
        service
            .undo_editor(EditorUndoRedoParams {
                project_id: project.id.clone(),
            })
            .expect("undo confirmation");
        assert!(
            service
                .lookup_exact(ExactLookupParams {
                    project_id: project.id.clone(),
                    source_text: segment.source_text.clone(),
                })
                .expect("undone exact lookup")
                .matches
                .is_empty()
        );
        let undone_qa = service
            .list_qa(ListQaParams {
                document_id: document.id.clone(),
                include_resolved: true,
            })
            .expect("undone QA")
            .issues
            .into_iter()
            .map(|issue| issue.id)
            .collect::<BTreeSet<_>>();
        assert_eq!(undone_qa, preconfirm_qa);
        service
            .redo_editor(EditorUndoRedoParams {
                project_id: project.id.clone(),
            })
            .expect("redo confirmation");
        assert_eq!(
            service
                .lookup_exact(ExactLookupParams {
                    project_id: project.id,
                    source_text: segment.source_text,
                })
                .expect("redone exact lookup")
                .matches
                .len(),
            1
        );
    }

    #[test]
    fn qa_reports_gate_and_override_flow_are_engine_owned() {
        let context = TestContext::new();
        let mut service = EngineService::open(context.root.path()).expect("open QA engine");
        let project = TestContext::project(&mut service);
        let document = service
            .import_docx(ImportDocxParams {
                project_id: project.id.clone(),
                source_path: context.source.to_string_lossy().into_owned(),
            })
            .expect("import QA fixture");
        let segment = service
            .list_segments(SegmentListParams {
                document_id: document.id.clone(),
                offset: 0,
                limit: 20,
            })
            .expect("list QA fixture")
            .items
            .remove(0);
        service
            .update_target(UpdateTargetParams {
                segment_id: segment.id,
                target_text: "保留期为 60 天。".to_string(),
                expected_revision: segment.revision,
            })
            .expect("seed dirty QA target");

        let run = service
            .run_qa(translunar_protocol::QaRunParams {
                project_id: project.id.clone(),
                document_id: Some(document.id.clone()),
                profile_id: Some(translunar_qa_core::STANDARD_PROFILE_ID.to_string()),
            })
            .expect("run comprehensive QA");
        assert!(run.errors > 0);
        let issue_page = service
            .list_qa_issues(translunar_protocol::QaIssueListParams {
                project_id: project.id.clone(),
                document_id: Some(document.id.clone()),
                segment_id: None,
                severity: None,
                category: None,
                disposition: Some(translunar_qa_core::QaIssueDisposition::Open),
                rule_id: None,
                offset: 0,
                limit: 100,
            })
            .expect("list comprehensive QA");
        assert!(issue_page.total > 0);

        let html_path = context.root.path().join("qa-report.html");
        let html_record = service
            .export_qa_report(translunar_protocol::QaReportExportParams {
                run_id: run.id.clone(),
                format: translunar_qa_core::QaReportFormat::Html,
                output_path: html_path.to_string_lossy().into_owned(),
            })
            .expect("export QA HTML");
        assert_eq!(html_record.run_id, run.id);
        translunar_qa_core::validate_html(&fs::read(&html_path).expect("read QA HTML"))
            .expect("validate QA HTML");
        assert!(matches!(
            service.export_qa_report(translunar_protocol::QaReportExportParams {
                run_id: run.id.clone(),
                format: translunar_qa_core::QaReportFormat::Html,
                output_path: html_path.to_string_lossy().into_owned(),
            }),
            Err(EngineError::ReportExport(_))
        ));

        let xlsx_path = context.root.path().join("qa-report.xlsx");
        service
            .export_qa_report(translunar_protocol::QaReportExportParams {
                run_id: run.id,
                format: translunar_qa_core::QaReportFormat::Xlsx,
                output_path: xlsx_path.to_string_lossy().into_owned(),
            })
            .expect("export QA XLSX");
        translunar_qa_core::validate_xlsx(&fs::read(&xlsx_path).expect("read QA XLSX"))
            .expect("validate QA XLSX");

        let blocked_output = context.root.path().join("blocked.docx");
        let blocked = service
            .export_document(ExportDocumentParams {
                document_id: document.id.clone(),
                output_path: blocked_output.to_string_lossy().into_owned(),
                qa_override: None,
            })
            .expect_err("block dirty export");
        assert!(!blocked_output.exists());
        let gate_error = rpc_error(blocked);
        assert_eq!(gate_error.code, ErrorCode::QaGateBlocked);
        assert!(
            gate_error
                .data
                .as_ref()
                .and_then(|data| data.get("blockerIssueIds"))
                .and_then(Value::as_array)
                .is_some_and(|ids| !ids.is_empty())
        );

        let delivered_output = context.root.path().join("delivered.docx");
        service
            .export_document(ExportDocumentParams {
                document_id: document.id.clone(),
                output_path: delivered_output.to_string_lossy().into_owned(),
                qa_override: Some(translunar_protocol::QaOverrideInput {
                    actor: "lead-reviewer".to_string(),
                    reason: "Customer approved known fixture findings".to_string(),
                }),
            })
            .expect("override dirty export");
        assert!(delivered_output.is_file());
        let overrides = service
            .list_qa_overrides(translunar_protocol::QaOverrideListParams {
                project_id: project.id,
                document_id: Some(document.id),
                offset: 0,
                limit: 20,
            })
            .expect("list QA overrides");
        assert_eq!(overrides.total, 1);
        assert_eq!(
            overrides.items[0].status,
            translunar_qa_core::QaOverrideStatus::Succeeded
        );
    }

    #[test]
    fn parses_bounded_hunspell_output_at_unicode_scalar_offsets() {
        let text = "前缀 correct mispellled wrng";
        let words = spell_word_spans(text);
        let findings = parse_hunspell_output(
            "@(#) Hunspell 1.7\n*\n& mispellled 1 0: misspelled\n# wrng 0\n",
            &words,
            text,
            "hunspell:test",
            1,
        )
        .expect("parse hunspell output");
        assert_eq!(findings.len(), 1);
        assert_eq!(findings[0].word, "mispellled");
        assert_eq!(findings[0].start, 11);
        assert_eq!(findings[0].end, 21);
        assert_eq!(findings[0].suggestions, ["misspelled"]);
        assert_eq!(findings[0].provider, "hunspell:test");
        assert!(parse_hunspell_output("*\n", &words, text, "hunspell:test", 10).is_none());
    }

    #[test]
    fn project_archive_is_hash_validated_no_clobber_and_restores_new_identity() {
        let context = TestContext::new();
        let mut service = EngineService::open(context.root.path()).expect("open engine");
        let project = TestContext::project(&mut service);
        let document = service
            .import_docx(ImportDocxParams {
                project_id: project.id.clone(),
                source_path: context.source.to_string_lossy().into_owned(),
            })
            .expect("import DOCX");
        let page = service
            .list_segments(SegmentListParams {
                document_id: document.id.clone(),
                offset: 0,
                limit: 20,
            })
            .expect("list segments");
        service
            .update_target(UpdateTargetParams {
                segment_id: page.items[0].id.clone(),
                target_text: "归档译文".to_string(),
                expected_revision: page.items[0].revision,
            })
            .expect("translate archive segment");
        let archive = context.root.path().join("portable.tlcat");
        let exported = service
            .export_project_archive(ProjectArchiveExportParams {
                project_id: project.id.clone(),
                destination_path: archive.to_string_lossy().into_owned(),
                actor: "tester".to_string(),
            })
            .expect("export project archive");
        assert_eq!(exported.project_id, project.id);
        assert!(archive.is_file());
        assert!(
            service
                .export_project_archive(ProjectArchiveExportParams {
                    project_id: project.id.clone(),
                    destination_path: archive.to_string_lossy().into_owned(),
                    actor: "tester".to_string(),
                })
                .is_err()
        );

        let corrupt = context.root.path().join("corrupt.tlcat");
        let mut bytes = fs::read(&archive).expect("read archive");
        let middle = bytes.len() / 2;
        bytes[middle] ^= 0x5a;
        fs::write(&corrupt, bytes).expect("write corrupt archive");
        let before = service
            .list_projects(ProjectListParams {
                lifecycle: None,
                offset: 0,
                limit: 100,
            })
            .expect("list projects before corrupt restore")
            .total;
        let corrupt_error = service
            .restore_project_archive(ProjectArchiveRestoreParams {
                archive_path: corrupt.to_string_lossy().into_owned(),
                dependency_remaps: BTreeMap::new(),
                actor: "tester".to_string(),
            })
            .expect_err("corrupt archive should be rejected");
        assert!(matches!(corrupt_error, EngineError::InvalidRequest(_)));
        assert_eq!(
            service
                .list_projects(ProjectListParams {
                    lifecycle: None,
                    offset: 0,
                    limit: 100,
                })
                .expect("list projects after corrupt restore")
                .total,
            before
        );

        let restored = service
            .restore_project_archive(ProjectArchiveRestoreParams {
                archive_path: archive.to_string_lossy().into_owned(),
                dependency_remaps: BTreeMap::new(),
                actor: "tester".to_string(),
            })
            .expect("restore valid archive");
        assert_ne!(restored.project_id, project.id);
        let restored_snapshot = service
            .get_project(&restored.project_id)
            .expect("get restored project");
        assert_eq!(restored_snapshot.documents.len(), 1);
        assert_ne!(restored_snapshot.documents[0].id, document.id);
        let restored_segments = service
            .list_segments(SegmentListParams {
                document_id: restored_snapshot.documents[0].id.clone(),
                offset: 0,
                limit: 20,
            })
            .expect("list restored segments");
        assert_eq!(restored_segments.items[0].target_text, "归档译文");
    }

    #[test]
    fn interop_review_round_trip_is_durable_and_idempotent() {
        let context = TestContext::new();
        let mut service = EngineService::open(context.root.path()).expect("open engine");
        let project = TestContext::project(&mut service);
        let review_source = context.root.path().join("review-source.txt");
        fs::write(&review_source, "First source\n\nSecond source").expect("write review source");
        let document = service
            .import_document(ImportDocumentParams {
                project_id: project.id.clone(),
                source_path: review_source.to_string_lossy().into_owned(),
                relative_path: None,
                filter_id: Some("builtin.txt".to_string()),
                options: BTreeMap::new(),
            })
            .expect("import review source")
            .document;
        let output = context.root.path().join("offline-review.docx");
        let exported = service
            .export_review(ReviewExportParams {
                project_id: project.id.clone(),
                document_id: document.id.clone(),
                expected_document_revision: document.revision,
                output_path: output.to_string_lossy().into_owned(),
            })
            .expect("export review DOCX");
        let existing_bytes = fs::read(&output).expect("read exported review");
        let no_clobber = service
            .export_review(ReviewExportParams {
                project_id: project.id.clone(),
                document_id: document.id.clone(),
                expected_document_revision: document.revision,
                output_path: output.to_string_lossy().into_owned(),
            })
            .expect_err("review export must not overwrite an existing destination");
        assert!(matches!(no_clobber, EngineError::Export(_)));
        assert_eq!(
            fs::read(&output).expect("reread exported review"),
            existing_bytes
        );
        assert_eq!(exported.row_count, document.segment_count);
        let parsed = parse_review_docx(&output).expect("parse exported review");
        assert_eq!(parsed.manifest.manifest_hash, exported.manifest_hash);
        assert!(
            parsed
                .manifest
                .rows
                .iter()
                .all(|row| row.row_id != row.segment_id)
        );
        let segments = service
            .list_segments(SegmentListParams {
                document_id: document.id.clone(),
                offset: 0,
                limit: 100,
            })
            .expect("list review segments")
            .items;
        let edited_rows = parsed
            .manifest
            .rows
            .iter()
            .map(|binding| {
                let segment = segments
                    .iter()
                    .find(|segment| segment.id == binding.segment_id)
                    .expect("bound segment");
                ReviewExportRow {
                    row_id: binding.row_id.clone(),
                    segment_id: binding.segment_id.clone(),
                    segment_revision: binding.segment_revision,
                    ordinal: binding.ordinal,
                    source_text: segment.source_text.clone(),
                    target_text: if binding.ordinal == 0 {
                        "离线审校译文".to_string()
                    } else {
                        segment.target_text.clone()
                    },
                    status: "translation".to_string(),
                    comments: if binding.ordinal == 0 {
                        "Reviewed offline".to_string()
                    } else {
                        String::new()
                    },
                }
            })
            .collect();
        let edited = context.root.path().join("offline-review-edited.docx");
        let (bytes, edited_manifest) =
            translunar_filter_interop::build_review_docx(&ReviewExportInput {
                project_id: project.id.clone(),
                document_id: document.id.clone(),
                base_document_revision: document.revision,
                rows: edited_rows,
            })
            .expect("build edited review");
        assert_eq!(edited_manifest.manifest_hash, exported.manifest_hash);
        fs::write(&edited, bytes).expect("write edited review");

        let preview = service
            .preview_review(ReviewPreviewParams {
                project_id: project.id.clone(),
                document_id: document.id.clone(),
                input_path: Some(edited.to_string_lossy().into_owned()),
                preview_id: None,
                expected_document_revision: document.revision,
                offset: 0,
                limit: 100,
            })
            .expect("preview edited review");
        assert_eq!(preview.total, document.segment_count);
        let changed = preview
            .rows
            .iter()
            .find(|row| row.disposition == ReviewInteropDisposition::Changed)
            .cloned()
            .expect("changed review row");
        assert_eq!(changed.target_text, "离线审校译文");
        assert_eq!(changed.comments, "Reviewed offline");
        assert_eq!(
            preview
                .rows
                .iter()
                .filter(|row| row.disposition == ReviewInteropDisposition::Unchanged)
                .count(),
            usize::try_from(document.segment_count.saturating_sub(1)).expect("row count")
        );
        let reopened_page = service
            .preview_review(ReviewPreviewParams {
                project_id: project.id.clone(),
                document_id: document.id.clone(),
                input_path: None,
                preview_id: Some(preview.preview_id.clone()),
                expected_document_revision: document.revision,
                offset: 0,
                limit: 1,
            })
            .expect("page durable review preview");
        assert_eq!(reopened_page.total, preview.total);
        assert_eq!(reopened_page.rows.len(), 1);
        let staged = service
            .store
            .get_interop_preview(&preview.preview_id)
            .expect("stored review preview")
            .staged_input_path;
        let staged = context.root.path().join(staged);
        assert!(staged.is_file());
        let applied = service
            .apply_review(ReviewApplyParams {
                preview_id: preview.preview_id.clone(),
                expected_document_revision: document.revision,
                selected_row_ids: vec![changed.row_id.clone()],
                actor: "reviewer".to_string(),
                reason: "offline review".to_string(),
            })
            .expect("apply review preview");
        assert_eq!(applied.status, InteropPreviewStatus::Applied);
        assert_eq!(applied.review_ids.len(), 1);
        assert_eq!(applied.comment_ids.len(), 1);
        assert!(!staged.exists());

        drop(service);
        let mut service = EngineService::open(context.root.path()).expect("restart engine");
        let repeated = service
            .apply_review(ReviewApplyParams {
                preview_id: preview.preview_id,
                expected_document_revision: document.revision,
                selected_row_ids: vec![changed.row_id.clone()],
                actor: "reviewer".to_string(),
                reason: "retry".to_string(),
            })
            .expect("terminal review apply replay");
        assert_eq!(repeated.operation_id, applied.operation_id);
        assert_eq!(repeated.review_ids, applied.review_ids);
        assert_eq!(repeated.comment_ids, applied.comment_ids);
        assert_eq!(
            service
                .store
                .list_review_revisions(&document.id, false)
                .expect("durable review revisions")
                .len(),
            1
        );
    }

    #[test]
    fn interop_review_classifies_missing_and_added_rows() {
        let context = TestContext::new();
        let mut service = EngineService::open(context.root.path()).expect("open engine");
        let project = TestContext::project(&mut service);
        let source = context.root.path().join("classification-source.txt");
        fs::write(&source, "First source\n\nSecond source").expect("write review source");
        let document = service
            .import_document(ImportDocumentParams {
                project_id: project.id.clone(),
                source_path: source.to_string_lossy().into_owned(),
                relative_path: None,
                filter_id: Some("builtin.txt".to_string()),
                options: BTreeMap::new(),
            })
            .expect("import review source")
            .document;
        let original = context.root.path().join("classification-review.docx");
        service
            .export_review(ReviewExportParams {
                project_id: project.id.clone(),
                document_id: document.id.clone(),
                expected_document_revision: document.revision,
                output_path: original.to_string_lossy().into_owned(),
            })
            .expect("export review DOCX");
        let parsed = parse_review_docx(&original).expect("parse original review");
        assert_eq!(parsed.manifest.rows.len(), 2);
        let retained = parsed.manifest.rows[1].clone();
        let current_rows = service
            .load_all_editor_rows(&document.id)
            .expect("load current editor rows");
        let current = current_rows
            .iter()
            .find(|row| row.segment.id == retained.segment_id)
            .expect("retained segment");
        let (altered, _) = translunar_filter_interop::build_review_docx(&ReviewExportInput {
            project_id: project.id.clone(),
            document_id: document.id.clone(),
            base_document_revision: document.revision,
            rows: vec![
                ReviewExportRow {
                    row_id: retained.row_id,
                    segment_id: retained.segment_id,
                    segment_revision: retained.segment_revision,
                    ordinal: retained.ordinal,
                    source_text: current.segment.source_text.clone(),
                    target_text: current.segment.target_text.clone(),
                    status: workflow_state_text(current.workflow_state).to_string(),
                    comments: interop_comment_context(&current.comments),
                },
                ReviewExportRow {
                    row_id: "added-review-row".to_string(),
                    segment_id: "unbound-added-segment".to_string(),
                    segment_revision: 0,
                    ordinal: 99,
                    source_text: "Reviewer-added source".to_string(),
                    target_text: "Reviewer-added target".to_string(),
                    status: "translation".to_string(),
                    comments: String::new(),
                },
            ],
        })
        .expect("build altered review");
        let original_manifest = serde_json::to_vec(&parsed.manifest).expect("serialize manifest");
        let altered = replace_review_part(
            &altered,
            translunar_filter_interop::REVIEW_MANIFEST_PART,
            &original_manifest,
        );
        let returned = context.root.path().join("classification-returned.docx");
        fs::write(&returned, altered).expect("write returned review");

        let preview = service
            .preview_review(ReviewPreviewParams {
                project_id: project.id,
                document_id: document.id.clone(),
                input_path: Some(returned.to_string_lossy().into_owned()),
                preview_id: None,
                expected_document_revision: document.revision,
                offset: 0,
                limit: 100,
            })
            .expect("preview missing and added rows");
        assert_eq!(preview.total, 3);
        assert_eq!(
            preview
                .rows
                .iter()
                .filter(|row| row.disposition == ReviewInteropDisposition::Missing)
                .count(),
            1
        );
        assert_eq!(
            preview
                .rows
                .iter()
                .filter(|row| row.disposition == ReviewInteropDisposition::Added)
                .count(),
            1
        );
        assert_eq!(
            preview
                .rows
                .iter()
                .filter(|row| row.disposition == ReviewInteropDisposition::Unchanged)
                .count(),
            1
        );
        let added = preview
            .rows
            .iter()
            .find(|row| row.disposition == ReviewInteropDisposition::Added)
            .expect("added row");
        let error = service
            .apply_review(ReviewApplyParams {
                preview_id: preview.preview_id,
                expected_document_revision: document.revision,
                selected_row_ids: vec![added.row_id.clone()],
                actor: "reviewer".to_string(),
                reason: "reject unbound row".to_string(),
            })
            .expect_err("added row must not apply");
        assert!(matches!(
            error,
            EngineError::Storage(StorageError::InvalidState(_))
        ));
        assert!(
            service
                .store
                .list_review_revisions(&document.id, true)
                .expect("no added-row review proposals")
                .is_empty()
        );
    }

    #[test]
    fn interop_review_rejects_stale_revisions_and_classifies_source_tamper() {
        let context = TestContext::new();
        let mut service = EngineService::open(context.root.path()).expect("open engine");
        let project = TestContext::project(&mut service);
        let document = service
            .import_docx(ImportDocxParams {
                project_id: project.id.clone(),
                source_path: context.source.to_string_lossy().into_owned(),
            })
            .expect("import DOCX");
        let first_review = context.root.path().join("stale-review.docx");
        service
            .export_review(ReviewExportParams {
                project_id: project.id.clone(),
                document_id: document.id.clone(),
                expected_document_revision: document.revision,
                output_path: first_review.to_string_lossy().into_owned(),
            })
            .expect("export stale review base");
        let first_segment = service
            .list_segments(SegmentListParams {
                document_id: document.id.clone(),
                offset: 0,
                limit: 1,
            })
            .expect("list first segment")
            .items
            .remove(0);
        service
            .update_target(UpdateTargetParams {
                segment_id: first_segment.id.clone(),
                target_text: "newer live target".to_string(),
                expected_revision: first_segment.revision,
            })
            .expect("advance segment revision");
        let stale = service
            .preview_review(ReviewPreviewParams {
                project_id: project.id.clone(),
                document_id: document.id.clone(),
                input_path: Some(first_review.to_string_lossy().into_owned()),
                preview_id: None,
                expected_document_revision: document.revision,
                offset: 0,
                limit: 100,
            })
            .expect_err("stale segment binding must fail");
        assert!(matches!(
            stale,
            EngineError::Storage(StorageError::Conflict { .. })
        ));
        assert_eq!(
            service
                .store
                .list_interop_previews(&project.id, Some(InteropPreviewKind::Review), 0, 20)
                .expect("list review previews after stale input")
                .1,
            0
        );

        let fresh_review = context.root.path().join("fresh-review.docx");
        service
            .export_review(ReviewExportParams {
                project_id: project.id.clone(),
                document_id: document.id.clone(),
                expected_document_revision: document.revision,
                output_path: fresh_review.to_string_lossy().into_owned(),
            })
            .expect("export current review");
        let current_first = service
            .store
            .get_segment(&first_segment.id)
            .expect("current first segment");
        let tampered = context.root.path().join("tampered-review.docx");
        rewrite_review_source(
            &fresh_review,
            &tampered,
            &current_first.source_text,
            "Tampered source text",
        );
        let preview = service
            .preview_review(ReviewPreviewParams {
                project_id: project.id,
                document_id: document.id.clone(),
                input_path: Some(tampered.to_string_lossy().into_owned()),
                preview_id: None,
                expected_document_revision: document.revision,
                offset: 0,
                limit: 100,
            })
            .expect("classify tampered review");
        let invalid = preview
            .rows
            .iter()
            .find(|row| row.disposition == ReviewInteropDisposition::Invalid)
            .cloned()
            .expect("invalid tampered row");
        assert!(
            invalid
                .diagnostics
                .iter()
                .any(|diagnostic| diagnostic.contains("source"))
        );
        let apply_error = service
            .apply_review(ReviewApplyParams {
                preview_id: preview.preview_id,
                expected_document_revision: document.revision,
                selected_row_ids: vec![invalid.row_id.clone()],
                actor: "reviewer".to_string(),
                reason: "tampered row".to_string(),
            })
            .expect_err("invalid row must not apply");
        assert!(matches!(
            apply_error,
            EngineError::Storage(StorageError::InvalidState(_))
        ));
        assert!(
            service
                .store
                .list_review_revisions(&document.id, true)
                .expect("no tampered review proposals")
                .is_empty()
        );
    }

    #[test]
    fn interop_table_preview_applies_metadata_and_detects_duplicates() {
        let context = TestContext::new();
        let source = context.root.path().join("bilingual.xlsx");
        xlsx_fixture::write_bilingual_fixture(&source).expect("write bilingual XLSX");
        let mut service = EngineService::open(context.root.path()).expect("open engine");
        let project = TestContext::project(&mut service);
        let library = service
            .store
            .list_tm_libraries(Some(&project.id), 0, 20)
            .expect("list TM libraries")
            .0
            .into_iter()
            .find(|library| library.writable)
            .expect("writable library");
        let preview = service
            .preview_table(TablePreviewParams {
                project_id: project.id.clone(),
                library_id: library.id.clone(),
                input_path: Some(source.to_string_lossy().into_owned()),
                preview_id: None,
                format: Some(BilingualTableFormat::Xlsx),
                source_locale: library.source_locale.clone(),
                target_locale: library.target_locale.clone(),
                expected_library_revision: library.revision,
                offset: 0,
                limit: 100,
            })
            .expect("preview bilingual XLSX");
        assert_eq!(preview.total, 2);
        assert!(preview.rows.iter().all(|row| {
            row.disposition == TableInteropDisposition::Valid
                && row.structural_path.starts_with("bilingual-xlsx:")
                && row.source_path_hash.len() == 64
        }));
        assert_eq!(
            preview.rows[0].metadata.get("Context").map(String::as_str),
            Some("Legal")
        );
        assert!(
            !preview.rows[0]
                .metadata
                .contains_key(INTEROP_STRUCTURAL_PATH_METADATA)
        );
        let reopened = service
            .preview_table(TablePreviewParams {
                project_id: project.id.clone(),
                library_id: library.id.clone(),
                input_path: None,
                preview_id: Some(preview.preview_id.clone()),
                format: Some(BilingualTableFormat::Xlsx),
                source_locale: library.source_locale.clone(),
                target_locale: library.target_locale.clone(),
                expected_library_revision: library.revision,
                offset: 0,
                limit: 100,
            })
            .expect("reopen table preview");
        assert_eq!(reopened.rows[0].row_id, preview.rows[0].row_id);
        let selected_row_id = preview.rows[0].row_id.clone();
        let applied = service
            .apply_table(TableApplyParams {
                preview_id: preview.preview_id,
                expected_library_revision: library.revision,
                selected_row_ids: vec![selected_row_id],
                actor: "importer".to_string(),
                reason: "bilingual table import".to_string(),
            })
            .expect("apply table row");
        assert_eq!(applied.tm_unit_ids.len(), 1);
        let imported = service
            .store
            .export_tm_units(&library.id)
            .expect("list imported TM units")
            .into_iter()
            .find(|unit| unit.id == applied.tm_unit_ids[0])
            .expect("imported table unit");
        assert_eq!(
            imported.metadata.get("Context").map(String::as_str),
            Some("Legal")
        );
        assert!(
            !imported
                .metadata
                .contains_key(INTEROP_STRUCTURAL_PATH_METADATA)
        );

        let current_library = service
            .store
            .get_tm_library(&library.id)
            .expect("current library");
        let duplicate_preview = service
            .preview_table(TablePreviewParams {
                project_id: project.id,
                library_id: library.id,
                input_path: Some(source.to_string_lossy().into_owned()),
                preview_id: None,
                format: Some(BilingualTableFormat::Xlsx),
                source_locale: current_library.source_locale.clone(),
                target_locale: current_library.target_locale.clone(),
                expected_library_revision: current_library.revision,
                offset: 0,
                limit: 100,
            })
            .expect("preview duplicate table");
        assert_eq!(
            duplicate_preview.rows[0].disposition,
            TableInteropDisposition::Duplicate
        );
        assert_eq!(
            duplicate_preview.rows[1].disposition,
            TableInteropDisposition::Valid
        );
    }

    #[test]
    fn interop_table_preview_requires_writable_locale_matching_library() {
        let context = TestContext::new();
        let source = context.root.path().join("bilingual.xlsx");
        xlsx_fixture::write_bilingual_fixture(&source).expect("write bilingual XLSX");
        let mut service = EngineService::open(context.root.path()).expect("open engine");
        let project = TestContext::project(&mut service);
        let library = service
            .store
            .list_tm_libraries(Some(&project.id), 0, 20)
            .expect("list TM libraries")
            .0
            .into_iter()
            .find(|library| library.writable)
            .expect("writable library");
        let before = fs::read_dir(&service.store.paths().temporary)
            .expect("list staging before")
            .count();
        let locale_error = service
            .preview_table(TablePreviewParams {
                project_id: project.id.clone(),
                library_id: library.id.clone(),
                input_path: Some(source.to_string_lossy().into_owned()),
                preview_id: None,
                format: Some(BilingualTableFormat::Xlsx),
                source_locale: "fr-FR".to_string(),
                target_locale: library.target_locale.clone(),
                expected_library_revision: library.revision,
                offset: 0,
                limit: 100,
            })
            .expect_err("locale mismatch must fail before staging");
        assert!(matches!(locale_error, EngineError::InvalidState(_)));

        let read_only = service
            .store
            .create_tm_library(NewTmLibrary {
                name: "Read-only interop library".to_string(),
                source_locale: library.source_locale.clone(),
                target_locale: library.target_locale.clone(),
                domain: None,
                writable: false,
                owner_project_id: Some(project.id.clone()),
            })
            .expect("create read-only library");
        let read_only_error = service
            .preview_table(TablePreviewParams {
                project_id: project.id.clone(),
                library_id: read_only.id,
                input_path: Some(source.to_string_lossy().into_owned()),
                preview_id: None,
                format: Some(BilingualTableFormat::Xlsx),
                source_locale: read_only.source_locale,
                target_locale: read_only.target_locale,
                expected_library_revision: read_only.revision,
                offset: 0,
                limit: 100,
            })
            .expect_err("read-only library must fail before staging");
        assert!(matches!(read_only_error, EngineError::InvalidState(_)));
        assert_eq!(
            fs::read_dir(&service.store.paths().temporary)
                .expect("list staging after")
                .count(),
            before
        );
        assert_eq!(
            service
                .store
                .list_interop_previews(&project.id, Some(InteropPreviewKind::Table), 0, 20)
                .expect("list table previews")
                .1,
            0
        );
    }

    #[test]
    fn malformed_table_preview_cleans_staging_without_persistence() {
        let context = TestContext::new();
        let source = context.root.path().join("formula.xlsx");
        xlsx_fixture::write_bilingual_invalid_formula_fixture(&source)
            .expect("write formula fixture");
        let mut service = EngineService::open(context.root.path()).expect("open engine");
        let project = TestContext::project(&mut service);
        let library = service
            .store
            .list_tm_libraries(Some(&project.id), 0, 20)
            .expect("list TM libraries")
            .0
            .into_iter()
            .find(|library| library.writable)
            .expect("writable library");
        let before = fs::read_dir(&service.store.paths().temporary)
            .expect("list staging before")
            .count();
        let error = service
            .preview_table(TablePreviewParams {
                project_id: project.id.clone(),
                library_id: library.id,
                input_path: Some(source.to_string_lossy().into_owned()),
                preview_id: None,
                format: Some(BilingualTableFormat::Xlsx),
                source_locale: library.source_locale,
                target_locale: library.target_locale,
                expected_library_revision: library.revision,
                offset: 0,
                limit: 100,
            })
            .expect_err("formula input must fail");
        assert!(matches!(error, EngineError::Import(_)));
        assert_eq!(
            fs::read_dir(&service.store.paths().temporary)
                .expect("list staging after")
                .count(),
            before
        );
        assert_eq!(
            service
                .store
                .list_interop_previews(&project.id, Some(InteropPreviewKind::Table), 0, 20)
                .expect("list table previews")
                .1,
            0
        );
    }
}

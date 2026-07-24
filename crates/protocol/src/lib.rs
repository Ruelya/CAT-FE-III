use std::collections::BTreeMap;

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use translunar_asset_core::{
    AssetMountMode, ConcordanceHit, ConcordanceSide, TermEntry, TermMatch, TermStatus, Termbase,
    TermbaseMount, TmLibrary, TmLibraryMount, TmMatch,
};
use translunar_domain::{
    BackupManifest, ChineseConversionProfile, DataHealthReport, DegradationFinding, Document,
    EditorComment, EditorPreferences, EditorTagIssue, EditorWorkflowState, InlineTag, Operation,
    Project, ProjectConfiguration, ProjectLifecycle, QaIssue, ReviewRevision, Segment,
    SegmentCounts, SegmentEditorRow, SegmentState, SpellFinding, TmEntry,
};
use translunar_filter_core::FilterDescriptor;
use translunar_pipeline::{
    PipelineDefinition, PipelineRun, PipelineRunStatus, PipelineStepDefinition, PipelineStepRun,
    StepDescriptor,
};

mod ai;
pub use ai::*;
mod alignment;
pub use alignment::*;
mod qa;
pub use qa::*;
mod lifecycle;
pub use lifecycle::*;
mod task_package;
pub use task_package::*;
mod discussion;
pub use discussion::*;
mod curation;
pub use curation::*;
mod plugin;
pub use plugin::*;

pub const PROTOCOL_VERSION: u32 = 1;

pub mod methods {
    pub const INITIALIZE: &str = "engine.initialize";
    pub const PROJECT_CREATE: &str = "project.create";
    pub const PROJECT_GET: &str = "project.get";
    pub const PROJECT_LIST: &str = "project.list";
    pub const PROJECT_UPDATE: &str = "project.update";
    pub const PROJECT_SET_LIFECYCLE: &str = "project.setLifecycle";
    pub const PROJECT_TEMPLATE_LIST: &str = "project.template.list";
    pub const PROJECT_TEMPLATE_GET: &str = "project.template.get";
    pub const PROJECT_TEMPLATE_CREATE: &str = "project.template.create";
    pub const PROJECT_TEMPLATE_UPDATE: &str = "project.template.update";
    pub const PROJECT_TEMPLATE_DELETE: &str = "project.template.delete";
    pub const PROJECT_CREATE_FROM_TEMPLATE: &str = "project.createFromTemplate";
    pub const PROJECT_BATCH_IMPORT: &str = "project.batchImport";
    pub const PROJECT_ARCHIVE_EXPORT: &str = "project.archive.export";
    pub const PROJECT_ARCHIVE_RESTORE: &str = "project.archive.restore";
    pub const DISCUSSION_THREAD_LIST: &str = "discussion.thread.list";
    pub const DISCUSSION_THREAD_CREATE: &str = "discussion.thread.create";
    pub const DISCUSSION_THREAD_RESOLVE: &str = "discussion.thread.resolve";
    pub const DISCUSSION_MESSAGE_LIST: &str = "discussion.message.list";
    pub const DISCUSSION_MESSAGE_CREATE: &str = "discussion.message.create";
    pub const DISCUSSION_MESSAGE_UPDATE: &str = "discussion.message.update";
    pub const DISCUSSION_MESSAGE_DELETE: &str = "discussion.message.delete";
    pub const PROJECT_SNAPSHOT_LIST: &str = "project.snapshot.list";
    pub const PROJECT_SNAPSHOT_CREATE: &str = "project.snapshot.create";
    pub const PROJECT_SNAPSHOT_GET: &str = "project.snapshot.get";
    pub const PROJECT_SNAPSHOT_PREVIEW_RESTORE: &str = "project.snapshot.previewRestore";
    pub const PROJECT_SNAPSHOT_RESTORE: &str = "project.snapshot.restore";
    pub const TASK_PACKAGE_EXPORT: &str = "taskPackage.export";
    pub const TASK_PACKAGE_PREVIEW: &str = "taskPackage.preview";
    pub const TASK_PACKAGE_APPLY: &str = "taskPackage.apply";
    pub const TASK_PACKAGE_IMPORT: &str = "taskPackage.import";
    pub const TASK_PACKAGE_DISCARD: &str = "taskPackage.discard";
    pub const DOCUMENT_LIST: &str = "document.list";
    pub const DOCUMENT_GET: &str = "document.get";
    pub const DOCUMENT_IMPORT: &str = "document.import";
    pub const DOCUMENT_IMPORT_DOCX: &str = "document.importDocx";
    pub const DOCUMENT_REIMPORT_PREVIEW: &str = "document.reimport.preview";
    pub const DOCUMENT_REIMPORT_APPLY: &str = "document.reimport.apply";
    pub const RECYCLE_LIST: &str = "recycle.list";
    pub const RECYCLE_DELETE: &str = "recycle.delete";
    pub const RECYCLE_RESTORE: &str = "recycle.restore";
    pub const RECYCLE_PURGE: &str = "recycle.purge";
    pub const SEARCH_GLOBAL: &str = "search.global";
    pub const ANALYSIS_PROFILE_LIST: &str = "analysis.profile.list";
    pub const ANALYSIS_RUN: &str = "analysis.run";
    pub const ANALYSIS_RUN_GET: &str = "analysis.run.get";
    pub const PROJECT_ANALYTICS_GET: &str = "project.analytics.get";
    pub const SEGMENT_LIST: &str = "segment.list";
    pub const SEGMENT_UPDATE_TARGET: &str = "segment.updateTarget";
    pub const SEGMENT_CONFIRM: &str = "segment.confirm";
    pub const SEGMENT_EDITOR_LIST: &str = "segment.editor.list";
    pub const SEGMENT_TAG_SET: &str = "segment.tag.set";
    pub const SEGMENT_CHINESE_CONVERT: &str = "segment.chinese.convert";
    pub const SEGMENT_PROPAGATE: &str = "segment.propagate";
    pub const SEGMENT_FIND: &str = "segment.find";
    pub const SEGMENT_REPLACE_PREVIEW: &str = "segment.replace.preview";
    pub const SEGMENT_REPLACE_APPLY: &str = "segment.replace.apply";
    pub const SEGMENT_SPLIT: &str = "segment.split";
    pub const SEGMENT_MERGE: &str = "segment.merge";
    pub const SEGMENT_CORRECT_SOURCE: &str = "segment.correctSource";
    pub const SEGMENT_WORKFLOW_SET: &str = "segment.workflow.set";
    pub const SEGMENT_COMMENT_LIST: &str = "segment.comment.list";
    pub const SEGMENT_COMMENT_CREATE: &str = "segment.comment.create";
    pub const SEGMENT_COMMENT_UPDATE: &str = "segment.comment.update";
    pub const SEGMENT_COMMENT_RESOLVE: &str = "segment.comment.resolve";
    pub const SEGMENT_COMMENT_DELETE: &str = "segment.comment.delete";
    pub const SEGMENT_SPELL_CHECK: &str = "segment.spell.check";
    pub const DICTIONARY_LIST: &str = "dictionary.list";
    pub const DICTIONARY_ADD: &str = "dictionary.add";
    pub const DICTIONARY_REMOVE: &str = "dictionary.remove";
    pub const EDITOR_UNDO: &str = "editor.undo";
    pub const EDITOR_REDO: &str = "editor.redo";
    pub const EDITOR_HISTORY: &str = "editor.history";
    pub const REVIEW_CREATE: &str = "review.create";
    pub const REVIEW_LIST: &str = "review.list";
    pub const REVIEW_ACCEPT: &str = "review.accept";
    pub const REVIEW_REJECT: &str = "review.reject";
    pub const REVIEW_QUEUE: &str = "review.queue";
    pub const REVIEW_STATS: &str = "review.stats";
    pub const INTEROP_REVIEW_EXPORT: &str = "interop.review.export";
    pub const INTEROP_REVIEW_PREVIEW: &str = "interop.review.preview";
    pub const INTEROP_REVIEW_APPLY: &str = "interop.review.apply";
    pub const INTEROP_TABLE_PREVIEW: &str = "interop.table.preview";
    pub const INTEROP_TABLE_APPLY: &str = "interop.table.apply";
    pub const EDITOR_PREFERENCES_GET: &str = "editor.preferences.get";
    pub const EDITOR_PREFERENCES_UPDATE: &str = "editor.preferences.update";
    pub const PDF_PAGE_LIST: &str = "pdf.page.list";
    pub const PDF_PAGE_GET: &str = "pdf.page.get";
    pub const PDF_CORRECT_OCR: &str = "pdf.correctOcr";
    pub const ALIGNMENT_SESSION_CREATE: &str = "alignment.session.create";
    pub const ALIGNMENT_SESSION_GET: &str = "alignment.session.get";
    pub const ALIGNMENT_SESSION_LIST: &str = "alignment.session.list";
    pub const ALIGNMENT_SESSION_UPDATE: &str = "alignment.session.update";
    pub const ALIGNMENT_SESSION_REFINE: &str = "alignment.session.refine";
    pub const ALIGNMENT_SESSION_APPLY: &str = "alignment.session.apply";
    pub const CORPUS_LIST: &str = "corpus.list";
    pub const CORPUS_IMPORT: &str = "corpus.import";
    pub const CORPUS_FROM_ALIGNMENT: &str = "corpus.fromAlignment";
    pub const CORPUS_SEARCH: &str = "corpus.search";
    pub const CORPUS_REINDEX: &str = "corpus.reindex";
    pub const CORPUS_REMOVE: &str = "corpus.remove";
    pub const ASSET_CATALOG_LIST: &str = "asset.catalog.list";
    pub const CURATION_RUN: &str = "curation.run";
    pub const CURATION_RUN_GET: &str = "curation.run.get";
    pub const CURATION_FINDING_LIST: &str = "curation.finding.list";
    pub const CURATION_APPLY: &str = "curation.apply";
    pub const CURATION_ROLLBACK: &str = "curation.rollback";
    pub const CURATION_EXPORT: &str = "curation.export";
    pub const TM_LOOKUP_EXACT: &str = "tm.lookupExact";
    pub const TM_LIBRARY_LIST: &str = "tm.library.list";
    pub const TM_LIBRARY_CREATE: &str = "tm.library.create";
    pub const TM_LIBRARY_MOUNT: &str = "tm.library.mount";
    pub const TM_LIBRARY_UNMOUNT: &str = "tm.library.unmount";
    pub const TM_SEARCH: &str = "tm.search";
    pub const TM_CONCORDANCE: &str = "tm.concordance";
    pub const TM_IMPORT: &str = "tm.import";
    pub const TM_EXPORT: &str = "tm.export";
    pub const TERMBASE_LIST: &str = "termbase.list";
    pub const TERMBASE_CREATE: &str = "termbase.create";
    pub const TERMBASE_MOUNT: &str = "termbase.mount";
    pub const TERMBASE_UNMOUNT: &str = "termbase.unmount";
    pub const TERM_SEARCH: &str = "term.search";
    pub const TERM_UPSERT: &str = "term.upsert";
    pub const TERMBASE_IMPORT: &str = "termbase.import";
    pub const TERMBASE_EXPORT: &str = "termbase.export";
    pub const QA_RUN_DOCUMENT: &str = "qa.runDocument";
    pub const QA_LIST: &str = "qa.list";
    pub const QA_PROFILE_LIST: &str = "qa.profile.list";
    pub const QA_PROFILE_CREATE: &str = "qa.profile.create";
    pub const QA_PROFILE_CLONE: &str = "qa.profile.clone";
    pub const QA_PROFILE_UPDATE: &str = "qa.profile.update";
    pub const QA_PROFILE_DELETE: &str = "qa.profile.delete";
    pub const QA_RUN: &str = "qa.run";
    pub const QA_RUN_LIST: &str = "qa.run.list";
    pub const QA_RUN_GET: &str = "qa.run.get";
    pub const QA_ISSUE_LIST: &str = "qa.issue.list";
    pub const QA_ISSUE_WAIVE: &str = "qa.issue.waive";
    pub const QA_ISSUE_REVOKE: &str = "qa.issue.revoke";
    pub const QA_REPORT_EXPORT: &str = "qa.report.export";
    pub const QA_GATE_CHECK: &str = "qa.gate.check";
    pub const QA_OVERRIDE_LIST: &str = "qa.override.list";
    pub const DOCUMENT_EXPORT_DOCX: &str = "document.exportDocx";
    pub const DOCUMENT_EXPORT: &str = "document.export";
    pub const FILTER_LIST: &str = "filter.list";
    pub const PLUGIN_LIST: &str = "plugin.list";
    pub const PLUGIN_GET: &str = "plugin.get";
    pub const PLUGIN_INSTALL: &str = "plugin.install";
    pub const PLUGIN_ENABLE: &str = "plugin.enable";
    pub const PLUGIN_DISABLE: &str = "plugin.disable";
    pub const PLUGIN_UNINSTALL: &str = "plugin.uninstall";
    pub const HISTORY_LIST: &str = "history.list";
    pub const DATA_CHECK_HEALTH: &str = "data.checkHealth";
    pub const DATA_CREATE_BACKUP: &str = "data.createBackup";
    pub const PIPELINE_STEP_LIST: &str = "pipeline.step.list";
    pub const PIPELINE_CREATE: &str = "pipeline.create";
    pub const PIPELINE_LIST: &str = "pipeline.list";
    pub const PIPELINE_GET: &str = "pipeline.get";
    pub const PIPELINE_VALIDATE: &str = "pipeline.validate";
    pub const PIPELINE_RUN: &str = "pipeline.run";
    pub const PIPELINE_RUN_LIST: &str = "pipeline.run.list";
    pub const PIPELINE_RUN_GET: &str = "pipeline.run.get";
    pub const PIPELINE_RUN_CANCEL: &str = "pipeline.run.cancel";
    pub const PIPELINE_RUN_RESUME: &str = "pipeline.run.resume";
    pub const AI_PROVIDER_CATALOG: &str = "ai.provider.catalog";
    pub const AI_PROVIDER_LIST: &str = "ai.provider.list";
    pub const AI_PROVIDER_CREATE: &str = "ai.provider.create";
    pub const AI_PROVIDER_UPDATE: &str = "ai.provider.update";
    pub const AI_PROVIDER_DELETE: &str = "ai.provider.delete";
    pub const AI_PROVIDER_TEST: &str = "ai.provider.test";
    pub const AI_CREDENTIAL_SET: &str = "ai.credential.set";
    pub const AI_CREDENTIAL_DELETE: &str = "ai.credential.delete";
    pub const AI_CREDENTIAL_STATUS: &str = "ai.credential.status";
    pub const AI_SETTINGS_GET: &str = "ai.settings.get";
    pub const AI_SETTINGS_UPDATE: &str = "ai.settings.update";
    pub const AI_GROUNDING_PREVIEW: &str = "ai.grounding.preview";
    pub const AI_RUN_START: &str = "ai.run.start";
    pub const AI_RUN_GET: &str = "ai.run.get";
    pub const AI_RUN_LIST: &str = "ai.run.list";
    pub const AI_RUN_EVENTS: &str = "ai.run.events";
    pub const AI_RUN_CANCEL: &str = "ai.run.cancel";
    pub const AI_RUN_RESUME: &str = "ai.run.resume";
    pub const AI_RESULT_APPLY: &str = "ai.result.apply";
    pub const AI_BATCH_START: &str = "ai.batch.start";
    pub const AI_BATCH_GET: &str = "ai.batch.get";
    pub const AI_BATCH_LIST: &str = "ai.batch.list";
    pub const AI_BATCH_ITEMS: &str = "ai.batch.items";
    pub const AI_BATCH_CANCEL: &str = "ai.batch.cancel";
    pub const AI_BATCH_RESUME: &str = "ai.batch.resume";
    pub const AI_USAGE_QUERY: &str = "ai.usage.query";
    pub const AI_CONVERSATION_LIST: &str = "ai.conversation.list";
    pub const AI_CONVERSATION_CREATE: &str = "ai.conversation.create";
    pub const AI_CONVERSATION_UPDATE: &str = "ai.conversation.update";
    pub const AI_CONVERSATION_MESSAGES: &str = "ai.conversation.messages";
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RpcRequest {
    pub jsonrpc: String,
    pub id: Value,
    pub method: String,
    #[serde(default)]
    pub params: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RpcResponse {
    pub jsonrpc: String,
    pub id: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<RpcError>,
}

impl RpcResponse {
    pub fn success(id: Value, result: Value) -> Self {
        Self {
            jsonrpc: "2.0".to_string(),
            id,
            result: Some(result),
            error: None,
        }
    }

    pub fn failure(id: Value, error: RpcError) -> Self {
        Self {
            jsonrpc: "2.0".to_string(),
            id,
            result: None,
            error: Some(error),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct RpcError {
    pub code: ErrorCode,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ErrorCode {
    InvalidRequest,
    NotFound,
    Conflict,
    InvalidState,
    UnsupportedDocument,
    StorageError,
    ExportError,
    QaGateBlocked,
    QaProfileInvalid,
    ReportExportError,
    CredentialUnavailable,
    AiDisabled,
    BudgetExceeded,
    ProviderAuthentication,
    ProviderRateLimited,
    ProviderTimeout,
    ProviderProtocol,
    ProviderUnavailable,
    AlignmentInvalidPartition,
    AlignmentResponseInvalid,
    UnsupportedCorpusInput,
    ResourceLimitExceeded,
    ResourceLimit,
    PluginInvalidManifest,
    PluginPermissionDenied,
    PluginProcessFailed,
    InternalError,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ClientInfo {
    pub name: String,
    pub version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct InitializeParams {
    pub protocol_version: u32,
    pub client: ClientInfo,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct InitializeResult {
    pub protocol_version: u32,
    pub engine_version: String,
    pub capabilities: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateProjectParams {
    pub name: String,
    pub source_locale: String,
    pub target_locale: String,
    pub domain: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProjectIdParams {
    pub project_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProjectListParams {
    #[serde(default)]
    pub lifecycle: Option<ProjectLifecycle>,
    #[serde(default)]
    pub offset: u32,
    #[serde(default = "default_page_size")]
    pub limit: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProjectParams {
    pub project_id: String,
    pub name: String,
    pub source_locale: String,
    pub target_locale: String,
    pub domain: String,
    #[serde(default)]
    pub configuration: ProjectConfiguration,
    pub expected_revision: u64,
    #[serde(default = "default_actor")]
    pub actor: String,
    #[serde(default)]
    pub correlation_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SetProjectLifecycleParams {
    pub project_id: String,
    pub lifecycle: ProjectLifecycle,
    pub expected_revision: u64,
    #[serde(default = "default_actor")]
    pub actor: String,
    #[serde(default)]
    pub correlation_id: Option<String>,
}

fn default_actor() -> String {
    "desktop".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ImportDocxParams {
    pub project_id: String,
    pub source_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ImportDocumentParams {
    pub project_id: String,
    pub source_path: String,
    #[serde(default)]
    pub relative_path: Option<String>,
    #[serde(default)]
    pub filter_id: Option<String>,
    #[serde(default)]
    pub options: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DocumentIdParams {
    pub document_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DocumentListParams {
    pub project_id: String,
    #[serde(default)]
    pub offset: u32,
    #[serde(default = "default_page_size")]
    pub limit: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SegmentListParams {
    pub document_id: String,
    #[serde(default)]
    pub offset: u32,
    #[serde(default = "default_page_size")]
    pub limit: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema, Default)]
#[serde(rename_all = "camelCase")]
pub enum EditorSearchField {
    Source,
    Target,
    #[default]
    Both,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema, Default)]
#[serde(rename_all = "camelCase")]
pub enum EditorSegmentFilter {
    #[default]
    All,
    Untranslated,
    Draft,
    Confirmed,
    Issues,
    Tagged,
    Commented,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema, Default)]
#[serde(rename_all = "camelCase")]
pub enum EditorSegmentSort {
    #[default]
    Ordinal,
    UpdatedAt,
    State,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct EditorSegmentListParams {
    pub document_id: String,
    #[serde(default)]
    pub query: String,
    #[serde(default)]
    pub field: EditorSearchField,
    #[serde(default)]
    pub filter: EditorSegmentFilter,
    #[serde(default)]
    pub sort: EditorSegmentSort,
    #[serde(default)]
    pub descending: bool,
    #[serde(default)]
    pub offset: u32,
    #[serde(default = "default_editor_page_size")]
    pub limit: u32,
    #[serde(default)]
    pub include_context: bool,
}

fn default_editor_page_size() -> u32 {
    80
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct EditorSegmentPage {
    pub items: Vec<SegmentEditorRow>,
    pub total: u32,
    pub offset: u32,
    pub limit: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SetSegmentTagsParams {
    pub segment_id: String,
    pub target_tags: Vec<InlineTag>,
    pub expected_revision: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ConvertSegmentChineseParams {
    pub segment_id: String,
    pub profile: ChineseConversionProfile,
    pub expected_revision: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PropagateSegmentParams {
    pub segment_id: String,
    pub expected_revision: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct EditorMutationResult {
    pub rows: Vec<SegmentEditorRow>,
    pub counts: SegmentCounts,
    #[serde(default)]
    pub operation_id: Option<String>,
    #[serde(default)]
    pub focus_segment_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct FindSegmentsParams {
    pub document_id: String,
    pub query: String,
    #[serde(default)]
    pub field: EditorSearchField,
    #[serde(default)]
    pub regex: bool,
    #[serde(default)]
    pub case_sensitive: bool,
    #[serde(default)]
    pub whole_word: bool,
    #[serde(default)]
    pub offset: u32,
    #[serde(default = "default_editor_page_size")]
    pub limit: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SegmentFindMatch {
    pub segment_id: String,
    pub field: EditorSearchField,
    pub start: u32,
    pub end: u32,
    pub matched_text: String,
    pub revision: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SegmentFindResult {
    pub matches: Vec<SegmentFindMatch>,
    pub total: u32,
    pub offset: u32,
    pub limit: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReplacePreviewParams {
    pub document_id: String,
    pub query: String,
    pub replacement: String,
    #[serde(default)]
    pub field: EditorSearchField,
    #[serde(default)]
    pub regex: bool,
    #[serde(default)]
    pub case_sensitive: bool,
    #[serde(default)]
    pub whole_word: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReplacePreviewItem {
    pub segment_id: String,
    pub revision: u64,
    pub field: EditorSearchField,
    pub before: String,
    pub after: String,
    pub replacements: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReplacePreviewResult {
    pub token: String,
    pub document_id: String,
    pub items: Vec<ReplacePreviewItem>,
    pub changed_segments: u32,
    pub replacement_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReplaceApplyParams {
    pub preview: ReplacePreviewResult,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SplitSegmentParams {
    pub segment_id: String,
    pub source_offset: u32,
    #[serde(default)]
    pub target_offset: Option<u32>,
    pub expected_revision: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct MergeSegmentsParams {
    pub first_segment_id: String,
    pub second_segment_id: String,
    pub first_expected_revision: u64,
    pub second_expected_revision: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CorrectSourceParams {
    pub segment_id: String,
    pub source_text: String,
    pub reason: String,
    pub expected_revision: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SegmentCommentListParams {
    pub segment_id: String,
    #[serde(default)]
    pub include_resolved: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SegmentCommentListResult {
    pub comments: Vec<EditorComment>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateSegmentCommentParams {
    pub segment_id: String,
    pub author: String,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSegmentCommentParams {
    pub comment_id: String,
    pub text: String,
    pub expected_revision: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ResolveSegmentCommentParams {
    pub comment_id: String,
    pub resolved: bool,
    pub expected_revision: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DeleteSegmentCommentParams {
    pub comment_id: String,
    pub expected_revision: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SpellCheckParams {
    pub locale: String,
    pub text: String,
    #[serde(default = "default_spell_limit")]
    pub limit: u32,
}

fn default_spell_limit() -> u32 {
    100
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SpellCheckResult {
    pub available: bool,
    pub provider: String,
    pub findings: Vec<SpellFinding>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DictionaryListParams {
    pub locale: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DictionaryWordParams {
    pub locale: String,
    pub word: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DictionaryListResult {
    pub locale: String,
    pub words: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct EditorHistoryParams {
    pub project_id: String,
    #[serde(default)]
    pub offset: u32,
    #[serde(default = "default_editor_page_size")]
    pub limit: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct EditorUndoRedoParams {
    pub project_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct EditorHistoryResult {
    pub operations: Vec<Operation>,
    pub total: u32,
    pub can_undo: bool,
    pub can_redo: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReviewCreateParams {
    pub segment_id: String,
    #[serde(default)]
    pub proposed_target: Option<String>,
    #[serde(default)]
    pub proposed_source: Option<String>,
    #[serde(default)]
    pub proposed_target_tags: Option<Vec<InlineTag>>,
    pub author: String,
    #[serde(default)]
    pub reason: String,
    pub expected_revision: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReviewListParams {
    pub document_id: String,
    #[serde(default)]
    pub include_closed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReviewListResult {
    pub revisions: Vec<ReviewRevision>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReviewDecisionParams {
    pub review_id: String,
    pub expected_segment_revision: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum InteropPreviewStatus {
    Open,
    Applied,
    Discarded,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum ReviewInteropDisposition {
    Changed,
    Unchanged,
    Missing,
    Added,
    Invalid,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum TableInteropDisposition {
    Valid,
    Duplicate,
    Invalid,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum BilingualTableFormat {
    Docx,
    Xlsx,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReviewExportParams {
    pub project_id: String,
    pub document_id: String,
    pub expected_document_revision: u64,
    pub output_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReviewExportResult {
    pub output_path: String,
    pub row_count: u32,
    pub manifest_hash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReviewPreviewParams {
    pub project_id: String,
    pub document_id: String,
    #[serde(default)]
    pub input_path: Option<String>,
    #[serde(default)]
    pub preview_id: Option<String>,
    pub expected_document_revision: u64,
    #[serde(default)]
    pub offset: u32,
    #[serde(default = "default_page_size")]
    pub limit: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReviewPreviewRow {
    pub row_id: String,
    pub ordinal: u32,
    pub source_row: u32,
    #[serde(default)]
    pub segment_id: Option<String>,
    #[serde(default)]
    pub expected_segment_revision: Option<u64>,
    pub source_hash: String,
    pub source_text: String,
    pub target_text: String,
    pub current_target: String,
    pub comments: String,
    pub current_comments: String,
    pub status_context: String,
    pub current_status: String,
    pub disposition: ReviewInteropDisposition,
    pub diagnostics: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReviewPreviewResult {
    pub preview_id: String,
    pub project_id: String,
    pub document_id: String,
    pub expected_document_revision: u64,
    pub input_sha256: String,
    pub input_format: String,
    #[serde(default)]
    pub manifest_hash: Option<String>,
    pub status: InteropPreviewStatus,
    pub rows: Vec<ReviewPreviewRow>,
    pub total: u32,
    pub offset: u32,
    pub limit: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReviewApplyParams {
    pub preview_id: String,
    pub expected_document_revision: u64,
    pub selected_row_ids: Vec<String>,
    pub actor: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TablePreviewParams {
    pub project_id: String,
    pub library_id: String,
    #[serde(default)]
    pub input_path: Option<String>,
    #[serde(default)]
    pub preview_id: Option<String>,
    #[serde(default)]
    pub format: Option<BilingualTableFormat>,
    pub source_locale: String,
    pub target_locale: String,
    pub expected_library_revision: u64,
    #[serde(default)]
    pub offset: u32,
    #[serde(default = "default_page_size")]
    pub limit: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TablePreviewRow {
    pub row_id: String,
    pub ordinal: u32,
    pub source_row: u32,
    pub structural_path: String,
    pub source_hash: String,
    pub source_path_hash: String,
    pub source_text: String,
    pub target_text: String,
    pub metadata: BTreeMap<String, String>,
    pub disposition: TableInteropDisposition,
    pub diagnostics: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TablePreviewResult {
    pub preview_id: String,
    pub project_id: String,
    pub library_id: String,
    pub expected_library_revision: u64,
    pub input_sha256: String,
    pub input_format: String,
    pub source_locale: String,
    pub target_locale: String,
    pub status: InteropPreviewStatus,
    pub rows: Vec<TablePreviewRow>,
    pub total: u32,
    pub offset: u32,
    pub limit: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TableApplyParams {
    pub preview_id: String,
    pub expected_library_revision: u64,
    pub selected_row_ids: Vec<String>,
    pub actor: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct InteropApplyResult {
    pub preview_id: String,
    pub status: InteropPreviewStatus,
    pub applied_count: u32,
    pub skipped_count: u32,
    pub current_revision: u64,
    #[serde(default)]
    pub operation_id: Option<String>,
    pub review_ids: Vec<String>,
    pub comment_ids: Vec<String>,
    pub tm_unit_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SetEditorWorkflowParams {
    pub segment_id: String,
    pub state: EditorWorkflowState,
    pub expected_revision: u64,
    #[serde(default)]
    pub actor: Option<String>,
    #[serde(default)]
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpdateEditorPreferencesParams {
    pub preferences: EditorPreferences,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct EditorDiagnosticsResult {
    pub tag_issues: Vec<EditorTagIssue>,
    pub workflow_state: EditorWorkflowState,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PdfPageListParams {
    pub document_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PdfPageGetParams {
    pub document_id: String,
    pub page: u32,
    #[serde(default = "default_pdf_dpi")]
    pub dpi: u32,
}

fn default_pdf_dpi() -> u32 {
    144
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CorrectOcrParams {
    pub segment_id: String,
    pub source_text: String,
    pub reason: String,
    pub expected_revision: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PdfPageSummary {
    pub page: u32,
    pub width: f64,
    pub height: f64,
    pub block_count: u32,
    pub ocr_block_count: u32,
    pub segment_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PdfPageListResult {
    pub pages: Vec<PdfPageSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PdfBoundingBox {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PdfPageBlock {
    pub segment_id: String,
    pub revision: u64,
    pub source_text: String,
    pub target_text: String,
    pub state: SegmentState,
    pub bbox: PdfBoundingBox,
    pub kind: String,
    pub source_kind: String,
    pub confidence: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PdfPageDetail {
    pub page: u32,
    pub width: f64,
    pub height: f64,
    pub dpi: u32,
    pub image_png_base64: String,
    pub blocks: Vec<PdfPageBlock>,
}

fn default_page_size() -> u32 {
    200
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpdateTargetParams {
    pub segment_id: String,
    pub target_text: String,
    pub expected_revision: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ConfirmSegmentParams {
    pub segment_id: String,
    pub expected_revision: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ExactLookupParams {
    pub project_id: String,
    pub source_text: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum AssetExchangeFormat {
    Tmx,
    Csv,
    Tsv,
    Tbx,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TmLibraryListParams {
    #[serde(default)]
    pub project_id: Option<String>,
    #[serde(default)]
    pub offset: u32,
    #[serde(default = "default_page_size")]
    pub limit: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TmLibraryCreateParams {
    pub name: String,
    pub source_locale: String,
    pub target_locale: String,
    #[serde(default)]
    pub domain: Option<String>,
    #[serde(default = "default_true")]
    pub writable: bool,
    #[serde(default)]
    pub owner_project_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TmLibraryMountParams {
    pub project_id: String,
    pub library_id: String,
    pub mode: AssetMountMode,
    #[serde(default)]
    pub priority: u32,
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default)]
    pub expected_revision: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TmLibraryUnmountParams {
    pub project_id: String,
    pub library_id: String,
    pub expected_revision: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TmLibraryPage {
    pub items: Vec<TmLibrary>,
    pub mounts: Vec<TmLibraryMount>,
    pub total: u32,
    pub offset: u32,
    pub limit: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TmSearchParams {
    pub project_id: String,
    pub source_locale: String,
    pub target_locale: String,
    pub query: String,
    #[serde(default = "default_tm_threshold")]
    pub threshold: u8,
    #[serde(default)]
    pub offset: u32,
    #[serde(default = "default_page_size")]
    pub limit: u32,
    #[serde(default)]
    pub library_ids: Vec<String>,
    #[serde(default)]
    pub domain: Option<String>,
    #[serde(default)]
    pub since_ms: Option<i64>,
    #[serde(default)]
    pub origin_project_id: Option<String>,
    #[serde(default)]
    pub origin_document_id: Option<String>,
    #[serde(default)]
    pub context_before_hash: Option<String>,
    #[serde(default)]
    pub context_after_hash: Option<String>,
}

fn default_tm_threshold() -> u8 {
    70
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TmSearchResult {
    pub matches: Vec<TmMatch>,
    pub total: u32,
    pub offset: u32,
    pub limit: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ConcordanceParams {
    pub project_id: String,
    pub query: String,
    #[serde(default = "default_concordance_side")]
    pub side: ConcordanceSide,
    #[serde(default)]
    pub offset: u32,
    #[serde(default = "default_page_size")]
    pub limit: u32,
}

fn default_concordance_side() -> ConcordanceSide {
    ConcordanceSide::Both
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ConcordanceResult {
    pub hits: Vec<ConcordanceHit>,
    pub total: u32,
    #[serde(default)]
    pub corpus_hits: Vec<CorpusSearchHit>,
    #[serde(default)]
    pub corpus_total: u32,
    pub offset: u32,
    pub limit: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AssetDiagnostic {
    pub row: u32,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TmImportParams {
    pub library_id: String,
    pub source_path: String,
    pub format: AssetExchangeFormat,
    pub source_locale: String,
    pub target_locale: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TmImportResult {
    pub library_id: String,
    pub inserted: u32,
    pub skipped: u32,
    pub diagnostics: Vec<AssetDiagnostic>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TmExportParams {
    pub library_id: String,
    pub output_path: String,
    pub format: AssetExchangeFormat,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TmExportResult {
    pub library_id: String,
    pub output_path: String,
    pub unit_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TermbaseListParams {
    pub project_id: String,
    #[serde(default)]
    pub offset: u32,
    #[serde(default = "default_page_size")]
    pub limit: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TermbaseCreateParams {
    pub name: String,
    pub source_locale: String,
    #[serde(default)]
    pub domain: Option<String>,
    #[serde(default = "default_true")]
    pub writable: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TermbaseMountParams {
    pub project_id: String,
    pub termbase_id: String,
    #[serde(default)]
    pub priority: u32,
    #[serde(default = "default_true")]
    pub writable: bool,
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default)]
    pub expected_revision: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TermbaseUnmountParams {
    pub project_id: String,
    pub termbase_id: String,
    pub expected_revision: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TermbasePage {
    pub items: Vec<Termbase>,
    pub mounts: Vec<TermbaseMount>,
    pub total: u32,
    pub offset: u32,
    pub limit: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TermSearchParams {
    pub project_id: String,
    pub text: String,
    #[serde(default)]
    pub offset: u32,
    #[serde(default = "default_page_size")]
    pub limit: u32,
    #[serde(default)]
    pub termbase_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TermSearchResult {
    pub matches: Vec<TermMatch>,
    pub total: u32,
    pub offset: u32,
    pub limit: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TermTranslationInput {
    pub locale: String,
    pub term: String,
    #[serde(default = "default_true")]
    pub preferred: bool,
    #[serde(default)]
    pub forbidden: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TermUpsertParams {
    pub termbase_id: String,
    pub source_locale: String,
    pub source_term: String,
    #[serde(default)]
    pub part_of_speech: Option<String>,
    #[serde(default)]
    pub definition: Option<String>,
    #[serde(default)]
    pub example: Option<String>,
    #[serde(default)]
    pub domain: Option<String>,
    #[serde(default = "default_term_status")]
    pub status: TermStatus,
    pub translations: Vec<TermTranslationInput>,
}

fn default_term_status() -> TermStatus {
    TermStatus::Active
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TermbaseImportParams {
    pub termbase_id: String,
    pub source_path: String,
    pub format: AssetExchangeFormat,
    pub source_locale: String,
    pub target_locale: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TermbaseImportResult {
    pub termbase_id: String,
    pub inserted: u32,
    pub skipped: u32,
    pub diagnostics: Vec<AssetDiagnostic>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TermbaseExportParams {
    pub termbase_id: String,
    pub output_path: String,
    pub format: AssetExchangeFormat,
    pub target_locale: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TermbaseExportResult {
    pub termbase_id: String,
    pub output_path: String,
    pub entry_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ListQaParams {
    pub document_id: String,
    #[serde(default)]
    pub include_resolved: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ExportDocxParams {
    pub document_id: String,
    pub output_path: String,
    #[serde(default)]
    pub qa_override: Option<QaOverrideInput>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ExportDocumentParams {
    pub document_id: String,
    pub output_path: String,
    #[serde(default)]
    pub qa_override: Option<QaOverrideInput>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct HistoryListParams {
    pub project_id: String,
    #[serde(default)]
    pub offset: u32,
    #[serde(default = "default_page_size")]
    pub limit: u32,
    #[serde(default = "default_true")]
    pub descending: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateBackupParams {
    pub destination_path: String,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreatePipelineParams {
    #[serde(default)]
    pub project_id: Option<String>,
    pub name: String,
    pub steps: Vec<PipelineStepDefinition>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PipelineListParams {
    #[serde(default)]
    pub project_id: Option<String>,
    #[serde(default)]
    pub offset: u32,
    #[serde(default = "default_page_size")]
    pub limit: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ValidatePipelineParams {
    pub name: String,
    pub steps: Vec<PipelineStepDefinition>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PipelineIdParams {
    pub pipeline_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct RunPipelineParams {
    pub definition_id: String,
    pub project_id: String,
    #[serde(default)]
    pub document_id: Option<String>,
    #[serde(default)]
    pub input: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PipelineRunListParams {
    pub project_id: String,
    #[serde(default)]
    pub offset: u32,
    #[serde(default = "default_page_size")]
    pub limit: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PipelineRunIdParams {
    pub run_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PipelineRunRevisionParams {
    pub run_id: String,
    pub expected_revision: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSnapshot {
    pub project: Project,
    pub documents: Vec<Document>,
    pub counts: SegmentCounts,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProjectPage {
    pub items: Vec<Project>,
    pub total: u32,
    pub offset: u32,
    pub limit: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DocumentPage {
    pub items: Vec<Document>,
    pub total: u32,
    pub offset: u32,
    pub limit: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ImportDocumentResult {
    pub document: Document,
    pub filter_id: String,
    pub degradation: Vec<DegradationFinding>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ExportDocumentResult {
    pub output_path: String,
    pub filter_id: String,
    pub translated_segments: u32,
    pub degradation: Vec<DegradationFinding>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct FilterListResult {
    pub filters: Vec<FilterDescriptor>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct OperationPage {
    pub items: Vec<Operation>,
    pub total: u32,
    pub offset: u32,
    pub limit: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct BackupResult {
    pub destination_path: String,
    pub manifest: BackupManifest,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PipelineDefinitionPage {
    pub items: Vec<PipelineDefinition>,
    pub total: u32,
    pub offset: u32,
    pub limit: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PipelineValidationResult {
    pub valid: bool,
    pub errors: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PipelineRunSnapshot {
    pub run: PipelineRun,
    pub steps: Vec<PipelineStepRun>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PipelineRunPage {
    pub items: Vec<PipelineRun>,
    pub total: u32,
    pub offset: u32,
    pub limit: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PipelineCapabilityResult {
    pub status_values: Vec<PipelineRunStatus>,
    pub steps: Vec<StepDescriptor>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SegmentPage {
    pub items: Vec<Segment>,
    pub total: u32,
    pub offset: u32,
    pub limit: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ConfirmSegmentResult {
    pub segment: Segment,
    pub counts: SegmentCounts,
    pub tm_entry: TmEntry,
    pub qa_issues: Vec<QaIssue>,
    #[serde(default)]
    pub propagated: Vec<Segment>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ExactLookupResult {
    pub matches: Vec<TmEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct QaListResult {
    pub issues: Vec<QaIssue>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ExportDocxResult {
    pub output_path: String,
    pub translated_segments: u32,
}

#[derive(Debug, JsonSchema)]
#[allow(dead_code)]
pub struct MethodContract<Params, Result> {
    pub params: Params,
    pub result: Result,
}

#[derive(Debug, JsonSchema)]
#[allow(dead_code)]
#[serde(deny_unknown_fields)]
pub struct RpcMethodCatalog {
    #[serde(rename = "engine.initialize")]
    pub engine_initialize: MethodContract<InitializeParams, InitializeResult>,
    #[serde(rename = "project.create")]
    pub project_create: MethodContract<CreateProjectParams, Project>,
    #[serde(rename = "project.get")]
    pub project_get: MethodContract<ProjectIdParams, ProjectSnapshot>,
    #[serde(rename = "project.list")]
    pub project_list: MethodContract<ProjectListParams, ProjectPage>,
    #[serde(rename = "project.update")]
    pub project_update: MethodContract<UpdateProjectParams, Project>,
    #[serde(rename = "project.setLifecycle")]
    pub project_set_lifecycle: MethodContract<SetProjectLifecycleParams, Project>,
    #[serde(rename = "project.template.list")]
    pub project_template_list: MethodContract<ProjectTemplateListParams, ProjectTemplatePage>,
    #[serde(rename = "project.template.get")]
    pub project_template_get: MethodContract<ProjectTemplateGetParams, ProjectTemplate>,
    #[serde(rename = "project.template.create")]
    pub project_template_create: MethodContract<ProjectTemplateCreateParams, ProjectTemplate>,
    #[serde(rename = "project.template.update")]
    pub project_template_update: MethodContract<ProjectTemplateUpdateParams, ProjectTemplate>,
    #[serde(rename = "project.template.delete")]
    pub project_template_delete: MethodContract<ProjectTemplateDeleteParams, EmptyResult>,
    #[serde(rename = "project.createFromTemplate")]
    pub project_create_from_template:
        MethodContract<ProjectCreateFromTemplateParams, ProjectCreateFromTemplateResult>,
    #[serde(rename = "project.batchImport")]
    pub project_batch_import: MethodContract<ProjectBatchImportParams, ProjectBatchImportResult>,
    #[serde(rename = "project.archive.export")]
    pub project_archive_export: MethodContract<ProjectArchiveExportParams, ProjectArchiveResult>,
    #[serde(rename = "project.archive.restore")]
    pub project_archive_restore: MethodContract<ProjectArchiveRestoreParams, ProjectArchiveResult>,
    #[serde(rename = "discussion.thread.list")]
    pub discussion_thread_list: MethodContract<DiscussionThreadListParams, DiscussionThreadPage>,
    #[serde(rename = "discussion.thread.create")]
    pub discussion_thread_create: MethodContract<DiscussionThreadCreateParams, DiscussionThread>,
    #[serde(rename = "discussion.thread.resolve")]
    pub discussion_thread_resolve: MethodContract<DiscussionThreadResolveParams, DiscussionThread>,
    #[serde(rename = "discussion.message.list")]
    pub discussion_message_list: MethodContract<DiscussionMessageListParams, DiscussionMessagePage>,
    #[serde(rename = "discussion.message.create")]
    pub discussion_message_create: MethodContract<DiscussionMessageCreateParams, DiscussionMessage>,
    #[serde(rename = "discussion.message.update")]
    pub discussion_message_update: MethodContract<DiscussionMessageUpdateParams, DiscussionMessage>,
    #[serde(rename = "discussion.message.delete")]
    pub discussion_message_delete: MethodContract<DiscussionMessageDeleteParams, DiscussionMessage>,
    #[serde(rename = "project.snapshot.list")]
    pub project_snapshot_list: MethodContract<ProjectSnapshotListParams, ProjectSnapshotPage>,
    #[serde(rename = "project.snapshot.create")]
    pub project_snapshot_create: MethodContract<ProjectSnapshotCreateParams, NamedProjectSnapshot>,
    #[serde(rename = "project.snapshot.get")]
    pub project_snapshot_get: MethodContract<ProjectSnapshotGetParams, NamedProjectSnapshot>,
    #[serde(rename = "project.snapshot.previewRestore")]
    pub project_snapshot_preview_restore:
        MethodContract<ProjectSnapshotPreviewRestoreParams, ProjectSnapshotPreview>,
    #[serde(rename = "project.snapshot.restore")]
    pub project_snapshot_restore:
        MethodContract<ProjectSnapshotRestoreParams, ProjectSnapshotRestoreResult>,
    #[serde(rename = "taskPackage.export")]
    pub task_package_export: MethodContract<TaskPackageExportParams, TaskPackageResult>,
    #[serde(rename = "taskPackage.preview")]
    pub task_package_preview: MethodContract<TaskPackagePreviewParams, TaskPackagePreviewResult>,
    #[serde(rename = "taskPackage.apply")]
    pub task_package_apply: MethodContract<TaskPackageApplyParams, TaskPackageApplyResult>,
    #[serde(rename = "taskPackage.import")]
    pub task_package_import: MethodContract<TaskPackageImportParams, TaskPackageImportResult>,
    #[serde(rename = "taskPackage.discard")]
    pub task_package_discard: MethodContract<TaskPackageDiscardParams, TaskPackageDiscardResult>,
    #[serde(rename = "document.list")]
    pub document_list: MethodContract<DocumentListParams, DocumentPage>,
    #[serde(rename = "document.get")]
    pub document_get: MethodContract<DocumentIdParams, Document>,
    #[serde(rename = "document.import")]
    pub document_import: MethodContract<ImportDocumentParams, ImportDocumentResult>,
    #[serde(rename = "document.importDocx")]
    pub document_import_docx: MethodContract<ImportDocxParams, Document>,
    #[serde(rename = "document.reimport.preview")]
    pub document_reimport_preview:
        MethodContract<DocumentReimportPreviewParams, DocumentReimportPreviewResult>,
    #[serde(rename = "document.reimport.apply")]
    pub document_reimport_apply: MethodContract<DocumentReimportApplyParams, Document>,
    #[serde(rename = "recycle.list")]
    pub recycle_list: MethodContract<RecycleListParams, RecyclePage>,
    #[serde(rename = "recycle.delete")]
    pub recycle_delete: MethodContract<RecycleDeleteParams, RecycleEntry>,
    #[serde(rename = "recycle.restore")]
    pub recycle_restore: MethodContract<RecycleEntryActionParams, EmptyResult>,
    #[serde(rename = "recycle.purge")]
    pub recycle_purge: MethodContract<RecycleEntryActionParams, EmptyResult>,
    #[serde(rename = "search.global")]
    pub search_global: MethodContract<GlobalSearchParams, GlobalSearchPage>,
    #[serde(rename = "analysis.profile.list")]
    pub analysis_profile_list: MethodContract<EmptyParams, AnalysisProfileListResult>,
    #[serde(rename = "analysis.run")]
    pub analysis_run: MethodContract<AnalysisRunParams, AnalysisRunResult>,
    #[serde(rename = "analysis.run.get")]
    pub analysis_run_get: MethodContract<AnalysisRunIdParams, AnalysisRunResult>,
    #[serde(rename = "project.analytics.get")]
    pub project_analytics_get: MethodContract<ProjectAnalyticsParams, ProjectAnalyticsResult>,
    #[serde(rename = "segment.list")]
    pub segment_list: MethodContract<SegmentListParams, SegmentPage>,
    #[serde(rename = "segment.updateTarget")]
    pub segment_update_target: MethodContract<UpdateTargetParams, Segment>,
    #[serde(rename = "segment.confirm")]
    pub segment_confirm: MethodContract<ConfirmSegmentParams, ConfirmSegmentResult>,
    #[serde(rename = "segment.editor.list")]
    pub segment_editor_list: MethodContract<EditorSegmentListParams, EditorSegmentPage>,
    #[serde(rename = "segment.tag.set")]
    pub segment_tag_set: MethodContract<SetSegmentTagsParams, EditorMutationResult>,
    #[serde(rename = "segment.chinese.convert")]
    pub segment_chinese_convert: MethodContract<ConvertSegmentChineseParams, EditorMutationResult>,
    #[serde(rename = "segment.propagate")]
    pub segment_propagate: MethodContract<PropagateSegmentParams, EditorMutationResult>,
    #[serde(rename = "segment.find")]
    pub segment_find: MethodContract<FindSegmentsParams, SegmentFindResult>,
    #[serde(rename = "segment.replace.preview")]
    pub segment_replace_preview: MethodContract<ReplacePreviewParams, ReplacePreviewResult>,
    #[serde(rename = "segment.replace.apply")]
    pub segment_replace_apply: MethodContract<ReplaceApplyParams, EditorMutationResult>,
    #[serde(rename = "segment.split")]
    pub segment_split: MethodContract<SplitSegmentParams, EditorMutationResult>,
    #[serde(rename = "segment.merge")]
    pub segment_merge: MethodContract<MergeSegmentsParams, EditorMutationResult>,
    #[serde(rename = "segment.correctSource")]
    pub segment_correct_source: MethodContract<CorrectSourceParams, EditorMutationResult>,
    #[serde(rename = "segment.workflow.set")]
    pub segment_workflow_set: MethodContract<SetEditorWorkflowParams, EditorMutationResult>,
    #[serde(rename = "segment.comment.list")]
    pub segment_comment_list: MethodContract<SegmentCommentListParams, SegmentCommentListResult>,
    #[serde(rename = "segment.comment.create")]
    pub segment_comment_create: MethodContract<CreateSegmentCommentParams, EditorComment>,
    #[serde(rename = "segment.comment.update")]
    pub segment_comment_update: MethodContract<UpdateSegmentCommentParams, EditorComment>,
    #[serde(rename = "segment.comment.resolve")]
    pub segment_comment_resolve: MethodContract<ResolveSegmentCommentParams, EditorComment>,
    #[serde(rename = "segment.comment.delete")]
    pub segment_comment_delete: MethodContract<DeleteSegmentCommentParams, EmptyResult>,
    #[serde(rename = "segment.spell.check")]
    pub segment_spell_check: MethodContract<SpellCheckParams, SpellCheckResult>,
    #[serde(rename = "dictionary.list")]
    pub dictionary_list: MethodContract<DictionaryListParams, DictionaryListResult>,
    #[serde(rename = "dictionary.add")]
    pub dictionary_add: MethodContract<DictionaryWordParams, DictionaryListResult>,
    #[serde(rename = "dictionary.remove")]
    pub dictionary_remove: MethodContract<DictionaryWordParams, DictionaryListResult>,
    #[serde(rename = "editor.undo")]
    pub editor_undo: MethodContract<EditorUndoRedoParams, EditorMutationResult>,
    #[serde(rename = "editor.redo")]
    pub editor_redo: MethodContract<EditorUndoRedoParams, EditorMutationResult>,
    #[serde(rename = "editor.history")]
    pub editor_history: MethodContract<EditorHistoryParams, EditorHistoryResult>,
    #[serde(rename = "review.create")]
    pub review_create: MethodContract<ReviewCreateParams, ReviewRevision>,
    #[serde(rename = "review.list")]
    pub review_list: MethodContract<ReviewListParams, ReviewListResult>,
    #[serde(rename = "review.accept")]
    pub review_accept: MethodContract<ReviewDecisionParams, EditorMutationResult>,
    #[serde(rename = "review.reject")]
    pub review_reject: MethodContract<ReviewDecisionParams, ReviewRevision>,
    #[serde(rename = "review.queue")]
    pub review_queue: MethodContract<ReviewQueueParams, ReviewQueuePage>,
    #[serde(rename = "review.stats")]
    pub review_stats: MethodContract<ReviewStatisticsParams, ReviewStatisticsResult>,
    #[serde(rename = "interop.review.export")]
    pub interop_review_export: MethodContract<ReviewExportParams, ReviewExportResult>,
    #[serde(rename = "interop.review.preview")]
    pub interop_review_preview: MethodContract<ReviewPreviewParams, ReviewPreviewResult>,
    #[serde(rename = "interop.review.apply")]
    pub interop_review_apply: MethodContract<ReviewApplyParams, InteropApplyResult>,
    #[serde(rename = "interop.table.preview")]
    pub interop_table_preview: MethodContract<TablePreviewParams, TablePreviewResult>,
    #[serde(rename = "interop.table.apply")]
    pub interop_table_apply: MethodContract<TableApplyParams, InteropApplyResult>,
    #[serde(rename = "editor.preferences.get")]
    pub editor_preferences_get: MethodContract<EmptyParams, EditorPreferences>,
    #[serde(rename = "editor.preferences.update")]
    pub editor_preferences_update: MethodContract<UpdateEditorPreferencesParams, EditorPreferences>,
    #[serde(rename = "pdf.page.list")]
    pub pdf_page_list: MethodContract<PdfPageListParams, PdfPageListResult>,
    #[serde(rename = "pdf.page.get")]
    pub pdf_page_get: MethodContract<PdfPageGetParams, PdfPageDetail>,
    #[serde(rename = "pdf.correctOcr")]
    pub pdf_correct_ocr: MethodContract<CorrectOcrParams, Segment>,
    #[serde(rename = "alignment.session.create")]
    pub alignment_session_create:
        MethodContract<AlignmentSessionCreateParams, AlignmentSessionCreateResult>,
    #[serde(rename = "alignment.session.get")]
    pub alignment_session_get: MethodContract<AlignmentSessionGetParams, AlignmentSessionGetResult>,
    #[serde(rename = "alignment.session.list")]
    pub alignment_session_list: MethodContract<AlignmentSessionListParams, AlignmentSessionPage>,
    #[serde(rename = "alignment.session.update")]
    pub alignment_session_update:
        MethodContract<AlignmentSessionUpdateParams, AlignmentMutationResult>,
    #[serde(rename = "alignment.session.refine")]
    pub alignment_session_refine:
        MethodContract<AlignmentSessionRefineParams, translunar_ai_core::AiRun>,
    #[serde(rename = "alignment.session.apply")]
    pub alignment_session_apply: MethodContract<AlignmentSessionApplyParams, AlignmentApplyResult>,
    #[serde(rename = "corpus.list")]
    pub corpus_list: MethodContract<CorpusListParams, ReferenceCorpusPage>,
    #[serde(rename = "corpus.import")]
    pub corpus_import: MethodContract<CorpusImportParams, ReferenceCorpusMutationResult>,
    #[serde(rename = "corpus.fromAlignment")]
    pub corpus_from_alignment:
        MethodContract<CorpusFromAlignmentParams, ReferenceCorpusMutationResult>,
    #[serde(rename = "corpus.search")]
    pub corpus_search: MethodContract<CorpusSearchParams, CorpusSearchResult>,
    #[serde(rename = "corpus.reindex")]
    pub corpus_reindex: MethodContract<CorpusMutationParams, ReferenceCorpusMutationResult>,
    #[serde(rename = "corpus.remove")]
    pub corpus_remove: MethodContract<CorpusMutationParams, ReferenceCorpusMutationResult>,
    #[serde(rename = "asset.catalog.list")]
    pub asset_catalog_list: MethodContract<AssetCatalogListParams, AssetCatalogPage>,
    #[serde(rename = "curation.run")]
    pub curation_run: MethodContract<CurationRunParams, CurationRunSnapshot>,
    #[serde(rename = "curation.run.get")]
    pub curation_run_get: MethodContract<CurationRunIdParams, CurationRunSnapshot>,
    #[serde(rename = "curation.finding.list")]
    pub curation_finding_list: MethodContract<CurationFindingListParams, CurationFindingPage>,
    #[serde(rename = "curation.apply")]
    pub curation_apply: MethodContract<CurationApplyParams, CurationMutationResult>,
    #[serde(rename = "curation.rollback")]
    pub curation_rollback: MethodContract<CurationRollbackParams, CurationMutationResult>,
    #[serde(rename = "curation.export")]
    pub curation_export: MethodContract<CurationExportParams, CurationExportResult>,
    #[serde(rename = "tm.lookupExact")]
    pub tm_lookup_exact: MethodContract<ExactLookupParams, ExactLookupResult>,
    #[serde(rename = "tm.library.list")]
    pub tm_library_list: MethodContract<TmLibraryListParams, TmLibraryPage>,
    #[serde(rename = "tm.library.create")]
    pub tm_library_create: MethodContract<TmLibraryCreateParams, TmLibrary>,
    #[serde(rename = "tm.library.mount")]
    pub tm_library_mount: MethodContract<TmLibraryMountParams, TmLibraryMount>,
    #[serde(rename = "tm.library.unmount")]
    pub tm_library_unmount: MethodContract<TmLibraryUnmountParams, EmptyResult>,
    #[serde(rename = "tm.search")]
    pub tm_search: MethodContract<TmSearchParams, TmSearchResult>,
    #[serde(rename = "tm.concordance")]
    pub tm_concordance: MethodContract<ConcordanceParams, ConcordanceResult>,
    #[serde(rename = "tm.import")]
    pub tm_import: MethodContract<TmImportParams, TmImportResult>,
    #[serde(rename = "tm.export")]
    pub tm_export: MethodContract<TmExportParams, TmExportResult>,
    #[serde(rename = "termbase.list")]
    pub termbase_list: MethodContract<TermbaseListParams, TermbasePage>,
    #[serde(rename = "termbase.create")]
    pub termbase_create: MethodContract<TermbaseCreateParams, Termbase>,
    #[serde(rename = "termbase.mount")]
    pub termbase_mount: MethodContract<TermbaseMountParams, TermbaseMount>,
    #[serde(rename = "termbase.unmount")]
    pub termbase_unmount: MethodContract<TermbaseUnmountParams, EmptyResult>,
    #[serde(rename = "term.search")]
    pub term_search: MethodContract<TermSearchParams, TermSearchResult>,
    #[serde(rename = "term.upsert")]
    pub term_upsert: MethodContract<TermUpsertParams, TermEntry>,
    #[serde(rename = "termbase.import")]
    pub termbase_import: MethodContract<TermbaseImportParams, TermbaseImportResult>,
    #[serde(rename = "termbase.export")]
    pub termbase_export: MethodContract<TermbaseExportParams, TermbaseExportResult>,
    #[serde(rename = "qa.runDocument")]
    pub qa_run_document: MethodContract<DocumentIdParams, QaListResult>,
    #[serde(rename = "qa.list")]
    pub qa_list: MethodContract<ListQaParams, QaListResult>,
    #[serde(rename = "qa.profile.list")]
    pub qa_profile_list: MethodContract<QaProfileListParams, QaProfilePage>,
    #[serde(rename = "qa.profile.create")]
    pub qa_profile_create: MethodContract<QaProfileCreateParams, translunar_qa_core::QaProfile>,
    #[serde(rename = "qa.profile.clone")]
    pub qa_profile_clone: MethodContract<QaProfileCloneParams, translunar_qa_core::QaProfile>,
    #[serde(rename = "qa.profile.update")]
    pub qa_profile_update: MethodContract<QaProfileUpdateParams, translunar_qa_core::QaProfile>,
    #[serde(rename = "qa.profile.delete")]
    pub qa_profile_delete: MethodContract<QaProfileDeleteParams, EmptyResult>,
    #[serde(rename = "qa.run")]
    pub qa_run: MethodContract<QaRunParams, QaRunResult>,
    #[serde(rename = "qa.run.list")]
    pub qa_run_list: MethodContract<QaRunListParams, QaRunPage>,
    #[serde(rename = "qa.run.get")]
    pub qa_run_get: MethodContract<QaRunIdParams, QaRunResult>,
    #[serde(rename = "qa.issue.list")]
    pub qa_issue_list: MethodContract<QaIssueListParams, QaIssuePage>,
    #[serde(rename = "qa.issue.waive")]
    pub qa_issue_waive: MethodContract<QaIssueWaiveParams, translunar_qa_core::QaIssueView>,
    #[serde(rename = "qa.issue.revoke")]
    pub qa_issue_revoke: MethodContract<QaIssueRevokeParams, translunar_qa_core::QaIssueView>,
    #[serde(rename = "qa.report.export")]
    pub qa_report_export: MethodContract<QaReportExportParams, QaReportExportResult>,
    #[serde(rename = "qa.gate.check")]
    pub qa_gate_check: MethodContract<QaGateCheckParams, QaGateCheckResult>,
    #[serde(rename = "qa.override.list")]
    pub qa_override_list: MethodContract<QaOverrideListParams, QaOverridePage>,
    #[serde(rename = "document.exportDocx")]
    pub document_export_docx: MethodContract<ExportDocxParams, ExportDocxResult>,
    #[serde(rename = "document.export")]
    pub document_export: MethodContract<ExportDocumentParams, ExportDocumentResult>,
    #[serde(rename = "filter.list")]
    pub filter_list: MethodContract<EmptyParams, FilterListResult>,
    #[serde(rename = "plugin.list")]
    pub plugin_list: MethodContract<PluginListParams, PluginPage>,
    #[serde(rename = "plugin.get")]
    pub plugin_get: MethodContract<PluginIdParams, PluginSummary>,
    #[serde(rename = "plugin.install")]
    pub plugin_install: MethodContract<PluginInstallParams, PluginMutationResult>,
    #[serde(rename = "plugin.enable")]
    pub plugin_enable: MethodContract<PluginMutationParams, PluginMutationResult>,
    #[serde(rename = "plugin.disable")]
    pub plugin_disable: MethodContract<PluginMutationParams, PluginMutationResult>,
    #[serde(rename = "plugin.uninstall")]
    pub plugin_uninstall: MethodContract<PluginMutationParams, PluginMutationResult>,
    #[serde(rename = "history.list")]
    pub history_list: MethodContract<HistoryListParams, OperationPage>,
    #[serde(rename = "data.checkHealth")]
    pub data_check_health: MethodContract<EmptyParams, DataHealthReport>,
    #[serde(rename = "data.createBackup")]
    pub data_create_backup: MethodContract<CreateBackupParams, BackupResult>,
    #[serde(rename = "pipeline.step.list")]
    pub pipeline_step_list: MethodContract<EmptyParams, PipelineCapabilityResult>,
    #[serde(rename = "pipeline.create")]
    pub pipeline_create: MethodContract<CreatePipelineParams, PipelineDefinition>,
    #[serde(rename = "pipeline.list")]
    pub pipeline_list: MethodContract<PipelineListParams, PipelineDefinitionPage>,
    #[serde(rename = "pipeline.get")]
    pub pipeline_get: MethodContract<PipelineIdParams, PipelineDefinition>,
    #[serde(rename = "pipeline.validate")]
    pub pipeline_validate: MethodContract<ValidatePipelineParams, PipelineValidationResult>,
    #[serde(rename = "pipeline.run")]
    pub pipeline_run: MethodContract<RunPipelineParams, PipelineRunSnapshot>,
    #[serde(rename = "pipeline.run.list")]
    pub pipeline_run_list: MethodContract<PipelineRunListParams, PipelineRunPage>,
    #[serde(rename = "pipeline.run.get")]
    pub pipeline_run_get: MethodContract<PipelineRunIdParams, PipelineRunSnapshot>,
    #[serde(rename = "pipeline.run.cancel")]
    pub pipeline_run_cancel: MethodContract<PipelineRunRevisionParams, PipelineRunSnapshot>,
    #[serde(rename = "pipeline.run.resume")]
    pub pipeline_run_resume: MethodContract<PipelineRunRevisionParams, PipelineRunSnapshot>,
    #[serde(rename = "ai.provider.catalog")]
    pub ai_provider_catalog: MethodContract<AiProviderCatalogParams, AiProviderCatalogResult>,
    #[serde(rename = "ai.provider.list")]
    pub ai_provider_list: MethodContract<AiProviderListParams, AiProviderPage>,
    #[serde(rename = "ai.provider.create")]
    pub ai_provider_create: MethodContract<AiProviderCreateParams, AiProviderProfile>,
    #[serde(rename = "ai.provider.update")]
    pub ai_provider_update: MethodContract<AiProviderUpdateParams, AiProviderProfile>,
    #[serde(rename = "ai.provider.delete")]
    pub ai_provider_delete: MethodContract<AiProfileRevisionParams, EmptyResult>,
    #[serde(rename = "ai.provider.test")]
    pub ai_provider_test: MethodContract<AiProfileIdParams, AiProviderTestResult>,
    #[serde(rename = "ai.credential.delete")]
    pub ai_credential_delete: MethodContract<AiProfileIdParams, AiCredentialStatus>,
    #[serde(rename = "ai.credential.status")]
    pub ai_credential_status: MethodContract<AiProfileIdParams, AiCredentialStatus>,
    #[serde(rename = "ai.settings.get")]
    pub ai_settings_get: MethodContract<AiSettingsGetParams, AiSettings>,
    #[serde(rename = "ai.settings.update")]
    pub ai_settings_update: MethodContract<AiSettingsUpdateParams, AiSettings>,
    #[serde(rename = "ai.grounding.preview")]
    pub ai_grounding_preview: MethodContract<AiGroundingPreviewParams, AiGroundingPreviewResult>,
    #[serde(rename = "ai.run.start")]
    pub ai_run_start: MethodContract<AiRunStartParams, AiRun>,
    #[serde(rename = "ai.run.get")]
    pub ai_run_get: MethodContract<AiRunIdParams, AiRun>,
    #[serde(rename = "ai.run.list")]
    pub ai_run_list: MethodContract<AiRunListParams, AiRunPage>,
    #[serde(rename = "ai.run.events")]
    pub ai_run_events: MethodContract<AiRunEventsParams, AiRunEventPage>,
    #[serde(rename = "ai.run.cancel")]
    pub ai_run_cancel: MethodContract<AiRunRevisionParams, AiRun>,
    #[serde(rename = "ai.run.resume")]
    pub ai_run_resume: MethodContract<AiRunRevisionParams, AiRun>,
    #[serde(rename = "ai.result.apply")]
    pub ai_result_apply: MethodContract<AiResultApplyParams, EditorMutationResult>,
    #[serde(rename = "ai.batch.start")]
    pub ai_batch_start: MethodContract<AiBatchStartParams, AiBatchRun>,
    #[serde(rename = "ai.batch.get")]
    pub ai_batch_get: MethodContract<AiBatchIdParams, AiBatchRun>,
    #[serde(rename = "ai.batch.list")]
    pub ai_batch_list: MethodContract<AiBatchListParams, AiBatchPage>,
    #[serde(rename = "ai.batch.items")]
    pub ai_batch_items: MethodContract<AiBatchItemsParams, AiBatchItemPage>,
    #[serde(rename = "ai.batch.cancel")]
    pub ai_batch_cancel: MethodContract<AiBatchRevisionParams, AiBatchRun>,
    #[serde(rename = "ai.batch.resume")]
    pub ai_batch_resume: MethodContract<AiBatchRevisionParams, AiBatchRun>,
    #[serde(rename = "ai.usage.query")]
    pub ai_usage_query: MethodContract<AiUsageQueryParams, AiUsageQueryResult>,
    #[serde(rename = "ai.conversation.list")]
    pub ai_conversation_list: MethodContract<AiConversationListParams, AiConversationPage>,
    #[serde(rename = "ai.conversation.create")]
    pub ai_conversation_create: MethodContract<AiConversationCreateParams, AiConversation>,
    #[serde(rename = "ai.conversation.update")]
    pub ai_conversation_update: MethodContract<AiConversationUpdateParams, AiConversation>,
    #[serde(rename = "ai.conversation.messages")]
    pub ai_conversation_messages:
        MethodContract<AiConversationMessagesParams, AiConversationMessagePage>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EmptyParams {}

#[derive(Debug, Clone, Default, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct EmptyResult {}

#[derive(Debug, JsonSchema)]
#[allow(dead_code)]
pub struct ProtocolCatalog {
    pub methods: RpcMethodCatalog,
    pub initialize_params: InitializeParams,
    pub initialize_result: InitializeResult,
    pub create_project_params: CreateProjectParams,
    pub project_id_params: ProjectIdParams,
    pub project_create_from_template_params: ProjectCreateFromTemplateParams,
    pub project_analytics_params: ProjectAnalyticsParams,
    pub project_list_params: ProjectListParams,
    pub update_project_params: UpdateProjectParams,
    pub set_project_lifecycle_params: SetProjectLifecycleParams,
    pub discussion_thread_list_params: DiscussionThreadListParams,
    pub discussion_thread_create_params: DiscussionThreadCreateParams,
    pub discussion_thread_resolve_params: DiscussionThreadResolveParams,
    pub discussion_message_list_params: DiscussionMessageListParams,
    pub discussion_message_create_params: DiscussionMessageCreateParams,
    pub discussion_message_update_params: DiscussionMessageUpdateParams,
    pub discussion_message_delete_params: DiscussionMessageDeleteParams,
    pub discussion_thread: DiscussionThread,
    pub discussion_message: DiscussionMessage,
    pub discussion_thread_page: DiscussionThreadPage,
    pub discussion_message_page: DiscussionMessagePage,
    pub project_snapshot_list_params: ProjectSnapshotListParams,
    pub project_snapshot_create_params: ProjectSnapshotCreateParams,
    pub project_snapshot_get_params: ProjectSnapshotGetParams,
    pub project_snapshot_preview_restore_params: ProjectSnapshotPreviewRestoreParams,
    pub project_snapshot_restore_params: ProjectSnapshotRestoreParams,
    pub named_project_snapshot: NamedProjectSnapshot,
    pub project_snapshot_page: ProjectSnapshotPage,
    pub project_snapshot_preview: ProjectSnapshotPreview,
    pub project_snapshot_change_summary: ProjectSnapshotChangeSummary,
    pub project_snapshot_restore_result: ProjectSnapshotRestoreResult,
    pub import_docx_params: ImportDocxParams,
    pub import_document_params: ImportDocumentParams,
    pub document_id_params: DocumentIdParams,
    pub document_list_params: DocumentListParams,
    pub segment_list_params: SegmentListParams,
    pub update_target_params: UpdateTargetParams,
    pub confirm_segment_params: ConfirmSegmentParams,
    pub exact_lookup_params: ExactLookupParams,
    pub alignment_session_create_params: AlignmentSessionCreateParams,
    pub alignment_session_get_params: AlignmentSessionGetParams,
    pub alignment_session_list_params: AlignmentSessionListParams,
    pub alignment_session_update_params: AlignmentSessionUpdateParams,
    pub alignment_session_refine_params: AlignmentSessionRefineParams,
    pub alignment_session_apply_params: AlignmentSessionApplyParams,
    pub alignment_session_get_result: AlignmentSessionGetResult,
    pub alignment_session_page: AlignmentSessionPage,
    pub alignment_mutation_result: AlignmentMutationResult,
    pub alignment_apply_result: AlignmentApplyResult,
    pub corpus_list_params: CorpusListParams,
    pub corpus_import_params: CorpusImportParams,
    pub corpus_from_alignment_params: CorpusFromAlignmentParams,
    pub corpus_search_params: CorpusSearchParams,
    pub corpus_mutation_params: CorpusMutationParams,
    pub reference_corpus_page: ReferenceCorpusPage,
    pub corpus_search_result: CorpusSearchResult,
    pub reference_corpus_mutation_result: ReferenceCorpusMutationResult,
    pub asset_catalog_list_params: AssetCatalogListParams,
    pub asset_catalog_item: AssetCatalogItem,
    pub asset_catalog_page: AssetCatalogPage,
    pub curation_run_params: CurationRunParams,
    pub curation_run_id_params: CurationRunIdParams,
    pub curation_finding_list_params: CurationFindingListParams,
    pub curation_apply_params: CurationApplyParams,
    pub curation_rollback_params: CurationRollbackParams,
    pub curation_export_params: CurationExportParams,
    pub curation_run_snapshot: CurationRunSnapshot,
    pub curation_finding_page: CurationFindingPage,
    pub curation_mutation_result: CurationMutationResult,
    pub curation_export_result: CurationExportResult,
    pub asset_exchange_format: AssetExchangeFormat,
    pub tm_library_list_params: TmLibraryListParams,
    pub tm_library_create_params: TmLibraryCreateParams,
    pub tm_library_mount_params: TmLibraryMountParams,
    pub tm_library_unmount_params: TmLibraryUnmountParams,
    pub tm_library_page: TmLibraryPage,
    pub tm_search_params: TmSearchParams,
    pub tm_search_result: TmSearchResult,
    pub concordance_params: ConcordanceParams,
    pub concordance_result: ConcordanceResult,
    pub asset_diagnostic: AssetDiagnostic,
    pub tm_import_params: TmImportParams,
    pub tm_import_result: TmImportResult,
    pub tm_export_params: TmExportParams,
    pub tm_export_result: TmExportResult,
    pub termbase_list_params: TermbaseListParams,
    pub termbase_create_params: TermbaseCreateParams,
    pub termbase_mount_params: TermbaseMountParams,
    pub termbase_unmount_params: TermbaseUnmountParams,
    pub termbase_page: TermbasePage,
    pub term_search_params: TermSearchParams,
    pub term_search_result: TermSearchResult,
    pub term_translation_input: TermTranslationInput,
    pub term_upsert_params: TermUpsertParams,
    pub termbase_import_params: TermbaseImportParams,
    pub termbase_import_result: TermbaseImportResult,
    pub termbase_export_params: TermbaseExportParams,
    pub termbase_export_result: TermbaseExportResult,
    pub list_qa_params: ListQaParams,
    pub qa_profile_list_params: QaProfileListParams,
    pub qa_profile_create_params: QaProfileCreateParams,
    pub qa_profile_clone_params: QaProfileCloneParams,
    pub qa_profile_update_params: QaProfileUpdateParams,
    pub qa_profile_delete_params: QaProfileDeleteParams,
    pub qa_profile_page: QaProfilePage,
    pub qa_run_params: QaRunParams,
    pub qa_run_list_params: QaRunListParams,
    pub qa_run_id_params: QaRunIdParams,
    pub qa_run_page: QaRunPage,
    pub qa_issue_list_params: QaIssueListParams,
    pub qa_issue_page: QaIssuePage,
    pub qa_issue_waive_params: QaIssueWaiveParams,
    pub qa_issue_revoke_params: QaIssueRevokeParams,
    pub qa_report_export_params: QaReportExportParams,
    pub qa_gate_check_params: QaGateCheckParams,
    pub qa_override_input: QaOverrideInput,
    pub qa_override_list_params: QaOverrideListParams,
    pub qa_override_page: QaOverridePage,
    pub review_queue_params: ReviewQueueParams,
    pub review_queue_page: ReviewQueuePage,
    pub review_statistics_params: ReviewStatisticsParams,
    pub export_docx_params: ExportDocxParams,
    pub export_document_params: ExportDocumentParams,
    pub history_list_params: HistoryListParams,
    pub empty_params: EmptyParams,
    pub project_snapshot: ProjectSnapshot,
    pub project_page: ProjectPage,
    pub document_page: DocumentPage,
    pub import_document_result: ImportDocumentResult,
    pub export_document_result: ExportDocumentResult,
    pub filter_list_result: FilterListResult,
    pub plugin_list_params: PluginListParams,
    pub plugin_id_params: PluginIdParams,
    pub plugin_install_params: PluginInstallParams,
    pub plugin_mutation_params: PluginMutationParams,
    pub plugin_summary: PluginSummary,
    pub plugin_page: PluginPage,
    pub plugin_mutation_result: PluginMutationResult,
    pub operation_page: OperationPage,
    pub create_backup_params: CreateBackupParams,
    pub backup_result: BackupResult,
    pub data_health_report: DataHealthReport,
    pub create_pipeline_params: CreatePipelineParams,
    pub pipeline_list_params: PipelineListParams,
    pub validate_pipeline_params: ValidatePipelineParams,
    pub pipeline_id_params: PipelineIdParams,
    pub run_pipeline_params: RunPipelineParams,
    pub pipeline_run_list_params: PipelineRunListParams,
    pub pipeline_run_id_params: PipelineRunIdParams,
    pub pipeline_run_revision_params: PipelineRunRevisionParams,
    pub pipeline_definition_page: PipelineDefinitionPage,
    pub pipeline_validation_result: PipelineValidationResult,
    pub pipeline_run_snapshot: PipelineRunSnapshot,
    pub pipeline_run_page: PipelineRunPage,
    pub pipeline_capability_result: PipelineCapabilityResult,
    pub segment_page: SegmentPage,
    pub confirm_segment_result: ConfirmSegmentResult,
    pub exact_lookup_result: ExactLookupResult,
    pub qa_list_result: QaListResult,
    pub export_docx_result: ExportDocxResult,
    pub rpc_error: RpcError,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn request_uses_camel_case_params() {
        let params = InitializeParams {
            protocol_version: 1,
            client: ClientInfo {
                name: "test".to_string(),
                version: "0".to_string(),
            },
        };
        let json = serde_json::to_value(params).expect("serialize");
        assert_eq!(json["protocolVersion"], 1);
        assert!(json.get("protocol_version").is_none());
    }

    #[test]
    fn document_import_options_are_additive_and_default_empty() {
        let params: ImportDocumentParams = serde_json::from_value(serde_json::json!({
            "projectId": "project",
            "sourcePath": "source.txt"
        }))
        .expect("deserialize legacy request");
        assert!(params.options.is_empty());

        let mut options = BTreeMap::new();
        options.insert("segmentationMode".to_string(), "sentence".to_string());
        let json = serde_json::to_value(ImportDocumentParams {
            project_id: "project".to_string(),
            source_path: "source.txt".to_string(),
            relative_path: None,
            filter_id: None,
            options,
        })
        .expect("serialize options");
        assert_eq!(json["options"]["segmentationMode"], "sentence");
    }

    #[test]
    fn concordance_corpus_results_are_additive_for_legacy_responses() {
        let result: ConcordanceResult = serde_json::from_value(serde_json::json!({
            "hits": [],
            "total": 0,
            "offset": 0,
            "limit": 50
        }))
        .expect("deserialize legacy concordance response");
        assert!(result.corpus_hits.is_empty());
        assert_eq!(result.corpus_total, 0);
    }

    #[test]
    fn error_code_is_stable_snake_case() {
        assert_eq!(
            serde_json::to_string(&ErrorCode::UnsupportedDocument).expect("serialize"),
            "\"unsupported_document\""
        );
        assert_eq!(
            serde_json::to_string(&ErrorCode::QaGateBlocked).expect("serialize QA gate code"),
            "\"qa_gate_blocked\""
        );
        assert_eq!(
            serde_json::to_string(&ErrorCode::AlignmentInvalidPartition)
                .expect("serialize alignment error code"),
            "\"alignment_invalid_partition\""
        );
        assert_eq!(
            serde_json::to_string(&ErrorCode::UnsupportedCorpusInput)
                .expect("serialize corpus error code"),
            "\"unsupported_corpus_input\""
        );
        assert_eq!(
            serde_json::to_string(&ErrorCode::ResourceLimitExceeded)
                .expect("serialize resource limit error code"),
            "\"resource_limit_exceeded\""
        );
    }

    #[test]
    fn qa_additions_preserve_legacy_export_and_workflow_requests() {
        let export: ExportDocumentParams = serde_json::from_value(serde_json::json!({
            "documentId": "document",
            "outputPath": "delivery.docx"
        }))
        .expect("deserialize legacy export request");
        assert!(export.qa_override.is_none());

        let workflow: SetEditorWorkflowParams = serde_json::from_value(serde_json::json!({
            "segmentId": "segment",
            "state": "review",
            "expectedRevision": 4
        }))
        .expect("deserialize legacy workflow request");
        assert!(workflow.actor.is_none());
        assert!(workflow.reason.is_none());
    }
}

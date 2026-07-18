use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use translunar_domain::{
    BackupManifest, DataHealthReport, DegradationFinding, Document, Operation, Project,
    ProjectConfiguration, ProjectLifecycle, QaIssue, Segment, SegmentCounts, TmEntry,
};
use translunar_filter_core::FilterDescriptor;
use translunar_pipeline::{
    PipelineDefinition, PipelineRun, PipelineRunStatus, PipelineStepDefinition, PipelineStepRun,
    StepDescriptor,
};

pub const PROTOCOL_VERSION: u32 = 1;

pub mod methods {
    pub const INITIALIZE: &str = "engine.initialize";
    pub const PROJECT_CREATE: &str = "project.create";
    pub const PROJECT_GET: &str = "project.get";
    pub const PROJECT_LIST: &str = "project.list";
    pub const PROJECT_UPDATE: &str = "project.update";
    pub const PROJECT_SET_LIFECYCLE: &str = "project.setLifecycle";
    pub const DOCUMENT_LIST: &str = "document.list";
    pub const DOCUMENT_GET: &str = "document.get";
    pub const DOCUMENT_IMPORT: &str = "document.import";
    pub const DOCUMENT_IMPORT_DOCX: &str = "document.importDocx";
    pub const SEGMENT_LIST: &str = "segment.list";
    pub const SEGMENT_UPDATE_TARGET: &str = "segment.updateTarget";
    pub const SEGMENT_CONFIRM: &str = "segment.confirm";
    pub const TM_LOOKUP_EXACT: &str = "tm.lookupExact";
    pub const QA_RUN_DOCUMENT: &str = "qa.runDocument";
    pub const QA_LIST: &str = "qa.list";
    pub const DOCUMENT_EXPORT_DOCX: &str = "document.exportDocx";
    pub const DOCUMENT_EXPORT: &str = "document.export";
    pub const FILTER_LIST: &str = "filter.list";
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
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ExportDocumentParams {
    pub document_id: String,
    pub output_path: String,
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
    #[serde(rename = "document.list")]
    pub document_list: MethodContract<DocumentListParams, DocumentPage>,
    #[serde(rename = "document.get")]
    pub document_get: MethodContract<DocumentIdParams, Document>,
    #[serde(rename = "document.import")]
    pub document_import: MethodContract<ImportDocumentParams, ImportDocumentResult>,
    #[serde(rename = "document.importDocx")]
    pub document_import_docx: MethodContract<ImportDocxParams, Document>,
    #[serde(rename = "segment.list")]
    pub segment_list: MethodContract<SegmentListParams, SegmentPage>,
    #[serde(rename = "segment.updateTarget")]
    pub segment_update_target: MethodContract<UpdateTargetParams, Segment>,
    #[serde(rename = "segment.confirm")]
    pub segment_confirm: MethodContract<ConfirmSegmentParams, ConfirmSegmentResult>,
    #[serde(rename = "tm.lookupExact")]
    pub tm_lookup_exact: MethodContract<ExactLookupParams, ExactLookupResult>,
    #[serde(rename = "qa.runDocument")]
    pub qa_run_document: MethodContract<DocumentIdParams, QaListResult>,
    #[serde(rename = "qa.list")]
    pub qa_list: MethodContract<ListQaParams, QaListResult>,
    #[serde(rename = "document.exportDocx")]
    pub document_export_docx: MethodContract<ExportDocxParams, ExportDocxResult>,
    #[serde(rename = "document.export")]
    pub document_export: MethodContract<ExportDocumentParams, ExportDocumentResult>,
    #[serde(rename = "filter.list")]
    pub filter_list: MethodContract<EmptyParams, FilterListResult>,
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
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EmptyParams {}

#[derive(Debug, JsonSchema)]
#[allow(dead_code)]
pub struct ProtocolCatalog {
    pub methods: RpcMethodCatalog,
    pub initialize_params: InitializeParams,
    pub initialize_result: InitializeResult,
    pub create_project_params: CreateProjectParams,
    pub project_id_params: ProjectIdParams,
    pub project_list_params: ProjectListParams,
    pub update_project_params: UpdateProjectParams,
    pub set_project_lifecycle_params: SetProjectLifecycleParams,
    pub import_docx_params: ImportDocxParams,
    pub import_document_params: ImportDocumentParams,
    pub document_id_params: DocumentIdParams,
    pub document_list_params: DocumentListParams,
    pub segment_list_params: SegmentListParams,
    pub update_target_params: UpdateTargetParams,
    pub confirm_segment_params: ConfirmSegmentParams,
    pub exact_lookup_params: ExactLookupParams,
    pub list_qa_params: ListQaParams,
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
    fn error_code_is_stable_snake_case() {
        assert_eq!(
            serde_json::to_string(&ErrorCode::UnsupportedDocument).expect("serialize"),
            "\"unsupported_document\""
        );
    }
}

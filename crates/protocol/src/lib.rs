use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use translunar_domain::{Document, Project, QaIssue, Segment, SegmentCounts, TmEntry};

pub const PROTOCOL_VERSION: u32 = 1;

pub mod methods {
    pub const INITIALIZE: &str = "engine.initialize";
    pub const PROJECT_CREATE: &str = "project.create";
    pub const PROJECT_GET: &str = "project.get";
    pub const DOCUMENT_IMPORT_DOCX: &str = "document.importDocx";
    pub const SEGMENT_LIST: &str = "segment.list";
    pub const SEGMENT_UPDATE_TARGET: &str = "segment.updateTarget";
    pub const SEGMENT_CONFIRM: &str = "segment.confirm";
    pub const TM_LOOKUP_EXACT: &str = "tm.lookupExact";
    pub const QA_RUN_DOCUMENT: &str = "qa.runDocument";
    pub const QA_LIST: &str = "qa.list";
    pub const DOCUMENT_EXPORT_DOCX: &str = "document.exportDocx";
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
pub struct ImportDocxParams {
    pub project_id: String,
    pub source_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DocumentIdParams {
    pub document_id: String,
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
pub struct ProjectSnapshot {
    pub project: Project,
    pub documents: Vec<Document>,
    pub counts: SegmentCounts,
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
}

#[derive(Debug, JsonSchema)]
#[allow(dead_code)]
pub struct ProtocolCatalog {
    pub methods: RpcMethodCatalog,
    pub initialize_params: InitializeParams,
    pub initialize_result: InitializeResult,
    pub create_project_params: CreateProjectParams,
    pub project_id_params: ProjectIdParams,
    pub import_docx_params: ImportDocxParams,
    pub document_id_params: DocumentIdParams,
    pub segment_list_params: SegmentListParams,
    pub update_target_params: UpdateTargetParams,
    pub confirm_segment_params: ConfirmSegmentParams,
    pub exact_lookup_params: ExactLookupParams,
    pub list_qa_params: ListQaParams,
    pub export_docx_params: ExportDocxParams,
    pub project_snapshot: ProjectSnapshot,
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

//! Wire protocol between the desktop shell and `tl-engine`.
//!
//! The protocol is split by domain: handshake, project, document, segment,
//! translation memory, QA, and AI. Each module owns its params/result pairs;
//! this crate root owns the envelope, the method registry, and the JSON-schema
//! catalog that feeds the TypeScript contracts package.

use schemars::JsonSchema;

mod envelope;
pub use envelope::*;
pub mod handshake;
pub use handshake::*;
pub mod project;
pub use project::*;
pub mod document;
pub use document::*;
pub mod segment;
pub use segment::*;
pub mod tm;
pub use tm::*;
pub mod qa;
pub use qa::*;
pub mod ai;
pub use ai::*;

pub const PROTOCOL_VERSION: u32 = 1;

pub mod methods {
    pub const ENGINE_INITIALIZE: &str = "engine.initialize";
    pub const ENGINE_SHUTDOWN: &str = "engine.shutdown";
    pub const PROJECT_CREATE: &str = "project.create";
    pub const PROJECT_LIST: &str = "project.list";
    pub const PROJECT_GET: &str = "project.get";
    pub const DOCUMENT_IMPORT: &str = "document.import";
    pub const DOCUMENT_LIST: &str = "document.list";
    pub const DOCUMENT_EXPORT: &str = "document.export";
    pub const SEGMENT_LIST: &str = "segment.list";
    pub const SEGMENT_UPDATE: &str = "segment.update";
    pub const SEGMENT_CONFIRM: &str = "segment.confirm";
    pub const TM_LOOKUP: &str = "tm.lookup";
    pub const QA_RUN: &str = "qa.run";
    pub const QA_LIST: &str = "qa.list";
    pub const AI_CONFIGURE: &str = "ai.configure";
    pub const AI_STATUS: &str = "ai.status";
    pub const AI_ASSIST: &str = "ai.assist";
    pub const AI_AGENT_RUN: &str = "ai.agent.run";
}

pub mod notifications {
    pub const ENGINE_READY: &str = "notify.engine.ready";
    pub const AGENT_STEP: &str = "notify.ai.agent.step";
}

/// A `{ params, result }` pair for one method. Only used for schema export.
#[derive(JsonSchema)]
pub struct MethodContract<Params, Result> {
    pub params: Params,
    pub result: Result,
}

/// Method-name-keyed catalog. Field renames must match [`methods`] constants;
/// the test below keeps them honest.
#[derive(JsonSchema)]
pub struct RpcMethodCatalog {
    #[serde(rename = "engine.initialize")]
    pub engine_initialize: MethodContract<InitializeParams, InitializeResult>,
    #[serde(rename = "engine.shutdown")]
    pub engine_shutdown: MethodContract<ProjectListParams, ShutdownResult>,
    #[serde(rename = "project.create")]
    pub project_create: MethodContract<ProjectCreateParams, tl_domain::Project>,
    #[serde(rename = "project.list")]
    pub project_list: MethodContract<ProjectListParams, ProjectListResult>,
    #[serde(rename = "project.get")]
    pub project_get: MethodContract<ProjectGetParams, tl_domain::Project>,
    #[serde(rename = "document.import")]
    pub document_import: MethodContract<DocumentImportParams, DocumentImportResult>,
    #[serde(rename = "document.list")]
    pub document_list: MethodContract<DocumentListParams, DocumentListResult>,
    #[serde(rename = "document.export")]
    pub document_export: MethodContract<DocumentExportParams, DocumentExportResult>,
    #[serde(rename = "segment.list")]
    pub segment_list: MethodContract<SegmentListParams, SegmentListResult>,
    #[serde(rename = "segment.update")]
    pub segment_update: MethodContract<SegmentUpdateParams, SegmentUpdateResult>,
    #[serde(rename = "segment.confirm")]
    pub segment_confirm: MethodContract<SegmentConfirmParams, SegmentConfirmResult>,
    #[serde(rename = "tm.lookup")]
    pub tm_lookup: MethodContract<TmLookupParams, TmLookupResult>,
    #[serde(rename = "qa.run")]
    pub qa_run: MethodContract<QaRunParams, QaRunResult>,
    #[serde(rename = "qa.list")]
    pub qa_list: MethodContract<QaListParams, QaListResult>,
    #[serde(rename = "ai.configure")]
    pub ai_configure: MethodContract<AiConfigureParams, AiStatusResult>,
    #[serde(rename = "ai.status")]
    pub ai_status: MethodContract<AiStatusParams, AiStatusResult>,
    #[serde(rename = "ai.assist")]
    pub ai_assist: MethodContract<AiAssistParams, AiAssistResult>,
    #[serde(rename = "ai.agent.run")]
    pub ai_agent_run: MethodContract<AgentRunParams, AgentRunResult>,
}

/// Notification-name-keyed catalog for the reserved notification frames.
#[derive(JsonSchema)]
pub struct NotificationCatalog {
    #[serde(rename = "notify.engine.ready")]
    pub engine_ready: EngineReadyNotification,
    #[serde(rename = "notify.ai.agent.step")]
    pub agent_step: AgentStepNotification,
}

/// Root schema exported for the TypeScript contracts package.
#[derive(JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProtocolCatalog {
    pub request: RpcRequest,
    pub frame: EngineFrame,
    pub methods: RpcMethodCatalog,
    pub notifications: NotificationCatalog,
}

#[cfg(test)]
mod tests {
    use super::*;
    use schemars::schema_for;

    #[test]
    fn catalog_keys_match_method_constants() {
        let schema = schema_for!(RpcMethodCatalog);
        let value = serde_json::to_value(&schema).expect("schema to value");
        let properties = value["properties"].as_object().expect("properties");
        let expected = [
            methods::ENGINE_INITIALIZE,
            methods::ENGINE_SHUTDOWN,
            methods::PROJECT_CREATE,
            methods::PROJECT_LIST,
            methods::PROJECT_GET,
            methods::DOCUMENT_IMPORT,
            methods::DOCUMENT_LIST,
            methods::DOCUMENT_EXPORT,
            methods::SEGMENT_LIST,
            methods::SEGMENT_UPDATE,
            methods::SEGMENT_CONFIRM,
            methods::TM_LOOKUP,
            methods::QA_RUN,
            methods::QA_LIST,
            methods::AI_CONFIGURE,
            methods::AI_STATUS,
            methods::AI_ASSIST,
            methods::AI_AGENT_RUN,
        ];
        assert_eq!(properties.len(), expected.len());
        for method in expected {
            assert!(
                properties.contains_key(method),
                "missing catalog key {method}"
            );
        }
    }

    #[test]
    fn notification_keys_match_constants() {
        let schema = schema_for!(NotificationCatalog);
        let value = serde_json::to_value(&schema).expect("schema to value");
        let properties = value["properties"].as_object().expect("properties");
        assert!(properties.contains_key(notifications::ENGINE_READY));
        assert!(properties.contains_key(notifications::AGENT_STEP));
    }
}

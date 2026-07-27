use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
pub use translunar_ai_core::{
    AiAction, AiBatchItem, AiBatchRun, AiConversation, AiConversationMessage, AiCredentialStatus,
    AiProviderDescriptor, AiProviderKind, AiProviderProtocol, AiRun, AiRunEvent, AiSettings,
    AiUsageAggregate, AiUsageDimension, AiUsageRecord, EngineConnectorOperation,
    EngineConnectorSource, GroundingOptions, PromptBundle,
};
pub use translunar_plugin_runtime::EngineConnectorConfigSchemaV1;

#[derive(Debug, Clone, Default, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AiProviderCatalogParams {}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AiProviderCatalogResult {
    pub items: Vec<AiConnectorCatalogItem>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum AiConnectorAvailability {
    Available,
    Unavailable,
    Degraded,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AiConnectorCatalogItem {
    pub id: String,
    pub source: EngineConnectorSource,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<AiProviderKind>,
    pub display_name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub protocol: Option<AiProviderProtocol>,
    pub config_schema_version: u32,
    pub operations: Vec<EngineConnectorOperation>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub config_schema: Option<EngineConnectorConfigSchemaV1>,
    pub default_base_url: String,
    pub default_model: String,
    pub supports_streaming: bool,
    pub reports_usage: bool,
    pub credential_hint: String,
    pub availability: AiConnectorAvailability,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub safe_failure: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AiProviderListParams {
    #[serde(default)]
    pub offset: u32,
    #[serde(default = "default_page_limit")]
    pub limit: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AiProviderPage {
    pub items: Vec<AiProviderProfile>,
    pub total: u32,
    pub offset: u32,
    pub limit: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AiProviderProfile {
    pub id: String,
    pub name: String,
    pub source: EngineConnectorSource,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<AiProviderKind>,
    pub base_url: String,
    pub model: String,
    pub timeout_ms: u32,
    pub max_response_bytes: u32,
    pub enabled: bool,
    pub credential_present: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub config_schema_version: Option<u32>,
    #[serde(default)]
    pub configuration: serde_json::Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub descriptor_hash: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub config_hash: Option<String>,
    pub availability: AiConnectorAvailability,
    pub revision: u64,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AiProviderCreateParams {
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<AiProviderKind>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<EngineConnectorSource>,
    pub base_url: String,
    pub model: String,
    #[serde(default = "default_timeout_ms")]
    pub timeout_ms: u32,
    #[serde(default = "default_response_bytes")]
    pub max_response_bytes: u32,
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub config_schema_version: Option<u32>,
    #[serde(default)]
    pub configuration: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AiProviderUpdateParams {
    pub profile_id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<AiProviderKind>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<EngineConnectorSource>,
    pub base_url: String,
    pub model: String,
    pub timeout_ms: u32,
    pub max_response_bytes: u32,
    pub enabled: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub config_schema_version: Option<u32>,
    #[serde(default)]
    pub configuration: serde_json::Value,
    pub expected_revision: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AiProfileRevisionParams {
    pub profile_id: String,
    pub expected_revision: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AiProfileIdParams {
    pub profile_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SetAiCredentialParams {
    pub profile_id: String,
    pub secret: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AiProviderTestResult {
    pub run: AiRun,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AiSettingsGetParams {}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AiSettingsUpdateParams {
    pub enabled: bool,
    pub default_profile_id: Option<String>,
    pub monthly_token_budget: Option<u64>,
    pub allow_interactive: bool,
    pub allow_batch: bool,
    #[serde(default)]
    pub allowed_origins: Vec<String>,
    pub expected_revision: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AiGroundingPreviewParams {
    pub project_id: String,
    pub segment_id: String,
    pub expected_revision: u64,
    pub action: AiAction,
    #[serde(default)]
    pub prompt: String,
    #[serde(default)]
    pub options: GroundingOptions,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AiGroundingPreviewResult {
    pub segment_id: String,
    pub segment_revision: u64,
    pub bundle: PromptBundle,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AiRunStartParams {
    pub project_id: String,
    pub segment_id: String,
    pub profile_id: String,
    pub expected_revision: u64,
    pub action: AiAction,
    #[serde(default)]
    pub prompt: String,
    #[serde(default)]
    pub options: GroundingOptions,
    pub conversation_id: Option<String>,
    #[serde(default = "default_max_attempts")]
    pub max_attempts: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AiRunIdParams {
    pub run_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AiRunRevisionParams {
    pub run_id: String,
    pub expected_revision: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AiRunListParams {
    pub project_id: Option<String>,
    #[serde(default)]
    pub offset: u32,
    #[serde(default = "default_page_limit")]
    pub limit: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AiRunPage {
    pub items: Vec<AiRun>,
    pub total: u32,
    pub offset: u32,
    pub limit: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AiRunEventsParams {
    pub run_id: String,
    #[serde(default)]
    pub after_sequence: u64,
    #[serde(default = "default_event_limit")]
    pub limit: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AiRunEventPage {
    pub items: Vec<AiRunEvent>,
    pub after_sequence: u64,
    pub last_sequence: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AiResultApplyParams {
    pub run_id: String,
    pub expected_run_revision: u64,
    pub expected_segment_revision: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AiBatchStartParams {
    pub project_id: String,
    pub document_id: Option<String>,
    pub profile_id: String,
    #[serde(default = "default_tm_threshold")]
    pub tm_threshold: u8,
    #[serde(default = "default_concurrency")]
    pub concurrency: u8,
    #[serde(default = "default_requests_per_minute")]
    pub requests_per_minute: u16,
    #[serde(default = "default_batch_attempts")]
    pub max_attempts: u8,
    #[serde(default)]
    pub replace_drafts: bool,
    #[serde(default)]
    pub options: GroundingOptions,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AiBatchIdParams {
    pub batch_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AiBatchRevisionParams {
    pub batch_id: String,
    pub expected_revision: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AiBatchListParams {
    pub project_id: String,
    #[serde(default)]
    pub offset: u32,
    #[serde(default = "default_page_limit")]
    pub limit: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AiBatchPage {
    pub items: Vec<AiBatchRun>,
    pub total: u32,
    pub offset: u32,
    pub limit: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AiBatchItemsParams {
    pub batch_id: String,
    #[serde(default)]
    pub offset: u32,
    #[serde(default = "default_event_limit")]
    pub limit: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AiBatchItemPage {
    pub items: Vec<AiBatchItem>,
    pub total: u32,
    pub offset: u32,
    pub limit: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AiUsageQueryParams {
    pub project_id: Option<String>,
    pub since_ms: i64,
    pub until_ms: i64,
    pub dimension: AiUsageDimension,
    #[serde(default)]
    pub offset: u32,
    #[serde(default = "default_event_limit")]
    pub limit: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AiUsageQueryResult {
    pub records: Vec<AiUsageRecord>,
    pub aggregates: Vec<AiUsageAggregate>,
    pub total: u32,
    pub offset: u32,
    pub limit: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AiConversationListParams {
    pub project_id: String,
    #[serde(default)]
    pub include_archived: bool,
    #[serde(default)]
    pub offset: u32,
    #[serde(default = "default_page_limit")]
    pub limit: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AiConversationPage {
    pub items: Vec<AiConversation>,
    pub total: u32,
    pub offset: u32,
    pub limit: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AiConversationCreateParams {
    pub project_id: String,
    pub title: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AiConversationUpdateParams {
    pub conversation_id: String,
    pub title: String,
    pub archived: bool,
    pub expected_revision: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AiConversationMessagesParams {
    pub conversation_id: String,
    #[serde(default)]
    pub offset: u32,
    #[serde(default = "default_event_limit")]
    pub limit: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AiConversationMessagePage {
    pub items: Vec<AiConversationMessage>,
    pub total: u32,
    pub offset: u32,
    pub limit: u32,
}

const fn default_page_limit() -> u32 {
    50
}

const fn default_event_limit() -> u32 {
    200
}

const fn default_timeout_ms() -> u32 {
    60_000
}

const fn default_response_bytes() -> u32 {
    4 * 1024 * 1024
}

const fn default_true() -> bool {
    true
}

const fn default_max_attempts() -> u32 {
    3
}

const fn default_tm_threshold() -> u8 {
    90
}

const fn default_concurrency() -> u8 {
    2
}

const fn default_requests_per_minute() -> u16 {
    60
}

const fn default_batch_attempts() -> u8 {
    3
}

#[cfg(test)]
mod tests {
    use serde_json::json;
    use translunar_ai_core::PluginConnectorOwner;

    use super::*;

    fn catalog_item(source: EngineConnectorSource) -> AiConnectorCatalogItem {
        let kind = match &source {
            EngineConnectorSource::Builtin { provider } => Some(*provider),
            EngineConnectorSource::Plugin { .. } => None,
        };
        AiConnectorCatalogItem {
            id: source.connector_id().to_string(),
            source,
            kind,
            display_name: "Fixture".to_string(),
            protocol: None,
            config_schema_version: 1,
            operations: vec![
                EngineConnectorOperation::ValidateConfig,
                EngineConnectorOperation::Test,
                EngineConnectorOperation::ModelsList,
                EngineConnectorOperation::Generate,
            ],
            config_schema: None,
            default_base_url: String::new(),
            default_model: "fixture".to_string(),
            supports_streaming: true,
            reports_usage: true,
            credential_hint: "API key".to_string(),
            availability: AiConnectorAvailability::Available,
            safe_failure: None,
        }
    }

    #[test]
    fn connector_catalog_preserves_builtin_kind_without_fabricating_plugin_kind() {
        let builtin = serde_json::to_value(catalog_item(EngineConnectorSource::Builtin {
            provider: AiProviderKind::Openai,
        }))
        .expect("serialize built-in connector");
        assert_eq!(builtin["kind"], json!("openai"));
        assert_eq!(
            builtin["source"],
            json!({ "kind": "builtin", "provider": "openai" })
        );
        assert_eq!(builtin["operations"][2], json!("models.list"));

        let plugin = serde_json::to_value(catalog_item(EngineConnectorSource::Plugin {
            owner: PluginConnectorOwner {
                plugin_id: "org.example.connector".to_string(),
                version_id: "version-1".to_string(),
            },
            contribution_id: "fixture".to_string(),
            contract_version: 1,
        }))
        .expect("serialize plugin connector");
        assert!(plugin.get("kind").is_none());
        assert_eq!(plugin["source"]["kind"], json!("plugin"));
        assert_eq!(plugin["source"]["contributionId"], json!("fixture"));
    }
}

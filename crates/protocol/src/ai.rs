use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
pub use translunar_ai_core::{
    AiAction, AiBatchItem, AiBatchRun, AiConversation, AiConversationMessage, AiCredentialStatus,
    AiProviderDescriptor, AiProviderKind, AiProviderProfile, AiRun, AiRunEvent, AiSettings,
    AiUsageAggregate, AiUsageDimension, AiUsageRecord, GroundingOptions, PromptBundle,
};

#[derive(Debug, Clone, Default, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AiProviderCatalogParams {}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AiProviderCatalogResult {
    pub items: Vec<AiProviderDescriptor>,
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

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AiProviderCreateParams {
    pub name: String,
    pub kind: AiProviderKind,
    pub base_url: String,
    pub model: String,
    #[serde(default = "default_timeout_ms")]
    pub timeout_ms: u32,
    #[serde(default = "default_response_bytes")]
    pub max_response_bytes: u32,
    #[serde(default = "default_true")]
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AiProviderUpdateParams {
    pub profile_id: String,
    pub name: String,
    pub kind: AiProviderKind,
    pub base_url: String,
    pub model: String,
    pub timeout_ms: u32,
    pub max_response_bytes: u32,
    pub enabled: bool,
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

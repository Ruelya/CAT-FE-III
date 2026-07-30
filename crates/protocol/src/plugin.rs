//! Wire contracts for local plugin lifecycle and contribution discovery.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use translunar_filter_core::FilterDescriptor;
pub use translunar_plugin_runtime::{
    AiActionContributionDescriptor, AiActionInvocationV1, AiActionResultV1,
    DeclarativeEngineConnectorDefinitionV1, DeclarativeFilterDefinitionV1,
    DeclarativePipelineDefinitionV1, DeclarativeQaPackDefinitionV1, EngineConnectorLimitsV1,
    FilterContributionDescriptor, PluginCapabilityAuditEvent, PluginCapabilityDecision,
    PluginCapabilityId, PluginCapabilityRequest, PluginCapabilityScope,
    PluginContributionDescriptor, PluginFileArea, UiPanelContributionDescriptor,
};

use crate::{default_actor, default_page_size};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum PluginTier {
    Declarative,
    Sandbox,
    Process,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum PluginStatus {
    Installed,
    Enabled,
    Disabled,
    Degraded,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PluginApiRange {
    pub min: u32,
    pub max: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum PluginDeclarativeEntry {
    Manifest,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum PluginSandboxEntry {
    Javascript {
        path: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        export_name: Option<String>,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum PluginProcessEntry {
    Node { path: String },
    Executable { path: String },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(
    tag = "tier",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum PluginRuntimeDescriptor {
    Declarative {
        runtime_version: u32,
        entry: PluginDeclarativeEntry,
    },
    Sandbox {
        runtime_version: u32,
        entry: PluginSandboxEntry,
    },
    Process {
        runtime_version: u32,
        protocol_version: u32,
        entry: PluginProcessEntry,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormalizedPluginManifest {
    pub normalized_version: u32,
    pub source_manifest_version: u32,
    pub id: String,
    pub display_name: String,
    pub version: String,
    pub host_api: PluginApiRange,
    pub runtime: PluginRuntimeDescriptor,
    pub contributions: Vec<PluginContributionDescriptor>,
    pub requested_permissions: Vec<String>,
    #[serde(default)]
    pub requested_capabilities: Vec<PluginCapabilityRequest>,
    pub original_manifest_json: Value,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum PluginDiagnosticSeverity {
    Info,
    Warning,
    Error,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PluginDiagnostic {
    pub code: String,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub severity: Option<PluginDiagnosticSeverity>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub phase: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PluginCompatibility {
    pub compatible: bool,
    pub host_api_supported: bool,
    pub runtime_supported: bool,
    pub contributions_supported: bool,
    #[serde(default)]
    pub unsupported_capabilities: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PluginListParams {
    #[serde(default = "default_page_size")]
    pub limit: u32,
    #[serde(default)]
    pub offset: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PluginIdParams {
    pub plugin_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PluginInspectParams {
    pub source_path: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PluginInstallParams {
    pub source_path: String,
    #[serde(default)]
    pub grant_requested: bool,
    #[serde(default = "default_actor")]
    pub actor: String,
    #[serde(default = "default_install_reason")]
    pub reason: String,
}

fn default_install_reason() -> String {
    "install plugin".to_string()
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PluginMutationParams {
    pub plugin_id: String,
    #[serde(default)]
    pub expected_revision: Option<u64>,
    #[serde(default = "default_actor")]
    pub actor: String,
    #[serde(default = "default_mutation_reason")]
    pub reason: String,
}

fn default_mutation_reason() -> String {
    "mutate plugin".to_string()
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PluginVersionListParams {
    pub plugin_id: String,
    #[serde(default)]
    pub offset: u32,
    #[serde(default = "default_page_size")]
    pub limit: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PluginUpgradeParams {
    pub plugin_id: String,
    pub source_path: String,
    pub expected_revision: u64,
    pub actor: String,
    pub reason: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PluginRollbackParams {
    pub plugin_id: String,
    pub version_id: String,
    pub expected_revision: u64,
    pub actor: String,
    pub reason: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PluginInspection {
    pub normalized_manifest: NormalizedPluginManifest,
    pub package_sha256: String,
    pub compatibility: PluginCompatibility,
    pub diagnostics: Vec<PluginDiagnostic>,
    pub can_install: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PluginSummary {
    pub id: String,
    pub display_name: String,
    pub version: String,
    pub tier: PluginTier,
    pub status: PluginStatus,
    pub package_path: String,
    pub revision: u64,
    pub requested_permissions: Vec<String>,
    pub granted_permissions: Vec<String>,
    pub filters: Vec<FilterDescriptor>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub active_version_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub package_sha256: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub runtime: Option<PluginRuntimeDescriptor>,
    #[serde(default)]
    pub contributions: Vec<PluginContributionDescriptor>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub compatibility: Option<PluginCompatibility>,
    #[serde(default)]
    pub diagnostics: Vec<PluginDiagnostic>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_error: Option<String>,
    pub crash_count: u32,
    pub installed_at_ms: i64,
    pub updated_at_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PluginContributionOwner {
    pub plugin_id: String,
    pub version_id: String,
    pub activation_revision: u64,
    pub contribution_id: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum PluginContributionState {
    Active,
    Detached,
    Degraded,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PluginUiPanelView {
    pub owner: PluginContributionOwner,
    pub descriptor: UiPanelContributionDescriptor,
    pub state: PluginContributionState,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_failure_code: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PluginAiActionInvokeResult {
    pub owner: PluginContributionOwner,
    pub descriptor: AiActionContributionDescriptor,
    pub result: AiActionResultV1,
    pub canonical_sha256: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PluginAiActionInvokeParams {
    pub invocation: AiActionInvocationV1,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PluginAiActionCancelParams {
    pub invocation_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PluginAiActionCancelResult {
    pub cancelled: bool,
    pub invocation_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PluginUiPanelBridgeCallParams {
    pub owner: PluginContributionOwner,
    pub method: String,
    #[serde(default)]
    pub params: Value,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PluginUiPanelBridgeCallResult {
    pub owner: PluginContributionOwner,
    pub method: String,
    pub result: Value,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum PluginAiActionHistoryStatus {
    Succeeded,
    Failed,
    Cancelled,
    Timeout,
    StaleActivation,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PluginAiActionHistoryUsage {
    pub input_bytes: u64,
    pub output_bytes: u64,
    pub duration_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PluginAiActionHistoryEntry {
    pub invocation_id: String,
    pub owner: PluginContributionOwner,
    pub contribution_version: String,
    pub status: PluginAiActionHistoryStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub failure_code: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub canonical_sha256: Option<String>,
    pub usage: PluginAiActionHistoryUsage,
    pub created_at_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PluginAiActionHistoryListParams {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub plugin_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub contribution_id: Option<String>,
    #[serde(default)]
    pub offset: u32,
    #[serde(default = "default_page_size")]
    pub limit: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PluginAiActionHistoryPage {
    pub items: Vec<PluginAiActionHistoryEntry>,
    pub total: u32,
    pub offset: u32,
    pub limit: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PluginAiActionView {
    pub owner: PluginContributionOwner,
    pub descriptor: AiActionContributionDescriptor,
    pub state: PluginContributionState,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_failure_code: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PluginAiActionPage {
    pub items: Vec<PluginAiActionView>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PluginUiPanelPage {
    pub items: Vec<PluginUiPanelView>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PluginPage {
    pub items: Vec<PluginSummary>,
    pub total: u32,
    pub offset: u32,
    pub limit: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PluginMutationResult {
    pub plugin: PluginSummary,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum PluginVersionState {
    Validated,
    Failed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PluginVersionSummary {
    pub id: String,
    pub plugin_id: String,
    pub version: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub package_sha256: Option<String>,
    pub package_path: String,
    pub tier: PluginTier,
    pub runtime: PluginRuntimeDescriptor,
    pub contribution_count: u32,
    pub state: PluginVersionState,
    pub compatibility: PluginCompatibility,
    pub diagnostics: Vec<PluginDiagnostic>,
    pub installed_at_ms: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub activated_at_ms: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub deactivated_at_ms: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub failed_at_ms: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PluginVersionPage {
    pub items: Vec<PluginVersionSummary>,
    pub total: u32,
    pub offset: u32,
    pub limit: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum PluginLifecycleAction {
    Upgraded,
    RolledBack,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PluginLifecycleResult {
    pub plugin: PluginSummary,
    pub active_version_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub previous_version_id: Option<String>,
    pub action: PluginLifecycleAction,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum PluginCapabilityRisk {
    Low,
    Medium,
    High,
    Critical,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PluginCapabilityRequestListParams {
    pub plugin_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version_id: Option<String>,
    #[serde(default)]
    pub offset: u32,
    #[serde(default = "default_page_size")]
    pub limit: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PluginCapabilityReviewParams {
    pub plugin_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PluginCapabilityGrantParams {
    pub plugin_id: String,
    pub request_id: String,
    pub expected_revision: u64,
    pub scope: PluginCapabilityScope,
    pub actor: String,
    pub reason: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PluginCapabilityDecisionParams {
    pub plugin_id: String,
    pub request_id: String,
    pub expected_revision: u64,
    pub actor: String,
    pub reason: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PluginCapabilityAuditListParams {
    pub plugin_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub request_id: Option<String>,
    #[serde(default)]
    pub offset: u32,
    #[serde(default = "default_page_size")]
    pub limit: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PluginCapabilityRequestView {
    pub id: String,
    pub plugin_id: String,
    pub version_id: String,
    pub capability_id: PluginCapabilityId,
    pub supported: bool,
    pub required: bool,
    pub requested_scope: PluginCapabilityScope,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub granted_scope: Option<PluginCapabilityScope>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub contribution_id: Option<String>,
    pub decision: PluginCapabilityDecision,
    pub risk: PluginCapabilityRisk,
    pub effect_key: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub carried_from_request_id: Option<String>,
    pub actor: String,
    pub reason: String,
    pub revision: u64,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub decided_at_ms: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PluginCapabilityRequestPage {
    pub items: Vec<PluginCapabilityRequestView>,
    pub total: u32,
    pub offset: u32,
    pub limit: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum PluginCapabilityChangeKind {
    Added,
    Expanded,
    Narrowed,
    Unchanged,
    Removed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PluginCapabilityChange {
    pub capability_id: PluginCapabilityId,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub contribution_id: Option<String>,
    pub kind: PluginCapabilityChangeKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub previous_scope: Option<PluginCapabilityScope>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub requested_scope: Option<PluginCapabilityScope>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PluginCapabilityReview {
    pub plugin: PluginSummary,
    pub version_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub previous_version_id: Option<String>,
    pub requests: Vec<PluginCapabilityRequestView>,
    pub changes: Vec<PluginCapabilityChange>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PluginCapabilityDecisionResult {
    pub request: PluginCapabilityRequestView,
    pub plugin: PluginSummary,
    pub detached: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PluginCapabilityAuditEntry {
    pub sequence: u64,
    pub id: String,
    pub plugin_id: String,
    pub version_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub request_id: Option<String>,
    pub capability_id: PluginCapabilityId,
    pub scope: PluginCapabilityScope,
    pub event: PluginCapabilityAuditEvent,
    pub outcome: String,
    pub operation: String,
    pub actor: String,
    pub reason: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub request_revision: Option<u64>,
    pub created_at_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PluginCapabilityAuditPage {
    pub items: Vec<PluginCapabilityAuditEntry>,
    pub total: u32,
    pub offset: u32,
    pub limit: u32,
}

#[cfg(test)]
mod tests {
    use serde_json::json;
    use translunar_filter_core::FilterCapabilities;

    use super::*;

    fn capabilities() -> FilterCapabilities {
        FilterCapabilities {
            import: true,
            export: true,
            validate: true,
            inline_tags: false,
            notes: false,
            degradation_report: true,
        }
    }

    #[test]
    fn runtime_and_contribution_unions_use_camel_case_discriminators() {
        let runtime = PluginRuntimeDescriptor::Sandbox {
            runtime_version: 1,
            entry: PluginSandboxEntry::Javascript {
                path: "dist/plugin.mjs".to_string(),
                export_name: Some("activate".to_string()),
            },
        };
        assert_eq!(
            serde_json::to_value(runtime).expect("serialize sandbox runtime"),
            json!({
                "tier": "sandbox",
                "runtimeVersion": 1,
                "entry": {
                    "kind": "javascript",
                    "path": "dist/plugin.mjs",
                    "exportName": "activate"
                }
            })
        );

        let contribution = PluginContributionDescriptor::Filter(FilterContributionDescriptor {
            descriptor_version: 1,
            id: "example.filter".to_string(),
            version: "1.0.0".to_string(),
            display_name: "Example".to_string(),
            extensions: vec!["srt".to_string()],
            capabilities: capabilities(),
            declarative: None,
        });
        let serialized = serde_json::to_value(contribution).expect("serialize contribution");
        assert_eq!(serialized["kind"], "filter");
        assert_eq!(serialized["descriptorVersion"], 1);
        assert_eq!(serialized["displayName"], "Example");
    }

    #[test]
    fn required_lifecycle_revisions_and_exact_request_casing_are_stable() {
        let upgrade: PluginUpgradeParams = serde_json::from_value(json!({
            "pluginId": "example.filter",
            "sourcePath": "candidate",
            "expectedRevision": 7,
            "actor": "tester",
            "reason": "upgrade"
        }))
        .expect("deserialize upgrade request");
        assert_eq!(upgrade.expected_revision, 7);

        assert!(
            serde_json::from_value::<PluginRollbackParams>(json!({
                "pluginId": "example.filter",
                "versionId": "version-1",
                "actor": "tester",
                "reason": "rollback"
            }))
            .is_err(),
            "expectedRevision is required"
        );
    }

    #[test]
    fn legacy_plugin_summary_payload_defaults_new_projections() {
        let legacy: PluginSummary = serde_json::from_value(json!({
            "id": "example.filter",
            "displayName": "Example",
            "version": "1.0.0",
            "tier": "process",
            "status": "installed",
            "packagePath": "plugins/example.filter",
            "revision": 1,
            "requestedPermissions": [],
            "grantedPermissions": [],
            "filters": [],
            "crashCount": 0,
            "installedAtMs": 1,
            "updatedAtMs": 1
        }))
        .expect("deserialize legacy summary");
        assert!(legacy.active_version_id.is_none());
        assert!(legacy.package_sha256.is_none());
        assert!(legacy.runtime.is_none());
        assert!(legacy.contributions.is_empty());
        assert!(legacy.compatibility.is_none());
        assert!(legacy.diagnostics.is_empty());
    }
}

// --- External system connector (P-08) -----------------------------------------

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ExternalConnectorCatalogEntry {
    pub owner: PluginContributionOwner,
    pub contract_version: u32,
    pub operations: Vec<String>,
    pub origins: Vec<String>,
    pub credential_slots: Vec<String>,
    pub config_schema_version: u32,
    pub checkpoint_schema_version: u32,
    pub display_name: String,
    pub state: PluginContributionState,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ExternalConnectorCatalogPage {
    pub items: Vec<ExternalConnectorCatalogEntry>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExternalConnectorProfileCreateParams {
    pub contribution_id: String,
    pub display_name: String,
    pub configuration: Value,
    #[serde(default = "default_true")]
    pub enabled: bool,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExternalConnectorProfileUpdateParams {
    pub profile_id: String,
    pub display_name: String,
    pub configuration: Value,
    pub enabled: bool,
    pub expected_revision: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExternalConnectorProfileIdParams {
    pub profile_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExternalConnectorProfileRevisionParams {
    pub profile_id: String,
    pub expected_revision: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExternalConnectorProfileListParams {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub contribution_id: Option<String>,
    #[serde(default)]
    pub offset: u32,
    #[serde(default = "default_page_size")]
    pub limit: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ExternalConnectorCredentialSlotStatus {
    pub slot_id: String,
    pub present: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ExternalConnectorProfile {
    pub id: String,
    pub display_name: String,
    pub contribution_id: String,
    pub plugin_id: String,
    pub version_id: String,
    pub activation_revision: u64,
    pub contract_version: u32,
    pub config_schema_version: u32,
    pub checkpoint_schema_version: u32,
    pub configuration: Value,
    pub enabled: bool,
    pub credential_slots: Vec<ExternalConnectorCredentialSlotStatus>,
    pub origins: Vec<String>,
    pub operations: Vec<String>,
    pub revision: u64,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ExternalConnectorProfilePage {
    pub items: Vec<ExternalConnectorProfile>,
    pub total: u32,
    pub offset: u32,
    pub limit: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExternalConnectorCredentialSetParams {
    pub profile_id: String,
    pub slot_id: String,
    pub secret: String,
    pub expected_revision: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExternalConnectorCredentialDeleteParams {
    pub profile_id: String,
    pub slot_id: String,
    pub expected_revision: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExternalConnectorCredentialStatusParams {
    pub profile_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ExternalConnectorCredentialStatus {
    pub profile_id: String,
    pub slots: Vec<ExternalConnectorCredentialSlotStatus>,
    pub revision: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExternalConnectorInvokeParams {
    pub profile_id: String,
    pub request: Value,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ExternalConnectorInvokeResult {
    pub profile_id: String,
    pub request_id: String,
    pub operation: String,
    pub result: Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub checkpoint_revision: Option<u64>,
    pub replayed: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExternalConnectorCheckpointGetParams {
    pub profile_id: String,
    pub stream_id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ExternalConnectorCheckpointView {
    pub profile_id: String,
    pub stream_id: String,
    pub schema_version: u32,
    pub revision: u64,
    pub payload: Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cursor: Option<String>,
    pub payload_hash: String,
    pub plugin_id: String,
    pub version_id: String,
    pub contribution_id: String,
    pub activation_revision: u64,
    pub created_at_ms: i64,
}

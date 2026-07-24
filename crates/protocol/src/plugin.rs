//! Wire contracts for local plugin lifecycle and contribution discovery.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use translunar_filter_core::FilterDescriptor;

use crate::{default_actor, default_page_size};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum PluginTier {
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
    pub last_error: Option<String>,
    pub crash_count: u32,
    pub installed_at_ms: i64,
    pub updated_at_ms: i64,
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

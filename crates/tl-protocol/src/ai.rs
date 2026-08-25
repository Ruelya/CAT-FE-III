//! AI domain: assisted drafting and the autonomous agent skeleton.
//!
//! Both surfaces degrade honestly: when no provider is configured the engine
//! answers with the `aiNotConfigured` error code instead of fabricating output.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
pub use tl_ai::AiProviderKind;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AiConfigureParams {
    pub provider: AiProviderKind,
    pub model: String,
    /// Overrides the provider's default base URL. Required for
    /// `openaiCompatible`, optional otherwise.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base_url: Option<String>,
    /// Held in engine memory only; never persisted to disk.
    pub api_key: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AiStatusParams {}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AiStatusResult {
    pub configured: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provider: Option<AiProviderKind>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum AiAssistAction {
    /// Draft a translation for the segment source.
    Translate,
    /// Improve the segment's current target.
    Refine,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AiAssistParams {
    pub segment_id: String,
    pub action: AiAssistAction,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub instruction: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AiAssistResult {
    pub draft_target: String,
    pub provider: AiProviderKind,
    pub model: String,
    pub elapsed_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AgentRunParams {
    pub document_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub instruction: Option<String>,
    /// Upper bound on segments the agent may translate in one run.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_segments: Option<u32>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum AgentStepKind {
    Plan,
    Translate,
    Qa,
    Summary,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum AgentStepStatus {
    Done,
    Failed,
    Skipped,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AgentStep {
    pub index: u32,
    pub kind: AgentStepKind,
    pub status: AgentStepStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub segment_id: Option<String>,
    pub detail: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum AgentRunStatus {
    Completed,
    CompletedWithIssues,
    Failed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AgentRunResult {
    pub run_id: String,
    pub document_id: String,
    pub status: AgentRunStatus,
    pub steps: Vec<AgentStep>,
    pub translated_segments: u32,
    pub failed_segments: u32,
    pub open_qa_issues: u32,
}

/// Payload for the reserved `notify.ai.agent.step` frame emitted while a run
/// is in flight.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AgentStepNotification {
    pub run_id: String,
    pub document_id: String,
    pub step: AgentStep,
}

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

/// Placeholder integrity verdict for an AI proposal. When `ok` is false the
/// proposal must not be applied to the segment.
pub use tl_ai::TagIntegrityReport as AiTagCheck;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AiAssistResult {
    pub draft_target: String,
    pub provider: AiProviderKind,
    pub model: String,
    pub elapsed_ms: u64,
    /// Placeholder/tag integrity of the draft against the segment source.
    pub tag_check: AiTagCheck,
}

/// Lifecycle of one asynchronous assist request. `ai.assist.start` validates
/// and returns immediately; the provider call runs off the RPC thread and the
/// client polls `ai.assist.status` until the run turns terminal. Assist never
/// writes to the segment: a `done` run only carries a proposal for a human.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum AiAssistRunStatus {
    Running,
    /// The provider answered; `result` carries the proposal and tag verdict.
    Done,
    /// The provider call failed; `errorMessage` says why. Never fabricated.
    Failed,
    /// Cancellation was requested and honored; any late result is discarded.
    Canceled,
}

impl AiAssistRunStatus {
    pub fn is_terminal(self) -> bool {
        !matches!(self, Self::Running)
    }
}

/// The observable state of one assist request.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AiAssistRunView {
    pub assist_id: String,
    pub segment_id: String,
    pub action: AiAssistAction,
    pub status: AiAssistRunStatus,
    pub cancel_requested: bool,
    /// Present exactly when `status` is `done`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub result: Option<AiAssistResult>,
    /// Present exactly when `status` is `failed`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error_message: Option<String>,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AiAssistStatusParams {
    pub assist_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AiAssistCancelParams {
    pub assist_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AgentStartParams {
    pub document_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub instruction: Option<String>,
    /// Upper bound on segments the agent may touch in one run.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_segments: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AgentStatusParams {
    pub run_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AgentCancelParams {
    pub run_id: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum AgentStepKind {
    Plan,
    /// Exact TM reuse during pretranslation.
    Tm,
    /// AI drafting for a TM miss.
    Translate,
    Qa,
    Summary,
    Cancel,
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

/// Lifecycle of an agent run. The run never confirms segments, never signs
/// off, and never exports: it always parks at `awaitingReview` for a human.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum AgentRunStatus {
    Running,
    /// Terminal human gate: drafts are in the grid, a person decides what
    /// gets confirmed or exported.
    AwaitingReview,
    Canceled,
    Failed,
}

impl AgentRunStatus {
    pub fn is_terminal(self) -> bool {
        !matches!(self, Self::Running)
    }
}

/// The observable task order for one agent run.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AgentRunView {
    pub run_id: String,
    pub document_id: String,
    pub status: AgentRunStatus,
    pub cancel_requested: bool,
    /// Untranslated segments claimed by this run at start time.
    pub planned_segments: u32,
    pub tm_applied: u32,
    pub ai_drafted: u32,
    pub failed_segments: u32,
    pub open_qa_issues: u32,
    pub steps: Vec<AgentStep>,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}

/// Payload for the reserved `notify.ai.agent.step` frame emitted while a run
/// is in flight. `runStatus` lets clients notice the terminal transition
/// without polling.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AgentStepNotification {
    pub run_id: String,
    pub document_id: String,
    pub run_status: AgentRunStatus,
    pub step: AgentStep,
}

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use translunar_domain::{QaSeverity, ReviewStatus};
use translunar_qa_core::{
    QaCategory, QaExportOverride, QaGateResult, QaIssueDisposition, QaIssueView, QaProfile,
    QaProfileDefinition, QaReportFormat, QaReportRecord, QaRun, ReviewQueueItem, ReviewStatistics,
};

fn default_page_size() -> u32 {
    50
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct QaProfileListParams {
    #[serde(default)]
    pub project_id: Option<String>,
    #[serde(default)]
    pub offset: u32,
    #[serde(default = "default_page_size")]
    pub limit: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct QaProfilePage {
    pub items: Vec<QaProfile>,
    pub total: u32,
    pub offset: u32,
    pub limit: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct QaProfileCreateParams {
    pub name: String,
    #[serde(default)]
    pub owner_project_id: Option<String>,
    pub definition: QaProfileDefinition,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct QaProfileCloneParams {
    pub profile_id: String,
    #[serde(default)]
    pub owner_project_id: Option<String>,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct QaProfileUpdateParams {
    pub profile_id: String,
    pub name: String,
    pub definition: QaProfileDefinition,
    pub expected_revision: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct QaProfileDeleteParams {
    pub profile_id: String,
    pub expected_revision: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct QaRunParams {
    pub project_id: String,
    #[serde(default)]
    pub document_id: Option<String>,
    #[serde(default)]
    pub profile_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct QaRunListParams {
    pub project_id: String,
    #[serde(default)]
    pub document_id: Option<String>,
    #[serde(default)]
    pub offset: u32,
    #[serde(default = "default_page_size")]
    pub limit: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct QaRunIdParams {
    pub run_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct QaRunPage {
    pub items: Vec<QaRun>,
    pub total: u32,
    pub offset: u32,
    pub limit: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct QaIssueListParams {
    pub project_id: String,
    #[serde(default)]
    pub document_id: Option<String>,
    #[serde(default)]
    pub segment_id: Option<String>,
    #[serde(default)]
    pub severity: Option<QaSeverity>,
    #[serde(default)]
    pub category: Option<QaCategory>,
    #[serde(default)]
    pub disposition: Option<QaIssueDisposition>,
    #[serde(default)]
    pub rule_id: Option<String>,
    #[serde(default)]
    pub offset: u32,
    #[serde(default = "default_page_size")]
    pub limit: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct QaIssuePage {
    pub items: Vec<QaIssueView>,
    pub total: u32,
    pub offset: u32,
    pub limit: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct QaIssueWaiveParams {
    pub issue_id: String,
    pub actor: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct QaIssueRevokeParams {
    pub issue_id: String,
    pub expected_revision: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct QaReportExportParams {
    pub run_id: String,
    pub format: QaReportFormat,
    pub output_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct QaGateCheckParams {
    pub project_id: String,
    pub document_id: String,
    #[serde(default)]
    pub profile_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct QaOverrideInput {
    pub actor: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct QaOverrideListParams {
    pub project_id: String,
    #[serde(default)]
    pub document_id: Option<String>,
    #[serde(default)]
    pub offset: u32,
    #[serde(default = "default_page_size")]
    pub limit: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct QaOverridePage {
    pub items: Vec<QaExportOverride>,
    pub total: u32,
    pub offset: u32,
    pub limit: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReviewQueueParams {
    pub project_id: String,
    #[serde(default)]
    pub document_id: Option<String>,
    #[serde(default)]
    pub status: Option<ReviewStatus>,
    #[serde(default)]
    pub offset: u32,
    #[serde(default = "default_page_size")]
    pub limit: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReviewQueuePage {
    pub items: Vec<ReviewQueueItem>,
    pub total: u32,
    pub offset: u32,
    pub limit: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReviewStatisticsParams {
    pub project_id: String,
    #[serde(default)]
    pub document_id: Option<String>,
}

pub type QaRunResult = QaRun;
pub type QaGateCheckResult = QaGateResult;
pub type QaReportExportResult = QaReportRecord;
pub type ReviewStatisticsResult = ReviewStatistics;

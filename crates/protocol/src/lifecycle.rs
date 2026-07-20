use std::collections::BTreeMap;

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use translunar_domain::Document;
use translunar_lifecycle_core::{
    AnalysisSummary, AnalysisWeights, ProjectAnalyticsSummary, ReimportPlan,
};

use crate::{default_actor, default_page_size};

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProjectTemplate {
    pub id: String,
    pub revision: u64,
    pub name: String,
    pub description: String,
    pub definition: Value,
    pub built_in: bool,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProjectTemplatePage {
    pub items: Vec<ProjectTemplate>,
    pub total: u32,
    pub offset: u32,
    pub limit: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProjectTemplateListParams {
    #[serde(default)]
    pub offset: u32,
    #[serde(default = "default_page_size")]
    pub limit: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProjectTemplateGetParams {
    pub template_id: String,
    #[serde(default)]
    pub revision: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProjectTemplateCreateParams {
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub definition: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProjectTemplateUpdateParams {
    pub template_id: String,
    pub expected_revision: u64,
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub definition: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProjectTemplateDeleteParams {
    pub template_id: String,
    pub expected_revision: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProjectCreateFromTemplateParams {
    pub template_id: String,
    #[serde(default)]
    pub template_revision: Option<u64>,
    pub name: String,
    #[serde(default)]
    pub source_locale: Option<String>,
    #[serde(default)]
    pub target_locale: Option<String>,
    #[serde(default)]
    pub domain: Option<String>,
    #[serde(default)]
    pub dependency_remaps: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TemplateDependencyDiagnostic {
    pub kind: String,
    pub requested_id: String,
    #[serde(default)]
    pub resolved_id: Option<String>,
    pub status: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProjectCreateFromTemplateResult {
    pub project: translunar_domain::Project,
    pub diagnostics: Vec<TemplateDependencyDiagnostic>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum BatchImportAtomicity {
    BestEffort,
    AllOrNothing,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct BatchImportItem {
    pub path: String,
    #[serde(default)]
    pub relative_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProjectBatchImportParams {
    pub project_id: String,
    pub items: Vec<BatchImportItem>,
    #[serde(default)]
    pub filter_id: Option<String>,
    #[serde(default)]
    pub options: BTreeMap<String, String>,
    #[serde(default = "default_best_effort")]
    pub atomicity: BatchImportAtomicity,
}

fn default_best_effort() -> BatchImportAtomicity {
    BatchImportAtomicity::BestEffort
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct BatchImportDiagnostic {
    pub path: String,
    pub relative_path: String,
    pub status: String,
    #[serde(default)]
    pub document: Option<Document>,
    #[serde(default)]
    pub error_code: Option<String>,
    #[serde(default)]
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProjectBatchImportResult {
    pub items: Vec<BatchImportDiagnostic>,
    pub succeeded: u32,
    pub failed: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DocumentReimportPreviewParams {
    pub document_id: String,
    pub source_path: String,
    pub expected_revision: u64,
    #[serde(default)]
    pub options: BTreeMap<String, String>,
    #[serde(default = "default_actor")]
    pub actor: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DocumentReimportPreviewResult {
    pub preview_id: String,
    pub document_id: String,
    pub expected_document_revision: u64,
    pub candidate_source_sha256: String,
    pub plan: ReimportPlan,
    pub created_at_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DocumentReimportApplyParams {
    pub preview_id: String,
    pub expected_document_revision: u64,
    #[serde(default = "default_actor")]
    pub actor: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct RecycleEntry {
    pub id: String,
    pub project_id: String,
    pub entity_type: String,
    pub entity_id: String,
    pub display_name: String,
    pub previous_state: String,
    pub actor: String,
    pub reason: String,
    pub deleted_at_ms: i64,
    pub retention_until_ms: i64,
    #[serde(default)]
    pub restored_at_ms: Option<i64>,
    #[serde(default)]
    pub purged_at_ms: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct RecyclePage {
    pub items: Vec<RecycleEntry>,
    pub total: u32,
    pub offset: u32,
    pub limit: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct RecycleListParams {
    #[serde(default)]
    pub offset: u32,
    #[serde(default = "default_page_size")]
    pub limit: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct RecycleDeleteParams {
    pub entity_type: String,
    pub entity_id: String,
    pub expected_revision: u64,
    #[serde(default = "default_actor")]
    pub actor: String,
    pub reason: String,
    #[serde(default)]
    pub retention_ms: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct RecycleEntryActionParams {
    pub entry_id: String,
    #[serde(default = "default_actor")]
    pub actor: String,
    #[serde(default)]
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct GlobalSearchParams {
    pub text: String,
    #[serde(default)]
    pub project_id: Option<String>,
    #[serde(default)]
    pub fields: Vec<String>,
    #[serde(default)]
    pub locale: Option<String>,
    #[serde(default)]
    pub workflow_state: Option<String>,
    #[serde(default)]
    pub updated_after_ms: Option<i64>,
    #[serde(default)]
    pub updated_before_ms: Option<i64>,
    #[serde(default)]
    pub include_recycled: bool,
    #[serde(default)]
    pub offset: u32,
    #[serde(default = "default_page_size")]
    pub limit: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct GlobalSearchHit {
    pub project_id: String,
    pub project_name: String,
    #[serde(default)]
    pub document_id: Option<String>,
    #[serde(default)]
    pub document_name: Option<String>,
    #[serde(default)]
    pub segment_id: Option<String>,
    #[serde(default)]
    pub segment_ordinal: Option<u32>,
    pub field: String,
    #[serde(default)]
    pub locale: Option<String>,
    #[serde(default)]
    pub workflow_state: Option<String>,
    pub snippet: String,
    pub updated_at_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct GlobalSearchPage {
    pub items: Vec<GlobalSearchHit>,
    pub total: u32,
    pub offset: u32,
    pub limit: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisProfile {
    pub id: String,
    pub revision: u64,
    pub name: String,
    pub weights: AnalysisWeights,
    pub built_in: bool,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisProfileListResult {
    pub items: Vec<AnalysisProfile>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisRunParams {
    pub project_id: String,
    #[serde(default)]
    pub document_id: Option<String>,
    #[serde(default = "default_analysis_profile")]
    pub profile_id: String,
    #[serde(default)]
    pub profile_revision: Option<u64>,
}

fn default_analysis_profile() -> String {
    "builtin.analysis.standard".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisRunIdParams {
    pub run_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProjectAnalyticsParams {
    pub project_id: String,
    #[serde(default = "default_idle_gap_ms")]
    pub idle_gap_ms: u64,
    #[serde(default = "default_trend_bucket_ms")]
    pub trend_bucket_ms: u64,
    #[serde(default = "default_trend_bucket_count")]
    pub trend_bucket_count: u32,
}

fn default_idle_gap_ms() -> u64 {
    5 * 60 * 1_000
}

fn default_trend_bucket_ms() -> u64 {
    24 * 60 * 60 * 1_000
}

fn default_trend_bucket_count() -> u32 {
    30
}

pub type ProjectAnalyticsResult = ProjectAnalyticsSummary;

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisRunResult {
    pub id: String,
    pub project_id: String,
    #[serde(default)]
    pub document_id: Option<String>,
    pub profile_id: String,
    pub profile_revision: u64,
    pub project_revision: u64,
    #[serde(default)]
    pub document_revision: Option<u64>,
    pub stale: bool,
    pub summary: AnalysisSummary,
    pub document_summaries: BTreeMap<String, AnalysisSummary>,
    pub created_at_ms: i64,
    pub completed_at_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProjectArchiveExportParams {
    pub project_id: String,
    pub destination_path: String,
    #[serde(default = "default_actor")]
    pub actor: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProjectArchiveRestoreParams {
    pub archive_path: String,
    #[serde(default)]
    pub dependency_remaps: BTreeMap<String, String>,
    #[serde(default = "default_actor")]
    pub actor: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProjectArchiveResult {
    pub project_id: String,
    pub archive_path: String,
    pub archive_sha256: String,
    pub diagnostics: Vec<String>,
}

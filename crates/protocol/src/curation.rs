//! Wire contracts for the unified asset catalog and explicit curation lifecycle.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use translunar_curation_core::{
    CurationDriftGroup, CurationEvidence, CurationFindingKind, CurationRecommendation,
    CurationSeverity, CurationSummary, CurationTermCandidate,
};

use crate::{default_actor, default_page_size};

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum AssetCatalogKind {
    #[default]
    All,
    Tm,
    Termbase,
    Corpus,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum CurationRunMode {
    Offline,
    Provider,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum CurationRunStatus {
    Open,
    Applied,
    RolledBack,
    Discarded,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum CurationState {
    Active,
    Quarantined,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum CurationExportFormat {
    Jsonl,
    Tsv,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CurationPolicy {
    pub minimum_chars: u32,
    pub minimum_length_ratio_percent: u16,
    pub maximum_length_ratio_percent: u16,
    pub near_duplicate_threshold: u8,
    pub semantic_alignment_threshold_basis_points: u16,
    pub quarantine_threshold_basis_points: u16,
    pub minimum_term_frequency: u32,
    #[serde(default)]
    pub created_after_ms: Option<i64>,
    #[serde(default)]
    pub created_before_ms: Option<i64>,
}

impl Default for CurationPolicy {
    fn default() -> Self {
        let policy = translunar_curation_core::CurationPolicy::default();
        Self {
            minimum_chars: policy.minimum_chars,
            minimum_length_ratio_percent: policy.minimum_length_ratio_percent,
            maximum_length_ratio_percent: policy.maximum_length_ratio_percent,
            near_duplicate_threshold: policy.near_duplicate_threshold,
            semantic_alignment_threshold_basis_points: policy
                .semantic_alignment_threshold_basis_points,
            quarantine_threshold_basis_points: policy.quarantine_threshold_basis_points,
            minimum_term_frequency: policy.minimum_term_frequency,
            created_after_ms: policy.created_after_ms,
            created_before_ms: policy.created_before_ms,
        }
    }
}

impl From<CurationPolicy> for translunar_curation_core::CurationPolicy {
    fn from(value: CurationPolicy) -> Self {
        Self {
            minimum_chars: value.minimum_chars,
            minimum_length_ratio_percent: value.minimum_length_ratio_percent,
            maximum_length_ratio_percent: value.maximum_length_ratio_percent,
            near_duplicate_threshold: value.near_duplicate_threshold,
            semantic_alignment_threshold_basis_points: value
                .semantic_alignment_threshold_basis_points,
            quarantine_threshold_basis_points: value.quarantine_threshold_basis_points,
            minimum_term_frequency: value.minimum_term_frequency,
            created_after_ms: value.created_after_ms,
            created_before_ms: value.created_before_ms,
        }
    }
}

impl From<translunar_curation_core::CurationPolicy> for CurationPolicy {
    fn from(value: translunar_curation_core::CurationPolicy) -> Self {
        Self {
            minimum_chars: value.minimum_chars,
            minimum_length_ratio_percent: value.minimum_length_ratio_percent,
            maximum_length_ratio_percent: value.maximum_length_ratio_percent,
            near_duplicate_threshold: value.near_duplicate_threshold,
            semantic_alignment_threshold_basis_points: value
                .semantic_alignment_threshold_basis_points,
            quarantine_threshold_basis_points: value.quarantine_threshold_basis_points,
            minimum_term_frequency: value.minimum_term_frequency,
            created_after_ms: value.created_after_ms,
            created_before_ms: value.created_before_ms,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AssetCatalogListParams {
    #[serde(default)]
    pub project_id: Option<String>,
    #[serde(default)]
    pub kind: AssetCatalogKind,
    #[serde(default)]
    pub source_locale: Option<String>,
    #[serde(default)]
    pub target_locale: Option<String>,
    #[serde(default)]
    pub domain: Option<String>,
    #[serde(default)]
    pub origin_project_id: Option<String>,
    #[serde(default)]
    pub origin_document_id: Option<String>,
    #[serde(default)]
    pub created_after_ms: Option<i64>,
    #[serde(default)]
    pub created_before_ms: Option<i64>,
    #[serde(default)]
    pub query: Option<String>,
    #[serde(default)]
    pub offset: u32,
    #[serde(default = "default_page_size")]
    pub limit: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AssetCatalogItem {
    pub id: String,
    pub collection_id: String,
    pub collection_name: String,
    pub kind: AssetCatalogKind,
    pub source_locale: String,
    pub target_locale: Option<String>,
    pub domain: Option<String>,
    pub source_text: String,
    pub target_text: String,
    pub origin_project_id: Option<String>,
    pub origin_document_id: Option<String>,
    pub origin_segment_id: Option<String>,
    pub structural_path: Option<String>,
    pub quality_score_basis_points: Option<u16>,
    pub curation_state: Option<CurationState>,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AssetCatalogPage {
    pub items: Vec<AssetCatalogItem>,
    pub total: u32,
    pub offset: u32,
    pub limit: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CurationRunParams {
    pub project_id: String,
    pub library_id: String,
    pub expected_library_revision: u64,
    #[serde(default)]
    pub policy: CurationPolicy,
    #[serde(default = "default_actor")]
    pub actor: String,
    #[serde(default)]
    pub reason: String,
    #[serde(default)]
    pub provider_profile_id: Option<String>,
    #[serde(default)]
    pub correlation_id: Option<String>,
    #[serde(default)]
    pub offset: u32,
    #[serde(default = "default_page_size")]
    pub limit: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CurationRunIdParams {
    pub run_id: String,
    #[serde(default)]
    pub offset: u32,
    #[serde(default = "default_page_size")]
    pub limit: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CurationFindingListParams {
    pub run_id: String,
    #[serde(default)]
    pub offset: u32,
    #[serde(default = "default_page_size")]
    pub limit: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CurationApplyParams {
    pub run_id: String,
    pub expected_run_revision: u64,
    pub expected_library_revision: u64,
    pub selected_finding_ids: Vec<String>,
    #[serde(default = "default_actor")]
    pub actor: String,
    #[serde(default)]
    pub reason: String,
    #[serde(default)]
    pub correlation_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CurationRollbackParams {
    pub run_id: String,
    pub expected_run_revision: u64,
    pub expected_library_revision: u64,
    #[serde(default = "default_actor")]
    pub actor: String,
    #[serde(default)]
    pub reason: String,
    #[serde(default)]
    pub correlation_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CurationExportParams {
    pub run_id: String,
    pub expected_run_revision: u64,
    pub expected_library_revision: u64,
    #[serde(default)]
    pub minimum_score_basis_points: Option<u16>,
    pub format: CurationExportFormat,
    pub output_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CurationRunSummary {
    pub analysis: CurationSummary,
    pub term_candidates: Vec<CurationTermCandidate>,
    pub drift_groups: Vec<CurationDriftGroup>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CurationRun {
    pub id: String,
    pub project_id: String,
    pub library_id: String,
    pub status: CurationRunStatus,
    pub mode: CurationRunMode,
    pub policy: CurationPolicy,
    pub base_library_revision: u64,
    pub revision: u64,
    pub summary: CurationRunSummary,
    pub actor: String,
    pub reason: String,
    pub provider_profile_id: Option<String>,
    pub created_at_ms: i64,
    pub completed_at_ms: Option<i64>,
    pub updated_at_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CurationRunUnit {
    pub run_id: String,
    pub library_id: String,
    pub unit_id: String,
    pub quality_score_basis_points: u16,
    pub recommended_action: CurationRecommendation,
    pub explanation: Vec<String>,
    pub unit_snapshot_hash: String,
    pub created_at_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CurationRunSnapshot {
    pub run: CurationRun,
    pub units: Vec<CurationRunUnit>,
    pub total: u32,
    pub offset: u32,
    pub limit: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CurationFinding {
    pub id: String,
    pub run_id: String,
    pub library_id: String,
    pub unit_id: String,
    pub kind: CurationFindingKind,
    pub severity: CurationSeverity,
    pub disposition: CurationRecommendation,
    pub penalty_basis_points: u16,
    pub quality_score_basis_points: u16,
    pub canonical_unit_id: Option<String>,
    pub evidence: CurationEvidence,
    pub explanation: String,
    pub revision: u64,
    pub fingerprint: String,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CurationFindingPage {
    pub items: Vec<CurationFinding>,
    pub total: u32,
    pub offset: u32,
    pub limit: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CurationMutationResult {
    pub run_id: String,
    pub status: CurationRunStatus,
    pub run_revision: u64,
    pub library_id: String,
    pub library_revision: u64,
    pub changed_unit_count: u32,
    pub quarantined_unit_count: u32,
    pub restored_unit_count: u32,
    pub operation_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CurationExportResult {
    pub run_id: String,
    pub run_revision: u64,
    pub library_id: String,
    pub library_revision: u64,
    pub format: CurationExportFormat,
    pub output_path: String,
    pub row_count: u32,
    pub bytes_written: u64,
    pub sha256: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn curation_requests_are_strict_and_camel_case() {
        let params: CurationRunParams = serde_json::from_value(serde_json::json!({
            "projectId": "project",
            "libraryId": "library",
            "expectedLibraryRevision": 4,
            "reason": "review assets"
        }))
        .expect("deserialize curation run request");
        assert_eq!(params.limit, 200);
        assert_eq!(params.actor, "desktop");

        let json = serde_json::to_value(params).expect("serialize curation run request");
        assert_eq!(json["expectedLibraryRevision"], 4);
        assert!(json.get("expected_library_revision").is_none());

        let error = serde_json::from_value::<CurationRunIdParams>(serde_json::json!({
            "runId": "run",
            "unknown": true
        }))
        .expect_err("unknown fields must be rejected");
        assert!(error.to_string().contains("unknown field"));
    }

    #[test]
    fn catalog_filters_and_export_formats_have_stable_wire_values() {
        let params: AssetCatalogListParams = serde_json::from_value(serde_json::json!({
            "kind": "termbase",
            "sourceLocale": "en",
            "createdAfterMs": 10,
            "offset": 5,
            "limit": 25
        }))
        .expect("deserialize catalog filters");
        assert_eq!(params.kind, AssetCatalogKind::Termbase);
        assert_eq!(params.source_locale.as_deref(), Some("en"));

        assert_eq!(
            serde_json::to_string(&CurationExportFormat::Jsonl).expect("serialize format"),
            "\"jsonl\""
        );
        assert_eq!(
            serde_json::to_string(&CurationRunStatus::RolledBack).expect("serialize status"),
            "\"rolledBack\""
        );
    }
}

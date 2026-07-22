use std::collections::BTreeMap;

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use translunar_alignment_core::{AlignmentLinkStatus, AlignmentOptions, AlignmentOrigin};

use crate::{default_actor, default_page_size};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum AlignmentSessionStatus {
    Open,
    Applied,
    Discarded,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum AlignmentEvidence {
    Length {
        score_basis_points: u16,
        source_chars: u32,
        target_chars: u32,
        summary: String,
    },
    Numbers {
        score_basis_points: u16,
        source_values: Vec<String>,
        target_values: Vec<String>,
        source_value_count: u32,
        target_value_count: u32,
        summary: String,
    },
    Punctuation {
        score_basis_points: u16,
        source_signature: Vec<String>,
        target_signature: Vec<String>,
        summary: String,
    },
    Tags {
        score_basis_points: u16,
        source_signature: Vec<String>,
        target_signature: Vec<String>,
        source_tag_count: u32,
        target_tag_count: u32,
        summary: String,
    },
    LexicalAnchors {
        score_basis_points: u16,
        shared_anchors: Vec<String>,
        shared_anchor_count: u32,
        summary: String,
    },
    Displacement {
        penalty_basis_points: u16,
        source_position_basis_points: u16,
        target_position_basis_points: u16,
        summary: String,
    },
    Unaligned {
        side: translunar_alignment_core::AlignmentSide,
        penalty_basis_points: u16,
        summary: String,
    },
    AiRefinement {
        summary: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AlignmentSession {
    pub id: String,
    pub project_id: String,
    pub source_document_id: String,
    pub target_document_id: String,
    pub source_document_revision: u64,
    pub target_document_revision: u64,
    pub source_locale: String,
    pub target_locale: String,
    pub algorithm_version: String,
    pub status: AlignmentSessionStatus,
    pub revision: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub terminal_result: Option<AlignmentApplyResult>,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub closed_at_ms: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AlignmentLink {
    pub id: String,
    pub session_id: String,
    pub ordinal: u32,
    pub source_segment_ids: Vec<String>,
    pub target_segment_ids: Vec<String>,
    pub source_text: String,
    pub target_text: String,
    pub confidence_basis_points: u16,
    pub evidence: Vec<AlignmentEvidence>,
    pub origin: AlignmentOrigin,
    pub status: AlignmentLinkStatus,
    pub revision: u64,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AlignmentSessionCreateParams {
    pub project_id: String,
    pub source_document_id: String,
    pub target_document_id: String,
    pub expected_project_revision: u64,
    pub expected_source_document_revision: u64,
    pub expected_target_document_revision: u64,
    #[serde(default)]
    pub options: AlignmentOptions,
    #[serde(default = "default_actor")]
    pub actor: String,
    pub reason: String,
    #[serde(default)]
    pub correlation_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AlignmentSessionListParams {
    pub project_id: String,
    #[serde(default)]
    pub status: Option<AlignmentSessionStatus>,
    #[serde(default)]
    pub offset: u32,
    #[serde(default = "default_page_size")]
    pub limit: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AlignmentSessionGetParams {
    pub session_id: String,
    #[serde(default)]
    pub link_status: Option<AlignmentLinkStatus>,
    #[serde(default)]
    pub offset: u32,
    #[serde(default = "default_page_size")]
    pub limit: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AlignmentSessionPage {
    pub items: Vec<AlignmentSession>,
    pub total: u32,
    pub offset: u32,
    pub limit: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AlignmentSessionGetResult {
    pub session: AlignmentSession,
    pub links: Vec<AlignmentLink>,
    pub total: u32,
    pub offset: u32,
    pub limit: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AlignmentExpectedLinkRevision {
    pub link_id: String,
    pub expected_revision: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AlignmentManualLink {
    pub source_segment_ids: Vec<String>,
    pub target_segment_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum AlignmentSessionMutation {
    ReplaceLinks {
        links: Vec<AlignmentExpectedLinkRevision>,
        replacement: Vec<AlignmentManualLink>,
    },
    SetStatus {
        link_id: String,
        expected_link_revision: u64,
        status: AlignmentLinkStatus,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AlignmentSessionUpdateParams {
    pub session_id: String,
    pub expected_session_revision: u64,
    pub mutation: AlignmentSessionMutation,
    #[serde(default = "default_actor")]
    pub actor: String,
    pub reason: String,
    #[serde(default)]
    pub correlation_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AlignmentSessionCreateResult {
    pub session: AlignmentSession,
    pub work_units: u64,
    pub source_segment_count: u32,
    pub target_segment_count: u32,
    pub link_count: u32,
    pub operation_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AlignmentMutationResult {
    pub session: AlignmentSession,
    pub links: Vec<AlignmentLink>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub operation_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AlignmentSessionRefineParams {
    pub session_id: String,
    pub expected_session_revision: u64,
    pub links: Vec<AlignmentExpectedLinkRevision>,
    pub profile_id: String,
    #[serde(default = "default_max_attempts")]
    pub max_attempts: u32,
    #[serde(default = "default_actor")]
    pub actor: String,
    pub reason: String,
    #[serde(default)]
    pub correlation_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AlignmentSessionApplyParams {
    pub session_id: String,
    pub library_id: String,
    pub expected_session_revision: u64,
    pub expected_library_revision: u64,
    pub links: Vec<AlignmentExpectedLinkRevision>,
    #[serde(default = "default_actor")]
    pub actor: String,
    pub reason: String,
    #[serde(default)]
    pub correlation_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AlignmentApplyDuplicate {
    pub link_id: String,
    pub tm_unit_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AlignmentApplyResult {
    pub session_id: String,
    pub library_id: String,
    pub status: AlignmentSessionStatus,
    pub selected_count: u32,
    pub inserted_count: u32,
    pub duplicate_count: u32,
    pub session_revision: u64,
    pub library_revision: u64,
    pub operation_id: String,
    pub tm_unit_ids: Vec<String>,
    pub duplicates: Vec<AlignmentApplyDuplicate>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum ReferenceCorpusKind {
    MonolingualSource,
    MonolingualTarget,
    Bilingual,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum ReferenceCorpusSourceKind {
    File,
    Alignment,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum ReferenceCorpusStatus {
    Active,
    Removed,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceCorpus {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub kind: ReferenceCorpusKind,
    pub source_locale: String,
    pub target_locale: String,
    pub source_kind: ReferenceCorpusSourceKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub managed_source_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub input_filter_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub input_format: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub input_sha256: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_document_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_document_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub alignment_session_id: Option<String>,
    pub status: ReferenceCorpusStatus,
    pub revision: u64,
    pub entry_count: u32,
    pub diagnostic_count: u32,
    pub diagnostics: Vec<String>,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub removed_at_ms: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceCorpusEntry {
    pub id: String,
    pub corpus_id: String,
    pub ordinal: u32,
    pub source_text: String,
    pub target_text: String,
    pub structural_path: String,
    pub provenance: Value,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceCorpusPage {
    pub items: Vec<ReferenceCorpus>,
    pub total: u32,
    pub offset: u32,
    pub limit: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CorpusListParams {
    pub project_id: String,
    #[serde(default)]
    pub status: Option<ReferenceCorpusStatus>,
    #[serde(default)]
    pub offset: u32,
    #[serde(default = "default_page_size")]
    pub limit: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CorpusImportParams {
    pub project_id: String,
    pub expected_project_revision: u64,
    pub source_path: String,
    pub name: String,
    pub kind: ReferenceCorpusKind,
    pub source_locale: String,
    pub target_locale: String,
    #[serde(default)]
    pub filter_id: Option<String>,
    #[serde(default)]
    pub options: BTreeMap<String, String>,
    #[serde(default = "default_actor")]
    pub actor: String,
    pub reason: String,
    #[serde(default)]
    pub correlation_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CorpusFromAlignmentParams {
    pub project_id: String,
    pub expected_project_revision: u64,
    pub session_id: String,
    pub expected_session_revision: u64,
    pub name: String,
    pub links: Vec<AlignmentExpectedLinkRevision>,
    #[serde(default = "default_actor")]
    pub actor: String,
    pub reason: String,
    #[serde(default)]
    pub correlation_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CorpusMutationParams {
    pub corpus_id: String,
    pub expected_revision: u64,
    #[serde(default = "default_actor")]
    pub actor: String,
    pub reason: String,
    #[serde(default)]
    pub correlation_id: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum CorpusSearchSide {
    Source,
    Target,
    Both,
}

fn default_both() -> CorpusSearchSide {
    CorpusSearchSide::Both
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum CorpusMatchedSide {
    Source,
    Target,
    Both,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum CorpusMatchKind {
    Exact,
    Prefix,
    Contains,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CorpusSearchParams {
    pub project_id: String,
    pub query: String,
    #[serde(default = "default_both")]
    pub side: CorpusSearchSide,
    #[serde(default)]
    pub corpus_ids: Vec<String>,
    #[serde(default)]
    pub offset: u32,
    #[serde(default = "default_page_size")]
    pub limit: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CorpusSearchHit {
    pub corpus: ReferenceCorpus,
    pub entry: ReferenceCorpusEntry,
    pub matched_side: CorpusMatchedSide,
    pub match_kind: CorpusMatchKind,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CorpusSearchResult {
    pub items: Vec<CorpusSearchHit>,
    pub total: u32,
    pub offset: u32,
    pub limit: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceCorpusMutationResult {
    pub corpus: ReferenceCorpus,
    pub affected_entry_count: u32,
    pub operation_id: String,
}

fn default_max_attempts() -> u32 {
    3
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn alignment_update_uses_a_strict_camel_case_tagged_mutation() {
        let value = json!({
            "sessionId": "session-1",
            "expectedSessionRevision": 4,
            "mutation": {
                "kind": "setStatus",
                "linkId": "link-1",
                "expectedLinkRevision": 2,
                "status": "confirmed"
            },
            "actor": "reviewer",
            "reason": "confirm reviewed pair"
        });
        let params: AlignmentSessionUpdateParams =
            serde_json::from_value(value.clone()).expect("deserialize alignment update");
        match params.mutation {
            AlignmentSessionMutation::SetStatus {
                link_id,
                expected_link_revision,
                status,
            } => {
                assert_eq!(link_id, "link-1");
                assert_eq!(expected_link_revision, 2);
                assert_eq!(status, AlignmentLinkStatus::Confirmed);
            }
            AlignmentSessionMutation::ReplaceLinks { .. } => {
                panic!("expected a status mutation")
            }
        }

        let mut unexpected = value;
        unexpected["mutation"]["sourceText"] = json!("must not cross the wire");
        assert!(serde_json::from_value::<AlignmentSessionUpdateParams>(unexpected).is_err());
    }

    #[test]
    fn corpus_search_defaults_to_both_sides_and_a_bounded_page() {
        let params: CorpusSearchParams = serde_json::from_value(json!({
            "projectId": "project-1",
            "query": "invoice"
        }))
        .expect("deserialize corpus search defaults");
        assert_eq!(params.side, CorpusSearchSide::Both);
        assert_eq!(params.offset, 0);
        assert_eq!(params.limit, 200);
        assert!(params.corpus_ids.is_empty());

        let value = serde_json::to_value(params).expect("serialize corpus search");
        assert_eq!(value["projectId"], "project-1");
        assert_eq!(value["side"], "both");
        assert!(value.get("project_id").is_none());
    }

    #[test]
    fn alignment_evidence_fields_are_camel_case_on_the_wire() {
        let value = serde_json::to_value(AlignmentEvidence::Length {
            score_basis_points: 9_500,
            source_chars: 10,
            target_chars: 12,
            summary: "similar length".to_string(),
        })
        .expect("serialize alignment evidence");
        assert_eq!(value["kind"], "length");
        assert_eq!(value["scoreBasisPoints"], 9_500);
        assert_eq!(value["sourceChars"], 10);
        assert!(value.get("score_basis_points").is_none());
    }
}

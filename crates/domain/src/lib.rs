use std::sync::LazyLock;

use regex::Regex;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use unicode_normalization::UnicodeNormalization;
use uuid::Uuid;

static NUMBER_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?x)(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?").expect("valid number regex")
});

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum SegmentState {
    Untranslated,
    Draft,
    Confirmed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum ProjectLifecycle {
    Active,
    Archived,
    Trash,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProjectConfiguration {
    #[serde(default)]
    pub template_id: Option<String>,
    #[serde(default)]
    pub qa_profile_id: Option<String>,
    #[serde(default)]
    pub pipeline_id: Option<String>,
    #[serde(default)]
    pub engine_allowlist: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    pub source_locale: String,
    pub target_locale: String,
    pub domain: String,
    pub lifecycle: ProjectLifecycle,
    pub revision: u64,
    pub configuration: ProjectConfiguration,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
    #[serde(default)]
    pub archived_at_ms: Option<i64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum DocumentStatus {
    Active,
    Failed,
    Superseded,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Document {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub relative_path: String,
    pub format: String,
    pub filter_id: String,
    pub source_sha256: String,
    pub current_version: u32,
    pub status: DocumentStatus,
    pub revision: u64,
    pub segment_count: u32,
    pub degradation: Vec<DegradationFinding>,
    pub imported_at_ms: i64,
    pub updated_at_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DocumentVersion {
    pub id: String,
    pub document_id: String,
    pub version: u32,
    pub source_sha256: String,
    pub original_source_path: String,
    pub managed_source_path: String,
    pub reason: String,
    pub created_at_ms: i64,
}

#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, JsonSchema,
)]
#[serde(rename_all = "camelCase")]
pub enum TagSide {
    Source,
    Target,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum TagKind {
    Start,
    End,
    Standalone,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct InlineTag {
    pub id: String,
    pub side: TagSide,
    pub position: u32,
    pub kind: TagKind,
    #[serde(default)]
    pub pair_id: Option<String>,
    pub payload: String,
    pub display_text: String,
    pub protected: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DocumentNote {
    pub id: String,
    pub text: String,
    #[serde(default)]
    pub author: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum DegradationSeverity {
    Warning,
    Error,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DegradationFinding {
    pub code: String,
    pub severity: DegradationSeverity,
    pub message: String,
    #[serde(default)]
    pub structural_path: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Operation {
    pub id: String,
    pub project_id: String,
    pub sequence: u64,
    pub entity_type: String,
    pub entity_id: String,
    pub kind: String,
    #[serde(default)]
    pub base_revision: Option<u64>,
    #[serde(default)]
    pub result_revision: Option<u64>,
    pub actor: String,
    #[serde(default)]
    pub correlation_id: Option<String>,
    #[serde(default)]
    pub before: Option<Value>,
    #[serde(default)]
    pub after: Option<Value>,
    pub created_at_ms: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum HealthSeverity {
    Info,
    Warning,
    Error,
    Fatal,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct HealthFinding {
    pub code: String,
    pub severity: HealthSeverity,
    pub message: String,
    #[serde(default)]
    pub entity_type: Option<String>,
    #[serde(default)]
    pub entity_id: Option<String>,
    #[serde(default)]
    pub path: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DataHealthReport {
    pub schema_version: u32,
    pub healthy: bool,
    pub findings: Vec<HealthFinding>,
    pub checked_at_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct BackupFile {
    pub relative_path: String,
    pub size: u64,
    pub sha256: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct BackupManifest {
    pub format_version: u32,
    pub engine_version: String,
    pub schema_version: u32,
    pub created_at_ms: i64,
    pub files: Vec<BackupFile>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Segment {
    pub id: String,
    pub document_id: String,
    pub ordinal: u32,
    pub structural_path: String,
    pub source_text: String,
    pub target_text: String,
    pub state: SegmentState,
    pub revision: u64,
    pub source_hash: String,
    pub context_hash: String,
    pub updated_at_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SegmentCounts {
    pub total: u32,
    pub untranslated: u32,
    pub draft: u32,
    pub confirmed: u32,
    pub open_issues: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TranslationMemory {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub source_locale: String,
    pub target_locale: String,
    pub writable: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TmEntry {
    pub id: String,
    pub memory_id: String,
    pub source_text: String,
    pub target_text: String,
    pub source_hash: String,
    pub origin_project_id: String,
    pub origin_document_id: String,
    pub origin_segment_id: String,
    pub confirmed_at_ms: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum QaSeverity {
    Error,
    Warning,
    Info,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum QaIssueStatus {
    Open,
    Resolved,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct NumberEvidence {
    pub source_numbers: Vec<String>,
    pub target_numbers: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct QaIssue {
    pub id: String,
    pub segment_id: String,
    pub rule_id: String,
    pub severity: QaSeverity,
    pub status: QaIssueStatus,
    pub message: String,
    pub fingerprint: String,
    pub evidence: NumberEvidence,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}

pub fn new_id() -> String {
    Uuid::now_v7().to_string()
}

pub fn normalize_text(value: &str) -> String {
    value
        .nfkc()
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

pub fn sha256_hex(value: impl AsRef<[u8]>) -> String {
    let digest = Sha256::digest(value.as_ref());
    format!("{digest:x}")
}

pub fn segment_hashes(
    source: &str,
    previous: Option<&str>,
    next: Option<&str>,
) -> (String, String) {
    let source = normalize_text(source);
    let previous = previous.map(normalize_text).unwrap_or_default();
    let next = next.map(normalize_text).unwrap_or_default();
    let source_hash = sha256_hex(source.as_bytes());
    let context_hash = sha256_hex(format!("{source}\0{previous}\0{next}").as_bytes());
    (source_hash, context_hash)
}

pub fn state_for_target(target: &str) -> SegmentState {
    if target.trim().is_empty() {
        SegmentState::Untranslated
    } else {
        SegmentState::Draft
    }
}

pub fn number_tokens(value: &str) -> Vec<String> {
    let normalized = value.nfkc().collect::<String>();
    let mut tokens = NUMBER_RE
        .find_iter(&normalized)
        .map(|m| normalize_number(m.as_str()))
        .collect::<Vec<_>>();
    tokens.sort();
    tokens
}

pub fn number_mismatch(source: &str, target: &str) -> Option<NumberEvidence> {
    let source_numbers = number_tokens(source);
    let target_numbers = number_tokens(target);
    if source_numbers == target_numbers {
        None
    } else {
        Some(NumberEvidence {
            source_numbers,
            target_numbers,
        })
    }
}

pub fn number_issue_fingerprint(segment_id: &str, evidence: &NumberEvidence) -> String {
    sha256_hex(
        format!(
            "number-mismatch\0{segment_id}\0{}\0{}",
            evidence.source_numbers.join(","),
            evidence.target_numbers.join(",")
        )
        .as_bytes(),
    )
}

fn normalize_number(value: &str) -> String {
    let without_grouping = value.replace(',', "");
    match without_grouping.parse::<f64>() {
        Ok(number) if number.fract() == 0.0 => format!("{number:.0}"),
        Ok(number) => {
            let rendered = number.to_string();
            rendered
                .trim_end_matches('0')
                .trim_end_matches('.')
                .to_string()
        }
        Err(_) => without_grouping,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_cjk_and_whitespace() {
        assert_eq!(normalize_text("  保留期为 ６０ 天。\n"), "保留期为 60 天。");
    }

    #[test]
    fn detects_number_mismatch() {
        let evidence = number_mismatch("The retention period is 30 days.", "保留期为 60 天。")
            .expect("mismatch");
        assert_eq!(evidence.source_numbers, vec!["30"]);
        assert_eq!(evidence.target_numbers, vec!["60"]);
    }

    #[test]
    fn treats_grouping_and_full_width_as_equal() {
        assert!(number_mismatch("USD 1,200.00", "１２００ 美元").is_none());
    }

    #[test]
    fn hashes_include_context() {
        let (source_a, context_a) = segment_hashes("Same", Some("Before"), None);
        let (source_b, context_b) = segment_hashes("Same", Some("Other"), None);
        assert_eq!(source_a, source_b);
        assert_ne!(context_a, context_b);
    }
}

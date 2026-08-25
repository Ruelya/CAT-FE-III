use std::collections::BTreeMap;
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

/// Placeholder-like tokens a translation must carry through verbatim:
/// `{name}` / `{{var}}` braces, printf conversions, markup tags, entities.
/// This is the only inline tag/placeholder shape the segment model stores —
/// literal tokens inside the text — shared by AI draft gating and QA.
static PLACEHOLDER_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"(?x)
        \{\{[^{}]*\}\}                                  # {{handlebars}}
        | \{[^{}\s][^{}]*\}                             # {brace} placeholders
        | %(?:\d+\$)?[-+ 0\#]*\d*(?:\.\d+)?[sdifucxXeg@] # printf-style
        | </?[A-Za-z][A-Za-z0-9:._-]*(?:\s[^<>]*)?/?>   # markup tags
        | &\#?[A-Za-z0-9]+;                             # character entities
    ",
    )
    .expect("valid placeholder regex")
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

/// Default segmentation mode applied when `document.import` is called without
/// an explicit segmentation choice. Serialized as `sentence` / `paragraph`,
/// matching the strings `DocumentImportParams.segmentation` accepts.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum ProjectSegmentation {
    Sentence,
    Paragraph,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
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
    #[serde(default)]
    pub ai_profile_ids: Vec<String>,
    #[serde(default)]
    pub analysis_profile_id: Option<String>,
    #[serde(default)]
    pub editor_defaults: Option<EditorPreferences>,
    #[serde(default)]
    pub task_package: Option<TaskPackageProjectReference>,
    /// Default segmentation for future imports. `None` means sentence mode.
    #[serde(default)]
    pub segmentation: Option<ProjectSegmentation>,
    /// Default SRX ruleset path for future sentence-mode imports. Only the
    /// path is stored — a missing or invalid file fails at import time, not
    /// when the default is saved. Ignored (but kept) while the segmentation
    /// default is paragraph, so switching back to sentence restores it.
    #[serde(default)]
    pub srx_path: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TaskPackageProjectReference {
    pub package_id: String,
    pub origin_project_id: String,
    #[serde(default)]
    pub parent_package_id: Option<String>,
    #[serde(default)]
    pub instructions: String,
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

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum EditorWorkflowState {
    #[default]
    Translation,
    Review,
    Signed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum ChineseConversionProfile {
    SimplifiedToTraditional,
    SimplifiedToTaiwan,
    SimplifiedToHongKong,
    TraditionalToSimplified,
    TaiwanToSimplified,
    HongKongToSimplified,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct EditorTagIssue {
    pub code: String,
    pub message: String,
    #[serde(default)]
    pub tag_id: Option<String>,
    #[serde(default)]
    pub position: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct EditorComment {
    pub id: String,
    pub segment_id: String,
    pub author: String,
    pub text: String,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
    pub revision: u64,
    pub resolved: bool,
    pub immutable: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum ReviewStatus {
    Pending,
    Accepted,
    Rejected,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReviewRevision {
    pub id: String,
    pub segment_id: String,
    pub base_revision: u64,
    #[serde(default)]
    pub before_source: String,
    pub before_target: String,
    #[serde(default)]
    pub proposed_source: Option<String>,
    pub proposed_target: String,
    #[serde(default)]
    pub before_target_tags: Vec<InlineTag>,
    #[serde(default)]
    pub proposed_target_tags: Option<Vec<InlineTag>>,
    pub author: String,
    pub reason: String,
    pub status: ReviewStatus,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SpellFinding {
    pub word: String,
    pub start: u32,
    pub end: u32,
    pub suggestions: Vec<String>,
    pub provider: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct EditorPreferences {
    pub theme: String,
    pub zoom: u16,
    pub show_nonprinting: bool,
    pub autocomplete: bool,
    pub cjk_spacing: bool,
    pub punctuation_assistance: bool,
    pub shortcuts: BTreeMap<String, String>,
}

impl Default for EditorPreferences {
    fn default() -> Self {
        Self {
            theme: "system".to_string(),
            zoom: 100,
            show_nonprinting: false,
            autocomplete: true,
            cjk_spacing: true,
            punctuation_assistance: true,
            shortcuts: BTreeMap::new(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SegmentEditorRow {
    pub segment: Segment,
    pub source_tags: Vec<InlineTag>,
    pub target_tags: Vec<InlineTag>,
    pub tag_issues: Vec<EditorTagIssue>,
    pub spell_findings: Vec<SpellFinding>,
    pub comments: Vec<EditorComment>,
    pub workflow_state: EditorWorkflowState,
    #[serde(default)]
    pub context_before: Option<Segment>,
    #[serde(default)]
    pub context_after: Option<Segment>,
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

/// Lifecycle of a persisted QA issue.
///
/// - `Open`: the finding reproduced on the latest run and nobody accepted it.
/// - `Waived`: a user explicitly accepted this exact finding (`qa.waive`).
///   A waiver is pinned to the issue fingerprint, which hashes the rule,
///   segment, and evidence — so it holds only while the very same evidence
///   keeps reproducing. If the evidence changes, the changed finding opens
///   as a new issue instead of hiding behind the old waiver.
/// - `Resolved`: the finding stopped reproducing (e.g. the numbers now
///   actually match). Only `qa.run` moves issues here; waiving never does.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum QaIssueStatus {
    Open,
    Waived,
    Resolved,
}

/// Evidence attached to a QA issue. Historically number-only; general rules
/// reuse the same shape with free-form source/target values.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct NumberEvidence {
    pub source_numbers: Vec<String>,
    pub target_numbers: Vec<String>,
    #[serde(default)]
    pub source_values: Vec<String>,
    #[serde(default)]
    pub target_values: Vec<String>,
    #[serde(default)]
    pub related_segment_ids: Vec<String>,
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
    /// Free-form note recorded with a waiver. Optional by design — waiving
    /// must not demand a ritual reason. Non-null only while `status` is
    /// [`QaIssueStatus::Waived`].
    #[serde(default)]
    pub waive_note: Option<String>,
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
            ..NumberEvidence::default()
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

pub fn placeholder_tokens(text: &str) -> Vec<String> {
    PLACEHOLDER_RE
        .find_iter(text)
        .map(|found| found.as_str().to_string())
        .collect()
}

/// Multiset difference of placeholder tokens between source and target.
///
/// `missing` lists tokens the target dropped, `extra` lists tokens it
/// invented; a duplicated token counts once per missing/extra occurrence.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct PlaceholderMismatch {
    pub missing: Vec<String>,
    pub extra: Vec<String>,
}

pub fn placeholder_mismatch(source: &str, target: &str) -> Option<PlaceholderMismatch> {
    let mut counts: BTreeMap<String, i64> = BTreeMap::new();
    for token in placeholder_tokens(source) {
        *counts.entry(token).or_default() += 1;
    }
    for token in placeholder_tokens(target) {
        *counts.entry(token).or_default() -= 1;
    }
    let mut mismatch = PlaceholderMismatch::default();
    for (token, balance) in counts {
        for _ in 0..balance.max(0) {
            mismatch.missing.push(token.clone());
        }
        for _ in 0..(-balance).max(0) {
            mismatch.extra.push(token.clone());
        }
    }
    if mismatch.missing.is_empty() && mismatch.extra.is_empty() {
        None
    } else {
        Some(mismatch)
    }
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
    fn detects_missing_and_extra_placeholders_as_multisets() {
        let mismatch = placeholder_mismatch(
            "Click {button} to run %s. See <b>docs</b>.",
            "点击 {button} 运行。<b>见<i>文档</i></b>。",
        )
        .expect("mismatch");
        assert_eq!(mismatch.missing, vec!["%s"]);
        assert_eq!(mismatch.extra, vec!["</i>", "<i>"]);

        let duplicated = placeholder_mismatch("{{name}} and {{name}}", "{{name}} 已就绪")
            .expect("duplicated token counts");
        assert_eq!(duplicated.missing, vec!["{{name}}"]);
        assert!(duplicated.extra.is_empty());
    }

    #[test]
    fn intact_placeholders_and_plain_text_report_no_mismatch() {
        assert!(placeholder_mismatch("Save {file} as &amp;", "另存 {file} 为 &amp;").is_none());
        assert!(placeholder_mismatch("Plain sentence.", "普通句子。").is_none());
        assert!(placeholder_tokens("保留期为 30 天。").is_empty());
    }

    #[test]
    fn hashes_include_context() {
        let (source_a, context_a) = segment_hashes("Same", Some("Before"), None);
        let (source_b, context_b) = segment_hashes("Same", Some("Other"), None);
        assert_eq!(source_a, source_b);
        assert_ne!(context_a, context_b);
    }

    #[test]
    fn legacy_project_configuration_ignores_removed_review_flag() {
        let configuration: ProjectConfiguration =
            serde_json::from_str(r#"{"reviewRequired": true}"#)
                .expect("deserialize legacy project configuration");
        assert_eq!(configuration, ProjectConfiguration::default());
    }
}

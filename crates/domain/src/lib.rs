use std::path::Path;
use std::sync::LazyLock;

use regex::Regex;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use thiserror::Error;
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

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    pub source_locale: String,
    pub target_locale: String,
    pub domain: String,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Document {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub format: String,
    pub source_sha256: String,
    pub segment_count: u32,
    pub imported_at_ms: i64,
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

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ImportedUnit {
    pub ordinal: u32,
    pub structural_path: String,
    pub source_text: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FilterEvent {
    StartDocument,
    StartUnit {
        ordinal: u32,
        structural_path: String,
    },
    Text(String),
    EndUnit,
    EndDocument,
}

pub trait DocumentFilter {
    fn extract_events(&self, source: &Path) -> Result<Vec<FilterEvent>, FilterError>;
}

pub fn collect_imported_units(
    events: Vec<FilterEvent>,
) -> Result<Vec<ImportedUnit>, PipelineError> {
    let mut events = events.into_iter();
    if !matches!(events.next(), Some(FilterEvent::StartDocument)) {
        return Err(PipelineError::InvalidSequence(
            "event stream must begin with StartDocument".to_string(),
        ));
    }

    let mut units = Vec::new();
    let mut current: Option<ImportedUnit> = None;
    let mut ended = false;
    for event in events {
        if ended {
            return Err(PipelineError::InvalidSequence(
                "event found after EndDocument".to_string(),
            ));
        }
        match event {
            FilterEvent::StartDocument => {
                return Err(PipelineError::InvalidSequence(
                    "nested StartDocument event".to_string(),
                ));
            }
            FilterEvent::StartUnit {
                ordinal,
                structural_path,
            } => {
                if current.is_some() {
                    return Err(PipelineError::InvalidSequence(
                        "nested StartUnit event".to_string(),
                    ));
                }
                current = Some(ImportedUnit {
                    ordinal,
                    structural_path,
                    source_text: String::new(),
                });
            }
            FilterEvent::Text(text) => current
                .as_mut()
                .ok_or_else(|| {
                    PipelineError::InvalidSequence("Text event outside a unit".to_string())
                })?
                .source_text
                .push_str(&text),
            FilterEvent::EndUnit => {
                let unit = current.take().ok_or_else(|| {
                    PipelineError::InvalidSequence("EndUnit without StartUnit".to_string())
                })?;
                if normalize_text(&unit.source_text).is_empty() {
                    return Err(PipelineError::EmptyUnit(unit.structural_path));
                }
                units.push(unit);
            }
            FilterEvent::EndDocument => {
                if current.is_some() {
                    return Err(PipelineError::InvalidSequence(
                        "EndDocument while a unit is open".to_string(),
                    ));
                }
                ended = true;
            }
        }
    }

    if !ended {
        return Err(PipelineError::InvalidSequence(
            "event stream must end with EndDocument".to_string(),
        ));
    }
    Ok(units)
}

#[derive(Debug, Error)]
pub enum FilterError {
    #[error("unsupported document: {0}")]
    Unsupported(String),
    #[error("invalid document: {0}")]
    Invalid(String),
    #[error("document I/O failed: {0}")]
    Io(#[from] std::io::Error),
    #[error("document processing failed: {0}")]
    Processing(String),
}

#[derive(Debug, Error)]
pub enum PipelineError {
    #[error("invalid filter event sequence: {0}")]
    InvalidSequence(String),
    #[error("filter emitted an empty unit at {0}")]
    EmptyUnit(String),
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

    #[test]
    fn collects_filter_events_into_units() {
        let units = collect_imported_units(vec![
            FilterEvent::StartDocument,
            FilterEvent::StartUnit {
                ordinal: 0,
                structural_path: "word/document.xml#p:0".to_string(),
            },
            FilterEvent::Text("Hello ".to_string()),
            FilterEvent::Text("world".to_string()),
            FilterEvent::EndUnit,
            FilterEvent::EndDocument,
        ])
        .expect("valid event stream");
        assert_eq!(units.len(), 1);
        assert_eq!(units[0].source_text, "Hello world");
    }

    #[test]
    fn rejects_incomplete_filter_streams() {
        let error = collect_imported_units(vec![FilterEvent::StartDocument])
            .expect_err("missing EndDocument must fail");
        assert!(matches!(error, PipelineError::InvalidSequence(_)));
    }
}

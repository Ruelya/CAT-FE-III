//! Offline quality intelligence: QE scoring, semantic QA, term extraction.

use std::collections::BTreeMap;

use regex::Regex;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AiQualityError {
    #[error("invalid quality input: {0}")]
    InvalidInput(String),
}

pub type Result<T> = std::result::Result<T, AiQualityError>;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct QualitySegment {
    pub segment_id: String,
    pub ordinal: u32,
    pub source_text: String,
    pub target_text: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum QualityRoute {
    Auto,
    Review,
    Human,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ScoreFactor {
    pub code: String,
    pub delta: i32,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SegmentQualityScore {
    pub segment_id: String,
    pub ordinal: u32,
    pub score: u8,
    pub route: QualityRoute,
    pub factors: Vec<ScoreFactor>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct QualityScoreReport {
    pub document_id: String,
    pub scores: Vec<SegmentQualityScore>,
    pub auto_count: u32,
    pub review_count: u32,
    pub human_count: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum SemanticSeverity {
    Info,
    Warning,
    Error,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SemanticFinding {
    pub segment_id: String,
    pub ordinal: u32,
    pub code: String,
    pub severity: SemanticSeverity,
    pub confidence_basis_points: u16,
    pub message: String,
    pub evidence: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SemanticQaReport {
    pub document_id: String,
    pub findings: Vec<SemanticFinding>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TermExtractOptions {
    pub minimum_frequency: u32,
    pub maximum_candidates: u32,
}

impl Default for TermExtractOptions {
    fn default() -> Self {
        Self {
            minimum_frequency: 2,
            maximum_candidates: 50,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TermCandidate {
    pub source_term: String,
    pub suggested_target: Option<String>,
    pub frequency: u32,
    pub example_segment_ids: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TermExtractReport {
    pub document_id: String,
    pub candidates: Vec<TermCandidate>,
}

pub fn score_document(
    document_id: impl Into<String>,
    segments: &[QualitySegment],
) -> Result<QualityScoreReport> {
    let document_id = require_id(document_id.into(), "document id")?;
    let mut scores = Vec::with_capacity(segments.len());
    let mut auto_count = 0_u32;
    let mut review_count = 0_u32;
    let mut human_count = 0_u32;
    for segment in segments {
        let scored = score_segment(segment)?;
        match scored.route {
            QualityRoute::Auto => auto_count += 1,
            QualityRoute::Review => review_count += 1,
            QualityRoute::Human => human_count += 1,
        }
        scores.push(scored);
    }
    Ok(QualityScoreReport {
        document_id,
        scores,
        auto_count,
        review_count,
        human_count,
    })
}

pub fn semantic_qa_document(
    document_id: impl Into<String>,
    segments: &[QualitySegment],
) -> Result<SemanticQaReport> {
    let document_id = require_id(document_id.into(), "document id")?;
    let mut findings = Vec::new();
    for segment in segments {
        findings.extend(semantic_findings(segment)?);
    }
    Ok(SemanticQaReport {
        document_id,
        findings,
    })
}

pub fn extract_terms(
    document_id: impl Into<String>,
    segments: &[QualitySegment],
    options: TermExtractOptions,
) -> Result<TermExtractReport> {
    let document_id = require_id(document_id.into(), "document id")?;
    if options.minimum_frequency == 0 {
        return Err(AiQualityError::InvalidInput(
            "minimumFrequency must be >= 1".into(),
        ));
    }
    if options.maximum_candidates == 0 {
        return Err(AiQualityError::InvalidInput(
            "maximumCandidates must be >= 1".into(),
        ));
    }
    let mut counts: BTreeMap<String, u32> = BTreeMap::new();
    let mut examples: BTreeMap<String, Vec<String>> = BTreeMap::new();
    let mut targets: BTreeMap<String, BTreeMap<String, u32>> = BTreeMap::new();
    for segment in segments {
        for term in candidate_terms(&segment.source_text) {
            *counts.entry(term.clone()).or_default() += 1;
            let list = examples.entry(term.clone()).or_default();
            if list.len() < 5 {
                list.push(segment.segment_id.clone());
            }
            let target = normalize_space(&segment.target_text);
            if !target.is_empty() {
                *targets.entry(term).or_default().entry(target).or_default() += 1;
            }
        }
    }
    let mut candidates = counts
        .into_iter()
        .filter(|(_, frequency)| *frequency >= options.minimum_frequency)
        .map(|(source_term, frequency)| {
            let suggested_target = targets.get(&source_term).and_then(|map| {
                let mut ranked = map.iter().collect::<Vec<_>>();
                ranked.sort_by(|left, right| right.1.cmp(left.1).then_with(|| left.0.cmp(right.0)));
                ranked.first().and_then(|(term, count)| {
                    // Strict majority only: ties / exact half leave suggested_target empty.
                    if **count * 2 > frequency {
                        Some((*term).clone())
                    } else {
                        None
                    }
                })
            });
            TermCandidate {
                example_segment_ids: examples.get(&source_term).cloned().unwrap_or_default(),
                source_term,
                suggested_target,
                frequency,
            }
        })
        .collect::<Vec<_>>();
    candidates.sort_by(|left, right| {
        right
            .frequency
            .cmp(&left.frequency)
            .then_with(|| left.source_term.cmp(&right.source_term))
    });
    candidates.truncate(options.maximum_candidates as usize);
    Ok(TermExtractReport {
        document_id,
        candidates,
    })
}

fn score_segment(segment: &QualitySegment) -> Result<SegmentQualityScore> {
    require_id(segment.segment_id.clone(), "segment id")?;
    let source = segment.source_text.trim();
    let target = segment.target_text.trim();
    let mut score = 100_i32;
    let mut factors = Vec::new();

    if target.is_empty() {
        push_factor(
            &mut factors,
            &mut score,
            "empty_target",
            -70,
            "Target is empty",
        );
    } else if !source.is_empty() && source == target {
        push_factor(
            &mut factors,
            &mut score,
            "source_equals_target",
            -45,
            "Target equals source",
        );
    }

    if !source.is_empty() && !target.is_empty() {
        let ratio = target.chars().count() as f64 / source.chars().count() as f64;
        if ratio < 0.35 {
            push_factor(
                &mut factors,
                &mut score,
                "length_collapse",
                -25,
                "Target is much shorter than source",
            );
        } else if ratio > 2.5 {
            push_factor(
                &mut factors,
                &mut score,
                "length_expansion",
                -10,
                "Target is much longer than source",
            );
        }
    }

    let source_numbers = number_tokens(source);
    let target_numbers = number_tokens(target);
    if source_numbers != target_numbers {
        push_factor(
            &mut factors,
            &mut score,
            "number_mismatch",
            -20,
            "Number tokens differ between source and target",
        );
    }

    let source_placeholders = placeholder_tokens(source);
    let target_placeholders = placeholder_tokens(target);
    if source_placeholders != target_placeholders {
        push_factor(
            &mut factors,
            &mut score,
            "placeholder_mismatch",
            -25,
            "Placeholder tokens differ between source and target",
        );
    }

    if negation_mismatch(source, target) {
        push_factor(
            &mut factors,
            &mut score,
            "negation_mismatch",
            -30,
            "Negation cues appear mismatched",
        );
    }

    if !source.is_empty()
        && !target.is_empty()
        && punctuation_signature(source) != punctuation_signature(target)
    {
        push_factor(
            &mut factors,
            &mut score,
            "punctuation_mismatch",
            -15,
            "Sentence punctuation kinds differ between source and target",
        );
    }

    let score = score.clamp(0, 100) as u8;
    let route = route_for_score(score);
    Ok(SegmentQualityScore {
        segment_id: segment.segment_id.clone(),
        ordinal: segment.ordinal,
        score,
        route,
        factors,
    })
}

fn semantic_findings(segment: &QualitySegment) -> Result<Vec<SemanticFinding>> {
    require_id(segment.segment_id.clone(), "segment id")?;
    let source = segment.source_text.trim();
    let target = segment.target_text.trim();
    let mut findings = Vec::new();
    if target.is_empty() {
        findings.push(finding(
            segment,
            "semantic.empty_target",
            SemanticSeverity::Error,
            9500,
            "Target translation is empty",
            "target is empty",
        ));
    }
    if !source.is_empty() && source == target {
        findings.push(finding(
            segment,
            "semantic.source_equals_target",
            SemanticSeverity::Warning,
            9000,
            "Target is identical to source",
            &format!("text={source}"),
        ));
    }
    if number_tokens(source) != number_tokens(target) {
        findings.push(finding(
            segment,
            "semantic.number_mismatch",
            SemanticSeverity::Error,
            8800,
            "Numbers differ between source and target",
            &format!(
                "source={:?}; target={:?}",
                number_tokens(source),
                number_tokens(target)
            ),
        ));
    }
    if negation_mismatch(source, target) {
        findings.push(finding(
            segment,
            "semantic.negation_mismatch",
            SemanticSeverity::Warning,
            7500,
            "Negation may be reversed or dropped",
            "negation cue mismatch",
        ));
    }
    if !source.is_empty() && !target.is_empty() {
        let ratio = target.chars().count() as f64 / source.chars().count() as f64;
        if ratio < 0.3 {
            findings.push(finding(
                segment,
                "semantic.length_collapse",
                SemanticSeverity::Warning,
                7000,
                "Target collapsed relative to source length",
                &format!("ratio={ratio:.2}"),
            ));
        }
    }
    Ok(findings)
}

fn finding(
    segment: &QualitySegment,
    code: &str,
    severity: SemanticSeverity,
    confidence_basis_points: u16,
    message: &str,
    evidence: &str,
) -> SemanticFinding {
    SemanticFinding {
        segment_id: segment.segment_id.clone(),
        ordinal: segment.ordinal,
        code: code.to_string(),
        severity,
        confidence_basis_points,
        message: message.to_string(),
        evidence: evidence.chars().take(500).collect(),
    }
}

fn push_factor(
    factors: &mut Vec<ScoreFactor>,
    score: &mut i32,
    code: &str,
    delta: i32,
    message: &str,
) {
    *score += delta;
    factors.push(ScoreFactor {
        code: code.to_string(),
        delta,
        message: message.to_string(),
    });
}

fn route_for_score(score: u8) -> QualityRoute {
    if score >= 85 {
        QualityRoute::Auto
    } else if score >= 60 {
        QualityRoute::Review
    } else {
        QualityRoute::Human
    }
}

fn number_tokens(text: &str) -> Vec<String> {
    static RE: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    let re = RE.get_or_init(|| Regex::new(r"\d+(?:[.,]\d+)?").expect("number regex"));
    let mut values = re
        .find_iter(text)
        .map(|item| item.as_str().to_string())
        .collect::<Vec<_>>();
    values.sort();
    values
}

/// Language-safe punctuation multiset: ASCII and CJK sentence marks map to the same kind.
fn punctuation_signature(text: &str) -> Vec<&'static str> {
    let mut kinds = text
        .chars()
        .filter_map(|character| match character {
            '.' | '。' => Some("period"),
            '?' | '？' => Some("question"),
            '!' | '！' => Some("exclamation"),
            ';' | '；' => Some("semicolon"),
            ':' | '：' => Some("colon"),
            '…' => Some("ellipsis"),
            _ => None,
        })
        .collect::<Vec<_>>();
    kinds.sort_unstable();
    kinds
}

fn placeholder_tokens(text: &str) -> Vec<String> {
    static RE: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    let re = RE.get_or_init(|| {
        Regex::new(r"\{[^{}]+\}|%\d+\$?[sd]|</?[^>]+>").expect("placeholder regex")
    });
    let mut values = re
        .find_iter(text)
        .map(|item| item.as_str().to_string())
        .collect::<Vec<_>>();
    values.sort();
    values
}

fn negation_mismatch(source: &str, target: &str) -> bool {
    let source_neg = has_negation(source);
    let target_neg = has_negation(target);
    source_neg != target_neg && (!source.trim().is_empty() && !target.trim().is_empty())
}

fn has_negation(text: &str) -> bool {
    let lower = text.to_lowercase();
    [
        " not ",
        "n't",
        " no ",
        " never ",
        " neither ",
        "无法",
        "不能",
        "没有",
        "未",
        "非",
        "不",
    ]
    .iter()
    .any(|cue| {
        if cue.is_ascii() {
            format!(" {lower} ").contains(cue)
        } else {
            lower.contains(cue)
        }
    })
}

fn candidate_terms(source: &str) -> Vec<String> {
    static RE: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    let re = RE.get_or_init(|| Regex::new(r"[A-Za-z][A-Za-z0-9_-]{2,}").expect("term regex"));
    let mut terms = re
        .find_iter(source)
        .map(|item| item.as_str().to_lowercase())
        .filter(|term| !STOPWORDS.contains(&term.as_str()))
        .collect::<Vec<_>>();
    terms.sort();
    terms.dedup();
    terms
}

const STOPWORDS: &[&str] = &[
    "the", "and", "for", "with", "from", "that", "this", "are", "was", "were", "have", "has",
    "been", "will", "can", "into", "your", "their", "about",
];

fn normalize_space(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn require_id(value: String, label: &str) -> Result<String> {
    if value.trim().is_empty() {
        return Err(AiQualityError::InvalidInput(format!(
            "{label} must not be empty"
        )));
    }
    Ok(value)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn seg(id: &str, ordinal: u32, source: &str, target: &str) -> QualitySegment {
        QualitySegment {
            segment_id: id.into(),
            ordinal,
            source_text: source.into(),
            target_text: target.into(),
        }
    }

    #[test]
    fn scores_and_routes_deterministically() {
        let segments = vec![
            seg("s1", 0, "Hello world", "你好世界"),
            seg("s2", 1, "Hello world", ""),
            seg("s3", 2, "Order 12 items", "Order 12 items"),
        ];
        let first = score_document("doc", &segments).unwrap();
        let second = score_document("doc", &segments).unwrap();
        assert_eq!(first, second);
        assert_eq!(first.scores[0].route, QualityRoute::Auto);
        assert_eq!(first.scores[1].route, QualityRoute::Human);
        assert!(first.human_count >= 1);
    }

    #[test]
    fn semantic_qa_detects_planted_issues() {
        let report = semantic_qa_document(
            "doc",
            &[
                seg("a", 0, "Enabled", ""),
                seg("b", 1, "Do not delete", "Delete now"),
                seg("c", 2, "Ship 5 units", "Ship units"),
            ],
        )
        .unwrap();
        let codes = report
            .findings
            .iter()
            .map(|item| item.code.as_str())
            .collect::<Vec<_>>();
        assert!(codes.contains(&"semantic.empty_target"));
        assert!(codes.contains(&"semantic.number_mismatch"));
        assert!(codes.contains(&"semantic.negation_mismatch"));
    }

    #[test]
    fn extracts_repeated_terms_without_writing_termbase() {
        let report = extract_terms(
            "doc",
            &[
                seg("1", 0, "Replace the actuator housing", "更换执行器外壳"),
                seg("2", 1, "Clean the actuator housing", "清洁执行器外壳"),
                seg("3", 2, "Inspect housing only", "仅检查外壳"),
            ],
            TermExtractOptions {
                minimum_frequency: 2,
                maximum_candidates: 10,
            },
        )
        .unwrap();
        assert!(
            report
                .candidates
                .iter()
                .any(|item| item.source_term == "actuator" && item.frequency >= 2)
        );
    }

    #[test]
    fn suggested_target_uses_strict_majority_not_tie() {
        let options = TermExtractOptions {
            minimum_frequency: 2,
            maximum_candidates: 10,
        };

        let stable = extract_terms(
            "doc",
            &[
                seg("1", 0, "Replace the actuator housing", "更换执行器外壳"),
                seg("2", 1, "Clean the actuator housing", "更换执行器外壳"),
            ],
            options.clone(),
        )
        .unwrap();
        let actuator = stable
            .candidates
            .iter()
            .find(|item| item.source_term == "actuator")
            .expect("actuator candidate");
        assert_eq!(actuator.frequency, 2);
        assert_eq!(
            actuator.suggested_target.as_deref(),
            Some("更换执行器外壳"),
            "repeated identical target is a strict majority"
        );

        let conflicting = extract_terms(
            "doc",
            &[
                seg("1", 0, "Replace the actuator housing", "更换执行器外壳"),
                seg("2", 1, "Clean the actuator housing", "清洁执行器外壳"),
            ],
            options,
        )
        .unwrap();
        let actuator = conflicting
            .candidates
            .iter()
            .find(|item| item.source_term == "actuator")
            .expect("actuator candidate");
        assert_eq!(actuator.frequency, 2);
        assert_eq!(
            actuator.suggested_target, None,
            "50/50 split must leave suggested_target empty"
        );
    }

    #[test]
    fn punctuation_mismatch_factor_affects_score() {
        // CJK period is treated as the same kind as ASCII period (language-safe).
        let clean = score_document("doc", &[seg("ok", 0, "Hello world.", "你好世界。")]).unwrap();
        assert_eq!(clean.scores[0].score, 100);
        assert_eq!(clean.scores[0].route, QualityRoute::Auto);
        assert!(
            clean.scores[0]
                .factors
                .iter()
                .all(|factor| factor.code != "punctuation_mismatch")
        );

        // Same wording length; only terminal punctuation kind differs.
        let mismatched = score_document("doc", &[seg("bad", 0, "Done!", "Done.")]).unwrap();
        let score = &mismatched.scores[0];
        assert!(
            score
                .factors
                .iter()
                .any(|factor| factor.code == "punctuation_mismatch" && factor.delta == -15)
        );
        assert_eq!(score.score, 85);
        assert_eq!(score.route, QualityRoute::Auto);
    }
}

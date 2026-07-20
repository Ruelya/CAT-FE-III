//! Deterministic, provider-free QA rules and report serialization.

use std::collections::{BTreeMap, BTreeSet};
use std::io::{Cursor, Read, Write};

use regex::{Regex, RegexBuilder};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use thiserror::Error;
use translunar_domain::{QaSeverity, ReviewRevision, normalize_text, number_mismatch, sha256_hex};
use translunar_filter_office_core::{OfficePackage, validate_xml};
use zip::ZipArchive;
use zip::write::{SimpleFileOptions, ZipWriter};

pub const STANDARD_PROFILE_ID: &str = "builtin.qa.standard";
pub const CJK_PROFILE_ID: &str = "builtin.qa.cjk-professional";
pub const MAX_REGEX_RULES: usize = 100;
pub const MAX_REGEX_PATTERN_BYTES: usize = 4_096;
pub const MAX_EVIDENCE_VALUES: usize = 32;
pub const MAX_EVIDENCE_VALUE_CHARS: usize = 256;

#[derive(Debug, Error)]
pub enum QaCoreError {
    #[error("invalid QA profile: {0}")]
    InvalidProfile(String),
    #[error("QA report serialization failed: {0}")]
    Report(String),
    #[error("QA report package is invalid: {0}")]
    InvalidReport(String),
    #[error("QA report I/O failed: {0}")]
    Io(#[from] std::io::Error),
    #[error("QA report ZIP failed: {0}")]
    Zip(#[from] zip::result::ZipError),
}

#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, JsonSchema,
)]
#[serde(rename_all = "camelCase")]
pub enum QaCategory {
    Completeness,
    Numbers,
    Tags,
    Punctuation,
    Whitespace,
    Repetition,
    Length,
    Terminology,
    Consistency,
    Custom,
}

impl QaCategory {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Completeness => "completeness",
            Self::Numbers => "numbers",
            Self::Tags => "tags",
            Self::Punctuation => "punctuation",
            Self::Whitespace => "whitespace",
            Self::Repetition => "repetition",
            Self::Length => "length",
            Self::Terminology => "terminology",
            Self::Consistency => "consistency",
            Self::Custom => "custom",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum QaField {
    Source,
    Target,
    Both,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct QaRegexRule {
    pub id: String,
    pub label: String,
    pub field: QaField,
    pub pattern: String,
    pub severity: QaSeverity,
    pub message: String,
    #[serde(default)]
    pub replacement_hint: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct QaRuleSettings {
    pub max_target_chars: Option<u32>,
    pub min_length_ratio_percent: u16,
    pub max_length_ratio_percent: u16,
    pub cjk_spacing: bool,
    pub cjk_punctuation: bool,
    pub require_sentence_final_punctuation: bool,
}

impl Default for QaRuleSettings {
    fn default() -> Self {
        Self {
            max_target_chars: None,
            min_length_ratio_percent: 35,
            max_length_ratio_percent: 300,
            cjk_spacing: true,
            cjk_punctuation: true,
            require_sentence_final_punctuation: true,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct QaProfileDefinition {
    pub id: String,
    pub name: String,
    pub enabled_rule_ids: BTreeSet<String>,
    #[serde(default)]
    pub severity_overrides: BTreeMap<String, QaSeverity>,
    pub settings: QaRuleSettings,
    #[serde(default)]
    pub regex_rules: Vec<QaRegexRule>,
}

#[derive(Debug)]
pub struct CompiledQaProfile {
    definition: QaProfileDefinition,
    regex_rules: Vec<(QaRegexRule, Regex)>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct QaSpan {
    pub start: u32,
    pub end: u32,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct QaCandidateEvidence {
    #[serde(default)]
    pub source_numbers: Vec<String>,
    #[serde(default)]
    pub target_numbers: Vec<String>,
    #[serde(default)]
    pub source_values: Vec<String>,
    #[serde(default)]
    pub target_values: Vec<String>,
    #[serde(default)]
    pub source_spans: Vec<QaSpan>,
    #[serde(default)]
    pub target_spans: Vec<QaSpan>,
    #[serde(default)]
    pub related_segment_ids: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct QaFindingCandidate {
    pub segment_id: String,
    pub rule_id: String,
    pub category: QaCategory,
    pub severity: QaSeverity,
    pub message: String,
    pub fingerprint: String,
    pub evidence: QaCandidateEvidence,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct QaTagFinding {
    pub code: String,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct QaTermExpectation {
    pub id: String,
    pub source_term: String,
    pub preferred_targets: Vec<String>,
    pub forbidden_targets: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct QaSegmentInput {
    pub segment_id: String,
    pub source_text: String,
    pub target_text: String,
    pub source_locale: String,
    pub target_locale: String,
    pub tag_findings: Vec<QaTagFinding>,
    pub terms: Vec<QaTermExpectation>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct QaConsistencySegment {
    pub segment_id: String,
    pub source_text: String,
    pub target_text: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct QaReportItem {
    pub document_name: String,
    pub segment_id: String,
    pub segment_ordinal: u32,
    pub category: QaCategory,
    pub rule_id: String,
    pub severity: QaSeverity,
    pub disposition: String,
    pub message: String,
    pub source_evidence: String,
    pub target_evidence: String,
    pub waiver_actor: Option<String>,
    pub waiver_reason: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct QaReportSnapshot {
    pub project_name: String,
    pub scope_name: String,
    pub run_id: String,
    pub profile_name: String,
    pub created_at_ms: i64,
    pub checked_segments: u64,
    pub errors: u64,
    pub warnings: u64,
    pub info: u64,
    pub waived: u64,
    pub items: Vec<QaReportItem>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct QaProfile {
    pub id: String,
    pub name: String,
    pub owner_project_id: Option<String>,
    pub built_in: bool,
    pub definition: QaProfileDefinition,
    pub revision: u64,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum QaRunScope {
    Document,
    Project,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum QaRunStatus {
    Running,
    Succeeded,
    Failed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct QaRun {
    pub id: String,
    pub project_id: String,
    pub document_id: Option<String>,
    pub scope: QaRunScope,
    pub profile_id: String,
    pub profile_name: String,
    pub profile_revision: u64,
    pub profile_snapshot_hash: String,
    pub status: QaRunStatus,
    pub checked_segments: u64,
    pub errors: u64,
    pub warnings: u64,
    pub info: u64,
    pub waived: u64,
    pub created_at_ms: i64,
    pub completed_at_ms: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct QaWaiver {
    pub id: String,
    pub issue_id: String,
    pub fingerprint: String,
    pub reason: String,
    pub actor: String,
    pub revision: u64,
    pub created_at_ms: i64,
    pub revoked_at_ms: Option<i64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum QaIssueDisposition {
    Open,
    Waived,
    Resolved,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct QaIssueView {
    pub id: String,
    pub project_id: String,
    pub document_id: String,
    pub document_name: String,
    pub segment_id: String,
    pub segment_ordinal: u32,
    pub rule_id: String,
    pub category: QaCategory,
    pub severity: QaSeverity,
    pub disposition: QaIssueDisposition,
    pub message: String,
    pub fingerprint: String,
    pub evidence: QaCandidateEvidence,
    pub profile_id: Option<String>,
    pub run_id: Option<String>,
    pub waiver: Option<QaWaiver>,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct QaGateResult {
    pub document_id: String,
    pub clear: bool,
    pub run: QaRun,
    pub blocker_issue_ids: Vec<String>,
    pub error_count: u64,
    pub warning_count: u64,
    pub info_count: u64,
    pub waived_count: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum QaReportFormat {
    Html,
    Xlsx,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct QaReportRecord {
    pub id: String,
    pub run_id: String,
    pub format: QaReportFormat,
    pub output_path: String,
    pub created_at_ms: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum QaOverrideStatus {
    Pending,
    Succeeded,
    Failed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct QaExportOverride {
    pub id: String,
    pub project_id: String,
    pub document_id: String,
    pub run_id: String,
    pub actor: String,
    pub reason: String,
    pub error_count: u64,
    pub destination_name: String,
    pub status: QaOverrideStatus,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReviewerStatistic {
    pub reviewer: String,
    pub accepted: u64,
    pub rejected: u64,
    pub pending: u64,
    pub reviewed_characters: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReviewStatistics {
    pub project_id: String,
    pub document_id: Option<String>,
    pub translation_segments: u64,
    pub review_segments: u64,
    pub signed_segments: u64,
    pub pending_revisions: u64,
    pub accepted_revisions: u64,
    pub rejected_revisions: u64,
    pub reviewed_characters: u64,
    pub reviewers: Vec<ReviewerStatistic>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReviewQueueItem {
    pub revision: ReviewRevision,
    pub project_id: String,
    pub document_id: String,
    pub document_name: String,
    pub segment_ordinal: u32,
}

impl CompiledQaProfile {
    pub fn compile(definition: QaProfileDefinition) -> Result<Self, QaCoreError> {
        validate_profile(&definition)?;
        let regex_rules = definition
            .regex_rules
            .iter()
            .map(|rule| {
                RegexBuilder::new(&rule.pattern)
                    .size_limit(1 << 20)
                    .dfa_size_limit(1 << 20)
                    .build()
                    .map(|compiled| (rule.clone(), compiled))
                    .map_err(|error| {
                        QaCoreError::InvalidProfile(format!(
                            "regex rule {} cannot compile: {error}",
                            rule.id
                        ))
                    })
            })
            .collect::<Result<Vec<_>, _>>()?;
        Ok(Self {
            definition,
            regex_rules,
        })
    }

    pub fn definition(&self) -> &QaProfileDefinition {
        &self.definition
    }

    pub fn evaluate_segment(&self, input: &QaSegmentInput) -> Vec<QaFindingCandidate> {
        let mut findings = Vec::new();
        self.evaluate_completeness(input, &mut findings);
        self.evaluate_numbers(input, &mut findings);
        self.evaluate_tags(input, &mut findings);
        self.evaluate_punctuation(input, &mut findings);
        self.evaluate_whitespace(input, &mut findings);
        self.evaluate_repetition(input, &mut findings);
        self.evaluate_length(input, &mut findings);
        self.evaluate_terms(input, &mut findings);
        self.evaluate_regex(input, &mut findings);
        findings.sort_by(|left, right| {
            left.category
                .cmp(&right.category)
                .then_with(|| left.rule_id.cmp(&right.rule_id))
                .then_with(|| left.fingerprint.cmp(&right.fingerprint))
        });
        findings
    }

    fn enabled(&self, rule_id: &str) -> bool {
        self.definition.enabled_rule_ids.contains(rule_id)
            || [
                ("qa.regex:", "qa.regex"),
                ("qa.term-required:", "qa.term-required"),
                ("qa.term-forbidden:", "qa.term-forbidden"),
                ("qa.tag-", "qa.tag"),
            ]
            .into_iter()
            .any(|(prefix, family)| {
                rule_id.starts_with(prefix) && self.definition.enabled_rule_ids.contains(family)
            })
    }

    fn severity(&self, rule_id: &str, fallback: QaSeverity) -> QaSeverity {
        self.definition
            .severity_overrides
            .get(rule_id)
            .copied()
            .unwrap_or(fallback)
    }

    fn push(
        &self,
        findings: &mut Vec<QaFindingCandidate>,
        input: &QaSegmentInput,
        rule_id: &str,
        classification: (QaCategory, QaSeverity),
        message: impl Into<String>,
        evidence: QaCandidateEvidence,
    ) {
        if !self.enabled(rule_id) {
            return;
        }
        let evidence = bound_evidence(evidence);
        let fingerprint = finding_fingerprint(rule_id, &input.segment_id, &evidence);
        findings.push(QaFindingCandidate {
            segment_id: input.segment_id.clone(),
            rule_id: rule_id.to_string(),
            category: classification.0,
            severity: self.severity(rule_id, classification.1),
            message: message.into(),
            fingerprint,
            evidence,
        });
    }

    fn evaluate_completeness(
        &self,
        input: &QaSegmentInput,
        findings: &mut Vec<QaFindingCandidate>,
    ) {
        if !input.source_text.trim().is_empty() && input.target_text.trim().is_empty() {
            self.push(
                findings,
                input,
                "qa.empty-target",
                (QaCategory::Completeness, QaSeverity::Error),
                "Target is empty.",
                QaCandidateEvidence::default(),
            );
            return;
        }
        if !input.target_text.trim().is_empty()
            && normalize_text(&input.source_text) == normalize_text(&input.target_text)
            && input.source_text.chars().any(char::is_alphabetic)
        {
            self.push(
                findings,
                input,
                "qa.source-equals-target",
                (QaCategory::Completeness, QaSeverity::Warning),
                "Source and target are identical.",
                QaCandidateEvidence {
                    source_values: vec![input.source_text.clone()],
                    target_values: vec![input.target_text.clone()],
                    ..QaCandidateEvidence::default()
                },
            );
        }
    }

    fn evaluate_numbers(&self, input: &QaSegmentInput, findings: &mut Vec<QaFindingCandidate>) {
        if input.target_text.trim().is_empty() {
            return;
        }
        if let Some(evidence) = number_mismatch(&input.source_text, &input.target_text) {
            self.push(
                findings,
                input,
                "qa.number-mismatch",
                (QaCategory::Numbers, QaSeverity::Error),
                "Source and target numbers differ.",
                QaCandidateEvidence {
                    source_numbers: evidence.source_numbers,
                    target_numbers: evidence.target_numbers,
                    ..QaCandidateEvidence::default()
                },
            );
        }
        let source_units = extract_units(&input.source_text);
        let target_units = extract_units(&input.target_text);
        if !source_units.is_empty() && source_units != target_units {
            self.push(
                findings,
                input,
                "qa.unit-mismatch",
                (QaCategory::Numbers, QaSeverity::Error),
                "Source and target units differ.",
                QaCandidateEvidence {
                    source_values: source_units.into_iter().collect(),
                    target_values: target_units.into_iter().collect(),
                    ..QaCandidateEvidence::default()
                },
            );
        }
    }

    fn evaluate_tags(&self, input: &QaSegmentInput, findings: &mut Vec<QaFindingCandidate>) {
        for tag in &input.tag_findings {
            self.push(
                findings,
                input,
                &format!("qa.tag-{}", tag.code),
                (QaCategory::Tags, QaSeverity::Error),
                &tag.message,
                QaCandidateEvidence {
                    target_values: vec![tag.code.clone()],
                    ..QaCandidateEvidence::default()
                },
            );
        }
    }

    fn evaluate_punctuation(&self, input: &QaSegmentInput, findings: &mut Vec<QaFindingCandidate>) {
        if input.target_text.is_empty() {
            return;
        }
        if let Some(value) = first_unbalanced_delimiter(&input.target_text) {
            self.push(
                findings,
                input,
                "qa.unbalanced-delimiter",
                (QaCategory::Punctuation, QaSeverity::Error),
                "Target contains unbalanced brackets or quotation marks.",
                QaCandidateEvidence {
                    target_values: vec![value.to_string()],
                    ..QaCandidateEvidence::default()
                },
            );
        }
        let cjk_target = is_cjk_locale(&input.target_locale);
        if cjk_target && self.definition.settings.cjk_punctuation {
            if let Some((index, value)) = first_cjk_ascii_punctuation(&input.target_text) {
                self.push(
                    findings,
                    input,
                    "qa.cjk-halfwidth-punctuation",
                    (QaCategory::Punctuation, QaSeverity::Warning),
                    "CJK target contains half-width sentence punctuation.",
                    QaCandidateEvidence {
                        target_values: vec![value.to_string()],
                        target_spans: vec![QaSpan {
                            start: index,
                            end: index.saturating_add(1),
                        }],
                        ..QaCandidateEvidence::default()
                    },
                );
            }
            if input.target_text.contains("...") {
                self.push(
                    findings,
                    input,
                    "qa.cjk-ellipsis",
                    (QaCategory::Punctuation, QaSeverity::Warning),
                    "Use the configured CJK ellipsis instead of three periods.",
                    QaCandidateEvidence {
                        target_values: vec!["...".to_string()],
                        ..QaCandidateEvidence::default()
                    },
                );
            }
            if input.target_text.contains("--") {
                self.push(
                    findings,
                    input,
                    "qa.cjk-dash",
                    (QaCategory::Punctuation, QaSeverity::Info),
                    "Use the configured CJK dash form.",
                    QaCandidateEvidence {
                        target_values: vec!["--".to_string()],
                        ..QaCandidateEvidence::default()
                    },
                );
            }
        }
        if self.definition.settings.require_sentence_final_punctuation
            && has_sentence_final(&input.source_text)
            && !has_sentence_final(&input.target_text)
        {
            self.push(
                findings,
                input,
                "qa.missing-final-punctuation",
                (QaCategory::Punctuation, QaSeverity::Warning),
                "Target is missing sentence-final punctuation.",
                QaCandidateEvidence::default(),
            );
        }
    }

    fn evaluate_whitespace(&self, input: &QaSegmentInput, findings: &mut Vec<QaFindingCandidate>) {
        if input.target_text != input.target_text.trim() {
            self.push(
                findings,
                input,
                "qa.edge-whitespace",
                (QaCategory::Whitespace, QaSeverity::Warning),
                "Target has leading or trailing whitespace.",
                QaCandidateEvidence::default(),
            );
        }
        if is_cjk_locale(&input.target_locale)
            && self.definition.settings.cjk_spacing
            && let Some(span) = first_missing_cjk_latin_space(&input.target_text)
        {
            self.push(
                findings,
                input,
                "qa.cjk-latin-spacing",
                (QaCategory::Whitespace, QaSeverity::Info),
                "Check spacing between CJK and Latin text.",
                QaCandidateEvidence {
                    target_spans: vec![span],
                    ..QaCandidateEvidence::default()
                },
            );
        }
    }

    fn evaluate_repetition(&self, input: &QaSegmentInput, findings: &mut Vec<QaFindingCandidate>) {
        if let Some(word) = repeated_word(&input.target_text) {
            self.push(
                findings,
                input,
                "qa.repeated-word",
                (QaCategory::Repetition, QaSeverity::Warning),
                "Target contains a repeated word.",
                QaCandidateEvidence {
                    target_values: vec![word],
                    ..QaCandidateEvidence::default()
                },
            );
        }
    }

    fn evaluate_length(&self, input: &QaSegmentInput, findings: &mut Vec<QaFindingCandidate>) {
        let source_chars = input.source_text.chars().count();
        let target_chars = input.target_text.chars().count();
        if source_chars > 0 && target_chars > 0 {
            let ratio = target_chars.saturating_mul(100) / source_chars;
            if ratio < usize::from(self.definition.settings.min_length_ratio_percent)
                || ratio > usize::from(self.definition.settings.max_length_ratio_percent)
            {
                self.push(
                    findings,
                    input,
                    "qa.length-ratio",
                    (QaCategory::Length, QaSeverity::Warning),
                    "Target length is outside the configured ratio.",
                    QaCandidateEvidence {
                        source_values: vec![source_chars.to_string()],
                        target_values: vec![target_chars.to_string()],
                        ..QaCandidateEvidence::default()
                    },
                );
            }
        }
        if self
            .definition
            .settings
            .max_target_chars
            .is_some_and(|limit| target_chars > limit as usize)
        {
            self.push(
                findings,
                input,
                "qa.target-length-limit",
                (QaCategory::Length, QaSeverity::Error),
                "Target exceeds the configured character limit.",
                QaCandidateEvidence {
                    target_values: vec![target_chars.to_string()],
                    ..QaCandidateEvidence::default()
                },
            );
        }
    }

    fn evaluate_terms(&self, input: &QaSegmentInput, findings: &mut Vec<QaFindingCandidate>) {
        for term in &input.terms {
            if contains_term(&input.source_text, &term.source_term)
                && !term.preferred_targets.is_empty()
                && !term
                    .preferred_targets
                    .iter()
                    .any(|value| contains_term(&input.target_text, value))
            {
                self.push(
                    findings,
                    input,
                    &format!("qa.term-required:{}", term.id),
                    (QaCategory::Terminology, QaSeverity::Error),
                    "Required preferred terminology is missing from the target.",
                    QaCandidateEvidence {
                        source_values: vec![term.source_term.clone()],
                        target_values: term.preferred_targets.clone(),
                        ..QaCandidateEvidence::default()
                    },
                );
            }
            for forbidden in &term.forbidden_targets {
                if contains_term(&input.target_text, forbidden) {
                    self.push(
                        findings,
                        input,
                        &format!("qa.term-forbidden:{}", term.id),
                        (QaCategory::Terminology, QaSeverity::Error),
                        "Forbidden terminology is present in the target.",
                        QaCandidateEvidence {
                            target_values: vec![forbidden.clone()],
                            ..QaCandidateEvidence::default()
                        },
                    );
                }
            }
        }
    }

    fn evaluate_regex(&self, input: &QaSegmentInput, findings: &mut Vec<QaFindingCandidate>) {
        for (rule, regex) in &self.regex_rules {
            for (field, text) in match rule.field {
                QaField::Source => vec![(QaField::Source, input.source_text.as_str())],
                QaField::Target => vec![(QaField::Target, input.target_text.as_str())],
                QaField::Both => vec![
                    (QaField::Source, input.source_text.as_str()),
                    (QaField::Target, input.target_text.as_str()),
                ],
            } {
                for matched in regex.find_iter(text).take(MAX_EVIDENCE_VALUES) {
                    let span = byte_range_to_scalar_span(text, matched.start(), matched.end());
                    let mut evidence = QaCandidateEvidence::default();
                    match field {
                        QaField::Source => {
                            evidence.source_values.push(matched.as_str().to_string());
                            evidence.source_spans.push(span);
                        }
                        QaField::Target | QaField::Both => {
                            evidence.target_values.push(matched.as_str().to_string());
                            evidence.target_spans.push(span);
                        }
                    }
                    self.push(
                        findings,
                        input,
                        &format!("qa.regex:{}", rule.id),
                        (QaCategory::Custom, rule.severity),
                        &rule.message,
                        evidence,
                    );
                }
            }
        }
    }
}

pub fn standard_profile() -> QaProfileDefinition {
    profile_with_id(STANDARD_PROFILE_ID, "Standard", false)
}

pub fn cjk_profile() -> QaProfileDefinition {
    profile_with_id(CJK_PROFILE_ID, "CJK professional", true)
}

pub fn built_in_profiles() -> Vec<QaProfileDefinition> {
    vec![standard_profile(), cjk_profile()]
}

pub fn default_profile_id(target_locale: &str) -> &'static str {
    if is_cjk_locale(target_locale) {
        CJK_PROFILE_ID
    } else {
        STANDARD_PROFILE_ID
    }
}

pub fn validate_profile(profile: &QaProfileDefinition) -> Result<(), QaCoreError> {
    if profile.id.trim().is_empty() || profile.id.len() > 128 {
        return Err(QaCoreError::InvalidProfile(
            "profile ID must contain 1..128 bytes".to_string(),
        ));
    }
    if profile.name.trim().is_empty() || profile.name.chars().count() > 120 {
        return Err(QaCoreError::InvalidProfile(
            "profile name must contain 1..120 characters".to_string(),
        ));
    }
    if profile.regex_rules.len() > MAX_REGEX_RULES {
        return Err(QaCoreError::InvalidProfile(format!(
            "profile exceeds {MAX_REGEX_RULES} regex rules"
        )));
    }
    if profile.settings.min_length_ratio_percent == 0
        || profile.settings.min_length_ratio_percent > profile.settings.max_length_ratio_percent
        || profile.settings.max_length_ratio_percent > 2_000
    {
        return Err(QaCoreError::InvalidProfile(
            "length ratio must satisfy 1 <= min <= max <= 2000".to_string(),
        ));
    }
    let mut ids = BTreeSet::new();
    for rule in &profile.regex_rules {
        if rule.id.trim().is_empty()
            || rule.id.len() > 96
            || !rule
                .id
                .chars()
                .all(|value| value.is_ascii_alphanumeric() || matches!(value, '.' | '_' | '-'))
        {
            return Err(QaCoreError::InvalidProfile(
                "regex rule ID must be 1..96 safe ASCII characters".to_string(),
            ));
        }
        if !ids.insert(rule.id.as_str()) {
            return Err(QaCoreError::InvalidProfile(format!(
                "duplicate regex rule ID {}",
                rule.id
            )));
        }
        if rule.pattern.is_empty() || rule.pattern.len() > MAX_REGEX_PATTERN_BYTES {
            return Err(QaCoreError::InvalidProfile(format!(
                "regex rule {} pattern must contain 1..{MAX_REGEX_PATTERN_BYTES} bytes",
                rule.id
            )));
        }
        if rule.label.trim().is_empty()
            || rule.label.chars().count() > 120
            || rule.message.trim().is_empty()
            || rule.message.chars().count() > 500
            || rule
                .replacement_hint
                .as_ref()
                .is_some_and(|value| value.chars().count() > 500)
        {
            return Err(QaCoreError::InvalidProfile(format!(
                "regex rule {} labels/messages exceed bounds",
                rule.id
            )));
        }
    }
    Ok(())
}

pub fn evaluate_consistency(
    profile: &QaProfileDefinition,
    segments: &[QaConsistencySegment],
) -> Vec<QaFindingCandidate> {
    let mut by_source: BTreeMap<String, Vec<&QaConsistencySegment>> = BTreeMap::new();
    let mut by_target: BTreeMap<String, Vec<&QaConsistencySegment>> = BTreeMap::new();
    for segment in segments {
        let source = normalize_text(&segment.source_text);
        let target = normalize_text(&segment.target_text);
        if !source.is_empty() && !target.is_empty() {
            by_source.entry(source).or_default().push(segment);
            if target.chars().count() >= 4 {
                by_target.entry(target).or_default().push(segment);
            }
        }
    }
    let mut findings = Vec::new();
    if profile
        .enabled_rule_ids
        .contains("qa.same-source-different-target")
    {
        for group in by_source.values() {
            let targets = group
                .iter()
                .map(|segment| normalize_text(&segment.target_text))
                .collect::<BTreeSet<_>>();
            if targets.len() <= 1 {
                continue;
            }
            for segment in group {
                findings.push(consistency_finding(
                    profile,
                    segment,
                    group,
                    "qa.same-source-different-target",
                    "The same source has different target translations.",
                    QaSeverity::Warning,
                ));
            }
        }
    }
    if profile
        .enabled_rule_ids
        .contains("qa.different-source-same-target")
    {
        for group in by_target.values() {
            let sources = group
                .iter()
                .map(|segment| normalize_text(&segment.source_text))
                .collect::<BTreeSet<_>>();
            if sources.len() <= 1 {
                continue;
            }
            for segment in group {
                findings.push(consistency_finding(
                    profile,
                    segment,
                    group,
                    "qa.different-source-same-target",
                    "Different sources share the same target translation.",
                    QaSeverity::Info,
                ));
            }
        }
    }
    findings.sort_by(|left, right| {
        left.segment_id
            .cmp(&right.segment_id)
            .then_with(|| left.rule_id.cmp(&right.rule_id))
    });
    findings
}

pub fn render_html(report: &QaReportSnapshot) -> Vec<u8> {
    let mut rows = String::new();
    for item in &report.items {
        rows.push_str("<tr>");
        for value in [
            item.document_name.as_str(),
            &(item.segment_ordinal + 1).to_string(),
            item.category.as_str(),
            item.rule_id.as_str(),
            severity_text(item.severity),
            item.disposition.as_str(),
            item.message.as_str(),
            item.source_evidence.as_str(),
            item.target_evidence.as_str(),
            item.waiver_actor.as_deref().unwrap_or(""),
            item.waiver_reason.as_deref().unwrap_or(""),
        ] {
            rows.push_str("<td>");
            rows.push_str(&escape_html(value));
            rows.push_str("</td>");
        }
        rows.push_str("<td><a href=\"");
        rows.push_str(&escape_html_attribute(&format!(
            "translunar://segment/{}",
            item.segment_id
        )));
        rows.push_str("\">Open</a></td></tr>");
    }
    format!(
        "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><title>QA report</title><style>body{{font:14px system-ui;margin:24px;color:#221b18}}table{{border-collapse:collapse;width:100%}}th,td{{border:1px solid #cfc7b8;padding:6px;text-align:left;vertical-align:top}}th{{background:#f2ecdf}}code{{font-family:ui-monospace,monospace}}</style></head><body><h1>QA report</h1><p><strong>{}</strong> / {} / {} · {} checked · {} errors · {} warnings · {} info · {} waived</p><table><thead><tr><th>Document</th><th>Segment</th><th>Category</th><th>Rule</th><th>Severity</th><th>Disposition</th><th>Message</th><th>Source evidence</th><th>Target evidence</th><th>Waiver actor</th><th>Waiver reason</th><th>Location</th></tr></thead><tbody>{rows}</tbody></table></body></html>",
        escape_html(&report.project_name),
        escape_html(&report.scope_name),
        escape_html(&report.profile_name),
        report.checked_segments,
        report.errors,
        report.warnings,
        report.info,
        report.waived,
    )
    .into_bytes()
}

pub fn validate_html(bytes: &[u8]) -> Result<(), QaCoreError> {
    let html = std::str::from_utf8(bytes)
        .map_err(|error| QaCoreError::InvalidReport(format!("HTML is not UTF-8: {error}")))?;
    if !html.starts_with("<!doctype html>")
        || !html.contains("<meta charset=\"utf-8\">")
        || !html.contains("<table>")
        || !html.ends_with("</body></html>")
    {
        return Err(QaCoreError::InvalidReport(
            "HTML report is missing required standalone structure".to_string(),
        ));
    }
    Ok(())
}

pub fn render_xlsx(report: &QaReportSnapshot) -> Result<Vec<u8>, QaCoreError> {
    let cursor = Cursor::new(Vec::new());
    let mut writer = ZipWriter::new(cursor);
    let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    for (name, bytes) in xlsx_parts(report) {
        writer.start_file(name, options)?;
        writer.write_all(bytes.as_bytes())?;
    }
    let bytes = writer.finish()?.into_inner();
    validate_xlsx(&bytes)?;
    Ok(bytes)
}

pub fn validate_xlsx(bytes: &[u8]) -> Result<(), QaCoreError> {
    OfficePackage::from_bytes(bytes)
        .map_err(|error| QaCoreError::InvalidReport(error.to_string()))?;
    let mut archive = ZipArchive::new(Cursor::new(bytes))?;
    for part in ["xl/workbook.xml", "xl/worksheets/sheet1.xml"] {
        let mut file = archive
            .by_name(part)
            .map_err(|_| QaCoreError::InvalidReport(format!("missing {part}")))?;
        let mut content = Vec::new();
        file.read_to_end(&mut content)?;
        validate_xml(&content, part)
            .map_err(|error| QaCoreError::InvalidReport(error.to_string()))?;
    }
    Ok(())
}

fn profile_with_id(id: &str, name: &str, cjk: bool) -> QaProfileDefinition {
    let enabled_rule_ids = [
        "qa.empty-target",
        "qa.source-equals-target",
        "qa.number-mismatch",
        "qa.unit-mismatch",
        "qa.tag",
        "qa.tag-tag_missing",
        "qa.tag-tag_extra",
        "qa.tag-tag_order",
        "qa.tag-tag_pair",
        "qa.unbalanced-delimiter",
        "qa.edge-whitespace",
        "qa.repeated-word",
        "qa.length-ratio",
        "qa.target-length-limit",
        "qa.missing-final-punctuation",
        "qa.term-required",
        "qa.term-forbidden",
        "qa.regex",
        "qa.same-source-different-target",
        "qa.different-source-same-target",
    ]
    .into_iter()
    .map(str::to_string)
    .chain(
        cjk.then_some([
            "qa.cjk-halfwidth-punctuation",
            "qa.cjk-ellipsis",
            "qa.cjk-dash",
            "qa.cjk-latin-spacing",
        ])
        .into_iter()
        .flatten()
        .map(str::to_string),
    )
    .collect();
    QaProfileDefinition {
        id: id.to_string(),
        name: name.to_string(),
        enabled_rule_ids,
        severity_overrides: BTreeMap::new(),
        settings: QaRuleSettings {
            cjk_spacing: cjk,
            cjk_punctuation: cjk,
            ..QaRuleSettings::default()
        },
        regex_rules: Vec::new(),
    }
}

fn consistency_finding(
    profile: &QaProfileDefinition,
    segment: &QaConsistencySegment,
    group: &[&QaConsistencySegment],
    rule_id: &str,
    message: &str,
    fallback: QaSeverity,
) -> QaFindingCandidate {
    let related_segment_ids = group
        .iter()
        .filter(|related| related.segment_id != segment.segment_id)
        .map(|related| related.segment_id.clone())
        .collect::<Vec<_>>();
    let evidence = bound_evidence(QaCandidateEvidence {
        related_segment_ids,
        ..QaCandidateEvidence::default()
    });
    QaFindingCandidate {
        segment_id: segment.segment_id.clone(),
        rule_id: rule_id.to_string(),
        category: QaCategory::Consistency,
        severity: profile
            .severity_overrides
            .get(rule_id)
            .copied()
            .unwrap_or(fallback),
        message: message.to_string(),
        fingerprint: finding_fingerprint(rule_id, &segment.segment_id, &evidence),
        evidence,
    }
}

fn finding_fingerprint(rule_id: &str, segment_id: &str, evidence: &QaCandidateEvidence) -> String {
    let encoded = serde_json::to_string(evidence).unwrap_or_default();
    sha256_hex(format!("{rule_id}\0{segment_id}\0{encoded}").as_bytes())
}

fn bound_evidence(mut evidence: QaCandidateEvidence) -> QaCandidateEvidence {
    fn bound(values: &mut Vec<String>) {
        values.truncate(MAX_EVIDENCE_VALUES);
        for value in values {
            *value = value.chars().take(MAX_EVIDENCE_VALUE_CHARS).collect();
        }
    }
    bound(&mut evidence.source_numbers);
    bound(&mut evidence.target_numbers);
    bound(&mut evidence.source_values);
    bound(&mut evidence.target_values);
    evidence.source_spans.truncate(MAX_EVIDENCE_VALUES);
    evidence.target_spans.truncate(MAX_EVIDENCE_VALUES);
    evidence.related_segment_ids.truncate(MAX_EVIDENCE_VALUES);
    evidence
}

fn extract_units(text: &str) -> BTreeSet<String> {
    let pattern =
        Regex::new(r"(?i)(?:\d[\d,.]*\s*)(kg|g|mg|km|m|cm|mm|l|ml|%|°c|°f|usd|eur|cny|rmb)\b")
            .expect("static unit regex");
    pattern
        .captures_iter(text)
        .filter_map(|capture| capture.get(1))
        .map(|value| value.as_str().to_ascii_lowercase())
        .collect()
}

fn first_unbalanced_delimiter(text: &str) -> Option<char> {
    let mut stack = Vec::new();
    let pairs = [
        ('(', ')'),
        ('[', ']'),
        ('{', '}'),
        ('（', '）'),
        ('【', '】'),
        ('《', '》'),
    ];
    for character in text.chars() {
        if pairs.iter().any(|(open, _)| *open == character) {
            stack.push(character);
        } else if let Some((open, _)) = pairs.iter().find(|(_, close)| *close == character)
            && stack.pop() != Some(*open)
        {
            return Some(character);
        }
    }
    stack.pop()
}

fn first_cjk_ascii_punctuation(text: &str) -> Option<(u32, char)> {
    let characters = text.chars().collect::<Vec<_>>();
    for (index, character) in characters.iter().enumerate() {
        if !matches!(character, ',' | ';' | ':' | '?' | '!') {
            continue;
        }
        if index
            .checked_sub(1)
            .is_some_and(|before| is_cjk(characters[before]))
            || characters
                .get(index + 1)
                .is_some_and(|value| is_cjk(*value))
        {
            return u32::try_from(index).ok().map(|index| (index, *character));
        }
    }
    None
}

fn first_missing_cjk_latin_space(text: &str) -> Option<QaSpan> {
    let characters = text.chars().collect::<Vec<_>>();
    for index in 1..characters.len() {
        let before = characters[index - 1];
        let current = characters[index];
        if (is_cjk(before) && current.is_ascii_alphanumeric())
            || (before.is_ascii_alphanumeric() && is_cjk(current))
        {
            let start = u32::try_from(index.saturating_sub(1)).ok()?;
            let end = u32::try_from(index.saturating_add(1)).ok()?;
            return Some(QaSpan { start, end });
        }
    }
    None
}

fn repeated_word(text: &str) -> Option<String> {
    let mut previous: Option<String> = None;
    for token in text.split_whitespace() {
        let normalized = token
            .trim_matches(|value: char| !value.is_alphanumeric())
            .to_lowercase();
        if normalized.is_empty() {
            continue;
        }
        if previous.as_deref() == Some(normalized.as_str()) {
            return Some(normalized);
        }
        previous = Some(normalized);
    }
    None
}

fn contains_term(text: &str, term: &str) -> bool {
    if term.trim().is_empty() {
        return false;
    }
    let normalized_text = normalize_text(text).to_lowercase();
    let normalized_term = normalize_text(term).to_lowercase();
    if normalized_term.chars().any(is_cjk) {
        return normalized_text.contains(&normalized_term);
    }
    Regex::new(&format!(r"(?i)\b{}\b", regex::escape(&normalized_term)))
        .is_ok_and(|pattern| pattern.is_match(&normalized_text))
}

fn is_cjk_locale(locale: &str) -> bool {
    matches!(
        locale
            .split(['-', '_'])
            .next()
            .unwrap_or_default()
            .to_ascii_lowercase()
            .as_str(),
        "zh" | "ja" | "ko"
    )
}

fn is_cjk(value: char) -> bool {
    matches!(value as u32, 0x3400..=0x4DBF | 0x4E00..=0x9FFF | 0x3040..=0x30FF | 0xAC00..=0xD7AF)
}

fn has_sentence_final(text: &str) -> bool {
    text.trim_end()
        .chars()
        .next_back()
        .is_some_and(|value| matches!(value, '.' | '?' | '!' | '。' | '？' | '！' | '…'))
}

fn byte_range_to_scalar_span(text: &str, start: usize, end: usize) -> QaSpan {
    let scalar_start = text[..start].chars().count();
    let scalar_end = text[..end].chars().count();
    QaSpan {
        start: u32::try_from(scalar_start).unwrap_or(u32::MAX),
        end: u32::try_from(scalar_end).unwrap_or(u32::MAX),
    }
}

fn severity_text(severity: QaSeverity) -> &'static str {
    match severity {
        QaSeverity::Error => "error",
        QaSeverity::Warning => "warning",
        QaSeverity::Info => "info",
    }
}

fn escape_html(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

fn escape_html_attribute(value: &str) -> String {
    escape_html(value)
}

fn xlsx_parts(report: &QaReportSnapshot) -> Vec<(&'static str, String)> {
    let headers = [
        "Document",
        "Segment",
        "Category",
        "Rule",
        "Severity",
        "Disposition",
        "Message",
        "Source evidence",
        "Target evidence",
        "Waiver actor",
        "Waiver reason",
        "Location",
    ];
    let mut rows = String::new();
    rows.push_str("<row r=\"1\">");
    for (index, header) in headers.iter().enumerate() {
        rows.push_str(&inline_string_cell(index, 1, header));
    }
    rows.push_str("</row>");
    for (row_index, item) in report.items.iter().enumerate() {
        let row_number = row_index + 2;
        rows.push_str(&format!("<row r=\"{row_number}\">"));
        let values = [
            item.document_name.clone(),
            (item.segment_ordinal + 1).to_string(),
            item.category.as_str().to_string(),
            item.rule_id.clone(),
            severity_text(item.severity).to_string(),
            item.disposition.clone(),
            item.message.clone(),
            item.source_evidence.clone(),
            item.target_evidence.clone(),
            item.waiver_actor.clone().unwrap_or_default(),
            item.waiver_reason.clone().unwrap_or_default(),
        ];
        for (column, value) in values.iter().enumerate() {
            rows.push_str(&inline_string_cell(column, row_number, value));
        }
        let segment_id = item
            .segment_id
            .chars()
            .filter(|value| value.is_ascii_alphanumeric() || *value == '-')
            .collect::<String>();
        rows.push_str(&format!(
            "<c r=\"{}{}\"><f>HYPERLINK(&quot;translunar://segment/{}&quot;,&quot;Open&quot;)</f></c>",
            column_name(11),
            row_number,
            segment_id
        ));
        rows.push_str("</row>");
    }
    vec![
        (
            "[Content_Types].xml",
            "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"><Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/><Default Extension=\"xml\" ContentType=\"application/xml\"/><Override PartName=\"/xl/workbook.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml\"/><Override PartName=\"/xl/worksheets/sheet1.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml\"/></Types>".to_string(),
        ),
        (
            "_rels/.rels",
            "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"xl/workbook.xml\"/></Relationships>".to_string(),
        ),
        (
            "xl/workbook.xml",
            "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><workbook xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\"><sheets><sheet name=\"QA Findings\" sheetId=\"1\" r:id=\"rId1\"/></sheets></workbook>".to_string(),
        ),
        (
            "xl/_rels/workbook.xml.rels",
            "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet\" Target=\"worksheets/sheet1.xml\"/></Relationships>".to_string(),
        ),
        (
            "xl/worksheets/sheet1.xml",
            format!("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\"><sheetData>{rows}</sheetData></worksheet>"),
        ),
    ]
}

fn inline_string_cell(column: usize, row: usize, value: &str) -> String {
    let escaped = quick_xml::escape::escape(value).into_owned();
    format!(
        "<c r=\"{}{row}\" t=\"inlineStr\"><is><t xml:space=\"preserve\">{escaped}</t></is></c>",
        column_name(column)
    )
}

fn column_name(mut index: usize) -> String {
    let mut name = String::new();
    loop {
        name.insert(0, char::from(b'A' + u8::try_from(index % 26).unwrap_or(0)));
        if index < 26 {
            return name;
        }
        index = index / 26 - 1;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(source: &str, target: &str, target_locale: &str) -> QaSegmentInput {
        QaSegmentInput {
            segment_id: "segment-1".to_string(),
            source_text: source.to_string(),
            target_text: target.to_string(),
            source_locale: "en-US".to_string(),
            target_locale: target_locale.to_string(),
            tag_findings: Vec::new(),
            terms: Vec::new(),
        }
    }

    #[test]
    fn mechanical_rules_are_deterministic_and_unicode_safe() {
        let profile = CompiledQaProfile::compile(cjk_profile()).expect("CJK profile");
        let findings = profile.evaluate_segment(&input(
            "The amount is 12 kg.",
            " 数量是13 g...test测试 ",
            "zh-CN",
        ));
        let rules = findings
            .iter()
            .map(|finding| finding.rule_id.as_str())
            .collect::<BTreeSet<_>>();
        assert!(rules.contains("qa.number-mismatch"));
        assert!(rules.contains("qa.unit-mismatch"));
        assert!(rules.contains("qa.edge-whitespace"));
        assert!(rules.contains("qa.cjk-ellipsis"));
        assert!(rules.contains("qa.cjk-latin-spacing"));
        assert_eq!(
            findings,
            profile.evaluate_segment(&input(
                "The amount is 12 kg.",
                " 数量是13 g...test测试 ",
                "zh-CN",
            ))
        );
    }

    #[test]
    fn empty_tags_terms_repetition_and_length_are_explicit() {
        let mut definition = standard_profile();
        definition.settings.max_target_chars = Some(8);
        let profile = CompiledQaProfile::compile(definition).expect("profile");
        let mut value = input("Save file", "word word forbidden", "en-US");
        value.tag_findings.push(QaTagFinding {
            code: "tag_missing".to_string(),
            message: "Protected tag is missing".to_string(),
        });
        value.terms.push(QaTermExpectation {
            id: "term-1".to_string(),
            source_term: "file".to_string(),
            preferred_targets: vec!["document".to_string()],
            forbidden_targets: vec!["forbidden".to_string()],
        });
        let rules = profile
            .evaluate_segment(&value)
            .into_iter()
            .map(|finding| finding.rule_id)
            .collect::<BTreeSet<_>>();
        assert!(rules.contains("qa.repeated-word"));
        assert!(rules.contains("qa.target-length-limit"));
        assert!(rules.contains("qa.tag-tag_missing"));
        assert!(
            rules
                .iter()
                .any(|rule| rule.starts_with("qa.term-required:"))
        );
        assert!(
            rules
                .iter()
                .any(|rule| rule.starts_with("qa.term-forbidden:"))
        );
    }

    #[test]
    fn custom_regex_is_bounded_and_uses_scalar_spans() {
        let mut definition = standard_profile();
        definition.regex_rules.push(QaRegexRule {
            id: "forbidden-emoji".to_string(),
            label: "Emoji".to_string(),
            field: QaField::Target,
            pattern: "😀".to_string(),
            severity: QaSeverity::Error,
            message: "Emoji is not allowed.".to_string(),
            replacement_hint: None,
        });
        let profile = CompiledQaProfile::compile(definition).expect("regex profile");
        let finding = profile
            .evaluate_segment(&input("Hello", "中文😀test", "zh-CN"))
            .into_iter()
            .find(|finding| finding.rule_id == "qa.regex:forbidden-emoji")
            .expect("regex finding");
        assert_eq!(
            finding.evidence.target_spans[0],
            QaSpan { start: 2, end: 3 }
        );

        let mut invalid = standard_profile();
        invalid.regex_rules.push(QaRegexRule {
            id: "broken".to_string(),
            label: "Broken".to_string(),
            field: QaField::Both,
            pattern: "(".to_string(),
            severity: QaSeverity::Warning,
            message: "Broken".to_string(),
            replacement_hint: None,
        });
        assert!(CompiledQaProfile::compile(invalid).is_err());
    }

    #[test]
    fn consistency_groups_same_source_and_same_target() {
        let segments = vec![
            QaConsistencySegment {
                segment_id: "one".to_string(),
                source_text: "Save".to_string(),
                target_text: "保存内容".to_string(),
            },
            QaConsistencySegment {
                segment_id: "two".to_string(),
                source_text: "Save".to_string(),
                target_text: "储存内容".to_string(),
            },
            QaConsistencySegment {
                segment_id: "three".to_string(),
                source_text: "Store".to_string(),
                target_text: "保存内容".to_string(),
            },
        ];
        let findings = evaluate_consistency(&cjk_profile(), &segments);
        assert_eq!(
            findings
                .iter()
                .filter(|finding| finding.rule_id == "qa.same-source-different-target")
                .count(),
            2
        );
        assert_eq!(
            findings
                .iter()
                .filter(|finding| finding.rule_id == "qa.different-source-same-target")
                .count(),
            2
        );
    }

    #[test]
    fn html_and_xlsx_reports_escape_content_and_include_locations() {
        let report = QaReportSnapshot {
            project_name: "<Project>".to_string(),
            scope_name: "All".to_string(),
            run_id: "run-1".to_string(),
            profile_name: "CJK".to_string(),
            created_at_ms: 1,
            checked_segments: 1,
            errors: 1,
            warnings: 0,
            info: 0,
            waived: 0,
            items: vec![QaReportItem {
                document_name: "=unsafe.xlsx".to_string(),
                segment_id: "019f0000-0000-7000-8000-000000000000".to_string(),
                segment_ordinal: 0,
                category: QaCategory::Custom,
                rule_id: "qa.regex.test".to_string(),
                severity: QaSeverity::Error,
                disposition: "open".to_string(),
                message: "<script>alert(1)</script>".to_string(),
                source_evidence: "=1+1".to_string(),
                target_evidence: "&value".to_string(),
                waiver_actor: None,
                waiver_reason: None,
            }],
        };
        let html = String::from_utf8(render_html(&report)).expect("HTML");
        validate_html(html.as_bytes()).expect("valid standalone HTML");
        assert!(!html.contains("<script>"));
        assert!(html.contains("translunar://segment/019f0000-0000-7000-8000-000000000000"));
        let xlsx = render_xlsx(&report).expect("XLSX");
        validate_xlsx(&xlsx).expect("valid XLSX");
        let mut archive = ZipArchive::new(Cursor::new(xlsx)).expect("archive");
        let mut sheet = String::new();
        archive
            .by_name("xl/worksheets/sheet1.xml")
            .expect("sheet")
            .read_to_string(&mut sheet)
            .expect("sheet text");
        assert!(sheet.contains("t=\"inlineStr\"><is><t xml:space=\"preserve\">=unsafe.xlsx"));
        assert!(sheet.contains("translunar://segment/019f0000-0000-7000-8000-000000000000"));
    }
}

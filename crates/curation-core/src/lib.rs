//! Deterministic, provider-neutral translation-asset curation.

use std::collections::{BTreeMap, BTreeSet};
use std::io::Write;
use std::sync::LazyLock;

use regex::Regex;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use thiserror::Error;
use translunar_asset_core::{match_score, normalize_match_key};

pub const MAX_UNITS_PER_RUN: usize = 100_000;
pub const MAX_TEXT_CHARS: usize = 100_000;
pub const MAX_EVIDENCE_VALUES: usize = 32;
pub const MAX_EVIDENCE_VALUE_CHARS: usize = 256;
pub const MAX_PROVIDER_ENVELOPE_BYTES: usize = 256 * 1024;
const MAX_NEAR_DUPLICATE_BUCKET: usize = 64;

static NUMBER_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?x)(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?").expect("valid curation number regex")
});
static DATE_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?x)\b(?:\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4})\b")
        .expect("valid curation date regex")
});
static PLACEHOLDER_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?:\{[^{}]+\}|<[^<>]+>|%\w+)").expect("valid curation placeholder regex")
});

#[derive(Debug, Error)]
pub enum CurationError {
    #[error("invalid curation policy: {0}")]
    InvalidPolicy(String),
    #[error("invalid curation input: {0}")]
    InvalidInput(String),
    #[error("invalid semantic refinement: {0}")]
    InvalidSemanticRefinement(String),
    #[error("dataset serialization failed: {0}")]
    Dataset(String),
    #[error("dataset CSV serialization failed: {0}")]
    Csv(#[from] csv::Error),
    #[error("dataset I/O failed: {0}")]
    Io(#[from] std::io::Error),
    #[error("dataset JSON serialization failed: {0}")]
    Json(#[from] serde_json::Error),
}

#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, JsonSchema,
)]
#[serde(rename_all = "camelCase")]
pub enum CurationSeverity {
    Info,
    Warning,
    Error,
}

#[derive(
    Debug, Clone, Copy, Default, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, JsonSchema,
)]
#[serde(rename_all = "camelCase")]
pub enum CurationRecommendation {
    #[default]
    Keep,
    Review,
    Quarantine,
}

#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, JsonSchema,
)]
#[serde(rename_all = "camelCase")]
pub enum CurationFindingKind {
    ExactDuplicate,
    NearDuplicate,
    CompetingTranslation,
    SourceEqualsTarget,
    MinimumLength,
    LengthRatio,
    NumberMismatch,
    DateMismatch,
    PlaceholderMismatch,
    CreatedOutsideRange,
    LikelyWrongLanguage,
    SemanticMismatch,
}

impl CurationFindingKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::ExactDuplicate => "exact-duplicate",
            Self::NearDuplicate => "near-duplicate",
            Self::CompetingTranslation => "competing-translation",
            Self::SourceEqualsTarget => "source-equals-target",
            Self::MinimumLength => "minimum-length",
            Self::LengthRatio => "length-ratio",
            Self::NumberMismatch => "number-mismatch",
            Self::DateMismatch => "date-mismatch",
            Self::PlaceholderMismatch => "placeholder-mismatch",
            Self::CreatedOutsideRange => "created-outside-range",
            Self::LikelyWrongLanguage => "likely-wrong-language",
            Self::SemanticMismatch => "semantic-mismatch",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
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
        Self {
            minimum_chars: 2,
            minimum_length_ratio_percent: 20,
            maximum_length_ratio_percent: 500,
            near_duplicate_threshold: 80,
            semantic_alignment_threshold_basis_points: 3_500,
            quarantine_threshold_basis_points: 5_000,
            minimum_term_frequency: 2,
            created_after_ms: None,
            created_before_ms: None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CurationUnit {
    pub id: String,
    pub library_id: String,
    pub source_locale: String,
    pub target_locale: String,
    pub source_text: String,
    pub target_text: String,
    #[serde(default)]
    pub domain: Option<String>,
    #[serde(default)]
    pub origin_project_id: Option<String>,
    #[serde(default)]
    pub origin_document_id: Option<String>,
    #[serde(default)]
    pub origin_segment_id: Option<String>,
    #[serde(default)]
    pub author: Option<String>,
    #[serde(default)]
    pub metadata: BTreeMap<String, String>,
    pub created_at_ms: i64,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CurationEvidence {
    #[serde(default)]
    pub source_values: Vec<String>,
    #[serde(default)]
    pub target_values: Vec<String>,
    #[serde(default)]
    pub related_unit_ids: Vec<String>,
    #[serde(default)]
    pub metrics: BTreeMap<String, i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CurationFinding {
    pub fingerprint: String,
    pub unit_id: String,
    pub kind: CurationFindingKind,
    pub severity: CurationSeverity,
    pub recommendation: CurationRecommendation,
    pub penalty_basis_points: u16,
    #[serde(default)]
    pub canonical_unit_id: Option<String>,
    pub explanation: String,
    pub evidence: CurationEvidence,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CurationUnitScore {
    pub unit_id: String,
    pub quality_score_basis_points: u16,
    pub recommendation: CurationRecommendation,
    pub explanation: Vec<String>,
    pub unit_snapshot_hash: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CurationTermCandidate {
    pub source_term: String,
    pub target_term: String,
    pub source_locale: String,
    pub target_locale: String,
    #[serde(default)]
    pub domain: Option<String>,
    pub frequency: u32,
    pub agreement_basis_points: u16,
    pub unit_ids: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CurationDriftGroup {
    pub source_key: String,
    pub source_text: String,
    pub target_variants: Vec<String>,
    pub unit_ids: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CurationSummary {
    pub analyzed_units: u32,
    pub units_with_findings: u32,
    pub finding_count: u32,
    pub quarantine_candidates: u32,
    pub term_candidate_count: u32,
    pub drift_group_count: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CurationAnalysis {
    pub summary: CurationSummary,
    pub scores: Vec<CurationUnitScore>,
    pub findings: Vec<CurationFinding>,
    pub term_candidates: Vec<CurationTermCandidate>,
    pub drift_groups: Vec<CurationDriftGroup>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SemanticAnnotation {
    pub unit_id: String,
    pub score_basis_points: u16,
    pub label: String,
    pub evidence: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SemanticAnnotationEnvelope {
    annotations: Vec<SemanticAnnotation>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DatasetUnit {
    pub unit_id: String,
    pub source_locale: String,
    pub target_locale: String,
    #[serde(alias = "instruction")]
    pub source_text: String,
    #[serde(alias = "response")]
    pub target_text: String,
    #[serde(default)]
    pub domain: Option<String>,
    #[serde(default)]
    pub origin_project_id: Option<String>,
    #[serde(default)]
    pub origin_document_id: Option<String>,
    #[serde(default)]
    pub origin_segment_id: Option<String>,
    pub quality_score_basis_points: u16,
}

#[derive(Default)]
struct ScoreAccumulator {
    penalty: u32,
    recommendation: CurationRecommendation,
    explanations: Vec<String>,
}

pub fn analyze(
    units: &[CurationUnit],
    policy: &CurationPolicy,
    semantic_annotations: &[SemanticAnnotation],
) -> Result<CurationAnalysis, CurationError> {
    validate_policy(policy)?;
    validate_units(units)?;
    validate_annotations(semantic_annotations, units)?;

    let mut ordered = units.iter().collect::<Vec<_>>();
    ordered.sort_by(|left, right| {
        left.created_at_ms
            .cmp(&right.created_at_ms)
            .then_with(|| left.id.cmp(&right.id))
    });
    let mut scores = ordered
        .iter()
        .map(|unit| (unit.id.clone(), ScoreAccumulator::default()))
        .collect::<BTreeMap<_, _>>();
    let mut findings = Vec::new();

    evaluate_individual_units(&ordered, policy, &mut findings, &mut scores);
    evaluate_duplicates(&ordered, policy, &mut findings, &mut scores);
    let drift_groups = evaluate_drift(&ordered, &mut findings, &mut scores);
    evaluate_semantic_annotations(semantic_annotations, policy, &mut findings, &mut scores);

    findings.sort_by(|left, right| {
        left.unit_id
            .cmp(&right.unit_id)
            .then_with(|| left.kind.cmp(&right.kind))
            .then_with(|| left.fingerprint.cmp(&right.fingerprint))
    });
    findings.dedup_by(|left, right| left.fingerprint == right.fingerprint);

    let unit_scores = ordered
        .iter()
        .map(|unit| {
            let accumulator = scores.remove(&unit.id).unwrap_or_default();
            let score = 10_000_u32.saturating_sub(accumulator.penalty).min(10_000) as u16;
            let recommendation = if score < policy.quarantine_threshold_basis_points
                && accumulator.recommendation >= CurationRecommendation::Review
            {
                CurationRecommendation::Quarantine
            } else {
                accumulator.recommendation
            };
            CurationUnitScore {
                unit_id: unit.id.clone(),
                quality_score_basis_points: score,
                recommendation,
                explanation: if accumulator.explanations.is_empty() {
                    vec!["No deterministic quality penalties were found.".to_string()]
                } else {
                    accumulator.explanations
                },
                unit_snapshot_hash: unit_snapshot_hash(unit),
            }
        })
        .collect::<Vec<_>>();
    let term_candidates = mine_terms(&ordered, policy);
    let affected = findings
        .iter()
        .map(|finding| finding.unit_id.as_str())
        .collect::<BTreeSet<_>>();
    let quarantine_candidates = unit_scores
        .iter()
        .filter(|score| score.recommendation == CurationRecommendation::Quarantine)
        .count();

    Ok(CurationAnalysis {
        summary: CurationSummary {
            analyzed_units: to_u32(units.len())?,
            units_with_findings: to_u32(affected.len())?,
            finding_count: to_u32(findings.len())?,
            quarantine_candidates: to_u32(quarantine_candidates)?,
            term_candidate_count: to_u32(term_candidates.len())?,
            drift_group_count: to_u32(drift_groups.len())?,
        },
        scores: unit_scores,
        findings,
        term_candidates,
        drift_groups,
    })
}

pub fn parse_semantic_annotations(
    bytes: &[u8],
    known_unit_ids: &BTreeSet<String>,
) -> Result<Vec<SemanticAnnotation>, CurationError> {
    if bytes.len() > MAX_PROVIDER_ENVELOPE_BYTES {
        return Err(CurationError::InvalidSemanticRefinement(format!(
            "response exceeds the {MAX_PROVIDER_ENVELOPE_BYTES}-byte limit"
        )));
    }
    let envelope: SemanticAnnotationEnvelope = serde_json::from_slice(bytes)
        .map_err(|error| CurationError::InvalidSemanticRefinement(error.to_string()))?;
    if envelope.annotations.len() > known_unit_ids.len() {
        return Err(CurationError::InvalidSemanticRefinement(
            "response has more annotations than requested units".to_string(),
        ));
    }
    let mut seen = BTreeSet::new();
    for annotation in &envelope.annotations {
        if !known_unit_ids.contains(&annotation.unit_id) {
            return Err(CurationError::InvalidSemanticRefinement(format!(
                "unknown unit id {}",
                annotation.unit_id
            )));
        }
        if !seen.insert(annotation.unit_id.clone()) {
            return Err(CurationError::InvalidSemanticRefinement(format!(
                "duplicate unit id {}",
                annotation.unit_id
            )));
        }
        validate_annotation(annotation)?;
    }
    Ok(envelope.annotations)
}

pub fn render_dataset_jsonl(units: &[DatasetUnit]) -> Result<Vec<u8>, CurationError> {
    let mut output = Vec::new();
    for unit in units {
        validate_dataset_unit(unit)?;
        serde_json::to_writer(
            &mut output,
            &DatasetJsonlRow {
                unit_id: &unit.unit_id,
                source_locale: &unit.source_locale,
                target_locale: &unit.target_locale,
                instruction: &unit.source_text,
                response: &unit.target_text,
                domain: unit.domain.as_deref(),
                origin_project_id: unit.origin_project_id.as_deref(),
                origin_document_id: unit.origin_document_id.as_deref(),
                origin_segment_id: unit.origin_segment_id.as_deref(),
                quality_score_basis_points: unit.quality_score_basis_points,
            },
        )?;
        output.write_all(b"\n")?;
    }
    Ok(output)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DatasetJsonlRow<'a> {
    unit_id: &'a str,
    source_locale: &'a str,
    target_locale: &'a str,
    instruction: &'a str,
    response: &'a str,
    domain: Option<&'a str>,
    origin_project_id: Option<&'a str>,
    origin_document_id: Option<&'a str>,
    origin_segment_id: Option<&'a str>,
    quality_score_basis_points: u16,
}

pub fn render_dataset_tsv(units: &[DatasetUnit]) -> Result<Vec<u8>, CurationError> {
    let mut writer = csv::WriterBuilder::new()
        .delimiter(b'\t')
        .from_writer(Vec::new());
    writer.write_record([
        "unit_id",
        "source_locale",
        "target_locale",
        "source_text",
        "target_text",
        "domain",
        "origin_project_id",
        "origin_document_id",
        "origin_segment_id",
        "quality_score_basis_points",
    ])?;
    for unit in units {
        validate_dataset_unit(unit)?;
        writer.write_record([
            unit.unit_id.as_str(),
            unit.source_locale.as_str(),
            unit.target_locale.as_str(),
            unit.source_text.as_str(),
            unit.target_text.as_str(),
            unit.domain.as_deref().unwrap_or(""),
            unit.origin_project_id.as_deref().unwrap_or(""),
            unit.origin_document_id.as_deref().unwrap_or(""),
            unit.origin_segment_id.as_deref().unwrap_or(""),
            &unit.quality_score_basis_points.to_string(),
        ])?;
    }
    writer.flush()?;
    writer
        .into_inner()
        .map_err(|error| CurationError::Dataset(error.to_string()))
}

pub fn unit_snapshot_hash(unit: &CurationUnit) -> String {
    let bytes = serde_json::to_vec(unit).expect("CurationUnit serialization cannot fail");
    format!("{:x}", Sha256::digest(bytes))
}

fn validate_policy(policy: &CurationPolicy) -> Result<(), CurationError> {
    if policy.minimum_length_ratio_percent == 0
        || policy.minimum_length_ratio_percent > policy.maximum_length_ratio_percent
    {
        return Err(CurationError::InvalidPolicy(
            "length ratio bounds are invalid".to_string(),
        ));
    }
    if !(1..=99).contains(&policy.near_duplicate_threshold) {
        return Err(CurationError::InvalidPolicy(
            "near duplicate threshold must be 1..99".to_string(),
        ));
    }
    if policy.semantic_alignment_threshold_basis_points > 10_000
        || policy.quarantine_threshold_basis_points > 10_000
    {
        return Err(CurationError::InvalidPolicy(
            "basis-point thresholds must not exceed 10000".to_string(),
        ));
    }
    if policy.minimum_term_frequency < 2 {
        return Err(CurationError::InvalidPolicy(
            "minimum term frequency must be at least 2".to_string(),
        ));
    }
    if policy
        .created_after_ms
        .zip(policy.created_before_ms)
        .is_some_and(|(after, before)| after > before)
    {
        return Err(CurationError::InvalidPolicy(
            "created-at range is inverted".to_string(),
        ));
    }
    Ok(())
}

fn validate_units(units: &[CurationUnit]) -> Result<(), CurationError> {
    if units.len() > MAX_UNITS_PER_RUN {
        return Err(CurationError::InvalidInput(format!(
            "run exceeds the {MAX_UNITS_PER_RUN}-unit limit"
        )));
    }
    let mut ids = BTreeSet::new();
    let mut library_id: Option<&str> = None;
    for unit in units {
        if unit.id.trim().is_empty() || unit.library_id.trim().is_empty() {
            return Err(CurationError::InvalidInput(
                "unit and library IDs must not be empty".to_string(),
            ));
        }
        if !ids.insert(unit.id.as_str()) {
            return Err(CurationError::InvalidInput(format!(
                "duplicate unit id {}",
                unit.id
            )));
        }
        match library_id {
            Some(expected) if expected != unit.library_id => {
                return Err(CurationError::InvalidInput(
                    "one run cannot span multiple TM libraries".to_string(),
                ));
            }
            None => library_id = Some(&unit.library_id),
            _ => {}
        }
        if unit.source_locale.trim().is_empty() || unit.target_locale.trim().is_empty() {
            return Err(CurationError::InvalidInput(format!(
                "unit {} has an empty locale",
                unit.id
            )));
        }
        if unit.source_text.chars().count() > MAX_TEXT_CHARS
            || unit.target_text.chars().count() > MAX_TEXT_CHARS
        {
            return Err(CurationError::InvalidInput(format!(
                "unit {} exceeds the text limit",
                unit.id
            )));
        }
    }
    Ok(())
}

fn validate_annotations(
    annotations: &[SemanticAnnotation],
    units: &[CurationUnit],
) -> Result<(), CurationError> {
    let known = units
        .iter()
        .map(|unit| unit.id.as_str())
        .collect::<BTreeSet<_>>();
    let mut seen = BTreeSet::new();
    for annotation in annotations {
        if !known.contains(annotation.unit_id.as_str()) {
            return Err(CurationError::InvalidSemanticRefinement(format!(
                "unknown unit id {}",
                annotation.unit_id
            )));
        }
        if !seen.insert(annotation.unit_id.as_str()) {
            return Err(CurationError::InvalidSemanticRefinement(format!(
                "duplicate unit id {}",
                annotation.unit_id
            )));
        }
        validate_annotation(annotation)?;
    }
    Ok(())
}

fn validate_annotation(annotation: &SemanticAnnotation) -> Result<(), CurationError> {
    if annotation.score_basis_points > 10_000 {
        return Err(CurationError::InvalidSemanticRefinement(format!(
            "unit {} score exceeds 10000",
            annotation.unit_id
        )));
    }
    if !matches!(
        annotation.label.as_str(),
        "aligned" | "uncertain" | "misaligned"
    ) {
        return Err(CurationError::InvalidSemanticRefinement(format!(
            "unit {} has unsupported label",
            annotation.unit_id
        )));
    }
    if annotation.evidence.chars().count() > MAX_EVIDENCE_VALUE_CHARS {
        return Err(CurationError::InvalidSemanticRefinement(format!(
            "unit {} evidence is too long",
            annotation.unit_id
        )));
    }
    Ok(())
}

fn evaluate_individual_units(
    units: &[&CurationUnit],
    policy: &CurationPolicy,
    findings: &mut Vec<CurationFinding>,
    scores: &mut BTreeMap<String, ScoreAccumulator>,
) {
    for unit in units {
        let source = normalize_match_key(&unit.source_text);
        let target = normalize_match_key(&unit.target_text);
        let source_chars = source.chars().count();
        let target_chars = target.chars().count();

        if !source.is_empty() && source == target {
            push_finding(
                findings,
                scores,
                unit,
                CurationFindingKind::SourceEqualsTarget,
                CurationSeverity::Error,
                CurationRecommendation::Quarantine,
                6_000,
                None,
                "Normalized source and target are identical.",
                CurationEvidence::default(),
            );
        }
        if source_chars < policy.minimum_chars as usize
            || target_chars < policy.minimum_chars as usize
        {
            push_finding(
                findings,
                scores,
                unit,
                CurationFindingKind::MinimumLength,
                CurationSeverity::Error,
                CurationRecommendation::Quarantine,
                7_000,
                None,
                "Source or target is shorter than the configured minimum.",
                CurationEvidence {
                    metrics: BTreeMap::from([
                        ("sourceChars".to_string(), source_chars as i64),
                        ("targetChars".to_string(), target_chars as i64),
                    ]),
                    ..CurationEvidence::default()
                },
            );
        }
        let ratio = target_chars
            .saturating_mul(100)
            .checked_div(source_chars)
            .unwrap_or(0);
        let length_outside = source_chars > 0
            && target_chars > 0
            && (ratio < policy.minimum_length_ratio_percent as usize
                || ratio > policy.maximum_length_ratio_percent as usize);
        if length_outside {
            push_finding(
                findings,
                scores,
                unit,
                CurationFindingKind::LengthRatio,
                CurationSeverity::Warning,
                CurationRecommendation::Review,
                1_500,
                None,
                "Target length is outside the configured source/target ratio.",
                CurationEvidence {
                    metrics: BTreeMap::from([
                        ("sourceChars".to_string(), source_chars as i64),
                        ("targetChars".to_string(), target_chars as i64),
                        ("ratioPercent".to_string(), ratio as i64),
                    ]),
                    ..CurationEvidence::default()
                },
            );
        }

        let source_dates = captures(&DATE_RE, &unit.source_text);
        let target_dates = captures(&DATE_RE, &unit.target_text);
        let date_mismatch = source_dates != target_dates;
        if date_mismatch {
            push_value_mismatch(
                findings,
                scores,
                unit,
                CurationFindingKind::DateMismatch,
                1_500,
                "Source and target dates do not match.",
                source_dates,
                target_dates,
            );
        }
        let source_numbers = numbers_outside_dates(&unit.source_text);
        let target_numbers = numbers_outside_dates(&unit.target_text);
        let number_mismatch = source_numbers != target_numbers;
        if number_mismatch {
            push_value_mismatch(
                findings,
                scores,
                unit,
                CurationFindingKind::NumberMismatch,
                1_500,
                "Source and target numbers do not match.",
                source_numbers,
                target_numbers,
            );
        }
        let source_placeholders = captures(&PLACEHOLDER_RE, &unit.source_text);
        let target_placeholders = captures(&PLACEHOLDER_RE, &unit.target_text);
        let placeholder_mismatch = source_placeholders != target_placeholders;
        if placeholder_mismatch {
            push_value_mismatch(
                findings,
                scores,
                unit,
                CurationFindingKind::PlaceholderMismatch,
                2_000,
                "Source and target placeholders do not match.",
                source_placeholders,
                target_placeholders,
            );
        }
        if policy
            .created_after_ms
            .is_some_and(|minimum| unit.created_at_ms < minimum)
            || policy
                .created_before_ms
                .is_some_and(|maximum| unit.created_at_ms > maximum)
        {
            push_finding(
                findings,
                scores,
                unit,
                CurationFindingKind::CreatedOutsideRange,
                CurationSeverity::Info,
                CurationRecommendation::Review,
                500,
                None,
                "Unit creation time is outside the configured range.",
                CurationEvidence {
                    metrics: BTreeMap::from([("createdAtMs".to_string(), unit.created_at_ms)]),
                    ..CurationEvidence::default()
                },
            );
        }

        let target_language_score = locale_script_score(&unit.target_locale, &unit.target_text);
        let source_language_score = locale_script_score(&unit.source_locale, &unit.source_text);
        let wrong_language = target_language_score.is_some_and(|score| score < 2_000)
            || source_language_score.is_some_and(|score| score < 2_000);
        if wrong_language {
            push_finding(
                findings,
                scores,
                unit,
                CurationFindingKind::LikelyWrongLanguage,
                CurationSeverity::Error,
                CurationRecommendation::Quarantine,
                5_000,
                None,
                "Text script is unlikely for the declared source or target locale.",
                CurationEvidence {
                    metrics: BTreeMap::from([
                        (
                            "sourceLocaleScore".to_string(),
                            i64::from(source_language_score.unwrap_or(10_000)),
                        ),
                        (
                            "targetLocaleScore".to_string(),
                            i64::from(target_language_score.unwrap_or(10_000)),
                        ),
                    ]),
                    ..CurationEvidence::default()
                },
            );
        }

        let semantic_score = deterministic_semantic_score(
            source_chars,
            target_chars,
            length_outside,
            number_mismatch,
            date_mismatch,
            placeholder_mismatch,
            wrong_language,
            source == target && !source.is_empty(),
        );
        if semantic_score < policy.semantic_alignment_threshold_basis_points {
            push_finding(
                findings,
                scores,
                unit,
                CurationFindingKind::SemanticMismatch,
                CurationSeverity::Warning,
                CurationRecommendation::Review,
                2_500,
                None,
                "Combined offline alignment signals indicate a likely semantic mismatch.",
                CurationEvidence {
                    metrics: BTreeMap::from([(
                        "alignmentScoreBasisPoints".to_string(),
                        i64::from(semantic_score),
                    )]),
                    ..CurationEvidence::default()
                },
            );
        }
    }
}

fn evaluate_duplicates(
    units: &[&CurationUnit],
    policy: &CurationPolicy,
    findings: &mut Vec<CurationFinding>,
    scores: &mut BTreeMap<String, ScoreAccumulator>,
) {
    let mut exact = BTreeMap::<(String, String), Vec<&CurationUnit>>::new();
    for unit in units {
        exact
            .entry((
                normalize_match_key(&unit.source_text),
                normalize_match_key(&unit.target_text),
            ))
            .or_default()
            .push(unit);
    }
    for group in exact.values_mut().filter(|group| group.len() > 1) {
        group.sort_by(|left, right| {
            left.created_at_ms
                .cmp(&right.created_at_ms)
                .then_with(|| left.id.cmp(&right.id))
        });
        let canonical = group[0];
        for duplicate in &group[1..] {
            push_finding(
                findings,
                scores,
                duplicate,
                CurationFindingKind::ExactDuplicate,
                CurationSeverity::Error,
                CurationRecommendation::Quarantine,
                6_000,
                Some(canonical.id.clone()),
                "Unit duplicates an earlier source/target pair in this library.",
                CurationEvidence {
                    related_unit_ids: vec![canonical.id.clone()],
                    ..CurationEvidence::default()
                },
            );
        }
    }

    let mut buckets = BTreeMap::<String, Vec<&CurationUnit>>::new();
    for unit in units {
        buckets
            .entry(near_duplicate_bucket(&unit.source_text))
            .or_default()
            .push(unit);
    }
    for bucket in buckets.values_mut() {
        bucket.sort_by(|left, right| {
            normalize_match_key(&left.source_text)
                .cmp(&normalize_match_key(&right.source_text))
                .then_with(|| left.id.cmp(&right.id))
        });
        if bucket.len() > MAX_NEAR_DUPLICATE_BUCKET {
            bucket.truncate(MAX_NEAR_DUPLICATE_BUCKET);
        }
        for (index, left) in bucket.iter().enumerate() {
            for right in bucket.iter().skip(index + 1).take(8) {
                let left_source = normalize_match_key(&left.source_text);
                let right_source = normalize_match_key(&right.source_text);
                if left_source == right_source {
                    continue;
                }
                let source_score = match_score(&left.source_text, &right.source_text).score;
                if source_score < policy.near_duplicate_threshold {
                    continue;
                }
                let (canonical, candidate) =
                    if (left.created_at_ms, &left.id) <= (right.created_at_ms, &right.id) {
                        (*left, *right)
                    } else {
                        (*right, *left)
                    };
                push_finding(
                    findings,
                    scores,
                    candidate,
                    CurationFindingKind::NearDuplicate,
                    CurationSeverity::Warning,
                    CurationRecommendation::Review,
                    1_500,
                    Some(canonical.id.clone()),
                    "Source is a near duplicate of an earlier unit.",
                    CurationEvidence {
                        related_unit_ids: vec![canonical.id.clone()],
                        metrics: BTreeMap::from([(
                            "sourceSimilarityPercent".to_string(),
                            i64::from(source_score),
                        )]),
                        ..CurationEvidence::default()
                    },
                );
            }
        }
    }
}

fn evaluate_drift(
    units: &[&CurationUnit],
    findings: &mut Vec<CurationFinding>,
    scores: &mut BTreeMap<String, ScoreAccumulator>,
) -> Vec<CurationDriftGroup> {
    let mut by_source = BTreeMap::<String, Vec<&CurationUnit>>::new();
    for unit in units {
        let key = normalize_match_key(&unit.source_text);
        if !key.is_empty() && !normalize_match_key(&unit.target_text).is_empty() {
            by_source.entry(key).or_default().push(unit);
        }
    }
    let mut groups = Vec::new();
    for (source_key, mut group) in by_source {
        let targets = group
            .iter()
            .map(|unit| normalize_match_key(&unit.target_text))
            .collect::<BTreeSet<_>>();
        if targets.len() <= 1 {
            continue;
        }
        group.sort_by(|left, right| {
            left.created_at_ms
                .cmp(&right.created_at_ms)
                .then_with(|| left.id.cmp(&right.id))
        });
        let canonical = group[0];
        let unit_ids = group.iter().map(|unit| unit.id.clone()).collect::<Vec<_>>();
        let target_variants = group
            .iter()
            .map(|unit| bounded_value(&unit.target_text))
            .collect::<BTreeSet<_>>()
            .into_iter()
            .take(MAX_EVIDENCE_VALUES)
            .collect::<Vec<_>>();
        for unit in group.iter() {
            push_finding(
                findings,
                scores,
                unit,
                CurationFindingKind::CompetingTranslation,
                CurationSeverity::Warning,
                CurationRecommendation::Review,
                1_500,
                Some(canonical.id.clone()),
                "The same normalized source has competing target translations.",
                CurationEvidence {
                    target_values: target_variants.clone(),
                    related_unit_ids: bounded_ids(&unit_ids),
                    ..CurationEvidence::default()
                },
            );
        }
        groups.push(CurationDriftGroup {
            source_key,
            source_text: bounded_value(&canonical.source_text),
            target_variants,
            unit_ids: bounded_ids(&unit_ids),
        });
    }
    groups.sort_by(|left, right| left.source_key.cmp(&right.source_key));
    groups
}

fn evaluate_semantic_annotations(
    annotations: &[SemanticAnnotation],
    policy: &CurationPolicy,
    findings: &mut Vec<CurationFinding>,
    scores: &mut BTreeMap<String, ScoreAccumulator>,
) {
    for annotation in annotations {
        if annotation.label == "aligned"
            && annotation.score_basis_points >= policy.semantic_alignment_threshold_basis_points
        {
            continue;
        }
        let severity = if annotation.label == "misaligned" {
            CurationSeverity::Error
        } else {
            CurationSeverity::Warning
        };
        let recommendation = if annotation.label == "misaligned" {
            CurationRecommendation::Review
        } else {
            CurationRecommendation::Keep
        };
        let penalty = if annotation.label == "misaligned" {
            3_000
        } else {
            1_000
        };
        let evidence = CurationEvidence {
            target_values: vec![bounded_value(&annotation.evidence)],
            metrics: BTreeMap::from([(
                "providerScoreBasisPoints".to_string(),
                i64::from(annotation.score_basis_points),
            )]),
            ..CurationEvidence::default()
        };
        push_raw_finding(
            findings,
            scores,
            &annotation.unit_id,
            CurationFindingKind::SemanticMismatch,
            severity,
            recommendation,
            penalty,
            None,
            "Optional provider refinement marked this pair uncertain or misaligned.",
            evidence,
        );
    }
}

fn mine_terms(units: &[&CurationUnit], policy: &CurationPolicy) -> Vec<CurationTermCandidate> {
    let mut groups = BTreeMap::<String, Vec<&CurationUnit>>::new();
    for unit in units {
        let source = normalize_match_key(&unit.source_text);
        let target = normalize_match_key(&unit.target_text);
        if source.is_empty()
            || target.is_empty()
            || unit.source_text.chars().count() > 80
            || source.split_whitespace().count() > 8
        {
            continue;
        }
        groups.entry(source).or_default().push(unit);
    }
    let mut candidates = Vec::new();
    for group in groups
        .values_mut()
        .filter(|group| group.len() >= policy.minimum_term_frequency as usize)
    {
        group.sort_by(|left, right| {
            left.created_at_ms
                .cmp(&right.created_at_ms)
                .then_with(|| left.id.cmp(&right.id))
        });
        let mut targets = BTreeMap::<String, Vec<&CurationUnit>>::new();
        for unit in group.iter().copied() {
            targets
                .entry(normalize_match_key(&unit.target_text))
                .or_default()
                .push(unit);
        }
        let Some((_, stable)) = targets.into_iter().max_by(|left, right| {
            left.1
                .len()
                .cmp(&right.1.len())
                .then_with(|| right.0.cmp(&left.0))
        }) else {
            continue;
        };
        let agreement = stable.len().saturating_mul(10_000) / group.len();
        if agreement < 6_000 {
            continue;
        }
        let exemplar = stable[0];
        candidates.push(CurationTermCandidate {
            source_term: bounded_value(&group[0].source_text),
            target_term: bounded_value(&exemplar.target_text),
            source_locale: exemplar.source_locale.clone(),
            target_locale: exemplar.target_locale.clone(),
            domain: exemplar.domain.clone(),
            frequency: u32::try_from(group.len()).unwrap_or(u32::MAX),
            agreement_basis_points: u16::try_from(agreement).unwrap_or(10_000),
            unit_ids: bounded_ids(&group.iter().map(|unit| unit.id.clone()).collect::<Vec<_>>()),
        });
    }
    candidates.sort_by(|left, right| {
        right
            .frequency
            .cmp(&left.frequency)
            .then_with(|| left.source_term.cmp(&right.source_term))
            .then_with(|| left.target_term.cmp(&right.target_term))
    });
    candidates
}

#[allow(clippy::too_many_arguments)]
fn push_finding(
    findings: &mut Vec<CurationFinding>,
    scores: &mut BTreeMap<String, ScoreAccumulator>,
    unit: &CurationUnit,
    kind: CurationFindingKind,
    severity: CurationSeverity,
    recommendation: CurationRecommendation,
    penalty: u16,
    canonical_unit_id: Option<String>,
    explanation: &str,
    evidence: CurationEvidence,
) {
    push_raw_finding(
        findings,
        scores,
        &unit.id,
        kind,
        severity,
        recommendation,
        penalty,
        canonical_unit_id,
        explanation,
        evidence,
    );
}

#[allow(clippy::too_many_arguments)]
fn push_raw_finding(
    findings: &mut Vec<CurationFinding>,
    scores: &mut BTreeMap<String, ScoreAccumulator>,
    unit_id: &str,
    kind: CurationFindingKind,
    severity: CurationSeverity,
    recommendation: CurationRecommendation,
    penalty: u16,
    canonical_unit_id: Option<String>,
    explanation: &str,
    mut evidence: CurationEvidence,
) {
    evidence.source_values = bounded_values(&evidence.source_values);
    evidence.target_values = bounded_values(&evidence.target_values);
    evidence.related_unit_ids = bounded_ids(&evidence.related_unit_ids);
    let fingerprint = finding_fingerprint(unit_id, kind, canonical_unit_id.as_deref(), &evidence);
    findings.push(CurationFinding {
        fingerprint,
        unit_id: unit_id.to_string(),
        kind,
        severity,
        recommendation,
        penalty_basis_points: penalty,
        canonical_unit_id,
        explanation: explanation.to_string(),
        evidence,
    });
    if let Some(score) = scores.get_mut(unit_id) {
        score.penalty = score.penalty.saturating_add(u32::from(penalty));
        score.recommendation = score.recommendation.max(recommendation);
        score.explanations.push(explanation.to_string());
    }
}

#[allow(clippy::too_many_arguments)]
fn push_value_mismatch(
    findings: &mut Vec<CurationFinding>,
    scores: &mut BTreeMap<String, ScoreAccumulator>,
    unit: &CurationUnit,
    kind: CurationFindingKind,
    penalty: u16,
    explanation: &str,
    source_values: Vec<String>,
    target_values: Vec<String>,
) {
    push_finding(
        findings,
        scores,
        unit,
        kind,
        CurationSeverity::Warning,
        CurationRecommendation::Review,
        penalty,
        None,
        explanation,
        CurationEvidence {
            source_values,
            target_values,
            ..CurationEvidence::default()
        },
    );
}

fn finding_fingerprint(
    unit_id: &str,
    kind: CurationFindingKind,
    canonical_unit_id: Option<&str>,
    evidence: &CurationEvidence,
) -> String {
    let mut hasher = Sha256::new();
    hasher.update(unit_id.as_bytes());
    hasher.update([0]);
    hasher.update(kind.as_str().as_bytes());
    hasher.update([0]);
    hasher.update(canonical_unit_id.unwrap_or("").as_bytes());
    hasher.update([0]);
    hasher.update(serde_json::to_vec(evidence).expect("curation evidence serialization"));
    format!("{:x}", hasher.finalize())
}

#[allow(clippy::too_many_arguments)]
fn deterministic_semantic_score(
    source_chars: usize,
    target_chars: usize,
    length_outside: bool,
    number_mismatch: bool,
    date_mismatch: bool,
    placeholder_mismatch: bool,
    wrong_language: bool,
    source_equals_target: bool,
) -> u16 {
    if source_chars == 0 || target_chars == 0 {
        return 0;
    }
    let mut score = 10_000_u16;
    if length_outside {
        score = score.saturating_sub(3_000);
    }
    if number_mismatch {
        score = score.saturating_sub(2_000);
    }
    if date_mismatch {
        score = score.saturating_sub(1_500);
    }
    if placeholder_mismatch {
        score = score.saturating_sub(2_500);
    }
    if wrong_language {
        score = score.saturating_sub(4_500);
    }
    if source_equals_target {
        score = score.saturating_sub(5_000);
    }
    score
}

#[derive(Clone, Copy)]
enum ExpectedScript {
    Latin,
    Han,
    Japanese,
    Hangul,
    Cyrillic,
    Arabic,
    Hebrew,
}

fn locale_script_score(locale: &str, text: &str) -> Option<u16> {
    let expected = expected_script(locale);
    let counts = script_counts(text);
    if counts.total < 6 {
        return None;
    }
    let matching = match expected {
        ExpectedScript::Latin => counts.latin,
        ExpectedScript::Han => counts.han,
        ExpectedScript::Japanese => counts.han + counts.japanese,
        ExpectedScript::Hangul => counts.hangul,
        ExpectedScript::Cyrillic => counts.cyrillic,
        ExpectedScript::Arabic => counts.arabic,
        ExpectedScript::Hebrew => counts.hebrew,
    };
    Some(u16::try_from(matching.saturating_mul(10_000) / counts.total).unwrap_or(10_000))
}

fn expected_script(locale: &str) -> ExpectedScript {
    match locale
        .split(['-', '_'])
        .next()
        .unwrap_or(locale)
        .to_ascii_lowercase()
        .as_str()
    {
        "zh" => ExpectedScript::Han,
        "ja" => ExpectedScript::Japanese,
        "ko" => ExpectedScript::Hangul,
        "ru" | "uk" | "bg" | "sr" | "mk" => ExpectedScript::Cyrillic,
        "ar" | "fa" | "ur" => ExpectedScript::Arabic,
        "he" | "yi" => ExpectedScript::Hebrew,
        _ => ExpectedScript::Latin,
    }
}

#[derive(Default)]
struct ScriptCounts {
    total: usize,
    latin: usize,
    han: usize,
    japanese: usize,
    hangul: usize,
    cyrillic: usize,
    arabic: usize,
    hebrew: usize,
}

fn script_counts(text: &str) -> ScriptCounts {
    let mut counts = ScriptCounts::default();
    for character in text.chars() {
        let value = character as u32;
        let slot = if matches!(value, 0x0041..=0x005A | 0x0061..=0x007A | 0x00C0..=0x024F) {
            Some(&mut counts.latin)
        } else if matches!(value, 0x3400..=0x4DBF | 0x4E00..=0x9FFF | 0xF900..=0xFAFF) {
            Some(&mut counts.han)
        } else if matches!(value, 0x3040..=0x30FF) {
            Some(&mut counts.japanese)
        } else if matches!(value, 0xAC00..=0xD7AF | 0x1100..=0x11FF) {
            Some(&mut counts.hangul)
        } else if matches!(value, 0x0400..=0x052F) {
            Some(&mut counts.cyrillic)
        } else if matches!(value, 0x0600..=0x06FF | 0x0750..=0x077F) {
            Some(&mut counts.arabic)
        } else if matches!(value, 0x0590..=0x05FF) {
            Some(&mut counts.hebrew)
        } else {
            None
        };
        if let Some(slot) = slot {
            *slot += 1;
            counts.total += 1;
        }
    }
    counts
}

fn near_duplicate_bucket(text: &str) -> String {
    normalize_match_key(text)
        .chars()
        .filter(|character| character.is_alphanumeric())
        .take(8)
        .collect()
}

fn captures(regex: &Regex, value: &str) -> Vec<String> {
    let mut values = regex
        .find_iter(value)
        .map(|matched| matched.as_str().to_string())
        .collect::<Vec<_>>();
    values.sort();
    values
}

fn numbers_outside_dates(value: &str) -> Vec<String> {
    let date_ranges = DATE_RE
        .find_iter(value)
        .map(|item| item.start()..item.end())
        .collect::<Vec<_>>();
    let mut values = NUMBER_RE
        .find_iter(value)
        .filter(|item| {
            !date_ranges
                .iter()
                .any(|range| range.start <= item.start() && item.end() <= range.end)
        })
        .map(|item| item.as_str().to_string())
        .collect::<Vec<_>>();
    values.sort();
    values
}

fn bounded_value(value: &str) -> String {
    value.chars().take(MAX_EVIDENCE_VALUE_CHARS).collect()
}

fn bounded_values(values: &[String]) -> Vec<String> {
    values
        .iter()
        .take(MAX_EVIDENCE_VALUES)
        .map(|value| bounded_value(value))
        .collect()
}

fn bounded_ids(values: &[String]) -> Vec<String> {
    values.iter().take(MAX_EVIDENCE_VALUES).cloned().collect()
}

fn validate_dataset_unit(unit: &DatasetUnit) -> Result<(), CurationError> {
    if unit.unit_id.trim().is_empty()
        || unit.source_locale.trim().is_empty()
        || unit.target_locale.trim().is_empty()
        || unit.source_text.trim().is_empty()
        || unit.target_text.trim().is_empty()
    {
        return Err(CurationError::Dataset(
            "dataset unit has an empty required field".to_string(),
        ));
    }
    if unit.quality_score_basis_points > 10_000 {
        return Err(CurationError::Dataset(
            "dataset unit score exceeds 10000".to_string(),
        ));
    }
    Ok(())
}

fn to_u32(value: usize) -> Result<u32, CurationError> {
    u32::try_from(value)
        .map_err(|_| CurationError::InvalidInput("curation count overflow".to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn unit(id: &str, source: &str, target: &str, created_at_ms: i64) -> CurationUnit {
        CurationUnit {
            id: id.to_string(),
            library_id: "tm-1".to_string(),
            source_locale: "en-US".to_string(),
            target_locale: "zh-CN".to_string(),
            source_text: source.to_string(),
            target_text: target.to_string(),
            domain: Some("legal".to_string()),
            origin_project_id: Some("project-1".to_string()),
            origin_document_id: Some("document-1".to_string()),
            origin_segment_id: Some(format!("segment-{id}")),
            author: Some("fixture".to_string()),
            metadata: BTreeMap::new(),
            created_at_ms,
        }
    }

    #[test]
    fn dirty_fixture_reaches_detection_gate_without_quarantining_clean_rows() {
        let mut units = vec![
            unit("clean-1", "The valve remains open.", "阀门保持开启。", 10),
            unit("clean-2", "The pump remains closed.", "泵保持关闭。", 11),
            unit(
                "duplicate-base",
                "Invoice 42 is due.",
                "发票 42 已到期。",
                20,
            ),
            unit(
                "dirty-duplicate",
                "Invoice 42 is due.",
                "发票 42 已到期。",
                21,
            ),
            unit(
                "dirty-equal",
                "Do not translate Acme",
                "Do not translate Acme",
                22,
            ),
            unit("dirty-short", "A", "", 23),
            unit(
                "dirty-length",
                "This is a deliberately long source sentence for ratio checks.",
                "短",
                24,
            ),
            unit("dirty-number", "Retain for 30 days.", "保留 60 天。", 25),
            unit(
                "dirty-date",
                "Signed on 2026-07-01.",
                "签署于 2025-01-01。",
                26,
            ),
            unit("dirty-placeholder", "Hello {name}.", "你好。", 27),
            unit(
                "dirty-language",
                "Close the safety valve.",
                "Close the safety valve now.",
                28,
            ),
            unit("dirty-drift-a", "Emergency stop", "紧急停止", 29),
            unit("dirty-drift-b", "Emergency stop", "急停", 30),
            unit(
                "dirty-near",
                "Invoice 42 is now due.",
                "发票 42 现在已到期。",
                31,
            ),
        ];
        units[2].origin_segment_id = None;
        let dirty = units
            .iter()
            .filter(|unit| unit.id.starts_with("dirty-"))
            .map(|unit| unit.id.clone())
            .collect::<BTreeSet<_>>();
        let analysis = analyze(&units, &CurationPolicy::default(), &[]).expect("analyze fixture");
        let detected = analysis
            .findings
            .iter()
            .map(|finding| finding.unit_id.clone())
            .collect::<BTreeSet<_>>();
        let detected_dirty = dirty.intersection(&detected).count();
        assert!(
            detected_dirty * 100 / dirty.len() >= 90,
            "detected {detected_dirty}/{} dirty rows: {detected:?}",
            dirty.len()
        );
        for id in ["clean-1", "clean-2"] {
            let score = analysis
                .scores
                .iter()
                .find(|score| score.unit_id == id)
                .expect("clean score");
            assert_ne!(score.recommendation, CurationRecommendation::Quarantine);
            assert!(score.quality_score_basis_points >= 8_000);
        }
        assert!(analysis.summary.drift_group_count >= 1);
    }

    #[test]
    fn analysis_and_mining_are_deterministic() {
        let units = vec![
            unit("a", "Emergency stop", "紧急停止", 1),
            unit("b", "Emergency stop", "紧急停止", 2),
            unit("c", "Emergency stop", "急停", 3),
        ];
        let first = analyze(&units, &CurationPolicy::default(), &[]).expect("first analysis");
        let second = analyze(&units, &CurationPolicy::default(), &[]).expect("second analysis");
        assert_eq!(first, second);
        assert_eq!(first.term_candidates.len(), 1);
        assert_eq!(first.term_candidates[0].target_term, "紧急停止");
        assert_eq!(first.drift_groups.len(), 1);
    }

    #[test]
    fn provider_annotations_are_strict_and_id_bound() {
        let known = BTreeSet::from(["unit-1".to_string()]);
        let valid = br#"{"annotations":[{"unitId":"unit-1","scoreBasisPoints":1200,"label":"misaligned","evidence":"Unrelated meanings"}]}"#;
        let parsed = parse_semantic_annotations(valid, &known).expect("valid annotations");
        assert_eq!(parsed[0].unit_id, "unit-1");

        let unknown = br#"{"annotations":[{"unitId":"unit-2","scoreBasisPoints":1200,"label":"misaligned","evidence":"Unknown"}]}"#;
        assert!(parse_semantic_annotations(unknown, &known).is_err());
        let extra = br#"{"annotations":[{"unitId":"unit-1","scoreBasisPoints":1200,"label":"misaligned","evidence":"x","sourceText":"leak"}]}"#;
        assert!(parse_semantic_annotations(extra, &known).is_err());
    }

    #[test]
    fn dataset_formats_preserve_tabs_quotes_and_provenance() {
        let rows = vec![DatasetUnit {
            unit_id: "unit-1".to_string(),
            source_locale: "en-US".to_string(),
            target_locale: "zh-CN".to_string(),
            source_text: "A\tquoted \"source\"".to_string(),
            target_text: "带\t制表符".to_string(),
            domain: Some("general".to_string()),
            origin_project_id: Some("project-1".to_string()),
            origin_document_id: None,
            origin_segment_id: None,
            quality_score_basis_points: 9_500,
        }];
        let jsonl = render_dataset_jsonl(&rows).expect("render jsonl");
        let jsonl_value: serde_json::Value = serde_json::from_slice(
            jsonl
                .split(|byte| *byte == b'\n')
                .next()
                .expect("first line"),
        )
        .expect("decode jsonl value");
        assert_eq!(jsonl_value["instruction"], rows[0].source_text);
        assert_eq!(jsonl_value["response"], rows[0].target_text);
        let decoded: DatasetUnit = serde_json::from_slice(
            jsonl
                .split(|byte| *byte == b'\n')
                .next()
                .expect("first line"),
        )
        .expect("decode jsonl");
        assert_eq!(decoded, rows[0]);

        let tsv = render_dataset_tsv(&rows).expect("render tsv");
        let mut reader = csv::ReaderBuilder::new()
            .delimiter(b'\t')
            .from_reader(tsv.as_slice());
        let record = reader
            .records()
            .next()
            .expect("one row")
            .expect("valid row");
        assert_eq!(record.get(3), Some("A\tquoted \"source\""));
        assert_eq!(record.get(4), Some("带\t制表符"));
    }

    #[test]
    fn invalid_policy_and_cross_library_input_are_rejected() {
        let policy = CurationPolicy {
            minimum_length_ratio_percent: 600,
            ..CurationPolicy::default()
        };
        assert!(analyze(&[], &policy, &[]).is_err());

        let mut units = vec![unit("a", "A valid source", "有效译文", 1)];
        let mut second = unit("b", "Another source", "另一译文", 2);
        second.library_id = "tm-2".to_string();
        units.push(second);
        assert!(analyze(&units, &CurationPolicy::default(), &[]).is_err());
    }
}

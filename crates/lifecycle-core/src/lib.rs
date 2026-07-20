//! Deterministic project lifecycle, re-import, archive, and analysis primitives.

use std::collections::{BTreeMap, BTreeSet};

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use thiserror::Error;
use unicode_normalization::UnicodeNormalization;

pub const PROJECT_ARCHIVE_FORMAT_VERSION: u16 = 1;
pub const MAX_ARCHIVE_ENTRIES: usize = 100_000;
pub const MAX_ARCHIVE_ENTRY_BYTES: u64 = 2 * 1024 * 1024 * 1024;
pub const MAX_ARCHIVE_TOTAL_BYTES: u64 = 20 * 1024 * 1024 * 1024;

#[derive(Debug, Error, PartialEq, Eq)]
pub enum LifecycleCoreError {
    #[error("invalid lifecycle input: {0}")]
    InvalidInput(String),
    #[error("invalid project archive: {0}")]
    InvalidArchive(String),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReimportSegment {
    pub id: String,
    pub ordinal: u32,
    pub structural_path: String,
    pub source_text: String,
    #[serde(default)]
    pub context_before: String,
    #[serde(default)]
    pub context_after: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum ReimportDisposition {
    Unchanged,
    Changed,
    New,
    Removed,
    Ambiguous,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReimportMatch {
    pub disposition: ReimportDisposition,
    pub old_segment_id: Option<String>,
    pub new_segment_id: Option<String>,
    pub old_ordinal: Option<u32>,
    pub new_ordinal: Option<u32>,
    pub reason: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReimportPlan {
    pub items: Vec<ReimportMatch>,
    pub unchanged: u32,
    pub changed: u32,
    pub new_segments: u32,
    pub removed: u32,
    pub ambiguous: u32,
}

pub fn plan_reimport(
    old_segments: &[ReimportSegment],
    new_segments: &[ReimportSegment],
) -> Result<ReimportPlan, LifecycleCoreError> {
    validate_segments("old", old_segments)?;
    validate_segments("new", new_segments)?;

    let mut matches: Vec<Option<ReimportMatch>> = vec![None; new_segments.len()];
    let mut used_old = BTreeSet::new();
    let old_by_path: BTreeMap<&str, usize> = old_segments
        .iter()
        .enumerate()
        .map(|(index, segment)| (segment.structural_path.as_str(), index))
        .collect();

    // Stable structural identity is authoritative, including when source text changed.
    for (new_index, new_segment) in new_segments.iter().enumerate() {
        let Some(&old_index) = old_by_path.get(new_segment.structural_path.as_str()) else {
            continue;
        };
        let old_segment = &old_segments[old_index];
        used_old.insert(old_index);
        let unchanged = normalize(&old_segment.source_text) == normalize(&new_segment.source_text);
        matches[new_index] = Some(ReimportMatch {
            disposition: if unchanged {
                ReimportDisposition::Unchanged
            } else {
                ReimportDisposition::Changed
            },
            old_segment_id: Some(old_segment.id.clone()),
            new_segment_id: Some(new_segment.id.clone()),
            old_ordinal: Some(old_segment.ordinal),
            new_ordinal: Some(new_segment.ordinal),
            reason: if unchanged {
                "structuralPath+source".to_string()
            } else {
                "structuralPathChangedSource".to_string()
            },
        });
    }

    let mut old_by_source: BTreeMap<String, Vec<usize>> = BTreeMap::new();
    for (index, segment) in old_segments.iter().enumerate() {
        if !used_old.contains(&index) {
            old_by_source
                .entry(normalize(&segment.source_text))
                .or_default()
                .push(index);
        }
    }

    for (new_index, new_segment) in new_segments.iter().enumerate() {
        if matches[new_index].is_some() {
            continue;
        }
        let candidates = old_by_source
            .get(&normalize(&new_segment.source_text))
            .map(Vec::as_slice)
            .unwrap_or_default();
        let available: Vec<usize> = candidates
            .iter()
            .copied()
            .filter(|index| !used_old.contains(index))
            .collect();
        let selected = select_unique_context_match(old_segments, new_segment, &available);
        match selected {
            MatchChoice::Unique(old_index, reason) => {
                used_old.insert(old_index);
                let old_segment = &old_segments[old_index];
                matches[new_index] = Some(ReimportMatch {
                    disposition: ReimportDisposition::Unchanged,
                    old_segment_id: Some(old_segment.id.clone()),
                    new_segment_id: Some(new_segment.id.clone()),
                    old_ordinal: Some(old_segment.ordinal),
                    new_ordinal: Some(new_segment.ordinal),
                    reason: reason.to_string(),
                });
            }
            MatchChoice::Ambiguous => {
                matches[new_index] = Some(ReimportMatch {
                    disposition: ReimportDisposition::Ambiguous,
                    old_segment_id: None,
                    new_segment_id: Some(new_segment.id.clone()),
                    old_ordinal: None,
                    new_ordinal: Some(new_segment.ordinal),
                    reason: "duplicateSourceAmbiguousContext".to_string(),
                });
            }
            MatchChoice::None => {
                matches[new_index] = Some(ReimportMatch {
                    disposition: ReimportDisposition::New,
                    old_segment_id: None,
                    new_segment_id: Some(new_segment.id.clone()),
                    old_ordinal: None,
                    new_ordinal: Some(new_segment.ordinal),
                    reason: "newSource".to_string(),
                });
            }
        }
    }

    let mut items: Vec<ReimportMatch> = matches.into_iter().flatten().collect();
    for (old_index, old_segment) in old_segments.iter().enumerate() {
        if !used_old.contains(&old_index) {
            items.push(ReimportMatch {
                disposition: ReimportDisposition::Removed,
                old_segment_id: Some(old_segment.id.clone()),
                new_segment_id: None,
                old_ordinal: Some(old_segment.ordinal),
                new_ordinal: None,
                reason: "removedSource".to_string(),
            });
        }
    }
    Ok(summarize_reimport(items))
}

enum MatchChoice {
    Unique(usize, &'static str),
    Ambiguous,
    None,
}

fn select_unique_context_match(
    old_segments: &[ReimportSegment],
    new_segment: &ReimportSegment,
    candidates: &[usize],
) -> MatchChoice {
    match candidates {
        [] => MatchChoice::None,
        [index] => MatchChoice::Unique(*index, "uniqueNormalizedSource"),
        _ => {
            let new_before = normalize(&new_segment.context_before);
            let new_after = normalize(&new_segment.context_after);
            let scored: Vec<(usize, u8)> = candidates
                .iter()
                .map(|index| {
                    let old = &old_segments[*index];
                    let score = u8::from(
                        !new_before.is_empty() && normalize(&old.context_before) == new_before,
                    ) + u8::from(
                        !new_after.is_empty() && normalize(&old.context_after) == new_after,
                    );
                    (*index, score)
                })
                .collect();
            let best = scored.iter().map(|(_, score)| *score).max().unwrap_or(0);
            let winners: Vec<usize> = scored
                .into_iter()
                .filter_map(|(index, score)| (score == best && score > 0).then_some(index))
                .collect();
            if let [index] = winners.as_slice() {
                MatchChoice::Unique(*index, "normalizedSource+uniqueContext")
            } else {
                MatchChoice::Ambiguous
            }
        }
    }
}

fn validate_segments(side: &str, segments: &[ReimportSegment]) -> Result<(), LifecycleCoreError> {
    let mut ids = BTreeSet::new();
    let mut paths = BTreeSet::new();
    for segment in segments {
        if segment.id.trim().is_empty() || !ids.insert(segment.id.as_str()) {
            return Err(LifecycleCoreError::InvalidInput(format!(
                "{side} segments contain an empty or duplicate ID"
            )));
        }
        if segment.structural_path.trim().is_empty()
            || !paths.insert(segment.structural_path.as_str())
        {
            return Err(LifecycleCoreError::InvalidInput(format!(
                "{side} segments contain an empty or duplicate structural path"
            )));
        }
    }
    Ok(())
}

fn summarize_reimport(items: Vec<ReimportMatch>) -> ReimportPlan {
    let count = |disposition| {
        u32::try_from(
            items
                .iter()
                .filter(|item| item.disposition == disposition)
                .count(),
        )
        .unwrap_or(u32::MAX)
    };
    ReimportPlan {
        unchanged: count(ReimportDisposition::Unchanged),
        changed: count(ReimportDisposition::Changed),
        new_segments: count(ReimportDisposition::New),
        removed: count(ReimportDisposition::Removed),
        ambiguous: count(ReimportDisposition::Ambiguous),
        items,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum WorkflowBucket {
    Translation,
    Review,
    Signed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisSegment {
    pub id: String,
    pub source_text: String,
    #[serde(default)]
    pub target_text: String,
    pub workflow: WorkflowBucket,
    pub tm_match_percent: Option<u8>,
    pub ai_proposal: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisWeights {
    pub no_match_basis_points: u16,
    pub match_50_74_basis_points: u16,
    pub match_75_84_basis_points: u16,
    pub match_85_94_basis_points: u16,
    pub match_95_99_basis_points: u16,
    pub exact_basis_points: u16,
    pub repetition_basis_points: u16,
}

impl Default for AnalysisWeights {
    fn default() -> Self {
        Self {
            no_match_basis_points: 10_000,
            match_50_74_basis_points: 8_000,
            match_75_84_basis_points: 6_000,
            match_85_94_basis_points: 4_000,
            match_95_99_basis_points: 2_000,
            exact_basis_points: 0,
            repetition_basis_points: 1_000,
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct MatchBandCounts {
    pub no_match: u64,
    pub match_50_74: u64,
    pub match_75_84: u64,
    pub match_85_94: u64,
    pub match_95_99: u64,
    pub exact: u64,
    pub repetitions: u64,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AiContribution {
    pub applied_segments: u64,
    pub retained_segments: u64,
    pub replaced_segments: u64,
    pub proposal_characters: u64,
    pub retained_characters: u64,
    pub edit_distance: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisSummary {
    pub segments: u64,
    pub source_words: u64,
    pub source_characters: u64,
    pub source_cjk_characters: u64,
    pub target_words: u64,
    pub target_characters: u64,
    pub target_cjk_characters: u64,
    pub repeated_segments: u64,
    pub workflow_translation: u64,
    pub workflow_review: u64,
    pub workflow_signed: u64,
    pub match_bands: MatchBandCounts,
    pub weighted_effort_milli_units: u64,
    pub ai_contribution: AiContribution,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct OptionalCountMetric {
    pub available: bool,
    pub value: Option<u64>,
    pub reason: Option<String>,
}

impl OptionalCountMetric {
    pub fn available(value: u64) -> Self {
        Self {
            available: true,
            value: Some(value),
            reason: None,
        }
    }

    pub fn unavailable(reason: impl Into<String>) -> Self {
        Self {
            available: false,
            value: None,
            reason: Some(reason.into()),
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProgressSummary {
    pub total_segments: u64,
    pub untranslated_segments: u64,
    pub draft_segments: u64,
    pub confirmed_segments: u64,
    pub workflow_translation: u64,
    pub workflow_review: u64,
    pub workflow_signed: u64,
    pub reviewed_segments: u64,
    pub qa_blockers: u64,
    pub completion_basis_points: u16,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProductivitySummary {
    pub idle_gap_ms: u64,
    pub activity_events: u64,
    pub active_editing_ms: OptionalCountMetric,
    pub confirmed_segments_per_hour_milli: OptionalCountMetric,
    pub time_in_state_ms: BTreeMap<String, OptionalCountMetric>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AiContributionSummary {
    pub available: bool,
    pub contribution: AiContribution,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AssetHealthSummary {
    pub tm_confirmed_units: u64,
    pub term_entries: u64,
    pub qa_open_blockers: u64,
    pub tm_reuse_segments: OptionalCountMetric,
    pub mounted_library_hit_segments: OptionalCountMetric,
    pub curation_outcomes: OptionalCountMetric,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AnalyticsTrendBucket {
    pub start_ms: i64,
    pub end_ms: i64,
    pub target_edits: u64,
    pub confirmations: u64,
    pub workflow_transitions: u64,
    pub tm_units_added: u64,
    pub terms_added: u64,
    pub qa_runs_completed: u64,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProjectAnalyticsSummary {
    pub project_id: String,
    pub generated_at_ms: i64,
    pub progress: ProgressSummary,
    pub document_progress: BTreeMap<String, ProgressSummary>,
    pub productivity: ProductivitySummary,
    pub ai: AiContributionSummary,
    pub assets: AssetHealthSummary,
    pub trends: Vec<AnalyticsTrendBucket>,
}

pub fn active_editing_ms(event_times_ms: &[i64], idle_gap_ms: u64) -> Option<u64> {
    if event_times_ms.len() < 2 || idle_gap_ms == 0 {
        return None;
    }
    let mut ordered = event_times_ms.to_vec();
    ordered.sort_unstable();
    let mut total = 0_u64;
    for pair in ordered.windows(2) {
        let Ok(delta) = u64::try_from(pair[1].saturating_sub(pair[0])) else {
            continue;
        };
        total = total.saturating_add(delta.min(idle_gap_ms));
    }
    Some(total)
}

pub fn analyze_segments(
    segments: &[AnalysisSegment],
    weights: &AnalysisWeights,
) -> Result<AnalysisSummary, LifecycleCoreError> {
    validate_weights(weights)?;
    let mut summary = AnalysisSummary {
        segments: u64::try_from(segments.len()).unwrap_or(u64::MAX),
        source_words: 0,
        source_characters: 0,
        source_cjk_characters: 0,
        target_words: 0,
        target_characters: 0,
        target_cjk_characters: 0,
        repeated_segments: 0,
        workflow_translation: 0,
        workflow_review: 0,
        workflow_signed: 0,
        match_bands: MatchBandCounts::default(),
        weighted_effort_milli_units: 0,
        ai_contribution: AiContribution::default(),
    };
    let mut source_counts = BTreeMap::<String, u64>::new();
    for segment in segments {
        let source = text_counts(&segment.source_text);
        let target = text_counts(&segment.target_text);
        summary.source_words += source.words;
        summary.source_characters += source.characters;
        summary.source_cjk_characters += source.cjk_characters;
        summary.target_words += target.words;
        summary.target_characters += target.characters;
        summary.target_cjk_characters += target.cjk_characters;
        match segment.workflow {
            WorkflowBucket::Translation => summary.workflow_translation += 1,
            WorkflowBucket::Review => summary.workflow_review += 1,
            WorkflowBucket::Signed => summary.workflow_signed += 1,
        }
        *source_counts
            .entry(normalize(&segment.source_text))
            .or_default() += 1;
    }

    let repeated_sources: BTreeSet<String> = source_counts
        .into_iter()
        .filter_map(|(source, count)| (count > 1 && !source.is_empty()).then_some(source))
        .collect();
    for segment in segments {
        let source_units = text_counts(&segment.source_text).effort_units();
        let repeated = repeated_sources.contains(&normalize(&segment.source_text));
        if repeated {
            summary.repeated_segments += 1;
            summary.match_bands.repetitions += source_units;
            summary.weighted_effort_milli_units +=
                weighted_milli_units(source_units, weights.repetition_basis_points);
        } else {
            let (band, basis_points) = match_band(segment.tm_match_percent, weights);
            band.add(&mut summary.match_bands, source_units);
            summary.weighted_effort_milli_units += weighted_milli_units(source_units, basis_points);
        }
        if let Some(proposal) = &segment.ai_proposal {
            let proposal_chars: Vec<char> = proposal.chars().collect();
            let target_chars: Vec<char> = segment.target_text.chars().collect();
            let distance = levenshtein(&proposal_chars, &target_chars);
            let retained = proposal_chars
                .len()
                .saturating_sub(distance.min(proposal_chars.len()));
            summary.ai_contribution.applied_segments += 1;
            summary.ai_contribution.proposal_characters +=
                u64::try_from(proposal_chars.len()).unwrap_or(u64::MAX);
            summary.ai_contribution.retained_characters +=
                u64::try_from(retained).unwrap_or(u64::MAX);
            summary.ai_contribution.edit_distance += u64::try_from(distance).unwrap_or(u64::MAX);
            if distance == 0 {
                summary.ai_contribution.retained_segments += 1;
            } else {
                summary.ai_contribution.replaced_segments += 1;
            }
        }
    }
    Ok(summary)
}

fn validate_weights(weights: &AnalysisWeights) -> Result<(), LifecycleCoreError> {
    let values = [
        weights.no_match_basis_points,
        weights.match_50_74_basis_points,
        weights.match_75_84_basis_points,
        weights.match_85_94_basis_points,
        weights.match_95_99_basis_points,
        weights.exact_basis_points,
        weights.repetition_basis_points,
    ];
    if values.iter().any(|value| *value > 10_000) {
        return Err(LifecycleCoreError::InvalidInput(
            "analysis weights must be between 0 and 10000 basis points".to_string(),
        ));
    }
    Ok(())
}

enum MatchBand {
    NoMatch,
    Match50_74,
    Match75_84,
    Match85_94,
    Match95_99,
    Exact,
}

impl MatchBand {
    fn add(&self, counts: &mut MatchBandCounts, units: u64) {
        match self {
            Self::NoMatch => counts.no_match += units,
            Self::Match50_74 => counts.match_50_74 += units,
            Self::Match75_84 => counts.match_75_84 += units,
            Self::Match85_94 => counts.match_85_94 += units,
            Self::Match95_99 => counts.match_95_99 += units,
            Self::Exact => counts.exact += units,
        }
    }
}

fn match_band(percent: Option<u8>, weights: &AnalysisWeights) -> (MatchBand, u16) {
    match percent {
        Some(100..) => (MatchBand::Exact, weights.exact_basis_points),
        Some(95..=99) => (MatchBand::Match95_99, weights.match_95_99_basis_points),
        Some(85..=94) => (MatchBand::Match85_94, weights.match_85_94_basis_points),
        Some(75..=84) => (MatchBand::Match75_84, weights.match_75_84_basis_points),
        Some(50..=74) => (MatchBand::Match50_74, weights.match_50_74_basis_points),
        _ => (MatchBand::NoMatch, weights.no_match_basis_points),
    }
}

fn weighted_milli_units(units: u64, basis_points: u16) -> u64 {
    units
        .saturating_mul(u64::from(basis_points))
        .saturating_mul(1_000)
        / 10_000
}

#[derive(Debug, Clone, Copy, Default)]
struct TextCounts {
    words: u64,
    characters: u64,
    cjk_characters: u64,
}

impl TextCounts {
    fn effort_units(self) -> u64 {
        self.words + self.cjk_characters
    }
}

fn text_counts(value: &str) -> TextCounts {
    let mut result = TextCounts::default();
    let mut in_word = false;
    for character in value.chars() {
        if !character.is_whitespace() {
            result.characters += 1;
        }
        if is_cjk(character) {
            result.cjk_characters += 1;
            in_word = false;
        } else if character.is_alphanumeric() || character == '_' {
            if !in_word {
                result.words += 1;
                in_word = true;
            }
        } else {
            in_word = false;
        }
    }
    result
}

fn is_cjk(character: char) -> bool {
    matches!(
        character as u32,
        0x3400..=0x4DBF
            | 0x4E00..=0x9FFF
            | 0xF900..=0xFAFF
            | 0x20000..=0x2FA1F
            | 0x3040..=0x30FF
            | 0xAC00..=0xD7AF
    )
}

fn levenshtein(left: &[char], right: &[char]) -> usize {
    let mut previous: Vec<usize> = (0..=right.len()).collect();
    let mut current = vec![0; right.len() + 1];
    for (left_index, left_char) in left.iter().enumerate() {
        current[0] = left_index + 1;
        for (right_index, right_char) in right.iter().enumerate() {
            current[right_index + 1] = (previous[right_index + 1] + 1)
                .min(current[right_index] + 1)
                .min(previous[right_index] + usize::from(left_char != right_char));
        }
        std::mem::swap(&mut previous, &mut current);
    }
    previous[right.len()]
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveDependency {
    pub kind: String,
    pub id: String,
    pub name: String,
    pub required: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveEntry {
    pub path: String,
    pub size_bytes: u64,
    pub sha256: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProjectArchiveManifest {
    pub format_version: u16,
    pub schema_version: u32,
    pub created_at_ms: i64,
    pub project_id: String,
    pub project_name: String,
    pub source_locale: String,
    pub target_locale: String,
    pub entries: Vec<ArchiveEntry>,
    #[serde(default)]
    pub dependencies: Vec<ArchiveDependency>,
}

impl ProjectArchiveManifest {
    pub fn validate(&self) -> Result<(), LifecycleCoreError> {
        if self.format_version != PROJECT_ARCHIVE_FORMAT_VERSION {
            return Err(LifecycleCoreError::InvalidArchive(format!(
                "unsupported format version {}",
                self.format_version
            )));
        }
        if self.project_id.trim().is_empty()
            || self.project_name.trim().is_empty()
            || self.source_locale.trim().is_empty()
            || self.target_locale.trim().is_empty()
        {
            return Err(LifecycleCoreError::InvalidArchive(
                "project identity and locales are required".to_string(),
            ));
        }
        if self.entries.is_empty() || self.entries.len() > MAX_ARCHIVE_ENTRIES {
            return Err(LifecycleCoreError::InvalidArchive(
                "archive entry count is outside supported bounds".to_string(),
            ));
        }
        let mut paths = BTreeSet::new();
        let mut total = 0_u64;
        for entry in &self.entries {
            validate_archive_path(&entry.path)?;
            if !paths.insert(entry.path.as_str()) {
                return Err(LifecycleCoreError::InvalidArchive(
                    "archive contains duplicate entry paths".to_string(),
                ));
            }
            if entry.size_bytes > MAX_ARCHIVE_ENTRY_BYTES {
                return Err(LifecycleCoreError::InvalidArchive(
                    "archive entry exceeds the size limit".to_string(),
                ));
            }
            total = total.checked_add(entry.size_bytes).ok_or_else(|| {
                LifecycleCoreError::InvalidArchive("archive size overflow".to_string())
            })?;
            if total > MAX_ARCHIVE_TOTAL_BYTES {
                return Err(LifecycleCoreError::InvalidArchive(
                    "archive exceeds the total size limit".to_string(),
                ));
            }
            if entry.sha256.len() != 64
                || !entry.sha256.bytes().all(|byte| byte.is_ascii_hexdigit())
            {
                return Err(LifecycleCoreError::InvalidArchive(
                    "archive entry has an invalid SHA-256".to_string(),
                ));
            }
        }
        Ok(())
    }
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
}

fn validate_archive_path(path: &str) -> Result<(), LifecycleCoreError> {
    if path.is_empty()
        || path.starts_with('/')
        || path.starts_with('\\')
        || path.contains('\\')
        || path
            .split('/')
            .any(|part| part.is_empty() || part == "." || part == "..")
        || path.as_bytes().get(1) == Some(&b':')
    {
        return Err(LifecycleCoreError::InvalidArchive(
            "archive entry path is unsafe".to_string(),
        ));
    }
    Ok(())
}

fn normalize(value: &str) -> String {
    value
        .nfkc()
        .flat_map(char::to_lowercase)
        .fold(
            (String::new(), false),
            |(mut output, in_space), character| {
                if character.is_whitespace() {
                    if !in_space && !output.is_empty() {
                        output.push(' ');
                    }
                    (output, true)
                } else {
                    output.push(character);
                    (output, false)
                }
            },
        )
        .0
        .trim()
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn segment(id: &str, ordinal: u32, path: &str, source: &str) -> ReimportSegment {
        ReimportSegment {
            id: id.to_string(),
            ordinal,
            structural_path: path.to_string(),
            source_text: source.to_string(),
            context_before: String::new(),
            context_after: String::new(),
        }
    }

    #[test]
    fn reimport_preserves_only_unambiguous_unchanged_sources() {
        let mut duplicate_a = segment("old-2", 1, "p/2", "Repeat me");
        duplicate_a.context_before = "Alpha".to_string();
        let mut duplicate_b = segment("old-3", 2, "p/3", "Repeat me");
        duplicate_b.context_before = "Beta".to_string();
        let old = vec![
            segment("old-1", 0, "p/1", "Stable text"),
            duplicate_a,
            duplicate_b,
            segment("old-4", 3, "p/4", "Removed"),
        ];
        let mut moved = segment("new-2", 1, "p/20", "Repeat me");
        moved.context_before = "Beta".to_string();
        let new = vec![
            segment("new-1", 0, "p/1", "Stable text"),
            moved,
            segment("new-3", 2, "p/3", "Changed repeat"),
            segment("new-4", 3, "p/5", "Brand new"),
        ];
        let plan = plan_reimport(&old, &new).expect("valid plan");
        assert_eq!(plan.unchanged, 2);
        assert_eq!(plan.changed, 1);
        assert_eq!(plan.new_segments, 1);
        assert_eq!(plan.removed, 1);
        assert_eq!(plan.ambiguous, 0);
        let moved_match = plan
            .items
            .iter()
            .find(|item| item.new_segment_id.as_deref() == Some("new-2"))
            .expect("moved match");
        // Stable structural identity reserves old-3 for the changed p/3 row,
        // so the remaining unique normalized-source candidate is old-2.
        assert_eq!(moved_match.old_segment_id.as_deref(), Some("old-2"));
    }

    #[test]
    fn duplicate_source_without_unique_context_is_ambiguous() {
        let old = vec![
            segment("old-1", 0, "p/1", "Same"),
            segment("old-2", 1, "p/2", "Same"),
        ];
        let new = vec![segment("new-1", 0, "p/3", "Same")];
        let plan = plan_reimport(&old, &new).expect("valid plan");
        assert_eq!(plan.ambiguous, 1);
        assert_eq!(plan.removed, 2);
    }

    #[test]
    fn analysis_counts_unicode_repetitions_weights_and_ai_retention() {
        let segments = vec![
            AnalysisSegment {
                id: "a".to_string(),
                source_text: "Hello 世界".to_string(),
                target_text: "你好 world".to_string(),
                workflow: WorkflowBucket::Signed,
                tm_match_percent: Some(100),
                ai_proposal: Some("你好 world".to_string()),
            },
            AnalysisSegment {
                id: "b".to_string(),
                source_text: "Hello 世界".to_string(),
                target_text: "您好 world".to_string(),
                workflow: WorkflowBucket::Review,
                tm_match_percent: None,
                ai_proposal: Some("你好 world".to_string()),
            },
            AnalysisSegment {
                id: "c".to_string(),
                source_text: "One more sentence".to_string(),
                target_text: String::new(),
                workflow: WorkflowBucket::Translation,
                tm_match_percent: Some(85),
                ai_proposal: None,
            },
        ];
        let summary =
            analyze_segments(&segments, &AnalysisWeights::default()).expect("valid analysis");
        assert_eq!(summary.source_words, 5);
        assert_eq!(summary.source_cjk_characters, 4);
        assert_eq!(summary.repeated_segments, 2);
        assert_eq!(summary.match_bands.repetitions, 6);
        assert_eq!(summary.match_bands.match_85_94, 3);
        assert_eq!(summary.weighted_effort_milli_units, 1_800);
        assert_eq!(summary.ai_contribution.applied_segments, 2);
        assert_eq!(summary.ai_contribution.retained_segments, 1);
        assert!(summary.ai_contribution.edit_distance > 0);
    }

    #[test]
    fn archive_manifest_rejects_traversal_duplicates_and_invalid_hashes() {
        let bytes = b"project";
        let mut manifest = ProjectArchiveManifest {
            format_version: PROJECT_ARCHIVE_FORMAT_VERSION,
            schema_version: 10,
            created_at_ms: 1,
            project_id: "project".to_string(),
            project_name: "Project".to_string(),
            source_locale: "en-US".to_string(),
            target_locale: "zh-CN".to_string(),
            entries: vec![ArchiveEntry {
                path: "data/project.json".to_string(),
                size_bytes: u64::try_from(bytes.len()).expect("fixture size"),
                sha256: sha256_hex(bytes),
            }],
            dependencies: vec![],
        };
        manifest.validate().expect("valid manifest");
        manifest.entries[0].path = "../secret".to_string();
        assert!(matches!(
            manifest.validate(),
            Err(LifecycleCoreError::InvalidArchive(_))
        ));
        manifest.entries[0].path = "data/project.json".to_string();
        manifest.entries[0].sha256 = "nope".to_string();
        assert!(manifest.validate().is_err());
    }
}

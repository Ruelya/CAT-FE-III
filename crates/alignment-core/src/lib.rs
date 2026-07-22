//! Deterministic, bounded segment alignment and partition validation.

use std::collections::{BTreeMap, BTreeSet};
use std::fmt;

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use thiserror::Error;
use translunar_domain::{normalize_text, number_tokens};

pub const ALGORITHM_VERSION: &str = "translunar-banded-dp-v1";
pub const HARD_MAX_SEGMENTS_PER_SIDE: u32 = 100_000;
pub const HARD_MAX_TOTAL_INPUT_CHARS: u64 = 64 * 1024 * 1024;
pub const HARD_MAX_WORK_UNITS: u64 = 50_000_000;
pub const HARD_MAX_BAND_WIDTH: u32 = 1_024;
pub const HARD_MAX_TAGS_PER_SEGMENT: u32 = 256;
pub const HARD_MAX_EVIDENCE_VALUES: u32 = 64;
pub const HARD_MAX_PARTITION_LINKS: u32 = 200_000;
pub const HARD_MAX_PARTITION_GROUP_SIZE: u32 = 64;

const MAX_LEXICAL_ANCHORS_PER_SEGMENT: usize = 256;
const UNALIGNED_COST: u64 = 3_000;
const GROUP_PENALTY: u64 = 350;
const MAX_DISPLACEMENT_PENALTY: u16 = 1_500;
const BASIS_POINTS: u64 = 10_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum AlignmentSide {
    Source,
    Target,
}

impl fmt::Display for AlignmentSide {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::Source => "source",
            Self::Target => "target",
        })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum AlignmentResource {
    Segments,
    InputCharacters,
    WorkUnits,
    Tags,
    EvidenceValues,
    PartitionLinks,
    PartitionGroup,
}

impl fmt::Display for AlignmentResource {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::Segments => "segments",
            Self::InputCharacters => "input characters",
            Self::WorkUnits => "work units",
            Self::Tags => "tags",
            Self::EvidenceValues => "evidence values",
            Self::PartitionLinks => "partition links",
            Self::PartitionGroup => "partition group",
        })
    }
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum AlignmentError {
    #[error("invalid alignment option `{field}`: {message}")]
    InvalidOption {
        field: &'static str,
        message: &'static str,
    },
    #[error("{resource} limit exceeded: limit {limit}, actual {actual}")]
    ResourceLimitExceeded {
        resource: AlignmentResource,
        limit: u64,
        actual: u64,
    },
    #[error("{side} segment at index {index} has an empty ID")]
    EmptySegmentId { side: AlignmentSide, index: usize },
    #[error("duplicate {side} segment ID `{id}`")]
    DuplicateSegmentId { side: AlignmentSide, id: String },
    #[error(
        "{side} segment order is not strictly increasing at index {index}: {previous_ordinal} then {ordinal}"
    )]
    SegmentOrderViolation {
        side: AlignmentSide,
        index: usize,
        previous_ordinal: u32,
        ordinal: u32,
    },
    #[error("alignment did not produce a path through the configured band")]
    NoAlignmentPath,
    #[error("partition link {link_index} has neither source nor target members")]
    EmptyPartitionLink { link_index: usize },
    #[error("partition link {link_index} references unknown {side} segment `{id}`")]
    UnknownPartitionMember {
        link_index: usize,
        side: AlignmentSide,
        id: String,
    },
    #[error("partition link {link_index} reuses {side} segment `{id}`")]
    DuplicatePartitionMember {
        link_index: usize,
        side: AlignmentSide,
        id: String,
    },
    #[error("partition link {link_index} has a non-contiguous {side} group")]
    NonContiguousPartitionGroup {
        link_index: usize,
        side: AlignmentSide,
    },
    #[error("partition link {link_index} crosses or reverses {side} order")]
    PartitionOrderViolation {
        link_index: usize,
        side: AlignmentSide,
    },
    #[error("partition does not own {side} segment `{id}`")]
    MissingPartitionMember { side: AlignmentSide, id: String },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AlignmentOptions {
    pub max_segments_per_side: u32,
    pub max_total_input_chars: u64,
    pub max_work_units: u64,
    pub band_width: u32,
    pub max_group_size: u32,
    pub max_tags_per_segment: u32,
    pub max_evidence_values: u32,
}

impl Default for AlignmentOptions {
    fn default() -> Self {
        Self {
            max_segments_per_side: HARD_MAX_SEGMENTS_PER_SIDE,
            max_total_input_chars: 32 * 1024 * 1024,
            max_work_units: 20_000_000,
            band_width: 12,
            max_group_size: 2,
            max_tags_per_segment: HARD_MAX_TAGS_PER_SEGMENT,
            max_evidence_values: 16,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AlignmentSegment {
    pub id: String,
    pub ordinal: u32,
    pub text: String,
    #[serde(default)]
    pub tag_signature: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum AlignmentOrigin {
    Deterministic,
    Manual,
    Ai,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum AlignmentLinkStatus {
    Proposed,
    Confirmed,
    Rejected,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum AlignmentTransition {
    OneToOne,
    OneToMany,
    ManyToOne,
    SourceUnaligned,
    TargetUnaligned,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "kind", rename_all = "camelCase")]
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
        side: AlignmentSide,
        penalty_basis_points: u16,
        summary: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AlignmentCandidate {
    pub transition: AlignmentTransition,
    pub source_segment_ids: Vec<String>,
    pub target_segment_ids: Vec<String>,
    pub source_text: String,
    pub target_text: String,
    pub confidence_basis_points: u16,
    pub evidence: Vec<AlignmentEvidence>,
    pub origin: AlignmentOrigin,
    pub status: AlignmentLinkStatus,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AlignmentPlan {
    pub algorithm_version: String,
    pub source_segment_count: u32,
    pub target_segment_count: u32,
    pub work_units: u64,
    pub candidates: Vec<AlignmentCandidate>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AlignmentPartitionSegment {
    pub id: String,
    pub ordinal: u32,
}

impl From<&AlignmentSegment> for AlignmentPartitionSegment {
    fn from(segment: &AlignmentSegment) -> Self {
        Self {
            id: segment.id.clone(),
            ordinal: segment.ordinal,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AlignmentPartitionLink {
    pub source_segment_ids: Vec<String>,
    pub target_segment_ids: Vec<String>,
}

impl From<&AlignmentCandidate> for AlignmentPartitionLink {
    fn from(candidate: &AlignmentCandidate) -> Self {
        Self {
            source_segment_ids: candidate.source_segment_ids.clone(),
            target_segment_ids: candidate.target_segment_ids.clone(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PartitionLimits {
    pub max_links: u32,
    pub max_group_size: u32,
}

impl Default for PartitionLimits {
    fn default() -> Self {
        Self {
            max_links: HARD_MAX_PARTITION_LINKS,
            max_group_size: HARD_MAX_PARTITION_GROUP_SIZE,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PartitionValidation {
    pub link_count: u32,
    pub source_segment_count: u32,
    pub target_segment_count: u32,
}

/// Aligns two ordered segment streams with deterministic, bounded dynamic programming.
pub fn align(
    source: &[AlignmentSegment],
    target: &[AlignmentSegment],
    options: &AlignmentOptions,
) -> Result<AlignmentPlan, AlignmentError> {
    validate_options(options)?;
    validate_alignment_side(source, AlignmentSide::Source, options)?;
    validate_alignment_side(target, AlignmentSide::Target, options)?;
    validate_total_input_chars(source, target, options.max_total_input_chars)?;

    let source_prepared = PreparedSide::new(source);
    let target_prepared = PreparedSide::new(target);
    let source_len = source.len();
    let target_len = target.len();
    let effective_band = usize::try_from(options.band_width)
        .unwrap_or(usize::MAX)
        .saturating_add(source_len.abs_diff(target_len));
    let mut rows = build_rows(
        source_len,
        target_len,
        effective_band,
        options.max_work_units,
    )?;
    rows[0].set(
        0,
        Cell {
            cost: 0,
            predecessor: None,
            tie_key: TieKey::root(),
        },
    );

    let transitions = transition_specs(options.max_group_size);
    let mut work_units = 0_u64;
    for source_index in 0..=source_len {
        let row_start = rows[source_index].start;
        let row_end = rows[source_index].end();
        for target_index in row_start..=row_end {
            consume_work(&mut work_units, options.max_work_units)?;
            let Some(cell) = rows[source_index].get(target_index).cloned() else {
                continue;
            };

            for spec in &transitions {
                let next_source = source_index.saturating_add(spec.source_count);
                let next_target = target_index.saturating_add(spec.target_count);
                if next_source > source_len
                    || next_target > target_len
                    || !rows[next_source].contains(next_target)
                {
                    continue;
                }
                consume_work(&mut work_units, options.max_work_units)?;

                let transition_cost = if spec.source_count == 0 || spec.target_count == 0 {
                    UNALIGNED_COST
                } else {
                    let source_group = source_prepared.group(source_index, spec.source_count);
                    let target_group = target_prepared.group(target_index, spec.target_count);
                    let score = score_groups(
                        source_group,
                        target_group,
                        source_index,
                        spec.source_count,
                        source_len,
                        target_index,
                        spec.target_count,
                        target_len,
                    );
                    BASIS_POINTS
                        .saturating_sub(u64::from(score.confidence_basis_points))
                        .saturating_add(
                            u64::try_from(
                                spec.source_count
                                    .saturating_add(spec.target_count)
                                    .saturating_sub(2),
                            )
                            .unwrap_or(u64::MAX)
                            .saturating_mul(GROUP_PENALTY),
                        )
                };
                let candidate = Cell {
                    cost: cell.cost.saturating_add(transition_cost),
                    predecessor: Some(Predecessor {
                        source_index,
                        target_index,
                        transition: spec.transition,
                    }),
                    tie_key: tie_key(*spec, source, target, source_index, target_index),
                };
                rows[next_source].update(next_target, candidate);
            }
        }
    }

    let steps = backtrack(&rows, source_len, target_len)?;
    let mut candidates = Vec::with_capacity(steps.len());
    for step in steps {
        candidates.push(build_candidate(
            step,
            source,
            target,
            &source_prepared,
            &target_prepared,
            options,
        ));
    }

    let partition_source = source
        .iter()
        .map(AlignmentPartitionSegment::from)
        .collect::<Vec<_>>();
    let partition_target = target
        .iter()
        .map(AlignmentPartitionSegment::from)
        .collect::<Vec<_>>();
    let partition_links = candidates
        .iter()
        .map(AlignmentPartitionLink::from)
        .collect::<Vec<_>>();
    validate_partition(
        &partition_source,
        &partition_target,
        &partition_links,
        &PartitionLimits {
            max_links: HARD_MAX_PARTITION_LINKS,
            max_group_size: options.max_group_size,
        },
    )?;

    Ok(AlignmentPlan {
        algorithm_version: ALGORITHM_VERSION.to_owned(),
        source_segment_count: u32::try_from(source.len()).unwrap_or(u32::MAX),
        target_segment_count: u32::try_from(target.len()).unwrap_or(u32::MAX),
        work_units,
        candidates,
    })
}

/// Validates a complete ordered partition used by manual edits and AI suggestions.
pub fn validate_partition(
    source: &[AlignmentPartitionSegment],
    target: &[AlignmentPartitionSegment],
    links: &[AlignmentPartitionLink],
    limits: &PartitionLimits,
) -> Result<PartitionValidation, AlignmentError> {
    validate_partition_limits(limits)?;
    enforce_limit(
        AlignmentResource::Segments,
        u64::from(HARD_MAX_SEGMENTS_PER_SIDE),
        usize_to_u64(source.len()),
    )?;
    enforce_limit(
        AlignmentResource::Segments,
        u64::from(HARD_MAX_SEGMENTS_PER_SIDE),
        usize_to_u64(target.len()),
    )?;
    enforce_limit(
        AlignmentResource::PartitionLinks,
        u64::from(limits.max_links),
        usize_to_u64(links.len()),
    )?;
    validate_partition_side(source, AlignmentSide::Source)?;
    validate_partition_side(target, AlignmentSide::Target)?;

    let source_positions = source
        .iter()
        .enumerate()
        .map(|(index, segment)| (segment.id.as_str(), index))
        .collect::<BTreeMap<_, _>>();
    let target_positions = target
        .iter()
        .enumerate()
        .map(|(index, segment)| (segment.id.as_str(), index))
        .collect::<BTreeMap<_, _>>();
    let mut source_owned = vec![false; source.len()];
    let mut target_owned = vec![false; target.len()];
    let mut previous_source_end = None;
    let mut previous_target_end = None;

    for (link_index, link) in links.iter().enumerate() {
        if link.source_segment_ids.is_empty() && link.target_segment_ids.is_empty() {
            return Err(AlignmentError::EmptyPartitionLink { link_index });
        }
        enforce_limit(
            AlignmentResource::PartitionGroup,
            u64::from(limits.max_group_size),
            usize_to_u64(link.source_segment_ids.len()),
        )?;
        enforce_limit(
            AlignmentResource::PartitionGroup,
            u64::from(limits.max_group_size),
            usize_to_u64(link.target_segment_ids.len()),
        )?;

        let source_range = resolve_partition_group(
            link_index,
            AlignmentSide::Source,
            &link.source_segment_ids,
            &source_positions,
            &mut source_owned,
        )?;
        let target_range = resolve_partition_group(
            link_index,
            AlignmentSide::Target,
            &link.target_segment_ids,
            &target_positions,
            &mut target_owned,
        )?;
        previous_source_end = validate_partition_order(
            link_index,
            AlignmentSide::Source,
            source_range,
            previous_source_end,
        )?;
        previous_target_end = validate_partition_order(
            link_index,
            AlignmentSide::Target,
            target_range,
            previous_target_end,
        )?;
    }

    require_complete_partition(source, &source_owned, AlignmentSide::Source)?;
    require_complete_partition(target, &target_owned, AlignmentSide::Target)?;

    Ok(PartitionValidation {
        link_count: u32::try_from(links.len()).unwrap_or(u32::MAX),
        source_segment_count: u32::try_from(source.len()).unwrap_or(u32::MAX),
        target_segment_count: u32::try_from(target.len()).unwrap_or(u32::MAX),
    })
}

fn validate_options(options: &AlignmentOptions) -> Result<(), AlignmentError> {
    validate_bounded_nonzero_option(
        "maxSegmentsPerSide",
        u64::from(options.max_segments_per_side),
        u64::from(HARD_MAX_SEGMENTS_PER_SIDE),
    )?;
    validate_bounded_nonzero_option(
        "maxTotalInputChars",
        options.max_total_input_chars,
        HARD_MAX_TOTAL_INPUT_CHARS,
    )?;
    validate_bounded_nonzero_option("maxWorkUnits", options.max_work_units, HARD_MAX_WORK_UNITS)?;
    if options.band_width > HARD_MAX_BAND_WIDTH {
        return Err(AlignmentError::InvalidOption {
            field: "bandWidth",
            message: "exceeds the hard maximum",
        });
    }
    if !(1..=2).contains(&options.max_group_size) {
        return Err(AlignmentError::InvalidOption {
            field: "maxGroupSize",
            message: "must be 1 or 2 for the deterministic aligner",
        });
    }
    validate_bounded_nonzero_option(
        "maxTagsPerSegment",
        u64::from(options.max_tags_per_segment),
        u64::from(HARD_MAX_TAGS_PER_SEGMENT),
    )?;
    validate_bounded_nonzero_option(
        "maxEvidenceValues",
        u64::from(options.max_evidence_values),
        u64::from(HARD_MAX_EVIDENCE_VALUES),
    )
}

fn validate_partition_limits(limits: &PartitionLimits) -> Result<(), AlignmentError> {
    validate_bounded_nonzero_option(
        "maxLinks",
        u64::from(limits.max_links),
        u64::from(HARD_MAX_PARTITION_LINKS),
    )?;
    validate_bounded_nonzero_option(
        "maxGroupSize",
        u64::from(limits.max_group_size),
        u64::from(HARD_MAX_PARTITION_GROUP_SIZE),
    )
}

fn validate_bounded_nonzero_option(
    field: &'static str,
    value: u64,
    hard_maximum: u64,
) -> Result<(), AlignmentError> {
    if value == 0 {
        return Err(AlignmentError::InvalidOption {
            field,
            message: "must be greater than zero",
        });
    }
    if value > hard_maximum {
        return Err(AlignmentError::InvalidOption {
            field,
            message: "exceeds the hard maximum",
        });
    }
    Ok(())
}

fn validate_alignment_side(
    segments: &[AlignmentSegment],
    side: AlignmentSide,
    options: &AlignmentOptions,
) -> Result<(), AlignmentError> {
    enforce_limit(
        AlignmentResource::Segments,
        u64::from(options.max_segments_per_side),
        usize_to_u64(segments.len()),
    )?;
    validate_ids_and_ordinals(
        segments
            .iter()
            .map(|segment| (&segment.id, segment.ordinal)),
        side,
    )?;
    for segment in segments {
        enforce_limit(
            AlignmentResource::Tags,
            u64::from(options.max_tags_per_segment),
            usize_to_u64(segment.tag_signature.len()),
        )?;
    }
    Ok(())
}

fn validate_partition_side(
    segments: &[AlignmentPartitionSegment],
    side: AlignmentSide,
) -> Result<(), AlignmentError> {
    validate_ids_and_ordinals(
        segments
            .iter()
            .map(|segment| (&segment.id, segment.ordinal)),
        side,
    )
}

fn validate_ids_and_ordinals<'a>(
    segments: impl Iterator<Item = (&'a String, u32)>,
    side: AlignmentSide,
) -> Result<(), AlignmentError> {
    let mut ids = BTreeSet::new();
    let mut previous = None;
    for (index, (id, ordinal)) in segments.enumerate() {
        if id.trim().is_empty() {
            return Err(AlignmentError::EmptySegmentId { side, index });
        }
        if !ids.insert(id.as_str()) {
            return Err(AlignmentError::DuplicateSegmentId {
                side,
                id: id.clone(),
            });
        }
        if let Some(previous_ordinal) = previous
            && ordinal <= previous_ordinal
        {
            return Err(AlignmentError::SegmentOrderViolation {
                side,
                index,
                previous_ordinal,
                ordinal,
            });
        }
        previous = Some(ordinal);
    }
    Ok(())
}

fn validate_total_input_chars(
    source: &[AlignmentSegment],
    target: &[AlignmentSegment],
    limit: u64,
) -> Result<(), AlignmentError> {
    let mut total = 0_u64;
    for segment in source.iter().chain(target) {
        total = total.saturating_add(usize_to_u64(segment.text.chars().count()));
        for tag in &segment.tag_signature {
            total = total.saturating_add(usize_to_u64(tag.chars().count()));
        }
        if total > limit {
            return Err(AlignmentError::ResourceLimitExceeded {
                resource: AlignmentResource::InputCharacters,
                limit,
                actual: total,
            });
        }
    }
    Ok(())
}

fn enforce_limit(
    resource: AlignmentResource,
    limit: u64,
    actual: u64,
) -> Result<(), AlignmentError> {
    if actual > limit {
        Err(AlignmentError::ResourceLimitExceeded {
            resource,
            limit,
            actual,
        })
    } else {
        Ok(())
    }
}

fn consume_work(work_units: &mut u64, limit: u64) -> Result<(), AlignmentError> {
    *work_units = work_units.saturating_add(1);
    enforce_limit(AlignmentResource::WorkUnits, limit, *work_units)
}

fn usize_to_u64(value: usize) -> u64 {
    u64::try_from(value).unwrap_or(u64::MAX)
}

#[derive(Debug, Clone)]
struct PreparedSide {
    singles: Vec<GroupMetrics>,
    pairs: Vec<GroupMetrics>,
}

impl PreparedSide {
    fn new(segments: &[AlignmentSegment]) -> Self {
        let singles = segments
            .iter()
            .map(GroupMetrics::from_segment)
            .collect::<Vec<_>>();
        let pairs = singles
            .windows(2)
            .map(|window| GroupMetrics::combine(&window[0], &window[1]))
            .collect();
        Self { singles, pairs }
    }

    fn group(&self, start: usize, count: usize) -> &GroupMetrics {
        match count {
            1 => &self.singles[start],
            2 => &self.pairs[start],
            _ => unreachable!("validated transition group size"),
        }
    }
}

#[derive(Debug, Clone)]
struct GroupMetrics {
    char_count: u32,
    numbers: Vec<String>,
    punctuation: PunctuationMetrics,
    tags: Vec<String>,
    anchors: BTreeSet<String>,
}

impl GroupMetrics {
    fn from_segment(segment: &AlignmentSegment) -> Self {
        let normalized = normalize_text(&segment.text);
        let mut tags = segment
            .tag_signature
            .iter()
            .map(|tag| normalize_text(tag).to_lowercase())
            .collect::<Vec<_>>();
        tags.sort();
        Self {
            char_count: u32::try_from(normalized.chars().count()).unwrap_or(u32::MAX),
            numbers: number_tokens(&segment.text),
            punctuation: PunctuationMetrics::from_text(&normalized),
            tags,
            anchors: lexical_anchors(&normalized),
        }
    }

    fn combine(left: &Self, right: &Self) -> Self {
        let mut numbers = left.numbers.clone();
        numbers.extend(right.numbers.iter().cloned());
        numbers.sort();
        let mut tags = left.tags.clone();
        tags.extend(right.tags.iter().cloned());
        tags.sort();
        let mut anchors = left.anchors.clone();
        anchors.extend(right.anchors.iter().cloned());
        Self {
            char_count: left
                .char_count
                .saturating_add(right.char_count)
                .saturating_add(u32::from(left.char_count > 0 && right.char_count > 0)),
            numbers,
            punctuation: PunctuationMetrics::combine(left.punctuation, right.punctuation),
            tags,
            anchors,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PunctuationKind {
    Period,
    Question,
    Exclamation,
    Semicolon,
    Colon,
    Ellipsis,
}

impl PunctuationKind {
    const ALL: [Self; 6] = [
        Self::Period,
        Self::Question,
        Self::Exclamation,
        Self::Semicolon,
        Self::Colon,
        Self::Ellipsis,
    ];

    fn index(self) -> usize {
        match self {
            Self::Period => 0,
            Self::Question => 1,
            Self::Exclamation => 2,
            Self::Semicolon => 3,
            Self::Colon => 4,
            Self::Ellipsis => 5,
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::Period => "period",
            Self::Question => "question",
            Self::Exclamation => "exclamation",
            Self::Semicolon => "semicolon",
            Self::Colon => "colon",
            Self::Ellipsis => "ellipsis",
        }
    }
}

#[derive(Debug, Clone, Copy)]
struct PunctuationMetrics {
    counts: [u32; 6],
    terminal: Option<PunctuationKind>,
}

impl PunctuationMetrics {
    fn from_text(text: &str) -> Self {
        let mut counts = [0_u32; 6];
        let mut terminal = None;
        for character in text.chars() {
            if let Some(kind) = punctuation_kind(character) {
                counts[kind.index()] = counts[kind.index()].saturating_add(1);
                terminal = Some(kind);
            } else if !character.is_whitespace() {
                terminal = None;
            }
        }
        Self { counts, terminal }
    }

    fn combine(left: Self, right: Self) -> Self {
        let mut counts = [0_u32; 6];
        for (index, count) in counts.iter_mut().enumerate() {
            *count = left.counts[index].saturating_add(right.counts[index]);
        }
        Self {
            counts,
            terminal: right.terminal.or(left.terminal),
        }
    }

    fn signature(self) -> Vec<String> {
        let mut signature = Vec::new();
        for kind in PunctuationKind::ALL {
            let count = self.counts[kind.index()];
            if count > 0 {
                signature.push(format!("{}:{count}", kind.label()));
            }
        }
        if let Some(terminal) = self.terminal {
            signature.push(format!("terminal:{}", terminal.label()));
        }
        signature
    }
}

fn punctuation_kind(character: char) -> Option<PunctuationKind> {
    match character {
        '.' | '。' => Some(PunctuationKind::Period),
        '?' | '？' => Some(PunctuationKind::Question),
        '!' | '！' => Some(PunctuationKind::Exclamation),
        ';' | '；' => Some(PunctuationKind::Semicolon),
        ':' | '：' => Some(PunctuationKind::Colon),
        '…' => Some(PunctuationKind::Ellipsis),
        _ => None,
    }
}

fn lexical_anchors(text: &str) -> BTreeSet<String> {
    text.to_lowercase()
        .split(|character: char| {
            !character.is_alphanumeric() && character != '_' && character != '-'
        })
        .filter(|token| {
            let length = token.chars().count();
            (2..=64).contains(&length) && !token.chars().all(|character| character.is_numeric())
        })
        .take(MAX_LEXICAL_ANCHORS_PER_SEGMENT)
        .map(str::to_owned)
        .collect()
}

#[derive(Debug, Clone, Copy)]
struct ScoreComponents {
    length: u16,
    numbers: u16,
    punctuation: u16,
    tags: u16,
    lexical: u16,
    displacement_penalty: u16,
    source_position: u16,
    target_position: u16,
    confidence_basis_points: u16,
}

#[allow(clippy::too_many_arguments)]
fn score_groups(
    source: &GroupMetrics,
    target: &GroupMetrics,
    source_start: usize,
    source_count: usize,
    source_total: usize,
    target_start: usize,
    target_count: usize,
    target_total: usize,
) -> ScoreComponents {
    let length = ratio_score(
        u64::from(source.char_count),
        u64::from(target.char_count),
        10_000,
    );
    let numbers = sorted_collection_score(&source.numbers, &target.numbers, 6_500);
    let punctuation = punctuation_score(source.punctuation, target.punctuation);
    let tags = sorted_collection_score(&source.tags, &target.tags, 6_500);
    let lexical = set_score(&source.anchors, &target.anchors, 6_500);
    let source_position = normalized_midpoint(source_start, source_count, source_total);
    let target_position = normalized_midpoint(target_start, target_count, target_total);
    let displacement = source_position.abs_diff(target_position);
    let displacement_penalty =
        u16::try_from(u64::from(displacement) * u64::from(MAX_DISPLACEMENT_PENALTY) / BASIS_POINTS)
            .unwrap_or(MAX_DISPLACEMENT_PENALTY);
    let weighted = (u64::from(length) * 4_000
        + u64::from(numbers) * 2_200
        + u64::from(punctuation) * 1_000
        + u64::from(tags) * 1_800
        + u64::from(lexical) * 1_000)
        / BASIS_POINTS;
    let confidence_basis_points =
        u16::try_from(weighted.saturating_sub(u64::from(displacement_penalty)))
            .unwrap_or(10_000)
            .min(10_000);
    ScoreComponents {
        length,
        numbers,
        punctuation,
        tags,
        lexical,
        displacement_penalty,
        source_position,
        target_position,
        confidence_basis_points,
    }
}

fn ratio_score(left: u64, right: u64, both_empty_score: u16) -> u16 {
    if left == 0 && right == 0 {
        return both_empty_score;
    }
    if left == 0 || right == 0 {
        return 0;
    }
    u16::try_from(left.min(right).saturating_mul(BASIS_POINTS) / left.max(right)).unwrap_or(10_000)
}

fn sorted_collection_score(left: &[String], right: &[String], both_empty_score: u16) -> u16 {
    if left.is_empty() && right.is_empty() {
        return both_empty_score;
    }
    if left == right {
        return 10_000;
    }
    let mut left_index = 0;
    let mut right_index = 0;
    let mut shared = 0_u64;
    while left_index < left.len() && right_index < right.len() {
        match left[left_index].cmp(&right[right_index]) {
            std::cmp::Ordering::Less => left_index += 1,
            std::cmp::Ordering::Greater => right_index += 1,
            std::cmp::Ordering::Equal => {
                shared = shared.saturating_add(1);
                left_index += 1;
                right_index += 1;
            }
        }
    }
    let total = usize_to_u64(left.len().saturating_add(right.len()));
    u16::try_from(shared.saturating_mul(2 * BASIS_POINTS) / total).unwrap_or(10_000)
}

fn set_score(left: &BTreeSet<String>, right: &BTreeSet<String>, both_empty_score: u16) -> u16 {
    if left.is_empty() && right.is_empty() {
        return both_empty_score;
    }
    if left == right {
        return 10_000;
    }
    let shared = usize_to_u64(left.intersection(right).count());
    let union = usize_to_u64(left.union(right).count());
    if shared == 0 {
        3_500
    } else {
        u16::try_from(4_000 + shared.saturating_mul(6_000) / union).unwrap_or(10_000)
    }
}

fn punctuation_score(left: PunctuationMetrics, right: PunctuationMetrics) -> u16 {
    let left_total = left
        .counts
        .iter()
        .map(|count| u64::from(*count))
        .sum::<u64>();
    let right_total = right
        .counts
        .iter()
        .map(|count| u64::from(*count))
        .sum::<u64>();
    if left_total == 0 && right_total == 0 {
        return 6_500;
    }
    let shared = left
        .counts
        .iter()
        .zip(right.counts)
        .map(|(left_count, right_count)| u64::from((*left_count).min(right_count)))
        .sum::<u64>();
    let shape_score = shared.saturating_mul(2 * 7_000) / (left_total + right_total);
    let terminal_score = match (left.terminal, right.terminal) {
        (Some(left), Some(right)) if left == right => 3_000,
        (None, None) => 1_500,
        _ => 0,
    };
    u16::try_from(shape_score.saturating_add(terminal_score).min(BASIS_POINTS)).unwrap_or(10_000)
}

fn normalized_midpoint(start: usize, count: usize, total: usize) -> u16 {
    if total == 0 {
        return 0;
    }
    let numerator = usize_to_u64(start)
        .saturating_mul(2)
        .saturating_add(usize_to_u64(count));
    let denominator = usize_to_u64(total).saturating_mul(2);
    u16::try_from(numerator.saturating_mul(BASIS_POINTS) / denominator)
        .unwrap_or(10_000)
        .min(10_000)
}

#[derive(Debug, Clone, Copy)]
struct TransitionSpec {
    transition: AlignmentTransition,
    source_count: usize,
    target_count: usize,
    priority: u8,
}

fn transition_specs(max_group_size: u32) -> Vec<TransitionSpec> {
    let mut transitions = vec![TransitionSpec {
        transition: AlignmentTransition::OneToOne,
        source_count: 1,
        target_count: 1,
        priority: 0,
    }];
    if max_group_size >= 2 {
        transitions.extend([
            TransitionSpec {
                transition: AlignmentTransition::OneToMany,
                source_count: 1,
                target_count: 2,
                priority: 1,
            },
            TransitionSpec {
                transition: AlignmentTransition::ManyToOne,
                source_count: 2,
                target_count: 1,
                priority: 2,
            },
        ]);
    }
    transitions.extend([
        TransitionSpec {
            transition: AlignmentTransition::SourceUnaligned,
            source_count: 1,
            target_count: 0,
            priority: 3,
        },
        TransitionSpec {
            transition: AlignmentTransition::TargetUnaligned,
            source_count: 0,
            target_count: 1,
            priority: 4,
        },
    ]);
    transitions
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
struct TieKey {
    priority: u8,
    source_ordinal: u32,
    target_ordinal: u32,
    source_index: usize,
    target_index: usize,
}

impl TieKey {
    fn root() -> Self {
        Self {
            priority: 0,
            source_ordinal: 0,
            target_ordinal: 0,
            source_index: 0,
            target_index: 0,
        }
    }
}

fn tie_key(
    spec: TransitionSpec,
    source: &[AlignmentSegment],
    target: &[AlignmentSegment],
    source_index: usize,
    target_index: usize,
) -> TieKey {
    TieKey {
        priority: spec.priority,
        source_ordinal: source
            .get(source_index)
            .map(|segment| segment.ordinal)
            .unwrap_or(u32::MAX),
        target_ordinal: target
            .get(target_index)
            .map(|segment| segment.ordinal)
            .unwrap_or(u32::MAX),
        source_index,
        target_index,
    }
}

#[derive(Debug, Clone)]
struct Cell {
    cost: u64,
    predecessor: Option<Predecessor>,
    tie_key: TieKey,
}

#[derive(Debug, Clone, Copy)]
struct Predecessor {
    source_index: usize,
    target_index: usize,
    transition: AlignmentTransition,
}

#[derive(Debug)]
struct Row {
    start: usize,
    cells: Vec<Option<Cell>>,
}

impl Row {
    fn end(&self) -> usize {
        self.start + self.cells.len() - 1
    }

    fn contains(&self, index: usize) -> bool {
        (self.start..=self.end()).contains(&index)
    }

    fn get(&self, index: usize) -> Option<&Cell> {
        self.cells.get(index.checked_sub(self.start)?)?.as_ref()
    }

    fn set(&mut self, index: usize, cell: Cell) {
        let offset = index - self.start;
        self.cells[offset] = Some(cell);
    }

    fn update(&mut self, index: usize, candidate: Cell) {
        let offset = index - self.start;
        let should_replace = self.cells[offset].as_ref().is_none_or(|current| {
            candidate.cost < current.cost
                || (candidate.cost == current.cost && candidate.tie_key < current.tie_key)
        });
        if should_replace {
            self.cells[offset] = Some(candidate);
        }
    }
}

fn build_rows(
    source_len: usize,
    target_len: usize,
    effective_band: usize,
    max_work_units: u64,
) -> Result<Vec<Row>, AlignmentError> {
    let mut rows = Vec::with_capacity(source_len.saturating_add(1));
    let mut state_count = 0_u64;
    for source_index in 0..=source_len {
        let start = source_index.saturating_sub(effective_band).min(target_len);
        let end = source_index.saturating_add(effective_band).min(target_len);
        let length = end.saturating_sub(start).saturating_add(1);
        state_count = state_count.saturating_add(usize_to_u64(length));
        enforce_limit(AlignmentResource::WorkUnits, max_work_units, state_count)?;
        rows.push(Row {
            start,
            cells: vec![None; length],
        });
    }
    Ok(rows)
}

fn backtrack(
    rows: &[Row],
    mut source_index: usize,
    mut target_index: usize,
) -> Result<Vec<AlignmentStep>, AlignmentError> {
    let mut steps = Vec::new();
    while source_index > 0 || target_index > 0 {
        let predecessor = rows[source_index]
            .get(target_index)
            .and_then(|cell| cell.predecessor)
            .ok_or(AlignmentError::NoAlignmentPath)?;
        steps.push(AlignmentStep {
            source_index: predecessor.source_index,
            target_index: predecessor.target_index,
            transition: predecessor.transition,
        });
        source_index = predecessor.source_index;
        target_index = predecessor.target_index;
    }
    steps.reverse();
    Ok(steps)
}

#[derive(Debug, Clone, Copy)]
struct AlignmentStep {
    source_index: usize,
    target_index: usize,
    transition: AlignmentTransition,
}

impl AlignmentStep {
    fn dimensions(self) -> (usize, usize) {
        match self.transition {
            AlignmentTransition::OneToOne => (1, 1),
            AlignmentTransition::OneToMany => (1, 2),
            AlignmentTransition::ManyToOne => (2, 1),
            AlignmentTransition::SourceUnaligned => (1, 0),
            AlignmentTransition::TargetUnaligned => (0, 1),
        }
    }
}

fn build_candidate(
    step: AlignmentStep,
    source: &[AlignmentSegment],
    target: &[AlignmentSegment],
    source_prepared: &PreparedSide,
    target_prepared: &PreparedSide,
    options: &AlignmentOptions,
) -> AlignmentCandidate {
    let (source_count, target_count) = step.dimensions();
    let source_group = &source[step.source_index..step.source_index + source_count];
    let target_group = &target[step.target_index..step.target_index + target_count];
    let (confidence_basis_points, evidence) = if source_count == 0 || target_count == 0 {
        let side = if source_count > 0 {
            AlignmentSide::Source
        } else {
            AlignmentSide::Target
        };
        (
            0,
            vec![AlignmentEvidence::Unaligned {
                side,
                penalty_basis_points: u16::try_from(UNALIGNED_COST).unwrap_or(u16::MAX),
                summary: format!("{side} group remains unaligned"),
            }],
        )
    } else {
        let source_metrics = source_prepared.group(step.source_index, source_count);
        let target_metrics = target_prepared.group(step.target_index, target_count);
        let score = score_groups(
            source_metrics,
            target_metrics,
            step.source_index,
            source_count,
            source.len(),
            step.target_index,
            target_count,
            target.len(),
        );
        (
            score.confidence_basis_points,
            build_evidence(
                score,
                source_metrics,
                target_metrics,
                usize::try_from(options.max_evidence_values).unwrap_or(usize::MAX),
            ),
        )
    };

    AlignmentCandidate {
        transition: step.transition,
        source_segment_ids: source_group
            .iter()
            .map(|segment| segment.id.clone())
            .collect(),
        target_segment_ids: target_group
            .iter()
            .map(|segment| segment.id.clone())
            .collect(),
        source_text: snapshot_text(source_group),
        target_text: snapshot_text(target_group),
        confidence_basis_points,
        evidence,
        origin: AlignmentOrigin::Deterministic,
        status: AlignmentLinkStatus::Proposed,
    }
}

fn snapshot_text(segments: &[AlignmentSegment]) -> String {
    segments
        .iter()
        .map(|segment| segment.text.as_str())
        .collect::<Vec<_>>()
        .join("\n")
}

fn build_evidence(
    score: ScoreComponents,
    source: &GroupMetrics,
    target: &GroupMetrics,
    max_values: usize,
) -> Vec<AlignmentEvidence> {
    let shared_anchors = source
        .anchors
        .intersection(&target.anchors)
        .cloned()
        .collect::<Vec<_>>();
    let shared_anchor_count = u32::try_from(shared_anchors.len()).unwrap_or(u32::MAX);
    vec![
        AlignmentEvidence::Length {
            score_basis_points: score.length,
            source_chars: source.char_count,
            target_chars: target.char_count,
            summary: format!(
                "Length similarity is {}% ({} vs {} characters)",
                score.length / 100,
                source.char_count,
                target.char_count
            ),
        },
        AlignmentEvidence::Numbers {
            score_basis_points: score.numbers,
            source_values: take_values(&source.numbers, max_values),
            target_values: take_values(&target.numbers, max_values),
            source_value_count: u32::try_from(source.numbers.len()).unwrap_or(u32::MAX),
            target_value_count: u32::try_from(target.numbers.len()).unwrap_or(u32::MAX),
            summary: if source.numbers == target.numbers && !source.numbers.is_empty() {
                "Number tokens match".to_owned()
            } else if source.numbers.is_empty() && target.numbers.is_empty() {
                "No number anchors are present".to_owned()
            } else {
                "Number tokens differ".to_owned()
            },
        },
        AlignmentEvidence::Punctuation {
            score_basis_points: score.punctuation,
            source_signature: source.punctuation.signature(),
            target_signature: target.punctuation.signature(),
            summary: if source.punctuation.counts == target.punctuation.counts
                && source.punctuation.terminal == target.punctuation.terminal
            {
                "Punctuation boundaries match".to_owned()
            } else {
                "Punctuation boundaries partially match".to_owned()
            },
        },
        AlignmentEvidence::Tags {
            score_basis_points: score.tags,
            source_signature: take_values(&source.tags, max_values),
            target_signature: take_values(&target.tags, max_values),
            source_tag_count: u32::try_from(source.tags.len()).unwrap_or(u32::MAX),
            target_tag_count: u32::try_from(target.tags.len()).unwrap_or(u32::MAX),
            summary: if source.tags == target.tags && !source.tags.is_empty() {
                "Protected-tag signatures match".to_owned()
            } else if source.tags.is_empty() && target.tags.is_empty() {
                "No protected-tag anchors are present".to_owned()
            } else {
                "Protected-tag signatures differ".to_owned()
            },
        },
        AlignmentEvidence::LexicalAnchors {
            score_basis_points: score.lexical,
            shared_anchors: shared_anchors.into_iter().take(max_values).collect(),
            shared_anchor_count,
            summary: format!("{shared_anchor_count} lexical anchors are shared"),
        },
        AlignmentEvidence::Displacement {
            penalty_basis_points: score.displacement_penalty,
            source_position_basis_points: score.source_position,
            target_position_basis_points: score.target_position,
            summary: format!(
                "Relative-position penalty is {} basis points",
                score.displacement_penalty
            ),
        },
    ]
}

fn take_values(values: &[String], maximum: usize) -> Vec<String> {
    values.iter().take(maximum).cloned().collect()
}

fn resolve_partition_group(
    link_index: usize,
    side: AlignmentSide,
    ids: &[String],
    positions: &BTreeMap<&str, usize>,
    owned: &mut [bool],
) -> Result<Option<(usize, usize)>, AlignmentError> {
    if ids.is_empty() {
        return Ok(None);
    }
    let mut indices = Vec::with_capacity(ids.len());
    for id in ids {
        let Some(&index) = positions.get(id.as_str()) else {
            return Err(AlignmentError::UnknownPartitionMember {
                link_index,
                side,
                id: id.clone(),
            });
        };
        if owned[index] || indices.contains(&index) {
            return Err(AlignmentError::DuplicatePartitionMember {
                link_index,
                side,
                id: id.clone(),
            });
        }
        indices.push(index);
    }
    let first = indices[0];
    if indices
        .iter()
        .enumerate()
        .any(|(offset, index)| *index != first.saturating_add(offset))
    {
        return Err(AlignmentError::NonContiguousPartitionGroup { link_index, side });
    }
    for index in &indices {
        owned[*index] = true;
    }
    Ok(Some((first, *indices.last().expect("non-empty group"))))
}

fn validate_partition_order(
    link_index: usize,
    side: AlignmentSide,
    range: Option<(usize, usize)>,
    previous_end: Option<usize>,
) -> Result<Option<usize>, AlignmentError> {
    let Some((first, last)) = range else {
        return Ok(previous_end);
    };
    if previous_end.is_some_and(|previous| first <= previous) {
        return Err(AlignmentError::PartitionOrderViolation { link_index, side });
    }
    Ok(Some(last))
}

fn require_complete_partition(
    segments: &[AlignmentPartitionSegment],
    owned: &[bool],
    side: AlignmentSide,
) -> Result<(), AlignmentError> {
    if let Some((index, _)) = owned.iter().enumerate().find(|(_, owned)| !**owned) {
        return Err(AlignmentError::MissingPartitionMember {
            side,
            id: segments[index].id.clone(),
        });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn segment(id: &str, ordinal: u32, text: &str) -> AlignmentSegment {
        AlignmentSegment {
            id: id.to_owned(),
            ordinal,
            text: text.to_owned(),
            tag_signature: Vec::new(),
        }
    }

    fn tagged_segment(id: &str, ordinal: u32, text: &str, tags: &[&str]) -> AlignmentSegment {
        AlignmentSegment {
            id: id.to_owned(),
            ordinal,
            text: text.to_owned(),
            tag_signature: tags.iter().map(|tag| (*tag).to_owned()).collect(),
        }
    }

    fn transitions(plan: &AlignmentPlan) -> Vec<AlignmentTransition> {
        plan.candidates
            .iter()
            .map(|candidate| candidate.transition)
            .collect()
    }

    #[test]
    fn aligns_one_to_one_fixture() {
        let source = [
            segment("s1", 0, "Alpha 17."),
            segment("s2", 1, "Beta remains active."),
        ];
        let target = [
            segment("t1", 0, "Alpha 17."),
            segment("t2", 1, "Beta remains active."),
        ];

        let plan = align(&source, &target, &AlignmentOptions::default()).unwrap();

        assert_eq!(
            transitions(&plan),
            [AlignmentTransition::OneToOne, AlignmentTransition::OneToOne]
        );
        assert!(
            plan.candidates
                .iter()
                .all(|candidate| candidate.confidence_basis_points >= 8_500)
        );
    }

    #[test]
    fn aligns_one_to_many_fixture() {
        let source = [segment(
            "s1",
            0,
            "Alpha clause 17. Beta clause remains active.",
        )];
        let target = [
            segment("t1", 0, "Alpha clause 17."),
            segment("t2", 1, "Beta clause remains active."),
        ];

        let plan = align(&source, &target, &AlignmentOptions::default()).unwrap();

        assert_eq!(transitions(&plan), [AlignmentTransition::OneToMany]);
        assert_eq!(plan.candidates[0].target_segment_ids, ["t1", "t2"]);
    }

    #[test]
    fn aligns_many_to_one_fixture() {
        let source = [
            segment("s1", 0, "Alpha clause 17."),
            segment("s2", 1, "Beta clause remains active."),
        ];
        let target = [segment(
            "t1",
            0,
            "Alpha clause 17. Beta clause remains active.",
        )];

        let plan = align(&source, &target, &AlignmentOptions::default()).unwrap();

        assert_eq!(transitions(&plan), [AlignmentTransition::ManyToOne]);
        assert_eq!(plan.candidates[0].source_segment_ids, ["s1", "s2"]);
    }

    #[test]
    fn leaves_bad_middle_source_unaligned() {
        let source = [
            segment("s1", 0, "Stable first."),
            segment("s2", 1, "999 999 999 999 999 999 999 999 999"),
            segment("s3", 2, "Stable third."),
        ];
        let target = [
            segment("t1", 0, "Stable first."),
            segment("t2", 1, "Stable third."),
        ];

        let plan = align(&source, &target, &AlignmentOptions::default()).unwrap();

        assert_eq!(
            transitions(&plan),
            [
                AlignmentTransition::OneToOne,
                AlignmentTransition::SourceUnaligned,
                AlignmentTransition::OneToOne,
            ]
        );
        assert_eq!(plan.candidates[1].confidence_basis_points, 0);
    }

    #[test]
    fn number_and_tag_anchors_raise_confidence() {
        let source = [tagged_segment(
            "s1",
            0,
            "Keep item 42 active.",
            &["open:strong", "close:strong"],
        )];
        let matching = [tagged_segment(
            "t1",
            0,
            "Keep item 42 active.",
            &["open:strong", "close:strong"],
        )];
        let mismatching = [tagged_segment(
            "t1",
            0,
            "Keep item 99 active.",
            &["standalone:code"],
        )];

        let matched = align(&source, &matching, &AlignmentOptions::default()).unwrap();
        let mismatched = align(&source, &mismatching, &AlignmentOptions::default()).unwrap();

        assert!(
            matched.candidates[0].confidence_basis_points
                > mismatched.candidates[0].confidence_basis_points
        );
        assert!(
            matched.candidates[0]
                .evidence
                .iter()
                .any(|evidence| matches!(evidence, AlignmentEvidence::Numbers { .. }))
        );
        assert!(
            matched.candidates[0]
                .evidence
                .iter()
                .any(|evidence| matches!(evidence, AlignmentEvidence::Tags { .. }))
        );
    }

    #[test]
    fn ambiguous_inputs_are_byte_deterministic() {
        let source = [
            segment("s1", 0, "Repeated value."),
            segment("s2", 1, "Repeated value."),
            segment("s3", 2, "Repeated value."),
        ];
        let target = [
            segment("t1", 0, "Repeated value."),
            segment("t2", 1, "Repeated value."),
        ];
        let expected =
            serde_json::to_vec(&align(&source, &target, &AlignmentOptions::default()).unwrap())
                .unwrap();

        for _ in 0..20 {
            let actual =
                serde_json::to_vec(&align(&source, &target, &AlignmentOptions::default()).unwrap())
                    .unwrap();
            assert_eq!(actual, expected);
        }
    }

    #[test]
    fn rejects_duplicate_ids_and_non_increasing_ordinals() {
        let duplicate_ids = [segment("s1", 0, "First"), segment("s1", 1, "Second")];
        let bad_order = [segment("s1", 2, "First"), segment("s2", 1, "Second")];

        assert!(matches!(
            align(&duplicate_ids, &[], &AlignmentOptions::default()),
            Err(AlignmentError::DuplicateSegmentId {
                side: AlignmentSide::Source,
                ..
            })
        ));
        assert!(matches!(
            align(&bad_order, &[], &AlignmentOptions::default()),
            Err(AlignmentError::SegmentOrderViolation {
                side: AlignmentSide::Source,
                ..
            })
        ));
    }

    #[test]
    fn validates_complete_partition_and_rejects_reuse_or_crossing() {
        let source = [
            AlignmentPartitionSegment {
                id: "s1".to_owned(),
                ordinal: 0,
            },
            AlignmentPartitionSegment {
                id: "s2".to_owned(),
                ordinal: 1,
            },
        ];
        let target = [
            AlignmentPartitionSegment {
                id: "t1".to_owned(),
                ordinal: 0,
            },
            AlignmentPartitionSegment {
                id: "t2".to_owned(),
                ordinal: 1,
            },
        ];
        let valid = [
            AlignmentPartitionLink {
                source_segment_ids: vec!["s1".to_owned()],
                target_segment_ids: vec!["t1".to_owned()],
            },
            AlignmentPartitionLink {
                source_segment_ids: vec!["s2".to_owned()],
                target_segment_ids: vec!["t2".to_owned()],
            },
        ];
        let validation =
            validate_partition(&source, &target, &valid, &PartitionLimits::default()).unwrap();
        assert_eq!(validation.link_count, 2);

        let reused = [
            valid[0].clone(),
            AlignmentPartitionLink {
                source_segment_ids: vec!["s1".to_owned(), "s2".to_owned()],
                target_segment_ids: vec!["t2".to_owned()],
            },
        ];
        assert!(matches!(
            validate_partition(&source, &target, &reused, &PartitionLimits::default()),
            Err(AlignmentError::DuplicatePartitionMember {
                side: AlignmentSide::Source,
                ..
            })
        ));

        let crossing = [
            AlignmentPartitionLink {
                source_segment_ids: vec!["s1".to_owned()],
                target_segment_ids: vec!["t2".to_owned()],
            },
            AlignmentPartitionLink {
                source_segment_ids: vec!["s2".to_owned()],
                target_segment_ids: vec!["t1".to_owned()],
            },
        ];
        assert!(matches!(
            validate_partition(&source, &target, &crossing, &PartitionLimits::default()),
            Err(AlignmentError::PartitionOrderViolation {
                side: AlignmentSide::Target,
                ..
            })
        ));
    }

    #[test]
    fn rejects_missing_non_contiguous_and_unknown_partition_members() {
        let source = [
            AlignmentPartitionSegment {
                id: "s1".to_owned(),
                ordinal: 0,
            },
            AlignmentPartitionSegment {
                id: "s2".to_owned(),
                ordinal: 1,
            },
            AlignmentPartitionSegment {
                id: "s3".to_owned(),
                ordinal: 2,
            },
        ];
        let limits = PartitionLimits::default();

        assert!(matches!(
            validate_partition(
                &source,
                &[],
                &[AlignmentPartitionLink {
                    source_segment_ids: vec!["s1".to_owned(), "s3".to_owned()],
                    target_segment_ids: Vec::new(),
                }],
                &limits
            ),
            Err(AlignmentError::NonContiguousPartitionGroup { .. })
        ));
        assert!(matches!(
            validate_partition(
                &source,
                &[],
                &[AlignmentPartitionLink {
                    source_segment_ids: vec!["unknown".to_owned()],
                    target_segment_ids: Vec::new(),
                }],
                &limits
            ),
            Err(AlignmentError::UnknownPartitionMember { .. })
        ));
        assert!(matches!(
            validate_partition(
                &source,
                &[],
                &[AlignmentPartitionLink {
                    source_segment_ids: vec!["s1".to_owned()],
                    target_segment_ids: Vec::new(),
                }],
                &limits
            ),
            Err(AlignmentError::MissingPartitionMember { id, .. }) if id == "s2"
        ));
    }

    #[test]
    fn enforces_segment_text_and_work_limits() {
        let source = [segment("s1", 0, "First"), segment("s2", 1, "Second")];
        let mut options = AlignmentOptions {
            max_segments_per_side: 1,
            ..AlignmentOptions::default()
        };
        assert!(matches!(
            align(&source, &[], &options),
            Err(AlignmentError::ResourceLimitExceeded {
                resource: AlignmentResource::Segments,
                ..
            })
        ));

        options.max_segments_per_side = 2;
        options.max_total_input_chars = 5;
        assert!(align(&source[..1], &[], &options).is_ok());
        assert!(matches!(
            align(&source, &[], &options),
            Err(AlignmentError::ResourceLimitExceeded {
                resource: AlignmentResource::InputCharacters,
                ..
            })
        ));

        options.max_total_input_chars = 100;
        options.max_work_units = 3;
        assert!(matches!(
            align(&source[..1], &[segment("t1", 0, "First")], &options),
            Err(AlignmentError::ResourceLimitExceeded {
                resource: AlignmentResource::WorkUnits,
                ..
            })
        ));
    }
}

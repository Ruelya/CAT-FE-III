//! Pure matching and open-format codecs for translation assets.

use std::collections::{BTreeMap, BTreeSet};
use std::io::{BufReader, Read, Write};

use quick_xml::events::{BytesDecl, BytesEnd, BytesStart, BytesText, Event};
use quick_xml::{Reader, Writer};
use regex::Regex;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use thiserror::Error;
use unicode_normalization::UnicodeNormalization;

static NUMBER_RE: std::sync::LazyLock<Regex> =
    std::sync::LazyLock::new(|| Regex::new(r"(?x)(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?").unwrap());
static DATE_RE: std::sync::LazyLock<Regex> = std::sync::LazyLock::new(|| {
    Regex::new(r"(?x)\b(?:\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4})\b")
        .unwrap()
});
static PLACEHOLDER_RE: std::sync::LazyLock<Regex> =
    std::sync::LazyLock::new(|| Regex::new(r"(?:\{[^{}]+\}|<[^<>]+>|%\w+)").unwrap());

#[derive(Debug, Error)]
pub enum AssetError {
    #[error("asset I/O failed: {0}")]
    Io(#[from] std::io::Error),
    #[error("asset CSV failed: {0}")]
    Csv(#[from] csv::Error),
    #[error("asset XML failed: {0}")]
    Xml(#[from] quick_xml::Error),
    #[error("invalid asset data at row {row}: {message}")]
    Invalid { row: usize, message: String },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum AssetMountMode {
    Write,
    Reference,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TmLibrary {
    pub id: String,
    pub name: String,
    pub source_locale: String,
    pub target_locale: String,
    pub domain: Option<String>,
    pub writable: bool,
    pub revision: u64,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TmLibraryMount {
    pub project_id: String,
    pub library_id: String,
    pub mode: AssetMountMode,
    pub priority: u32,
    pub enabled: bool,
    pub revision: u64,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TmUnit {
    pub id: String,
    pub library_id: String,
    pub source_locale: String,
    pub target_locale: String,
    pub source_text: String,
    pub target_text: String,
    pub source_hash: String,
    pub target_hash: String,
    pub domain: Option<String>,
    pub origin_project_id: Option<String>,
    pub origin_document_id: Option<String>,
    pub origin_segment_id: Option<String>,
    pub context_before_hash: Option<String>,
    pub context_after_hash: Option<String>,
    pub author: Option<String>,
    pub metadata: BTreeMap<String, String>,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum TmMatchKind {
    Context,
    Exact,
    Fuzzy,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TmMatch {
    pub library: TmLibrary,
    pub unit: TmUnit,
    pub kind: TmMatchKind,
    pub score: u8,
    pub mount_priority: u32,
    pub substitutions: Vec<PlaceholderSubstitution>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum ConcordanceSide {
    Source,
    Target,
    Both,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ConcordanceHit {
    pub library_id: String,
    pub unit: TmUnit,
    pub matched_side: ConcordanceSide,
}

/// One translation memory: a named store of confirmed segment pairs.
/// `tm_entries.memory_id` points here. Projects reach a memory through a
/// [`MemoryMount`]; the memory itself carries no project binding.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Memory {
    pub id: String,
    pub name: String,
    pub source_locale: String,
    pub target_locale: String,
    pub revision: u64,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}

/// A project's mount of one memory — the same family shape as
/// [`TermbaseMount`]. `enabled` gates the read path (lookup, pretranslate);
/// `writable` marks the working memory, the single mount confirmation-time
/// TM writes go to. The engine enforces at most one writable mount per
/// project.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct MemoryMount {
    pub project_id: String,
    pub memory_id: String,
    pub priority: u32,
    pub enabled: bool,
    pub writable: bool,
    pub revision: u64,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Termbase {
    pub id: String,
    pub name: String,
    pub source_locale: String,
    pub domain: Option<String>,
    pub writable: bool,
    pub revision: u64,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TermbaseMount {
    pub project_id: String,
    pub termbase_id: String,
    pub priority: u32,
    pub writable: bool,
    pub enabled: bool,
    pub revision: u64,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum TermStatus {
    Candidate,
    Active,
    Deprecated,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TermTranslation {
    pub id: String,
    pub entry_id: String,
    pub locale: String,
    pub term: String,
    pub preferred: bool,
    pub forbidden: bool,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TermEntry {
    pub id: String,
    pub termbase_id: String,
    pub source_locale: String,
    pub source_term: String,
    pub part_of_speech: Option<String>,
    pub definition: Option<String>,
    pub example: Option<String>,
    pub domain: Option<String>,
    pub status: TermStatus,
    pub revision: u64,
    pub translations: Vec<TermTranslation>,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TermMatch {
    pub termbase_id: String,
    pub entry_id: String,
    pub source_term: String,
    pub translations: Vec<TermTranslation>,
    pub start: u32,
    pub end: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TmExchangeUnit {
    pub source_locale: String,
    pub target_locale: String,
    pub source_text: String,
    pub target_text: String,
    pub domain: Option<String>,
    pub author: Option<String>,
    pub created_at_ms: Option<i64>,
    pub metadata: BTreeMap<String, String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TermExchangeTranslation {
    pub locale: String,
    pub term: String,
    pub preferred: bool,
    pub forbidden: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TermExchangeEntry {
    pub source_locale: String,
    pub source_term: String,
    pub target_translations: Vec<TermExchangeTranslation>,
    pub part_of_speech: Option<String>,
    pub definition: Option<String>,
    pub example: Option<String>,
    pub domain: Option<String>,
    pub status: String,
    pub metadata: BTreeMap<String, String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PlaceholderSubstitution {
    pub kind: String,
    pub query_value: String,
    pub candidate_value: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct MatchScore {
    pub score: u8,
    pub substitutions: Vec<PlaceholderSubstitution>,
}

pub fn normalize_asset_text(value: &str) -> String {
    value
        .nfkc()
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

pub fn normalize_match_key(value: &str) -> String {
    normalize_asset_text(value)
        .chars()
        .flat_map(char::to_lowercase)
        .collect()
}

pub fn exact_key(value: &str) -> String {
    let normalized = normalize_match_key(value);
    let normalized = PLACEHOLDER_RE.replace_all(&normalized, "<placeholder>");
    let normalized = DATE_RE.replace_all(&normalized, "<date>");
    NUMBER_RE.replace_all(&normalized, "<number>").into_owned()
}

pub fn match_score(query: &str, candidate: &str) -> MatchScore {
    let query_key = exact_key(query);
    let candidate_key = exact_key(candidate);
    if query_key == candidate_key {
        return MatchScore {
            score: 100,
            substitutions: substitutions(query, candidate),
        };
    }
    let query_tokens = similarity_tokens(&query_key);
    let candidate_tokens = similarity_tokens(&candidate_key);
    let intersection = query_tokens.intersection(&candidate_tokens).count() as f64;
    let union = query_tokens.union(&candidate_tokens).count() as f64;
    let jaccard = if union == 0.0 {
        0.0
    } else {
        intersection / union
    };
    let edit = normalized_edit_similarity(&query_key, &candidate_key);
    let score = ((jaccard * JACCARD_WEIGHT + edit * EDIT_WEIGHT) * 100.0)
        .round()
        .clamp(0.0, 99.0) as u8;
    MatchScore {
        score,
        substitutions: substitutions(query, candidate),
    }
}

const JACCARD_WEIGHT: f64 = 0.65;
const EDIT_WEIGHT: f64 = 0.35;

/// In-memory recall index over TM source texts.
///
/// Recall is exhaustive with respect to the requested score floor: a candidate
/// is skipped only when a provable upper bound on its [`match_score`] falls
/// below `min_score`. There is no fixed candidate cap and no silent
/// truncation; callers apply their own explicit result limit after reranking.
#[derive(Debug, Default)]
pub struct TmIndex {
    postings: BTreeMap<String, BTreeSet<usize>>,
    entries: Vec<TmIndexEntry>,
    slots: BTreeMap<String, usize>,
}

#[derive(Debug)]
struct TmIndexEntry {
    id: String,
    token_count: usize,
    key_chars: usize,
}

impl TmIndex {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn len(&self) -> usize {
        self.slots.len()
    }

    pub fn is_empty(&self) -> bool {
        self.slots.is_empty()
    }

    /// Insert or refresh one entry keyed by its stable id.
    pub fn insert(&mut self, id: &str, source_text: &str) {
        if self.slots.contains_key(id) {
            // Source text is immutable per entry id in practice; a re-insert
            // with different text must rebuild the posting lists for the slot.
            self.remove(id);
        }
        let key = exact_key(source_text);
        let tokens = similarity_tokens(&key);
        let slot = self.entries.len();
        for token in &tokens {
            self.postings.entry(token.clone()).or_default().insert(slot);
        }
        self.entries.push(TmIndexEntry {
            id: id.to_string(),
            token_count: tokens.len(),
            key_chars: key.chars().count(),
        });
        self.slots.insert(id.to_string(), slot);
    }

    pub fn remove(&mut self, id: &str) {
        if let Some(slot) = self.slots.remove(id) {
            for posting in self.postings.values_mut() {
                posting.remove(&slot);
            }
            // Keep the slot allocated but inert so other slots stay stable.
            self.entries[slot].token_count = 0;
        }
    }

    /// Return every entry id whose best possible [`match_score`] against
    /// `query` can reach `min_score`. The bound uses the exact Jaccard overlap
    /// from the posting lists plus a length-ratio ceiling on edit similarity,
    /// so pruned entries provably score below the floor.
    pub fn recall(&self, query: &str, min_score: u8) -> Vec<String> {
        let key = exact_key(query);
        let query_tokens = similarity_tokens(&key);
        let query_chars = key.chars().count();
        let floor = f64::from(min_score);
        let mut overlaps: BTreeMap<usize, usize> = BTreeMap::new();
        for token in &query_tokens {
            if let Some(posting) = self.postings.get(token) {
                for slot in posting {
                    *overlaps.entry(*slot).or_insert(0) += 1;
                }
            }
        }
        let mut result = Vec::new();
        let consider_zero_overlap = floor <= EDIT_WEIGHT * 100.0;
        let candidates: Vec<usize> = if consider_zero_overlap {
            (0..self.entries.len()).collect()
        } else {
            overlaps.keys().copied().collect()
        };
        for slot in candidates {
            let entry = &self.entries[slot];
            if !self.slots.get(&entry.id).is_some_and(|live| *live == slot) {
                continue;
            }
            let intersection = overlaps.get(&slot).copied().unwrap_or(0) as f64;
            let union = (query_tokens.len() + entry.token_count) as f64 - intersection;
            let jaccard = if union <= 0.0 {
                0.0
            } else {
                intersection / union
            };
            let max_chars = query_chars.max(entry.key_chars) as f64;
            let edit_ceiling = if max_chars == 0.0 {
                1.0
            } else {
                query_chars.min(entry.key_chars) as f64 / max_chars
            };
            let bound = (jaccard * JACCARD_WEIGHT + edit_ceiling * EDIT_WEIGHT) * 100.0;
            if bound + 0.5 >= floor {
                result.push(entry.id.clone());
            }
        }
        result
    }
}

fn similarity_tokens(value: &str) -> BTreeSet<String> {
    let chars = value.chars().collect::<Vec<_>>();
    let mut tokens = BTreeSet::new();
    for character in &chars {
        if !character.is_whitespace() {
            tokens.insert(character.to_string());
        }
    }
    for window in chars.windows(2) {
        if window.iter().all(|character| !character.is_whitespace()) {
            tokens.insert(window.iter().collect());
        }
    }
    value
        .split_whitespace()
        .filter(|token| !token.is_empty())
        .for_each(|token| {
            tokens.insert(token.to_string());
        });
    tokens
}

fn normalized_edit_similarity(left: &str, right: &str) -> f64 {
    let left = left.chars().collect::<Vec<_>>();
    let right = right.chars().collect::<Vec<_>>();
    if left.is_empty() && right.is_empty() {
        return 1.0;
    }
    let mut previous = (0..=right.len()).collect::<Vec<_>>();
    for (i, left_char) in left.iter().enumerate() {
        let mut current = vec![i + 1; right.len() + 1];
        for (j, right_char) in right.iter().enumerate() {
            let substitution = previous[j] + usize::from(left_char != right_char);
            current[j + 1] = (current[j] + 1).min(previous[j + 1] + 1).min(substitution);
        }
        previous = current;
    }
    let max_len = left.len().max(right.len()) as f64;
    1.0 - previous[right.len()] as f64 / max_len
}

fn substitutions(query: &str, candidate: &str) -> Vec<PlaceholderSubstitution> {
    let mut result = Vec::new();
    let query_dates = DATE_RE
        .find_iter(query)
        .map(|item| item.as_str().to_string())
        .collect::<Vec<_>>();
    let candidate_dates = DATE_RE
        .find_iter(candidate)
        .map(|item| item.as_str().to_string())
        .collect::<Vec<_>>();
    for (query_value, candidate_value) in query_dates.into_iter().zip(candidate_dates) {
        if query_value != candidate_value {
            result.push(PlaceholderSubstitution {
                kind: "date".to_string(),
                query_value,
                candidate_value,
            });
        }
    }
    let query_numbers = numbers_outside_dates(query);
    let candidate_numbers = numbers_outside_dates(candidate);
    for (query_value, candidate_value) in query_numbers.into_iter().zip(candidate_numbers) {
        if query_value != candidate_value {
            result.push(PlaceholderSubstitution {
                kind: "number".to_string(),
                query_value,
                candidate_value,
            });
        }
    }
    let query_placeholders = PLACEHOLDER_RE
        .find_iter(query)
        .map(|item| item.as_str().to_string())
        .collect::<Vec<_>>();
    let candidate_placeholders = PLACEHOLDER_RE
        .find_iter(candidate)
        .map(|item| item.as_str().to_string())
        .collect::<Vec<_>>();
    for (query_value, candidate_value) in query_placeholders.into_iter().zip(candidate_placeholders)
    {
        if query_value != candidate_value {
            result.push(PlaceholderSubstitution {
                kind: "placeholder".to_string(),
                query_value,
                candidate_value,
            });
        }
    }
    result
}

fn numbers_outside_dates(value: &str) -> Vec<String> {
    let date_ranges = DATE_RE
        .find_iter(value)
        .map(|item| item.start()..item.end())
        .collect::<Vec<_>>();
    NUMBER_RE
        .find_iter(value)
        .filter(|item| {
            !date_ranges
                .iter()
                .any(|range| range.start <= item.start() && item.end() <= range.end)
        })
        .map(|item| item.as_str().to_string())
        .collect()
}

pub fn term_spans(text: &str, term: &str) -> Vec<(u32, u32)> {
    let normalized_term = normalize_match_key(term);
    if normalized_term.is_empty() {
        return Vec::new();
    }
    let normalized_text = normalize_match_key(text);
    let requires_word_boundary = !normalized_term.chars().any(is_cjk_character);
    let mut spans = Vec::new();
    let mut search_from = 0;
    while let Some(relative) = normalized_text[search_from..].find(&normalized_term) {
        let start_byte = search_from + relative;
        let end_byte = start_byte + normalized_term.len();
        let boundary_matches = !requires_word_boundary
            || (normalized_text[..start_byte]
                .chars()
                .next_back()
                .is_none_or(|character| !is_word_character(character))
                && normalized_text[end_byte..]
                    .chars()
                    .next()
                    .is_none_or(|character| !is_word_character(character)));
        if !boundary_matches {
            search_from = end_byte;
            continue;
        }
        let start = normalized_text[..start_byte].chars().count() as u32;
        let end = normalized_text[..end_byte].chars().count() as u32;
        spans.push((start, end));
        search_from = end_byte;
    }
    spans
}

fn is_word_character(character: char) -> bool {
    character.is_alphanumeric() || character == '_'
}

fn is_cjk_character(character: char) -> bool {
    matches!(
        character as u32,
        0x3400..=0x4DBF
            | 0x4E00..=0x9FFF
            | 0xF900..=0xFAFF
            | 0x3040..=0x30FF
            | 0xAC00..=0xD7AF
    )
}

pub fn parse_tm_csv(
    input: impl Read,
    source_locale: &str,
    target_locale: &str,
) -> Result<Vec<TmExchangeUnit>, AssetError> {
    parse_tm_delimited(input, source_locale, target_locale, b',')
}

pub fn parse_tm_tsv(
    input: impl Read,
    source_locale: &str,
    target_locale: &str,
) -> Result<Vec<TmExchangeUnit>, AssetError> {
    parse_tm_delimited(input, source_locale, target_locale, b'\t')
}

fn parse_tm_delimited(
    input: impl Read,
    source_locale: &str,
    target_locale: &str,
    delimiter: u8,
) -> Result<Vec<TmExchangeUnit>, AssetError> {
    let mut reader = csv::ReaderBuilder::new()
        .delimiter(delimiter)
        .flexible(true)
        .from_reader(input);
    let headers = reader.headers()?.clone();
    let source_index = headers
        .iter()
        .position(|value| value == "source")
        .ok_or_else(|| AssetError::Invalid {
            row: 1,
            message: "missing source column".to_string(),
        })?;
    let target_index = headers
        .iter()
        .position(|value| value == "target")
        .ok_or_else(|| AssetError::Invalid {
            row: 1,
            message: "missing target column".to_string(),
        })?;
    let mut units = Vec::new();
    for (row_index, record) in reader.records().enumerate() {
        let row = row_index + 2;
        let record = record?;
        let source = record.get(source_index).unwrap_or_default().trim();
        let target = record.get(target_index).unwrap_or_default().trim();
        if source.is_empty() || target.is_empty() {
            return Err(AssetError::Invalid {
                row,
                message: "source and target are required".to_string(),
            });
        }
        let get = |name: &str| {
            headers
                .iter()
                .position(|value| value == name)
                .and_then(|index| record.get(index))
                .filter(|value| !value.is_empty())
                .map(ToOwned::to_owned)
        };
        let mut metadata = BTreeMap::new();
        for (index, header) in headers.iter().enumerate() {
            if !matches!(
                header,
                "source"
                    | "target"
                    | "sourceLocale"
                    | "targetLocale"
                    | "domain"
                    | "author"
                    | "createdAtMs"
            ) && let Some(value) = record.get(index).filter(|value| !value.is_empty())
            {
                metadata.insert(header.to_string(), value.to_string());
            }
        }
        units.push(TmExchangeUnit {
            source_locale: get("sourceLocale").unwrap_or_else(|| source_locale.to_string()),
            target_locale: get("targetLocale").unwrap_or_else(|| target_locale.to_string()),
            source_text: source.to_string(),
            target_text: target.to_string(),
            domain: get("domain"),
            author: get("author"),
            created_at_ms: get("createdAtMs").and_then(|value| value.parse().ok()),
            metadata,
        });
    }
    Ok(units)
}

pub fn write_tm_csv<W: Write>(output: W, units: &[TmExchangeUnit]) -> Result<(), AssetError> {
    write_tm_delimited(output, units, b',')
}

pub fn write_tm_tsv<W: Write>(output: W, units: &[TmExchangeUnit]) -> Result<(), AssetError> {
    write_tm_delimited(output, units, b'\t')
}

fn write_tm_delimited<W: Write>(
    output: W,
    units: &[TmExchangeUnit],
    delimiter: u8,
) -> Result<(), AssetError> {
    let mut writer = csv::WriterBuilder::new()
        .delimiter(delimiter)
        .from_writer(output);
    let metadata_headers = units
        .iter()
        .flat_map(|unit| unit.metadata.keys().cloned())
        .filter(|key| {
            !matches!(
                key.as_str(),
                "source"
                    | "target"
                    | "sourceLocale"
                    | "targetLocale"
                    | "domain"
                    | "author"
                    | "createdAtMs"
            )
        })
        .collect::<BTreeSet<_>>();
    let mut headers = vec![
        "source".to_string(),
        "target".to_string(),
        "sourceLocale".to_string(),
        "targetLocale".to_string(),
        "domain".to_string(),
        "author".to_string(),
        "createdAtMs".to_string(),
    ];
    headers.extend(metadata_headers.iter().cloned());
    writer.write_record(&headers)?;
    for unit in units {
        let mut record = vec![
            unit.source_text.clone(),
            unit.target_text.clone(),
            unit.source_locale.clone(),
            unit.target_locale.clone(),
            unit.domain.clone().unwrap_or_default(),
            unit.author.clone().unwrap_or_default(),
            unit.created_at_ms
                .map(|value| value.to_string())
                .unwrap_or_default(),
        ];
        record.extend(
            metadata_headers
                .iter()
                .map(|key| unit.metadata.get(key).cloned().unwrap_or_default()),
        );
        writer.write_record(record)?;
    }
    writer.flush()?;
    Ok(())
}

pub fn parse_tmx(
    input: impl Read,
    source_locale: &str,
    target_locale: &str,
) -> Result<Vec<TmExchangeUnit>, AssetError> {
    #[derive(Default)]
    struct UnitState {
        segments: BTreeMap<String, String>,
        properties: BTreeMap<String, String>,
        author: Option<String>,
    }

    let mut reader = Reader::from_reader(BufReader::new(input));
    let mut buffer = Vec::new();
    let mut current: Option<UnitState> = None;
    let mut locale = None;
    let mut in_seg = false;
    let mut segment = String::new();
    let mut property_kind = None;
    let mut property_text = String::new();
    let mut units = Vec::new();
    loop {
        match reader.read_event_into(&mut buffer)? {
            Event::Start(element) if element.name().local_name().as_ref() == b"tu" => {
                let author = element.attributes().flatten().find_map(|attribute| {
                    (attribute.key.local_name().as_ref() == b"creationid")
                        .then(|| String::from_utf8_lossy(&attribute.value).into_owned())
                });
                current = Some(UnitState {
                    author,
                    ..UnitState::default()
                });
            }
            Event::Start(element) if element.name().local_name().as_ref() == b"tuv" => {
                locale = element.attributes().flatten().find_map(|attribute| {
                    let key = attribute.key.local_name();
                    (key.as_ref() == b"lang")
                        .then(|| String::from_utf8_lossy(&attribute.value).into_owned())
                });
            }
            Event::Start(element) if element.name().local_name().as_ref() == b"seg" => {
                in_seg = true;
                segment.clear();
            }
            Event::Start(element) if element.name().local_name().as_ref() == b"prop" => {
                property_kind = element.attributes().flatten().find_map(|attribute| {
                    (attribute.key.local_name().as_ref() == b"type")
                        .then(|| String::from_utf8_lossy(&attribute.value).into_owned())
                });
                property_text.clear();
            }
            Event::Text(text) if in_seg => {
                segment.push_str(&text.decode().map_err(|error| AssetError::Invalid {
                    row: units.len() + 1,
                    message: error.to_string(),
                })?)
            }
            Event::Text(text) if property_kind.is_some() => {
                property_text.push_str(&text.decode().map_err(|error| AssetError::Invalid {
                    row: units.len() + 1,
                    message: error.to_string(),
                })?)
            }
            Event::GeneralRef(reference) if in_seg => {
                segment.push_str(&reference.decode().map_err(|error| AssetError::Invalid {
                    row: units.len() + 1,
                    message: error.to_string(),
                })?)
            }
            Event::End(element) if element.name().local_name().as_ref() == b"seg" => {
                in_seg = false;
                if let (Some(state), Some(locale)) = (current.as_mut(), locale.as_ref()) {
                    state.segments.insert(locale.clone(), segment.clone());
                }
            }
            Event::End(element) if element.name().local_name().as_ref() == b"prop" => {
                if let (Some(state), Some(kind)) = (current.as_mut(), property_kind.take()) {
                    state.properties.insert(kind, property_text.clone());
                }
            }
            Event::End(element) if element.name().local_name().as_ref() == b"tuv" => locale = None,
            Event::End(element) if element.name().local_name().as_ref() == b"tu" => {
                let mut state = current.take().ok_or_else(|| AssetError::Invalid {
                    row: units.len() + 1,
                    message: "closing TU without opening TU".to_string(),
                })?;
                let source = state
                    .segments
                    .get(source_locale)
                    .cloned()
                    .unwrap_or_default();
                let target = state
                    .segments
                    .get(target_locale)
                    .cloned()
                    .unwrap_or_default();
                if source.is_empty() || target.is_empty() {
                    return Err(AssetError::Invalid {
                        row: units.len() + 1,
                        message: "TMX unit lacks requested language pair".to_string(),
                    });
                }
                let domain = state.properties.remove("x-domain");
                let author = state.author.or_else(|| state.properties.remove("x-author"));
                let created_at_ms = state
                    .properties
                    .remove("x-created-at-ms")
                    .and_then(|value| value.parse::<i64>().ok());
                let metadata = state
                    .properties
                    .into_iter()
                    .map(|(key, value)| {
                        (
                            key.strip_prefix("x-meta:").unwrap_or(&key).to_string(),
                            value,
                        )
                    })
                    .collect();
                units.push(TmExchangeUnit {
                    source_locale: source_locale.to_string(),
                    target_locale: target_locale.to_string(),
                    source_text: source,
                    target_text: target,
                    domain,
                    author,
                    created_at_ms,
                    metadata,
                });
            }
            Event::Eof => break,
            _ => {}
        }
        buffer.clear();
    }
    Ok(units)
}

pub fn write_tmx<W: Write>(output: W, units: &[TmExchangeUnit]) -> Result<(), AssetError> {
    let mut writer = Writer::new(output);
    writer.write_event(Event::Decl(BytesDecl::new("1.0", Some("UTF-8"), None)))?;
    let mut tmx = BytesStart::new("tmx");
    tmx.push_attribute(("version", "1.4"));
    writer.write_event(Event::Start(tmx))?;
    let mut header = BytesStart::new("header");
    header.push_attribute(("creationtool", "Translunar CAT"));
    header.push_attribute(("creationtoolversion", "0.1"));
    header.push_attribute(("datatype", "PlainText"));
    header.push_attribute(("segtype", "sentence"));
    header.push_attribute(("adminlang", "en"));
    header.push_attribute(("srclang", "*all*"));
    header.push_attribute(("o-tmf", "Translunar"));
    writer.write_event(Event::Empty(header))?;
    writer.write_event(Event::Start(BytesStart::new("body")))?;
    for unit in units {
        let mut tu = BytesStart::new("tu");
        if let Some(author) = unit.author.as_deref() {
            tu.push_attribute(("creationid", author));
        }
        writer.write_event(Event::Start(tu))?;
        write_tmx_prop(&mut writer, "x-domain", unit.domain.as_deref())?;
        let created_at_ms = unit.created_at_ms.map(|value| value.to_string());
        write_tmx_prop(&mut writer, "x-created-at-ms", created_at_ms.as_deref())?;
        for (key, value) in &unit.metadata {
            write_tmx_prop(&mut writer, &format!("x-meta:{key}"), Some(value))?;
        }
        for (locale, text) in [
            (unit.source_locale.as_str(), unit.source_text.as_str()),
            (unit.target_locale.as_str(), unit.target_text.as_str()),
        ] {
            let mut tuv = BytesStart::new("tuv");
            tuv.push_attribute(("xml:lang", locale));
            writer.write_event(Event::Start(tuv))?;
            writer.write_event(Event::Start(BytesStart::new("seg")))?;
            writer.write_event(Event::Text(BytesText::new(text)))?;
            writer.write_event(Event::End(BytesEnd::new("seg")))?;
            writer.write_event(Event::End(BytesEnd::new("tuv")))?;
        }
        writer.write_event(Event::End(BytesEnd::new("tu")))?;
    }
    writer.write_event(Event::End(BytesEnd::new("body")))?;
    writer.write_event(Event::End(BytesEnd::new("tmx")))?;
    Ok(())
}

fn write_tmx_prop<W: Write>(
    writer: &mut Writer<W>,
    kind: &str,
    value: Option<&str>,
) -> Result<(), AssetError> {
    let Some(value) = value else {
        return Ok(());
    };
    let mut property = BytesStart::new("prop");
    property.push_attribute(("type", kind));
    writer.write_event(Event::Start(property))?;
    writer.write_event(Event::Text(BytesText::new(value)))?;
    writer.write_event(Event::End(BytesEnd::new("prop")))?;
    Ok(())
}

pub fn parse_term_csv(
    input: impl Read,
    source_locale: &str,
    target_locale: &str,
) -> Result<Vec<TermExchangeEntry>, AssetError> {
    parse_term_delimited(input, source_locale, target_locale, b',')
}

pub fn parse_term_tsv(
    input: impl Read,
    source_locale: &str,
    target_locale: &str,
) -> Result<Vec<TermExchangeEntry>, AssetError> {
    parse_term_delimited(input, source_locale, target_locale, b'\t')
}

fn parse_term_delimited(
    input: impl Read,
    source_locale: &str,
    target_locale: &str,
    delimiter: u8,
) -> Result<Vec<TermExchangeEntry>, AssetError> {
    let mut reader = csv::ReaderBuilder::new()
        .delimiter(delimiter)
        .flexible(true)
        .from_reader(input);
    let headers = reader.headers()?.clone();
    let source_index = headers
        .iter()
        .position(|value| value == "sourceTerm")
        .ok_or_else(|| AssetError::Invalid {
            row: 1,
            message: "missing sourceTerm column".to_string(),
        })?;
    let target_index = headers
        .iter()
        .position(|value| value == "targetTerm")
        .ok_or_else(|| AssetError::Invalid {
            row: 1,
            message: "missing targetTerm column".to_string(),
        })?;
    let mut entries = BTreeMap::<(String, String), TermExchangeEntry>::new();
    for (row_index, record) in reader.records().enumerate() {
        let row = row_index + 2;
        let record = record?;
        let source_term = record.get(source_index).unwrap_or_default().trim();
        let target_term = record.get(target_index).unwrap_or_default().trim();
        if source_term.is_empty() || target_term.is_empty() {
            return Err(AssetError::Invalid {
                row,
                message: "sourceTerm and targetTerm are required".to_string(),
            });
        }
        let get = |name: &str| {
            headers
                .iter()
                .position(|value| value == name)
                .and_then(|index| record.get(index))
                .filter(|value| !value.is_empty())
                .map(ToOwned::to_owned)
        };
        let source_locale_value = get("sourceLocale").unwrap_or_else(|| source_locale.to_string());
        let mut metadata = BTreeMap::new();
        for (index, header) in headers.iter().enumerate() {
            if !matches!(
                header,
                "sourceTerm"
                    | "targetTerm"
                    | "sourceLocale"
                    | "targetLocale"
                    | "preferred"
                    | "forbidden"
                    | "partOfSpeech"
                    | "definition"
                    | "example"
                    | "domain"
                    | "status"
            ) && let Some(value) = record.get(index).filter(|value| !value.is_empty())
            {
                metadata.insert(header.to_string(), value.to_string());
            }
        }
        let parsed = TermExchangeEntry {
            source_locale: source_locale_value.clone(),
            source_term: source_term.to_string(),
            target_translations: vec![TermExchangeTranslation {
                locale: get("targetLocale").unwrap_or_else(|| target_locale.to_string()),
                term: target_term.to_string(),
                preferred: get("preferred").is_none_or(|value| value != "false"),
                forbidden: get("forbidden").is_some_and(|value| value == "true"),
            }],
            part_of_speech: get("partOfSpeech"),
            definition: get("definition"),
            example: get("example"),
            domain: get("domain"),
            status: get("status").unwrap_or_else(|| "active".to_string()),
            metadata,
        };
        let key = (source_locale_value, source_term.to_string());
        if let Some(existing) = entries.get_mut(&key) {
            for translation in parsed.target_translations {
                if let Some(current) = existing.target_translations.iter_mut().find(|current| {
                    current.locale == translation.locale && current.term == translation.term
                }) {
                    current.preferred = translation.preferred;
                    current.forbidden = translation.forbidden;
                } else {
                    existing.target_translations.push(translation);
                }
            }
            existing.metadata.extend(parsed.metadata);
        } else {
            entries.insert(key, parsed);
        }
    }
    Ok(entries.into_values().collect())
}

pub fn write_term_csv<W: Write>(
    output: W,
    entries: &[TermExchangeEntry],
) -> Result<(), AssetError> {
    write_term_delimited(output, entries, b',')
}

pub fn write_term_tsv<W: Write>(
    output: W,
    entries: &[TermExchangeEntry],
) -> Result<(), AssetError> {
    write_term_delimited(output, entries, b'\t')
}

fn write_term_delimited<W: Write>(
    output: W,
    entries: &[TermExchangeEntry],
    delimiter: u8,
) -> Result<(), AssetError> {
    let mut writer = csv::WriterBuilder::new()
        .delimiter(delimiter)
        .from_writer(output);
    let metadata_headers = entries
        .iter()
        .flat_map(|entry| entry.metadata.keys().cloned())
        .filter(|key| {
            !matches!(
                key.as_str(),
                "sourceTerm"
                    | "targetTerm"
                    | "sourceLocale"
                    | "targetLocale"
                    | "preferred"
                    | "forbidden"
                    | "partOfSpeech"
                    | "definition"
                    | "example"
                    | "domain"
                    | "status"
            )
        })
        .collect::<BTreeSet<_>>();
    let mut headers = vec![
        "sourceTerm".to_string(),
        "targetTerm".to_string(),
        "sourceLocale".to_string(),
        "targetLocale".to_string(),
        "preferred".to_string(),
        "forbidden".to_string(),
        "partOfSpeech".to_string(),
        "definition".to_string(),
        "example".to_string(),
        "domain".to_string(),
        "status".to_string(),
    ];
    headers.extend(metadata_headers.iter().cloned());
    writer.write_record(&headers)?;
    for entry in entries {
        for translation in &entry.target_translations {
            let mut record = vec![
                entry.source_term.clone(),
                translation.term.clone(),
                entry.source_locale.clone(),
                translation.locale.clone(),
                if translation.preferred {
                    "true"
                } else {
                    "false"
                }
                .to_string(),
                if translation.forbidden {
                    "true"
                } else {
                    "false"
                }
                .to_string(),
                entry.part_of_speech.clone().unwrap_or_default(),
                entry.definition.clone().unwrap_or_default(),
                entry.example.clone().unwrap_or_default(),
                entry.domain.clone().unwrap_or_default(),
                entry.status.clone(),
            ];
            record.extend(
                metadata_headers
                    .iter()
                    .map(|key| entry.metadata.get(key).cloned().unwrap_or_default()),
            );
            writer.write_record(record)?;
        }
    }
    writer.flush()?;
    Ok(())
}

pub fn parse_tbx(
    input: impl Read,
    source_locale: &str,
    target_locale: &str,
) -> Result<Vec<TermExchangeEntry>, AssetError> {
    let mut reader = Reader::from_reader(BufReader::new(input));
    let mut buffer = Vec::new();
    let mut current: Option<TermExchangeEntry> = None;
    let mut current_locale = None;
    let mut current_kind = None;
    let mut text = String::new();
    let mut entries = Vec::new();
    loop {
        match reader.read_event_into(&mut buffer)? {
            Event::Start(element) if element.name().local_name().as_ref() == b"termEntry" => {
                current = Some(TermExchangeEntry {
                    source_locale: source_locale.to_string(),
                    source_term: String::new(),
                    target_translations: Vec::new(),
                    part_of_speech: None,
                    definition: None,
                    example: None,
                    domain: None,
                    status: "active".to_string(),
                    metadata: BTreeMap::new(),
                });
            }
            Event::Start(element) if element.name().local_name().as_ref() == b"langSet" => {
                current_locale = element.attributes().flatten().find_map(|attribute| {
                    (attribute.key.local_name().as_ref() == b"lang")
                        .then(|| String::from_utf8_lossy(&attribute.value).into_owned())
                });
            }
            Event::Start(element) if element.name().local_name().as_ref() == b"term" => {
                current_kind = Some("term".to_string());
                text.clear();
            }
            Event::Start(element) if element.name().local_name().as_ref() == b"descrip" => {
                current_kind = element.attributes().flatten().find_map(|attribute| {
                    (attribute.key.local_name().as_ref() == b"type")
                        .then(|| String::from_utf8_lossy(&attribute.value).into_owned())
                });
                text.clear();
            }
            Event::Start(element) if element.name().local_name().as_ref() == b"termNote" => {
                current_kind = element.attributes().flatten().find_map(|attribute| {
                    (attribute.key.local_name().as_ref() == b"type")
                        .then(|| String::from_utf8_lossy(&attribute.value).into_owned())
                });
                text.clear();
            }
            Event::Text(value) if current_kind.is_some() => {
                text.push_str(&value.decode().map_err(|error| AssetError::Invalid {
                    row: entries.len() + 1,
                    message: error.to_string(),
                })?)
            }
            Event::End(element) if element.name().local_name().as_ref() == b"term" => {
                if let Some(entry) = current.as_mut() {
                    let locale = current_locale
                        .clone()
                        .unwrap_or_else(|| target_locale.to_string());
                    if locale == source_locale {
                        entry.source_term = text.trim().to_string();
                    } else {
                        entry.target_translations.push(TermExchangeTranslation {
                            locale,
                            term: text.trim().to_string(),
                            preferred: true,
                            forbidden: false,
                        });
                    }
                }
                current_kind = None;
            }
            Event::End(element) if element.name().local_name().as_ref() == b"descrip" => {
                if let Some(entry) = current.as_mut() {
                    match current_kind.as_deref() {
                        Some("definition") => entry.definition = Some(text.trim().to_string()),
                        Some("example") => entry.example = Some(text.trim().to_string()),
                        Some("domain") => entry.domain = Some(text.trim().to_string()),
                        _ => {}
                    }
                }
                current_kind = None;
            }
            Event::End(element) if element.name().local_name().as_ref() == b"termNote" => {
                if let Some(entry) = current.as_mut() {
                    match current_kind.as_deref() {
                        Some("partOfSpeech") => {
                            entry.part_of_speech = Some(text.trim().to_string())
                        }
                        Some("status") => entry.status = text.trim().to_string(),
                        Some("preferred") => {
                            if let Some(last) = entry.target_translations.last_mut() {
                                last.preferred = text.trim() != "false";
                            }
                        }
                        Some("forbidden") if text.trim() == "true" => {
                            if let Some(last) = entry.target_translations.last_mut() {
                                last.forbidden = true;
                            }
                        }
                        _ => {}
                    }
                }
                current_kind = None;
            }
            Event::End(element) if element.name().local_name().as_ref() == b"termEntry" => {
                let entry = current.take().ok_or_else(|| AssetError::Invalid {
                    row: entries.len() + 1,
                    message: "closing termEntry without opening one".to_string(),
                })?;
                if entry.source_term.is_empty() || entry.target_translations.is_empty() {
                    return Err(AssetError::Invalid {
                        row: entries.len() + 1,
                        message: "TBX entry lacks source or target term".to_string(),
                    });
                }
                entries.push(entry);
            }
            Event::Eof => break,
            _ => {}
        }
        buffer.clear();
    }
    Ok(entries)
}

pub fn write_tbx<W: Write>(output: W, entries: &[TermExchangeEntry]) -> Result<(), AssetError> {
    let mut writer = Writer::new(output);
    writer.write_event(Event::Decl(BytesDecl::new("1.0", Some("UTF-8"), None)))?;
    writer.write_event(Event::Start(BytesStart::new("martif")))?;
    writer.write_event(Event::Start(BytesStart::new("text")))?;
    writer.write_event(Event::Start(BytesStart::new("body")))?;
    for (index, entry) in entries.iter().enumerate() {
        let mut term_entry = BytesStart::new("termEntry");
        let id = format!("term-{index}");
        term_entry.push_attribute(("id", id.as_str()));
        writer.write_event(Event::Start(term_entry))?;
        write_tbx_descrip(&mut writer, "definition", entry.definition.as_deref())?;
        write_tbx_descrip(&mut writer, "example", entry.example.as_deref())?;
        write_tbx_descrip(&mut writer, "domain", entry.domain.as_deref())?;
        write_tbx_lang(
            &mut writer,
            &entry.source_locale,
            &entry.source_term,
            None,
            None,
            entry.part_of_speech.as_deref(),
            Some(entry.status.as_str()),
        )?;
        for translation in &entry.target_translations {
            write_tbx_lang(
                &mut writer,
                &translation.locale,
                &translation.term,
                Some(translation.preferred),
                Some(translation.forbidden),
                None,
                None,
            )?;
        }
        writer.write_event(Event::End(BytesEnd::new("termEntry")))?;
    }
    writer.write_event(Event::End(BytesEnd::new("body")))?;
    writer.write_event(Event::End(BytesEnd::new("text")))?;
    writer.write_event(Event::End(BytesEnd::new("martif")))?;
    Ok(())
}

fn write_tbx_descrip<W: Write>(
    writer: &mut Writer<W>,
    kind: &str,
    value: Option<&str>,
) -> Result<(), AssetError> {
    let Some(value) = value else {
        return Ok(());
    };
    let mut element = BytesStart::new("descrip");
    element.push_attribute(("type", kind));
    writer.write_event(Event::Start(element))?;
    writer.write_event(Event::Text(BytesText::new(value)))?;
    writer.write_event(Event::End(BytesEnd::new("descrip")))?;
    Ok(())
}

fn write_tbx_lang<W: Write>(
    writer: &mut Writer<W>,
    locale: &str,
    value: &str,
    preferred: Option<bool>,
    forbidden: Option<bool>,
    part_of_speech: Option<&str>,
    status: Option<&str>,
) -> Result<(), AssetError> {
    let mut lang = BytesStart::new("langSet");
    lang.push_attribute(("xml:lang", locale));
    writer.write_event(Event::Start(lang))?;
    writer.write_event(Event::Start(BytesStart::new("tig")))?;
    writer.write_event(Event::Start(BytesStart::new("term")))?;
    writer.write_event(Event::Text(BytesText::new(value)))?;
    writer.write_event(Event::End(BytesEnd::new("term")))?;
    if let Some(part_of_speech) = part_of_speech {
        write_tbx_note(writer, "partOfSpeech", part_of_speech)?;
    }
    if let Some(status) = status {
        write_tbx_note(writer, "status", status)?;
    }
    if let Some(preferred) = preferred {
        write_tbx_note(
            writer,
            "preferred",
            if preferred { "true" } else { "false" },
        )?;
    }
    if let Some(forbidden) = forbidden {
        write_tbx_note(
            writer,
            "forbidden",
            if forbidden { "true" } else { "false" },
        )?;
    }
    writer.write_event(Event::End(BytesEnd::new("tig")))?;
    writer.write_event(Event::End(BytesEnd::new("langSet")))?;
    Ok(())
}

fn write_tbx_note<W: Write>(
    writer: &mut Writer<W>,
    kind: &str,
    value: &str,
) -> Result<(), AssetError> {
    let mut note = BytesStart::new("termNote");
    note.push_attribute(("type", kind));
    writer.write_event(Event::Start(note))?;
    writer.write_event(Event::Text(BytesText::new(value)))?;
    writer.write_event(Event::End(BytesEnd::new("termNote")))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::io::Cursor;

    use super::*;

    #[test]
    fn cjk_fuzzy_matching_and_substitution_are_deterministic() {
        let result = match_score("保留期为 30 天 {name}", "保留期为 60 天 {user}");
        let unrelated = match_score("保留期为 30 天 {name}", "今天的天气很好");
        assert!(result.score >= 70);
        assert!(result.score > unrelated.score);
        assert_eq!(result.substitutions.len(), 2);
        assert_eq!(result.substitutions[0].kind, "number");
    }

    #[test]
    fn date_substitutions_and_term_boundaries_are_explicit() {
        let result = match_score(
            "Effective on 2026-07-19 for {name}",
            "Effective on 2027-08-20 for {user}",
        );
        assert_eq!(result.score, 100);
        assert_eq!(result.substitutions[0].kind, "date");
        assert_eq!(result.substitutions[1].kind, "placeholder");
        assert!(term_spans("A concatenated value", "cat").is_empty());
        assert_eq!(term_spans("A cat value and CAT.", "cat").len(), 2);
        assert_eq!(term_spans("执行器和执行器", "执行器").len(), 2);
    }

    #[test]
    fn csv_tm_round_trip_preserves_metadata() {
        let unit = TmExchangeUnit {
            source_locale: "en-US".to_string(),
            target_locale: "zh-CN".to_string(),
            source_text: "Hello, world".to_string(),
            target_text: "你好，世界".to_string(),
            domain: Some("general".to_string()),
            author: Some("tester".to_string()),
            created_at_ms: Some(42),
            metadata: BTreeMap::from([("client".to_string(), "CAT".to_string())]),
        };
        let mut bytes = Vec::new();
        write_tm_csv(&mut bytes, std::slice::from_ref(&unit)).expect("write CSV");
        let parsed = parse_tm_csv(Cursor::new(bytes), "en-US", "zh-CN").expect("parse CSV");
        assert_eq!(parsed, vec![unit.clone()]);

        let mut tsv = Vec::new();
        write_tm_tsv(&mut tsv, std::slice::from_ref(&unit)).expect("write TSV");
        assert_eq!(
            parse_tm_tsv(Cursor::new(tsv), "en-US", "zh-CN").expect("parse TSV"),
            vec![unit]
        );
    }

    #[test]
    fn tmx_and_tbx_round_trip() {
        let unit = TmExchangeUnit {
            source_locale: "en".to_string(),
            target_locale: "zh".to_string(),
            source_text: "Source".to_string(),
            target_text: "译文".to_string(),
            domain: Some("legal".to_string()),
            author: Some("translator".to_string()),
            created_at_ms: Some(42),
            metadata: BTreeMap::from([("quality".to_string(), "reviewed".to_string())]),
        };
        let mut tmx = Vec::new();
        write_tmx(&mut tmx, std::slice::from_ref(&unit)).expect("write TMX");
        assert_eq!(
            parse_tmx(Cursor::new(tmx), "en", "zh").expect("parse TMX"),
            vec![unit]
        );
        let term = TermExchangeEntry {
            source_locale: "en".to_string(),
            source_term: "actuator".to_string(),
            target_translations: vec![
                TermExchangeTranslation {
                    locale: "zh".to_string(),
                    term: "执行器".to_string(),
                    preferred: true,
                    forbidden: false,
                },
                TermExchangeTranslation {
                    locale: "zh".to_string(),
                    term: "作动器".to_string(),
                    preferred: false,
                    forbidden: true,
                },
            ],
            part_of_speech: Some("noun".to_string()),
            definition: Some("Converts energy to motion".to_string()),
            example: Some("The actuator opened the valve.".to_string()),
            domain: Some("industrial".to_string()),
            status: "deprecated".to_string(),
            metadata: BTreeMap::new(),
        };
        let mut csv_term = term.clone();
        csv_term
            .metadata
            .insert("owner".to_string(), "legal".to_string());
        let mut term_csv = Vec::new();
        write_term_csv(&mut term_csv, std::slice::from_ref(&csv_term)).expect("write term CSV");
        assert_eq!(
            parse_term_csv(Cursor::new(term_csv), "en", "zh").expect("parse term CSV"),
            vec![csv_term]
        );
        let mut tbx = Vec::new();
        write_tbx(&mut tbx, std::slice::from_ref(&term)).expect("write TBX");
        let parsed = parse_tbx(Cursor::new(tbx), "en", "zh").expect("parse TBX");
        assert_eq!(parsed, vec![term]);
    }

    #[test]
    fn malformed_csv_is_rejected_with_row() {
        let error = parse_tm_csv(Cursor::new("source,target\nhello,\n"), "en", "zh")
            .expect_err("invalid row");
        assert!(matches!(error, AssetError::Invalid { row: 2, .. }));
    }

    #[test]
    fn tm_index_recall_never_prunes_reachable_scores() {
        let mut index = TmIndex::new();
        let corpus = [
            ("close", "The retention period is 30 days."),
            ("paraphrase", "The retention period is 30 days at most."),
            ("unrelated", "Cats enjoy sleeping in warm sunlight."),
            ("cjk", "保留期为 30 天。"),
            ("cjk-close", "保留期为 60 天。"),
        ];
        for (id, text) in corpus {
            index.insert(id, text);
        }
        assert_eq!(index.len(), corpus.len());

        for min_score in [30_u8, 50, 60, 75, 90] {
            let recalled = index.recall("The retention period is 30 days.", min_score);
            for (id, text) in corpus {
                let score = match_score("The retention period is 30 days.", text).score;
                if score >= min_score {
                    assert!(
                        recalled.contains(&id.to_string()),
                        "entry {id} scores {score} but was pruned at floor {min_score}"
                    );
                }
            }
        }
    }

    #[test]
    fn tm_index_scales_without_hidden_caps() {
        let mut index = TmIndex::new();
        for value in 0..6_000 {
            index.insert(
                &format!("entry-{value}"),
                &format!("Shared clause number {value} applies to the agreement."),
            );
        }
        assert_eq!(index.len(), 6_000);
        // Every generated sentence normalizes numbers away, so all entries
        // share the same exact key and every one must be recalled.
        let recalled = index.recall("Shared clause number 42 applies to the agreement.", 90);
        assert_eq!(recalled.len(), 6_000);
    }

    #[test]
    fn tm_index_remove_and_reinsert_keep_recall_consistent() {
        let mut index = TmIndex::new();
        index.insert("a", "Delete this sentence.");
        index.insert("b", "Keep this sentence.");
        index.remove("a");
        assert_eq!(index.len(), 1);
        assert!(
            !index
                .recall("Delete this sentence.", 30)
                .contains(&"a".to_string())
        );
        index.insert("a", "Delete this sentence again.");
        assert!(
            index
                .recall("Delete this sentence again.", 60)
                .contains(&"a".to_string())
        );
    }
}

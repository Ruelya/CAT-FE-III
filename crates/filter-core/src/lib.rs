//! Format-neutral filter contracts and event validation.
//!
//! Format adapters may parse their native package however they need, but the
//! engine only consumes this stable event stream and normalized import model.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use thiserror::Error;
use translunar_domain::Segment;
pub use translunar_domain::{
    DegradationFinding, DegradationSeverity, DocumentNote, InlineTag, TagKind, TagSide,
};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct FilterDescriptor {
    pub id: String,
    pub version: String,
    pub display_name: String,
    pub extensions: Vec<String>,
    pub capabilities: FilterCapabilities,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct FilterCapabilities {
    pub import: bool,
    pub export: bool,
    pub validate: bool,
    pub inline_tags: bool,
    pub notes: bool,
    pub degradation_report: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProbeResult {
    /// A deterministic score in the inclusive range 0..=100.
    pub confidence: u8,
    pub reason: String,
}

impl ProbeResult {
    pub fn no_match(reason: impl Into<String>) -> Self {
        Self {
            confidence: 0,
            reason: reason.into(),
        }
    }

    pub fn matches(confidence: u8, reason: impl Into<String>) -> Self {
        Self {
            confidence: confidence.min(100),
            reason: reason.into(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DocumentMetadata {
    pub format: String,
    #[serde(default)]
    pub source_locale: Option<String>,
    #[serde(default)]
    pub properties: BTreeMap<String, String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ImportedUnit {
    pub ordinal: u32,
    pub structural_path: String,
    pub source_text: String,
    pub target_text: Option<String>,
    pub inline_tags: Vec<InlineTag>,
    pub notes: Vec<DocumentNote>,
}

impl ImportedUnit {
    pub fn plain(
        ordinal: u32,
        structural_path: impl Into<String>,
        source_text: impl Into<String>,
    ) -> Self {
        Self {
            ordinal,
            structural_path: structural_path.into(),
            source_text: source_text.into(),
            target_text: None,
            inline_tags: Vec::new(),
            notes: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ImportedDocument {
    pub metadata: DocumentMetadata,
    pub units: Vec<ImportedUnit>,
    pub degradation: Vec<DegradationFinding>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FilterEvent {
    StartDocument {
        metadata: DocumentMetadata,
    },
    StartUnit {
        ordinal: u32,
        structural_path: String,
    },
    Text(String),
    TargetText(String),
    InlineTag(InlineTag),
    Note(DocumentNote),
    Degradation(DegradationFinding),
    EndUnit,
    EndDocument,
}

pub type FilterEventStream = Box<dyn Iterator<Item = Result<FilterEvent, FilterError>> + Send>;

#[derive(Debug, Clone)]
pub struct ImportRequest {
    pub source: PathBuf,
}

#[derive(Debug)]
pub struct ExportRequest<'a> {
    pub source: &'a Path,
    pub output: &'a Path,
    pub segments: &'a [Segment],
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ExportReport {
    pub output_path: String,
    pub translated_segments: u32,
    pub degradation: Vec<DegradationFinding>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ValidationReport {
    pub valid: bool,
    pub findings: Vec<DegradationFinding>,
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
    #[error("no filter matched the source: {0}")]
    NoMatch(String),
    #[error("filter not found: {0}")]
    NotFound(String),
    #[error("filter registry error: {0}")]
    Registry(String),
}

pub trait DocumentFilter: Send + Sync {
    fn descriptor(&self) -> FilterDescriptor;
    fn probe(&self, source: &Path) -> Result<ProbeResult, FilterError>;
    fn import(&self, request: ImportRequest) -> Result<FilterEventStream, FilterError>;
    fn export(&self, request: ExportRequest<'_>) -> Result<ExportReport, FilterError>;
    fn validate(&self, source: &Path) -> Result<ValidationReport, FilterError>;
}

#[derive(Default)]
pub struct FilterRegistry {
    filters: BTreeMap<String, Arc<dyn DocumentFilter>>,
}

impl FilterRegistry {
    pub fn register(&mut self, filter: Arc<dyn DocumentFilter>) -> Result<(), FilterError> {
        let descriptor = filter.descriptor();
        if descriptor.id.trim().is_empty() {
            return Err(FilterError::Registry(
                "filter id must not be empty".to_string(),
            ));
        }
        if self.filters.contains_key(&descriptor.id) {
            return Err(FilterError::Registry(format!(
                "filter id already registered: {}",
                descriptor.id
            )));
        }
        self.filters.insert(descriptor.id, filter);
        Ok(())
    }

    pub fn resolve(&self, id: &str) -> Result<Arc<dyn DocumentFilter>, FilterError> {
        self.filters
            .get(id)
            .cloned()
            .ok_or_else(|| FilterError::NotFound(id.to_string()))
    }

    pub fn descriptors(&self) -> Vec<FilterDescriptor> {
        self.filters
            .values()
            .map(|filter| filter.descriptor())
            .collect()
    }

    pub fn select(
        &self,
        source: &Path,
        explicit_id: Option<&str>,
    ) -> Result<Arc<dyn DocumentFilter>, FilterError> {
        if let Some(id) = explicit_id {
            return self.resolve(id);
        }

        let mut best: Option<(u8, String, Arc<dyn DocumentFilter>)> = None;
        for (id, filter) in &self.filters {
            let probe = filter.probe(source)?;
            if probe.confidence == 0 {
                continue;
            }
            let candidate = (probe.confidence, id.clone(), Arc::clone(filter));
            let replace = best.as_ref().is_none_or(|(confidence, best_id, _)| {
                candidate.0 > *confidence || (candidate.0 == *confidence && candidate.1 < *best_id)
            });
            if replace {
                best = Some(candidate);
            }
        }
        best.map(|(_, _, filter)| filter)
            .ok_or_else(|| FilterError::NoMatch(source.display().to_string()))
    }
}

pub fn collect_imported_document(
    events: impl IntoIterator<Item = Result<FilterEvent, FilterError>>,
) -> Result<ImportedDocument, FilterError> {
    let mut iterator = events.into_iter();
    let metadata = match iterator.next().transpose()? {
        Some(FilterEvent::StartDocument { metadata }) => metadata,
        Some(other) => {
            return Err(FilterError::Invalid(format!(
                "event stream must begin with StartDocument, got {other:?}"
            )));
        }
        None => return Err(FilterError::Invalid("event stream is empty".to_string())),
    };

    let mut units = Vec::new();
    let mut degradation = Vec::new();
    let mut current: Option<ImportedUnit> = None;
    let mut ended = false;
    for event in iterator {
        let event = event?;
        if ended {
            return Err(FilterError::Invalid(
                "event found after EndDocument".to_string(),
            ));
        }
        match event {
            FilterEvent::StartDocument { .. } => {
                return Err(FilterError::Invalid(
                    "nested StartDocument event".to_string(),
                ));
            }
            FilterEvent::StartUnit {
                ordinal,
                structural_path,
            } => {
                if current.is_some() {
                    return Err(FilterError::Invalid("nested StartUnit event".to_string()));
                }
                if structural_path.trim().is_empty() {
                    return Err(FilterError::Invalid(
                        "unit structural path must not be empty".to_string(),
                    ));
                }
                current = Some(ImportedUnit {
                    ordinal,
                    structural_path,
                    source_text: String::new(),
                    target_text: None,
                    inline_tags: Vec::new(),
                    notes: Vec::new(),
                });
            }
            FilterEvent::Text(text) => current
                .as_mut()
                .ok_or_else(|| FilterError::Invalid("Text event outside a unit".to_string()))?
                .source_text
                .push_str(&text),
            FilterEvent::TargetText(text) => current
                .as_mut()
                .ok_or_else(|| FilterError::Invalid("TargetText event outside a unit".to_string()))?
                .target_text
                .get_or_insert_default()
                .push_str(&text),
            FilterEvent::InlineTag(tag) => {
                let unit = current.as_mut().ok_or_else(|| {
                    FilterError::Invalid("InlineTag event outside a unit".to_string())
                })?;
                let text_len = match tag.side {
                    TagSide::Source => unit.source_text.chars().count(),
                    TagSide::Target => unit
                        .target_text
                        .as_deref()
                        .unwrap_or_default()
                        .chars()
                        .count(),
                };
                validate_tag(&tag, text_len)?;
                if unit
                    .inline_tags
                    .iter()
                    .any(|existing| existing.id == tag.id)
                {
                    return Err(FilterError::Invalid(format!(
                        "duplicate inline tag id: {}",
                        tag.id
                    )));
                }
                unit.inline_tags.push(tag);
            }
            FilterEvent::Note(note) => current
                .as_mut()
                .ok_or_else(|| FilterError::Invalid("Note event outside a unit".to_string()))?
                .notes
                .push(note),
            FilterEvent::Degradation(finding) => {
                degradation.push(finding);
            }
            FilterEvent::EndUnit => {
                let unit = current
                    .take()
                    .ok_or_else(|| FilterError::Invalid("EndUnit without StartUnit".to_string()))?;
                if unit.source_text.trim().is_empty() {
                    return Err(FilterError::Invalid(format!(
                        "unit is empty: {}",
                        unit.structural_path
                    )));
                }
                validate_tag_pairs(&unit.inline_tags)?;
                units.push(unit);
            }
            FilterEvent::EndDocument => {
                if current.is_some() {
                    return Err(FilterError::Invalid(
                        "EndDocument while a unit is open".to_string(),
                    ));
                }
                ended = true;
            }
        }
    }
    if !ended {
        return Err(FilterError::Invalid(
            "event stream must end with EndDocument".to_string(),
        ));
    }
    Ok(ImportedDocument {
        metadata,
        units,
        degradation,
    })
}

type TagPairPositions<'a> = BTreeMap<(&'a str, TagSide), (Option<u32>, Option<u32>)>;

fn validate_tag_pairs(tags: &[InlineTag]) -> Result<(), FilterError> {
    let mut pairs = TagPairPositions::new();
    for tag in tags {
        let Some(pair_id) = tag.pair_id.as_deref() else {
            continue;
        };
        let entry = pairs.entry((pair_id, tag.side)).or_default();
        match tag.kind {
            TagKind::Start => {
                if entry.0.replace(tag.position).is_some() {
                    return Err(FilterError::Invalid(format!(
                        "duplicate start tag for pair {pair_id}"
                    )));
                }
            }
            TagKind::End => {
                if entry.1.replace(tag.position).is_some() {
                    return Err(FilterError::Invalid(format!(
                        "duplicate end tag for pair {pair_id}"
                    )));
                }
            }
            TagKind::Standalone => {}
        }
    }
    for ((pair_id, _), (start, end)) in pairs {
        match (start, end) {
            (Some(start), Some(end)) if start <= end => {}
            (Some(_), Some(_)) => {
                return Err(FilterError::Invalid(format!(
                    "tag pair is reversed: {pair_id}"
                )));
            }
            _ => {
                return Err(FilterError::Invalid(format!(
                    "tag pair is incomplete: {pair_id}"
                )));
            }
        }
    }
    Ok(())
}

fn validate_tag(tag: &InlineTag, text_len: usize) -> Result<(), FilterError> {
    if tag.id.trim().is_empty() || tag.payload.is_empty() {
        return Err(FilterError::Invalid(
            "inline tag id and payload are required".to_string(),
        ));
    }
    if usize::try_from(tag.position).map_or(true, |position| position > text_len) {
        return Err(FilterError::Invalid(format!(
            "inline tag position is outside the unit: {}",
            tag.id
        )));
    }
    match tag.kind {
        TagKind::Standalone => {
            if tag.pair_id.is_some() {
                return Err(FilterError::Invalid(format!(
                    "standalone tag cannot have a pair id: {}",
                    tag.id
                )));
            }
        }
        TagKind::Start | TagKind::End => {
            if tag.pair_id.as_deref().is_none_or(str::is_empty) {
                return Err(FilterError::Invalid(format!(
                    "paired tag is missing pair id: {}",
                    tag.id
                )));
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn metadata() -> DocumentMetadata {
        DocumentMetadata {
            format: "test".to_string(),
            source_locale: Some("en-US".to_string()),
            properties: BTreeMap::new(),
        }
    }

    fn tag(id: &str) -> InlineTag {
        InlineTag {
            id: id.to_string(),
            side: TagSide::Source,
            position: 0,
            kind: TagKind::Standalone,
            pair_id: None,
            payload: "opaque".to_string(),
            display_text: "<b>".to_string(),
            protected: true,
        }
    }

    #[test]
    fn collects_metadata_tags_notes_and_degradation() {
        let document = collect_imported_document([
            Ok(FilterEvent::StartDocument {
                metadata: metadata(),
            }),
            Ok(FilterEvent::StartUnit {
                ordinal: 0,
                structural_path: "p:0".to_string(),
            }),
            Ok(FilterEvent::Text("Hello".to_string())),
            Ok(FilterEvent::InlineTag(tag("t1"))),
            Ok(FilterEvent::Note(DocumentNote {
                id: "n1".to_string(),
                text: "review".to_string(),
                author: None,
            })),
            Ok(FilterEvent::EndUnit),
            Ok(FilterEvent::Degradation(DegradationFinding {
                code: "layout".to_string(),
                severity: DegradationSeverity::Warning,
                message: "simplified".to_string(),
                structural_path: None,
            })),
            Ok(FilterEvent::EndDocument),
        ])
        .expect("valid stream");
        assert_eq!(document.units[0].inline_tags.len(), 1);
        assert_eq!(document.units[0].notes.len(), 1);
        assert_eq!(document.degradation.len(), 1);
    }

    #[test]
    fn rejects_incomplete_and_invalid_tag_streams() {
        let error = collect_imported_document([
            Ok(FilterEvent::StartDocument {
                metadata: metadata(),
            }),
            Ok(FilterEvent::StartUnit {
                ordinal: 0,
                structural_path: "p:0".to_string(),
            }),
            Ok(FilterEvent::InlineTag(InlineTag {
                position: 99,
                ..tag("t1")
            })),
        ])
        .expect_err("invalid stream");
        assert!(error.to_string().contains("position"));
    }

    struct ProbeOnly {
        id: &'static str,
        score: u8,
    }

    impl DocumentFilter for ProbeOnly {
        fn descriptor(&self) -> FilterDescriptor {
            FilterDescriptor {
                id: self.id.to_string(),
                version: "1".to_string(),
                display_name: self.id.to_string(),
                extensions: vec!["x".to_string()],
                capabilities: FilterCapabilities {
                    import: true,
                    export: false,
                    validate: false,
                    inline_tags: false,
                    notes: false,
                    degradation_report: false,
                },
            }
        }

        fn probe(&self, _source: &Path) -> Result<ProbeResult, FilterError> {
            Ok(ProbeResult::matches(self.score, "test"))
        }

        fn import(&self, _request: ImportRequest) -> Result<FilterEventStream, FilterError> {
            Ok(Box::new(std::iter::empty()))
        }

        fn export(&self, _request: ExportRequest<'_>) -> Result<ExportReport, FilterError> {
            Err(FilterError::Unsupported("test".to_string()))
        }

        fn validate(&self, _source: &Path) -> Result<ValidationReport, FilterError> {
            Ok(ValidationReport {
                valid: true,
                findings: Vec::new(),
            })
        }
    }

    #[test]
    fn registry_selects_highest_score_and_rejects_duplicates() {
        let mut registry = FilterRegistry::default();
        registry
            .register(Arc::new(ProbeOnly { id: "a", score: 50 }))
            .expect("register a");
        registry
            .register(Arc::new(ProbeOnly { id: "b", score: 80 }))
            .expect("register b");
        let selected = registry
            .select(Path::new("source.x"), None)
            .expect("select filter");
        assert_eq!(selected.descriptor().id, "b");
        let duplicate = registry.register(Arc::new(ProbeOnly { id: "b", score: 1 }));
        assert!(matches!(duplicate, Err(FilterError::Registry(_))));
    }
}

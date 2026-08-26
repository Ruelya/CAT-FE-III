//! Import-side segmentation: turn filter units into grid segments.

use std::collections::BTreeMap;

use tl_domain::{Segment, SegmentState, new_id, segment_hashes, state_for_target};
use tl_filter_core::ImportedDocument;
use tl_segmentation::{SegmentationMode, SrxRules};

pub struct PreparedSegments {
    pub segments: Vec<Segment>,
    /// Raw text preceding each segment inside its unit, keyed by segment id.
    pub leading: BTreeMap<String, String>,
}

struct Piece {
    structural_path: String,
    leading: String,
    source_text: String,
    target_text: Option<String>,
}

/// Split plain-text units into SRX sentences; keep units that carry inline
/// tags or a pre-existing target as single segments so alignment survives.
pub fn build_segments(
    document_id: &str,
    imported: &ImportedDocument,
    source_locale: &str,
    rules: &SrxRules,
    mode: SegmentationMode,
    now_ms: i64,
) -> PreparedSegments {
    let mut pieces = Vec::new();
    for unit in &imported.units {
        let splittable = unit.inline_tags.is_empty() && unit.target_text.is_none();
        if !splittable {
            pieces.push(Piece {
                structural_path: unit.structural_path.clone(),
                leading: String::new(),
                source_text: unit.source_text.clone(),
                target_text: unit.target_text.clone(),
            });
            continue;
        }
        let ranges = rules.ranges(&unit.source_text, source_locale, mode);
        if ranges.is_empty() {
            pieces.push(Piece {
                structural_path: unit.structural_path.clone(),
                leading: String::new(),
                source_text: unit.source_text.clone(),
                target_text: None,
            });
            continue;
        }
        // SRX ranges are contiguous, so inter-sentence whitespace lives at the
        // edges of each range. Trim it out of the segment and keep it as the
        // next segment's leading text so export can reassemble the paragraph.
        let mut previous_core_end = 0usize;
        for range in ranges {
            let raw = &unit.source_text[range.clone()];
            let core = raw.trim();
            if core.is_empty() {
                continue;
            }
            let leading_whitespace = raw.len() - raw.trim_start().len();
            let core_start = range.start + leading_whitespace;
            let core_end = core_start + core.len();
            let leading = unit.source_text[previous_core_end..core_start].to_string();
            previous_core_end = core_end;
            pieces.push(Piece {
                structural_path: unit.structural_path.clone(),
                leading,
                source_text: core.to_string(),
                target_text: None,
            });
        }
    }

    let mut segments = Vec::with_capacity(pieces.len());
    let mut leading = BTreeMap::new();
    for (index, piece) in pieces.iter().enumerate() {
        let previous = index.checked_sub(1).map(|i| pieces[i].source_text.as_str());
        let next = pieces.get(index + 1).map(|p| p.source_text.as_str());
        let (source_hash, context_hash) = segment_hashes(&piece.source_text, previous, next);
        let target_text = piece.target_text.clone().unwrap_or_default();
        let state = if target_text.trim().is_empty() {
            SegmentState::Untranslated
        } else {
            state_for_target(&target_text)
        };
        let id = new_id();
        if !piece.leading.is_empty() {
            leading.insert(id.clone(), piece.leading.clone());
        }
        segments.push(Segment {
            id,
            document_id: document_id.to_string(),
            ordinal: u32::try_from(index).unwrap_or(u32::MAX),
            structural_path: piece.structural_path.clone(),
            source_text: piece.source_text.clone(),
            target_text,
            state,
            revision: 1,
            source_hash,
            context_hash,
            updated_at_ms: now_ms,
            // Freshly imported rows have no origin; a bilingual import's
            // pre-filled target is upstream material, not a TM/AI stamp.
            origin: None,
        });
    }
    PreparedSegments { segments, leading }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use tl_filter_core::{DocumentMetadata, ImportedDocument, ImportedUnit};

    use super::*;

    fn imported(units: Vec<ImportedUnit>) -> ImportedDocument {
        ImportedDocument {
            metadata: DocumentMetadata {
                format: "test".to_string(),
                source_locale: Some("en-US".to_string()),
                properties: BTreeMap::new(),
            },
            units,
            degradation: Vec::new(),
        }
    }

    fn build(document: &ImportedDocument) -> PreparedSegments {
        build_segments(
            "d1",
            document,
            "en-US",
            &SrxRules::builtin("en-US"),
            SegmentationMode::Sentence,
            1,
        )
    }

    #[test]
    fn splits_plain_paragraphs_into_sentences() {
        let document = imported(vec![ImportedUnit::plain(
            0,
            "word/document.xml#p:0",
            "First sentence. Second sentence.",
        )]);
        let prepared = build(&document);
        assert_eq!(prepared.segments.len(), 2);
        assert_eq!(prepared.segments[0].source_text, "First sentence.");
        assert_eq!(prepared.segments[1].source_text, "Second sentence.");
        // The gap between sentences is preserved for export reassembly.
        assert_eq!(prepared.leading[&prepared.segments[1].id], " ".to_string());
        assert_eq!(
            prepared.segments[0].structural_path,
            prepared.segments[1].structural_path
        );
    }

    #[test]
    fn keeps_tagged_units_whole() {
        let mut unit = ImportedUnit::plain(0, "p:0", "Bold start. Plain end.");
        unit.inline_tags.push(tl_domain::InlineTag {
            id: "t1".to_string(),
            side: tl_domain::TagSide::Source,
            position: 0,
            kind: tl_domain::TagKind::Standalone,
            pair_id: None,
            payload: "opaque".to_string(),
            display_text: "<b>".to_string(),
            protected: true,
        });
        let prepared = build(&imported(vec![unit]));
        assert_eq!(prepared.segments.len(), 1);
        assert_eq!(prepared.segments[0].source_text, "Bold start. Plain end.");
    }

    #[test]
    fn context_hashes_differ_between_positions() {
        let document = imported(vec![ImportedUnit::plain(
            0,
            "p:0",
            "Same text. Same text. Other tail.",
        )]);
        let prepared = build(&document);
        assert_eq!(prepared.segments.len(), 3);
        assert_eq!(
            prepared.segments[0].source_hash,
            prepared.segments[1].source_hash
        );
        assert_ne!(
            prepared.segments[0].context_hash,
            prepared.segments[1].context_hash
        );
    }
}

//! Export-side merging: reassemble filter units from grid segments.

use std::collections::BTreeMap;

use tl_domain::Segment;

/// Merge sentence segments back into one segment per structural path.
///
/// A path where every segment is still untranslated is dropped entirely so the
/// filter keeps the original unit untouched. In a partially translated path,
/// untranslated sentences fall back to their source text.
pub fn merge_for_export(segments: &[Segment], leading: &BTreeMap<String, String>) -> Vec<Segment> {
    let mut merged: Vec<Segment> = Vec::new();
    let mut groups: Vec<(String, Vec<&Segment>)> = Vec::new();
    for segment in segments {
        match groups.last_mut() {
            Some((path, members)) if *path == segment.structural_path => members.push(segment),
            _ => groups.push((segment.structural_path.clone(), vec![segment])),
        }
    }
    for (path, members) in groups {
        let any_translated = members
            .iter()
            .any(|segment| !segment.target_text.trim().is_empty());
        if !any_translated {
            continue;
        }
        let mut source_text = String::new();
        let mut target_text = String::new();
        for segment in &members {
            let gap = leading.get(&segment.id).map(String::as_str).unwrap_or("");
            source_text.push_str(gap);
            source_text.push_str(&segment.source_text);
            target_text.push_str(gap);
            if segment.target_text.trim().is_empty() {
                target_text.push_str(&segment.source_text);
            } else {
                target_text.push_str(&segment.target_text);
            }
        }
        let first = members[0];
        merged.push(Segment {
            id: first.id.clone(),
            document_id: first.document_id.clone(),
            ordinal: first.ordinal,
            structural_path: path,
            source_text,
            target_text,
            state: first.state,
            revision: first.revision,
            source_hash: first.source_hash.clone(),
            context_hash: first.context_hash.clone(),
            updated_at_ms: first.updated_at_ms,
            origin: first.origin.clone(),
        });
    }
    merged
}

#[cfg(test)]
mod tests {
    use tl_domain::SegmentState;

    use super::*;

    fn segment(id: &str, path: &str, ordinal: u32, source: &str, target: &str) -> Segment {
        Segment {
            id: id.to_string(),
            document_id: "d1".to_string(),
            ordinal,
            structural_path: path.to_string(),
            source_text: source.to_string(),
            target_text: target.to_string(),
            state: if target.is_empty() {
                SegmentState::Untranslated
            } else {
                SegmentState::Draft
            },
            revision: 1,
            source_hash: String::new(),
            context_hash: String::new(),
            updated_at_ms: 1,
            origin: None,
        }
    }

    #[test]
    fn merges_sentences_and_keeps_gaps() {
        let segments = vec![
            segment("s1", "p:0", 0, "First.", "第一。"),
            segment("s2", "p:0", 1, "Second.", "第二。"),
            segment("s3", "p:1", 2, "Alone.", ""),
        ];
        let leading = BTreeMap::from([("s2".to_string(), " ".to_string())]);
        let merged = merge_for_export(&segments, &leading);
        assert_eq!(merged.len(), 1, "untranslated paragraph is skipped");
        assert_eq!(merged[0].structural_path, "p:0");
        assert_eq!(merged[0].target_text, "第一。 第二。");
    }

    #[test]
    fn partially_translated_paragraph_falls_back_to_source() {
        let segments = vec![
            segment("s1", "p:0", 0, "First.", ""),
            segment("s2", "p:0", 1, "Second.", "第二。"),
        ];
        let leading = BTreeMap::from([("s2".to_string(), " ".to_string())]);
        let merged = merge_for_export(&segments, &leading);
        assert_eq!(merged[0].target_text, "First. 第二。");
    }
}

//! UTF-8 TXT and source-preserving Markdown filters.

use std::collections::BTreeMap;
use std::fs;
use std::ops::Range;
use std::path::Path;

use thiserror::Error;
use translunar_domain::{InlineTag, TagKind, TagSide};
use translunar_filter_core::{
    DocumentFilter, DocumentMetadata, ExportReport, ExportRequest, FilterCapabilities,
    FilterDescriptor, FilterError, FilterEvent, FilterEventStream, ImportRequest, ProbeResult,
    ValidationReport, publish_bytes_noclobber,
};
use translunar_segmentation_srx::{SegmentationMode, SrxError, SrxRules};

const MAX_INPUT_BYTES: u64 = 32 * 1024 * 1024;

#[derive(Debug, Error)]
enum TextError {
    #[error("input exceeds the 32 MiB filter limit")]
    TooLarge,
    #[error("text is not valid UTF-8 at byte {0}")]
    Utf8(usize),
    #[error("invalid source range: {0}")]
    Range(String),
    #[error("SRX failed: {0}")]
    Srx(#[from] SrxError),
    #[error("I/O failed: {0}")]
    Io(#[from] std::io::Error),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TextKind {
    Txt,
    Markdown,
}

impl TextKind {
    fn format(self) -> &'static str {
        match self {
            Self::Txt => "txt",
            Self::Markdown => "markdown",
        }
    }

    fn id(self) -> &'static str {
        match self {
            Self::Txt => "builtin.txt",
            Self::Markdown => "builtin.markdown",
        }
    }
}

#[derive(Debug, Clone)]
struct SourceSpan {
    range: Range<usize>,
    protected_before: Option<Range<usize>>,
    protected_after: Option<Range<usize>>,
}

#[derive(Debug, Clone, Copy)]
pub struct TxtFilter;

#[derive(Debug, Clone, Copy)]
pub struct MarkdownFilter;

impl TxtFilter {
    pub fn new() -> Self {
        Self
    }
}

impl MarkdownFilter {
    pub fn new() -> Self {
        Self
    }
}

impl Default for TxtFilter {
    fn default() -> Self {
        Self::new()
    }
}

impl Default for MarkdownFilter {
    fn default() -> Self {
        Self::new()
    }
}

impl DocumentFilter for TxtFilter {
    fn descriptor(&self) -> FilterDescriptor {
        descriptor(TextKind::Txt)
    }

    fn probe(&self, source: &Path) -> Result<ProbeResult, FilterError> {
        probe_extension(source, &["txt"], "UTF-8 text")
    }

    fn import(&self, request: ImportRequest) -> Result<FilterEventStream, FilterError> {
        import_text(TextKind::Txt, &request)
    }

    fn export(&self, request: ExportRequest<'_>) -> Result<ExportReport, FilterError> {
        export_text(TextKind::Txt, request)
    }

    fn validate(&self, source: &Path) -> Result<ValidationReport, FilterError> {
        validate_text(TextKind::Txt, source)
    }
}

impl DocumentFilter for MarkdownFilter {
    fn descriptor(&self) -> FilterDescriptor {
        descriptor(TextKind::Markdown)
    }

    fn probe(&self, source: &Path) -> Result<ProbeResult, FilterError> {
        probe_extension(source, &["md", "markdown", "mdown", "mkdn"], "Markdown")
    }

    fn import(&self, request: ImportRequest) -> Result<FilterEventStream, FilterError> {
        import_text(TextKind::Markdown, &request)
    }

    fn export(&self, request: ExportRequest<'_>) -> Result<ExportReport, FilterError> {
        export_text(TextKind::Markdown, request)
    }

    fn validate(&self, source: &Path) -> Result<ValidationReport, FilterError> {
        validate_text(TextKind::Markdown, source)
    }
}

fn descriptor(kind: TextKind) -> FilterDescriptor {
    FilterDescriptor {
        id: kind.id().to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        display_name: match kind {
            TextKind::Txt => "UTF-8 plain text".to_string(),
            TextKind::Markdown => "Markdown".to_string(),
        },
        extensions: match kind {
            TextKind::Txt => vec!["txt".to_string()],
            TextKind::Markdown => vec![
                "md".to_string(),
                "markdown".to_string(),
                "mdown".to_string(),
                "mkdn".to_string(),
            ],
        },
        capabilities: FilterCapabilities {
            import: true,
            export: true,
            validate: true,
            inline_tags: kind == TextKind::Markdown,
            notes: false,
            degradation_report: false,
        },
    }
}

fn probe_extension(
    source: &Path,
    extensions: &[&str],
    description: &str,
) -> Result<ProbeResult, FilterError> {
    let extension_matches = source
        .extension()
        .and_then(|value| value.to_str())
        .is_some_and(|value| {
            extensions
                .iter()
                .any(|item| value.eq_ignore_ascii_case(item))
        });
    if extension_matches {
        Ok(ProbeResult::matches(90, format!("{description} extension")))
    } else {
        Ok(ProbeResult::no_match(format!(
            "file extension is not {description}"
        )))
    }
}

fn import_text(kind: TextKind, request: &ImportRequest) -> Result<FilterEventStream, FilterError> {
    let bytes = read_bounded(&request.source).map_err(map_error)?;
    let (text, content_offset) = decode_utf8(&bytes).map_err(map_error)?;
    let locale = request
        .source_locale
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("en");
    let id_prefix = request.document_id.as_deref().unwrap_or("unmanaged");
    let rules = rules_from_options(request).map_err(map_error)?;
    let mode = SegmentationMode::parse(request.options.get("segmentationMode").map(String::as_str));
    let mut properties = BTreeMap::new();
    properties.insert("bom".to_string(), (content_offset == 3).to_string());
    properties.insert("newline".to_string(), newline_style(text));
    properties.insert(
        "segmentation".to_string(),
        match mode {
            SegmentationMode::Paragraph => "paragraph",
            SegmentationMode::Sentence => "sentence",
        }
        .to_string(),
    );
    let spans = match kind {
        TextKind::Txt => txt_spans(text, content_offset, &rules, locale, mode),
        TextKind::Markdown => {
            markdown_spans(text, content_offset, &rules, locale, mode).map_err(map_error)?
        }
    };
    if spans.is_empty() {
        return Err(FilterError::Invalid(
            "document contains no translatable text".to_string(),
        ));
    }
    let mut events = Vec::with_capacity(spans.len() * 4 + 2);
    events.push(Ok(FilterEvent::StartDocument {
        metadata: DocumentMetadata {
            format: kind.format().to_string(),
            source_locale: request.source_locale.clone(),
            properties,
        },
    }));
    for (ordinal, span) in spans.into_iter().enumerate() {
        let source_range = span.range.clone();
        let local_range =
            (source_range.start - content_offset)..(source_range.end - content_offset);
        let source_text = bytes_to_text(text, local_range)?;
        let path = format!(
            "{}:byte:{}-{}",
            kind.format(),
            source_range.start,
            source_range.end
        );
        events.push(Ok(FilterEvent::StartUnit {
            ordinal: u32::try_from(ordinal)
                .map_err(|_| FilterError::Invalid("unit count exceeds u32".to_string()))?,
            structural_path: path,
        }));
        events.push(Ok(FilterEvent::Text(source_text.to_string())));
        if kind == TextKind::Markdown {
            if let Some(range) = span.protected_before {
                events.push(Ok(FilterEvent::InlineTag(markdown_tag(
                    bytes_to_text(text, range.clone())?,
                    id_prefix,
                    ordinal,
                    0,
                ))));
            }
            if let Some(range) = span.protected_after {
                let position = u32::try_from(source_text.chars().count()).map_err(|_| {
                    FilterError::Invalid("Markdown unit exceeds u32 character count".to_string())
                })?;
                events.push(Ok(FilterEvent::InlineTag(markdown_tag(
                    bytes_to_text(text, range.clone())?,
                    id_prefix,
                    ordinal,
                    position,
                ))));
            }
        }
        events.push(Ok(FilterEvent::EndUnit));
    }
    events.push(Ok(FilterEvent::EndDocument));
    Ok(Box::new(events.into_iter()))
}

fn export_text(kind: TextKind, request: ExportRequest<'_>) -> Result<ExportReport, FilterError> {
    let bytes = read_bounded(request.source).map_err(map_error)?;
    let _ = decode_utf8(&bytes).map_err(map_error)?;
    let mut replacements = Vec::new();
    for segment in request.segments {
        if segment.target_text.trim().is_empty() {
            continue;
        }
        let (format, range) = parse_path(&segment.structural_path).map_err(map_error)?;
        if format != kind.format() {
            return Err(FilterError::Invalid(format!(
                "{} filter cannot export structural path {}",
                kind.format(),
                segment.structural_path
            )));
        }
        if range.end > bytes.len() || range.start >= range.end {
            return Err(FilterError::Invalid(format!(
                "structural path range is outside source: {}",
                segment.structural_path
            )));
        }
        if !std::str::from_utf8(&bytes[range.clone()])
            .map_err(|error| FilterError::Invalid(error.to_string()))?
            .is_char_boundary(0)
        {
            return Err(FilterError::Invalid(
                "range is not UTF-8 aligned".to_string(),
            ));
        }
        replacements.push((range, segment.target_text.as_bytes().to_vec()));
    }
    replacements.sort_by_key(|item| std::cmp::Reverse(item.0.start));
    for pair in replacements.windows(2) {
        if pair[0].0.start < pair[1].0.end {
            return Err(FilterError::Invalid(
                "overlapping translated ranges".to_string(),
            ));
        }
    }
    let mut output = bytes;
    let translated_segments = u32::try_from(replacements.len())
        .map_err(|_| FilterError::Invalid("translation count exceeds u32".to_string()))?;
    for (range, replacement) in replacements {
        output.splice(range, replacement);
    }
    publish_bytes_noclobber(request.output, &output)?;
    Ok(ExportReport {
        output_path: request.output.display().to_string(),
        translated_segments,
        degradation: Vec::new(),
    })
}

fn validate_text(kind: TextKind, source: &Path) -> Result<ValidationReport, FilterError> {
    let bytes = read_bounded(source).map_err(map_error)?;
    let (text, offset) = decode_utf8(&bytes).map_err(map_error)?;
    if kind == TextKind::Markdown {
        let _ = markdown_spans(
            text,
            offset,
            &SrxRules::builtin("en"),
            "en",
            SegmentationMode::Paragraph,
        )
        .map_err(map_error)?;
    }
    Ok(ValidationReport {
        valid: true,
        findings: Vec::new(),
    })
}

fn txt_spans(
    text: &str,
    content_offset: usize,
    rules: &SrxRules,
    locale: &str,
    mode: SegmentationMode,
) -> Vec<SourceSpan> {
    let mut spans = Vec::new();
    for paragraph in rules.ranges(text, locale, SegmentationMode::Paragraph) {
        let Some(content) = trim_range(text, paragraph) else {
            continue;
        };
        let ranges = if mode == SegmentationMode::Paragraph {
            vec![content]
        } else {
            rules
                .ranges(&text[content.clone()], locale, mode)
                .into_iter()
                .filter_map(|range| {
                    trim_range(
                        text,
                        (content.start + range.start)..(content.start + range.end),
                    )
                })
                .collect()
        };
        spans.extend(ranges.into_iter().map(|range| SourceSpan {
            range: (content_offset + range.start)..(content_offset + range.end),
            protected_before: None,
            protected_after: None,
        }));
    }
    spans
}

fn markdown_spans(
    text: &str,
    content_offset: usize,
    rules: &SrxRules,
    locale: &str,
    mode: SegmentationMode,
) -> Result<Vec<SourceSpan>, TextError> {
    let mut protected = vec![false; text.len()];
    protect_markdown_ranges(text, &mut protected)?;
    let mut spans = Vec::new();
    let mut start = None;
    for index in 0..text.len() {
        if protected[index] {
            if let Some(range_start) = start.take() {
                spans.extend(markdown_subspans(
                    text,
                    content_offset,
                    range_start..index,
                    rules,
                    locale,
                    mode,
                    &protected,
                ));
            }
        } else if start.is_none() {
            start = Some(index);
        }
    }
    if let Some(range_start) = start {
        spans.extend(markdown_subspans(
            text,
            content_offset,
            range_start..text.len(),
            rules,
            locale,
            mode,
            &protected,
        ));
    }
    Ok(spans)
}

fn markdown_subspans(
    text: &str,
    content_offset: usize,
    range: Range<usize>,
    rules: &SrxRules,
    locale: &str,
    mode: SegmentationMode,
    protected: &[bool],
) -> Vec<SourceSpan> {
    let Some(range) = trim_range(text, range) else {
        return Vec::new();
    };
    let subranges = if mode == SegmentationMode::Paragraph {
        vec![range.clone()]
    } else {
        rules
            .ranges(&text[range.clone()], locale, mode)
            .into_iter()
            .filter_map(|subrange| {
                trim_range(
                    text,
                    (range.start + subrange.start)..(range.start + subrange.end),
                )
            })
            .collect()
    };
    subranges
        .into_iter()
        .map(|subrange| {
            let before = adjacent_protected(protected, subrange.start, true);
            let after = adjacent_protected(protected, subrange.end, false);
            SourceSpan {
                range: (content_offset + subrange.start)..(content_offset + subrange.end),
                protected_before: before,
                protected_after: after,
            }
        })
        .collect()
}

fn protect_markdown_ranges(text: &str, protected: &mut [bool]) -> Result<(), TextError> {
    let bytes = text.as_bytes();
    let mut line_start = 0;
    let mut fenced = None::<u8>;
    while line_start < bytes.len() {
        let line_end = bytes[line_start..]
            .iter()
            .position(|value| *value == b'\n')
            .map_or(bytes.len(), |offset| line_start + offset + 1);
        let line = &text[line_start..line_end];
        let trimmed = line.trim_start();
        let fence = if trimmed.starts_with("```") {
            Some(b'`')
        } else if trimmed.starts_with("~~~") {
            Some(b'~')
        } else {
            None
        };
        if let Some(marker) = fenced {
            mark(protected, line_start..line_end);
            if fence == Some(marker) {
                fenced = None;
            }
            line_start = line_end;
            continue;
        }
        if fence.is_some() {
            mark(protected, line_start..line_end);
            fenced = fence;
            line_start = line_end;
            continue;
        }
        if (trimmed.starts_with('<') && trimmed.contains('>')) || trimmed.starts_with("    ") {
            mark(protected, line_start..line_end);
        }
        // Prefix syntax is not editable text. Keep indentation/line endings
        // in the original file rather than emitting whitespace-only units.
        let prefix_len = line.len() - trimmed.len();
        mark(protected, line_start..(line_start + prefix_len));
        let mut syntax_end = prefix_len;
        while syntax_end < line.len() {
            let remaining = &line[syntax_end..];
            let is_prefix = remaining.starts_with("# ")
                || remaining.starts_with("> ")
                || remaining.starts_with("- ")
                || remaining.starts_with("* ")
                || remaining.starts_with("+ ")
                || remaining
                    .chars()
                    .next()
                    .is_some_and(|value| value.is_ascii_digit())
                    && remaining.contains(". ");
            if !is_prefix {
                break;
            }
            let amount = if remaining.starts_with("# ")
                || remaining.starts_with("> ")
                || remaining.starts_with("- ")
                || remaining.starts_with("* ")
                || remaining.starts_with("+ ")
            {
                2
            } else {
                remaining.find(". ").map_or(0, |value| value + 2)
            };
            if amount == 0 {
                break;
            }
            mark(
                protected,
                (line_start + syntax_end)..(line_start + syntax_end + amount),
            );
            syntax_end += amount;
        }
        line_start = line_end;
    }

    // Inline code spans and link/image destinations.
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'`' {
            let run_start = index;
            while index < bytes.len() && bytes[index] == b'`' {
                index += 1;
            }
            let run_len = index - run_start;
            let needle = vec![b'`'; run_len];
            if let Some(relative) = bytes[index..]
                .windows(run_len)
                .position(|window| window == needle.as_slice())
            {
                let end = index + relative + run_len;
                mark(protected, run_start..end);
                index = end;
            }
        } else if bytes[index] == b']' && bytes.get(index + 1) == Some(&b'(') {
            let destination_start = index + 1;
            let end = bytes[destination_start..]
                .iter()
                .position(|value| *value == b')')
                .map_or(bytes.len(), |offset| destination_start + offset + 1);
            mark(protected, index..end);
            index = end;
        } else if matches!(
            bytes[index],
            b'\n' | b'\r' | b'*' | b'_' | b'~' | b'[' | b']' | b'!'
        ) {
            mark(protected, index..index + 1);
            index += 1;
        } else {
            index += 1;
        }
    }
    Ok(())
}

fn adjacent_protected(protected: &[bool], position: usize, before: bool) -> Option<Range<usize>> {
    if (before && position == 0) || (!before && position >= protected.len()) {
        return None;
    }
    let mut start = position;
    let mut end = position;
    if before {
        if !protected[position - 1] {
            return None;
        }
        start = position - 1;
        while start > 0 && protected[start - 1] {
            start -= 1;
        }
    } else {
        if !protected[position] {
            return None;
        }
        end = position + 1;
        while end < protected.len() && protected[end] {
            end += 1;
        }
    }
    let range = start..end;
    if range.len() > 256 { None } else { Some(range) }
}

fn markdown_tag(payload: &str, id_prefix: &str, ordinal: usize, position: u32) -> InlineTag {
    InlineTag {
        id: format!("{id_prefix}-md-tag-{ordinal}-{position}"),
        side: TagSide::Source,
        position,
        kind: TagKind::Standalone,
        pair_id: None,
        payload: payload.to_string(),
        display_text: "<md>".to_string(),
        protected: true,
    }
}

fn mark(mask: &mut [bool], range: Range<usize>) {
    let end = range.end.min(mask.len());
    for value in &mut mask[range.start.min(end)..end] {
        *value = true;
    }
}

fn trim_range(text: &str, range: Range<usize>) -> Option<Range<usize>> {
    if range.start >= range.end || range.end > text.len() {
        return None;
    }
    let mut start = range.start;
    let mut end = range.end;
    while start < end {
        let character = text[start..end].chars().next()?;
        if !character.is_whitespace() {
            break;
        }
        start += character.len_utf8();
    }
    while end > start {
        let character = text[..end].chars().next_back()?;
        if !character.is_whitespace() {
            break;
        }
        end -= character.len_utf8();
    }
    (start < end).then_some(start..end)
}

fn parse_path(path: &str) -> Result<(&str, Range<usize>), TextError> {
    let (format, range) = path
        .split_once(":byte:")
        .ok_or_else(|| TextError::Range(path.to_string()))?;
    let (start, end) = range
        .split_once('-')
        .ok_or_else(|| TextError::Range(path.to_string()))?;
    let start = start
        .parse::<usize>()
        .map_err(|_| TextError::Range(path.to_string()))?;
    let end = end
        .parse::<usize>()
        .map_err(|_| TextError::Range(path.to_string()))?;
    Ok((format, start..end))
}

fn read_bounded(path: &Path) -> Result<Vec<u8>, TextError> {
    let metadata = fs::metadata(path)?;
    if metadata.len() > MAX_INPUT_BYTES {
        return Err(TextError::TooLarge);
    }
    Ok(fs::read(path)?)
}

fn decode_utf8(bytes: &[u8]) -> Result<(&str, usize), TextError> {
    let offset = usize::from(bytes.starts_with(&[0xef, 0xbb, 0xbf])) * 3;
    let content = std::str::from_utf8(&bytes[offset..])
        .map_err(|error| TextError::Utf8(error.valid_up_to() + offset))?;
    Ok((content, offset))
}

fn bytes_to_text(text: &str, range: Range<usize>) -> Result<&str, FilterError> {
    text.get(range)
        .ok_or_else(|| FilterError::Invalid("source range is not UTF-8 aligned".to_string()))
}

fn newline_style(text: &str) -> String {
    if text.contains("\r\n") {
        "crlf".to_string()
    } else if text.contains('\n') {
        "lf".to_string()
    } else if text.contains('\r') {
        "cr".to_string()
    } else {
        "none".to_string()
    }
}

fn rules_from_options(request: &ImportRequest) -> Result<SrxRules, TextError> {
    if let Some(path) = request.options.get("srxPath") {
        let metadata = fs::metadata(path)?;
        if metadata.len() > 2 * 1024 * 1024 {
            return Err(TextError::TooLarge);
        }
        let xml = fs::read_to_string(path)?;
        SrxRules::parse(&xml).map_err(TextError::Srx)
    } else {
        Ok(SrxRules::builtin(
            request.source_locale.as_deref().unwrap_or("en"),
        ))
    }
}

fn map_error(error: TextError) -> FilterError {
    match error {
        TextError::Io(error) => FilterError::Io(error),
        TextError::Srx(error) => FilterError::Invalid(error.to_string()),
        TextError::Utf8(offset) => FilterError::Invalid(format!("invalid UTF-8 at byte {offset}")),
        TextError::TooLarge => {
            FilterError::Invalid("document exceeds filter size limit".to_string())
        }
        TextError::Range(message) => FilterError::Invalid(message),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use translunar_domain::{Segment, SegmentState};

    fn import_units(
        filter: &dyn DocumentFilter,
        source: &Path,
        locale: &str,
    ) -> Vec<translunar_filter_core::ImportedUnit> {
        let stream = filter
            .import(ImportRequest {
                source: source.to_path_buf(),
                document_id: None,
                source_locale: Some(locale.to_string()),
                options: BTreeMap::new(),
            })
            .expect("import");
        translunar_filter_core::collect_imported_document(stream)
            .expect("events")
            .units
    }

    #[test]
    fn txt_preserves_bom_and_only_replaces_owned_range() {
        let directory = tempfile::tempdir().expect("temp");
        let source = directory.path().join("source.txt");
        let output = directory.path().join("output.txt");
        fs::write(&source, "\u{feff}First line.\r\n\r\nSecond line.\r\n").expect("write");
        let units = import_units(&TxtFilter, &source, "en-US");
        assert_eq!(units.len(), 2);
        assert_eq!(units[0].source_text, "First line.");
        let mut segment = Segment {
            id: "s1".to_string(),
            document_id: "d1".to_string(),
            ordinal: 0,
            structural_path: units[0].structural_path.clone(),
            source_text: units[0].source_text.clone(),
            target_text: "第一行。".to_string(),
            state: SegmentState::Draft,
            revision: 0,
            source_hash: String::new(),
            context_hash: String::new(),
            updated_at_ms: 0,
        };
        TxtFilter
            .export(ExportRequest {
                source: &source,
                output: &output,
                segments: std::slice::from_mut(&mut segment),
            })
            .expect("export");
        assert_eq!(
            fs::read(&output).expect("read output"),
            "\u{feff}第一行。\r\n\r\nSecond line.\r\n".as_bytes()
        );
    }

    #[test]
    fn markdown_protects_code_urls_and_syntax() {
        let directory = tempfile::tempdir().expect("temp");
        let source = directory.path().join("source.md");
        fs::write(
            &source,
            "# Heading\n\nVisible **bold** and [link](https://example.test) `code`.\n\n```rust\nlet x = 1;\n```\n",
        )
        .expect("write");
        let units = import_units(&MarkdownFilter, &source, "en-US");
        let values: Vec<_> = units.iter().map(|unit| unit.source_text.as_str()).collect();
        assert!(values.contains(&"Heading"));
        assert!(values.contains(&"Visible"));
        assert!(values.contains(&"bold"));
        assert!(values.contains(&"link"));
        assert!(!values.iter().any(|value| value.contains("https://")));
        assert!(!values.iter().any(|value| value.contains("let x")));
        assert!(units.iter().any(|unit| !unit.inline_tags.is_empty()));
    }

    #[test]
    fn malformed_utf8_is_rejected_without_events() {
        let directory = tempfile::tempdir().expect("temp");
        let source = directory.path().join("bad.txt");
        fs::write(&source, [0xff, 0xfe]).expect("write");
        assert!(matches!(
            TxtFilter.import(ImportRequest::new(source)),
            Err(FilterError::Invalid(_))
        ));
    }

    #[test]
    fn txt_applies_custom_srx_from_filter_options() {
        let directory = tempfile::tempdir().expect("temp");
        let source = directory.path().join("source.txt");
        let srx = directory.path().join("custom.srx");
        fs::write(&source, "One; Two;").expect("write text");
        fs::write(
            &srx,
            r#"<srx version="2.0"><body><languagerules>
              <languagerule languagerulename="Custom"><rule break="yes">
                <beforebreak>;</beforebreak><afterbreak>\s+[A-Z]</afterbreak>
              </rule></languagerule></languagerules><maprules><maprule>
                <languagemap languagepattern="en.*" languagerulename="Custom"/>
              </maprule></maprules></body></srx>"#,
        )
        .expect("write SRX");
        let mut options = BTreeMap::new();
        options.insert("segmentationMode".to_string(), "sentence".to_string());
        options.insert("srxPath".to_string(), srx.to_string_lossy().into_owned());
        let stream = TxtFilter
            .import(ImportRequest {
                source,
                document_id: None,
                source_locale: Some("en-US".to_string()),
                options,
            })
            .expect("import with custom SRX");
        let document = translunar_filter_core::collect_imported_document(stream)
            .expect("collect custom SRX units");
        assert_eq!(
            document
                .units
                .iter()
                .map(|unit| unit.source_text.as_str())
                .collect::<Vec<_>>(),
            ["One;", "Two;"]
        );
    }
}

//! Source-preserving HTML5 and XHTML filter.

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::fs;
use std::ops::Range;
use std::path::Path;

use quick_xml::Reader;
use thiserror::Error;
use tl_domain::{InlineTag, TagKind, TagSide};
use tl_filter_core::{
    DocumentFilter, DocumentMetadata, ExportReport, ExportRequest, FilterCapabilities,
    FilterDescriptor, FilterError, FilterEvent, FilterEventStream, ImportRequest, ProbeResult,
    ValidationReport, publish_bytes_noclobber,
};
use tl_segmentation::{SegmentationMode, SrxRules};

const MAX_INPUT_BYTES: u64 = 32 * 1024 * 1024;
const EXCLUDED: &[&str] = &["script", "style", "code", "pre"];
const INLINE: &[&str] = &[
    "a", "abbr", "b", "bdi", "bdo", "cite", "code", "del", "em", "i", "ins", "kbd", "mark", "q",
    "s", "samp", "small", "span", "strong", "sub", "sup", "u", "var",
];
const DEFAULT_ATTRIBUTES: &[&str] = &["title", "alt", "placeholder", "aria-label"];

#[derive(Debug, Error)]
enum HtmlError {
    #[error("HTML input exceeds the 32 MiB filter limit")]
    TooLarge,
    #[error("HTML is not valid UTF-8 at byte {0}")]
    Utf8(usize),
    #[error("malformed HTML: {0}")]
    Malformed(String),
    #[error("XHTML is not well formed: {0}")]
    Xhtml(String),
    #[error("invalid structural range: {0}")]
    Range(String),
    #[error("I/O failed: {0}")]
    Io(#[from] std::io::Error),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum HtmlKind {
    Html,
    Xhtml,
}

impl HtmlKind {
    fn format(self) -> &'static str {
        match self {
            Self::Html => "html",
            Self::Xhtml => "xhtml",
        }
    }
}

#[derive(Debug, Clone)]
enum Token {
    Text {
        range: Range<usize>,
    },
    Start {
        range: Range<usize>,
        name: String,
        self_closing: bool,
        attributes: Vec<AttributeSpan>,
    },
    End {
        range: Range<usize>,
        name: String,
    },
    Other,
}

#[derive(Debug, Clone)]
struct AttributeSpan {
    name: String,
    value: Range<usize>,
}

#[derive(Debug, Clone)]
struct Pair {
    start: Range<usize>,
    end: Range<usize>,
    name: String,
}

#[derive(Debug, Clone)]
struct TextUnit {
    range: Range<usize>,
    source_text: String,
    pairs: Vec<Pair>,
}

#[derive(Debug, Clone)]
struct AttributeUnit {
    range: Range<usize>,
    source_text: String,
}

#[derive(Debug, Clone, Copy, Default)]
pub struct HtmlFilter;

impl HtmlFilter {
    pub fn new() -> Self {
        Self
    }
}

impl DocumentFilter for HtmlFilter {
    fn descriptor(&self) -> FilterDescriptor {
        FilterDescriptor {
            id: "builtin.html".to_string(),
            version: env!("CARGO_PKG_VERSION").to_string(),
            display_name: "HTML / XHTML".to_string(),
            extensions: vec!["html".to_string(), "htm".to_string(), "xhtml".to_string()],
            capabilities: FilterCapabilities {
                import: true,
                export: true,
                validate: true,
                inline_tags: true,
                notes: false,
                degradation_report: true,
            },
        }
    }

    fn probe(&self, source: &Path) -> Result<ProbeResult, FilterError> {
        let extension = source.extension().and_then(|value| value.to_str());
        let Some(extension) = extension else {
            return Ok(ProbeResult::no_match("file has no HTML extension"));
        };
        if !matches!(
            extension.to_ascii_lowercase().as_str(),
            "html" | "htm" | "xhtml"
        ) {
            return Ok(ProbeResult::no_match("file extension is not HTML/XHTML"));
        }
        let bytes = read_bounded(source).map_err(map_error)?;
        parse_document(&bytes, kind_for_path(source), false).map_err(map_error)?;
        Ok(ProbeResult::matches(95, "valid HTML/XHTML source"))
    }

    fn import(&self, request: ImportRequest) -> Result<FilterEventStream, FilterError> {
        let bytes = read_bounded(&request.source).map_err(map_error)?;
        let kind = kind_for_path(&request.source);
        let parsed = parse_document(&bytes, kind, true).map_err(map_error)?;
        let locale = request.source_locale.as_deref().unwrap_or("en");
        let rules = if let Some(path) = request.options.get("srxPath") {
            let xml = fs::read_to_string(path)
                .map_err(|error| FilterError::Invalid(error.to_string()))?;
            SrxRules::parse(&xml).map_err(|error| FilterError::Invalid(error.to_string()))?
        } else {
            SrxRules::builtin(locale)
        };
        let mode =
            SegmentationMode::parse(request.options.get("segmentationMode").map(String::as_str));
        let attributes = attribute_configuration(&request.options);
        let id_prefix = request.document_id.as_deref().unwrap_or("unmanaged");
        let (units, degradation) = build_units(&bytes, &parsed, &rules, locale, mode)?;
        let attribute_units = attribute_units(&bytes, &parsed, &attributes)?;
        if units.is_empty() && attribute_units.is_empty() {
            return Err(FilterError::Invalid(
                "document contains no translatable HTML text".to_string(),
            ));
        }
        let text_unit_count = units.len();
        let mut events = Vec::with_capacity((text_unit_count + attribute_units.len()) * 5 + 2);
        let mut properties = BTreeMap::new();
        properties.insert("segmentation".to_string(), mode_name(mode).to_string());
        properties.insert(
            "translatableAttributes".to_string(),
            attributes.iter().cloned().collect::<Vec<_>>().join(","),
        );
        events.push(Ok(FilterEvent::StartDocument {
            metadata: DocumentMetadata {
                format: kind.format().to_string(),
                source_locale: request.source_locale.clone(),
                properties,
            },
        }));
        for (ordinal, unit) in units.into_iter().enumerate() {
            let path = format!(
                "{}:text:{}-{}",
                kind.format(),
                unit.range.start,
                unit.range.end
            );
            events.push(Ok(FilterEvent::StartUnit {
                ordinal: u32::try_from(ordinal)
                    .map_err(|_| FilterError::Invalid("HTML unit count exceeds u32".to_string()))?,
                structural_path: path,
            }));
            events.push(Ok(FilterEvent::Text(unit.source_text.clone())));
            for (pair_index, pair) in unit.pairs.iter().enumerate() {
                let pair_id = format!("{id_prefix}-html-pair-{ordinal}-{pair_index}");
                events.push(Ok(FilterEvent::InlineTag(InlineTag {
                    id: format!("{pair_id}-start"),
                    side: TagSide::Source,
                    position: 0,
                    kind: TagKind::Start,
                    pair_id: Some(pair_id.clone()),
                    payload: bytes_to_text(&bytes, pair.start.clone())
                        .map_err(map_error)?
                        .to_string(),
                    display_text: format!("<{}>", pair.name),
                    protected: true,
                })));
                events.push(Ok(FilterEvent::InlineTag(InlineTag {
                    id: format!("{pair_id}-end"),
                    side: TagSide::Source,
                    position: u32::try_from(unit.source_text.chars().count()).map_err(|_| {
                        FilterError::Invalid("HTML unit exceeds u32 character count".to_string())
                    })?,
                    kind: TagKind::End,
                    pair_id: Some(pair_id),
                    payload: bytes_to_text(&bytes, pair.end.clone())
                        .map_err(map_error)?
                        .to_string(),
                    display_text: format!("</{}>", pair.name),
                    protected: true,
                })));
            }
            events.push(Ok(FilterEvent::EndUnit));
        }
        let mut next_ordinal = u32::try_from(text_unit_count)
            .map_err(|_| FilterError::Invalid("HTML unit count exceeds u32".to_string()))?;
        for unit in attribute_units {
            events.push(Ok(FilterEvent::StartUnit {
                ordinal: next_ordinal,
                structural_path: format!(
                    "{}:attr:{}-{}",
                    kind.format(),
                    unit.range.start,
                    unit.range.end
                ),
            }));
            events.push(Ok(FilterEvent::Text(unit.source_text)));
            events.push(Ok(FilterEvent::EndUnit));
            next_ordinal = next_ordinal
                .checked_add(1)
                .ok_or_else(|| FilterError::Invalid("HTML unit count exceeds u32".to_string()))?;
        }
        for finding in degradation {
            events.push(Ok(FilterEvent::Degradation(finding)));
        }
        events.push(Ok(FilterEvent::EndDocument));
        Ok(Box::new(events.into_iter()))
    }

    fn export(&self, request: ExportRequest<'_>) -> Result<ExportReport, FilterError> {
        let bytes = read_bounded(request.source).map_err(map_error)?;
        let kind = kind_for_path(request.source);
        parse_document(&bytes, kind, true).map_err(map_error)?;
        let mut replacements = Vec::new();
        for segment in request.segments {
            if segment.target_text.trim().is_empty() {
                continue;
            }
            let (path_kind, category, range) =
                parse_path(&segment.structural_path).map_err(map_error)?;
            if path_kind != kind.format() || range.end > bytes.len() || range.start >= range.end {
                return Err(FilterError::Invalid(format!(
                    "invalid HTML structural path {}",
                    segment.structural_path
                )));
            }
            let original = bytes_to_text(&bytes, range.clone()).map_err(map_error)?;
            let replacement = if category == "attr" {
                escape_attribute(&segment.target_text)
            } else {
                escape_text(&segment.target_text)
            };
            if original.is_empty() {
                return Err(FilterError::Invalid("empty HTML owned range".to_string()));
            }
            replacements.push((range, replacement.into_bytes()));
        }
        replacements.sort_by_key(|item| std::cmp::Reverse(item.0.start));
        for pair in replacements.windows(2) {
            if pair[0].0.start < pair[1].0.end {
                return Err(FilterError::Invalid(
                    "overlapping HTML translations".to_string(),
                ));
            }
        }
        let translated_segments = u32::try_from(replacements.len())
            .map_err(|_| FilterError::Invalid("translation count exceeds u32".to_string()))?;
        let mut output = bytes;
        for (range, replacement) in replacements {
            output.splice(range, replacement);
        }
        parse_document(&output, kind, true).map_err(map_error)?;
        publish_bytes_noclobber(request.output, &output)?;
        Ok(ExportReport {
            output_path: request.output.display().to_string(),
            translated_segments,
            degradation: Vec::new(),
        })
    }

    fn validate(&self, source: &Path) -> Result<ValidationReport, FilterError> {
        let bytes = read_bounded(source).map_err(map_error)?;
        parse_document(&bytes, kind_for_path(source), true).map_err(map_error)?;
        Ok(ValidationReport {
            valid: true,
            findings: Vec::new(),
        })
    }
}

#[derive(Debug)]
struct ParsedDocument {
    tokens: Vec<Token>,
    pairs: HashMap<usize, Vec<Pair>>,
    kind: HtmlKind,
}

fn parse_document(bytes: &[u8], kind: HtmlKind, strict: bool) -> Result<ParsedDocument, HtmlError> {
    let (text, offset) = decode_utf8(bytes)?;
    if kind == HtmlKind::Xhtml || strict && looks_like_xhtml(text) {
        validate_xhtml(text)?;
    }
    let mut tokens = Vec::new();
    let mut cursor = 0;
    while cursor < text.len() {
        let Some(relative) = text[cursor..].find('<') else {
            if cursor < text.len() {
                tokens.push(Token::Text {
                    range: (offset + cursor)..(offset + text.len()),
                });
            }
            break;
        };
        let open = cursor + relative;
        if open > cursor {
            tokens.push(Token::Text {
                range: (offset + cursor)..(offset + open),
            });
        }
        if text[open..].starts_with("<!--") {
            let Some(end_relative) = text[open + 4..].find("-->") else {
                return Err(HtmlError::Malformed("unterminated comment".to_string()));
            };
            cursor = open + 4 + end_relative + 3;
            tokens.push(Token::Other);
            continue;
        }
        let end = find_tag_end(text, open)?;
        let raw = &text[open..end];
        let token = parse_tag(raw, (offset + open)..(offset + end))?;
        tokens.push(token);
        cursor = end;
    }
    if tokens.is_empty() {
        return Err(HtmlError::Malformed("document is empty".to_string()));
    }
    let pairs = match_pairs(&tokens);
    Ok(ParsedDocument {
        tokens,
        pairs,
        kind,
    })
}

fn build_units(
    bytes: &[u8],
    parsed: &ParsedDocument,
    rules: &SrxRules,
    locale: &str,
    mode: SegmentationMode,
) -> Result<(Vec<TextUnit>, Vec<tl_domain::DegradationFinding>), FilterError> {
    let mut units = Vec::new();
    let mut stack: Vec<(usize, String, Range<usize>, bool, bool)> = Vec::new();
    let mut degradation = Vec::new();
    for (index, token) in parsed.tokens.iter().enumerate() {
        match token {
            Token::Start {
                range,
                name,
                self_closing,
                ..
            } => {
                let excluded = EXCLUDED.iter().any(|item| *item == name);
                if !self_closing && !is_void(name) {
                    stack.push((
                        index,
                        name.clone(),
                        range.clone(),
                        excluded,
                        INLINE.iter().any(|item| *item == name),
                    ));
                }
            }
            Token::End { name, .. } => {
                if let Some(position) = stack.iter().rposition(|item| item.1 == *name) {
                    stack.truncate(position);
                }
            }
            Token::Text { range } => {
                let excluded = stack.iter().any(|item| item.3);
                if excluded {
                    continue;
                }
                let raw = bytes_to_text(bytes, range.clone()).map_err(map_error)?;
                let (decoded, mapping) = decode_entities_with_map(raw);
                let Some(decoded_range) = trim_decoded_range(&decoded) else {
                    continue;
                };
                let ranges = if mode == SegmentationMode::Paragraph {
                    vec![decoded_range]
                } else {
                    rules
                        .ranges(&decoded[decoded_range.clone()], locale, mode)
                        .into_iter()
                        .filter_map(|subrange| {
                            let start = decoded_range.start + subrange.start;
                            let end = decoded_range.start + subrange.end;
                            trim_decoded_range(&decoded[start..end])
                                .map(|trimmed| (start + trimmed.start)..(start + trimmed.end))
                        })
                        .collect()
                };
                for decoded_range in ranges {
                    let raw_start = map_decoded_boundary(&mapping, decoded_range.start);
                    let raw_end = map_decoded_boundary(&mapping, decoded_range.end);
                    let source_range = (range.start + raw_start)..(range.start + raw_end);
                    let source_text = decoded[decoded_range].to_string();
                    let pairs = stack
                        .iter()
                        .filter(|item| item.4)
                        .filter_map(|item| {
                            parsed
                                .pairs
                                .get(&item.0)
                                .and_then(|pairs| pairs.first().cloned())
                        })
                        .collect();
                    units.push(TextUnit {
                        range: source_range,
                        source_text,
                        pairs,
                    });
                }
            }
            Token::Other => {}
        }
    }
    if parsed.kind == HtmlKind::Html && stack.iter().any(|item| !is_void(&item.1)) {
        degradation.push(tl_domain::DegradationFinding {
            code: "html-unclosed-element".to_string(),
            severity: tl_domain::DegradationSeverity::Warning,
            message: "HTML contains an unclosed element; source bytes were preserved".to_string(),
            structural_path: None,
        });
    }
    Ok((units, degradation))
}

fn attribute_units(
    bytes: &[u8],
    parsed: &ParsedDocument,
    attributes: &BTreeSet<String>,
) -> Result<Vec<AttributeUnit>, FilterError> {
    let mut result = Vec::new();
    for token in &parsed.tokens {
        let Token::Start {
            attributes: spans, ..
        } = token
        else {
            continue;
        };
        for attribute in spans {
            if !attributes.contains(&attribute.name) {
                continue;
            }
            let raw = bytes_to_text(bytes, attribute.value.clone()).map_err(map_error)?;
            let (decoded, _) = decode_entities_with_map(raw);
            if !decoded.trim().is_empty() {
                result.push(AttributeUnit {
                    range: attribute.value.clone(),
                    source_text: decoded,
                });
            }
        }
    }
    Ok(result)
}

fn match_pairs(tokens: &[Token]) -> HashMap<usize, Vec<Pair>> {
    let mut stack: Vec<(usize, String, Range<usize>)> = Vec::new();
    let mut result: HashMap<usize, Vec<Pair>> = HashMap::new();
    for (index, token) in tokens.iter().enumerate() {
        match token {
            Token::Start {
                range,
                name,
                self_closing,
                ..
            } if !self_closing && !is_void(name) => {
                stack.push((index, name.clone(), range.clone()))
            }
            Token::End { range, name } => {
                if let Some(position) = stack.iter().rposition(|item| item.1 == *name) {
                    let (start_index, start_name, start_range) = stack.remove(position);
                    if INLINE.iter().any(|item| *item == start_name) {
                        result.entry(start_index).or_default().push(Pair {
                            start: start_range,
                            end: range.clone(),
                            name: start_name,
                        });
                    }
                }
            }
            _ => {}
        }
    }
    result
}

fn parse_tag(raw: &str, range: Range<usize>) -> Result<Token, HtmlError> {
    if raw.starts_with("<?") || raw.starts_with("<!") {
        return Ok(Token::Other);
    }
    if let Some(raw) = raw.strip_prefix("</") {
        let name = raw
            .split(|value: char| value.is_whitespace() || value == '>')
            .next()
            .filter(|value| !value.is_empty())
            .ok_or_else(|| HtmlError::Malformed("end tag has no name".to_string()))?
            .to_ascii_lowercase();
        return Ok(Token::End { range, name });
    }
    let body = raw.strip_prefix('<').unwrap_or(raw);
    let self_closing = body.trim_end().ends_with("/>");
    let body = body.trim_end_matches('>').trim_end_matches('/').trim();
    let name_end = body
        .find(|value: char| value.is_whitespace())
        .unwrap_or(body.len());
    let name = body[..name_end].to_ascii_lowercase();
    if name.is_empty()
        || name
            .chars()
            .any(|value| value == '<' || value == '"' || value == '\'')
    {
        return Err(HtmlError::Malformed(
            "start tag has invalid name".to_string(),
        ));
    }
    let attributes = parse_attributes(raw, range.start, name_end + 1)?;
    Ok(Token::Start {
        range,
        name,
        self_closing,
        attributes,
    })
}

fn parse_attributes(
    raw: &str,
    absolute_start: usize,
    name_offset: usize,
) -> Result<Vec<AttributeSpan>, HtmlError> {
    let mut result = Vec::new();
    let mut cursor = name_offset;
    let bytes = raw.as_bytes();
    while cursor + 1 < bytes.len() {
        while cursor < bytes.len() && bytes[cursor].is_ascii_whitespace() {
            cursor += 1;
        }
        if cursor >= bytes.len() || bytes[cursor] == b'>' || bytes[cursor] == b'/' {
            break;
        }
        let name_start = cursor;
        while cursor < bytes.len()
            && !bytes[cursor].is_ascii_whitespace()
            && !matches!(bytes[cursor], b'=' | b'>' | b'/')
        {
            cursor += 1;
        }
        if name_start == cursor {
            return Err(HtmlError::Malformed("invalid attribute name".to_string()));
        }
        let name = raw[name_start..cursor].to_ascii_lowercase();
        while cursor < bytes.len() && bytes[cursor].is_ascii_whitespace() {
            cursor += 1;
        }
        if cursor >= bytes.len() || bytes[cursor] != b'=' {
            continue;
        }
        cursor += 1;
        while cursor < bytes.len() && bytes[cursor].is_ascii_whitespace() {
            cursor += 1;
        }
        if cursor >= bytes.len() {
            return Err(HtmlError::Malformed("attribute has no value".to_string()));
        }
        let value_start = cursor;
        if matches!(bytes[cursor], b'"' | b'\'') {
            let quote = bytes[cursor];
            cursor += 1;
            let content_start = cursor;
            while cursor < bytes.len() && bytes[cursor] != quote {
                cursor += 1;
            }
            if cursor >= bytes.len() {
                return Err(HtmlError::Malformed(
                    "unterminated attribute value".to_string(),
                ));
            }
            result.push(AttributeSpan {
                name,
                value: (absolute_start + content_start)..(absolute_start + cursor),
            });
            cursor += 1;
        } else {
            while cursor < bytes.len()
                && !bytes[cursor].is_ascii_whitespace()
                && bytes[cursor] != b'>'
            {
                cursor += 1;
            }
            result.push(AttributeSpan {
                name,
                value: (absolute_start + value_start)..(absolute_start + cursor),
            });
        }
    }
    Ok(result)
}

fn find_tag_end(text: &str, start: usize) -> Result<usize, HtmlError> {
    let bytes = text.as_bytes();
    let mut quote = None;
    for (index, current) in bytes.iter().copied().enumerate().skip(start + 1) {
        match (quote, current) {
            (None, b'"') | (None, b'\'') => quote = Some(current),
            (Some(value), current) if value == current => quote = None,
            (None, b'>') => return Ok(index + 1),
            _ => {}
        }
    }
    Err(HtmlError::Malformed("unterminated tag".to_string()))
}

fn validate_xhtml(text: &str) -> Result<(), HtmlError> {
    let mut reader = Reader::from_str(text);
    reader.config_mut().trim_text(false);
    let mut buffer = Vec::new();
    let mut stack = Vec::<String>::new();
    loop {
        match reader.read_event_into(&mut buffer) {
            Ok(quick_xml::events::Event::Start(element)) => {
                let name = std::str::from_utf8(element.name().as_ref())
                    .map_err(|error| HtmlError::Xhtml(error.to_string()))?
                    .to_string();
                stack.push(name);
                buffer.clear();
            }
            Ok(quick_xml::events::Event::End(element)) => {
                let qualified_name = element.name();
                let name = std::str::from_utf8(qualified_name.as_ref())
                    .map_err(|error| HtmlError::Xhtml(error.to_string()))?;
                let Some(open) = stack.pop() else {
                    return Err(HtmlError::Xhtml(format!("unexpected closing tag {name}")));
                };
                if open != name {
                    return Err(HtmlError::Xhtml(format!(
                        "closing tag {name} does not match {open}"
                    )));
                }
                buffer.clear();
            }
            Ok(quick_xml::events::Event::Eof) => {
                if let Some(open) = stack.last() {
                    return Err(HtmlError::Xhtml(format!("unclosed tag {open}")));
                }
                return Ok(());
            }
            Ok(_) => buffer.clear(),
            Err(error) => return Err(HtmlError::Xhtml(error.to_string())),
        }
    }
}

fn looks_like_xhtml(text: &str) -> bool {
    text.contains("xmlns=\"http://www.w3.org/1999/xhtml\"")
        || text.contains("xmlns='http://www.w3.org/1999/xhtml'")
}

fn decode_entities_with_map(raw: &str) -> (String, Vec<(usize, usize)>) {
    let mut decoded = String::new();
    let mut mapping = vec![(0, 0)];
    let mut cursor = 0;
    while cursor < raw.len() {
        if raw.as_bytes()[cursor] == b'&'
            && let Some(relative) = raw[cursor..].find(';')
            && relative <= 32
            && let Some(value) = decode_entity(&raw[cursor..cursor + relative + 1])
        {
            decoded.push(value);
            cursor += relative + 1;
            mapping.push((decoded.len(), cursor));
            continue;
        }
        let character = raw[cursor..].chars().next().unwrap_or_default();
        decoded.push(character);
        cursor += character.len_utf8();
        mapping.push((decoded.len(), cursor));
    }
    (decoded, mapping)
}

fn decode_entity(value: &str) -> Option<char> {
    match value {
        "&amp;" => Some('&'),
        "&lt;" => Some('<'),
        "&gt;" => Some('>'),
        "&quot;" => Some('"'),
        "&apos;" => Some('\''),
        "&nbsp;" => Some('\u{a0}'),
        _ if value.starts_with("&#x") && value.ends_with(';') => {
            u32::from_str_radix(&value[3..value.len() - 1], 16)
                .ok()
                .and_then(char::from_u32)
        }
        _ if value.starts_with("&#") && value.ends_with(';') => value[2..value.len() - 1]
            .parse::<u32>()
            .ok()
            .and_then(char::from_u32),
        _ => None,
    }
}

fn map_decoded_boundary(mapping: &[(usize, usize)], boundary: usize) -> usize {
    mapping
        .iter()
        .find(|(decoded, _)| *decoded == boundary)
        .map_or_else(
            || mapping.last().map_or(0, |(_, raw)| *raw),
            |(_, raw)| *raw,
        )
}

fn trim_decoded_range(text: &str) -> Option<Range<usize>> {
    let mut start = 0;
    let mut end = text.len();
    while start < end {
        let value = text[start..end].chars().next()?;
        if !value.is_whitespace() {
            break;
        }
        start += value.len_utf8();
    }
    while end > start {
        let value = text[..end].chars().next_back()?;
        if !value.is_whitespace() {
            break;
        }
        end -= value.len_utf8();
    }
    (start < end).then_some(start..end)
}

fn attribute_configuration(options: &BTreeMap<String, String>) -> BTreeSet<String> {
    let mut values: BTreeSet<String> = DEFAULT_ATTRIBUTES
        .iter()
        .map(|value| (*value).to_string())
        .collect();
    if let Some(value) = options.get("translatableAttributes") {
        values = value
            .split(',')
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_ascii_lowercase)
            .collect();
    }
    if let Some(value) = options.get("addTranslatableAttributes") {
        values.extend(
            value
                .split(',')
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_ascii_lowercase),
        );
    }
    if let Some(value) = options.get("removeTranslatableAttributes") {
        for name in value.split(',').map(str::trim).map(str::to_ascii_lowercase) {
            values.remove(&name);
        }
    }
    values
}

fn parse_path(path: &str) -> Result<(&str, &str, Range<usize>), HtmlError> {
    let (kind, rest) = path
        .split_once(':')
        .ok_or_else(|| HtmlError::Range(path.to_string()))?;
    let (category, range) = rest
        .split_once(':')
        .ok_or_else(|| HtmlError::Range(path.to_string()))?;
    let (start, end) = range
        .split_once('-')
        .ok_or_else(|| HtmlError::Range(path.to_string()))?;
    let start = start
        .parse::<usize>()
        .map_err(|_| HtmlError::Range(path.to_string()))?;
    let end = end
        .parse::<usize>()
        .map_err(|_| HtmlError::Range(path.to_string()))?;
    Ok((kind, category, start..end))
}

fn kind_for_path(path: &Path) -> HtmlKind {
    if path
        .extension()
        .and_then(|value| value.to_str())
        .is_some_and(|value| value.eq_ignore_ascii_case("xhtml"))
    {
        HtmlKind::Xhtml
    } else {
        HtmlKind::Html
    }
}

fn is_void(name: &str) -> bool {
    matches!(
        name,
        "area"
            | "base"
            | "br"
            | "col"
            | "embed"
            | "hr"
            | "img"
            | "input"
            | "link"
            | "meta"
            | "param"
            | "source"
            | "track"
            | "wbr"
    )
}

fn mode_name(mode: SegmentationMode) -> &'static str {
    match mode {
        SegmentationMode::Paragraph => "paragraph",
        SegmentationMode::Sentence => "sentence",
    }
}

fn bytes_to_text(bytes: &[u8], range: Range<usize>) -> Result<&str, HtmlError> {
    std::str::from_utf8(
        bytes
            .get(range.clone())
            .ok_or_else(|| HtmlError::Range(format!("{}..{}", range.start, range.end)))?,
    )
    .map_err(|error| HtmlError::Utf8(error.valid_up_to() + range.start))
}

fn read_bounded(path: &Path) -> Result<Vec<u8>, HtmlError> {
    let metadata = fs::metadata(path)?;
    if metadata.len() > MAX_INPUT_BYTES {
        return Err(HtmlError::TooLarge);
    }
    Ok(fs::read(path)?)
}

fn decode_utf8(bytes: &[u8]) -> Result<(&str, usize), HtmlError> {
    let offset = usize::from(bytes.starts_with(&[0xef, 0xbb, 0xbf])) * 3;
    let text = std::str::from_utf8(&bytes[offset..])
        .map_err(|error| HtmlError::Utf8(error.valid_up_to() + offset))?;
    Ok((text, offset))
}

fn escape_text(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

fn escape_attribute(value: &str) -> String {
    escape_text(value).replace('"', "&quot;")
}

fn map_error(error: HtmlError) -> FilterError {
    match error {
        HtmlError::Io(error) => FilterError::Io(error),
        HtmlError::TooLarge => {
            FilterError::Invalid("HTML document exceeds filter size limit".to_string())
        }
        HtmlError::Utf8(offset) => FilterError::Invalid(format!("invalid UTF-8 at byte {offset}")),
        HtmlError::Malformed(message) | HtmlError::Xhtml(message) | HtmlError::Range(message) => {
            FilterError::Invalid(message)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;
    use tl_domain::{Segment, SegmentState};
    use tl_filter_core::collect_imported_document;

    fn units(path: &Path) -> Vec<tl_filter_core::ImportedUnit> {
        let stream = HtmlFilter
            .import(ImportRequest {
                source: path.to_path_buf(),
                document_id: None,
                source_locale: Some("en-US".to_string()),
                options: BTreeMap::new(),
            })
            .expect("import");
        collect_imported_document(stream).expect("events").units
    }

    #[test]
    fn imports_nested_inline_tags_exclusions_and_attributes() {
        let directory = tempfile::tempdir().expect("temp");
        let source = directory.path().join("source.html");
        fs::write(&source, "<!-- keep --><p title=\"Greeting &amp; title\">Hello <strong>world</strong>!</p><script>skip()</script>").expect("write");
        let imported = units(&source);
        assert!(imported.iter().any(|unit| unit.source_text == "Hello"));
        let nested = imported
            .iter()
            .find(|unit| unit.source_text == "world")
            .expect("nested text");
        assert_eq!(nested.inline_tags.len(), 2);
        assert!(
            imported
                .iter()
                .any(|unit| unit.source_text == "Greeting & title")
        );
        assert!(
            !imported
                .iter()
                .any(|unit| unit.source_text.contains("skip"))
        );
    }

    #[test]
    fn exports_text_and_attribute_without_rewriting_markup() {
        let directory = tempfile::tempdir().expect("temp");
        let source = directory.path().join("source.html");
        let output = directory.path().join("translated.html");
        fs::write(&source, "<p title=\"Hello\">Hello <b>world</b>.</p>").expect("write");
        let imported = units(&source);
        let mut segments: Vec<Segment> = imported
            .iter()
            .enumerate()
            .map(|(ordinal, unit)| Segment {
                id: format!("s{ordinal}"),
                document_id: "d".to_string(),
                ordinal: ordinal as u32,
                structural_path: unit.structural_path.clone(),
                source_text: unit.source_text.clone(),
                target_text: if unit.source_text == "Hello" {
                    "你好".to_string()
                } else {
                    "世界".to_string()
                },
                state: SegmentState::Draft,
                revision: 0,
                source_hash: String::new(),
                context_hash: String::new(),
                updated_at_ms: 0,
            })
            .collect();
        HtmlFilter
            .export(ExportRequest {
                source: &source,
                output: &output,
                segments: &segments,
                segment_anchors: std::collections::BTreeMap::new(),
            })
            .expect("export");
        let result = fs::read_to_string(&output).expect("read");
        assert!(result.contains("<b>世界</b>"));
        assert!(result.contains("title=\"你好\""));
        assert!(result.contains("<p"));
        segments[0].target_text = "again".to_string();
        assert!(
            HtmlFilter
                .export(ExportRequest {
                    source: &source,
                    output: &output,
                    segments: &segments,
                    segment_anchors: std::collections::BTreeMap::new(),
                })
                .is_err()
        );
    }

    #[test]
    fn rejects_malformed_xhtml() {
        let directory = tempfile::tempdir().expect("temp");
        let source = directory.path().join("bad.xhtml");
        fs::write(
            &source,
            "<html xmlns=\"http://www.w3.org/1999/xhtml\"><p>broken",
        )
        .expect("write");
        assert!(matches!(
            HtmlFilter.validate(&source),
            Err(FilterError::Invalid(_))
        ));
    }

    #[test]
    fn valid_xhtml_namespace_and_attribute_configuration_round_trip() {
        let directory = tempfile::tempdir().expect("temp");
        let source = directory.path().join("source.xhtml");
        fs::write(
            &source,
            r#"<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><body><p title="Title">Hello <span>world</span>.</p></body></html>"#,
        )
        .expect("write");
        let mut options = BTreeMap::new();
        options.insert(
            "removeTranslatableAttributes".to_string(),
            "title".to_string(),
        );
        let stream = HtmlFilter
            .import(ImportRequest {
                source,
                document_id: None,
                source_locale: Some("en-US".to_string()),
                options,
            })
            .expect("import XHTML");
        let document =
            tl_filter_core::collect_imported_document(stream).expect("collect XHTML units");
        assert!(
            document
                .units
                .iter()
                .any(|unit| unit.source_text == "world")
        );
        assert!(
            !document
                .units
                .iter()
                .any(|unit| unit.source_text == "Title")
        );
    }
}

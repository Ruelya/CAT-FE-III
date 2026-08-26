//! Conservative XLIFF 1.2 and 2.1 filter.
//!
//! The parser builds a small source-offset tree instead of serializing XML.
//! Export therefore changes only target inner ranges (or inserts a missing
//! target) and leaves unknown namespaces and metadata byte-for-byte intact.

use std::collections::{BTreeMap, HashMap};
use std::fs;
use std::ops::Range;
use std::path::Path;

use thiserror::Error;
use tl_domain::{DocumentNote, InlineTag, TagKind, TagSide};
use tl_filter_core::{
    DocumentFilter, DocumentMetadata, ExportReport, ExportRequest, FilterCapabilities,
    FilterDescriptor, FilterError, FilterEvent, FilterEventStream, ImportRequest, ProbeResult,
    ValidationReport, publish_bytes_noclobber,
};

const MAX_INPUT_BYTES: u64 = 64 * 1024 * 1024;
const MAX_XML_DEPTH: usize = 256;
const ATOMIC_INLINE: &[&str] = &["bpt", "ept", "it", "ph", "x", "sc", "ec"];

#[derive(Debug, Error)]
enum XliffError {
    #[error("XLIFF input exceeds the 64 MiB filter limit")]
    TooLarge,
    #[error("XLIFF is not valid UTF-8 at byte {0}")]
    Utf8(usize),
    #[error("malformed XLIFF: {0}")]
    Malformed(String),
    #[error("unsupported XLIFF version: {0}")]
    UnsupportedVersion(String),
    #[error("duplicate XLIFF unit path: {0}")]
    DuplicatePath(String),
    #[error("invalid XLIFF structural path: {0}")]
    Range(String),
    #[error("I/O failed: {0}")]
    Io(#[from] std::io::Error),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum XliffVersion {
    V12,
    V21,
}

impl XliffVersion {
    fn label(self) -> &'static str {
        match self {
            Self::V12 => "1.2",
            Self::V21 => "2.1",
        }
    }

    fn parse(value: &str) -> Result<Self, XliffError> {
        if value == "1.2" {
            Ok(Self::V12)
        } else if value.starts_with("2.") {
            Ok(Self::V21)
        } else {
            Err(XliffError::UnsupportedVersion(value.to_string()))
        }
    }
}

#[derive(Debug, Clone)]
enum TokenKind {
    Text,
    Raw,
    Start { node: usize },
    End { node: usize },
    Empty { node: usize },
}

#[derive(Debug, Clone)]
struct Token {
    range: Range<usize>,
    kind: TokenKind,
}

#[derive(Debug, Clone)]
struct Node {
    raw_name: String,
    name: String,
    attrs: BTreeMap<String, String>,
    start_tag: Range<usize>,
    inner: Range<usize>,
    end_tag: Option<Range<usize>>,
    parent: Option<usize>,
    end_token: Option<usize>,
}

#[derive(Debug, Clone)]
struct XmlDocument {
    tokens: Vec<Token>,
    nodes: Vec<Node>,
    root: usize,
}

#[derive(Debug, Clone)]
struct UnitRecord {
    path: String,
    target: Option<Range<usize>>,
    target_insert: usize,
    source_name: String,
    source_template: String,
    target_template: Option<String>,
    source_text: String,
    target_text: Option<String>,
    source_tags: Vec<RawTag>,
    target_tags: Vec<RawTag>,
    notes: Vec<DocumentNote>,
}

#[derive(Debug, Clone)]
struct RawTag {
    position: u32,
    kind: TagKind,
    pair_id: Option<String>,
    payload: String,
    display_text: String,
}

#[derive(Debug, Clone)]
struct ParsedXliff {
    version: XliffVersion,
    source_locale: Option<String>,
    target_locale: Option<String>,
    units: Vec<UnitRecord>,
}

#[derive(Debug, Clone, Copy, Default)]
pub struct XliffFilter;

impl XliffFilter {
    pub fn new() -> Self {
        Self
    }
}

impl DocumentFilter for XliffFilter {
    fn descriptor(&self) -> FilterDescriptor {
        FilterDescriptor {
            id: "builtin.xliff".to_string(),
            version: env!("CARGO_PKG_VERSION").to_string(),
            display_name: "XLIFF 1.2 / 2.x".to_string(),
            extensions: vec!["xlf".to_string(), "xliff".to_string()],
            capabilities: FilterCapabilities {
                import: true,
                export: true,
                validate: true,
                inline_tags: true,
                notes: true,
                degradation_report: true,
            },
        }
    }

    fn probe(&self, source: &Path) -> Result<ProbeResult, FilterError> {
        let extension = source.extension().and_then(|value| value.to_str());
        if !extension
            .is_some_and(|value| matches!(value.to_ascii_lowercase().as_str(), "xlf" | "xliff"))
        {
            return Ok(ProbeResult::no_match("file extension is not XLIFF"));
        }
        let bytes = read_bounded(source).map_err(map_error)?;
        parse_xliff(bytes).map_err(map_error)?;
        Ok(ProbeResult::matches(100, "supported XLIFF version"))
    }

    fn import(&self, request: ImportRequest) -> Result<FilterEventStream, FilterError> {
        let bytes = read_bounded(&request.source).map_err(map_error)?;
        let parsed = parse_xliff(bytes).map_err(map_error)?;
        if parsed.units.is_empty() {
            return Err(FilterError::Invalid(
                "XLIFF contains no translatable units".to_string(),
            ));
        }
        let mut events = Vec::with_capacity(parsed.units.len() * 8 + 2);
        let id_prefix = request.document_id.as_deref().unwrap_or("unmanaged");
        let mut properties = BTreeMap::new();
        properties.insert("version".to_string(), parsed.version.label().to_string());
        properties.insert("unitCount".to_string(), parsed.units.len().to_string());
        if let Some(locale) = &parsed.target_locale {
            properties.insert("targetLocale".to_string(), locale.clone());
        }
        events.push(Ok(FilterEvent::StartDocument {
            metadata: DocumentMetadata {
                format: format!("xliff-{}", parsed.version.label()),
                source_locale: parsed
                    .source_locale
                    .clone()
                    .or(request.source_locale.clone()),
                properties,
            },
        }));
        for (ordinal, unit) in parsed.units.iter().enumerate() {
            events.push(Ok(FilterEvent::StartUnit {
                ordinal: u32::try_from(ordinal).map_err(|_| {
                    FilterError::Invalid("XLIFF unit count exceeds u32".to_string())
                })?,
                structural_path: unit.path.clone(),
            }));
            events.push(Ok(FilterEvent::Text(unit.source_text.clone())));
            for (index, tag) in unit.source_tags.iter().enumerate() {
                events.push(Ok(FilterEvent::InlineTag(to_inline_tag(
                    tag,
                    TagSide::Source,
                    id_prefix,
                    ordinal,
                    index,
                )?)));
            }
            if let Some(target) = &unit.target_text {
                events.push(Ok(FilterEvent::TargetText(target.clone())));
                for (index, tag) in unit.target_tags.iter().enumerate() {
                    events.push(Ok(FilterEvent::InlineTag(to_inline_tag(
                        tag,
                        TagSide::Target,
                        id_prefix,
                        ordinal,
                        index,
                    )?)));
                }
            }
            for note in &unit.notes {
                let mut note = note.clone();
                note.id = format!("{id_prefix}-{}", note.id);
                events.push(Ok(FilterEvent::Note(note)));
            }
            events.push(Ok(FilterEvent::EndUnit));
        }
        events.push(Ok(FilterEvent::EndDocument));
        Ok(Box::new(events.into_iter()))
    }

    fn export(&self, request: ExportRequest<'_>) -> Result<ExportReport, FilterError> {
        let bytes = read_bounded(request.source).map_err(map_error)?;
        let parsed = parse_xliff(bytes.clone()).map_err(map_error)?;
        let mut by_path: HashMap<&str, &UnitRecord> = HashMap::new();
        for unit in &parsed.units {
            if by_path.insert(unit.path.as_str(), unit).is_some() {
                return Err(FilterError::Invalid(
                    "duplicate XLIFF structural path".to_string(),
                ));
            }
        }
        let mut replacements: Vec<(Range<usize>, Vec<u8>)> = Vec::new();
        for segment in request.segments {
            let Some(unit) = by_path.get(segment.structural_path.as_str()) else {
                return Err(FilterError::Invalid(format!(
                    "XLIFF unit is not present in source: {}",
                    segment.structural_path
                )));
            };
            if segment.target_text.trim().is_empty()
                && segment.revision == 0
                && unit.target.is_none()
            {
                continue;
            }
            let template = unit
                .target_template
                .as_deref()
                .unwrap_or(&unit.source_template);
            let rendered = render_template(template, &segment.target_text);
            if let Some(target_range) = &unit.target {
                replacements.push((target_range.clone(), rendered.into_bytes()));
            } else {
                let target_name = target_element_name(unit);
                let target = if parsed.version == XliffVersion::V12 {
                    format!("<{target_name} state=\"translated\">{rendered}</{target_name}>")
                } else {
                    format!("<{target_name}>{rendered}</{target_name}>")
                };
                replacements.push((unit.target_insert..unit.target_insert, target.into_bytes()));
            }
        }
        replacements.sort_by_key(|item| std::cmp::Reverse(item.0.start));
        for pair in replacements.windows(2) {
            if pair[0].0.start < pair[1].0.end {
                return Err(FilterError::Invalid(
                    "overlapping XLIFF target ranges".to_string(),
                ));
            }
        }
        let translated_segments = u32::try_from(replacements.len())
            .map_err(|_| FilterError::Invalid("translation count exceeds u32".to_string()))?;
        let mut output = bytes;
        for (range, replacement) in replacements {
            output.splice(range, replacement);
        }
        let reparsed = parse_xliff(output.clone()).map_err(map_error)?;
        compare_source_identity(&parsed.units, &reparsed.units)?;
        publish_bytes_noclobber(request.output, &output)?;
        Ok(ExportReport {
            output_path: request.output.display().to_string(),
            translated_segments,
            degradation: Vec::new(),
        })
    }

    fn validate(&self, source: &Path) -> Result<ValidationReport, FilterError> {
        let bytes = read_bounded(source).map_err(map_error)?;
        parse_xliff(bytes).map_err(map_error)?;
        Ok(ValidationReport {
            valid: true,
            findings: Vec::new(),
        })
    }
}

fn parse_xliff(bytes: Vec<u8>) -> Result<ParsedXliff, XliffError> {
    let document = parse_xml(&bytes)?;
    let root = &document.nodes[document.root];
    if root.name != "xliff" {
        return Err(XliffError::Malformed(
            "root element is not xliff".to_string(),
        ));
    }
    let version_value = root
        .attrs
        .get("version")
        .ok_or_else(|| XliffError::Malformed("xliff version is missing".to_string()))?;
    let version = XliffVersion::parse(version_value)?;
    let source_locale = root
        .attrs
        .get("srclang")
        .cloned()
        .or_else(|| root.attrs.get("source-language").cloned())
        .or_else(|| {
            document
                .nodes
                .iter()
                .find(|node| node.name == "file")
                .and_then(|node| node.attrs.get("source-language").cloned())
        });
    let target_locale = root
        .attrs
        .get("trglang")
        .cloned()
        .or_else(|| root.attrs.get("target-language").cloned())
        .or_else(|| {
            document
                .nodes
                .iter()
                .find(|node| node.name == "file")
                .and_then(|node| node.attrs.get("target-language").cloned())
        });
    let mut units = Vec::new();
    for (index, node) in document.nodes.iter().enumerate() {
        let is_unit = match version {
            XliffVersion::V12 => node.name == "trans-unit",
            XliffVersion::V21 => node.name == "segment",
        };
        if !is_unit {
            continue;
        }
        let file_id =
            ancestor_value(&document, index, "file", "id").unwrap_or_else(|| "file".to_string());
        let (unit_id, segment_id) = if version == XliffVersion::V12 {
            let id = node
                .attrs
                .get("id")
                .cloned()
                .ok_or_else(|| XliffError::Malformed("trans-unit id is missing".to_string()))?;
            (id.clone(), id)
        } else {
            let unit_id = ancestor_value(&document, index, "unit", "id")
                .ok_or_else(|| XliffError::Malformed("unit id is missing".to_string()))?;
            let segment_id = node
                .attrs
                .get("id")
                .cloned()
                .unwrap_or_else(|| "segment".to_string());
            (unit_id, segment_id)
        };
        let source_node = child_node(&document, index, "source")
            .ok_or_else(|| XliffError::Malformed(format!("source is missing for {unit_id}")))?;
        let target_node = child_node(&document, index, "target");
        let source_template = slice(&bytes, source_node.inner.clone())?.to_string();
        let target_template = target_node
            .map(|target| slice(&bytes, target.inner.clone()))
            .transpose()?
            .map(str::to_string);
        let source_inline = inline_content(&bytes, source_node.inner.clone())?;
        let target_inline = target_node
            .map(|target| inline_content(&bytes, target.inner.clone()))
            .transpose()?;
        let path = format!(
            "xliff:{}:{}:{}:{}",
            version.label(),
            encode_id(&file_id),
            encode_id(&unit_id),
            encode_id(&segment_id)
        );
        if units.iter().any(|unit: &UnitRecord| unit.path == path) {
            return Err(XliffError::DuplicatePath(path));
        }
        let note_scope = if version == XliffVersion::V21 {
            ancestor_index(&document, index, "unit").unwrap_or(index)
        } else {
            index
        };
        let mut notes = collect_notes(&document, &bytes, note_scope)?;
        let state = target_node
            .and_then(|target| target.attrs.get("state").cloned())
            .or_else(|| node.attrs.get("state").cloned());
        if let Some(state) = &state {
            notes.push(DocumentNote {
                id: format!("xliff-state-{}", encode_id(&segment_id)),
                text: state.clone(),
                author: Some("xliff-state".to_string()),
            });
        }
        let target_insert = source_node
            .end_tag
            .as_ref()
            .map_or(source_node.inner.end, |range| range.end);
        units.push(UnitRecord {
            path,
            target: target_node.map(|target| target.inner.clone()),
            target_insert,
            source_name: source_node.raw_name.clone(),
            source_template,
            target_template,
            source_text: source_inline.text,
            target_text: target_inline.as_ref().map(|value| value.text.clone()),
            source_tags: source_inline.tags,
            target_tags: target_inline.map_or_else(Vec::new, |value| value.tags),
            notes,
        });
    }
    Ok(ParsedXliff {
        version,
        source_locale,
        target_locale,
        units,
    })
}

#[derive(Debug)]
struct InlineContent {
    text: String,
    tags: Vec<RawTag>,
}

fn inline_content(bytes: &[u8], range: Range<usize>) -> Result<InlineContent, XliffError> {
    let fragment = slice(bytes, range.clone())?;
    let parsed = parse_fragment(fragment)?;
    let mut text = String::new();
    let mut tags = Vec::new();
    let mut pair_ids = HashMap::<usize, String>::new();
    let mut index = 0;
    while index < parsed.tokens.len() {
        let token = &parsed.tokens[index];
        match &token.kind {
            TokenKind::Text => {
                text.push_str(&decode_xml_text(slice(
                    fragment.as_bytes(),
                    (token.range.start)..(token.range.end),
                )?));
                index += 1;
            }
            TokenKind::Raw => {
                index += 1;
            }
            TokenKind::Start { node } => {
                let element = &parsed.nodes[*node];
                if is_segmentation_mrk(element) {
                    index += 1;
                    continue;
                }
                if ATOMIC_INLINE.contains(&element.name.as_str()) {
                    let end = element
                        .end_tag
                        .as_ref()
                        .map_or(element.start_tag.end, |value| value.end);
                    tags.push(RawTag {
                        position: u32::try_from(text.chars().count()).map_err(|_| {
                            XliffError::Range("inline text exceeds u32".to_string())
                        })?,
                        kind: TagKind::Standalone,
                        pair_id: None,
                        payload: slice(fragment.as_bytes(), element.start_tag.start..end)?
                            .to_string(),
                        display_text: format!("<{}>", element.name),
                    });
                    index = element.end_token.map_or(index + 1, |value| value + 1);
                } else {
                    let pair_id = format!("pair-{}", node);
                    pair_ids.insert(*node, pair_id.clone());
                    tags.push(RawTag {
                        position: u32::try_from(text.chars().count()).map_err(|_| {
                            XliffError::Range("inline text exceeds u32".to_string())
                        })?,
                        kind: TagKind::Start,
                        pair_id: Some(pair_id),
                        payload: slice(fragment.as_bytes(), element.start_tag.clone())?.to_string(),
                        display_text: format!("<{}>", element.name),
                    });
                    index += 1;
                }
            }
            TokenKind::End { node } => {
                let element = &parsed.nodes[*node];
                if is_segmentation_mrk(element) {
                    index += 1;
                    continue;
                }
                let pair_id = pair_ids.get(node).cloned();
                tags.push(RawTag {
                    position: u32::try_from(text.chars().count())
                        .map_err(|_| XliffError::Range("inline text exceeds u32".to_string()))?,
                    kind: TagKind::End,
                    pair_id,
                    payload: slice(fragment.as_bytes(), token.range.clone())?.to_string(),
                    display_text: format!("</{}>", element.name),
                });
                index += 1;
            }
            TokenKind::Empty { node } => {
                let element = &parsed.nodes[*node];
                if is_segmentation_mrk(element) {
                    index += 1;
                    continue;
                }
                tags.push(RawTag {
                    position: u32::try_from(text.chars().count())
                        .map_err(|_| XliffError::Range("inline text exceeds u32".to_string()))?,
                    kind: TagKind::Standalone,
                    pair_id: None,
                    payload: slice(fragment.as_bytes(), element.start_tag.clone())?.to_string(),
                    display_text: format!("<{} />", element.name),
                });
                index += 1;
            }
        }
    }
    Ok(InlineContent { text, tags })
}

fn is_segmentation_mrk(element: &Node) -> bool {
    element.name == "mrk"
        && element
            .attrs
            .get("mtype")
            .is_some_and(|value| value.eq_ignore_ascii_case("seg"))
}

/// Text slots a translator can edit: skip `bpt`/`ept`/`ph` payloads and
/// transparent `<mrk mtype="seg">` wrappers. Those code-data characters are
/// not part of `source_text` / `target_text` on import, so they must not
/// steal proportional slots on export.
fn translatable_text_slots(parsed: &XmlDocument, template: &str) -> Vec<(usize, usize, usize)> {
    let mut slots = Vec::<(usize, usize, usize)>::new();
    let mut total = 0usize;
    let mut index = 0;
    while index < parsed.tokens.len() {
        match &parsed.tokens[index].kind {
            TokenKind::Text => {
                let value = decode_xml_text(&template[parsed.tokens[index].range.clone()]);
                let count = value.chars().count();
                slots.push((index, total, count));
                total += count;
                index += 1;
            }
            TokenKind::Start { node } => {
                let element = &parsed.nodes[*node];
                if is_segmentation_mrk(element) {
                    index += 1;
                    continue;
                }
                if ATOMIC_INLINE.contains(&element.name.as_str()) {
                    index = element.end_token.map_or(index + 1, |value| value + 1);
                    continue;
                }
                index += 1;
            }
            _ => index += 1,
        }
    }
    slots
}

fn render_template(template: &str, target: &str) -> String {
    let Ok(parsed) = parse_fragment(template) else {
        return escape_xml_text(target);
    };
    let text_slots = translatable_text_slots(&parsed, template);
    let template_text: String = text_slots
        .iter()
        .map(|(index, _, _)| decode_xml_text(&template[parsed.tokens[*index].range.clone()]))
        .collect();
    // Tags did not move and the translator did not change the text: keep the
    // original target inner, including Okapi `<mrk mtype="seg">` wrappers.
    if template_text == target {
        return template.to_string();
    }
    let total = text_slots
        .last()
        .map(|(_, start, count)| start + count)
        .unwrap_or(0);
    let target_chars: Vec<char> = target.chars().collect();
    let mut output = String::new();
    let mut target_cursor = 0;
    let mut slot_by_index = HashMap::new();
    for (index, start, count) in &text_slots {
        slot_by_index.insert(*index, (*start, *count));
    }
    let mut index = 0;
    while index < parsed.tokens.len() {
        let token = &parsed.tokens[index];
        match &token.kind {
            TokenKind::Text => {
                let Some((start, count)) = slot_by_index.get(&index).copied() else {
                    index += 1;
                    continue;
                };
                let end = ((start + count) * target_chars.len() + total / 2)
                    .checked_div(total)
                    .unwrap_or(target_chars.len());
                if end > target_cursor {
                    output.push_str(&escape_xml_text(
                        &target_chars[target_cursor..end].iter().collect::<String>(),
                    ));
                    target_cursor = end;
                }
                index += 1;
            }
            TokenKind::Raw => {
                output.push_str(&template[token.range.clone()]);
                index += 1;
            }
            TokenKind::Start { node } => {
                let element = &parsed.nodes[*node];
                if ATOMIC_INLINE.contains(&element.name.as_str()) {
                    let end = element
                        .end_tag
                        .as_ref()
                        .map_or(element.start_tag.end, |value| value.end);
                    output.push_str(&template[element.start_tag.start..end]);
                    index = element.end_token.map_or(index + 1, |value| value + 1);
                } else {
                    output.push_str(&template[element.start_tag.clone()]);
                    index += 1;
                }
            }
            TokenKind::End { .. } | TokenKind::Empty { .. } => {
                output.push_str(&template[token.range.clone()]);
                index += 1;
            }
        }
    }
    if target_cursor < target_chars.len() {
        output.push_str(&escape_xml_text(
            &target_chars[target_cursor..].iter().collect::<String>(),
        ));
    }
    output
}

fn parse_xml(bytes: &[u8]) -> Result<XmlDocument, XliffError> {
    let text = std::str::from_utf8(bytes).map_err(|error| XliffError::Utf8(error.valid_up_to()))?;
    parse_xml_inner(text, true)
}

fn parse_fragment(text: &str) -> Result<XmlDocument, XliffError> {
    parse_xml_inner(text, false)
}

fn parse_xml_inner(text: &str, require_root: bool) -> Result<XmlDocument, XliffError> {
    let mut tokens = Vec::new();
    let mut nodes: Vec<Node> = Vec::new();
    let mut stack = Vec::<usize>::new();
    let mut cursor = 0;
    while cursor < text.len() {
        let Some(relative) = text[cursor..].find('<') else {
            if cursor < text.len() {
                tokens.push(Token {
                    range: cursor..text.len(),
                    kind: TokenKind::Text,
                });
            }
            break;
        };
        let open = cursor + relative;
        if open > cursor {
            tokens.push(Token {
                range: cursor..open,
                kind: TokenKind::Text,
            });
        }
        if text[open..].starts_with("<!--") {
            let end = text[open + 4..]
                .find("-->")
                .ok_or_else(|| XliffError::Malformed("unterminated comment".to_string()))?
                + open
                + 7;
            tokens.push(Token {
                range: open..end,
                kind: TokenKind::Raw,
            });
            cursor = end;
            continue;
        }
        if text[open..].starts_with("<![CDATA[") {
            let content_start = open + 9;
            let end_marker = text[content_start..]
                .find("]]>")
                .ok_or_else(|| XliffError::Malformed("unterminated CDATA".to_string()))?;
            let content_end = content_start + end_marker;
            if content_start < content_end {
                tokens.push(Token {
                    range: content_start..content_end,
                    kind: TokenKind::Text,
                });
            }
            cursor = content_end + 3;
            continue;
        }
        if text[open..]
            .get(..9)
            .is_some_and(|prefix| prefix.eq_ignore_ascii_case("<!DOCTYPE"))
        {
            return Err(XliffError::Malformed(
                "DOCTYPE and external entities are not supported".to_string(),
            ));
        }
        if text[open..].starts_with("<?") || text[open..].starts_with("<!") {
            let end = find_tag_end(text, open)?;
            tokens.push(Token {
                range: open..end,
                kind: TokenKind::Raw,
            });
            cursor = end;
            continue;
        }
        let end = find_tag_end(text, open)?;
        let raw = &text[open..end];
        if let Some(rest) = raw.strip_prefix("</") {
            let raw_name = element_name(rest)?;
            let Some(node_index) = stack.pop() else {
                return Err(XliffError::Malformed(format!(
                    "unexpected closing tag {raw_name}"
                )));
            };
            if nodes[node_index].raw_name != raw_name {
                return Err(XliffError::Malformed(format!(
                    "closing tag {raw_name} does not match {}",
                    nodes[node_index].raw_name
                )));
            }
            nodes[node_index].inner.end = open;
            nodes[node_index].end_tag = Some(open..end);
            nodes[node_index].end_token = Some(tokens.len());
            tokens.push(Token {
                range: open..end,
                kind: TokenKind::End { node: node_index },
            });
            cursor = end;
            continue;
        }
        let self_closing = raw[..raw.len().saturating_sub(1)].trim_end().ends_with('/');
        let body = raw
            .strip_prefix('<')
            .unwrap_or(raw)
            .trim_end_matches('>')
            .trim_end_matches('/')
            .trim();
        let name_end = body.find(char::is_whitespace).unwrap_or(body.len());
        let raw_name = body[..name_end].to_string();
        let name = local_name(&raw_name);
        if raw_name.is_empty() {
            return Err(XliffError::Malformed("start tag has no name".to_string()));
        }
        let attrs = parse_attributes(raw, name_end + 1)?;
        let parent = stack.last().copied();
        let node_index = nodes.len();
        nodes.push(Node {
            raw_name,
            name,
            attrs,
            start_tag: open..end,
            inner: end..end,
            end_tag: None,
            parent,
            end_token: None,
        });
        if self_closing {
            tokens.push(Token {
                range: open..end,
                kind: TokenKind::Empty { node: node_index },
            });
        } else {
            tokens.push(Token {
                range: open..end,
                kind: TokenKind::Start { node: node_index },
            });
            nodes[node_index].inner.start = end;
            if stack.len() >= MAX_XML_DEPTH {
                return Err(XliffError::Malformed(
                    "XML nesting exceeds depth limit".to_string(),
                ));
            }
            stack.push(node_index);
        }
        cursor = end;
    }
    if let Some(node) = stack.last() {
        return Err(XliffError::Malformed(format!(
            "unclosed element {}",
            nodes[*node].raw_name
        )));
    }
    let roots: Vec<_> = nodes
        .iter()
        .enumerate()
        .filter(|(_, node)| node.parent.is_none())
        .map(|(index, _)| index)
        .collect();
    if require_root && roots.len() != 1 {
        return Err(XliffError::Malformed(
            "XML must have exactly one root element".to_string(),
        ));
    }
    let root = roots.first().copied().unwrap_or(0);
    Ok(XmlDocument {
        tokens,
        nodes,
        root,
    })
}

fn parse_attributes(raw: &str, mut cursor: usize) -> Result<BTreeMap<String, String>, XliffError> {
    let bytes = raw.as_bytes();
    let mut result = BTreeMap::new();
    while cursor < bytes.len() {
        while cursor < bytes.len() && bytes[cursor].is_ascii_whitespace() {
            cursor += 1;
        }
        if cursor >= bytes.len() || matches!(bytes[cursor], b'>' | b'/') {
            break;
        }
        let start = cursor;
        while cursor < bytes.len()
            && !bytes[cursor].is_ascii_whitespace()
            && !matches!(bytes[cursor], b'=' | b'>' | b'/')
        {
            cursor += 1;
        }
        let key = raw[start..cursor].to_ascii_lowercase();
        while cursor < bytes.len() && bytes[cursor].is_ascii_whitespace() {
            cursor += 1;
        }
        if cursor >= bytes.len() || bytes[cursor] != b'=' {
            return Err(XliffError::Malformed(format!(
                "attribute {key} has no value"
            )));
        }
        cursor += 1;
        while cursor < bytes.len() && bytes[cursor].is_ascii_whitespace() {
            cursor += 1;
        }
        if cursor >= bytes.len() || !matches!(bytes[cursor], b'"' | b'\'') {
            return Err(XliffError::Malformed(format!(
                "attribute {key} must be quoted"
            )));
        }
        let quote = bytes[cursor];
        cursor += 1;
        let value_start = cursor;
        while cursor < bytes.len() && bytes[cursor] != quote {
            cursor += 1;
        }
        if cursor >= bytes.len() {
            return Err(XliffError::Malformed(format!(
                "attribute {key} is unterminated"
            )));
        }
        // Keep the prefixed name. Okapi Tikal writes both `version="1.2"` and
        // `its:version="2.0"` on the same <xliff> element; collapsing to the
        // local name made the parser treat a 1.2 file as 2.x and drop every
        // trans-unit.
        result.insert(key, decode_xml_text(&raw[value_start..cursor]));
        cursor += 1;
    }
    Ok(result)
}

fn element_name(value: &str) -> Result<String, XliffError> {
    value
        .split(|character: char| character.is_whitespace() || character == '>')
        .next()
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .ok_or_else(|| XliffError::Malformed("element has no name".to_string()))
}

fn local_name(value: &str) -> String {
    value
        .rsplit(':')
        .next()
        .unwrap_or(value)
        .to_ascii_lowercase()
}

fn child_node<'a>(document: &'a XmlDocument, parent: usize, name: &str) -> Option<&'a Node> {
    document
        .nodes
        .iter()
        .find(|node| node.parent == Some(parent) && node.name == name)
}

fn ancestor_value(
    document: &XmlDocument,
    mut index: usize,
    name: &str,
    attr: &str,
) -> Option<String> {
    loop {
        let node = &document.nodes[index];
        if node.name == name
            && let Some(value) = node.attrs.get(attr)
        {
            return Some(value.clone());
        }
        index = node.parent?;
    }
}

fn ancestor_index(document: &XmlDocument, mut index: usize, name: &str) -> Option<usize> {
    loop {
        let node = &document.nodes[index];
        if node.name == name {
            return Some(index);
        }
        index = node.parent?;
    }
}

fn collect_notes(
    document: &XmlDocument,
    bytes: &[u8],
    unit_index: usize,
) -> Result<Vec<DocumentNote>, XliffError> {
    let mut notes = Vec::new();
    for (index, node) in document.nodes.iter().enumerate() {
        if node.name != "note" || !is_descendant(document, index, unit_index) {
            continue;
        }
        let text = decode_xml_text(slice(bytes, node.inner.clone())?);
        if text.trim().is_empty() {
            continue;
        }
        notes.push(DocumentNote {
            id: node
                .attrs
                .get("id")
                .cloned()
                .unwrap_or_else(|| format!("note-{unit_index}-{index}")),
            text,
            author: node
                .attrs
                .get("from")
                .cloned()
                .or_else(|| node.attrs.get("author").cloned()),
        });
    }
    Ok(notes)
}

fn is_descendant(document: &XmlDocument, mut index: usize, ancestor: usize) -> bool {
    while let Some(parent) = document.nodes[index].parent {
        if parent == ancestor {
            return true;
        }
        index = parent;
    }
    false
}

fn to_inline_tag(
    tag: &RawTag,
    side: TagSide,
    id_prefix: &str,
    ordinal: usize,
    index: usize,
) -> Result<InlineTag, FilterError> {
    let side_name = match side {
        TagSide::Source => "source",
        TagSide::Target => "target",
    };
    Ok(InlineTag {
        id: format!("{id_prefix}-xliff-tag-{ordinal}-{side_name}-{index}"),
        side,
        position: tag.position,
        kind: tag.kind,
        pair_id: tag
            .pair_id
            .clone()
            .map(|value| format!("{id_prefix}-xliff-pair-{ordinal}-{value}")),
        payload: tag.payload.clone(),
        display_text: tag.display_text.clone(),
        protected: true,
    })
}

fn target_element_name(unit: &UnitRecord) -> String {
    unit.source_name
        .strip_suffix("source")
        .map_or_else(|| "target".to_string(), |prefix| format!("{prefix}target"))
}

fn compare_source_identity(before: &[UnitRecord], after: &[UnitRecord]) -> Result<(), FilterError> {
    if before.len() != after.len() {
        return Err(FilterError::Invalid(
            "XLIFF export changed unit count".to_string(),
        ));
    }
    for (left, right) in before.iter().zip(after) {
        if left.path != right.path || left.source_text != right.source_text {
            return Err(FilterError::Invalid(
                "XLIFF export changed source identity".to_string(),
            ));
        }
    }
    Ok(())
}

fn decode_xml_text(value: &str) -> String {
    let mut result = String::new();
    let mut cursor = 0;
    while cursor < value.len() {
        if value.as_bytes()[cursor] == b'&'
            && let Some(relative) = value[cursor..].find(';')
            && let Some(decoded) = decode_entity(&value[cursor..cursor + relative + 1])
        {
            result.push(decoded);
            cursor += relative + 1;
            continue;
        }
        let character = value[cursor..].chars().next().unwrap_or_default();
        result.push(character);
        cursor += character.len_utf8();
    }
    result
}

fn decode_entity(value: &str) -> Option<char> {
    match value {
        "&amp;" => Some('&'),
        "&lt;" => Some('<'),
        "&gt;" => Some('>'),
        "&quot;" => Some('"'),
        "&apos;" => Some('\''),
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

fn escape_xml_text(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

fn slice(bytes: &[u8], range: Range<usize>) -> Result<&str, XliffError> {
    std::str::from_utf8(
        bytes
            .get(range.clone())
            .ok_or_else(|| XliffError::Range(format!("{}..{}", range.start, range.end)))?,
    )
    .map_err(|error| XliffError::Utf8(error.valid_up_to() + range.start))
}

fn find_tag_end(text: &str, start: usize) -> Result<usize, XliffError> {
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
    Err(XliffError::Malformed("unterminated tag".to_string()))
}

fn read_bounded(path: &Path) -> Result<Vec<u8>, XliffError> {
    let metadata = fs::metadata(path)?;
    if metadata.len() > MAX_INPUT_BYTES {
        return Err(XliffError::TooLarge);
    }
    Ok(fs::read(path)?)
}

fn encode_id(value: &str) -> String {
    value
        .as_bytes()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn map_error(error: XliffError) -> FilterError {
    match error {
        XliffError::Io(error) => FilterError::Io(error),
        XliffError::TooLarge => {
            FilterError::Invalid("XLIFF document exceeds filter size limit".to_string())
        }
        XliffError::Utf8(offset) => FilterError::Invalid(format!("invalid UTF-8 at byte {offset}")),
        XliffError::Malformed(message)
        | XliffError::UnsupportedVersion(message)
        | XliffError::DuplicatePath(message)
        | XliffError::Range(message) => FilterError::Invalid(message),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;
    use tl_domain::{Segment, SegmentState};
    use tl_filter_core::collect_imported_document;

    fn load(path: &Path) -> Vec<tl_filter_core::ImportedUnit> {
        let stream = XliffFilter
            .import(ImportRequest {
                source: path.to_path_buf(),
                document_id: None,
                source_locale: None,
                options: BTreeMap::new(),
            })
            .expect("import");
        collect_imported_document(stream).expect("events").units
    }

    #[test]
    fn xliff12_preserves_target_notes_inline_and_unknown_metadata() {
        let directory = tempfile::tempdir().expect("temp");
        let source = directory.path().join("source.xlf");
        let output = directory.path().join("output.xlf");
        let document = r#"<?xml version="1.0"?><xliff version="1.2" xmlns="urn:oasis:names:tc:xliff:document:1.2" xmlns:x="urn:example"><file original="a" source-language="en" target-language="zh"><body><trans-unit id="u1" state="needs-translation"><source>Hello <g id="1">world</g>.</source><target state="translated">你好 <g id="1">世界</g>。</target><note id="n1" from="qa">Keep tone</note><x:meta custom="yes"/></trans-unit></body></file></xliff>"#;
        fs::write(&source, document).expect("write");
        let units = load(&source);
        assert_eq!(units.len(), 1);
        assert_eq!(units[0].source_text, "Hello world.");
        assert_eq!(units[0].target_text.as_deref(), Some("你好 世界。"));
        assert_eq!(units[0].notes[0].text, "Keep tone");
        assert!(units[0].inline_tags.len() >= 4);
        let mut segment = Segment {
            id: "s1".to_string(),
            document_id: "d1".to_string(),
            ordinal: 0,
            structural_path: units[0].structural_path.clone(),
            source_text: units[0].source_text.clone(),
            target_text: "你好，世界。".to_string(),
            state: SegmentState::Draft,
            revision: 1,
            source_hash: String::new(),
            context_hash: String::new(),
            updated_at_ms: 0,
            origin: None,
        };
        XliffFilter
            .export(ExportRequest {
                source: &source,
                output: &output,
                segments: std::slice::from_mut(&mut segment),
                segment_anchors: std::collections::BTreeMap::new(),
            })
            .expect("export");
        let result = fs::read_to_string(&output).expect("read");
        assert!(result.contains("x:meta"));
        assert!(result.contains("<g id=\"1\">"));
        let exported = load(&output);
        assert_eq!(exported[0].target_text.as_deref(), Some("你好，世界。"));
    }

    #[test]
    fn xliff21_inserts_missing_target_and_keeps_ids() {
        let directory = tempfile::tempdir().expect("temp");
        let source = directory.path().join("source.xliff");
        let output = directory.path().join("output.xliff");
        fs::write(&source, r#"<xliff version="2.1" srcLang="en" trgLang="de" xmlns="urn:oasis:names:tc:xliff:document:2.1"><file id="f"><unit id="u"><segment id="s"><source>Hello <ph id="p"/> world</source></segment></unit></file></xliff>"#).expect("write");
        let units = load(&source);
        assert_eq!(units[0].target_text, None);
        let segment = Segment {
            id: "s1".to_string(),
            document_id: "d1".to_string(),
            ordinal: 0,
            structural_path: units[0].structural_path.clone(),
            source_text: units[0].source_text.clone(),
            target_text: "Hallo Welt".to_string(),
            state: SegmentState::Confirmed,
            revision: 1,
            source_hash: String::new(),
            context_hash: String::new(),
            updated_at_ms: 0,
            origin: None,
        };
        XliffFilter
            .export(ExportRequest {
                source: &source,
                output: &output,
                segments: std::slice::from_ref(&segment),
                segment_anchors: std::collections::BTreeMap::new(),
            })
            .expect("export");
        let result = fs::read_to_string(&output).expect("read");
        assert!(result.contains("<target>"));
        assert!(result.contains("<ph id=\"p\"/>"));
        assert!(result.contains("id=\"s\""));
    }

    #[test]
    fn okapi_tikal_xliff12_keeps_trans_units_when_its_version_is_present() {
        let directory = tempfile::tempdir().expect("temp");
        let source = directory.path().join("sample.html.xlf");
        fs::write(
            &source,
            r#"<?xml version="1.0" encoding="UTF-8"?>
<xliff version="1.2" xmlns="urn:oasis:names:tc:xliff:document:1.2" xmlns:okp="okapi-framework:xliff-extensions" xmlns:its="http://www.w3.org/2005/11/its" xmlns:itsxlf="http://www.w3.org/ns/its-xliff/" its:version="2.0">
<file original="sample.html" source-language="en-US" target-language="zh-CN" datatype="html" okp:inputEncoding="utf-8">
<body>
<trans-unit id="tu2" restype="x-h1">
<source xml:lang="en-US">Welcome to <bpt id="1">&lt;em></bpt>Aurora<ept id="1">&lt;/em></ept></source>
<seg-source><mrk mid="0" mtype="seg">Welcome to <bpt id="1">&lt;em></bpt>Aurora<ept id="1">&lt;/em></ept></mrk></seg-source>
<target xml:lang="zh-CN"><mrk mid="0" mtype="seg">Welcome to <bpt id="1">&lt;em></bpt>Aurora<ept id="1">&lt;/em></ept></mrk></target>
</trans-unit>
</body>
</file>
</xliff>"#,
        )
        .expect("write Tikal-shaped XLIFF");
        let units = load(&source);
        assert_eq!(units.len(), 1);
        assert_eq!(units[0].source_text, "Welcome to Aurora");
        assert_eq!(units[0].target_text.as_deref(), Some("Welcome to Aurora"));
        assert!(
            units[0]
                .inline_tags
                .iter()
                .any(|tag| tag.payload.contains("<bpt")),
            "Tikal bpt/ept inline tags must survive import"
        );
        assert!(
            units[0]
                .inline_tags
                .iter()
                .all(|tag| !tag.payload.contains("<mrk")),
            "XLIFF 1.2 seg-source mrk wrappers are not inline tags"
        );
    }

    fn tikal_tagged_unit() -> &'static str {
        r#"<?xml version="1.0" encoding="UTF-8"?>
<xliff version="1.2" xmlns="urn:oasis:names:tc:xliff:document:1.2" xmlns:okp="okapi-framework:xliff-extensions" xmlns:its="http://www.w3.org/2005/11/its" its:version="2.0">
<file original="sample.html" source-language="en-US" target-language="zh-CN" datatype="html">
<body>
<trans-unit id="tu2" restype="x-h1">
<source xml:lang="en-US">Welcome to <bpt id="1">&lt;em></bpt>Aurora<ept id="1">&lt;/em></ept></source>
<seg-source><mrk mid="0" mtype="seg">Welcome to <bpt id="1">&lt;em></bpt>Aurora<ept id="1">&lt;/em></ept></mrk></seg-source>
<target xml:lang="zh-CN"><mrk mid="0" mtype="seg">Welcome to <bpt id="1">&lt;em></bpt>Aurora<ept id="1">&lt;/em></ept></mrk></target>
</trans-unit>
</body>
</file>
</xliff>"#
    }

    #[test]
    fn okapi_tikal_export_keeps_unmoved_tagged_target_inner() {
        let directory = tempfile::tempdir().expect("temp");
        let source = directory.path().join("sample.html.xlf");
        let output = directory.path().join("exported.xlf");
        fs::write(&source, tikal_tagged_unit()).expect("write Tikal-shaped XLIFF");
        let units = load(&source);
        let segment = Segment {
            id: "s1".to_string(),
            document_id: "d1".to_string(),
            ordinal: 0,
            structural_path: units[0].structural_path.clone(),
            source_text: units[0].source_text.clone(),
            target_text: "Welcome to Aurora".to_string(),
            state: SegmentState::Confirmed,
            revision: 1,
            source_hash: String::new(),
            context_hash: String::new(),
            updated_at_ms: 0,
            origin: None,
        };
        XliffFilter
            .export(ExportRequest {
                source: &source,
                output: &output,
                segments: std::slice::from_ref(&segment),
                segment_anchors: std::collections::BTreeMap::new(),
            })
            .expect("export");
        let result = fs::read_to_string(&output).expect("read");
        assert!(
            result.contains(
                "<mrk mid=\"0\" mtype=\"seg\">Welcome to <bpt id=\"1\">&lt;em></bpt>Aurora<ept id=\"1\">&lt;/em></ept></mrk>"
            ),
            "unedited tagged target must keep original inner, got {result}"
        );
        assert!(
            !result.contains("Welcome<em>") && !result.contains("to Aur"),
            "must not reflow unmoved tags: {result}"
        );
    }

    #[test]
    fn okapi_tikal_export_keeps_codes_when_text_changes() {
        let directory = tempfile::tempdir().expect("temp");
        let source = directory.path().join("sample.html.xlf");
        let output = directory.path().join("exported.xlf");
        fs::write(&source, tikal_tagged_unit()).expect("write Tikal-shaped XLIFF");
        let units = load(&source);
        let segment = Segment {
            id: "s1".to_string(),
            document_id: "d1".to_string(),
            ordinal: 0,
            structural_path: units[0].structural_path.clone(),
            source_text: units[0].source_text.clone(),
            target_text: "欢迎来到极光".to_string(),
            state: SegmentState::Confirmed,
            revision: 1,
            source_hash: String::new(),
            context_hash: String::new(),
            updated_at_ms: 0,
            origin: None,
        };
        XliffFilter
            .export(ExportRequest {
                source: &source,
                output: &output,
                segments: std::slice::from_ref(&segment),
                segment_anchors: std::collections::BTreeMap::new(),
            })
            .expect("export");
        let result = fs::read_to_string(&output).expect("read");
        assert!(result.contains("<bpt id=\"1\">&lt;em></bpt>"), "{result}");
        assert!(result.contains("<ept id=\"1\">&lt;/em></ept>"), "{result}");
        let exported = load(&output);
        assert_eq!(exported[0].target_text.as_deref(), Some("欢迎来到极光"));
    }

    #[test]
    fn rejects_unsupported_or_malformed_xliff() {
        let directory = tempfile::tempdir().expect("temp");
        let unsupported = directory.path().join("unsupported.xlf");
        fs::write(&unsupported, r#"<xliff version="3.0"></xliff>"#).expect("write");
        assert!(matches!(
            XliffFilter.validate(&unsupported),
            Err(FilterError::Invalid(_))
        ));
        let malformed = directory.path().join("malformed.xlf");
        fs::write(&malformed, r#"<xliff version="1.2"><file>"#).expect("write");
        assert!(matches!(
            XliffFilter.validate(&malformed),
            Err(FilterError::Invalid(_))
        ));
        let doctype = directory.path().join("doctype.xlf");
        fs::write(
            &doctype,
            r#"<!DOCTYPE xliff SYSTEM "remote.dtd"><xliff version="1.2"></xliff>"#,
        )
        .expect("write");
        assert!(matches!(
            XliffFilter.validate(&doctype),
            Err(FilterError::Invalid(_))
        ));
    }
}

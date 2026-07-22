//! Conservative interchange filters for external CAT handoffs.
//!
//! SDLXLIFF and MQXLIFF are deliberately normalized into the existing generic
//! filter event stream.  The original XML/ZIP remains the immutable export
//! base, so unknown vendor metadata is never reconstructed by the renderer.

mod review;
pub use review::*;

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::fs;
use std::io::{Cursor, Read, Seek, SeekFrom};
use std::ops::Range;
use std::path::Path;

use thiserror::Error;
use translunar_domain::{
    DegradationFinding, DegradationSeverity, DocumentNote, InlineTag, TagKind, TagSide,
};
use translunar_filter_core::{
    DocumentFilter, DocumentMetadata, ExportReport, ExportRequest, FilterCapabilities,
    FilterDescriptor, FilterError, FilterEvent, FilterEventStream, ImportRequest, ProbeResult,
    ValidationReport, publish_bytes_noclobber,
};
use translunar_filter_office_core::rebuild_zip as rebuild_zip_raw;
use zip::ZipArchive;

const MAX_XML_BYTES: u64 = 64 * 1024 * 1024;
const MAX_XML_DEPTH: usize = 256;
const MAX_UNITS: usize = 100_000;
const MAX_ZIP_ENTRIES: usize = 4_096;
const MAX_ZIP_NAME_BYTES: usize = 4_096;
const MAX_ZIP_ENTRY_BYTES: u64 = 256 * 1024 * 1024;
const MAX_ZIP_TOTAL_BYTES: u64 = 1024 * 1024 * 1024;
const MAX_COMPRESSION_RATIO: u64 = 200;
const ATOMIC_INLINE: &[&str] = &["bpt", "ept", "it", "ph", "x", "sc", "ec"];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Vendor {
    Sdl,
    MemoQ,
}

impl Vendor {
    fn id(self) -> &'static str {
        match self {
            Self::Sdl => "sdlxliff",
            Self::MemoQ => "mqxliff",
        }
    }

    fn filter_id(self) -> &'static str {
        match self {
            Self::Sdl => "builtin.sdlxliff",
            Self::MemoQ => "builtin.mqxliff",
        }
    }

    fn display_name(self) -> &'static str {
        match self {
            Self::Sdl => "SDLXLIFF",
            Self::MemoQ => "memoQ XLIFF",
        }
    }

    fn extensions(self) -> Vec<String> {
        match self {
            Self::Sdl => vec!["sdlxliff".to_string()],
            Self::MemoQ => vec!["mqxliff".to_string()],
        }
    }
}

#[derive(Debug, Error)]
enum InteropError {
    #[error("interchange input is too large")]
    TooLarge,
    #[error("invalid interchange XML: {0}")]
    Xml(String),
    #[error("invalid interchange ZIP: {0}")]
    Zip(String),
    #[error("interchange path is not present: {0}")]
    MissingPath(String),
    #[error("interchange source identity changed during export")]
    SourceChanged,
    #[error("interchange I/O failed: {0}")]
    Io(#[from] std::io::Error),
}

#[derive(Debug, Clone)]
enum TokenKind {
    Text,
    CData,
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
    raw_attrs: BTreeMap<String, String>,
    start_tag: Range<usize>,
    inner: Range<usize>,
    end_tag: Option<Range<usize>>,
    parent: Option<usize>,
    end_token: Option<usize>,
}

#[derive(Debug, Clone)]
struct XmlDoc {
    text: String,
    tokens: Vec<Token>,
    nodes: Vec<Node>,
    children: Vec<Vec<usize>>,
    nodes_by_id: BTreeMap<String, Vec<usize>>,
    root: usize,
}

#[derive(Debug, Clone)]
struct Unit {
    path: String,
    source: String,
    target: Option<String>,
    target_range: Option<Range<usize>>,
    insert_at: usize,
    insert_open: String,
    insert_close: String,
    source_template: String,
    target_template: Option<String>,
    source_tags: Vec<TagData>,
    target_tags: Vec<TagData>,
    notes: Vec<DocumentNote>,
}

#[derive(Debug, Clone)]
struct TagData {
    position: u32,
    kind: TagKind,
    pair_id: Option<String>,
    payload: String,
    display_text: String,
}

#[derive(Debug, Clone)]
struct Parsed {
    units: Vec<Unit>,
    source_locale: Option<String>,
    target_locale: Option<String>,
    degradation: Vec<DegradationFinding>,
}

#[derive(Debug, Clone, Copy)]
struct LogicalUnitScope<'a> {
    root: usize,
    source: usize,
    target: Option<usize>,
    segment_id: Option<&'a str>,
}

#[derive(Debug, Clone, Copy)]
struct XmlFilter {
    vendor: Vendor,
}

#[derive(Debug, Clone, Copy)]
pub struct SdlxliffFilter;

#[derive(Debug, Clone, Copy)]
pub struct MqxliffFilter;

#[derive(Debug, Clone, Copy)]
pub struct MqxlzFilter;

impl DocumentFilter for SdlxliffFilter {
    fn descriptor(&self) -> FilterDescriptor {
        XmlFilter {
            vendor: Vendor::Sdl,
        }
        .descriptor()
    }
    fn probe(&self, source: &Path) -> Result<ProbeResult, FilterError> {
        XmlFilter {
            vendor: Vendor::Sdl,
        }
        .probe(source)
    }
    fn import(&self, request: ImportRequest) -> Result<FilterEventStream, FilterError> {
        XmlFilter {
            vendor: Vendor::Sdl,
        }
        .import(request)
    }
    fn export(&self, request: ExportRequest<'_>) -> Result<ExportReport, FilterError> {
        XmlFilter {
            vendor: Vendor::Sdl,
        }
        .export(request)
    }
    fn validate(&self, source: &Path) -> Result<ValidationReport, FilterError> {
        XmlFilter {
            vendor: Vendor::Sdl,
        }
        .validate(source)
    }
}

impl DocumentFilter for MqxliffFilter {
    fn descriptor(&self) -> FilterDescriptor {
        XmlFilter {
            vendor: Vendor::MemoQ,
        }
        .descriptor()
    }
    fn probe(&self, source: &Path) -> Result<ProbeResult, FilterError> {
        XmlFilter {
            vendor: Vendor::MemoQ,
        }
        .probe(source)
    }
    fn import(&self, request: ImportRequest) -> Result<FilterEventStream, FilterError> {
        XmlFilter {
            vendor: Vendor::MemoQ,
        }
        .import(request)
    }
    fn export(&self, request: ExportRequest<'_>) -> Result<ExportReport, FilterError> {
        XmlFilter {
            vendor: Vendor::MemoQ,
        }
        .export(request)
    }
    fn validate(&self, source: &Path) -> Result<ValidationReport, FilterError> {
        XmlFilter {
            vendor: Vendor::MemoQ,
        }
        .validate(source)
    }
}

impl DocumentFilter for MqxlzFilter {
    fn descriptor(&self) -> FilterDescriptor {
        FilterDescriptor {
            id: "builtin.mqxlz".to_string(),
            version: env!("CARGO_PKG_VERSION").to_string(),
            display_name: "memoQ MQXLZ package".to_string(),
            extensions: vec!["mqxlz".to_string()],
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
        if !has_extension(source, "mqxlz") {
            return Ok(ProbeResult::no_match("file extension is not MQXLZ"));
        }
        let entries = read_zip(source).map_err(map_error)?;
        let (_, xml) = select_xml_entry(&entries).map_err(map_error)?;
        parse_vendor_xml(Vendor::MemoQ, xml, None).map_err(map_error)?;
        Ok(ProbeResult::matches(100, "supported MQXLZ package"))
    }

    fn import(&self, request: ImportRequest) -> Result<FilterEventStream, FilterError> {
        let entries = read_zip(&request.source).map_err(map_error)?;
        let (name, bytes) = select_xml_entry(&entries).map_err(map_error)?;
        let parsed = parse_vendor_xml(Vendor::MemoQ, bytes, Some(name)).map_err(map_error)?;
        events_for(
            Vendor::MemoQ,
            request.document_id.as_deref(),
            request.source_locale,
            parsed,
        )
    }

    fn export(&self, request: ExportRequest<'_>) -> Result<ExportReport, FilterError> {
        let entries = read_zip(request.source).map_err(map_error)?;
        let (xml_name, xml_bytes) = select_xml_entry(&entries).map_err(map_error)?;
        let report = export_xml(Vendor::MemoQ, xml_bytes, request.segments, Some(xml_name))
            .map_err(map_error)?;
        let mut replacements = BTreeMap::new();
        replacements.insert(xml_name.to_string(), report.0);
        let bytes = rebuild_zip_raw(request.source, &replacements)
            .map_err(|error| map_error(InteropError::Zip(error.to_string())))?;
        let rebuilt_entries = read_zip_bytes(&bytes).map_err(map_error)?;
        let (rebuilt_name, rebuilt_xml) = select_xml_entry(&rebuilt_entries).map_err(map_error)?;
        if rebuilt_name != xml_name {
            return Err(map_error(InteropError::SourceChanged));
        }
        parse_vendor_xml(Vendor::MemoQ, rebuilt_xml, Some(rebuilt_name)).map_err(map_error)?;
        publish_bytes_noclobber(request.output, &bytes)?;
        Ok(ExportReport {
            output_path: request.output.display().to_string(),
            translated_segments: report.1,
            degradation: report.2,
        })
    }

    fn validate(&self, source: &Path) -> Result<ValidationReport, FilterError> {
        let entries = read_zip(source).map_err(map_error)?;
        let (name, bytes) = select_xml_entry(&entries).map_err(map_error)?;
        let parsed = parse_vendor_xml(Vendor::MemoQ, bytes, Some(name)).map_err(map_error)?;
        Ok(ValidationReport {
            valid: true,
            findings: parsed.degradation,
        })
    }
}

impl XmlFilter {
    fn descriptor(self) -> FilterDescriptor {
        FilterDescriptor {
            id: self.vendor.filter_id().to_string(),
            version: env!("CARGO_PKG_VERSION").to_string(),
            display_name: self.vendor.display_name().to_string(),
            extensions: self.vendor.extensions(),
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

    fn probe(self, source: &Path) -> Result<ProbeResult, FilterError> {
        if !has_extension(source, self.vendor.extensions()[0].as_str()) {
            return Ok(ProbeResult::no_match(
                "file extension does not match vendor format",
            ));
        }
        parse_vendor_file(self.vendor, source, None).map_err(map_error)?;
        Ok(ProbeResult::matches(100, "supported vendor XLIFF"))
    }

    fn import(self, request: ImportRequest) -> Result<FilterEventStream, FilterError> {
        let parsed = parse_vendor_file(self.vendor, &request.source, None).map_err(map_error)?;
        events_for(
            self.vendor,
            request.document_id.as_deref(),
            request.source_locale,
            parsed,
        )
    }

    fn export(self, request: ExportRequest<'_>) -> Result<ExportReport, FilterError> {
        let bytes = read_bounded(request.source).map_err(map_error)?;
        let (output, count, degradation) =
            export_xml(self.vendor, &bytes, request.segments, None).map_err(map_error)?;
        publish_bytes_noclobber(request.output, &output)?;
        Ok(ExportReport {
            output_path: request.output.display().to_string(),
            translated_segments: count,
            degradation,
        })
    }

    fn validate(self, source: &Path) -> Result<ValidationReport, FilterError> {
        let parsed = parse_vendor_file(self.vendor, source, None).map_err(map_error)?;
        Ok(ValidationReport {
            valid: true,
            findings: parsed.degradation,
        })
    }
}

fn events_for(
    vendor: Vendor,
    document_id: Option<&str>,
    fallback_source_locale: Option<String>,
    parsed: Parsed,
) -> Result<FilterEventStream, FilterError> {
    if parsed.units.is_empty() {
        return Err(FilterError::Invalid(
            "vendor package contains no translatable units".to_string(),
        ));
    }
    let prefix = document_id.unwrap_or("unmanaged");
    let mut properties = BTreeMap::new();
    properties.insert("vendor".to_string(), vendor.id().to_string());
    properties.insert("unitCount".to_string(), parsed.units.len().to_string());
    if let Some(locale) = &parsed.target_locale {
        properties.insert("targetLocale".to_string(), locale.clone());
    }
    let mut events = Vec::with_capacity(parsed.units.len() * 8 + 3);
    events.push(Ok(FilterEvent::StartDocument {
        metadata: DocumentMetadata {
            format: vendor.id().to_string(),
            source_locale: parsed.source_locale.or(fallback_source_locale),
            properties,
        },
    }));
    for (ordinal, unit) in parsed.units.iter().enumerate() {
        events.push(Ok(FilterEvent::StartUnit {
            ordinal: u32::try_from(ordinal)
                .map_err(|_| FilterError::Invalid("unit count exceeds u32".to_string()))?,
            structural_path: unit.path.clone(),
        }));
        events.push(Ok(FilterEvent::Text(unit.source.clone())));
        for (index, tag) in unit.source_tags.iter().enumerate() {
            events.push(Ok(FilterEvent::InlineTag(InlineTag {
                id: format!("{prefix}-interop-source-{ordinal}-{index}"),
                side: TagSide::Source,
                position: tag.position,
                kind: tag.kind,
                pair_id: tag
                    .pair_id
                    .as_ref()
                    .map(|pair| format!("{prefix}-interop-source-pair-{ordinal}-{pair}")),
                payload: tag.payload.clone(),
                display_text: tag.display_text.clone(),
                protected: true,
            })));
        }
        if let Some(target) = &unit.target {
            events.push(Ok(FilterEvent::TargetText(target.clone())));
        }
        for (index, tag) in unit.target_tags.iter().enumerate() {
            events.push(Ok(FilterEvent::InlineTag(InlineTag {
                id: format!("{prefix}-interop-target-{ordinal}-{index}"),
                side: TagSide::Target,
                position: tag.position,
                kind: tag.kind,
                pair_id: tag
                    .pair_id
                    .as_ref()
                    .map(|pair| format!("{prefix}-interop-target-pair-{ordinal}-{pair}")),
                payload: tag.payload.clone(),
                display_text: tag.display_text.clone(),
                protected: true,
            })));
        }
        for (index, note) in unit.notes.iter().enumerate() {
            let mut note = note.clone();
            note.id = format!("{prefix}-interop-note-{ordinal}-{index}-{}", note.id);
            events.push(Ok(FilterEvent::Note(note)));
        }
        events.push(Ok(FilterEvent::EndUnit));
    }
    for finding in parsed.degradation {
        events.push(Ok(FilterEvent::Degradation(finding)));
    }
    events.push(Ok(FilterEvent::EndDocument));
    Ok(Box::new(events.into_iter()))
}

fn parse_vendor_file(
    vendor: Vendor,
    path: &Path,
    entry: Option<&str>,
) -> Result<Parsed, InteropError> {
    let bytes = read_bounded(path)?;
    parse_vendor_xml(vendor, &bytes, entry)
}

fn parse_vendor_xml(
    vendor: Vendor,
    bytes: &[u8],
    entry: Option<&str>,
) -> Result<Parsed, InteropError> {
    if u64::try_from(bytes.len()).unwrap_or(u64::MAX) > MAX_XML_BYTES {
        return Err(InteropError::TooLarge);
    }
    let doc = parse_xml(bytes)?;
    if doc.nodes[doc.root].name != "xliff" {
        return Err(InteropError::Xml("root element is not xliff".to_string()));
    }
    let version = doc.nodes[doc.root]
        .attrs
        .get("version")
        .ok_or_else(|| InteropError::Xml("xliff version is missing".to_string()))?;
    if version != "1.2" && !version.starts_with("2.") {
        return Err(InteropError::Xml("unsupported xliff version".to_string()));
    }
    let source_locale = doc.nodes[doc.root]
        .attrs
        .get("srclang")
        .cloned()
        .or_else(|| doc.nodes[doc.root].attrs.get("source-language").cloned())
        .or_else(|| first_file_attr(&doc, "source-language"));
    let target_locale = doc.nodes[doc.root]
        .attrs
        .get("trglang")
        .cloned()
        .or_else(|| doc.nodes[doc.root].attrs.get("target-language").cloned())
        .or_else(|| first_file_attr(&doc, "target-language"));
    let mut units = Vec::new();
    let mut degradation = Vec::new();
    let mut paths = BTreeSet::new();
    for (index, node) in doc.nodes.iter().enumerate() {
        if node.name == "trans-unit" {
            append_trans_unit(
                &doc,
                vendor,
                entry,
                index,
                &mut paths,
                &mut units,
                &mut degradation,
            )?;
        } else if node.name == "segment"
            && child_index(&doc, index, "source").is_some()
            && ancestor_index(&doc, index, "trans-unit").is_none()
        {
            append_xliff2_segment(
                &doc,
                vendor,
                entry,
                index,
                &mut paths,
                &mut units,
                &mut degradation,
            )?;
        }
    }
    if units.is_empty() {
        degradation.push(DegradationFinding {
            code: "no_vendor_units".to_string(),
            severity: DegradationSeverity::Error,
            message: "no supported vendor units were found".to_string(),
            structural_path: None,
        });
    }
    Ok(Parsed {
        units,
        source_locale,
        target_locale,
        degradation,
    })
}

#[allow(clippy::too_many_arguments)]
fn append_trans_unit(
    doc: &XmlDoc,
    vendor: Vendor,
    entry: Option<&str>,
    unit_index: usize,
    paths: &mut BTreeSet<String>,
    units: &mut Vec<Unit>,
    degradation: &mut Vec<DegradationFinding>,
) -> Result<(), InteropError> {
    let source_container = child_index(doc, unit_index, "seg-source")
        .or_else(|| child_index(doc, unit_index, "source"))
        .ok_or_else(|| InteropError::Xml("translatable unit has no source".to_string()))?;
    let target_container = child_index(doc, unit_index, "target");
    let unit_id = doc.nodes[unit_index]
        .attrs
        .get("id")
        .cloned()
        .ok_or_else(|| InteropError::Xml("translatable unit has no stable id".to_string()))?;
    let file_id = ancestor_attr(doc, unit_index, "file", "id")
        .or_else(|| ancestor_attr(doc, unit_index, "file", "original"))
        .unwrap_or_else(|| "file".to_string());
    let source_markers = segment_marker_indices(doc, source_container);
    if source_markers.is_empty() {
        append_unit(
            doc,
            vendor,
            entry,
            &file_id,
            &unit_id,
            None,
            unit_index,
            source_container,
            target_container,
            None,
            paths,
            units,
            degradation,
        )?;
        return Ok(());
    }

    let target_markers = target_container
        .map(|container| segment_marker_indices(doc, container))
        .unwrap_or_default();
    let mut target_marker_ids = BTreeSet::new();
    for target_index in &target_markers {
        if let Some(target_id) = marker_identity(&doc.nodes[*target_index])
            && !target_marker_ids.insert(target_id)
        {
            return Err(InteropError::Xml(
                "duplicate vendor target marker identity".to_string(),
            ));
        }
    }
    for (ordinal, source_index) in source_markers.iter().copied().enumerate() {
        let source_marker_id = marker_identity(&doc.nodes[source_index]);
        let segment_id = source_marker_id
            .clone()
            .unwrap_or_else(|| format!("segment-{ordinal}"));
        let exact_target = source_marker_id.as_deref().and_then(|source_id| {
            target_markers.iter().copied().find(|candidate| {
                marker_identity(&doc.nodes[*candidate]).as_deref() == Some(source_id)
            })
        });
        let positional_target = target_markers.get(ordinal).copied();
        let target_index = if let Some(exact_target) = exact_target {
            Some(exact_target)
        } else if source_marker_id.is_none()
            || positional_target
                .is_some_and(|candidate| marker_identity(&doc.nodes[candidate]).is_none())
        {
            positional_target
        } else if positional_target.is_some() {
            return Err(InteropError::Xml(
                "vendor source and target marker identities do not match".to_string(),
            ));
        } else {
            None
        };
        if target_container.is_some() && target_index.is_none() {
            degradation.push(DegradationFinding {
                code: "missing_vendor_target_marker".to_string(),
                severity: DegradationSeverity::Warning,
                message: "a missing vendor target marker will be recreated on export".to_string(),
                structural_path: None,
            });
        }
        append_unit(
            doc,
            vendor,
            entry,
            &file_id,
            &unit_id,
            Some(&segment_id),
            unit_index,
            source_index,
            target_index,
            target_container,
            paths,
            units,
            degradation,
        )?;
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn append_xliff2_segment(
    doc: &XmlDoc,
    vendor: Vendor,
    entry: Option<&str>,
    segment_index: usize,
    paths: &mut BTreeSet<String>,
    units: &mut Vec<Unit>,
    degradation: &mut Vec<DegradationFinding>,
) -> Result<(), InteropError> {
    let source_index = child_index(doc, segment_index, "source")
        .ok_or_else(|| InteropError::Xml("translatable segment has no source".to_string()))?;
    let target_index = child_index(doc, segment_index, "target");
    let unit_id = ancestor_attr(doc, segment_index, "unit", "id")
        .or_else(|| doc.nodes[segment_index].attrs.get("id").cloned())
        .ok_or_else(|| InteropError::Xml("translatable unit has no stable id".to_string()))?;
    let segment_id = doc.nodes[segment_index]
        .attrs
        .get("id")
        .cloned()
        .unwrap_or_else(|| "segment".to_string());
    let file_id = ancestor_attr(doc, segment_index, "file", "id")
        .or_else(|| ancestor_attr(doc, segment_index, "file", "original"))
        .unwrap_or_else(|| "file".to_string());
    let scope = ancestor_index(doc, segment_index, "unit").unwrap_or(segment_index);
    append_unit(
        doc,
        vendor,
        entry,
        &file_id,
        &unit_id,
        Some(&segment_id),
        scope,
        source_index,
        target_index,
        None,
        paths,
        units,
        degradation,
    )
}

#[allow(clippy::too_many_arguments)]
fn append_unit(
    doc: &XmlDoc,
    vendor: Vendor,
    entry: Option<&str>,
    file_id: &str,
    unit_id: &str,
    segment_id: Option<&str>,
    scope_index: usize,
    source_index: usize,
    target_index: Option<usize>,
    target_container: Option<usize>,
    paths: &mut BTreeSet<String>,
    units: &mut Vec<Unit>,
    degradation: &mut Vec<DegradationFinding>,
) -> Result<(), InteropError> {
    if units.len() >= MAX_UNITS {
        return Err(InteropError::Xml(
            "translatable unit count exceeds limit".to_string(),
        ));
    }
    let mut path_parts = vec![vendor.id().to_string()];
    if let Some(entry) = entry {
        path_parts.push(encode_id(entry));
    }
    path_parts.push(encode_id(file_id));
    path_parts.push(encode_id(unit_id));
    if let Some(segment_id) = segment_id {
        path_parts.push(encode_id(segment_id));
    }
    let path = path_parts.join(":");
    if !paths.insert(path.clone()) {
        return Err(InteropError::Xml(
            "duplicate vendor structural path".to_string(),
        ));
    }

    let source_node = &doc.nodes[source_index];
    let source_inline = inline_content(doc, source_node.inner.clone())?;
    if source_inline.text.trim().is_empty() {
        return Err(InteropError::Xml(
            "translatable unit source is empty".to_string(),
        ));
    }
    let target_inline = target_index
        .map(|index| inline_content(doc, doc.nodes[index].inner.clone()))
        .transpose()?;
    let source_template = slice_text(&doc.text, source_node.inner.clone())?.to_string();
    let target_template = target_index
        .map(|index| slice_text(&doc.text, doc.nodes[index].inner.clone()))
        .transpose()?
        .map(str::to_string);

    let (insert_at, insert_open, insert_close) = if target_index.is_some() {
        (source_node.inner.end, String::new(), String::new())
    } else if let Some(container) = target_container {
        let open = slice_text(&doc.text, source_node.start_tag.clone())?.to_string();
        let close = source_node
            .end_tag
            .as_ref()
            .map(|range| slice_text(&doc.text, range.clone()))
            .transpose()?
            .map_or_else(String::new, str::to_string);
        (doc.nodes[container].inner.end, open, close)
    } else {
        let target_name = target_element_name(&source_node.raw_name);
        let insert = source_node
            .end_tag
            .as_ref()
            .map_or(source_node.inner.end, |range| range.end);
        (
            insert,
            format!("<{target_name}>"),
            format!("</{target_name}>"),
        )
    };

    let state_nodes = state_node_indices(doc, scope_index, source_index, target_index, segment_id);
    let logical_scope = LogicalUnitScope {
        root: scope_index,
        source: source_index,
        target: target_index,
        segment_id,
    };
    let mut notes = collect_vendor_notes(doc, logical_scope)?;
    notes.extend(collect_state_notes(doc, vendor, &state_nodes)?);
    notes.extend(collect_referenced_comments(doc, &state_nodes)?);
    collect_vendor_degradation(doc, vendor, logical_scope, &path, degradation);

    units.push(Unit {
        path,
        source: source_inline.text,
        target: target_inline.as_ref().map(|value| value.text.clone()),
        target_range: target_index.map(|index| doc.nodes[index].inner.clone()),
        insert_at,
        insert_open,
        insert_close,
        source_template,
        target_template,
        source_tags: source_inline.tags,
        target_tags: target_inline.map_or_else(Vec::new, |value| value.tags),
        notes,
    });
    Ok(())
}

fn export_xml(
    vendor: Vendor,
    bytes: &[u8],
    segments: &[translunar_domain::Segment],
    entry: Option<&str>,
) -> Result<(Vec<u8>, u32, Vec<DegradationFinding>), InteropError> {
    let parsed = parse_vendor_xml(vendor, bytes, entry)?;
    let by_path: HashMap<&str, &Unit> = parsed
        .units
        .iter()
        .map(|unit| (unit.path.as_str(), unit))
        .collect();
    let mut seen_paths = BTreeSet::new();
    let mut replacements = Vec::new();
    for segment in segments {
        if !seen_paths.insert(segment.structural_path.as_str()) {
            return Err(InteropError::Xml(
                "duplicate vendor structural path in export".to_string(),
            ));
        }
        let Some(unit) = by_path.get(segment.structural_path.as_str()) else {
            return Err(InteropError::MissingPath(segment.structural_path.clone()));
        };
        if segment.target_text.trim().is_empty()
            && segment.revision == 0
            && unit.target_range.is_none()
        {
            continue;
        }
        let template = unit
            .target_template
            .as_deref()
            .unwrap_or(&unit.source_template);
        let rendered = render_template(template, &segment.target_text)?;
        if let Some(range) = &unit.target_range {
            replacements.push((range.clone(), rendered.into_bytes()));
        } else {
            replacements.push((
                unit.insert_at..unit.insert_at,
                format!("{}{}{}", unit.insert_open, rendered, unit.insert_close).into_bytes(),
            ));
        }
    }
    replacements.sort_by_key(|item| std::cmp::Reverse(item.0.start));
    for pair in replacements.windows(2) {
        if pair[0].0.start < pair[1].0.end {
            return Err(InteropError::Xml(
                "overlapping vendor target ranges".to_string(),
            ));
        }
    }
    let mut output = bytes.to_vec();
    for (range, value) in replacements.iter() {
        output.splice(range.clone(), value.clone());
    }
    let reparsed = parse_vendor_xml(vendor, &output, entry)?;
    if reparsed.units.len() != parsed.units.len()
        || reparsed
            .units
            .iter()
            .zip(&parsed.units)
            .any(|(left, right)| left.path != right.path || left.source != right.source)
    {
        return Err(InteropError::SourceChanged);
    }
    Ok((
        output,
        u32::try_from(replacements.len())
            .map_err(|_| InteropError::Xml("translation count exceeds u32".to_string()))?,
        reparsed.degradation,
    ))
}

fn parse_xml(bytes: &[u8]) -> Result<XmlDoc, InteropError> {
    let text = std::str::from_utf8(bytes)
        .map_err(|error| {
            InteropError::Xml(format!("invalid UTF-8 at byte {}", error.valid_up_to()))
        })?
        .to_string();
    parse_xml_inner(text, true)
}

fn parse_fragment(text: &str) -> Result<XmlDoc, InteropError> {
    parse_xml_inner(text.to_string(), false)
}

fn parse_xml_inner(text: String, require_root: bool) -> Result<XmlDoc, InteropError> {
    let mut tokens = Vec::new();
    let mut nodes: Vec<Node> = Vec::new();
    let mut stack: Vec<usize> = Vec::new();
    let mut cursor = 0usize;
    while cursor < text.len() {
        let Some(relative) = text[cursor..].find('<') else {
            if cursor < text.len() {
                decode_character_data(&text[cursor..])?;
                tokens.push(Token {
                    range: cursor..text.len(),
                    kind: TokenKind::Text,
                });
            }
            break;
        };
        let open = cursor + relative;
        if open > cursor {
            decode_character_data(&text[cursor..open])?;
            tokens.push(Token {
                range: cursor..open,
                kind: TokenKind::Text,
            });
        }
        if text[open..].starts_with("<!--") {
            let relative_end = text[open + 4..]
                .find("-->")
                .ok_or_else(|| InteropError::Xml("unterminated comment".to_string()))?;
            let content_end = open + 4 + relative_end;
            let content = &text[open + 4..content_end];
            if content.contains("--") || content.ends_with('-') {
                return Err(InteropError::Xml("invalid XML comment".to_string()));
            }
            let end = content_end + 3;
            tokens.push(Token {
                range: open..end,
                kind: TokenKind::Raw,
            });
            cursor = end;
            continue;
        }
        if text[open..].starts_with("<![CDATA[") {
            let content_start = open + 9;
            let content_end = text[content_start..]
                .find("]]>")
                .map(|end| content_start + end)
                .ok_or_else(|| InteropError::Xml("unterminated CDATA".to_string()))?;
            if content_start < content_end {
                tokens.push(Token {
                    range: content_start..content_end,
                    kind: TokenKind::CData,
                });
            }
            cursor = content_end + 3;
            continue;
        }
        if text[open..]
            .get(..9)
            .is_some_and(|value| value.eq_ignore_ascii_case("<!DOCTYPE"))
        {
            return Err(InteropError::Xml("DOCTYPE is unsupported".to_string()));
        }
        if text[open..].starts_with("<!") {
            return Err(InteropError::Xml(
                "XML declarations with external content are unsupported".to_string(),
            ));
        }
        let end = find_tag_end(&text, open)?;
        let raw = &text[open..end];
        if let Some(rest) = raw.strip_prefix("</") {
            let name = element_name(rest)?;
            let index = stack
                .pop()
                .ok_or_else(|| InteropError::Xml("unexpected closing tag".to_string()))?;
            if nodes[index].raw_name != name {
                return Err(InteropError::Xml("mismatched closing tag".to_string()));
            }
            nodes[index].inner.end = open;
            nodes[index].end_tag = Some(open..end);
            nodes[index].end_token = Some(tokens.len());
            tokens.push(Token {
                range: open..end,
                kind: TokenKind::End { node: index },
            });
            cursor = end;
            continue;
        }
        if raw.starts_with("<?") {
            if !raw.ends_with("?>") {
                return Err(InteropError::Xml(
                    "processing instruction is not terminated with ?>".to_string(),
                ));
            }
            tokens.push(Token {
                range: open..end,
                kind: TokenKind::Raw,
            });
            cursor = end;
            continue;
        }
        let self_closing = raw[..raw.len().saturating_sub(1)].trim_end().ends_with('/');
        let body = raw
            .trim_start_matches('<')
            .trim_end_matches('>')
            .trim_end_matches('/')
            .trim();
        let name_end = body.find(char::is_whitespace).unwrap_or(body.len());
        let raw_name = body[..name_end].to_string();
        if raw_name.is_empty() {
            return Err(InteropError::Xml("start tag has no name".to_string()));
        }
        let parent = stack.last().copied();
        let index = nodes.len();
        let (attrs, raw_attrs) = parse_attrs(raw, name_end + 1)?;
        nodes.push(Node {
            raw_name: raw_name.clone(),
            name: local_name(&raw_name),
            attrs,
            raw_attrs,
            start_tag: open..end,
            inner: end..end,
            end_tag: None,
            parent,
            end_token: None,
        });
        if self_closing {
            tokens.push(Token {
                range: open..end,
                kind: TokenKind::Empty { node: index },
            });
        } else {
            tokens.push(Token {
                range: open..end,
                kind: TokenKind::Start { node: index },
            });
            if stack.len() >= MAX_XML_DEPTH {
                return Err(InteropError::Xml("XML depth limit exceeded".to_string()));
            }
            nodes[index].inner.start = end;
            stack.push(index);
        }
        cursor = end;
    }
    if !stack.is_empty() {
        return Err(InteropError::Xml("unclosed XML element".to_string()));
    }
    let roots: Vec<usize> = nodes
        .iter()
        .enumerate()
        .filter(|(_, node)| node.parent.is_none())
        .map(|(index, _)| index)
        .collect();
    if require_root && roots.len() != 1 {
        return Err(InteropError::Xml("XML must have one root".to_string()));
    }
    let root = roots.first().copied().unwrap_or(0);
    if require_root {
        let root_node = &nodes[root];
        let root_end = root_node
            .end_tag
            .as_ref()
            .map_or(root_node.start_tag.end, |range| range.end);
        for token in &tokens {
            let outside_root =
                token.range.start < root_node.start_tag.start || token.range.end > root_end;
            if !outside_root {
                continue;
            }
            match &token.kind {
                TokenKind::Text
                    if !decode_character_data(&text[token.range.clone()])?
                        .trim()
                        .is_empty() =>
                {
                    return Err(InteropError::Xml(
                        "non-whitespace text exists outside the root element".to_string(),
                    ));
                }
                TokenKind::CData => {
                    return Err(InteropError::Xml(
                        "CDATA exists outside the root element".to_string(),
                    ));
                }
                _ => {}
            }
        }
    }
    let mut children = vec![Vec::new(); nodes.len()];
    let mut nodes_by_id = BTreeMap::<String, Vec<usize>>::new();
    for (index, node) in nodes.iter().enumerate() {
        if let Some(parent) = node.parent {
            children[parent].push(index);
        }
        if let Some(id) = node.attrs.get("id") {
            nodes_by_id.entry(id.clone()).or_default().push(index);
        }
    }
    Ok(XmlDoc {
        text,
        tokens,
        nodes,
        children,
        nodes_by_id,
        root,
    })
}

fn child_index(doc: &XmlDoc, parent: usize, name: &str) -> Option<usize> {
    doc.children
        .get(parent)?
        .iter()
        .copied()
        .find(|index| doc.nodes[*index].name == name)
}

fn first_file_attr(doc: &XmlDoc, attr: &str) -> Option<String> {
    doc.nodes
        .iter()
        .find(|node| node.name == "file")
        .and_then(|node| node.attrs.get(attr).cloned())
}

fn ancestor_attr(doc: &XmlDoc, mut index: usize, name: &str, attr: &str) -> Option<String> {
    loop {
        let node = &doc.nodes[index];
        if node.name == name
            && let Some(value) = node.attrs.get(attr)
        {
            return Some(value.clone());
        }
        index = node.parent?;
    }
}

fn ancestor_index(doc: &XmlDoc, mut index: usize, name: &str) -> Option<usize> {
    loop {
        if doc.nodes[index].name == name {
            return Some(index);
        }
        index = doc.nodes[index].parent?;
    }
}

fn is_descendant(doc: &XmlDoc, mut index: usize, ancestor: usize) -> bool {
    while let Some(parent) = doc.nodes[index].parent {
        if parent == ancestor {
            return true;
        }
        index = parent;
    }
    false
}

fn subtree_range(doc: &XmlDoc, root: usize) -> Range<usize> {
    let boundary = doc.nodes[root].inner.end;
    let mut end = root.saturating_add(1);
    while end < doc.nodes.len() && doc.nodes[end].start_tag.start < boundary {
        end += 1;
    }
    root..end
}

fn segment_marker_indices(doc: &XmlDoc, container: usize) -> Vec<usize> {
    let mut candidates = subtree_range(doc, container)
        .skip(1)
        .filter(|index| {
            let node = &doc.nodes[*index];
            node.name == "seg"
                || (node.name == "mrk"
                    && (node.attrs.contains_key("mid")
                        || node.attrs.contains_key("segmentid")
                        || node
                            .attrs
                            .get("mtype")
                            .is_some_and(|value| value.eq_ignore_ascii_case("seg"))))
        })
        .collect::<Vec<_>>();
    let nested = candidates.clone();
    candidates.retain(|candidate| {
        !nested
            .iter()
            .any(|other| other != candidate && is_descendant(doc, *other, *candidate))
    });
    candidates
}

fn marker_identity(node: &Node) -> Option<String> {
    ["mid", "id", "segmentid", "segment-id"]
        .iter()
        .find_map(|key| node.attrs.get(*key).cloned())
}

fn state_node_indices(
    doc: &XmlDoc,
    scope: usize,
    source: usize,
    target: Option<usize>,
    segment_id: Option<&str>,
) -> Vec<usize> {
    let mut result = vec![scope];
    for leaf in [Some(source), target].into_iter().flatten() {
        let mut current = Some(leaf);
        while let Some(index) = current {
            result.push(index);
            if index == scope {
                break;
            }
            current = doc.nodes[index].parent;
        }
    }
    if let Some(segment_id) = segment_id {
        result.extend(subtree_range(doc, scope).skip(1).filter(|index| {
            let node = &doc.nodes[*index];
            node.name == "seg" && marker_identity(node).as_deref() == Some(segment_id)
        }));
    }
    result.sort_unstable();
    result.dedup();
    result
}

fn is_logical_segment_marker(doc: &XmlDoc, index: usize) -> bool {
    let node = &doc.nodes[index];
    node.name == "segment"
        || node.name == "seg"
        || (node.name == "mrk"
            && (node.attrs.contains_key("mid")
                || node.attrs.contains_key("segmentid")
                || node
                    .attrs
                    .get("mtype")
                    .is_some_and(|value| value.eq_ignore_ascii_case("seg"))))
}

fn node_applies_to_segment(doc: &XmlDoc, mut index: usize, scope: LogicalUnitScope<'_>) -> bool {
    loop {
        if index == scope.source || Some(index) == scope.target {
            return true;
        }
        if index != scope.root && is_logical_segment_marker(doc, index) {
            return scope
                .segment_id
                .is_some_and(|id| marker_identity(&doc.nodes[index]).as_deref() == Some(id));
        }
        if index == scope.root {
            return true;
        }
        let Some(parent) = doc.nodes[index].parent else {
            return false;
        };
        index = parent;
    }
}

fn collect_vendor_notes(
    doc: &XmlDoc,
    scope: LogicalUnitScope<'_>,
) -> Result<Vec<DocumentNote>, InteropError> {
    let mut notes = Vec::new();
    for index in subtree_range(doc, scope.root).skip(1) {
        let node = &doc.nodes[index];
        if !matches!(node.name.as_str(), "note" | "comment")
            || !node_applies_to_segment(doc, index, scope)
            || (node.name == "comment" && ancestor_index(doc, index, "cmt-def").is_some())
        {
            continue;
        }
        let text = inline_content(doc, node.inner.clone())?.text;
        if text.trim().is_empty() {
            continue;
        }
        notes.push(DocumentNote {
            id: node
                .attrs
                .get("id")
                .cloned()
                .unwrap_or_else(|| format!("vendor-note-{index}")),
            text,
            author: node
                .attrs
                .get("from")
                .cloned()
                .or_else(|| node.attrs.get("author").cloned())
                .or_else(|| node.attrs.get("user").cloned()),
        });
    }
    Ok(notes)
}

fn collect_state_notes(
    doc: &XmlDoc,
    vendor: Vendor,
    state_nodes: &[usize],
) -> Result<Vec<DocumentNote>, InteropError> {
    const STATE_KEYS: &[&str] = &[
        "state",
        "status",
        "conf",
        "locked",
        "confirmed",
        "approved",
        "translate",
        "origin",
        "percent",
        "match-quality",
    ];
    let mut notes = Vec::new();
    let mut seen = BTreeSet::new();
    for index in state_nodes {
        let node = &doc.nodes[*index];
        for key in STATE_KEYS {
            let Some(value) = node.attrs.get(*key) else {
                continue;
            };
            if !seen.insert((key.to_string(), value.clone())) {
                continue;
            }
            notes.push(DocumentNote {
                id: format!("{}-state-{}-{}", vendor.id(), index, encode_id(key)),
                text: value.clone(),
                author: Some(format!("{}-state", vendor.id())),
            });
        }
    }
    Ok(notes)
}

fn collect_referenced_comments(
    doc: &XmlDoc,
    state_nodes: &[usize],
) -> Result<Vec<DocumentNote>, InteropError> {
    let references = state_nodes
        .iter()
        .flat_map(|index| {
            ["cmt", "cid", "comment", "commentid"]
                .into_iter()
                .filter_map(|key| doc.nodes[*index].attrs.get(key).cloned())
        })
        .collect::<BTreeSet<_>>();
    let mut notes = Vec::new();
    for reference in references {
        let Some(candidates) = doc.nodes_by_id.get(&reference) else {
            continue;
        };
        for index in candidates {
            let node = &doc.nodes[*index];
            if !matches!(node.name.as_str(), "cmt-def" | "comment") {
                continue;
            }
            let comment = if node.name == "comment" {
                Some(*index)
            } else {
                subtree_range(doc, *index)
                    .skip(1)
                    .find(|candidate| doc.nodes[*candidate].name == "comment")
            };
            if let Some(comment) = comment {
                let comment_node = &doc.nodes[comment];
                let text = inline_content(doc, comment_node.inner.clone())?.text;
                if !text.trim().is_empty() {
                    notes.push(DocumentNote {
                        id: format!("vendor-comment-{}", encode_id(&reference)),
                        text,
                        author: comment_node
                            .attrs
                            .get("user")
                            .cloned()
                            .or_else(|| comment_node.attrs.get("author").cloned()),
                    });
                }
            }
        }
    }
    Ok(notes)
}

fn collect_vendor_degradation(
    doc: &XmlDoc,
    vendor: Vendor,
    scope: LogicalUnitScope<'_>,
    path: &str,
    findings: &mut Vec<DegradationFinding>,
) {
    const MAPPED_FIELDS: &[&str] = &[
        "state",
        "status",
        "conf",
        "locked",
        "confirmed",
        "approved",
        "translate",
        "origin",
        "percent",
        "match-quality",
        "cmt",
        "cid",
        "comment",
        "commentid",
        "id",
        "mid",
        "mtype",
        "segmentid",
        "segment-id",
    ];
    let has_unmapped = subtree_range(doc, scope.root).any(|index| {
        let node = &doc.nodes[index];
        let in_scope = node_applies_to_segment(doc, index, scope);
        in_scope
            && (node.raw_attrs.keys().any(|raw_name| {
                is_vendor_qualified(vendor, raw_name)
                    && !MAPPED_FIELDS.contains(&local_name(raw_name).as_str())
            }) || (index != scope.root
                && is_vendor_qualified(vendor, &node.raw_name)
                && !matches!(
                    node.name.as_str(),
                    "seg" | "seg-defs" | "mrk" | "cmt-defs" | "cmt-def" | "comment"
                )))
    });
    if has_unmapped {
        findings.push(DegradationFinding {
            code: "unsupported_vendor_field".to_string(),
            severity: DegradationSeverity::Warning,
            message: "an unsupported vendor field was preserved without local mapping".to_string(),
            structural_path: Some(path.to_string()),
        });
    }
}

fn is_vendor_qualified(vendor: Vendor, raw_name: &str) -> bool {
    let Some((prefix, _)) = raw_name.split_once(':') else {
        return false;
    };
    match vendor {
        Vendor::Sdl => prefix.eq_ignore_ascii_case("sdl"),
        Vendor::MemoQ => prefix.to_ascii_lowercase().starts_with("mq"),
    }
}

#[derive(Debug)]
struct InlineContent {
    text: String,
    tags: Vec<TagData>,
}

fn inline_content(doc: &XmlDoc, range: Range<usize>) -> Result<InlineContent, InteropError> {
    let fragment = slice_text(&doc.text, range)?;
    let parsed = parse_fragment(fragment)?;
    let mut text = String::new();
    let mut tags = Vec::new();
    let mut pair_ids = HashMap::<usize, String>::new();
    let mut index = 0;
    while index < parsed.tokens.len() {
        let token = &parsed.tokens[index];
        match &token.kind {
            TokenKind::Text => {
                text.push_str(&decode_text(slice_text(
                    &parsed.text,
                    token.range.clone(),
                )?)?);
                index += 1;
            }
            TokenKind::CData => {
                text.push_str(slice_text(&parsed.text, token.range.clone())?);
                index += 1;
            }
            TokenKind::Raw => index += 1,
            TokenKind::Start { node } => {
                let element = &parsed.nodes[*node];
                if ATOMIC_INLINE.contains(&element.name.as_str()) {
                    let end = element
                        .end_tag
                        .as_ref()
                        .map_or(element.start_tag.end, |value| value.end);
                    let (kind, pair_id) = atomic_inline_kind(element)?;
                    tags.push(TagData {
                        position: inline_position(&text)?,
                        kind,
                        pair_id,
                        payload: slice_text(&parsed.text, element.start_tag.start..end)?
                            .to_string(),
                        display_text: format!("<{}>", element.name),
                    });
                    index = element.end_token.map_or(index + 1, |value| value + 1);
                } else {
                    let pair_id = format!("pair-{node}");
                    pair_ids.insert(*node, pair_id.clone());
                    tags.push(TagData {
                        position: inline_position(&text)?,
                        kind: TagKind::Start,
                        pair_id: Some(pair_id),
                        payload: slice_text(&parsed.text, element.start_tag.clone())?.to_string(),
                        display_text: format!("<{}>", element.name),
                    });
                    index += 1;
                }
            }
            TokenKind::End { node } => {
                let element = &parsed.nodes[*node];
                tags.push(TagData {
                    position: inline_position(&text)?,
                    kind: TagKind::End,
                    pair_id: pair_ids.get(node).cloned(),
                    payload: slice_text(&parsed.text, token.range.clone())?.to_string(),
                    display_text: format!("</{}>", element.name),
                });
                index += 1;
            }
            TokenKind::Empty { node } => {
                let element = &parsed.nodes[*node];
                let (kind, pair_id) = atomic_inline_kind(element)?;
                tags.push(TagData {
                    position: inline_position(&text)?,
                    kind,
                    pair_id,
                    payload: slice_text(&parsed.text, element.start_tag.clone())?.to_string(),
                    display_text: format!("<{} />", element.name),
                });
                index += 1;
            }
        }
    }
    Ok(InlineContent { text, tags })
}

fn atomic_inline_kind(node: &Node) -> Result<(TagKind, Option<String>), InteropError> {
    let (kind, family) = match node.name.as_str() {
        "bpt" => (TagKind::Start, Some("bpt-ept")),
        "ept" => (TagKind::End, Some("bpt-ept")),
        "sc" => (TagKind::Start, Some("sc-ec")),
        "ec" => (TagKind::End, Some("sc-ec")),
        "it" => match node
            .attrs
            .get("pos")
            .map(|value| value.to_ascii_lowercase())
        {
            Some(value) if matches!(value.as_str(), "begin" | "open" | "start") => {
                (TagKind::Start, Some("it"))
            }
            Some(value) if matches!(value.as_str(), "end" | "close") => (TagKind::End, Some("it")),
            _ => (TagKind::Standalone, None),
        },
        _ => (TagKind::Standalone, None),
    };
    let pair_id = family
        .map(|family| {
            ["rid", "startref", "id"]
                .iter()
                .find_map(|key| node.attrs.get(*key))
                .map(|identity| format!("{family}:{}", encode_id(identity)))
                .ok_or_else(|| {
                    InteropError::Xml("paired inline code has no stable identity".to_string())
                })
        })
        .transpose()?;
    Ok((kind, pair_id))
}

fn inline_position(text: &str) -> Result<u32, InteropError> {
    u32::try_from(text.chars().count())
        .map_err(|_| InteropError::Xml("inline text exceeds u32".to_string()))
}

fn render_template(template: &str, target: &str) -> Result<String, InteropError> {
    let parsed = parse_fragment(template)?;
    let mut text_slots = Vec::<(usize, usize, usize)>::new();
    let mut total = 0usize;
    for (index, token) in parsed.tokens.iter().enumerate() {
        if !matches!(token.kind, TokenKind::Text | TokenKind::CData) {
            continue;
        }
        let value = if matches!(token.kind, TokenKind::CData) {
            parsed.text[token.range.clone()].to_string()
        } else {
            decode_text(&parsed.text[token.range.clone()])?
        };
        let count = value.chars().count();
        text_slots.push((index, total, count));
        total += count;
    }
    let target_chars = target.chars().collect::<Vec<_>>();
    let mut output = String::new();
    let mut target_cursor = 0usize;
    let slot_by_index = text_slots
        .iter()
        .map(|(index, start, count)| (*index, (*start, *count)))
        .collect::<HashMap<_, _>>();
    let mut index = 0usize;
    while index < parsed.tokens.len() {
        let token = &parsed.tokens[index];
        match &token.kind {
            TokenKind::Text | TokenKind::CData => {
                let Some((start, count)) = slot_by_index.get(&index).copied() else {
                    index += 1;
                    continue;
                };
                let end = ((start + count) * target_chars.len() + total / 2)
                    .checked_div(total)
                    .unwrap_or(target_chars.len());
                if end > target_cursor {
                    output.push_str(&escape_xml(
                        &target_chars[target_cursor..end].iter().collect::<String>(),
                    ));
                    target_cursor = end;
                }
                index += 1;
            }
            TokenKind::Raw => {
                output.push_str(&parsed.text[token.range.clone()]);
                index += 1;
            }
            TokenKind::Start { node } => {
                let element = &parsed.nodes[*node];
                if ATOMIC_INLINE.contains(&element.name.as_str()) {
                    let end = element
                        .end_tag
                        .as_ref()
                        .map_or(element.start_tag.end, |value| value.end);
                    output.push_str(&parsed.text[element.start_tag.start..end]);
                    index = element.end_token.map_or(index + 1, |value| value + 1);
                } else {
                    output.push_str(&parsed.text[element.start_tag.clone()]);
                    index += 1;
                }
            }
            TokenKind::End { .. } | TokenKind::Empty { .. } => {
                output.push_str(&parsed.text[token.range.clone()]);
                index += 1;
            }
        }
    }
    if target_cursor < target_chars.len() {
        output.push_str(&escape_xml(
            &target_chars[target_cursor..].iter().collect::<String>(),
        ));
    }
    Ok(output)
}

fn target_element_name(source_name: &str) -> String {
    source_name
        .strip_suffix("source")
        .map_or_else(|| "target".to_string(), |prefix| format!("{prefix}target"))
}

fn slice_text(text: &str, range: Range<usize>) -> Result<&str, InteropError> {
    text.get(range)
        .ok_or_else(|| InteropError::Xml("XML range is outside input".to_string()))
}
fn read_bounded(path: &Path) -> Result<Vec<u8>, InteropError> {
    let metadata = fs::metadata(path)?;
    if metadata.len() > MAX_XML_BYTES {
        return Err(InteropError::TooLarge);
    }
    Ok(fs::read(path)?)
}
fn has_extension(path: &Path, extension: &str) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .is_some_and(|value| value.eq_ignore_ascii_case(extension))
}
fn encode_id(value: &str) -> String {
    value
        .as_bytes()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}
fn local_name(value: &str) -> String {
    value
        .rsplit(':')
        .next()
        .unwrap_or(value)
        .to_ascii_lowercase()
}
fn element_name(value: &str) -> Result<String, InteropError> {
    value
        .split(|character: char| character.is_whitespace() || character == '>')
        .next()
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .ok_or_else(|| InteropError::Xml("element has no name".to_string()))
}
fn find_tag_end(text: &str, start: usize) -> Result<usize, InteropError> {
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
    Err(InteropError::Xml("unterminated XML tag".to_string()))
}
type ParsedAttributes = (BTreeMap<String, String>, BTreeMap<String, String>);

fn parse_attrs(raw: &str, mut cursor: usize) -> Result<ParsedAttributes, InteropError> {
    let bytes = raw.as_bytes();
    let mut attrs = BTreeMap::new();
    let mut raw_attrs = BTreeMap::new();
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
        let raw_key = raw[start..cursor].to_ascii_lowercase();
        let key = local_name(&raw_key);
        while cursor < bytes.len() && bytes[cursor].is_ascii_whitespace() {
            cursor += 1;
        }
        if cursor >= bytes.len() || bytes[cursor] != b'=' {
            return Err(InteropError::Xml("attribute has no value".to_string()));
        }
        cursor += 1;
        while cursor < bytes.len() && bytes[cursor].is_ascii_whitespace() {
            cursor += 1;
        }
        if cursor >= bytes.len() || !matches!(bytes[cursor], b'"' | b'\'') {
            return Err(InteropError::Xml(
                "attribute value must be quoted".to_string(),
            ));
        }
        let quote = bytes[cursor];
        cursor += 1;
        let value_start = cursor;
        while cursor < bytes.len() && bytes[cursor] != quote {
            cursor += 1;
        }
        if cursor >= bytes.len() {
            return Err(InteropError::Xml("unterminated attribute".to_string()));
        }
        let raw_value = &raw[value_start..cursor];
        if raw_value.contains('<') {
            return Err(InteropError::Xml(
                "attribute value contains an unescaped < character".to_string(),
            ));
        }
        let value = decode_text(raw_value)?;
        if raw_attrs.insert(raw_key.clone(), value.clone()).is_some() {
            return Err(InteropError::Xml("duplicate XML attribute".to_string()));
        }
        if !attrs.contains_key(&key) || !raw_key.contains(':') {
            attrs.insert(key, value);
        }
        cursor += 1;
    }
    Ok((attrs, raw_attrs))
}
fn decode_text(value: &str) -> Result<String, InteropError> {
    let mut result = String::new();
    let mut cursor = 0usize;
    while cursor < value.len() {
        if value.as_bytes()[cursor] == b'&' {
            let relative = value[cursor..].find(';').ok_or_else(|| {
                InteropError::Xml("unterminated XML entity reference".to_string())
            })?;
            let decoded =
                decode_entity(&value[cursor..cursor + relative + 1]).ok_or_else(|| {
                    InteropError::Xml("unsupported or malformed XML entity reference".to_string())
                })?;
            result.push(decoded);
            cursor += relative + 1;
            continue;
        }
        let character = value[cursor..].chars().next().unwrap_or_default();
        result.push(character);
        cursor += character.len_utf8();
    }
    Ok(result)
}

fn decode_character_data(value: &str) -> Result<String, InteropError> {
    if value.contains("]]>") {
        return Err(InteropError::Xml(
            "character data contains a forbidden ]]> sequence".to_string(),
        ));
    }
    decode_text(value)
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
fn escape_xml(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}
fn map_error(error: InteropError) -> FilterError {
    match error {
        InteropError::Io(error) => FilterError::Io(error),
        InteropError::TooLarge => {
            FilterError::Invalid("interchange input exceeds bounded size".to_string())
        }
        InteropError::Xml(message)
        | InteropError::Zip(message)
        | InteropError::MissingPath(message) => FilterError::Invalid(message),
        InteropError::SourceChanged => {
            FilterError::Invalid("interchange export changed source identity".to_string())
        }
    }
}

#[derive(Debug, Clone)]
struct ZipEntry {
    name: String,
    bytes: Vec<u8>,
}

fn read_zip(path: &Path) -> Result<Vec<ZipEntry>, InteropError> {
    let file = fs::File::open(path)?;
    read_zip_reader(file)
}

fn read_zip_bytes(bytes: &[u8]) -> Result<Vec<ZipEntry>, InteropError> {
    read_zip_reader(Cursor::new(bytes))
}

fn read_zip_reader<R: Read + Seek>(mut reader: R) -> Result<Vec<ZipEntry>, InteropError> {
    let declared_entries = validate_central_directory(&mut reader)?;
    reader.seek(SeekFrom::Start(0))?;
    let mut archive =
        ZipArchive::new(reader).map_err(|error| InteropError::Zip(error.to_string()))?;
    if archive.len() != declared_entries {
        return Err(InteropError::Zip(
            "central directory entry count is inconsistent".to_string(),
        ));
    }
    if archive
        .has_overlapping_files()
        .map_err(|error| InteropError::Zip(error.to_string()))?
    {
        return Err(InteropError::Zip(
            "package entries have overlapping data ranges".to_string(),
        ));
    }
    read_zip_archive(archive)
}

fn zip_u16(bytes: &[u8], offset: usize) -> Result<u16, InteropError> {
    let end = offset
        .checked_add(2)
        .ok_or_else(|| InteropError::Zip("central directory field overflow".to_string()))?;
    let value: [u8; 2] = bytes
        .get(offset..end)
        .ok_or_else(|| InteropError::Zip("central directory field is truncated".to_string()))?
        .try_into()
        .map_err(|_| InteropError::Zip("central directory field is malformed".to_string()))?;
    Ok(u16::from_le_bytes(value))
}

fn zip_u32(bytes: &[u8], offset: usize) -> Result<u32, InteropError> {
    let end = offset
        .checked_add(4)
        .ok_or_else(|| InteropError::Zip("central directory field overflow".to_string()))?;
    let value: [u8; 4] = bytes
        .get(offset..end)
        .ok_or_else(|| InteropError::Zip("central directory field is truncated".to_string()))?
        .try_into()
        .map_err(|_| InteropError::Zip("central directory field is malformed".to_string()))?;
    Ok(u32::from_le_bytes(value))
}

fn validate_central_directory<R: Read + Seek>(reader: &mut R) -> Result<usize, InteropError> {
    const EOCD_BYTES: u64 = 22;
    const MAX_EOCD_SEARCH: u64 = EOCD_BYTES + u16::MAX as u64;
    const CENTRAL_HEADER_BYTES: usize = 46;

    let file_len = reader.seek(SeekFrom::End(0))?;
    let tail_len = usize::try_from(file_len.min(MAX_EOCD_SEARCH))
        .map_err(|_| InteropError::Zip("ZIP tail length does not fit memory".to_string()))?;
    let tail_start = file_len
        .checked_sub(tail_len as u64)
        .ok_or_else(|| InteropError::Zip("ZIP tail offset underflow".to_string()))?;
    reader.seek(SeekFrom::Start(tail_start))?;
    let mut tail = vec![0u8; tail_len];
    reader.read_exact(&mut tail)?;
    let eocd_offset = (0..=tail_len.saturating_sub(EOCD_BYTES as usize))
        .rev()
        .find(|offset| {
            tail.get(*offset..*offset + 4) == Some(b"PK\x05\x06")
                && tail
                    .get(*offset + 20..*offset + 22)
                    .and_then(|value| value.try_into().ok())
                    .map(u16::from_le_bytes)
                    .is_some_and(|comment_len| {
                        *offset + EOCD_BYTES as usize + usize::from(comment_len) == tail_len
                    })
        })
        .ok_or_else(|| InteropError::Zip("end of central directory is missing".to_string()))?;
    let eocd = &tail[eocd_offset..eocd_offset + EOCD_BYTES as usize];
    let disk = zip_u16(eocd, 4)?;
    let directory_disk = zip_u16(eocd, 6)?;
    let disk_entries = zip_u16(eocd, 8)?;
    let total_entries = zip_u16(eocd, 10)?;
    let directory_size = zip_u32(eocd, 12)?;
    let directory_offset = zip_u32(eocd, 16)?;
    if disk != 0 || directory_disk != 0 || disk_entries != total_entries {
        return Err(InteropError::Zip(
            "multi-disk ZIP packages are unsupported".to_string(),
        ));
    }
    if total_entries == u16::MAX || directory_size == u32::MAX || directory_offset == u32::MAX {
        return Err(InteropError::Zip(
            "ZIP64 packages are unsupported".to_string(),
        ));
    }
    let total_entries = usize::from(total_entries);
    if total_entries > MAX_ZIP_ENTRIES {
        return Err(InteropError::Zip(
            "package has too many entries".to_string(),
        ));
    }
    let eocd_position = tail_start + eocd_offset as u64;
    let directory_start = eocd_position
        .checked_sub(u64::from(directory_size))
        .ok_or_else(|| InteropError::Zip("central directory offset is invalid".to_string()))?;
    if u64::from(directory_offset) > directory_start {
        return Err(InteropError::Zip(
            "central directory offset is invalid".to_string(),
        ));
    }
    reader.seek(SeekFrom::Start(directory_start))?;
    let mut seen_names = BTreeSet::new();
    for _ in 0..total_entries {
        let mut header = [0u8; CENTRAL_HEADER_BYTES];
        reader.read_exact(&mut header)?;
        if header[..4] != *b"PK\x01\x02" {
            return Err(InteropError::Zip(
                "central directory entry is malformed".to_string(),
            ));
        }
        let flags = zip_u16(&header, 8)?;
        let compressed_size = zip_u32(&header, 20)?;
        let uncompressed_size = zip_u32(&header, 24)?;
        let name_len = usize::from(zip_u16(&header, 28)?);
        let extra_len = zip_u16(&header, 30)?;
        let comment_len = zip_u16(&header, 32)?;
        let disk_start = zip_u16(&header, 34)?;
        let local_header_offset = zip_u32(&header, 42)?;
        if flags & 0x0001 != 0 {
            return Err(InteropError::Zip(
                "encrypted entry is unsupported".to_string(),
            ));
        }
        if disk_start != 0 {
            return Err(InteropError::Zip(
                "multi-disk ZIP packages are unsupported".to_string(),
            ));
        }
        if compressed_size == u32::MAX
            || uncompressed_size == u32::MAX
            || local_header_offset == u32::MAX
        {
            return Err(InteropError::Zip(
                "ZIP64 packages are unsupported".to_string(),
            ));
        }
        if name_len == 0 || name_len > MAX_ZIP_NAME_BYTES {
            return Err(InteropError::Zip(
                "package entry name exceeds limit".to_string(),
            ));
        }
        let mut name = vec![0u8; name_len];
        reader.read_exact(&mut name)?;
        if !seen_names.insert(name) {
            return Err(InteropError::Zip("duplicate package entry".to_string()));
        }
        let mut extra = vec![0u8; usize::from(extra_len)];
        reader.read_exact(&mut extra)?;
        let mut extra_cursor = 0usize;
        while extra_cursor < extra.len() {
            if extra.len().saturating_sub(extra_cursor) < 4 {
                return Err(InteropError::Zip(
                    "central directory extra field is malformed".to_string(),
                ));
            }
            let field_id = u16::from_le_bytes(
                extra[extra_cursor..extra_cursor + 2]
                    .try_into()
                    .map_err(|_| InteropError::Zip("extra field is malformed".to_string()))?,
            );
            let field_len = usize::from(u16::from_le_bytes(
                extra[extra_cursor + 2..extra_cursor + 4]
                    .try_into()
                    .map_err(|_| InteropError::Zip("extra field is malformed".to_string()))?,
            ));
            let field_end = extra_cursor
                .checked_add(4)
                .and_then(|value| value.checked_add(field_len))
                .ok_or_else(|| InteropError::Zip("extra field length overflow".to_string()))?;
            if field_end > extra.len() {
                return Err(InteropError::Zip(
                    "central directory extra field is truncated".to_string(),
                ));
            }
            if field_id == 0x0001 {
                return Err(InteropError::Zip(
                    "ZIP64 packages are unsupported".to_string(),
                ));
            }
            extra_cursor = field_end;
        }
        reader.seek(SeekFrom::Current(i64::from(comment_len)))?;
    }
    let central_end = reader.stream_position()?;
    if central_end != eocd_position {
        return Err(InteropError::Zip(
            "central directory size is inconsistent".to_string(),
        ));
    }
    Ok(total_entries)
}

fn read_zip_archive<R: Read + Seek>(
    mut archive: ZipArchive<R>,
) -> Result<Vec<ZipEntry>, InteropError> {
    if archive.len() > MAX_ZIP_ENTRIES {
        return Err(InteropError::Zip(
            "package has too many entries".to_string(),
        ));
    }
    let mut seen = BTreeSet::new();
    let mut total = 0u64;
    let mut entries = Vec::new();
    for index in 0..archive.len() {
        let (name, encrypted, size, compressed_size, is_dir) = {
            let entry = archive
                .by_index_raw(index)
                .map_err(|error| InteropError::Zip(error.to_string()))?;
            (
                normalize_zip_name(entry.name())?,
                entry.encrypted(),
                entry.size(),
                entry.compressed_size(),
                entry.is_dir(),
            )
        };
        if encrypted {
            return Err(InteropError::Zip(
                "encrypted entry is unsupported".to_string(),
            ));
        }
        if size > MAX_ZIP_ENTRY_BYTES {
            return Err(InteropError::Zip("entry exceeds size limit".to_string()));
        }
        if size > 0
            && (compressed_size == 0
                || size > compressed_size.saturating_mul(MAX_COMPRESSION_RATIO))
        {
            return Err(InteropError::Zip(
                "entry exceeds compression ratio limit".to_string(),
            ));
        }
        total = total
            .checked_add(size)
            .ok_or_else(|| InteropError::Zip("package size overflow".to_string()))?;
        if total > MAX_ZIP_TOTAL_BYTES {
            return Err(InteropError::Zip(
                "package exceeds total size limit".to_string(),
            ));
        }
        if !seen.insert(name.clone()) {
            return Err(InteropError::Zip("duplicate package entry".to_string()));
        }
        if is_dir {
            continue;
        }
        let entry = archive
            .by_index(index)
            .map_err(|error| InteropError::Zip(error.to_string()))?;
        let capacity = usize::try_from(size)
            .map_err(|_| InteropError::Zip("entry size does not fit memory".to_string()))?;
        let mut bytes = Vec::with_capacity(capacity);
        entry
            .take(size.saturating_add(1))
            .read_to_end(&mut bytes)
            .map_err(InteropError::Io)?;
        if u64::try_from(bytes.len()).unwrap_or(u64::MAX) != size {
            return Err(InteropError::Zip(
                "entry uncompressed size is inconsistent".to_string(),
            ));
        }
        entries.push(ZipEntry { name, bytes });
    }
    Ok(entries)
}
fn select_xml_entry(entries: &[ZipEntry]) -> Result<(&str, &[u8]), InteropError> {
    let matches = entries
        .iter()
        .filter(|entry| {
            let lower = entry.name.to_ascii_lowercase();
            lower.ends_with(".mqxliff") || lower.ends_with(".xlf") || lower.ends_with(".xliff")
        })
        .collect::<Vec<_>>();
    if matches.len() != 1 {
        return Err(InteropError::Zip(
            "package must contain exactly one XLIFF entry".to_string(),
        ));
    }
    Ok((matches[0].name.as_str(), matches[0].bytes.as_slice()))
}
fn normalize_zip_name(name: &str) -> Result<String, InteropError> {
    if name.is_empty()
        || name.starts_with('/')
        || name.starts_with('\\')
        || name.contains('\\')
        || name.contains('\0')
        || name
            .split('/')
            .next()
            .is_some_and(|part| part.contains(':'))
    {
        return Err(InteropError::Zip("invalid package entry path".to_string()));
    }
    let mut parts = Vec::new();
    for part in name.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                return Err(InteropError::Zip(
                    "package entry uses traversal".to_string(),
                ));
            }
            value => parts.push(value),
        }
    }
    if parts.is_empty() {
        return Err(InteropError::Zip("empty package entry path".to_string()));
    }
    Ok(parts.join("/"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;
    use std::io::Write;
    use translunar_domain::{Segment, SegmentState};
    use translunar_filter_core::collect_imported_document;
    use zip::CompressionMethod;
    use zip::write::{SimpleFileOptions, ZipWriter};

    fn segment(path: String, source: &str, target: &str) -> Segment {
        Segment {
            id: "s".to_string(),
            document_id: "d".to_string(),
            ordinal: 0,
            structural_path: path,
            source_text: source.to_string(),
            target_text: target.to_string(),
            state: SegmentState::Draft,
            revision: 1,
            source_hash: String::new(),
            context_hash: String::new(),
            updated_at_ms: 0,
        }
    }

    fn zip_entry_metadata(path: &Path, name: &str) -> (u64, u32, CompressionMethod, Option<u32>) {
        let file = fs::File::open(path).expect("open ZIP");
        let mut archive = ZipArchive::new(file).expect("read ZIP");
        let entry = archive.by_name(name).expect("find ZIP entry");
        (
            entry.compressed_size(),
            entry.crc32(),
            entry.compression(),
            entry.unix_mode(),
        )
    }

    fn mutate_zip_headers(bytes: &mut [u8], mut mutate: impl FnMut(&mut [u8], usize, bool)) {
        let mut cursor = 0usize;
        while cursor + 4 <= bytes.len() {
            let central = bytes[cursor..cursor + 4].starts_with(b"PK\x01\x02");
            if central || bytes[cursor..cursor + 4].starts_with(b"PK\x03\x04") {
                mutate(bytes, cursor, central);
                cursor += 4;
            } else {
                cursor += 1;
            }
        }
    }

    fn rewrite_zip_entry_name(bytes: &mut [u8], old: &str, new: &str) {
        assert_eq!(old.len(), new.len());
        mutate_zip_headers(bytes, |bytes, start, central| {
            let (length_offset, name_offset) = if central { (28, 46) } else { (26, 30) };
            let length_start = start + length_offset;
            let length = u16::from_le_bytes(
                bytes[length_start..length_start + 2]
                    .try_into()
                    .expect("ZIP name length"),
            ) as usize;
            let name_start = start + name_offset;
            let name_end = name_start + length;
            if bytes.get(name_start..name_end) == Some(old.as_bytes()) {
                bytes[name_start..name_end].copy_from_slice(new.as_bytes());
            }
        });
    }

    fn set_zip_encryption_flag(bytes: &mut [u8]) {
        mutate_zip_headers(bytes, |bytes, start, central| {
            let flag_start = start + if central { 8 } else { 6 };
            let flags = u16::from_le_bytes(
                bytes[flag_start..flag_start + 2]
                    .try_into()
                    .expect("ZIP flags"),
            ) | 1;
            bytes[flag_start..flag_start + 2].copy_from_slice(&flags.to_le_bytes());
        });
    }

    fn set_zip_uncompressed_size(bytes: &mut [u8], size: u32) {
        mutate_zip_headers(bytes, |bytes, start, central| {
            let size_start = start + if central { 24 } else { 22 };
            bytes[size_start..size_start + 4].copy_from_slice(&size.to_le_bytes());
        });
    }

    fn set_zip64_extra_field_id(bytes: &mut [u8]) {
        mutate_zip_headers(bytes, |bytes, start, central| {
            if !central {
                return;
            }
            let name_len = usize::from(u16::from_le_bytes(
                bytes[start + 28..start + 30]
                    .try_into()
                    .expect("central name length"),
            ));
            let extra_len = usize::from(u16::from_le_bytes(
                bytes[start + 30..start + 32]
                    .try_into()
                    .expect("central extra length"),
            ));
            if extra_len < 4 {
                return;
            }
            let extra_start = start + 46 + name_len;
            bytes[extra_start..extra_start + 2].copy_from_slice(&1_u16.to_le_bytes());
        });
    }

    fn set_zip64_eocd_entry_count(bytes: &mut [u8]) {
        let eocd = (0..=bytes.len().saturating_sub(22))
            .rev()
            .find(|offset| bytes[*offset..].starts_with(b"PK\x05\x06"))
            .expect("EOCD signature");
        bytes[eocd + 8..eocd + 10].copy_from_slice(&u16::MAX.to_le_bytes());
        bytes[eocd + 10..eocd + 12].copy_from_slice(&u16::MAX.to_le_bytes());
    }

    #[test]
    fn sdlxliff_round_trip_preserves_vendor_metadata_and_tags() {
        let dir = tempfile::tempdir().expect("temp");
        let source = dir.path().join("handoff.sdlxliff");
        let output = dir.path().join("returned.sdlxliff");
        fs::write(&source, r#"<xliff version="1.2" xmlns:sdl="urn:vendor:sdl" xmlns:x="urn:opaque"><file id="f" source-language="en" target-language="de"><body><trans-unit id="u1" sdl:locked="true"><source>Hello <g id="1">world</g></source><target state="translated">Hallo <g id="1">Welt</g></target><note from="review">Keep tone</note><x:meta value="keep"/></trans-unit></body></file></xliff>"#).expect("write");
        let parsed = parse_vendor_file(Vendor::Sdl, &source, None).expect("parse");
        assert_eq!(parsed.units.len(), 1);
        assert_eq!(parsed.units[0].source, "Hello world");
        assert_eq!(parsed.units[0].target.as_deref(), Some("Hallo Welt"));
        assert!(parsed.units[0].notes.iter().any(|note| note.text == "true"));
        let path = parsed.units[0].path.clone();
        let (bytes, _, _) = export_xml(
            Vendor::Sdl,
            &fs::read(&source).expect("bytes"),
            &[segment(path, "Hello world", "Guten Tag Welt")],
            None,
        )
        .expect("export");
        fs::write(&output, bytes).expect("write output");
        let result = fs::read(output).expect("read");
        let reparsed = parse_vendor_xml(Vendor::Sdl, &result, None).expect("reparse output");
        let result_text = std::str::from_utf8(&result).expect("utf8 output");
        assert!(result_text.contains("x:meta"));
        assert_eq!(reparsed.units[0].target.as_deref(), Some("Guten Tag Welt"));
    }

    #[test]
    fn sdl_segment_markers_states_comments_and_pairs_round_trip() {
        let dir = tempfile::tempdir().expect("temp");
        let source = dir.path().join("segmented.sdlxliff");
        fs::write(
            &source,
            r#"<xliff version="1.2" xmlns:sdl="urn:sdl" xmlns:x="urn:opaque"><file id="f" source-language="en" target-language="de"><body><trans-unit id="u"><source>Original</source><seg-source><mrk mtype="seg" mid="1">Hello <g id="1">world</g></mrk><mrk mtype="seg" mid="2">Bye</mrk></seg-source><target><mrk mtype="seg" mid="1">Hallo <g id="1">Welt</g></mrk></target><sdl:seg-defs><sdl:seg id="1" conf="Translated" locked="true" cmt="c1"/><sdl:seg id="2" conf="Draft"/></sdl:seg-defs><sdl:unsupported value="opaque"/><x:meta keep="yes"/></trans-unit></body><sdl:cmt-defs><sdl:cmt-def id="c1"><sdl:Comment user="qa">Keep tone</sdl:Comment></sdl:cmt-def></sdl:cmt-defs></file></xliff>"#,
        )
        .expect("write SDL fixture");

        let imported = collect_imported_document(
            SdlxliffFilter
                .import(ImportRequest {
                    source: source.clone(),
                    document_id: Some("doc".to_string()),
                    source_locale: None,
                    options: BTreeMap::new(),
                })
                .expect("import SDL fixture"),
        )
        .expect("collect SDL events");
        assert_eq!(imported.units.len(), 2);
        assert_eq!(imported.units[0].source_text, "Hello world");
        assert_eq!(imported.units[1].target_text, None);
        assert!(
            imported.units[0]
                .inline_tags
                .iter()
                .any(|tag| tag.kind == TagKind::Start && tag.pair_id.is_some())
        );
        assert!(
            imported.units[0]
                .inline_tags
                .iter()
                .any(|tag| tag.kind == TagKind::End && tag.pair_id.is_some())
        );
        assert!(
            imported.units[0]
                .notes
                .iter()
                .any(|note| note.text == "Translated")
        );
        assert!(
            imported.units[0]
                .notes
                .iter()
                .any(|note| note.text == "Keep tone" && note.author.as_deref() == Some("qa"))
        );
        assert!(
            imported
                .degradation
                .iter()
                .any(|finding| finding.code == "unsupported_vendor_field")
        );

        let translated = imported
            .units
            .iter()
            .enumerate()
            .map(|(index, unit)| {
                segment(
                    unit.structural_path.clone(),
                    &unit.source_text,
                    if index == 0 {
                        "Guten Tag Welt"
                    } else {
                        "Auf Wiedersehen"
                    },
                )
            })
            .collect::<Vec<_>>();
        let (output, count, findings) = export_xml(
            Vendor::Sdl,
            &fs::read(&source).expect("read SDL fixture"),
            &translated,
            None,
        )
        .expect("export SDL fixture");
        assert_eq!(count, 2);
        assert!(
            findings
                .iter()
                .any(|finding| finding.code == "unsupported_vendor_field")
        );
        let reparsed = parse_vendor_xml(Vendor::Sdl, &output, None).expect("reparse SDL output");
        assert_eq!(reparsed.units[0].target.as_deref(), Some("Guten Tag Welt"));
        assert_eq!(reparsed.units[1].target.as_deref(), Some("Auf Wiedersehen"));
        let output = std::str::from_utf8(&output).expect("UTF-8 SDL output");
        assert!(output.contains("<sdl:unsupported value=\"opaque\"/>"));
        assert!(output.contains("<x:meta keep=\"yes\"/>"));
        assert!(output.contains("<sdl:seg id=\"1\" conf=\"Translated\" locked=\"true\""));
    }

    #[test]
    fn mqxliff_v2_preserves_state_and_reports_unknown_vendor_metadata() {
        let dir = tempfile::tempdir().expect("temp");
        let source = dir.path().join("handoff.mqxliff");
        fs::write(
            &source,
            r#"<xliff version="2.0" srcLang="en" trgLang="fr" xmlns="urn:oasis:names:tc:xliff:document:2.0" xmlns:mq="urn:memoq"><file id="f"><unit id="u"><segment id="s" mq:status="Confirmed"><source>Hello <ph id="1"/>world</source><target>Bonjour <ph id="1"/>monde</target><mq:metadata opaque="yes"/></segment></unit></file></xliff>"#,
        )
        .expect("write memoQ fixture");
        let imported = collect_imported_document(
            MqxliffFilter
                .import(ImportRequest {
                    source,
                    document_id: Some("mq-doc".to_string()),
                    source_locale: None,
                    options: BTreeMap::new(),
                })
                .expect("import memoQ fixture"),
        )
        .expect("collect memoQ events");
        assert_eq!(imported.metadata.source_locale.as_deref(), Some("en"));
        assert_eq!(
            imported
                .metadata
                .properties
                .get("targetLocale")
                .map(String::as_str),
            Some("fr")
        );
        assert!(
            imported.units[0]
                .notes
                .iter()
                .any(|note| note.text == "Confirmed")
        );
        assert!(
            imported.units[0]
                .inline_tags
                .iter()
                .any(|tag| tag.kind == TagKind::Standalone)
        );
        assert!(
            imported
                .degradation
                .iter()
                .any(|finding| finding.code == "unsupported_vendor_field")
        );
    }

    #[test]
    fn rejects_ambiguous_segment_marker_identities() {
        let mismatched = br#"<xliff version="1.2"><file id="f"><body><trans-unit id="u"><source>Original</source><seg-source><mrk mtype="seg" mid="1">One</mrk></seg-source><target><mrk mtype="seg" mid="2">Two</mrk></target></trans-unit></body></file></xliff>"#;
        assert!(matches!(
            parse_vendor_xml(Vendor::Sdl, mismatched, None),
            Err(InteropError::Xml(message))
                if message == "vendor source and target marker identities do not match"
        ));

        let duplicate = br#"<xliff version="1.2"><file id="f"><body><trans-unit id="u"><source>Original</source><seg-source><mrk mtype="seg" mid="1">One</mrk><mrk mtype="seg" mid="2">Two</mrk></seg-source><target><mrk mtype="seg" mid="1">Uno</mrk><mrk mtype="seg" mid="1">Dos</mrk></target></trans-unit></body></file></xliff>"#;
        assert!(matches!(
            parse_vendor_xml(Vendor::Sdl, duplicate, None),
            Err(InteropError::Xml(message))
                if message == "duplicate vendor target marker identity"
        ));
    }

    #[test]
    fn rejects_unknown_entities_and_accepts_cdata_literals() {
        let unknown = br#"<xliff version="1.2"><file id="f"><body><trans-unit id="u"><source>A &unknown; B</source></trans-unit></body></file></xliff>"#;
        assert!(matches!(
            parse_vendor_xml(Vendor::Sdl, unknown, None),
            Err(InteropError::Xml(message))
                if message == "unsupported or malformed XML entity reference"
        ));

        let cdata = br#"<xliff version="1.2"><file id="f"><body><trans-unit id="u"><source><![CDATA[A & B]]></source></trans-unit></body></file></xliff>"#;
        let parsed = parse_vendor_xml(Vendor::Sdl, cdata, None).expect("valid CDATA source");
        assert_eq!(parsed.units[0].source, "A & B");
    }

    #[test]
    fn rejects_xml_outside_root_invalid_comments_processing_instructions_attributes_and_cdata() {
        let cases = [
            (
                &br#"prefix<xliff version="1.2"/>"#[..],
                "non-whitespace text exists outside the root element",
            ),
            (
                &br#"<xliff version="1.2"><!--bad--comment--></xliff>"#[..],
                "invalid XML comment",
            ),
            (
                &br#"<xliff version="1.2"><?vendor value></xliff>"#[..],
                "processing instruction is not terminated with ?>",
            ),
            (
                &br#"<xliff version="1.2" bad="a<b"/>"#[..],
                "attribute value contains an unescaped < character",
            ),
            (
                &br#"<xliff version="1.2">bad]]></xliff>"#[..],
                "character data contains a forbidden ]]> sequence",
            ),
        ];
        for (xml, expected) in cases {
            assert!(
                matches!(
                    parse_xml(xml),
                    Err(InteropError::Xml(message)) if message == expected
                ),
                "unexpected XML result for {xml:?}"
            );
        }
    }

    #[test]
    fn reports_unmapped_vendor_attributes_on_nested_inline_nodes() {
        let nested = br#"<xliff version="2.0" xmlns:mq="urn:memoq"><file id="f"><unit id="u"><segment id="s"><source>Open <pc id="1" mq:opaque="yes">file</pc></source></segment></unit></file></xliff>"#;
        let parsed = parse_vendor_xml(Vendor::MemoQ, nested, None).expect("valid memoQ dialect");
        assert!(
            parsed
                .degradation
                .iter()
                .any(|finding| finding.code == "unsupported_vendor_field")
        );
    }

    #[test]
    fn keeps_multisegment_notes_and_vendor_findings_on_their_owner() {
        let xml = br#"<xliff version="2.0" xmlns:mq="urn:memoq"><file id="f"><unit id="u"><note>Shared context</note><segment id="s1"><source><pc id="1" mq:opaque="yes">One</pc></source><note>First only</note></segment><segment id="s2"><source>Two</source><note>Second only</note></segment></unit></file></xliff>"#;
        let parsed = parse_vendor_xml(Vendor::MemoQ, xml, None).expect("valid multi-segment XLIFF");
        assert_eq!(parsed.units.len(), 2);
        assert!(
            parsed.units[0]
                .notes
                .iter()
                .any(|note| note.text == "Shared context")
        );
        assert!(
            parsed.units[0]
                .notes
                .iter()
                .any(|note| note.text == "First only")
        );
        assert!(
            !parsed.units[0]
                .notes
                .iter()
                .any(|note| note.text == "Second only")
        );
        assert!(
            parsed.units[1]
                .notes
                .iter()
                .any(|note| note.text == "Shared context")
        );
        assert!(
            parsed.units[1]
                .notes
                .iter()
                .any(|note| note.text == "Second only")
        );
        assert!(
            !parsed.units[1]
                .notes
                .iter()
                .any(|note| note.text == "First only")
        );

        let finding_paths = parsed
            .degradation
            .iter()
            .filter(|finding| finding.code == "unsupported_vendor_field")
            .filter_map(|finding| finding.structural_path.as_deref())
            .collect::<Vec<_>>();
        assert_eq!(finding_paths, vec![parsed.units[0].path.as_str()]);
    }

    #[test]
    fn maps_xliff_12_and_2x_split_codes_to_protected_pairs() {
        let xliff12 = br#"<xliff version="1.2"><file id="f"><body><trans-unit id="u"><source>Open <bpt id="1" rid="bold">&lt;b&gt;</bpt>file<ept id="2" rid="bold">&lt;/b&gt;</ept></source></trans-unit></body></file></xliff>"#;
        let imported12 = collect_imported_document(
            events_for(
                Vendor::Sdl,
                Some("doc12"),
                None,
                parse_vendor_xml(Vendor::Sdl, xliff12, None).expect("valid XLIFF 1.2 codes"),
            )
            .expect("XLIFF 1.2 events"),
        )
        .expect("collect XLIFF 1.2 codes");
        let tags12 = &imported12.units[0].inline_tags;
        assert_eq!(tags12.len(), 2);
        assert_eq!(tags12[0].kind, TagKind::Start);
        assert_eq!(tags12[1].kind, TagKind::End);
        assert_eq!(tags12[0].pair_id, tags12[1].pair_id);

        let xliff2 = br#"<xliff version="2.0"><file id="f"><unit id="u"><segment id="s"><source>Open <sc id="bold"/>file<ec startRef="bold"/></source></segment></unit></file></xliff>"#;
        let imported2 = collect_imported_document(
            events_for(
                Vendor::MemoQ,
                Some("doc2"),
                None,
                parse_vendor_xml(Vendor::MemoQ, xliff2, None).expect("valid XLIFF 2 codes"),
            )
            .expect("XLIFF 2 events"),
        )
        .expect("collect XLIFF 2 codes");
        let tags2 = &imported2.units[0].inline_tags;
        assert_eq!(tags2.len(), 2);
        assert_eq!(tags2[0].kind, TagKind::Start);
        assert_eq!(tags2[1].kind, TagKind::End);
        assert_eq!(tags2[0].pair_id, tags2[1].pair_id);
    }

    #[test]
    fn mqxlz_round_trip_copies_auxiliary_entry_and_rejects_traversal() {
        let dir = tempfile::tempdir().expect("temp");
        let source = dir.path().join("handoff.mqxlz");
        let output = dir.path().join("returned.mqxlz");
        let mut writer = ZipWriter::new(fs::File::create(&source).expect("create"));
        let stored = SimpleFileOptions::default();
        let deflated = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
        writer.start_file("main.mqxliff", stored).expect("main");
        writer.write_all(br#"<xliff version="1.2"><file id="f"><body><trans-unit id="u"><source>Hello</source><target>Hallo</target></trans-unit></body></file></xliff>"#).expect("xml");
        writer.start_file("skeleton.bin", deflated).expect("aux");
        writer
            .write_all(b"opaque auxiliary payload")
            .expect("aux bytes");
        writer.finish().expect("finish");
        let metadata_before = zip_entry_metadata(&source, "skeleton.bin");
        let entries = read_zip(&source).expect("read");
        let (name, bytes) = select_xml_entry(&entries).expect("xml entry");
        let parsed = parse_vendor_xml(Vendor::MemoQ, bytes, Some(name)).expect("parse");
        let (xml, _, _) = export_xml(
            Vendor::MemoQ,
            bytes,
            &[segment(parsed.units[0].path.clone(), "Hello", "Hallo Welt")],
            Some(name),
        )
        .expect("export xml");
        let mut replacements = BTreeMap::new();
        replacements.insert(name.to_string(), xml);
        publish_bytes_noclobber(
            &output,
            &rebuild_zip_raw(&source, &replacements).expect("zip"),
        )
        .expect("publish");
        let returned = read_zip(&output).expect("returned");
        assert!(returned.iter().any(
            |entry| entry.name == "skeleton.bin" && entry.bytes == b"opaque auxiliary payload"
        ));
        assert_eq!(zip_entry_metadata(&output, "skeleton.bin"), metadata_before);
        assert!(normalize_zip_name("../escape").is_err());
    }

    #[test]
    fn mqxlz_rejects_multiple_xliff_entries_traversal_and_ratio_bombs() {
        let dir = tempfile::tempdir().expect("temp");
        let stored = SimpleFileOptions::default();

        let multi = dir.path().join("multi.mqxlz");
        let mut writer = ZipWriter::new(fs::File::create(&multi).expect("create multi"));
        for name in ["one.mqxliff", "two.xlf"] {
            writer.start_file(name, stored).expect("start XLIFF");
            writer
                .write_all(br#"<xliff version="1.2"><file id="f"><body><trans-unit id="u"><source>Hello</source></trans-unit></body></file></xliff>"#)
                .expect("write XLIFF");
        }
        writer.finish().expect("finish multi");
        let entries = read_zip(&multi).expect("read multi");
        assert!(select_xml_entry(&entries).is_err());

        let traversal = dir.path().join("traversal.mqxlz");
        let mut writer = ZipWriter::new(fs::File::create(&traversal).expect("create traversal"));
        writer
            .start_file("../escape.bin", stored)
            .expect("start traversal");
        writer.write_all(b"bad").expect("write traversal");
        writer.finish().expect("finish traversal");
        assert!(read_zip(&traversal).is_err());

        let bomb = dir.path().join("ratio.mqxlz");
        let mut writer = ZipWriter::new(fs::File::create(&bomb).expect("create bomb"));
        let deflated = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
        writer
            .start_file("main.mqxliff", stored)
            .expect("start XML");
        writer
            .write_all(br#"<xliff version="1.2"><file id="f"><body><trans-unit id="u"><source>Hello</source></trans-unit></body></file></xliff>"#)
            .expect("write XML");
        writer.start_file("bomb.bin", deflated).expect("start bomb");
        writer
            .write_all(&vec![0_u8; 256 * 1024])
            .expect("write bomb");
        writer.finish().expect("finish bomb");
        assert!(read_zip(&bomb).is_err());
    }

    #[test]
    fn mqxlz_rejects_duplicate_encrypted_and_oversized_entries() {
        let dir = tempfile::tempdir().expect("temp");
        let stored = SimpleFileOptions::default();
        let xml = br#"<xliff version="1.2"><file id="f"><body><trans-unit id="u"><source>Hello</source></trans-unit></body></file></xliff>"#;

        let duplicate = dir.path().join("duplicate.mqxlz");
        let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
        writer.start_file("main.mqxliff", stored).expect("main");
        writer.write_all(xml).expect("main XML");
        writer.start_file("copy.mqxliff", stored).expect("copy");
        writer.write_all(xml).expect("copy XML");
        let mut bytes = writer.finish().expect("finish duplicate ZIP").into_inner();
        rewrite_zip_entry_name(&mut bytes, "copy.mqxliff", "main.mqxliff");
        fs::write(&duplicate, bytes).expect("write duplicate ZIP");
        let duplicate_error = read_zip(&duplicate).expect_err("duplicate ZIP must fail");
        assert!(
            matches!(&duplicate_error, InteropError::Zip(message) if message
                .to_ascii_lowercase()
                .contains("duplicate")),
            "unexpected duplicate ZIP error: {duplicate_error:?}"
        );

        let encrypted = dir.path().join("encrypted.mqxlz");
        let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
        writer.start_file("main.mqxliff", stored).expect("main");
        writer.write_all(xml).expect("main XML");
        let mut bytes = writer.finish().expect("finish encrypted ZIP").into_inner();
        set_zip_encryption_flag(&mut bytes);
        let mut encrypted_probe = ZipArchive::new(Cursor::new(bytes.clone())).expect("probe ZIP");
        assert!(
            encrypted_probe
                .by_index_raw(0)
                .expect("probe encrypted entry")
                .encrypted(),
            "test archive encryption flag was not set"
        );
        fs::write(&encrypted, bytes).expect("write encrypted ZIP");
        let encrypted_error = read_zip(&encrypted).expect_err("encrypted ZIP must fail");
        assert!(
            matches!(&encrypted_error, InteropError::Zip(message) if message
                == "encrypted entry is unsupported"),
            "unexpected encrypted ZIP error: {encrypted_error:?}"
        );

        let oversized = dir.path().join("oversized.mqxlz");
        let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
        writer.start_file("main.mqxliff", stored).expect("main");
        writer.write_all(xml).expect("main XML");
        let mut bytes = writer.finish().expect("finish oversized ZIP").into_inner();
        set_zip_uncompressed_size(
            &mut bytes,
            u32::try_from(MAX_ZIP_ENTRY_BYTES + 1).expect("test size fits u32"),
        );
        fs::write(&oversized, bytes).expect("write oversized ZIP");
        assert!(matches!(
            read_zip(&oversized),
            Err(InteropError::Zip(message)) if message == "entry exceeds size limit"
        ));
    }

    #[test]
    fn rejects_zip64_extra_and_sentinel_metadata() {
        let xml = br#"<xliff version="1.2"><file id="f"><body><trans-unit id="u"><source>Hello</source></trans-unit></body></file></xliff>"#;

        let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
        let mut options = SimpleFileOptions::default().into_full_options();
        options
            .add_extra_data(0x5455, [0_u8], true)
            .expect("add valid central extra field");
        writer
            .start_file("main.mqxliff", options)
            .expect("start XML");
        writer.write_all(xml).expect("write XML");
        let mut zip64_extra = writer.finish().expect("finish extra ZIP").into_inner();
        set_zip64_extra_field_id(&mut zip64_extra);
        assert!(matches!(
            read_zip_bytes(&zip64_extra),
            Err(InteropError::Zip(message)) if message == "ZIP64 packages are unsupported"
        ));

        let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
        writer
            .start_file("main.mqxliff", SimpleFileOptions::default())
            .expect("start XML");
        writer.write_all(xml).expect("write XML");
        let mut size_sentinel = writer.finish().expect("finish size ZIP").into_inner();
        set_zip_uncompressed_size(&mut size_sentinel, u32::MAX);
        assert!(matches!(
            read_zip_bytes(&size_sentinel),
            Err(InteropError::Zip(message)) if message == "ZIP64 packages are unsupported"
        ));

        let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
        writer
            .start_file("main.mqxliff", SimpleFileOptions::default())
            .expect("start XML");
        writer.write_all(xml).expect("write XML");
        let mut count_sentinel = writer.finish().expect("finish count ZIP").into_inner();
        set_zip64_eocd_entry_count(&mut count_sentinel);
        assert!(matches!(
            read_zip_bytes(&count_sentinel),
            Err(InteropError::Zip(message)) if message == "ZIP64 packages are unsupported"
        ));
    }

    #[test]
    fn export_rejects_unknown_paths_and_existing_destinations() {
        let dir = tempfile::tempdir().expect("temp");
        let source = dir.path().join("handoff.sdlxliff");
        let output = dir.path().join("returned.sdlxliff");
        fs::write(
            &source,
            r#"<xliff version="1.2"><file id="f"><body><trans-unit id="u"><source>Hello</source></trans-unit></body></file></xliff>"#,
        )
        .expect("write source");
        assert!(
            export_xml(
                Vendor::Sdl,
                &fs::read(&source).expect("read source"),
                &[segment("missing".to_string(), "Hello", "Hallo")],
                None,
            )
            .is_err()
        );

        let parsed = parse_vendor_file(Vendor::Sdl, &source, None).expect("parse source");
        let source_bytes = fs::read(&source).expect("read source");
        let duplicate_path = parsed.units[0].path.clone();
        assert!(matches!(
            export_xml(
                Vendor::Sdl,
                &source_bytes,
                &[
                    segment(duplicate_path.clone(), "Hello", "Hallo"),
                    segment(duplicate_path, "Hello", "Guten Tag"),
                ],
                None,
            ),
            Err(InteropError::Xml(message))
                if message == "duplicate vendor structural path in export"
        ));
        fs::write(&output, b"keep").expect("seed destination");
        let request_segment = segment(parsed.units[0].path.clone(), "Hello", "Hallo");
        let error = SdlxliffFilter
            .export(ExportRequest {
                source: &source,
                output: &output,
                segments: &[request_segment],
            })
            .expect_err("reject existing destination");
        assert!(matches!(error, FilterError::Processing(_)));
        assert_eq!(fs::read(&output).expect("read destination"), b"keep");
    }

    #[test]
    fn rejects_doctype_depth_size_and_duplicate_paths() {
        let dir = tempfile::tempdir().expect("temp");
        let path = dir.path().join("bad.sdlxliff");
        fs::write(&path, b"<!DOCTYPE xliff><xliff version=\"1.2\"/>").expect("write");
        assert!(parse_vendor_file(Vendor::Sdl, &path, None).is_err());

        let deep = format!(
            "<xliff version=\"1.2\">{}{}</xliff>",
            "<g>".repeat(MAX_XML_DEPTH),
            "</g>".repeat(MAX_XML_DEPTH)
        );
        fs::write(&path, deep).expect("write deep XML");
        assert!(matches!(
            parse_vendor_file(Vendor::Sdl, &path, None),
            Err(InteropError::Xml(message)) if message == "XML depth limit exceeded"
        ));

        let oversized = dir.path().join("oversized.sdlxliff");
        fs::File::create(&oversized)
            .expect("create oversized XML")
            .set_len(MAX_XML_BYTES + 1)
            .expect("size oversized XML");
        assert!(matches!(
            parse_vendor_file(Vendor::Sdl, &oversized, None),
            Err(InteropError::TooLarge)
        ));

        fs::write(
            &path,
            r#"<xliff version="1.2"><file id="f"><body><trans-unit id="u"><source>One</source></trans-unit><trans-unit id="u"><source>Two</source></trans-unit></body></file></xliff>"#,
        )
        .expect("write duplicate paths");
        assert!(matches!(
            parse_vendor_file(Vendor::Sdl, &path, None),
            Err(InteropError::Xml(message)) if message == "duplicate vendor structural path"
        ));
    }
}

//! Conservative OOXML DOCX import and export.

pub mod fixture;

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::path::Path;

use quick_xml::Reader;
use quick_xml::events::Event;
use thiserror::Error;
use tl_domain::{
    DegradationFinding, DegradationSeverity, DocumentNote, InlineTag, Segment, TagKind, TagSide,
    normalize_text,
};
use tl_filter_core::{
    DocumentFilter, DocumentMetadata, ExportReport, ExportRequest, FilterCapabilities,
    FilterDescriptor, FilterError, FilterEvent, FilterEventStream, ImportRequest, ImportedUnit,
    ProbeResult, ValidationReport, collect_imported_document, publish_bytes_noclobber,
};
use tl_filter_office::{
    ByteReplacement, FormatGroup, OfficeError, OfficePackage, RunFormat, XmlTextRange,
    apply_replacements, decode_reference, decode_text, format_groups, parse_relationships,
    rebuild_package, reduce_run_properties, relationship_part, resolve_relationship_target,
    taggable_format_groups, validate_xml,
};
use zip::result::ZipError;

const DOCUMENT_XML_PATH: &str = "word/document.xml";
const MAIN_REL_TYPE: &str = "/officeDocument";
const STRUCTURAL_PATH_PREFIX: &str = "word/document.xml#p:";

/// Bookmark-name prefix for segment anchors embedded on anchored exports.
///
/// `docx-preview` renders a paragraph-level `w:bookmarkStart` as
/// `<span id="{name}">`, so the renderer can map a click on any paragraph back
/// to the grid segment id carried in the bookmark name. The desktop layout
/// preview keys on the same prefix.
pub const ANCHOR_BOOKMARK_PREFIX: &str = "tlseg-";

/// First `w:id` used for anchor bookmarks. Anchored exports are preview
/// artifacts consumed by docx-preview (which keys bookmarks on the name, not
/// the id); the offset only keeps ids clear of small hand-numbered bookmarks.
const ANCHOR_BOOKMARK_ID_BASE: u32 = 700_000;

#[derive(Debug, Error)]
pub enum DocxError {
    #[error("DOCX I/O failed: {0}")]
    Io(#[from] std::io::Error),
    #[error("invalid DOCX ZIP package: {0}")]
    Zip(#[from] ZipError),
    #[error(transparent)]
    Office(#[from] OfficeError),
    #[error("invalid DOCX package: {0}")]
    InvalidPackage(String),
    #[error("invalid filter event stream: {0}")]
    Pipeline(#[from] FilterError),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ExportSummary {
    pub translated_segments: u32,
}

#[derive(Debug, Default, Clone, Copy)]
pub struct DocxFilter;

/// A bounded two-column bilingual table row. The byte ranges are retained so
/// the explicit bilingual filter can update only the target cell on export.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BilingualTableRow {
    pub table_index: u32,
    pub row_number: u32,
    pub structural_path: String,
    pub cells: Vec<String>,
    pub target_ranges: Vec<XmlTextRange>,
    pub target_insert_at: Option<usize>,
    /// Byte offset immediately before the run that owns the target cell's
    /// first text — a schema-valid in-paragraph slot for a `w:bookmarkStart`
    /// segment anchor on anchored (preview) exports. `None` when the target
    /// cell has no text-bearing run.
    pub target_anchor_insert_at: Option<usize>,
}

/// Read logical table rows from the main document part without changing the
/// ordinary paragraph-oriented DOCX filter.
pub fn extract_bilingual_table_rows(source: &Path) -> Result<Vec<BilingualTableRow>, DocxError> {
    let package = OfficePackage::open(source)?;
    let main = discover_main_part(&package)?;
    let bytes = package.require(&main)?;
    parse_bilingual_table_rows(bytes, &main)
}

/// Rebuild a bilingual table DOCX, replacing only target-cell text ranges.
/// Equivalent to [`export_bilingual_table_anchored`] with no anchors, so the
/// user-facing export path stays byte-identical to the pre-anchor pipeline.
pub fn export_bilingual_table(
    source: &Path,
    output: &Path,
    segments: &[Segment],
) -> Result<u32, DocxError> {
    export_bilingual_table_anchored(source, output, segments, &BTreeMap::new())
}

/// Rebuild a bilingual table DOCX, replacing only target-cell text ranges.
///
/// For every structural path in `segment_anchors` whose row still exists, a
/// zero-width bookmark pair named `tlseg-{segment id}` is inserted inside the
/// target-cell paragraph, immediately before the run that owns the cell's
/// first text — the same schema-valid slot the plain DOCX filter uses — so
/// docx-preview renders `<span id="tlseg-…">` and the layout preview can map
/// a click on a target cell back to its grid segment. Anchoring is
/// independent of translation state; a row whose target cell offers no run
/// and receives no translation simply stays unanchored, degrading one click
/// rather than the export.
pub fn export_bilingual_table_anchored(
    source: &Path,
    output: &Path,
    segments: &[Segment],
    segment_anchors: &BTreeMap<String, String>,
) -> Result<u32, DocxError> {
    if source == output {
        return Err(DocxError::InvalidPackage(
            "export path must not replace the managed source".to_string(),
        ));
    }
    DocxFilter.validate(source)?;
    let package = OfficePackage::open(source)?;
    let main = discover_main_part(&package)?;
    let bytes = package.require(&main)?;
    let rows = parse_bilingual_table_rows(bytes, &main)?;
    let targets = segments
        .iter()
        .filter(|segment| !segment.target_text.trim().is_empty())
        .map(|segment| {
            (
                segment.structural_path.as_str(),
                segment.target_text.as_str(),
            )
        })
        .collect::<BTreeMap<_, _>>();
    let mut replacements = Vec::new();
    let mut applied = BTreeSet::new();
    let mut next_anchor_id = ANCHOR_BOOKMARK_ID_BASE;
    for row in rows {
        let anchor = segment_anchors.get(row.structural_path.as_str());
        if let Some(segment_id) = anchor
            && let Some(insert_at) = row.target_anchor_insert_at
        {
            replacements.push(ByteReplacement {
                start: insert_at,
                end: insert_at,
                bytes: anchor_bookmark_bytes(segment_id, next_anchor_id),
            });
            next_anchor_id = next_anchor_id.checked_add(1).ok_or_else(|| {
                DocxError::InvalidPackage("anchor bookmark id overflow".to_string())
            })?;
        }
        let Some(target) = targets.get(row.structural_path.as_str()) else {
            continue;
        };
        if row.target_ranges.is_empty() {
            let insert_at = row.target_insert_at.ok_or_else(|| {
                DocxError::InvalidPackage(format!(
                    "bilingual target cell is missing: {}",
                    row.structural_path
                ))
            })?;
            let mut bytes = b"<w:p>".to_vec();
            // An empty target cell offered no run to anchor before, so the
            // generated paragraph carries the bookmark itself.
            if let Some(segment_id) = anchor
                && row.target_anchor_insert_at.is_none()
            {
                bytes.extend_from_slice(&anchor_bookmark_bytes(segment_id, next_anchor_id));
                next_anchor_id = next_anchor_id.checked_add(1).ok_or_else(|| {
                    DocxError::InvalidPackage("anchor bookmark id overflow".to_string())
                })?;
            }
            bytes.extend_from_slice(b"<w:r><w:t>");
            bytes.extend_from_slice(&tl_filter_office::escape_xml_text(target));
            bytes.extend_from_slice(b"</w:t></w:r></w:p>");
            replacements.push(ByteReplacement {
                start: insert_at,
                end: insert_at,
                bytes,
            });
        } else {
            for (index, range) in row.target_ranges.iter().enumerate() {
                replacements.push(ByteReplacement {
                    start: range.start,
                    end: range.end,
                    bytes: if index == 0 {
                        tl_filter_office::escape_xml_text(target)
                    } else {
                        Vec::new()
                    },
                });
            }
        }
        applied.insert(row.structural_path);
    }
    if applied.len() != targets.len() {
        return Err(DocxError::InvalidPackage(
            "bilingual export contains an unknown structural path".to_string(),
        ));
    }
    let changed = apply_replacements(bytes, &replacements)?;
    let rebuilt = rebuild_package(source, &BTreeMap::from([(main, changed)]))?;
    validate_bytes(&rebuilt)?;
    publish_bytes_noclobber(output, &rebuilt).map_err(DocxError::Pipeline)?;
    u32::try_from(applied.len()).map_err(|_| {
        DocxError::InvalidPackage("bilingual translated row count overflow".to_string())
    })
}

#[derive(Debug, Clone)]
struct ParagraphUnit {
    index: u32,
    text: String,
    ranges: Vec<XmlTextRange>,
    /// Inline formatting signature of the run that owns each range, index
    /// aligned with `ranges`. Empty string means the run carries no `w:rPr`.
    formats: Vec<RunFormat>,
    /// Byte offset immediately before the run that owns the paragraph's first
    /// captured text range — a schema-valid position for a `w:bookmarkStart`
    /// segment anchor. `None` for paragraphs without any captured text.
    anchor_insert_at: Option<usize>,
}

impl ParagraphUnit {
    /// Adjacent ranges that share a formatting signature belong to one visible
    /// span. A paragraph whose runs are all typographically identical has a
    /// single group, and a single group is not a formatting boundary, so it
    /// must not produce protected tags: Word splits runs for reasons that have
    /// nothing to do with typography (spell-check state, revision ids, rsid
    /// bookkeeping), and turning that noise into translator obligations is
    /// what made every DOCX segment demand tag placement it could never
    /// satisfy.
    fn format_groups(&self) -> Vec<FormatGroup> {
        format_groups(&self.ranges, &self.formats)
    }
}

impl DocxFilter {
    pub fn extract_units(&self, source: &Path) -> Result<Vec<ImportedUnit>, DocxError> {
        let request = ImportRequest::new(source.to_path_buf());
        let events = self.extract_events(&request)?;
        Ok(collect_imported_document(events.into_iter().map(Ok))?.units)
    }

    pub fn validate(&self, source: &Path) -> Result<(), DocxError> {
        let package = OfficePackage::open(source)?;
        let main = discover_main_part(&package)?;
        for name in package.names() {
            if name.ends_with(".xml") || name.ends_with(".rels") {
                validate_xml(package.require(name)?, name)?;
            }
        }
        validate_xml(package.require(&main)?, &main)?;
        Ok(())
    }

    /// Export, reporting every paragraph whose inline formatting could not be
    /// carried through. Target text is written into the first run of the
    /// paragraph, so a paragraph that mixed typography in the source comes back
    /// uniform. Saying so out loud is the difference between a known limit and
    /// a silent corruption.
    pub fn export_with_degradation(
        &self,
        source: &Path,
        output: &Path,
        segments: &[Segment],
        segment_anchors: &BTreeMap<String, String>,
    ) -> Result<(ExportSummary, Vec<DegradationFinding>), DocxError> {
        let flattened = self.flattened_formatting_paths(source, segments)?;
        let summary = self.export_anchored(source, output, segments, segment_anchors)?;
        let degradation = flattened
            .into_iter()
            .map(|path| DegradationFinding {
                code: "docx.inline_formatting_flattened".to_string(),
                severity: DegradationSeverity::Warning,
                message: format!(
                    "Inline formatting in {path} was flattened to the paragraph's first run."
                ),
                structural_path: Some(path),
            })
            .collect();
        Ok((summary, degradation))
    }

    fn flattened_formatting_paths(
        &self,
        source: &Path,
        segments: &[Segment],
    ) -> Result<Vec<String>, DocxError> {
        let package = OfficePackage::open(source)?;
        let parts = discover_text_parts(&package, true)?;
        let targets = translations_by_path(segments)?;
        let mut paths = Vec::new();
        for part in parts {
            let bytes = package.require(&part)?;
            for unit in parse_paragraphs(bytes, &part)? {
                let path = paragraph_path(&part, unit.index);
                let Some(target) = targets.get(&path) else {
                    continue;
                };
                if target.trim().is_empty() {
                    continue;
                }
                if unit.format_groups().len() > 1 {
                    paths.push(path);
                }
            }
        }
        Ok(paths)
    }

    pub fn export(
        &self,
        source: &Path,
        output: &Path,
        segments: &[Segment],
    ) -> Result<ExportSummary, DocxError> {
        self.export_anchored(source, output, segments, &BTreeMap::new())
    }

    /// Export with optional segment anchors: for every structural path in
    /// `segment_anchors` that exists in the package, a bookmark pair named
    /// `tlseg-{segment id}` is inserted immediately before the run that owns
    /// the paragraph's first text — translated or not — so a preview renderer
    /// can map layout clicks back to grid segments. An empty map is a plain
    /// export with byte-identical behavior to before anchors existed.
    pub fn export_anchored(
        &self,
        source: &Path,
        output: &Path,
        segments: &[Segment],
        segment_anchors: &BTreeMap<String, String>,
    ) -> Result<ExportSummary, DocxError> {
        if source == output {
            return Err(DocxError::InvalidPackage(
                "export path must not replace the managed source".to_string(),
            ));
        }
        self.validate(source)?;
        let package = OfficePackage::open(source)?;
        let parts = discover_text_parts(&package, true)?;
        let targets = translations_by_path(segments)?;
        let mut replacements = BTreeMap::new();
        let mut applied = BTreeSet::new();
        let mut translated_segments = 0_u32;
        let mut next_anchor_id = ANCHOR_BOOKMARK_ID_BASE;
        for part in parts {
            let bytes = package.require(&part)?;
            let units = parse_paragraphs(bytes, &part)?;
            let mut part_replacements = Vec::new();
            for unit in units {
                let path = paragraph_path(&part, unit.index);
                // Anchors cover every anchored paragraph that still exists in
                // the package, independent of translation state: the layout
                // preview renders untranslated paragraphs too, and clicking
                // one must jump just the same. Anchor paths that vanished from
                // the package are skipped — a lost anchor degrades one click,
                // unlike a lost translation, which would corrupt the export.
                if let Some(segment_id) = segment_anchors.get(&path)
                    && let Some(insert_at) = unit.anchor_insert_at
                {
                    part_replacements.push(ByteReplacement {
                        start: insert_at,
                        end: insert_at,
                        bytes: anchor_bookmark_bytes(segment_id, next_anchor_id),
                    });
                    next_anchor_id = next_anchor_id.checked_add(1).ok_or_else(|| {
                        DocxError::InvalidPackage("anchor bookmark id overflow".to_string())
                    })?;
                }
                let Some(target) = targets.get(&path) else {
                    continue;
                };
                if target.trim().is_empty() {
                    continue;
                }
                for (index, range) in unit.ranges.iter().enumerate() {
                    part_replacements.push(ByteReplacement {
                        start: range.start,
                        end: range.end,
                        bytes: if index == 0 {
                            tl_filter_office::escape_xml_text(target)
                        } else {
                            Vec::new()
                        },
                    });
                }
                applied.insert(path);
                translated_segments = translated_segments.checked_add(1).ok_or_else(|| {
                    DocxError::InvalidPackage("translated paragraph count overflow".to_string())
                })?;
            }
            if !part_replacements.is_empty() {
                replacements.insert(part.clone(), apply_replacements(bytes, &part_replacements)?);
            }
        }
        if applied.len() != targets.len() {
            let missing = targets
                .keys()
                .find(|path| !applied.contains(*path))
                .cloned()
                .unwrap_or_else(|| "unknown".to_string());
            return Err(DocxError::InvalidPackage(format!(
                "DOCX structural path does not exist in source package: {missing}"
            )));
        }
        let rebuilt = rebuild_package(source, &replacements)?;
        validate_bytes(&rebuilt)?;
        publish_bytes_noclobber(output, &rebuilt).map_err(DocxError::Pipeline)?;
        Ok(ExportSummary {
            translated_segments,
        })
    }

    fn extract_events(&self, request: &ImportRequest) -> Result<Vec<FilterEvent>, DocxError> {
        let include_comments =
            parse_bool_option(&request.options, "includeComments")?.unwrap_or(false);
        let package = OfficePackage::open(&request.source)?;
        let degradation = docx_degradations(&package);
        let parts = discover_text_parts(&package, include_comments)?;
        let document_id = request.document_id.as_deref().unwrap_or("docx");
        let mut events = vec![FilterEvent::StartDocument {
            metadata: DocumentMetadata {
                format: "docx".to_string(),
                source_locale: request.source_locale.clone(),
                properties: BTreeMap::from([
                    ("filter".to_string(), "builtin.docx".to_string()),
                    ("partCount".to_string(), parts.len().to_string()),
                ]),
            },
        }];
        events.extend(degradation.iter().cloned().map(FilterEvent::Degradation));
        let mut ordinal = 0_u32;
        for part in parts {
            for unit in parse_paragraphs(package.require(&part)?, &part)? {
                if normalize_text(&unit.text).is_empty() {
                    continue;
                }
                let path = paragraph_path(&part, unit.index);
                events.push(FilterEvent::StartUnit {
                    ordinal,
                    structural_path: path,
                });
                events.push(FilterEvent::Text(unit.text.clone()));
                if part.ends_with("/comments.xml") {
                    events.push(FilterEvent::Note(DocumentNote {
                        id: format!("{document_id}:docx-comment:{ordinal}"),
                        text: unit.text.clone(),
                        author: None,
                    }));
                }
                append_run_tags(&mut events, document_id, ordinal, &unit)?;
                events.push(FilterEvent::EndUnit);
                ordinal = ordinal.checked_add(1).ok_or_else(|| {
                    DocxError::InvalidPackage("DOCX unit count overflow".to_string())
                })?;
            }
        }
        if ordinal == 0 {
            return Err(DocxError::InvalidPackage(
                "DOCX package contains no translatable paragraphs".to_string(),
            ));
        }
        events.push(FilterEvent::EndDocument);
        Ok(events)
    }
}

impl DocumentFilter for DocxFilter {
    fn descriptor(&self) -> FilterDescriptor {
        FilterDescriptor {
            id: "builtin.docx".to_string(),
            version: env!("CARGO_PKG_VERSION").to_string(),
            display_name: "Microsoft Word DOCX".to_string(),
            extensions: vec!["docx".to_string()],
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
        let extension_matches = source
            .extension()
            .and_then(|extension| extension.to_str())
            .is_some_and(|extension| extension.eq_ignore_ascii_case("docx"));
        if !extension_matches {
            return Ok(ProbeResult::no_match("file extension is not .docx"));
        }
        match self.validate(source) {
            Ok(()) => Ok(ProbeResult::matches(100, "valid DOCX OOXML package")),
            Err(DocxError::Io(error)) => Err(FilterError::Io(error)),
            Err(DocxError::Office(OfficeError::Io(error))) => Err(FilterError::Io(error)),
            Err(error) => Ok(ProbeResult::no_match(error.to_string())),
        }
    }

    fn import(&self, request: ImportRequest) -> Result<FilterEventStream, FilterError> {
        Ok(Box::new(
            self.extract_events(&request)
                .map_err(map_docx_error)?
                .into_iter()
                .map(Ok),
        ))
    }

    fn export(&self, request: ExportRequest<'_>) -> Result<ExportReport, FilterError> {
        let package = OfficePackage::open(request.source)
            .map_err(DocxError::from)
            .map_err(map_docx_error)?;
        let mut degradation = docx_degradations(&package);
        let (summary, flattened) = DocxFilter::export_with_degradation(
            self,
            request.source,
            request.output,
            request.segments,
            &request.segment_anchors,
        )
        .map_err(map_docx_error)?;
        degradation.extend(flattened);
        Ok(ExportReport {
            output_path: request.output.display().to_string(),
            translated_segments: summary.translated_segments,
            degradation,
        })
    }

    fn validate(&self, source: &Path) -> Result<ValidationReport, FilterError> {
        DocxFilter::validate(self, source).map_err(map_docx_error)?;
        Ok(ValidationReport {
            valid: true,
            findings: Vec::new(),
        })
    }
}

/// Explicit two-column bilingual DOCX mode. It never participates in
/// automatic `.docx` probing because ordinary DOCX remains the default.
#[derive(Debug, Default, Clone, Copy)]
pub struct BilingualDocxFilter;

impl DocumentFilter for BilingualDocxFilter {
    fn descriptor(&self) -> FilterDescriptor {
        FilterDescriptor {
            id: "builtin.bilingual-docx".to_string(),
            version: env!("CARGO_PKG_VERSION").to_string(),
            display_name: "Bilingual review table DOCX".to_string(),
            extensions: vec!["docx".to_string()],
            capabilities: FilterCapabilities {
                import: true,
                export: true,
                validate: true,
                inline_tags: false,
                notes: true,
                degradation_report: true,
            },
        }
    }

    fn probe(&self, _source: &Path) -> Result<ProbeResult, FilterError> {
        Ok(ProbeResult::no_match(
            "bilingual DOCX mode requires an explicit filter id",
        ))
    }

    fn import(&self, request: ImportRequest) -> Result<FilterEventStream, FilterError> {
        let rows = extract_bilingual_table_rows(&request.source).map_err(map_docx_error)?;
        let document_id = request.document_id.as_deref().unwrap_or("bilingual-docx");
        let mut events = vec![FilterEvent::StartDocument {
            metadata: DocumentMetadata {
                format: "bilingual-docx".to_string(),
                source_locale: request.source_locale,
                properties: BTreeMap::from([(
                    "filter".to_string(),
                    "builtin.bilingual-docx".to_string(),
                )]),
            },
        }];
        let mut headers_by_table = BTreeMap::<u32, Vec<String>>::new();
        let mut seen_tables = BTreeSet::new();
        let mut ordinal = 0_u32;
        for row in rows {
            if seen_tables.insert(row.table_index) && is_bilingual_header(&row) {
                headers_by_table.insert(row.table_index, row.cells);
                continue;
            }
            if row.cells.len() < 2 {
                return Err(FilterError::Invalid(format!(
                    "bilingual row {} in table {} requires source and target cells",
                    row.row_number, row.table_index
                )));
            }
            let source = row.cells.first().cloned().unwrap_or_default();
            let target = row.cells.get(1).cloned().unwrap_or_default();
            if source.trim().is_empty() || target.trim().is_empty() {
                return Err(FilterError::Invalid(format!(
                    "bilingual row {} requires source and target cells",
                    row.row_number
                )));
            }
            let mut properties = BTreeMap::new();
            if let Some(headers) = headers_by_table.get(&row.table_index) {
                for (index, value) in row.cells.iter().enumerate().skip(2) {
                    if let Some(name) = headers.get(index).filter(|name| !name.trim().is_empty()) {
                        properties.insert(name.clone(), value.clone());
                    }
                }
            }
            events.push(FilterEvent::StartUnit {
                ordinal,
                structural_path: row.structural_path,
            });
            events.push(FilterEvent::Text(source));
            events.push(FilterEvent::TargetText(target));
            if !properties.is_empty() {
                let metadata = serde_json::to_string(&properties).map_err(|error| {
                    FilterError::Processing(format!("cannot encode bilingual metadata: {error}"))
                })?;
                if metadata.len() > 1024 * 1024 {
                    return Err(FilterError::Invalid(format!(
                        "bilingual metadata exceeds 1 MiB for row {}",
                        row.row_number
                    )));
                }
                events.push(FilterEvent::Note(DocumentNote {
                    id: format!("{document_id}:bilingual-row:{ordinal}"),
                    text: metadata,
                    author: None,
                }));
            }
            events.push(FilterEvent::EndUnit);
            ordinal = ordinal
                .checked_add(1)
                .ok_or_else(|| FilterError::Invalid("bilingual row count overflow".to_string()))?;
        }
        if ordinal == 0 {
            return Err(FilterError::Invalid(
                "bilingual DOCX contains no data rows".to_string(),
            ));
        }
        events.push(FilterEvent::EndDocument);
        Ok(Box::new(events.into_iter().map(Ok)))
    }

    fn export(&self, request: ExportRequest<'_>) -> Result<ExportReport, FilterError> {
        // Preview-only anchors ride the same request field the plain DOCX
        // filter uses: each anchored row gets a `tlseg-{segment id}` bookmark
        // inside its target-cell paragraph. An empty map keeps user-facing
        // exports byte-identical to the pre-anchor pipeline.
        let translated_segments = export_bilingual_table_anchored(
            request.source,
            request.output,
            request.segments,
            &request.segment_anchors,
        )
        .map_err(map_docx_error)?;
        Ok(ExportReport {
            output_path: request.output.display().to_string(),
            translated_segments,
            degradation: Vec::new(),
        })
    }

    fn validate(&self, source: &Path) -> Result<ValidationReport, FilterError> {
        DocxFilter.validate(source).map_err(map_docx_error)?;
        let rows = extract_bilingual_table_rows(source).map_err(map_docx_error)?;
        if rows.is_empty() {
            return Err(FilterError::Invalid(
                "bilingual DOCX contains no table rows".to_string(),
            ));
        }
        Ok(ValidationReport {
            valid: true,
            findings: Vec::new(),
        })
    }
}

fn is_bilingual_header(row: &BilingualTableRow) -> bool {
    let source = row
        .cells
        .first()
        .map(|value| value.trim().to_ascii_lowercase())
        .unwrap_or_default();
    let target = row
        .cells
        .get(1)
        .map(|value| value.trim().to_ascii_lowercase())
        .unwrap_or_default();
    matches!(source.as_str(), "source" | "source text" | "原文")
        && matches!(
            target.as_str(),
            "target" | "target text" | "translation" | "译文"
        )
}

fn map_docx_error(error: DocxError) -> FilterError {
    match error {
        DocxError::Io(error) => FilterError::Io(error),
        DocxError::Office(OfficeError::Io(error)) => FilterError::Io(error),
        DocxError::InvalidPackage(message) => FilterError::Invalid(message),
        DocxError::Pipeline(error) => error,
        other => FilterError::Invalid(other.to_string()),
    }
}

fn discover_main_part(package: &OfficePackage) -> Result<String, DocxError> {
    let relationships = parse_relationships(package.require("_rels/.rels")?, "_rels/.rels")?;
    let relationship = relationships
        .iter()
        .find(|relationship| relationship.relationship_type.ends_with(MAIN_REL_TYPE))
        .ok_or_else(|| {
            DocxError::InvalidPackage("package has no main document relationship".to_string())
        })?;
    let part = resolve_relationship_target("", relationship)?.ok_or_else(|| {
        DocxError::InvalidPackage("main document relationship is external".to_string())
    })?;
    package.require(&part)?;
    Ok(part)
}

fn discover_text_parts(
    package: &OfficePackage,
    include_comments: bool,
) -> Result<Vec<String>, DocxError> {
    let main = discover_main_part(package)?;
    let mut parts = vec![main.clone()];
    let mut seen = BTreeSet::from([main.clone()]);
    let rels_part = relationship_part(&main)?;
    if let Some(rels_bytes) = package.get(&rels_part) {
        for relationship in parse_relationships(rels_bytes, &rels_part)? {
            let kind = relationship.relationship_type.as_str();
            let allowed = kind.ends_with("/header")
                || kind.ends_with("/footer")
                || kind.ends_with("/footnotes")
                || kind.ends_with("/endnotes")
                || (include_comments && kind.ends_with("/comments"));
            if !allowed {
                continue;
            }
            if let Some(part) = resolve_relationship_target(&main, &relationship)? {
                package.require(&part)?;
                if seen.insert(part.clone()) {
                    parts.push(part);
                }
            }
        }
    }
    // A few producers omit document relationships for a header/footer part;
    // include only conventional Word text parts as a conservative fallback.
    let mut fallback = package
        .names()
        .filter(|name| {
            (name.starts_with("word/header") || name.starts_with("word/footer"))
                && name.ends_with(".xml")
        })
        .map(ToOwned::to_owned)
        .collect::<Vec<_>>();
    fallback.sort();
    for part in fallback {
        if seen.insert(part.clone()) {
            parts.push(part);
        }
    }
    Ok(parts)
}

fn parse_paragraphs(bytes: &[u8], part: &str) -> Result<Vec<ParagraphUnit>, DocxError> {
    validate_xml(bytes, part)?;
    let mut reader = Reader::from_reader(bytes);
    reader.config_mut().trim_text(false);
    let mut buffer = Vec::new();
    let mut paragraph_stack: Vec<ParagraphBuilder> = Vec::new();
    let mut text: Option<(usize, String)> = None;
    let mut revision_excluded = 0_u32;
    let mut paragraph_index = 0_u32;
    let mut paragraphs = Vec::new();
    // Formatting of the run currently being read, and whether the reader is
    // inside that run's `w:rPr` (run properties also appear on paragraphs and
    // on other elements, so depth has to be tracked rather than assumed).
    let mut run_properties: Vec<String> = Vec::new();
    let mut in_run_properties = false;
    let mut run_depth = 0_u32;
    loop {
        let before = usize::try_from(reader.buffer_position())
            .map_err(|_| DocxError::InvalidPackage("DOCX XML offset overflow".to_string()))?;
        match reader.read_event_into(&mut buffer) {
            Ok(Event::Start(element)) => {
                let local = element.name().local_name();
                match local.as_ref() {
                    b"del" | b"moveFrom" => revision_excluded = revision_excluded.saturating_add(1),
                    b"p" => {
                        let index = paragraph_index;
                        paragraph_index = paragraph_index.checked_add(1).ok_or_else(|| {
                            DocxError::InvalidPackage("DOCX paragraph count overflow".to_string())
                        })?;
                        paragraph_stack.push(ParagraphBuilder {
                            index,
                            text: String::new(),
                            ranges: Vec::new(),
                            formats: Vec::new(),
                            anchor_insert_at: None,
                            pending_run_start: None,
                        });
                    }
                    b"r" if !paragraph_stack.is_empty() => {
                        run_depth = run_depth.saturating_add(1);
                        run_properties.clear();
                        // Remember where the run's start tag begins: when this
                        // run turns out to own the paragraph's first text, that
                        // offset is a schema-valid slot for an anchor bookmark
                        // (after `w:pPr`, sibling of the run). Tracked on the
                        // innermost paragraph so textbox content anchors into
                        // its own paragraph, not the host's.
                        if let Some(current) = paragraph_stack.last_mut() {
                            current.pending_run_start = Some(before);
                        }
                    }
                    b"rPr" if run_depth > 0 => in_run_properties = true,
                    b"t" if !paragraph_stack.is_empty() && revision_excluded == 0 => {
                        text = Some((
                            usize::try_from(reader.buffer_position()).map_err(|_| {
                                DocxError::InvalidPackage("DOCX text offset overflow".to_string())
                            })?,
                            String::new(),
                        ));
                    }
                    _ if in_run_properties => {
                        run_properties.push(String::from_utf8_lossy(local.as_ref()).into_owned());
                    }
                    _ => {}
                }
            }
            Ok(Event::Empty(element)) => {
                let local = element.name().local_name();
                // Run properties are nearly always empty elements: `<w:b/>`.
                if in_run_properties {
                    run_properties.push(String::from_utf8_lossy(local.as_ref()).into_owned());
                } else if local.as_ref() == b"rPr" && run_depth > 0 {
                    run_properties.clear();
                }
                if revision_excluded == 0
                    && let Some(current) = paragraph_stack.last_mut()
                {
                    match local.as_ref() {
                        b"tab" => current.text.push('\t'),
                        b"br" | b"cr" => current.text.push('\n'),
                        _ => {}
                    }
                }
            }
            Ok(Event::Text(value)) if revision_excluded == 0 => {
                if let Some((_, text_value)) = text.as_mut() {
                    text_value.push_str(&decode_text(&value)?);
                }
            }
            Ok(Event::GeneralRef(reference)) if revision_excluded == 0 => {
                if let Some((_, text_value)) = text.as_mut() {
                    text_value.push_str(&decode_reference(&reference)?);
                }
            }
            Ok(Event::End(element)) => {
                let local = element.name().local_name();
                match local.as_ref() {
                    b"t" => {
                        if let Some((start, value)) = text.take()
                            && let Some(current) = paragraph_stack.last_mut()
                        {
                            if current.anchor_insert_at.is_none() {
                                current.anchor_insert_at = current.pending_run_start;
                            }
                            current.text.push_str(&value);
                            current.ranges.push(XmlTextRange {
                                start,
                                end: before,
                                text: value,
                            });
                            current.formats.push(reduce_run_properties(&run_properties));
                        }
                    }
                    b"rPr" => in_run_properties = false,
                    b"r" => {
                        run_depth = run_depth.saturating_sub(1);
                        if run_depth == 0 {
                            run_properties.clear();
                        }
                    }
                    b"del" | b"moveFrom" => revision_excluded = revision_excluded.saturating_sub(1),
                    b"p" => {
                        if let Some(current) = paragraph_stack.pop() {
                            paragraphs.push(current.finish());
                        }
                    }
                    _ => {}
                }
            }
            Ok(Event::Eof) => break,
            Ok(_) => {}
            Err(error) => {
                return Err(DocxError::InvalidPackage(format!(
                    "cannot parse {part}: {error}"
                )));
            }
        }
        buffer.clear();
    }
    if !paragraph_stack.is_empty() {
        return Err(DocxError::InvalidPackage(format!(
            "unclosed paragraph in {part}"
        )));
    }
    paragraphs.sort_by_key(|paragraph| paragraph.index);
    Ok(paragraphs)
}

fn parse_bilingual_table_rows(
    bytes: &[u8],
    part: &str,
) -> Result<Vec<BilingualTableRow>, DocxError> {
    validate_xml(bytes, part)?;
    let mut reader = Reader::from_reader(bytes);
    reader.config_mut().trim_text(false);
    let mut buffer = Vec::new();
    let mut table_depth = 0_u32;
    let mut next_table_index = 0_u32;
    let mut table_index = None;
    let mut row: Option<TableRowBuilder> = None;
    let mut cell: Option<TableCellBuilder> = None;
    let mut text: Option<(usize, String)> = None;
    let mut rows = Vec::new();
    let mut row_number = 0_u32;
    loop {
        let before = usize::try_from(reader.buffer_position())
            .map_err(|_| DocxError::InvalidPackage("DOCX XML offset overflow".to_string()))?;
        match reader.read_event_into(&mut buffer) {
            Ok(Event::Start(element)) => {
                let local = element.name().local_name();
                match local.as_ref() {
                    b"tbl" => {
                        if table_depth == 0 {
                            table_index = Some(next_table_index);
                            next_table_index =
                                next_table_index.checked_add(1).ok_or_else(|| {
                                    DocxError::InvalidPackage(
                                        "bilingual table count overflow".to_string(),
                                    )
                                })?;
                            row_number = 0;
                        }
                        table_depth = table_depth.saturating_add(1);
                        if table_depth > 4 {
                            return Err(DocxError::InvalidPackage(
                                "bilingual table nesting exceeds the limit".to_string(),
                            ));
                        }
                    }
                    b"tr" if table_depth == 1 && row.is_none() => {
                        row = Some(TableRowBuilder {
                            row_number,
                            cells: Vec::new(),
                        });
                        row_number = row_number.checked_add(1).ok_or_else(|| {
                            DocxError::InvalidPackage("bilingual row count overflow".to_string())
                        })?;
                    }
                    b"tc" if table_depth == 1 && row.is_some() && cell.is_none() => {
                        cell = Some(TableCellBuilder {
                            text: String::new(),
                            ranges: Vec::new(),
                            insert_at: None,
                            anchor_insert_at: None,
                            pending_run_start: None,
                        });
                    }
                    b"r" if table_depth == 1 && cell.is_some() => {
                        // Remember where the run's start tag begins: when this
                        // run turns out to own the cell's first text, that
                        // offset is a schema-valid slot for an anchor bookmark
                        // (inside the paragraph, sibling of the run). Nested
                        // tables sit at depth > 1 and never anchor.
                        if let Some(current) = cell.as_mut() {
                            current.pending_run_start = Some(before);
                        }
                    }
                    b"t" if table_depth == 1 && cell.is_some() => {
                        text = Some((
                            usize::try_from(reader.buffer_position()).map_err(|_| {
                                DocxError::InvalidPackage("DOCX text offset overflow".to_string())
                            })?,
                            String::new(),
                        ));
                    }
                    _ => {}
                }
            }
            Ok(Event::Empty(element)) => {
                if table_depth == 1
                    && let Some(current) = cell.as_mut()
                {
                    match element.name().local_name().as_ref() {
                        b"tab" => current.text.push('\t'),
                        b"br" | b"cr" => current.text.push('\n'),
                        _ => {}
                    }
                }
            }
            Ok(Event::Text(value)) => {
                if let Some((_, text_value)) = text.as_mut() {
                    text_value.push_str(&decode_text(&value)?);
                }
            }
            Ok(Event::GeneralRef(reference)) => {
                if let Some((_, text_value)) = text.as_mut() {
                    text_value.push_str(&decode_reference(&reference)?);
                }
            }
            Ok(Event::End(element)) => {
                let local = element.name().local_name();
                match local.as_ref() {
                    b"t" => {
                        if let Some((start, value)) = text.take()
                            && let Some(current) = cell.as_mut()
                        {
                            if current.anchor_insert_at.is_none() {
                                current.anchor_insert_at = current.pending_run_start;
                            }
                            current.text.push_str(&value);
                            current.ranges.push(XmlTextRange {
                                start,
                                end: before,
                                text: value,
                            });
                        }
                    }
                    b"tc" if table_depth == 1 => {
                        if let Some(mut current) = cell.take()
                            && let Some(current_row) = row.as_mut()
                        {
                            current.insert_at = Some(before);
                            if current.text.len() > 1024 * 1024 {
                                return Err(DocxError::InvalidPackage(format!(
                                    "bilingual cell exceeds 1 MiB in table {} row {}",
                                    table_index.unwrap_or_default(),
                                    current_row.row_number
                                )));
                            }
                            current_row.cells.push(current);
                        }
                    }
                    b"tr" if table_depth == 1 => {
                        if let Some(current_row) = row.take() {
                            if current_row.cells.len() > 64 {
                                return Err(DocxError::InvalidPackage(format!(
                                    "bilingual row {} has more than 64 cells",
                                    current_row.row_number
                                )));
                            }
                            let current_table = table_index.ok_or_else(|| {
                                DocxError::InvalidPackage(
                                    "bilingual row is outside a table".to_string(),
                                )
                            })?;
                            let cells = current_row
                                .cells
                                .iter()
                                .map(|cell| cell.text.clone())
                                .collect::<Vec<_>>();
                            rows.push(BilingualTableRow {
                                table_index: current_table,
                                row_number: current_row.row_number,
                                structural_path: format!(
                                    "bilingual-docx:{part}#table:{current_table}/row:{}",
                                    current_row.row_number
                                ),
                                target_ranges: current_row
                                    .cells
                                    .get(1)
                                    .map(|cell| cell.ranges.clone())
                                    .unwrap_or_default(),
                                target_insert_at: current_row
                                    .cells
                                    .get(1)
                                    .and_then(|cell| cell.insert_at),
                                target_anchor_insert_at: current_row
                                    .cells
                                    .get(1)
                                    .and_then(|cell| cell.anchor_insert_at),
                                cells,
                            });
                            if rows.len() > 100_000 {
                                return Err(DocxError::InvalidPackage(
                                    "bilingual table exceeds 100000 rows".to_string(),
                                ));
                            }
                        }
                    }
                    b"tbl" => {
                        table_depth = table_depth.saturating_sub(1);
                        if table_depth == 0 {
                            table_index = None;
                        }
                    }
                    _ => {}
                }
            }
            Ok(Event::Eof) => break,
            Ok(_) => {}
            Err(error) => {
                return Err(DocxError::InvalidPackage(format!(
                    "cannot parse bilingual table {part}: {error}"
                )));
            }
        }
        buffer.clear();
    }
    if table_depth != 0 || row.is_some() || cell.is_some() || text.is_some() {
        return Err(DocxError::InvalidPackage(
            "unclosed bilingual table structure".to_string(),
        ));
    }
    Ok(rows)
}

#[derive(Debug)]
struct TableRowBuilder {
    row_number: u32,
    cells: Vec<TableCellBuilder>,
}

#[derive(Debug)]
struct TableCellBuilder {
    text: String,
    ranges: Vec<XmlTextRange>,
    insert_at: Option<usize>,
    /// In-paragraph offset before the run owning the cell's first text.
    anchor_insert_at: Option<usize>,
    /// Start offset of the most recently opened run in this cell.
    pending_run_start: Option<usize>,
}

#[derive(Debug)]
struct ParagraphBuilder {
    index: u32,
    text: String,
    ranges: Vec<XmlTextRange>,
    formats: Vec<RunFormat>,
    anchor_insert_at: Option<usize>,
    /// Start offset of the most recently opened run in this paragraph.
    pending_run_start: Option<usize>,
}

impl ParagraphBuilder {
    fn finish(self) -> ParagraphUnit {
        ParagraphUnit {
            index: self.index,
            text: self.text,
            ranges: self.ranges,
            formats: self.formats,
            anchor_insert_at: self.anchor_insert_at,
        }
    }
}

/// A zero-width bookmark pair naming the grid segment that owns a paragraph.
/// The segment id is XML-escaped defensively; engine ids are UUIDs.
fn anchor_bookmark_bytes(segment_id: &str, bookmark_id: u32) -> Vec<u8> {
    let mut bytes =
        format!("<w:bookmarkStart w:id=\"{bookmark_id}\" w:name=\"{ANCHOR_BOOKMARK_PREFIX}")
            .into_bytes();
    bytes.extend_from_slice(&tl_filter_office::escape_xml_text(segment_id));
    bytes.extend_from_slice(format!("\"/><w:bookmarkEnd w:id=\"{bookmark_id}\"/>").as_bytes());
    bytes
}

fn paragraph_path(part: &str, index: u32) -> String {
    if part == DOCUMENT_XML_PATH {
        format!("{STRUCTURAL_PATH_PREFIX}{index}")
    } else {
        format!("{part}#p:{index}")
    }
}

fn translations_by_path(segments: &[Segment]) -> Result<HashMap<String, String>, DocxError> {
    let mut translations = HashMap::new();
    for segment in segments {
        if segment.target_text.trim().is_empty() {
            continue;
        }
        if !(segment.structural_path.starts_with("word/")
            && segment.structural_path.contains("#p:"))
        {
            return Err(DocxError::InvalidPackage(format!(
                "unsupported DOCX structural path {}",
                segment.structural_path
            )));
        }
        if translations
            .insert(segment.structural_path.clone(), segment.target_text.clone())
            .is_some()
        {
            return Err(DocxError::InvalidPackage(format!(
                "duplicate DOCX structural path {}",
                segment.structural_path
            )));
        }
    }
    Ok(translations)
}

/// Emit protected tags for the formatting boundaries a translator must carry.
///
/// A paragraph whose runs are typographically uniform produces no tags at all.
/// Word splits runs for bookkeeping reasons that are invisible to a reader, and
/// the previous behaviour — one protected pair per `w:t` — turned that noise
/// into an obligation on every single segment of every DOCX, which no amount of
/// correct translation could discharge.
fn append_run_tags(
    events: &mut Vec<FilterEvent>,
    document_id: &str,
    ordinal: u32,
    unit: &ParagraphUnit,
) -> Result<(), DocxError> {
    let groups = unit.format_groups();
    let source_chars = u32::try_from(unit.text.chars().count())
        .map_err(|_| DocxError::InvalidPackage("paragraph length overflow".to_string()))?;
    for (index, group) in taggable_format_groups(&groups) {
        if group.end > source_chars {
            return Err(DocxError::InvalidPackage(
                "run tags exceed paragraph source text".to_string(),
            ));
        }
        let pair_id = format!("{document_id}:docx:{ordinal}:{index}");
        let display_text = group.format.label.clone();
        let payload = format!("ooxml-run:{}", group.format.signature);
        events.push(FilterEvent::InlineTag(InlineTag {
            id: format!("{pair_id}:start"),
            side: TagSide::Source,
            position: group.start,
            kind: TagKind::Start,
            pair_id: Some(pair_id.clone()),
            payload: payload.clone(),
            display_text: display_text.clone(),
            protected: true,
        }));
        events.push(FilterEvent::InlineTag(InlineTag {
            id: format!("{pair_id}:end"),
            side: TagSide::Source,
            position: group.end,
            kind: TagKind::End,
            pair_id: Some(pair_id),
            payload,
            display_text,
            protected: true,
        }));
    }
    Ok(())
}

fn parse_bool_option(
    options: &BTreeMap<String, String>,
    key: &str,
) -> Result<Option<bool>, DocxError> {
    options
        .get(key)
        .map(|value| match value.trim().to_ascii_lowercase().as_str() {
            "true" | "1" | "yes" => Ok(true),
            "false" | "0" | "no" => Ok(false),
            _ => Err(DocxError::InvalidPackage(format!(
                "{key} must be true or false"
            ))),
        })
        .transpose()
}

fn validate_bytes(bytes: &[u8]) -> Result<(), DocxError> {
    let package = OfficePackage::from_bytes(bytes)?;
    let _ = discover_main_part(&package)?;
    for name in package.names() {
        if name.ends_with(".xml") || name.ends_with(".rels") {
            validate_xml(package.require(name)?, name)?;
        }
    }
    Ok(())
}

fn docx_degradations(package: &OfficePackage) -> Vec<DegradationFinding> {
    package
        .opaque_features()
        .into_iter()
        .map(|feature| {
            let (code, message) = match feature.kind {
                tl_filter_office::OpaqueFeatureKind::Macro => (
                    "docx.macro-preserved",
                    "VBA macro part is preserved but not executed or translated",
                ),
                tl_filter_office::OpaqueFeatureKind::ActiveX => (
                    "docx.activex-preserved",
                    "ActiveX part is preserved but not executed",
                ),
                tl_filter_office::OpaqueFeatureKind::EmbeddedObject => (
                    "docx.embedded-object-preserved",
                    "embedded object is preserved but not translated",
                ),
            };
            DegradationFinding {
                code: code.to_string(),
                severity: DegradationSeverity::Warning,
                message: message.to_string(),
                structural_path: Some(feature.part),
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use tl_domain::{SegmentState, new_id, segment_hashes};

    use super::*;

    fn segments_for(units: &[ImportedUnit]) -> Vec<Segment> {
        units
            .iter()
            .map(|unit| {
                let (source_hash, context_hash) = segment_hashes(&unit.source_text, None, None);
                Segment {
                    id: new_id(),
                    document_id: "fixture-document".to_string(),
                    ordinal: unit.ordinal,
                    structural_path: unit.structural_path.clone(),
                    source_text: unit.source_text.clone(),
                    target_text: String::new(),
                    state: SegmentState::Untranslated,
                    revision: 0,
                    source_hash,
                    context_hash,
                    updated_at_ms: 0,
                }
            })
            .collect()
    }

    #[test]
    fn extracts_body_table_and_multi_run_paragraphs() {
        let temp = tempfile::tempdir().expect("temporary directory");
        let source = temp.path().join("fixture.docx");
        fixture::write_fixture(&source).expect("write fixture");

        let units = DocxFilter.extract_units(&source).expect("extract fixture");
        assert_eq!(units.len(), 3);
        assert_eq!(units[0].source_text, "The retention period is 30 days.");
        assert_eq!(units[0].structural_path, "word/document.xml#p:0");
        assert_eq!(units[1].source_text, "Table amount: 1,200.");
        assert_eq!(units[1].structural_path, "word/document.xml#p:2");
        assert_eq!(units[2].source_text, "This paragraph remains untranslated.");
        assert_eq!(units[2].structural_path, "word/document.xml#p:3");
    }

    #[test]
    fn exports_translation_and_preserves_unowned_parts() {
        let temp = tempfile::tempdir().expect("temporary directory");
        let source = temp.path().join("fixture.docx");
        let output = temp.path().join("translated.docx");
        fixture::write_fixture(&source).expect("write fixture");
        let units = DocxFilter.extract_units(&source).expect("extract fixture");
        let mut segments = segments_for(&units);
        segments[0].target_text = "保留期为 30 天 & 继续。".to_string();
        segments[0].state = SegmentState::Confirmed;

        let summary = DocxFilter
            .export(&source, &output, &segments)
            .expect("export fixture");
        assert_eq!(summary.translated_segments, 1);
        let exported = DocxFilter.extract_units(&output).expect("reopen export");
        assert_eq!(exported[0].source_text, "保留期为 30 天 & 继续。");
        assert_eq!(exported[1].source_text, "Table amount: 1,200.");
        assert_eq!(
            exported[2].source_text,
            "This paragraph remains untranslated."
        );
        let source_package = OfficePackage::open(&source).expect("source package");
        let output_package = OfficePackage::open(&output).expect("output package");
        assert_eq!(
            source_package.get("customXml/item1.xml"),
            output_package.get("customXml/item1.xml")
        );
    }

    #[test]
    fn anchored_export_bookmarks_every_paragraph_and_stays_out_of_plain_exports() {
        let temp = tempfile::tempdir().expect("temporary directory");
        let source = temp.path().join("fixture.docx");
        let plain = temp.path().join("plain.docx");
        let anchored = temp.path().join("anchored.docx");
        fixture::write_fixture(&source).expect("write fixture");
        let units = DocxFilter.extract_units(&source).expect("extract fixture");
        let mut segments = segments_for(&units);
        segments[0].target_text = "保留期为 30 天。".to_string();
        segments[0].state = SegmentState::Confirmed;
        let anchors: BTreeMap<String, String> = segments
            .iter()
            .map(|segment| (segment.structural_path.clone(), segment.id.clone()))
            .collect();

        let summary = DocxFilter
            .export_anchored(&source, &anchored, &segments, &anchors)
            .expect("anchored export");
        assert_eq!(summary.translated_segments, 1);
        let package = OfficePackage::open(&anchored).expect("anchored package");
        let xml = String::from_utf8(package.require("word/document.xml").expect("main").to_vec())
            .expect("utf-8 document part");
        // Every anchored paragraph gets a bookmark pair named after its grid
        // segment — the untranslated ones included, because the layout preview
        // renders and must jump from those too.
        for segment in &segments {
            assert!(
                xml.contains(&format!(
                    "w:name=\"{ANCHOR_BOOKMARK_PREFIX}{}\"",
                    segment.id
                )),
                "missing anchor for {}",
                segment.structural_path
            );
        }
        // The anchor sits inside the paragraph, immediately before the run
        // that received the translation, where docx-preview renders bookmarks.
        let start = xml.find(&format!("{ANCHOR_BOOKMARK_PREFIX}{}", segments[0].id));
        let translated = xml.find("保留期为 30 天。");
        assert!(start.expect("anchor offset") < translated.expect("translation offset"));
        assert!(xml.contains(&format!(
            "w:name=\"{ANCHOR_BOOKMARK_PREFIX}{}\"/><w:bookmarkEnd",
            segments[0].id
        )));
        // The anchored artifact still parses as a valid DOCX with intact text.
        let reopened = DocxFilter
            .extract_units(&anchored)
            .expect("reopen anchored");
        assert_eq!(reopened[0].source_text, "保留期为 30 天。");
        assert_eq!(reopened.len(), units.len());

        // A plain export stays byte-honest: no anchors leak into user exports.
        DocxFilter
            .export(&source, &plain, &segments)
            .expect("plain export");
        let plain_package = OfficePackage::open(&plain).expect("plain package");
        let plain_xml = String::from_utf8(
            plain_package
                .require("word/document.xml")
                .expect("main")
                .to_vec(),
        )
        .expect("utf-8 document part");
        assert!(!plain_xml.contains(ANCHOR_BOOKMARK_PREFIX));
    }

    #[test]
    fn anchored_export_skips_anchor_paths_missing_from_the_package() {
        let temp = tempfile::tempdir().expect("temporary directory");
        let source = temp.path().join("fixture.docx");
        let anchored = temp.path().join("anchored.docx");
        fixture::write_fixture(&source).expect("write fixture");
        let units = DocxFilter.extract_units(&source).expect("extract fixture");
        let segments = segments_for(&units);
        let anchors = BTreeMap::from([(
            "word/document.xml#p:99".to_string(),
            "ghost-segment".to_string(),
        )]);
        // A stale anchor path degrades to "no jump for that paragraph", never
        // to a failed preview export.
        DocxFilter
            .export_anchored(&source, &anchored, &segments, &anchors)
            .expect("anchored export with stale path");
        let package = OfficePackage::open(&anchored).expect("anchored package");
        let xml = String::from_utf8(package.require("word/document.xml").expect("main").to_vec())
            .expect("utf-8 document part");
        assert!(!xml.contains(ANCHOR_BOOKMARK_PREFIX));
    }

    #[test]
    fn rejects_invalid_package_before_units() {
        let temp = tempfile::tempdir().expect("temporary directory");
        let source = temp.path().join("invalid.docx");
        fixture::write_invalid_fixture(&source).expect("write fixture");
        assert!(DocxFilter.extract_units(&source).is_err());
    }

    #[test]
    fn imports_extended_parts_revisions_and_optional_comments() {
        let temp = tempfile::tempdir().expect("temporary directory");
        let source = temp.path().join("extended.docx");
        fixture::write_extended_fixture(&source).expect("write fixture");
        let units = DocxFilter.extract_units(&source).expect("extract fixture");
        assert_eq!(units.len(), 6);
        assert_eq!(units[0].source_text, "Visible body Inserted text");
        assert_eq!(units[1].source_text, "Textbox text");
        assert!(
            units
                .iter()
                .all(|unit| !unit.source_text.contains("Deleted"))
        );
        for expected in [
            "Header text",
            "Footer text",
            "Footnote text",
            "Endnote text",
        ] {
            assert!(units.iter().any(|unit| unit.source_text == expected));
        }

        let mut request = ImportRequest::new(source);
        request
            .options
            .insert("includeComments".to_string(), "true".to_string());
        let events = DocxFilter.extract_events(&request).expect("comment events");
        let with_comments =
            collect_imported_document(events.into_iter().map(Ok)).expect("collect comments");
        assert_eq!(with_comments.units.len(), 7);
        assert!(
            with_comments
                .units
                .iter()
                .any(|unit| unit.source_text == "Comment text")
        );
        assert!(
            with_comments
                .units
                .iter()
                .any(|unit| !unit.notes.is_empty())
        );
    }

    #[test]
    fn exports_header_footer_and_note_parts() {
        let temp = tempfile::tempdir().expect("temporary directory");
        let source = temp.path().join("extended.docx");
        let output = temp.path().join("translated.docx");
        fixture::write_extended_fixture(&source).expect("write fixture");
        let units = DocxFilter.extract_units(&source).expect("extract fixture");
        let mut segments = segments_for(&units);
        let footer = segments
            .iter_mut()
            .find(|segment| segment.structural_path == "word/footer1.xml#p:0")
            .expect("footer segment");
        footer.target_text = "页脚文本".to_string();
        footer.state = SegmentState::Confirmed;
        DocxFilter
            .export(&source, &output, &segments)
            .expect("export fixture");
        let exported = DocxFilter.extract_units(&output).expect("reopen fixture");
        assert!(exported.iter().any(|unit| unit.source_text == "页脚文本"));
    }

    #[test]
    fn bilingual_filter_uses_per_table_headers_and_ignores_nested_table_text() {
        let temp = tempfile::tempdir().expect("temporary directory");
        let source = temp.path().join("bilingual.docx");
        fixture::write_bilingual_fixture(&source).expect("write bilingual fixture");
        let request = ImportRequest {
            source,
            document_id: Some("bilingual-document".to_string()),
            source_locale: Some("en".to_string()),
            options: BTreeMap::new(),
        };
        let document = collect_imported_document(
            BilingualDocxFilter
                .import(request)
                .expect("import bilingual fixture"),
        )
        .expect("collect bilingual fixture");

        assert_eq!(document.units.len(), 2);
        assert_eq!(document.units[0].source_text, "Hello world");
        assert_eq!(
            document.units[0].target_text.as_deref(),
            Some("Existing target")
        );
        assert_eq!(
            document.units[0].structural_path,
            "bilingual-docx:word/document.xml#table:0/row:1"
        );
        assert_eq!(document.units[1].source_text, "Second source");
        assert!(!document.units[1].source_text.contains("Nested text"));
        assert_eq!(
            document.units[1].structural_path,
            "bilingual-docx:word/document.xml#table:1/row:1"
        );
        let metadata: BTreeMap<String, String> =
            serde_json::from_str(&document.units[0].notes[0].text).expect("decode row metadata");
        assert_eq!(metadata.get("Context").map(String::as_str), Some("Legal"));
    }

    #[test]
    fn bilingual_anchored_export_bookmarks_target_cells_and_stays_out_of_plain_exports() {
        let temp = tempfile::tempdir().expect("temporary directory");
        let source = temp.path().join("bilingual.docx");
        let plain = temp.path().join("plain.docx");
        let anchored = temp.path().join("anchored.docx");
        fixture::write_bilingual_fixture(&source).expect("write bilingual fixture");
        let rows = extract_bilingual_table_rows(&source).expect("extract bilingual rows");
        let data_rows = rows
            .iter()
            .filter(|row| row.row_number == 1)
            .collect::<Vec<_>>();
        assert_eq!(data_rows.len(), 2);
        let units = data_rows
            .iter()
            .enumerate()
            .map(|(ordinal, row)| {
                ImportedUnit::plain(
                    u32::try_from(ordinal).expect("ordinal"),
                    row.structural_path.clone(),
                    row.cells[0].clone(),
                )
            })
            .collect::<Vec<_>>();
        let mut segments = segments_for(&units);
        segments[0].target_text = "你好世界更新".to_string();
        segments[0].state = SegmentState::Confirmed;
        let anchors: BTreeMap<String, String> = segments
            .iter()
            .map(|segment| (segment.structural_path.clone(), segment.id.clone()))
            .collect();

        assert_eq!(
            export_bilingual_table_anchored(&source, &anchored, &segments, &anchors)
                .expect("anchored bilingual export"),
            1
        );
        let package = OfficePackage::open(&anchored).expect("anchored package");
        let xml = String::from_utf8(package.require("word/document.xml").expect("main").to_vec())
            .expect("utf-8 document part");
        // Every anchored row gets a bookmark pair named after its grid
        // segment — the untranslated row included, because the layout preview
        // renders and must jump from that row too.
        for segment in &segments {
            assert!(
                xml.contains(&format!(
                    "w:name=\"{ANCHOR_BOOKMARK_PREFIX}{}\"",
                    segment.id
                )),
                "missing anchor for {}",
                segment.structural_path
            );
        }
        // The anchor sits inside the target-cell paragraph: after the row's
        // source text (split across two runs in the fixture), immediately
        // before the run holding the translation.
        let source_at = xml.find("world").expect("source cell offset");
        let anchor_at = xml
            .find(&format!("{ANCHOR_BOOKMARK_PREFIX}{}", segments[0].id))
            .expect("anchor offset");
        let target_at = xml.find("你好世界更新").expect("translation offset");
        assert!(source_at < anchor_at && anchor_at < target_at);
        assert!(xml.contains(&format!(
            "w:name=\"{ANCHOR_BOOKMARK_PREFIX}{}\"/><w:bookmarkEnd",
            segments[0].id
        )));
        // The anchored artifact still parses as a bilingual table with the
        // translation applied and the untouched row's target preserved.
        let reparsed = extract_bilingual_table_rows(&anchored).expect("reparse anchored output");
        let translated = reparsed
            .iter()
            .find(|row| row.structural_path == segments[0].structural_path)
            .expect("translated row");
        assert_eq!(translated.cells[0], "Hello world");
        assert_eq!(translated.cells[1], "你好世界更新");
        let untouched = reparsed
            .iter()
            .find(|row| row.structural_path == segments[1].structural_path)
            .expect("untranslated row");
        assert_eq!(untouched.cells[1], "第二译文");

        // A plain export stays byte-honest: no anchors leak into user exports.
        export_bilingual_table(&source, &plain, &segments).expect("plain bilingual export");
        let plain_package = OfficePackage::open(&plain).expect("plain package");
        let plain_xml = String::from_utf8(
            plain_package
                .require("word/document.xml")
                .expect("main")
                .to_vec(),
        )
        .expect("utf-8 document part");
        assert!(!plain_xml.contains(ANCHOR_BOOKMARK_PREFIX));
    }

    #[test]
    fn bilingual_anchored_export_embeds_anchor_in_a_generated_target_paragraph() {
        let temp = tempfile::tempdir().expect("temporary directory");
        let source = temp.path().join("empty-target.docx");
        let anchored = temp.path().join("anchored.docx");
        fixture::write_bilingual_empty_target_fixture(&source).expect("write empty-target fixture");
        let rows = extract_bilingual_table_rows(&source).expect("extract bilingual rows");
        let data = rows
            .iter()
            .find(|row| row.table_index == 0 && row.row_number == 1)
            .expect("first data row");
        // The empty target cell offers no run to anchor before.
        assert!(data.target_anchor_insert_at.is_none());
        let units = vec![ImportedUnit::plain(
            0,
            data.structural_path.clone(),
            data.cells[0].clone(),
        )];
        let mut segments = segments_for(&units);
        segments[0].target_text = "新译文".to_string();
        let anchors = BTreeMap::from([(data.structural_path.clone(), segments[0].id.clone())]);

        assert_eq!(
            export_bilingual_table_anchored(&source, &anchored, &segments, &anchors)
                .expect("anchored bilingual export"),
            1
        );
        let package = OfficePackage::open(&anchored).expect("anchored package");
        let xml = String::from_utf8(package.require("word/document.xml").expect("main").to_vec())
            .expect("utf-8 document part");
        // The generated target paragraph carries the bookmark itself, before
        // the run holding the translation.
        assert!(xml.contains(&format!(
            "w:name=\"{ANCHOR_BOOKMARK_PREFIX}{}\"/><w:bookmarkEnd",
            segments[0].id
        )));
        let anchor_at = xml
            .find(&format!("{ANCHOR_BOOKMARK_PREFIX}{}", segments[0].id))
            .expect("anchor offset");
        let target_at = xml.find("新译文").expect("translation offset");
        assert!(anchor_at < target_at);
        let reparsed = extract_bilingual_table_rows(&anchored).expect("reparse anchored output");
        let translated = reparsed
            .iter()
            .find(|row| row.structural_path == data.structural_path)
            .expect("translated row");
        assert_eq!(translated.cells[1], "新译文");
    }

    #[test]
    fn bilingual_export_inserts_an_empty_target_without_clobbering() {
        let temp = tempfile::tempdir().expect("temporary directory");
        let source = temp.path().join("empty-target.docx");
        let output = temp.path().join("translated.docx");
        fixture::write_bilingual_empty_target_fixture(&source).expect("write empty-target fixture");
        let rows = extract_bilingual_table_rows(&source).expect("extract bilingual rows");
        let data = rows
            .iter()
            .find(|row| row.table_index == 0 && row.row_number == 1)
            .expect("first data row");
        assert!(data.target_ranges.is_empty());
        assert!(data.target_insert_at.is_some());
        let units = vec![ImportedUnit::plain(
            0,
            data.structural_path.clone(),
            data.cells[0].clone(),
        )];
        let mut segments = segments_for(&units);
        segments[0].target_text = "新译文 & more".to_string();

        assert_eq!(
            export_bilingual_table(&source, &output, &segments).expect("export bilingual table"),
            1
        );
        let exported = extract_bilingual_table_rows(&output).expect("reparse bilingual output");
        let translated = exported
            .iter()
            .find(|row| row.structural_path == data.structural_path)
            .expect("translated row");
        assert_eq!(translated.cells[1], "新译文 & more");
        let source_package = OfficePackage::open(&source).expect("source package");
        let output_package = OfficePackage::open(&output).expect("output package");
        assert_eq!(
            source_package.get(fixture::UNRELATED_PART),
            output_package.get(fixture::UNRELATED_PART)
        );
        assert!(export_bilingual_table(&source, &output, &segments).is_err());
    }
}

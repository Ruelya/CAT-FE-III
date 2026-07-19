//! Conservative XLSX import/export with cell-level ownership.

pub mod fixture;

use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::Path;

use quick_xml::Reader;
use quick_xml::events::{BytesStart, Event};
use thiserror::Error;
use translunar_domain::{
    DegradationFinding, DegradationSeverity, InlineTag, Segment, TagKind, TagSide,
};
use translunar_filter_core::{
    DocumentFilter, DocumentMetadata, ExportReport, ExportRequest, FilterCapabilities,
    FilterDescriptor, FilterError, FilterEvent, FilterEventStream, ImportRequest, ProbeResult,
    ValidationReport, collect_imported_document, publish_bytes_noclobber,
};
use translunar_filter_office_core::{
    OfficeError, OfficePackage, XmlTextRange, apply_replacements, decode_reference, decode_text,
    parse_relationships, rebuild_package, relationship_part, replace_text_ranges,
    resolve_relationship_target, validate_xml,
};

const ROOT_REL_TYPE: &str = "/officeDocument";
const WORKSHEET_REL_TYPE: &str = "/worksheet";
const SHARED_STRINGS_REL_TYPE: &str = "/sharedStrings";

#[derive(Debug, Error)]
pub enum XlsxError {
    #[error("XLSX I/O failed: {0}")]
    Io(#[from] std::io::Error),
    #[error("invalid XLSX ZIP package: {0}")]
    Zip(#[from] zip::result::ZipError),
    #[error(transparent)]
    Office(#[from] OfficeError),
    #[error("invalid XLSX package: {0}")]
    Invalid(String),
    #[error("invalid filter event stream: {0}")]
    Pipeline(#[from] FilterError),
}

#[derive(Debug, Clone)]
pub struct XlsxFilter;

impl Default for XlsxFilter {
    fn default() -> Self {
        Self
    }
}

#[derive(Debug, Clone)]
struct SheetInfo {
    name: String,
    index: usize,
    part: String,
    hidden: bool,
}

#[derive(Debug, Clone)]
struct SharedString {
    start: usize,
    end: usize,
    text: String,
    ranges: Vec<XmlTextRange>,
}

#[derive(Debug, Clone)]
enum CellKind {
    Shared { index: usize },
    Inline,
}

#[derive(Debug, Clone)]
struct CellInfo {
    reference: String,
    row: u32,
    column: u32,
    kind: CellKind,
    text: String,
    ranges: Vec<XmlTextRange>,
    value_range: Option<(usize, usize)>,
}

#[derive(Debug, Clone, Default)]
struct Selection {
    sheet_names: Option<HashSet<String>>,
    sheet_indexes: Option<HashSet<usize>>,
    row_range: Option<(u32, u32)>,
    column_range: Option<(u32, u32)>,
    include_hidden: bool,
}

impl Selection {
    fn parse(options: &BTreeMap<String, String>) -> Result<Self, XlsxError> {
        Ok(Self {
            sheet_names: parse_string_set(options.get("sheetNames"), "sheetNames")?,
            sheet_indexes: parse_usize_set(options.get("sheetIndexes"), "sheetIndexes")?,
            row_range: parse_numeric_range(options.get("rowRange"), "rowRange", 1, 1_048_576)?,
            column_range: options
                .get("columnRange")
                .map(|value| parse_column_range(value))
                .transpose()?,
            include_hidden: parse_bool(options.get("includeHiddenSheets"), "includeHiddenSheets")?
                .unwrap_or(false),
        })
    }

    fn includes_sheet(&self, sheet: &SheetInfo) -> bool {
        if sheet.hidden && !self.include_hidden {
            return false;
        }
        let has_selector = self.sheet_names.is_some() || self.sheet_indexes.is_some();
        if !has_selector {
            return true;
        }
        self.sheet_names
            .as_ref()
            .is_some_and(|names| names.contains(&sheet.name))
            || self
                .sheet_indexes
                .as_ref()
                .is_some_and(|indexes| indexes.contains(&sheet.index))
    }

    fn includes_cell(&self, cell: &CellInfo) -> bool {
        self.row_range
            .is_none_or(|(start, end)| (start..=end).contains(&cell.row))
            && self
                .column_range
                .is_none_or(|(start, end)| (start..=end).contains(&cell.column))
    }
}

impl XlsxFilter {
    pub fn extract_units(
        &self,
        request: &ImportRequest,
    ) -> Result<Vec<translunar_filter_core::ImportedUnit>, XlsxError> {
        let events = self.extract_events(request)?;
        Ok(collect_imported_document(events.into_iter().map(Ok))?.units)
    }

    pub fn validate(&self, source: &Path) -> Result<(), XlsxError> {
        let package = OfficePackage::open(source)?;
        let workbook = discover_workbook(&package)?;
        validate_xml(package.require(&workbook.part)?, &workbook.part)?;
        for sheet in &workbook.sheets {
            validate_xml(package.require(&sheet.part)?, &sheet.part)?;
        }
        if let Some(shared) = workbook.shared_strings.as_deref() {
            validate_xml(package.require(shared)?, shared)?;
        }
        Ok(())
    }

    pub fn export(
        &self,
        source: &Path,
        output: &Path,
        segments: &[Segment],
    ) -> Result<u32, XlsxError> {
        if source == output {
            return Err(XlsxError::Invalid(
                "export path must not replace the managed source".to_string(),
            ));
        }
        self.validate(source)?;
        let package = OfficePackage::open(source)?;
        let workbook = discover_workbook(&package)?;
        let shared_strings = if let Some(part) = workbook.shared_strings.as_deref() {
            Some(parse_shared_strings(package.require(part)?, part)?)
        } else {
            None
        };
        let targets = target_map(segments)?;
        let mut replacements: BTreeMap<String, Vec<u8>> = BTreeMap::new();
        let mut shared_append = Vec::new();
        let mut applied = HashSet::new();
        let mut translated = 0_u32;
        for sheet in &workbook.sheets {
            let Some(sheet_bytes) = package.get(&sheet.part) else {
                continue;
            };
            let cells = parse_sheet_cells(sheet_bytes, &sheet.part)?;
            let mut sheet_replacements = Vec::new();
            for cell in cells {
                let path = cell_path(&sheet.part, &cell.reference);
                let Some(target) = targets.get(&path) else {
                    continue;
                };
                if target.trim().is_empty() {
                    continue;
                }
                match cell.kind {
                    CellKind::Inline => {
                        for (index, range) in cell.ranges.iter().enumerate() {
                            sheet_replacements.push(
                                translunar_filter_office_core::ByteReplacement {
                                    start: range.start,
                                    end: range.end,
                                    bytes: if index == 0 {
                                        translunar_filter_office_core::escape_xml_text(target)
                                    } else {
                                        Vec::new()
                                    },
                                },
                            );
                        }
                    }
                    CellKind::Shared { index } => {
                        let shared = shared_strings.as_ref().ok_or_else(|| {
                            XlsxError::Invalid(format!(
                                "cell {path} references missing sharedStrings.xml"
                            ))
                        })?;
                        let original = shared.get(index).ok_or_else(|| {
                            XlsxError::Invalid(format!(
                                "cell {path} references missing shared string {index}"
                            ))
                        })?;
                        let shared_part = workbook.shared_strings.as_deref().ok_or_else(|| {
                            XlsxError::Invalid("shared string part disappeared".to_string())
                        })?;
                        let clone =
                            clone_shared_string(package.require(shared_part)?, original, target)?;
                        let new_index = shared.len().saturating_add(shared_append.len());
                        shared_append.push(clone);
                        let (start, end) = cell.value_range.ok_or_else(|| {
                            XlsxError::Invalid(format!(
                                "shared string cell {path} has no value range"
                            ))
                        })?;
                        sheet_replacements.push(translunar_filter_office_core::ByteReplacement {
                            start,
                            end,
                            bytes: new_index.to_string().into_bytes(),
                        });
                    }
                }
                applied.insert(path);
                translated = translated.checked_add(1).ok_or_else(|| {
                    XlsxError::Invalid("translated cell count overflow".to_string())
                })?;
            }
            if !sheet_replacements.is_empty() {
                replacements.insert(
                    sheet.part.clone(),
                    apply_replacements(sheet_bytes, &sheet_replacements)?,
                );
            }
        }
        if applied.len() != targets.len() {
            let missing = targets
                .keys()
                .find(|path| !applied.contains(*path))
                .cloned()
                .unwrap_or_else(|| "unknown".to_string());
            return Err(XlsxError::Invalid(format!(
                "XLSX structural path does not exist in source package: {missing}"
            )));
        }
        if !shared_append.is_empty() {
            let part = workbook.shared_strings.as_deref().ok_or_else(|| {
                XlsxError::Invalid("shared string clones require sharedStrings.xml".to_string())
            })?;
            let bytes = package.require(part)?;
            let end = shared_strings_end(bytes)?;
            let mut appended = Vec::new();
            for clone in &shared_append {
                appended.extend_from_slice(clone);
            }
            let unique_count = shared_strings
                .as_ref()
                .map(Vec::len)
                .unwrap_or_default()
                .saturating_add(shared_append.len());
            let mut shared_replacements = vec![translunar_filter_office_core::ByteReplacement {
                start: end,
                end,
                bytes: appended,
            }];
            shared_replacements.push(shared_unique_count_replacement(bytes, unique_count)?);
            replacements.insert(
                part.to_string(),
                apply_replacements(bytes, &shared_replacements)?,
            );
        }
        let rebuilt = rebuild_package(source, &replacements)?;
        validate_bytes(&rebuilt)?;
        publish_bytes_noclobber(output, &rebuilt).map_err(XlsxError::Pipeline)?;
        Ok(translated)
    }

    fn extract_events(&self, request: &ImportRequest) -> Result<Vec<FilterEvent>, XlsxError> {
        let selection = Selection::parse(&request.options)?;
        let package = OfficePackage::open(&request.source)?;
        let degradation = xlsx_degradations(&package);
        let workbook = discover_workbook(&package)?;
        let shared = if let Some(part) = workbook.shared_strings.as_deref() {
            Some(parse_shared_strings(package.require(part)?, part)?)
        } else {
            None
        };
        let document_id = request.document_id.as_deref().unwrap_or("xlsx");
        let mut events = vec![FilterEvent::StartDocument {
            metadata: DocumentMetadata {
                format: "xlsx".to_string(),
                source_locale: request.source_locale.clone(),
                properties: BTreeMap::from([
                    ("sheetCount".to_string(), workbook.sheets.len().to_string()),
                    ("filter".to_string(), "builtin.xlsx".to_string()),
                ]),
            },
        }];
        events.extend(degradation.iter().cloned().map(FilterEvent::Degradation));
        let mut ordinal = 0_u32;
        for sheet in &workbook.sheets {
            if !selection.includes_sheet(sheet) {
                continue;
            }
            let bytes = package.require(&sheet.part)?;
            for cell in parse_sheet_cells(bytes, &sheet.part)? {
                if !selection.includes_cell(&cell) {
                    continue;
                }
                let path = cell_path(&sheet.part, &cell.reference);
                let (source_text, ranges) = match &cell.kind {
                    CellKind::Inline => (cell.text.clone(), cell.ranges.clone()),
                    CellKind::Shared { index } => {
                        let item = shared
                            .as_ref()
                            .and_then(|items| items.get(*index))
                            .ok_or_else(|| {
                                XlsxError::Invalid(format!("missing shared string for {path}"))
                            })?;
                        (item.text.clone(), item.ranges.clone())
                    }
                };
                if source_text.trim().is_empty() {
                    continue;
                }
                events.push(FilterEvent::StartUnit {
                    ordinal,
                    structural_path: path.clone(),
                });
                events.push(FilterEvent::Text(source_text.clone()));
                append_rich_tags(&mut events, document_id, ordinal, &ranges, &source_text)?;
                events.push(FilterEvent::EndUnit);
                ordinal = ordinal
                    .checked_add(1)
                    .ok_or_else(|| XlsxError::Invalid("XLSX unit count overflow".to_string()))?;
            }
        }
        if ordinal == 0 {
            return Err(XlsxError::Invalid(
                "workbook contains no selected text cells".to_string(),
            ));
        }
        events.push(FilterEvent::EndDocument);
        Ok(events)
    }
}

impl DocumentFilter for XlsxFilter {
    fn descriptor(&self) -> FilterDescriptor {
        FilterDescriptor {
            id: "builtin.xlsx".to_string(),
            version: env!("CARGO_PKG_VERSION").to_string(),
            display_name: "Microsoft Excel XLSX".to_string(),
            extensions: vec!["xlsx".to_string()],
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
        let extension_matches = source
            .extension()
            .and_then(|extension| extension.to_str())
            .is_some_and(|extension| extension.eq_ignore_ascii_case("xlsx"));
        if !extension_matches {
            return Ok(ProbeResult::no_match("file extension is not .xlsx"));
        }
        match self.validate(source) {
            Ok(()) => Ok(ProbeResult::matches(100, "valid XLSX OOXML package")),
            Err(XlsxError::Io(error)) => Err(FilterError::Io(error)),
            Err(XlsxError::Office(OfficeError::Io(error))) => Err(FilterError::Io(error)),
            Err(error) => Ok(ProbeResult::no_match(error.to_string())),
        }
    }

    fn import(&self, request: ImportRequest) -> Result<FilterEventStream, FilterError> {
        Ok(Box::new(
            self.extract_events(&request)
                .map_err(map_error)?
                .into_iter()
                .map(Ok),
        ))
    }

    fn export(&self, request: ExportRequest<'_>) -> Result<ExportReport, FilterError> {
        let package = OfficePackage::open(request.source)
            .map_err(XlsxError::from)
            .map_err(map_error)?;
        let degradation = xlsx_degradations(&package);
        let translated_segments = self
            .export(request.source, request.output, request.segments)
            .map_err(map_error)?;
        Ok(ExportReport {
            output_path: request.output.display().to_string(),
            translated_segments,
            degradation,
        })
    }

    fn validate(&self, source: &Path) -> Result<ValidationReport, FilterError> {
        XlsxFilter::validate(self, source).map_err(map_error)?;
        Ok(ValidationReport {
            valid: true,
            findings: Vec::new(),
        })
    }
}

fn map_error(error: XlsxError) -> FilterError {
    match error {
        XlsxError::Io(error) => FilterError::Io(error),
        XlsxError::Zip(error) => FilterError::Invalid(error.to_string()),
        XlsxError::Office(OfficeError::Io(error)) => FilterError::Io(error),
        XlsxError::Office(error) => FilterError::Invalid(error.to_string()),
        XlsxError::Invalid(message) => FilterError::Invalid(message),
        XlsxError::Pipeline(error) => error,
    }
}

#[derive(Debug, Clone)]
struct WorkbookInfo {
    part: String,
    sheets: Vec<SheetInfo>,
    shared_strings: Option<String>,
}

fn discover_workbook(package: &OfficePackage) -> Result<WorkbookInfo, XlsxError> {
    let root_relationships = parse_relationships(package.require("_rels/.rels")?, "_rels/.rels")?;
    let workbook_relationship = root_relationships
        .iter()
        .find(|relationship| relationship.relationship_type.ends_with(ROOT_REL_TYPE))
        .ok_or_else(|| XlsxError::Invalid("package has no workbook relationship".to_string()))?;
    let workbook_part = resolve_relationship_target("", workbook_relationship)?
        .ok_or_else(|| XlsxError::Invalid("workbook relationship is external".to_string()))?;
    let workbook_bytes = package.require(&workbook_part)?;
    let workbook_rels_part = relationship_part(&workbook_part)?;
    let workbook_rels =
        parse_relationships(package.require(&workbook_rels_part)?, &workbook_rels_part)?;
    let mut by_id = HashMap::new();
    for relationship in workbook_rels {
        by_id.insert(relationship.id.clone(), relationship);
    }
    let mut sheets = Vec::new();
    let mut shared_strings = None;
    let mut reader = Reader::from_reader(workbook_bytes);
    reader.config_mut().trim_text(false);
    let mut buffer = Vec::new();
    loop {
        match reader.read_event_into(&mut buffer) {
            Ok(Event::Start(element)) | Ok(Event::Empty(element))
                if element.name().local_name().as_ref() == b"sheet" =>
            {
                let name = attribute_value(&element, b"name", reader.decoder())?
                    .ok_or_else(|| XlsxError::Invalid("worksheet has no name".to_string()))?;
                let rel_id =
                    attribute_value(&element, b"id", reader.decoder())?.ok_or_else(|| {
                        XlsxError::Invalid(format!("worksheet {name} has no relationship"))
                    })?;
                let hidden = attribute_value(&element, b"state", reader.decoder())?
                    .is_some_and(|value| value != "visible");
                let relationship = by_id.get(&rel_id).ok_or_else(|| {
                    XlsxError::Invalid(format!("worksheet {name} references unknown {rel_id}"))
                })?;
                if !relationship.relationship_type.ends_with(WORKSHEET_REL_TYPE) {
                    return Err(XlsxError::Invalid(format!(
                        "relationship {rel_id} is not a worksheet"
                    )));
                }
                let part = resolve_relationship_target(&workbook_part, relationship)?
                    .ok_or_else(|| XlsxError::Invalid(format!("worksheet {name} is external")))?;
                if !package.contains(&part) {
                    return Err(XlsxError::Invalid(format!("missing worksheet part {part}")));
                }
                sheets.push(SheetInfo {
                    name,
                    index: sheets.len() + 1,
                    part,
                    hidden,
                });
            }
            Ok(Event::Eof) => break,
            Ok(_) => {}
            Err(error) => {
                return Err(XlsxError::Invalid(format!(
                    "cannot parse workbook.xml: {error}"
                )));
            }
        }
        buffer.clear();
    }
    for relationship in by_id.values() {
        if relationship
            .relationship_type
            .ends_with(SHARED_STRINGS_REL_TYPE)
        {
            shared_strings = resolve_relationship_target(&workbook_part, relationship)?;
        }
    }
    if sheets.is_empty() {
        return Err(XlsxError::Invalid(
            "workbook contains no worksheets".to_string(),
        ));
    }
    Ok(WorkbookInfo {
        part: workbook_part,
        sheets,
        shared_strings,
    })
}

fn parse_shared_strings(bytes: &[u8], part: &str) -> Result<Vec<SharedString>, XlsxError> {
    validate_xml(bytes, part)?;
    let mut reader = Reader::from_reader(bytes);
    reader.config_mut().trim_text(false);
    let mut buffer = Vec::new();
    let mut current: Option<(usize, String, Vec<XmlTextRange>)> = None;
    let mut current_text: Option<(usize, String)> = None;
    let mut strings = Vec::new();
    loop {
        let before = usize::try_from(reader.buffer_position())
            .map_err(|_| XlsxError::Invalid("shared string offset overflow".to_string()))?;
        match reader.read_event_into(&mut buffer) {
            Ok(Event::Start(element)) if element.name().local_name().as_ref() == b"si" => {
                if current.is_some() {
                    return Err(XlsxError::Invalid("nested shared string item".to_string()));
                }
                current = Some((before, String::new(), Vec::new()));
            }
            Ok(Event::Start(element)) if element.name().local_name().as_ref() == b"t" => {
                if current.is_some() {
                    current_text = Some((
                        usize::try_from(reader.buffer_position()).map_err(|_| {
                            XlsxError::Invalid("shared text offset overflow".to_string())
                        })?,
                        String::new(),
                    ));
                }
            }
            Ok(Event::Text(text)) => {
                if let Some((_, value)) = current_text.as_mut() {
                    let decoded = decode_text(&text)?;
                    value.push_str(&decoded);
                    if let Some((_, total, _)) = current.as_mut() {
                        total.push_str(&decoded);
                    }
                }
            }
            Ok(Event::GeneralRef(reference)) => {
                if let Some((_, value)) = current_text.as_mut() {
                    let decoded = decode_reference(&reference)?;
                    value.push_str(&decoded);
                    if let Some((_, total, _)) = current.as_mut() {
                        total.push_str(&decoded);
                    }
                }
            }
            Ok(Event::End(element)) if element.name().local_name().as_ref() == b"t" => {
                if let Some((start, text)) = current_text.take() {
                    let end = before;
                    if let Some((_, _, ranges)) = current.as_mut() {
                        ranges.push(XmlTextRange { start, end, text });
                    }
                }
            }
            Ok(Event::End(element)) if element.name().local_name().as_ref() == b"si" => {
                let (start, text, ranges) = current.take().ok_or_else(|| {
                    XlsxError::Invalid("shared string end without start".to_string())
                })?;
                strings.push(SharedString {
                    start,
                    end: usize::try_from(reader.buffer_position()).map_err(|_| {
                        XlsxError::Invalid("shared string offset overflow".to_string())
                    })?,
                    text,
                    ranges,
                });
            }
            Ok(Event::Eof) => break,
            Ok(_) => {}
            Err(error) => return Err(XlsxError::Invalid(format!("cannot parse {part}: {error}"))),
        }
        buffer.clear();
    }
    Ok(strings)
}

fn parse_sheet_cells(bytes: &[u8], part: &str) -> Result<Vec<CellInfo>, XlsxError> {
    validate_xml(bytes, part)?;
    let mut reader = Reader::from_reader(bytes);
    reader.config_mut().trim_text(false);
    let mut buffer = Vec::new();
    let mut current: Option<CellBuilder> = None;
    let mut current_text: Option<TextBuilder> = None;
    let mut cells = Vec::new();
    loop {
        let before = usize::try_from(reader.buffer_position())
            .map_err(|_| XlsxError::Invalid("worksheet offset overflow".to_string()))?;
        match reader.read_event_into(&mut buffer) {
            Ok(Event::Start(element)) if element.name().local_name().as_ref() == b"c" => {
                if current.is_some() {
                    return Err(XlsxError::Invalid(format!("nested cell in {part}")));
                }
                let reference =
                    attribute_value(&element, b"r", reader.decoder())?.ok_or_else(|| {
                        XlsxError::Invalid(format!("cell without reference in {part}"))
                    })?;
                let (row, column) = parse_cell_reference(&reference)?;
                let cell_type = attribute_value(&element, b"t", reader.decoder())?;
                current = Some(CellBuilder {
                    reference,
                    row,
                    column,
                    cell_type,
                    text: String::new(),
                    ranges: Vec::new(),
                    value_range: None,
                    formula: false,
                    in_value: false,
                    in_inline: false,
                });
            }
            Ok(Event::Empty(element)) if element.name().local_name().as_ref() == b"c" => {}
            Ok(Event::Start(element)) if element.name().local_name().as_ref() == b"v" => {
                if let Some(cell) = current.as_mut() {
                    cell.in_value = true;
                    cell.value_range = Some((
                        usize::try_from(reader.buffer_position()).map_err(|_| {
                            XlsxError::Invalid("cell value offset overflow".to_string())
                        })?,
                        0,
                    ));
                }
            }
            Ok(Event::Start(element)) if element.name().local_name().as_ref() == b"is" => {
                if let Some(cell) = current.as_mut() {
                    cell.in_inline = true;
                }
            }
            Ok(Event::Start(element)) if element.name().local_name().as_ref() == b"t" => {
                if current.as_ref().is_some_and(|cell| cell.in_inline) {
                    current_text = Some((
                        usize::try_from(reader.buffer_position()).map_err(|_| {
                            XlsxError::Invalid("inline text offset overflow".to_string())
                        })?,
                        String::new(),
                    ));
                }
            }
            Ok(Event::Start(element)) if element.name().local_name().as_ref() == b"f" => {
                if let Some(cell) = current.as_mut() {
                    cell.formula = true;
                }
            }
            Ok(Event::Empty(element)) if element.name().local_name().as_ref() == b"f" => {
                if let Some(cell) = current.as_mut() {
                    cell.formula = true;
                }
            }
            Ok(Event::Text(text)) => {
                if let Some((_, value)) = current_text.as_mut() {
                    value.push_str(&decode_text(&text)?);
                } else if let Some(cell) = current.as_mut() {
                    let decoded = decode_text(&text)?;
                    if cell.in_value {
                        cell.text.push_str(&decoded);
                    }
                }
            }
            Ok(Event::GeneralRef(reference)) => {
                if let Some((_, value)) = current_text.as_mut() {
                    value.push_str(&decode_reference(&reference)?);
                } else if let Some(cell) = current.as_mut()
                    && cell.in_value
                {
                    cell.text.push_str(&decode_reference(&reference)?);
                }
            }
            Ok(Event::End(element)) if element.name().local_name().as_ref() == b"t" => {
                if let Some((start, text)) = current_text.take() {
                    let end = before;
                    if let Some(cell) = current.as_mut() {
                        cell.text.push_str(&text);
                        cell.ranges.push(XmlTextRange { start, end, text });
                    }
                }
            }
            Ok(Event::End(element)) if element.name().local_name().as_ref() == b"v" => {
                if let Some(cell) = current.as_mut() {
                    cell.in_value = false;
                    if let Some((start, _)) = cell.value_range {
                        cell.value_range = Some((start, before));
                    }
                }
            }
            Ok(Event::End(element)) if element.name().local_name().as_ref() == b"is" => {
                if let Some(cell) = current.as_mut() {
                    cell.in_inline = false;
                }
            }
            Ok(Event::End(element)) if element.name().local_name().as_ref() == b"c" => {
                let builder = current.take().ok_or_else(|| {
                    XlsxError::Invalid(format!("cell end without start in {part}"))
                })?;
                if builder.formula || builder.text.trim().is_empty() {
                    continue;
                }
                let kind = if builder.cell_type.as_deref() == Some("s") {
                    let index = builder.text.parse::<usize>().map_err(|_| {
                        XlsxError::Invalid(format!("invalid shared string index in {part}"))
                    })?;
                    CellKind::Shared { index }
                } else if builder.cell_type.as_deref() == Some("inlineStr") {
                    CellKind::Inline
                } else {
                    continue;
                };
                cells.push(CellInfo {
                    reference: builder.reference,
                    row: builder.row,
                    column: builder.column,
                    kind,
                    text: builder.text,
                    ranges: builder.ranges,
                    value_range: builder.value_range,
                });
            }
            Ok(Event::Eof) => break,
            Ok(_) => {}
            Err(error) => return Err(XlsxError::Invalid(format!("cannot parse {part}: {error}"))),
        }
        buffer.clear();
    }
    Ok(cells)
}

#[derive(Debug)]
struct CellBuilder {
    reference: String,
    row: u32,
    column: u32,
    cell_type: Option<String>,
    text: String,
    ranges: Vec<XmlTextRange>,
    value_range: Option<(usize, usize)>,
    formula: bool,
    in_value: bool,
    in_inline: bool,
}

type TextBuilder = (usize, String);

fn append_rich_tags(
    events: &mut Vec<FilterEvent>,
    document_id: &str,
    ordinal: u32,
    ranges: &[XmlTextRange],
    source_text: &str,
) -> Result<(), XlsxError> {
    let mut position = 0_u32;
    for (index, range) in ranges.iter().enumerate() {
        let length = u32::try_from(range.text.chars().count())
            .map_err(|_| XlsxError::Invalid("rich text length overflow".to_string()))?;
        if length == 0 {
            continue;
        }
        let pair_id = format!("{document_id}:xlsx:{ordinal}:{index}");
        events.push(FilterEvent::InlineTag(InlineTag {
            id: format!("{pair_id}:start"),
            side: TagSide::Source,
            position,
            kind: TagKind::Start,
            pair_id: Some(pair_id.clone()),
            payload: "ooxml-rich-run".to_string(),
            display_text: "R".to_string(),
            protected: true,
        }));
        position = position
            .checked_add(length)
            .ok_or_else(|| XlsxError::Invalid("rich text position overflow".to_string()))?;
        events.push(FilterEvent::InlineTag(InlineTag {
            id: format!("{pair_id}:end"),
            side: TagSide::Source,
            position,
            kind: TagKind::End,
            pair_id: Some(pair_id),
            payload: "ooxml-rich-run".to_string(),
            display_text: "R".to_string(),
            protected: true,
        }));
    }
    let actual = source_text.chars().count();
    if usize::try_from(position).unwrap_or(usize::MAX) > actual {
        return Err(XlsxError::Invalid(
            "rich text ranges exceed source text".to_string(),
        ));
    }
    Ok(())
}

fn shared_strings_end(bytes: &[u8]) -> Result<usize, XlsxError> {
    let mut reader = Reader::from_reader(bytes);
    reader.config_mut().trim_text(false);
    let mut buffer = Vec::new();
    loop {
        let before = usize::try_from(reader.buffer_position())
            .map_err(|_| XlsxError::Invalid("shared strings offset overflow".to_string()))?;
        match reader.read_event_into(&mut buffer) {
            Ok(Event::End(element)) if element.name().local_name().as_ref() == b"sst" => {
                return Ok(before);
            }
            Ok(Event::Eof) => break,
            Ok(_) => {}
            Err(error) => {
                return Err(XlsxError::Invalid(format!(
                    "cannot parse sharedStrings.xml: {error}"
                )));
            }
        }
        buffer.clear();
    }
    Err(XlsxError::Invalid(
        "sharedStrings.xml has no closing sst".to_string(),
    ))
}

fn shared_unique_count_replacement(
    bytes: &[u8],
    unique_count: usize,
) -> Result<translunar_filter_office_core::ByteReplacement, XlsxError> {
    let mut reader = Reader::from_reader(bytes);
    reader.config_mut().trim_text(false);
    let mut buffer = Vec::new();
    loop {
        let before = usize::try_from(reader.buffer_position())
            .map_err(|_| XlsxError::Invalid("shared strings offset overflow".to_string()))?;
        match reader.read_event_into(&mut buffer) {
            Ok(Event::Start(element)) if element.name().local_name().as_ref() == b"sst" => {
                let after = usize::try_from(reader.buffer_position()).map_err(|_| {
                    XlsxError::Invalid("shared strings offset overflow".to_string())
                })?;
                let tag = &bytes[before..after];
                if let Some(name_start) = find_bytes(tag, b"uniqueCount") {
                    let mut cursor = name_start + b"uniqueCount".len();
                    while tag.get(cursor).is_some_and(u8::is_ascii_whitespace) {
                        cursor += 1;
                    }
                    if tag.get(cursor) != Some(&b'=') {
                        return Err(XlsxError::Invalid(
                            "invalid sharedStrings uniqueCount attribute".to_string(),
                        ));
                    }
                    cursor += 1;
                    while tag.get(cursor).is_some_and(u8::is_ascii_whitespace) {
                        cursor += 1;
                    }
                    let quote = *tag.get(cursor).ok_or_else(|| {
                        XlsxError::Invalid("invalid sharedStrings uniqueCount quote".to_string())
                    })?;
                    if quote != b'\'' && quote != b'"' {
                        return Err(XlsxError::Invalid(
                            "invalid sharedStrings uniqueCount quote".to_string(),
                        ));
                    }
                    let value_start = cursor + 1;
                    let value_end = tag[value_start..]
                        .iter()
                        .position(|byte| *byte == quote)
                        .map(|offset| value_start + offset)
                        .ok_or_else(|| {
                            XlsxError::Invalid("unterminated sharedStrings uniqueCount".to_string())
                        })?;
                    return Ok(translunar_filter_office_core::ByteReplacement {
                        start: before + value_start,
                        end: before + value_end,
                        bytes: unique_count.to_string().into_bytes(),
                    });
                }
                let insertion = after.checked_sub(1).ok_or_else(|| {
                    XlsxError::Invalid("invalid sharedStrings root tag".to_string())
                })?;
                return Ok(translunar_filter_office_core::ByteReplacement {
                    start: insertion,
                    end: insertion,
                    bytes: format!(" uniqueCount=\"{unique_count}\"").into_bytes(),
                });
            }
            Ok(Event::Eof) => break,
            Ok(_) => {}
            Err(error) => {
                return Err(XlsxError::Invalid(format!(
                    "cannot parse sharedStrings.xml root: {error}"
                )));
            }
        }
        buffer.clear();
    }
    Err(XlsxError::Invalid(
        "sharedStrings.xml has no sst root".to_string(),
    ))
}

fn find_bytes(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}

fn clone_shared_string(
    shared_part: &[u8],
    item: &SharedString,
    target: &str,
) -> Result<Vec<u8>, XlsxError> {
    if item.end > shared_part.len() || item.start > item.end {
        return Err(XlsxError::Invalid(
            "shared string source range is invalid".to_string(),
        ));
    }
    let relative = item
        .ranges
        .iter()
        .map(|range| XmlTextRange {
            start: range.start.saturating_sub(item.start),
            end: range.end.saturating_sub(item.start),
            text: range.text.clone(),
        })
        .collect::<Vec<_>>();
    replace_text_ranges(&shared_part[item.start..item.end], &relative, target).map_err(Into::into)
}

fn cell_path(part: &str, reference: &str) -> String {
    format!("xlsx:{part}#cell:{reference}")
}

fn target_map(segments: &[Segment]) -> Result<HashMap<String, String>, XlsxError> {
    let mut targets = HashMap::new();
    for segment in segments {
        if segment.target_text.trim().is_empty() {
            continue;
        }
        if !segment.structural_path.starts_with("xlsx:") {
            return Err(XlsxError::Invalid(format!(
                "unsupported XLSX structural path {}",
                segment.structural_path
            )));
        }
        if targets
            .insert(segment.structural_path.clone(), segment.target_text.clone())
            .is_some()
        {
            return Err(XlsxError::Invalid(format!(
                "duplicate XLSX structural path {}",
                segment.structural_path
            )));
        }
    }
    Ok(targets)
}

fn validate_bytes(bytes: &[u8]) -> Result<(), XlsxError> {
    let package = OfficePackage::from_bytes(bytes)?;
    let workbook = discover_workbook(&package)?;
    validate_xml(package.require(&workbook.part)?, &workbook.part)?;
    for sheet in workbook.sheets {
        validate_xml(package.require(&sheet.part)?, &sheet.part)?;
    }
    if let Some(part) = workbook.shared_strings {
        validate_xml(package.require(&part)?, &part)?;
    }
    Ok(())
}

fn xlsx_degradations(package: &OfficePackage) -> Vec<DegradationFinding> {
    package
        .opaque_features()
        .into_iter()
        .map(|feature| {
            let (code, message) = match feature.kind {
                translunar_filter_office_core::OpaqueFeatureKind::Macro => (
                    "xlsx.macro-preserved",
                    "VBA macro part is preserved but not executed or translated",
                ),
                translunar_filter_office_core::OpaqueFeatureKind::ActiveX => (
                    "xlsx.activex-preserved",
                    "ActiveX part is preserved but not executed",
                ),
                translunar_filter_office_core::OpaqueFeatureKind::EmbeddedObject => (
                    "xlsx.embedded-object-preserved",
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

fn attribute_value(
    element: &BytesStart<'_>,
    name: &[u8],
    decoder: quick_xml::encoding::Decoder,
) -> Result<Option<String>, XlsxError> {
    for attribute in element.attributes().with_checks(false) {
        let attribute = attribute
            .map_err(|error| XlsxError::Invalid(format!("invalid XML attribute: {error}")))?;
        if attribute.key.local_name().as_ref() == name {
            return attribute
                .decoded_and_normalized_value(quick_xml::XmlVersion::Implicit1_0, decoder)
                .map(|value| Some(value.into_owned()))
                .map_err(|error| {
                    XlsxError::Invalid(format!("invalid XML attribute value: {error}"))
                });
        }
    }
    Ok(None)
}

fn parse_string_set(
    value: Option<&String>,
    key: &str,
) -> Result<Option<HashSet<String>>, XlsxError> {
    value
        .map(|value| {
            let mut result = HashSet::new();
            for item in value.split(',').map(str::trim) {
                if item.is_empty() || !result.insert(item.to_string()) {
                    return Err(XlsxError::Invalid(format!(
                        "{key} contains an empty or duplicate item"
                    )));
                }
            }
            Ok(result)
        })
        .transpose()
}

fn parse_usize_set(value: Option<&String>, key: &str) -> Result<Option<HashSet<usize>>, XlsxError> {
    value
        .map(|value| {
            let mut result = HashSet::new();
            for item in value.split(',').map(str::trim) {
                let parsed = item.parse::<usize>().map_err(|_| {
                    XlsxError::Invalid(format!("{key} contains a non-numeric item"))
                })?;
                if parsed == 0 || !result.insert(parsed) {
                    return Err(XlsxError::Invalid(format!(
                        "{key} contains zero or duplicate item"
                    )));
                }
            }
            Ok(result)
        })
        .transpose()
}

fn parse_numeric_range(
    value: Option<&String>,
    key: &str,
    minimum: u32,
    maximum: u32,
) -> Result<Option<(u32, u32)>, XlsxError> {
    value
        .map(|value| {
            let mut parts = value.split(':');
            let start = parts
                .next()
                .ok_or_else(|| XlsxError::Invalid(format!("{key} is empty")))?
                .trim()
                .parse::<u32>()
                .map_err(|_| XlsxError::Invalid(format!("{key} has an invalid start")))?;
            let end = parts
                .next()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::parse::<u32>)
                .transpose()
                .map_err(|_| XlsxError::Invalid(format!("{key} has an invalid end")))?
                .unwrap_or(start);
            if parts.next().is_some() || start < minimum || end < start || end > maximum {
                return Err(XlsxError::Invalid(format!(
                    "{key} must be an inclusive range within {minimum}..={maximum}"
                )));
            }
            Ok((start, end))
        })
        .transpose()
}

fn parse_column_range(value: &str) -> Result<(u32, u32), XlsxError> {
    let mut parts = value.split(':');
    let start = column_number(parts.next().unwrap_or_default().trim())?;
    let end = parts
        .next()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(column_number)
        .transpose()?
        .unwrap_or(start);
    if parts.next().is_some() || end < start || end > 16_384 {
        return Err(XlsxError::Invalid(
            "columnRange must be an inclusive A:XFD range".to_string(),
        ));
    }
    Ok((start, end))
}

fn column_number(value: &str) -> Result<u32, XlsxError> {
    if value.is_empty() {
        return Err(XlsxError::Invalid(
            "columnRange contains an empty column".to_string(),
        ));
    }
    let mut number = 0_u32;
    for byte in value.bytes() {
        if !byte.is_ascii_alphabetic() {
            return Err(XlsxError::Invalid(format!("invalid column {value}")));
        }
        number = number
            .checked_mul(26)
            .and_then(|value| value.checked_add(u32::from(byte.to_ascii_uppercase() - b'A' + 1)))
            .ok_or_else(|| XlsxError::Invalid("column number overflow".to_string()))?;
    }
    if number == 0 || number > 16_384 {
        return Err(XlsxError::Invalid(format!(
            "column is outside A:XFD: {value}"
        )));
    }
    Ok(number)
}

fn parse_cell_reference(value: &str) -> Result<(u32, u32), XlsxError> {
    let split = value
        .find(|character: char| character.is_ascii_digit())
        .ok_or_else(|| XlsxError::Invalid(format!("invalid cell reference {value}")))?;
    let column = column_number(&value[..split])?;
    let row = value[split..]
        .parse::<u32>()
        .map_err(|_| XlsxError::Invalid(format!("invalid cell row {value}")))?;
    if row == 0 || row > 1_048_576 {
        return Err(XlsxError::Invalid(format!(
            "cell row outside XLSX bounds: {value}"
        )));
    }
    Ok((row, column))
}

fn parse_bool(value: Option<&String>, key: &str) -> Result<Option<bool>, XlsxError> {
    value
        .map(|value| match value.trim().to_ascii_lowercase().as_str() {
            "true" | "1" | "yes" => Ok(true),
            "false" | "0" | "no" => Ok(false),
            _ => Err(XlsxError::Invalid(format!("{key} must be true or false"))),
        })
        .transpose()
}

#[cfg(test)]
mod tests {
    use translunar_domain::{SegmentState, new_id, segment_hashes};

    use super::*;

    fn segments_for(units: &[translunar_filter_core::ImportedUnit]) -> Vec<Segment> {
        units
            .iter()
            .map(|unit| {
                let (source_hash, context_hash) = segment_hashes(&unit.source_text, None, None);
                Segment {
                    id: new_id(),
                    document_id: "xlsx-fixture".to_string(),
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
    fn parses_column_and_cell_references() {
        assert_eq!(column_number("A").expect("A"), 1);
        assert_eq!(column_number("XFD").expect("XFD"), 16_384);
        assert_eq!(parse_cell_reference("B12").expect("B12"), (12, 2));
    }

    #[test]
    fn rejects_invalid_selection_range() {
        let mut options = BTreeMap::new();
        options.insert("rowRange".to_string(), "10:2".to_string());
        assert!(Selection::parse(&options).is_err());
    }

    #[test]
    fn imports_selection_and_protects_formulas() {
        let temp = tempfile::tempdir().expect("temporary directory");
        let source = temp.path().join("fixture.xlsx");
        fixture::write_fixture(&source).expect("write fixture");
        let mut request = ImportRequest::new(source);
        request.document_id = Some("doc-xlsx".to_string());
        let units = XlsxFilter
            .extract_units(&request)
            .expect("extract workbook");
        assert_eq!(units.len(), 5);
        assert_eq!(units[0].source_text, "Hello world");
        assert_eq!(units[1].source_text, "Repeated");
        assert_eq!(units[2].source_text, "Repeated");
        assert_eq!(units[3].source_text, "Inline rich");
        assert_eq!(units[4].source_text, "Second row");
        assert!(units.iter().all(|unit| !unit.source_text.contains("SUM")));
        let document = collect_imported_document(
            XlsxFilter
                .extract_events(&request)
                .expect("XLSX events")
                .into_iter()
                .map(Ok),
        )
        .expect("collect XLSX document");
        assert!(
            document
                .degradation
                .iter()
                .any(|finding| finding.code == "xlsx.embedded-object-preserved")
        );

        request
            .options
            .insert("columnRange".to_string(), "A:B".to_string());
        let selected = XlsxFilter
            .extract_units(&request)
            .expect("selected workbook");
        assert_eq!(selected.len(), 2);

        request.options.clear();
        request
            .options
            .insert("rowRange".to_string(), "2:2".to_string());
        let second_row = XlsxFilter
            .extract_units(&request)
            .expect("second row selection");
        assert_eq!(second_row.len(), 1);
        assert_eq!(second_row[0].source_text, "Second row");

        request.options.clear();
        request
            .options
            .insert("sheetNames".to_string(), "Hidden".to_string());
        request
            .options
            .insert("includeHiddenSheets".to_string(), "true".to_string());
        let hidden = XlsxFilter
            .extract_units(&request)
            .expect("hidden worksheet");
        assert_eq!(hidden.len(), 1);
        assert_eq!(hidden[0].source_text, "Hidden text");
    }

    #[test]
    fn clones_shared_strings_without_changing_other_cells() {
        let temp = tempfile::tempdir().expect("temporary directory");
        let source = temp.path().join("fixture.xlsx");
        let output = temp.path().join("translated.xlsx");
        fixture::write_fixture(&source).expect("write fixture");
        let request = ImportRequest::new(source.clone());
        let units = XlsxFilter
            .extract_units(&request)
            .expect("extract workbook");
        let mut segments = segments_for(&units);
        let rich = segments
            .iter_mut()
            .find(|segment| segment.structural_path.ends_with("#cell:A1"))
            .expect("A1 segment");
        rich.target_text = "富文本".to_string();
        rich.state = SegmentState::Confirmed;
        let translated = segments
            .iter_mut()
            .find(|segment| segment.structural_path.ends_with("#cell:B1"))
            .expect("B1 segment");
        translated.target_text = "单独翻译".to_string();
        translated.state = SegmentState::Confirmed;
        let count = XlsxFilter
            .export(&source, &output, &segments)
            .expect("export workbook");
        assert_eq!(count, 2);
        let exported = XlsxFilter
            .extract_units(&ImportRequest::new(output.clone()))
            .expect("reopen workbook");
        let by_path = exported
            .into_iter()
            .map(|unit| (unit.structural_path, unit.source_text))
            .collect::<HashMap<_, _>>();
        assert_eq!(
            by_path
                .get("xlsx:xl/worksheets/sheet1.xml#cell:B1")
                .map(String::as_str),
            Some("单独翻译")
        );
        assert_eq!(
            by_path
                .get("xlsx:xl/worksheets/sheet1.xml#cell:C1")
                .map(String::as_str),
            Some("Repeated")
        );
        assert_eq!(
            by_path
                .get("xlsx:xl/worksheets/sheet1.xml#cell:A1")
                .map(String::as_str),
            Some("富文本")
        );
        let package = OfficePackage::open(&output).expect("output package");
        let shared = package
            .require("xl/sharedStrings.xml")
            .expect("shared strings");
        assert!(
            shared
                .windows(b"<b/>".len())
                .any(|window| window == b"<b/>")
        );
        assert!(
            shared
                .windows(b"uniqueCount=\"4\"".len())
                .any(|window| window == b"uniqueCount=\"4\"")
        );
        assert!(XlsxFilter.export(&source, &output, &segments).is_err());
    }
}

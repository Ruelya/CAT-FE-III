//! Conservative PPTX import/export with part-local text ownership.

pub mod fixture;

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
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
    ByteReplacement, OfficeError, OfficePackage, RunFormat, XmlTextRange, apply_replacements,
    decode_reference, decode_text, format_groups, parse_relationships, rebuild_package,
    reduce_run_properties, relationship_part, resolve_relationship_target, taggable_format_groups,
    validate_xml,
};

const ROOT_REL_TYPE: &str = "/officeDocument";
const SLIDE_REL_TYPE: &str = "/slide";
const NOTES_REL_TYPE: &str = "/notesSlide";
const MASTER_REL_TYPE: &str = "/slideMaster";
const DIAGRAM_REL_TYPE: &str = "/diagramData";

#[derive(Debug, Error)]
pub enum PptxError {
    #[error("PPTX I/O failed: {0}")]
    Io(#[from] std::io::Error),
    #[error("invalid PPTX ZIP package: {0}")]
    Zip(#[from] zip::result::ZipError),
    #[error(transparent)]
    Office(#[from] OfficeError),
    #[error("invalid PPTX package: {0}")]
    Invalid(String),
    #[error("invalid filter operation: {0}")]
    Pipeline(#[from] FilterError),
}

#[derive(Debug, Clone)]
pub struct PptxFilter;

impl Default for PptxFilter {
    fn default() -> Self {
        Self
    }
}

#[derive(Debug, Clone)]
struct PresentationInfo {
    part: String,
    slides: Vec<String>,
    masters: Vec<String>,
}

#[derive(Debug, Clone)]
struct TextUnit {
    owner_offset: usize,
    text: String,
    ranges: Vec<XmlTextRange>,
    /// Formatting of the `a:r` that owns each range, index aligned.
    formats: Vec<RunFormat>,
}

#[derive(Debug, Clone, Default)]
struct PptxOptions {
    slide_indexes: Option<HashSet<usize>>,
    include_notes: bool,
    include_masters: bool,
}

impl PptxOptions {
    fn parse(options: &BTreeMap<String, String>) -> Result<Self, PptxError> {
        Ok(Self {
            slide_indexes: parse_index_set(options.get("slideIndexes"))?,
            include_notes: parse_bool(options.get("includeNotes"), "includeNotes")?
                .unwrap_or(false),
            include_masters: parse_bool(options.get("includeMasters"), "includeMasters")?
                .unwrap_or(false),
        })
    }
}

impl PptxFilter {
    pub fn extract_units(
        &self,
        request: &ImportRequest,
    ) -> Result<Vec<translunar_filter_core::ImportedUnit>, PptxError> {
        let events = self.extract_events(request)?;
        Ok(collect_imported_document(events.into_iter().map(Ok))?.units)
    }

    pub fn validate(&self, source: &Path) -> Result<(), PptxError> {
        let package = OfficePackage::open(source)?;
        let presentation = discover_presentation(&package)?;
        validate_xml(package.require(&presentation.part)?, &presentation.part)?;
        for slide in &presentation.slides {
            validate_xml(package.require(slide)?, slide)?;
        }
        Ok(())
    }

    pub fn export(
        &self,
        source: &Path,
        output: &Path,
        segments: &[Segment],
    ) -> Result<u32, PptxError> {
        if source == output {
            return Err(PptxError::Invalid(
                "export path must not replace the managed source".to_string(),
            ));
        }
        self.validate(source)?;
        let package = OfficePackage::open(source)?;
        let presentation = discover_presentation(&package)?;
        let all_parts = discover_all_text_parts(&package, &presentation, true, true, None)?;
        let targets = target_map(segments)?;
        let mut replacements = BTreeMap::new();
        let mut applied = HashSet::new();
        let mut translated = 0_u32;
        for part in all_parts {
            let bytes = package.require(&part)?;
            let units = parse_text_units(bytes, &part)?;
            let mut part_replacements = Vec::new();
            for unit in units {
                let path = text_path(&part, unit.owner_offset);
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
                            translunar_filter_office_core::escape_xml_text(target)
                        } else {
                            Vec::new()
                        },
                    });
                }
                applied.insert(path);
                translated = translated.checked_add(1).ok_or_else(|| {
                    PptxError::Invalid("translated paragraph count overflow".to_string())
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
            return Err(PptxError::Invalid(format!(
                "PPTX structural path does not exist in source package: {missing}"
            )));
        }
        let rebuilt = rebuild_package(source, &replacements)?;
        validate_bytes(&rebuilt)?;
        publish_bytes_noclobber(output, &rebuilt).map_err(PptxError::Pipeline)?;
        Ok(translated)
    }

    fn extract_events(&self, request: &ImportRequest) -> Result<Vec<FilterEvent>, PptxError> {
        let options = PptxOptions::parse(&request.options)?;
        let package = OfficePackage::open(&request.source)?;
        let degradation = pptx_degradations(&package);
        let presentation = discover_presentation(&package)?;
        let parts = discover_all_text_parts(
            &package,
            &presentation,
            options.include_notes,
            options.include_masters,
            options.slide_indexes.as_ref(),
        )?;
        let document_id = request.document_id.as_deref().unwrap_or("pptx");
        let mut events = vec![FilterEvent::StartDocument {
            metadata: DocumentMetadata {
                format: "pptx".to_string(),
                source_locale: request.source_locale.clone(),
                properties: BTreeMap::from([
                    (
                        "slideCount".to_string(),
                        presentation.slides.len().to_string(),
                    ),
                    ("filter".to_string(), "builtin.pptx".to_string()),
                ]),
            },
        }];
        events.extend(degradation.iter().cloned().map(FilterEvent::Degradation));
        let mut ordinal = 0_u32;
        for part in parts {
            let bytes = package.require(&part)?;
            for unit in parse_text_units(bytes, &part)? {
                if unit.text.trim().is_empty() {
                    continue;
                }
                events.push(FilterEvent::StartUnit {
                    ordinal,
                    structural_path: text_path(&part, unit.owner_offset),
                });
                events.push(FilterEvent::Text(unit.text.clone()));
                append_rich_tags(&mut events, document_id, ordinal, &unit)?;
                events.push(FilterEvent::EndUnit);
                ordinal = ordinal
                    .checked_add(1)
                    .ok_or_else(|| PptxError::Invalid("PPTX unit count overflow".to_string()))?;
            }
        }
        if ordinal == 0 {
            return Err(PptxError::Invalid(
                "presentation contains no selected translatable text".to_string(),
            ));
        }
        events.push(FilterEvent::EndDocument);
        Ok(events)
    }
}

impl DocumentFilter for PptxFilter {
    fn descriptor(&self) -> FilterDescriptor {
        FilterDescriptor {
            id: "builtin.pptx".to_string(),
            version: env!("CARGO_PKG_VERSION").to_string(),
            display_name: "Microsoft PowerPoint PPTX".to_string(),
            extensions: vec!["pptx".to_string()],
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
            .is_some_and(|extension| extension.eq_ignore_ascii_case("pptx"));
        if !extension_matches {
            return Ok(ProbeResult::no_match("file extension is not .pptx"));
        }
        match self.validate(source) {
            Ok(()) => Ok(ProbeResult::matches(100, "valid PPTX OOXML package")),
            Err(PptxError::Io(error)) => Err(FilterError::Io(error)),
            Err(PptxError::Office(OfficeError::Io(error))) => Err(FilterError::Io(error)),
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
            .map_err(PptxError::from)
            .map_err(map_error)?;
        let degradation = pptx_degradations(&package);
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
        PptxFilter::validate(self, source).map_err(map_error)?;
        Ok(ValidationReport {
            valid: true,
            findings: Vec::new(),
        })
    }
}

fn map_error(error: PptxError) -> FilterError {
    match error {
        PptxError::Io(error) => FilterError::Io(error),
        PptxError::Zip(error) => FilterError::Invalid(error.to_string()),
        PptxError::Office(OfficeError::Io(error)) => FilterError::Io(error),
        PptxError::Office(error) => FilterError::Invalid(error.to_string()),
        PptxError::Invalid(message) => FilterError::Invalid(message),
        PptxError::Pipeline(error) => error,
    }
}

fn discover_presentation(package: &OfficePackage) -> Result<PresentationInfo, PptxError> {
    let root_relationships = parse_relationships(package.require("_rels/.rels")?, "_rels/.rels")?;
    let root = root_relationships
        .iter()
        .find(|relationship| relationship.relationship_type.ends_with(ROOT_REL_TYPE))
        .ok_or_else(|| {
            PptxError::Invalid("package has no presentation relationship".to_string())
        })?;
    let part = resolve_relationship_target("", root)?
        .ok_or_else(|| PptxError::Invalid("presentation relationship is external".to_string()))?;
    let presentation_xml = package.require(&part)?;
    validate_xml(presentation_xml, &part)?;
    let rels_part = relationship_part(&part)?;
    let relationships = parse_relationships(package.require(&rels_part)?, &rels_part)?;
    let by_id = relationships
        .iter()
        .map(|relationship| (relationship.id.clone(), relationship.clone()))
        .collect::<HashMap<_, _>>();
    let mut slides = Vec::new();
    let mut reader = Reader::from_reader(presentation_xml);
    reader.config_mut().trim_text(false);
    let mut buffer = Vec::new();
    loop {
        match reader.read_event_into(&mut buffer) {
            Ok(Event::Start(element)) | Ok(Event::Empty(element))
                if element.name().local_name().as_ref() == b"sldId" =>
            {
                let rel_id = relationship_id(&element, reader.decoder())?.ok_or_else(|| {
                    PptxError::Invalid("slide has no relationship id".to_string())
                })?;
                let relationship = by_id.get(&rel_id).ok_or_else(|| {
                    PptxError::Invalid(format!("slide references unknown relationship {rel_id}"))
                })?;
                if !relationship.relationship_type.ends_with(SLIDE_REL_TYPE) {
                    return Err(PptxError::Invalid(format!(
                        "relationship {rel_id} is not a slide"
                    )));
                }
                let slide = resolve_relationship_target(&part, relationship)?.ok_or_else(|| {
                    PptxError::Invalid("slide relationship is external".to_string())
                })?;
                package.require(&slide)?;
                slides.push(slide);
            }
            Ok(Event::Eof) => break,
            Ok(_) => {}
            Err(error) => {
                return Err(PptxError::Invalid(format!(
                    "cannot parse presentation XML: {error}"
                )));
            }
        }
        buffer.clear();
    }
    let mut masters = Vec::new();
    for relationship in relationships {
        if relationship.relationship_type.ends_with(MASTER_REL_TYPE)
            && let Some(master) = resolve_relationship_target(&part, &relationship)?
        {
            package.require(&master)?;
            masters.push(master);
        }
    }
    if slides.is_empty() {
        return Err(PptxError::Invalid(
            "presentation contains no slides".to_string(),
        ));
    }
    Ok(PresentationInfo {
        part,
        slides,
        masters,
    })
}

fn discover_all_text_parts(
    package: &OfficePackage,
    presentation: &PresentationInfo,
    include_notes: bool,
    include_masters: bool,
    slide_indexes: Option<&HashSet<usize>>,
) -> Result<Vec<String>, PptxError> {
    let mut parts = Vec::new();
    let mut seen = BTreeSet::new();
    for (offset, slide) in presentation.slides.iter().enumerate() {
        let index = offset + 1;
        if slide_indexes.is_some_and(|indexes| !indexes.contains(&index)) {
            continue;
        }
        push_unique(&mut parts, &mut seen, slide.clone());
        let rels_part = relationship_part(slide)?;
        let Some(rels) = package.get(&rels_part) else {
            continue;
        };
        for relationship in parse_relationships(rels, &rels_part)? {
            if (relationship.relationship_type.ends_with(DIAGRAM_REL_TYPE)
                || (include_notes && relationship.relationship_type.ends_with(NOTES_REL_TYPE)))
                && let Some(target) = resolve_relationship_target(slide, &relationship)?
            {
                package.require(&target)?;
                push_unique(&mut parts, &mut seen, target);
            }
        }
    }
    if include_masters {
        for master in &presentation.masters {
            push_unique(&mut parts, &mut seen, master.clone());
        }
    }
    Ok(parts)
}

fn push_unique(parts: &mut Vec<String>, seen: &mut BTreeSet<String>, part: String) {
    if seen.insert(part.clone()) {
        parts.push(part);
    }
}

fn parse_text_units(bytes: &[u8], part: &str) -> Result<Vec<TextUnit>, PptxError> {
    validate_xml(bytes, part)?;
    let mut reader = Reader::from_reader(bytes);
    reader.config_mut().trim_text(false);
    let mut buffer = Vec::new();
    let mut owner: Option<UnitBuilder> = None;
    let mut text: Option<(usize, String)> = None;
    let mut units = Vec::new();
    // DrawingML keeps run formatting in `a:rPr` attributes (b="1", i="1") and
    // in child elements such as `a:solidFill`, so both have to be collected.
    let mut run_properties: Vec<String> = Vec::new();
    let mut in_run_properties = false;
    loop {
        let before = usize::try_from(reader.buffer_position())
            .map_err(|_| PptxError::Invalid("PPTX XML offset overflow".to_string()))?;
        match reader.read_event_into(&mut buffer) {
            Ok(Event::Start(element)) if is_paragraph(&element) => {
                if owner.is_none() {
                    owner = Some(UnitBuilder {
                        offset: before,
                        text: String::new(),
                        ranges: Vec::new(),
                        formats: Vec::new(),
                    });
                }
            }
            Ok(Event::Start(element)) if is_run_properties(&element) => {
                in_run_properties = true;
                run_properties = drawingml_run_attributes(&element);
            }
            Ok(Event::Empty(element)) if is_run_properties(&element) => {
                in_run_properties = false;
                run_properties = drawingml_run_attributes(&element);
            }
            Ok(Event::End(element))
                if element.name().local_name().as_ref() == b"rPr" && in_run_properties =>
            {
                in_run_properties = false;
            }
            Ok(Event::Start(element)) | Ok(Event::Empty(element)) if in_run_properties => {
                run_properties.push(
                    String::from_utf8_lossy(element.name().local_name().as_ref()).into_owned(),
                );
            }
            Ok(Event::Start(element)) if is_text_element(&element) => {
                if owner.is_none() {
                    owner = Some(UnitBuilder {
                        offset: before,
                        text: String::new(),
                        ranges: Vec::new(),
                        formats: Vec::new(),
                    });
                }
                text = Some((
                    usize::try_from(reader.buffer_position())
                        .map_err(|_| PptxError::Invalid("PPTX text offset overflow".to_string()))?,
                    String::new(),
                ));
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
            Ok(Event::End(element)) if is_text_end(element.name().as_ref()) => {
                if let Some((start, value)) = text.take()
                    && let Some(owner) = owner.as_mut()
                {
                    owner.text.push_str(&value);
                    owner.ranges.push(XmlTextRange {
                        start,
                        end: before,
                        text: value,
                    });
                    owner.formats.push(reduce_run_properties(&run_properties));
                }
            }
            Ok(Event::End(element)) if is_paragraph_end(element.name().as_ref()) => {
                if let Some(builder) = owner.take()
                    && !builder.ranges.is_empty()
                {
                    units.push(builder.finish());
                }
            }
            Ok(Event::Eof) => {
                if let Some(builder) = owner.take()
                    && !builder.ranges.is_empty()
                {
                    units.push(builder.finish());
                }
                break;
            }
            Ok(_) => {}
            Err(error) => {
                return Err(PptxError::Invalid(format!(
                    "cannot parse text part {part}: {error}"
                )));
            }
        }
        buffer.clear();
    }
    Ok(units)
}

#[derive(Debug)]
struct UnitBuilder {
    offset: usize,
    text: String,
    ranges: Vec<XmlTextRange>,
    formats: Vec<RunFormat>,
}

impl UnitBuilder {
    fn finish(self) -> TextUnit {
        TextUnit {
            owner_offset: self.offset,
            text: self.text,
            ranges: self.ranges,
            formats: self.formats,
        }
    }
}

fn is_paragraph(element: &BytesStart<'_>) -> bool {
    element.name().local_name().as_ref() == b"p"
}

fn is_paragraph_end(name: &[u8]) -> bool {
    quick_xml::name::QName(name).local_name().as_ref() == b"p"
}

fn is_text_element(element: &BytesStart<'_>) -> bool {
    element.name().local_name().as_ref() == b"t"
}

fn is_run_properties(element: &BytesStart<'_>) -> bool {
    matches!(element.name().local_name().as_ref(), b"rPr")
}

/// DrawingML encodes the common typographic switches as attributes rather than
/// child elements: `<a:rPr b="1" i="1" u="sng"/>`. Only a value that actually
/// turns the property on counts.
fn drawingml_run_attributes(element: &BytesStart<'_>) -> Vec<String> {
    let mut names = Vec::new();
    for attribute in element.attributes().flatten() {
        let key = String::from_utf8_lossy(attribute.key.local_name().as_ref()).into_owned();
        let value = String::from_utf8_lossy(attribute.value.as_ref()).into_owned();
        let enabled = match key.as_str() {
            "b" | "i" => matches!(value.as_str(), "1" | "true"),
            "u" | "strike" | "baseline" => !matches!(value.as_str(), "none" | "noStrike" | "0"),
            "sz" | "cap" => true,
            _ => false,
        };
        if enabled {
            names.push(if key == "cap" {
                "caps".to_string()
            } else {
                key
            });
        }
    }
    names
}

fn is_text_end(name: &[u8]) -> bool {
    quick_xml::name::QName(name).local_name().as_ref() == b"t"
}

/// Emit protected tags for the formatting spans inside one shape paragraph.
///
/// Same contract as the DOCX filter: a typographically uniform paragraph
/// produces nothing, and plain stretches between formatted ones are text, not
/// tags. PowerPoint splits runs even more eagerly than Word does, so emitting a
/// pair per run made every bullet a tag exercise.
fn append_rich_tags(
    events: &mut Vec<FilterEvent>,
    document_id: &str,
    ordinal: u32,
    unit: &TextUnit,
) -> Result<(), PptxError> {
    let groups = format_groups(&unit.ranges, &unit.formats);
    let source_chars = u32::try_from(unit.text.chars().count())
        .map_err(|_| PptxError::Invalid("rich text length overflow".to_string()))?;
    for (index, group) in taggable_format_groups(&groups) {
        if group.end > source_chars {
            return Err(PptxError::Invalid(
                "rich text ranges exceed source text".to_string(),
            ));
        }
        let pair_id = format!("{document_id}:pptx:{ordinal}:{index}");
        let payload = format!("ooxml-rich-run:{}", group.format.signature);
        events.push(FilterEvent::InlineTag(InlineTag {
            id: format!("{pair_id}:start"),
            side: TagSide::Source,
            position: group.start,
            kind: TagKind::Start,
            pair_id: Some(pair_id.clone()),
            payload: payload.clone(),
            display_text: group.format.label.clone(),
            protected: true,
        }));
        events.push(FilterEvent::InlineTag(InlineTag {
            id: format!("{pair_id}:end"),
            side: TagSide::Source,
            position: group.end,
            kind: TagKind::End,
            pair_id: Some(pair_id),
            payload,
            display_text: group.format.label.clone(),
            protected: true,
        }));
    }
    Ok(())
}

fn text_path(part: &str, owner_offset: usize) -> String {
    format!("pptx:{part}#text:{owner_offset}")
}

fn target_map(segments: &[Segment]) -> Result<HashMap<String, String>, PptxError> {
    let mut targets = HashMap::new();
    for segment in segments {
        if segment.target_text.trim().is_empty() {
            continue;
        }
        if !segment.structural_path.starts_with("pptx:") {
            return Err(PptxError::Invalid(format!(
                "unsupported PPTX structural path {}",
                segment.structural_path
            )));
        }
        if targets
            .insert(segment.structural_path.clone(), segment.target_text.clone())
            .is_some()
        {
            return Err(PptxError::Invalid(format!(
                "duplicate PPTX structural path {}",
                segment.structural_path
            )));
        }
    }
    Ok(targets)
}

fn validate_bytes(bytes: &[u8]) -> Result<(), PptxError> {
    let package = OfficePackage::from_bytes(bytes)?;
    let presentation = discover_presentation(&package)?;
    validate_xml(package.require(&presentation.part)?, &presentation.part)?;
    for part in discover_all_text_parts(&package, &presentation, true, true, None)? {
        validate_xml(package.require(&part)?, &part)?;
    }
    Ok(())
}

fn pptx_degradations(package: &OfficePackage) -> Vec<DegradationFinding> {
    let mut findings = package
        .opaque_features()
        .into_iter()
        .map(|feature| {
            let (code, message) = match feature.kind {
                translunar_filter_office_core::OpaqueFeatureKind::Macro => (
                    "pptx.macro-preserved",
                    "VBA macro part is preserved but not executed or translated",
                ),
                translunar_filter_office_core::OpaqueFeatureKind::ActiveX => (
                    "pptx.activex-preserved",
                    "ActiveX part is preserved but not executed",
                ),
                translunar_filter_office_core::OpaqueFeatureKind::EmbeddedObject => (
                    "pptx.embedded-object-preserved",
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
        .collect::<Vec<_>>();
    findings.extend(
        package
            .names()
            .filter(|part| part.starts_with("ppt/charts/") && part.ends_with(".xml"))
            .map(|part| DegradationFinding {
                code: "pptx.chart-text-protected".to_string(),
                severity: DegradationSeverity::Warning,
                message: "chart data and labels are preserved but not translated".to_string(),
                structural_path: Some(part.to_string()),
            }),
    );
    findings
}

fn relationship_id(
    element: &BytesStart<'_>,
    decoder: quick_xml::encoding::Decoder,
) -> Result<Option<String>, PptxError> {
    for attribute in element.attributes().with_checks(false) {
        let attribute = attribute
            .map_err(|error| PptxError::Invalid(format!("invalid XML attribute: {error}")))?;
        if attribute.key.as_ref() == b"r:id" {
            return attribute
                .decoded_and_normalized_value(quick_xml::XmlVersion::Implicit1_0, decoder)
                .map(|value| Some(value.into_owned()))
                .map_err(|error| PptxError::Invalid(format!("invalid relationship id: {error}")));
        }
    }
    Ok(None)
}

fn parse_index_set(value: Option<&String>) -> Result<Option<HashSet<usize>>, PptxError> {
    value
        .map(|value| {
            let mut indexes = HashSet::new();
            for item in value.split(',').map(str::trim) {
                let index = item.parse::<usize>().map_err(|_| {
                    PptxError::Invalid("slideIndexes contains a non-numeric item".to_string())
                })?;
                if index == 0 || !indexes.insert(index) {
                    return Err(PptxError::Invalid(
                        "slideIndexes contains zero or duplicate item".to_string(),
                    ));
                }
            }
            Ok(indexes)
        })
        .transpose()
}

fn parse_bool(value: Option<&String>, key: &str) -> Result<Option<bool>, PptxError> {
    value
        .map(|value| match value.trim().to_ascii_lowercase().as_str() {
            "true" | "1" | "yes" => Ok(true),
            "false" | "0" | "no" => Ok(false),
            _ => Err(PptxError::Invalid(format!("{key} must be true or false"))),
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
                    document_id: "pptx-fixture".to_string(),
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
    fn parses_slide_selection() {
        let mut options = BTreeMap::new();
        options.insert("slideIndexes".to_string(), "1,3".to_string());
        let parsed = PptxOptions::parse(&options).expect("valid options");
        let indexes = parsed.slide_indexes.expect("slide indexes");
        assert!(indexes.contains(&1));
        assert!(!indexes.contains(&2));
    }

    #[test]
    fn rejects_invalid_boolean_option() {
        let mut options = BTreeMap::new();
        options.insert("includeNotes".to_string(), "sometimes".to_string());
        assert!(PptxOptions::parse(&options).is_err());
    }

    #[test]
    fn imports_shapes_tables_smartart_and_optional_parts() {
        let temp = tempfile::tempdir().expect("temporary directory");
        let source = temp.path().join("fixture.pptx");
        fixture::write_fixture(&source).expect("write fixture");
        let mut request = ImportRequest::new(source);
        request.document_id = Some("doc-pptx".to_string());
        let units = PptxFilter
            .extract_units(&request)
            .expect("extract presentation");
        assert_eq!(units.len(), 4);
        assert!(units.iter().any(|unit| unit.source_text == "Hello slide"));
        assert!(units.iter().any(|unit| unit.source_text == "Cell text"));
        assert!(units.iter().any(|unit| unit.source_text == "SmartArt text"));
        assert!(units.iter().all(|unit| unit.source_text != "Speaker notes"));
        let document = collect_imported_document(
            PptxFilter
                .extract_events(&request)
                .expect("PPTX events")
                .into_iter()
                .map(Ok),
        )
        .expect("collect PPTX document");
        assert!(
            document
                .degradation
                .iter()
                .any(|finding| finding.code == "pptx.chart-text-protected")
        );
        assert!(
            document
                .degradation
                .iter()
                .any(|finding| finding.code == "pptx.embedded-object-preserved")
        );

        request
            .options
            .insert("includeNotes".to_string(), "true".to_string());
        request
            .options
            .insert("includeMasters".to_string(), "true".to_string());
        let expanded = PptxFilter
            .extract_units(&request)
            .expect("expanded presentation");
        assert_eq!(expanded.len(), 6);
        assert!(
            expanded
                .iter()
                .any(|unit| unit.source_text == "Speaker notes")
        );
        assert!(
            expanded
                .iter()
                .any(|unit| unit.source_text == "Master title")
        );
    }

    #[test]
    fn round_trips_owned_slide_text_and_preserves_media() {
        let temp = tempfile::tempdir().expect("temporary directory");
        let source = temp.path().join("fixture.pptx");
        let output = temp.path().join("translated.pptx");
        fixture::write_fixture(&source).expect("write fixture");
        let units = PptxFilter
            .extract_units(&ImportRequest::new(source.clone()))
            .expect("extract presentation");
        let mut segments = segments_for(&units);
        segments[0].target_text = "你好幻灯片".to_string();
        segments[0].state = SegmentState::Confirmed;
        let count = PptxFilter
            .export(&source, &output, &segments)
            .expect("export presentation");
        assert_eq!(count, 1);
        let exported = PptxFilter
            .extract_units(&ImportRequest::new(output.clone()))
            .expect("reopen presentation");
        assert_eq!(exported[0].source_text, "你好幻灯片");
        let before = OfficePackage::open(&source).expect("source package");
        let after = OfficePackage::open(&output).expect("output package");
        assert_eq!(
            before.get("ppt/media/image1.png"),
            after.get("ppt/media/image1.png")
        );
        assert!(PptxFilter.export(&source, &output, &segments).is_err());
    }
}

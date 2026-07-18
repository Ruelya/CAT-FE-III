//! Conservative OOXML DOCX import and export.

pub mod fixture;

use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{BufReader, Cursor, Read, Write};
use std::path::{Path, PathBuf};

use quick_xml::escape::resolve_predefined_entity;
use quick_xml::events::{BytesText, Event};
use quick_xml::{Reader, Writer};
use tempfile::NamedTempFile;
use thiserror::Error;
use translunar_domain::{
    DocumentFilter, FilterError, FilterEvent, ImportedUnit, Segment, collect_imported_units,
    normalize_text,
};
use zip::ZipArchive;
use zip::write::ZipWriter;

const CONTENT_TYPES_PATH: &str = "[Content_Types].xml";
const DOCUMENT_XML_PATH: &str = "word/document.xml";
const STRUCTURAL_PATH_PREFIX: &str = "word/document.xml#p:";

#[derive(Debug, Error)]
pub enum DocxError {
    #[error("DOCX I/O failed: {0}")]
    Io(#[from] std::io::Error),

    #[error("invalid DOCX ZIP package: {0}")]
    Zip(#[from] zip::result::ZipError),

    #[error("invalid DOCX XML: {0}")]
    Xml(#[from] quick_xml::Error),

    #[error("invalid DOCX package: {0}")]
    InvalidPackage(String),

    #[error("invalid filter event stream: {0}")]
    Pipeline(#[from] translunar_domain::PipelineError),

    #[error("failed to publish DOCX export: {0}")]
    Publish(PathBuf, #[source] std::io::Error),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ExportSummary {
    pub translated_segments: u32,
}

#[derive(Debug, Default, Clone, Copy)]
pub struct DocxFilter;

impl DocxFilter {
    pub fn extract_units(&self, source: &Path) -> Result<Vec<ImportedUnit>, DocxError> {
        collect_imported_units(self.extract_events_inner(source)?).map_err(Into::into)
    }

    pub fn validate(&self, source: &Path) -> Result<(), DocxError> {
        let mut archive = open_archive(source)?;
        let content_types = read_entry(&mut archive, CONTENT_TYPES_PATH)?;
        validate_xml(&content_types, CONTENT_TYPES_PATH)?;
        let document_xml = read_entry(&mut archive, DOCUMENT_XML_PATH)?;
        validate_xml(&document_xml, DOCUMENT_XML_PATH)?;
        Ok(())
    }

    pub fn export(
        &self,
        source: &Path,
        output: &Path,
        segments: &[Segment],
    ) -> Result<ExportSummary, DocxError> {
        if source == output {
            return Err(DocxError::InvalidPackage(
                "export path must not replace the managed source".to_string(),
            ));
        }
        self.validate(source)?;
        let translations = translations_by_paragraph(segments)?;
        let translated_segments = u32::try_from(translations.len()).map_err(|_| {
            DocxError::InvalidPackage("translation count does not fit in u32".to_string())
        })?;

        let parent = output.parent().ok_or_else(|| {
            DocxError::InvalidPackage("export path has no parent directory".to_string())
        })?;
        fs::create_dir_all(parent)?;
        let mut temporary = NamedTempFile::new_in(parent)?;
        {
            let input = File::open(source)?;
            let mut archive = ZipArchive::new(BufReader::new(input))?;
            let mut writer = ZipWriter::new(temporary.as_file_mut());
            for index in 0..archive.len() {
                let mut entry = archive.by_index(index)?;
                if entry.name() != DOCUMENT_XML_PATH {
                    writer.raw_copy_file(entry)?;
                    continue;
                }

                let options = entry.options();
                let entry_name = entry.name().to_string();
                let mut document_xml = Vec::new();
                entry.read_to_end(&mut document_xml)?;
                drop(entry);
                let translated_xml = rewrite_document_xml(&document_xml, &translations)?;
                writer.start_file(entry_name, options)?;
                writer.write_all(&translated_xml)?;
            }
            writer.finish()?;
        }
        temporary.as_file().sync_all()?;
        self.validate(temporary.path())?;
        temporary
            .persist(output)
            .map_err(|error| DocxError::Publish(output.to_path_buf(), error.error))?;
        Ok(ExportSummary {
            translated_segments,
        })
    }

    fn extract_events_inner(&self, source: &Path) -> Result<Vec<FilterEvent>, DocxError> {
        self.validate(source)?;
        let mut archive = open_archive(source)?;
        let document_xml = read_entry(&mut archive, DOCUMENT_XML_PATH)?;
        extract_document_events(&document_xml)
    }
}

impl DocumentFilter for DocxFilter {
    fn extract_events(&self, source: &Path) -> Result<Vec<FilterEvent>, FilterError> {
        self.extract_events_inner(source)
            .map_err(|error| match error {
                DocxError::Io(error) => FilterError::Io(error),
                DocxError::InvalidPackage(message) => FilterError::Invalid(message),
                other => FilterError::Processing(other.to_string()),
            })
    }
}

fn open_archive(source: &Path) -> Result<ZipArchive<BufReader<File>>, DocxError> {
    let file = File::open(source)?;
    ZipArchive::new(BufReader::new(file)).map_err(Into::into)
}

fn read_entry<R: Read + std::io::Seek>(
    archive: &mut ZipArchive<R>,
    name: &str,
) -> Result<Vec<u8>, DocxError> {
    let mut entry = archive.by_name(name).map_err(|error| match error {
        zip::result::ZipError::FileNotFound => {
            DocxError::InvalidPackage(format!("missing required package part {name}"))
        }
        other => DocxError::Zip(other),
    })?;
    let mut bytes = Vec::new();
    entry.read_to_end(&mut bytes)?;
    Ok(bytes)
}

fn validate_xml(bytes: &[u8], part_name: &str) -> Result<(), DocxError> {
    let mut reader = Reader::from_reader(Cursor::new(bytes));
    reader.config_mut().trim_text(false);
    let mut buffer = Vec::new();
    loop {
        match reader.read_event_into(&mut buffer) {
            Ok(Event::Eof) => return Ok(()),
            Ok(_) => buffer.clear(),
            Err(error) => {
                return Err(DocxError::InvalidPackage(format!(
                    "{part_name} is not well-formed XML at byte {}: {error}",
                    reader.error_position()
                )));
            }
        }
    }
}

fn extract_document_events(document_xml: &[u8]) -> Result<Vec<FilterEvent>, DocxError> {
    let mut reader = Reader::from_reader(Cursor::new(document_xml));
    reader.config_mut().trim_text(false);
    let mut buffer = Vec::new();
    let mut in_body = false;
    let mut in_text = false;
    let mut paragraph_index = 0_u32;
    let mut current_paragraph: Option<(u32, String)> = None;
    let mut paragraphs = Vec::new();

    loop {
        match reader.read_event_into(&mut buffer)? {
            Event::Start(element) => match element.name().local_name().as_ref() {
                b"body" => in_body = true,
                b"p" if in_body && current_paragraph.is_none() => {
                    current_paragraph = Some((paragraph_index, String::new()));
                    paragraph_index = paragraph_index.checked_add(1).ok_or_else(|| {
                        DocxError::InvalidPackage("paragraph count overflow".to_string())
                    })?;
                }
                b"t" if current_paragraph.is_some() => in_text = true,
                _ => {}
            },
            Event::Empty(element) => {
                if let Some((_, text)) = current_paragraph.as_mut() {
                    match element.name().local_name().as_ref() {
                        b"tab" => text.push('\t'),
                        b"br" | b"cr" => text.push('\n'),
                        _ => {}
                    }
                }
            }
            Event::Text(text) if in_text => {
                let decoded = text.decode().map_err(|error| {
                    DocxError::InvalidPackage(format!("cannot decode document text: {error}"))
                })?;
                current_paragraph
                    .as_mut()
                    .expect("text only tracked inside a paragraph")
                    .1
                    .push_str(&decoded);
            }
            Event::GeneralRef(reference) if in_text => {
                let value = resolve_reference(&reference)?;
                current_paragraph
                    .as_mut()
                    .expect("entity reference only tracked inside a paragraph")
                    .1
                    .push_str(&value);
            }
            Event::End(element) => match element.name().local_name().as_ref() {
                b"t" => in_text = false,
                b"p" if current_paragraph.is_some() => {
                    let paragraph = current_paragraph.take().expect("paragraph checked");
                    if !normalize_text(&paragraph.1).is_empty() {
                        paragraphs.push(paragraph);
                    }
                }
                b"body" => in_body = false,
                _ => {}
            },
            Event::Eof => break,
            _ => {}
        }
        buffer.clear();
    }

    if paragraph_index == 0 {
        return Err(DocxError::InvalidPackage(
            "word/document.xml contains no body paragraphs".to_string(),
        ));
    }

    let mut events = Vec::with_capacity(paragraphs.len() * 3 + 2);
    events.push(FilterEvent::StartDocument);
    for (ordinal, (body_paragraph, source_text)) in paragraphs.into_iter().enumerate() {
        let ordinal = u32::try_from(ordinal).map_err(|_| {
            DocxError::InvalidPackage("translatable unit count overflow".to_string())
        })?;
        events.push(FilterEvent::StartUnit {
            ordinal,
            structural_path: format!("{STRUCTURAL_PATH_PREFIX}{body_paragraph}"),
        });
        events.push(FilterEvent::Text(source_text));
        events.push(FilterEvent::EndUnit);
    }
    events.push(FilterEvent::EndDocument);
    Ok(events)
}

fn translations_by_paragraph(segments: &[Segment]) -> Result<HashMap<u32, &str>, DocxError> {
    let mut translations = HashMap::new();
    for segment in segments {
        if segment.target_text.trim().is_empty() {
            continue;
        }
        let paragraph = segment
            .structural_path
            .strip_prefix(STRUCTURAL_PATH_PREFIX)
            .ok_or_else(|| {
                DocxError::InvalidPackage(format!(
                    "unsupported DOCX structural path {}",
                    segment.structural_path
                ))
            })?
            .parse::<u32>()
            .map_err(|_| {
                DocxError::InvalidPackage(format!(
                    "invalid DOCX structural path {}",
                    segment.structural_path
                ))
            })?;
        if translations
            .insert(paragraph, segment.target_text.as_str())
            .is_some()
        {
            return Err(DocxError::InvalidPackage(format!(
                "multiple segments target body paragraph {paragraph}"
            )));
        }
    }
    Ok(translations)
}

fn rewrite_document_xml(
    document_xml: &[u8],
    translations: &HashMap<u32, &str>,
) -> Result<Vec<u8>, DocxError> {
    let mut reader = Reader::from_reader(Cursor::new(document_xml));
    reader.config_mut().trim_text(false);
    let mut writer = Writer::new(Vec::with_capacity(document_xml.len()));
    let mut buffer = Vec::new();
    let mut in_body = false;
    let mut in_text = false;
    let mut paragraph_index = 0_u32;
    let mut active_translation: Option<&str> = None;
    let mut translation_written = false;

    loop {
        match reader.read_event_into(&mut buffer)? {
            Event::Start(element) => {
                match element.name().local_name().as_ref() {
                    b"body" => in_body = true,
                    b"p" if in_body && active_translation.is_none() => {
                        active_translation = translations.get(&paragraph_index).copied();
                        translation_written = false;
                        paragraph_index = paragraph_index.checked_add(1).ok_or_else(|| {
                            DocxError::InvalidPackage("paragraph count overflow".to_string())
                        })?;
                    }
                    b"t" if active_translation.is_some() => in_text = true,
                    _ => {}
                }
                writer.write_event(Event::Start(element))?;
            }
            Event::Text(text) if in_text && active_translation.is_some() => {
                let replacement = if translation_written {
                    ""
                } else {
                    translation_written = true;
                    active_translation.expect("translation checked")
                };
                writer.write_event(Event::Text(BytesText::new(replacement)))?;
                let _ = text;
            }
            Event::GeneralRef(reference) if in_text && active_translation.is_some() => {
                if !translation_written {
                    translation_written = true;
                    writer.write_event(Event::Text(BytesText::new(
                        active_translation.expect("translation checked"),
                    )))?;
                }
                let _ = reference;
            }
            Event::End(element) => {
                match element.name().local_name().as_ref() {
                    b"t" => in_text = false,
                    b"p" => {
                        if active_translation.is_some() && !translation_written {
                            return Err(DocxError::InvalidPackage(format!(
                                "body paragraph {} has no writable text run",
                                paragraph_index.saturating_sub(1)
                            )));
                        }
                        active_translation = None;
                        translation_written = false;
                    }
                    b"body" => in_body = false,
                    _ => {}
                }
                writer.write_event(Event::End(element))?;
            }
            Event::Eof => break,
            event => writer.write_event(event)?,
        }
        buffer.clear();
    }
    Ok(writer.into_inner())
}

fn resolve_reference(reference: &quick_xml::events::BytesRef<'_>) -> Result<String, DocxError> {
    if let Some(character) = reference.resolve_char_ref()? {
        return Ok(character.to_string());
    }
    let name = reference.decode().map_err(|error| {
        DocxError::InvalidPackage(format!("cannot decode XML entity reference: {error}"))
    })?;
    resolve_predefined_entity(&name)
        .map(str::to_string)
        .ok_or_else(|| DocxError::InvalidPackage(format!("unsupported XML entity &{name};")))
}

#[cfg(test)]
mod tests {
    use std::io::Read;

    use translunar_domain::{SegmentState, new_id, segment_hashes};

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

        let source_part = read_package_part(&source, fixture::UNRELATED_PART);
        let output_part = read_package_part(&output, fixture::UNRELATED_PART);
        assert_eq!(source_part, output_part);
        let document_xml = read_package_part(&output, DOCUMENT_XML_PATH);
        let document_xml = String::from_utf8(document_xml).expect("UTF-8 document XML");
        assert!(document_xml.contains("<w:pPr>"));
        assert!(document_xml.contains("<w:b/>"));
        assert!(document_xml.contains("&amp;"));
    }

    #[test]
    fn rejects_packages_without_document_xml() {
        let temp = tempfile::tempdir().expect("temporary directory");
        let source = temp.path().join("invalid.docx");
        fixture::write_invalid_fixture(&source).expect("write invalid fixture");
        let error = DocxFilter
            .validate(&source)
            .expect_err("reject invalid package");
        assert!(matches!(error, DocxError::InvalidPackage(_)));
    }

    fn read_package_part(path: &Path, name: &str) -> Vec<u8> {
        let file = File::open(path).expect("open DOCX");
        let mut archive = ZipArchive::new(file).expect("open ZIP");
        let mut entry = archive.by_name(name).expect("find package part");
        let mut bytes = Vec::new();
        entry.read_to_end(&mut bytes).expect("read package part");
        bytes
    }
}

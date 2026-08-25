//! Shared, non-executing OOXML package helpers.

use std::collections::{BTreeMap, BTreeSet};
use std::fs::File;
use std::io::{Cursor, Read, Seek, Write};
use std::path::{Component, Path};

use quick_xml::Reader;
use quick_xml::escape::resolve_predefined_entity;
use quick_xml::events::Event;
use thiserror::Error;
use zip::ZipArchive;
use zip::write::ZipWriter;

pub const CONTENT_TYPES_PATH: &str = "[Content_Types].xml";
pub const ROOT_RELATIONSHIPS_PATH: &str = "_rels/.rels";
pub const MAX_PACKAGE_ENTRIES: usize = 20_000;
pub const MAX_ENTRY_BYTES: u64 = 128 * 1024 * 1024;
pub const MAX_PACKAGE_BYTES: u64 = 512 * 1024 * 1024;
pub const MAX_XML_DEPTH: usize = 512;

#[derive(Debug, Error)]
pub enum OfficeError {
    #[error("Office package I/O failed: {0}")]
    Io(#[from] std::io::Error),
    #[error("invalid Office ZIP package: {0}")]
    Zip(#[from] zip::result::ZipError),
    #[error("invalid Office package: {0}")]
    Invalid(String),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Relationship {
    pub id: String,
    pub relationship_type: String,
    pub target: String,
    pub external: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OpaqueFeatureKind {
    Macro,
    ActiveX,
    EmbeddedObject,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OpaqueFeature {
    pub kind: OpaqueFeatureKind,
    pub part: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ByteReplacement {
    pub start: usize,
    pub end: usize,
    pub bytes: Vec<u8>,
}

/// The inline formatting of one OOXML run, reduced to what a translator needs
/// to see and what export needs in order to rebuild it.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct RunFormat {
    /// Canonical signature. Two runs with the same signature are
    /// typographically identical and must never be split by a protected tag.
    /// Empty means "no visible formatting".
    pub signature: String,
    /// Short human label such as `b`, `i`, or `b i`. Empty when `signature` is.
    pub label: String,
}

impl RunFormat {
    pub fn is_plain(&self) -> bool {
        self.signature.is_empty()
    }
}

/// One stretch of characters that shares a single formatting signature.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FormatGroup {
    pub format: RunFormat,
    /// Character offsets into the unit's plain text.
    pub start: u32,
    pub end: u32,
    /// Indexes into the unit's range list, in document order.
    pub range_indexes: Vec<usize>,
}

/// OOXML properties that a reader can actually see.
///
/// Everything else a producer writes into a run — revision save ids, proofing
/// state, language annotations — is bookkeeping. Treating bookkeeping as
/// formatting is what makes a filter split one sentence into a dozen runs and
/// then demand that the translator reproduce every boundary.
const VISIBLE_RUN_PROPERTIES: &[(&str, &str)] = &[
    ("b", "b"),
    ("bCs", "b"),
    ("i", "i"),
    ("iCs", "i"),
    ("u", "u"),
    ("strike", "s"),
    ("dstrike", "s"),
    ("smallCaps", "sc"),
    ("caps", "caps"),
    ("vertAlign", "va"),
    ("baseline", "va"),
    ("color", "color"),
    ("solidFill", "color"),
    ("highlight", "hl"),
    ("rStyle", "style"),
    ("sz", "sz"),
    ("szCs", "sz"),
    ("rFonts", "font"),
    ("latin", "font"),
    ("hlinkClick", "link"),
];

/// Reduce a run's property element names to a signature and a short label.
pub fn reduce_run_properties<S: AsRef<str>>(properties: &[S]) -> RunFormat {
    let mut labels = BTreeSet::new();
    for property in properties {
        if let Some((_, label)) = VISIBLE_RUN_PROPERTIES
            .iter()
            .find(|(name, _)| *name == property.as_ref())
        {
            labels.insert((*label).to_string());
        }
    }
    if labels.is_empty() {
        return RunFormat::default();
    }
    RunFormat {
        signature: labels.iter().cloned().collect::<Vec<_>>().join("+"),
        label: labels.iter().cloned().collect::<Vec<_>>().join(" "),
    }
}

/// Collapse adjacent ranges that share a formatting signature into groups.
///
/// `formats` is index-aligned with `ranges`; a missing entry counts as plain.
pub fn format_groups(ranges: &[XmlTextRange], formats: &[RunFormat]) -> Vec<FormatGroup> {
    let mut groups: Vec<FormatGroup> = Vec::new();
    let mut position = 0_u32;
    for (index, range) in ranges.iter().enumerate() {
        let length = u32::try_from(range.text.chars().count()).unwrap_or(u32::MAX);
        if length == 0 {
            // A zero-length run cannot be pointed at, but export still has to
            // account for it, so keep it attached to the current group.
            if let Some(last) = groups.last_mut() {
                last.range_indexes.push(index);
            }
            continue;
        }
        let format = formats.get(index).cloned().unwrap_or_default();
        match groups.last_mut() {
            Some(last) if last.format == format => {
                last.end = position.saturating_add(length);
                last.range_indexes.push(index);
            }
            _ => groups.push(FormatGroup {
                format,
                start: position,
                end: position.saturating_add(length),
                range_indexes: vec![index],
            }),
        }
        position = position.saturating_add(length);
    }
    groups
}

/// The formatting spans a translator has to carry, as `(group index, group)`.
///
/// Empty when the unit is typographically uniform: uniform formatting belongs
/// to the paragraph or cell and rides along with it, so there is nothing to
/// place. Plain stretches between formatted ones are not returned either —
/// asking someone to bracket the text where the font is normal is not a task.
pub fn taggable_format_groups(groups: &[FormatGroup]) -> Vec<(usize, &FormatGroup)> {
    if groups.len() < 2 {
        return Vec::new();
    }
    groups
        .iter()
        .enumerate()
        .filter(|(_, group)| !group.format.is_plain())
        .collect()
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct XmlTextRange {
    pub start: usize,
    pub end: usize,
    pub text: String,
}

#[derive(Debug, Clone)]
pub struct OfficePackage {
    entries: BTreeMap<String, Vec<u8>>,
}

impl OfficePackage {
    pub fn open(path: &Path) -> Result<Self, OfficeError> {
        let file = File::open(path)?;
        Self::read(ZipArchive::new(file)?)
    }

    pub fn from_bytes(bytes: &[u8]) -> Result<Self, OfficeError> {
        Self::read(ZipArchive::new(Cursor::new(bytes))?)
    }

    fn read<R: Read + Seek>(mut archive: ZipArchive<R>) -> Result<Self, OfficeError> {
        if archive.len() > MAX_PACKAGE_ENTRIES {
            return Err(OfficeError::Invalid(format!(
                "package contains more than {MAX_PACKAGE_ENTRIES} entries"
            )));
        }
        let mut entries = BTreeMap::new();
        let mut total_bytes = 0_u64;
        for index in 0..archive.len() {
            let mut entry = archive.by_index(index)?;
            let name = validate_entry_name(entry.name())?;
            if entry.encrypted() {
                return Err(OfficeError::Invalid(format!(
                    "encrypted package entry is unsupported: {name}"
                )));
            }
            if entry.size() > MAX_ENTRY_BYTES {
                return Err(OfficeError::Invalid(format!(
                    "package entry exceeds {MAX_ENTRY_BYTES} bytes: {name}"
                )));
            }
            total_bytes = total_bytes.checked_add(entry.size()).ok_or_else(|| {
                OfficeError::Invalid("package uncompressed size overflow".to_string())
            })?;
            if total_bytes > MAX_PACKAGE_BYTES {
                return Err(OfficeError::Invalid(format!(
                    "package exceeds {MAX_PACKAGE_BYTES} uncompressed bytes"
                )));
            }
            if entry.is_dir() {
                continue;
            }
            let capacity = usize::try_from(entry.size()).map_err(|_| {
                OfficeError::Invalid(format!("entry size does not fit memory: {name}"))
            })?;
            let mut bytes = Vec::with_capacity(capacity);
            entry.read_to_end(&mut bytes)?;
            if entries.insert(name.clone(), bytes).is_some() {
                return Err(OfficeError::Invalid(format!(
                    "duplicate package entry: {name}"
                )));
            }
        }
        let package = Self { entries };
        package.require(CONTENT_TYPES_PATH)?;
        package.require(ROOT_RELATIONSHIPS_PATH)?;
        validate_xml(package.require(CONTENT_TYPES_PATH)?, CONTENT_TYPES_PATH)?;
        validate_xml(
            package.require(ROOT_RELATIONSHIPS_PATH)?,
            ROOT_RELATIONSHIPS_PATH,
        )?;
        Ok(package)
    }

    pub fn contains(&self, name: &str) -> bool {
        self.entries.contains_key(name)
    }

    pub fn get(&self, name: &str) -> Option<&[u8]> {
        self.entries.get(name).map(Vec::as_slice)
    }

    pub fn require(&self, name: &str) -> Result<&[u8], OfficeError> {
        self.get(name)
            .ok_or_else(|| OfficeError::Invalid(format!("missing required package part {name}")))
    }

    pub fn names(&self) -> impl Iterator<Item = &str> {
        self.entries.keys().map(String::as_str)
    }

    pub fn opaque_features(&self) -> Vec<OpaqueFeature> {
        self.names()
            .filter_map(|part| {
                let lower = part.to_ascii_lowercase();
                let kind = if lower.ends_with("vbaproject.bin") {
                    OpaqueFeatureKind::Macro
                } else if lower.contains("/activex/") {
                    OpaqueFeatureKind::ActiveX
                } else if lower.contains("/embeddings/") {
                    OpaqueFeatureKind::EmbeddedObject
                } else {
                    return None;
                };
                Some(OpaqueFeature {
                    kind,
                    part: part.to_string(),
                })
            })
            .collect()
    }
}

pub fn validate_xml(bytes: &[u8], part_name: &str) -> Result<(), OfficeError> {
    if bytes.len() as u64 > MAX_ENTRY_BYTES {
        return Err(OfficeError::Invalid(format!(
            "XML part exceeds {MAX_ENTRY_BYTES} bytes: {part_name}"
        )));
    }
    let mut reader = Reader::from_reader(Cursor::new(bytes));
    reader.config_mut().trim_text(false);
    let mut buffer = Vec::new();
    let mut depth = 0_usize;
    let mut saw_root = false;
    loop {
        match reader.read_event_into(&mut buffer) {
            Ok(Event::Start(_)) => {
                if depth == 0 {
                    if saw_root {
                        return Err(OfficeError::Invalid(format!(
                            "Office XML part has multiple root elements: {part_name}"
                        )));
                    }
                    saw_root = true;
                }
                depth = depth.checked_add(1).ok_or_else(|| {
                    OfficeError::Invalid(format!("XML depth overflow in {part_name}"))
                })?;
                if depth > MAX_XML_DEPTH {
                    return Err(OfficeError::Invalid(format!(
                        "XML depth exceeds {MAX_XML_DEPTH} in {part_name}"
                    )));
                }
            }
            Ok(Event::Empty(_)) if depth == 0 => {
                if saw_root {
                    return Err(OfficeError::Invalid(format!(
                        "Office XML part has multiple root elements: {part_name}"
                    )));
                }
                saw_root = true;
            }
            Ok(Event::End(_)) => {
                if depth == 0 {
                    return Err(OfficeError::Invalid(format!(
                        "Office XML part has an unexpected closing element: {part_name}"
                    )));
                }
                depth -= 1;
            }
            Ok(Event::DocType(_)) => {
                return Err(OfficeError::Invalid(format!(
                    "DOCTYPE is unsupported in Office XML part {part_name}"
                )));
            }
            Ok(Event::Text(value)) if depth == 0 => {
                let text = value.decode().map_err(|error| {
                    OfficeError::Invalid(format!(
                        "cannot decode XML text outside the root in {part_name}: {error}"
                    ))
                })?;
                if !text.trim().is_empty() {
                    return Err(OfficeError::Invalid(format!(
                        "Office XML part has text outside its root: {part_name}"
                    )));
                }
            }
            Ok(Event::CData(_)) | Ok(Event::GeneralRef(_)) if depth == 0 => {
                return Err(OfficeError::Invalid(format!(
                    "Office XML part has character data outside its root: {part_name}"
                )));
            }
            Ok(Event::Eof) => {
                if depth != 0 {
                    return Err(OfficeError::Invalid(format!(
                        "Office XML part ends with {depth} unclosed element(s): {part_name}"
                    )));
                }
                if !saw_root {
                    return Err(OfficeError::Invalid(format!(
                        "Office XML part has no root element: {part_name}"
                    )));
                }
                return Ok(());
            }
            Ok(_) => {}
            Err(error) => {
                return Err(OfficeError::Invalid(format!(
                    "{part_name} is not well-formed XML at byte {}: {error}",
                    reader.error_position()
                )));
            }
        }
        buffer.clear();
    }
}

pub fn parse_relationships(
    bytes: &[u8],
    part_name: &str,
) -> Result<Vec<Relationship>, OfficeError> {
    validate_xml(bytes, part_name)?;
    let mut reader = Reader::from_reader(Cursor::new(bytes));
    reader.config_mut().trim_text(false);
    let mut buffer = Vec::new();
    let mut relationships = Vec::new();
    let mut ids = BTreeSet::new();
    loop {
        match reader.read_event_into(&mut buffer) {
            Ok(Event::Start(element)) | Ok(Event::Empty(element))
                if element.name().local_name().as_ref() == b"Relationship" =>
            {
                let mut id = None;
                let mut relationship_type = None;
                let mut target = None;
                let mut external = false;
                for attribute in element.attributes().with_checks(false) {
                    let attribute = attribute.map_err(|error| {
                        OfficeError::Invalid(format!(
                            "invalid relationship attribute in {part_name}: {error}"
                        ))
                    })?;
                    let value = attribute
                        .decoded_and_normalized_value(
                            quick_xml::XmlVersion::Implicit1_0,
                            reader.decoder(),
                        )
                        .map_err(|error| {
                            OfficeError::Invalid(format!(
                                "invalid relationship value in {part_name}: {error}"
                            ))
                        })?
                        .into_owned();
                    match attribute.key.local_name().as_ref() {
                        b"Id" => id = Some(value),
                        b"Type" => relationship_type = Some(value),
                        b"Target" => target = Some(value),
                        b"TargetMode" => external = value.eq_ignore_ascii_case("External"),
                        _ => {}
                    }
                }
                let id = id.ok_or_else(|| {
                    OfficeError::Invalid(format!("relationship without Id in {part_name}"))
                })?;
                if !ids.insert(id.clone()) {
                    return Err(OfficeError::Invalid(format!(
                        "duplicate relationship Id {id} in {part_name}"
                    )));
                }
                relationships.push(Relationship {
                    id,
                    relationship_type: relationship_type.ok_or_else(|| {
                        OfficeError::Invalid(format!("relationship without Type in {part_name}"))
                    })?,
                    target: target.ok_or_else(|| {
                        OfficeError::Invalid(format!("relationship without Target in {part_name}"))
                    })?,
                    external,
                });
            }
            Ok(Event::Eof) => break,
            Ok(_) => {}
            Err(error) => {
                return Err(OfficeError::Invalid(format!(
                    "cannot parse relationships {part_name}: {error}"
                )));
            }
        }
        buffer.clear();
    }
    Ok(relationships)
}

pub fn relationship_part(source_part: &str) -> Result<String, OfficeError> {
    let source = Path::new(source_part);
    let file_name = source
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| {
            OfficeError::Invalid(format!("invalid relationship source part {source_part}"))
        })?;
    let parent = source.parent().unwrap_or_else(|| Path::new(""));
    let rels = parent.join("_rels").join(format!("{file_name}.rels"));
    normalize_package_path(&rels)
}

pub fn resolve_relationship_target(
    source_part: &str,
    relationship: &Relationship,
) -> Result<Option<String>, OfficeError> {
    if relationship.external {
        return Ok(None);
    }
    if relationship.target.contains(':')
        || relationship.target.starts_with('/')
        || relationship.target.starts_with('\\')
    {
        return Err(OfficeError::Invalid(format!(
            "invalid internal relationship target {}",
            relationship.target
        )));
    }
    let base = Path::new(source_part)
        .parent()
        .unwrap_or_else(|| Path::new(""));
    normalize_package_path(&base.join(&relationship.target)).map(Some)
}

pub fn apply_replacements(
    source: &[u8],
    replacements: &[ByteReplacement],
) -> Result<Vec<u8>, OfficeError> {
    let mut ordered = replacements.to_vec();
    ordered.sort_by_key(|replacement| replacement.start);
    let mut previous_end = 0_usize;
    for replacement in &ordered {
        if replacement.start > replacement.end || replacement.end > source.len() {
            return Err(OfficeError::Invalid(
                "replacement range is outside the XML part".to_string(),
            ));
        }
        if replacement.start < previous_end {
            return Err(OfficeError::Invalid(
                "replacement ranges overlap".to_string(),
            ));
        }
        previous_end = replacement.end;
    }
    let additional = ordered.iter().map(|item| item.bytes.len()).sum::<usize>();
    let mut output = Vec::with_capacity(source.len().saturating_add(additional));
    let mut cursor = 0_usize;
    for replacement in ordered {
        output.extend_from_slice(&source[cursor..replacement.start]);
        output.extend_from_slice(&replacement.bytes);
        cursor = replacement.end;
    }
    output.extend_from_slice(&source[cursor..]);
    Ok(output)
}

pub fn escape_xml_text(value: &str) -> Vec<u8> {
    quick_xml::escape::escape(value).into_owned().into_bytes()
}

pub fn decode_text(text: &quick_xml::events::BytesText<'_>) -> Result<String, OfficeError> {
    text.decode()
        .map(|value| value.into_owned())
        .map_err(|error| OfficeError::Invalid(format!("cannot decode XML text: {error}")))
}

pub fn decode_reference(
    reference: &quick_xml::events::BytesRef<'_>,
) -> Result<String, OfficeError> {
    if let Some(character) = reference
        .resolve_char_ref()
        .map_err(|error| OfficeError::Invalid(format!("invalid character reference: {error}")))?
    {
        return Ok(character.to_string());
    }
    let name = reference
        .decode()
        .map_err(|error| OfficeError::Invalid(format!("cannot decode XML reference: {error}")))?;
    resolve_predefined_entity(&name)
        .map(str::to_string)
        .ok_or_else(|| OfficeError::Invalid(format!("unsupported XML entity &{name};")))
}

pub fn replace_text_ranges(
    source: &[u8],
    ranges: &[XmlTextRange],
    target: &str,
) -> Result<Vec<u8>, OfficeError> {
    if ranges.is_empty() {
        return Err(OfficeError::Invalid(
            "text owner has no writable XML text node".to_string(),
        ));
    }
    let replacements = ranges
        .iter()
        .enumerate()
        .map(|(index, range)| ByteReplacement {
            start: range.start,
            end: range.end,
            bytes: if index == 0 {
                escape_xml_text(target)
            } else {
                Vec::new()
            },
        })
        .collect::<Vec<_>>();
    apply_replacements(source, &replacements)
}

pub fn rebuild_package(
    source: &Path,
    replacements: &BTreeMap<String, Vec<u8>>,
) -> Result<Vec<u8>, OfficeError> {
    rebuild_zip(source, replacements)
}

/// Rebuild a validated ZIP envelope while raw-copying every entry that is not
/// explicitly replaced. Callers remain responsible for format-specific entry
/// count, size, encryption, and compression-ratio validation before this step.
pub fn rebuild_zip(
    source: &Path,
    replacements: &BTreeMap<String, Vec<u8>>,
) -> Result<Vec<u8>, OfficeError> {
    let input = File::open(source)?;
    let mut archive = ZipArchive::new(input)?;
    let cursor = Cursor::new(Vec::new());
    let mut writer = ZipWriter::new(cursor);
    let mut seen = BTreeSet::new();
    for index in 0..archive.len() {
        let entry = archive.by_index(index)?;
        let name = validate_entry_name(entry.name())?;
        if let Some(bytes) = replacements.get(&name) {
            writer.start_file(name.clone(), entry.options())?;
            writer.write_all(bytes)?;
            seen.insert(name);
        } else {
            writer.raw_copy_file(entry)?;
        }
    }
    for name in replacements.keys() {
        if !seen.contains(name) {
            return Err(OfficeError::Invalid(format!(
                "cannot replace missing package part {name}"
            )));
        }
    }
    Ok(writer.finish()?.into_inner())
}

fn validate_entry_name(name: &str) -> Result<String, OfficeError> {
    if name.is_empty() || name.starts_with('/') || name.starts_with('\\') || name.contains('\\') {
        return Err(OfficeError::Invalid(format!(
            "invalid package entry path {name}"
        )));
    }
    normalize_package_path(Path::new(name))
}

fn normalize_package_path(path: &Path) -> Result<String, OfficeError> {
    let mut parts = Vec::new();
    for component in path.components() {
        match component {
            Component::Normal(value) => {
                let value = value
                    .to_str()
                    .ok_or_else(|| OfficeError::Invalid("package path is not UTF-8".to_string()))?;
                if value.is_empty() || value == "." {
                    continue;
                }
                parts.push(value);
            }
            Component::CurDir => {}
            Component::ParentDir => {
                if parts.pop().is_none() {
                    return Err(OfficeError::Invalid(
                        "package path escapes its root".to_string(),
                    ));
                }
            }
            Component::Prefix(_) | Component::RootDir => {
                return Err(OfficeError::Invalid(
                    "package path must be relative".to_string(),
                ));
            }
        }
    }
    if parts.is_empty() {
        return Err(OfficeError::Invalid("package path is empty".to_string()));
    }
    Ok(parts.join("/"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn applies_non_overlapping_replacements() {
        let output = apply_replacements(
            b"abcdef",
            &[
                ByteReplacement {
                    start: 1,
                    end: 3,
                    bytes: b"X".to_vec(),
                },
                ByteReplacement {
                    start: 5,
                    end: 6,
                    bytes: b"YZ".to_vec(),
                },
            ],
        )
        .expect("valid replacements");
        assert_eq!(output, b"aXdeYZ");
    }

    #[test]
    fn rejects_overlapping_replacements() {
        let error = apply_replacements(
            b"abcdef",
            &[
                ByteReplacement {
                    start: 1,
                    end: 4,
                    bytes: Vec::new(),
                },
                ByteReplacement {
                    start: 3,
                    end: 5,
                    bytes: Vec::new(),
                },
            ],
        )
        .expect_err("overlap must fail");
        assert!(error.to_string().contains("overlap"));
    }

    #[test]
    fn rejects_unclosed_missing_and_multiple_xml_roots() {
        for xml in [
            &b"<root><child/>"[..],
            &b"<?xml version=\"1.0\"?>"[..],
            &b"<first/><second/>"[..],
        ] {
            assert!(
                validate_xml(xml, "fixture.xml").is_err(),
                "malformed XML must fail: {xml:?}"
            );
        }
        validate_xml(
            b"<?xml version=\"1.0\"?><root><child/></root>",
            "fixture.xml",
        )
        .expect("well-formed XML");
    }

    #[test]
    fn resolves_relative_relationship_targets() {
        let relationship = Relationship {
            id: "rId1".to_string(),
            relationship_type: "worksheet".to_string(),
            target: "worksheets/sheet1.xml".to_string(),
            external: false,
        };
        assert_eq!(
            resolve_relationship_target("xl/workbook.xml", &relationship)
                .expect("target")
                .as_deref(),
            Some("xl/worksheets/sheet1.xml")
        );
    }

    #[test]
    fn rejects_traversal_and_doctype() {
        assert!(normalize_package_path(Path::new("../evil.xml")).is_err());
        assert!(validate_xml(b"<!DOCTYPE a><a/>", "unsafe.xml").is_err());
    }

    #[test]
    fn treats_external_relationships_as_opaque() {
        let relationship = Relationship {
            id: "rId9".to_string(),
            relationship_type: "hyperlink".to_string(),
            target: "https://example.test".to_string(),
            external: true,
        };
        assert_eq!(
            resolve_relationship_target("ppt/slides/slide1.xml", &relationship)
                .expect("external target"),
            None
        );
    }
}

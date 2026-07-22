//! Tamper-evident, reviewable bilingual DOCX packages.
//!
//! The package deliberately has a small OOXML surface: a three-column table
//! plus one JSON custom part.  The manifest binds identity/source data while
//! target, status, and comment bookmarks remain editable by Word.

use std::collections::{BTreeMap, BTreeSet};
use std::io::{Cursor, Write};
use std::path::Path;

use quick_xml::Reader;
use quick_xml::events::Event;
use serde::{Deserialize, Serialize};
use thiserror::Error;
use translunar_domain::{normalize_text, sha256_hex};
use translunar_filter_core::publish_bytes_noclobber;
use translunar_filter_office_core::{OfficeError, OfficePackage, decode_reference, validate_xml};
use zip::CompressionMethod;
use zip::write::{SimpleFileOptions, ZipWriter};

pub const REVIEW_FORMAT_VERSION: u32 = 1;
pub const REVIEW_MANIFEST_PART: &str = "customXml/translunar-review.json";
pub const REVIEW_MAX_ROWS: usize = 100_000;
pub const REVIEW_MAX_CELL_BYTES: usize = 1024 * 1024;
pub const REVIEW_MAX_COMMENT_BYTES: usize = 64 * 1024;

#[derive(Debug, Error)]
pub enum ReviewPackageError {
    #[error("review package I/O failed: {0}")]
    Io(#[from] std::io::Error),
    #[error("invalid review package: {0}")]
    Invalid(String),
    #[error("invalid review package JSON: {0}")]
    Json(#[from] serde_json::Error),
    #[error("invalid review Office package: {0}")]
    Office(#[from] OfficeError),
    #[error("invalid review ZIP package: {0}")]
    Zip(#[from] zip::result::ZipError),
    #[error("review package publication failed: {0}")]
    Publish(#[from] translunar_filter_core::FilterError),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewExportRow {
    pub row_id: String,
    pub segment_id: String,
    pub segment_revision: u64,
    pub ordinal: u32,
    pub source_text: String,
    #[serde(default)]
    pub target_text: String,
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub comments: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewExportInput {
    pub project_id: String,
    pub document_id: String,
    pub base_document_revision: u64,
    pub rows: Vec<ReviewExportRow>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewManifestRow {
    pub row_id: String,
    pub segment_id: String,
    pub segment_revision: u64,
    pub ordinal: u32,
    pub source_hash: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewManifest {
    pub format_version: u32,
    pub project_id: String,
    pub document_id: String,
    pub base_document_revision: u64,
    pub rows: Vec<ReviewManifestRow>,
    pub manifest_hash: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedReviewRow {
    pub row_id: String,
    pub source_text: String,
    pub target_text: String,
    pub status: String,
    pub comments: String,
    pub source_hash_valid: bool,
    pub diagnostics: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedReviewPackage {
    pub manifest: ReviewManifest,
    pub rows: Vec<ParsedReviewRow>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewExportResult {
    pub output_path: String,
    pub row_count: u32,
    pub manifest_hash: String,
}

#[derive(Debug, Clone)]
struct ReviewTableRow {
    cells: Vec<String>,
    bookmarks: BTreeMap<String, String>,
}

#[derive(Debug, Default)]
struct ReviewTableRowBuilder {
    cells: Vec<String>,
    cell_text: String,
    in_cell: bool,
    bookmarks: BTreeMap<String, String>,
    active_bookmarks: Vec<String>,
    bookmark_ids: BTreeMap<String, String>,
}

pub fn source_hash(source: &str) -> String {
    sha256_hex(normalize_text(source).as_bytes())
}

pub fn manifest_hash(manifest: &ReviewManifest) -> Result<String, ReviewPackageError> {
    let unsigned = unsigned_manifest(manifest);
    let bytes = serde_json::to_vec(&unsigned)?;
    Ok(sha256_hex(bytes))
}

pub fn build_review_docx(
    input: &ReviewExportInput,
) -> Result<(Vec<u8>, ReviewManifest), ReviewPackageError> {
    let manifest = make_manifest(input)?;
    let document = render_document(input, &manifest)?;
    let manifest_json = serde_json::to_vec(&manifest)?;
    let bytes = write_package(&document, &manifest_json)?;
    validate_review_bytes(&bytes)?;
    Ok((bytes, manifest))
}

pub fn export_review_docx(
    input: &ReviewExportInput,
    output: &Path,
) -> Result<ReviewExportResult, ReviewPackageError> {
    let (bytes, manifest) = build_review_docx(input)?;
    publish_bytes_noclobber(output, &bytes)?;
    Ok(ReviewExportResult {
        output_path: output.display().to_string(),
        row_count: u32::try_from(manifest.rows.len())
            .map_err(|_| ReviewPackageError::Invalid("review row count overflow".to_string()))?,
        manifest_hash: manifest.manifest_hash,
    })
}

pub fn parse_review_docx(path: &Path) -> Result<ParsedReviewPackage, ReviewPackageError> {
    let package = OfficePackage::open(path)?;
    parse_review_package(&package)
}

pub fn parse_review_bytes(bytes: &[u8]) -> Result<ParsedReviewPackage, ReviewPackageError> {
    let package = OfficePackage::from_bytes(bytes)?;
    parse_review_package(&package)
}

fn parse_review_package(
    package: &OfficePackage,
) -> Result<ParsedReviewPackage, ReviewPackageError> {
    let manifest: ReviewManifest = serde_json::from_slice(package.require(REVIEW_MANIFEST_PART)?)?;
    validate_manifest(&manifest)?;
    let document = package.require("word/document.xml")?;
    validate_xml(document, "word/document.xml")?;
    let table_rows = parse_table_rows(document)?;
    let manifest_rows = manifest
        .rows
        .iter()
        .map(|row| (row.row_id.as_str(), row))
        .collect::<BTreeMap<_, _>>();
    let mut seen = BTreeSet::new();
    let mut rows = Vec::with_capacity(table_rows.len());
    for table_row in table_rows {
        let row_id = bookmark_value_by_suffix(&table_row.bookmarks, "_id")
            .or_else(|| parse_id_cell(table_row.cells.first().map(String::as_str)))
            .ok_or_else(|| {
                ReviewPackageError::Invalid("review row has no row identity".to_string())
            })?;
        if !seen.insert(row_id.clone()) {
            return Err(ReviewPackageError::Invalid(
                "review package contains duplicate row identity".to_string(),
            ));
        }
        let expected = manifest_rows.get(row_id.as_str()).copied();
        let source_name = bookmark_name(&row_id, "source");
        let target_name = bookmark_name(&row_id, "target");
        let comments_name = bookmark_name(&row_id, "comments");
        let status_name = bookmark_name(&row_id, "status");
        let id_name = bookmark_name(&row_id, "id");
        let mut diagnostics = Vec::new();
        let source = table_row
            .bookmarks
            .get(&source_name)
            .cloned()
            .unwrap_or_else(|| table_row.cells.get(1).cloned().unwrap_or_default());
        let target = table_row
            .bookmarks
            .get(&target_name)
            .cloned()
            .unwrap_or_default();
        let comments = table_row
            .bookmarks
            .get(&comments_name)
            .cloned()
            .unwrap_or_default();
        let status = table_row
            .bookmarks
            .get(&status_name)
            .cloned()
            .unwrap_or_default();
        if table_row.cells.len() != 3 {
            diagnostics.push("review row must contain exactly three cells".to_string());
        }
        if !table_row.bookmarks.contains_key(&id_name) {
            diagnostics.push("row identity bookmark is missing".to_string());
        }
        if !table_row.bookmarks.contains_key(&status_name) {
            diagnostics.push("status bookmark is missing".to_string());
        }
        if !table_row.bookmarks.contains_key(&source_name) {
            diagnostics.push("source bookmark is missing".to_string());
        }
        if !table_row.bookmarks.contains_key(&target_name) {
            diagnostics.push("target bookmark is missing".to_string());
        }
        if !table_row.bookmarks.contains_key(&comments_name) {
            diagnostics.push("comments bookmark is missing".to_string());
        }
        if source.len() > REVIEW_MAX_CELL_BYTES || target.len() > REVIEW_MAX_CELL_BYTES {
            diagnostics.push("review source or target cell exceeds 1 MiB".to_string());
        }
        if comments.len() > REVIEW_MAX_COMMENT_BYTES {
            diagnostics.push("review comments exceed the limit".to_string());
        }
        let source_hash_valid =
            expected.is_some_and(|binding| source_hash(&source) == binding.source_hash);
        if expected.is_some() && !source_hash_valid {
            diagnostics.push("review source hash does not match the manifest".to_string());
        }
        if expected.is_none() {
            diagnostics.push("row identity is not present in the manifest".to_string());
        }
        rows.push(ParsedReviewRow {
            row_id,
            source_text: source,
            target_text: target,
            status,
            comments,
            source_hash_valid,
            diagnostics,
        });
    }
    if rows.len() > REVIEW_MAX_ROWS {
        return Err(ReviewPackageError::Invalid(
            "review package exceeds 100000 rows".to_string(),
        ));
    }
    Ok(ParsedReviewPackage { manifest, rows })
}

fn make_manifest(input: &ReviewExportInput) -> Result<ReviewManifest, ReviewPackageError> {
    if input.project_id.trim().is_empty() || input.document_id.trim().is_empty() {
        return Err(ReviewPackageError::Invalid(
            "review project and document identities are required".to_string(),
        ));
    }
    if input.rows.is_empty() || input.rows.len() > REVIEW_MAX_ROWS {
        return Err(ReviewPackageError::Invalid(
            "review row count is outside the supported range".to_string(),
        ));
    }
    let mut rows = input.rows.clone();
    rows.sort_by_key(|row| (row.ordinal, row.row_id.clone()));
    let mut ids = BTreeSet::new();
    let mut ordinals = BTreeSet::new();
    let mut bindings = Vec::with_capacity(rows.len());
    for row in rows {
        validate_row_text(&row)?;
        if !ids.insert(row.row_id.clone()) || !ordinals.insert(row.ordinal) {
            return Err(ReviewPackageError::Invalid(
                "review row identities and ordinals must be unique".to_string(),
            ));
        }
        bindings.push(ReviewManifestRow {
            row_id: row.row_id,
            segment_id: row.segment_id,
            segment_revision: row.segment_revision,
            ordinal: row.ordinal,
            source_hash: source_hash(&row.source_text),
        });
    }
    let mut manifest = ReviewManifest {
        format_version: REVIEW_FORMAT_VERSION,
        project_id: input.project_id.clone(),
        document_id: input.document_id.clone(),
        base_document_revision: input.base_document_revision,
        rows: bindings,
        manifest_hash: String::new(),
    };
    manifest.manifest_hash = manifest_hash(&manifest)?;
    Ok(manifest)
}

fn validate_row_text(row: &ReviewExportRow) -> Result<(), ReviewPackageError> {
    if row.row_id.trim().is_empty() || row.segment_id.trim().is_empty() {
        return Err(ReviewPackageError::Invalid(
            "review row identity is required".to_string(),
        ));
    }
    if row.source_text.is_empty() || row.source_text.len() > REVIEW_MAX_CELL_BYTES {
        return Err(ReviewPackageError::Invalid(
            "review source cell is outside the supported size".to_string(),
        ));
    }
    if row.target_text.len() > REVIEW_MAX_CELL_BYTES {
        return Err(ReviewPackageError::Invalid(
            "review target cell is outside the supported size".to_string(),
        ));
    }
    if row.comments.len() > REVIEW_MAX_COMMENT_BYTES {
        return Err(ReviewPackageError::Invalid(
            "review comments are outside the supported size".to_string(),
        ));
    }
    if row.status.len() > 128 {
        return Err(ReviewPackageError::Invalid(
            "review status is outside the supported size".to_string(),
        ));
    }
    Ok(())
}

fn validate_manifest(manifest: &ReviewManifest) -> Result<(), ReviewPackageError> {
    if manifest.format_version != REVIEW_FORMAT_VERSION {
        return Err(ReviewPackageError::Invalid(
            "unsupported review manifest version".to_string(),
        ));
    }
    if manifest.rows.is_empty() || manifest.rows.len() > REVIEW_MAX_ROWS {
        return Err(ReviewPackageError::Invalid(
            "review manifest row count is outside the supported range".to_string(),
        ));
    }
    let expected_hash = manifest_hash(manifest)?;
    if expected_hash != manifest.manifest_hash {
        return Err(ReviewPackageError::Invalid(
            "review manifest digest is invalid".to_string(),
        ));
    }
    let mut ids = BTreeSet::new();
    let mut ordinals = BTreeSet::new();
    for row in &manifest.rows {
        if row.row_id.trim().is_empty()
            || row.segment_id.trim().is_empty()
            || !ids.insert(row.row_id.clone())
            || !ordinals.insert(row.ordinal)
            || row.source_hash.len() != 64
            || !row.source_hash.bytes().all(|byte| byte.is_ascii_hexdigit())
        {
            return Err(ReviewPackageError::Invalid(
                "review manifest row binding is invalid".to_string(),
            ));
        }
    }
    Ok(())
}

fn unsigned_manifest(manifest: &ReviewManifest) -> impl Serialize {
    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct Unsigned<'a> {
        format_version: u32,
        project_id: &'a str,
        document_id: &'a str,
        base_document_revision: u64,
        rows: &'a [ReviewManifestRow],
    }
    Unsigned {
        format_version: manifest.format_version,
        project_id: &manifest.project_id,
        document_id: &manifest.document_id,
        base_document_revision: manifest.base_document_revision,
        rows: &manifest.rows,
    }
}

fn render_document(
    input: &ReviewExportInput,
    manifest: &ReviewManifest,
) -> Result<Vec<u8>, ReviewPackageError> {
    let by_id = input
        .rows
        .iter()
        .map(|row| (row.row_id.as_str(), row))
        .collect::<BTreeMap<_, _>>();
    let mut rows = manifest.rows.clone();
    rows.sort_by_key(|row| row.ordinal);
    let mut bookmark_id = 1_u32;
    let mut body = String::new();
    body.push_str("<w:body><w:p><w:r><w:t>Translunar review</w:t></w:r></w:p><w:tbl>");
    body.push_str("<w:tblGrid><w:gridCol w:w=\"1800\"/><w:gridCol w:w=\"4500\"/><w:gridCol w:w=\"4500\"/></w:tblGrid>");
    for binding in rows {
        let row = by_id.get(binding.row_id.as_str()).ok_or_else(|| {
            ReviewPackageError::Invalid(
                "review manifest row is missing from export input".to_string(),
            )
        })?;
        body.push_str("<w:tr>");
        body.push_str("<w:tc><w:p><w:r><w:t>ID: </w:t></w:r>");
        body.push_str(&bookmark_pair(
            &mut bookmark_id,
            &bookmark_name(&row.row_id, "id"),
            &row.row_id,
        ));
        body.push_str("<w:br/><w:r><w:t>Status: </w:t></w:r>");
        body.push_str(&bookmark_pair(
            &mut bookmark_id,
            &bookmark_name(&row.row_id, "status"),
            &row.status,
        ));
        body.push_str("</w:p></w:tc>");
        body.push_str("<w:tc><w:p>");
        body.push_str(&bookmark_pair(
            &mut bookmark_id,
            &bookmark_name(&row.row_id, "source"),
            &row.source_text,
        ));
        body.push_str("</w:p></w:tc>");
        body.push_str("<w:tc><w:p>");
        body.push_str(&bookmark_pair(
            &mut bookmark_id,
            &bookmark_name(&row.row_id, "target"),
            &row.target_text,
        ));
        body.push_str("<w:br/><w:r><w:t>Comments: </w:t></w:r>");
        body.push_str(&bookmark_pair(
            &mut bookmark_id,
            &bookmark_name(&row.row_id, "comments"),
            &row.comments,
        ));
        body.push_str("</w:p></w:tc></w:tr>");
    }
    body.push_str("</w:tbl><w:sectPr/></w:body>");
    let _ = input;
    Ok(format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?><w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\">{body}</w:document>"
    )
    .into_bytes())
}

fn bookmark_pair(counter: &mut u32, name: &str, value: &str) -> String {
    let id = *counter;
    *counter = counter.saturating_add(1);
    format!(
        "<w:bookmarkStart w:id=\"{id}\" w:name=\"{name}\"/><w:r><w:t xml:space=\"preserve\">{}</w:t></w:r><w:bookmarkEnd w:id=\"{id}\"/>",
        escape_xml(value)
    )
}

fn write_package(document: &[u8], manifest: &[u8]) -> Result<Vec<u8>, ReviewPackageError> {
    let content_types = r#"<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/customXml/translunar-review.json" ContentType="application/json"/></Types>"#;
    let root_rels = r#"<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>"#;
    let document_rels = r#"<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXml" Target="../customXml/translunar-review.json"/></Relationships>"#;
    let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
    for (name, bytes) in [
        ("[Content_Types].xml", content_types.as_bytes()),
        ("_rels/.rels", root_rels.as_bytes()),
        ("word/document.xml", document),
        ("word/_rels/document.xml.rels", document_rels.as_bytes()),
        (REVIEW_MANIFEST_PART, manifest),
    ] {
        writer.start_file(name, options)?;
        writer.write_all(bytes)?;
    }
    Ok(writer.finish()?.into_inner())
}

fn validate_review_bytes(bytes: &[u8]) -> Result<(), ReviewPackageError> {
    let package = OfficePackage::from_bytes(bytes)?;
    for name in package.names() {
        if name.ends_with(".xml") || name.ends_with(".rels") {
            validate_xml(package.require(name)?, name)?;
        }
    }
    parse_review_package(&package)?;
    Ok(())
}

fn parse_table_rows(bytes: &[u8]) -> Result<Vec<ReviewTableRow>, ReviewPackageError> {
    let mut reader = Reader::from_reader(bytes);
    reader.config_mut().trim_text(false);
    let mut buffer = Vec::new();
    let mut table_depth = 0_u32;
    let mut row: Option<ReviewTableRowBuilder> = None;
    let mut rows = Vec::new();
    loop {
        match reader.read_event_into(&mut buffer) {
            Ok(Event::Start(element)) => match element.name().local_name().as_ref() {
                b"tbl" => {
                    table_depth = table_depth.saturating_add(1);
                    if table_depth > 1 {
                        return Err(ReviewPackageError::Invalid(
                            "nested review tables are unsupported".to_string(),
                        ));
                    }
                }
                b"tr" if table_depth == 1 && row.is_none() => {
                    row = Some(ReviewTableRowBuilder::default());
                }
                b"tc" if table_depth == 1 => {
                    if let Some(current) = row.as_mut() {
                        if current.in_cell {
                            return Err(ReviewPackageError::Invalid(
                                "nested review table cells are unsupported".to_string(),
                            ));
                        }
                        current.in_cell = true;
                        current.cell_text.clear();
                    }
                }
                b"bookmarkStart" => {
                    if let Some(current) = row.as_mut() {
                        let (id, name) = bookmark_attributes(&element, &reader)?;
                        if current.bookmark_ids.insert(id, name.clone()).is_some()
                            || current.bookmarks.contains_key(&name)
                        {
                            return Err(ReviewPackageError::Invalid(
                                "duplicate review bookmark".to_string(),
                            ));
                        }
                        current.bookmarks.insert(name.clone(), String::new());
                        current.active_bookmarks.push(name);
                    }
                }
                _ => {}
            },
            Ok(Event::Empty(element)) => {
                if let Some(current) = row.as_mut() {
                    match element.name().local_name().as_ref() {
                        b"bookmarkStart" => {
                            let (id, name) = bookmark_attributes(&element, &reader)?;
                            if current.bookmark_ids.insert(id, name.clone()).is_some()
                                || current.bookmarks.contains_key(&name)
                            {
                                return Err(ReviewPackageError::Invalid(
                                    "duplicate review bookmark".to_string(),
                                ));
                            }
                            current.bookmarks.insert(name.clone(), String::new());
                            current.active_bookmarks.push(name);
                        }
                        b"bookmarkEnd" => {
                            let id = bookmark_end_id(&element, &reader)?;
                            let name = current.bookmark_ids.remove(&id).ok_or_else(|| {
                                ReviewPackageError::Invalid(
                                    "review bookmark end has no start".to_string(),
                                )
                            })?;
                            current.active_bookmarks.retain(|value| value != &name);
                        }
                        _ if current.in_cell => match element.name().local_name().as_ref() {
                            b"br" | b"cr" => current.push_text("\n"),
                            b"tab" => current.push_text("\t"),
                            _ => {}
                        },
                        _ => {}
                    }
                }
            }
            Ok(Event::Text(value)) => {
                if let Some(current) = row.as_mut()
                    && current.in_cell
                {
                    current.push_text(
                        value
                            .decode()
                            .map_err(|error| ReviewPackageError::Invalid(error.to_string()))?
                            .as_ref(),
                    );
                }
            }
            Ok(Event::GeneralRef(reference)) => {
                if let Some(current) = row.as_mut()
                    && current.in_cell
                {
                    current.push_text(&decode_reference(&reference)?);
                }
            }
            Ok(Event::End(element)) => match element.name().local_name().as_ref() {
                b"tc" if table_depth == 1 => {
                    if let Some(current) = row.as_mut() {
                        if !current.in_cell {
                            return Err(ReviewPackageError::Invalid(
                                "review table cell ended before it started".to_string(),
                            ));
                        }
                        current.cells.push(std::mem::take(&mut current.cell_text));
                        current.in_cell = false;
                    }
                }
                b"tr" if table_depth == 1 => {
                    if let Some(current) = row.take() {
                        if current.in_cell || !current.bookmark_ids.is_empty() {
                            return Err(ReviewPackageError::Invalid(
                                "review row contains an unclosed cell or bookmark".to_string(),
                            ));
                        }
                        rows.push(ReviewTableRow {
                            cells: current.cells,
                            bookmarks: current.bookmarks,
                        });
                    }
                }
                b"tbl" => table_depth = table_depth.saturating_sub(1),
                _ => {}
            },
            Ok(Event::Eof) => break,
            Ok(_) => {}
            Err(error) => return Err(ReviewPackageError::Invalid(error.to_string())),
        }
        buffer.clear();
    }
    if table_depth != 0 || row.is_some() {
        return Err(ReviewPackageError::Invalid(
            "review table structure is incomplete".to_string(),
        ));
    }
    Ok(rows)
}

impl ReviewTableRowBuilder {
    fn push_text(&mut self, value: &str) {
        self.cell_text.push_str(value);
        for name in &self.active_bookmarks {
            if let Some(bookmark) = self.bookmarks.get_mut(name) {
                bookmark.push_str(value);
            }
        }
    }
}

fn bookmark_attributes(
    element: &quick_xml::events::BytesStart<'_>,
    reader: &Reader<&[u8]>,
) -> Result<(String, String), ReviewPackageError> {
    let mut id = None;
    let mut name = None;
    for attribute in element.attributes().with_checks(false) {
        let attribute =
            attribute.map_err(|error| ReviewPackageError::Invalid(error.to_string()))?;
        let value = attribute
            .decoded_and_normalized_value(quick_xml::XmlVersion::Implicit1_0, reader.decoder())
            .map_err(|error| ReviewPackageError::Invalid(error.to_string()))?
            .into_owned();
        match attribute.key.local_name().as_ref() {
            b"id" => id = Some(value),
            b"name" => name = Some(value),
            _ => {}
        }
    }
    Ok((
        id.ok_or_else(|| ReviewPackageError::Invalid("review bookmark has no id".to_string()))?,
        name.ok_or_else(|| ReviewPackageError::Invalid("review bookmark has no name".to_string()))?,
    ))
}

fn bookmark_end_id(
    element: &quick_xml::events::BytesStart<'_>,
    reader: &Reader<&[u8]>,
) -> Result<String, ReviewPackageError> {
    for attribute in element.attributes().with_checks(false) {
        let attribute =
            attribute.map_err(|error| ReviewPackageError::Invalid(error.to_string()))?;
        if attribute.key.local_name().as_ref() == b"id" {
            return Ok(attribute
                .decoded_and_normalized_value(quick_xml::XmlVersion::Implicit1_0, reader.decoder())
                .map_err(|error| ReviewPackageError::Invalid(error.to_string()))?
                .into_owned());
        }
    }
    Err(ReviewPackageError::Invalid(
        "review bookmark end has no id".to_string(),
    ))
}

fn parse_id_cell(value: Option<&str>) -> Option<String> {
    value?
        .lines()
        .next()?
        .strip_prefix("ID:")
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn bookmark_name(row_id: &str, field: &str) -> String {
    let digest = sha256_hex(row_id.as_bytes());
    format!("tl_{}_{}", &digest[..24], field)
}

fn bookmark_value_by_suffix(bookmarks: &BTreeMap<String, String>, suffix: &str) -> Option<String> {
    let mut values = bookmarks
        .iter()
        .filter(|(name, _)| name.ends_with(suffix))
        .map(|(_, value)| value.clone());
    let value = values.next()?;
    if values.next().is_some() {
        return None;
    }
    Some(value)
}

fn escape_xml(value: &str) -> String {
    quick_xml::escape::escape(value).into_owned()
}

#[cfg(test)]
mod tests {
    use std::io::Read;

    use super::*;

    fn input() -> ReviewExportInput {
        ReviewExportInput {
            project_id: "project-1".to_string(),
            document_id: "document-1".to_string(),
            base_document_revision: 4,
            rows: vec![
                ReviewExportRow {
                    row_id: "row-a".to_string(),
                    segment_id: "segment-a".to_string(),
                    segment_revision: 3,
                    ordinal: 1,
                    source_text: "Hello & world".to_string(),
                    target_text: "现有译文".to_string(),
                    status: "review".to_string(),
                    comments: "Keep tone".to_string(),
                },
                ReviewExportRow {
                    row_id: "row-b".to_string(),
                    segment_id: "segment-b".to_string(),
                    segment_revision: 7,
                    ordinal: 2,
                    source_text: "Second source".to_string(),
                    target_text: String::new(),
                    status: "translation".to_string(),
                    comments: String::new(),
                },
            ],
        }
    }

    #[test]
    fn builds_and_reparses_three_column_review_with_stable_manifest_hash() {
        let (bytes, manifest) = build_review_docx(&input()).expect("build review package");
        let parsed = parse_review_bytes(&bytes).expect("parse review package");
        assert_eq!(parsed.manifest, manifest);
        assert_eq!(parsed.rows.len(), 2);
        assert_eq!(parsed.rows[0].source_text, "Hello & world");
        assert_eq!(parsed.rows[0].target_text, "现有译文");
        assert!(parsed.rows[0].source_hash_valid);
        assert_eq!(parsed.rows[0].comments, "Keep tone");
        assert_eq!(parsed.rows[1].target_text, "");
    }

    #[test]
    fn target_and_comment_edits_do_not_change_manifest_digest() {
        let (bytes, manifest) = build_review_docx(&input()).expect("build review package");
        let before = manifest.manifest_hash.clone();
        let bytes = rewrite_part(&bytes, "word/document.xml", |bytes| {
            replace_bytes(bytes, "现有译文".as_bytes(), "新译文".as_bytes())
        });
        let parsed = parse_review_bytes(&bytes).expect("parse edited package");
        assert_eq!(parsed.manifest.manifest_hash, before);
        assert_eq!(parsed.rows[0].target_text, "新译文");
    }

    #[test]
    fn source_tamper_is_reported_on_the_row_and_manifest_tamper_is_rejected() {
        let (bytes, _) = build_review_docx(&input()).expect("build review package");
        let bytes = rewrite_part(&bytes, "word/document.xml", |bytes| {
            replace_bytes(bytes, b"Hello &amp; world", b"Tampered")
        });
        let parsed = parse_review_bytes(&bytes).expect("parse tampered source");
        assert!(!parsed.rows[0].source_hash_valid);
        assert!(
            parsed.rows[0]
                .diagnostics
                .iter()
                .any(|item| item.contains("hash"))
        );

        let (bytes, manifest) = build_review_docx(&input()).expect("build review package");
        let tampered = rewrite_part(&bytes, REVIEW_MANIFEST_PART, |mut bytes| {
            let marker = manifest.manifest_hash.as_bytes();
            let index = bytes
                .windows(marker.len())
                .position(|window| window == marker)
                .expect("manifest hash");
            bytes[index] = if bytes[index] == b'0' { b'1' } else { b'0' };
            bytes
        });
        assert!(parse_review_bytes(&tampered).is_err());
    }

    #[test]
    fn duplicate_missing_and_malformed_review_markers_are_rejected_or_diagnosed() {
        let (bytes, _) = build_review_docx(&input()).expect("build review package");
        let duplicate_row = rewrite_part(&bytes, "word/document.xml", |bytes| {
            replace_bytes(bytes, b">row-b<", b">row-a<")
        });
        assert!(matches!(
            parse_review_bytes(&duplicate_row),
            Err(ReviewPackageError::Invalid(message))
                if message == "review package contains duplicate row identity"
        ));

        let id_name = bookmark_name("row-a", "id");
        let status_name = bookmark_name("row-a", "status");
        let duplicate_bookmark = rewrite_part(&bytes, "word/document.xml", |bytes| {
            replace_bytes(bytes, status_name.as_bytes(), id_name.as_bytes())
        });
        assert!(matches!(
            parse_review_bytes(&duplicate_bookmark),
            Err(ReviewPackageError::Invalid(message))
                if message == "duplicate review bookmark"
        ));

        let missing_names = [
            (
                bookmark_name("row-a", "id"),
                "row identity bookmark is missing",
            ),
            (
                bookmark_name("row-a", "status"),
                "status bookmark is missing",
            ),
            (
                bookmark_name("row-a", "source"),
                "source bookmark is missing",
            ),
            (
                bookmark_name("row-a", "target"),
                "target bookmark is missing",
            ),
            (
                bookmark_name("row-a", "comments"),
                "comments bookmark is missing",
            ),
        ];
        let missing_markers = rewrite_part(&bytes, "word/document.xml", |bytes| {
            missing_names.iter().fold(bytes, |bytes, (name, _)| {
                replace_bytes(bytes, name.as_bytes(), format!("{name}_removed").as_bytes())
            })
        });
        let parsed = parse_review_bytes(&missing_markers).expect("parse missing markers");
        let row = parsed
            .rows
            .iter()
            .find(|row| row.row_id == "row-a")
            .expect("row with missing markers");
        for (_, diagnostic) in missing_names {
            assert!(
                row.diagnostics.iter().any(|item| item == diagnostic),
                "missing diagnostic: {diagnostic}"
            );
        }

        let malformed = rewrite_part(&bytes, "word/document.xml", |bytes| {
            replace_bytes(bytes, b"</w:document>", b"")
        });
        assert!(parse_review_bytes(&malformed).is_err());
    }

    #[test]
    fn export_is_no_clobber() {
        let temp = tempfile::tempdir().expect("temporary directory");
        let output = temp.path().join("review.docx");
        export_review_docx(&input(), &output).expect("publish review package");
        assert!(export_review_docx(&input(), &output).is_err());
    }

    fn rewrite_part(
        bytes: &[u8],
        part: &str,
        transform: impl FnOnce(Vec<u8>) -> Vec<u8>,
    ) -> Vec<u8> {
        let mut archive = zip::ZipArchive::new(Cursor::new(bytes)).expect("read review ZIP");
        let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
        let mut transform = Some(transform);
        for index in 0..archive.len() {
            let mut entry = archive.by_index(index).expect("read review entry");
            if entry.name() == part {
                let name = entry.name().to_string();
                let options = entry.options();
                let mut content = Vec::new();
                entry.read_to_end(&mut content).expect("read review part");
                writer
                    .start_file(name, options)
                    .expect("start changed part");
                let changed = transform.take().expect("single changed part")(content);
                writer.write_all(&changed).expect("write changed part");
            } else {
                writer.raw_copy_file(entry).expect("copy review part");
            }
        }
        assert!(transform.is_none(), "review part must exist");
        writer.finish().expect("finish review ZIP").into_inner()
    }

    fn replace_bytes(mut bytes: Vec<u8>, old: &[u8], replacement: &[u8]) -> Vec<u8> {
        let start = bytes
            .windows(old.len())
            .position(|window| window == old)
            .expect("bytes to replace");
        bytes.splice(start..start + old.len(), replacement.iter().copied());
        bytes
    }
}

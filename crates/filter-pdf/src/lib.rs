//! Bounded PDF extraction, OCR, layout projection, and DOCX reconstruction.

use std::collections::BTreeMap;
use std::env;
use std::fs::{self, File};
use std::io::{Cursor, Read, Write};
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

use quick_xml::Reader;
use quick_xml::escape::unescape;
use quick_xml::events::Event;
use tempfile::NamedTempFile;
use thiserror::Error;
use translunar_domain::{DegradationFinding, DegradationSeverity, DocumentNote, Segment};
use translunar_filter_core::{
    DocumentFilter, DocumentMetadata, ExportReport, ExportRequest, FilterCapabilities,
    FilterDescriptor, FilterError, FilterEvent, FilterEventStream, ImportRequest, ProbeResult,
    ValidationReport, publish_bytes_noclobber,
};
use translunar_filter_docx::DocxFilter;
use translunar_segmentation_srx::{SegmentationMode, SrxRules};
use zip::CompressionMethod;
use zip::write::{SimpleFileOptions, ZipWriter};

const PDF_HEADER: &[u8] = b"%PDF-";
const DEFAULT_TIMEOUT_MS: u64 = 60_000;
const MAX_TIMEOUT_MS: u64 = 300_000;
const MAX_TOOL_OUTPUT: usize = 128 * 1024 * 1024;
const MAX_PDF_BYTES: u64 = 512 * 1024 * 1024;
const MAX_PAGES: u32 = 2_000;

#[derive(Debug, Error)]
pub enum PdfError {
    #[error("PDF I/O failed: {0}")]
    Io(#[from] std::io::Error),
    #[error("unsupported PDF: {0}")]
    Unsupported(String),
    #[error("invalid PDF: {0}")]
    Invalid(String),
    #[error("PDF tool {tool} is unavailable")]
    ToolUnavailable { tool: String },
    #[error("PDF tool {tool} failed ({status})")]
    ToolFailed { tool: String, status: String },
    #[error("PDF tool {tool} timed out")]
    ToolTimeout { tool: String },
    #[error("PDF tool {tool} output exceeded the configured limit")]
    ToolOutputLimit { tool: String },
    #[error("invalid PDF tool output: {0}")]
    ToolOutput(String),
    #[error("invalid PDF filter options: {0}")]
    Options(String),
    #[error("DOCX reconstruction failed: {0}")]
    Export(String),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OcrMode {
    Auto,
    Always,
    Never,
}

impl OcrMode {
    fn parse(value: Option<&str>) -> Result<Self, PdfError> {
        match value.map(str::trim).map(str::to_ascii_lowercase).as_deref() {
            None | Some("") | Some("auto") => Ok(Self::Auto),
            Some("always") => Ok(Self::Always),
            Some("never") => Ok(Self::Never),
            Some(value) => Err(PdfError::Options(format!(
                "ocrMode must be auto, always, or never (got {value})"
            ))),
        }
    }
}

#[derive(Debug, Clone)]
struct PdfOptions {
    page_start: u32,
    page_end: Option<u32>,
    segmentation_mode: SegmentationMode,
    locale: String,
    ocr_mode: OcrMode,
    ocr_languages: String,
    ocr_dpi: u32,
    timeout: Duration,
    pdftotext: String,
    pdfinfo: String,
    pdftoppm: String,
    tesseract: String,
}

impl PdfOptions {
    fn from_request(request: &ImportRequest) -> Result<Self, PdfError> {
        let options = &request.options;
        let (page_start, page_end) = parse_page_range(options.get("pageRange"))?;
        let timeout_ms = parse_number(
            options.get("toolTimeoutMs"),
            DEFAULT_TIMEOUT_MS,
            1_000,
            MAX_TIMEOUT_MS,
            "toolTimeoutMs",
        )?;
        let ocr_dpi = parse_number(options.get("ocrDpi"), 200, 72, 600, "ocrDpi")? as u32;
        let ocr_languages = options
            .get("ocrLanguages")
            .cloned()
            .unwrap_or_else(|| "eng".to_string());
        if ocr_languages.is_empty()
            || ocr_languages.len() > 64
            || !ocr_languages
                .chars()
                .all(|character| character.is_ascii_alphanumeric() || "+_-".contains(character))
        {
            return Err(PdfError::Options(
                "ocrLanguages contains unsupported characters".to_string(),
            ));
        }
        Ok(Self {
            page_start,
            page_end,
            segmentation_mode: SegmentationMode::parse(
                options.get("segmentationMode").map(String::as_str),
            ),
            locale: request
                .source_locale
                .clone()
                .unwrap_or_else(|| "en".to_string()),
            ocr_mode: OcrMode::parse(options.get("ocrMode").map(String::as_str))?,
            ocr_languages,
            ocr_dpi,
            timeout: Duration::from_millis(timeout_ms),
            pdftotext: resolve_tool(
                options,
                "pdfTextCommand",
                "TRANSLUNAR_PDFTOTEXT_PATH",
                "pdftotext",
            )?,
            pdfinfo: resolve_tool(
                options,
                "pdfInfoCommand",
                "TRANSLUNAR_PDFINFO_PATH",
                "pdfinfo",
            )?,
            pdftoppm: resolve_tool(
                options,
                "pdfRenderCommand",
                "TRANSLUNAR_PDFTOPPM_PATH",
                "pdftoppm",
            )?,
            tesseract: resolve_tool(
                options,
                "ocrCommand",
                "TRANSLUNAR_TESSERACT_PATH",
                "tesseract",
            )?,
        })
    }

    fn page_range(&self, page_count: u32) -> Result<std::ops::RangeInclusive<u32>, PdfError> {
        let end = self.page_end.unwrap_or(page_count);
        if self.page_start == 0
            || self.page_start > page_count
            || end < self.page_start
            || end > page_count
        {
            return Err(PdfError::Options(format!(
                "pageRange is outside the PDF page count {page_count}"
            )));
        }
        Ok(self.page_start..=end)
    }
}

fn parse_page_range(value: Option<&String>) -> Result<(u32, Option<u32>), PdfError> {
    let Some(value) = value else {
        return Ok((1, None));
    };
    let value = value.trim();
    if value.is_empty() {
        return Ok((1, None));
    }
    let mut parts = value.split('-');
    let start = parts
        .next()
        .and_then(|part| part.parse::<u32>().ok())
        .filter(|value| *value > 0)
        .ok_or_else(|| PdfError::Options("pageRange must be N or N-M".to_string()))?;
    let end = parts
        .next()
        .map(|part| part.parse::<u32>())
        .transpose()
        .map_err(|_| PdfError::Options("pageRange must be N or N-M".to_string()))?;
    if parts.next().is_some() || end.is_some_and(|value| value == 0) {
        return Err(PdfError::Options("pageRange must be N or N-M".to_string()));
    }
    Ok((start, end))
}

fn parse_number(
    value: Option<&String>,
    default: u64,
    min: u64,
    max: u64,
    name: &str,
) -> Result<u64, PdfError> {
    let Some(value) = value else {
        return Ok(default);
    };
    let value = value
        .parse::<u64>()
        .map_err(|_| PdfError::Options(format!("{name} must be an integer")))?;
    if !(min..=max).contains(&value) {
        return Err(PdfError::Options(format!("{name} must be in {min}..{max}")));
    }
    Ok(value)
}

fn resolve_tool(
    options: &BTreeMap<String, String>,
    option_name: &str,
    environment_name: &str,
    fallback: &str,
) -> Result<String, PdfError> {
    let value = options
        .get(option_name)
        .cloned()
        .or_else(|| env::var(environment_name).ok())
        .unwrap_or_else(|| fallback.to_string());
    if value.trim().is_empty() || value.len() > 4096 || value.contains('\0') {
        return Err(PdfError::Options(format!("{option_name} is invalid")));
    }
    Ok(value)
}

#[derive(Debug, Clone, PartialEq)]
struct BBox {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

impl BBox {
    fn right(&self) -> f64 {
        self.x + self.width
    }

    fn union<'a>(items: impl IntoIterator<Item = &'a BBox>) -> Option<Self> {
        let mut items = items.into_iter();
        let first = items.next()?.clone();
        let mut left = first.x;
        let mut top = first.y;
        let mut right = first.x + first.width;
        let mut bottom = first.y + first.height;
        for item in items {
            left = left.min(item.x);
            top = top.min(item.y);
            right = right.max(item.x + item.width);
            bottom = bottom.max(item.y + item.height);
        }
        Some(Self {
            x: left,
            y: top,
            width: right - left,
            height: bottom - top,
        })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SourceKind {
    Text,
    Ocr,
}

impl SourceKind {
    fn as_str(self) -> &'static str {
        match self {
            Self::Text => "text",
            Self::Ocr => "ocr",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum BlockKind {
    Paragraph,
    Heading,
    Table,
}

impl BlockKind {
    fn as_str(self) -> &'static str {
        match self {
            Self::Paragraph => "paragraph",
            Self::Heading => "heading",
            Self::Table => "table",
        }
    }
}

#[derive(Debug, Clone)]
struct PdfBlock {
    bbox: BBox,
    font_height: f64,
    text: String,
    page_width: f64,
    page_height: f64,
    source_kind: SourceKind,
    confidence: u16,
    kind: BlockKind,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PdfPath {
    pub page: u32,
    pub order: u32,
    pub kind: String,
    pub x: i64,
    pub y: i64,
    pub width: i64,
    pub height: i64,
    pub source_kind: String,
    pub confidence: u16,
}

impl PdfPath {
    pub fn encode(&self) -> String {
        format!(
            "pdf:p={};b={};k={};x={};y={};w={};h={};s={};c={}",
            self.page,
            self.order,
            self.kind,
            self.x,
            self.y,
            self.width,
            self.height,
            self.source_kind,
            self.confidence
        )
    }

    pub fn decode(value: &str) -> Result<Self, PdfError> {
        let rest = value
            .strip_prefix("pdf:")
            .ok_or_else(|| PdfError::Invalid("not a PDF structural path".to_string()))?;
        let mut fields = BTreeMap::new();
        for field in rest.split(';') {
            let (key, value) = field
                .split_once('=')
                .ok_or_else(|| PdfError::Invalid("malformed PDF path".to_string()))?;
            fields.insert(key, value);
        }
        let field = |key: &str| {
            fields
                .get(key)
                .copied()
                .ok_or_else(|| PdfError::Invalid(format!("path field {key} missing")))
        };
        Ok(Self {
            page: parse_path_number(field("p")?, "page")?,
            order: parse_path_number(field("b")?, "order")?,
            kind: field("k")?.to_string(),
            x: parse_path_number(field("x")?, "x")?,
            y: parse_path_number(field("y")?, "y")?,
            width: parse_path_number(field("w")?, "width")?,
            height: parse_path_number(field("h")?, "height")?,
            source_kind: field("s")?.to_string(),
            confidence: parse_path_number(field("c")?, "confidence")?,
        })
    }
}

fn parse_path_number<T: std::str::FromStr>(value: &str, name: &str) -> Result<T, PdfError> {
    value
        .parse()
        .map_err(|_| PdfError::Invalid(format!("invalid PDF path {name}")))
}

#[derive(Debug, Clone, PartialEq)]
pub struct PdfPageSummary {
    pub page: u32,
    pub width: f64,
    pub height: f64,
    pub has_text_layer: bool,
    pub block_count: u32,
}

#[derive(Debug, Clone, PartialEq)]
pub struct PdfBlockProjection {
    pub path: String,
    pub bbox: (f64, f64, f64, f64),
    pub kind: String,
    pub source_kind: String,
    pub confidence: u16,
    pub source_text: String,
}

#[derive(Debug, Clone, Copy)]
struct PdfInfo {
    pages: u32,
    width: f64,
    height: f64,
}

#[derive(Debug, Clone, Copy)]
pub struct PdfFilter;

fn validate_header(source: &Path) -> Result<(), PdfError> {
    let metadata = fs::metadata(source)?;
    if metadata.len() == 0 || metadata.len() > MAX_PDF_BYTES {
        return Err(PdfError::Unsupported(
            "PDF size is outside supported bounds".to_string(),
        ));
    }
    let mut file = File::open(source)?;
    let mut header = [0_u8; 5];
    file.read_exact(&mut header)?;
    if header != PDF_HEADER {
        return Err(PdfError::Invalid("missing PDF header".to_string()));
    }
    Ok(())
}

fn read_pdf_info(options: &PdfOptions, source: &Path) -> Result<PdfInfo, PdfError> {
    let output = run_tool(
        &options.pdfinfo,
        &[source.to_string_lossy().as_ref()],
        options.timeout,
        "pdfinfo",
    )?;
    let text = String::from_utf8(output)
        .map_err(|_| PdfError::ToolOutput("pdfinfo output was not UTF-8".to_string()))?;
    let mut pages = None;
    let mut width = 595.276;
    let mut height = 841.89;
    let mut encrypted = false;
    for line in text.lines() {
        let Some((key, value)) = line.split_once(':') else {
            continue;
        };
        match key.trim() {
            "Pages" => pages = value.trim().parse().ok(),
            "Page size" => {
                let mut values = value.split_whitespace();
                width = values
                    .next()
                    .and_then(|value| value.parse().ok())
                    .unwrap_or(width);
                height = values
                    .next()
                    .and_then(|value| value.parse().ok())
                    .unwrap_or(height);
            }
            "Encrypted" => encrypted = value.trim().eq_ignore_ascii_case("yes"),
            _ => {}
        }
    }
    let pages =
        pages.ok_or_else(|| PdfError::ToolOutput("pdfinfo omitted page count".to_string()))?;
    if pages == 0 || pages > MAX_PAGES {
        return Err(PdfError::Unsupported(
            "PDF page count is outside supported bounds".to_string(),
        ));
    }
    if encrypted {
        return Err(PdfError::Unsupported(
            "encrypted PDFs are not supported".to_string(),
        ));
    }
    Ok(PdfInfo {
        pages,
        width,
        height,
    })
}

fn run_tool(
    program: &str,
    arguments: &[&str],
    timeout: Duration,
    tool: &str,
) -> Result<Vec<u8>, PdfError> {
    let stdout = NamedTempFile::new()?;
    let stderr = NamedTempFile::new()?;
    let mut command = Command::new(program);
    command
        .args(arguments)
        .stdin(Stdio::null())
        .stdout(Stdio::from(stdout.reopen()?))
        .stderr(Stdio::from(stderr.reopen()?));
    let mut child = command.spawn().map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            PdfError::ToolUnavailable {
                tool: tool.to_string(),
            }
        } else {
            PdfError::Io(error)
        }
    })?;
    let started = Instant::now();
    loop {
        if let Some(status) = child.try_wait()? {
            if !status.success() {
                return Err(PdfError::ToolFailed {
                    tool: tool.to_string(),
                    status: status
                        .code()
                        .map_or_else(|| "signal".to_string(), |value| value.to_string()),
                });
            }
            let output = fs::read(stdout.path())?;
            if output.len() > MAX_TOOL_OUTPUT {
                return Err(PdfError::ToolOutputLimit {
                    tool: tool.to_string(),
                });
            }
            return Ok(output);
        }
        if stdout.as_file().metadata()?.len() > MAX_TOOL_OUTPUT as u64
            || stderr.as_file().metadata()?.len() > MAX_TOOL_OUTPUT as u64
        {
            kill_child(&mut child);
            return Err(PdfError::ToolOutputLimit {
                tool: tool.to_string(),
            });
        }
        if started.elapsed() >= timeout {
            kill_child(&mut child);
            return Err(PdfError::ToolTimeout {
                tool: tool.to_string(),
            });
        }
        thread::sleep(Duration::from_millis(10));
    }
}

fn kill_child(child: &mut Child) {
    let _ = child.kill();
    let _ = child.wait();
}

fn extract_text_pages(
    options: &PdfOptions,
    source: &Path,
) -> Result<BTreeMap<u32, Vec<PdfBlock>>, PdfError> {
    let temporary = tempfile::tempdir()?;
    let output_path = temporary.path().join("layout.xml");
    let output_path_text = output_path.to_string_lossy().to_string();
    run_tool(
        &options.pdftotext,
        &[
            "-bbox-layout",
            "-enc",
            "UTF-8",
            source.to_string_lossy().as_ref(),
            &output_path_text,
        ],
        options.timeout,
        "pdftotext",
    )?;
    let bytes = fs::read(output_path)?;
    if bytes.len() > MAX_TOOL_OUTPUT {
        return Err(PdfError::ToolOutputLimit {
            tool: "pdftotext".to_string(),
        });
    }
    parse_bbox_layout(&bytes)
}

fn parse_bbox_layout(bytes: &[u8]) -> Result<BTreeMap<u32, Vec<PdfBlock>>, PdfError> {
    let mut reader = Reader::from_reader(Cursor::new(bytes));
    reader.config_mut().trim_text(false);
    let mut buffer = Vec::new();
    let mut pages = BTreeMap::<u32, Vec<PdfBlock>>::new();
    let mut page = 0_u32;
    let mut page_width = 595.276;
    let mut page_height = 841.89;
    let mut block: Option<(BBox, Vec<String>)> = None;
    let mut word_text = false;
    loop {
        match reader.read_event_into(&mut buffer) {
            Ok(Event::Start(element)) => match local_name(element.name().as_ref()).as_str() {
                "page" => {
                    page = page
                        .checked_add(1)
                        .ok_or_else(|| PdfError::ToolOutput("page count overflow".to_string()))?;
                    let attributes = xml_attributes(&reader, &element)?;
                    page_width = attribute_number(&attributes, "width").unwrap_or(page_width);
                    page_height = attribute_number(&attributes, "height").unwrap_or(page_height);
                }
                "block" => {
                    let attributes = xml_attributes(&reader, &element)?;
                    block = Some((bbox_from_attributes(&attributes)?, Vec::new()));
                }
                "word" => word_text = true,
                _ => {}
            },
            Ok(Event::Text(text)) if word_text => {
                if let Some((_, words)) = block.as_mut() {
                    let value = text
                        .decode()
                        .map_err(|error| PdfError::ToolOutput(error.to_string()))?;
                    let value = unescape(&value)
                        .map_err(|error| PdfError::ToolOutput(error.to_string()))?;
                    let value = value.trim();
                    if !value.is_empty() {
                        words.push(value.to_string());
                    }
                }
            }
            Ok(Event::End(element)) => match local_name(element.name().as_ref()).as_str() {
                "word" => word_text = false,
                "block" => {
                    if let Some((bbox, words)) = block.take() {
                        let text = words.join(" ");
                        if meaningful_text(&text) {
                            let font_height = bbox.height;
                            pages.entry(page).or_default().push(PdfBlock {
                                bbox,
                                font_height,
                                text,
                                page_width,
                                page_height,
                                source_kind: SourceKind::Text,
                                confidence: 1000,
                                kind: BlockKind::Paragraph,
                            });
                        }
                    }
                }
                _ => {}
            },
            Ok(Event::Eof) => break,
            Err(error) => {
                return Err(PdfError::ToolOutput(format!(
                    "bbox XML parse failed: {error}"
                )));
            }
            _ => {}
        }
        buffer.clear();
    }
    if page == 0 {
        return Err(PdfError::ToolOutput(
            "bbox output contains no pages".to_string(),
        ));
    }
    Ok(pages)
}

fn xml_attributes(
    reader: &Reader<Cursor<&[u8]>>,
    element: &quick_xml::events::BytesStart<'_>,
) -> Result<BTreeMap<String, String>, PdfError> {
    let mut values = BTreeMap::new();
    for attribute in element.attributes().with_checks(false) {
        let attribute = attribute.map_err(|error| PdfError::ToolOutput(error.to_string()))?;
        let key = String::from_utf8_lossy(attribute.key.as_ref()).to_string();
        let value = attribute
            .decoded_and_normalized_value(quick_xml::XmlVersion::Implicit1_0, reader.decoder())
            .map_err(|error| PdfError::ToolOutput(error.to_string()))?;
        values.insert(key, value.into_owned());
    }
    Ok(values)
}

fn attribute_number(values: &BTreeMap<String, String>, name: &str) -> Option<f64> {
    values.get(name).and_then(|value| value.parse().ok())
}

fn bbox_from_attributes(values: &BTreeMap<String, String>) -> Result<BBox, PdfError> {
    let required = |name: &str| {
        attribute_number(values, name)
            .ok_or_else(|| PdfError::ToolOutput(format!("bbox missing {name}")))
    };
    let left = required("xMin")?;
    let top = required("yMin")?;
    let right = required("xMax")?;
    let bottom = required("yMax")?;
    if right < left || bottom < top {
        return Err(PdfError::ToolOutput(
            "bbox coordinates are reversed".to_string(),
        ));
    }
    Ok(BBox {
        x: left,
        y: top,
        width: right - left,
        height: bottom - top,
    })
}

fn local_name(value: &[u8]) -> String {
    String::from_utf8_lossy(value)
        .rsplit(':')
        .next()
        .unwrap_or_default()
        .to_string()
}

fn meaningful_text(value: &str) -> bool {
    value.chars().any(char::is_alphanumeric)
}

fn order_blocks(mut blocks: Vec<PdfBlock>) -> Vec<PdfBlock> {
    if blocks.is_empty() {
        return blocks;
    }
    blocks.sort_by(|left, right| {
        left.bbox
            .y
            .total_cmp(&right.bbox.y)
            .then_with(|| left.bbox.x.total_cmp(&right.bbox.x))
    });
    let page_width = blocks[0].page_width;
    let page_height = blocks[0].page_height;
    let source_kind = blocks[0].source_kind;
    let confidence = blocks[0].confidence;
    let mut rows: Vec<Vec<PdfBlock>> = Vec::new();
    for block in blocks {
        if let Some(row) = rows
            .iter_mut()
            .find(|row| (row[0].bbox.y - block.bbox.y).abs() <= 2.5)
        {
            row.push(block);
        } else {
            rows.push(vec![block]);
        }
    }
    let mut table_rows = Vec::new();
    let mut regular = Vec::new();
    for mut row in rows {
        row.sort_by(|left, right| left.bbox.x.total_cmp(&right.bbox.x));
        let span = row.last().map(|block| block.bbox.right()).unwrap_or(0.0)
            - row.first().map(|block| block.bbox.x).unwrap_or(0.0);
        if row.len() >= 3 && span > page_width * 0.45 {
            let bbox = BBox::union(row.iter().map(|block| &block.bbox))
                .unwrap_or_else(|| row[0].bbox.clone());
            let font_height =
                row.iter().map(|block| block.font_height).sum::<f64>() / row.len() as f64;
            table_rows.push(PdfBlock {
                bbox,
                font_height,
                text: row
                    .into_iter()
                    .map(|block| block.text)
                    .collect::<Vec<_>>()
                    .join(" | "),
                page_width,
                page_height,
                source_kind,
                confidence,
                kind: BlockKind::Table,
            });
        } else {
            regular.extend(row);
        }
    }
    let average_height =
        regular.iter().map(|block| block.font_height).sum::<f64>() / regular.len().max(1) as f64;
    let mut headings = Vec::new();
    let mut left = Vec::new();
    let mut right = Vec::new();
    let mut middle = Vec::new();
    for block in regular {
        if block.bbox.y < 105.0 && block.font_height > average_height * 1.25 {
            headings.push(PdfBlock {
                kind: BlockKind::Heading,
                ..block
            });
        } else if block.bbox.right() < page_width * 0.48 {
            left.push(block);
        } else if block.bbox.x > page_width * 0.52 {
            right.push(block);
        } else {
            middle.push(block);
        }
    }
    let sort = |items: &mut Vec<PdfBlock>| {
        items.sort_by(|left, right| {
            left.bbox
                .y
                .total_cmp(&right.bbox.y)
                .then_with(|| left.bbox.x.total_cmp(&right.bbox.x))
        });
    };
    sort(&mut headings);
    sort(&mut left);
    sort(&mut right);
    sort(&mut middle);
    sort(&mut table_rows);
    let columns = left.len() >= 2 && right.len() >= 2;
    let mut ordered = headings;
    if columns {
        ordered.extend(left);
        ordered.extend(right);
        ordered.extend(middle);
    } else {
        let mut body = left;
        body.extend(right);
        body.extend(middle);
        sort(&mut body);
        ordered.extend(body);
    }
    ordered.extend(table_rows);
    ordered
}

fn milli(value: f64) -> i64 {
    (value * 1000.0).round() as i64
}

fn path_for(page: u32, order: u32, block: &PdfBlock) -> PdfPath {
    PdfPath {
        page,
        order,
        kind: block.kind.as_str().to_string(),
        x: milli(block.bbox.x),
        y: milli(block.bbox.y),
        width: milli(block.bbox.width),
        height: milli(block.bbox.height),
        source_kind: block.source_kind.as_str().to_string(),
        confidence: block.confidence,
    }
}

#[derive(Debug)]
struct OcrWord {
    block: u32,
    paragraph: u32,
    line: u32,
    word: u32,
    text: String,
    bbox: BBox,
    confidence: u16,
}

fn ocr_page(
    options: &PdfOptions,
    source: &Path,
    page: u32,
    info: PdfInfo,
) -> Result<Vec<PdfBlock>, PdfError> {
    let temporary = tempfile::tempdir()?;
    let prefix = temporary.path().join("page");
    run_tool(
        &options.pdftoppm,
        &[
            "-png",
            "-f",
            &page.to_string(),
            "-l",
            &page.to_string(),
            "-r",
            &options.ocr_dpi.to_string(),
            "-singlefile",
            source.to_string_lossy().as_ref(),
            prefix.to_string_lossy().as_ref(),
        ],
        options.timeout,
        "pdftoppm",
    )?;
    let image = prefix.with_extension("png");
    if !image.exists() {
        return Err(PdfError::ToolOutput(
            "pdftoppm produced no OCR image".to_string(),
        ));
    }
    let tsv = run_tool(
        &options.tesseract,
        &[
            image.to_string_lossy().as_ref(),
            "stdout",
            "-l",
            &options.ocr_languages,
            "tsv",
        ],
        options.timeout,
        "tesseract",
    )?;
    parse_tsv(&tsv, info.width, info.height)
}

fn parse_tsv(bytes: &[u8], page_width: f64, page_height: f64) -> Result<Vec<PdfBlock>, PdfError> {
    let mut reader = csv::ReaderBuilder::new()
        .delimiter(b'\t')
        .has_headers(true)
        .from_reader(bytes);
    let headers = reader
        .headers()
        .map_err(|error| PdfError::ToolOutput(error.to_string()))?
        .clone();
    let column = |name: &str| {
        headers
            .iter()
            .position(|value| value == name)
            .ok_or_else(|| PdfError::ToolOutput(format!("TSV missing {name}")))
    };
    let level = column("level")?;
    let block = column("block_num")?;
    let paragraph = column("par_num")?;
    let line = column("line_num")?;
    let word = column("word_num")?;
    let left = column("left")?;
    let top = column("top")?;
    let width = column("width")?;
    let height = column("height")?;
    let confidence = column("conf")?;
    let text = column("text")?;
    let mut words = Vec::new();
    let mut pixel_width = 0.0_f64;
    let mut pixel_height = 0.0_f64;
    for record in reader.records() {
        let record = record.map_err(|error| PdfError::ToolOutput(error.to_string()))?;
        let number = |index: usize| {
            record
                .get(index)
                .and_then(|value| value.parse::<u32>().ok())
                .ok_or_else(|| PdfError::ToolOutput("invalid TSV number".to_string()))
        };
        if record.get(level) == Some("1") {
            pixel_width = f64::from(number(width)?);
            pixel_height = f64::from(number(height)?);
            continue;
        }
        if record.get(level) != Some("5") {
            continue;
        }
        let value = record.get(text).unwrap_or_default().trim();
        if value.is_empty() {
            continue;
        }
        let x = number(left)?;
        let y = number(top)?;
        let width = number(width)?;
        let height = number(height)?;
        let confidence = record
            .get(confidence)
            .and_then(|value| value.parse::<f64>().ok())
            .unwrap_or(-1.0);
        if confidence < 0.0 {
            continue;
        }
        pixel_width = pixel_width.max(f64::from(x + width));
        pixel_height = pixel_height.max(f64::from(y + height));
        words.push(OcrWord {
            block: number(block)?,
            paragraph: number(paragraph)?,
            line: number(line)?,
            word: number(word)?,
            text: value.to_string(),
            bbox: BBox {
                x: f64::from(x),
                y: f64::from(y),
                width: f64::from(width),
                height: f64::from(height),
            },
            confidence: (confidence.clamp(0.0, 100.0) * 10.0).round() as u16,
        });
    }
    let scale_x = page_width / pixel_width.max(1.0);
    let scale_y = page_height / pixel_height.max(1.0);
    let mut groups = BTreeMap::<(u32, u32), Vec<OcrWord>>::new();
    for word in words {
        groups
            .entry((word.block, word.paragraph))
            .or_default()
            .push(word);
    }
    let mut blocks = Vec::new();
    for (_, mut words) in groups {
        words.sort_by_key(|word| (word.line, word.word));
        let bbox = BBox::union(words.iter().map(|word| &word.bbox))
            .unwrap_or_else(|| words[0].bbox.clone());
        let confidence = words
            .iter()
            .map(|word| u32::from(word.confidence))
            .sum::<u32>()
            / words.len() as u32;
        let font_height =
            words.iter().map(|word| word.bbox.height).sum::<f64>() / words.len() as f64 * scale_y;
        blocks.push(PdfBlock {
            bbox: BBox {
                x: bbox.x * scale_x,
                y: bbox.y * scale_y,
                width: bbox.width * scale_x,
                height: bbox.height * scale_y,
            },
            font_height,
            text: words
                .iter()
                .map(|word| word.text.as_str())
                .collect::<Vec<_>>()
                .join(" "),
            page_width,
            page_height,
            source_kind: SourceKind::Ocr,
            confidence: confidence as u16,
            kind: BlockKind::Paragraph,
        });
    }
    let average =
        blocks.iter().map(|block| block.font_height).sum::<f64>() / blocks.len().max(1) as f64;
    for block in &mut blocks {
        if block.font_height > average * 1.35 {
            block.kind = BlockKind::Heading;
        }
    }
    Ok(blocks)
}

fn load_srx(request: &ImportRequest, locale: &str) -> Result<SrxRules, PdfError> {
    if let Some(path) = request.options.get("srxPath") {
        if fs::metadata(path)?.len() > 2 * 1024 * 1024 {
            return Err(PdfError::Options("srxPath is too large".to_string()));
        }
        let xml = fs::read_to_string(path)?;
        SrxRules::parse(&xml).map_err(|error| PdfError::Options(error.to_string()))
    } else {
        Ok(SrxRules::builtin(locale))
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct PdfPageLayout {
    pub summary: PdfPageSummary,
    pub blocks: Vec<PdfBlockProjection>,
}

impl PdfFilter {
    pub fn page_count(&self, source: &Path) -> Result<u32, PdfError> {
        validate_header(source)?;
        let options = PdfOptions::from_request(&ImportRequest::new(source.to_path_buf()))?;
        Ok(read_pdf_info(&options, source)?.pages)
    }

    pub fn page_layouts(&self, request: &ImportRequest) -> Result<Vec<PdfPageLayout>, PdfError> {
        let options = PdfOptions::from_request(request)?;
        validate_header(&request.source)?;
        let info = read_pdf_info(&options, &request.source)?;
        let text_pages = extract_text_pages(&options, &request.source)?;
        let mut layouts = Vec::new();
        for page in options.page_range(info.pages)? {
            let blocks = order_blocks(text_pages.get(&page).cloned().unwrap_or_default());
            let projections = blocks
                .iter()
                .enumerate()
                .map(|(order, block)| {
                    let path = path_for(page, order as u32, block).encode();
                    PdfBlockProjection {
                        path,
                        bbox: (
                            block.bbox.x,
                            block.bbox.y,
                            block.bbox.width,
                            block.bbox.height,
                        ),
                        kind: block.kind.as_str().to_string(),
                        source_kind: block.source_kind.as_str().to_string(),
                        confidence: block.confidence,
                        source_text: block.text.clone(),
                    }
                })
                .collect::<Vec<_>>();
            let (width, height) = blocks
                .first()
                .map(|block| (block.page_width, block.page_height))
                .unwrap_or((info.width, info.height));
            layouts.push(PdfPageLayout {
                summary: PdfPageSummary {
                    page,
                    width,
                    height,
                    has_text_layer: !projections.is_empty(),
                    block_count: projections.len() as u32,
                },
                blocks: projections,
            });
        }
        Ok(layouts)
    }

    pub fn render_page(
        &self,
        source: &Path,
        page: u32,
        dpi: u32,
        output: &Path,
    ) -> Result<(), PdfError> {
        if page == 0 || !(72..=200).contains(&dpi) {
            return Err(PdfError::Options(
                "page must be positive and DPI must be 72..200".to_string(),
            ));
        }
        validate_header(source)?;
        let options = PdfOptions::from_request(&ImportRequest::new(source.to_path_buf()))?;
        let parent = output.parent().unwrap_or_else(|| Path::new("."));
        fs::create_dir_all(parent)?;
        let prefix = parent.join(format!(".pdf-page-{}-{page}", std::process::id()));
        run_tool(
            &options.pdftoppm,
            &[
                "-png",
                "-f",
                &page.to_string(),
                "-l",
                &page.to_string(),
                "-r",
                &dpi.to_string(),
                "-singlefile",
                source.to_string_lossy().as_ref(),
                prefix.to_string_lossy().as_ref(),
            ],
            options.timeout,
            "pdftoppm",
        )?;
        let generated = prefix.with_extension("png");
        let bytes = fs::read(&generated)?;
        if bytes.len() > 32 * 1024 * 1024 {
            let _ = fs::remove_file(&generated);
            return Err(PdfError::ToolOutputLimit {
                tool: "pdftoppm".to_string(),
            });
        }
        if output.exists() {
            let _ = fs::remove_file(&generated);
            return Err(PdfError::Export("page output already exists".to_string()));
        }
        fs::write(output, bytes)?;
        let _ = fs::remove_file(generated);
        Ok(())
    }

    fn extract_events(&self, request: &ImportRequest) -> Result<Vec<FilterEvent>, PdfError> {
        let options = PdfOptions::from_request(request)?;
        validate_header(&request.source)?;
        let info = read_pdf_info(&options, &request.source)?;
        let text_pages = extract_text_pages(&options, &request.source)?;
        let srx = load_srx(request, &options.locale)?;
        let mut events = vec![FilterEvent::StartDocument {
            metadata: DocumentMetadata {
                format: "pdf".to_string(),
                source_locale: Some(options.locale.clone()),
                properties: BTreeMap::from([
                    ("filter".to_string(), "builtin.pdf".to_string()),
                    ("pageCount".to_string(), info.pages.to_string()),
                    ("pageWidth".to_string(), format!("{:.3}", info.width)),
                    ("pageHeight".to_string(), format!("{:.3}", info.height)),
                ]),
            },
        }];
        let mut ordinal = 0_u32;
        let mut found = false;
        for page in options.page_range(info.pages)? {
            let text_blocks = text_pages.get(&page).cloned().unwrap_or_default();
            let meaningful = text_blocks.iter().any(|block| meaningful_text(&block.text));
            let use_ocr = match options.ocr_mode {
                OcrMode::Always => true,
                OcrMode::Auto => !meaningful,
                OcrMode::Never => false,
            };
            let mut blocks = if use_ocr {
                if meaningful && options.ocr_mode == OcrMode::Always {
                    events.push(FilterEvent::Degradation(DegradationFinding {
                        code: "pdf_text_layer_replaced_by_ocr".to_string(),
                        severity: DegradationSeverity::Warning,
                        message: format!("page {page} was explicitly OCR processed"),
                        structural_path: None,
                    }));
                }
                ocr_page(&options, &request.source, page, info)?
            } else {
                text_blocks
            };
            if blocks.is_empty() {
                if options.ocr_mode == OcrMode::Never {
                    events.push(FilterEvent::Degradation(DegradationFinding {
                        code: "pdf_scanned_page_not_ocr_processed".to_string(),
                        severity: DegradationSeverity::Warning,
                        message: format!("page {page} has no meaningful text layer"),
                        structural_path: None,
                    }));
                    continue;
                }
                return Err(PdfError::ToolOutput(format!(
                    "page {page} produced no OCR text"
                )));
            }
            blocks = order_blocks(blocks);
            for (order, block) in blocks.into_iter().enumerate() {
                let ranges = srx.ranges(&block.text, &options.locale, options.segmentation_mode);
                for range in ranges {
                    let text = block.text.get(range).unwrap_or_default().trim().to_string();
                    if !meaningful_text(&text) {
                        continue;
                    }
                    let path = path_for(page, order as u32, &block).encode();
                    events.push(FilterEvent::StartUnit {
                        ordinal,
                        structural_path: path,
                    });
                    events.push(FilterEvent::Text(text));
                    if block.source_kind == SourceKind::Ocr {
                        events.push(FilterEvent::Note(DocumentNote {
                            id: format!(
                                "{}:pdf-ocr:{ordinal}",
                                request.document_id.as_deref().unwrap_or("pdf")
                            ),
                            text: format!("OCR confidence {}", block.confidence),
                            author: Some("tesseract".to_string()),
                        }));
                    }
                    events.push(FilterEvent::EndUnit);
                    ordinal = ordinal
                        .checked_add(1)
                        .ok_or_else(|| PdfError::Invalid("segment count overflow".to_string()))?;
                    found = true;
                }
            }
        }
        if !found && options.ocr_mode != OcrMode::Never {
            return Err(PdfError::Invalid(
                "PDF contains no translatable text".to_string(),
            ));
        }
        events.push(FilterEvent::Degradation(DegradationFinding {
            code: "pdf_layout_reconstructed".to_string(),
            severity: DegradationSeverity::Warning,
            message: "PDF layout is represented as ordered text blocks".to_string(),
            structural_path: None,
        }));
        events.push(FilterEvent::EndDocument);
        Ok(events)
    }
}

impl Default for PdfFilter {
    fn default() -> Self {
        Self
    }
}

impl DocumentFilter for PdfFilter {
    fn descriptor(&self) -> FilterDescriptor {
        FilterDescriptor {
            id: "builtin.pdf".to_string(),
            version: env!("CARGO_PKG_VERSION").to_string(),
            display_name: "Portable Document Format PDF".to_string(),
            extensions: vec!["pdf".to_string()],
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

    fn probe(&self, source: &Path) -> Result<ProbeResult, FilterError> {
        let extension = source
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or_default();
        if !extension.eq_ignore_ascii_case("pdf") {
            return Ok(ProbeResult::no_match("file extension is not .pdf"));
        }
        match validate_pdf(source) {
            Ok(()) => Ok(ProbeResult::matches(100, "valid PDF package")),
            Err(PdfError::Io(error)) => Err(FilterError::Io(error)),
            Err(error) => Ok(ProbeResult::no_match(error.to_string())),
        }
    }

    fn import(&self, request: ImportRequest) -> Result<FilterEventStream, FilterError> {
        Ok(Box::new(
            self.extract_events(&request)
                .map_err(map_pdf_error)?
                .into_iter()
                .map(Ok),
        ))
    }

    fn export(&self, request: ExportRequest<'_>) -> Result<ExportReport, FilterError> {
        let (bytes, translated, degradation) =
            reconstruct_docx(request.source, request.segments).map_err(map_pdf_error)?;
        let parent = request.output.parent().unwrap_or_else(|| Path::new("."));
        fs::create_dir_all(parent).map_err(FilterError::Io)?;
        let mut staged = NamedTempFile::new_in(parent).map_err(FilterError::Io)?;
        staged.write_all(&bytes).map_err(FilterError::Io)?;
        staged.as_file().sync_all().map_err(FilterError::Io)?;
        DocxFilter::validate(&DocxFilter, staged.path())
            .map_err(|error| FilterError::Invalid(error.to_string()))?;
        publish_bytes_noclobber(request.output, &bytes)?;
        Ok(ExportReport {
            output_path: request.output.display().to_string(),
            translated_segments: translated,
            degradation,
        })
    }

    fn validate(&self, source: &Path) -> Result<ValidationReport, FilterError> {
        validate_pdf(source).map_err(map_pdf_error)?;
        Ok(ValidationReport {
            valid: true,
            findings: Vec::new(),
        })
    }
}

fn validate_pdf(source: &Path) -> Result<(), PdfError> {
    validate_header(source)?;
    let options = PdfOptions::from_request(&ImportRequest::new(source.to_path_buf()))?;
    read_pdf_info(&options, source)?;
    Ok(())
}

fn map_pdf_error(error: PdfError) -> FilterError {
    match error {
        PdfError::Io(error) => FilterError::Io(error),
        PdfError::Unsupported(message) => FilterError::Unsupported(message),
        PdfError::Invalid(message) | PdfError::Options(message) => FilterError::Invalid(message),
        PdfError::ToolUnavailable { tool }
        | PdfError::ToolFailed { tool, status: _ }
        | PdfError::ToolTimeout { tool }
        | PdfError::ToolOutputLimit { tool } => {
            FilterError::Processing(format!("PDF tool {tool} failed"))
        }
        PdfError::ToolOutput(message) | PdfError::Export(message) => FilterError::Invalid(message),
    }
}

fn reconstruct_docx(
    source: &Path,
    segments: &[Segment],
) -> Result<(Vec<u8>, u32, Vec<DegradationFinding>), PdfError> {
    validate_header(source)?;
    let options = PdfOptions::from_request(&ImportRequest::new(source.to_path_buf()))?;
    let page_info = read_pdf_info(&options, source)?;
    let mut items = segments
        .iter()
        .map(|segment| Ok((PdfPath::decode(&segment.structural_path)?, segment)))
        .collect::<Result<Vec<_>, PdfError>>()?;
    items.sort_by_key(|(path, _)| (path.page, path.order));
    if items.is_empty() {
        return Err(PdfError::Export(
            "no PDF structural segments were supplied".to_string(),
        ));
    }
    let mut document = String::from(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>"#,
    );
    let mut translated = 0_u32;
    let mut previous_page = 0_u32;
    let mut has_table = false;
    let mut has_ocr = false;
    let mut has_columns = false;
    let mut table_open = false;
    for (path, segment) in items {
        if previous_page != 0 && path.page != previous_page {
            if table_open {
                document.push_str("</w:tbl>");
                table_open = false;
            }
            document.push_str(r#"<w:p><w:r><w:br w:type="page"/></w:r></w:p>"#);
        }
        previous_page = path.page;
        let text = if segment.target_text.trim().is_empty() {
            &segment.source_text
        } else {
            translated = translated
                .checked_add(1)
                .ok_or_else(|| PdfError::Export("translated count overflow".to_string()))?;
            &segment.target_text
        };
        has_table |= path.kind == "table";
        has_ocr |= path.source_kind == "ocr";
        has_columns |= path.x > 250_000;
        if path.kind == "table" {
            if !table_open {
                document.push_str(r#"<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr>"#);
                table_open = true;
            }
            document.push_str("<w:tr>");
            for cell in text.split(" | ") {
                document.push_str("<w:tc><w:p><w:r><w:t xml:space=\"preserve\">");
                document.push_str(&escape_xml(cell));
                document.push_str("</w:t></w:r></w:p></w:tc>");
            }
            document.push_str("</w:tr>");
            continue;
        }
        if table_open {
            document.push_str("</w:tbl>");
            table_open = false;
        }
        let style = if path.kind == "heading" {
            "Heading1"
        } else {
            "BodyText"
        };
        document.push_str(r#"<w:p><w:pPr><w:pStyle w:val=""#);
        document.push_str(style);
        document.push_str(r#""/></w:pPr><w:r><w:t xml:space="preserve">"#);
        document.push_str(&escape_xml(text));
        document.push_str("</w:t></w:r></w:p>");
    }
    if table_open {
        document.push_str("</w:tbl>");
    }
    let page_width_twips = (page_info.width * 20.0).round().clamp(1.0, 65_535.0) as u32;
    let page_height_twips = (page_info.height * 20.0).round().clamp(1.0, 65_535.0) as u32;
    document.push_str(
        &format!(
            r#"<w:sectPr><w:pgSz w:w="{page_width_twips}" w:h="{page_height_twips}"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>"#
        ),
    );
    let mut degradation = vec![
        DegradationFinding {
            code: "pdf_layout_reconstructed".to_string(),
            severity: DegradationSeverity::Warning,
            message: "PDF geometry was reconstructed as DOCX text".to_string(),
            structural_path: None,
        },
        DegradationFinding {
            code: "pdf_graphics_omitted".to_string(),
            severity: DegradationSeverity::Warning,
            message: "PDF graphics, fonts, and images are not copied into the DOCX".to_string(),
            structural_path: None,
        },
    ];
    if has_table {
        degradation.push(DegradationFinding {
            code: "pdf_tables_reconstructed".to_string(),
            severity: DegradationSeverity::Warning,
            message: "table candidates were reconstructed as DOCX rows and cells".to_string(),
            structural_path: None,
        });
    }
    if has_columns {
        degradation.push(DegradationFinding {
            code: "pdf_columns_reconstructed".to_string(),
            severity: DegradationSeverity::Warning,
            message: "multi-column reading order was linearized".to_string(),
            structural_path: None,
        });
    }
    if has_ocr {
        degradation.push(DegradationFinding {
            code: "pdf_ocr_origin".to_string(),
            severity: DegradationSeverity::Warning,
            message: "OCR-origin text may contain recognition errors".to_string(),
            structural_path: None,
        });
    }
    if segments.iter().any(|segment| {
        segment.target_text.chars().count()
            > segment
                .source_text
                .chars()
                .count()
                .saturating_mul(2)
                .max(32)
    }) {
        degradation.push(DegradationFinding {
            code: "pdf_text_overflow_risk".to_string(),
            severity: DegradationSeverity::Warning,
            message: "expanded target text may overflow reconstructed layout".to_string(),
            structural_path: None,
        });
    }
    Ok((make_docx(&document)?, translated, degradation))
}

fn make_docx(document: &str) -> Result<Vec<u8>, PdfError> {
    let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
    let parts = [
        (
            "[Content_Types].xml",
            r#"<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>"#,
        ),
        (
            "_rels/.rels",
            r#"<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>"#,
        ),
        (
            "word/styles.xml",
            r#"<?xml version="1.0" encoding="UTF-8"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:styleId="BodyText"><w:name w:val="Body Text"/></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style></w:styles>"#,
        ),
    ];
    for (name, contents) in parts {
        writer
            .start_file(name, options)
            .map_err(|error| PdfError::Export(error.to_string()))?;
        writer.write_all(contents.as_bytes())?;
    }
    writer
        .start_file("word/document.xml", options)
        .map_err(|error| PdfError::Export(error.to_string()))?;
    writer.write_all(document.as_bytes())?;
    let cursor = writer
        .finish()
        .map_err(|error| PdfError::Export(error.to_string()))?;
    Ok(cursor.into_inner())
}

fn escape_xml(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use translunar_domain::SegmentState;
    use translunar_filter_core::{ExportRequest, collect_imported_document};
    use zip::ZipArchive;

    fn fixture(name: &str) -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../fixtures/pdf")
            .join(name)
    }

    fn tools_available() -> bool {
        Command::new("pdftotext")
            .arg("-v")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .is_ok()
            && Command::new("tesseract")
                .arg("--version")
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status()
                .is_ok()
    }

    #[test]
    fn path_round_trip_is_stable() {
        let path = PdfPath {
            page: 2,
            order: 4,
            kind: "paragraph".to_string(),
            x: 1200,
            y: 3400,
            width: 5000,
            height: 900,
            source_kind: "ocr".to_string(),
            confidence: 932,
        };
        assert_eq!(PdfPath::decode(&path.encode()).expect("decode"), path);
    }

    #[test]
    fn page_range_is_inclusive() {
        assert_eq!(
            parse_page_range(Some(&"2-4".to_string())).expect("range"),
            (2, Some(4))
        );
        assert!(parse_page_range(Some(&"0-2".to_string())).is_err());
    }

    #[test]
    fn bbox_parser_reads_poppler_shape() {
        let xml = br#"<html><body><doc><page width="100" height="200"><flow><block xMin="1" yMin="2" xMax="30" yMax="12"><line><word>Hello</word></line></block></flow></page></doc></body></html>"#;
        let pages = parse_bbox_layout(xml).expect("bbox");
        assert_eq!(pages.get(&1).expect("page")[0].text, "Hello");
    }

    #[test]
    fn imports_real_text_layout_in_column_order() {
        if !tools_available() {
            return;
        }
        let mut request = ImportRequest::new(fixture("text-layout.pdf"));
        request
            .options
            .insert("ocrMode".to_string(), "never".to_string());
        let document = collect_imported_document(
            PdfFilter
                .import(request)
                .expect("import text layout")
                .collect::<Vec<_>>(),
        )
        .expect("collect text layout");
        let texts = document
            .units
            .iter()
            .map(|unit| unit.source_text.as_str())
            .collect::<Vec<_>>();
        assert_eq!(texts[0], "Retention and Payment Terms");
        assert_eq!(texts[2], "1. The retention period is 30 days.");
        assert_eq!(texts[4], "3. Governing law is the law of Hong Kong.");
        assert_eq!(texts[5], "4. Payment is due within 15 days.");
        assert!(
            document
                .units
                .iter()
                .any(|unit| unit.structural_path.contains(";k=table;"))
        );
    }

    #[test]
    fn imports_real_scanned_and_mixed_pages_without_loss() {
        if !tools_available() {
            return;
        }
        for name in ["scanned.pdf", "mixed.pdf"] {
            let document = collect_imported_document(
                PdfFilter
                    .import(ImportRequest::new(fixture(name)))
                    .expect("import PDF")
                    .collect::<Vec<_>>(),
            )
            .expect("collect PDF");
            assert!(
                document
                    .units
                    .iter()
                    .any(|unit| unit.source_text.contains("INV-2048"))
            );
            assert!(
                document
                    .units
                    .iter()
                    .any(|unit| unit.structural_path.contains(";s=ocr;"))
            );
            if name == "mixed.pdf" {
                assert!(
                    document
                        .units
                        .iter()
                        .any(|unit| unit.source_text.contains("selectable text layer"))
                );
            }
        }
    }

    #[test]
    fn real_ocr_modes_page_range_and_missing_tool_are_explicit() {
        if !tools_available() {
            return;
        }
        let mut never = ImportRequest::new(fixture("scanned.pdf"));
        never
            .options
            .insert("ocrMode".to_string(), "never".to_string());
        let never_document = collect_imported_document(
            PdfFilter
                .import(never)
                .expect("never mode")
                .collect::<Vec<_>>(),
        )
        .expect("collect never mode");
        assert!(never_document.units.is_empty());
        assert!(
            never_document
                .degradation
                .iter()
                .any(|finding| finding.code == "pdf_scanned_page_not_ocr_processed")
        );

        let mut always = ImportRequest::new(fixture("text-layout.pdf"));
        always
            .options
            .insert("ocrMode".to_string(), "always".to_string());
        always
            .options
            .insert("ocrLanguages".to_string(), "eng".to_string());
        always
            .options
            .insert("ocrDpi".to_string(), "200".to_string());
        always
            .options
            .insert("pageRange".to_string(), "2-2".to_string());
        let always_document = collect_imported_document(
            PdfFilter
                .import(always)
                .expect("always mode")
                .collect::<Vec<_>>(),
        )
        .expect("collect always mode");
        assert!(!always_document.units.is_empty());
        assert!(
            always_document
                .units
                .iter()
                .all(|unit| unit.structural_path.starts_with("pdf:p=2;"))
        );
        assert!(
            always_document
                .units
                .iter()
                .all(|unit| unit.structural_path.contains(";s=ocr;"))
        );

        let mut missing = ImportRequest::new(fixture("scanned.pdf"));
        missing.options.insert(
            "ocrCommand".to_string(),
            "__translunar_missing_tesseract__".to_string(),
        );
        let error = match PdfFilter.import(missing) {
            Ok(_) => panic!("missing OCR tool unexpectedly succeeded"),
            Err(error) => error,
        };
        assert!(matches!(error, FilterError::Processing(_)));
    }

    #[test]
    fn invalid_pdf_options_are_rejected_before_tool_execution() {
        for (name, value) in [
            ("ocrMode", "sometimes"),
            ("ocrDpi", "40"),
            ("ocrLanguages", "eng;rm"),
            ("pageRange", "2-"),
        ] {
            let mut request = ImportRequest::new(fixture("scanned.pdf"));
            request.options.insert(name.to_string(), value.to_string());
            assert!(PdfOptions::from_request(&request).is_err(), "{name}");
        }
    }

    #[test]
    fn reconstructs_real_pdf_as_valid_docx_table_without_clobber() {
        if !tools_available() {
            return;
        }
        let source = fixture("text-layout.pdf");
        let mut request = ImportRequest::new(source.clone());
        request
            .options
            .insert("ocrMode".to_string(), "never".to_string());
        let imported = collect_imported_document(
            PdfFilter
                .import(request)
                .expect("import source")
                .collect::<Vec<_>>(),
        )
        .expect("collect source");
        let segments = imported
            .units
            .iter()
            .map(|unit| Segment {
                id: format!("segment-{}", unit.ordinal),
                document_id: "document".to_string(),
                ordinal: unit.ordinal,
                structural_path: unit.structural_path.clone(),
                source_text: unit.source_text.clone(),
                target_text: if unit.ordinal == 0 {
                    "保留与付款条款".to_string()
                } else {
                    String::new()
                },
                state: if unit.ordinal == 0 {
                    SegmentState::Draft
                } else {
                    SegmentState::Untranslated
                },
                revision: 0,
                source_hash: "source".to_string(),
                context_hash: "context".to_string(),
                updated_at_ms: 0,
            })
            .collect::<Vec<_>>();
        let temporary = tempfile::tempdir().expect("temporary output");
        let output = temporary.path().join("reconstructed.docx");
        let report = PdfFilter
            .export(ExportRequest {
                source: &source,
                output: &output,
                segments: &segments,
            })
            .expect("export PDF");
        assert_eq!(report.translated_segments, 1);
        assert!(
            report
                .degradation
                .iter()
                .any(|finding| finding.code == "pdf_tables_reconstructed")
        );
        let reimported = DocxFilter
            .extract_units(&output)
            .expect("re-import reconstructed DOCX");
        assert!(
            reimported
                .iter()
                .any(|unit| unit.source_text == "保留与付款条款")
        );
        let file = File::open(&output).expect("open DOCX");
        let mut archive = ZipArchive::new(file).expect("DOCX ZIP");
        let mut document_xml = String::new();
        archive
            .by_name("word/document.xml")
            .expect("document XML")
            .read_to_string(&mut document_xml)
            .expect("read document XML");
        assert!(document_xml.contains("<w:tbl>"));
        assert!(document_xml.contains(r#"<w:pgSz w:w="11906" w:h="16838"/>"#));
        assert!(
            PdfFilter
                .export(ExportRequest {
                    source: &source,
                    output: &output,
                    segments: &segments,
                })
                .is_err()
        );
    }
}

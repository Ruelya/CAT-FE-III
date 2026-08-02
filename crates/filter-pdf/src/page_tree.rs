//! Bounded, strict PDF page-tree counting for preflight resource gates.
//!
//! Design goals (resource-limit gate, not a general PDF toolkit):
//! - Cap file bytes, decoded stream bytes (per-stream and total), object count,
//!   page-tree depth, page count, and wall-clock traversal time.
//! - Fail closed on malformed / cyclic / partial trees (no silent skip).
//! - Accept genuine `/ObjStm` page dictionaries after a bounded Flate preflight.

use std::collections::HashSet;
use std::fs;
use std::io::Read;
use std::path::Path;
use std::time::{Duration, Instant};

use flate2::read::ZlibDecoder;
use lopdf::{Document, Object, ObjectId};

use crate::PdfError;

/// File size cap for page-tree preflight (aligned with MinerU 200 MiB default).
const MAX_PAGE_TREE_FILE_BYTES: u64 = 200 * 1024 * 1024;
/// Hard cap on decoded size of any single Flate stream.
const MAX_STREAM_DECODED_BYTES: usize = 8 * 1024 * 1024;
/// Aggregate decoded stream budget during preflight.
const MAX_TOTAL_DECODED_BYTES: usize = 32 * 1024 * 1024;
/// Max objects considered during page-tree walk (and load object-map size).
const MAX_RESOLVED_OBJECTS: usize = 50_000;
/// Nesting depth for `/Pages` intermediate nodes.
const MAX_PAGE_TREE_DEPTH: usize = 64;
/// Page count hard stop (matches filter MAX_PAGES).
const MAX_PAGES: u32 = 2_000;
/// Wall-clock budget for the whole count operation.
const MAX_TRAVERSAL: Duration = Duration::from_secs(5);
/// Reject streams whose compressed size already implies > this amplification.
const MAX_COMPRESSION_RATIO: u64 = 64;

pub(crate) fn count_page_tree_bounded(source: &Path) -> Result<u32, PdfError> {
    let started = Instant::now();
    validate_pdf_header_bytes(source)?;
    let metadata = fs::metadata(source)?;
    let file_len = metadata.len();
    if file_len == 0 || file_len > MAX_PAGE_TREE_FILE_BYTES {
        return Err(PdfError::ResourceLimit {
            resource: "page_tree_file_bytes",
            limit: MAX_PAGE_TREE_FILE_BYTES,
            actual: file_len.max(1),
        });
    }

    let bytes = fs::read(source)?;
    // Fail closed on Flate amplification before lopdf expands ObjStm / XRef streams.
    guard_flate_streams(&bytes, started)?;

    if started.elapsed() > MAX_TRAVERSAL {
        return Err(PdfError::ResourceLimit {
            resource: "page_tree_time_ms",
            limit: MAX_TRAVERSAL.as_millis() as u64,
            actual: started.elapsed().as_millis() as u64,
        });
    }

    let document = Document::load_mem(&bytes)
        .map_err(|error| PdfError::Invalid(format!("unable to parse PDF page tree: {error}")))?;

    let object_count = document.objects.len();
    if object_count > MAX_RESOLVED_OBJECTS {
        return Err(PdfError::ResourceLimit {
            resource: "page_tree_objects",
            limit: MAX_RESOLVED_OBJECTS as u64,
            actual: object_count as u64,
        });
    }

    let count = strict_page_count(&document, started)?;
    if count == 0 || count > MAX_PAGES {
        return Err(PdfError::Invalid(
            "PDF page count is outside supported bounds".to_string(),
        ));
    }
    Ok(count)
}

fn validate_pdf_header_bytes(source: &Path) -> Result<(), PdfError> {
    let mut file = fs::File::open(source)?;
    let mut header = [0_u8; 5];
    let read = file.read(&mut header)?;
    if read < 5 || &header != b"%PDF-" {
        return Err(PdfError::Invalid("missing PDF header".to_string()));
    }
    Ok(())
}

/// Scan for `stream` keywords with a nearby `/Length` and Flate filter; decode
/// under explicit per-stream and aggregate caps. Unknown / indirect lengths that
/// still look Flate-compressed are rejected when compressed size * ratio exceeds
/// the decode budget (fail closed).
fn guard_flate_streams(bytes: &[u8], started: Instant) -> Result<(), PdfError> {
    let mut total_decoded = 0_usize;
    let mut search_from = 0_usize;
    while let Some(rel) = find_bytes(&bytes[search_from..], b"stream") {
        if started.elapsed() > MAX_TRAVERSAL {
            return Err(PdfError::ResourceLimit {
                resource: "page_tree_time_ms",
                limit: MAX_TRAVERSAL.as_millis() as u64,
                actual: started.elapsed().as_millis() as u64,
            });
        }
        let stream_kw = search_from + rel;
        // Keyword must be a token boundary (not part of a name/string).
        if stream_kw > 0 {
            let prev = bytes[stream_kw - 1];
            if prev.is_ascii_alphanumeric() || prev == b'/' {
                search_from = stream_kw + 6;
                continue;
            }
        }
        let after_kw = stream_kw + 6;
        if after_kw >= bytes.len() {
            break;
        }
        // PDF allows `stream\n` or `stream\r\n` before data.
        let data_start = if bytes.get(after_kw) == Some(&b'\n') {
            after_kw + 1
        } else if bytes.get(after_kw) == Some(&b'\r') && bytes.get(after_kw + 1) == Some(&b'\n') {
            after_kw + 2
        } else {
            // Not a stream keyword we understand; skip.
            search_from = after_kw;
            continue;
        };

        // Look back up to 512 bytes for dictionary hints (Filter / Length).
        let lookback_start = stream_kw.saturating_sub(512);
        let preface = &bytes[lookback_start..stream_kw];
        let is_flate = contains_flate_filter(preface);
        if !is_flate {
            search_from = data_start;
            continue;
        }

        let length = match parse_direct_length(preface) {
            Some(len) => len,
            None => {
                // Indirect or missing Length with Flate — refuse rather than
                // risk unbounded decode inside lopdf.
                return Err(PdfError::Invalid(
                    "Flate stream without a direct /Length is unsupported for page-tree preflight"
                        .to_string(),
                ));
            }
        };

        if length == 0 {
            search_from = data_start;
            continue;
        }
        if length as u64 > MAX_STREAM_DECODED_BYTES as u64 {
            return Err(PdfError::ResourceLimit {
                resource: "page_tree_stream_compressed_bytes",
                limit: MAX_STREAM_DECODED_BYTES as u64,
                actual: length as u64,
            });
        }
        if (length as u64).saturating_mul(MAX_COMPRESSION_RATIO) > MAX_STREAM_DECODED_BYTES as u64 {
            // Still attempt bounded decode — bomb will hit the take() limit.
        }

        let data_end = data_start.saturating_add(length);
        if data_end > bytes.len() {
            return Err(PdfError::Invalid(
                "PDF stream Length exceeds file bounds".to_string(),
            ));
        }
        let compressed = &bytes[data_start..data_end];
        let decoded = bounded_inflate(compressed)?;
        total_decoded = total_decoded.saturating_add(decoded);
        if total_decoded > MAX_TOTAL_DECODED_BYTES {
            return Err(PdfError::ResourceLimit {
                resource: "page_tree_decoded_bytes",
                limit: MAX_TOTAL_DECODED_BYTES as u64,
                actual: total_decoded as u64,
            });
        }
        search_from = data_end;
    }
    Ok(())
}

fn contains_flate_filter(preface: &[u8]) -> bool {
    // Common spellings in generated and real PDFs.
    find_bytes(preface, b"/FlateDecode").is_some()
        || find_bytes(preface, b"/Fl").is_some() && find_bytes(preface, b"FlateDecode").is_some()
}

fn parse_direct_length(preface: &[u8]) -> Option<usize> {
    // Prefer the last `/Length <int>` before the stream keyword.
    let mut best: Option<usize> = None;
    let mut pos = 0;
    while let Some(rel) = find_bytes(&preface[pos..], b"/Length") {
        let at = pos + rel + 7;
        let rest = trim_ascii_start(&preface[at..]);
        // Skip indirect refs like `12 0 R`.
        if let Some((num, after)) = parse_usize_prefix(rest) {
            let after = trim_ascii_start(after);
            if after.starts_with(b"0 R") || after.starts_with(b"0R") {
                // Indirect length — not resolved in preflight.
                pos = at;
                continue;
            }
            best = Some(num);
        }
        pos = at;
    }
    best
}

fn parse_usize_prefix(input: &[u8]) -> Option<(usize, &[u8])> {
    let mut i = 0;
    while i < input.len() && input[i].is_ascii_digit() {
        i += 1;
    }
    if i == 0 {
        return None;
    }
    let n = std::str::from_utf8(&input[..i]).ok()?.parse().ok()?;
    Some((n, &input[i..]))
}

fn trim_ascii_start(input: &[u8]) -> &[u8] {
    let mut i = 0;
    while i < input.len() && input[i].is_ascii_whitespace() {
        i += 1;
    }
    &input[i..]
}

fn bounded_inflate(compressed: &[u8]) -> Result<usize, PdfError> {
    if compressed.is_empty() {
        return Ok(0);
    }
    let mut decoder = ZlibDecoder::new(compressed);
    let mut limited = decoder.by_ref().take(MAX_STREAM_DECODED_BYTES as u64 + 1);
    let mut out = Vec::new();
    limited
        .read_to_end(&mut out)
        .map_err(|error| PdfError::Invalid(format!("Flate stream decode failed: {error}")))?;
    if out.len() > MAX_STREAM_DECODED_BYTES {
        return Err(PdfError::ResourceLimit {
            resource: "page_tree_stream_decoded_bytes",
            limit: MAX_STREAM_DECODED_BYTES as u64,
            actual: out.len() as u64,
        });
    }
    Ok(out.len())
}

fn find_bytes(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}

/// Strict page-tree walk: missing/malformed kids, cycles, depth/time/object
/// overruns, and Count mismatches are hard errors (no silent skip).
fn strict_page_count(document: &Document, started: Instant) -> Result<u32, PdfError> {
    let catalog = document
        .catalog()
        .map_err(|error| PdfError::Invalid(format!("PDF catalog missing: {error}")))?;
    let pages_ref = catalog
        .get(b"Pages")
        .map_err(|_| PdfError::Invalid("PDF catalog has no /Pages".to_string()))?
        .as_reference()
        .map_err(|_| PdfError::Invalid("PDF /Pages is not a reference".to_string()))?;

    let mut seen = HashSet::new();
    let mut resolved = 0_usize;
    let (count, declared) =
        walk_pages_node(document, pages_ref, 0, &mut seen, &mut resolved, started)?;

    if let Some(declared) = declared
        && declared != count
    {
        return Err(PdfError::Invalid(format!(
            "PDF page-tree /Count {declared} does not match walked pages {count}"
        )));
    }
    Ok(count)
}

fn walk_pages_node(
    document: &Document,
    id: ObjectId,
    depth: usize,
    seen: &mut HashSet<ObjectId>,
    resolved: &mut usize,
    started: Instant,
) -> Result<(u32, Option<u32>), PdfError> {
    if started.elapsed() > MAX_TRAVERSAL {
        return Err(PdfError::ResourceLimit {
            resource: "page_tree_time_ms",
            limit: MAX_TRAVERSAL.as_millis() as u64,
            actual: started.elapsed().as_millis() as u64,
        });
    }
    if depth > MAX_PAGE_TREE_DEPTH {
        return Err(PdfError::ResourceLimit {
            resource: "page_tree_depth",
            limit: MAX_PAGE_TREE_DEPTH as u64,
            actual: depth as u64,
        });
    }
    if !seen.insert(id) {
        return Err(PdfError::Invalid(
            "PDF page tree contains a cycle".to_string(),
        ));
    }
    *resolved += 1;
    if *resolved > MAX_RESOLVED_OBJECTS {
        return Err(PdfError::ResourceLimit {
            resource: "page_tree_objects",
            limit: MAX_RESOLVED_OBJECTS as u64,
            actual: *resolved as u64,
        });
    }

    let dict = document.get_dictionary(id).map_err(|error| {
        PdfError::Invalid(format!(
            "PDF page-tree object {} {} R is missing or not a dictionary: {error}",
            id.0, id.1
        ))
    })?;

    let type_name = dict
        .type_name()
        .map_err(|_| PdfError::Invalid("PDF page-tree node missing /Type".to_string()))?;

    match type_name {
        "Page" => Ok((1, Some(1))),
        "Pages" => {
            let declared = dict
                .get(b"Count")
                .ok()
                .and_then(|obj| object_as_u32(document, obj).ok());
            let kids = dict
                .get(b"Kids")
                .map_err(|_| PdfError::Invalid("PDF /Pages node is missing /Kids".to_string()))?;
            let kids = resolve_array(document, kids)?;
            if kids.len() > MAX_RESOLVED_OBJECTS {
                return Err(PdfError::ResourceLimit {
                    resource: "page_tree_kids",
                    limit: MAX_RESOLVED_OBJECTS as u64,
                    actual: kids.len() as u64,
                });
            }
            let mut total = 0_u32;
            for kid in kids {
                let kid_id = kid.as_reference().map_err(|_| {
                    PdfError::Invalid("PDF /Kids entry is not an indirect reference".to_string())
                })?;
                let (child_count, _) =
                    walk_pages_node(document, kid_id, depth + 1, seen, resolved, started)?;
                total = total
                    .checked_add(child_count)
                    .ok_or_else(|| PdfError::Invalid("PDF page count overflow".to_string()))?;
                if total > MAX_PAGES {
                    return Err(PdfError::ResourceLimit {
                        resource: "pages",
                        limit: u64::from(MAX_PAGES),
                        actual: u64::from(total),
                    });
                }
            }
            Ok((total, declared))
        }
        other => Err(PdfError::Invalid(format!(
            "PDF page-tree node has unexpected /Type /{other}"
        ))),
    }
}

fn resolve_array<'a>(document: &'a Document, object: &'a Object) -> Result<&'a [Object], PdfError> {
    match object {
        Object::Array(items) => Ok(items.as_slice()),
        Object::Reference(id) => {
            let resolved = document.get_object(*id).map_err(|error| {
                PdfError::Invalid(format!("PDF array reference missing: {error}"))
            })?;
            match resolved {
                Object::Array(items) => Ok(items.as_slice()),
                _ => Err(PdfError::Invalid(
                    "PDF /Kids reference does not resolve to an array".to_string(),
                )),
            }
        }
        _ => Err(PdfError::Invalid(
            "PDF /Kids is not an array or reference".to_string(),
        )),
    }
}

fn object_as_u32(document: &Document, object: &Object) -> Result<u32, PdfError> {
    match object {
        Object::Integer(value) if *value >= 0 && *value <= i64::from(u32::MAX) => Ok(*value as u32),
        Object::Reference(id) => {
            let resolved = document
                .get_object(*id)
                .map_err(|error| PdfError::Invalid(format!("count ref missing: {error}")))?;
            object_as_u32(document, resolved)
        }
        _ => Err(PdfError::Invalid(
            "PDF /Count is not a non-negative integer".to_string(),
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use flate2::Compression;
    use flate2::write::ZlibEncoder;
    use std::io::Write;
    use tempfile::tempdir;

    fn write_simple_pages(path: &Path, pages: u32) {
        use lopdf::dictionary;
        let mut doc = Document::with_version("1.4");
        let pages_id = doc.new_object_id();
        let mut kids = Vec::with_capacity(pages as usize);
        for _ in 0..pages {
            let page_id = doc.add_object(dictionary! {
                "Type" => "Page",
                "Parent" => pages_id,
                "MediaBox" => vec![0.into(), 0.into(), 612.into(), 792.into()],
            });
            kids.push(page_id.into());
        }
        doc.objects.insert(
            pages_id,
            Object::Dictionary(dictionary! {
                "Type" => "Pages",
                "Kids" => kids,
                "Count" => i64::from(pages),
            }),
        );
        let catalog_id = doc.add_object(dictionary! {
            "Type" => "Catalog",
            "Pages" => pages_id,
        });
        doc.trailer.set("Root", catalog_id);
        doc.save(path).expect("save");
    }

    /// Genuine object-stream PDF: page dictionaries live inside a Flate `/ObjStm`
    /// and are addressed via a cross-reference stream (not a raw `/Type /Page` scan).
    fn write_objstm_pages_pdf(path: &Path, pages: u32) {
        assert!((1..=20).contains(&pages));
        // Objects:
        // 1: Catalog
        // 2: Pages
        // 3..: Page dicts inside ObjStm (object 100)
        // 100: ObjStm
        // 101: XRef stream
        let mut index = String::new();
        let mut body = String::new();
        for i in 0..pages {
            let obj_num = 3 + i;
            let offset = body.len();
            index.push_str(&format!("{obj_num} {offset} "));
            body.push_str("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >> ");
        }
        let first = index.len();
        let mut raw = index.into_bytes();
        raw.extend_from_slice(body.as_bytes());

        let mut encoder = ZlibEncoder::new(Vec::new(), Compression::default());
        encoder.write_all(&raw).unwrap();
        let compressed = encoder.finish().unwrap();

        let mut kids = String::new();
        for i in 0..pages {
            kids.push_str(&format!("{} 0 R ", 3 + i));
        }
        let kids = kids.trim();

        // Build file pieces with known offsets.
        let mut pdf = Vec::new();
        pdf.extend_from_slice(b"%PDF-1.5\n");

        let obj1_at = pdf.len();
        pdf.extend_from_slice(b"1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");

        let obj2_at = pdf.len();
        let pages_dict =
            format!("2 0 obj\n<< /Type /Pages /Kids [ {kids} ] /Count {pages} >>\nendobj\n");
        pdf.extend_from_slice(pages_dict.as_bytes());

        let obj100_at = pdf.len();
        let objstm_header = format!(
            "100 0 obj\n<< /Type /ObjStm /N {pages} /First {first} /Filter /FlateDecode /Length {} >>\nstream\n",
            compressed.len()
        );
        pdf.extend_from_slice(objstm_header.as_bytes());
        pdf.extend_from_slice(&compressed);
        pdf.extend_from_slice(b"\nendstream\nendobj\n");

        // XRef stream: W = [1 2 2] → type(1), field2(2), field3(2)
        // type 0 free, 1 normal(offset, gen), 2 compressed(container, index)
        // Offsets must fit u16 for this compact fixture.
        assert!(obj100_at < u16::MAX as usize);
        let last_page = 2 + pages;
        let obj101_at = pdf.len();
        assert!(obj101_at < u16::MAX as usize);

        let write_free = |buf: &mut Vec<u8>| buf.extend_from_slice(&[0, 0, 0, 0, 0]);
        let write_normal = |buf: &mut Vec<u8>, offset: usize| {
            buf.push(1);
            buf.extend_from_slice(&(offset as u16).to_be_bytes());
            buf.extend_from_slice(&0_u16.to_be_bytes());
        };
        let write_compressed = |buf: &mut Vec<u8>, index: u16| {
            buf.push(2);
            buf.extend_from_slice(&100_u16.to_be_bytes());
            buf.extend_from_slice(&index.to_be_bytes());
        };

        let mut xref_data: Vec<u8> = Vec::new();
        write_free(&mut xref_data); // 0
        write_normal(&mut xref_data, obj1_at); // 1
        write_normal(&mut xref_data, obj2_at); // 2
        for i in 0..pages {
            write_compressed(&mut xref_data, i as u16); // 3..
        }
        for _ in (last_page + 1)..100 {
            write_free(&mut xref_data);
        }
        write_normal(&mut xref_data, obj100_at); // 100
        write_normal(&mut xref_data, obj101_at); // 101

        let mut enc = ZlibEncoder::new(Vec::new(), Compression::default());
        enc.write_all(&xref_data).unwrap();
        let xref_compressed = enc.finish().unwrap();

        let size = 102; // objects 0..101
        let xref_obj = format!(
            "101 0 obj\n<< /Type /XRef /Size {size} /W [1 2 2] /Root 1 0 R /Filter /FlateDecode /Length {} >>\nstream\n",
            xref_compressed.len()
        );
        pdf.extend_from_slice(xref_obj.as_bytes());
        pdf.extend_from_slice(&xref_compressed);
        pdf.extend_from_slice(b"\nendstream\nendobj\n");

        let startxref = obj101_at;
        pdf.extend_from_slice(format!("startxref\n{startxref}\n%%EOF\n").as_bytes());

        fs::write(path, pdf).expect("write objstm pdf");
    }

    fn write_cyclic_pages_pdf(path: &Path) {
        use lopdf::dictionary;
        let mut doc = Document::with_version("1.4");
        let pages_a = doc.new_object_id();
        let pages_b = doc.new_object_id();
        doc.objects.insert(
            pages_a,
            Object::Dictionary(dictionary! {
                "Type" => "Pages",
                "Kids" => vec![pages_b.into()],
                "Count" => 1_i64,
            }),
        );
        doc.objects.insert(
            pages_b,
            Object::Dictionary(dictionary! {
                "Type" => "Pages",
                "Kids" => vec![pages_a.into()],
                "Count" => 1_i64,
            }),
        );
        let catalog_id = doc.add_object(dictionary! {
            "Type" => "Catalog",
            "Pages" => pages_a,
        });
        doc.trailer.set("Root", catalog_id);
        doc.save(path).expect("save cyclic");
    }

    fn write_deep_pages_pdf(path: &Path, depth: usize) {
        use lopdf::dictionary;
        let mut doc = Document::with_version("1.4");
        let page_id = doc.add_object(dictionary! {
            "Type" => "Page",
            "MediaBox" => vec![0.into(), 0.into(), 612.into(), 792.into()],
        });
        let mut child = page_id;
        for _ in 0..depth {
            let node = doc.add_object(dictionary! {
                "Type" => "Pages",
                "Kids" => vec![child.into()],
                "Count" => 1_i64,
            });
            child = node;
        }
        let catalog_id = doc.add_object(dictionary! {
            "Type" => "Catalog",
            "Pages" => child,
        });
        doc.trailer.set("Root", catalog_id);
        doc.save(path).expect("save deep");
    }

    fn write_flate_bomb_pdf(path: &Path) {
        // Classic PDF with one highly compressible stream (not necessarily ObjStm).
        let huge = vec![0_u8; MAX_STREAM_DECODED_BYTES + 64 * 1024];
        let mut encoder = ZlibEncoder::new(Vec::new(), Compression::best());
        encoder.write_all(&huge).unwrap();
        let compressed = encoder.finish().unwrap();
        assert!(compressed.len() < 64 * 1024);

        let mut pdf = Vec::new();
        pdf.extend_from_slice(b"%PDF-1.4\n");
        let obj1 = pdf.len();
        pdf.extend_from_slice(b"1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
        let obj2 = pdf.len();
        pdf.extend_from_slice(b"2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n");
        let obj3 = pdf.len();
        pdf.extend_from_slice(
            b"3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>\nendobj\n",
        );
        let obj4 = pdf.len();
        let stream_dict = format!(
            "4 0 obj\n<< /Length {} /Filter /FlateDecode >>\nstream\n",
            compressed.len()
        );
        pdf.extend_from_slice(stream_dict.as_bytes());
        pdf.extend_from_slice(&compressed);
        pdf.extend_from_slice(b"\nendstream\nendobj\n");
        let xref_at = pdf.len();
        let mut xref = String::from("xref\n0 5\n0000000000 65535 f \n");
        for offset in [obj1, obj2, obj3, obj4] {
            xref.push_str(&format!("{offset:010} 00000 n \n"));
        }
        pdf.extend_from_slice(xref.as_bytes());
        pdf.extend_from_slice(
            format!("trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n{xref_at}\n%%EOF\n").as_bytes(),
        );
        fs::write(path, pdf).unwrap();
    }

    #[test]
    fn counts_simple_page_tree() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("three.pdf");
        write_simple_pages(&path, 3);
        assert_eq!(count_page_tree_bounded(&path).unwrap(), 3);
    }

    #[test]
    fn counts_genuine_object_stream_pages() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("objstm.pdf");
        write_objstm_pages_pdf(&path, 3);
        let count = count_page_tree_bounded(&path).expect("objstm page count");
        assert_eq!(count, 3, "must count pages stored inside /ObjStm");
    }

    #[test]
    fn rejects_cyclic_page_tree() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("cycle.pdf");
        write_cyclic_pages_pdf(&path);
        let err = count_page_tree_bounded(&path).expect_err("cycle");
        let message = err.to_string();
        assert!(
            message.contains("cycle") || message.contains("invalid"),
            "unexpected error: {message}"
        );
    }

    #[test]
    fn rejects_over_deep_page_tree() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("deep.pdf");
        write_deep_pages_pdf(&path, MAX_PAGE_TREE_DEPTH + 8);
        let err = count_page_tree_bounded(&path).expect_err("depth");
        match err {
            PdfError::ResourceLimit { resource, .. } => {
                assert_eq!(resource, "page_tree_depth");
            }
            other => panic!("expected depth resource limit, got {other:?}"),
        }
    }

    #[test]
    fn rejects_flate_amplification() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("bomb.pdf");
        write_flate_bomb_pdf(&path);
        let err = count_page_tree_bounded(&path).expect_err("bomb");
        match err {
            PdfError::ResourceLimit { resource, .. } => {
                assert!(
                    resource.contains("decoded") || resource.contains("stream"),
                    "resource={resource}"
                );
            }
            other => panic!("expected resource limit, got {other:?}"),
        }
    }

    #[test]
    fn rejects_missing_kids_as_invalid() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("bad.pdf");
        use lopdf::dictionary;
        let mut doc = Document::with_version("1.4");
        let pages_id = doc.add_object(dictionary! {
            "Type" => "Pages",
            "Count" => 1_i64,
            // no Kids
        });
        let catalog_id = doc.add_object(dictionary! {
            "Type" => "Catalog",
            "Pages" => pages_id,
        });
        doc.trailer.set("Root", catalog_id);
        doc.save(&path).unwrap();
        let err = count_page_tree_bounded(&path).expect_err("missing kids");
        assert!(matches!(err, PdfError::Invalid(_)));
    }
}

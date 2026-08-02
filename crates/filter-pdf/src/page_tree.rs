//! Bounded, strict PDF page-tree counting for preflight resource gates.
//!
//! Design goals (resource-limit gate, not a general PDF toolkit):
//! - Cap file bytes, decoded **ObjStm/XRef** stream bytes, object count (via xref
//!   Size), page-tree depth, page count, and wall-clock time **before** invoking
//!   `lopdf::Document::load_mem`.
//! - Decode only streams that the loader expands (object streams + cross-reference
//!   streams). Ordinary page/image content streams are never inflated here, so
//!   valid scanned PDFs do not burn the aggregate decode budget.
//! - Fail closed on LZW / multi-filter / indirect Filter|/Length metadata for
//!   expandable streams, malformed or missing `/Count` at every `/Pages` node,
//!   cycles, depth overruns, and partial trees.
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
/// Hard cap on decoded size of any single expandable (ObjStm/XRef) stream.
const MAX_STREAM_DECODED_BYTES: usize = 8 * 1024 * 1024;
/// Aggregate decoded expandable-stream budget during preflight.
const MAX_TOTAL_DECODED_BYTES: usize = 32 * 1024 * 1024;
/// Max objects considered during page-tree walk (and load object-map size).
const MAX_RESOLVED_OBJECTS: usize = 50_000;
/// Nesting depth for `/Pages` intermediate nodes.
const MAX_PAGE_TREE_DEPTH: usize = 64;
/// Page count hard stop (matches filter MAX_PAGES).
const MAX_PAGES: u32 = 2_000;
/// Wall-clock budget for the whole count operation.
const MAX_TRAVERSAL: Duration = Duration::from_secs(5);
/// How far to search back from `stream` for the owning dictionary when a full
/// reverse parse is ambiguous (comments/strings). Structural parse is preferred.
const STREAM_DICT_MAX_LOOKBACK: usize = 8 * 1024;
/// Max `Prev` / hybrid XRef chain length.
const MAX_XREF_CHAIN: usize = 32;

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

    // Bound every stream the loader will expand, and reject unsupported filters,
    // *before* `Document::load_mem` can allocate unbounded decode output.
    preflight_expandable_streams(&bytes, started)?;

    ensure_time(started)?;

    let document = Document::load_mem(&bytes)
        .map_err(|error| PdfError::Invalid(format!("unable to parse PDF page tree: {error}")))?;

    ensure_time(started)?;

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

fn ensure_time(started: Instant) -> Result<(), PdfError> {
    if started.elapsed() > MAX_TRAVERSAL {
        return Err(PdfError::ResourceLimit {
            resource: "page_tree_time_ms",
            limit: MAX_TRAVERSAL.as_millis() as u64,
            actual: started.elapsed().as_millis() as u64,
        });
    }
    Ok(())
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

/// Structural preflight: only ObjStm / XRef streams are decoded (the paths
/// `lopdf` expands during `load_mem`). Content and image streams are ignored.
fn preflight_expandable_streams(bytes: &[u8], started: Instant) -> Result<(), PdfError> {
    let mut total_decoded = 0_usize;

    // 1) startxref chain — every XRef stream the loader will hit.
    let mut xref_offset = find_startxref(bytes)?;
    let mut seen_xrefs = HashSet::new();
    for _ in 0..MAX_XREF_CHAIN {
        ensure_time(started)?;
        if !seen_xrefs.insert(xref_offset) {
            break;
        }
        if xref_offset >= bytes.len() {
            return Err(PdfError::Invalid(
                "PDF startxref points past end of file".to_string(),
            ));
        }
        let (next_prev, size_hint) =
            preflight_xref_at(bytes, xref_offset, &mut total_decoded, started)?;
        if let Some(size) = size_hint
            && size > MAX_RESOLVED_OBJECTS as u64
        {
            return Err(PdfError::ResourceLimit {
                resource: "page_tree_xref_size",
                limit: MAX_RESOLVED_OBJECTS as u64,
                actual: size,
            });
        }
        match next_prev {
            Some(prev) => xref_offset = prev,
            None => break,
        }
    }

    // 2) Every stream dictionary that declares /Type /ObjStm or /Type /XRef.
    //    XRef streams found here may already have been counted; re-decode is
    //    idempotent for the budget only if we skip already-validated ranges —
    //    we re-check bounds (cheap) rather than risk missing a second ObjStm.
    let mut search_from = 0_usize;
    while let Some(rel) = find_token(&bytes[search_from..], b"stream") {
        ensure_time(started)?;
        let stream_kw = search_from + rel;
        if !is_token_boundary(bytes, stream_kw, 6) {
            search_from = stream_kw + 6;
            continue;
        }
        let Some(data_start) = stream_data_start(bytes, stream_kw) else {
            search_from = stream_kw + 6;
            continue;
        };
        let Some(dict) = extract_stream_dict(bytes, stream_kw) else {
            // Unparseable stream dict — only fail if lookback hints ObjStm/XRef.
            let lookback_start = stream_kw.saturating_sub(STREAM_DICT_MAX_LOOKBACK);
            let preface = &bytes[lookback_start..stream_kw];
            if preface_suggests_expandable(preface) {
                return Err(PdfError::Invalid(
                    "PDF expandable stream dictionary is unparseable for page-tree preflight"
                        .to_string(),
                ));
            }
            search_from = data_start;
            continue;
        };

        let stream_type = dict.type_name.as_deref();
        let expandable = matches!(stream_type, Some("ObjStm") | Some("XRef"));
        if !expandable {
            // Content / image / other — loader does not decompress these at load.
            search_from = data_start;
            continue;
        }

        total_decoded = guard_expandable_dict(&dict, bytes, data_start, total_decoded)?;
        search_from = data_start.saturating_add(dict.length.unwrap_or(0));
    }

    Ok(())
}

fn preface_suggests_expandable(preface: &[u8]) -> bool {
    (find_token(preface, b"/ObjStm").is_some() || find_token(preface, b"/XRef").is_some())
        && find_token(preface, b"/Type").is_some()
}

/// Parse the object at `offset` if it is an XRef stream (or classic xref+trailer).
/// Returns optional Prev offset and optional Size for object-budget checks.
fn preflight_xref_at(
    bytes: &[u8],
    offset: usize,
    total_decoded: &mut usize,
    started: Instant,
) -> Result<(Option<usize>, Option<u64>), PdfError> {
    ensure_time(started)?;
    let slice = &bytes[offset..];

    // Classic `xref` table + `trailer << ... >>`.
    if slice.starts_with(b"xref") {
        return parse_classic_xref_trailer(slice);
    }

    // Cross-reference stream: `N G obj << ... >> stream ...`.
    let Some((dict, data_start)) = parse_stream_object_at(bytes, offset) else {
        // May be whitespace-prefixed; try skipping leading whitespace/comments.
        let mut i = offset;
        while i < bytes.len() && bytes[i].is_ascii_whitespace() {
            i += 1;
        }
        if i != offset {
            return preflight_xref_at(bytes, i, total_decoded, started);
        }
        return Err(PdfError::Invalid(
            "PDF xref target is neither an xref table nor a stream object".to_string(),
        ));
    };

    if dict.type_name.as_deref() != Some("XRef") && dict.type_name.is_some() {
        // Unusual but allow if it still looks like an xref stream (has /W + /Size).
        if dict.w_present && dict.size.is_some() {
            // treat as xref stream
        } else {
            return Err(PdfError::Invalid(
                "PDF startxref does not point at an XRef stream".to_string(),
            ));
        }
    }

    *total_decoded = guard_expandable_dict(&dict, bytes, data_start, *total_decoded)?;
    Ok((dict.prev, dict.size))
}

fn parse_classic_xref_trailer(slice: &[u8]) -> Result<(Option<usize>, Option<u64>), PdfError> {
    // Locate `trailer` then the dictionary.
    let Some(rel) = find_token(slice, b"trailer") else {
        return Err(PdfError::Invalid(
            "PDF classic xref is missing trailer".to_string(),
        ));
    };
    let after = rel + 7;
    let rest = trim_ascii_start(&slice[after..]);
    let Some(dict_bytes) = extract_top_dict(rest) else {
        return Err(PdfError::Invalid(
            "PDF trailer dictionary is unparseable".to_string(),
        ));
    };
    let dict = parse_stream_dict_keys(dict_bytes)?;
    Ok((dict.prev, dict.size))
}

fn guard_expandable_dict(
    dict: &StreamDictInfo,
    bytes: &[u8],
    data_start: usize,
    mut total_decoded: usize,
) -> Result<usize, PdfError> {
    // Filter policy: only identity (none) or single FlateDecode. LZW / multi /
    // indirect / unknown → fail closed before lopdf expands them.
    match &dict.filter {
        StreamFilter::None => {
            // Uncompressed expandable stream — bound by declared Length only.
            let length = dict.length.ok_or_else(|| {
                PdfError::Invalid(
                    "expandable PDF stream without a direct /Length is unsupported for page-tree preflight"
                        .to_string(),
                )
            })?;
            if length > MAX_STREAM_DECODED_BYTES {
                return Err(PdfError::ResourceLimit {
                    resource: "page_tree_stream_raw_bytes",
                    limit: MAX_STREAM_DECODED_BYTES as u64,
                    actual: length as u64,
                });
            }
            if data_start.saturating_add(length) > bytes.len() {
                return Err(PdfError::Invalid(
                    "PDF stream Length exceeds file bounds".to_string(),
                ));
            }
            total_decoded = total_decoded.saturating_add(length);
            if total_decoded > MAX_TOTAL_DECODED_BYTES {
                return Err(PdfError::ResourceLimit {
                    resource: "page_tree_decoded_bytes",
                    limit: MAX_TOTAL_DECODED_BYTES as u64,
                    actual: total_decoded as u64,
                });
            }
            Ok(total_decoded)
        }
        StreamFilter::Flate => {
            let length = dict.length.ok_or_else(|| {
                PdfError::Invalid(
                    "Flate expandable stream without a direct /Length is unsupported for page-tree preflight"
                        .to_string(),
                )
            })?;
            if length == 0 {
                return Ok(total_decoded);
            }
            if length > MAX_STREAM_DECODED_BYTES {
                return Err(PdfError::ResourceLimit {
                    resource: "page_tree_stream_compressed_bytes",
                    limit: MAX_STREAM_DECODED_BYTES as u64,
                    actual: length as u64,
                });
            }
            let data_end = data_start.saturating_add(length);
            if data_end > bytes.len() {
                return Err(PdfError::Invalid(
                    "PDF stream Length exceeds file bounds".to_string(),
                ));
            }
            let decoded = bounded_inflate(&bytes[data_start..data_end])?;
            total_decoded = total_decoded.saturating_add(decoded);
            if total_decoded > MAX_TOTAL_DECODED_BYTES {
                return Err(PdfError::ResourceLimit {
                    resource: "page_tree_decoded_bytes",
                    limit: MAX_TOTAL_DECODED_BYTES as u64,
                    actual: total_decoded as u64,
                });
            }
            Ok(total_decoded)
        }
        StreamFilter::Lzw => Err(PdfError::Invalid(
            "LZW expandable streams are unsupported for page-tree preflight (resource bound)"
                .to_string(),
        )),
        StreamFilter::Other(name) => Err(PdfError::Invalid(format!(
            "PDF filter /{name} on expandable streams is unsupported for page-tree preflight"
        ))),
        StreamFilter::Multi | StreamFilter::Indirect => Err(PdfError::Invalid(
            "indirect or multi-filter expandable streams are unsupported for page-tree preflight"
                .to_string(),
        )),
    }
}

#[derive(Debug, Clone)]
struct StreamDictInfo {
    type_name: Option<String>,
    filter: StreamFilter,
    length: Option<usize>,
    size: Option<u64>,
    prev: Option<usize>,
    w_present: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum StreamFilter {
    None,
    Flate,
    Lzw,
    Other(String),
    Multi,
    Indirect,
}

fn parse_stream_object_at(bytes: &[u8], offset: usize) -> Option<(StreamDictInfo, usize)> {
    // Expect: <objnum> <gen> obj << ... >> stream
    let rest = trim_ascii_start(&bytes[offset..]);
    let base = offset + (bytes[offset..].len() - rest.len());
    let (_num, rest) = parse_usize_prefix(rest)?;
    let rest = trim_ascii_start(rest);
    let (_gen, rest) = parse_usize_prefix(rest)?;
    let rest = trim_ascii_start(rest);
    if !rest.starts_with(b"obj") {
        return None;
    }
    let after_obj = trim_ascii_start(&rest[3..]);
    let dict_abs = base + (bytes[base..].len() - after_obj.len());
    let dict_bytes = extract_top_dict(after_obj)?;
    let dict_end_in_slice = 2 + dict_bytes.len() + 2; // << dict >>
    let after_dict = trim_ascii_start(&after_obj[dict_end_in_slice..]);
    if !after_dict.starts_with(b"stream") {
        return None;
    }
    let stream_kw = dict_abs + (bytes[dict_abs..].len() - after_dict.len());
    let data_start = stream_data_start(bytes, stream_kw)?;
    let info = parse_stream_dict_keys(dict_bytes).ok()?;
    Some((info, data_start))
}

fn extract_stream_dict(bytes: &[u8], stream_kw: usize) -> Option<StreamDictInfo> {
    // Walk back over whitespace before `stream`, then require `>>` and match `<<`.
    let mut i = stream_kw;
    while i > 0 && bytes[i - 1].is_ascii_whitespace() {
        i -= 1;
    }
    if i < 2 || &bytes[i - 2..i] != b">>" {
        return None;
    }
    let dict_end = i - 2;
    let dict_start = rfind_matching_dict_start(bytes, dict_end)?;
    let dict_bytes = &bytes[dict_start..dict_end];
    parse_stream_dict_keys(dict_bytes).ok()
}

fn rfind_matching_dict_start(bytes: &[u8], dict_end: usize) -> Option<usize> {
    // dict_end points at first byte after dict content (i.e. index of first `>` of `>>`).
    // Scan backward with minimal string/comment awareness.
    let limit = dict_end.saturating_sub(STREAM_DICT_MAX_LOOKBACK);
    let mut depth = 1_i32;
    let mut i = dict_end;
    let mut in_string = false;
    let mut string_escape = false;
    let mut string_paren = 0_i32;
    let mut in_hex = false;
    let mut in_name = false;

    while i > limit {
        i -= 1;
        let b = bytes[i];

        if in_string {
            if string_escape {
                string_escape = false;
                continue;
            }
            if b == b'\\' {
                // escape applies to the *next* byte when scanning forward; backward
                // is imperfect — treat `\` as ending escape state best-effort.
                string_escape = true;
                continue;
            }
            if b == b')' {
                string_paren += 1;
            } else if b == b'(' {
                string_paren -= 1;
                if string_paren <= 0 {
                    in_string = false;
                    string_paren = 0;
                }
            }
            continue;
        }
        if in_hex {
            if b == b'<' {
                in_hex = false;
            }
            continue;
        }
        if in_name {
            if b == b'/' || b.is_ascii_whitespace() || matches!(b, b'[' | b']' | b'(' | b'<' | b'>')
            {
                in_name = false;
                // fall through to reprocess this byte
            } else {
                continue;
            }
        }

        // Note: scanning backward, `>>` is seen as second `>` first.
        if b == b'>' && i > 0 && bytes[i - 1] == b'>' {
            // entering nested dict from the right
            depth += 1;
            i -= 1;
            continue;
        }
        if b == b'<' && i > 0 && bytes[i - 1] == b'<' {
            depth -= 1;
            i -= 1;
            if depth == 0 {
                return Some(i + 2); // content starts after `<<`
            }
            continue;
        }
        if b == b')' {
            // may be end of literal string when scanning back — enter string mode
            in_string = true;
            string_paren = 1;
            continue;
        }
        if b == b'>' && i > 0 && bytes[i - 1] != b'>' {
            // possible hex string end
            in_hex = true;
            continue;
        }
        if b == b'/' {
            in_name = true;
        }
    }
    None
}

fn extract_top_dict(input: &[u8]) -> Option<&[u8]> {
    let input = trim_ascii_start(input);
    if !input.starts_with(b"<<") {
        return None;
    }
    let mut depth = 0_i32;
    let mut i = 0_usize;
    let mut in_string = false;
    let mut string_escape = false;
    let mut string_paren = 0_i32;
    let mut in_hex = false;
    let mut in_name = false;

    while i < input.len() {
        let b = input[i];
        if in_string {
            if string_escape {
                string_escape = false;
                i += 1;
                continue;
            }
            match b {
                b'\\' => string_escape = true,
                b'(' => string_paren += 1,
                b')' => {
                    string_paren -= 1;
                    if string_paren <= 0 {
                        in_string = false;
                        string_paren = 0;
                    }
                }
                _ => {}
            }
            i += 1;
            continue;
        }
        if in_hex {
            if b == b'>' {
                in_hex = false;
            }
            i += 1;
            continue;
        }
        if in_name {
            if b.is_ascii_whitespace()
                || matches!(b, b'/' | b'[' | b']' | b'(' | b'<' | b'>' | b'%')
            {
                in_name = false;
            } else {
                i += 1;
                continue;
            }
        }
        if b == b'%' {
            // comment to EOL
            while i < input.len() && input[i] != b'\n' && input[i] != b'\r' {
                i += 1;
            }
            continue;
        }
        if b == b'(' {
            in_string = true;
            string_paren = 1;
            i += 1;
            continue;
        }
        if b == b'<' {
            if i + 1 < input.len() && input[i + 1] == b'<' {
                depth += 1;
                i += 2;
                continue;
            }
            in_hex = true;
            i += 1;
            continue;
        }
        if b == b'>' && i + 1 < input.len() && input[i + 1] == b'>' {
            depth -= 1;
            i += 2;
            if depth == 0 {
                // content is between first `<<` and this `>>`
                return Some(&input[2..i - 2]);
            }
            continue;
        }
        if b == b'/' {
            in_name = true;
        }
        i += 1;
    }
    None
}

fn parse_stream_dict_keys(dict_bytes: &[u8]) -> Result<StreamDictInfo, PdfError> {
    let mut type_name = None;
    let mut filter = StreamFilter::None;
    let mut length = None;
    let mut size = None;
    let mut prev = None;
    let mut w_present = false;

    let mut i = 0_usize;
    while i < dict_bytes.len() {
        if dict_bytes[i].is_ascii_whitespace() {
            i += 1;
            continue;
        }
        if dict_bytes[i] == b'%' {
            while i < dict_bytes.len() && dict_bytes[i] != b'\n' && dict_bytes[i] != b'\r' {
                i += 1;
            }
            continue;
        }
        if dict_bytes[i] != b'/' {
            // Skip unexpected token (arrays/dicts as values are handled when key is known).
            i = skip_value(dict_bytes, i);
            continue;
        }
        let (name, after_name) = parse_name(&dict_bytes[i..])?;
        i = dict_bytes.len() - after_name.len();
        let rest = trim_ascii_start(&dict_bytes[i..]);
        i = dict_bytes.len() - rest.len();

        match name.as_str() {
            "Type" => {
                let (value, consumed) = parse_optional_name_value(&dict_bytes[i..])?;
                type_name = value;
                i += consumed;
            }
            "Filter" => {
                let (f, consumed) = parse_filter_value(&dict_bytes[i..])?;
                filter = f;
                i += consumed;
            }
            "Length" => {
                let (len, consumed) = parse_direct_int_value(&dict_bytes[i..])?;
                length = len;
                i += consumed;
            }
            "Size" => {
                let (sz, consumed) = parse_direct_int_value(&dict_bytes[i..])?;
                size = sz.map(|v| v as u64);
                i += consumed;
            }
            "Prev" => {
                let (p, consumed) = parse_direct_int_value(&dict_bytes[i..])?;
                prev = p;
                i += consumed;
            }
            "W" => {
                w_present = true;
                i = skip_value(dict_bytes, i);
            }
            _ => {
                i = skip_value(dict_bytes, i);
            }
        }
    }

    Ok(StreamDictInfo {
        type_name,
        filter,
        length,
        size,
        prev,
        w_present,
    })
}

fn parse_name(input: &[u8]) -> Result<(String, &[u8]), PdfError> {
    if !input.starts_with(b"/") {
        return Err(PdfError::Invalid("expected PDF name".to_string()));
    }
    let mut i = 1;
    while i < input.len() {
        let b = input[i];
        if b.is_ascii_whitespace()
            || matches!(
                b,
                b'/' | b'[' | b']' | b'(' | b')' | b'<' | b'>' | b'%' | b'{' | b'}'
            )
        {
            break;
        }
        i += 1;
    }
    let name = std::str::from_utf8(&input[1..i])
        .map_err(|_| PdfError::Invalid("PDF name is not UTF-8".to_string()))?
        .to_string();
    Ok((name, &input[i..]))
}

fn parse_optional_name_value(input: &[u8]) -> Result<(Option<String>, usize), PdfError> {
    let rest = trim_ascii_start(input);
    let consumed_ws = input.len() - rest.len();
    if rest.starts_with(b"/") {
        let (name, after) = parse_name(rest)?;
        let consumed = consumed_ws + (rest.len() - after.len());
        Ok((Some(name), consumed))
    } else if rest.starts_with(b"<<") {
        // Unexpected; skip.
        let after_skip = skip_value(rest, 0);
        Ok((None, consumed_ws + after_skip))
    } else {
        // Indirect ref or other — treat as absent direct name.
        let after_skip = skip_value(rest, 0);
        Ok((None, consumed_ws + after_skip))
    }
}

fn parse_filter_value(input: &[u8]) -> Result<(StreamFilter, usize), PdfError> {
    let rest = trim_ascii_start(input);
    let consumed_ws = input.len() - rest.len();
    if rest.starts_with(b"/") {
        let (name, after) = parse_name(rest)?;
        let consumed = consumed_ws + (rest.len() - after.len());
        Ok((classify_filter_name(&name), consumed))
    } else if rest.starts_with(b"[") {
        // Filter array — any multi-filter chain is rejected for expandable streams.
        let after = skip_value(rest, 0);
        // Peek names inside for a more specific error if single-element.
        let inner = extract_array_names(rest);
        let filter = match inner.as_slice() {
            [] => StreamFilter::None,
            [one] => classify_filter_name(one),
            _ => StreamFilter::Multi,
        };
        // Even a single-element array is fine if it's Flate; multi is not.
        if matches!(
            filter,
            StreamFilter::Flate | StreamFilter::None | StreamFilter::Lzw | StreamFilter::Other(_)
        ) && inner.len() > 1
        {
            return Ok((StreamFilter::Multi, consumed_ws + after));
        }
        if inner.len() > 1 {
            return Ok((StreamFilter::Multi, consumed_ws + after));
        }
        Ok((filter, consumed_ws + after))
    } else if looks_like_indirect_ref(rest) {
        let after = skip_value(rest, 0);
        Ok((StreamFilter::Indirect, consumed_ws + after))
    } else {
        let after = skip_value(rest, 0);
        Ok((StreamFilter::Other("unknown".into()), consumed_ws + after))
    }
}

fn classify_filter_name(name: &str) -> StreamFilter {
    match name {
        "FlateDecode" | "Fl" => StreamFilter::Flate,
        "LZWDecode" | "LZW" => StreamFilter::Lzw,
        other => StreamFilter::Other(other.to_string()),
    }
}

fn extract_array_names(input: &[u8]) -> Vec<String> {
    let mut names = Vec::new();
    if !input.starts_with(b"[") {
        return names;
    }
    let mut i = 1;
    while i < input.len() {
        if input[i] == b']' {
            break;
        }
        if input[i] == b'/'
            && let Ok((name, after)) = parse_name(&input[i..])
        {
            names.push(name);
            i = input.len() - after.len();
            continue;
        }
        i += 1;
    }
    names
}

fn parse_direct_int_value(input: &[u8]) -> Result<(Option<usize>, usize), PdfError> {
    let rest = trim_ascii_start(input);
    let consumed_ws = input.len() - rest.len();
    if looks_like_indirect_ref(rest) {
        // Indirect — not resolved in preflight.
        let after = skip_value(rest, 0);
        return Ok((None, consumed_ws + after));
    }
    if let Some((num, after)) = parse_usize_prefix(rest) {
        // Ensure it's not the first half of `N G R` we already handled... already checked.
        let consumed = consumed_ws + (rest.len() - after.len());
        // If after is ` G R`, treat as indirect missed by looks_like (generation != pattern).
        let after_trim = trim_ascii_start(after);
        if let Some((_generation, after_gen)) = parse_usize_prefix(after_trim) {
            let after_gen = trim_ascii_start(after_gen);
            if after_gen.starts_with(b"R") {
                let total = consumed_ws + (rest.len() - after_gen.len()) + 1;
                return Ok((None, total.min(input.len())));
            }
        }
        return Ok((Some(num), consumed));
    }
    let after = skip_value(rest, 0);
    Ok((None, consumed_ws + after))
}

fn looks_like_indirect_ref(input: &[u8]) -> bool {
    let rest = trim_ascii_start(input);
    let Some((_, after_n)) = parse_usize_prefix(rest) else {
        return false;
    };
    let after_n = trim_ascii_start(after_n);
    let Some((_, after_g)) = parse_usize_prefix(after_n) else {
        return false;
    };
    let after_g = trim_ascii_start(after_g);
    after_g.starts_with(b"R")
}

fn skip_value(input: &[u8], start: usize) -> usize {
    let slice = &input[start..];
    let rest = trim_ascii_start(slice);
    let mut i = start + (slice.len() - rest.len());
    if i >= input.len() {
        return input.len();
    }
    match input[i] {
        b'<' if i + 1 < input.len() && input[i + 1] == b'<' => {
            if let Some(inner) = extract_top_dict(&input[i..]) {
                // `<<` + inner + `>>`
                i + 2 + inner.len() + 2
            } else {
                input.len()
            }
        }
        b'[' => {
            i += 1;
            let mut depth = 1_i32;
            while i < input.len() && depth > 0 {
                match input[i] {
                    b'[' => depth += 1,
                    b']' => depth -= 1,
                    b'(' => {
                        // skip string
                        i += 1;
                        let mut esc = false;
                        let mut p = 1_i32;
                        while i < input.len() && p > 0 {
                            let b = input[i];
                            if esc {
                                esc = false;
                            } else if b == b'\\' {
                                esc = true;
                            } else if b == b'(' {
                                p += 1;
                            } else if b == b')' {
                                p -= 1;
                            }
                            i += 1;
                        }
                        continue;
                    }
                    _ => {}
                }
                i += 1;
            }
            i
        }
        b'(' => {
            i += 1;
            let mut esc = false;
            let mut p = 1_i32;
            while i < input.len() && p > 0 {
                let b = input[i];
                if esc {
                    esc = false;
                } else if b == b'\\' {
                    esc = true;
                } else if b == b'(' {
                    p += 1;
                } else if b == b')' {
                    p -= 1;
                }
                i += 1;
            }
            i
        }
        b'/' => {
            let (_, after) = match parse_name(&input[i..]) {
                Ok(v) => v,
                Err(_) => return input.len(),
            };
            input.len() - after.len()
        }
        b't' if input[i..].starts_with(b"true") => i + 4,
        b'f' if input[i..].starts_with(b"false") => i + 5,
        b'n' if input[i..].starts_with(b"null") => i + 4,
        b'+' | b'-' | b'0'..=b'9' | b'.' => {
            // number or indirect ref
            let rest = &input[i..];
            if looks_like_indirect_ref(rest) {
                // consume N G R
                let mut j = i;
                while j < input.len() && (input[j].is_ascii_digit()) {
                    j += 1;
                }
                while j < input.len() && input[j].is_ascii_whitespace() {
                    j += 1;
                }
                while j < input.len() && input[j].is_ascii_digit() {
                    j += 1;
                }
                while j < input.len() && input[j].is_ascii_whitespace() {
                    j += 1;
                }
                if j < input.len() && input[j] == b'R' {
                    j + 1
                } else {
                    j
                }
            } else {
                let mut j = i;
                while j < input.len()
                    && (input[j].is_ascii_digit()
                        || input[j] == b'.'
                        || input[j] == b'+'
                        || input[j] == b'-')
                {
                    j += 1;
                }
                j
            }
        }
        _ => i + 1,
    }
}

fn find_startxref(bytes: &[u8]) -> Result<usize, PdfError> {
    // PDF readers search near EOF for the last `startxref`.
    let search_window = bytes.len().min(65_536);
    let window = &bytes[bytes.len() - search_window..];
    let mut last = None;
    let mut pos = 0;
    while let Some(rel) = find_token(&window[pos..], b"startxref") {
        let at = pos + rel;
        if is_token_boundary(window, at, 9) {
            last = Some(at);
        }
        pos = at + 9;
    }
    let at = last.ok_or_else(|| PdfError::Invalid("PDF missing startxref".to_string()))?;
    let abs = bytes.len() - search_window + at;
    let after = trim_ascii_start(&bytes[abs + 9..]);
    let (offset, _) = parse_usize_prefix(after)
        .ok_or_else(|| PdfError::Invalid("PDF startxref offset is not an integer".to_string()))?;
    Ok(offset)
}

/// PDF allows `stream\n`, `stream\r\n`, and `stream\r` before data.
fn stream_data_start(bytes: &[u8], stream_kw: usize) -> Option<usize> {
    let after_kw = stream_kw + 6;
    if after_kw >= bytes.len() {
        return None;
    }
    match bytes[after_kw] {
        b'\n' => Some(after_kw + 1),
        b'\r' => {
            if bytes.get(after_kw + 1) == Some(&b'\n') {
                Some(after_kw + 2)
            } else {
                Some(after_kw + 1)
            }
        }
        // Some writers put a single space; not strictly conforming — reject so
        // we do not mis-bound the payload.
        _ => None,
    }
}

fn is_token_boundary(bytes: &[u8], at: usize, token_len: usize) -> bool {
    if at > 0 {
        let prev = bytes[at - 1];
        if prev.is_ascii_alphanumeric() || prev == b'/' {
            return false;
        }
    }
    let end = at + token_len;
    if end < bytes.len() {
        let next = bytes[end];
        if next.is_ascii_alphanumeric() {
            return false;
        }
    }
    true
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

fn find_token(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
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

/// Strict page-tree walk: missing/malformed kids, cycles, depth/time/object
/// overruns, and Count mismatches at **every** `/Pages` node are hard errors.
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
    let count = walk_pages_node(document, pages_ref, 0, &mut seen, &mut resolved, started)?;
    Ok(count)
}

fn walk_pages_node(
    document: &Document,
    id: ObjectId,
    depth: usize,
    seen: &mut HashSet<ObjectId>,
    resolved: &mut usize,
    started: Instant,
) -> Result<u32, PdfError> {
    ensure_time(started)?;
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
        "Page" => Ok(1),
        "Pages" => {
            // Fail closed: /Count is required and must be a non-negative integer.
            let count_obj = dict
                .get(b"Count")
                .map_err(|_| PdfError::Invalid("PDF /Pages node is missing /Count".to_string()))?;
            let declared = object_as_u32(document, count_obj)?;

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
                let child_count =
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
            if declared != total {
                return Err(PdfError::Invalid(format!(
                    "PDF page-tree /Count {declared} does not match walked pages {total}"
                )));
            }
            Ok(total)
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
        write_free(&mut xref_data);
        write_normal(&mut xref_data, obj1_at);
        write_normal(&mut xref_data, obj2_at);
        for i in 0..pages {
            write_compressed(&mut xref_data, i as u16);
        }
        for _ in (last_page + 1)..100 {
            write_free(&mut xref_data);
        }
        write_normal(&mut xref_data, obj100_at);
        write_normal(&mut xref_data, obj101_at);

        let mut enc = ZlibEncoder::new(Vec::new(), Compression::default());
        enc.write_all(&xref_data).unwrap();
        let xref_compressed = enc.finish().unwrap();

        let size = 102;
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

    /// Flate bomb inside an **ObjStm** (the path `lopdf` expands at load).
    fn write_objstm_flate_bomb_pdf(path: &Path) {
        let huge = vec![0_u8; MAX_STREAM_DECODED_BYTES + 64 * 1024];
        let mut encoder = ZlibEncoder::new(Vec::new(), Compression::best());
        encoder.write_all(&huge).unwrap();
        let compressed = encoder.finish().unwrap();
        assert!(compressed.len() < 64 * 1024);

        let mut pdf = Vec::new();
        pdf.extend_from_slice(b"%PDF-1.5\n");
        let obj1 = pdf.len();
        pdf.extend_from_slice(b"1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
        let obj2 = pdf.len();
        pdf.extend_from_slice(b"2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n");
        let obj3 = pdf.len();
        pdf.extend_from_slice(
            b"3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj\n",
        );
        let obj4 = pdf.len();
        let stream_dict = format!(
            "4 0 obj\n<< /Type /ObjStm /N 0 /First 0 /Filter /FlateDecode /Length {} >>\nstream\n",
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

    /// LZW-filtered ObjStm — must fail closed without entering weezl.
    fn write_objstm_lzw_pdf(path: &Path) {
        // Minimal fake LZW payload (not valid LZW; preflight must reject before decode).
        let payload = b"\x80\x00";
        let mut pdf = Vec::new();
        pdf.extend_from_slice(b"%PDF-1.5\n");
        let obj1 = pdf.len();
        pdf.extend_from_slice(b"1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
        let obj2 = pdf.len();
        pdf.extend_from_slice(b"2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n");
        let obj3 = pdf.len();
        pdf.extend_from_slice(
            b"3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj\n",
        );
        let obj4 = pdf.len();
        let stream_dict = format!(
            "4 0 obj\n<< /Type /ObjStm /N 0 /First 0 /Filter /LZWDecode /Length {} >>\nstream\n",
            payload.len()
        );
        pdf.extend_from_slice(stream_dict.as_bytes());
        pdf.extend_from_slice(payload);
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

    /// Padded ObjStm dictionary (whitespace / multi-line) with direct Flate — must still count.
    fn write_padded_objstm_pdf(path: &Path) {
        let raw = b"3 0 << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >> ";
        // ObjStm format: index pairs then objects. N=1, First=index len.
        let index = b"3 0 ";
        let mut body = index.to_vec();
        body.extend_from_slice(b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >> ");
        let first = index.len();
        let mut encoder = ZlibEncoder::new(Vec::new(), Compression::default());
        encoder.write_all(&body).unwrap();
        let compressed = encoder.finish().unwrap();

        let mut pdf = Vec::new();
        pdf.extend_from_slice(b"%PDF-1.5\n");
        let obj1 = pdf.len();
        pdf.extend_from_slice(b"1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
        let obj2 = pdf.len();
        pdf.extend_from_slice(b"2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n");
        let obj100 = pdf.len();
        // Heavily padded dictionary — previously exceeded a 512-byte lookback heuristic.
        let padding = " ".repeat(600);
        let header = format!(
            "100 0 obj\n<< /Type{padding}/ObjStm /N 1 /First {first} /Filter{padding}/FlateDecode /Length {} >>\nstream\n",
            compressed.len()
        );
        let _ = raw;
        pdf.extend_from_slice(header.as_bytes());
        pdf.extend_from_slice(&compressed);
        pdf.extend_from_slice(b"\nendstream\nendobj\n");
        let obj101 = pdf.len();

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
        let mut xref_data = Vec::new();
        write_free(&mut xref_data);
        write_normal(&mut xref_data, obj1);
        write_normal(&mut xref_data, obj2);
        write_compressed(&mut xref_data, 0);
        for _ in 4..100 {
            write_free(&mut xref_data);
        }
        write_normal(&mut xref_data, obj100);
        write_normal(&mut xref_data, obj101);
        let mut enc = ZlibEncoder::new(Vec::new(), Compression::default());
        enc.write_all(&xref_data).unwrap();
        let xref_compressed = enc.finish().unwrap();
        pdf.extend_from_slice(
            format!(
                "101 0 obj\n<< /Type /XRef /Size 102 /W [1 2 2] /Root 1 0 R /Filter /FlateDecode /Length {} >>\nstream\n",
                xref_compressed.len()
            )
            .as_bytes(),
        );
        pdf.extend_from_slice(&xref_compressed);
        pdf.extend_from_slice(b"\nendstream\nendobj\n");
        pdf.extend_from_slice(format!("startxref\n{obj101}\n%%EOF\n").as_bytes());
        fs::write(path, pdf).unwrap();
    }

    /// Large Flate **content** stream on a page — must still count pages (not expand content).
    fn write_image_heavy_scanned_pdf(path: &Path) {
        // ~2 MiB of zeros compresses small; if preflight decoded content streams into the
        // aggregate budget repeatedly, multi-image docs would fail. One large stream is enough
        // to show content is not part of the expandable budget.
        let huge = vec![0_u8; 2 * 1024 * 1024];
        let mut encoder = ZlibEncoder::new(Vec::new(), Compression::best());
        encoder.write_all(&huge).unwrap();
        let compressed = encoder.finish().unwrap();

        let mut pdf = Vec::new();
        pdf.extend_from_slice(b"%PDF-1.4\n");
        let obj1 = pdf.len();
        pdf.extend_from_slice(b"1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
        let obj2 = pdf.len();
        pdf.extend_from_slice(b"2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n");
        let obj3 = pdf.len();
        pdf.extend_from_slice(
            b"3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /XObject << /Im0 5 0 R >> >> >>\nendobj\n",
        );
        let obj4 = pdf.len();
        // Tiny content stream
        pdf.extend_from_slice(b"4 0 obj\n<< /Length 0 >>\nstream\nendstream\nendobj\n");
        let obj5 = pdf.len();
        let img = format!(
            "5 0 obj\n<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /BitsPerComponent 8 /ColorSpace /DeviceGray /Filter /FlateDecode /Length {} >>\nstream\n",
            compressed.len()
        );
        pdf.extend_from_slice(img.as_bytes());
        pdf.extend_from_slice(&compressed);
        pdf.extend_from_slice(b"\nendstream\nendobj\n");
        let xref_at = pdf.len();
        let mut xref = String::from("xref\n0 6\n0000000000 65535 f \n");
        for offset in [obj1, obj2, obj3, obj4, obj5] {
            xref.push_str(&format!("{offset:010} 00000 n \n"));
        }
        pdf.extend_from_slice(xref.as_bytes());
        pdf.extend_from_slice(
            format!("trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n{xref_at}\n%%EOF\n").as_bytes(),
        );
        fs::write(path, pdf).unwrap();
    }

    fn write_nested_count_mismatch_pdf(path: &Path) {
        use lopdf::dictionary;
        let mut doc = Document::with_version("1.4");
        let page_id = doc.add_object(dictionary! {
            "Type" => "Page",
            "MediaBox" => vec![0.into(), 0.into(), 612.into(), 792.into()],
        });
        // Nested /Pages lies about Count (claims 2, has 1 page kid).
        let nested_id = doc.add_object(dictionary! {
            "Type" => "Pages",
            "Kids" => vec![page_id.into()],
            "Count" => 2_i64,
        });
        let root_pages = doc.add_object(dictionary! {
            "Type" => "Pages",
            "Kids" => vec![nested_id.into()],
            "Count" => 2_i64,
        });
        let catalog_id = doc.add_object(dictionary! {
            "Type" => "Catalog",
            "Pages" => root_pages,
        });
        doc.trailer.set("Root", catalog_id);
        doc.save(path).expect("save nested mismatch");
    }

    fn write_cr_only_stream_objstm(path: &Path) {
        let index = b"3 0 ";
        let mut body = index.to_vec();
        body.extend_from_slice(b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >> ");
        let first = index.len();
        let mut encoder = ZlibEncoder::new(Vec::new(), Compression::default());
        encoder.write_all(&body).unwrap();
        let compressed = encoder.finish().unwrap();

        let mut pdf = Vec::new();
        pdf.extend_from_slice(b"%PDF-1.5\n");
        let obj1 = pdf.len();
        pdf.extend_from_slice(b"1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
        let obj2 = pdf.len();
        pdf.extend_from_slice(b"2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n");
        let obj100 = pdf.len();
        // CR-only line ending after `stream` (no LF).
        let header = format!(
            "100 0 obj\n<< /Type /ObjStm /N 1 /First {first} /Filter /FlateDecode /Length {} >>\nstream\r",
            compressed.len()
        );
        pdf.extend_from_slice(header.as_bytes());
        pdf.extend_from_slice(&compressed);
        pdf.extend_from_slice(b"\rendstream\rendobj\n");
        let obj101 = pdf.len();
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
        let mut xref_data = Vec::new();
        write_free(&mut xref_data);
        write_normal(&mut xref_data, obj1);
        write_normal(&mut xref_data, obj2);
        write_compressed(&mut xref_data, 0);
        for _ in 4..100 {
            write_free(&mut xref_data);
        }
        write_normal(&mut xref_data, obj100);
        write_normal(&mut xref_data, obj101);
        let mut enc = ZlibEncoder::new(Vec::new(), Compression::default());
        enc.write_all(&xref_data).unwrap();
        let xref_compressed = enc.finish().unwrap();
        pdf.extend_from_slice(
            format!(
                "101 0 obj\n<< /Type /XRef /Size 102 /W [1 2 2] /Root 1 0 R /Filter /FlateDecode /Length {} >>\nstream\n",
                xref_compressed.len()
            )
            .as_bytes(),
        );
        pdf.extend_from_slice(&xref_compressed);
        pdf.extend_from_slice(b"\nendstream\nendobj\n");
        pdf.extend_from_slice(format!("startxref\n{obj101}\n%%EOF\n").as_bytes());
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
    fn rejects_objstm_flate_amplification() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("bomb.pdf");
        write_objstm_flate_bomb_pdf(&path);
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
    fn rejects_objstm_lzw_before_load() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("lzw.pdf");
        write_objstm_lzw_pdf(&path);
        let err = count_page_tree_bounded(&path).expect_err("lzw");
        let message = err.to_string();
        assert!(
            message.contains("LZW")
                || message.contains("unsupported")
                || message.contains("invalid"),
            "unexpected: {message}"
        );
    }

    #[test]
    fn counts_padded_objstm_dictionary() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("padded.pdf");
        write_padded_objstm_pdf(&path);
        let count = count_page_tree_bounded(&path).expect("padded objstm");
        assert_eq!(count, 1);
    }

    #[test]
    fn accepts_image_heavy_scanned_pdf() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("scan.pdf");
        write_image_heavy_scanned_pdf(&path);
        let count = count_page_tree_bounded(&path).expect("image-heavy should pass preflight");
        assert_eq!(count, 1);
    }

    #[test]
    fn rejects_nested_count_mismatch() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("count.pdf");
        write_nested_count_mismatch_pdf(&path);
        let err = count_page_tree_bounded(&path).expect_err("count mismatch");
        assert!(matches!(err, PdfError::Invalid(_)), "got {err:?}");
        let message = err.to_string();
        assert!(
            message.contains("Count") || message.contains("count"),
            "unexpected: {message}"
        );
    }

    #[test]
    fn counts_cr_only_stream_line_ending() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("cr.pdf");
        write_cr_only_stream_objstm(&path);
        let count = count_page_tree_bounded(&path).expect("CR-only stream");
        assert_eq!(count, 1);
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

    #[test]
    fn rejects_oversized_xref_size_hint() {
        // Classic trailer with Size above the object budget — fail before load expands.
        let mut pdf = Vec::new();
        pdf.extend_from_slice(b"%PDF-1.4\n");
        let obj1 = pdf.len();
        pdf.extend_from_slice(b"1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
        let obj2 = pdf.len();
        pdf.extend_from_slice(b"2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\n");
        let xref_at = pdf.len();
        pdf.extend_from_slice(b"xref\n0 3\n0000000000 65535 f \n");
        pdf.extend_from_slice(format!("{obj1:010} 00000 n \n").as_bytes());
        pdf.extend_from_slice(format!("{obj2:010} 00000 n \n").as_bytes());
        let huge_size = MAX_RESOLVED_OBJECTS + 10;
        pdf.extend_from_slice(
            format!("trailer\n<< /Size {huge_size} /Root 1 0 R >>\nstartxref\n{xref_at}\n%%EOF\n")
                .as_bytes(),
        );
        let dir = tempdir().unwrap();
        let path = dir.path().join("big-xref.pdf");
        fs::write(&path, pdf).unwrap();
        let err = count_page_tree_bounded(&path).expect_err("xref size");
        match err {
            PdfError::ResourceLimit { resource, .. } => {
                assert!(
                    resource.contains("xref") || resource.contains("objects"),
                    "resource={resource}"
                );
            }
            // Classic xref Size is a hint; if trailer parse misses Size we may still
            // fail later as invalid page count (0 pages). Either fail-closed outcome is OK.
            PdfError::Invalid(_) => {}
            other => panic!("expected limit or invalid, got {other:?}"),
        }
    }
}

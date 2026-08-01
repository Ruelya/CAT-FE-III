# Fidelity / format corpus status

**Candidate:** `8c8df12fceef913073b683c0cfe0877dd8148aac`  
**Date:** 2026-08-02

## What ran

| Lane | Result |
| --- | --- |
| `cargo test` filter crates (docx/xlsx/pptx/html/text/xliff/pdf/interop) | **pass** (unit level) |
| Default `scripts/engine-smoke.mjs` multi-format path | **fail** at first PDF case |
| PDF probe via `document.import` | auto: `unsupported_document` / no match; explicit `builtin.pdf`: `PDF tool pdfinfo failed` |
| Human layout review ≥95% | **not-run** |
| 50-document real corpus | **not-run** |

## Host tool reality

- `pdftotext` present: `/mingw64/bin/pdftotext.exe`
- `pdfinfo` **not** on PATH
- `tesseract` **not** found
- `translunar-filter-pdf` tests call `tools_available()` and **return early** when tools missing — so green unit tests do **not** prove process PDF import on this host

## Verdict

**fail** for RQ6 / AC6 on this candidate freeze.  
Route: install full Poppler (`pdfinfo`, `pdftoppm`) + Tesseract for env; product ownership remains `07-19-pdf-ocr-workflow` if import still fails with tools present. Non-PDF formats need a successful default smoke (or focused multi-format smoke) before claiming pass.

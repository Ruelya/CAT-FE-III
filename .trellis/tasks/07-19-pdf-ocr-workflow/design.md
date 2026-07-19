# Technical Design: PDF Text And OCR Workflow

## 1. Architecture

```text
filter-pdf
  -> bounded PdfToolchain (pdftotext, pdfinfo, pdftoppm, tesseract)
  -> bbox/TSV parsers + layout/read-order heuristics
  -> generic FilterEvent units/notes/degradation
  -> Engine/Store (same import transaction)

renderer -> pdf.page.list/get -> Engine -> managed PDF -> rendered PNG/base64
renderer -> pdf.correctOcr  -> Store transaction + history
PDF segments -> filter-pdf DOCX builder -> filter-docx validation -> publish
```

The filter owns PDF/OCR semantics. Engine owns managed paths, service methods,
and authorization of document/segment identity. Electron owns dialogs and
display only.

## 2. Toolchain Contract

Resolution order for each executable is request option, environment variable,
then executable name on `PATH`:

```text
pdfTextCommand   / TRANSLUNAR_PDFTOTEXT_PATH / pdftotext
pdfInfoCommand   / TRANSLUNAR_PDFINFO_PATH   / pdfinfo
pdfRenderCommand / TRANSLUNAR_PDFTOPPM_PATH  / pdftoppm
ocrCommand       / TRANSLUNAR_TESSERACT_PATH / tesseract
```

Paths are passed to `Command::new`; no string is interpreted by a shell. Each
invocation has a 60-second default/300-second maximum timeout, a 128 MiB output
cap, killed-child cleanup, sanitized stderr summary, and explicit exit/status
classification. Tests inject deterministic executables; release qualification
also runs real Poppler/Tesseract fixtures.

## 3. Extraction And Structural Paths

`pdftotext -bbox-layout -enc UTF-8` yields page/flow/block/line/word geometry.
The parser groups words into lines and blocks, normalizes only inter-word
spacing, then assigns reading order using flow order with a stable y/x fallback.
Repeated aligned gaps produce a table candidate; large line height produces a
heading candidate. SRX sentence mode subdivides a block while retaining the
parent bbox.

Paths are opaque but self-describing:

```text
pdf:p=<page>;b=<order>;k=<paragraph|heading|table>;x=<mpt>;y=<mpt>;
    w=<mpt>;h=<mpt>;s=<text|ocr>;c=<0..1000>
```

Coordinates are integer milli-points to avoid floating serialization drift.
OCR confidence is `0..1000`; text-layer confidence is 1000. Notes record OCR
engine/language/confidence without storing full tool output.

## 4. OCR Flow

1. Parse text-layer pages and mark pages with meaningful word content.
2. Apply page selection and `ocrMode`.
3. Render required pages to a temporary PNG at bounded DPI.
4. Run Tesseract TSV; reject invalid columns/page numbers/coordinates.
5. Group positive-confidence words by block/paragraph/line and transform pixel
   coordinates to PDF points.
6. Emit OCR units and confidence notes. If a required page yields no text,
   return an error naming only the page and tool classification.

Temporary images live in a filter-owned temp directory and are removed on every
success/error path. Page review rerenders one page on demand; previews are
derived and are not backed up or persisted in SQLite.

## 5. Page Review Protocol

Additive protocol v1 methods:

```text
pdf.page.list PdfPageListParams -> PdfPageListResult
pdf.page.get  PdfPageGetParams  -> PdfPageDetail
pdf.correctOcr CorrectOcrParams -> Segment
```

Page list groups stored PDF structural paths. Page get validates the document
filter and page range, renders one PNG, base64-encodes it, and returns blocks:
segment ID/revision, source/target, bbox, kind, source kind, confidence, and
state. DPI is limited to 72..200 and PNG bytes to 32 MiB.

OCR correction requires non-empty source/reason, expected revision, an OCR
path, and non-confirmed state. In one immediate transaction it updates source,
revision/time, recalculates current and neighboring context hashes, appends a
reasoned operation, and returns the authoritative segment. Stale or wrong-kind
updates do nothing.

## 6. DOCX Reconstruction

The exporter parses stored PDF paths and sorts by page/order. It creates a
minimal valid DOCX package with page dimensions, explicit page breaks,
Heading1/body styles, and table rows for table candidates. Targets replace
source only when non-empty. Page images/graphics remain absent and generate
degradation findings. Target/source length ratios and bbox capacity produce
overflow-risk warnings. The staged DOCX is validated through `DocxFilter`
before no-clobber publication.

## 7. Desktop Flow

The source picker accepts all registered P0 extensions and Setup uses
`document.import`. A PDF active document makes the existing preview panel load
page summaries, follow the active block, and lazily fetch a page image. OCR
blocks expose an edit command with required reason; the renderer replaces state
only with the Engine response. Export calls generic `document.export` and
suggests `<source>-translated.docx` for PDF.

## 8. Compatibility And Rollback

Protocol additions are optional and old clients continue to use existing
methods. No schema migration is required because layout/confidence are encoded
in structural paths and previews are derived. Removing the PDF registry entry
and methods disables the feature without affecting earlier documents. Tool
absence never corrupts a workspace; import/page-render/export stages remain
private until validation succeeds.

# MinerU OCR for PDF import

Prefer MinerU over the local Tesseract path when a MinerU HTTP endpoint is
configured. This covers Full PRD HB3 (scanned/mixed PDF OCR via HTTP API).
HB10 (follow-on multimodal aid) remains scheduled after this path is complete.

## Configuration

| Item | Value |
|------|--------|
| Base URL env | `TRANSLUNAR_MINERU_BASE_URL` (e.g. `http://127.0.0.1:8000`) |
| Request timeout env | `TRANSLUNAR_MINERU_TIMEOUT_MS` (default `120000`, max `600000`) |
| Page limit env | `TRANSLUNAR_MINERU_MAX_PAGES` (default `200`) |
| Size limit env | `TRANSLUNAR_MINERU_MAX_BYTES` (default `209715200` = 200 MiB) |
| OS keyring service | `translunar-cat.mineru` |
| OS keyring account | `default` |
| Test mode env | `TRANSLUNAR_MINERU_TEST_MODE=1` |
| Test API key env | `TRANSLUNAR_MINERU_TEST_API_KEY` (memory backend only) |

Import options:

- `ocrEngine=mineru|tesseract|auto` — default `auto` uses MinerU when the base
  URL is configured; `tesseract` forces the local Poppler/Tesseract path.
- `ocrMode=auto|always|never` — `never` disables MinerU; `always` forces
  MinerU `parse_method=ocr`.
- `ocrLanguages` / `lang` — forwarded as MinerU `lang_list` (default `ch`).
- `pageRange` — `N` or `N-M` (1-based); mapped to MinerU `start_page_id` /
  `end_page_id` (0-based).

## Behaviour

1. PDF `document.import` selects `builtin.pdf`.
2. When MinerU is configured and not overridden by `ocrEngine=tesseract` /
   `ocrMode=never`, Engine calls `POST {base}/file_parse` (mineru-api) with
   `return_content_list=true` and Bearer auth from the keyring.
3. `content_list` blocks map to segments with structural paths
   `pdf:p=…;b=…;k=…;x=…;y=…;w=…;h=…;s=ocr;c=…`.
4. Failures are typed before any managed source/document is published:
   missing key, timeout, unavailable, auth, protocol/empty, resource limits.

Secrets never appear in SQLite, project files, degradation messages, or RPC
error text.

## Acceptance evidence (focused tests)

No live MinerU is required. Run:

```bash
cargo test -p translunar-engine mineru -- --nocapture
```

| AC | Test names |
|----|------------|
| AC-01 mock OCR → import succeeds | `mock_transport_import_produces_ocr_segments`, `mineru_mock_import_succeeds_with_ocr_segments` |
| AC-02 missing key / network → typed error, no partial document | `missing_credential_is_typed`, `mineru_missing_key_aborts_import_without_document`, `mineru_network_failure_is_typed_and_leaves_project_clean`, `network_timeout_is_typed` |
| AC-03 secrets never in SQLite/logs | `secret_never_appears_in_imported_document_or_errors`, SQLite scan in `mineru_mock_import_succeeds_with_ocr_segments` |
| AC-04 focused tests green | full `mineru` filter above |

## Relation to residual tooling

Poppler (`pdftotext` / `pdfinfo` / `pdftoppm`) and Tesseract remain the optional
local OCR residual when MinerU is not configured. They are not removed by this
path.

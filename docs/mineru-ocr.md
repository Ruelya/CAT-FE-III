# MinerU OCR for PDF import

MinerU is selected **only** when import options set `ocrEngine=mineru` (and
`ocrMode` is not `never`). Configuring a base URL alone does not switch ordinary
text-layer PDFs onto MinerU. This covers Full PRD HB3 (scanned/mixed PDF OCR via
HTTP API). HB10 (follow-on multimodal aid) remains scheduled after this path is
complete.

## Configuration

| Item | Value |
|------|--------|
| Base URL env | `TRANSLUNAR_MINERU_BASE_URL` (official: `https://mineru.net/api/v4`; self-hosted mineru-api: `http://127.0.0.1:8000`) |
| Request timeout env | `TRANSLUNAR_MINERU_TIMEOUT_MS` (default `120000`, max `600000`) |
| Page limit env | `TRANSLUNAR_MINERU_MAX_PAGES` (default `200`) |
| Size limit env | `TRANSLUNAR_MINERU_MAX_BYTES` (default `209715200` = 200 MiB) |
| OS keyring service | `translunar-cat.mineru` |
| OS keyring account | `default` |
| Test mode env | `TRANSLUNAR_MINERU_TEST_MODE=1` |
| Test API key env | `TRANSLUNAR_MINERU_TEST_API_KEY` (memory backend only) |

### Credential provisioning (supported)

Provision the API key through the Engine surface (never written to SQLite):

| RPC method | Purpose |
|------------|---------|
| `mineru.credential.set` | Store key (`{ "secret": "…" }`) → `{ available, present, backend }` |
| `mineru.credential.status` | Presence/backend only (never the secret) |
| `mineru.credential.delete` | Remove key |

Desktop Settings → OCR calls the same three methods. The renderer never
persists the secret; the field is write-only. Import uses last-used
`ocrEngine` / `ocrMode` / `ocrLanguages` / `mineruBaseUrl` from
`translunar.renderer.pdf-import-options.v1` and passes them as
`project.batchImport.options`.

Official MinerU Precision Extract (https://mineru.net/apiManage/docs) uses a
**Token created on the API management page**, sent as
`Authorization: Bearer <token>`. That is not an Access Key / Secret Key pair.
When the base URL host is `mineru.net`, Engine calls
`POST /api/v4/file-urls/batch`, PUTs the PDF, polls
`/api/v4/extract-results/batch/{batch_id}`, and reads `*_content_list.json`
from the result zip. Self-hosted mineru-api keeps `POST {base}/file_parse`.
`ocrLanguages` values such as `eng` / `chi_sim` are mapped to official
`en` / `ch`. A0202 / A0211 JSON codes are typed authentication failures.

In tests / CI, use the memory backend (`TRANSLUNAR_MINERU_TEST_MODE=1`) or
`EngineService::{set,delete,mineru}_credential*`. Production uses the OS
keyring service/account above.

Import options:

- `ocrEngine=mineru|tesseract|poppler|local|auto` — closed enum. **Only**
  `ocrEngine=mineru` selects the MinerU HTTP path. Default/`auto` keeps the
  local Poppler/Tesseract text-layer path. Unknown values return typed
  `invalid_request` (no silent fallback). Explicit `mineru` with a missing base
  URL or key fails with a typed configuration/auth error.
- `ocrMode=auto|always|never` — closed enum; unknown values are
  `invalid_request`. `never` keeps the local path even if `ocrEngine=mineru`;
  `always` forces MinerU `parse_method=ocr`.
- `ocrLanguages` / `lang` — forwarded as MinerU `lang_list` (default `ch`).
- `pageRange` — `N` or `N-M` (1-based); mapped to MinerU `start_page_id` /
  `end_page_id` (0-based). The selected span is validated against the real PDF
  page-tree count (not a raw-byte heuristic) and `TRANSLUNAR_MINERU_MAX_PAGES`
  **before** any credential read or HTTP call.
- `segmentationMode` / `srxPath` — same paragraph/sentence/custom-SRX contract as
  the local PDF filter; MinerU layout blocks are segmented before unit creation.

## Behaviour

1. PDF `document.import` selects `builtin.pdf`.
2. When `ocrEngine=mineru` (and `ocrMode` is not `never`), Engine calls
   official Precision Extract on `mineru.net` hosts, or
   `POST {base}/file_parse` for self-hosted mineru-api, with Bearer auth from
   the keyring. `mineruBaseUrl` in import options overrides the env base for
   that call. Page/byte limits are enforced preflight.
3. `content_list` blocks map to segments with structural paths
   `pdf:p=…;b=…;k=…;x=…;y=…;w=…;h=…;s=ocr;c=…`. Table HTML keeps cell/row
   separators so adjacent cells do not collapse.
4. Failures are typed before any managed source/document is published:
   missing key, timeout, unavailable, auth, protocol/empty, resource limits.
   The same codes surface on JSON-RPC, batch import diagnostics, and local API.

Secrets never appear in SQLite (main/WAL/SHM), project files, degradation
messages, RPC error text, or generic `Debug` output for credential-bearing types.

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

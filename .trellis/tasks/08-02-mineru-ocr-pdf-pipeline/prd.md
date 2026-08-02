# MinerU OCR API for PDF document path

## Goal

Prefer MinerU OCR over HTTP API for PDF/scanned document import into CAT Engine (Full PRD HB3 path).

## Requirements

- **R1** MinerU HTTP client in Engine (base URL + timeouts + page/size limits)
- **R2** API key in OS keyring service `translunar-cat.mineru` (test memory mode like local API)
- **R3** Integrate filter-pdf / document import OCR path; layout blocks → segments
- **R4** Typed degrade when MinerU unavailable/timeout/auth fail — no hang, no secret logs
- **R5** Mockable unit/smoke without live MinerU

## Acceptance

- [x] **AC-01** mock MinerU returns structured OCR → document import succeeds
- [x] **AC-02** missing key/network → typed error, no partial corrupt project without diagnosis
- [x] **AC-03** secrets never in SQLite/logs
- [x] **AC-04** focused tests green

## Notes

HB3 superseded by this task; HB10 after complete; Poppler optional residual.

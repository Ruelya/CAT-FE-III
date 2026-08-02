# Full PRD release qualification — blocked / gate status

Last updated: 2026-08-02  
Related task: `08-02-mineru-ocr-pdf-pipeline` (HB3 path)

## Gate table

| Gate | Status | Notes |
|------|--------|--------|
| HB1 | closed-on-tip | Closed on tip |
| HB2 | accepted | 200/420 accepted |
| HB3 | superseded | Superseded by `08-02-mineru-ocr-pdf-pipeline` (MinerU OCR PDF pipeline) |
| HB4 | closed-on-tip | Closed on tip |
| HB5 | dropped | Dropped |
| HB6 | deferred | Windows-first deferred |
| HB7 | deferred | Deferred |
| HB8 | deferred | Deferred |
| HB9 | optional | Optional |
| HB10 | after MinerU | After MinerU OCR path complete (`08-02-mineru-ocr-pdf-pipeline`) |

## Resume criteria

1. **HB3 path:** Complete `08-02-mineru-ocr-pdf-pipeline` (MinerU HTTP client, keyring `translunar-cat.mineru`, filter-pdf/import wiring, typed degrade, mockable tests). ACs green.
2. **HB10:** Start only after MinerU task acceptance (AC-01–AC-04).
3. **Deferred gates (HB6–HB8):** Re-open when Windows-first / platform policy allows; not blocking MinerU path.
4. **Optional (HB9):** Non-blocking; schedule as capacity allows.
5. **Secrets:** API keys remain in OS keyring only; never SQLite/logs — verify before release resume.
6. **Poppler:** Optional residual for non-OCR PDF text; not a substitute for HB3/MinerU OCR path.

## Supersession note

Former HB3 (OCR / scanned PDF import) is **not** implemented under the old gate checklist. Work continues exclusively under:

- `.trellis/tasks/08-02-mineru-ocr-pdf-pipeline/`

Do not re-open HB3 as a separate implementation track without updating this table.

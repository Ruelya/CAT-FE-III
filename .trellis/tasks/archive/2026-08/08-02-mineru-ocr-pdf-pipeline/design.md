# Design: MinerU OCR PDF Pipeline

## Architecture

```
Document Import (UI / CLI)
        │
        ▼
   CAT Engine (document import / filter-pdf path)
        │
        ▼
   MinerUClient (HTTP, timeouts, page/size limits)
        │
        ▼
   MinerU HTTP API  ──► layout / OCR response
        │
        ▼
   Map layout blocks → filter-pdf blocks → segments
```

## Components

### MinerUClient (Engine)

- Base URL configurable (env/settings; not marketplace)
- Timeouts (connect + request) — no hang on dead endpoints
- Page/size limits before call (reject oversized docs with typed error)
- Response mapping: MinerU layout blocks → existing filter-pdf block model → segment creation

### Credentials

- OS keyring service name: `translunar-cat.mineru`
- Test/memory mode parallel to existing local API key handling
- Never persist API keys in SQLite, project files, or logs

### Error / degrade

| Condition | Behavior |
|-----------|----------|
| Missing key | Typed auth/config error; import aborts cleanly |
| Network / timeout | Typed unavailable/timeout error; no hang |
| Auth fail (401/403) | Typed auth error |
| Partial OCR / bad payload | Typed parse/mapping error; no corrupt project without diagnosis |

No silent success with empty body; no secret material in error messages or log fields.

### Mock

- Unit/smoke inject mock HTTP or trait double returning structured OCR
- No live MinerU required for CI / focused tests

## Out of scope

- Marketplace / plugin distribution of MinerU
- Replacing Poppler for non-OCR PDF text extraction (Poppler remains optional residual)
- HB10 (depends on this task completing)

## Relation to Full PRD gates

- **HB3** superseded by this task (`08-02-mineru-ocr-pdf-pipeline`)
- **HB10** scheduled after MinerU path is complete

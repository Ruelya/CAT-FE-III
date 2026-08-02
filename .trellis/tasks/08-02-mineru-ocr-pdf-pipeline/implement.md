# Implement: MinerU OCR PDF Pipeline

## Work packages

### WP1 — Client + mock tests

- Add MinerU HTTP client in Engine (base URL, timeouts, page/size limits)
- Define response types and block→segment mapping stubs as needed
- Mockable unit tests (structured OCR fixture → mapped blocks)
- AC-01 / AC-04 (client-level)

### WP2 — Keyring

- Store/load API key via OS keyring service `translunar-cat.mineru`
- Test memory mode (same pattern as local API keys)
- Ensure secrets never written to SQLite/logs (AC-03)

### WP3 — Wire import

- Integrate into filter-pdf / document import OCR path
- Layout blocks → segments end-to-end on import
- Typed degrade on unavailable/timeout/auth (R4, AC-02)

### WP4 — Smoke

- Focused smoke: mock MinerU → import succeeds
- Missing key/network → typed error, no partial corrupt project without diagnosis
- AC-01, AC-02, AC-04

### WP5 — Docs / evidence

- Brief usage notes (base URL, keyring service name, limits)
- Evidence links for acceptance (test names / log snippets without secrets)
- Mark HB3 superseded; note HB10 after complete

## Order

WP1 → WP2 → WP3 → WP4 → WP5

## Non-goals this task

- Live MinerU dependency in CI
- Marketplace packaging
- Closing HB10 (follow-on)

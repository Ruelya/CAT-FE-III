# Implement: MinerU OCR PDF Pipeline

## Work packages

### WP1 — Client + mock tests — done

- [x] Add MinerU HTTP client in Engine (base URL, timeouts, page/size limits)
- [x] Define response types and block→segment mapping stubs as needed
- [x] Mockable unit tests (structured OCR fixture → mapped blocks)
- [x] AC-01 / AC-04 (client-level)

### WP2 — Keyring — done

- [x] Store/load API key via OS keyring service `translunar-cat.mineru`
- [x] Test memory mode (same pattern as local API keys)
- [x] Ensure secrets never written to SQLite/logs (AC-03)
- [x] Production credential RPC: `mineru.credential.set|status|delete`

### WP3 — Wire import — done

- [x] Integrate into filter-pdf / document import OCR path
- [x] Layout blocks → shared PDF segmentation → segments end-to-end
- [x] Explicit-only routing (`ocrEngine=mineru`); closed enums
- [x] Bounded page-tree preflight before credential/HTTP
- [x] Typed degrade on unavailable/timeout/auth/resource limits (R4, AC-02)

### WP4 — Smoke — done

- [x] Focused smoke: mock MinerU → import succeeds
- [x] Missing key/network → typed error, no partial corrupt project without diagnosis
- [x] AC-01, AC-02, AC-04 (`cargo test -p translunar-engine mineru` 31+; page_tree 12+)

### WP5 — Docs / evidence — done

- [x] Brief usage notes (`docs/mineru-ocr.md`: base URL, keyring, limits, routing)
- [x] Evidence links for acceptance (test names in docs; no secrets)
- [x] Mark HB3 superseded; note HB10 after complete
- [x] Closeout: `closeout-summary.md`, `review/findings-5.md`, engine-boundary MinerU note

## Order

WP1 → WP2 → WP3 → WP4 → WP5 (completed)

## Non-goals this task

- Live MinerU dependency in CI
- Marketplace packaging
- Closing HB10 (follow-on)
- Automatic per-page MinerU fallback when `ocrEngine=auto` (explicit-only interim)

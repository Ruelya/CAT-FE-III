# Automated lane summary — candidate `8c8df12`

**Runner:** Windows x64, Node v24.17.0, pnpm 10.18.3, rustc/cargo 1.97.1  
**Frozen at:** 2026-08-02T03:45:03+08:00

## Pass

| Command | Notes |
| --- | --- |
| `pnpm contracts:check` | Protocol contracts current |
| `pnpm docs:check` | Required governance/docs paths exist |
| `pnpm electron:install:check` | Electron 41.10.3 inventory OK |
| `pnpm release:package:gate-test` | 18/18 architecture unit tests |
| `pnpm release:install-smoke:test` | 5/5 install-smoke unit tests |
| `cargo clippy --workspace --all-targets -- -D warnings` | Clean |
| `pnpm typecheck` | contracts + plugin-sdk + desktop |
| `cargo test --workspace` | All crates green (~521 non-doc tests) |
| Desktop Vitest | 175/175 |
| plugin-sdk Vitest | 37/37 |
| toolchain + connector/plugin helper tests | 11 + 9 pass |
| `pnpm plugins:package:check` | 5 packages |
| Engine smoke `plugin` | pass |
| Engine smoke `qa-pipeline` | pass |
| Engine smoke `api` | pass |
| Engine smoke `ai-quality` | pass |
| Engine smoke `collab` | pass |
| Engine smoke `curation` | pass |

## Fail

| Command | Reason | Owner routing |
| --- | --- | --- |
| `pnpm format:check` | Prettier dirty (95 files incl. product TS/JS/yml) | Hygiene / owning package tasks |
| `cargo fmt --all -- --check` | Rustfmt drift in engine/storage/plugin-runtime/ai-quality | Hygiene / owning crates |
| ESLint | 2 errors in `workbench-utils.ts` | desktop / workbench |
| Default `engine-smoke.mjs` | PDF import: `pdfinfo` failed / no filter match | Env Poppler **and** PDF lane (`07-19-pdf-ocr-workflow`) |
| `pnpm release:package:check` | Unpacked dir **383.36 MB > 200 MB**; **no `resources/engine`** | `07-19-platform-packaging-product-shell` |
| Package Engine embedding | electron-builder log: `file source doesn't exist from=...\apps\desktop\C:\Users\...\Temp\translunar-engine-package-...` — absolute Windows path mishandled | packaging scripts / electron-builder.yml |

## Desktop E2E (completed)

| Metric | Value |
| --- | --- |
| Command | `pnpm exec playwright test` (apps/desktop) |
| Duration | 563s (~9.4m) |
| Passed | **34** |
| Skipped | **1** — `pdf-workbench.spec.ts` scanned PDF workbench (Poppler/Tesseract tools absent; `test.skip`) |
| Failed | 0 |
| Exit | 0 |
| Evidence | `automated/desktop-e2e.log` |

**Honesty:** exit 0 does **not** satisfy “zero required skips”. The skipped PDF E2E is a required PRD format gate (B-07 / RQ6). Treat as **fail for full quality lane**, not green release evidence.

## Incomplete / blocked

| Item | Status |
| --- | --- |
| Node 22 clean install lane | blocked-external (Node 22 not installed) |
| macOS package + native a11y | blocked-external |
| 1M TM fuzzy / 5M TM capacity | not-run (short path not available; only 100k storage-benchmark) |
| Full format layout human review ≥95% | not-run |
| User studies RQ8 | blocked-external |
| Full installer NSIS + install-smoke native | package:dir only; engine missing makes install meaningless |

## Residual product defects observed (do not greenwash)

1. **Windows package omits Engine** when `TRANSLUNAR_ENGINE_RESOURCE_DIR` is an absolute path — electron-builder resolves it under `apps/desktop/`.
2. **Package size ~383 MB** exceeds PRD ≤200 MiB (Electron runtime dominates; Noto SC ~7.5 MiB is within font budget but total is not).
3. **PDF process smoke requires full Poppler** (`pdfinfo`); unit tests skip when tools missing → false confidence if only `cargo test -p translunar-filter-pdf` is green.
4. **Format/lint gates red** on this SHA despite clippy/typecheck/tests green.
5. **Desktop E2E skips required PDF workbench** when tools missing (1 skip).

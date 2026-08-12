# Full PRD release qualification: gate status

Last updated: 2026-08-12
Superseded measurement: see `docs/release-readiness.md`, which is now the
authoritative, reproducible record. This file is kept as the historical entry
point and points at it.

## Gate table

| Gate | Status | Notes |
|------|--------|--------|
| HB1 | **resolved** | `pnpm package:dir` emits `resources/engine/translunar-engine`; `release:package:check` confirms the architecture. Verified on the Linux lane. |
| HB2 | **resolved for the unpacked tree** | 322.50 MB against the 420 MB unpacked limit. The 200 MiB installer ceiling still needs a real installer build on Windows or macOS. |
| HB3 | superseded and closed | Replaced by the MinerU OCR pipeline. The real-Engine PDF path is now an always-on E2E case, not a skip. |
| HB4 | **resolved** | `format:check`, `lint` (eslint + clippy), and `typecheck` are green. `rustfmt.toml` newline_style was the root cause and is now `Auto`. |
| HB5 | blocked-external | Node 22 lane. Prerequisite: a runner with Node 22.17 or newer 22.x. |
| HB6 | blocked-external | macOS package, fonts, VoiceOver. Prerequisite: a macOS runner. |
| HB7 | blocked-external | 1M TM and multi-tier capacity. Prerequisite: the large TM corpora, absent from this repository. |
| HB8 | blocked-external | Two-client collaboration. Prerequisite: a second client against a shared Engine. |
| HB9 | blocked-external | Human usability and productivity studies. Three scripted GUI walkthroughs were performed and their findings fixed; that is explicitly not a substitute. |
| HB10 | **improved, not closed** | Desktop E2E is 19 passed, 0 failed, 4 skipped, from 10 passed and 7 skipped. Three skips were closed by having the test generate its own fixture through the product. The four remaining each name a precise prerequisite. |

## Resume criteria

1. Installer size (HB2 remainder), HB5, and HB6 need a Windows or macOS runner.
2. HB7 needs the capacity corpora.
3. HB8 needs a two-client setup.
4. HB9 needs human participants.
5. HB10 closes when the four remaining fixture gates are supplied; each is
   listed with its exact prerequisite in `docs/release-readiness.md`.
6. Secrets: API keys remain in the OS keyring only, never in SQLite or logs.
   Verify before any release resume.

## Process note

The 2026-08-12 round of work did not use the Trellis process, by explicit
instruction. Measurements above were produced directly and are reproducible
with the commands recorded in `docs/release-readiness.md`.

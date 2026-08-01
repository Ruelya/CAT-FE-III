# Final release qualification report

## Candidate

| Field | Value |
| --- | --- |
| SHA | `8c8df12fceef913073b683c0cfe0877dd8148aac` |
| Branch | `task/07-19-full-prd-release-qualification` |
| Tip subject | `chore(task): archive 07-19-plugin-runtime-sdk` |
| Freeze time | 2026-08-02T03:45:03+08:00 |
| Runner | Windows x64, Node v24.17.0, pnpm 10.18.3, Rust 1.97.1 |
| **Overall** | **FAIL** — not releasable as Full PRD candidate |

## Honesty statement

This report records only what was executed on this host. Missing macOS, Node 22, user studies, full NFR fixtures, and incomplete E2E are **not** treated as pass. Product defects observed during packaging and PDF import are **fail** and route to owning implementation tasks; this qualification task does not invent fixes for product behavior.

## Scorecard (task AC)

| AC | Result |
| --- | --- |
| AC1 ledger | partial |
| AC2 dual Node quality lanes | **fail** |
| AC3 native packages | **fail** |
| AC4 a11y/visual | **fail** / blocked-external |
| AC5 NFR | **fail** |
| AC6 fidelity | **fail** |
| AC7 ecosystem | partial |
| AC8 usability studies | blocked-external |
| AC9 security/docs | partial |
| AC10 final audit close | **fail** |

## Strong green signals (do not over-claim)

- Full `cargo test --workspace` green
- `cargo clippy -D warnings` green
- Typecheck green
- Contracts green
- Desktop unit (175) + plugin-sdk (37) + package architecture tests green
- Focused Engine smokes: plugin, qa-pipeline, api, ai-quality, collab, curation **all pass**
- Required docs files present
- Plugin catalog check OK

## Hard blockers (must clear before any release claim)

1. **HB1** Windows package does not embed Engine (`resources/engine` missing; electron-builder absolute path bug).
2. **HB2** Unpacked package **383.36 MB** > **200 MiB** gate (as applied on freeze).
3. **HB3** Default Engine smoke fails on PDF (`pdfinfo` unavailable / tool failure).
4. **HB4** `format:check`, `cargo fmt --check`, and ESLint are red on the candidate SHA.
5. **HB5** Node 22 lane not run (toolchain not installed).
6. **HB6** All macOS native gates blocked (no runner).
7. **HB7** 1M TM / multi-tier capacity / full NFR reliability campaign not evidenced.
8. **HB8** Two-client collaboration acceptance missing (local primitives only).
9. **HB9** Human usability / productivity studies not run.
10. **HB10** Desktop E2E: 34 passed, **1 required PDF skip** (exit 0 ≠ zero-skip gate).

### Post-freeze packaging mitigations (do not re-green this SHA)

Worktree packaging/script edits after freeze address **HB1** and **HB2**
*mechanically* but are **not** candidate evidence until a new SHA re-runs
`package:dir` / installer + `release:package:check`:

| HB | Freeze result | Later mitigation (worktree) | Still required |
| --- | --- | --- | --- |
| **HB1** | Engine missing; `file source doesn't exist` joined under `apps/desktop\C:\...` | Stage Engine at `apps/desktop/.package-engine-resource`; export **relative** `TRANSLUNAR_ENGINE_RESOURCE_DIR` | Re-package on new SHA; assert `resources/engine/<host binary>` |
| **HB2** | Unpacked 383.36 MB failed under a single 200 MiB ceiling | Dual gates: installer ≤ **200 MiB** (PRD N-02); unpacked ≤ **420 MiB**; `electronLanguages` en-US/zh-CN | Build downloadable installer + re-check; size still product-owned if installer > 200 MiB |
| **HB4** | format / rustfmt / eslint red | **Not** closed by packaging-only changes | Hygiene must go green on candidate |

**Honesty:** HB1/HB2 remain **fail for candidate `8c8df12`**. Label them
`mitigated-in-tree / re-qualification pending`, never `pass` on this freeze.

## Pass-rate honesty

Approximate automated command-level pass rate on this Windows Node 24 slice:

- Clear pass commands: ~19 (contracts, docs, electron, gate tests, clippy, typecheck, cargo test, unit suites, 6 focused smokes, plugins check, package:dir exit 0, desktop E2E exit 0 with skip caveat)
- Clear fail / incomplete gates: format, rustfmt, eslint, default smoke, package:check (size + missing Engine), E2E required skip, Node 22, macOS, NFR corpus, studies

**Rough automated pass among attempted executable gates: ~75% of short commands if E2E exit-0 counts; overall release readiness: 0%** (any hard blocker fails the candidate).

Parent Full PRD acceptance: **not complete**.

## Reruns

No product code was changed in this qualification pass. All results bind to `8c8df12`. Future fixes require a new candidate SHA and full re-invalidation of package/manual evidence per design.md.

## Evidence index

See `evidence/manifest.json` and `evidence/ledger.json`.

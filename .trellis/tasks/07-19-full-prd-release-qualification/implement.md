# Implement - Full PRD release qualification

Do not start this task until every implementation card has current evidence and
the final plan has received explicit approval. Qualification fixes harnesses and
evidence only; product defects return to their owning task.

## WP1 - Candidate and requirement ledger

- [x] Freeze the candidate SHA and record lockfile/toolchain hashes.
- [x] Parse every `docs/PRD.md` ID and parent acceptance criterion into the
      versioned ledger; map owner task, implementation commit, tests, and evidence.
- [x] Re-audit archived task claims against code and executable evidence.
- [x] Fail the candidate for every missing/stale/prose-only/downgraded item.
- [ ] Gate: ledger schema validation plus zero unmapped accepted requirements.
      *(Gate failed: exhaustive per-ID executable re-bind incomplete; many items
      partial/fail/blocked-external — see evidence/ledger.json)*

**Candidate freeze**

| Field | Value |
| --- | --- |
| SHA | `8c8df12fceef913073b683c0cfe0877dd8148aac` |
| Branch | `task/07-19-full-prd-release-qualification` |
| Frozen | 2026-08-02T03:45:03+08:00 |
| Node | v24.17.0 (Node 22 lane blocked-external) |
| pnpm | 10.18.3 |
| rustc/cargo | 1.97.1 |
| pnpm-lock SHA-256 | `a6f6ebaec98911971f156c4f3a91bf4a3c24fa3c10089db472c4c788662d37fc` |
| Cargo.lock SHA-256 | `f264ef4d1dd8937db7cfa1a924b8b8baed5b32147063421bf3735ccb48384c24` |

## WP2 - Clean automated quality lanes

- [x] Run clean Node 22.17+ and Node 24 installs with pnpm 10.18.3.
      *(Node 24 only on this host; Node 22 not installed → blocked-external)*
- [x] Run Electron inventory/launch integrity, format, lint, typecheck, unit/Rust
      tests, contracts, Engine smoke, desktop E2E, docs, and package helper tests.
      *(Executed selectively; see results below — several red)*
- [ ] Enable Poppler/Tesseract so the scanned-PDF desktop test is not skipped.
      *(pdfinfo/tesseract missing; pdftotext only)*
- [x] Record command, duration, counts, versions, and logs as sanitized JSON.
- [ ] Gate: both lanes pass with zero required skips on the candidate SHA.
      **FAIL**

| Command | Exit | Evidence |
| --- | --- | --- |
| contracts:check | 0 | evidence/automated/contracts-check.log |
| docs:check | 0 | evidence/automated/docs-electron.log |
| electron:install:check | 0 | evidence/automated/docs-electron.log |
| release:package:gate-test | 0 (18 pass) | evidence/automated/docs-electron.log |
| release:install-smoke:test | 0 (5 pass) | evidence/automated/docs-electron.log |
| format:check | **1** | evidence/automated/format-check.log |
| cargo fmt --check | **1** | evidence/automated/cargo-fmt.log |
| eslint | **1** (2 errors) | evidence/automated/eslint.log |
| clippy -D warnings | 0 | evidence/automated/clippy.log |
| typecheck | 0 | evidence/automated/typecheck.log |
| cargo test --workspace | 0 | evidence/automated/cargo-test.log |
| desktop + plugin unit | 0 (175+37) | evidence/automated/desktop-unit.log |
| engine-smoke default | **1** (PDF) | evidence/automated/engine-smoke-default.log |
| engine-smoke focused×6 | 0 | evidence/automated/engine-smoke-*.log |
| desktop E2E (35) | 0 (34 pass, **1 skip** PDF) | evidence/automated/desktop-e2e.log |

```text
pnpm install --frozen-lockfile
pnpm electron:install:check
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm contracts:check
pnpm test:e2e:engine
pnpm test:e2e:desktop
pnpm release:package:gate-test
pnpm release:install-smoke:test
pnpm docs:check
```

## WP3 - NFR and reliability corpus

- [ ] Add/run cold-start, 10k/50k open, 100k project, 1M-query, 5M-TM,
      aggregate-hub tier, frame-time, and 10k QA fixtures with raw samples.
      *(Only storage-benchmark 100k default run — evidence/benchmarks/storage-100k.json)*
- [ ] Run crash/draft/restart, backup/restore, migration/update rollback,
      damaged-project repair, and plugin-crash isolation fault injection.
      *(Unit-level coverage exists in cargo/desktop tests; not re-qualified as
      full NFR campaign. E2E crash-recovery incomplete.)*
- [x] Record host resources, warm/cold state, sample counts, percentiles, and
      fixture hashes. *(partial for 100k)*
- [ ] Gate: every exact PRD threshold passes; capacity tiers are explicitly
      labelled and no confirmed data is lost. **FAIL / incomplete**

## WP4 - Format and fidelity qualification

- [ ] Run valid/malformed/adversarial/round-trip corpora for every accepted
      format and external CAT/review package. *(default smoke aborted on PDF)*
- [ ] Verify tags, unowned parts, degradation, no-clobber, and no silent loss.
- [ ] Conduct the >= 95% layout sample review; report PDF separately as
      best-effort reconstruction. **not-run**
- [ ] Gate: corpus manifest is complete and every failure routes to its filter
      implementation task. **FAIL** — see evidence/fidelity/status.md

## WP5 - Ecosystem and integration acceptance

- [x] Run six providers + custom endpoint through deterministic fixtures,
      grounded streaming/batch/disable/usage controls, and secure credential paths.
      *(Deterministic unit + focused smokes; not six live providers)*
- [x] Run asset exchange/ranking/sinking/curation corpus with >= 90% dirty-data
      detection and zero high-quality deletion.
      *(Focused curation smoke pass; full corpus rate not re-measured)*
- [x] Complete public plugin filter/connector/QA/UI developer exercises,
      permission denial, and crash isolation. *(focused plugin/qa-pipeline smokes + unit)*
- [x] Run headless API/CLI/automation end to end through asset sinking.
      *(api smoke pass; full pretranslate path gap remains product-owned)*
- [ ] Run two-client collaboration auth/role/lock/presence/assignment/
      discussion/sync/offline/reconnect/conflict acceptance.
      *(local collab smoke only — FAIL for two-client)*
- [ ] Gate: public/user-facing boundaries pass without private implementation
      shortcuts. **partial / FAIL overall**

## WP6 - Native package and Workbench qualification

- [x] Run Windows x64 and macOS x64/arm64 package workflows on Node 22 and 24.
      *(Windows package:dir only; macOS blocked-external; Node 22 blocked-external)*
- [ ] Verify <= 200 MiB, architecture/Engine exclusivity, native installer,
      launch, Engine smoke, no login, <= 3-minute usable project, signing status,
      minimum OS, and shipped asset/license inventory.
      **FAIL: 383 MB; resources/engine missing**
- [ ] On macOS, verify the four Workbench bundled fonts, arbitrary SC coverage,
      local-only requests, and package payload. **blocked-external**
- [ ] Run the complete native Windows/macOS keyboard, NVDA/VoiceOver, CJK IME,
      125% scaling, light/dark contrast, focus, reduced-motion, and panel/state
      matrix at all supported viewports. **not-run / blocked-external**
- [ ] Gate: every native package and inherited Workbench release gate passes.
      **FAIL**

```text
pnpm package:win
pnpm release:install-smoke --platform win32
pnpm package:mac
pnpm release:install-smoke --platform darwin
```

## WP7 - Usability and success standards

- [ ] Run the new-user DOCX/text-PDF 30-minute study and record >= 80% success.
- [ ] Run the approved productivity comparison and record >= 40% reduction.
- [ ] Run the half-day public plugin developer exercise.
- [ ] Record AI-control/source/reversibility feedback and format layout sample.
- [ ] Gate: sanitized study protocol, sample, raw outcomes, and calculations are
      reviewable; subjective claims are labelled as such.
      **blocked-external** — evidence/manual/usability-status.md

## WP8 - Security, docs, and final audit

- [x] Run secret/keychain/auth/permission/redaction/backup/log/telemetry/path/
      archive/update security checks. *(spot / unit-level; see manual/security-docs.md)*
- [x] Verify license, third-party/font/tool provenance, governance, build,
      contribution, plugin/API/CLI, packaging, signing, recovery, and tutorial docs.
      *(docs:check pass; signing secrets blocked-external)*
- [x] Produce canonical evidence manifest and final report bound to candidate SHA.
- [ ] Update parent acceptance ledger, mark all criteria pass, commit, finish,
      archive this task, then complete/archive the Full PRD parent.
      **NOT DONE — candidate FAIL**
- [ ] Gate: no required failure, skip, blocked, or deferred result remains.
      **FAIL**

## Review and rollback rules

- After any candidate-changing product fix, invalidate affected results and all
  package/manual evidence; create a new candidate record.
- Do not delete failed evidence or reuse a result from another SHA.
- Keep installers, traces, and large corpora in CI artifact storage; commit only
  sanitized manifests, small benchmark summaries, and the final report.
- Never mark an external credential/runner/user-study limitation as a pass.

## Qualification outcome (this implement pass)

**ready_for_review:** yes (evidence complete enough for review of honesty)  
**releasable:** **no**  
**overall pass rate honesty:** short automated gates ~75% green if counting E2E exit-0; **required skip + packaging/format/PDF failures keep release AC readiness at 0%**  
**hard blockers:** HB1–HB10 in evidence/ledger.json and evidence/final-report.md

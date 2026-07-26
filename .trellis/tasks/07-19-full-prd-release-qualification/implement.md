# Implement - Full PRD release qualification

Do not start this task until every implementation card has current evidence and
the final plan has received explicit approval. Qualification fixes harnesses and
evidence only; product defects return to their owning task.

## WP1 - Candidate and requirement ledger

- [ ] Freeze the candidate SHA and record lockfile/toolchain hashes.
- [ ] Parse every `docs/PRD.md` ID and parent acceptance criterion into the
      versioned ledger; map owner task, implementation commit, tests, and evidence.
- [ ] Re-audit archived task claims against code and executable evidence.
- [ ] Fail the candidate for every missing/stale/prose-only/downgraded item.
- [ ] Gate: ledger schema validation plus zero unmapped accepted requirements.

## WP2 - Clean automated quality lanes

- [ ] Run clean Node 22.17+ and Node 24 installs with pnpm 10.18.3.
- [ ] Run Electron inventory/launch integrity, format, lint, typecheck, unit/Rust
      tests, contracts, Engine smoke, desktop E2E, docs, and package helper tests.
- [ ] Enable Poppler/Tesseract so the scanned-PDF desktop test is not skipped.
- [ ] Record command, duration, counts, versions, and logs as sanitized JSON.
- [ ] Gate: both lanes pass with zero required skips on the candidate SHA.

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
- [ ] Run crash/draft/restart, backup/restore, migration/update rollback,
      damaged-project repair, and plugin-crash isolation fault injection.
- [ ] Record host resources, warm/cold state, sample counts, percentiles, and
      fixture hashes.
- [ ] Gate: every exact PRD threshold passes; capacity tiers are explicitly
      labelled and no confirmed data is lost.

## WP4 - Format and fidelity qualification

- [ ] Run valid/malformed/adversarial/round-trip corpora for every accepted
      format and external CAT/review package.
- [ ] Verify tags, unowned parts, degradation, no-clobber, and no silent loss.
- [ ] Conduct the >= 95% layout sample review; report PDF separately as
      best-effort reconstruction.
- [ ] Gate: corpus manifest is complete and every failure routes to its filter
      implementation task.

## WP5 - Ecosystem and integration acceptance

- [ ] Run six providers + custom endpoint through deterministic fixtures,
      grounded streaming/batch/disable/usage controls, and secure credential paths.
- [ ] Run asset exchange/ranking/sinking/curation corpus with >= 90% dirty-data
      detection and zero high-quality deletion.
- [ ] Complete public plugin filter/connector/QA/UI developer exercises,
      permission denial, and crash isolation.
- [ ] Run headless API/CLI/automation end to end through asset sinking.
- [ ] Run two-client collaboration auth/role/lock/presence/assignment/
      discussion/sync/offline/reconnect/conflict acceptance.
- [ ] Gate: public/user-facing boundaries pass without private implementation
      shortcuts.

## WP6 - Native package and Workbench qualification

- [ ] Run Windows x64 and macOS x64/arm64 package workflows on Node 22 and 24.
- [ ] Verify <= 200 MiB, architecture/Engine exclusivity, native installer,
      launch, Engine smoke, no login, <= 3-minute usable project, signing status,
      minimum OS, and shipped asset/license inventory.
- [ ] On macOS, verify the four Workbench bundled fonts, arbitrary SC coverage,
      local-only requests, and package payload.
- [ ] Run the complete native Windows/macOS keyboard, NVDA/VoiceOver, CJK IME,
      125% scaling, light/dark contrast, focus, reduced-motion, and panel/state
      matrix at all supported viewports.
- [ ] Gate: every native package and inherited Workbench release gate passes.

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

## WP8 - Security, docs, and final audit

- [ ] Run secret/keychain/auth/permission/redaction/backup/log/telemetry/path/
      archive/update security checks.
- [ ] Verify license, third-party/font/tool provenance, governance, build,
      contribution, plugin/API/CLI, packaging, signing, recovery, and tutorial docs.
- [ ] Produce canonical evidence manifest and final report bound to candidate SHA.
- [ ] Update parent acceptance ledger, mark all criteria pass, commit, finish,
      archive this task, then complete/archive the Full PRD parent.
- [ ] Gate: no required failure, skip, blocked, or deferred result remains.

## Review and rollback rules

- After any candidate-changing product fix, invalidate affected results and all
  package/manual evidence; create a new candidate record.
- Do not delete failed evidence or reuse a result from another SHA.
- Keep installers, traces, and large corpora in CI artifact storage; commit only
  sanitized manifests, small benchmark summaries, and the final report.
- Never mark an external credential/runner/user-study limitation as a pass.

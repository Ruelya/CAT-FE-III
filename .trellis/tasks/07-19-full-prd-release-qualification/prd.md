# Full PRD release qualification

## Goal

Qualify one immutable Translunar CAT release candidate against every accepted
requirement in `docs/PRD.md` v2.0 and the parent Full PRD task. This task does
not implement missing product behavior and does not accept an MVP substitute:
any failed or unevidenced requirement returns to the owning implementation
task, is fixed there, committed, and re-enters qualification on a new candidate.

## Authority and inherited evidence

1. `docs/PRD.md` v2.0 defines product scope, NFR targets, and success standards.
2. `.trellis/tasks/07-19-complete-full-cat-prd/prd.md` defines the accepted
   complete-product boundary and exclusions.
3. Archived child tasks provide implementation evidence; an archived checkbox
   is not sufficient when the executable evidence is stale or absent.
4. `.trellis/tasks/07-19-complete-full-cat-prd/research/remaining-work-plan.md`
   and `docs/Full PRD gap matrix.md` identify work that must be re-audited after
   the owning implementation tasks close.

This task explicitly inherits the following release-only gates from
`07-21-workbench-visual-identity` without weakening them:

- native macOS packaged Space Grotesk, Chivo, Space Mono, and Noto Sans SC
  loading/coverage evidence;
- native Windows and macOS keyboard-only, CJK IME, screen-reader spot checks,
  contrast, focus-ring, and reduced-motion review in light and dark themes;
- release-candidate package evidence that the Workbench screenshots and local
  WOFF2 payload are the files actually shipped.

## Requirements

### RQ1 - Complete requirement ledger

- Map every PRD ID and every parent acceptance criterion to one owning task,
  implementation commit, executable command, and named evidence artifact.
- Distinguish `pass`, `fail`, `blocked-external`, and `not-applicable`; only the
  source PRD's explicit exclusions may be `not-applicable`.
- Treat a missing feature, skipped required test, stale screenshot, prose-only
  claim, or unverified platform as `fail`, not as completion.
- Re-run the ledger after every candidate-changing fix and retain the previous
  failed result for auditability.

### RQ2 - Reproducible quality and dependency lanes

- On clean installs, qualify Node 22.17+ within major 22 and Node 24.x with pnpm
  10.18.3, the locked Electron runtime, and the repository Rust toolchain.
- Both lanes run dependency integrity, contracts, formatting, lint, typecheck,
  unit/integration tests, real Engine smoke, and desktop E2E. Required tests have
  zero skips; optional live-provider tests use deterministic local fixtures.
- Record runner OS/architecture, commit SHA, lockfile hash, tool versions,
  commands, duration, test counts, artifact hashes, and failure logs.

### RQ3 - Native package and install qualification

- Qualify Windows 10+ x64 and macOS 12+ x64/arm64 artifacts on native runners.
- Run package architecture/Engine exclusivity, artifact size (<= 200 MiB),
  installer mount/install, application launch, real packaged-Engine workflow,
  no-login, cold-start, and first-usable-project checks.
- Record unsigned development status when signing secrets are absent; when
  secrets exist, verify signing/notarization hooks and record the result.
- Package evidence must prove the matching Engine binary, fonts, licenses,
  tutorial/example assets, update metadata, and product documentation are in
  the shipped artifact.

### RQ4 - Native accessibility and visual acceptance

- Run automated axe/semantic/keyboard coverage for Project Home, Setup,
  Settings, Tutorial, Workbench, QA Review, and Export Review at 1250x744,
  1680x942, and 1920x1080.
- Complete the manual matrix on native Windows and macOS: keyboard-only and
  focus return, NVDA/VoiceOver spot checks, CJK IME composition, 125% font
  scaling, light/dark contrast, reduced motion, and icon/control names.
- Verify all Workbench branded states and panel modes in the packaged app,
  including the inherited macOS font/package and visual-identity gates.

### RQ5 - NFR performance, capacity, and reliability

- Cold start <= 3 seconds; open 10,000 segments <= 3 seconds and 50,000 <= 10
  seconds; editor interaction P95 frame time <= 33 ms; batch QA for 10,000
  segments <= 60 seconds.
- A one-million-pair TM fuzzy-query fixture has P95 <= 200 ms; capacity fixtures
  cover at least 100,000 project segments, 5,000,000 pairs in one TM, and the
  documented tier for the aggregate asset hub.
- Crash, restart, draft recovery, backup/restore, migration, update rollback,
  damaged-project repair, and plugin crash isolation lose no confirmed data and
  expose actionable typed failures.
- Each benchmark records fixture generation, warm/cold conditions, sample
  count, percentiles, host resources, and machine-readable results.

### RQ6 - Format and fidelity corpus

- Qualify representative valid, malformed, adversarial, and round-trip fixtures
  for DOCX, XLSX, PPTX, TXT, Markdown, HTML/XHTML, XLIFF 1.2/2.1, SRX, text PDF,
  scanned PDF/OCR, and supported external CAT/review packages.
- Assert complete extraction, owned/unowned-part preservation, protected tags,
  degradation reports, no-clobber publication, and no silent loss.
- Record a human layout review with >= 95% pass rate for promised formats; PDF
  remains a separately labelled best-effort reconstruction lane.

### RQ7 - AI, asset, plugin, API, and collaboration acceptance

- Qualify at least six connector profiles plus a custom OpenAI-compatible
  endpoint through deterministic provider fixtures, secure BYOK, grounded
  streaming, resumable batch work, usage provenance, and global/project disable.
- Exercise TM/TB exchange, ranking, provenance, confirmed-result sinking,
  curation explainability/rollback, dirty-data detection >= 90%, and zero
  high-quality deletion on the accepted corpus.
- A developer following only the public SDK documentation builds and runs the
  required filter/connector/QA/UI examples; permission denial and plugin crash
  isolation are verified outside the desktop process.
- API/CLI and automation complete the same import -> pretranslate -> QA ->
  export -> asset-sink path without opening the GUI.
- Collaboration passes two-client auth/role/lock/presence/assignment/
  discussion/sync/offline/reconnect/conflict tests without weakening offline
  single-user operation.

### RQ8 - Usability and success-standard studies

- A new user completes DOCX and text-PDF import -> translate -> QA/review ->
  export within 30 minutes without external documentation; record task outcome,
  time, assistance, and failure reason for an >= 80% pass rate.
- Record the approved internal comparison for >= 40% time reduction versus the
  baseline workflow, and the plugin half-day developer exercise.
- Capture the qualitative AI-control review (source visibility, disablement,
  reversibility) without turning subjective feedback into an automated claim.

### RQ9 - Security, privacy, governance, and documentation

- Verify OS keychain use, loopback API authentication, permission boundaries,
  secret redaction, backup/log exclusion, telemetry-off default, path/archive
  safety, and update/release input validation.
- Verify Apache-2.0 license, third-party notices, font/tool provenance,
  `SECURITY.md`, `CODE_OF_CONDUCT.md`, issue templates, build/contribution,
  plugin/API/CLI, packaging/signing, recovery, and user tutorial documentation.
- Documentation commands must execute successfully from a clean checkout.

### RQ10 - Final release audit

- Freeze one candidate SHA, run all automated and manual lanes against that SHA,
  and publish a signed or hashed evidence manifest with no required skip.
- The final report lists every failure and rerun; no result from an older SHA may
  close the candidate.
- Update the parent ledger and archive this task only when all accepted criteria
  are `pass` and the worktree contains no uncommitted release artifact.

## Acceptance criteria

- [ ] AC1: The ID-by-ID ledger has no unmapped, stale, prose-only, or downgraded
      requirement and points to immutable candidate evidence.
- [ ] AC2: Clean Node 22 and Node 24 quality lanes pass with zero required skips.
- [ ] AC3: Native Windows and macOS packages pass size, architecture, install,
      launch, packaged-Engine, no-login, and timing gates.
- [ ] AC4: Automated and native manual accessibility/visual matrices pass,
      including all inherited Workbench macOS/font/CJK/contrast/motion gates.
- [ ] AC5: Every PRD NFR performance, capacity, reliability, and repair target
      has reproducible machine-readable evidence and passes its threshold.
- [ ] AC6: The complete format/fidelity corpus passes without silent loss and
      the manual layout review meets its accepted threshold.
- [ ] AC7: AI/asset/plugin/API/CLI/automation/collaboration acceptance workflows
      pass through public or user-facing boundaries, not private test shortcuts.
- [ ] AC8: Usability, productivity, asset-quality, developer-onboarding, and
      AI-control success standards have recorded, reviewable results.
- [ ] AC9: Security/privacy/governance/license/provenance/docs checks pass on the
      release candidate.
- [ ] AC10: The final evidence manifest is candidate-SHA-bound, all reruns are
      recorded, the parent Full PRD task is complete, and no required item is
      skipped, blocked, or deferred.

## Constraints

- Qualification may add test harnesses, fixtures, evidence tooling, and docs,
  but product behavior fixes belong to the owning implementation task.
- Credentials, notarization, native assistive technology, and user studies are
  external-run gates, not reasons to weaken a criterion.
- Evidence must not contain document bodies, credentials, tokens, or private
  user paths. Generated release artifacts remain outside Git unless the plan
  names a small sanitized manifest.
- Linux may run cross-platform Rust/Node checks but cannot substitute for the
  required native Windows/macOS package and accessibility lanes.

## Out of scope

- Adding product requirements not present in the accepted Full PRD.
- Customer portals, billing, procurement, marketplaces, enterprise compliance
  dashboards/RBAC/audit, mobile/web products, speech interpretation, and
  self-trained MT.
- Waiving failed product behavior inside this task; failures return to the
  owning implementation card.

# Cross-platform packaging and complete product shell

## Goal

Complete the Translunar desktop product shell described by the parent full CAT
PRD and the packaging section of `docs/Full PRD gap matrix.md`. The result must
be a usable, recoverable, bilingual, accessible Windows/macOS desktop product,
not a packaging configuration or documentation MVP. Existing Engine, protocol,
and workbench behavior remains authoritative; this child adds the missing
productization contracts around it.

## Scope and requirement mapping

### M-01 — selectable and migratable data directory (P0)

- Show the active data directory and health/free-space summary in a desktop
  settings surface.
- Let a user choose a directory through the Electron main-process dialog.
- Validate that the target is absolute, writable, has sufficient free space,
  is not the live directory or one of its descendants, and is not already an
  unrelated workspace.
- Migrate by quiescing the Engine, creating a manifest-verified staged copy,
  atomically swapping/restarting, and retaining a rollback path when copy,
  validation, or restart fails. Never delete the source until the new
  workspace opens successfully.
- Keep `TRANSLUNAR_DATA_DIR` as a test/development override while making the
  normal path user-facing and persisted by the desktop shell.

### M-02/M-04 — secure secrets and local-first privacy (P0)

- Keep AI and local API credentials in the OS credential store; expose status,
  delete, and unavailable-keychain errors without revealing secrets.
- Backup manifests and logs must never contain secret values or full document
  bodies. Telemetry remains disabled by default and any diagnostic sharing is
  explicit and reversible.
- Add regression tests proving credentials are not copied into backup files.

### M-03 — project `engine_allowlist` enforcement (P1 but release-blocking)

- Provide a project settings control for the allowed AI profile IDs.
- Empty means all enabled workspace profiles; non-empty means only listed
  profiles may be used.
- Enforce the rule in the Rust Engine before interactive runs, batch runs, and
  pipeline pretranslation. Reject missing, disabled, or newly disallowed
  profiles with stable typed errors; never silently fall back to another
  profile. Existing projects with a now-disallowed profile remain readable but
  cannot start new work until corrected.
- Add protocol/Engine, renderer, and stdio smoke coverage.

### M-05 — one-click backup and restore (P0)

- Add a desktop backup command with destination selection, progress/busy state,
  manifest summary, backup history, and no-overwrite behavior.
- Add restore selection and preview/validation (schema, hashes, workspace
  shape, available disk, and compatibility) before changing the live workspace.
- Restore through a safe shutdown/staged swap/restart sequence with rollback on
  failure. Preserve the current workspace until the restored Engine passes
  health and initialize checks. Canceled, malformed, incompatible, and
  insufficient-space inputs make no mutation.
- Reuse the existing Engine backup format and transactions; do not parse SQLite
  or archive contents in React.

### N-01/N-02 — release-grade Windows/macOS packaging (P0)

- Produce reproducible NSIS and macOS DMG/dir artifacts for x64 and arm64
  where the runner supports them, with only the current-platform Engine binary
  bundled.
- Add optional credential-backed code-signing and macOS notarization hooks;
  unsigned development artifacts remain valid when secrets are absent.
- Add Windows and macOS CI jobs that build, inspect, install/launch, run a
  real Engine smoke, upload artifacts, and record platform/minimum-OS evidence.
- Fail packaging when the measured artifact exceeds 200 MB, required files are
  missing, or the installed app cannot launch the Engine.

### N-04 — update service and deterministic recovery (P0)

- Implement a main-process update service with configurable release feed,
  automatic and manual checks, download/install status, and an explicit
  update settings UI.
- Support disabled updates and defer/snooze choices. Default behavior must
  not interrupt an active edit or silently restart the app.
- Before an update that may migrate SQLite, create and verify a workspace
  backup. Stage the update, launch a health check after restart, and expose a
  rollback/manual recovery action when install, migration, or health checks
  fail. Feed URLs and credentials are never hard-coded into the renderer.
- Add deterministic fixture-feed tests; real release credentials are not
  required in CI.

### N-05 — full desktop localization (P0)

- Establish one typed `en-US`/`zh-CN` message contract with interpolation,
  plural selection, date/number formatting, fallback, and missing-key
  diagnostics.
- Initialize from the system locale, persist a user-selected locale, and
  expose a selector in product settings. Locale changes apply without a
  restart where safe and survive restart.
- Migrate all product-facing renderer, Electron dialog, tutorial, update,
  backup/restore, error, status, accessibility-label, and empty/loading copy
  to the catalog. English may be the fallback only for an explicitly audited
  technical/provider string; no broad hard-coded English UI remains.
- Add catalog completeness, rendered-layout, and bilingual smoke tests with
  meaningful Chinese text (not duplicate English placeholders).

### N-07 — crash recovery and unsaved drafts (P0)

- On an unexpected Engine exit, perform a bounded, observable automatic restart
  with backoff; reject only calls that cannot be replayed and retain a bounded
  stderr diagnostic. Manual restart remains available.
- Reconnect the renderer, reload project/segment/QA projections from the
  Engine, and show a recoverable state instead of leaving stale UI data.
- Persist unsaved editor drafts in a small atomic journal owned by the desktop
  data directory (never `localStorage`, source files, or telemetry). Restore
  drafts after renderer/app/Engine crashes with a user-visible prompt and
  expected-revision checks. Stale drafts are never applied silently and can be
  discarded or copied for review.
- Add process-level, renderer-level, stale-revision, and E2E recovery tests.

### N-06 — interactive first-run tutorial and bundled example (P1)

- Detect first launch per installation/workspace and show a bilingual guided
  tutorial with real controls for create/open, import, edit/confirm, QA, and
  export.
- Persist progress, allow skip/resume/restart, keep focus accessible, and do
  not block an experienced user after dismissal.
- Bundle a small licensed example project and provide a single action to copy
  it into the managed data directory and open it. The action must work offline
  and use the same Engine project/import path as normal work.
- Add tutorial state, locale, and packaged-asset tests.

### Accessibility and release governance (N-01/N-02/N-08, P0/P1)

- Qualify keyboard-only navigation, focus restoration/modal trapping, semantic
  labels/status announcements, contrast, reduced-motion behavior, and the
  supported 1250x744, 1680x942, and 1920x1080 layouts. Add automated axe (or
  equivalent) checks and a documented manual matrix.
- Add clean-machine acceptance checks: no account/login requirement, install
  and first usable project in under three minutes on CI fixtures, and a
  reproducible cold-start measurement.
- Add Apache-2.0 `LICENSE`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, issue forms or
  templates, release/signing/notarization documentation, and contribution/
  plugin release guidance.

## Constraints

- Keep Electron + TypeScript + Rust + SQLite and the current context-isolated
  boundary. Rust/protocol remain the source of truth for domain and durable
  state.
- Additive protocol changes require generated schema and TypeScript updates.
- Renderer code may orchestrate presentation but may not read SQLite, parse
  backup archives, enforce AI policy, or invent revisions/counts.
- Preserve unrelated dirty work from other tasks; this task owns only the
  product-shell implementation and its tests/docs/configuration.
- Signing credentials, notarization credentials, and a live release feed may
  be unavailable locally; deterministic hooks and fixture-based tests are still
  mandatory.

## Acceptance criteria

- [ ] A user can choose, validate, migrate, restart, and roll back the data
      directory without losing the original workspace.
- [ ] Desktop backup/restore is one-click, manifest-validated, no-clobber,
      restart-safe, and covered by malformed/stale/low-space tests.
- [ ] Interactive and batch AI starts enforce each project's allowlist in the
      Engine with typed errors and no fallback.
- [ ] Automatic/manual update flows support defer/disable, pre-update backup,
      health validation, and failure recovery through a fixture feed.
- [ ] Product-facing desktop strings use the typed bilingual catalog; locale
      preference, formatting, fallback, and layout checks pass.
- [ ] Unexpected Engine/renderer exits recover boundedly and restore a durable
      unsaved draft with stale-revision protection.
- [ ] First-run tutorial is interactive, bilingual, resumable, accessible, and
      opens the bundled example project offline.
- [ ] Windows/macOS CI produces installable artifacts, runs launch/Engine
      smoke, invokes signing hooks when secrets exist, and enforces the 200 MB
      and under-three-minute/no-login gates.
- [ ] Accessibility checks and manual matrix cover keyboard, focus, contrast,
      announcements, reduced motion, and all supported viewport sizes.
- [ ] Apache-2.0 license and open-source governance/release files are present
      and linked from contribution docs.
- [ ] Relevant format/lint/typecheck/unit/Rust/contract/E2E/package checks pass,
      or an external-run limitation is recorded with exact commands and
      evidence; prose-only claims do not close a criterion.

## Explicitly not accepted as completion

Configuration-only packaging, catalog files that are not wired into the UI,
documentation-only backup/update guidance, a manual restart button without
automatic recovery, a stored allowlist without enforcement, a static tutorial
page without interactive state, Ubuntu-only CI, or an accessibility paragraph
without automated/manual evidence are all incomplete.

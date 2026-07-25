# Full-scope packaging/product-shell gap evidence

Source: `docs/Full PRD gap matrix.md`, read in full on 2026-07-24. Parent
contracts: `.trellis/tasks/07-19-complete-full-cat-prd/prd.md` R12 and its
technical design section 10.

## Current baseline observed by the audit

The repository already has useful foundations: an Electron main/preload/
renderer boundary, a Rust Engine with a workspace-relative data directory,
OS-keyring credential storage, `data.createBackup`, an `engine_allowlist`
field in `ProjectConfiguration`, an electron-builder skeleton, typed locale
catalogs, a tutorial document, and an Ubuntu-only CI workflow. These are
foundations, not proof of the complete product shell.

## Required work packages (the audit's nine packaging packages)

1. Full desktop localization: locale context/provider, system-locale and
   persisted preference, migration of product-facing strings, interpolation /
   plural / date / number formatting, and localization QA for both bundles.
2. Update service: automatic and manual checks, download/install status,
   defer/disable preference, release feed configuration, pre-update backup,
   migration failure recovery, rollback/manual recovery, and platform tests.
3. Data-directory settings plus backup/restore: picker, path/free-space
   validation, safe move/copy migration with restart and rollback, one-click
   backup history, manifest validation, no-clobber restore, and restart.
4. Crash-safe editor recovery: bounded automatic Engine restart, renderer
   reconnect and authoritative reload, durable unsaved draft journal, stale
   revision handling, recovery prompt, and crash E2E.
5. Interactive first-run tutorial and bundled example project: first-run
   detection, bilingual guided steps bound to real controls, progress/skip/
   restart, example creation/opening, and packaged assets.
6. Enforce `engine_allowlist`: project settings UI, validation against provider
   profiles, enforcement for interactive and batch AI starts (including
   existing disallowed profiles), and tests.
7. Release-grade packaging: Windows/macOS CI, deterministic electron-builder
   targets, signing/notarization hooks, minimum-version declarations, install
   and launch smoke, and artifact publication.
8. NFR qualification: 200 MB artifact gate, clean-machine usable-under-three-
   minutes gate, no-login gate, keyboard/accessibility/contrast/focus checks,
   reduced-motion behavior, and reproducible evidence.
9. Open-source governance: Apache-2.0 LICENSE, SECURITY policy, Code of
   Conduct, issue templates, release process and signing-secret documentation.

## Explicit non-MVP interpretation

The audit calls the current implementation a skeleton because documentation,
catalog files, and configuration alone do not satisfy behavior. This task
must not retain the old exclusions for full string migration, updater
behavior, restore UI, crash recovery, interactive tutorial, allowlist
enforcement, release gates, accessibility qualification, or governance files.
Unsigned local artifacts and unavailable signing credentials are acceptable;
the hooks, deterministic checks, and CI evidence are still required.

## Dependency and evidence order

The parent dependency order places this child after plugin, API/CLI, advanced
AI/quality, and collaboration. The implementation must therefore integrate
with existing generated contracts and shared Engine services rather than add
a parallel renderer domain model. Each work package needs focused tests and a
real-Engine or package-runner evidence path; prose-only claims are not
acceptance evidence.

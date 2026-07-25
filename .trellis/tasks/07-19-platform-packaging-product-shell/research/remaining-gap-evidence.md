# Remaining full-scope gap evidence (2026-07-24)

The prior AMP/MVP pass must not be accepted. Continue implementation against
the complete PRD and `docs/Full PRD gap matrix.md`; do not close a requirement
with docs, config, or a placeholder test.

## Verified gaps to close in this turn

1. **Localization is still partial.** `LocaleProvider` is wired only to
   `App`, `ProductSettingsPage`, `TutorialOverlay`, and draft recovery. The
   existing renderer product pages/workbench and Electron file-dialog titles
   still contain broad hard-coded user-facing English. Establish one typed
   catalog and migrate the product-facing shell copy (including dialog titles,
   backup/restore/update/error/status/ARIA copy). Technical protocol strings
   may remain only when explicitly audited. Add completeness and rendered
   Chinese coverage tests.
2. **Restore must have a real preview/confirmation boundary.** Validation may
   inspect a backup, but the UI must show a typed summary (schema, file count,
   size/hash status, compatibility, free space, source path) and require an
   explicit confirmation before `restoreWorkspaceBackup` mutates the live
   workspace. No direct preview-then-restore path.
3. **Updater production path is fixture-only.** Add a safe HTTP/HTTPS feed
   adapter (no renderer secrets, bounded response/redirect/size/time, strict
   version/package validation) and a staged install abstraction that records
   backup, install, post-restart health, and rollback/manual recovery. Keep the
   deterministic fixture adapter for tests and prove both paths. Never silently
   claim an installed update when only a fixture path ran.
4. **Packaging architecture parity is not proven.** Make Windows/macOS
   workflows and electron-builder configuration select the matching Rust
   Engine binary for each runner/arch; fail when a binary is missing or the
   architecture mismatches. Add artifact inspection tests and retain the 200 MB
   and clean install/launch/engine smoke gates.
5. **Accessibility/recovery evidence is shallow.** Add reusable focus-trap and
   focus-restoration behavior for settings, draft recovery, and tutorial
   dialogs; run axe at 1250x744, 1680x942, and 1920x1080 in E2E. Add a real
   child-process Engine exit/restart test (not only a backoff helper) and an
   E2E/renderer reconnect assertion where feasible.
6. **Backup privacy regression.** Add a test that writes credential-shaped
   files/metadata into a workspace and proves backup manifests/files/logs do
   not copy secret material, while preserving ordinary project data.

## Constraints

- Preserve unrelated dirty work from other tasks; do not reset, checkout,
  commit, or archive.
- Rust/protocol remain authoritative; renderer must not parse SQLite/archives.
- Use `apply_patch` for source edits. Run scoped typecheck, tests, contract
  check, lint, and formatting before reporting.
- Report exact files, commands, and any genuinely external platform limits.

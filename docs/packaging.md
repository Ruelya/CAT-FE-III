# Packaging and product shell

## Desktop package

```bash
# 1) Build release engine binaries (current platform only)
cargo build -p translunar-engine --release

# 2) Build desktop renderer + electron main/preload
pnpm --filter @translunar/desktop build

# 3) Package (unsigned development artifacts are valid)
pnpm --filter @translunar/desktop package:dir
pnpm release:package:check
```

Platform installers:

```bash
pnpm package:win   # Windows
pnpm package:mac   # macOS
pnpm release:install-smoke --platform win32
pnpm release:install-smoke --platform darwin
```

`release:install-smoke` is a native-runner gate. Windows must contain a real
NSIS `.exe`; the smoke installs it silently into an isolated temporary root.
macOS must contain a real `.dmg`; the smoke mounts it read-only, copies the
`.app` bundle into an isolated root, and detaches the image. Unpacked
electron-builder output is never accepted as an installer substitute. The
installed app must remain alive while the packaged Engine is launched from its
`resources/engine` directory and exercised over stdio JSON-RPC
(`engine.initialize`, `data.checkHealth`, project creation, text import, and a
non-empty `segment.list`). Evidence is written to
`apps/desktop/release/install-smoke-evidence.json` without source bodies or
credentials. Running this command on Linux is an explicit external-runner
limitation, not a pass.

Before packaging, run the deterministic helper tests:

```bash
pnpm release:install-smoke:test
```

Configuration: `apps/desktop/electron-builder.yml`.

### Size controls

- Ship only the matching-platform Engine binary under `resources/engine/`.
- Prefer `asar` + maximum compression.
- Keep optional heavy AI/QE models out of the installer.
- **Hard gate:** measured artifact ≤ **200 MB** (`pnpm release:package:check`).

### Signing

See `docs/release-signing.md`. Code signing and Apple notarization are optional
CI secrets. Unsigned packages remain valid for development.

## Data directory, backup, restore, updates

- Default engine data directory is under the app userData path unless
  `TRANSLUNAR_DATA_DIR` is set (test/dev override) or the user migrates via
  Product Settings.
- One-click backup uses Engine `data.createBackup` with destination selection
  and history in shell settings.
- Restore validates manifest schema/hashes, stages a copy, runs Engine
  initialize + `data.checkHealth`, then swaps with rollback on failure.
- Before applying app updates that may run SQLite migrations, the update
  manager creates a workspace backup.
- Secrets (AI keys, local API token) use the OS keychain and must not appear in
  backup manifests, logs, or renderer storage.
- Telemetry remains off by default.

## Localization

- Typed `en-US` / `zh-CN` catalogs in `apps/desktop/src/renderer/i18n/messages.ts`.
- LocaleProvider initializes from system locale, persists user choice through
  main-process shell settings, and formats plural/date/number values.

## Crash recovery

- Unexpected Engine exits restart with bounded exponential backoff (≤ 3).
- Unsaved drafts use an atomic journal under the data directory (`.desktop/`),
  never `localStorage` for source/target text.
- Stale-revision drafts require explicit restore/discard/copy.

## Accessibility baseline

- Prefer visible labels on icon-only controls.
- Keep focus rings and keyboard confirm paths in the workbench.
- Respect reduced-motion OS preferences.
- Maintain contrast for status lamps and error text.
- Matrix: `docs/accessibility-matrix.md`.

## Governance

- Apache-2.0 `LICENSE`
- `SECURITY.md`, `CODE_OF_CONDUCT.md`
- GitHub issue templates under `.github/ISSUE_TEMPLATE/`
- Plugin release guidance: `docs/plugins/README.md`

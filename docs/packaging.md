# Packaging and product shell

## Current status: no packaging pipeline yet

The repository does not currently ship installers. There is no
electron-builder configuration, no `package:win` / `package:mac` scripts, no
installer smoke tests, and no signing wiring. The previous
`package-windows.yml` / `package-macos.yml` GitHub workflows referenced
scripts that no longer exist and have been removed rather than left broken;
they will return together with the packaging pipeline in a dedicated task.
`docs/release-signing.md` describes the signing setup for that future
pipeline, not something that works today.

## What exists today

The tested host-runtime matrix is Node 22.17+ within major 22 and Node 24.x.
Node 24 is the checked-in development default.

```bash
# 1) Build the release engine binary (current platform only)
cargo build -p tl-engine --release

# 2) Build desktop renderer + electron main/preload
pnpm build:desktop

# 3) Run the E2E gates against the debug engine
pnpm test:e2e:engine
pnpm test:e2e:desktop
```

Release engine binaries are stripped via the workspace `Cargo.toml`
`[profile.release] strip = true` setting.

## Contract for the future packaging task

- When `app.isPackaged`, Electron main resolves the engine binary at
  `process.resourcesPath/engine/tl-engine` (`tl-engine.exe` on Windows). A
  packager must place the matching-platform engine binary there.
- Ship only the matching-platform engine binary; keep optional heavy AI/QE
  models out of the installer.
- Unsigned packages must remain valid for development; signing and Apple
  notarization stay optional CI secrets.

## Data directory

- The default engine data directory is `engine-data/` under the Electron
  userData path. `TL_DATA_DIR` overrides it for tests and development; the
  engine binary itself takes `--data-dir`.
- The engine owns the directory: `state.json` whole-state persistence plus
  managed document copies under `documents/`. The renderer never opens these
  files.

## Crash recovery

- The Electron main process supervises the engine with bounded crash-restart
  and backoff (`apps/desktop/src/main/engine-supervisor.ts`); engine status
  surfaces in the workbench header instead of failing silently.

## Governance

- Apache-2.0 `LICENSE`
- `SECURITY.md`, `CODE_OF_CONDUCT.md`
- GitHub issue templates under `.github/ISSUE_TEMPLATE/`

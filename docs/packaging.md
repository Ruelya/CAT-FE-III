# Packaging and product shell

## Current status: unsigned, unpackaged directory artifact

Packaging produces an **unsigned, unpackaged directory** via electron-builder's
`dir` target. There are no installers (NSIS / DMG), no code signing, no Apple
notarization, no auto-update wiring, and no store releases. Only Linux
packaging has been exercised; the `win` / `mac` sections in
`apps/desktop/electron-builder.yml` are config-only (also `dir` targets) and
have never been run on their native platforms.

## Producing the artifact

```bash
# One step: release engine + renderer/main build + package + artifact check.
pnpm package:dir
```

The root script runs, in order:

1. `cargo build -p tl-engine --release`
2. `pnpm --filter @translunar/desktop package:dir` — clears stale `dist/`
   output, builds the renderer and electron main/preload, stages the engine
   binary, and runs `electron-builder --dir`
3. `pnpm --filter @translunar/desktop package:check` — fails unless the
   packaged engine contract below holds

Output lands in `apps/desktop/release/linux-unpacked/` (`win-unpacked/` or
`mac*/` on those hosts — untested). Configuration lives in
`apps/desktop/electron-builder.yml`.

## Engine binary contract

When `app.isPackaged`, Electron main resolves the engine binary at
`process.resourcesPath/engine/tl-engine` (`tl-engine.exe` on Windows); see
`resolveEngineBinary` in `apps/desktop/src/main/index.ts`.

The packager honors that contract in two steps:

- `scripts/desktop-stage-engine.mjs` copies the host
  `target/release/tl-engine` binary (override with `TL_ENGINE_BIN`, the same
  variable development main honors) into `apps/desktop/.package-engine/`.
- `electron-builder.yml` maps that staging directory to `resources/engine/`
  via `extraResources`. The `from` path stays relative because electron-builder
  joins it against the project directory; absolute temp paths silently drop
  the binary on Windows.

`scripts/desktop-check-package.mjs` then asserts the unpacked output contains
`resources/app.asar` plus an executable `resources/engine/tl-engine`.

## CI

`.github/workflows/package.yml` is a manual (`workflow_dispatch`) job that
runs `pnpm package:dir` on `ubuntu-latest` and uploads
`apps/desktop/release/linux-unpacked/`. It is intentionally not part of PR CI.
The previous `package-windows.yml` / `package-macos.yml` workflows referenced
scripts that no longer exist and have been removed rather than left broken;
real installer lanes belong to a future native-runner packaging task.

## Size controls

- Ship only the matching-platform engine binary under `resources/engine/`;
  optional heavy AI/QE models stay out of the package.
- Release engine binaries are stripped via the workspace `Cargo.toml`
  `[profile.release] strip = true` setting.
- `asar` is on and Chromium locales are limited to product locales
  (`en-US`, `zh-CN`).

## Signing

Not implemented. Unsigned artifacts are valid for development and internal
hand-offs. `docs/release-signing.md` describes the signing setup for a future
installer pipeline, not something that works today.

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

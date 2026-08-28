# Packaging and product shell

## Current status: unsigned, unpackaged directory artifact

Packaging produces an **unsigned, unpackaged directory** via electron-builder's
`dir` target. There are no installers (NSIS / DMG), no code signing, no Apple
notarization, no auto-update wiring, and no store releases. Linux and Windows
packaging both run natively in CI (`.github/workflows/package.yml`); the `mac`
section in `apps/desktop/electron-builder.yml` is config-only (also a `dir`
target) and has never been run on a macOS host.

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

Output lands in `apps/desktop/release/linux-unpacked/` on Linux and
`apps/desktop/release/win-unpacked/` on Windows (`mac*/` on macOS — untested).
Configuration lives in `apps/desktop/electron-builder.yml`.

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

Packaging is deliberately kept out of PR CI. The lanes are:

- `.github/workflows/ci.yml` runs on every PR: `cargo fmt` / `clippy` /
  `cargo test` in the rust lane, and `pnpm contracts:check`, `pnpm lint`,
  `pnpm typecheck`, the desktop unit tests, `pnpm test:e2e:engine`, and the
  Playwright desktop E2E (`scripts/linux-display.sh pnpm test:e2e:desktop`)
  in the node lane on Node 22.17.0 and 24. It never invokes electron-builder.
- `.github/workflows/package.yml` is a manual (`workflow_dispatch`) workflow —
  one dispatch runs both packaging jobs, and packaging breakage stays out of
  PR CI:
  - `package-linux-dir` runs `pnpm package:dir` on `ubuntu-latest` and uploads
    `apps/desktop/release/linux-unpacked/` as `translunar-cat-linux-unpacked`.
  - `package-windows-dir` compiles natively on `windows-latest`: stable Rust
    (the default MSVC host toolchain) builds the release `tl-engine.exe`, the
    same `pnpm package:dir` chain stages it and packages the `dir` target,
    `package:check` asserts `win-unpacked/resources/app.asar` plus
    `resources/engine/tl-engine.exe`, a smoke step runs the packaged
    `tl-engine.exe --version`, and the job uploads
    `apps/desktop/release/win-unpacked/` as `translunar-cat-windows-unpacked`.
    Cargo and pnpm caches (`Swatinem/rust-cache`, `actions/setup-node` with
    `cache: pnpm`) keep the lane inside its 90-minute timeout.

Both packaging jobs first run `pnpm test:package-scripts`
(`scripts/desktop-package-win-semantics.test.mjs`), which pins the Windows
semantics of the packaging chain on any host: the `tl-engine.exe` staging
branch (including the `TL_ENGINE_BIN` override), the `win-unpacked` layout the
package check enforces, the win32-only skip of the POSIX executable-bit check,
and the relative `extraResources` mapping plus `dir`-only `win.target` in
`electron-builder.yml`.

The previous `package-windows.yml` / `package-macos.yml` workflows referenced
scripts that no longer exist (`package:win`, `release:package:check`,
`electron:install:check`) and were removed; the `package-windows-dir` job
replaces the Windows one through the maintained `package:dir` contract. Real
installer lanes (NSIS / DMG, signing, auto-update) remain future work.

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
- The engine owns the directory: an `engine.sqlite` database (one per data
  directory, WAL mode) plus managed document copies under `documents/`. A
  legacy whole-state `state.json` from older builds is imported once on first
  open and preserved as `state.json.imported-backup`. The renderer never opens
  these files.

## Crash recovery

- The Electron main process supervises the engine with bounded crash-restart
  and backoff (`apps/desktop/src/main/engine-supervisor.ts`); engine status
  surfaces in the workbench header instead of failing silently.

## Governance

- Apache-2.0 `LICENSE`
- `SECURITY.md`, `CODE_OF_CONDUCT.md`
- GitHub issue templates under `.github/ISSUE_TEMPLATE/`

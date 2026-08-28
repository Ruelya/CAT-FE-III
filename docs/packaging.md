# Packaging and product shell

## Current status: NSIS installer on Windows, unpackaged directory on Linux

Windows packaging produces an **unsigned NSIS installer**
(`translunar-cat-setup-<version>-<arch>.exe`, electron-builder `nsis` target,
assisted installer with a directory picker, per-user install, unicode with
OS-language auto-selection so zh-CN Windows installs cleanly). Linux packaging
stays an **unsigned, unpackaged directory** via the `dir` target. There is no
code signing, no Apple notarization, no auto-update wiring, and no store
releases. Both lanes run natively in CI (`.github/workflows/package.yml`); the
`mac` section in `apps/desktop/electron-builder.yml` is config-only (a `dir`
target) and has never been run on a macOS host.

## Producing the artifact

```bash
# Linux: release engine + renderer/main build + dir package + artifact check.
pnpm package:dir

# Windows: same chain, but electron-builder builds the NSIS installer.
pnpm package:win
```

Each root script runs, in order:

1. `cargo build -p tl-engine --release`
2. `pnpm --filter @translunar/desktop package:dir` (or `package:win`) — clears
   stale `dist/` output, builds the renderer (vite) and the bundled electron
   main/preload (esbuild), stages the engine binary, and runs
   `electron-builder --dir` (Linux) or `electron-builder --win nsis` (Windows)
3. `pnpm --filter @translunar/desktop package:check` — fails unless the
   packaged contracts below hold

Output lands in `apps/desktop/release/linux-unpacked/` on Linux; on Windows
the installer lands in `apps/desktop/release/translunar-cat-setup-*.exe` with
`win-unpacked/` kept as a build intermediate (`mac*/` on macOS — untested).
Configuration lives in `apps/desktop/electron-builder.yml`.

## Bundled main/preload contract

`node_modules` stays out of the asar (`files: !node_modules`), so nothing in
the archive may import a workspace package by bare specifier at runtime.
Historically Electron main was emitted by plain `tsc`, which left
`import ... from "@translunar/contracts"` in `engine-supervisor.js`; the
packaged app then died on startup with `ERR_MODULE_NOT_FOUND` even though the
directory layout looked fine (`package:check` only inspected file presence,
and no CI lane launches the packaged Electron binary).

The build now bundles both entries with esbuild
(`apps/desktop/esbuild.electron.mjs`): `dist/electron/main/index.js` and
`dist/electron/preload/index.cjs` are self-contained, inlining
`@translunar/contracts` and all other workspace runtime code; only `electron`
and the node builtins stay external. `scripts/desktop-check-package.mjs`
extracts the asar and fails the build if any `dist/electron/**` module still
carries a bare `@translunar/*` import (or if `node_modules/` sneaks into the
archive), so the regression can never go green again. Development is
unaffected: `pnpm dev` keeps the `tsc --watch` emit, where bare imports
resolve against the workspace `node_modules`.

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
`resources/app.asar` (bundled, per the contract above) plus an executable
`resources/engine/tl-engine`, and on Windows that the
`translunar-cat-setup-*.exe` installer exists.

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
  - `package-windows-nsis` compiles natively on `windows-latest`: stable Rust
    (the default MSVC host toolchain) builds the release `tl-engine.exe`, the
    root `pnpm package:win` chain stages it and runs
    `electron-builder --win nsis`, `package:check` asserts the win-unpacked
    intermediate (`resources/app.asar` with bundled main, plus
    `resources/engine/tl-engine.exe`) and the installer exe, a smoke step runs
    the packaged `tl-engine.exe --version`, and the job uploads
    `apps/desktop/release/translunar-cat-setup-*.exe` as
    `translunar-cat-windows-installer`. Cargo and pnpm caches
    (`Swatinem/rust-cache`, `actions/setup-node` with `cache: pnpm`) keep the
    lane inside its 90-minute timeout.

Both packaging jobs first run `pnpm test:package-scripts`
(`scripts/desktop-package-win-semantics.test.mjs`), which pins the Windows
semantics of the packaging chain on any host: the `tl-engine.exe` staging
branch (including the `TL_ENGINE_BIN` override), the `win-unpacked` layout,
the installer-exe requirement, the rejection of asars whose main keeps a bare
`@translunar/*` import, the win32-only skip of the POSIX executable-bit
check, and the relative `extraResources` mapping plus the `nsis`-only
`win.target` and setup-exe `artifactName` in `electron-builder.yml`.

The previous `package-windows.yml` / `package-macos.yml` workflows referenced
scripts that no longer exist (`package:win` in its old form,
`release:package:check`, `electron:install:check`) and were removed; the
`package-windows-nsis` job replaces the Windows one through the maintained
`package:win` contract. Signing, auto-update, and a macOS DMG lane remain
future work.

## Size controls

- Ship only the matching-platform engine binary under `resources/engine/`;
  optional heavy AI/QE models stay out of the package.
- Release engine binaries are stripped via the workspace `Cargo.toml`
  `[profile.release] strip = true` setting.
- `asar` is on and Chromium locales are limited to product locales
  (`en-US`, `zh-CN`).

## Signing

Not implemented. Unsigned artifacts are valid for development and internal
hand-offs; Windows SmartScreen may warn on the unsigned installer.
`docs/release-signing.md` describes the signing setup for a future signed
pipeline, not something that works today.

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

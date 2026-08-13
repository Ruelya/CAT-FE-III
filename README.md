# Translunar CAT

Translunar is a local-first computer-assisted translation desktop application.
The current MVP creates a project, imports a DOCX, persists an editable
bilingual grid, confirms translations into exact project memory, reports
deterministic number mismatches, and exports a translated DOCX. The desktop
surface also includes docked/collapsed/maximized Suggestions and document
preview panels, QA/export/TM review views, and an explicitly offline Assistant
preview with local conversations and synthetic request metadata.

The product targets Windows 10+ and macOS 12+. Linux is used for automated
validation and cross-compilation, but is not a supported desktop target.

## Prerequisites

- Node.js 24.x for the default development lane, or Node.js 22.17 or newer
  22.x for the retained release lane. Node.js 23, 25, and other majors are
  rejected deliberately.
- pnpm 10.18.3, normally provided through Corepack.
- Rust stable 1.97 or newer with `rustfmt` and `clippy`.
- On Windows, Visual Studio Build Tools with the C++ workload. The bundled
  SQLite build needs a C compiler.

The checked-in `.node-version`, `rust-toolchain.toml`, and `packageManager`
field record the tested toolchain.

## Windows Setup

After selecting Node 24 (the checked-in default) or a supported Node 22 release
runtime in your version manager:

```powershell
corepack enable
corepack prepare pnpm@10.18.3 --activate
pnpm bootstrap
```

`pnpm bootstrap` is the clean-workspace command: it performs a frozen install,
builds the Rust engine, and builds the Electron main, preload, and renderer
bundles.

Start the development application with:

```powershell
pnpm dev:desktop
```

On the current K: workstation, the checked-in launcher can use the available
Cursor-bundled Node runtime and applies the same repository version guard before
starting pnpm:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\dev-desktop.ps1
```

When `target/debug/translunar-engine.exe` already exists, this path does not
rebuild Rust. To run the production renderer bundle in Electron:

```powershell
pnpm build:desktop
pnpm --dir apps/desktop exec electron .
```

Electron main starts and owns `target/debug/translunar-engine.exe`. To run the
headless engine directly for protocol development:

```powershell
.\target\debug\translunar-engine.exe `
  --data-dir .\.translunar-data `
  --protocol stdio
```

The direct process reads one JSON-RPC 2.0 request per stdin line and writes one
response per stdout line. Diagnostics are written to stderr.

## Validation

Run the complete quality gate from the repository root:

```powershell
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm contracts:check
pnpm ui:audit
pnpm build:desktop
pnpm test:e2e:engine
pnpm test:e2e:desktop
pnpm docs:check
```

The desktop E2E suite creates isolated data and runs against the real Rust
Engine. It covers the complete import, edit, confirm, QA, and export flow,
engine restart recovery, IME guards, save-before-navigation, project lifecycle,
editor commands, Asset Hub, PDF review, interop review and table round trips,
and the P4 AI, plugin, collaboration, and settings surfaces including appearance
persistence across relaunch. A dedicated accessibility spec audits every
reachable surface with axe at every impact level in both themes, drives the
Workbench with the keyboard alone, and asserts reduced motion collapses every
transition.

### Interface quality gates

```powershell
pnpm ui:audit          # static design-system rules; exits non-zero on a finding
pnpm ui:shots          # screenshots plus geometry report, light, 1680x942
pnpm ui:shots:matrix   # both themes across all four supported viewports
pnpm ui:perf           # delivery and startup budgets against a real build
```

`ui:shots` fails on document-level horizontal overflow, a clipped or occluded
control, an overlapping interactive pair, a target under 32 px, or any renderer
console error. Supported viewports are 1180x700 (the window minimum), 1250x744,
1680x942, and 1920x1080.

On Linux, wrap the Electron suites so a window manager is present; without one
`BrowserWindow.maximize()` is a no-op and the title-bar assertions cannot run:

```bash
./scripts/linux-display.sh pnpm test:e2e:desktop
./scripts/linux-display.sh node scripts/ui-shots.mjs
```

Design authority for the renderer is
[`.trellis/spec/frontend/design-language.md`](.trellis/spec/frontend/design-language.md).
Measured budgets are in [docs/performance-budgets.md](docs/performance-budgets.md),
accessibility status in [docs/accessibility-matrix.md](docs/accessibility-matrix.md),
and release gate status in [docs/release-readiness.md](docs/release-readiness.md).

## VPS Builds

The Linux VPS is useful when local disk space is constrained. Use Node 24 or the
retained Node 22.17+ release lane for pnpm installation and UI builds. For a
Windows x64 GNU engine on Ubuntu:

```bash
sudo apt-get install gcc-mingw-w64-x86-64
rustup target add x86_64-pc-windows-gnu
cargo build -p translunar-engine --release \
  --target x86_64-pc-windows-gnu
```

The standalone result is:

```text
target/x86_64-pc-windows-gnu/release/translunar-engine.exe
```

It links bundled SQLite and does not require MinGW runtime DLLs on the target
machine.

## Local Data

Electron uses its OS-specific user-data directory and appends `engine/`. Tests
and development tools can override this with `TRANSLUNAR_DATA_DIR`. The engine
owns the entire directory:

```text
engine/
  translunar.sqlite3
  translunar.sqlite3-wal
  translunar.sqlite3-shm
  sources/
  exports/
  tmp/
```

The renderer never opens these files. SQLite is authoritative; imported source
copies remain immutable and exports are published only after validation.

## Scope

The MVP deliberately excludes network AI connectors and API-key storage,
persistent termbases, fuzzy/CJK memory retrieval, collaboration, installers,
automatic updates, and formats beyond DOCX. The Assistant is a deterministic
offline interaction preview and never claims a model request. See
[Architecture](docs/architecture.md) and
[Product Requirements](docs/PRD.md) for the fixed boundaries and longer-term
direction.

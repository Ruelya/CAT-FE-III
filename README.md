# Translunar CAT

Translunar is a local-first computer-assisted translation desktop application.
The current M0 vertical slice creates a project, imports a DOCX, persists an
editable bilingual grid, confirms translations into a project translation
memory, reports deterministic number mismatches, and exports a translated
DOCX.

The product targets Windows 10+ and macOS 12+. Linux is used for automated
validation and cross-compilation, but is not a supported desktop target.

## Prerequisites

- Node.js 22.17 or newer 22.x. Node.js 24 is intentionally rejected because
  Electron 39's installer can leave a partial runtime under Node 24.
- pnpm 10.18.3, normally provided through Corepack.
- Rust stable 1.97 or newer with `rustfmt` and `clippy`.
- On Windows, Visual Studio Build Tools with the C++ workload. The bundled
  SQLite build needs a C compiler.

The checked-in `.node-version`, `rust-toolchain.toml`, and `packageManager`
field record the tested toolchain.

## Windows Setup

After selecting Node 22 in your version manager:

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
pnpm test:e2e:engine
pnpm test:e2e:desktop
```

The desktop E2E test creates isolated data, drives Electron through the whole
M0 workflow, restarts the engine, validates the export, checks panel states,
and captures 1250x744 and 1680x942 screenshots.

## VPS Builds

The Linux VPS is useful when local disk space is constrained. Use Node 22 for
pnpm installation and UI builds. For a Windows x64 GNU engine on Ubuntu:

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

M0 deliberately excludes fuzzy search, termbases, AI connectors/chat,
collaboration, installers, automatic updates, and formats beyond DOCX. See
[Architecture](docs/architecture.md), [Design Notes](docs/design-notes.md), and
[Product Requirements](docs/PRD.md) for the fixed boundaries and longer-term
direction.

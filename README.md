# Translunar CAT

Translunar is a local-first computer-assisted translation desktop application.
The current vertical slice creates a project, imports a document, persists an
editable bilingual grid, confirms translations into project memory with exact
and fuzzy recall, mounts termbases with in-text term hits, pretranslates from
TM, reports deterministic number mismatches, and exports the translated
document. AI assist and the asynchronous agent degrade honestly without
credentials and park every agent run at a human review gate.

The product targets Windows 10+ and macOS 12+. Linux is used for automated
validation and cross-compilation, but is not a supported desktop target.

## Prerequisites

- Node.js 24.x for the default development lane, or Node.js 22.17 or newer
  22.x for the retained release lane. Node.js 23, 25, and other majors are
  rejected deliberately.
- pnpm 10.18.3, normally provided through Corepack.
- Rust stable 1.97 or newer with `rustfmt` and `clippy`.
- On Windows, Visual Studio Build Tools with the C++ workload for the MSVC
  Rust toolchain.

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

To run the production renderer bundle in Electron:

```powershell
pnpm build:desktop
pnpm --dir apps/desktop exec electron .
```

Electron main starts and owns `target/debug/tl-engine.exe`. To run the
headless engine directly for protocol development:

```powershell
.\target\debug\tl-engine.exe --data-dir .\.tl-data
```

The direct process speaks JSON-RPC 2.0 over stdio, one request per stdin line
and one response per stdout line. Diagnostics are written to stderr.

## Validation

Run the complete quality gate from the repository root. These are the same
commands CI runs (`.github/workflows/ci.yml`):

```powershell
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm contracts:check
pnpm test:e2e:engine
pnpm test:e2e:desktop
```

`test:e2e:engine` builds the debug `tl-engine` binary and drives it over stdio
JSON-RPC through the whole vertical slice: handshake, project, DOCX import,
edit/confirm, exact and fuzzy TM, termbases, pretranslate, QA, export, the
honest AI degradation path, and an asynchronous agent run against a loopback
SSE fixture.

`test:e2e:desktop` builds the engine and the desktop bundles, then runs the
Playwright suite against the real Electron app and the real engine with
isolated data: the full import → edit → confirm → TM → QA → export flow,
workbench filtering, concordance, preview, project settings, term quick-add,
pretranslation, and grid virtualization on a large document.

On Linux, wrap the Electron suite in a virtual display when no `DISPLAY` is
available:

```bash
./scripts/linux-display.sh pnpm test:e2e:desktop
```

Design authority for the renderer is
[`.trellis/spec/frontend/design-language.md`](.trellis/spec/frontend/design-language.md).

## VPS Builds

The Linux VPS is useful when local disk space is constrained. Use Node 24 or the
retained Node 22.17+ release lane for pnpm installation and UI builds. For a
Windows x64 GNU engine on Ubuntu:

```bash
sudo apt-get install gcc-mingw-w64-x86-64
rustup target add x86_64-pc-windows-gnu
cargo build -p tl-engine --release \
  --target x86_64-pc-windows-gnu
```

The standalone result is:

```text
target/x86_64-pc-windows-gnu/release/tl-engine.exe
```

## Local Data

Electron uses its OS-specific user-data directory and appends `engine-data/`.
Tests and development tools can override this with `TL_DATA_DIR`; the engine
binary itself takes the location as `--data-dir`. The engine owns the entire
directory:

```text
<data-dir>/
  state.json
  documents/<document-id>/
```

`state.json` is the whole-state JSON persistence for the current phase; a real
storage layer can replace it without touching the wire protocol. Managed
copies of imported documents live under `documents/`. The renderer never opens
these files.

## Scope

The current phase deliberately excludes installers and code signing, automatic
updates, and collaboration. AI connectors are limited to OpenAI-compatible
endpoints configured at runtime; without credentials, assist and agent
features refuse honestly instead of pretending. See
[Architecture](docs/architecture.md) and
[Product Requirements](docs/PRD.md) for the fixed boundaries and longer-term
direction.

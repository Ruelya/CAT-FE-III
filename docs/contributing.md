# Contributing

## Development setup

- Node.js 24.x (default development lane) or Node.js 22.17+ within major 22
  (retained release lane), with pnpm 10.18.3 via Corepack
- Rust toolchain from `rust-toolchain.toml` (stable, with `rustfmt` and
  `clippy`)
- On Windows: Visual Studio Build Tools with the C++ workload for the MSVC
  Rust toolchain

```bash
pnpm bootstrap          # frozen install + engine build + desktop bundles
pnpm dev:desktop        # run the development app
```

Run the full quality gate before opening a pull request. These are the same
commands CI runs (`.github/workflows/ci.yml`):

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm contracts:check
pnpm test:e2e:engine
pnpm test:e2e:desktop
```

On Linux, wrap the Electron suite in a virtual display when no `DISPLAY` is
available: `./scripts/linux-display.sh pnpm test:e2e:desktop`.

## Architecture rules

- The Rust engine (`crates/tl-engine`) owns domain rules, state transitions,
  and every persistent write. Persistence is a rusqlite `engine.sqlite`
  database under the engine data directory (`crates/tl-engine/src/store.rs`);
  legacy whole-state `state.json` directories are imported once on first open.
- The renderer talks to the engine only through newline-framed JSON-RPC 2.0
  over stdio, mediated by Electron main and the context-isolated preload.
- Generated protocol contracts (`packages/contracts`, generated from
  `crates/tl-protocol`) are the only renderer wire types. After any protocol
  change run `pnpm contracts:generate` and commit the result;
  `pnpm contracts:check` fails on drift.
- The desktop renderer must not implement TM scoring, QA rules, segmentation,
  or format filtering. Those live in the `tl-*` crates.
- AI assist and the asynchronous agent degrade honestly without credentials.
  Do not add code paths that pretend to work when no provider is configured,
  and keep every agent run parked at the human review gate.

## Packaging and release

Packaging currently produces only an unsigned, unpackaged directory artifact
(`pnpm package:dir`, plus the manual `package.yml` workflow); there are no
installers and no signing pipeline yet. See
[`docs/packaging.md`](packaging.md) for what exists today and the contract a
future installer pipeline must meet.

Governance: [`LICENSE`](../LICENSE), [`SECURITY.md`](../SECURITY.md), and
[`CODE_OF_CONDUCT.md`](../CODE_OF_CONDUCT.md).

## Pull requests

- Keep changes scoped; avoid unrelated Trellis/toolchain noise.
- Add or update focused tests for new engine methods, filters, or renderer
  flows.
- Update `.trellis/spec/**` when a verified convention changes.
- Never commit secrets, signing certificates, or live credentials.

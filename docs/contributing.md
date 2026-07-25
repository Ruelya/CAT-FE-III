# Contributing

## Development setup

- Node.js 22.x and pnpm 10.x
- Rust toolchain from `rust-toolchain.toml`
- Optional PDF/OCR tools for full smoke: `pdfinfo`, `pdftoppm`, `tesseract`

```bash
pnpm install
cargo build -p translunar-engine
pnpm contracts:check
pnpm lint
pnpm typecheck
cargo test --workspace
```

## Architecture rules

- Rust Engine owns domain rules and SQLite writes.
- Generated protocol contracts are the only renderer wire types.
- Desktop renderer must not implement TM/QA/filter scoring.
- Plugins are process-isolated; do not execute plugin code in the renderer.
- Product-shell OS behavior (dialogs, data-directory migration, draft journal,
  updates) lives in Electron main/preload with typed results.

## Product shell

- Localization catalogs: `apps/desktop/src/renderer/i18n/`
- Shell settings / backup / restore / updates: `apps/desktop/src/main/`
- Project AI allowlist is stored in `ProjectConfiguration.engineAllowlist` and
  enforced in the Engine before interactive, batch, and pipeline AI starts.

## Packaging and release

- See `docs/packaging.md` and `docs/release-signing.md`.
- Plugins: `docs/plugins/README.md`.
- Governance: [`LICENSE`](../LICENSE), [`SECURITY.md`](../SECURITY.md), and
  [`CODE_OF_CONDUCT.md`](../CODE_OF_CONDUCT.md).

## Pull requests

- Keep changes scoped; avoid unrelated dirty Trellis/toolchain noise.
- Add or update focused tests/smoke for new Engine methods or shell flows.
- Update `.trellis/spec/**` when conventions change.
- Never commit secrets, signing certs, or live release credentials.

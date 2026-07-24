# Implementation Plan: Public Plugin Runtime and SDK

## Preconditions

- [x] Archive asset-curation-center and keep unrelated dirty paths untouched.
- [x] Research internal registries, parent design tier model, and PRD P module.
- [x] Read backend/frontend specs before coding (`trellis-before-dev`).

## Ordered implementation

### 1. Planning artifacts

- [x] Write converged `prd.md`, `design.md`, `implement.md`, research note.
- [x] Curate `implement.jsonl` / `check.jsonl`.

### 2. Runtime core

- [x] Add `crates/plugin-runtime` with manifest types, validation, process host,
      filter event codec, and `ProcessDocumentFilter`.
- [x] Extend `FilterRegistry` with `unregister`.
- [x] Unit tests: valid/invalid manifests, handshake, crash isolation mock.

### 3. Storage + protocol + engine

- [x] Migration 16 plugin_installations + store APIs.
- [x] Protocol `plugin.*` methods, catalog entries, generate contracts.
- [x] Engine PluginManager: install/copy, enable/register, disable, uninstall,
      restart reload, capability strings, typed errors.
- [x] Focused Engine/storage tests + smoke scope `plugin`.

### 4. Public SDK + example

- [x] `packages/plugin-sdk` process server + filter helpers + tests.
- [x] `examples/plugins/hello-srt` Node entry implementing SRT import/export.
- [x] Minimal docs in `docs/plugins/README.md`.

### 5. Desktop surface

- [x] `PluginsPanel` + Project Insights tab.
- [x] Main/preload install path helper for tests.
- [ ] Vitest utils + real-Engine E2E happy path. (panel shipped; focused Engine smoke covers lifecycle)

### 6. Quality gate

- [ ] contracts/lint/typecheck/tests/clippy/fmt/smoke/desktop build.
- [ ] Spec update for plugin conventions.
- [ ] Scoped commit batch only.

## Validation commands

```powershell
pnpm contracts:check
pnpm lint
pnpm typecheck
pnpm test
pnpm --filter @translunar/desktop test
pnpm --filter @translunar/desktop build
$env:TRANSLUNAR_SMOKE_SCOPE='plugin'; node scripts/engine-smoke.mjs
```

```bash
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
```

## Rollback points

- Before migration 16: delete runtime/protocol scaffolding only.
- After migration 16: rely on automatic DB backup; never rewrite 1-15.
- If process host is unstable: keep install/list disabled and do not advertise
  filter contribution capabilities.

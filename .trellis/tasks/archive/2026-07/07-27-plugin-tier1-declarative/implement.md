# Implementation Plan: Tier 1 Declarative Host

## Preconditions

- [x] The multi-tier runtime and plugin permission tasks are committed and
      archived.
- [x] Read backend Engine/database/error/quality specs and the plugin-runtime,
      filter, QA, pipeline, protocol, SDK, and Engine lifecycle definitions.
- [x] Confirm all new definition bounds and typed failures before changing
      generated contracts.

## Ordered Work

1. [x] Add versioned typed Tier 1 filter, QA-pack, and pipeline-transform
       definitions to plugin-runtime; validate normalization, bounds, runtime /
       contribution compatibility, and unsupported legacy inventory.
2. [x] Implement the bounded declarative filter with deterministic structural
       paths, source-drift validation, staged no-clobber export, and exhaustive
       unit fixtures.
3. [x] Add owner/version-aware QA-pack and pipeline-step registries, including
       unregister/preflight, deterministic snapshots, cancellation, and output
       bounds.
4. [x] Implement `Tier1DeclarativeHost` prepare/attach/detach and integrate it
       with enable, startup reload, disable, revoke, upgrade, rollback, crash /
       incompatible state, and uninstall compensation.
5. [x] Route filter/QA/pipeline registration and execution through the central
       capability authorizer; add stable typed errors and bounded immutable
       audit evidence.
6. [x] Extend protocol schema/generated TypeScript and public SDK builders /
       validators without changing protocol version or breaking Tier 3.
7. [x] Add the official manifest-only Tier 1 toolkit example and exercise its
       filter, QA pack, and pipeline transform through Engine smoke.
8. [x] Add Engine lifecycle/restart/upgrade/collision/isolation tests and real
       Electron install-review-grant-enable-disable-uninstall E2E evidence.
9. [x] Update backend/frontend code-specs, run all gates, commit owned files,
       archive immediately, and update the plugin parent progress.

## Validation

```powershell
pnpm contracts:check
pnpm --filter @translunar/plugin-sdk test
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
pnpm lint
pnpm typecheck
pnpm test
pnpm format:check
$env:TRANSLUNAR_SMOKE_SCOPE='plugin'; node scripts/engine-smoke.mjs
pnpm test:e2e:desktop
pnpm docs:check
```

Run `pnpm test:e2e:engine` when the workstation has the complete PDF/OCR tool
chain; the focused plugin stdio scope is the mandatory task evidence and must
not be skipped because an unrelated PDF fixture is unavailable.

## Completion Evidence

- `cargo test --workspace`, strict workspace clippy, format, lint, typecheck,
  generated-contract, SDK (17 tests), documentation, and focused Tier 1 tests
  passed on Node 24.
- The focused real plugin stdio smoke passed after the final authorization and
  rollback fixes.
- The full Desktop E2E passed with 30 tests passed and 1 skipped. The focused
  Tier 1 Electron lifecycle passed again after the final fixes.
- `pnpm test:e2e:engine` was not run because this workstation does not provide
  `pdfinfo`, `pdftoppm`, or `tesseract`; this task's mandatory real stdio
  plugin scope passed instead.

## Risk And Rollback Points

- Land typed definitions before evaluators; evaluators before Engine lifecycle
  attachment; lifecycle before advertisement and example evidence.
- Keep prepared adapters inert until complete collision/capability preflight
  succeeds. Never expose partial registry state.
- Preserve existing normalized manifests and Tier 3 compatibility throughout;
  no released migration may be edited.
- Do not implement connector, AI action, UI panel, or JavaScript execution as a
  shortcut inside this child.

# Implementation Plan: Tier 1 Declarative Host

## Preconditions

- [ ] The multi-tier runtime and plugin permission tasks are committed and
      archived.
- [ ] Read backend Engine/database/error/quality specs and the plugin-runtime,
      filter, QA, pipeline, protocol, SDK, and Engine lifecycle definitions.
- [ ] Confirm all new definition bounds and typed failures before changing
      generated contracts.

## Ordered Work

1. [ ] Add versioned typed Tier 1 filter, QA-pack, and pipeline-transform
       definitions to plugin-runtime; validate normalization, bounds, runtime /
       contribution compatibility, and unsupported legacy inventory.
2. [ ] Implement the bounded declarative filter with deterministic structural
       paths, source-drift validation, staged no-clobber export, and exhaustive
       unit fixtures.
3. [ ] Add owner/version-aware QA-pack and pipeline-step registries, including
       unregister/preflight, deterministic snapshots, cancellation, and output
       bounds.
4. [ ] Implement `Tier1DeclarativeHost` prepare/attach/detach and integrate it
       with enable, startup reload, disable, revoke, upgrade, rollback, crash /
       incompatible state, and uninstall compensation.
5. [ ] Route filter/QA/pipeline registration and execution through the central
       capability authorizer; add stable typed errors and bounded immutable
       audit evidence.
6. [ ] Extend protocol schema/generated TypeScript and public SDK builders /
       validators without changing protocol version or breaking Tier 3.
7. [ ] Add the official manifest-only Tier 1 toolkit example and exercise its
       filter, QA pack, and pipeline transform through Engine smoke.
8. [ ] Add Engine lifecycle/restart/upgrade/collision/isolation tests and real
       Electron install-review-grant-enable-disable-uninstall E2E evidence.
9. [ ] Update backend/frontend code-specs, run all gates, commit owned files,
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

## Risk And Rollback Points

- Land typed definitions before evaluators; evaluators before Engine lifecycle
  attachment; lifecycle before advertisement and example evidence.
- Keep prepared adapters inert until complete collision/capability preflight
  succeeds. Never expose partial registry state.
- Preserve existing normalized manifests and Tier 3 compatibility throughout;
  no released migration may be edited.
- Do not implement connector, AI action, UI panel, or JavaScript execution as a
  shortcut inside this child.

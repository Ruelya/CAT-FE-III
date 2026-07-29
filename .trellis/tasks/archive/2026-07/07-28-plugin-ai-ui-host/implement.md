# Implementation Plan: Plugin AI Actions And Workbench Panels

## 1. Contracts And Compatibility

- [x] Replace provisional AI action/UI panel metadata with strict executable v1
      shapes while preserving legacy reads and explicit incompatibility.
- [x] Add Rust and SDK invocation/result/failure/limits/builders/validators and
      shared golden/negative/boundary fixtures.
- [x] Add additive protocol projections and regenerate TypeScript contracts.

## 2. Registries, Lifecycle, And Persistence

- [x] Add Engine-owned action/panel registries with built-in reservation and
      exact owner/version/activation leases.
- [x] Integrate atomic preflight/attach/detach/compensation into enable, restart,
      revoke/deny, failure, upgrade/rollback, disable, and uninstall.
- [x] Persist bounded action invocation provenance/history and sanitized failures.

## 3. Tier 2 AI Action Adapter

- [x] Add the closed sandbox action operation and public SDK handler.
- [x] Enforce exact registration/call authority, bounded context, config/result
      validation, deadline, cancellation, stale-result rejection, and safe audit.
- [x] Route accepted proposals through existing Engine mutations; never allow a
      plugin result to mutate segment state directly.

## 4. Panel Placement And Bridge

- [x] Add closed workbench placements, registry projections, deterministic merge,
      and exact detach behavior while preserving built-in panels.
- [x] Reuse opaque asset sessions and extend the MessagePort bridge only with
      capability-mapped bounded methods.
- [x] Add navigation/replay/oversize/timeout/revoke/stale-generation security tests.

## 5. Desktop, Example, And Documentation

- [x] Add generated action inventory to selection/assistant surfaces and plugin
      panels to the editor/workbench panel model with accessible controls.
- [x] Ship a deterministic public-SDK action+panel Tier 2 example.
- [x] Document contracts, placements, permissions, limits, lifecycle, security,
      upgrade/rollback, testing, and honest isolation.
- [x] Add real Engine/Electron install/enable/action/panel E2E and capture three
      target viewports; keep the complete lifecycle sequence tracked by AC-08.

## 6. Qualification And Finish

- [x] Map AC-01..AC-10 to reproducible evidence under the task directory.
- [x] Run focused SDK, plugin-runtime, Engine, storage, desktop unit/E2E, and
      sandbox security tests during implementation.
- [x] Run the complete commands below, independently review, remediate verified
      findings, update source-backed specs, commit, and archive this child.
      (Supported Node 24 gates and full desktop E2E pass for task-owned work;
      root Prettier reports only unrelated `codexgoal.md`.)

## Validation Commands

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm contracts:check
pnpm docs:check
pnpm test
pnpm --filter @translunar/plugin-sdk test
pnpm --filter @translunar/desktop build
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
TRANSLUNAR_SMOKE_SCOPE='plugin' pnpm test:e2e:engine
pnpm test:e2e:desktop
```

## High-Risk Files And Rollback Points

- Manifest/SDK/protocol shapes change together; contract drift is a hard gate.
- Lifecycle removal always compares the full owner token before unregistering.
- Panel bridge changes preserve the existing CSP, opaque URL, sandbox flags,
  nonce/port state machine, and payload bounds.
- Desktop proposal acceptance continues through existing revision-safe Engine
  mutations; no renderer-owned domain path is introduced.

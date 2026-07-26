# Implementation Plan: Plugin Permission Grants

## Preconditions

- [x] `07-26-plugin-multitier-runtime` is committed and archived.
- [x] Read the parent plugin PRD/design and current normalized manifest/lifecycle
      implementation before selecting the migration number.

## Ordered Work

1. [x] Define capability IDs, typed scopes, normalization, request diff, and
       stable denial errors with exhaustive unit fixtures.
2. [x] Add request/decision/audit storage migration and legacy exact-scope
       migration with restart/idempotency tests.
3. [x] Implement `PluginCapabilityService`, expected-revision mutations,
       operation checks, revocation notifications, and bounded audit paging.
4. [x] Route install/upgrade/enable, host startup, contribution registration,
       and privileged host APIs through central enforcement.
5. [x] Extend generated protocol and public SDK types; remove the blanket
       approval path from user-facing lifecycle while retaining compatibility
       handling for old clients.
6. [x] Implement accessible desktop review/version-diff/grant/deny/revoke/audit
       workflow with typed errors and no secret rendering.
7. [x] Add denial, partial scope, upgrade expansion, restart, concurrency,
       operation revocation, isolation, Engine smoke, and desktop E2E.
8. [x] Update specs, run full gates, commit owned files, complete the
       user-directed inline Trellis check, and archive immediately.

## Validation

```powershell
pnpm contracts:check
pnpm --filter @translunar/plugin-sdk test
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
pnpm test
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test:e2e:engine
pnpm test:e2e:desktop
pnpm docs:check
```

## Rollback Points

- Vocabulary/normalization lands before persistence.
- Persistence lands before enforcement.
- Enforcement stays capability-gated until denial/revocation/restart tests pass.
- Desktop consent cannot ship while an implicit blanket-grant route remains.

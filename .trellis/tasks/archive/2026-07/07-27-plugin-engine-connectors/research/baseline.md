# Engine Connector Planning Baseline

## Requirement Sources

- `docs/PRD.md:339` defines F-12: a plugin SDK through which third parties can
  connect arbitrary new engines with one interface.
- `docs/PRD.md:462` maps P-03 to the Engine connector extension point.
- `.trellis/tasks/07-19-complete-full-cat-prd/prd.md:160` requires manifests,
  lifecycle, engine extensions, explicit permissions, isolation, local
  distribution, and developer examples under R10.
- `.trellis/tasks/07-19-plugin-runtime-sdk/prd.md:88` requires versioned public
  extension contracts through owning Engine registries, with official examples
  and no private implementation dependencies.

## Current Code Facts

- `crates/plugin-runtime/src/lib.rs:981` defines only skeletal connector
  metadata; validation at `:2134` accepts a bounded protocol string, arbitrary
  operation list, and positive config schema version. No adapter is attached.
- `packages/plugin-sdk/src/index.ts:260` mirrors the same inventory-only shape.
- `crates/plugin-runtime/src/lib.rs:603` provides exact plugin/version/
  contribution/operation capability checks. `engine.connector` currently uses
  an operations scope, while `network.connect` uses normalized origins.
- `crates/engine/src/plugin.rs:643` is the lifecycle adapter boundary. Current
  registration handles declarative filter/QA/pipeline, sandbox filters, and
  process filters, but no connector registry.
- `crates/engine/src/lib.rs:2279` shows EngineService owns AI manager plus plugin
  hosts/registries/capability service, making it the correct orchestration owner.
- `crates/ai-core/src/lib.rs:33`, `:480`, and `:756` show the fixed built-in
  `AiProviderKind`, static catalog, and protocol switch in `execute_provider`.
- `crates/engine/src/ai.rs:751` exposes catalog/profile CRUD/test, while worker
  execution resolves profiles/credentials and persists run/batch state.
- `crates/storage/src/migrations.rs:548` stores provider kind as a closed CHECK
  enum; runs, batches, and usage reference those profiles/kinds. An additive
  migration/source union is required rather than overloading a fake kind.
- `crates/engine/src/allowlist.rs:25` authorizes profile IDs; preserving this
  behavior avoids mutable connector-name policy bypass.
- `apps/desktop/src/renderer/AiControlPage.tsx:91` consumes catalog/profile RPCs
  and `:202` assumes a built-in kind. Desktop integration must extend generated
  contracts and the existing flow, not add a renderer plugin executor.

## Planning Decisions

1. Preserve built-ins as adapters in one Engine-owned registry; no rewrite of
   their identifiers or behavior and no plugin-only AI execution API.
2. Bind plugin profiles and historical work to exact plugin version and
   contribution identity; never silently fall back after detach or upgrade.
3. Use one closed connector V1 operation/event contract across tiers. Tier 1 is
   limited to host-owned protocol templates; arbitrary protocols use bounded
   Tier 2 or supervised Tier 3 execution.
4. Keep credentials in Engine keyring and deliver only one ephemeral invocation
   secret. Enforce exact connector operation plus normalized network origin.
5. Reuse existing AI run/batch/cancel/retry/usage/policy workflows and stable
   failure classes. Connector failures cannot own durable domain transitions.
6. Upgrade/rollback uses inert candidate preparation, profile/config/grant
   compatibility checks, atomic switch, and complete prior-version compensation.

## Deferred Boundaries

- P-08/X-07 external-system connectors have checkpoint/pull/push/writeback
  semantics and remain a separate task.
- AI actions and general plugin panel placement remain in the AI/UI child.
- Tier 2/3 permissions are application-level controls, not OS sandbox claims.

# Codebase Research: P-08 External Connectors

## Product and Task Boundary

- P-08 is the plugin extension point; X-07 is the later official external-system
  integration flow (`docs/PRD.md:454-489`).
- The plugin parent assigns credentials, registry/host, checkpoints,
  permissions, deterministic fixture, and lifecycle to this child, while the
  automation parent consumes the SDK later
  (`.trellis/tasks/07-19-plugin-runtime-sdk/implement.md:29-35`).
- `AutomationService -> DurableJobService + outbox -> EngineService` is owned by
  the automation task. Connectors are consumers of that layer, not a second
  durable orchestration implementation
  (`.trellis/tasks/07-19-api-cli-automation/design.md:3-22`).

## Current External Connector Surface

- Rust inventory descriptor: `ExternalConnectorContributionDescriptor` has
  descriptor version, identity, transports, checkpoint version, and an open
  boolean capability map (`crates/plugin-runtime/src/lib.rs:1198-1207`).
- Validation only checks transport strings, positive checkpoint version, and
  map size (`crates/plugin-runtime/src/lib.rs:2433-2446`).
- The public SDK mirrors this skeletal shape
  (`packages/plugin-sdk/src/index.ts:686-695`).
- The gap audit correctly reports no executable contract, host, checkpoint
  model, ingestion, or writeback (`docs/Full PRD gap matrix.md:159-162`).

## Reusable Plugin Infrastructure

- `PluginCapabilityId` already includes `external.connector`; its valid scope is
  `operations`. `PluginCapabilityCheck` also carries exact plugin/version,
  operation, and optional contribution
  (`crates/plugin-runtime/src/lib.rs:126-220`,
  `crates/plugin-runtime/src/lib.rs:522-667`).
- Durable permission requests and immutable audit tables already support
  external connector legacy requests (`crates/storage/src/migrations.rs:1999-2190`).
- Existing manifest tier rules allow sandbox/process external inventory, while
  declarative validation currently has no external definition
  (`crates/plugin-runtime/src/lib.rs:2208-2260`).
- Plugin lifecycle already has candidate preflight/compensation, exact
  version/revision handling, and detach hooks that the external registry must
  join (`crates/engine/src/plugin.rs:1148-1230`,
  `crates/engine/src/plugin.rs:1470-2455`).

## Engine Connector Precedent, Not the Target Contract

- Engine connectors serve AI/translation providers. Their public docs make the
  Engine owner of profiles, credentials, requests, cancellation, usage, and
  lifecycle (`docs/plugins/connector-sdk.md:1-7`).
- Their descriptor/envelopes are closed and bounded, credentials are passed in
  a separate one-invocation context, and origins require exact grants
  (`docs/plugins/connector-sdk.md:8-90`).
- `EngineConnectorRegistry` provides atomic attach, exact owner replacement,
  monotonic leases, stale checks, and exact detach
  (`crates/ai-core/src/connector.rs:739-930`).
- Plugin Engine adapters cover declarative, sandbox, and process hosts with
  cancellation and safe error mapping (`crates/engine/src/plugin_connector.rs`).
- P-08 should reuse these patterns but must not overload the AI provider
  registry/profile schema or call an external-system connector an AI provider.

## Credential and Checkpoint Precedents

- AI credentials use a keyring abstraction with a memory test backend and store
  only presence metadata (`crates/engine/src/ai.rs:35-265`,
  `crates/engine/src/ai.rs:1239-1285`). P-08 needs a dedicated namespace and
  multiple named slots rather than reusing AI profile IDs.
- Pipeline plugin checkpoints provide useful patterns: immutable plugin binding,
  append-only attempts/checkpoints, schema validation, payload hashes, and
  provenance checks (`crates/storage/src/store.rs:8810-9055`).
- External connector checkpoints need their own profile/stream model and atomic
  result + checkpoint finalization; they must not reuse pipeline run rows.

## Planning Conclusions

1. Make the executable contract closed and versioned while retaining inventory
   readability for the old descriptor.
2. Use an exact-generation Engine registry and all three established runtime
   tiers, with a new Tier 1 external HTTP mapping.
3. Store secrets only in a dedicated keyring namespace and persist presence.
4. Persist append-only checkpoint/idempotency provenance with optimistic CAS.
5. Keep external items inert; later automation owns jobs, retries scheduling,
   webhook routing/outbox, and writes into CAT application services.
6. Prove the contract with deterministic local fixtures, restart/lifecycle
   tests, cross-plugin health, and explicit secret scans.

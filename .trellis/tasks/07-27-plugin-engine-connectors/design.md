# Design: Versioned Plugin Engine Connector Contract

## Architecture and Ownership

```text
manifest v2 engineConnector descriptor/definition
  -> package validation + capability requests
  -> Plugin lifecycle prepare
       Tier1DeclarativeConnector | Tier2SandboxConnector | Tier3ProcessConnector
  -> EngineConnectorRegistry (built-in + plugin adapters)
  -> AiProviderProfile.source (builtin | exact plugin binding)
  -> existing AiManager run/batch/retry/cancel/usage services
  -> generated protocol -> Desktop AI / Plugins surfaces
```

`ai-core` owns provider-neutral request/event/failure primitives and built-in
adapters. `plugin-runtime` owns public plugin connector schemas and Tier host
codecs. Engine owns registry attachment, authorization, profile resolution,
credentials, lifecycle compensation, and safe error mapping. Storage owns
additive durable bindings/provenance. Electron is only a generated-contract UI.

## Public Contract V1

The manifest descriptor becomes a strict versioned shape rather than an open
`protocol` plus string list. It declares stable contribution identity,
connector API version, supported closed operations/capabilities, config schema,
model/stream/usage limits, and an optional typed Tier 1 definition. All schema
objects deny unknown fields and are bounded.

The shared operation catalog is:

| Operation | Contract | Required |
| --- | --- | :---: |
| `validateConfig` | validate normalized non-secret profile config | yes |
| `test` | one bounded health/auth request and typed result | yes |
| `models.list` | bounded model descriptors/page | no |
| `generate` | ordered delta/usage/completion stream | yes |
| `cancel` | idempotently stop one request | yes |
| `shutdown` | drain/cancel and release activation | yes |

Activation/registration is host lifecycle, not a plugin-selectable Engine
method. Every request carries protocol version, request ID, deadline, model,
normalized messages/source/locales, and bounded config. The output state
machine is `started -> delta* -> usage? -> completed` or one terminal typed
failure. Host cancellation may win at any point; late events are discarded.

## Registry and Profile Model

`EngineConnectorRegistry` stores immutable `Arc<dyn EngineConnector>` entries
under a collision-safe key. Each entry records a source enum:

```text
Builtin { providerKind }
Plugin { pluginId, versionId, contributionId, contractVersion }
```

Registry mutation supports preflight, attach-all, get/snapshot, and detach by
exact plugin owner/version. Built-ins attach first and cannot be replaced.
Catalog projections combine both sources in deterministic order.

The provider profile gains an additive source union and `connector_config_json`.
Legacy rows project to `Builtin { kind }`; the old `kind` remains available in
wire compatibility projections while new writes use the source union. Plugin
profiles store exact binding/config schema provenance, never package paths or
secrets. AI run/batch/usage records snapshot connector identity/version so a
later registry change cannot rewrite history.

Deleting or uninstalling a connector with referenced profiles does not erase
history. Profiles become unavailable for new work until the exact connector is
restored or the user explicitly migrates them. No automatic fallback occurs.

## Tier Adapters

Tier 1 adds `DeclarativeEngineConnectorDefinitionV1`, limited to host-known HTTP
protocol templates and typed mappings. URL construction, fixed headers, auth
placement, request body, SSE/JSON event extraction, result text, usage fields,
and provider error mapping are enums/paths with explicit limits. There is no
expression language, script, redirect, arbitrary header injection, clock, file,
environment, or Engine handle. HTTPS is mandatory except loopback HTTP.

Tier 2 uses the existing one-worker-per-active-version sandbox and JSON bounds.
The connector adapter invokes only the connector V1 operation enum and validates
the exact event codec. It does not expose a generic network host call; network
authority is enforced by the Engine-selected connector destination.

Tier 3 extends the supervised process protocol with the same connector methods,
frames, cancellation, deadlines, event ordering, and safe errors. Connector
methods share the existing process lifecycle but do not reuse filter payloads.

## Authority and Secrets

Each descriptor requests `engine.connector` with `contributionId` and an
operations scope containing only closed operations. Each network destination
requires a separate normalized `network.connect` origin grant. Engine derives
plugin/version/contribution/operation/origin from the active registry entry and
resolved profile; plugin input cannot select them.

The existing keyring remains the only durable credential owner. On invocation,
Engine resolves the profile credential and passes one ephemeral secret value to
the exact adapter. It is zeroized after use, excluded from Debug/serde/audit,
and never available to listing or diagnostics methods. Tier 3 documentation
must state that the child process receives credential material without an OS
sandbox; consent and redaction do not imply native isolation.

## AI Execution Data Flow

1. Existing run or batch service resolves the provider profile and project
   allowlist, then snapshots the exact registry entry.
2. Engine checks active plugin revision and exact connector/network grants.
3. Credential and normalized bounded request are built by Engine.
4. Adapter emits validated ordered events into the existing durable run sink.
5. Terminal success records completion and usage with connector provenance.
   Failure maps to existing provider failure/retry classes; cancellation wins
   over a racing transport/host failure and partial text is not applied.
6. Fatal host failure is generation-checked before degrading/detaching the
   activation, preventing an old worker from affecting a newer version.

Provider test, interactive/action runs, batches, pipeline pretranslation, usage
aggregation, retry/resume, and cancellation all use this flow. There is no
plugin-only bypass service.

## Lifecycle and Transactions

Enable compiles/starts candidate adapters, validates grants and descriptor
compatibility, preflights all registry keys, attaches them, then commits the
enabled CAS. Any failure removes candidate entries/host and leaves durable
status unchanged.

Upgrade/rollback creates an inert candidate registry set and evaluates each
referencing profile:

- identical contract/config schema/origins/operations: preserve binding after
  candidate attach;
- compatible explicit config migration: stage and validate migrated config,
  then commit with the version switch;
- widened origin/operation or incompatible schema: leave requests pending and
  reject active switching until reviewed/migrated.

If registry attach, profile migration, capability CAS, or durable activation
fails, compensation removes candidate state and restores the exact prior
version, profiles, grants, adapters, and host. Disable/revoke/uninstall/degrade
detaches authority first, cancels matching work, then persists visible state.

## Desktop Design

The AI control page merges built-in and plugin catalog entries. Plugin rows show
plugin/contribution/version and unavailable/degraded status. Profile forms use
Engine-projected bounded field metadata; secret entry remains the existing
separate credential action. Unknown/custom JSON editors are not introduced.

The Plugins surface adds connector operation/profile-reference/last-safe-error
details using existing contribution inventory and permission review patterns.
Both surfaces reload Engine-owned state after mutations, preserve keyboard
focus, localize text, and handle long IDs without horizontal overflow. No
renderer-side manifest parsing, config validation, lifecycle inference, or
optimistic registry mutation is permitted.

## Compatibility and Rollback

- Protocol remains v1 and changes are additive. Generated Rust schema and
  TypeScript move together.
- Manifest v1 and existing v2 inventory remain readable. A skeletal connector
  descriptor without executable v1 details remains inspectable/incompatible;
  it is never assigned behavior silently.
- Built-in profile IDs, provider kinds, keyring keys, API defaults, run history,
  and usage remain stable through an additive storage migration.
- A global connector-plugin capability flag can stop new plugin attachment
  while retaining inventory/profiles/history and all built-in adapters.
- Rollback never edits a released migration or deletes historical evidence.

## Principal Risks

- Credential leakage across process/diagnostic boundaries: require redaction,
  zeroization, adversarial fixtures, and byte scans of SQLite/log/audit/events.
- Lifecycle races with long AI work: registry snapshots and activation
  generation checks must make cancellation/detach idempotent.
- Schema migration accidentally breaking built-ins: prove a real pre-migration
  database, profile/run/usage equality, and restart before advertising support.
- Connector event ambiguity: one state machine/codec is shared by all tiers and
  invalid/late events fail closed.

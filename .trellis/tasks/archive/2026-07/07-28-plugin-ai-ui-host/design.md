# Design: Plugin AI Actions And Workbench Panels

## Architecture

```text
manifest v2 + @translunar/plugin-sdk
  -> plugin-runtime strict descriptors/codecs
  -> PluginManager prepared activation
       -> AiActionRegistry -> Tier2SandboxRuntime
       -> UiPanelRegistry -> opaque asset session + iframe bridge
  -> additive Engine projections
  -> editor selection/assistant actions + workbench panel model
```

The Engine owns identity, authority, lifecycle, invocation, and provenance.
QuickJS owns bounded plugin execution. Electron main owns panel asset sessions.
The renderer renders generated inventory and submits ordinary Engine commands;
it does not execute plugin code or infer grants.

## Public Contracts

`AiActionDescriptorV1` uses closed placement, input fields, result modes,
config schema, operation protocol, and limits. `AiActionInvocationV1` contains
an invocation ID, immutable contribution identity, bounded active-segment
context, config, and deadline. `AiActionResultV1` returns a closed proposal
union plus bounded usage. Failures use stable codes for validation, permission,
timeout, cancellation, host failure, stale activation, and protocol failure.

`UiPanelDescriptorV1` replaces free-form placement with a supported placement
enum and declares bridge/config versions and capability-mapped bridge methods.
Generated inventory projections include exact owner/version/activation/state.

Legacy descriptors remain serializable but are incompatible until all required
v1 fields exist. Compatibility inspection never executes plugin code.

## Registries And Activation

Both registries key by contribution ID and store a full owner token:

```text
pluginId + immutableVersionId + activationRevision + contributionId
```

Activation validates descriptors, grants, placements/assets, sandbox exports,
and collisions before mutation. Attach is deterministic and compensation
removes only the matching owner token. Invocation leases and panel sessions
capture that token, so late completion or revocation cannot target a newer
generation with the same public ID.

## AI Action Flow

1. Desktop lists active actions from an Engine projection.
2. User invokes one from the selection or assistant surface.
3. Engine resolves the owner lease and rechecks exact authority.
4. Engine builds a bounded context and calls the existing Tier 2 operation.
5. The adapter validates and canonicalizes the proposal and rechecks the lease.
6. Desktop displays the proposal; acceptance uses the existing segment update
   command and normal revision/lock rules.

No action receives credentials or a generic provider handle. If an approved
host operation is later needed, it maps to one broker method and capability.

## Panel Flow

The workbench consumes Engine panel inventory and merges active plugin entries
after reserved built-ins in deterministic order. Opening a panel asks Electron
main for the existing opaque session. Main revalidates active revision and
exact panel authority before serving the package surface.

The transferred MessagePort remains the sole authority channel. New methods are
closed, versioned, bounded, and routed through main/Engine authorization. A
navigation, protocol error, timeout, grant revoke, lifecycle mutation, reload,
or close revokes the session and removes the mounted surface.

## Persistence And Protocol

Action invocation history persists identity, hashes, status, failure code,
timestamps, and bounded usage, never text or prompt/output payloads. Panel
inventory is derived from plugin installation/version state; ephemeral session
tokens and ports are never persisted.

Protocol additions are additive under v1: action list/invoke/history and panel
inventory/session-authority projections. TypeScript is regenerated from Rust.

## Compatibility And Rollback

- Built-in actions and panels use reserved owners and preserve public behavior.
- Manifest v1 and existing Tier 2 filter/panel-preview packages remain readable.
- Candidate upgrade preflights action/panel conflicts and grants before CAS.
- Rollback uses the same preparation and exact-generation compensation.
- Feature capability advertisement is enabled only when the complete registry,
  host, protocol, and desktop path is available.

## Security Boundary

QuickJS and the isolated iframe are application-level containment, not an OS
sandbox. Every input/output is bounded JSON. No plugin receives Node, Electron,
filesystem, network, environment, SQLite, arbitrary Engine RPC, or credentials.
Audit and diagnostics use identities, hashes, counts, and stable codes only.

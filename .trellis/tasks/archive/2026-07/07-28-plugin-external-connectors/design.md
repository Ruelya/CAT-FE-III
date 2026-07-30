# Design: External System Connector SDK

## Architecture and Ownership

```text
Plugin manifest + public SDK
          |
  strict descriptor validation
          |
Plugin lifecycle preflight ---- existing capability authorizer/audit
          |
exact-generation ExternalConnectorRegistry
          |
Tier 1 declarative | Tier 2 sandbox | Tier 3 process
          |
ExternalConnectorService
   | profile/config metadata       | credential slots
   | Store (SQLite)                | dedicated OS keyring
   |                               |
   +-- invocation/idempotency ---- +
   +-- atomic checkpoint history
          |
later AutomationService / jobs / webhook routes / application writes
```

The connector service is a synchronous, bounded application boundary. It
normalizes external objects and receipts but does not import them into CAT or
schedule future work. The automation family may call this service and then use
its own durable job transaction to invoke normal Engine application services.

## Contract Shape

Add a Rust-owned `external_connector` V1 contract to `plugin-runtime` and
generate/mirror it through `@translunar/plugin-sdk` and protocol schema.

The executable descriptor fixes:

- `kind = externalConnector`
- `descriptorVersion = 1`
- `protocol = translunar.externalConnector.v1`
- `contractVersion = 1`
- `configSchemaVersion` and `checkpointSchemaVersion`
- declared operations, normalized origins, credential slots, and per-operation
  limits

`validateConfig` and `test` are required; at least one of `pull`, `push`,
`poll`, or `webhook` is required. Lifecycle methods (`cancel`, `shutdown`, and
checkpoint migration) are host methods, not grantable business operations.

All operation envelopes are closed tagged unions with a shared request header:
request ID, deadline, profile binding, operation, optional idempotency key,
expected checkpoint revision, attempt number, and operation payload. Credential
values are never fields in this union. Invocation context contains a bounded
map of only the credential slots selected by the host for that operation and a
cancellation signal; the map is cleared after every call.

Normalized items use stable external ID/revision, source and target locales,
bounded source/target text, optional context, and bounded scalar metadata.
Results use page/batch items, receipts, `hasMore`, and an optional checkpoint
candidate. The candidate is data, not authority to write the Store.

## Profiles and Credentials

An Engine profile contains non-secret configuration and an immutable connector
binding snapshot. The binding includes plugin/version/activation/contribution,
descriptor hash, contract/config/checkpoint schema versions, and normalized
origins/operations. A stale or missing exact registry lease makes the profile
unavailable; there is no fallback to a newer plugin version.

Use a dedicated credential-store namespace such as
`translunar-cat.external-connector`. Keyring account IDs combine profile ID and
declared slot ID without exposing labels or values. Tests inject a memory
backend. SQLite stores only per-slot presence. Set/delete/status RPCs validate
the profile and slot against the exact active descriptor.

Redaction is defense in depth: secrets never enter serializable requests;
`SecretString`/equivalent wrappers redact debug output; safe-error mappers strip
paths, bodies, headers, and runtime diagnostics; tests scan SQLite, logs, audit,
evidence, and protocol output for fixture secrets.

## Registry and Lifecycle

Model the external registry on `EngineConnectorRegistry`, but use the fuller
owner token already used by AI/UI registries:

```text
pluginId + versionId + activationRevision + contributionId + contractVersion
```

Each attached lease has a monotonic registry generation and active flag. Lookup
checks contribution ID, exact owner token, and generation. Preflight validates
all candidates without mutation. Attach-all and owner replacement occur under
one registry write lock; old leases are marked inactive only after the complete
candidate set is ready. Active calls are canceled before detached hosts shut
down.

Enable order is validate package/descriptor -> validate permissions/origins ->
construct and health-check hosts -> preflight collisions -> attach registry ->
publish profile availability. Compensation reverses candidate state in the
opposite order. Disable/revoke/degrade/uninstall detach only the exact owner.

Upgrade carries a profile only when contract/config/credential slots/origins/
operations are compatible. Added operations, origins, or credential slots
require review and new grants. Checkpoint schema changes call a bounded explicit
migration against a copy, append a new-schema checkpoint only after validation,
and retain old history for rollback. Candidate failure reattaches the previous
owner and binding.

## Runtime Adapters

### Tier 1 Declarative

Define a closed per-operation endpoint/mapping table. The host owns URL
construction, method allowlist, credential placement, response extraction,
limits, and failure mapping. Only HTTPS and loopback HTTP are accepted; redirects
are disabled and profile configuration cannot replace the normalized origin.
Webhook verification supports only declared bounded schemes (initially none or
HMAC-SHA256 with a declared header and credential slot) before response mapping.

### Tier 2 Sandbox

Extend the existing QuickJS adapter with closed
`externalConnector.validateConfig|test|pull|push|poll|webhook|cancel` methods.
Finite JSON, heap/stack/time/output/queue limits, interrupt cancellation, module
policy, and absence of Node/filesystem/network globals remain unchanged. Network
access, when needed, goes through a closed host call that rechecks the exact
origin grant.

### Tier 3 Process

Extend newline JSON-RPC helpers with the same methods and envelopes. Frames,
stderr, deadlines, cancellation, process exit, and shutdown stay bounded. The
child receives only selected invocation credentials; documentation continues to
state that this is process isolation, not user-account/OS authority isolation.

## Durable State and Atomicity

Add additive strict tables (exact names may follow local migration conventions):

- connector profiles and exact binding snapshots;
- credential-slot presence metadata;
- append-only checkpoint history keyed by profile + stream + revision;
- invocation/idempotency records keyed by profile + operation + idempotency key.

Checkpoint rows contain schema version, JSON hash, owner provenance, and time.
Invocation rows contain request hash, status, bounded result/receipt hash or
safe failure, attempt metadata, and time, never raw credentials or unbounded
documents.

Operation flow:

1. Resolve profile and exact current lease; authorize operation and origin.
2. Validate deadline, configuration, credential-slot presence, request shape,
   expected checkpoint, and idempotency claim in a short transaction.
3. Invoke the host outside the SQLite transaction.
4. Validate the complete result/event sequence and checkpoint candidate.
5. In one transaction, compare-and-swap checkpoint revision, append checkpoint
   history, and finalize the bounded invocation receipt.

Failure before step 5 leaves the prior checkpoint current. A repeated completed
key with the same request hash returns the stored receipt; a changed hash is a
typed conflict. An interrupted in-flight record may be retried with the same key
and plugin-visible attempt metadata. The remote side must honor that key for
push; the fixture proves no duplicate remote mutation. This layer exposes retry
hints but never schedules retries or writes automation job/outbox rows.

## Permissions and Audit

For every operation, construct an Engine-derived capability check:

- `external.connector` with the exact operation scope and contribution ID;
- `network.connect` with the exact normalized origin for network activity.

Registration checks both before visibility. Runtime checks both again before
each privileged operation/host call. Existing authorizer behavior supplies
immutable allowed/denied audit. Revocation first changes the durable decision,
then cancels and detaches the owner. Returned external items are inert data;
later CAT writes require separate automation/application authorization.

## Compatibility and Rollback

- Protocol additions stay under V1 and generated TypeScript remains canonical.
- Inventory-only external descriptors remain inspectable but never executable.
- Migrations are additive, tested from fresh and prior schemas, and never edit a
  released migration.
- Existing plugin types and built-in/AI engine connectors remain unchanged.
- Rollback selects the previous exact plugin version and its compatible profile
  binding/checkpoint history; it never downcasts a migrated checkpoint in place.

## Qualification Strategy

The deterministic fixture uses a loopback server/state machine and local test
credentials. It records remote mutations by idempotency key and supports pages,
empty polls, signed webhook payloads, auth denial, rate-limit hints, malformed
responses, delay/cancel, and crash modes. Tests exercise each tier where the
contract applies, restart from a real temporary SQLite workspace, lifecycle
replacement, permission audit, secret scans, and ordinary/cross-plugin health.

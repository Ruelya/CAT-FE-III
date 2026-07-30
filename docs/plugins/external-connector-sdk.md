# External System Connector SDK

External connector contract V1 (P-08) lets a plugin exchange bounded translation
objects with an external system through authenticated pull, push, poll, and
webhook operations. The Engine owns credentials, authorization, exact-generation
lifecycle, durable checkpoints, and safe failure behavior.

Automation work that schedules durable jobs, owns webhook HTTP ingress/outbound
delivery, or writes into projects/TM/termbases is **out of scope** for this SDK.
Those surfaces belong to the automation task and later X-07 system flow.

## Versioned contract

An executable descriptor uses these fixed values:

```json
{
  "kind": "externalConnector",
  "descriptorVersion": 1,
  "protocol": "translunar.externalConnector.v1",
  "contractVersion": 1,
  "configSchemaVersion": 1,
  "checkpointSchemaVersion": 1,
  "operations": ["validateConfig", "test", "pull", "push", "poll", "webhook"]
}
```

`validateConfig` and `test` are mandatory. At least one exchange operation
(`pull`, `push`, `poll`, or `webhook`) is required. Cancel and shutdown are host
lifecycle methods, not grantable business operations.

The released inventory-only descriptor with `transports`, `checkpointVersion`,
and an open capability map remains readable for package inspection, but it is
incompatible and cannot attach to the external connector registry.

## Requests, results, and credentials

Use `@translunar/plugin-sdk` helpers (`defineExternalConnector`,
`defineDeclarativeExternalConnector`, validators, Tier 2/Tier 3 adapters)
rather than constructing protocol fields by hand.

A request carries a request ID, deadline, exact profile binding, operation
payload, optional idempotency key, and expected checkpoint revision. Credential
values are **never** request fields. The host selects only the credential slots
declared for that operation and delivers them in
`ExternalConnectorInvocationContextV1` for one invocation. Clear the map after
every call.

Normalized items use stable external ID/revision, locales, bounded text, and
scalar metadata. Pull/poll/webhook return items plus an optional checkpoint
candidate. Push returns per-item receipts and may return a checkpoint candidate.
The candidate is data, not authority to write the Store; the Engine commits
checkpoint history only after validating a successful result.

## Profiles, keyring, and redaction

Engine profiles store non-secret configuration and an immutable connector
binding snapshot (plugin/version/activation/contribution, contract/config/
checkpoint schema versions, origins/operations). Secrets use the dedicated
OS-keyring namespace `translunar-cat.external-connector`. SQLite stores only
per-slot presence. Set/delete/status RPCs require optimistic profile revision
checks.

Secrets must not appear in manifests, profile configuration, checkpoints,
idempotency records, protocol results, audit rows, diagnostics, safe errors,
logs, or fixture evidence.

## Permissions and origins

Installation grants nothing. Registration and every operation require
`external.connector` scoped to the exact contribution and operation. Network
activity also requires `network.connect` for each normalized origin. Plugin
input cannot select or widen authority. Revocation detaches only the exact
owning generation.

## Runtime tiers

### Tier 1 declarative

Closed per-operation HTTP mappings. HTTPS except loopback HTTP, no redirects,
host-owned credential placement, and optional HMAC-SHA256 webhook signature
verification.

### Tier 2 sandbox

Bounded QuickJS methods under `externalConnector.*`. No generic Engine invoke
API, database handle, filesystem path, or ambient secret.

### Tier 3 process

Newline JSON-RPC with the same public envelopes. Process isolation is not an OS
sandbox claim.

## Checkpoints and idempotency

Checkpoints are scoped by profile and stream, append-only, and CAS-protected on
expected revision. Failures, cancellation, timeouts, stale generations, and
invalid results never advance a checkpoint. Same-key replay with the same
request hash returns the stored bounded receipt; a different hash is a typed
conflict. Retry scheduling is owned by automation; this contract only exposes
stable keys and optional retry-after hints.

## Public RPCs

| Method | Purpose |
| --- | --- |
| `externalConnector.catalog` | Active executable contributions |
| `externalConnector.profile.list/create/update/delete` | Non-secret profiles |
| `externalConnector.credential.set/delete/status` | Keyring-backed slots |
| `externalConnector.invoke` | Synchronous operation |
| `externalConnector.checkpoint.get` | Last committed stream checkpoint |

## Automation boundary

Do not use this SDK to:

- create durable jobs, outbox rows, or scheduled retries;
- own a public webhook listener or callback URL registry;
- write connector results into projects, documents, segments, TM, or termbases.

Call `externalConnector.invoke`, then let application services perform authorized
CAT writes under their own transactions.

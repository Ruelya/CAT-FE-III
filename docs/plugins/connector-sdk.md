# Engine Connector SDK

Engine connector contract V1 lets a plugin contribute a translation or AI
provider without importing private Engine, protocol, storage, or Desktop
modules. The Engine remains the owner of profiles, credentials, permission
decisions, requests, run history, cancellation, usage, and lifecycle.

## Versioned contract

An executable descriptor uses all of these fixed values:

```json
{
  "kind": "engineConnector",
  "descriptorVersion": 1,
  "protocol": "translunar.engineConnector.v1",
  "contractVersion": 1,
  "operations": ["validateConfig", "test", "models.list", "generate"]
}
```

`validateConfig`, `test`, and `generate` are mandatory. `models.list` is
optional and must be omitted when the connector has no model catalog. Cancel
and shutdown are mandatory handler lifecycle methods, not grantable operations.
Unknown versions, descriptor fields, operations, request/event variants, or
unbounded values fail before a host or registry mutation.

The released inventory-only descriptor with arbitrary `protocol` and
`operations` remains readable for package inspection, but it is incompatible
and cannot attach to the connector registry.

## Requests and events

The SDK exports descriptor, configuration, request, event, result, usage,
model, failure, cancellation, and handler types. Use
`defineEngineConnector` or `defineDeclarativeEngineConnector` rather than
constructing protocol fields manually. Use the exported validators at every
untrusted boundary.

A generation request contains a request ID, deadline, normalized source and
target locales, source text, messages, model, and scalar non-secret
configuration. It does not contain an Engine method, filesystem path, database
handle, renderer API, or credential. The selected credential is delivered
separately in `EngineConnectorInvocationContextV1` for one invocation.

Generation emits contiguous zero-based events:

1. zero or more `delta` events;
2. optional `usage` events;
3. exactly one `completed` event.

`EngineConnectorEventSequenceValidatorV1` rejects duplicate completion,
events after completion, another request ID, a sequence gap, excessive event
count, and aggregate output beyond the descriptor. Partial output is not a
successful result after failure or cancellation.

The global ceilings are published as `ENGINE_CONNECTOR_LIMITS`. Every
descriptor must select positive limits no greater than those ceilings for
config bytes/fields, messages, message and source bytes, output bytes, events,
models, model IDs, deadlines, endpoints, headers, and JSON paths.

## Configuration and credentials

Connector configuration is a closed schema of `text`, `boolean`, `integer`,
and `select` fields. Values are bounded scalars. Secret fields do not exist.
An API key or token must use the Engine credential action and credential store;
it must never appear in a manifest, profile config, plugin table, log, audit,
diagnostic, run event, usage record, or safe failure.

Tier 1 authentication placement is host-owned (`none`, `bearer`, or one named
header). Tier 2 receives only the credential selected for its exact invocation
inside the bounded runtime. Tier 3 receives that credential in its child
process. Tier 3 consent and redaction are not OS isolation: native process code
has the authority of the user account unless the operating system provides a
separate sandbox.

## Permissions and origins

Installation grants nothing. Registration and every operation require an
`engine.connector` decision scoped to the exact contribution and closed
operation. Every destination also requires `network.connect` for its normalized
origin. The Engine derives plugin ID, immutable version ID, contribution ID,
operation, and origin from the active registry entry and profile; plugin input
cannot select or widen them.

Tier 1 requires HTTPS except loopback HTTP, follows no redirects, and keeps the
URL template under `destinationOrigin`. Profile config cannot replace the
origin. Fixed headers cannot set host-owned or sensitive transport headers.
Executable tiers remain subject to the same origin grant even though their
transport implementation differs.

## Runtime tiers

### Tier 1 declarative

`DeclarativeEngineConnectorDefinitionV1` describes a POST endpoint, fixed
headers, authentication placement, typed request paths, JSON or SSE extraction,
usage paths, and HTTP failure mappings. It has no expressions, scripts,
filesystem access, environment, clock, redirect policy, or arbitrary request
method. See `examples/plugins/connector-openai-compatible`.

### Tier 2 sandbox

`createSandboxEngineConnectorPlugin` adapts an
`EngineConnectorHandlerV1` to the bounded QuickJS invocation contract. Only
`connector.validateConfig`, `connector.test`, `connector.models.list`,
`connector.generate`, and `connector.cancel` are accepted. Sandbox limits and
application permissions reduce authority but are not an operating-system
sandbox claim.

### Tier 3 process

`startProcessEngineConnector` serves the same handler over newline JSON-RPC.
Generation sends `connector.event` notifications and finishes with
`{ "completed": true }`. Frames, deadlines, cancellation, stderr, and process
teardown remain host-bounded. See
`examples/plugins/connector-handler-fixture`.

## Profiles and lifecycle

A plugin provider profile binds to plugin ID, immutable version ID,
contribution ID, connector contract version, configuration schema version, and
validated config. Projects continue to allow provider profile IDs. Runs,
batches, retries, and usage snapshot connector provenance so later disable,
upgrade, rollback, or uninstall cannot rewrite history. A missing or stale
connector makes the profile unavailable; the Engine never silently falls back
to a built-in or newer version.

Enable validates the complete candidate, permissions, origins, schemas, host,
and collisions before atomic attachment. Disable, revoke, degradation,
shutdown, and uninstall detach the exact owner/version and cancel its active
work. Other plugins and built-ins remain available.

An upgrade can preserve a profile only when contract, configuration schema,
origins, and operations remain compatible. A schema change requires an
explicit validated migration. A new operation or origin requires review and a
new grant. Candidate failure removes candidate state and restores the prior
version and profile bindings.

## Failures

Safe failures use the closed codes `invalidConfig`, `authentication`,
`rateLimit`, `timeout`, `unavailable`, `protocol`, `responseSize`, `cancelled`,
and `hostCrash`. Only retryable rate-limit or unavailable failures may carry a
bounded `retryAfterMs`. Failure messages must not contain a response body,
prompt, source or target text, credential, path, stack, or runtime handle.

## Local qualification

The official examples use one deterministic loopback server and the local-only
credential `fixture-secret`; no external service or paid account is needed.

```powershell
node scripts/build-connector-examples.mjs
node --test scripts/connector-examples.test.mjs
pnpm --filter @translunar/plugin-sdk test
```

The fixture covers success, ordered streaming, usage, authentication failure,
rate limiting with retry-after, malformed SSE JSON, deadline timeout,
cancellation, post-cancel health, and public-import enforcement.

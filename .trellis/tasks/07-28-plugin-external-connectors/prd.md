# External System Connector SDK

## Goal

Deliver the public P-08 plugin extension point that lets an external system
exchange bounded translation objects with Translunar through authenticated
pull, push, poll, and webhook operations. The Engine must own credentials,
authorization, exact plugin-generation lifecycle, durable checkpoints, and
safe failure behavior so later automation work can consume the connector
without importing plugin internals or duplicating connector state.

## Background and Confirmed Facts

- Product requirement P-08 makes external-system connectors a P1 plugin
  extension point; X-07 later supplies an official system-integration flow
  (`docs/PRD.md:454-489`).
- The current `externalConnector` manifest shape is inventory-only: it has
  transports, a checkpoint version, and an open boolean capability map, but no
  executable operation contract or Engine host
  (`crates/plugin-runtime/src/lib.rs:1198-1207`,
  `packages/plugin-sdk/src/index.ts:686-695`).
- The durable permission system already defines `external.connector` with an
  operation scope, plus `network.connect`, immutable audit events, grant,
  revoke, and runtime authorization (`crates/plugin-runtime/src/lib.rs:126-220`,
  `crates/plugin-runtime/src/lib.rs:522-667`).
- The Engine connector implementation establishes the required precedent for
  closed descriptors, separated credentials, bounded hosts, atomic registry
  replacement, exact owner detachment, and stale-lease rejection
  (`docs/plugins/connector-sdk.md`, `crates/ai-core/src/connector.rs:39-125`,
  `crates/ai-core/src/connector.rs:739-930`).
- The automation parent owns shared durable jobs, scheduling, folder watch,
  webhook HTTP ingress/outbound delivery, and outbox orchestration. This task
  owns the reusable connector contract and synchronous Engine operation
  boundary; it must not create a competing job/outbox system
  (`.trellis/tasks/07-19-api-cli-automation/design.md:3-22`).

## Requirements

### R1. Strict Versioned Connector Contract

- Replace the executable interpretation of the skeletal descriptor with a
  closed V1 descriptor containing fixed protocol and contract versions,
  configuration and checkpoint schema versions, bounded limits, credential
  slot declarations, and an explicit operation set.
- The closed operations are `validateConfig`, `test`, `pull`, `push`, `poll`,
  and `webhook`. Validation and test are mandatory; every connector must
  declare at least one exchange operation. Undeclared operations fail before
  host invocation.
- Every request/result envelope carries a request ID, deadline, exact connector
  profile/binding identity, operation-specific payload, and bounded metadata.
  Mutating or resumable requests also carry a stable idempotency key and the
  expected checkpoint revision.
- Pull, poll, and webhook results return bounded normalized external items plus
  an optional checkpoint candidate. Push returns bounded per-item receipts and
  may return a checkpoint candidate. Unknown fields, enum variants, versions,
  operations, oversize values, non-finite JSON, and malformed event sequences
  fail closed at every untrusted boundary.
- The released skeletal descriptor remains readable for inventory and package
  inspection but is incompatible with executable registration.

### R2. Profiles and Credential Boundary

- Engine-owned connector profiles bind to plugin ID, immutable version ID,
  activation revision, contribution ID, contract version, configuration schema
  version, checkpoint schema version, and validated non-secret configuration.
- Credentials are named bounded slots declared by the descriptor. Values are
  stored only in a dedicated OS-keyring namespace, with a deterministic memory
  backend for tests. SQLite stores presence/status metadata only.
- An invocation receives only the credential slots required by its declared
  operation, separate from the request envelope. Secrets must not appear in a
  manifest, profile configuration, checkpoint, idempotency record, protocol
  result, audit row, diagnostic, safe error, log, or fixture evidence.
- Set, delete, and status operations are additive typed Engine RPCs and require
  optimistic profile revision checks where they mutate profile state.

### R3. Engine-Owned Registry and Runtime Hosts

- The Engine owns an external connector registry keyed by contribution ID and
  an exact owner token: plugin ID, version ID, activation revision,
  contribution ID, and contract version. Registry leases have a monotonic
  generation and stale leases cannot execute.
- Enable fully validates descriptors, profiles, permissions, credential slots,
  origins, hosts, and collisions before atomic attachment. Candidate failure
  leaves the previous generation usable.
- Tier 1 uses a closed declarative HTTP mapping with HTTPS except loopback
  HTTP, no redirects, fixed normalized origins, bounded request/response
  mapping, host-owned credential placement, and declarative webhook signature
  verification.
- Tier 2 uses the existing bounded sandbox with only closed
  `externalConnector.*` methods. Tier 3 uses supervised newline JSON-RPC with
  the same public envelopes. Neither executable tier receives a generic Engine
  invoke API, database handle, filesystem path, renderer API, or ambient secret.
- Disable, revoke, degradation, shutdown, rollback, and uninstall cancel active
  calls, detach the exact generation, shut down its host, and leave built-ins
  and other plugins healthy.

### R4. Durable Checkpoints and Idempotency

- The Store persists connector profiles, immutable exact-generation bindings,
  append-only checkpoint history, and bounded invocation/idempotency records in
  additive migrations with foreign keys, uniqueness, and restart tests.
- Checkpoints are scoped by profile and named stream, include schema version,
  monotonic revision, payload hash, owner provenance, and timestamps, and are
  updated only in the same SQLite transaction that commits a validated
  successful result/receipt.
- A failure, cancellation, timeout, host crash, stale generation, permission
  denial, or invalid result never advances a checkpoint. Compare-and-swap on
  expected revision prevents concurrent lost updates.
- Reusing an idempotency key with the same operation and request hash is safe;
  a completed call returns the recorded bounded receipt, while a different
  request hash is a typed conflict. No raw content or credential is retained in
  the idempotency index.
- Restart resumes from the last committed checkpoint. Checkpoint schema changes
  require an explicit bounded migration validated against a copy; upgrade and
  rollback retain provenance and never silently reinterpret old state.

### R5. Permissions and Audit

- Registration and every invocation require `external.connector` scoped to the
  exact declared operation and contribution. Network access additionally
  requires `network.connect` for each normalized origin.
- Plugin identity, version, activation revision, contribution, operation,
  stream, and origin are derived from the active registry/profile; plugin input
  cannot select or widen authority.
- Allowed and denied registration/invocation decisions use the existing durable
  immutable capability audit. Revocation takes effect immediately and detaches
  only the affected plugin generation.
- Connector results do not directly mutate projects, documents, segments, TM,
  or termbases. A later automation/application-service caller performs those
  writes under its own authorization and transaction boundaries.

### R6. Reliability and Failure Semantics

- Calls have bounded deadlines, cancellation, frame/event/payload limits, and
  deterministic teardown. Cancellation and deadline expiration return typed
  failures and do not leave a reusable host or registry entry in an ambiguous
  state.
- Safe failures use a closed code set covering invalid configuration,
  authentication, conflict, rate limit, timeout, unavailable, protocol,
  payload size, cancellation, and host crash. Only documented retryable codes
  may include a bounded retry-after value.
- The host does not create background retries or a durable delivery queue.
  Retry scheduling belongs to automation; the connector contract supplies
  stable idempotency, attempt, failure, and retry-hint semantics so retries are
  deterministic and safe.
- A connector crash, malformed response, timeout, cancellation, or permission
  denial must not terminate the Engine. A subsequent ordinary Engine RPC and a
  contribution owned by another plugin must still succeed.

### R7. Public SDK, Fixture, Documentation, and Evidence

- `@translunar/plugin-sdk` exports descriptor, profile/configuration, credential
  slot, request/result/item/receipt/checkpoint, failure, cancellation, handler,
  Tier 1 builder, Tier 2 adapter, and Tier 3 process-server types and validators.
- Ship one deterministic official external connector fixture that imports only
  public SDK APIs and needs no paid or internet service. It exercises
  authenticated pull, push, poll, and signed webhook handling.
- Focused tests cover success, empty batches, pagination/checkpoint advance,
  restart, same-key replay, conflicting replay, authentication failure, retry
  hint, malformed/oversize payload, cancellation, deadline, revoke, disable,
  upgrade, rollback, uninstall, post-failure health, and cross-plugin isolation.
- Public documentation explains the contract, credential/keyring boundary,
  permission/origin model, checkpoint/idempotency rules, tier limitations,
  lifecycle compatibility, retry ownership, and the later automation boundary.

## Acceptance Criteria

- [ ] AC-01: Strict Rust and TypeScript validators accept the documented V1
      descriptors/envelopes and reject unknown versions, fields, operations,
      credential-in-request attempts, malformed values, and every configured
      limit overflow before registry or Store mutation.
- [ ] AC-02: A deterministic public-SDK-only fixture completes authenticated
      pull, push, poll, and signed webhook operations through Engine-owned hosts
      with no external account or network dependency.
- [ ] AC-03: Tier 1, Tier 2, and Tier 3 adapters expose the same operation/result
      semantics; cancellation, deadline, malformed output, and host failure are
      contained and an ordinary Engine health RPC still succeeds afterward.
- [ ] AC-04: Credentials round-trip through the dedicated keyring abstraction;
      persisted SQLite state, audit, checkpoints, idempotency records, logs,
      diagnostics, protocol responses, and evidence contain no secret value.
- [ ] AC-05: Registration and execution enforce exact `external.connector`
      operation/contribution grants and `network.connect` origins. Denial is
      typed and audited, and revoke immediately cancels/detaches only the exact
      owning generation.
- [ ] AC-06: Successful pull/poll/webhook or push finalization atomically commits
      its bounded receipt and checkpoint. Failure/cancel/timeout/stale revision
      does not advance state, and restart reads the last committed revision.
- [ ] AC-07: Same-operation replay with the same idempotency key and request hash
      is non-duplicating; a different hash is a typed conflict. Retryable
      failures preserve a stable key and bounded retry hint without creating a
      job or outbox row.
- [ ] AC-08: Enable, restart, disable, upgrade, rollback, degraded recovery, and
      uninstall preserve exact-generation ownership. Candidate failure restores
      the prior usable generation and compatible checkpoint/profile bindings.
- [ ] AC-09: One plugin's collision, crash, revoke, disable, upgrade, or uninstall
      cannot remove another plugin's connector or any built-in Engine connector.
- [ ] AC-10: Generated contracts, capability advertisement, Engine smoke,
      plugin runtime/SDK tests, storage migration/restart tests, deterministic
      example tests, workspace Rust tests, and relevant desktop regression gates
      pass on the repository-supported Node and Rust toolchains.
- [ ] AC-11: Documentation and the example use only public contracts and clearly
      assign durable jobs, retry scheduling, webhook HTTP routing/delivery,
      application writes, CLI/watch UI, and the final X-07 system flow to the
      automation task.
- [ ] AC-12: Reproducible evidence maps every requirement and acceptance
      criterion to focused tests and records secret-redaction scans plus ordinary
      Engine and cross-plugin health after all destructive lifecycle events.

## Out of Scope

- Durable automation jobs, schedulers, outbox/delivery queues, folder watch,
  clipboard workflows, CLI orchestration, or API/client integration.
- Owning an HTTP webhook listener, public callback URL, webhook registration UI,
  outbound webhook delivery, replay console, or allowlist administration.
- Direct writes from connector code into projects, documents, segments, TM,
  termbases, or the SQLite database.
- A real vendor-specific cloud connector, paid-service qualification, hosted
  marketplace, remote signing/index infrastructure, or broad Plugins-panel
  management UX; those belong to later automation/management tasks.
- Claims that Tier 3 process hosting is an OS sandbox.

## Constraints

- Preserve unrelated dirty worktree paths and the completed AI/UI task history.
- Keep protocol changes additive under protocol V1 and regenerate TypeScript
  contracts from Rust/schema sources rather than hand-writing renderer mirrors.
- Do not expose credentials, raw source/target bodies, filesystem paths, stack
  traces, or runtime handles in safe failures, logs, audits, or evidence.
- Planning-to-execution follows the default approval policy in `codexgoal.md`;
  once this planning set validates, run `task.py start` without another routine
  phase-approval request.

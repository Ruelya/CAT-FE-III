# Versioned Plugin Engine Connector Contract

## Goal

Complete Full PRD R10 / P-03 / F-12 with a public, versioned Engine connector
extension point. An installed plugin can contribute a translation/AI Engine
connector through the existing plugin lifecycle, users can create ordinary AI
provider profiles from it, and interactive, test, batch, cancellation, retry,
usage, restart, upgrade, rollback, and failure paths use the same Engine-owned
workflows as built-in providers.

## User Value

Plugin authors can integrate a new translation or AI engine through the public
SDK without importing private Engine crates or modifying the built-in provider
catalog. Users retain explicit control over connector activation, network
origins, credentials, and operations, while a faulty connector cannot stop the
Engine, corrupt an AI run, or replace the last working plugin version.

## Confirmed Baseline

- Manifest v2, normalized contribution inventory, package versions, CAS
  lifecycle, scoped capability decisions, immutable audit, and Tier 1/2/3
  hosts already exist.
- `EngineConnectorContributionDescriptor` currently contains only display
  metadata (`protocol`, arbitrary `operations`, and `configSchemaVersion`). It
  has no executable contract or registry attachment.
- `AiProviderKind`, `provider_catalog`, and `execute_provider` are a closed
  built-in catalog. AI profiles, runs, batches, usage, project allowlists, and
  credentials assume one of those built-in kinds.
- Tier 1 currently executes filters, QA packs, and pipeline transforms only.
  Tier 2 provides bounded JavaScript invocation and a closed host-call broker;
  Tier 3 provides a supervised newline JSON-RPC process host.
- The desktop AI control surface already manages provider profiles and the
  Plugins surface already exposes contribution inventory, grants, lifecycle,
  versions, diagnostics, and audit.

## Requirements

### R1. Versioned public descriptor and codecs

- Replace the skeletal connector metadata with a strict descriptor version 1
  and versioned request, event, result, failure, configuration, and optional
  model-catalog schemas. Unknown fields, unknown required versions, arbitrary
  operation strings, invalid schema shapes, and unbounded values fail closed.
- The closed operation catalog is `validateConfig`, `test`, `models.list`, and
  `generate`; model listing is optional, while configuration validation, test,
  generation, cancellation, and shutdown behavior are mandatory host
  contracts. Plugins never choose an Engine RPC method.
- A generation request carries only bounded normalized messages, source and
  target locales/text, model, connector configuration, request identity, and
  deadlines. Events are an ordered finite union for text delta, usage, and
  completion. Secret values, filesystem paths, SQLite handles, Engine objects,
  raw renderer APIs, and arbitrary JSON-RPC methods are never public inputs.

### R2. Engine connector registry and built-in compatibility

- Introduce one Engine-owned connector registry with immutable descriptors and
  owner/version-aware attach, lookup, preflight, and detach. Built-in
  providers are registered through adapters without changing their public
  IDs, defaults, transport behavior, profile IDs, or historical usage.
- Plugin connector identity is the tuple of plugin ID, immutable version ID,
  contribution ID, and connector contract version. Bare contribution IDs must
  not shadow built-ins or another enabled plugin.
- Provider catalog results identify a stable source (`builtin` or `plugin`),
  capabilities, active availability, and exact plugin owner/version. Project
  allowlists continue to authorize provider profile IDs, not mutable connector
  display names.

### R3. Profiles, credentials, and durable provenance

- Add an additive provider-profile source union. Existing rows decode as
  built-in sources; plugin profiles bind to the exact active connector owner,
  contribution, contract version, configuration schema version, and validated
  configuration.
- Credentials remain in the existing Engine credential store. They are passed
  only to the selected connector invocation in memory, are redacted from
  logs/audit/errors/events, and are never persisted in manifests, connector
  configuration, plugin tables, AI runs, or usage rows.
- Runs, batches, usage, diagnostics, and retry decisions preserve connector
  identity/version so historical evidence remains interpretable after plugin
  upgrade, disable, rollback, or uninstall. New work cannot start through a
  detached or stale connector; already terminal history remains readable.

### R4. Tier-specific execution

- Tier 1 supports only typed host-owned declarative protocol definitions with
  bounded endpoint templates, headers, auth placement, request mapping, stream
  parsing, response extraction, and usage extraction. It cannot evaluate code
  or arbitrary expressions. HTTPS is required except loopback HTTP.
- Tier 2 dispatches the closed connector methods through the existing bounded
  sandbox worker. It inherits module, memory, stack, queue, payload, deadline,
  cancellation, and safe-diagnostic limits and receives no generic Engine or
  network host call.
- Tier 3 dispatches the same public contract over its supervised process
  protocol with bounded frames, deadlines, cancellation, stderr, and teardown.
  Tier differences must not change the generated SDK request/result shapes.

### R5. Permission and scope enforcement

- Registration and every operation require `engine.connector` authority for
  the exact contribution and closed operation. Network access additionally
  requires `network.connect` for the normalized destination origin. Requested
  origins cannot be widened by profile configuration or redirects.
- Credential material is usable only for the exact profile/connector
  invocation selected by the Engine. Connectors cannot enumerate credentials,
  request another profile's secret, return a secret in diagnostics, or retain
  authority after cancellation/detach.
- Missing, pending, denied, revoked, stale-version, contribution-mismatched,
  operation-mismatched, or origin-mismatched authority returns a typed
  permission failure and immutable allowed/denied audit without request text,
  output text, prompt content, or secret material.

### R6. Lifecycle, upgrade, rollback, and compensation

- Enable prepares the host and connector adapters, validates all descriptors,
  grants, configuration schemas, and collisions, then attaches atomically
  before committing enabled state. Failure leaves no connector visible.
- Disable, deny/revoke, uninstall, degradation, Engine shutdown, and restart
  detach or restore the exact owner/version idempotently and cancel affected
  in-flight connector work. Built-ins and unrelated plugins remain available.
- Upgrade and rollback preflight the candidate connector and profile
  compatibility. Compatible profiles rebind only after candidate attachment;
  changed contract/config schema/origin/operation requirements require explicit
  migration or review. Candidate failure removes all candidate state and
  restores the previous durable version, registry entries, profiles, and host.

### R7. Failure isolation and run semantics

- Connector authentication, rate limit, timeout, unavailable, protocol,
  response-size, cancellation, and host-crash failures map to the existing
  stable provider failure classes with bounded retryability and optional
  retry-after data. Plugin-specific stacks, paths, response bodies, and
  credentials never cross the safe error boundary.
- Streaming events are ordered, bounded, and accepted only for the current
  request/version. Duplicate completion, delta after completion, invalid usage,
  malformed frames, excessive output, and late events are rejected. Partial
  output is never applied as a segment proposal after failure or cancellation.
- A fatal host failure degrades only the matching active plugin version,
  cancels its work, and leaves subsequent ordinary RPCs and other connectors
  healthy. A late failure from an old version cannot degrade the current one.

### R8. Public SDK, official examples, and documentation

- `@translunar/plugin-sdk` exports the exact descriptor, normalized request,
  event/result/error, handler, cancellation, and Tier 1 definition types plus
  builders/validators and Tier 2/3 server helpers. Examples import no private
  Engine, protocol-generated, or desktop implementation module.
- Ship official deterministic local examples that prove the contract without
  paid credentials: a Tier 1 declarative OpenAI-compatible fixture and one
  executable connector using the public handler contract. A local HTTP fixture
  supplies streaming, usage, auth failure, rate limit, malformed response,
  timeout, and cancellation behavior.
- Public docs cover versioning, closed methods, bounds, permissions, origin
  review, credential exposure by tier, lifecycle, profile binding, failure
  classes, upgrade/config migration, local validation, and honest isolation
  claims.

### R9. Engine and Desktop integration

- Existing `ai.provider.*`, interactive run, conversation action, batch
  pretranslation, usage, retry/resume, cancellation, project policy, and
  pipeline pretranslation paths resolve the selected profile through the
  unified registry. No parallel plugin-only run API or renderer execution path
  is allowed.
- The desktop AI catalog distinguishes built-in and plugin connectors, shows
  unavailable/degraded/version state, renders connector-owned bounded config
  fields, and creates/edits/tests profiles through generated Engine methods.
- The Plugins surface shows registered connector operations, exact profile
  references, permission/origin state, and safe last failure. It never edits
  registry state optimistically or displays credentials.

### R10. Qualification

- Cover strict codecs and bounds, each tier adapter, registry ownership,
  profile migration/provenance, credential redaction, origin enforcement,
  streaming order, cancellation, failure mapping, restart, concurrent
  lifecycle mutation, upgrade/rollback compensation, and cross-plugin health.
- Exercise the official package through real Engine stdio and production
  Electron: install, review/grant, enable, create profile, set credential,
  test, stream an interactive result, run/cancel batch work, restart, upgrade,
  fail candidate/rollback, revoke/disable, and uninstall with no console/page
  errors or stale connector availability.

## Acceptance Criteria

- [ ] AC-01: Strict Rust/generated TypeScript/SDK connector v1 contracts reject
      unknown versions, fields, operations, invalid config, and every documented
      size/depth/count bound before registry or host mutation.
- [ ] AC-02: Built-in profiles and historical runs migrate/restart unchanged,
      while plugin connectors appear in the unified catalog only when their
      exact owner/version is enabled and authorized.
- [ ] AC-03: A plugin profile binds durably to its exact connector and validated
      config; its credential is keyring-owned and absent from SQLite, manifests,
      logs, audit, diagnostics, run events, and safe errors.
- [ ] AC-04: Tier 1 declarative and Tier 2/3 executable connectors implement the
      same closed public operations; arbitrary Engine invocation, arbitrary
      network origin, and cross-profile credential access are impossible.
- [ ] AC-05: Exact contribution/operation and network-origin grants are checked
      at registration and every call; pending/denied/revoked/stale/narrow grants
      fail with typed errors and immutable secret-free audit evidence.
- [ ] AC-06: Interactive streaming, provider test, batch pretranslation, usage,
      retry/resume, cancellation, project allowlist, and pipeline paths all run
      through the unified registry and preserve connector/version provenance.
- [ ] AC-07: Timeout, crash, malformed/late/oversized output, duplicate terminal
      events, and cancellation never commit partial proposals or stop the Engine;
      another connector and a subsequent ordinary RPC still succeed.
- [ ] AC-08: Restart restores only enabled/authorized connectors. Disable,
      revoke, degradation, and uninstall detach the exact connector and cancel
      affected work without altering built-ins, unrelated plugins, or history.
- [ ] AC-09: Upgrade/rollback preserves compatible profiles and grants exactly;
      schema/origin/operation expansion requires migration/review, and failed
      candidate activation restores the previous version and live adapters.
- [ ] AC-10: Public SDK tests and official deterministic examples build and pass
      using public imports only, including success, stream, usage, auth, rate
      limit, malformed response, timeout, and cancel fixtures.
- [ ] AC-11: Real stdio smoke and Electron E2E complete install through uninstall,
      including profile creation/test/use, restart, upgrade/rollback, permission
      revoke, safe failure display, accessibility, and zero page/console errors.
- [ ] AC-12: Contract drift, documentation, workspace format/lint/typecheck/tests,
      strict Clippy, Rust workspace tests, Engine smoke, and desktop production
      E2E gates pass with reproducible task-owned evidence.

## Out Of Scope

- P-08 external-system pull/push/poll/webhook connectors and X-07 examples;
  they use a separate checkpoint/writeback contract.
- AI action or general workbench UI-panel placement, hosted marketplaces,
  remote signing, billing, or organization-wide policy distribution.
- Claims that Tier 2 or Tier 3 provides OS-level network/process isolation.
- Replacing the Engine-owned grounding, prompt, run, batch, usage, allowlist,
  keyring, or retry services with plugin-owned equivalents.

## Dependencies, Constraints, and Open Questions

- Depends on archived multi-tier runtime, permission-grant, Tier 1, and Tier 2
  children. Preserve manifest v1, normalized v2, protocol v1, and existing
  provider/profile compatibility with additive migrations only.
- Rust owns registry, profiles, credentials, run semantics, policy, storage,
  and errors. Renderer code consumes generated contracts only and never loads
  plugin code or connector definitions.
- All collections and payloads need explicit deterministic bounds. Released
  migrations are append-only; all mutable profile/lifecycle writes are
  revision-safe and compensating.
- Blocking open questions: none. The conservative compatibility rule is that
  existing built-ins remain first-class adapters and plugin profiles never
  silently fall back to a different connector or version.

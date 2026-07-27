# QA Rule And Pipeline Step SDK

The public QA and pipeline contract lets a plugin add deterministic mechanical
checks or processing steps without importing Engine, storage, protocol, or
Desktop internals. The Rust Engine owns permissions, lifecycle, input
selection, reconciliation, pipeline state, persistence, and history.

## Versioned contract

Four version axes have separate meanings:

- `descriptorVersion` controls registration shape;
- `operationProtocolVersion` controls invocation and result envelopes;
- `configSchemaVersion` controls persisted user configuration;
- `checkpointSchemaVersion` controls resumable pipeline state.

Version 1 is closed. Unknown required fields, enum values, operations, or
versions fail before registry mutation or host execution. Use `defineQaRule`,
`definePipelineStep`, and `inspectContributionCompatibility` from
`@translunar/plugin-sdk`; do not construct version negotiation manually.
Legacy manifest-v2 declarative regex packs and JSON transforms remain valid.

## QA rules

QA V1 is mechanical segment evaluation. An invocation contains bounded
project/document/segment identity, locales, source and target text, existing
tag findings, configured term expectations, and the rule's closed config. It
does not expose an Engine method, filesystem path, database handle, credential,
clock, random source, or unrestricted project snapshot.

A result contains deterministically ordered findings. Every finding has a
stable rule ID, category, severity, message, fingerprint, Unicode-scalar spans,
bounded evidence, and bounded related segment IDs. Duplicate, unordered,
oversized, unknown-segment, or out-of-range findings reject the complete
contribution result. The Engine commits no partial plugin findings.

Tier 1 uses the host-owned declarative regex evaluator. Tier 2 uses
`createSandboxQaRulePlugin`; Tier 3 uses `startProcessQaPipelinePlugin` with a
`qaRule` handler. Every registration and invocation requires the exact
`qa.register` contribution scope.

Completed runs snapshot plugin ID, immutable version ID, contribution and
schema versions, activation revision, tier, descriptor/config hashes, rule
IDs, counts, bounded usage, and sanitized failure state. Reports, waivers,
reopen behavior, and delivery gates read durable run data rather than the live
registry.

## Pipeline steps

Pipeline V1 accepts one declared artifact, validated closed config, run/project/
document identity, and an optional versioned checkpoint. It returns the
declared output artifact, optional checkpoint, and bounded usage. The Engine
validates config at definition creation and execution, enforces artifact kinds
and JSON limits, and rechecks cancellation and activation generation before
publishing output.

`resumable: true` requires a checkpoint schema and a `resume` handler. Resume
uses the immutable plugin/version binding recorded when the run was created.
A missing handler or incompatible schema returns `step_not_resumable` or
`plugin_checkpoint_incompatible`; it never silently starts from zero or hands
an old checkpoint to a new plugin version. Checkpoint history is append-only.

When an active compatible generation declares a different checkpoint schema,
the Engine calls the versioned `pipeline.checkpointMigrate` operation before
resume. Tier 2 handlers expose `migrateCheckpoint`; Tier 3 handlers expose the
same callback through `startProcessQaPipelinePlugin`. The Engine validates the
source checkpoint, target schema, migrated value, deadline, and activation
generation, then atomically appends a migration attempt and a new checkpoint.
It never rewrites the original binding or historical checkpoint. Missing,
failed, or stale migration returns `plugin_checkpoint_incompatible` and leaves
the run recoverable from its existing history.

Tier 1 retains deterministic non-resumable transforms. Tier 2 uses
`createSandboxPipelineStepPlugin`. Tier 3 uses the `pipelineStep` handler passed
to `startProcessQaPipelinePlugin`. Registration and every execute/resume call
require exact `pipeline.register` authority.

## Limits and cancellation

`PUBLIC_CONTRIBUTION_LIMITS`, `defaultQaRuleLimits`, and
`defaultPipelineStepLimits` publish the ceilings for descriptors, config,
input, output, checkpoints, JSON depth/nodes/collections, text, findings,
evidence, usage, and deadlines. A descriptor may choose smaller positive
limits, never larger ones.

Tier 1 checks cancellation between deterministic operations. Tier 2 uses the
QuickJS interrupt path. Tier 3 receives a versioned cancel notification; the
host terminates an uncooperative child after the grace deadline. Cancellation
wins completion races, so late findings, output, checkpoints, or usage are
discarded.

## Lifecycle and security

The normal flow is:

```text
plugin.inspect -> plugin.install -> plugin.permission.review
plugin.permission.grant -> plugin.enable -> run -> inspect history
plugin.disable -> plugin.uninstall
```

Enable preflights every descriptor, exact grant, host operation, and registry
collision before attaching the candidate set. Disable, revoke, degradation,
upgrade, rollback, and uninstall detach only the exact owner generation and
cancel its active calls. Upgrade and rollback preserve immutable run history;
expanded scopes require fresh consent, and checkpoint schema changes require
an explicit migration. Enabled process candidates must start and complete their
handshake before the version compare-and-swap; a failed candidate leaves the
active version and revision unchanged and is stopped immediately.

If an attach fails after a version switch, the Engine restores and reattaches
the previous immutable version. If that restoration also fails, it retains the
complete version history, removes all executable authority, and persists the
installation as `degraded` with a bounded `plugin_restore_failed` diagnostic.
Fatal process timeout, resource-limit, crash, and protocol failures likewise
degrade only the exact active generation and detach its QA and pipeline
contributions; a stale failure cannot detach a newer owner.

Tier 2 is application-level QuickJS isolation. Tier 3 is a supervised local
process but is not an operating-system sandbox: native code has the user's OS
authority. Neither tier may put document text, config secrets, stderr, raw
payloads, or credentials in safe failures, capability audit, logs, or durable
provenance.

## Qualification

`examples/plugins/qa-pipeline-process` implements a public-only brand-style QA
rule and resumable batch step. The SDK test starts the compiled process and
exercises handshake, QA evaluation, execute, resume, cancellation, typed
failure, and shutdown.

`fixtures/plugins/qa-pipeline-sandbox` exercises the same QA, pipeline,
checkpoint, and migration codecs through the bounded Tier 2 QuickJS host. Both
fixtures request exact contribution grants and import only the public SDK.

```powershell
pnpm --filter @translunar/plugin-sdk typecheck
pnpm --filter @translunar/plugin-sdk build
pnpm --filter @translunar/plugin-sdk test
cargo test -p translunar-plugin-runtime
```

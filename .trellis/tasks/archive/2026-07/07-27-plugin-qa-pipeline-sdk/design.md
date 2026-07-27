# Technical Design: Public Plugin QA And Pipeline Contracts

## 1. Architecture And Ownership

```text
manifest v2 + @translunar/plugin-sdk
  -> plugin-runtime validation / compatibility
  -> PluginManager staged activation + CapabilityAuthorizer
  -> tier host
       declarative evaluator | QuickJS worker | process JSON-RPC
  -> contribution adapter
       PluginQaRegistry -> qa-core/storage reconciliation
       PluginPipelineAdapter -> StepRegistry/PipelineRuntime
  -> protocol projections -> Desktop inventory / QA / pipeline history
```

`plugin-runtime` owns public envelopes, validation, host codecs, limits, and
tier adapters. Engine owns authority, lifecycle, generation checks, registry
mutation, orchestration, and typed error mapping. QA-core and pipeline keep
domain validation. Storage owns immutable provenance/history. Desktop only
renders generated Engine projections.

Tier-neutral means the descriptor and domain result are stable across hosts;
it does not force one transport implementation. Tier 1 evaluates typed data,
Tier 2 invokes QuickJS, and Tier 3 uses supervised JSON-RPC.

## 2. Public Contract Model

Replace provisional `Value` fields with closed version-1 shapes while retaining
manifest-v2 JSON compatibility:

```text
QaRuleDescriptorV1
  descriptorVersion, operationProtocolVersion, id, version, displayName
  ruleKind=mechanical, categories[], configSchema, limits

QaRuleInvocationV1
  protocolVersion, invocationId, contributionId, operation=evaluateSegment
  context{project/document/segment identity, locales, bounded text/tags/terms}
  config, cancellation/deadline metadata

QaRuleResultV1
  protocolVersion, findings[], usage

PipelineStepDescriptorV1
  descriptorVersion, operationProtocolVersion, id, version, displayName
  input/output ArtifactKind, configSchema, resumable, cancellable
  checkpointSchemaVersion?, limits

PipelineStepInvocationV1
  protocolVersion, invocationId, operation=execute|resume
  run/project/document identity, input, config, checkpoint?

PipelineStepResultV1
  protocolVersion, output, checkpoint?, checkpointSchemaVersion?, usage
```

SDK builders construct and validate these shapes; sandbox plugin factories and
process `startProcessPlugin` handlers expose typed QA/step callbacks. Rust and
TypeScript share golden fixtures. The existing Tier 1 declarative definitions
normalize into the same descriptors/results without changing their JSON.

Version negotiation is layered. Manifest/host API determines whether the
package can load. Descriptor version determines whether it can register.
Operation protocol governs calls. Config/checkpoint versions govern persisted
user data. Compatibility inspection returns a reason for each failed layer.

## 3. Registries, Ownership, And Activation

Introduce an Engine-owned contribution key and generation:

```text
ContributionKey { kind, contributionId }
ContributionOwner {
  pluginId, versionId, activationRevision, tier,
  contributionVersion, descriptorHash
}
```

`PluginQaRegistry` stores an owner plus `Arc<dyn PluginQaRule>`. Pipeline keeps
`StepRegistry` as the execution registry and adds an owner projection or wraps
each plugin step with the same owner token. Built-ins have a reserved built-in
owner and cannot be displaced.

Activation builds a `PreparedContributionSet`: validated descriptors, exact
grants, prepared tier hosts, and adapters. It preflights collisions against a
single live inventory, then attaches in deterministic order. Any failure
detaches only entries whose full owner generation matches the prepared set and
shuts down its prepared host. Disable/revoke/uninstall performs the inverse.

Every invocation captures an activation lease. Completion rechecks that lease
before committing output. Upgrade can therefore leave an old in-flight call
pinned while routing new calls to the new generation; stale completions are
discarded with a typed lifecycle error.

## 4. QA Data Flow

`run_qa_with_rules` is generalized from an appended regex vector to a stable
snapshot of registered QA executors. At run start Engine:

1. resolves the authoritative profile and applicable plugin rules;
2. authorizes each active contribution and snapshots owner/descriptor/grant;
3. builds a canonical rule-set hash including plugin provenance;
4. invokes rules in contribution-ID order for each bounded segment input;
5. validates and canonicalizes candidates;
6. persists reconciliation and immutable run items in one transaction.

Live segment QA uses only rules declared safe/applicable to segment-local
evaluation. Project consistency and other cross-segment semantics are not
invented by plugins in v1. One contribution failure fails the run and commits
no candidate batch for that run. Existing issue fingerprint/waiver semantics
remain authoritative; namespacing includes immutable plugin/version/grant
identity so an upgrade is a new rule provenance rather than an alias.

Add durable `qa_run_plugin_rules` (or an equivalent snapshot JSON projection)
with run ID, plugin/version/contribution IDs, descriptor/rule/config versions,
activation revision, descriptor/config hashes, status, usage, and bounded
failure. Report and gate projections read the snapshot, not the live registry.

## 5. Pipeline Data Flow

Plugin adapters implement the existing `PipelineStep` trait. Before run
creation `StepRegistry::validate_definition` additionally validates public
config against the active descriptor. The durable step run captures owner and
schema versions so execution cannot silently rebind after an upgrade.

At execution the adapter authorizes exact contribution scope, validates input,
creates the tier-specific invocation, and passes the existing cancellation
token. It validates output/checkpoint/usage before returning `StepOutcome`.
Engine rechecks cancellation and activation generation before the existing
transaction marks success.

Resumption resolves the recorded immutable plugin version, not merely the
currently active contribution. A compatible active version may resume only
when checkpoint schema equality or an explicit public migration result is
recorded. Otherwise the run reaches a typed failed/interrupted state while its
original checkpoint stays unchanged. The process protocol adds a cancel
notification and grace deadline; lack of cooperation terminates that worker.

Step-run persistence gains plugin provenance, input/output/config/checkpoint
hashes, schema versions, bounded usage, and failure. Existing built-in rows
deserialize with nullable/default plugin fields.

## 6. Authority, Limits, And Failure Mapping

Registration uses `authorize_registration`; each call uses `authorize`. Both
checks bind plugin ID, version ID, contribution ID, operation, and exact
`Contributions` scope. Host broker calls remain independently authorized.

Shared boundary validators enforce byte/depth/node/key/string/collection
budgets before conversion or persistence. QA additionally bounds findings,
spans, related IDs, evidence, and message size. Pipeline bounds artifacts,
config, checkpoints, output, and usage. Canonical JSON hashing uses sorted map
keys and rejects non-JSON or duplicate semantic IDs.

Failure mapping is stable and sanitized:

| Failure | QA result | Pipeline result |
| --- | --- | --- |
| grant/revoke/stale generation | typed plugin permission/lifecycle error; no reconciliation | `PipelineFailure`, no output/checkpoint |
| cancellation | typed canceled run/no late candidates | durable canceled state wins |
| deadline | typed bounded plugin timeout | failed/canceled per current race rules |
| crash/protocol/schema | failed run with sanitized diagnostic | bounded non-retryable/retryable failure |
| resource limit | typed plugin resource error | bounded resource failure |

Audit/history stores identities, versions, hashes, limits, counts, and codes,
never raw segment text, credentials, stderr, config secrets, or payloads.

## 7. Upgrade, Compatibility, And Compensation

Candidate upgrade is blue/green: parse and compatibility-check, prepare host,
validate descriptors/grants/config/checkpoint compatibility, and preflight all
registry keys before the version CAS. New scopes disable pending consent.

After CAS, attach the candidate generation and detach the previous generation
for new calls. If attach fails, lifecycle compensation rolls storage back to
the previous immutable version and reattaches its complete contribution set.
If reattach fails, detach all executable entries for that plugin and retain a
degraded installation plus both failure diagnostics. Rollback uses the same
path.

Completed QA runs and pipeline step runs are immutable. Running work keeps the
recorded generation until completion or cancellation. Checkpoint migration is
an explicit versioned operation whose source/target hashes and outcome are
recorded; it never edits the original checkpoint in place.

## 8. Protocol, Desktop, Examples, And Packaging

Additive protocol projections list registered QA rules and pipeline steps and
return owner/tier/version/compatibility/state/last-failure/history details.
Prefer extending existing plugin contribution inventory and pipeline step/run
projections over renderer-local types. `engine.initialize` adds capability
names for the complete public QA and pipeline contracts.

Plugins panel renders inventory/grants/lifecycle. QA findings/run details and
pipeline step/run details show durable plugin provenance. Actions remain
Engine RPCs through generated contracts. Desktop E2E uses normal install paths
and exact consent, and checks all three target viewports.

Official packages include a deterministic industry-style QA rule and a
resumable process pipeline step; Tier 1 toolkit remains a compatibility
fixture, and a compact Tier 2 fixture covers the sandbox codecs. Packaging and
docs checks prove examples depend on public SDK only and ship required files.

## 9. Migration And Rollback

Use a new additive migration for QA-run rule snapshots and pipeline step-run
provenance if existing JSON columns cannot provide indexed, immutable history.
Released migrations are untouched; fresh, real-upgrade, automatic-backup, and
rollback fixtures are required. Old rows use null plugin ownership and retain
current behavior.

Code rollback hides new UI/capabilities but preserves readable additive rows.
A binary that cannot interpret a contribution descriptor refuses registration
without mutating install/version history. Failed example/report/export work
uses existing no-clobber publication behavior.

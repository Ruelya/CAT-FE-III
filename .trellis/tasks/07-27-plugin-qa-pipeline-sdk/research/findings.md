# Research Findings: Plugin QA And Pipeline SDK

## Parent And Product Contract

- Parent `07-19-plugin-runtime-sdk` R10 and AC-12 require versioned public QA
  and pipeline SDKs with official examples using no private Engine dependency.
- `docs/PRD.md` P-04/H-12 requires third-party custom QA checks; P-05 requires
  custom processing steps in composed pipelines. The product architecture
  keeps domain execution in the headless Engine.
- `docs/design-notes.md` fixes the three-tier boundary: Tier 1 is controlled
  declarative data, Tier 2 is sandbox JS, Tier 3 is a supervised process.
  Pipeline steps may be complex Tier 3 operations; no fourth runtime is needed.

## Existing QA Boundary

- `crates/qa-core/src/lib.rs` defines `QaProfileDefinition`, `QaRegexRule`,
  `CompiledQaProfile::evaluate_segment`, bounded evidence/spans, fingerprints,
  run/report projections, and rule limits.
- `crates/storage/src/store/qa.rs::run_qa_with_rules` currently clones a
  profile, appends plugin regex rules, hashes that composite definition, and
  reconciles candidates transactionally. It has no general executable rule
  registry or immutable per-contribution provenance.
- `crates/engine/src/qa.rs::plugin_qa_rules` iterates private
  `plugin_qa_packs`, rechecks grants, and namespaces rule IDs with grant
  identity. This proves operation-time authorization but only supports Tier 1
  regex packs.
- `crates/engine/src/plugin_declarative.rs::PluginQaPack` is Engine-private and
  returns `Vec<QaRegexRule>`; it is not a public executable QA contract.

## Existing Pipeline Boundary

- `crates/pipeline/src/lib.rs` defines `PipelineStep`, `StepExecutionContext`,
  `StepOutcome`, artifact kinds, pipeline/run/step-run states, and
  `StepRegistry::{register,resolve,unregister,validate_definition}`.
- `crates/engine/src/lib.rs::PipelineRuntime` resolves the live registry,
  passes cancellation/checkpoint context, persists step outcomes, and contains
  cancellation-race protection and restart/resume behavior for built-ins.
- `crates/engine/src/plugin_declarative.rs::DeclarativePipelineStep` is a
  private deterministic adapter. It authorizes each call and checks
  cancellation, but declarative descriptors must be non-resumable and there is
  no sandbox/process step adapter or public checkpoint protocol.

## Existing Plugin And SDK Boundary

- `crates/plugin-runtime/src/lib.rs` manifest v2 has provisional
  `QaRuleContributionDescriptor` and `PipelineStepContributionDescriptor`,
  `qa.register`/`pipeline.register` exact contribution scopes, compatibility
  inspection, and tier validation. QA rule definition/input/output fields are
  still generic strings/JSON and pipeline lacks executable envelopes.
- `packages/plugin-sdk/src/index.ts` mirrors the descriptors and provides
  declarative builders, sandbox invocation types, and filter-only process
  handlers. It needs closed QA/step codecs and handlers rather than additional
  private Engine knowledge.
- Tier 2 already supplies bounded QuickJS invocation, cancellation, deadlines,
  payload/depth/node limits, and a closed host-call registry. Tier 3
  `PluginProcess::call` supplies bounded newline JSON-RPC, timeout/crash
  isolation, and process recycling, but its released handshake is filter-only
  and lacks cooperative cancellation.
- `crates/engine/src/plugin.rs` already owns staged versions, capability
  authorizer, activation revisions, collision preflight, attach/detach,
  upgrade/rollback compensation, and restart. Tier 1 QA/steps are registered
  there, but helper naming and ownership maps remain filter-centric.

## Planning Decisions

- Preserve existing QA profiles and pipeline definitions. Add executable
  registries/adapters and immutable provenance rather than a parallel QA or
  pipeline product model.
- Publish one closed tier-neutral contract per contribution family and adapt
  each existing host separately. Tier-neutral does not mean identical
  isolation guarantees.
- QA contract v1 is deterministic mechanical segment evaluation. AI semantic
  QA remains outside this child and cannot be smuggled in through unrestricted
  host calls.
- Registration grants and invocation grants are both required. QA/step input
  is least-authority, and secondary host calls require their own capabilities.
- Runs pin immutable plugin/version/generation provenance. Upgrade affects new
  calls; existing run history and checkpoints never silently rebind.
- Resume requires an explicit checkpoint schema contract/migration. Failure is
  typed and preserves the original checkpoint.
- Examples cover a meaningful public QA rule and resumable process step, retain
  Tier 1 compatibility, and add a Tier 2 codec fixture. They must import the
  public SDK only.

## Risks To Verify During Implementation

- `run_qa_with_rules` currently performs plugin preparation before its storage
  transaction but treats all plugin rules as compiled regex. General execution
  must define fail-atomic behavior across host calls and persistence.
- Pipeline definitions resolve a live step by ID. Version pinning during
  upgrade requires a durable owner/version projection or generation lease.
- Tier 3 process calls currently terminate on timeout but cannot send a cancel
  request. Cooperative cancel plus kill grace must not break the released
  filter server API.
- Provenance must be useful without leaking segment text, config secrets,
  stderr, or raw plugin payloads into audit/history.

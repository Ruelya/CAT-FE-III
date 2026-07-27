# Public Plugin QA Rule And Pipeline Step SDK

## Goal

Complete parent requirement R10 for PRD P-04/H-12 and P-05 by making QA
rules and pipeline steps real, versioned public extension contracts rather
than Tier 1-only Engine adapters. A plugin author must be able to implement a
deterministic QA rule or processing step against `@translunar/plugin-sdk`, run
it through the appropriate declarative, sandbox, or process host, and retain
correct lifecycle, permission, provenance, restart, upgrade, and rollback
behavior without importing private Engine code.

## Background And Confirmed Facts

- `QaProfile`, `CompiledQaProfile`, persistent QA runs/items, waivers, reports,
  and delivery gates already provide the authoritative QA workflow. Current
  plugin QA support only appends private `PluginQaPack` regex rules to a
  profile at run time.
- `PipelineStep`, `StepExecutionContext`, `StepOutcome`, and `StepRegistry`
  already own built-in pipeline execution, cancellation, checkpoints, and
  artifact compatibility. Tier 1 contributes private
  `DeclarativePipelineStep` adapters.
- Manifest v2 and the public SDK contain provisional `qaRule` and
  `pipelineStep` descriptors plus `qa.register` / `pipeline.register`
  capabilities. They do not define executable sandbox/process protocols,
  complete result codecs, tier-neutral lifecycle ownership, or public
  provenance/history.
- Tier 1 declarative execution, capability grants/audit, bounded Tier 2
  QuickJS execution, and supervised Tier 3 process hosting are completed
  dependencies. This task extends those hosts; it does not create a fourth
  runtime.
- The parent requires additive protocol v1, generated renderer wire types,
  official examples with no private dependency, and release-grade Engine and
  desktop qualification.

## Requirements

### R1. Versioned Public Contracts And Compatibility

- Publish closed, versioned `qaRule` and `pipelineStep` contribution
  descriptors, invocation/result envelopes, typed error codes, SDK builders,
  runtime handlers, and validators in Rust and `@translunar/plugin-sdk`.
- Descriptor version, operation protocol version, host API range,
  contribution version, config schema version, and checkpoint schema version
  are distinct fields. Unknown required versions, fields, enum values, or
  operations fail before registration; backward-compatible optional fields
  use explicit defaults.
- Preserve valid manifest-v2 Tier 1 QA packs/pipeline transforms and existing
  pipeline definitions. Built-in IDs remain reserved and an active
  contribution ID has one owner across all tiers.
- Compatibility inspection reports supported/unsupported descriptor,
  operation, config, and checkpoint versions without executing plugin code.

### R2. Tier-Neutral Registration And Lifecycle

- Add Engine-owned QA and pipeline contribution registries whose entries carry
  plugin ID, immutable version ID, activation revision, contribution ID,
  descriptor snapshot, tier, and adapter handle. QA execution and
  `StepRegistry` resolution consume those authoritative entries.
- Install/enable/restart attaches all QA and pipeline contributions for the
  active version atomically with the plugin's other contributions. Disable,
  uninstall, grant revoke/deny, host failure that invalidates authority, and
  stale activation detach exactly the owned generation and make new calls fail
  closed.
- Preflight validates every descriptor, capability, ID collision, host
  operation, and runtime preparation before mutating live registries. Partial
  attach is compensated in reverse order without removing another plugin's or
  a newer generation's entry.
- In-flight calls remain pinned to the version/activation snapshot that
  started them. Detach rejects new calls and requests cancellation; a late
  response cannot publish findings, output, checkpoint, usage, or history for
  a stale activation.

### R3. Permissions And Scope

- Registration and each invocation independently require an exact granted
  `qa.register` or `pipeline.register` contribution scope for the active
  version. A broad grant may authorize a narrow request only through the
  existing scope containment rules.
- QA calls receive only the bounded segment fields declared by the contract
  (identity/location, source/target locale and text, tag findings, configured
  term expectations, and rule config). Pipeline calls receive only their
  declared artifact, validated config, bounded Engine context, and checkpoint.
- Any host calls made during an invocation remain separately capability-
  checked by the existing broker. Registration permissions never imply file,
  network, asset, project, diagnostic, or arbitrary Engine access.
- Allow/deny/detach decisions are recorded through the durable capability
  audit with plugin/version/contribution/operation identity and no document
  text, credentials, or unbounded plugin output.

### R4. QA Rule Execution And Reconciliation

- Support deterministic mechanical QA rule execution for all three tiers:
  Tier 1 retains host-compiled declarative regex packs; Tier 2 invokes the
  bounded sandbox operation; Tier 3 invokes the supervised process protocol.
  Semantic/remote QA is not silently introduced by this contract.
- A public QA invocation returns zero or more closed `QaFindingCandidate`
  projections with stable rule/category/severity/message/fingerprint,
  Unicode-scalar spans, bounded evidence, and bounded related segment IDs.
  The Engine namespaces rule identity by contribution and immutable version
  provenance so grants/upgrades cannot alias old findings.
- Plugin rules participate in document/project runs, live segment
  reconciliation where applicable, run snapshot hashing, report export,
  waiver/reopen behavior, and the delivery gate. A completed run snapshot
  records exactly which plugin/version/contribution/rule revisions executed.
- Invalid, duplicate, out-of-segment, oversized, nondeterministically ordered,
  or unauthorized findings reject that contribution invocation and commit no
  partial findings. Re-running the same rule set/input/config produces the same
  normalized candidates and ordering.

### R5. Pipeline Step Execution

- Publish a closed pipeline operation accepting declared input artifact,
  validated config, optional versioned checkpoint, run/project/document IDs,
  and cancellation context; return declared output artifact, optional
  checkpoint, and bounded typed usage/provenance.
- Tier 1 retains its deterministic non-resumable transform. Tier 2 and Tier 3
  adapters use the bounded sandbox/process hosts with deadlines, payload
  limits, cancellation, crash/protocol isolation, and output codecs.
- Config is validated against the descriptor's public closed schema before a
  run is created and again before execution. Input/output artifact kinds and
  payload limits are enforced by the Engine, never trusted from plugin output.
- `resumable=true` requires a declared checkpoint schema version and a public
  resume handler. Restart preserves committed checkpoints; incompatible or
  missing checkpoint support returns typed `step_not_resumable` /
  `plugin_checkpoint_incompatible` rather than restarting from zero.
- Cancellation wins Engine state races: a canceled invocation cannot become
  succeeded or publish a late checkpoint. Timeout/crash/protocol/permission
  errors become bounded `PipelineFailure` values while the Engine and other
  pipeline steps remain usable.

### R6. Determinism, Cancellation, And Resource Limits

- Define shared maximums for descriptor/config/checkpoint/invocation/result
  bytes, collection sizes, nesting, text/evidence length, finding count, and
  usage fields. Validate incrementally at every host boundary before expensive
  allocation or persistence.
- Every executable call has a host-enforced deadline and cancellation token.
  Tier 2 interruption terminates bounded JS work; Tier 3 sends a versioned
  cancel notification where supported and kills/recycles the child after the
  grace deadline. Tier 1 checks cancellation between deterministic operations.
- Adapters canonicalize map keys and result ordering and reject non-JSON,
  non-finite, cyclic, duplicate-ID, or schema-invalid values. No current time,
  random, ambient environment, direct SQLite, or renderer Node access is
  exposed by the QA/step contract.

### R7. Provenance, History, Diagnostics, And Desktop

- Pipeline step-run records expose plugin ID, immutable version ID,
  contribution version, descriptor/config/checkpoint schema versions,
  activation revision, input/output hashes, bounded usage, terminal failure,
  and timestamps. QA runs/items expose equivalent rule-set provenance and
  retain it after disable, upgrade, rollback, or uninstall.
- Additive Engine protocol projections let desktop list registered QA rules and
  pipeline steps with owner/tier/version/status/compatibility, and show recent
  invocation failures/history without exposing document payloads.
- The Plugins panel contribution inventory displays these public descriptors,
  grants, active/detached/degraded state, versions, and last bounded failure.
  Existing QA and pipeline screens identify plugin-owned findings/steps and
  navigate to durable run/history details; React does not execute rules or
  decide pipeline state.
- `engine.initialize` advertises public QA-rule and pipeline-step capabilities
  only when the complete contract is available.

### R8. Upgrade, Rollback, And Compensation

- Upgrade prepares and validates the candidate host, descriptors, config and
  checkpoint compatibility, and required grants without disturbing the active
  version. Existing compatible grants may carry only under the established
  semantic-key rules; expanded scopes require fresh consent.
- A successful version switch atomically changes the registry generation for
  new calls. Existing pipeline definitions keep their contribution ID but run
  against the active descriptor; immutable completed/running run records remain
  pinned to their recorded version.
- If candidate attach fails, restore the previous version and all registry
  owners. If restoration also fails, keep the installation/version history,
  mark it degraded with typed diagnostics, detach executable authority, and
  never report the candidate as active.
- Rollback applies the same validation and compensation. Checkpoint migration
  is explicit and versioned; absent migration leaves the interrupted run
  failed/recoverable and never rewrites historical checkpoint data.

### R9. Official Examples, Documentation, And Qualification

- Ship one public-SDK QA example covering a non-trivial deterministic industry
  style/compliance rule and one public-SDK process pipeline example covering
  config, progress/checkpoint, cancellation, resume, and typed failure. Keep
  the existing manifest-only Tier 1 toolkit as compatibility coverage and add
  a bounded Tier 2 example or fixture for both executable adapters.
- Examples install through normal lifecycle, request only exact contribution
  grants, import no private Engine package, and include deterministic fixtures
  plus documented install -> grant -> enable -> run -> inspect -> disable.
- Public documentation specifies version negotiation, trust boundaries,
  permissions, limits, deterministic result rules, cancellation, history,
  upgrade/rollback, and honest Tier 3 isolation limitations.

## Acceptance Criteria

- [ ] AC-01: Rust and SDK contract tests round-trip every QA/step descriptor,
      invocation, result, error, config, checkpoint, and compatibility version;
      unknown/oversized/malformed forms fail closed with matching semantics.
- [ ] AC-02: Registry/lifecycle tests attach mixed QA and pipeline
      contributions across Tier 1/2/3, survive restart, and detach on disable,
      uninstall, revoke, failure, or stale activation without affecting another
      owner or leaving a partial registry.
- [ ] AC-03: QA tests prove exact scope enforcement, deterministic bounded
      findings/spans/fingerprints, live and document/project reconciliation,
      run snapshot provenance, waiver/reopen, report, and export-gate behavior;
      a failed plugin rule commits no partial issue/run snapshot.
- [ ] AC-04: Pipeline tests prove descriptor/config/artifact validation,
      Tier 1/2/3 execution, checkpoint persistence/resume, cancellation race
      handling, timeout/crash/protocol isolation, bounded usage/provenance, and
      that subsequent Engine/pipeline operations remain healthy.
- [ ] AC-05: Upgrade and rollback tests prove preflight, generation pinning,
      compatible grant carry, fresh consent for scope expansion, checkpoint
      compatibility/migration, candidate attach compensation, and previous
      version restoration after injected failures.
- [ ] AC-06: Capability audit and durable history contain plugin/version/
      contribution/operation identities and hashes/limits only; tests prove no
      source/target text, config secrets, stderr, or raw plugin payload leaks.
- [ ] AC-07: The official QA and resumable pipeline examples build and execute
      using only `@translunar/plugin-sdk`; smoke covers install, consent,
      enable, QA/pipeline execution, cancel/resume, restart, disable, upgrade,
      rollback, and uninstall while Tier 1 remains compatible.
- [ ] AC-08: Generated contracts and desktop unit/E2E tests show contribution
      inventory, grants, version/tier/state/failure, plugin-owned QA findings,
      pipeline step/run provenance, and revoke/degraded transitions through the
      real Engine with no renderer domain logic or console/page errors.
- [ ] AC-09: Visual evidence at 1250x744, 1680x942, and 1920x1080 shows the
      Plugins, QA, and pipeline history surfaces without overlap, clipping, or
      horizontal overflow and with keyboard/ARIA-operable controls.
- [ ] AC-10: Format, lint, typecheck, generated-contract drift, SDK/example
      tests, Rust fmt/strict Clippy/workspace tests, Engine smoke, desktop build,
      and focused/full Electron E2E pass; exact commands/results are retained
      under task evidence before archive.

## Out Of Scope

- AI semantic QA, LQA/MQM scoring, sampling, and AI action plugins remain in
  their owning PRD children.
- New pipeline authoring UX, scheduled automation, CLI/API orchestration, and
  external connectors remain owned by the pipeline/automation/connector tasks;
  this task exposes plugin steps to existing pipeline definitions and runs.
- A hosted marketplace, remote signing/index, arbitrary plugin database
  access, a fourth runtime, WASM transport, or claims of OS-enforced Tier 3
  confinement are excluded.
- This task does not convert built-in QA rules or pipeline steps into external
  packages; it keeps them on the same registry contracts and proves no
  regression.

## Constraints And Risks

- Protocol changes are additive under protocol v1 and generated TypeScript
  remains authoritative for desktop wire access.
- Released migrations are append-only. New provenance/history columns or
  tables require fresh/upgrade/rollback/restart tests and bounded retention.
- Full deterministic replay cannot control behavior inside a trusted Tier 3
  process. The enforceable guarantee is canonical input/output validation,
  explicit provenance, bounded execution, and reproducibility tests for the
  official examples.
- Running pipeline definitions cannot be rebound silently during upgrade;
  immutable run/version pinning takes priority over immediate adoption.
- No blocking product questions remain. This plan chooses the conservative
  parent-compatible behavior: mechanical QA only, exact contribution scopes,
  fail-closed version negotiation, immutable history, and explicit checkpoint
  migration.

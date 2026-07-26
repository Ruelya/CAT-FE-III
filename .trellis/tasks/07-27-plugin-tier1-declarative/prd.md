# Tier 1 Declarative Plugin Host

## Goal

Deliver the zero-code Tier 1 plugin runtime required by the Full PRD. A local
manifest-only package can contribute an executable simple text filter, regex QA
pack, and deterministic pipeline transform without loading JavaScript or
starting a child process. All contributions participate in the same durable
lifecycle, capability consent, registry isolation, and restart behavior as the
qualified Tier 3 foundation.

## Background

- `07-26-plugin-multitier-runtime` normalized declarative manifests and generic
  contribution descriptors but deliberately kept them as inventory only.
- `07-26-plugin-permission-grants` added default-deny capability requests,
  scoped review, operation checks, revocation, and immutable audit.
- `FilterRegistry` and `StepRegistry` are executable Engine registries. QA
  evaluation currently compiles stored `QaProfileDefinition` values and has no
  plugin-owned runtime registry.
- Full PRD §8 and `docs/design-notes.md` define Tier 1 as a manifest/YAML-style,
  zero-code runtime for simple extraction rules, provider profiles, QA regex
  packs, pipelines, and prompt actions. Dedicated later children own the public
  Engine connector and AI/UI surfaces; this child owns the common host plus
  filter, QA, and deterministic pipeline execution.

## Requirements

### R1. Typed declarative definitions

- Replace opaque Tier 1 execution payloads with versioned, deny-unknown-fields
  definitions for simple UTF-8 filters, regex QA packs, and deterministic JSON
  pipeline transforms.
- Bound every collection, string, regex, capture, operation count, source size,
  output size, and nesting depth before compilation or execution.
- Reject unsupported descriptor/definition versions, invalid regular
  expressions, duplicate IDs, built-in collisions, mismatched artifact kinds,
  and definitions that could access files, network, processes, clocks, random
  state, environment variables, or secrets.

### R2. Zero-code declarative filter

- Implement `DeclarativeDocumentFilter` through the public `DocumentFilter`
  contract. It probes by extension and optional bounded UTF-8 header pattern,
  extracts source units from named regex captures, and emits a valid ordered
  filter event stream with deterministic structural paths.
- Export reparses the immutable source with the same definition, validates
  segment identity/count, replaces only owned capture ranges in reverse order,
  validates the staged UTF-8 result, and publishes with no-clobber semantics.
- Malformed UTF-8, no matches, overlapping/empty captures, source drift,
  oversized input/output, or mismatched segments fail without partial files or
  document persistence.

### R3. Declarative QA packs

- Compile plugin QA definitions into the existing bounded `QaRegexRule` model.
  Rule IDs are namespaced by owning plugin/contribution and cannot shadow core
  or user rules.
- Enabled and authorized packs join the Engine QA execution snapshot without
  rewriting user profiles. QA run hashes/evidence include exact plugin version,
  contribution, rule definition, and active grant so restart results are
  reproducible and revocation removes future findings.
- Disable, revoke, upgrade, rollback, degradation, or uninstall detaches only
  the owning pack; historic QA run evidence remains inspectable.

### R4. Deterministic pipeline transforms

- Add a typed, bounded transform program over JSON artifacts with explicit
  input/output `ArtifactKind`, fixed configuration schema version, and a small
  operation vocabulary such as select, set, assert, and bounded regex replace.
- Implement it through `PipelineStep`; no operation may call Engine services,
  filesystem, network, AI, or another plugin. Cancellation is checked between
  operations, output is bounded, and execution is byte-deterministic.
- Add owner-aware unregister support to `StepRegistry`. A lifecycle attach is
  all-or-nothing across filters, QA packs, and pipeline steps.

### R5. Lifecycle and capability enforcement

- Enable precompiles and prevalidates the complete Tier 1 contribution set,
  checks required capability grants, detects every registry collision, and
  publishes all adapters atomically. Failure leaves the plugin installed and
  no contribution attached.
- Filter operations re-check their file capability scope. QA and pipeline
  registration/execution re-check `qa.register` or `pipeline.register` for the
  exact contribution. No adapter caches authority across operations.
- Disable, deny/revoke, upgrade, rollback, uninstall, and Engine restart keep
  registries consistent with the active durable plugin version. One plugin
  failure never removes built-ins or another plugin's contributions.

### R6. Public contract, SDK, example, and inventory

- Extend Rust schema and generated TypeScript with typed declarative definition
  versions. `@translunar/plugin-sdk` exposes builders/validators that produce
  the exact public manifest without private Engine imports.
- Ship an official manifest-only Tier 1 example exercising one simple filter,
  one regex QA pack, and one pipeline transform through ordinary install,
  permission review, enable, execution, restart, disable, and uninstall flows.
- Existing manifest v1/Tier 3 packages and stored normalized v2 packages remain
  compatible. No protocol version bump and no migration rewrite are allowed.

### R7. Evidence and qualification

- Unit tests cover definition parsing, every bound, regex/capture behavior,
  deterministic transforms, registry ownership, cancellation, and no-clobber.
- Engine tests cover atomic multi-adapter attach, collision rollback, scoped
  denial, revoke/detach, restart, upgrade/rollback, cross-plugin isolation, QA
  provenance, and pipeline execution.
- Generated contract checks, SDK example tests, focused real stdio smoke, and
  real Electron lifecycle E2E must pass without console/page errors.

## Out Of Scope

- OpenAI-compatible Engine connector execution is owned by
  `plugin-engine-connectors`; this task must not create a one-off provider path.
- AI prompt actions and UI panels are owned by `plugin-ai-ui-host`; Tier 2
  JavaScript and iframe/postMessage isolation are owned by
  `plugin-tier2-sandbox`.
- Tier 3 arbitrary-language QA/pipeline protocols, external connectors,
  marketplace signing, and OS-level sandbox claims remain in their dedicated
  children.

## Acceptance Criteria

- [ ] AC1: A valid manifest-only Tier 1 package installs as pending inventory,
      grants no implicit authority, and starts no process or script runtime.
- [ ] AC2: After exact grants, enable atomically registers its declarative
      filter, QA pack, and pipeline step; restart restores the same inventory.
- [ ] AC3: The filter probes/imports/exports a real fixture deterministically,
      preserves unowned bytes, and rejects malformed/drifted/oversized input
      without partial document or output state.
- [ ] AC4: Plugin regex QA findings use namespaced rules and reproducible
      plugin/version provenance; disable/revoke stops future findings without
      changing historic run evidence or user profiles.
- [ ] AC5: The pipeline transform validates artifact/config shape, honors
      cancellation and bounds, produces deterministic output, and has no I/O,
      network, clock, environment, AI, or Engine-service access.
- [ ] AC6: Missing, stale, denied, revoked, unsupported, or out-of-scope
      authority blocks registration/operation with typed audit evidence and no
      effect on built-ins or unrelated plugins.
- [ ] AC7: Upgrade/rollback carries only exact grants, replaces all owned
      adapters atomically, and restores the correct version after restart.
- [ ] AC8: Rust schema, generated contracts, SDK validation/build, the official
      Tier 1 example, focused Engine smoke, full relevant tests, and real
      Electron lifecycle E2E pass.

## Constraints

- Documentation and code-spec updates are written in English.
- Use the existing Engine-owned registries and generated wire contracts; the
  renderer never evaluates definitions or opens plugin package files.
- Do not weaken regex, JSON, file-size, output, or lifecycle bounds to make an
  example pass.

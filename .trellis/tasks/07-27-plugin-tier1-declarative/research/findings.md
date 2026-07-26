# Research Findings

## Product contract

- `docs/PRD.md` P-01/P-02/P-04/P-05 and Full PRD design §8 require a public
  three-tier plugin runtime. Tier 1 is a zero-code declarative manifest for
  simple filters, provider profiles, QA regex packs, pipelines, and prompt
  actions.
- `docs/design-notes.md` explicitly prohibits treating Tier 1 as a script host:
  it is controlled data evaluated by the host. Tier 2 owns sandboxed JS/UI and
  Tier 3 owns arbitrary-language complex filters/connectors/steps.
- `docs/Full PRD gap matrix.md` identifies the missing executable Tier 1 host as
  the next plugin work package after multi-tier normalization and capability
  grants. Both dependencies are now archived.

## Existing reusable boundaries

- `crates/filter-core/src/lib.rs`: `DocumentFilter` supplies probe/import/
  export/validate and `FilterRegistry` already supports register/unregister,
  deterministic descriptor listing, and filter selection.
- `crates/qa-core/src/lib.rs`: `QaRegexRule` and `CompiledQaProfile` already
  enforce bounded regex compilation and deterministic finding generation. The
  missing piece is Engine-owned plugin rule ownership/snapshot integration.
- `crates/pipeline/src/lib.rs`: `PipelineStep`, `StepExecutionContext`, and
  `StepRegistry` provide execution and artifact validation. The registry needs
  unregister/ownership and the declarative transform adapter.
- `crates/plugin-runtime/src/lib.rs`: manifest v2 already models declarative
  runtime inventory and filter/QA/pipeline contribution kinds, but compatibility
  intentionally reports all non-process execution as unsupported.
- `crates/engine/src/plugin.rs`: lifecycle activation currently attaches only
  process filters. It already has staged version, activation revision,
  compensation, restart, and central permission hooks that Tier 1 must reuse.
- `packages/plugin-sdk/src/index.ts`: public v2 types and validation mirror Rust
  normalization; compatibility currently reports declarative runtime as
  unsupported and must change in lockstep with generated contracts.

## Decisions

- Tier 1 executes only typed Rust-owned definitions. No expression evaluator,
  JavaScript, shell, filesystem path template, environment access, or dynamic
  Engine dispatch is permitted.
- One official manifest-only example covers filter, QA, and pipeline together
  so lifecycle atomicity is exercised rather than three disconnected demos.
- Engine connector/provider execution, AI prompt actions, and UI panels remain
  in their already-planned specialist children. This is an ownership boundary,
  not an MVP exclusion from the plugin parent.

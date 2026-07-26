# Public Plugin Runtime and SDK

## Goal

Complete the full local-first plugin ecosystem assigned by the parent PRD. The
existing Tier 3 process-filter runtime is the foundation, not the completion
boundary. The finished parent must support all three tiers, enforce auditable
capability grants, expose public filter/engine/QA/pipeline/AI/UI/external-
connector contracts, ship official examples, and provide a release-grade
desktop management and validation path.

## Confirmed baseline

- Built-in filters already implement `DocumentFilter` and register in
  `FilterRegistry` (`crates/filter-core`, `crates/engine`).
- Pipeline steps already use `StepRegistry`; QA and AI connectors are internal
  and mostly closed catalogs.
- Desktop already spawns the Engine over newline-framed JSON-RPC stdio
  (`apps/desktop/src/main/engine-client.ts`).
- Parent design reserves `plugin.*` protocol methods and a three-tier model
  (declarative / sandboxed JS / child-process).
- There is no plugin crate, SDK package, manifest schema, lifecycle store,
  permission grant table, or public example today.

## Scope and requirements

### R1. Versioned manifest and package layout (P-01, P-10)

- A plugin package is a directory containing `manifest.json` plus an executable
  entry for Tier 3 contributions.
- Manifest declares id, display name, version, host API range, tier, entry,
  contributions, and requested permissions. Unknown required fields fail closed.
- Install from a local directory path. Official examples live in-repo and are
  installed the same way as community packages.

### R2. Lifecycle persistence (P-01, P-10)

- Engine owns install, list, get, enable, disable, and uninstall.
- State survives Engine restart: installed path, status, granted permissions,
  contribution descriptors, last error, crash count, timestamps.
- Enable registers contributions; disable/uninstall remove them before process
  teardown. Failed startup leaves the plugin installed but degraded/disabled.

### R3. Tier 3 process host and filter extension (P-02, B-12, P-09)

- Host plugins as supervised child processes using newline JSON-RPC, deadlines,
  bounded stdout/stderr, cancellation, and crash isolation.
- A process filter adapter implements `DocumentFilter` and delegates
  probe/import/export/validate to the plugin.
- Default deny: source-read and output-write scopes are explicit. No network or
  asset permissions in the first example.
- Plugin crash or timeout must not terminate the Engine; the call fails with a
  typed plugin error and the plugin may move to a degraded state.

### R4. Protocol and capability advertisement

- Add additive `plugin.*` methods under protocol v1.
- `engine.initialize` advertises `plugin.runtime.v1`, `plugin.process.v1`,
  `plugin.filter.v1`, and `plugin.local-install`.
- Generated TypeScript contracts remain the only renderer wire types.

### R5. Public SDK and hello-world filter (P acceptance)

- Publish `@translunar/plugin-sdk` with manifest types, process server helpers,
  filter contribution interfaces, and validation helpers.
- Ship `examples/plugins/hello-srt` that implements a minimal SRT subtitle
  filter using only the public SDK.
- Documented install/run path lets a developer exercise list → enable →
  filter.list → import/export without reading Engine internals.

### R6. Desktop management surface

- Provide a focused Plugins panel (Project Insights or equivalent) listing
  installed plugins, status, permissions, enable/disable, uninstall, and last
  error.
- Directory install is initiated through Electron main (trusted OS dialog or
  test path), then delegated to Engine lifecycle methods.
- Preserve typed Engine error codes across the desktop IPC envelope introduced
  by the curation work.

### R7. Multi-tier runtime model (P-01, P-02, P-10)

- Generalize manifest, persistence, protocol, lifecycle, diagnostics, upgrade,
  and compatibility handling across Tier 1 declarative, Tier 2 sandboxed JS,
  and Tier 3 supervised processes.
- Existing installations and the hello-SRT process filter must migrate without
  losing status, grants, crash history, or contribution identity.

### R8. Capability grants and audit (P-09)

- Replace install-time blanket approval with per-capability consent, bounded
  resource scopes, grant/revoke lifecycle, runtime enforcement, and durable
  audit evidence. Default deny applies to every tier and contribution kind.

### R9. Tier 1 and Tier 2 hosts (P-01, P-02)

- Tier 1 evaluates declarative filters, provider descriptors, regex QA rules,
  and pipeline steps without executing plugin code.
- Tier 2 runs JavaScript in a constrained worker/sandbox with explicit host
  APIs, time/memory/output limits, cancellation, and an isolated UI-panel host.

### R10. Public extension contracts (P-03..P-07, F-12, H-12)

- Publish versioned Engine connector, QA rule, pipeline step, AI action, and UI
  panel contracts and SDK helpers. Contributions register through the owning
  Engine registries and cannot bypass generated wire types or permissions.

### R11. External connector contract (P-08, X-07)

- Define authenticated pull/push/poll/webhook descriptors shared with the
  automation family and ship an official deterministic example connector.

### R12. Management, examples, distribution, and qualification

- Desktop management covers contribution inventory, permission review,
  grant/revoke, upgrades, degraded/crash state, diagnostics, and uninstall.
- Ship examples for every supported contribution family and tier, public docs,
  package validation, restart/upgrade/denial/timeout E2E, and local distribution
  guidance.

## Out of scope

- A hosted marketplace, commercial billing, and mandatory remote signing/index
  infrastructure (P-11) remain release-ecosystem work.
- Claims of OS-level seccomp/AppContainer isolation are excluded until native
  sandbox evidence exists; host-enforced scopes must be described honestly.
- Automation UI and CLI orchestration remain owned by
  `07-19-api-cli-automation`, while the shared connector contract is co-owned.

## Acceptance criteria

- [ ] AC-01: Installing a valid local plugin package persists identity, path,
      status, requested/granted permissions, and survives Engine restart.
- [ ] AC-02: Enabling a filter plugin registers its descriptor in `filter.list`
      and import/export of a fixture succeeds through the Engine document path.
- [ ] AC-03: Disabling or uninstalling removes the contribution from
      `filter.list` and rejects subsequent use of that filter id.
- [ ] AC-04: Duplicate plugin id, incompatible host API, missing entry, and
      missing required permission are rejected with typed errors and no partial
      registration.
- [ ] AC-05: A plugin process crash or deadline during probe/import does not
      kill the Engine; subsequent non-plugin RPCs still succeed.
- [ ] AC-06: `@translunar/plugin-sdk` plus `examples/plugins/hello-srt` build
      and pass focused tests; smoke covers install → enable → import → disable.
- [ ] AC-07: Desktop Plugins surface can list status, install (test path),
      enable/disable, and show last error without console/page errors.
- [ ] AC-08: `pnpm contracts:check`, workspace lint/typecheck/tests, Clippy,
      and Engine smoke pass for the owned surface.
- [ ] AC-09: Existing Tier 3 installations migrate to the tier-aware schema and
      restart without contribution or grant loss.
- [ ] AC-10: Per-capability grants are consented, scoped, revocable, audited,
      and enforced identically at registry and operation boundaries.
- [ ] AC-11: Tier 1 declarative contributions and Tier 2 sandboxed/UI
      contributions execute under bounded hosts with denial, timeout, crash,
      and restart tests.
- [ ] AC-12: Public Engine connector, QA, pipeline, AI action, UI panel, and
      external connector SDKs have official examples using no private Engine
      implementation dependency.
- [ ] AC-13: Desktop management and full lifecycle E2E cover install, review,
      grant/revoke, enable/disable, upgrade, degraded recovery, and uninstall.
- [ ] AC-14: Every P-01..P-10 requirement is mapped to one independently
      archived child task and reproducible evidence; the Tier 3 foundation alone
      cannot close this parent.

## Constraints

- Preserve unrelated dirty worktree paths (visual polish, Trellis toolchain).
- Additive protocol only; no protocol version bump.
- Never give plugins direct SQLite handles or renderer Node access.
- Built-in filters remain statically linked; plugins must not replace built-in
  ids such as `builtin.*`.

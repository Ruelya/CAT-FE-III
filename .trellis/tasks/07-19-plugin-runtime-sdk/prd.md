# Public Plugin Runtime and SDK

## Goal

Ship a local-first plugin runtime so third parties can install a process filter
plugin, grant only the permissions it needs, and use it through the same Engine
filter path as built-ins. This child establishes the shared manifest,
lifecycle, permission, Tier 3 process host, public SDK, and hello-world example
that later extension points reuse.

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

## Out of scope (this child)

- Plugin marketplace / signing / remote index (P-11).
- Tier 2 sandboxed JS/UI runtime and iframe host.
- Code-level QA rule plugins (H-12), engine connector plugins (F-12), pipeline
  step process plugins, AI action injection, and external-system connectors
  (P-03..P-08 beyond descriptor-ready stubs if needed).
- OS-level seccomp/AppContainer confinement beyond host-enforced path scopes.
- API/CLI automation child surfaces (owned by `07-19-api-cli-automation`).

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

## Constraints

- Preserve unrelated dirty worktree paths (visual polish, Trellis toolchain).
- Additive protocol only; no protocol version bump.
- Never give plugins direct SQLite handles or renderer Node access.
- Built-in filters remain statically linked; plugins must not replace built-in
  ids such as `builtin.*`.

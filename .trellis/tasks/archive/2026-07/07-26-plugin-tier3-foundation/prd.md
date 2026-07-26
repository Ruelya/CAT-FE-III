# Plugin Tier 3 foundation qualification

## Goal

Close Tier 3 process-filter foundation gaps: fail-closed duplicate install, typed crash/timeout propagation with durable degraded state, public SDK dogfood, and real Engine/Desktop failure-path evidence.

## Requirements

- A valid local process-filter package installs into the Engine-managed plugin
  directory and survives restart with its identity, grants, contributions,
  revision, status, and crash diagnostics intact.
- Installing an already-installed manifest id fails before changing the
  managed package, registry, process table, database record, revision, or
  timestamps. Incompatible API ranges, missing entries, invalid manifests, and
  missing required grants also fail with stable typed protocol errors.
- Process crashes, protocol failures, and deadlines during probe/import remain
  distinguishable from unsupported documents. The Engine returns
  `plugin_process_failed`, remains responsive, unregisters the affected
  contribution, and durably records `degraded`, `lastError`, and one additional
  `crashCount`.
- Process plugins inherit no ambient host secrets. Stderr is drained and
  bounded for local diagnostics but is not exposed through client-facing RPC
  errors.
- `@translunar/plugin-sdk` owns the process JSON-RPC server helper and its real
  TypeScript test suite runs under the workspace test command.
- `examples/plugins/hello-srt` imports the public SDK by package name in its
  source, builds a self-contained executable entry, and completes install,
  enable, import/export, restart, disable, and uninstall through the real
  Engine without private Engine dependencies.
- The desktop Plugins panel demonstrates both the successful lifecycle and a
  real process-failure path, preserving the typed IPC error while showing the
  durable degraded state and last error without renderer console/page errors.

## Acceptance Criteria

- [x] AC-01: A second install of the same plugin id returns a typed conflict
      and a regression test proves the database record, revision, managed
      package bytes, registry, and process state are unchanged.
- [x] AC-02: Invalid manifest/API/entry inputs and missing permissions retain
      `plugin_invalid_manifest` / `plugin_permission_denied` semantics with no
      partial registration.
- [x] AC-03: A crash and a bounded timeout are isolated; document/probe calls
      return `plugin_process_failed`, a subsequent ordinary Engine RPC succeeds,
      and durable plugin state becomes degraded with crashCount incremented once.
- [x] AC-04: The failed plugin contribution is removed until an explicit
      recovery/enable action; restart preserves its diagnostics and does not
      auto-register a degraded plugin.
- [x] AC-05: The SDK TypeScript tests actually execute, the hello-SRT source
      imports `@translunar/plugin-sdk`, its bundle builds reproducibly, and a
      test would fail if the SDK server helper were no longer used.
- [x] AC-06: Real Engine smoke covers install -> enable -> import/export ->
      restart -> disable/uninstall plus typed failure isolation.
- [x] AC-07: Real Electron E2E covers success and failure UI states at the
      supported viewports with named controls, no overlap/overflow, and no
      console or page errors.
- [x] AC-08: Contracts, formatting, lint, typecheck, tests, strict Clippy,
      Engine smoke, desktop build/E2E, and task-owned evidence pass.

## Notes

- This is the qualification child for the existing Tier 3 foundation. It does
  not close the plugin parent or absorb the multi-tier, grant/audit, Tier 1,
  Tier 2, or non-filter extension children.
- Preserve unrelated dirty task planning and never stage
  `.trellis/workspace/Ruelya/workbench-assistant-1250x744.png`.

## Verification note

The bounded-deadline proof includes both a runtime pipe-backpressure fixture
and a real Engine import fixture whose process stops responding. The latter
asserts `plugin_process_failed` with `failureKind: timeout`, `retryable: false`,
one durable crash increment, contribution/process removal, a responsive
ordinary Engine request, and degraded-state persistence after restart.

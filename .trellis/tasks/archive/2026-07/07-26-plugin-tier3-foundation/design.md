# Design: Tier 3 Foundation Qualification

## Error ownership

`plugin-runtime` converts process failures into structure-preserving
`FilterError` variants carrying the plugin id and bounded message. The Engine
is the only layer that mutates lifecycle state: it records a crash, unregisters
the failed plugin's filters/process, and maps the same typed cause to protocol.
Electron only renders the generated error envelope and refreshed summary.

```text
child crash/timeout
  -> PluginRuntimeError
  -> FilterError::PluginProcess { plugin_id, message }
  -> Engine records degraded/crashCount/lastError and unregisters owner
  -> ErrorCode::PluginProcessFailed + { pluginId }
  -> preload structured rejection
  -> PluginsPanel error + refreshed degraded row
```

Permission failures use a distinct filter error and map to
`plugin_permission_denied`; format failures keep their existing import/export
codes. Client errors never include plugin stderr.

## Atomic duplicate rejection

Load and validate the source manifest first, then query the installation by id.
An existing row returns `InvalidState` before destination removal/copy,
registry/process mutation, or upsert. Tests fingerprint the managed entry and
compare the complete persisted summary before and after rejection.

## SDK and example

The SDK package builds its TypeScript entry and runs Vitest against
`src/index.test.ts`. The hello-SRT authoring source imports
`startProcessPlugin` and public types from `@translunar/plugin-sdk`; its build
produces the manifest entry as a self-contained Node ESM bundle so the Engine's
managed package copy has no workspace dependency.

## Fixtures and evidence

A deterministic crash fixture handshakes normally and exits during filter
execution. Process stdin is owned by a bounded writer queue/thread; calls start
their deadline before enqueue and never hold the process-state mutex across
pipe I/O. Runtime tests cover a plugin that stops reading stdin, writer I/O
classification, and generation recovery. The Engine test uses the public
timeout seam to run a real hanging import and asserts typed failure, degraded
persistence, contribution removal, restart safety, and a subsequent ordinary
RPC. Screenshots remain task-owned at 1250x744, 1680x942, and 1920x1080.

The supported Engine contract is one serialized `EngineService` per data
directory (stdio's dispatcher loop and the loopback API mutex). Cross-process
duplicate-install locking is a separate workspace-level concern and is not
silently claimed by this child.

## Rollback

All wire changes are additive error data/handling. Reverting this child leaves
the existing plugin table intact; no migration is changed. Built-in filters are
never removed, and only filters owned by the failed plugin are unregistered.

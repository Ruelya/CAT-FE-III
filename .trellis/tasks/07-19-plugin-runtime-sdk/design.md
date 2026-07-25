# Design: Public Plugin Runtime and SDK

## Architecture

```text
Plugin package/
  manifest.json
  bin/hello-srt(.js|.exe)

Engine
  PluginManager
    ManifestValidator
    PluginStore (SQLite + data/plugins/)
    PermissionService (requested ∩ granted)
    Tier3ProcessHost (stdio JSON-RPC)
    ProcessFilterAdapter → FilterRegistry

Desktop
  PluginsPanel → plugin.* RPC
  main: select plugin directory / test install path
```

## Boundaries

| Layer | Owns | Must not own |
| --- | --- | --- |
| `plugin-runtime` | manifest parse/validate, process host, wire codec, filter adapter | SQLite schema, desktop UI |
| `storage` | plugin rows, grants, crash counters | process spawning |
| `protocol` | `plugin.*` params/results | runtime policy |
| `engine` | lifecycle orchestration, registry attach/detach | renderer code |
| `@translunar/plugin-sdk` | public TS types + process server helpers | Engine internals |
| desktop | management UI + OS directory pick | domain rules |

## Manifest (v1)

```json
{
  "manifestVersion": 1,
  "id": "example.hello-srt",
  "displayName": "Hello SRT",
  "version": "0.1.0",
  "apiVersion": 1,
  "apiVersionMin": 1,
  "tier": "process",
  "entry": { "kind": "node", "path": "bin/hello-srt.mjs" },
  "contributions": {
    "filters": [
      {
        "id": "example.hello-srt",
        "version": "0.1.0",
        "displayName": "Hello SRT",
        "extensions": ["srt"],
        "capabilities": {
          "import": true,
          "export": true,
          "validate": true,
          "inlineTags": false,
          "notes": false,
          "degradationReport": true
        }
      }
    ]
  },
  "permissions": ["file.read:source", "file.write:output"]
}
```

Rules:

- `id` is reverse-DNS-ish, non-empty, not starting with `builtin.`.
- Contribution filter ids must be unique workspace-wide and cannot collide with
  built-ins or other enabled plugins.
- Host API is currently `1`. `apiVersionMin..=apiVersion` must contain host.
- Entry `kind` for MVP: `node` (path relative to package root) or `executable`.

## Permissions

Initial vocabulary:

- `file.read:source` — read Engine-supplied source path for filter ops
- `file.write:output` — write Engine-supplied export destination
- reserved later: `network:<origin>`, `asset.read:*`, `ui.panel`, ...

Effective authority = requested ∩ granted. Enable requires every requested
permission to be granted (MVP installs grant requested permissions after an
explicit `grantRequested: true` flag on install/enable). Missing permission
fails the operation with `permissionDenied`.

## Process protocol

Child speaks the same newline JSON-RPC framing as the Engine:

- `plugin.handshake` → `{ apiVersion, pluginId, contributions }`
- `filter.descriptor`
- `filter.probe` `{ sourcePath }`
- `filter.import` `{ sourcePath, documentId?, sourceLocale?, options? }`
- `filter.export` `{ sourcePath, outputPath, segments }`
- `filter.validate` `{ sourcePath }`
- `plugin.shutdown`

Import returns a serializable event array (`PluginFilterEvent[]`) that the host
rehydrates into `FilterEvent` values. Export/validate return the existing
report shapes. Host enforces:

- request deadline (default 30s, import 120s)
- max stdout frame bytes
- kill on timeout
- no ambient env secrets beyond `TRANSLUNAR_PLUGIN_ID`

## Storage (migration 16)

```sql
plugin_installations(
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  version TEXT NOT NULL,
  tier TEXT NOT NULL,
  status TEXT NOT NULL, -- installed|enabled|disabled|degraded
  package_path TEXT NOT NULL,
  entry_json TEXT NOT NULL,
  manifest_json TEXT NOT NULL,
  contributions_json TEXT NOT NULL,
  requested_permissions_json TEXT NOT NULL,
  granted_permissions_json TEXT NOT NULL,
  last_error TEXT,
  crash_count INTEGER NOT NULL DEFAULT 0,
  installed_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
)
```

Package files are copied into `<dataDir>/plugins/<id>/` so uninstall is
self-contained and source folders can move.

## Protocol methods

- `plugin.list` → page of summaries
- `plugin.get` `{ pluginId }`
- `plugin.install` `{ sourcePath, grantRequested, actor, reason }`
- `plugin.enable` / `plugin.disable` / `plugin.uninstall`
  `{ pluginId, expectedRevision?, actor, reason }`

Each summary includes revision, status, contributions, permissions, lastError.

## Filter registry integration

Add `FilterRegistry::unregister(id)` and optional `owner_plugin_id` on runtime
adapter metadata (not necessarily on wire descriptor). On Engine open:

1. load plugin rows
2. for `enabled` plugins, spawn handshake lazily on first use or eagerly on
   enable
3. register `ProcessDocumentFilter` adapters
4. on disable/uninstall, unregister then stop process

Built-ins register first and always win id conflicts.

## Desktop

- New `PluginsPanel` under Project Insights tabs.
- Main process may set `TRANSLUNAR_TEST_PLUGIN_SOURCE` for E2E install path,
  mirroring other test export env vars.
- UI uses generated contracts only.

## Trade-offs

| Choice | Why | Alternative rejected |
| --- | --- | --- |
| Tier 3 filter first | Reuses strongest registry; proves isolation | Scaffold all extension points shallowly |
| Copy package into data dir | Stable path after install | Run in-place (breaks when source moves) |
| Node example entry | Fast public SDK dogfood without shipping a second native toolchain | Only native executable examples |
| Host-enforced path scopes | Honest MVP security boundary | Pretend full OS sandbox exists |

## Rollback

- Migration 16 is additive; restore pre-migration backup to drop plugin tables.
- Disable capability advertisement if process host is unsafe; built-ins remain.
- Remove desktop tab without touching Workbench visual polish files beyond a
  tab registration line in `ProjectInsightsPage.tsx`.

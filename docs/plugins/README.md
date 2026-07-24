# Plugin SDK (local process filters)

Translunar CAT loads **Tier 3 process plugins** that speak newline-framed
JSON-RPC on stdio. The first public contribution type is a document filter.

## Package layout

```text
my-plugin/
  manifest.json
  bin/entry.mjs
```

See `examples/plugins/hello-srt` for a complete SRT filter.

## Lifecycle

```text
plugin.install { sourcePath, grantRequested: true }
plugin.enable  { pluginId }
filter.list                 # contribution appears
document.import / export    # uses the filter id
plugin.disable / uninstall
```

## Permissions

MVP permissions:

- `file.read:source`
- `file.write:output`

Install with `grantRequested: true` to grant the manifest's requested set.

## Develop

```bash
# from repo root after building the engine
node scripts/engine-smoke.mjs   # set TRANSLUNAR_SMOKE_SCOPE=plugin for focused smoke
```

TypeScript helpers live in `@translunar/plugin-sdk`.

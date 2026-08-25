# Release signing and notarization (planned)

## Current status: not implemented

There is no packaging pipeline, so there is nothing to sign. The repository
has no electron-builder configuration, no `package:*` or `release:*` scripts,
and no packaging CI workflows. This document records the contract the future
pipeline should meet so earlier decisions are not lost; nothing below exists
in the tree today. See [packaging.md](./packaging.md) for the current state.

## Planned artifacts

| Platform | Targets | Engine resource path |
| --- | --- | --- |
| Windows | installer + unpacked dir (`x64`) | `resources/engine/tl-engine.exe` |
| macOS | DMG + ZIP + dir (`x64`, `arm64`) | `resources/engine/tl-engine` |

When `app.isPackaged`, Electron main already resolves the engine binary at
`process.resourcesPath/engine/tl-engine` (`tl-engine.exe` on Windows), so a
packager must place the matching-platform release binary there.

## Planned signing hooks

Unsigned packages must remain valid for development. Signing and notarization
stay optional CI secrets; when secrets are absent, packaging continues and
records an unsigned result.

### Windows

| Secret | Purpose |
| --- | --- |
| `CSC_LINK` | Certificate file/URL for electron-builder |
| `CSC_KEY_PASSWORD` | Certificate password |

### macOS

| Secret | Purpose |
| --- | --- |
| `CSC_LINK` / `CSC_KEY_PASSWORD` | Developer ID application cert |
| `APPLE_ID` | Notarization Apple ID |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password |
| `APPLE_TEAM_ID` | Team identifier |

## Non-negotiables carried forward

- No account or login requirement to install or run.
- Feed URLs and credentials are never hard-coded into the renderer.
- A missing engine binary in the package must fail the packaging job rather
  than surface as a broken install.

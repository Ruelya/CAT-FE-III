# Release signing and notarization (planned)

## Current status: not implemented

Nothing is signed. Packaging today produces only an unsigned, unpackaged
directory artifact via electron-builder's `dir` target (`pnpm package:dir`
and the manual `package.yml` workflow); there are no installers and no
signing or notarization wiring. This document records the contract the
future installer pipeline should meet so earlier decisions are not lost.
See [packaging.md](./packaging.md) for the current state.

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

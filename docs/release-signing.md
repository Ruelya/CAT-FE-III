# Release packaging, signing, and notarization

## Artifacts

| Platform | Targets | Engine resource path |
| --- | --- | --- |
| Windows | NSIS + unpacked dir (`x64`) | `resources/engine/translunar-engine.exe` |
| macOS | DMG + ZIP + dir (`x64`, `arm64`) | `resources/engine/translunar-engine` |

Minimum macOS version is declared in `apps/desktop/electron-builder.yml`
(`minimumSystemVersion`, currently 12.0).
The ZIP target is required for `electron-updater` macOS feeds; the DMG and
directory targets remain the installer and smoke-test artifacts.

## Local package commands

```bash
# Matching-platform Engine binary first
cargo build -p translunar-engine --release
pnpm package:dir
pnpm release:package:check
```

Platform installers:

```bash
pnpm package:win   # Windows runner
pnpm package:mac   # macOS runner
pnpm release:install-smoke --platform win32
pnpm release:install-smoke --platform darwin
```

## Gates

- Artifact size **≤ 200 MB** (measured by `scripts/release-package-check.mjs`)
- Clean install / launch / Engine smoke with isolated data directory
- No account or login requirement
- First usable project path on CI fixtures **≤ 3 minutes**
- Missing Engine binary or failed launch fails the job

## Signing hooks (optional)

When secrets are absent, packaging continues and records an **unsigned** result.

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

Hooks are environment-gated in CI; local developers may ship unsigned builds.

## Update feed

The desktop update manager reads `TRANSLUNAR_UPDATE_FEED_URL` when set. For CI and
unit tests, point it at a local fixture JSON file:

```json
{ "version": "9.9.9", "notes": "fixture", "url": "file://..." }
```

Feed URLs and credentials are never hard-coded into the renderer.

## Contribution / plugin release guidance

- App releases: this document + `docs/packaging.md` + `docs/contributing.md`
- Plugins: `docs/plugins/README.md` (process-isolated packages, no renderer
  execution, Engine-managed install under the data directory)
- Governance: [`LICENSE`](../LICENSE), [`SECURITY.md`](../SECURITY.md), and
  [`CODE_OF_CONDUCT.md`](../CODE_OF_CONDUCT.md)

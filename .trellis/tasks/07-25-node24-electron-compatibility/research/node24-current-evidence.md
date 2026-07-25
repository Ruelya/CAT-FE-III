# Node 24 compatibility: current evidence

## Repository facts

- Root `package.json` requires `>=22.17.0 <23` and runs a preinstall guard.
- `scripts/check-node-version.mjs` rejects every major other than 22 and names
  Electron 39 installation reliability under Node 24 as the reason.
- `apps/desktop/package.json` pins Electron `39.8.10`, electron-builder
  `26.0.12`, and electron-updater `6.8.9`.
- `pnpm why extract-zip --recursive` resolves `extract-zip@2.0.1` through
  Electron 39.8.10. Upstream Electron issue #51619 identifies an extraction
  hang or missing binaries with Node 24.16.0 and newer.
- CI and both native packaging workflows currently use Node 22.
- The current workstation is Node `v24.17.0` with pnpm `10.18.3`; commands
  run against the existing install can pass while the preinstall guard is not
  exercised.

## Evidence gap

The repository documents the risk but does not yet contain a clean-install
reproduction or an integrity probe. The authoritative primary symptom is an
install/extraction hang; missing/partial runtime detection remains a defensive
postinstall check. The first experiment must use a hard timeout and a clean
Electron cache.

## Upstream repair selection

- Electron 39.8.10 is the latest 39.x release and retains the affected chain.
- Electron 41.10.3 is the oldest currently supported major's latest patch and
  contains the repaired extraction path.
- The expected lock resolution is `@electron/get@5.x` and
  `@electron-internal/extract-zip@1.0.4` or newer. Version 1.0.3 is insufficient
  because its Linux glibc regression was fixed in 1.0.4.

## Decision direction

Adopt dual support for Node 22 release builds and Node 24 development/CI with
the repaired Electron graph and an executable install-integrity gate. Keep
full task acceptance and native release qualification pending until the CI
matrix supplies completed clean-install and package smoke evidence.

## Implementation evidence — 2026-07-25

### Implemented contracts

- Root engines and the executable preinstall guard now accept Node 22.17+
  within major 22 and Node 24.x. Deterministic tests reject 22.16, 23, 25,
  malformed versions, and prereleases.
- `.node-version` selects Node 24.17.0 for development. CI and both native
  packaging workflows use a `22.17.0` / `24` matrix and run the Electron
  install-integrity gate immediately after the frozen install.
- Electron is pinned to 41.10.3. electron-builder remains 26.0.12 and
  electron-updater remains 6.8.9.
- `pnpm install --lockfile-only` completed under Node 24.17.0 with pnpm
  10.18.3 without modifying workspace `node_modules`. The resulting frozen
  graph resolves Electron 41.10.3, `@electron/get@5.0.0`, and
  `@electron-internal/extract-zip@1.0.4`; `extract-zip@2.0.1` is absent.
- `scripts/check-electron-install.mjs` verifies those installed versions,
  rejects an executable path outside the Electron package, requires the
  executable and `default_app.asar`, and executes `electron --version` with a
  20-second hard timeout. It resolves dependency manifests through pnpm's real
  virtual-store path rather than assuming flat `node_modules`. Its tests cover
  complete, partial, linked-layout, old/prerelease extractor, path-escape, and
  hung-process cases.
- The standard `pnpm bootstrap` path runs the install-integrity gate before
  building. CI and native packaging matrices run the same gate plus real
  Engine/Electron E2E on both supported Node lanes. Ubuntu CI installs the
  explicit Poppler/Tesseract prerequisites before the full Engine smoke.

### Local validation results

Host: Windows 11 Pro Insider Preview 10.0.26220 x64.

| Command | Runtime | Result |
| --- | --- | --- |
| `pnpm install --frozen-lockfile` + `pnpm electron:install:check` | Node 24.17.0 | pass; Electron reports v41.10.3 |
| fresh manifest-only offline frozen install + integrity check | Node 24.17.0 | pass; 511 packages, postinstall, and executable probe |
| `pnpm toolchain:test` | Node 24.17.0 / 22.22.1 | pass, 11/11 on both lanes |
| `pnpm contracts:check` | Node 24.17.0 / 22.22.1 | pass on both lanes |
| `pnpm typecheck` | Node 24.17.0 / 22.22.1 | pass on both lanes |
| `pnpm lint` | Node 24.17.0 / 22.22.1 | pass on both lanes, including clippy |
| `pnpm test` | Node 24.17.0 / 22.22.1 | pass on both lanes; desktop 142/142 plus full Rust workspace |
| `pnpm test:e2e:desktop` | Node 24.17.0 | pass, 23 passed / 1 external-PDF-tool skip in 5.3m |
| `pnpm test:e2e:desktop` | Node 22.22.1 | pass, 23 passed / 1 external-PDF-tool skip in 5.4m |
| `pnpm release:package:gate-test` | Node 24.17.0 | pass, 18/18 |
| `pnpm release:install-smoke:test` | Node 24.17.0 | pass, 5/5 |
| `pnpm docs:check` | Node 24.17.0 | pass |

The pre-existing plugin-SDK typecheck blocker was fixed in the independent
`fix(plugin-sdk): declare vitest type dependency` commit, after which full
workspace typecheck passed on both Node lanes. Local `pnpm test:e2e:engine`
reaches the PDF portion and cannot continue because this Windows host has only
Git's `pdftotext`, not `pdfinfo`, `pdftoppm`, or Tesseract. The full desktop
suite uses the real Engine and passes; its explicit PDF test is the one skipped
case. Ubuntu CI installs all PDF tools and runs the full Engine smoke instead
of hiding that platform prerequisite.

### Isolated clean-install evidence

The Node 24 experiment copied only workspace manifests, the frozen lockfile,
and the two lifecycle/integrity scripts to
`C:\Users\Cloud\AppData\Local\Temp\tl-node24-clean-f7d6e80ff72e430785f9a4cea4f888e1`.
It used a store inside that directory plus a separate Electron cache and ran:

```text
pnpm install --frozen-lockfile --store-dir <isolated-store>
node scripts/check-electron-install.mjs
```

The host command reached its 304-second hard timeout during Electron
postinstall. The partial package contained metadata but no `path.txt`, `dist`,
or `default_app.asar`; the integrity checker rejected it. The one verified
residual `node install.js` process was terminated by PID after the timeout.
No workspace `node_modules` path was deleted or rewritten by that experiment.

This result is not classified as an Electron 41 compatibility failure. The
release asset HEAD request succeeded and reported 142,902,968 bytes, while a
1 MiB range request completed at only 136,809 bytes/second. At that observed
rate a clean Electron download needs roughly 17 minutes, well beyond the local
experiment timeout. A Node 22 clean install was not repeated over the same
constrained link because it downloads the identical Electron asset and would
not distinguish runtime behavior.

A second fresh manifest-only workspace used the populated pnpm store and
Electron cache in offline mode to remove network throughput from the result:

```text
pnpm install --offline --frozen-lockfile --store-dir K:\.pnpm-store\v10
node scripts/check-electron-install.mjs
```

It installed all 511 packages into a new workspace, ran Electron's postinstall,
and completed in 19.5 seconds. The subsequent executable probe reported
Electron 41.10.3, `@electron/get@5.0.0`, and
`@electron-internal/extract-zip@1.0.4`. The normal repository frozen install
also completed the Electron 41 postinstall and integrity check in 17.5 seconds.

### Evidence still required

- CI confirmation of the committed Node 22/24 clean-install and full Engine
  smoke matrix. Local frozen installs, integrity checks, and Electron 41 E2E
  passed on both lanes.
- Windows and macOS package, native install, app-owned Engine handshake, and
  updater regression evidence from the updated matrix workflows. Those remote
  results remain part of platform/release qualification because this session
  does not push or dispatch hosted runners.

The compatibility implementation is complete and locally verified. Native
package/signing/updater results remain an explicit external-runner gate for the
parent platform task and final release qualification, not an unreported local
substitute.
